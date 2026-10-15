import SwiftUI

private enum MakeV9ResearchView {
    case list
    case detail
}

private enum MakeV9ResearchDetailTab {
    case judgment
    case technical
    case financials
}

struct GateBResearchScreen: View {
#if OWNER_CLIENT
    @Environment(\.clientDestination) var clientDestination
    @Environment(\.antigravityActions) var researchActions
    @State var clientDestinationReady = false
    @ObservedObject var ownerStore = OwnerClientStore.shared
    @State var personalFormalVerificationId: UUID?
    @State var personalFormalTaskReadConfirmed = false
    @State var personalFormalMessage: String?
    @State var personalFormalSourceMessage: String?
    @State var personalFormalSources: [PersonalFormalSourceHint] = []
    @State var personalFormalProviderSources: [PersonalFormalProviderSourceHint] = []
    @State var personalFormalMaterialReviewed = false
    @State var personalFormalReviewedMaterialBinding: String?
    @State var manualHandoffSession = ManualResearchHandoffSession()
    @State var manualDirectSelectionMembershipKey: String?
    @State var manualDirectSelectedMaterialIds: Set<String> = []
    @State var manualDirectAvailableMaterials: [ResearchMaterialData] = []
    @State var manualDirectVerifiedSources: [ManualDirectSavedSourceSelection] = []
    @State var manualDirectSelectionId = UUID()
    @State var manualDirectSourceMessage: String?
    @State var isVerifyingManualDirectSources = false
    @State var manualResearchMessage: String?
    @State var manualSelectedEvidenceSourceId: String?
    @State var manualDecisionText = ""
    @State var manualReviewDateEnabled = false
    @State var manualReviewDate = Date()
    @State var manualDecisionMessage: String?
    @State var manualDecisionReadbackId: String?
    @State var manualUnconfirmedDecision: DecisionCheckData?
    @State var manualPendingDecisionRequest: ManualDecisionRequestReservation?
    @State var manualDecisionSubmissionState = DecisionCheckSubmissionState()
    @State var manualDecisionPreflightInFlight = false
#endif
    @State var personalFormalMaterialReviewRequired = false
    @State var personalFormalMaterialListExpanded = false
    @Environment(\.scenePhase) var scenePhase
    @Environment(\.openURL) var openURL
    @Environment(\.dynamicTypeSize) var dynamicTypeSize
    @Binding var symbolInput: String
    @Binding var selectedDecisionLayer: DailyDecisionRingLayer
    let initialResumeResult: DailyClientResumeLoadResult
    let marketTechnicalEnvelope: MarketDailyTechnicalEnvelope?
    let marketWeinsteinEnvelope: WeinsteinTechnicalAnalysisEnvelope?
    @Binding var localDecisionDraft: LocalDecisionDraft?
    @Binding var selectedTab: AnnualRingsTab
    @Binding var todayRefreshRevision: UInt64
    let researchNavigationRevision: UInt64
    @Binding var requestedTodayReviewTarget: TodayReviewNavigationTarget?
    @Binding var requestedTodayFormalDecisionTarget: TodayFormalDecisionNavigationTarget?
    @Binding var requestedTodayResearchTarget: TodayResearchNavigationTarget?
    @Binding var requestedTodayCandidateTarget: TodayCandidateNavigationTarget?
    @Binding var requestedTodayReportRevision: TodayReportRevisionNotice?
    @Binding var todayReportRevisionNotice: TodayReportRevisionNotice?
    @Binding var globalToolSheet: GlobalToolSheet?
    @Binding var pendingNoticeLead: NoticeLeadResearchHandoff?
    @Binding var pendingOfficialAnnouncement: OfficialAnnouncementDiscoveryItem?
    let resumePendingMarketAnnouncement: (String) -> Void
    @StateObject var viewModel = GateBResearchViewModel()
    var currentMarketTechnicalEnvelope: MarketDailyTechnicalEnvelope? {
        guard let canonical = SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical,
              let envelope = researchMarketTechnicalEnvelope ?? marketTechnicalEnvelope,
              envelope.isBound(to: canonical) else {
            return nil
        }
        return envelope
    }
    var currentMarketWeinsteinEnvelope: WeinsteinTechnicalAnalysisEnvelope? {
        guard let canonical = parsedSymbol?.canonical else {
            return nil
        }
        if let envelope = marketWeinsteinEnvelope,
           envelope.status == "available",
           envelope.symbol == canonical,
           envelope.analysisAsOf == currentHongKongRequestDate() {
            return envelope
        }
        guard let membership = selectedMembership,
              let envelope = portfolioResearchWeinstein[membership.id],
              envelope.status == "available",
              envelope.symbol == canonical,
              envelope.analysisAsOf == currentHongKongRequestDate() else {
            return nil
        }
        return envelope
    }
    @State var dailyRefreshGate = DailyClientRefreshGate()
    @State var dailyContinuityMessage: String?
    @State var hasConsumedInitialResume = false
    @State var decisionLayerAfterSymbolChange: DailyDecisionRingLayer?
    @State var pendingDecisionWorkspaceScrollTarget: String?
    @State var renderedDecisionReviewTimelineIdentity: DecisionReviewTimelineIdentity?
    @State var pendingDecisionBriefMembershipAfterSymbolChange: CandidateMembershipData?
    @State var isCandidateManagementExpanded = false
    @State var selectedCandidateWorkspace = DailyCandidateWorkspace.overview
    @State var isAnnualDecisionBriefResearchEditorExpanded = false
    @State var selectedEvidenceWorkspace = DailyEvidenceWorkspace.brief
    @State var isHistoricalReportsExpanded = false
    @State var isResearchEvidenceRecordsExpanded = false
    @State var makeV9WorkspacePresentation: ResearchWorkspace?
    @State private var makeV9ResearchView = MakeV9ResearchView.list
    @State private var makeV9ResearchDetailTab = MakeV9ResearchDetailTab.judgment
    @State var isResearchBriefFullJudgmentExpanded = false
    @State var isAnnualDecisionBriefExpanded = false
    @State var isResearchEventCaptureExpanded = true
    @State var researchDocumentWorkspace = ResearchDocumentWorkspaceState()
    @State var researchSourceSnapshotWorkspace = ResearchSourceSnapshotWorkspaceState()
    @State var futuFinancialWorkspace = FutuFinancialWorkspaceState()
    @State var researchStoredTextPresentation: ResearchStoredTextPresentation?
    @State var researchReportPeerOriginalPresentation: ResearchSavedOriginalPresentation?
    @State var researchFundamentalWorkspace = ResearchFundamentalWorkspaceState()
    @State var researchFinancialRequirementWorkspace = ResearchFinancialRequirementWorkspaceState()
    @State var researchContextWorkspace = ResearchContextWorkspaceState()
    @State var researchValuationScenarioWorkspace = ResearchValuationScenarioWorkspaceState()
    @State var researchMarketTechnicalEnvelope: MarketDailyTechnicalEnvelope?
    @State var researchWeinsteinEnvelope: WeinsteinTechnicalAnalysisEnvelope?
    @State var researchWeinsteinZoneCorrectionDraft = WeinsteinZoneCorrectionDraft(); @State var researchWeinsteinZoneCorrectionMessage = "先运行当前股票的 Weinstein 主分析，再保存人工区域修正。"; @State var researchWeinsteinZoneCorrectionReservation = ResearchDocumentIdempotencyReservation(); @State var isSavingResearchWeinsteinZoneCorrection = false
    @State var researchTechnicalRequestLane = FrozenResearchTechnicalRequestLane()
    @State var activeResearchTechnicalRefreshSource: DailyClientSourceKey?
    @State var activeResearchTechnicalRefreshRevision: UUID?
    var isRefreshingResearchTechnicalEvidence: Bool { activeResearchTechnicalRefreshSource != nil }
    @State var frozenResearchEvidenceWorkspace = FrozenResearchEvidenceWorkspaceState()
    @State var researchEventDraft = ResearchEventCaptureDraft()
    @State var showsResearchSourceImport = false
    @State var isSavingResearchEvent = false
    @State var researchEventMessage = "可把已核对的公告、新闻、风险或反证保存到当前研究证据链。"
    @State var researchEventMaterialReservation = ResearchDocumentIdempotencyReservation()
    @State var researchEventBindingReservation = ResearchDocumentIdempotencyReservation()
    @State var geelySalesMonitorDraft = GeelySalesMonitorDraft()
    @State var isSavingGeelySalesMonitor = false
    @State var geelySalesMonitorMessage = "可把已核对销量事件绑定成可复算的月度监测。"
    @State var geelySalesMonitorReservation = ResearchDocumentIdempotencyReservation()
    @State var gclPvPriceMonitorDraft = GclPvPriceMonitorDraft()
    @State var isSavingGclPvPriceMonitor = false
    @State var gclPvPriceMonitorMessage = "可把已核对的光伏价格与经营事件绑定成可复算监测。"
    @State var gclPvPriceMonitorReservation = ResearchDocumentIdempotencyReservation()
    @State var twoLayerReportWorkspace = TwoLayerReportWorkspaceState()
    @AppStorage(researchTemporaryConversationRetentionDefaultsKey) var researchTemporaryConversationRetentionRaw =
        ResearchTemporaryConversationRetention.thirtyDays.rawValue
    @AppStorage(CandidateResearchPriorityPreferences.defaultsKey) var candidateResearchPriorityRaw = ""
    @State var researchTemporaryConversationDeletionPending = false
    @State var researchEvidenceQuestionReservation = ResearchDocumentIdempotencyReservation()
    @State var cloudAiPolicy: CloudAiPolicyEnvelope?
    @State var cloudAiPolicyMessage = "尚未读取当前 Owner 的 Cloud AI 策略。"
    @State var cloudAiPolicyReservation = ResearchDocumentIdempotencyReservation()
    @State var isLoadingCloudAiPolicy = false; @State var cloudAiNoBackupConfirmed = false
    @State var comparedReportFirstId: String?
    @State var comparedReportSecondId: String?
    @State var comparedMembershipId: String?
    @State var comparedExternalWorkspace: FrozenResearchEvidenceWorkspace?
    @State var comparedExternalReportId: String?
    @State var comparedCurrentCrossStockReportId: String?
    @State var comparedExternalRequestId = UUID()
    @State var isLoadingComparedExternalReports = false
    @State var comparedExternalMessage = "请选择另一只研究股票读取报告。"
    @State var twoLayerReportRejectionReason = ""
    @State var researchReviewQuestionHandoff: ResearchReviewQuestionHandoff?
    @State var manualReviewResearchHandoff: ResearchReviewQuestionHandoff?
    @State var manualReviewResearchQuestionOnlyDraft = ""
    @State var manualReviewResearchQuestionDraft = ""
    @State var manualReviewResearchMessage: String?
    @State var researchReportFormalDecisionBinding: ResearchReportDecisionBinding?
    @State var researchReportFormalDecisionMessage: String?
    @State var researchReportFormalDecisionIntent = DecisionActionIntent.watch
    @State var researchReportFormalDecisionDraft = FormalOwnerDecisionDraft()
    @State var pendingResearchReportReconsiderationId: String?
    @State var pendingResearchReportRevisionSourceReservation: TodayReportRevisionSourceReservation?
    @State var pendingTodayResearchReportSaveReservation: TodayResearchReportSaveReservation?
    @State var pendingTodayReportConfirmationReservation: TodayReportConfirmationReservation?
    @State var dailyTrackingReconsiderationDraftBinding: DailyTrackingReconsiderationDraftBinding?
    @State var dailyTrackingReconsiderationCorrection = ""
    @State var dailyTrackingReconsiderationNextQuestion = ""
    @State var dailyTrackingReconsiderationCounterevidence = ""
    @State var dailyTrackingReconsiderationMessage: String?
    @State var dailyTrackingReportRevisionMessage: String?
    @State var selectedResearchEditorPage = AnnualDecisionBriefResearchPage.profile
    @State var selectedPortfolioWorkspace = DailyPortfolioWorkspace.current
    @State var isDecisionBoundaryExpanded = false
    @State var selectedHumanDecisionWorkspace = DailyHumanDecisionWorkspace.conditions
    @State var isLocalReviewRecordsExpanded = false
    @State var selectedReviewWorkspace = DailyReviewWorkspace.learning
    @State var candidateOverview = CandidateOverviewEnvelope.unavailable("正在读取候选标的概览...")
    @State var candidateMemberships = CandidateMembershipEnvelope.unavailable("正在读取研究自选...", includeArchived: true)
    @State var portfolioResearchWorkspaces: [String: FrozenResearchEvidenceWorkspace] = [:]
    @State var portfolioResearchCompanyNames: [String: String] = [:]
    @State var portfolioResearchWeinstein: [String: WeinsteinTechnicalAnalysisEnvelope] = [:]
    @State var portfolioResearchRequestId = UUID()
    @State var portfolioResearchLoadedIdentity: String?
    @State var portfolioResearchMessage = "正在读取组合研究判断..."
    @State var isLoadingPortfolioResearch = false
    @State var membershipSubmissionState = CandidateMembershipSubmissionState()
    @State var membershipInitialState = CandidateMembershipInitialState.tracked
    @State var membershipInput = ""
    @State var includeArchivedMemberships = true
    @State var focusesCurrentMembership = false
    @State var restoreArchivedMembership = false
    @State var membershipWriteMessage: String?
    @State var membershipStaleMessage: String?
    @State var selectedMembership: CandidateMembershipData?
    @State var todayResearch = TodayResearchEnvelope.unavailable(
        message: "请选择一个研究自选成员读取 Today。",
        membershipId: "unselected"
    )
    @State var todayResearchRequestId = UUID()
    @State var isLoadingTodayResearch = false
    @State var decisionIntakeModel = candidateDecisionIntakeFailClosedModel(
        state: "idle",
        message: "请选择一个研究自选成员读取决策准备。"
    )
    @State var annualDecisionBriefModel = annualDecisionBriefFailClosedModel(
        state: "idle",
        message: "请选择一个研究自选成员读取每日决策简报。"
    )
    @State var valuationQuantDraft = AnnualValuationQuantDraft.empty
    @State var valuationQuantEnvelope = AnnualValuationQuantWorkbenchEnvelope.unavailable(
        "请选择一个研究自选成员并填写用户情景。",
        membershipId: "unselected",
        clientFailureState: "idle"
    )
    @State var valuationQuantInputMessage: String?
    /// Exact registered-quant run readback: the existing candidate
    /// decision-intake envelope whose decision context carries the historical
    /// quant evidence published by the last accepted registered run. It is
    /// independent of any user valuation scenario or filter input.
    @State var registeredQuantIntake: CandidateDecisionIntakeEnvelope?
    @FocusState var focusedValuationInput: ValuationInputField?
    @State var annualDecisionBriefProfileDraft = AnnualDecisionBriefProfileDraft.empty
    @State var annualDecisionBriefProfileLoadedDraft = AnnualDecisionBriefProfileDraft.empty
    @State var annualDecisionBriefProfileDraftSource: AnnualDecisionBriefProfileDraftSource?
    @State var annualDecisionBriefEvidenceDraft = AnnualDecisionBriefEvidenceDraft.empty
    @State var annualDecisionBriefWriteMessage: String?
    @State var annualDecisionBriefProfileSubmissionState = AnnualDecisionBriefProfileSubmissionState()
    @State var annualDecisionBriefEvidenceSubmissionState = AnnualDecisionBriefEvidenceSubmissionState()
    @State var advisoryScopeModel = assistAdvisoryScopeFailClosedModel(
        state: "idle",
        message: "请选择一个研究自选成员读取 ASSIST 范围。"
    )
    @State var humanReviewWorkspaceModel = assistHumanReviewWorkspaceFailClosedModel(
        state: "idle",
        message: "请选择一个研究自选成员读取本地人工复核工作台。"
    )
    @State var reviewFollowUpWorkflowModel = assistReviewFollowUpWorkflowFailClosedModel(
        state: "idle",
        message: "请选择一个研究自选成员读取本地复核后续 workflow。"
    )
    @State var reviewFollowUpDrafts = AssistReviewFollowUpDrafts.empty
    @State var decisionNoteWorkflowModel = assistDecisionNoteWorkflowFailClosedModel(
        state: "idle",
        message: "请选择一个研究自选成员读取本地 decision note workflow。"
    )
    @State var decisionNoteDrafts = AssistDecisionNoteDrafts.empty
    @State var localRecordDrafts = AssistMobileWorkspaceLocalRecordDrafts.empty
    @State var localRecordMessage: String?
    @State var localRecordClearConfirmationSourceSignature: String?
    @State var localRecordSnapshotSummary: [String] = []
    @State var localRecordEnvelopeId: String?
    @State var localRecordEnvelopeSourceSignature: String?
    @State var reviewKnowledgeEvidenceLesson = ""
    @State var reviewKnowledgeProcessLesson = ""
    @State var reviewKnowledgeUnresolvedQuestion = ""
    @State var reviewKnowledgeUncertaintyNote = ""
    @State var reviewKnowledgeEntries: [AssistReviewKnowledgeViewEntry] = []
    @State var reviewKnowledgeLoadState = AssistReviewKnowledgeLoadState.missing
    @State var reviewKnowledgeMessage: String?
    @State var selectedReviewKnowledgeId: String?
    @State var reviewKnowledgeLineageMode = ReviewKnowledgeLineageMode.newEntry
    @State var reviewKnowledgeClearConfirmationId: String?
    @State var reviewKnowledgeInvalidCollectionConfirmationSymbol: String?
    @State var envelope = ResearchProfileEnvelope.loading
    @State var decisionContext: DecisionContextEnvelope?
    @State var decisionContextMessage: String?
    @State var decisionReviewHistory: DecisionReviewHistoryEnvelope?
    @State var decisionReviewMessage: String?
    @State var comparedDecisionReviewMembershipId: String?
    @State var comparedDecisionReviewHistory: DecisionReviewHistoryEnvelope?
    @State var comparedDecisionReviewRequestId = UUID()
    @State var isLoadingComparedDecisionReviewHistory = false
    @State var comparedDecisionReviewMessage = "请选择另一只研究股票读取决定与复盘历史。"
    @State var pinganSnapshot: PinganSnapshotEnvelope?
    @State var pinganSnapshotMessage: String?
    @State var malformedInputMessage: String?
    @State var decisionInFlight: String?
    @State var submissionState = DecisionCheckSubmissionState()
    @State var lastDecisionMessage: String?
    @State var actionIntent = DecisionActionIntent.watch
    @State var humanCheckResult = HumanCheckResult.needsMoreEvidence
    @State var userFinalDecision = "继续观察，不自动生成交易。"
    @State var sessionDraftCorrection = ""
    @State var sessionDraftAdoption = SessionDraftFormalDecisionAdoptionState()
    @State var sessionDraftMessage: String?
    @FocusState var isSessionDraftCorrectionFocused: Bool
    @State var submittedDecision: DecisionCheckData?
    @State var submittedDecisionSymbol: String?
    @State var pendingFormalRiskConfirmation: DecisionCheckSubmissionFingerprint?
    @State var reviewOutcome = DecisionReviewOutcome.insufficientEvidence
    @State var reviewEvidence = "复盘证据仍不足，保持观察。"
    @State var reviewNote = "仅记录复盘，不生成交易。"
    @State var reviewJudgmentCorrection = ""
    @State var reviewProcessLesson = ""
    @State var reviewNextResearchQuestion = ""
    @State var selectedDecisionReviewCheckBinding: GateBDecisionReviewCheckBinding?
    @State var reviewInFlightCheckId: String?
    @State var reviewSubmissionState = DecisionReviewSubmissionState()
    @State var pendingDecisionReviewDeletionId: String?
    @State var decisionReviewDeletionInFlightId: String?
    @State var decisionReviewDeletionReservation = ResearchDocumentIdempotencyReservation()
    @State var priorJudgmentSource: PriorJudgmentSourceSelection?
    @State var priorJudgmentExcerpt = ""
    @State var priorJudgmentConfirmedNonSensitive = false
    @State var priorJudgmentValidUntil = Date().addingTimeInterval(90 * 24 * 60 * 60)
    @State var priorJudgmentPendingRequest: CreateResearchMaterialRequest?
    @State var priorJudgmentPendingAuthorizationRevision: UUID?
    @State var priorJudgmentSaving = false
    @State var priorJudgmentSaveRevision = UUID()
    @State var priorJudgmentMessage: String?
    @State var priorJudgmentMessageSymbol: String?
    @State var requestedTodayReviewAuthorizationRevision: UUID?
    @State var activeTodayDailyTrackingTarget: TodayReviewNavigationTarget?
    @State var activeTodayReviewReturnTarget: TodayReviewNavigationTarget?
    @State var lastReviewMessage: String?
    @State var submittedReview: PostDecisionReviewData?
    @State var portfolioContext: PortfolioDecisionContextEnvelope?
    @State var portfolioContextMessage = "正在读取当前组合..."
    @State var portfolioContextLoadingSymbol: String?
    @State var portfolioRiskImpact: PortfolioRiskImpactEnvelope?
    @State var portfolioRiskMessage: String?
    @State var portfolioAmountInput = ""
    @FocusState var isPortfolioAmountFocused: Bool
    @FocusState var focusedReviewLearningInput: ReviewLearningInputField?
    @State var portfolioContextRequestId = UUID()
    @State var portfolioRiskRequestId = UUID()
    @State var isLoadingPortfolioContext = false
    @State var isLoadingPortfolioRisk = false
    @State var portfolioLabEnvelope = AnnualPortfolioLabEnvelope.unavailable("请选择当前研究自选并输入用户情景金额。")
    @State var portfolioLabAmountsInput = ""
    @State var portfolioLabMessage: String?
    @State var portfolioLabRequestId = UUID()
    @State var isLoadingPortfolioLab = false
    @State var portfolioLabKnownContextStatus: PortfolioDecisionContextStatus?
    @State var comparedPortfolioLabMembershipId: String?
    @State var comparedPortfolioLabEnvelope: AnnualPortfolioLabEnvelope?
    @State var comparedPortfolioLabRequestId = UUID()
    @State var isLoadingComparedPortfolioLab = false
    @State var comparedPortfolioLabMessage = "请选择另一只已跟踪股票读取同金额组合风险。"
    @State var portfolioReportExplanation: PortfolioReportExplanationEnvelope?
    @State var portfolioReportExplanationMessage = "输入用户情景金额后，可明确读取当前报告的组合影响。"
    @State var portfolioReportExplanationRequestId = UUID()
    @State var isLoadingPortfolioReportExplanation = false
    @State var hasExplicitPortfolioReportExplanationAmount = false
    @FocusState var isPortfolioLabInputFocused: Bool
    @State var conditionalDecisionPreview = AnnualConditionalDecisionPreviewEnvelope.unavailable("请先完成简报、估值量化和组合实验室。")
    @State var conditionalDecisionMessage: String?
    @State var conditionalDecisionRequestId = UUID()
    @State var isLoadingConditionalDecisionPreview = false
    @State var conditionalDecisionDraftSource: AnnualConditionalDecisionDraftSource?
    @State var conditionalSelectedScenarioIndex = 0
    @State var conditionalConfidence = AnnualConditionalDecisionConfidence.medium
    @State var conditionalAssumptions = ""
    @State var conditionalInvalidationConditions = ""
    @State var conditionalPortfolioMetric = AnnualConditionalPortfolioMetric.scenarioCandidateWeight
    @State var conditionalPortfolioComparison = AnnualConditionalPortfolioComparison.atOrAbove
    @State var conditionalPortfolioThresholdPercent = ""
    @State var conditionalPortfolioRationale = ""
    @FocusState var isConditionalInputFocused: Bool
    @FocusState var isTwoLayerReportFieldFocused: Bool
    @State var conditionalObservationStart = Date()
    @State var conditionalObservationEnd = Calendar.current.date(byAdding: .day, value: 90, to: Date()) ?? Date()
    @State var conditionalReviewDate = Calendar.current.date(byAdding: .day, value: 30, to: Date()) ?? Date()
    @State var conditionalWorkflowState = AnnualConditionalWorkflowState.continueResearch
    var isLoadingMemberships: Bool { requestState.isLoadingMemberships }
    var isLoadingDecisionIntake: Bool { requestState.isLoadingDecisionIntake }
    var isLoadingDecisionBrief: Bool { requestState.isLoadingDecisionBrief }
    var isLoadingValuationQuant: Bool { requestState.isLoadingValuationQuant }
    var isWritingAnnualDecisionBriefResearch: Bool {
        annualDecisionBriefProfileSubmissionState.isInFlight || annualDecisionBriefEvidenceSubmissionState.isInFlight
    }
    var isLoadingAdvisoryScope: Bool { requestState.isLoadingAdvisoryScope }
    var isLoadingHumanReviewWorkspace: Bool { requestState.isLoadingHumanReviewWorkspace }
    var isLoadingReviewFollowUpWorkflow: Bool { requestState.isLoadingReviewFollowUpWorkflow }
    var isLoadingDecisionNoteWorkflow: Bool { requestState.isLoadingDecisionNoteWorkflow }
    var isLoadingDecisionReviewHistory: Bool { requestState.isLoadingDecisionReviewHistory }
    var isLoading: Bool { requestState.isLoadingJourney }
    var isWritingMembership: Bool { membershipSubmissionState.isInFlight }
    var body: some View {
#if OWNER_CLIENT
        researchContent
            .onAppear { configureClientDestination() }
            .onChange(of: clientDestination) { _, _ in configureClientDestination() }
#else
        NavigationStack { researchContent }
#endif
    }

