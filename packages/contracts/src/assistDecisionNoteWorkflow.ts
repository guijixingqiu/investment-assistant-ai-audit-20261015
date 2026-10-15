export const ASSIST_DECISION_NOTE_WORKFLOW_SCHEMA_VERSION = "2026-07-05.assist-1.local-decision-note-workflow.v1";

export const ASSIST_DECISION_NOTE_WORKFLOW_STATUSES = ["available", "blocked_follow_up", "not_found", "unauthorized", "unavailable", "malformed"] as const;
export const ASSIST_DECISION_NOTE_WORKFLOW_STEP_IDS = [
  "inspect_source_workspace",
  "inspect_follow_up_workflow",
  "draft_local_decision_note",
  "review_fact_references",
  "review_evidence_gaps",
  "set_later_review_entry",
  "stop_due_to_unavailable_source"
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

export type AssistDecisionNoteWorkflowStatus = (typeof ASSIST_DECISION_NOTE_WORKFLOW_STATUSES)[number];
export type AssistDecisionNoteWorkflowStepId = (typeof ASSIST_DECISION_NOTE_WORKFLOW_STEP_IDS)[number];

export interface AssistDecisionNoteWorkflowTarget {
  market: "HK";
  code: string;
  symbol: string;
  candidateMembershipId: string | null;
}

export interface AssistDecisionNoteWorkflowSourceRef {
  schemaVersion: string;
  route: string;
  status: string;
  generatedAt: string;
}

export interface AssistDecisionNoteWorkflowDraft {
  id: "decision_note_draft";
  label: string;
  placeholder: string;
  draftValue: null;
  localOnly: true;
  officialRecord: false;
  persists: false;
  sent: false;
  maxLength: number;
  allowedInterpretation: string;
  forbiddenInterpretation: string;
}

export interface AssistDecisionNoteWorkflowFactReference {
  id: string;
  label: string;
  source: "human_review_workspace" | "review_follow_up_workflow" | "safety_boundary";
  summary: string;
  localOnly: true;
  available: boolean;
}

export interface AssistDecisionNoteWorkflowStep {
  id: AssistDecisionNoteWorkflowStepId;
  label: string;
  description: string;
  enabled: boolean;
  disabledReason: string | null;
  localOnly: true;
  persists: false;
  allowedInterpretation: string;
  forbiddenInterpretation: string;
}

export interface AssistDecisionNoteWorkflowSafety {
  advisoryOnly: true;
  manualReviewOnly: true;
  localDraftOnly: true;
  noOfficialRecord: true;
  noPersistence: true;
  notSent: true;
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
  noBroker: true;
  noPortfolioMutation: true;
  noCashMutation: true;
  noFeeMutation: true;
  noPositionMutation: true;
  noProductionClaim: true;
}

export interface AssistDecisionNoteWorkflowFailClosed {
  active: boolean;
  reason: string | null;
  clearsDraft: true;
  noStaleFacts: true;
  noStaleDraft: true;
  noPartialFacts: true;
  noUsableStaleReferences: true;
}

export interface AssistDecisionNoteWorkflowProvenance {
  sourceWorkspace: "assist_human_review_workspace_v1";
  sourceFollowUpWorkflow: "assist_review_followup_workflow_v1";
  draftStorage: "client_memory_only";
  persistence: "omitted";
  runtime: "repository_local_only";
  externalAccounts: "omitted";
  portfolio: "omitted";
}

export interface AssistDecisionNoteWorkflowEnvelope {
  schemaVersion: typeof ASSIST_DECISION_NOTE_WORKFLOW_SCHEMA_VERSION;
  generatedAt: string;
  status: AssistDecisionNoteWorkflowStatus;
  target: AssistDecisionNoteWorkflowTarget;
  sourceWorkspaceRef: AssistDecisionNoteWorkflowSourceRef;
  sourceFollowUpWorkflowRef: AssistDecisionNoteWorkflowSourceRef;
  noteState: string;
  decisionNoteDraft: AssistDecisionNoteWorkflowDraft | null;
  factReferences: AssistDecisionNoteWorkflowFactReference[];
  unresolvedEvidenceGaps: string[];
  laterReviewEntry: string | null;
  blockedExternalActions: string[];
  steps: AssistDecisionNoteWorkflowStep[];
  failClosed: AssistDecisionNoteWorkflowFailClosed;
  safety: AssistDecisionNoteWorkflowSafety;
  provenance: AssistDecisionNoteWorkflowProvenance;
  message: string;
}

export function validateAssistDecisionNoteWorkflowEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["decision note workflow envelope must be an object"] };
  collectForbiddenFieldNameErrors(value, "decisionNoteWorkflow", errors);
  rejectUnknownKeys(value, "decisionNoteWorkflow", [
    "schemaVersion",
    "generatedAt",
    "status",
    "target",
    "sourceWorkspaceRef",
    "sourceFollowUpWorkflowRef",
    "noteState",
    "decisionNoteDraft",
    "factReferences",
    "unresolvedEvidenceGaps",
    "laterReviewEntry",
    "blockedExternalActions",
    "steps",
    "failClosed",
    "safety",
    "provenance",
    "message"
  ], errors);
  if (value.schemaVersion !== ASSIST_DECISION_NOTE_WORKFLOW_SCHEMA_VERSION) errors.push(`schemaVersion must be ${ASSIST_DECISION_NOTE_WORKFLOW_SCHEMA_VERSION}`);
  requireIso(value.generatedAt, "generatedAt", errors);
  if (!ASSIST_DECISION_NOTE_WORKFLOW_STATUSES.includes(value.status as AssistDecisionNoteWorkflowStatus)) errors.push("status is invalid");
  validateTarget(value.target, errors);
  validateSourceRef(value.sourceWorkspaceRef, "sourceWorkspaceRef", errors);
  validateSourceRef(value.sourceFollowUpWorkflowRef, "sourceFollowUpWorkflowRef", errors);
  requireNonEmptyString(value.noteState, "noteState", errors);
  validateDraft(value.decisionNoteDraft, errors);
  validateFactReferences(value.factReferences, errors);
  validateStringArray(value.unresolvedEvidenceGaps, "unresolvedEvidenceGaps", errors);
  validateOptionalString(value.laterReviewEntry, "laterReviewEntry", errors);
  validateStringArray(value.blockedExternalActions, "blockedExternalActions", errors);
  validateSteps(value.steps, errors);
  validateFailClosed(value.failClosed, errors);
  validateSafety(value.safety, errors);
  validateProvenance(value.provenance, errors);
  requireNonEmptyString(value.message, "message", errors);

  const status = value.status as AssistDecisionNoteWorkflowStatus;
  if (isFailClosedStatus(status)) {
    if (value.decisionNoteDraft !== null) errors.push("fail-closed decision note workflow must not expose a usable draft");
    if (Array.isArray(value.factReferences) && value.factReferences.length !== 0) errors.push("fail-closed decision note workflow must not expose fact references");
    if (value.laterReviewEntry !== null) errors.push("fail-closed decision note workflow must not expose later-review entry");
    if (isRecord(value.failClosed) && value.failClosed.active !== true) errors.push("fail-closed decision note workflow must mark failClosed.active true");
  }
  if ((status === "available" || status === "blocked_follow_up") && value.decisionNoteDraft === null) errors.push("available and blocked decision note workflows must expose local draft metadata");
  if (status === "available" && isRecord(value.failClosed) && value.failClosed.active !== false) errors.push("available decision note workflow must mark failClosed.active false");
  if (status === "blocked_follow_up" && isRecord(value.failClosed) && value.failClosed.active !== false) errors.push("blocked decision note workflow must keep failClosed.active false while exposing local blocked facts");
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

