import { routeInvestmentConsoleTabKeydown } from "./investmentControlConsoleKeyboard.js";
import { bindLocalTokenFileInput } from "./webAuth.js";

export interface AppEventActions {
  symbolChanged: () => void;
  authorizationChanged: () => void;
  load: () => void;
  refreshCandidates: () => void;
  refreshMemberships: () => void;
  createMembership: () => void;
  openCandidate: (symbol: string) => void;
  openAssetsResearch: (symbol: string, sourceKey: string) => void;
  openResearchMembership: (membershipId: string, membershipVersion: number, symbol: string) => void;
  loadDecisionIntake: (membershipId: string) => void;
  loadAdvisoryScope: (membershipId: string) => void;
  loadHumanReviewWorkspace: (membershipId: string) => void;
  loadReviewFollowUpWorkflow: (membershipId: string) => void;
  loadDecisionNoteWorkflow: (membershipId: string) => void;
  updateMembershipState: (membershipId: string, state: "tracked" | "paused" | "archived", version: number) => void;
  submitDecision: () => void;
  submitReview: () => void;
  portfolioRefresh: () => void;
  portfolioRisk: () => void;
  portfolioLab: () => void;
  portfolioLabCompare: () => void;
  portfolioLabAmountsChanged: () => void;
  portfolioLabComparisonChanged: () => void;
  pinganManualAction: (action: "save" | "load" | "clear") => void;
  reviewKnowledgeAction: (action: "save" | "replace" | "load" | "clear") => void;
  localRecordAction: (action: "save" | "load" | "clear") => void;
  textInputChanged: (id: string) => void;
  reviewKnowledgeSelectionChanged: (knowledgeId: string) => void;
  controlTab: (tab: "sources" | "valuation" | "conditions" | "diagnostics") => void;
  controlAction: (action: "save-profile" | "add-evidence" | "run-valuation" | "run-registered-research" | "run-conditional") => void;
  controlInputChanged: (id: string) => void;
  conditionalBoundChanged: (bound: boolean) => void;
}
const authorizationInputIds = [
  "auth-header-name", "auth-token",
  "membership-read-header-name", "membership-read-token",
  "membership-write-header-name", "membership-write-token"
] as const;
function run(action: () => void): void {
  action();
}
export function bindAppEvents(documentRef: Document, actions: AppEventActions): void {
  documentRef.getElementById("symbol-input")?.addEventListener("input", actions.symbolChanged);
  for (const id of authorizationInputIds) documentRef.getElementById(id)?.addEventListener("input", actions.authorizationChanged);
  bindLocalTokenFileInput(documentRef, actions.authorizationChanged);
  documentRef.getElementById("load-action")?.addEventListener("click", () => run(actions.load));
  documentRef.getElementById("candidate-refresh")?.addEventListener("click", () => run(actions.refreshCandidates));
  documentRef.getElementById("membership-refresh")?.addEventListener("click", () => run(actions.refreshMemberships));
  documentRef.getElementById("membership-create")?.addEventListener("click", () => run(actions.createMembership));
  documentRef.getElementById("portfolio-refresh")?.addEventListener("click", () => run(actions.portfolioRefresh));
  documentRef.getElementById("portfolio-risk-run")?.addEventListener("click", () => run(actions.portfolioRisk));
  documentRef.getElementById("portfolio-lab-run")?.addEventListener("click", () => run(actions.portfolioLab));
  documentRef.getElementById("portfolio-lab-compare-run")?.addEventListener("click", () => run(actions.portfolioLabCompare));
  documentRef.getElementById("portfolio-lab-amounts")?.addEventListener("input", actions.portfolioLabAmountsChanged);
  documentRef.getElementById("portfolio-lab-compare-membership")?.addEventListener("change", actions.portfolioLabComparisonChanged);
  documentRef.getElementById("candidate-list")?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-candidate-symbol]");
    if (button instanceof HTMLButtonElement) actions.openCandidate(button.dataset.candidateSymbol ?? "");
  });
  documentRef.getElementById("membership-list")?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const research = target.closest("button[data-open-research-membership-id]");
    if (research instanceof HTMLButtonElement) {
      const version = Number(research.dataset.openResearchMembershipVersion);
      if (Number.isInteger(version) && version >= 1) {
        actions.openResearchMembership(
          research.dataset.openResearchMembershipId ?? "",
          version,
          research.dataset.openResearchSymbol ?? ""
        );
      }
      return;
    }
    const actionBindings = [
      ["button[data-decision-intake-membership-id]", "decisionIntakeMembershipId", actions.loadDecisionIntake],
      ["button[data-advisory-scope-membership-id]", "advisoryScopeMembershipId", actions.loadAdvisoryScope],
      ["button[data-human-review-workspace-membership-id]", "humanReviewWorkspaceMembershipId", actions.loadHumanReviewWorkspace],
      ["button[data-review-follow-up-workflow-membership-id]", "reviewFollowUpWorkflowMembershipId", actions.loadReviewFollowUpWorkflow],
      ["button[data-decision-note-workflow-membership-id]", "decisionNoteWorkflowMembershipId", actions.loadDecisionNoteWorkflow]
    ] as const;
    for (const [selector, dataKey, action] of actionBindings) {
      const button = target.closest(selector);
      if (button instanceof HTMLButtonElement) {
        action(button.dataset[dataKey] ?? "");
        return;
      }
    }
    const button = target.closest("button[data-membership-action]");
    if (!(button instanceof HTMLButtonElement)) return;
    const action = button.dataset.membershipAction;
    const version = Number(button.dataset.membershipVersion);
    if ((action === "tracked" || action === "paused" || action === "archived") && Number.isInteger(version) && version >= 1) {
      actions.updateMembershipState(button.dataset.membershipId ?? "", action, version);
    }
  });
  documentRef.getElementById("decision-submit")?.addEventListener("click", () => run(actions.submitDecision));
  documentRef.getElementById("review-submit")?.addEventListener("click", () => run(actions.submitReview));
  documentRef.addEventListener("click", (event) => routeDocumentClick(event, actions));
  documentRef.addEventListener("keydown", (event) => routeInvestmentConsoleTabKeydown(event, documentRef, actions.controlTab));
  documentRef.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) {
      if (event.target instanceof HTMLTextAreaElement) actions.textInputChanged(event.target.id);
      actions.controlInputChanged(event.target.id);
    }
  });
  documentRef.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.id === "assist-review-knowledge-history") {
      actions.reviewKnowledgeSelectionChanged(target.value);
    }
    if (target instanceof HTMLInputElement && target.id === "annual-conditional-bind") actions.conditionalBoundChanged(target.checked);
    if (target instanceof HTMLSelectElement) actions.controlInputChanged(target.id);
  });
}
function routeDocumentClick(event: Event, actions: AppEventActions): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const assetsResearch = target.closest("button[data-assets-research-symbol]");
  if (assetsResearch instanceof HTMLButtonElement) {
    actions.openAssetsResearch(assetsResearch.dataset.assetsResearchSymbol ?? "", assetsResearch.dataset.assetsResearchSourceKey ?? "");
    return;
  }
  const controlTab = target.closest("button[data-control-tab]");
  if (controlTab instanceof HTMLButtonElement) {
    const tab = controlTab.dataset.controlTab;
    if (tab === "sources" || tab === "valuation" || tab === "conditions" || tab === "diagnostics") actions.controlTab(tab);
    return;
  }
  const controlAction = target.closest("button[data-control-action]");
  if (controlAction instanceof HTMLButtonElement) {
    const action = controlAction.dataset.controlAction;
    if (action === "save-profile" || action === "add-evidence" || action === "run-valuation" || action === "run-registered-research" || action === "run-conditional") actions.controlAction(action);
    return;
  }
  const bridgeBindings = [
    ["button[data-selected-candidate-decision-intake-membership-id]", "selectedCandidateDecisionIntakeMembershipId", actions.loadDecisionIntake],
    ["button[data-selected-candidate-advisory-scope-membership-id]", "selectedCandidateAdvisoryScopeMembershipId", actions.loadAdvisoryScope],
    ["button[data-selected-candidate-human-review-workspace-membership-id]", "selectedCandidateHumanReviewWorkspaceMembershipId", actions.loadHumanReviewWorkspace],
    ["button[data-selected-candidate-follow-up-membership-id]", "selectedCandidateFollowUpMembershipId", actions.loadReviewFollowUpWorkflow],
    ["button[data-selected-candidate-decision-note-membership-id]", "selectedCandidateDecisionNoteMembershipId", actions.loadDecisionNoteWorkflow]
  ] as const;
  for (const [selector, dataKey, action] of bridgeBindings) {
    const button = target.closest(selector);
    if (button instanceof HTMLButtonElement) {
      action(button.dataset[dataKey] ?? "");
      return;
    }
  }
  const pingan = target.closest("button[data-pingan-manual-action]");
  if (pingan instanceof HTMLButtonElement) {
    const action = pingan.dataset.pinganManualAction;
    if (action === "save" || action === "load" || action === "clear") actions.pinganManualAction(action);
    return;
  }
  const knowledge = target.closest("button[data-review-knowledge-action]");
  if (knowledge instanceof HTMLButtonElement) {
    const action = knowledge.dataset.reviewKnowledgeAction;
    if (action === "save" || action === "replace" || action === "load" || action === "clear") actions.reviewKnowledgeAction(action);
    return;
  }
  const localRecord = target.closest("button[data-local-record-action]");
  if (localRecord instanceof HTMLButtonElement) {
    const action = localRecord.dataset.localRecordAction;
    if (action === "save" || action === "load" || action === "clear") actions.localRecordAction(action);
  }
}
