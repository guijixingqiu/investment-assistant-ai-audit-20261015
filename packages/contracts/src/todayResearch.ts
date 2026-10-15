import {
  EVIDENCE_BOUND_REPORT_CONTRACT_VERSION,
  type DeepResearchReportData,
  type DeepResearchWorkspaceEnvelope,
  type EvidenceBoundDeepResearchReportPayload
} from "./deepResearch.js";
import { type FactMetadata, isRfc3339DateTime, validateFactMetadataInto } from "./factMetadata.js";
import {
  RESEARCH_EVENT_KINDS,
  researchEventMonitorRuleBindingMatchesCurrent,
  researchStockMaterials,
  type ResearchEventKind,
  type ResearchEventMonitorRuleBinding
} from "./researchEvent.js";
import {
  DEEP_RESEARCH_OBJECTIVE_CHECK_IDS,
  type TodaySourceIssueCode,
  todayResearchBindingsMatchQuality, validateTodayResearchQualityInto,
  validTodayEvidencePackRef,
  validTodayReportRef
} from "./todayResearchQualityValidation.js";
export { TODAY_SOURCE_ISSUE_CODES } from "./todayResearchQualityValidation.js";
export const TODAY_RESEARCH_SCHEMA_VERSION = "2026-07-25.today-research.v2";
export type TodayResearchStatus = "available" | "stale" | "conflict" | "not_found" | "unauthorized" | "malformed" | "unavailable";
export type TodayResearchTrackingState =
  | "needs_material" | "needs_evidence_pack" | "needs_research"
  | "awaiting_user_confirmation" | "needs_review" | "confirmed" | "rejected";
export type TodaySourceHealthStatus =
  | "healthy" | "missing" | "stale" | "conflict"
  | "verification_blocked" | "rights_blocked" | "revision_mismatch";
