import type {FastifyInstance, FastifyReply} from "fastify";
import type {Pool} from "pg";
import {validCaptureFutuFinancialStatementsRequest,validCreateFutuFinancialMaterialRequest} from "../../../../packages/contracts/src/researchFutuFinancialStatement.js";
import type {FutuFinancialStatementsProvider} from "../market/futuFinancialStatementsProvider.js";
import {FutuFinancialCaptureError,captureFutuFinancialStatements,listFutuFinancialCaptures,
  readFutuFinancialCapture,readFutuFinancialOriginal,readFutuFinancialHistory,
  readFutuFinancialMaterialPreview,createFutuFinancialMaterial} from "../research/researchFutuFinancialStatementRepository.js";
import {CandidateMembershipNotFoundError,CandidateMembershipVersionConflictError,ResearchDocumentError,IdempotencyConflictError,DeepResearchGateError} from "../research/domain.js";
import {authenticateReadOnly,authenticateWrite,type ResearchAuthOptions} from "./researchAuth.js";
import type {ResearchDocumentRuntimeOptions} from "./researchDocumentRoutes.js";
import {isCanonicalMembershipId} from "./researchRouteValidation.js";

interface Options extends ResearchAuthOptions {
  pool:Pool;
  futuFinancialStatementsProvider?:FutuFinancialStatementsProvider|null;
  researchDocument?:ResearchDocumentRuntimeOptions;
  now?:()=>Date;
}

function fail(reply:FastifyReply,error:unknown){
  if(error instanceof IdempotencyConflictError)return reply.code(409).send({ok:false,code:"IDEMPOTENCY_CONFLICT",message:error.message});
  if(error instanceof DeepResearchGateError)return reply.code(409).send({ok:false,code:"MATERIAL_BINDING_INVALID",message:error.message});
  if(error instanceof FutuFinancialCaptureError)return reply.code(error.statusCode).send({ok:false,code:error.code,message:error.message});
  if(error instanceof ResearchDocumentError)return reply.code(error.statusCode).send({ok:false,code:error.code,message:error.message});
  if(error instanceof CandidateMembershipNotFoundError)return reply.code(404).send({ok:false,code:"MEMBERSHIP_NOT_FOUND"});
  if(error instanceof CandidateMembershipVersionConflictError)return reply.code(409).send({ok:false,code:"MEMBERSHIP_VERSION_DRIFT"});
  return reply.code(503).send({ok:false,code:"FUTU_FINANCIAL_CAPTURE_UNAVAILABLE"});
}

