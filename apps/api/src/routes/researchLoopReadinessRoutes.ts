import type {FastifyInstance} from "fastify";
import {validateResearchLoopReadiness} from "../../../../packages/contracts/src/researchLoopReadiness.js";
import type {ScenarioPeriodType} from "../../../../packages/contracts/src/researchUnderwriting.js";
import {ResearchContextError} from "../research/researchContextRepository.js";
import {readResearchLoopReadiness} from "../research/researchLoopReadinessRepository.js";
import {authenticateReadOnly} from "./researchAuth.js";
import {isCanonicalMembershipId} from "./researchRouteValidation.js";
import type {MobileResearchRouteOptions} from "./mobileResearch.js";

export async function registerResearchLoopReadinessRoutes(app:FastifyInstance,options:MobileResearchRouteOptions):Promise<void>{
 app.get("/api/mobile/research/:membershipId/loop-readiness",async(request,reply)=>{
  reply.header("cache-control","no-store");
  const actor=authenticateReadOnly(request.headers,options);
  if(!actor)return reply.code(401).send({ok:false,message:"read authorization required"});
  const id=(request.params as {membershipId:string}).membershipId;
  const period=(request.query as {scenarioPeriodType?:string}).scenarioPeriodType??"CURRENT_FY";
  if(!isCanonicalMembershipId(id)||!["CURRENT_FY","NEXT_REPORTING_PERIOD"].includes(period))return reply.code(400).send({ok:false,code:"INVALID_READINESS_SCOPE"});
  try{
   const sourceStore=options.researchDocument?{repositoryRoot:options.researchDocument.repositoryRoot,
    rawStoreRoot:options.researchDocument.rawStoreRoot,availabilityCache:new Map()}:undefined;
   const projection=await readResearchLoopReadiness(options.pool,id,actor,period as ScenarioPeriodType,options.now?.()??new Date(),sourceStore);
   if(!validateResearchLoopReadiness(projection))return reply.code(503).send({ok:false,message:"Research Loop Readiness failed validation"});
   return projection;
  }catch(error){
   if(error instanceof ResearchContextError)return reply.code(error.statusCode).send({ok:false,code:error.code,message:error.message});
   return reply.code(503).send({ok:false,message:"Research Loop Readiness unavailable"});
  }
 });
}