export interface TodayResearchFactRef {
  materialId: string;
  evidenceId: string;
  sourceType: string;
  sourceVersion: string;
  revision: number;
  contentFingerprint: string;
  publishedAt: string;
  capturedAt: string;
  validUntil: string;
  verificationStatus: "verified";
  rightsStatus: "user_provided" | "authorized_public";
}
export interface TodayResearchEventRef {
  eventId: string;
  eventVersion: number;
  eventFingerprint: string;
  coverageScope: "research_stock" | "current_holding";
  keyVariable: string;
  hypothesisImpact: "supports" | "weakens" | "unknown";
  monitorRuleBinding: ResearchEventMonitorRuleBinding | null;
}
export interface TodayResearchHoldingSnapshotRef {
  accountScopeId: string;
  snapshotId: string;
  sourceBatchId: string;
  sourceAsOf: string;
  positionSourceRowId: string;
}
export interface TodayResearchBindings {
  membershipId: string;
  membershipVersion: number;
  factRefs: TodayResearchFactRef[];
  eventRefs: TodayResearchEventRef[];
  monitorRef: { kind: "geely_sales" | "gcl_pv_price" | "weinstein_structure"; id: string; runVersion: number; runFingerprint: string } | null;
  evidencePackRef: { id: string; version: number; packFingerprint: string } | null;
  reportRef: { id: string; version: number; evidencePackId: string; status: "evidence_insufficient" | "complete_pending_confirmation" } | null;
  decisionRef: { id: string; reportId: string; decision: "confirmed" | "rejected"; decidedAt: string } | null;
  holdingSnapshotRefs: TodayResearchHoldingSnapshotRef[];
}
export interface TodayResearchReportRevisionRef {
  id: string;
  version: number;
  evidencePackId: string;
  reportFingerprint: string | "UNKNOWN";
}
export interface TodayResearchReportRevision {
  current: TodayResearchReportRevisionRef;
  previous: TodayResearchReportRevisionRef | null;
  declaredChange: string;
  changedSections: string[];
  unchangedSections: string[];
  bindingChanged: boolean | null;
}
export interface TodayResearchItem {
  id: string;
  order: number;
  category: "user_action" | "holding_logic_change" | "research_change";
  priority: "action" | "high" | "medium" | "low";
  trackingState: TodayResearchTrackingState;
  symbol: string;
  title: string;
  summary: string;
  thesis: string | null;
  invalidationConditions: string[];
  nextCheckpoint: string | null;
  versionChange: string | null;
  reportRevision: TodayResearchReportRevision | null;
  bindings: TodayResearchBindings;
}
export interface TodayResearchQuality {
  sourceHealth: { id: string; status: TodaySourceHealthStatus; issueCodes: TodaySourceIssueCode[];
    totalMaterialCount: number; currentMaterialCount: number; evidencePackRef: TodayResearchBindings["evidencePackRef"] };
  researchStructure: { id: string; status: "not_started" | "blocked" | "passed";
    checks: { id: (typeof DEEP_RESEARCH_OBJECTIVE_CHECK_IDS)[number]; passed: boolean }[];
    gateFailures: string[]; reportRef: TodayResearchBindings["reportRef"] };
  secondOpinion: { status: "not_evaluated"; dependencyIncluded: false; reason: string };
}
export interface TodayResearchEnvelope {
  schemaVersion: typeof TODAY_RESEARCH_SCHEMA_VERSION;
  generatedAt: string;
  status: TodayResearchStatus;
  membershipId: string;
  membershipVersion: number | null;
  requestedActorId: string;
  requestedSymbol: string | null;
  metadata: FactMetadata;
  quality: TodayResearchQuality | null;
  items: TodayResearchItem[];
  omittedItemCount: number;
  message: string;
  safety: {
    advisoryOnly: true;
    createsOrder: false;
    createsTrade: false;
    mutatesCash: false;
    writesFee: false;
    mutatesPosition: false;
    callsBroker: false;
    productionWrite: false;
  };
}
type WorkspaceData = NonNullable<DeepResearchWorkspaceEnvelope["data"]>;
type RawItem = Omit<TodayResearchItem, "order"> & { rank: number; sourceVersion: number };
export interface TodayWeinsteinStructureChange { id: string; version: number; fingerprint: string; priority: "action" | "high" | "medium"; title: string; summary: string }
export function buildTodayResearchItems(data: WorkspaceData, now = new Date(), technicalChange: TodayWeinsteinStructureChange | null = null): { items: TodayResearchItem[]; omittedItemCount: number } {
  const raw: RawItem[] = [researchVersionItem(data, now)];
  if (technicalChange) raw.push({ id: `weinstein_structure:${technicalChange.id}:v${technicalChange.version}`, rank: 5, sourceVersion: technicalChange.version, category: "research_change", priority: technicalChange.priority, trackingState: "needs_review", symbol: data.target.symbol, title: text(technicalChange.title), summary: text(technicalChange.summary), ...researchContext(data), reportRevision: null, bindings: bindings(data, [], [], { kind: "weinstein_structure", id: technicalChange.id, runVersion: technicalChange.version, runFingerprint: technicalChange.fingerprint }) });
  const materialById = new Map(data.materials.map((material) => [material.id, material]));
  const includedMonitorEventIds = new Set<string>();
  const monitors = [
    data.latestGclPvPriceMonitor && gclIsMaterial(data.latestGclPvPriceMonitor) ? monitorItem(data, "gcl_pv_price") : null,
    data.latestGeelySalesMonitor && geelyIsMaterial(data.latestGeelySalesMonitor) ? monitorItem(data, "geely_sales") : null
  ].filter((item): item is RawItem => item !== null);
  for (const item of monitors) {
    if (item.trackingState === "needs_review") {
      raw.push(item);
      item.bindings.eventRefs.forEach((event) => includedMonitorEventIds.add(event.eventId));
    }
  }
  for (const event of data.events) {
    if (includedMonitorEventIds.has(event.id) || !eventIsMaterial(event, now)) continue;
    const material = materialById.get(event.source.materialId);
    const factRefs = [factRef(event.source)];
    if (coveredByConfirmedReport(data, factRefs)) continue;
    const priority: TodayResearchItem["priority"] = event.importance === "high" ? "high" : event.importance === "medium" ? "medium" : "low";
    raw.push({
      id: `event:${event.id}:v${event.eventVersion}`,
      rank: (event.coverageScope === "current_holding" ? 10 : 30) + (priority === "high" ? 0 : priority === "medium" ? 10 : 20),
      sourceVersion: event.eventVersion,
      category: event.coverageScope === "current_holding" ? "holding_logic_change" : "research_change",
      priority,
      trackingState: "needs_review",
      symbol: data.target.symbol,
      title: material?.title ?? `${data.target.symbol} ${event.eventKind} changed ${event.keyVariable}`,
      summary: text(`${material?.summary ?? event.importanceReasons.join(" ")} Hypothesis impact: ${event.hypothesisImpact}.${event.monitorRuleBinding
        ? ` Monitor rule v${event.monitorRuleBinding.version}: ${event.monitorRuleBinding.reason}; threshold: ${event.monitorRuleBinding.threshold}.`
        : ""}`),
      ...researchContext(data),
      reportRevision: null,
      bindings: bindings(data, factRefs, [event], null)
    });
  }
  raw.sort((left, right) => left.rank - right.rank || right.sourceVersion - left.sourceVersion || left.id.localeCompare(right.id));
  const selected = raw.slice(0, 50);
  return {
    items: selected.map(({ rank: _rank, sourceVersion: _sourceVersion, ...item }, index) => ({ ...item, order: index + 1 })),
    omittedItemCount: raw.length - selected.length
  };
}
export function validateTodayResearchEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["Today envelope must be an object"] };
  exact(value, ["schemaVersion", "generatedAt", "status", "membershipId", "membershipVersion", "requestedActorId", "requestedSymbol", "metadata", "quality", "items", "omittedItemCount", "message", "safety"], "envelope", errors);
  if (value.schemaVersion !== TODAY_RESEARCH_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  instant(value.generatedAt, "generatedAt", errors);
  if (!["available", "stale", "conflict", "not_found", "unauthorized", "malformed", "unavailable"].includes(String(value.status))) errors.push("status is invalid");
  bounded(value.membershipId, "membershipId", 50, errors);
  bounded(value.requestedActorId, "requestedActorId", 200, errors);
  validateFactMetadataInto(value.metadata, "metadata", errors);
  if (record(value.metadata) && (value.status === "available" && value.metadata.freshness !== "fresh"
    || value.status === "stale" && value.metadata.freshness !== "stale"
    || value.status === "conflict" && value.metadata.freshness !== "conflict")) errors.push("metadata does not match status");
  bounded(value.message, "message", 4000, errors);
  if (!Number.isSafeInteger(value.omittedItemCount) || Number(value.omittedItemCount) < 0) errors.push("omittedItemCount is invalid");
  const exposed = ["available", "stale", "conflict"].includes(String(value.status));
  if (exposed && (!positiveInteger(value.membershipVersion) || !hkSymbol(value.requestedSymbol))) errors.push("source identity is invalid");
  if (!exposed && (value.membershipVersion !== null || value.requestedSymbol !== null)) errors.push("fail-closed source identity must be cleared");
  if (exposed) validateTodayResearchQualityInto(value.quality, value.status, errors);
  else if (value.quality !== null) errors.push("fail-closed Today response must clear quality");
  const items = Array.isArray(value.items) ? value.items : [];
  if (!Array.isArray(value.items) || items.length > 50) errors.push("items must contain at most 50 rows");
  if (value.status === "available" && items.length === 0) errors.push("available Today response requires at least one item");
  if (value.status !== "available" && items.length) errors.push("non-available Today responses must clear items");
  const ids = new Set<string>();
  items.forEach((item, index) => {
    validateItem(item, value, index, errors);
    if (record(item) && typeof item.id === "string") {
      if (ids.has(item.id)) errors.push(`items[${index}].id is duplicated`);
      ids.add(item.id);
    }
  });
  validateSafety(value.safety, errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}
export function todayResearchSafety(): TodayResearchEnvelope["safety"] {
  return { advisoryOnly: true, createsOrder: false, createsTrade: false, mutatesCash: false, writesFee: false, mutatesPosition: false, callsBroker: false, productionWrite: false };
}

function researchVersionItem(data: WorkspaceData, now: Date): RawItem {
  const report = currentReport(data);
  const facts = (data.completion.state === "pack_required"
    ? researchStockMaterials(data.materials, data.events)
    : data.latestPack?.items ?? [])
    .filter((item) => item.revisionState === "current" && item.freshness === "fresh"
      && item.verificationStatus === "verified" && ["user_provided", "authorized_public"].includes(item.rightsStatus)
      && item.publishedAt!==null && Date.parse(item.publishedAt) <= now.getTime() && Date.parse(item.capturedAt) <= now.getTime())
    .map(factRef);
  const materialIds = new Set(facts.map((item) => item.materialId));
  const events = data.events.filter((event) => materialIds.has(event.source.materialId) && event.source.revisionState === "current");
  const completionTracking = completionTrackingState(data.completion.state);
  const trackingState = report || ["needs_material", "needs_evidence_pack", "needs_research"].includes(completionTracking)
    ? completionTracking : "needs_research";
  const incomplete = !["confirmed", "rejected"].includes(trackingState);
  const context = researchContext(data);
  return {
    id: incomplete
      ? `action:${data.target.membershipId}:v${data.target.membershipVersion}:${trackingState}`
      : `report:${report!.id}:v${report!.version}`,
    rank: incomplete ? 0 : 50,
    sourceVersion: report?.version ?? 0,
    category: incomplete ? "user_action" : "research_change",
    priority: incomplete ? "action" : "medium",
    trackingState,
    symbol: data.target.symbol,
    title: incomplete ? actionTitle(trackingState) : `Deep research v${report?.version ?? 0} ${trackingState}`,
    summary: text(incomplete ? data.completion.reasons.join(" ") : context.versionChange ?? "Latest deep-research version is tracked."),
    ...context,
    reportRevision: reportRevisionFor(data, report),
    bindings: bindings(data, facts, events, null)
  };
}

function monitorItem(data: WorkspaceData, kind: "geely_sales" | "gcl_pv_price"): RawItem | null {
  const geely = kind === "geely_sales" ? data.latestGeelySalesMonitor : null;
  const gcl = kind === "gcl_pv_price" ? data.latestGclPvPriceMonitor : null;
  const monitor = geely ?? gcl;
  if (!monitor) return null;
  const sourceIds = new Set(geely
    ? geely.observations.map((item) => item.sourceEvent.eventId)
    : [...gcl!.priceObservations, ...gcl!.contextObservations].map((item) => item.sourceEvent.eventId));
  const events = data.events.filter((event) => sourceIds.has(event.id));
  const facts = unique(events.map((event) => factRef(event.source)), (item) => item.materialId);
  const trackingState = coveredByConfirmedReport(data, facts) ? "confirmed" : "needs_review";
  const isGcl = kind === "gcl_pv_price";
  const summary = gcl
    ? `GCL PV ${gcl.period}: ${gcl.assessment.status}; trend=${gcl.assessment.trendConclusionAllowed}; spread=${gcl.assessment.spreadConclusionAllowed}.`
    : `Geely sales ${geely!.period}: ${geely!.assessment.status}; movement=${geely!.assessment.movement}.`;
  return {
    id: `${kind}:${monitor.id}:v${monitor.runVersion}`,
    rank: isGcl ? 15 : 35,
    sourceVersion: monitor.runVersion,
    category: isGcl ? "holding_logic_change" : "research_change",
    priority: isGcl ? "high" : "medium",
    trackingState,
    symbol: data.target.symbol,
    title: isGcl ? "GCL photovoltaic value-chain change" : "Geely new-energy sales change",
    summary,
    ...researchContext(data),
    reportRevision: null,
    bindings: bindings(data, facts, events, { kind, id: monitor.id, runVersion: monitor.runVersion, runFingerprint: monitor.runFingerprint })
  };
}
function bindings(
  data: WorkspaceData,
  facts: TodayResearchFactRef[],
  events: WorkspaceData["events"],
  monitorRef: TodayResearchBindings["monitorRef"]
): TodayResearchBindings {
  const pack = data.latestPack;
  const report = monitorRef?.kind === "weinstein_structure" ? null : currentReport(data);
  const decision = report && data.userDecision?.reportId === report.id ? data.userDecision : null;
  return {
    membershipId: data.target.membershipId,
    membershipVersion: data.target.membershipVersion,
    factRefs: unique(facts, (item) => `${item.materialId}:${item.revision}`),
    eventRefs: unique(events.map((event) => ({
      eventId: event.id, eventVersion: event.eventVersion, eventFingerprint: event.eventFingerprint,
      coverageScope: event.coverageScope, keyVariable: event.keyVariable,
      hypothesisImpact: event.hypothesisImpact as TodayResearchEventRef["hypothesisImpact"],
      monitorRuleBinding: event.monitorRuleBinding ?? null
    })), (item) => item.eventId),
    monitorRef,
    evidencePackRef: pack ? { id: pack.id, version: pack.version, packFingerprint: pack.packFingerprint } : null,
    reportRef: report ? { id: report.id, version: report.version, evidencePackId: report.evidencePackId, status: report.status } : null,
    decisionRef: decision ? { id: decision.id, reportId: decision.reportId, decision: decision.decision, decidedAt: decision.decidedAt } : null,
    holdingSnapshotRefs: unique(events.flatMap((event) => event.holdingBinding ? [event.holdingBinding] : []), (item) => `${item.accountScopeId}:${item.snapshotId}:${item.positionSourceRowId}`)
  };
}

function researchContext(data: WorkspaceData): Pick<TodayResearchItem, "thesis" | "invalidationConditions" | "nextCheckpoint" | "versionChange"> {
  const payload = currentReport(data)?.payload;
  return {
    thesis: payload?.investmentThesis ?? null,
    invalidationConditions: payload?.invalidationConditions ?? [],
    nextCheckpoint: payload?.nextValidationQuestions[0] ?? data.completion.reasons[0] ?? null,
    versionChange: payload?.changeFromPrevious ?? null
  };
}

function reportRevisionFor(data: WorkspaceData, report: DeepResearchReportData | null): TodayResearchReportRevision | null {
  if (!report || !record(report.currentness) || report.currentness.status !== "current" || report.currentness.invalidatedBy.length > 0
    || report.currentness.evidencePackInvalidatedBy.length > 0 || report.contractVersion !== EVIDENCE_BOUND_REPORT_CONTRACT_VERSION
    || !isEvidenceBoundPayload(report.payload)) return null;
  const previous = data.reports
    .filter((candidate) => candidate.id !== report.id && candidate.version < report.version)
    .sort((left, right) => right.version - left.version || compareIds(right.id, left.id))[0] ?? null;
  const previousPayload = previous && previous.contractVersion === EVIDENCE_BOUND_REPORT_CONTRACT_VERSION
    && isEvidenceBoundPayload(previous.payload) ? previous.payload : null;
  const current = reportRevisionRef(report);
  if (!previous || !previousPayload) {
    return {
      current,
      previous: previous ? reportRevisionRef(previous) : null,
      declaredChange: normalizedChange(report.payload.changeFromPrevious),
      changedSections: [],
      unchangedSections: [],
      bindingChanged: null
    };
  }
  const changedSections: string[] = [];
  const unchangedSections: string[] = [];
  compareSection("结论", report.payload.adviceLayer.conclusion, previousPayload.adviceLayer.conclusion, changedSections, unchangedSections);
  compareSection("置信度", report.payload.adviceLayer.confidence, previousPayload.adviceLayer.confidence, changedSections, unchangedSections);
  compareSection("适用期限", report.payload.adviceLayer.applicableUntil, previousPayload.adviceLayer.applicableUntil, changedSections, unchangedSections);
  compareSection("时间视角", report.payload.adviceLayer.horizonStatement, previousPayload.adviceLayer.horizonStatement, changedSections, unchangedSections);
  compareSection("长期观点与条件", report.payload.adviceLayer.longTerm, previousPayload.adviceLayer.longTerm, changedSections, unchangedSections);
  compareSection("中短期观点与条件", report.payload.adviceLayer.mediumShortTerm, previousPayload.adviceLayer.mediumShortTerm, changedSections, unchangedSections);
  compareSection("长短期冲突", report.payload.adviceLayer.conflict, previousPayload.adviceLayer.conflict, changedSections, unchangedSections);
  compareSection("材料事实", report.payload.researchLayer.fundamentals, previousPayload.researchLayer.fundamentals, changedSections, unchangedSections);
  compareSection("事件与催化", report.payload.researchLayer.eventsAndCatalysts, previousPayload.researchLayer.eventsAndCatalysts, changedSections, unchangedSections);
  compareSection("风险", report.payload.researchLayer.risks, previousPayload.researchLayer.risks, changedSections, unchangedSections);
  compareSection("反证", report.payload.researchLayer.counterevidence, previousPayload.researchLayer.counterevidence, changedSections, unchangedSections);
  compareSection("未知项", report.payload.researchLayer.unknowns, previousPayload.researchLayer.unknowns, changedSections, unchangedSections);
  compareSection("来源冲突", report.payload.researchLayer.sourceConflicts, previousPayload.researchLayer.sourceConflicts, changedSections, unchangedSections);
  compareSection("下一验证问题", report.payload.researchLayer.nextValidationQuestions, previousPayload.researchLayer.nextValidationQuestions, changedSections, unchangedSections);
  compareSection(
    "估值与技术事实",
    { valuation: report.payload.researchLayer.valuation, technical: report.payload.researchLayer.technical },
    { valuation: previousPayload.researchLayer.valuation, technical: previousPayload.researchLayer.technical },
    changedSections,
    unchangedSections
  );
  const bindingChanged = stableJson(report.payload.evidencePackBinding) !== stableJson(previousPayload.evidencePackBinding);
  (bindingChanged ? changedSections : unchangedSections).push("证据绑定");
  return {
    current,
    previous: reportRevisionRef(previous),
    declaredChange: normalizedChange(report.payload.changeFromPrevious),
    changedSections,
    unchangedSections,
    bindingChanged
  };
}

function reportRevisionRef(report: DeepResearchReportData): TodayResearchReportRevisionRef {
  return {
    id: report.id,
    version: report.version,
    evidencePackId: report.evidencePackId,
    reportFingerprint: report.reportFingerprint
  };
}

function isEvidenceBoundPayload(value: DeepResearchReportData["payload"]): value is EvidenceBoundDeepResearchReportPayload {
  return record(value) && value.reportContractVersion === EVIDENCE_BOUND_REPORT_CONTRACT_VERSION
    && record(value.adviceLayer) && record(value.researchLayer) && record(value.evidencePackBinding);
}

function compareSection(label: string, current: unknown, previous: unknown, changed: string[], unchanged: string[]): void {
  (stableJson(current) === stableJson(previous) ? unchanged : changed).push(label);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function normalizedChange(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : "未填写版本变化说明";
}

function compareIds(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isSafeInteger(leftNumber) && Number.isSafeInteger(rightNumber)
    ? leftNumber - rightNumber
    : left.localeCompare(right);
}

function coveredByConfirmedReport(data: WorkspaceData, facts: TodayResearchFactRef[]): boolean {
  const report = currentReport(data);
  if (!facts.length || !report || data.userDecision?.decision !== "confirmed"
    || data.userDecision.reportId !== report.id) return false;
  return facts.every((fact) => data.latestPack?.items.some((item) => item.id === fact.materialId
    && item.revision === fact.revision && item.sourceVersion === fact.sourceVersion && item.contentFingerprint === fact.contentFingerprint));
}
function currentReport(data: WorkspaceData): WorkspaceData["latestReport"] {
  return data.latestPack?.currentness.status === "current"
    && data.latestReport?.evidencePackId === data.latestPack.id
    && data.latestReport.currentness.status === "current"
    && data.latestReport.currentness.invalidatedBy.length === 0
    && data.latestReport.currentness.evidencePackInvalidatedBy.length === 0
    ? data.latestReport
    : null;
}
function factRef(source: WorkspaceData["materials"][number] | WorkspaceData["events"][number]["source"]): TodayResearchFactRef {
  if(source.publishedAt===null)throw new Error("verified Today facts require a known publication time");
  return {
    materialId: "id" in source ? source.id : source.materialId, evidenceId: source.evidenceId,
    sourceType: source.sourceType, sourceVersion: source.sourceVersion, revision: source.revision,
    contentFingerprint: source.contentFingerprint, publishedAt: source.publishedAt, capturedAt: source.capturedAt,
    validUntil: source.validUntil, verificationStatus: "verified", rightsStatus: source.rightsStatus as TodayResearchFactRef["rightsStatus"]
  };
}
function eventIsDirectional(event: WorkspaceData["events"][number]): boolean { return event.hypothesisImpact === "supports" || event.hypothesisImpact === "weakens"; }
function eventIsMaterial(event: WorkspaceData["events"][number], now: Date): boolean {
  return event.importance !== "unknown" && eventIsDirectional(event) && event.source.freshness === "fresh" && event.source.revisionState === "current"
    && event.source.verificationStatus === "verified" && ["user_provided", "authorized_public"].includes(event.source.rightsStatus)
    && Date.parse(event.source.publishedAt) <= now.getTime() && Date.parse(event.source.capturedAt) <= now.getTime();
}
function geelyIsMaterial(value: NonNullable<WorkspaceData["latestGeelySalesMonitor"]>): boolean {
  return value.assessment.trendConclusionAllowed && value.assessment.impacts.thesis.signal !== "unknown";
}
function gclIsMaterial(value: NonNullable<WorkspaceData["latestGclPvPriceMonitor"]>): boolean {
  return (value.assessment.trendConclusionAllowed || value.assessment.spreadConclusionAllowed)
    && Object.values(value.assessment.impacts).some((impact) => impact.signal !== "unknown");
}
function completionTrackingState(state: WorkspaceData["completion"]["state"]): TodayResearchTrackingState {
  return state === "materials_required" ? "needs_material" : state === "pack_required" ? "needs_evidence_pack"
    : state === "research_required" ? "needs_research" : state === "user_confirmation_required" ? "awaiting_user_confirmation" : state;
}
function actionTitle(state: TodayResearchTrackingState): string {
  return state === "needs_material" ? "Add traceable research material" : state === "needs_evidence_pack" ? "Freeze the current evidence version"
    : state === "needs_research" ? "Complete evidence-bound deep research" : "Confirm or reject the deep-research version";
}
function validateItem(value: unknown, envelope: Record<string, unknown>, index: number, errors: string[]): void {
  const label = `items[${index}]`;
  if (!record(value)) { errors.push(`${label} must be an object`); return; }
  exact(value, ["id", "order", "category", "priority", "trackingState", "symbol", "title", "summary", "thesis", "invalidationConditions", "nextCheckpoint", "versionChange", "reportRevision", "bindings"], label, errors);
  bounded(value.id, `${label}.id`, 500, errors); bounded(value.title, `${label}.title`, 500, errors); bounded(value.summary, `${label}.summary`, 4000, errors);
  if (value.order !== index + 1 || value.symbol !== envelope.requestedSymbol) errors.push(`${label} order or symbol is invalid`);
  if (!["user_action", "holding_logic_change", "research_change"].includes(String(value.category))
    || !["action", "high", "medium", "low"].includes(String(value.priority))
    || !["needs_material", "needs_evidence_pack", "needs_research", "awaiting_user_confirmation", "needs_review", "confirmed", "rejected"].includes(String(value.trackingState))) errors.push(`${label} classification is invalid`);
  const actionState = ["needs_material", "needs_evidence_pack", "needs_research", "awaiting_user_confirmation"].includes(String(value.trackingState));
  if ((value.category === "user_action") !== actionState) errors.push(`${label} user-action tracking state is invalid`);
  optionalText(value.thesis, `${label}.thesis`, 10000, errors); strings(value.invalidationConditions, `${label}.invalidationConditions`, 50, errors);
  optionalText(value.nextCheckpoint, `${label}.nextCheckpoint`, 4000, errors); optionalText(value.versionChange, `${label}.versionChange`, 4000, errors);
  validateReportRevision(value.reportRevision, value.bindings, `${label}.reportRevision`, errors);
  validateBindings(value.bindings, envelope, label, errors);
  validateItemIdentity(value, envelope, label, errors);
  if (!todayResearchBindingsMatchQuality(value.bindings, envelope.quality)) errors.push(`${label} research versions do not match the measured quality identity`);
  if (value.category === "holding_logic_change" && (!record(value.bindings)
    || !Array.isArray(value.bindings.holdingSnapshotRefs) || value.bindings.holdingSnapshotRefs.length === 0)) {
    errors.push(`${label} holding-logic change requires an exact holding snapshot`);
  }
}
function validateReportRevision(value: unknown, bindingsValue: unknown, label: string, errors: string[]): void {
  if (value === undefined || value === null) return;
  if (!record(value)) { errors.push(`${label} is invalid`); return; }
  exact(value, ["current", "previous", "declaredChange", "changedSections", "unchangedSections", "bindingChanged"], label, errors);
  validateReportRevisionRef(value.current, `${label}.current`, errors);
  if (value.previous !== null) validateReportRevisionRef(value.previous, `${label}.previous`, errors);
  bounded(value.declaredChange, `${label}.declaredChange`, 4000, errors);
  strings(value.changedSections, `${label}.changedSections`, 50, errors);
  strings(value.unchangedSections, `${label}.unchangedSections`, 50, errors);
  if (value.bindingChanged !== null && typeof value.bindingChanged !== "boolean") errors.push(`${label}.bindingChanged is invalid`);
  if (record(bindingsValue) && record(value.current) && record(bindingsValue.reportRef)
    && (value.current.id !== bindingsValue.reportRef.id || value.current.version !== bindingsValue.reportRef.version
      || value.current.evidencePackId !== bindingsValue.reportRef.evidencePackId)) {
    errors.push(`${label}.current does not match report binding`);
  }
  if (value.previous !== null && record(value.current) && record(value.previous)
    && typeof value.previous.version === "number" && typeof value.current.version === "number"
    && value.previous.version >= value.current.version) errors.push(`${label}.previous must precede current`);
}
function validateReportRevisionRef(value: unknown, label: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${label} is invalid`); return; }
  exact(value, ["id", "version", "evidencePackId", "reportFingerprint"], label, errors);
  if (!positiveId(value.id) || !positiveInteger(value.version) || !positiveId(value.evidencePackId)
    || !(value.reportFingerprint === "UNKNOWN" || fingerprint(value.reportFingerprint))) errors.push(`${label} identity is invalid`);
}
function validateItemIdentity(value: Record<string, unknown>, envelope: Record<string, unknown>, label: string, errors: string[]): void {
  const bindings = record(value.bindings) ? value.bindings : null;
  if (!bindings) return;
  let expectedId: string | null = null;
  let expectedCategory: TodayResearchItem["category"] | null = null;
  if (value.category === "user_action") {
    expectedId = `action:${envelope.membershipId}:v${envelope.membershipVersion}:${value.trackingState}`;
    expectedCategory = "user_action";
  } else if (record(bindings.monitorRef)) {
    expectedId = `${bindings.monitorRef.kind}:${bindings.monitorRef.id}:v${bindings.monitorRef.runVersion}`;
    expectedCategory = bindings.monitorRef.kind === "gcl_pv_price" ? "holding_logic_change" : "research_change";
  } else if (value.trackingState === "confirmed" || value.trackingState === "rejected") {
    if (record(bindings.reportRef)) expectedId = `report:${bindings.reportRef.id}:v${bindings.reportRef.version}`;
    expectedCategory = "research_change";
  } else if (value.trackingState === "needs_review" && Array.isArray(bindings.eventRefs)
    && bindings.eventRefs.length === 1 && record(bindings.eventRefs[0])) {
    const event = bindings.eventRefs[0];
    expectedId = `event:${event.eventId}:v${event.eventVersion}`;
    expectedCategory = event.coverageScope === "current_holding" ? "holding_logic_change" : "research_change";
  }
  if (value.id !== expectedId || value.category !== expectedCategory) errors.push(`${label} identity does not match its exact source binding`);
}
function validateBindings(value: unknown, envelope: Record<string, unknown>, label: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${label}.bindings must be an object`); return; }
  exact(value, ["membershipId", "membershipVersion", "factRefs", "eventRefs", "monitorRef", "evidencePackRef", "reportRef", "decisionRef", "holdingSnapshotRefs"], `${label}.bindings`, errors);
  if (value.membershipId !== envelope.membershipId || value.membershipVersion !== envelope.membershipVersion) errors.push(`${label}.bindings membership version is invalid`);
  validateRefs(value.factRefs, 250, `${label}.bindings.factRefs`, errors, validateFactRef);
  validateRefs(value.eventRefs, 250, `${label}.bindings.eventRefs`, errors, validateEventRef);
  validateRefs(value.holdingSnapshotRefs, 250, `${label}.bindings.holdingSnapshotRefs`, errors, validateHoldingRef);
  if (value.monitorRef !== null && (!record(value.monitorRef) || !only(value.monitorRef, ["kind", "id", "runVersion", "runFingerprint"]) || !["geely_sales", "gcl_pv_price", "weinstein_structure"].includes(String(value.monitorRef.kind))
    || !positiveId(value.monitorRef.id) || !positiveInteger(value.monitorRef.runVersion) || !fingerprint(value.monitorRef.runFingerprint))) errors.push(`${label}.bindings.monitorRef is invalid`);
  if (value.evidencePackRef !== null && !validTodayEvidencePackRef(value.evidencePackRef)) errors.push(`${label}.bindings.evidencePackRef is invalid`);
  if (value.reportRef !== null && !validTodayReportRef(value.reportRef)) errors.push(`${label}.bindings.reportRef is invalid`);
  if (value.decisionRef !== null && (!record(value.decisionRef) || !only(value.decisionRef, ["id", "reportId", "decision", "decidedAt"]) || !positiveId(value.decisionRef.id) || !positiveId(value.decisionRef.reportId) || !["confirmed", "rejected"].includes(String(value.decisionRef.decision)) || !isInstant(value.decisionRef.decidedAt))) errors.push(`${label}.bindings.decisionRef is invalid`);
  if (record(value.evidencePackRef) && record(value.reportRef) && value.evidencePackRef.id !== value.reportRef.evidencePackId) errors.push(`${label}.bindings report does not match evidence pack`);
  if (record(value.reportRef) && record(value.decisionRef) && value.reportRef.id !== value.decisionRef.reportId) errors.push(`${label}.bindings decision does not match report`);
}
function validateFactRef(value: Record<string, unknown>): boolean { return only(value, ["materialId", "evidenceId", "sourceType", "sourceVersion", "revision", "contentFingerprint", "publishedAt", "capturedAt", "validUntil", "verificationStatus", "rightsStatus"]) && positiveId(value.materialId) && positiveId(value.evidenceId) && boundedOk(value.sourceType, 200) && boundedOk(value.sourceVersion, 200) && positiveInteger(value.revision) && fingerprint(value.contentFingerprint) && isInstant(value.publishedAt) && isInstant(value.capturedAt) && isInstant(value.validUntil) && value.verificationStatus === "verified" && ["user_provided", "authorized_public"].includes(String(value.rightsStatus)); }
function validateEventRef(value: Record<string, unknown>): boolean {
  return only(value, ["eventId", "eventVersion", "eventFingerprint", "coverageScope", "keyVariable", "hypothesisImpact", "monitorRuleBinding"])
    && positiveId(value.eventId) && positiveInteger(value.eventVersion) && fingerprint(value.eventFingerprint)
    && ["research_stock", "current_holding"].includes(String(value.coverageScope)) && boundedOk(value.keyVariable, 500)
    && ["supports", "weakens", "unknown"].includes(String(value.hypothesisImpact))
    && (value.monitorRuleBinding === undefined || value.monitorRuleBinding === null
      || value.coverageScope === "research_stock" && researchEventMonitorRuleBindingMatchesCurrent(
        value.monitorRuleBinding,
        [value.monitorRuleBinding as ResearchEventMonitorRuleBinding],
        record(value.monitorRuleBinding) && RESEARCH_EVENT_KINDS.includes(value.monitorRuleBinding.category as ResearchEventKind)
          ? value.monitorRuleBinding.category as ResearchEventKind
          : "news",
        String(value.keyVariable)
      ));
}
function validateHoldingRef(value: Record<string, unknown>): boolean { return only(value, ["accountScopeId", "snapshotId", "sourceBatchId", "sourceAsOf", "positionSourceRowId"]) && boundedOk(value.accountScopeId, 500) && boundedOk(value.snapshotId, 500) && boundedOk(value.sourceBatchId, 500) && isInstant(value.sourceAsOf) && boundedOk(value.positionSourceRowId, 1000) && String(value.positionSourceRowId).startsWith(`broker_import_batches:${value.sourceBatchId}/`); }
function validateRefs(value: unknown, max: number, label: string, errors: string[], validate: (item: Record<string, unknown>) => boolean): void { if (!Array.isArray(value) || value.length > max || value.some((item) => !record(item) || !validate(item))) errors.push(`${label} is invalid`); }
function validateSafety(value: unknown, errors: string[]): void { const keys = ["advisoryOnly", "createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker", "productionWrite"]; if (!record(value)) { errors.push("safety is required"); return; } exact(value, keys, "safety", errors); if (value.advisoryOnly !== true || keys.slice(1).some((key) => value[key] !== false)) errors.push("safety boundary is invalid"); }
function strings(value: unknown, label: string, max: number, errors: string[]): void { if (!Array.isArray(value) || value.length > max || value.some((item) => !boundedOk(item, 4000))) errors.push(`${label} is invalid`); }
function optionalText(value: unknown, label: string, max: number, errors: string[]): void { if (value !== null && !boundedOk(value, max)) errors.push(`${label} is invalid`); }
function unique<T>(items: T[], key: (item: T) => string): T[] { const seen = new Set<string>(); return items.filter((item) => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; }); }
function text(value: string): string { return value.slice(0, 4000); }
function exact(value: Record<string, unknown>, keys: string[], label: string, errors: string[]): void { const allowed = new Set(keys); for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`); }
function only(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)); }
function bounded(value: unknown, label: string, max: number, errors: string[]): void { if (!boundedOk(value, max)) errors.push(`${label} is invalid`); }
function boundedOk(value: unknown, max: number): boolean { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function instant(value: unknown, label: string, errors: string[]): void { if (!isInstant(value)) errors.push(`${label} is invalid`); }
function isInstant(value: unknown): boolean { return typeof value === "string" && isRfc3339DateTime(value) && Number.isFinite(Date.parse(value)); }
function fingerprint(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function positiveId(value: unknown): boolean { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function positiveInteger(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) > 0; }
function hkSymbol(value: unknown): boolean { return typeof value === "string" && /^HK\.\d{5}$/.test(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
