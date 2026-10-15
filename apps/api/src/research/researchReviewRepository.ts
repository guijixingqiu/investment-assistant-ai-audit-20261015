import type {Pool,PoolClient} from "pg";
import type {AuthenticatedResearchActor} from "./domain.js";
import {ResearchContextError,readResearchContextSnapshot} from "./researchContextRepository.js";
import {readCandidateMembershipById} from "./candidateMembershipPersistence.js";
import {readDeepResearchWorkspace} from "./deepResearchReadRepository.js";
import type {SourceSnapshotStoreOptions} from "./researchSourceSnapshotRepository.js";
const sourceReadOptions=(sourceStore?:SourceSnapshotStoreOptions)=>({accountScopeId:null,currentPortfolioEnabled:false,currentPortfolioMaxAgeSeconds:300,sourceStore});
import {readResearchUnderwriting,readResearchUnderwritingAtBaseline,saveThesisOwnerAction} from "./researchUnderwritingRepository.js";
import {sameThesisIdentity} from "../../../../packages/contracts/src/researchOperatingReasoning.js";
import {operatingModelFingerprint,type OperatingResearchModel} from "../../../../packages/contracts/src/researchOperatingModel.js";
import {currentThesisText} from "../../../../packages/contracts/src/thesisFormation.js";
import {validNextValidationEvent,type OwnerThesisAction,type ResearchBaselineSnapshot,type ResearchUnderwritingProjection,type ResearchNextValidationEvent,type ScenarioPeriodType} from "../../../../packages/contracts/src/researchUnderwriting.js";
import {linkedTestState,milestoneEvidence,projectResearchReview,reviewRequirementFromLinks,strictReviewRequirement,type ResearchReviewProjection,type ResearchReviewSnapshot,type ResearchValidationMilestone} from "../../../../packages/contracts/src/researchReview.js";
import type {EvidenceRequirement} from "../../../../packages/contracts/src/researchFactIdentity.js";
import type {ResearchOperatingReasoning} from "../../../../packages/contracts/src/researchOperatingReasoning.js";

