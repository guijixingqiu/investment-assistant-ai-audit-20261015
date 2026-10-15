import SwiftUI
struct AssetsRootView: View {
#if OWNER_CLIENT
    @Environment(\.clientDestination) private var clientDestination
#endif
    @Binding var symbolInput: String
    @Binding var localDraft: LocalDecisionDraft?
    @Binding var selectedTab: AnnualRingsTab
    @Binding var globalToolSheet: GlobalToolSheet?
    let refreshRevision: UInt64; let openMarket: (String) -> Void; let openResearchOnboarding: (String) -> Void; let openResearchCandidate: (TodayCandidateNavigationTarget) -> Void
    @State var context: PortfolioDecisionContextEnvelope?
    @State var message = "正在读取契约绑定的资产快照..."
    @State var isLoading = false
    @State var alphaEnvelope: AssetsAlphaEnvelope?
    @State var alphaMessage = "正在读取非官方本地 Alpha..."
    @State var isAlphaLoading = false
    @State var snapshotRequestId = UUID()
    @State var alphaRequestId = UUID()
    @State private var isAlphaWriting = false
    @State var researchNavigationRequestId = UUID()
    @State var researchNavigationMessage: String?
    @State private var researchImpactRequestId = UUID()
    @State private var researchWorkspace: FrozenResearchEvidenceWorkspace?
    @State private var researchImpactMessage = "正在读取最近研究判断..."
    @State private var portfolioMemberships: CandidateMembershipEnvelope?
    @State private var portfolioResearchWorkspaces: [String: FrozenResearchEvidenceWorkspace] = [:]
    @State private var isSnapshotEntryExpanded = false
    /// Figma 首屏只显示工具入口；完整来源与组合实验仍在展开层。
    @State private var isPortfolioToolsExpanded = false
    var body: some View {
#if OWNER_CLIENT
        assetsContent
#else
        NavigationStack { assetsContent }
#endif
    }

    private var assetsContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
#if !OWNER_CLIENT
                assetsFigmaHeader
#endif
#if OWNER_CLIENT
                clientAssetsSections
#else
                Text("当前研究标的 \(currentAssetSymbol) · 只读查看组合影响")
                    .font(OwnerReadingFont.caption.weight(.semibold))
                    .foregroundStyle(OwnerExperienceStyle.accent)
                    .accessibilityIdentifier("assetsSelectedResearchContext")
                if let researchNavigationMessage {
                    Text(researchNavigationMessage) .font(OwnerReadingFont.caption) .foregroundStyle(.secondary) .accessibilityIdentifier("assetsResearchNavigationMessage")
                }
                assetsSourceOverview
                assetsHoldingsSummary
                assetsFigmaRiskCard
                DisclosureGroup(isExpanded: $isPortfolioToolsExpanded) {
                    VStack(alignment: .leading, spacing: 12) {
                        assetsOwnerBrief
                        if needsSnapshotInput {
                            DisclosureGroup("录入非官方资产快照（手工 / CSV）", isExpanded: $isSnapshotEntryExpanded) {
                                manualSnapshotSection.padding(.top, 8)
                            }
                            .cardStyle(padding: 14)
                            .accessibilityIdentifier("assetsSnapshotEntry")
                            assetsMissingSnapshotSummary
                        } else {
                            assetsDecisionImpactCard
                        }
                        researchContinuityCard
                        authoritativeSnapshotSection
                        if !needsSnapshotInput {
                            AssetsPortfolioImpactCard(
                                selectedSymbol: currentAssetSymbol,
                                memberships: portfolioMemberships,
                                workspaces: portfolioResearchWorkspaces,
                                context: currentAuthoritativeContext,
                                fallbackSnapshot: alphaEnvelope?.latestSnapshot,
                                openResearch: { symbol in Task { await openExistingResearch(symbol) } }
                            )
                            AssetsPortfolioResearchScopeCard(
                                memberships: portfolioMemberships,
                                context: currentAuthoritativeContext,
                                fallbackSnapshot: alphaEnvelope?.latestSnapshot,
                                openResearch: { symbol in Task { await openExistingResearch(symbol) } }
                            )
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("补充资产快照（非官方）") .font(OwnerReadingFont.headline)
                                Spacer()
                                if isAlphaLoading { ProgressView() }
                            }
                            Text("仅用于缺少权威快照时的降级研究背景；不是实时持仓、交易日志或官方账户事实。") .font(OwnerReadingFont.caption) .foregroundStyle(.secondary) .accessibilityIdentifier("assetsAlphaBoundary")
                            DisclosureGroup("快照状态") {
                                VStack(alignment: .leading, spacing: 6) {
                                    if let alphaEnvelope {
                                        Text(alphaEnvelope.latestSnapshot == nil
                                             ? "尚无本地快照"
                                             : "更新 \(alphaEnvelope.generatedAt) · 资产快照已录入")
                                            .accessibilityIdentifier("assetsAlphaIdentity")
                                    }
                                    Text(alphaMessage) .accessibilityIdentifier("assetsAlphaMessage")
                                    Button("重新读取") { Task { await loadAssetsAlpha() } } .buttonStyle(.bordered) .disabled(isAlphaLoading || isAlphaWriting)
                                } .padding(.top, 6) .font(OwnerReadingFont.caption) .foregroundStyle(.secondary)
                            }
                            historicalTradeNotesSection
                        }
                        .cardStyle(padding: 14)
                        if !needsSnapshotInput { manualSnapshotSection }
                    }
                    .padding(.top, 8)
                } label: {
                    Label("组合研究工具 · 3", systemImage: "square.stack.3d.up")
                        .font(OwnerReadingFont.headline)
                }
                .cardStyle(padding: 14)
                .accessibilityIdentifier("assetsPortfolioToolsDisclosure")
