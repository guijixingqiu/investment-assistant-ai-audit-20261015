import Foundation

extension GateBResearchScreen {
    var conditionalDecisionFactsAreBusy: Bool {
        isLoadingMobileWorkspace || isLoadingPortfolioContext || isLoadingPortfolioRisk
    }

    @MainActor
    func clearAnnualConditionalDecisionPreview(_ message: String, membershipId: String? = nil) {
        conditionalDecisionRequestId = UUID()
        isLoadingConditionalDecisionPreview = false
        conditionalDecisionPreview = .unavailable(
            message,
            membershipId: membershipId ?? selectedMembership?.id ?? "unselected",
            clientFailureState: "superseded"
        )
        conditionalDecisionMessage = message
        submissionState.resetForNewCheck()
    }

    @MainActor
    func loadAnnualConditionalDecisionPreview() async {
        guard !submissionState.isInFlight else {
            conditionalDecisionMessage = "条件判断仍在提交；当前未发起新的冻结预览请求。"
            return
        }
        guard let membership = selectedMembership,
              membership.state == .tracked,
              membership.symbol == parsedSymbol?.canonical,
              annualDecisionBriefModel.state == AnnualDecisionBriefReadinessState.readyForThreeMinuteReview.rawValue,
              let valuationData = valuationQuantEnvelope.data,
              valuationData.target.membershipId == membership.id,
              valuationData.target.membershipVersion == membership.version,
              let portfolioData = portfolioLabEnvelope.data,
              portfolioData.target.membershipId == membership.id,
              portfolioData.target.membershipVersion == membership.version,
              let amounts = parsedPortfolioLabAmounts,
              amounts.indices.contains(conditionalSelectedScenarioIndex) else {
            clearAnnualConditionalDecisionPreview("请先完成当前候选的三分钟简报、估值量化和组合实验室，再冻结事实预览。")
            return
        }
        let inputs: (AnnualValuationScenarioInput, AnnualQuantFilterInput)
        do { inputs = try valuationQuantDraft.parsed() }
        catch {
            clearAnnualConditionalDecisionPreview("用户估值或量化输入无效，未生成冻结预览。", membershipId: membership.id)
            return
        }
        let request = AnnualConditionalDecisionRequestGate(
            requestId: UUID(),
            membershipId: membership.id,
            membershipVersion: membership.version,
            symbol: membership.symbol,
            valuation: inputs.0,
            quantFilter: inputs.1,
            scenarioAmounts: amounts,
            selectedScenarioIndex: conditionalSelectedScenarioIndex
        )
        conditionalDecisionRequestId = request.requestId
        isLoadingConditionalDecisionPreview = true
        conditionalDecisionMessage = "正在由服务端重读候选、简报、估值量化、Pingan 组合和选中风险情景..."
        conditionalDecisionPreview = .unavailable("冻结预览读取中。", membershipId: membership.id, clientFailureState: "loading")
        let preview = await conditionalDecisionClient.fetchConditionalDecisionPreview(
            membershipId: membership.id,
            membershipVersion: membership.version,
            symbol: membership.symbol,
            valuation: inputs.0,
            quantFilter: inputs.1,
            scenarioAmounts: amounts,
            selectedScenarioIndex: request.selectedScenarioIndex
        )
        let currentInputs = try? valuationQuantDraft.parsed()
        let disposition = request.disposition(
            currentRequestId: conditionalDecisionRequestId,
            membershipId: selectedMembership?.id,
            membershipVersion: selectedMembership?.version,
            symbol: selectedMembership?.symbol == parsedSymbol?.canonical ? selectedMembership?.symbol : nil,
            valuation: currentInputs?.0,
            quantFilter: currentInputs?.1,
            scenarioAmounts: parsedPortfolioLabAmounts,
            selectedScenarioIndex: conditionalSelectedScenarioIndex
        )
        guard disposition != .staleRequest else { return }
        isLoadingConditionalDecisionPreview = false
        guard disposition == .current else {
            clearAnnualConditionalDecisionPreview("候选、版本或用户输入已变化；旧冻结预览已丢弃。", membershipId: membership.id)
            return
        }
        bindConditionalDecisionDraft(to: preview)
        conditionalDecisionPreview = preview
        conditionalDecisionMessage = preview.status == "available" ? "冻结预览已就绪；请逐项确认后记录人工判断。" : preview.message
    }

