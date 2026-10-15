import SwiftUI

extension TodayRootView {
    @ViewBuilder
    func reviewDueEnvelopeContent(_ envelope: TodayReviewDueEnvelope) -> some View {
        Text(TodayMaterialChangePresentation.reviewDueStatusText(envelope))
            .font(.callout.weight(.semibold))
            .foregroundStyle(envelope.status == .available ? Color.primary : Color.orange)
            .accessibilityIdentifier("todayReviewDueStatus")
        if let event = envelope.event {
            Text("\(event.subject) · \(event.type == "FORMAL_DECISION_DUE" ? "确认报告待正式决定" : event.dailyTrackingReconsiderationOutcome != nil ? "每日跟踪 · 重新审视正式决定" : event.type == "DAILY_TRACKING" ? event.state == .new ? "每日跟踪 / 下一验证" : "每日跟踪已复盘" : event.state == .new ? "待复盘" : "已复盘")")
                .font(.title3.monospaced())
                .accessibilityIdentifier("todayReviewDueSubject")
            Text(TodayMaterialChangePresentation.reviewDueEventLabel(event))
                .font(.caption.weight(.semibold))
                .accessibilityIdentifier("todayActionType")
            if let binding = event.reportBinding {
                Text("报告 #\(binding.reportId) 已绑定证据版本，并由你确认")
                    .font(.caption)
                    .accessibilityIdentifier("todayFormalDecisionDueIdentity")
            }
            if let bindings = event.bindings, let humanDecision = event.humanDecision {
                Text("决定 #\(bindings.decisionCheckId) · 生效 \(event.effectiveAt)")
                Text("人工决定：\(humanDecision.actionIntent) · \(humanDecision.humanCheckResult)")
                    .accessibilityIdentifier("todayReviewDueHumanDecision")
                Text("用户记录：\(humanDecision.userFinalDecision ?? "未记录")").font(.caption)
                if let tracking = TodayMaterialChangePresentation.formalDecisionTrackingSummary(
                    actionIntent: humanDecision.actionIntent,
                    state: humanDecision.formalDecision
                ) {
                    InfoBlock(
                        title: "Owner 正式决定跟踪条件",
                        value: tracking,
                        valueIdentifier: "todayFormalDecisionTrackingConditions"
                    )
                }
            }
            if let researchReport = event.researchReport { decisionTimeReportSnapshot(researchReport) }
            Text("优先级 \(event.priority.severity) · 截止 \(event.priority.dueAt)")
                .accessibilityIdentifier("todayReviewDuePriority")
            Text(event.type == "FORMAL_DECISION_DUE"
                 ? "进入研究后重新读取当前成员、证据版本、报告和决定；本次点击不会自动采用或写入。"
                 : event.dailyTrackingReconsiderationOutcome != nil
                 ? "该人工复盘表明论点减弱或失效。进入研究后必须重新读取并逐项核对同一复盘、正式决定、报告、证据版本、技术与材料；不会自动采用或提交新决定。"
                 : event.type == "DAILY_TRACKING"
                 ? "进入研究后重新读取成员、正式决定、绑定报告、冻结证据、技术与材料来源；任一发生变化都停止处理。"
                 : event.humanDecision?.reviewDueOn != nil
                 ? "这是同一人工决定设定的香港时间复盘日；到期后进入研究仍须重新核对，不会自动提交。"
                 : event.state == .new
                 ? "截止时间等于正式决定 checkedAt，表示即时复盘跟进，不是日历计划。"
                 : "最新同 actor 正式复盘已解决该跟进。")
                .font(.caption)
                .foregroundStyle(.secondary)
            if envelope.metadata.fixture {
                Text("测试样本 / 非真实事件")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("todayReviewDueFixtureBoundary")
            }
            Button {
                if let target = TodayFormalDecisionNavigationTarget(event: event) {
                    openResearchFormalDecision(target)
                } else {
                    Task { await openExactReview(event) }
                }
            } label: {
                Label(event.type == "FORMAL_DECISION_DUE" ? "进入研究形成正式决定"
                    : event.dailyTrackingReconsiderationOutcome != nil ? "查看复盘并重新审视决定"
                    : event.type == "DAILY_TRACKING" ? "进入研究每日跟踪"
                    : event.state == .new ? "进入研究复盘" : "查看已保存复盘",
                    systemImage: event.type == "FORMAL_DECISION_DUE" ? "checkmark.seal"
                        : event.dailyTrackingReconsiderationOutcome != nil ? "exclamationmark.arrow.triangle.2.circlepath"
                        : event.type == "DAILY_TRACKING" ? "calendar.badge.clock"
                        : "clock.arrow.circlepath")
            }
            .buttonStyle(.borderedProminent)
            .disabled(isOpeningReview)
            .accessibilityIdentifier("todayReviewDueOpenReview")
        }
        DisclosureGroup("来源详情") {
            Text("来源：\(envelope.metadata.source)")
                .font(.caption2.monospaced())
                .accessibilityIdentifier("todayReviewDueSource")
            Text("截止 \(envelope.metadata.asOf ?? "未记录") · 读取 \(envelope.metadata.fetchedAt ?? "未记录")")
                .font(.caption2.monospaced())
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("todayReviewDueCutoff")
            if let event = envelope.event {
                Text("状态原因：\(event.stateReason)")
                    .font(.caption2.monospaced())
                    .accessibilityIdentifier("todayReviewDueReason")
                if let binding = event.reportBinding {
                    Text("成员 #\(binding.membershipId) v\(binding.membershipVersion) · 报告决定 #\(binding.reportDecisionId)")
                        .font(.caption2.monospaced())
                }
            }
            Text(envelope.message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("todayReviewDueMessage")
        }
        Text("仅供每日跟踪、下一验证与复盘导航；不会自动写复盘或修改正式决定，也不是建议、订单、交易或资产动作，不改变现金、费用、持仓或券商事实。")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.orange)
            .accessibilityIdentifier("todayReviewDueNoEffects")
    }

    @ViewBuilder
    private func decisionTimeReportSnapshot(_ report: TodayReviewDueEvent.ResearchReport) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("历史决策时点快照 · \(report.availability == "preserved" ? "已保存" : "未保存")")
                .font(.callout.weight(.semibold))
                .accessibilityIdentifier("todayReviewDueReportSnapshot")
            if let binding = report.binding {
                Text("报告 #\(binding.reportId) v\(binding.reportVersion) · 证据包 #\(binding.evidencePackId) · 报告决定 #\(binding.reportDecisionId)")
                    .font(.caption.monospaced())
                    .accessibilityIdentifier("todayReviewDueReportIdentity")
                Text("决策时 investmentThesis：\(report.investmentThesis)")
                Text("失效条件：\(report.invalidationConditions.joined(separator: "；"))")
                Text("下一验证问题：\(report.nextValidationQuestion)")
            } else {
                Text("未保存历史报告快照，不能用当前事实补回当时的论点、失效条件或下一验证问题。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("todayReviewDueReportUnknown")
            }
            Text(report.limitation)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("以上只来自正式决定绑定的历史不可变报告；进入研究后必须重新读取当前事实，不能用最新事实替换这份快照。")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.orange)
                .accessibilityIdentifier("todayReviewDueDecisionTimeBoundary")
        }
    }
}
