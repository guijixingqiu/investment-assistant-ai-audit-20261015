import type { AssistAdvisoryScopeAllowedContinuation, AssistAdvisoryScopeEnvelope } from "../../../packages/contracts/src/assistAdvisoryScope.js";

export type AssistAdvisoryScopeUiState =
  | "idle" | "loading" | "available" | "empty" | "missing_research" | "missing_quote"
  | "stale_quote" | "review_required" | "limited" | "unauthorized" | "not_found"
  | "conflict" | "unavailable" | "malformed" | "offline";

export interface AssistAdvisoryScopeRenderModel {
  state: AssistAdvisoryScopeUiState;
  title: string;
  message: string;
  membershipId: string | null;
  symbol: string | null;
  generatedAt: string | null;
  facts: string[];
  limitations: string[];
  continuations: string[];
  safety: string[];
}

export const initialAssistAdvisoryScope: AssistAdvisoryScopeRenderModel = {
  state: "idle", title: "ASSIST advisory scope", message: "Select advisory scope from a loaded membership.",
  membershipId: null, symbol: null, generatedAt: null, facts: [], limitations: [], continuations: [], safety: []
};

export function loadingAssistAdvisoryScope(membershipId: string): AssistAdvisoryScopeRenderModel {
  return { ...initialAssistAdvisoryScope, state: "loading", message: `Loading ASSIST advisory scope for membership ${membershipId}.`, membershipId };
}

export function failClosedAssistAdvisoryScope(
  state: Exclude<AssistAdvisoryScopeUiState, "idle" | "loading" | "available" | "empty" | "missing_research" | "missing_quote" | "stale_quote" | "review_required" | "limited">,
  message: string,
  membershipId: string | null = null
): AssistAdvisoryScopeRenderModel {
  return { ...initialAssistAdvisoryScope, state, message, membershipId };
}

export function assistAdvisoryScopeFromEnvelope(envelope: AssistAdvisoryScopeEnvelope): AssistAdvisoryScopeRenderModel {
  const state = stateFor(envelope);
  const symbol = envelope.target.symbol;
  if (envelope.status !== "available") {
    return failClosedAssistAdvisoryScope(envelope.status, envelope.message, envelope.candidateMembershipId ?? envelope.target.candidateMembershipId ?? null);
  }
  return {
    state,
    title: `ASSIST advisory scope for ${symbol}`,
    message: envelope.message,
    membershipId: envelope.candidateMembershipId ?? envelope.target.candidateMembershipId ?? null,
    symbol,
    generatedAt: envelope.generatedAt,
    facts: envelope.facts.map((fact) => `${fact.label}: ${fact.status}; ${fact.message}`),
    limitations: envelope.limitations.map((limitation) => `${limitation.kind}: ${limitation.message}`),
    continuations: envelope.allowedContinuations.map(continuationLabel),
    safety: ["Advisory-only contract accepted.", "Safety proof blocks execution authority and account mutation authority."]
  };
}

function stateFor(envelope: AssistAdvisoryScopeEnvelope): AssistAdvisoryScopeUiState {
  if (envelope.status !== "available") return envelope.status;
  if (envelope.facts.some((fact) => fact.status === "research_missing")) return "missing_research";
  if (envelope.facts.some((fact) => fact.status === "quote_missing")) return "missing_quote";
  if (envelope.facts.some((fact) => fact.status === "quote_stale")) return "stale_quote";
  if (envelope.facts.some((fact) => fact.status === "review_required")) return "review_required";
  if (envelope.facts.every((fact) => fact.status === "empty")) return "empty";
  if (envelope.facts.some((fact) => fact.status === "decision_context_limited" || fact.status === "historical_context_limited" || fact.status === "evidence_gap")) return "limited";
  return "available";
}

function continuationLabel(continuation: AssistAdvisoryScopeAllowedContinuation): string {
  switch (continuation) {
    case "view_candidate": return "Open candidate facts";
    case "view_decision_context": return "Open decision context facts";
    case "complete_human_check": return "Complete human check";
    case "inspect_post_decision_review": return "Inspect post-decision review";
    case "view_pingan_historical_context": return "View Pingan historical context";
    case "stop_due_to_unavailable_facts": return "Stop when facts are unavailable";
  }
}
