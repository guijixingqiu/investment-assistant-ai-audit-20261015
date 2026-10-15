import type { CoreJourneyData } from "./coreJourneyState.js";
import type { CandidateMembershipRenderModel } from "./candidateMembershipState.js";
import type { AssistReviewFollowUpWorkflowRenderModel } from "./assistReviewFollowUpWorkflowState.js";
import type { AssistDecisionNoteWorkflowRenderModel } from "./assistDecisionNoteWorkflowState.js";
import { browserLocalStorage } from "./browserStorage.js";
import { input } from "./view.js";
import { parseHongKongSymbol } from "./securitySymbol.js";
import {
  clearAssistLocalRecordFromStorage,
  deleteAssistLocalRecordFromStorage,
  describeAssistLocalRecordSnapshot,
  emptyAssistLocalRecordDrafts,
  loadAssistLocalRecordFromStorage,
  removeRejectedAssistLocalRecordFromStorage,
  saveAssistLocalRecordToStorage,
  type AssistLocalRecordDrafts
} from "./assistLocalRecordState.js";

export type AssistLocalRecordUiState =
  | "idle"
  | "available"
  | "saved_local"
  | "confirm_clear"
  | "fail_closed"
  | "storage_unavailable";

export interface AssistLocalRecordContext {
  data: CoreJourneyData | null;
  memberships: CandidateMembershipRenderModel;
  followUpWorkflow: AssistReviewFollowUpWorkflowRenderModel;
  decisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel;
}

export interface AssistLocalRecordControllerDependencies {
  context: () => AssistLocalRecordContext;
  clearKnowledgeDisplay: (message: string) => void;
  renderPanel: () => void;
}

export function assistLocalRecordSourceSignatureFromState(
  selectedSymbol: string | null,
  selectedMembershipVersion: number | null,
  decisionContext: Pick<NonNullable<CoreJourneyData["decisionContext"]>, "contextId" | "contextHash"> | null,
  followUpWorkflow: Pick<AssistReviewFollowUpWorkflowRenderModel, "state" | "membershipId" | "symbol" | "generatedAt">,
  decisionNoteWorkflow: Pick<AssistDecisionNoteWorkflowRenderModel, "state" | "membershipId" | "symbol" | "generatedAt">
): string | null {
  if (!selectedSymbol) return null;
  if (!Number.isInteger(selectedMembershipVersion) || Number(selectedMembershipVersion) < 1) return null;
  if (followUpWorkflow.state !== "available" && followUpWorkflow.state !== "blocked") return null;
  if (decisionNoteWorkflow.state !== "available" && decisionNoteWorkflow.state !== "blocked") return null;
  const membershipId = decisionNoteWorkflow.membershipId ?? followUpWorkflow.membershipId;
  const workflowSymbol = decisionNoteWorkflow.symbol ?? followUpWorkflow.symbol;
  if (!membershipId || !workflowSymbol || workflowSymbol !== selectedSymbol) return null;
  if (followUpWorkflow.membershipId && followUpWorkflow.membershipId !== membershipId) return null;
  if (decisionNoteWorkflow.membershipId && decisionNoteWorkflow.membershipId !== membershipId) return null;
  if (followUpWorkflow.symbol && followUpWorkflow.symbol !== selectedSymbol) return null;
  if (decisionNoteWorkflow.symbol && decisionNoteWorkflow.symbol !== selectedSymbol) return null;
  return [
    membershipId,
    `membership-version-${selectedMembershipVersion}`,
    selectedSymbol,
    decisionContext?.contextId ?? "no-decision-context",
    decisionContext?.contextHash ?? "no-context-hash",
    followUpWorkflow.generatedAt ?? "no-follow-up-generated-at",
    decisionNoteWorkflow.generatedAt ?? "no-decision-note-generated-at",
    followUpWorkflow.state,
    decisionNoteWorkflow.state
  ].join("|");
}

export class AssistLocalRecordController {
  drafts: AssistLocalRecordDrafts = { ...emptyAssistLocalRecordDrafts };
  status: AssistLocalRecordUiState = "idle";
  message = "Load a current decision-note workflow before saving local records.";
  clearConfirmationSourceSignature: string | null = null;
  snapshotSummary: string[] = [];
  envelopeId: string | null = null;

  constructor(private readonly dependencies: AssistLocalRecordControllerDependencies) {}

  selectedMembershipVersion(): number | null {
    const { data, memberships } = this.dependencies.context();
    const selectedSymbol = data?.symbol.symbol ?? null;
    if (!selectedSymbol) return null;
    const parsedInput = parseHongKongSymbol(input("symbol-input").value);
    if (!parsedInput.ok || parsedInput.value.symbol !== selectedSymbol) return null;
    return memberships.memberships.find((membership) => membership.symbol === selectedSymbol)?.version ?? null;
  }

  sourceSignature(): string | null {
    const { data, followUpWorkflow, decisionNoteWorkflow } = this.dependencies.context();
    const parsedInput = parseHongKongSymbol(input("symbol-input").value);
    if (!parsedInput.ok || parsedInput.value.symbol !== data?.symbol.symbol) return null;
    return assistLocalRecordSourceSignatureFromState(
      data?.symbol.symbol ?? null,
      this.selectedMembershipVersion(),
      data?.decisionContext ?? null,
      followUpWorkflow,
      decisionNoteWorkflow
    );
  }

  clearDrafts(message = "Local record display cleared; no stale saved thought is shown."): void {
    this.drafts = { ...emptyAssistLocalRecordDrafts };
    this.status = "fail_closed";
    this.message = message;
    this.clearConfirmationSourceSignature = null;
    this.snapshotSummary = [];
    this.envelopeId = null;
    this.dependencies.clearKnowledgeDisplay(`Knowledge editor cleared with source facts: ${message}`);
  }

