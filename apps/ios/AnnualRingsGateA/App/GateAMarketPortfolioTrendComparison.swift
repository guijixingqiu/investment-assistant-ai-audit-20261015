import Foundation
import SwiftUI

extension GateAMarketScreen {
    var marketPortfolioTrendLoadIdentity: String {
        let tracked = candidateMemberships.memberships
            .filter { $0.state == .tracked }
            .map { "\($0.id):\($0.version):\($0.symbol)" }
            .joined(separator: "|")
        return [
            candidateAuthorizationRevision.uuidString,
            candidateMemberships.status.rawValue,
            candidateMemberships.generatedAt,
            parsedSymbol?.canonical ?? "UNSELECTED",
            currentHongKongRequestDate(),
            tracked
        ].joined(separator: "::")
    }

    var marketTrackedMemberships: [CandidateMembershipData] {
        guard candidateMemberships.status == .available else { return [] }
        let selected = parsedSymbol?.canonical
        return candidateMemberships.memberships
            .filter { $0.state == .tracked }
            .sorted {
                if $0.symbol == selected { return true }
                if $1.symbol == selected { return false }
                return $0.symbol < $1.symbol
            }
    }

    private var marketSelectedTrackedMembership: CandidateMembershipData? {
        guard let selected = parsedSymbol?.canonical else { return nil }
        let matches = marketTrackedMemberships.filter { $0.symbol == selected }
        guard matches.count == 1 else { return nil }
        return matches[0]
    }

    private var currentMarketWeinsteinResult: WeinsteinTechnicalAnalysisEnvelope? {
        guard let result = weinsteinEnvelope,
              result.status == "available",
              result.symbol == parsedSymbol?.canonical,
              result.analysisAsOf == currentHongKongRequestDate() else { return nil }
        return result
    }

