import { isRfc3339DateTime, validateFactMetadataInto, type FactMetadata } from "./factMetadata.js";
import type { TodayActionEvent } from "./todayReviewDue.js";
import {
  validateTodayActionInboxResearchTarget,
  type TodayActionInboxResearchTaskRef
} from "./todayActionInboxTask.js";
import { validateProfileReviewDueShape } from "./todayActionInboxProfileReviewValidation.js";

export * from "./todayMaterialChangeDisposition.js";

export const TODAY_ACTION_INBOX_SCHEMA_VERSION = "2026-08-08.today-action-inbox.v4";
export const TODAY_ACTION_INBOX_SOURCE = "today_action_inbox";

export type TodayActionInboxStatus = "available" | "empty" | "unavailable" | "unauthorized";
export type TodayActionInboxItemKind = "research" | "research_completed" | "candidate_found" | "research_profile_review_due" | "material_change" | "market_anomaly" | "formal_decision_due" | "review_due" | "daily_tracking" | "source_failure";
export type TodayActionInboxItemState = "new" | "later" | "resolved" | "expired" | "blocked";
export type TodayActionInboxPriority = "action" | "high" | "medium" | "low";
export type TodayActionInboxSourceLane = "research" | "review_due" | "candidate_membership" | "research_material" | "market_quote";
export type TodayActionInboxSourceFreshness = "fresh" | "stale" | "missing" | "unavailable";
export interface TodayActionInboxMembershipRef {
  id: string;
  version: number;
  symbol: string;
}

export interface TodayActionInboxSourceRef {
  lane: TodayActionInboxSourceLane;
  id: string;
  version: number | null;
  status: string;
  sourceType: string;
  effectiveAt: string | null;
  asOf: string | null;
  fetchedAt: string;
  validUntil: string | null;
  freshness: TodayActionInboxSourceFreshness;
  sourceFingerprint: string | null;
}

export interface TodayActionInboxResearchTarget {
  itemId: string;
  preferredLayer: "evidence" | "portfolio";
  report: { id: string; version: number; evidencePackId: string } | null;
  task: TodayActionInboxResearchTaskRef | null;
}

export interface TodayActionInboxItem {
  id: string;
  order: number;
  kind: TodayActionInboxItemKind;
  priority: TodayActionInboxPriority;
  state: TodayActionInboxItemState;
  symbol: string;
  membership: TodayActionInboxMembershipRef;
  source: TodayActionInboxSourceRef;
  title: string;
  summary: string;
  versionChange?: string | null;
  researchTarget: TodayActionInboxResearchTarget | null;
  reviewEvent: TodayActionEvent | null;
}

