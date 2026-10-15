import SwiftUI
import CryptoKit
import UserNotifications

struct MarketAnomalySelection: Identifiable {
    let membershipId: String
    let symbol: String
    let version: Int
    var startAI: Bool = false
    var id: String { "\(membershipId):\(version)" }
}

private struct MarketAnomalyBundle: Decodable {
    struct Anomaly: Decodable {
        struct Quote: Decodable { let price: Double; let previousClose: Double; let changePercent: Double; let quoteTime: String }
        struct Benchmark: Decodable { let symbol: String; let changePercent: Double; let asOf: String }
        let id: String; let fingerprint: String; let ruleVersion: String
        let symbol: String; let membershipId: String; let membershipVersion: Int; let tradingDate: String
        let direction: String; let thresholdBand: String; let quote: Quote; let benchmark: Benchmark?
        let relativeChangePoints: Double?; let relativeContext: String; let freshness: String
        let investigationState: String
    }
    struct Fact: Decodable, Identifiable { let text: String; let sourceIds: [String]; var id: String { text } }
    struct Discovery: Decodable {
        struct HKEX: Decodable {
            struct Item: Decodable, Identifiable { let id: String; let title: String; let publishedDate: String; let documentUrl: String }
            let status: String; let checkedDate: String; let items: [Item]
        }
        struct News: Decodable {
            struct Lead: Decodable, Identifiable {
                let id: String; let citationId: String; let title: String; let publisher: String; let publishedAt: String
                let url: String; let evidenceStatus: String
            }
            let status: String; let leads: [Lead]
        }
        let hkex: HKEX; let news: News
    }
    struct DailyHistory: Decodable {
        let status: String; let snapshotSha: String?; let latestSession: String?; let latestClose: Double?
        let previousSession: String?; let previousClose: Double?; let quotePreviousCloseMatches: Bool?
        let volumeAssessment: String
    }
    let ok: Bool; let anomaly: Anomaly; let fingerprint: String
    let confirmedFacts: [Fact]; let possibleExplanations: [Fact]; let unknowns: [String]
    let researchImpact: String; let nextChecks: [String]; let sourceCoverage: String; let discovery: Discovery
    let dailyHistory: DailyHistory?
}

private struct MarketAnomalyAnswer: Codable {
    struct Fact: Codable, Identifiable { let text: String; let sourceIds: [String]; var id: String { text } }
    let ok: Bool; let symbol: String; let membershipId: String; let anomalyId: String; let fingerprint: String
    let confirmedFacts: [Fact]; let possibleExplanations: [Fact]; let counterEvidence: [Fact]
    let unknowns: [Fact]; let researchImpact: String; let nextChecks: [Fact]
    let sourceCoverage: String; let provider: String; let model: String; let generatedAt: String
}

