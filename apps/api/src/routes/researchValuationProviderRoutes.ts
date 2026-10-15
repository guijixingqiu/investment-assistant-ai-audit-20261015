import type {FastifyInstance,FastifyReply} from "fastify";
import type {Pool} from "pg";
import type {FutuValuationProvider} from "../market/futuValuationProvider.js";
import {FutuValuationProviderError} from "../market/futuValuationProvider.js";
import {validCreateFutuValuationCaptureRequest} from "../../../../packages/contracts/src/researchValuationProvider.js";
import {captureFutuValuation,listFutuValuationCaptures,readFutuValuationOriginal} from "../research/researchValuationProviderRepository.js";
import {authenticateReadOnly,authenticateWrite,type ResearchAuthOptions} from "./researchAuth.js";
import {isCanonicalMembershipId} from "./researchRouteValidation.js";
import {CandidateMembershipNotFoundError,CandidateMembershipVersionConflictError,IdempotencyConflictError} from "../research/domain.js";

interface Options extends ResearchAuthOptions {
  pool:Pool;futuValuationProvider?:FutuValuationProvider|null;
  researchDocument?:{repositoryRoot:string;rawStoreRoot?:string|null};now?:()=>Date;
}
function failure(reply:FastifyReply,error:unknown){
  if(error instanceof CandidateMembershipNotFoundError)return reply.code(404).send({ok:false,code:"SOURCE_NOT_FOUND"});
  if(error instanceof CandidateMembershipVersionConflictError||error instanceof IdempotencyConflictError)
    return reply.code(409).send({ok:false,code:"SOURCE_CONFLICT",message:error.message});
  if(error instanceof FutuValuationProviderError)return reply.code(503).send({ok:false,code:error.code,message:error.message});
  return reply.code(503).send({ok:false,code:"VALUATION_SOURCE_UNAVAILABLE"});
}
export async function registerResearchValuationProviderRoutes(app:FastifyInstance,options:Options):Promise<void>{
  const base="/api/mobile/research/candidate-memberships/:id/futu-valuation-captures";
  const store={repositoryRoot:options.researchDocument?.repositoryRoot??"",rawStoreRoot:options.researchDocument?.rawStoreRoot};
  app.get(base,async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateReadOnly(request.headers,options),id=(request.params as {id:string}).id;
    if(!actor)return reply.code(401).send({ok:false,code:"READ_REQUIRED"});
    if(!isCanonicalMembershipId(id))return reply.code(400).send({ok:false,code:"INVALID_MEMBERSHIP"});
    try{return {ok:true,data:await listFutuValuationCaptures(options.pool,id,actor,store)};}
    catch(error){return failure(reply,error);}
  });
  app.post(base,async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateWrite(request.headers,options,"research_write"),id=(request.params as {id:string}).id;
    if(!actor||actor.actorType!=="user")return reply.code(401).send({ok:false,code:"USER_RESEARCH_WRITE_REQUIRED"});
    if(!isCanonicalMembershipId(id)||!validCreateFutuValuationCaptureRequest(request.body))
      return reply.code(422).send({ok:false,code:"INVALID_VALUATION_CAPTURE_REQUEST"});
    if(!options.futuValuationProvider||!options.researchDocument)
      return reply.code(503).send({ok:false,code:"FUTU_VALUATION_PROVIDER_UNAVAILABLE"});
    try{return {ok:true,data:await captureFutuValuation(options.pool,id,request.body,actor,
      options.futuValuationProvider,store,options.now?.())};}
    catch(error){return failure(reply,error);}
  });
  app.get(base+"/:captureId",async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateReadOnly(request.headers,options),{id,captureId}=request.params as {id:string;captureId:string};
    if(!actor)return reply.code(401).send({ok:false,code:"READ_REQUIRED"});
    if(!isCanonicalMembershipId(id)||!isCanonicalMembershipId(captureId))
      return reply.code(400).send({ok:false,code:"INVALID_CAPTURE_ID"});
    try{const original=await readFutuValuationOriginal(options.pool,id,captureId,actor,store);
      return {ok:true,capture:original.capture,data:original.data};}
    catch(error){return failure(reply,error);}
  });
}
