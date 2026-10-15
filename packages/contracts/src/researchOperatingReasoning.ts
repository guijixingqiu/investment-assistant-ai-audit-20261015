import type {OperatingAnchorSelection} from "./researchOperatingAnchor.js";
import {evidenceSeries,type EvidenceSeries} from "./researchEvidenceSeries.js";
import { evaluateThesisTests, aggregateThesisTests } from "./researchThesisTests.js";
import type { ResearchQuestion } from "./researchQuestions.js";
import type { StructuredFactCandidate } from "./researchFactCandidates.js";
import { canonicalJson } from "./decisionContextBrowser.js";
import { sha256Hex } from "./sha256.js";
import type { GuidanceComparison } from "./researchGuidance.js";
import type { ThesisUpdateDraft, ResearchUpdateNotice, GapReason } from "./researchDecisionUpdate.js";
import { calculateProductMix, type ProductMixShare } from "./researchProductMix.js";
import type { DeepResearchWorkspaceEnvelope } from "./deepResearch.js";
import type { ResearchMaterialData } from "./researchMaterial.js";
import { operatingModelFingerprint, validateOperatingModel, validOperatingPeriod, type OperatingFact, type OperatingNode, type OperatingResearchModel, type OperatingScenarioResult, type OperatingReverseValuation, type ExplicitThesisBinding } from "./researchOperatingModel.js";
import { calculateSensitivity, calculateConditionalRequirements, transmissionNodes, buildProfitBridge, buildSharesReference, calculateOperatingScenarios, calculateReverseValuation, type ProfitBridge } from "./researchOperatingCalculations.js";

export interface ResearchOperatingReasoning {
  kind:"operating_valuation_draft"; generationMethod:"deterministic_evidence_framework";
  actorId:string;membershipId:string;membershipVersion:number;symbol:string;
  growthFactId:string|null;anchorSelection?:OperatingAnchorSelection;
  contextCreatedAt?:string;thesisReportCreatedAt?:string;
  contextId:string|null; inputFingerprint:string;
  calculation?: {version: "operating-calculation-v1"; marketCurrency: string|null; asOf:string; fingerprint:string; canonicalPayload:string};
  evidenceSeries?:EvidenceSeries[];
  assertionHistory?:OperatingFact[];
  facts:OperatingFact[];
  factCandidates?:StructuredFactCandidate[];
  researchQuestions?:ResearchQuestion[];
  sensitivity?:ReturnType<typeof calculateSensitivity>;
  conditionalRequirements?:ReturnType<typeof calculateConditionalRequirements>;
  productMix?:ProductMixShare[];
  thesisUpdate?:ThesisUpdateDraft|null;
  researchUpdate?:ResearchUpdateNotice;
  guidance?:GuidanceComparison[];
  gaps?:Array<{metric:string;reason:GapReason}>;
  fact:OperatingFact & {materialId:string;contentFingerprint:string;text:string};
  operatingMeaning:{semanticType:"INTERPRETATION";text:string};
  profitTransmission:{semanticType:"HYPOTHESIS";text:string;stoppedAt:string|null;profitGrowthConclusionAllowed:false;steps:OperatingNode[]};
  thesisImpact:({hypothesis:string;assessment:"supports"|"partially_supports"|"weakens"|"invalidates"|"insufficient_evidence";explanation:string;mutation:"none"}&ExplicitThesisBinding)|null;
  thesisOptions:ExplicitThesisBinding[];
  unknown:{semanticType:"UNKNOWN";text:string}; nextResearchQuestion:string;
  questions:Array<{priority:number;question:string;reason:string}>;
  sharesReference:OperatingNode|null;
  profitBridge:ProfitBridge|null; model:OperatingResearchModel;
  scenarios:OperatingScenarioResult[];reverseValuation:OperatingReverseValuation;
}

