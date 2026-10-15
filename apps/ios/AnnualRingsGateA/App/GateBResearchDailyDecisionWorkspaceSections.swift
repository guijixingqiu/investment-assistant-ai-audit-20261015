import SwiftUI

extension GateBResearchScreen {
    var selectedMembershipResearchReports: [TwoLayerReportData] {
        guard let membership = selectedMembership else { return [] }
        return twoLayerReportWorkspace.envelope?.data?.reports.filter { report in
            guard let binding = report.payload.evidencePackBinding else { return false }
            return binding.membershipId == membership.id
                && binding.symbol == membership.symbol
        } ?? []
    }

    var researchInvestmentBriefReport: TwoLayerReportData? {
        if let currentDeepResearchReport { return currentDeepResearchReport }
        guard selectedMembership != nil else { return nil }
        return selectedMembershipResearchReports
            .filter {
                $0.payload.adviceLayer != nil
                    && $0.payload.researchLayer != nil
            }
            .max { $0.version < $1.version }
    }

    var researchInvestmentBriefCurrentReport: TwoLayerReportData? {
        guard let report = researchInvestmentBriefReport,
              !researchBriefReportIsStale(report) else { return nil }
        return report
    }

    var dailyDecisionNextStep: DailyDecisionNextStep {
        if parsedSymbol == nil {
            return DailyDecisionNextStep(
                layer: .candidate,
                title: "先选择有效的香港候选",
                detail: "修正或选择候选后，再依次查看证据、当前组合风险、人工决策和复盘。",
                expandsResult: false
            )
        }
        if selectedMembership == nil {
            return DailyDecisionNextStep(
                layer: .candidate,
                title: "先把 \(parsedSymbol?.canonical ?? "当前标的") 加入研究",
                detail: "当前标的还没有绑定到你的研究身份；加入后才能沿用同一份材料、证据包和报告历史。",
                expandsResult: true,
                buttonTitle: "管理研究自选"
            )
        }
        if let report = researchInvestmentBriefCurrentReport,
           currentDeepResearchDecision?.decision != "confirmed" {
            if currentDeepResearchDecision?.decision == "rejected" {
                return DailyDecisionNextStep(
                    layer: .evidence,
                    title: "修订已驳回的研究报告",
                    detail: "回看你的驳回结果，补充或修正证据后再生成新版本。",
                    expandsResult: false,
                    evidenceWorkspace: .brief,
                    scrollTarget: twoLayerReportFormalDecisionAnchor(report.id),
                    buttonTitle: "查看报告"
                )
            }
            if report.isFormalizable,
               researchContextWorkspace.completeness?.data?.canFormalize != true {
                return DailyDecisionNextStep(
                    layer: .evidence,
                    title: "补齐并记录研究覆盖",
                    detail: "报告正文已完成，但财务、KPI、行业同业、双估值、Weinstein 或总覆盖仍未达到确认门槛；先查看 exact 缺口，缺失保持 UNKNOWN。",
                    expandsResult: false,
                    evidenceWorkspace: .facts,
                    scrollTarget: "researchContextCompletionSection",
                    buttonTitle: "查看覆盖缺口"
                )
            }
            return DailyDecisionNextStep(
                layer: .evidence,
                title: report.isFormalizable ? "审阅当前深度研究" : "补全当前深度研究",
                detail: report.isFormalizable
                    ? "先看结论、失效条件和反证，再决定追问、吸收到研究档案或明确确认报告。"
                    : "当前报告仍有缺失项；先补充证据，再修订报告。",
                expandsResult: false,
                evidenceWorkspace: .brief,
                scrollTarget: twoLayerReportFormalDecisionAnchor(report.id),
                buttonTitle: report.isFormalizable ? "审阅报告" : "查看缺口"
            )
        }
        if let step = confirmedReportDailyNextStep ?? researchOnboardingDailyNextStep { return step }
        if let step = frozenEvidenceDailyNextStep { return step }
        if envelope.data == nil || decisionContext == nil {
            return DailyDecisionNextStep(
                layer: .evidence,
                title: "核对候选证据",
                detail: "查看支持、反对与缺失证据；不可用或陈旧事实不会被当作当前事实。",
                expandsResult: false
            )
        }
        if researchInvestmentBriefCurrentReport == nil,
           selectedMembership != nil,
           annualDecisionBriefModel.state != AnnualDecisionBriefReadinessState.readyForThreeMinuteReview.rawValue {
            return DailyDecisionNextStep(
                layer: .evidence,
                title: annualDecisionBriefModel.title,
                detail: annualDecisionBriefModel.message,
                expandsResult: false
            )
        }
        if portfolioContext?.status == .available,
           selectedMembership != nil,
           portfolioLabEnvelope.data == nil {
            return DailyDecisionNextStep(
                layer: .portfolio,
                title: "核对当前组合与风险边界",
                detail: "确认平安持仓、Futu 行情与候选版本，再用自填金额并列查看边际影响；缺失量化覆盖会显示为缺口。",
                expandsResult: false
            )
        }
        if !hasCurrentDecision {
            return DailyDecisionNextStep(
                layer: .decision,
                title: "记录人工判断",
                detail: "证据和风险只辅助判断；最终结论由人填写，不生成方向、金额或交易动作。",
                expandsResult: false
            )
        }
        if currentSubmittedReview == nil {
            return DailyDecisionNextStep(
                layer: .review,
                title: "完成后续复盘",
                detail: "回看当时事实、记录证据变化，并把本地想法与官方复盘事实保持分离。",
                expandsResult: false
            )
        }
        return DailyDecisionNextStep(
            layer: .review,
            title: "回看已完成复盘",
            detail: "复盘反馈只帮助修正判断，不改变候选顺序、组合事实或任何交易状态。",
            expandsResult: false
        )
    }

