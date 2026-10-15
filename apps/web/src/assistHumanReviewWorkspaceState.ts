import type { AssistHumanReviewWorkspaceEnvelope } from "../../../packages/contracts/src/assistHumanReviewWorkspace.js";

export type AssistHumanReviewWorkspaceUiState =
  | "idle" | "loading" | "ready" | "review_limited" | "blocked" | "empty"
  | "unauthorized" | "not_found" | "conflict" | "unavailable" | "malformed" | "offline";

export interface AssistHumanReviewWorkspaceRenderModel {
  state: AssistHumanReviewWorkspaceUiState;
  title: string;
  message: string;
  membershipId: string | null;
  symbol: string | null;
  generatedAt: string | null;
  readiness: string[];
  evidenceGroups: string[];
  limitations: string[];
  continuations: string[];
  followUp: string[];
  boundaries: string[];
  failClosed: string[];
  provenance: string[];
}

export const initialAssistHumanReviewWorkspace: AssistHumanReviewWorkspaceRenderModel = {
  state: "idle", title: "ASSIST human-review workspace", message: "Select human-review workspace from a loaded membership.",
  membershipId: null, symbol: null, generatedAt: null, readiness: [], evidenceGroups: [], limitations: [],
  continuations: [], followUp: [], boundaries: [], failClosed: [], provenance: []
};

export function loadingAssistHumanReviewWorkspace(membershipId: string): AssistHumanReviewWorkspaceRenderModel {
  return { ...initialAssistHumanReviewWorkspace, state: "loading", message: `Loading ASSIST human-review workspace for membership ${membershipId}.`, membershipId };
}

export function failClosedAssistHumanReviewWorkspace(
  state: Exclude<AssistHumanReviewWorkspaceUiState, "idle" | "loading" | "ready" | "review_limited" | "empty">,
  message: string,
  membershipId: string | null = null
): AssistHumanReviewWorkspaceRenderModel {
  return {
    ...initialAssistHumanReviewWorkspace,
    state,
    message,
    membershipId,
    failClosed: [`${state}: ${message}`, "No stale workspace facts, partial facts, recommendations, or trading guidance are displayed."]
  };
}

export function assistHumanReviewWorkspaceFromEnvelope(envelope: AssistHumanReviewWorkspaceEnvelope): AssistHumanReviewWorkspaceRenderModel {
  const membershipId = envelope.target.candidateMembershipId ?? envelope.sourceEnvelopeRef.candidateMembershipId;
  if (envelope.status !== "available") return failClosedAssistHumanReviewWorkspace(envelope.status, envelope.message, membershipId);
  return {
    state: stateFor(envelope),
    title: `ASSIST human-review workspace for ${envelope.target.symbol}`,
    message: envelope.message,
    membershipId,
    symbol: envelope.target.symbol,
    generatedAt: envelope.generatedAt,
    readiness: [
      `${envelope.readiness.label}: ${envelope.readiness.explanation}`,
      `Allowed: ${envelope.readiness.allowedInterpretation}`,
      `Forbidden: ${envelope.readiness.forbiddenInterpretation}`,
      `Manual review only: ${envelope.readiness.manualReviewOnly}; trade-ready: ${envelope.readiness.tradeReady}; recommendation: ${envelope.readiness.recommendation}`
    ],
    evidenceGroups: envelope.evidenceGroups.map((group) => {
      const facts = group.facts.length > 0 ? ` Facts: ${group.facts.join(" | ")}` : "";
      const limitations = group.limitations.length > 0 ? ` Limitations: ${group.limitations.join(" | ")}` : "";
      return `${group.title} [${group.status}/${group.severity}]: ${group.summary}${facts}${limitations} Allowed: ${group.allowedInterpretation} Forbidden: ${group.forbiddenInterpretation}`;
    }),
    limitations: envelope.limitations.map((limitation) => `${limitation.label} [${limitation.severity}]: ${limitation.explanation} Impact: ${limitation.userImpact}`),
    continuations: envelope.continuations.map((continuation) => `${continuation.label} [${continuation.category}; ${continuation.sideEffectLevel}; enabled=${continuation.enabled}]: ${continuation.description}${continuation.disabledReason ? ` Disabled: ${continuation.disabledReason}` : ""}`),
    followUp: [
      `Current review state: ${envelope.followUp.currentReviewState}`,
      `Manual note intent: ${envelope.followUp.manualNoteIntent}`,
      `Later review intent: ${envelope.followUp.laterReviewIntent}`,
      `Unresolved gaps: ${envelope.followUp.unresolvedEvidenceGaps.join("; ") || "none"}`,
      `Suggested local next views: ${envelope.followUp.suggestedLocalNextViews.join("; ") || "none"}`,
      `Blocked external actions: ${envelope.followUp.blockedExternalActions.join("; ")}`,
      `Production NO_GO: ${envelope.followUp.productionNoGoReason}`
    ],
    boundaries: [
      "No recommendation, ranking, scoring, buy/sell/hold, timing, target price, stop loss, take profit, expected return, sizing, allocation, order, trade, fill, cash, fee, position, broker, portfolio mutation, or production claim.",
      `Pingan historical only: ${envelope.boundaries.pinganHistoricalOnly}; portfolio omitted: ${envelope.boundaries.portfolioOmitted}; external runtime not used: ${envelope.boundaries.externalRuntimeNotUsed}`
    ],
    failClosed: [
      `Fail-closed active: ${envelope.failClosed.active}; no stale facts: ${envelope.failClosed.noStaleFacts}; no partial facts: ${envelope.failClosed.noPartialFacts}`,
      "If a newer workspace read fails, previous workspace facts are cleared."
    ],
    provenance: [
      `Core facts: ${envelope.provenance.coreFacts}`,
      `Source envelope: ${envelope.provenance.sourceEnvelope} ${envelope.sourceEnvelopeRef.schemaVersion}`,
      `Pingan: ${envelope.provenance.pingan}; portfolio: ${envelope.provenance.portfolio}; runtime: ${envelope.provenance.runtime}`,
      `Generated: ${envelope.generatedAt}`
    ]
  };
}

function stateFor(envelope: AssistHumanReviewWorkspaceEnvelope): AssistHumanReviewWorkspaceUiState {
  if (envelope.status !== "available") return envelope.status;
  if (envelope.readiness.id === "ready_for_manual_review") return "ready";
  if (envelope.readiness.id === "review_limited") return "review_limited";
  if (envelope.readiness.id === "empty_local_scope") return "empty";
  return "blocked";
}
