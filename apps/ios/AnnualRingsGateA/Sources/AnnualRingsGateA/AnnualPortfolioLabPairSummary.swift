import Foundation

public struct AnnualPortfolioLabPairSummary: Equatable {
    public let symbols: [String]
    public let portfolioSnapshotId: String
    public let quantEvidenceId: String?
    public let current: AnnualPortfolioLabPairState
    public let scenarios: [AnnualPortfolioLabPairScenario]
}

public struct AnnualPortfolioLabPairState: Equatable {
    public let selectedWeight: Double
    public let largestPositionWeight: Double
    public let hhi: Double
    public let historical: AnnualPortfolioHistoricalMetrics
}

public struct AnnualPortfolioLabPairScenario: Equatable, Identifiable {
    public var id: Int { sourceIndex }
    public let sourceIndex: Int
    public let amountPerStock: Double
    public let combinedAddedAmount: Double
    public let state: AnnualPortfolioLabPairState
    public let selectedWeightChange: Double
    public let largestPositionWeightChange: Double
    public let hhiChange: Double
    public let annualizedVolatilityChange: Double?
    public let historicalStressLossChange: Double?
    public let historicalTailLossChange: Double?
    public let selectedRiskContributionChange: Double?
}

public func annualPortfolioLabPairSummary(
    current: AnnualPortfolioLabData,
    compared: AnnualPortfolioLabData
) -> AnnualPortfolioLabPairSummary? {
    let symbols = [current.target.symbol, compared.target.symbol]
    guard symbols[0] != symbols[1],
          current.sourceIdentity.accountScopeId == compared.sourceIdentity.accountScopeId,
          current.sourceIdentity.portfolioContextId == compared.sourceIdentity.portfolioContextId,
          current.sourceIdentity.portfolioSnapshotId == compared.sourceIdentity.portfolioSnapshotId,
          current.sourceIdentity.portfolioAsOf == compared.sourceIdentity.portfolioAsOf,
          current.scenarios.count == compared.scenarios.count,
          zip(current.scenarios, compared.scenarios).allSatisfy({ left, right in
              left.sourceIndex == right.sourceIndex && left.hypotheticalAmount == right.hypotheticalAmount
          }) else { return nil }

    let evidence = current.quant.coverage.status == "exact"
        && compared.quant.coverage.status == "exact"
        && current.quant.evidence?.evidenceId == compared.quant.evidence?.evidenceId
        ? current.quant.evidence
        : nil
    let baseValues = Dictionary(uniqueKeysWithValues: current.portfolio.positions.map { ($0.symbol, $0.marketValue ?? 0) })
    guard let base = annualPortfolioLabPairState(values: baseValues, symbols: symbols, evidence: evidence) else { return nil }
    let scenarios = current.scenarios.compactMap { scenario -> AnnualPortfolioLabPairScenario? in
        var values = baseValues
        symbols.forEach { values[$0] = (values[$0] ?? 0) + scenario.hypotheticalAmount }
        guard let next = annualPortfolioLabPairState(values: values, symbols: symbols, evidence: evidence) else { return nil }
        return .init(
            sourceIndex: scenario.sourceIndex,
            amountPerStock: scenario.hypotheticalAmount,
            combinedAddedAmount: portfolioDecisionJSRound(scenario.hypotheticalAmount * 2, digits: 8),
            state: next,
            selectedWeightChange: pairDifference(next.selectedWeight, base.selectedWeight) ?? 0,
            largestPositionWeightChange: pairDifference(next.largestPositionWeight, base.largestPositionWeight) ?? 0,
            hhiChange: pairDifference(next.hhi, base.hhi) ?? 0,
            annualizedVolatilityChange: pairDifference(next.historical.annualizedVolatility, base.historical.annualizedVolatility),
            historicalStressLossChange: pairDifference(next.historical.historicalStressLossMagnitude, base.historical.historicalStressLossMagnitude),
            historicalTailLossChange: pairDifference(next.historical.historicalTailLossMagnitude, base.historical.historicalTailLossMagnitude),
            selectedRiskContributionChange: pairDifference(next.historical.candidateRiskContribution, base.historical.candidateRiskContribution)
        )
    }
    guard scenarios.count == current.scenarios.count else { return nil }
    return .init(
        symbols: symbols,
        portfolioSnapshotId: current.sourceIdentity.portfolioSnapshotId,
        quantEvidenceId: evidence?.evidenceId,
        current: base,
        scenarios: scenarios
    )
}

