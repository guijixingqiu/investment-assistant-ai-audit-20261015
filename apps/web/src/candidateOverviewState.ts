import type { CandidateOverviewEnvelope, CandidateOverviewItem } from "../../../packages/contracts/src/candidateOverview.js";

export type CandidateOverviewUiState =
  | "idle"
  | "loading"
  | "available"
  | "empty"
  | "unavailable"
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "malformed"
  | "offline";

export interface CandidateOverviewRenderModel {
  state: CandidateOverviewUiState;
  message: string;
  generatedAt: string | null;
  candidates: CandidateOverviewItem[];
}

export const initialCandidateOverview: CandidateOverviewRenderModel = {
  state: "idle",
  message: "Load tracked candidates with a runtime token.",
  generatedAt: null,
  candidates: []
};

export function loadingCandidateOverview(): CandidateOverviewRenderModel {
  return {
    state: "loading",
    message: "Loading tracked candidates.",
    generatedAt: null,
    candidates: []
  };
}

export function failClosedCandidateOverview(state: Exclude<CandidateOverviewUiState, "available" | "empty" | "idle" | "loading">, message: string): CandidateOverviewRenderModel {
  return {
    state,
    message,
    generatedAt: null,
    candidates: []
  };
}

export function candidateOverviewFromEnvelope(envelope: CandidateOverviewEnvelope): CandidateOverviewRenderModel {
  if (envelope.status === "available") {
    return {
      state: "available",
      message: envelope.message,
      generatedAt: envelope.generatedAt,
      candidates: envelope.candidates
    };
  }
  return {
    state: envelope.status,
    message: envelope.message,
    generatedAt: envelope.generatedAt,
    candidates: []
  };
}
