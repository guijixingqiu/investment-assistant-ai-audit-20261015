import type { DecisionContextEnvelope, PreTradeDecisionCheckData } from "../../../packages/contracts/src/decisionContextBrowser.js";
import type { DecisionReviewHistoryEnvelope, PostDecisionReviewData, RecordedDecisionCheckReviewState } from "../../../packages/contracts/src/decisionReview.js";
import type { MarketQuoteEnvelope } from "../../../packages/contracts/src/market.js";
import type { PinganSnapshotEnvelope } from "../../../packages/contracts/src/portfolioSnapshot.js";
import type { ResearchProfileEnvelope } from "../../../packages/contracts/src/research.js";
import type { CanonicalSecuritySymbol } from "./securitySymbol.js";

export type StageId = "quote" | "research" | "pingan" | "decision" | "review";
export type StageStateKind = "loading" | "ready" | "limited" | "stale" | "empty" | "unavailable" | "unauthorized" | "not_found" | "conflict" | "malformed" | "offline" | "completed" | "pending";

export interface StageState {
  id: StageId;
  title: string;
  state: StageStateKind;
  message: string;
}

export type CoreJourneyNextActionKind =
  | "fix_symbol"
  | "wait_for_load"
  | "reauthenticate"
  | "resolve_conflict"
  | "retry_load"
  | "refresh_quote"
  | "refresh_research"
  | "continue_with_pingan_limitation"
  | "submit_human_check"
  | "submit_review"
  | "journey_complete";

export type CoreJourneyOperation = "load" | "decision" | "review" | "none";

export interface CoreJourneyNextAction {
  kind: CoreJourneyNextActionKind;
  title: string;
  explanation: string;
  operation: CoreJourneyOperation;
  enabled: boolean;
  sourceStage: StageId | null;
}

export interface CoreJourneyNextActionInput {
  stages: StageState[];
  decisionEnabled: boolean;
  reviewEnabled: boolean;
  loadEnabled: boolean;
}

export interface CoreJourneyData {
  symbol: CanonicalSecuritySymbol;
  quote: MarketQuoteEnvelope | null;
  research: ResearchProfileEnvelope | null;
  decisionContext: DecisionContextEnvelope | null;
  pingan: PinganSnapshotEnvelope | null;
  reviewHistory: DecisionReviewHistoryEnvelope | null;
  submittedCheck: PreTradeDecisionCheckData | null;
  submittedReview: PostDecisionReviewData | null;
}

export function initialStages(state: StageStateKind, message: string): StageState[] {
  return [
    { id: "quote", title: "Quote", state, message },
    { id: "research", title: "Research evidence", state, message },
    { id: "pingan", title: "Pingan historical portfolio context", state, message },
    { id: "decision", title: "Human decision check", state, message },
    { id: "review", title: "Post-decision review", state, message }
  ];
}

export function deriveCoreJourneyStages(data: CoreJourneyData): StageState[] {
  return [
    quoteStage(data.quote),
    researchStage(data.research, data.decisionContext),
    pinganStage(data.pingan),
    decisionStage(data.decisionContext, data.submittedCheck),
    reviewStage(data.reviewHistory, data.submittedCheck, data.submittedReview)
  ];
}

