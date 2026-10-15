import Charts
import SwiftUI

public enum WeinsteinTechnicalChartContext: Equatable, Sendable {
    case frozenResearch
    case currentObservation
    case historicalObservation
}

/// One reading of the server's seven factors and structural output across
/// Today, Market, Research and the chart. It does not recalculate a score.
public struct WeinsteinDecisionSummaryView: View {
    let envelope: WeinsteinTechnicalAnalysisEnvelope?
    let label: String

    public init(envelope: WeinsteinTechnicalAnalysisEnvelope?, label: String = "当前周线观察 · 未冻结") {
        self.envelope = envelope
        self.label = label
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.headline)
            if let value = envelope, value.status == "available" {
                Text("大盘 \(value.marketStage) · 行业 \(value.sectorStage) · 个股 \(value.stockStage)")
                    .font(.subheadline.weight(.semibold))
                Text("确定性评分 \(value.totalScore.map { String($0) } ?? "UNKNOWN") / 100 · 原始三重确认 \(value.tripleConfirmation)")
                    .font(.subheadline.monospacedDigit())
                Text("机器状态 \(value.entryState) · 切入质量 \(value.entryQuality) · 量 \(value.volumeConfirmation) · RS \(value.relativeStrengthStatus)")
                    .font(.caption)
                Text(structuralBoundary(value)).font(.caption).foregroundStyle(.orange)
                DisclosureGroup("七项评分依据") {
                    ForEach(value.scoreFactors, id: \.id) { factor in
                        Text("\(factor.label)：\(factor.score)/\(factor.maxScore) · \(factor.assessment)")
                            .font(.caption)
                    }
                }
                Text("分析 \(value.analysisAsOf) · 完成周 \(value.completedWeekEnd ?? "UNKNOWN") · 规则 \(value.computationVersion) · 结果 \(value.resultHash?.prefix(12) ?? "UNKNOWN")…")
                    .font(.caption2).foregroundStyle(.secondary)
            } else if let value = envelope {
                Text("DATA_INSUFFICIENT · 大盘、行业和个股阶段均待来源补足；不计算评分或切入。")
                    .font(.subheadline).foregroundStyle(.orange)
                Text(value.nextObservations.first ?? value.summary).font(.caption)
            } else {
                Text("周线尚未读取；当前没有可引用的阶段、分数或技术判断。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Text("低分不自动卖出；阶段与市场结构限制不能由总分抵消。")
                .font(.caption2).foregroundStyle(.secondary)
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityIdentifier("weinsteinDecisionSummary")
    }

    private func structuralBoundary(_ value: WeinsteinTechnicalAnalysisEnvelope) -> String {
        if value.stockStage == "STAGE_4" { return "结构约束：个股 Stage 4；评分不能覆盖该阶段风险。" }
        if value.marketStage != "STAGE_2" { return "结构约束：大盘非 Stage 2；以机器原始切入状态为准。" }
        if value.sectorStage != "STAGE_2" || ["WEAKENING", "LAGGING"].contains(value.sectorStrength) {
            return "结构约束：行业阶段或强度不足；总分不能替代行业确认。"
        }
        return "结构核对：遵循机器原始阶段、切入状态及三重确认；Owner 决定另行作出。"
    }
}

/// Current observation may use the last completed daily session before today's weekly analysis.
/// Frozen research keeps its separate exact binding and cutoff requirements.
func currentObservationDailyCutoffAllowed(
    requestCutoff: String, lastCompletedSession: String, observationAsOf: String
) -> Bool {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.isLenient = false
    let dates = [requestCutoff, lastCompletedSession, observationAsOf]
    guard dates.allSatisfy({ value in
        value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
            && formatter.date(from: value) != nil
    }) else { return false }
    return lastCompletedSession <= requestCutoff && requestCutoff <= observationAsOf
}

public struct ResearchWeinsteinTechnicalAnalysisView: View {
    private let envelope: WeinsteinTechnicalAnalysisEnvelope?
    private let dailyEnvelope: MarketDailyTechnicalEnvelope?
    private let frozenBinding: FrozenWeinsteinEvidenceBinding?
    private let context: WeinsteinTechnicalChartContext
    private let expectedSymbol: String?
    private let observationAsOf: String?
    private let historicalPrice: HistoricalWeeklyPrice?
    @State private var weeklyRange = WeeklyRange.fiveYears
    @State private var dailyRange = DailyRange.sixMonths
    @State private var showMa30 = true
    @State private var showZones = true
    @State private var showVolume = true
    @State private var showRelativeStrength = true
    @State private var showDailyMa = true
    @State private var showDailyVolume = true
    @State private var showBollinger = false
    @State private var showMacd = false
    @State private var showRsi = false
    @State private var dailyExpanded = false
    @State private var weeklySelection: String?
    @State private var dailySelection: String?
    @State private var zoom: CGFloat = 1
    @GestureState private var pinch: CGFloat = 1

