import SwiftUI

public struct WeinsteinTechnicalAnalysisView: View {
    private let envelope: WeinsteinTechnicalAnalysisEnvelope?
    private let showsFullEvidence: Bool
    public init(envelope: WeinsteinTechnicalAnalysisEnvelope?, showsFullEvidence: Bool = false) {
        self.envelope = envelope
        self.showsFullEvidence = showsFullEvidence
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Weinstein 周线阶段")
                    .font(.headline)
                Spacer()
                Text(envelope?.dataQuality ?? "UNKNOWN")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(envelope?.status == "available" ? .green : .orange)
                    .accessibilityIdentifier("weinsteinAnalysisStatus")
            }
            if let envelope { result(envelope) }
            else { Text("大盘阶段 UNKNOWN · 行业阶段 UNKNOWN · 个股阶段 UNKNOWN。待同一股票的完成日线可用后，再按大盘 → 行业 → 个股读取周线证据。")
                .font(.subheadline).foregroundStyle(.secondary) }
        }
        .padding(16)
        .background(cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("weinsteinTechnicalAnalysisCard")
    }

    @ViewBuilder private func result(_ value: WeinsteinTechnicalAnalysisEnvelope) -> some View {
        Text(value.status == "data_insufficient" ? WeinsteinTechnicalAnalysisEnvelope.dataInsufficientSummary : value.summary)
            .font(.subheadline.weight(.medium)).accessibilityIdentifier("weinsteinAnalysisSummary")
        if value.status == "available" {
            if showsFullEvidence {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                    GridRow { metric("大盘", "\(stage(value.marketStage)) · \(category(value.marketStageConfidence)) · \(category(value.marketMa30wDirection))"); metric("行业", "\(stage(value.sectorStage)) · \(category(value.sectorStageConfidence)) · \(category(value.sectorStrength))") }
                    GridRow { metric("个股", "\(stage(value.stockStage)) · \(category(value.stockStageConfidence)) · \(category(value.stockStagePhase))"); metric("当前状态", category(value.entryState)) }
                    GridRow { metric("30周均线", number(value.ma30w)); metric("价格距均线", percent(value.priceVsMa30wPercent)) }
                    GridRow { metric("突破", "\(category(value.breakoutStatus)) · \(value.breakoutWeek ?? "UNKNOWN")"); metric("三重确认", value.tripleConfirmation) }
                    GridRow { metric("切入质量 / RS", "\(category(value.entryQuality)) / \(category(value.relativeStrengthStatus))"); metric("延伸 / 上方阻力", "\(category(value.extensionRisk)) / \(category(value.overheadSupplyRisk))") }
                    GridRow { metric("距突破 / 支撑", "\(percent(value.extensionFromBreakoutPercent)) / \(percent(value.extensionFromSupportPercent))"); metric("退出警示", category(value.exitWarning)) }
                    GridRow { metric("4周量比", number(value.volumeRatio4Week)); metric("10周量比 / 分位", "\(number(value.volumeRatio)) / \(number(value.volumePercentile))%") }
                }
                .accessibilityIdentifier("weinsteinAnalysisKeyFacts")
                zones("支撑区域", value.supportZones)
                zones("阻力区域", value.resistanceZones)
                if let invalidationZone = value.invalidationZone { zones("失效区域", [invalidationZone]) }
                bullets("正面证据", value.supportingEvidence)
                bullets("反面证据", value.counterevidence)
            } else {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                    GridRow { metric("大盘阶段", stage(value.marketStage)); metric("行业阶段", stage(value.sectorStage)) }
                    GridRow { metric("个股阶段", "\(stage(value.stockStage)) · \(category(value.stockStagePhase))"); metric("当前状态", category(value.entryState)) }
                }
                .accessibilityIdentifier("weinsteinMarketPreview")
                Text("完整阶段、图表、因素、风险和冻结身份请在 Research 查看。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        if showsFullEvidence {
            bullets("仍为 UNKNOWN 的证据", value.unknowns)
            bullets("下一步观察", value.nextObservations)
        } else if value.status == "data_insufficient", let next = value.nextObservations.first {
            Text("下一观察：\(next)")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        DisclosureGroup("数据身份与安全边界") {
            VStack(alignment: .leading, spacing: 6) {
                if !showsFullEvidence { bullets("缺失证据", value.unknowns) }
                Text("分析日期 \(value.analysisAsOf) · 完成周 \(value.completedWeekEnd ?? "UNKNOWN") · 行业身份 \(value.sectorIdentityAsOf ?? "UNKNOWN") · 计算版本 \(value.computationVersion)")
                Text("provider \(value.provider ?? "UNKNOWN") · dataset \(value.dataset ?? "UNKNOWN") · datasetHash \(value.datasetHash?.prefix(12) ?? "UNKNOWN")…")
                ForEach(value.sources, id: \.role) { source in
                    Text("\(source.role): \(source.symbol) · \(source.barCount)周 · \(source.lastWeek) · \(source.inputHash.prefix(12))…")
                }
                Text("只读研究辅助；不创建报告、决定、仓位、订单或交易。空头分析默认关闭。")
            }
            .font(.caption).foregroundStyle(.secondary).textSelection(.enabled).padding(.top, 6)
        }
    }

    private func metric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) { Text(title).font(.caption).foregroundStyle(.secondary); Text(value).font(.callout.weight(.semibold)) }
            .frame(maxWidth: .infinity, alignment: .leading)
    }
    @ViewBuilder private func zones(_ title: String, _ values: [WeinsteinZone]) -> some View {
        if !values.isEmpty { Text("\(title)：\(values.map { "\(number($0.lower))–\(number($0.upper)) · \($0.touchCount)次触及 · \($0.firstWeek)至\($0.lastWeek)" }.joined(separator: "；"))").font(.caption) }
    }
    @ViewBuilder private func bullets(_ title: String, _ values: [String]) -> some View {
        if !values.isEmpty { VStack(alignment: .leading, spacing: 4) { Text(title).font(.caption.weight(.semibold)); ForEach(values, id: \.self) { Text("• \($0)").font(.caption) } } }
    }
    private func number(_ value: Double?) -> String { value.map { String(format: "%.2f", $0) } ?? "UNKNOWN" }
    private func percent(_ value: Double?) -> String { value.map { String(format: "%+.2f%%", $0) } ?? "UNKNOWN" }
    private func stage(_ value: String) -> String { value.replacingOccurrences(of: "STAGE_", with: "阶段 ").replacingOccurrences(of: "TRANSITION", with: "转换中") }
    private func category(_ value: String) -> String { [
        "EARLY": "早期", "MID": "中期", "LATE": "后期", "LEADING": "领先", "IMPROVING": "改善",
        "NEUTRAL": "中性", "WEAKENING": "转弱", "LAGGING": "落后", "NONE": "未突破", "WATCH": "观察",
        "CONFIRMED": "已确认", "HISTORICAL": "既有突破（非本周）", "FAILED": "失败突破", "NO_ACTION": "不采取行动", "BASE_FORMING": "底部形成中",
        "BREAKOUT_WATCH": "观察突破", "BREAKOUT_CONFIRMED": "突破已确认", "RETEST_WATCH": "观察回踩",
        "HOLD_STAGE_2": "维持 Stage 2 观察", "STAGE_3_WARNING": "Stage 3 警示", "REDUCE": "减仓警示", "EXIT": "退出警示",
        "HIGH": "高", "MEDIUM": "中", "LOW": "低", "NOT_APPLICABLE": "不适用", "RISING": "上升", "FLAT": "走平", "FALLING": "下降",
        "STRENGTHENING": "转强", "EARLY_WARNING": "早期警示", "STAGE_4_CONFIRMATION": "Stage 4 已确认"
    ][value] ?? value.replacingOccurrences(of: "_", with: " ") }
    private var cardBackground: Color {
#if os(iOS)
        Color(uiColor: .secondarySystemGroupedBackground)
#else
        Color(nsColor: .windowBackgroundColor)
#endif
    }
}
