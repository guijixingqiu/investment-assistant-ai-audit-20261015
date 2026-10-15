import type { CandidateDecisionIntakeRenderModel } from "./candidateDecisionIntakeState.js";
import type { AssistAdvisoryScopeRenderModel } from "./assistAdvisoryScopeState.js";
import type { AssistHumanReviewWorkspaceRenderModel } from "./assistHumanReviewWorkspaceState.js";
import type { AssistReviewFollowUpWorkflowRenderModel } from "./assistReviewFollowUpWorkflowState.js";
import type { AssistDecisionNoteWorkflowRenderModel } from "./assistDecisionNoteWorkflowState.js";
import { renderList } from "./domRender.js";

export interface AssistWorkflowPanelsRenderContext {
  busy: boolean;
  membershipBusy: boolean;
  decisionIntake: CandidateDecisionIntakeRenderModel;
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

export function renderAssistWorkflowPanels(context: AssistWorkflowPanelsRenderContext): void {
  renderDecisionIntakePanel(context);
  renderAssistAdvisoryScopePanel(context);
  renderAssistHumanReviewWorkspacePanel(context);
  renderAssistReviewFollowUpWorkflowPanel(context);
  renderAssistDecisionNoteWorkflowPanel(context);
}

function renderDecisionIntakePanel(context: AssistWorkflowPanelsRenderContext): void {
  const { busy, membershipBusy, decisionIntake, decisionIntakeBusy, assistAdvisoryScope, assistAdvisoryScopeBusy, assistHumanReviewWorkspace, assistHumanReviewWorkspaceBusy, assistReviewFollowUpWorkflow, assistReviewFollowUpWorkflowBusy, assistDecisionNoteWorkflow, assistDecisionNoteWorkflowBusy } = context;
  if (typeof document === "undefined") return;
  ensureDecisionIntakePanel();
  const section = document.getElementById("candidate-decision-intake");
  const status = document.getElementById("decision-intake-status");
  const facts = document.getElementById("decision-intake-facts");
  if (!section || !status || !facts) return;
  section.setAttribute("data-state", decisionIntake.state);
  section.setAttribute("data-busy", String(decisionIntakeBusy));
  section.setAttribute("data-membership-id", decisionIntake.membershipId ?? "");
  section.setAttribute("data-next-action", decisionIntake.nextAction ?? "");
  const title = section.querySelector("h2");
  if (title) title.textContent = decisionIntake.title;
  status.textContent = decisionIntake.generatedAt ? `${decisionIntake.message} Generated ${decisionIntake.generatedAt}.` : decisionIntake.message;
  facts.innerHTML = "";
  if (decisionIntake.facts.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = `${decisionIntake.state}: ${decisionIntake.message}`;
    facts.append(empty);
  } else {
    for (const detail of decisionIntake.facts) {
      const item = document.createElement("li");
      item.textContent = detail;
      facts.append(item);
    }
  }
  for (const card of document.querySelectorAll<HTMLElement>("#membership-list [data-membership-id]")) {
    const actions = card.querySelector(".membership-actions");
    const membershipId = card.dataset.membershipId ?? "";
    if (!actions || actions.querySelector("[data-decision-intake-membership-id]")) continue;
    const action = document.createElement("button");
    action.type = "button";
    action.dataset.testid = "membership-decision-intake";
    action.dataset.decisionIntakeMembershipId = membershipId;
    action.disabled = decisionIntakeBusy || membershipBusy || busy;
    action.textContent = "Decision intake";
    actions.append(action);
  }
}

function ensureDecisionIntakePanel(): void {
  if (document.getElementById("candidate-decision-intake")) return;
  const host = document.getElementById("candidate-memberships");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "candidate-decision-intake";
  section.className = "candidate-decision-intake";
  section.dataset.testid = "candidate-decision-intake";
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>Decision intake</h2>",
    "</div>",
    "<p id=\"decision-intake-status\"></p>",
    "<ul id=\"decision-intake-facts\"></ul>"
  ].join("");
  host.insertAdjacentElement("afterend", section);
}