export interface TodayActionInboxEnvelope {
  schemaVersion: typeof TODAY_ACTION_INBOX_SCHEMA_VERSION;
  generatedAt: string;
  status: TodayActionInboxStatus;
  requestedActorId: string;
  metadata: FactMetadata;
  trackedMembershipCount: number;
  omittedMembershipCount: number;
  items: TodayActionInboxItem[];
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

export function todayActionInboxSafety(): TodayActionInboxEnvelope["safety"] {
  return {
    advisoryOnly: true,
    createsOrder: false,
    createsTrade: false,
    mutatesCash: false,
    writesFee: false,
    mutatesPosition: false,
    callsBroker: false,
    productionWrite: false
  };
}

export function validateTodayActionInboxEnvelope(value: unknown, now = new Date()): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["Today action inbox envelope must be an object"] };
  exact(value, [
    "schemaVersion", "generatedAt", "status", "requestedActorId", "metadata",
    "trackedMembershipCount", "omittedMembershipCount", "items", "omittedItemCount", "message", "safety"
  ], "envelope", errors);
  if (value.schemaVersion !== TODAY_ACTION_INBOX_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  if (!instant(value.generatedAt) || Date.parse(value.generatedAt) > now.getTime()) errors.push("generatedAt is invalid");
  if (!["available", "empty", "unavailable", "unauthorized"].includes(String(value.status))) errors.push("status is invalid");
  bounded(value.requestedActorId, "requestedActorId", 200, errors);
  validateFactMetadataInto(value.metadata, "metadata", errors);
  if (record(value.metadata)) {
    const status = String(value.status);
    const expectedFreshness = status === "available" ? "fresh" : status === "empty" ? "missing" : "unavailable";
    if (value.metadata.freshness !== expectedFreshness) errors.push("metadata freshness does not match status");
    if (status === "available" || status === "empty") {
      if (value.metadata.source !== TODAY_ACTION_INBOX_SOURCE
        || !["real", "fixture"].includes(String(value.metadata.provenance))
        || value.metadata.authority !== "research_evidence"
        || (value.metadata.provenance === "fixture") !== (value.metadata.fixture === true)) {
        errors.push("available or empty metadata authority is invalid");
      }
    }
    validateInboxMetadataStateFlags(value.metadata, status, errors);
  }
  boundedInteger(value.trackedMembershipCount, "trackedMembershipCount", 0, 100, errors);
  boundedInteger(value.omittedMembershipCount, "omittedMembershipCount", 0, 100, errors);
  boundedInteger(value.omittedItemCount, "omittedItemCount", 0, 500, errors);
  bounded(value.message, "message", 4000, errors);
  if (record(value.metadata)) {
    for (const key of ["asOf", "fetchedAt"]) {
      const timestamp = value.metadata[key];
      if (typeof timestamp === "string" && Date.parse(timestamp) > now.getTime()) {
        errors.push(`metadata.${key} must not be in the future`);
      }
    }
  }
  if (!Array.isArray(value.items) || value.items.length > 100) errors.push("items must contain at most 100 rows");
  const items = Array.isArray(value.items) ? value.items : [];
  if (value.status === "available" && items.length === 0) errors.push("available inbox requires at least one item");
  if (value.status !== "available" && items.length > 0) errors.push("fail-closed or empty inbox must not expose items");
  const ids = new Set<string>();
  const membershipIds = new Set<string>();
  items.forEach((item, index) => {
    validateItem(item, index, now, errors);
    if (record(item) && typeof item.id === "string") {
      if (!ids.add(item.id)) errors.push(`items[${index}].id is duplicated`);
    }
    if (record(item) && record(item.membership) && typeof item.membership.id === "string") membershipIds.add(item.membership.id);
  });
  if (Number(value.trackedMembershipCount) < membershipIds.size) errors.push("trackedMembershipCount is smaller than exposed membership count");
  validateSafety(value.safety, errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

function validateInboxMetadataStateFlags(metadata: Record<string, unknown>, status: string, errors: string[]): void {
  if (status === "available" || status === "empty") {
    if (metadata.stale || metadata.conflict
      || (status === "available" && metadata.missing !== false)
      || (status === "empty" && metadata.missing !== true)) {
      errors.push("available or empty metadata state flags are invalid");
    }
    return;
  }
  if (metadata.provenance !== "unavailable" || metadata.authority !== "unavailable") {
    errors.push("fail-closed metadata must be unavailable");
  }
  if (metadata.stale || metadata.missing || metadata.conflict || metadata.fixture) {
    errors.push("fail-closed metadata state flags are invalid");
  }
}

function validateItem(value: unknown, index: number, now: Date, errors: string[]): void {
  if (!record(value)) { errors.push(`items[${index}] must be an object`); return; }
  const kind = String(value.kind);
  const keys = ["id", "order", "kind", "priority", "state", "symbol", "membership", "source", "title", "summary", "versionChange", "researchTarget", "reviewEvent"];
  if (value.versionChange === undefined) keys.splice(keys.indexOf("versionChange"), 1);
  exact(value, keys, `items[${index}]`, errors);
  if (value.order !== index + 1) errors.push(`items[${index}].order is not sequential`);
  bounded(value.id, `items[${index}].id`, 500, errors);
  if (!["research", "research_completed", "candidate_found", "research_profile_review_due", "material_change", "market_anomaly", "formal_decision_due", "review_due", "daily_tracking", "source_failure"].includes(String(value.kind))) errors.push(`items[${index}].kind is invalid`);
  if (!["action", "high", "medium", "low"].includes(String(value.priority))) errors.push(`items[${index}].priority is invalid`);
  if (!["new", "later", "resolved", "expired", "blocked"].includes(String(value.state))) errors.push(`items[${index}].state is invalid`);
  if (!hkSymbol(value.symbol)) errors.push(`items[${index}].symbol is invalid`);
  bounded(value.title, `items[${index}].title`, 500, errors);
  bounded(value.summary, `items[${index}].summary`, 4000, errors);
  if (value.versionChange !== undefined && value.versionChange !== null) bounded(value.versionChange, `items[${index}].versionChange`, 4000, errors);
  validateMembership(value.membership, value.symbol, index, errors);
  validateSource(value.source, index, kind, now, errors);
  validateActionExpiry(value, index, now, errors);
  validateItemShape(value, index, kind, now, errors);
  validateItemIdentity(value, index, kind, errors);
}

function validateItemShape(value: Record<string, unknown>, index: number, kind: string, now: Date, errors: string[]): void {
  if (kind === "research") return validateResearchItemShape(value, index, errors);
  if (kind === "research_completed") return validateCompletedResearchShape(value, index, errors);
  if (kind === "material_change") return validateMaterialChangeShape(value, index, errors);
  if (kind === "market_anomaly") return validateMarketAnomalyShape(value, index, errors);
  if (kind === "candidate_found") return validateCandidateFoundShape(value, index, errors);
  if (kind === "research_profile_review_due") return validateProfileReviewDueShape(value, index, errors);
  if (kind === "source_failure") return validateSourceFailureShape(value, index, errors);
  validateReviewItemShape(value, index, kind, now, errors);
}

function validateResearchItemShape(value: Record<string, unknown>, index: number, errors: string[]): void {
  if (record(value.source) && value.source.lane !== "research") errors.push(`items[${index}] research source lane is invalid`);
  if (!record(value.researchTarget) || value.reviewEvent !== null) {
    errors.push(`items[${index}] research target shape is invalid`);
    return;
  }
  validateTodayActionInboxResearchTarget(value.researchTarget, index, errors);
  if (record(value.source) && value.source.id !== value.researchTarget.itemId) errors.push(`items[${index}] research source does not bind research target`);
  if (record(value.membership) && typeof value.membership.id === "string" && typeof value.researchTarget.itemId === "string" && value.id !== `inbox:event:research:${value.membership.id}:${value.researchTarget.itemId}`) errors.push(`items[${index}] research event id does not bind the source`);
  const task = value.researchTarget.task;
  if (record(task) && record(value.source)) {
    const ready = task.completedAt !== null && value.state === "new" && value.priority === "action" && value.source.freshness === "fresh";
    const active = task.completedAt === null && value.priority === "high"
      && (value.state === "later" && value.source.freshness === "fresh" || value.state === "new" && value.source.freshness === "stale");
    if (value.researchTarget.report !== null || !ready && !active || value.source.sourceType !== "deep_research_tasks"
      || value.source.sourceFingerprint !== task.requestFingerprint) errors.push(`items[${index}] research task state is invalid`);
  }
}

function validateCompletedResearchShape(value: Record<string, unknown>, index: number, errors: string[]): void {
  if (record(value.source) && value.source.lane !== "research") errors.push(`items[${index}] research source lane is invalid`);
  if (!record(value.researchTarget) || value.reviewEvent !== null) {
    errors.push(`items[${index}] research target shape is invalid`);
    return;
  }
  validateTodayActionInboxResearchTarget(value.researchTarget, index, errors);
  if (!["new", "later", "resolved"].includes(String(value.state))) errors.push(`items[${index}] completed research state is invalid`);
  if (!record(value.researchTarget.report) || !record(value.source)
    || value.source.id !== value.researchTarget.report.id || value.source.version !== value.researchTarget.report.version) {
    errors.push(`items[${index}] completed research source does not bind report`);
  }
  if (["new", "later"].includes(String(value.state)) && (!record(value.researchTarget.task) || value.researchTarget.task.completedAt === null)) errors.push(`items[${index}] actionable completed research must bind a completed task`);
}

function validateMaterialChangeShape(value: Record<string, unknown>, index: number, errors: string[]): void {
  if (record(value.source) && value.source.lane !== "research_material") errors.push(`items[${index}] material source lane is invalid`);
  if (!record(value.researchTarget) || value.reviewEvent !== null) errors.push(`items[${index}] research target shape is invalid`);
  else validateTodayActionInboxResearchTarget(value.researchTarget, index, errors);
  if (!["new", "later", "resolved", "expired"].includes(String(value.state))) errors.push(`items[${index}] material change state is invalid`);
}

function validateMarketAnomalyShape(value: Record<string, unknown>, index: number, errors: string[]): void {
  const source = record(value.source) ? value.source : null;
  const membership = record(value.membership) ? value.membership : null;
  if (!source || !membership || value.researchTarget !== null || value.reviewEvent !== null
    || value.state !== "new" || source.lane !== "market_quote" || source.sourceType !== "personal_market_anomaly"
    || source.id !== value.id || source.version !== membership.version || source.sourceFingerprint === null
    || !["fresh", "stale"].includes(String(source.freshness))
    || !new RegExp(`^inbox:event:market_anomaly:${membership.id}:[0-9]{4}-[0-9]{2}-[0-9]{2}:(down|up):(five_to_eight|eight_plus)$`).test(String(value.id))) {
    errors.push(`items[${index}] market anomaly identity or source is invalid`);
  }
}

function validateActionExpiry(value: Record<string, unknown>, index: number, now: Date, errors: string[]): void {
  if (!record(value.source)) return;
  const validUntil = value.source.validUntil;
  const expired = typeof validUntil === "string" && Date.parse(validUntil) <= now.getTime();
  if (value.state === "expired" && (!expired || value.source.freshness !== "stale")) {
    errors.push(`items[${index}] expired action must bind a stale expired source`);
  }
  if (["new", "later"].includes(String(value.state)) && expired) {
    errors.push(`items[${index}] actionable state cannot bind an expired source`);
  }
}

function validateCandidateFoundShape(value: Record<string, unknown>, index: number, errors: string[]): void {
  if (record(value.source) && value.source.lane !== "candidate_membership") errors.push(`items[${index}] candidate source lane is invalid`);
  if (value.researchTarget !== null || value.reviewEvent !== null || !["new", "later"].includes(String(value.state))
    || !record(value.membership) || !record(value.source)
    || value.source.id !== value.membership.id || value.source.version !== value.membership.version) {
    errors.push(`items[${index}] candidate item shape is invalid`);
  }
}

function validateSourceFailureShape(value: Record<string, unknown>, index: number, errors: string[]): void {
  if (value.researchTarget !== null || value.reviewEvent !== null || value.state !== "blocked") errors.push(`items[${index}] source failure must be blocked and have no navigation target`);
  if (record(value.source) && value.source.status === "available") errors.push(`items[${index}] source failure cannot have available status`);
}

function validateReviewItemShape(value: Record<string, unknown>, index: number, kind: string, now: Date, errors: string[]): void {
  if (record(value.source) && value.source.lane !== "review_due") errors.push(`items[${index}] review source lane is invalid`);
  if (value.researchTarget !== null || !record(value.reviewEvent)) errors.push(`items[${index}] review action shape is invalid`);
  else validateReviewEvent(value.reviewEvent, value.symbol, kind, now, index, errors);
}

function validateItemIdentity(value: Record<string, unknown>, index: number, kind: string, errors: string[]): void {
  const expectedPrefix = kind === "source_failure" ? "inbox:failure:" : "inbox:event:";
  if (typeof value.id === "string" && !value.id.startsWith(expectedPrefix)) errors.push(`items[${index}].id is not deterministic`);
  if (kind === "candidate_found" && record(value.membership) && value.id !== `inbox:event:candidate_found:${value.membership.id}:v${value.membership.version}`) errors.push(`items[${index}].id does not bind candidate membership`);
  if (kind === "research_profile_review_due" && record(value.membership) && record(value.source) && typeof value.source.effectiveAt === "string" && value.id !== `inbox:event:research_profile_review_due:${value.membership.id}:v${value.membership.version}:${value.source.effectiveAt.slice(0, 10)}`) errors.push(`items[${index}].id does not bind research profile review date`);
  if (kind === "research_completed" && record(value.membership) && record(value.researchTarget)) {
    const task = record(value.researchTarget.task) ? value.researchTarget.task : null;
    const expected = task
      ? `inbox:event:research_completed:${value.membership.id}:task:${task.id}`
      : `inbox:event:research_completed:${value.membership.id}:${value.researchTarget.itemId}`;
    if (value.id !== expected) errors.push(`items[${index}].id does not bind completed research identity`);
  }
  if (kind === "material_change" && record(value.membership) && record(value.source) && value.id !== `inbox:event:material_change:${value.membership.id}:${value.source.id}:v${value.source.version ?? "unknown"}`) errors.push(`items[${index}].id does not bind material change source`);
}

function validateMembership(value: unknown, symbol: unknown, index: number, errors: string[]): void {
  if (!record(value)) { errors.push(`items[${index}].membership must be an object`); return; }
  exact(value, ["id", "version", "symbol"], `items[${index}].membership`, errors);
  bounded(value.id, `items[${index}].membership.id`, 50, errors);
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 1) errors.push(`items[${index}].membership.version is invalid`);
  if (value.symbol !== symbol || !hkSymbol(value.symbol)) errors.push(`items[${index}].membership.symbol does not bind item`);
}

function validateSource(value: unknown, index: number, kind: string, now: Date, errors: string[]): void {
  if (!record(value)) { errors.push(`items[${index}].source must be an object`); return; }
  exact(value, ["lane", "id", "version", "status", "sourceType", "effectiveAt", "asOf", "fetchedAt", "validUntil", "freshness", "sourceFingerprint"], `items[${index}].source`, errors);
  if (!["research", "review_due", "candidate_membership", "research_material", "market_quote"].includes(String(value.lane))) errors.push(`items[${index}].source.lane is invalid`);
  bounded(value.id, `items[${index}].source.id`, 500, errors);
  if (value.version !== null && (!Number.isSafeInteger(value.version) || Number(value.version) < 1)) errors.push(`items[${index}].source.version is invalid`);
  bounded(value.status, `items[${index}].source.status`, 100, errors);
  bounded(value.sourceType, `items[${index}].source.sourceType`, 200, errors);
  if (!instant(value.fetchedAt) || Date.parse(String(value.fetchedAt)) > now.getTime()) errors.push(`items[${index}].source.fetchedAt is invalid`);
  validateSourceChronology(value, index, now, errors);
  if (!["fresh", "stale", "missing", "unavailable"].includes(String(value.freshness))) errors.push(`items[${index}].source.freshness is invalid`);
  if (value.sourceFingerprint !== null && (typeof value.sourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint))) errors.push(`items[${index}].source.sourceFingerprint is invalid`);
  if (kind !== "source_failure" && value.status !== "available") errors.push(`items[${index}].source.status must be available`);
  validateSourceProvenance(value, index, kind, errors);
}

