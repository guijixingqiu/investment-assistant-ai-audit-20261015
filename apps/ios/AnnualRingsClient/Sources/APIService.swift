import Foundation
import SwiftUI

/// Antigravity presentation adapter over the project's validated API clients.
@MainActor
final class OwnerClientStore: ObservableObject {
    static let shared = OwnerClientStore()

    @Published var selectedTemplateRing = 0
    @Published var sourceIntake:ResearchSourceIntakeEnvelope?
    @Published var templateFrozen: FrozenResearchEvidenceWorkspace?
    @Published var templateValuation: ResearchValuationScenariosEnvelope?
    @Published var templateDocuments: ResearchDocumentListEnvelope? {
        didSet { templateDocumentProjection = nil }
    }
    @Published var templateReviews: DecisionReviewHistoryEnvelope? {
        didSet { if templateReviews == nil { templateReviewIdentity = nil } }
    }
    private var templateReadAuthorization = ""
    @Published private(set) var authorizationRevision = UUID()

    @Published var researchNavigation: ClientResearchNavigation?
    @Published var todayFormalReviewItem: TodayActionInboxItem?
    @Published var personalFormalHandoff: PersonalFormalResearchHandoff?
    @Published var personalFormalNavigationReadyId: UUID?
    private var personalFormalAwaitingDismissalId: UUID?
    @Published var researchLoopFocusSymbol: String?
    @Published var quote: MarketQuoteEnvelope?
    @Published var environment: MarketEnvironmentEnvelope?
    @Published var candidateOverview: CandidateOverviewEnvelope?
    @Published var membershipEnvelope: CandidateMembershipEnvelope?
    @Published var inbox: TodayActionInboxEnvelope?
    @Published var profile: ResearchProfileData?
    @Published var profileEnvelope: ResearchProfileEnvelope?
    @Published var assets: AssetsAlphaEnvelope?
    @Published var portfolioResearchContext: PortfolioResearchContextResponse?
    @Published var templatePortfolio: PortfolioDecisionContextEnvelope?
    @Published var discovery: MarketDiscoveryEnvelope?
    @Published var daily: MarketDailyTechnicalEnvelope?
    @Published var weinstein: WeinsteinTechnicalAnalysisEnvelope?
    @Published var quotesBySymbol: [String: StockQuote] = [:]
    @Published var issues: [String: String] = [:]
    @Published var loading = false
    @Published var marketRefreshMessage: String?
    @Published var selectedSymbol = AppEnvironment.rawSymbolInput()
    @Published var selectedCandidateIndex = 0

    private var profilesBySymbol: [String: ResearchProfileEnvelope] = [:]
    private var generation = UUID()
    private struct TemplateDocumentIdentity: Equatable {
        let actorId: String
        let id: String
        let version: Int
        let market: String
        let code: String
        let symbol: String
        let state: CandidateMembershipState

        init(_ membership: CandidateMembershipData) {
            actorId = membership.actorId; id = membership.id; version = membership.version
            market = membership.market; code = membership.code; symbol = membership.symbol
            state = membership.state
        }
    }
    private struct TemplateDocumentProjection {
        let identity: TemplateDocumentIdentity
        let authorizationRevision: UUID
        let valid: Bool
        let evidenceFacts: [EvidenceFactItem]
    }
    private var templateDocumentProjection: TemplateDocumentProjection?
    private var templateReviewIdentity: TemplateDocumentIdentity?

    func boundTemplateReviewHistory(symbol: String) -> DecisionReviewHistoryEnvelope? {
        guard selectedSymbol == symbol,
              let member = membershipEnvelope?.memberships.first(where: { $0.symbol == symbol }),
              templateReviewIdentity == TemplateDocumentIdentity(member),
              let history = templateReviews, history.requestedSymbol == symbol else { return nil }
        return history
    }

    private enum Update: Sendable {
        case portfolio(PortfolioDecisionContextEnvelope)
        case frozen(FrozenResearchEvidenceWorkspace)
        case valuation(ResearchValuationScenariosEnvelope)
        case documents(ResearchDocumentListEnvelope)
        case reviews(DecisionReviewHistoryEnvelope)
        case quote(MarketQuoteEnvelope)
        case environment(MarketEnvironmentEnvelope)
        case candidateOverview(CandidateOverviewEnvelope)
        case memberships(CandidateMembershipEnvelope)
        case inbox(TodayActionInboxEnvelope)
        case profile(String, ResearchProfileEnvelope)
        case assets(AssetsAlphaEnvelope)
        case portfolioResearch(PortfolioResearchContextResponse)
        case discovery(MarketDiscoveryEnvelope)
        case daily(MarketDailyTechnicalEnvelope)
        case weinstein(WeinsteinTechnicalAnalysisEnvelope)
        case issue(String, String)
    }

    var isConnected: Bool {
        candidateOverview?.status == .available || inbox?.status == .available
            || quote?.isUsableQuote == true || assets?.status == "available"
    }

    func currentHoldingSummary(symbol: String) -> String {
        if let snapshot = assets?.snapshots.first(where: { $0.source == .ownerCurrent }) {
            guard let position = snapshot.positions.first(where: { $0.symbol == symbol }) else { return "本人录入中无此标的" }
            return String(format: "%.0f 股 · 本人录入", position.quantity)
        }
        guard let portfolio = templatePortfolio, portfolio.status == .available else { return "持仓来源暂不可用" }
        guard portfolio.portfolioSource != "owner_entered_current" else { return "本人录入记录读取中" }
        guard let position = portfolio.positions.first(where: { $0.symbol == symbol }) else { return "当前快照无此标的" }
        return String(format: "%.0f 股 · 账户快照", position.quantity)
    }

    var currentSymbol: String { selectedSymbol }
    var activeQuote: StockQuote? { quotesBySymbol[selectedSymbol] }
    var todayPendingInboxItems: [TodayActionInboxItem] {
        TodayMaterialChangePresentation.nextFirst((inbox?.items ?? []).filter { $0.state == .new })
    }
    var todayInboxAction: TodayActionInboxItem? { todayPendingInboxItems.first }
    /// Re-read both sources before leaving Today. The destination performs its own
    /// exact target readback; this gate prevents a cached card opening another stock.
    func currentTodayItemForNavigation(_ expected: TodayActionInboxItem) async -> TodayActionInboxItem? {
        let authorization = AppEnvironment.researchAuthorizationContext()
        let selectedAtTap = selectedSymbol
        let generationAtTap = generation
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = ResearchClient(baseURL: authorization.baseURL, session: session,
                                    authToken: authorization.readToken, authHeaderName: authorization.readHeaderName)
        async let freshInbox = client.fetchTodayActionInbox()
        async let freshMembers = client.fetchCandidateMemberships(includeArchived: false)
        let (latestInbox, latestMembers) = await (freshInbox, freshMembers)
        guard !Task.isCancelled, generation == generationAtTap,
              authorization == AppEnvironment.researchAuthorizationContext(),
              selectedSymbol == selectedAtTap else { return nil }
        inbox = latestInbox
        membershipEnvelope = latestMembers
        guard latestMembers.status == .available else { return nil }
        let member = latestMembers.memberships.first(where: { $0.id == expected.membership.id })
        return currentTodayNavigationItem(expected: expected, inbox: latestInbox,
            membership: member.map(TodayNavigationMembershipIdentity.init))
    }
    var todayInboxActionTitle: String {
        todayInboxAction.map { TodayMaterialChangePresentation.localizedResearchTitle($0.title) }
            ?? ((inbox?.status == .empty || inbox?.status == .available) ? "当前没有新待办" : "待核验事项暂不可用")
    }

