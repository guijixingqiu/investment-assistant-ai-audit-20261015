import {readThesisFormation,confirmThesisFormation} from "../research/thesisFormationRepository.js";
import { readResearchQuestions,saveResearchQuestion } from "../research/researchQuestionRepository.js";
import { readDeepResearchWorkspace } from "../research/deepResearchReadRepository.js";
import { readResearchFundamentals } from "../research/researchFundamentalRepository.js";
import { buildOperatingReasoning } from "../research/researchOperatingReasoning.js";
import { validateOperatingModel, type OperatingResearchModel } from "../../../../packages/contracts/src/researchOperatingModel.js";
import { sameThesisIdentity, reasoningFingerprint } from "../../../../packages/contracts/src/researchOperatingReasoning.js";
import { saveOperatingModel } from "../research/researchOperatingModelRepository.js";
import {readResearchUnderwriting,saveCurrentBaseVersion,saveResearchBaseline,saveThesisOwnerAction} from "../research/researchUnderwritingRepository.js";
import {readCurrentBaseFormation} from "../research/currentBaseFormationRepository.js";
import {readResearchBaselineConfirmation} from "../research/researchBaselineConfirmationRepository.js";
import {readResearchReview,createResearchMilestone,completeResearchReview} from "../research/researchReviewRepository.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  type CreateResearchContextRequest,
  validateCreateResearchContextRequest,
  validateResearchContextEnvelope,
  validateResearchContextSnapshotData
} from "../../../../packages/contracts/src/researchContext.js";
import {
  CandidateMembershipConflictError,
  CandidateMembershipNotFoundError,
  CandidateMembershipVersionConflictError,
  IdempotencyConflictError
} from "../research/domain.js";
import {
  createResearchContextSnapshot,
  readResearchContextSnapshot,
  ResearchContextError
} from "../research/researchContextRepository.js";
import { authenticateReadOnly, authenticateWrite } from "./researchAuth.js";
import { isCanonicalMembershipId } from "./researchRouteValidation.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";

function sourceStoreForRequest(options:MobileResearchRouteOptions){
  return options.researchDocument?{repositoryRoot:options.researchDocument.repositoryRoot,
    rawStoreRoot:options.researchDocument.rawStoreRoot,availabilityCache:new Map()}:undefined;
}
function sourceReadOptions(options:MobileResearchRouteOptions){return {accountScopeId:null,
  currentPortfolioEnabled:false,currentPortfolioMaxAgeSeconds:300,sourceStore:sourceStoreForRequest(options)};}

