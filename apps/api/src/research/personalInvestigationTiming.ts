import type { FastifyReply } from "fastify";

// These limits apply only to the personal report POST. Other AI paths keep
// their configured timeouts and send policy.
export const INVESTIGATION_REQUEST_TIMEOUT_MS = 480_000;
export const INVESTIGATION_PLAN_TIMEOUT_MS = 45_000;
export const INVESTIGATION_SOURCE_TIMEOUT_MS = 80_000;
export const INVESTIGATION_ANALYSIS_TIMEOUT_MS = 320_000;
export const INVESTIGATION_ANALYSIS_CALL_TIMEOUT_MS = 300_000;

const MINIMUM_MODEL_SEND_WINDOW_MS = 1_000;

// In the installed Fastify 5.8.5, request.signal treats IncomingMessage
// "close" (including a normally completed POST body) as cancellation. Use
// the response lifecycle: an unfinished response closing means the client
// connection was lost; a finished response only releases the deadline.
export function investigationRequestSignal(reply: FastifyReply, timeoutMs = INVESTIGATION_REQUEST_TIMEOUT_MS): AbortSignal {
  const response = reply.raw;
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    response.off("finish", cleanup);
    response.off("close", onClose);
  };
  const onClose = () => {
    if (!response.writableFinished && !controller.signal.aborted) {
      controller.abort(new DOMException("Investigation connection closed", "AbortError"));
    }
    cleanup();
  };
  if (response.destroyed) {
    controller.abort(new DOMException("Investigation connection closed", "AbortError"));
    return controller.signal;
  }
  response.once("finish", cleanup);
  response.once("close", onClose);
  timer = setTimeout(() => {
    if (response.writableFinished) return cleanup();
    controller.abort(new DOMException("Investigation deadline exceeded", "TimeoutError"));
    // End the HTTP request even if a database or parser await cannot observe
    // the signal immediately. The handler checks it before any later model send.
    if (!reply.sent && !response.destroyed) {
      reply.code(504).send({ code: "INVESTIGATION_UNAVAILABLE", ok: false, failureKind: "timeout",
        message: "本次研究等待超时，没有生成新报告。可先查看已读资料或历史报告，稍后再试。" });
    }
  }, timeoutMs);
  return controller.signal;
}

export function investigationTimedSignal(startedAt: number, phaseMilliseconds: number,
  callMilliseconds: number, requestSignal?: AbortSignal, modelSend = false): AbortSignal {
  requestSignal?.throwIfAborted();
  const remaining = phaseMilliseconds - (Date.now() - startedAt);
  if (remaining < (modelSend ? MINIMUM_MODEL_SEND_WINDOW_MS : 1)) {
    throw new DOMException("Investigation time budget exhausted before request", "TimeoutError");
  }
  const signals = [AbortSignal.timeout(Math.min(remaining, callMilliseconds))];
  if (requestSignal) signals.push(requestSignal);
  return AbortSignal.any(signals);
}

