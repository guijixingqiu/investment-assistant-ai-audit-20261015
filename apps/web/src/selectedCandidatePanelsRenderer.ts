import type { CoreJourneyData } from "./coreJourneyState.js";
import type { CandidateMembershipRenderModel } from "./candidateMembershipState.js";
import type { AssistAdvisoryScopeRenderModel } from "./assistAdvisoryScopeState.js";
import type { AssistHumanReviewWorkspaceRenderModel } from "./assistHumanReviewWorkspaceState.js";
import type { AssistReviewFollowUpWorkflowRenderModel } from "./assistReviewFollowUpWorkflowState.js";
import type { AssistDecisionNoteWorkflowRenderModel } from "./assistDecisionNoteWorkflowState.js";
import { setUnifiedFailureStateAttribute } from "./domRender.js";
import { selectedCandidateDecisionBridgeFromState } from "./selectedCandidateDecisionBridge.js";
import {
  selectedCandidateAdvisoryScopeBridgeFromState,
  selectedCandidateDecisionContextBridgeFromState,
  selectedCandidateDecisionNoteWorkflowBridgeFromState,
  selectedCandidateFollowUpWorkflowBridgeFromState,
  selectedCandidateHumanReviewWorkspaceBridgeFromState
} from "./selectedCandidateWorkflowBridges.js";

export interface SelectedCandidatePanelsRenderContext {
  data: CoreJourneyData | null;
  busy: boolean;
  candidateMemberships: CandidateMembershipRenderModel;
  membershipBusy: boolean;
  decisionIntakeBusy: boolean;
  assistAdvisoryScope: AssistAdvisoryScopeRenderModel;
  assistAdvisoryScopeBusy: boolean;
  assistHumanReviewWorkspace: AssistHumanReviewWorkspaceRenderModel;
  assistHumanReviewWorkspaceBusy: boolean;
  assistReviewFollowUpWorkflow: AssistReviewFollowUpWorkflowRenderModel;
  assistReviewFollowUpWorkflowBusy: boolean;
  assistDecisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel;
  assistDecisionNoteWorkflowBusy: boolean;
}

export function renderSelectedCandidatePanels(context: SelectedCandidatePanelsRenderContext): void {
  renderSelectedCandidateDecisionBridgePanel(context);
  renderSelectedCandidateDecisionContextBridgePanel(context);
  renderSelectedCandidateAdvisoryScopeBridgePanel(context);
  renderSelectedCandidateHumanReviewWorkspaceBridgePanel(context);
  renderSelectedCandidateFollowUpWorkflowBridgePanel(context);
  renderSelectedCandidateDecisionNoteWorkflowBridgePanel(context);
}

function renderSelectedCandidateDecisionBridgePanel(context: SelectedCandidatePanelsRenderContext): void {
  const { data, busy, candidateMemberships, membershipBusy, decisionIntakeBusy, assistAdvisoryScope, assistAdvisoryScopeBusy, assistHumanReviewWorkspace, assistHumanReviewWorkspaceBusy, assistReviewFollowUpWorkflow, assistReviewFollowUpWorkflowBusy, assistDecisionNoteWorkflow, assistDecisionNoteWorkflowBusy } = context;
  if (typeof document === "undefined") return;
  ensureSelectedCandidateDecisionBridgePanel();
  const model = selectedCandidateDecisionBridgeFromState(data?.symbol.symbol ?? null, candidateMemberships, membershipBusy);
  const section = document.getElementById("selected-candidate-decision-bridge");
  const status = document.getElementById("selected-candidate-decision-bridge-status");
  const facts = document.getElementById("selected-candidate-decision-bridge-facts");
  const action = document.getElementById("selected-candidate-decision-intake-open");
  if (!section || !status || !facts || !(action instanceof HTMLButtonElement)) return;
  section.setAttribute("data-state", model.state);
  setUnifiedFailureStateAttribute(section, model.state);
  section.setAttribute("data-symbol", model.symbol ?? "");
  section.setAttribute("data-membership-id", model.membershipId ?? "");
  section.setAttribute("data-membership-state", model.membershipState ?? "");
  section.setAttribute("data-membership-version", model.membershipVersion === null ? "" : String(model.membershipVersion));
  section.setAttribute("data-can-open-decision-intake", String(model.canOpenDecisionIntake));
  const title = section.querySelector("h2");
  if (title) title.textContent = model.title;
  status.textContent = model.generatedAt ? `${model.message} Membership facts generated ${model.generatedAt}.` : model.message;
  action.dataset.selectedCandidateDecisionIntakeMembershipId = model.membershipId ?? "";
  action.disabled = !model.canOpenDecisionIntake || decisionIntakeBusy || membershipBusy || busy;
  facts.innerHTML = "";
  if (model.facts.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = `${model.state}: ${model.message}`;
    facts.append(empty);
    return;
  }
  for (const detail of model.facts) {
    const item = document.createElement("li");
    item.textContent = detail;
    facts.append(item);
  }
}

