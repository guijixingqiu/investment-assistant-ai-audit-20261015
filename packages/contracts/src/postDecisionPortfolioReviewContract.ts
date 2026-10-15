import type { PortfolioDecisionContextEnvelope } from "./portfolioDecisionContext.js";

export const POST_DECISION_PORTFOLIO_REVIEW_SCHEMA_VERSION = "2026-07-16.post-decision-portfolio-review.v1";
export const POST_DECISION_PORTFOLIO_COMPARISON_VERSION = "post-decision-portfolio-comparison.v1";

export const POST_DECISION_PORTFOLIO_REVIEW_STATES = [
  "current",
  "stale",
  "partial",
  "zero_position", "empty",
  "conflict",
  "unauthorized",
  "unavailable",
  "not_captured"
] as const;

export const POST_DECISION_PORTFOLIO_METRIC_KEYS = [
  "candidateQuantity",
  "candidateExposure",
  "candidateWeight",
  "positionCount",
  "totalExposure",
  "missingQuoteCount",
  "nonCurrentQuoteCount",
  "largestPositionWeight",
  "topThreeWeight",
  "hhi"
] as const;

export type PostDecisionPortfolioReviewFactState = (typeof POST_DECISION_PORTFOLIO_REVIEW_STATES)[number];
export type PostDecisionPortfolioMetricKey = (typeof POST_DECISION_PORTFOLIO_METRIC_KEYS)[number];
export type PostDecisionPortfolioComparisonStatus = "comparable" | "partial" | "unavailable";
export type PostDecisionPortfolioMetricAvailability = "comparable" | "unavailable";

export interface PostDecisionPortfolioIdentityBinding {
  state: PostDecisionPortfolioReviewFactState;
  contextId: string | null;
  portfolioSnapshotId: string | null;
  accountScopeId: string | null;
}

export interface PostDecisionPortfolioReviewBinding {
  schemaVersion: typeof POST_DECISION_PORTFOLIO_REVIEW_SCHEMA_VERSION;
  decisionCheckId: string;
  decisionSnapshotId: string;
  candidateSymbol: string;
  decisionTimePortfolio: PostDecisionPortfolioIdentityBinding;
  reviewTimePortfolio: PostDecisionPortfolioIdentityBinding;
  comparison: {
    calculationVersion: typeof POST_DECISION_PORTFOLIO_COMPARISON_VERSION;
    comparisonId: string;
  };
}

export interface PostDecisionPortfolioFactReference extends PostDecisionPortfolioIdentityBinding {
  portfolioAsOf: string | null;
  assembledAt: string;
}

export interface PostDecisionPortfolioNeutralDeltaMetric {
  availability: PostDecisionPortfolioMetricAvailability;
  decisionTime: number | null;
  reviewTime: number | null;
  delta: number | null;
}

export interface PostDecisionPortfolioComparisonSafety {
  advisoryOnly: true;
  neutralFactsOnly: true;
  infersCausality: false;
  performanceAttribution: false;
  infersDecisionQuality: false;
  recommendsDirection: false;
  recommendsAmount: false;
  recommendsWeight: false;
  recommendsTiming: false;
  promisesReturn: false;
  createsOrder: false;
  createsTrade: false;
  mutatesCash: false;
  writesFee: false;
  mutatesPosition: false;
  callsBroker: false;
  productionWrite: false;
}

export interface PostDecisionPortfolioComparison {
  calculationVersion: typeof POST_DECISION_PORTFOLIO_COMPARISON_VERSION;
  comparisonId: string;
  status: PostDecisionPortfolioComparisonStatus;
  candidateSymbol: string;
  decisionTime: PostDecisionPortfolioFactReference;
  reviewTime: PostDecisionPortfolioFactReference;
  metrics: Record<PostDecisionPortfolioMetricKey, PostDecisionPortfolioNeutralDeltaMetric>;
  cash: {
    status: "unknown";
    decisionTime: null;
    reviewTime: null;
    delta: null;
    reason: "not_provided_by_authoritative_snapshot";
  };
  gaps: string[];
  safety: PostDecisionPortfolioComparisonSafety;
}

export interface PostDecisionPortfolioReviewSafety extends PostDecisionPortfolioComparisonSafety {
  readOnlyPortfolioFacts: true;
  appendOnlyHumanReview: true;
  mutatesOriginalDecision: false;
}

