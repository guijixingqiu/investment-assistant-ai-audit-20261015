import type { CandidateMembershipData } from "../../../packages/contracts/src/candidateMembership.js";
import type {
  CandidateMembershipRenderModel,
  CandidateMembershipUiState
} from "./candidateMembershipState.js";

export type SelectedCandidateMembershipGateFailureState =
  | "candidate_missing"
  | "membership_unloaded"
  | "membership_missing"
  | "loading"
  | Exclude<CandidateMembershipUiState, "idle" | "loading" | "available" | "empty">;

export interface SelectedCandidateMembershipGateCopy {
  candidateMissingTitle: string;
  candidateMissingMessage: string;
  titleForSymbol: (symbol: string) => string;
  loadingMessage: (symbol: string) => string;
  membershipUnloadedMessage: string;
  membershipSourceFailureMessage: (state: CandidateMembershipUiState, message: string) => string;
  membershipMissingMessage: (symbol: string) => string;
}

export type SelectedCandidateMembershipGateResult =
  | {
    ok: true;
    title: string;
    symbol: string;
    membership: CandidateMembershipData;
    generatedAt: string | null;
  }
  | {
    ok: false;
    state: SelectedCandidateMembershipGateFailureState;
    title: string;
    message: string;
    symbol: string | null;
    generatedAt: string | null;
  };

export function resolveSelectedCandidateMembership(
  selectedSymbol: string | null,
  memberships: CandidateMembershipRenderModel,
  membershipBusyState: boolean,
  copy: SelectedCandidateMembershipGateCopy
): SelectedCandidateMembershipGateResult {
  if (!selectedSymbol) {
    return {
      ok: false,
      state: "candidate_missing",
      title: copy.candidateMissingTitle,
      message: copy.candidateMissingMessage,
      symbol: null,
      generatedAt: null
    };
  }

  const title = copy.titleForSymbol(selectedSymbol);
  if (membershipBusyState || memberships.state === "loading") {
    return {
      ok: false,
      state: "loading",
      title,
      message: copy.loadingMessage(selectedSymbol),
      symbol: selectedSymbol,
      generatedAt: null
    };
  }
  if (memberships.state === "idle") {
    return {
      ok: false,
      state: "membership_unloaded",
      title,
      message: copy.membershipUnloadedMessage,
      symbol: selectedSymbol,
      generatedAt: memberships.generatedAt
    };
  }
  if (memberships.state !== "available") {
    return {
      ok: false,
      state: memberships.state === "empty" ? "membership_missing" : memberships.state,
      title,
      message: copy.membershipSourceFailureMessage(memberships.state, memberships.message),
      symbol: selectedSymbol,
      generatedAt: memberships.generatedAt
    };
  }

  const membership = memberships.memberships.find((item) => item.symbol === selectedSymbol) ?? null;
  if (!membership) {
    return {
      ok: false,
      state: "membership_missing",
      title,
      message: copy.membershipMissingMessage(selectedSymbol),
      symbol: selectedSymbol,
      generatedAt: memberships.generatedAt
    };
  }
  return { ok: true, title, symbol: selectedSymbol, membership, generatedAt: memberships.generatedAt };
}

export function selectedCandidateSourceIdentityMismatch(
  membership: CandidateMembershipData,
  source: { membershipId: string | null; symbol: string | null }
): boolean {
  return (source.membershipId !== null && source.membershipId !== membership.id)
    || (source.symbol !== null && source.symbol !== membership.symbol);
}
