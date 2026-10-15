import type { FastifyReply } from "fastify";
import {
  CandidateMembershipConflictError,
  CandidateMembershipNotFoundError,
  CandidateMembershipVersionConflictError,
  DeepResearchGateError,
  IdempotencyConflictError
} from "../research/domain.js";

export function researchWriteFailure(reply: FastifyReply, error: unknown, fallback: string) {
  if (error instanceof DeepResearchGateError) {
    return reply.code(422).send({ ok: false, message: error.message, failures: error.failures });
  }
  if (error instanceof IdempotencyConflictError || error instanceof CandidateMembershipConflictError
    || error instanceof CandidateMembershipNotFoundError || error instanceof CandidateMembershipVersionConflictError) {
    return reply.code(409).send({ ok: false, message: error.message });
  }
  return reply.code(503).send({ ok: false, message: fallback });
}
