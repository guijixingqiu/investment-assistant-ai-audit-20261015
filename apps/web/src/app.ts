import { sameWebApiAuth, WebApiClient } from "./apiClient.js";
import { assistLocalRecordLifecycleSemantics } from "./assistLocalRecordState.js";
import { describePinganManualSnapshot } from "./pinganManualSnapshotState.js";
import type { AssistReviewKnowledgeCurrentSourceIdentity } from "./assistReviewKnowledgeState.js";
import { selectedCandidateDecisionBridgeFromState } from "./selectedCandidateDecisionBridge.js";
import { selectedCandidateAdvisoryScopeBridgeFromState, selectedCandidateDecisionContextBridgeFromState, selectedCandidateDecisionNoteWorkflowBridgeFromState, selectedCandidateFollowUpWorkflowBridgeFromState, selectedCandidateHumanReviewWorkspaceBridgeFromState } from "./selectedCandidateWorkflowBridges.js";
import { browserLocalStorage } from "./browserStorage.js";
import { nullableInputValue } from "./manualFormValues.js";
import { renderList, setUnifiedFailureStateAttribute } from "./domRender.js";
import { nullableNumberText, nullablePercentText } from "./displayFormatting.js";
import { bindAppEvents } from "./appEventBindings.js";
import { PinganManualSnapshotController } from "./pinganManualSnapshotController.js";
import { AssistLocalRecordController } from "./assistLocalRecordController.js";
import { AssistReviewKnowledgeController } from "./assistReviewKnowledgeController.js";
import { assistLocalArchiveOperationFingerprint, bindAssistLocalArchiveEvents, buildAssistLocalArchive, downloadAssistLocalArchive, restoreAssistLocalArchive } from "./assistLocalArchive.js";
import { AssistWorkflowController, type AssistSourceFailureState } from "./assistWorkflowController.js";
import { journeyDetailLines } from "./journeyDetails.js";
import { renderWebFeaturePanels } from "./webFeaturePanels.js";
import { CandidateWorkflowController } from "./candidateWorkflowController.js";
export * from "./appPublicApi.js";
import type { PinganSnapshotEnvelope } from "../../../packages/contracts/src/portfolioSnapshot.js";
import type { CandidateMembershipData } from "../../../packages/contracts/src/candidateMembership.js";
import type { ResearchReportDecisionBinding } from "../../../packages/contracts/src/researchReportDecision.js";
import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import { evaluateFormalPersonalRisk } from "../../../packages/contracts/src/formalDecision.js";
import { currentDecisionContinuity, deriveCoreJourneyNextAction, deriveCoreJourneyStages, initialStages, sameDecisionContext, type CoreJourneyData, type StageState } from "./coreJourneyState.js";
import { auth, candidateReadAuth, candidateWriteAuth } from "./webAuth.js";
import { deriveReviewFeedback } from "./reviewFeedback.js";
import { parseHongKongSymbol } from "./securitySymbol.js";
import { PortfolioWorkspaceController, type PortfolioLabMembershipIdentity } from "./portfolioWorkspaceController.js";
import { parseAnnualPortfolioLabAmountText } from "./annualPortfolioLabApiClient.js";
import { renderPortfolioLabComparisonMemberships, renderPortfolioWorkspace } from "./portfolioWorkspaceRenderer.js";
import { PostDecisionReviewSubmissionController } from "./postDecisionPortfolioReviewSubmission.js";
import { InvestmentControlConsoleCoordinator } from "./investmentControlConsoleCoordinator.js";
import { DeepResearchConsole } from "./deepResearchConsole.js";
import { DeepResearchComparisonConsole } from "./deepResearchComparisonConsole.js";
import { ReportAssistantConsole } from "./reportAssistantConsole.js";
import { assetsResearchMembershipAction, DailyResearchCockpitBridge, requireSingleActiveMembershipBySymbol } from "./dailyResearchCockpitBridge.js";
import { dailyTrackingReviewCheckIdentity, dailyTrackingTargetMatchesCheck } from "./dailyResearchCockpitData.js";
import { DecisionBriefConsole, decisionBriefSource } from "./decisionBriefConsole.js";
import { DecisionReviewCaseFileConsole } from "./decisionReviewCaseFileConsole.js";
import { captureDecisionSubmissionIdentity, matchesDecisionSubmissionIdentity, runDecisionSubmission } from "./decisionSubmission.js";
import { input, readDecisionForm, readReviewForm, render } from "./view.js";
import { coreAssistUnifiedFailureStateForUiState, coreAssistUnifiedFailureStateMetadataPolicyForUiStates, coreAssistUnifiedFailureStateSummaryForUiStates } from "./coreAssistUnifiedFailureState.js";
const client = new WebApiClient(); let data: CoreJourneyData | null = null;
let busy = false; let uiGeneration = 0;
let assetsResearchGeneration = 0;
let pendingAssetsResearch: { symbol: string; sourceKey: string; generation: number } | null = null;
let currentStages: StageState[] = initialStages("pending", "请选择一个有效港股标的开始读取。");
let currentDetails: string[] = [];
let apiPinganSnapshot: PinganSnapshotEnvelope | null = null;
async function prepareFormalDecision(binding: ResearchReportDecisionBinding): Promise<void> {
  await deepResearchConsole.loadFormalDecisionReport(binding);
}
const pinganManualController = new PinganManualSnapshotController({
  currentAccountScope: () => currentPinganManualScope(),
  currentJourney: () => data,
  apiSnapshot: () => apiPinganSnapshot,
  repaintJourney: () => paint(undefined, detailLines()),
  renderPanel: () => renderLocalStoragePanelsFromState()
});
function selectedLocalRecordMembershipVersion(): number | null { return assistLocalRecordController.selectedMembershipVersion(); }
function assistLocalRecordSourceSignature(): string | null { return assistLocalRecordController.sourceSignature(); }
function assistReviewKnowledgeCurrentSourceIdentity(): AssistReviewKnowledgeCurrentSourceIdentity | null {
  const sourceSignature = assistLocalRecordSourceSignature();
  const membershipVersion = selectedLocalRecordMembershipVersion();
  const membershipId = assistWorkflowController.decisionNoteWorkflow.membershipId ?? assistWorkflowController.reviewFollowUpWorkflow.membershipId;
  const context = data?.decisionContext ?? null;
  if (!sourceSignature || !membershipId || !membershipVersion || !context) return null;
  return {
    sourceSignature,
    membershipId,
    membershipVersion,
    decisionContextId: context.contextId,
    decisionContextHash: context.contextHash
  };
}
const assistReviewKnowledgeController = new AssistReviewKnowledgeController({
  currentSource: () => assistReviewKnowledgeCurrentSourceIdentity(),
  reviewReferences: () => assistReviewKnowledgeReviewReferences(),
  localRecordId: () => assistLocalRecordController.envelopeId,
  renderPanel: () => renderLocalStoragePanelsFromState()
});
const assistLocalRecordController: AssistLocalRecordController = new AssistLocalRecordController({
  context: () => ({
    data,
    memberships: candidateWorkflowController.memberships,
    followUpWorkflow: assistWorkflowController.reviewFollowUpWorkflow,
    decisionNoteWorkflow: assistWorkflowController.decisionNoteWorkflow
  }),
  clearKnowledgeDisplay: (message) => assistReviewKnowledgeController.clearDisplay(message),
  renderPanel: () => renderLocalStoragePanelsFromState()
});
const assistWorkflowController: AssistWorkflowController = new AssistWorkflowController({
  client,
  readAuth: () => candidateReadAuth(),
  paint: () => paint(currentStages, detailLines()),
  clearLocalRecord: (message) => clearAssistLocalRecordDrafts(message),
  markLocalRecordAvailable: () => assistLocalRecordController.markAvailable(),
  restoreKnowledge: (symbol) => restoreAssistReviewKnowledgeForSymbol(symbol)
});
const candidateWorkflowController: CandidateWorkflowController = new CandidateWorkflowController({
  client,
  overviewAuth: () => auth(),
  readAuth: () => candidateReadAuth(),
  writeAuth: () => candidateWriteAuth(),
  paint: () => paint(currentStages, detailLines()),
  clearAssist: (state, message, membershipId, localRecordMessage) => assistWorkflowController.clearFromDecisionIntake(state, message, membershipId, localRecordMessage),
  invalidatePortfolioLab: (message) => portfolioWorkspaceController.invalidateLab(message),
  hasAssistPath: () => assistWorkflowController.hasLoadedPath() || assistLocalRecordController.status !== "idle"
});
const portfolioWorkspaceController = new PortfolioWorkspaceController({
  client,
  auth: () => candidateReadAuth() ?? auth(),
  currentSymbol: () => data?.symbol ?? null,
  currentMembership: () => ({ membershipId: candidateWorkflowController.decisionIntake.membershipId, membershipVersion: candidateWorkflowController.decisionIntake.membershipVersion, symbol: candidateWorkflowController.decisionIntake.symbol }),
  currentMembershipById: (membershipId) => portfolioLabMembershipById(membershipId),
  render: () => { renderFeaturePanelsFromState(); renderJourney(); }
});
function portfolioLabMembershipById(membershipId: string): PortfolioLabMembershipIdentity | null {
  const membership = candidateWorkflowController.memberships.memberships.find((item) =>
    item.id === membershipId && item.state === "tracked"
  );
  return membership ? { membershipId: membership.id, membershipVersion: membership.version, symbol: membership.symbol } : null;
}
function currentPinganManualScope() { const parsed = parseHongKongSymbol(input("symbol-input").value); if (!parsed.ok || !data || data.symbol.symbol !== parsed.value.symbol || portfolioWorkspaceController.busy) return null; try { const accountScopeId = portfolioWorkspaceController.decisionSnapshotBinding().portfolioContext.accountScopeId; return accountScopeId ? { accountScopeId, symbol: parsed.value.symbol } : null; } catch { return null; } }
async function loadPortfolioWorkspaceAndManualSnapshot(expectedGeneration = uiGeneration): Promise<void> { pinganManualController.invalidate("正在验证当前账号范围；本地手工历史快照已隐藏。"); if (data) data.pingan = apiPinganSnapshot; await portfolioWorkspaceController.load(); if (expectedGeneration !== uiGeneration || !data) return; const scope = currentPinganManualScope(); if (!scope) { pinganManualController.invalidate("当前 portfolio context 未提供可验证账号范围；本地手工历史快照保持隐藏。"); paint(undefined, detailLines()); return; } pinganManualController.restore(scope.symbol); data.pingan = apiPinganSnapshot; pinganManualController.applyToCurrentJourney(); paint(undefined, detailLines()); }
const investmentConsole = new InvestmentControlConsoleCoordinator({
  currentData: () => data, currentDecisionIntake: () => candidateWorkflowController.decisionIntake,
  currentPortfolio: () => portfolioWorkspaceController.viewState, readAuth: () => candidateReadAuth(), writeAuth: () => candidateWriteAuth(),
  reloadAfterResearchWrite: async (membershipId) => { await load(); if (data) await candidateWorkflowController.loadDecisionIntake(membershipId); await dailyResearchCockpitBridge.refreshToday(); }
});
const currentExactResearchSource = () => decisionBriefSource(investmentConsole.currentSource(), candidateWorkflowController.memberships.memberships);
const decisionBriefConsole = new DecisionBriefConsole({ currentSource: currentExactResearchSource, readAuth: () => candidateReadAuth() });
const deepResearchConsole = new DeepResearchConsole({
  currentSource: currentExactResearchSource,
  readAuth: () => candidateReadAuth(),
  writeAuth: () => candidateWriteAuth(),
  onWorkspaceChanged: (workspace) => reportAssistantConsole.syncWorkspace(workspace),
  onReportConfirmed: () => dailyResearchCockpitBridge.refreshToday()
});
const reportAssistantConsole = new ReportAssistantConsole({
  currentSource: currentExactResearchSource,
  readAuth: () => candidateReadAuth(),
  writeAuth: () => candidateWriteAuth(), loadReviewHistory: (source, currentAuth) => client.loadDecisionReviewHistory(source, currentAuth),
  invalidateDeepResearch: (message) => deepResearchConsole.invalidateWorkspace(message),
  addFollowUpDraft: (source, text) => {
    const current = investmentConsole.currentSource();
    const workflow = assistWorkflowController.reviewFollowUpWorkflow;
    if (current?.sourceKey !== source.sourceKey || workflow.membershipId !== source.membershipId
      || workflow.symbol !== source.symbol || !["available", "blocked"].includes(workflow.state)) {
      throw new Error("Load the exact current session-local review follow-up before adding this draft.");
    }
    const drafts = assistWorkflowController.reviewFollowUpDrafts;
    assistWorkflowController.updateFollowUpDrafts({
      ...drafts,
      evidenceGapChecklist: [drafts.evidenceGapChecklist.trim(), text].filter(Boolean).join("\n").slice(0, 1_000)
    });
    renderAssistWorkflowPanelsFromState();
  }
});
const decisionReviewCaseFile = new DecisionReviewCaseFileConsole({ currentSymbol: () => data?.symbol ?? null, readAuth: () => candidateReadAuth(), loadHistory: (symbol, currentAuth) => client.loadDecisionReviewHistory(symbol, currentAuth), installHistory: (history) => { if (data) data.reviewHistory = history; } });
const dailyResearchCockpitBridge = new DailyResearchCockpitBridge({
  candidates: candidateWorkflowController,
  assist: assistWorkflowController,
  investment: investmentConsole,
  loadJourney: load,
  currentSymbol: () => data?.symbol.symbol ?? null,
  invalidateDeepResearch: (message) => deepResearchConsole.invalidateWorkspace(message),
  prepareFormalDecision,
  activateDailyTrackingReview: (target) => {
    const matches = data?.reviewHistory?.checks.filter((check) => check.id === target.decisionCheckId
      && dailyTrackingTargetMatchesCheck(target, check)) ?? [];
    if (!data || matches.length !== 1) throw new Error("Fresh review history did not contain the exact DAILY_TRACKING decision check and report binding.");
    const identity = dailyTrackingReviewCheckIdentity(matches[0]);
    // Review history omits write-response audit fields; every field used by the existing review form is contract-validated above.
    data.submittedCheck = matches[0] as unknown as NonNullable<typeof data.submittedCheck>;
    data.submittedReview = null;
    paint(undefined, detailLines());
    return identity;
  },
  activateOrdinaryReview: (item, actorId) => {
    const event = item.reviewEvent;
    if (item.kind !== "review_due" || event?.type !== "REVIEW_DUE"
      || event.sourceEventId !== event.bindings.decisionCheckId
      || event.stateActor.actorId !== actorId
      || item.source.id !== event.id || item.source.version !== Number(event.sourceEventId)
      || item.source.effectiveAt !== event.effectiveAt) {
      throw new Error("Fresh Today review source or actor binding changed.");
    }
    const matches = data?.reviewHistory?.checks.filter((check) => check.id === event.sourceEventId
      && check.symbol === item.symbol && check.market === "HK"
      && check.actionIntent === event.humanDecision.actionIntent
      && check.humanCheckResult === event.humanDecision.humanCheckResult
      && check.userFinalDecision === event.humanDecision.userFinalDecision
      && check.reviewDueOn === event.humanDecision.reviewDueOn
      && (check.reviewDueOn
        ? new Date(`${check.reviewDueOn}T00:00:00+08:00`).toISOString() === event.effectiveAt
        : check.checkedAt === event.effectiveAt)) ?? [];
    if (!data || matches.length !== 1) throw new Error("Fresh review history did not contain the exact Today decision check and calendar date.");
    data.submittedCheck = matches[0] as unknown as NonNullable<typeof data.submittedCheck>;
    data.submittedReview = null;
    paint(undefined, detailLines());
    return matches[0].id;
  },
  invalidateDailyTrackingReview: (target) => {
    uiGeneration += 1;
    busy = false;
    if (data?.submittedCheck?.id === target.decisionCheckId) {
      data.submittedCheck = null;
      data.submittedReview = null;
    }
    paint(undefined, detailLines());
  }
});
const deepResearchComparisonConsole = new DeepResearchComparisonConsole({
  memberships: () => candidateWorkflowController.memberships.memberships,
  refreshMemberships: () => candidateWorkflowController.refreshMemberships(),
  readAuth: () => candidateReadAuth(),
  loadDecisionReviewHistory: (membership, readAuth) => client.loadDecisionReviewHistory({
    market: membership.market,
    code: membership.code,
    symbol: membership.symbol
  }, readAuth),
  openDeepResearch: async (membership) => {
    await dailyResearchCockpitBridge.openResearchMembership(membership);
    renderFeaturePanelsFromState();
    document.getElementById("deep-research-console")?.scrollIntoView({ block: "start" });
    document.getElementById("deep-research-refresh")?.focus({ preventScroll: true });
  },
  openDecisionReview: async (membership) => {
    await dailyResearchCockpitBridge.openResearchMembership(membership);
    renderFeaturePanelsFromState();
    document.getElementById("decision-review-case-file")?.scrollIntoView({ block: "start" });
    document.getElementById("decision-review-case-refresh")?.focus({ preventScroll: true });
  },
  openCitation: (membership, citation) => dailyResearchCockpitBridge.openResearchReportCitation(membership, citation)
});
const postDecisionReviewSubmission = new PostDecisionReviewSubmissionController({
  client,
  portfolio: portfolioWorkspaceController,
  dailyTracking: dailyResearchCockpitBridge,
  investment: investmentConsole,
  currentData: () => data,
  auth,
  readAuth: candidateReadAuth,
  readForm: readReviewForm,
  currentGeneration: () => uiGeneration,
  nextGeneration: () => ++uiGeneration,
  setBusy: (next) => { busy = next; },
  paint,
  details: detailLines,
  onDailyTrackingReviewCompleted: (history, review, check) => reportAssistantConsole.offerDailyTrackingCorrection(history, check.id, review.id, review.outcome)
});
function clearAssistLocalRecordDrafts(message?: string): void { assistLocalRecordController.clearDrafts(message); }
function clearAssistReviewKnowledgeDisplay(message: string): void { assistReviewKnowledgeController.clearDisplay(message); }
function currentAssistReviewKnowledgeSymbol(): string | null { return assistReviewKnowledgeController.currentSymbol(); }
function assistReviewKnowledgeReviewReferences(): {
  reviewHistoryAsOf: string | null;
  decisionCheckIds: string[];
  postDecisionReviewIds: string[];
  snapshotAvailability: "preserved" | "partially_unavailable" | "not_referenced";
} {
  const history = data?.reviewHistory ?? null;
  const checks = history?.checks ?? [];
  if (checks.length === 0) {
    return {
      reviewHistoryAsOf: null,
      decisionCheckIds: [],
      postDecisionReviewIds: [],
      snapshotAvailability: "not_referenced"
    };
  }
  return {
    reviewHistoryAsOf: history?.metadata.asOf ?? null,
    decisionCheckIds: checks.map((check) => check.id),
    postDecisionReviewIds: checks.flatMap((check) => check.reviews.map((review) => review.id)),
    snapshotAvailability: checks.every((check) => check.contextSnapshot.availability === "preserved")
      ? "preserved"
      : "partially_unavailable"
  };
}
function restoreAssistReviewKnowledgeForSymbol(symbol: string): void { assistReviewKnowledgeController.restore(symbol); }
function loadAssistReviewKnowledge(): void { assistReviewKnowledgeController.load(); }
function saveAssistReviewKnowledge(replaceSelected: boolean): void { assistReviewKnowledgeController.save(replaceSelected); }
function selectAssistReviewKnowledgeEntry(knowledgeId: string): void { assistReviewKnowledgeController.select(knowledgeId); }
function clearAssistReviewKnowledge(): void { assistReviewKnowledgeController.clear(); }
function savePinganManualSnapshot(): void { pinganManualController.save(); }
function loadSavedPinganManualSnapshot(): void { pinganManualController.load(); }
function clearSavedPinganManualSnapshot(): void { pinganManualController.clear(); }
function saveAssistLocalRecord(): void { assistLocalRecordController.save(); }
function loadAssistLocalRecord(): void { assistLocalRecordController.load(); }
function clearAssistLocalRecord(): void { assistLocalRecordController.clear(); }
function currentAssistLocalArchiveIdentity() {
  const symbol = currentAssistReviewKnowledgeSymbol();
  const sourceSignature = assistLocalRecordSourceSignature();
  const currentSource = assistReviewKnowledgeCurrentSourceIdentity();
  return symbol && sourceSignature && currentSource ? { symbol, sourceSignature, currentSource } : null;
}
function exportAssistLocalArchive(): void {
  const storage = browserLocalStorage();
  const identity = currentAssistLocalArchiveIdentity();
  if (!storage || !identity) {
    assistLocalRecordController.clearDrafts("Local memory export requires the current exact membership and source identity.");
    renderLocalStoragePanelsFromState();
    return;
  }
  try {
    const now = new Date();
    const archive = buildAssistLocalArchive(
      storage, identity, now.toISOString(), reportAssistantConsole.temporaryConversationSnapshot(now)
    );
    downloadAssistLocalArchive(archive);
    assistLocalRecordController.markAvailable(`Exported current browser-local memory with SHA-256 ${archive.payloadHash}.`);
  } catch (error) {
    assistLocalRecordController.message = `Local memory export failed closed: ${error instanceof Error ? error.message : "invalid archive"}`;
  }
  renderLocalStoragePanelsFromState();
}
async function importAssistLocalArchive(file: File): Promise<void> {
  const storage = browserLocalStorage();
  const identity = currentAssistLocalArchiveIdentity();
  if (!storage || !identity) {
    assistLocalRecordController.clearDrafts("Local memory import requires the current exact membership and source identity.");
    renderLocalStoragePanelsFromState();
    return;
  }
  try {
    const operationFingerprint = assistLocalArchiveOperationFingerprint(
      storage, identity, reportAssistantConsole.temporaryConversationState()
    );
    const raw = await file.text();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Local archive shape is invalid.");
    const temporaryConversation = reportAssistantConsole.acceptTemporaryConversation(
      (parsed as Record<string, unknown>).temporaryConversation
    );
    const currentIdentity = currentAssistLocalArchiveIdentity();
    if (!currentIdentity || assistLocalArchiveOperationFingerprint(
      storage, currentIdentity, reportAssistantConsole.temporaryConversationState()
    ) !== operationFingerprint) {
      throw new Error("Current membership, source, or local memory changed while reading the archive; nothing was restored.");
    }
    const archive = restoreAssistLocalArchive(storage, raw, currentIdentity);
    assistLocalRecordController.load();
    assistReviewKnowledgeController.restore(currentIdentity.symbol);
    reportAssistantConsole.restoreTemporaryConversation(temporaryConversation);
    assistLocalRecordController.message = `Restored current browser-local memory after SHA-256 verification (${archive.payloadHash}).`;
  } catch (error) {
    assistLocalRecordController.message = `Local memory import failed closed: ${error instanceof Error ? error.message : "invalid archive"}`;
  }
  renderLocalStoragePanelsFromState();
}
function clearCandidateDecisionPathForMalformedSymbol(message: string): void { candidateWorkflowController.clearDecisionPath("malformed", message, "Malformed selected symbol; local records are hidden until a valid current source reloads."); }
function clearAdvisoryScopeDownstream(state: AssistSourceFailureState, message: string, membershipId: string | null, localRecordMessage: string): void { assistWorkflowController.clearFromAdvisoryScope(state, message, membershipId, localRecordMessage); }
function clearHumanReviewWorkspaceDownstream(state: AssistSourceFailureState, message: string, membershipId: string | null, localRecordMessage: string): void { assistWorkflowController.clearFromHumanReviewWorkspace(state, message, membershipId, localRecordMessage); }
function paint(stages = data ? deriveCoreJourneyStages(data) : currentStages, details: string[] = []): void {
  currentStages = stages;
  currentDetails = details;
  renderJourney();
  renderFeaturePanelsFromState();
}
function renderJourney(): void {
  const portfolioBusy = portfolioWorkspaceController.busy;
  const reportBound = dailyResearchCockpitBridge.adoptedReportBinding() !== null;
  const decisionEnabled = Boolean(
    data?.decisionContext && auth() && !sameDecisionContext(data.submittedCheck, data.decisionContext) && !portfolioBusy
      && (reportBound || data.decisionContext.research.status === "available")
  );
  const reviewEnabled = Boolean(data?.submittedCheck && auth() && !data.submittedReview && !portfolioBusy);
  render({
    stages: currentStages,
    symbol: data?.symbol.symbol ?? null,
    details: currentDetails,
    authMemoryOnly: Boolean(auth()),
    decisionEnabled,
    reviewEnabled,
    busy,
    nextAction: deriveCoreJourneyNextAction({
      stages: currentStages,
      decisionEnabled,
      reviewEnabled,
      loadEnabled: !busy
    }),
    reviewFeedback: deriveReviewFeedback({
      stages: currentStages,
      symbol: data?.symbol.symbol ?? null,
      currentDecisionContext: data?.decisionContext ?? null,
      submittedCheck: data?.submittedCheck ?? null,
      submittedReview: data?.submittedReview ?? null,
      reviewHistory: data?.reviewHistory ?? null,
      pingan: data?.pingan ?? null
    }),
    candidateOverview: candidateWorkflowController.overview,
    candidateBusy: candidateWorkflowController.overviewBusy,
    candidateMemberships: candidateWorkflowController.memberships,
    membershipBusy: candidateWorkflowController.membershipBusy
  });
}
async function load(): Promise<void> {
  const generation = ++uiGeneration;
  const parsed = parseHongKongSymbol(input("symbol-input").value);
  data = null;
  apiPinganSnapshot = null;
  pinganManualController.invalidate("载入流程已开始；本地手工历史快照会等待当前账号范围验证完成。");
  portfolioWorkspaceController.clear("Selected candidate changed; portfolio facts are hidden until the current journey reloads.");
  if (!parsed.ok) {
    pinganManualController.envelope = null;
    pinganManualController.state = "malformed";
    pinganManualController.message = `标的格式无效：${parsed.message}`;
    investmentConsole.clear("malformed", parsed.message);
    clearCandidateDecisionPathForMalformedSymbol(parsed.message);
    clearAssistReviewKnowledgeDisplay("Invalid symbol; retrospective knowledge is hidden until a canonical Hong Kong symbol is selected.");
    paint(initialStages("malformed", parsed.message), [parsed.message]);
    return;
  }
  const loadingMessage = `正在重新读取 ${parsed.value.symbol}；上一标的的决定与助手内容已隐藏。`;
  candidateWorkflowController.clearDecisionPath("unavailable", loadingMessage, "Selected symbol is reloading; source-scoped local records are hidden until current facts reload.");
  investmentConsole.clear("unavailable", loadingMessage);
  restoreAssistReviewKnowledgeForSymbol(parsed.value.symbol);
  busy = true;
  paint(initialStages("loading", `正在读取 ${parsed.value.symbol}。`));
  const result = await client.loadJourney(parsed.value, candidateReadAuth());
  if (generation !== uiGeneration) return;
  busy = false;
  if (!result.ok) {
    investmentConsole.clear(result.state, result.reason);
    paint(initialStages(result.state, result.reason), [result.reason]);
    return;
  }
  apiPinganSnapshot = result.pingan;
  const continuity = currentDecisionContinuity(result.reviewHistory, result.decisionContext);
  data = {
    symbol: parsed.value,
    quote: result.quote,
    research: result.research,
    decisionContext: result.decisionContext,
    pingan: result.pingan,
    reviewHistory: result.reviewHistory,
    // History omits write-response audit fields; the restored workflow uses only contract-validated decision/review fields.
    submittedCheck: continuity?.check as unknown as CoreJourneyData["submittedCheck"] ?? null,
    submittedReview: continuity?.review ?? null
  };
  await candidateWorkflowController.refreshMemberships();
  if (generation !== uiGeneration) return;
  restoreAssistReviewKnowledgeForSymbol(parsed.value.symbol);
  paint(undefined, detailLines());
  void loadPortfolioWorkspaceAndManualSnapshot(generation);
}
async function refreshCandidates(): Promise<void> { await candidateWorkflowController.refreshOverview(); }
async function refreshMemberships(): Promise<void> { await candidateWorkflowController.refreshMemberships(); }
async function loadDecisionIntake(membershipId: string): Promise<void> { await candidateWorkflowController.loadDecisionIntake(membershipId); investmentConsole.reflectDecisionIntake(); renderFeaturePanelsFromState(); }
async function openResearchMembership(membershipId: string, membershipVersion: number, symbol: string): Promise<void> {
  const status = document.getElementById("membership-action-status");
  if (status) status.textContent = `Opening exact ${symbol} Research membership...`;
  try {
    await dailyResearchCockpitBridge.openResearchMembership({ id: membershipId, version: membershipVersion, symbol });
    renderFeaturePanelsFromState();
    if (status) status.textContent = `Opened ${symbol} Research membership ${membershipId} v${membershipVersion}.`;
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : "Exact Research membership could not be opened.";
  }
}
async function loadAssistAdvisoryScope(membershipId: string): Promise<void> { await assistWorkflowController.loadAdvisoryScope(membershipId); }
async function loadAssistHumanReviewWorkspace(membershipId: string): Promise<void> { await assistWorkflowController.loadHumanReviewWorkspace(membershipId); }
async function loadAssistReviewFollowUpWorkflow(membershipId: string): Promise<void> { await assistWorkflowController.loadReviewFollowUpWorkflow(membershipId); }
async function loadAssistDecisionNoteWorkflow(membershipId: string): Promise<void> { await assistWorkflowController.loadDecisionNoteWorkflow(membershipId); }
async function createMembership(): Promise<void> {
  const pending = pendingAssetsResearch;
  const membership = await candidateWorkflowController.createMembership();
  if (!membership) return; if (!pending) { await dailyResearchCockpitBridge.resumePendingOfficialAnnouncement(membership); return; }
  if (pendingAssetsResearch !== pending || pending.generation !== assetsResearchGeneration) return;
  if (membership.symbol !== pending.symbol || !assetsResearchSourceIsCurrent(pending.symbol, pending.sourceKey)) {
    pendingAssetsResearch = null; setAssetsResearchStatus("unknown", "Membership write did not preserve the pending Assets symbol and source; Research was not opened."); return;
  }
  pendingAssetsResearch = null;
  await openAssetsResearch(pending.symbol, pending.sourceKey);
}
async function updateMembershipState(membershipId: string, state: "tracked" | "paused" | "archived", version: number): Promise<void> { await candidateWorkflowController.updateMembershipState(membershipId, state, version); }
async function openCandidate(symbol: string): Promise<void> { input("symbol-input").value = symbol; await load(); }
async function openAssetsResearch(symbolText: string, sourceKey: string): Promise<void> {
  pendingAssetsResearch = null;
  const generation = ++assetsResearchGeneration;
  const parsed = parseHongKongSymbol(symbolText);
  const readAuth = candidateReadAuth();
  const journeyAuth = auth();
  const fail = (state: "unauthorized" | "conflict" | "malformed" | "unavailable", message: string) => {
    if (generation !== assetsResearchGeneration) return;
    candidateWorkflowController.clearDecisionPath(state, message, "Assets-to-Research source is UNKNOWN; local downstream records are hidden.");
    setAssetsResearchStatus("unknown", message);
    paint();
  };
  candidateWorkflowController.clearDecisionPath("unavailable", "Assets-to-Research source is refreshing; prior Research membership facts are hidden.", "Assets-to-Research source is refreshing; local downstream records are hidden.");
  setAssetsResearchStatus("loading", `Fresh-reading the exact active membership for ${symbolText}.`);
  paint();
  if (!parsed.ok || parsed.value.symbol !== symbolText || !sourceKey) return fail("malformed", "Assets-to-Research symbol or source identity is UNKNOWN.");
  if (!readAuth || !journeyAuth) return fail("unauthorized", "Assets-to-Research authorization is UNKNOWN; no Research navigation occurred.");
  await candidateWorkflowController.refreshMemberships(true);
  if (generation !== assetsResearchGeneration) return;
  if (!sameWebApiAuth(readAuth, candidateReadAuth()) || !sameWebApiAuth(journeyAuth, auth())
    || !assetsResearchSourceIsCurrent(symbolText, sourceKey)) return fail("conflict", "Assets, symbol, or authorization changed during fresh membership read; old facts were cleared and remain UNKNOWN.");
  if (!["available", "empty"].includes(candidateWorkflowController.memberships.state)) return fail("unavailable", `Candidate memberships are ${candidateWorkflowController.memberships.state}; Research navigation remains UNKNOWN.`);
  let membership: CandidateMembershipData;
  try {
    const action = assetsResearchMembershipAction(candidateWorkflowController.memberships.memberships, parsed.value);
    if (action.kind === "onboard") {
      input("membership-code").value = parsed.value.code; input("membership-initial-state").value = "tracked";
      (input("membership-restore-archived") as HTMLInputElement).checked = action.restoreArchived;
      pendingAssetsResearch = { symbol: symbolText, sourceKey, generation };
      setAssetsResearchStatus("available", `${symbolText} needs an explicit ${action.restoreArchived ? "Restore archived" : "Add"} click; no membership was written.`);
      document.getElementById("candidate-memberships")?.scrollIntoView({ block: "start" }); return;
    }
    membership = action.membership;
  } catch {
    return fail("conflict", "Exactly one non-archived exact-symbol membership was not fresh-read; Research navigation remains UNKNOWN.");
  }
  await openCandidate(symbolText);
  if (generation !== assetsResearchGeneration) return;
  if (!sameWebApiAuth(readAuth, candidateReadAuth()) || !sameWebApiAuth(journeyAuth, auth())
    || !assetsResearchSourceIsCurrent(symbolText, sourceKey) || data?.symbol.symbol !== symbolText) return fail("conflict", "Assets, symbol, authorization, or journey source changed; old facts were cleared and remain UNKNOWN.");
  await loadDecisionIntake(membership.id);
  const intake = candidateWorkflowController.decisionIntake;
  let currentMembership: CandidateMembershipData;
  try {
    currentMembership = requireSingleActiveMembershipBySymbol(candidateWorkflowController.memberships.memberships, symbolText);
  } catch {
    return fail("conflict", "Research membership changed during the Assets handoff; old facts were cleared and remain UNKNOWN.");
  }
  if (generation !== assetsResearchGeneration || !sameWebApiAuth(readAuth, candidateReadAuth()) || !sameWebApiAuth(journeyAuth, auth()) || !assetsResearchSourceIsCurrent(symbolText, sourceKey)
    || currentMembership.id !== membership.id || currentMembership.version !== membership.version
    || intake.membershipId !== membership.id || intake.membershipVersion !== membership.version || intake.symbol !== symbolText
    || !["ready", "review_required"].includes(intake.state)) return fail("conflict", "Research intake did not preserve the exact fresh membership, symbol, version, authorization, and source; old facts were cleared and remain UNKNOWN.");
  setAssetsResearchStatus("available", `${symbolText} opened in existing Research. Enter a scenario amount explicitly, then choose Fresh-read explanation; only fresh authorized Pingan context is used.`);
  document.getElementById("portfolio-report-explanation")?.scrollIntoView({ block: "start" });
}
function assetsResearchSourceIsCurrent(symbol: string, sourceKey: string): boolean {
  return [...document.querySelectorAll<HTMLElement>("[data-assets-research-symbol][data-assets-research-source-key]")]
    .some((item) => item.dataset.assetsResearchSymbol === symbol && item.dataset.assetsResearchSourceKey === sourceKey);
}
function setAssetsResearchStatus(state: "idle" | "loading" | "available" | "unknown", message: string): void {
  const status = document.getElementById("assets-research-handoff-status");
  if (status) { status.dataset.state = state; status.textContent = `${state}: ${message}`; }
}
async function submitDecision(): Promise<void> {
  const submissionAuth = auth();
  const submissionData = data;
  const submissionContext = submissionData?.decisionContext;
  if (!submissionData || !submissionContext || !submissionAuth || portfolioWorkspaceController.busy) return;
  const reportBinding = dailyResearchCockpitBridge.adoptedReportBinding();
  let decisionForm: ReturnType<typeof readDecisionForm>;
  try {
    decisionForm = readDecisionForm(reportBinding !== null);
    const personalRisk = decisionForm.formalDecision?.personalRisk;
    if (reportBinding && personalRisk) {
      const context = portfolioWorkspaceController.viewState.context;
      const risk = portfolioWorkspaceController.viewState.riskImpact;
      const assessment = evaluateFormalPersonalRisk(personalRisk.limits, {
        candidateWeight: risk?.scenario.candidateWeight ?? null,
        largestPositionWeight: risk?.scenario.largestPositionWeight ?? null,
        portfolioHhi: risk?.scenario.hhi ?? null,
        unrealizedLossHkd: typeof context?.summary.unrealizedPnl === "number" ? Math.max(0, -context.summary.unrealizedPnl) : null
      });
      if (assessment.requiresOverride) {
        if (!personalRisk.overrideReason) throw new Error("Personal risk warnings require an explicit override reason.");
        const labels = [
          ...assessment.warnings.map((warning) => warning.code),
          ...assessment.unavailableMetrics.map((metric) => `${metric}:fact_unavailable`)
        ].join("\n");
        if (!globalThis.confirm(`Strong personal-risk warning:\n${labels}\n\nConfirm again to permanently record this override without creating any trade.`)) return;
        decisionForm.formalDecision = {
          ...decisionForm.formalDecision!,
          personalRisk: { ...personalRisk, secondConfirmed: true }
        };
      } else {
        decisionForm.formalDecision = {
          ...decisionForm.formalDecision!,
          personalRisk: { ...personalRisk, overrideReason: null, secondConfirmed: false }
        };
      }
    }
  } catch (error) {
    currentDetails = [error instanceof Error ? error.message : "Formal decision input is invalid.", ...detailLines()];
    paint(undefined, currentDetails);
    return;
  }
  const generation = ++uiGeneration;
  let identity = captureDecisionSubmissionIdentity(generation, submissionData, investmentConsole.currentSource()?.sourceKey ?? null);
  const currentState = () => ({ generation: uiGeneration, data, sourceKey: investmentConsole.currentSource()?.sourceKey ?? null });
  const isCurrent = () => matchesDecisionSubmissionIdentity(identity, currentState());
  const finishStale = () => {
    if (generation !== uiGeneration) return;
    busy = false;
    paint();
  };
  busy = true;
  paint(undefined, detailLines());
  const result = await runDecisionSubmission({
    submissionAuth,
    currentAuth: auth,
    isCurrent,
    onStale: finishStale,
    prepare: () => {
      return investmentConsole.prepareDecision(
        portfolioWorkspaceController.decisionSnapshotBinding(),
        decisionForm,
        reportBinding
      );
    },
    preparedBindingMatches: (prepared) => prepared.bindingSource === "confirmed_report"
      ? "bindingVersion" in prepared.binding
        && dailyResearchCockpitBridge.matchesAdoptedReportBinding(prepared.binding)
        && prepared.payload.decisionSnapshotBinding !== undefined
        && portfolioWorkspaceController.matchesDecisionSnapshotBinding(prepared.payload.decisionSnapshotBinding)
      : prepared.bindingSource === "portfolio_workspace"
        ? "schemaVersion" in prepared.binding && portfolioWorkspaceController.matchesDecisionSnapshotBinding(prepared.binding)
        : "schemaVersion" in prepared.binding,
    submit: (prepared) => client.submitDecisionCheck(submissionData.symbol, submissionContext, prepared.binding, submissionAuth, prepared.payload),
    acceptsResponse: (check, prepared) => investmentConsole.matchesDecisionResponse(check, prepared)
  });
  if (!result) return;
  if (!isCurrent()) return finishStale();
  busy = false;
  if (!result.ok) {
    submissionData.submittedCheck = null;
    submissionData.submittedReview = null;
    submissionData.reviewHistory = null;
    paint([...deriveCoreJourneyStages(submissionData).slice(0, 3), { id: "decision", title: "Human decision check", state: result.state, message: result.reason }, deriveCoreJourneyStages(submissionData)[4]], [result.reason, ...detailLines()]);
    return;
  }
  submissionData.submittedCheck = result.value;
  const historyRefresh = await postDecisionReviewSubmission.refreshHistoryAfterWrite(submissionData.symbol, generation);
  if (!historyRefresh) return;
  identity = historyRefresh.identity;
  if (!matchesDecisionSubmissionIdentity(identity, currentState())) return;
  const historyRefreshMessage = historyRefresh.message;
  if (result.value.researchReportDecision.availability === "preserved") {
    const binding = result.value.researchReportDecision.binding;
    const matches = submissionData.reviewHistory?.checks.filter((check) => check.id === result.value.id
      && check.researchReportDecision.availability === "preserved"
      && canonicalJson(check.researchReportDecision.binding) === canonicalJson(binding)) ?? [];
    if (matches.length !== 1) {
      submissionData.submittedCheck = null;
      submissionData.reviewHistory = null;
      paint(undefined, ["Fresh decision-review readback did not preserve the exact adopted report binding; prior success was cleared.", ...detailLines()]);
      return;
    }
    if (result.value.formalDecision.availability !== "preserved"
      || matches[0].formalDecision.availability !== "preserved"
      || canonicalJson(matches[0].formalDecision) !== canonicalJson(result.value.formalDecision)) {
      submissionData.submittedCheck = null;
      submissionData.reviewHistory = null;
      paint(undefined, ["Formal decision fresh readback did not preserve the exact Owner decision and report recommendation.", ...detailLines()]);
      return;
    }
    try {
      await dailyResearchCockpitBridge.completeFormalDecision(binding, matches[0].id);
    } catch (error) {
      const continuity = error instanceof Error ? error.message : "Today tracking continuity is UNKNOWN.";
      paint(undefined, [continuity, ...(historyRefreshMessage ? [historyRefreshMessage] : []), ...detailLines()]);
      return;
    }
  }
  paint(undefined, historyRefreshMessage ? [historyRefreshMessage, ...detailLines()] : detailLines());
}
async function submitReview(): Promise<void> {
  await postDecisionReviewSubmission.submit();
}
function detailLines(): string[] { return journeyDetailLines(data, data ? pinganManualController.displayProvenance(data.symbol.symbol) : "unavailable"); }
function handleAuthorizationChanged(): void {
    const message = "Runtime authorization changed; account-scoped facts are hidden until explicitly reloaded.";
    client.invalidateAuthorizationRetries();
    investmentConsole.invalidateAuthorizationRetries(); deepResearchConsole.invalidateAuthorizationRetries(message);
    reportAssistantConsole.invalidateAuthorization(message);
    dailyResearchCockpitBridge.invalidateAuthorization(message); decisionBriefConsole.invalidate(message); decisionReviewCaseFile.invalidate(message);
    assetsResearchGeneration += 1; pendingAssetsResearch = null;
    uiGeneration += 1;
    busy = false;
    data = null; apiPinganSnapshot = null; pinganManualController.invalidate(message);
    portfolioWorkspaceController.clear(message);
    candidateWorkflowController.invalidateAuthorization(message);
    investmentConsole.clear("unauthorized", message);
    paint(initialStages("unauthorized", message), [message]);
}
function handleSymbolChanged(): void {
    const parsed = parseHongKongSymbol(input("symbol-input").value);
    if (parsed.ok && parsed.value.symbol === data?.symbol.symbol) return;
    const message = parsed.ok
      ? "Selected symbol changed; current facts and source-scoped local state are hidden until this symbol reloads."
      : `Selected symbol is malformed: ${parsed.message}`;
    assetsResearchGeneration += 1; pendingAssetsResearch = null;
    dailyResearchCockpitBridge.invalidateAnnouncementContinuation(message);
    uiGeneration += 1;
    busy = false;
    data = null; apiPinganSnapshot = null; pinganManualController.invalidate(message);
    portfolioWorkspaceController.clear(message);
    candidateWorkflowController.clearDecisionPath(
      parsed.ok ? "unavailable" : "malformed", message,
      "Selected symbol changed; source-scoped local records are hidden until current facts reload."
    );
    investmentConsole.clear(parsed.ok ? "unavailable" : "malformed", message);
    paint(initialStages(parsed.ok ? "unavailable" : "malformed", message), [message]);
}
function handleTextInputChanged(targetId: string): void {
    if (
      targetId === "assist-review-knowledge-evidence-lesson" ||
      targetId === "assist-review-knowledge-process-lesson" ||
      targetId === "assist-review-knowledge-unresolved-question" ||
      targetId === "assist-review-knowledge-uncertainty-note"
    ) {
      assistReviewKnowledgeController.updateFields({
        evidenceLesson: input("assist-review-knowledge-evidence-lesson").value.slice(0, 4000),
        processLesson: input("assist-review-knowledge-process-lesson").value.slice(0, 4000),
        unresolvedQuestion: input("assist-review-knowledge-unresolved-question").value.slice(0, 4000),
        uncertaintyNote: input("assist-review-knowledge-uncertainty-note").value.slice(0, 4000)
      });
      return;
    }
    if (
      targetId === "assist-local-record-research-thought" ||
      targetId === "assist-local-record-decision-thought" ||
      targetId === "assist-local-record-evidence-gap-note" ||
      targetId === "assist-local-record-later-review-note"
    ) {
      assistLocalRecordController.updateDrafts({
        researchThought: input("assist-local-record-research-thought").value.slice(0, 4000),
        decisionThought: input("assist-local-record-decision-thought").value.slice(0, 4000),
        evidenceGapNote: input("assist-local-record-evidence-gap-note").value.slice(0, 4000),
        laterReviewNote: input("assist-local-record-later-review-note").value.slice(0, 4000)
      });
      return;
    }
    if (targetId === "assist-decision-note-workflow-draft") {
      assistWorkflowController.updateDecisionNoteDraft(input("assist-decision-note-workflow-draft").value);
      renderAssistWorkflowPanelsFromState();
      return;
    }
    if (targetId !== "assist-review-follow-up-manual-note" && targetId !== "assist-review-follow-up-later-review" && targetId !== "assist-review-follow-up-evidence-gaps") return;
    assistWorkflowController.updateFollowUpDrafts({
      manualNote: input("assist-review-follow-up-manual-note").value,
      laterReview: input("assist-review-follow-up-later-review").value,
      evidenceGapChecklist: input("assist-review-follow-up-evidence-gaps").value
    });
    renderAssistWorkflowPanelsFromState();
}
function handleReviewKnowledgeSelectionChanged(knowledgeId: string): void {
    if (!knowledgeId) { assistReviewKnowledgeController.clearSelection(); return; }
    selectAssistReviewKnowledgeEntry(knowledgeId);
}
if (typeof document !== "undefined") {
  deepResearchConsole.mount(document);
  deepResearchComparisonConsole.mount(document);
  reportAssistantConsole.mount(document);
  dailyResearchCockpitBridge.mount(document); decisionBriefConsole.mount(document); decisionReviewCaseFile.mount(document);
  bindAppEvents(document, {
    symbolChanged: handleSymbolChanged,
    authorizationChanged: handleAuthorizationChanged,
    load: () => void load(),
    refreshCandidates: () => void refreshCandidates(),
    refreshMemberships: () => void refreshMemberships(),
    createMembership: () => void createMembership(),
    openCandidate: (symbol) => void openCandidate(symbol),
    openAssetsResearch: (symbol, sourceKey) => void openAssetsResearch(symbol, sourceKey),
    openResearchMembership: (membershipId, membershipVersion, symbol) => void openResearchMembership(membershipId, membershipVersion, symbol),
    loadDecisionIntake: (membershipId) => void loadDecisionIntake(membershipId),
    loadAdvisoryScope: (membershipId) => void loadAssistAdvisoryScope(membershipId),
    loadHumanReviewWorkspace: (membershipId) => void loadAssistHumanReviewWorkspace(membershipId),
    loadReviewFollowUpWorkflow: (membershipId) => void loadAssistReviewFollowUpWorkflow(membershipId),
    loadDecisionNoteWorkflow: (membershipId) => void loadAssistDecisionNoteWorkflow(membershipId),
    updateMembershipState: (membershipId, state, version) => void updateMembershipState(membershipId, state, version),
    submitDecision: () => void submitDecision(),
    submitReview: () => void submitReview(),
    portfolioRefresh: () => void loadPortfolioWorkspaceAndManualSnapshot(),
    portfolioRisk: () => void portfolioWorkspaceController.calculateRisk(Number(input("portfolio-risk-amount").value)),
    portfolioLab: () => void portfolioWorkspaceController.calculateLab(parseAnnualPortfolioLabAmountText(input("portfolio-lab-amounts").value) ?? []),
    portfolioLabCompare: () => {
      const select = document.getElementById("portfolio-lab-compare-membership");
      const target = select instanceof HTMLSelectElement ? portfolioLabMembershipById(select.value) : null;
      if (!target) { portfolioWorkspaceController.invalidateComparedLab("Select another exact tracked membership."); return; }
      void portfolioWorkspaceController.compareLab(target, parseAnnualPortfolioLabAmountText(input("portfolio-lab-amounts").value) ?? []);
    },
    portfolioLabAmountsChanged: () => portfolioWorkspaceController.invalidateLab("User scenario amounts changed; previous portfolio scenarios were discarded."),
    portfolioLabComparisonChanged: () => portfolioWorkspaceController.invalidateComparedLab("Tracked stock changed; explicitly load the same-amount comparison."),
    pinganManualAction: (action) => action === "save" ? savePinganManualSnapshot() : action === "load" ? loadSavedPinganManualSnapshot() : clearSavedPinganManualSnapshot(),
    reviewKnowledgeAction: (action) => action === "save" ? saveAssistReviewKnowledge(false) : action === "replace" ? saveAssistReviewKnowledge(true) : action === "load" ? loadAssistReviewKnowledge() : clearAssistReviewKnowledge(),
    localRecordAction: (action) => action === "save" ? saveAssistLocalRecord() : action === "load" ? loadAssistLocalRecord() : clearAssistLocalRecord(),
    textInputChanged: handleTextInputChanged,
    reviewKnowledgeSelectionChanged: handleReviewKnowledgeSelectionChanged,
    controlTab: (tab) => investmentConsole.setTab(tab),
    controlAction: (action) => action === "save-profile" ? void investmentConsole.saveResearchProfile() : action === "add-evidence" ? void investmentConsole.addResearchEvidence() : action === "run-valuation" ? void investmentConsole.loadValuation() : action === "run-registered-research" ? void investmentConsole.runRegisteredValuation() : void investmentConsole.loadConditional(),
    controlInputChanged: (id) => investmentConsole.inputChanged(id),
    conditionalBoundChanged: (bound) => investmentConsole.setConditionalBound(bound)
  });
  paint();
  bindAssistLocalArchiveEvents(document, exportAssistLocalArchive, (file) => void importAssistLocalArchive(file));
}
function renderLocalStoragePanelsFromState(): void { renderFeaturePanelsFromState(); }
function renderAssistWorkflowPanelsFromState(): void { renderFeaturePanelsFromState(); }
function renderFeaturePanelsFromState(): void {
  renderWebFeaturePanels({
    data,
    busy,
    candidateMemberships: candidateWorkflowController.memberships,
    membershipBusy: candidateWorkflowController.membershipBusy,
    decisionIntake: candidateWorkflowController.decisionIntake,
    decisionIntakeBusy: candidateWorkflowController.decisionIntakeBusy,
    pingan: pinganManualController,
    localRecord: assistLocalRecordController,
    reviewKnowledge: assistReviewKnowledgeController,
    assistWorkflow: assistWorkflowController,
    localRecordSourceSignature: assistLocalRecordSourceSignature(),
    reviewKnowledgeCurrentSymbol: currentAssistReviewKnowledgeSymbol()
  });
  renderPortfolioLabComparisonMemberships(
    candidateWorkflowController.memberships.memberships,
    candidateWorkflowController.decisionIntake.membershipId
  );
  renderPortfolioWorkspace(portfolioWorkspaceController.viewState);
  investmentConsole.render();
  deepResearchConsole.syncSource();
  deepResearchComparisonConsole.syncMemberships();
  reportAssistantConsole.syncSource(); reportAssistantConsole.syncReviewHistory(data?.reviewHistory ?? null);
  dailyResearchCockpitBridge.syncMembership(); decisionBriefConsole.syncSource(); decisionReviewCaseFile.sync(data?.reviewHistory ?? null);
}