    func showDailyDecisionLayer(_ layer: DailyDecisionRingLayer, expandResult: Bool = false) {
        let wasSelected = selectedDecisionLayer == layer
        selectedDecisionLayer = layer
        isResearchEvidenceRecordsExpanded = true
        pendingDecisionWorkspaceScrollTarget = "dailyWorkbenchTop"
        if layer == .decision, wasSelected, hasCurrentDecision {
            selectedHumanDecisionWorkspace = .snapshot
        }
        if layer == .review, hasCurrentDecision {
            selectedReviewWorkspace = currentSubmittedReview == nil ? .timeline : .learning
        }
        guard expandResult else { return }
        switch layer {
        case .candidate:
            isCandidateManagementExpanded = true
            selectedCandidateWorkspace = .lifecycle
        case .decision:
            isDecisionBoundaryExpanded = true
            selectedHumanDecisionWorkspace = .boundaries
        case .review:
            isLocalReviewRecordsExpanded = true
            selectedReviewWorkspace = .local
        case .evidence, .portfolio:
            break
        }
    }

    func dailyDecisionLayerContent() -> AnyView {
        switch selectedDecisionLayer {
        case .candidate:
            AnyView(candidateLayerContent())
        case .evidence:
            AnyView(evidenceLayerContent())
        case .portfolio:
            AnyView(portfolioDecisionLayerContent())
        case .decision:
            AnyView(humanDecisionLayerContent())
        case .review:
            AnyView(reviewLayerContent())
        }
    }

