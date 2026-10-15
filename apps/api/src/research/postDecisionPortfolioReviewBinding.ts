import type { Pool, PoolClient } from "pg";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContext.js";
import { validateDecisionSnapshotState, type DecisionSnapshotState } from "../../../../packages/contracts/src/decisionSnapshot.js";
import {
  assemblePostDecisionPortfolioReviewState,
  buildPostDecisionPortfolioReviewBinding,
  portfolioReviewNotCapturedState,
  validatePostDecisionPortfolioReviewBinding,
  type PostDecisionPortfolioReviewBinding,
  type PostDecisionPortfolioReviewState
} from "../../../../packages/contracts/src/postDecisionPortfolioReview.js";
import { readAuthorizedPortfolioDecisionContext } from "./authorizedPortfolioDecisionContext.js";
import { PostDecisionPortfolioReviewMismatchError } from "./domain.js";

export interface PostDecisionPortfolioReviewResolutionOptions {
  accountScopeId: string | null;
  pinganCurrentMaxAgeSeconds: number;
  quoteLiveMaxAgeSeconds: number;
  now?: Date;
}

export async function resolvePostDecisionPortfolioReview(
  pool: Pick<Pool | PoolClient, "query">,
  decisionCheckId: string,
  decisionSymbol: string,
  decisionSnapshot: DecisionSnapshotState,
  binding: PostDecisionPortfolioReviewBinding | undefined,
  options: PostDecisionPortfolioReviewResolutionOptions | undefined
): Promise<PostDecisionPortfolioReviewState> {
  if (!binding) return portfolioReviewNotCapturedState();
  const bindingValidation = validatePostDecisionPortfolioReviewBinding(binding);
  if (!bindingValidation.ok) throw new PostDecisionPortfolioReviewMismatchError(bindingValidation.errors.join("; "));
  if (!options?.accountScopeId) throw new PostDecisionPortfolioReviewMismatchError("authorized Pingan account scope is unavailable");

  const decisionValidation = validateDecisionSnapshotState(decisionSnapshot);
  if (!decisionValidation.ok || decisionValidation.value.availability !== "preserved" || !decisionValidation.value.snapshot) {
    throw new PostDecisionPortfolioReviewMismatchError("preserved decision snapshot is unavailable for comparison");
  }
  const preservedDecision = decisionValidation.value.snapshot;
  if (binding.decisionCheckId !== decisionCheckId
    || binding.decisionSnapshotId !== preservedDecision.snapshotId
    || binding.candidateSymbol !== decisionSymbol
    || preservedDecision.candidateSymbol !== decisionSymbol) {
    throw new PostDecisionPortfolioReviewMismatchError("decision check, snapshot, or candidate identity does not match");
  }
  const decisionPortfolio = preservedDecision.portfolioContext.envelope;
  if (!decisionPortfolio || !["available", "stale", "partial", "zero_position"].includes(decisionPortfolio.status)) {
    throw new PostDecisionPortfolioReviewMismatchError("decision-time position facts were not preserved for comparison");
  }
  if (decisionPortfolio.accountScopeId !== options.accountScopeId) {
    throw new PostDecisionPortfolioReviewMismatchError("decision-time portfolio belongs to a different account scope");
  }

  const now = options.now ?? new Date();
  const reviewTime = await readAuthorizedPortfolioDecisionContext(pool, options, now, "review-time portfolio");
  if (reviewTime.accountScopeId !== options.accountScopeId) {
    throw new PostDecisionPortfolioReviewMismatchError("review-time portfolio belongs to a different account scope");
  }

  const expectedBinding = buildPostDecisionPortfolioReviewBinding(decisionCheckId, decisionValidation.value, reviewTime);
  if (canonicalJson(binding) !== canonicalJson(expectedBinding)) {
    throw new PostDecisionPortfolioReviewMismatchError("review-time portfolio identities or neutral comparison no longer match authorized read facts");
  }
  return assemblePostDecisionPortfolioReviewState(
    decisionCheckId,
    decisionValidation.value,
    reviewTime,
    now.toISOString()
  );
}