    private var researchContent: some View {
        GeometryReader { viewport in
            let layout = DailyWorkbenchLayoutMetrics(
                availableWidth: viewport.size.width,
                availableHeight: viewport.size.height,
                accessibilityText: dynamicTypeSize.isAccessibilitySize
            )
            ScrollViewReader { scrollProxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: layout.sectionSpacing) {
                        #if OWNER_CLIENT
                        if [.report, .workflow, .stock, .templateHome].contains(clientDestination) {
                            researchInvestmentBrief(layout: layout)
                        }
                        clientFocusedResearchContent(layout: layout)
#else
                        if AppEnvironment.isExperienceSession {
                            makeV9ResearchContent
                        } else {
                            researchFigmaHeader
                            researchFigmaIdentityCard
                            dailyDecisionNextStepCard(layout: layout)
                            dailyDecisionRingsHero(layout: layout)
                            researchFigmaCurrentLayerCard
                            legacyResearchWorkspaceDisclosure(layout: layout)
                        }
#endif
                    }
                    .padding(.horizontal, layout.horizontalPadding)
                    .padding(.top, layout.verticalPadding)
                    .padding(.bottom, layout.verticalPadding + layout.bottomContentInset)
#if OWNER_CLIENT
                    .controlSize(.regular)
#else
                    .controlSize(.large)
#endif
                }
                .background { dailyWorkbenchBackdrop() }
#if OWNER_CLIENT
                .safeAreaPadding(.bottom, 8)
#else
                .safeAreaPadding(.bottom, 72)
#endif
                .safeAreaInset(edge: .bottom, spacing: 0) {
#if OWNER_CLIENT
                    Color.clear.frame(height: 8)
#else
                    Color.clear.frame(height: 72)
#endif
                }
                .scrollDismissesKeyboard(.interactively)
                .accessibilityIdentifier("researchScrollView")
                .onChange(of: parsedSymbol?.canonical) { oldSymbol, newSymbol in
                    guard oldSymbol != newSymbol else { return }
                    isHistoricalReportsExpanded = false
                    Task { @MainActor in
                        await Task.yield()
                        scrollProxy.scrollTo("researchInvestmentBriefTop", anchor: .top)
                    }
                }
                .onChange(of: pendingDecisionWorkspaceScrollTarget) { _, target in
                    guard target != nil else { return }
                    consumePendingDecisionWorkspaceScrollTarget(using: scrollProxy)
                }
                .onChange(of: renderedDecisionReviewTimelineIdentity) { _, _ in
                    consumePendingDecisionWorkspaceScrollTarget(using: scrollProxy)
                }
                .onChange(of: selectedTab) { _, tab in
                    guard tab == .research else {
                        (pendingDecisionWorkspaceScrollTarget, requestedTodayReviewAuthorizationRevision, activeTodayReviewReturnTarget) = (nil, nil, nil)
                        return
                    }
                    guard pendingDecisionWorkspaceScrollTarget?.hasPrefix("decision-review-") != true else { return }
                    consumePendingDecisionWorkspaceScrollTarget(using: scrollProxy)
                }
                .onChange(of: researchNavigationRevision) { _, _ in
                    pendingDecisionWorkspaceScrollTarget = nil
                    requestedTodayReviewAuthorizationRevision = nil
                    activeTodayReviewReturnTarget = nil
                }
            }
        }
