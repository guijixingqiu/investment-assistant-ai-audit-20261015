import type { FactMetadata } from "./factMetadata.js";
import { isRfc3339DateTime, validateFactMetadataInto } from "./factMetadata.js";
import {
  validateResearchReportDecisionBinding,
  type ResearchReportDecisionBinding
} from "./researchReportDecision.js";
import { validateTodayReviewDueResearchReport } from "./todayReviewDueReportValidation.js";
import {
  todayDailyTrackingIdentity,
  todayFormalDecisionDueIdentity,
  todayReviewDueIdentity
} from "./todayReviewDueIdentity.js";
import { DECISION_ACTION_INTENTS, type DecisionActionIntent } from "./research.js";
import { validateFormalDecisionState, type FormalDecisionState } from "./formalDecision.js";
import { validDecisionReviewDueOn } from "./decisionContextBrowser.js";
export { todayDailyTrackingIdentity, todayFormalDecisionDueIdentity, todayReviewDueIdentity };

export const TODAY_REVIEW_DUE_SCHEMA_VERSION = "2026-07-30.s1i-adopted-report-daily-tracking.v1";
export const TODAY_REVIEW_DUE_SOURCE =
  "today_action:confirmed_reports_decision_checks_reviews_audit_events";

export type TodayReviewDueStatus = "available" | "empty" | "unavailable";
export type TodayReviewDueState = "new" | "resolved";

export interface TodayReviewDueHumanDecision {
  actionIntent: DecisionActionIntent;
  humanCheckResult: "ready_to_consider" | "blocked" | "needs_more_evidence";
  userFinalDecision: string | null;
  reviewDueOn?: string;
  formalDecision: FormalDecisionState;
}

export type TodayReviewDueResearchReport =
  | {
    availability: "not_captured";
    binding: null;
    investmentThesis: "UNKNOWN";
    invalidationConditions: [];
    nextValidationQuestion: "UNKNOWN";
    limitation: string;
  }
  | {
    availability: "preserved";
    binding: ResearchReportDecisionBinding;
    investmentThesis: string;
    invalidationConditions: string[];
    nextValidationQuestion: string | "UNKNOWN";
    limitation: string;
  };

export interface TodayReviewDueSafety {
  createsOrder: false;
  createsTrade: false;
  mutatesCash: false;
  writesFee: false;
  mutatesPosition: false;
  callsBroker: false;
}

export interface TodayReviewDueEvent {
  id: string;
  type: "REVIEW_DUE" | "DAILY_TRACKING";
  subject: string;
  sourceEventId: string;
  effectiveAt: string;
  priority: {
    severity: "attention";
    dueAt: string;
  };
  state: TodayReviewDueState;
  stateChangedAt: string;
  stateActor: {
    actorType: "user" | "system";
    actorId: string;
  };
  stateReason:
    | "decision_check_created_without_valid_review"
    | "manual_review_calendar_due"
    | "adopted_report_requires_daily_tracking"
    | `post_decision_review:${"thesis_confirmed" | "thesis_weakened" | "thesis_invalidated" | "insufficient_evidence"}`;
  bindings: {
    decisionCheckId: string;
    reviewId: string | null;
  };
  humanDecision: TodayReviewDueHumanDecision;
  researchReport: TodayReviewDueResearchReport;
}

export interface TodayFormalDecisionDueEvent {
  id: string;
  type: "FORMAL_DECISION_DUE";
  subject: string;
  sourceEventId: string;
  effectiveAt: string;
  priority: { severity: "attention"; dueAt: string };
  state: "new";
  stateChangedAt: string;
  stateActor: { actorType: "user"; actorId: string };
  stateReason: "confirmed_report_not_adopted";
  reportBinding: ResearchReportDecisionBinding;
}

export type TodayActionEvent = TodayReviewDueEvent | TodayFormalDecisionDueEvent;

export interface TodayReviewDueEnvelope {
  schemaVersion: typeof TODAY_REVIEW_DUE_SCHEMA_VERSION;
  status: TodayReviewDueStatus;
  requestedSymbol: string;
  metadata: FactMetadata;
  event: TodayActionEvent | null;
  advisoryOnly: true;
  safety: TodayReviewDueSafety;
  message: string;
}

export function todayReviewDueSafety(): TodayReviewDueSafety {
  return {
    createsOrder: false,
    createsTrade: false,
    mutatesCash: false,
    writesFee: false,
    mutatesPosition: false,
    callsBroker: false
  };
}