    @ViewBuilder
    func marketOwnerBrief() -> some View {
        let symbol = parsedSymbol?.canonical ?? "当前股票"
        VStack(alignment: .leading, spacing: 8) {
            Text("市场判断 · \(symbol)")
                .font(.headline)
            if let quote = envelope.data {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(quote.name ?? quote.symbol)
                            .font(.subheadline.weight(.semibold))
                        Text("当前价格 · \(marketQuotePresentation(envelope).label)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("\(quote.currency) \(quote.price, specifier: "%.2f")")
                            .font(.title3.weight(.bold).monospacedDigit())
                        Text(quote.changePercent.map { String(format: "%+.2f%%", $0) } ?? "待补齐")
                            .font(.caption.weight(.semibold).monospacedDigit())
                            .foregroundStyle((quote.change ?? 0) >= 0 ? .red : .green)
                    }
                }
                .ownerSubtleSurface(padding: 10)
                .accessibilityIdentifier("marketOwnerQuotePulse")
            }
            marketOwnerBriefRow("市场环境", marketOwnerMarketEnvironment)
                .lineLimit(2)
                .accessibilityIdentifier("marketOwnerMarketEnvironment")
            marketOwnerBriefRow("趋势 / Weinstein", marketOwnerWeinsteinTrend)
                .lineLimit(2)
                .accessibilityIdentifier("marketOwnerWeinsteinTrend")
            DisclosureGroup("展开候选理由、时效与完整说明") {
                VStack(alignment: .leading, spacing: 8) {
                    marketOwnerBriefRow("市场环境", marketOwnerMarketEnvironment)
                        .accessibilityIdentifier("marketOwnerMarketEnvironmentDetail")
                    marketOwnerBriefRow("趋势 / Weinstein", marketOwnerWeinsteinTrend)
                        .accessibilityIdentifier("marketOwnerWeinsteinTrendDetail")
                    marketOwnerBriefRow("候选理由", marketOwnerCandidateReason)
                        .accessibilityIdentifier("marketOwnerCandidateReason")
                    Text(marketOwnerBriefFreshness)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("marketOwnerBriefFreshness")
                    Text("详细图表和来源记录已收起；这里只保留今天先看什么。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 4)
            }
            .font(.caption)
        }
        .cardStyle(padding: 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("marketOwnerBrief")
    }

    private func marketOwnerBriefRow(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.weight(.medium))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var marketOwnerMarketEnvironment: String {
        guard marketEnvironmentEnvelope.status == .available,
              let data = marketEnvironmentEnvelope.data else {
            return "当前没有可验证的市场环境，暂不判断大盘偏强或偏弱；来源恢复后再刷新。"
        }
        let state = switch data.marketState {
        case "OPEN", "MORNING", "AFTERNOON": "港股交易中"
        case "PRE_OPEN": "港股盘前"
        case "REST": "港股午间休市"
        case "CLOSED": "港股已收市"
        default: "港股状态待确认"
        }
        let ratio = String(format: "%.0f%%", data.breadth.advanceRatio * 100)
        return "\(state)；上涨 \(data.breadth.advancers) 只、下跌 \(data.breadth.decliners) 只，上涨占比 \(ratio)。"
    }

    private var marketOwnerWeinsteinTrend: String {
        guard let result = currentMarketWeinsteinResult, result.status == "available" else {
            return "完成周线证据尚未齐全，暂不判断趋势；需要同一股票、恒指和所属行业的完成周线。"
        }
        return "\(marketOwnerTrendStage(result.stockStage, direction: result.ma30wDirection)) · \(marketOwnerEntryState(result.entryState))。"
    }

    private var marketOwnerCandidateReason: String {
        guard let symbol = parsedSymbol?.canonical else { return "先选择一只港股，再读取候选理由。" }
        if isLoadingCandidates { return "正在读取这只股票的候选理由。" }
        if let candidate = candidateOverview.candidates.first(where: { $0.symbol == symbol }) {
            if candidate.reviewDue { return "研究复核已到期，需要核对判断是否仍成立。" }
            if candidate.pendingSuggestionCount > 0 { return "有 \(candidate.pendingSuggestionCount) 条研究提示待处理，先核对这些变化。" }
            if candidate.evidenceCount > 0 { return "已有 \(candidate.evidenceCount) 条可追溯研究证据，因此保留在研究候选中；不是收益推荐。" }
        }
        let membershipMatches = candidateMemberships.memberships.filter {
            $0.symbol == symbol && $0.state != .archived
        }
        if membershipMatches.count == 1, let membership = membershipMatches.first {
            return membership.research.status == .available
                ? "已加入持续跟踪，候选理由来自现有研究记录；不是收益推荐。"
                : "已加入持续跟踪，但研究资料还没补齐；先补一条官方材料。"
        }
        return candidateOverview.status == .empty
            ? "当前没有这只股票的既有研究候选记录；候选理由待补齐。"
            : "候选来源暂不可用；没有用旧结果代替候选理由。"
    }

    private var marketOwnerBriefFreshness: String {
        let environment = marketEnvironmentEnvelope.status == .available
            ? "市场环境 \(marketOwnerEnvironmentFreshness)"
            : "市场环境来源暂不可用"
        let trend = currentMarketWeinsteinResult.map { "周线截至 \($0.analysisAsOf)" } ?? "周线尚未可用"
        let candidate = switch candidateOverview.status {
        case .available: "候选记录已读取"
        case .empty: "暂无候选记录"
        case .unavailable: "候选记录暂不可用"
        }
        return "\(environment) · \(trend) · \(candidate)"
    }

    private var marketOwnerEnvironmentFreshness: String {
        switch marketEnvironmentEnvelope.freshness() {
        case .fresh: "最新"
        case .closedLastObservation: "收市后最后观测"
        case .stale: "已过期"
        }
    }

    private func marketOwnerTrendStage(_ stage: String, direction: String) -> String {
        let stageLabel = switch stage {
        case "STAGE_1": "筑底阶段"
        case "STAGE_2": "上升阶段"
        case "STAGE_3": "转弱阶段"
        case "STAGE_4": "下降阶段"
        case "TRANSITION": "过渡阶段"
        default: "阶段待确认"
        }
        return "\(stageLabel)，30 周均线\(marketDirection(direction))"
    }

    private func marketOwnerEntryState(_ value: String) -> String {
        switch value {
        case "WATCH": "观察"
        case "BASE_FORMING": "底部结构形成中"
        case "BREAKOUT_WATCH": "突破观察"
        case "BREAKOUT_CONFIRMED": "突破已确认"
        case "RETEST_WATCH": "回测观察"
        case "HOLD_STAGE_2": "保持在上升阶段"
        case "STAGE_3_WARNING": "可能进入转弱阶段"
        case "REDUCE": "收紧风险"
        case "EXIT": "下降阶段风险已确认"
        default: "状态待确认"
        }
    }

    @ViewBuilder
    func marketScenarioTransmissionBrief() -> some View {
        let membership = marketSelectedTrackedMembership
        let result = membership.flatMap { marketPortfolioTrend(for: $0) } ?? currentMarketWeinsteinResult
        let report = membership.flatMap { marketScenarioConfirmedReport(for: $0) }
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(membership?.symbol ?? parsedSymbol?.canonical ?? "当前股票") · 环境如何影响判断")
                    .font(.headline)
                Spacer()
                Text(report.map { $0.isCurrentExact ? "当前判断" : "上次有效" } ?? "判断待补齐")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(report == nil ? OwnerExperienceStyle.warning : OwnerExperienceStyle.success)
            }
            Text(marketScenarioFreshness(report: report, result: result))
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("marketScenarioFreshness")
            InfoBlock(title: "市场环境", value: marketScenarioMarketSummary(result))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("marketScenarioMarketEnvironment")
            InfoBlock(title: "行业环境", value: marketScenarioSectorSummary(result))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("marketScenarioSectorEnvironment")
            InfoBlock(
                title: "\(membership?.symbol ?? parsedSymbol?.canonical ?? "当前股票") 趋势 / Weinstein",
                value: marketScenarioTrendSummary(result)
            )
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("marketScenarioWeinsteinTrend")
            InfoBlock(title: "改善 / 维持 / 恶化条件", value: marketScenarioConditions(report, result: result))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("marketScenarioConditions")
            InfoBlock(title: "受影响变量", value: marketScenarioAffectedVariables(report, result: result))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("marketScenarioAffectedVariables")
            InfoBlock(title: "传导关系", value: marketScenarioConclusion(report: report, result: result))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("marketScenarioConclusion")
            InfoBlock(title: "唯一下一观察", value: marketScenarioNextObservation(report: report, result: result))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("marketScenarioNextObservation")
            Text("只解释研究条件与环境证据的关系；不会自动改变判断、生成仓位或触发交易。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .cardStyle(padding: 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("marketScenarioTransmission")
    }

    @ViewBuilder
    func marketPortfolioTrendComparison() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("组合趋势比较")
                    .font(.headline)
                Spacer()
                if isLoadingPortfolioTrends { ProgressView() }
                Text("\(marketTrackedMemberships.count) 只")
                    .font(.caption.weight(.semibold))
            }
            Text("按同一分析日比较市场、行业与个股周线阶段；顺序不是排名。")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(marketPortfolioTrendDisplayMessage)
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("marketPortfolioTrendMessage")

            ForEach(marketTrackedMemberships) { membership in
                marketPortfolioTrendRow(membership)
            }

            DisclosureGroup("比较依据与限制") {
                VStack(alignment: .leading, spacing: 6) {
                    Text("周线结构控制阶段判断；日线只用于时点核对。市场、行业或个股处于 Stage 4 时，短期动量不能抵消结构风险。")
                    Text("所有结果只用于研究；不会创建报告、正式决定、持仓、订单或交易。")
                    ForEach(marketTrackedMemberships) { membership in
                        if let result = marketPortfolioTrend(for: membership) {
                            Text("\(membership.symbol) · 完成周 \(result.completedWeekEnd ?? "UNKNOWN") · 结果标识 \(result.resultHash ?? "UNKNOWN")")
                        }
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
            }
        }
        .cardStyle(padding: 12)
        .accessibilityIdentifier("marketPortfolioTrendComparison")
    }

    private var marketPortfolioTrendDisplayMessage: String {
        guard candidateMemberships.status != .unavailable else {
            return "真实研究清单当前不可用，旧比较已隐藏。"
        }
        guard portfolioTrendLoadedIdentity == marketPortfolioTrendLoadIdentity else {
            return "正在按当前研究清单读取完成周线。"
        }
        return portfolioTrendMessage
    }

    @ViewBuilder
    private func marketPortfolioTrendRow(_ membership: CandidateMembershipData) -> some View {
        let result = marketPortfolioTrend(for: membership)
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(result?.sources.first(where: { $0.role == "stock" })?.name ?? membership.research.name ?? membership.symbol)
                        .font(.callout.weight(.semibold))
                    Text(membership.symbol)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(result?.status == "available" ? "真实数据" : "数据不足")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(result?.status == "available" ? OwnerExperienceStyle.success : OwnerExperienceStyle.warning)
            }
            InfoBlock(title: "市场环境", value: result.map { marketTrendStage($0.marketStage, direction: $0.marketMa30wDirection) } ?? "完成周线证据不足，暂不判断大盘阶段。")
            InfoBlock(title: "行业环境", value: result.map { "\(marketTrendStage($0.sectorStage, direction: $0.sectorMa30wDirection)) · \(marketSectorStrength($0.sectorStrength))" } ?? "精确行业周线证据不足，暂不判断行业强弱。")
            InfoBlock(title: "个股趋势", value: result.map(marketStockTrend) ?? "个股完成周线证据不足，暂不判断趋势。")
            InfoBlock(title: "候选理由", value: marketCandidateReason(membership))
            InfoBlock(title: "主要反证 / 风险", value: result.map(marketCounterevidence) ?? "暂未取得可核对的结构性反证。")
            InfoBlock(title: "下一观察", value: result.flatMap { $0.nextObservations.first } ?? "补齐个股、恒指和精确行业的同一分析日周线后再看。")
            Text(result.map { "截至 \($0.analysisAsOf) · 完成周 \($0.completedWeekEnd ?? "未记录")" } ?? "周线截止时间未记录")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button {
                symbolInput = membership.symbol
            } label: {
                Label("查看这只股票", systemImage: "arrow.right.circle")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("marketPortfolioOpen-\(membership.symbol)")
        }
        .ownerSubtleSurface()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("marketPortfolioTrend-\(membership.symbol)")
    }

