import type { FastifyInstance, FastifyReply } from "fastify";
import {
  validateAssetsAlphaEnvelope,
  validateAssetsAlphaSnapshotWriteResponse,
  validateAssetsAlphaTradeWriteResponse,
  validateCreateAssetsAlphaSnapshotRequest,
  validateCreateAssetsAlphaTradeRequest,
  type AssetsAlphaSnapshotWriteResponse,
  type AssetsAlphaTradeWriteResponse,
  type CreateAssetsAlphaSnapshotRequest,
  type CreateAssetsAlphaTradeRequest
} from "../../../../packages/contracts/src/assetsAlpha.js";
import {
  createAssetsAlphaSnapshot,
  createAssetsAlphaTrade,
  readAssetsAlphaEnvelope
} from "../assetsAlphaRepository.js";
import { IdempotencyConflictError } from "../research/domain.js";
import { authenticateReadOnly, authenticateWrite } from "./researchAuth.js";
import { rejectClientControlledAuditFields } from "./researchRouteValidation.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";

export async function registerAssetsAlphaRoutes(
  app: FastifyInstance,
  options: MobileResearchRouteOptions
): Promise<void> {
  app.get("/api/mobile/assets/alpha", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send({ ok: false, message: "read authorization required" });
    try {
      const envelope = await readAssetsAlphaEnvelope(options.pool, actor, options.now?.());
      if (!validateAssetsAlphaEnvelope(envelope).ok) {
        return reply.code(503).send({ ok: false, message: "Assets Alpha read-back failed contract validation" });
      }
      return envelope;
    } catch {
      return reply.code(503).send({ ok: false, message: "Assets Alpha repository is unavailable" });
    }
  });

  app.post("/api/mobile/assets/alpha/snapshots", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    if (actor.actorType !== "user") {
      return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required for Assets Alpha writes" });
    }
    const body = request.body as unknown;
    const validation = validateCreateAssetsAlphaSnapshotRequest(body);
    const auditErrors = rejectClientControlledAuditFields(body);
    if (!validation.ok || auditErrors.length) {
      return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
    }
    const now = options.now?.() ?? new Date();
    if (Date.parse((body as CreateAssetsAlphaSnapshotRequest).asOf) > now.getTime()) {
      return reply.code(400).send({ ok: false, message: "snapshot asOf cannot be in the future" });
    }
    try {
      const response = await createAssetsAlphaSnapshot(
        options.pool,
        body as CreateAssetsAlphaSnapshotRequest,
        actor,
        now
      );
      return checkedSnapshotWrite(reply, response);
    } catch (error) {
      return assetsAlphaFailure(reply, error);
    }
  });

  app.post("/api/mobile/assets/alpha/trades", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    if (actor.actorType !== "user") {
      return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required for Assets Alpha writes" });
    }
    const body = request.body as unknown;
    const validation = validateCreateAssetsAlphaTradeRequest(body);
    const auditErrors = rejectClientControlledAuditFields(body);
    if (!validation.ok || auditErrors.length) {
      return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
    }
    const now = options.now?.() ?? new Date();
    if (Date.parse((body as CreateAssetsAlphaTradeRequest).occurredAt) > now.getTime()) {
      return reply.code(400).send({ ok: false, message: "trade occurredAt cannot be in the future" });
    }
    try {
      const response = await createAssetsAlphaTrade(
        options.pool,
        body as CreateAssetsAlphaTradeRequest,
        actor,
        now
      );
      return checkedTradeWrite(reply, response);
    } catch (error) {
      return assetsAlphaFailure(reply, error);
    }
  });
}

function checkedSnapshotWrite(reply: FastifyReply, response: AssetsAlphaSnapshotWriteResponse) {
  if (!validateAssetsAlphaSnapshotWriteResponse(response).ok) {
    return reply.code(503).send({ ok: false, message: "Assets Alpha snapshot response failed contract validation" });
  }
  return response;
}

function checkedTradeWrite(reply: FastifyReply, response: AssetsAlphaTradeWriteResponse) {
  if (!validateAssetsAlphaTradeWriteResponse(response).ok) {
    return reply.code(503).send({ ok: false, message: "Assets Alpha trade response failed contract validation" });
  }
  return response;
}

function assetsAlphaFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof IdempotencyConflictError) {
    return reply.code(409).send({ ok: false, message: error.message });
  }
  if (error instanceof Error && error.message === "an explicit user actor is required") {
    return reply.code(403).send({ ok: false, message: error.message });
  }
  return reply.code(503).send({ ok: false, message: "Assets Alpha repository is unavailable" });
}
