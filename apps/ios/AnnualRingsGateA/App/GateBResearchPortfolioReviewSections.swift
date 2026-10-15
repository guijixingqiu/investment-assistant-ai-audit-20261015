import SwiftUI

extension GateBResearchScreen {
    func postDecisionPortfolioReviewSections(
        _ review: PostDecisionReviewData,
        decisionCheckId: String,
        reportBinding: ResearchReportDecisionBinding?,
        decisionSnapshot: DecisionSnapshotState
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\(review.symbol) · 复盘 #\(review.id)")
                .font(.caption2.monospaced())
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("decisionReviewSourceTarget-\(review.id)")
            if let reportBinding, reportBinding.symbol == review.symbol {
                Text("对应判断 #\(decisionCheckId) · 报告 #\(reportBinding.reportId) v\(reportBinding.reportVersion) · 报告确认 #\(reportBinding.reportDecisionId)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("decisionReviewReportIdentity")
            } else {
                Text("对应判断 #\(decisionCheckId) · 报告身份 UNKNOWN")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("decisionReviewReportIdentity")
            }
            humanReviewConclusionSection(review)
            Divider()
            annualReviewLearningSection(review)
            Divider()
            decisionTimePortfolioReviewSection(review.portfolioReview, decisionSnapshot: decisionSnapshot)
            Divider()
            reviewTimePortfolioReviewSection(review.portfolioReview)
            Divider()
            neutralPortfolioComparisonSection(review.portfolioReview)
        }
        .accessibilityElement(children: .contain)
    }

