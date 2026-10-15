import type { ResearchQuestion } from "./researchQuestions.js";
import { evaluateThesisTests, aggregateThesisTests, type ThesisTestResult, type OverallThesisEvidence } from "./researchThesisTests.js";
import { evaluateThesis, type ThesisObservation } from "./researchThesisEvaluator.js";
import { operatingModelFingerprint, type ExplicitThesisBinding, type OperatingFact } from "./researchOperatingModel.js";
import type { ResearchOperatingReasoning } from "./researchOperatingReasoning.js";
export const GAP_REASONS=["SOURCE_NOT_FOUND","SOURCE_NOT_PUBLISHED","NOT_EXTRACTED","SCOPE_MISMATCH","PERIOD_MISMATCH","MEASUREMENT_MISMATCH","OWNER_ASSUMPTION_REQUIRED","STALE"] as const;
export type GapReason=typeof GAP_REASONS[number];
export interface ThesisRevision {
  previous:ExplicitThesisBinding; status:"DRAFT"|"OWNER_CONFIRMED"; assessment:"supports"|"partially_supports"|"weakens"|"invalidates"|"insufficient_evidence";
  evidenceFactIds:string[]; retainedEvidence:string[]; weakenedParts:string[]; newThesis:string; reason:string;
  addedHypotheses:string[]; abandonedHypotheses:string[]; previousValidationEvent:string; nextValidationEvent:string;
  confirmedAt:string|null; actor:string|null;
}
export interface ThesisUpdateDraft {
  tests?:ThesisTestResult[]; overallEvidence?:OverallThesisEvidence;
  dimension?:string; newDisclosureEvidence?:string[]; newlyExtractedOldEvidence?:string[]; corrections?:string[]; conflictingEvidence?:string[]; observations?:ThesisObservation[];
  status:"DRAFT"; originalThesis:ExplicitThesisBinding; evidenceSinceThesis:string[];
  supporting:string[]; weakening:string[]; counterevidence:string[]; unknown:string[];
  assessment:ThesisRevision["assessment"]; explanation:string; nextValidationEvent:string;
}
export function buildThesisUpdate(value:ResearchOperatingReasoning,reportCreatedAt?:string):ThesisUpdateDraft|null {
  const b=value.model.thesisBinding;if(!b)return null;
  const evaluation=evaluateThesis(value),after=(s:string|undefined)=>!!s&&!!reportCreatedAt&&Date.parse(s)>Date.parse(reportCreatedAt);
  const newDisclosureEvidence=value.facts.filter(f=>(f.amendmentKind===undefined||f.amendmentKind==="initial")&&after(f.source.publishedAt)).map(f=>f.id);
  const newlyExtractedOldEvidence=value.facts.filter(f=>(f.amendmentKind===undefined||f.amendmentKind==="initial")&&!after(f.source.publishedAt)&&after(f.recordedAt)).map(f=>f.id);
  const corrections=value.facts.filter(f=>f.amendmentKind!==undefined&&f.amendmentKind!=="initial"&&after(f.recordedAt)).map(f=>f.id);
  const supporting=evaluation.observations.filter(o=>o.direction==="supporting").flatMap(o=>o.factIds),weakening=evaluation.observations.filter(o=>o.direction==="weakening").flatMap(o=>o.factIds);
  const tests=evaluateThesisTests(value),overallEvidence=aggregateThesisTests(tests,value.model.thesisEvidencePlan);
  return {status:"DRAFT",tests,overallEvidence,originalThesis:b,dimension:b.thesisDimension??"custom_unknown",newDisclosureEvidence,newlyExtractedOldEvidence,corrections,observations:evaluation.observations,conflictingEvidence:supporting.length&&weakening.length?[...supporting,...weakening]:[],evidenceSinceThesis:[...new Set([...newDisclosureEvidence,...newlyExtractedOldEvidence,...corrections])],supporting,weakening,counterevidence:[],unknown:[...evaluation.unknown,value.unknown.text],assessment:evaluation.assessment,explanation:evaluation.explanation,nextValidationEvent:value.nextResearchQuestion};
}
export function validThesisRevision(v:unknown):v is ThesisRevision {
  if(!v||typeof v!=="object"||Array.isArray(v))return false;const r=v as ThesisRevision;
  return ["DRAFT","OWNER_CONFIRMED"].includes(r.status)&&["supports","partially_supports","weakens","invalidates","insufficient_evidence"].includes(r.assessment)
    && [r.evidenceFactIds,r.retainedEvidence,r.weakenedParts,r.addedHypotheses,r.abandonedHypotheses].every(a=>Array.isArray(a)&&a.length<=100&&a.every(s=>typeof s==="string"&&s.length<=4000))
    && [r.newThesis,r.reason,r.nextValidationEvent].every(s=>typeof s==="string"&&s.trim().length>0&&s.length<=4000)
    && typeof r.previousValidationEvent==="string";
}
export function thesisChangeSummary(revision:ThesisRevision) {
  return {changed:revision.previous.conditionText.trim()!==revision.newThesis.trim(),oldReason:revision.previous.conditionText,newReason:revision.newThesis,
    addedHypotheses:revision.addedHypotheses,abandonedHypotheses:revision.abandonedHypotheses,
    validationChanged:revision.previousValidationEvent!==revision.nextValidationEvent,
    message:"当前继续研究的核心理由与旧版本存在文本变化；请并列核对证据和假设，不代表心理判断。"};
}
export interface ResearchUpdateNotice {change?:ResearchChangeEvent; effectiveAt?:string; id:string;symbol:string;membershipId:string;membershipVersion:number;reasoningFingerprint:string;triggerType:"research_update";title:string;summary:string;nextQuestion:string}
/** Excludes request time and moving quote price: a stable research state has one notice. */
export function researchUpdateNotice(v:ResearchOperatingReasoning,asOf=v.calculation?.asOf??""):ResearchUpdateNotice {
  const state={facts:v.facts.map(f=>({id:f.id,revision:f.revision,source:f.source})),binding:v.model.thesisBinding,assessment:v.thesisUpdate?.assessment??null,counterevidence:v.thesisUpdate?.counterevidence??[],unknown:v.unknown.text,scenarios:v.scenarios.map(s=>({name:s.name,status:s.status})),reverse:v.reverseValuation.status,guidance:v.guidance?.map(g=>({id:g.guidanceId,status:g.status,due:g.expectedVerificationDate,verificationDue:asOf.slice(0,10)>=g.expectedVerificationDate}))??[]};
  const fingerprint=operatingModelFingerprint(state);
  return {id:operatingModelFingerprint({symbol:v.symbol,membershipVersion:v.membershipVersion,reasoningFingerprint:fingerprint,thesisBinding:v.model.thesisBinding,triggerType:"research_update"}),symbol:v.symbol,membershipId:v.membershipId,membershipVersion:v.membershipVersion,reasoningFingerprint:fingerprint,triggerType:"research_update",title:"Research Update · 研究变化",summary:`${v.fact.text}；传导停在 ${v.profitTransmission.stoppedAt==="asp_product_mix"?"ASP / 实际售价":v.profitTransmission.stoppedAt??"因果核查"}。`,nextQuestion:v.nextResearchQuestion};
}
export function gapReason(metric:string,facts:OperatingFact[],anchor:OperatingFact):GapReason {
  const candidates=facts.filter(f=>f.metric===(metric==="asp_product_mix"?"average_selling_price":metric));
  if(!candidates.length)return "SOURCE_NOT_FOUND";
  if(!candidates.some(f=>f.period.start===anchor.period.start&&f.period.end===anchor.period.end))return "PERIOD_MISMATCH";
  if(!candidates.some(f=>f.businessScope===anchor.businessScope))return "SCOPE_MISMATCH";
  return "MEASUREMENT_MISMATCH";
}