function validateSourceRef(value: unknown, fieldName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${fieldName} must be an object`);
    return;
  }
  rejectUnknownKeys(value, fieldName, ["schemaVersion", "route", "status", "generatedAt"], errors);
  requireNonEmptyString(value.schemaVersion, `${fieldName}.schemaVersion`, errors);
  requireNonEmptyString(value.route, `${fieldName}.route`, errors);
  requireNonEmptyString(value.status, `${fieldName}.status`, errors);
  requireIso(value.generatedAt, `${fieldName}.generatedAt`, errors);
}

function validateDraft(value: unknown, errors: string[]): void {
  if (value === null) return;
  if (!isRecord(value)) {
    errors.push("decisionNoteDraft must be an object or null");
    return;
  }
  rejectUnknownKeys(value, "decisionNoteDraft", ["id", "label", "placeholder", "draftValue", "localOnly", "officialRecord", "persists", "sent", "maxLength", "allowedInterpretation", "forbiddenInterpretation"], errors);
  if (value.id !== "decision_note_draft") errors.push("decisionNoteDraft.id must be decision_note_draft");
  for (const field of ["label", "placeholder", "allowedInterpretation", "forbiddenInterpretation"]) requireNonEmptyString(value[field], `decisionNoteDraft.${field}`, errors);
  if (value.draftValue !== null) errors.push("decisionNoteDraft.draftValue must be null in API envelopes");
  if (value.localOnly !== true || value.officialRecord !== false || value.persists !== false || value.sent !== false) errors.push("decision note draft must be local-only, unofficial, non-persistent, and unsent");
  const maxLength = value.maxLength;
  if (typeof maxLength !== "number" || !Number.isInteger(maxLength) || maxLength < 1 || maxLength > 4000) errors.push("decisionNoteDraft.maxLength is invalid");
}

function validateFactReferences(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("factReferences must be an array");
    return;
  }
  const seen = new Set<string>();
  for (const reference of value) {
    if (!isRecord(reference)) {
      errors.push("factReferences must contain objects");
      continue;
    }
    rejectUnknownKeys(reference, "factReference", ["id", "label", "source", "summary", "localOnly", "available"], errors);
    requireNonEmptyString(reference.id, "factReference.id", errors);
    if (typeof reference.id === "string") {
      if (seen.has(reference.id)) errors.push(`factReferences contains duplicate ${reference.id}`);
      seen.add(reference.id);
    }
    requireNonEmptyString(reference.label, "factReference.label", errors);
    if (!["human_review_workspace", "review_follow_up_workflow", "safety_boundary"].includes(String(reference.source))) errors.push("factReference.source is invalid");
    requireNonEmptyString(reference.summary, "factReference.summary", errors);
    if (reference.localOnly !== true || typeof reference.available !== "boolean") errors.push("factReference must be local-only with boolean availability");
  }
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
    if (!ASSIST_DECISION_NOTE_WORKFLOW_STEP_IDS.includes(step.id as AssistDecisionNoteWorkflowStepId)) errors.push("step.id is invalid");
    if (typeof step.id === "string") {
      if (seen.has(step.id)) errors.push(`steps contains duplicate ${step.id}`);
      seen.add(step.id);
    }
    for (const field of ["label", "description", "allowedInterpretation", "forbiddenInterpretation"]) requireNonEmptyString(step[field], `step.${field}`, errors);
    if (typeof step.enabled !== "boolean") errors.push("step.enabled must be boolean");
    validateOptionalString(step.disabledReason, "step.disabledReason", errors);
    if (step.localOnly !== true || step.persists !== false) errors.push("decision note workflow steps must be local-only and non-persistent");
  }
}

function validateFailClosed(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("failClosed must be an object");
    return;
  }
  rejectUnknownKeys(value, "failClosed", ["active", "reason", "clearsDraft", "noStaleFacts", "noStaleDraft", "noPartialFacts", "noUsableStaleReferences"], errors);
  if (typeof value.active !== "boolean") errors.push("failClosed.active must be boolean");
  validateOptionalString(value.reason, "failClosed.reason", errors);
  if (value.clearsDraft !== true || value.noStaleFacts !== true || value.noStaleDraft !== true || value.noPartialFacts !== true || value.noUsableStaleReferences !== true) {
    errors.push("failClosed must clear draft and stale facts/references");
  }
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("safety must be an object");
    return;
  }
  rejectUnknownKeys(value, "safety", [
    "advisoryOnly",
    "manualReviewOnly",
    "localDraftOnly",
    "noOfficialRecord",
    "noPersistence",
    "notSent",
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
    "noBroker",
    "noPortfolioMutation",
    "noCashMutation",
    "noFeeMutation",
    "noPositionMutation",
    "noProductionClaim"
  ], errors);
  for (const key of Object.keys(value)) {
    if (value[key] !== true) errors.push(`safety.${key} must be true`);
  }
}

function validateProvenance(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("provenance must be an object");
    return;
  }
  rejectUnknownKeys(value, "provenance", ["sourceWorkspace", "sourceFollowUpWorkflow", "draftStorage", "persistence", "runtime", "externalAccounts", "portfolio"], errors);
  if (value.sourceWorkspace !== "assist_human_review_workspace_v1") errors.push("provenance.sourceWorkspace is invalid");
  if (value.sourceFollowUpWorkflow !== "assist_review_followup_workflow_v1") errors.push("provenance.sourceFollowUpWorkflow is invalid");
  if (value.draftStorage !== "client_memory_only" || value.persistence !== "omitted" || value.runtime !== "repository_local_only" || value.externalAccounts !== "omitted" || value.portfolio !== "omitted") {
    errors.push("decision note provenance must be client-memory-only, non-persistent, repository-local, and omit external accounts and portfolio");
  }
}

function isFailClosedStatus(status: AssistDecisionNoteWorkflowStatus): boolean {
  return (FAIL_CLOSED_STATUSES as readonly string[]).includes(status);
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim() === "") errors.push(`${field} is required`);
}

function validateOptionalString(value: unknown, field: string, errors: string[]): void {
  if (value !== null && value !== undefined && (typeof value !== "string" || value.trim() === "")) errors.push(`${field} must be null or a non-empty string`);
}

function validateStringArray(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return;
  }
  if (value.some((item) => typeof item !== "string" || item.trim() === "")) errors.push(`${field} must contain only non-empty strings`);
}

function requireIso(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) errors.push(`${field} must be an ISO date-time`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(value: Record<string, unknown>, label: string, allowed: string[], errors: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not allowed`);
  }
}

function collectForbiddenFieldNameErrors(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenFieldNameErrors(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if ((FORBIDDEN_FIELD_NAMES as readonly string[]).includes(key)) errors.push(`${path}.${key} is forbidden`);
    collectForbiddenFieldNameErrors(nested, `${path}.${key}`, errors);
  }
}