    private func humanReviewConclusionSection(_ review: PostDecisionReviewData) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("人工复盘结论")
                .font(.caption.weight(.semibold))
                .accessibilityIdentifier("decisionReviewHumanConclusionTitle")
            InfoBlock(title: "复盘结果", value: reviewOutcomeLabel(review.outcome), valueIdentifier: "decisionReviewOutcome")
            InfoBlock(title: "复盘证据", value: review.outcomeEvidence ?? "未填写", valueIdentifier: "decisionReviewEvidence")
            InfoBlock(title: "复盘备注", value: review.reviewNote ?? "未填写", valueIdentifier: "decisionReviewNote")
            InfoBlock(title: "复盘时间", value: compactUtcDateTime(review.reviewedAt), valueIdentifier: "decisionReviewReviewedAt")
        }
    }

    @ViewBuilder
    private func decisionTimePortfolioReviewSection(
        _ state: PostDecisionPortfolioReviewState,
        decisionSnapshot: DecisionSnapshotState
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("决策时组合")
                .font(.caption.weight(.semibold))
                .accessibilityIdentifier("decisionTimePortfolioReviewTitle")
            if let snapshot = state.snapshot, state.availability == .preserved {
                InfoBlock(
                    title: "决策快照",
                    value: "\(snapshot.decisionSnapshotId) / \(decisionSnapshot.availability.rawValue)",
                    valueIdentifier: "decisionTimePortfolioDecisionSnapshotId"
                )
                portfolioReviewFactReference(snapshot.comparison.decisionTime, prefix: "decisionTimePortfolio")
            } else {
                portfolioReviewNotCaptured(state, valueIdentifier: "decisionTimePortfolioNotCaptured")
            }
        }
    }

    @ViewBuilder
    private func reviewTimePortfolioReviewSection(_ state: PostDecisionPortfolioReviewState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("复盘时组合")
                .font(.caption.weight(.semibold))
                .accessibilityIdentifier("reviewTimePortfolioReviewTitle")
            if let snapshot = state.snapshot, state.availability == .preserved {
                let facts = snapshot.reviewTimePortfolio
                portfolioReviewFactReference(snapshot.comparison.reviewTime, prefix: "reviewTimePortfolio")
                InfoBlock(
                    title: "持仓数量",
                    value: "\(facts.envelope.summary.positionCount)",
                    valueIdentifier: "reviewTimePortfolioPositionCount"
                )
                InfoBlock(
                    title: "组合总敞口",
                    value: formatOptionalNumber(facts.envelope.summary.marketValue.amount),
                    valueIdentifier: "reviewTimePortfolioExposure"
                )
                InfoBlock(title: "读取边界", value: facts.limitation, valueIdentifier: "reviewTimePortfolioLimitation")
            } else {
                portfolioReviewNotCaptured(state, valueIdentifier: "reviewTimePortfolioNotCaptured")
            }
        }
    }

    @ViewBuilder
    private func neutralPortfolioComparisonSection(_ state: PostDecisionPortfolioReviewState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("中性组合差异")
                .font(.caption.weight(.semibold))
                .accessibilityIdentifier("neutralPortfolioComparisonTitle")
            if let snapshot = state.snapshot, state.availability == .preserved {
                let comparison = snapshot.comparison
                InfoBlock(title: "比较状态", value: comparison.status.rawValue, valueIdentifier: "neutralPortfolioComparisonStatus")
                InfoBlock(title: "比较标识", value: comparison.comparisonId, valueIdentifier: "neutralPortfolioComparisonId")
                ForEach(PostDecisionPortfolioMetricKey.allCases, id: \.rawValue) { key in
                    InfoBlock(
                        title: portfolioReviewMetricLabel(key),
                        value: portfolioReviewMetricText(comparison.metrics[key]),
                        valueIdentifier: "neutralPortfolioMetric-\(key.rawValue)"
                    )
                }
                InfoBlock(
                    title: "现金差异",
                    value: "unknown：not_provided_by_authoritative_snapshot",
                    valueIdentifier: "neutralPortfolioCashUnknown"
                )
                if !comparison.gaps.isEmpty {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("事实缺口").font(.caption2.weight(.semibold))
                        ForEach(Array(comparison.gaps.enumerated()), id: \.offset) { _, gap in
                            Text(gap)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .accessibilityIdentifier("neutralPortfolioComparisonGaps")
                }
                InfoBlock(title: "复盘边界", value: state.limitation, valueIdentifier: "neutralPortfolioComparisonLimitation")
            } else {
                portfolioReviewNotCaptured(state, valueIdentifier: "neutralPortfolioComparisonNotCaptured")
            }
        }
    }

    private func portfolioReviewFactReference(
        _ reference: PostDecisionPortfolioFactReference,
        prefix: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            InfoBlock(title: "事实状态", value: reference.state.rawValue, valueIdentifier: "\(prefix)State")
            InfoBlock(title: "上下文标识", value: reference.contextId ?? "unavailable", valueIdentifier: "\(prefix)ContextId")
            InfoBlock(title: "组合快照", value: reference.portfolioSnapshotId ?? "unavailable", valueIdentifier: "\(prefix)SnapshotId")
            InfoBlock(title: "账户范围", value: reference.accountScopeId ?? "unavailable", valueIdentifier: "\(prefix)AccountScopeId")
            InfoBlock(title: "事实时点", value: reference.portfolioAsOf ?? "unavailable", valueIdentifier: "\(prefix)AsOf")
            InfoBlock(title: "组装时间", value: reference.assembledAt, valueIdentifier: "\(prefix)AssembledAt")
        }
    }

    private func portfolioReviewNotCaptured(
        _ state: PostDecisionPortfolioReviewState,
        valueIdentifier: String
    ) -> some View {
        InfoBlock(
            title: "捕获状态",
            value: "当时未保存组合快照；不会用当前或后来的持仓、行情或交易事实补写。",
            valueIdentifier: valueIdentifier
        )
    }

    private func portfolioReviewMetricText(_ metric: PostDecisionPortfolioNeutralDeltaMetric) -> String {
        guard metric.availability == .comparable,
              let decisionTime = metric.decisionTime,
              let reviewTime = metric.reviewTime,
              let delta = metric.delta else {
            return "unavailable"
        }
        return "决策 \(formatNumber(decisionTime)) / 复盘 \(formatNumber(reviewTime)) / 差异 \(formatNumber(delta))"
    }

    private func portfolioReviewMetricLabel(_ key: PostDecisionPortfolioMetricKey) -> String {
        switch key {
        case .candidateQuantity: "候选数量"
        case .candidateExposure: "候选敞口"
        case .candidateWeight: "候选权重"
        case .positionCount: "持仓数"
        case .totalExposure: "总敞口"
        case .missingQuoteCount: "缺失报价数"
        case .nonCurrentQuoteCount: "非当前报价数"
        case .largestPositionWeight: "最大持仓权重"
        case .topThreeWeight: "前三持仓权重"
        case .hhi: "HHI"
        }
    }
}

