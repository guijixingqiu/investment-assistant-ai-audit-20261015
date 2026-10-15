import Foundation
struct GateBDecisionReviewCheckBinding: Equatable {
    let authorizationRevision: UUID
    let actorId: String
    let membershipId: String
    let membershipVersion: Int
    let market: String
    let code: String
    let symbol: String
    let checkId: String
    let decisionContextSchemaVersion: String
    let decisionCheckSchemaVersion: String
    let contextId: String
    let contextHash: String
    let actionIntent: String
    let humanCheckResult: String
    let userFinalDecision: String?
    let checkedAt: String
    let contextSnapshot: DecisionContextSnapshotState
    let decisionSnapshot: DecisionSnapshotState
    let conditionalDecision: AnnualConditionalDecisionState?
    let formalDecision: FormalDecisionState
    let safety: DecisionCheckSafety

    init(
        authorizationRevision: UUID,
        actorId: String,
        membership: CandidateMembershipData,
        check: RecordedDecisionCheckReviewState
    ) {
        self.authorizationRevision = authorizationRevision
        self.actorId = actorId
        membershipId = membership.id
        membershipVersion = membership.version
        market = check.market
        code = check.code
        symbol = check.symbol
        checkId = check.id
        decisionContextSchemaVersion = check.decisionContextSchemaVersion
        decisionCheckSchemaVersion = check.decisionCheckSchemaVersion
        contextId = check.contextId
        contextHash = check.contextHash
        actionIntent = check.actionIntent
        humanCheckResult = check.humanCheckResult
        userFinalDecision = check.userFinalDecision
        checkedAt = check.checkedAt
        contextSnapshot = check.contextSnapshot
        decisionSnapshot = check.decisionSnapshot
        conditionalDecision = check.conditionalDecision
        formalDecision = check.formalDecision
        safety = check.safety
    }

    func matchesImmutableIdentity(of check: RecordedDecisionCheckReviewState) -> Bool {
        market == check.market &&
            code == check.code &&
            symbol == check.symbol &&
            checkId == check.id &&
            decisionContextSchemaVersion == check.decisionContextSchemaVersion &&
            decisionCheckSchemaVersion == check.decisionCheckSchemaVersion &&
            contextId == check.contextId &&
            contextHash == check.contextHash &&
            actionIntent == check.actionIntent &&
            humanCheckResult == check.humanCheckResult &&
            userFinalDecision == check.userFinalDecision &&
            checkedAt == check.checkedAt &&
            contextSnapshot == check.contextSnapshot &&
            decisionSnapshot == check.decisionSnapshot &&
            conditionalDecision == check.conditionalDecision &&
            formalDecision == check.formalDecision &&
            safety == check.safety
    }
}

extension GateBResearchScreen {
    @MainActor
    func preparePortfolioReviewBinding(
        for check: RecordedDecisionCheckReviewState,
        reviewCheckBinding: GateBDecisionReviewCheckBinding,
        symbol: SecuritySymbol,
        authorizationRevision: UUID
    ) async throws -> PostDecisionPortfolioReviewBinding? {
        let reviewContextRequestId = UUID()
        portfolioContextRequestId = reviewContextRequestId
        portfolioRiskRequestId = UUID()
        isLoadingPortfolioContext = true
        isLoadingPortfolioRisk = false
        lastReviewMessage = "正在重新读取复盘时组合事实..."
        clearAnnualPortfolioLab(message: "复盘正在重新读取组合；旧组合实验室结果已清除。", membershipId: selectedMembership?.id)
        defer {
            if portfolioContextRequestId == reviewContextRequestId {
                isLoadingPortfolioContext = false
            }
        }
        let reviewTime: PortfolioDecisionContextEnvelope
        do {
            reviewTime = try await portfolioClient.fetchContext()
        } catch {
            guard portfolioContextRequestId == reviewContextRequestId else {
                throw GateBPortfolioReviewPreparationError.superseded
            }
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  parsedSymbol?.canonical == symbol.canonical,
                  reviewCheckBindingIsCurrent(reviewCheckBinding, check: check) else {
                throw GateBPortfolioReviewPreparationError.contextChanged
            }
            throw error
        }
        guard portfolioContextRequestId == reviewContextRequestId else {
            throw GateBPortfolioReviewPreparationError.superseded
        }
        guard dailyClientAuthorizationIsCurrent(authorizationRevision),
              parsedSymbol?.canonical == symbol.canonical,
              reviewCheckBindingIsCurrent(reviewCheckBinding, check: check) else {
            throw GateBPortfolioReviewPreparationError.contextChanged
        }
        let binding = try PostDecisionPortfolioReviewBinding.captureIfComparable(
            decisionCheckId: check.id,
            decisionSnapshot: check.decisionSnapshot,
            reviewTimePortfolio: reviewTime
        )

        portfolioContextRequestId = UUID()
        portfolioRiskRequestId = UUID()
        portfolioLabRequestId = UUID()
        isLoadingPortfolioContext = false
        isLoadingPortfolioRisk = false
        portfolioContext = reviewTime
        portfolioLabKnownContextStatus = reviewTime.status
        portfolioContextMessage = binding == nil
            ? "复盘提交前已重新读取；当前组合不可比较，本次明确记录为未捕获。\(reviewTime.message)"
            : "复盘提交前已重新读取：\(reviewTime.message)"
        portfolioRiskImpact = nil
        portfolioRiskMessage = "组合事实已在复盘前重新读取；旧风险情景已清除。"
        return binding
    }

