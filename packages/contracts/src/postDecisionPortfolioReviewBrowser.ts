import { canonicalJson } from "./decisionContextBrowser.js";
import { validateDecisionSnapshotStateForBrowser } from "./decisionSnapshotBrowser.js";
import type { DecisionSnapshotState } from "./decisionSnapshotContract.js";
import { validatePortfolioDecisionContextForBrowser, type PortfolioDecisionContextEnvelope } from "./portfolioDecisionContextBrowser.js";
import {
  buildPostDecisionPortfolioComparisonHashInput,
  postDecisionPortfolioComparisonIdentityInput
} from "./postDecisionPortfolioComparison.js";
import {
  POST_DECISION_PORTFOLIO_REVIEW_SCHEMA_VERSION,
  portfolioIdentityBindingFromContext,
  validatePostDecisionPortfolioReviewBinding,
  validatePostDecisionPortfolioReviewStateStructure,
  type PostDecisionPortfolioComparison,
  type PostDecisionPortfolioReviewBinding,
  type PostDecisionPortfolioReviewState
} from "./postDecisionPortfolioReviewContract.js";

export * from "./postDecisionPortfolioReviewContract.js";
export * from "./postDecisionPortfolioComparison.js";

export async function buildPostDecisionPortfolioReviewBindingForBrowser(
  decisionCheckId: string,
  decisionSnapshot: DecisionSnapshotState,
  reviewTime: PortfolioDecisionContextEnvelope
): Promise<PostDecisionPortfolioReviewBinding> {
  const decisionValidation = await validateDecisionSnapshotStateForBrowser(decisionSnapshot);
  const reviewValidation = await validatePortfolioDecisionContextForBrowser(reviewTime);
  if (!decisionValidation.ok) throw new Error(decisionValidation.errors.join("; "));
  if (!reviewValidation.ok) throw new Error(reviewValidation.errors.join("; "));
  if (decisionValidation.value.availability !== "preserved" || !decisionValidation.value.snapshot) throw new Error("preserved decision snapshot is required for portfolio review binding");
  const snapshot = decisionValidation.value.snapshot;
  const decisionTime = snapshot.portfolioContext.envelope;
  if (!decisionTime || !["available", "stale", "partial", "zero_position"].includes(decisionTime.status)) throw new Error("preserved decision-time position facts are required for portfolio review binding");
  if (decisionTime.accountScopeId !== reviewTime.accountScopeId) throw new Error("portfolio review cannot compare across account scopes");
  const comparisonInput = buildPostDecisionPortfolioComparisonHashInput(decisionTime, reviewTime, snapshot.candidateSymbol);
  const comparisonId = `post-decision-portfolio-comparison:${await sha256Hex(canonicalJson(postDecisionPortfolioComparisonIdentityInput(comparisonInput)))}`;
  const binding: PostDecisionPortfolioReviewBinding = {
    schemaVersion: POST_DECISION_PORTFOLIO_REVIEW_SCHEMA_VERSION,
    decisionCheckId,
    decisionSnapshotId: snapshot.snapshotId,
    candidateSymbol: snapshot.candidateSymbol,
    decisionTimePortfolio: portfolioIdentityBindingFromContext(decisionTime),
    reviewTimePortfolio: portfolioIdentityBindingFromContext(reviewTime),
    comparison: { calculationVersion: comparisonInput.calculationVersion, comparisonId }
  };
  const bindingValidation = validatePostDecisionPortfolioReviewBinding(binding);
  if (!bindingValidation.ok) throw new Error(bindingValidation.errors.join("; "));
  return binding;
}

export async function validatePostDecisionPortfolioReviewStateForBrowser(
  value: unknown,
  decisionSnapshot?: DecisionSnapshotState,
  expectedCheckId?: string,
  expectedSymbol?: string
): Promise<{ ok: true; value: PostDecisionPortfolioReviewState } | { ok: false; errors: string[] }> {
  const structure = validatePostDecisionPortfolioReviewStateStructure(value);
  if (!structure.ok || structure.value.availability !== "preserved" || !structure.value.snapshot) return structure;
  const errors: string[] = [];
  const snapshot = structure.value.snapshot;
  const reviewValidation = await validatePortfolioDecisionContextForBrowser(snapshot.reviewTimePortfolio.envelope);
  if (!reviewValidation.ok) errors.push(...reviewValidation.errors.map((error) => `portfolioReview.snapshot.reviewTimePortfolio.envelope.${error}`));
  if (expectedCheckId !== undefined && snapshot.decisionCheckId !== expectedCheckId) errors.push("portfolio review decisionCheckId must match its review record");
  if (expectedSymbol !== undefined && snapshot.candidateSymbol !== expectedSymbol) errors.push("portfolio review candidateSymbol must match its review record");
  if (decisionSnapshot) await validateAgainstDecisionSnapshot(snapshot, decisionSnapshot, errors);
  try {
    const { snapshotId: _snapshotId, ...input } = snapshot;
    const expected = `post-decision-portfolio-review:${await sha256Hex(canonicalJson(input))}`;
    if (snapshot.snapshotId !== expected) errors.push("portfolio review snapshotId does not match canonical content");
  } catch {
    errors.push("portfolio review canonical SHA-256 validation failed");
  }
  return errors.length === 0 ? structure : { ok: false, errors };
}

async function validateAgainstDecisionSnapshot(
  review: NonNullable<PostDecisionPortfolioReviewState["snapshot"]>,
  decisionState: DecisionSnapshotState,
  errors: string[]
): Promise<void> {
  const validation = await validateDecisionSnapshotStateForBrowser(decisionState);
  if (!validation.ok || validation.value.availability !== "preserved" || !validation.value.snapshot) {
    errors.push("preserved portfolio review requires a valid preserved decision snapshot");
    return;
  }
  const decision = validation.value.snapshot;
  const decisionTime = decision.portfolioContext.envelope;
  if (!decisionTime || !["available", "stale", "partial", "zero_position"].includes(decisionTime.status)) {
    errors.push("preserved portfolio review requires decision-time position facts");
    return;
  }
  if (review.decisionSnapshotId !== decision.snapshotId || review.candidateSymbol !== decision.candidateSymbol) errors.push("portfolio review must bind the exact decision snapshot and candidate");
  if (review.reviewTimePortfolio.envelope.accountScopeId !== decisionTime.accountScopeId) errors.push("portfolio review cannot compare across account scopes");
  const input = buildPostDecisionPortfolioComparisonHashInput(decisionTime, review.reviewTimePortfolio.envelope, decision.candidateSymbol);
  const expected: PostDecisionPortfolioComparison = {
    ...input,
    comparisonId: `post-decision-portfolio-comparison:${await sha256Hex(canonicalJson(postDecisionPortfolioComparisonIdentityInput(input)))}`
  };
  if (canonicalJson(review.comparison) !== canonicalJson(expected)) errors.push("portfolio review neutral comparison does not match preserved facts");
}

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
