import type { FastifyInstance } from "fastify";
import type { DecideAiSuggestionRequest } from "../../../../packages/contracts/src/research.js";
import { validateDecideAiSuggestionRequest } from "../../../../packages/contracts/src/research.js";
import {
  decideAiSuggestion,
  seedGateBResearchFixture
} from "../research/repository.js";
import { IdempotencyConflictError } from "../research/domain.js";
import { authenticateWrite } from "./researchAuth.js";
import {
  isCanonicalMembershipId,
  rejectClientControlledAuditFields,
  validateInternalSeedFixtureBody
} from "./researchRouteValidation.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";

export async function registerInternalResearchRoutes(
  app: FastifyInstance,
  options: MobileResearchRouteOptions
): Promise<void> {
  app.post("/api/internal/research/seed-fixture", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options);
    if (!actor) {
      await reply.code(401).send({ ok: false, message: "write authorization required" });
      return;
    }
    const bodyErrors = validateInternalSeedFixtureBody(request.body);
    if (bodyErrors.length > 0) {
      await reply.code(400).send({ ok: false, errors: bodyErrors });
      return;
    }
    try {
      return await seedGateBResearchFixture(options.pool, actor);
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        await reply.code(409).send({ ok: false, message: error.message });
        return;
      }
      await reply.code(503).send({ ok: false, message: "internal research fixture repository is unavailable" });
    }
  });

  app.post("/api/internal/research/suggestions/:id/decision", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options);
    if (!actor) {
      await reply.code(401).send({ ok: false, message: "write authorization required" });
      return;
    }
    const params = request.params as { id: string };
    if (!isCanonicalMembershipId(params.id)) {
      await reply.code(400).send({ ok: false, message: "suggestion id must be a positive integer" });
      return;
    }
    const body = request.body as unknown;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      await reply.code(400).send({ ok: false, message: "request must be an object" });
      return;
    }
    const bodyRecord = body as Record<string, unknown>;
    const protectedFieldErrors = rejectClientControlledAuditFields(bodyRecord);
    if (protectedFieldErrors.length > 0) {
      await reply.code(400).send({ ok: false, errors: protectedFieldErrors });
      return;
    }
    if (bodyRecord.action !== "accepted" && bodyRecord.action !== "rejected") {
      await reply.code(400).send({ ok: false, message: "action must be accepted or rejected" });
      return;
    }
    if (bodyRecord.note !== undefined && bodyRecord.note !== null && typeof bodyRecord.note !== "string") {
      await reply.code(400).send({ ok: false, message: "note must be null or a string" });
      return;
    }
    const validation = validateDecideAiSuggestionRequest(bodyRecord);
    if (!validation.ok) {
      const [message] = validation.errors;
      await reply.code(400).send(validation.errors.length === 1
        ? { ok: false, message }
        : { ok: false, errors: validation.errors });
      return;
    }

    try {
      const decision = await decideAiSuggestion(
        options.pool,
        params.id,
        bodyRecord as unknown as DecideAiSuggestionRequest,
        actor
      );
      if (!decision) {
        await reply.code(404).send({ ok: false, message: "pending suggestion not found" });
        return;
      }
      return {
        ok: true,
        suggestion: decision.suggestion,
        source: decision.source,
        audit: {
          decisionId: decision.decisionId,
          idempotencyKey: decision.idempotencyKey,
          correlationId: decision.source.correlationId,
          replayed: decision.replayed
        },
        message: "AI suggestion decision recorded. The current thesis was not auto-modified."
      };
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        await reply.code(409).send({ ok: false, message: error.message });
        return;
      }
      await reply.code(503).send({ ok: false, message: "internal research suggestion decision repository is unavailable" });
    }
  });
}