    @MainActor
    func portfolioReviewBindingMatchesCurrentFacts(
        _ binding: PostDecisionPortfolioReviewBinding?,
        check: RecordedDecisionCheckReviewState
    ) -> Bool {
        guard let portfolioContext else { return false }
        do {
            return try PostDecisionPortfolioReviewBinding.captureIfComparable(
                decisionCheckId: check.id,
                decisionSnapshot: check.decisionSnapshot,
                reviewTimePortfolio: portfolioContext
            ) == binding
        } catch {
            return false
        }
    }

    @MainActor
    func applyPortfolioReviewPreparationFailure(_ error: Error) {
        clearAnnualPortfolioLab(message: "复盘组合读取失败；旧组合实验室结果已清除。", membershipId: selectedMembership?.id)
        submittedReview = nil
        portfolioContextRequestId = UUID()
        portfolioRiskRequestId = UUID()
        isLoadingPortfolioContext = false
        isLoadingPortfolioRisk = false
        portfolioContext = nil
        portfolioLabKnownContextStatus = nil
        portfolioRiskImpact = nil
        portfolioRiskMessage = nil
        portfolioContextMessage = "复盘时组合读取失败，旧组合与风险事实已清除。"
        lastReviewMessage = switch error {
        case GateBPortfolioReviewPreparationError.contextChanged:
            "复盘提交已取消：当前标的或人工检查已变化。"
        case PostDecisionPortfolioReviewValidationError.invalid:
            "复盘提交已失败闭合：决策快照或复盘时组合绑定无效。"
        case PortfolioDecisionClientError.httpStatus(401):
            "复盘提交已失败闭合：未认证，无法重新读取组合事实。"
        case PortfolioDecisionContextValidationError.invalid:
            "复盘提交已失败闭合：组合响应语义或 canonical 身份无效。"
        case is DecodingError:
            "复盘提交已失败闭合：组合响应格式无效。"
        case is URLError:
            "复盘提交已失败闭合：组合读取离线。"
        default:
            "复盘提交已失败闭合：无法重新读取并绑定组合事实。"
        }
    }

    var currentSubmittedDecision: DecisionCheckData? {
        guard let submittedDecision,
              let decisionContext,
              CoreJourneyState.submittedDecisionMatchesCurrentContext(
                submittedDecision,
                symbol: parsedSymbol?.canonical ?? "",
                decisionContext: decisionContext
              ) else {
            return nil
        }
        return submittedDecision
    }

    var currentHistoryDecision: RecordedDecisionCheckReviewState? {
        CoreJourneyState.currentHistoryDecision(
            symbol: parsedSymbol?.canonical ?? "",
            decisionContext: decisionContext,
            history: decisionReviewHistory
        )
    }

    var hasCurrentDecision: Bool {
        currentSubmittedDecision != nil || currentHistoryDecision != nil
    }

