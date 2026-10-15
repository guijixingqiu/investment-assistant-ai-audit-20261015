import type { CandidateDecisionIntakeEnvelope, CandidateDecisionIntakeNextAction } from "../../../packages/contracts/src/candidateDecisionIntake.js";
import type { CandidateMembershipState } from "../../../packages/contracts/src/candidateMembership.js";
import type { FactMetadata } from "../../../packages/contracts/src/factMetadata.js";

export type CandidateDecisionIntakeUiState =
  | "idle" | "loading" | "ready" | "archived" | "missing_research"
  | "missing_quote" | "stale_quote" | "review_required" | "unavailable"
  | "unauthorized" | "not_found" | "malformed" | "offline" | "conflict";

export interface CandidateDecisionIntakeRenderModel {
  state: CandidateDecisionIntakeUiState;
  title: string;
  message: string;
  membershipId: string | null;
  membershipVersion: number | null;
  membershipState: CandidateMembershipState | null;
  symbol: string | null;
  generatedAt: string | null;
  metadata: FactMetadata | null;
  nextAction: CandidateDecisionIntakeNextAction | null;
  facts: string[];
}

export const initialCandidateDecisionIntake: CandidateDecisionIntakeRenderModel = {
  state: "idle", title: "Decision intake", message: "Select decision intake from a loaded membership.",
  membershipId: null, membershipVersion: null, membershipState: null, symbol: null, generatedAt: null, metadata: null, nextAction: null, facts: []
};

export function loadingCandidateDecisionIntake(membershipId: string): CandidateDecisionIntakeRenderModel {
  return { ...initialCandidateDecisionIntake, state: "loading", message: `Loading decision intake for membership ${membershipId}.`, membershipId };
}

export function failClosedCandidateDecisionIntake(
  state: Exclude<CandidateDecisionIntakeUiState, "idle" | "loading" | "ready" | "archived" | "missing_research" | "missing_quote" | "stale_quote" | "review_required">,
  message: string,
  membershipId: string | null = null
): CandidateDecisionIntakeRenderModel {
  return { ...initialCandidateDecisionIntake, state, message, membershipId };
}

export function candidateDecisionIntakeFromEnvelope(envelope: CandidateDecisionIntakeEnvelope): CandidateDecisionIntakeRenderModel {
  const symbol = envelope.requestedSymbol ?? envelope.membership?.symbol ?? null;
  return {
    state: decisionIntakeStateFor(envelope),
    title: symbol ? `Decision intake for ${symbol}` : "Decision intake",
    message: envelope.message,
    membershipId: envelope.membershipId,
    membershipVersion: envelope.membership?.version ?? null,
    membershipState: envelope.membership?.state ?? null,
    symbol,
    generatedAt: envelope.generatedAt,
    metadata: envelope.metadata,
    nextAction: envelope.nextAction.state,
    facts: [
      `Fact metadata: source=${envelope.metadata.source}; as-of=${envelope.metadata.asOf ?? "missing"}; fetched-at=${envelope.metadata.fetchedAt ?? "missing"}; freshness=${envelope.metadata.freshness}; provenance=${envelope.metadata.provenance}; authority=${envelope.metadata.authority}.`,
      `Next action: ${envelope.nextAction.state}; ${envelope.nextAction.reason}`,
      `Research: ${envelope.provenance.research}`,
      `Quote: ${envelope.provenance.quotes}`,
      `Decision context: ${envelope.provenance.decisionContext}`,
      `Review: ${envelope.review.status}; ${envelope.review.message}`,
      `Membership: ${envelope.membership?.state ?? "missing"}`,
      "Advisory only: no orders, trades, fills, cash, fees, positions, portfolio facts, or broker calls."
    ]
  };
}

function decisionIntakeStateFor(envelope: CandidateDecisionIntakeEnvelope): CandidateDecisionIntakeUiState {
  if (envelope.nextAction.state === "ready_for_human_check") return "ready";
  if (envelope.nextAction.state === "membership_archived") return "archived";
  if (envelope.nextAction.state === "research_missing") return "missing_research";
  if (envelope.nextAction.state === "quote_missing") return "missing_quote";
  if (envelope.nextAction.state === "quote_stale") return "stale_quote";
  if (envelope.nextAction.state === "review_required") return "review_required";
  return envelope.status === "not_found" ? "not_found" : "unavailable";
}
