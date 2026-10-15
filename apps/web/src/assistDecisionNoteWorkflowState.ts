import type { AssistDecisionNoteWorkflowEnvelope } from "../../../packages/contracts/src/assistDecisionNoteWorkflow.js";

export type AssistDecisionNoteWorkflowUiState =
  | "idle" | "loading" | "available" | "blocked" | "unauthorized" | "not_found"
  | "conflict" | "unavailable" | "malformed" | "offline" | "superseded";

export interface AssistDecisionNoteDrafts { decisionNote: string; }

export interface AssistDecisionNoteWorkflowRenderModel {
  state: AssistDecisionNoteWorkflowUiState;
  title: string;
  message: string;
  membershipId: string | null;
  symbol: string | null;
  generatedAt: string | null;
  noteState: string | null;
  steps: string[];
  factReferences: string[];
  unresolvedEvidenceGaps: string[];
  laterReviewEntry: string[];
  blockedExternalActions: string[];
  localDrafts: AssistDecisionNoteDrafts;
  draftSummary: string[];
  safety: string[];
  failClosed: string[];
}

export const emptyAssistDecisionNoteDrafts: AssistDecisionNoteDrafts = { decisionNote: "" };

export const initialAssistDecisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel = {
  state: "idle", title: "ASSIST decision-note workflow", message: "Select decision-note workflow from a loaded membership.",
  membershipId: null, symbol: null, generatedAt: null, noteState: null, steps: [], factReferences: [], unresolvedEvidenceGaps: [],
  laterReviewEntry: [], blockedExternalActions: [], localDrafts: { ...emptyAssistDecisionNoteDrafts }, draftSummary: [], safety: [], failClosed: []
};

export function loadingAssistDecisionNoteWorkflow(membershipId: string): AssistDecisionNoteWorkflowRenderModel {
  return { ...initialAssistDecisionNoteWorkflow, state: "loading", message: `Loading ASSIST decision-note workflow for membership ${membershipId}.`, membershipId, localDrafts: { ...emptyAssistDecisionNoteDrafts }, failClosed: ["Loading clears prior local decision-note drafts before new workflow facts are accepted."] };
}

export function failClosedAssistDecisionNoteWorkflow(
  state: Exclude<AssistDecisionNoteWorkflowUiState, "idle" | "loading" | "available" | "blocked">,
  message: string,
  membershipId: string | null = null
): AssistDecisionNoteWorkflowRenderModel {
  return { ...initialAssistDecisionNoteWorkflow, state, message, membershipId, localDrafts: { ...emptyAssistDecisionNoteDrafts }, failClosed: [`${state}: ${message}`, "No stale decision-note workflow facts, fact references, local drafts, recommendations, or trading guidance are displayed."] };
}

export function assistDecisionNoteWorkflowFromEnvelope(
  envelope: AssistDecisionNoteWorkflowEnvelope,
  localDrafts: AssistDecisionNoteDrafts = emptyAssistDecisionNoteDrafts
): AssistDecisionNoteWorkflowRenderModel {
  const membershipId = envelope.target.candidateMembershipId;
  if (envelope.status !== "available" && envelope.status !== "blocked_follow_up") return failClosedAssistDecisionNoteWorkflow(envelope.status, envelope.message, membershipId);
  const safeDrafts = { decisionNote: localDrafts.decisionNote.slice(0, envelope.decisionNoteDraft?.maxLength ?? 1000) };
  return {
    state: envelope.status === "blocked_follow_up" ? "blocked" : "available",
    title: `ASSIST decision-note workflow for ${envelope.target.symbol}`,
    message: envelope.message,
    membershipId,
    symbol: envelope.target.symbol,
    generatedAt: envelope.generatedAt,
    noteState: envelope.noteState,
    steps: envelope.steps.map((step) => `${step.label} [enabled=${step.enabled}; localOnly=${step.localOnly}; persists=${step.persists}]: ${step.description}${step.disabledReason ? ` Disabled: ${step.disabledReason}` : ""}`),
    factReferences: envelope.factReferences.map((reference) => `${reference.label} [${reference.source}; localOnly=${reference.localOnly}; available=${reference.available}]: ${reference.summary}`),
    unresolvedEvidenceGaps: envelope.unresolvedEvidenceGaps,
    laterReviewEntry: envelope.laterReviewEntry ? [envelope.laterReviewEntry] : ["No later-review entry is available until a valid workflow provides one."],
    blockedExternalActions: envelope.blockedExternalActions,
    localDrafts: safeDrafts,
    draftSummary: assistDecisionNoteDraftSummary(safeDrafts),
    safety: [
      `Advisory only: ${envelope.safety.advisoryOnly}; manual review only: ${envelope.safety.manualReviewOnly}; local draft only: ${envelope.safety.localDraftOnly}; no official record: ${envelope.safety.noOfficialRecord}; no persistence: ${envelope.safety.noPersistence}; not sent: ${envelope.safety.notSent}; draft storage: ${envelope.provenance.draftStorage}`,
      `Pingan historical-only and portfolio omitted boundaries remain inherited from the source workspace; portfolio provenance: ${envelope.provenance.portfolio}; runtime: ${envelope.provenance.runtime}; external accounts: ${envelope.provenance.externalAccounts}.`,
      "Production NO_GO remains; safety proof blocks recommendation, ranking, scoring, buy/sell/hold, execution authority, account authority, broker authority, portfolio mutation, cash mutation, fee mutation, position mutation, and production claims."
    ],
    failClosed: [
      `Fail-closed active: ${envelope.failClosed.active}; clears draft: ${envelope.failClosed.clearsDraft}; no stale facts: ${envelope.failClosed.noStaleFacts}; no stale draft: ${envelope.failClosed.noStaleDraft}; no partial facts: ${envelope.failClosed.noPartialFacts}; no usable stale references: ${envelope.failClosed.noUsableStaleReferences}`,
      "If a newer decision-note workflow read fails or is superseded, previous decision-note workflow facts, fact references, and local drafts are cleared."
    ]
  };
}

export function assistDecisionNoteDraftSummary(drafts: AssistDecisionNoteDrafts): string[] {
  return [
    drafts.decisionNote.trim().length > 0 ? `Decision-note draft: ${drafts.decisionNote.trim()}` : "Decision-note draft is empty.",
    "Decision-note drafts stay in browser memory only; they are separate from saved local records and official review history, not official review records, not persisted, and not sent."
  ];
}