    var marketEnvironment: TemplateMarketEnvironmentData? {
        guard let envelope = environment, let data = envelope.data, let asOf = envelope.asOf else { return nil }
        return TemplateMarketEnvironmentData(
            asOf: asOf,
            marketState: data.marketState,
            indices: data.indices.map {
                IndexQuote(symbol: $0.symbol, name: $0.name, last: $0.last, previousClose: $0.previousClose,
                           changePercent: $0.changePercent, turnover: $0.turnover,
                           advancers: $0.advancers, decliners: $0.decliners)
            },
            leaders: data.sectors.leaders.map {
                SectorInfo(code: $0.code, name: $0.name, changePercent: $0.changePercent,
                           turnover: $0.turnover, advancers: $0.advancers, decliners: $0.decliners)
            },
            laggards: data.sectors.laggards.map {
                SectorInfo(code: $0.code, name: $0.name, changePercent: $0.changePercent,
                           turnover: $0.turnover, advancers: $0.advancers, decliners: $0.decliners)
            },
            advancersCount: data.breadth.advancers,
            declinersCount: data.breadth.decliners,
            advanceRatio: data.breadth.advanceRatio,
            unchangedCount: data.breadth.unchanged,
            hsiAmplitudePercent: data.risk.hsiAmplitudePercent,
            sectorDispersionPercent: data.risk.sectorDispersionPercent,
            stockNetFlow: data.selectedStockCapitalFlow?.netFlow,
            riskSignal: data.risk.breadthSignal,
            unknowns: data.unknowns
        )
    }

    var discoveryCandidates: [DiscoveryCandidate] {
        (discovery?.candidates.candidates ?? []).map {
            DiscoveryCandidate(symbol: $0.symbol, name: $0.name, industry: $0.industry ?? "行业未记录",
                               price: $0.price, changePercent: $0.fiveDayChangePercent, why: $0.why)
        }
    }

    var announcements: [OfficialAnnouncement] {
        (discovery?.announcements.items ?? []).map {
            OfficialAnnouncement(id: $0.id, symbol: $0.symbol, title: $0.title,
                                 publishedDate: $0.publishedDate, category: $0.category.rawValue,
                                 documentUrl: $0.documentUrl, why: $0.why)
        }
    }

    var technicalIndicators: TechnicalIndicatorSnapshot? {
        guard let daily, let point = daily.technical.points?.last,
              let ma20 = point.ma20, let ma60 = point.ma60, let rsi = point.rsi14,
              let macdLine = point.macd.line, let macdSignal = point.macd.signal,
              let macdHistogram = point.macd.histogram, let bands = point.bollinger20,
              let cutoff = daily.technical.dataCutoffAt else { return nil }
        return TechnicalIndicatorSnapshot(session: point.session, ma20: ma20, ma60: ma60, rsi14: rsi,
                                          macdLine: macdLine, macdSignal: macdSignal, macdHistogram: macdHistogram,
                                          bollingerMiddle: bands.middle, bollingerUpper: bands.upper,
                                          bollingerLower: bands.lower, close: point.candle.close,
                                          volume: point.volume, dataCutoffAt: cutoff)
    }

    var weinsteinAnalysis: WeinsteinAnalysisData? {
        guard let value = weinstein else { return nil }
        let support = value.supportZones.first.map { "\($0.lower)–\($0.upper)" } ?? "未提供"
        let resistance = value.resistanceZones.first.map { "\($0.lower)–\($0.upper)" } ?? "未提供"
        return WeinsteinAnalysisData(symbol: value.symbol, status: value.status,
                                     marketStage: value.marketStage, stockStage: value.stockStage,
                                     ma30wDirection: value.ma30wDirection, entryState: value.entryState,
                                     summary: value.summary, keyObservation: value.nextObservations.first ?? "未提供",
                                     supportLevel: support, resistanceLevel: resistance)
    }

    var candidates: [CandidateMembership] {
        let overviewSymbols = candidateOverview?.candidates.map(\.symbol) ?? []
        var symbols = overviewSymbols.isEmpty ? (membershipEnvelope?.memberships.map(\.symbol) ?? []) : overviewSymbols
        if !symbols.contains(selectedSymbol),
           membershipEnvelope?.memberships.contains(where: { $0.symbol == selectedSymbol && $0.state.rawValue == "tracked" }) == true {
            symbols.insert(selectedSymbol, at: 0)
        }
        return symbols.map { candidate(for: $0) }
    }

    var currentCandidate: CandidateMembership { candidate(for: selectedSymbol) }

    func candidate(for rawSymbol: String) -> CandidateMembership {
        let symbol = SecuritySymbol.parseHongKongAlias(rawSymbol)?.canonical ?? selectedSymbol
        let membership = membershipEnvelope?.memberships.first { $0.symbol == symbol }
        let overview = candidateOverview?.candidates.first { $0.symbol == symbol }
        let profileEnvelope = profilesBySymbol[symbol] ?? (profile?.symbol == symbol ? self.profileEnvelope : nil)
        let profile = profileEnvelope?.data?.profile
        let quote = quotesBySymbol[symbol]
        let quoteState = quote?.freshness ?? overview?.quote.status.rawValue
        let quoteLabel = quoteState.map {
            ["live": "报价已读取", "fresh": "报价已读取", "current": "报价已读取",
             "stale": "报价已过期", "unavailable": "报价暂不可用"][$0] ?? "行情状态待核查"
        } ?? "未读取"
        let dossier = makeDossier(symbol: symbol, name: profile?.name ?? membership?.research.name ?? overview?.name ?? symbol,
                                  profile: profile, profileEnvelope: profileEnvelope, quote: quote)
        let evidenceCount = overview?.evidenceCount ?? 0
        let stage = weinsteinAnalysis?.symbol == symbol ? weinsteinAnalysis?.stockStage : nil
        let ring = membership == nil ? "未加入自选" : profile == nil ? "研究档案未读取" : "研究档案已读取"
        return CandidateMembership(
            symbol: symbol,
            name: profile?.name ?? membership?.research.name ?? overview?.name ?? symbol,
            industry: "行业未记录",
            state: membership?.state.rawValue ?? (overview == nil ? "未加入自选" : "候选概览"),
            stage: stage ?? "周线阶段未读取",
            nextReviewOn: profile?.nextReviewOn,
            reportCount: boundTemplateReports(symbol: symbol).count,
            completenessScore: nil,
            currentDossier: dossier,
            currentRing: ring,
            report: templateReportSummary(symbol: symbol),
            valuationScenarios: templateScenarios(symbol: symbol),
            impliedExpectation: nil,
            safetyMarginFloor: nil,
            benchmarkFairValue: nil,
            evidenceFacts: templateEvidenceFacts(symbol: symbol),
            reviewLearnings: templateReviewItems(symbol: symbol),
            radarItems: [
                RadarFactItem(title: "研究档案", status: profile == nil ? "未读取" : "已读取", isReady: profile != nil),
                RadarFactItem(title: "来源凭据", status: "\(evidenceCount) 条", isReady: evidenceCount > 0),
                RadarFactItem(title: "行情", status: quoteLabel,
                              isReady: quote != nil)
            ]
        )
    }

    func currentRingDescription(for symbol: String) -> String {
        candidate(for: symbol).currentRing
    }

    func currentRingStage(for symbol: String) -> Int {
        guard let overview = candidateOverview?.candidates.first(where: { $0.symbol == symbol }) else { return 0 }
        return overview.evidenceCount > 0 ? 2 : 1
    }

    func selectCandidate(byIndex index: Int) {
        guard candidates.indices.contains(index) else { return }
        selectedCandidateIndex = index
        selectSymbol(candidates[index].symbol)
    }

    func stagePersonalFormalHandoff(_ handoff: PersonalFormalResearchHandoff) {
        personalFormalNavigationReadyId = nil
        personalFormalHandoff = handoff
        personalFormalAwaitingDismissalId = handoff.id
    }

    var hasPersonalFormalDismissalPending: Bool {
        guard let handoff = personalFormalHandoff else { return false }
        return personalFormalAwaitingDismissalId == handoff.id
    }

    func finishPersonalFormalDismissal() {
        guard hasPersonalFormalDismissalPending, let handoff = personalFormalHandoff else { return }
        personalFormalAwaitingDismissalId = nil
        personalFormalNavigationReadyId = handoff.id
    }

    func clearPersonalFormalHandoff() {
        personalFormalHandoff = nil
        personalFormalAwaitingDismissalId = nil
        personalFormalNavigationReadyId = nil
    }

