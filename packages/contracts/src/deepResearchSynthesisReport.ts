import { deepResearchPackBinding, validateDeepResearchPackBinding, type DeepResearchPackBinding } from "./limitedResearch.js";
import { canonicalJson } from "./decisionContextBrowser.js";
import {
  deepResearchSnapshotBinding,
  validateDeepResearchSnapshotData,
  type DeepResearchSnapshotBinding,
  type DeepResearchSnapshotData
} from "./deepResearchSnapshot.js";
import { MATERIAL_CLAIM_TYPES, type MaterialClaimType } from "./researchMaterial.js";
import type { ResearchContextSourceMembership } from "./researchContext.js";
import type {
  DeepResearchConflict,
  DeepResearchReportPayload,
  EvidenceBoundAdviceLayer
} from "./deepResearch.js";
import { FORMAL_DECISION_DIRECTIONS } from "./formalDecision.js";

export const DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION = "2026-08-05.deep-research-synthesis-report.v1";
export const DEEP_RESEARCH_SYNTHESIS_PROMPT_VERSIONS = [
  "deep-research-snapshot-synthesis.v1",
  "deep-research-snapshot-synthesis.v2",
  "deep-research-snapshot-synthesis.v3",
  "deep-research-snapshot-synthesis.v4",
  "deep-research-snapshot-synthesis.v5",
  "deep-research-snapshot-synthesis.v6",
  "deep-research-snapshot-synthesis.v7"
] as const;
export type DeepResearchSynthesisPromptVersion = (typeof DEEP_RESEARCH_SYNTHESIS_PROMPT_VERSIONS)[number];
export const DEEP_RESEARCH_SYNTHESIS_PROMPT_VERSION: DeepResearchSynthesisPromptVersion = "deep-research-snapshot-synthesis.v7";
export const DEEP_RESEARCH_SYNTHESIS_SOURCE_KINDS = [
  "material", "fundamental", "research_context", "event", "operating_monitor",
  "valuation_context", "technical_context", "quant_portfolio_context", "source_missing"
] as const;

// Provider output omits citation/classification fields already determined by the selected source.
export function deepResearchSynthesisOutputSchema(): Record<string, unknown> {
  const text = { type: "string" };
  const list = (items: unknown) => ({ type: "array", items });
  const object = (properties: Record<string, unknown>) => ({
    type: "object", properties, required: Object.keys(properties), additionalProperties: false
  });
  const source = {
    evidenceIds: list(text), sourceKind: { type: "string", enum: DEEP_RESEARCH_SYNTHESIS_SOURCE_KINDS }, sourceId: text
  };
  const fact = object({ statement: text, ...source });
  const view = object({ view: text, conditions: list(text), invalidationConditions: list(text), risks: list(text) });
  return object({
    adviceLayer: object({
      conclusion: text, confidence: { type: "string", enum: ["low", "medium", "high", "UNKNOWN"] },
      applicableUntil: text, horizonStatement: text, longTerm: view, mediumShortTerm: view,
      conflict: object({ status: { type: "string", enum: ["aligned", "conflict", "UNKNOWN"] }, description: text }),
      direction: { type: "string", enum: FORMAL_DECISION_DIRECTIONS },
      priceConditions: list(text), priceRange: text, researchPositionRange: text,
      assumptions: list(text), scenarios: list(text), nextQuestion: text, versionChange: text,
      automaticTradingSignal: { type: "boolean", enum: [false] }
    }),
    researchLayer: object({
      fundamentals: list(fact), context: list(fact), eventsAndCatalysts: list(fact), operatingMonitor: list(fact),
      risks: list(fact), counterevidence: list(fact), unknowns: list(fact),
      sourceConflicts: list(object({ description: text, ...source })), nextValidationQuestions: list(text)
    }),
    changeFromPrevious: text
  });
}

export type DeepResearchSynthesisSourceKind = (typeof DEEP_RESEARCH_SYNTHESIS_SOURCE_KINDS)[number];

