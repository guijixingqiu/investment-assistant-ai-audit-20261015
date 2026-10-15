import { validateOperatingModel, type OperatingResearchModel } from "./researchOperatingModel.js";
import { isRfc3339DateTime, validateFactMetadata, type FactMetadata } from "./factMetadata.js";
import type { ResearchMaterialCitation } from "./researchMaterial.js";
import { canonicalJson } from "./decisionContextBrowser.js";
import { sha256Hex } from "./sha256.js";

export const RESEARCH_CONTEXT_SCHEMA_VERSION = "2026-08-13.research-context.v3";
export const RESEARCH_CONTEXT_COMPARISON_VERSION = "decimal-delta-v1";
export const RESEARCH_CONTEXT_SECTIONS = [
  "industry", "selected_facts", "peer_facts", "peers", "operating_kpis", "macro_drivers",
  "industry_drivers", "unknowns", "timeline", "provenance"
] as const;
export const RESEARCH_INDUSTRY_DIMENSIONS = ["supply", "demand", "pricing", "competition", "policy", "cycle"] as const;
export const RESEARCH_MACRO_DIMENSIONS = ["growth", "inflation", "rates", "fx", "commodities", "policy"] as const;

export type ResearchContextSection = typeof RESEARCH_CONTEXT_SECTIONS[number];

export type ResearchContextProvenanceClass = "authorized_public" | "user_provided" | "research_only";

export interface ResearchContextProvenance {
  sourceType: string;
  sourceVersion: string;
  capturedAt: string;
  classification: ResearchContextProvenanceClass;
}

export interface ResearchContextCitation extends ResearchMaterialCitation {
  sourceType: string;
  sourceUrl: string | null;
  sourceVersion: string;
  sourceMembership?: ResearchContextSourceMembership;
}

/** Omitted on historical citations, which belong to the selected company. */
export interface ResearchContextSourceMembership {
  membershipId: string;
  membershipVersion: number;
  symbol: string;
}

/** A peer reason may cite a saved, exact material rather than a PDF page. */
export type ResearchPeerCitation = ResearchContextCitation | {
  kind: "saved_material";
  materialId: string;
  materialRevision: number;
  contentFingerprint: string;
  sourceType: "issuer_public_html" | "futu_opend_financial_statement_provider";
  sourceUrl: string | null;
  sourceVersion: string;
  sourceMembership?: ResearchContextSourceMembership;
  snapshotCitation?: {kind:"source_snapshot";snapshotId:string;textSha256:string;startUtf16:number;endUtf16:number;excerptSha256:string};
  snapshotRawSha256?: string;
  providerOriginal?: {captureId:string;pageId:string;rawSha256:string;reportSha256:string};
};

export interface ResearchContextNumericFact {
  id: string;
  selectedSymbol: string;
  symbol: string;
  metric: string;
  value: string | null;
  unit: string;
  currency: string | null;
  /** Explicit measurement period. End only represents a point observation. */
  periodStart?: string;
  periodEnd?: string;
  asOf: string;
  cutoffAt: string;
  validUntil: string;
  citation: ResearchPeerCitation;
  provenance: ResearchContextProvenance;
}

export interface ResearchContextDriver {
  id: string;
  selectedSymbol: string;
  kind: "macro" | "industry";
  dimension: typeof RESEARCH_INDUSTRY_DIMENSIONS[number] | typeof RESEARCH_MACRO_DIMENSIONS[number];
  impact: "supportive" | "adverse" | "mixed" | "unknown";
  statement: string;
  thesisRelevance: string;
  asOf: string;
  cutoffAt: string;
  validUntil: string;
  citation: ResearchContextCitation;
  provenance: ResearchContextProvenance;
}

export interface ResearchContextPeer {
  id: string;
  selectedSymbol: string;
  symbol: string;
  name: string;
  status: "included" | "excluded";
  reason: string;
  asOf: string;
  cutoffAt: string;
  validUntil: string;
  citation: ResearchPeerCitation;
  provenance: ResearchContextProvenance;
}

export interface ResearchOperatingKpi {
  id: string;
  selectedSymbol: string;
  category: "operating" | "price";
  metric: string;
  periodStart: string;
  periodEnd: string;
  valueStatus: "reported" | "explicit_unknown";
  value: string | null;
  unit: string;
  comparability: "comparable" | "not_comparable";
  comparabilityReason: string | null;
  asOf: string;
  cutoffAt: string;
  validUntil: string;
  citation: ResearchContextCitation;
  provenance: ResearchContextProvenance;
}

export interface ResearchContextComparison {
  peerSymbol: string;
  metric: string;
  selectedFactId: string | null;
  peerFactId: string;
  unit: string;
  currency: string | null;
  status: "available" | "not_comparable";
  selectedValue: string | null;
  peerValue: string | null;
  delta: string | null;
  reason: string | null;
  calculationVersion: typeof RESEARCH_CONTEXT_COMPARISON_VERSION;
}

export type ResearchContextInvalidationReason = "stale" | "symbol_mismatch" | "cutoff_or_symbol_mismatch" | "membership_version_mismatch";

export interface CreateResearchContextRequest {
  operatingModel?: OperatingResearchModel;
  baseContextId: string | null;
  membershipVersion: number;
  selectedSymbol: string;
  industry: string;
  selectedFacts: ResearchContextNumericFact[];
  peerFacts: ResearchContextNumericFact[];
  peers: ResearchContextPeer[];
  operatingKpis: ResearchOperatingKpi[];
  macroDrivers: ResearchContextDriver[];
  industryDrivers: ResearchContextDriver[];
  unknowns: string[];
  provenance: ResearchContextProvenance;
  asOf: string;
  cutoffAt: string;
  validUntil: string;
  idempotencyKey: string;
}

