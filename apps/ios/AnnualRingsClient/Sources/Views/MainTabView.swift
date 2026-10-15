import SwiftUI

struct OwnerClientPageModifier: ViewModifier {
    let tab: AnnualRingsTab
    @Binding var selectedTab: AnnualRingsTab
    @Binding var symbol: String
    @Binding var selectedLayer: DailyDecisionRingLayer
    @Binding var tools: GlobalToolSheet?
    let onOpenTodayItem: (TodayActionInboxItem) -> Bool
    let refreshRevision: UInt64
    @Binding var navigationRevision: UInt64
    func body(content: Content) -> some View {
        OwnerClientPage(tab: tab, selectedTab: $selectedTab, symbol: $symbol,
            selectedLayer: $selectedLayer, tools: $tools, onOpenTodayItem: onOpenTodayItem,
            refreshRevision: refreshRevision, navigationRevision: $navigationRevision,
            content: content)
    }
}
private struct OwnerClientPage<Workflow: View>: View {
    let tab: AnnualRingsTab
    @Binding var selectedTab: AnnualRingsTab
    @Binding var symbol: String
    @Binding var selectedLayer: DailyDecisionRingLayer
    @Binding var tools: GlobalToolSheet?
    let onOpenTodayItem: (TodayActionInboxItem) -> Bool
    let refreshRevision: UInt64
    @Binding var navigationRevision: UInt64
    let content: Workflow
    @ObservedObject private var store = OwnerClientStore.shared
    @ObservedObject private var theme = ThemeManager.shared
    @State private var path: [ClientDestination] = []
    var body: some View {
        NavigationStack(path: $path) {
            page
                .environment(\.antigravityActions, templateActions)
                .navigationDestination(for: ClientDestination.self) { destination in
                    if destination == .stock {
                        AntigravityStockDetailView(dossier: store.currentCandidate.currentDossier)
                            .environment(\.antigravityActions, templateActions)
                            .globalToolsToolbar($tools)
                    } else if destination == .todayResearchReview {
                        if let todayItem = store.todayFormalReviewItem {
                            if let reasoning = store.boundOperatingReasoning(symbol: symbol) {
                                TodayFormalReviewNavigationGate(item: todayItem, initial: reasoning)
                                    .id("today-formal-review:\(todayItem.id):\(reasoning.inputFingerprint)")
                            } else {
                                Text(store.loading ? "正在读取本次 Today 对应的研究…" : "本次 Today 对应研究不可用或身份不匹配；请返回 Today 重新读取。")
                                    .foregroundStyle(store.loading ? Color.secondary : Color.orange)
                                    .accessibilityIdentifier("todayFormalReviewNavigationIssue")
                            }
                        } else {
                            Text("本次 Today 正式复核目标或授权已变化，无法接续。请返回 Today 重新读取后打开。")
                                .foregroundStyle(.orange)
                                .accessibilityIdentifier("todayFormalReviewNavigationIssue")
                        }
                    } else if destination == .researchReview {
                        if let reasoning = store.boundOperatingReasoning(symbol: symbol) {
                            ResearchReviewView(initial: reasoning)
                                .id("phase12:\(reasoning.membershipId):\(reasoning.membershipVersion):\(reasoning.inputFingerprint)")
                        } else { Text("当前研究状态正在刷新；请核对股票与研究资料。") }
                    } else {
                        content
                            .font(OwnerReadingFont.body)
                            .controlSize(.small)
                            .environment(\.antigravityActions, templateActions)
                            .environment(\.clientDestination, destination)
                            .id("\(destination.rawValue):\(symbol)")
                            .navigationTitle(destination.title)
                            .navigationBarTitleDisplayMode(.inline)
                            .globalToolsToolbar($tools)
                    }
                }
        }
        .tint(Theme.gold)
        .preferredColorScheme(theme.preferredColorScheme)
        .task(id: "\(tab.rawValue)|\(symbol)|\(refreshRevision)|\(selectedTab == tab)") {
            guard selectedTab == tab else { return }
            consumeNavigation()
            await store.load(tab: tab, symbol: symbol)
        }
        .onChange(of: path) { previous, current in
            guard selectedTab == tab, !previous.isEmpty, current.isEmpty else { return }
            Task { await store.load(tab: tab, symbol: symbol) }
        }
        .onChange(of: store.researchNavigation) { _, _ in consumeNavigation() }
        .onChange(of: store.selectedSymbol) { _, value in
            guard selectedTab == tab, value != symbol else { return }
            symbol = value
        }
    }
    private var templateActions: AntigravityActions {
        AntigravityActions(workflow: { destination in
            if destination == .researchReview { store.todayFormalReviewItem = nil }
            if destination == .market && tab != .market {
                symbol = store.currentSymbol
                selectedTab = .market
                return
            }
            let researchDestinations: Set<ClientDestination> = [.templateHome, .report, .valuation, .quant, .materials, .tasks, .manualResearch, .review, .researchReview, .manage, .facts, .workflow, .decision, .portfolio]
            if tab != .research && researchDestinations.contains(destination) {
                openResearch(store.currentSymbol, destination)
            } else { path.append(destination) }
        },
            assistant: { tools = .assistant }, search: { tools = .search }, connection: { tools = .connection })
    }
    private var stockBinding: Binding<InvestmentDecisionDossier?> {
        Binding(get: { nil }, set: { value in
            guard let value else { return }
            store.selectSymbol(value.symbol); symbol = value.symbol; path.append(.stock)
        })
    }
    private func navigateTemplate(_ index: Int, _ ring: Int) {
        store.todayFormalReviewItem = nil
        store.selectCandidate(byIndex: index)
        symbol = store.currentSymbol
        store.selectedTemplateRing = ring
        store.researchNavigation = ClientResearchNavigation(symbol: symbol, destination: .templateHome)
        selectedTab = .research
    }
    @ViewBuilder private var page: some View {
        switch tab {
        case .today:
            AntigravityTodayView(onNavigateToResearch: navigateTemplate,
                onOpenInboxItem: onOpenTodayItem, selectedStock: stockBinding,
                showSearch: Binding(get: { tools == .search }, set: { if $0 { tools = .search } }),
                showAIAssistant: Binding(get: { tools == .assistant }, set: { if $0 { tools = .assistant } }))
        case .market:
            AntigravityMarketView(onNavigateToResearch: navigateTemplate, selectedStock: stockBinding)
        case .research:
            AntigravityResearchView(selectedCandidateIndex: Binding(get: { store.selectedCandidateIndex }, set: { store.selectCandidate(byIndex: $0); symbol = store.currentSymbol }),
                selectedRingTab: $store.selectedTemplateRing)
        case .assets:
            AntigravityAssetsView(onNavigateToResearch: navigateTemplate, selectedStock: stockBinding)
        }
    }
    private func openResearch(_ raw: String, _ destination: ClientDestination) {
        guard let canonical = SecuritySymbol.parseHongKongAlias(raw)?.canonical else { return }
        if destination == .researchReview { store.todayFormalReviewItem = nil }
        symbol = canonical
        store.selectSymbol(canonical)
        selectedLayer = destination == .review ? .review : destination == .manage ? .candidate : .evidence
        store.researchNavigation = ClientResearchNavigation(symbol: canonical, destination: destination)
        selectedTab = .research
    }
    private func consumeNavigation() {
        guard tab == .research, let request = store.researchNavigation else { return }
        symbol = request.symbol
        path = request.destination == .templateHome ? [] : [request.destination]
        store.researchNavigation = nil
    }
}