export function explicitThesisOptions(workspace:DeepResearchWorkspaceEnvelope):ExplicitThesisBinding[] {
  const data=workspace.data;if(!data)return [];
  return data.reports.flatMap(report=>{
    const payload=report.payload;
    if(!("adviceLayer" in payload) || !("evidencePackBinding" in payload))return [];
    const binding=payload.evidencePackBinding;
    if(binding.symbol!==data.target.symbol || binding.membershipId!==data.target.membershipId || binding.membershipVersion!==data.target.membershipVersion || !/^[a-f0-9]{64}$/.test(report.reportFingerprint) || report.currentness.invalidatedBy.some(r=>["report_fingerprint_invalid","evidence_pack_identity_mismatch"].includes(r)))return [];
    return payload.adviceLayer.longTerm.conditions.map((conditionText,conditionIndex)=>({reportId:report.id,reportVersion:report.version,reportFingerprint:report.reportFingerprint,conditionIndex,conditionText}));
  });
}
export function reasoningFingerprint(value:Omit<ResearchOperatingReasoning,"inputFingerprint">|ResearchOperatingReasoning):string {
  const {inputFingerprint:_hash,...content}=value as ResearchOperatingReasoning;return operatingModelFingerprint(content);
}
/** Source classification never promotes the explanation. Missing explicit selection remains unbound. */
export function operatingReasoningMatches(value:unknown,workspace:DeepResearchWorkspaceEnvelope):value is ResearchOperatingReasoning {
  if(!record(value)||!workspace.data||workspace.status!=="available")return false;
  const target=workspace.data.target;
  if(value.kind!=="operating_valuation_draft"||value.generationMethod!=="deterministic_evidence_framework"||value.actorId!==workspace.requestedActorId||value.membershipId!==target.membershipId||value.membershipVersion!==target.membershipVersion||value.symbol!==target.symbol||workspace.requestedSymbol!==target.symbol||workspace.membershipId!==target.membershipId||target.membershipState!=="tracked")return false;
  if(!Array.isArray(value.facts)||!value.facts.length||!value.facts.every(f=>validFact(f,workspace)))return false;
  if(value.factCandidates!==undefined&&(!Array.isArray(value.factCandidates)||!value.factCandidates.every(c=>validCandidate(c,value as unknown as ResearchOperatingReasoning))))return false;
  const fact=value.fact;
  if(!record(fact)||!value.facts.some(f=>record(f)&&f.id===fact.id&&record(f.source)
    &&f.source.materialId===fact.materialId&&operatingModelFingerprint(f.source)===operatingModelFingerprint(fact.source)))return false;
  if(!record(value.operatingMeaning)||value.operatingMeaning.semanticType!=="INTERPRETATION"||!record(value.unknown)||value.unknown.semanticType!=="UNKNOWN")return false;
  const t=value.profitTransmission;
  if(!record(t)||t.semanticType!=="HYPOTHESIS"||t.profitGrowthConclusionAllowed!==false||!Array.isArray(t.steps)||!t.steps.every(validNode))return false;
  if(!validateOperatingModel(value.model).ok)return false;
  const binding=(value.model as unknown as OperatingResearchModel).thesisBinding;
  if(binding===null ? value.thesisImpact!==null : !record(value.thesisImpact)||value.thesisImpact.mutation!=="none"||!explicitThesisOptions(workspace).some(b=>sameThesisIdentity(b,binding)))return false;
  if(!thesisResultsMatch(value as unknown as ResearchOperatingReasoning))return false;
  return validateOperatingCalculations(value as unknown as ResearchOperatingReasoning, workspace.generatedAt) && value.inputFingerprint===reasoningFingerprint(value as unknown as ResearchOperatingReasoning);
}
function validFact(v:unknown,w:DeepResearchWorkspaceEnvelope):boolean {
  if(!record(v)||!record(v.source)||!validOperatingPeriod(v.period)||v.semanticType!=="FACT"||v.derivationMethod!=="source_transcription"||typeof v.value!=="number"||!Number.isFinite(v.value)||v.symbol!==w.requestedSymbol||v.membershipId!==w.membershipId||v.membershipVersion!==w.data!.target.membershipVersion)return false;
  const source=v.source,material=w.data!.materials.find(m=>m.id===source.materialId);
  return !!material&&material.symbol===v.symbol&&material.revision===source.revision&&material.contentFingerprint===source.contentFingerprint&&material.revisionState==="current"&&material.claimType===source.sourceClassification&&material.verificationStatus===source.verificationStatus&&["issuer_statement","verified_fact"].includes(material.claimType)&&["unverified","verified"].includes(material.verificationStatus)&&["authorized_public","user_provided"].includes(material.rightsStatus)&&["verified","owner_confirmed","source_text_verified"].includes(String(source.assertionVerificationStatus))&&Date.parse(String(source.publishedAt))<=Date.parse(w.generatedAt)&&(v.category==="guidance"||String(v.period.end)<=w.generatedAt.slice(0,10))&&validFactSource(source,material);
}
function validFactSource(source:Record<string,unknown>,material:ResearchMaterialData):boolean {
  return source.snapshotCitation!==undefined || material.sourceType==="issuer_public_html"
    ? validSnapshotFactSource(source,material) : validPdfFactSource(source,material);
}
function validSnapshotFactSource(source:Record<string,unknown>,material:ResearchMaterialData):boolean {
    if(material.sourceType!=="issuer_public_html" || !record(source.snapshotCitation)
      || !record(source.snapshotOriginal) || !record(source.snapshotTextBinding)
      || !material.snapshotCitation || !material.snapshotOriginal
      || ["documentId","pageNumber","pageTextSha256","documentPdfSha256","textBinding"].some(key=>Object.hasOwn(source,key)))return false;
    const span=source.snapshotCitation,binding=source.snapshotTextBinding,original=source.snapshotOriginal;
    if(Object.keys(span).sort().join()!==["kind","snapshotId","textSha256","startUtf16","endUtf16","excerptSha256"].sort().join()
      || Object.keys(binding).sort().join()!==["snapshotId","textSha256","startUtf16","endUtf16","excerptSha256","sourceExcerpt","rawValueText"].sort().join()
      || Object.keys(original).sort().join()!==["rawSha256","byteLength","mediaType","canonicalUrl","responseUrl"].sort().join()
      || span.kind!=="source_snapshot" || !/^[1-9]\d*$/.test(String(span.snapshotId))
      || !Number.isSafeInteger(span.startUtf16) || Number(span.startUtf16)<0
      || !Number.isSafeInteger(span.endUtf16) || Number(span.endUtf16)<=Number(span.startUtf16)
      || Number(span.endUtf16)-Number(span.startUtf16)!==material.contentText.length
      || ![span.textSha256,span.excerptSha256,original.rawSha256].every(value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value))
      || span.excerptSha256!==sha256Hex(material.contentText)
      || !Number.isSafeInteger(original.byteLength) || Number(original.byteLength)<1
      || original.mediaType!=="text/html" || typeof original.canonicalUrl!=="string"
      || typeof original.responseUrl!=="string" || !original.canonicalUrl.startsWith("https://")
      || !original.responseUrl.startsWith("https://") || source.sourceUrl!==original.responseUrl
      || binding.sourceExcerpt!==material.contentText || typeof binding.rawValueText!=="string"
      || !binding.rawValueText.trim() || !material.contentText.includes(binding.rawValueText))return false;
    return canonicalJson(span)===canonicalJson(material.snapshotCitation)
      && canonicalJson(original)===canonicalJson(material.snapshotOriginal)
      && ["snapshotId","textSha256","startUtf16","endUtf16","excerptSha256"].every(key=>span[key]===binding[key]);
}
function validPdfFactSource(source:Record<string,unknown>,material:ResearchMaterialData):boolean {
  return !["snapshotCitation","snapshotOriginal","snapshotTextBinding"].some(key=>Object.hasOwn(source,key))
    && typeof source.documentId==="string" && /^[1-9]\d*$/.test(source.documentId)
    && Number.isSafeInteger(source.pageNumber) && Number(source.pageNumber)>0
    && [source.pageTextSha256,source.documentPdfSha256].every(value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value))
    && (!material.citation || material.citation.documentId===source.documentId
      && material.citation.pageNumber===source.pageNumber
      && material.citation.pageTextSha256===source.pageTextSha256)
    && (!Object.hasOwn(source,"textBinding") || record(source.textBinding)
      && Object.keys(source.textBinding).sort().join()===
        ["documentId","pageNumber","pageTextSha256","sourceExcerpt","rawValueText"].sort().join()
      && typeof source.textBinding.sourceExcerpt==="string" && !!source.textBinding.sourceExcerpt.trim()
      && typeof source.textBinding.rawValueText==="string" && !!source.textBinding.rawValueText.trim()
      && source.textBinding.sourceExcerpt.includes(source.textBinding.rawValueText)
      && source.textBinding.documentId===source.documentId
      && source.textBinding.pageNumber===source.pageNumber
      && source.textBinding.pageTextSha256===source.pageTextSha256);
}
function validNode(v:unknown):boolean {return record(v)&&["FACT","INTERPRETATION","HYPOTHESIS","UNKNOWN"].includes(String(v.semanticType))&&validOperatingPeriod(v.period)&&(v.semanticType==="UNKNOWN"?v.value===null:typeof v.value==="number"&&Number.isFinite(v.value))&&(v.derivationMethod!=="deterministic_calculation"||v.semanticType==="INTERPRETATION");}
function record(v:unknown):v is Record<string,unknown>{return typeof v==="object"&&v!==null&&!Array.isArray(v);}