export interface ResearchContextSnapshotData extends Omit<CreateResearchContextRequest, "baseContextId" | "membershipVersion" | "idempotencyKey"> {
  id: string;
  membershipId: string;
  membershipVersion: number;
  comparisons: ResearchContextComparison[];
  createdAt: string;
  currentness: {
    status: "current" | "historical";
    invalidatedBy: ResearchContextInvalidationReason[];
  };
  safety: {
    recommendation: false;
    ranking: false;
    automaticSignal: false;
    createsOrder: false;
    callsBroker: false;
    mutatesOfficialPortfolio: false;
  };
}

export function researchContextContentHash(value: ResearchContextSnapshotData): string {
  const { currentness: _currentness, safety: _safety, createdAt: _createdAt, ...content } = value;
  return sha256Hex(canonicalJson(content));
}

export function validateSelectedResearchContextItems(
  facts: unknown, peers: unknown, selectedSymbol: unknown, cutoffAt: unknown, peerFacts?: unknown
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  validateFacts(facts, "selectedFacts", selectedSymbol, cutoffAt, errors);
  validatePeers(peers, selectedSymbol, cutoffAt, errors);
  if (peerFacts !== undefined) validateFacts(peerFacts, "peerFacts", selectedSymbol, cutoffAt, errors, true);
  return errors.length ? { ok: false, errors } : { ok: true };
}

export interface ResearchContextHistoryEntry {
  id: string;
  previousContextId: string | null;
  revision: number;
  industry: string;
  cutoffAt: string;
  validUntil: string;
  createdAt: string;
  itemCounts: {
    selectedFacts: number;
    peerFacts: number;
    peers: number;
    operatingKpis: number;
    macroDrivers: number;
    industryDrivers: number;
    unknowns: number;
  };
}

export interface ResearchContextChangeSummary {
  previousContextId: string | null;
  currentContextId: string;
  changedSections: ResearchContextSection[];
  unchangedSections: ResearchContextSection[];
}

export interface ResearchContextEnvelope {
  schemaVersion: typeof RESEARCH_CONTEXT_SCHEMA_VERSION;
  generatedAt: string;
  status: "available" | "not_found" | "unavailable";
  membershipId: string;
  requestedActorId: string;
  requestedSymbol: string | null;
  metadata: FactMetadata;
  data: ResearchContextSnapshotData | null;
  /** Live source gaps; stored peer reasons and the snapshot content hash stay unchanged. */
  peerSourceIssues?: ResearchPeerSourceIssue[];
  /** Live gaps for individual peer numeric facts; other peers remain readable. */
  peerFactSourceIssues?: ResearchPeerFactSourceIssue[];
  /** Hash of the current data, supplied for exact optional research selection. */
  contentHash?: string;
  history: ResearchContextHistoryEntry[];
  historyHasMore: boolean;
  changeSummary: ResearchContextChangeSummary | null;
  message: string;
}

export interface ResearchPeerSourceIssue {
  peerId: string;
  symbol: string;
  status: "stale" | "unavailable";
  reason: "material_changed" | "original_unavailable";
}

export interface ResearchPeerFactSourceIssue {
  factId: string;
  symbol: string;
  status: "stale" | "unavailable";
  reason: "material_changed" | "original_unavailable";
}

export function validateCreateResearchContextRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["request must be an object"]);
  exact(value, [
    "baseContextId", "membershipVersion", "selectedSymbol", "industry", "selectedFacts", "peerFacts", "macroDrivers",
    "peers", "operatingKpis", "industryDrivers", "unknowns", "provenance", "asOf", "cutoffAt", "validUntil", "idempotencyKey", "operatingModel"
  ], "request", errors);
  if (value.baseContextId !== null) positiveId(value.baseContextId, "baseContextId", errors);
  positiveInteger(value.membershipVersion, "membershipVersion", errors);
  symbol(value.selectedSymbol, "selectedSymbol", errors);
  bounded(value.industry, "industry", 200, errors);
  validateFacts(value.selectedFacts, "selectedFacts", value.selectedSymbol, value.cutoffAt, errors);
  validateFacts(value.peerFacts, "peerFacts", value.selectedSymbol, value.cutoffAt, errors, true);
  validatePeers(value.peers, value.selectedSymbol, value.cutoffAt, errors);
  validateOperatingKpis(value.operatingKpis, value.selectedSymbol, value.cutoffAt, errors);
  validateDrivers(value.macroDrivers, "macroDrivers", value.selectedSymbol, value.cutoffAt, "macro", errors);
  validateDrivers(value.industryDrivers, "industryDrivers", value.selectedSymbol, value.cutoffAt, "industry", errors);
  uniqueStableIds(value.selectedFacts, value.peerFacts, "fact", errors);
  uniqueStableIds(value.macroDrivers, value.industryDrivers, "driver", errors);
  validateUnknowns(value.unknowns, errors);
  if (value.operatingModel !== undefined) { const result = validateOperatingModel(value.operatingModel); if (!result.ok) errors.push(...result.errors); }
  validateProvenance(value.provenance, "provenance", errors);
  timeline(value.asOf, value.cutoffAt, value.validUntil, errors);
  if (Array.isArray(value.selectedFacts) && Array.isArray(value.peerFacts)
    && Array.isArray(value.peers) && Array.isArray(value.operatingKpis)
    && Array.isArray(value.macroDrivers) && Array.isArray(value.industryDrivers)
    && value.operatingModel === undefined
    && value.selectedFacts.length + value.peerFacts.length + value.peers.length + value.operatingKpis.length + value.macroDrivers.length + value.industryDrivers.length === 0) {
    errors.push("context requires at least one cited fact or driver");
  }
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return errors.length ? invalid(errors) : { ok: true };
}

