import type {Pool,PoolClient} from "pg";
import type {AuthenticatedResearchActor} from "./domain.js";
import {readCandidateMembershipById} from "./candidateMembershipPersistence.js";
import {ResearchContextError} from "./researchContextRepository.js";
import {readDeepResearchWorkspace} from "./deepResearchReadRepository.js";
import {readResearchMilestoneForPeriod,readResearchReviewForPeriod} from "./researchReviewRepository.js";
import {operatingModelFingerprint} from "../../../../packages/contracts/src/researchOperatingModel.js";
import type {ResearchOperatingReasoning} from "../../../../packages/contracts/src/researchOperatingReasoning.js";
import type {ResearchReviewProjection,ResearchValidationMilestone} from "../../../../packages/contracts/src/researchReview.js";
import {semanticAssumptionFingerprint,type ResearchBaselineSnapshot,type ResearchScenarioVersion,type ScenarioPeriodType} from "../../../../packages/contracts/src/researchUnderwriting.js";
import {projectResearchLoopReadiness,type ResearchLoopReadinessFacts,type ResearchLoopReadinessProjection,type ResearchLoopStorageStatus} from "../../../../packages/contracts/src/researchLoopReadiness.js";
import type {SourceSnapshotStoreOptions} from "./researchSourceSnapshotRepository.js";

async function storageCapability(pool:Pick<Pool|PoolClient,"query">):Promise<ResearchLoopStorageStatus>{
 const row=(await pool.query<{underwriting:boolean;baseline:boolean;milestone:boolean;review:boolean;milestone_period:boolean;review_period:boolean}>(`
  select to_regclass('public.research_underwriting_scenario_versions') is not null as underwriting,
   to_regclass('public.research_baseline_snapshots') is not null as baseline,
   to_regclass('public.research_validation_milestones') is not null as milestone,
   to_regclass('public.research_review_snapshots') is not null as review,
   exists(select 1 from information_schema.columns where table_schema='public' and table_name='research_validation_milestones' and column_name='scenario_period_type') as milestone_period,
   exists(select 1 from information_schema.columns where table_schema='public' and table_name='research_review_snapshots' and column_name='scenario_period_type') as review_period`)).rows[0];
 return row&&Object.values(row).every(Boolean)?"READY":"NOT_APPLIED";
}

function thesisFacts(reasoning:ResearchOperatingReasoning|null):NonNullable<ResearchLoopReadinessFacts["thesis"]>{
 const original=reasoning?.model.thesisBinding??null;
 const lineageId=reasoning?.model.thesisOwnerAction?.lineageId??(original?operatingModelFingerprint(original):null);
 return {status:reasoning?.model.thesisOwnerAction?.action==="INVALIDATE_OR_END_THESIS"?"ENDED":original?"PRESENT":"MISSING",
  originalThesisIdentity:original?operatingModelFingerprint(original):null,lineageId};
}
function currentBaseFacts(underwriting:ResearchReviewProjection["underwriting"]):NonNullable<ResearchLoopReadinessFacts["currentBase"]>{
 const status=underwriting?.currentBaseStatus==="COMPLETE"?"READY":underwriting?.currentBaseStatus==="NONE"?"MISSING":underwriting?.currentBaseStatus==="REVIEW_REQUIRED"?"REVIEW_REQUIRED":"UNKNOWN";
 const base=underwriting?.currentBase;
 return {status,scenarioId:base?.scenarioId??null,version:base?.version??null,assumptionFingerprint:base?semanticAssumptionFingerprint(base.assumptions):null};
}
function baselineFacts(baseline:ResearchBaselineSnapshot|null,base:ResearchScenarioVersion|null,lineage:string|null,id:string,version:number,period:ScenarioPeriodType):NonNullable<ResearchLoopReadinessFacts["baseline"]>{
 const exact=!!baseline&&!!lineage&&!!base&&baseline.membershipId===id&&baseline.membershipVersion===version&&baseline.thesisLineageId===lineage&&baseline.scenarioSetId===base.scenarioId&&baseline.scenarioVersion===base.version;
 return {status:baseline?exact?"PRESENT":"DRIFTED":"MISSING",baselineId:baseline?.baselineId??null,scenarioPeriodType:period,
  membershipVersion:baseline?.membershipVersion??null,thesisLineageId:baseline?.thesisLineageId??null,createdAt:baseline?.createdAt??null};
}
function milestoneFacts(milestone:ResearchValidationMilestone|null,baseline:ResearchBaselineSnapshot|null,lineage:string|null,id:string,version:number,period:ScenarioPeriodType):NonNullable<ResearchLoopReadinessFacts["milestone"]>{
 const exact=!!milestone&&!!baseline&&!!lineage&&milestone.membershipId===id&&milestone.membershipVersion===version&&milestone.scenarioPeriodType===period&&milestone.baselineId===baseline.baselineId&&milestone.thesisLineageId===lineage;
 return {status:milestone?exact?"PRESENT":"DRIFTED":"MISSING",milestoneId:milestone?.milestoneId??null,baselineId:milestone?.baselineId??null,description:milestone?.description??null,targetDate:milestone?.targetDate??null};
}
function readyFacts(shared:Pick<ResearchLoopReadinessFacts,"actorScope"|"symbol"|"membershipId"|"membershipVersion"|"scenarioPeriodType">,review:ResearchReviewProjection,reasoning:ResearchOperatingReasoning|null,milestone:ResearchValidationMilestone|null):ResearchLoopReadinessFacts{
 const thesis=thesisFacts(reasoning),underwriting=review.underwriting,baseline=underwriting?.baseline??null;
 return {...shared,storageStatus:"READY",thesis,currentBase:currentBaseFacts(underwriting),
  baseline:baselineFacts(baseline,underwriting?.currentBase??null,thesis.lineageId,shared.membershipId,shared.membershipVersion,shared.scenarioPeriodType),
  milestone:milestoneFacts(milestone,baseline,thesis.lineageId,shared.membershipId,shared.membershipVersion,shared.scenarioPeriodType),
  researchFreshness:review.enabled||review.status==="ENDED"?review.status:null,evidenceState:review.enabled?review.evidenceState:null,
  limitations:[],phase12Enabled:review.enabled,phase12Ended:review.status==="ENDED"};
}

