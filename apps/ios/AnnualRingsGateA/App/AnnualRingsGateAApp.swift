import SwiftUI

@main
struct AnnualRingsGateAApp: App {
#if OWNER_CLIENT
    @ObservedObject private var ownerTheme = ThemeManager.shared
    @ObservedObject private var ownerStore = OwnerClientStore.shared
#endif
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab: AnnualRingsTab
    @State private var assistedDecisionSymbol: String
    @State private var assistedDecisionLayer: DailyDecisionRingLayer
    @State private var requestedTodayResearchTarget: TodayResearchNavigationTarget?
    @State private var requestedTodayCandidateTarget: TodayCandidateNavigationTarget?
    @State private var requestedTodayReviewTarget: TodayReviewNavigationTarget?
    @State private var requestedTodayFormalDecisionTarget: TodayFormalDecisionNavigationTarget?
    @State private var requestedTodayReportRevision: TodayReportRevisionNotice?
    @State private var todayReportRevisionNotice: TodayReportRevisionNotice?
    @State private var dailyTechnicalEnvelope: MarketDailyTechnicalEnvelope?
    @State private var marketWeinsteinEnvelope: WeinsteinTechnicalAnalysisEnvelope?
    @State private var localDecisionDraft: LocalDecisionDraft?
    @State private var todayRefreshRevision: UInt64
    @State private var researchNavigationRevision: UInt64
    @State private var connectionRevision: UInt64
    @State private var globalToolSheet: GlobalToolSheet?
    @State private var pendingMarketAnnouncement: OfficialAnnouncementDiscoveryItem?
    @State private var pendingResearchOfficialAnnouncement: OfficialAnnouncementDiscoveryItem?
    @State private var pendingResearchNoticeLead: NoticeLeadResearchHandoff?
    @State private var observedScenePhase: ScenePhase?
    @AppStorage("annualRingsMakeV9DarkTheme") private var makeV9DarkTheme = true
    private let resumeStorage: DailyClientResumeUserDefaultsStorage
    private let initialResumeResult: DailyClientResumeLoadResult

    init() {
#if DEBUG
        AppEnvironment.persistDebugConnectionIfRequested()
#endif
#if os(iOS)
        let navigationAppearance = UINavigationBarAppearance()
        navigationAppearance.configureWithTransparentBackground()
        // Native label color keeps normal and large navigation titles readable in both appearances.
        let titleColor = UIColor.label
        navigationAppearance.titleTextAttributes = [.foregroundColor: titleColor]
        navigationAppearance.largeTitleTextAttributes = [.foregroundColor: titleColor]
        UINavigationBar.appearance().standardAppearance = navigationAppearance
        UINavigationBar.appearance().scrollEdgeAppearance = navigationAppearance
#endif
        let storage = DailyClientResumeUserDefaultsStorage()
        if AppEnvironment.shouldResetDailyResume {
            storage.clear()
        }
        let result = storage.load()
        let snapshot = result.snapshot
        resumeStorage = storage
        initialResumeResult = result
        _selectedTab = State(initialValue: AppEnvironment.initialTab())
        _assistedDecisionSymbol = State(initialValue: snapshot?.canonicalSymbol ?? AppEnvironment.rawSymbolInput())
        _assistedDecisionLayer = State(initialValue: snapshot?.selectedLayer.appLayer ?? .evidence)
        _requestedTodayResearchTarget = State(initialValue: nil)
        _requestedTodayCandidateTarget = State(initialValue: nil)
        _requestedTodayReviewTarget = State(initialValue: nil)
        _requestedTodayFormalDecisionTarget = State(initialValue: nil)
        _requestedTodayReportRevision = State(initialValue: nil)
        _todayReportRevisionNotice = State(initialValue: nil)
        _dailyTechnicalEnvelope = State(initialValue: nil)
        _marketWeinsteinEnvelope = State(initialValue: nil)
        _localDecisionDraft = State(initialValue: nil)
        _todayRefreshRevision = State(initialValue: 0)
        _researchNavigationRevision = State(initialValue: 0)
        _connectionRevision = State(initialValue: 0)
        _globalToolSheet = State(initialValue: nil)
        _pendingMarketAnnouncement = State(initialValue: nil)
        _pendingResearchOfficialAnnouncement = State(initialValue: nil)
        _pendingResearchNoticeLead = State(initialValue: nil)
    }

