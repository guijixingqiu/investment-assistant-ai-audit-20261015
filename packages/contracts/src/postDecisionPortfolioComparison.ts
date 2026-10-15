import type { PortfolioDecisionContextEnvelope } from "./portfolioDecisionContext.js";
import {
  POST_DECISION_PORTFOLIO_COMPARISON_VERSION,
  POST_DECISION_PORTFOLIO_METRIC_KEYS,
  portfolioReviewStateFromContextStatus,
  postDecisionPortfolioComparisonSafety,
  type PostDecisionPortfolioComparison,
  type PostDecisionPortfolioFactReference,
  type PostDecisionPortfolioNeutralDeltaMetric
} from "./postDecisionPortfolioReviewContract.js";

export type PostDecisionPortfolioComparisonHashInput = Omit<PostDecisionPortfolioComparison, "comparisonId">;
export type PostDecisionPortfolioComparisonIdentityInput = Omit<
  PostDecisionPortfolioComparisonHashInput,
  "decisionTime" | "reviewTime"
> & {
  decisionTime: Omit<PostDecisionPortfolioFactReference, "assembledAt">;
  reviewTime: Omit<PostDecisionPortfolioFactReference, "assembledAt">;
};

export function postDecisionPortfolioComparisonIdentityInput(
  comparison: PostDecisionPortfolioComparisonHashInput
): PostDecisionPortfolioComparisonIdentityInput {
  const {
    decisionTime: { assembledAt: _decisionAssembledAt, ...decisionTime },
    reviewTime: { assembledAt: _reviewAssembledAt, ...reviewTime },
    ...rest
  } = comparison;
  return { ...rest, decisionTime, reviewTime };
}

export function buildPostDecisionPortfolioComparisonHashInput(
  decisionTime: PortfolioDecisionContextEnvelope,
  reviewTime: PortfolioDecisionContextEnvelope,
  candidateSymbol: string
): PostDecisionPortfolioComparisonHashInput {
  const quantityComparable = displayable(decisionTime) && displayable(reviewTime);
  const currentValuationComparable = decisionTime.status === "available" && reviewTime.status === "available";
  const currentTotalExposureComparable = currentTotalExposure(decisionTime) && currentTotalExposure(reviewTime);
  const decisionCandidate = decisionTime.positions.find((position) => position.symbol === candidateSymbol);
  const reviewCandidate = reviewTime.positions.find((position) => position.symbol === candidateSymbol);
  const decisionCandidateExposure = candidateCurrentExposure(decisionTime, candidateSymbol);
  const reviewCandidateExposure = candidateCurrentExposure(reviewTime, candidateSymbol);
  const metrics = {
    candidateQuantity: quantityComparable
      ? metric(decisionCandidate?.quantity ?? 0, reviewCandidate?.quantity ?? 0, 8)
      : unavailableMetric(),
    candidateExposure: metric(decisionCandidateExposure, reviewCandidateExposure, 2),
    candidateWeight: currentValuationComparable
      ? metric(decisionCandidate?.marketWeight ?? 0, reviewCandidate?.marketWeight ?? 0, 8)
      : unavailableMetric(),
    positionCount: quantityComparable
      ? metric(decisionTime.summary.positionCount, reviewTime.summary.positionCount, 0)
      : unavailableMetric(),
    totalExposure: currentTotalExposureComparable
      ? metric(decisionTime.summary.marketValue.amount, reviewTime.summary.marketValue.amount, 2)
      : unavailableMetric(),
    missingQuoteCount: quantityComparable
      ? metric(decisionTime.summary.marketValue.missingPositionCount, reviewTime.summary.marketValue.missingPositionCount, 0)
      : unavailableMetric(),
    nonCurrentQuoteCount: quantityComparable
      ? metric(nonCurrentQuoteCount(decisionTime), nonCurrentQuoteCount(reviewTime), 0)
      : unavailableMetric(),
    largestPositionWeight: currentValuationComparable
      ? metric(decisionTime.summary.concentration.largestPositionWeight, reviewTime.summary.concentration.largestPositionWeight, 8)
      : unavailableMetric(),
    topThreeWeight: currentValuationComparable
      ? metric(decisionTime.summary.concentration.topThreeWeight, reviewTime.summary.concentration.topThreeWeight, 8)
      : unavailableMetric(),
    hhi: currentValuationComparable
      ? metric(decisionTime.summary.concentration.hhi, reviewTime.summary.concentration.hhi, 8)
      : unavailableMetric()
  } satisfies PostDecisionPortfolioComparison["metrics"];
  const comparableCount = POST_DECISION_PORTFOLIO_METRIC_KEYS.filter((key) => metrics[key].availability === "comparable").length;
  return {
    calculationVersion: POST_DECISION_PORTFOLIO_COMPARISON_VERSION,
    status: comparableCount === POST_DECISION_PORTFOLIO_METRIC_KEYS.length
      ? "comparable"
      : comparableCount > 0 ? "partial" : "unavailable",
    candidateSymbol,
    decisionTime: factReference(decisionTime),
    reviewTime: factReference(reviewTime),
    metrics,
    cash: {
      status: "unknown",
      decisionTime: null,
      reviewTime: null,
      delta: null,
      reason: "not_provided_by_authoritative_snapshot"
    },
    gaps: comparisonGaps(decisionTime, reviewTime, candidateSymbol, currentValuationComparable),
    safety: postDecisionPortfolioComparisonSafety()
  };
}