export type DeepResearchSynthesisCitation = {
  kind: "pack_evidence" | "document_page" | "snapshot_object" | "none";
  evidenceId: string | null;
  documentId: string | null;
  pageNumber: number | null;
  pageTextSha256: string | null;
  sourceMembership?: ResearchContextSourceMembership;
} | {
  kind: "source_snapshot";
  evidenceId: string | null;
  snapshotId: string;
  textSha256: string;
  startUtf16: number;
  endUtf16: number;
  excerptSha256: string;
  rawSha256: string;
  byteLength: number;
  mediaType: "text/html";
  canonicalUrl: string;
  responseUrl: string;
  documentId?: never;
  pageNumber?: never;
  pageTextSha256?: never;
} | {
  kind: "peer_original";
  evidenceId: null;
  sourceMembership?: ResearchContextSourceMembership;
  materialId: string;
  materialRevision: number;
  contentFingerprint: string;
  sourceType: "issuer_public_html" | "futu_opend_financial_statement_provider";
  sourceUrl: string | null;
  sourceVersion: string;
  snapshotCitation?: {kind:"source_snapshot";snapshotId:string;textSha256:string;startUtf16:number;endUtf16:number;excerptSha256:string};
  snapshotRawSha256?: string;
  providerOriginal?: {captureId:string;pageId:string;rawSha256:string;reportSha256:string};
};

export interface DeepResearchSynthesisFact {
  statement: string;
  evidenceIds: string[];
  sourceKind: DeepResearchSynthesisSourceKind;
  sourceId: string;
  citation: DeepResearchSynthesisCitation;
  claimType: MaterialClaimType | "pack_context" | "UNKNOWN";
  stance: "support" | "refute" | "neutral" | "UNKNOWN";
}

export interface DeepResearchSynthesisConflict extends Omit<DeepResearchConflict, "evidenceIds"> {
  evidenceIds: string[];
  sourceKind: DeepResearchSynthesisSourceKind;
  sourceId: string;
  citation: DeepResearchSynthesisCitation;
}

export interface DeepResearchSynthesisResearchLayer {
  fundamentals: DeepResearchSynthesisFact[];
  context: DeepResearchSynthesisFact[];
  valuation: DeepResearchSynthesisFact[];
  technical: DeepResearchSynthesisFact[];
  quantPortfolio?: DeepResearchSynthesisFact[];
  eventsAndCatalysts: DeepResearchSynthesisFact[];
  operatingMonitor: DeepResearchSynthesisFact[];
  risks: DeepResearchSynthesisFact[];
  counterevidence: DeepResearchSynthesisFact[];
  unknowns: DeepResearchSynthesisFact[];
  sourceConflicts: DeepResearchSynthesisConflict[];
  nextValidationQuestions: string[];
}

export type DeepResearchSynthesisProviderResearchLayer = Omit<
  DeepResearchSynthesisResearchLayer,
  "valuation" | "technical" | "quantPortfolio"
>;

export interface DeepResearchSynthesisProviderPayload {
  adviceLayer: EvidenceBoundAdviceLayer;
  researchLayer: DeepResearchSynthesisProviderResearchLayer;
  changeFromPrevious: string;
}

export interface DeepResearchSynthesisReproducibility {
  generationMethod: "deepseek_chat_completions_selected_snapshot";
  provider: "deepseek";
  model: string;
  prompt: DeepResearchSynthesisPromptVersion;
  tokenUsage: string;
  cost: string;
}

export interface SynthesizedDeepResearchReportPayload extends DeepResearchReportPayload {
  reportContractVersion: typeof DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION;
  evidencePackBinding: DeepResearchPackBinding;
  snapshotBinding: DeepResearchSnapshotBinding;
  snapshot: DeepResearchSnapshotData;
  reproducibility: DeepResearchSynthesisReproducibility;
  sendManifest?: import("./deepResearchTask.js").DeepResearchTaskSendManifest;
  adviceLayer: EvidenceBoundAdviceLayer;
  researchLayer: DeepResearchSynthesisResearchLayer;
}