    public init(
        envelope: WeinsteinTechnicalAnalysisEnvelope?,
        dailyEnvelope: MarketDailyTechnicalEnvelope?,
        frozenBinding: FrozenWeinsteinEvidenceBinding? = nil,
        context: WeinsteinTechnicalChartContext = .frozenResearch,
        expectedSymbol: String? = nil,
        observationAsOf: String? = nil,
        historicalPrice: HistoricalWeeklyPrice? = nil
    ) {
        self.envelope = envelope
        self.dailyEnvelope = dailyEnvelope
        self.frozenBinding = frozenBinding
        self.context = context
        self.expectedSymbol = expectedSymbol
        self.observationAsOf = observationAsOf
        self.historicalPrice = historicalPrice
    }

    public var body: some View {
        let weekly = visibleWeekly
        VStack(alignment: .leading, spacing: 14) {
            WeinsteinDecisionSummaryView(envelope: weekly,
                label: context == .frozenResearch ? "研究周线判断 · 冻结状态见下方" : "当前周线观察 · 未冻结")
            WeinsteinTechnicalAnalysisView(envelope: weekly, showsFullEvidence: true)
            if context == .currentObservation {
                Text("当前行情观察 · 非冻结研究结论。日线和周线分别按自己的已完成交易时段读取。")
                    .font(.caption).foregroundStyle(.secondary)
                    .accessibilityIdentifier("currentWeinsteinObservationBoundary")
            }
            if context == .historicalObservation {
                Text("历史截止日观察 · 只使用该日前已完成交易时段；不含当日报价或事后行业归属。")
                    .font(.caption).foregroundStyle(.secondary)
                    .accessibilityIdentifier("historicalWeinsteinObservationBoundary")
            }
            if let weekly, weekly.status == "available" {
                score(weekly)
                if context == .frozenResearch { freezeStatus(weekly) }
                weeklyCharts(weekly)
            } else if context == .historicalObservation, let historicalPrice {
                historicalPriceCharts(historicalPrice)
            } else if context != .frozenResearch {
                Text("周线图暂不可用；已取得的日线仍可单独阅读和操作。")
                    .font(.caption).foregroundStyle(.orange)
            }
            if context != .frozenResearch || weekly?.status == "available" {
                DisclosureGroup("日线辅助 · 展开查看", isExpanded: $dailyExpanded) {
                    dailyCharts(weekly)
                }
                .accessibilityIdentifier("researchWeinsteinDailyDisclosure")
            }
        }
        .onChange(of: weeklyRange) { _ in weeklySelection = nil }
        .onChange(of: dailyRange) { _ in dailySelection = nil }
        .onChange(of: dailyExpanded) { expanded in
            if !expanded { dailySelection = nil }
        }
        .onChange(of: chartIdentity) { _ in
            weeklySelection = nil
            dailySelection = nil
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchWeinsteinWorkspace")
    }

    private var chartIdentity: String {
        [context == .frozenResearch ? "frozen" : context == .historicalObservation ? "historical" : "current",
         expectedSymbol ?? envelope?.symbol ?? historicalPrice?.symbol ?? "",
         observationAsOf ?? "", envelope?.resultHash ?? "",
         dailyEnvelope?.technical.resultHash ?? "", dailyEnvelope?.dailyBars.snapshot?.snapshotSha ?? "",
         historicalPrice?.fetchedAt ?? "",
         historicalPrice?.completedWeekEnd ?? ""].joined(separator: "|")
    }

    private var visibleWeekly: WeinsteinTechnicalAnalysisEnvelope? {
        guard context != .frozenResearch else { return envelope }
        guard let envelope, let expectedSymbol, let observationAsOf,
              envelope.symbol == expectedSymbol,
              (context == .historicalObservation
                ? envelope.analysisAsOf == observationAsOf
                : envelope.analysisAsOf <= observationAsOf) else { return nil }
        return envelope
    }

    private func historicalPriceCharts(_ value: HistoricalWeeklyPrice) -> some View {
        let points = Array(value.bars.suffix(weeklyRange.weeks ?? value.bars.count))
        let selected = points.first(where: { $0.session == weeklySelection })
        let width = max(680, CGFloat(points.count) * 8 * zoom * pinch)
        return VStack(alignment: .leading, spacing: 12) {
            Text("历史个股周 K · 价格与成交量").font(.headline)
            Text("分析截止 \(value.analysisAsOf) · 最近完成周 \(value.completedWeekEnd) · Futu 前复权历史 · 读取 \(value.fetchedAt)；历史行业归属、阶段与相对行业强弱 UNKNOWN。")
                .font(.caption).foregroundStyle(.secondary)
            Picker("周线区间", selection: $weeklyRange) {
                ForEach(WeeklyRange.allCases) { Text($0.label).tag($0) }
            }.pickerStyle(.segmented)
            ScrollView(.horizontal, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 12) {
                    chartCard("价格 · 周 K", height: 280) {
                        ForEach(points, id: \.session) { point in
                            RuleMark(x: .value("完成周", point.session), yStart: .value("低", point.low), yEnd: .value("高", point.high))
                                .foregroundStyle(point.close >= point.open ? Color.red : Color.green)
                            RectangleMark(x: .value("完成周", point.session), yStart: .value("开", point.open), yEnd: .value("收", point.close), width: .ratio(0.55))
                                .foregroundStyle(point.close >= point.open ? Color.red.opacity(0.75) : Color.green.opacity(0.75))
                        }
                        if let selected {
                            RuleMark(x: .value("十字线", selected.session)).foregroundStyle(.secondary)
                                .annotation(position: .top) { crosshair(selected.session, selected.close) }
                        }
                    }.chartOverlay { proxy in chartSelectionOverlay(proxy: proxy, selection: $weeklySelection) }
                    if showVolume {
                        chartCard("周成交量", height: 110) {
                            ForEach(points, id: \.session) { point in
                                BarMark(x: .value("完成周", point.session), y: .value("成交量", point.volume))
                                    .foregroundStyle(point.close >= point.open ? Color.red.opacity(0.55) : Color.green.opacity(0.55))
                            }
                        }
                    }
                }.frame(width: width, alignment: .leading)
            }
            .simultaneousGesture(MagnificationGesture()
                .updating($pinch) { value, state, _ in state = value }
                .onEnded { value in zoom = min(4, max(0.75, zoom * value)) })
            .accessibilityIdentifier("historicalWeinsteinWeeklyScrollableChart")
            selectionControls(points.map(\.session), selection: $weeklySelection, label: "周线")
            if let selected {
                selectedBarDetails(session: selected.session, open: selected.open, high: selected.high,
                    low: selected.low, close: selected.close, volume: selected.volume, indicators: [])
            }
            Toggle("成交量", isOn: $showVolume).toggleStyle(.button)
            Text("单指横向拖动 · 双指缩放 · 长按图表选择周线。没有历史行业证据时不生成阶段或切入判断。")
                .font(.caption).foregroundStyle(.secondary)
        }.padding(14).background(cardBackground, in: RoundedRectangle(cornerRadius: 10))
    }

