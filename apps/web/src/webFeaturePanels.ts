import type { CoreJourneyData } from "./coreJourneyState.js";
import type { CandidateMembershipRenderModel } from "./candidateMembershipState.js";
import type { CandidateDecisionIntakeRenderModel } from "./candidateDecisionIntakeState.js";
import type { PinganManualSnapshotController } from "./pinganManualSnapshotController.js";
import type { AssistLocalRecordController } from "./assistLocalRecordController.js";
import type { AssistReviewKnowledgeController } from "./assistReviewKnowledgeController.js";
import type { AssistWorkflowController } from "./assistWorkflowController.js";
import { renderSelectedCandidatePanels } from "./selectedCandidatePanelsRenderer.js";
import { renderLocalStoragePanels } from "./localStoragePanelsRenderer.js";
import { renderAssistWorkflowPanels } from "./assistWorkflowPanelsRenderer.js";
import { renderCoreAssistStatusPanels } from "./coreAssistStatusPanelsRenderer.js";
import { renderCoreAssistWebCapabilityConsoleHardeningPanel } from "./coreAssistCapabilityConsoleRenderer.js";

export interface WebFeaturePanelsContext {
  data: CoreJourneyData | null;
  busy: boolean;
  candidateMemberships: CandidateMembershipRenderModel;
  membershipBusy: boolean;
  decisionIntake: CandidateDecisionIntakeRenderModel;
  decisionIntakeBusy: boolean;
  pingan: PinganManualSnapshotController;
  localRecord: AssistLocalRecordController;
  reviewKnowledge: AssistReviewKnowledgeController;
  assistWorkflow: AssistWorkflowController;
  localRecordSourceSignature: string | null;
  reviewKnowledgeCurrentSymbol: string | null;
}

export function renderWebFeaturePanels(context: WebFeaturePanelsContext): void {
  const assist = {
    assistAdvisoryScope: context.assistWorkflow.advisoryScope,
    assistAdvisoryScopeBusy: context.assistWorkflow.advisoryScopeBusy,
    assistHumanReviewWorkspace: context.assistWorkflow.humanReviewWorkspace,
    assistHumanReviewWorkspaceBusy: context.assistWorkflow.humanReviewWorkspaceBusy,
    assistReviewFollowUpWorkflow: context.assistWorkflow.reviewFollowUpWorkflow,
    assistReviewFollowUpWorkflowBusy: context.assistWorkflow.reviewFollowUpWorkflowBusy,
    assistDecisionNoteWorkflow: context.assistWorkflow.decisionNoteWorkflow,
    assistDecisionNoteWorkflowBusy: context.assistWorkflow.decisionNoteWorkflowBusy
  };
  const core = {
    data: context.data,
    busy: context.busy,
    candidateMemberships: context.candidateMemberships,
    membershipBusy: context.membershipBusy,
    decisionIntake: context.decisionIntake,
    decisionIntakeBusy: context.decisionIntakeBusy,
    ...assist
  };
  renderSelectedCandidatePanels(core);
  renderAssistWorkflowPanels(core);
  renderLocalStoragePanels({
    data: context.data,
    pinganManualSnapshot: context.pingan.envelope,
    pinganManualSnapshotState: context.pingan.state,
    pinganManualSnapshotMessage: context.pingan.message,
    pinganManualSnapshotClearSymbol: context.pingan.clearSymbol,
    pinganManualSnapshotClearAccountScopeId: context.pingan.clearAccountScopeId,
    currentPinganManualSnapshotSymbol: context.pingan.currentSymbol(),
    currentPinganManualSnapshotAccountScopeId: context.pingan.currentAccountScope()?.accountScopeId ?? null,
    assistLocalRecordDrafts: context.localRecord.drafts,
    assistLocalRecordStatus: context.localRecord.status,
    assistLocalRecordMessage: context.localRecord.message,
    assistLocalRecordSnapshotSummary: context.localRecord.snapshotSummary,
    assistLocalRecordSourceSignature: context.localRecordSourceSignature,
    assistReviewKnowledgeStatus: context.reviewKnowledge.status,
    assistReviewKnowledgeMessage: context.reviewKnowledge.message,
    assistReviewKnowledgeLoadedSymbol: context.reviewKnowledge.loadedSymbol,
    assistReviewKnowledgeCurrentSymbol: context.reviewKnowledgeCurrentSymbol,
    assistReviewKnowledgeEntries: context.reviewKnowledge.entries,
    assistReviewKnowledgeSelectedId: context.reviewKnowledge.selectedId,
    assistReviewKnowledgeFields: context.reviewKnowledge.fields,
    assistReviewKnowledgeClearConfirmation: context.reviewKnowledge.clearConfirmation
  });
  renderCoreAssistStatusPanels(core);
  renderCoreAssistWebCapabilityConsoleHardeningPanel({
    ...core,
    assistLocalRecordStatus: context.localRecord.status,
    assistLocalRecordSourceSignatureAvailable: context.localRecordSourceSignature !== null,
    assistLocalRecordSnapshotSummaryLength: context.localRecord.snapshotSummary.length,
    assistReviewKnowledgeStatus: context.reviewKnowledge.status,
    assistReviewKnowledgeLoadedSymbol: context.reviewKnowledge.loadedSymbol,
    assistReviewKnowledgeEntriesLength: context.reviewKnowledge.entries.length,
    assistReviewKnowledgeSelectedIdPresent: context.reviewKnowledge.selectedId !== null
  });
}