    @ViewBuilder
    private func candidateLayerContent() -> some View {
        dailyWorkspacePicker(
            DailyCandidateWorkspace.allCases.map {
                DailyWorkspaceOption(id: $0.rawValue, title: $0.title, detail: $0.detail, systemImage: $0.systemImage)
            },
            selectedID: selectedCandidateWorkspace.rawValue,
            tint: DailyDecisionRingLayer.candidate.tint,
            accessibilityPrefix: "dailyCandidateWorkspace"
        ) { rawValue in
            guard let workspace = DailyCandidateWorkspace(rawValue: rawValue) else { return }
            selectedCandidateWorkspace = workspace
        }
        if dynamicTypeSize.isAccessibilitySize, selectedCandidateWorkspace == .overview {
            Button {
                selectedCandidateWorkspace = .lifecycle
            } label: {
                Label("打开生命周期管理", systemImage: "arrow.right.circle")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("dailyCandidateLifecycleOpen")
        }
        if selectedCandidateWorkspace == .lifecycle {
            candidateMembershipLocateCurrentButton()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        switch selectedCandidateWorkspace {
        case .overview:
            candidateOverviewSection()
        case .lifecycle:
            if focusesCurrentMembership, let currentMembership = currentCandidateMembership() {
                candidateMembershipRow(currentMembership)
            } else if focusesCurrentMembership {
                ContentUnavailableView(
                    "当前标的不在研究自选中",
                    systemImage: "scope",
                    description: Text("显示全部后可继续管理其他研究自选。")
                )
                .accessibilityIdentifier("candidateMembershipFocusedUnavailable")
            } else {
                candidateMembershipSection()
            }
        }
    }

    @ViewBuilder
    private func humanDecisionLayerContent() -> some View {
        dailyWorkspacePicker(
            DailyHumanDecisionWorkspace.allCases.map {
                DailyWorkspaceOption(id: $0.rawValue, title: $0.title, detail: $0.detail, systemImage: $0.systemImage)
            },
            selectedID: selectedHumanDecisionWorkspace.rawValue,
            tint: DailyDecisionRingLayer.decision.tint,
            accessibilityPrefix: "dailyHumanDecisionWorkspace"
        ) { rawValue in
            guard let workspace = DailyHumanDecisionWorkspace(rawValue: rawValue) else { return }
            selectedHumanDecisionWorkspace = workspace
        }
        switch selectedHumanDecisionWorkspace {
        case .conditions:
            sessionDraftFormalDecisionSection()
            conditionalDecisionSection()
            if let lastDecisionMessage {
                Text(lastDecisionMessage)
                    .font(OwnerReadingFont.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("researchDecisionMessage")
            }
            Button {
                Task { await submitHumanCheck() }
            } label: {
                Label(submissionState.isInFlight ? "提交中" : "记录条件判断", systemImage: "person.crop.circle.badge.checkmark")
            }
            .buttonStyle(.borderedProminent)
            .disabled(isLoading || isLoadingDecisionReviewHistory || isLoadingPortfolioContext || isLoadingPortfolioRisk || isLoadingPortfolioLab || !canSubmitConditionalDecision)
            .accessibilityIdentifier("submitHumanCheckButton")
        case .snapshot:
            if let submittedDecision = currentSubmittedDecision {
                submittedDecisionSection(submittedDecision)
                conditionalDecisionStateSection(submittedDecision.conditionalDecision)
            } else if let historyDecision = currentHistoryDecision {
                submittedDecisionSection(historyDecision)
                conditionalDecisionStateSection(historyDecision.conditionalDecision)
            } else {
                ContentUnavailableView(
                    "尚无决策快照",
                    systemImage: "lock.doc",
                    description: Text("完成条件判断后，这里显示不可变决策时事实。")
                )
                .accessibilityIdentifier("dailyDecisionSnapshotUnavailable")
            }
        case .boundaries:
            assistAdvisoryScopeSection()
            assistHumanReviewWorkspaceSection()
        }
    }

    @ViewBuilder
    private func reviewLayerContent() -> some View {
        dailyWorkspacePicker(
            DailyReviewWorkspace.allCases.map {
                DailyWorkspaceOption(id: $0.rawValue, title: $0.title, detail: $0.detail, systemImage: $0.systemImage)
            },
            selectedID: selectedReviewWorkspace.rawValue,
            tint: DailyDecisionRingLayer.review.tint,
            accessibilityPrefix: "dailyReviewWorkspace"
        ) { rawValue in
            guard let workspace = DailyReviewWorkspace(rawValue: rawValue) else { return }
            selectedReviewWorkspace = workspace
        }
        switch selectedReviewWorkspace {
        case .learning:
            reviewFeedbackCard(currentDailyReviewFeedback())
            if let decisionReviewHistory {
                annualReviewLearningSummarySection(decisionReviewHistory)
            } else if let decisionReviewMessage {
                Text(decisionReviewMessage)
                    .font(OwnerReadingFont.callout)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("decisionReviewMessage")
            }
        case .timeline:
            todayDailyTrackingContextSection()
            crossStockDecisionReviewHistorySection()
            priorJudgmentPendingRecoverySection()
            if let decisionReviewHistory {
                let timelineIdentity = decisionReviewTimelineIdentity(decisionReviewHistory)
                decisionReviewHistorySection(decisionReviewHistory)
                    .id("decision-review-timeline:\(timelineIdentity)")
                    .onAppear {
                        renderedDecisionReviewTimelineIdentity = timelineIdentity
                    }
                    .onDisappear {
                        if renderedDecisionReviewTimelineIdentity == timelineIdentity {
                            renderedDecisionReviewTimelineIdentity = nil
                        }
                    }
            } else if let decisionReviewMessage {
                Text(decisionReviewMessage)
                    .font(OwnerReadingFont.callout)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("decisionReviewMessage")
            }
        case .followUp:
            assistReviewFollowUpWorkflowSection()
            assistDecisionNoteWorkflowSection()
        case .local:
            focusedLocalReviewRecordsSection()
        }
    }

    func decisionReviewTimelineIdentity(
        _ history: DecisionReviewHistoryEnvelope
    ) -> DecisionReviewTimelineIdentity {
        DecisionReviewTimelineIdentity(
            requestedSymbol: history.requestedSymbol,
            checks: history.checks.map { check in
                .init(id: check.id, reviewIds: check.reviews.map(\.id))
            },
            reviewFormCheckId: currentReviewableCheck?.id
        )
    }

    private func currentDailyReviewFeedback() -> ReviewFeedbackCard {
        let state = CoreJourneyState.derive(
            symbol: parsedSymbol?.canonical ?? "无效输入",
            isLoading: isLoading || isLoadingDecisionReviewHistory,
            malformedInputMessage: malformedInputMessage,
            researchEnvelope: envelope,
            decisionContext: decisionContext,
            decisionContextMessage: decisionContextMessage,
            pinganSnapshot: pinganSnapshot,
            pinganSnapshotMessage: pinganSnapshotMessage,
            submittedDecision: currentSubmittedDecision,
            decisionReviewHistory: decisionReviewHistory,
            decisionReviewMessage: decisionReviewMessage
        )
        return ReviewFeedbackCard.derive(
            state: state,
            currentDecisionContext: decisionContext,
            submittedDecision: currentSubmittedDecision,
            submittedReview: currentSubmittedReview,
            reviewHistory: decisionReviewHistory,
            pinganSnapshot: pinganSnapshot
        )
    }
}