function renderAssistAdvisoryScopePanel(context: AssistWorkflowPanelsRenderContext): void {
  const { busy, membershipBusy, decisionIntake, decisionIntakeBusy, assistAdvisoryScope, assistAdvisoryScopeBusy, assistHumanReviewWorkspace, assistHumanReviewWorkspaceBusy, assistReviewFollowUpWorkflow, assistReviewFollowUpWorkflowBusy, assistDecisionNoteWorkflow, assistDecisionNoteWorkflowBusy } = context;
  if (typeof document === "undefined") return;
  ensureAssistAdvisoryScopePanel();
  const section = document.getElementById("assist-advisory-scope");
  const status = document.getElementById("assist-advisory-scope-status");
  const facts = document.getElementById("assist-advisory-scope-facts");
  const limitations = document.getElementById("assist-advisory-scope-limitations");
  const continuations = document.getElementById("assist-advisory-scope-continuations");
  const safety = document.getElementById("assist-advisory-scope-safety");
  if (!section || !status || !facts || !limitations || !continuations || !safety) return;
  section.setAttribute("data-state", assistAdvisoryScope.state);
  section.setAttribute("data-busy", String(assistAdvisoryScopeBusy));
  section.setAttribute("data-membership-id", assistAdvisoryScope.membershipId ?? "");
  const title = section.querySelector("h2");
  if (title) title.textContent = assistAdvisoryScope.title;
  status.textContent = assistAdvisoryScope.generatedAt ? `${assistAdvisoryScope.message} Generated ${assistAdvisoryScope.generatedAt}.` : assistAdvisoryScope.message;
  renderList(facts, assistAdvisoryScope.facts, `${assistAdvisoryScope.state}: ${assistAdvisoryScope.message}`);
  renderList(limitations, assistAdvisoryScope.limitations, "No limitations are displayable for the current ASSIST advisory scope.");
  renderList(continuations, assistAdvisoryScope.continuations, "No continuation is available until facts are loaded.");
  renderList(safety, assistAdvisoryScope.safety, "Safety proof is unavailable until a valid envelope is loaded.");
  for (const card of document.querySelectorAll<HTMLElement>("#membership-list [data-membership-id]")) {
    const actions = card.querySelector(".membership-actions");
    const membershipId = card.dataset.membershipId ?? "";
    if (!actions || actions.querySelector("[data-advisory-scope-membership-id]")) continue;
    const action = document.createElement("button");
    action.type = "button";
    action.dataset.testid = "membership-advisory-scope";
    action.dataset.advisoryScopeMembershipId = membershipId;
    action.disabled = assistAdvisoryScopeBusy || membershipBusy || busy;
    action.textContent = "Advisory scope";
    actions.append(action);
  }
}

