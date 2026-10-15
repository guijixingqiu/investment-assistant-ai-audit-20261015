import SwiftUI

private struct MarketPreviewCandidate: Identifiable {
    let id: String
    let symbol: String
    let name: String
    let status: String
}

struct GateAMarketScreen: View {
#if OWNER_CLIENT
    @Environment(\.clientDestination) private var clientDestination
#endif
    private enum QuoteRefreshOutcome { case live, stale, unavailable }
    @Environment(\.scenePhase) private var scenePhase
    @Binding var symbolInput: String
    @Binding var dailyEnvelope: MarketDailyTechnicalEnvelope?
    @Binding var weinsteinEnvelope: WeinsteinTechnicalAnalysisEnvelope?
    @Binding var globalToolSheet: GlobalToolSheet?
    @Binding var todayRefreshRevision: UInt64
    @Binding var pendingAnnouncement: OfficialAnnouncementDiscoveryItem?
    @Binding var pendingNoticeLead: NoticeLeadResearchHandoff?
    let refreshRevision: UInt64
    @State var envelope = MarketQuoteEnvelope.unavailable("尚未选择股票。", requestedSymbol: "UNSELECTED")
    @State var isLoading = false
    @State var isRefreshingDaily = false
    @State private var marketRefreshMessage: String?
    @State var marketFactsAreHistorical = false
    @State var quoteFactsAreHistorical = false
    @State var dailyFactsAreHistorical = false
    @State var isRunningWeinstein = false; @State var weinsteinMessage: String?; @State var weinsteinRequestId = UUID()
    @State var authorizationContext = AppEnvironment.researchAuthorizationContext()
    @State private var candidateAuthorizationContext = AppEnvironment.researchAuthorizationContext()
    @State var candidateAuthorizationRevision = UUID()
    @State private var marketScreenRequestId = UUID()
    @State var quoteRequestId = UUID()
    @State var dailyTechnicalRequestId = UUID()
    @State private var dailyRefreshRequestId = UUID()
    @State var marketResearchAdmissionRequestId = UUID()
    @State var isRefreshingMarketResearchAdmission = false
    @State private var locallyPublishedRefreshTaskId: String?
    /// 默认展开：这些解释面板仍需完整可见，只是收回首屏下方的次级层级。
    @State private var marketInterpretationExpanded = true
    @State var marketEnvironmentEnvelope = MarketEnvironmentEnvelope.unavailable(
        "尚未读取港股市场环境。",
        requestedSymbol: "UNSELECTED"
    )
    @State var marketEnvironmentIsHistorical = false
    @State var isLoadingMarketEnvironment = false
    @State var marketEnvironmentRequestId = UUID()
    @State var marketDiscoveryGeneration = UUID()
    @State private var candidateOverviewRequestId = UUID(); @State var membershipRequestId = UUID()
    @State var candidateNavigationRequestId = UUID()
    @State var candidateOverview = CandidateOverviewEnvelope.unavailable("正在读取已有研究候选。"); @State var candidateMemberships = CandidateMembershipEnvelope.unavailable("正在读取研究自选。", includeArchived: false)
    @State var portfolioTrendEnvelopes: [String: WeinsteinTechnicalAnalysisEnvelope] = [:]
    @State var portfolioTrendRequestId = UUID()
    @State var portfolioTrendLoadedIdentity: String?
    @State var portfolioTrendMessage = "正在读取组合周线趋势..."
    @State var isLoadingPortfolioTrends = false
    @State var marketScenarioWorkspace: FrozenResearchEvidenceWorkspace?
    @State var marketScenarioMembershipIdentity: String?
    @State var marketScenarioMessage = "正在读取当前股票的研究情景..."
    @State var isLoadingCandidates = false
    @State var membershipSubmissionState = CandidateMembershipSubmissionState()
    @State var membershipWriteMessage: String?
    let openResearchCandidate: (TodayCandidateNavigationTarget) -> Void
    let openImportedAnnouncement: (TodayCandidateNavigationTarget, OfficialAnnouncementDiscoveryItem) -> Void
    let openAssistedDecision: (String) -> Void
    var parsedSymbol: SecuritySymbol? { SecuritySymbol.parseHongKongAlias(symbolInput) }
    private var currentResearchTarget: TodayCandidateNavigationTarget? { parsedSymbol.flatMap { candidateResearchNavigationTarget(for: $0.canonical, in: candidateMemberships) } }
    var currentMarketFactsIssue: String? {
        guard let symbol = parsedSymbol else { return "请先选择一个有效港股。" }
        return marketResearchAdmissionIssue(
            market: symbol.market,
            code: symbol.code,
            quote: envelope,
            daily: dailyEnvelope,
            environment: marketEnvironmentEnvelope
        )
    }
    var hasRetainableMarketFacts: Bool {
        guard let symbol = parsedSymbol else { return false }
        return envelope.requestedSymbol == symbol.canonical && envelope.data?.symbol == symbol.canonical
            && dailyEnvelope?.isBound(to: symbol.canonical) == true && dailyEnvelope?.dailyBars.snapshot != nil
            && marketEnvironmentEnvelope.requestedSymbol == symbol.canonical && marketEnvironmentEnvelope.data != nil
    }
    var currentMarketResearchAdmissionIssue: String? {
        marketFactsAreHistorical ? "当前仅展示上次有效 Market 事实；刷新成功后才能进入研究。" : currentMarketFactsIssue
    }