interface MilestoneRow {id:string;candidate_membership_id:string;captured_membership_version:number;symbol:string;actor_type:string;actor_id:string;scenario_period_type:ScenarioPeriodType;baseline_id:string;context_id:string;thesis_lineage_id:string;payload:ResearchValidationMilestone;payload_fingerprint:string;request_fingerprint:string;idempotency_key:string}
interface ReviewRow {id:string;candidate_membership_id:string;captured_membership_version:number;symbol:string;actor_type:string;actor_id:string;scenario_period_type:ScenarioPeriodType;baseline_id:string;milestone_id:string;thesis_lineage_id:string;payload:ResearchReviewSnapshot;payload_fingerprint:string;request_fingerprint:string;idempotency_key:string}
type Reader=Pick<Pool|PoolClient,"query">;
const validScenarioPeriod=(value:unknown):value is ScenarioPeriodType=>value==="CURRENT_FY"||value==="NEXT_REPORTING_PERIOD";
function requireBody(body:unknown,keys:string[]):Record<string,unknown>{if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).sort().join()!==keys.sort().join())throw new ResearchContextError(422,"INVALID_REVIEW_REQUEST","unexpected review fields");return body as Record<string,unknown>;}
function milestone(row:MilestoneRow):ResearchValidationMilestone{const period=row.payload.scenarioPeriodType??"CURRENT_FY";if(row.payload.milestoneId!==row.id||operatingModelFingerprint(row.payload)!==row.payload_fingerprint||row.payload.baselineId!==row.baseline_id||row.payload.thesisLineageId!==row.thesis_lineage_id||period!==row.scenario_period_type)throw new ResearchContextError(503,"MILESTONE_INTEGRITY_FAILED","immutable milestone payload differs from its binding");return {...row.payload,scenarioPeriodType:period};}
function review(row:ReviewRow):ResearchReviewSnapshot{const period=row.payload.scenarioPeriodType??"CURRENT_FY";if(row.payload.reviewId!==row.id||operatingModelFingerprint(row.payload)!==row.payload_fingerprint||row.payload.milestoneId!==row.milestone_id||row.payload.baselineId!==row.baseline_id||period!==row.scenario_period_type)throw new ResearchContextError(503,"REVIEW_INTEGRITY_FAILED","immutable review payload differs from its binding");return {...row.payload,scenarioPeriodType:period};}
async function currentMilestone(pool:Reader,id:string,version:number,actor:AuthenticatedResearchActor,lineage:string,period?:ScenarioPeriodType):Promise<ResearchValidationMilestone|null>{const row=(await pool.query<MilestoneRow>(`select * from research_validation_milestones where candidate_membership_id=$1 and captured_membership_version=$2 and actor_type=$3 and actor_id=$4 and thesis_lineage_id=$5${period?" and scenario_period_type=$6":""} order by ordinal desc limit 1`,period?[id,version,actor.actorType,actor.actorId,lineage,period]:[id,version,actor.actorType,actor.actorId,lineage])).rows[0];return row?milestone(row):null;}
async function latestReview(pool:Reader,id:string,version:number,actor:AuthenticatedResearchActor,lineage:string,period?:ScenarioPeriodType):Promise<ResearchReviewSnapshot|null>{const row=(await pool.query<ReviewRow>(`select * from research_review_snapshots where candidate_membership_id=$1 and captured_membership_version=$2 and actor_type=$3 and actor_id=$4 and thesis_lineage_id=$5${period?" and scenario_period_type=$6":""} order by ordinal desc limit 1`,period?[id,version,actor.actorType,actor.actorId,lineage,period]:[id,version,actor.actorType,actor.actorId,lineage])).rows[0];return row?review(row):null;}
export async function readResearchReview(pool:Pool|PoolClient,id:string,actor:AuthenticatedResearchActor,now=new Date(),preferredPeriod:ScenarioPeriodType="CURRENT_FY",strictPeriod=false,sourceStore?:SourceSnapshotStoreOptions):Promise<ResearchReviewProjection>{
 const member=await readCandidateMembershipById(pool,actor,id);if(!member||member.state!=="tracked")throw new ResearchContextError(409,"MEMBERSHIP_UNAVAILABLE","tracked membership required");
 const workspace=await readDeepResearchWorkspace(pool,id,actor,now,sourceReadOptions(sourceStore));
 const reasoning=workspace.data?.operatingReasoning??null,original=reasoning?.model.thesisBinding;
 const lineage=reasoning?.model.thesisOwnerAction?.lineageId??(original?operatingModelFingerprint(original):null);
 let active:ResearchValidationMilestone|null=null,latest:ResearchReviewSnapshot|null=null;
 if(lineage){try{active=await currentMilestone(pool,id,Number(member.version),actor,lineage,strictPeriod?preferredPeriod:undefined);latest=await latestReview(pool,id,Number(member.version),actor,lineage,strictPeriod?preferredPeriod:undefined);}catch(error){if((error as {code?:string}).code!=="42P01")throw error;}}
 const scenarioPeriodType=active?.scenarioPeriodType??preferredPeriod;
 let underwritingRaw:Awaited<ReturnType<typeof readResearchUnderwriting>>|null=null;
 try{underwritingRaw=active?await readResearchUnderwritingAtBaseline(pool,id,actor,scenarioPeriodType,active.baselineId,active.thesisLineageId,now,sourceStore):await readResearchUnderwriting(pool,id,actor,scenarioPeriodType,now,sourceStore);}catch(error){if((error as {code?:string}).code!=="42P01")throw error;}
 const underwriting=underwritingRaw?.status==="available"?underwritingRaw as ResearchUnderwritingProjection:null;
 return projectResearchReview({symbol:member.symbol,membershipId:id,membershipVersion:Number(member.version),scenarioPeriodType,underwriting,reasoning,milestone:active,latestReview:latest,now});
}
export async function readResearchReviewForPeriod(pool:Pool|PoolClient,id:string,actor:AuthenticatedResearchActor,period:ScenarioPeriodType,now=new Date(),sourceStore?:SourceSnapshotStoreOptions):Promise<ResearchReviewProjection>{
 return readResearchReview(pool,id,actor,now,period,true,sourceStore);
}
export async function readResearchMilestoneForPeriod(pool:Pool|PoolClient,id:string,actor:AuthenticatedResearchActor,period:ScenarioPeriodType,now=new Date(),sourceStore?:SourceSnapshotStoreOptions):Promise<ResearchValidationMilestone|null>{
 const member=await readCandidateMembershipById(pool,actor,id);if(!member||member.state!=="tracked")throw new ResearchContextError(409,"MEMBERSHIP_UNAVAILABLE","tracked membership required");
 const reasoning=(await readDeepResearchWorkspace(pool,id,actor,now,sourceReadOptions(sourceStore))).data?.operatingReasoning;
 const original=reasoning?.model.thesisBinding;
 const lineage=reasoning?.model.thesisOwnerAction?.lineageId??(original?operatingModelFingerprint(original):null);
 return lineage?currentMilestone(pool,id,Number(member.version),actor,lineage,period):null;
}
async function lockMember(client:PoolClient,id:string,actor:AuthenticatedResearchActor,version:number){const row=(await client.query<{symbol:string;version:number;state:string}>(`select symbol,version,state from candidate_memberships where id=$1 and actor_type=$2 and actor_id=$3 for update`,[id,actor.actorType,actor.actorId])).rows[0];if(!row||row.state!=="tracked"||Number(row.version)!==version)throw new ResearchContextError(409,"MEMBERSHIP_VERSION_DRIFT","tracked membership changed");return row;}
function validLinks(r:Record<string,unknown>,prefix=""){const q=r[prefix?prefix+"LinkedQuestionIds":"linkedQuestionIds"],t=r[prefix?prefix+"LinkedThesisTestIds":"linkedThesisTestIds"];if(!Array.isArray(q)||!Array.isArray(t)||q.length>1||t.length>1||q.length+t.length>1||![...q,...t].every(x=>typeof x==="string"&&x.length>0))throw new ResearchContextError(422,"INVALID_MILESTONE_LINK","select one strict Question or Thesis Test requirement");return {questions:q as string[],tests:t as string[]};}
function requireSingleEvidenceSource(requirement:unknown,links:{questions:string[];tests:string[]}){if(requirement!==null&&(links.questions.length>0||links.tests.length>0))throw new ResearchContextError(422,"AMBIGUOUS_EVIDENCE_BINDING","choose a direct requirement, Question or Thesis Test, not a combination");}
async function assertMilestoneBaselineThesis(client:PoolClient,id:string,actor:AuthenticatedResearchActor,baseline:NonNullable<ResearchUnderwritingProjection["baseline"]>,currentModel:OperatingResearchModel):Promise<void>{
 const row=(await client.query<{context_payload:{operatingModel?:OperatingResearchModel}}>(`select context_payload from research_context_snapshots where id=$1 and candidate_membership_id=$2 and captured_membership_version=$3 and actor_type=$4 and actor_id=$5`,[baseline.currentContextId,id,baseline.membershipVersion,actor.actorType,actor.actorId])).rows[0];
 const frozen=row?.context_payload.operatingModel;
 if(!frozen?.thesisBinding||!currentModel.thesisBinding||!sameThesisIdentity(frozen.thesisBinding,currentModel.thesisBinding)||currentThesisText(frozen)!==currentThesisText(currentModel))throw new ResearchContextError(409,"BASELINE_THESIS_DRIFT","old Baseline cannot anchor a newly revised Thesis");
}
function milestoneRequest(body:unknown){
 const r=requireBody(body,["membershipVersion","scenarioPeriodType","baselineId","contextId","thesisLineageId","description","expectedEvidence","requirement","linkedQuestionIds","linkedThesisTestIds","targetDate","confirmed","idempotencyKey"]),links=validLinks(r);
 if(r.confirmed!==true||!Number.isSafeInteger(r.membershipVersion)||!validScenarioPeriod(r.scenarioPeriodType)||typeof r.baselineId!=="string"||typeof r.contextId!=="string"||typeof r.thesisLineageId!=="string"||!validNextValidationEvent({description:r.description,expectedEvidence:r.expectedEvidence,targetDate:r.targetDate})||typeof r.idempotencyKey!=="string"||r.idempotencyKey.length<8)throw new ResearchContextError(422,"INVALID_MILESTONE","explicit period, Baseline, Thesis, validation and confirmation required");
 if(!/^[a-f0-9-]{36}$/.test(String(r.baselineId)))throw new ResearchContextError(409,"MILESTONE_BINDING_DRIFT","Baseline identity is unavailable");
 requireSingleEvidenceSource(r.requirement,links);
 return {r,links};
}
async function insertMilestone(client:PoolClient,id:string,actor:AuthenticatedResearchActor,projection:ResearchReviewProjection,contextId:string,event:ResearchNextValidationEvent,requirementInput:unknown,links:{questions:string[];tests:string[]},supersedes:string|null,fromAction:string|null,key:string,requestFingerprint:string,now:Date,sourceStore?:SourceSnapshotStoreOptions):Promise<ResearchValidationMilestone>{
 const baseline=projection.underwriting?.baseline,reasoning=(await readDeepResearchWorkspace(client,id,actor,now,sourceReadOptions(sourceStore))).data?.operatingReasoning,original=reasoning?.model.thesisBinding;
 if(!baseline||!original||!projection.underwriting||!reasoning)throw new ResearchContextError(409,"REVIEW_LINEAGE_NOT_READY","save an explicit Baseline and Thesis before a milestone");
 if(projection.underwriting.currentBase?.scenarioPeriodType!==projection.scenarioPeriodType)throw new ResearchContextError(409,"MILESTONE_PERIOD_DRIFT","先保存该预测期间的研究基线。");
 const lineage=reasoning.model.thesisOwnerAction?.lineageId??operatingModelFingerprint(original);
 if(baseline.thesisLineageId!==lineage||!baseline.originalThesisIdentity||!sameThesisIdentity(original,baseline.originalThesisIdentity))throw new ResearchContextError(409,"BASELINE_THESIS_DRIFT","Baseline belongs to a different Thesis lineage");
 const questions=reasoning.researchQuestions??[];
 if(links.questions.length&&!questions.some(q=>q.questionId===links.questions[0])||links.tests.length&&!reasoning.model.thesisTests?.some(t=>t.testId===links.tests[0]&&t.status==="ACTIVE"))throw new ResearchContextError(409,"MILESTONE_LINK_DRIFT","linked Question or Test changed");
 if(requirementInput!==null&&!strictReviewRequirement(requirementInput))throw new ResearchContextError(422,"INVALID_EVIDENCE_REQUIREMENT","exact canonical Evidence Requirement required");
 requireSingleEvidenceSource(requirementInput,links);
 const requirement=reviewRequirementFromLinks(reasoning,questions,links.questions,links.tests,requirementInput as EvidenceRequirement|null);
 if((requirementInput!==null||links.questions.length||links.tests.length)&&!requirement)throw new ResearchContextError(422,"UNSTRUCTURED_EVIDENCE_REQUIREMENT","linked evidence requirement is not strict enough for automatic matching");
 const test=linkedTestState(reasoning,links.tests),evidence=milestoneEvidence(reasoning,requirement),milestoneId=(await client.query<{id:string}>(`select gen_random_uuid() id`)).rows[0]!.id;
 const payload:ResearchValidationMilestone={milestoneId,symbol:projection.symbol,membershipId:id,membershipVersion:projection.membershipVersion,scenarioPeriodType:projection.scenarioPeriodType,baselineId:baseline.baselineId,contextId,originalThesisIdentity:original,thesisLineageId:lineage,createdFromActionId:fromAction,description:event.description,expectedEvidence:event.expectedEvidence,requirement,linkedQuestionIds:links.questions,linkedThesisTestIds:links.tests,targetDate:event.targetDate,testStateFingerprintAtCreation:test.state,testDefinitionFingerprintAtCreation:test.definition,evidenceFingerprintAtCreation:evidence.fingerprint,evidenceIdsAtCreation:evidence.ids,acknowledgedPersistentTriggers:projection.persistentTriggerState,supersedesMilestoneId:supersedes,createdAt:now.toISOString(),createdBy:actor.actorId};
 await client.query(`insert into research_validation_milestones(id,candidate_membership_id,captured_membership_version,symbol,actor_type,actor_id,scenario_period_type,baseline_id,context_id,original_thesis_identity,thesis_lineage_id,created_from_action_id,description,expected_evidence,requirement,linked_question_ids,linked_thesis_test_ids,target_date,test_state_fingerprint_at_creation,test_definition_fingerprint_at_creation,evidence_fingerprint_at_creation,supersedes_milestone_id,payload,payload_fingerprint,idempotency_key,request_fingerprint,created_at,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,[milestoneId,id,projection.membershipVersion,projection.symbol,actor.actorType,actor.actorId,projection.scenarioPeriodType,baseline.baselineId,contextId,JSON.stringify(original),lineage,fromAction,event.description,event.expectedEvidence,requirement?JSON.stringify(requirement):null,JSON.stringify(links.questions),JSON.stringify(links.tests),event.targetDate,test.state,test.definition,evidence.fingerprint,supersedes,JSON.stringify(payload),operatingModelFingerprint(payload),key,requestFingerprint,now,actor.actorId]);
 return payload;
}
function assertMilestoneCurrentBinding(r:Record<string,unknown>,baseline:ResearchBaselineSnapshot,bound:{captured_membership_version:number}|undefined,contextId:string|null,lineage:string){
 if(baseline.baselineId!==r.baselineId||!bound||bound.captured_membership_version!==r.membershipVersion||contextId!==r.contextId||lineage!==r.thesisLineageId||baseline.thesisLineageId!==lineage||baseline.membershipVersion!==r.membershipVersion)throw new ResearchContextError(409,"MILESTONE_BINDING_DRIFT","Baseline, Context or Thesis lineage changed");
}
export async function createResearchMilestone(pool:Pool,id:string,actor:AuthenticatedResearchActor,body:unknown,now=new Date(),sourceStore?:SourceSnapshotStoreOptions){
 if(actor.actorType!=="user")throw new ResearchContextError(422,"OWNER_ACTION_REQUIRED","explicit Owner actor required");
 const {r,links}=milestoneRequest(body);
 const fp=operatingModelFingerprint({actor,id,request:r}),client=await pool.connect();try{await client.query("begin isolation level serializable");await lockMember(client,id,actor,Number(r.membershipVersion));
 const replay=(await client.query<MilestoneRow>(`select * from research_validation_milestones where actor_type=$1 and actor_id=$2 and idempotency_key=$3`,[actor.actorType,actor.actorId,r.idempotencyKey])).rows[0];if(replay){if(replay.request_fingerprint!==fp)throw new ResearchContextError(409,"IDEMPOTENCY_CONFLICT","key belongs to another milestone");await client.query("commit");return milestone(replay);}
 const projection=await readResearchReview(client,id,actor,now,"CURRENT_FY",false,sourceStore);
 if(projection.activeMilestone&&(projection.status==="REVIEW_DUE"||projection.status==="REVIEW_REQUIRED"))throw new ResearchContextError(409,"PENDING_REVIEW_MUST_BE_COMPLETED","当前已有待完成的正式复核，请先完成本次复核，再建立下一验证节点。");
 const period=r.scenarioPeriodType as ScenarioPeriodType;
 const bound=(await client.query<{scenario_period_type:ScenarioPeriodType;captured_membership_version:number}>(`select s.scenario_period_type,b.captured_membership_version from research_baseline_snapshots b join research_underwriting_scenario_versions s on s.id=b.scenario_version_id where b.id=$1 and b.candidate_membership_id=$2 and b.actor_type=$3 and b.actor_id=$4`,[r.baselineId,id,actor.actorType,actor.actorId])).rows[0];
 if(bound&&bound.scenario_period_type!==period)throw new ResearchContextError(409,"MILESTONE_PERIOD_DRIFT","研究基线属于另一预测期间；请先保存该预测期间的研究基线。");
 const selectedRaw=projection.activeMilestone||projection.scenarioPeriodType!==period?await readResearchUnderwriting(client,id,actor,period,now,sourceStore):null;
 const selectedUnderwriting=selectedRaw?.status==="available"?selectedRaw as ResearchUnderwritingProjection:selectedRaw?null:projection.underwriting;
 if(!selectedUnderwriting?.baseline||selectedUnderwriting.currentBase?.scenarioPeriodType!==period)throw new ResearchContextError(409,"MILESTONE_PERIOD_DRIFT","先保存该预测期间的研究基线。");
 const selectedProjection={...projection,scenarioPeriodType:period,underwriting:selectedUnderwriting};
 const context=await readResearchContextSnapshot(client,id,actor,now),baseline=selectedUnderwriting.baseline,reasoning=(await readDeepResearchWorkspace(client,id,actor,now,sourceReadOptions(sourceStore))).data?.operatingReasoning;
 if(!reasoning?.model.thesisBinding||reasoning.model.thesisOwnerAction?.action==="INVALIDATE_OR_END_THESIS")throw new ResearchContextError(409,"REVIEW_LINEAGE_NOT_READY","save a formal Thesis and explicit Baseline first");
 const lineage=reasoning.model.thesisOwnerAction?.lineageId??operatingModelFingerprint(reasoning.model.thesisBinding);
 assertMilestoneCurrentBinding(r,baseline,bound,context.data?.id??null,lineage);
 if(operatingModelFingerprint(reasoning.model)!==operatingModelFingerprint(context.data?.operatingModel??null))throw new ResearchContextError(409,"MILESTONE_BINDING_DRIFT","current Context and reasoning disagree");
 await assertMilestoneBaselineThesis(client,id,actor,baseline,reasoning.model);
 const value=await insertMilestone(client,id,actor,selectedProjection,String(r.contextId),{description:String(r.description),expectedEvidence:String(r.expectedEvidence),targetDate:r.targetDate as string|null},r.requirement,links,projection.activeMilestone?.milestoneId??null,null,String(r.idempotencyKey),fp,now,sourceStore);
 await client.query("commit");return value;
 }catch(error){await client.query("rollback");if((error as {code?:string}).code==="40001")throw new ResearchContextError(409,"MILESTONE_BINDING_DRIFT","research changed during milestone save");throw error;}finally{client.release();}
}
function completionRequest(body:unknown){
 const r=requireBody(body,["membershipVersion","baselineId","milestoneId","triggerFingerprint","baseContextId","thesisLineageId","originalThesisIdentity","action","newThesis","ownerReason","triggeringFactIds","nextValidationEvent","nextRequirement","nextLinkedQuestionIds","nextLinkedThesisTestIds","confirmed","idempotencyKey"]),links=validLinks(r,"next");
 requireSingleEvidenceSource(r.nextRequirement,links);
 if(r.confirmed!==true||!Number.isSafeInteger(r.membershipVersion)||typeof r.baselineId!=="string"||typeof r.milestoneId!=="string"||typeof r.triggerFingerprint!=="string"||typeof r.baseContextId!=="string"||typeof r.thesisLineageId!=="string"||typeof r.idempotencyKey!=="string"||r.idempotencyKey.length<8||!validNextValidationEvent(r.nextValidationEvent)||!["KEEP_CURRENT_THESIS","REVISE_THESIS","INSUFFICIENT_EVIDENCE_CONTINUE","INVALIDATE_OR_END_THESIS"].includes(String(r.action)))throw new ResearchContextError(422,"INVALID_REVIEW_COMPLETION","explicit Owner action and next validation required");
 return {r,links};
}
async function replayCompleted(client:PoolClient,actor:AuthenticatedResearchActor,r:Record<string,unknown>,fp:string){
 const prior=(await client.query<ReviewRow>(`select * from research_review_snapshots where actor_type=$1 and actor_id=$2 and idempotency_key=$3`,[actor.actorType,actor.actorId,r.idempotencyKey])).rows[0];
 if(!prior)return null;
 if(prior.request_fingerprint!==fp)throw new ResearchContextError(409,"IDEMPOTENCY_CONFLICT","key belongs to another review");
 const nextRow=(await client.query<MilestoneRow>(`select * from research_validation_milestones where actor_type=$1 and actor_id=$2 and idempotency_key=$3`,[actor.actorType,actor.actorId,`review-next:${r.idempotencyKey}`])).rows[0];
 return {review:review(prior),nextMilestone:nextRow?milestone(nextRow):null,replayed:true};
}
function freezeReviewSnapshot(id:string,projection:ResearchReviewProjection,m:ResearchValidationMilestone,original:NonNullable<ResearchValidationMilestone["originalThesisIdentity"]>,lineage:string,reasoning:ResearchOperatingReasoning,actionId:string,ownerReason:string,nextValidation:unknown,createdBy:string,now:Date):ResearchReviewSnapshot {
 const underwriting=projection.underwriting!,delta=underwriting.baselineComparison;
 const changes=underwriting.scenarioDiff;
 const changesByKind={NEW_FACT:underwriting.reunderwritingDraft.newFactsSinceBaseline,OWNER_ASSUMPTION_CHANGED:changes?.assumptionChanges.filter(c=>c.kind==="OWNER_ASSUMPTION_CHANGED")??[],GUIDANCE_CHANGED:changes?.guidanceChanges??[],CALCULATION_CHANGED:changes?.calculationChanged??false,MARKET_INPUT_CHANGED:{price:delta?.priceChanged??false,shares:delta?.sharesChanged??false,fx:delta?.fxChanged??false,other:changes?.marketInputChanges??[]}};
 const payload={whyReviewNow:projection.triggerReasons,scenarioPeriodType:m.scenarioPeriodType,milestone:m,triggerReasons:projection.triggerReasons,newFacts:underwriting.reunderwritingDraft.newFactsSinceBaseline,invalidatedEvidence:projection.relevantInvalidatedEvidenceIds,testResultDelta:reasoning.thesisUpdate?.tests??[],sinceBaseline:delta,changesByKind,scenarioDiff:changes,currentBaseStatus:underwriting.currentBaseStatus,conditionalMarketImpliedStatus:underwriting.conditionalImplied?.status??"UNKNOWN",expectationGap:underwriting.expectationGap,counterevidence:underwriting.reunderwritingDraft.counterevidence,unknown:underwriting.reunderwritingDraft.unknowns,nextValidation,thesisActionId:actionId};
 return {reviewId:id,symbol:projection.symbol,membershipId:projection.membershipId,membershipVersion:projection.membershipVersion,scenarioPeriodType:m.scenarioPeriodType,baselineId:m.baselineId,milestoneId:m.milestoneId,originalThesisIdentity:original,thesisLineageId:lineage,triggerFingerprint:projection.triggerFingerprint!,triggerReasons:projection.triggerReasons,evidenceState:projection.evidenceState,reviewStatusBefore:projection.status,reviewedEvidenceIds:projection.relevantEvidenceIds,reviewedEvidenceFingerprint:milestoneEvidence(reasoning,m.requirement,m.evidenceIdsAtCreation).fingerprint,testStateFingerprint:linkedTestState(reasoning,m.linkedThesisTestIds).state,currentBaseScenarioId:underwriting.currentBase?.scenarioId??null,currentBaseVersion:underwriting.currentBase?.version??null,calculationVersion:underwriting.currentBase?.calculationVersion??null,sinceBaselineDeltaFingerprint:operatingModelFingerprint(delta),underwritingInputFingerprint:underwriting.calculationProof.inputsFingerprint,expectationGapStatus:underwriting.expectationGap.status,thesisActionId:actionId,ownerReason,createdAt:now.toISOString(),createdBy,payload};
}
export async function completeResearchReview(pool:Pool,id:string,actor:AuthenticatedResearchActor,body:unknown,now=new Date(),sourceStore?:SourceSnapshotStoreOptions){
 if(actor.actorType!=="user")throw new ResearchContextError(422,"OWNER_ACTION_REQUIRED","explicit Owner actor required");
 const {r,links}=completionRequest(body);
 const fp=operatingModelFingerprint({actor,id,request:r}),client=await pool.connect();try{await client.query("begin isolation level serializable");await lockMember(client,id,actor,Number(r.membershipVersion));
 const replay=await replayCompleted(client,actor,r,fp);if(replay){await client.query("commit");return replay;}
 const projection=await readResearchReview(client,id,actor,now,"CURRENT_FY",false,sourceStore),m=projection.activeMilestone,base=projection.underwriting?.baseline,reasoning=(await readDeepResearchWorkspace(client,id,actor,now,sourceReadOptions(sourceStore))).data?.operatingReasoning;
 if(!projection.enabled||!m||!base||!reasoning?.model.thesisBinding||projection.status==="CURRENT"||m.milestoneId!==r.milestoneId||m.scenarioPeriodType!==projection.scenarioPeriodType||base.baselineId!==r.baselineId||projection.triggerFingerprint!==r.triggerFingerprint)throw new ResearchContextError(409,"REVIEW_TRIGGER_DRIFT","research state changed; reload Review");
 const original=reasoning.model.thesisBinding,lineage=reasoning.model.thesisOwnerAction?.lineageId??operatingModelFingerprint(original);
 if(lineage!==r.thesisLineageId||reasoning.contextId!==r.baseContextId||!r.originalThesisIdentity||!sameThesisIdentity(original,r.originalThesisIdentity as typeof original))throw new ResearchContextError(409,"REVIEW_TRIGGER_DRIFT","Thesis or current Context changed; reload Review");
 const actionBody={action:r.action as OwnerThesisAction,originalThesisIdentity:original,newThesis:r.newThesis,ownerReason:r.ownerReason,triggeringFactIds:r.triggeringFactIds,nextValidationEvent:r.nextValidationEvent,baselineId:r.baselineId,baseContextId:r.baseContextId,membershipVersion:r.membershipVersion,confirmed:true,idempotencyKey:`review-action:${r.idempotencyKey}`};
 const actionWrite=await saveThesisOwnerAction(client,id,actor,actionBody,now,sourceStore),action=actionWrite.data?.operatingModel?.thesisOwnerAction;
 if(!action)throw new ResearchContextError(503,"REVIEW_ACTION_WRITE_FAILED","Owner Thesis action missing after write");
 const snapshotId=(await client.query<{id:string}>(`select gen_random_uuid() id`)).rows[0]!.id;
 const snapshot=freezeReviewSnapshot(snapshotId,projection,m,original,lineage,reasoning,action.actionId,String(r.ownerReason),r.nextValidationEvent,actor.actorId,now);
 await client.query(`insert into research_review_snapshots(id,candidate_membership_id,captured_membership_version,symbol,actor_type,actor_id,scenario_period_type,baseline_id,milestone_id,original_thesis_identity,thesis_lineage_id,trigger_fingerprint,thesis_action_id,payload,payload_fingerprint,idempotency_key,request_fingerprint,created_at,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,[snapshotId,id,projection.membershipVersion,projection.symbol,actor.actorType,actor.actorId,m.scenarioPeriodType,base.baselineId,m.milestoneId,JSON.stringify(original),lineage,projection.triggerFingerprint,action.actionId,JSON.stringify(snapshot),operatingModelFingerprint(snapshot),r.idempotencyKey,fp,now,actor.actorId]);
 let nextMilestone:ResearchValidationMilestone|null=null;
 if(r.action!=="INVALIDATE_OR_END_THESIS"){
  const nextProjection={...projection,activeMilestone:m};
  nextMilestone=await insertMilestone(client,id,actor,nextProjection,String(actionWrite.data!.id),r.nextValidationEvent as ResearchNextValidationEvent,r.nextRequirement,links,m.milestoneId,action.actionId,`review-next:${r.idempotencyKey}`,fp,now,sourceStore);
 }
 await client.query("commit");return {review:snapshot,nextMilestone,replayed:false};
 }catch(error){await client.query("rollback");if((error as {code?:string}).code==="40001")throw new ResearchContextError(409,"REVIEW_TRIGGER_DRIFT","research changed during Review completion");throw error;}finally{client.release();}
}