    var body: some Scene {
        WindowGroup {
#if DEBUG
            UITestViewportContainer(width: AppEnvironment.uiTestViewportWidth) {
                rootWithExperienceContext
            }
#else
            rootWithExperienceContext
#endif
        }
    }

    /// Figma Make Version 9 is the only visual and interaction baseline for the
    /// simulator experience; existing clients remain the data and operation source.
    // TODO: 设计稿待确认：Figma Make 预览不包含真实设备状态栏，模拟器保留系统状态栏。
    @ViewBuilder
    private var rootWithExperienceContext: some View {
        rootTabs
#if OWNER_CLIENT
            .preferredColorScheme(ownerTheme.preferredColorScheme)
#else
            .preferredColorScheme(AppEnvironment.isExperienceSession ? (makeV9DarkTheme ? .dark : .light) : nil)
#endif
    }

    @ViewBuilder
    private func globalToolSheetContent(_ sheet: GlobalToolSheet) -> some View {
        switch sheet {
        case .search:
            GlobalSearchSheet(
                symbolInput: $assistedDecisionSymbol,
                selectedTab: $selectedTab,
                clearPendingResearchNavigation: clearPendingResearchNavigation,
                openResearchCandidate: openResearchCandidate
            )
        case .assistant:
#if OWNER_CLIENT
            CompanyResearchAssistantView(
                symbol: assistedDecisionSymbol,
                selectedTab: $selectedTab,
                selectedDecisionLayer: $assistedDecisionLayer,
                clearPendingResearchNavigation: clearPendingResearchNavigation,
                openResearchCandidate: openResearchCandidate,
                openReportRevision: openGlobalAssistantReportRevision,
                closeOuterAssistant: { globalToolSheet = nil }
            )
#else
            GlobalAssistantSheet(
                symbolInput: $assistedDecisionSymbol,
                selectedTab: $selectedTab,
                selectedDecisionLayer: $assistedDecisionLayer,
                clearPendingResearchNavigation: clearPendingResearchNavigation,
                openResearchCandidate: openResearchCandidate,
                openReportRevision: openGlobalAssistantReportRevision
            )
#endif
        case .connection:
            ConnectionSettingsView {
                globalToolSheet = nil
                refreshConnection()
            }
        }
    }

    private func openGlobalAssistantReportRevision(_ notice: TodayReportRevisionNotice) {
        clearPendingResearchNavigation()
        requestedTodayReportRevision = notice
        assistedDecisionSymbol = notice.symbol
        assistedDecisionLayer = .evidence
        selectedTab = .research
#if OWNER_CLIENT
        OwnerClientStore.shared.researchNavigation = ClientResearchNavigation(
            symbol: notice.symbol, destination: .workflow)
#endif
    }

