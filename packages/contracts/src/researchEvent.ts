import { isRfc3339DateTime } from "./factMetadata.js";
import type {
  MaterialClaimType,
  MaterialRightsStatus,
  MaterialVerificationStatus,
  ResearchMaterialData
} from "./deepResearch.js";
import { OWNER_VERIFIED_HOLDING_LOGIC_SOURCE_TYPE } from "./researchMaterial.js";
import {
  researchMonitorRuleErrors,
  sameResearchMonitorRuleContent,
  type ResearchMonitorRule
} from "./researchMonitorRule.js";

export const RESEARCH_EVENT_KINDS = [
  "announcement", "financial_report", "corporate_action", "major_news", "news"
] as const;
export const RESEARCH_EVENT_SCOPES = ["research_stock", "current_holding"] as const;
export const RESEARCH_EVENT_IMPORTANCE = ["unknown", "low", "medium", "high"] as const;
export const RESEARCH_EVENT_HYPOTHESIS_IMPACTS = ["supports", "weakens", "unknown"] as const;

// Unverified HKEXnews title/date/link leads captured by the local daily collector. They stay visible in the
// research workspace material list for Owner review, but they are never formal research evidence.
export const EXCHANGE_ANNOUNCEMENT_LEAD_SOURCE_TYPE = "exchange_announcement_lead";
/** Owner-confirmed technical judgment stays visible in history, outside the full research evidence pack. */
export const INDEPENDENT_WEINSTEIN_TECHNICAL_SOURCE_TYPE = "owner_weinstein_technical_confirmation";

export type ResearchEventKind = (typeof RESEARCH_EVENT_KINDS)[number];
export type ResearchEventScope = (typeof RESEARCH_EVENT_SCOPES)[number];
export type ResearchEventImportance = (typeof RESEARCH_EVENT_IMPORTANCE)[number];
export type ResearchEventHypothesisImpact = (typeof RESEARCH_EVENT_HYPOTHESIS_IMPACTS)[number];
export type ResearchEventMonitorRuleBinding = ResearchMonitorRule & {
  enabled: true;
  version: number;
  confirmedAt: string;
};

export function researchStockMaterials(
  materials: ResearchMaterialData[],
  events: ResearchAnnouncementEventData[]
): ResearchMaterialData[] {
  const holdingMaterialIds = new Set(events
    .filter((event) => event.coverageScope === "current_holding")
    .map((event) => event.source.materialId));
  return materials.filter((material) => material.sourceType !== OWNER_VERIFIED_HOLDING_LOGIC_SOURCE_TYPE
    && material.sourceType !== EXCHANGE_ANNOUNCEMENT_LEAD_SOURCE_TYPE
    && material.sourceType !== INDEPENDENT_WEINSTEIN_TECHNICAL_SOURCE_TYPE
    && !holdingMaterialIds.has(material.id));
}

export function researchWorkspaceMaterials(
  materials: ResearchMaterialData[],
  storedEvents: ResearchAnnouncementEventData[],
  visibleEvents: ResearchAnnouncementEventData[]
): ResearchMaterialData[] {
  const stockMaterialIds = new Set(researchStockMaterials(materials, storedEvents).map((material) => material.id));
  const boundHoldingMaterialIds = new Set(storedEvents
    .filter((event) => event.coverageScope === "current_holding")
    .map((event) => event.source.materialId));
  const visibleHoldingMaterialIds = new Set(visibleEvents
    .filter((event) => event.coverageScope === "current_holding")
    .map((event) => event.source.materialId));
  return materials.filter((material) => stockMaterialIds.has(material.id) || visibleHoldingMaterialIds.has(material.id)
    || material.sourceType === EXCHANGE_ANNOUNCEMENT_LEAD_SOURCE_TYPE
    || material.sourceType === INDEPENDENT_WEINSTEIN_TECHNICAL_SOURCE_TYPE
    || material.sourceType === OWNER_VERIFIED_HOLDING_LOGIC_SOURCE_TYPE && material.revisionState === "current" && !boundHoldingMaterialIds.has(material.id));
}

export interface CreateResearchEventRequest {
  membershipVersion: number;
  materialId: string;
  eventKind: ResearchEventKind;
  coverageScope: ResearchEventScope;
  monitorRuleBinding?: ResearchEventMonitorRuleBinding | null;
  idempotencyKey: string;
}