export interface CreateSynthesizedDeepResearchReportRequest {
  membershipVersion: number;
  evidencePackId: string;
  idempotencyKey: string;
  reportContractVersion: typeof DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION;
  snapshot: DeepResearchSnapshotData;
  reproducibility: DeepResearchSynthesisReproducibility;
  sendManifest?: import("./deepResearchTask.js").DeepResearchTaskSendManifest;
  providerPayload: DeepResearchSynthesisProviderPayload;
}
export function validateDeepResearchSynthesisProviderPayload(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["provider payload must be an object"]);
  exact(value, ["adviceLayer", "researchLayer", "changeFromPrevious"], "providerPayload", errors);
  advice(value.adviceLayer, errors);
  providerLayer(value.researchLayer, errors);
  bounded(value.changeFromPrevious, "changeFromPrevious", 4000, errors);
  return errors.length ? invalid(errors) : { ok: true };
}

export function validateSynthesizedDeepResearchReportPayload(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["synthesized report payload must be an object"]);
  exact(value, [
    "researchQuestion", "cutoffAt", "investmentThesis", "factTable", "supportEvidenceIds",
    "counterEvidenceIds", "sourceConflictAssessment", "sourceConflicts", "unknownItems",
    "keyDrivers", "causalChain", "valuationScenarios", "impliedExpectations",
    "invalidationConditions", "changeFromPrevious", "portfolioImpact",
    "nextValidationQuestions", "modelInferences", "reportContractVersion", "evidencePackBinding", "snapshotBinding",
    "snapshot", "reproducibility", "adviceLayer", "researchLayer", ...(Object.hasOwn(value, "sendManifest") ? ["sendManifest"] : [])
  ], "report", errors);
  if (value.reportContractVersion !== DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION) errors.push("reportContractVersion is invalid");
  const packBinding = validateDeepResearchPackBinding(value.evidencePackBinding);
  if (!packBinding.ok) errors.push(...packBinding.errors);
  const snapshot = validateDeepResearchSnapshotData(value.snapshot);
  if (!snapshot.ok) errors.push(...snapshot.errors.map((error) => `snapshot.${error}`));
  if (snapshot.ok && canonicalJson(value.snapshotBinding) !== canonicalJson(deepResearchSnapshotBinding(value.snapshot as DeepResearchSnapshotData))) {
    errors.push("snapshotBinding does not match snapshot");
  }
  if (snapshot.ok && canonicalJson(value.evidencePackBinding)
    !== canonicalJson(deepResearchPackBinding((value.snapshot as DeepResearchSnapshotData).evidencePack))) {
    errors.push("evidencePackBinding does not match snapshot evidence pack");
  }
  reproducibility(value.reproducibility, errors);
  advice(value.adviceLayer, errors);
  fullLayer(value.researchLayer, errors);
  legacyProjection(value, errors);
  return errors.length ? invalid(errors) : { ok: true };
}

export function validateDeepResearchSynthesisReproducibility(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  reproducibility(value, errors);
  return errors.length ? invalid(errors) : { ok: true };
}

function providerLayer(value: unknown, errors: string[]): void {
  layer(value, ["fundamentals", "context", "eventsAndCatalysts", "operatingMonitor", "risks", "counterevidence", "unknowns", "sourceConflicts", "nextValidationQuestions"], errors);
}

function fullLayer(value: unknown, errors: string[]): void {
  layer(value, [
    "fundamentals", "context", "valuation", "technical",
    ...(record(value) && "quantPortfolio" in value ? ["quantPortfolio"] : []),
    "eventsAndCatalysts", "operatingMonitor", "risks", "counterevidence",
    "unknowns", "sourceConflicts", "nextValidationQuestions"
  ], errors);
}

