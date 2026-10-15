import {validEvidenceRequirement,type FactIdentity,type EvidenceValidity,type ResearchRecency,type EvidenceRequirement} from "./researchFactIdentity.js";
import { validThesisTest, validThesisPlan, type ThesisTest, type ThesisEvidencePlan } from "./researchThesisTests.js";
import { validThesisRevision, type ThesisRevision } from "./researchDecisionUpdate.js";
import { canonicalJson } from "./decisionContextBrowser.js";
import { sha256Hex } from "./sha256.js";

export type ResearchSemanticType = "FACT" | "INTERPRETATION" | "HYPOTHESIS" | "UNKNOWN";
export interface ResearchAssertionMetadata {
  unit: "currency" | "currency_per_vehicle" | "vehicles" | "ratio" | "shares";
  measurementBasis: "financial_statement" | "issuer_sales" | "monthly_wholesale" | "monthly_retail" | "weekly_registration" | "issued_shares";
  businessScope: string;
  category: "actual" | "guidance";
  capturedSourceUrl?:string|null; ownerSuppliedReferenceUrl?:string|null;
  sourceUrl: string;
  limitation: string;
  sourceChecked: boolean;
  scopeOverride?:{originalScope:string;replacementScope:string;reason:string;confirmedBy:string;confirmedAt:string};
  structureConfirmation?: {confirmedFields:Array<"metric"|"period"|"currency"|"unitScale"|"scope"|"taxonomy">};
  structureBinding?: {structureExcerpt?:string; rowLabelText:string; columnHeaderText:string; unitHeaderText:string; scopeText?:string; ownerScopeConfirmed:boolean; taxonomyConfirmedBy?:string};
  verification?: {valueVerification:"source_text_verified"|"owner_confirmed"|"unverified"; structureVerification:"source_labels_verified"|"owner_confirmed"|"unverified"; checks:{metric:boolean;period:boolean;currency:boolean;unitScale:boolean;scope:boolean;taxonomy?:boolean}; taxonomyConfirmedBy:string|null; ownerConfirmation?:{confirmedFields:string[];confirmedBy:string;confirmedAt:string}};
  guidance?: {lower:number|null; upper:number|null; definition:string; expectedVerificationDate:string; targetType:"minimum"|"range"|"maximum"|"text"; statement:string};
  textBinding?: {documentId:string; pageNumber:number; pageTextSha256:string; sourceExcerpt:string; rawValueText:string};
  snapshotTextBinding?: {snapshotId:string; textSha256:string; startUtf16:number; endUtf16:number; excerptSha256:string; sourceExcerpt:string; rawValueText:string};
  provenanceKind?: "authorized_public_issuer_document"|"owner_uploaded_document"|"owner_manual_input"|"system_calculation";
  mix?: {dimension:"brand"|"powertrain"|"geography"; dimensionValue:string; parentScope:string; parentNode?:string; overlapPolicy?:"nested"|"mutually_exclusive"|"overlapping"};
}
export interface OperatingPeriod {
  kind: "duration" | "instant";
  type: "monthly" | "interim" | "annual" | "ytd" | "weekly" | "instant" | "other";
  start: string | null;
  end: string;
}
interface OperatingSourceBase {
  verification?:ResearchAssertionMetadata["verification"];
  structureBinding?:ResearchAssertionMetadata["structureBinding"];
  provenanceKind?:ResearchAssertionMetadata["provenanceKind"];
  materialId: string; revision: number; contentFingerprint: string; sourceClassification: string; verificationStatus: string;
  assertionVerificationStatus: "verified" | "unverified" | "owner_confirmed" | "source_text_verified";
  capturedSourceUrl?:string|null; ownerSuppliedReferenceUrl?:string|null;
  sourceUrl: string; publishedAt: string; cutoffAt: string; validUntil: string;
}
export type OperatingSource = OperatingSourceBase & (
  {documentId:string;pageNumber:number;pageTextSha256:string;documentPdfSha256:string;
    textBinding?:ResearchAssertionMetadata["textBinding"];
    snapshotCitation?:never;snapshotOriginal?:never;snapshotTextBinding?:never}
  | {snapshotCitation:{kind:"source_snapshot";snapshotId:string;textSha256:string;startUtf16:number;endUtf16:number;excerptSha256:string};
    snapshotOriginal:{rawSha256:string;byteLength:number;mediaType:"text/html";canonicalUrl:string;responseUrl:string};
    snapshotTextBinding:NonNullable<ResearchAssertionMetadata["snapshotTextBinding"]>;
    documentId?:never;pageNumber?:never;pageTextSha256?:never;documentPdfSha256?:never;textBinding?:never}
);
export interface OperatingFact {
  identity?:FactIdentity; assertionIdentity?:string; evidenceValidity?:EvidenceValidity; researchRecency?:ResearchRecency;
  recordedAt?:string; amendmentKind?:"initial"|"correction"|"restatement"; replacesValueId?:string|null;
  id: string; semanticType: "FACT"; derivationMethod: "source_transcription";
  symbol: string; membershipId: string; membershipVersion: number;
  metric: string; value: number; unit: ResearchAssertionMetadata["unit"]; unitScale: number;
  currency: string | null; period: OperatingPeriod; accountingScope: string; businessScope: string;
  measurementBasis: ResearchAssertionMetadata["measurementBasis"]; category: "actual" | "guidance";
  comparability: "comparable" | "not_comparable"; comparabilityReason: string | null;
  limitation: string; source: OperatingSource; revision: number;
  mix?: ResearchAssertionMetadata["mix"];
  guidance?: ResearchAssertionMetadata["guidance"];
}
export interface OperatingNode {
  accountingScope: string; businessScope: string; measurementBasis: string;
  metric: string; semanticType: ResearchSemanticType; value: number | null;
  unit: string; currency: string | null; period: OperatingPeriod;
  source: OperatingSource[]; inputs: string[]; calculation: string | null;
  derivationMethod: "source_transcription" | "deterministic_calculation" | "missing_evidence";
  comparability: "comparable" | "not_comparable"; limitation: string;
}
export interface ExplicitThesisBinding {
  proposition?: {metrics:string[]; periodType:OperatingPeriod["type"]; direction:"increase"|"decrease"; mixNode?:string};
  thesisDimension?: "sales_growth"|"product_mix"|"profitability"|"cash_flow"|"non_operating_quality"|"valuation_evidence"|"custom_unknown";
  reportId: string; reportVersion: number; reportFingerprint: string; conditionIndex: number; conditionText: string;
}
export const OPERATING_SCENARIO_INPUTS = ["sales_volume", "asp", "revenue", "gross_margin", "opex", "net_adjustments", "normalized_profit", "pe"] as const;
export type OperatingScenarioKey = typeof OPERATING_SCENARIO_INPUTS[number];
export const operatingInputUnit = (key: OperatingScenarioKey): "vehicles" | "currency_per_vehicle" | "currency" | "ratio" | "multiple" => key === "sales_volume" ? "vehicles" : key === "asp" ? "currency_per_vehicle" : key === "gross_margin" ? "ratio" : key === "pe" ? "multiple" : "currency";
export interface OperatingScenarioInput {
  unit: ReturnType<typeof operatingInputUnit>;
  value: number | null;
  origin: "source_fact" | "owner_assumption" | "unknown";
  sourceValueId: string | null;
  note: string;
  rationale?: {reason:string; basedOnFactIds:string[]; basedOnGuidanceIds?:string[]; confidence:"low"|"medium"|"high"};
}
export interface OperatingScenarioDraft {
  scenarioPeriodType?:"CURRENT_FY"|"NEXT_REPORTING_PERIOD";
  revenueComposition?:{otherRevenue:OperatingScenarioInput};
  basis: { accountingScope: "consolidated" | "parent_company"; businessScope: string; salesMeasurementBasis: "issuer_sales" | "monthly_wholesale" | "monthly_retail" } | null;
  name: "bear" | "base" | "bull";
  period: OperatingPeriod;
  currency: string;
  inputs: Record<OperatingScenarioKey, OperatingScenarioInput>;
}
export interface OperatingQuestionDraft {requirement?:EvidenceRequirement;questionId:string;question:string;targetMetric:string;period:OperatingPeriod;businessScope:string;measurementBasis:string}
export interface OperatingThesisOwnerAction {
  actionId:string; action:"KEEP_CURRENT_THESIS"|"REVISE_THESIS"|"INSUFFICIENT_EVIDENCE_CONTINUE"|"INVALIDATE_OR_END_THESIS";
  originalThesisIdentity:ExplicitThesisBinding; lineageId:string; previousLineageId:string|null; newThesis:string|null; ownerReason:string; endedAt:string|null;
  triggeringFactIds:string[]; nextValidationEvent:{description:string;expectedEvidence:string;targetDate:string|null}; baselineId:string|null; baseContextId?:string; confirmedAt:string; actor:string;
}
export interface OperatingResearchModel {
  researchQuestionDrafts?:OperatingQuestionDraft[];
  thesisTests?:ThesisTest[];
  thesisEvidencePlan?:ThesisEvidencePlan;
  thesisRevision?:ThesisRevision;
  thesisOwnerAction?:OperatingThesisOwnerAction;
  sensitivity?: {variable:"normalized_profit"|"pe"|"gross_margin"|"asp";lower:number;upper:number};
  peSensitivityValues?:number[];
  version: 1;
  thesisBinding: ExplicitThesisBinding | null;
  scenarios: OperatingScenarioDraft[];
  sharesValueId: string | null;
  sharesClass?: "ordinary" | "class_a" | "class_b" | null;
  sharesReferenceConfirmed: boolean;
  fx: { from: string; to: string; rate: number; asOf: string; note: string; ownerConfirmed: true } | null;
}
export interface OperatingResolvedInput extends Omit<OperatingScenarioInput,"origin"> { origin: OperatingScenarioInput["origin"] | "system_calculation" }
export interface OperatingScenarioResult {
  name: "bear" | "base" | "bull"; semanticType: "HYPOTHESIS";
  status: "complete" | "incomplete"; currency: string; period: OperatingPeriod;
  inputs: Record<OperatingScenarioKey, OperatingResolvedInput>;
  revenue: number | null; normalizedProfit: number | null; equityValue: number | null;
  shares: number | null; perShareValue: number | null; perShareCurrency: string | null;
  calculations: Array<{ metric: string; semanticType: "INTERPRETATION"; derivationMethod: "deterministic_calculation"; formula: string; inputs: string[]; value: number }>;
  missing: string[];
}
export interface OperatingMarketObservation {
  symbol: string; price: number; currency: string; asOf: string; fetchedAt: string; source: string; fresh: boolean;
}
export interface OperatingReverseValuation {
  status: "available" | "UNKNOWN";
  observed: OperatingMarketObservation | null;
  implied: { semanticType: "INTERPRETATION"; derivationMethod: "deterministic_calculation"; assumedPE: number; marketCap: number; marketCapCurrency: string; normalizedEarnings: number; currency: string; formula: string } | null;
  ownerView: { normalizedEarnings: number; currency: string } | null;
  gap: number | null; reasons: string[]; limitation: string;
}