export interface PostDecisionPortfolioReviewSnapshot {
  schemaVersion: typeof POST_DECISION_PORTFOLIO_REVIEW_SCHEMA_VERSION;
  snapshotId: string;
  capturedAt: string;
  decisionCheckId: string;
  decisionSnapshotId: string;
  candidateSymbol: string;
  reviewTimePortfolio: {
    state: Exclude<PostDecisionPortfolioReviewFactState, "not_captured">;
    envelope: PortfolioDecisionContextEnvelope;
    limitation: string;
  };
  comparison: PostDecisionPortfolioComparison;
  safety: PostDecisionPortfolioReviewSafety;
}

export interface PostDecisionPortfolioReviewState {
  availability: "preserved" | "portfolio_review_not_captured";
  snapshot: PostDecisionPortfolioReviewSnapshot | null;
  limitation: string;
}

export function portfolioReviewNotCapturedState(): PostDecisionPortfolioReviewState {
  return {
    availability: "portfolio_review_not_captured",
    snapshot: null,
    limitation: "This historical post-decision portfolio review was not captured and is not reconstructed from current or later portfolio, quote, cash, fee, trade, or market facts."
  };
}

export function postDecisionPortfolioReviewSafety(): PostDecisionPortfolioReviewSafety {
  return {
    ...postDecisionPortfolioComparisonSafety(),
    readOnlyPortfolioFacts: true,
    appendOnlyHumanReview: true,
    mutatesOriginalDecision: false
  };
}

export function postDecisionPortfolioComparisonSafety(): PostDecisionPortfolioComparisonSafety {
  return {
    advisoryOnly: true,
    neutralFactsOnly: true,
    infersCausality: false,
    performanceAttribution: false,
    infersDecisionQuality: false,
    recommendsDirection: false,
    recommendsAmount: false,
    recommendsWeight: false,
    recommendsTiming: false,
    promisesReturn: false,
    createsOrder: false,
    createsTrade: false,
    mutatesCash: false,
    writesFee: false,
    mutatesPosition: false,
    callsBroker: false,
    productionWrite: false
  };
}

export function portfolioReviewStateFromContextStatus(
  status: PortfolioDecisionContextEnvelope["status"]
): Exclude<PostDecisionPortfolioReviewFactState, "not_captured"> {
  return status === "available" ? "current" : status;
}

export function portfolioIdentityBindingFromContext(
  context: PortfolioDecisionContextEnvelope
): PostDecisionPortfolioIdentityBinding {
  return {
    state: portfolioReviewStateFromContextStatus(context.status),
    contextId: context.contextId,
    portfolioSnapshotId: context.portfolioSnapshotId,
    accountScopeId: context.accountScopeId
  };
}

export function validatePostDecisionPortfolioReviewBinding(
  value: unknown
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["portfolioReviewBinding must be an object"] };
  rejectUnknownKeys(value, "portfolioReviewBinding", [
    "schemaVersion", "decisionCheckId", "decisionSnapshotId", "candidateSymbol",
    "decisionTimePortfolio", "reviewTimePortfolio", "comparison"
  ], errors);
  if (value.schemaVersion !== POST_DECISION_PORTFOLIO_REVIEW_SCHEMA_VERSION) {
    errors.push(`portfolioReviewBinding.schemaVersion must be ${POST_DECISION_PORTFOLIO_REVIEW_SCHEMA_VERSION}`);
  }
  requireNonEmptyString(value.decisionCheckId, "portfolioReviewBinding.decisionCheckId", errors);
  validateDecisionSnapshotId(value.decisionSnapshotId, "portfolioReviewBinding.decisionSnapshotId", errors);
  validateCandidateSymbol(value.candidateSymbol, "portfolioReviewBinding.candidateSymbol", errors);
  validateIdentityBinding(value.decisionTimePortfolio, "portfolioReviewBinding.decisionTimePortfolio", true, errors);
  validateIdentityBinding(value.reviewTimePortfolio, "portfolioReviewBinding.reviewTimePortfolio", false, errors);
  validateComparisonBinding(value.comparison, errors);
  if (isRecord(value.decisionTimePortfolio) && isRecord(value.reviewTimePortfolio)
    && value.decisionTimePortfolio.accountScopeId !== value.reviewTimePortfolio.accountScopeId) {
    errors.push("portfolio review decision-time and review-time account scopes must match");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validatePostDecisionPortfolioReviewStateStructure(value: unknown): {
  ok: true;
  value: PostDecisionPortfolioReviewState;
} | {
  ok: false;
  errors: string[];
} {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["portfolioReview must be an object"] };
  rejectUnknownKeys(value, "portfolioReview", ["availability", "snapshot", "limitation"], errors);
  requireNonEmptyString(value.limitation, "portfolioReview.limitation", errors);
  if (value.availability === "portfolio_review_not_captured") {
    if (value.snapshot !== null) errors.push("portfolioReview.snapshot must be null when not captured");
    if (typeof value.limitation !== "string" || !value.limitation.includes("not reconstructed")) {
      errors.push("portfolioReview.limitation must disclose no reconstruction when not captured");
    }
  } else if (value.availability === "preserved") {
    validateReviewSnapshotStructure(value.snapshot, errors);
  } else {
    errors.push("portfolioReview.availability is invalid");
  }
  return errors.length === 0
    ? { ok: true, value: value as unknown as PostDecisionPortfolioReviewState }
    : { ok: false, errors };
}