export function deriveCoreJourneyNextAction(input: CoreJourneyNextActionInput): CoreJourneyNextAction {
  const stages = new Map(input.stages.map((stage) => [stage.id, stage]));
  const required = input.stages.filter((stage) => stage.id === "quote" || stage.id === "research");
  const optional = input.stages.filter((stage) => stage.id !== "quote" && stage.id !== "research");
  const first = (candidates: StageState[], ...states: StageStateKind[]) => candidates.find((stage) => states.includes(stage.state));
  const quote = stages.get("quote");
  const research = stages.get("research");
  const pingan = stages.get("pingan");
  const decision = stages.get("decision");
  const review = stages.get("review");

  const malformed = first(required, "malformed");
  if (malformed) return nextAction("fix_symbol", "修正港股标的", malformed.message, "load", input.loadEnabled, malformed.id);

  const loading = first(required, "loading");
  if (loading) return nextAction("wait_for_load", "等待本次读取完成", loading.message, "none", false, loading.id);

  const unauthorized = first(required, "unauthorized");
  if (unauthorized) return nextAction("reauthenticate", "补充本次运行鉴权", unauthorized.message, "load", input.loadEnabled, unauthorized.id);

  const conflict = first(required, "conflict");
  if (conflict) return nextAction("resolve_conflict", "处理冲突后重新读取", conflict.message, "load", input.loadEnabled, conflict.id);

  const unavailable = first(required, "offline", "unavailable", "not_found");
  if (unavailable) return nextAction("retry_load", "重新读取只读研究旅程", unavailable.message, "load", input.loadEnabled, unavailable.id);

  if (quote?.state === "pending" && !input.decisionEnabled) {
    return nextAction("retry_load", "读取当前只读研究旅程", quote.message, "load", input.loadEnabled, "quote");
  }

  if (!quote || quote.state === "stale" || quote.state === "empty") {
    return nextAction("refresh_quote", "刷新行情证据", quote?.message ?? "行情证据缺失。", "load", input.loadEnabled, "quote");
  }

  if (!research || research.state === "stale" || research.state === "empty") {
    return nextAction("refresh_research", "刷新研究证据", research?.message ?? "研究证据缺失。", "load", input.loadEnabled, "research");
  }

  const optionalMalformed = first(optional, "malformed");
  if (optionalMalformed) return nextAction("fix_symbol", "修正当前阶段输入", optionalMalformed.message, "load", input.loadEnabled, optionalMalformed.id);
  const optionalLoading = first(optional, "loading");
  if (optionalLoading) return nextAction("wait_for_load", "等待当前阶段读取完成", optionalLoading.message, "none", false, optionalLoading.id);
  const optionalUnauthorized = first(optional, "unauthorized");
  if (optionalUnauthorized) return nextAction("reauthenticate", "补充本次运行鉴权", optionalUnauthorized.message, "load", input.loadEnabled, optionalUnauthorized.id);
  const optionalConflict = first(optional, "conflict");
  if (optionalConflict) return nextAction("resolve_conflict", "处理冲突后重新读取", optionalConflict.message, "load", input.loadEnabled, optionalConflict.id);
  const optionalUnavailable = first(optional, "offline", "unavailable", "not_found");
  if (optionalUnavailable) return nextAction("retry_load", "重新读取当前阶段", optionalUnavailable.message, "load", input.loadEnabled, optionalUnavailable.id);

  if (pingan && ["limited", "stale", "empty"].includes(pingan.state) && decision?.state === "pending") {
    return nextAction("continue_with_pingan_limitation", "确认平安数据限制后完成人工判断", `${pingan.message} 这不是实时、券商核对后的组合事实，也未获准用于风险影响计算。`, "decision", input.decisionEnabled, "pingan");
  }

  if (decision?.state === "pending") {
    return nextAction("submit_human_check", "提交人工研究判断", decision.message, "decision", input.decisionEnabled, "decision");
  }

  if (review?.state === "pending" || review?.state === "empty") {
    return nextAction("submit_review", "提交判断后复盘", review.message, "review", input.reviewEnabled, "review");
  }

  return nextAction("journey_complete", "本轮研究证据闭环已完成", "五个阶段均已完成或明确受限；这里不会产生交易或组合变更。", "none", false, null);
}

function nextAction(
  kind: CoreJourneyNextActionKind,
  title: string,
  explanation: string,
  operation: CoreJourneyOperation,
  enabled: boolean,
  sourceStage: StageId | null
): CoreJourneyNextAction {
  return { kind, title, explanation, operation, enabled, sourceStage };
}

interface DecisionContextBoundCheck {
  symbol: string;
  decisionContextSchemaVersion: string;
  contextId: string;
  contextHash: string;
}

export function sameDecisionContext(check: DecisionContextBoundCheck | null, context: DecisionContextEnvelope | null): boolean {
  return Boolean(check && context
    && check.symbol === context.requestedSymbol
    && check.decisionContextSchemaVersion === context.schemaVersion
    && check.contextId === context.contextId
    && check.contextHash === context.contextHash);
}

export function currentDecisionContinuity(
  history: DecisionReviewHistoryEnvelope | null,
  context: DecisionContextEnvelope | null
): { check: RecordedDecisionCheckReviewState; review: PostDecisionReviewData | null } | null {
  if (!history || !context || history.requestedSymbol !== context.requestedSymbol
    || history.metadata.freshness !== "fresh" || history.metadata.provenance !== "real"
    || history.metadata.authority !== "decision_context" || history.metadata.stale
    || history.metadata.missing || history.metadata.conflict || history.metadata.fixture) return null;
  const check = history.checks.find((candidate) => sameDecisionContext(candidate, context));
  return check ? { check, review: check.reviews[0] ?? null } : null;
}