@MainActor
private enum MarketAnomalyClient {
    static func url(_ membershipId: String) -> URL {
        AppEnvironment.baseURL().appending(path: "api/mobile/research/candidate-memberships/\(membershipId)/market-anomaly")
    }
    static func load(_ selection: MarketAnomalySelection) async throws -> MarketAnomalyBundle {
        var request = URLRequest(url: url(selection.membershipId), cachePolicy: .reloadIgnoringLocalCacheData)
        let auth = AppEnvironment.researchAuthorizationContext()
        if let token = auth.readToken { request.setValue(token, forHTTPHeaderField: auth.readHeaderName) }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        let bundle = try JSONDecoder().decode(MarketAnomalyBundle.self, from: data)
        guard bundle.ok, bundle.anomaly.symbol == selection.symbol,
              bundle.anomaly.membershipId == selection.membershipId,
              bundle.anomaly.membershipVersion == selection.version,
              bundle.anomaly.investigationState == "INVESTIGATION_REQUIRED" else { throw URLError(.cannotParseResponse) }
        return bundle
    }
    static func investigate(_ bundle: MarketAnomalyBundle) async throws -> MarketAnomalyAnswer {
        var request = URLRequest(url: url(bundle.anomaly.membershipId).appending(path: "ai-investigations"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        let auth = AppEnvironment.researchAuthorizationContext()
        if let token = auth.writeToken { request.setValue(token, forHTTPHeaderField: auth.writeHeaderName) }
        request.httpBody = try JSONEncoder().encode(["fingerprint": bundle.fingerprint])
        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 else {
            let message = code == 409 ? "调查期间来源已变化，请重新打开调查。" :
                code == 403 ? "AI 发送授权尚未开启。" : "AI 调查暂不可用（HTTP \(code)）。"
            throw NSError(domain: "MarketAnomaly", code: code, userInfo: [NSLocalizedDescriptionKey: message])
        }
        let answer = try JSONDecoder().decode(MarketAnomalyAnswer.self, from: data)
        guard answer.ok, answer.symbol == bundle.anomaly.symbol,
              answer.membershipId == bundle.anomaly.membershipId,
              answer.anomalyId == bundle.anomaly.id, answer.fingerprint == bundle.fingerprint,
              answer.unknowns.contains(where: { $0.text.contains("ROOT_CAUSE_UNCONFIRMED") }) else {
            throw URLError(.cannotParseResponse)
        }
        return answer
    }
    static func cacheKey(_ bundle: MarketAnomalyBundle) -> String {
        let auth = AppEnvironment.researchAuthorizationContext()
        let scope = SHA256.hash(data: Data((auth.readToken ?? "").utf8))
            .map { String(format: "%02x", $0) }.joined().prefix(16)
        return "personal-anomaly-ai:\(scope):\(bundle.anomaly.membershipId):\(bundle.anomaly.id):\(bundle.fingerprint)"
    }
}

struct PersonalMarketAnomalyDetailView: View {
    let selection: MarketAnomalySelection
    @Environment(\.dismiss) private var dismiss
    @State private var bundle: MarketAnomalyBundle?
    @State private var answer: MarketAnomalyAnswer?
    @State private var issue: String?
    @State private var investigating = false
    @State private var showSources = false
    @State private var investigation: PersonalInvestigationSelection?
    @State private var latestInvestigation: InvestigationTurn?
    @State private var initialAnalysisPending = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let bundle {
                        whatHappened(bundle)
                        section("已确认事实", facts: bundle.confirmedFacts)
                        section("可能解释 · 待核验", facts: bundle.possibleExplanations)
                        section("还不能确定什么", texts: bundle.unknowns.map { $0 == "ROOT_CAUSE_UNCONFIRMED" ? "已检查的行情和公告尚不足以确认公司特异性原因；深入分析会继续读取新闻原文并核对同行。" : $0 })
                        section("对已有研究的影响", texts: [impactText(bundle.researchImpact)])
                        section("下一步核查", texts: bundle.nextChecks)
                        VStack(alignment: .leading, spacing: 8) {
                            Text("搜索覆盖：官方公告 + 公司资料 + Futu Search News + 当前研究库")
                                .font(.caption).foregroundStyle(Theme.textSecondary)
                            Text("公告、财报和授权新闻分别核查；每个来源的实际读取结果见深入分析。").font(.caption).foregroundStyle(Theme.textSecondary)
                            Text("HKEX 当日检索：\(bundle.discovery.hkex.status == "searched" ? "找到 \(bundle.discovery.hkex.items.count) 条元数据" : "暂不可用")。未找到不代表绝无消息。")
                                .font(.caption).foregroundStyle(Theme.textSecondary)
                            Text("Futu 新闻：\(bundle.discovery.news.status == "available" ? "\(bundle.discovery.news.leads.count) 条未核验线索" : "NEWS_DISCOVERY_UNAVAILABLE")")
                                .font(.caption).foregroundStyle(Theme.textSecondary)
                        }.padding(14).templateCardStyle()
                        if !bundle.discovery.news.leads.isEmpty {
                            DisclosureGroup("新闻标题线索 · 不是事实") {
                                ForEach(bundle.discovery.news.leads) { lead in
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(lead.title).font(.caption)
                                        Text("\(lead.publisher) · \(lead.publishedAt) · \(lead.id)").font(.caption2).foregroundStyle(Theme.textTertiary)
                                        if let url = URL(string: lead.url) { Link("打开来源", destination: url).font(.caption2) }
                                    }.padding(.vertical, 4)
                                }
                            }.font(.caption).padding(14).templateCardStyle()
                        }
                        Button {
                            openInvestigation(bundle, start: latestInvestigation == nil)
                        } label: {
                            Label(latestInvestigation == nil ? "深入分析" : "查看分析并继续追问", systemImage: "sparkles")
                                .frame(maxWidth: .infinity).padding(10)
                        }
                        .buttonStyle(.borderedProminent).disabled(investigating)
                        .accessibilityIdentifier("marketAnomalyAIInvestigate")
                        if let issue { Text(issue).font(.caption).foregroundStyle(Theme.amber) }
                        if let latestInvestigation { InvestigationResultSummary(turn: latestInvestigation) }
                        if let answer { DisclosureGroup("早期调查记录（历史）") { aiResult(answer) } }
                        DisclosureGroup("来源与规则详情", isExpanded: $showSources) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("规则：\(bundle.anomaly.ruleVersion) · ≥5% 且相对恒指 ≥3 个百分点；无基准时须 ≥8%")
                                Text("事件：\(bundle.anomaly.id)")
                                Text("指纹：\(bundle.fingerprint)")
                                ForEach(bundle.discovery.hkex.items) { item in
                                    if let url = URL(string: item.documentUrl) { Link("HKEX \(item.title)", destination: url) }
                                }
                            }.font(.caption2).textSelection(.enabled)
                        }.padding(14).templateCardStyle()
                    } else if let issue {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("调查资料暂不可用：\(issue)").foregroundStyle(Theme.amber)
                            Button("重新核对行情与来源") { Task { await loadBundle() } }
                                .buttonStyle(.bordered)
                        }
                    } else { ProgressView("正在核对行情和公开来源…") }
                }.padding(16)
            }
            .background(Theme.bgPrimary.ignoresSafeArea())
            .navigationTitle("异常调查")
            .toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button("完成") { dismiss() } } }
            .sheet(item: $investigation, onDismiss: {
                if OwnerClientStore.shared.hasPersonalFormalDismissalPending { dismiss() }
                else { Task { await refreshInvestigation() } }
            }) { PersonalInvestigationView(selection: $0) }
            .task(id: selection.id) {
                initialAnalysisPending = selection.startAI
                await loadBundle()
            }
        }
    }

    private func loadBundle() async {
        do {
            let current = try await MarketAnomalyClient.load(selection)
            bundle = current; issue = nil; answer = nil; latestInvestigation = nil
            if let data = UserDefaults.standard.data(forKey: MarketAnomalyClient.cacheKey(current)),
               let saved = try? JSONDecoder().decode(MarketAnomalyAnswer.self, from: data),
               saved.fingerprint == current.fingerprint { answer = saved }
            await refreshInvestigation()
            if initialAnalysisPending {
                initialAnalysisPending = false
                openInvestigation(current, start: latestInvestigation == nil)
            }
        } catch { bundle = nil; answer = nil; issue = error.localizedDescription }
    }
    private func openInvestigation(_ current: MarketAnomalyBundle, start: Bool) {
        let date = current.anomaly.tradingDate
        investigation = PersonalInvestigationSelection(membershipId: selection.membershipId,
            membershipVersion: selection.version, symbol: selection.symbol, mode: "price_move",
            question: "\(date)为什么出现异常波动？请比较行业因素与公司特异因素，并核查该日原文。",
            startAnalysis: start, eventDate: date)
    }
    private func refreshInvestigation() async {
        guard let current = bundle else { latestInvestigation = nil; return }
        let result = await InvestigationResultCache.read(id: selection.membershipId, version: selection.version,
            symbol: selection.symbol, mode: "price_move", eventDate: current.anomaly.tradingDate)
        guard bundle?.fingerprint == current.fingerprint else { return }
        latestInvestigation = result
    }

    private func investigate(_ current: MarketAnomalyBundle) async {
        guard !investigating else { return }
        investigating = true; issue = nil
        do {
            let result = try await MarketAnomalyClient.investigate(current)
            answer = result
            if let data = try? JSONEncoder().encode(result) {
                UserDefaults.standard.set(data, forKey: MarketAnomalyClient.cacheKey(current))
            }
        } catch { issue = error.localizedDescription }
        investigating = false
    }

    private func whatHappened(_ data: MarketAnomalyBundle) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("发生了什么").font(.headline)
            Text("\(data.anomaly.symbol) · \(data.anomaly.tradingDate) · \(data.anomaly.quote.changePercent, specifier: "%+.2f")%")
                .font(.title2.bold()).foregroundStyle(data.anomaly.direction == "down" ? Theme.amber : Theme.green)
            Text("HK$\(data.anomaly.quote.price, specifier: "%.2f")，前收 HK$\(data.anomaly.quote.previousClose, specifier: "%.2f")；报价 \(hktTimestamp(data.anomaly.quote.quoteTime))")
            Text(data.anomaly.benchmark.map { "恒指 \($0.changePercent, specifier: "%+.2f")%；相对变化 \(data.anomaly.relativeChangePoints ?? 0, specifier: "%+.2f") 个百分点" }
                 ?? "基准不可用；尚无法核对相对表现")
            Text(data.anomaly.freshness == "fresh" ? "触发时报价；不代表最新价格" : "当日已保存触发观察值，非实时行情")
                .font(.caption).foregroundStyle(Theme.textSecondary)
            if let daily = data.dailyHistory, daily.status == "available" {
                Text("完成交易日日线：\(daily.latestSession ?? "待核查") 收盘 HK$\(daily.latestClose ?? 0, specifier: "%.2f")；前次 \(daily.previousSession ?? "待核查") 收盘 HK$\(daily.previousClose ?? 0, specifier: "%.2f")。尚无同时间成交量基准，不能确认是否放量。")
                    .font(.caption).foregroundStyle(Theme.textSecondary)
                if daily.quotePreviousCloseMatches == false {
                    Text("报价前收与完成日线冲突：暂停 AI 调查，先核对行情来源。")
                        .font(.caption).foregroundStyle(Theme.amber)
                }
            } else {
                Text("完成交易日日线暂不可用；不推断成交量异常。")
                    .font(.caption).foregroundStyle(Theme.textSecondary)
            }
        }.font(.subheadline).padding(14).templateCardStyle().accessibilityIdentifier("marketAnomalyWhatHappened")
    }
    private func section(_ title: String, facts: [MarketAnomalyBundle.Fact]) -> some View {
        section(title, texts: facts.map { "\($0.text) [\($0.sourceIds.joined(separator: ", "))]" })
    }
    private func section(_ title: String, texts: [String]) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.headline)
            ForEach(texts, id: \.self) { Text("• \($0)").font(.subheadline).foregroundStyle(Theme.textPrimary) }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(14).templateCardStyle()
    }
    private func impactText(_ value: String) -> String {
        switch value {
        case "OFFICIAL_MATERIAL_MAY_AFFECT_EXISTING_RESEARCH": "有当日官方材料值得人工核对；未自动修改 正式研究记录。"
        case "POTENTIAL_OPERATING_EVIDENCE_REQUIRES_REVIEW": "潜在经营证据需要人工核对；未自动修改正式研究。"
        default: "目前只有价格异常，没有足够证据改变正式 正式研究记录。"
        }
    }
    private func hktTimestamp(_ raw: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: raw) else { return raw }
        let display = DateFormatter()
        display.timeZone = TimeZone(identifier: "Asia/Hong_Kong")
        display.dateFormat = "yyyy-MM-dd HH:mm:ss 'HKT'"
        return display.string(from: date)
    }
    private func aiResult(_ result: MarketAnomalyAnswer) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("此前的调查回答").font(.headline)
            Text("本机缓存 · \(result.generatedAt) · 下次打开只在相同来源指纹下恢复")
                .font(.caption2).foregroundStyle(Theme.textSecondary)
            aiFacts("已确认", result.confirmedFacts)
            aiFacts("可能解释", result.possibleExplanations)
            aiFacts("反方证据", result.counterEvidence.filter { isVerifiableCounter($0) })
            aiFacts("未核验线索", result.counterEvidence.filter { !isVerifiableCounter($0) })
            aiFacts("仍未知", result.unknowns)
            aiFacts("下一步核查", result.nextChecks)
            Text(impactText(result.researchImpact)).font(.caption)
            Text("来源范围：\(result.sourceCoverage)").font(.caption2).foregroundStyle(Theme.textSecondary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(14).templateCardStyle()
            .accessibilityIdentifier("marketAnomalyAIResult")
    }
    private func isVerifiableCounter(_ fact: MarketAnomalyAnswer.Fact) -> Bool {
        !fact.sourceIds.isEmpty && fact.sourceIds.allSatisfy {
            !isNews($0) && ($0 == "Q" || $0 == "B" || $0.range(of: "^S[0-9]+$", options: .regularExpression) != nil)
        }
    }
    private func isNews(_ sourceId: String) -> Bool {
        sourceId.range(of: "^N[0-9]+$", options: .regularExpression) != nil ||
            bundle?.discovery.news.leads.contains(where: { $0.id == sourceId || $0.citationId == sourceId }) == true
    }
    private func aiFacts(_ title: String, _ facts: [MarketAnomalyAnswer.Fact]) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.caption.bold())
            ForEach(facts) { fact in
                VStack(alignment: .leading, spacing: 2) {
                    Text("• \(fact.text.replacingOccurrences(of: "ROOT_CAUSE_UNCONFIRMED", with: "已检查的来源仍不足以确认具体原因").replacingOccurrences(of: "UNKNOWN", with: "当前资料尚不足以判断")) [\(fact.sourceIds.joined(separator: ", "))]").font(.caption)
                    if fact.sourceIds.contains(where: isNews) {
                        Text("新闻标题线索 · 未核验").font(.caption2).foregroundStyle(Theme.amber)
                    }
                }
            }
        }
    }
}

@MainActor
enum PersonalMarketAnomalyNotification {
    static func observe(_ item: TodayActionInboxItem) async {
        guard item.kind == .marketAnomaly else { return }
        let key = "personal-anomaly-notified:\(item.id)"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        let content = UNMutableNotificationContent()
        content.title = item.title
        content.body = item.summary
        do {
            try await center.add(UNNotificationRequest(identifier: item.id, content: content, trigger: nil))
            UserDefaults.standard.set(true, forKey: key)
        } catch { /* Today card remains the source of truth when local notification fails. */ }
    }
}
