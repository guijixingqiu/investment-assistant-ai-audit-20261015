import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import {
  type CreateResearchValuationScenarioRequest,
  validateCreateResearchValuationScenarioRequest,
  validateResearchValuationScenariosEnvelope
} from "../../../../packages/contracts/src/researchValuationScenarios.js";
import {
  CandidateMembershipConflictError,
  CandidateMembershipNotFoundError,
  CandidateMembershipVersionConflictError,
  IdempotencyConflictError,
  ResearchValuationScenarioError
} from "../research/domain.js";
import { readResearchValuationScenarios } from "../research/researchValuationScenarioRepository.js";
import { readIssuerNavBasisPreview } from "../research/researchValuationIssuerBasis.js";
import { createResearchValuationScenario } from "../research/researchValuationScenarioWriteRepository.js";
import {validCreateFutuProviderValuationScenarioRequest} from "../../../../packages/contracts/src/researchValuationProvider.js";
import {readFutuProviderValuationPreview} from "../research/researchValuationProviderBasis.js";
import { fcffSourceSelectionErrors, fcffCreateRequestErrors,
  type CreateResearchFcffScenarioRequest,
  type FcffSourceSelection } from "../../../../packages/contracts/src/researchValuationFcff.js";
import { fcffProviderSelectionErrors, fcffProviderCreateRequestErrors,
  type FcffProviderSelection, type CreateResearchProviderFcffScenarioRequest }
  from "../../../../packages/contracts/src/researchValuationFcff.js";
import { readFcffSourcePreview } from "../research/researchValuationFcff.js";
import { readFcffProviderReference } from "../research/researchValuationFcffProviderReference.js";
import { createFcffScenario, createProviderFcffScenario } from "../research/researchValuationFcffScenarioRepository.js";
import {createProviderValuationScenario} from "../research/researchValuationProviderScenarioRepository.js";
import {FutuFinancialCaptureError} from "../research/researchFutuFinancialStatementRepository.js";
import { authenticateReadOnly, authenticateWrite, type ResearchAuthOptions } from "./researchAuth.js";
import { isCanonicalMembershipId, rejectClientControlledAuditFields } from "./researchRouteValidation.js";

interface ResearchValuationScenarioRouteOptions extends ResearchAuthOptions {
  pool: Pool;
  now?: () => Date;
  researchDocument?: {repositoryRoot:string;rawStoreRoot?:string|null};
}

