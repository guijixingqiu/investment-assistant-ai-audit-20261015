import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func crossStockPortfolioPairSummary(
        current: AnnualPortfolioLabData,
        compared: AnnualPortfolioLabData
    ) -> some View {
        if let summary = annualPortfolioLabPairSummary(current: current, compared: compared) {
            crossStockPortfolioPairEvidenceIdentity(summary: summary, current: current, compared: compared)

            VStack(alignment: .leading, spacing: 5) {
                Text("当前两股合计")
                    .font(.caption.weight(.semibold))
                InfoBlock(title: "合计占比", value: pairPercent(summary.current.selectedWeight))
                InfoBlock(title: "最大仓位 / HHI", value: "\(pairPercent(summary.current.largestPositionWeight)) / \(pairNumber(summary.current.hhi))")
                InfoBlock(title: "历史波动", value: pairMetric(summary.current.historical.annualizedVolatility))
                InfoBlock(title: "压力 / 尾部损失", value: "\(pairMetric(summary.current.historical.historicalStressLossMagnitude)) / \(pairMetric(summary.current.historical.historicalTailLossMagnitude))")
                InfoBlock(title: "两股合计风险贡献", value: pairMetric(summary.current.historical.candidateRiskContribution))
            }
            .padding(8)
            .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
            .accessibilityIdentifier("crossStockPortfolioPairCurrent")

            ForEach(summary.scenarios) { scenario in
                VStack(alignment: .leading, spacing: 5) {
                    Text("每股加入 \(pairCurrency(scenario.amountPerStock))")
                        .font(.caption.weight(.semibold))
                    Text(annualPortfolioLabPairRiskConclusion(scenario))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("crossStockPortfolioRiskConclusion-\(scenario.sourceIndex)")
                    InfoBlock(title: "合计加入", value: pairCurrency(scenario.combinedAddedAmount))
                    InfoBlock(title: "合计占比 / 变化", value: "\(pairPercent(scenario.state.selectedWeight)) / \(pairPercent(scenario.selectedWeightChange))")
                    InfoBlock(title: "最大仓位 / 变化", value: "\(pairPercent(scenario.state.largestPositionWeight)) / \(pairPercent(scenario.largestPositionWeightChange))")
                    InfoBlock(title: "HHI / 变化", value: "\(pairNumber(scenario.state.hhi)) / \(pairNumber(scenario.hhiChange))")
                    InfoBlock(title: "历史波动 / 变化", value: "\(pairMetric(scenario.state.historical.annualizedVolatility)) / \(pairMetric(scenario.annualizedVolatilityChange))")
                    InfoBlock(title: "压力 / 尾部变化", value: "\(pairMetric(scenario.historicalStressLossChange)) / \(pairMetric(scenario.historicalTailLossChange))")
                    InfoBlock(title: "两股风险贡献 / 变化", value: "\(pairMetric(scenario.state.historical.candidateRiskContribution)) / \(pairMetric(scenario.selectedRiskContributionChange))")
                }
                .padding(8)
                .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
                .accessibilityIdentifier("crossStockPortfolioLabScenario-\(scenario.sourceIndex)")
            }
        } else {
            Text("两次读取未共享同一组合快照、金额顺序或量化窗口，联合风险暂不可用。")
                .font(.caption)
                .foregroundStyle(.orange)
                .accessibilityIdentifier("crossStockPortfolioPairUnavailable")
        }
    }

    @ViewBuilder
    private func crossStockPortfolioPairEvidenceIdentity(
        summary: AnnualPortfolioLabPairSummary,
        current: AnnualPortfolioLabData,
        compared: AnnualPortfolioLabData
    ) -> some View {
        let currentEvidence = current.quant.evidence
        let comparedEvidence = compared.quant.evidence
        VStack(alignment: .leading, spacing: 5) {
            Text("共同量化证据")
                .font(.caption.weight(.semibold))
            if let evidenceId = summary.quantEvidenceId,
               let currentEvidence,
               let comparedEvidence {
                InfoBlock(
                    title: "共享版本 / 截止",
                    value: "\(evidenceId.prefix(12)) · \(currentEvidence.source.dataCutoff)",
                    valueIdentifier: "crossStockPortfolioQuantSharedVersion"
                )
                if let universe = currentEvidence.source.hkConnectUniverse,
                   universe.snapshotId == comparedEvidence.source.hkConnectUniverse?.snapshotId {
                    InfoBlock(
                        title: "港股通股票池",
                        value: "\(universe.effectiveDate) · \(universe.memberCount) 只 · \(universe.snapshotId.prefix(12))",
                        valueIdentifier: "crossStockPortfolioUniverseVersion"
                    )
                }
                DisclosureGroup("完整两股量化身份") {
                    Text("sharedEvidenceId=\(evidenceId)")
                    Text("\(current.target.symbol): schema=\(currentEvidence.schemaVersion); snapshot=\(currentEvidence.source.snapshotId); snapshotHash=\(currentEvidence.source.snapshotHash); dataHash=\(currentEvidence.source.dataHash); cutoff=\(currentEvidence.source.dataCutoff)")
                    Text("\(compared.target.symbol): schema=\(comparedEvidence.schemaVersion); snapshot=\(comparedEvidence.source.snapshotId); snapshotHash=\(comparedEvidence.source.snapshotHash); dataHash=\(comparedEvidence.source.dataHash); cutoff=\(comparedEvidence.source.dataCutoff)")
                }
                .font(.caption2)
                .accessibilityIdentifier("crossStockPortfolioQuantExactIdentity")
            } else {
                Text("两股未共享同一量化证据版本，历史风险方向保持 UNKNOWN；集中度情景仍只按同一组合快照计算。")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("crossStockPortfolioQuantIdentityUnavailable")
            }
        }
        .padding(8)
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityIdentifier("crossStockPortfolioQuantIdentity")
    }

    private func pairMetric(_ value: Double?) -> String {
        value.map { String(format: "%.2f%%", $0 * 100) } ?? "UNKNOWN"
    }

    private func pairCurrency(_ value: Double) -> String {
        value.formatted(.currency(code: "HKD").precision(.fractionLength(2)))
    }

    private func pairPercent(_ value: Double) -> String {
        value.formatted(.percent.precision(.fractionLength(2)))
    }

    private func pairNumber(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0 ... 4)))
    }
}