export interface ResearchEventSource {
  materialId: string;
  evidenceId: string;
  sourceType: string;
  sourceUrl: string | null;
  publishedAt: string;
  capturedAt: string;
  claimType: MaterialClaimType;
  verificationStatus: MaterialVerificationStatus;
  rightsStatus: MaterialRightsStatus;
  sourceVersion: string;
  contentFingerprint: string;
  validUntil: string;
  freshness: "fresh" | "stale";
  revision: number;
  revisionState: "current" | "replaced";
  variableName: string;
  stance: "support" | "refute" | "neutral";
  reliability: number | null;
  materiality: number | null;
}

export interface ResearchEventHoldingBinding {
  accountScopeId: string;
  snapshotId: string;
  sourceBatchId: string;
  sourceAsOf: string;
  positionSourceRowId: string;
}

export interface ResearchAnnouncementEventData {
  id: string;
  eventVersion: number;
  eventFingerprint: string;
  membershipId: string;
  membershipVersion: number;
  market: "HK";
  code: string;
  symbol: string;
  eventKind: ResearchEventKind;
  coverageScope: ResearchEventScope;
  keyVariable: string;
  importance: ResearchEventImportance;
  importanceReasons: string[];
  hypothesisImpact: ResearchEventHypothesisImpact;
  source: ResearchEventSource;
  monitorRuleBinding: ResearchEventMonitorRuleBinding | null;
  holdingBinding: ResearchEventHoldingBinding | null;
  createdAt: string;
  safety: {
    createsOrder: false;
    createsTrade: false;
    mutatesCash: false;
    writesFee: false;
    mutatesPosition: false;
    callsBroker: false;
    productionWrite: false;
  };
}

export function validateCreateResearchEventRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["request must be an object"]);
  exact(value, ["membershipVersion", "materialId", "eventKind", "coverageScope", "monitorRuleBinding", "idempotencyKey"], "request", errors);
  if (!positiveInteger(value.membershipVersion)) errors.push("membershipVersion must be a positive integer");
  if (!positiveId(value.materialId)) errors.push("materialId must be a positive integer string");
  if (!RESEARCH_EVENT_KINDS.includes(value.eventKind as ResearchEventKind)) errors.push("eventKind is invalid");
  if (!RESEARCH_EVENT_SCOPES.includes(value.coverageScope as ResearchEventScope)) errors.push("coverageScope is invalid");
  if (value.monitorRuleBinding !== undefined && value.monitorRuleBinding !== null) {
    if (value.coverageScope !== "research_stock") errors.push("monitorRuleBinding is only valid for research-stock events");
    if (!researchEventMonitorRuleBindingMatchesCurrent(
      value.monitorRuleBinding,
      [value.monitorRuleBinding as ResearchEventMonitorRuleBinding],
      value.eventKind as ResearchEventKind,
      record(value.monitorRuleBinding) ? String(value.monitorRuleBinding.variableName) : ""
    )) errors.push("monitorRuleBinding is invalid or does not match the event kind");
  }
  if (!bounded(value.idempotencyKey, 200)) errors.push("idempotencyKey must be a non-empty string of at most 200 characters");
  return errors.length ? invalid(errors) : { ok: true };
}

export function deriveResearchEventAssessment(
  source: Pick<ResearchEventSource, "materiality" | "reliability" | "stance">,
  eventKind: ResearchEventKind,
  coverageScope: ResearchEventScope
): Pick<ResearchAnnouncementEventData, "importance" | "importanceReasons" | "hypothesisImpact"> {
  const hypothesisImpact = source.stance === "support" ? "supports" : source.stance === "refute" ? "weakens" : "unknown";
  if (source.materiality === null || source.reliability === null) {
    return {
      importance: "unknown",
      importanceReasons: ["Importance is unknown because materiality or reliability is missing."],
      hypothesisImpact
    };
  }
  if (source.materiality === 5 && source.reliability >= 4
    && (eventKind !== "news" || coverageScope === "current_holding")) {
    return {
      importance: "high",
      importanceReasons: [eventKind === "announcement" || coverageScope === "current_holding"
        ? "Materiality is 5, reliability is at least 4, and the event is an announcement or current-holding event."
        : "Materiality is 5, reliability is at least 4, and the event is an Owner-classified disclosure or major news event."],
      hypothesisImpact
    };
  }
  if (source.materiality >= 3 && source.reliability >= 3) {
    return {
      importance: "medium",
      importanceReasons: ["Materiality and reliability are both at least 3."],
      hypothesisImpact
    };
  }
  return {
    importance: "low",
    importanceReasons: ["The verified event is below the medium-importance materiality or reliability threshold."],
    hypothesisImpact
  };
}