export function buildResearchContextComparisons(
  selectedFacts: ResearchContextNumericFact[],
  peerFacts: ResearchContextNumericFact[],
  allowLegacyPeriodless = false
): ResearchContextComparison[] {
  const comparisons: ResearchContextComparison[] = [];
  for (const peer of peerFacts) {
    const sameMetric = selectedFacts.filter((fact) => fact.metric === peer.metric);
    const selected = peer.periodEnd === undefined ? sameMetric : sameMetric.filter(fact =>
      fact.periodEnd === peer.periodEnd && fact.periodStart === peer.periodStart);
    if (selected.length !== 1) {
      comparisons.push(notComparable(peer, selected[0] ?? sameMetric[0] ?? null,
        selected.length === 0 ? sameMetric.length ? "matching measurement period is missing"
          : "selected fact is missing" : "selected fact is ambiguous"));
      continue;
    }
    const fact = selected[0]!;
    if (fact.selectedSymbol !== peer.selectedSymbol) {
      comparisons.push(notComparable(peer, fact, "symbol or cutoff is not comparable"));
      continue;
    }
    if (fact.periodEnd === undefined || peer.periodEnd === undefined) {
      if (!allowLegacyPeriodless) {
        comparisons.push(notComparable(peer, fact, "measurement period is not disclosed"));
        continue;
      }
      if (fact.periodEnd !== peer.periodEnd || fact.cutoffAt !== peer.cutoffAt) {
        comparisons.push(notComparable(peer, fact, fact.periodEnd === undefined && peer.periodEnd === undefined
          ? "symbol or cutoff is not comparable" : "measurement period or cutoff is not comparable"));
        continue;
      }
    } else if (fact.periodStart !== peer.periodStart || fact.periodEnd !== peer.periodEnd) {
      comparisons.push(notComparable(peer, fact, "measurement period is not comparable"));
      continue;
    }
    if (fact.unit !== peer.unit || fact.currency !== peer.currency) {
      comparisons.push(notComparable(peer, fact, "unit or currency is not comparable"));
      continue;
    }
    if (fact.value === null || peer.value === null) {
      comparisons.push(notComparable(peer, fact, "unknown value is not calculable"));
      continue;
    }
    comparisons.push({
      peerSymbol: peer.symbol,
      metric: peer.metric,
      selectedFactId: fact.id,
      peerFactId: peer.id,
      unit: peer.unit,
      currency: peer.currency,
      status: "available",
      selectedValue: fact.value,
      peerValue: peer.value,
      delta: decimalDelta(peer.value, fact.value),
      reason: null,
      calculationVersion: RESEARCH_CONTEXT_COMPARISON_VERSION
    });
  }
  return comparisons;
}

export function validateResearchContextSnapshotData(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["research context data must be an object"]);
  exact(value, [
    "id", "membershipId", "membershipVersion", "selectedSymbol", "industry", "selectedFacts", "peerFacts",
    "peers", "operatingKpis", "macroDrivers", "industryDrivers", "unknowns", "provenance", "asOf", "cutoffAt", "validUntil", "comparisons",
    "createdAt", "currentness", "safety", "operatingModel"
  ], "context", errors);
  positiveId(value.id, "id", errors);
  positiveId(value.membershipId, "membershipId", errors);
  positiveInteger(value.membershipVersion, "membershipVersion", errors);
  symbol(value.selectedSymbol, "selectedSymbol", errors);
  bounded(value.industry, "industry", 200, errors);
  validateFacts(value.selectedFacts, "selectedFacts", value.selectedSymbol, value.cutoffAt, errors);
  validateFacts(value.peerFacts, "peerFacts", value.selectedSymbol, value.cutoffAt, errors, true);
  validatePeers(value.peers, value.selectedSymbol, value.cutoffAt, errors);
  validateOperatingKpis(value.operatingKpis, value.selectedSymbol, value.cutoffAt, errors);
  validateDrivers(value.macroDrivers, "macroDrivers", value.selectedSymbol, value.cutoffAt, "macro", errors);
  validateDrivers(value.industryDrivers, "industryDrivers", value.selectedSymbol, value.cutoffAt, "industry", errors);
  uniqueStableIds(value.selectedFacts, value.peerFacts, "fact", errors);
  uniqueStableIds(value.macroDrivers, value.industryDrivers, "driver", errors);
  validateUnknowns(value.unknowns, errors);
  if (value.operatingModel !== undefined) { const result = validateOperatingModel(value.operatingModel); if (!result.ok) errors.push(...result.errors); }
  validateProvenance(value.provenance, "provenance", errors);
  timeline(value.asOf, value.cutoffAt, value.validUntil, errors);
  instant(value.createdAt, "createdAt", errors);
  if (Array.isArray(value.selectedFacts) && Array.isArray(value.peerFacts)
    && Array.isArray(value.peers) && Array.isArray(value.operatingKpis)
    && Array.isArray(value.macroDrivers) && Array.isArray(value.industryDrivers)
    && value.operatingModel === undefined
    && value.selectedFacts.length + value.peerFacts.length + value.peers.length + value.operatingKpis.length + value.macroDrivers.length + value.industryDrivers.length === 0) {
    errors.push("context requires at least one cited fact or driver");
  }
  if (!record(value.currentness) || !["current", "historical"].includes(String(value.currentness.status))
    || !Array.isArray(value.currentness.invalidatedBy)
    || value.currentness.invalidatedBy.some((reason) => !["stale", "symbol_mismatch", "cutoff_or_symbol_mismatch", "membership_version_mismatch"].includes(String(reason)))) {
    errors.push("currentness is invalid");
  }
  if (record(value.currentness) && Array.isArray(value.currentness.invalidatedBy) && ((value.currentness.status === "current" && value.currentness.invalidatedBy.length > 0)
    || (value.currentness.status === "historical" && value.currentness.invalidatedBy.length === 0))) errors.push("currentness status does not match invalidation reasons");
  if (!record(value.safety) || Object.keys(value.safety).length !== 6 || Object.values(value.safety).some((flag) => flag !== false)) {
    errors.push("safety must contain only false advisory-boundary flags");
  }
  try {
    const expected = Array.isArray(value.selectedFacts) && Array.isArray(value.peerFacts)
      ? buildResearchContextComparisons(value.selectedFacts as ResearchContextNumericFact[], value.peerFacts as ResearchContextNumericFact[])
      : [];
    // Retained snapshots may contain the former same-cutoff, periodless calculation.
    // New writes always use the strict calculation above; accept only the exact old
    // deterministic result when reading an immutable historical snapshot.
    const legacy = Array.isArray(value.selectedFacts) && Array.isArray(value.peerFacts)
      ? buildResearchContextComparisons(value.selectedFacts as ResearchContextNumericFact[],
        value.peerFacts as ResearchContextNumericFact[], true) : [];
    if (!sameJson(value.comparisons, expected) && !sameJson(value.comparisons, legacy))
      errors.push("comparisons are not deterministic for the supplied facts");
  } catch {
    errors.push("comparisons are not deterministic for the supplied facts");
  }
  return errors.length ? invalid(errors) : { ok: true };
}