function layer(value: unknown, keys: string[], errors: string[]): void {
  if (!record(value)) { errors.push("researchLayer must be an object"); return; }
  exact(value, keys, "researchLayer", errors);
  for (const key of keys.filter((key) => !["sourceConflicts", "nextValidationQuestions"].includes(key))) facts(value[key], `researchLayer.${key}`, errors);
  conflicts(value.sourceConflicts, errors);
  strings(value.nextValidationQuestions, "researchLayer.nextValidationQuestions", 50, errors);
}

function facts(value: unknown, label: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length > 100) { errors.push(`${label} must contain at most 100 facts`); return; }
  value.forEach((item, index) => {
    if (!record(item)) { errors.push(`${label}[${index}] must be an object`); return; }
    exact(item, ["statement", "evidenceIds", "sourceKind", "sourceId", "citation", "claimType", "stance"], `${label}[${index}]`, errors);
    bounded(item.statement, `${label}[${index}].statement`, 4000, errors);
    ids(item.evidenceIds, `${label}[${index}].evidenceIds`, errors);
    source(item, `${label}[${index}]`, errors);
  });
}

function conflicts(value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length > 100) { errors.push("researchLayer.sourceConflicts must contain at most 100 items"); return; }
  value.forEach((item, index) => {
    if (!record(item)) { errors.push(`researchLayer.sourceConflicts[${index}] must be an object`); return; }
    exact(item, ["description", "evidenceIds", "sourceKind", "sourceId", "citation"], `researchLayer.sourceConflicts[${index}]`, errors);
    bounded(item.description, `researchLayer.sourceConflicts[${index}].description`, 4000, errors);
    ids(item.evidenceIds, `researchLayer.sourceConflicts[${index}].evidenceIds`, errors);
    source(item, `researchLayer.sourceConflicts[${index}]`, errors, false);
  });
}

function source(value: Record<string, unknown>, label: string, errors: string[], classification = true): void {
  const kind = value.sourceKind as DeepResearchSynthesisSourceKind;
  if (!DEEP_RESEARCH_SYNTHESIS_SOURCE_KINDS.includes(kind)) errors.push(`${label}.sourceKind is invalid`);
  bounded(value.sourceId, `${label}.sourceId`, 500, errors);
  citation(value.citation, `${label}.citation`, errors);
  const sourceIdPatterns: Record<DeepResearchSynthesisSourceKind, RegExp> = {
    material: /^material:[1-9]\d*$/,
    fundamental: /^fundamental:[1-9]\d*$/,
    research_context: /^research-context:[1-9]\d*:(?:fact|peer|driver|kpi):[1-9]\d*$/,
    event: /^event:[1-9]\d*$/,
    operating_monitor: /^operating-monitor:[1-9]\d*$/,
    valuation_context: /^valuation:[1-9]\d*:[1-9]\d*$/,
    technical_context: /^technical:[a-f0-9]{64}:[a-f0-9]{64}$/,
    quant_portfolio_context: /^quant-portfolio:[a-f0-9]{64}$/,
    source_missing: /^UNKNOWN$/
  };
  if (typeof value.sourceId !== "string" || sourceIdPatterns[kind] && !sourceIdPatterns[kind].test(value.sourceId)) errors.push(`${label}.sourceId is invalid for sourceKind`);
  if (record(value.citation)) {
    if (value.citation.sourceMembership !== undefined && kind !== "research_context")
      errors.push(`${label}.sourceMembership is only valid for research context`);
    const allowedCitationKinds: Record<DeepResearchSynthesisSourceKind, string[]> = {
      material: ["pack_evidence", "document_page", "source_snapshot"], fundamental: ["document_page", "source_snapshot"], research_context: ["document_page", "peer_original"],
      event: ["pack_evidence", "document_page", "source_snapshot"], operating_monitor: ["snapshot_object"],
      valuation_context: ["snapshot_object"], technical_context: ["snapshot_object"],
      quant_portfolio_context: ["snapshot_object"], source_missing: ["none"]
    };
    if (allowedCitationKinds[kind] && !allowedCitationKinds[kind].includes(String(value.citation.kind))) errors.push(`${label}.citation kind does not match sourceKind`);
  }
  if (classification && ![...MATERIAL_CLAIM_TYPES, "pack_context", "UNKNOWN"].includes(String(value.claimType))) errors.push(`${label}.claimType is invalid`);
  if (classification && !["support", "refute", "neutral", "UNKNOWN"].includes(String(value.stance))) errors.push(`${label}.stance is invalid`);
}

