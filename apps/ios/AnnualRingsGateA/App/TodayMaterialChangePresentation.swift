import SwiftUI

struct TodayMaterialChangeSummaryView: View {
    let item: TodayActionInboxItem

    var body: some View {
        Text(TodayMaterialChangePresentation.localizedMaterialChangeTitle(item.title)).font(.callout.weight(.semibold))
        Text("发生了什么").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
        Text(TodayMaterialChangePresentation.summary(item.summary))
            .font(.caption)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("todayMaterialChangeSummary-\(item.order)")
        Text("\(TodayMaterialChangePresentation.sourceLabel(item.source.sourceType)) · 发布 \((item.source.effectiveAt ?? item.source.asOf ?? item.source.fetchedAt).prefix(10))")
            .font(.caption2)
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("todayMaterialChangeSource-\(item.order)")
        Text("为什么重要：\(impact)")
            .font(.caption.weight(.semibold))
            .accessibilityIdentifier("todayMaterialChangeHypothesisImpact-\(item.order)")
        Text(item.researchTarget?.report == nil
             ? "判断状态：今天没有可用的当前报告；上次有效判断也不会自动更新，先核对这条变化。"
             : "判断状态：尚未改变；先复核是否需要生成待确认的新版本。")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.orange)
            .accessibilityIdentifier("todayMaterialChangeReportUpdate-\(item.order)")
    }

    private var impact: String {
        if item.summary.hasSuffix(" Hypothesis impact: supports.") {
            return "支持当前假设；核对证据后再决定是否更新判断"
        }
        if item.summary.hasSuffix(" Hypothesis impact: weakens.") { return "削弱当前假设；优先核对风险与反证是否变化" }
        if item.summary.hasSuffix(" Hypothesis impact: unknown.") { return "暂不能判断对当前假设的影响" }
        return "这条变化可能影响当前假设；先核对证据再决定是否更新判断"
    }
}
