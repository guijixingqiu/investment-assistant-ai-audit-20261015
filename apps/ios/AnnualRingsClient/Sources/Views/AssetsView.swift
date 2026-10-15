import SwiftUI

struct AssetsView: View {
    @ObservedObject private var api = OwnerClientStore.shared
    let open: (ClientDestination) -> Void
    let openResearch: (String, ClientDestination) -> Void
    var body: some View {
        ClientPage(title: "资产", subtitle: "资产背景与组合影响") {
            ClientSection(title: "当前资产来源") {
                ClientRow(title: "平安快照", subtitle: "查看来源、时点与可用性", icon: "externaldrive", tone: Theme.green, action: { open(.assets) })
                    .padding(12).background(Theme.green.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
                ClientRow(title: "本地快照", subtitle: api.assets?.latestSnapshot.map { "非官方 · \($0.asOf.prefix(10))" } ?? "手工 / CSV · 非官方",
                          icon: "doc.text", tone: Theme.green, action: { open(.assets) })
                if let snapshot = api.assets?.latestSnapshot {
                    Text("\(snapshot.positions.count) 项持仓记录 · 不代表券商当前持仓")
                        .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                }
                ClientRow(title: "查看与补充资产快照", icon: "plus.circle", tone: Theme.green, action: { open(.assets) })
                    .accessibilityIdentifier("openAssetsWorkflow")
            }
            ClientSection(title: "组合研究") {
                ClientRow(title: "持仓与研究关联", icon: "link", tone: Theme.purple, action: { open(.assetPortfolio) })
                ClientRow(title: "集中度、暴露与组合影响", icon: "chart.pie", tone: Theme.green, action: { open(.assetPortfolio) })
                ClientRow(title: "持仓逻辑变化", icon: "square.and.pencil", tone: Theme.purple, action: { open(.assetPortfolio) })
            }
            ClientRow(title: "单股研究可继续", subtitle: api.currentSymbol, icon: "doc.text.magnifyingglass", tone: Theme.green) {
                openResearch(api.currentSymbol, .stock)
            }.padding(10).background(Theme.green.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
            ClientRow(title: "历史成交备注", subtitle: "只读回看", icon: "clock", tone: Theme.textSecondary, action: { open(.assetNotes) })
        }.refreshable { await api.load(tab: .assets, symbol: api.currentSymbol) }
        .accessibilityIdentifier("clientAssets")
    }
}
