import type { DecisionActionIntent } from "./research.js";
import { DECISION_ACTION_INTENTS, RESEARCH_WRITE_SCHEMA_VERSION } from "./research.js";
import type { FactMetadata } from "./factMetadata.js";
import { validateFactMetadataInto } from "./factMetadata.js";
import type {
  DecisionContextEnvelope,
  HumanCheckResult,
  ManualDecisionSourceBinding,
  OrdinaryResearchChangeBinding,
  PreTradeDecisionCheckData
} from "./decisionContext.js";
import {
  DECISION_CHECK_SCHEMA_VERSION,
  DECISION_CONTEXT_SCHEMA_VERSION,
  HUMAN_CHECK_RESULTS,
  validDecisionReviewDueOn,
  validateManualDecisionSourceBindings,
  validateOrdinaryResearchChangeBinding,
  validateDecisionContextEnvelope
} from "./decisionContextBrowser.js";
import { validateResearchReportDecisionBinding, validateResearchReportDecisionForRecordedCheck, validateResearchReportDecisionState, type ResearchReportDecisionBinding, type ResearchReportDecisionState } from "./researchReportDecision.js";
import {
  decisionSnapshotBindingFromState,
  sameDecisionSnapshotBinding,
  validateDecisionSnapshotStateStructure,
  type DecisionSnapshotState
} from "./decisionSnapshotContract.js";
import {
  annualConditionalDecisionNotCapturedState,
  conditionalDecisionSnapshotBindingFromPreview,
  conditionalHumanCheckResult,
  validateAnnualConditionalDecisionStateStructure,
  type AnnualConditionalDecisionState
} from "./annualConditionalDecisionContract.js";
import {
  validatePostDecisionPortfolioReviewBinding,
  validatePostDecisionPortfolioReviewStateStructure,
  type PostDecisionPortfolioReviewBinding,
  type PostDecisionPortfolioReviewState
} from "./postDecisionPortfolioReviewContract.js";
import {
  annualReviewLearningNotCapturedState,
  validateAnnualReviewLearningRequest,
  validateAnnualReviewLearningState,
  type AnnualReviewLearningRequest,
  type AnnualReviewLearningState
} from "./annualReviewLearning.js";
import {
  validateAnnualReviewLearningSummary,
  type AnnualReviewLearningSummary,
  type AnnualReviewLearningSummarySourceCheck
} from "./annualReviewLearningSummary.js";
import { formalDecisionNotCapturedState, validateFormalDecisionState, type FormalDecisionState } from "./formalDecision.js";
export type { PostDecisionPortfolioReviewBinding, PostDecisionPortfolioReviewState } from "./postDecisionPortfolioReviewContract.js";
export type { AnnualReviewLearningRequest, AnnualReviewLearningState } from "./annualReviewLearning.js";
export type { AnnualReviewLearningSummary } from "./annualReviewLearningSummary.js";
export const DECISION_REVIEW_SCHEMA_VERSION = "2026-06-28.core-1c-review.v1";
export const DECISION_REVIEW_OUTCOMES = [
  "thesis_confirmed",
  "thesis_weakened",
  "thesis_invalidated",
  "insufficient_evidence"
] as const;
const DECISION_REVIEW_AUDIT_ACTOR_TYPES = ["user", "system", "migration", "test"] as const;
export type DecisionReviewOutcome = (typeof DECISION_REVIEW_OUTCOMES)[number];
export type DecisionContextSnapshotAvailability = "preserved" | "context_snapshot_unavailable";
export interface CreatePostDecisionReviewRequest {
  outcome: DecisionReviewOutcome;
  outcomeEvidence?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  portfolioReviewBinding?: PostDecisionPortfolioReviewBinding;
  reviewLearning?: AnnualReviewLearningRequest;
  dailyTrackingBinding?: ResearchReportDecisionBinding;
  idempotencyKey: string;
}
export interface DeleteDecisionCheckRequest {
  expectedCheckedAt: string;
  ownerConfirmed: true;
  idempotencyKey: string;
}
export interface DeletePostDecisionReviewRequest {
  expectedCreatedAt: string;
  ownerConfirmed: true;
  idempotencyKey: string;
}
export interface DecisionReviewDeletionData {
  kind: "decision_check" | "post_decision_review";
  decisionCheckId: string;
  reviewId: string | null;
  symbol: string;
  recordedAt: string;
  deletedAt: string;
  state: "deleted";
}
export interface DecisionReviewSafety {
  createsOrder: false;
  createsTrade: false;
  mutatesCash: false;
  writesFee: false;
  mutatesPosition: false;
  callsBroker: false;
}
export interface PostDecisionReviewData {
  id: string;
  decisionCheckId: string;
  market: string;
  code: string;
  symbol: string;
  outcome: DecisionReviewOutcome;
  outcomeEvidence: string | null;
  reviewNote: string | null;
  reviewedAt: string;
  createdAt: string;
  portfolioReview: PostDecisionPortfolioReviewState;
  reviewLearning: AnnualReviewLearningState;
  audit: {
    actorType: "user" | "system" | "migration" | "test";
    actorId: string | null;
    idempotencyKey: string;
    correlationId: string | null;
  };
  safety: DecisionReviewSafety;
}
export interface RecordedDecisionCheckReviewState {
  id: string;
  market: string;
  code: string;
  symbol: string;
  decisionContextSchemaVersion: string;
  decisionCheckSchemaVersion: string;
  contextId: string;
  contextHash: string;
  actionIntent: DecisionActionIntent;
  humanCheckResult: HumanCheckResult;
  userFinalDecision: string | null;
  checkedAt: string;
  reviewDueOn?: string;
  manualSourceBindings?: ManualDecisionSourceBinding[];
  researchChangeBinding?: OrdinaryResearchChangeBinding;
  contextSnapshot: {
    availability: DecisionContextSnapshotAvailability;
    envelope: DecisionContextEnvelope | null;
    limitation: string;
  };
  decisionSnapshot: DecisionSnapshotState;
  conditionalDecision: AnnualConditionalDecisionState;
  researchReportDecision: ResearchReportDecisionState;
  formalDecision: FormalDecisionState;
  reviews: PostDecisionReviewData[];
  safety: DecisionReviewSafety;
}

