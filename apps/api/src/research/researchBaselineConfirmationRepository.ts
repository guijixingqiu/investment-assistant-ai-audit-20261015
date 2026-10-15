import type {Pool} from "pg";
import type {AuthenticatedResearchActor} from "./domain.js";
import {readCandidateMembershipById} from "./candidateMembershipPersistence.js";
import {ResearchContextError,readResearchContextSnapshot} from "./researchContextRepository.js";
import {readDeepResearchWorkspace} from "./deepResearchReadRepository.js";
import {readResearchUnderwriting} from "./researchUnderwritingRepository.js";
import {readResearchReviewForPeriod} from "./researchReviewRepository.js";
import {operatingModelFingerprint} from "../../../../packages/contracts/src/researchOperatingModel.js";
import {projectThesisFormation} from "../../../../packages/contracts/src/thesisFormation.js";
import {projectCurrentBaseFormation} from "../../../../packages/contracts/src/currentBaseFormation.js";
import {projectResearchBaselineConfirmation,unavailableResearchBaselineConfirmation,type ResearchBaselineConfirmationProjection} from "../../../../packages/contracts/src/researchBaselineConfirmation.js";
import type {ScenarioPeriodType} from "../../../../packages/contracts/src/researchUnderwriting.js";
import type {SourceSnapshotStoreOptions} from "./researchSourceSnapshotRepository.js";

type BaselineScope={actorScope:{actorType:string;actorId:string};symbol:string;membershipId:string;membershipVersion:number;scenarioPeriodType:ScenarioPeriodType};
function requireConsistentWorkspace(workspace:Awaited<ReturnType<typeof readDeepResearchWorkspace>>,context:Awaited<ReturnType<typeof readResearchContextSnapshot>>,scope:BaselineScope,id:string){
 if(workspace.status!=="available"||workspace.data?.target.symbol!==scope.symbol||workspace.data.target.membershipId!==id||workspace.data.target.membershipVersion!==scope.membershipVersion||context.status==="unavailable")throw new ResearchContextError(503,"BASELINE_READ_DRIFT","workspace or Context identity unavailable");
 const reasoning=workspace.data.operatingReasoning??null;
 if(reasoning&&(reasoning.contextId!==(context.data?.id??null)||reasoning.symbol!==scope.symbol||reasoning.membershipId!==id||reasoning.membershipVersion!==scope.membershipVersion||operatingModelFingerprint(reasoning.model)!==operatingModelFingerprint(context.data?.operatingModel??null)))throw new ResearchContextError(503,"BASELINE_READ_DRIFT","reasoning and Context disagree");
 return reasoning;
}
export async function readResearchBaselineConfirmation(pool:Pool,id:string,actor:AuthenticatedResearchActor,period:ScenarioPeriodType="CURRENT_FY",now=new Date(),sourceStore?:SourceSnapshotStoreOptions):Promise<ResearchBaselineConfirmationProjection>{
 const client=await pool.connect();
 let scope:BaselineScope|null=null;
 try{
  await client.query("begin isolation level repeatable read read only");
  const member=await readCandidateMembershipById(client,actor,id);
  if(!member||member.state!=="tracked")throw new ResearchContextError(409,"MEMBERSHIP_UNAVAILABLE","tracked membership required");
  scope={actorScope:{actorType:actor.actorType,actorId:actor.actorId},symbol:member.symbol,membershipId:id,membershipVersion:Number(member.version),scenarioPeriodType:period};
  const workspace=await readDeepResearchWorkspace(client,id,actor,now,{accountScopeId:null,currentPortfolioEnabled:false,currentPortfolioMaxAgeSeconds:300,sourceStore});
  const context=await readResearchContextSnapshot(client,id,actor,now);
  const reasoning=requireConsistentWorkspace(workspace,context,scope,id);
  const thesis=projectThesisFormation(workspace,context.data?.id??null,context.data?.operatingModel??null,now,actor.actorType);
  const underwriting=await readResearchUnderwriting(client,id,actor,period,now,sourceStore);
  const available="currentBaseStatus" in underwriting?underwriting:null;
  if(available&&(available.symbol!==scope.symbol||available.membershipId!==id||available.membershipVersion!==scope.membershipVersion))throw new ResearchContextError(503,"BASELINE_READ_DRIFT","underwriting belongs to another identity");
  const base=projectCurrentBaseFormation(thesis,reasoning,period,available?.currentBase??null,available?.currentBaseStatus??"NONE",now);
  const review=await readResearchReviewForPeriod(client,id,actor,period,now,sourceStore);
  if(review.symbol!==scope.symbol||review.membershipId!==id||review.membershipVersion!==scope.membershipVersion||review.scenarioPeriodType!==period)throw new ResearchContextError(503,"BASELINE_READ_DRIFT","review belongs to another identity");
  const result=projectResearchBaselineConfirmation(scope,thesis,base,available,reasoning,review.activeMilestone,review.status,review.evidenceState,workspace.generatedAt,now);
  await client.query("commit");return result;
 }catch(error){
  await client.query("rollback");
  if(error instanceof ResearchContextError&&error.code==="MEMBERSHIP_UNAVAILABLE")throw error;
  if(!scope)throw error;
  return unavailableResearchBaselineConfirmation(scope,now);
 }finally{client.release();}
}
