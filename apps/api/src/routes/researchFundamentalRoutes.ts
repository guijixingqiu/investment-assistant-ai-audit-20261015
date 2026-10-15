import {appendAssertionLifecycle} from "../research/researchAssertionLifecycle.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import {
  type CreateResearchFundamentalValueRequest,
  validateCreateResearchFundamentalValueRequest
} from "../../../../packages/contracts/src/researchFundamentals.js";
import {
  CandidateMembershipConflictError,
  CandidateMembershipNotFoundError,
  CandidateMembershipVersionConflictError,
  IdempotencyConflictError,
  ResearchFundamentalError
} from "../research/domain.js";
import { readResearchFundamentals } from "../research/researchFundamentalRepository.js";
import { createResearchFundamentalValue } from "../research/researchFundamentalWriteRepository.js";
import { authenticateReadOnly, authenticateWrite, type ResearchAuthOptions } from "./researchAuth.js";
import { isCanonicalMembershipId, rejectClientControlledAuditFields } from "./researchRouteValidation.js";

interface ResearchFundamentalRouteOptions extends ResearchAuthOptions {
  pool: Pool;
  now?: () => Date;
  researchDocument?: {repositoryRoot:string;rawStoreRoot?:string|null};
}

export async function registerResearchFundamentalRoutes(
  app: FastifyInstance,
  options: ResearchFundamentalRouteOptions
): Promise<void> {
  app.get("/api/mobile/research/candidate-memberships/:id/fundamentals", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send({ ok: false, message: "read authorization required" });
    const id = (request.params as { id: string }).id;
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    try {
      return await readResearchFundamentals(options.pool, id, actor, options.now?.(), undefined,
        options.researchDocument ? {...options.researchDocument,availabilityCache:new Map()} : undefined);
    } catch (error) {
      return fundamentalFailure(reply, error);
    }
  });

  app.post("/api/mobile/research/candidate-memberships/:id/fundamentals", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    if (actor.actorType !== "user") {
      return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required to transcribe issuer fundamentals" });
    }
    const id = (request.params as { id: string }).id;
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    const body = request.body as unknown;
    const validation = validateCreateResearchFundamentalValueRequest(body);
    const auditErrors = rejectClientControlledAuditFields(body);
    if (!validation.ok || auditErrors.length) {
      return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
    }
    try {
      return await createResearchFundamentalValue(
        options.pool,
        id,
        body as CreateResearchFundamentalValueRequest,
        actor,
        options.now?.(),
        options.researchDocument ? {...options.researchDocument,availabilityCache:new Map()} : undefined
      );
    } catch (error) {
      return fundamentalFailure(reply, error);
    }
  });
  app.post("/api/mobile/research/candidate-memberships/:id/fundamentals/lifecycle",async(request,reply)=>{
    const actor=authenticateWrite(request.headers,options,"research_write"),id=(request.params as {id:string}).id;
    if(!actor||actor.actorType!=="user")return reply.code(401).send({ok:false,message:"explicit user write authorization required"});
    if(!isCanonicalMembershipId(id))return reply.code(400).send({ok:false,message:"invalid membership"});
    const body=request.body as Record<string,unknown>|null;
    if(!body||Object.keys(body).sort().join()!==["fundamentalValueId","membershipVersion","reason","sourceMaterialId","status"].sort().join()||typeof body.fundamentalValueId!=="string"||typeof body.reason!=="string"||!Number.isSafeInteger(body.membershipVersion)||!(["RETRACTED","INVALID"] as unknown[]).includes(body.status)||!(body.sourceMaterialId===null||typeof body.sourceMaterialId==="string"))return reply.code(422).send({ok:false,code:"INVALID_LIFECYCLE_REQUEST"});
    try{return await appendAssertionLifecycle(options.pool,id,actor,body as unknown as import("../research/researchAssertionLifecycle.js").AssertionLifecycleRequest,options.now?.());}catch(error){return reply.code(422).send({ok:false,code:"LIFECYCLE_REVIEW_REQUIRED",message:error instanceof Error?error.message:String(error)});}
  });

}

function fundamentalFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof ResearchFundamentalError) {
    return reply.code(error.statusCode).send({ ok: false, code: error.code, message: error.message });
  }
  if (error instanceof CandidateMembershipNotFoundError) {
    return reply.code(404).send({ ok: false, message: error.message });
  }
  if (error instanceof IdempotencyConflictError
    || error instanceof CandidateMembershipConflictError
    || error instanceof CandidateMembershipVersionConflictError) {
    return reply.code(409).send({ ok: false, message: error.message });
  }
  return reply.code(503).send({ ok: false, message: "research fundamentals repository is unavailable" });
}