    private var rootTabs: some View {
        TabView(selection: $selectedTab) {
            AnyView(TodayRootView(
                symbolInput: $assistedDecisionSymbol,
                localDraft: $localDecisionDraft,
                refreshRevision: todayRefreshRevision,
                reportRevisionNotice: $todayReportRevisionNotice,
                globalToolSheet: $globalToolSheet,
                connectionChanged: refreshConnection,
                openResearch: { rawSymbol in
                    guard let canonical = SecuritySymbol.parseHongKongAlias(rawSymbol)?.canonical else { return }
                    clearPendingResearchNavigation()
                    assistedDecisionSymbol = canonical
                    assistedDecisionLayer = .evidence
                    selectedTab = .research
#if OWNER_CLIENT
                    OwnerClientStore.shared.researchNavigation = ClientResearchNavigation(
                        symbol: assistedDecisionSymbol,
                        destination: assistedDecisionLayer == .candidate ? .manage : .workflow)
#endif
                },
                openMarket: { rawSymbol in
                    clearPendingResearchNavigation()
                    if let rawSymbol, let canonical = SecuritySymbol.parseHongKongAlias(rawSymbol)?.canonical {
                        assistedDecisionSymbol = canonical
                    }
                    selectedTab = .market
                },
                openMarketAnnouncement: { item in
                    clearPendingResearchNavigation()
                    pendingMarketAnnouncement = item
                    assistedDecisionSymbol = item.symbol
                    selectedTab = .market
                },
                openAssets: {
                    clearPendingResearchNavigation()
                    selectedTab = .assets
                },
                openResearchDecision: { canonicalSymbol in
                    clearPendingResearchNavigation()
                    assistedDecisionSymbol = canonicalSymbol
                    assistedDecisionLayer = .decision
                    selectedTab = .research
#if OWNER_CLIENT
                    OwnerClientStore.shared.researchNavigation = ClientResearchNavigation(
                        symbol: assistedDecisionSymbol,
                        destination: assistedDecisionLayer == .candidate ? .manage : .workflow)
#endif
                },
                openResearchCandidate: { target in
                    clearPendingResearchNavigation()
                    requestedTodayCandidateTarget = target
                    assistedDecisionSymbol = target.symbol
                    assistedDecisionLayer = .evidence
                    selectedTab = .research
#if OWNER_CLIENT
                    OwnerClientStore.shared.researchNavigation = ClientResearchNavigation(
                        symbol: assistedDecisionSymbol,
                        destination: assistedDecisionLayer == .candidate ? .manage : .workflow)
#endif
                },
                openResearchToday: { target in
                    clearPendingResearchNavigation()
                    requestedTodayResearchTarget = target
                    assistedDecisionSymbol = target.symbol
                    assistedDecisionLayer = target.preferredLayer
                    selectedTab = .research
#if OWNER_CLIENT
                    OwnerClientStore.shared.researchNavigation = ClientResearchNavigation(
                        symbol: assistedDecisionSymbol,
                        destination: assistedDecisionLayer == .candidate ? .manage : .workflow)
#endif
                },
                openResearchReview: { target in
                    clearPendingResearchNavigation()
                    requestedTodayReviewTarget = target
                    assistedDecisionSymbol = target.canonicalSymbol
                    assistedDecisionLayer = .review
                    selectedTab = .research
#if OWNER_CLIENT
                    OwnerClientStore.shared.researchNavigation = ClientResearchNavigation(
                        symbol: assistedDecisionSymbol,
                        destination: assistedDecisionLayer == .candidate ? .manage : .workflow)
#endif
                },
                openResearchFormalDecision: { target in
                    clearPendingResearchNavigation()
                    requestedTodayFormalDecisionTarget = target
                    assistedDecisionSymbol = target.binding.symbol
                    assistedDecisionLayer = .evidence
                    selectedTab = .research
#if OWNER_CLIENT
                    OwnerClientStore.shared.researchNavigation = ClientResearchNavigation(
                        symbol: assistedDecisionSymbol,
                        destination: assistedDecisionLayer == .candidate ? .manage : .workflow)
#endif
                },
                openResearchReportRevision: { notice in
                    clearPendingResearchNavigation()
                    todayReportRevisionNotice = notice
                    requestedTodayReportRevision = notice
                    assistedDecisionSymbol = notice.symbol
                    assistedDecisionLayer = .evidence
                    selectedTab = .research
#if OWNER_CLIENT
                    OwnerClientStore.shared.researchNavigation = ClientResearchNavigation(
                        symbol: assistedDecisionSymbol,
                        destination: assistedDecisionLayer == .candidate ? .manage : .workflow)
#endif
                }
            ))
#if OWNER_CLIENT
                .modifier(OwnerClientPageModifier(tab: .today, selectedTab: $selectedTab,
                    symbol: $assistedDecisionSymbol, selectedLayer: $assistedDecisionLayer,
                    tools: $globalToolSheet,
                    onOpenTodayItem: openOwnerTodayItem,
                    refreshRevision: todayRefreshRevision, navigationRevision: $researchNavigationRevision))
#endif
                .tag(AnnualRingsTab.today)
                .tabItem {
                    #if OWNER_CLIENT
                    Label("今日", systemImage: "sun.max.fill")
                    #else
                    Label("今日", systemImage: "calendar")
                    #endif
                }

            AnyView(GateAMarketScreen(
                symbolInput: $assistedDecisionSymbol,
                dailyEnvelope: $dailyTechnicalEnvelope,
                weinsteinEnvelope: $marketWeinsteinEnvelope,
                globalToolSheet: $globalToolSheet,
                todayRefreshRevision: $todayRefreshRevision,
                pendingAnnouncement: $pendingMarketAnnouncement,
                pendingNoticeLead: $pendingResearchNoticeLead,
                refreshRevision: todayRefreshRevision,
                openResearchCandidate: { target in
                    clearPendingResearchNavigation()
                    requestedTodayCandidateTarget = target
                    assistedDecisionSymbol = target.symbol
                    assistedDecisionLayer = .evidence
                    selectedTab = .research
#if OWNER_CLIENT
                    OwnerClientStore.shared.researchNavigation = ClientResearchNavigation(
                        symbol: assistedDecisionSymbol,
                        destination: assistedDecisionLayer == .candidate ? .manage : .workflow)
#endif
                },
                openImportedAnnouncement: { target, item in
                    clearPendingResearchNavigation()
                    pendingResearchOfficialAnnouncement = item
                    requestedTodayCandidateTarget = target
                    assistedDecisionSymbol = target.symbol
                    assistedDecisionLayer = .evidence
                    selectedTab = .research
#if OWNER_CLIENT
                    OwnerClientStore.shared.researchNavigation = ClientResearchNavigation(
                        symbol: assistedDecisionSymbol,
                        destination: assistedDecisionLayer == .candidate ? .manage : .workflow)
#endif
                },
                openAssistedDecision: { canonicalSymbol in
                    clearPendingResearchNavigation()
                    assistedDecisionSymbol = canonicalSymbol
                    assistedDecisionLayer = .evidence
                    selectedTab = .research
#if OWNER_CLIENT
                    OwnerClientStore.shared.researchNavigation = ClientResearchNavigation(
                        symbol: assistedDecisionSymbol,
                        destination: assistedDecisionLayer == .candidate ? .manage : .workflow)
#endif
                }
            ))
#if OWNER_CLIENT
                .modifier(OwnerClientPageModifier(tab: .market, selectedTab: $selectedTab,
                    symbol: $assistedDecisionSymbol, selectedLayer: $assistedDecisionLayer,
                    tools: $globalToolSheet,
                    onOpenTodayItem: { _ in false },
                    refreshRevision: todayRefreshRevision, navigationRevision: $researchNavigationRevision))
#endif
                .tag(AnnualRingsTab.market)
                .tabItem {
                    #if OWNER_CLIENT
                    Label("市场", systemImage: "chart.line.uptrend.xyaxis")
                    #else
                    Label("市场", systemImage: "chart.bar.xaxis")
                    #endif
                }

            AnyView(GateBResearchScreen(
                symbolInput: $assistedDecisionSymbol,
                selectedDecisionLayer: $assistedDecisionLayer,
                initialResumeResult: initialResumeResult,
                marketTechnicalEnvelope: dailyTechnicalEnvelope,
                marketWeinsteinEnvelope: marketWeinsteinEnvelope,
                localDecisionDraft: $localDecisionDraft,
                selectedTab: $selectedTab,
                todayRefreshRevision: $todayRefreshRevision,
                researchNavigationRevision: researchNavigationRevision,
                requestedTodayReviewTarget: $requestedTodayReviewTarget,
                requestedTodayFormalDecisionTarget: $requestedTodayFormalDecisionTarget,
                requestedTodayResearchTarget: $requestedTodayResearchTarget,
                requestedTodayCandidateTarget: $requestedTodayCandidateTarget,
                requestedTodayReportRevision: $requestedTodayReportRevision,
                todayReportRevisionNotice: $todayReportRevisionNotice,
                globalToolSheet: $globalToolSheet,
                pendingNoticeLead: $pendingResearchNoticeLead,
                pendingOfficialAnnouncement: $pendingResearchOfficialAnnouncement,
                resumePendingMarketAnnouncement: { symbol in
                    guard pendingMarketAnnouncement?.symbol == symbol else { return }
                    selectedTab = .market
                }
                ))
#if OWNER_CLIENT
                .modifier(OwnerClientPageModifier(tab: .research, selectedTab: $selectedTab,
                    symbol: $assistedDecisionSymbol, selectedLayer: $assistedDecisionLayer,
                    tools: $globalToolSheet,
                    onOpenTodayItem: { _ in false },
                    refreshRevision: todayRefreshRevision, navigationRevision: $researchNavigationRevision))
#endif
                .tag(AnnualRingsTab.research)
                .tabItem {
                    #if OWNER_CLIENT
                    Label("研究", systemImage: "doc.text.magnifyingglass")
                    #else
                    Label("研究", systemImage: "magnifyingglass")
                    #endif
                }

            AnyView(AssetsRootView(
                symbolInput: $assistedDecisionSymbol,
                localDraft: $localDecisionDraft,
                selectedTab: $selectedTab,
                globalToolSheet: $globalToolSheet,
                refreshRevision: todayRefreshRevision,
                openMarket: { rawSymbol in
                    guard let canonical = SecuritySymbol.parseHongKongAlias(rawSymbol)?.canonical else { return }
                    clearPendingResearchNavigation()
                    assistedDecisionSymbol = canonical
                    selectedTab = .market
                },
                openResearchOnboarding: { canonical in
                    clearPendingResearchNavigation(); assistedDecisionSymbol = canonical; assistedDecisionLayer = .candidate; selectedTab = .research
#if OWNER_CLIENT
                    OwnerClientStore.shared.researchNavigation = ClientResearchNavigation(
                        symbol: assistedDecisionSymbol,
                        destination: assistedDecisionLayer == .candidate ? .manage : .workflow)
#endif
                },
                openResearchCandidate: openResearchCandidate
            ))
#if OWNER_CLIENT
                .modifier(OwnerClientPageModifier(tab: .assets, selectedTab: $selectedTab,
                    symbol: $assistedDecisionSymbol, selectedLayer: $assistedDecisionLayer,
                    tools: $globalToolSheet,
                    onOpenTodayItem: { _ in false },
                    refreshRevision: todayRefreshRevision, navigationRevision: $researchNavigationRevision))
#endif
                .tag(AnnualRingsTab.assets)
                .tabItem {
                    #if OWNER_CLIENT
                    Label("资产", systemImage: "briefcase.fill")
                    #else
                    Label("资产", systemImage: "chart.pie.fill")
                    #endif
                }
        }
        #if OWNER_CLIENT
        .tint(Theme.gold)
        #else
        // Platform blue keeps the original app's native controls at default contrast.
        .tint(.blue)
        #endif
        #if !OWNER_CLIENT
        .toolbar(.hidden, for: .tabBar)
        .overlay(alignment: .bottom) {
            FigmaRootTabBar(selection: $selectedTab)
                .ignoresSafeArea(.container, edges: .bottom)
        }
        #endif
        .sheet(item: $globalToolSheet, onDismiss: {
#if OWNER_CLIENT
            OwnerClientStore.shared.finishPersonalFormalDismissal()
#endif
        }) { sheet in
            globalToolSheetContent(sheet)
#if OWNER_CLIENT
                .preferredColorScheme(ownerTheme.preferredColorScheme)
#else
                .preferredColorScheme(AppEnvironment.isExperienceSession ? .dark : nil)
#endif
                .presentationBackground(OwnerExperienceStyle.pageBackground)
                .presentationCornerRadius(20)
                .safeAreaInset(edge: .top, spacing: 0) {
                    if let label = AppEnvironment.experienceLabel {
                        ExperienceContextBanner(label: label)
                    }
                }
        }
#if OWNER_CLIENT
        .onChange(of: ownerStore.personalFormalNavigationReadyId) { _, readyId in
            guard let readyId else { return }
            openPersonalFormalPreparation(readyId)
        }
#endif
        .onChange(of: selectedTab) { _, tab in
            if tab != .research { clearPendingResearchNavigation() }
            #if OWNER_CLIENT
            if tab != .research { ownerStore.todayFormalReviewItem = nil }
            #endif
            if tab == .today { todayRefreshRevision &+= 1 }
            persistDailyNavigation()
        }
        .onChange(of: assistedDecisionSymbol) { _, newValue in
            let canonical = SecuritySymbol.parseHongKongAlias(newValue)?.canonical
            if requestedTodayReviewTarget?.canonicalSymbol != canonical {
                requestedTodayReviewTarget = nil
            }
            if requestedTodayFormalDecisionTarget?.binding.symbol != canonical {
                requestedTodayFormalDecisionTarget = nil
            }
            if let symbol = SecuritySymbol.parseHongKongAlias(newValue) {
                dailyTechnicalEnvelope = .unavailable(
                    "候选标的已变化；上一标的日线与指标已同步清除。",
                    market: symbol.market,
                    code: symbol.code,
                    cutoff: currentHongKongRequestDate()
                )
            } else {
                dailyTechnicalEnvelope = nil
            }
            marketWeinsteinEnvelope = nil
            if requestedTodayCandidateTarget?.symbol != canonical {
                requestedTodayCandidateTarget = nil
            }
            if pendingMarketAnnouncement?.symbol != canonical {
                pendingMarketAnnouncement = nil
            }
            if pendingResearchOfficialAnnouncement?.symbol != canonical {
                pendingResearchOfficialAnnouncement = nil
            }
            if pendingResearchNoticeLead?.item.symbol != canonical {
                pendingResearchNoticeLead = nil
            }
            clearTodayReportRevisionTargets(for: canonical)
            persistDailyNavigation()
        }
        .onChange(of: assistedDecisionLayer) { _, _ in persistDailyNavigation() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, observedScenePhase != nil { todayRefreshRevision &+= 1 }
            observedScenePhase = phase
        }
        .onAppear { observedScenePhase = scenePhase }
        .onReceive(TodayHighImpactNotificationRouter.shared.$pendingTarget) { target in if target != nil { clearPendingResearchNavigation(); selectedTab = .today; todayRefreshRevision &+= 1 } }
        .id(connectionRevision)
    }

#if OWNER_CLIENT
    private func openPersonalFormalPreparation(_ readyId: UUID) {
        let store = OwnerClientStore.shared
        guard store.personalFormalNavigationReadyId == readyId,
              let handoff = store.personalFormalHandoff,
              handoff.id == readyId else { return }
        guard handoff.connectionScope == PersonalFormalResearchHandoff.currentConnectionScope(),
              SecuritySymbol.parseHongKongAlias(handoff.symbol)?.canonical == handoff.symbol else {
            store.clearPersonalFormalHandoff()
            return
        }
        store.personalFormalNavigationReadyId = nil
        clearPendingResearchNavigation()
        store.selectSymbol(handoff.symbol)
        assistedDecisionSymbol = handoff.symbol
        assistedDecisionLayer = .evidence
        selectedTab = .research
        store.researchNavigation = ClientResearchNavigation(symbol: handoff.symbol,
            destination: handoff.purpose == .manualJudgment ? .manualResearch : .tasks)
    }
#endif

