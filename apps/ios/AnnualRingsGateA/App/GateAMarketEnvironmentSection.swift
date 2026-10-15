import SwiftUI

struct MarketResearchAdmissionToken: Equatable {
    let requestId: UUID
    let symbol: String
    let authorizationContext: AppResearchAuthorizationContext
}

extension GateAMarketScreen {
    @MainActor
    func refreshMarketResearchAdmission() async -> MarketResearchAdmissionToken? {
        guard !isRefreshingDaily,
              !isRefreshingMarketResearchAdmission,
              !membershipSubmissionState.isInFlight else {
            membershipWriteMessage = "市场事实正在刷新；完成后请重试。"
            return nil
        }
        guard let symbol = SecuritySymbol.parseHongKongAlias(symbolInput) else {
            membershipWriteMessage = "请先选择一个有效港股。"
            return nil
        }
        let context = AppEnvironment.researchAuthorizationContext()
        let retainedBeforeRead = hasRetainableMarketFacts
        let requestId = UUID()
        marketResearchAdmissionRequestId = requestId
        isRefreshingMarketResearchAdmission = true
        defer {
            if marketResearchAdmissionRequestId == requestId {
                isRefreshingMarketResearchAdmission = false
            }
        }
        membershipWriteMessage = "正在重新读取当前价格、日线技术与市场环境。"
        guard await loadQuote(),
              marketResearchAdmissionRequestId == requestId,
              SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical,
              AppEnvironment.researchAuthorizationContext() == context else {
            marketFactsAreHistorical = retainedBeforeRead && hasRetainableMarketFacts
            return nil
        }
        guard await loadDailyTechnical(),
              marketResearchAdmissionRequestId == requestId,
              SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical,
              AppEnvironment.researchAuthorizationContext() == context else {
            marketFactsAreHistorical = retainedBeforeRead && hasRetainableMarketFacts
            return nil
        }
        guard await loadMarketEnvironment(),
              marketResearchAdmissionRequestId == requestId,
              SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical,
              AppEnvironment.researchAuthorizationContext() == context else {
            marketFactsAreHistorical = retainedBeforeRead && hasRetainableMarketFacts
            return nil
        }
        if let issue = currentMarketFactsIssue { membershipWriteMessage = issue; return nil }
        marketFactsAreHistorical = false
        return MarketResearchAdmissionToken(requestId: requestId, symbol: symbol.canonical, authorizationContext: context)
    }

    @MainActor
    func marketResearchAdmissionIsCurrent(_ token: MarketResearchAdmissionToken) -> Bool {
        marketResearchAdmissionRequestId == token.requestId
            && SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == token.symbol
            && AppEnvironment.researchAuthorizationContext() == token.authorizationContext
            && currentMarketResearchAdmissionIssue == nil
    }

    @MainActor
    @discardableResult
    func loadMarketEnvironment() async -> Bool {
        guard let symbol = SecuritySymbol.parseHongKongAlias(symbolInput) else {
            marketEnvironmentEnvelope = .unavailable("请选择一只港股后再读取市场环境。", requestedSymbol: "UNSELECTED")
            marketEnvironmentIsHistorical = false
            return false
        }
        let context = AppEnvironment.researchAuthorizationContext()
        let requestId = UUID()
        marketEnvironmentRequestId = requestId
        isLoadingMarketEnvironment = true
        let retainPrevious = marketEnvironmentEnvelope.requestedSymbol == symbol.canonical && marketEnvironmentEnvelope.data != nil
        marketEnvironmentIsHistorical = retainPrevious
        if !retainPrevious { marketEnvironmentEnvelope = .unavailable("正在重新读取真实市场环境。", requestedSymbol: symbol.canonical) }
        defer { if marketEnvironmentRequestId == requestId { isLoadingMarketEnvironment = false } }
        do {
            let fetched = try await MarketEnvironmentClient(
                baseURL: context.baseURL,
                authToken: context.readToken,
                authHeaderName: context.readHeaderName
            ).fetch(market: symbol.market, code: symbol.code)
            guard marketEnvironmentRequestId == requestId,
                  AppEnvironment.researchAuthorizationContext() == context,
                  SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical else { return false }
            guard fetched.status == .available, fetched.data != nil else {
                if !retainPrevious { marketEnvironmentEnvelope = fetched }
                marketEnvironmentIsHistorical = retainPrevious
                return false
            }
            marketEnvironmentEnvelope = fetched
            marketEnvironmentIsHistorical = false
            return true
        } catch {
            guard marketEnvironmentRequestId == requestId,
                  AppEnvironment.researchAuthorizationContext() == context,
                  SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical else { return false }
            if !retainPrevious { marketEnvironmentEnvelope = .unavailable("港股市场环境不可用。", requestedSymbol: symbol.canonical) }
            marketEnvironmentIsHistorical = retainPrevious
            return false
        }
    }

