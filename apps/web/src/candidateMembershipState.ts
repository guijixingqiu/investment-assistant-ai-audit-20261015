import type { CandidateMembershipData, CandidateMembershipEnvelope, CandidateMembershipState, CandidateMembershipWriteResult } from "../../../packages/contracts/src/candidateMembership.js";
import type { FactMetadata } from "../../../packages/contracts/src/factMetadata.js";

export type CandidateMembershipUiState =
  | "idle"
  | "loading"
  | "available"
  | "empty"
  | "unavailable"
  | "unauthorized"
  | "malformed"
  | "offline"
  | "conflict"
  | "not_found";

export interface CandidateMembershipActionStatus {
  state: "idle" | "loading" | "created" | "already_exists" | "restored" | "state_changed" | "unchanged" | "unauthorized" | "malformed" | "conflict" | "not_found" | "offline" | "unavailable";
  message: string;
}

export interface CandidateMembershipRenderModel {
  state: CandidateMembershipUiState;
  message: string;
  generatedAt: string | null;
  metadata: FactMetadata | null;
  includeArchived: boolean;
  memberships: CandidateMembershipData[];
  action: CandidateMembershipActionStatus;
}

export const initialCandidateMemberships: CandidateMembershipRenderModel = {
  state: "idle",
  message: "Load candidate memberships with a runtime read token.",
  generatedAt: null,
  metadata: null,
  includeArchived: false,
  memberships: [],
  action: {
    state: "idle",
    message: "No candidate membership write has been submitted."
  }
};

export function loadingCandidateMemberships(previous: CandidateMembershipRenderModel, message = "Loading candidate memberships."): CandidateMembershipRenderModel {
  return {
    ...previous,
    state: "loading",
    message,
    generatedAt: null,
    metadata: null
  };
}

export function failClosedCandidateMemberships(
  state: Exclude<CandidateMembershipUiState, "available" | "empty" | "idle" | "loading">,
  message: string,
  previous: CandidateMembershipRenderModel = initialCandidateMemberships
): CandidateMembershipRenderModel {
  return {
    ...previous,
    state,
    message,
    generatedAt: null,
    metadata: null,
    memberships: []
  };
}

export function candidateMembershipsFromEnvelope(
  envelope: CandidateMembershipEnvelope,
  previous: CandidateMembershipRenderModel = initialCandidateMemberships
): CandidateMembershipRenderModel {
  if (envelope.status === "available") {
    return {
      ...previous,
      state: "available",
      message: envelope.message,
      generatedAt: envelope.generatedAt,
      metadata: envelope.metadata,
      includeArchived: envelope.includeArchived,
      memberships: envelope.memberships
    };
  }
  return {
    ...previous,
    state: envelope.status,
    message: envelope.message,
    generatedAt: envelope.generatedAt,
    metadata: envelope.metadata,
    includeArchived: envelope.includeArchived,
    memberships: []
  };
}

export function membershipActionLoading(message: string): CandidateMembershipActionStatus {
  return { state: "loading", message };
}

export function membershipActionSuccess(result: CandidateMembershipWriteResult, message: string): CandidateMembershipActionStatus {
  return { state: result, message };
}

export function membershipActionFailure(state: Exclude<CandidateMembershipActionStatus["state"], "idle" | "loading" | CandidateMembershipWriteResult>, message: string): CandidateMembershipActionStatus {
  return { state, message };
}

export function nextMembershipStates(membership: CandidateMembershipData): CandidateMembershipState[] {
  if (membership.state === "tracked") return ["paused", "archived"];
  if (membership.state === "paused") return ["tracked", "archived"];
  return ["tracked", "paused"];
}
