import Charts
import SwiftUI

public struct MarketDailyTechnicalView: View {
    private let envelope: MarketDailyTechnicalEnvelope?
    private let isRetained: Bool

    public init(envelope: MarketDailyTechnicalEnvelope?, isRetained: Bool = false) {
        self.envelope = envelope
        self.isRetained = isRetained
    }

    public var body: some View {
        if let envelope {
            envelopeContent(envelope)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("日线与技术指标")
                    .font(.headline)
                Text("尚未选择股票。请使用全局搜索输入标准港股代码 HK.#####；未选择时不会发送请求。")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("marketDailyUnselected")
            }
            .padding(16)
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(Color.white.opacity(0.85), lineWidth: 1)
            }
        }
    }

    private func envelopeContent(_ envelope: MarketDailyTechnicalEnvelope) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("日线与技术指标")
                    .font(.headline)
                Spacer()
                Text(statusLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(envelope.dailyBars.source.provider == "fixture" || isLastValid ? .orange : envelope.usableForRequestedCutoff ? .green : .orange)
                    .accessibilityIdentifier("marketDailyStatus")
            }

            Text(envelope.dailyBars.request.symbol)
                .font(.callout.weight(.semibold))
                .accessibilityIdentifier("marketDailySymbol")

            if let snapshot = envelope.dailyBars.snapshot,
               let point = envelope.technical.points?.last,
               envelope.usableForRequestedCutoff {
                let trend = trendPresentation(point)
                VStack(alignment: .leading, spacing: 6) {
                    if envelope.dailyBars.source.provider == "fixture" {
                        Text("测试样本，仅用于界面验证；不是实时或真实行情。")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.orange)
                            .accessibilityIdentifier("marketDailyFixtureWarning")
                    }
                    Text(trend.label)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(trend.color)
                        .accessibilityIdentifier("marketDailyTrend")
                    Text(trend.detail)
                        .font(.subheadline)
                    Text("截至 \(snapshot.lastCompletedSession) · 日线观察")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    dailyIdentityLine(envelope)
                }

                DisclosureGroup("图表、均线与技术指标") {
                    VStack(alignment: .leading, spacing: 8) {
                        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                            GridRow { indicator("MA20", number(point.ma20)); indicator("MA60", number(point.ma60)) }
                            GridRow { indicator("MACD 柱", number(point.macd.histogram)); indicator("RSI14", number(point.rsi14)) }
                        }
                        .accessibilityIdentifier("marketDailyKeyIndicators")
                        DailyCandlestickVolumeChart(points: envelope.technical.points ?? [])
                            .accessibilityIdentifier("marketDailyCandlestickVolumeChart")
                        DisclosureGroup("数据与计算详情") {
                            VStack(alignment: .leading, spacing: 8) {
                                row("日K OHLC", formatOHLC(point.candle))
                                row("成交量", number(point.volume))
                                row("MA20 / MA60", "\(number(point.ma20)) / \(number(point.ma60))")
                                row("MACD 12/26/9", "\(number(point.macd.line)) / \(number(point.macd.signal)) / \(number(point.macd.histogram))")
                                row("Bollinger 20±2", bollingerText(point.bollinger20))
                                row("Wilder RSI14", number(point.rsi14))
                                row("截至交易日", snapshot.lastCompletedSession)
                                row("数据截止", envelope.dailyBars.source.dataCutoffAt ?? "未提供")
                                row("抓取时间", envelope.dailyBars.source.fetchedAt ?? "未提供")
                                row("来源", "\(marketDailyProviderLabel(envelope.dailyBars.source.provider)) · \(envelope.dailyBars.source.endpoint ?? "未提供")")
                                row("数据使用确认", "rights=\(envelope.dailyBars.source.rights), retention=\(envelope.dailyBars.source.retention), derived=\(envelope.dailyBars.source.derivedUse)")
                                row("计算版本", envelope.technical.computationVersion)
                                row("快照", abbreviated(snapshot.snapshotSha))
                                row("结果", abbreviated(envelope.technical.resultHash))
                                Text("日线指标截至上方交易日，仅描述技术位置，不是交易建议。")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.top, 6)
                        }
                    }
                    .padding(.top, 6)
                }
            } else {
                Text("暂未取得可用的完成交易日日线与技术指标。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                dailyIdentityLine(envelope)
                DisclosureGroup("查看原因与截止信息") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(envelope.dailyBars.message)
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("marketDailyUnavailableMessage")
                        Text(envelope.technical.message)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("marketTechnicalUnavailableMessage")
                        row("cutoff", envelope.dailyBars.request.cutoff)
                        row("数据截止", envelope.dailyBars.source.dataCutoffAt ?? "未提供")
                        row("抓取时间", envelope.dailyBars.source.fetchedAt ?? "未提供")
                    }
                    .padding(.top, 6)
                }
            }
        }
        .padding(16)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Color.white.opacity(0.85), lineWidth: 1)
        }
        .shadow(color: Color.blue.opacity(0.08), radius: 18, y: 8)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("marketDailyTechnicalCard")
    }

    private func row(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.monospacedDigit())
                .textSelection(.enabled)
        }
    }

    private func indicator(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline.monospacedDigit())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func trendPresentation(_ point: MarketTechnicalPoint) -> (label: String, detail: String, color: Color) {
        guard let ma20 = point.ma20, let ma60 = point.ma60, let histogram = point.macd.histogram else {
            return ("趋势待确认", "核心指标尚不完整。", .secondary)
        }
        if point.candle.close >= ma20, ma20 >= ma60, histogram >= 0 {
            return ("技术趋势偏强", "收盘位于 MA20 与 MA60 上方，MACD 柱为非负。", .red)
        }
        if point.candle.close <= ma20, ma20 <= ma60, histogram <= 0 {
            return ("技术趋势偏弱", "收盘位于 MA20 与 MA60 下方，MACD 柱为非正。", .green)
        }
        return ("技术趋势分化", "均线位置与 MACD 方向尚未形成一致信号。", .orange)
    }

    private var statusLabel: String {
        if let session = envelope?.dailyBars.snapshot?.lastCompletedSession,
           envelope?.usableForRequestedCutoff == true {
            if isRetained || isLastValid { return "上次有效 · 截至 \(session)" }
            return envelope?.dailyBars.source.provider == "fixture" ? "测试样本 · 截至 \(session)" : "截至 \(session)"
        }
        return "暂不可用"
    }

    private var isLastValid: Bool {
        envelope?.dailyBars.metadata?.message.contains("上次有效日线") == true
    }

    private func dailyIdentityLine(_ envelope: MarketDailyTechnicalEnvelope) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("来源 \(marketDailyProviderLabel(envelope.dailyBars.source.provider)) · 数据截止 \(envelope.dailyBars.source.dataCutoffAt ?? "未提供")")
            Text("读取 \(envelope.dailyBars.source.fetchedAt ?? "未提供") · 数据状态 \(dailyFreshnessLabel(envelope))")
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("marketDailyFreshness")
    }

    private func dailyFreshnessLabel(_ envelope: MarketDailyTechnicalEnvelope) -> String {
        if envelope.dailyBars.source.provider == "fixture" { return "测试样本 · 非真实" }
        if envelope.dailyBars.status == .unavailable { return "不可用" }
        if isRetained || envelope.dailyBars.metadata?.message.contains("上次有效日线") == true {
            return "上次有效 · 非实时"
        }
        switch envelope.dailyBars.metadata?.freshness {
        case "fresh": return "本次读取"
        case "stale": return "已陈旧 · 非实时"
        case "unknown": return "新鲜度未确认"
        default: return "待补齐"
        }
    }

    private func number(_ value: Double?) -> String {
        value.map { String(format: "%.4f", $0) } ?? "未提供"
    }

    private func formatOHLC(_ candle: MarketTechnicalCandle) -> String {
        "O \(number(candle.open)) · H \(number(candle.high)) · L \(number(candle.low)) · C \(number(candle.close))"
    }

    private func bollingerText(_ value: MarketBollingerPoint?) -> String {
        guard let value else { return "未提供" }
        return "mid \(number(value.middle)) · upper \(number(value.upper)) · lower \(number(value.lower)) · σ \(number(value.standardDeviation))"
    }

    private func abbreviated(_ value: String?) -> String {
        guard let value else { return "未提供" }
        return "\(value.prefix(12))…\(value.suffix(8))"
    }

    private func marketDailyProviderLabel(_ provider: String) -> String {
        switch provider {
        case "futu_opend", "futu_history_kline", "futu": "Futu 行情（只读）"
        case "fixture": "测试样本"
        case "cache": "本地缓存"
        default: provider
        }
    }
}

