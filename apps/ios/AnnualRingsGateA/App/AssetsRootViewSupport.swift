import SwiftUI

extension AssetsRootView {
    @ViewBuilder
    func assetsSnapshotContext(_ context: PortfolioDecisionContextEnvelope) -> some View {
        if context.positions.isEmpty {
            Text("契约确认该快照为零持仓。") .foregroundStyle(.secondary) .accessibilityIdentifier("assetsExplicitEmptyState")
        } else {
            VStack(alignment: .leading, spacing: 7) {
                SectionTitle("持仓快照（估算）")
                ForEach(context.positions, id: \.sourceRowId) { position in
                    VStack(alignment: .leading, spacing: 8) {
                        Button { openMarket(position.symbol) } label: {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(position.symbol) .font(.callout.weight(.bold)) .foregroundStyle(OwnerExperienceStyle.accent)
                                    Text(position.name ?? "公司名待补齐") .font(.callout.weight(.semibold))
                                    Text("\(assetsNumber(position.quantity)) 股 · 成本 \(assetsAmount(position.averageCost, currency: position.currency))") .font(.caption) .foregroundStyle(.secondary)
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 3) {
                                    Text(assetsAmount(position.marketValue, currency: position.currency)) .font(.callout.weight(.bold))
                                    Text(assetsPercent(position.marketWeight)) .font(.caption.weight(.semibold)) .foregroundStyle(.green)
                                }
                            }
                        } .buttonStyle(.plain) .accessibilityIdentifier("assetsSnapshotOpenMarket-\(position.symbol)")
                        Text("未实现盈亏 \(assetsAmount(position.unrealizedPnl, currency: position.currency)) · 报价 \(position.quote.status.userLabel)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                        Button { Task { await openExistingResearch(position.symbol) } } label: {
                            Label("打开 \(position.symbol) 研究", systemImage: "doc.text.magnifyingglass")
                        } .buttonStyle(.bordered) .accessibilityIdentifier("assetsSnapshotOpenResearch-\(position.symbol)")
                    }
                    .ownerSubtleSurface()
                }
            }
        }

        DisclosureGroup("组合风险与来源详情") {
            VStack(alignment: .leading, spacing: 7) {
                Text("持仓来自平安导入快照，报价来自 Futu；现金未提供，不启用生产、券商对账、会计或交易执行。") .font(.caption.weight(.bold)) .foregroundStyle(.orange) .accessibilityIdentifier("assetsAuthorityBoundary")
                InfoBlock(title: "账户范围", value: context.accountScopeId ?? "未提供")
                InfoBlock(title: "快照标识", value: context.portfolioSnapshotId ?? "未提供")
                InfoBlock(title: "事实集标识", value: context.contextId ?? "未提供")
                AssetsFreshnessSection(context: context)
                InfoBlock(title: "持仓市值", value: "\(context.summary.marketValue.status.userLabel) · \(assetsAmount(context.summary.marketValue.amount, currency: context.summary.marketValue.currency)) · 缺价 \(context.summary.marketValue.missingPositionCount)")
                InfoBlock(title: "未实现盈亏", value: assetsAmount(context.summary.unrealizedPnl, currency: "HKD"))
                InfoBlock(title: "集中度", value: assetsConcentration(context.summary.concentration))
                if !context.gaps.isEmpty {
                    BulletList(title: "事实缺口", items: context.gaps) .accessibilityIdentifier("assetsSnapshotGaps")
                }
                InfoBlock(title: "风险可用性", value: assetsRiskImpactLabel(context.dataUse.advisoryRiskImpact)) .accessibilityIdentifier("assetsRiskAvailability")
            }
            .padding(.top, 6)
            .accessibilityIdentifier("assetsSnapshotSummary")
        }
    }

    static func isDisplayable(_ status: PortfolioDecisionContextStatus) -> Bool {
        switch status {
        case .available, .stale, .partial, .zeroPosition:
            return true
        case .empty, .conflict, .unauthorized, .unavailable:
            return false
        }
    }

    func assetsConcentration(_ summary: PortfolioDecisionConcentrationSummary) -> String {
        guard summary.status == .available else { return "待补齐" }
        return "最大 \(assetsPercent(summary.largestPositionWeight)) · 前三 \(assetsPercent(summary.topThreeWeight)) · 集中度指数 \(assetsNumber(summary.hhi))"
    }

    private func assetsAmount(_ value: Double?, currency: String?) -> String {
        guard let value else { return "待补齐" }
        guard currency == "HKD" else { return "\(assetsNumber(value)) \(currency ?? "币种待补齐")" }
        return value.formatted(.currency(code: "HKD").precision(.fractionLength(2)))
    }

    func assetsPercent(_ value: Double?) -> String {
        value?.formatted(.percent.precision(.fractionLength(2))) ?? "待补齐"
    }

    func assetsNumber(_ value: Double?) -> String { value?.formatted(.number.precision(.fractionLength(0 ... 4))) ?? "待补齐" }

    @MainActor
    func load() async {
        let requestId = UUID()
        snapshotRequestId = requestId
        isLoading = true
        context = nil
        let auth = AppEnvironment.researchAuthorizationContext()
        defer { if snapshotRequestId == requestId { isLoading = false } }
        let client = PortfolioDecisionClient(
            baseURL: auth.baseURL,
            authToken: auth.readToken,
            authHeaderName: auth.readHeaderName
        )
        do {
            let fetched = try await client.fetchContext()
            guard snapshotRequestId == requestId,
                  AppEnvironment.researchAuthorizationContext() == auth else { return }
            context = fetched
            message = Self.isDisplayable(fetched.status)
                ? fetched.message
                : "未连接：\(fetched.message)"
        } catch {
            guard snapshotRequestId == requestId,
                  AppEnvironment.researchAuthorizationContext() == auth else { return }
            message = "未连接：\(error.localizedDescription)"
        }
    }

    @MainActor
    func loadAssetsAlpha() async {
        let requestId = UUID()
        alphaRequestId = requestId
        isAlphaLoading = true
        let auth = AppEnvironment.researchAuthorizationContext()
        let client = AssetsAlphaClient(
            baseURL: auth.baseURL,
            readToken: auth.readToken,
            readHeaderName: auth.readHeaderName,
            writeToken: auth.writeToken,
            writeHeaderName: auth.writeHeaderName
        )
        defer { if alphaRequestId == requestId { isAlphaLoading = false } }
        do {
            let fetched = try await client.fetch()
            guard alphaRequestId == requestId,
                  AppEnvironment.researchAuthorizationContext() == auth else { return }
            alphaEnvelope = fetched
            alphaMessage = "已读取后端最新非官方 Alpha。"
        } catch {
            guard alphaRequestId == requestId,
                  AppEnvironment.researchAuthorizationContext() == auth else { return }
            alphaEnvelope = nil; alphaMessage = "读取失败，旧的非官方资产记录已从当前页面隐藏；请重试：\(error.localizedDescription)"
        }
    }

    @MainActor
    func openExistingResearch(
        _ rawSymbol: String,
        opensHoldingLogicCapture: Bool = false,
        opensPortfolioLab: Bool = false
    ) async {
        guard let symbol = SecuritySymbol.parseHongKongAlias(rawSymbol) else { return }
        symbolInput = symbol.canonical; let requestId = UUID(); researchNavigationRequestId = requestId
        researchNavigationMessage = "正在确认精确研究成员。"
        let auth = AppEnvironment.researchAuthorizationContext()
        let memberships = await ResearchClient(
            baseURL: auth.baseURL,
            authToken: auth.readToken,
            authHeaderName: auth.readHeaderName
        ).fetchCandidateMemberships(includeArchived: true)
        guard researchNavigationRequestId == requestId,
              AppEnvironment.researchAuthorizationContext() == auth,
              currentAssetSymbol == symbol.canonical,
              selectedTab == .assets else { return }
        if let target = candidateResearchNavigationTarget(
            for: symbol.canonical,
            in: memberships,
            opensPortfolioLab: opensPortfolioLab,
            opensHoldingLogicCapture: opensHoldingLogicCapture
        ) {
            openResearchCandidate(target)
        } else if let restoresArchived = candidateResearchOnboardingRestoresArchived(for: symbol.canonical, in: memberships) {
            researchNavigationMessage = restoresArchived ? "请在研究页明确恢复已归档成员。" : "请在研究页明确加入该标的。"
            openResearchOnboarding(symbol.canonical)
        } else {
            researchNavigationMessage = memberships.status == .unavailable
                ? "研究成员来源不可用；已留在资产，未打开可能错绑的研究。"
                : "研究成员存在歧义；已留在资产，未打开可能错绑的研究。"
        }
    }

    // 历史成交备注：只读回看早期非官方 Alpha 交易记录，不参与任何持仓/现金/费用计算，
    // 也不提供新增交易入口（新交易编辑器 AssetsLocalTradeJournalSection 未挂载）。
    @ViewBuilder
    var historicalTradeNotesSection: some View {
        if let trades = alphaEnvelope?.trades, !trades.isEmpty {
            DisclosureGroup("历史成交备注（非官方，\(trades.count) 条）") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("早期非官方备注的只读回看；不会重算持仓、现金或费用，也不是正式交易或会计账本。")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier("assetsHistoricalTradeNotesBoundary")
                    ForEach(trades) { record in
                        VStack(alignment: .leading, spacing: 3) {
                            Text("\(record.side == .buy ? "买入" : "卖出") · \(record.symbol)")
                                .font(.callout.weight(.semibold))
                            Text("数量 \(assetsNumber(record.quantity)) · 成交价 HKD \(assetsNumber(record.priceHkd))")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                            Text("成交时间 \(record.occurredAt)")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                            if let note = record.note {
                                Text(note).font(.caption)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("assetsHistoricalTradeNote-\(record.id)")
                    }
                }
                .padding(.top, 6)
            }
            .accessibilityIdentifier("assetsHistoricalTradeNotes")
        }
    }
}
