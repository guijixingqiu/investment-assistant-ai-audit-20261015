import {
  validateAnnualConditionalDecisionStateStructure,
  type AnnualConditionalDecisionMonitor,
  type AnnualConditionalDecisionState
} from "./annualConditionalDecisionContract.js";
import {
  validateDecisionSnapshotStateStructure,
  type DecisionSnapshotState
} from "./decisionSnapshotContract.js";
import { canonicalJson } from "./decisionContextBrowser.js";

export const ANNUAL_REVIEW_LEARNING_SCHEMA_VERSION = "2026-07-17.annual-review-learning.v1";

export interface AnnualConditionalReviewLearningRequest {
  kind?: never;
  schemaVersion: typeof ANNUAL_REVIEW_LEARNING_SCHEMA_VERSION;
  decisionCheckId: string;
  decisionSnapshotId: string;
  conditionalPreviewId: string;
  judgmentCorrection: string;
  processLesson: string;
  nextResearchQuestion: string | null;
}

export interface AnnualManualReviewLearningRequest {
  schemaVersion: typeof ANNUAL_REVIEW_LEARNING_SCHEMA_VERSION;
  kind: "ordinary_manual";
  decisionCheckId: string;
  membershipId: string;
  membershipVersion: number;
  judgmentCorrection: string;
  processLesson: string;
  nextResearchQuestion: string | null;
}

export type AnnualReviewLearningRequest = AnnualConditionalReviewLearningRequest | AnnualManualReviewLearningRequest;

export interface AnnualConditionalReviewLearningSnapshot extends AnnualConditionalReviewLearningRequest {
  reviewedFactsAt: string;
  monitor: AnnualConditionalDecisionMonitor;
}
export type AnnualReviewLearningSnapshot = AnnualConditionalReviewLearningSnapshot | AnnualManualReviewLearningRequest;

export type AnnualReviewLearningState =
  | { availability: "preserved"; snapshot: AnnualConditionalReviewLearningSnapshot; limitation: string }
  | { availability: "ordinary_manual_preserved"; snapshot: AnnualManualReviewLearningRequest; limitation: string }
  | { availability: "review_learning_not_captured"; snapshot: null; limitation: string };

export function annualReviewLearningNotCapturedState(): AnnualReviewLearningState {
  return {
    availability: "review_learning_not_captured",
    snapshot: null,
    limitation: "This historical review-learning snapshot was not captured and is not reconstructed from current decision, candidate, research, quant, portfolio, or risk facts."
  };
}

export function validateAnnualReviewLearningRequest(value: unknown):
  | { ok: true; value: AnnualReviewLearningRequest }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["reviewLearning must be an object"] };
  if (value.kind === "ordinary_manual") {
    exactKeys(value, [
      "schemaVersion", "kind", "decisionCheckId", "membershipId", "membershipVersion",
      "judgmentCorrection", "processLesson", "nextResearchQuestion"
    ], "reviewLearning", errors);
    if (value.schemaVersion !== ANNUAL_REVIEW_LEARNING_SCHEMA_VERSION) errors.push("reviewLearning.schemaVersion is invalid");
    positiveId(value.decisionCheckId, "reviewLearning.decisionCheckId", errors);
    positiveId(value.membershipId, "reviewLearning.membershipId", errors);
    if (!Number.isSafeInteger(value.membershipVersion) || Number(value.membershipVersion) < 1)
      errors.push("reviewLearning.membershipVersion must be a positive integer");
    boundedText(value.judgmentCorrection, "reviewLearning.judgmentCorrection", true, errors);
    boundedText(value.processLesson, "reviewLearning.processLesson", true, errors);
    boundedText(value.nextResearchQuestion, "reviewLearning.nextResearchQuestion", false, errors);
    if (value.nextResearchQuestion === "") errors.push("reviewLearning.nextResearchQuestion must be null when no question was saved");
    return errors.length === 0
      ? { ok: true, value: value as unknown as AnnualManualReviewLearningRequest }
      : { ok: false, errors };
  }
  exactKeys(value, [
    "schemaVersion", "decisionCheckId", "decisionSnapshotId", "conditionalPreviewId",
    "judgmentCorrection", "processLesson", "nextResearchQuestion"
  ], "reviewLearning", errors);
  if (value.schemaVersion !== ANNUAL_REVIEW_LEARNING_SCHEMA_VERSION) {
    errors.push(`reviewLearning.schemaVersion must be ${ANNUAL_REVIEW_LEARNING_SCHEMA_VERSION}`);
  }
  positiveId(value.decisionCheckId, "reviewLearning.decisionCheckId", errors);
  contentId(value.decisionSnapshotId, "decision-snapshot", "reviewLearning.decisionSnapshotId", errors);
  contentId(value.conditionalPreviewId, "annual-conditional-preview", "reviewLearning.conditionalPreviewId", errors);
  boundedText(value.judgmentCorrection, "reviewLearning.judgmentCorrection", true, errors);
  boundedText(value.processLesson, "reviewLearning.processLesson", true, errors);
  boundedText(value.nextResearchQuestion, "reviewLearning.nextResearchQuestion", false, errors);
  return errors.length === 0
    ? { ok: true, value: value as unknown as AnnualReviewLearningRequest }
    : { ok: false, errors };
}