    func annualConditionalJudgment() throws -> AnnualConditionalJudgment {
        guard conditionalDecisionDraftSource == AnnualConditionalDecisionDraftSource(
            preview: conditionalDecisionPreview
        ) else {
            throw AnnualConditionalDecisionValidationError.invalid([
                "conditional judgment draft is not bound to the current frozen preview"
            ])
        }
        let thresholdText = conditionalPortfolioThresholdPercent.trimmingCharacters(in: .whitespacesAndNewlines)
        let rationale = conditionalPortfolioRationale.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let thresholdPercent = Double(thresholdText), thresholdPercent.isFinite,
              (0...100).contains(thresholdPercent), !rationale.isEmpty else {
            throw AnnualConditionalDecisionValidationError.invalid([
                "conditional portfolio observation threshold and rationale are required"
            ])
        }
        let judgment = AnnualConditionalJudgment(
            confidence: conditionalConfidence,
            assumptions: conditionalLines(conditionalAssumptions),
            invalidationConditions: conditionalLines(conditionalInvalidationConditions),
            portfolioObservationConditions: [
                .init(
                    metric: conditionalPortfolioMetric,
                    comparison: conditionalPortfolioComparison,
                    threshold: thresholdPercent / 100,
                    rationale: rationale
                )
            ],
            observationWindow: AnnualConditionalObservationWindow(
                startsOn: conditionalDate(conditionalObservationStart),
                endsOn: conditionalDate(conditionalObservationEnd)
            ),
            reviewOn: conditionalDate(conditionalReviewDate),
            workflowState: conditionalWorkflowState
        )
        try judgment.validate()
        return judgment
    }

    @MainActor
    private func bindConditionalDecisionDraft(
        to preview: AnnualConditionalDecisionPreviewEnvelope
    ) {
        guard let source = AnnualConditionalDecisionDraftSource(preview: preview),
              source != conditionalDecisionDraftSource else { return }
        conditionalDecisionDraftSource = source
        conditionalConfidence = .medium
        conditionalAssumptions = ""
        conditionalInvalidationConditions = ""
        conditionalPortfolioMetric = .scenarioCandidateWeight
        conditionalPortfolioComparison = .atOrAbove
        conditionalPortfolioThresholdPercent = ""
        conditionalPortfolioRationale = ""
        let now = Date()
        conditionalObservationStart = now
        conditionalObservationEnd = Calendar.current.date(byAdding: .day, value: 90, to: now) ?? now
        conditionalReviewDate = Calendar.current.date(byAdding: .day, value: 30, to: now) ?? now
        conditionalWorkflowState = .continueResearch
        userFinalDecision = "继续观察，不自动生成交易。"
    }