export function validateResearchAnnouncementEventData(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["research event data must be an object"]);
  exact(value, [
    "id", "eventVersion", "eventFingerprint", "membershipId", "membershipVersion", "market", "code", "symbol",
    "eventKind", "coverageScope", "keyVariable", "importance", "importanceReasons", "hypothesisImpact",
    "source", "monitorRuleBinding", "holdingBinding", "createdAt", "safety"
  ], "event", errors);
  if (!positiveId(value.id) || !positiveInteger(value.eventVersion) || !positiveId(value.membershipId)
    || !positiveInteger(value.membershipVersion)) errors.push("event identity and versions are invalid");
  if (typeof value.eventFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.eventFingerprint)) errors.push("eventFingerprint is invalid");
  if (value.market !== "HK" || !/^\d{5}$/.test(String(value.code)) || value.symbol !== `HK.${value.code}`) errors.push("event security identity is invalid");
  if (!RESEARCH_EVENT_KINDS.includes(value.eventKind as ResearchEventKind)
    || !RESEARCH_EVENT_SCOPES.includes(value.coverageScope as ResearchEventScope)) errors.push("event kind or scope is invalid");
  validateSource(value.source, errors);
  if (!bounded(value.keyVariable, 500) || record(value.source) && value.keyVariable !== value.source.variableName) errors.push("keyVariable must bind the source variable");
  const source = validAssessmentSource(value.source) ? value.source : null;
  if (source && RESEARCH_EVENT_KINDS.includes(value.eventKind as ResearchEventKind)
    && RESEARCH_EVENT_SCOPES.includes(value.coverageScope as ResearchEventScope)) {
    const expected = deriveResearchEventAssessment(source, value.eventKind as ResearchEventKind, value.coverageScope as ResearchEventScope);
    if (value.importance !== expected.importance || value.hypothesisImpact !== expected.hypothesisImpact
      || !sameStrings(value.importanceReasons, expected.importanceReasons)) errors.push("event assessment does not deterministically recompute");
  }
  if (value.monitorRuleBinding !== undefined && value.monitorRuleBinding !== null
    && !researchEventMonitorRuleBindingMatchesCurrent(
      value.monitorRuleBinding,
      [value.monitorRuleBinding as ResearchEventMonitorRuleBinding],
      value.eventKind as ResearchEventKind,
      String(value.keyVariable)
    )) errors.push("event monitorRuleBinding is invalid or unbound");
  validateHoldingBinding(value.holdingBinding, value.coverageScope, errors);
  if (!instant(value.createdAt) || record(value.source) && instant(value.source.capturedAt)
    && Date.parse(String(value.createdAt)) < Date.parse(String(value.source.capturedAt))) errors.push("createdAt must not precede source capture");
  validateSafety(value.safety, errors);
  return errors.length ? invalid(errors) : { ok: true };
}

export function researchEventMonitorRuleBindingMatchesCurrent(
  binding: unknown,
  currentRules: ResearchMonitorRule[],
  eventKind: ResearchEventKind,
  variableName: string
): binding is ResearchEventMonitorRuleBinding {
  if (!record(binding) || binding.enabled !== true || !positiveInteger(binding.version)
    || !instant(binding.confirmedAt) || binding.variableName !== variableName
    || researchMonitorRuleErrors([binding], [variableName]).length > 0) return false;
  const expectedEventKind = RESEARCH_EVENT_KINDS.includes(binding.category as ResearchEventKind)
    ? binding.category
    : "news";
  const current = currentRules.find((rule) => rule.variableName === variableName);
  return eventKind === expectedEventKind && current !== undefined && current.enabled === true
    && current.version === binding.version && current.confirmedAt === binding.confirmedAt
    && sameResearchMonitorRuleContent(current, binding as unknown as ResearchMonitorRule);
}

