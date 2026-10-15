import SwiftUI
struct TodayRootView: View {
    @Binding var symbolInput: String
    @Binding var localDraft: LocalDecisionDraft?
    let refreshRevision: UInt64
    @Binding var reportRevisionNotice: TodayReportRevisionNotice?
    @Binding var globalToolSheet: GlobalToolSheet?
    @AppStorage("researchArchiveBackupDirectoryBookmark.v1") private var researchArchiveBackupBookmark = Data()
    @AppStorage(researchArchiveBackupStateRevisionKey) private var researchArchiveBackupStateRevision = 0
    private let connectionChanged: () -> Void
    @State private var reviewDueEnvelope: TodayReviewDueEnvelope?
    @State private var isReviewDueLoading: Bool
    @State private var reviewDueLoadGate: TodayReviewDueLoadGate
    @State var isOpeningReview = false
    @State private var quoteEnvelope: MarketQuoteEnvelope?
    @State private var isQuoteLoading = false
    @State private var quoteReadIssue: String?
    @State private var quoteRequestId = UUID()
    private let reviewDueClient: any TodayReviewDueFetching
    private let todayActionInboxClient: any TodayActionInboxFetching
    private let openResearch: (String) -> Void
    private let openMarket: (String?) -> Void
    private let openMarketAnnouncement: (OfficialAnnouncementDiscoveryItem) -> Void
    private let openAssets: () -> Void
    private let openResearchDecision: (String) -> Void
    private let openResearchCandidate: (TodayCandidateNavigationTarget) -> Void
    private let openResearchToday: (TodayResearchNavigationTarget) -> Void
    private let openResearchReview: (TodayReviewNavigationTarget) -> Void
    let openResearchFormalDecision: (TodayFormalDecisionNavigationTarget) -> Void
    let openResearchReportRevision: (TodayReportRevisionNotice) -> Void
    init(
        symbolInput: Binding<String>,
        localDraft: Binding<LocalDecisionDraft?>,
        refreshRevision: UInt64,
        reportRevisionNotice: Binding<TodayReportRevisionNotice?>,
        globalToolSheet: Binding<GlobalToolSheet?>,
        connectionChanged: @escaping () -> Void,
        reviewDueClient: any TodayReviewDueFetching = TodayReviewDueClient(
            baseURL: AppEnvironment.baseURL(),
            authToken: AppEnvironment.authToken(),
            authHeaderName: AppEnvironment.authHeaderName()
        ),
        todayActionInboxClient: any TodayActionInboxFetching = ResearchClient(
            baseURL: AppEnvironment.baseURL(),
            authToken: AppEnvironment.authToken(),
            authHeaderName: AppEnvironment.authHeaderName(),
            writeAuthToken: AppEnvironment.writeAuthToken(),
            writeAuthHeaderName: AppEnvironment.writeAuthHeaderName()
        ),
        openResearch: @escaping (String) -> Void,
        openMarket: @escaping (String?) -> Void,
        openMarketAnnouncement: @escaping (OfficialAnnouncementDiscoveryItem) -> Void,
        openAssets: @escaping () -> Void,
        openResearchDecision: @escaping (String) -> Void,
        openResearchCandidate: @escaping (TodayCandidateNavigationTarget) -> Void,
        openResearchToday: @escaping (TodayResearchNavigationTarget) -> Void,
        openResearchReview: @escaping (TodayReviewNavigationTarget) -> Void,
        openResearchFormalDecision: @escaping (TodayFormalDecisionNavigationTarget) -> Void,
        openResearchReportRevision: @escaping (TodayReportRevisionNotice) -> Void
    ) {
        _symbolInput = symbolInput
        _localDraft = localDraft
        self.refreshRevision = refreshRevision
        _reportRevisionNotice = reportRevisionNotice
        _globalToolSheet = globalToolSheet
        self.connectionChanged = connectionChanged
        _reviewDueEnvelope = State(initialValue: nil)
        _isReviewDueLoading = State(initialValue: false)
        _reviewDueLoadGate = State(initialValue: TodayReviewDueLoadGate())
        _quoteEnvelope = State(initialValue: nil)
        self.reviewDueClient = reviewDueClient
        self.todayActionInboxClient = todayActionInboxClient
        self.openResearch = openResearch
        self.openMarket = openMarket
        self.openMarketAnnouncement = openMarketAnnouncement
        self.openAssets = openAssets
        self.openResearchDecision = openResearchDecision
        self.openResearchCandidate = openResearchCandidate
        self.openResearchToday = openResearchToday
        self.openResearchReview = openResearchReview
        self.openResearchFormalDecision = openResearchFormalDecision
        self.openResearchReportRevision = openResearchReportRevision
    }
    private var currentCanonicalSymbol: String? {
        SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical
    }
    private var currentDraft: LocalDecisionDraft? {
        localDraft?.isBound(to: currentCanonicalSymbol) == true ? localDraft : nil
    }
    private var currentResearchArchiveBackupState: ResearchArchiveBackupState? {
        _ = researchArchiveBackupStateRevision
        guard let symbol = currentCanonicalSymbol else { return nil }
        return researchArchiveBackupState(symbol: symbol, bookmark: researchArchiveBackupBookmark)
    }
    private var usesLegacyTodayPresentation: Bool {
#if OWNER_CLIENT
        false
#else
        AppEnvironment.isExperienceSession
#endif
    }
    var body: some View {
        ScrollView {
            if usesLegacyTodayPresentation {
                makeV9TodayContent
            } else {
                VStack(alignment: .leading, spacing: 12) {
#if !OWNER_CLIENT
                    todayHeader
                    todaySelectedStockCard
#endif
                    TodayActionInboxCard(
                        refreshRevision: refreshRevision,
                        fallbackSymbol: currentCanonicalSymbol,
                        client: todayActionInboxClient,
                        openResearch: openResearch,
                        openMarket: openMarket,
                        openAssets: openAssets,
                        openResearchCandidate: openResearchCandidate,
                        openResearchToday: openResearchToday,
                        openResearchReview: openResearchReview,
                        openResearchFormalDecision: openResearchFormalDecision,
                        progressSlot: AnyView(todayResearchProgressCard)
                    )
                }
                .padding(.horizontal, 16)
                .padding(.top, 24)
                .padding(.bottom, 16)
            }
        }
            .ownerPageBackground()
            #if !OWNER_CLIENT
            .ignoresSafeArea(.container, edges: .top)
#endif
            .safeAreaPadding(.bottom, 72)
            .accessibilityIdentifier("todayRoot")
        .onChange(of: currentCanonicalSymbol) { _, _ in
            reviewDueLoadGate.invalidate()
            quoteRequestId = UUID()
            reviewDueEnvelope = nil
            quoteEnvelope = nil
            quoteReadIssue = nil
            isReviewDueLoading = currentCanonicalSymbol != nil
            if reportRevisionNotice?.symbol != currentCanonicalSymbol {
                reportRevisionNotice = nil
            }
        }
        .task(id: "\(currentCanonicalSymbol ?? "none"):\(refreshRevision)") {
            await loadReviewDue()
        }
        .task(id: "quote:\(currentCanonicalSymbol ?? "none"):\(refreshRevision)") {
            await loadTodayQuote()
        }
    }