export function validateAnnualReviewLearningState(
  value: unknown,
  decisionCheckId?: string,
  decisionSnapshot?: DecisionSnapshotState,
  conditionalDecision?: AnnualConditionalDecisionState
): { ok: true; value: AnnualReviewLearningState } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["reviewLearning must be an object"] };
  exactKeys(value, ["availability", "snapshot", "limitation"], "reviewLearning", errors);
  nonEmpty(value.limitation, "reviewLearning.limitation", errors);
  if (value.availability === "review_learning_not_captured") {
    if (value.snapshot !== null) errors.push("not-captured reviewLearning must clear snapshot");
    if (typeof value.limitation !== "string" || !value.limitation.includes("not reconstructed")) {
      errors.push("not-captured reviewLearning must disclose no reconstruction");
    }
  } else if (value.availability === "preserved") {
    if (isRecord(value.snapshot) && value.snapshot.kind === "ordinary_manual")
      errors.push("conditional review learning cannot contain a manual snapshot");
    validateAnnualReviewLearningSnapshot(value.snapshot, decisionCheckId, decisionSnapshot, conditionalDecision, errors);
  } else if (value.availability === "ordinary_manual_preserved") {
    if (!isRecord(value.snapshot) || value.snapshot.kind !== "ordinary_manual")
      errors.push("manual review learning requires a manual snapshot");
    validateAnnualReviewLearningSnapshot(value.snapshot, decisionCheckId, undefined, undefined, errors);
  } else {
    errors.push("reviewLearning.availability is invalid");
  }
  return errors.length === 0
    ? { ok: true, value: value as unknown as AnnualReviewLearningState }
    : { ok: false, errors };
}

export function captureAnnualReviewLearningState(
  request: AnnualConditionalReviewLearningRequest,
  monitor: AnnualConditionalDecisionMonitor,
  decisionSnapshot: DecisionSnapshotState,
  conditionalDecision: AnnualConditionalDecisionState
): AnnualReviewLearningState {
  const state: AnnualReviewLearningState = {
    availability: "preserved",
    snapshot: { ...request, reviewedFactsAt: monitor.evaluatedAt, monitor },
    limitation: "This append-only learning record preserves the user correction, process lesson, and authoritative factual monitor at review time; it does not score, recommend, rank, transition, or execute an investment decision."
  };
  const validation = validateAnnualReviewLearningState(
    state,
    request.decisionCheckId,
    decisionSnapshot,
    conditionalDecision
  );
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  return validation.value;
}

export function captureManualReviewLearningState(request: AnnualManualReviewLearningRequest): AnnualReviewLearningState {
  const state: AnnualReviewLearningState = {
    availability: "ordinary_manual_preserved",
    snapshot: request,
    limitation: "This is human-authored learning from an ordinary manual review. It is not a verified financial fact, report decision, conditional monitor, score, recommendation, or trade."
  };
  const validation = validateAnnualReviewLearningState(state, request.decisionCheckId);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  return validation.value;
}

export function annualReviewLearningMatchesRequest(
  state: AnnualReviewLearningState,
  request: AnnualReviewLearningRequest
): boolean {
  const snapshot = state.snapshot;
  return state.availability === (request.kind === "ordinary_manual" ? "ordinary_manual_preserved" : "preserved")
    && snapshot !== null
    && canonicalJson(snapshotRequest(snapshot)) === canonicalJson(request);
}

function snapshotRequest(snapshot: AnnualReviewLearningSnapshot): AnnualReviewLearningRequest {
  if (snapshot.kind === "ordinary_manual") return snapshot;
  const { reviewedFactsAt: _reviewedFactsAt, monitor: _monitor, ...request } = snapshot;
  return request;
}