private struct TodayFormalReviewNavigationGate: View {
    let item: TodayActionInboxItem
    let initial: ResearchOperatingReasoning
    @ObservedObject private var store = OwnerClientStore.shared
    @State private var verifiedIdentity: String?
    @State private var issue: String?

    private var identity: String {
        "\(item.id):\(item.source.sourceFingerprint ?? "missing"):\(initial.inputFingerprint):\(store.authorizationRevision):\(store.todayFormalReviewItem == item)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if store.todayFormalReviewItem != item {
                Text("本次 Today 正式复核目标或授权已变化，无法接续。请返回 Today 重新读取后打开。")
                    .font(.footnote).foregroundStyle(.orange)
                    .accessibilityIdentifier("todayFormalReviewNavigationIssue")
            } else if verifiedIdentity == identity {
                Text("已核对本次 Today 的正式 Thesis 触发；工作台仍按当前研究状态独立读取。")
                    .font(.footnote).foregroundStyle(.secondary)
                ResearchReviewView(initial: initial)
            } else {
                Text(issue ?? "正在核对 Today 的正式复核目标…")
                    .font(.footnote).foregroundStyle(issue == nil ? Color.secondary : Color.orange)
                    .accessibilityIdentifier("todayFormalReviewNavigationIssue")
                if issue != nil { Button("重新核对当前复核") { Task { await verify() } } }
            }
        }
        .task(id: identity) { await verify() }
    }

    @MainActor private func verify() async {
        let expectedIdentity = identity
        verifiedIdentity = nil
        issue = nil
        guard store.selectedSymbol == item.symbol,
              store.todayFormalReviewItem == item,
              initial.symbol == item.symbol,
              initial.membershipId == item.membership.id,
              initial.membershipVersion == item.membership.version,
              todayFormalReviewTriggerFingerprint(item) != nil,
              let inbox = store.inbox,
              let member = store.membershipEnvelope?.memberships.first(where: { $0.id == item.membership.id }),
              currentTodayNavigationItem(expected: item, inbox: inbox,
                  membership: TodayNavigationMembershipIdentity(member)) != nil else {
            issue = "Today 正式复核的成员、版本或来源已变化；未打开旧目标。请返回 Today 重新读取。"
            return
        }
        do {
            let current = try await store.researchReview(initial)
            guard expectedIdentity == identity, !Task.isCancelled else { return }
            guard current.symbol == item.symbol,
                  current.membershipId == item.membership.id,
                  current.membershipVersion == item.membership.version,
                  current.scenarioPeriodType == "CURRENT_FY",
                  ["REVIEW_DUE", "REVIEW_REQUIRED"].contains(current.status),
                  current.activeMilestone != nil,
                  current.triggerFingerprint == item.source.sourceFingerprint else {
                issue = "正式 Thesis 触发已与 Today 记录不同；未打开旧目标。请返回 Today 重新读取。"
                return
            }
            verifiedIdentity = expectedIdentity
        } catch {
            guard expectedIdentity == identity else { return }
            issue = "当前正式复核暂无法核对；未打开旧目标。请核对连接后重新读取。"
        }
    }
}