function validateSourceChronology(value: Record<string, unknown>, index: number, now: Date, errors: string[]): void {
  for (const key of ["effectiveAt", "asOf"]) {
    if (value[key] !== null && (!instant(value[key]) || Date.parse(String(value[key])) > now.getTime())) errors.push(`items[${index}].source.${key} is invalid`);
  }
  if (value.validUntil !== null && !instant(value.validUntil)) errors.push(`items[${index}].source.validUntil is invalid`);
  if (value.effectiveAt !== null && value.asOf !== null && Date.parse(String(value.effectiveAt)) > Date.parse(String(value.asOf))) errors.push(`items[${index}].source chronology is invalid`);
  if (value.asOf !== null && Date.parse(String(value.asOf)) > Date.parse(String(value.fetchedAt))) errors.push(`items[${index}].source.asOf is after fetchedAt`);
  if (value.validUntil !== null && value.effectiveAt !== null && Date.parse(String(value.validUntil)) <= Date.parse(String(value.effectiveAt))) errors.push(`items[${index}].source.validUntil is invalid`);
}

function validateSourceProvenance(value: Record<string, unknown>, index: number, kind: string, errors: string[]): void {
  if (kind === "candidate_found" && (value.lane !== "candidate_membership" || value.sourceType !== "candidate_memberships" || value.effectiveAt === null || value.asOf === null || value.freshness !== "fresh")) errors.push(`items[${index}] candidate source provenance is invalid`);
  if (kind === "research_profile_review_due" && (value.lane !== "candidate_membership" || value.sourceType !== "research_profiles" || value.effectiveAt === null || value.asOf === null || value.freshness !== "fresh")) errors.push(`items[${index}] research profile review source provenance is invalid`);
  if (kind === "material_change" && (value.lane !== "research_material" || value.sourceFingerprint === null || !["fresh", "stale"].includes(String(value.freshness)))) errors.push(`items[${index}] material source provenance is invalid`);
  if (kind === "research_completed" && (value.sourceType !== "deep_research_reports" || value.freshness !== "fresh")) errors.push(`items[${index}] completed research source provenance is invalid`);
  if (["formal_decision_due", "review_due", "daily_tracking"].includes(kind) && value.lane === "review_due" && value.sourceType !== "today_review_due_projection") errors.push(`items[${index}] review source provenance is invalid`);
  if (kind === "source_failure" && value.lane === "market_quote"
    && (value.sourceType !== "persisted_market_quotes" || value.status !== "unavailable" || value.freshness !== "unavailable")) {
    errors.push(`items[${index}] market quote failure provenance is invalid`);
  }
}

