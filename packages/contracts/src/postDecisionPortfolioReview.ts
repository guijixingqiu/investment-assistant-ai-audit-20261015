import crypto from "node:crypto";
import { canonicalJson } from "./decisionContext.js";
import { validateDecisionSnapshotState, type DecisionSnapshotState } from "./decisionSnapshot.js";
import { validatePortfolioDecisionContextEnvelope } from "./portfolioDecisionContext.js";
import {
  buildPostDecisionPortfolioComparisonHashInput,
  postDecisionPortfolioComparisonIdentityInput,
  type PostDecisionPortfolioComparisonHashInput
} from "./postDecisionPortfolioComparison.js";
import {
  POST_DECISION_PORTFOLIO_REVIEW_SCHEMA_VERSION,
  portfolioIdentityBindingFromContext,
  portfolioReviewNotCapturedState,
  postDecisionPortfolioReviewSafety,
  validatePostDecisionPortfolioReviewBinding,
  validatePostDecisionPortfolioReviewStateStructure,
  type PostDecisionPortfolioComparison,
  type PostDecisionPortfolioReviewBinding,
  type PostDecisionPortfolioReviewSnapshot,
  type PostDecisionPortfolioReviewState
} from "./postDecisionPortfolioReviewContract.js";

export * from "./postDecisionPortfolioReviewContract.js";
export * from "./postDecisionPortfolioComparison.js";

export type PostDecisionPortfolioReviewSnapshotHashInput = Omit<PostDecisionPortfolioReviewSnapshot, "snapshotId">;

export function computePostDecisionPortfolioComparisonId(input: PostDecisionPortfolioComparisonHashInput): string {
  return `post-decision-portfolio-comparison:${sha256(canonicalJson(postDecisionPortfolioComparisonIdentityInput(input)))}`;
}

export function computePostDecisionPortfolioReviewSnapshotId(input: PostDecisionPortfolioReviewSnapshotHashInput): string {
  return `post-decision-portfolio-review:${sha256(canonicalJson(input))}`;
}

export function buildPostDecisionPortfolioComparison(
  decisionTime: Parameters<typeof buildPostDecisionPortfolioComparisonHashInput>[0],
  reviewTime: Parameters<typeof buildPostDecisionPortfolioComparisonHashInput>[1],
  candidateSymbol: string
): PostDecisionPortfolioComparison {
  const input = buildPostDecisionPortfolioComparisonHashInput(decisionTime, reviewTime, candidateSymbol);
  return { ...input, comparisonId: computePostDecisionPortfolioComparisonId(input) };
}

export function postDecisionPortfolioReviewSnapshotHashInput(
  snapshot: PostDecisionPortfolioReviewSnapshot
): PostDecisionPortfolioReviewSnapshotHashInput {
  const { snapshotId: _snapshotId, ...input } = snapshot;
  return input;
}

export function buildPostDecisionPortfolioReviewBinding(
  decisionCheckId: string,
  decisionSnapshot: DecisionSnapshotState,
  reviewTime: Parameters<typeof buildPostDecisionPortfolioComparisonHashInput>[1]
): PostDecisionPortfolioReviewBinding {
  const decisionValidation = validateDecisionSnapshotState(decisionSnapshot);
  if (!decisionValidation.ok || decisionValidation.value.availability !== "preserved" || !decisionValidation.value.snapshot) {
    throw new Error("preserved decision snapshot is required for portfolio review binding");
  }
  const reviewValidation = validatePortfolioDecisionContextEnvelope(reviewTime);
  if (!reviewValidation.ok) throw new Error(reviewValidation.errors.join("; "));
  const snapshot = decisionValidation.value.snapshot;
  const decisionTime = snapshot.portfolioContext.envelope;
  if (!decisionTime || !["available", "stale", "partial", "zero_position"].includes(decisionTime.status)) {
    throw new Error("preserved decision-time position facts are required for portfolio review binding");
  }
  if (decisionTime.accountScopeId !== reviewTime.accountScopeId) {
    throw new Error("portfolio review cannot compare across account scopes");
  }
  const comparison = buildPostDecisionPortfolioComparison(decisionTime, reviewTime, snapshot.candidateSymbol);
  const binding: PostDecisionPortfolioReviewBinding = {
    schemaVersion: POST_DECISION_PORTFOLIO_REVIEW_SCHEMA_VERSION,
    decisionCheckId,
    decisionSnapshotId: snapshot.snapshotId,
    candidateSymbol: snapshot.candidateSymbol,
    decisionTimePortfolio: portfolioIdentityBindingFromContext(decisionTime),
    reviewTimePortfolio: portfolioIdentityBindingFromContext(reviewTime),
    comparison: {
      calculationVersion: comparison.calculationVersion,
      comparisonId: comparison.comparisonId
    }
  };
  const validation = validatePostDecisionPortfolioReviewBinding(binding);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  return binding;
}

