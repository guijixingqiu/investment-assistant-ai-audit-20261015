import SwiftUI
extension GateBResearchScreen {
    @MainActor
    func refreshDailyClient(
        restoredNavigation: Bool,
        preferredMembership: CandidateMembershipData?,
        preferredMembershipIdentity: TodayCandidateNavigationTarget? = nil
    ) async {
        guard let symbol = parsedSymbol,
              let source = DailyClientSourceKey(
                canonicalSymbol: symbol.canonical,
                authorizationRevision: viewModel.authorizationRevision
              ) else {
            resetResearchEventCapture("标的格式无效；未保留旧事件录入草稿。")
            dailyRefreshGate.supersede()
            dailyContinuityMessage = "标的格式无效；未恢复或复用任何远端事实。"
            researchMarketTechnicalEnvelope = nil
            researchWeinsteinEnvelope = nil
            resetResearchWeinsteinZoneCorrection("标的格式无效；旧人工区域修正草稿已清除。")
            researchContextWorkspace.clear("标的格式无效；旧行业与同业上下文已清除。")
            frozenResearchEvidenceWorkspace.clear("标的格式无效；旧冻结证据历史已清除。")
            invalidateTwoLayerReport("标的格式无效；旧两层报告状态已清除。")
            clearAnnualValuationQuant(
                message: "标的输入已变化；旧估值和量化结果已清除。",
                membershipId: selectedMembership?.id
            )
            invalidatePortfolioForSymbolChange()
            await loadProfile()
            await loadPortfolioDecisionContext()
            return
        }
        if activeResearchTechnicalRefreshSource == source,
           let revision = activeResearchTechnicalRefreshRevision,
           researchTechnicalRequestLane.accepts(revision) {
            return
        }
#if OWNER_CLIENT
        if clientDestination == .manualResearch { manualHandoffSession.beginRefresh() }
#endif
        if dailyRefreshGate.currentSource?.canonicalSymbol != source.canonicalSymbol {
            invalidateDailyClientBoundFacts(
                reason: "标的已切换至 \(source.canonicalSymbol)",
                continuityMessage: "标的来源已变化；上一标的的候选、研究、组合与复盘事实已清除。"
            )
        }
        let ticket = dailyRefreshGate.begin(
            source: source,
            restoredNavigation: restoredNavigation
        )
        dailyContinuityMessage = restoredNavigation
            ? "已恢复上次位置；正在重新核验当前来源。"
            : "正在重新读取当前来源。"
        async let candidates: Void = refreshCandidates()
        async let memberships: ResearchContextMembershipBinding? = refreshMemberships()
        async let technical: Void = loadResearchTechnicalEvidence()
        let (_, refreshedContextBinding, _) = await (candidates, memberships, technical)
        guard let refreshedSource = currentDailyClientSourceKey(),
              dailyRefreshGate.isCurrent(ticket, source: refreshedSource) else { return }
        let currentMembership = restoreCurrentMembership(
            preferred: preferredMembership,
            symbol: symbol.canonical,
            identity: preferredMembershipIdentity
        )
        synchronizeFrozenResearchBinding(
            "研究成员或技术证据绑定已变化；旧冻结展示与确认已清除。"
        )
        clearAnnualValuationQuant(
            message: "标的或来源正在重读；旧估值和量化结果已清除。",
            membershipId: currentMembership?.id
        )
        invalidatePortfolioForSymbolChange()
        async let journey: Void = loadProfile()
        async let portfolio: Void = loadPortfolioDecisionContext()
        _ = await (journey, portfolio)
        guard let journeySource = currentDailyClientSourceKey(),
              dailyRefreshGate.isCurrent(ticket, source: journeySource) else { return }
        await reloadAnnualDecisionBriefIfStillBound(to: currentMembership)
        if let membership = selectedMembership,
           membership.id == currentMembership?.id,
           membership.version == currentMembership?.version,
           membership.symbol == symbol.canonical,
           membership.state != .archived {
            await loadTodayResearch(for: membership)
            if refreshedContextBinding != ResearchContextMembershipBinding(membership) {
                await loadResearchContext(for: membership)
            }
            await loadResearchFundamentals(includingValuation: false)
            await loadResearchValuationScenarios()
            await loadCandidateDecisionIntake(for: membership)
            await loadAssistAdvisoryScope(for: membership)
            await loadAssistHumanReviewWorkspace(for: membership)
            await loadAssistReviewFollowUpWorkflow(for: membership)
            await loadAssistDecisionNoteWorkflow(for: membership)
            await loadCloudAiPolicy(expectedActorId: membership.actorId)
            await loadFrozenResearchEvidence()
            await loadTwoLayerReports()
        }
        guard let completedSource = currentDailyClientSourceKey(),
              dailyRefreshGate.isCurrent(ticket, source: completedSource) else { return }
        let limited = dailyClientHasLimitations()
        dailyRefreshGate.finish(ticket, source: source, limited: limited)
#if OWNER_CLIENT
        if clientDestination == .tasks { await reconcilePersonalFormalHandoff() }
        if clientDestination == .manualResearch { await reconcilePersonalManualResearchHandoff() }
#endif
        dailyContinuityMessage = limited
            ? "本轮读取完成；受限来源已在对应年轮中标明。"
            : "本轮候选、研究、组合与复盘来源已重新读取。"
        if let membership = selectedMembership, membership.state != .archived {
            let daily = researchMarketTechnicalEnvelope
            let identity = [
                membership.id,
                String(membership.version),
                daily?.dailyBars.request.cutoff ?? "no-cutoff",
                daily?.dailyBars.snapshot?.snapshotSha ?? "no-snapshot",
                daily?.technical.resultHash ?? "no-result"
            ].joined(separator: ":")
            scheduleResearchArchiveAutomaticBackup(.daily(identity), membership: membership)
        }
    }
    @MainActor
    func invalidateDailyClientForAuthorizationChange() {
        researchTechnicalRequestLane.reset()
        todayRefreshRevision &+= 1
        let context = AppEnvironment.researchAuthorizationContext()
        viewModel.marketDailyClient = MarketDailyTechnicalClient(
            baseURL: context.baseURL,
            authToken: context.readToken,
            authHeaderName: context.readHeaderName
        )
        requestedTodayCandidateTarget = nil
        clearRequestedTodayResearchTarget(
            "Today 研究事项的授权已变化；请求已清除。"
        )
        clearRequestedTodayReviewTarget(
            "Today 复盘目标的授权已变化；请求已清除。"
        )
        reviewSubmissionState.discardForAuthorizationChange()
        invalidateDailyClientBoundFacts(
            reason: "读取授权已变化",
            continuityMessage: "读取授权已变化；旧账户与候选事实已清除。"
        )
    }
    @MainActor
    func invalidateDailyClientBoundFacts(reason: String, continuityMessage: String) {
        resetResearchEventCapture("\(reason)；旧事件录入草稿已清除。")
        dailyRefreshGate.supersede()
        requestState.invalidateAll()
        portfolioContextRequestId = UUID()
        portfolioRiskRequestId = UUID()
        portfolioLabRequestId = UUID()
        conditionalDecisionRequestId = UUID()
        isLoadingPortfolioContext = false
        isLoadingPortfolioRisk = false
        isLoadingPortfolioLab = false
        isLoadingConditionalDecisionPreview = false
        membershipSubmissionState = CandidateMembershipSubmissionState()
        annualDecisionBriefProfileSubmissionState = AnnualDecisionBriefProfileSubmissionState()
        annualDecisionBriefEvidenceSubmissionState = AnnualDecisionBriefEvidenceSubmissionState()
        submissionState.discardForSourceDrift()
        reviewSubmissionState.invalidateContextPreservingRetry()
        decisionInFlight = nil
        reviewInFlightCheckId = nil
        membershipWriteMessage = nil
        membershipStaleMessage = nil
        annualDecisionBriefWriteMessage = nil
        lastDecisionMessage = nil
        lastReviewMessage = nil
        candidateOverview = .unavailable("\(reason)；正在重读候选概览。")
        candidateMemberships = .unavailable(
            "\(reason)；正在重读 actor-scoped 研究自选。",
            includeArchived: includeArchivedMemberships
        )
        cloudAiPolicy = nil; cloudAiNoBackupConfirmed = false; cloudAiPolicyReservation.clear()
        let priorMembershipId = selectedMembership?.id
        clearTodayResearch("\(reason)；旧股票的 Today 事项已清除。", membershipId: priorMembershipId)
        selectedMembership = nil
        researchDocumentWorkspace.clearForIdentityChange("unselected:\(viewModel.authorizationRevision.uuidString)")
        researchFundamentalWorkspace.clearForIdentityChange()
        researchFinancialRequirementWorkspace.clearForIdentityChange()
        researchValuationScenarioWorkspace.clearForIdentityChange()
        envelope = .unavailable("\(reason)；旧研究事实已清除。")
        decisionContext = nil
        decisionContextMessage = "\(reason)；旧决策上下文已清除。"
        decisionReviewHistory = nil
        decisionReviewMessage = "\(reason)；旧复盘历史已清除。"
        pinganSnapshot = nil
        pinganSnapshotMessage = "\(reason)；旧历史研究快照已清除。"
        researchMarketTechnicalEnvelope = nil
        researchWeinsteinEnvelope = nil
        resetResearchWeinsteinZoneCorrection("\(reason)；旧人工区域修正草稿已清除。")
        researchContextWorkspace.clear("\(reason)；旧行业与同业上下文已清除。")
        frozenResearchEvidenceWorkspace.clear("\(reason)；旧冻结证据历史已清除。")
        invalidateTwoLayerReport("\(reason)；旧两层报告状态已清除。")
        portfolioContext = nil
        portfolioLabKnownContextStatus = nil
        portfolioContextMessage = "\(reason)；旧账户组合事实已清除。"
        portfolioRiskImpact = nil
        portfolioRiskMessage = nil
        clearSubmittedDecision()
        clearAnnualValuationQuant(
            message: "\(reason)；旧估值和量化结果已清除。",
            membershipId: priorMembershipId
        )
        clearAnnualPortfolioLab(
            message: "\(reason)；旧组合实验室结果已清除。",
            membershipId: priorMembershipId
        )
        clearCandidateDecisionPathAfterMembershipRefresh(
            state: "superseded",
            message: "\(reason)；所有 actor-scoped 工作台事实必须重新读取。",
            membershipId: priorMembershipId,
            localRecordStatusMessage: "\(reason)；本地记录显示和草稿已清除，存储未删除。",
            force: true
        )
        clearReviewKnowledgeDisplay("\(reason)；本地复盘知识显示和草稿已清除，存储未删除。")
        dailyContinuityMessage = continuityMessage
    }
    @ViewBuilder
    func dailyClientContinuityBar(layout: DailyWorkbenchLayoutMetrics) -> some View {
        Group {
            if layout.stacksContinuity {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        dailyContinuityStatusIcon()
                        dailyContinuityTitleLine()
                        Spacer(minLength: 6)
                        dailyContinuityRefreshButton()
                    }
                    dailyContinuityMessageView()
                }
            } else {
                HStack(spacing: 12) {
                    dailyContinuityStatusIcon()
                    VStack(alignment: .leading, spacing: 3) {
                        dailyContinuityTitleLine()
                        dailyContinuityMessageView()
                    }
                    Spacer(minLength: 8)
                    dailyContinuityRefreshButton()
                }
            }
        }
        .padding(layout.cardPadding)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(dailyContinuityColor.opacity(0.16), lineWidth: 1)
        }
        .overlay(alignment: .leading) {
            Capsule()
                .fill(dailyContinuityColor)
                .frame(width: 3)
                .padding(.vertical, 12)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("dailyContinuityBar")
    }
    @ViewBuilder
    private func dailyContinuityStatusIcon() -> some View {
        Group {
            if dailyRefreshGate.phase == .refreshing
                || dailyRefreshGate.phase == .validatingRestoredNavigation {
                ProgressView()
                    .tint(dailyContinuityColor)
            } else {
                Image(systemName: dailyContinuityIcon)
                    .foregroundStyle(dailyContinuityColor)
            }
        }
        .frame(width: 36, height: 36)
        .background(dailyContinuityColor.opacity(0.1), in: Circle())
    }
    private func dailyContinuityTitleLine() -> some View {
        HStack(spacing: 8) {
            Text(dailyContinuityTitle)
                .font(.callout.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("dailyContinuityTitle")
            if initialResumeResult.snapshot != nil {
                Label("已续接", systemImage: "arrow.uturn.backward.circle")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("dailyResumeState")
                    .accessibilityValue("restored_navigation_only")
            }
        }
    }
    private func dailyContinuityMessageView() -> some View {
        Text(dailyContinuityMessage ?? initialResumeMessage)
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("dailyContinuityMessage")
    }
    private func dailyContinuityRefreshButton() -> some View {
        Button {
            Task {
                await refreshDailyClient(restoredNavigation: false, preferredMembership: selectedMembership)
            }
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 44, height: 44)
                .background(dailyContinuityColor.opacity(0.1), in: Circle())
                .overlay(Circle().stroke(dailyContinuityColor.opacity(0.14), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(isLoadingMobileWorkspace)
        .accessibilityLabel("重新读取今日事实")
        .accessibilityIdentifier("dailyContinuityRefreshButton")
        .help("重新读取今日事实")
    }
    private func restoreCurrentMembership(
        preferred: CandidateMembershipData?,
        symbol: String,
        identity: TodayCandidateNavigationTarget? = nil
    ) -> CandidateMembershipData? {
        let preferredId = identity?.membershipId ?? preferred?.id ?? selectedMembership?.id
        let preferredVersion = identity?.membershipVersion
        let exact = candidateMemberships.memberships.first {
            $0.id == preferredId
                && $0.symbol == symbol
                && $0.state != .archived
                && (preferredVersion == nil || $0.version == preferredVersion)
        }
        let symbolMatch = identity == nil
            ? uniqueActiveCandidateMembership(for: symbol, in: candidateMemberships)
            : nil
        let restored = exact ?? symbolMatch
        researchContextWorkspace.rebind(
            to: restored,
            message: restored == nil
                ? "当前标的没有可用 membership；旧行业与同业上下文已清除。"
                : "membership 已变化；正在重新读取行业与同业上下文。"
        )
        selectedMembership = restored
        return restored
    }
    private func currentDailyClientSourceKey() -> DailyClientSourceKey? {
        DailyClientSourceKey(
            canonicalSymbol: parsedSymbol?.canonical ?? "",
            authorizationRevision: viewModel.authorizationRevision
        )
    }
    func dailyClientAuthorizationIsCurrent(_ revision: UUID) -> Bool {
        viewModel.authorizationRevision == revision
    }
    private func dailyClientHasLimitations() -> Bool {
        candidateOverview.status == .unavailable
            || candidateMemberships.status == .unavailable
            || envelope.data == nil
            || decisionContext == nil
            || decisionReviewHistory?.metadata.freshness != "fresh"
            || decisionReviewMessage != nil
            || pinganSnapshot?.status != .stale
            || pinganSnapshotMessage != nil
            || portfolioContext?.status != .available
            || !researchContextWorkspace.hasAvailableContext(for: selectedMembership)
            || selectedMembership == nil
            || selectedMembership != nil && todayResearch.status != .available
            || selectedMembership != nil
                && researchInvestmentBriefCurrentReport == nil
                && annualDecisionBriefModel.state
                    != AnnualDecisionBriefReadinessState.readyForThreeMinuteReview.rawValue
    }
    private var initialResumeMessage: String {
        switch initialResumeResult {
        case .restored:
            "已恢复上次位置；当前事实将在读取后显示。"
        case .invalid:
            "无效的本地继续位置已忽略。"
        case .missing:
            "尚未完成当前来源读取。"
        }
    }
    private var dailyContinuityTitle: String {
        switch dailyRefreshGate.phase {
        case .validatingRestoredNavigation: "正在核验恢复位置"
        case .refreshing: "正在读取今日事实"
        case .checked: "今日事实已重读"
        case .limited: "部分来源受限"
        case .superseded: "来源已变化"
        case .idle: "今日工作台"
        }
    }
    private var dailyContinuityIcon: String {
        switch dailyRefreshGate.phase {
        case .checked: "checkmark.circle.fill"
        case .limited: "exclamationmark.circle.fill"
        case .superseded: "arrow.triangle.2.circlepath"
        case .idle: "circle.dotted"
        case .refreshing, .validatingRestoredNavigation: "arrow.clockwise"
        }
    }
    private var dailyContinuityColor: Color {
        switch dailyRefreshGate.phase {
        case .checked: .green
        case .limited: .orange
        case .superseded: .blue
        case .idle: .secondary
        case .refreshing, .validatingRestoredNavigation: .blue
        }
    }
}