  resetClearConfirmation(): void {
    if (this.status === "confirm_clear") this.status = this.sourceSignature() ? "available" : "fail_closed";
    this.clearConfirmationSourceSignature = null;
  }

  markAvailable(message = "Local records can now be saved or loaded for the current source signature."): void {
    this.status = "available";
    this.message = message;
  }

  updateDrafts(drafts: AssistLocalRecordDrafts): void {
    this.drafts = drafts;
    this.resetClearConfirmation();
    this.snapshotSummary = ["Unsaved local-record draft: browser-memory-only until Save local record writes a validated source-scoped envelope."];
    this.status = this.sourceSignature() ? "available" : "fail_closed";
    this.message = "Local record draft changed in browser memory; use Save local record to store it in this browser only.";
    this.dependencies.renderPanel();
  }

  save(): void {
    this.resetClearConfirmation();
    const sourceSignature = this.sourceSignature();
    const storage = browserLocalStorage();
    if (!sourceSignature) {
      this.clearDrafts("Local record save is blocked until current source facts are available.");
      this.dependencies.renderPanel();
      return;
    }
    if (!storage) {
      this.envelopeId = null;
      this.status = "storage_unavailable";
      this.message = "Browser localStorage is unavailable; the record remains display-only and is not sent.";
      this.snapshotSummary = [];
      this.dependencies.renderPanel();
      return;
    }
    const { data, followUpWorkflow, decisionNoteWorkflow } = this.dependencies.context();
    try {
      const payload = saveAssistLocalRecordToStorage(storage, {
        sourceSignature,
        symbol: data?.symbol.symbol ?? decisionNoteWorkflow.symbol ?? "HK.00000",
        membershipId: decisionNoteWorkflow.membershipId ?? "",
        decisionContextId: data?.decisionContext?.contextId ?? null,
        decisionContextHash: data?.decisionContext?.contextHash ?? null,
        followUpWorkflowGeneratedAt: followUpWorkflow.generatedAt,
        decisionNoteWorkflowGeneratedAt: decisionNoteWorkflow.generatedAt,
        fields: this.drafts,
        nowIso: new Date().toISOString()
      });
      this.drafts = { ...payload.fields };
      this.envelopeId = payload.recordId;
      this.status = "saved_local";
      this.message = payload.message;
      this.snapshotSummary = describeAssistLocalRecordSnapshot(payload);
    } catch (error) {
      this.clearDrafts(error instanceof Error ? error.message : "Local record save failed validation; display cleared.");
    }
    this.dependencies.renderPanel();
  }

  load(): void {
    this.resetClearConfirmation();
    const sourceSignature = this.sourceSignature();
    const storage = browserLocalStorage();
    if (!sourceSignature) {
      this.clearDrafts("Local record load is blocked until current source facts are available.");
      this.dependencies.renderPanel();
      return;
    }
    if (!storage) {
      this.envelopeId = null;
      this.status = "storage_unavailable";
      this.message = "Browser localStorage is unavailable; no saved local record is loaded.";
      this.snapshotSummary = [];
      this.dependencies.renderPanel();
      return;
    }
    const result = loadAssistLocalRecordFromStorage(storage, sourceSignature);
    if (!result.ok && result.state === "missing") {
      this.envelopeId = null;
      this.status = "available";
      this.message = result.message;
      this.drafts = { ...result.fields };
      this.snapshotSummary = [];
    } else if (!result.ok) {
      this.clearDrafts(`${result.message} ${removeRejectedAssistLocalRecordFromStorage(storage, sourceSignature)}`);
    } else {
      this.drafts = { ...result.fields };
      this.envelopeId = result.envelope.recordId;
      this.status = "saved_local";
      this.message = result.message;
      this.snapshotSummary = describeAssistLocalRecordSnapshot(result.envelope);
    }
    this.dependencies.renderPanel();
  }

  clear(): void {
    const sourceSignature = this.sourceSignature();
    const storage = browserLocalStorage();
    const clearConfirmationSource = sourceSignature ?? "unavailable";
    if (this.status !== "confirm_clear" || this.clearConfirmationSourceSignature !== clearConfirmationSource) {
      this.status = "confirm_clear";
      this.clearConfirmationSourceSignature = clearConfirmationSource;
      this.message = sourceSignature
        ? "Confirm clear: click Clear local record again to remove only this browser-local record for the current source signature. Official review history and API facts are untouched."
        : "Confirm clear: click Clear local record again to clear displayed local-record drafts. No current source signature exists, so no stored record is reused.";
      this.dependencies.renderPanel();
      return;
    }
    this.clearConfirmationSourceSignature = null;
    if (sourceSignature && storage) {
      try {
        const deletedAt = deleteAssistLocalRecordFromStorage(storage, sourceSignature);
        this.message = `Local record deleted at ${deletedAt}; a source-scoped tombstone prevents stale restoration.`;
      } catch {
        this.message = "Local record deletion failed; the saved record was not removed because its tombstone could not be persisted.";
        this.status = "storage_unavailable";
        this.dependencies.renderPanel();
        return;
      }
    } else if (sourceSignature) {
      this.message = "Displayed local-record drafts cleared; browser localStorage is unavailable, so no stored record could be removed or loaded.";
    } else {
      this.message = "Displayed local-record drafts cleared; no current source signature exists, so no stored record was touched.";
    }
    this.drafts = { ...emptyAssistLocalRecordDrafts };
    this.envelopeId = null;
    this.status = sourceSignature ? "available" : "fail_closed";
    this.snapshotSummary = [];
    this.dependencies.renderPanel();
  }
}
