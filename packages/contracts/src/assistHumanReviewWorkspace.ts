export const ASSIST_HUMAN_REVIEW_WORKSPACE_SCHEMA_VERSION = "2026-07-05.assist-1.local-human-review-workspace.v1";

export const ASSIST_HUMAN_REVIEW_WORKSPACE_STATUSES = ["available", "not_found", "unauthorized", "unavailable", "malformed"] as const;
export const ASSIST_HUMAN_REVIEW_WORKSPACE_READINESS_IDS = [
  "ready_for_manual_review",
  "review_limited",
  "blocked_missing_facts",
  "blocked_stale_facts",
  "blocked_human_check_pending",
  "blocked_review_required",
  "blocked_unauthorized",
  "blocked_not_found",
  "blocked_unavailable",
  "blocked_malformed",
  "empty_local_scope"
] as const;
export const ASSIST_HUMAN_REVIEW_WORKSPACE_EVIDENCE_GROUP_IDS = [
  "candidate_identity",
  "quote_evidence",
  "research_evidence",
  "decision_context",
  "human_check",
  "post_decision_review",
  "pingan_historical_context",
  "portfolio_omitted_boundary",
  "client_fail_closed_state",
  "safety_boundary"
] as const;
export const ASSIST_HUMAN_REVIEW_WORKSPACE_EVIDENCE_STATUSES = [
  "available_for_manual_review",
  "review_limited",
  "missing",
  "stale",
  "historical_context",
  "omitted_boundary",
  "fail_closed",
  "safety_boundary",
  "empty"
] as const;
export const ASSIST_HUMAN_REVIEW_WORKSPACE_LIMITATION_SEVERITIES = [
  "blocking",
  "review_limited",
  "context_only",
  "safety_boundary"
] as const;
export const ASSIST_HUMAN_REVIEW_WORKSPACE_CONTINUATION_IDS = [
  "view_candidate_facts",
  "view_decision_context_facts",
  "complete_manual_human_check",
  "inspect_post_decision_review",
  "view_pingan_historical_context",
  "record_local_review_note",
  "mark_for_later_manual_review",
  "stop_due_to_unavailable_facts"
] as const;
export const ASSIST_HUMAN_REVIEW_WORKSPACE_FORBIDDEN_CONTINUATIONS = [
  "buy",
  "sell",
  "hold",
  "trade",
  "rebalance",
  "allocate",
  "size_position",
  "call_broker",
  "sync_live_portfolio"
] as const;
export const ASSIST_HUMAN_REVIEW_WORKSPACE_FORBIDDEN_FIELD_NAMES = [
  "recommendation",
  "rank",
  "ranking",
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
  "rebalance",
  "order",
  "trade",
  "fill",
  "cash",
  "fee",
  "position",
  "broker",
  "portfolioMutation",
  "productionReady",
  "liveHoldings",
  "brokerTruth",
  "accountAuthority"
] as const;

const FAIL_CLOSED_STATUSES = ["not_found", "unauthorized", "unavailable", "malformed"] as const;

export type AssistHumanReviewWorkspaceStatus = (typeof ASSIST_HUMAN_REVIEW_WORKSPACE_STATUSES)[number];
export type AssistHumanReviewWorkspaceReadinessId = (typeof ASSIST_HUMAN_REVIEW_WORKSPACE_READINESS_IDS)[number];
export type AssistHumanReviewWorkspaceEvidenceGroupId = (typeof ASSIST_HUMAN_REVIEW_WORKSPACE_EVIDENCE_GROUP_IDS)[number];
export type AssistHumanReviewWorkspaceEvidenceStatus = (typeof ASSIST_HUMAN_REVIEW_WORKSPACE_EVIDENCE_STATUSES)[number];
export type AssistHumanReviewWorkspaceLimitationSeverity = (typeof ASSIST_HUMAN_REVIEW_WORKSPACE_LIMITATION_SEVERITIES)[number];
export type AssistHumanReviewWorkspaceContinuationId = (typeof ASSIST_HUMAN_REVIEW_WORKSPACE_CONTINUATION_IDS)[number];

export interface AssistHumanReviewWorkspaceTarget {
  market: "HK";
  code: string;
  symbol: string;
  candidateMembershipId?: string;
}

