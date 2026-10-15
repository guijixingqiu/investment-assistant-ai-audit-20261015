import SwiftUI

public struct FiveQuestionCard: View {
    public let dossier: InvestmentDecisionDossier
    public let quote: StockQuote?
    public var onSelect: (() -> Void)?
    public init(dossier: InvestmentDecisionDossier, quote: StockQuote?, onSelect: (() -> Void)? = nil) {
        self.dossier = dossier; self.quote = quote; self.onSelect = onSelect
    }
    public var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            row("当前判断", dossier.thesisSummary)
            Divider()
            row("最新变化", dossier.latestCatalysts.isEmpty ? "打开当前报告核对变化与来源。" : dossier.latestCatalysts.joined(separator: "；"))
            Divider()
            row("价格条件", dossier.conditionTriggers.first ?? "在估值详情读取已保存情景与价格条件。")
            Divider()
            row("风险与失效", dossier.invalidationConditions.first ?? "当前档案尚未记录失效条件，可在研究维护中补充。")
            Divider()
            row("下一步", dossier.nextActionTitle)
        }.padding(15).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.purple.opacity(0.07), in: RoundedRectangle(cornerRadius: 13))
    }
    private func row(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textPrimary)
            Text(value).font(.system(size: 13)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
        }
    }
}
