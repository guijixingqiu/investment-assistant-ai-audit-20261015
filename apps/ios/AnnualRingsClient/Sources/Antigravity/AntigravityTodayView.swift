import SwiftUI

struct AntigravityTodayView: View {
    @ObservedObject var api = OwnerClientStore.shared
    @Environment(\.antigravityActions) private var actions
    var onNavigateToResearch: ((Int, Int) -> Void)? = nil
    let onOpenInboxItem: (TodayActionInboxItem) -> Bool
    @Binding var selectedStock: InvestmentDecisionDossier?
    @Binding var showSearch: Bool
    @Binding var showAIAssistant: Bool
    
    @State private var showConnectionDetails: Bool = false
    @State private var showTaskList = false
    @State private var openingItemId: String?
    @State private var navigationIssue: String?
    @State private var anomalySelection: MarketAnomalySelection?
    @State private var investigationSelection: PersonalInvestigationSelection?
    @State private var currentInvestigation: InvestigationTurn?
    
    init(
        onNavigateToResearch: ((Int, Int) -> Void)? = nil,
        onOpenInboxItem: @escaping (TodayActionInboxItem) -> Bool,
        selectedStock: Binding<InvestmentDecisionDossier?> = .constant(nil),
        showSearch: Binding<Bool>,
        showAIAssistant: Binding<Bool>
    ) {
        self.onNavigateToResearch = onNavigateToResearch
        self.onOpenInboxItem = onOpenInboxItem
        self._selectedStock = selectedStock
        self._showSearch = showSearch
        self._showAIAssistant = showAIAssistant
    }
    