export function validateResearchContextEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  if (!record(value) || value.schemaVersion !== RESEARCH_CONTEXT_SCHEMA_VERSION || !instantOk(value.generatedAt)
    || !envelopeContentHashMatches(value)) {
    return invalid(["research context envelope is invalid"]);
  }
  const status = value.status;
  if (!(status === "available" || status === "not_found" || status === "unavailable")
    || !positiveIdOk(value.membershipId) || typeof value.requestedActorId !== "string"
    || !(value.requestedSymbol === null || symbolOk(value.requestedSymbol))
    || !record(value.metadata) || !validateFactMetadata(value.metadata).ok
    || typeof value.message !== "string") return invalid(["research context envelope is invalid"]);
  if (typeof value.historyHasMore !== "boolean"
    || !validateHistory(value.history, value.historyHasMore)
    || !validateChangeSummary(value.changeSummary)) {
    return invalid(["research context history is invalid"]);
  }
  if (value.peerSourceIssues !== undefined) {
    if (!Array.isArray(value.peerSourceIssues) || value.peerSourceIssues.length > 5
      || value.peerSourceIssues.some((issue) => !record(issue)
        || Object.keys(issue).sort().join() !== "peerId,reason,status,symbol"
        || !positiveIdOk(issue.peerId) || !symbolOk(issue.symbol)
        || !["stale", "unavailable"].includes(String(issue.status))
        || !["material_changed", "original_unavailable"].includes(String(issue.reason))
        || (issue.status === "stale") !== (issue.reason === "material_changed")))
      return invalid(["peer source issues are invalid"]);
    const issues = value.peerSourceIssues as ResearchPeerSourceIssue[];
    if (new Set(issues.map((issue) => issue.peerId)).size !== issues.length
      || status !== "available" && issues.length > 0
      || status === "available" && (!record(value.data)
        || issues.some((issue) => !(value.data as unknown as ResearchContextSnapshotData).peers
          .some((peer) => peer.id === issue.peerId && peer.symbol === issue.symbol))))
      return invalid(["peer source issues do not match the saved peers"]);
  }
  if (value.peerFactSourceIssues !== undefined) {
    if (!Array.isArray(value.peerFactSourceIssues) || value.peerFactSourceIssues.length > 100
      || value.peerFactSourceIssues.some(issue => !record(issue)
        || Object.keys(issue).sort().join() !== "factId,reason,status,symbol"
        || !positiveIdOk(issue.factId) || !symbolOk(issue.symbol)
        || (issue.status === "stale") !== (issue.reason === "material_changed")
        || !["stale", "unavailable"].includes(String(issue.status))
        || !["material_changed", "original_unavailable"].includes(String(issue.reason))))
      return invalid(["peer fact source issues are invalid"]);
    const issues = value.peerFactSourceIssues as ResearchPeerFactSourceIssue[];
    if (new Set(issues.map(issue => issue.factId)).size !== issues.length
      || status !== "available" && issues.length > 0
      || status === "available" && (!record(value.data)
        || issues.some(issue => !(value.data as unknown as ResearchContextSnapshotData).peerFacts
          .some(fact => fact.id === issue.factId && fact.symbol === issue.symbol))))
      return invalid(["peer fact source issues do not match saved facts"]);
  }
  if (status === "available") {
    if (!symbolOk(value.requestedSymbol) || !record(value.data)
      || !validateResearchContextSnapshotData(value.data).ok
      || value.data.selectedSymbol !== value.requestedSymbol
      || value.data.membershipId !== value.membershipId
      || !Array.isArray(value.history) || value.history.length === 0
      || value.history[0]?.id !== value.data.id
      || !historyMatchesSnapshot(value.history[0] as ResearchContextHistoryEntry, value.data as unknown as ResearchContextSnapshotData)
      || !record(value.changeSummary)
      || value.changeSummary.currentContextId !== value.data.id
      || value.changeSummary.previousContextId !== (value.history[1]?.id ?? null)) {
      return invalid(["available research context must match requested symbol and membership"]);
    }
  } else if (value.data !== null || value.changeSummary !== null
    || (status === "not_found" && (value.history.length > 0 || value.historyHasMore !== false))) {
    return invalid(["non-available research context cannot include data"]);
  }
  return { ok: true };
}

function envelopeContentHashMatches(value: Record<string, unknown>): boolean {
  if (value.contentHash === undefined) return true;
  return value.status === "available" && record(value.data)
    && validateResearchContextSnapshotData(value.data).ok
    && value.contentHash === researchContextContentHash(value.data as unknown as ResearchContextSnapshotData);
}