function renderAssistHumanReviewWorkspacePanel(context: AssistWorkflowPanelsRenderContext): void {
  const { busy, membershipBusy, decisionIntake, decisionIntakeBusy, assistAdvisoryScope, assistAdvisoryScopeBusy, assistHumanReviewWorkspace, assistHumanReviewWorkspaceBusy, assistReviewFollowUpWorkflow, assistReviewFollowUpWorkflowBusy, assistDecisionNoteWorkflow, assistDecisionNoteWorkflowBusy } = context;
  if (typeof document === "undefined") return;
  ensureAssistHumanReviewWorkspacePanel();
  const section = document.getElementById("assist-human-review-workspace");
  const status = document.getElementById("assist-human-review-workspace-status");
  const readiness = document.getElementById("assist-human-review-workspace-readiness");
  const evidenceGroups = document.getElementById("assist-human-review-workspace-evidence-groups");
  const limitations = document.getElementById("assist-human-review-workspace-limitations");
  const continuations = document.getElementById("assist-human-review-workspace-continuations");
  const followUp = document.getElementById("assist-human-review-workspace-follow-up");
  const boundaries = document.getElementById("assist-human-review-workspace-boundaries");
  const failClosed = document.getElementById("assist-human-review-workspace-fail-closed");
  const provenance = document.getElementById("assist-human-review-workspace-provenance");
  if (!section || !status || !readiness || !evidenceGroups || !limitations || !continuations || !followUp || !boundaries || !failClosed || !provenance) return;
  section.setAttribute("data-state", assistHumanReviewWorkspace.state);
  section.setAttribute("data-busy", String(assistHumanReviewWorkspaceBusy));
  section.setAttribute("data-membership-id", assistHumanReviewWorkspace.membershipId ?? "");
  const title = section.querySelector("h2");
  if (title) title.textContent = assistHumanReviewWorkspace.title;
  status.textContent = assistHumanReviewWorkspace.generatedAt ? `${assistHumanReviewWorkspace.message} Generated ${assistHumanReviewWorkspace.generatedAt}.` : assistHumanReviewWorkspace.message;
  renderList(readiness, assistHumanReviewWorkspace.readiness, `${assistHumanReviewWorkspace.state}: ${assistHumanReviewWorkspace.message}`);
  renderList(evidenceGroups, assistHumanReviewWorkspace.evidenceGroups, "No workspace evidence groups are displayable for this fail-closed or empty state.");
  renderList(limitations, assistHumanReviewWorkspace.limitations, "No limitation detail is displayable until a valid workspace is loaded.");
  renderList(continuations, assistHumanReviewWorkspace.continuations, "No local continuation is available until facts are loaded.");
  renderList(followUp, assistHumanReviewWorkspace.followUp, "No local follow-up intent is available until facts are loaded.");
  renderList(boundaries, assistHumanReviewWorkspace.boundaries, "Safety boundaries are unavailable until a valid workspace is loaded.");
  renderList(failClosed, assistHumanReviewWorkspace.failClosed, "Fail-closed proof is unavailable until a workspace is loaded.");
  renderList(provenance, assistHumanReviewWorkspace.provenance, "Source provenance is unavailable until a workspace is loaded.");
  for (const card of document.querySelectorAll<HTMLElement>("#membership-list [data-membership-id]")) {
    const actions = card.querySelector(".membership-actions");
    const membershipId = card.dataset.membershipId ?? "";
    if (!actions || actions.querySelector("[data-human-review-workspace-membership-id]")) continue;
    const action = document.createElement("button");
    action.type = "button";
    action.dataset.testid = "membership-human-review-workspace";
    action.dataset.humanReviewWorkspaceMembershipId = membershipId;
    action.disabled = assistHumanReviewWorkspaceBusy || membershipBusy || busy;
    action.textContent = "Human review workspace";
    actions.append(action);
  }
}