export function emptyOperatingModel(year: number): OperatingResearchModel {
  return { version: 1, thesisBinding: null, sharesValueId: null, sharesClass:null, sharesReferenceConfirmed: false, fx: null,
    scenarios: (["bear", "base", "bull"] as const).map(name => ({name, scenarioPeriodType:"CURRENT_FY" as const, currency: "CNY", basis: null,
      period: {kind: "duration", type: "annual", start: `${year}-01-01`, end: `${year}-12-31`},
      inputs: Object.fromEntries(OPERATING_SCENARIO_INPUTS.map(key => [key, {unit:operatingInputUnit(key), value:null, origin:"unknown", sourceValueId:null, note:""}])) as OperatingScenarioDraft["inputs"]})) };
}

export function operatingModelFingerprint(value: unknown): string { return sha256Hex(canonicalJson(value)); }
export function validOperatingPeriod(p: unknown): p is OperatingPeriod {
  if (!record(p) || !["duration", "instant"].includes(String(p.kind)) || !["monthly", "interim", "annual", "ytd", "weekly", "instant", "other"].includes(String(p.type)) || !date(p.end)) return false;
  if (p.kind === "instant") return p.start === null && p.type === "instant";
  if (!date(p.start) || p.start >= p.end || p.type === "instant") return false;
  const days = (Date.parse(p.end) - Date.parse(p.start)) / 86400000 + 1;
  return p.type === "ytd" ? p.start===`${p.end.slice(0,4)}-01-01`&&days<365 : p.type === "annual" ? days >= 365 && days <= 366 : p.type === "interim" ? days >= 180 && days <= 184 : p.type === "monthly" ? days >= 28 && days <= 31 : p.type === "weekly" ? days === 7 : true;
}
export function validAssertionMetadata(a: unknown): a is ResearchAssertionMetadata {
  return record(a) && keys(a, ["unit", "measurementBasis", "businessScope", "category", "sourceUrl", "limitation", "sourceChecked", ...["textBinding","snapshotTextBinding","provenanceKind","mix","guidance","structureBinding","verification","structureConfirmation","scopeOverride","capturedSourceUrl","ownerSuppliedReferenceUrl"].filter(k=>Object.hasOwn(a,k))])
    && ["currency", "currency_per_vehicle", "vehicles", "ratio", "shares"].includes(String(a.unit))
    && ["financial_statement", "issuer_sales", "monthly_wholesale", "monthly_retail", "weekly_registration", "issued_shares"].includes(String(a.measurementBasis))
    && validAssertionExtensions(a)
    && ["actual", "guidance"].includes(String(a.category)) && typeof a.sourceChecked === "boolean"
    && text(a.businessScope, 200) && text(a.limitation, 2000) && typeof a.sourceUrl === "string" && (a.sourceUrl === "" || /^https:\/\/[^\s]+$/.test(a.sourceUrl));
}
function validateModelSensitivity(value:OperatingResearchModel,errors:string[]):void {
  if(value.sensitivity!==undefined){const s=value.sensitivity;if(!record(s)||!keys(s,["variable","lower","upper"])||!["normalized_profit","pe","gross_margin","asp"].includes(String(s.variable))||!finite(s.lower)||!finite(s.upper)||s.lower>=s.upper||s.lower<0||(s.variable==="gross_margin"&&s.upper>1))errors.push("explicit sensitivity range is invalid");}
  if(value.peSensitivityValues!==undefined&&(!Array.isArray(value.peSensitivityValues)||value.peSensitivityValues.length>9||value.peSensitivityValues.length<1||!value.peSensitivityValues.every(v=>finite(v)&&v>0)||new Set(value.peSensitivityValues).size!==value.peSensitivityValues.length))errors.push("Owner PE sensitivity values are invalid");
}
export function validateOperatingModel(value: unknown): {ok:true} | {ok:false; errors:string[]} {
  const errors: string[] = [];
  if (!record(value) || !keys(value, ["version", "thesisBinding", "scenarios", "sharesValueId", "sharesReferenceConfirmed", "fx", ...["sharesClass","thesisRevision","thesisOwnerAction","sensitivity","peSensitivityValues","thesisTests","thesisEvidencePlan","researchQuestionDrafts"].filter(k=>Object.hasOwn(value,k))]) || value.version !== 1) return {ok:false, errors:["operating model shape is invalid"]};
  if(!validModelQuestions(value.researchQuestionDrafts))errors.push("invalid research question drafts");
  if(value.thesisTests!==undefined&&(!Array.isArray(value.thesisTests)||value.thesisTests.length>20||!value.thesisTests.every(validThesisTest)||new Set(value.thesisTests.map(t=>(t as ThesisTest).testId)).size!==value.thesisTests.length))errors.push("invalid explicit Thesis Tests");
  if(Array.isArray(value.thesisTests)&&value.thesisTests.some(t=>!record(t)||!record(t.originalThesisIdentity)||!record(value.thesisBinding)||["reportId","reportVersion","reportFingerprint","conditionIndex","conditionText"].some(k=>record(t.originalThesisIdentity)&&record(value.thesisBinding)&&t.originalThesisIdentity[k]!==value.thesisBinding[k])))errors.push("Thesis Test identity must match the selected original condition");
  if(value.thesisEvidencePlan!==undefined&&!validThesisPlan(value.thesisEvidencePlan,Array.isArray(value.thesisTests)?value.thesisTests as ThesisTest[]:[]))errors.push("invalid Owner aggregation plan");
  validateModelSensitivity(value as unknown as OperatingResearchModel,errors);
  if(value.thesisRevision!==undefined && (!validThesisRevision(value.thesisRevision)||!validThesisBinding(value.thesisRevision.previous)))errors.push("invalid Thesis revision");
  if(value.thesisOwnerAction!==undefined&&!validThesisOwnerAction(value.thesisOwnerAction))errors.push("invalid explicit Owner Thesis action");
  if (value.thesisBinding !== null && !validThesisBinding(value.thesisBinding)) errors.push("explicit thesis binding is invalid");
  if (value.sharesValueId !== null && !id(value.sharesValueId)) errors.push("sharesValueId is invalid");
  if(value.sharesClass!==undefined&&value.sharesClass!==null&&!["ordinary","class_a","class_b"].includes(String(value.sharesClass)))errors.push("share class must be explicitly selected");
  if (typeof value.sharesReferenceConfirmed !== "boolean") errors.push("shares reference confirmation is invalid");
  if (value.fx !== null && !validFX(value.fx)) errors.push("FX requires explicit currency, dated positive rate and owner confirmation");
  if (!Array.isArray(value.scenarios) || value.scenarios.length !== 3 || value.scenarios.map(s => record(s) ? s.name : null).join() !== "bear,base,bull") errors.push("exactly bear/base/bull scenarios are required");
  else value.scenarios.forEach((scenario, index) => { if (!validScenario(scenario)) errors.push(`scenario ${index} inputs, periods or units are invalid`); });
  return errors.length ? {ok:false, errors} : {ok:true};
}
function validThesisOwnerAction(v:unknown):v is OperatingThesisOwnerAction {
 if(!record(v)||!keys(v,["actionId","action","originalThesisIdentity","lineageId","previousLineageId","newThesis","ownerReason","endedAt","triggeringFactIds","nextValidationEvent","baselineId","confirmedAt","actor",...["baseContextId"].filter(k=>Object.hasOwn(v,k))]))return false;
 const event=v.nextValidationEvent;
 return typeof v.actionId==="string"&&/^[a-f0-9]{64}$/.test(v.actionId)&&["KEEP_CURRENT_THESIS","REVISE_THESIS","INSUFFICIENT_EVIDENCE_CONTINUE","INVALIDATE_OR_END_THESIS"].includes(String(v.action))&&validThesisBinding(v.originalThesisIdentity)&&typeof v.lineageId==="string"&&/^[a-f0-9]{64}$/.test(v.lineageId)&&(v.previousLineageId===null||typeof v.previousLineageId==="string"&&/^[a-f0-9]{64}$/.test(v.previousLineageId))&&(v.newThesis===null||text(v.newThesis,4000))&&text(v.ownerReason,2000)&&(v.action==="INVALIDATE_OR_END_THESIS"?typeof v.endedAt==="string"&&Number.isFinite(Date.parse(v.endedAt)):v.endedAt===null)&&Array.isArray(v.triggeringFactIds)&&v.triggeringFactIds.every(id)&&(v.baselineId===null||typeof v.baselineId==="string")&&(v.baseContextId===undefined||typeof v.baseContextId==="string"&&/^\d+$/.test(v.baseContextId))&&record(event)&&keys(event,["description","expectedEvidence","targetDate"])&&text(event.description,1000)&&text(event.expectedEvidence,1000)&&(event.targetDate===null||date(event.targetDate))&&typeof v.confirmedAt==="string"&&Number.isFinite(Date.parse(v.confirmedAt))&&text(v.actor,200);
}
export function validThesisBinding(b: unknown): b is ExplicitThesisBinding {
  return record(b) && keys(b, ["reportId", "reportVersion", "reportFingerprint", "conditionIndex", "conditionText", ...["thesisDimension","proposition"].filter(k=>Object.hasOwn(b,k))])
    && (b.thesisDimension===undefined || ["sales_growth","product_mix","profitability","cash_flow","non_operating_quality","valuation_evidence","custom_unknown"].includes(String(b.thesisDimension)))
    && (b.proposition===undefined || record(b.proposition)&&keys(b.proposition,["metrics","periodType","direction",...["mixNode"].filter(k=>Object.hasOwn(b.proposition as object,k))])&&Array.isArray(b.proposition.metrics)&&b.proposition.metrics.length>0&&b.proposition.metrics.length<=8&&b.proposition.metrics.every(m=>text(m,100))&&["monthly","interim","annual","ytd","weekly","instant","other"].includes(String(b.proposition.periodType))&&["increase","decrease"].includes(String(b.proposition.direction))&&(b.proposition.mixNode===undefined||text(b.proposition.mixNode,200)))
    && id(b.reportId) && Number.isSafeInteger(b.reportVersion) && Number(b.reportVersion)>0
    && typeof b.reportFingerprint === "string" && /^[a-f0-9]{64}$/.test(b.reportFingerprint)
    && Number.isSafeInteger(b.conditionIndex) && Number(b.conditionIndex)>=0 && text(b.conditionText,4000);
}
function validScenario(s: unknown): s is OperatingScenarioDraft {
  if (!record(s) || !keys(s,["name","period","currency","inputs","basis",...["scenarioPeriodType","revenueComposition"].filter(k=>Object.hasOwn(s,k))]) || !validOperatingPeriod(s.period) || !["annual","interim"].includes(String(s.period.type)) || !currency(s.currency) || !record(s.inputs) || !keys(s.inputs,[...OPERATING_SCENARIO_INPUTS])) return false;
  if(s.scenarioPeriodType!==undefined&&(!["CURRENT_FY","NEXT_REPORTING_PERIOD"].includes(String(s.scenarioPeriodType))||s.scenarioPeriodType==="CURRENT_FY"&&s.period.type!=="annual"||s.scenarioPeriodType==="NEXT_REPORTING_PERIOD"&&s.period.type!=="interim"))return false;
  if(s.scenarioPeriodType===undefined&&s.period.type!=="annual")return false;
  if(s.revenueComposition!==undefined&&(!record(s.revenueComposition)||!keys(s.revenueComposition,["otherRevenue"])||!validScenarioInput(s.revenueComposition.otherRevenue,"currency",true)))return false;
  if (s.basis !== null && (!record(s.basis) || !keys(s.basis,["accountingScope","businessScope","salesMeasurementBasis"]) || !["consolidated","parent_company"].includes(String(s.basis.accountingScope)) || !text(s.basis.businessScope,200) || !["issuer_sales","monthly_wholesale","monthly_retail"].includes(String(s.basis.salesMeasurementBasis)))) return false;
  return OPERATING_SCENARIO_INPUTS.every(key => validInput(s.inputs as Record<string,unknown>, key));
}
function validInput(inputs: Record<string,unknown>, key: OperatingScenarioKey): boolean {
  const v=inputs[key]; if (!validScenarioInput(v,operatingInputUnit(key),false))return false;
  const input=v as OperatingScenarioInput;
  if (key === "pe" && input.origin !== "owner_assumption" && input.origin!=="unknown") return false;
  if (key === "gross_margin") return input.value===null||input.value>=0 && input.value<=1;
  return input.value===null||["normalized_profit","net_adjustments"].includes(key) || input.value>=0 && (key!=="pe" || input.value>0);
}
function validScenarioInput(v:unknown,unit:OperatingScenarioInput["unit"],nonnegative:boolean):boolean {
  if (!record(v) || !keys(v,["unit","value","origin","sourceValueId","note", ...["rationale"].filter(k=>Object.hasOwn(v,k))]) || v.unit!==unit || typeof v.note !== "string" || v.note.length>2000) return false;
  if(v.rationale!==undefined && (!record(v.rationale)||!keys(v.rationale,["reason","basedOnFactIds","confidence",...["basedOnGuidanceIds"].filter(k=>Object.hasOwn(v.rationale as object,k))])||!text(v.rationale.reason,2000)||!Array.isArray(v.rationale.basedOnFactIds)||!v.rationale.basedOnFactIds.every(id)||(v.rationale.basedOnGuidanceIds!==undefined&&(!Array.isArray(v.rationale.basedOnGuidanceIds)||!v.rationale.basedOnGuidanceIds.every(id)))||!["low","medium","high"].includes(String(v.rationale.confidence))))return false;
  if (v.origin === "unknown") return v.value===null && v.sourceValueId===null;
  if (!finite(v.value) || !["source_fact","owner_assumption"].includes(String(v.origin))) return false;
  if (v.origin === "source_fact" ? !id(v.sourceValueId) : v.sourceValueId!==null || !v.note.trim()) return false;
  return !nonnegative||v.value>=0;
}
function validFX(v: unknown): boolean { return record(v) && keys(v,["from","to","rate","asOf","note","ownerConfirmed"]) && currency(v.from) && currency(v.to) && v.from!==v.to && finite(v.rate) && v.rate>0 && date(v.asOf) && text(v.note,2000) && v.ownerConfirmed===true; }
function currency(v:unknown):v is string {return typeof v==="string" && /^[A-Z]{3}$/.test(v) && v!=="XXX";}
function id(v:unknown):v is string{return typeof v==="string" && /^[1-9]\d*$/.test(v);}
function finite(v:unknown):v is number{return typeof v==="number" && Number.isFinite(v) && Math.abs(v)<=1e15;}
function record(v:unknown):v is Record<string,unknown>{return typeof v==="object" && v!==null && !Array.isArray(v);}
function keys(v:Record<string,unknown>,expected:string[]):boolean{return Object.keys(v).sort().join()===expected.sort().join();}
function text(v:unknown,max:number):v is string{return typeof v==="string" && v.trim().length>0 && v.length<=max;}
function date(v:unknown):v is string{if(typeof v!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+"T00:00:00Z");return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===v;}