function historyMatchesSnapshot(entry: ResearchContextHistoryEntry, data: ResearchContextSnapshotData): boolean {
  return entry.industry === data.industry
    && entry.cutoffAt === data.cutoffAt
    && entry.validUntil === data.validUntil
    && entry.createdAt === data.createdAt
    && entry.itemCounts.selectedFacts === data.selectedFacts.length
    && entry.itemCounts.peerFacts === data.peerFacts.length
    && entry.itemCounts.peers === data.peers.length
    && entry.itemCounts.operatingKpis === data.operatingKpis.length
    && entry.itemCounts.macroDrivers === data.macroDrivers.length
    && entry.itemCounts.industryDrivers === data.industryDrivers.length
    && entry.itemCounts.unknowns === data.unknowns.length;
}

function validateHistory(value: unknown, hasMore: boolean): value is ResearchContextHistoryEntry[] {
  if (!Array.isArray(value) || value.length > 20) return false;
  const ids = new Set<string>();
  let previousRevision = Number.POSITIVE_INFINITY;
  for (const item of value) {
    if (!record(item) || !record(item.itemCounts)) return false;
    const counts = item.itemCounts;
    if (!positiveIdOk(item.id)
      || !(item.previousContextId === null || positiveIdOk(item.previousContextId))
      || !Number.isSafeInteger(item.revision) || Number(item.revision) <= 0
      || Number(item.revision) >= previousRevision
      || !boundedOk(item.industry, 200) || !instantOk(item.cutoffAt)
      || !instantOk(item.validUntil) || !instantOk(item.createdAt)
      || !["selectedFacts", "peerFacts", "peers", "operatingKpis", "macroDrivers", "industryDrivers", "unknowns"]
        .every((key) => Number.isSafeInteger(counts[key]) && Number(counts[key]) >= 0)) return false;
    if (ids.has(item.id)) return false;
    ids.add(item.id);
    previousRevision = Number(item.revision);
  }
  return value.every((item, index) => {
    const next = value[index + 1];
    return next ? item.previousContextId === next.id : hasMore ? positiveIdOk(item.previousContextId) : item.previousContextId === null;
  });
}

function validateChangeSummary(value: unknown): value is ResearchContextChangeSummary | null {
  if (value === null) return true;
  if (!record(value) || !positiveIdOk(value.currentContextId)
    || !(value.previousContextId === null || positiveIdOk(value.previousContextId))
    || !validSections(value.changedSections) || !validSections(value.unchangedSections)) return false;
  const changed = value.changedSections as ResearchContextSection[];
  const unchanged = value.unchangedSections as ResearchContextSection[];
  if (new Set([...changed, ...unchanged]).size !== changed.length + unchanged.length) return false;
  return value.previousContextId === null
    ? changed.length === 0 && unchanged.length === 0
    : changed.length + unchanged.length === RESEARCH_CONTEXT_SECTIONS.length;
}

function validSections(value: unknown): value is ResearchContextSection[] {
  return Array.isArray(value) && new Set(value).size === value.length
    && value.every((section) => RESEARCH_CONTEXT_SECTIONS.includes(section as ResearchContextSection));
}

function validateFacts(value: unknown, field: string, selectedSymbol: unknown, cutoffAt: unknown, errors: string[], peers = false): void {
  if (!Array.isArray(value)) { errors.push(`${field} must be an array`); return; }
  if (value.length > 100) errors.push(`${field} must contain at most 100 facts`);
  value.forEach((item, index) => validateFact(item, `${field}[${index}]`, selectedSymbol, cutoffAt, errors, peers));
}

function uniqueStableIds(first: unknown, second: unknown, kind: string, errors: string[]): void {
  if (!Array.isArray(first) || !Array.isArray(second)) return;
  const ids = [...first, ...second]
    .filter(record)
    .map((item) => item.id)
    .filter((id): id is string => typeof id === "string");
  if (new Set(ids).size !== ids.length) errors.push(`context ${kind} ids must be unique`);
}

function validateFact(value: unknown, field: string, selectedSymbol: unknown, cutoffAt: unknown, errors: string[], peer: boolean): void {
  if (!record(value)) { errors.push(`${field} must be an object`); return; }
  exact(value, ["id", "selectedSymbol", "symbol", "metric", "value", "unit", "currency", "asOf", "cutoffAt", "validUntil", "citation", "provenance",
    ...(value.periodStart === undefined ? [] : ["periodStart"]),
    ...(value.periodEnd === undefined ? [] : ["periodEnd"])], field, errors);
  positiveId(value.id, `${field}.id`, errors);
  if (value.selectedSymbol !== selectedSymbol || !symbolOk(value.selectedSymbol)) errors.push(`${field}.selectedSymbol does not bind the selected symbol`);
  if (!symbolOk(value.symbol) || (!peer && value.symbol !== selectedSymbol) || (peer && value.symbol === selectedSymbol)) errors.push(`${field}.symbol is invalid for its fact set`);
  bounded(value.metric, `${field}.metric`, 200, errors);
  if (value.value !== null && !decimalOk(value.value)) errors.push(`${field}.value must be a canonical decimal or null`);
  bounded(value.unit, `${field}.unit`, 100, errors);
  if (value.currency !== null && (typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency))) errors.push(`${field}.currency must be null or an uppercase three-letter code`);
  if (value.periodStart !== undefined && value.periodEnd === undefined)
    errors.push(`${field}.periodStart requires periodEnd`);
  if (value.periodEnd !== undefined && (!calendarDateOk(value.periodEnd)
    || new Date(String(value.periodEnd) + "T00:00:00.000Z").getTime() > Date.parse(String(value.asOf))))
    errors.push(`${field}.periodEnd must be a disclosed measurement date`);
  if (value.periodStart !== undefined && (!calendarDateOk(value.periodStart)
    || String(value.periodStart) >= String(value.periodEnd)))
    errors.push(`${field}.periodStart must precede periodEnd`);
  timeline(value.asOf, value.cutoffAt, value.validUntil, errors, field);
  if (laterThan(value.cutoffAt, cutoffAt)) errors.push(`${field}.cutoffAt must not exceed the snapshot cutoff`);
  if (peer) validatePeerCitation(value.citation, `${field}.citation`, errors);
  else validateCitation(value.citation, `${field}.citation`, errors);
  if (peer) validatePeerSourceMembership(value.citation, value.symbol, `${field}.citation`, errors);
  if (peer && record(value.citation) && value.citation.kind === "saved_material" && record(value.provenance)
    && (value.provenance.sourceType !== value.citation.sourceType
      || value.provenance.sourceVersion !== value.citation.sourceVersion
      || value.provenance.classification !== (value.citation.sourceType === "issuer_public_html"
        ? "authorized_public" : "research_only")))
    errors.push(`${field}.provenance does not match peer source`);
  validateProvenance(value.provenance, `${field}.provenance`, errors);
}