function quoteStage(quote: MarketQuoteEnvelope | null): StageState {
  if (!quote) return { id: "quote", title: "Quote", state: "unavailable", message: "Quote is not loaded." };
  if (quote.status === "live") return { id: "quote", title: "Quote", state: "ready", message: quote.message };
  if (quote.status === "stale") return { id: "quote", title: "Quote", state: "stale", message: quote.message };
  return { id: "quote", title: "Quote", state: "unavailable", message: quote.message };
}

function researchStage(research: ResearchProfileEnvelope | null, context: DecisionContextEnvelope | null): StageState {
  if (context?.research.status === "unauthorized") return { id: "research", title: "Research evidence", state: "unauthorized", message: context.research.message };
  if (!research && !context) return { id: "research", title: "Research evidence", state: "unavailable", message: "Research is not loaded." };
  if (context?.research.status === "stale_evidence") return { id: "research", title: "Research evidence", state: "stale", message: context.research.message };
  if (context?.research.status === "no_evidence" || research?.data === null) return { id: "research", title: "Research evidence", state: "empty", message: context?.research.message ?? research?.message ?? "No research evidence." };
  if (context?.research.status === "available") return { id: "research", title: "Research evidence", state: "ready", message: context.research.message };
  if (research?.data) return { id: "research", title: "Research evidence", state: "ready", message: research.message };
  return { id: "research", title: "Research evidence", state: "unavailable", message: context?.research.message ?? research?.message ?? "Research unavailable." };
}

function pinganStage(snapshot: PinganSnapshotEnvelope | null): StageState {
  if (!snapshot) return { id: "pingan", title: "Pingan historical portfolio context", state: "unavailable", message: "Pingan context is not loaded." };
  if (snapshot.status === "available") return { id: "pingan", title: "Pingan historical portfolio context", state: "unavailable", message: "Pingan available status is not displayable; historical context must be stale, warning-bound, and fail-closed." };
  if (snapshot.status === "stale") return { id: "pingan", title: "Pingan historical portfolio context", state: "stale", message: snapshot.warning ?? snapshot.message };
  if (snapshot.status === "empty") return { id: "pingan", title: "Pingan historical portfolio context", state: "empty", message: snapshot.message };
  if (snapshot.status === "unauthorized") return { id: "pingan", title: "Pingan historical portfolio context", state: "unauthorized", message: snapshot.message };
  if (snapshot.status === "source_conflict") return { id: "pingan", title: "Pingan historical portfolio context", state: "conflict", message: snapshot.message };
  return { id: "pingan", title: "Pingan historical portfolio context", state: "unavailable", message: snapshot.message };
}

function decisionStage(context: DecisionContextEnvelope | null, check: PreTradeDecisionCheckData | null): StageState {
  if (!context) return { id: "decision", title: "Human decision check", state: "unavailable", message: "Validated decision context is required." };
  if (sameDecisionContext(check, context)) return { id: "decision", title: "Human decision check", state: "completed", message: `Recorded ${check?.humanCheckResult}.` };
  return { id: "decision", title: "Human decision check", state: "pending", message: "Ready for a human advisory check; no execution can occur." };
}

function reviewStage(history: DecisionReviewHistoryEnvelope | null, check: PreTradeDecisionCheckData | null, review: PostDecisionReviewData | null): StageState {
  if (history && (history.metadata.freshness === "unavailable"
    || history.metadata.provenance === "unavailable"
    || history.metadata.authority === "unavailable")) {
    return { id: "review", title: "Post-decision review", state: "unavailable", message: history.message };
  }
  if (!check && history && history.checks.length > 0) return { id: "review", title: "Post-decision review", state: "pending", message: `${history.checks.length} prior decision check(s) available as bounded history only.` };
  if (!check) return { id: "review", title: "Post-decision review", state: "pending", message: "Record a human decision check first." };
  if (review) return { id: "review", title: "Post-decision review", state: "completed", message: `Review recorded as ${review.outcome}.` };
  if (!history) return { id: "review", title: "Post-decision review", state: "unavailable", message: "Review history is not loaded." };
  return { id: "review", title: "Post-decision review", state: history.checks.length === 0 ? "empty" : "pending", message: history.message };
}