function validAssertionExtensions(a:Record<string,unknown>):boolean {
  if(a.provenanceKind!==undefined && !["authorized_public_issuer_document","owner_uploaded_document","owner_manual_input","system_calculation"].includes(String(a.provenanceKind)))return false;
  if(a.mix!==undefined && (!record(a.mix)||!keys(a.mix,["dimension","dimensionValue","parentScope",...["parentNode","overlapPolicy"].filter(k=>Object.hasOwn(a.mix as object,k))])||!["brand","powertrain","geography"].includes(String(a.mix.dimension))||!text(a.mix.dimensionValue,200)||!text(a.mix.parentScope,200)))return false;
  if(a.mix!==undefined && record(a.mix) && ((a.mix.parentNode!==undefined&&!text(a.mix.parentNode,200))||(a.mix.overlapPolicy!==undefined&&!["nested","mutually_exclusive","overlapping"].includes(String(a.mix.overlapPolicy))) ))return false;
  if(!validStructureExtensions(a))return false;
  const g=a.guidance;
  if(g!==undefined && (!record(g)||!keys(g,["lower","upper","definition","expectedVerificationDate","targetType","statement"])||!["minimum","maximum","range","text"].includes(String(g.targetType))||!date(g.expectedVerificationDate)||!text(g.definition,2000)||!text(g.statement,4000)||(g.lower!==null&&!finite(g.lower))||(g.upper!==null&&!finite(g.upper))||(typeof g.lower==="number"&&typeof g.upper==="number"&&g.lower>g.upper)))return false;
  const b=a.textBinding;
  const snapshot=a.snapshotTextBinding;
  if (b!==undefined && snapshot!==undefined) return false;
  if (snapshot!==undefined && !validSnapshotTextBinding(snapshot))return false;
  return b===undefined || validPdfTextBinding(b);
}
function validPdfTextBinding(binding:unknown):boolean {
  return record(binding)&&keys(binding,["documentId","pageNumber","pageTextSha256","sourceExcerpt","rawValueText"])
    &&id(binding.documentId)&&Number.isSafeInteger(binding.pageNumber)&&Number(binding.pageNumber)>0
    &&typeof binding.pageTextSha256==="string"&&/^[a-f0-9]{64}$/.test(binding.pageTextSha256)
    &&text(binding.sourceExcerpt,4000)&&text(binding.rawValueText,100);
}
function validSnapshotTextBinding(snapshot:unknown):boolean {
  return record(snapshot)&&keys(snapshot,["snapshotId","textSha256","startUtf16","endUtf16","excerptSha256","sourceExcerpt","rawValueText"])
    &&id(snapshot.snapshotId)&&typeof snapshot.textSha256==="string"&&/^[a-f0-9]{64}$/.test(snapshot.textSha256)
    &&Number.isSafeInteger(snapshot.startUtf16)&&Number(snapshot.startUtf16)>=0
    &&Number.isSafeInteger(snapshot.endUtf16)&&Number(snapshot.endUtf16)>Number(snapshot.startUtf16)
    &&typeof snapshot.excerptSha256==="string"&&/^[a-f0-9]{64}$/.test(snapshot.excerptSha256)
    &&text(snapshot.sourceExcerpt,4000)&&text(snapshot.rawValueText,100);
}