function validateDrivers(value: unknown, field: string, selectedSymbol: unknown, cutoffAt: unknown, kind: "macro" | "industry", errors: string[]): void {
  if (!Array.isArray(value)) { errors.push(`${field} must be an array`); return; }
  if (value.length > 100) errors.push(`${field} must contain at most 100 drivers`);
  value.forEach((item, index) => {
    const path = `${field}[${index}]`;
    if (!record(item)) { errors.push(`${path} must be an object`); return; }
    exact(item, ["id", "selectedSymbol", "kind", "dimension", "impact", "statement", "thesisRelevance", "asOf", "cutoffAt", "validUntil", "citation", "provenance"], path, errors);
    positiveId(item.id, `${path}.id`, errors);
    if (item.selectedSymbol !== selectedSymbol || !symbolOk(item.selectedSymbol)) errors.push(`${path}.selectedSymbol does not bind the selected symbol`);
    if (item.kind !== kind) errors.push(`${path}.kind is invalid`);
    const dimensions = kind === "industry" ? RESEARCH_INDUSTRY_DIMENSIONS : RESEARCH_MACRO_DIMENSIONS;
    if (!dimensions.includes(item.dimension as never)) errors.push(`${path}.dimension is invalid`);
    if (!["supportive", "adverse", "mixed", "unknown"].includes(String(item.impact))) errors.push(`${path}.impact is invalid`);
    bounded(item.statement, `${path}.statement`, 4000, errors);
    bounded(item.thesisRelevance, `${path}.thesisRelevance`, 1000, errors);
    timeline(item.asOf, item.cutoffAt, item.validUntil, errors, path);
    if (laterThan(item.cutoffAt, cutoffAt)) errors.push(`${path}.cutoffAt must not exceed the snapshot cutoff`);
    validateCitation(item.citation, `${path}.citation`, errors);
    validateProvenance(item.provenance, `${path}.provenance`, errors);
  });
}

function validatePeerCitation(value: unknown, field: string, errors: string[]): void {
  const sha = (input: unknown) => typeof input === "string" && /^[a-f0-9]{64}$/.test(input);
  if (!record(value)) { errors.push(`${field} is required`); return; }
  if (value.kind !== "saved_material") { validateCitation(value, field, errors, true); return; }
  const html = value.sourceType === "issuer_public_html";
  const provider = value.sourceType === "futu_opend_financial_statement_provider";
  exact(value, ["kind","materialId","materialRevision","contentFingerprint","sourceType","sourceUrl",
    "sourceVersion",...(value.sourceMembership === undefined ? [] : ["sourceMembership"]),
    ...(html?["snapshotCitation","snapshotRawSha256"]:provider?["providerOriginal"]:[])], field, errors);
  if (value.sourceMembership !== undefined) validateSourceMembership(value.sourceMembership, `${field}.sourceMembership`, errors);
  positiveId(value.materialId, `${field}.materialId`, errors);
  positiveInteger(value.materialRevision, `${field}.materialRevision`, errors);
  if (!sha(value.contentFingerprint)) errors.push(`${field}.contentFingerprint is invalid`);
  if (!html && !provider) errors.push(`${field}.sourceType is invalid`);
  if (html ? !httpUrl(value.sourceUrl) : value.sourceUrl !== null) errors.push(`${field}.sourceUrl is invalid`);
  bounded(value.sourceVersion, `${field}.sourceVersion`, 200, errors);
  if (html) {
    const c = value.snapshotCitation;
    if (!record(c)) { errors.push(`${field}.snapshotCitation is invalid`); return; }
    exact(c,["kind","snapshotId","textSha256","startUtf16","endUtf16","excerptSha256"],`${field}.snapshotCitation`,errors);
    if (c.kind !== "source_snapshot" || !positiveIdOk(c.snapshotId) || !sha(c.textSha256)
      || !sha(c.excerptSha256) || !Number.isSafeInteger(c.startUtf16) || Number(c.startUtf16)<0
      || !Number.isSafeInteger(c.endUtf16) || Number(c.endUtf16)<=Number(c.startUtf16)
      || Number(c.endUtf16)-Number(c.startUtf16)>4000 || !sha(value.snapshotRawSha256)) errors.push(`${field}.snapshot identity is invalid`);
  }
  if (provider) {
    const c = value.providerOriginal;
    if (!record(c)) { errors.push(`${field}.providerOriginal is invalid`); return; }
    exact(c,["captureId","pageId","rawSha256","reportSha256"],`${field}.providerOriginal`,errors);
    if (!positiveIdOk(c.captureId) || !positiveIdOk(c.pageId) || !sha(c.rawSha256) || !sha(c.reportSha256))
      errors.push(`${field}.provider original identity is invalid`);
  }
}