function citation(value: unknown, label: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${label} must be an object`); return; }
  if (value.kind === "source_snapshot") {
    validateSnapshotCitation(value,label,errors);
    return;
  }
  if (value.kind === "peer_original") {
    validatePeerOriginalCitation(value,label,errors);
    return;
  }
  exact(value, ["kind", "evidenceId", "documentId", "pageNumber", "pageTextSha256",
    ...(value.sourceMembership === undefined ? [] : ["sourceMembership"])], label, errors);
  if (value.sourceMembership !== undefined) validatePeerMembership(value.sourceMembership,label,errors);
  if (!["pack_evidence", "document_page", "snapshot_object", "none"].includes(String(value.kind))) errors.push(`${label}.kind is invalid`);
  for (const key of ["evidenceId", "documentId"]) if (value[key] !== null && !positive(value[key])) errors.push(`${label}.${key} is invalid`);
  if (value.pageNumber !== null && (!Number.isSafeInteger(value.pageNumber) || Number(value.pageNumber) < 1)) errors.push(`${label}.pageNumber is invalid`);
  if (value.pageTextSha256 !== null && !sha(value.pageTextSha256)) errors.push(`${label}.pageTextSha256 is invalid`);
  if (value.kind === "pack_evidence" && (!positive(value.evidenceId) || value.documentId !== null || value.pageNumber !== null || value.pageTextSha256 !== null)) errors.push(`${label} pack_evidence fields are invalid`);
  if (value.kind === "document_page" && (!positive(value.documentId) || !Number.isSafeInteger(value.pageNumber) || Number(value.pageNumber) < 1 || !sha(value.pageTextSha256))) errors.push(`${label} document_page fields are invalid`);
  if (["snapshot_object", "none"].includes(String(value.kind)) && [value.evidenceId, value.documentId, value.pageNumber, value.pageTextSha256].some((item) => item !== null)) errors.push(`${label} must not attach citation fields`);
}

function validatePeerMembership(value:unknown,label:string,errors:string[]):void {
  if(!record(value)){errors.push(`${label}.sourceMembership is invalid`);return;}
  exact(value,["membershipId","membershipVersion","symbol"],`${label}.sourceMembership`,errors);
  if(!positive(value.membershipId)||!Number.isSafeInteger(value.membershipVersion)||Number(value.membershipVersion)<1
    ||typeof value.symbol!=="string"||!/^HK\.[0-9]{5}$/.test(value.symbol))
    errors.push(`${label}.sourceMembership identity is invalid`);
}

function validatePeerOriginalCitation(value:Record<string,unknown>,label:string,errors:string[]):void {
  const html=value.sourceType==="issuer_public_html",provider=value.sourceType==="futu_opend_financial_statement_provider";
  exact(value,["kind","evidenceId","materialId","materialRevision","contentFingerprint","sourceType",
    "sourceUrl","sourceVersion",...(value.sourceMembership===undefined?[]:["sourceMembership"]),
    ...(html?["snapshotCitation","snapshotRawSha256"]:provider?["providerOriginal"]:[])],label,errors);
  if(value.evidenceId!==null||!positive(value.materialId)||!Number.isSafeInteger(value.materialRevision)
    ||Number(value.materialRevision)<1||!sha(value.contentFingerprint)||!html&&!provider
    ||typeof value.sourceVersion!=="string"||value.sourceVersion.length<1||value.sourceVersion.length>200)
    errors.push(`${label} peer original identity is invalid`);
  if(value.sourceMembership!==undefined)validatePeerMembership(value.sourceMembership,label,errors);
  if(html){const c=value.snapshotCitation;
    if(typeof value.sourceUrl!=="string"||!value.sourceUrl.startsWith("https://")||!sha(value.snapshotRawSha256)
      ||!record(c)||c.kind!=="source_snapshot"||!positive(c.snapshotId)||!sha(c.textSha256)
      ||!sha(c.excerptSha256)||!Number.isSafeInteger(c.startUtf16)||!Number.isSafeInteger(c.endUtf16)
      ||Number(c.endUtf16)<=Number(c.startUtf16))errors.push(`${label} HTML original is invalid`);
  }else{const c=value.providerOriginal;
    if(value.sourceUrl!==null||!record(c)||!positive(c.captureId)||!positive(c.pageId)
      ||!sha(c.rawSha256)||!sha(c.reportSha256))errors.push(`${label} OpenD original is invalid`);
  }
}

function validateSnapshotCitation(value:Record<string,unknown>,label:string,errors:string[]):void {
  exact(value, ["kind","evidenceId","snapshotId","textSha256","startUtf16","endUtf16",
    "excerptSha256","rawSha256","byteLength","mediaType","canonicalUrl","responseUrl"],label,errors);
  if (value.evidenceId !== null && !positive(value.evidenceId)
    || !positive(value.snapshotId) || !sha(value.textSha256) || !sha(value.excerptSha256)
    || !sha(value.rawSha256) || !Number.isSafeInteger(value.startUtf16) || Number(value.startUtf16)<0
    || !Number.isSafeInteger(value.endUtf16) || Number(value.endUtf16)<=Number(value.startUtf16)
    || !Number.isSafeInteger(value.byteLength) || Number(value.byteLength)<1
    || value.mediaType!=="text/html" || typeof value.canonicalUrl!=="string"
    || typeof value.responseUrl!=="string" || !value.canonicalUrl.startsWith("https://")
    || !value.responseUrl.startsWith("https://"))errors.push(`${label} source_snapshot fields are invalid`);
}

function advice(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("adviceLayer must be an object"); return; }
  exact(value, [
    "conclusion", "confidence", "applicableUntil", "horizonStatement", "longTerm", "mediumShortTerm", "conflict",
    "direction", "priceConditions", "priceRange", "researchPositionRange", "assumptions", "scenarios",
    "nextQuestion", "versionChange", "automaticTradingSignal"
  ], "adviceLayer", errors);
  bounded(value.conclusion, "adviceLayer.conclusion", 4000, errors);
  if (!["low", "medium", "high", "UNKNOWN"].includes(String(value.confidence))) errors.push("adviceLayer.confidence is invalid");
  instant(value.applicableUntil, "adviceLayer.applicableUntil", errors);
  bounded(value.horizonStatement, "adviceLayer.horizonStatement", 4000, errors);
  view(value.longTerm, "adviceLayer.longTerm", errors);
  view(value.mediumShortTerm, "adviceLayer.mediumShortTerm", errors);
  if (!record(value.conflict)) errors.push("adviceLayer.conflict is invalid");
  else {
    exact(value.conflict, ["status", "description"], "adviceLayer.conflict", errors);
    if (!["aligned", "conflict", "UNKNOWN"].includes(String(value.conflict.status))) errors.push("adviceLayer.conflict.status is invalid");
    bounded(value.conflict.description, "adviceLayer.conflict.description", 4000, errors);
  }
  if (!FORMAL_DECISION_DIRECTIONS.includes(value.direction as (typeof FORMAL_DECISION_DIRECTIONS)[number])) errors.push("adviceLayer.direction is invalid");
  for (const key of ["priceConditions", "assumptions", "scenarios"]) strings(value[key], `adviceLayer.${key}`, 50, errors);
  for (const key of ["priceRange", "researchPositionRange", "nextQuestion", "versionChange"]) bounded(value[key], `adviceLayer.${key}`, 4000, errors);
  if (value.automaticTradingSignal !== false) errors.push("automaticTradingSignal must be false");
}

function view(value: unknown, label: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${label} is invalid`); return; }
  exact(value, ["view", "conditions", "invalidationConditions", "risks"], label, errors);
  bounded(value.view, `${label}.view`, 4000, errors);
  for (const key of ["conditions", "invalidationConditions", "risks"]) strings(value[key], `${label}.${key}`, 50, errors);
}