#if !OWNER_CLIENT
        .toolbar(.hidden, for: .navigationBar)
#endif
        .sheet(item: Binding(
            get: { researchDocumentWorkspace.pdfPresentation },
            set: { researchDocumentWorkspace.pdfPresentation = $0 }
        )) { presentation in
            NavigationStack {
                ResearchDocumentPDFView(data: presentation.data, pageNumber: presentation.pageNumber)
                    .navigationTitle("\(presentation.title) · 第 \(presentation.pageNumber) 页")
                    .navigationBarTitleDisplayMode(.inline)
            }
        }
        .sheet(item: $researchStoredTextPresentation) { presentation in
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("引用段落").font(OwnerReadingFont.headline)
                        Text(presentation.excerpt).textSelection(.enabled)
                        Divider()
                        Text("已保存原文").font(OwnerReadingFont.headline)
                        Text(presentation.snapshot.normalizedText ?? "原文不可用")
                            .textSelection(.enabled)
                        DisclosureGroup("原件身份") {
                            Text("raw \(presentation.snapshot.rawSha256)\ntext \(presentation.snapshot.textSha256)")
                                .font(OwnerReadingFont.caption.monospaced()).textSelection(.enabled)
                        }
                    }.padding()
                }
                .navigationTitle("已保存官方网页")
                .toolbar { ToolbarItem(placement: .topBarTrailing) {
                    Button("返回") { researchStoredTextPresentation = nil }
                } }
            }
        }
        .sheet(item: $researchReportPeerOriginalPresentation) { original in
            NavigationStack {
                VStack(alignment: .leading, spacing: 12) {
                    Text(original.verification).font(OwnerReadingFont.caption)
                        .foregroundStyle(.secondary)
                    ResearchSavedOriginalTextView(text: original.body,
                        highlightRange: original.highlightRange)
                }
                .padding()
                .navigationTitle(original.title)
                .navigationBarTitleDisplayMode(.inline)
            }
        }
        .fullScreenCover(item: $makeV9WorkspacePresentation) { workspace in
            FigmaResearchWorkspaceDirectoryView(
                    symbol: parsedSymbol?.canonical ?? "未选择",
                    companyName: selectedMembership?.research.name ?? "名称待补齐",
                    currentLayer: selectedDecisionLayer.title,
                    currentWorkspace: currentResearchWorkspace,
                    initialWorkspace: workspace,
                    nextStep: dailyDecisionNextStep.title,
                onSelectTab: { tab in
                    makeV9WorkspacePresentation = nil
                    selectedTab = tab
                },
                onSelectWorkspace: { workspace in
                    makeV9WorkspacePresentation = nil
                    selectResearchWorkspace(workspace)
                },
                workspaceStatus: figmaWorkspaceStatus
            )
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if selectedDecisionLayer == .evidence,
                   selectedEvidenceWorkspace == .research {
                    annualDecisionBriefResearchToolbarButton()
                }
            }
        }
        .task(id: "\(parsedSymbol?.canonical ?? symbolInput):\(todayRefreshRevision)") {
            let briefMembership = pendingDecisionBriefMembershipAfterSymbolChange
            pendingDecisionBriefMembershipAfterSymbolChange = nil
            let restoredNavigation = !hasConsumedInitialResume && initialResumeResult.snapshot != nil
            hasConsumedInitialResume = true
            guard requestedTodayReviewTarget == nil,
                      requestedTodayFormalDecisionTarget == nil,
                      requestedTodayResearchTarget == nil,
                      requestedTodayCandidateTarget == nil,
                      requestedTodayReportRevision == nil else { return }
            await refreshDailyClient(
                restoredNavigation: restoredNavigation,
                preferredMembership: briefMembership
            )
#if OWNER_CLIENT
            configureClientDestination()
#endif
        }
        .task(id: portfolioResearchLoadIdentity) {
            await loadPortfolioResearchWorkspaces()
        }
        .task(id: pendingNoticeLead) {
            guard let pendingNoticeLead else { return }
            guard parsedSymbol?.canonical == pendingNoticeLead.item.symbol else {
                self.pendingNoticeLead = nil
                return
            }
            selectedDecisionLayer = .evidence
            selectedEvidenceWorkspace = .frozen
        }
        .task(id: requestedTodayResearchTarget) { await openRequestedTodayResearchTarget() }.task(id: requestedTodayCandidateTarget) { await openRequestedTodayCandidateTarget() }
        .task(id: requestedTodayReviewTarget) {
            guard let target = requestedTodayReviewTarget else { return }
            (activeTodayDailyTrackingTarget, activeTodayReviewReturnTarget) = (nil, nil)
            guard selectedDecisionLayer == .review,
                  parsedSymbol?.canonical == target.canonicalSymbol else {
                clearRequestedTodayReviewTarget(
                    "Today 复盘目标与当前标的不一致；请求已清除。"
                )
                return
            }
            let authorizationRevision = viewModel.authorizationRevision
            requestedTodayReviewAuthorizationRevision = authorizationRevision
            await refreshDailyClient(
                restoredNavigation: false,
                preferredMembership: selectedMembership
            )
            guard requestedTodayReviewTarget == target else { return }
            guard parsedSymbol?.canonical == target.canonicalSymbol,
                  selectedMembership?.id == target.membershipId,
                  selectedMembership?.version == target.membershipVersion,
                  dailyClientAuthorizationIsCurrent(authorizationRevision) else {
                clearRequestedTodayReviewTarget(
                    "Today 复盘目标的 membership、标的或授权已变化；请求已清除。"
                )
                return
            }
            if target.reportBinding != nil {
                await loadTwoLayerReports()
                await loadResearchDocuments()
                guard requestedTodayReviewTarget == target else { return }
                guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                      resolveTodayDailyTrackingTarget(target) else {
                    clearRequestedTodayReviewTarget(
                        "每日跟踪目标已因 membership、正式决定、报告、证据包、技术或材料来源漂移而清除。"
                    )
                    return
                }
                activeTodayDailyTrackingTarget = target
            }
            bindRequestedTodayReviewTargetIfPossible()
        }
        .task(id: requestedTodayFormalDecisionTarget) {
            guard let target = requestedTodayFormalDecisionTarget else { return }
            await openRequestedTodayFormalDecisionTarget(target)
        }
        .onChange(of: marketTechnicalEnvelope) { _, incoming in
            synchronizeMarketTechnicalEnvelope(incoming)
        }
        .onChange(of: researchWeinsteinEnvelope) { _, _ in
            resetResearchWeinsteinZoneCorrection("Weinstein 计算版本已变化；人工区域修正必须重新填写并绑定新结果。")
            synchronizeFrozenResearchBinding("Weinstein 周线证据已变化；旧冻结展示与确认已清除。")
            if currentFrozenResearchBindingIdentity?.isFreezeReady == true {
                Task { await loadFrozenResearchEvidence() }
            }
        }
        .onChange(of: valuationQuantEnvelope) { _, _ in
            synchronizeFrozenResearchBinding(
                "个股量化证据已变化；旧冻结确认已清除。"
            )
            if currentFrozenResearchBindingIdentity?.isFreezeReady == true {
                Task { await loadFrozenResearchEvidence() }
            }
        }
        .onChange(of: portfolioLabEnvelope) { _, _ in
            synchronizeFrozenResearchBinding(
                "组合风险证据已变化；旧冻结确认已清除。"
            )
            if currentFrozenResearchBindingIdentity?.isFreezeReady == true {
                Task { await loadFrozenResearchEvidence() }
            }
        }
        .onChange(of: symbolInput) { oldValue, newValue in
            let newCanonical = SecuritySymbol.parseHongKongAlias(newValue)?.canonical
            guard SecuritySymbol.parseHongKongAlias(oldValue)?.canonical != newCanonical else { return }
            if dailyRefreshGate.currentSource?.canonicalSymbol != newCanonical {
                invalidateDailyClientBoundFacts(reason: "研究标的已变化", continuityMessage: "标的来源已变化；上一标的的候选、研究、组合与复盘事实已清除。")
            }
            invalidateTwoLayerReport("研究标的已变化；旧报告和追问回答已清除。")
            clearRequestedTodayReviewTarget("Today 复盘目标的标的已变化；请求已清除。")
            requestedTodayFormalDecisionTarget = nil
            if requestedTodayResearchTarget?.symbol != newCanonical { requestedTodayResearchTarget = nil }
            pendingTodayReportConfirmationReservation = nil
            clearRequestedTodayCandidateTargetIfNeeded(for: newCanonical)
            invalidateSessionDraftAdoption()
            selectedDecisionLayer = decisionLayerAfterSymbolChange ?? .evidence
            decisionLayerAfterSymbolChange = nil
        }
        .task(id: requestedTodayReportRevision) { if requestedTodayReportRevision != nil { await openRequestedTodayReportRevision() } }
        .onChange(of: localDecisionDraft) { _, _ in
            invalidateSessionDraftAdoption()
        }
        .onChange(of: decisionContext?.contextId) { _, _ in
            invalidateSessionDraftAdoption()
        }
        .onChange(of: sessionDraftCorrection) { _, _ in
            invalidateSessionDraftAdoption()
        }
        .onChange(of: actionIntent) { _, _ in
            submissionState.resetForNewCheck()
        }
        .onChange(of: humanCheckResult) { _, _ in
            submissionState.resetForNewCheck()
            pendingFormalRiskConfirmation = nil
        }
        .onChange(of: portfolioAmountInput) { oldValue, newValue in
            guard oldValue != newValue else { return }
            invalidatePortfolioRiskForAmountChange()
        }
        .onChange(of: portfolioLabAmountsInput) { oldValue, newValue in
            guard oldValue != newValue else { return }
            clearAnnualPortfolioLab(message: "用户情景金额已变化；旧组合实验室结果已清除。", membershipId: selectedMembership?.id)
            hasExplicitPortfolioReportExplanationAmount = parsedPortfolioLabAmounts != nil
        }
        .onChange(of: conditionalSelectedScenarioIndex) { oldValue, newValue in
            guard oldValue != newValue else { return }
            clearAnnualConditionalDecisionPreview("选中组合情景已变化；旧冻结预览已清除。")
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                if !viewModel.isAskingResearchEvidenceQuestion {
                    try? persistCurrentResearchTemporaryConversation()
                }
                return
            }
            guard phase == .active, viewModel.refreshRuntimeAuthorizationIfNeeded() else { return }
            invalidateDailyClientForAuthorizationChange()
            Task {
                await refreshDailyClient(restoredNavigation: false, preferredMembership: nil)
            }
        }
        .onChange(of: viewModel.authorizationRevision) { _, revision in
            cloudAiPolicy = nil; cloudAiNoBackupConfirmed = false
            cloudAiPolicyReservation.clear()
            cloudAiPolicyMessage = "读取授权已变化；Cloud AI 策略需重新读取。"
            clearResearchEvidenceQuestion("读取授权已变化；复盘问句草稿和旧回答已清除。")
            researchContextWorkspace.clear(
                "读取授权已变化；旧行业与同业上下文已清除。"
            )
            if requestedTodayFormalDecisionTarget != nil {
                requestedTodayFormalDecisionTarget = nil
                researchReportFormalDecisionBinding = nil
                researchReportFormalDecisionMessage =
                    "Today 正式决定目标的授权已变化；请求已清除，没有自动采用。"
            }
            pendingTodayReportConfirmationReservation = nil
            guard activeTodayReviewReturnTarget != nil || activeTodayDailyTrackingTarget != nil
                    || requestedTodayReviewAuthorizationRevision != nil && requestedTodayReviewAuthorizationRevision != revision else { return }
            clearRequestedTodayReviewTarget(
                "Today 复盘目标的授权已变化；请求已清除。"
            )
        }
    }

    @ViewBuilder
    private func legacyResearchWorkspaceDisclosure(layout: DailyWorkbenchLayoutMetrics) -> some View {
        DisclosureGroup("全部研究工作区 · \(ResearchWorkspace.allCases.count)") {
            VStack(alignment: .leading, spacing: layout.sectionSpacing) {
                researchWorkspaceChooser()
                researchInvestmentBrief(layout: layout)
                researchFocusedWorkspace(layout: layout)
                    .id("dailyWorkbenchTop")
                DisclosureGroup("依据与记录", isExpanded: $isResearchEvidenceRecordsExpanded) {
                    VStack(alignment: .leading, spacing: layout.sectionSpacing) {
                        Text("以下是诊断、原始状态与历史记录；主要判断与工作区在上方。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        personalResearchChecklistCard(layout: layout)
                        personalHistoricalCasesAndIndustryTemplateCard(layout: layout)
                        personalLocalMemoryControlsCard(layout: layout)
                        dailyDecisionLayerMenu()
                        dailyDecisionLayerHeader()
                        DisclosureGroup("研究进度") {
                            VStack(alignment: .leading, spacing: layout.sectionSpacing) {
                                dailyClientContinuityBar(layout: layout)
                            }
                            .padding(.top, 8)
                        }
                    }
                    .padding(.top, 8)
                }
                .accessibilityIdentifier("researchEvidenceRecords")
            }
            .padding(.top, 8)
        }
        .cardStyle(padding: 14)
    }

    private var makeV9CurrentProfile: ResearchProfileData? {
        decisionContext?.research.profile ?? envelope.data?.profile
    }

    private var makeV9EvidenceStatus: String {
        switch decisionContext?.research.status {
        case "available": "已读取"
        case "evidence_insufficient": "证据不足"
        case "unavailable": "暂不可用"
        case .some(let status): makeV9DisplayText(status)
        case nil: makeV9DisplayText(envelope.message)
        }
    }

    private var makeV9ReviewStatus: String {
        submittedReview == nil ? "尚未进入复盘" : "正式复盘已完成"
    }

    private var makeV9ResearchName: String {
        makeV9CurrentProfile?.name
            ?? selectedMembership?.research.name
            ?? parsedSymbol?.canonical
            ?? "当前研究标的"
    }

    private var makeV9ResearchSymbol: String {
        parsedSymbol?.canonical ?? makeV9CurrentProfile?.symbol ?? "未选择港股"
    }

    private var makeV9ResearchContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            if makeV9ResearchView == .list {
                makeV9ResearchList
            } else {
                makeV9ResearchDetail
            }
        }
    }

    private var makeV9ResearchList: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("研究")
                        .font(.system(size: 26, weight: .bold, design: .serif))
                        .foregroundStyle(OwnerExperienceStyle.textPrimary)
                    Text("判断 · 证据 · 复盘")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(OwnerExperienceStyle.textTertiary)
                }
                Spacer(minLength: 8)
                MakeV9ThemeToggleButton()
            }
            .padding(.horizontal, 16)
            .padding(.top, 52)
            .padding(.bottom, 12)

            MakeV9SectionLabel("跟踪中")
            Button { makeV9ResearchView = .detail } label: {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 12) {
                        MakeV9AnnulusRing(filled: selectedDecisionLayer == .review ? 5 : 3)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(makeV9ResearchSymbol)
                                .font(.system(size: 11.5, design: .monospaced))
                                .foregroundStyle(OwnerExperienceStyle.gold)
                            Text(makeV9ResearchName)
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(OwnerExperienceStyle.textPrimary)
                        }
                        Spacer(minLength: 6)
                        if let quote = decisionContext?.quote.data {
                            VStack(alignment: .trailing, spacing: 2) {
                                Text("\(quote.price, specifier: "%.2f")")
                                    .font(.system(size: 16, design: .monospaced))
                                    .foregroundStyle(OwnerExperienceStyle.textPrimary)
                                Text(quote.changePercent.map { String(format: "%+.2f%%", $0) } ?? "涨跌未提供")
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle((quote.change ?? 0) >= 0 ? OwnerExperienceStyle.success : OwnerExperienceStyle.danger)
                            }
                        }
                    }
                    HStack(spacing: 6) {
                        OwnerStatusPill(text: makeV9CurrentProfile?.currentView ?? selectedDecisionLayer.title, tint: OwnerExperienceStyle.accent)
                        if makeV9CurrentProfile?.evidenceGaps?.isEmpty == false {
                            MakeV9SourceBadge(label: "待补齐", tint: OwnerExperienceStyle.warning)
                        }
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 12))
                            .foregroundStyle(OwnerExperienceStyle.warning)
                        Text(makeV9EvidenceStatus)
                            .font(.system(size: 11))
                            .foregroundStyle(OwnerExperienceStyle.warning)
                    }
                    Text(makeV9CurrentProfile?.nextReviewOn.map { "下次复核：\($0)" } ?? makeV9ReviewStatus)
                        .font(.system(size: 12.5))
                        .foregroundStyle(OwnerExperienceStyle.textSecondary)
                    Text("下一步：\(makeV9CurrentProfile?.evidenceGaps?.first ?? dailyDecisionNextStep.title)")
                        .font(.system(size: 12))
                        .foregroundStyle(OwnerExperienceStyle.accent)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(OwnerExperienceStyle.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(OwnerExperienceStyle.cardBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(OwnerExperienceStyle.gold.opacity(0.35), lineWidth: 1.5) }
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 16)

            MakeV9SectionLabel("候选")
            VStack(spacing: 8) {
                ForEach(candidateMemberships.memberships.filter { $0.symbol != parsedSymbol?.canonical }.prefix(3)) { membership in
                    Button {
                        symbolInput = membership.symbol
                        makeV9ResearchView = .detail
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            MakeV9AnnulusRing(filled: 1)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(membership.symbol)
                                    .font(.system(size: 11.5, design: .monospaced))
                                    .foregroundStyle(OwnerExperienceStyle.gold)
                                Text(membership.research.name ?? membership.symbol)
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(OwnerExperienceStyle.textPrimary)
                                Text(membership.state == .tracked ? "已跟踪" : "候选 · 待研究")
                                    .font(.system(size: 12))
                                    .foregroundStyle(OwnerExperienceStyle.textSecondary)
                            }
                            Spacer(minLength: 4)
                            Image(systemName: "chevron.right")
                                .foregroundStyle(OwnerExperienceStyle.textTertiary)
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(OwnerExperienceStyle.cardBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(OwnerExperienceStyle.border, lineWidth: 1) }
                    }
                    .buttonStyle(.plain)
                }
                if candidateMemberships.memberships.filter({ $0.symbol != parsedSymbol?.canonical }).isEmpty {
                    Text("当前没有可验证的候选研究成员。")
                        .font(.system(size: 13))
                        .foregroundStyle(OwnerExperienceStyle.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                        .background(OwnerExperienceStyle.cardBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
    }

    private var makeV9ResearchDetail: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Button {
                    makeV9ResearchView = .list
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                        Text("研究")
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(OwnerExperienceStyle.textSecondary)
                }
                .buttonStyle(.plain)
                Spacer()
                HStack(spacing: 8) {
                    MakeV9ThemeToggleButton()
                    Button { globalToolSheet = .assistant } label: {
                        Label("AI助手", systemImage: "message")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(OwnerExperienceStyle.accent)
                            .padding(.horizontal, 10)
                            .frame(height: 34)
                            .background(OwnerExperienceStyle.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay { RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(OwnerExperienceStyle.accent.opacity(0.25), lineWidth: 1) }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 50)
            .padding(.bottom, 10)

            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(makeV9ResearchSymbol)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(OwnerExperienceStyle.gold)
                    Text(makeV9ResearchName)
                        .font(.system(size: 22, weight: .bold, design: .serif))
                        .foregroundStyle(OwnerExperienceStyle.textPrimary)
                }
                Spacer(minLength: 8)
                if let quote = decisionContext?.quote.data {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("HK$\(quote.price, specifier: "%.2f")")
                            .font(.system(size: 22, design: .monospaced))
                            .foregroundStyle(OwnerExperienceStyle.gold)
                        Text(quote.changePercent.map { String(format: "%+.2f%%", $0) } ?? "涨跌未提供")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle((quote.change ?? 0) >= 0 ? OwnerExperienceStyle.success : OwnerExperienceStyle.danger)
                        makeV9DecisionQuoteSourceBadge
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)

            HStack(spacing: 4) {
                makeV9ResearchTab(.judgment, "判断")
                makeV9ResearchTab(.technical, "技术")
                makeV9ResearchTab(.financials, "财务")
            }
            .padding(3)
            .background(OwnerExperienceStyle.softBackground, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .padding(.horizontal, 16)

            switch makeV9ResearchDetailTab {
            case .judgment: makeV9JudgmentDetail
            case .technical: makeV9TechnicalDetail
            case .financials: makeV9FinancialDetail
            }
        }
        .padding(.bottom, 16)
    }

    @ViewBuilder
    private var makeV9DecisionQuoteSourceBadge: some View {
        if let quote = decisionContext?.quote {
            let status: String = switch quote.status {
            case "fresh": "当前"
            case "stale": "陈旧"
            case "permission_denied": "未授权"
            case "empty": "暂无"
            default: "不可用"
            }
            let tint: Color = switch quote.status {
            case "fresh": OwnerExperienceStyle.success
            case "stale": OwnerExperienceStyle.warning
            default: OwnerExperienceStyle.danger
            }
            MakeV9SourceBadge(label: "\(assetsQuoteSourceLabel(quote.source)) · \(status)", tint: tint)
        }
    }

    private func makeV9ResearchTab(_ tab: MakeV9ResearchDetailTab, _ title: String) -> some View {
        Button { makeV9ResearchDetailTab = tab } label: {
            Text(title)
                .font(.system(size: 13, weight: makeV9ResearchDetailTab == tab ? .semibold : .regular))
                .foregroundStyle(makeV9ResearchDetailTab == tab ? OwnerExperienceStyle.textPrimary : OwnerExperienceStyle.textTertiary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
                .background(makeV9ResearchDetailTab == tab ? OwnerExperienceStyle.cardBackground : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var makeV9JudgmentDetail: some View {
        VStack(alignment: .leading, spacing: 10) {
            makeV9DetailAlert
            MakeV9SectionLabel("当前判断")
            makeV9DetailCard(title: makeV9CurrentProfile?.currentView ?? "研究判断尚未返回", body: makeV9CurrentProfile?.currentThesis ?? envelope.message, tone: .info)
            MakeV9SectionLabel("核心驱动")
            ForEach(Array((makeV9CurrentProfile?.keyVariables ?? makeV9CurrentProfile?.catalysts ?? []).prefix(3)), id: \.self) { variable in
                makeV9DetailRow(variable, status: "来源状态沿用 API")
            }
            MakeV9SectionLabel("主要风险")
            makeV9DetailCard(title: "失效条件", body: makeV9CurrentProfile?.invalidationCondition ?? "当前报告未提供失效条件。", tone: .warning)
            MakeV9SectionLabel("当前最优先")
            makeV9DetailCard(title: dailyDecisionNextStep.title, body: dailyDecisionNextStep.detail, tone: .info)
            makeV9BackendCapabilityRail
        }
    }

    private var makeV9BackendCapabilityRail: some View {
        VStack(alignment: .leading, spacing: 10) {
            MakeV9SectionLabel("研究能力")
            Text("材料、分析、报告和复盘沿用同一条研究路径。每张卡片都显示当前后端状态，再进入对应操作。")
                .font(.system(size: 12.5))
                .foregroundStyle(OwnerExperienceStyle.textSecondary)
                .lineSpacing(2)
                .padding(.horizontal, 16)
            makeV9AICapabilityCard
            ForEach(ResearchWorkspace.allCases) { workspace in
                makeV9BackendCapabilityCard(workspace)
            }
        }
    }

    private var makeV9AICapabilityCard: some View {
        let enabled = cloudAiPolicy?.isEnabled == true
        let status = cloudAiPolicy == nil ? "待读取" : enabled ? "已启用" : "未启用"
        let tint = enabled ? OwnerExperienceStyle.success : OwnerExperienceStyle.warning
        return Button { globalToolSheet = .assistant } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 24, height: 24)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text("AI 研究助手")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(OwnerExperienceStyle.textPrimary)
                        MakeV9SourceBadge(label: status, tint: tint)
                    }
                    Text(makeV9AIPolicyMessage)
                        .font(.system(size: 12))
                        .foregroundStyle(OwnerExperienceStyle.textSecondary)
                        .lineLimit(2)
                    if let policy = cloudAiPolicy {
                        Text("DeepSeek · \(policy.policy.model) · 仅发送边界内研究事实")
                            .font(.system(size: 11.5, design: .monospaced))
                            .foregroundStyle(tint)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OwnerExperienceStyle.textTertiary)
                    .padding(.top, 3)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(OwnerExperienceStyle.cardBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(tint.opacity(0.28), lineWidth: 1) }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .accessibilityIdentifier("makeV9Capability-ai")
    }

    private var makeV9AIPolicyMessage: String {
        guard let policy = cloudAiPolicy else { return "正在读取当前 Owner 授权；未确认前不会向提供方发送问题。" }
        return policy.isEnabled
            ? "当前 Owner 已确认 DeepSeek AI 策略，可以进行边界内的研究追问。"
            : "当前 Owner 尚未启用 DeepSeek AI；未向提供方发送问题。"
    }

    private func makeV9BackendCapabilityCard(_ workspace: ResearchWorkspace) -> some View {
        let status = figmaWorkspaceStatus(workspace)
        return Button {
            makeV9WorkspacePresentation = workspace
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: workspace.systemImage)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(workspace.tint)
                    .frame(width: 24, height: 24)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(workspace.title)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(OwnerExperienceStyle.textPrimary)
                        OwnerStatusPill(text: status.badge, tint: status.rows.first?.tone.color ?? OwnerExperienceStyle.accent)
                    }
                    Text(makeV9DisplayText(status.summary))
                        .font(.system(size: 12))
                        .foregroundStyle(OwnerExperienceStyle.textSecondary)
                        .lineLimit(2)
                    if let firstRow = status.rows.first {
                        Text("\(firstRow.label)：\(firstRow.value)")
                            .font(.system(size: 11.5, design: .monospaced))
                            .foregroundStyle(firstRow.tone.color)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OwnerExperienceStyle.textTertiary)
                    .padding(.top, 3)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(OwnerExperienceStyle.cardBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(OwnerExperienceStyle.border, lineWidth: 1) }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .accessibilityIdentifier("makeV9Capability-\(workspace.rawValue)")
    }

    private func makeV9DisplayText(_ text: String) -> String {
        text
            .replacingOccurrences(of: "unknown", with: "未提供", options: .caseInsensitive)
            .replacingOccurrences(of: "n/a", with: "暂未提供", options: .caseInsensitive)
    }

    private var makeV9DetailAlert: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(OwnerExperienceStyle.warning)
            VStack(alignment: .leading, spacing: 3) {
                Text("证据状态")
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(OwnerExperienceStyle.warning)
                Text(makeV9EvidenceStatus)
                    .font(.system(size: 12))
                    .foregroundStyle(OwnerExperienceStyle.warning.opacity(0.85))
            }
        }
        .padding(12)
        .background(OwnerExperienceStyle.warning.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(OwnerExperienceStyle.warning.opacity(0.25), lineWidth: 1) }
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    private var makeV9TechnicalDetail: some View {
        VStack(alignment: .leading, spacing: 10) {
            MakeV9SectionLabel("技术")
            makeV9DetailCard(title: "Weinstein", body: currentMarketWeinsteinEnvelope.map { "\($0.stockStage) · \($0.status) · 截止 \($0.analysisAsOf)" } ?? "当前技术证据未返回。", tone: .info)
            makeV9DetailCard(title: "日线证据", body: currentMarketTechnicalEnvelope.map { "\($0.dailyBars.snapshot?.barCount ?? 0) 个已绑定观测点" } ?? "当前日线证据未返回。", tone: .info)
            makeV9DetailCard(title: "边界", body: "技术观察不自动改变正式研究判断。", tone: .warning)
        }
    }

    private var makeV9FinancialDetail: some View {
        VStack(alignment: .leading, spacing: 10) {
            MakeV9SectionLabel("财务")
            makeV9DetailCard(title: "证据数量", body: "\(decisionContext?.research.evidence.count ?? 0) 条当前绑定证据", tone: .info)
            makeV9DetailCard(title: "财务缺口", body: makeV9CurrentProfile?.evidenceGaps?.joined(separator: "；") ?? "当前研究资料未提供缺口明细。", tone: .warning)
            makeV9DetailCard(title: "数据边界", body: "财务事实沿用现有研究 API，不把设计样例写入正式判断。", tone: .info)
        }
    }

    private func makeV9DetailCard(title: String, body: String, tone: FigmaWorkspaceTone) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tone.color)
            Text(body)
                .font(.system(size: 13))
                .foregroundStyle(OwnerExperienceStyle.textPrimary)
                .lineSpacing(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(OwnerExperienceStyle.cardBackground, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(OwnerExperienceStyle.border, lineWidth: 1) }
        .padding(.horizontal, 16)
    }

    private func makeV9DetailRow(_ title: String, status: String) -> some View {
        HStack(spacing: 8) {
            Text("•")
                .foregroundStyle(OwnerExperienceStyle.gold)
            Text(title)
                .font(.system(size: 12.5))
                .foregroundStyle(OwnerExperienceStyle.textPrimary)
            Spacer(minLength: 4)
            Text(status)
                .font(.system(size: 10))
                .foregroundStyle(OwnerExperienceStyle.textTertiary)
        }
        .padding(.horizontal, 16)
    }

    private func figmaWorkspaceStatus(_ workspace: ResearchWorkspace) -> FigmaWorkspaceStatus {
        switch workspace {
        case .materials:
            let documents = researchDocumentWorkspace.list?.documents.count ?? 0
            let facts = researchDocumentWorkspace.list?.materials.count ?? 0
            return FigmaWorkspaceStatus(
                badge: documents > 0 ? "已读取" : "待读取",
                title: "材料与证据",
                summary: makeV9DisplayText(researchDocumentWorkspace.message),
                rows: [
                    .init(label: "PDF 原文", value: documents > 0 ? "\(documents) 份" : "待读取", tone: documents > 0 ? .info : .warning),
                    .init(label: "证据身份", value: facts > 0 ? "\(facts) 条材料" : "待确认", tone: facts > 0 ? .success : .warning),
                    .init(label: "当前动作", value: "导入 → 确认 → 冻结", tone: .info)
                ]
            )
        case .fundamentals:
            let values = researchFundamentalWorkspace.envelope?.values.count ?? 0
            return FigmaWorkspaceStatus(
                badge: values > 0 ? "\(values) 项" : "待读取",
                title: "基本面与完整性",
                summary: makeV9DisplayText(researchFundamentalWorkspace.message),
                rows: [
                    .init(label: "报告事实", value: values > 0 ? "\(values) 项已读取" : "待读取", tone: values > 0 ? .success : .warning),
                    .init(label: "行业背景", value: researchContextWorkspace.envelope == nil ? "待补齐" : "已读取", tone: researchContextWorkspace.envelope == nil ? .warning : .success),
                    .init(label: "覆盖完整性", value: "需人工核对", tone: .warning)
                ]
            )
        case .valuation:
            let scenarios = researchValuationScenarioWorkspace.envelope?.scenarioSets.count ?? 0
            return FigmaWorkspaceStatus(
                badge: scenarios > 0 ? "可复核" : "待输入",
                title: "估值与量化",
                summary: makeV9DisplayText(researchValuationScenarioWorkspace.message),
                rows: [
                    .init(label: "估值方法", value: "Forward multiple · 用户情景", tone: .info),
                    .init(label: "情景组", value: scenarios > 0 ? "\(scenarios) 组" : "待输入", tone: scenarios > 0 ? .success : .warning),
                    .init(label: "正式动作", value: "运行试算 / 保存草稿", tone: .info)
                ]
            )
        case .deepResearch:
            let report = currentDeepResearchReport
            return FigmaWorkspaceStatus(
                badge: report == nil ? "待读取" : "可吸收",
                title: "Deep Research",
                summary: report == nil ? "尚未读取当前深度研究结果。" : "研究结果已绑定当前证据包，吸收前仍需人工核验。",
                rows: [
                    .init(label: "任务状态", value: report == nil ? "待读取" : "已返回", tone: report == nil ? .warning : .success),
                    .init(label: "证据引用", value: report.map { "报告 v\($0.version)" } ?? "待读取", tone: .info),
                    .init(label: "吸收边界", value: "不会自动写入正式决定", tone: .warning)
                ]
            )
        case .report:
            let report = currentDeepResearchReport
            return FigmaWorkspaceStatus(
                badge: report == nil ? "待补齐" : "待确认",
                title: "报告与追问",
                summary: report == nil ? "当前没有可确认的研究报告。" : "报告可查看、追问和比较；确认前不会写入正式决定。",
                rows: [
                    .init(label: "核心结论", value: report == nil ? "待读取" : "已读取", tone: report == nil ? .warning : .success),
                    .init(label: "引用与证据", value: report.map { "报告 v\($0.version)" } ?? "待读取", tone: .info),
                    .init(label: "确认状态", value: report?.isFormalizable == true ? "可确认" : "待补齐", tone: report?.isFormalizable == true ? .success : .warning)
                ]
            )
        case .decisionReview:
            return FigmaWorkspaceStatus(
                badge: hasCurrentDecision ? "已记录" : "尚未提交",
                title: "决定与复盘",
                summary: "正式决定、跟踪条件和复盘记录必须由 Owner 明确提交。",
                rows: [
                    .init(label: "正式决定", value: hasCurrentDecision ? "已记录" : "待人工判断", tone: hasCurrentDecision ? .success : .warning),
                    .init(label: "支持条件", value: "读取后显示", tone: .info),
                    .init(label: "下一次复核", value: currentSubmittedReview == nil ? "待提交" : "已提交", tone: currentSubmittedReview == nil ? .warning : .success)
                ]
            )
        case .portfolio:
            let context = portfolioContext
            return FigmaWorkspaceStatus(
                badge: context == nil ? "待读取" : "可解释",
                title: "组合解释",
                summary: context == nil ? "当前没有可用的本地组合快照。" : "组合解释只读取本地快照，不写入官方持仓或交易账本。",
                rows: [
                    .init(label: "持仓数量", value: context.map { "\($0.positions.count) 只" } ?? "读取后显示", tone: context == nil ? .warning : .success),
                    .init(label: "组合风险", value: "读取后显示", tone: .info),
                    .init(label: "正式动作", value: "不会提交交易", tone: .warning)
                ]
            )
        }
    }

    @MainActor
    func consumePendingDecisionWorkspaceScrollTarget(using scrollProxy: ScrollViewProxy) {
        guard selectedTab == .research, let target = pendingDecisionWorkspaceScrollTarget else { return }
        if target != "researchInvestmentBriefTop" { isResearchEvidenceRecordsExpanded = true }
        if target.hasPrefix("decision-review-") {
            guard selectedDecisionLayer == .review,
                  selectedReviewWorkspace == .timeline,
                  let history = decisionReviewHistory,
                  let renderedIdentity = renderedDecisionReviewTimelineIdentity else { return }
            let expectedIdentity = decisionReviewTimelineIdentity(history)
            let timelineIsReady = target.hasPrefix("decision-review-source:")
                ? renderedIdentity.requestedSymbol == expectedIdentity.requestedSymbol
                    && renderedIdentity.checks == expectedIdentity.checks
                : renderedIdentity == expectedIdentity
            guard timelineIsReady else { return }
            scrollProxy.scrollTo(target, anchor: .top)
            pendingDecisionWorkspaceScrollTarget = nil
            return
        }
        Task { @MainActor in
            await Task.yield()
            guard pendingDecisionWorkspaceScrollTarget == target else { return }
            scrollProxy.scrollTo(target, anchor: .top)
            pendingDecisionWorkspaceScrollTarget = nil
        }
    }
}