function validatePeers(value: unknown, selectedSymbol: unknown, cutoffAt: unknown, errors: string[]): void {
  if (!Array.isArray(value)) { errors.push("peers must be an array"); return; }
  if (value.length > 5) errors.push("peers must contain at most 5 companies");
  const symbols = new Set<string>();
  value.forEach((item, index) => {
    const path = `peers[${index}]`;
    if (!record(item)) { errors.push(`${path} must be an object`); return; }
    exact(item, ["id", "selectedSymbol", "symbol", "name", "status", "reason", "asOf", "cutoffAt", "validUntil", "citation", "provenance"], path, errors);
    positiveId(item.id, `${path}.id`, errors);
    if (item.selectedSymbol !== selectedSymbol || !symbolOk(item.symbol) || item.symbol === selectedSymbol) errors.push(`${path}.symbol is invalid`);
    if (typeof item.symbol === "string") { if (symbols.has(item.symbol)) errors.push(`${path}.symbol is duplicated`); symbols.add(item.symbol); }
    bounded(item.name, `${path}.name`, 200, errors);
    if (!["included", "excluded"].includes(String(item.status))) errors.push(`${path}.status is invalid`);
    bounded(item.reason, `${path}.reason`, 1000, errors);
    timeline(item.asOf, item.cutoffAt, item.validUntil, errors, path);
    if (laterThan(item.cutoffAt, cutoffAt)) errors.push(`${path}.cutoffAt must not exceed the snapshot cutoff`);
    validatePeerCitation(item.citation, `${path}.citation`, errors);
    validatePeerSourceMembership(item.citation, item.symbol, `${path}.citation`, errors);
    validateProvenance(item.provenance, `${path}.provenance`, errors);
    if (record(item.citation) && item.citation.kind === "saved_material" && record(item.provenance)) {
      if (item.provenance.sourceType !== item.citation.sourceType
        || item.provenance.sourceVersion !== item.citation.sourceVersion
        || item.provenance.classification !== (item.citation.sourceType === "issuer_public_html"
          ? "authorized_public" : "research_only")) errors.push(`${path}.provenance does not match saved source`);
    }
  });
}

function validateOperatingKpis(value: unknown, selectedSymbol: unknown, cutoffAt: unknown, errors: string[]): void {
  if (!Array.isArray(value)) { errors.push("operatingKpis must be an array"); return; }
  if (value.length > 100) errors.push("operatingKpis must contain at most 100 facts");
  value.forEach((item, index) => {
    const path = `operatingKpis[${index}]`;
    if (!record(item)) { errors.push(`${path} must be an object`); return; }
    exact(item, ["id", "selectedSymbol", "category", "metric", "periodStart", "periodEnd", "valueStatus", "value", "unit", "comparability", "comparabilityReason", "asOf", "cutoffAt", "validUntil", "citation", "provenance"], path, errors);
    positiveId(item.id, `${path}.id`, errors);
    if (item.selectedSymbol !== selectedSymbol) errors.push(`${path}.selectedSymbol does not bind the selected symbol`);
    if (!["operating", "price"].includes(String(item.category))) errors.push(`${path}.category is invalid`);
    bounded(item.metric, `${path}.metric`, 200, errors);
    if (!calendarDateOk(item.periodStart) || !calendarDateOk(item.periodEnd) || String(item.periodStart) >= String(item.periodEnd)) errors.push(`${path}.period is invalid`);
    if (!["reported", "explicit_unknown"].includes(String(item.valueStatus))) errors.push(`${path}.valueStatus is invalid`);
    if (item.valueStatus === "reported" ? !decimalOk(item.value) : item.value !== null) errors.push(`${path}.value does not match valueStatus`);
    bounded(item.unit, `${path}.unit`, 100, errors);
    if (!["comparable", "not_comparable"].includes(String(item.comparability))) errors.push(`${path}.comparability is invalid`);
    if (item.comparability === "not_comparable") bounded(item.comparabilityReason, `${path}.comparabilityReason`, 500, errors);
    else if (item.comparabilityReason !== null) errors.push(`${path}.comparabilityReason must be null when comparable`);
    timeline(item.asOf, item.cutoffAt, item.validUntil, errors, path);
    if (laterThan(item.cutoffAt, cutoffAt)) errors.push(`${path}.cutoffAt must not exceed the snapshot cutoff`);
    validateCitation(item.citation, `${path}.citation`, errors);
    validateProvenance(item.provenance, `${path}.provenance`, errors);
  });
}

function validateCitation(value: unknown, field: string, errors: string[], allowPeerSource = false): void {
  if (!record(value)) { errors.push(`${field} is required`); return; }
  exact(value, ["documentId", "pageNumber", "pageTextSha256", "sourceType", "sourceUrl", "sourceVersion",
    ...(allowPeerSource && value.sourceMembership !== undefined ? ["sourceMembership"] : [])], field, errors);
  if (allowPeerSource && value.sourceMembership !== undefined)
    validateSourceMembership(value.sourceMembership, `${field}.sourceMembership`, errors);
  positiveId(value.documentId, `${field}.documentId`, errors);
  positiveInteger(value.pageNumber, `${field}.pageNumber`, errors);
  if (typeof value.pageTextSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.pageTextSha256)) errors.push(`${field}.pageTextSha256 is invalid`);
  bounded(value.sourceType, `${field}.sourceType`, 200, errors);
  if (value.sourceUrl !== null && !httpUrl(value.sourceUrl)) errors.push(`${field}.sourceUrl must be null or an http(s) URL`);
  bounded(value.sourceVersion, `${field}.sourceVersion`, 200, errors);
}