export function assertReadinessConsistency(
 shared:Pick<ResearchLoopReadinessFacts,"symbol"|"membershipId"|"membershipVersion"|"scenarioPeriodType">,
 review:ResearchReviewProjection,reasoning:ResearchOperatingReasoning|null,milestone:ResearchValidationMilestone|null
):void {
 const thesis=thesisFacts(reasoning);
 const sameScope=review.symbol===shared.symbol&&review.membershipId===shared.membershipId&&review.membershipVersion===shared.membershipVersion&&review.scenarioPeriodType===shared.scenarioPeriodType;
 const active=review.activeMilestone;
 const ended=thesis.status==="ENDED";
 const sameMilestone=ended?active===null:(active===null&&milestone===null)||(active!==null&&milestone!==null&&active.milestoneId===milestone.milestoneId&&active.thesisLineageId===milestone.thesisLineageId);
 const sameLineage=ended?!active:!active||!!thesis.lineageId&&active.thesisLineageId===thesis.lineageId&&active.membershipId===shared.membershipId&&active.membershipVersion===shared.membershipVersion&&active.scenarioPeriodType===shared.scenarioPeriodType;
 const baseline=review.underwriting?.baseline;
 const sameBaseline=ended||!baseline||!!thesis.lineageId&&baseline.thesisLineageId===thesis.lineageId&&baseline.membershipId===shared.membershipId&&baseline.membershipVersion===shared.membershipVersion;
 const liveReview=!review.enabled||thesis.status==="PRESENT"&&!!active&&sameLineage;
 const endedReview=review.status!=="ENDED"||thesis.status==="ENDED"&&!review.enabled;
 if(!sameScope||!sameMilestone||!sameLineage||!sameBaseline||!liveReview||!endedReview)
  throw new ResearchContextError(503,"READINESS_IDENTITY_DRIFT","mixed research identities; reload");
}

export async function readResearchLoopReadiness(pool:Pool,id:string,actor:AuthenticatedResearchActor,period:ScenarioPeriodType="CURRENT_FY",now=new Date(),sourceStore?:SourceSnapshotStoreOptions):Promise<ResearchLoopReadinessProjection>{
 const client=await pool.connect();
 let shared:Pick<ResearchLoopReadinessFacts,"actorScope"|"symbol"|"membershipId"|"membershipVersion"|"scenarioPeriodType">|null=null;
 try{
  await client.query("begin isolation level repeatable read read only");
  const member=await readCandidateMembershipById(client,actor,id);
  if(!member||member.state!=="tracked")throw new ResearchContextError(409,"MEMBERSHIP_UNAVAILABLE","tracked membership required");
  shared={actorScope:{actorType:actor.actorType,actorId:actor.actorId},symbol:member.symbol,membershipId:id,membershipVersion:Number(member.version),scenarioPeriodType:period};
  const storage=await storageCapability(client);
  if(storage!=="READY"){
   await client.query("commit");
   return projectResearchLoopReadiness({...shared,storageStatus:storage,thesis:null,currentBase:null,baseline:null,milestone:null,researchFreshness:null,evidenceState:null,
    limitations:["持续复核存储尚未启用；正式研究对象未自动创建。"],phase12Enabled:false,phase12Ended:false},now);
  }
  const review=await readResearchReviewForPeriod(client,id,actor,period,now,sourceStore);
  const workspace=await readDeepResearchWorkspace(client,id,actor,now,{accountScopeId:null,currentPortfolioEnabled:false,currentPortfolioMaxAgeSeconds:300,sourceStore});
  const rawMilestone=await readResearchMilestoneForPeriod(client,id,actor,period,now,sourceStore);
  if(workspace.status!=="available"||workspace.data?.target.membershipVersion!==shared.membershipVersion||workspace.data.target.symbol!==shared.symbol)
   throw new ResearchContextError(503,"READINESS_IDENTITY_DRIFT","workspace identity unavailable");
  const reasoning=workspace.data.operatingReasoning??null;
  assertReadinessConsistency(shared,review,reasoning,rawMilestone);
  const result=projectResearchLoopReadiness(readyFacts(shared,review,reasoning,rawMilestone),now);
  await client.query("commit");
  return result;
 }catch(error){
  await client.query("rollback");
  if(error instanceof ResearchContextError&&error.code==="MEMBERSHIP_UNAVAILABLE")throw error;
  if(!shared)throw error;
  return projectResearchLoopReadiness({...shared,storageStatus:"UNAVAILABLE",thesis:null,currentBase:null,baseline:null,milestone:null,researchFreshness:null,evidenceState:null,
   limitations:["持续复核读取暂不可用；未使用不一致或不完整结果。"],phase12Enabled:false,phase12Ended:false},now);
 }finally{client.release();}
}