    private func refreshConnection() {
        pendingMarketAnnouncement = nil
        pendingResearchOfficialAnnouncement = nil
        pendingResearchNoticeLead = nil
        connectionRevision &+= 1
        todayRefreshRevision &+= 1
        researchNavigationRevision &+= 1
    }

    private func openResearchCandidate(_ target: TodayCandidateNavigationTarget) {
        clearPendingResearchNavigation()
        requestedTodayCandidateTarget = target
        assistedDecisionSymbol = target.symbol
        assistedDecisionLayer = target.opensPortfolioLab ? .portfolio : .evidence
        selectedTab = .research
#if OWNER_CLIENT
                    OwnerClientStore.shared.researchNavigation = ClientResearchNavigation(
                        symbol: assistedDecisionSymbol,
                        destination: assistedDecisionLayer == .candidate ? .manage : .workflow)
#endif
    }

#if OWNER_CLIENT
    /// The main Today surface uses the same exact-target handoff as TodayActionInboxCard.
    /// GateBResearchScreen re-reads each target before opening any report or draft.
    private func openOwnerTodayItem(_ item: TodayActionInboxItem) -> Bool {
        guard selectedTab == .today,
              SecuritySymbol.parseHongKongAlias(item.symbol)?.canonical == item.symbol,
              let inbox = ownerStore.inbox,
              let member = ownerStore.membershipEnvelope?.memberships.first(where: {
                  $0.id == item.membership.id
              }),
              currentTodayNavigationItem(expected: item, inbox: inbox,
                  membership: TodayNavigationMembershipIdentity(member)) != nil else { return false }
        if item.kind == .candidateFound || item.kind == .researchProfileReviewDue
            || ["research_decision_update", "weekly_research_review"].contains(item.source.sourceType) {
            openResearchCandidate(TodayCandidateNavigationTarget(
                membershipId: item.membership.id, membershipVersion: item.membership.version,
                symbol: item.symbol, opensResearchProfileReview: item.kind == .researchProfileReviewDue
            ))
            return true
        }
        if item.source.sourceType == "research_review_v1" {
            guard todayFormalReviewTriggerFingerprint(item) != nil else { return false }
            clearPendingResearchNavigation()
            ownerStore.todayFormalReviewItem = item
            assistedDecisionSymbol = item.symbol
            assistedDecisionLayer = .evidence
            ownerStore.researchNavigation = ClientResearchNavigation(symbol: item.symbol,
                destination: .todayResearchReview)
            selectedTab = .research
            return true
        }
        if let target = item.researchTarget {
            clearPendingResearchNavigation()
            requestedTodayResearchTarget = TodayResearchNavigationTarget(
                requestId: UUID(), symbol: item.symbol,
                membershipId: item.membership.id, membershipVersion: item.membership.version,
                itemId: target.itemId,
                preferredLayer: target.preferredLayer == "portfolio" ? .portfolio : .evidence,
                report: target.report.map {
                    TodayResearchReportNavigationTarget(id: $0.id, version: $0.version,
                                                        evidencePackId: $0.evidencePackId)
                },
                task: target.task, source: TodayResearchSourceNavigationTarget(source: item.source)
            )
            assistedDecisionSymbol = item.symbol
            assistedDecisionLayer = target.preferredLayer == "portfolio" ? .portfolio : .evidence
            ownerStore.researchNavigation = ClientResearchNavigation(symbol: item.symbol, destination: .workflow)
            selectedTab = .research
            return true
        }
        guard let event = item.reviewEvent else { return false }
        if item.kind == .formalDecisionDue {
            guard let target = TodayFormalDecisionNavigationTarget(event: event),
                  target.binding.membershipId == item.membership.id,
                  target.binding.membershipVersion == item.membership.version,
                  target.binding.symbol == item.symbol else { return false }
            clearPendingResearchNavigation()
            requestedTodayFormalDecisionTarget = target
            assistedDecisionLayer = .evidence
        } else {
            guard let target = TodayReviewNavigationTarget(
                event: event, membershipId: item.membership.id,
                membershipVersion: item.membership.version
            ), target.canonicalSymbol == item.symbol else { return false }
            clearPendingResearchNavigation()
            requestedTodayReviewTarget = target
            assistedDecisionLayer = .review
        }
        assistedDecisionSymbol = item.symbol
        ownerStore.researchNavigation = ClientResearchNavigation(symbol: item.symbol, destination: .workflow)
        selectedTab = .research
        return true
    }
#endif