    var currentReviewableCheck: RecordedDecisionCheckReviewState? {
        if let selectedDecisionReviewCheckBinding,
           let check = boundReviewCheck(for: selectedDecisionReviewCheckBinding) {
            return check
        }

        let check: RecordedDecisionCheckReviewState?
        if let submittedDecision = currentSubmittedDecision,
           let history = decisionReviewHistory {
            let matches = history.checks.filter {
                $0.id == submittedDecision.id &&
                    $0.symbol == submittedDecision.symbol &&
                    $0.contextId == submittedDecision.contextId &&
                    $0.contextHash == submittedDecision.contextHash &&
                    $0.decisionContextSchemaVersion == submittedDecision.decisionContextSchemaVersion &&
                    $0.decisionCheckSchemaVersion == submittedDecision.decisionCheckSchemaVersion
            }
            check = matches.count == 1 ? matches[0] : nil
        } else {
            check = currentHistoryDecision
        }
        guard let check,
              check.reviews.isEmpty,
              makeReviewCheckBinding(for: check) != nil else { return nil }
        return check
    }

    func makeReviewCheckBinding(
        for check: RecordedDecisionCheckReviewState
    ) -> GateBDecisionReviewCheckBinding? {
        guard let symbol = parsedSymbol,
              let membership = selectedMembership,
              let history = decisionReviewHistory,
              !membership.actorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              membership.market == symbol.market,
              membership.code == symbol.code,
              membership.symbol == symbol.canonical,
              history.requestedSymbol == symbol.canonical,
              history.metadata.freshness == "fresh",
              history.metadata.stale == false,
              history.metadata.missing == false,
              history.metadata.conflict == false else {
            return nil
        }
        let matches = history.checks.filter { $0.id == check.id }
        guard matches.count == 1, matches[0] == check else { return nil }
        return GateBDecisionReviewCheckBinding(
            authorizationRevision: viewModel.authorizationRevision,
            actorId: membership.actorId,
            membership: membership,
            check: check
        )
    }

    func reviewCheckBindingIsCurrent(
        _ binding: GateBDecisionReviewCheckBinding,
        check: RecordedDecisionCheckReviewState
    ) -> Bool {
        guard dailyClientAuthorizationIsCurrent(binding.authorizationRevision),
              let membership = selectedMembership,
              membership.actorId == binding.actorId,
              membership.id == binding.membershipId,
              membership.version == binding.membershipVersion,
              membership.market == binding.market,
              membership.code == binding.code,
              membership.symbol == binding.symbol,
              parsedSymbol?.canonical == binding.symbol,
              let history = decisionReviewHistory,
              history.requestedSymbol == binding.symbol,
              history.metadata.freshness == "fresh",
              history.metadata.stale == false,
              history.metadata.missing == false,
              history.metadata.conflict == false else {
            return false
        }
        let matches = history.checks.filter { $0.id == binding.checkId }
        return matches.count == 1 &&
            binding.matchesImmutableIdentity(of: matches[0]) &&
            binding.matchesImmutableIdentity(of: check)
    }

    func boundReviewCheck(
        for binding: GateBDecisionReviewCheckBinding
    ) -> RecordedDecisionCheckReviewState? {
        guard let history = decisionReviewHistory else { return nil }
        let matches = history.checks.filter { $0.id == binding.checkId }
        guard matches.count == 1,
              reviewCheckBindingIsCurrent(binding, check: matches[0]) else { return nil }
        return matches[0]
    }

    @MainActor
    func selectDecisionReviewCheck(_ check: RecordedDecisionCheckReviewState) {
        guard reviewInFlightCheckId == nil,
              reviewSubmissionState.isInFlight == false,
              let binding = makeReviewCheckBinding(for: check) else {
            lastReviewMessage = "复盘选择已失败闭合：actor、标的或冻结检查身份不可用。"
            return
        }
        selectedDecisionReviewCheckBinding = binding
        reviewOutcome = .insufficientEvidence
        reviewEvidence = "复盘证据仍不足，保持观察。"
        reviewNote = "仅记录复盘，不生成交易。"
        reviewJudgmentCorrection = ""
        reviewProcessLesson = ""
        reviewNextResearchQuestion = ""
        focusedReviewLearningInput = nil
        submittedReview = nil
        reviewSubmissionState.invalidateContextPreservingRetry()
        lastReviewMessage = "已绑定检查 \(check.id)；草稿与其他检查隔离。"
    }

