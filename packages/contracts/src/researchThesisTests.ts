import {requirementMismatch,validEvidenceRequirement,type EvidenceRequirement} from "./researchFactIdentity.js";
import {evidenceSeries,previousComparableObservation} from "./researchEvidenceSeries.js";
import { operatingModelFingerprint, type ExplicitThesisBinding, type OperatingPeriod } from "./researchOperatingModel.js";
import type { ResearchOperatingReasoning } from "./researchOperatingReasoning.js";
export type OriginalThesisIdentity=Pick<ExplicitThesisBinding,"reportId"|"reportVersion"|"reportFingerprint"|"conditionIndex"|"conditionText">;
export const THESIS_COMPARISONS=["above_zero","below_zero","increase_vs_previous","decrease_vs_previous","at_least","at_most","range","directional_change"] as const;
export interface ThesisTest {
  evidenceRequirements?:Record<string,EvidenceRequirement>;
  testId:string; originalThesisIdentity:OriginalThesisIdentity; dimension:NonNullable<ExplicitThesisBinding["thesisDimension"]>;
  metrics:string[];periodType:OperatingPeriod["type"];comparison:typeof THESIS_COMPARISONS[number];
  direction:"increase"|"decrease";threshold:number|{lower:number;upper:number}|null;mixNode:string|null;
  referencePeriod?:"previous_period"|"previous_year";status:"DRAFT"|"ACTIVE"|"ARCHIVED";
}
export interface ThesisEvidencePlan {requiredTestIds:string[];aggregationRule:"all_required"|"any_required"|"owner_review"}
export type ThesisTestVerdict="PASS"|"PARTIAL"|"FAIL"|"UNKNOWN"|"CONFLICTED";
export interface ThesisTestObservation {metric:string;observed:number|null;previous:number|null;change:number|null;threshold:ThesisTest["threshold"];comparison:ThesisTest["comparison"];result:ThesisTestVerdict;evidenceIds:string[];limitation:string}
export interface ThesisTestResult {test:ThesisTest;legacy:boolean;result:ThesisTestVerdict;observations:ThesisTestObservation[];missingMetrics:string[];explanation:string}
export interface OverallThesisEvidence {status:"OWNER_REVIEW_REQUIRED"|"CONFIGURED_EVIDENCE_SUMMARY";aggregationRule:ThesisEvidencePlan["aggregationRule"];requiredTestIds:string[];assessment:"supports"|"partially_supports"|"weakens"|"insufficient_evidence"|null;mutation:"none";explanation:string}
export function originalThesisIdentity(b:ExplicitThesisBinding):OriginalThesisIdentity {return {reportId:b.reportId,reportVersion:b.reportVersion,reportFingerprint:b.reportFingerprint,conditionIndex:b.conditionIndex,conditionText:b.conditionText};}
function validOriginalIdentity(b:OriginalThesisIdentity):boolean {
  if(!b||Object.keys(b).sort().join()!==["reportId","reportVersion","reportFingerprint","conditionIndex","conditionText"].sort().join()||!/^[1-9]\d*$/.test(b.reportId)||!Number.isSafeInteger(b.reportVersion)||b.reportVersion<1||!Number.isSafeInteger(b.conditionIndex)||b.conditionIndex<0||!b.conditionText||!/^[a-f0-9]{64}$/.test(b.reportFingerprint))return false;
  return true;
}
export function validThesisTest(t:unknown):t is ThesisTest {
  if(!t||typeof t!=="object"||Array.isArray(t))return false;const v=t as ThesisTest,b=v.originalThesisIdentity;
  if(Object.keys(v).some(k=>!["testId","originalThesisIdentity","dimension","metrics","periodType","comparison","direction","threshold","mixNode","referencePeriod","status","evidenceRequirements"].includes(k)))return false;
  if(!validOriginalIdentity(b))return false;
  if(typeof v.testId!=="string"||!v.testId.trim()||v.testId.length>200||!THESIS_COMPARISONS.includes(v.comparison)||!["DRAFT","ACTIVE","ARCHIVED"].includes(v.status)||!["increase","decrease"].includes(v.direction)||!Array.isArray(v.metrics)||!v.metrics.length||v.metrics.length>10||new Set(v.metrics).size!==v.metrics.length||!v.metrics.every(m=>typeof m==="string"&&/^[a-z_]+$/.test(m)))return false;
  if(!["sales_growth","product_mix","profitability","cash_flow","non_operating_quality","valuation_evidence","custom_unknown"].includes(v.dimension)||!["monthly","interim","annual","ytd","weekly","instant","other"].includes(v.periodType)||!(v.mixNode===null||typeof v.mixNode==="string")||(v.referencePeriod!==undefined&&!["previous_period","previous_year"].includes(v.referencePeriod)))return false;
  if(v.evidenceRequirements!==undefined&&(!v.evidenceRequirements||typeof v.evidenceRequirements!=="object"||Array.isArray(v.evidenceRequirements)||Object.keys(v.evidenceRequirements).some(k=>!v.metrics.includes(k))||!Object.values(v.evidenceRequirements).every(validEvidenceRequirement)))return false;
  if(v.comparison==="range")return !!v.threshold&&typeof v.threshold==="object"&&Object.keys(v.threshold).sort().join()==="lower,upper"&&Number.isFinite(v.threshold.lower)&&Number.isFinite(v.threshold.upper)&&v.threshold.lower<=v.threshold.upper;
  if(["at_least","at_most"].includes(v.comparison))return typeof v.threshold==="number"&&Number.isFinite(v.threshold);
  return ["above_zero","below_zero"].includes(v.comparison)?v.threshold===null||v.threshold===0:v.threshold===null;
}
export function validThesisPlan(p:unknown,tests:ThesisTest[]):p is ThesisEvidencePlan {
  if(!p||typeof p!=="object"||Array.isArray(p))return false;const v=p as ThesisEvidencePlan;
  return Object.keys(v).sort().join()===["requiredTestIds","aggregationRule"].sort().join()&&["all_required","any_required","owner_review"].includes(v.aggregationRule)&&Array.isArray(v.requiredTestIds)&&new Set(v.requiredTestIds).size===v.requiredTestIds.length&&(v.aggregationRule==="owner_review"||v.requiredTestIds.length>0)&&v.requiredTestIds.every(id=>tests.some(t=>t.testId===id&&t.status!=="ARCHIVED"));
}
export function projectedThesisTests(v:ResearchOperatingReasoning):Array<{test:ThesisTest;legacy:boolean}> {
  if(v.model.thesisTests)return v.model.thesisTests.filter(t=>t.status!=="ARCHIVED").map(test=>({test,legacy:false}));
  const b=v.model.thesisBinding;
  if(b?.thesisDimension==="valuation_evidence"&&!b.proposition)return [{legacy:true,test:{testId:"legacy-valuation-inputs",originalThesisIdentity:originalThesisIdentity(b),dimension:"valuation_evidence",metrics:["valuation_inputs_ready"],periodType:"instant",comparison:"at_least",direction:"increase",threshold:1,mixNode:null,status:"DRAFT"}}];
  if(!b?.proposition)return [];
  const p=b.proposition,identity=originalThesisIdentity(b),sales=b.thesisDimension==="sales_growth";
  return [{legacy:true,test:{testId:"legacy-"+operatingModelFingerprint({identity,p}),originalThesisIdentity:identity,dimension:b.thesisDimension??"custom_unknown",metrics:p.metrics,periodType:p.periodType,comparison:sales?(p.direction==="increase"?"above_zero":"below_zero"):(p.direction==="increase"?"increase_vs_previous":"decrease_vs_previous"),direction:p.direction,threshold:sales?0:null,mixNode:p.mixNode??null,referencePeriod:"previous_year",status:"DRAFT"}}];
}
export function compareThesisObservation(test:ThesisTest,observed:number|null,previous:number|null):ThesisTestVerdict {
  if(observed===null||!Number.isFinite(observed))return "UNKNOWN";
  switch(test.comparison){
    case "above_zero":return observed>0?"PASS":"FAIL";
    case "below_zero":return observed<0?"PASS":"FAIL";
    case "at_least":return typeof test.threshold==="number"?(observed>=test.threshold?"PASS":"FAIL"):"UNKNOWN";
    case "at_most":return typeof test.threshold==="number"?(observed<=test.threshold?"PASS":"FAIL"):"UNKNOWN";
    case "range":return test.threshold&&typeof test.threshold==="object"?(observed>=test.threshold.lower&&observed<=test.threshold.upper?"PASS":"FAIL"):"UNKNOWN";
    default:if(previous===null||!Number.isFinite(previous))return "UNKNOWN";return (test.comparison==="increase_vs_previous"||test.comparison==="directional_change"&&test.direction==="increase"?observed>previous:observed<previous)?"PASS":"FAIL";
  }
}
function combine(results:ThesisTestVerdict[]):ThesisTestVerdict {if(!results.length)return "UNKNOWN";if(results.every(r=>r==="PASS"))return "PASS";if(results.every(r=>r==="FAIL"))return "FAIL";if(results.includes("PASS")&&results.includes("FAIL"))return "CONFLICTED";return results.includes("PASS")?"PARTIAL":"UNKNOWN";}
function needsPrevious(test:ThesisTest):boolean{return ["increase_vs_previous","decrease_vs_previous","directional_change"].includes(test.comparison);}
function observeMetric(v:ResearchOperatingReasoning,test:ThesisTest,metric:string):ThesisTestObservation {
  if(test.dimension==="valuation_evidence"&&metric==="valuation_inputs_ready"){
    const ready=v.reverseValuation.status==="available"&&v.scenarios.some(s=>s.name==="base"&&s.status==="complete");
    const observed=ready?1:null;
    return {metric,observed,previous:null,change:null,threshold:test.threshold,comparison:test.comparison,result:compareThesisObservation(test,observed,null),evidenceIds:v.sharesReference?.inputs??[],limitation:"只验证估值条件是否齐备，不评价高估低估或股价涨跌。"};
  }
  let observed:number|null=null,previous:number|null=null,evidenceIds:string[]=[];
  const allowed:Record<string,string[]>={sales_growth:["sales_volume_yoy","sales_volume"],profitability:["revenue","gross_margin","gross_profit","operating_profit","profit_attributable_to_owners","core_profit_attributable_to_owners"],cash_flow:["operating_cash_flow","free_cash_flow"],non_operating_quality:["fx_effect","non_financial_impairment","core_profit_attributable_to_owners","profit_attributable_to_owners"],product_mix:["mix_share"]};
  if(allowed[test.dimension]?.includes(metric)){
    const requirement=test.evidenceRequirements?.[metric];
    const matching=evidenceSeries(v.facts).filter(s=>requirement&&s.current&&!requirementMismatch({...s.identity,period:s.current.period},s.current.status==="COMPARABLE"?"comparable":"not_comparable",requirement)&&s.identity.metric===metric&&s.identity.periodType===test.periodType&&s.identity.category==="actual"&&(metric!=="mix_share"||s.identity.taxonomy?.dimensionValue===test.mixNode&&s.shareBasis==="total"));
    if(matching.length===1){const series=matching[0]!,current=series.current;
      const prior=current?previousComparableObservation(series.observations,current,test.referencePeriod??"previous_period"):null;
      observed=current?.value??null;previous=prior?.value??null;evidenceIds=[...(current?.inputs??[]),...(needsPrevious(test)?prior?.inputs??[]:[])];
    }
  }
  if(!needsPrevious(test))previous=null;
  return {metric,observed,previous,change:observed!==null&&previous!==null?observed-previous:null,threshold:["above_zero","below_zero"].includes(test.comparison)?0:test.threshold,comparison:test.comparison,result:compareThesisObservation(test,observed,previous),evidenceIds,limitation:metric==="free_cash_flow"?"现金流代理值不等于股东可分配现金":metric==="core_profit_attributable_to_owners"?"发行人核心盈利不等于正常化盈利":"此结果仅验证指定 Test，不代表整个原 Thesis 成立"};
}
export function evaluateThesisTests(v:ResearchOperatingReasoning):ThesisTestResult[] {
  return projectedThesisTests(v).map(({test,legacy})=>{
    const observations=test.metrics.map(metric=>observeMetric(v,test,metric));
    return {test,legacy,result:combine(observations.map(o=>o.result)),observations,missingMetrics:observations.filter(o=>o.result==="UNKNOWN").map(o=>o.metric),explanation:test.dimension==="custom_unknown"?"系统尚无确定性评价规则；保留 UNKNOWN，由 Owner 明确可检验的命题。":"只验证明确配置的条件；PASS 不等于整个原 Thesis 已支持。"};
  });
}
export function aggregateThesisTests(results:ThesisTestResult[],plan?:ThesisEvidencePlan):OverallThesisEvidence {
  const base={aggregationRule:plan?.aggregationRule??"owner_review" as const,requiredTestIds:plan?.requiredTestIds??[],mutation:"none" as const};
  if(!plan||plan.aggregationRule==="owner_review"||!plan.requiredTestIds.length)return {...base,status:"OWNER_REVIEW_REQUIRED",assessment:null,explanation:"验证结果可用；Owner 尚未明确配置汇总规则，原 Thesis 需要 Owner 复核。"};
  const required=plan.requiredTestIds.map(id=>results.find(r=>r.test.testId===id));
  const ready=required.every(r=>r!==undefined),allPass=ready&&required.every(r=>r!.result==="PASS"),anyPass=required.some(r=>r?.result==="PASS"),fail=required.some(r=>r?.result==="FAIL");
  if(required.some(r=>r?.result==="CONFLICTED")||anyPass&&fail)return {...base,status:"OWNER_REVIEW_REQUIRED",assessment:"partially_supports",explanation:"Required Tests 同时有 PASS 和 FAIL；冲突必须由 Owner 复核，不得以 any_required 忽略失败。"};
  const assessment=(plan.aggregationRule==="all_required"?allPass:ready&&anyPass)?"supports":fail?"weakens":"insufficient_evidence";
  return {...base,status:"CONFIGURED_EVIDENCE_SUMMARY",assessment,explanation:"仅按 Owner 显式 required tests 与规则汇总证据草稿，不修改正式 Thesis 或决定。"};
}