    private var visibleItems: [TodayActionInboxItem] {
        guard api.issues["inbox"] == nil, api.inbox?.status == .available || api.inbox?.status == .empty else { return [] }
        return api.todayPendingInboxItems
    }
    private var laterItems: [TodayActionInboxItem] {
        guard api.issues["inbox"] == nil, api.inbox?.status == .available else { return [] }
        return TodayMaterialChangePresentation.nextFirst((api.inbox?.items ?? []).filter { $0.state == .later })
    }
    private var sourceFailures: [TodayActionInboxItem] {
        guard api.issues["inbox"] == nil, api.inbox?.status == .available else { return [] }
        return (api.inbox?.items ?? []).filter { $0.kind == .sourceFailure && $0.state == .blocked }
    }
    private var featuredFailure: TodayActionInboxItem? {
        sourceFailures.first(where: { $0.id.hasSuffix(":benchmark") }) ?? sourceFailures.first
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(Date().formatted(.dateTime.month(.wide).day().weekday(.wide).locale(Locale(identifier: "zh_CN"))))
                    .font(.footnote).foregroundStyle(Theme.textSecondary)
                if let item = visibleItems.first {
                    Text("值得留意").font(.headline).foregroundStyle(Theme.gold)
                    VStack(alignment: .leading, spacing: 16) {
                        Text(api.candidates.first(where: { $0.symbol == item.symbol })?.name ?? item.symbol).font(.subheadline).foregroundStyle(Theme.textSecondary)
                        Text(item.title == "Freeze the current evidence version" ? "研究依据有更新" : TodayMaterialChangePresentation.localizedResearchTitle(item.title)).font(.title2.bold())
                        Text(item.title == "Freeze the current evidence version" ? "资料或行情已更新。查看变化后，再确认是否更新这项研究的依据。" : todaySummary(for: item)).font(.body).foregroundStyle(Theme.textSecondary)
                        WorkspacePrimaryButton(title: openingItemId == item.id ? "正在核对目标…" : todayOpenLabel(item)) { openItem(item) }
                            .disabled(openingItemId != nil)
                    }
                } else if api.loading && api.inbox == nil { ProgressView("正在读取今天的事项…") }
                else if let failure = featuredFailure {
                    Text("来源待核验").font(.title2.bold())
                    Text("\(failure.symbol)：\(failure.title)").font(.subheadline.bold())
                    Text(failure.summary).font(.body).foregroundStyle(Theme.textSecondary)
                    if sourceFailures.count > 1 {
                        Text("另有 \(sourceFailures.count - 1) 项来源暂不可用；已有研究仍可查看。")
                            .font(.caption).foregroundStyle(Theme.textSecondary)
                    }
                    Button("查看全部来源与历史") { actions.workflow(.inbox) }.font(.footnote)
                    if failure.id.hasSuffix(":benchmark") {
                        Button("去 Market 核对并刷新行情") { openMarketForGap(failure) }.font(.footnote)
                    }
                    WorkspacePrimaryButton(title: "重新读取今天的事项") { Task { await api.load(tab: .today, symbol: api.currentSymbol) } }
                }
                else if api.issues["inbox"] == nil && (api.inbox?.status == .available || api.inbox?.status == .empty) && !laterItems.isEmpty {
                    Text("还有稍后处理的研究事项").font(.title2.bold())
                    Text("当前没有新的优先事项；稍后处理的目标可在完整待办中逐项打开。")
                        .font(.body).foregroundStyle(Theme.textSecondary)
                }
                else if api.issues["inbox"] == nil && (api.inbox?.status == .available || api.inbox?.status == .empty) {
                    Text("今天可以接着研究").font(.title2.bold())
                    Text("当前已读取范围内，没有新的事项。可以继续阅读资料，也可以了解另一家公司。")
                        .font(.body).foregroundStyle(Theme.textSecondary)
                    WorkspacePrimaryButton(title: "查看公司研究") { actions.workflow(.templateHome) }
                } else {
                    Text("今天的事项暂未取得").font(.title2.bold())
                    Text("请检查连接或读取授权，已有研究仍可从研究页进入。")
                        .font(.body).foregroundStyle(Theme.textSecondary)
                    WorkspacePrimaryButton(title: "重新读取") { Task { await api.load(tab: .today, symbol: api.currentSymbol) } }
                }
                if !sourceFailures.isEmpty, !visibleItems.isEmpty {
                    DisclosureGroup("另有 \(sourceFailures.count) 项来源待重读") {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(Array(sourceFailures.prefix(3))) { failure in
                                Text("\(failure.symbol)：\(failure.summary)")
                                    .font(.caption).foregroundStyle(Theme.textSecondary)
                                if failure.id.hasSuffix(":benchmark") {
                                    Button("去 Market 核对并刷新行情") { openMarketForGap(failure) }.font(.footnote)
                                }
                            }
                            if sourceFailures.count > 3 { Text("其余来源状态可在完整待办中查看。")
                                .font(.caption).foregroundStyle(Theme.textSecondary) }
                            Button("查看完整待办与来源") { actions.workflow(.inbox) }.font(.footnote)
                            Button("重新读取") { Task { await api.load(tab: .today, symbol: api.currentSymbol) } }
                                .font(.footnote)
                        }
                    }
                }
                if let navigationIssue {
                    Text(navigationIssue).font(.footnote).foregroundStyle(Theme.amber)
                        .accessibilityIdentifier("todayNavigationIssue")
                }
                Divider()
                if let member = api.membershipEnvelope?.memberships.first(where: { $0.symbol == api.currentSymbol && $0.state.rawValue == "tracked" }) {
                    PersonalResearchBriefSection(membership: member, presentation: .continueReading)
                        .id("\(member.id):\(member.version)")
                } else {
                    Text("从一家感兴趣的公司开始").font(.headline)
                    Button { showSearch = true } label: { WorkspaceRowLabel(title: "搜索公司", subtitle: "按港股名称或代码查找", icon: "magnifyingglass") }.buttonStyle(.plain)
                }
                if SecuritySymbol.parseHongKongAlias(api.currentSymbol) != nil {
                    OwnerManualJudgmentSummary(symbol: api.currentSymbol)
                    OwnerResearchProgressOverview(symbol: api.currentSymbol)
                    WeinsteinDecisionSummaryView(
                        envelope: api.weinstein?.symbol == api.currentSymbol ? api.weinstein : nil,
                        label: "当前周线观察 · 正式冻结变化另见待办"
                    ).accessibilityIdentifier("todayWeinsteinDecisionSummary")
                    NavigationLink("查看个股周K、30周均线与区域") {
                        CompanyTechnicalView(symbol: api.currentSymbol)
                    }
                }
                Divider()
                HStack {
                    Text("跟踪事项").font(.headline)
                    Spacer()
                    Button("查看全部待办与历史") { actions.workflow(.inbox) }
                        .font(.footnote).frame(minHeight: 44)
                }
                ForEach(Array(visibleItems.dropFirst().prefix(2))) { item in
                    Button { openItem(item) } label: {
                        WorkspaceRowLabel(title: item.title == "Freeze the current evidence version" ? "研究依据有更新" : TodayMaterialChangePresentation.localizedResearchTitle(item.title), subtitle: "\(item.symbol) · \(item.state == .later ? "稍后处理" : TodayMaterialChangePresentation.stageLabel(for: item))", icon: "clock")
                    }.buttonStyle(.plain).disabled(openingItemId != nil)
                }
                if let generated = api.inbox?.generatedAt {
                    Text("事项截至 \(WorkspaceTimestamp.hongKong(generated)) · 仅当前已读取的研究范围")
                        .font(.caption).foregroundStyle(Theme.textSecondary)
                }
            }.padding(.horizontal, 24).padding(.vertical, 12)
        }.background(Theme.bgPrimary.ignoresSafeArea())
            .navigationTitle("今日").navigationBarTitleDisplayMode(.large)
            .toolbar { WorkspaceTools() }
            .refreshable { await api.load(tab: .today, symbol: api.currentSymbol) }
            .sheet(item: $investigationSelection, onDismiss: { api.finishPersonalFormalDismissal() }) {
                PersonalInvestigationView(selection: $0)
            }
            .sheet(item: $anomalySelection, onDismiss: { api.finishPersonalFormalDismissal() }) {
                PersonalMarketAnomalyDetailView(selection: $0)
            }
    }
    private func todayOpenLabel(_ item: TodayActionInboxItem) -> String {
        switch item.kind {
        case .candidateFound: "查看候选研究"
        case .researchProfileReviewDue: "复核研究档案"
        case .researchCompleted: "查看对应报告"
        case .materialChange: "查看资料变化"
        case .marketAnomaly: "查看价格变化"
        case .formalDecisionDue: "查看正式决定"
        case .reviewDue, .dailyTracking: "查看对应复盘"
        case .research: item.researchTarget?.task == nil ? "查看这项研究" : "查看对应任务"
        case .sourceFailure: "核对来源状态"
        }
    }
    private func todaySummary(for item: TodayActionInboxItem) -> String {
        if item.title == "Add traceable research material" {
            return "当前研究缺少可追溯材料；个人调查即使读过原文，也不代表正式财务资料已覆盖。请进入研究页分别核对。"
        }
        return TodayMaterialChangePresentation.userSummary(for: item)
    }

    private func openMarketForGap(_ failure: TodayActionInboxItem) {
        api.selectSymbol(failure.symbol)
        actions.workflow(.market)
    }

    private func openItem(_ item: TodayActionInboxItem) {
        guard openingItemId == nil else { return }
        openingItemId = item.id
        navigationIssue = nil
        Task {
            let fresh = await api.currentTodayItemForNavigation(item)
            guard openingItemId == item.id else { return }
            openingItemId = nil
            guard let fresh else {
                navigationIssue = "这项 Today 目标、来源或当前授权未能核对为同一版本；未打开旧目标。请重新读取 Today 后再打开。"
                return
            }
            if fresh.kind == .marketAnomaly { openInvestigation(fresh, start: false); return }
            if !onOpenInboxItem(fresh) {
                navigationIssue = "本项缺少可核对的具体研究目标；未跳到其他公司或通用页面。请重新读取 Today。"
            }
        }
    }

    private func startHereSection(_ proxy: ScrollViewProxy) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("从这里开始").font(.title3.bold())
            Text("查看今天的变化，或开始研究一家公司。")
                .font(.subheadline).foregroundStyle(Theme.textSecondary)
            ClientRow(title: "研究一家公司", subtitle: "选择自选股，查看资料、盈利与估值", icon: "doc.text.magnifyingglass") {
                actions.workflow(.templateHome)
            }
            ClientRow(title: "查找股票", subtitle: "按名称或代码寻找研究对象", icon: "magnifyingglass") { showSearch = true }
            ClientRow(title: "查看待办", subtitle: "需要核对的资料、变化与复核事项", icon: "checklist") {
                showTaskList = true
                withAnimation { proxy.scrollTo("todayTaskList", anchor: .top) }
            }
        }.padding(14).templateCardStyle().accessibilityIdentifier("todayStartHere")
    }
    private var researchEvents: [TodayActionInboxItem] {
        api.todayPendingInboxItems.filter { $0.kind == .marketAnomaly || $0.kind == .materialChange }
    }
    private var researchEventsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("今天最值得关注").font(.headline)
            if let item = researchEvents.first {
                eventCard(item)
                if researchEvents.count > 1 {
                    DisclosureGroup("其他研究变化") {
                        ForEach(Array(researchEvents.dropFirst())) { eventCard($0) }
                    }.font(.caption)
                }
            } else {
                Text(api.inbox == nil ? (api.loading ? "正在核对今天的行情与资料变化…" : "今日事项暂未取得，可以先查看已有研究。") : (api.inbox?.status == .available || api.inbox?.status == .empty) ? "当前已读范围内，没有新的异常或重要资料变化。" : "今天的研究事项暂未读取成功，可先查看已有研究。")
                    .font(.subheadline).foregroundStyle(Theme.textSecondary)
                Button("阅读当前研究") { onNavigateToResearch?(api.selectedCandidateIndex, 0) }
            }
        }.accessibilityIdentifier("todayResearchResults")
    }
    private func eventCard(_ item: TodayActionInboxItem) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(item.title.replacingOccurrences(of: " · 待调查", with: "")).font(.title3.bold())
            Text(currentInvestigation?.membershipId == item.membership.id ? currentInvestigation!.analysis.whatHappened.first?.text ?? item.summary : item.summary.components(separatedBy: "。").prefix(1).joined(separator: "。"))
                .font(.subheadline)
            Text(currentInvestigation?.membershipId == item.membership.id ? "为什么重要：\(currentInvestigation!.analysis.researchJudgment?.importance.text ?? "请查看已读依据。")" : item.kind == .marketAnomaly ? "为什么重要：价格变化可能反映行业压力或公司新信息，两者对盈利判断的意义不同。" : "为什么重要：新资料可能改变对企业经营与盈利质量的理解。")
                .font(.caption).foregroundStyle(Theme.textSecondary)
            Text(currentInvestigation?.membershipId == item.membership.id ? "目前判断：\(currentInvestigation!.analysis.researchJudgment?.impact.text ?? "仍有证据需要核查。")" : item.kind == .marketAnomaly ? "当前状态：已核对触发行情；尚未确认公司特异性原因。继续读取原文并核对同行。" : "当前状态：资料已发现，需结合正文判断影响。")
                .font(.caption).foregroundStyle(Theme.gold)
            HStack {
                Button("查看调查") { openInvestigation(item, start: false) }.buttonStyle(.bordered)
                    .accessibilityIdentifier("todayViewInvestigation")
                Button("深入分析") { openInvestigation(item, start: true) }.buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("todayAnalyzeInvestigation")
            }
        }.padding(14).templateCardStyle()
    }
    private func refreshInvestigation() async {
        currentInvestigation = nil
        guard let item = researchEvents.first, item.kind == .marketAnomaly else { return }
        guard let eventDate = anomalyDate(item) else { return }
        let result = await InvestigationResultCache.read(id: item.membership.id, version: item.membership.version, symbol: item.symbol,
                                                       mode: "price_move", eventDate: eventDate)
        guard let current = researchEvents.first, current.membership.id == item.membership.id,
              current.membership.version == item.membership.version, current.symbol == item.symbol, anomalyDate(current) == eventDate else { return }
        currentInvestigation = result
    }
    private func openInvestigation(_ item: TodayActionInboxItem, start: Bool) {
        let eventDate = anomalyDate(item)
        if item.kind == .marketAnomaly && eventDate == nil {
            anomalySelection = MarketAnomalySelection(membershipId: item.membership.id, symbol: item.symbol, version: item.membership.version)
            return
        }
        investigationSelection = PersonalInvestigationSelection(membershipId: item.membership.id,
            membershipVersion: item.membership.version, symbol: item.symbol,
            mode: item.kind == .marketAnomaly ? "price_move" : "earnings_quality",
            question: item.kind == .marketAnomaly ? "\(eventDate!)为什么异常波动？请比较行业因素与公司特异因素，并核查该日原文。" : "新资料对盈利与现金流的判断有什么影响？",
            startAnalysis: start, eventDate: eventDate)
    }
    private func anomalyDate(_ item: TodayActionInboxItem) -> String? {
        guard item.kind == .marketAnomaly, let raw = item.source.effectiveAt else { return nil }
        let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) else { return nil }
        let formatter = DateFormatter(); formatter.timeZone = TimeZone(identifier: "Asia/Hong_Kong"); formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    // MARK: - Header & Connection Matrix
    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Button(action: {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            showConnectionDetails.toggle()
                        }
                    }) {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(api.isConnected ? Theme.green : Theme.amber)
                                .frame(width: 7, height: 7)
                            Text(api.isConnected ? "本地服务已连接" : "服务暂不可用")
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundColor(api.isConnected ? Theme.green : Theme.amber)
                            Image(systemName: showConnectionDetails ? "chevron.up" : "chevron.down")
                                .font(.system(size: 9))
                                .foregroundColor(Theme.textTertiary)
                        }
                    }
                    .buttonStyle(.plain)
                    
                    Text("今天先看什么")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(Theme.textPrimary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(Date().formatted(.dateTime.month(.wide).day().locale(Locale(identifier: "zh_CN"))))
                        .font(.system(size: 12))
                        .foregroundColor(Theme.textSecondary)
                    Text("低频 · 证据驱动")
                        .font(.system(size: 11))
                        .foregroundColor(Theme.textTertiary)
                }
            }
            .padding(.top, 4)
            
            if showConnectionDetails {
                VStack(alignment: .leading, spacing: 6) {
                    Divider().background(Theme.border)
                    connectionChannelRow(name: "API 网关服务", addr: AppEnvironment.researchAuthorizationContext().baseURL.absoluteString, state: api.isConnected ? "正常" : "离线", isOk: api.isConnected)
                    Button("连接设置与服务状态") { actions.connection() }.font(.system(size: 11))
                }
                .padding(10)
                .background(Theme.bgSecondary)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
    }
    
    private func connectionChannelRow(name: String, addr: String, state: String, isOk: Bool) -> some View {
        HStack {
            Circle().fill(isOk ? Theme.green : Theme.amber).frame(width: 5, height: 5)
            Text(name).font(.system(size: 11, weight: .semibold)).foregroundColor(Theme.textPrimary)
            Text("(\(addr))").font(.system(size: 10, design: .monospaced)).foregroundColor(Theme.textTertiary)
            Spacer()
            Text(state).font(.system(size: 10.5, weight: .medium)).foregroundColor(isOk ? Theme.green : Theme.amber)
        }
    }
    
    // MARK: - Market Pulse
    private var marketPulseSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("今日市场脉动")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                if let env = api.marketEnvironment {
                    if api.environment?.freshness() == .closedLastObservation {
                        Text("闭市 · 最近行情观察").font(.caption2).foregroundColor(Theme.textSecondary)
                    } else {
                        StatusBadgeView(.real(source: "Futu 港股行情", freshness: api.environment?.freshness() == .fresh ? .fresh : .stale, timestamp: env.asOf))
                    }
                } else {
                    StatusBadgeView(.unavailable(reason: api.loading ? "环境数据加载中" : "环境数据暂不可用"))
                }
            }
            
            if let env = api.marketEnvironment {
                VStack(spacing: 10) {
                    // Indices
                    HStack(spacing: 8) {
                        ForEach(env.indices.prefix(2)) { idx in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(idx.name)
                                    .font(.system(size: 12))
                                    .foregroundColor(Theme.textSecondary)
                                HStack {
                                    Text(String(format: "%.0f", idx.last))
                                        .font(.system(size: 16, weight: .bold, design: .monospaced))
                                        .foregroundColor(Theme.textPrimary)
                                    Spacer()
                                    Text(String(format: "%+.2f%%", idx.changePercent))
                                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                        .foregroundColor(idx.isPositive ? Theme.green : Theme.red)
                                }
                            }
                            .padding(10)
                            .background(Theme.bgSecondary)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }
                    
                    // Breadth & Flow
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("恒指成分股 (涨 / 跌)")
                                .font(.system(size: 11))
                                .foregroundColor(Theme.textTertiary)
                            Text("\(env.advancersCount) 上涨 / \(env.declinersCount) 下跌")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(Theme.red)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("当前标的资金流")
                                .font(.system(size: 11))
                                .foregroundColor(Theme.textTertiary)
                            Text(templateNumber(env.stockNetFlow.map { $0 / 10000 }, format: "%.2f 万 HKD"))
                                .font(.system(size: 12, weight: .bold, design: .monospaced))
                                .foregroundColor((env.stockNetFlow ?? 0) >= 0 ? Theme.green : Theme.red)
                        }
                    }
                    .padding(.horizontal, 4)
                }
                .padding(12)
                .templateCardStyle()
            } else {
                // Placeholder if still loading
                HStack {
                    if api.loading { ProgressView().tint(Theme.gold) }
                    Text(api.loading ? "正在读取 Futu/OpenD 市场环境…" : api.issues["environment"] ?? api.environment?.message ?? "环境数据暂不可用，请下拉刷新。")
                        .font(.system(size: 12))
                        .foregroundColor(Theme.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(16)
                .templateCardStyle()
            }
        }
    }
    
    // MARK: - Action Inbox (Next Best Action First)
    private var actionInboxSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("待核验事项")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Text(api.inbox.map { _ in "\(api.todayPendingInboxItems.count) 项新待办" } ?? "待办未读取")
                    .font(.system(size: 11))
                    .foregroundColor(Theme.gold)
            }
            
            // 1. Primary Action Card (Prominently Expanded)
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    HStack(spacing: 4) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 10))
                        Text("下一步 · 研究资料与复核")
                            .font(.system(size: 10.5, weight: .bold))
                    }
                    .foregroundColor(Theme.gold)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2.5)
                    .background(Theme.gold.opacity(0.15))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    
                    Spacer()
                    Text(api.todayInboxAction?.symbol ?? api.currentSymbol)
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundColor(Theme.textSecondary)
                }
                
                Text(api.todayInboxActionTitle)
                    .font(.system(size: 13.5, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                
                Text(api.todayInboxAction.map { TodayMaterialChangePresentation.userSummary(for: $0) }
                    ?? ((api.inbox?.status == .empty || api.inbox?.status == .available)
                        ? "当前读取成功，暂无待核验事项。" : "待核验事项服务尚未成功读取；请检查连接后重试。"))
                    .font(.system(size: 12))
                    .foregroundColor(Theme.textSecondary)
                    .lineSpacing(2)
                
                Button(action: {
                    if let item = api.todayInboxAction, item.kind == .marketAnomaly {
                        anomalySelection = MarketAnomalySelection(membershipId: item.membership.id, symbol: item.symbol, version: item.membership.version)
                        return
                    }
                    if let item = api.todayInboxAction, ["research_decision_update", "weekly_research_review", "research_source_intake", "research_review_v1"].contains(item.source.sourceType), api.membershipEnvelope?.memberships.contains(where: { $0.id == item.membership.id && $0.version == item.membership.version && $0.symbol == item.symbol }) == true, let index = api.candidates.firstIndex(where: { $0.symbol == item.symbol }) {
                        if item.source.sourceType == "research_review_v1" { api.selectCandidate(byIndex: index); actions.workflow(.researchReview) }
                        else { onNavigateToResearch?(index, 0) }
                    } else { actions.workflow(.inbox) }
                }) {
                    HStack {
                        Image(systemName: "doc.text.magnifyingglass")
                        Text(api.todayInboxAction?.kind == .marketAnomaly ? "查看异常轻调查 →" : api.todayInboxAction?.source.sourceType == "research_review_v1" ? "进入本次复核 →" : ["research_decision_update", "research_source_intake"].contains(api.todayInboxAction?.source.sourceType ?? "") ? "查看研究变化与依据 →" : "打开待办列表 · 按优先级处理 →")
                    }
                    .font(.system(size: 12.5, weight: .bold))
                    .foregroundColor(Theme.bgPrimary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
                    .background(Theme.blue)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain).accessibilityIdentifier(api.todayInboxAction?.source.sourceType == "research_review_v1" ? "phase12ReviewOpen-" + (api.todayInboxAction?.symbol ?? "") : api.todayInboxAction?.source.sourceType == "research_decision_update" ? "phase6ResearchUpdateOpen-" + (api.todayInboxAction?.symbol ?? "") : api.todayInboxAction?.source.sourceType == "research_source_intake" ? "phase8ResearchUpdateOpen-" + (api.todayInboxAction?.symbol ?? "") : "phase4TodayOpen")
                .padding(.top, 2)
                if let item = api.todayInboxAction, item.kind == .marketAnomaly {
                    Button("AI 深入调查") {
                        anomalySelection = MarketAnomalySelection(membershipId: item.membership.id,
                            symbol: item.symbol, version: item.membership.version, startAI: true)
                    }.buttonStyle(.bordered).accessibilityIdentifier("marketAnomalyTodayAI")
                }
            }
            .padding(12)
            .templateCardStyle()
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Theme.blue.opacity(0.4), lineWidth: 1)
            )
            
            // 2. Secondary Action Items
            if api.todayPendingInboxItems.count > 1 {
                DisclosureGroup("其他待核验事项") {
                    VStack(spacing: 6) {
                        ForEach(Array(api.todayPendingInboxItems.dropFirst().enumerated()), id: \.offset) { _, item in
                            actionRow(badge: item.symbol, badgeColor: Theme.amber,
                                title: TodayMaterialChangePresentation.localizedResearchTitle(item.title),
                                desc: TodayMaterialChangePresentation.userSummary(for: item), actionText: item.kind == .marketAnomaly ? "查看调查" : ["research_decision_update", "research_source_intake", "research_review_v1"].contains(item.source.sourceType) ? "查看研究变化" : "打开待办列表",
                                identifier: item.kind == .marketAnomaly ? "marketAnomalySecondaryOpen" : item.source.sourceType == "research_review_v1" ? "phase12ReviewOpen-" + item.symbol : item.source.sourceType == "research_decision_update" ? "phase6ResearchUpdateOpen-" + item.symbol : item.source.sourceType == "research_source_intake" ? "phase8ResearchUpdateOpen-" + item.symbol : nil,
                                onTap: {
                                    if item.kind == .marketAnomaly {
                                        anomalySelection = MarketAnomalySelection(membershipId: item.membership.id, symbol: item.symbol, version: item.membership.version)
                                        return
                                    }
                                    if ["research_decision_update", "weekly_research_review", "research_source_intake", "research_review_v1"].contains(item.source.sourceType), api.membershipEnvelope?.memberships.contains(where: { $0.id == item.membership.id && $0.version == item.membership.version && $0.symbol == item.symbol }) == true, let index = api.candidates.firstIndex(where: { $0.symbol == item.symbol }) { if item.source.sourceType == "research_review_v1" { api.selectCandidate(byIndex: index); actions.workflow(.researchReview) } else { onNavigateToResearch?(index, 0) } }
                                    else { actions.workflow(.inbox) }
                                })
                        }
                    }
                }.font(.caption).foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private func actionRow(badge: String, badgeColor: Color, title: String, desc: String, actionText: String, identifier: String? = nil, onTap: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(badge)
                    .font(.system(size: 9.5, weight: .bold))
                    .foregroundColor(badgeColor)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(badgeColor.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                Text(title)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Button(action: onTap) {
                    HStack(spacing: 2) {
                        Text(actionText)
                        Image(systemName: "chevron.right")
                    }
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(Theme.blue)
                }
                .accessibilityIdentifier(identifier ?? title)
            }
            Text(desc)
                .font(.system(size: 11.5))
                .foregroundColor(Theme.textSecondary)
                .lineLimit(2)
        }
        .padding(10)
        .templateCardStyle()
    }
    
    // MARK: - 5. Annual Decision Rings Lifecycle Progress Overview
    private var annualRingsProgressSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("研究资料概览 (5-Ring Pipeline)")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Text("已读取记录 · 不代表核验完成")
                    .font(.system(size: 10.5))
                    .foregroundColor(Theme.textTertiary)
            }
            
            VStack(alignment: .leading, spacing: 10) {
                // 5 Steps Visualizer
                HStack(spacing: 4) {
                    ringStepPill(num: "1", title: "候选", isDone: api.candidates.contains { $0.symbol == api.currentSymbol }, isCurrent: false)
                    Image(systemName: "arrow.right").font(.system(size: 8)).foregroundColor(Theme.textTertiary)
                    ringStepPill(num: "2", title: "证据", isDone: !(api.templateFrozen?.data?.materials.isEmpty ?? true), isCurrent: false)
                    Image(systemName: "arrow.right").font(.system(size: 8)).foregroundColor(Theme.textTertiary)
                    ringStepPill(num: "3", title: "研报", isDone: !api.boundTemplateReports(symbol: api.currentSymbol).isEmpty, isCurrent: false)
                    Image(systemName: "arrow.right").font(.system(size: 8)).foregroundColor(Theme.textTertiary)
                    ringStepPill(num: "4", title: "估值", isDone: !api.currentCandidate.valuationScenarios.isEmpty, isCurrent: false)
                    Image(systemName: "arrow.right").font(.system(size: 8)).foregroundColor(Theme.textTertiary)
                    ringStepPill(num: "5", title: "复盘", isDone: !api.currentCandidate.reviewLearnings.isEmpty, isCurrent: false)
                }
                
                Divider().background(Theme.border)
                
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("当前主线标的: \(api.currentCandidate.name) (\(api.currentSymbol))")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(Theme.textPrimary)
                        Text(api.currentCandidate.currentRing)
                            .font(.system(size: 10.5))
                            .foregroundColor(Theme.textSecondary)
                    }
                    Spacer()
                    Button(action: {
                        if let onNavigateToResearch = onNavigateToResearch {
                            onNavigateToResearch(api.selectedCandidateIndex, 0)
                        }
                    }) {
                        Text("进入工作台 →")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(Theme.gold)
                    }
                }
            }
            .padding(12)
            .templateCardStyle()
        }
    }
    
    private func ringStepPill(num: String, title: String, isDone: Bool, isCurrent: Bool) -> some View {
        HStack(spacing: 3) {
            if isDone {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 9))
                    .foregroundColor(Theme.green)
            } else if isCurrent {
                Circle()
                    .fill(Theme.gold)
                    .frame(width: 6, height: 6)
            } else {
                Text(num)
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(Theme.textTertiary)
            }
            Text(title)
                .font(.system(size: 10, weight: isCurrent ? .bold : .medium))
                .foregroundColor(isCurrent ? Theme.gold : (isDone ? Theme.textPrimary : Theme.textTertiary))
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(isCurrent ? Theme.gold.opacity(0.12) : Theme.bgSecondary)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .frame(maxWidth: .infinity)
    }
    
    private var systemAdvisoryNote: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "info.circle")
                .foregroundColor(Theme.textTertiary)
                .font(.system(size: 13))
            Text("辅助决策原则：系统提供事实核对、估值量化与推演支持，绝不自动执行交易或下达券商指令。所有正式决定需由 Owner 亲手确认。")
                .font(.system(size: 11))
                .foregroundColor(Theme.textTertiary)
                .lineSpacing(3)
        }
        .padding(.horizontal, 6)
        .padding(.top, 4)
    }
}
