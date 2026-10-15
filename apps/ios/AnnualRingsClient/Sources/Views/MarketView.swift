import SwiftUI
import Charts

struct MarketView: View {
    @ObservedObject private var api = OwnerClientStore.shared
    let open: (ClientDestination) -> Void
    let openResearch: (String, ClientDestination) -> Void
    let search: () -> Void
    var body: some View {
        ClientPage(title: "市场", subtitle: "港股 · 观察与发现") {
            Button(action: search) {
                Label("股票名称或代码", systemImage: "magnifyingglass")
                    .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading).padding(.horizontal, 12)
                    .background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 10))
            }.buttonStyle(.plain)
            ClientSection(title: "关注标的") {
                if api.candidates.isEmpty { ClientNote(text: api.loading ? "正在读取关注标的…" : "可使用搜索选择港股。") }
                ForEach(api.candidates.prefix(3)) { item in
                    ClientRow(title: item.name, subtitle: item.symbol, icon: "chart.line.uptrend.xyaxis", tone: Theme.green) {
                        api.selectSymbol(item.symbol)
                    }
                }
            }
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text(api.currentCandidate.name).font(.system(size: 15, weight: .semibold))
                    Spacer()
                    Button { Task { await api.load(tab: .market, symbol: api.currentSymbol, refreshQuote: true) } } label: {
                        Image(systemName: "arrow.clockwise").frame(width: 44, height: 36)
                    }.disabled(api.loading).accessibilityLabel("刷新行情").accessibilityIdentifier("refreshMarketData")
                }
                if let quote = api.activeQuote {
                    Text("\(quote.price, specifier: "%.2f") HKD").font(.system(size: 22, weight: .semibold)).monospacedDigit()
                    Text("\(quote.isStale ? "历史参考" : "当前报价") · \(quote.provenance) · \(quote.quoteTime)")
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                } else { ClientNote(text: api.issues["quote"] ?? "行情正在读取或暂不可用。") }
                if let daily = api.daily, daily.usableForRequestedCutoff, let points = daily.technical.points, !points.isEmpty {
                    Chart(Array(points.suffix(60).enumerated()), id: \.offset) { _, point in
                        LineMark(x: .value("交易日", point.session), y: .value("收盘", point.candle.close))
                            .foregroundStyle(Theme.green)
                    }.chartXAxis(.hidden).chartYScale(domain: .automatic(includesZero: false)).frame(height: 110)
                    Text("日线 · 截至 \(daily.technical.dataCutoffAt ?? "未提供")").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                } else {
                    Text(api.issues["daily"] ?? "日线图将在有效历史数据返回后显示。")
                        .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                }
                if let issue = api.issues["quoteRefresh"] { Text(issue).font(.system(size: 12)).foregroundStyle(Theme.amber) }
            }.padding(14).background(Theme.green.opacity(0.07), in: RoundedRectangle(cornerRadius: 13))
            VStack(spacing: 0) {
                ClientRow(title: "趋势与行业比较", icon: "chart.xyaxis.line") { open(.market) }.accessibilityIdentifier("openMarketWorkflow")
                ClientRow(title: "市场环境", icon: "globe.asia.australia", tone: Theme.green) { open(.environment) }
                ClientRow(title: "发现与官方公告", subtitle: "线索需打开原文核验", icon: "doc.text", tone: Theme.amber) { open(.announcements) }
            }
            ClientPrimaryButton(title: "进入该股研究 →") { openResearch(api.currentSymbol, .stock) }
                .accessibilityIdentifier("marketToResearch")
        }.refreshable { await api.load(tab: .market, symbol: api.currentSymbol) }
        .accessibilityIdentifier("clientMarket")
    }
}