#endif
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollDismissesKeyboard(.interactively)
        .ownerPageBackground()
        .safeAreaPadding(.bottom, 72)
#if !OWNER_CLIENT
        .toolbar(.hidden, for: .navigationBar)
#endif
        .task(id: refreshRevision) { await load() }
        .task(id: refreshRevision) { await loadAssetsAlpha() }
        .task(id: "\(refreshRevision):\(currentAssetSymbol):\(selectedTab.rawValue)") {
            await loadResearchImpact()
        }
        .onChange(of: selectedTab) { _, tab in
            if tab != .assets {
                researchNavigationRequestId = UUID()
                researchImpactRequestId = UUID()
                researchWorkspace = nil
                portfolioMemberships = nil
                portfolioResearchWorkspaces = [:]
                researchNavigationMessage = nil
            }
        }
        .accessibilityIdentifier("assetsRoot")
#if OWNER_CLIENT
        .onAppear { isPortfolioToolsExpanded = true }
#endif
    }

#if OWNER_CLIENT
    @ViewBuilder private var clientAssetsSections: some View {
        switch clientDestination {
        case .assetPortfolio:
            ClientCard(title: "组合影响", icon: "chart.pie", tone: Theme.green) {
                assetsFigmaRiskCard
                researchContinuityCard
            }
            ClientCard(title: "研究关联", icon: "link", tone: Theme.purple) {
                AssetsPortfolioImpactCard(selectedSymbol: currentAssetSymbol, memberships: portfolioMemberships,
                    workspaces: portfolioResearchWorkspaces, context: currentAuthoritativeContext,
                    fallbackSnapshot: alphaEnvelope?.latestSnapshot,
                    openResearch: { symbol in Task { await openExistingResearch(symbol) } })
                AssetsPortfolioResearchScopeCard(memberships: portfolioMemberships, context: currentAuthoritativeContext,
                    fallbackSnapshot: alphaEnvelope?.latestSnapshot,
                    openResearch: { symbol in Task { await openExistingResearch(symbol) } })
            }
        case .assetNotes:
            ClientCard(title: "历史成交备注", icon: "clock", tone: Theme.green) { historicalTradeNotesSection }
        default:
            assetsSourceOverview
            assetsHoldingsSummary
            ClientCard(title: "资产来源与时点", icon: "externaldrive", tone: Theme.green) {
                authoritativeSnapshotSection
            }
            ClientCard(title: "补充非官方快照", icon: "doc.badge.plus", tone: Theme.green) {
                Text(alphaMessage).font(OwnerReadingFont.caption)
                NavigationLink { ClientReadingPage(title: "录入资产快照") { manualSnapshotSection } }
                    label: { ClientLinkLabel(title: "手工或 CSV 录入", subtitle: "保存前核对来源、日期与持仓", icon: "plus", tone: Theme.green) }
                    .buttonStyle(.plain)
                Button("重新读取") { Task { await loadAssetsAlpha() } }
                    .disabled(isAlphaLoading || isAlphaWriting)
            }
        }
    }