export function researchEventBindsMaterial(
  event: ResearchAnnouncementEventData,
  material: ResearchMaterialData
): boolean {
  const source = event.source;
  return event.symbol === material.symbol && event.keyVariable === material.variableName
    && source.materialId === material.id && source.evidenceId === material.evidenceId
    && source.sourceType === material.sourceType && source.sourceUrl === material.sourceUrl
    && source.publishedAt === material.publishedAt && source.capturedAt === material.capturedAt
    && source.claimType === material.claimType && source.verificationStatus === material.verificationStatus
    && source.rightsStatus === material.rightsStatus && source.sourceVersion === material.sourceVersion
    && source.contentFingerprint === material.contentFingerprint && source.validUntil === material.validUntil
    && source.freshness === material.freshness && source.revision === material.revision
    && source.revisionState === material.revisionState && source.variableName === material.variableName
    && source.stance === material.stance && source.reliability === material.reliability
    && source.materiality === material.materiality;
}

function validateSource(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("event source is required"); return; }
  exact(value, [
    "materialId", "evidenceId", "sourceType", "sourceUrl", "publishedAt", "capturedAt", "claimType",
    "verificationStatus", "rightsStatus", "sourceVersion", "contentFingerprint", "validUntil", "freshness",
    "revision", "revisionState", "variableName", "stance", "reliability", "materiality"
  ], "event.source", errors);
  if (!positiveId(value.materialId) || !positiveId(value.evidenceId)) errors.push("event source ids are invalid");
  if (!bounded(value.sourceType, 200) || !optionalHttpUrl(value.sourceUrl) || !bounded(value.sourceVersion, 200)
    || typeof value.contentFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.contentFingerprint)) errors.push("event source trace is invalid");
  if (!instant(value.publishedAt) || !instant(value.capturedAt) || !instant(value.validUntil)
    || Date.parse(String(value.publishedAt)) > Date.parse(String(value.capturedAt))
    || Date.parse(String(value.validUntil)) <= Date.parse(String(value.publishedAt))) errors.push("event source timeline is invalid");
  if (!["verified_fact", "issuer_statement", "third_party_statement"].includes(String(value.claimType))
    || value.verificationStatus !== "verified" || !["user_provided", "authorized_public"].includes(String(value.rightsStatus))) errors.push("event source classification is not eligible");
  if (!["fresh", "stale"].includes(String(value.freshness)) || !positiveInteger(value.revision)
    || !["current", "replaced"].includes(String(value.revisionState)) || !bounded(value.variableName, 500)
    || !["support", "refute", "neutral"].includes(String(value.stance))
    || !score(value.reliability) || !score(value.materiality)) errors.push("event source research binding is invalid");
}

function validateHoldingBinding(value: unknown, scope: unknown, errors: string[]): void {
  if (scope === "research_stock") {
    if (value !== null) errors.push("research-stock events must not expose a holding binding");
    return;
  }
  if (!record(value)) { errors.push("current-holding events require a holding binding"); return; }
  exact(value, ["accountScopeId", "snapshotId", "sourceBatchId", "sourceAsOf", "positionSourceRowId"], "holdingBinding", errors);
  if (!bounded(value.accountScopeId, 500) || !bounded(value.snapshotId, 500) || !bounded(value.sourceBatchId, 500)
    || !instant(value.sourceAsOf) || !bounded(value.positionSourceRowId, 1000)
    || !String(value.positionSourceRowId).startsWith(`broker_import_batches:${value.sourceBatchId}/`)) errors.push("holding binding is invalid");
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("event safety boundary is required"); return; }
  const keys = ["createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker", "productionWrite"];
  exact(value, keys, "event.safety", errors);
  if (keys.some((key) => value[key] !== false)) errors.push("event safety flags must all be false");
}

function validAssessmentSource(value: unknown): value is ResearchEventSource {
  return record(value) && score(value.materiality) && score(value.reliability)
    && ["support", "refute", "neutral"].includes(String(value.stance));
}
function score(value: unknown): boolean { return value === null || Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5; }
function positiveInteger(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) > 0; }
function positiveId(value: unknown): boolean { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function bounded(value: unknown, max: number): boolean { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function instant(value: unknown): boolean { return typeof value === "string" && isRfc3339DateTime(value) && Number.isFinite(Date.parse(value)); }
function optionalHttpUrl(value: unknown): boolean { if (value === null) return true; if (typeof value !== "string" || value.length === 0 || value.length > 2000) return false; try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }
function sameStrings(value: unknown, expected: string[]): boolean { return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[], label: string, errors: string[]): void { const allowed = new Set(keys); for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`); }
function invalid(errors: string[]): { ok: false; errors: string[] } { return { ok: false, errors }; }
