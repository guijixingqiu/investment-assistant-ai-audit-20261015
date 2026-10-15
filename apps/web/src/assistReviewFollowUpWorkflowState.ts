import type { AssistReviewFollowUpWorkflowEnvelope } from "../../../packages/contracts/src/assistReviewFollowUpWorkflow.js";

export type AssistReviewFollowUpWorkflowUiState =
  | "idle" | "loading" | "available" | "blocked" | "unauthorized" | "not_found"
  | "conflict" | "unavailable" | "malformed" | "offline";

export interface AssistReviewFollowUpDrafts {
  manualNote: string;
  laterReview: string;
  evidenceGapChecklist: string;
}

export interface AssistReviewFollowUpWorkflowRenderModel {
  state: AssistReviewFollowUpWorkflowUiState;
  title: string;
  message: string;
  membershipId: string | null;
  symbol: string | null;
  generatedAt: string | null;
  reviewState: string | null;
  steps: string[];
  intents: string[];
  evidenceGaps: string[];
  suggestedLocalViews: string[];
  blockedExternalActions: string[];
  localDrafts: AssistReviewFollowUpDrafts;
  draftSummary: string[];
  safety: string[];
  failClosed: string[];
}

export const emptyAssistReviewFollowUpDrafts: AssistReviewFollowUpDrafts = { manualNote: "", laterReview: "", evidenceGapChecklist: "" };

export const initialAssistReviewFollowUpWorkflow: AssistReviewFollowUpWorkflowRenderModel = {
  state: "idle", title: "ASSIST review follow-up workflow", message: "Select follow-up workflow from a loaded membership.",
  membershipId: null, symbol: null, generatedAt: null, reviewState: null, steps: [], intents: [], evidenceGaps: [],
  suggestedLocalViews: [], blockedExternalActions: [], localDrafts: { ...emptyAssistReviewFollowUpDrafts }, draftSummary: [], safety: [], failClosed: []
};

export function loadingAssistReviewFollowUpWorkflow(membershipId: string): AssistReviewFollowUpWorkflowRenderModel {
  return { ...initialAssistReviewFollowUpWorkflow, state: "loading", message: `Loading ASSIST review follow-up workflow for membership ${membershipId}.`, membershipId, localDrafts: { ...emptyAssistReviewFollowUpDrafts }, failClosed: ["Loading clears prior local drafts before new workflow facts are accepted."] };
}

export function failClosedAssistReviewFollowUpWorkflow(
  state: Exclude<AssistReviewFollowUpWorkflowUiState, "idle" | "loading" | "available" | "blocked">,
  message: string,
  membershipId: string | null = null
): AssistReviewFollowUpWorkflowRenderModel {
  return { ...initialAssistReviewFollowUpWorkflow, state, message, membershipId, localDrafts: { ...emptyAssistReviewFollowUpDrafts }, failClosed: [`${state}: ${message}`, "No stale workflow facts, local drafts, recommendations, or trading guidance are displayed."] };
}

export function assistReviewFollowUpWorkflowFromEnvelope(
  envelope: AssistReviewFollowUpWorkflowEnvelope,
  localDrafts: AssistReviewFollowUpDrafts = emptyAssistReviewFollowUpDrafts
): AssistReviewFollowUpWorkflowRenderModel {
  const membershipId = envelope.target.candidateMembershipId;
  if (envelope.status !== "available" && envelope.status !== "blocked_workspace") return failClosedAssistReviewFollowUpWorkflow(envelope.status, envelope.message, membershipId);
  const state = envelope.status === "blocked_workspace" || envelope.steps.some((step) => step.id === "stop_due_to_blocked_workspace" && step.enabled) ? "blocked" : "available";
  const safeDrafts = {
    manualNote: localDrafts.manualNote.slice(0, maxLength(envelope, "manual_note_draft")),
    laterReview: localDrafts.laterReview.slice(0, maxLength(envelope, "later_review_draft")),
    evidenceGapChecklist: localDrafts.evidenceGapChecklist.slice(0, maxLength(envelope, "evidence_gap_checklist"))
  };
  return {
    state,
    title: `ASSIST review follow-up workflow for ${envelope.target.symbol}`,
    message: envelope.message,
    membershipId,
    symbol: envelope.target.symbol,
    generatedAt: envelope.generatedAt,
    reviewState: envelope.followUpState,
    steps: envelope.steps.map((step) => `${step.label} [enabled=${step.enabled}; localOnly=${step.localOnly}; persists=${step.persists}]: ${step.description}${step.disabledReason ? ` Disabled: ${step.disabledReason}` : ""}`),
    intents: envelope.intents.map((intent) => `${intent.label} [localOnly=${intent.localOnly}; persists=${intent.persists}; max=${intent.maxLength}]: ${intent.placeholder}`),
    evidenceGaps: envelope.unresolvedEvidenceGaps,
    suggestedLocalViews: envelope.localNextViews,
    blockedExternalActions: envelope.blockedExternalActions,
    localDrafts: safeDrafts,
    draftSummary: assistReviewFollowUpDraftSummary(safeDrafts),
    safety: [
      `Advisory only: ${envelope.safety.advisoryOnly}; manual review only: ${envelope.safety.manualReviewOnly}; local draft only: ${envelope.safety.localDraftOnly}; no persistence: ${envelope.safety.noPersistence}; draft storage: ${envelope.provenance.draftStorage}`,
      "Safety proof blocks recommendation, ranking, scoring, execution authority, account authority, broker authority, portfolio mutation, cash mutation, fee mutation, position mutation, and production claims."
    ],
    failClosed: [
      `Fail-closed active: ${envelope.failClosed.active}; clears draft: ${envelope.failClosed.clearsDraft}; no stale workspace facts: ${envelope.failClosed.noStaleWorkspaceFacts}; no partial draft persistence: ${envelope.failClosed.noPartialDraftPersistence}`,
      "If a newer follow-up workflow read fails, previous workflow facts and local drafts are cleared."
    ]
  };
}

function maxLength(envelope: AssistReviewFollowUpWorkflowEnvelope, id: AssistReviewFollowUpWorkflowEnvelope["intents"][number]["id"]): number {
  return envelope.intents.find((intent) => intent.id === id)?.maxLength ?? 1000;
}

export function assistReviewFollowUpDraftSummary(drafts: AssistReviewFollowUpDrafts): string[] {
  return [
    drafts.manualNote.trim().length > 0 ? `Manual note draft: ${drafts.manualNote.trim()}` : "Manual note draft is empty.",
    drafts.laterReview.trim().length > 0 ? `Later-review draft: ${drafts.laterReview.trim()}` : "Later-review draft is empty.",
    drafts.evidenceGapChecklist.trim().length > 0 ? `Evidence gap checklist draft: ${drafts.evidenceGapChecklist.trim()}` : "Evidence gap checklist draft is empty.",
    "Drafts stay in browser memory only; they are separate from saved local records and official review history, not official review records, not persisted, and not sent."
  ];
}