export async function registerResearchValuationScenarioRoutes(
  app: FastifyInstance,
  options: ResearchValuationScenarioRouteOptions
): Promise<void> {
  const base="/api/mobile/research/candidate-memberships/:id/valuation-scenarios";
  const store={repositoryRoot:options.researchDocument?.repositoryRoot??"",rawStoreRoot:options.researchDocument?.rawStoreRoot};
  app.get(base + "/fcff-provider-reference", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor || actor.actorType !== "user") return reply.code(401).send({ok:false,code:"USER_READ_REQUIRED"});
    const id = (request.params as {id:string}).id;
    const query = request.query as Record<string,unknown>;
    if (!isCanonicalMembershipId(id) || Object.keys(query).join() !== "selection"
      || typeof query.selection !== "string" || query.selection.length > 3000)
      return reply.code(400).send({ok:false,code:"FCFF_PROVIDER_SELECTION_INVALID"});
    let selection: unknown;
    try { selection = JSON.parse(query.selection); }
    catch { return reply.code(400).send({ok:false,code:"FCFF_PROVIDER_SELECTION_INVALID"}); }
    if (fcffProviderSelectionErrors(selection).length)
      return reply.code(400).send({ok:false,code:"FCFF_PROVIDER_SELECTION_INVALID"});
    if (!options.researchDocument) return reply.code(503).send({ok:false,code:"SAVED_ORIGINAL_UNAVAILABLE"});
    try { return {ok:true,data:await readFcffProviderReference(options.pool,id,
      selection as FcffProviderSelection,actor,{...options.researchDocument,availabilityCache:new Map()},options.now?.())}; }
    catch(error) { return scenarioFailure(reply,error); }
  });
  app.get(base + "/fcff-source-preview", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor || actor.actorType !== "user") return reply.code(401).send({ ok: false, code: "USER_READ_REQUIRED" });
    const id = (request.params as { id: string }).id;
    const query = request.query as Record<string, unknown>;
    if (!isCanonicalMembershipId(id) || Object.keys(query).join() !== "selection"
      || typeof query.selection !== "string" || query.selection.length > 8000) {
      return reply.code(400).send({ ok: false, code: "FCFF_SOURCE_SELECTION_INVALID" });
    }
    let selection: unknown;
    try { selection = JSON.parse(query.selection); }
    catch { return reply.code(400).send({ ok: false, code: "FCFF_SOURCE_SELECTION_INVALID" }); }
    if (fcffSourceSelectionErrors(selection).length)
      return reply.code(400).send({ ok: false, code: "FCFF_SOURCE_SELECTION_INVALID" });
    try {
      return { ok: true, data: await readFcffSourcePreview(options.pool, id, selection as FcffSourceSelection, actor,
        options.now?.(), options.researchDocument ? { ...options.researchDocument, availabilityCache: new Map() } : undefined) };
    } catch (error) { return scenarioFailure(reply, error); }
  });
  app.post(base + "/fcff", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor || actor.actorType !== "user")
      return reply.code(401).send({ ok: false, code: "USER_RESEARCH_WRITE_REQUIRED" });
    const id = (request.params as { id: string }).id;
    if ((request.body as {basisKind?:unknown} | null)?.basisKind === "provider_fcff") {
      const errors = fcffProviderCreateRequestErrors(request.body);
      const auditErrors = rejectClientControlledAuditFields(request.body);
      if (!isCanonicalMembershipId(id) || errors.length || auditErrors.length)
        return reply.code(422).send({ok:false,code:"FCFF_PROVIDER_REQUEST_INVALID",errors:[...errors,...auditErrors]});
      try { return await createProviderFcffScenario(options.pool,id,
        request.body as CreateResearchProviderFcffScenarioRequest,actor,options.now?.(),
        options.researchDocument ? {...options.researchDocument,availabilityCache:new Map()} : undefined); }
      catch(error) { return scenarioFailure(reply,error); }
    }
    const errors = fcffCreateRequestErrors(request.body);
    const auditErrors = rejectClientControlledAuditFields(request.body);
    if (!isCanonicalMembershipId(id) || errors.length || auditErrors.length)
      return reply.code(422).send({ ok: false, code: "FCFF_REQUEST_INVALID", errors: [...errors, ...auditErrors] });
    try { return await createFcffScenario(options.pool, id, request.body as CreateResearchFcffScenarioRequest,
      actor, options.now?.(), options.researchDocument
        ? { ...options.researchDocument, availabilityCache: new Map() } : undefined); }
    catch (error) { return scenarioFailure(reply, error); }
  });
  app.get(base+"/provider-preview",async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateReadOnly(request.headers,options),id=(request.params as {id:string}).id;
    const query=request.query as Record<string,string>;
    if(!actor)return reply.code(401).send({ok:false,code:"READ_REQUIRED"});
    if(!isCanonicalMembershipId(id)||Object.keys(query).sort().join(",")!=="annualPeriodEnd,epsBasis,financialCaptureId,sourceMaterialId,valuationCaptureId"
      ||![query.financialCaptureId,query.sourceMaterialId,query.valuationCaptureId].every(isCanonicalMembershipId)
      ||!/^20\d{2}-12-31$/.test(query.annualPeriodEnd??"")||!["basic","diluted"].includes(query.epsBasis))
      return reply.code(422).send({ok:false,code:"INVALID_PROVIDER_SELECTION"});
    try{return {ok:true,data:await readFutuProviderValuationPreview(options.pool,id,
      query.financialCaptureId,query.annualPeriodEnd,query.epsBasis as "basic"|"diluted",
      query.valuationCaptureId,query.sourceMaterialId,actor,store)};}
    catch(error){return scenarioFailure(reply,error);}
  });
  app.get(base + "/issuer-basis", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor || actor.actorType !== "user") return reply.code(401).send({ ok: false, message: "user read authorization required" });
    const id = (request.params as { id: string }).id;
    const query = request.query as Record<string, string>;
    if (!isCanonicalMembershipId(id) || Object.keys(query).join() !== "anchorValueId"
      || !isCanonicalMembershipId(query.anchorValueId)) {
      return reply.code(400).send({ ok: false, message: "exact anchor value id is required" });
    }
    try {
      return await readIssuerNavBasisPreview(options.pool, id, query.anchorValueId, actor, options.now?.(),
        options.researchDocument ? { ...options.researchDocument, availabilityCache: new Map() } : undefined);
    } catch (error) {
      return scenarioFailure(reply, error);
    }
  });
  app.post(base+"/provider",async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateWrite(request.headers,options,"research_write"),id=(request.params as {id:string}).id;
    if(!actor||actor.actorType!=="user")return reply.code(401).send({ok:false,code:"USER_RESEARCH_WRITE_REQUIRED"});
    if(!isCanonicalMembershipId(id)||!validCreateFutuProviderValuationScenarioRequest(request.body))
      return reply.code(422).send({ok:false,code:"INVALID_PROVIDER_SCENARIO"});
    try{return await createProviderValuationScenario(options.pool,id,request.body,actor,store,options.now?.());}
    catch(error){return scenarioFailure(reply,error);}
  });
  app.get("/api/mobile/research/candidate-memberships/:id/valuation-scenarios", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send({ ok: false, message: "read authorization required" });
    const id = (request.params as { id: string }).id;
    if (!isCanonicalMembershipId(id)) {
      return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    }
    try {
      const envelope = await readResearchValuationScenarios(options.pool, id, actor, options.now?.(),
        options.researchDocument ? {...options.researchDocument,availabilityCache:new Map()} : undefined);
      if (!validateResearchValuationScenariosEnvelope(envelope).ok) {
        return reply.code(503).send({ ok: false, message: "valuation scenario read-back failed contract validation" });
      }
      return envelope;
    } catch (error) {
      return scenarioFailure(reply, error);
    }
  });

  app.post("/api/mobile/research/candidate-memberships/:id/valuation-scenarios", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    if (actor.actorType !== "user") {
      return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required to save Owner assumptions" });
    }
    const id = (request.params as { id: string }).id;
    if (!isCanonicalMembershipId(id)) {
      return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    }
    const body = request.body as unknown;
    const validation = validateCreateResearchValuationScenarioRequest(body);
    const auditErrors = rejectClientControlledAuditFields(body);
    if (!validation.ok || auditErrors.length) {
      return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
    }
    try {
      return await createResearchValuationScenario(
        options.pool,
        id,
        body as CreateResearchValuationScenarioRequest,
        actor,
        options.now?.(),
        options.researchDocument ? {...options.researchDocument,availabilityCache:new Map()} : undefined
      );
    } catch (error) {
      return scenarioFailure(reply, error);
    }
  });
}

function scenarioFailure(reply: FastifyReply, error: unknown) {
  if(error instanceof FutuFinancialCaptureError)return reply.code(error.statusCode).send({ok:false,code:error.code,message:error.message});
  if (error instanceof ResearchValuationScenarioError) {
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
  return reply.code(503).send({ ok: false, message: "research valuation scenario repository is unavailable" });
}
