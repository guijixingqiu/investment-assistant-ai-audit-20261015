import Foundation

extension GateBResearchScreen {
    func confirmsReview(
        history: DecisionReviewHistoryEnvelope,
        response: PostDecisionReviewData,
        checkBinding: GateBDecisionReviewCheckBinding
    ) -> Bool {
        guard history.requestedSymbol == checkBinding.symbol,
              history.metadata.freshness == "fresh",
              history.metadata.stale == false,
              history.metadata.missing == false,
              history.metadata.conflict == false else { return false }
        let checks = history.checks.filter { $0.id == checkBinding.checkId }
        guard checks.count == 1,
              checkBinding.matchesImmutableIdentity(of: checks[0]) else { return false }
        let reviews = checks[0].reviews.filter { $0.id == response.id }
        return reviews.count == 1 && reviews[0] == response
    }

    @MainActor
    func finishTodayReviewReturnIfNeeded(
        _ response: PostDecisionReviewData,
        symbol: SecuritySymbol,
        check: RecordedDecisionCheckReviewState,
        checkBinding: GateBDecisionReviewCheckBinding,
        authorizationRevision: UUID
    ) {
        let todayReturnTarget = activeTodayReviewReturnTarget
        guard dailyClientAuthorizationIsCurrent(authorizationRevision) else {
            activeTodayReviewReturnTarget = nil
            return
        }
        guard let todayReturnTarget else { return }
        guard activeTodayReviewReturnTarget == todayReturnTarget,
              todayReturnTarget.canonicalSymbol == symbol.canonical,
              todayReturnTarget.decisionCheckId == check.id,
              todayReturnTarget.reviewId == nil,
              todayReturnTarget.reportBinding == nil,
              let history = decisionReviewHistory,
              confirmsReview(history: history, response: response, checkBinding: checkBinding) else {
            activeTodayReviewReturnTarget = nil
            lastReviewMessage = "复盘已保存，但重新读取时未确认同一记录；请在研究页查看，暂不自动返回今日。"
            return
        }
        activeTodayReviewReturnTarget = nil
        todayRefreshRevision &+= 1
        selectedTab = .today
    }

    @MainActor
    func dailyTrackingBindingForReview(
        _ check: RecordedDecisionCheckReviewState
    ) -> ResearchReportDecisionBinding? {
        guard let target = activeTodayDailyTrackingTarget else { return nil }
        guard check.researchReportDecision.availability == "preserved" else {
            clearRequestedTodayReviewTarget("每日跟踪复盘缺少正式报告绑定；旧目标已清除。")
            return nil
        }
        guard let binding = check.researchReportDecision.binding else {
            clearRequestedTodayReviewTarget("每日跟踪复盘绑定损坏；旧目标已清除，请重新刷新 Today。")
            return nil
        }
        guard target.reviewId == nil,
              target.decisionCheckId == check.id,
              target.reportBinding == binding,
              resolveTodayDailyTrackingTarget(target) else {
            clearRequestedTodayReviewTarget("每日跟踪复盘的 membership、报告、证据包、技术或材料身份已变化；旧目标已清除。")
            return nil
        }
        return binding
    }

    func confirmsDailyTrackingReview(
        history: DecisionReviewHistoryEnvelope,
        response: PostDecisionReviewData,
        checkBinding: GateBDecisionReviewCheckBinding,
        dailyTrackingBinding: ResearchReportDecisionBinding?
    ) -> Bool {
        guard confirmsReview(history: history, response: response, checkBinding: checkBinding) else {
            return false
        }
        let checks = history.checks.filter { $0.id == checkBinding.checkId }
        guard checks.count == 1,
              checkBinding.matchesImmutableIdentity(of: checks[0]),
              checks[0].researchReportDecision.binding == dailyTrackingBinding else { return false }
        return true
    }