function renderAssistReviewFollowUpWorkflowPanel(context: AssistWorkflowPanelsRenderContext): void {
  const { busy, membershipBusy, decisionIntake, decisionIntakeBusy, assistAdvisoryScope, assistAdvisoryScopeBusy, assistHumanReviewWorkspace, assistHumanReviewWorkspaceBusy, assistReviewFollowUpWorkflow, assistReviewFollowUpWorkflowBusy, assistDecisionNoteWorkflow, assistDecisionNoteWorkflowBusy } = context;
  if (typeof document === "undefined") return;
  ensureAssistReviewFollowUpWorkflowPanel();
  const section = document.getElementById("assist-review-follow-up-workflow");
  const status = document.getElementById("assist-review-follow-up-workflow-status");
  const steps = document.getElementById("assist-review-follow-up-workflow-steps");
  const intents = document.getElementById("assist-review-follow-up-workflow-intents");
  const gaps = document.getElementById("assist-review-follow-up-workflow-evidence-gaps");
  const views = document.getElementById("assist-review-follow-up-workflow-local-views");
  const blocked = document.getElementById("assist-review-follow-up-workflow-blocked-actions");
  const draftSummary = document.getElementById("assist-review-follow-up-workflow-draft-summary");
  const safety = document.getElementById("assist-review-follow-up-workflow-safety");
  const failClosed = document.getElementById("assist-review-follow-up-workflow-fail-closed");
  const manualNote = document.getElementById("assist-review-follow-up-manual-note");
  const laterReview = document.getElementById("assist-review-follow-up-later-review");
  const evidenceGaps = document.getElementById("assist-review-follow-up-evidence-gaps");
  if (!section || !status || !steps || !intents || !gaps || !views || !blocked || !draftSummary || !safety || !failClosed) return;
  if (!(manualNote instanceof HTMLTextAreaElement) || !(laterReview instanceof HTMLTextAreaElement) || !(evidenceGaps instanceof HTMLTextAreaElement)) return;
  section.setAttribute("data-state", assistReviewFollowUpWorkflow.state);
  section.setAttribute("data-busy", String(assistReviewFollowUpWorkflowBusy));
  section.setAttribute("data-membership-id", assistReviewFollowUpWorkflow.membershipId ?? "");
  section.setAttribute("data-review-state", assistReviewFollowUpWorkflow.reviewState ?? "");
  const title = section.querySelector("h2");
  if (title) title.textContent = assistReviewFollowUpWorkflow.title;
  status.textContent = assistReviewFollowUpWorkflow.generatedAt ? `${assistReviewFollowUpWorkflow.message} Generated ${assistReviewFollowUpWorkflow.generatedAt}.` : assistReviewFollowUpWorkflow.message;
  renderList(steps, assistReviewFollowUpWorkflow.steps, `${assistReviewFollowUpWorkflow.state}: ${assistReviewFollowUpWorkflow.message}`);
  renderList(intents, assistReviewFollowUpWorkflow.intents, "No local draft intent is available until a valid follow-up workflow is loaded.");
  renderList(gaps, assistReviewFollowUpWorkflow.evidenceGaps, "No evidence gap is available until a valid follow-up workflow is loaded.");
  renderList(views, assistReviewFollowUpWorkflow.suggestedLocalViews, "No local view is available until workflow facts are loaded.");
  renderList(blocked, assistReviewFollowUpWorkflow.blockedExternalActions, "External actions remain blocked and unavailable.");
  renderList(draftSummary, assistReviewFollowUpWorkflow.draftSummary, "Local draft memory is empty.");
  renderList(safety, assistReviewFollowUpWorkflow.safety, "Safety proof is unavailable until a valid follow-up workflow is loaded.");
  renderList(failClosed, assistReviewFollowUpWorkflow.failClosed, "Fail-closed proof is unavailable until a follow-up workflow is loaded.");
  const draftDisabled = assistReviewFollowUpWorkflow.state !== "available" && assistReviewFollowUpWorkflow.state !== "blocked";
  manualNote.disabled = draftDisabled;
  laterReview.disabled = draftDisabled;
  evidenceGaps.disabled = draftDisabled;
  manualNote.value = assistReviewFollowUpWorkflow.localDrafts.manualNote;
  laterReview.value = assistReviewFollowUpWorkflow.localDrafts.laterReview;
  evidenceGaps.value = assistReviewFollowUpWorkflow.localDrafts.evidenceGapChecklist;
  for (const card of document.querySelectorAll<HTMLElement>("#membership-list [data-membership-id]")) {
    const actions = card.querySelector(".membership-actions");
    const membershipId = card.dataset.membershipId ?? "";
    if (!actions || actions.querySelector("[data-review-follow-up-workflow-membership-id]")) continue;
    const action = document.createElement("button");
    action.type = "button";
    action.dataset.testid = "membership-review-follow-up-workflow";
    action.dataset.reviewFollowUpWorkflowMembershipId = membershipId;
    action.disabled = assistReviewFollowUpWorkflowBusy || membershipBusy || busy;
    action.textContent = "Review follow-up";
    actions.append(action);
  }
}

