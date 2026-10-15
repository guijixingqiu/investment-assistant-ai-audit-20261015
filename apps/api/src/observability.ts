import type { FastifyInstance } from "fastify";

export const CORRELATION_ID_HEADER = "x-correlation-id";

export function registerRequestObservability(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    reply.header(CORRELATION_ID_HEADER, request.id);
  });

  app.addHook("onResponse", async (request, reply) => {
    if (reply.statusCode < 400) return;
    request.log.warn({
      correlationId: request.id,
      event: "request_failed",
      method: request.method,
      route: request.routeOptions.url ?? "unmatched",
      statusCode: reply.statusCode
    }, "request completed with failure status");
  });

  app.setErrorHandler(async (error, request, reply) => {
    const clientError = classifyClientError(error);
    if (clientError) {
      await reply.code(clientError.statusCode).send({
        ok: false,
        error: {
          code: clientError.code,
          message: clientError.message,
          correlationId: request.id
        }
      });
      return;
    }

    request.log.error({
      correlationId: request.id,
      errorCode: "internal_error",
      method: request.method,
      route: request.routeOptions.url ?? "unmatched",
      error
    }, "request failed");

    await reply.code(500).send({
      ok: false,
      error: {
        code: "internal_error",
        message: "The request could not be completed.",
        correlationId: request.id
      }
    });
  });
}

function classifyClientError(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
} | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as { code?: unknown; statusCode?: unknown };
  const statusCode = candidate.statusCode;
  if (typeof statusCode !== "number" || !Number.isInteger(statusCode) || statusCode < 400 || statusCode > 499) return null;
  if (candidate.code === "FST_ERR_CTP_INVALID_JSON_BODY" || candidate.code === "FST_ERR_CTP_EMPTY_JSON_BODY") {
    return { statusCode, code: "malformed_json", message: "The request body must contain valid JSON." };
  }
  if (candidate.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
    return { statusCode, code: "unsupported_media_type", message: "The request content type is not supported." };
  }
  if (candidate.code === "FST_ERR_VALIDATION") {
    return { statusCode, code: "validation_error", message: "The request does not match the required schema." };
  }
  return { statusCode, code: "invalid_request", message: "The request could not be accepted." };
}