export interface DecisionReviewHistoryEnvelope {
  schemaVersion: typeof DECISION_REVIEW_SCHEMA_VERSION;
  requestedSymbol: string;
  metadata: FactMetadata;
  checks: RecordedDecisionCheckReviewState[];
  deletions?: DecisionReviewDeletionData[];
  learningSummary?: AnnualReviewLearningSummary;
  advisoryOnly: true;
  safety: DecisionReviewSafety;
  message: string;
}

export function validateDeleteDecisionCheckRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  return validateDeletionRequest(value, "expectedCheckedAt");
}

export function validateDeletePostDecisionReviewRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  return validateDeletionRequest(value, "expectedCreatedAt");
}

export function validateDecisionReviewDeletionData(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  validateDeletionData(value, "deletion", undefined, errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateCreatePostDecisionReviewRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["request must be an object"] };
  rejectUnknownKeys(value, "request", [
    "outcome",
    "outcomeEvidence",
    "reviewNote",
    "reviewedAt",
    "portfolioReviewBinding",
    "reviewLearning", "dailyTrackingBinding",
    "idempotencyKey"
  ], errors);
  if (!DECISION_REVIEW_OUTCOMES.includes(value.outcome as DecisionReviewOutcome)) {
    errors.push("outcome must be thesis_confirmed, thesis_weakened, thesis_invalidated, or insufficient_evidence");
  }
  validateOptionalString(value.outcomeEvidence, "outcomeEvidence", errors);
  validateOptionalString(value.reviewNote, "reviewNote", errors);
  validateOptionalString(value.reviewedAt, "reviewedAt", errors);
  if (typeof value.reviewedAt === "string" && !Number.isFinite(Date.parse(value.reviewedAt))) {
    errors.push("reviewedAt must be a valid date-time");
  }
  if (value.portfolioReviewBinding !== undefined) {
    const bindingValidation = validatePostDecisionPortfolioReviewBinding(value.portfolioReviewBinding);
    if (!bindingValidation.ok) errors.push(...bindingValidation.errors);
  }
  if (value.reviewLearning !== undefined) {
    const learningValidation = validateAnnualReviewLearningRequest(value.reviewLearning);
    if (!learningValidation.ok) errors.push(...learningValidation.errors);
  }
  const dailyBindingValidation = value.dailyTrackingBinding === undefined
    ? { ok: true } as const : validateResearchReportDecisionBinding(value.dailyTrackingBinding);
  if (!dailyBindingValidation.ok) errors.push(...dailyBindingValidation.errors);
  requireNonEmptyString(value.idempotencyKey, "idempotencyKey", errors);
  if (typeof value.idempotencyKey === "string" && value.idempotencyKey.length > 200) {
    errors.push("idempotencyKey must be at most 200 characters");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validatePostDecisionReviewWriteEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["write envelope must be an object"] };
  if (value.schemaVersion !== RESEARCH_WRITE_SCHEMA_VERSION) errors.push(`schemaVersion must be ${RESEARCH_WRITE_SCHEMA_VERSION}`);
  if (value.status !== "succeeded") errors.push("status must be succeeded");
  requireNonEmptyString(value.asOf, "asOf", errors);
  validateDateTime(value.asOf, "asOf", errors);
  validateWriteSource(value.source, "source", errors);
  validatePostDecisionReview(value.data, "data", null, null, errors);
  if (isRecord(value.data) && isRecord(value.source) && isRecord(value.data.audit)) {
    if (value.data.audit.actorType !== value.source.actorType) errors.push("data.audit.actorType must match source.actorType");
    if (value.data.audit.actorId !== value.source.actorId) errors.push("data.audit.actorId must match source.actorId");
    if (value.data.audit.correlationId !== value.source.correlationId) errors.push("data.audit.correlationId must match source.correlationId");
  }
  if (typeof value.message !== "string" || value.message.trim().length === 0) errors.push("message must be a non-empty string");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateDecisionReviewHistoryEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["envelope must be an object"] };
  if (value.schemaVersion !== DECISION_REVIEW_SCHEMA_VERSION) errors.push(`schemaVersion must be ${DECISION_REVIEW_SCHEMA_VERSION}`);
  requireNonEmptyString(value.requestedSymbol, "requestedSymbol", errors);
  validateFactMetadataInto(value.metadata, "metadata", errors);
  if (!Array.isArray(value.checks)) {
    errors.push("checks must be an array");
  } else {
    value.checks.forEach((check, index) => validateRecordedDecisionCheck(check, index, value.requestedSymbol, errors));
  }
  if (value.deletions !== undefined) {
    if (!Array.isArray(value.deletions)) errors.push("deletions must be an array");
    else {
      const identities = new Set<string>();
      value.deletions.forEach((deletion, index) => {
        validateDeletionData(deletion, `deletions[${index}]`, value.requestedSymbol, errors);
        if (isRecord(deletion)) {
          const identity = `${String(deletion.kind)}:${String(deletion.decisionCheckId)}:${String(deletion.reviewId)}`;
          if (identities.has(identity)) errors.push(`deletions[${index}] duplicates a deletion identity`);
          identities.add(identity);
        }
      });
    }
  }
  if (isRecord(value.metadata) && Array.isArray(value.checks)) {
    if (value.checks.length > 0 && value.metadata.freshness !== "fresh") {
      errors.push("metadata.freshness must be fresh when review history has checks");
    }
    if (value.metadata.freshness === "unavailable" && value.checks.length > 0) {
      errors.push("metadata.freshness unavailable must not expose review checks");
    }
    if (value.metadata.provenance !== "real" && value.metadata.provenance !== "fixture" && value.metadata.provenance !== "unavailable") {
      errors.push("metadata.provenance must be real, fixture, or unavailable for review history");
    }
    if (value.metadata.authority !== "decision_context" && value.metadata.authority !== "unavailable") {
      errors.push("metadata.authority must be decision_context or unavailable for review history");
    }
  }
  if (value.learningSummary !== undefined) {
    const summaryValidation = validateAnnualReviewLearningSummary(
      value.learningSummary,
      Array.isArray(value.checks) ? value.checks as AnnualReviewLearningSummarySourceCheck[] : undefined
    );
    if (!summaryValidation.ok) errors.push(...summaryValidation.errors);
  }
  if (value.advisoryOnly !== true) errors.push("advisoryOnly must be true");
  validateSafety(value.safety, "safety", errors);
  if (typeof value.message !== "string") errors.push("message must be a string");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateDeletionRequest(
  value: unknown,
  expectedTimestampKey: "expectedCheckedAt" | "expectedCreatedAt"
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["request must be an object"] };
  rejectUnknownKeys(value, "request", [expectedTimestampKey, "ownerConfirmed", "idempotencyKey"], errors);
  requireNonEmptyString(value[expectedTimestampKey], expectedTimestampKey, errors);
  validateDateTime(value[expectedTimestampKey], expectedTimestampKey, errors);
  if (value.ownerConfirmed !== true) errors.push("ownerConfirmed must be true");
  requireNonEmptyString(value.idempotencyKey, "idempotencyKey", errors);
  if (typeof value.idempotencyKey === "string" && value.idempotencyKey.length > 200) {
    errors.push("idempotencyKey must be at most 200 characters");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateDeletionData(
  value: unknown,
  field: string,
  requestedSymbol: unknown,
  errors: string[]
): void {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  rejectUnknownKeys(value, field, [
    "kind", "decisionCheckId", "reviewId", "symbol", "recordedAt", "deletedAt", "state"
  ], errors);
  if (value.kind !== "decision_check" && value.kind !== "post_decision_review") {
    errors.push(`${field}.kind is invalid`);
  }
  requireNonEmptyString(value.decisionCheckId, `${field}.decisionCheckId`, errors);
  if (value.kind === "decision_check" && value.reviewId !== null) {
    errors.push(`${field}.reviewId must be null for decision_check`);
  }
  if (value.kind === "post_decision_review") {
    requireNonEmptyString(value.reviewId, `${field}.reviewId`, errors);
  }
  requireNonEmptyString(value.symbol, `${field}.symbol`, errors);
  if (typeof requestedSymbol === "string" && value.symbol !== requestedSymbol) {
    errors.push(`${field}.symbol must equal requestedSymbol`);
  }
  requireNonEmptyString(value.recordedAt, `${field}.recordedAt`, errors);
  validateDateTime(value.recordedAt, `${field}.recordedAt`, errors);
  requireNonEmptyString(value.deletedAt, `${field}.deletedAt`, errors);
  validateDateTime(value.deletedAt, `${field}.deletedAt`, errors);
  if (typeof value.recordedAt === "string" && typeof value.deletedAt === "string"
    && Number.isFinite(Date.parse(value.recordedAt)) && Number.isFinite(Date.parse(value.deletedAt))
    && Date.parse(value.deletedAt) < Date.parse(value.recordedAt)) {
    errors.push(`${field}.deletedAt must not precede recordedAt`);
  }
  if (value.state !== "deleted") errors.push(`${field}.state must be deleted`);
}

export function reviewNoSideEffectSafety(): DecisionReviewSafety {
  return {
    createsOrder: false,
    createsTrade: false,
    mutatesCash: false,
    writesFee: false,
    mutatesPosition: false,
    callsBroker: false
  };
}

export function decisionCheckToReviewState(
  decision: PreTradeDecisionCheckData,
  contextSnapshot: RecordedDecisionCheckReviewState["contextSnapshot"],
  decisionSnapshot: DecisionSnapshotState | undefined,
  reviews: PostDecisionReviewData[]
): RecordedDecisionCheckReviewState {
  return {
    id: decision.id,
    market: decision.market,
    code: decision.code,
    symbol: decision.symbol,
    decisionContextSchemaVersion: decision.decisionContextSchemaVersion,
    decisionCheckSchemaVersion: decision.decisionCheckSchemaVersion,
    contextId: decision.contextId,
    contextHash: decision.contextHash,
    actionIntent: decision.actionIntent,
    humanCheckResult: decision.humanCheckResult,
    userFinalDecision: decision.userFinalDecision,
    checkedAt: decision.checkedAt,
    ...(decision.reviewDueOn === undefined ? {} : { reviewDueOn: decision.reviewDueOn }),
    ...(decision.manualSourceBindings === undefined ? {} : { manualSourceBindings: decision.manualSourceBindings }),
    ...(decision.researchChangeBinding === undefined ? {} : { researchChangeBinding: decision.researchChangeBinding }),
    contextSnapshot,
    decisionSnapshot: decisionSnapshot ?? {
      availability: "decision_snapshot_not_captured",
      snapshot: null,
      limitation: "This historical decision snapshot was not captured and is not reconstructed from current candidate, quote, research, portfolio, or risk facts."
    },
    conditionalDecision: decision.conditionalDecision ?? annualConditionalDecisionNotCapturedState(),
    researchReportDecision: decision.researchReportDecision,
    formalDecision: decision.formalDecision,
    reviews,
    safety: reviewNoSideEffectSafety()
  };
}

function validateSafety(value: unknown, field: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  for (const key of ["createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker"]) {
    if (value[key] !== false) errors.push(`${field}.${key} must be false`);
  }
}

function validateRecordedDecisionCheck(value: unknown, index: number, requestedSymbol: unknown, errors: string[]): void {
  const field = `checks[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  const canonicalSymbol = typeof value.market === "string" && typeof value.code === "string"
    ? `${value.market}.${value.code}`
    : null;
  requireNonEmptyString(value.id, `${field}.id`, errors);
  requireNonEmptyString(value.market, `${field}.market`, errors);
  requireNonEmptyString(value.code, `${field}.code`, errors);
  requireNonEmptyString(value.symbol, `${field}.symbol`, errors);
  if (canonicalSymbol !== null && value.symbol !== canonicalSymbol) {
    errors.push(`${field}.symbol must equal canonical market/code identity`);
  }
  if (typeof requestedSymbol === "string" && value.symbol !== requestedSymbol) {
    errors.push(`${field}.symbol must equal requestedSymbol`);
  }
  if (value.decisionContextSchemaVersion !== DECISION_CONTEXT_SCHEMA_VERSION) {
    errors.push(`${field}.decisionContextSchemaVersion must be ${DECISION_CONTEXT_SCHEMA_VERSION}`);
  }
  if (value.decisionCheckSchemaVersion !== DECISION_CHECK_SCHEMA_VERSION) {
    errors.push(`${field}.decisionCheckSchemaVersion must be ${DECISION_CHECK_SCHEMA_VERSION}`);
  }
  requireNonEmptyString(value.contextId, `${field}.contextId`, errors);
  requireNonEmptyString(value.contextHash, `${field}.contextHash`, errors);
  if (!DECISION_ACTION_INTENTS.includes(value.actionIntent as DecisionActionIntent)) {
    errors.push(`${field}.actionIntent must be one of ${DECISION_ACTION_INTENTS.join(", ")}`);
  }
  if (!HUMAN_CHECK_RESULTS.includes(value.humanCheckResult as HumanCheckResult)) {
    errors.push(`${field}.humanCheckResult must be ready_to_consider, blocked, or needs_more_evidence`);
  }
  validateOptionalString(value.userFinalDecision, `${field}.userFinalDecision`, errors);
  requireNonEmptyString(value.checkedAt, `${field}.checkedAt`, errors);
  validateDateTime(value.checkedAt, `${field}.checkedAt`, errors);
  if (value.reviewDueOn !== undefined && !validDecisionReviewDueOn(value.reviewDueOn))
    errors.push(`${field}.reviewDueOn must be a valid YYYY-MM-DD calendar date`);
  if (value.manualSourceBindings !== undefined)
    validateManualDecisionSourceBindings(value.manualSourceBindings, `${field}.manualSourceBindings`, errors);
  if (value.researchChangeBinding !== undefined) {
    validateOrdinaryResearchChangeBinding(value.researchChangeBinding, `${field}.researchChangeBinding`, errors);
    if (isRecord(value.researchChangeBinding) && (value.researchChangeBinding.symbol !== value.symbol
      || value.researchChangeBinding.previousDecisionCheckId === value.id
      || Date.parse(String(value.researchChangeBinding.sourcePublishedAt)) > Date.parse(String(value.checkedAt))))
      errors.push(`${field}.researchChangeBinding identity or chronology is invalid`);
  }
  validateContextSnapshot(value.contextSnapshot, field, value, errors);
  if (Array.isArray(value.manualSourceBindings) && isRecord(value.contextSnapshot)
    && isRecord(value.contextSnapshot.envelope) && isRecord(value.contextSnapshot.envelope.research)
    && Array.isArray(value.contextSnapshot.envelope.research.evidence)) {
    for (const binding of value.manualSourceBindings) {
      if (isRecord(binding) && binding.bindingKind === "saved_material") continue;
      if (!isRecord(binding) || value.contextSnapshot.envelope.research.evidence.filter((evidence) =>
        isRecord(evidence) && evidence.id === binding.evidenceId
          && evidence.sourceType === binding.sourceType
          && evidence.sourceUrl === (binding.sourceUrl ?? null)).length !== 1)
        errors.push(`${field}.manualSourceBindings must match frozen research evidence`);
    }
  }
  const decisionSnapshotValidation = validateDecisionSnapshotStateStructure(value.decisionSnapshot);
  if (!decisionSnapshotValidation.ok) errors.push(...decisionSnapshotValidation.errors.map((error) => `${field}.${error}`));
  else if (decisionSnapshotValidation.value.availability === "preserved") {
    const snapshot = decisionSnapshotValidation.value.snapshot;
    if (snapshot?.candidateSymbol !== value.symbol) errors.push(`${field}.decisionSnapshot candidateSymbol must match check symbol`);
    if (snapshot?.decisionContext.contextId !== value.contextId) errors.push(`${field}.decisionSnapshot contextId must match check contextId`);
    if (snapshot?.decisionContext.contextHash !== value.contextHash) errors.push(`${field}.decisionSnapshot contextHash must match check contextHash`);
  }
  const conditionalValidation = validateAnnualConditionalDecisionStateStructure(
    value.conditionalDecision ?? annualConditionalDecisionNotCapturedState()
  );
  if (!conditionalValidation.ok) errors.push(...conditionalValidation.errors.map((error) => `${field}.${error}`));
  else if (conditionalValidation.value.availability === "preserved" && conditionalValidation.value.preview) {
    if (conditionalValidation.value.preview.requestedSymbol !== value.symbol) errors.push(`${field}.conditionalDecision symbol must match check symbol`);
    const source = conditionalValidation.value.preview.data?.decisionBrief.data?.sourceIdentity;
    if (source?.decisionContextId !== value.contextId || source?.decisionContextHash !== value.contextHash) errors.push(`${field}.conditionalDecision context must match check context`);
    if (value.actionIntent !== "watch") errors.push(`${field}.conditionalDecision requires neutral watch actionIntent`);
    if (conditionalValidation.value.judgment
      && value.humanCheckResult !== conditionalHumanCheckResult(conditionalValidation.value.judgment.workflowState)) {
      errors.push(`${field}.conditionalDecision humanCheckResult must match the preserved workflow state`);
    }
    const expectedBinding = conditionalDecisionSnapshotBindingFromPreview(conditionalValidation.value.preview);
    const actualBinding = decisionSnapshotBindingFromState(value.decisionSnapshot);
    if (!expectedBinding || !actualBinding || !sameDecisionSnapshotBinding(expectedBinding, actualBinding)) {
      errors.push(`${field}.conditionalDecision portfolio and risk facts must match the immutable decision snapshot`);
    }
  }
  errors.push(...validateResearchReportDecisionForRecordedCheck(
    value.researchReportDecision, value.symbol,
    conditionalValidation.ok && conditionalValidation.value.availability === "preserved", field
  ));
  validateRecordedFormalDecision(value, field, errors);
  if (!Array.isArray(value.reviews)) {
    errors.push(`${field}.reviews must be an array`);
  } else {
    value.reviews.forEach((review, reviewIndex) => validatePostDecisionReview(review, `${field}.reviews[${reviewIndex}]`, value, requestedSymbol, errors));
  }
  validateSafety(value.safety, `${field}.safety`, errors);
}

function validateRecordedFormalDecision(
  check: Record<string, unknown>, field: string, errors: string[]
): void {
  const formal = validateFormalDecisionState(
    check.formalDecision ?? formalDecisionNotCapturedState(),
    `${field}.formalDecision`
  );
  if (!formal.ok) { errors.push(...formal.errors); return; }
  if (formal.value.availability !== "preserved") return;
  const report = validateResearchReportDecisionState(check.researchReportDecision);
  if (!report.ok || report.value.availability !== "preserved"
    || formal.value.systemRecommendation.reportId !== report.value.binding.reportId
    || formal.value.systemRecommendation.reportVersion !== report.value.binding.reportVersion
    || formal.value.systemRecommendation.reportFingerprint !== report.value.binding.reportFingerprint) {
    errors.push(`${field}.formalDecision recommendation must bind the preserved report`);
  }
  if (formal.value.differsFromSystem !== (formal.value.systemRecommendation.direction !== check.actionIntent)) {
    errors.push(`${field}.formalDecision differsFromSystem must match actionIntent`);
  }
}

function validateContextSnapshot(
  value: unknown,
  field: string,
  check: Record<string, unknown>,
  errors: string[]
): void {
  const snapshotField = `${field}.contextSnapshot`;
  if (!isRecord(value)) {
    errors.push(`${snapshotField} must be an object`);
    return;
  }
  if (value.availability === "preserved") {
    const result = validateDecisionContextEnvelope(value.envelope);
    if (!result.ok) {
      errors.push(...result.errors.map((error) => `${snapshotField}.envelope.${error}`));
      return;
    }
    const envelope = value.envelope as DecisionContextEnvelope;
    if (envelope.schemaVersion !== check.decisionContextSchemaVersion) errors.push(`${snapshotField}.envelope.schemaVersion must match check decisionContextSchemaVersion`);
    if (envelope.contextId !== check.contextId) errors.push(`${snapshotField}.envelope.contextId must match check contextId`);
    if (envelope.contextHash !== check.contextHash) errors.push(`${snapshotField}.envelope.contextHash must match check contextHash`);
    if (envelope.requestedSymbol !== check.symbol) errors.push(`${snapshotField}.envelope.requestedSymbol must match check symbol`);
  } else if (value.availability === "context_snapshot_unavailable") {
    if (value.envelope !== null) errors.push(`${snapshotField}.envelope must be null when unavailable`);
    if (typeof value.limitation !== "string" || !value.limitation.includes("not reconstructed")) {
      errors.push(`${snapshotField}.limitation must disclose no reconstruction`);
    }
  } else {
    errors.push(`${snapshotField}.availability is invalid`);
  }
}

function validatePostDecisionReview(
  value: unknown,
  field: string,
  check: Record<string, unknown> | null,
  requestedSymbol: unknown,
  errors: string[]
): void {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  requireNonEmptyString(value.id, `${field}.id`, errors);
  requireNonEmptyString(value.decisionCheckId, `${field}.decisionCheckId`, errors);
  if (check && value.decisionCheckId !== check.id) errors.push(`${field}.decisionCheckId must match check id`);
  requireNonEmptyString(value.market, `${field}.market`, errors);
  if (check && value.market !== check.market) errors.push(`${field}.market must match check market`);
  requireNonEmptyString(value.code, `${field}.code`, errors);
  if (check && value.code !== check.code) errors.push(`${field}.code must match check code`);
  if (typeof value.market === "string" && typeof value.code === "string" && value.symbol !== `${value.market}.${value.code}`) {
    errors.push(`${field}.symbol must equal canonical market/code identity`);
  }
  if (typeof requestedSymbol === "string" && value.symbol !== requestedSymbol) {
    errors.push(`${field}.symbol must equal requestedSymbol`);
  }
  if (check && value.symbol !== check.symbol) errors.push(`${field}.symbol must match check symbol`);
  if (!DECISION_REVIEW_OUTCOMES.includes(value.outcome as DecisionReviewOutcome)) errors.push(`${field}.outcome is invalid`);
  validateOptionalString(value.outcomeEvidence, `${field}.outcomeEvidence`, errors);
  validateOptionalString(value.reviewNote, `${field}.reviewNote`, errors);
  requireNonEmptyString(value.reviewedAt, `${field}.reviewedAt`, errors);
  validateDateTime(value.reviewedAt, `${field}.reviewedAt`, errors);
  requireNonEmptyString(value.createdAt, `${field}.createdAt`, errors);
  validateDateTime(value.createdAt, `${field}.createdAt`, errors);
  validatePortfolioReview(value.portfolioReview, field, check, errors);
  const learningValidation = validateAnnualReviewLearningState(
    value.reviewLearning ?? annualReviewLearningNotCapturedState(),
    check && typeof check.id === "string" ? check.id : undefined,
    check?.decisionSnapshot as DecisionSnapshotState | undefined,
    check?.conditionalDecision as AnnualConditionalDecisionState | undefined
  );
  if (!learningValidation.ok) errors.push(...learningValidation.errors.map((error) => `${field}.${error}`));
  validateReviewAudit(value.audit, `${field}.audit`, errors);
  validateSafety(value.safety, `${field}.safety`, errors);
}

function validatePortfolioReview(
  value: unknown,
  field: string,
  check: Record<string, unknown> | null,
  errors: string[]
): void {
  const validation = validatePostDecisionPortfolioReviewStateStructure(value);
  if (!validation.ok) {
    errors.push(...validation.errors.map((error) => `${field}.${error}`));
    return;
  }
  if (validation.value.availability !== "preserved" || !validation.value.snapshot) return;
  const snapshot = validation.value.snapshot;
  if (check && snapshot.decisionCheckId !== check.id) errors.push(`${field}.portfolioReview decisionCheckId must match check id`);
  if (check && snapshot.candidateSymbol !== check.symbol) errors.push(`${field}.portfolioReview candidateSymbol must match check symbol`);
  if (!check) return;
  const decisionValidation = validateDecisionSnapshotStateStructure(check.decisionSnapshot);
  if (!decisionValidation.ok || decisionValidation.value.availability !== "preserved" || !decisionValidation.value.snapshot) {
    errors.push(`${field}.portfolioReview preserved comparison requires a preserved decision snapshot`);
    return;
  }
  const decision = decisionValidation.value.snapshot;
  const decisionPortfolio = decision.portfolioContext.envelope;
  if (snapshot.decisionSnapshotId !== decision.snapshotId) errors.push(`${field}.portfolioReview decisionSnapshotId must match check decision snapshot`);
  if (!decisionPortfolio) {
    errors.push(`${field}.portfolioReview requires preserved decision-time portfolio facts`);
    return;
  }
  const reference = snapshot.comparison.decisionTime;
  if (reference.state !== decision.portfolioContext.state
    || reference.contextId !== decisionPortfolio.contextId
    || reference.portfolioSnapshotId !== decisionPortfolio.portfolioSnapshotId
    || reference.accountScopeId !== decisionPortfolio.accountScopeId
    || reference.portfolioAsOf !== decisionPortfolio.portfolioAsOf
    || reference.assembledAt !== decisionPortfolio.assembledAt) {
    errors.push(`${field}.portfolioReview decision-time comparison reference must match preserved decision facts`);
  }
}

function validateReviewAudit(value: unknown, field: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  if (!DECISION_REVIEW_AUDIT_ACTOR_TYPES.includes(value.actorType as (typeof DECISION_REVIEW_AUDIT_ACTOR_TYPES)[number])) {
    errors.push(`${field}.actorType must be user, system, migration, or test`);
  }
  validateOptionalString(value.actorId, `${field}.actorId`, errors);
  if (typeof value.actorId === "string" && value.actorId.trim().length === 0) {
    errors.push(`${field}.actorId must be non-empty when present`);
  }
  requireNonEmptyString(value.idempotencyKey, `${field}.idempotencyKey`, errors);
  validateOptionalString(value.correlationId, `${field}.correlationId`, errors);
  if (typeof value.correlationId === "string" && value.correlationId.trim().length === 0) {
    errors.push(`${field}.correlationId must be non-empty when present`);
  }
}

function validateWriteSource(value: unknown, field: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  if (!DECISION_REVIEW_AUDIT_ACTOR_TYPES.includes(value.actorType as (typeof DECISION_REVIEW_AUDIT_ACTOR_TYPES)[number])) {
    errors.push(`${field}.actorType must be user, system, migration, or test`);
  }
  validateOptionalString(value.actorId, `${field}.actorId`, errors);
  if (typeof value.actorId === "string" && value.actorId.trim().length === 0) {
    errors.push(`${field}.actorId must be non-empty when present`);
  }
  validateOptionalString(value.correlationId, `${field}.correlationId`, errors);
  if (typeof value.correlationId === "string" && value.correlationId.trim().length === 0) {
    errors.push(`${field}.correlationId must be non-empty when present`);
  }
}

function validateDateTime(value: unknown, field: string, errors: string[]): void {
  if (typeof value === "string" && !Number.isFinite(Date.parse(value))) {
    errors.push(`${field} must be a valid date-time`);
  }
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${field} must be a non-empty string`);
}

function validateOptionalString(value: unknown, field: string, errors: string[]): void {
  if (value !== undefined && value !== null && typeof value !== "string") errors.push(`${field} must be a string or null`);
}

function rejectUnknownKeys(value: Record<string, unknown>, label: string, allowedKeys: string[], errors: string[]): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
