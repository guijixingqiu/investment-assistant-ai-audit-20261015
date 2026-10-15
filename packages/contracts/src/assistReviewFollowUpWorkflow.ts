export const ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_SCHEMA_VERSION = "2026-07-05.assist-1.local-review-followup-workflow.v1";

export const ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_STATUSES = ["available", "blocked_workspace", "not_found", "unauthorized", "unavailable", "malformed"] as const;
export const ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_STEP_IDS = [
  "inspect_workspace_readiness",
  "review_evidence_gaps",
  "draft_local_review_note",
  "set_later_review_intent",
  "stop_due_to_blocked_workspace"
] as const;
export const ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_INTENT_IDS = [
  "manual_note_draft",
  "later_review_draft",
  "evidence_gap_checklist"
] as const;

const FAIL_CLOSED_STATUSES = ["not_found", "unauthorized", "unavailable", "malformed"] as const;
const FORBIDDEN_FIELD_NAMES = [
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

export type AssistReviewFollowUpWorkflowStatus = (typeof ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_STATUSES)[number];
export type AssistReviewFollowUpWorkflowStepId = (typeof ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_STEP_IDS)[number];
export type AssistReviewFollowUpWorkflowIntentId = (typeof ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_INTENT_IDS)[number];

export interface AssistReviewFollowUpWorkflowTarget {
  market: "HK";
  code: string;
  symbol: string;
  candidateMembershipId: string | null;
}

export interface AssistReviewFollowUpWorkflowWorkspaceRef {
  schemaVersion: string;
  route: "/api/mobile/research/candidate-memberships/:id/human-review-workspace";
  status: string;
  readinessId: string;
  generatedAt: string;
}

export interface AssistReviewFollowUpWorkflowStep {
  id: AssistReviewFollowUpWorkflowStepId;
  label: string;
  description: string;
  enabled: boolean;
  disabledReason: string | null;
  localOnly: true;
  persists: false;
  allowedInterpretation: string;
  forbiddenInterpretation: string;
}

export interface AssistReviewFollowUpWorkflowIntent {
  id: AssistReviewFollowUpWorkflowIntentId;
  label: string;
  placeholder: string;
  draftValue: null;
  localOnly: true;
  persists: false;
  maxLength: number;
  allowedInterpretation: string;
  forbiddenInterpretation: string;
}

export interface AssistReviewFollowUpWorkflowProvenance {
  sourceWorkspace: "assist_human_review_workspace_v1";
  draftStorage: "client_memory_only";
  persistence: "omitted";
  runtime: "repository_local_only";
  externalAccounts: "omitted";
  portfolio: "omitted";
}

export interface AssistReviewFollowUpWorkflowSafety {
  advisoryOnly: true;
  manualReviewOnly: true;
  localDraftOnly: true;
  noPersistence: true;
  noRecommendation: true;
  noRanking: true;
  noScoring: true;
  noBuySellHold: true;
  noOrder: true;
  noTrade: true;
  noFill: true;
  noBroker: true;
  noPortfolioMutation: true;
  noCashMutation: true;
  noFeeMutation: true;
  noPositionMutation: true;
  noProductionClaim: true;
}

export interface AssistReviewFollowUpWorkflowFailClosed {
  active: boolean;
  reason: string | null;
  clearsDraft: true;
  noStaleWorkspaceFacts: true;
  noPartialDraftPersistence: true;
}

export interface AssistReviewFollowUpWorkflowEnvelope {
  schemaVersion: typeof ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_SCHEMA_VERSION;
  generatedAt: string;
  status: AssistReviewFollowUpWorkflowStatus;
  target: AssistReviewFollowUpWorkflowTarget;
  workspaceRef: AssistReviewFollowUpWorkflowWorkspaceRef;
  sourceWorkspaceRef: AssistReviewFollowUpWorkflowWorkspaceRef;
  reviewState: string;
  followUpState: string;
  manualNoteDraft: AssistReviewFollowUpWorkflowIntent | null;
  laterReviewIntent: AssistReviewFollowUpWorkflowIntent | null;
  evidenceGaps: string[];
  unresolvedEvidenceGaps: string[];
  suggestedLocalViews: string[];
  localNextViews: string[];
  blockedExternalActions: string[];
  steps: AssistReviewFollowUpWorkflowStep[];
  intents: AssistReviewFollowUpWorkflowIntent[];
  failClosed: AssistReviewFollowUpWorkflowFailClosed;
  safety: AssistReviewFollowUpWorkflowSafety;
  provenance: AssistReviewFollowUpWorkflowProvenance;
  message: string;
}

export function validateAssistReviewFollowUpWorkflowEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["follow-up workflow envelope must be an object"] };
  collectForbiddenFieldNameErrors(value, "workflow", errors);
  rejectUnknownKeys(value, "workflow", [
    "schemaVersion",
    "generatedAt",
    "status",
    "target",
    "workspaceRef",
    "sourceWorkspaceRef",
    "reviewState",
    "followUpState",
    "manualNoteDraft",
    "laterReviewIntent",
    "evidenceGaps",
    "unresolvedEvidenceGaps",
    "suggestedLocalViews",
    "localNextViews",
    "blockedExternalActions",
    "steps",
    "intents",
    "failClosed",
    "safety",
    "provenance",
    "message"
  ], errors);
  if (value.schemaVersion !== ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_SCHEMA_VERSION) errors.push(`schemaVersion must be ${ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_SCHEMA_VERSION}`);
  requireIso(value.generatedAt, "generatedAt", errors);
  if (!ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_STATUSES.includes(value.status as AssistReviewFollowUpWorkflowStatus)) errors.push("status is invalid");
  validateTarget(value.target, errors);
  validateWorkspaceRef(value.workspaceRef, errors);
  validateWorkspaceRef(value.sourceWorkspaceRef, errors, "sourceWorkspaceRef");
  requireNonEmptyString(value.reviewState, "reviewState", errors);
  requireNonEmptyString(value.followUpState, "followUpState", errors);
  validateOptionalIntent(value.manualNoteDraft, "manualNoteDraft", errors);
  validateOptionalIntent(value.laterReviewIntent, "laterReviewIntent", errors);
  validateStringArray(value.evidenceGaps, "evidenceGaps", errors);
  validateStringArray(value.unresolvedEvidenceGaps, "unresolvedEvidenceGaps", errors);
  validateStringArray(value.suggestedLocalViews, "suggestedLocalViews", errors);
  validateStringArray(value.localNextViews, "localNextViews", errors);
  validateStringArray(value.blockedExternalActions, "blockedExternalActions", errors);
  validateSteps(value.steps, errors);
  validateIntents(value.intents, errors);
  validateFailClosed(value.failClosed, errors);
  validateSafety(value.safety, errors);
  validateProvenance(value.provenance, errors);
  requireNonEmptyString(value.message, "message", errors);

  const status = value.status as AssistReviewFollowUpWorkflowStatus;
  const steps = Array.isArray(value.steps) ? value.steps : [];
  const intents = Array.isArray(value.intents) ? value.intents : [];
  if (isFailClosedStatus(status)) {
    if (steps.some((step) => isRecord(step) && step.id !== "stop_due_to_blocked_workspace")) errors.push("fail-closed workflow can only expose stop_due_to_blocked_workspace");
    if (intents.length !== 0) errors.push("fail-closed workflow must not expose draft intents");
    if (value.manualNoteDraft !== null || value.laterReviewIntent !== null) errors.push("fail-closed workflow must not expose usable draft intents");
    if (isRecord(value.failClosed) && value.failClosed.active !== true) errors.push("fail-closed workflow must mark failClosed.active true");
  }
  if (status === "available" && isRecord(value.failClosed) && value.failClosed.active !== false) errors.push("available workflow must mark failClosed.active false");
  if (status === "blocked_workspace" && isRecord(value.failClosed) && value.failClosed.active !== false) errors.push("blocked workspace workflow must keep failClosed.active false while exposing blocked local facts");
  if ((status === "available" || status === "blocked_workspace") && (value.manualNoteDraft === null || value.laterReviewIntent === null)) errors.push("available and blocked workspace workflows must expose local draft intent metadata");
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