function ensureSelectedCandidateDecisionBridgePanel(): void {
  if (document.getElementById("selected-candidate-decision-bridge")) return;
  const host = document.getElementById("candidate-overview");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "selected-candidate-decision-bridge";
  section.className = "selected-candidate-decision-bridge";
  section.dataset.testid = "selected-candidate-decision-bridge";
  section.setAttribute("aria-label", "Selected candidate decision-intake bridge");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>Selected candidate decision bridge</h2>",
    "<button id=\"selected-candidate-decision-intake-open\" data-testid=\"selected-candidate-decision-intake-open\" type=\"button\">Decision intake</button>",
    "</div>",
    "<p id=\"selected-candidate-decision-bridge-status\"></p>",
    "<ul id=\"selected-candidate-decision-bridge-facts\"></ul>"
  ].join("");
  host.insertAdjacentElement("afterend", section);
}

function renderSelectedCandidateDecisionContextBridgePanel(context: SelectedCandidatePanelsRenderContext): void {
  const { data, busy, candidateMemberships, membershipBusy, decisionIntakeBusy, assistAdvisoryScope, assistAdvisoryScopeBusy, assistHumanReviewWorkspace, assistHumanReviewWorkspaceBusy, assistReviewFollowUpWorkflow, assistReviewFollowUpWorkflowBusy, assistDecisionNoteWorkflow, assistDecisionNoteWorkflowBusy } = context;
  if (typeof document === "undefined") return;
  ensureSelectedCandidateDecisionContextBridgePanel();
  const model = selectedCandidateDecisionContextBridgeFromState(
    data?.symbol.symbol ?? null,
    candidateMemberships,
    data?.decisionContext ?? null,
    membershipBusy,
    busy
  );
  const section = document.getElementById("selected-candidate-decision-context-bridge");
  const status = document.getElementById("selected-candidate-decision-context-bridge-status");
  const facts = document.getElementById("selected-candidate-decision-context-bridge-facts");
  if (!section || !status || !facts) return;
  section.setAttribute("data-state", model.state);
  setUnifiedFailureStateAttribute(section, model.state);
  section.setAttribute("data-symbol", model.symbol ?? "");
  section.setAttribute("data-membership-id", model.membershipId ?? "");
  section.setAttribute("data-membership-state", model.membershipState ?? "");
  section.setAttribute("data-context-id", model.contextId ?? "");
  section.setAttribute("data-context-hash", model.contextHash ?? "");
  section.setAttribute("data-quote-status", model.quoteStatus ?? "");
  section.setAttribute("data-research-status", model.researchStatus ?? "");
  section.setAttribute("data-portfolio-status", model.portfolioStatus ?? "");
  section.setAttribute("data-can-use-decision-context", String(model.canUseDecisionContext));
  const quantRefinement = data?.decisionContext?.quantEvidence.decisionEvidence;
  section.setAttribute("data-quant-refinement-status", quantRefinement?.status ?? "not_captured");
  section.setAttribute("data-quant-refinement-id", quantRefinement?.refinementId ?? "");
  const title = section.querySelector("h2");
  if (title) title.textContent = model.title;
  status.textContent = model.contextGeneratedAt ? `${model.message} Context generated ${model.contextGeneratedAt}.` : model.message;
  facts.innerHTML = "";
  if (model.facts.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = `${model.state}: ${model.message}`;
    facts.append(empty);
    return;
  }
  for (const detail of model.facts) {
    const item = document.createElement("li");
    item.textContent = detail;
    facts.append(item);
  }
}