function reproducibility(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("reproducibility must be an object"); return; }
  exact(value, ["generationMethod", "provider", "model", "prompt", "tokenUsage", "cost"], "reproducibility", errors);
  if (value.generationMethod !== "deepseek_chat_completions_selected_snapshot" || value.provider !== "deepseek") errors.push("reproducibility provider is invalid");
  for (const key of ["model", "tokenUsage", "cost"]) if (typeof value[key] !== "string" || !value[key] || value[key] === "NOT_USED") errors.push(`reproducibility.${key} is invalid`);
  if (!DEEP_RESEARCH_SYNTHESIS_PROMPT_VERSIONS.includes(value.prompt as DeepResearchSynthesisPromptVersion)) {
    errors.push("reproducibility.prompt is invalid");
  }
  if (typeof value.tokenUsage === "string" && !/^prompt=\d+,completion=\d+,total=\d+$/.test(value.tokenUsage)) errors.push("reproducibility.tokenUsage is invalid");
}

function legacyProjection(value: Record<string, unknown>, errors: string[]): void {
  for (const key of ["researchQuestion", "investmentThesis", "sourceConflictAssessment", "changeFromPrevious"]) bounded(value[key], key, key === "investmentThesis" ? 10000 : 4000, errors);
  instant(value.cutoffAt, "cutoffAt", errors);
  for (const key of ["supportEvidenceIds", "counterEvidenceIds"]) ids(value[key], key, errors);
  for (const key of ["unknownItems", "keyDrivers", "causalChain", "valuationScenarios", "impliedExpectations", "invalidationConditions", "portfolioImpact", "nextValidationQuestions"]) strings(value[key], key, key.includes("Evidence") ? 100 : 50, errors);
  legacyFacts(value.factTable, "factTable", "statement", errors);
  legacyFacts(value.modelInferences, "modelInferences", "statement", errors);
  legacyFacts(value.sourceConflicts, "sourceConflicts", "description", errors);
}

