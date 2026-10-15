export const ASSIST_ADVISORY_SCOPE_SCHEMA_VERSION = "2026-07-04.assist-1.local-advisory-scope.v1";

export const ASSIST_ADVISORY_SCOPE_STATUSES = ["available", "not_found", "unauthorized", "unavailable", "malformed"] as const;
export const ASSIST_ADVISORY_SCOPE_FACT_STATUSES = [
  "ready_for_human_review",
  "candidate_not_selected",
  "membership_archived",
  "research_missing",
  "quote_missing",
  "quote_stale",
  "decision_context_limited",
  "human_check_pending",
  "review_required",
  "context_snapshot_unavailable",
  "historical_context_limited",
  "evidence_conflict",
  "evidence_gap",
  "review_complete",
  "empty"
] as const;
export const ASSIST_ADVISORY_SCOPE_FACT_KINDS = [
  "candidate_membership",
  "candidate_decision_intake",
  "quote",
  "research",
  "decision_context",
  "human_check",
  "post_decision_review",
  "pingan_last_imported",
  "client_state"
] as const;
export const ASSIST_ADVISORY_SCOPE_LIMITATION_KINDS = [
  "missing_research",
  "missing_quote",
  "stale_quote",
  "decision_context_unavailable",
  "human_check_pending",
  "review_required",
  "context_snapshot_unavailable",
  "historical_pingan_only",
  "unauthorized",
  "not_found",
  "unavailable",
  "malformed",
  "superseded_request",
  "identity_mismatch",
  "unsafe_provenance"
] as const;
export const ASSIST_ADVISORY_SCOPE_ALLOWED_CONTINUATIONS = [
  "view_candidate",
  "view_decision_context",
  "complete_human_check",
  "inspect_post_decision_review",
  "view_pingan_historical_context",
  "stop_due_to_unavailable_facts"
] as const;
const FORBIDDEN_ORDER_PLACEMENT_CONTINUATION = ["place", "order"].join("_");
export const ASSIST_ADVISORY_SCOPE_FORBIDDEN_CONTINUATIONS = [
  "buy",
  "sell",
  "hold",
  "trade",
  FORBIDDEN_ORDER_PLACEMENT_CONTINUATION,
  "rebalance",
  "allocate",
  "size_position",
  "call_broker",
  "sync_live_portfolio"
] as const;
export const ASSIST_ADVISORY_SCOPE_FORBIDDEN_FIELD_NAMES = [
  "recommendation",
  "ranking",
  "rank",
  "score",
  "rating",
  "signal",
  "action",
  "buy",
  "sell",
  "hold",
  "targetPrice",
  "stopLoss",
  "takeProfit",
  "expectedReturn",
  "timing",
  "sizing",
  "allocation",
  "order",
  "trade",
  "fill",
  "cash",
  "fee",
  "position",
  "broker",
  "portfolioMutation",
  "productionReady"
] as const;

const FAIL_CLOSED_STATUSES = ["not_found", "unauthorized", "unavailable", "malformed"] as const;
const FAIL_CLOSED_LIMITATION_KINDS = [
  "unauthorized",
  "not_found",
  "unavailable",
  "malformed",
  "superseded_request",
  "identity_mismatch",
  "unsafe_provenance"
] as const;

export type AssistAdvisoryScopeStatus = (typeof ASSIST_ADVISORY_SCOPE_STATUSES)[number];
export type AssistAdvisoryScopeFactStatus = (typeof ASSIST_ADVISORY_SCOPE_FACT_STATUSES)[number];
export type AssistAdvisoryScopeFactKind = (typeof ASSIST_ADVISORY_SCOPE_FACT_KINDS)[number];
export type AssistAdvisoryScopeLimitationKind = (typeof ASSIST_ADVISORY_SCOPE_LIMITATION_KINDS)[number];
export type AssistAdvisoryScopeAllowedContinuation = (typeof ASSIST_ADVISORY_SCOPE_ALLOWED_CONTINUATIONS)[number];
export type AssistAdvisoryScopeForbiddenContinuation = (typeof ASSIST_ADVISORY_SCOPE_FORBIDDEN_CONTINUATIONS)[number];

export interface AssistAdvisoryScopeTarget {
  market: "HK";
  code: string;
  symbol: string;
  candidateMembershipId?: string;
}

