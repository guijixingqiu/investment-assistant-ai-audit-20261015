import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func annualReviewLearningSummarySection(_ history: DecisionReviewHistoryEnvelope) -> some View {
        let summary = history.learningSummary
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: "person.text.rectangle")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.pink)
                    .frame(width: 34, height: 34)
                    .background(Color.pink.opacity(0.12), in: Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text("个人复盘学习")
                        .font(.headline)
                        .accessibilityIdentifier("annualReviewLearningSummaryTitle")
                    Text("冻结判断与后来事实")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 8)

                if let summary {
                    HStack(spacing: 5) {
                        Image(systemName: learningSummaryStatusIcon(summary))
                        Text(learningSummaryStatus(summary))
                            .accessibilityIdentifier("annualReviewLearningSummaryStatus")
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(learningSummaryStatusColor(summary))
                    .multilineTextAlignment(.trailing)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }

            if let summary {
                learningSampleProgress(summary)

                if summary.availability == "ready" {
                    Divider()
                    learningConfidenceOutcomeRows(summary.confidenceOutcomes)
                    Divider()
                    learningRepeatedLessons(summary.repeatedProcessLessons)
                    Divider()
                    learningQuantSampleLimits(summary.quantSampleLimitations)
                } else {
                    learningSampleBoundary(summary)
                }

                Divider()
                learningSafetyBoundary(summary)
            } else {
                HStack(alignment: .top, spacing: 9) {
                    Image(systemName: "clock.badge.questionmark")
                        .foregroundStyle(.secondary)
                    Text("该历史响应未记录个人学习汇总；不会从当前事实重建。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("annualReviewLearningSummaryNotCaptured")
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.primary.opacity(0.08), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("annualReviewLearningSummarySection")
    }

    private func learningSampleProgress(_ summary: AnnualReviewLearningSummary) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text("个人样本")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(min(summary.counts.capturedLearningRecords, summary.minimumSampleSize)) / \(summary.minimumSampleSize)")
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(learningSummaryStatusColor(summary))
            }

            ProgressView(
                value: Double(min(summary.counts.capturedLearningRecords, summary.minimumSampleSize)),
                total: Double(summary.minimumSampleSize)
            )
            .tint(learningSummaryStatusColor(summary))

            Text("可评价 \(summary.counts.eligibleReviews) · 已记录学习 \(summary.counts.capturedLearningRecords) · 历史缺失 \(summary.counts.notCapturedLearningRecords) · 最低 \(summary.minimumSampleSize)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("annualReviewLearningSummaryCounts")
        }
    }

    private func learningSampleBoundary(_ summary: AnnualReviewLearningSummary) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: summary.availability == "insufficient_sample" ? "hourglass" : "tray")
                .font(.callout.weight(.semibold))
                .foregroundStyle(learningSummaryStatusColor(summary))
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 3) {
                Text(summary.availability == "insufficient_sample"
                    ? "还差 \(max(summary.minimumSampleSize - summary.counts.capturedLearningRecords, 0)) 条再显示描述性聚合"
                    : "尚无已记录的复盘学习")
                    .font(.callout.weight(.semibold))
                Text(learningSampleBoundaryText(summary))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("annualReviewLearningSummaryLimitation")
                    .accessibilityValue(summary.limitation)
            }
        }
        .padding(.vertical, 2)
    }

    private func learningSafetyBoundary(_ summary: AnnualReviewLearningSummary) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "shield.checkered")
                .font(.callout.weight(.semibold))
                .foregroundStyle(.green)
                .frame(width: 22)
            Text("仅个人、描述性复盘；不从盈亏或单次结果推断正确性，不评分、不跨用户比较，不生成推荐、排名、目标价、目标仓位、方向、订单或交易。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("annualReviewLearningSummarySafety")
        }
        .accessibilityElement(children: .contain)
        .accessibilityValue(summary.safety.descriptiveOnly ? "descriptive-only" : "invalid")
    }

    @ViewBuilder
    private func learningConfidenceOutcomeRows(
        _ rows: [AnnualReviewLearningConfidenceOutcomeRow]
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("冻结置信度 × 后来结果", systemImage: "square.grid.2x2")
                .font(.callout.weight(.semibold))
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(learningConfidenceLabel(row.confidence))
                            .font(.callout.weight(.semibold))
                        Spacer()
                        Text("\(row.total) 条")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    Text("保持 \(row.outcomes.thesisConfirmed) · 减弱 \(row.outcomes.thesisWeakened) · 失效 \(row.outcomes.thesisInvalidated) · 证据不足 \(row.outcomes.insufficientEvidence)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("annualReviewLearningConfidenceRow-\(index)")
                    learningReviewSourceMenu(row.reviewIds, identifier: "annualReviewLearningConfidenceSources-\(index)")
                }
            }
        }
    }

    @ViewBuilder
    private func learningRepeatedLessons(
        _ lessons: [AnnualReviewLearningRepeatedLesson]
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("重复流程教训", systemImage: "arrow.triangle.2.circlepath")
                .font(.callout.weight(.semibold))
            if lessons.isEmpty {
                Text("没有完全相同且至少重复两次的人工流程教训。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("annualReviewLearningRepeatedLessonsEmpty")
            } else {
                ForEach(Array(lessons.enumerated()), id: \.offset) { index, lesson in
                    VStack(alignment: .leading, spacing: 3) {
                        Text("重复 \(lesson.count) 次")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.orange)
                        Text(lesson.processLesson)
                            .font(.callout)
                        learningReviewSourceMenu(
                            lesson.reviewIds,
                            identifier: "annualReviewLearningRepeatedLesson-\(index)"
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func learningQuantSampleLimits(
        _ limitations: [AnnualReviewLearningQuantSampleLimitation]
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("冻结量化样本限制", systemImage: "chart.xyaxis.line")
                .font(.callout.weight(.semibold))
            ForEach(Array(limitations.enumerated()), id: \.offset) { index, item in
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(item.sourceClassification) · \(item.finalTestPolicy)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.blue)
                    Text(item.boundaryLimitation)
                        .font(.callout)
                    Text("样本诊断 \(item.diagnosticStatus) · \(item.diagnosticLimitation)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    learningCheckSourceMenu(
                        item.decisionCheckIds,
                        identifier: "annualReviewLearningQuantLimit-\(index)"
                    )
                }
            }
        }
    }

    private func learningSummaryStatus(_ summary: AnnualReviewLearningSummary) -> String {
        switch summary.availability {
        case "ready": "已达到个人描述性样本门槛"
        case "insufficient_sample": "样本不足，不显示聚合"
        default: "未记录学习，不从当前事实重建"
        }
    }

    private func learningSampleBoundaryText(_ summary: AnnualReviewLearningSummary) -> String {
        if summary.availability == "insufficient_sample" {
            return "当前仅有 \(summary.counts.capturedLearningRecords) 条个人复盘学习记录；达到 \(summary.minimumSampleSize) 条前不展示描述性聚合。"
        }
        return "尚无已记录的个人复盘学习；历史缺失不会用当前事实补写。"
    }

    private func learningSummaryStatusColor(_ summary: AnnualReviewLearningSummary) -> Color {
        switch summary.availability {
        case "ready": .green
        case "insufficient_sample": .orange
        default: .secondary
        }
    }

    private func learningSummaryStatusIcon(_ summary: AnnualReviewLearningSummary) -> String {
        switch summary.availability {
        case "ready": "checkmark.circle.fill"
        case "insufficient_sample": "hourglass.circle.fill"
        default: "minus.circle"
        }
    }

    private func learningConfidenceLabel(_ confidence: String) -> String {
        switch confidence {
        case "high": "高置信度"
        case "medium": "中置信度"
        default: "低置信度"
        }
    }

    private func learningReviewSourceMenu(_ reviewIds: [String], identifier: String) -> some View {
        Menu {
            ForEach(reviewIds, id: \.self) { reviewId in
                Button {
                    selectedReviewWorkspace = .timeline
                    pendingDecisionWorkspaceScrollTarget = decisionReviewSourceAnchor(reviewId)
                } label: {
                    Label(reviewId, systemImage: "arrow.down.to.line")
                }
                .accessibilityIdentifier("annualReviewLearningReviewSource-\(reviewId)")
            }
        } label: {
            Label("查看 \(reviewIds.count) 条复盘来源", systemImage: "list.bullet.rectangle")
        }
        .font(.caption)
        .accessibilityIdentifier(identifier)
    }

    private func learningCheckSourceMenu(_ checkIds: [String], identifier: String) -> some View {
        Menu {
            ForEach(checkIds, id: \.self) { checkId in
                Button {
                    selectedReviewWorkspace = .timeline
                    pendingDecisionWorkspaceScrollTarget = decisionReviewCheckAnchor(checkId)
                } label: {
                    Label(checkId, systemImage: "arrow.down.to.line")
                }
                .accessibilityIdentifier("annualReviewLearningCheckSource-\(checkId)")
            }
        } label: {
            Label("查看 \(checkIds.count) 次冻结检查", systemImage: "list.bullet.rectangle")
        }
        .font(.caption)
        .accessibilityIdentifier(identifier)
    }
}