export async function registerResearchContextRoutes(app: FastifyInstance, options: MobileResearchRouteOptions): Promise<void> {
  const thesisFormation="/api/mobile/research/candidate-memberships/:id/thesis-formation";
  app.get(thesisFormation,async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateReadOnly(request.headers,options),id=(request.params as {id:string}).id;
    if(!actor)return reply.code(401).send({ok:false,message:"read authorization required"});
    if(!isCanonicalMembershipId(id))return reply.code(400).send({ok:false,code:"INVALID_THESIS_FORMATION_SCOPE"});
    try{return await readThesisFormation(options.pool,id,actor,options.now?.(),sourceStoreForRequest(options));}catch(error){return contextFailure(reply,error);}
  });
  app.post(thesisFormation+"/confirm",async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateWrite(request.headers,options,"research_write"),id=(request.params as {id:string}).id;
    if(!actor||actor.actorType!=="user")return reply.code(401).send({ok:false,message:"explicit Owner research authorization required"});
    if(!isCanonicalMembershipId(id))return reply.code(400).send({ok:false,code:"INVALID_THESIS_FORMATION_SCOPE"});
    try{return await confirmThesisFormation(options.pool,id,actor,request.body,options.now?.(),sourceStoreForRequest(options));}catch(error){return contextFailure(reply,error);}
  });
  const underwriting="/api/mobile/research/candidate-memberships/:id/research-underwriting";
  app.get("/api/mobile/research/candidate-memberships/:id/current-base-formation",async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateReadOnly(request.headers,options),id=(request.params as {id:string}).id,type=(request.query as {periodType?:string}).periodType??"CURRENT_FY";
    if(!actor)return reply.code(401).send({ok:false,message:"read authorization required"});
    if(!isCanonicalMembershipId(id)||!["CURRENT_FY","NEXT_REPORTING_PERIOD"].includes(type))return reply.code(400).send({ok:false,code:"INVALID_CURRENT_BASE_FORMATION_SCOPE"});
    try{return await readCurrentBaseFormation(options.pool,id,actor,type as "CURRENT_FY"|"NEXT_REPORTING_PERIOD",options.now?.(),sourceStoreForRequest(options));}catch(error){return contextFailure(reply,error);}
  });
  app.get(underwriting,async(request,reply)=>{
    const actor=authenticateReadOnly(request.headers,options),id=(request.params as {id:string}).id,type=(request.query as {periodType?:string}).periodType??"CURRENT_FY";
    if(!actor)return reply.code(401).send({ok:false,message:"read authorization required"});
    if(!isCanonicalMembershipId(id)||!["CURRENT_FY","NEXT_REPORTING_PERIOD"].includes(type))return reply.code(400).send({ok:false,code:"INVALID_UNDERWRITING_SCOPE"});
    try{return await readResearchUnderwriting(options.pool,id,actor,type as "CURRENT_FY"|"NEXT_REPORTING_PERIOD",options.now?.(),sourceStoreForRequest(options));}catch(error){return contextFailure(reply,error);}
  });
  app.get("/api/mobile/research/candidate-memberships/:id/research-baseline-confirmation",async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateReadOnly(request.headers,options),id=(request.params as {id:string}).id,type=(request.query as {periodType?:string}).periodType??"CURRENT_FY";
    if(!actor)return reply.code(401).send({ok:false,message:"read authorization required"});
    if(!isCanonicalMembershipId(id)||!["CURRENT_FY","NEXT_REPORTING_PERIOD"].includes(type))return reply.code(400).send({ok:false,code:"INVALID_BASELINE_CONFIRMATION_SCOPE"});
    try{return await readResearchBaselineConfirmation(options.pool,id,actor,type as "CURRENT_FY"|"NEXT_REPORTING_PERIOD",options.now?.(),sourceStoreForRequest(options));}catch(error){return contextFailure(reply,error);}
  });
  for(const [suffix,write] of [["/base-versions",saveCurrentBaseVersion],["/baselines",saveResearchBaseline],["/thesis-actions",saveThesisOwnerAction]] as const){
    app.post(underwriting+suffix,async(request,reply)=>{
      const actor=authenticateWrite(request.headers,options,"research_write"),id=(request.params as {id:string}).id;
      if(!actor||actor.actorType!=="user")return reply.code(401).send({ok:false,message:"explicit user research authorization required"});
      if(!isCanonicalMembershipId(id))return reply.code(400).send({ok:false,code:"INVALID_UNDERWRITING_SCOPE"});
      try{return await write(options.pool,id,actor,request.body,options.now?.(),sourceStoreForRequest(options));}catch(error){return contextFailure(reply,error);}
    });
  }
  const reviewPath="/api/mobile/research/candidate-memberships/:id/research-review";
  app.get(reviewPath,async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateReadOnly(request.headers,options),id=(request.params as {id:string}).id,type=(request.query as {periodType?:string}).periodType??"CURRENT_FY";
    if(!actor)return reply.code(401).send({ok:false,message:"read authorization required"});
    if(!isCanonicalMembershipId(id)||!["CURRENT_FY","NEXT_REPORTING_PERIOD"].includes(type))return reply.code(400).send({ok:false,code:"INVALID_REVIEW_SCOPE"});
    try{return await readResearchReview(options.pool,id,actor,options.now?.(),type as "CURRENT_FY"|"NEXT_REPORTING_PERIOD",false,sourceStoreForRequest(options));}catch(error){return contextFailure(reply,error);}
  });
  for(const [suffix,write] of [["/milestones",createResearchMilestone],["/complete",completeResearchReview]] as const){
    app.post(reviewPath+suffix,async(request,reply)=>{
      reply.header("cache-control","no-store");
      const actor=authenticateWrite(request.headers,options,"research_write"),id=(request.params as {id:string}).id;
      if(!actor||actor.actorType!=="user")return reply.code(401).send({ok:false,message:"explicit Owner research authorization required"});
      if(!isCanonicalMembershipId(id))return reply.code(400).send({ok:false,code:"INVALID_REVIEW_SCOPE"});
      try{return await write(options.pool,id,actor,request.body,options.now?.(),sourceStoreForRequest(options));}catch(error){return contextFailure(reply,error);}
    });
  }
  app.get("/api/mobile/research/candidate-memberships/:id/research-questions",async(request,reply)=>{
    const actor=authenticateReadOnly(request.headers,options),id=(request.params as {id:string}).id;
    if(!actor)return reply.code(401).send({ok:false,message:"read authorization required"});
    if(!isCanonicalMembershipId(id))return reply.code(400).send({ok:false,message:"invalid membership"});
    try{return await readResearchQuestions(options.pool,id,actor,options.now?.(),sourceStoreForRequest(options));}catch(error){return contextFailure(reply,error);}
  });
  app.post("/api/mobile/research/candidate-memberships/:id/research-questions",async(request,reply)=>{
    const actor=authenticateWrite(request.headers,options,"research_write"),id=(request.params as {id:string}).id;
    if(!actor||actor.actorType!=="user")return reply.code(401).send({ok:false,message:"user research authorization required"});
    if(!isCanonicalMembershipId(id))return reply.code(400).send({ok:false,message:"invalid membership"});
    try{return await saveResearchQuestion(options.pool,id,request.body,actor,options.now?.(),sourceStoreForRequest(options));}catch(error){return contextFailure(reply,error);}
  });
  app.post("/api/mobile/research/candidate-memberships/:id/research-context/operating-preview", async (request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateReadOnly(request.headers,options),id=(request.params as {id:string}).id;
    if(!actor)return reply.code(401).send({ok:false,message:"read authorization required"});
    if(!isCanonicalMembershipId(id))return reply.code(400).send({ok:false,message:"invalid membership"});
    const body=request.body as {operatingModel?:OperatingResearchModel;inputFingerprint?:string};
    if(!body||!validateOperatingModel(body.operatingModel).ok)return reply.code(400).send({ok:false,message:"invalid preview model"});
    try {
      const now=options.now?.()??new Date(),readOptions=sourceReadOptions(options),w=await readDeepResearchWorkspace(options.pool,id,actor,now,readOptions),current=w.data?.operatingReasoning;
      if(!current||current.contextId!==body.inputFingerprint)return reply.code(409).send({ok:false,message:"research identity changed; reload before preview"});
      const model=body.operatingModel!,binding=model.thesisBinding;
      if(binding&&!current.thesisOptions.some(option=>sameThesisIdentity(option,binding)))return reply.code(409).send({ok:false,message:"explicit Thesis binding drift"});
      const context=await readResearchContextSnapshot(options.pool,id,actor,now);
      if(!context.data)return reply.code(409).send({ok:false,message:"initialize a research context before preview"});
      const facts=await readResearchFundamentals(options.pool,id,actor,now,undefined,readOptions.sourceStore);
      const value=buildOperatingReasoning(w,facts,{...context,data:{...context.data,operatingModel:model}},current.reverseValuation.observed);
      if(!value)return reply.code(422).send({ok:false,message:"preview evidence validation failed"});
      value.factCandidates=current.factCandidates;value.inputFingerprint=reasoningFingerprint(value);
      return {previewOnly:true,baseFingerprint:body.inputFingerprint,operatingReasoning:value};
    }catch(error){return contextFailure(reply,error);}
  });
  app.post("/api/mobile/research/candidate-memberships/:id/research-context/operating-model", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor || actor.actorType !== "user") return reply.code(401).send({ ok: false, message: "explicit Owner research-write authorization required" });
    const id = (request.params as {id:string}).id;
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ok:false,message:"invalid membership"});
    try { return await saveOperatingModel(options.pool, id, request.body, actor, options.now?.(),"NONE",sourceStoreForRequest(options)); }
    catch (error) { return contextFailure(reply,error); }
  });
  app.get("/api/mobile/research/candidate-memberships/:id/research-context", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const now = options.now?.() ?? new Date();
    const id = (request.params as { id: string }).id;
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send({ ok: false, message: "read authorization required" });
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    try {
      const envelope = await readResearchContextSnapshot(options.pool, id, actor, now, sourceStoreForRequest(options));
      if (!validateResearchContextEnvelope(envelope).ok) return reply.code(503).send({ ok: false, message: "research context response failed contract validation" });
      return reply.code(envelope.status === "not_found" ? 404 : envelope.status === "unavailable" ? 503 : 200).send(envelope);
    } catch {
      return reply.code(503).send({ ok: false, message: "research context repository is unavailable" });
    }
  });

  app.post("/api/mobile/research/candidate-memberships/:id/research-context", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const id = (request.params as { id: string }).id;
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    if (actor.actorType !== "user") {
      return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required to create research context" });
    }
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    const body = request.body as unknown;
    const validation = validateCreateResearchContextRequest(body);
    if (!validation.ok) return reply.code(400).send({ ok: false, errors: validation.errors });
    try {
      const envelope = await createResearchContextSnapshot(options.pool, id, body as CreateResearchContextRequest, actor, options.now?.(),undefined,sourceStoreForRequest(options));
      if (!validateResearchContextSnapshotData(envelope.data).ok) return reply.code(503).send({ ok: false, message: "research context response failed contract validation" });
      return envelope;
    } catch (error) {
      return contextFailure(reply, error);
    }
  });
}

function contextFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof ResearchContextError) return reply.code(error.statusCode).send({ ok: false, code: error.code, message: error.message });
  if (error instanceof CandidateMembershipNotFoundError) return reply.code(404).send({ ok: false, message: error.message });
  if (error instanceof IdempotencyConflictError || error instanceof CandidateMembershipConflictError || error instanceof CandidateMembershipVersionConflictError) {
    return reply.code(409).send({ ok: false, message: error.message });
  }
  return reply.code(503).send({ ok: false, message: "research context repository is unavailable" });
}
