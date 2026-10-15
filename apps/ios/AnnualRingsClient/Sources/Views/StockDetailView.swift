import SwiftUI

struct StockDetailView: View {
    @ObservedObject private var api = OwnerClientStore.shared
    let open: (ClientDestination) -> Void
    private var dossier: InvestmentDecisionDossier { api.currentCandidate.currentDossier }
    var body: some View {
        ClientPage(title: api.currentCandidate.name) {
            ClientCard(title: api.currentSymbol, icon: "chart.line.uptrend.xyaxis", tone: Theme.blue) {
                HStack(alignment: .firstTextBaseline) {
                    Text(api.currentCandidate.name).font(.system(size: 20, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                    Spacer()
                    if let quote = api.activeQuote {
                        Text("\(quote.price, specifier: "%.2f")").font(.system(size: 22, weight: .semibold)).monospacedDigit()
                        Text("HKD").font(.system(size: 11))
                    }
                }
                if let quote = api.activeQuote {
                    Text("\(quote.isStale ? "历史参考" : "报价快照") · \(quote.quoteTime)").font(.system(size: 11))
                }
            }
            ClientCard(title: "当前判断", icon: "scope", tone: Theme.purple) {
                Text(dossier.thesisSummary).lineSpacing(3)
                ClientRow(title: "研究报告与版本", subtitle: "结论、条件与依据", tone: Theme.purple) { open(.report) }
                    .accessibilityIdentifier("clientReport")
            }
            ClientCard(title: "变化与证据", icon: "doc.richtext", tone: Theme.green) {
                if !dossier.latestCatalysts.isEmpty {
                    ForEach(dossier.latestCatalysts.prefix(2), id: \.self) { Text($0).lineSpacing(3) }
                }
                ClientRow(title: "资料与原文", subtitle: "文件、引用与原页核验", icon: "doc.richtext", tone: Theme.green) { open(.materials) }
                    .accessibilityIdentifier("clientMaterials")
                ClientRow(title: "财务与经营", subtitle: "已读取的事实与口径", icon: "tablecells", tone: Theme.green) { open(.facts) }
            }
            ClientCard(title: "估值与价格条件", icon: "chart.bar", tone: Theme.blue) {
                Text(dossier.conditionTriggers.first ?? "查看已保存情景及其来源；没有数据时不补估值。")
                ClientRow(title: "估值与技术", subtitle: "情景结果、价格条件与历史证据", icon: "chart.bar", tone: Theme.blue) { open(.valuation) }
                    .accessibilityIdentifier("clientValuation")
            }
            ClientCard(title: "风险与下一步", icon: "shield.lefthalf.filled", tone: Theme.amber) {
                Text(dossier.invalidationConditions.first ?? "当前档案尚未记录失效条件。")
                Divider()
                Text(dossier.nextActionTitle).foregroundStyle(Theme.textPrimary)
                ClientRow(title: "个人决定与复盘", icon: "clock.arrow.circlepath", tone: Theme.amber) { open(.review) }
                ClientPrimaryButton(title: "用已有资料更新研究") { open(.tasks) }
                    .accessibilityIdentifier("clientUpdateResearch")
            }
        }.accessibilityIdentifier("clientStockDetail")
    }
}
