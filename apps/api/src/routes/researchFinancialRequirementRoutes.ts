import type { FastifyInstance,FastifyReply } from "fastify";
import { validateCreateResearchFinancialRequirementRequest,validateResearchFinancialRequirementData,
 type CreateResearchFinancialRequirementRequest } from "../../../../packages/contracts/src/researchFinancialRequirement.js";
import { CandidateMembershipNotFoundError,IdempotencyConflictError,CandidateMembershipVersionConflictError,CandidateMembershipConflictError } from "../research/domain.js";
import { createResearchFinancialRequirement,readResearchFinancialRequirement,ResearchFinancialRequirementError } from "../research/researchFinancialRequirementRepository.js";
import { authenticateReadOnly,authenticateWrite } from "./researchAuth.js";
import { isCanonicalMembershipId } from "./researchRouteValidation.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";
export async function registerResearchFinancialRequirementRoutes(app:FastifyInstance,options:MobileResearchRouteOptions):Promise<void>{
 const path="/api/mobile/research/candidate-memberships/:id/financial-requirement";
 const store=()=>options.researchDocument?{repositoryRoot:options.researchDocument.repositoryRoot,rawStoreRoot:options.researchDocument.rawStoreRoot}:undefined;
 app.get(path,async(request,reply)=>{reply.header("cache-control","no-store");const actor=authenticateReadOnly(request.headers,options);
  if(!actor)return reply.code(401).send({ok:false,message:"read authorization required"});const id=(request.params as {id:string}).id;
  if(!isCanonicalMembershipId(id))return reply.code(400).send({ok:false,message:"invalid membership id"});
  try{const result=await readResearchFinancialRequirement(options.pool,id,actor,options.now?.(),store());
   if(result.status==="available"&&!validateResearchFinancialRequirementData(result.data))return reply.code(503).send({ok:false,message:"requirement response failed validation"});
   return reply.code(200).send(result);
  }catch(error){return failure(reply,error);}});
 app.post(path,async(request,reply)=>{reply.header("cache-control","no-store");const actor=authenticateWrite(request.headers,options,"research_write");
  if(!actor)return reply.code(401).send({ok:false,message:"research-write authorization required"});
  if(actor.actorType!=="user")return reply.code(403).send({ok:false,message:"explicit user actor required"});
  const id=(request.params as {id:string}).id;if(!isCanonicalMembershipId(id))return reply.code(400).send({ok:false,message:"invalid membership id"});
  const checked=validateCreateResearchFinancialRequirementRequest(request.body);
  if(!checked.ok)return reply.code(400).send({ok:false,errors:checked.errors});
  try{const write=await createResearchFinancialRequirement(options.pool,id,request.body as CreateResearchFinancialRequirementRequest,actor,options.now?.(),store());
   if(!validateResearchFinancialRequirementData(write.data))return reply.code(503).send({ok:false,message:"requirement write failed validation"});
   if(write.message.includes("replayed"))return write;
   const fresh=await readResearchFinancialRequirement(options.pool,id,actor,options.now?.(),store());
   if(fresh.status!=="available"||fresh.data?.id!==write.data.id)return reply.code(503).send({ok:false,message:"requirement exact readback failed"});
   return write;
  }catch(error){return failure(reply,error);}});
}
function failure(reply:FastifyReply,error:unknown){
 if(error instanceof ResearchFinancialRequirementError)return reply.code(error.statusCode).send({ok:false,code:error.code,message:error.message});
 if(error instanceof CandidateMembershipNotFoundError)return reply.code(404).send({ok:false,message:error.message});
 if(error instanceof IdempotencyConflictError||error instanceof CandidateMembershipVersionConflictError||error instanceof CandidateMembershipConflictError)return reply.code(409).send({ok:false,message:error.message});
 return reply.code(503).send({ok:false,message:"financial requirement repository unavailable"});
}