    private func marketPortfolioTrend(for membership: CandidateMembershipData) -> WeinsteinTechnicalAnalysisEnvelope? {
        guard portfolioTrendLoadedIdentity == marketPortfolioTrendLoadIdentity,
              let result = portfolioTrendEnvelopes[membership.id],
              result.symbol == membership.symbol,
              result.analysisAsOf == currentHongKongRequestDate() else { return nil }
        return result
    }

    private func marketStockTrend(_ result: WeinsteinTechnicalAnalysisEnvelope) -> String {
        guard result.status == "available" else {
            return "数据不足：\(marketDataGap(result.unknowns.first))"
        }
        let price = result.priceVsMa30wPercent.map { String(format: "%+.1f%%", $0) } ?? "待确认"
        return "\(marketTrendStage(result.stockStage, direction: result.ma30wDirection)) · \(marketStagePhase(result.stockStagePhase))\n价格相对 30 周线 \(price) · 成交量 \(marketVolume(result.volumeConfirmation)) · 相对强弱 \(marketRelativeStrength(result.relativeStrengthStatus))\n当前结构：\(marketEntryState(result.entryState))"
    }

    private func marketCounterevidence(_ result: WeinsteinTechnicalAnalysisEnvelope) -> String {
        guard let raw = result.counterevidence.first?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return "暂未取得可核对的结构性反证。"
        }
        if raw.localizedCaseInsensitiveContains("Stage 4") && raw.localizedCaseInsensitiveContains("大盘") {
            return "大盘处于下降阶段，结构风险较高。"
        }
        if raw.localizedCaseInsensitiveContains("Stage 4") && raw.localizedCaseInsensitiveContains("行业") {
            return "所属行业处于下降阶段，结构风险较高。"
        }
        if raw.localizedCaseInsensitiveContains("Stage 2") && raw.localizedCaseInsensitiveContains("大盘") {
            return "大盘尚未确认上升阶段，观察质量已下调。"
        }
        if raw.localizedCaseInsensitiveContains("Stage 2") && raw.localizedCaseInsensitiveContains("行业") {
            return "所属行业尚未确认上升阶段，观察质量已下调。"
        }
        if raw.localizedCaseInsensitiveContains("切入质量") {
            return "行业相对大盘偏弱，观察质量已下调。"
        }
        return raw
            .replacingOccurrences(of: "Stage 4", with: "下降阶段")
            .replacingOccurrences(of: "Stage 3", with: "转弱阶段")
            .replacingOccurrences(of: "Stage 2", with: "上升阶段")
            .replacingOccurrences(of: "长线做多", with: "长期看涨")
            .replacingOccurrences(of: "切入质量", with: "观察质量")
    }

    private func marketDataGap(_ rawValue: String?) -> String {
        guard let rawValue, !rawValue.isEmpty else { return "所需周线证据不足。" }
        if rawValue.localizedCaseInsensitiveContains("adapter is not configured")
            || rawValue.localizedCaseInsensitiveContains("weekly market evidence")
            || rawValue.localizedCaseInsensitiveContains("fetch failed") {
            return "周线行情来源尚未连接；连接后刷新即可重新判断。"
        }
        return rawValue
    }

    private func marketScenarioMarketSummary(_ result: WeinsteinTechnicalAnalysisEnvelope?) -> String {
        let session = switch marketEnvironmentEnvelope.data?.marketState {
        case "OPEN", "MORNING", "AFTERNOON": "港股交易中"
        case "PRE_OPEN": "港股盘前"
        case "REST": "港股午间休市"
        case "CLOSED": "港股已收市"
        case .some: "港股状态待确认"
        case nil: "市场环境来源暂不可用"
        }
        guard let result, result.status == "available" else {
        return "\(session)；市场周线阶段暂不可判定，不能用个股日线推断大盘强弱。"
        }
        return "\(session)；\(marketTrendStage(result.marketStage, direction: result.marketMa30wDirection))。"
    }

    private func marketScenarioSectorSummary(_ result: WeinsteinTechnicalAnalysisEnvelope?) -> String {
        guard let result, result.status == "available" else {
            let symbol = marketSelectedTrackedMembership?.symbol ?? parsedSymbol?.canonical ?? "当前股票"
            return "精确行业周线证据不足，不能把全市场行业榜单当作 \(symbol) 的所属行业。"
        }
        return "\(marketTrendStage(result.sectorStage, direction: result.sectorMa30wDirection)) · \(marketSectorStrength(result.sectorStrength))。"
    }

    private func marketScenarioTrendSummary(_ result: WeinsteinTechnicalAnalysisEnvelope?) -> String {
        guard let result, result.status == "available" else {
            return "个股周线证据不足；\(marketDataGap(result?.unknowns.first)) 日线指标只用于观察节奏，不代替周线阶段。"
        }
        return "\(marketTrendStage(result.stockStage, direction: result.ma30wDirection)) · \(marketStagePhase(result.stockStagePhase)) · 当前结构：\(marketEntryState(result.entryState))。"
    }

    private func marketScenarioConditions(
        _ report: TwoLayerReportData?,
        result: WeinsteinTechnicalAnalysisEnvelope?
    ) -> String {
        guard let report, let advice = report.payload.adviceLayer else {
            guard let result, result.status == "available" else {
                return "先取得当前股票的完成周线，再读取改善、维持与恶化条件。"
            }
            let support = result.supportZones.first.map {
                "\(String(format: "%.2f", $0.lower))–\(String(format: "%.2f", $0.upper))"
            } ?? "当前结构支撑"
            let deterioration = if let close = result.weeklyChart.last?.close,
                                   let zone = result.supportZones.first,
                                   close < zone.lower {
                "周收仍低于此前支撑区 \(support)，且 30 周均线继续向下。"
            } else {
                "完成周线跌破支撑区 \(support)，且相对强弱继续转弱。"
            }
            return "改善：完成周线重新站稳 30 周均线，且相对强弱不再转弱。\n维持：个股保持\(marketTrendStage(result.stockStage, direction: result.ma30wDirection))，继续按当前谨慎程度观察。\n恶化：\(deterioration)"
        }
        let improvement = marketScenarioFragment(
            advice.scenarios,
            prefixes: ["改善", "上行", "乐观", "bull", "upside"]
        ) ?? "报告没有可核验的改善条件。"
        let maintain = (advice.mediumShortTerm.conditions + advice.longTerm.conditions)
            .compactMap(marketScenarioNonEmpty)
            .first?
            .researchBriefOwnerCondition(
                replacement: "经营、估值和技术依据保持有效，且关键数据截止日期没有变化。"
            ) ?? "报告没有可核验的维持条件。"
        let worsen = (advice.mediumShortTerm.invalidationConditions
            + advice.longTerm.invalidationConditions
            + report.payload.invalidationConditions)
            .compactMap(marketScenarioNonEmpty)
            .first?
            .researchBriefOwnerCondition(
                replacement: "关键材料、估值或技术依据发生变化，或主要经营风险恶化。"
            ) ?? "报告没有可核验的恶化条件。"
        return "改善：\(improvement)\n维持：\(maintain)\n恶化：\(worsen)"
    }

    private func marketScenarioAffectedVariables(
        _ report: TwoLayerReportData?,
        result: WeinsteinTechnicalAnalysisEnvelope?
    ) -> String {
        guard let membership = marketSelectedTrackedMembership,
              let report,
              let workspace = marketScenarioResearchWorkspace(for: membership),
              let pack = workspace.data?.evidencePacks.first(where: { $0.id == report.evidencePackId }) else {
            return result?.status == "available"
                ? "周线阶段 · 30 周均线方向 · 行业相对市场强弱"
                : "当前还没有可核对的研究或技术变量。"
        }
        let variables = pack.items.compactMap(\.variableName).reduce(into: [String]()) { values, variable in
            guard !values.contains(variable), values.count < 3 else { return }
            values.append(variable)
        }
        guard !variables.isEmpty else { return "当前报告没有可绑定的关键变量。" }
        return variables.map(marketScenarioVariableLabel).joined(separator: " · ")
    }

    private func marketScenarioConclusion(
        report: TwoLayerReportData?,
        result: WeinsteinTechnicalAnalysisEnvelope?
    ) -> String {
        guard report != nil else { return "研究判断缺失，市场环境不能替代公司研究。" }
        guard let result, result.status == "available" else {
            return "市场与行业周线证据不足，不能确认改善或恶化；保留上次有效研究判断，先补齐同一分析日周线。"
        }
        if result.marketStage == "STAGE_4" || result.sectorStage == "STAGE_4"
            || ["WEAKENING", "LAGGING"].contains(result.sectorStrength) {
            return "市场或行业结构转弱，会提高恶化情景的复核优先级；不会自动推翻或改写研究判断。"
        }
        if result.marketStage == "STAGE_2" && result.sectorStage == "STAGE_2"
            && ["LEADING", "IMPROVING"].contains(result.sectorStrength) {
            return "市场与行业结构和改善情景方向相容，但只提供外部佐证，不自动改变研究判断。"
        }
        return "当前市场与行业结构不足以单独确认改善或恶化；维持原判断并观察下一条件。"
    }

    private func marketScenarioNextObservation(
        report: TwoLayerReportData?,
        result: WeinsteinTechnicalAnalysisEnvelope?
    ) -> String {
        report?.payload.adviceLayer?.nextQuestion.flatMap(marketScenarioNonEmpty)
            ?? report?.payload.researchLayer?.nextValidationQuestions.compactMap(marketScenarioNonEmpty).first
            ?? result?.nextObservations.compactMap(marketScenarioNonEmpty).first
            ?? "当前还没有明确的下一观察问题；先补齐研究来源。"
    }

    private func marketScenarioFreshness(
        report: TwoLayerReportData?,
        result: WeinsteinTechnicalAnalysisEnvelope?
    ) -> String {
        guard portfolioTrendLoadedIdentity == marketPortfolioTrendLoadIdentity else {
            return "正在读取当前股票的市场、行业、周线与研究情景。"
        }
        let research = report.map { $0.isCurrentExact ? "当前确认研究判断" : "上次有效研究判断" }
            ?? marketScenarioMessage
        return "\(research) · 市场环境截至 \(marketEnvironmentEnvelope.asOf ?? "时间未记录") · 周线分析日 \(result?.analysisAsOf ?? "未记录") · 完成周 \(result?.completedWeekEnd ?? "未记录")"
    }

    private func marketScenarioConfirmedReport(for membership: CandidateMembershipData) -> TwoLayerReportData? {
        guard let workspace = marketScenarioResearchWorkspace(for: membership),
              let data = workspace.data else { return nil }
        let confirmedIds = Set(data.decisions.filter { $0.decision == "confirmed" }.map(\.reportId))
        let confirmed = data.reports
            .filter { confirmedIds.contains($0.id) }
            .sorted { $0.version > $1.version }
        return confirmed.first(where: { $0.payload.adviceLayer != nil }) ?? confirmed.first
    }

    private func marketScenarioResearchWorkspace(
        for membership: CandidateMembershipData
    ) -> FrozenResearchEvidenceWorkspace? {
        let identity = "\(membership.id):\(membership.version):\(membership.symbol)"
        guard marketScenarioMembershipIdentity == identity,
              let workspace = marketScenarioWorkspace,
              workspace.data?.target.membershipId == membership.id,
              workspace.data?.target.membershipVersion == membership.version,
              workspace.data?.target.symbol == membership.symbol,
              workspace.isFreshForCurrentResearch
                || (workspace.metadata.freshness == "stale"
                    && workspace.metadata.stale
                    && !workspace.metadata.missing
                    && !workspace.metadata.conflict) else { return nil }
        return workspace
    }

    private func marketScenarioFragment(_ scenarios: [String]?, prefixes: [String]) -> String? {
        scenarios?
            .flatMap { $0.split(whereSeparator: { $0 == ";" || $0 == "；" || $0.isNewline }) }
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { fragment in
                let normalized = fragment.lowercased()
                return prefixes.contains { normalized.hasPrefix($0) }
            }
    }

    private func marketScenarioVariableLabel(_ variable: String) -> String {
        switch variable {
        case "overseas_manufacturing_capacity": "海外制造产能"
        case "nev_sales_mix": "新能源车型销量结构"
        case "overseas_localized_production": "海外本地化生产"
        case "domestic_competition_and_margin": "国内竞争与利润率"
        case "overseas_trade_barriers": "海外贸易壁垒"
        case "average_selling_price_and_gross_margin": "平均售价与毛利率"
        case "liquidity_and_leverage": "流动性与杠杆"
        default: variable.replacingOccurrences(of: "_", with: " ")
        }
    }

    private func marketScenarioNonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func marketCandidateReason(_ membership: CandidateMembershipData) -> String {
        guard candidateOverview.status == .available,
              let candidate = candidateOverview.candidates.first(where: { $0.symbol == membership.symbol }) else {
            return "你已明确加入持续跟踪；更具体的研究理由待核对。"
        }
        if candidate.reviewDue { return "你已持续跟踪；研究复核已到期，需要核对判断是否仍成立。" }
        if candidate.pendingSuggestionCount > 0 {
            return "你已持续跟踪；有 \(candidate.pendingSuggestionCount) 条未处理研究提示。"
        }
        if candidate.evidenceCount > 0 {
            return "你已持续跟踪；现有研究包含 \(candidate.evidenceCount) 条证据，下一复核 \(candidate.nextReviewOn ?? "待明确")。"
        }
        return "你已明确加入持续跟踪；研究证据和复核理由仍待补齐。"
    }

    private func marketTrendStage(_ stage: String, direction: String) -> String {
        let label = switch stage {
        case "STAGE_1": "筑底阶段"
        case "STAGE_2": "上升阶段"
        case "STAGE_3": "转弱阶段"
        case "STAGE_4": "下降阶段"
        case "TRANSITION": "过渡阶段"
        default: "阶段待确认"
        }
        return "\(label) · 30 周线 \(marketDirection(direction))"
    }

    private func marketDirection(_ value: String) -> String {
        switch value { case "RISING": "向上"; case "FLAT": "走平"; case "FALLING": "向下"; default: "方向待确认" }
    }

    private func marketStagePhase(_ value: String) -> String {
        switch value { case "EARLY": "早期"; case "MID": "中期"; case "LATE": "后期"; case "NOT_APPLICABLE": "阶段内位置不适用"; default: "阶段待确认" }
    }

    private func marketSectorStrength(_ value: String) -> String {
        switch value { case "LEADING": "行业领先"; case "IMPROVING": "行业改善"; case "NEUTRAL": "行业中性"; case "WEAKENING": "行业转弱"; case "LAGGING": "行业落后"; default: "行业强弱待确认" }
    }

    private func marketVolume(_ value: String) -> String {
        switch value { case "VERY_STRONG": "很强"; case "STRONG": "强"; case "NORMAL": "正常"; case "WEAK": "弱"; default: "成交量待确认" }
    }

    private func marketRelativeStrength(_ value: String) -> String {
        switch value { case "STRENGTHENING": "增强"; case "NEUTRAL": "中性"; case "WEAKENING": "转弱"; default: "相对强弱待确认" }
    }

    private func marketEntryState(_ value: String) -> String {
        switch value {
        case "WATCH": "观察"
        case "BASE_FORMING": "底部结构形成中"
        case "BREAKOUT_WATCH": "突破观察"
        case "BREAKOUT_CONFIRMED": "突破证据已确认"
        case "RETEST_WATCH": "回测观察"
        case "HOLD_STAGE_2": "上升阶段延续"
        case "STAGE_3_WARNING": "转弱阶段风险警示"
        case "REDUCE": "风险收紧"
        case "EXIT": "下降阶段风险确认"
        default: "无需新增动作"
        }
    }

    @MainActor
    func loadMarketPortfolioTrends() async {
        let identity = marketPortfolioTrendLoadIdentity
        let requestId = UUID()
        portfolioTrendRequestId = requestId
        portfolioTrendLoadedIdentity = nil
        portfolioTrendEnvelopes = [:]
        weinsteinEnvelope = nil
        weinsteinMessage = nil
        marketScenarioWorkspace = nil
        marketScenarioMembershipIdentity = nil
        marketScenarioMessage = "正在读取当前股票的研究情景..."
        isLoadingPortfolioTrends = true
        guard candidateMemberships.status == .available else {
            portfolioTrendMessage = "研究清单不可用，旧比较已隐藏。"
            marketScenarioMessage = "研究清单不可用，暂不显示旧研究情景。"
            isLoadingPortfolioTrends = false
            return
        }
        let memberships = marketTrackedMemberships
        guard !memberships.isEmpty else {
            portfolioTrendMessage = "当前没有持续跟踪的股票。"
            marketScenarioMessage = "当前没有持续跟踪的股票。"
            portfolioTrendLoadedIdentity = identity
            isLoadingPortfolioTrends = false
            return
        }
        let context = AppEnvironment.researchAuthorizationContext()
        let analysisAsOf = currentHongKongRequestDate()
        let client = WeinsteinTechnicalAnalysisClient(
            baseURL: context.baseURL,
            authToken: context.readToken,
            authHeaderName: context.readHeaderName
        )
        var loaded: [String: WeinsteinTechnicalAnalysisEnvelope] = [:]
        for membership in memberships {
            if let result = try? await client.fetch(
                market: membership.market,
                code: membership.code,
                analysisAsOf: analysisAsOf
            ) {
                loaded[membership.id] = result
            }
            guard portfolioTrendRequestId == requestId,
                  marketPortfolioTrendLoadIdentity == identity,
                  AppEnvironment.researchAuthorizationContext() == context else { return }
        }
        let selectedMembership = marketSelectedTrackedMembership
        var scenarioWorkspace: FrozenResearchEvidenceWorkspace?
        if let selectedMembership {
            let researchClient = ResearchClient(
                baseURL: context.baseURL,
                authToken: context.readToken,
                authHeaderName: context.readHeaderName
            )
            scenarioWorkspace = try? await researchClient.fetchFrozenResearchEvidence(
                membership: selectedMembership
            )
        }
        guard portfolioTrendRequestId == requestId,
              marketPortfolioTrendLoadIdentity == identity,
              AppEnvironment.researchAuthorizationContext() == context else { return }
        portfolioTrendEnvelopes = loaded
        if let selectedMembership,
           let selectedTrend = loaded[selectedMembership.id],
           selectedTrend.symbol == selectedMembership.symbol,
           selectedTrend.analysisAsOf == analysisAsOf {
            weinsteinEnvelope = selectedTrend
            weinsteinMessage = "周线阶段已按同一分析日从只读来源取得；日线只用于时点核对。"
        }
        marketScenarioWorkspace = scenarioWorkspace
        marketScenarioMembershipIdentity = selectedMembership.map { "\($0.id):\($0.version):\($0.symbol)" }
        marketScenarioMessage = selectedMembership == nil
            ? "当前股票尚未进入每日研究范围。"
            : scenarioWorkspace == nil
                ? "当前股票尚无可用研究档案。"
                : "已读取当前股票研究档案；未确认判断不会冒充正式结论。"
        portfolioTrendLoadedIdentity = identity
        portfolioTrendMessage = "已读取 \(loaded.count)/\(memberships.count) 只真实完成周线；数据不足的股票会单独说明。"
        isLoadingPortfolioTrends = false
    }
}
