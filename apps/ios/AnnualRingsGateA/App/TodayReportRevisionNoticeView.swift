import SwiftUI

extension TodayRootView {
    @ViewBuilder
    var reportRevisionCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("研究报告修订回流")
                .font(.headline)
            if let notice = currentReportRevisionNotice {
                Text("已保存 report #\(notice.reportId) v\(notice.reportVersion) · 证据包 #\(notice.evidencePackId)")
                    .font(.callout.weight(.semibold))
                    .accessibilityIdentifier("todayReportRevisionIdentity")
                Text("来源：\(notice.sourceLabel)；保存时间 \(notice.savedAt)")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                Text("下一验证问题：\(notice.nextValidationQuestion)")
                    .accessibilityIdentifier("todayReportRevisionNextQuestion")
                Text("本次会话已重新确认当前版本。该提示只用于本次导航，不是服务器生成的今日事项。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("todayReportRevisionSessionBoundary")
                Button {
                    openResearchReportRevision(notice)
                } label: {
                    Label("回到冻结研究报告", systemImage: "arrow.uturn.forward.circle")
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("todayReportRevisionOpenResearch")
                Text("不会自动正式决定、生成订单、执行交易或修改现金、费用、持仓、券商事实。")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("todayReportRevisionNoEffects")
            } else {
                Text("暂无本会话已保存报告修订")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("todayReportRevisionEmpty")
            }
        }
        .cardStyle()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("todayReportRevisionCard")
    }

    private var currentReportRevisionNotice: TodayReportRevisionNotice? {
        guard let symbol = SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical,
              reportRevisionNotice?.symbol == symbol else {
            return nil
        }
        return reportRevisionNotice
    }
}
