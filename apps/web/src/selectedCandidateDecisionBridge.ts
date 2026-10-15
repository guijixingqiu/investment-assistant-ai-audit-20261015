import type { CandidateMembershipData } from "../../../packages/contracts/src/candidateMembership.js";
import type { CandidateMembershipRenderModel } from "./candidateMembershipState.js";

export type SelectedCandidateDecisionBridgeUiState =
  | "candidate_missing" | "membership_unloaded" | "loading" | "ready" | "archived"
  | "missing_research" | "missing_quote" | "stale_quote" | "membership_missing"
  | "unavailable" | "unauthorized" | "not_found" | "malformed" | "offline" | "conflict";

export interface SelectedCandidateDecisionBridgeRenderModel {
  state: SelectedCandidateDecisionBridgeUiState;
  title: string;
  message: string;
  symbol: string | null;
  membershipId: string | null;
  membershipState: CandidateMembershipData["state"] | null;
  membershipVersion: number | null;
  generatedAt: string | null;
  canOpenDecisionIntake: boolean;
  facts: string[];
}

export function selectedCandidateDecisionBridgeFromState(
  selectedSymbol: string | null,
  memberships: CandidateMembershipRenderModel,
  busy = false
): SelectedCandidateDecisionBridgeRenderModel {
  if (!selectedSymbol) return failure("candidate_missing", "Selected candidate decision bridge", "Open a selected candidate before linking it to decision-intake membership facts.", null, memberships.generatedAt);
  const title = `Selected candidate bridge for ${selectedSymbol}`;
  if (busy || memberships.state === "loading") return failure("loading", title, `Membership source is loading; ${selectedSymbol} is not bridged until current membership facts load.`, selectedSymbol, null);
  if (memberships.state === "idle") return failure("membership_unloaded", title, "Load candidate memberships with a runtime read token before opening decision intake from the selected candidate.", selectedSymbol, memberships.generatedAt);
  if (memberships.state !== "available") {
    const state = memberships.state === "empty" ? "membership_missing" : memberships.state;
    return failure(state, title, `Candidate membership source is ${memberships.state}: ${memberships.message}`, selectedSymbol, memberships.generatedAt);
  }
  const membership = memberships.memberships.find((item) => item.symbol === selectedSymbol) ?? null;
  if (!membership) return failure("membership_missing", title, `No loaded candidate membership matches selected candidate ${selectedSymbol}. Load or create the membership explicitly before using decision intake.`, selectedSymbol, memberships.generatedAt);
  const state = stateForMembership(membership);
  return {
    state,
    title,
    message: messageForMembership(state, membership),
    symbol: selectedSymbol,
    membershipId: membership.id,
    membershipState: membership.state,
    membershipVersion: membership.version,
    generatedAt: memberships.generatedAt,
    canOpenDecisionIntake: true,
    facts: factsForMembership(membership)
  };
}

function failure(state: SelectedCandidateDecisionBridgeUiState, title: string, message: string, symbol: string | null, generatedAt: string | null): SelectedCandidateDecisionBridgeRenderModel {
  return { state, title, message, symbol, membershipId: null, membershipState: null, membershipVersion: null, generatedAt, canOpenDecisionIntake: false, facts: [] };
}

function stateForMembership(membership: CandidateMembershipData): SelectedCandidateDecisionBridgeUiState {
  if (membership.state === "archived") return "archived";
  if (membership.research.status === "missing") return "missing_research";
  if (membership.quote.status === "unavailable") return "missing_quote";
  if (membership.quote.status === "stale") return "stale_quote";
  return "ready";
}

function messageForMembership(state: SelectedCandidateDecisionBridgeUiState, membership: CandidateMembershipData): string {
  if (state === "ready") return `Selected candidate matches membership ${membership.id}; decision intake can load current membership facts.`;
  if (state === "archived") return `Selected candidate matches archived membership ${membership.id}; decision intake will expose the archived state without treating it as ready.`;
  if (state === "missing_research") return `Selected candidate matches membership ${membership.id}, but research facts are missing; decision intake must fail closed for research context.`;
  if (state === "missing_quote") return `Selected candidate matches membership ${membership.id}, but quote facts are missing; decision intake must fail closed for quote context.`;
  if (state === "stale_quote") return `Selected candidate matches membership ${membership.id}, but quote facts are stale; decision intake must not treat the quote as fresh.`;
  return `Selected candidate matches membership ${membership.id}; decision intake can inspect the current membership state.`;
}

function factsForMembership(membership: CandidateMembershipData): string[] {
  const quoteSource = membership.quote.source ?? "missing source";
  const quoteFetchedAt = membership.quote.fetchedAt ?? "missing fetched time";
  const quoteStale = membership.quote.staleReason ? `; ${membership.quote.staleReason}` : "";
  const researchUpdatedAt = membership.research.profileUpdatedAt ?? "missing profile time";
  return [
    `Selected candidate: ${membership.symbol}`,
    `Membership: ${membership.id}; state ${membership.state}; version ${membership.version}; updated ${membership.updatedAt}`,
    `Research: ${membership.research.status}; ${researchUpdatedAt}`,
    `Quote: ${membership.quote.status}; ${quoteSource}; ${quoteFetchedAt}${quoteStale}`,
    `Provenance: ${membership.provenance.membership}; ${membership.provenance.research}; ${membership.provenance.quotes}; portfolio ${membership.provenance.portfolio}`,
    "Bridge is read-only and exact-symbol scoped; it does not create memberships, persist notes, mutate portfolio facts, or call broker actions."
  ];
}