    @MainActor
    func submitHumanCheck() async {
        guard !conditionalDecisionFactsAreBusy, !submissionState.isInFlight else {
            lastDecisionMessage = "候选、简报、估值量化、组合、风险或冻结预览仍在读取；当前请求未发送。"
            return
        }
        guard let symbol = parsedSymbol,
              let membership = selectedMembership,
              membership.symbol == symbol.canonical,
              conditionalDecisionPreview.status == "available",
              let previewData = conditionalDecisionPreview.data,
              let previewSource = previewData.decisionBrief.data?.sourceIdentity,
              let context = decisionContext,
              context.research.status == "available",
              context.contextId == previewSource.decisionContextId,
              context.contextHash == previewSource.decisionContextHash else {
            lastDecisionMessage = "冻结预览或当前决策上下文不可用；请重新读取事实后再提交。"
            return
        }
        let judgment: AnnualConditionalJudgment
        let snapshotBinding: DecisionSnapshotBinding
        do {
            judgment = try annualConditionalJudgment()
            snapshotBinding = try previewData.decisionSnapshotBinding()
        } catch {
            lastDecisionMessage = "请完整填写假设、失效条件、组合人工复核阈值、观察窗口和复核日期；当前请求未发送。"
            return
        }
        let conditional = AnnualConditionalDecisionSubmission(preview: conditionalDecisionPreview, judgment: judgment)
        let finalDecision = userFinalDecision.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : userFinalDecision
        let fingerprint = DecisionCheckSubmissionFingerprint(
            contextId: context.contextId,
            contextHash: context.contextHash,
            decisionSnapshotBinding: snapshotBinding,
            conditionalDecision: conditional,
            actionIntent: DecisionActionIntent.watch.rawValue,
            humanCheckResult: judgment.workflowState.humanCheckResult,
            userFinalDecision: finalDecision
        )
        guard let pending = submissionState.begin(fingerprint: fingerprint) else { return }
        guard let pendingBinding = pending.fingerprint.decisionSnapshotBinding,
              let pendingConditional = pending.fingerprint.conditionalDecision else {
            submissionState.finishSuccessOrReplay()
            lastDecisionMessage = "条件判断请求身份无效；当前请求未发送。"
            return
        }
        let confirmedMembership = membership
        let confirmedPreviewId = pendingConditional.preview.previewId
        let briefMembership = selectedMembership
        let writeAuthorizationRevision = viewModel.authorizationRevision

        do {
            let decision = try await client.createDecisionCheck(
                market: symbol.market,
                code: symbol.code,
                request: CreateDecisionCheckRequest(
                    decisionContextSchemaVersion: context.schemaVersion,
                    contextId: pending.fingerprint.contextId,
                    contextHash: pending.fingerprint.contextHash,
                    actionIntent: pending.fingerprint.actionIntent,
                    humanCheckResult: pending.fingerprint.humanCheckResult,
                    userFinalDecision: pending.fingerprint.userFinalDecision,
                    reviewedAt: nil,
                    decisionSnapshotBinding: pendingBinding,
                    conditionalDecision: pendingConditional,
                    idempotencyKey: pending.idempotencyKey
                )
            )
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision) else {
                _ = submissionState.finishFailurePreservingRetry(for: pending)
                return
            }
            let currentFingerprint = currentConditionalDecisionFingerprint()
            let responseIsCurrent = !conditionalDecisionFactsAreBusy
                && submissionState.isCurrent(pending)
                && currentFingerprint == pending.fingerprint
            let accepted = submissionState.finishSuccessOrReplay(for: pending)
            guard responseIsCurrent, accepted,
                  selectedMembership?.id == confirmedMembership.id,
                  selectedMembership?.version == confirmedMembership.version,
                  parsedSymbol?.canonical == symbol.canonical,
                  decision.data.conditionalDecision?.preview?.previewId == confirmedPreviewId else {
                guard submissionState.isLatest(pending) else { return }
                clearSubmittedDecision()
                decisionReviewHistory = nil
                decisionReviewMessage = "条件判断已提交；当前候选或事实已变化，旧复盘显示已清除。"
                lastDecisionMessage = "条件判断已提交，但当前事实已变化；请重新读取当前候选。"
                return
            }
            invalidateAnnualDecisionBriefForUpstreamChange(
                "条件判断已记录；正在重读当前候选的简报与后续事实。",
                membership: briefMembership
            )
            lastDecisionMessage = decision.message
            submittedDecision = decision.data
            submittedDecisionSymbol = symbol.canonical
            await refreshDecisionReviewHistoryAfterWrite(for: symbol)
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision) else { return }
            await reloadAnnualDecisionBriefIfStillBound(to: briefMembership)
        } catch {
            guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision) else {
                _ = submissionState.finishFailurePreservingRetry(for: pending)
                return
            }
            guard submissionState.finishFailurePreservingRetry(for: pending) else { return }
            applyDecisionWriteFailure(error, operation: .humanCheck)
        }
    }

    private func currentConditionalDecisionFingerprint() -> DecisionCheckSubmissionFingerprint? {
        guard !conditionalDecisionFactsAreBusy,
              let context = decisionContext,
              conditionalDecisionPreview.status == "available",
              let previewData = conditionalDecisionPreview.data,
              let source = previewData.decisionBrief.data?.sourceIdentity,
              context.contextId == source.decisionContextId,
              context.contextHash == source.decisionContextHash,
              let judgment = try? annualConditionalJudgment(),
              let binding = try? previewData.decisionSnapshotBinding() else { return nil }
        let finalDecision = userFinalDecision.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? nil
            : userFinalDecision
        return DecisionCheckSubmissionFingerprint(
            contextId: context.contextId,
            contextHash: context.contextHash,
            decisionSnapshotBinding: binding,
            conditionalDecision: AnnualConditionalDecisionSubmission(
                preview: conditionalDecisionPreview,
                judgment: judgment
            ),
            actionIntent: DecisionActionIntent.watch.rawValue,
            humanCheckResult: judgment.workflowState.humanCheckResult,
            userFinalDecision: finalDecision
        )
    }

    private func conditionalLines(_ value: String) -> [String] {
        var seen = Set<String>()
        return value.split(whereSeparator: \Character.isNewline).compactMap { raw in
            let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty, seen.insert(line).inserted else { return nil }
            return line
        }
    }

    private func conditionalDate(_ value: Date) -> String {
        annualConditionalCalendarDate(value)
    }
}