export function validatePostDecisionPortfolioReviewState(
  value: unknown,
  decisionSnapshot?: DecisionSnapshotState,
  expectedCheckId?: string,
  expectedSymbol?: string
): { ok: true; value: PostDecisionPortfolioReviewState } | { ok: false; errors: string[] } {
  const structure = validatePostDecisionPortfolioReviewStateStructure(value);
  if (!structure.ok || structure.value.availability !== "preserved" || !structure.value.snapshot) return structure;
  const errors: string[] = [];
  const snapshot = structure.value.snapshot;
  const reviewValidation = validatePortfolioDecisionContextEnvelope(snapshot.reviewTimePortfolio.envelope);
  if (!reviewValidation.ok) errors.push(...reviewValidation.errors.map((error) => `portfolioReview.snapshot.reviewTimePortfolio.envelope.${error}`));
  if (expectedCheckId !== undefined && snapshot.decisionCheckId !== expectedCheckId) errors.push("portfolio review decisionCheckId must match its review record");
  if (expectedSymbol !== undefined && snapshot.candidateSymbol !== expectedSymbol) errors.push("portfolio review candidateSymbol must match its review record");
  if (decisionSnapshot) validateAgainstDecisionSnapshot(snapshot, decisionSnapshot, errors);
  if (snapshot.snapshotId !== computePostDecisionPortfolioReviewSnapshotId(postDecisionPortfolioReviewSnapshotHashInput(snapshot))) {
    errors.push("portfolio review snapshotId does not match canonical content");
  }
  return errors.length === 0 ? structure : { ok: false, errors };
}

export function normalizePostDecisionPortfolioReviewState(value: unknown): PostDecisionPortfolioReviewState {
  const validation = validatePostDecisionPortfolioReviewStateStructure(value);
  return validation.ok ? validation.value : portfolioReviewNotCapturedState();
}

export function assemblePostDecisionPortfolioReviewState(
  decisionCheckId: string,
  decisionSnapshot: DecisionSnapshotState,
  reviewTime: Parameters<typeof buildPostDecisionPortfolioComparisonHashInput>[1],
  capturedAt: string
): PostDecisionPortfolioReviewState {
  const binding = buildPostDecisionPortfolioReviewBinding(decisionCheckId, decisionSnapshot, reviewTime);
  const preserved = decisionSnapshot.snapshot!;
  const comparison = buildPostDecisionPortfolioComparison(
    preserved.portfolioContext.envelope!,
    reviewTime,
    preserved.candidateSymbol
  );
  const input: PostDecisionPortfolioReviewSnapshotHashInput = {
    schemaVersion: POST_DECISION_PORTFOLIO_REVIEW_SCHEMA_VERSION,
    capturedAt,
    decisionCheckId,
    decisionSnapshotId: binding.decisionSnapshotId,
    candidateSymbol: binding.candidateSymbol,
    reviewTimePortfolio: {
      state: binding.reviewTimePortfolio.state as Exclude<typeof binding.reviewTimePortfolio.state, "not_captured">,
      envelope: reviewTime,
      limitation: "These are the exact authorized read-only Pingan portfolio and Futu quote facts re-read at review time; they are not broker reconciliation, accounting, execution, or production authority."
    },
    comparison,
    safety: postDecisionPortfolioReviewSafety()
  };
  const snapshot: PostDecisionPortfolioReviewSnapshot = {
    ...input,
    snapshotId: computePostDecisionPortfolioReviewSnapshotId(input)
  };
  const state: PostDecisionPortfolioReviewState = {
    availability: "preserved",
    snapshot,
    limitation: "Decision-time facts remain immutable; review-time facts and neutral deltas are separately preserved without performance attribution, recommendations, accounting, or execution."
  };
  const validation = validatePostDecisionPortfolioReviewState(state, decisionSnapshot, decisionCheckId, preserved.candidateSymbol);
  if (!validation.ok) throw new Error(`assembled portfolio review failed validation: ${validation.errors.join("; ")}`);
  return state;
}

function validateAgainstDecisionSnapshot(
  review: PostDecisionPortfolioReviewSnapshot,
  decisionState: DecisionSnapshotState,
  errors: string[]
): void {
  const validation = validateDecisionSnapshotState(decisionState);
  if (!validation.ok || validation.value.availability !== "preserved" || !validation.value.snapshot) {
    errors.push("preserved portfolio review requires a valid preserved decision snapshot");
    return;
  }
  const decision = validation.value.snapshot;
  const decisionPortfolio = decision.portfolioContext.envelope;
  if (!decisionPortfolio || !["available", "stale", "partial", "zero_position"].includes(decisionPortfolio.status)) {
    errors.push("preserved portfolio review requires decision-time position facts");
    return;
  }
  if (review.decisionSnapshotId !== decision.snapshotId || review.candidateSymbol !== decision.candidateSymbol) {
    errors.push("portfolio review must bind the exact decision snapshot and candidate");
  }
  if (review.reviewTimePortfolio.envelope.accountScopeId !== decisionPortfolio.accountScopeId) {
    errors.push("portfolio review cannot compare across account scopes");
  }
  const expected = buildPostDecisionPortfolioComparison(decisionPortfolio, review.reviewTimePortfolio.envelope, decision.candidateSymbol);
  if (canonicalJson(review.comparison) !== canonicalJson(expected)) {
    errors.push("portfolio review neutral comparison does not match the preserved decision-time and review-time facts");
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