    func selectSymbol(_ rawSymbol: String) {
        guard let canonical = SecuritySymbol.parseHongKongAlias(rawSymbol)?.canonical,
              canonical != selectedSymbol else { return }
        selectedSymbol = canonical
        if todayFormalReviewItem?.symbol != canonical { todayFormalReviewItem = nil }
        if personalFormalHandoff?.symbol != canonical { clearPersonalFormalHandoff() }
        sourceIntake=nil; templateFrozen = nil; templateValuation = nil; templateDocuments = nil; templateReviews = nil
        quote = nil
        environment = nil
        profile = nil
        profileEnvelope = nil
        daily = nil
        weinstein = nil
        issues = [:]
        marketRefreshMessage = nil
        if let index = candidates.firstIndex(where: { $0.symbol == canonical }) {
            selectedCandidateIndex = index
        }
    }

    func dossier(for rawSymbol: String) -> InvestmentDecisionDossier {
        let symbol = SecuritySymbol.parseHongKongAlias(rawSymbol)?.canonical ?? selectedSymbol
        let selected = candidate(for: symbol)
        return selected.currentDossier
    }

    func load(tab: AnnualRingsTab, symbol raw: String, refreshQuote: Bool = false) async {
        let symbol = SecuritySymbol.parseHongKongAlias(raw)?.canonical ?? selectedSymbol
        let changed = selectedSymbol != symbol
        selectedSymbol = symbol
        if changed {
            if personalFormalHandoff?.symbol != symbol { clearPersonalFormalHandoff() }
            quote = nil; environment = nil; profile = nil; profileEnvelope = nil
            daily = nil; weinstein = nil
            issues = [:]
        }
        if tab == .market || tab == .research { discovery = nil; issues.removeValue(forKey: "discovery") }
        let request = UUID()
        generation = request
        if refreshQuote { marketRefreshMessage = "正在从 OpenD 刷新报价和完成交易日日线…" }
        loading = true
        defer { if generation == request { loading = false } }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = refreshQuote ? 90 : 75
        configuration.timeoutIntervalForResource = refreshQuote ? 120 : 90
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let context = AppEnvironment.researchAuthorizationContext()
        let authorization = "\(context.baseURL)|\(context.readHeaderName)|\(context.readToken ?? "")"
        if templateReadAuthorization != authorization {
            todayFormalReviewItem = nil
            if personalFormalHandoff?.connectionScope != PersonalFormalResearchHandoff.currentConnectionScope() {
                clearPersonalFormalHandoff()
            }
            authorizationRevision = UUID()
            templatePortfolio = nil; assets = nil; portfolioResearchContext = nil; quote = nil; environment = nil; daily = nil; weinstein = nil
            profile = nil; profileEnvelope = nil; candidateOverview = nil; membershipEnvelope = nil; inbox = nil; discovery = nil
            quotesBySymbol.removeAll(); profilesBySymbol.removeAll(); issues.removeAll(); marketRefreshMessage = nil
        }
        if templateReadAuthorization != authorization || templateFrozen?.requestedSymbol != symbol {
            sourceIntake=nil; templateFrozen = nil; templateValuation = nil; templateDocuments = nil; templateReviews = nil
        }
        templateReadAuthorization = authorization
        let research = ResearchClient(baseURL: context.baseURL, session: session,
                                      authToken: context.readToken, authHeaderName: context.readHeaderName)
        let quoteClient = MarketQuoteClient(baseURL: context.baseURL, session: session,
                                            authToken: context.readToken, authHeaderName: context.readHeaderName,
                                            writeAuthToken: context.writeToken,
                                            writeAuthHeaderName: context.writeHeaderName)
        guard let parsed = SecuritySymbol.parseHongKongAlias(symbol) else {
            issues["quote"] = "请搜索并选择有效的港股标的。"
            return
        }

        await withTaskGroup(of: Update.self) { group in
            if tab != .assets {
                group.addTask { .candidateOverview(await research.fetchCandidateOverview()) }
                if refreshQuote {
                    group.addTask {
                        guard context.writeToken?.isEmpty == false else {
                            return .issue("quoteRefresh", "行情刷新需要写入授权；请关闭本页并在右上角连接设置中配置令牌。")
                        }
                        do {
                            return .quote(try await quoteClient.refreshQuote(market: parsed.market, code: parsed.code))
                        } catch let error as MarketQuoteClientError {
                            switch error {
                            case .httpStatus(401), .httpStatus(403):
                                return .issue("quoteRefresh", "行情刷新未授权；请在连接设置中核对写入令牌。")
                            case .httpStatus(503):
                                return .issue("quoteRefresh", "后端行情源暂不可用；请稍后重试。")
                            case .httpStatus(let status):
                                return .issue("quoteRefresh", "行情刷新失败（HTTP \(status)）。")
                            case .invalidRequest, .invalidResponse:
                                return .issue("quoteRefresh", "行情刷新请求无效或响应无法识别。")
                            }
                        } catch {
                            return .issue("quoteRefresh", "行情刷新失败：\(error.localizedDescription)")
                        }
                    }
                } else {
                    group.addTask {
                        do { return .quote(try await quoteClient.fetchQuote(market: parsed.market, code: parsed.code)) }
                        catch { return .issue("quote", "个股行情暂不可用。") }
                    }
                }
                group.addTask {
                    do {
                        return .environment(try await MarketEnvironmentClient(baseURL: context.baseURL, session: session,
                            authToken: context.readToken, authHeaderName: context.readHeaderName)
                            .fetch(market: parsed.market, code: parsed.code))
                    } catch { return .issue("environment", "市场环境暂不可用；个股研究仍可继续。") }
                }
            }
            if tab == .today {
                group.addTask { .inbox(await research.fetchTodayActionInbox()) }
            }
            if tab == .today || tab == .research || tab == .assets {
                group.addTask {
                    do { return .profile(symbol, try await research.fetchProfile(market: parsed.market, code: parsed.code)) }
                    catch { return .issue("profile", "研究档案暂不可用。") }
                }
            }
            if tab == .research || tab == .today || tab == .assets {
                group.addTask { .memberships(await research.fetchCandidateMemberships(includeArchived: false)) }
            }
            if tab == .market || tab == .research {
                group.addTask {
                    do { return .discovery(try await quoteClient.fetchDailyDiscovery(noticeSymbol: symbol)) }
                    catch { return .issue("discovery", "发现池与公告暂不可用。") }
                }
                group.addTask {
                    do {
                        let client = MarketDailyTechnicalClient(baseURL: context.baseURL, session: session,
                            authToken: context.readToken, authHeaderName: context.readHeaderName,
                            writeAuthToken: context.writeToken, writeAuthHeaderName: context.writeHeaderName)
                        if refreshQuote {
                            guard context.writeToken?.isEmpty == false else { return .issue("daily", "日线刷新缺少写入授权，请核对连接设置。") }
                            return .daily(try await client.refresh(market: parsed.market, code: parsed.code))
                        }
                        return .daily(try await client.fetch(market: parsed.market, code: parsed.code))
                    } catch { return .issue("daily", refreshQuote ? "日线刷新未完成：\(error.localizedDescription)" : "日线技术数据暂不可用。") }
                }
                group.addTask {
                    do { return .weinstein(try await WeinsteinTechnicalAnalysisClient(baseURL: context.baseURL, session: session,
                        authToken: context.readToken, authHeaderName: context.readHeaderName)
                        .fetch(market: parsed.market, code: parsed.code, analysisAsOf: currentHongKongRequestDate())) }
                    catch { return .issue("weinstein", "周线阶段分析暂不可用。") }
                }
            }
            if tab == .today {
                group.addTask {
                    do { return .weinstein(try await WeinsteinTechnicalAnalysisClient(baseURL: context.baseURL, session: session,
                        authToken: context.readToken, authHeaderName: context.readHeaderName)
                        .fetch(market: parsed.market, code: parsed.code, analysisAsOf: currentHongKongRequestDate())) }
                    catch { return .issue("weinstein", "今日周线观察暂不可用；正式冻结变化仍以 Today 待办为准。") }
                }
            }
            group.addTask {
                do { return .portfolio(try await PortfolioDecisionClient(baseURL: context.baseURL, authToken: context.readToken, authHeaderName: context.readHeaderName).fetchContext()) }
                catch { return .issue("portfolio", "资产来源暂不可用，请重试读取。") }
            }
            group.addTask {
                do { return .assets(try await AssetsAlphaClient(baseURL: context.baseURL, session: session,
                    readToken: context.readToken, readHeaderName: context.readHeaderName).fetch()) }
                catch { return .issue("assets", "非官方资产快照暂不可用。") }
            }
            if tab == .assets {
                group.addTask {
                    do { return .portfolioResearch(try await PortfolioResearchContextClient(baseURL: context.baseURL,
                        session: session, readToken: context.readToken, readHeaderName: context.readHeaderName).fetch()) }
                    catch { return .issue("portfolioResearch", "研究覆盖暂不可用，请稍后重试。") }
                }
            }
            for await update in group {
                guard generation == request, !Task.isCancelled, context == AppEnvironment.researchAuthorizationContext() else { continue }
                switch update {
                case .quote(let value):
                    quote = value
                    quotesBySymbol[symbol] = Self.viewQuote(value)
                    issues.removeValue(forKey: "quote")
                    if refreshQuote {
                        if value.status.rawValue == "live" {
                            issues.removeValue(forKey: "quoteRefresh")
                        } else {
                            issues["quoteRefresh"] = value.message
                        }
                    }
                case .portfolio(let value): templatePortfolio = value; issues.removeValue(forKey: "portfolio")
                case .frozen(let value): templateFrozen = value; issues.removeValue(forKey: "reports")
                case .valuation(let value): templateValuation = value; issues.removeValue(forKey: "valuation")
                case .documents(let value): templateDocuments = value; issues.removeValue(forKey: "documents")
                case .reviews(let value):
                    templateReviews = value
                    templateReviewIdentity = membershipEnvelope?.memberships.first(where: { $0.symbol == symbol }).map { TemplateDocumentIdentity($0) }
                    issues.removeValue(forKey: "reviews")
                case .environment(let value): environment = value; issues.removeValue(forKey: "environment")
                case .candidateOverview(let value): candidateOverview = value
                case .memberships(let value): membershipEnvelope = value
                case .inbox(let value): inbox = value
                case .profile(let profileSymbol, let value):
                    issues.removeValue(forKey: "profile")
                    profilesBySymbol[profileSymbol] = value
                    if profileSymbol == selectedSymbol { profileEnvelope = value; profile = value.data?.profile }
                case .assets(let value): assets = value; issues.removeValue(forKey: "assets")
                case .portfolioResearch(let value): portfolioResearchContext = value; issues.removeValue(forKey: "portfolioResearch")
                case .discovery(let value): discovery = value; issues.removeValue(forKey: "discovery")
                case .daily(let value): daily = value; issues.removeValue(forKey: "daily")
                case .weinstein(let value): weinstein = value; issues.removeValue(forKey: "weinstein")
                case .issue(let key, let message):
                    issues[key] = message
                    if key == "portfolio" { templatePortfolio = nil }
                    if key == "discovery" { discovery = nil }
                    if key == "assets" { assets = nil }
                    if key == "portfolioResearch" { portfolioResearchContext = nil }
                    if key == "profile" { profilesBySymbol.removeValue(forKey: symbol); profile = nil; profileEnvelope = nil }
                    if key == "quote" || key == "quoteRefresh" { quotesBySymbol.removeValue(forKey: symbol); quote = nil }
                    if key == "daily" { daily = nil }
                    if key == "environment" { environment = nil }
                    if key == "weinstein" { weinstein = nil }
                }
            }
        }
        if generation == request, !Task.isCancelled, refreshQuote {
            // Weekly analysis must read after the daily refresh has completed.
            do {
                let value = try await WeinsteinTechnicalAnalysisClient(baseURL: context.baseURL, session: session,
                    authToken: context.readToken, authHeaderName: context.readHeaderName)
                    .fetch(market: parsed.market, code: parsed.code, analysisAsOf: currentHongKongRequestDate())
                if generation == request { weinstein = value; issues.removeValue(forKey: "weinstein") }
            } catch { if generation == request { weinstein = nil; issues["weinstein"] = "日线刷新后周线分析读取失败。" } }
            if generation == request {
                let quoteState = quote?.isUsableQuote == true ? (quote?.status.rawValue == "live" ? "报价已更新" : "报价已读取，来源仍为陈旧状态") : "报价刷新失败"
                let dailyState = daily?.usableForRequestedCutoff == true ? "日线与指标已刷新并回读核对" : "日线未能更新，请查看原因"
                marketRefreshMessage = "\(quoteState)；\(dailyState)。"
            }
        }
        if generation == request, !Task.isCancelled, tab == .research || tab == .today {
            await loadTemplateDetails(client: research, symbol: symbol, request: request, authorization: context)
        }
        if let index = candidates.firstIndex(where: { $0.symbol == selectedSymbol }) { selectedCandidateIndex = index }
    }