function ensureSelectedCandidateDecisionContextBridgePanel(): void {
  if (document.getElementById("selected-candidate-decision-context-bridge")) return;
  const host = document.getElementById("selected-candidate-decision-bridge") ?? document.getElementById("candidate-overview");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "selected-candidate-decision-context-bridge";
  section.className = "selected-candidate-decision-context-bridge";
  section.dataset.testid = "selected-candidate-decision-context-bridge";
  section.setAttribute("aria-label", "Selected candidate decision-context bridge");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>Selected candidate decision-context bridge</h2>",
    "</div>",
    "<p id=\"selected-candidate-decision-context-bridge-status\"></p>",
    "<ul id=\"selected-candidate-decision-context-bridge-facts\"></ul>"
  ].join("");
  host.insertAdjacentElement("afterend", section);
}

function renderSelectedCandidateAdvisoryScopeBridgePanel(context: SelectedCandidatePanelsRenderContext): void {
  const { data, busy, candidateMemberships, membershipBusy, decisionIntakeBusy, assistAdvisoryScope, assistAdvisoryScopeBusy, assistHumanReviewWorkspace, assistHumanReviewWorkspaceBusy, assistReviewFollowUpWorkflow, assistReviewFollowUpWorkflowBusy, assistDecisionNoteWorkflow, assistDecisionNoteWorkflowBusy } = context;
  if (typeof document === "undefined") return;
  ensureSelectedCandidateAdvisoryScopeBridgePanel();
  const model = selectedCandidateAdvisoryScopeBridgeFromState(
    data?.symbol.symbol ?? null,
    candidateMemberships,
    assistAdvisoryScope,
    membershipBusy,
    assistAdvisoryScopeBusy
  );
  const section = document.getElementById("selected-candidate-advisory-scope-bridge");
  const status = document.getElementById("selected-candidate-advisory-scope-bridge-status");
  const facts = document.getElementById("selected-candidate-advisory-scope-bridge-facts");
  const action = document.getElementById("selected-candidate-advisory-scope-open");
  if (!section || !status || !facts || !(action instanceof HTMLButtonElement)) return;
  section.setAttribute("data-state", model.state);
  setUnifiedFailureStateAttribute(section, model.state);
  section.setAttribute("data-symbol", model.symbol ?? "");
  section.setAttribute("data-membership-id", model.membershipId ?? "");
  section.setAttribute("data-membership-state", model.membershipState ?? "");
  section.setAttribute("data-scope-state", model.scopeState ?? "");
  section.setAttribute("data-can-open-advisory-scope", String(model.canOpenAdvisoryScope));
  const title = section.querySelector("h2");
  if (title) title.textContent = model.title;
  status.textContent = model.scopeGeneratedAt ? `${model.message} Scope generated ${model.scopeGeneratedAt}.` : model.message;
  action.dataset.selectedCandidateAdvisoryScopeMembershipId = model.membershipId ?? "";
  action.disabled = !model.canOpenAdvisoryScope || assistAdvisoryScopeBusy || membershipBusy || busy;
  facts.innerHTML = "";
  if (model.facts.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = `${model.state}: ${model.message}`;
    facts.append(empty);
    return;
  }
  for (const detail of model.facts) {
    const item = document.createElement("li");
    item.textContent = detail;
    facts.append(item);
  }
}