/** Reuses the only financial formulas. A rehashed corrupt result still fails. */
export function canonicalOperatingCalculations(value: ResearchOperatingReasoning, asOf: string, marketCurrency: string|null) {
  const anchor=value.facts.find(f=>f.id===value.fact.id);
  if(!anchor) return null;
  const scenarios=calculateOperatingScenarios(value.model,value.facts,marketCurrency);
  const reverse=calculateReverseValuation(value.model,value.facts,value.reverseValuation.observed,scenarios,asOf);
  return {...(value.evidenceSeries?{evidenceSeries:evidenceSeries(value.assertionHistory??value.facts)}:{}),sensitivity:calculateSensitivity(value.model,value.facts,marketCurrency),conditionalRequirements:calculateConditionalRequirements(value.model,reverse,scenarios),productMix:calculateProductMix(value.facts,anchor),transmission:transmissionNodes(value.facts,anchor),profitBridge:buildProfitBridge(value.facts),
    scenarios,sharesReference:buildSharesReference(value.model,value.facts),
    reverseValuation:calculateReverseValuation(value.model,value.facts,value.reverseValuation.observed,scenarios,asOf)};
}
export function calculationProofPayload(value:ResearchOperatingReasoning, asOf:string, marketCurrency:string|null):string {
  return canonicalJson({calculationVersion:"operating-calculation-v1",formulaIdentity:"transmission/profitBridge/scenarios/shares/reverse:v1",
    inputs:{...(value.assertionHistory?{assertionHistory:value.assertionHistory}:{}),facts:value.facts,model:value.model,observed:value.reverseValuation.observed,asOf,marketCurrency},
    result:canonicalOperatingCalculations(value,asOf,marketCurrency)});
}
export function calculationFingerprint(value:ResearchOperatingReasoning, asOf:string, marketCurrency:string|null):string {
  return sha256Hex(calculationProofPayload(value,asOf,marketCurrency));
}
export function validateOperatingCalculations(value:ResearchOperatingReasoning, asOf:string):boolean {
  const proof=value.calculation;
  if(!proof || proof.version!=="operating-calculation-v1" || proof.asOf!==asOf) return false;
  const expected=canonicalOperatingCalculations(value,asOf,proof.marketCurrency);
  if(!expected)return false;
  const actual={...(value.evidenceSeries?{evidenceSeries:value.evidenceSeries}:{}),sensitivity:value.sensitivity??[],conditionalRequirements:value.conditionalRequirements,productMix:value.productMix??[],transmission:value.profitTransmission.steps,profitBridge:value.profitBridge,scenarios:value.scenarios,
    sharesReference:value.sharesReference,reverseValuation:value.reverseValuation};
  return operatingModelFingerprint(expected)===operatingModelFingerprint(actual)
    && proof.canonicalPayload===calculationProofPayload(value,asOf,proof.marketCurrency)
    && proof.fingerprint===calculationFingerprint(value,asOf,proof.marketCurrency);
}