function ensureAssistReviewFollowUpWorkflowPanel(): void {
  if (document.getElementById("assist-review-follow-up-workflow")) return;
  const host = document.getElementById("assist-human-review-workspace") ?? document.getElementById("assist-advisory-scope") ?? document.getElementById("candidate-decision-intake") ?? document.getElementById("candidate-memberships");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "assist-review-follow-up-workflow";
  section.className = "assist-review-follow-up-workflow";
  section.dataset.testid = "assist-review-follow-up-workflow";
  section.setAttribute("aria-label", "ASSIST review follow-up workflow");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>ASSIST review follow-up workflow</h2>",
    "</div>",
    "<p id=\"assist-review-follow-up-workflow-status\" data-testid=\"assist-review-follow-up-workflow-status\"></p>",
    "<h3>Workflow steps</h3>",
    "<ul id=\"assist-review-follow-up-workflow-steps\" data-testid=\"assist-review-follow-up-workflow-steps\"></ul>",
    "<h3>Local draft intents</h3>",
    "<ul id=\"assist-review-follow-up-workflow-intents\" data-testid=\"assist-review-follow-up-workflow-intents\"></ul>",
    "<div class=\"local-draft-grid\" data-testid=\"assist-review-follow-up-workflow-drafts\">",
    "<label>Manual note draft (browser-memory-only, not official, not persisted, not sent)<textarea id=\"assist-review-follow-up-manual-note\" data-testid=\"assist-review-follow-up-manual-note\" rows=\"3\" maxlength=\"1000\"></textarea></label>",
    "<label>Later-review draft (browser-memory-only, not official, not persisted, not sent)<textarea id=\"assist-review-follow-up-later-review\" data-testid=\"assist-review-follow-up-later-review\" rows=\"3\" maxlength=\"1000\"></textarea></label>",
    "<label>Evidence gap checklist (browser-memory-only, not official, not persisted, not sent)<textarea id=\"assist-review-follow-up-evidence-gaps\" data-testid=\"assist-review-follow-up-evidence-gaps\" rows=\"3\" maxlength=\"1000\"></textarea></label>",
    "</div>",
    "<ul id=\"assist-review-follow-up-workflow-draft-summary\" data-testid=\"assist-review-follow-up-workflow-draft-summary\"></ul>",
    "<h3>Evidence gaps</h3>",
    "<ul id=\"assist-review-follow-up-workflow-evidence-gaps\" data-testid=\"assist-review-follow-up-workflow-evidence-gaps\"></ul>",
    "<h3>Suggested local views</h3>",
    "<ul id=\"assist-review-follow-up-workflow-local-views\" data-testid=\"assist-review-follow-up-workflow-local-views\"></ul>",
    "<h3>Blocked external actions</h3>",
    "<ul id=\"assist-review-follow-up-workflow-blocked-actions\" data-testid=\"assist-review-follow-up-workflow-blocked-actions\"></ul>",
    "<h3>Safety proof</h3>",
    "<ul id=\"assist-review-follow-up-workflow-safety\" data-testid=\"assist-review-follow-up-workflow-safety\"></ul>",
    "<h3>Fail-closed proof</h3>",
    "<ul id=\"assist-review-follow-up-workflow-fail-closed\" data-testid=\"assist-review-follow-up-workflow-fail-closed\"></ul>"
  ].join("");
  host.insertAdjacentElement("afterend", section);
}