function validateReviewSnapshotStructure(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("preserved portfolioReview.snapshot must be an object");
    return;
  }
  rejectUnknownKeys(value, "portfolioReview.snapshot", [
    "schemaVersion", "snapshotId", "capturedAt", "decisionCheckId", "decisionSnapshotId",
    "candidateSymbol", "reviewTimePortfolio", "comparison", "safety"
  ], errors);
  if (value.schemaVersion !== POST_DECISION_PORTFOLIO_REVIEW_SCHEMA_VERSION) {
    errors.push(`portfolioReview.snapshot.schemaVersion must be ${POST_DECISION_PORTFOLIO_REVIEW_SCHEMA_VERSION}`);
  }
  validateContentId(value.snapshotId, "post-decision-portfolio-review", "portfolioReview.snapshot.snapshotId", errors);
  requireDateTime(value.capturedAt, "portfolioReview.snapshot.capturedAt", errors);
  requireNonEmptyString(value.decisionCheckId, "portfolioReview.snapshot.decisionCheckId", errors);
  validateDecisionSnapshotId(value.decisionSnapshotId, "portfolioReview.snapshot.decisionSnapshotId", errors);
  validateCandidateSymbol(value.candidateSymbol, "portfolioReview.snapshot.candidateSymbol", errors);
  validateReviewTimePortfolio(value.reviewTimePortfolio, value.comparison, errors);
  validateComparison(value.comparison, value.candidateSymbol, errors);
  validateReviewSafety(value.safety, errors);
}

function validateReviewTimePortfolio(value: unknown, comparison: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("portfolioReview.snapshot.reviewTimePortfolio must be an object");
    return;
  }
  rejectUnknownKeys(value, "portfolioReview.snapshot.reviewTimePortfolio", ["state", "envelope", "limitation"], errors);
  if (!POST_DECISION_PORTFOLIO_REVIEW_STATES.includes(value.state as PostDecisionPortfolioReviewFactState)
    || value.state === "not_captured") {
    errors.push("portfolioReview.snapshot.reviewTimePortfolio.state is invalid");
  }
  requireNonEmptyString(value.limitation, "portfolioReview.snapshot.reviewTimePortfolio.limitation", errors);
  if (!isRecord(value.envelope)) {
    errors.push("portfolioReview.snapshot.reviewTimePortfolio.envelope must be an object");
    return;
  }
  const expectedState = value.envelope.status === "available" ? "current" : value.envelope.status;
  if (value.state !== expectedState) errors.push("portfolio review-time state must match its preserved envelope");
  if (isRecord(comparison) && isRecord(comparison.reviewTime)) {
    const reference = comparison.reviewTime;
    if (reference.state !== value.state
      || reference.contextId !== value.envelope.contextId
      || reference.portfolioSnapshotId !== value.envelope.portfolioSnapshotId
      || reference.accountScopeId !== value.envelope.accountScopeId
      || reference.portfolioAsOf !== value.envelope.portfolioAsOf
      || reference.assembledAt !== value.envelope.assembledAt) {
      errors.push("portfolio review-time comparison reference must match its preserved envelope");
    }
  }
}