function validateWorkspaceRef(value: unknown, errors: string[], fieldName = "workspaceRef"): void {
  if (!isRecord(value)) {
    errors.push(`${fieldName} must be an object`);
    return;
  }
  rejectUnknownKeys(value, fieldName, ["schemaVersion", "route", "status", "readinessId", "generatedAt"], errors);
  requireNonEmptyString(value.schemaVersion, `${fieldName}.schemaVersion`, errors);
  if (value.route !== "/api/mobile/research/candidate-memberships/:id/human-review-workspace") errors.push(`${fieldName}.route is invalid`);
  requireNonEmptyString(value.status, `${fieldName}.status`, errors);
  requireNonEmptyString(value.readinessId, `${fieldName}.readinessId`, errors);
  requireIso(value.generatedAt, `${fieldName}.generatedAt`, errors);
}

function validateSteps(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("steps must be an array");
    return;
  }
  const seen = new Set<string>();
  for (const step of value) {
    if (!isRecord(step)) {
      errors.push("steps must contain objects");
      continue;
    }
    rejectUnknownKeys(step, "step", ["id", "label", "description", "enabled", "disabledReason", "localOnly", "persists", "allowedInterpretation", "forbiddenInterpretation"], errors);
    if (!ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_STEP_IDS.includes(step.id as AssistReviewFollowUpWorkflowStepId)) errors.push("step.id is invalid");
    if (typeof step.id === "string") {
      if (seen.has(step.id)) errors.push(`steps contains duplicate ${step.id}`);
      seen.add(step.id);
    }
    for (const field of ["label", "description", "allowedInterpretation", "forbiddenInterpretation"]) requireNonEmptyString(step[field], `step.${field}`, errors);
    if (typeof step.enabled !== "boolean") errors.push("step.enabled must be boolean");
    validateOptionalString(step.disabledReason, "step.disabledReason", errors);
    if (step.localOnly !== true) errors.push("step.localOnly must be true");
    if (step.persists !== false) errors.push("step.persists must be false");
  }
}