    @MainActor
    func reloadMarketEnvironment() async {
        guard !isRefreshingDaily,
              !isRefreshingMarketResearchAdmission,
              !membershipSubmissionState.isInFlight else { return }
        marketResearchAdmissionRequestId = UUID()
        candidateNavigationRequestId = UUID()
        let retainedBeforeRead = hasRetainableMarketFacts
        let loaded = await loadMarketEnvironment()
        marketFactsAreHistorical = loaded && currentMarketFactsIssue == nil ? false : retainedBeforeRead && hasRetainableMarketFacts
    }
}

struct GateAMarketEnvironmentSection: View {
    let symbol: String?
    let envelope: MarketEnvironmentEnvelope
    let isRetained: Bool
    let isLoading: Bool
    let isExternallyBusy: Bool
    let reload: @MainActor () async -> Void

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 14) {
                if isLoading {
                    ProgressView("正在读取真实市场环境")
                        .accessibilityIdentifier("marketEnvironmentLoading")
                }
                if let data = envelope.data, envelope.status == .available {
                    sourceHeader(data)
                    DisclosureGroup("展开指数、广度、行业与资金流") {
                        VStack(alignment: .leading, spacing: 14) {
                            indices(data.indices)
                            breadth(data)
                            sectors(data.sectors)
                            capitalFlow(data.selectedStockCapitalFlow)
                            limitations(data.unknowns)
                        }
                        .padding(.top, 8)
                    }
                } else {
                    Text("市场环境暂不可用")
                        .font(.subheadline.weight(.semibold))
                    Text("当前没有可验证的指数、行业与市场广度数据；暂不判断大市强弱，也不会用个股日线代替市场环境。")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if isRetained {
                        Text("本次读取失败；保留同一股票的上次有效市场环境，仅供浏览。")
                            .font(.caption)
                            .foregroundStyle(.orange)
                            .accessibilityIdentifier("marketEnvironmentRetainedNotice")
                    }
                }
                DisclosureGroup("来源与刷新") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(envelope.status == .available ? "来源：Futu 行情（只读）" : envelope.message)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("marketEnvironmentUnavailableMessage")
                        Button {
                            Task { await reload() }
                        } label: {
                            Label(isLoading ? "读取中" : "刷新港股市场环境", systemImage: "chart.bar.xaxis")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.bordered)
                        .disabled(isLoading || isExternallyBusy || SecuritySymbol.parseHongKongAlias(symbol ?? "") == nil)
                        .accessibilityIdentifier("marketEnvironmentRefreshButton")
                    }
                    .padding(.top, 6)
                }
            }
        } label: {
            Label("港股市场环境", systemImage: "globe.asia.australia")
                .font(.headline)
        }
        .accessibilityIdentifier("marketEnvironmentSection")
    }

    @ViewBuilder
    private func sourceHeader(_ data: MarketEnvironmentData) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                Text(marketStateLabel(data.marketState))
                    .font(.subheadline.weight(.semibold))
                Text("截至 \(compactTime(envelope.asOf)) · \(isRetained ? "上次有效 · 非实时" : freshnessLabel(envelope.freshness()))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("来源 \(providerLabel(envelope.source.provider)) · 读取 \(compactTime(envelope.source.fetchedAt))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(data.risk.breadthSignal.marketBreadthLabel)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.thinMaterial, in: Capsule())
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("marketEnvironmentDetailsSourceHeader")
    }

    @ViewBuilder
    private func indices(_ items: [MarketEnvironmentIndexFact]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("主要指数").font(.subheadline.weight(.semibold))
            ForEach(items) { item in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.name).font(.subheadline)
                        Text(item.last.formatted(.number.precision(.fractionLength(2))))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(percent(item.changePercent))
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundStyle(changeColor(item.changePercent))
                }
            }
        }
        .accessibilityIdentifier("marketEnvironmentIndices")
    }

    @ViewBuilder
    private func breadth(_ data: MarketEnvironmentData) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("市场广度与风险").font(.subheadline.weight(.semibold))
            Text("恒指成份：涨 \(data.breadth.advancers) · 跌 \(data.breadth.decliners) · 平 \(data.breadth.unchanged)")
            Text("上涨占比 \(percent(data.breadth.advanceRatio * 100)) · 恒指振幅 \(percent(data.risk.hsiAmplitudePercent))")
            Text("行业强弱差 \(percent(data.risk.sectorDispersionPercent))")
                .foregroundStyle(.secondary)
            Text("这些是市场状态事实，不是买卖建议。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .font(.subheadline)
        .accessibilityIdentifier("marketEnvironmentBreadthRisk")
    }

    @ViewBuilder
    private func sectors(_ sectors: MarketEnvironmentSectors) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("行业强弱（已返回 \(sectors.universeCount) 个行业样本）")
                .font(.subheadline.weight(.semibold))
            sectorList("领涨", sectors.leaders)
            sectorList("领跌", sectors.laggards)
        }
        .accessibilityIdentifier("marketEnvironmentSectors")
    }

    @ViewBuilder
    private func sectorList(_ title: String, _ items: [MarketEnvironmentSectorFact]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(items) { item in
                HStack {
                    Text(item.name).lineLimit(1)
                    Spacer()
                    Text(percent(item.changePercent))
                        .monospacedDigit()
                        .foregroundStyle(changeColor(item.changePercent))
                }
                .font(.caption)
            }
        }
    }

    @ViewBuilder
    private func capitalFlow(_ flow: MarketEnvironmentCapitalFlow?) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("当前标的资金流").font(.subheadline.weight(.semibold))
            if let flow {
                Text("\(flow.symbol) 净流入 \(flowAmount(flow.netFlow))")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(changeColor(flow.netFlow))
                Text("超大 \(flowAmount(flow.superFlow)) · 大单 \(flowAmount(flow.bigFlow))")
                Text("中单 \(flowAmount(flow.mediumFlow)) · 小单 \(flowAmount(flow.smallFlow))")
                Text("数据点 \(compactTime(flow.asOf)) · 行情数据有效至 \(compactTime(flow.lastValidAt))")
            } else {
                Text("所选股票资金流暂不可用")
            }
        }
        .font(.caption)
        .accessibilityIdentifier("marketEnvironmentCapitalFlow")
    }

    @ViewBuilder
    private func limitations(_ unknowns: [String]) -> some View {
        if unknowns.isEmpty == false {
            VStack(alignment: .leading, spacing: 3) {
                Text("仍未知").font(.caption.weight(.semibold))
                ForEach(unknowns, id: \.self) { value in
                    Text("• \(value.marketUnknownLabel)")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("marketEnvironmentUnknowns")
        }
    }

    private func compactTime(_ value: String?) -> String {
        guard let value else { return "时间待补齐" }
        return value.replacingOccurrences(of: "T", with: " ").replacingOccurrences(of: "+08:00", with: " HKT")
    }

    private func percent(_ value: Double) -> String { String(format: "%+.2f%%", value) }
    private func flowAmount(_ value: Double) -> String { String(format: "%+.2f 百万 HKD", value / 1_000_000) }
    private func changeColor(_ value: Double) -> Color { value > 0 ? .red : value < 0 ? .green : .secondary }
    private func marketStateLabel(_ value: String) -> String {
        switch value {
        case "PRE_OPEN": "港股盘前"
        case "MORNING": "港股上午交易中"
        case "REST": "港股午间休市"
        case "AFTERNOON": "港股下午交易中"
        case "CLOSED": "港股已收市"
        default: "港股交易状态待确认"
        }
    }

    private func freshnessLabel(_ value: MarketEnvironmentFreshness) -> String {
        switch value {
        case .fresh: "本次新鲜读取"
        case .closedLastObservation: "本次读取的收市最后观测"
        case .stale: "已过期"
        }
    }

    private func providerLabel(_ value: String) -> String {
        switch value {
        case "futu_opend": "Futu/OpenD（只读）"
        case "unavailable": "暂不可用"
        default: value
        }
    }
}

private extension String {
    var marketBreadthLabel: String {
        switch self {
        case "broad_strength": "广度偏强"
        case "broad_weakness": "广度偏弱"
        default: "广度分化"
        }
    }

    var marketUnknownLabel: String {
        switch self {
        case "full_hk_market_net_capital_flow_not_provided_by_opend": "行情服务未提供全港市场净流入；当前只展示所选股票资金流"
        case "selected_stock_capital_flow_unavailable": "所选股票资金流暂不可用"
        default: self
        }
    }
}