function validateComparison(value: unknown, candidateSymbol: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("portfolioReview.snapshot.comparison must be an object");
    return;
  }
  rejectUnknownKeys(value, "portfolioReview.snapshot.comparison", [
    "calculationVersion", "comparisonId", "status", "candidateSymbol", "decisionTime",
    "reviewTime", "metrics", "cash", "gaps", "safety"
  ], errors);
  if (value.calculationVersion !== POST_DECISION_PORTFOLIO_COMPARISON_VERSION) errors.push("portfolio comparison calculationVersion is invalid");
  validateContentId(value.comparisonId, "post-decision-portfolio-comparison", "portfolio comparison comparisonId", errors);
  if (!["comparable", "partial", "unavailable"].includes(String(value.status))) errors.push("portfolio comparison status is invalid");
  validateCandidateSymbol(value.candidateSymbol, "portfolio comparison candidateSymbol", errors);
  if (value.candidateSymbol !== candidateSymbol) errors.push("portfolio comparison candidateSymbol must match review snapshot candidateSymbol");
  validateFactReference(value.decisionTime, "portfolio comparison decisionTime", errors);
  validateFactReference(value.reviewTime, "portfolio comparison reviewTime", errors);
  const comparableCount = validateMetrics(value.metrics, errors);
  const expectedStatus = comparableCount === POST_DECISION_PORTFOLIO_METRIC_KEYS.length
    ? "comparable"
    : comparableCount > 0 ? "partial" : "unavailable";
  if (value.status !== expectedStatus) errors.push("portfolio comparison status must match metric availability");
  validateCash(value.cash, errors);
  if (!Array.isArray(value.gaps) || !value.gaps.every(isNonEmptyString)) errors.push("portfolio comparison gaps must be non-empty strings");
  validateComparisonSafety(value.safety, errors);
}

function validateMetrics(value: unknown, errors: string[]): number {
  if (!isRecord(value)) {
    errors.push("portfolio comparison metrics must be an object");
    return 0;
  }
  rejectUnknownKeys(value, "portfolio comparison metrics", [...POST_DECISION_PORTFOLIO_METRIC_KEYS], errors);
  let comparableCount = 0;
  for (const key of POST_DECISION_PORTFOLIO_METRIC_KEYS) {
    const metric = value[key];
    if (!isRecord(metric)) {
      errors.push(`portfolio comparison metrics.${key} must be an object`);
      continue;
    }
    rejectUnknownKeys(metric, `portfolio comparison metrics.${key}`, ["availability", "decisionTime", "reviewTime", "delta"], errors);
    if (metric.availability === "comparable") {
      comparableCount += 1;
      if (![metric.decisionTime, metric.reviewTime, metric.delta].every(isFiniteNumber)) {
        errors.push(`portfolio comparison metrics.${key} comparable values must be finite numbers`);
      }
    } else if (metric.availability === "unavailable") {
      if (metric.decisionTime !== null || metric.reviewTime !== null || metric.delta !== null) {
        errors.push(`portfolio comparison metrics.${key} unavailable values must be null`);
      }
    } else {
      errors.push(`portfolio comparison metrics.${key}.availability is invalid`);
    }
  }
  return comparableCount;
}

function validateFactReference(value: unknown, field: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  rejectUnknownKeys(value, field, ["state", "contextId", "portfolioSnapshotId", "accountScopeId", "portfolioAsOf", "assembledAt"], errors);
  validateIdentityBinding(value, field, false, errors, true);
  validateNullableDateTime(value.portfolioAsOf, `${field}.portfolioAsOf`, errors);
  requireDateTime(value.assembledAt, `${field}.assembledAt`, errors);
}

function validateIdentityBinding(
  value: unknown,
  field: string,
  decisionTime: boolean,
  errors: string[],
  factReference = false
): void {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  rejectUnknownKeys(value, field, [
    "state", "contextId", "portfolioSnapshotId", "accountScopeId",
    ...(factReference ? ["portfolioAsOf", "assembledAt"] : [])
  ], errors);
  if (!POST_DECISION_PORTFOLIO_REVIEW_STATES.includes(value.state as PostDecisionPortfolioReviewFactState)
    || value.state === "not_captured") {
    errors.push(`${field}.state is invalid`);
    return;
  }
  for (const key of ["contextId", "portfolioSnapshotId", "accountScopeId"] as const) {
    validateNullableString(value[key], `${field}.${key}`, errors);
  }
  requireNonEmptyString(value.accountScopeId, `${field}.accountScopeId`, errors);
  if (["current", "stale", "partial", "zero_position"].includes(String(value.state))) {
    requireNonEmptyString(value.contextId, `${field}.contextId`, errors);
    requireNonEmptyString(value.portfolioSnapshotId, `${field}.portfolioSnapshotId`, errors);
  } else if (value.contextId !== null || value.portfolioSnapshotId !== null) {
    errors.push(`${field} fail-closed state must not expose context or portfolio snapshot identities`);
  }
  if (decisionTime && !["current", "stale", "partial", "zero_position"].includes(String(value.state))) {
    errors.push(`${field} must reference preserved decision-time position facts`);
  }
}