export interface ResearchChangeEvent {
  id:string;triggerType:"new_disclosure"|"old_evidence_extracted"|"verification_upgrade"|"evidence_correction"|"evidence_invalidation"|"thesis_revision"|"thesis_assessment_change"|"guidance_verification"|"guidance_revision"|"unknown_closed"|"scenario_invalidation"|"research_model_update"|"weekly_review"|"question_resolved"|"question_reopened"|"thesis_test_changed";
  beforeFingerprint:string|null;afterFingerprint:string;changedFactIds:string[];changedGapReasons:string[];
  previousAssessment:string|null;currentAssessment:string|null;previousScenarioStatus:string|null;currentScenarioStatus:string;
  guidanceEvent:string|null;thesisRevisionEvent:string|null;effectiveAt:string;sourceIds:string[];summary:string;
}
export function researchStateFingerprint(v:ResearchOperatingReasoning):string {
  return operatingModelFingerprint({symbol:v.symbol,membership:v.membershipId,version:v.membershipVersion,facts:v.facts.map(f=>({id:f.id,revision:f.revision})),binding:v.model.thesisBinding,revision:v.model.thesisRevision??null,tests:v.thesisUpdate?.tests??[],questions:v.researchQuestions??[],assessment:v.thesisUpdate?.assessment??null,gaps:v.gaps??[],model:v.model});
}
export function buildResearchChange(previous:ResearchOperatingReasoning|null,current:ResearchOperatingReasoning,trigger:ResearchChangeEvent["triggerType"],effectiveAt:string,beforeIdentity?:string,previousQuestions:ResearchQuestion[]=previous?.researchQuestions??[],eventSourceIds:string[]=[]):ResearchChangeEvent {
  const before=previous?researchStateFingerprint(previous):beforeIdentity??null,after=researchStateFingerprint(current);
  const changed=current.facts.filter(f=>!previous?.facts.some(p=>p.id===f.id&&p.revision===f.revision));
  const removed=previous?.facts.filter(f=>!current.facts.some(c=>c.id===f.id))??[];
  const oldAssessment=previous?.thesisUpdate?.assessment??null,newAssessment=current.thesisUpdate?.assessment??null;
  const closed=(previous?.gaps??[]).filter(g=>!current.gaps?.some(c=>c.metric===g.metric));
  const revision=current.model.thesisRevision;
  const resolved=current.researchQuestions?.filter(q=>q.status==="RESOLVED"&&previousQuestions.some(p=>p.questionId===q.questionId&&p.status!=="RESOLVED"))??[];
  const prefix:Record<ResearchChangeEvent["triggerType"],string>={question_reopened:"研究问题重新打开：原有证据已修订或不再满足严格口径，需重新核查",thesis_test_changed:`Thesis Test 结果变化：${current.thesisUpdate?.tests?.map(t=>`${t.test.metrics.join(" / ")} ${t.result}`).join("；")??"待配置"}；整体原判断仍按明确汇总规则复核`,question_resolved:`研究问题已有证据回答：${resolved.map(q=>q.question).join("；")}；仍需 Owner 复核原 Thesis`,new_disclosure:"新增公司披露",old_evidence_extracted:"旧资料新结构化（不是今天的新披露）",verification_upgrade:"同一经济事实的来源和结构核对已升级；数值与口径未改变",evidence_invalidation:"Evidence retracted or invalid; reopen affected research questions",evidence_correction:"原先依赖的结构化证据被修订，请核对差异与来源",thesis_revision:"Owner 研究判断已修订；系统证据评估与 Owner 判断分别保留",thesis_assessment_change:`Thesis 证据评估：${oldAssessment??"UNBOUND"} → ${newAssessment??"UNBOUND"}`,guidance_verification:"Guidance 已进入研究跟进窗口，核对同口径 Actual",guidance_revision:"管理层 Guidance 记录发生修订，查看原指引与更新来源",unknown_closed:`研究缺口已关闭：${closed.map(g=>g.metric).join("、")}`,research_model_update:"Owner 研究模型或检验范围已更新；查看显式假设变化",scenario_invalidation:"情景引用的证据已被替代，需要复核",weekly_review:"周频异常发现证据待复核，不自动修改 Thesis 或估值"};
  const data={triggerType:trigger,beforeFingerprint:before,afterFingerprint:after,changedFactIds:[...new Set([...changed,...removed].map(f=>f.id))],changedGapReasons:[...new Set([...(previous?.gaps??[]),...(current.gaps??[])].filter(g=>!previous?.gaps?.some(p=>p.metric===g.metric&&p.reason===g.reason)||!current.gaps?.some(c=>c.metric===g.metric&&c.reason===g.reason)).map(g=>`${g.metric}:${g.reason}`))],previousAssessment:oldAssessment,currentAssessment:newAssessment,previousScenarioStatus:previous?.scenarios.map(s=>`${s.name}:${s.status}`).join()??null,currentScenarioStatus:current.scenarios.map(s=>`${s.name}:${s.status}`).join(),guidanceEvent:trigger.startsWith("guidance")?trigger:changed.some(f=>f.category==="guidance")?"guidance_evidence_changed":null,thesisRevisionEvent:trigger==="thesis_revision"?revision?.confirmedAt??null:null,effectiveAt,sourceIds:[...new Set([...changed,...removed].map(f=>f.source.materialId).concat(eventSourceIds))],summary:prefix[trigger]+(changed.length?` · ${changed.map(f=>`${f.category==="guidance"?"GUIDANCE · ":""}${f.mix?.dimensionValue??({sales_volume:"销量",revenue:"收入",gross_profit:"毛利润",operating_cash_flow:"经营现金流"} as Record<string,string>)[f.metric]??f.metric} ${(f.value*f.unitScale).toLocaleString("en-US")}`).slice(0,3).join("；")}`:"")};
  return {id:operatingModelFingerprint({symbol:current.symbol,membership:current.membershipId,version:current.membershipVersion,...data}),...data};
}
