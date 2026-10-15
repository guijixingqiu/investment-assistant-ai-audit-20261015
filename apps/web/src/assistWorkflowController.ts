import { type WebApiAuth, WebApiClient } from "./apiClient.js";
import {
  assistAdvisoryScopeFromEnvelope,
  failClosedAssistAdvisoryScope,
  initialAssistAdvisoryScope,
  loadingAssistAdvisoryScope,
  type AssistAdvisoryScopeRenderModel
} from "./assistAdvisoryScopeState.js";
import {
  assistHumanReviewWorkspaceFromEnvelope,
  failClosedAssistHumanReviewWorkspace,
  initialAssistHumanReviewWorkspace,
  loadingAssistHumanReviewWorkspace,
  type AssistHumanReviewWorkspaceRenderModel
} from "./assistHumanReviewWorkspaceState.js";
import {
  assistReviewFollowUpDraftSummary,
  assistReviewFollowUpWorkflowFromEnvelope,
  emptyAssistReviewFollowUpDrafts,
  failClosedAssistReviewFollowUpWorkflow,
  initialAssistReviewFollowUpWorkflow,
  loadingAssistReviewFollowUpWorkflow,
  type AssistReviewFollowUpDrafts,
  type AssistReviewFollowUpWorkflowRenderModel
} from "./assistReviewFollowUpWorkflowState.js";
import {
  assistDecisionNoteDraftSummary,
  assistDecisionNoteWorkflowFromEnvelope,
  emptyAssistDecisionNoteDrafts,
  failClosedAssistDecisionNoteWorkflow,
  initialAssistDecisionNoteWorkflow,
  loadingAssistDecisionNoteWorkflow,
  type AssistDecisionNoteDrafts,
  type AssistDecisionNoteWorkflowRenderModel
} from "./assistDecisionNoteWorkflowState.js";

export type AssistSourceFailureState = "unauthorized" | "not_found" | "conflict" | "malformed" | "offline" | "unavailable";

export interface AssistWorkflowControllerDependencies {
  client: WebApiClient;
  readAuth: () => WebApiAuth | null;
  paint: () => void;
  clearLocalRecord: (message: string) => void;
  markLocalRecordAvailable: () => void;
  restoreKnowledge: (symbol: string) => void;
}

function decisionNoteFailureState(state: AssistSourceFailureState, reason: string): AssistSourceFailureState | "superseded" {
  if (state === "offline" && reason.toLowerCase().includes("superseded")) return "superseded";
  return state;
}

export class AssistWorkflowController {
  advisoryScope: AssistAdvisoryScopeRenderModel = initialAssistAdvisoryScope;
  advisoryScopeBusy = false;
  humanReviewWorkspace: AssistHumanReviewWorkspaceRenderModel = initialAssistHumanReviewWorkspace;
  humanReviewWorkspaceBusy = false;
  reviewFollowUpWorkflow: AssistReviewFollowUpWorkflowRenderModel = initialAssistReviewFollowUpWorkflow;
  reviewFollowUpWorkflowBusy = false;
  reviewFollowUpDrafts: AssistReviewFollowUpDrafts = { ...emptyAssistReviewFollowUpDrafts };
  decisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel = initialAssistDecisionNoteWorkflow;
  decisionNoteWorkflowBusy = false;
  decisionNoteDrafts: AssistDecisionNoteDrafts = { ...emptyAssistDecisionNoteDrafts };

  private advisoryGeneration = 0;
  private humanReviewGeneration = 0;
  private followUpGeneration = 0;
  private decisionNoteGeneration = 0;

  constructor(private readonly dependencies: AssistWorkflowControllerDependencies) {}

  hasLoadedPath(): boolean {
    return this.advisoryScope.state !== "idle"
      || this.humanReviewWorkspace.state !== "idle"
      || this.reviewFollowUpWorkflow.state !== "idle"
      || this.decisionNoteWorkflow.state !== "idle";
  }

  clearFromDecisionIntake(state: AssistSourceFailureState, message: string, membershipId: string | null, localRecordMessage: string): void {
    this.advisoryGeneration += 1;
    this.advisoryScopeBusy = false;
    this.advisoryScope = failClosedAssistAdvisoryScope(state, message, membershipId);
    this.clearFromAdvisoryScope(state, message, membershipId, localRecordMessage);
  }

  clearFromAdvisoryScope(state: AssistSourceFailureState, message: string, membershipId: string | null, localRecordMessage: string): void {
    this.humanReviewGeneration += 1;
    this.humanReviewWorkspaceBusy = false;
    this.humanReviewWorkspace = failClosedAssistHumanReviewWorkspace(state, message, membershipId);
    this.clearFromHumanReviewWorkspace(state, message, membershipId, localRecordMessage);
  }

