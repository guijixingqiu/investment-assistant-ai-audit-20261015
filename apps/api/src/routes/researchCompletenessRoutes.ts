import type { FastifyInstance, FastifyReply } from "fastify";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import {
  validateCreateResearchCompletenessRequest,
  validateResearchCompletenessEnvelope,
  validateResearchCompletenessSnapshot,
  type CreateResearchCompletenessRequest
} from "../../../../packages/contracts/src/researchCompleteness.js";
import {
  createResearchCompletenessSnapshot,
  readResearchCompletenessSnapshot,
  ResearchCompletenessError
} from "../research/researchCompletenessRepository.js";
import {
  CandidateMembershipConflictError,
  CandidateMembershipNotFoundError,
  CandidateMembershipVersionConflictError,
  IdempotencyConflictError
} from "../research/domain.js";
import { authenticateReadOnly, authenticateWrite } from "./researchAuth.js";
import { isCanonicalMembershipId } from "./researchRouteValidation.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";

export async function registerResearchCompletenessRoutes(app: FastifyInstance, options: MobileResearchRouteOptions): Promise<void> {
  app.get("/api/mobile/research/candidate-memberships/:id/completeness", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send({ ok: false, message: "read authorization required" });
    const id = (request.params as { id: string }).id;
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    try {
      const sourceStore=options.researchDocument?{repositoryRoot:options.researchDocument.repositoryRoot,
        rawStoreRoot:options.researchDocument.rawStoreRoot,availabilityCache:new Map()}:undefined;
      const envelope = await readResearchCompletenessSnapshot(options.pool, id, actor, options.now?.(), options.quantEvidence ?? null,sourceStore);
      if (!validateResearchCompletenessEnvelope(envelope).ok) return reply.code(503).send({ ok: false, message: "research completeness response failed contract validation" });
      return reply.code(envelope.status === "not_found" ? 404 : envelope.status === "unavailable" ? 503 : 200).send(envelope);
    } catch { return reply.code(503).send({ ok: false, message: "research completeness repository is unavailable" }); }
  });

  app.post("/api/mobile/research/candidate-memberships/:id/completeness", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    if (actor.actorType !== "user") return reply.code(403).send({ ok: false, message: "an explicit user actor is required to record completeness" });
    const id = (request.params as { id: string }).id;
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    const validation = validateCreateResearchCompletenessRequest(request.body);
    if (!validation.ok) return reply.code(400).send({ ok: false, errors: validation.errors });
    try {
      const sourceStore=options.researchDocument?{repositoryRoot:options.researchDocument.repositoryRoot,
        rawStoreRoot:options.researchDocument.rawStoreRoot,availabilityCache:new Map()}:undefined;
      const write = await createResearchCompletenessSnapshot(options.pool, id, request.body as CreateResearchCompletenessRequest, actor, options.now?.(), options.quantEvidence ?? null,sourceStore);
      if (!validateResearchCompletenessSnapshot(write.data).ok) return reply.code(503).send({ ok: false, message: "research completeness write failed contract validation" });
      const fresh = await readResearchCompletenessSnapshot(options.pool, id, actor, options.now?.(), options.quantEvidence ?? null,sourceStore);
      if (fresh.status !== "available" || canonicalJson(fresh.data) !== canonicalJson(write.data)) {
        return reply.code(503).send({ ok: false, message: "research completeness exact readback failed" });
      }
      return fresh;
    } catch (error) { return completenessFailure(reply, error); }
  });
}

function completenessFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof ResearchCompletenessError) return reply.code(error.statusCode).send({ ok: false, code: error.code, message: error.message });
  if (error instanceof CandidateMembershipNotFoundError) return reply.code(404).send({ ok: false, message: error.message });
  if (error instanceof IdempotencyConflictError || error instanceof CandidateMembershipConflictError || error instanceof CandidateMembershipVersionConflictError) {
    return reply.code(409).send({ ok: false, message: error.message });
  }
  return reply.code(503).send({ ok: false, message: "research completeness repository is unavailable" });
}