function renderAssistDecisionNoteWorkflowPanel(context: AssistWorkflowPanelsRenderContext): void {
  const { busy, membershipBusy, decisionIntake, decisionIntakeBusy, assistAdvisoryScope, assistAdvisoryScopeBusy, assistHumanReviewWorkspace, assistHumanReviewWorkspaceBusy, assistReviewFollowUpWorkflow, assistReviewFollowUpWorkflowBusy, assistDecisionNoteWorkflow, assistDecisionNoteWorkflowBusy } = context;
  if (typeof document === "undefined") return;
  ensureAssistDecisionNoteWorkflowPanel();
  const section = document.getElementById("assist-decision-note-workflow");
  const status = document.getElementById("assist-decision-note-workflow-status");
  const steps = document.getElementById("assist-decision-note-workflow-steps");
  const factReferences = document.getElementById("assist-decision-note-workflow-fact-references");
  const gaps = document.getElementById("assist-decision-note-workflow-evidence-gaps");
  const laterReview = document.getElementById("assist-decision-note-workflow-later-review");
  const blocked = document.getElementById("assist-decision-note-workflow-blocked-actions");
  const draftSummary = document.getElementById("assist-decision-note-workflow-draft-summary");
  const safety = document.getElementById("assist-decision-note-workflow-safety");
  const failClosed = document.getElementById("assist-decision-note-workflow-fail-closed");
  const draft = document.getElementById("assist-decision-note-workflow-draft");
  if (!section || !status || !steps || !factReferences || !gaps || !laterReview || !blocked || !draftSummary || !safety || !failClosed) return;
  if (!(draft instanceof HTMLTextAreaElement)) return;
  section.setAttribute("data-state", assistDecisionNoteWorkflow.state);
  section.setAttribute("data-busy", String(assistDecisionNoteWorkflowBusy));
  section.setAttribute("data-membership-id", assistDecisionNoteWorkflow.membershipId ?? "");
  section.setAttribute("data-note-state", assistDecisionNoteWorkflow.noteState ?? "");
  const title = section.querySelector("h2");
  if (title) title.textContent = assistDecisionNoteWorkflow.title;
  status.textContent = assistDecisionNoteWorkflow.generatedAt ? `${assistDecisionNoteWorkflow.message} Generated ${assistDecisionNoteWorkflow.generatedAt}.` : assistDecisionNoteWorkflow.message;
  renderList(steps, assistDecisionNoteWorkflow.steps, `${assistDecisionNoteWorkflow.state}: ${assistDecisionNoteWorkflow.message}`);
  renderList(factReferences, assistDecisionNoteWorkflow.factReferences, "No fact reference is displayable until a valid decision-note workflow is loaded.");
  renderList(gaps, assistDecisionNoteWorkflow.unresolvedEvidenceGaps, "No unresolved evidence gap is available until a valid decision-note workflow is loaded.");
  renderList(laterReview, assistDecisionNoteWorkflow.laterReviewEntry, "No later-review entry is available until a valid decision-note workflow is loaded.");
  renderList(blocked, assistDecisionNoteWorkflow.blockedExternalActions, "External actions remain blocked and unavailable.");
  renderList(draftSummary, assistDecisionNoteWorkflow.draftSummary, "Local decision-note draft memory is empty.");
  renderList(safety, assistDecisionNoteWorkflow.safety, "Safety proof is unavailable until a valid decision-note workflow is loaded.");
  renderList(failClosed, assistDecisionNoteWorkflow.failClosed, "Fail-closed proof is unavailable until a decision-note workflow is loaded.");
  const draftDisabled = assistDecisionNoteWorkflow.state !== "available" && assistDecisionNoteWorkflow.state !== "blocked";
  draft.disabled = draftDisabled;
  draft.value = assistDecisionNoteWorkflow.localDrafts.decisionNote;
  for (const card of document.querySelectorAll<HTMLElement>("#membership-list [data-membership-id]")) {
    const actions = card.querySelector(".membership-actions");
    const membershipId = card.dataset.membershipId ?? "";
    if (!actions || actions.querySelector("[data-decision-note-workflow-membership-id]")) continue;
    const action = document.createElement("button");
    action.type = "button";
    action.dataset.testid = "membership-decision-note-workflow";
    action.dataset.decisionNoteWorkflowMembershipId = membershipId;
    action.disabled = assistDecisionNoteWorkflowBusy || membershipBusy || busy;
    action.textContent = "Decision note";
    actions.append(action);
  }
}

function ensureAssistDecisionNoteWorkflowPanel(): void {
  if (document.getElementById("assist-decision-note-workflow")) return;
  const host = document.getElementById("assist-review-follow-up-workflow") ?? document.getElementById("assist-human-review-workspace") ?? document.getElementById("assist-advisory-scope") ?? document.getElementById("candidate-decision-intake") ?? document.getElementById("candidate-memberships");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "assist-decision-note-workflow";
  section.className = "assist-decision-note-workflow";
  section.dataset.testid = "assist-decision-note-workflow";
  section.setAttribute("aria-label", "ASSIST decision-note workflow");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>ASSIST decision-note workflow</h2>",
    "</div>",
    "<p id=\"assist-decision-note-workflow-status\" data-testid=\"assist-decision-note-workflow-status\"></p>",
    "<h3>Workflow steps</h3>",
    "<ul id=\"assist-decision-note-workflow-steps\" data-testid=\"assist-decision-note-workflow-steps\"></ul>",
    "<div class=\"local-draft-grid\" data-testid=\"assist-decision-note-workflow-drafts\">",
    "<label>Decision-note draft (browser-memory-only, not official, not persisted, not sent)<textarea id=\"assist-decision-note-workflow-draft\" data-testid=\"assist-decision-note-workflow-draft-field\" rows=\"4\" maxlength=\"4000\"></textarea></label>",
    "</div>",
    "<ul id=\"assist-decision-note-workflow-draft-summary\" data-testid=\"assist-decision-note-workflow-draft-summary\"></ul>",
    "<h3>Fact references</h3>",
    "<ul id=\"assist-decision-note-workflow-fact-references\" data-testid=\"assist-decision-note-workflow-fact-references\"></ul>",
    "<h3>Unresolved evidence gaps</h3>",
    "<ul id=\"assist-decision-note-workflow-evidence-gaps\" data-testid=\"assist-decision-note-workflow-evidence-gaps\"></ul>",
    "<h3>Later-review entry</h3>",
    "<ul id=\"assist-decision-note-workflow-later-review\" data-testid=\"assist-decision-note-workflow-later-review\"></ul>",
    "<h3>Blocked external actions</h3>",
    "<ul id=\"assist-decision-note-workflow-blocked-actions\" data-testid=\"assist-decision-note-workflow-blocked-actions\"></ul>",
    "<h3>Safety proof</h3>",
    "<ul id=\"assist-decision-note-workflow-safety\" data-testid=\"assist-decision-note-workflow-safety\"></ul>",
    "<h3>Fail-closed proof</h3>",
    "<ul id=\"assist-decision-note-workflow-fail-closed\" data-testid=\"assist-decision-note-workflow-fail-closed\"></ul>"
  ].join("");
  host.insertAdjacentElement("afterend", section);
}