    private var makeV9MarketContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .bottom) {
                Text("市场")
                    .font(.system(size: 26, weight: .bold, design: .serif))
                    .foregroundStyle(OwnerExperienceStyle.textPrimary)
                Spacer(minLength: 10)
                HStack(spacing: 8) {
                    MakeV9ThemeToggleButton()
                    MakeV9SearchButton(action: { globalToolSheet = .search }, label: "搜索股票")
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 52)
            .padding(.bottom, 12)

            Button { globalToolSheet = .search } label: {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(OwnerExperienceStyle.textSecondary)
                    Text("搜索港股代码或公司名称…")
                        .foregroundStyle(OwnerExperienceStyle.textSecondary)
                    Spacer(minLength: 0)
                }
                .font(.system(size: 14))
                .padding(.horizontal, 14)
                .frame(height: 44)
                .background(OwnerExperienceStyle.softBackground, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(OwnerExperienceStyle.accent.opacity(0.25), lineWidth: 1) }
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 16)

            MakeV9SectionLabel("市场环境")
            makeV9MarketEnvironmentCard
            MakeV9SectionLabel("候选跟踪", action: "管理")
            makeV9CandidateTracking
        }
        .padding(.bottom, 88)
    }

    private var makeV9MarketEnvironmentCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("港股整体")
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(OwnerExperienceStyle.textPrimary)
                Spacer()
                makeV9EnvironmentSourceBadge
            }
            Text(marketEnvironmentEnvelope.data.map { "市场状态：\(marketStateLabel) · breadth \($0.risk.breadthSignal) · 数据来自现有 Market API。" } ?? marketEnvironmentEnvelope.message)
                .font(.system(size: 13))
                .foregroundStyle(OwnerExperienceStyle.textSecondary)
                .lineSpacing(3)
                .padding(.top, 8)
            HStack(spacing: 0) {
                if let data = marketEnvironmentEnvelope.data {
                    let facts = Array(data.indices.prefix(2))
                    ForEach(facts) { fact in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(fact.name)
                                .font(.system(size: 11))
                                .foregroundStyle(OwnerExperienceStyle.textTertiary)
                            Text(String(format: "%.2f", fact.last))
                                .font(.system(size: 14, weight: .medium, design: .monospaced))
                                .foregroundStyle(OwnerExperienceStyle.textPrimary)
                            Text(String(format: "%+.2f%%", fact.changePercent))
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(fact.changePercent >= 0 ? OwnerExperienceStyle.success : OwnerExperienceStyle.danger)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 12)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("状态")
                            .font(.system(size: 11))
                            .foregroundStyle(OwnerExperienceStyle.textTertiary)
                        Text(marketStateLabel)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(OwnerExperienceStyle.gold)
                        Text(marketEnvironmentIsHistorical ? "历史结果" : "当前读取")
                            .font(.system(size: 10))
                            .foregroundStyle(OwnerExperienceStyle.textTertiary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 12)
                } else {
                    Text("市场环境尚未返回可验证数据。")
                        .font(.system(size: 12))
                        .foregroundStyle(OwnerExperienceStyle.warning)
                        .padding(.top, 12)
                }
            }
        }
        .padding(14)
        .background(OwnerExperienceStyle.cardBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(OwnerExperienceStyle.border, lineWidth: 1) }
        .padding(.horizontal, 16)
    }

    private var makeV9CandidateTracking: some View {
        VStack(spacing: 10) {
            ForEach(Array(marketPreviewCandidates.prefix(3))) { candidate in
                Button {
                    if candidate.symbol == parsedSymbol?.canonical {
                        openAssistedDecision(candidate.symbol)
                    } else {
                        openAssistedDecision(candidate.symbol)
                    }
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        MakeV9AnnulusRing(filled: candidate.symbol == parsedSymbol?.canonical ? 3 : 1)
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(candidate.symbol)
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(OwnerExperienceStyle.gold)
                                Text(candidate.name)
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(OwnerExperienceStyle.textPrimary)
                                Spacer(minLength: 4)
                                if candidate.symbol == parsedSymbol?.canonical, let quote = envelope.data {
                                    VStack(alignment: .trailing, spacing: 2) {
                                        Text("HK$\(quote.price, specifier: "%.2f")")
                                            .font(.system(size: 13, design: .monospaced))
                                            .foregroundStyle(OwnerExperienceStyle.textPrimary)
                                        Text(quote.changePercent.map { String(format: "%+.2f%%", $0) } ?? "涨跌未提供")
                                            .font(.system(size: 11, design: .monospaced))
                                            .foregroundStyle((quote.change ?? 0) >= 0 ? OwnerExperienceStyle.success : OwnerExperienceStyle.danger)
                                    }
                                }
                            }
                            Text(candidate.status)
                                .font(.system(size: 12.5))
                                .foregroundStyle(OwnerExperienceStyle.textSecondary)
                            HStack(spacing: 6) {
                                OwnerStatusPill(text: candidate.status, tint: candidate.symbol == parsedSymbol?.canonical ? OwnerExperienceStyle.accent : OwnerExperienceStyle.textSecondary)
                                if candidate.symbol == parsedSymbol?.canonical { makeV9QuoteSourceBadge }
                            }
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(OwnerExperienceStyle.cardBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(candidate.symbol == parsedSymbol?.canonical ? OwnerExperienceStyle.gold.opacity(0.45) : OwnerExperienceStyle.border, lineWidth: 1) }
                }
                .buttonStyle(.plain)
            }
            if marketPreviewCandidates.isEmpty {
                Text("当前没有可验证的候选研究成员。")
                    .font(.system(size: 13))
                    .foregroundStyle(OwnerExperienceStyle.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(OwnerExperienceStyle.cardBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
    }

    private var makeV9EnvironmentSourceBadge: some View {
        let tint: Color = marketEnvironmentEnvelope.status == .available
            ? OwnerExperienceStyle.success
            : OwnerExperienceStyle.warning
        let freshness = switch marketEnvironmentEnvelope.freshness() {
        case .fresh: "当前"
        case .closedLastObservation: "收市观测"
        case .stale: "陈旧"
        }
        return MakeV9SourceBadge(
            label: marketEnvironmentEnvelope.status == .available ? "OpenD · \(freshness)" : "OpenD · 不可用",
            tint: tint
        )
    }

    private var makeV9QuoteSourceBadge: some View {
        let tint: Color = envelope.status == .live ? OwnerExperienceStyle.success : OwnerExperienceStyle.warning
        let provider = switch envelope.source.provider {
        case .futu: "Futu"
        case .fixture: "样本"
        case .cache: "缓存"
        case .unavailable: "行情"
        }
        let freshness = switch envelope.status {
        case .live: "当前"
        case .stale: "陈旧"
        case .unavailable: "不可用"
        }
        return MakeV9SourceBadge(label: "\(provider) · \(freshness)", tint: tint)
    }
    var body: some View {
#if OWNER_CLIENT
        marketContent
#else
        NavigationStack { marketContent }
#endif
    }

#if OWNER_CLIENT
    @ViewBuilder private var clientMarketDetail: some View {
        VStack(alignment: .leading, spacing: 18) {
            if clientDestination == .environment {
                ClientCard(title: "市场环境", icon: "globe.asia.australia", tone: Theme.blue) {
                    GateAMarketEnvironmentSection(symbol: parsedSymbol?.canonical,
                        envelope: marketEnvironmentEnvelope, isRetained: marketEnvironmentIsHistorical,
                        isLoading: isLoadingMarketEnvironment, isExternallyBusy: isRefreshingDaily,
                        reload: reloadMarketEnvironment)
                }
                ClientCard(title: "环境对当前研究的影响", icon: "arrow.triangle.branch", tone: Theme.blue) {
                    NavigationLink { ClientReadingPage(title: "环境与行业传导") { marketScenarioTransmissionBrief() } }
                        label: { ClientLinkLabel(title: "查看环境与行业传导", icon: "arrow.triangle.branch", tone: Theme.blue) }
                    NavigationLink { ClientReadingPage(title: "市场、行业与个股") { marketPortfolioTrendComparison() } }
                        label: { ClientLinkLabel(title: "比较市场、行业与个股", icon: "chart.bar", tone: Theme.blue) }
                }.buttonStyle(.plain)
            } else if clientDestination == .announcements {
                ClientCard(title: "发现与公告", icon: "newspaper", tone: Theme.green) {
                    GateAMarketDiscoverySection(refreshRevision: todayRefreshRevision, symbolInput: $symbolInput, membershipWriteMessage: $membershipWriteMessage, pendingAnnouncement: $pendingAnnouncement, pendingNoticeLead: $pendingNoticeLead, discoveryGeneration: $marketDiscoveryGeneration, reloadCandidateOverview: loadCandidateOverview, refreshMarketResearchAdmission: refreshMarketResearchAdmission, marketResearchAdmissionIsCurrent: marketResearchAdmissionIsCurrent, discoveryContinuationIsCurrent: marketDiscoveryContinuationIsCurrent, openResearchCandidate: openResearchCandidate, openImportedAnnouncement: openImportedAnnouncement, openAssistedDecision: openAssistedDecision, openQualifiedCandidate: openQualifiedCandidate)
                }
            } else {
                ClientCard(title: parsedSymbol?.canonical ?? "个股行情", icon: "chart.line.uptrend.xyaxis", tone: Theme.blue) {
                    MarketQuoteView(envelope: envelope, isRetained: quoteFactsAreHistorical)
                    Button(isRefreshingDaily ? "刷新中…" : "刷新 OpenD 报价与日线") { Task { await refreshRealDaily() } }
                        .disabled(isRefreshingDaily || isLoading || parsedSymbol == nil)
                    if let marketRefreshMessage { Text(marketRefreshMessage).font(.caption).foregroundStyle(.secondary) }
                }
                ClientCard(title: "技术与趋势", icon: "waveform.path.ecg", tone: Theme.blue) {
                    NavigationLink { ClientReadingPage(title: "日线与技术指标") { MarketDailyTechnicalView(envelope: dailyEnvelope, isRetained: dailyFactsAreHistorical) } }
                        label: { ClientLinkLabel(title: "日线与技术指标", subtitle: "同一历史快照的均线、动量与波动", icon: "waveform.path.ecg", tone: Theme.blue) }
                    NavigationLink { ClientReadingPage(title: "周线阶段分析") { weinsteinTechnicalAnalysisSection() } }
                        label: { ClientLinkLabel(title: "周线阶段分析", subtitle: "趋势、条件与来源", icon: "chart.line.uptrend.xyaxis", tone: Theme.blue) }
                    NavigationLink { ClientReadingPage(title: "市场、行业与个股") { marketPortfolioTrendComparison() } }
                        label: { ClientLinkLabel(title: "市场、行业与个股比较", icon: "chart.bar", tone: Theme.blue) }
                }.buttonStyle(.plain)
                ClientPrimaryButton(title: "进入该股研究") {
                    let target = currentResearchTarget
                    Task { await openOrAddCurrentResearch(expectedOpenTarget: target) }
                }.disabled(currentMarketResearchAdmissionIssue != nil || membershipSubmissionState.isInFlight || candidateMemberships.status == .unavailable)
                if let membershipWriteMessage { ClientNote(text: membershipWriteMessage) }
            }
        }.padding(16).font(.system(size: 13)).controlSize(.small)
    }

#endif

    private var marketContent: some View {
        ScrollView {
#if OWNER_CLIENT
            clientMarketDetail
#else
            if AppEnvironment.isExperienceSession {
                makeV9MarketContent
            } else {
            VStack(alignment: .leading, spacing: 12) {
                marketFigmaHeader
                Button {
                    globalToolSheet = .search
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                        Text("搜索南向港股通股票…")
                        Spacer()
                    }
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 14)
                    .frame(height: 44)
                    .background(OwnerExperienceStyle.cardBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(OwnerExperienceStyle.subtleBorder, lineWidth: 1)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("marketSearchBar")
                marketFigmaStatusCard
                marketFigmaCandidateCards
                marketFigmaQuotePulse
                marketFigmaWeinsteinCard
                DisclosureGroup("详细市场数据与来源") {
                    VStack(alignment: .leading, spacing: 12) {
                        marketOwnerBrief()
                if marketFactsAreHistorical {
                    Label("本次刷新失败；以下为同一股票的上次有效结果，仅供浏览。", systemImage: "clock.arrow.circlepath")
                        .font(.subheadline)
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier("marketRetainedFactsNotice")
                }
                marketCandidateOverview()
                Text("当前行情与技术")
                    .font(.headline)
                    .foregroundStyle(OwnerExperienceStyle.textPrimary)
                MarketQuoteView(envelope: envelope, isRetained: quoteFactsAreHistorical)
                MarketDailyTechnicalView(envelope: dailyEnvelope, isRetained: dailyFactsAreHistorical)
                weinsteinTechnicalAnalysisSection()
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(currentResearchTarget == nil ? "尚未加入研究" : "证据核验中")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(currentMarketResearchAdmissionIssue == nil ? OwnerExperienceStyle.accent : OwnerExperienceStyle.warning)
                        if let issue = currentMarketResearchAdmissionIssue {
                            Text(issue)
                                .font(.caption2)
                                .foregroundStyle(OwnerExperienceStyle.warning)
                                .lineLimit(2)
                                .accessibilityIdentifier("marketResearchAdmissionIssue")
                        }
                    }
                    Spacer(minLength: 4)
                    Button {
                        let expectedOpenTarget = currentResearchTarget
                        Task { await openOrAddCurrentResearch(expectedOpenTarget: expectedOpenTarget) }
                    } label: {
                        Label(
                            membershipSubmissionState.isInFlight ? "加入中" : currentResearchTarget == nil ? "加入研究" : "打开研究",
                            systemImage: currentResearchTarget == nil ? "plus.circle.fill" : "arrow.right.circle.fill"
                        )
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(currentMarketResearchAdmissionIssue != nil || isRefreshingDaily || isRefreshingMarketResearchAdmission || isLoading || isLoadingMarketEnvironment || isLoadingCandidates || candidateMemberships.status == .unavailable || membershipSubmissionState.isInFlight)
                    .accessibilityIdentifier("marketResearchNextStepButton")
                }
                .cardStyle(padding: 12)
                if let membershipWriteMessage {
                    Text(membershipWriteMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("marketCandidateMembershipWriteMessage")
                }
                Text("发现与轻核查 · 非推荐、非排名")
                    .font(.headline)
                    .foregroundStyle(OwnerExperienceStyle.textPrimary)
                GateAMarketDiscoverySection(refreshRevision: todayRefreshRevision, symbolInput: $symbolInput, membershipWriteMessage: $membershipWriteMessage, pendingAnnouncement: $pendingAnnouncement, pendingNoticeLead: $pendingNoticeLead, discoveryGeneration: $marketDiscoveryGeneration, reloadCandidateOverview: loadCandidateOverview, refreshMarketResearchAdmission: refreshMarketResearchAdmission, marketResearchAdmissionIsCurrent: marketResearchAdmissionIsCurrent, discoveryContinuationIsCurrent: marketDiscoveryContinuationIsCurrent, openResearchCandidate: openResearchCandidate, openImportedAnnouncement: openImportedAnnouncement, openAssistedDecision: openAssistedDecision, openQualifiedCandidate: openQualifiedCandidate)
                DisclosureGroup(isExpanded: $marketInterpretationExpanded) {
                    VStack(alignment: .leading, spacing: 12) {
                        GateAMarketEnvironmentSection(
                            symbol: parsedSymbol?.canonical,
                            envelope: marketEnvironmentEnvelope,
                            isRetained: marketEnvironmentIsHistorical,
                            isLoading: isLoadingMarketEnvironment,
                            isExternallyBusy: isRefreshingDaily || isRefreshingMarketResearchAdmission || membershipSubmissionState.isInFlight,
                            reload: reloadMarketEnvironment
                        )
                        marketScenarioTransmissionBrief()
                        marketPortfolioTrendComparison()
                    }
                    .padding(.top, 8)
                } label: {
                    Label("市场环境、传导与组合趋势解释", systemImage: "chart.xyaxis.line")
                        .font(.headline)
                }
                .accessibilityIdentifier("marketInterpretationDisclosure")
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 16) {
                        marketStatusSummary
                        Button {
                            Task { await refreshRealDaily() }
                        } label: {
                            Label(
                                isRefreshingDaily ? "刷新价格与日线技术中" : "刷新价格与日线技术",
                                systemImage: "arrow.triangle.2.circlepath"
                            )
                            .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(isRefreshingDaily || isRefreshingMarketResearchAdmission || membershipSubmissionState.isInFlight || isLoading || parsedSymbol == nil)
                        .accessibilityIdentifier("marketRefreshRealDailyEvidenceButton")
                        if let marketRefreshMessage {
                            Text(marketRefreshMessage)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .accessibilityIdentifier("marketRefreshMessage")
                        }
                    }
                    .padding(.top, 8)
                } label: {
                    Label("刷新与来源记录", systemImage: "chart.xyaxis.line")
                        .font(.headline)
                }
                .accessibilityIdentifier("marketFactsDisclosure")
                    }
                    .padding(.top, 8)
                }
                .cardStyle(padding: 14)
            }
            .padding(16)
            .controlSize(.large)
            }
#endif
        }
        .accessibilityIdentifier("marketScrollView")
        .ownerPageBackground()
        .safeAreaPadding(.bottom, 72)
#if !OWNER_CLIENT
        .toolbar(.hidden, for: .navigationBar)
#endif
        .task(id: "\(parsedSymbol?.canonical ?? symbolInput):\(refreshRevision)") {
            let taskId = "\(parsedSymbol?.canonical ?? symbolInput):\(refreshRevision)"
            let isOwnRefresh = locallyPublishedRefreshTaskId == taskId
            locallyPublishedRefreshTaskId = nil
            guard !isOwnRefresh else { return }
            resetMarketScreenForSymbolChangeIfNeeded()
            await loadMarketScreen()
        }
        .task(id: marketPortfolioTrendLoadIdentity) {
            await loadMarketPortfolioTrends()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            let next = AppEnvironment.researchAuthorizationContext()
            guard next != authorizationContext || next != candidateAuthorizationContext else { return }
            authorizationContext = next
            candidateAuthorizationContext = next
            candidateAuthorizationRevision = UUID()
            todayRefreshRevision &+= 1
            marketScreenRequestId = UUID()
            quoteRequestId = UUID()
            dailyTechnicalRequestId = UUID()
            dailyRefreshRequestId = UUID()
            marketDiscoveryGeneration = UUID()
            marketResearchAdmissionRequestId = UUID()
            isRefreshingMarketResearchAdmission = false
            candidateOverviewRequestId = UUID()
            candidateNavigationRequestId = UUID()
            resetCandidateMembershipWrite(); resetWeinsteinAnalysis()
            isLoading = false
            isLoadingCandidates = false
            marketFactsAreHistorical = false
            quoteFactsAreHistorical = false
            dailyFactsAreHistorical = false
            marketEnvironmentIsHistorical = false
            envelope = .unavailable(
                "读取授权已变化；旧行情事实已清除。",
                requestedSymbol: parsedSymbol?.canonical ?? envelope.requestedSymbol
            )
            marketEnvironmentRequestId = UUID()
            isLoadingMarketEnvironment = false
            marketEnvironmentEnvelope = .unavailable(
                "读取授权已变化；旧市场环境已清除。",
                requestedSymbol: parsedSymbol?.canonical ?? "UNSELECTED"
            )
            if let parsedSymbol {
                dailyEnvelope = .unavailable(
                    "读取授权已变化；旧日线与指标已清除。",
                    market: parsedSymbol.market,
                    code: parsedSymbol.code,
                    cutoff: currentHongKongRequestDate()
                )
            } else {
                dailyEnvelope = nil
            }
            candidateOverview = .unavailable("读取授权已变化；旧候选列表已清除。")
            candidateMemberships = .unavailable("读取授权已变化；旧研究自选已清除。", includeArchived: false)
            marketScenarioWorkspace = nil
            marketScenarioMembershipIdentity = nil
            marketScenarioMessage = "读取授权已变化；旧研究情景已清除。"
            if !isRefreshingDaily && !isRefreshingMarketResearchAdmission && !membershipSubmissionState.isInFlight {
                Task { await loadMarketScreen() }
            }
        }
    }

    private var marketFigmaHeader: some View {
        HStack(alignment: .center, spacing: 12) {
            Text("市场")
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundStyle(OwnerExperienceStyle.textPrimary)
            Spacer(minLength: 8)
            Text("只读 / Advisory Only")
                .font(.caption.weight(.medium))
                .foregroundStyle(OwnerExperienceStyle.textSecondary)
                .padding(.horizontal, 12)
                .frame(width: 136, height: 32)
                .background(OwnerExperienceStyle.cardBackground, in: Capsule())
                .overlay(Capsule().stroke(OwnerExperienceStyle.subtleBorder, lineWidth: 1))
        }
        .frame(height: 72)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("市场，只读 / Advisory Only")
    }

    private var marketFigmaStatusCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("港股市场")
                .font(.headline)
            HStack(spacing: 8) {
                marketStatusMetric("市场状态", marketEnvironmentEnvelope.data?.marketState ?? "待读取", .secondary)
                marketStatusMetric("OpenD 行情源", envelope.source.provider == .futu ? "可用" : "待读取", envelope.source.provider == .futu ? OwnerExperienceStyle.success : OwnerExperienceStyle.warning)
                marketStatusMetric("日线证据", dailyEnvelope?.dailyBars.status == .available ? "complete" : "待补齐", dailyEnvelope?.dailyBars.status == .available ? OwnerExperienceStyle.success : OwnerExperienceStyle.warning)
            }
        }
        .cardStyle(padding: 14)
        .frame(minHeight: 100, alignment: .topLeading)
        .accessibilityIdentifier("marketFigmaStatusCard")
    }

    private func marketStatusMetric(_ title: String, _ value: String, _ tint: Color) -> some View {
        VStack(spacing: 3) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(OwnerExperienceStyle.textSecondary)
                .multilineTextAlignment(.center)
            Text(value)
                .font(.caption.weight(.semibold))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity)
    }

    private var marketFigmaCandidateCards: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("候选与发现")
                    .font(.headline)
                Spacer()
                Text("非推荐、非排名")
                    .font(.caption)
                    .foregroundStyle(OwnerExperienceStyle.textSecondary)
            }
            HStack(spacing: 8) {
                ForEach(marketPreviewCandidates.prefix(3)) { candidate in
                    Button {
                        symbolInput = candidate.symbol
                        Task { await openExistingResearch(candidate.symbol) }
                    } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(candidate.symbol.replacingOccurrences(of: "HK.", with: ""))
                                .font(.caption2.weight(.bold).monospacedDigit())
                                .foregroundStyle(OwnerExperienceStyle.accent)
                            Text(candidate.name)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(OwnerExperienceStyle.textPrimary)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                            Text(candidate.status)
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(candidate.symbol == parsedSymbol?.canonical ? OwnerExperienceStyle.accent : OwnerExperienceStyle.textSecondary)
                        }
                        .frame(maxWidth: .infinity, minHeight: 112, alignment: .leading)
                        .padding(10)
                        .background(OwnerExperienceStyle.cardBackground, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(candidate.symbol == parsedSymbol?.canonical ? OwnerExperienceStyle.accent : OwnerExperienceStyle.subtleBorder, lineWidth: 1)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("marketFigmaCandidate-\(candidate.symbol)")
                }
            }
        }
        .frame(minHeight: 112, alignment: .topLeading)
        .accessibilityIdentifier("marketFigmaCandidateCards")
    }

    private var marketPreviewCandidates: [MarketPreviewCandidate] {
        var seen = Set<String>()
        var result: [MarketPreviewCandidate] = []
        for membership in candidateMemberships.memberships where seen.insert(membership.symbol).inserted {
            result.append(.init(id: membership.symbol, symbol: membership.symbol, name: membership.research.name ?? membership.symbol, status: membership.state == .tracked ? "已跟踪" : "待观察"))
        }
        for candidate in candidateOverview.candidates where seen.insert(candidate.symbol).inserted {
            result.append(.init(id: candidate.symbol, symbol: candidate.symbol, name: candidate.name ?? candidate.symbol, status: candidate.evidenceCount > 0 ? "可研究" : "待观察"))
        }
        return result
    }

    private var marketFigmaQuotePulse: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("行情快照 · \(parsedSymbol?.canonical ?? "当前标的")")
                    .font(.headline)
                Spacer()
                Text("只读")
                    .font(.caption)
                    .foregroundStyle(OwnerExperienceStyle.textSecondary)
            }
            if let quote = envelope.data {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(quote.currency) \(quote.price, specifier: "%.2f")")
                        .font(.title.weight(.bold).monospacedDigit())
                    Text(quote.changePercent.map { String(format: "%+.2f%%", $0) } ?? "涨跌待补齐")
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle((quote.change ?? 0) >= 0 ? .green : .red)
                }
                marketMiniSparkline
            } else {
                Text("尚未读取到当前股票的可验证行情。")
                    .font(.caption)
                    .foregroundStyle(OwnerExperienceStyle.textSecondary)
            }
        }
        .cardStyle(padding: 14)
        .frame(minHeight: 226, alignment: .topLeading)
        .accessibilityIdentifier("marketFigmaQuotePulse")
    }

    private var marketMiniSparkline: some View {
        GeometryReader { proxy in
            let points = (dailyEnvelope?.technical.points ?? []).suffix(30).map { $0.candle.close }
            Path { path in
                guard points.count > 1, let low = points.min(), let high = points.max(), high > low else { return }
                for (index, value) in points.enumerated() {
                    let x = proxy.size.width * CGFloat(index) / CGFloat(points.count - 1)
                    let y = proxy.size.height - (CGFloat((value - low) / (high - low)) * proxy.size.height)
                    if index == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
                }
            }
            .stroke(OwnerExperienceStyle.accent, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
            .background(OwnerExperienceStyle.accent.opacity(0.08))
        }
        .frame(height: 116)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var marketFigmaWeinsteinCard: some View {
        let result = weinsteinEnvelope?.status == "available"
            && weinsteinEnvelope?.symbol == parsedSymbol?.canonical
            ? weinsteinEnvelope
            : nil
        return HStack(spacing: 8) {
            marketStatusMetric("Weinstein", result == nil ? "待补齐" : "可解释周线", result == nil ? OwnerExperienceStyle.warning : OwnerExperienceStyle.success)
            marketStatusMetric("趋势", result.map { marketFigmaWeinsteinStage($0.stockStage) } ?? "待确认", OwnerExperienceStyle.textSecondary)
            marketStatusMetric("成交量", result == nil ? "待补齐" : "已加载", result == nil ? OwnerExperienceStyle.warning : OwnerExperienceStyle.success)
        }
        .cardStyle(padding: 14)
        .frame(minHeight: 78, alignment: .topLeading)
        .accessibilityIdentifier("marketFigmaWeinsteinCard")
    }

    private func marketFigmaWeinsteinStage(_ stage: String) -> String {
        switch stage {
        case "STAGE_2": "上升"
        case "STAGE_3": "转换"
        case "STAGE_4": "下降"
        default: "待确认"
        }
    }

    private var marketStatusSummary: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("港股通市场")
                    .font(.callout.weight(.semibold))
                Text("官方南向港股通候选池 · Futu/OpenD")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Label(
                    marketEnvironmentEnvelope.status == .available
                        ? "Futu 行情（只读） · \(marketStateLabel)"
                        : marketStateLabel,
                    systemImage: "circle.fill"
                )
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(marketEnvironmentEnvelope.status == .available ? .orange : .secondary)
                    .accessibilityIdentifier("marketEnvironmentSourceHeader")
                Text(String((marketEnvironmentEnvelope.asOf ?? envelope.asOf ?? "时间未知").prefix(16)))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .cardStyle(padding: 14)
    }

    private var marketStateLabel: String {
        switch marketEnvironmentEnvelope.data?.marketState {
        case "OPEN": "港股开市"
        case "PRE_OPEN": "港股盘前"
        case "MORNING": "港股上午交易中"
        case "REST": "港股午间休市"
        case "AFTERNOON": "港股下午交易中"
        case "CLOSED": "港股已收市"
        case .some: "港股状态待确认"
        case nil: "状态待读取"
        }
    }

    @MainActor
    private func resetMarketScreenForSymbolChangeIfNeeded() {
        let nextSymbol = parsedSymbol?.canonical ?? "UNSELECTED"
        guard envelope.requestedSymbol != nextSymbol else { return }
        marketFactsAreHistorical = false
        quoteFactsAreHistorical = false
        dailyFactsAreHistorical = false
        marketEnvironmentIsHistorical = false
        marketScreenRequestId = UUID(); quoteRequestId = UUID(); dailyTechnicalRequestId = UUID(); dailyRefreshRequestId = UUID(); marketEnvironmentRequestId = UUID(); marketDiscoveryGeneration = UUID(); marketResearchAdmissionRequestId = UUID(); candidateOverviewRequestId = UUID(); candidateNavigationRequestId = UUID(); isRefreshingMarketResearchAdmission = false; isLoadingMarketEnvironment = false
        resetCandidateMembershipWrite(); resetWeinsteinAnalysis()
        envelope = .unavailable("标的已变化；旧行情事实已清除。", requestedSymbol: nextSymbol)
        dailyEnvelope = parsedSymbol.map {
            .unavailable("标的已变化；旧日线与指标已清除。", market: $0.market, code: $0.code, cutoff: currentHongKongRequestDate())
        }
        marketEnvironmentEnvelope = .unavailable("标的已变化；旧市场环境已清除。", requestedSymbol: nextSymbol)
        marketScenarioWorkspace = nil
        marketScenarioMembershipIdentity = nil
        marketScenarioMessage = "标的已变化；旧研究情景已清除。"
        if pendingAnnouncement?.symbol != nextSymbol { pendingAnnouncement = nil }
    }

    @MainActor
    func loadMarketScreen() async {
        guard !isRefreshingDaily,
              !isRefreshingMarketResearchAdmission,
              !membershipSubmissionState.isInFlight else { return }
        marketResearchAdmissionRequestId = UUID()
        candidateNavigationRequestId = UUID()
        let retainedBeforeRead = hasRetainableMarketFacts
        let requestId = UUID()
        marketScreenRequestId = requestId
        async let facts: Bool = loadMarketFacts(screenRequestId: requestId)
        async let environment: Bool = loadMarketEnvironment()
        async let candidates: Bool = loadCandidateOverview()
        let (factsLoaded, environmentLoaded, _) = await (facts, environment, candidates)
        await runWeinsteinAnalysis()
        if marketScreenRequestId == requestId {
            marketFactsAreHistorical = factsLoaded && environmentLoaded && currentMarketFactsIssue == nil
                ? false : retainedBeforeRead && hasRetainableMarketFacts
        }
    }
    @MainActor
    private func refreshRealDaily() async {
        guard !isRefreshingDaily,
              !isRefreshingMarketResearchAdmission,
              !membershipSubmissionState.isInFlight else { return }
        resetWeinsteinAnalysis()
        guard let symbol = parsedSymbol else {
            dailyEnvelope = nil
            return
        }
        let retainPrevious = hasRetainableMarketFacts
        let context = AppEnvironment.researchAuthorizationContext()
        let requestId = UUID()
        marketResearchAdmissionRequestId = UUID()
        candidateNavigationRequestId = UUID()
        dailyRefreshRequestId = requestId
        marketScreenRequestId = UUID()
        quoteRequestId = UUID()
        authorizationContext = context
        isLoading = false
        isRefreshingDaily = true
        marketFactsAreHistorical = retainPrevious
        dailyFactsAreHistorical = retainPrevious
        marketRefreshMessage = retainPrevious
            ? "正在刷新 \(symbol.canonical)；暂时保留上次有效结果。"
            : "正在刷新 \(symbol.canonical) 的价格与完成交易日日线。"
        if !retainPrevious {
            dailyEnvelope = .unavailable(
                "正在刷新完成交易日日线；当前没有可保留的有效结果。",
                market: symbol.market,
                code: symbol.code,
                cutoff: currentHongKongRequestDate()
            )
        }
        defer {
            isRefreshingDaily = false
            if parsedSymbol?.canonical != symbol.canonical
                || AppEnvironment.researchAuthorizationContext() != context {
                Task { await loadMarketScreen() }
            }
        }
        let client = MarketDailyTechnicalClient(
            baseURL: context.baseURL,
            authToken: context.readToken,
            authHeaderName: context.readHeaderName,
            writeAuthToken: context.writeToken,
            writeAuthHeaderName: context.writeHeaderName
        )
        let quoteOutcome = await refreshQuoteFromProvider(retainPrevious: retainPrevious)
        guard dailyRefreshRequestId == requestId,
              parsedSymbol?.canonical == symbol.canonical else { return }
        guard AppEnvironment.researchAuthorizationContext() == context else {
            await loadMarketScreen()
            return
        }
        do {
            let fetched = try await client.refresh(market: symbol.market, code: symbol.code)
            guard dailyRefreshRequestId == requestId,
                  parsedSymbol?.canonical == symbol.canonical else { return }
            guard AppEnvironment.researchAuthorizationContext() == context else { await loadMarketScreen(); return }
            dailyEnvelope = fetched
            dailyFactsAreHistorical = false
            marketFactsAreHistorical = quoteOutcome == .unavailable && retainPrevious
            marketRefreshMessage = switch quoteOutcome {
            case .live: "实时价格与日线技术已更新。"
            case .stale: "日线技术已更新；价格来源不是当前实时状态，已明确显示为陈旧。"
            case .unavailable: retainPrevious ? "日线技术已更新；价格刷新失败，继续显示上次有效价格且禁止进入研究。" : "日线技术已更新；价格刷新失败，当前价格已清除。"
            }
            let nextRevision = todayRefreshRevision &+ 1
            locallyPublishedRefreshTaskId = "\(symbol.canonical):\(nextRevision)"
            todayRefreshRevision = nextRevision
        } catch {
            guard dailyRefreshRequestId == requestId,
                  parsedSymbol?.canonical == symbol.canonical else { return }
            guard AppEnvironment.researchAuthorizationContext() == context else { await loadMarketScreen(); return }
            if !retainPrevious {
                dailyEnvelope = .unavailable(
                    "日线技术刷新失败：\(error.localizedDescription)",
                    market: symbol.market,
                    code: symbol.code,
                    cutoff: currentHongKongRequestDate()
                )
            }
            marketFactsAreHistorical = retainPrevious
            marketRefreshMessage = switch quoteOutcome {
            case .live: retainPrevious ? "实时价格已更新；日线失败，继续显示上次有效日线且禁止进入研究。" : "实时价格已更新；日线技术刷新失败。"
            case .stale: retainPrevious ? "价格已明确标为陈旧；日线失败，继续显示上次有效日线且禁止进入研究。" : "价格已明确标为陈旧；日线技术刷新失败。"
            case .unavailable: retainPrevious ? "刷新失败；继续显示同一股票的上次有效结果且禁止进入研究。" : "价格与日线技术刷新失败；请检查连接后重试。"
            }
        }
    }
    @MainActor
    @discardableResult
    func loadCandidateOverview() async -> Bool {
        let context = AppEnvironment.researchAuthorizationContext()
        let requestId = UUID()
        candidateAuthorizationContext = context
        candidateOverviewRequestId = requestId
        isLoadingCandidates = true
        candidateOverview = .unavailable("正在重新读取已有研究候选。")
        defer {
            if candidateOverviewRequestId == requestId { isLoadingCandidates = false }
        }
        let client = ResearchClient(
            baseURL: context.baseURL,
            authToken: context.readToken,
            authHeaderName: context.readHeaderName
        )
        async let overview = client.fetchCandidateOverview()
        async let memberships = client.fetchCandidateMemberships(includeArchived: false)
        let (fetched, tracked) = await (overview, memberships)
        guard candidateOverviewRequestId == requestId,
              candidateAuthorizationContext == context else { return false }
        candidateOverview = fetched
        candidateMemberships = tracked
        return true
    }
    @MainActor
    private func loadMarketFacts(screenRequestId: UUID) async -> Bool {
        guard let symbol = parsedSymbol else {
            envelope = .unavailable("输入无效，未发送行情请求。")
            dailyEnvelope = nil
            return false
        }
        let quoteLoaded = await loadQuote()
        guard marketScreenRequestId == screenRequestId else { return false }
        return await loadDailyTechnical() && quoteLoaded
    }
    @MainActor
    private func refreshQuoteFromProvider(retainPrevious: Bool) async -> QuoteRefreshOutcome {
        guard let symbol = parsedSymbol, !isLoading else { return .unavailable }
        let context = AppEnvironment.researchAuthorizationContext()
        let requestId = UUID()
        authorizationContext = context
        quoteRequestId = requestId
        isLoading = true
        quoteFactsAreHistorical = retainPrevious
        if !retainPrevious {
            envelope = .unavailable(
                "正在刷新当前价格；当前没有可保留的有效结果。",
                requestedSymbol: symbol.canonical
            )
        }
        defer {
            if quoteRequestId == requestId { isLoading = false }
        }
        let client = MarketQuoteClient(
            baseURL: context.baseURL,
            authToken: context.readToken,
            authHeaderName: context.readHeaderName,
            writeAuthToken: context.writeToken,
            writeAuthHeaderName: context.writeHeaderName
        )
        do {
            let fetched = try await client.refreshQuote(market: symbol.market, code: symbol.code)
            guard quoteRequestId == requestId,
                  authorizationContext == context,
                  parsedSymbol?.canonical == symbol.canonical else { return .unavailable }
            if fetched.status == .live, fetched.source.providerStatus == .live {
                envelope = fetched
                quoteFactsAreHistorical = false
                return .live
            }
            if fetched.status == .stale, fetched.data != nil {
                envelope = fetched
                quoteFactsAreHistorical = false
                return .stale
            }
            if !retainPrevious { envelope = fetched }
            quoteFactsAreHistorical = retainPrevious
            return .unavailable
        } catch {
            guard quoteRequestId == requestId,
                  authorizationContext == context,
                  parsedSymbol?.canonical == symbol.canonical else { return .unavailable }
            if !retainPrevious {
                envelope = .unavailable(
                    "价格刷新失败：\(error.localizedDescription)",
                    requestedSymbol: symbol.canonical
                )
            }
            quoteFactsAreHistorical = retainPrevious
            return .unavailable
        }
    }
}