  clearFromHumanReviewWorkspace(state: AssistSourceFailureState, message: string, membershipId: string | null, localRecordMessage: string): void {
    this.followUpGeneration += 1;
    this.reviewFollowUpWorkflowBusy = false;
    this.reviewFollowUpDrafts = { ...emptyAssistReviewFollowUpDrafts };
    this.reviewFollowUpWorkflow = failClosedAssistReviewFollowUpWorkflow(state, message, membershipId);
    this.decisionNoteGeneration += 1;
    this.decisionNoteWorkflowBusy = false;
    this.decisionNoteDrafts = { ...emptyAssistDecisionNoteDrafts };
    this.decisionNoteWorkflow = failClosedAssistDecisionNoteWorkflow(decisionNoteFailureState(state, message), message, membershipId);
    this.dependencies.clearLocalRecord(localRecordMessage);
  }

  async loadAdvisoryScope(membershipId: string): Promise<void> {
    const currentAuth = this.dependencies.readAuth();
    const generation = ++this.advisoryGeneration;
    if (!currentAuth) {
      this.advisoryScopeBusy = false;
      this.advisoryScope = failClosedAssistAdvisoryScope("unauthorized", "Runtime read token is required before loading ASSIST advisory scope.", membershipId);
      this.clearFromAdvisoryScope("unauthorized", "Runtime read token is required before loading downstream ASSIST workspace facts.", membershipId, "Runtime read token is required before displaying local records.");
      this.dependencies.paint();
      return;
    }
    this.advisoryScopeBusy = true;
    this.advisoryScope = loadingAssistAdvisoryScope(membershipId);
    this.clearFromAdvisoryScope("unavailable", "Advisory-scope source is loading; downstream workspace facts must reload for the current membership.", membershipId, "Advisory-scope source is loading; local records are hidden until current workspace facts reload.");
    this.dependencies.paint();
    const result = await this.dependencies.client.loadAssistAdvisoryScope(currentAuth, membershipId);
    if (generation !== this.advisoryGeneration) return;
    this.advisoryScopeBusy = false;
    if (!result.ok) {
      this.advisoryScope = failClosedAssistAdvisoryScope(result.state, result.reason, membershipId);
      this.clearFromAdvisoryScope(result.state, result.reason, membershipId, "Advisory-scope load failed; local records are hidden until current source facts are available.");
    } else {
      this.advisoryScope = assistAdvisoryScopeFromEnvelope(result.value);
    }
    this.dependencies.paint();
  }

  async loadHumanReviewWorkspace(membershipId: string): Promise<void> {
    const currentAuth = this.dependencies.readAuth();
    const generation = ++this.humanReviewGeneration;
    if (!currentAuth) {
      this.humanReviewWorkspaceBusy = false;
      this.humanReviewWorkspace = failClosedAssistHumanReviewWorkspace("unauthorized", "Runtime read token is required before loading ASSIST human-review workspace.", membershipId);
      this.clearFromHumanReviewWorkspace("unauthorized", "Runtime read token is required before loading downstream follow-up facts.", membershipId, "Runtime read token is required before displaying local records.");
      this.dependencies.paint();
      return;
    }
    this.humanReviewWorkspaceBusy = true;
    this.humanReviewWorkspace = loadingAssistHumanReviewWorkspace(membershipId);
    this.clearFromHumanReviewWorkspace("unavailable", "Human-review workspace source is loading; follow-up and decision-note facts must reload for the current membership.", membershipId, "Human-review workspace source is loading; local records are hidden until current follow-up facts reload.");
    this.dependencies.paint();
    const result = await this.dependencies.client.loadAssistHumanReviewWorkspace(currentAuth, membershipId);
    if (generation !== this.humanReviewGeneration) return;
    this.humanReviewWorkspaceBusy = false;
    if (!result.ok) {
      this.humanReviewWorkspace = failClosedAssistHumanReviewWorkspace(result.state, result.reason, membershipId);
      this.clearFromHumanReviewWorkspace(result.state, result.reason, membershipId, "Human-review workspace load failed; local records are hidden until current source facts are available.");
    } else {
      this.humanReviewWorkspace = assistHumanReviewWorkspaceFromEnvelope(result.value);
    }
    this.dependencies.paint();
  }

