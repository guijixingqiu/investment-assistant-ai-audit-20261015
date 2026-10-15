import SwiftUI

struct TodayView: View {
    @ObservedObject private var api = OwnerClientStore.shared
    let openResearch: (String, ClientDestination) -> Void
    let openMarket: () -> Void
    let openInbox: () -> Void
    var body: some View {
        ClientPage(title: "今日", subtitle: Date.now.formatted(date: .abbreviated, time: .omitted)) {
            ClientSection(title: "最值得处理") {
                VStack(alignment: .leading, spacing: 10) {
                    Text(api.todayInboxAction?.symbol ?? api.currentCandidate.name)
                        .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    Text(api.todayInboxAction.map { TodayMaterialChangePresentation.localizedResearchTitle($0.title) }
                         ?? (api.inbox?.status == .empty ? "继续已有研究" : "读取今日研究事项"))
                        .font(.system(size: 17, weight: .semibold))
                    Text(api.todayInboxAction.map { TodayMaterialChangePresentation.userSummary(for: $0) }
                         ?? (api.inbox?.status == .empty ? "当前没有新的待处理事项，可回到研究查看已有判断。" : "正在核对待办来源；已有研究仍可打开。"))
                        .font(.system(size: 13)).foregroundStyle(Theme.textSecondary).lineLimit(3)
                    Button(api.todayInboxAction == nil ? "打开研究 →" : "查看并处理 →") {
                        if api.todayInboxAction != nil { openInbox() }
                        else { openResearch(api.currentSymbol, .stock) }
                    }.font(.system(size: 14, weight: .semibold)).tint(Theme.amber)
                        .frame(minHeight: 38).accessibilityIdentifier("todayPrimaryAction")
                }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
                    .background(Theme.amber.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
            }
            ClientSection(title: "待办") {
                if let inbox = api.inbox, inbox.status == .available {
                    ForEach(Array(inbox.items.prefix(2).enumerated()), id: \.offset) { _, item in
                        ClientRow(title: TodayMaterialChangePresentation.localizedResearchTitle(item.title),
                            subtitle: item.symbol, icon: "doc.text", tone: Theme.amber, action: openInbox)
                    }
                } else {
                    ClientNote(text: api.loading ? "正在读取今日待办…" : api.inbox?.status == .empty ? "暂无待办" : "待办暂不可用，可重新读取或继续研究。")
                }
                ClientRow(title: "查看全部待办", icon: "tray", tone: Theme.amber, action: openInbox)
                    .accessibilityIdentifier("openTodayWorkflow")
            }
            ClientSection(title: "市场一瞥") {
                ClientRow(title: "港股市场环境", subtitle: api.marketEnvironment?.marketState ?? "行情与来源状态",
                          icon: "chart.bar", action: openMarket)
            }
            ClientSection(title: "继续上次研究") {
                ClientRow(title: api.currentCandidate.name, subtitle: "\(api.currentSymbol) · 判断与研究资料",
                    icon: "doc.text.magnifyingglass", tone: Theme.purple) { openResearch(api.currentSymbol, .stock) }
            }
        }.refreshable { await api.load(tab: .today, symbol: api.currentSymbol) }
        .accessibilityIdentifier("clientToday")
    }
}
