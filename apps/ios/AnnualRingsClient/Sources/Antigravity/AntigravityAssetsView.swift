import SwiftUI

struct AntigravityAssetsView: View {
    @ObservedObject var api = OwnerClientStore.shared
    @ObservedObject private var holdingsSession = OwnerCurrentHoldingsSession.shared
    @Environment(\.antigravityActions) private var actions
    var onNavigateToResearch: ((Int, Int) -> Void)? = nil
    @Binding var selectedStock: InvestmentDecisionDossier?
    @State private var showHoldingsEditor = false
    @State private var whyNoHoldingsExpanded: Bool = false
    
    init(
        onNavigateToResearch: ((Int, Int) -> Void)? = nil,
        selectedStock: Binding<InvestmentDecisionDossier?> = .constant(nil)
    ) {
        self.onNavigateToResearch = onNavigateToResearch
        self._selectedStock = selectedStock
    }
    
    private var boundProjection: PortfolioResearchContextResponse? {
        guard let snapshot = ownerSnapshot, let value = api.portfolioResearchContext,
              value.actorScope.actorId == api.assets?.requestedActorId,
              value.portfolioSource == "owner_current", value.portfolioFreshness == "AS_OF_RECORDED",
              value.portfolioSnapshotIdentity == "owner-current:\(snapshot.id):\(snapshot.sourceHash)",
              ["available", "empty"].contains(value.status), value.portfolioAsOf == snapshot.asOf,
              value.summary.totalHoldings == snapshot.positions.count,
              value.items.count == snapshot.positions.count,
              Set(value.items.map(\.id)).count == value.items.count,
              Set(value.items.map(\.symbol)) == Set(snapshot.positions.map(\.symbol)),
              value.items.allSatisfy({ $0.assetSnapshotIdentity == value.portfolioSnapshotIdentity && $0.assetAsOf == snapshot.asOf }) else { return nil }
        return value
    }
    private var valuationComplete: Bool {
        guard let value = boundProjection, value.status == "available", value.summary.valuationStatus == "AVAILABLE",
              let context = displayPortfolio, context.status == .available,
              context.portfolioSource == "owner_entered_current", context.portfolioSnapshotId == value.portfolioSnapshotIdentity,
              !value.items.isEmpty else { return false }
        guard value.items.allSatisfy({ item in
            guard let amount = item.positionValue, amount.isFinite, amount >= 0,
                  let weight = item.portfolioWeight, weight.isFinite, (0...1).contains(weight), item.positionCurrency == "HKD",
                  let recorded = ownerSnapshot?.positions.first(where: { $0.symbol == item.symbol }),
                  let position = context.positions.first(where: { $0.symbol == item.symbol && $0.quantity == recorded.quantity }),
                  position.marketValue == amount, position.marketWeight == weight else { return false }
            return true
        }) else { return false }
        return abs(value.items.compactMap(\.portfolioWeight).reduce(0,+) - 1) < 0.000001
    }
    private var reviewItems: [PortfolioResearchContextResponse.Item] {
        boundProjection?.items.filter { ["REVIEW_REQUIRED", "REVIEW_DUE"].contains($0.researchState) } ?? []
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("了解持仓，也了解背后的公司").font(.subheadline).foregroundStyle(Theme.textSecondary)
                HStack {
                    Text("已录入股票市值").font(.subheadline).foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Button(holdingsSession.pendingRequest == nil ? "管理记录" : "核对待确认保存") { showHoldingsEditor = true }
                        .font(.footnote).frame(minHeight: 44)
                }
                if holdingsSession.pendingRequest != nil {
                    Text("上次手工持仓保存结果待确认。返回编辑页可用原请求重试或回读；当前持仓暂不视为已更新。")
                        .font(.footnote).foregroundStyle(Theme.amber)
                }
                if let snapshot = ownerSnapshot {
                    HStack(alignment: .firstTextBaseline) {
                        Text(valuationComplete ? (boundProjection!.items.compactMap(\.positionValue).reduce(0,+)).formatted(.number.precision(.fractionLength(0))) : snapshot.positions.isEmpty ? "0" : "暂不可用")
                            .font(.largeTitle.weight(.medium)).monospacedDigit()
                        if valuationComplete || snapshot.positions.isEmpty { Text("港元").font(.footnote).foregroundStyle(Theme.textSecondary) }
                    }
                    Text("本人手动记录 · 持仓确认 \(holdingsTime(snapshot.asOf)) · \(cashSummary(snapshot))")
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                    if !valuationComplete && !snapshot.positions.isEmpty {
                        Text("报价或估值口径不完整，暂不显示合计市值和占比。")
                            .font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                    Divider()
                    Text("持仓公司").font(.headline)
                    if snapshot.positions.isEmpty { Text("本人已确认当前没有股票持仓。其他资产范围未包含在此记录中。").font(.body) }
                    ForEach(snapshot.positions) { position in
                        let item = boundProjection?.items.first { $0.symbol == position.symbol }
                        NavigationLink {
                            ClientPage(title: "持仓与研究影响") { holdingResearchImpact(symbol: position.symbol) }
                        } label: {
                            holdingOverviewRow(snapshot: snapshot, position: position, item: item)
                        }.buttonStyle(.plain).accessibilityIdentifier("ownerHoldingImpact-\(position.symbol)")
                        Divider()
                    }
                    NavigationLink { ClientPage(title: "持仓记录与行情") { currentHoldingsCard(snapshot) } } label: {
                        WorkspaceRowLabel(title: "数量、成本与报价来源", subtitle: "分别查看持仓确认时间和行情时间", icon: "list.bullet.rectangle")
                    }.buttonStyle(.plain)
                } else {
                    Text(api.loading ? "正在读取持仓记录…" : "尚未取得本人录入的持仓记录").font(.title3.bold())
                    Text("未取得记录不等于没有持仓，可以查看记录或重新读取。")
                        .font(.body).foregroundStyle(Theme.textSecondary)
                    WorkspacePrimaryButton(title: holdingsSession.pendingRequest == nil ? "管理持仓记录" : "核对待确认保存") { showHoldingsEditor = true }
                }
                Button { actions.workflow(.assetPortfolio) } label: {
                    WorkspaceRowLabel(title: "组合研究与解释", subtitle: "查看已有组合背景与可用条件", icon: "chart.pie")
                }.buttonStyle(.plain)
                if !reviewItems.isEmpty {
                    Text("\(reviewItems.count) 家持仓公司的研究需要复核").font(.headline)
                        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 14))
                    NavigationLink {
                        ClientPage(title: "待复核研究") {
                            ForEach(reviewItems) { item in
                                Button { openHolding(item, review: true) } label: {
                                    WorkspaceRowLabel(title: item.companyName ?? item.symbol, subtitle: holdingResearchLabel(item.researchState), icon: "clock")
                                }.disabled(!canOpenResearch(item)).buttonStyle(.plain)
                            }
                        }
                    } label: { WorkspaceRowLabel(title: "查看待复核研究", icon: "arrow.right") }.buttonStyle(.plain)
                }
                NavigationLink {
                    ClientPage(title: "其他记录与依据") {
                        officialSnapshotCard
                        localAlphaJournalCard
                        Button("历史成交备注") { actions.workflow(.assetNotes) }
                        DisclosureGroup("研究覆盖详情") {
                            PortfolioResearchContextView(projection: boundProjection, error: api.issues["portfolioResearch"],
                                canOpenResearch: canOpenResearch, openResearch: { openHolding($0, review: true) })
                        }
                        safetyBoundarySection
                    }
                } label: { WorkspaceRowLabel(title: "历史记录与其他资产资料", icon: "archivebox") }.buttonStyle(.plain)
            }.padding(.horizontal, 24).padding(.vertical, 12)
        }.background(Theme.bgPrimary.ignoresSafeArea())
            .navigationTitle("资产").navigationBarTitleDisplayMode(.large)
            .toolbar { WorkspaceTools() }
            .refreshable { await api.load(tab: .assets, symbol: api.currentSymbol) }
            .sheet(isPresented: $showHoldingsEditor) { OwnerCurrentHoldingsView() }
    }
    private func openHolding(_ item: PortfolioResearchContextResponse.Item, review: Bool) {
        guard canOpenResearch(item) else { return }
        api.selectSymbol(item.symbol)
        if item.researchState == "REVIEW_LOOP_NOT_ENABLED" { api.researchLoopFocusSymbol = item.symbol }
        actions.workflow(review && ["REVIEW_REQUIRED", "REVIEW_DUE"].contains(item.researchState) ? .researchReview : .templateHome)
    }
    private func openHoldingResearch(symbol: String) {
        if let item = boundProjection?.items.first(where: { $0.symbol == symbol }), canOpenResearch(item) {
            openHolding(item, review: ["REVIEW_REQUIRED", "REVIEW_DUE"].contains(item.researchState))
        } else {
            api.selectSymbol(symbol)
            let tracked = api.membershipEnvelope?.memberships.contains {
                $0.symbol == symbol && $0.state.rawValue == "tracked"
            } == true
            actions.workflow(tracked ? .templateHome : .manage)
        }
    }
    private func holdingResearchLabel(_ state: String?) -> String {
        switch state {
        case "CURRENT": "研究跟踪中"
        case "REVIEW_REQUIRED": "需要复核"
        case "REVIEW_DUE": "跟踪节点已到"
        case "REVIEW_LOOP_NOT_ENABLED": "持续跟踪未启用"
        case "ENDED": "原研究已结束"
        case nil: "研究状态尚未取得"
        default: "尚未加入研究"
        }
    }

    private var displayPortfolio: PortfolioDecisionContextEnvelope? {
        guard let context = api.templatePortfolio else { return nil }
        if context.portfolioSource == "owner_entered_current" {
            guard let snapshot = ownerSnapshot,
                  context.portfolioSnapshotId == "owner-current:\(snapshot.id):\(snapshot.sourceHash)" else { return nil }
        }
        return context
    }
    private var portfolioProvenance: DataProvenance {
        guard let context = displayPortfolio else { return .unavailable(reason: "读取中") }
        switch context.status {
        case .available, .zeroPosition:
            return .real(source: context.sourceDisplayName, freshness: .fresh, timestamp: context.sourceAsOf ?? context.assembledAt)
        case .stale, .partial:
            return .real(source: context.sourceDisplayName, freshness: context.status == .stale ? .stale : .incomplete, timestamp: context.sourceAsOf ?? context.assembledAt)
        default: return .unavailable(reason: context.status.rawValue)
        }
    }
    private var ownerSnapshot: AssetsAlphaSnapshot? { api.assets?.snapshots.first { $0.source == .ownerCurrent } }
    private func cashSummary(_ snapshot: AssetsAlphaSnapshot) -> String {
        snapshot.cashHkd.map { "另有现金记录 HKD \($0.formatted())" } ?? "现金未记录"
    }
    private func ownerPortfolio(_ snapshot: AssetsAlphaSnapshot) -> PortfolioDecisionContextEnvelope? {
        guard let context = displayPortfolio,
              context.portfolioSource == "owner_entered_current",
              context.portfolioSnapshotId == "owner-current:\(snapshot.id):\(snapshot.sourceHash)",
              context.portfolioAsOf == snapshot.asOf, context.sourceAsOf == snapshot.asOf else { return nil }
        return context
    }
    private func recordedCost(_ position: AssetsAlphaPosition) -> (total: Double, average: Double)? {
        guard let lots = position.costLots, !lots.isEmpty, position.quantity.isFinite, position.quantity > 0,
              lots.reduce(0, { $0 + $1.quantity }) == position.quantity else { return nil }
        let total = lots.reduce(0) { $0 + $1.quantity * $1.unitCostHkd }
        guard total.isFinite, total > 0 else { return nil }
        return (total, total / position.quantity)
    }
    private func ownerPortfolioPosition(_ position: AssetsAlphaPosition, snapshot: AssetsAlphaSnapshot) -> PortfolioDecisionPosition? {
        guard let context = ownerPortfolio(snapshot), [.available, .partial, .stale].contains(context.status) else { return nil }
        let matches = context.positions.filter {
            $0.symbol == position.symbol && $0.quantity == position.quantity && $0.currency == "HKD"
        }
        return matches.count == 1 ? matches.first : nil
    }
    private func valuedPosition(_ market: PortfolioDecisionPosition?) -> PortfolioDecisionPosition? {
        guard let market, [.current, .stale].contains(market.quote.status),
              market.quote.source == "futu", market.quote.quoteAsOf != nil,
              let value = market.marketValue, value.isFinite, value >= 0 else { return nil }
        return market
    }
    private func moneyText(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "暂不可用" }
        return "HKD \(value.formatted(.number.precision(.fractionLength(2))))"
    }
    @ViewBuilder
    private func holdingOverviewRow(snapshot: AssetsAlphaSnapshot, position: AssetsAlphaPosition,
                                    item: PortfolioResearchContextResponse.Item?) -> some View {
        let cost = recordedCost(position)
        let market = ownerPortfolioPosition(position, snapshot: snapshot)
        let valued = valuedPosition(market)
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text(item?.companyName ?? api.candidates.first(where: { $0.symbol == position.symbol })?.name ?? position.symbol).font(.body)
                    Text("\(position.symbol) · \(position.quantity.formatted()) 股").font(.footnote).foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                if valuationComplete, let weight = item?.portfolioWeight {
                    Text(weight.formatted(.percent.precision(.fractionLength(1)))).font(.body)
                }
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.textSecondary)
            }
            Text(cost.map { "记录成本：HKD \($0.average.formatted(.number.precision(.fractionLength(4)))) / 股 · 合计 \(moneyText($0.total))" }
                 ?? "记录成本：未提供")
                .font(.footnote).foregroundStyle(Theme.textSecondary)
            Text("股票市值：\(moneyText(valued?.marketValue)) · 浮动盈亏：\(moneyText(cost == nil ? nil : valued?.unrealizedPnl))")
                .font(.footnote).foregroundStyle(Theme.textSecondary)
            Text("行情：\(quoteStatus(market?.quote.status)) · \(holdingsTime(market?.quote.quoteAsOf))")
                .font(.caption).foregroundStyle(Theme.textTertiary)
            Text(holdingResearchLabel(item?.researchState)).font(.footnote).foregroundStyle(Theme.gold)
            if valuationComplete, let weight = item?.portfolioWeight {
                ProgressView(value: min(max(weight, 0), 1)).tint(Theme.gold)
            }
        }.frame(minHeight: 64).contentShape(Rectangle())
    }
    private func canOpenResearch(_ item: PortfolioResearchContextResponse.Item) -> Bool {
        guard let id = item.membershipId, let version = item.membershipVersion else { return false }
        return api.membershipEnvelope?.memberships.contains { $0.id == id && $0.version == version && $0.symbol == item.symbol && $0.state.rawValue == "tracked" } == true
    }
    private func currentHoldingsCard(_ snapshot: AssetsAlphaSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack {
                Text("本人当前持仓记录").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.textPrimary)
                Spacer()
                Button("手动修改") { showHoldingsEditor = true }
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.gold)
                    .accessibilityIdentifier("ownerHoldingsEdit")
            }
            Text("本人录入 · \(cashSummary(snapshot))").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            ForEach(snapshot.positions) { position in
                holdingCostQuoteCard(snapshot: snapshot, position: position)
            }
            if snapshot.positions.isEmpty { Text("本人已确认当前无股票持仓。").font(.system(size: 12)) }
            Text("持仓确认：\(holdingsTime(snapshot.asOf)) · 组合权重仅按已录入股票计算。")
                .font(.system(size: 10)).foregroundStyle(Theme.textTertiary)
        }
    }
    @ViewBuilder
    private func holdingCostQuoteCard(snapshot: AssetsAlphaSnapshot, position: AssetsAlphaPosition) -> some View {
        let cost = recordedCost(position)
        let market = ownerPortfolioPosition(position, snapshot: snapshot)
        let valued = valuedPosition(market)
        VStack(alignment: .leading, spacing: 10) {
            Text(position.symbol).font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
            HStack(spacing: 8) {
                metricCard(label: "持有股数", val: String(format: "%.0f", position.quantity), color: Theme.gold)
                metricCard(label: "加权成本 / HKD", val: cost.map { String(format: "%.4f", $0.average) } ?? "未记录", color: Theme.blue)
            }
            .accessibilityIdentifier("ownerHoldingsSummary-\(position.symbol)")
            if let lots = position.costLots {
                ForEach(Array(lots.enumerated()), id: \.offset) { index, lot in
                    HStack {
                        Text("第 \(index + 1) 笔 · \(lot.quantity, specifier: "%.0f") 股")
                        Spacer()
                        Text("HKD \(lot.unitCostHkd, specifier: "%.3f") / 股")
                    }.font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                }
            }
            Divider().overlay(Theme.border)
            HStack {
                Text("总成本"); Spacer(); Text(cost.map { moneyText($0.total) } ?? "未记录")
            }.font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.textPrimary)
            HStack(spacing: 8) {
                metricCard(label: "股票市值 / HKD", val: templateNumber(valued?.marketValue, format: "%.2f"), color: Theme.blue)
                metricCard(label: "浮动盈亏 / HKD", val: templateNumber(cost == nil ? nil : valued?.unrealizedPnl, format: "%.2f"),
                           color: cost == nil ? Theme.textSecondary
                             : valued?.unrealizedPnl.map { $0 >= 0 ? Theme.green : Theme.amber } ?? Theme.textSecondary)
            }
            Text("持仓确认：\(holdingsTime(snapshot.asOf))")
                .font(.system(size: 10)).foregroundStyle(Theme.textTertiary)
            Text("行情：\(quoteStatus(market?.quote.status)) · \(holdingsTime(market?.quote.quoteAsOf))")
                .font(.system(size: 10)).foregroundStyle(Theme.textTertiary)
            Button("进入这家公司的研究") { openHoldingResearch(symbol: position.symbol) }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("ownerHoldingDetailOpenResearch-\(position.symbol)")
        }.padding(14).templateCardStyle()
    }
    @ViewBuilder
    private func holdingCostQuoteDetail(symbol: String) -> some View {
        if let snapshot = ownerSnapshot,
           let position = snapshot.positions.first(where: { $0.symbol == symbol }) {
            holdingCostQuoteCard(snapshot: snapshot, position: position)
        } else {
            ContentUnavailableView("持仓版本已变化", systemImage: "arrow.clockwise",
                                   description: Text("请返回资产页重新读取当前记录。"))
        }
    }
    @ViewBuilder
    private func holdingResearchImpact(symbol: String) -> some View {
        if let snapshot = ownerSnapshot,
           let position = snapshot.positions.first(where: { $0.symbol == symbol }) {
            let item = boundProjection?.items.first { $0.symbol == symbol }
            let cost = recordedCost(position)
            let market = ownerPortfolioPosition(position, snapshot: snapshot)
            let valued = valuedPosition(market)
            VStack(alignment: .leading, spacing: 14) {
                Text("\(symbol) · \(position.quantity.formatted()) 股")
                    .font(.headline)
                Text("本人确认持仓：\(holdingsTime(snapshot.asOf)) · 记录成本 \(cost.map { moneyText($0.total) } ?? "未记录")")
                    .font(.footnote).foregroundStyle(Theme.textSecondary)
                Text("股票市值：\(moneyText(valued?.marketValue)) · 浮动盈亏：\(moneyText(cost == nil ? nil : valued?.unrealizedPnl))")
                    .font(.footnote).foregroundStyle(Theme.textSecondary)
                Text("行情：\(quoteStatus(market?.quote.status)) · \(holdingsTime(market?.quote.quoteAsOf))")
                    .font(.footnote).foregroundStyle(Theme.textSecondary)
                NavigationLink {
                    ClientPage(title: "成本与行情详情") { holdingCostQuoteDetail(symbol: symbol) }
                } label: {
                    WorkspaceRowLabel(title: "查看逐笔成本与行情来源", icon: "list.bullet.rectangle")
                }.buttonStyle(.plain).accessibilityIdentifier("ownerHoldingCostQuote-\(symbol)")
                if let item {
                    Text("研究状态：\(holdingResearchLabel(item.researchState))")
                        .font(.callout.weight(.semibold))
                    if let base = item.currentBaseStatus {
                        Text("研究基线：\(base == "COMPLETE" ? "已记录" : base == "REVIEW_REQUIRED" ? "需要复核" : "尚未完整")")
                            .font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                    if let milestone = item.activeMilestone {
                        Text("下一验证：\(milestone.description)\(milestone.targetDate.map { " · \($0)" } ?? "")")
                            .font(.footnote).foregroundStyle(Theme.textSecondary)
                    } else {
                        Text("下一验证：尚未记录")
                            .font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                    if let reviewedAt = item.latestReviewAt {
                        Text("最近研究复核：\(holdingsTime(reviewedAt))")
                            .font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                    if !valuationComplete { Text("组合合计与占比暂不可用；此公司可用的单项数值仍单独显示。")
                        .font(.footnote).foregroundStyle(Theme.textSecondary) }
                    ForEach(item.limitations, id: \.self) { limitation in
                        Text(limitation).font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                } else {
                    Text(api.issues["portfolioResearch"] ?? "研究状态尚未取得；持仓记录仍可查看。")
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                }
                Button("进入这家公司的研究") { openHoldingResearch(symbol: symbol) }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("ownerHoldingOpenResearch-\(symbol)")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("ownerHoldingResearchImpact-\(symbol)")
        } else {
            ContentUnavailableView("持仓版本已变化", systemImage: "arrow.clockwise",
                                   description: Text("请返回资产页重新读取当前记录。"))
        }
    }
    private func holdingsTime(_ raw: String?) -> String {
        guard let raw else { return "时间未提供" }
        let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = iso.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) else { return raw }
        let display = DateFormatter(); display.locale = Locale(identifier: "zh_CN")
        display.timeZone = TimeZone(identifier: "Asia/Shanghai"); display.dateFormat = "yyyy-MM-dd HH:mm"
        return display.string(from: date)
    }
    private func quoteStatus(_ status: PortfolioDecisionQuoteStatus?) -> String {
        switch status { case .current: "富途报价"; case .stale: "富途报价已过期"; default: "价格暂不可用" }
    }
    private var holdingText: String {
        if let position = ownerSnapshot?.positions.first(where: { $0.symbol == api.currentSymbol }) {
            return "\(templateNumber(position.quantity, format: "%.0f")) 股"
        }
        guard let context = api.templatePortfolio, context.status == .available || context.status == .zeroPosition else { return "当前持仓不可用" }
        guard let position = context.positions.first(where: { $0.symbol == api.currentSymbol }) else { return "快照未列出" }
        return "\(templateNumber(position.quantity, format: "%.0f")) 股"
    }
    // MARK: - Continuity Card
    private var stockContinuityCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("当前研究关联标的")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Button(action: {
                    if let onNavigateToResearch = onNavigateToResearch {
                        onNavigateToResearch(api.selectedCandidateIndex, 0)
                    } else {
                        selectedStock = api.currentCandidate.currentDossier
                    }
                }) {
                    HStack(spacing: 3) {
                        Text("前往深度投研")
                        Image(systemName: "chevron.right")
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Theme.gold)
                }
            }
            
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(api.currentSymbol)
                            .font(.system(size: 13, weight: .bold, design: .monospaced))
                            .foregroundColor(Theme.gold)
                        Text(api.currentCandidate.name)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(Theme.textPrimary)
                    }
                    Text(api.currentCandidate.currentDossier.thesisSummary)
                        .font(.system(size: 12))
                        .foregroundColor(Theme.textSecondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("当前持仓")
                        .font(.system(size: 10))
                        .foregroundColor(Theme.textTertiary)
                    Text(holdingText)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(Theme.textSecondary)
                }
            }
            .padding(12)
            .templateCardStyle()
        }
    }
    
    // MARK: - Official Snapshot
    private var officialSnapshotCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("权威券商快照状态")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                StatusBadgeView(portfolioProvenance)
            }
            
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(Theme.amber)
                        .font(.system(size: 18))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(api.templatePortfolio?.message ?? api.issues["portfolio"] ?? "正在核对平安资产快照")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(Theme.textPrimary)
                        Text("来源: \(api.templatePortfolio?.portfolioSource ?? "未返回") · 时点: \(api.templatePortfolio?.sourceAsOf ?? "未返回")")
                            .font(.system(size: 12))
                            .foregroundColor(Theme.textSecondary)
                            .lineSpacing(2)
                    }
                }
                
                Divider().background(Theme.border)
                
                // Expandable explanation
                Button(action: {
                    withAnimation { whyNoHoldingsExpanded.toggle() }
                }) {
                    HStack {
                        Text("为什么没有显示真实持仓与账户余额？")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(Theme.blue)
                        Spacer()
                        Image(systemName: whyNoHoldingsExpanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 11))
                            .foregroundColor(Theme.blue)
                    }
                }
                .buttonStyle(.plain)
                
                if whyNoHoldingsExpanded {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("1. 严禁生产越权：系统设计原则严格禁止获取真实交易权限或券商资金操作权限。")
                        Text("2. 数据真实性约束：依据治理规范，在缺乏官方只读快照时，绝不能将缺失值伪装为“0 资产”或“0 现金”，必须明确呈现为 UNKNOWN。")
                        Text("3. 个人隐私保护：资产敏感信息由 Owner 本地受保护环境持有，不向任何第三方或云端外发。")
                    }
                    .font(.system(size: 11.5))
                    .foregroundColor(Theme.textTertiary)
                    .lineSpacing(3)
                    .padding(.top, 2)
                }
            }
            .padding(14)
            .templateCardStyle()
        }
    }
    
    // MARK: - Portfolio Impact
    private var portfolioImpactCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("组合概览")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                StatusBadgeView(portfolioProvenance)
            }
            
            VStack(alignment: .leading, spacing: 10) {
                Text("权重按已录入股票市值计算；现金和其他未录入资产不计入。")
                    .font(.system(size: 12.5))
                    .foregroundColor(Theme.textSecondary)
                
                HStack(spacing: 12) {
                    metricCard(label: "已录入股票", val: ownerSnapshot.map { "\($0.positions.count) 只" } ?? "未读取", color: Theme.gold)
                    metricCard(label: "最大持仓占比", val: displayPortfolio?.summary.concentration.largestPositionWeight.map { String(format: "%.1f%%", $0 * 100) } ?? "未计算", color: Theme.blue)
                    metricCard(label: "现金", val: "未记录", color: Theme.amber)
                }
                
                Button("打开组合研究") { actions.workflow(.assetPortfolio) }
                    .font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.blue)
                Text("当前页面不生成仓位建议；打开组合研究核对现有暴露与研究判断。")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.textSecondary)
                    .lineSpacing(2)
            }
            .padding(14)
            .templateCardStyle()
        }
    }
    
    private func metricCard(label: String, val: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 10))
                .foregroundColor(Theme.textTertiary)
            Text(val)
                .font(.system(size: 15, weight: .bold, design: .monospaced))
                .foregroundColor(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Theme.bgSecondary)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
    
    // MARK: - Local Alpha
    private var localAlphaJournalCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("本地手工记录 (非官方 Alpha)")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Text("仅限本地记账")
                    .font(.system(size: 11))
                    .foregroundColor(Theme.textTertiary)
            }
            
            VStack(alignment: .leading, spacing: 8) {
                Text(api.assets?.snapshots.first(where: { $0.source != .ownerCurrent }).map { "已读取非官方快照，时点 \($0.asOf) · \($0.positions.count) 项持仓记录。不代表券商当前持仓。" } ?? "暂无非官方快照，可在现有资产流程中录入和核对。")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.textSecondary)
                
                Button(action: { actions.workflow(.assets) }) {
                    HStack {
                        Image(systemName: "plus.circle.fill")
                        Text("查看与补充非官方资产快照")
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(Theme.blue)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(Theme.blue.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
            .padding(14)
            .templateCardStyle()
        }
    }
    
    // MARK: - Safety Boundary
    private var safetyBoundarySection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "lock.shield.fill")
                    .foregroundColor(Theme.green)
                    .font(.system(size: 14))
                Text("系统安全与只读约束")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Theme.green)
            }
            Text("本投资辅助系统不具备也不申请券商交易接口凭证。系统内所有推演结论均须由投资者本人在券商官方渠道手工执行，杜绝程序越权风险。")
                .font(.system(size: 11.5))
                .foregroundColor(Theme.textTertiary)
                .lineSpacing(3)
        }
        .padding(14)
        .templateCardStyle()
    }
}
