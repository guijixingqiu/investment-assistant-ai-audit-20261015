import SwiftUI

struct AntigravityMarketView: View {
    @ObservedObject var api = OwnerClientStore.shared
    @Environment(\.antigravityActions) private var actions
    var onNavigateToResearch: ((Int, Int) -> Void)? = nil
    @Binding var selectedStock: InvestmentDecisionDossier?
    // Active Focus Stock for Market Diagnostics
    @State private var focusSymbol: String = "HK.00175"
    @State private var discoveryLimit = 20
    @State private var discoverySearch = ""
    @State private var discoveryTab: Int = 0 // 0: 港股通自选候选池, 1: 官方披露与公告线索
    @State private var showSearchSheet: Bool = false
    @State private var rowQuotes: [String: MarketQuoteEnvelope] = [:]
    @State private var quoteFailures: Set<String> = []
    @State private var refreshingMarket = false
    @State private var rowRefreshIssues: [String: String] = [:]
    
    init(
        onNavigateToResearch: ((Int, Int) -> Void)? = nil,
        selectedStock: Binding<InvestmentDecisionDossier?> = .constant(nil)
    ) {
        self.onNavigateToResearch = onNavigateToResearch
        self._selectedStock = selectedStock
        let args = ProcessInfo.processInfo.arguments
        if let idx = args.firstIndex(of: "--market-tab"), idx + 1 < args.count, let t = Int(args[idx + 1]) {
            _discoveryTab = State(initialValue: t)
        }
        if let idx = args.firstIndex(of: "--focus"), idx + 1 < args.count {
            _focusSymbol = State(initialValue: args[idx + 1])
        }
    }
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("找公司，了解正在发生的变化").font(.subheadline).foregroundStyle(Theme.textSecondary)
                Button { actions.search() } label: {
                    HStack(spacing: 12) { Image(systemName: "magnifyingglass"); Text("搜索港股名称或代码"); Spacer() }
                        .font(.body).foregroundStyle(Theme.textSecondary).padding(14)
                        .background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 13))
                }.buttonStyle(.plain).accessibilityIdentifier("marketSearch")
                HStack { Text("我的自选").font(.headline); Spacer(); Button(refreshingMarket ? "刷新中…" : "刷新行情") { Task { await refreshMarket() } }.disabled(refreshingMarket).accessibilityIdentifier("refreshMarketData"); Button("管理") { actions.workflow(.manage) }.frame(minHeight: 44) }
                if api.candidates.isEmpty {
                    Text(api.loading ? "正在读取自选公司…" : "还没有可读取的自选公司。搜索公司后，可以明确加入研究自选。")
                        .font(.body).foregroundStyle(Theme.textSecondary)
                }
                if let message = api.marketRefreshMessage { Text(message).font(.footnote).foregroundStyle(Theme.textSecondary) }
                if let issue = api.issues["quoteRefresh"] { Text(issue).font(.footnote).foregroundStyle(Theme.amber) }
                ForEach(Array(api.candidates.prefix(12).enumerated()), id: \.element.symbol) { _, candidate in
                    Button { api.selectSymbol(candidate.symbol); actions.workflow(.templateHome) } label: {
                        HStack(alignment: .top, spacing: 12) {
                            VStack(alignment: .leading, spacing: 7) {
                                Text(candidate.name).font(.body).foregroundStyle(Theme.textPrimary)
                                Text(candidate.symbol).font(.footnote).foregroundStyle(Theme.textSecondary)
                                Text("查看公司研究").font(.footnote).foregroundStyle(Theme.gold)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 6) {
                                if let quote = rowQuotes[candidate.symbol], quote.isUsableQuote, let data = quote.data {
                                    Text(data.price.formatted(.number.precision(.fractionLength(2)))).font(.title3).monospacedDigit()
                                    Text(data.changePercent.map { String(format: "%+.2f%%", $0) } ?? "涨跌幅未取得").font(.footnote)
                                    Text("\(quote.status.rawValue == "stale" ? "过期快照" : "报价快照") · \(WorkspaceTimestamp.hongKong(data.quoteTime))")
                                        .font(.caption).foregroundStyle(Theme.textSecondary)
                                } else {
                                    Text(quoteFailures.contains(candidate.symbol) ? "报价暂不可用" : "读取报价…")
                                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                                }
                            }
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.textSecondary)
                        }.frame(minHeight: 64).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                    if let issue = rowRefreshIssues[candidate.symbol] { Text(issue).font(.caption).foregroundStyle(Theme.amber) }
                    Divider()
                }
                if api.candidates.count > 12 { Button("查看全部自选") { actions.workflow(.manage) } }
                Text("港元 · 点击刷新从行情源更新报价；保留来源时间与过期状态")
                    .font(.caption).foregroundStyle(Theme.textSecondary)
                Button { actions.workflow(.announcements) } label: {
                    WorkspaceRowLabel(title: "公告与资料线索", subtitle: "当前公司 \(api.currentSymbol) · 查看披露与原始来源", icon: "doc.text")
                }.buttonStyle(.plain)
                Divider()
                NavigationLink {
                    ClientPage(title: "市场环境与行情技术", subtitle: "当前公司 \(api.currentSymbol)") {
                        Button { actions.workflow(.environment) } label: { WorkspaceRowLabel(title: "市场环境", icon: "globe.asia.australia") }
                        NavigationLink { CompanyTechnicalView(symbol: api.currentSymbol) } label: { WorkspaceRowLabel(title: "当前公司的行情与技术", icon: "chart.xyaxis.line") }
                        DisclosureGroup("更多市场观察") { macroEnvironmentSection; portfolioTrendComparisonSection }
                    }
                } label: { WorkspaceRowLabel(title: "市场环境与行情技术", subtitle: "指数、市场背景与当前公司走势", icon: "chart.xyaxis.line") }.buttonStyle(.plain)
                NavigationLink { ClientPage(title: "发现公司与披露") { discoveryAndAnnouncementsSection } } label: {
                    WorkspaceRowLabel(title: "发现公司", subtitle: "候选公司与轻量核查", icon: "binoculars")
                }.buttonStyle(.plain)
            }.padding(.horizontal, 24).padding(.vertical, 12)
        }.background(Theme.bgPrimary.ignoresSafeArea())
            .navigationTitle("市场").navigationBarTitleDisplayMode(.large)
            .toolbar { WorkspaceTools(showsSearch: false) }
            .task(id: api.candidates.prefix(12).map(\.symbol).joined(separator: "|") + "|\(api.authorizationRevision)") { await loadRowQuotes() }
            .refreshable { await refreshMarket() }
            .onAppear { focusSymbol = api.currentSymbol }
            .onChange(of: api.currentSymbol) { _, value in focusSymbol = value }
    }
    private func refreshMarket() async {
        guard !refreshingMarket else { return }
        refreshingMarket = true
        defer { refreshingMarket = false }
        await api.load(tab: .market, symbol: api.currentSymbol, refreshQuote: true)
        await loadRowQuotes(refresh: true)
    }
    private func loadRowQuotes(refresh: Bool = false) async {
        if !refresh { rowQuotes = [:] }
        quoteFailures = []; rowRefreshIssues = [:]
        let context = AppEnvironment.researchAuthorizationContext()
        let client = MarketQuoteClient(baseURL: context.baseURL, authToken: context.readToken, authHeaderName: context.readHeaderName,
                                       writeAuthToken: context.writeToken, writeAuthHeaderName: context.writeHeaderName)
        for candidate in api.candidates.prefix(12) {
            guard !Task.isCancelled, let parsed = SecuritySymbol.parseHongKongAlias(candidate.symbol) else { return }
            do {
                let quote: MarketQuoteEnvelope
                if refresh && candidate.symbol != api.currentSymbol && context.writeToken?.isEmpty == false {
                    quote = try await client.refreshQuote(market: parsed.market, code: parsed.code)
                } else {
                    quote = try await client.fetchQuote(market: parsed.market, code: parsed.code)
                }
                guard !Task.isCancelled, context == AppEnvironment.researchAuthorizationContext() else { return }
                if quote.isUsableQuote { rowQuotes[candidate.symbol] = quote }
                else { quoteFailures.insert(candidate.symbol); rowRefreshIssues[candidate.symbol] = "本次未取得有效报价，请稍后重试。" }
            } catch {
                guard !Task.isCancelled, context == AppEnvironment.researchAuthorizationContext() else { return }
                quoteFailures.insert(candidate.symbol)
                rowRefreshIssues[candidate.symbol] = "本次刷新失败；如有旧快照，仅供历史参考。"
            }
        }
    }

    private var marketOperations: some View {
        VStack(alignment: .leading, spacing: 8) {
            if api.loading { ProgressView("正在读取市场数据…").font(.system(size: 11)) }
            if let message = api.marketRefreshMessage {
                Text(message).font(.system(size: 11)).foregroundColor(Theme.textSecondary)
                    .accessibilityIdentifier("clientMarketRefreshResult")
            }
            if let fetchedAt = api.quote?.source.fetchedAt {
                Text("OpenD 读取时间：\(fetchedAt)").font(.system(size: 10)).foregroundColor(Theme.textTertiary)
            }
            ForEach(["quoteRefresh", "quote", "daily", "environment", "weinstein", "discovery"], id: \.self) { key in
                if let issue = api.issues[key] { Text(issue).font(.system(size: 11)).foregroundColor(Theme.amber) }
            }
            HStack(spacing: 14) {
                Button("行情与技术详情") { actions.workflow(.market) }
                Button("市场环境") { actions.workflow(.environment) }
                Button("发现与公告") { actions.workflow(.announcements) }
            }.font(.system(size: 11, weight: .semibold)).foregroundColor(Theme.blue)
            HStack(spacing: 14) {
                Button("AI 辅助") { actions.assistant() }
                Button("连接设置") { actions.connection() }
            }.font(.system(size: 11)).foregroundColor(Theme.gold)
        }
    }

    // MARK: - 1. Focus Stock Switcher
    private var focusStockHeaderSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("当前观测标的")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                if let quote = api.quote, quote.isUsableQuote {
                    StatusBadgeView(.real(source: quote.source.provider.rawValue,
                        freshness: quote.status.rawValue == "live" ? .fresh : .stale,
                        timestamp: quote.asOf ?? "未读取"))
                } else { StatusBadgeView(.unavailable(reason: "报价未返回")) }
            }
            
            // Candidate Quick Switcher Pills
            HStack(spacing: 8) {
                ForEach(api.candidates) { candidate in
                    focusPill(symbol: candidate.symbol, name: candidate.name, tag: candidate.state)
                }
            }
        }
    }
    
    private func focusPill(symbol: String, name: String, tag: String) -> some View {
        let isSelected = focusSymbol == symbol
        return Button(action: {
            focusSymbol = symbol
            api.selectSymbol(symbol)
        }) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(symbol)
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(isSelected ? Theme.gold : Theme.textTertiary)
                    Spacer()
                    if isSelected {
                        Circle()
                            .fill(Theme.green)
                            .frame(width: 5, height: 5)
                    }
                }
                Text(name)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundColor(isSelected ? Theme.textPrimary : Theme.textSecondary)
                Text(tag)
                    .font(.system(size: 9.5))
                    .foregroundColor(isSelected ? Theme.gold : Theme.textTertiary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? Theme.bgCardElevated : Theme.bgCard)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(isSelected ? Theme.gold.opacity(0.8) : Theme.border, lineWidth: isSelected ? 1.5 : 1)
            )
        }
        .buttonStyle(.plain)
    }
    
    // MARK: - 2. Focus Stock Real-time Diagnostics (Weinstein + Technical Indicators)
    private var focusStockDiagnosticsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Price & Name Bar
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(currentDisplayName)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(Theme.textPrimary)
                        Text(focusSymbol)
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundColor(Theme.gold)
                    }
                    Text(api.activeQuote.map { "\($0.isStale ? "历史参考" : "行情快照") · \($0.quoteTime)" } ?? "行情暂不可用")
                        .font(.system(size: 10))
                        .foregroundColor(Theme.textTertiary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(templateNumber(currentDisplayPrice, format: "%.2f HKD"))
                        .font(.system(size: 20, weight: .bold, design: .monospaced))
                        .foregroundColor(Theme.textPrimary)
                    Text(currentDisplayChangeText)
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        .foregroundColor(currentDisplayIsPositive ? Theme.green : Theme.red)
                }
            }
            
            Divider().background(Theme.border)
            
            // Capital Flow & Volume Pulse
            HStack(spacing: 12) {
                metricCol(title: "主力资金流向", value: templateNumber(api.marketEnvironment?.stockNetFlow.map { $0 / 10000 }, format: "%.2f 万 HKD"), tint: Theme.green)
                metricCol(title: "超大单净流入", value: "未返回", tint: Theme.green)
                metricCol(title: "成交量比", value: "未返回", tint: Theme.gold)
                metricCol(title: "换手率", value: "未返回", tint: Theme.textSecondary)
            }
            
            // Weinstein Stage Analysis Banner
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: "chart.line.uptrend.xyaxis")
                        .foregroundColor(Theme.gold)
                        .font(.system(size: 13))
                    Text("Stan Weinstein 周线阶段分析")
                        .font(.system(size: 12.5, weight: .bold))
                        .foregroundColor(Theme.textPrimary)
                    Spacer()
                    Text(currentWeinsteinStageText)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(Theme.green)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Theme.green.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
                
                Text(currentWeinsteinObservationText)
                    .font(.system(size: 11.5))
                    .foregroundColor(Theme.textSecondary)
                    .lineLimit(2)
                
                HStack(spacing: 12) {
                    Text("30周均线: \(api.weinsteinAnalysis?.ma30wDirection ?? "未返回")")
                        .font(.system(size: 10))
                        .foregroundColor(Theme.textTertiary)
                    Spacer()
                    Text("阻力: \(api.weinsteinAnalysis?.resistanceLevel ?? "未返回") · 支撑: \(api.weinsteinAnalysis?.supportLevel ?? "未返回")")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(Theme.textTertiary)
                }
            }
            .padding(10)
            .background(Theme.bgSecondary)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            WeinsteinDecisionSummaryView(envelope: focusSymbol == api.currentSymbol ? api.weinstein : nil)
                .accessibilityIdentifier("marketWeinsteinDecisionSummary")
            
            // Daily Technical Indicators (MA, MACD, Bollinger, RSI)
            if let tech = api.technicalIndicators, focusSymbol == api.currentSymbol {
                HStack(spacing: 8) {
                    techBox(name: "MA20/60", val: String(format: "%.2f/%.2f", tech.ma20, tech.ma60), desc: "后端均线", status: Theme.green)
                    techBox(name: "MACD", val: String(format: "%.2f", tech.macdHistogram), desc: "后端动量", status: Theme.green)
                    techBox(name: "BOLL", val: String(format: "%.2f", tech.bollingerMiddle), desc: "后端波动", status: Theme.blue)
                    techBox(name: "RSI14", val: String(format: "%.1f", tech.rsi14), desc: "后端RSI", status: Theme.gold)
                }
            }
            
            // Research Admission Handoff Button
            Button(action: {
                api.selectSymbol(focusSymbol)
                actions.workflow(.report)
            }) {
                HStack {
                    Image(systemName: "arrow.up.right.square")
                        .font(.system(size: 13, weight: .semibold))
                    Text("前往深度投研 · \(currentDisplayName) 年轮决策与双层研报 →")
                        .font(.system(size: 12.5, weight: .bold))
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11))
                }
                .foregroundColor(Theme.gold)
                .padding(.vertical, 10)
                .padding(.horizontal, 12)
                .background(Theme.gold.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(14)
        .templateCardStyle()
    }
    
    private func metricCol(title: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 10))
                .foregroundColor(Theme.textTertiary)
            Text(value)
                .font(.system(size: 11.5, weight: .bold, design: .monospaced))
                .foregroundColor(tint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    
    private func techBox(name: String, val: String, desc: String, status: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(name)
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(Theme.textTertiary)
                Spacer()
                Circle().fill(status).frame(width: 4, height: 4)
            }
            Text(val)
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundColor(Theme.textPrimary)
            Text(desc)
                .font(.system(size: 8.5))
                .foregroundColor(status)
        }
        .padding(6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.bgSecondary)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
    
    // MARK: - 3. Macro Market Pulse & Breadth Sentiment
    private var macroEnvironmentSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("宏观盘面与市场情绪")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                if let env = api.marketEnvironment {
                    Text("市场状态: \(env.marketState) · \(env.breadthLabel)")
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundColor(Theme.gold)
                }
            }
            
            // Indices Carousel
            if let env = api.marketEnvironment {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(env.indices) { idx in
                            VStack(alignment: .leading, spacing: 5) {
                                HStack {
                                    Text(idx.name)
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundColor(Theme.textSecondary)
                                    Spacer()
                                    Text(String(format: "%+.2f%%", idx.changePercent))
                                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                                        .foregroundColor(idx.isPositive ? Theme.green : Theme.red)
                                }
                                Text(String(format: "%.2f", idx.last))
                                    .font(.system(size: 16, weight: .bold, design: .monospaced))
                                    .foregroundColor(Theme.textPrimary)
                                HStack {
                                    Text("成交 \(String(format: "%.0f亿", idx.turnover / 100000000))")
                                        .font(.system(size: 9.5))
                                        .foregroundColor(Theme.textTertiary)
                                    Spacer()
                                    Text("\(idx.advancers)涨 / \(idx.decliners)跌")
                                        .font(.system(size: 9.5))
                                        .foregroundColor(Theme.textTertiary)
                                }
                            }
                            .frame(width: 145)
                            .padding(10)
                            .templateCardStyle()
                        }
                    }
                }
                
                // Market Breadth Pulse Bar
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("恒指成分股涨跌广度")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(Theme.textSecondary)
                        Spacer()
                        Text("上涨 \(env.advancersCount) 家 · 下跌 \(env.declinersCount) 家 · 持平 \(env.unchangedCount) 家 · 上涨占比 \(String(format: "%.1f%%", env.advanceRatio * 100))")
                            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                            .foregroundColor(Theme.textPrimary)
                    }
                    
                    // Ratio progress bar
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Theme.red.opacity(0.7))
                                .frame(height: 6)
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Theme.green)
                                .frame(width: proxy.size.width * max(0, min(1, env.advanceRatio)), height: 6)
                        }
                    }
                    .frame(height: 6)
                    
                    HStack {
                        Text("广度信号：\(env.breadthLabel)")
                            .font(.system(size: 9.5))
                            .foregroundColor(env.riskSignal == "broad_strength" ? Theme.green : env.riskSignal == "broad_weakness" ? Theme.red : Theme.gold)
                        Spacer()
                        Text(String(format: "恒指振幅 %.2f%% · 行业分化 %.2f%%", env.hsiAmplitudePercent, env.sectorDispersionPercent))
                            .font(.system(size: 9.5))
                            .foregroundColor(Theme.textTertiary)
                    }
                }
                .padding(10)
                .templateCardStyle()
                
                // Sector Pulse: Leaders vs Laggards
                HStack(alignment: .top, spacing: 10) {
                    // Leaders
                    VStack(alignment: .leading, spacing: 4) {
                        Text("领涨行业板块")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(Theme.green)
                        ForEach(env.leaders.prefix(3)) { s in
                            HStack {
                                Text(s.name)
                                    .font(.system(size: 11))
                                    .foregroundColor(Theme.textPrimary)
                                    .lineLimit(1)
                                Spacer()
                                Text(String(format: "%+.2f%%", s.changePercent))
                                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                                    .foregroundColor(Theme.green)
                            }
                            .padding(.vertical, 1)
                        }
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity)
                    .background(Theme.bgSecondary)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    
                    // Laggards
                    VStack(alignment: .leading, spacing: 4) {
                        Text("领跌行业板块")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(Theme.red)
                        ForEach(env.laggards.prefix(3)) { s in
                            HStack {
                                Text(s.name)
                                    .font(.system(size: 11))
                                    .foregroundColor(Theme.textPrimary)
                                    .lineLimit(1)
                                Spacer()
                                Text(String(format: "%+.2f%%", s.changePercent))
                                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                                    .foregroundColor(Theme.red)
                            }
                            .padding(.vertical, 1)
                        }
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity)
                    .background(Theme.bgSecondary)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .templateCardStyle()
            }
        }
    }
    
    // MARK: - 4. Cross-Stock Trend & Weinstein Comparison Matrix
    private var portfolioTrendComparisonSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("标的周线形态横向对照")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Text("基于 Stan Weinstein 30周趋势模型")
                    .font(.system(size: 10))
                    .foregroundColor(Theme.textTertiary)
            }
            
            VStack(spacing: 8) {
                ForEach(api.candidates) { candidate in
                    trendRow(symbol: candidate.symbol, name: candidate.name, stage: candidate.stage,
                        maSlope: candidate.symbol == api.currentSymbol ? api.weinsteinAnalysis?.ma30wDirection ?? "未返回" : "未读取",
                        strength: "未读取相对强弱", advice: candidate.currentDossier.nextActionTitle, badgeColor: Theme.blue)
                }
            }
            .padding(10)
            .templateCardStyle()
        }
    }
    
    private func trendRow(symbol: String, name: String, stage: String, maSlope: String, strength: String, advice: String, badgeColor: Color) -> some View {
        Button(action: {
            focusSymbol = symbol
            api.selectSymbol(symbol)
        }) {
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Text(name)
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundColor(Theme.textPrimary)
                        Text(symbol)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(Theme.textTertiary)
                    }
                    Text(strength)
                        .font(.system(size: 10))
                        .foregroundColor(Theme.textSecondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(stage)
                        .font(.system(size: 10.5, weight: .bold))
                        .foregroundColor(badgeColor)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(badgeColor.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                    Text(advice)
                        .font(.system(size: 9.5))
                        .foregroundColor(Theme.textTertiary)
                }
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
    }
    
    // MARK: - 5. Discovery Universe & HKEX Announcements
    private var discoveryAndAnnouncementsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("分类", selection: $discoveryTab) {
                Text("港股通发现池 (\(api.discoveryCandidates.count))").tag(0)
                Text("公告与线索 (\(api.announcements.count + (api.discovery?.notices.items.count ?? 0)))").tag(1)
            }
            .pickerStyle(.segmented)
            
            if discoveryTab == 0 {
                discoveryCandidatesList
            } else {
                announcementsAndLeadsList
            }
        }
    }
    
    private var filteredDiscoveryCandidates: [DiscoveryCandidate] {
        let query = discoverySearch.trimmingCharacters(in: .whitespacesAndNewlines)
        return query.isEmpty ? api.discoveryCandidates : api.discoveryCandidates.filter {
            $0.symbol.localizedCaseInsensitiveContains(query) || $0.name.localizedCaseInsensitiveContains(query)
        }
    }
    private var discoveryCandidatesList: some View {
        VStack(spacing: 8) {
            // Filter rule note
            HStack {
                Image(systemName: "info.circle")
                    .foregroundColor(Theme.gold)
                    .font(.system(size: 11))
                Text(api.discovery?.candidates.rule.summary ?? (api.loading ? "正在读取实际筛选条件" : "筛选来源暂不可用，请刷新重试"))
                    .font(.system(size: 10))
                    .foregroundColor(Theme.textTertiary)
                Spacer()
            }
            .padding(.horizontal, 4)
            
            if let lane = api.discovery?.candidates, lane.status == .available {
                VStack(alignment: .leading, spacing: 5) {
                    if let universe = lane.universe {
                        Text("官方名单：\(universe.effectiveDate) · \(universe.memberCount) 只")
                    }
                    Text("全港股基础筛选命中 \(lane.totalMatched ?? 0) 只 · 港股通可用候选 \(lane.candidates.count) 只")
                        .accessibilityIdentifier("clientDiscoveryCoverage")
                    Text(lane.coverage?.scope == "market" && lane.coverage?.complete == true
                         ? "已读完全部筛选分页；下方分批展示，可搜索全部结果。" : "来源未提供完整覆盖证明。")
                    if let missing = lane.coverage?.unavailableSymbols, !missing.isEmpty {
                        Text("另有 \(missing.count) 只港股通股票行情字段不完整，未计入可用候选。")
                            .foregroundStyle(Theme.amber)
                        DisclosureGroup("查看缺失标的") { Text(missing.joined(separator: "、")) }
                    }
                    Text("读取时间：\(lane.fetchedAt ?? "未提供")")
                }.font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                TextField("搜索本次候选的代码或名称", text: $discoverySearch)
                    .font(.system(size: 12)).padding(10).background(Theme.bgSecondary)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityIdentifier("clientDiscoverySearch")
                    .onChange(of: discoverySearch) { _, _ in discoveryLimit = 20 }
            }
            if api.loading && api.discovery == nil {
                HStack {
                    ProgressView().tint(Theme.gold)
                    Text("正在读取全市场筛选分页…")
                        .font(.system(size: 12))
                        .foregroundColor(Theme.textSecondary)
                }
                .padding(20)
                .frame(maxWidth: .infinity)
                .templateCardStyle()
            } else if api.discovery?.candidates.status != .available {
                Text(api.issues["discovery"] ?? api.discovery?.candidates.message ?? "发现池暂不可用，请刷新重试。")
                    .font(.system(size: 12)).foregroundStyle(Theme.amber).padding(12)
                    .accessibilityIdentifier("clientDiscoveryUnavailable")
            } else if filteredDiscoveryCandidates.isEmpty {
                Text(api.discoveryCandidates.isEmpty ? "本次完整筛选没有符合条件的港股通股票。" : "本次候选中没有匹配此搜索的股票。")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).padding(12)
            } else {
                ForEach(filteredDiscoveryCandidates.prefix(discoveryLimit)) { c in
                    Button(action: {
                        focusSymbol = c.symbol
                        api.selectSymbol(c.symbol)
                    }) {
                        HStack(alignment: .center) {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Text(c.symbol)
                                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                                        .foregroundColor(Theme.gold)
                                    Text(c.name)
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundColor(Theme.textPrimary)
                                    Text(c.industry)
                                        .font(.system(size: 9.5))
                                        .foregroundColor(Theme.textTertiary)
                                        .padding(.horizontal, 4)
                                        .padding(.vertical, 1)
                                        .background(Theme.bgSecondary)
                                        .clipShape(RoundedRectangle(cornerRadius: 3))
                                }
                                Text(c.why)
                                    .font(.system(size: 10.5))
                                    .foregroundColor(Theme.textSecondary)
                                    .lineLimit(1)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(String(format: "%.2f", c.price))
                                    .font(.system(size: 13.5, weight: .bold, design: .monospaced))
                                    .foregroundColor(Theme.textPrimary)
                                Text(String(format: "%+.2f%%", c.changePercent))
                                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                                    .foregroundColor(c.changePercent >= 0 ? Theme.green : Theme.red)
                            }
                        }
                        .padding(10)
                        .templateCardStyle()
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("clientDiscoveryCandidate-\(c.symbol)")
                }
                Text("显示 \(min(discoveryLimit, filteredDiscoveryCandidates.count)) / \(filteredDiscoveryCandidates.count) 只 · 涨跌幅为近5日")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                if discoveryLimit < filteredDiscoveryCandidates.count {
                    Button("显示更多候选") { discoveryLimit += 20 }
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.gold)
                        .accessibilityIdentifier("clientDiscoveryShowMore")
                }
            }
        }
    }
    
    private var announcementsAndLeadsList: some View {
        VStack(spacing: 8) {
            HStack {
                Text("联交所官方披露易公告 × 待核验舆情线索")
                    .font(.system(size: 10.5))
                    .foregroundColor(Theme.textTertiary)
                Spacer()
                Text("点击可打开官方 PDF 或带入投研")
                    .font(.system(size: 10))
                    .foregroundColor(Theme.blue)
            }
            .padding(.horizontal, 4)
            
            Text("本页展示当前股票最近的至多10条官方公告及10条OpenD线索。")
                .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            if let rawURL = api.discovery?.announcements.sourceUrl, let url = URL(string: rawURL), url.scheme == "https" {
                Link("前往披露易查看完整公告记录", destination: url)
                    .font(.system(size: 11)).foregroundStyle(Theme.blue)
            }
            if let lane = api.discovery?.notices {
                if lane.status == .unavailable {
                    Text("OpenD线索暂不可用；官方公告仍单独展示。")
                        .font(.system(size: 11)).foregroundStyle(Theme.amber)
                } else {
                    ForEach(lane.items) { item in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("OpenD线索 · 待核验 · \(item.symbol)")
                                .font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.amber)
                            Text(item.title).font(.system(size: 12)).foregroundStyle(Theme.textPrimary)
                            Text("\(item.source) · \(item.publishedAt)")
                                .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                            if let url = item.externalURL { Link("打开线索原始来源", destination: url).font(.system(size: 11)).foregroundStyle(Theme.blue) }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(10).templateCardStyle()
                        .accessibilityIdentifier("clientNoticeLead-\(item.id)")
                    }
                }
            }
            if api.announcements.isEmpty {
                Text(api.loading ? "正在读取官方公告…" : api.discovery?.announcements.status == .unavailable ? "官方公告暂不可用，请刷新重试。" : "本次查询窗口没有返回官方公告。")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.textTertiary)
                    .padding(20)
            } else {
                ForEach(api.announcements, id: \.id) { a in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(a.symbol)
                                .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                                .foregroundColor(Theme.gold)
                            Text(a.category)
                                .font(.system(size: 9.5, weight: .medium))
                                .foregroundColor(Theme.blue)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 1.5)
                                .background(Theme.blue.opacity(0.12))
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                            Spacer()
                            Text(a.publishedDate.prefix(10))
                                .font(.system(size: 10.5))
                                .foregroundColor(Theme.textTertiary)
                        }
                        Text(a.title)
                            .font(.system(size: 12.5, weight: .medium))
                            .foregroundColor(Theme.textPrimary)
                            .lineLimit(2)
                        HStack {
                            Text(a.why)
                                .font(.system(size: 10.5))
                                .foregroundColor(Theme.textSecondary)
                                .lineLimit(1)
                            Spacer()
                            if let url = URL(string: a.documentUrl), !a.documentUrl.isEmpty {
                                Link(destination: url) {
                                    HStack(spacing: 2) {
                                        Image(systemName: "doc.text")
                                        Text("官方 PDF")
                                    }
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundColor(Theme.blue)
                                }
                            }
                        }
                    }
                    .padding(10)
                    .templateCardStyle()
                }
            }
        }
    }
    
    // MARK: - Computed Helpers
    private var currentDisplayName: String { api.candidate(for: focusSymbol).name }
    
    private var currentDisplayPrice: Double? { api.quotesBySymbol[focusSymbol]?.price }
    
    private var currentDisplayChangeText: String { templateNumber(api.quotesBySymbol[focusSymbol]?.changePercent, format: "%+.2f%%") }
    
    private var currentDisplayIsPositive: Bool { api.quotesBySymbol[focusSymbol]?.isPositive ?? false }
    
    private var currentWeinsteinStageText: String { api.weinsteinAnalysis?.stockStage ?? "暂不可用" }
    
    private var currentWeinsteinObservationText: String { api.weinsteinAnalysis?.keyObservation ?? "尚未返回周线分析。" }
}