    private func score(_ value: WeinsteinTechnicalAnalysisEnvelope) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("确定性总分").font(.headline)
                Spacer()
                Text(value.totalScore.map { "\($0) / 100" } ?? "UNKNOWN")
                    .font(.title2.monospacedDigit().weight(.bold))
                    .accessibilityIdentifier("researchWeinsteinTotalScore")
            }
            ForEach(value.scoreFactors, id: \.id) { factor in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(factor.label).font(.caption.weight(.semibold))
                        Spacer()
                        Text("\(factor.score) / \(factor.maxScore)").font(.caption.monospacedDigit())
                    }
                    ProgressView(value: Double(factor.score), total: Double(factor.maxScore))
                    Text(factor.assessment).font(.caption2).foregroundStyle(.secondary)
                }
            }
            Text("分数只压缩已验证的阶段、结构、量能、相对强度和风险；不预测价格，也不生成交易动作。")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .background(cardBackground, in: RoundedRectangle(cornerRadius: 10))
        .accessibilityIdentifier("researchWeinsteinScoreFactors")
    }

    @ViewBuilder private func freezeStatus(_ value: WeinsteinTechnicalAnalysisEnvelope) -> some View {
        let reasons = frozenBinding?.invalidatedBy(value) ?? ["weinstein_frozen_binding_missing"]
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: reasons.isEmpty ? "checkmark.shield" : "exclamationmark.shield")
            VStack(alignment: .leading, spacing: 3) {
                Text(reasons.isEmpty ? "已绑定当前冻结证据" : "冻结绑定为 UNKNOWN / 已漂移")
                    .font(.subheadline.weight(.semibold))
                Text(reasons.isEmpty
                    ? "当前 Weinstein resultHash 与冻结身份一致。"
                    : "未显示旧冻结结论；原因：\(reasons.joined(separator: ", "))。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .background((reasons.isEmpty ? Color.green : Color.orange).opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityIdentifier("researchWeinsteinFreezeCurrentness")
    }

    private func weeklyCharts(_ value: WeinsteinTechnicalAnalysisEnvelope) -> some View {
        let points = Array(value.weeklyChart.suffix(weeklyRange.weeks ?? value.weeklyChart.count))
        let selected = points.first(where: { $0.session == weeklySelection })
        let width = max(680, CGFloat(points.count) * 8 * zoom * pinch)
        return VStack(alignment: .leading, spacing: 12) {
            Text("周线主分析").font(.headline)
            Text("周线分析日 \(value.analysisAsOf) · 最近完成周 \(value.completedWeekEnd ?? "UNKNOWN") · 来源 \(value.provider ?? "UNKNOWN")")
                .font(.caption).foregroundStyle(.secondary)
            Picker("周线区间", selection: $weeklyRange) {
                ForEach(WeeklyRange.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("researchWeinsteinWeeklyRange")
            Text("实际周线 \(points.first?.session ?? "UNKNOWN") 至 \(points.last?.session ?? "UNKNOWN") · \(points.count) 个完成周")
                .font(.caption).foregroundStyle(.secondary)
            if let requested = weeklyRange.weeks, points.count < requested {
                Text("当前来源不足所选 \(weeklyRange.label) 的 \(requested) 个完成周；只显示已有周线，不补造历史。")
                    .font(.caption).foregroundStyle(.orange)
            }
            ScrollView(.horizontal, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 12) {
                    weeklyPriceChart(points, value: value)
                    if showVolume { weeklyVolumeChart(points) }
                    if showRelativeStrength { weeklyRelativeStrengthChart(points) }
                }
                .frame(width: width, alignment: .leading)
            }
            .simultaneousGesture(MagnificationGesture()
                .updating($pinch) { value, state, _ in state = value }
                .onEnded { value in zoom = min(4, max(0.75, zoom * value)) })
            .accessibilityIdentifier("researchWeinsteinWeeklyScrollableChart")
            selectionControls(points.map(\.session), selection: $weeklySelection, label: "周线")
            if let selected {
                selectedBarDetails(session: selected.session, open: selected.open, high: selected.high,
                    low: selected.low, close: selected.close, volume: selected.volume,
                    indicators: [
                        ("30W", showMa30 ? selected.ma30w : nil),
                        ("相对恒指 RS", showRelativeStrength ? selected.marketRelativeStrength : nil),
                        ("相对行业 RS", showRelativeStrength ? selected.sectorRelativeStrength : nil)
                    ])
            }
            overlayToggles
            Text("单指横向拖动 · 双指缩放 · 长按图表选择周线；周线和 30W/RS 均来自后端确定性结果。")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .background(cardBackground, in: RoundedRectangle(cornerRadius: 10))
    }

    private func weeklyPriceChart(_ points: [WeinsteinWeeklyChartPoint], value: WeinsteinTechnicalAnalysisEnvelope) -> some View {
        let selected = points.first(where: { $0.session == weeklySelection })
        return chartCard("价格 · 周K / 30W / 支撑阻力", height: 280) {
            ForEach(points, id: \.session) { point in
                RuleMark(x: .value("完成周", point.session), yStart: .value("低", point.low), yEnd: .value("高", point.high))
                    .foregroundStyle(point.close >= point.open ? Color.red : Color.green)
                RectangleMark(x: .value("完成周", point.session), yStart: .value("开", point.open), yEnd: .value("收", point.close), width: .ratio(0.55))
                    .foregroundStyle(point.close >= point.open ? Color.red.opacity(0.75) : Color.green.opacity(0.75))
                if showMa30, let ma30w = point.ma30w {
                    LineMark(x: .value("完成周", point.session), y: .value("30W", ma30w), series: .value("覆盖", "30W"))
                        .foregroundStyle(.blue)
                }
            }
            if showZones {
                ForEach(value.supportZones, id: \.firstWeek) { zone in
                    RuleMark(yStart: .value("支撑下沿", zone.lower), yEnd: .value("支撑上沿", zone.upper))
                        .foregroundStyle(.green.opacity(0.15))
                }
                ForEach(value.resistanceZones, id: \.firstWeek) { zone in
                    RuleMark(yStart: .value("阻力下沿", zone.lower), yEnd: .value("阻力上沿", zone.upper))
                        .foregroundStyle(.orange.opacity(0.15))
                }
                if let zone = value.invalidationZone {
                    RuleMark(yStart: .value("失效下沿", zone.lower), yEnd: .value("失效上沿", zone.upper))
                        .foregroundStyle(.red.opacity(0.15))
                }
                if let breakoutLevel = value.breakoutLevel {
                    RuleMark(y: .value("突破参考", breakoutLevel))
                        .foregroundStyle(.orange.opacity(0.6))
                        .lineStyle(StrokeStyle(dash: [4, 4]))
                }
            }
            if let selected {
                RuleMark(x: .value("十字线", selected.session)).foregroundStyle(.secondary)
                    .annotation(position: .top) { crosshair(selected.session, selected.close) }
            }
        }
        .chartOverlay { proxy in chartSelectionOverlay(proxy: proxy, selection: $weeklySelection) }
    }

    private func weeklyVolumeChart(_ points: [WeinsteinWeeklyChartPoint]) -> some View {
        chartCard("周成交量", height: 110) {
            ForEach(points, id: \.session) { point in
                BarMark(x: .value("完成周", point.session), y: .value("成交量", point.volume))
                    .foregroundStyle(point.close >= point.open ? Color.red.opacity(0.55) : Color.green.opacity(0.55))
            }
        }
    }

    private func weeklyRelativeStrengthChart(_ points: [WeinsteinWeeklyChartPoint]) -> some View {
        chartCard("相对强度（首个可比周 = 100）", height: 140) {
            ForEach(points, id: \.session) { point in
                if let market = point.marketRelativeStrength {
                    LineMark(x: .value("完成周", point.session), y: .value("RS", market), series: .value("基准", "相对恒指"))
                        .foregroundStyle(by: .value("基准", "相对恒指"))
                }
                if let sector = point.sectorRelativeStrength {
                    LineMark(x: .value("完成周", point.session), y: .value("RS", sector), series: .value("基准", "相对行业"))
                        .foregroundStyle(by: .value("基准", "相对行业"))
                }
            }
            RuleMark(y: .value("基准", 100)).foregroundStyle(.secondary.opacity(0.35))
        }
    }

    @ViewBuilder private func dailyCharts(_ value: WeinsteinTechnicalAnalysisEnvelope?) -> some View {
        let exactDaily: MarketDailyTechnicalEnvelope? = dailyEnvelope.flatMap { daily in
            if context == .frozenResearch {
                guard let value else { return nil }
                return daily.usableForRequestedCutoff && daily.isBound(to: value.symbol)
                    && daily.dailyBars.request.cutoff == value.analysisAsOf ? daily : nil
            }
            guard let expectedSymbol, let observationAsOf,
                  daily.usableForRequestedCutoff, daily.isBound(to: expectedSymbol),
                  let lastCompleted = daily.dailyBars.snapshot?.lastCompletedSession,
                  context != .historicalObservation || daily.dailyBars.request.cutoff == observationAsOf,
                  currentObservationDailyCutoffAllowed(
                    requestCutoff: daily.dailyBars.request.cutoff,
                    lastCompletedSession: lastCompleted,
                    observationAsOf: observationAsOf
                  ) else { return nil }
            return daily
        }
        if let exactDaily, let technicalPoints = exactDaily.technical.points {
            let points = Array(technicalPoints.suffix(dailyRange.sessions))
            let selected = points.first(where: { $0.session == dailySelection })
            let width = max(680, CGFloat(points.count) * 8 * zoom * pinch)
            VStack(alignment: .leading, spacing: 12) {
                Text("日线时机辅助").font(.headline)
                Text("日线请求截至 \(exactDaily.dailyBars.request.cutoff) · 最近完成交易日 \(exactDaily.dailyBars.snapshot?.lastCompletedSession ?? "UNKNOWN") · 来源 \(exactDaily.dailyBars.source.provider) · 数据截止 \(exactDaily.dailyBars.source.dataCutoffAt ?? "UNKNOWN")")
                    .font(.caption).foregroundStyle(.secondary)
                Picker("日线区间", selection: $dailyRange) {
                    ForEach(DailyRange.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("researchWeinsteinDailyRange")
                Text("实际日线 \(points.first?.session ?? "UNKNOWN") 至 \(points.last?.session ?? "UNKNOWN") · \(points.count) 个完成交易日")
                    .font(.caption).foregroundStyle(.secondary)
                if dailyRange == .twelveMonths && !coversTwelveMonths(points) {
                    Text("当前日线尚不足完整 12 个月；12月按钮仅选择可见窗口，不代表已有完整一年。")
                        .font(.caption).foregroundStyle(.orange)
                }
                ScrollView(.horizontal, showsIndicators: true) {
                    VStack(alignment: .leading, spacing: 12) {
                        dailyPriceChart(points)
                        if showDailyVolume { dailyVolumeChart(points) }
                        if showMacd { dailyMacdChart(points) }
                        if showRsi { dailyRsiChart(points) }
                    }
                    .frame(width: width, alignment: .leading)
                }
                .simultaneousGesture(MagnificationGesture()
                    .updating($pinch) { value, state, _ in state = value }
                    .onEnded { value in zoom = min(4, max(0.75, zoom * value)) })
                .accessibilityIdentifier("researchWeinsteinDailyScrollableChart")
                selectionControls(points.map(\.session), selection: $dailySelection, label: "日线")
                if let selected {
                    selectedBarDetails(session: selected.session, open: selected.candle.open,
                        high: selected.candle.high, low: selected.candle.low, close: selected.candle.close,
                        volume: selected.volume, indicators: [
                            ("MA20", showDailyMa ? selected.ma20 : nil),
                            ("MA60", showDailyMa ? selected.ma60 : nil),
                            ("Boll 中轨", showBollinger ? selected.bollinger20?.middle : nil),
                            ("Boll 上轨", showBollinger ? selected.bollinger20?.upper : nil),
                            ("Boll 下轨", showBollinger ? selected.bollinger20?.lower : nil),
                            ("MACD DIF", showMacd ? selected.macd.line : nil),
                            ("MACD DEA", showMacd ? selected.macd.signal : nil),
                            ("MACD 柱", showMacd ? selected.macd.histogram : nil),
                            ("RSI 14", showRsi ? selected.rsi14 : nil)
                        ])
                }
                ScrollView(.horizontal, showsIndicators: true) {
                    HStack { Toggle("MA20/60", isOn: $showDailyMa); Toggle("成交量", isOn: $showDailyVolume); Toggle("Boll", isOn: $showBollinger); Toggle("MACD", isOn: $showMacd); Toggle("RSI", isOn: $showRsi) }
                        .toggleStyle(.button).font(.caption)
                }
                .accessibilityIdentifier("researchWeinsteinDailyOverlays")
                if showDailyVolume {
                    Text("日成交量与上方日 K 使用同一批已完成交易日；纵轴保留来源原单位，不换算为成交额。无有效成交量的日期不绘制柱形。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Text(context == .frozenResearch
                     ? "日线只细化观察时机，不改变周线阶段。所有指标均来自同一截止日的后端结果。"
                     : "日线只细化观察时机，不改变周线阶段；日、周截止日可不同，不能合算跨期指标。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(14)
            .background(cardBackground, in: RoundedRectangle(cornerRadius: 10))
        } else {
            Text(context == .frozenResearch
                 ? "日线图为 UNKNOWN：需要同一股票、同一 analysisAsOf 的完整完成交易日日线。"
                 : "日线图暂不可用：需同一股票、截止不晚于本次观察日的完整完成交易日日线。")
                .font(.caption).foregroundStyle(.orange)
        }
    }

    private func dailyPriceChart(_ points: [MarketTechnicalPoint]) -> some View {
        let selected = points.first(where: { $0.session == dailySelection })
        return chartCard("价格 · 日K", height: 250) {
            ForEach(points, id: \.session) { point in
                RuleMark(x: .value("交易日", point.session), yStart: .value("低", point.candle.low), yEnd: .value("高", point.candle.high))
                    .foregroundStyle(point.candle.close >= point.candle.open ? Color.red : Color.green)
                RectangleMark(x: .value("交易日", point.session), yStart: .value("开", point.candle.open), yEnd: .value("收", point.candle.close), width: .ratio(0.55))
                    .foregroundStyle(point.candle.close >= point.candle.open ? Color.red.opacity(0.75) : Color.green.opacity(0.75))
                if showDailyMa, let ma20 = point.ma20 { LineMark(x: .value("交易日", point.session), y: .value("价格", ma20), series: .value("覆盖", "MA20")) }
                if showDailyMa, let ma60 = point.ma60 { LineMark(x: .value("交易日", point.session), y: .value("价格", ma60), series: .value("覆盖", "MA60")) }
                if showBollinger, let boll = point.bollinger20 {
                    LineMark(x: .value("交易日", point.session), y: .value("价格", boll.upper), series: .value("覆盖", "Boll上"))
                        .lineStyle(StrokeStyle(dash: [3, 3]))
                    LineMark(x: .value("交易日", point.session), y: .value("价格", boll.lower), series: .value("覆盖", "Boll下"))
                        .lineStyle(StrokeStyle(dash: [3, 3]))
                }
            }
            if let selected {
                RuleMark(x: .value("十字线", selected.session)).foregroundStyle(.secondary)
                    .annotation(position: .top) { crosshair(selected.session, selected.candle.close) }
            }
        }
        .chartOverlay { proxy in chartSelectionOverlay(proxy: proxy, selection: $dailySelection) }
    }

    private func dailyVolumeChart(_ points: [MarketTechnicalPoint]) -> some View {
        let selected = points.first(where: { $0.session == dailySelection })
        return chartCard("日成交量 · 来源原单位", height: 110) {
            ForEach(points, id: \.session) { point in
                if point.volume.isFinite && point.volume >= 0 {
                    BarMark(x: .value("交易日", point.session), y: .value("成交量", point.volume))
                        .foregroundStyle(point.candle.close >= point.candle.open
                            ? Color.red.opacity(0.55) : Color.green.opacity(0.55))
                }
            }
            if let selected {
                RuleMark(x: .value("十字线", selected.session)).foregroundStyle(.secondary)
            }
        }
        .chartOverlay { proxy in chartSelectionOverlay(proxy: proxy, selection: $dailySelection) }
        .accessibilityIdentifier("researchWeinsteinDailyVolumeChart")
    }

    private func dailyMacdChart(_ points: [MarketTechnicalPoint]) -> some View {
        chartCard("MACD 12 / 26 / 9", height: 130) {
            ForEach(points, id: \.session) { point in
                if let histogram = point.macd.histogram { BarMark(x: .value("交易日", point.session), y: .value("MACD", histogram)).foregroundStyle(histogram >= 0 ? Color.red.opacity(0.5) : Color.green.opacity(0.5)) }
                if let line = point.macd.line { LineMark(x: .value("交易日", point.session), y: .value("MACD", line), series: .value("指标", "DIF")) }
                if let signal = point.macd.signal { LineMark(x: .value("交易日", point.session), y: .value("MACD", signal), series: .value("指标", "DEA")) }
            }
            RuleMark(y: .value("零轴", 0)).foregroundStyle(.secondary.opacity(0.35))
        }
    }

    private func dailyRsiChart(_ points: [MarketTechnicalPoint]) -> some View {
        chartCard("RSI 14", height: 110) {
            ForEach(points, id: \.session) { point in
                if let rsi = point.rsi14 { LineMark(x: .value("交易日", point.session), y: .value("RSI", rsi)).foregroundStyle(.purple) }
            }
            RuleMark(y: .value("上界", 70)).foregroundStyle(.orange.opacity(0.5))
            RuleMark(y: .value("下界", 30)).foregroundStyle(.blue.opacity(0.5))
        }
    }

    private var overlayToggles: some View {
        HStack { Toggle("30W", isOn: $showMa30); Toggle("关键区域", isOn: $showZones); Toggle("成交量", isOn: $showVolume); Toggle("RS", isOn: $showRelativeStrength) }
            .toggleStyle(.button).font(.caption)
            .accessibilityIdentifier("researchWeinsteinWeeklyOverlays")
    }

    private func chartCard<Content: ChartContent>(_ title: String, height: CGFloat, @ChartContentBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.weight(.semibold))
            Chart(content: content).chartLegend(position: .bottom, alignment: .leading).frame(height: height)
        }
        .padding(10).background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
    }

    private func chartSelectionOverlay(proxy: ChartProxy, selection: Binding<String?>) -> some View {
        GeometryReader { geometry in
            Rectangle().fill(.clear).contentShape(Rectangle())
                .simultaneousGesture(LongPressGesture(minimumDuration: 0.4)
                    .sequenced(before: DragGesture(minimumDistance: 0))
                    .onChanged { state in
                        guard case .second(true, let drag?) = state else { return }
                        let frame = geometry[proxy.plotAreaFrame]
                        guard frame.contains(drag.location) else { return }
                        selection.wrappedValue = proxy.value(atX: drag.location.x - frame.origin.x)
                    })
                .accessibilityHidden(true)
        }
    }

    private func selectionControls(_ sessions: [String], selection: Binding<String?>, label: String) -> some View {
        HStack(spacing: 12) {
            Button("选择最近\(label)") { selection.wrappedValue = sessions.last }
                .disabled(sessions.isEmpty)
            Button("前一条") {
                guard let current = selection.wrappedValue,
                      let index = sessions.firstIndex(of: current), index > 0 else { return }
                selection.wrappedValue = sessions[index - 1]
            }
            .disabled(selection.wrappedValue.flatMap(sessions.firstIndex(of:)) == nil
                || selection.wrappedValue.flatMap(sessions.firstIndex(of:)) == 0)
            Button("后一条") {
                guard let current = selection.wrappedValue,
                      let index = sessions.firstIndex(of: current), index + 1 < sessions.count else { return }
                selection.wrappedValue = sessions[index + 1]
            }
            .disabled(selection.wrappedValue.flatMap(sessions.firstIndex(of:)) == nil
                || selection.wrappedValue.flatMap(sessions.firstIndex(of:)) == sessions.count - 1)
        }
        .font(.caption)
        .accessibilityIdentifier(label == "日线" ? "researchWeinsteinDailySelectionControls"
            : "researchWeinsteinWeeklySelectionControls")
    }

    private func selectedBarDetails(session: String, open: Double, high: Double, low: Double,
                                    close: Double, volume: Double,
                                    indicators: [(String, Double?)]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("十字线所选数据 · \(session)").font(.caption.weight(.semibold))
            Text("开 \(chartNumber(open)) · 高 \(chartNumber(high)) · 低 \(chartNumber(low)) · 收 \(chartNumber(close))")
            Text("成交量 \(volume.formatted(.number))")
            ForEach(indicators.compactMap { name, value in value.map { (name, $0) } }, id: \.0) { name, value in
                Text("\(name) \(chartNumber(value))")
            }
        }
        .font(.caption.monospacedDigit())
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("researchWeinsteinSelectedBarDetails")
    }

    private func chartNumber(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(2)))
    }

    private func coversTwelveMonths(_ points: [MarketTechnicalPoint]) -> Bool {
        guard let first = points.first?.session, let last = points.last?.session else { return false }
        let formatter = DateFormatter()
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        guard let firstDate = formatter.date(from: first), let lastDate = formatter.date(from: last),
              let yearLater = calendar.date(byAdding: .month, value: 12, to: firstDate) else { return false }
        return lastDate >= yearLater
    }

    private func crosshair(_ session: String, _ close: Double) -> some View {
        Text("\(session) · \(close.formatted(.number.precision(.fractionLength(2))))")
            .font(.caption2.monospacedDigit()).padding(4).background(.thinMaterial, in: RoundedRectangle(cornerRadius: 4))
    }

    private var cardBackground: Color {
#if os(iOS)
        Color(uiColor: .secondarySystemGroupedBackground)
#else
        Color(nsColor: .windowBackgroundColor)
#endif
    }
}

private enum WeeklyRange: String, CaseIterable, Identifiable {
    case twoYears, threeYears, fiveYears, all
    var id: Self { self }
    var label: String { [Self.twoYears: "2年", .threeYears: "3年", .fiveYears: "5年", .all: "全部"][self]! }
    var weeks: Int? { [Self.twoYears: 104, .threeYears: 156, .fiveYears: 260][self] }
}

private enum DailyRange: String, CaseIterable, Identifiable {
    case oneMonth, threeMonths, sixMonths, twelveMonths
    var id: Self { self }
    var label: String { [Self.oneMonth: "1月", .threeMonths: "3月", .sixMonths: "6月", .twelveMonths: "12月"][self]! }
    var sessions: Int { [Self.oneMonth: 22, .threeMonths: 66, .sixMonths: 132, .twelveMonths: 264][self]! }
}