private struct DailyCandlestickVolumeChart: View {
    let points: [MarketTechnicalPoint]
    @State private var sessionCount = 30

    private var visible: [MarketTechnicalPoint] {
        Array(points.suffix(sessionCount))
    }

    private var chartWidth: CGFloat {
        max(340, CGFloat(visible.count) * 7)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Picker("历史区间", selection: $sessionCount) {
                Text("30日").tag(30)
                Text("60日").tag(60)
                Text("120日").tag(120)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("marketTechnicalSessionRange")

            ScrollView(.horizontal, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 14) {
                    technicalChart("价格 · 日K / MA / Bollinger", height: 230) {
                        ForEach(visible, id: \.session) { point in
                            RuleMark(
                                x: .value("交易日", point.session),
                                yStart: .value("最低", point.candle.low),
                                yEnd: .value("最高", point.candle.high)
                            )
                            .foregroundStyle(point.candle.close >= point.candle.open ? Color.red : Color.green)
                            RectangleMark(
                                x: .value("交易日", point.session),
                                yStart: .value("开盘", point.candle.open),
                                yEnd: .value("收盘", point.candle.close),
                                width: .ratio(0.55)
                            )
                            .foregroundStyle(point.candle.close >= point.candle.open ? Color.red.opacity(0.75) : Color.green.opacity(0.75))
                            if let ma20 = point.ma20 {
                                LineMark(x: .value("交易日", point.session), y: .value("价格", ma20), series: .value("指标", "MA20"))
                                    .foregroundStyle(by: .value("指标", "MA20"))
                            }
                            if let ma60 = point.ma60 {
                                LineMark(x: .value("交易日", point.session), y: .value("价格", ma60), series: .value("指标", "MA60"))
                                    .foregroundStyle(by: .value("指标", "MA60"))
                            }
                            if let bollinger = point.bollinger20 {
                                LineMark(x: .value("交易日", point.session), y: .value("价格", bollinger.upper), series: .value("指标", "Boll上轨"))
                                    .foregroundStyle(by: .value("指标", "Boll上轨"))
                                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                                LineMark(x: .value("交易日", point.session), y: .value("价格", bollinger.lower), series: .value("指标", "Boll下轨"))
                                    .foregroundStyle(by: .value("指标", "Boll下轨"))
                                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                            }
                        }
                    }

                    technicalChart("成交量", height: 100) {
                        ForEach(visible, id: \.session) { point in
                            BarMark(x: .value("交易日", point.session), y: .value("成交量", point.volume))
                                .foregroundStyle(point.candle.close >= point.candle.open ? Color.red.opacity(0.55) : Color.green.opacity(0.55))
                        }
                    }

                    technicalChart("MACD 12 / 26 / 9", height: 140) {
                        ForEach(visible, id: \.session) { point in
                            if let histogram = point.macd.histogram {
                                BarMark(x: .value("交易日", point.session), y: .value("柱", histogram))
                                    .foregroundStyle(histogram >= 0 ? Color.red.opacity(0.5) : Color.green.opacity(0.5))
                            }
                            if let line = point.macd.line {
                                LineMark(x: .value("交易日", point.session), y: .value("MACD", line), series: .value("指标", "DIF"))
                                    .foregroundStyle(by: .value("指标", "DIF"))
                            }
                            if let signal = point.macd.signal {
                                LineMark(x: .value("交易日", point.session), y: .value("MACD", signal), series: .value("指标", "DEA"))
                                    .foregroundStyle(by: .value("指标", "DEA"))
                            }
                        }
                        RuleMark(y: .value("零轴", 0))
                            .foregroundStyle(.secondary.opacity(0.4))
                    }

                    technicalChart("RSI 14", height: 120) {
                        ForEach(visible, id: \.session) { point in
                            if let rsi = point.rsi14 {
                                LineMark(x: .value("交易日", point.session), y: .value("RSI", rsi))
                                    .foregroundStyle(.purple)
                            }
                        }
                        RuleMark(y: .value("上界", 70))
                            .foregroundStyle(.orange.opacity(0.65))
                            .lineStyle(StrokeStyle(dash: [4, 3]))
                        RuleMark(y: .value("下界", 30))
                            .foregroundStyle(.blue.opacity(0.65))
                            .lineStyle(StrokeStyle(dash: [4, 3]))
                    }
                }
                .frame(width: chartWidth, alignment: .leading)
            }
            .accessibilityIdentifier("marketTechnicalScrollableCharts")

            Text("\(visible.first?.session ?? "—") → \(visible.last?.session ?? "—") · \(visible.count) 个完成交易日；指标由后端统一计算，红涨绿跌，不构成交易建议。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("后端技术数据驱动的日K、成交量、均线、MACD、布林线和RSI历史工作台，不含客户端指标重算")
    }

    private func technicalChart<Content: ChartContent>(
        _ title: String,
        height: CGFloat,
        hideXAxis: Bool = true,
        @ChartContentBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption.weight(.semibold))
            Chart(content: content)
                .chartXAxis(hideXAxis ? .hidden : .automatic)
                .chartLegend(position: .bottom, alignment: .leading, spacing: 8)
                .frame(height: height)
        }
        .padding(10)
        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
    }
}