    private func clearPendingResearchNavigation() {
        researchNavigationRevision &+= 1
        pendingResearchOfficialAnnouncement = nil
        pendingResearchNoticeLead = nil
        requestedTodayResearchTarget = nil
        requestedTodayCandidateTarget = nil
        requestedTodayReviewTarget = nil
        requestedTodayFormalDecisionTarget = nil
        requestedTodayReportRevision = nil
    }

    private func clearTodayReportRevisionTargets(for canonical: String?) {
        if todayReportRevisionNotice?.symbol != canonical {
            todayReportRevisionNotice = nil
        }
        if requestedTodayReportRevision?.symbol != canonical {
            requestedTodayReportRevision = nil
        }
    }

    private func persistDailyNavigation() {
        guard let canonical = SecuritySymbol.parseHongKongAlias(assistedDecisionSymbol)?.canonical else {
            return
        }
        guard let resumeEntry = selectedTab.resumeEntry else { return }
        let snapshot = DailyClientResumeSnapshot.navigation(
            canonicalSymbol: canonical,
            selectedEntry: resumeEntry,
            selectedLayer: assistedDecisionLayer.resumeLayer
        )
        try? resumeStorage.save(snapshot)
    }
}

/// 非官方/历史样本体验标签：常驻但克制，只陈述当前上下文，不替代任何来源说明。
private struct ExperienceContextBanner: View {
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "flask")
                .font(.caption2.weight(.semibold))
            Text(label)
                .font(.caption.weight(.semibold))
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .foregroundStyle(OwnerExperienceStyle.textSecondary)
        .padding(.horizontal, 16)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(OwnerExperienceStyle.subtleBorder)
                .frame(height: 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("当前体验标签：\(label)")
        .accessibilityIdentifier("experienceContextBanner")
    }
}