extension GateBResearchScreen {
    @ViewBuilder
    func annualReviewLearningSection(_ review: PostDecisionReviewData) -> some View {
        let state = review.reviewLearning
        VStack(alignment: .leading, spacing: 6) {
            Text("判断修正与流程学习")
                .font(.caption.weight(.semibold))
                .accessibilityIdentifier("reviewLearningTitle")
            if state.availability == "ordinary_manual_preserved", let snapshot = state.snapshot {
                InfoBlock(title: "人工来源", value: "check=\(snapshot.decisionCheckId) / membership=\(snapshot.membershipId ?? "UNKNOWN") v\(snapshot.membershipVersion ?? 0)", valueIdentifier: "reviewLearningManualIdentity")
                InfoBlock(title: "判断修正", value: snapshot.judgmentCorrection, valueIdentifier: "reviewLearningJudgmentCorrection")
                InfoBlock(title: "流程教训", value: snapshot.processLesson, valueIdentifier: "reviewLearningProcessLesson")
                InfoBlock(title: "下一研究问题", value: snapshot.nextResearchQuestion ?? "未填写", valueIdentifier: "reviewLearningNextQuestion")
                Text("这是人工撰写的复盘材料，不作为已验证财务证据。")
                    .font(.caption2).foregroundStyle(.secondary)
                if let handoff = currentResearchReviewQuestionHandoff(review) {
                    Button {
                        beginResearchReviewQuestionHandoff(handoff)
                    } label: {
                        Label(handoff.question.isEmpty ? "打开空白研究草稿" : "带到当前研究草稿",
                              systemImage: "square.and.pencil")
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("reviewLearningQuestionToManualResearch-\(review.id)")
                }
                InfoBlock(title: "学习边界", value: state.limitation, valueIdentifier: "reviewLearningLimitation")
            } else if state.availability == "preserved", let snapshot = state.snapshot,
                      let monitor = snapshot.monitor {
                InfoBlock(
                    title: "冻结判断",
                    value: "check=\(snapshot.decisionCheckId) / decision=\(snapshot.decisionSnapshotId ?? "UNKNOWN") / conditional=\(snapshot.conditionalPreviewId ?? "UNKNOWN")",
                    valueIdentifier: "reviewLearningFrozenIdentity"
                )
                InfoBlock(title: "后来事实时间", value: snapshot.reviewedFactsAt ?? "UNKNOWN", valueIdentifier: "reviewLearningFactsAt")
                InfoBlock(title: "事实复核状态", value: monitor.state, valueIdentifier: "reviewLearningMonitorState")
                InfoBlock(title: "判断修正", value: snapshot.judgmentCorrection, valueIdentifier: "reviewLearningJudgmentCorrection")
                InfoBlock(title: "流程教训", value: snapshot.processLesson, valueIdentifier: "reviewLearningProcessLesson")
                InfoBlock(title: "下一研究问题", value: snapshot.nextResearchQuestion ?? "未填写", valueIdentifier: "reviewLearningNextQuestion")
                if let handoff = currentResearchReviewQuestionHandoff(review) {
                    Button {
                        beginResearchReviewQuestionHandoff(handoff)
                    } label: {
                        Label("带到当前报告助手", systemImage: "text.bubble")
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("reviewLearningQuestionToAssistant-\(review.id)")
                }
                if monitor.changes.isEmpty {
                    Text("后来事实与冻结身份未发现差异；这不代表原判断正确。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("reviewLearningNoFactChanges")
                } else {
                    ForEach(Array(monitor.changes.enumerated()), id: \.offset) { index, change in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(change.field).font(.caption2.weight(.semibold))
                            Text("冻结：\(change.frozenValue ?? "unavailable")")
                            Text("后来：\(change.currentValue ?? "unavailable")")
                            Text(change.detail)
                        }
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("reviewLearningFactChange-\(index)")
                    }
                }
                InfoBlock(title: "学习边界", value: state.limitation, valueIdentifier: "reviewLearningLimitation")
            } else {
                InfoBlock(title: "学习快照", value: "当时未保存判断修正与流程学习；不会用现在的事实补写。", valueIdentifier: "reviewLearningNotCaptured")
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func currentResearchReviewQuestionHandoff(
        _ review: PostDecisionReviewData
    ) -> ResearchReviewQuestionHandoff? {
        guard let membership = selectedMembership,
              let history = decisionReviewHistory,
              let handoff = ResearchReviewQuestionHandoff(
                membership: membership,
                history: history,
                reviewId: review.id
              ) else { return nil }
        return handoff
    }

    @MainActor
    private func beginResearchReviewQuestionHandoff(_ handoff: ResearchReviewQuestionHandoff) {
        if handoff.target.reportBinding == nil {
            beginManualReviewQuestionHandoff(handoff)
            return
        }
        // The saved review, its check and its report decision stay the question
        // source (`assistantHandoff`), but the revision notice must point at the
        // currently loaded newest exact report so the fresh reader can re-read
        // and reject any destination drift.
        guard let reviewId = handoff.target.reviewId,
              let membership = selectedMembership,
              twoLayerReportWorkspace.envelope?.requestedActorId == membership.actorId,
              let workspace = twoLayerReportWorkspace.envelope?.data,
              let report = workspace.latestReport,
              handoff.resolveQuestion(
                history: decisionReviewHistory, membership: membership, workspace: workspace
              ) != nil else {
            twoLayerReportWorkspace.message = "请先读取当前报告，并重新选择这条复盘问题。"
            return
        }
        clearResearchEvidenceQuestion("正在重新核对复盘问题与当前报告身份。")
        requestedTodayReportRevision = TodayReportRevisionNotice(
            membershipId: membership.id,
            membershipVersion: membership.version,
            symbol: membership.symbol,
            reportId: report.id,
            reportVersion: report.version,
            reportFingerprint: report.reportFingerprint,
            evidencePackId: report.evidencePackId,
            source: .dailyReview(reviewId),
            nextValidationQuestion: handoff.question,
            savedAt: handoff.reviewReviewedAt,
            assistantHandoff: .reviewQuestionDraft(handoff)
        )
        twoLayerReportWorkspace.message = "正在重新读取当前 membership、报告、证据包和复盘来源；尚未提问。"
    }
}