function ensureSelectedCandidateAdvisoryScopeBridgePanel(): void {
  if (document.getElementById("selected-candidate-advisory-scope-bridge")) return;
  const host = document.getElementById("selected-candidate-decision-context-bridge")
    ?? document.getElementById("selected-candidate-decision-bridge")
    ?? document.getElementById("candidate-overview");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "selected-candidate-advisory-scope-bridge";
  section.className = "selected-candidate-advisory-scope-bridge";
  section.dataset.testid = "selected-candidate-advisory-scope-bridge";
  section.setAttribute("aria-label", "Selected candidate advisory-scope bridge");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>Selected candidate advisory bridge</h2>",
    "<button id=\"selected-candidate-advisory-scope-open\" data-testid=\"selected-candidate-advisory-scope-open\" data-selected-candidate-advisory-scope-membership-id=\"\" type=\"button\">Advisory scope</button>",
    "</div>",
    "<p id=\"selected-candidate-advisory-scope-bridge-status\"></p>",
    "<ul id=\"selected-candidate-advisory-scope-bridge-facts\"></ul>"
  ].join("");
  host.insertAdjacentElement("afterend", section);
}

function renderSelectedCandidateHumanReviewWorkspaceBridgePanel(context: SelectedCandidatePanelsRenderContext): void {
  const { data, busy, candidateMemberships, membershipBusy, decisionIntakeBusy, assistAdvisoryScope, assistAdvisoryScopeBusy, assistHumanReviewWorkspace, assistHumanReviewWorkspaceBusy, assistReviewFollowUpWorkflow, assistReviewFollowUpWorkflowBusy, assistDecisionNoteWorkflow, assistDecisionNoteWorkflowBusy } = context;
  if (typeof document === "undefined") return;
  ensureSelectedCandidateHumanReviewWorkspaceBridgePanel();
  const model = selectedCandidateHumanReviewWorkspaceBridgeFromState(
    data?.symbol.symbol ?? null,
    candidateMemberships,
    assistHumanReviewWorkspace,
    membershipBusy,
    assistHumanReviewWorkspaceBusy
  );
  const section = document.getElementById("selected-candidate-human-review-bridge");
  const status = document.getElementById("selected-candidate-human-review-bridge-status");
  const facts = document.getElementById("selected-candidate-human-review-bridge-facts");
  const action = document.getElementById("selected-candidate-human-review-open");
  if (!section || !status || !facts || !(action instanceof HTMLButtonElement)) return;
  section.setAttribute("data-state", model.state);
  setUnifiedFailureStateAttribute(section, model.state);
  section.setAttribute("data-symbol", model.symbol ?? "");
  section.setAttribute("data-membership-id", model.membershipId ?? "");
  section.setAttribute("data-membership-state", model.membershipState ?? "");
  section.setAttribute("data-workspace-state", model.workspaceState ?? "");
  section.setAttribute("data-can-open-human-review-workspace", String(model.canOpenHumanReviewWorkspace));
  const title = section.querySelector("h2");
  if (title) title.textContent = model.title;
  status.textContent = model.workspaceGeneratedAt ? `${model.message} Workspace generated ${model.workspaceGeneratedAt}.` : model.message;
  action.dataset.selectedCandidateHumanReviewWorkspaceMembershipId = model.membershipId ?? "";
  action.disabled = !model.canOpenHumanReviewWorkspace || assistHumanReviewWorkspaceBusy || membershipBusy || busy;
  facts.innerHTML = "";
  if (model.facts.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = `${model.state}: ${model.message}`;
    facts.append(empty);
    return;
  }
  for (const detail of model.facts) {
    const item = document.createElement("li");
    item.textContent = detail;
    facts.append(item);
  }
}