export interface AssistAdvisoryScopeFact {
  kind: AssistAdvisoryScopeFactKind;
  status: AssistAdvisoryScopeFactStatus;
  label: string;
  message: string;
  source?: "accepted_core1_fact" | "pingan_historical_last_imported" | "client_fail_closed_state";
  observedAt?: string | null;
  staleReason?: string | null;
}

export interface AssistAdvisoryScopeLimitation {
  kind: AssistAdvisoryScopeLimitationKind;
  message: string;
  source?: "contract" | "repository_local_fact" | "client_state";
  observedAt?: string | null;
}

export interface AssistAdvisoryScopeSafety {
  advisoryOnly: true;
  noRecommendation: true;
  noRanking: true;
  noScoring: true;
  noTrading: true;
  noOrders: true;
  noBroker: true;
  noPortfolioMutation: true;
  noCashMutation: true;
  noFeeMutation: true;
  noPositionMutation: true;
  noProductionClaim: true;
  portfolioProvenance: "omitted";
}

export interface AssistAdvisoryScopeProvenance {
  coreFacts: "repository_local_accepted_core1";
  pingan: "historical_last_imported_only" | "omitted";
  portfolio: "omitted";
  externalAccounts: "omitted";
  runtime: "repository_local_only";
}

export interface AssistAdvisoryScopeReview {
  status: "not_started" | "pending_human_check" | "requires_inspection" | "complete";
  message: string;
  latestReviewedAt: string | null;
}

export interface AssistAdvisoryScopeEnvelope {
  schemaVersion: typeof ASSIST_ADVISORY_SCOPE_SCHEMA_VERSION;
  generatedAt: string;
  status: AssistAdvisoryScopeStatus;
  target: AssistAdvisoryScopeTarget;
  facts: AssistAdvisoryScopeFact[];
  limitations: AssistAdvisoryScopeLimitation[];
  allowedContinuations: AssistAdvisoryScopeAllowedContinuation[];
  safety: AssistAdvisoryScopeSafety;
  message: string;
  candidateMembershipId?: string;
  decisionContextId?: string;
  contextHash?: string;
  provenance?: AssistAdvisoryScopeProvenance;
  review?: AssistAdvisoryScopeReview;
  failClosedReason?: AssistAdvisoryScopeLimitationKind;
}

export function validateAssistAdvisoryScopeEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["envelope must be an object"] };

  collectForbiddenFieldNameErrors(value, "envelope", errors);
  rejectUnknownKeys(value, "envelope", [
    "schemaVersion",
    "generatedAt",
    "status",
    "target",
    "facts",
    "limitations",
    "allowedContinuations",
    "safety",
    "message",
    "candidateMembershipId",
    "decisionContextId",
    "contextHash",
    "provenance",
    "review",
    "failClosedReason"
  ], errors);

  if (value.schemaVersion !== ASSIST_ADVISORY_SCOPE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${ASSIST_ADVISORY_SCOPE_SCHEMA_VERSION}`);
  }
  requireIsoTimestamp(value.generatedAt, "generatedAt", errors);
  if (!ASSIST_ADVISORY_SCOPE_STATUSES.includes(value.status as AssistAdvisoryScopeStatus)) {
    errors.push("status must be available, not_found, unauthorized, unavailable, or malformed");
  }
  validateTarget(value.target, errors);
  validateFacts(value.facts, errors);
  validateLimitations(value.limitations, errors);
  validateAllowedContinuations(value.allowedContinuations, errors);
  validateSafety(value.safety, errors);
  if (typeof value.message !== "string" || value.message.trim().length === 0) {
    errors.push("message must be a non-empty string");
  }
  validateOptionalString(value.candidateMembershipId, "candidateMembershipId", errors);
  validateOptionalString(value.decisionContextId, "decisionContextId", errors);
  validateOptionalString(value.contextHash, "contextHash", errors);
  if (value.provenance !== undefined) validateProvenance(value.provenance, errors);
  if (value.review !== undefined) validateReview(value.review, errors);
  if (
    value.failClosedReason !== undefined
    && !ASSIST_ADVISORY_SCOPE_LIMITATION_KINDS.includes(value.failClosedReason as AssistAdvisoryScopeLimitationKind)
  ) {
    errors.push("failClosedReason must be a supported limitation kind");
  }

  const status = value.status as AssistAdvisoryScopeStatus;
  const facts = Array.isArray(value.facts) ? value.facts : [];
  const limitations = Array.isArray(value.limitations) ? value.limitations : [];
  if (isFailClosedStatus(status) && facts.length !== 0) {
    errors.push("fail-closed status must not return partial advisory facts");
  }
  if (isFailClosedStatus(status) && Array.isArray(value.allowedContinuations)) {
    const invalid = value.allowedContinuations.some((item) => item !== "stop_due_to_unavailable_facts");
    if (invalid) errors.push("fail-closed status can only allow stop_due_to_unavailable_facts");
  }
  if (status === "available" && facts.length === 0) {
    errors.push("available status requires at least one legal fact or explicit empty fact");
  }
  if (status === "available" && limitations.some((item) => isRecord(item) && isFailClosedLimitation(item.kind))) {
    errors.push("available status must not carry fail-closed limitations");
  }
  if (status === "available" && value.failClosedReason !== undefined) {
    errors.push("available status must not carry failClosedReason");
  }
  if (status !== "available" && value.failClosedReason !== undefined && !isFailClosedLimitation(value.failClosedReason)) {
    errors.push("failClosedReason must identify a fail-closed limitation for non-available statuses");
  }
  if (value.candidateMembershipId !== undefined && isRecord(value.target) && value.target.candidateMembershipId !== undefined && value.candidateMembershipId !== value.target.candidateMembershipId) {
    errors.push("candidateMembershipId must match target.candidateMembershipId when both are present");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateTarget(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("target must be an object");
    return;
  }
  rejectUnknownKeys(value, "target", ["market", "code", "symbol", "candidateMembershipId"], errors);
  if (value.market !== "HK") errors.push("target.market must be HK");
  if (typeof value.code !== "string" || !/^\d{5}$/.test(value.code)) {
    errors.push("target.code must be a canonical five-digit Hong Kong code");
  }
  if (typeof value.code === "string" && value.symbol !== `HK.${value.code}`) {
    errors.push("target.symbol must match HK.<code>");
  }
  validateOptionalString(value.candidateMembershipId, "target.candidateMembershipId", errors);
}

function validateFacts(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("facts must be an array");
    return;
  }
  for (const fact of value) validateFact(fact, errors);
}

function validateFact(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("facts must contain only objects");
    return;
  }
  rejectUnknownKeys(value, "fact", ["kind", "status", "label", "message", "source", "observedAt", "staleReason"], errors);
  if (!ASSIST_ADVISORY_SCOPE_FACT_KINDS.includes(value.kind as AssistAdvisoryScopeFactKind)) errors.push("fact.kind is invalid");
  if (!ASSIST_ADVISORY_SCOPE_FACT_STATUSES.includes(value.status as AssistAdvisoryScopeFactStatus)) errors.push("fact.status is invalid");
  requireNonEmptyString(value.label, "fact.label", errors);
  requireNonEmptyString(value.message, "fact.message", errors);
  if (
    value.source !== undefined
    && value.source !== "accepted_core1_fact"
    && value.source !== "pingan_historical_last_imported"
    && value.source !== "client_fail_closed_state"
  ) {
    errors.push("fact.source is invalid");
  }
  validateOptionalIso(value.observedAt, "fact.observedAt", errors);
  validateOptionalString(value.staleReason, "fact.staleReason", errors);
  if (value.kind === "pingan_last_imported" && value.source !== "pingan_historical_last_imported") {
    errors.push("pingan_last_imported facts must use historical last-imported source");
  }
}

function validateLimitations(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("limitations must be an array");
    return;
  }
  for (const limitation of value) validateLimitation(limitation, errors);
}

function validateLimitation(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("limitations must contain only objects");
    return;
  }
  rejectUnknownKeys(value, "limitation", ["kind", "message", "source", "observedAt"], errors);
  if (!ASSIST_ADVISORY_SCOPE_LIMITATION_KINDS.includes(value.kind as AssistAdvisoryScopeLimitationKind)) {
    errors.push("limitation.kind is invalid");
  }
  requireNonEmptyString(value.message, "limitation.message", errors);
  if (value.source !== undefined && value.source !== "contract" && value.source !== "repository_local_fact" && value.source !== "client_state") {
    errors.push("limitation.source is invalid");
  }
  validateOptionalIso(value.observedAt, "limitation.observedAt", errors);
}

function validateAllowedContinuations(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("allowedContinuations must be an array");
    return;
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      errors.push("allowedContinuations must contain only strings");
      continue;
    }
    if (ASSIST_ADVISORY_SCOPE_FORBIDDEN_CONTINUATIONS.includes(item as AssistAdvisoryScopeForbiddenContinuation)) {
      errors.push(`allowedContinuations must not include forbidden continuation ${item}`);
    }
    if (!ASSIST_ADVISORY_SCOPE_ALLOWED_CONTINUATIONS.includes(item as AssistAdvisoryScopeAllowedContinuation)) {
      errors.push(`allowedContinuations contains unsupported continuation ${item}`);
    }
    if (seen.has(item)) errors.push(`allowedContinuations contains duplicate continuation ${item}`);
    seen.add(item);
  }
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("safety must be an object");
    return;
  }
  rejectUnknownKeys(value, "safety", [
    "advisoryOnly",
    "noRecommendation",
    "noRanking",
    "noScoring",
    "noTrading",
    "noOrders",
    "noBroker",
    "noPortfolioMutation",
    "noCashMutation",
    "noFeeMutation",
    "noPositionMutation",
    "noProductionClaim",
    "portfolioProvenance"
  ], errors);
  for (const key of [
    "advisoryOnly",
    "noRecommendation",
    "noRanking",
    "noScoring",
    "noTrading",
    "noOrders",
    "noBroker",
    "noPortfolioMutation",
    "noCashMutation",
    "noFeeMutation",
    "noPositionMutation",
    "noProductionClaim"
  ]) {
    if (value[key] !== true) errors.push(`safety.${key} must be true`);
  }
  if (value.portfolioProvenance !== "omitted") errors.push("safety.portfolioProvenance must be omitted");
}

function validateProvenance(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("provenance must be an object");
    return;
  }
  rejectUnknownKeys(value, "provenance", ["coreFacts", "pingan", "portfolio", "externalAccounts", "runtime"], errors);
  if (value.coreFacts !== "repository_local_accepted_core1") errors.push("provenance.coreFacts must be repository_local_accepted_core1");
  if (value.pingan !== "historical_last_imported_only" && value.pingan !== "omitted") {
    errors.push("provenance.pingan must be historical_last_imported_only or omitted");
  }
  if (value.portfolio !== "omitted") errors.push("provenance.portfolio must be omitted");
  if (value.externalAccounts !== "omitted") errors.push("provenance.externalAccounts must be omitted");
  if (value.runtime !== "repository_local_only") errors.push("provenance.runtime must be repository_local_only");
}

function validateReview(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("review must be an object");
    return;
  }
  rejectUnknownKeys(value, "review", ["status", "message", "latestReviewedAt"], errors);
  if (value.status !== "not_started" && value.status !== "pending_human_check" && value.status !== "requires_inspection" && value.status !== "complete") {
    errors.push("review.status is invalid");
  }
  requireNonEmptyString(value.message, "review.message", errors);
  validateOptionalIso(value.latestReviewedAt, "review.latestReviewedAt", errors);
}

function collectForbiddenFieldNameErrors(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenFieldNameErrors(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (isForbiddenFieldName(key)) errors.push(`${path}.${key} is a forbidden advisory/trading field`);
    collectForbiddenFieldNameErrors(value[key], `${path}.${key}`, errors);
  }
}

function isForbiddenFieldName(key: string): boolean {
  const normalized = key.toLowerCase();
  return ASSIST_ADVISORY_SCOPE_FORBIDDEN_FIELD_NAMES.some((forbidden) => forbidden.toLowerCase() === normalized);
}

function isFailClosedStatus(status: AssistAdvisoryScopeStatus): boolean {
  return FAIL_CLOSED_STATUSES.includes(status as (typeof FAIL_CLOSED_STATUSES)[number]);
}

function isFailClosedLimitation(value: unknown): boolean {
  return FAIL_CLOSED_LIMITATION_KINDS.includes(value as (typeof FAIL_CLOSED_LIMITATION_KINDS)[number]);
}

function rejectUnknownKeys(value: Record<string, unknown>, label: string, allowedKeys: string[], errors: string[]): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`);
  }
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${field} must be a non-empty string`);
}

function validateOptionalString(value: unknown, field: string, errors: string[]): void {
  if (value !== undefined && value !== null && typeof value !== "string") errors.push(`${field} must be a string or null`);
}

function requireIsoTimestamp(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) errors.push(`${field} must be a valid date-time`);
}

function validateOptionalIso(value: unknown, field: string, errors: string[]): void {
  if (value === undefined || value === null) return;
  requireIsoTimestamp(value, field, errors);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
