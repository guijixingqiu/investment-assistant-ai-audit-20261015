import SwiftUI

extension GateAMarketScreen {
    func weinsteinTechnicalAnalysisSection() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(weinsteinEnvelope?.status == "available"
                 ? "周线阶段摘要已在上方显示；完整图表、均线与来源记录可展开。"
                 : "周线可独立读取；阶段判断需要同一股票、恒指和所属行业的完成周线。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("marketWeinsteinAnalysisMessage")
            DisclosureGroup("展开周线图表、指标与来源") {
                ResearchWeinsteinTechnicalAnalysisView(
                    envelope: weinsteinEnvelope, dailyEnvelope: dailyEnvelope,
                    context: .currentObservation,
                    expectedSymbol: SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical,
                    observationAsOf: currentHongKongRequestDate()
                )
                if let weinsteinMessage {
                    Text(weinsteinMessage).font(.caption).foregroundStyle(.secondary)
                }
                Button {
                    Task { await runWeinsteinAnalysis() }
                } label: {
                    Label(isRunningWeinstein ? "读取中" : weinsteinEnvelope == nil ? "读取 Weinstein 周线阶段" : "重新读取周线阶段", systemImage: "chart.xyaxis.line")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .disabled(isRunningWeinstein || SecuritySymbol.parseHongKongAlias(symbolInput) == nil)
                .accessibilityIdentifier("marketRunWeinsteinAnalysisButton")
            }
        }
    }

    @MainActor
    func resetWeinsteinAnalysis() {
        weinsteinRequestId = UUID(); isRunningWeinstein = false; weinsteinEnvelope = nil; weinsteinMessage = nil
    }

    @MainActor
    func runWeinsteinAnalysis() async {
        let analysisAsOf = currentHongKongRequestDate()
        guard let symbol = SecuritySymbol.parseHongKongAlias(symbolInput) else {
            resetWeinsteinAnalysis(); weinsteinMessage = "请先选择合法港股。"; return
        }
        let context = AppEnvironment.researchAuthorizationContext()
        let requestId = UUID()
        weinsteinRequestId = requestId; isRunningWeinstein = true; weinsteinEnvelope = nil
        weinsteinMessage = "正在读取个股、恒指和所属行业的完成周线；不会创建交易或正式决定。"
        defer { if weinsteinRequestId == requestId { isRunningWeinstein = false } }
        let client = WeinsteinTechnicalAnalysisClient(
            baseURL: context.baseURL, authToken: context.readToken, authHeaderName: context.readHeaderName
        )
        do {
            let result = try await client.fetch(market: symbol.market, code: symbol.code, analysisAsOf: analysisAsOf)
            guard weinsteinRequestId == requestId,
                  AppEnvironment.researchAuthorizationContext() == context,
                  SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical else { return }
            weinsteinEnvelope = result
            weinsteinMessage = result.status == "available" ? "周线阶段分析已按同一截止日期完成。" : "所需周线证据不足，已明确保留 UNKNOWN。"
        } catch {
            guard weinsteinRequestId == requestId,
                  AppEnvironment.researchAuthorizationContext() == context,
                  SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical else { return }
            weinsteinEnvelope = nil
            weinsteinMessage = "周线分析不可用或身份校验失败：\(error.localizedDescription)"
        }
    }

}
