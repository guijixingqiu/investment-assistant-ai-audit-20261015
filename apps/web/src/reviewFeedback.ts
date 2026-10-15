import type { DecisionContextEnvelope, PreTradeDecisionCheckData } from "../../../packages/contracts/src/decisionContextBrowser.js";
import type { DecisionReviewHistoryEnvelope, PostDecisionReviewData, RecordedDecisionCheckReviewState } from "../../../packages/contracts/src/decisionReview.js";
import type { PinganSnapshotEnvelope, PinganSnapshotPositionData } from "../../../packages/contracts/src/portfolioSnapshot.js";
import type { StageState } from "./coreJourneyState.js";

export type ReviewFeedbackKind =
  | "review_required"
  | "context_limit"
  | "evidence_conflict"
  | "evidence_gap"
  | "historical_concentration"
  | "portfolio_review_limit"
  | "decision_time_portfolio"
  | "review_time_portfolio"
  | "neutral_portfolio_delta"
  | "review_complete";

export interface ReviewFeedbackItem {
  kind: ReviewFeedbackKind;
  title: string;
  detail: string;
}

export interface ReviewFeedbackCard {
  state: "ready" | "unavailable";
  title: string;
  detail: string;
  items: ReviewFeedbackItem[];
}

export interface ReviewFeedbackInput {
  stages: StageState[];
  symbol: string | null;
  currentDecisionContext?: DecisionContextEnvelope | null;
  submittedCheck: PreTradeDecisionCheckData | null;
  submittedReview: PostDecisionReviewData | null;
  reviewHistory: DecisionReviewHistoryEnvelope | null;
  pingan: PinganSnapshotEnvelope | null;
}

interface CompletedReviewPair {
  check: RecordedDecisionCheckReviewState | PreTradeDecisionCheckData;
  review: PostDecisionReviewData;
  snapshot: RecordedDecisionCheckReviewState["contextSnapshot"] | DecisionContextEnvelope | null | undefined;
}

const FAIL_CLOSED_SEVERITY = ["malformed", "loading", "unauthorized", "conflict", "offline", "unavailable", "not_found"] as const;

export function deriveReviewFeedback(input: ReviewFeedbackInput): ReviewFeedbackCard {
  const blocked = firstFailClosedStage(input.stages);
  if (blocked) {
    return {
      state: "unavailable",
      title: "Review feedback unavailable",
      detail: `Reflective assistance only. ${blocked.message}`,
      items: []
    };
  }

  const pair = selectReviewPair(input);
  if (!pair) {
    return readyCard([item(
      "review_required",
      "Review required",
      "Reflective assistance only. Complete a human check and later review before deriving bounded feedback."
    )]);
  }

  const items: ReviewFeedbackItem[] = [];
  items.push(...portfolioReviewItems(pair));
  if (hasContextLimit(pair.snapshot)) {
    items.push(item(
      "context_limit",
      "Historical context limit",
      "Reflective assistance only. The recorded decision context is historical, unavailable, or stale; missing facts are not reconstructed."
    ));
  }

  const conflict = evidenceConflict(pair);
  if (conflict) {
    items.push(item("evidence_conflict", "Evidence conflict", conflict));
  } else {
    const gap = evidenceGap(pair);
    if (gap) items.push(item("evidence_gap", "Evidence gap", gap));
  }

  const concentration = historicalConcentration(input.symbol, input.pingan);
  if (concentration) {
    items.push(item("historical_concentration", "Historical concentration", concentration));
  }

  if (items.length === 0) {
    items.push(item(
      "review_complete",
      "Review complete",
      "Reflective assistance only. The latest bounded review did not trigger the configured context, evidence, or historical Pingan reminders."
    ));
  }

  return readyCard(items.slice(0, 7));
}

function readyCard(items: ReviewFeedbackItem[]): ReviewFeedbackCard {
  return {
    state: "ready",
    title: "Bounded review feedback",
    detail: "Reflective assistance only. This card is read-only and cannot create orders, trades, cash movement, fees, position changes, broker calls, or portfolio facts.",
    items
  };
}

function selectReviewPair(input: ReviewFeedbackInput): CompletedReviewPair | null {
  if (
    input.submittedCheck &&
    input.submittedReview &&
    input.symbol &&
    input.submittedCheck.symbol === input.symbol &&
    input.submittedReview.symbol === input.symbol &&
    input.submittedReview.decisionCheckId === input.submittedCheck.id
  ) {
    const currentContext = input.currentDecisionContext ?? null;
    const currentContextMatches = Boolean(
      currentContext &&
      input.submittedCheck.decisionContextSchemaVersion === currentContext.schemaVersion &&
      input.submittedCheck.contextId === currentContext.contextId &&
      input.submittedCheck.contextHash === currentContext.contextHash &&
      currentContext.requestedSymbol === input.submittedCheck.symbol
    );
    return {
      check: input.submittedCheck,
      review: input.submittedReview,
      snapshot: currentContextMatches ? currentContext : null
    };
  }

  const candidates: CompletedReviewPair[] = [];
  for (const check of input.reviewHistory?.checks ?? []) {
    if (input.symbol && check.symbol !== input.symbol) continue;
    for (const review of check.reviews) {
      if (review.decisionCheckId !== check.id || review.symbol !== check.symbol) continue;
      candidates.push({ check, review, snapshot: check.contextSnapshot });
    }
  }

  candidates.sort((left, right) =>
    compareDesc(left.review.reviewedAt, right.review.reviewedAt)
    || compareDesc(left.review.id, right.review.id)
    || compareDesc(left.check.checkedAt, right.check.checkedAt)
    || compareDesc(left.check.id, right.check.id)
  );
  return candidates[0] ?? null;
}