function factReference(context: PortfolioDecisionContextEnvelope): PostDecisionPortfolioFactReference {
  return {
    state: portfolioReviewStateFromContextStatus(context.status),
    contextId: context.contextId,
    portfolioSnapshotId: context.portfolioSnapshotId,
    accountScopeId: context.accountScopeId,
    portfolioAsOf: context.portfolioAsOf,
    assembledAt: context.assembledAt
  };
}

function metric(
  decisionTime: number | null,
  reviewTime: number | null,
  precision: number
): PostDecisionPortfolioNeutralDeltaMetric {
  if (!finite(decisionTime) || !finite(reviewTime)) return unavailableMetric();
  return {
    availability: "comparable",
    decisionTime,
    reviewTime,
    delta: round(reviewTime - decisionTime, precision)
  };
}

function unavailableMetric(): PostDecisionPortfolioNeutralDeltaMetric {
  return { availability: "unavailable", decisionTime: null, reviewTime: null, delta: null };
}

function comparisonGaps(
  decisionTime: PortfolioDecisionContextEnvelope,
  reviewTime: PortfolioDecisionContextEnvelope,
  candidateSymbol: string,
  currentValuationComparable: boolean
): string[] {
  const gaps = ["Cash is unknown at decision and review time because the authoritative snapshot does not provide cash facts."];
  if (decisionTime.status !== "available") gaps.push(`Decision-time portfolio state is ${portfolioReviewStateFromContextStatus(decisionTime.status)}; ${unavailableValuationDimensions(decisionTime)} deltas are unavailable.`);
  if (reviewTime.status !== "available") gaps.push(`Review-time portfolio state is ${portfolioReviewStateFromContextStatus(reviewTime.status)}; ${unavailableValuationDimensions(reviewTime)} deltas are unavailable.`);
  if (decisionTime.summary.marketValue.missingPositionCount > 0) gaps.push(`Decision-time facts have ${decisionTime.summary.marketValue.missingPositionCount} position quote gap(s).`);
  if (reviewTime.summary.marketValue.missingPositionCount > 0) gaps.push(`Review-time facts have ${reviewTime.summary.marketValue.missingPositionCount} position quote gap(s).`);
  const decisionNonCurrent = nonCurrentQuoteCount(decisionTime);
  const reviewNonCurrent = nonCurrentQuoteCount(reviewTime);
  if (decisionNonCurrent > 0) gaps.push(`Decision-time facts have ${decisionNonCurrent} non-current Futu quote(s).`);
  if (reviewNonCurrent > 0) gaps.push(`Review-time facts have ${reviewNonCurrent} non-current Futu quote(s).`);
  const decisionSymbols = new Set(decisionTime.positions.map((position) => position.symbol));
  const reviewSymbols = new Set(reviewTime.positions.map((position) => position.symbol));
  const absentAtReview = [...decisionSymbols].filter((symbol) => !reviewSymbols.has(symbol)).sort();
  const absentAtDecision = [...reviewSymbols].filter((symbol) => !decisionSymbols.has(symbol)).sort();
  if (absentAtReview.length > 0) gaps.push(`Position symbol(s) present only at decision time: ${absentAtReview.join(", ")}.`);
  if (absentAtDecision.length > 0) gaps.push(`Position symbol(s) present only at review time: ${absentAtDecision.join(", ")}.`);
  if (displayable(decisionTime) && !decisionTime.positions.some((position) => position.symbol === candidateSymbol)) gaps.push("The candidate is absent from the complete decision-time position set and is represented as zero quantity only for neutral comparison.");
  if (displayable(reviewTime) && !reviewTime.positions.some((position) => position.symbol === candidateSymbol)) gaps.push("The candidate is absent from the complete review-time position set and is represented as zero quantity only for neutral comparison.");
  if (decisionTime.portfolioSnapshotId !== null && decisionTime.portfolioSnapshotId === reviewTime.portfolioSnapshotId) gaps.push("The review-time Pingan portfolio snapshot identity is unchanged from decision time; zero deltas do not prove decision impact or quality.");
  if (!currentValuationComparable && gaps.length === 1) gaps.push("Current complete valuation facts are unavailable for one or both fact sets.");
  return gaps;
}

function nonCurrentQuoteCount(context: PortfolioDecisionContextEnvelope): number {
  return context.positions.filter((position) => position.quote.status !== "current").length;
}

function candidateCurrentExposure(
  context: PortfolioDecisionContextEnvelope,
  candidateSymbol: string
): number | null {
  if (context.status !== "available" && context.status !== "partial" && context.status !== "zero_position") return null;
  const candidate = context.positions.find((position) => position.symbol === candidateSymbol);
  if (!candidate) return 0;
  return candidate.quote.status === "current" && finite(candidate.marketValue)
    ? candidate.marketValue
    : null;
}

function displayable(context: PortfolioDecisionContextEnvelope): boolean {
  return context.status === "available" || context.status === "stale" || context.status === "partial" || context.status === "zero_position";
}

function currentTotalExposure(context: PortfolioDecisionContextEnvelope): boolean {
  return context.status === "available" || context.status === "zero_position";
}

function unavailableValuationDimensions(context: PortfolioDecisionContextEnvelope): string {
  return context.status === "zero_position" ? "weight and concentration" : "complete portfolio valuation, weight, and concentration";
}

function finite(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