function validStructureExtensions(a:Record<string,unknown>):boolean {
  return validStructureBinding(a.structureBinding)&&validStructureConfirmation(a.structureConfirmation)&&validScopeOverride(a.scopeOverride)&&validAssertionVerification(a.verification);
}
function validStructureBinding(value:unknown):boolean {
  if(value===undefined)return true;
  if(!record(value)||!keys(value,["rowLabelText","columnHeaderText","unitHeaderText","ownerScopeConfirmed",...["scopeText","taxonomyConfirmedBy","structureExcerpt"].filter(k=>Object.hasOwn(value,k))])||![value.rowLabelText,value.columnHeaderText,value.unitHeaderText].every(v=>text(v,1000))||typeof value.ownerScopeConfirmed!=="boolean"||(value.scopeText!==undefined&&!text(value.scopeText,1000))||(value.taxonomyConfirmedBy!==undefined&&!text(value.taxonomyConfirmedBy,200)))return false;
  return value.structureExcerpt===undefined||text(value.structureExcerpt,16000);
}
function validStructureConfirmation(value:unknown):boolean {
  return value===undefined||record(value)&&keys(value,["confirmedFields"])&&Array.isArray(value.confirmedFields)&&value.confirmedFields.length>0&&new Set(value.confirmedFields).size===value.confirmedFields.length&&value.confirmedFields.every(f=>["metric","period","currency","unitScale","scope","taxonomy"].includes(String(f)));
}
function validScopeOverride(value:unknown):boolean {
  return value===undefined||record(value)&&keys(value,["originalScope","replacementScope","reason","confirmedBy","confirmedAt"])&&text(value.originalScope,200)&&text(value.replacementScope,200)&&value.originalScope!==value.replacementScope&&text(value.reason,500)&&value.reason.length>=5&&text(value.confirmedBy,200)&&typeof value.confirmedAt==="string"&&Number.isFinite(Date.parse(value.confirmedAt));
}
function validAssertionVerification(value:unknown):boolean {
  if(value===undefined)return true;
  if(!record(value)||!keys(value,["valueVerification","structureVerification","checks","taxonomyConfirmedBy",...["ownerConfirmation"].filter(k=>Object.hasOwn(value,k))])||!["source_text_verified","owner_confirmed","unverified"].includes(String(value.valueVerification))||!["source_labels_verified","owner_confirmed","unverified"].includes(String(value.structureVerification))||!record(value.checks)||!keys(value.checks,["metric","period","currency","unitScale","scope",...["taxonomy"].filter(k=>Object.hasOwn(value.checks as object,k))])||!Object.values(value.checks).every(v=>typeof v==="boolean")||(value.taxonomyConfirmedBy!==null&&!text(value.taxonomyConfirmedBy,200)))return false;
  const confirmation=value.ownerConfirmation;
  return confirmation===undefined||record(confirmation)&&keys(confirmation,["confirmedFields","confirmedBy","confirmedAt"])&&Array.isArray(confirmation.confirmedFields)&&confirmation.confirmedFields.every(f=>["metric","period","currency","unitScale","scope","taxonomy"].includes(String(f)))&&text(confirmation.confirmedBy,200)&&typeof confirmation.confirmedAt==="string"&&Number.isFinite(Date.parse(confirmation.confirmedAt));
}

export function validOperatingQuestionDraft(v:unknown):v is OperatingQuestionDraft {
  return record(v)&&keys(v,["questionId","question","targetMetric","period","businessScope","measurementBasis",...(Object.hasOwn(v,"requirement")?["requirement"]:[])])&&(v.requirement===undefined||validEvidenceRequirement(v.requirement))&&text(v.questionId,200)&&text(v.question,1000)&&text(v.targetMetric,100)&&/^[a-z_]+$/.test(v.targetMetric)&&validOperatingPeriod(v.period)&&text(v.businessScope,200)&&["financial_statement","issuer_sales","monthly_wholesale","monthly_retail","weekly_registration","issued_shares"].includes(String(v.measurementBasis));
}

function validModelQuestions(value:unknown):boolean {return value===undefined||Array.isArray(value)&&value.length<=30&&value.every(validOperatingQuestionDraft)&&new Set(value.map(q=>q.questionId)).size===value.length;}