export async function registerResearchFutuFinancialStatementRoutes(app:FastifyInstance,options:Options):Promise<void>{
  const base="/api/mobile/research/candidate-memberships/:id/futu-financial-statement-captures";
  const store={repositoryRoot:options.researchDocument?.repositoryRoot??"",rawStoreRoot:options.researchDocument?.rawStoreRoot};
  app.post(base,async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateWrite(request.headers,options,"research_write"),id=(request.params as {id:string}).id;
    if(!actor||actor.actorType!=="user")return reply.code(401).send({ok:false,code:"USER_RESEARCH_WRITE_REQUIRED"});
    if(!isCanonicalMembershipId(id))return reply.code(400).send({ok:false,code:"INVALID_MEMBERSHIP"});
    if(!validCaptureFutuFinancialStatementsRequest(request.body))return reply.code(422).send({ok:false,code:"INVALID_CAPTURE_REQUEST"});
    if(!options.futuFinancialStatementsProvider||!options.researchDocument)return reply.code(503).send({ok:false,code:"FUTU_PROVIDER_UNAVAILABLE"});
    try{return {ok:true,data:await captureFutuFinancialStatements(options.pool,id,request.body,actor,
      options.futuFinancialStatementsProvider,store,options.now?.())};}
    catch(error){return fail(reply,error);}
  });
  app.get(base,async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateReadOnly(request.headers,options),id=(request.params as {id:string}).id;
    if(!actor)return reply.code(401).send({ok:false,code:"READ_REQUIRED"});
    if(!isCanonicalMembershipId(id))return reply.code(400).send({ok:false,code:"INVALID_MEMBERSHIP"});
    try{return {ok:true,data:await listFutuFinancialCaptures(options.pool,id,actor,store)};}
    catch(error){return fail(reply,error);}
  });
  app.get(base+"/history",async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateReadOnly(request.headers,options),id=(request.params as {id:string}).id;
    if(!actor)return reply.code(401).send({ok:false,code:"READ_REQUIRED"});
    if(!isCanonicalMembershipId(id))return reply.code(400).send({ok:false,code:"INVALID_MEMBERSHIP"});
    try{return {ok:true,data:await readFutuFinancialHistory(options.pool,id,actor,store)};}
    catch(error){return fail(reply,error);}
  });
  app.get(base+"/:captureId/material-preview",async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateReadOnly(request.headers,options),{id,captureId}=request.params as {id:string;captureId:string};
    const {financialType,periodEnd}=request.query as {financialType:string;periodEnd:string};
    if(!actor)return reply.code(401).send({ok:false,code:"READ_REQUIRED"});
    if(![id,captureId].every(isCanonicalMembershipId)||!["ANNUAL","Q6"].includes(financialType)
      ||!/^20\d{2}-\d{2}-\d{2}$/.test(periodEnd??""))return reply.code(422).send({ok:false,code:"INVALID_PERIOD_SELECTION"});
    try{return {ok:true,data:await readFutuFinancialMaterialPreview(options.pool,id,captureId,
      financialType as "ANNUAL"|"Q6",periodEnd,actor,store,options.now?.())};}
    catch(error){return fail(reply,error);}
  });
  app.post(base+"/:captureId/materials",async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateWrite(request.headers,options,"research_write"),{id,captureId}=request.params as {id:string;captureId:string};
    if(!actor||actor.actorType!=="user")return reply.code(401).send({ok:false,code:"USER_RESEARCH_WRITE_REQUIRED"});
    if(![id,captureId].every(isCanonicalMembershipId)||!validCreateFutuFinancialMaterialRequest(request.body))
      return reply.code(422).send({ok:false,code:"INVALID_MATERIAL_SELECTION"});
    try{return {ok:true,...await createFutuFinancialMaterial(options.pool,id,captureId,request.body,actor,store,options.now?.())};}
    catch(error){return fail(reply,error);}
  });
  app.get(base+"/:captureId",async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateReadOnly(request.headers,options),{id,captureId}=request.params as {id:string;captureId:string};
    if(!actor)return reply.code(401).send({ok:false,code:"READ_REQUIRED"});
    if(!isCanonicalMembershipId(id)||!isCanonicalMembershipId(captureId))return reply.code(400).send({ok:false,code:"INVALID_CAPTURE_ID"});
    try{return {ok:true,data:await readFutuFinancialCapture(options.pool,id,captureId,actor,store)};}
    catch(error){return fail(reply,error);}
  });
  app.get(base+"/:captureId/pages/:pageId",async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateReadOnly(request.headers,options),{id,captureId,pageId}=request.params as {id:string;captureId:string;pageId:string};
    if(!actor)return reply.code(401).send({ok:false,code:"READ_REQUIRED"});
    if(![id,captureId,pageId].every(isCanonicalMembershipId))return reply.code(400).send({ok:false,code:"INVALID_PAGE_ID"});
    try{
      const original=await readFutuFinancialOriginal(options.pool,id,captureId,pageId,actor,store);
      return {ok:true,page:original.page,data:JSON.parse(original.bytes.toString("utf8"))};
    }catch(error){return fail(reply,error);}
  });
  app.get(base+"/:captureId/pages/:pageId/content",async(request,reply)=>{
    reply.header("cache-control","no-store");
    const actor=authenticateReadOnly(request.headers,options),{id,captureId,pageId}=request.params as {id:string;captureId:string;pageId:string};
    if(!actor)return reply.code(401).send({ok:false,code:"READ_REQUIRED"});
    if(![id,captureId,pageId].every(isCanonicalMembershipId))return reply.code(400).send({ok:false,code:"INVALID_PAGE_ID"});
    try{
      const original=await readFutuFinancialOriginal(options.pool,id,captureId,pageId,actor,store);
      return reply.header("content-type","application/octet-stream")
        .header("content-disposition",`attachment; filename="futu-financial-page-${pageId}.json"`)
        .header("x-content-type-options","nosniff")
        .header("x-source-raw-sha256",original.page.rawSha256).send(original.bytes);
    }catch(error){return fail(reply,error);}
  });
}
