import SwiftUI

struct AntigravityActions: Sendable {
    var workflow: @MainActor @Sendable (ClientDestination) -> Void = { _ in }
    var assistant: @MainActor @Sendable () -> Void = {}
    var search: @MainActor @Sendable () -> Void = {}
    var connection: @MainActor @Sendable () -> Void = {}
}
private struct AntigravityActionsKey: EnvironmentKey {
    static let defaultValue = AntigravityActions()
}
extension EnvironmentValues {
    var antigravityActions: AntigravityActions {
        get { self[AntigravityActionsKey.self] }
        set { self[AntigravityActionsKey.self] = newValue }
    }
}
func templateNumber(_ value: Double?, format: String = "%.2f") -> String {
    guard let value, value.isFinite else { return "—" }
    return String(format: format, value)
}
@MainActor let templateMissingReport = TwoLayerReport(version: "—", asOf: "未读取", status: "暂无可用报告",
    conclusion: "尚未读取到当前报告，请刷新或打开报告管理核对。", actionIntent: "待核实", targetPriceRange: "未绑定",
    catalysts: [], counterevidence: [], businessModelSummary: "尚未返回", moatSummary: "尚未返回", financialSummary: "尚未返回")

struct AntigravityPriceGauge: View {
    let currentPrice: Double?
    let safetyMargin: Double?
    let targetBase: Double?
    let targetBull: Double?
    var body: some View {
        if let currentPrice, let safetyMargin, let targetBase, let targetBull {
            PriceGaugeView(currentPrice: currentPrice, safetyMargin: safetyMargin, targetBase: targetBase, targetBull: targetBull)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text("估值与价格条件锚点").font(.system(size: 14, weight: .semibold))
                HStack {
                    ForEach(["安全边际", "基准情景", "乐观情景"], id: \.self) { title in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(title).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                            Text("—").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.gold)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                Text("当前报告尚未绑定完整价格条件，请核对已保存估值情景。")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }.padding(14).templateCardStyle()
        }
    }
}