export interface AssistHumanReviewWorkspaceReadiness {
  id: AssistHumanReviewWorkspaceReadinessId;
  label: string;
  explanation: string;
  allowedInterpretation: string;
  forbiddenInterpretation: string;
  blocking: boolean;
  manualReviewOnly: true;
  tradeReady: false;
  recommendation: false;
}

export interface AssistHumanReviewWorkspaceEvidenceGroup {
  id: AssistHumanReviewWorkspaceEvidenceGroupId;
  title: string;
  status: AssistHumanReviewWorkspaceEvidenceStatus;
  severity: AssistHumanReviewWorkspaceLimitationSeverity;
  summary: string;
  facts: string[];
  limitations: string[];
  source: "accepted_core1_fact" | "pingan_historical_last_imported" | "portfolio_omitted" | "client_fail_closed_state" | "safety_boundary";
  observedAt: string | null;
  staleReason: string | null;
  allowedInterpretation: string;
  forbiddenInterpretation: string;
}

export interface AssistHumanReviewWorkspaceLimitation {
  kind: string;
  severity: AssistHumanReviewWorkspaceLimitationSeverity;
  label: string;
  explanation: string;
  userImpact: string;
  allowedInterpretation: string;
  forbiddenInterpretation: string;
}

export interface AssistHumanReviewWorkspaceContinuation {
  id: AssistHumanReviewWorkspaceContinuationId;
  label: string;
  description: string;
  category: "view" | "manual_review" | "local_intent" | "stop";
  enabled: boolean;
  disabledReason: string | null;
  sideEffectLevel: "none" | "local_display_intent";
  allowedInterpretation: string;
  forbiddenInterpretation: string;
}

export interface AssistHumanReviewWorkspaceFollowUp {
  currentReviewState: string;
  manualNoteIntent: string;
  laterReviewIntent: string;
  unresolvedEvidenceGaps: string[];
  suggestedLocalNextViews: string[];
  blockedExternalActions: string[];
  productionNoGoReason: string;
}

export interface AssistHumanReviewWorkspaceBoundaries {
  noRecommendation: true;
  noRanking: true;
  noScoring: true;
  noBuySellHold: true;
  noTiming: true;
  noTargetPrice: true;
  noStopLoss: true;
  noTakeProfit: true;
  noExpectedReturn: true;
  noSizing: true;
  noAllocation: true;
  noOrder: true;
  noTrade: true;
  noFill: true;
  noCashMutation: true;
  noFeeMutation: true;
  noPositionMutation: true;
  noBroker: true;
  noPortfolioMutation: true;
  noProductionClaim: true;
  pinganHistoricalOnly: true;
  portfolioOmitted: true;
  externalRuntimeNotUsed: true;
}

export interface AssistHumanReviewWorkspaceFailClosed {
  active: boolean;
  reason: string | null;
  noStaleFacts: true;
  noPartialFacts: true;
  notInvestmentJudgment: true;
}

export interface AssistHumanReviewWorkspaceSafety extends AssistHumanReviewWorkspaceBoundaries {
  advisoryOnly: true;
  manualReviewOnly: true;
}

export interface AssistHumanReviewWorkspaceProvenance {
  coreFacts: "repository_local_accepted_core1";
  sourceEnvelope: "assist_advisory_scope_v1";
  pingan: "historical_last_imported_only" | "omitted";
  portfolio: "omitted";
  externalAccounts: "omitted";
  runtime: "repository_local_only";
}

export interface AssistHumanReviewWorkspaceReview {
  state: "not_started" | "pending_human_check" | "requires_inspection" | "complete";
  message: string;
  latestReviewedAt: string | null;
}

export interface AssistHumanReviewWorkspaceSourceEnvelopeRef {
  schemaVersion: string;
  route: "/api/mobile/research/candidate-memberships/:id/advisory-scope";
  status: string;
  candidateMembershipId: string | null;
}

