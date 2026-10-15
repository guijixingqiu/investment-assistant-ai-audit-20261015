import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func researchOwnerActionReviewCard(layout: DailyWorkbenchLayoutMetrics) -> some View {
        if let history = decisionReviewHistory,
           history.metadata.provenance == "real",
           history.requestedSymbol == parsedSymbol?.canonical,
           let latest = history.checks
            .filter({
                $0.symbol == history.requestedSymbol
                    && $0.researchReportDecision.availability == "preserved"
                    && researchBriefNonEmpty($0.userFinalDecision) != nil
            })
            .max(by: { $0.checkedAt < $1.checkedAt }) {
            let checks = history.checks
                .filter({
                    $0.symbol == history.requestedSymbol
                        && $0.researchReportDecision.availability == "preserved"
                        && researchBriefNonEmpty($0.userFinalDecision) != nil
                })
                .sorted(by: { $0.checkedAt > $1.checkedAt })
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("个人投资记忆")
                        .font(.headline)
                        .accessibilityIdentifier("personalInvestmentMemoryTitle")
                    Spacer()
                    Text("\(checks.count) 次判断")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(OwnerExperienceStyle.warning)
                }
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(checks.prefix(2))) { check in
                        if check.id != latest.id { Divider() }
                        personalInvestmentMemoryRecord(check, isLatest: check.id == latest.id)
                    }
                }
                .accessibilityIdentifier("personalInvestmentMemoryTimeline")
                if checks.count > 2 {
                    Text("另有 \(checks.count - 2) 次历史判断，可在完整记录中查看。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .cardStyle(padding: layout.cardPadding)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("researchOwnerActionReview")
        }
    }

    @ViewBuilder
    private func personalInvestmentMemoryRecord(
        _ check: RecordedDecisionCheckReviewState,
        isLatest: Bool
    ) -> some View {
        let report = personalInvestmentMemoryReport(for: check)
        let review = check.reviews.max(by: { $0.reviewedAt < $1.reviewedAt })
        VStack(alignment: .leading, spacing: 8) {
            Text("判断于 \(check.checkedAt.prefix(10))")
                .font(.caption.weight(.semibold))
                .foregroundStyle(OwnerExperienceStyle.accent)
            if let report,
               let advice = report.payload.adviceLayer,
               let research = report.payload.researchLayer {
                researchBriefLine(
                    title: "当时怎么看",
                    value: personalInvestmentMemoryPlainCopy(
                        advice.conclusion,
                        fallback: "UNKNOWN：原判断只保留了内部记录，请打开完整记录核对。"
                    ),
                    identifier: "personalMemoryJudgment-\(check.id)"
                )
                researchBriefLine(
                    title: "当时依据",
                    value: personalInvestmentMemoryDrivers(report: report, research: research),
                    identifier: "personalMemoryBasis-\(check.id)"
                )
                researchBriefLine(
                    title: "当时价格条件",
                    value: researchBriefPrice(advice, includeCurrentScenarioRange: false),
                    identifier: "personalMemoryPrice-\(check.id)"
                )
                researchBriefLine(
                    title: "当时反证",
                    value: researchBriefCounterevidence(research),
                    identifier: "personalMemoryCounterevidence-\(check.id)"
                )
                researchBriefLine(
                    title: "当时 UNKNOWN",
                    value: personalInvestmentMemoryUnknowns(research),
                    identifier: "personalMemoryUnknowns-\(check.id)"
                )
            } else {
                researchBriefLine(
                    title: "当时判断与依据",
                    value: "UNKNOWN：这条历史动作没有可核对的原报告，不会用今天的事实补写。",
                    identifier: "personalMemoryJudgment-\(check.id)"
                )
            }
            researchBriefLine(
                title: "你的正式动作",
                value: personalInvestmentMemoryAction(check),
                identifier: isLatest ? "researchOwnerAction" : "personalMemoryAction-\(check.id)"
            )
            researchBriefLine(
                title: "后续复盘",
                value: review.map(personalInvestmentMemoryReviewCopy)
                    ?? "UNKNOWN：尚未完成后续复盘。",
                identifier: isLatest ? "researchOwnerReview" : "personalMemoryReview-\(check.id)"
            )
            if let review {
                researchBriefLine(
                    title: "复盘结论",
                    value: reviewOutcomeLabel(review.outcome),
                    identifier: "personalMemoryOutcome-\(check.id)"
                )
                researchBriefLine(
                    title: "事实变化",
                    value: personalInvestmentMemoryFactChanges(review),
                    identifier: "personalMemoryFactChange-\(check.id)"
                )
                researchBriefLine(
                    title: "判断错误 / 需修正",
                    value: personalInvestmentMemoryPlainCopy(
                        review.reviewLearning.snapshot?.judgmentCorrection,
                        fallback: "UNKNOWN：当时未保存判断修正，不能从后来结果倒推判断错误。"
                    ),
                    identifier: "personalMemoryJudgmentCorrection-\(check.id)"
                )
                researchBriefLine(
                    title: "依据不足",
                    value: review.outcome == .insufficientEvidence
                        ? personalInvestmentMemoryReviewCopy(review)
                        : "本次复盘未标记为依据不足；这不等于当时依据充分。",
                    identifier: "personalMemoryEvidenceGap-\(check.id)"
                )
                researchBriefLine(
                    title: "执行偏离",
                    value: "UNKNOWN：没有保存计划与实际执行对照，不能推断。",
                    identifier: "personalMemoryExecution-\(check.id)"
                )
                researchBriefLine(
                    title: "流程改进",
                    value: personalInvestmentMemoryPlainCopy(
                        review.reviewLearning.snapshot?.processLesson,
                        fallback: "UNKNOWN：当时未保存流程改进。"
                    ),
                    identifier: "personalMemoryProcessLesson-\(check.id)"
                )
                Text("动作 \(check.checkedAt.prefix(10)) · 复盘 \(review.reviewedAt.prefix(10))。这是已保存的历史记录，不是今天的新建议。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let report, let research = report.payload.researchLayer {
                    researchBriefSource(report: report, research: research)
                }
                if isLatest {
                    Button("查看已保存复盘") {
                        isResearchEvidenceRecordsExpanded = true
                        selectedDecisionLayer = .review
                        selectedReviewWorkspace = .timeline
                        pendingDecisionWorkspaceScrollTarget = decisionReviewSourceAnchor(review.id)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("openResearchOwnerReview")
                }
            } else {
                Text("动作 \(check.checkedAt.prefix(10)) · 复盘 UNKNOWN。这是已保存的历史记录，不是今天的新建议。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("personalInvestmentMemoryRecord-\(check.id)")
    }

    func personalInvestmentMemoryReport(
        for check: RecordedDecisionCheckReviewState
    ) -> TwoLayerReportData? {
        guard let binding = check.researchReportDecision.binding,
              binding.symbol == check.symbol,
              selectedMembership?.id == binding.membershipId,
              selectedMembership?.symbol == binding.symbol else { return nil }
        return twoLayerReportWorkspace.envelope?.data?.reports.first {
            guard let pack = $0.payload.evidencePackBinding else { return false }
            return $0.id == binding.reportId
                && $0.version == binding.reportVersion
                && $0.evidencePackId == binding.evidencePackId
                && $0.contractVersion == binding.contractVersion
                && $0.reportFingerprint == binding.reportFingerprint
                && pack.id == binding.evidencePackId
                && pack.version > 0
                && pack.fingerprint == binding.evidencePackFingerprint
                && pack.membershipId == binding.membershipId
                && pack.membershipVersion == binding.membershipVersion
                && pack.symbol == binding.symbol
        }
    }

    @ViewBuilder
    func personalResearchChecklistCard(layout: DailyWorkbenchLayoutMetrics) -> some View {
        if let history = decisionReviewHistory,
           history.metadata.provenance == "real",
           history.requestedSymbol == parsedSymbol?.canonical {
            let gaps = personalRepeatedResearchGaps(history)
            let reportCount = personalInvestmentMemoryReports(history).count
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("个人研究清单")
                        .font(.headline)
                        .accessibilityIdentifier("personalResearchChecklistTitle")
                    Spacer()
                    Text("\(reportCount) 份历史报告")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(OwnerExperienceStyle.warning)
                }
                Text("重复出现的研究缺口")
                    .font(.caption.weight(.semibold))
                if gaps.isEmpty {
                    Text("UNKNOWN：没有至少重复两次且能精确核对的历史缺口，不从当前事实补写。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("personalRepeatedResearchGapsUnknown")
                } else {
                    ForEach(Array(gaps.enumerated()), id: \.offset) { index, gap in
                        Text("\(gap.title) · \(gap.count) 次")
                            .font(.caption)
                            .accessibilityIdentifier("personalRepeatedResearchGap-\(index)")
                    }
                }
                researchBriefLine(
                    title: "重复流程模式",
                    value: personalRepeatedProcessLesson(history),
                    identifier: "personalRepeatedProcessLesson"
                )
                VStack(alignment: .leading, spacing: 5) {
                    Text("下次研究清单")
                        .font(.caption.weight(.semibold))
                    if gaps.isEmpty {
                        Text("UNKNOWN：历史样本不足，先继续保存判断修正与流程学习。")
                            .font(.caption)
                    } else {
                        ForEach(Array(gaps.enumerated()), id: \.offset) { index, gap in
                            Label(gap.checklist, systemImage: "square")
                                .font(.caption)
                                .accessibilityIdentifier("personalResearchChecklistItem-\(index)")
                        }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("personalResearchChecklistItems")
                Text("只使用当前股票的精确历史报告与人工复盘；不评分、不排名、不自动形成投资决定。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("personalResearchChecklistBoundary")
            }
            .cardStyle(padding: layout.cardPadding)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("personalResearchChecklist")
        }
    }

    private func personalInvestmentMemoryReports(
        _ history: DecisionReviewHistoryEnvelope
    ) -> [TwoLayerReportData] {
        var fingerprints: Set<String> = []
        return history.checks.compactMap { check in
            guard let report = personalInvestmentMemoryReport(for: check),
                  fingerprints.insert(report.reportFingerprint).inserted else { return nil }
            return report
        }
    }

    func personalRepeatedResearchGaps(
        _ history: DecisionReviewHistoryEnvelope
    ) -> [(title: String, count: Int, checklist: String)] {
        let reports = personalInvestmentMemoryReports(history)
        // ponytail: fixed research dimensions cover today's four-report history; use structured gap tags when contracts expose them.
        let categories = [
            ("宏观环境", ["宏观", "macro"], "核对利率、汇率与需求变化是否影响核心假设。"),
            ("行业", ["行业", "industry"], "补齐供给、需求、定价、竞争、政策与周期。"),
            ("事件", ["事件", "event"], "核对公告、财报和经营数据是否改变具体假设。"),
            ("风险", ["风险", "risk"], "写清最大风险、触发条件与可观察数据。"),
            ("反证", ["反证", "counterevidence"], "主动寻找会削弱或推翻判断的事实。")
        ]
        return categories.compactMap { category in
            let (title, _, checklist) = category
            let count = reports.filter { report in
                personalResearchGapTitles(report).contains(title)
            }.count
            return count >= 2 ? (title, count, checklist) : nil
        }
    }

    func personalResearchGapTitles(_ report: TwoLayerReportData) -> Set<String> {
        let unknowns = report.payload.researchLayer?.unknowns
            .map(\.statement).joined(separator: " ").lowercased() ?? ""
        let categories = [
            ("宏观环境", ["宏观", "macro"]),
            ("行业", ["行业", "industry"]),
            ("事件", ["事件", "event"]),
            ("风险", ["风险", "risk"]),
            ("反证", ["反证", "counterevidence"])
        ]
        return Set(categories.compactMap { title, keywords in
            keywords.contains(where: { unknowns.contains($0) }) ? title : nil
        })
    }

    private func personalRepeatedProcessLesson(
        _ history: DecisionReviewHistoryEnvelope
    ) -> String {
        if let lesson = history.learningSummary?.repeatedProcessLessons.first {
            return "重复 \(lesson.count) 次：\(lesson.processLesson)"
        }
        let lessons = history.checks.flatMap(\.reviews).compactMap {
            let value = personalInvestmentMemoryPlainCopy(
                $0.reviewLearning.snapshot?.processLesson,
                fallback: ""
            )
            return researchBriefNonEmpty(value)
        }
        let repeated = Dictionary(grouping: lessons, by: { $0 })
            .filter { $0.value.count >= 2 }
            .sorted { left, right in
                left.value.count != right.value.count
                    ? left.value.count > right.value.count
                    : left.key < right.key
            }
            .first
        return repeated.map { "重复 \($0.value.count) 次：\($0.key)" }
            ?? "UNKNOWN：当前历史未保存足够的流程学习，不从结果倒推。"
    }

    private func personalInvestmentMemoryUnknowns(_ research: TwoLayerResearch) -> String {
        let values = research.unknowns.compactMap {
            let value = personalInvestmentMemoryPlainCopy($0.statement, fallback: "")
            return researchBriefNonEmpty(value)
        }
        return values.isEmpty
            ? "当时存在未解决信息，但旧记录只保留了内部状态；请打开完整记录核对。"
            : values.prefix(3).joined(separator: "；")
    }

    private func personalInvestmentMemoryFactChanges(_ review: PostDecisionReviewData) -> String {
        guard let snapshot = review.reviewLearning.snapshot else {
            return "UNKNOWN：当时未保存事实变化快照，不能用现在的事实补写。"
        }
        guard let monitor = snapshot.monitor else {
            return "普通人工复盘保存了判断修正和流程教训；没有条件监控事实快照，不会重建。"
        }
        let changes = monitor.changes.compactMap {
            let value = personalInvestmentMemoryPlainCopy($0.detail, fallback: "")
            return researchBriefNonEmpty(value)
        }
        return changes.isEmpty
            ? "没有可用的人话事实变化记录；这不代表原判断正确。"
            : changes.prefix(3).joined(separator: "；")
    }

    private func personalInvestmentMemoryDrivers(
        report: TwoLayerReportData,
        research: TwoLayerResearch
    ) -> String {
        let drivers = researchBriefDrivers(report: report, research: research).compactMap {
            let value = personalInvestmentMemoryPlainCopy($0, fallback: "")
            return researchBriefNonEmpty(value)
        }
        return drivers.isEmpty
            ? "UNKNOWN：原依据只保留了内部记录，请打开完整记录核对。"
            : drivers.prefix(3).joined(separator: "；")
    }

    func personalInvestmentMemoryAction(_ check: RecordedDecisionCheckReviewState) -> String {
        personalInvestmentMemoryPlainCopy(
            check.userFinalDecision,
            fallback: "\(decisionActionIntentLabel(check.actionIntent))；完整原文保留在记录中，不自动生成交易。"
        )
    }

    func personalInvestmentMemoryReviewCopy(_ review: PostDecisionReviewData) -> String {
        let fallback = switch review.outcome {
        case .thesisConfirmed: "后来事实未推翻原判断。"
        case .thesisWeakened: "后来事实削弱原判断，需要重新核对。"
        case .thesisInvalidated: "后来事实已推翻原判断，需要重新研究。"
        case .insufficientEvidence: "依据仍不足，继续观察。"
        }
        return personalInvestmentMemoryPlainCopy(
            review.outcomeEvidence ?? review.reviewNote,
            fallback: fallback
        )
    }

    func personalInvestmentMemoryPlainCopy(
        _ value: String?,
        fallback: String
    ) -> String {
        guard let value = researchBriefNonEmpty(value) else { return fallback }
        // ponytail: keep this presentation-only filter small until history exposes structured Owner copy.
        let internalTerms = [
            "report #", "报告 #", "pack", "snapshot", "exact-current", "data cutoff",
            "source_missing", "stale", "needs_more_evidence", "decision-context",
            "backend", "quant-research", "owner assumptions"
        ]
        return internalTerms.contains(where: { value.lowercased().contains($0) })
            ? fallback
            : value
    }
}
