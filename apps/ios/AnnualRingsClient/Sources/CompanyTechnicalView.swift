import SwiftUI

struct CompanyTechnicalView: View {
    let symbol: String
    @ObservedObject private var store = OwnerClientStore.shared
    @State private var requestRevision = UUID()
    @State private var quote: MarketQuoteEnvelope?
    @State private var daily: MarketDailyTechnicalEnvelope?
    @State private var weekly: WeinsteinTechnicalAnalysisEnvelope?
    @State private var historicalPrice: HistoricalWeeklyPrice?
    @State private var selectedDate = Date()
    @State private var observationAsOf = currentHongKongRequestDate()
    @State private var busy = false
    @State private var message: String?
    @State private var quoteIssue: String?
    @State private var dailyIssue: String?
    @State private var weeklyIssue: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                DatePicker("查看截止日", selection: $selectedDate,
                    in: Self.earliestDate...Date(), displayedComponents: .date)
                    .datePickerStyle(.compact)
                    .accessibilityIdentifier("companyTechnicalHistoryDate")
                if isHistorical {
                    HStack {
                        Text("历史观察 · \(selectedAsOf) · 不显示当前报价")
                        Spacer()
                        Button("回到今天") { selectedDate = Date() }
                    }.font(.subheadline)
                }
                HStack {
                    Text(symbol).font(.headline)
                    Spacer()
                    Button(busy ? "读取中…" : "重新读取图表") { Task { await load(refresh: false) } }
                        .disabled(busy).accessibilityIdentifier("companyTechnicalRead")
                }
                Button(isHistorical ? "补取所选日期的日线" : "刷新报价与日线") { Task { await load(refresh: true) } }
                    .disabled(busy || AppEnvironment.researchAuthorizationContext().writeToken == nil)
                    .accessibilityIdentifier("companyTechnicalRefresh")
                if AppEnvironment.researchAuthorizationContext().writeToken == nil {
                    Text("提供商刷新需要连接写入授权；重新读取已存图表仍可使用。")
                        .font(.caption).foregroundStyle(Theme.textSecondary)
                }
                if !isHistorical, let quote, let data = quote.data, quote.isUsableQuote {
                    Text("\(data.price.formatted(.number.precision(.fractionLength(2)))) 港元")
                        .font(.largeTitle).monospacedDigit()
                    Text("\(quote.status.rawValue == "live" ? "当前报价" : "过期报价快照") · \(WorkspaceTimestamp.hongKong(data.quoteTime))")
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                }
                if busy { ProgressView("正在读取行情与技术数据…") }
                if let message { Text(message).font(.footnote).foregroundStyle(Theme.amber) }
                if let quoteIssue { Text(quoteIssue).font(.footnote).foregroundStyle(Theme.amber) }
                if let dailyIssue { Text(dailyIssue).font(.footnote).foregroundStyle(Theme.amber) }
                if let weeklyIssue { Text(weeklyIssue).font(.footnote).foregroundStyle(Theme.amber) }
                ResearchWeinsteinTechnicalAnalysisView(
                    envelope: weekly, dailyEnvelope: daily,
                    context: isHistorical ? .historicalObservation : .currentObservation,
                    expectedSymbol: symbol, observationAsOf: observationAsOf,
                    historicalPrice: historicalPrice
                )
                if let daily {
                    DisclosureGroup("日线数值与来源细节") {
                        MarketDailyTechnicalView(envelope: daily)
                    }
                }
                Text(isHistorical
                    ? "历史日线按所选截止日读取。完整周线仅显示当日已保存的证据；没有历史行业证据时只显示个股周 K，不推断阶段。"
                    : "大盘、所属行业与个股的30周结构来自已完成周线；日线按自己的完成交易日观察。盘中报价单独更新，不生成订单或交易。")
                    .font(.caption).foregroundStyle(Theme.textSecondary)
            }.padding(20)
        }.background(Theme.bgPrimary).navigationTitle("个股技术分析")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: "\(symbol):\(store.authorizationRevision)") { await load(refresh: false, replacing: true) }
            .onChange(of: selectedDate) { _, _ in
                requestRevision = UUID()
                quote = nil; daily = nil; weekly = nil; historicalPrice = nil
                Task { await load(refresh: false, replacing: true) }
            }
            .onDisappear { requestRevision = UUID() }
            .refreshable { await load(refresh: true) }
    }

    private static let earliestDate: Date = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Hong_Kong")!
        return calendar.date(from: DateComponents(year: 2024, month: 1, day: 1))!
    }()

    private var selectedAsOf: String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Hong_Kong")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: selectedDate)
    }

    private var isHistorical: Bool { selectedAsOf < currentHongKongRequestDate() }

    private func load(refresh: Bool, replacing: Bool = false) async {
        guard (replacing || !busy), let parsed = SecuritySymbol.parseHongKongAlias(symbol) else { return }
        let revision = UUID(); requestRevision = revision
        if replacing { quote = nil; daily = nil; weekly = nil; historicalPrice = nil }
        let asOf = selectedAsOf
        let historical = asOf < currentHongKongRequestDate()
        observationAsOf = asOf
        busy = true; message = nil
        quoteIssue = nil; dailyIssue = nil; weeklyIssue = nil
        defer { if requestRevision == revision { busy = false } }
        let auth = AppEnvironment.researchAuthorizationContext()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 90; config.timeoutIntervalForResource = 120
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let quotes = MarketQuoteClient(baseURL: auth.baseURL, session: session,
            authToken: auth.readToken, authHeaderName: auth.readHeaderName,
            writeAuthToken: auth.writeToken, writeAuthHeaderName: auth.writeHeaderName)
        let bars = MarketDailyTechnicalClient(baseURL: auth.baseURL, session: session,
            authToken: auth.readToken, authHeaderName: auth.readHeaderName,
            writeAuthToken: auth.writeToken, writeAuthHeaderName: auth.writeHeaderName)
        if refresh && auth.writeToken?.isEmpty != false {
            message = "刷新行情需要连接授权，请在连接与授权中核对。"; return
        }
        if !historical {
            do {
                let value = refresh ? try await quotes.refreshQuote(market: parsed.market, code: parsed.code)
                    : try await quotes.fetchQuote(market: parsed.market, code: parsed.code)
                guard requestRevision == revision, !Task.isCancelled,
                      auth == AppEnvironment.researchAuthorizationContext() else { return }
                quote = value
            } catch {
                guard requestRevision == revision, auth == AppEnvironment.researchAuthorizationContext() else { return }
                quoteIssue = "新报价读取失败；已有报价仅按标注时间参考，日线和周线仍可单独阅读。"
            }
        }
        do {
            let value = refresh ? try await bars.refresh(market: parsed.market, code: parsed.code, cutoff: historical ? asOf : nil)
                : try await bars.fetch(market: parsed.market, code: parsed.code, cutoff: historical ? asOf : nil)
            guard requestRevision == revision, !Task.isCancelled, auth == AppEnvironment.researchAuthorizationContext() else { return }
            let lastCompletedSession = value.dailyBars.snapshot?.lastCompletedSession
            if value.isBound(to: parsed.canonical),
               (historical ? value.dailyBars.request.cutoff == asOf : value.dailyBars.request.cutoff <= asOf),
               lastCompletedSession.map({ $0 <= asOf }) != false {
                daily = value
            } else {
                dailyIssue = "日线股票或截止日不符，本次不展示。"
                daily = nil
            }
        } catch {
            guard requestRevision == revision, auth == AppEnvironment.researchAuthorizationContext() else { return }
            dailyIssue = "所选日期的日线读取未完成；周线可单独查看。"
        }
        do {
            let client = WeinsteinTechnicalAnalysisClient(baseURL: auth.baseURL, session: session,
                authToken: auth.readToken, authHeaderName: auth.readHeaderName)
            let value = try await client.fetch(market: parsed.market, code: parsed.code,
                analysisAsOf: asOf)
            guard requestRevision == revision, !Task.isCancelled, auth == AppEnvironment.researchAuthorizationContext() else { return }
            if value.symbol != parsed.canonical || value.analysisAsOf != asOf {
                weeklyIssue = "周线股票或观察日不符，本次不展示。"
                weekly = nil
            } else {
                weekly = value
            }
        } catch {
            guard requestRevision == revision, auth == AppEnvironment.researchAuthorizationContext() else { return }
            weeklyIssue = "所选日期的完整周线分析暂不可用；日线可单独查看。"
        }
        if historical && weekly?.status != "available" {
            do {
                let client = WeinsteinTechnicalAnalysisClient(baseURL: auth.baseURL, session: session,
                    authToken: auth.readToken, authHeaderName: auth.readHeaderName)
                let value = try await client.fetchHistoricalPrice(market: parsed.market, code: parsed.code, analysisAsOf: asOf)
                guard requestRevision == revision, !Task.isCancelled,
                      auth == AppEnvironment.researchAuthorizationContext() else { return }
                historicalPrice = value
            } catch {
                guard requestRevision == revision, auth == AppEnvironment.researchAuthorizationContext() else { return }
                weeklyIssue = "历史个股周 K 暂不可用；没有该日完整行业证据时不显示阶段结论。"
            }
        }
    }
}
