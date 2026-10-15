import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func personalHistoricalCasesAndIndustryTemplateCard(layout: DailyWorkbenchLayoutMetrics) -> some View {
        if let history = decisionReviewHistory,
           history.metadata.provenance == "real",
           history.requestedSymbol == parsedSymbol?.canonical {
            let cases = personalComparableHistoricalCases(history)
            let industryGap = personalRepeatedResearchGaps(history).first { $0.title == "行业" }
            VStack(alignment: .leading, spacing: 10) {
                Text("相似历史案例")
                    .font(.headline)
                    .accessibilityIdentifier("personalHistoricalCasesTitle")
                Text("按同一股票、相同重复研究缺口查找较早记录；不比较收益，不做相似度评分。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if cases.isEmpty {
                    Text("UNKNOWN：精确历史不足，暂时没有可核对的相似案例。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("personalHistoricalCasesUnknown")
                } else {
                    ForEach(Array(cases.enumerated()), id: \.offset) { index, item in
                        if index > 0 { Divider() }
                        personalHistoricalCase(item, index: index)
                    }
                }
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(industryGap.map { "行业缺口已在精确历史中重复 \($0.count) 次。" }
                            ?? "当前历史未显示重复行业缺口，仍可用六维模板核对。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        ForEach(Array(personalIndustryResearchTemplate.enumerated()), id: \.offset) { index, item in
                            researchBriefLine(
                                title: item.title,
                                value: item.question,
                                identifier: "personalIndustryTemplateItem-\(index)"
                            )
                        }
                    }
                    .padding(.top, 6)
                } label: {
                    Text("行业研究模板（供给 / 需求 / 定价 / 竞争 / 政策 / 周期）")
                        .font(.caption.weight(.semibold))
                }
                .accessibilityIdentifier("personalIndustryResearchTemplate")
                Text("案例和模板只帮助复盘与提问，不自动形成投资决定。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("personalHistoricalCasesBoundary")
            }
            .cardStyle(padding: layout.cardPadding)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("personalHistoricalCasesAndIndustryTemplate")
        }
    }

    @ViewBuilder
    private func personalHistoricalCase(
        _ item: (check: RecordedDecisionCheckReviewState, report: TwoLayerReportData, sharedGaps: [String]),
        index: Int
    ) -> some View {
        let review = item.check.reviews.max(by: { $0.reviewedAt < $1.reviewedAt })
        VStack(alignment: .leading, spacing: 7) {
            Text("\(item.check.checkedAt.prefix(10)) · 共同缺口：\(item.sharedGaps.joined(separator: "、"))")
                .font(.caption.weight(.semibold))
                .foregroundStyle(OwnerExperienceStyle.accent)
            researchBriefLine(
                title: "当时判断",
                value: personalInvestmentMemoryPlainCopy(
                    item.report.payload.adviceLayer?.conclusion,
                    fallback: "UNKNOWN：原判断没有可读文字，请打开完整记录核对。"
                ),
                identifier: "personalHistoricalCaseJudgment-\(index)"
            )
            researchBriefLine(
                title: "你的动作",
                value: personalInvestmentMemoryAction(item.check),
                identifier: "personalHistoricalCaseAction-\(index)"
            )
            researchBriefLine(
                title: "后来复盘",
                value: review.map(personalInvestmentMemoryReviewCopy)
                    ?? "UNKNOWN：这次判断尚未保存后续复盘。",
                identifier: "personalHistoricalCaseReview-\(index)"
            )
            if let review {
                Button("查看这次完整复盘") {
                    isResearchEvidenceRecordsExpanded = true
                    selectedDecisionLayer = .review
                    selectedReviewWorkspace = .timeline
                    pendingDecisionWorkspaceScrollTarget = decisionReviewSourceAnchor(review.id)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("openPersonalHistoricalCaseReview-\(index)")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("personalHistoricalCase-\(index)")
    }

    private func personalComparableHistoricalCases(
        _ history: DecisionReviewHistoryEnvelope
    ) -> [(check: RecordedDecisionCheckReviewState, report: TwoLayerReportData, sharedGaps: [String])] {
        let exact = history.checks
            .sorted(by: { $0.checkedAt > $1.checkedAt })
            .compactMap { check in
                personalInvestmentMemoryReport(for: check).map { (check: check, report: $0) }
            }
        guard let reference = exact.first else { return [] }
        let referenceGaps = personalResearchGapTitles(reference.report)
        var fingerprints = Set([reference.report.reportFingerprint])
        return exact.dropFirst().compactMap { item in
            guard fingerprints.insert(item.report.reportFingerprint).inserted else { return nil }
            let shared = referenceGaps.intersection(personalResearchGapTitles(item.report)).sorted()
            return shared.isEmpty ? nil : (item.check, item.report, shared)
        }.prefix(2).map { $0 }
    }

    private var personalIndustryResearchTemplate: [(title: String, question: String)] {
        [
            ("供给", "产能、库存和供给约束是否改变核心假设？"),
            ("需求", "销量、客户和终端需求是否支持核心假设？"),
            ("定价", "售价、折扣和成本传导是否改变盈利条件？"),
            ("竞争", "份额、产品和主要对手是否改变竞争位置？"),
            ("政策", "监管、补贴和贸易规则是否带来实质变化？"),
            ("周期", "当前处于什么阶段，哪些数据会确认或推翻判断？")
        ]
    }

    @ViewBuilder
    func personalLocalMemoryControlsCard(layout: DailyWorkbenchLayoutMetrics) -> some View {
        if let membership = selectedMembership,
           membership.symbol == parsedSymbol?.canonical {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("本地记忆与备份")
                        .font(.headline)
                        .accessibilityIdentifier("personalLocalMemoryControlsTitle")
                    Spacer()
                    Text(membership.symbol)
                        .font(.caption.monospaced())
                        .foregroundStyle(OwnerExperienceStyle.warning)
                }
                researchBriefLine(
                    title: "导出",
                    value: "可把当前股票的可验证研究带走为 JSON、CSV 或 PDF；缺失内容保持 UNKNOWN。",
                    identifier: "personalLocalMemoryExportSummary"
                )
                researchBriefLine(
                    title: "备份与恢复",
                    value: "可保存到你选择的 Files 文件夹，写入后立即校验；恢复前先核对当前股票与档案完整性。",
                    identifier: "personalLocalMemoryBackupSummary"
                )
                researchBriefLine(
                    title: "删除边界",
                    value: "恢复本机记忆与删除本机副本都要再次确认，不会改服务器研究或官方资产。",
                    identifier: "personalLocalMemoryDeleteSummary"
                )
                Button("打开导出、备份与恢复") {
                    showDailyDecisionLayer(.review, expandResult: true)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("openPersonalLocalMemoryControls")
                Text("打开只是进入现有本地知识页；导出、备份、恢复与删除仍分别需要你的明确动作。云盘是否完成同步为 UNKNOWN。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("personalLocalMemoryControlsBoundary")
            }
            .cardStyle(padding: layout.cardPadding)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("personalLocalMemoryControls")
        }
    }
}