function validateIntents(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("intents must be an array");
    return;
  }
  const seen = new Set<string>();
  for (const intent of value) {
    if (!isRecord(intent)) {
      errors.push("intents must contain objects");
      continue;
    }
    rejectUnknownKeys(intent, "intent", ["id", "label", "placeholder", "draftValue", "localOnly", "persists", "maxLength", "allowedInterpretation", "forbiddenInterpretation"], errors);
    if (!ASSIST_REVIEW_FOLLOW_UP_WORKFLOW_INTENT_IDS.includes(intent.id as AssistReviewFollowUpWorkflowIntentId)) errors.push("intent.id is invalid");
    if (typeof intent.id === "string") {
      if (seen.has(intent.id)) errors.push(`intents contains duplicate ${intent.id}`);
      seen.add(intent.id);
    }
    for (const field of ["label", "placeholder", "allowedInterpretation", "forbiddenInterpretation"]) requireNonEmptyString(intent[field], `intent.${field}`, errors);
    if (intent.draftValue !== null) errors.push("intent.draftValue must be null in API envelopes");
    if (intent.localOnly !== true) errors.push("intent.localOnly must be true");
    if (intent.persists !== false) errors.push("intent.persists must be false");
    if (typeof intent.maxLength !== "number" || !Number.isInteger(intent.maxLength) || intent.maxLength < 1 || intent.maxLength > 2000) errors.push("intent.maxLength is invalid");
  }
}

function validateOptionalIntent(value: unknown, fieldName: string, errors: string[]): void {
  if (value === null) return;
  validateIntents([value], errors);
  if (isRecord(value)) {
    if (fieldName === "manualNoteDraft" && value.id !== "manual_note_draft") errors.push("manualNoteDraft.id must be manual_note_draft");
    if (fieldName === "laterReviewIntent" && value.id !== "later_review_draft") errors.push("laterReviewIntent.id must be later_review_draft");
  }
}

function validateProvenance(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("provenance must be an object");
    return;
  }
  rejectUnknownKeys(value, "provenance", ["sourceWorkspace", "draftStorage", "persistence", "runtime", "externalAccounts", "portfolio"], errors);
  if (value.sourceWorkspace !== "assist_human_review_workspace_v1") errors.push("provenance.sourceWorkspace is invalid");
  if (value.draftStorage !== "client_memory_only") errors.push("provenance.draftStorage must be client_memory_only");
  if (value.persistence !== "omitted") errors.push("provenance.persistence must be omitted");
  if (value.runtime !== "repository_local_only") errors.push("provenance.runtime must be repository_local_only");
  if (value.externalAccounts !== "omitted") errors.push("provenance.externalAccounts must be omitted");
  if (value.portfolio !== "omitted") errors.push("provenance.portfolio must be omitted");
}

function validateFailClosed(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("failClosed must be an object");
    return;
  }
  rejectUnknownKeys(value, "failClosed", ["active", "reason", "clearsDraft", "noStaleWorkspaceFacts", "noPartialDraftPersistence"], errors);
  if (typeof value.active !== "boolean") errors.push("failClosed.active must be boolean");
  validateOptionalString(value.reason, "failClosed.reason", errors);
  for (const key of ["clearsDraft", "noStaleWorkspaceFacts", "noPartialDraftPersistence"]) if (value[key] !== true) errors.push(`failClosed.${key} must be true`);
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("safety must be an object");
    return;
  }
  const keys = [
    "advisoryOnly",
    "manualReviewOnly",
    "localDraftOnly",
    "noPersistence",
    "noRecommendation",
    "noRanking",
    "noScoring",
    "noBuySellHold",
    "noOrder",
    "noTrade",
    "noFill",
    "noBroker",
    "noPortfolioMutation",
    "noCashMutation",
    "noFeeMutation",
    "noPositionMutation",
    "noProductionClaim"
  ];
  rejectUnknownKeys(value, "safety", keys, errors);
  for (const key of keys) if (value[key] !== true) errors.push(`safety.${key} must be true`);
}

function collectForbiddenFieldNameErrors(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenFieldNameErrors(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (isForbiddenFieldName(key)) errors.push(`${path}.${key} is a forbidden recommendation/trading field`);
    collectForbiddenFieldNameErrors(value[key], `${path}.${key}`, errors);
  }
}

function isForbiddenFieldName(key: string): boolean {
  const normalized = key.toLowerCase();
  return FORBIDDEN_FIELD_NAMES.some((forbidden) => forbidden.toLowerCase() === normalized);
}

function isFailClosedStatus(status: AssistReviewFollowUpWorkflowStatus): boolean {
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

function requireIso(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) errors.push(`${field} must be a valid date-time`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