function validateReviewEvent(value: Record<string, unknown>, symbol: unknown, kind: string, now: Date, index: number, errors: string[]): void {
  const type = String(value.type);
  const allowed = type === "FORMAL_DECISION_DUE"
    ? ["id", "type", "subject", "sourceEventId", "effectiveAt", "priority", "state", "stateChangedAt", "stateActor", "stateReason", "reportBinding"]
    : ["id", "type", "subject", "sourceEventId", "effectiveAt", "priority", "state", "stateChangedAt", "stateActor", "stateReason", "bindings", "humanDecision", "researchReport"];
  exact(value, allowed, `items[${index}].reviewEvent`, errors);
  if (value.subject !== symbol || !hkSymbol(value.subject)) errors.push(`items[${index}].reviewEvent.subject does not bind item`);
  bounded(value.sourceEventId, `items[${index}].reviewEvent.sourceEventId`, 100, errors);
  if (!/^\d+$/.test(String(value.sourceEventId)) || Number(value.sourceEventId) < 1) errors.push(`items[${index}].reviewEvent.sourceEventId is invalid`);
  if (!instant(value.effectiveAt) || !instant(value.stateChangedAt) || Date.parse(String(value.stateChangedAt)) < Date.parse(String(value.effectiveAt)) || Date.parse(String(value.stateChangedAt)) > now.getTime()) errors.push(`items[${index}].reviewEvent chronology is invalid`);
  const stateActor = record(value.stateActor) ? value.stateActor : null;
  if (!stateActor || !["user", "system"].includes(String(stateActor.actorType)) || typeof stateActor.actorId !== "string") errors.push(`items[${index}].reviewEvent stateActor is invalid`);
  const expectedId = type === "FORMAL_DECISION_DUE"
    ? `FORMAL_DECISION_DUE|${value.subject}|${value.sourceEventId}|${value.effectiveAt}`
    : `${type}|${value.subject}|${value.sourceEventId}|${value.effectiveAt}`;
  if (value.id !== expectedId) errors.push(`items[${index}].reviewEvent.id is invalid`);
  const expectedType = kind === "formal_decision_due" ? "FORMAL_DECISION_DUE" : kind === "daily_tracking" ? "DAILY_TRACKING" : "REVIEW_DUE";
  if (type !== expectedType) errors.push(`items[${index}].reviewEvent type does not match item kind`);
  if (type === "FORMAL_DECISION_DUE") {
    if (value.state !== "new" || value.stateReason !== "confirmed_report_not_adopted" || value.bindings !== undefined || value.humanDecision !== undefined || value.researchReport !== undefined || !record(value.reportBinding)) errors.push(`items[${index}] FORMAL_DECISION_DUE shape is invalid`);
  } else if (!["REVIEW_DUE", "DAILY_TRACKING"].includes(type) || !record(value.bindings) || !record(value.humanDecision) || !record(value.researchReport)) {
    errors.push(`items[${index}] review event shape is invalid`);
  }
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("safety must be an object"); return; }
  exact(value, ["advisoryOnly", "createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker", "productionWrite"], "safety", errors);
  for (const key of ["advisoryOnly", "createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker", "productionWrite"]) {
    if (value[key] !== (key === "advisoryOnly" ? true : false)) errors.push(`safety.${key} violates the no-side-effects boundary`);
  }
}

function exact(value: Record<string, unknown>, expected: string[], label: string, errors: string[]): void {
  const actual = Object.keys(value).sort();
  const target = [...expected].sort();
  if (actual.length !== target.length || actual.some((key, index) => key !== target[index])) errors.push(`${label} has unexpected or missing keys`);
}

function bounded(value: unknown, label: string, max: number, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) errors.push(`${label} must be a bounded non-empty string`);
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number, errors: string[]): void {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) errors.push(`${label} is outside its bound`);
}

function instant(value: unknown): value is string {
  return typeof value === "string" && isRfc3339DateTime(value) && Number.isFinite(Date.parse(value));
}

function hkSymbol(value: unknown): value is string {
  return typeof value === "string" && /^HK\.\d{5}$/.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