    @MainActor
    func bindRequestedTodayReviewTargetIfPossible() {
        guard let target = requestedTodayReviewTarget,
              let capturedAuthorizationRevision = requestedTodayReviewAuthorizationRevision else {
            return
        }
        selectedReviewWorkspace = .timeline
        guard selectedDecisionLayer == .review,
              parsedSymbol?.canonical == target.canonicalSymbol,
              selectedMembership?.id == target.membershipId,
              selectedMembership?.version == target.membershipVersion,
              dailyClientAuthorizationIsCurrent(capturedAuthorizationRevision),
              let history = decisionReviewHistory,
              let destination = history.resolveTodayReviewNavigation(target) else {
            selectedDecisionReviewCheckBinding = nil
            clearRequestedTodayReviewTarget(
                "Today 复盘目标已过期或与当前 actor、标的、授权、历史不一致；未绑定或提交。请重新刷新 Today。"
            )
            return
        }
        let matches = history.checks.filter { $0.id == target.decisionCheckId }
        guard matches.count == 1,
              makeReviewCheckBinding(for: matches[0]) != nil else {
            selectedDecisionReviewCheckBinding = nil
            clearRequestedTodayReviewTarget(
                "Today 复盘目标无法绑定当前 membership/version/check；请求已清除。"
            )
            return
        }
        switch destination {
        case .check(let checkId):
            selectDecisionReviewCheck(matches[0])
            guard selectedDecisionReviewCheckBinding?.checkId == target.decisionCheckId else {
                clearRequestedTodayReviewTarget("Today 复盘目标绑定失败；请求已清除。")
                return
            }
            (activeTodayReviewReturnTarget, pendingDecisionWorkspaceScrollTarget) = (target.reportBinding == nil ? target : nil, decisionReviewFormAnchor(checkId))
        case .review(let reviewId):
            selectedDecisionReviewCheckBinding = nil
            reviewSubmissionState.invalidateContextPreservingRetry()
            pendingDecisionWorkspaceScrollTarget = decisionReviewSourceAnchor(reviewId)
        }
        requestedTodayReviewTarget = nil
        requestedTodayReviewAuthorizationRevision = nil
    }

    @MainActor
    func clearRequestedTodayReviewTarget(_ message: String) {
        let hasPendingReviewScroll = pendingDecisionWorkspaceScrollTarget?
            .hasPrefix("decision-review-") == true
        guard requestedTodayReviewTarget != nil
                || requestedTodayReviewAuthorizationRevision != nil
                || activeTodayDailyTrackingTarget != nil || activeTodayReviewReturnTarget != nil
                || dailyTrackingReconsiderationDraftBinding != nil
                || hasPendingReviewScroll
                || renderedDecisionReviewTimelineIdentity != nil else { return }
        requestedTodayReviewTarget = nil
        requestedTodayReviewAuthorizationRevision = nil
        activeTodayDailyTrackingTarget = nil; activeTodayReviewReturnTarget = nil
        clearDailyTrackingReconsiderationDraft(resetFormalDecisionText: true)
        if hasPendingReviewScroll {
            pendingDecisionWorkspaceScrollTarget = nil
        }
        renderedDecisionReviewTimelineIdentity = nil
        lastReviewMessage = message
    }

    var currentSubmittedReview: PostDecisionReviewData? {
        if let submittedDecision = currentSubmittedDecision,
           let submittedReview,
           submittedReview.decisionCheckId == submittedDecision.id,
           submittedReview.symbol == submittedDecision.symbol {
            return submittedReview
        }
        return currentHistoryDecision?.reviews.first
    }

    @MainActor
    func clearSubmittedDecisionIfMismatched(symbol: String, decisionContext: DecisionContextEnvelope?) {
        guard let submittedDecision,
              let decisionContext,
              CoreJourneyState.submittedDecisionMatchesCurrentContext(
                submittedDecision,
                symbol: symbol,
                decisionContext: decisionContext
              ) else {
            clearSubmittedDecision()
            return
        }
    }
}

enum GateBPortfolioReviewPreparationError: Error {
    case superseded
    case contextChanged
}