function validateSourceMembership(value: unknown, field: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${field} must be an object`); return; }
  exact(value, ["membershipId", "membershipVersion", "symbol"], field, errors);
  positiveId(value.membershipId, `${field}.membershipId`, errors);
  positiveInteger(value.membershipVersion, `${field}.membershipVersion`, errors);
  symbol(value.symbol, `${field}.symbol`, errors);
}

function validatePeerSourceMembership(citation: unknown, peerSymbol: unknown, field: string, errors: string[]): void {
  if (record(citation) && record(citation.sourceMembership)
    && citation.sourceMembership.symbol !== peerSymbol)
    errors.push(`${field}.sourceMembership must bind the peer symbol`);
}

function validateProvenance(value: unknown, field: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${field} is required`); return; }
  exact(value, ["sourceType", "sourceVersion", "capturedAt", "classification"], field, errors);
  bounded(value.sourceType, `${field}.sourceType`, 200, errors);
  bounded(value.sourceVersion, `${field}.sourceVersion`, 200, errors);
  instant(value.capturedAt, `${field}.capturedAt`, errors);
  if (!["authorized_public", "user_provided", "research_only"].includes(String(value.classification))) errors.push(`${field}.classification is invalid`);
}

function validateUnknowns(value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== "string" || item.trim().length === 0 || item.length > 500)) errors.push("unknowns must be up to 100 non-empty strings");
}

function timeline(asOf: unknown, cutoffAt: unknown, validUntil: unknown, errors: string[], field = "request"): void {
  instant(asOf, `${field}.asOf`, errors);
  instant(cutoffAt, `${field}.cutoffAt`, errors);
  instant(validUntil, `${field}.validUntil`, errors);
  if (instantOk(asOf) && instantOk(cutoffAt) && Date.parse(String(cutoffAt)) > Date.parse(String(asOf))) errors.push(`${field}.cutoffAt must not be later than asOf`);
  if (instantOk(asOf) && instantOk(validUntil) && Date.parse(String(validUntil)) <= Date.parse(String(asOf))) errors.push(`${field}.validUntil must be later than asOf`);
}

function notComparable(peer: ResearchContextNumericFact, selected: ResearchContextNumericFact | null, reason: string): ResearchContextComparison {
  return {
    peerSymbol: peer.symbol,
    metric: peer.metric,
    selectedFactId: selected?.id ?? null,
    peerFactId: peer.id,
    unit: peer.unit,
    currency: peer.currency,
    status: "not_comparable",
    selectedValue: selected?.value ?? null,
    peerValue: peer.value,
    delta: null,
    reason,
    calculationVersion: RESEARCH_CONTEXT_COMPARISON_VERSION
  };
}

function decimalDelta(left: string, right: string): string {
  const a = decimal(left); const b = decimal(right); const scale = a.scale > b.scale ? a.scale : b.scale;
  return render({ integer: a.integer * (scale / a.scale) - b.integer * (scale / b.scale), scale });
}

function decimal(value: string): { integer: bigint; scale: bigint } {
  const negative = value.startsWith("-"); const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  return { integer: BigInt(`${whole}${fraction}`) * (negative ? -1n : 1n), scale: 10n ** BigInt(fraction.length) };
}

function render(value: { integer: bigint; scale: bigint }): string {
  const negative = value.integer < 0n; const absolute = negative ? -value.integer : value.integer;
  const digits = absolute.toString().padStart(value.scale.toString().length, "0"); const places = value.scale.toString().length - 1;
  const whole = places ? digits.slice(0, -places) || "0" : digits; const fraction = places ? digits.slice(-places).replace(/0+$/, "") : "";
  const result = fraction ? `${whole}.${fraction}` : whole; return negative && result !== "0" ? `-${result}` : result;
}

function sameJson(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
function laterThan(value: unknown, ceiling: unknown): boolean { return instantOk(value) && instantOk(ceiling) && Date.parse(String(value)) > Date.parse(String(ceiling)); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[], field: string, errors: string[]): void { const allowed = new Set(keys); for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${field}.${key} is not allowed`); }
function positiveId(value: unknown, field: string, errors: string[]): void { if (!positiveIdOk(value)) errors.push(`${field} must be a positive integer string`); }
function positiveIdOk(value: unknown): value is string { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function positiveInteger(value: unknown, field: string, errors: string[]): void { if (!Number.isSafeInteger(value) || Number(value) <= 0) errors.push(`${field} must be a positive integer`); }
function symbol(value: unknown, field: string, errors: string[]): void { if (!symbolOk(value)) errors.push(`${field} must be a canonical Hong Kong symbol`); }
function symbolOk(value: unknown): boolean { return typeof value === "string" && /^HK\.\d{5}$/.test(value); }
function bounded(value: unknown, field: string, max: number, errors: string[]): void { if (typeof value !== "string" || value.trim().length === 0 || value.length > max) errors.push(`${field} must be a non-empty string of at most ${max} characters`); }
function boundedOk(value: unknown, max: number): boolean { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function instant(value: unknown, field: string, errors: string[]): void { if (!instantOk(value)) errors.push(`${field} must be a valid RFC3339 date-time`); }
function instantOk(value: unknown): boolean { return typeof value === "string" && isRfc3339DateTime(value) && Number.isFinite(Date.parse(value)); }
function calendarDateOk(value: unknown): boolean { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const parsed = Date.parse(`${value}T00:00:00.000Z`); return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value; }
function decimalOk(value: unknown): boolean { return typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value) && value !== "-0"; }
function httpUrl(value: unknown): boolean { if (typeof value !== "string" || value.length === 0 || value.length > 2000) return false; try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }
function invalid(errors: string[]): { ok: false; errors: string[] } { return { ok: false, errors }; }
