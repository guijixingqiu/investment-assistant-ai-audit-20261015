import SwiftUI

extension GateBResearchScreen {
    @MainActor
    func loadProfile() async {
        let retainedManualDraft = clientDestination == .manualResearch
            && !annualDecisionBriefProfileSubmissionState.isInFlight
            && annualDecisionBriefProfileDraft != annualDecisionBriefProfileLoadedDraft
            ? annualDecisionBriefProfileDraft : nil
        let retainedManualSource = annualDecisionBriefProfileDraftSource
        pendingDecisionReviewDeletionId = nil
        decisionReviewDeletionReservation.clear()
        clearReviewKnowledgeDisplay("研究标的或决策上下文来源正在变化；本地复盘知识显示和草稿已清除，存储未删除。")
        clearComparedDecisionReviewHistory("当前股票或授权来源正在变化；旧跨股票历史已清除。")
        invalidateAnnualDecisionBriefForUpstreamChange(
            "上游研究、决策或复盘事实正在刷新；旧每日简报已清除。",
            membership: selectedMembership
        )
        guard let symbol = parsedSymbol else {
            requestState.cancelJourneyLoad()
            let previousMembershipId = selectedMembership?.id
            researchContextWorkspace.rebind(
                to: nil,
                message: "标的格式无效；旧行业与同业上下文已清除。"
            )
            selectedMembership = nil
            malformedInputMessage = "仅支持形如 00700、00175.hk 或 HK.00175 的香港五位数字代码。"
            envelope = .unavailable("输入无效，未发送研究请求。")
            decisionContext = nil
            decisionContextMessage = "输入无效，未发送决策上下文请求。"
            pinganSnapshot = nil
            pinganSnapshotMessage = "输入无效，未发送平安快照请求。"
            decisionReviewHistory = nil
            decisionReviewMessage = "输入无效，未发送复盘历史请求。"
            clearSubmittedDecision()
            clearCandidateDecisionPathAfterMembershipRefresh(
                state: "malformed",
                message: "输入无效；ASSIST 工作台事实已清除，未发送下游请求。",
                membershipId: previousMembershipId,
                localRecordStatusMessage: "输入无效；本地记录显示已清除。",
                force: true
            )
            return
        }
        if let membership = selectedMembership, membership.symbol != symbol.canonical {
            let previousMembershipId = membership.id
            researchContextWorkspace.rebind(
                to: nil,
                message: "当前标的已变化；旧行业与同业上下文已清除。"
            )
            selectedMembership = nil
            clearCandidateDecisionPathAfterMembershipRefresh(
                state: "superseded",
                message: "当前标的已变化；上一候选的每日简报和 ASSIST 事实已清除。",
                membershipId: previousMembershipId,
                localRecordStatusMessage: "当前标的已变化；上一候选的本地记录显示已清除。",
                force: true
            )
        }
        let requestId = requestState.beginJourneyLoad()
        malformedInputMessage = nil
        if submittedDecisionSymbol != symbol.canonical {
            clearSubmittedDecision()
        }
        envelope = .loading
        annualDecisionBriefProfileDraft = .empty
        annualDecisionBriefProfileDraftSource = nil
        decisionContext = nil
        decisionContextMessage = "正在读取决策上下文..."
        decisionReviewHistory = nil
        decisionReviewMessage = "正在读取复盘历史..."
        defer {
            requestState.finishJourneyLoad(id: requestId)
        }
        pinganSnapshot = nil
        pinganSnapshotMessage = "正在读取平安历史快照..."
        do {
            let fetchedEnvelope = try await client.fetchProfile(market: symbol.market, code: symbol.code)
            guard requestState.isCurrentJourneyLoad(requestId) else { return }
            envelope = fetchedEnvelope
            syncAnnualDecisionBriefProfileDraft(from: fetchedEnvelope)
            if let retainedManualDraft, let retainedManualSource,
               retainedManualSource == annualDecisionBriefProfileDraftSource {
                annualDecisionBriefProfileDraft = retainedManualDraft
            }
        } catch {
            guard requestState.isCurrentJourneyLoad(requestId) else { return }
            envelope = .unavailable("候选研究 API 不可用：\(error.localizedDescription)")
        }
        do {
            let fetchedDecisionContext = try await client.fetchDecisionContext(market: symbol.market, code: symbol.code)
            guard requestState.isCurrentJourneyLoad(requestId) else { return }
            decisionContext = fetchedDecisionContext
            decisionContextMessage = nil
            clearSubmittedDecisionIfMismatched(symbol: symbol.canonical, decisionContext: decisionContext)
        } catch ResearchClientError.httpStatus(400) {
            guard requestState.isCurrentJourneyLoad(requestId) else { return }
            decisionContext = nil
            decisionContextMessage = "决策上下文请求无效，已清除旧决策上下文和人工检查状态。"
            clearSubmittedDecision()
        } catch ResearchClientError.httpStatus(401) {
            guard requestState.isCurrentJourneyLoad(requestId) else { return }
            decisionContext = nil
            decisionContextMessage = "未认证：需要授权后查看决策上下文，已清除旧决策上下文和人工检查状态。"
            clearSubmittedDecision()
        } catch ResearchClientError.httpStatus(404) {
            guard requestState.isCurrentJourneyLoad(requestId) else { return }
            decisionContext = nil
            decisionContextMessage = "决策上下文不存在，已清除旧决策上下文和人工检查状态。"
            clearSubmittedDecision()
        } catch ResearchClientError.httpStatus(409) {
            guard requestState.isCurrentJourneyLoad(requestId) else { return }
            decisionContext = nil
            decisionContextMessage = "决策上下文来源冲突，已清除旧决策上下文和人工检查状态。"
            clearSubmittedDecision()
        } catch DecisionContextValidationError.invalid {
            guard requestState.isCurrentJourneyLoad(requestId) else { return }
            decisionContext = nil
            decisionContextMessage = "决策上下文响应语义无效，已清除旧决策上下文和人工检查状态。"
            clearSubmittedDecision()
        } catch is DecodingError {
            guard requestState.isCurrentJourneyLoad(requestId) else { return }
            decisionContext = nil
            decisionContextMessage = "决策上下文响应格式无效，已清除旧决策上下文和人工检查状态。"
            clearSubmittedDecision()
        } catch is URLError {
            guard requestState.isCurrentJourneyLoad(requestId) else { return }
            decisionContext = nil
            decisionContextMessage = "决策上下文离线，已清除旧决策上下文和人工检查状态。"
            clearSubmittedDecision()
        } catch {
            guard requestState.isCurrentJourneyLoad(requestId) else { return }
            decisionContext = nil
            decisionContextMessage = "决策上下文不可用，已清除旧决策上下文和人工检查状态：\(error.localizedDescription)"
            clearSubmittedDecision()
        }
        do {
            let fetchedPinganSnapshot = try await client.fetchPinganSnapshot(market: symbol.market, code: symbol.code)
            guard requestState.isCurrentJourneyLoad(requestId) else { return }
            pinganSnapshot = fetchedPinganSnapshot
            pinganSnapshotMessage = nil
        } catch ResearchClientError.httpStatus(401) {
            guard requestState.isCurrentJourneyLoad(requestId) else { return }
            pinganSnapshot = nil
            pinganSnapshotMessage = "未授权：平安导入快照不会展示为持仓。"
        } catch PinganSnapshotValidationError.invalid {
            guard requestState.isCurrentJourneyLoad(requestId) else { return }
            pinganSnapshot = nil
            pinganSnapshotMessage = "平安快照响应语义无效，已阻止展示并且不复用旧快照。"
        } catch is DecodingError {
            guard requestState.isCurrentJourneyLoad(requestId) else { return }
            pinganSnapshot = nil
            pinganSnapshotMessage = "平安快照响应格式无效，已阻止展示并且不复用旧快照。"
        } catch {
            guard requestState.isCurrentJourneyLoad(requestId) else { return }
            pinganSnapshot = nil
            pinganSnapshotMessage = "平安快照不可用：\(error.localizedDescription)"
        }
        do {
            let fetchedDecisionReviewHistory = try await client.fetchDecisionReviewHistory(market: symbol.market, code: symbol.code)
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId) else { return }
            decisionReviewHistory = fetchedDecisionReviewHistory
            decisionReviewMessage = nil
        } catch ResearchClientError.httpStatus(400) {
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId) else { return }
            decisionReviewHistory = nil
            decisionReviewMessage = "决策复盘历史请求无效，已清除旧复盘状态。"
        } catch ResearchClientError.httpStatus(401) {
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId) else { return }
            decisionReviewHistory = nil
            decisionReviewMessage = "未认证：无法读取决策复盘历史。"
        } catch ResearchClientError.httpStatus(404) {
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId) else { return }
            decisionReviewHistory = nil
            decisionReviewMessage = "决策复盘历史不存在，已清除旧复盘状态。"
        } catch ResearchClientError.httpStatus(409) {
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId) else { return }
            decisionReviewHistory = nil
            decisionReviewMessage = "决策复盘历史冲突，已清除旧复盘状态。"
        } catch DecisionReviewValidationError.invalid {
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId) else { return }
            decisionReviewHistory = nil
            decisionReviewMessage = "决策复盘响应语义无效，已清除旧复盘状态。"
        } catch is DecodingError {
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId) else { return }
            decisionReviewHistory = nil
            decisionReviewMessage = "决策复盘响应格式无效，已清除旧复盘状态。"
        } catch is URLError {
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId) else { return }
            decisionReviewHistory = nil
            decisionReviewMessage = "决策复盘历史离线，已清除旧复盘状态。"
        } catch {
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId) else { return }
            decisionReviewHistory = nil
            decisionReviewMessage = "决策复盘不可用：\(error.localizedDescription)"
        }
    }
    @MainActor
    func refreshDecisionReviewHistoryAfterWrite(for symbol: SecuritySymbol) async {
        guard parsedSymbol?.canonical == symbol.canonical else {
            decisionReviewHistory = nil
            decisionReviewMessage = "复盘历史刷新已取消：当前标的已变化，旧复盘历史已清除。"
            return
        }
        let requestId = requestState.beginDecisionReviewHistoryLoad()
        decisionReviewHistory = nil
        decisionReviewMessage = "正在刷新复盘历史..."
        defer {
            requestState.finishDecisionReviewHistoryLoad(id: requestId)
        }

        do {
            let fetchedDecisionReviewHistory = try await client.fetchDecisionReviewHistory(market: symbol.market, code: symbol.code)
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId),
                  parsedSymbol?.canonical == symbol.canonical else { return }
            decisionReviewHistory = fetchedDecisionReviewHistory
            decisionReviewMessage = nil
        } catch ResearchClientError.httpStatus(400) {
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId),
                  parsedSymbol?.canonical == symbol.canonical else { return }
            decisionReviewHistory = nil
            decisionReviewMessage = "复盘历史刷新请求无效，已清除旧复盘状态。"
        } catch ResearchClientError.httpStatus(401) {
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId),
                  parsedSymbol?.canonical == symbol.canonical else { return }
            decisionReviewHistory = nil
            decisionReviewMessage = "复盘历史刷新未认证，已清除旧复盘状态。"
        } catch ResearchClientError.httpStatus(404) {
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId),
                  parsedSymbol?.canonical == symbol.canonical else { return }
            decisionReviewHistory = nil
            decisionReviewMessage = "复盘历史刷新目标不存在，已清除旧复盘状态。"
        } catch ResearchClientError.httpStatus(409) {
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId),
                  parsedSymbol?.canonical == symbol.canonical else { return }
            decisionReviewHistory = nil
            decisionReviewMessage = "复盘历史刷新冲突，已清除旧复盘状态。"
        } catch DecisionReviewValidationError.invalid {
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId),
                  parsedSymbol?.canonical == symbol.canonical else { return }
            decisionReviewHistory = nil
            decisionReviewMessage = "复盘历史刷新响应语义无效，已清除旧复盘状态。"
        } catch is DecodingError {
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId),
                  parsedSymbol?.canonical == symbol.canonical else { return }
            decisionReviewHistory = nil
            decisionReviewMessage = "复盘历史刷新响应格式无效，已清除旧复盘状态。"
        } catch is URLError {
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId),
                  parsedSymbol?.canonical == symbol.canonical else { return }
            decisionReviewHistory = nil
            decisionReviewMessage = "复盘历史刷新离线，已清除旧复盘状态。"
        } catch {
            guard requestState.isCurrentDecisionReviewHistoryLoad(requestId),
                  parsedSymbol?.canonical == symbol.canonical else { return }
            decisionReviewHistory = nil
            decisionReviewMessage = "复盘历史刷新不可用，已清除旧复盘状态：\(error.localizedDescription)"
        }
    }

    @MainActor
    func decide(suggestion: AiUpdateSuggestionData, action: SuggestionStatus) async {
        guard action == .accepted || action == .rejected else { return }
        let writeAuthorizationRevision = viewModel.authorizationRevision
        let briefMembership = selectedMembership
        invalidateAnnualDecisionBriefForUpstreamChange("建议状态正在变化；旧每日简报已清除。", membership: briefMembership)
        decisionInFlight = suggestion.id
        defer {
            if dailyClientAuthorizationIsCurrent(writeAuthorizationRevision), decisionInFlight == suggestion.id {
                decisionInFlight = nil
            }
        }

        do {
            let response = try await client.decideSuggestion(
                id: suggestion.id,
                action: action,
                note: nil
            )
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision) else { return }
            lastDecisionMessage = response.message
            await loadProfile()
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision) else { return }
            await reloadAnnualDecisionBriefIfStillBound(to: briefMembership)
        } catch {
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision) else { return }
            lastDecisionMessage = "建议操作失败：\(error.localizedDescription)"
        }
    }

    @MainActor
    func submitReview(for check: RecordedDecisionCheckReviewState, dailyTracking: Bool = false) async {
        guard let symbol = parsedSymbol else {
            lastReviewMessage = "输入无效，未发送复盘请求。"
            return
        }
        guard let reviewCheckBinding = makeReviewCheckBinding(for: check),
              currentReviewableCheck?.id == check.id else {
            lastReviewMessage = "复盘提交已失败闭合：actor、标的或冻结检查绑定已变化。"
            return
        }
        guard reviewInFlightCheckId == nil, !reviewSubmissionState.isInFlight else { return }
        let writeAuthorizationRevision = viewModel.authorizationRevision
        reviewInFlightCheckId = check.id
        defer {
            if dailyClientAuthorizationIsCurrent(writeAuthorizationRevision), reviewInFlightCheckId == check.id {
                reviewInFlightCheckId = nil
            }
        }
        let portfolioReviewBinding: PostDecisionPortfolioReviewBinding?
        do {
            portfolioReviewBinding = try await preparePortfolioReviewBinding(
                for: check,
                reviewCheckBinding: reviewCheckBinding,
                symbol: symbol,
                authorizationRevision: writeAuthorizationRevision
            )
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision) else { return }
        } catch GateBPortfolioReviewPreparationError.superseded {
            return
        } catch {
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision) else { return }
            applyPortfolioReviewPreparationFailure(error)
            return
        }
        let outcomeEvidence = reviewEvidence.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : reviewEvidence
        let note = reviewNote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : reviewNote
        let dailyTrackingBinding = dailyTracking ? dailyTrackingBindingForReview(check) : nil
        if dailyTracking, dailyTrackingBinding == nil {
            lastReviewMessage = "每日跟踪复盘已停止处理：当前报告绑定或状态已经变化。"
            return
        }
        let reviewLearning: AnnualReviewLearningRequest?
        do {
            reviewLearning = try annualReviewLearningRequest(for: check)
        } catch {
            lastReviewMessage = "请完整填写判断修正与流程教训，并核对当前人工判断或条件判断的来源身份。"
            return
        }
        let manualLearningMembership = reviewLearning?.kind == "ordinary_manual" ? selectedMembership : nil
        let fingerprint = DecisionReviewSubmissionFingerprint(
            checkId: check.id,
            outcome: reviewOutcome,
            outcomeEvidence: outcomeEvidence,
            reviewNote: note,
            reviewedAt: nil,
            portfolioReviewBinding: portfolioReviewBinding,
            reviewLearning: reviewLearning,
            dailyTrackingBinding: dailyTrackingBinding
        )
        guard let submission = reviewSubmissionState.begin(fingerprint: fingerprint) else {
            return
        }
        let request = CreatePostDecisionReviewRequest(
            outcome: reviewOutcome,
            outcomeEvidence: outcomeEvidence,
            reviewNote: note,
            reviewedAt: nil,
            portfolioReviewBinding: portfolioReviewBinding,
            reviewLearning: reviewLearning,
            dailyTrackingBinding: dailyTrackingBinding,
            idempotencyKey: submission.idempotencyKey
        )
        let briefMembership = selectedMembership
        invalidateAnnualDecisionBriefForUpstreamChange("复盘正在写入；旧每日简报已清除。", membership: briefMembership)
        do {
            let response = try await client.createPostDecisionReview(
                market: symbol.market,
                code: symbol.code,
                checkId: check.id,
                request: request
            )
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision) else {
                if reviewSubmissionState.finishAuthorizationChangeDiscarding(for: submission) {
                    reviewInFlightCheckId = nil
                }
                return
            }
            guard parsedSymbol?.canonical == symbol.canonical,
                  reviewCheckBindingIsCurrent(reviewCheckBinding, check: check),
                  response.source.actorId == reviewCheckBinding.actorId,
                  manualLearningMembership == nil || (
                    selectedMembership?.id == manualLearningMembership?.id
                    && selectedMembership?.version == manualLearningMembership?.version
                    && selectedMembership?.actorId == manualLearningMembership?.actorId
                  ) else {
                guard reviewSubmissionState.finishStaleSuccessPreservingRetry(for: submission) else {
                    return
                }
                submittedReview = nil
                decisionReviewHistory = nil
                decisionReviewMessage = "复盘响应已丢弃：当前 actor、标的或人工检查已变化，旧复盘历史已清除。"
                lastReviewMessage = "复盘响应已丢弃；不会展示旧成功、导航或重放 POST。"
                return
            }
            guard portfolioReviewBindingMatchesCurrentFacts(portfolioReviewBinding, check: check) else {
                guard reviewSubmissionState.finishStaleSuccessPreservingRetry(for: submission) else {
                    return
                }
                submittedReview = nil
                decisionReviewHistory = nil
                decisionReviewMessage = "复盘响应已丢弃：当前组合快照语义已变化，旧复盘历史已清除。"
                lastReviewMessage = "复盘响应已丢弃；不会展示旧成功、导航或重放 POST。"
                return
            }
            if dailyTracking {
                guard try await finishDailyTrackingReviewAfterWrite(
                    response: response, symbol: symbol, check: check,
                    checkBinding: reviewCheckBinding, reportBinding: dailyTrackingBinding,
                    submission: submission,
                    authorizationRevision: writeAuthorizationRevision
                ) else { return }
            } else {
                guard reviewSubmissionState.finishSuccessOrReplay(for: submission) else { return }
                lastReviewMessage = response.message
                submittedReview = response.data
                await refreshDecisionReviewHistoryAfterWrite(for: symbol)
                finishTodayReviewReturnIfNeeded(response.data, symbol: symbol, check: check, checkBinding: reviewCheckBinding, authorizationRevision: writeAuthorizationRevision)
            }
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision),
                  reviewCheckBindingIsCurrent(reviewCheckBinding, check: check) else { return }
            if let membership = briefMembership, let history = decisionReviewHistory,
               confirmsReview(history: history, response: response.data, checkBinding: reviewCheckBinding) {
                scheduleResearchArchiveAutomaticBackup(.review(response.data.id), membership: membership)
            }
            await reloadAnnualDecisionBriefIfStillBound(to: briefMembership)
        } catch {
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision) else { return }
            guard reviewSubmissionState.finishFailurePreservingRetry(for: submission) else { return }
            applyDecisionWriteFailure(error, operation: .postDecisionReview)
        }
    }

    @MainActor
    func applyDecisionWriteFailure(_ error: Error, operation: DecisionWriteOperation) {
        let failure = decisionWriteFailurePresentation(for: error, operation: operation)
        switch operation {
        case .humanCheck:
            clearSubmittedDecision()
            lastDecisionMessage = failure.message
        case .postDecisionReview:
            submittedReview = nil
            decisionReviewHistory = nil
            lastReviewMessage = failure.message
        }
    }

    @MainActor
    func clearSubmittedDecision() {
        submittedDecision = nil
        submittedDecisionSymbol = nil
        submittedReview = nil
    }

    func ordinaryManualReviewLearningApplies(_ check: RecordedDecisionCheckReviewState) -> Bool {
        guard let membership = selectedMembership, membership.state != .archived,
              membership.symbol == check.symbol,
              check.conditionalDecision?.availability != "preserved",
              check.researchReportDecision.availability != "preserved",
              currentReviewableCheck?.id == check.id else { return false }
        return true
    }

    private func annualReviewLearningRequest(
        for check: RecordedDecisionCheckReviewState
    ) throws -> AnnualReviewLearningRequest? {
        let conditional = check.conditionalDecision ?? .notCaptured
        let manual = ordinaryManualReviewLearningApplies(check)
        guard conditional.availability == "preserved" || manual else { return nil }
        let correction = reviewJudgmentCorrection.trimmingCharacters(in: .whitespacesAndNewlines)
        let lesson = reviewProcessLesson.trimmingCharacters(in: .whitespacesAndNewlines)
        let nextQuestion = reviewNextResearchQuestion.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !correction.isEmpty, !lesson.isEmpty else {
            throw AnnualReviewLearningValidationError.invalid(["review learning input or frozen identity is unavailable"])
        }
        if manual, let membership = selectedMembership {
            let request = AnnualReviewLearningRequest(
                manualDecisionCheckId: check.id,
                membershipId: membership.id,
                membershipVersion: membership.version,
                judgmentCorrection: correction,
                processLesson: lesson,
                nextResearchQuestion: nextQuestion.isEmpty ? nil : nextQuestion
            )
            try request.validate()
            return request
        }
        guard let decisionSnapshotId = check.decisionSnapshot.snapshot?.snapshotId,
              let conditionalPreviewId = conditional.preview?.previewId else {
            throw AnnualReviewLearningValidationError.invalid(["review learning frozen identity is unavailable"])
        }
        let request = AnnualReviewLearningRequest(
            decisionCheckId: check.id,
            decisionSnapshotId: decisionSnapshotId,
            conditionalPreviewId: conditionalPreviewId,
            judgmentCorrection: correction,
            processLesson: lesson,
            nextResearchQuestion: nextQuestion.isEmpty ? nil : nextQuestion
        )
        try request.validate()
        return request
    }

}
