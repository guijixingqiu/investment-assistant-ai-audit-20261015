import type {Pool} from "pg";
import type {AuthenticatedResearchActor} from "./domain.js";
import {readCandidateMembershipById} from "./candidateMembershipPersistence.js";
import {ResearchContextError,readResearchContextSnapshot} from "./researchContextRepository.js";
import {readDeepResearchWorkspace} from "./deepResearchReadRepository.js";
import {readResearchUnderwriting} from "./researchUnderwritingRepository.js";
import {operatingModelFingerprint} from "../../../../packages/contracts/src/researchOperatingModel.js";
import {projectThesisFormation} from "../../../../packages/contracts/src/thesisFormation.js";
import {projectCurrentBaseFormation,unavailableCurrentBaseFormation,type CurrentBaseFormationProjection} from "../../../../packages/contracts/src/currentBaseFormation.js";
import type {ScenarioPeriodType} from "../../../../packages/contracts/src/researchUnderwriting.js";
import type {SourceSnapshotStoreOptions} from "./researchSourceSnapshotRepository.js";

type FormationScope={actorScope:{actorType:string;actorId:string};symbol:string;membershipId:string;membershipVersion:number};
function requireWorkspaceScope(workspace:Awaited<ReturnType<typeof readDeepResearchWorkspace>>,context:Awaited<ReturnType<typeof readResearchContextSnapshot>>,scope:FormationScope,id:string):NonNullable<typeof workspace.data>{
 if(workspace.status!=="available"||!workspace.data||workspace.data.target.symbol!==scope.symbol||workspace.data.target.membershipId!==id||workspace.data.target.membershipVersion!==scope.membershipVersion||context.status==="unavailable")
  throw new ResearchContextError(503,"CURRENT_BASE_FORMATION_DRIFT","workspace or Context identity unavailable");
 return workspace.data;
}
export async function readCurrentBaseFormation(pool:Pool,id:string,actor:AuthenticatedResearchActor,period:ScenarioPeriodType="CURRENT_FY",now=new Date(),sourceStore?:SourceSnapshotStoreOptions):Promise<CurrentBaseFormationProjection>{
 const client=await pool.connect();
 let scope:FormationScope|null=null;
 try{
  await client.query("begin isolation level repeatable read read only");
  const member=await readCandidateMembershipById(client,actor,id);
  if(!member||member.state!=="tracked")throw new ResearchContextError(409,"MEMBERSHIP_UNAVAILABLE","tracked membership required");
  scope={actorScope:{actorType:actor.actorType,actorId:actor.actorId},symbol:member.symbol,membershipId:id,membershipVersion:Number(member.version)};
  const workspace=await readDeepResearchWorkspace(client,id,actor,now,{accountScopeId:null,currentPortfolioEnabled:false,currentPortfolioMaxAgeSeconds:300,sourceStore});
  const context=await readResearchContextSnapshot(client,id,actor,now);
  const workspaceData=requireWorkspaceScope(workspace,context,scope,id);
  const thesis=projectThesisFormation(workspace,context.data?.id??null,context.data?.operatingModel??null,now,actor.actorType);
  if(thesis.status==="UNAVAILABLE"||thesis.symbol!==scope.symbol||thesis.membershipVersion!==scope.membershipVersion)throw new ResearchContextError(503,"CURRENT_BASE_FORMATION_DRIFT","formal Thesis identity unavailable");
  const reasoning=workspaceData.operatingReasoning??null;
  if(reasoning&&(reasoning.contextId!==(context.data?.id??null)||reasoning.symbol!==scope.symbol||reasoning.membershipId!==id||reasoning.membershipVersion!==scope.membershipVersion||operatingModelFingerprint(reasoning.model)!==operatingModelFingerprint(context.data?.operatingModel??null)))
   throw new ResearchContextError(503,"CURRENT_BASE_FORMATION_DRIFT","operating reasoning and Context disagree");
  let current=null,status:"NONE"|"COMPLETE"|"INCOMPLETE"|"REVIEW_REQUIRED"="NONE";
  if(thesis.status==="BOUND"){
   if(!reasoning)throw new ResearchContextError(503,"CURRENT_BASE_FORMATION_DRIFT","active Thesis lacks verified operating reasoning");
   const underwriting=await readResearchUnderwriting(client,id,actor,period,now,sourceStore);
   if(!("currentBaseStatus" in underwriting)||underwriting.symbol!==scope.symbol||underwriting.membershipId!==id||underwriting.membershipVersion!==scope.membershipVersion)
    throw new ResearchContextError(503,"CURRENT_BASE_FORMATION_DRIFT","underwriting identity unavailable");
   current=underwriting.currentBase;status=underwriting.currentBaseStatus;
   if(current&&(current.scenarioPeriodType!==period||current.symbol!==scope.symbol||current.membershipId!==id||current.membershipVersion!==scope.membershipVersion))
    throw new ResearchContextError(503,"CURRENT_BASE_FORMATION_DRIFT","saved Base belongs to another period or identity");
  }
  const result=projectCurrentBaseFormation(thesis,reasoning,period,current,status,now);
  await client.query("commit");return result;
 }catch(error){
  await client.query("rollback");
  if(error instanceof ResearchContextError&&error.code==="MEMBERSHIP_UNAVAILABLE")throw error;
  if(!scope)throw error;
  return unavailableCurrentBaseFormation(scope,period,now);
 }finally{client.release();}
}