function ensureSelectedCandidateHumanReviewWorkspaceBridgePanel(): void {
  if (document.getElementById("selected-candidate-human-review-bridge")) return;
  const host = document.getElementById("selected-candidate-advisory-scope-bridge")
    ?? document.getElementById("selected-candidate-decision-bridge")
    ?? document.getElementById("candidate-overview");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "selected-candidate-human-review-bridge";
  section.className = "selected-candidate-human-review-bridge";
  section.dataset.testid = "selected-candidate-human-review-bridge";
  section.setAttribute("aria-label", "Selected candidate human-review workspace bridge");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>Selected candidate human-review bridge</h2>",
    "<button id=\"selected-candidate-human-review-open\" data-testid=\"selected-candidate-human-review-open\" data-selected-candidate-human-review-workspace-membership-id=\"\" type=\"button\">Human review</button>",
    "</div>",
    "<p id=\"selected-candidate-human-review-bridge-status\"></p>",
    "<ul id=\"selected-candidate-human-review-bridge-facts\"></ul>"
  ].join("");
  host.insertAdjacentElement("afterend", section);
}

function renderSelectedCandidateFollowUpWorkflowBridgePanel(context: SelectedCandidatePanelsRenderContext): void {
  const { data, busy, candidateMemberships, membershipBusy, decisionIntakeBusy, assistAdvisoryScope, assistAdvisoryScopeBusy, assistHumanReviewWorkspace, assistHumanReviewWorkspaceBusy, assistReviewFollowUpWorkflow, assistReviewFollowUpWorkflowBusy, assistDecisionNoteWorkflow, assistDecisionNoteWorkflowBusy } = context;
  if (typeof document === "undefined") return;
  ensureSelectedCandidateFollowUpWorkflowBridgePanel();
  const model = selectedCandidateFollowUpWorkflowBridgeFromState(
    data?.symbol.symbol ?? null,
    candidateMemberships,
    assistReviewFollowUpWorkflow,
    membershipBusy,
    assistReviewFollowUpWorkflowBusy
  );
  const section = document.getElementById("selected-candidate-follow-up-bridge");
  const status = document.getElementById("selected-candidate-follow-up-bridge-status");
  const facts = document.getElementById("selected-candidate-follow-up-bridge-facts");
  const action = document.getElementById("selected-candidate-follow-up-open");
  if (!section || !status || !facts || !(action instanceof HTMLButtonElement)) return;
  section.setAttribute("data-state", model.state);
  setUnifiedFailureStateAttribute(section, model.state);
  section.setAttribute("data-symbol", model.symbol ?? "");
  section.setAttribute("data-membership-id", model.membershipId ?? "");
  section.setAttribute("data-membership-state", model.membershipState ?? "");
  section.setAttribute("data-workflow-state", model.workflowState ?? "");
  section.setAttribute("data-can-open-follow-up-workflow", String(model.canOpenFollowUpWorkflow));
  const title = section.querySelector("h2");
  if (title) title.textContent = model.title;
  status.textContent = model.workflowGeneratedAt ? `${model.message} Workflow generated ${model.workflowGeneratedAt}.` : model.message;
  action.dataset.selectedCandidateFollowUpMembershipId = model.membershipId ?? "";
  action.disabled = !model.canOpenFollowUpWorkflow || assistReviewFollowUpWorkflowBusy || membershipBusy || busy;
  facts.innerHTML = "";
  if (model.facts.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = `${model.state}: ${model.message}`;
    facts.append(empty);
    return;
  }
  for (const detail of model.facts) {
    const item = document.createElement("li");
    item.textContent = detail;
    facts.append(item);
  }
}

function ensureSelectedCandidateFollowUpWorkflowBridgePanel(): void {
  if (document.getElementById("selected-candidate-follow-up-bridge")) return;
  const host = document.getElementById("selected-candidate-human-review-bridge")
    ?? document.getElementById("selected-candidate-advisory-scope-bridge")
    ?? document.getElementById("selected-candidate-decision-bridge")
    ?? document.getElementById("candidate-overview");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "selected-candidate-follow-up-bridge";
  section.className = "selected-candidate-follow-up-bridge";
  section.dataset.testid = "selected-candidate-follow-up-bridge";
  section.setAttribute("aria-label", "Selected candidate follow-up workflow bridge");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>Selected candidate follow-up bridge</h2>",
    "<button id=\"selected-candidate-follow-up-open\" data-testid=\"selected-candidate-follow-up-open\" data-selected-candidate-follow-up-membership-id=\"\" type=\"button\">Review follow-up</button>",
    "</div>",
    "<p id=\"selected-candidate-follow-up-bridge-status\"></p>",
    "<ul id=\"selected-candidate-follow-up-bridge-facts\"></ul>"
  ].join("");
  host.insertAdjacentElement("afterend", section);
}