function legacyFacts(value: unknown, label: string, textKey: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length > 100) { errors.push(`${label} is invalid`); return; }
  value.forEach((item, index) => {
    if (!record(item)) { errors.push(`${label}[${index}] is invalid`); return; }
    exact(item, [textKey, "evidenceIds"], `${label}[${index}]`, errors);
    bounded(item[textKey], `${label}[${index}].${textKey}`, 4000, errors);
    ids(item.evidenceIds, `${label}[${index}].evidenceIds`, errors);
  });
}

function ids(value: unknown, label: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length > 100 || value.some((item) => !positive(item)) || new Set(value).size !== value.length) errors.push(`${label} must contain unique positive integer strings`);
}
function strings(value: unknown, label: string, max: number, errors: string[]): void { if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || !item.trim() || item.length > 4000) || new Set(value).size !== value.length) errors.push(`${label} is invalid`); }
function bounded(value: unknown, label: string, max: number, errors: string[]): void { if (typeof value !== "string" || !value.trim() || value.length > max) errors.push(`${label} is invalid`); }
function instant(value: unknown, label: string, errors: string[]): void { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) errors.push(`${label} is invalid`); }
function positive(value: unknown): value is string { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function sha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, expected: string[], label: string, errors: string[]): void { const actual = Object.keys(value).sort(); const target = [...expected].sort(); if (actual.length !== target.length || actual.some((key, index) => key !== target[index])) errors.push(`${label} has unexpected or missing keys`); }
function invalid(errors: string[]): { ok: false; errors: string[] } { return { ok: false, errors }; }