/// Figma Make Version 9 uses a translucent fixed bar, gold active state and a
/// short active underline. The native tab bar is hidden so this stays identical
/// across Simulator widths.
private struct FigmaRootTabBar: View {
    @Binding var selection: AnnualRingsTab

    var body: some View {
        HStack(spacing: 0) {
            item(.today, "今日", "calendar")
            item(.market, "市场", "chart.xyaxis.line")
            item(.research, "研究", "magnifyingglass")
            item(.assets, "资产", "chart.bar.xaxis")
        }
        .padding(.top, 8)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial)
        .background(OwnerExperienceStyle.pageBackground.opacity(0.92))
        .overlay(alignment: .top) {
            Rectangle().fill(OwnerExperienceStyle.border)
                .frame(height: 1)
        }
    }

    private func item(_ tab: AnnualRingsTab, _ title: String, _ systemImage: String) -> some View {
        Button { selection = tab } label: {
            VStack(spacing: 4) {
                Image(systemName: systemImage)
                    .font(.system(size: 22, weight: .regular))
                Text(title)
                    .font(.system(size: 10, weight: selection == tab ? .semibold : .regular))
            }
            .foregroundStyle(selection == tab ? OwnerExperienceStyle.gold : OwnerExperienceStyle.textTertiary)
            .frame(maxWidth: .infinity, minHeight: 42)
            .overlay(alignment: .bottom) {
                if selection == tab {
                    Capsule().fill(OwnerExperienceStyle.gold).frame(width: 18, height: 2)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

private extension AnnualRingsTab {
    var resumeEntry: DailyClientEntry? {
        switch self {
        case .market: .quote
        case .research: .assistedDecision
        case .today, .assets: nil
        }
    }
}

private extension DailyClientEntry {
    var appTab: AnnualRingsTab {
        self == .quote ? .market : .research
    }
}

private extension DailyDecisionRingLayer {
    var resumeLayer: DailyClientRingLayer {
        DailyClientRingLayer(rawValue: rawValue) ?? .candidate
    }
}

private extension DailyClientRingLayer {
    var appLayer: DailyDecisionRingLayer {
        DailyDecisionRingLayer(rawValue: rawValue) ?? .candidate
    }
}