function ensureAssistHumanReviewWorkspacePanel(): void {
  if (document.getElementById("assist-human-review-workspace")) return;
  const host = document.getElementById("assist-advisory-scope") ?? document.getElementById("candidate-decision-intake") ?? document.getElementById("candidate-memberships");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "assist-human-review-workspace";
  section.className = "assist-human-review-workspace";
  section.dataset.testid = "assist-human-review-workspace";
  section.setAttribute("aria-label", "ASSIST human-review workspace");
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>ASSIST human-review workspace</h2>",
    "</div>",
    "<p id=\"assist-human-review-workspace-status\" data-testid=\"assist-human-review-workspace-status\"></p>",
    "<h3>Readiness</h3>",
    "<ul id=\"assist-human-review-workspace-readiness\" data-testid=\"assist-human-review-workspace-readiness\"></ul>",
    "<h3>Evidence groups</h3>",
    "<ul id=\"assist-human-review-workspace-evidence-groups\" data-testid=\"assist-human-review-workspace-evidence-groups\"></ul>",
    "<h3>Limitations</h3>",
    "<ul id=\"assist-human-review-workspace-limitations\" data-testid=\"assist-human-review-workspace-limitations\"></ul>",
    "<h3>Safe continuations</h3>",
    "<ul id=\"assist-human-review-workspace-continuations\" data-testid=\"assist-human-review-workspace-continuations\"></ul>",
    "<h3>Follow-up intent</h3>",
    "<ul id=\"assist-human-review-workspace-follow-up\" data-testid=\"assist-human-review-workspace-follow-up\"></ul>",
    "<h3>Safety boundaries</h3>",
    "<ul id=\"assist-human-review-workspace-boundaries\" data-testid=\"assist-human-review-workspace-boundaries\"></ul>",
    "<h3>Fail-closed proof</h3>",
    "<ul id=\"assist-human-review-workspace-fail-closed\" data-testid=\"assist-human-review-workspace-fail-closed\"></ul>",
    "<h3>Source provenance</h3>",
    "<ul id=\"assist-human-review-workspace-provenance\" data-testid=\"assist-human-review-workspace-provenance\"></ul>"
  ].join("");
  host.insertAdjacentElement("afterend", section);
}

function ensureAssistAdvisoryScopePanel(): void {
  if (document.getElementById("assist-advisory-scope")) return;
  const host = document.getElementById("candidate-decision-intake") ?? document.getElementById("candidate-memberships");
  if (!host?.parentElement) return;
  const section = document.createElement("section");
  section.id = "assist-advisory-scope";
  section.className = "assist-advisory-scope";
  section.dataset.testid = "assist-advisory-scope";
  section.innerHTML = [
    "<div class=\"section-heading\">",
    "<h2>ASSIST advisory scope</h2>",
    "</div>",
    "<p id=\"assist-advisory-scope-status\"></p>",
    "<h3>Facts</h3>",
    "<ul id=\"assist-advisory-scope-facts\"></ul>",
    "<h3>Limitations</h3>",
    "<ul id=\"assist-advisory-scope-limitations\"></ul>",
    "<h3>Allowed continuations</h3>",
    "<ul id=\"assist-advisory-scope-continuations\"></ul>",
    "<h3>Safety proof</h3>",
    "<ul id=\"assist-advisory-scope-safety\"></ul>"
  ].join("");
  host.insertAdjacentElement("afterend", section);
}