    @MainActor
    func finishDailyTrackingReviewAfterWrite(
        response: ResearchWriteEnvelope<PostDecisionReviewData>,
        symbol: SecuritySymbol,
        check: RecordedDecisionCheckReviewState,
        checkBinding: GateBDecisionReviewCheckBinding,
        reportBinding: ResearchReportDecisionBinding?,
        submission: PendingDecisionReviewSubmission,
        authorizationRevision: UUID
    ) async throws -> Bool {
        let confirmedHistory = try await client.fetchDecisionReviewHistory(
            market: symbol.market,
            code: symbol.code
        )
        guard dailyClientAuthorizationIsCurrent(authorizationRevision),
              parsedSymbol?.canonical == symbol.canonical,
              reviewCheckBindingIsCurrent(checkBinding, check: check),
              confirmsDailyTrackingReview(
                history: confirmedHistory,
                response: response.data,
                checkBinding: checkBinding,
                dailyTrackingBinding: reportBinding
              ) else {
            guard reviewSubmissionState.finishStaleSuccessPreservingRetry(for: submission) else { return false }
            submittedReview = nil
            decisionReviewHistory = nil
            clearRequestedTodayReviewTarget("保存后未能重新确认同一每日跟踪复盘；没有显示成功，并保留安全重试。")
            return false
        }
        decisionReviewHistory = confirmedHistory
        decisionReviewMessage = nil
        guard reviewSubmissionState.finishSuccessOrReplay(for: submission) else { return false }
        lastReviewMessage = response.message
        submittedReview = response.data
        activeTodayDailyTrackingTarget = TodayReviewNavigationTarget(
            membershipId: checkBinding.membershipId,
            membershipVersion: checkBinding.membershipVersion,
            canonicalSymbol: symbol.canonical,
            decisionCheckId: check.id,
            reviewId: response.data.id,
            reportBinding: reportBinding,
            expectedReviewOutcome: response.data.outcome == .thesisWeakened
                || response.data.outcome == .thesisInvalidated
                ? response.data.outcome : nil
        )
        todayRefreshRevision &+= 1
        selectedTab = .today
        return true
    }

    func resolveTodayDailyTrackingTarget(_ target: TodayReviewNavigationTarget) -> Bool {
        guard let expected = target.reportBinding,
              let membership = selectedMembership,
              membership.id == target.membershipId,
              membership.version == target.membershipVersion,
              let history = decisionReviewHistory,
              history.resolveTodayReviewNavigation(target) != nil,
              let workspace = twoLayerReportWorkspace.envelope?.data,
              let report = workspace.latestReport,
              let decision = workspace.userDecision,
              let pack = workspace.latestPack,
              researchReportFormalDecisionIsEligible(
                membership: membership,
                workspace: workspace,
                report: report,
                decision: decision,
                pack: pack
              ),
              pack.frozenResearchContext != nil,
              let materialList = researchDocumentWorkspace.list,
              materialList.membershipId == membership.id,
              materialList.membershipVersion == membership.version,
              materialList.symbol == membership.symbol else {
            return false
        }
        let current = ResearchReportDecisionBinding(
            membershipId: membership.id,
            membershipVersion: membership.version,
            symbol: membership.symbol,
            evidencePackId: pack.id,
            evidencePackFingerprint: pack.packFingerprint,
            reportId: report.id,
            reportVersion: report.version,
            contractVersion: report.contractVersion,
            reportFingerprint: report.reportFingerprint,
            reportDecisionId: decision.id,
            reportDecision: decision.decision,
            reportDecisionActorType: decision.actorType,
            reportDecisionActorId: decision.actorId,
            decidedAt: decision.decidedAt
        )
        guard current == expected else { return false }
        return pack.items.filter { $0.citation != nil }.allSatisfy { frozen in
            materialList.materials.filter { material in
                material.id == frozen.id
                    && material.evidenceId == frozen.evidenceId
                    && material.contentFingerprint == frozen.contentFingerprint
                    && material.revision == frozen.revision
                    && material.sourceVersion == frozen.sourceVersion
                    && material.citation == frozen.citation
                    && material.revisionState == "current"
                    && material.freshness == "fresh"
            }.count == 1
        }
    }
}