function validateComparisonBinding(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("portfolioReviewBinding.comparison must be an object");
    return;
  }
  rejectUnknownKeys(value, "portfolioReviewBinding.comparison", ["calculationVersion", "comparisonId"], errors);
  if (value.calculationVersion !== POST_DECISION_PORTFOLIO_COMPARISON_VERSION) errors.push("portfolioReviewBinding.comparison.calculationVersion is invalid");
  validateContentId(value.comparisonId, "post-decision-portfolio-comparison", "portfolioReviewBinding.comparison.comparisonId", errors);
}

function validateCash(value: unknown, errors: string[]): void {
  if (!isRecord(value)
    || value.status !== "unknown"
    || value.decisionTime !== null
    || value.reviewTime !== null
    || value.delta !== null
    || value.reason !== "not_provided_by_authoritative_snapshot") {
    errors.push("portfolio comparison cash must remain explicit unknown");
  }
}

function validateReviewSafety(value: unknown, errors: string[]): void {
  validateSafetyFields(value, true, errors);
  if (!isRecord(value)) return;
  if (value.readOnlyPortfolioFacts !== true || value.appendOnlyHumanReview !== true || value.mutatesOriginalDecision !== false) {
    errors.push("portfolio review safety must preserve read-only facts, append-only review, and immutable original decision");
  }
}

function validateComparisonSafety(value: unknown, errors: string[]): void {
  validateSafetyFields(value, false, errors);
}

function validateSafetyFields(value: unknown, reviewSafety: boolean, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("portfolio comparison safety must be an object");
    return;
  }
  rejectUnknownKeys(value, "portfolio comparison safety", [
    "advisoryOnly", "neutralFactsOnly", "infersCausality", "performanceAttribution",
    "infersDecisionQuality", "recommendsDirection", "recommendsAmount", "recommendsWeight",
    "recommendsTiming", "promisesReturn", "createsOrder", "createsTrade", "mutatesCash",
    "writesFee", "mutatesPosition", "callsBroker", "productionWrite",
    ...(reviewSafety ? ["readOnlyPortfolioFacts", "appendOnlyHumanReview", "mutatesOriginalDecision"] : [])
  ], errors);
  if (value.advisoryOnly !== true || value.neutralFactsOnly !== true) errors.push("portfolio comparison must remain advisory neutral facts only");
  for (const field of [
    "infersCausality", "performanceAttribution", "infersDecisionQuality", "recommendsDirection",
    "recommendsAmount", "recommendsWeight", "recommendsTiming", "promisesReturn", "createsOrder",
    "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker", "productionWrite"
  ]) {
    if (value[field] !== false) errors.push(`portfolio comparison safety.${field} must be false`);
  }
}

function validateDecisionSnapshotId(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || !/^decision-snapshot:[a-f0-9]{64}$/.test(value)) errors.push(`${field} is invalid`);
}

function validateContentId(value: unknown, prefix: string, field: string, errors: string[]): void {
  const expression = new RegExp(`^${prefix}:[a-f0-9]{64}$`);
  if (typeof value !== "string" || !expression.test(value)) errors.push(`${field} is invalid`);
}

function validateCandidateSymbol(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || !/^HK\.[0-9]{5}$/.test(value)) errors.push(`${field} is invalid`);
}

function validateNullableString(value: unknown, field: string, errors: string[]): void {
  if (value !== null && !isNonEmptyString(value)) errors.push(`${field} must be a non-empty string or null`);
}

function validateNullableDateTime(value: unknown, field: string, errors: string[]): void {
  if (value !== null) requireDateTime(value, field, errors);
}

function requireDateTime(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    errors.push(`${field} must be an ISO UTC date-time`);
  }
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (!isNonEmptyString(value)) errors.push(`${field} must be a non-empty string`);
}

function rejectUnknownKeys(value: Record<string, unknown>, label: string, allowedKeys: string[], errors: string[]): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