export function validateTodayReviewDueEnvelope(
  value: unknown,
  options: { expectedSymbol?: string; now?: Date } = {}
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["envelope must be an object"] };
  rejectUnknownKeys(value, "envelope", [
    "schemaVersion", "status", "requestedSymbol", "metadata", "event",
    "advisoryOnly", "safety", "message"
  ], errors);
  if (value.schemaVersion !== TODAY_REVIEW_DUE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${TODAY_REVIEW_DUE_SCHEMA_VERSION}`);
  }
  if (!["available", "empty", "unavailable"].includes(String(value.status))) {
    errors.push("status must be available, empty, or unavailable");
  }
  if (!isCanonicalHongKongSymbol(value.requestedSymbol)) {
    errors.push("requestedSymbol must be canonical HK.#####");
  }
  if (options.expectedSymbol !== undefined && value.requestedSymbol !== options.expectedSymbol) {
    errors.push("requestedSymbol must match the expected symbol");
  }
  validateFactMetadataInto(value.metadata, "metadata", errors);
  validateSafety(value.safety, errors);
  if (value.advisoryOnly !== true) errors.push("advisoryOnly must be true");
  if (typeof value.message !== "string" || value.message.trim().length === 0) {
    errors.push("message must be non-empty");
  }

  const status = value.status as TodayReviewDueStatus;
  if (status === "available") {
    validateAvailable(value, options.now ?? new Date(), errors);
  } else if (value.event !== null) {
    errors.push(`${status} envelope must not expose an event`);
  }
  validateStatusMetadata(status, value.metadata, value.event, errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateAvailable(
  envelope: Record<string, unknown>,
  now: Date,
  errors: string[]
): void {
  if (!isRecord(envelope.event)) {
    errors.push("available envelope requires an event");
    return;
  }
  const event = envelope.event;
  const formalDecisionDue = event.type === "FORMAL_DECISION_DUE";
  const dailyTracking = event.type === "DAILY_TRACKING";
  rejectUnknownKeys(event, "event", formalDecisionDue ? [
    "id", "type", "subject", "sourceEventId", "effectiveAt", "priority",
    "state", "stateChangedAt", "stateActor", "stateReason", "reportBinding"
  ] : [
    "id", "type", "subject", "sourceEventId", "effectiveAt", "priority",
    "state", "stateChangedAt", "stateActor", "stateReason", "bindings",
    "humanDecision", "researchReport"
  ], errors);
  if (event.type !== "REVIEW_DUE" && !dailyTracking && !formalDecisionDue) {
    errors.push("event.type must be REVIEW_DUE, DAILY_TRACKING, or FORMAL_DECISION_DUE");
  }
  if (event.subject !== envelope.requestedSymbol || !isCanonicalHongKongSymbol(event.subject)) {
    errors.push("event.subject must match requestedSymbol");
  }
  if (!isPositiveIntegerString(event.sourceEventId)) errors.push("event.sourceEventId must be a positive integer");
  validateInstant(event.effectiveAt, "event.effectiveAt", errors);
  validateInstant(event.stateChangedAt, "event.stateChangedAt", errors);
  validatePriority(event.priority, event.effectiveAt, errors);
  validateActor(event.stateActor, errors);
  if (formalDecisionDue) {
    validateFormalDecisionDue(event, errors);
  } else {
    validateBindings(event.bindings, event, errors);
    validateHumanDecision(event.humanDecision, errors);
    if (isRecord(event.humanDecision) && event.humanDecision.reviewDueOn !== undefined) {
      if (dailyTracking || !validDecisionReviewDueOn(event.humanDecision.reviewDueOn)
        || new Date(`${event.humanDecision.reviewDueOn}T00:00:00+08:00`).toISOString() !== event.effectiveAt)
        errors.push("scheduled REVIEW_DUE must bind its Hong Kong calendar date");
    }
    validateTodayReviewDueResearchReport(
      event.researchReport,
      event.subject,
      event.effectiveAt,
      event.stateActor,
      errors
    );
    if (dailyTracking
      && (!isRecord(event.researchReport) || event.researchReport.availability !== "preserved")) {
      errors.push("DAILY_TRACKING requires an exact preserved research-report binding");
    }
    if (!dailyTracking && isRecord(event.researchReport)
      && event.researchReport.availability === "preserved") {
      errors.push("a preserved adopted report must project as DAILY_TRACKING");
    }
  }

  if (event.state !== "new" && event.state !== "resolved") {
    errors.push("event.state must be new or resolved");
  }
  const expectedNewReason = dailyTracking
    ? "adopted_report_requires_daily_tracking"
    : isRecord(event.humanDecision) && event.humanDecision.reviewDueOn !== undefined
      ? "manual_review_calendar_due" : "decision_check_created_without_valid_review";
  if (!formalDecisionDue && event.state === "new" && event.stateReason !== expectedNewReason) {
    errors.push("new event must explain its exact review or daily-tracking action");
  }
  const resolvedReasons = [
    "post_decision_review:thesis_confirmed",
    "post_decision_review:thesis_weakened",
    "post_decision_review:thesis_invalidated",
    "post_decision_review:insufficient_evidence"
  ];
  if (!formalDecisionDue && event.state === "resolved" && !resolvedReasons.includes(String(event.stateReason))) {
    errors.push("resolved event stateReason must bind a review outcome");
  }
  const expectedId = formalDecisionDue
    ? todayFormalDecisionDueIdentity(String(event.subject), String(event.sourceEventId), String(event.effectiveAt))
    : dailyTracking
      ? todayDailyTrackingIdentity(String(event.subject), String(event.sourceEventId), String(event.effectiveAt))
      : todayReviewDueIdentity(String(event.subject), String(event.sourceEventId), String(event.effectiveAt));
  if (event.id !== expectedId) {
    errors.push("event.id must equal type + subject + sourceEventId + effectiveAt");
  }

  const effective = instant(event.effectiveAt);
  const changed = instant(event.stateChangedAt);
  const fetchedAt = isRecord(envelope.metadata) ? instant(envelope.metadata.fetchedAt) : null;
  if (effective === null || changed === null || changed < effective) {
    errors.push("event state chronology is invalid");
  }
  if (fetchedAt === null || changed === null || changed > fetchedAt || fetchedAt > now.getTime()) {
    errors.push("event and fetchedAt chronology is invalid");
  }
  if (isRecord(envelope.metadata) && envelope.metadata.asOf !== event.stateChangedAt) {
    errors.push("metadata.asOf must equal event.stateChangedAt");
  }
}

function validateFormalDecisionDue(event: Record<string, unknown>, errors: string[]): void {
  if (event.state !== "new" || event.stateReason !== "confirmed_report_not_adopted") {
    errors.push("FORMAL_DECISION_DUE must be a new confirmed-report action");
  }
  if (!isRecord(event.stateActor) || event.stateActor.actorType !== "user") {
    errors.push("FORMAL_DECISION_DUE state actor must be user");
  }
  const bindingValidation = validateResearchReportDecisionBinding(event.reportBinding);
  if (!bindingValidation.ok) errors.push(...bindingValidation.errors);
  if (bindingValidation.ok) {
    const binding = bindingValidation.value;
    if (binding.symbol !== event.subject
      || binding.reportDecisionId !== event.sourceEventId
      || binding.decidedAt !== event.effectiveAt
      || binding.decidedAt !== event.stateChangedAt
      || !isRecord(event.stateActor)
      || binding.reportDecisionActorId !== event.stateActor.actorId) {
      errors.push("FORMAL_DECISION_DUE must exactly bind the confirmed report decision");
    }
  }
}

function validateHumanDecision(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("event.humanDecision must be an object");
    return;
  }
  rejectUnknownKeys(value, "event.humanDecision", [
    "actionIntent", "humanCheckResult", "userFinalDecision", "reviewDueOn", "formalDecision"
  ], errors);
  if (value.reviewDueOn !== undefined && !validDecisionReviewDueOn(value.reviewDueOn))
    errors.push("event.humanDecision.reviewDueOn must be a valid calendar date");
  if (!DECISION_ACTION_INTENTS.includes(value.actionIntent as DecisionActionIntent)) {
    errors.push("event.humanDecision.actionIntent is invalid");
  }
  if (!["ready_to_consider", "blocked", "needs_more_evidence"].includes(String(value.humanCheckResult))) {
    errors.push("event.humanDecision.humanCheckResult is invalid");
  }
  if (value.userFinalDecision !== null
    && (typeof value.userFinalDecision !== "string" || value.userFinalDecision.trim().length === 0)) {
    errors.push("event.humanDecision.userFinalDecision must be null or non-empty");
  }
  const formal = validateFormalDecisionState(value.formalDecision, "event.humanDecision.formalDecision");
  if (!formal.ok) errors.push(...formal.errors);
  else if (formal.value.availability === "preserved"
    && formal.value.differsFromSystem !== (formal.value.systemRecommendation.direction !== value.actionIntent)) {
    errors.push("event.humanDecision.formalDecision must match actionIntent");
  }
}

function validatePriority(value: unknown, effectiveAt: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("event.priority must be an object");
    return;
  }
  rejectUnknownKeys(value, "event.priority", ["severity", "dueAt"], errors);
  if (value.severity !== "attention") errors.push("event.priority.severity must be attention");
  validateInstant(value.dueAt, "event.priority.dueAt", errors);
  if (value.dueAt !== effectiveAt) {
    errors.push("dueAt must equal effectiveAt for the projected review occurrence");
  }
}

function validateActor(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("event.stateActor must be an object");
    return;
  }
  rejectUnknownKeys(value, "event.stateActor", ["actorType", "actorId"], errors);
  if (value.actorType !== "user" && value.actorType !== "system") {
    errors.push("event.stateActor.actorType must be user or system");
  }
  if (typeof value.actorId !== "string" || value.actorId.trim().length === 0) {
    errors.push("event.stateActor.actorId must be non-empty");
  }
}

function validateBindings(
  value: unknown,
  event: Record<string, unknown>,
  errors: string[]
): void {
  if (!isRecord(value)) {
    errors.push("event.bindings must be an object");
    return;
  }
  rejectUnknownKeys(value, "event.bindings", ["decisionCheckId", "reviewId"], errors);
  if (!isPositiveIntegerString(value.decisionCheckId)
    || value.decisionCheckId !== event.sourceEventId) {
    errors.push("event.bindings.decisionCheckId must match sourceEventId");
  }
  if (value.reviewId !== null && !isPositiveIntegerString(value.reviewId)) {
    errors.push("event.bindings.reviewId must be null or a positive integer");
  }
  if (event.state === "new" && value.reviewId !== null) {
    errors.push("new event must not bind a review");
  }
  if (event.state === "resolved" && value.reviewId === null) {
    errors.push("resolved event must bind a review");
  }
}

function validateStatusMetadata(
  status: TodayReviewDueStatus,
  value: unknown,
  event: unknown,
  errors: string[]
): void {
  if (!isRecord(value)) return;
  if (status === "available") {
    if (value.source !== TODAY_REVIEW_DUE_SOURCE
      || value.freshness !== "fresh"
      || !["real", "fixture"].includes(String(value.provenance))
      || value.fixture !== (value.provenance === "fixture")
      || value.authority !== (isRecord(event) && event.type === "FORMAL_DECISION_DUE"
        ? "research_evidence" : "decision_context")
      || value.missing !== false
      || value.stale !== false
      || value.conflict !== false) {
      errors.push("available metadata does not bind REVIEW_DUE decision facts");
    }
  } else if (status === "empty") {
    if (value.source !== TODAY_REVIEW_DUE_SOURCE
      || value.freshness !== "missing"
      || !["real", "fixture"].includes(String(value.provenance))
      || value.fixture !== (value.provenance === "fixture")
      || value.authority !== "decision_context"
      || value.missing !== true
      || value.stale !== false
      || value.conflict !== false
      || value.asOf !== null) {
      errors.push("empty metadata must explicitly represent no actor-scoped decision");
    }
  } else if (value.source !== "today_review_due:unavailable"
    || value.freshness !== "unavailable"
    || value.provenance !== "unavailable"
    || value.fixture !== false
    || value.authority !== "unavailable"
    || value.stale !== false
    || value.missing !== false
    || value.conflict !== false
    || value.asOf !== null
    || value.fetchedAt !== null) {
    errors.push("unavailable metadata must be fact-free");
  }
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("safety must be an object");
    return;
  }
  rejectUnknownKeys(value, "safety", [
    "createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker"
  ], errors);
  for (const key of ["createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker"]) {
    if (value[key] !== false) errors.push(`safety.${key} must be false`);
  }
}

function validateInstant(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || !isRfc3339DateTime(value) || !Number.isFinite(Date.parse(value))) {
    errors.push(`${field} must be a valid RFC3339 instant`);
  }
}

function instant(value: unknown): number | null {
  if (typeof value !== "string" || !isRfc3339DateTime(value)) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function isCanonicalHongKongSymbol(value: unknown): value is string {
  return typeof value === "string" && /^HK\.\d{5}$/.test(value);
}

function isPositiveIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d*$/.test(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  field: string,
  allowed: string[],
  errors: string[]
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) errors.push(`${field}.${key} is not allowed`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