export interface AssistHumanReviewWorkspaceEnvelope {
  schemaVersion: typeof ASSIST_HUMAN_REVIEW_WORKSPACE_SCHEMA_VERSION;
  generatedAt: string;
  status: AssistHumanReviewWorkspaceStatus;
  target: AssistHumanReviewWorkspaceTarget;
  readiness: AssistHumanReviewWorkspaceReadiness;
  evidenceGroups: AssistHumanReviewWorkspaceEvidenceGroup[];
  limitations: AssistHumanReviewWorkspaceLimitation[];
  continuations: AssistHumanReviewWorkspaceContinuation[];
  followUp: AssistHumanReviewWorkspaceFollowUp;
  boundaries: AssistHumanReviewWorkspaceBoundaries;
  failClosed: AssistHumanReviewWorkspaceFailClosed;
  safety: AssistHumanReviewWorkspaceSafety;
  provenance: AssistHumanReviewWorkspaceProvenance;
  review: AssistHumanReviewWorkspaceReview;
  sourceEnvelopeRef: AssistHumanReviewWorkspaceSourceEnvelopeRef;
  message: string;
}

export function validateAssistHumanReviewWorkspaceEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["workspace envelope must be an object"] };

  collectForbiddenFieldNameErrors(value, "workspace", errors);
  rejectUnknownKeys(value, "workspace", [
    "schemaVersion",
    "generatedAt",
    "status",
    "target",
    "readiness",
    "evidenceGroups",
    "limitations",
    "continuations",
    "followUp",
    "boundaries",
    "failClosed",
    "safety",
    "provenance",
    "review",
    "sourceEnvelopeRef",
    "message"
  ], errors);

  if (value.schemaVersion !== ASSIST_HUMAN_REVIEW_WORKSPACE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${ASSIST_HUMAN_REVIEW_WORKSPACE_SCHEMA_VERSION}`);
  }
  requireIsoTimestamp(value.generatedAt, "generatedAt", errors);
  if (!ASSIST_HUMAN_REVIEW_WORKSPACE_STATUSES.includes(value.status as AssistHumanReviewWorkspaceStatus)) {
    errors.push("status is invalid");
  }
  validateTarget(value.target, errors);
  validateReadiness(value.readiness, errors);
  validateEvidenceGroups(value.evidenceGroups, errors);
  validateLimitations(value.limitations, errors);
  validateContinuations(value.continuations, errors);
  validateFollowUp(value.followUp, errors);
  validateBoundaries(value.boundaries, "boundaries", errors);
  validateFailClosed(value.failClosed, errors);
  validateSafety(value.safety, errors);
  validateProvenance(value.provenance, errors);
  validateReview(value.review, errors);
  validateSourceEnvelopeRef(value.sourceEnvelopeRef, errors);
  requireNonEmptyString(value.message, "message", errors);

  const status = value.status as AssistHumanReviewWorkspaceStatus;
  const evidenceGroups = Array.isArray(value.evidenceGroups) ? value.evidenceGroups : [];
  const continuations = Array.isArray(value.continuations) ? value.continuations : [];
  if (isFailClosedStatus(status)) {
    if (evidenceGroups.length !== 0) errors.push("fail-closed workspace must not expose usable evidence groups");
    const invalidContinuation = continuations.some((item) => isRecord(item) && item.id !== "stop_due_to_unavailable_facts");
    if (invalidContinuation) errors.push("fail-closed workspace can only expose stop_due_to_unavailable_facts");
    if (isRecord(value.failClosed) && value.failClosed.active !== true) errors.push("fail-closed workspace must mark failClosed.active true");
    if (isRecord(value.readiness) && value.readiness.blocking !== true) errors.push("fail-closed readiness must be blocking");
  }
  if (status === "available" && isRecord(value.failClosed) && value.failClosed.active !== false) {
    errors.push("available workspace must mark failClosed.active false");
  }
  if (isRecord(value.readiness) && (value.readiness.tradeReady !== false || value.readiness.recommendation !== false)) {
    errors.push("readiness must never be trade-ready or recommendation");
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
  if (typeof value.code !== "string" || !/^\d{5}$/.test(value.code)) errors.push("target.code must be a canonical Hong Kong code");
  if (typeof value.code === "string" && value.symbol !== `HK.${value.code}`) errors.push("target.symbol must match HK.<code>");
  validateOptionalString(value.candidateMembershipId, "target.candidateMembershipId", errors);
}

function validateReadiness(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("readiness must be an object");
    return;
  }
  rejectUnknownKeys(value, "readiness", [
    "id",
    "label",
    "explanation",
    "allowedInterpretation",
    "forbiddenInterpretation",
    "blocking",
    "manualReviewOnly",
    "tradeReady",
    "recommendation"
  ], errors);
  if (!ASSIST_HUMAN_REVIEW_WORKSPACE_READINESS_IDS.includes(value.id as AssistHumanReviewWorkspaceReadinessId)) errors.push("readiness.id is invalid");
  for (const field of ["label", "explanation", "allowedInterpretation", "forbiddenInterpretation"]) requireNonEmptyString(value[field], `readiness.${field}`, errors);
  if (typeof value.blocking !== "boolean") errors.push("readiness.blocking must be boolean");
  if (value.manualReviewOnly !== true) errors.push("readiness.manualReviewOnly must be true");
  if (value.tradeReady !== false) errors.push("readiness.tradeReady must be false");
  if (value.recommendation !== false) errors.push("readiness.recommendation must be false");
}

function validateEvidenceGroups(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("evidenceGroups must be an array");
    return;
  }
  const seen = new Set<string>();
  for (const group of value) {
    if (!isRecord(group)) {
      errors.push("evidenceGroups must contain objects");
      continue;
    }
    rejectUnknownKeys(group, "evidenceGroup", [
      "id",
      "title",
      "status",
      "severity",
      "summary",
      "facts",
      "limitations",
      "source",
      "observedAt",
      "staleReason",
      "allowedInterpretation",
      "forbiddenInterpretation"
    ], errors);
    if (!ASSIST_HUMAN_REVIEW_WORKSPACE_EVIDENCE_GROUP_IDS.includes(group.id as AssistHumanReviewWorkspaceEvidenceGroupId)) errors.push("evidenceGroup.id is invalid");
    if (typeof group.id === "string") {
      if (seen.has(group.id)) errors.push(`evidenceGroups contains duplicate ${group.id}`);
      seen.add(group.id);
    }
    if (!ASSIST_HUMAN_REVIEW_WORKSPACE_EVIDENCE_STATUSES.includes(group.status as AssistHumanReviewWorkspaceEvidenceStatus)) errors.push("evidenceGroup.status is invalid");
    validateSeverity(group.severity, "evidenceGroup.severity", errors);
    for (const field of ["title", "summary", "source", "allowedInterpretation", "forbiddenInterpretation"]) requireNonEmptyString(group[field], `evidenceGroup.${field}`, errors);
    validateStringArray(group.facts, "evidenceGroup.facts", errors);
    validateStringArray(group.limitations, "evidenceGroup.limitations", errors);
    validateOptionalIso(group.observedAt, "evidenceGroup.observedAt", errors);
    validateOptionalString(group.staleReason, "evidenceGroup.staleReason", errors);
  }
}

function validateLimitations(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("limitations must be an array");
    return;
  }
  for (const item of value) {
    if (!isRecord(item)) {
      errors.push("limitations must contain objects");
      continue;
    }
    rejectUnknownKeys(item, "limitation", ["kind", "severity", "label", "explanation", "userImpact", "allowedInterpretation", "forbiddenInterpretation"], errors);
    for (const field of ["kind", "label", "explanation", "userImpact", "allowedInterpretation", "forbiddenInterpretation"]) requireNonEmptyString(item[field], `limitation.${field}`, errors);
    validateSeverity(item.severity, "limitation.severity", errors);
  }
}

function validateContinuations(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("continuations must be an array");
    return;
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) {
      errors.push("continuations must contain objects");
      continue;
    }
    rejectUnknownKeys(item, "continuation", [
      "id",
      "label",
      "description",
      "category",
      "enabled",
      "disabledReason",
      "sideEffectLevel",
      "allowedInterpretation",
      "forbiddenInterpretation"
    ], errors);
    if (typeof item.id !== "string") errors.push("continuation.id must be a string");
    if (typeof item.id === "string") {
      if (ASSIST_HUMAN_REVIEW_WORKSPACE_FORBIDDEN_CONTINUATIONS.includes(item.id as (typeof ASSIST_HUMAN_REVIEW_WORKSPACE_FORBIDDEN_CONTINUATIONS)[number])) {
        errors.push(`continuation ${item.id} is forbidden`);
      }
      if (!ASSIST_HUMAN_REVIEW_WORKSPACE_CONTINUATION_IDS.includes(item.id as AssistHumanReviewWorkspaceContinuationId)) errors.push("continuation.id is invalid");
      if (seen.has(item.id)) errors.push(`continuations contains duplicate ${item.id}`);
      seen.add(item.id);
    }
    for (const field of ["label", "description", "allowedInterpretation", "forbiddenInterpretation"]) requireNonEmptyString(item[field], `continuation.${field}`, errors);
    if (item.category !== "view" && item.category !== "manual_review" && item.category !== "local_intent" && item.category !== "stop") errors.push("continuation.category is invalid");
    if (typeof item.enabled !== "boolean") errors.push("continuation.enabled must be boolean");
    validateOptionalString(item.disabledReason, "continuation.disabledReason", errors);
    if (item.sideEffectLevel !== "none" && item.sideEffectLevel !== "local_display_intent") errors.push("continuation.sideEffectLevel is invalid");
  }
}

function validateFollowUp(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("followUp must be an object");
    return;
  }
  rejectUnknownKeys(value, "followUp", [
    "currentReviewState",
    "manualNoteIntent",
    "laterReviewIntent",
    "unresolvedEvidenceGaps",
    "suggestedLocalNextViews",
    "blockedExternalActions",
    "productionNoGoReason"
  ], errors);
  for (const field of ["currentReviewState", "manualNoteIntent", "laterReviewIntent", "productionNoGoReason"]) requireNonEmptyString(value[field], `followUp.${field}`, errors);
  validateStringArray(value.unresolvedEvidenceGaps, "followUp.unresolvedEvidenceGaps", errors);
  validateStringArray(value.suggestedLocalNextViews, "followUp.suggestedLocalNextViews", errors);
  validateStringArray(value.blockedExternalActions, "followUp.blockedExternalActions", errors);
}

function validateBoundaries(value: unknown, label: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  const keys = [
    "noRecommendation",
    "noRanking",
    "noScoring",
    "noBuySellHold",
    "noTiming",
    "noTargetPrice",
    "noStopLoss",
    "noTakeProfit",
    "noExpectedReturn",
    "noSizing",
    "noAllocation",
    "noOrder",
    "noTrade",
    "noFill",
    "noCashMutation",
    "noFeeMutation",
    "noPositionMutation",
    "noBroker",
    "noPortfolioMutation",
    "noProductionClaim",
    "pinganHistoricalOnly",
    "portfolioOmitted",
    "externalRuntimeNotUsed"
  ];
  rejectUnknownKeys(value, label, keys, errors);
  for (const key of keys) if (value[key] !== true) errors.push(`${label}.${key} must be true`);
}

function validateFailClosed(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("failClosed must be an object");
    return;
  }
  rejectUnknownKeys(value, "failClosed", ["active", "reason", "noStaleFacts", "noPartialFacts", "notInvestmentJudgment"], errors);
  if (typeof value.active !== "boolean") errors.push("failClosed.active must be boolean");
  validateOptionalString(value.reason, "failClosed.reason", errors);
  for (const key of ["noStaleFacts", "noPartialFacts", "notInvestmentJudgment"]) if (value[key] !== true) errors.push(`failClosed.${key} must be true`);
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("safety must be an object");
    return;
  }
  rejectUnknownKeys(value, "safety", [
    "noRecommendation",
    "noRanking",
    "noScoring",
    "noBuySellHold",
    "noTiming",
    "noTargetPrice",
    "noStopLoss",
    "noTakeProfit",
    "noExpectedReturn",
    "noSizing",
    "noAllocation",
    "noOrder",
    "noTrade",
    "noFill",
    "noCashMutation",
    "noFeeMutation",
    "noPositionMutation",
    "noBroker",
    "noPortfolioMutation",
    "noProductionClaim",
    "pinganHistoricalOnly",
    "portfolioOmitted",
    "externalRuntimeNotUsed",
    "advisoryOnly",
    "manualReviewOnly"
  ], errors);
  for (const key of [
    "noRecommendation",
    "noRanking",
    "noScoring",
    "noBuySellHold",
    "noTiming",
    "noTargetPrice",
    "noStopLoss",
    "noTakeProfit",
    "noExpectedReturn",
    "noSizing",
    "noAllocation",
    "noOrder",
    "noTrade",
    "noFill",
    "noCashMutation",
    "noFeeMutation",
    "noPositionMutation",
    "noBroker",
    "noPortfolioMutation",
    "noProductionClaim",
    "pinganHistoricalOnly",
    "portfolioOmitted",
    "externalRuntimeNotUsed"
  ]) {
    if (value[key] !== true) errors.push(`safety.${key} must be true`);
  }
  if (value.advisoryOnly !== true) errors.push("safety.advisoryOnly must be true");
  if (value.manualReviewOnly !== true) errors.push("safety.manualReviewOnly must be true");
}

function validateProvenance(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("provenance must be an object");
    return;
  }
  rejectUnknownKeys(value, "provenance", ["coreFacts", "sourceEnvelope", "pingan", "portfolio", "externalAccounts", "runtime"], errors);
  if (value.coreFacts !== "repository_local_accepted_core1") errors.push("provenance.coreFacts is invalid");
  if (value.sourceEnvelope !== "assist_advisory_scope_v1") errors.push("provenance.sourceEnvelope is invalid");
  if (value.pingan !== "historical_last_imported_only" && value.pingan !== "omitted") errors.push("provenance.pingan is invalid");
  if (value.portfolio !== "omitted") errors.push("provenance.portfolio must be omitted");
  if (value.externalAccounts !== "omitted") errors.push("provenance.externalAccounts must be omitted");
  if (value.runtime !== "repository_local_only") errors.push("provenance.runtime must be repository_local_only");
}

function validateReview(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("review must be an object");
    return;
  }
  rejectUnknownKeys(value, "review", ["state", "message", "latestReviewedAt"], errors);
  if (value.state !== "not_started" && value.state !== "pending_human_check" && value.state !== "requires_inspection" && value.state !== "complete") errors.push("review.state is invalid");
  requireNonEmptyString(value.message, "review.message", errors);
  validateOptionalIso(value.latestReviewedAt, "review.latestReviewedAt", errors);
}

function validateSourceEnvelopeRef(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("sourceEnvelopeRef must be an object");
    return;
  }
  rejectUnknownKeys(value, "sourceEnvelopeRef", ["schemaVersion", "route", "status", "candidateMembershipId"], errors);
  requireNonEmptyString(value.schemaVersion, "sourceEnvelopeRef.schemaVersion", errors);
  if (value.route !== "/api/mobile/research/candidate-memberships/:id/advisory-scope") errors.push("sourceEnvelopeRef.route is invalid");
  requireNonEmptyString(value.status, "sourceEnvelopeRef.status", errors);
  validateOptionalString(value.candidateMembershipId, "sourceEnvelopeRef.candidateMembershipId", errors);
}

function validateSeverity(value: unknown, label: string, errors: string[]): void {
  if (!ASSIST_HUMAN_REVIEW_WORKSPACE_LIMITATION_SEVERITIES.includes(value as AssistHumanReviewWorkspaceLimitationSeverity)) errors.push(`${label} is invalid`);
}

function collectForbiddenFieldNameErrors(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenFieldNameErrors(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    const nextPath = `${path}.${key}`;
    if (isForbiddenFieldName(key) && !isAllowedSafetyField(nextPath, value[key])) errors.push(`${nextPath} is a forbidden recommendation/trading field`);
    collectForbiddenFieldNameErrors(value[key], `${path}.${key}`, errors);
  }
}

function isForbiddenFieldName(key: string): boolean {
  const normalized = key.toLowerCase();
  return ASSIST_HUMAN_REVIEW_WORKSPACE_FORBIDDEN_FIELD_NAMES.some((forbidden) => forbidden.toLowerCase() === normalized);
}

function isAllowedSafetyField(path: string, value: unknown): boolean {
  return path === "workspace.readiness.recommendation" && value === false;
}

function isFailClosedStatus(status: AssistHumanReviewWorkspaceStatus): boolean {
  return FAIL_CLOSED_STATUSES.includes(status as (typeof FAIL_CLOSED_STATUSES)[number]);
}

function rejectUnknownKeys(value: Record<string, unknown>, label: string, allowedKeys: string[], errors: string[]): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`);
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${field} must be a non-empty string`);
}

function validateStringArray(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return;
  }
  for (const item of value) if (typeof item !== "string" || item.trim().length === 0) errors.push(`${field} must contain only non-empty strings`);
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