private func annualPortfolioLabPairState(
    values: [String: Double],
    symbols: [String],
    evidence: AnnualPortfolioLabQuantEvidence?
) -> AnnualPortfolioLabPairState? {
    let total = values.values.reduce(0, +)
    guard total > 0 else { return nil }
    let weights = values.mapValues { portfolioDecisionJSRound($0 / total, digits: 8) }
    let orderedWeights = Array(weights.values)
    return .init(
        selectedWeight: portfolioDecisionJSRound(symbols.reduce(0) { $0 + (weights[$1] ?? 0) }, digits: 8),
        largestPositionWeight: portfolioDecisionJSRound(orderedWeights.max() ?? 0, digits: 8),
        hhi: portfolioDecisionJSRound(orderedWeights.reduce(0) { $0 + $1 * $1 }, digits: 8),
        historical: evidence.map { annualPortfolioLabPairHistorical(evidence: $0, weights: weights, symbols: symbols) }
            ?? .init(
                status: "unavailable",
                annualizedVolatility: nil,
                historicalStressLossMagnitude: nil,
                historicalStressDate: nil,
                historicalTailLossMagnitude: nil,
                candidateRiskContribution: nil,
                limitation: "Joint historical risk is unavailable until both reads share one exact canonical quant evidence window."
            )
    )
}

private func annualPortfolioLabPairHistorical(
    evidence: AnnualPortfolioLabQuantEvidence,
    weights: [String: Double],
    symbols: [String]
) -> AnnualPortfolioHistoricalMetrics {
    let first = annualPortfolioLabHistoricalMetrics(evidence: evidence, weights: weights, candidateSymbol: symbols[0])
    let second = annualPortfolioLabHistoricalMetrics(evidence: evidence, weights: weights, candidateSymbol: symbols[1])
    return .init(
        status: first.status,
        annualizedVolatility: first.annualizedVolatility,
        historicalStressLossMagnitude: first.historicalStressLossMagnitude,
        historicalStressDate: first.historicalStressDate,
        historicalTailLossMagnitude: first.historicalTailLossMagnitude,
        candidateRiskContribution: first.candidateRiskContribution.flatMap { left in
            second.candidateRiskContribution.map { portfolioDecisionJSRound(left + $0, digits: 10) }
        },
        limitation: "Joint metrics use the exact shared quant window and add the same Owner-entered amount to both selected research stocks; they do not change portfolio facts."
    )
}

private func pairDifference(_ left: Double?, _ right: Double?) -> Double? {
    guard let left, let right else { return nil }
    return portfolioDecisionJSRound(left - right, digits: 10)
}

func annualPortfolioLabPairRiskConclusion(_ scenario: AnnualPortfolioLabPairScenario) -> String {
    let metrics: [(String, Double?)] = [
        ("两股合计占比", scenario.selectedWeightChange),
        ("最大仓位", scenario.largestPositionWeightChange),
        ("集中度", scenario.hhiChange),
        ("历史波动", scenario.annualizedVolatilityChange),
        ("压力损失", scenario.historicalStressLossChange),
        ("尾部损失", scenario.historicalTailLossChange),
        ("两股风险贡献", scenario.selectedRiskContributionChange)
    ]
    let increased: [String] = metrics.compactMap { metric in
        guard let change = metric.1, change > 0 else { return nil }
        return metric.0
    }
    let decreased: [String] = metrics.compactMap { metric in
        guard let change = metric.1, change < 0 else { return nil }
        return metric.0
    }
    let knownCount = metrics.compactMap(\.1).count
    let direction = [
        increased.isEmpty ? nil : "风险上升：\(increased.joined(separator: "、"))",
        decreased.isEmpty ? nil : "风险下降：\(decreased.joined(separator: "、"))"
    ].compactMap { $0 }.joined(separator: "；")

    if knownCount == 0 {
        return "历史风险指标不足，方向保持 UNKNOWN。仅描述同一量化窗口下的假设金额变化。"
    }
    return "\(direction.isEmpty ? "主要风险指标基本不变" : direction)。仅描述同一量化窗口下的假设金额变化，不构成投资建议。"
}