    private func loadTemplateDetails(client: ResearchClient, symbol: String, request: UUID, authorization: AppResearchAuthorizationContext) async {
        guard let membership = membershipEnvelope?.memberships.first(where: { $0.symbol == symbol && $0.state != .archived }) else { return }
        await withTaskGroup(of: Update.self) { group in
            group.addTask { do { return .frozen(try await client.fetchFrozenResearchEvidence(membership: membership)) }
                catch { return .issue("reports", "报告读取失败，请核对连接与研究身份后重试。") } }
            group.addTask { do { return .valuation(try await client.fetchResearchValuationScenarios(membership: membership)) }
                catch { return .issue("valuation", "估值情景暂不可用。") } }
            group.addTask { do { return .documents(try await client.fetchResearchDocuments(membership: membership)) }
                catch { return .issue("documents", "原文资料暂不可用。") } }
            group.addTask { do { return .reviews(try await client.fetchDecisionReviewHistory(market: membership.market, code: membership.code)) }
                catch { return .issue("reviews", "复盘历史暂不可用。") } }
            for await update in group {
                guard generation == request, !Task.isCancelled, selectedSymbol == symbol, authorization == AppEnvironment.researchAuthorizationContext(),
                      let current = membershipEnvelope?.memberships.first(where: { $0.id == membership.id }),
                      current.version == membership.version, current.actorId == membership.actorId,
                      current.state == membership.state else { continue }
                switch update {
                case .portfolio(let value): templatePortfolio = value; issues.removeValue(forKey: "portfolio")
                case .frozen(let value): templateFrozen = value; issues.removeValue(forKey: "reports")
                case .valuation(let value): templateValuation = value; issues.removeValue(forKey: "valuation")
                case .documents(let value): templateDocuments = value; issues.removeValue(forKey: "documents")
                case .reviews(let value):
                    templateReviews = value
                    templateReviewIdentity = TemplateDocumentIdentity(current)
                    issues.removeValue(forKey: "reviews")
                case .issue(let key, let message):
                    issues[key] = message
                    if key == "reports" { templateFrozen = nil }
                    if key == "valuation" { templateValuation = nil }
                    if key == "documents" { templateDocuments = nil }
                    if key == "reviews" { templateReviews = nil }
                default: break
                }
            }
        }
    }