    private var makeV9TodayContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("API 连接 · \(boundQuoteInstantLabel(symbol: currentCanonicalSymbol ?? "") ?? "等待真实行情")")
                        .font(.system(size: 11, weight: .regular, design: .monospaced))
                        .foregroundStyle(OwnerExperienceStyle.textTertiary)
                    Text("今日")
                        .font(.system(size: 26, weight: .bold, design: .serif))
                        .foregroundStyle(OwnerExperienceStyle.textPrimary)
                }
                Spacer(minLength: 10)
                HStack(spacing: 8) {
                    MakeV9ThemeToggleButton()
                    MakeV9SearchButton(action: { globalToolSheet = .search }, label: "搜索")
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 52)
            .padding(.bottom, 12)

            makeV9PriorityCard
            MakeV9SectionLabel("今日变化", action: "查看全部")
            makeV9TodayChanges
            MakeV9SectionLabel("市场脉动")
            makeV9MarketPulse
        }
        .padding(.bottom, 88)
    }

    private var makeV9PriorityCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                HStack(spacing: 6) {
                    Circle()
                        .fill(OwnerExperienceStyle.warning)
                        .frame(width: 7, height: 7)
                    Text("优先处理")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .tracking(1)
                        .foregroundStyle(OwnerExperienceStyle.warning)
                }
                Spacer()
                makeV9QuoteSourceBadge
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)

            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(currentCanonicalSymbol ?? "未选择港股")
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundStyle(OwnerExperienceStyle.gold)
                    Text(boundQuoteData(symbol: currentCanonicalSymbol ?? "")?.name ?? "当前研究标的")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(OwnerExperienceStyle.textPrimary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    if let quote = boundQuoteData(symbol: currentCanonicalSymbol ?? "") {
                        Text("\(quote.price, specifier: "%.2f")")
                            .font(.system(size: 18, weight: .medium, design: .monospaced))
                            .foregroundStyle(OwnerExperienceStyle.textPrimary)
                        Text(quote.changePercent.map { String(format: "%+.2f%%", $0) } ?? "涨跌未提供")
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle((quote.change ?? 0) >= 0 ? OwnerExperienceStyle.success : OwnerExperienceStyle.danger)
                    } else {
                        Text("行情未读取")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(OwnerExperienceStyle.warning)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 10)

            HStack(alignment: .top, spacing: 7) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OwnerExperienceStyle.warning)
                VStack(alignment: .leading, spacing: 4) {
                    Text(currentReviewDueEnvelope?.event == nil ? "研究状态待核验" : "研究事件待核验")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(OwnerExperienceStyle.warning)
                    Text(reviewRingStatus)
                        .font(.system(size: 12.5))
                        .foregroundStyle(OwnerExperienceStyle.warning.opacity(0.82))
                        .lineSpacing(2)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(OwnerExperienceStyle.warning.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(OwnerExperienceStyle.warning.opacity(0.25), lineWidth: 1)
            }
            .padding(.horizontal, 14)
            .padding(.top, 10)

            VStack(alignment: .leading, spacing: 3) {
                Text("当前状态")
                    .font(.system(size: 11.5))
                    .foregroundStyle(OwnerExperienceStyle.textSecondary)
                Text("\(reviewRingStatus)。下一步由你核验并明确提交，系统不自动改变正式判断。")
                    .font(.system(size: 12.5))
                    .foregroundStyle(OwnerExperienceStyle.textPrimary)
                    .lineSpacing(2)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(OwnerExperienceStyle.softBackground, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .padding(.horizontal, 14)
            .padding(.top, 10)

            Button {
                openResearch(currentCanonicalSymbol ?? symbolInput)
            } label: {
                Text("开启研究  ·  核验证据  →")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(OwnerExperienceStyle.gold, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(currentCanonicalSymbol == nil)
            .padding(.horizontal, 14)
            .padding(.vertical, 14)
        }
        .background(
            LinearGradient(colors: [OwnerExperienceStyle.cardBackground, OwnerExperienceStyle.softBackground], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(OwnerExperienceStyle.gold.opacity(0.28), lineWidth: 1)
        }
        .shadow(color: OwnerExperienceStyle.gold.opacity(0.06), radius: 18)
        .padding(.horizontal, 16)
    }

    private var makeV9TodayChanges: some View {
        VStack(spacing: 0) {
            makeV9ChangeRow(symbol: currentCanonicalSymbol ?? "未选择", title: "研究状态与证据", detail: evidenceRingStatus, time: "当前", tone: .warning)
            Divider().overlay(OwnerExperienceStyle.subtleBorder)
            makeV9ChangeRow(symbol: currentCanonicalSymbol ?? "未选择", title: "跟踪与复盘", detail: reviewRingStatus, time: "当前", tone: .info)
        }
        .background(OwnerExperienceStyle.cardBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(OwnerExperienceStyle.border, lineWidth: 1) }
        .padding(.horizontal, 16)
    }

    private func makeV9ChangeRow(symbol: String, title: String, detail: String, time: String, tone: FigmaWorkspaceTone) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(symbol)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(OwnerExperienceStyle.gold)
                    Text(title)
                        .font(.system(size: 11))
                        .foregroundStyle(OwnerExperienceStyle.textSecondary)
                    OwnerStatusPill(text: tone == .warning ? "待核验" : "状态", tint: tone.color)
                }
                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(OwnerExperienceStyle.textPrimary)
            }
            Spacer(minLength: 8)
            Text(time)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(OwnerExperienceStyle.textTertiary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private var makeV9MarketPulse: some View {
        HStack(spacing: 8) {
            makeV9PulseCell("行情", value: boundQuoteData(symbol: currentCanonicalSymbol ?? "").map { String(format: "%.2f", $0.price) } ?? "未读取", change: selectedQuoteStatus.label, tone: selectedQuoteStatus.tint)
            makeV9PulseCell("研究", value: currentCanonicalSymbol ?? "未选择", change: currentProgressLayer.title, tone: OwnerExperienceStyle.gold)
            makeV9PulseCell("来源", value: "API", change: "只读状态", tone: OwnerExperienceStyle.accent)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
    }

    private func makeV9PulseCell(_ label: String, value: String, change: String, tone: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(OwnerExperienceStyle.textTertiary)
            Text(value)
                .font(.system(size: 14, weight: .medium, design: .monospaced))
                .foregroundStyle(OwnerExperienceStyle.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(change)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(tone)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            makeV9QuoteSourceBadge
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .background(OwnerExperienceStyle.softBackground, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(OwnerExperienceStyle.border, lineWidth: 1) }
    }

    @ViewBuilder
    private var makeV9QuoteSourceBadge: some View {
        if let quote = quoteEnvelope {
            let provider = switch quote.source.provider {
            case .futu: "Futu"
            case .fixture: "样本"
            case .cache: "缓存"
            case .unavailable: "行情"
            }
            let freshness = switch quote.status {
            case .live: "当前"
            case .stale: "陈旧"
            case .unavailable: "不可用"
            }
            MakeV9SourceBadge(
                label: "\(provider) · \(freshness)",
                tint: quote.status == .live ? OwnerExperienceStyle.success : OwnerExperienceStyle.warning
            )
        } else {
            MakeV9SourceBadge(label: "行情未读取", tint: OwnerExperienceStyle.warning)
        }
    }

    /// Figma Today 顶部 72pt：标题与只读标识同一行；搜索、连接和助手仍保留在其他页面的全局工具栏。
    private var todayHeader: some View {
        HStack(alignment: .center, spacing: 12) {
            Text("今日")
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
                .accessibilityIdentifier("todayAdvisoryPill")
        }
        .frame(height: 72)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("今日，只读 / Advisory Only")
    }

    /// Figma 首屏第三条卡：当前层级 + 五个 32pt 步骤点，只读、不导航、不声称研究结论。
    private var todayResearchProgressCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("研究进度")
                    .font(.headline)
                    .foregroundStyle(OwnerExperienceStyle.textPrimary)
                Spacer(minLength: 8)
                Text("当前层级：\(currentProgressLayer.title)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(OwnerExperienceStyle.accent)
                    .accessibilityIdentifier("todayProgressCurrentLayer")
            }
            HStack(alignment: .top, spacing: 8) {
                ForEach(DailyDecisionRingLayer.allCases) { layer in
                    VStack(spacing: 6) {
                        Text("\(layerIndex(layer))")
                            .font(.caption.weight(.bold).monospacedDigit())
                            .foregroundStyle(layer == currentProgressLayer ? Color(.systemBackground) : OwnerExperienceStyle.textSecondary)
                            .frame(width: 32, height: 32)
                            .background(
                                layer == currentProgressLayer ? OwnerExperienceStyle.accent : OwnerExperienceStyle.softBackground,
                                in: Circle()
                            )
                        Text(layer.title)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(OwnerExperienceStyle.textPrimary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(layer.title)：\(progressStepStatus(layer))")
                    .accessibilityIdentifier("todayProgressStep-\(layer.rawValue)")
                }
            }
        }
        .cardStyle()
        .accessibilityIdentifier("todayResearchProgressCard")
    }

    private func layerIndex(_ layer: DailyDecisionRingLayer) -> Int {
        (DailyDecisionRingLayer.allCases.firstIndex(of: layer) ?? 0) + 1
    }

    private func progressStepStatus(_ layer: DailyDecisionRingLayer) -> String {
        ringStatusByLayer[layer] ?? "待查看"
    }

    /// 只用已有事实推断当前层级：会话草稿在决定层、待确认正式决定在决定层、跟踪复盘在复盘层，其余下一步是证据层。
    private var currentProgressLayer: DailyDecisionRingLayer {
        if currentDraft != nil { return .decision }
        guard let event = currentReviewDueEnvelope?.event else { return .evidence }
        return event.type == "FORMAL_DECISION_DUE" ? .decision : .review
    }

    private var ringStatusByLayer: [DailyDecisionRingLayer: String] {
        [
            .candidate: SecuritySymbol.parseHongKongAlias(symbolInput) == nil ? "尚未选择" : "已选择本地候选",
            .evidence: evidenceRingStatus,
            .portfolio: "资产页可查看组合风险",
            .decision: decisionRingStatus,
            .review: reviewRingStatus
        ]
    }

    /// 完整只读五环诊断：保留在“研究进度与已完成记录”展开项里，只展示状态，不承担导航。
    private var todayResearchRingsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text("研究状态 · 只读")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(OwnerExperienceStyle.textPrimary)
                Spacer()
                Text("不导航")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(OwnerExperienceStyle.textSecondary)
            }
            StatusRingsOverview(
                canonicalSymbol: currentCanonicalSymbol ?? "未选择",
                statusByLayer: ringStatusByLayer,
                layout: .init(availableWidth: 320, accessibilityText: false)
            )
            .frame(maxWidth: .infinity)
            Text("五环只反映当前状态，切换研究层级请到研究页的层级选择器。")
                .font(.caption2)
                .foregroundStyle(OwnerExperienceStyle.textSecondary)
        }
        .cardStyle(padding: 10)
        .accessibilityIdentifier("todayStatusRingsOverview")
    }

    /// Figma 首屏第一条卡：真实身份（70pt 数字字标）、真实行情与三枚紧凑状态胶囊；未读取到的行情不会被写成成功。
    @ViewBuilder
    private var todaySelectedStockCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let symbol = currentCanonicalSymbol {
                HStack(alignment: .center, spacing: 12) {
                    StockMonogram(text: selectedStockMonogram(symbol: symbol), size: 70)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 8) {
                            Text(boundQuoteData(symbol: symbol)?.name ?? "名称待补齐")
                                .font(.headline.weight(.bold))
                            Text(symbol)
                                .font(.headline.monospaced())
                        }
                        .accessibilityLabel("当前研究标的 \(symbol) · 今日主行动按当前标的判断，不以候选数量为门槛")
                        .accessibilityIdentifier("todaySelectedResearchContext")
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            if let quote = boundQuoteData(symbol: symbol) {
                                Text("\(quote.price, specifier: "%.2f")")
                                    .font(.system(size: 27, weight: .bold).monospacedDigit())
                                Text(quote.changePercent.map { String(format: "%+.2f%%", $0) } ?? "涨跌待补齐")
                                    .font(.caption.weight(.semibold).monospacedDigit())
                                    .foregroundStyle(quoteChangeTint(quote.change))
                                    .accessibilityIdentifier("todaySelectedQuoteChange")
                            } else {
                                Text("价格待补齐")
                                    .font(.title3.weight(.bold))
                            }
                        }
                    }
                }
                HStack(spacing: 6) {
                    OwnerStatusPill(text: selectedQuoteStatus.label, tint: selectedQuoteStatus.tint)
                    OwnerStatusPill(text: "只读观察", tint: Color.secondary)
                    if let instant = boundQuoteInstantLabel(symbol: symbol) {
                        OwnerStatusPill(text: instant, tint: Color.secondary)
                    }
                    Spacer(minLength: 8)
                    if !AppEnvironment.isExperienceSession {
                        Button { openMarket(symbol) } label: {
                            Label("查看市场与技术图表", systemImage: "chart.xyaxis.line")
                                .labelStyle(.iconOnly)
                                .font(.callout.weight(.semibold))
                                .foregroundStyle(OwnerExperienceStyle.accent)
                                .frame(minWidth: 44, minHeight: 44)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("查看市场与技术图表")
                        .accessibilityIdentifier("todaySelectedStockOpenMarket")
                    }
                }
                .accessibilityIdentifier("todaySelectedQuoteStatusPills")
                .accessibilityElement(children: .contain)
                if boundQuoteData(symbol: symbol) == nil {
                    let explanation = quoteReadIssue
                        ?? (quoteEnvelope?.requestedSymbol == symbol ? quoteEnvelope?.message : nil)
                        ?? "尚未读取到这只股票的真实行情；不展示猜测价格。"
                    HStack(alignment: .top, spacing: 8) {
                        Text(explanation)
                            .font(.caption)
                            .foregroundStyle(OwnerExperienceStyle.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("todaySelectedQuoteIssue")
                        Spacer(minLength: 4)
                        Button {
                            Task { await loadTodayQuote() }
                        } label: {
                            Label("读取当前行情", systemImage: "arrow.clockwise")
                                .font(.caption.weight(.semibold))
                                .frame(minHeight: 44)
                        }
                        .buttonStyle(.borderless)
                        .disabled(isQuoteLoading)
                        .accessibilityIdentifier("todaySelectedQuoteRetry")
                    }
                }
            } else {
                HStack(alignment: .center, spacing: 12) {
                    StockMonogram(text: "HK", size: 70)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("尚未选择港股")
                            .font(.headline)
                        Text("先到市场选择一只港股，今日主行动才会按这只股票判断。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Button { openMarket(nil) } label: {
                    Label("去市场选择", systemImage: "magnifyingglass")
                        .frame(maxWidth: .infinity, minHeight: 40)
                }
                .buttonStyle(OwnerPrimaryActionButtonStyle())
                .accessibilityIdentifier("todaySelectedStockChooseMarket")
            }
        }
        .cardStyle(padding: 14)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("todaySelectedQuoteStrip")
    }

    private func boundQuoteData(symbol: String) -> MarketQuoteData? {
        guard let envelope = quoteEnvelope,
              envelope.requestedSymbol == symbol,
              envelope.data?.symbol == symbol else { return nil }
        return envelope.data
    }

    /// 只有绑定到当前股票的真实行情才声称“保留上次有效结果”；没有数据时明确说行情暂不可用。
    private var selectedQuoteStatus: (label: String, tint: Color) {
        guard let symbol = currentCanonicalSymbol else { return ("尚未选择港股", Color.secondary) }
        if isQuoteLoading, boundQuoteData(symbol: symbol) == nil { return ("读取中", Color.secondary) }
        if let envelope = quoteEnvelope, envelope.requestedSymbol == symbol, boundQuoteData(symbol: symbol) != nil {
            let presentation = marketQuotePresentation(envelope, isRetained: quoteReadIssue != nil)
            let tint: Color = switch presentation.tone {
            case .live: OwnerExperienceStyle.success
            case .caution: OwnerExperienceStyle.warning
            case .unavailable: Color.secondary
            }
            return (presentation.label, tint)
        }
        if quoteReadIssue != nil || quoteEnvelope?.requestedSymbol == symbol || quoteEnvelope?.status == .unavailable {
            return ("行情暂不可用", OwnerExperienceStyle.warning)
        }
        return ("行情未读取", OwnerExperienceStyle.warning)
    }

    /// 数字字标：用代码去掉前导零（175、700），不使用名称首字或占位 0。
    private func selectedStockMonogram(symbol: String) -> String {
        let digits = symbol.filter(\.isNumber)
        let trimmed = String(digits.drop { $0 == "0" })
        return trimmed.isEmpty ? (digits.isEmpty ? "HK" : digits) : trimmed
    }

    private func quoteChangeTint(_ change: Double?) -> Color {
        guard let change else { return Color.secondary }
        return change >= 0 ? Color.red : Color.green
    }

    /// 第三枚状态胶囊只显示行情时点的日期部分，避免把 UTC 时刻误读成本地精确时间。
    private func boundQuoteInstantLabel(symbol: String) -> String? {
        guard boundQuoteData(symbol: symbol) != nil else { return nil }
        let instant = quoteEnvelope?.asOf ?? quoteEnvelope?.data?.quoteTime
        guard let instant, instant.count >= 10 else { return "时点未记录" }
        return "行情时点 \(instant.prefix(10))"
    }

    private var todayMarketSummaryCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            if isQuoteLoading, quoteEnvelope == nil {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("正在读取当前行情…")
                        .foregroundStyle(.secondary)
                }
                .cardStyle()
            } else {
                MarketQuoteView(
                    envelope: quoteEnvelope ?? .unavailable(
                        "尚未读取当前行情。",
                        requestedSymbol: currentCanonicalSymbol ?? "UNSELECTED"
                    ),
                    isRetained: quoteReadIssue != nil
                )
            }
            if let quoteReadIssue {
                VStack(alignment: .leading, spacing: 6) {
                    Label(quoteReadIssue, systemImage: "clock.arrow.circlepath")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier("todayMarketQuoteReadIssue")
                    Button {
                        Task { await loadTodayQuote() }
                    } label: {
                        Label("重新读取当前行情", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .disabled(isQuoteLoading || currentCanonicalSymbol == nil)
                    .accessibilityIdentifier("todayMarketQuoteRetry")
                }
            } else if quoteEnvelope?.data == nil, currentCanonicalSymbol != nil {
                Button {
                    Task { await loadTodayQuote() }
                } label: {
                    Label("重新读取当前行情", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .disabled(isQuoteLoading)
                .accessibilityIdentifier("todayMarketQuoteRetry")
            }
            Button { openMarket(currentCanonicalSymbol) } label: {
                Label("查看市场", systemImage: "arrow.right")
                    .frame(maxWidth: .infinity, minHeight: 40)
            }
            .buttonStyle(.bordered)
        }
        .accessibilityIdentifier("todayMarketSummary")
    }

    @MainActor
    private func loadTodayQuote() async {
        let requestId = UUID()
        quoteRequestId = requestId
        guard let symbol = SecuritySymbol.parseHongKongAlias(symbolInput) else {
            quoteEnvelope = nil
            return
        }
        let expected = symbol.canonical
        isQuoteLoading = true
        let auth = AppEnvironment.researchAuthorizationContext()
        defer { if quoteRequestId == requestId { isQuoteLoading = false } }
        let client = MarketQuoteClient(
            baseURL: auth.baseURL,
            authToken: auth.readToken,
            authHeaderName: auth.readHeaderName
        )
        do {
            let envelope = try await client.fetchQuote(market: symbol.market, code: symbol.code)
            guard quoteRequestId == requestId,
                  currentCanonicalSymbol == expected,
                  AppEnvironment.researchAuthorizationContext() == auth else { return }
            if envelope.isUsableQuote {
                quoteReadIssue = nil
                quoteEnvelope = envelope
            } else if boundQuoteData(symbol: expected) != nil {
                quoteReadIssue = "刷新失败；保留同股上次有效结果。\(envelope.message)"
            } else {
                quoteReadIssue = nil
                quoteEnvelope = envelope
            }
        } catch {
            guard quoteRequestId == requestId,
                  currentCanonicalSymbol == expected,
                  AppEnvironment.researchAuthorizationContext() == auth else { return }
            if boundQuoteData(symbol: expected) != nil {
                quoteReadIssue = "刷新失败；保留同股上次有效结果，以上时效与来源标签仍然有效。"
            } else {
                quoteReadIssue = nil
                quoteEnvelope = .unavailable("行情读取失败：\(error.localizedDescription)", requestedSymbol: expected)
            }
        }
    }
    private var decisionRingStatus: String {
        if currentDraft != nil { return "会话内草稿待跟进" }
        guard let envelope = currentReviewDueEnvelope, let event = envelope.event else { return "尚未形成正式决定" }
        if event.type == "FORMAL_DECISION_DUE" { return "确认报告待正式决定" }
        if event.dailyTrackingReconsiderationOutcome != nil { return "正式决定待重新审视" }
        if event.type == "DAILY_TRACKING" { return "报告绑定正式决定已记录" }
        return event.state == .new ? "正式决定已记录" : "正式决定已复盘"
    }
    private var evidenceRingStatus: String {
        guard let event = currentReviewDueEnvelope?.event else {
            return isReviewDueLoading ? "正在读取" : "进入研究查看"
        }
        return event.reportBinding != nil || event.researchReport?.binding != nil
            ? "报告与证据已记录"
            : "进入研究查看"
    }
    private var reviewRingStatus: String {
        guard let event = currentReviewDueEnvelope?.event else { return "尚未进入复盘" }
        if event.type == "FORMAL_DECISION_DUE" { return "尚未进入正式复盘" }
        if event.type == "DAILY_TRACKING" {
            if event.dailyTrackingReconsiderationOutcome != nil { return "每日跟踪提示重新审视" }
            return event.state == .new ? "每日跟踪 / 下一验证" : "每日跟踪已复盘"
        }
        return event.state == .new ? "正式复盘待跟进" : "正式复盘已完成"
    }
    private var currentReviewDueEnvelope: TodayReviewDueEnvelope? {
        guard let symbol = currentCanonicalSymbol,
              reviewDueEnvelope?.requestedSymbol == symbol else {
            return nil
        }
        return reviewDueEnvelope
    }
    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("当前候选")
                .font(.headline)
            Text(SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical ?? "尚未选择")
                .font(.title3.monospaced())
                .accessibilityIdentifier("todayCurrentCandidate")
            Text("当前动作以上方行动收件箱的实时结果为准")
                .font(.callout.weight(.semibold))
                .foregroundStyle(.orange)
                .accessibilityIdentifier("todayGlobalStatus")
            Text("今日待办会汇总这只股票的材料变化、研究报告、正式决定与复盘；资产和交易记录不会被混入研究事实。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .cardStyle()
    }
    @ViewBuilder
    private var reviewDueCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("每日跟踪与正式复盘")
                .font(.headline)
            if currentCanonicalSymbol == nil {
                Text("尚未选择港股")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("todayReviewDueNoSymbol")
            } else if isReviewDueLoading {
                ProgressView("正在读取跟踪与复盘；不会显示旧标的记录")
                    .accessibilityIdentifier("todayReviewDueLoading")
            } else if let envelope = currentReviewDueEnvelope {
                reviewDueEnvelopeContent(envelope)
            } else {
                Text("正式事件暂不可用")
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("todayReviewDueStatus")
            }
            if currentCanonicalSymbol != nil, !isReviewDueLoading {
                Button("重新读取") {
                    Task { await loadReviewDue() }
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("todayReviewDueRetry")
            }
        }
        .cardStyle()
        .accessibilityElement(children: .contain)
        .accessibilityValue(reviewDueAccessibilityValue)
        .accessibilityIdentifier("todayReviewDueCard")
    }
    private var reviewDueAccessibilityValue: String {
        guard currentCanonicalSymbol != nil else { return "尚未选择港股" }
        if isReviewDueLoading { return "正在读取跟踪与复盘；不会显示旧标的记录" }
        guard let envelope = currentReviewDueEnvelope else { return "正式事件暂不可用" }
        var values = [
            TodayMaterialChangePresentation.reviewDueStatusText(envelope),
            envelope.requestedSymbol,
            "来源 \(envelope.metadata.source)",
            "截止 \(envelope.metadata.asOf ?? "未记录")",
            "读取 \(envelope.metadata.fetchedAt ?? "未记录")",
            "不是建议、订单、交易或资产动作"
        ]
        if envelope.metadata.fixture {
            values.append("测试样本 / 非真实事件")
        }
        if let event = envelope.event {
            values.append("截止 \(event.priority.dueAt)")
            if let humanDecision = event.humanDecision {
                values.append("人工决定 \(humanDecision.actionIntent) \(humanDecision.humanCheckResult)")
            }
            if let researchReport = event.researchReport {
                values.append("决策时点报告 \(researchReport.availability)")
            }
        }
        return values.joined(separator: " · ")
    }
    @MainActor
    func openExactReview(_ event: TodayReviewDueEvent) async {
        guard !isOpeningReview else { return }
        isOpeningReview = true
        defer { isOpeningReview = false }
        let inbox = await todayActionInboxClient.fetchTodayActionInbox()
        guard currentCanonicalSymbol == event.subject,
              currentReviewDueEnvelope?.event?.id == event.id else { return }
        let matches = inbox.items.filter { $0.symbol == event.subject && $0.reviewEvent?.id == event.id }
        guard matches.count == 1,
              let item = matches.first,
              let target = TodayReviewNavigationTarget(
                event: event,
                membershipId: item.membership.id,
                membershipVersion: item.membership.version
              ) else {
            openResearch(event.subject)
            return
        }
        openResearchReview(target)
    }
    @MainActor
    private func loadReviewDue() async {
        guard let symbol = currentCanonicalSymbol else {
            reviewDueLoadGate.invalidate()
            isReviewDueLoading = false
            reviewDueEnvelope = nil
            return
        }
        let ticket = reviewDueLoadGate.begin(symbol: symbol)
        isReviewDueLoading = true
        reviewDueEnvelope = nil
        let loaded = await reviewDueClient.fetch(symbol: symbol)
        guard reviewDueLoadGate.accepts(
            ticket,
            currentSymbol: currentCanonicalSymbol,
            isCancelled: Task.isCancelled
        ) else { return }
        reviewDueEnvelope = loaded
        isReviewDueLoading = false
    }
    private var draftCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("跟进")
                .font(.headline)
            Text("决定草稿从资产或研究工作区形成后回到这里；它仅存在于本次 App 会话，重启不恢复。Today 不伪造正式决定聚合。")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let localDraft {
                if currentDraft == nil {
                    Text("待跟进 · 其他标的的会话草稿")
                        .font(.callout.weight(.semibold))
                        .accessibilityIdentifier("todayLocalDraftFollowUp")
                    Text("已隐藏其他标的草稿正文；切回对应股票后再继续。")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier("todayOtherSymbolDraftBoundary")
                } else {
                    Text("待跟进 · \(localDraft.symbol)")
                        .font(.callout.weight(.semibold))
                        .accessibilityIdentifier("todayLocalDraftFollowUp")
                    Text("逻辑：\(localDraft.thesis)")
                    Text("时间范围：\(localDraft.timeHorizon)")
                    Text("条件：\(localDraft.conditions)")
                    Text("行动计划（不执行）：\(localDraft.actionPlan)")
                    Text("风险：\(localDraft.risks)")
                    Text("失效条件：\(localDraft.invalidation)")
                    Text("\(localDraft.authority) · 仅本次会话 · \(localDraft.executionStatus) · 未上传")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("todayLocalDraftBoundary")
                    Text("没有订单；未上传；没有正式动作；没有账户或资产事实变化。")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier("todayLocalDraftNoEffects")
                    Button {
                        openResearchDecision(localDraft.symbol)
                    } label: {
                        Label("进入研究决定层修正", systemImage: "square.and.pencil")
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("todayLocalDraftOpenDecision")
                }
            } else {
                Text("暂无待跟进的会话草稿")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("todayNoFollowUp")
            }
        }
        .cardStyle()
    }
}
