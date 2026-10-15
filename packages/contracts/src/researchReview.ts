import {operatingModelFingerprint,type OperatingFact} from "./researchOperatingModel.js";
import {factIdentity,requirementMismatch,normalizedAmountKey,validEvidenceRequirement,type EvidenceRequirement} from "./researchFactIdentity.js";
import {resolveEvidenceRequirement} from "./researchEvidenceRequirement.js";
import type {ResearchOperatingReasoning} from "./researchOperatingReasoning.js";
import type {ResearchUnderwritingProjection,ResearchBaselineSnapshot,ResearchNextValidationEvent,ScenarioPeriodType} from "./researchUnderwriting.js";
import type {ResearchQuestion} from "./researchQuestions.js";

export type ResearchFreshness="CURRENT"|"REVIEW_DUE"|"REVIEW_REQUIRED"|"ENDED";
export type MilestoneEvidenceState="SUFFICIENT"|"INSUFFICIENT"|"CONFLICTING"|"INVALIDATED"|"UNKNOWN";
export type ReviewTriggerReason="MILESTONE_EVIDENCE_ARRIVED"|"MILESTONE_DUE_EVIDENCE_MISSING"|"THESIS_TEST_STATE_CHANGED"|"EVIDENCE_INVALIDATED"|"CURRENT_BASE_REVIEW_REQUIRED"|"RELEVANT_EVIDENCE_CONFLICT";
export interface ReviewPersistentTriggerState {invalidations:Array<{id:string;revision:number;validity:string|null}>;conflictFingerprint:string|null;baseReviewFingerprint:string|null}
export interface ResearchValidationMilestone {
 milestoneId:string;symbol:string;membershipId:string;membershipVersion:number;scenarioPeriodType:ScenarioPeriodType;baselineId:string;contextId:string;originalThesisIdentity:ResearchBaselineSnapshot["originalThesisIdentity"];thesisLineageId:string;createdFromActionId:string|null;
 description:string;expectedEvidence:string;requirement:EvidenceRequirement|null;linkedQuestionIds:string[];linkedThesisTestIds:string[];targetDate:string|null;
 testStateFingerprintAtCreation:string;testDefinitionFingerprintAtCreation:string;evidenceFingerprintAtCreation:string;evidenceIdsAtCreation:string[];acknowledgedPersistentTriggers?:ReviewPersistentTriggerState;supersedesMilestoneId:string|null;createdAt:string;createdBy:string;
}
export interface ResearchReviewSnapshot {
 reviewId:string;symbol:string;membershipId:string;membershipVersion:number;scenarioPeriodType:ScenarioPeriodType;baselineId:string;milestoneId:string;originalThesisIdentity:ResearchBaselineSnapshot["originalThesisIdentity"];thesisLineageId:string;
 triggerFingerprint:string;triggerReasons:ReviewTriggerReason[];evidenceState:MilestoneEvidenceState;reviewStatusBefore:ResearchFreshness;reviewedEvidenceIds:string[];reviewedEvidenceFingerprint:string;testStateFingerprint:string;
 currentBaseScenarioId:string|null;currentBaseVersion:number|null;calculationVersion:string|null;sinceBaselineDeltaFingerprint:string;underwritingInputFingerprint:string;expectationGapStatus:string|null;thesisActionId:string;ownerReason:string;createdAt:string;createdBy:string;payload:Record<string,unknown>;
}
export interface ResearchReviewProjection {
 symbol:string;membershipId:string;membershipVersion:number;scenarioPeriodType:ScenarioPeriodType;enabled:boolean;status:ResearchFreshness;evidenceState:MilestoneEvidenceState;activeMilestone:ResearchValidationMilestone|null;latestReview:ResearchReviewSnapshot|null;
 triggerReasons:ReviewTriggerReason[];triggerFingerprint:string|null;relevantEvidenceIds:string[];relevantInvalidatedEvidenceIds:string[];persistentTriggerState:ReviewPersistentTriggerState;sinceBaselineDelta:ResearchUnderwritingProjection["baselineComparison"]|null;underwriting:ResearchUnderwritingProjection|null;maxUnknown:string|null;nextValidation:ResearchNextValidationEvent|null;
 todayAction:null|{kind:"RESEARCH_REVIEW_REQUIRED"|"RESEARCH_REVIEW_DUE";id:string;title:string;summary:string};
}
export function strictReviewRequirement(value:unknown):value is EvidenceRequirement {
 if(!validEvidenceRequirement(value))return false;
 const required=["symbol","membershipVersion","metric","period","category","unit","currency","accountingScope","businessScope","measurementBasis","comparability"] as const;
 return required.every(k=>value[k].mode==="exact")&&Object.values(value).every(v=>v.mode!=="owner_to_define");
}
export function milestoneEvidence(reasoning:ResearchOperatingReasoning,requirement:EvidenceRequirement|null,initialIds:string[]=[]) {
 if(!requirement)return {state:"UNKNOWN" as MilestoneEvidenceState,ids:[] as string[],fingerprint:operatingModelFingerprint([])};
 const history=reasoning.assertionHistory??reasoning.facts;
 const invalid=history.filter(f=>["RETRACTED","INVALID"].includes(f.evidenceValidity??"")&&!requirementMismatch(factIdentity(f),f.comparability,requirement));
 const resolution=resolveEvidenceRequirement(requirement,reasoning.facts,[]);
 const ids=[...new Set(resolution.evidenceIds)].sort();
 const matching=reasoning.facts.filter(f=>!requirementMismatch(factIdentity(f),f.comparability,requirement));
 const amounts=new Set(matching.map(f=>`${operatingModelFingerprint(factIdentity(f))}:${normalizedAmountKey(f.value,f.unitScale)}`));
 const state:MilestoneEvidenceState=invalid.some(f=>initialIds.includes(f.id))||invalid.length>0&&resolution.status!=="RESOLVED"?"INVALIDATED":resolution.reason==="CONFLICTING_ASSERTIONS"||amounts.size>1?"CONFLICTING":resolution.status==="RESOLVED"?"SUFFICIENT":"INSUFFICIENT";
 const fingerprint=operatingModelFingerprint(ids.map(id=>{const f=reasoning.facts.find(x=>x.id===id);return {id,revision:f?.revision??null,validity:f?.evidenceValidity??null};}));
 return {state,ids,fingerprint};
}
export function linkedTestState(reasoning:ResearchOperatingReasoning,ids:string[]):{state:string;definition:string} {
 const tests=(reasoning.thesisUpdate?.tests??[]).filter(t=>ids.includes(t.test.testId)).sort((a,b)=>a.test.testId.localeCompare(b.test.testId));
 return {state:operatingModelFingerprint(tests.map(t=>({id:t.test.testId,result:t.result,observations:t.observations.map(o=>({metric:o.metric,result:o.result,evidenceIds:[...o.evidenceIds].sort()}))}))),definition:operatingModelFingerprint(tests.map(t=>t.test))};
}
export function reviewRequirementFromLinks(reasoning:ResearchOperatingReasoning,questions:ResearchQuestion[],questionIds:string[],testIds:string[],direct:EvidenceRequirement|null):EvidenceRequirement|null {
 if(questionIds.length+testIds.length>1||direct&&(questionIds.length>0||testIds.length>0))return null;
 if(direct)return strictReviewRequirement(direct)?direct:null;
 if(questionIds.length===1&&!testIds.length){const q=questions.find(x=>x.questionId===questionIds[0]);return strictReviewRequirement(q?.requirement)?q!.requirement!:null;}
 if(testIds.length===1&&!questionIds.length){const t=reasoning.model.thesisTests?.find(x=>x.testId===testIds[0]&&x.status==="ACTIVE");const requirements=Object.values(t?.evidenceRequirements??{});return requirements.length===1&&strictReviewRequirement(requirements[0])?requirements[0]!:null;}
 return null;
}
interface ReviewProjectionInput {symbol:string;membershipId:string;membershipVersion:number;scenarioPeriodType:ScenarioPeriodType;underwriting:ResearchUnderwritingProjection|null;reasoning:ResearchOperatingReasoning|null;milestone:ResearchValidationMilestone|null;latestReview:ResearchReviewSnapshot|null;now:Date}
function reviewLineageReady({membershipId,membershipVersion,scenarioPeriodType,underwriting,reasoning,milestone}:ReviewProjectionInput):boolean {
 const original=reasoning?.model.thesisBinding,baseline=underwriting?.baseline;
 const lineage=reasoning?.model.thesisOwnerAction?.lineageId??(original?operatingModelFingerprint(original):null);
 return !!original&&!!baseline&&!!milestone&&baseline.membershipId===membershipId&&baseline.membershipVersion===membershipVersion&&baseline.thesisLineageId===lineage&&milestone.membershipId===membershipId&&milestone.membershipVersion===membershipVersion&&milestone.baselineId===baseline.baselineId&&milestone.thesisLineageId===lineage&&milestone.scenarioPeriodType===scenarioPeriodType&&milestone.scenarioPeriodType===underwriting?.currentBase?.scenarioPeriodType;
}
function exactFactDependencies(reasoning:ResearchOperatingReasoning,underwriting:ResearchUnderwritingProjection,milestone:ResearchValidationMilestone,initialIds:string[],matchedIds:string[]):Set<string> {
 const model=reasoning.model;
 const modelIds=[model.sharesValueId,...(model.thesisRevision?.evidenceFactIds??[]),...(model.thesisOwnerAction?.triggeringFactIds??[]),...model.scenarios.flatMap(s=>[...Object.values(s.inputs),...(s.revenueComposition?[s.revenueComposition.otherRevenue]:[])].flatMap(i=>[i.sourceValueId,...(i.rationale?.basedOnFactIds??[])]))];
 const reasoningIds=[...(reasoning.researchQuestions??[]).filter(q=>milestone.linkedQuestionIds.includes(q.questionId)).flatMap(q=>q.evidenceIds),...(reasoning.thesisUpdate?.tests??[]).filter(t=>milestone.linkedThesisTestIds.includes(t.test.testId)).flatMap(t=>t.observations.flatMap(o=>o.evidenceIds))];
 return new Set([...initialIds,...matchedIds,...modelIds,...reasoningIds,...(underwriting.currentBase?.assumptions.flatMap(a=>a.basedOnFactIds)??[])].filter((x):x is string=>typeof x==="string"&&x.length>0));
}
function relevantInvalidations(reasoning:ResearchOperatingReasoning,milestone:ResearchValidationMilestone,direct:Set<string>) {
 const active=reasoning.facts,model=reasoning.model;
 const relevant=(f:OperatingFact):boolean=>{
  if(!["RETRACTED","INVALID"].includes(f.evidenceValidity??""))return false;
  if(direct.has(f.id))return true;
  const identity=factIdentity(f),identityKey=operatingModelFingerprint(identity);
  if(active.some(current=>current.id!==f.id&&operatingModelFingerprint(factIdentity(current))===identityKey))return false;
  if(milestone.requirement&&!requirementMismatch(identity,f.comparability,milestone.requirement))return true;
  if((reasoning.researchQuestions??[]).some(q=>milestone.linkedQuestionIds.includes(q.questionId)&&q.requirement&&!requirementMismatch(identity,f.comparability,q.requirement)))return true;
  return (model.thesisTests??[]).some(t=>milestone.linkedThesisTestIds.includes(t.testId)&&t.status==="ACTIVE"&&Object.values(t.evidenceRequirements??{}).some(req=>!requirementMismatch(identity,f.comparability,req)));
 };
 return (reasoning.assertionHistory??active).filter(relevant).map(f=>({id:f.id,revision:f.revision,validity:f.evidenceValidity??null})).sort((a,b)=>a.id.localeCompare(b.id));
}
function persistentTriggerState(reasoning:ResearchOperatingReasoning,milestone:ResearchValidationMilestone,underwriting:ResearchUnderwritingProjection,evidence:ReturnType<typeof milestoneEvidence>,invalidations:ReturnType<typeof relevantInvalidations>):ReviewPersistentTriggerState {
 const conflictFacts=evidence.state==="CONFLICTING"&&milestone.requirement?reasoning.facts.filter(f=>!requirementMismatch(factIdentity(f),f.comparability,milestone.requirement!)).map(f=>({id:f.id,revision:f.revision,identity:factIdentity(f),value:f.value,unitScale:f.unitScale})).sort((a,b)=>a.id.localeCompare(b.id)):null;
 const current=underwriting.currentBase,active=new Set(reasoning.facts.map(f=>f.id));
 const stale=current?.assumptions.flatMap(a=>a.basedOnFactIds.filter(id=>!active.has(id)).map(id=>({assumptionId:a.assumptionId,factId:id}))).sort((a,b)=>a.assumptionId.localeCompare(b.assumptionId)||a.factId.localeCompare(b.factId))??[];
 return {invalidations,conflictFingerprint:conflictFacts?operatingModelFingerprint({requirement:milestone.requirement,facts:conflictFacts}):null,baseReviewFingerprint:underwriting.currentBaseStatus==="REVIEW_REQUIRED"?operatingModelFingerprint({scenarioId:current?.scenarioId,version:current?.version,modelFingerprint:current?.modelFingerprint,stale}):null};
}
function reviewTriggers(milestone:ResearchValidationMilestone,underwriting:ResearchUnderwritingProjection,evidence:ReturnType<typeof milestoneEvidence>,test:ReturnType<typeof linkedTestState>,invalidations:ReturnType<typeof relevantInvalidations>,conflictFingerprint:string|null,baseReviewFingerprint:string|null,now:Date) {
 const due=!!milestone.targetDate&&now.toISOString().slice(0,10)>=milestone.targetDate&&["INSUFFICIENT","UNKNOWN"].includes(evidence.state);
 const reasons:ReviewTriggerReason[]=[];
 if(evidence.state==="SUFFICIENT"&&evidence.fingerprint!==milestone.evidenceFingerprintAtCreation)reasons.push("MILESTONE_EVIDENCE_ARRIVED");
 if(due)reasons.push("MILESTONE_DUE_EVIDENCE_MISSING");
 if(test.definition===milestone.testDefinitionFingerprintAtCreation&&test.state!==milestone.testStateFingerprintAtCreation)reasons.push("THESIS_TEST_STATE_CHANGED");
 if(invalidations.length)reasons.push("EVIDENCE_INVALIDATED");
 if(baseReviewFingerprint)reasons.push("CURRENT_BASE_REVIEW_REQUIRED");
 if(conflictFingerprint)reasons.push("RELEVANT_EVIDENCE_CONFLICT");
 const fingerprint=operatingModelFingerprint({milestoneId:milestone.milestoneId,evidenceFingerprint:evidence.fingerprint,testState:test.definition===milestone.testDefinitionFingerprintAtCreation?test.state:null,invalidations,baseReviewFingerprint,due,conflictFingerprint});
 return {reasons,fingerprint};
}
function reviewTodayAction(symbol:string,membershipId:string,status:ResearchFreshness,reasons:ReviewTriggerReason[],fingerprint:string):ResearchReviewProjection["todayAction"] {
 if(status==="CURRENT")return null;
 const titles:Record<ReviewTriggerReason,string>={MILESTONE_EVIDENCE_ARRIVED:"预期证据已到",MILESTONE_DUE_EVIDENCE_MISSING:"验证日期已到",THESIS_TEST_STATE_CHANGED:"Thesis 检验结果变化",EVIDENCE_INVALIDATED:"既有证据失效",CURRENT_BASE_REVIEW_REQUIRED:"当前 Base 需复核",RELEVANT_EVIDENCE_CONFLICT:"相关正式证据冲突"};
 return {kind:status==="REVIEW_DUE"?"RESEARCH_REVIEW_DUE":"RESEARCH_REVIEW_REQUIRED",id:`inbox:event:research:${membershipId}:${fingerprint}`,title:status==="REVIEW_DUE"?`${symbol} · 验证节点已到`:`${symbol} · 需要重新审视`,summary:status==="REVIEW_DUE"?"之前设定的验证日期已到，预期证据仍不完整。":`验证节点出现结构化变化：${reasons.map(r=>titles[r]).join("、")}。`};
}
export function projectResearchReview(input:ReviewProjectionInput):ResearchReviewProjection {
 const {symbol,membershipId,membershipVersion,scenarioPeriodType,underwriting,reasoning,milestone,latestReview,now}=input;
 const empty=(status:ResearchFreshness):ResearchReviewProjection=>({symbol,membershipId,membershipVersion,scenarioPeriodType,enabled:false,status,evidenceState:"UNKNOWN",activeMilestone:null,latestReview,triggerReasons:[],triggerFingerprint:null,relevantEvidenceIds:[],relevantInvalidatedEvidenceIds:[],persistentTriggerState:{invalidations:[],conflictFingerprint:null,baseReviewFingerprint:null},sinceBaselineDelta:underwriting?.baselineComparison??null,underwriting,maxUnknown:reasoning?.unknown.text??null,nextValidation:null,todayAction:null});
 if(reasoning?.model.thesisOwnerAction?.action==="INVALIDATE_OR_END_THESIS")return empty("ENDED");
 if(!reviewLineageReady(input)||!reasoning||!milestone||!underwriting)return empty("CURRENT");
 const initialIds=milestone.evidenceIdsAtCreation??[],evidence=milestoneEvidence(reasoning,milestone.requirement,initialIds),test=linkedTestState(reasoning,milestone.linkedThesisTestIds);
 const invalidations=relevantInvalidations(reasoning,milestone,exactFactDependencies(reasoning,underwriting,milestone,initialIds,evidence.ids));
 const persistent=persistentTriggerState(reasoning,milestone,underwriting,evidence,invalidations),acknowledged=milestone.acknowledgedPersistentTriggers;
 const newInvalidations=invalidations.filter(item=>!acknowledged?.invalidations.some(old=>old.id===item.id&&old.revision===item.revision&&old.validity===item.validity));
 const conflictFingerprint=persistent.conflictFingerprint!==acknowledged?.conflictFingerprint?persistent.conflictFingerprint:null;
 const baseReviewFingerprint=persistent.baseReviewFingerprint!==acknowledged?.baseReviewFingerprint?persistent.baseReviewFingerprint:null;
 const trigger=reviewTriggers(milestone,underwriting,evidence,test,newInvalidations,conflictFingerprint,baseReviewFingerprint,now);
 const reviewed=latestReview?.milestoneId===milestone.milestoneId&&latestReview.triggerFingerprint===trigger.fingerprint;
 const reasons=reviewed?[]:trigger.reasons;
 const status:ResearchFreshness=reasons.some(r=>r!=="MILESTONE_DUE_EVIDENCE_MISSING")?"REVIEW_REQUIRED":reasons.length?"REVIEW_DUE":"CURRENT";
 return {symbol,membershipId,membershipVersion,scenarioPeriodType,enabled:true,status,evidenceState:evidence.state,activeMilestone:milestone,latestReview,triggerReasons:reasons,triggerFingerprint:trigger.fingerprint,relevantEvidenceIds:evidence.ids,relevantInvalidatedEvidenceIds:newInvalidations.map(item=>item.id),persistentTriggerState:persistent,sinceBaselineDelta:underwriting.baselineComparison,underwriting,maxUnknown:reasoning.unknown.text,nextValidation:{description:milestone.description,expectedEvidence:milestone.expectedEvidence,targetDate:milestone.targetDate},todayAction:reviewTodayAction(symbol,membershipId,status,reasons,trigger.fingerprint)};
}