    func researchQuestions(symbol: String) async throws -> [OperatingResearchQuestion] {
        guard selectedSymbol == symbol, let member = membershipEnvelope?.memberships.first(where: { $0.symbol == symbol }) else { throw NSError(domain: "研究身份变化", code: 409) }
        let data = try await questionRequest(path: "candidate-memberships/\(member.id)/research-questions")
        struct Envelope: Decodable { let actorId: String; let symbol: String; let membershipId: String; let membershipVersion: Int; let questions: [OperatingResearchQuestion] }
        let v = try JSONDecoder().decode(Envelope.self, from: data)
        guard selectedSymbol == symbol, v.symbol == symbol, v.actorId == member.actorId, v.membershipId == member.id, v.membershipVersion == member.version else { throw NSError(domain: "研究问题身份变化", code: 409) }
        return v.questions
    }
    func saveResearchQuestion(symbol: String, question: [String: Any], idempotencyKey: String) async throws {
        guard selectedSymbol == symbol, let member = membershipEnvelope?.memberships.first(where: { $0.symbol == symbol }) else { throw NSError(domain: "研究身份变化", code: 409) }
        let data = try await questionRequest(path: "candidate-memberships/\(member.id)/research-context")
        let context = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let currentId = (context?["data"] as? [String: Any])?["id"] ?? NSNull()
        _ = try await questionRequest(path: "candidate-memberships/\(member.id)/research-questions", body: ["question":question,"baseContextId":currentId,"membershipVersion":member.version,"idempotencyKey":idempotencyKey])
    }
    private func questionRequest(path: String, body: [String: Any]? = nil) async throws -> Data {
        let authorization = AppEnvironment.researchAuthorizationContext()
        guard let token = authorization.writeToken else { throw NSError(domain: "研究授权不可用", code: 401) }
        var request = URLRequest(url: authorization.baseURL.appendingPathComponent("api/mobile/research/" + path)); request.setValue(token, forHTTPHeaderField: authorization.writeHeaderName)
        if let body { request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode
        let missingContext = status == 404 && path.hasSuffix("/research-context") && body == nil && ((try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["status"] as? String) == "not_found"
        guard status == 200 || missingContext, authorization == AppEnvironment.researchAuthorizationContext() else { throw NSError(domain: "研究问题读写失败，请核对当前版本及输入", code: 409) }
        return data
    }

    func fetchSourceIntake(symbol:String) async throws {
        guard selectedSymbol==symbol,let member=membershipEnvelope?.memberships.first(where:{$0.symbol==symbol}) else {throw NSError(domain:"研究身份变化",code:409)}
        let context=AppEnvironment.researchAuthorizationContext();guard let token=context.readToken else {throw NSError(domain:"缺少研究读取授权",code:401)}
        var request=URLRequest(url:context.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(member.id)/source-intake"));request.setValue(token,forHTTPHeaderField:context.readHeaderName)
        let (data,response)=try await URLSession.shared.data(for:request);guard (response as? HTTPURLResponse)?.statusCode==200 else {throw NSError(domain:"资料更新不可用",code:503)}
        let result=try JSONDecoder().decode(ResearchSourceIntakeEnvelope.self,from:data)
        guard selectedSymbol==symbol,context==AppEnvironment.researchAuthorizationContext(),membershipEnvelope?.memberships.contains(where:{$0.id==member.id && $0.version==member.version && $0.state.rawValue=="tracked"})==true,member.version==result.membershipVersion,result.membershipId==member.id,result.symbol==symbol,result.leads.allSatisfy({$0.symbol==symbol && $0.membershipId==member.id && $0.membershipVersion==member.version}) else {throw NSError(domain:"资料股票范围或版本不符",code:409)}
        sourceIntake=result
    }
    func sourceLeadPage(symbol:String,beforeLeadId:String) async throws -> ResearchSourceLeadPage {
        guard selectedSymbol==symbol,let member=membershipEnvelope?.memberships.first(where:{$0.symbol==symbol}),beforeLeadId.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil else {throw NSError(domain:"资料范围变化",code:409)}
        let context=AppEnvironment.researchAuthorizationContext();guard let token=context.readToken else {throw NSError(domain:"缺少研究读取授权",code:401)}
        var parts=URLComponents(url:context.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(member.id)/source-intake/leads"),resolvingAgainstBaseURL:false)!;parts.queryItems=[URLQueryItem(name:"beforeLeadId",value:beforeLeadId)]
        var request=URLRequest(url:parts.url!);request.setValue(token,forHTTPHeaderField:context.readHeaderName)
        let (data,response)=try await URLSession.shared.data(for:request);guard (response as? HTTPURLResponse)?.statusCode==200 else {throw NSError(domain:"资料历史暂不可用",code:503)}
        let page=try JSONDecoder().decode(ResearchSourceLeadPage.self,from:data)
        guard selectedSymbol==symbol,context==AppEnvironment.researchAuthorizationContext(),page.leads.allSatisfy({$0.symbol==symbol && $0.membershipId==member.id && $0.membershipVersion==member.version}) else {throw NSError(domain:"资料身份变化",code:409)}
        return page
    }
    func refreshSourceIntake(symbol:String, manual:[String:String]? = nil, force:Bool=false) async throws {
        guard selectedSymbol==symbol,let member=membershipEnvelope?.memberships.first(where:{$0.symbol==symbol}) else {throw NSError(domain:"研究身份变化",code:409)}
        let context=AppEnvironment.researchAuthorizationContext();guard let token=context.writeToken else {throw NSError(domain:"需要明确研究写入授权",code:401)}
        var request=URLRequest(url:context.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(member.id)/source-intake/refresh"));request.httpMethod="POST";request.setValue(token,forHTTPHeaderField:context.writeHeaderName);request.setValue("application/json",forHTTPHeaderField:"Content-Type");let refreshBody:[String:Any]=manual ?? (force ? ["manualRefresh":true] : [:]);request.httpBody=try JSONSerialization.data(withJSONObject:refreshBody);request.timeoutInterval=90
        let (data,response)=try await URLSession.shared.data(for:request);guard (response as? HTTPURLResponse)?.statusCode==200 else {throw NSError(domain:"官方来源检查未完成",code:503)}
        let result=try JSONDecoder().decode(ResearchSourceIntakeEnvelope.self,from:data)
        guard selectedSymbol==symbol,context==AppEnvironment.researchAuthorizationContext(),membershipEnvelope?.memberships.contains(where:{$0.id==member.id && $0.version==member.version && $0.state.rawValue=="tracked"})==true,result.symbol==symbol,result.membershipId==member.id,result.membershipVersion==member.version else {throw NSError(domain:"资料状态已变化，请重新读取",code:409)}
        sourceIntake=result
    }
    func reviewSourceDocumentVersion(symbol:String,leadId:String,documentId:String,accept:Bool,reason:String) async throws {
        guard selectedSymbol==symbol,let member=membershipEnvelope?.memberships.first(where:{$0.symbol==symbol}) else {throw NSError(domain:"研究身份变化",code:409)}
        let context=AppEnvironment.researchAuthorizationContext();guard let token=context.writeToken else {throw NSError(domain:"需要明确研究写入授权",code:401)}
        var request=URLRequest(url:context.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(member.id)/source-intake/leads/\(leadId)/versions/\(documentId)/review"));request.httpMethod="POST";request.setValue(token,forHTTPHeaderField:context.writeHeaderName);request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.httpBody=try JSONSerialization.data(withJSONObject:["action":accept ? "accept":"reject","reason":reason])
        let (_,response)=try await URLSession.shared.data(for:request);guard (response as? HTTPURLResponse)?.statusCode==200 else {throw NSError(domain:"文档版本待重新核对",code:409)}
        try await fetchSourceIntake(symbol:symbol)
    }
    func sourceLeadHistory(symbol:String,leadId:String,beforeSequence:Int?) async throws -> ResearchSourceEventPage {
        guard selectedSymbol==symbol,let member=membershipEnvelope?.memberships.first(where:{$0.symbol==symbol}) else {throw NSError(domain:"研究身份变化",code:409)}
        let context=AppEnvironment.researchAuthorizationContext();guard let token=context.readToken else {throw NSError(domain:"缺少研究读取授权",code:401)}
        var url=context.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(member.id)/source-intake/leads/\(leadId)/events")
        if let beforeSequence {url=URL(string:url.absoluteString+"?beforeSequence=\(beforeSequence)")!}
        var request=URLRequest(url:url);request.setValue(token,forHTTPHeaderField:context.readHeaderName)
        let (data,response)=try await URLSession.shared.data(for:request);guard (response as? HTTPURLResponse)?.statusCode==200 else {throw NSError(domain:"线索历史暂不可用",code:503)}
        let page=try JSONDecoder().decode(ResearchSourceEventPage.self,from:data)
        guard selectedSymbol==symbol,context==AppEnvironment.researchAuthorizationContext(),page.events.allSatisfy({$0.leadId==leadId}) else {throw NSError(domain:"线索身份变化",code:409)}
        return page
    }

    func candidatePDF(_ candidate: OperatingFactCandidate) async throws -> ResearchDocumentPDFPresentation {
        guard selectedSymbol == candidate.symbol, let member = membershipEnvelope?.memberships.first(where: { $0.id == candidate.membershipId && $0.version == candidate.membershipVersion }) else { throw NSError(domain: "候选范围已变化", code: 409) }
        let context = AppEnvironment.researchAuthorizationContext()
        let client = ResearchClient(baseURL: context.baseURL, authToken: context.readToken, authHeaderName: context.readHeaderName)
        let documents = try await client.fetchResearchDocuments(membership: member)
        guard let document = documents.documents.first(where: { $0.id == candidate.documentId && $0.pdfSha256 == candidate.documentPdfSha256 }) else { throw NSError(domain: "候选原文件身份不一致", code: 409) }
        let page = try await client.fetchResearchDocumentPage(membership: member, documentId: document.id, pageNumber: candidate.pageNumber)
        guard page.pageTextSha256 == candidate.pageTextSha256 else { throw NSError(domain: "候选原文页已变化", code: 409) }
        let data = try await client.fetchResearchDocumentContent(membership: member, document: document)
        guard selectedSymbol == candidate.symbol, context == AppEnvironment.researchAuthorizationContext(), researchDocumentPDFContainsPage(data, pageNumber: candidate.pageNumber), membershipEnvelope?.memberships.contains(where: { $0.id == member.id && $0.version == member.version }) == true else { throw NSError(domain: "原文或当前研究范围变化", code: 409) }
        return ResearchDocumentPDFPresentation(title: document.title, data: data, pageNumber: candidate.pageNumber)
    }

    func factCandidates(symbol: String) async throws -> [OperatingFactCandidate] {
        guard selectedSymbol == symbol, let membership = membershipEnvelope?.memberships.first(where: { $0.symbol == symbol }) else { throw NSError(domain: "股票范围已变化", code: 409) }
        let authorization = AppEnvironment.researchAuthorizationContext()
        guard let token = authorization.writeToken else { throw NSError(domain: "研究授权不可用", code: 401) }
        var request = URLRequest(url: authorization.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(membership.id)/fact-candidates")); request.setValue(token, forHTTPHeaderField: authorization.writeHeaderName)
        let (data, response) = try await URLSession.shared.data(for: request)
        struct Envelope: Decodable { let symbol: String; let membershipId: String; let membershipVersion: Int; let actorId: String; let candidates: [OperatingFactCandidate] }
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw NSError(domain: "文档候选读取失败", code: 503) }
        let envelope = try JSONDecoder().decode(Envelope.self, from: data)
        guard selectedSymbol == symbol, authorization == AppEnvironment.researchAuthorizationContext(), membershipEnvelope?.memberships.contains(where: { $0.id == membership.id && $0.version == membership.version }) == true, envelope.symbol == symbol, envelope.membershipId == membership.id, envelope.membershipVersion == membership.version, envelope.actorId == membership.actorId, envelope.candidates.allSatisfy({ $0.status == "CANDIDATE" && $0.symbol == symbol && $0.membershipId == membership.id && $0.membershipVersion == membership.version && $0.documentPdfSha256?.count == 64 }) else { throw NSError(domain: "候选身份不一致", code: 409) }
        return envelope.candidates
    }
    func confirmFactCandidate(_ candidate: OperatingFactCandidate, body: [String: Any]) async throws {
        guard selectedSymbol == candidate.symbol, membershipEnvelope?.memberships.contains(where: { $0.id == candidate.membershipId && $0.version == candidate.membershipVersion && $0.symbol == candidate.symbol }) == true else { throw NSError(domain: "候选股票范围已变化", code: 409) }
        let authorization = AppEnvironment.researchAuthorizationContext()
        guard let token = authorization.writeToken else { throw NSError(domain: "需要明确研究写入授权", code: 401) }
        var request = URLRequest(url: authorization.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(candidate.membershipId)/fact-candidates/confirm")); request.httpMethod = "POST"; request.setValue(token, forHTTPHeaderField: authorization.writeHeaderName); request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["message"] as? String; throw NSError(domain: message ?? "候选确认失败，未确认新的事实", code: 422) }
        guard selectedSymbol == candidate.symbol, authorization == AppEnvironment.researchAuthorizationContext() else { throw NSError(domain: "已提交，当前股票范围变化；请重新读取", code: 409) }
    }

    func previewOperatingModel(_ model: OperatingResearchModel, for initial: ResearchOperatingReasoning) async throws -> ResearchOperatingReasoning {
        guard let current = boundOperatingReasoning(symbol: initial.symbol), current.inputFingerprint == initial.inputFingerprint else { throw NSError(domain: "研究版本已变化", code: 409) }
        let authorization = AppEnvironment.researchAuthorizationContext()
        guard let token = authorization.writeToken else { throw NSError(domain: "研究授权不可用", code: 401) }
        let url = authorization.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(initial.membershipId)/research-context/operating-preview")
        var request = URLRequest(url: url); request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.setValue(token, forHTTPHeaderField: authorization.writeHeaderName)
        request.httpBody = try JSONSerialization.data(withJSONObject: ["inputFingerprint": initial.contextId as Any? ?? NSNull(), "operatingModel": JSONSerialization.jsonObject(with: JSONEncoder().encode(model))])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200, let object = try JSONSerialization.jsonObject(with: data) as? [String: Any], object["previewOnly"] as? Bool == true, let raw = object["operatingReasoning"], operatingReasoningRawShapeIsValid(raw) else { throw NSError(domain: "预览未通过绑定或计算证明核验", code: 409) }
        let value = try JSONDecoder().decode(ResearchOperatingReasoning.self, from: JSONSerialization.data(withJSONObject: raw))
        guard selectedSymbol == initial.symbol, authorization == AppEnvironment.researchAuthorizationContext(), value.symbol == initial.symbol, value.actorId == initial.actorId, value.membershipId == initial.membershipId, value.membershipVersion == initial.membershipVersion, value.model == model, value.facts.allSatisfy({ $0.symbol == initial.symbol && $0.membershipId == initial.membershipId && $0.membershipVersion == initial.membershipVersion && $0.semanticType == "FACT" }), value.operatingMeaning.semanticType == "INTERPRETATION" else { throw NSError(domain: "预览身份或语义不一致", code: 409) }
        return value
    }

    func saveOperatingModel(_ model: OperatingResearchModel, for initial: ResearchOperatingReasoning, idempotencyKey: String) async throws {
        guard let current = boundOperatingReasoning(symbol: initial.symbol), current.inputFingerprint == initial.inputFingerprint else {
            throw NSError(domain: "研究版本已变化，请重新打开", code: 409)
        }
        let authorization = AppEnvironment.researchAuthorizationContext()
        guard let token = authorization.writeToken, !token.isEmpty else { throw NSError(domain: "请先配置研究写入授权", code: 401) }
        let modelData = try JSONEncoder().encode(model)
        let modelObject = try JSONSerialization.jsonObject(with: modelData)
        let body: [String: Any] = ["baseContextId": initial.contextId as Any? ?? NSNull(), "membershipVersion": initial.membershipVersion, "selectedSymbol": initial.symbol, "operatingModel": modelObject, "idempotencyKey": idempotencyKey]
        let url = authorization.baseURL.appendingPathComponent("api/mobile/research/candidate-memberships/\(initial.membershipId)/research-context/operating-model")
        var request = URLRequest(url: url); request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: authorization.writeHeaderName)
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw NSError(domain: object?["message"] as? String ?? "保存失败，请核对输入与研究版本", code: (response as? HTTPURLResponse)?.statusCode ?? 503)
        }
        guard selectedSymbol == initial.symbol, authorization == AppEnvironment.researchAuthorizationContext() else { throw NSError(domain: "股票或授权已切换", code: 409) }
        let write = try JSONDecoder().decode(ResearchWriteEnvelope<ResearchContextData>.self, from: data)
        var expected = model
        if model.thesisRevision?.status == "OWNER_CONFIRMED" {
            guard write.data.operatingModel?.thesisRevision?.actor == initial.actorId, let timestamp = write.data.operatingModel?.thesisRevision?.confirmedAt, !timestamp.isEmpty else { throw NSError(domain: "修订确认记录不完整", code: 409) }
            expected.thesisRevision?.actor = initial.actorId; expected.thesisRevision?.confirmedAt = timestamp
        }
        guard write.status == "succeeded", write.source.actorId == initial.actorId, write.data.membershipId == initial.membershipId,
              write.data.membershipVersion == initial.membershipVersion, write.data.selectedSymbol == initial.symbol, write.data.operatingModel == expected else { throw NSError(domain: "保存回读绑定不一致", code: 409) }
        await load(tab: .research, symbol: initial.symbol)
        guard let fresh = boundOperatingReasoning(symbol: initial.symbol), fresh.contextId == write.data.id, fresh.model == expected else { throw NSError(domain: "保存成功但最新研究尚未核对，请重新读取", code: 503) }
    }

    func boundOperatingReasoning(symbol: String) -> ResearchOperatingReasoning? {
        guard selectedSymbol == symbol,
              let membership = membershipEnvelope?.memberships.first(where: { $0.symbol == symbol }),
              let workspace = templateFrozen, workspace.requestedActorId == membership.actorId,
              workspace.data?.target.membershipId == membership.id,
              workspace.data?.target.membershipVersion == membership.version,
              workspace.data?.target.membershipState == membership.state.rawValue,
              let reasoning = workspace.data?.operatingReasoning, reasoning.matches(workspace) else { return nil }
        return reasoning
    }

    func boundProviderOperatingReference(symbol: String) -> ResearchProviderOperatingReference? {
        guard selectedSymbol == symbol,
              let membership = membershipEnvelope?.memberships.first(where: { $0.symbol == symbol }),
              let workspace = templateFrozen, workspace.requestedActorId == membership.actorId,
              workspace.data?.target.membershipId == membership.id,
              workspace.data?.target.membershipVersion == membership.version,
              workspace.data?.target.membershipState == membership.state.rawValue,
              let reference = workspace.data?.providerOperatingReference,
              reference.validates(membership) else { return nil }
        return reference
    }

    func boundTemplateReports(symbol: String) -> [TwoLayerReportData] {
        guard let membership = membershipEnvelope?.memberships.first(where: { $0.symbol == symbol }),
              let envelope = templateFrozen, envelope.requestedActorId == membership.actorId,
              envelope.data?.target.membershipId == membership.id,
              envelope.data?.target.membershipVersion == membership.version else { return [] }
        return (envelope.data?.reports ?? []).filter {
            $0.payload.evidencePackBinding?.membershipId == membership.id
                && $0.payload.evidencePackBinding?.symbol == symbol
        }.sorted { $0.version > $1.version }
    }
    func templateReportSummary(symbol: String, reportId: String? = nil) -> TwoLayerReport? {
        guard let report = boundTemplateReports(symbol: symbol).first(where: { (reportId == nil || $0.id == reportId) && $0.payload.adviceLayer != nil && $0.payload.researchLayer != nil }),
              let advice = report.payload.adviceLayer, let research = report.payload.researchLayer else { return nil }
        let state = report.isFormalizable ? "待人工审阅" : report.status == "evidence_insufficient" ? "证据待补齐" : report.status
        return TwoLayerReport(version: "v\(report.version)", asOf: report.payload.cutoffAt,
            status: "\(report.isCurrentExact ? "当前" : "历史参考") · \(state)",
            conclusion: advice.conclusion, actionIntent: advice.direction == "wait_for_evidence" ? "等待补充证据" : advice.direction ?? "尚未形成", targetPriceRange: advice.priceRange == "UNKNOWN" ? "尚未形成" : advice.priceRange ?? "尚未绑定",
            catalysts: research.eventsAndCatalysts.map(\.statement), counterevidence: research.counterevidence.map(\.statement),
            businessModelSummary: research.fundamentals.map(\.statement).joined(separator: "\n"),
            moatSummary: (research.context ?? []).map(\.statement).joined(separator: "\n"),
            financialSummary: research.valuation.map(\.statement).joined(separator: "\n"))
    }
    func boundTemplateDocuments(symbol: String) -> ResearchDocumentListEnvelope? {
        guard let membership = membershipEnvelope?.memberships.first(where: { $0.symbol == symbol }),
              let documents = templateDocuments,
              documents.requestedActorId == membership.actorId,
              documents.membershipId == membership.id,
              documents.membershipVersion == membership.version,
              documents.symbol == membership.symbol else { return nil }
        if let projection = templateDocumentProjection,
           projection.identity == TemplateDocumentIdentity(membership),
           projection.authorizationRevision == authorizationRevision {
            return projection.valid ? documents : nil
        }
        let valid = (try? documents.validate(expected: membership)) != nil
        let documentsById = valid ? Dictionary(uniqueKeysWithValues: documents.documents.map { ($0.id, $0) }) : [:]
        let evidenceFacts: [EvidenceFactItem] = valid ? documents.materials.compactMap { material in
            guard let citation = material.citation, let publishedAt = material.publishedAt,
                  let document = documentsById[citation.documentId] else { return nil }
            return EvidenceFactItem(id: material.id, documentId: citation.documentId,
                pageTextSha256: citation.pageTextSha256, sourceTitle: material.title,
                sourceType: material.sourceType, publishDate: publishedAt,
                pageNumber: citation.pageNumber, quoteSnippet: material.contentText,
                sha256: document.pdfSha256, verifiedState: material.verificationStatus)
        } : []
        templateDocumentProjection = TemplateDocumentProjection(identity: TemplateDocumentIdentity(membership),
            authorizationRevision: authorizationRevision, valid: valid, evidenceFacts: evidenceFacts)
        return valid ? documents : nil
    }
    func templateEvidenceFacts(symbol: String) -> [EvidenceFactItem] {
        guard boundTemplateDocuments(symbol: symbol) != nil else { return [] }
        return templateDocumentProjection?.evidenceFacts ?? []
    }

    func templateScenarios(symbol: String) -> [ValuationScenario] {
        guard templateValuation?.symbol == symbol,
              let scenario = templateValuation?.scenarioSets.filter({ $0.scenarioState == "current" && $0.recomputable }).max(by: { $0.createdAt < $1.createdAt }) else { return [] }
        let assumptions = scenario.assumptions.values
        return scenario.calculation.diagonal.map { row in
            ValuationScenario(name: row.scenario, targetPrice: row.presentValuePerShare, changePercent: nil,
                probability: "未提供", growthAssumption: String(format: "增长 %.1f%% · 终值倍数 %.1f", row.annualGrowthRate * 100, row.terminalMultiple),
                marginAssumption: "未提供", wacc: String(format: "%.1f%%", assumptions.annualDiscountRate * 100),
                rationale: "个人假设情景 #\(scenario.id) · 修订 \(scenario.revision) · \(scenario.calculation.method.id)",
                currency: assumptions.metricCurrency ?? "币种未提供")
        }
    }
    func templateReviewItems(symbol: String) -> [ReviewLearningItem] {
        guard templateReviews?.requestedSymbol == symbol else { return [] }
        return (templateReviews?.checks ?? []).flatMap { check in
            check.reviews.map { review in
                ReviewLearningItem(id: review.id, version: "检查 #\(check.id)", reviewDate: review.reviewedAt,
                    decisionType: check.userFinalDecision ?? check.actionIntent, outcome: review.outcome.rawValue,
                    lessonLearned: review.reviewLearning.snapshot?.processLesson ?? "未保留结构化学习；\(review.reviewNote ?? "暂无复盘备注")")
            }
        }
    }

    private func makeDossier(symbol: String, name: String, profile: ResearchProfileData?,
                             profileEnvelope: ResearchProfileEnvelope?, quote: StockQuote?) -> InvestmentDecisionDossier {
        let action = inbox?.items.first { $0.symbol == symbol && $0.state == .new }
        let report = boundTemplateReports(symbol: symbol).first(where: { $0.isCurrentExact })
        let advice = report?.payload.adviceLayer
        let currentView = report.map { $0.isFormalizable ? "研究结论待审阅" : "证据尚需核实" } ?? profile?.currentView ?? "当前判断未提供"
        let thesis = advice?.conclusion ?? profile?.currentThesis ?? "后端尚未返回此标的的研究论点。"
        let cutoff = quote?.quoteTime ?? profileEnvelope?.asOf ?? "未取得"
        let provenance: DataProvenance
        if let quote {
            let freshness: DataProvenance.FreshnessType = quote.freshness == "live" ? .fresh : .stale
            provenance = .real(source: quote.provenance, freshness: freshness, timestamp: quote.quoteTime)
        } else {
            provenance = .unavailable(reason: "行情未取得")
        }
        return InvestmentDecisionDossier(
            symbol: symbol, name: name,
            judgmentTitle: currentView, stance: currentView,
            confidence: advice?.confidence ?? "未提供置信度", horizon: advice?.horizonStatement ?? "未提供研究期限", thesisSummary: thesis,
            priceNarrative: quote?.message ?? "当前没有可展示的行情事实。",
            latestCatalysts: profile?.catalysts ?? [], operatingHighlights: profile?.keyVariables ?? [],
            currentPrice: quote?.price, safetyMarginPrice: nil, targetPriceBase: nil, targetPriceBull: nil,
            peTtm: nil, pePercentile: nil, conditionTriggers: advice?.priceConditions ?? [],
            invalidationConditions: profile?.invalidationCondition.map { [$0] } ?? [],
            maxDrawdownEst: nil, monitoringMetrics: profile?.keyVariables ?? [],
            nextActionTitle: action?.title ?? ((inbox?.status == .empty || inbox?.status == .available) ? "当前没有新待办" : "打开研究工作台核对"),
            nextActionDetail: action?.summary ?? inbox?.message ?? thesis,
            actionBadge: action?.priority ?? "研究", sourceProvider: quote?.provenance ?? "unavailable",
            dataCutoff: report?.payload.cutoffAt ?? cutoff, evidenceHash: report?.reportFingerprint, deepResearchStatus: report?.status ?? "尚未读取报告", provenance: provenance
        )
    }

    private static func viewQuote(_ envelope: MarketQuoteEnvelope) -> StockQuote? {
        guard let data = envelope.data else { return nil }
        return StockQuote(symbol: data.symbol, code: data.code, market: data.market,
                          name: data.name ?? data.symbol, price: data.price,
                          change: data.change, changePercent: data.changePercent,
                          previousClose: data.previousClose, quoteTime: data.quoteTime,
                          freshness: envelope.status.rawValue, provenance: envelope.source.provider.rawValue,
                          message: envelope.message)
    }
}

/// The copied page sources retain these names, while all state lives in the validated API store above.
typealias APIService = OwnerClientStore
typealias DomainEngine = OwnerClientStore

enum PersonalFormalHandoffReadback {
    case current
    case drifted
    case unavailable
}

private struct PersonalFormalEvidenceReadback: Decodable {
    struct Source: Decodable {
        let id: String
        let symbol: String
        let source: String
        let sourceType: String
        let publishedAt: String?
        let readStatus: String
        let url: String?
        let pageNumber: Int?
        let contentSha256: String
        let documentId: String?
        let documentPdfSha256: String?
        let snapshotCitation: PersonalFormalSnapshotCoordinate?
    }
    let ok: Bool
    let symbol: String
    let membershipId: String
    let membershipVersion: Int
    let mode: String
    let eventDate: String?
    let sources: [Source]
}
private struct PersonalFormalProviderReadback: Decodable {
    let ok: Bool
    let data: FutuFinancialMaterialPreview
}

extension OwnerClientStore {
    /// Recheck the free evidence GET before promoting a navigation hint to a
    /// formal preparation draft. A failed read leaves the intent pending.
    func verifyPersonalFormalHandoff(_ handoff: PersonalFormalResearchHandoff) async -> PersonalFormalHandoffReadback {
        let auth = AppEnvironment.researchAuthorizationContext()
        guard handoff.connectionScope == PersonalFormalResearchHandoff.currentConnectionScope(),
              selectedSymbol == handoff.symbol else { return .drifted }
        do {
        if !handoff.readSourceScope.isEmpty {
        var query = [URLQueryItem(name: "mode", value: handoff.mode)]
        if let eventDate = handoff.eventDate { query.append(URLQueryItem(name: "eventDate", value: eventDate)) }
        let url = auth.baseURL
            .appending(path: "api/mobile/research/candidate-memberships/\(handoff.membershipId)/personal-brief/investigations")
            .appending(queryItems: query)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        if let token = auth.readToken { request.setValue(token, forHTTPHeaderField: auth.readHeaderName) }
            let (bytes, response) = try await URLSession.shared.data(for: request)
            guard auth == AppEnvironment.researchAuthorizationContext(),
                  handoff.connectionScope == PersonalFormalResearchHandoff.currentConnectionScope(),
                  selectedSymbol == handoff.symbol else { return .drifted }
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let current = try? JSONDecoder().decode(PersonalFormalEvidenceReadback.self, from: bytes) else { return .unavailable }
            guard current.ok, current.symbol == handoff.symbol,
                  current.membershipId == handoff.membershipId,
                  current.membershipVersion == handoff.membershipVersion,
                  current.mode == handoff.mode, current.eventDate == handoff.eventDate,
                  PersonalFormalResearchHandoff.sourceScope(current.sources.filter { $0.sourceType != "provider_financial_statement" }.map {
                      PersonalFormalReadSource(symbol: $0.symbol, sourceType: $0.sourceType, readStatus: $0.readStatus,
                          url: $0.url, pageNumber: $0.pageNumber, contentSha256: $0.contentSha256,
                          snapshotCitation: $0.snapshotCitation)
                  }) == handoff.readSourceScope else { return .drifted }
            guard handoff.sources.allSatisfy({ hint in
                current.sources.contains { source in
                    source.sourceType == hint.sourceType && source.readStatus == "BODY_READ"
                        && source.url == hint.url && source.pageNumber == hint.pageNumber
                        && source.contentSha256 == hint.pageTextSha256
                        && source.snapshotCitation == hint.snapshotCitation
                }
            }) else {
                return .drifted
            }
            guard handoff.manualSources.filter({ $0.provider == nil }).allSatisfy({ selected in
                current.sources.contains { source in
                    source.id == selected.id && source.symbol == handoff.symbol
                        && source.source == selected.title && source.sourceType == selected.sourceType
                        && source.readStatus == "BODY_READ" && source.url == selected.url
                        && source.publishedAt == selected.publishedAt
                        && source.contentSha256 == selected.contentSha256
                        && source.pageNumber == selected.pageNumber
                        && source.documentId == selected.documentId
                        && source.documentPdfSha256 == selected.documentPdfSha256
                }
            }) else { return .drifted }
        } else if !handoff.sources.isEmpty { return .drifted }
            for hint in handoff.providerSources {
                let url = auth.baseURL.appending(path: "api/mobile/research/candidate-memberships/\(handoff.membershipId)/futu-financial-statement-captures/\(hint.captureId)/material-preview")
                    .appending(queryItems: [URLQueryItem(name: "financialType", value: hint.financialType),
                                           URLQueryItem(name: "periodEnd", value: hint.periodEnd)])
                var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
                if let token = auth.readToken { request.setValue(token, forHTTPHeaderField: auth.readHeaderName) }
                let (bytes, response) = try await URLSession.shared.data(for: request)
                guard auth == AppEnvironment.researchAuthorizationContext(), selectedSymbol == handoff.symbol else { return .drifted }
                guard (response as? HTTPURLResponse)?.statusCode == 200,
                      let current = try? JSONDecoder().decode(PersonalFormalProviderReadback.self, from: bytes),
                      current.ok else { return .unavailable }
                let preview = current.data, source = preview.source
                guard source.membershipId == handoff.membershipId, source.membershipVersion == handoff.membershipVersion,
                      source.symbol == handoff.symbol, source.captureId == hint.captureId,
                      source.financialType == hint.financialType, source.periodEnd == hint.periodEnd,
                      source.sourceFingerprint == hint.sourceFingerprint,
                      researchDocumentSha256(Data(preview.contentText.utf8)) == preview.contentFingerprint,
                      hint.materials.isEmpty || hint.materials == preview.materials else { return .drifted }
            }
            return .current
        } catch {
            return .unavailable
        }
    }
}