  async loadReviewFollowUpWorkflow(membershipId: string): Promise<void> {
    const currentAuth = this.dependencies.readAuth();
    const generation = ++this.followUpGeneration;
    this.reviewFollowUpDrafts = { ...emptyAssistReviewFollowUpDrafts };
    this.decisionNoteDrafts = { ...emptyAssistDecisionNoteDrafts };
    this.dependencies.clearLocalRecord("Source follow-up workflow changed; local records are hidden until current decision-note facts reload.");
    this.decisionNoteWorkflow = failClosedAssistDecisionNoteWorkflow("superseded", "Source follow-up workflow changed; reload ASSIST decision-note workflow for current facts only.", membershipId);
    if (!currentAuth) {
      this.reviewFollowUpWorkflowBusy = false;
      this.reviewFollowUpWorkflow = failClosedAssistReviewFollowUpWorkflow("unauthorized", "Runtime read token is required before loading ASSIST review follow-up workflow.", membershipId);
      this.decisionNoteWorkflow = failClosedAssistDecisionNoteWorkflow("unauthorized", "Runtime read token is required before loading ASSIST decision-note workflow.", membershipId);
      this.dependencies.clearLocalRecord("Runtime read token is required before displaying local records.");
      this.dependencies.paint();
      return;
    }
    this.reviewFollowUpWorkflowBusy = true;
    this.reviewFollowUpWorkflow = loadingAssistReviewFollowUpWorkflow(membershipId);
    this.dependencies.paint();
    const result = await this.dependencies.client.loadAssistReviewFollowUpWorkflow(currentAuth, membershipId);
    if (generation !== this.followUpGeneration) return;
    this.reviewFollowUpWorkflowBusy = false;
    if (!result.ok) {
      this.reviewFollowUpDrafts = { ...emptyAssistReviewFollowUpDrafts };
      this.decisionNoteDrafts = { ...emptyAssistDecisionNoteDrafts };
      this.dependencies.clearLocalRecord("Follow-up workflow load failed; local records are hidden until current source facts are available.");
      this.reviewFollowUpWorkflow = failClosedAssistReviewFollowUpWorkflow(result.state, result.reason, membershipId);
      this.decisionNoteWorkflow = failClosedAssistDecisionNoteWorkflow(decisionNoteFailureState(result.state, result.reason), result.reason, membershipId);
    } else {
      this.reviewFollowUpWorkflow = assistReviewFollowUpWorkflowFromEnvelope(result.value, this.reviewFollowUpDrafts);
    }
    this.dependencies.paint();
  }

  async loadDecisionNoteWorkflow(membershipId: string): Promise<void> {
    const currentAuth = this.dependencies.readAuth();
    const generation = ++this.decisionNoteGeneration;
    this.decisionNoteDrafts = { ...emptyAssistDecisionNoteDrafts };
    this.dependencies.clearLocalRecord("Decision-note workflow is loading; local records are hidden until current source facts are accepted.");
    if (!currentAuth) {
      this.decisionNoteWorkflowBusy = false;
      this.decisionNoteWorkflow = failClosedAssistDecisionNoteWorkflow("unauthorized", "Runtime read token is required before loading ASSIST decision-note workflow.", membershipId);
      this.dependencies.clearLocalRecord("Runtime read token is required before displaying local records.");
      this.dependencies.paint();
      return;
    }
    this.decisionNoteWorkflowBusy = true;
    this.decisionNoteWorkflow = loadingAssistDecisionNoteWorkflow(membershipId);
    this.dependencies.paint();
    const result = await this.dependencies.client.loadAssistDecisionNoteWorkflow(currentAuth, membershipId);
    if (generation !== this.decisionNoteGeneration) return;
    this.decisionNoteWorkflowBusy = false;
    if (!result.ok) {
      this.decisionNoteDrafts = { ...emptyAssistDecisionNoteDrafts };
      this.dependencies.clearLocalRecord("Decision-note workflow load failed; local records are hidden until current source facts are available.");
      this.decisionNoteWorkflow = failClosedAssistDecisionNoteWorkflow(decisionNoteFailureState(result.state, result.reason), result.reason, membershipId);
    } else {
      this.decisionNoteWorkflow = assistDecisionNoteWorkflowFromEnvelope(result.value, this.decisionNoteDrafts);
      this.dependencies.markLocalRecordAvailable();
      if (this.decisionNoteWorkflow.symbol) this.dependencies.restoreKnowledge(this.decisionNoteWorkflow.symbol);
    }
    this.dependencies.paint();
  }

  updateDecisionNoteDraft(decisionNote: string): void {
    this.decisionNoteDrafts = { decisionNote };
    this.decisionNoteWorkflow = {
      ...this.decisionNoteWorkflow,
      localDrafts: { ...this.decisionNoteDrafts },
      draftSummary: assistDecisionNoteDraftSummary(this.decisionNoteDrafts)
    };
  }

  updateFollowUpDrafts(drafts: AssistReviewFollowUpDrafts): void {
    this.reviewFollowUpDrafts = drafts;
    this.reviewFollowUpWorkflow = {
      ...this.reviewFollowUpWorkflow,
      localDrafts: { ...drafts },
      draftSummary: assistReviewFollowUpDraftSummary(drafts)
    };
  }
}