export function sameThesisIdentity(a:ExplicitThesisBinding,b:ExplicitThesisBinding):boolean {
  return a.reportId===b.reportId&&a.reportVersion===b.reportVersion&&a.reportFingerprint===b.reportFingerprint&&a.conditionIndex===b.conditionIndex&&a.conditionText===b.conditionText;
}

function validCandidate(candidate:unknown,v:ResearchOperatingReasoning):boolean {
  if(!record(candidate)||candidate.status!=="CANDIDATE"||candidate.symbol!==v.symbol||candidate.membershipId!==v.membershipId||candidate.membershipVersion!==v.membershipVersion)return false;
  return typeof candidate.documentId==="string"&&/^[1-9][0-9]*$/.test(candidate.documentId)&&typeof candidate.pageNumber==="number"&&candidate.pageNumber>0&&typeof candidate.pageTextSha256==="string"&&/^[a-f0-9]{64}$/.test(candidate.pageTextSha256)&&typeof candidate.documentPdfSha256==="string"&&/^[a-f0-9]{64}$/.test(candidate.documentPdfSha256);
}

function thesisResultsMatch(value:ResearchOperatingReasoning):boolean {
  if(!value.model.thesisBinding)return value.thesisUpdate===null;
  if(!value.thesisUpdate?.tests||!value.thesisUpdate.overallEvidence)return false;
  const tests=evaluateThesisTests(value),overall=aggregateThesisTests(tests,value.model.thesisEvidencePlan);
  return operatingModelFingerprint(value.thesisUpdate.tests)===operatingModelFingerprint(tests)&&operatingModelFingerprint(value.thesisUpdate.overallEvidence)===operatingModelFingerprint(overall)&&value.thesisUpdate.assessment===(overall.assessment??"insufficient_evidence");
}
