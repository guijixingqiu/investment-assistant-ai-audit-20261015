import type { FastifyInstance } from "fastify";
import {
  validateCloudAiPolicyDecisionRequest,
  validateCloudAiPolicyEnvelope,
  type CloudAiPolicyDecisionRequest
} from "../../../../packages/contracts/src/cloudAiPolicy.js";
import {
  readCloudAiPolicyEnvelope,
  recordCloudAiPolicyDecision,
  unavailableCloudAiPolicyEnvelope
} from "../research/cloudAiPolicyRepository.js";
import { IdempotencyConflictError } from "../research/domain.js";
import { authenticateReadOnly, authenticateWrite } from "./researchAuth.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";

export async function registerCloudAiPolicyRoutes(app: FastifyInstance, options: MobileResearchRouteOptions): Promise<void> {
  app.get("/api/mobile/research/cloud-ai-policy", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const now = options.now?.() ?? new Date();
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send(unavailableCloudAiPolicyEnvelope("unauthorized", "unauthorized", "read authorization required", now));
    try {
      const envelope = await readCloudAiPolicyEnvelope(options.pool, actor, now);
      return validateCloudAiPolicyEnvelope(envelope).ok
        ? envelope
        : reply.code(503).send(unavailableCloudAiPolicyEnvelope("unavailable", actor.actorId, "cloud AI policy failed contract validation", now));
    } catch {
      return reply.code(503).send(unavailableCloudAiPolicyEnvelope("unavailable", actor.actorId, "cloud AI policy repository is unavailable", now));
    }
  });

  app.post("/api/mobile/research/cloud-ai-policy/decisions", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const now = options.now?.() ?? new Date();
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send(unavailableCloudAiPolicyEnvelope("unauthorized", "unauthorized", "research-write authorization required", now));
    if (actor.actorType !== "user") return reply.code(403).send(unavailableCloudAiPolicyEnvelope("unauthorized", actor.actorId, "an explicit user actor is required", now));
    const validation = validateCloudAiPolicyDecisionRequest(request.body);
    if (!validation.ok) return reply.code(400).send({ ok: false, errors: validation.errors });
    try {
      const envelope = await recordCloudAiPolicyDecision(options.pool, request.body as CloudAiPolicyDecisionRequest, actor, now);
      return validateCloudAiPolicyEnvelope(envelope).ok
        ? envelope
        : reply.code(503).send(unavailableCloudAiPolicyEnvelope("unavailable", actor.actorId, "cloud AI policy readback failed contract validation", now));
    } catch (error) {
      return error instanceof IdempotencyConflictError
        ? reply.code(409).send({ ok: false, message: error.message })
        : reply.code(503).send(unavailableCloudAiPolicyEnvelope("unavailable", actor.actorId, "cloud AI policy write is unavailable", now));
    }
  });
}
