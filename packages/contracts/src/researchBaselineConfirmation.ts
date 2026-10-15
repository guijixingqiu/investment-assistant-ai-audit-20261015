import {operatingModelFingerprint} from "./researchOperatingModel.js";
import {sameThesisIdentity,type ResearchOperatingReasoning} from "./researchOperatingReasoning.js";
import {buildSharesReference} from "./researchOperatingCalculations.js";
import {calculateUnderwriting,scenarioPeriod,semanticAssumptionFingerprint,underwritingSharesIdentity,type ResearchBaselineSnapshot,type ResearchScenarioVersion,type ResearchUnderwritingProjection,type ScenarioPeriodType} from "./researchUnderwriting.js";
import {reviewRequirementFromLinks,strictReviewRequirement,type ResearchFreshness,type ResearchValidationMilestone} from "./researchReview.js";
import type {EvidenceRequirement} from "./researchFactIdentity.js";
import type {ThesisFormationProjection} from "./thesisFormation.js";
import type {CurrentBaseFormationProjection} from "./currentBaseFormation.js";

export type BaselineConfirmationStatus="NEEDS_FORMAL_THESIS"|"NEEDS_CURRENT_BASE"|"CURRENT_BASE_REVIEW_REQUIRED"|"READY_TO_CONFIRM_BASELINE"|"BASELINE_CONFIRMED"|"NEEDS_VALIDATION_MILESTONE"|"ACTIVE"|"UNAVAILABLE";
export type ResearchBaselinePreview=Omit<ResearchBaselineSnapshot,"baselineId"|"createdAt"|"actor">;
export interface BaselineStructuredSource {kind:"DIRECT_REQUIREMENT"|"RESEARCH_QUESTION"|"THESIS_TEST";id:string;label:string;requirement:EvidenceRequirement}
export interface ResearchBaselineConfirmationProjection {
 schemaVersion:"research-baseline-confirmation-v1";actorScope:{actorType:string;actorId:string};symbol:string;membershipId:string;membershipVersion:number;scenarioPeriodType:ScenarioPeriodType;
 status:BaselineConfirmationStatus;contextId:string|null;currentThesis:ThesisFormationProjection["currentLineage"];
 currentBase:{scenarioId:string;version:number;contextId:string;period:ResearchScenarioVersion["period"];status:"COMPLETE"|"INCOMPLETE"|"REVIEW_REQUIRED";assumptionCount:number}|null;
 existingBaseline:ResearchBaselineSnapshot|null;snapshotPreview:ResearchBaselinePreview|null;
 validation:{milestone:ResearchValidationMilestone|null;freshness:ResearchFreshness|null;evidenceState:string|null;structuredSources:BaselineStructuredSource[]};
 blockingReasons:string[];warnings:string[];nextOwnerAction:{kind:"FORM_THESIS"|"FORM_BASE"|"REUNDERWRITE"|"CONFIRM_BASELINE"|"SET_MILESTONE"|"REVIEW"|"RELOAD";label:string};
 generatedAt:string;projectionFingerprint:string;
}
export function researchBaselinePreview(reasoning:ResearchOperatingReasoning,current:ResearchScenarioVersion,asOf:string):ResearchBaselinePreview {
 const observed=reasoning.reverseValuation.observed,model=current.model,share=buildSharesReference(model,reasoning.facts);
 const atCreation=calculateUnderwriting(reasoning,current,null,null,[],asOf);
 return {symbol:current.symbol,membershipId:current.membershipId,membershipVersion:current.membershipVersion,
  reportId:model.thesisBinding?.reportId??null,reportVersion:model.thesisBinding?.reportVersion??null,reportFingerprint:model.thesisBinding?.reportFingerprint??null,
  originalThesisIdentity:model.thesisBinding,thesisLineageId:model.thesisOwnerAction?.lineageId??(model.thesisBinding?operatingModelFingerprint(model.thesisBinding):null),
  currentContextId:current.contextId,factSetFingerprint:operatingModelFingerprint(reasoning.facts.map(f=>({id:f.id,revision:f.revision,identity:f.identity}))),factIds:reasoning.facts.map(f=>f.id),
  seriesFingerprint:operatingModelFingerprint(reasoning.evidenceSeries??[]),scenarioSetId:current.scenarioId,scenarioVersion:current.version,
  assumptionFingerprint:semanticAssumptionFingerprint(current.assumptions),price:observed?.price??null,priceCurrency:observed?.currency??null,priceAsOf:observed?.asOf??null,
  quoteIdentity:observed?operatingModelFingerprint(observed):null,sharesIdentity:underwritingSharesIdentity(model,share),sharesAsOf:share?.period.end??null,
  fxIdentity:model.fx?operatingModelFingerprint(model.fx):null,fxAsOf:model.fx?.asOf??null,
  testsFingerprint:reasoning.thesisUpdate?.tests?operatingModelFingerprint(reasoning.thesisUpdate.tests):null,expectationGapAtCreation:atCreation.expectationGap.absoluteGap,
  calculationVersion:current.calculationVersion};
}
export function baselineEligibility(scope:{symbol:string;membershipId:string;membershipVersion:number;scenarioPeriodType:ScenarioPeriodType},thesis:ThesisFormationProjection,currentBase:CurrentBaseFormationProjection,current:ResearchScenarioVersion|null,contextId:string|null,underwritingStatus:ResearchUnderwritingProjection["currentBaseStatus"]|"NONE"):{ok:true}|{ok:false;code:"BASELINE_THESIS_DRIFT"|"BASELINE_SCENARIO_DRIFT"|"CURRENT_BASE_REVIEW_REQUIRED"|"CURRENT_BASE_NOT_COMPLETE"}{
 if(thesis.status!=="BOUND"||thesis.currentLineage?.state!=="ACTIVE"||!thesis.currentFormalThesis)return {ok:false,code:"BASELINE_THESIS_DRIFT"};
 if(currentBase.status==="CURRENT_BASE_REVIEW_REQUIRED"||underwritingStatus==="REVIEW_REQUIRED")return {ok:false,code:"CURRENT_BASE_REVIEW_REQUIRED"};
 if(!current||current.symbol!==scope.symbol||current.membershipId!==scope.membershipId||current.membershipVersion!==scope.membershipVersion||current.scenarioPeriodType!==scope.scenarioPeriodType||current.contextId!==contextId||currentBase.contextId!==contextId||currentBase.existingCurrentBase?.scenarioId!==current.scenarioId||currentBase.existingCurrentBase.version!==current.version)return {ok:false,code:"BASELINE_SCENARIO_DRIFT"};
 const period=scenarioPeriod(current.model),binding=current.model.thesisBinding,lineage=current.model.thesisOwnerAction?.lineageId??(binding?operatingModelFingerprint(binding):null);
 if(!binding||!sameThesisIdentity(binding,thesis.currentFormalThesis)||lineage!==thesis.currentLineage.lineageId||current.model.thesisOwnerAction?.action==="INVALIDATE_OR_END_THESIS")return {ok:false,code:"BASELINE_THESIS_DRIFT"};
 if(!period||period.type!==scope.scenarioPeriodType||operatingModelFingerprint(period.period)!==operatingModelFingerprint(current.period))return {ok:false,code:"BASELINE_SCENARIO_DRIFT"};
 if(currentBase.status!=="CURRENT_BASE_SAVED"||currentBase.existingCurrentBase.status!=="COMPLETE"||underwritingStatus!=="COMPLETE")return {ok:false,code:"CURRENT_BASE_NOT_COMPLETE"};
 return {ok:true};
}
function structuredSources(reasoning:ResearchOperatingReasoning|null):BaselineStructuredSource[]{
 if(!reasoning)return [];
 const sources:BaselineStructuredSource[]=[];
 for(const question of reasoning.researchQuestions??[]){
  if(!strictReviewRequirement(question.requirement))continue;
  sources.push({kind:"DIRECT_REQUIREMENT",id:`direct:${question.questionId}`,label:`直接要求 · ${question.targetMetric}`,requirement:question.requirement});
  sources.push({kind:"RESEARCH_QUESTION",id:question.questionId,label:`研究问题 · ${question.targetMetric}`,requirement:question.requirement});
 }
 for(const test of reasoning.model.thesisTests??[]){
  if(test.status!=="ACTIVE")continue;
  const requirement=reviewRequirementFromLinks(reasoning,reasoning.researchQuestions??[],[],[test.testId],null);
  if(requirement)sources.push({kind:"THESIS_TEST",id:test.testId,label:`Thesis Test · ${test.metrics.join("、")}`,requirement});
 }
 return sources;
}
export function projectResearchBaselineConfirmation(scope:{actorScope:{actorType:string;actorId:string};symbol:string;membershipId:string;membershipVersion:number;scenarioPeriodType:ScenarioPeriodType},thesis:ThesisFormationProjection,currentBase:CurrentBaseFormationProjection,underwriting:ResearchUnderwritingProjection|null,reasoning:ResearchOperatingReasoning|null,milestone:ResearchValidationMilestone|null,freshness:ResearchFreshness|null,evidenceState:string|null,asOf:string,now=new Date()):ResearchBaselineConfirmationProjection {
 const current=underwriting?.currentBase??null,baseline=underwriting?.baseline??null;
 const eligibility=baselineEligibility(scope,thesis,currentBase,current,currentBase.contextId,underwriting?.currentBaseStatus??"NONE");
 const baselineExact=!!baseline&&!!current&&baseline.membershipId===scope.membershipId&&baseline.membershipVersion===scope.membershipVersion&&baseline.scenarioSetId===current.scenarioId&&baseline.scenarioVersion===current.version&&baseline.thesisLineageId===thesis.currentLineage?.lineageId;
 const status:BaselineConfirmationStatus=thesis.status==="UNAVAILABLE"||currentBase.status==="UNAVAILABLE"?"UNAVAILABLE":thesis.status!=="BOUND"?"NEEDS_FORMAL_THESIS":
  !current?"NEEDS_CURRENT_BASE":eligibility.ok===false?"CURRENT_BASE_REVIEW_REQUIRED":milestone&&baseline?"ACTIVE":baselineExact?"NEEDS_VALIDATION_MILESTONE":baseline?"BASELINE_CONFIRMED":"READY_TO_CONFIRM_BASELINE";
 const preview=eligibility.ok&&reasoning&&current?researchBaselinePreview(reasoning,current,asOf):null;
 const action:ResearchBaselineConfirmationProjection["nextOwnerAction"]=status==="NEEDS_FORMAL_THESIS"?{kind:"FORM_THESIS",label:"先建立正式 Thesis"}:status==="NEEDS_CURRENT_BASE"?{kind:"FORM_BASE",label:"先完成当前期间的 Current Base"}:status==="CURRENT_BASE_REVIEW_REQUIRED"?{kind:"REUNDERWRITE",label:"先重新审视 Current Base"}:status==="READY_TO_CONFIRM_BASELINE"||status==="BASELINE_CONFIRMED"?{kind:"CONFIRM_BASELINE",label:"核对并确认研究基线"}:status==="NEEDS_VALIDATION_MILESTONE"?{kind:"SET_MILESTONE",label:"明确建立下一验证节点"}:status==="ACTIVE"?{kind:"REVIEW",label:"查看持续复核当前状态"}:{kind:"RELOAD",label:"重新读取研究状态"};
 const content={schemaVersion:"research-baseline-confirmation-v1" as const,...scope,status,contextId:currentBase.contextId,currentThesis:thesis.currentLineage,currentBase:current?{scenarioId:current.scenarioId,version:current.version,contextId:current.contextId,period:current.period,status:currentBase.existingCurrentBase?.status??"INCOMPLETE" as const,assumptionCount:current.assumptions.length}:null,
  existingBaseline:baseline,snapshotPreview:preview,validation:{milestone,freshness,evidenceState,structuredSources:structuredSources(reasoning)},
  blockingReasons:eligibility.ok?[]:[eligibility.code],warnings:["研究基线冻结当前研究事实、假设与市场观察；不是投资 Decision。","保存 Base 不会自动建立 Baseline；保存 Baseline 不会自动建立验证节点。",...(baseline&&!baselineExact?["已有研究基线保留原 Base 版本；新 Base 不会回填旧基线。"]:[])],nextOwnerAction:action};
 return {...content,generatedAt:now.toISOString(),projectionFingerprint:operatingModelFingerprint(content)};
}
export function unavailableResearchBaselineConfirmation(scope:{actorScope:{actorType:string;actorId:string};symbol:string;membershipId:string;membershipVersion:number;scenarioPeriodType:ScenarioPeriodType},now=new Date()):ResearchBaselineConfirmationProjection {
 const content={schemaVersion:"research-baseline-confirmation-v1" as const,...scope,status:"UNAVAILABLE" as const,contextId:null,currentThesis:null,currentBase:null,existingBaseline:null,snapshotPreview:null,validation:{milestone:null,freshness:null,evidenceState:null,structuredSources:[]},blockingReasons:["研究身份或读取不可用"],warnings:["没有使用不一致结果，也没有自动创建正式研究对象。"],nextOwnerAction:{kind:"RELOAD" as const,label:"重新读取研究状态"}};
 return {...content,generatedAt:now.toISOString(),projectionFingerprint:operatingModelFingerprint(content)};
}