function firstFailClosedStage(stages: StageState[]): StageState | null {
  for (const state of FAIL_CLOSED_SEVERITY) {
    const stage = stages.find((candidate) => candidate.state === state);
    if (stage) return stage;
  }
  return null;
}

function hasContextLimit(snapshot: CompletedReviewPair["snapshot"]): boolean {
  if (snapshot === undefined) return false;
  if (!snapshot) return true;
  if ("availability" in snapshot) {
    if (snapshot.availability !== "preserved") return true;
    const envelope = snapshot.envelope as DecisionContextEnvelope | null;
    return hasDecisionContextLimit(envelope);
  }
  return hasDecisionContextLimit(snapshot);
}

function hasDecisionContextLimit(envelope: DecisionContextEnvelope | null): boolean {
  return !envelope || envelope.quote.status !== "fresh" || envelope.research.status !== "available";
}

function evidenceConflict(pair: CompletedReviewPair): string | null {
  if (pair.review.outcome === "thesis_weakened" || pair.review.outcome === "thesis_invalidated") {
    return `Reflective assistance only. The latest review outcome is ${pair.review.outcome}, so the original thesis has bounded contrary evidence.`;
  }
  if (pair.review.outcome === "thesis_confirmed" && pair.check.humanCheckResult === "blocked") {
    return "Reflective assistance only. The latest review confirmed the thesis while the original human check was blocked; keep the conflict visible.";
  }
  return null;
}

function evidenceGap(pair: CompletedReviewPair): string | null {
  if (pair.review.outcome === "insufficient_evidence" || pair.check.humanCheckResult === "needs_more_evidence") {
    return "Reflective assistance only. The latest review or original human check recorded insufficient evidence.";
  }
  return null;
}

function portfolioReviewItems(pair: CompletedReviewPair): ReviewFeedbackItem[] {
  const state = pair.review.portfolioReview;
  if (!state || state.availability !== "preserved" || !state.snapshot) {
    return [item(
      "portfolio_review_limit",
      "Later portfolio comparison not captured",
      "The review remains readable, but no later portfolio facts or deltas are reconstructed from current data."
    )];
  }
  const comparison = state.snapshot.comparison;
  const quantity = comparison.metrics.candidateQuantity;
  const exposure = comparison.metrics.candidateExposure;
  const weight = comparison.metrics.candidateWeight;
  const hhi = comparison.metrics.hhi;
  return [
    item(
      "decision_time_portfolio",
      "Decision-time portfolio facts",
      `${comparison.decisionTime.state}; as of ${comparison.decisionTime.portfolioAsOf ?? "unavailable"}; candidate quantity ${metricValue(quantity.decisionTime)}; immutable decision snapshot ${state.snapshot.decisionSnapshotId}.`
    ),
    item(
      "review_time_portfolio",
      "Later portfolio facts",
      `${comparison.reviewTime.state}; as of ${comparison.reviewTime.portfolioAsOf ?? "unavailable"}; candidate quantity ${metricValue(quantity.reviewTime)}; review snapshot ${state.snapshot.reviewTimePortfolio.envelope.portfolioSnapshotId ?? "unavailable"}.`
    ),
    item(
      "neutral_portfolio_delta",
      "Neutral portfolio deltas",
      `status ${comparison.status}; quantity ${metricDelta(quantity)}; exposure ${metricDelta(exposure)}; weight ${metricDelta(weight)}; HHI ${metricDelta(hhi)}. Cash remains unknown; no causality, performance, decision-quality, or recommendation claim is made.`
    )
  ];
}

function metricValue(value: number | null): string {
  return value === null ? "unavailable" : String(value);
}

function metricDelta(metric: { availability: string; delta: number | null }): string {
  return metric.availability === "comparable" && metric.delta !== null ? String(metric.delta) : "unavailable";
}

function historicalConcentration(symbol: string | null, pingan: PinganSnapshotEnvelope | null): string | null {
  if (!symbol || !pingan || !["available", "stale"].includes(pingan.status) || pingan.dataUse.display !== "allowed_with_warning") return null;
  const matches = pingan.positions.filter((position) => position.symbol === symbol);
  if (matches.length !== 1) return null;
  const position = matches[0];
  if (!finiteWeight(position.currentWeight) || !finiteWeight(position.maxWeight) || position.currentWeight < position.maxWeight) return null;
  return `Reflective assistance only. Last-imported historical Pingan row ${position.sourceRowId} recorded weight ${formatPercent(position.currentWeight)} versus historical limit ${formatPercent(position.maxWeight)} as of ${pingan.sourceAsOf ?? "unknown"}.`;
}

function finiteWeight(value: PinganSnapshotPositionData["currentWeight"]): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function item(kind: ReviewFeedbackKind, title: string, detail: string): ReviewFeedbackItem {
  return { kind, title, detail };
}

function compareDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