function validateAnnualReviewLearningSnapshot(
  value: unknown,
  expectedCheckId: string | undefined,
  decisionSnapshot: DecisionSnapshotState | undefined,
  conditionalDecision: AnnualConditionalDecisionState | undefined,
  errors: string[]
): void {
  if (!isRecord(value)) {
    errors.push("preserved reviewLearning requires snapshot");
    return;
  }
  if (value.kind === "ordinary_manual") {
    exactKeys(value, [
      "schemaVersion", "kind", "decisionCheckId", "membershipId", "membershipVersion",
      "judgmentCorrection", "processLesson", "nextResearchQuestion"
    ], "reviewLearning.snapshot", errors);
    const requestValidation = validateAnnualReviewLearningRequest(value);
    if (!requestValidation.ok) errors.push(...requestValidation.errors);
    if (expectedCheckId !== undefined && value.decisionCheckId !== expectedCheckId)
      errors.push("reviewLearning snapshot must match decision check id");
    return;
  }
  exactKeys(value, [
    "schemaVersion", "decisionCheckId", "decisionSnapshotId", "conditionalPreviewId",
    "judgmentCorrection", "processLesson", "nextResearchQuestion", "reviewedFactsAt", "monitor"
  ], "reviewLearning.snapshot", errors);
  const requestValidation = validateAnnualReviewLearningRequest({
    schemaVersion: value.schemaVersion,
    decisionCheckId: value.decisionCheckId,
    decisionSnapshotId: value.decisionSnapshotId,
    conditionalPreviewId: value.conditionalPreviewId,
    judgmentCorrection: value.judgmentCorrection,
    processLesson: value.processLesson,
    nextResearchQuestion: value.nextResearchQuestion
  });
  if (!requestValidation.ok) errors.push(...requestValidation.errors);
  isoInstant(value.reviewedFactsAt, "reviewLearning.snapshot.reviewedFactsAt", errors);
  validateMonitorStructure(value.monitor, errors);
  if (expectedCheckId === undefined && decisionSnapshot === undefined && conditionalDecision === undefined) return;

  if (expectedCheckId !== undefined && value.decisionCheckId !== expectedCheckId) {
    errors.push("reviewLearning snapshot must match decision check id");
  }
  const decisionValidation = validateDecisionSnapshotStateStructure(decisionSnapshot);
  const conditionalValidation = validateAnnualConditionalDecisionStateStructure(conditionalDecision);
  const expectedSnapshotId = decisionValidation.ok && decisionValidation.value.availability === "preserved"
    ? decisionValidation.value.snapshot?.snapshotId
    : null;
  const expectedPreviewId = conditionalValidation.ok && conditionalValidation.value.availability === "preserved"
    ? conditionalValidation.value.preview?.previewId
    : null;
  if (!expectedSnapshotId || value.decisionSnapshotId !== expectedSnapshotId) {
    errors.push("reviewLearning snapshot must bind the preserved immutable decision snapshot");
  }
  if (!expectedPreviewId || value.conditionalPreviewId !== expectedPreviewId) {
    errors.push("reviewLearning snapshot must bind the preserved conditional preview");
  }
  if (!conditionalValidation.ok || conditionalValidation.value.availability !== "preserved"
    || !conditionalValidation.value.preview || !conditionalValidation.value.judgment) {
    errors.push("reviewLearning snapshot requires a valid preserved conditional decision");
    return;
  }
  const candidate = {
    ...conditionalValidation.value,
    monitor: value.monitor
  };
  const monitorValidation = validateAnnualConditionalDecisionStateStructure(candidate);
  if (!monitorValidation.ok) errors.push("reviewLearning monitor must recompute from frozen judgment and recorded current facts");
  if (isRecord(value.monitor) && value.reviewedFactsAt !== value.monitor.evaluatedAt) {
    errors.push("reviewLearning reviewedFactsAt must equal monitor.evaluatedAt");
  }
}

function validateMonitorStructure(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("reviewLearning monitor must be an object");
    return;
  }
  exactKeys(value, [
    "evaluatedAt", "state", "reasons", "changes", "currentFacts", "invalidationReminder",
    "humanReviewRequested", "automaticDecision", "automaticWorkflowTransition", "createsOrder",
    "createsTrade", "callsBroker"
  ], "reviewLearning monitor", errors);
  isoInstant(value.evaluatedAt, "reviewLearning monitor evaluatedAt", errors);
  if (!Array.isArray(value.reasons) || !Array.isArray(value.changes) || !isRecord(value.currentFacts)) {
    errors.push("reviewLearning monitor reasons, changes, and currentFacts are invalid");
  }
  if (!["watching", "human_review_required"].includes(String(value.state))
    || value.invalidationReminder !== "human_observation_required"
    || typeof value.humanReviewRequested !== "boolean"
    || value.automaticDecision !== false || value.automaticWorkflowTransition !== false
    || value.createsOrder !== false || value.createsTrade !== false || value.callsBroker !== false) {
    errors.push("reviewLearning monitor state or safety is invalid");
  }
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string, errors: string[]): void {
  const expectedSet = new Set(expected);
  for (const key of Object.keys(value)) if (!expectedSet.has(key)) errors.push(`${label} contains unsupported field ${key}`);
  for (const key of expected) if (!Object.hasOwn(value, key)) errors.push(`${label} is missing field ${key}`);
}

function positiveId(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) errors.push(`${label} must be a positive integer string`);
}

function contentId(value: unknown, prefix: string, label: string, errors: string[]): void {
  if (typeof value !== "string" || !new RegExp(`^${prefix}:[a-f0-9]{64}$`).test(value)) errors.push(`${label} is invalid`);
}

function boundedText(value: unknown, label: string, required: boolean, errors: string[]): void {
  if (value === null && !required) return;
  if (typeof value !== "string" || value.trim() !== value || value.length < (required ? 1 : 0) || value.length > 4000) {
    errors.push(`${label} must be ${required ? "a non-empty " : "a nullable "}trimmed string of at most 4000 characters`);
  }
}

function nonEmpty(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${label} must be a non-empty string`);
}

function isoInstant(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || !value.endsWith("Z")) errors.push(`${label} must be an ISO instant`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
