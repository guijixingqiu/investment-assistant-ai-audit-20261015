import { buildProfitBridge } from "./researchOperatingCalculations.js";
import { evaluateThesisTests, aggregateThesisTests } from "./researchThesisTests.js";
import type { ResearchOperatingReasoning } from "./researchOperatingReasoning.js";
export interface ThesisObservation {metric:string; current:number|null; previous:number|null; change:number|null; factIds:string[]; direction:"supporting"|"weakening"|"unknown"; limitation:string}
export interface ThesisEvaluation {assessment:"supports"|"partially_supports"|"weakens"|"invalidates"|"insufficient_evidence";observations:ThesisObservation[];explanation:string;unknown:string[]}
/** Compatibility projection. Individual test verdicts never silently become an overall Thesis verdict. */
export function evaluateThesis(v:ResearchOperatingReasoning):ThesisEvaluation {
  const tests=evaluateThesisTests(v),overall=aggregateThesisTests(tests,v.model.thesisEvidencePlan);
  return {assessment:overall.assessment??"insufficient_evidence",explanation:overall.explanation+cashProfitDivergence(v),
    observations:tests.flatMap(t=>t.observations.map(o=>({metric:o.metric,current:o.observed,previous:o.previous,change:o.change,factIds:o.evidenceIds,direction:o.result==="PASS"?"supporting" as const:o.result==="FAIL"?"weakening" as const:"unknown" as const,limitation:o.limitation}))),
    unknown:tests.length?tests.flatMap(t=>t.missingMetrics.map(m=>`${m} 缺少所选比较规则需要的证据`)):["尚未配置明确的 Thesis Test"]};
}

function cashProfitDivergence(v:ResearchOperatingReasoning):string {
  const rows=buildProfitBridge(v.facts)?.rows??[],ocf=rows.find(r=>r.metric==="operating_cash_flow"),profit=rows.find(r=>r.metric==="profit_attributable_to_owners");
  return ocf?.change!==null&&ocf?.change!==undefined&&profit?.change!==null&&profit?.change!==undefined&&ocf.change*profit.change<0?" 经营现金流与法定利润方向分歧，不能据此汇总为盈利质量改善。":"";
}