function renderSelectedCandidateDecisionNoteWorkflowBridgePanel(context: SelectedCandidatePanelsRenderContext): void {
  const { data, busy, candidateMemberships, membershipBusy, decisionIntakeBusy, assistAdvisoryScope, assistAdvisoryScopeBusy, assistHumanReviewWorkspace, assistHumanReviewWorkspaceBusy, assistReviewFollowUpWorkflow, assistReviewFollowUpWorkflowBusy, assistDecisionNoteWorkflow, assistDecisionNoteWorkflowBusy } = context;
  if (typeof document === "undefined") return;
  ensureSelectedCandidateDecisionNoteWorkflowBridgePanel();
  const model = selectedCandidateDecisionNoteWorkflowBridgeFromState(
    data?.symbol.symbol ?? null,
    candidateMemberships,
    assistDecisionNoteWorkflow,
    membershipBusy,
    assistDecisionNoteWorkflowBusy
  );
  const section = document.getElementById("selected-candidate-decision-note-bridge");
  const status = document.getElementById("selected-candidate-decision-note-bridge-status");
  const facts = document.getElementById("selected-candidate-decision-note-bridge-facts");
  const action = document.getElementById("selected-candidate-decision-note-open");
  if (!section || !status || !facts || !(action instanceof HTMLButtonElement)) return;
  section.setAttribute("data-state", model.state);
  setUnifiedFailureStateAttribute(section, model.state);
  section.setAttribute("data-symbol", model.symbol ?? "");
  section.setAttribute("data-membership-id", model.membershipId ?? "");
  section.setAttribute("data-membership-state", model.membershipState ?? "");
  section.setAttribute("data-workflow-state", model.workflowState ?? "");
  section.setAttribute("data-can-open-decision-note-workflow", String(model.canOpenDecisionNoteWorkflow));
  const title = section.querySelector("h2");
  if (title) title.textContent = model.title;
  status.textContent = model.workflowGeneratedAt ? `${model.message} Workflow generated ${model.workflowGeneratedAt}.` : model.message;
  action.dataset.selectedCandidateDecisionNoteMembershipId = model.membershipId ?? "";
  action.disabled = !model.canOpenDecisionNoteWorkflow || assistDecisionNoteWorkflowBusy || membershipBusy || busy;
  facts.innerHTML = "";
  if (model.facts.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = `${model.state}: ${model.message}`;
    facts.append(empty);
    return;
  }
  for (const detail of model.facts) {
    const item = document.createElement("li");
    item.textContent = detail;
    facts.append(item);
  }
}

function ensureSelectedCandidateDecisionNoteWorkflowBridgePanel(): void {
  if (document.getElementById("selected-candidate-decision-note-bridge")) return;
  const host = document.getElementById("selected-candidate-follow-up-bridge")
    ?? document.getElementById("selected-candidate-decision-bridge")
    ?? document.getElementById("candidate-overview");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "selected-candidate-decision-note-bridge";
  section.className = "selected-candidate-decision-note-bridge";
  section.dataset.testid = "selected-candidate-decision-note-bridge";
  section.setAttribute("aria-label", "Selected candidate decision-note workflow bridge");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>Selected candidate decision-note bridge</h2>",
    "<button id=\"selected-candidate-decision-note-open\" data-testid=\"selected-candidate-decision-note-open\" data-selected-candidate-decision-note-membership-id=\"\" type=\"button\">Decision note</button>",
    "</div>",
    "<p id=\"selected-candidate-decision-note-bridge-status\"></p>",
    "<ul id=\"selected-candidate-decision-note-bridge-facts\"></ul>"
  ].join("");
  host.insertAdjacentElement("afterend", section);
}