#endif

    private var assetsFigmaHeader: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("资产")
                    .font(.system(size: 26, weight: .bold, design: .serif))
                    .foregroundStyle(OwnerExperienceStyle.textPrimary)
                Text("快照 · 暴露 · 集中度")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(OwnerExperienceStyle.textTertiary)
            }
            Spacer(minLength: 8)
            MakeV9ThemeToggleButton()
        }
        .frame(height: 54)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("资产，只读 / Advisory Only")
    }
    private var assetsFigmaRiskCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("组合风险")
                    .font(OwnerReadingFont.headline)
                Spacer(minLength: 8)
                Text("基于当前快照")
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(OwnerExperienceStyle.textSecondary)
            }
            HStack(spacing: 8) {
                assetsFigmaRiskMetric("集中度", assetsConcentrationSummary)
                assetsFigmaRiskMetric("单股暴露", assetsExposureSummary)
                assetsFigmaRiskMetric("新鲜度", assetsFigmaFreshness)
            }
        }
        .cardStyle(padding: 14)
        .accessibilityIdentifier("assetsFigmaRiskCard")
    }
    private func assetsFigmaRiskMetric(_ title: String, _ value: String) -> some View {
        VStack(spacing: 4) {
            Text(title)
                .font(OwnerReadingFont.caption2)
                .foregroundStyle(OwnerExperienceStyle.textSecondary)
            Text(value)
                .font(OwnerReadingFont.caption.weight(.semibold))
                .foregroundStyle(value.contains("待") || value.contains("不可") ? OwnerExperienceStyle.warning : OwnerExperienceStyle.textPrimary)
                .lineLimit(3)
                .minimumScaleFactor(0.72)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 66)
        .padding(.horizontal, 6)
        .background(OwnerExperienceStyle.softBackground, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
    private var assetsFigmaFreshness: String {
        if let snapshot = alphaEnvelope?.latestSnapshot {
            return snapshot.isStale() == true ? "已陈旧" : "当前可用"
        }
        if currentAuthoritativeContext != nil { return "已连接" }
        return "待补齐"
    }
    var assetsAlphaClient: AssetsAlphaClient {
        let auth = AppEnvironment.researchAuthorizationContext()
        return AssetsAlphaClient(
            baseURL: auth.baseURL,
            readToken: auth.readToken,
            readHeaderName: auth.readHeaderName,
            writeToken: auth.writeToken,
            writeHeaderName: auth.writeHeaderName
        )
    }
    private var canShowContext: Bool {
        guard let status = context?.status else { return false }
        return Self.isDisplayable(status)
    }
    private var hasCurrentAuthoritativeContext: Bool {
        context?.status == .available || context?.status == .zeroPosition
    }
    private var currentAuthoritativeContext: PortfolioDecisionContextEnvelope? {
        hasCurrentAuthoritativeContext ? context : nil
    }
    private var needsSnapshotInput: Bool {
        !hasCurrentAuthoritativeContext && alphaEnvelope?.latestSnapshot == nil
    }
    private var manualSnapshotSection: some View {
        AssetsManualSnapshotSection(
            envelope: $alphaEnvelope,
            client: assetsAlphaClient,
            readIsBusy: isAlphaLoading,
            writeIsBusy: $isAlphaWriting,
            focusSymbol: currentAssetSymbol,
            openMarket: openMarket,
            openResearch: { symbol in Task { await openExistingResearch(symbol) } }
        )
    }
    private var statusLabel: String {
        context.map { $0.status.userLabel } ?? "未连接"
    }
    var currentAssetSymbol: String { SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical ?? "未选择有效港股" }
    private var authoritativeSnapshotSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            if canShowContext, let context {
                assetsSnapshotContext(context)
            } else if let localSnapshot = alphaEnvelope?.latestSnapshot {
                Text("平安快照当前不可用；本地非官方快照仍可读取，时点 \(localSnapshot.asOf)，不代表当前持仓。")
                    .font(OwnerReadingFont.callout.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                DisclosureGroup("为什么没有显示持仓") {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(message)
                            .accessibilityIdentifier("assetsStatusMessage")
                        Text("状态：\(statusLabel)。系统不会把样本、迁移、研究或陈旧持仓当成真实资产。")
                            .accessibilityIdentifier("assetsFailClosedBoundary")
                    }
                    .padding(.top, 6)
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(.secondary)
                }
            } else {
                Text("尚未连接可验证的平安资产快照")
                    .font(OwnerReadingFont.title3.weight(.semibold))
                Text("这不会阻止 \(currentAssetSymbol) 单股研究。你仍可在下方建立非官方降级快照。")
                    .foregroundStyle(.secondary)
                DisclosureGroup("为什么没有显示持仓") {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(message)
                            .accessibilityIdentifier("assetsStatusMessage")
                        Text("状态：\(statusLabel)。系统不会把样本、迁移、研究或陈旧持仓当成真实资产。")
                            .accessibilityIdentifier("assetsFailClosedBoundary")
                    }
                    .padding(.top, 6)
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(.secondary)
                }
            }
            Button("重新读取") {
                Task { await load() }
            }
            .buttonStyle(.bordered)
            .disabled(isLoading)
        }
        .cardStyle(padding: 14)
    }
    @ViewBuilder
    private var assetsSourceOverview: some View {
        if hasCurrentAuthoritativeContext, let context {
            sourceOverviewCard(title: "你授权的当前来源 · \(context.sourceDisplayName)", status: authoritativeStatus(context), color: .green, detail: "本地试用版账户范围事实；持仓 \(context.positions.count) 只 · 截止 \(context.sourceAsOf ?? context.portfolioAsOf ?? "待核对")。")
        } else if let snapshot = alphaEnvelope?.latestSnapshot {
            sourceOverviewCard(title: snapshot.source.displayName, status: localSnapshotStatus(snapshot), color: snapshot.isStale() == false ? .blue : .orange, detail: "本地试用快照 · 持仓 \(snapshot.positions.count) 只\(localSnapshotTotalSummary(snapshot)) · 截至 \(snapshot.asOf)；不会替代券商真实持仓。")
        } else if canShowContext, let context {
            sourceOverviewCard(title: "\(context.sourceDisplayName) · 不可作为当前事实", status: authoritativeStatus(context), color: .orange, detail: "截至 \(context.sourceAsOf ?? context.portfolioAsOf ?? "待核对")；仅供回看，当前组合影响暂不能判断。")
        } else {
            sourceOverviewCard(title: "尚未录入资产快照", status: "待维护", color: .orange, detail: "下方可导入 CSV，或手工填写代码、数量、金额和快照时间。")
        }
    }
    /// V2：来源摘要下方直接可见的持仓行；数值只用来源原值，缺失保持缺失。
    @ViewBuilder
    private var assetsHoldingsSummary: some View {
        if let context = currentAuthoritativeContext {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text("当前持仓").font(OwnerReadingFont.headline)
                    Spacer()
                    Text("\(context.sourceDisplayName) · 截至 \(context.sourceAsOf ?? context.portfolioAsOf ?? "时间待核对")")
                        .font(OwnerReadingFont.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("assetsHoldingsSource")
                if context.positions.isEmpty {
                    Text("该来源确认当前股票持仓为 0。").font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(context.positions, id: \.sourceRowId) { position in
                        assetsHoldingRow(
                            symbol: position.symbol,
                            name: position.name,
                            quantity: position.quantity,
                            valueText: position.marketValue.map { "\(position.currency ?? "币种未提供") \(assetsNumber($0))" } ?? "市值待补齐",
                            weightText: position.marketWeight.map { "占已知股票市值 \(assetsPercent($0))" }
                        )
                    }
                }
                Text("只读查看；数量与市值为来源原值，缺失保持缺失，不会写入或修改资产。")
                    .font(OwnerReadingFont.caption2)
                    .foregroundStyle(.secondary)
            }
            .cardStyle(padding: 12)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("assetsHoldings")
        } else if let snapshot = alphaEnvelope?.latestSnapshot {
            let freshness = snapshot.isStale() == true ? "已陈旧" : snapshot.isStale() == false ? "录入不足 24 小时" : "时间待核对"
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text(AppEnvironment.isExperienceSession ? "体验样本持仓" : "快照持仓").font(OwnerReadingFont.headline)
                    Spacer()
                    Text("\(snapshot.source.displayName) · 截至 \(snapshot.asOf)")
                        .font(OwnerReadingFont.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("assetsHoldingsSource")
                if snapshot.positions.isEmpty {
                    Text("这份快照未记录股票持仓。").font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(snapshot.positions) { position in
                        assetsHoldingRow(
                            symbol: position.symbol,
                            name: nil,
                            quantity: position.quantity,
                            valueText: position.marketValueHkd.map { "HKD \(assetsNumber($0))" } ?? "市值待补齐",
                            weightText: nil
                        )
                    }
                }
                Text("\(freshness) · 本地非官方快照仅保留可读，不代表当前持仓；不会写入或修改资产。")
                    .font(OwnerReadingFont.caption2)
                    .foregroundStyle(.secondary)
            }
            .cardStyle(padding: 12)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("assetsHoldings")
        }
    }

    private func assetsHoldingRow(symbol: String, name: String?, quantity: Double, valueText: String, weightText: String?) -> some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(symbol)
                    .font(OwnerReadingFont.callout.weight(.semibold).monospacedDigit())
                    .foregroundStyle(symbol == currentAssetSymbol ? OwnerExperienceStyle.accent : OwnerExperienceStyle.textPrimary)
                if let name {
                    Text(name).font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                }
                Text("\(assetsNumber(quantity)) 股")
                    .font(OwnerReadingFont.caption.monospacedDigit())
                    .foregroundStyle(OwnerExperienceStyle.textSecondary)
                    .accessibilityIdentifier("assetsHoldingQuantity-\(symbol)")
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(valueText)
                    .font(OwnerReadingFont.callout.weight(.semibold).monospacedDigit())
                    .accessibilityIdentifier("assetsHoldingValue-\(symbol)")
                if let weightText {
                    Text(weightText).font(OwnerReadingFont.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            Button { Task { await openExistingResearch(symbol) } } label: {
                Image(systemName: "doc.text.magnifyingglass")
                    .font(OwnerReadingFont.body)
                    .frame(width: 34, height: 44)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("打开 \(symbol) 研究")
            .accessibilityIdentifier("assetsHoldingResearch-\(symbol)")
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("assetsHoldingRow-\(symbol)")
    }

    /// 只在现金与全部市值齐备时给出非官方总资产；缺口保持 UNKNOWN 文案，不按 0 计算。
    private func localSnapshotTotalSummary(_ snapshot: AssetsAlphaSnapshot) -> String {
        guard let total = snapshot.completeTotalAssetsHkd else { return " · 总资产待补齐（现金或市值未齐）" }
        return " · 非官方总资产 HKD \(assetsNumber(total))"
    }
    private var researchContinuityCard: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("\(currentAssetSymbol) 单股研究始终可继续") .font(OwnerReadingFont.callout.weight(.semibold))
            Text("资产快照只补充组合背景；没有权威持仓、现金缺失或快照陈旧，都不会关闭单股研究。") .font(OwnerReadingFont.caption) .foregroundStyle(.secondary)
            Button { Task { await openExistingResearch(currentAssetSymbol) } } label: {
                Label("继续 \(currentAssetSymbol) 个股研究", systemImage: "doc.text.magnifyingglass").frame(maxWidth: .infinity, minHeight: 36)
            }
            .buttonStyle(.borderedProminent)
            .disabled(SecuritySymbol.parseHongKongAlias(symbolInput) == nil)
            .accessibilityIdentifier("assetsOpenResearch-\(currentAssetSymbol)")
            if hasCurrentAuthoritativeContext {
                Button { Task { await openExistingResearch(currentAssetSymbol, opensPortfolioLab: true) } } label: {
                    Label("查看 \(currentAssetSymbol) 组合影响", systemImage: "chart.pie").frame(maxWidth: .infinity, minHeight: 36)
                }
                .buttonStyle(.bordered)
                .disabled(SecuritySymbol.parseHongKongAlias(symbolInput) == nil)
                .accessibilityIdentifier("assetsOpenPortfolioImpact")
            }
            if context?.status == .available, context?.positions.contains(where: { $0.symbol == currentAssetSymbol }) == true {
                Button { Task { await openExistingResearch(currentAssetSymbol, opensHoldingLogicCapture: true, opensPortfolioLab: false) } } label: {
                    Label("记录 \(currentAssetSymbol) 持仓逻辑变化", systemImage: "square.and.pencil").frame(maxWidth: .infinity, minHeight: 36)
                }.buttonStyle(.bordered).accessibilityIdentifier("assetsOpenHoldingLogicCapture")
            }
        }
        .cardStyle(padding: 12)
        .accessibilityIdentifier("assetsResearchContinuity")
    }
    private var assetsMissingSnapshotSummary: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle("\(currentAssetSymbol) 组合影响")
            Text("尚未录入资产快照")
                .font(OwnerReadingFont.title3.weight(.semibold))
            Text("因此现在不能计算暴露、集中度、最大组合风险，或把研究结论换算成组合影响；这些字段不会猜测。")
                .font(OwnerReadingFont.callout)
            Text(confirmedResearchReport == nil
                 ? "当前股票的正式研究判断尚未确认；真实周线与来源核验仍可在 Research 继续。"
                 : "当前股票的已确认研究判断仍可回看；缺少资产快照只影响组合解释。")
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
            Text("唯一下一步：录入一份手工或 CSV 非官方快照。它只用于个人研究，不会修改官方资产。")
                .font(OwnerReadingFont.callout.weight(.semibold))
            Button("录入资产快照") {
                isSnapshotEntryExpanded = true
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("assetsMissingSnapshotAction")
        }
        .cardStyle(padding: 12)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(currentAssetSymbol) 组合影响；尚未录入资产快照；不能计算暴露、集中度、最大组合风险或组合传导；单股研究可以继续")
        .accessibilityIdentifier("assetsMissingSnapshotSummary")
    }
    private var assetsOwnerBrief: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle("组合判断")
            InfoBlock(title: "暴露", value: assetsExposureSummary)
                .accessibilityIdentifier("assetsOwnerExposure")
            InfoBlock(title: "集中度", value: assetsConcentrationSummary)
                .accessibilityIdentifier("assetsOwnerConcentration")
            InfoBlock(title: "最大组合风险", value: assetsMaximumRiskSummary)
                .accessibilityIdentifier("assetsOwnerMaximumRisk")
            InfoBlock(title: "研究结论影响", value: assetsResearchPortfolioImpact)
                .accessibilityIdentifier("assetsOwnerResearchImpact")
            Text(assetsOwnerBriefIdentity)
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("assetsOwnerBriefIdentity")
        }
        .cardStyle(padding: 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("assetsOwnerBrief")
    }
    private var assetsOwnerBriefIdentity: String {
        if let context = currentAuthoritativeContext {
            return "\(context.sourceDisplayName) · 截至 \(context.sourceAsOf ?? context.portfolioAsOf ?? "时间待核对")；现金与非股票资产按来源限制说明。"
        }
        if let snapshot = alphaEnvelope?.latestSnapshot {
            let freshness = snapshot.isStale()
                .map { $0 ? "已陈旧" : "时间新近" }
                ?? "时间待核对"
            return "非官方\(snapshot.source.displayName)快照 · \(freshness) · 截至 \(snapshot.asOf)；只用于研究，不会修改官方资产。"
        }
        if let context, Self.isDisplayable(context.status) {
            let state = context.status == .stale ? "已陈旧" : "不完整"
            return "\(context.sourceDisplayName)\(state) · 截至 \(context.sourceAsOf ?? context.portfolioAsOf ?? "时间待核对")；未用于当前组合计算。"
        }
        return "资产快照暂不可用；不把缺失当作零持仓，单股研究仍可继续。"
    }
    @ViewBuilder
    private var assetsDecisionImpactCard: some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionTitle("\(currentAssetSymbol) 组合影响")
            InfoBlock(title: "暴露", value: assetsExposureSummary)
                .accessibilityIdentifier("assetsExposureSummary")
            InfoBlock(title: "集中度", value: assetsConcentrationSummary)
                .accessibilityIdentifier("assetsConcentrationSummary")
            InfoBlock(title: "最大组合风险", value: assetsMaximumRiskSummary)
                .accessibilityIdentifier("assetsMaximumRiskSummary")
            Divider()
            InfoBlock(title: "研究判断", value: assetsResearchJudgment)
                .accessibilityIdentifier("assetsResearchJudgment")
            InfoBlock(title: "对组合的影响", value: assetsResearchPortfolioImpact)
                .accessibilityIdentifier("assetsResearchPortfolioImpact")
            Text(researchImpactMessage)
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
            if let report = researchWorkspace?.data?.latestReport {
                DisclosureGroup("判断来源") {
                    Text(researchSourceSummary(report))
                        .font(OwnerReadingFont.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                }
            }
        }
        .cardStyle(padding: 12)
        .accessibilityIdentifier("assetsDecisionImpact")
    }
    private var assetsExposureSummary: String {
        if hasCurrentAuthoritativeContext, let context {
            if context.status == .zeroPosition { return "0% · 权威快照确认零股票持仓。" }
            guard let exposure = context.positions.first(where: { $0.symbol == currentAssetSymbol })?.marketWeight else {
                return "权威快照没有该股票记录；不推断为零持仓。"
            }
            return "\(assetsPercent(exposure)) · 占已知股票市值；现金未提供，不是总资产暴露。"
        }
        if let snapshot = alphaEnvelope?.latestSnapshot {
            guard snapshot.isStale() == false else { return "非官方快照已陈旧或时间无法核对；暂不计算暴露。" }
            if snapshot.positions.isEmpty { return "0% · 非官方快照明确记录零股票持仓。" }
            guard let exposure = snapshot.completeAssetExposure(for: currentAssetSymbol) else {
                return "非官方快照未补齐现金、全部市值或该股票；暂不计算暴露。"
            }
            return "\(assetsPercent(exposure)) · 非官方总资产暴露。"
        }
        return "没有可验证的当前资产快照；不会猜测为零持仓。"
    }
    private var assetsConcentrationSummary: String {
        if hasCurrentAuthoritativeContext, let context {
            if context.status == .zeroPosition { return "无股票持仓。" }
            let concentration = context.summary.concentration
            guard concentration.status == .available else { return "当前快照不足以计算集中度；暂不下结论。" }
            return assetsConcentration(concentration)
        }
        if let snapshot = alphaEnvelope?.latestSnapshot, snapshot.isStale() == false {
            if snapshot.positions.isEmpty { return "无股票持仓 · 非官方快照。" }
            guard let summary = snapshot.completeMarketValueSummary else { return "非官方快照未补齐全部持仓市值；暂不计算集中度。" }
            return "最大 \(assetsPercent(summary.largestWeight)) · 前三 \(assetsPercent(summary.topThreeWeight)) · 集中度指数 \(assetsNumber(summary.hhi)) · 非官方"
        }
        return "没有可验证的当前组合；暂不计算集中度。"
    }
    private var assetsMaximumRiskSummary: String {
        if hasCurrentAuthoritativeContext, let context {
            if context.status == .zeroPosition { return "股票持仓为 0；现金及其他资产风险仍待来源确认。" }
            guard context.summary.concentration.status == .available,
                  let largest = context.summary.concentration.largestPositionWeight else {
                return "当前快照不足以识别最大风险；暂不下结论。"
            }
            return "目前可识别的最大组合风险是集中度：最大单一持仓占已知股票市值 \(assetsPercent(largest))；风险贡献与压力情景尚未计算。"
        }
        if let snapshot = alphaEnvelope?.latestSnapshot, snapshot.isStale() == false {
            if snapshot.positions.isEmpty { return "股票持仓为 0 · 非官方；现金及其他资产风险仍待来源确认。" }
            guard let largest = snapshot.completeMarketValueSummary?.largestWeight else {
                return "非官方快照未补齐全部持仓市值；暂不识别最大风险。"
            }
            return "目前可识别的最大组合风险是集中度：最大单一持仓占股票市值 \(assetsPercent(largest)) · 非官方；风险贡献与压力情景尚未计算。"
        }
        return "没有可验证的当前组合，不能识别最大持仓或风险贡献。"
    }
    private var confirmedResearchReport: TwoLayerReportData? {
        guard let data = researchWorkspace?.data,
              data.target.symbol == currentAssetSymbol,
              let report = data.latestReport,
              data.userDecision?.reportId == report.id,
              data.userDecision?.decision == "confirmed" else { return nil }
        return report
    }
    private var assetsResearchJudgment: String {
        guard let report = confirmedResearchReport else {
            return "没有读取到你已确认的该股票研究判断。"
        }
        let judgment = report.payload.adviceLayer?.conclusion
            ?? report.payload.investmentThesis
        guard !judgment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return "你已确认的历史报告没有可读投资判断。"
        }
        return researchReportIsStale(report)
            ? "历史判断（已过适用期）：\(judgment)"
            : judgment
    }
    private var assetsResearchPortfolioImpact: String {
        guard let report = confirmedResearchReport else {
            return "没有可绑定的已确认研究判断，不生成组合动作。"
        }
        if !hasCurrentAuthoritativeContext, alphaEnvelope?.latestSnapshot == nil {
            return "没有可验证的当前组合；研究判断不会转换成金额、目标仓位或动作。"
        }
        if researchReportIsStale(report) {
            return "研究判断已过适用期；先复核新事实，再由你明确决定是否影响组合。"
        }
        if hasCurrentAuthoritativeContext {
            guard context?.positions.contains(where: { $0.symbol == currentAssetSymbol }) == true else {
                return "官方快照没有该股票记录；不推断为零持仓或无影响。"
            }
            return "该判断适用于上方已知官方暴露；不会自动改变资产，任何正式动作仍由你明确决定。"
        }
        guard alphaEnvelope?.latestSnapshot?.isStale() == false else {
            return "非官方资产快照已陈旧；先更新快照，再判断研究结论影响。"
        }
        guard alphaEnvelope?.latestSnapshot?.positions.contains(where: { $0.symbol == currentAssetSymbol }) == true else {
            return "非官方快照没有该股票记录；不推断为零持仓或无影响。"
        }
        return "该判断适用于上方非官方快照中的已知暴露；不会自动改变资产，任何正式动作仍由你明确决定。"
    }
    private func researchReportIsStale(_ report: TwoLayerReportData) -> Bool {
        guard researchWorkspace?.isFreshForCurrentResearch == true,
              report.isCurrentExact else { return true }
        guard let value = report.payload.adviceLayer?.applicableUntil,
              let applicableUntil = parseInstant(value) else { return true }
        return applicableUntil <= Date()
    }
    private func researchSourceSummary(_ report: TwoLayerReportData) -> String {
        let validity = report.payload.adviceLayer.map { "适用至 \($0.applicableUntil.prefix(10))" }
            ?? "研究截止 \(report.payload.cutoffAt.prefix(10)) · 历史格式"
        return "报告 v\(report.version) · \(validity) · 只读研究记录，不会自动修改资产。"
    }
    private func sourceOverviewCard(title: String, status: String, color: Color, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(title) .font(OwnerReadingFont.callout.weight(.semibold))
                Spacer()
                Text(status) .font(OwnerReadingFont.caption.weight(.bold)) .foregroundStyle(color)
            }
            Text(detail) .font(OwnerReadingFont.caption) .foregroundStyle(.secondary)
        } .cardStyle(padding: 12) .accessibilityIdentifier("assetsSourceOverview")
    }
    private func authoritativeStatus(_ context: PortfolioDecisionContextEnvelope) -> String {
        switch context.status {
        case .stale: "陈旧"
        case .partial: "不完整"
        case .available: "可用"
        case .zeroPosition: "已确认零持仓"
        case .empty, .conflict, .unauthorized, .unavailable: "不可用"
        }
    }
    private func localSnapshotStatus(_ snapshot: AssetsAlphaSnapshot) -> String {
        guard let isStale = snapshot.isStale() else { return "时间待核对" }
        return isStale ? "陈旧（超过 24 小时）" : "手工新近（24 小时内，非实时）"
    }
    @MainActor
    private func loadResearchImpact() async {
        guard selectedTab == .assets else { return }
        guard let parsedSymbol = SecuritySymbol.parseHongKongAlias(symbolInput) else {
            researchNavigationMessage = nil
            researchWorkspace = nil
            portfolioMemberships = nil
            portfolioResearchWorkspaces = [:]
            researchImpactMessage = "当前标的代码无效；未读取资产或研究事实。"
            return
        }
        let symbol = parsedSymbol.canonical
        researchNavigationMessage = nil
        let auth = AppEnvironment.researchAuthorizationContext()
        let requestId = UUID()
        researchImpactRequestId = requestId
        researchWorkspace = nil
        portfolioMemberships = nil
        portfolioResearchWorkspaces = [:]
        researchImpactMessage = "正在读取 \(symbol) 最近研究判断..."
        let client = ResearchClient(
            baseURL: auth.baseURL,
            authToken: auth.readToken,
            authHeaderName: auth.readHeaderName
        )
        let memberships = await client.fetchCandidateMemberships(includeArchived: true)
        guard researchImpactRequestId == requestId,
              selectedTab == .assets,
              currentAssetSymbol == symbol,
              AppEnvironment.researchAuthorizationContext() == auth else { return }
        portfolioMemberships = memberships
        let matches = memberships.memberships.filter { $0.symbol == symbol && $0.state != .archived }
        guard memberships.status == .available else {
            researchImpactMessage = "没有读取到该股票唯一有效的研究记录；旧股票判断已清除。"
            return
        }
        var requested = memberships.memberships.filter { $0.state == .tracked }
        if let current = matches.first, !requested.contains(where: { $0.id == current.id }) {
            requested.append(current)
        }
        let loaded = await withTaskGroup(
            of: (String, FrozenResearchEvidenceWorkspace?).self,
            returning: [String: FrozenResearchEvidenceWorkspace].self
        ) { group in
            for membership in requested {
                group.addTask {
                    (membership.id, try? await client.fetchFrozenResearchEvidence(membership: membership))
                }
            }
            var results: [String: FrozenResearchEvidenceWorkspace] = [:]
            for await (membershipId, workspace) in group {
                if let workspace { results[membershipId] = workspace }
            }
            return results
        }
        guard researchImpactRequestId == requestId,
              selectedTab == .assets,
              currentAssetSymbol == symbol,
              AppEnvironment.researchAuthorizationContext() == auth else { return }
        portfolioResearchWorkspaces = loaded
        guard matches.count == 1,
              let membership = matches.first,
              let workspace = loaded[membership.id] else {
            researchImpactMessage = "研究判断暂不可用；旧股票判断已清除。"
            return
        }
        researchWorkspace = workspace
        researchImpactMessage = workspace.data?.userDecision?.decision == "confirmed"
            ? "已读取你确认的研究判断；组合影响仍以当前资产事实为准。"
            : "最近研究判断尚未由你确认；不会转成组合动作。"
    }
}
