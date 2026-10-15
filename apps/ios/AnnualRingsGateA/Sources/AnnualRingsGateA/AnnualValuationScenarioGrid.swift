import Foundation

public struct AnnualValuationScenarioGrid: Equatable, Sendable {
    public let projectedMetricPerShare: Double
    public let scenarioPresentValuePerShare: Double
    public let growthRates: [Double]
    public let terminalMultiples: [Double]
    public let cells: [AnnualValuationSensitivityCell]
}

public func calculateAnnualValuationScenarioGrid(
    _ input: AnnualValuationScenarioInput
) -> AnnualValuationScenarioGrid? {
    var errors: [String] = []
    input.validate(errors: &errors)
    guard errors.isEmpty else { return nil }
    let projected = input.baseMetricPerShare * pow(
        1 + input.annualGrowthRate,
        Double(input.horizonYears)
    )
    let discount = pow(1 + input.annualDiscountRate, Double(input.horizonYears))
    let baseValue = projected * input.terminalMultiple / discount + input.netCashPerShare
    guard projected.isFinite, projected > 0, discount.isFinite, discount > 0,
          baseValue.isFinite, baseValue > 0 else { return nil }
    let growthRates = [
        valuationScenarioClamp(input.annualGrowthRate - input.growthRateStep, -0.95, 3),
        input.annualGrowthRate,
        valuationScenarioClamp(input.annualGrowthRate + input.growthRateStep, -0.95, 3)
    ].map(valuationScenarioRoundSix)
    let terminalMultiples = [
        valuationScenarioClamp(input.terminalMultiple - input.multipleStep, 0.1, 200),
        input.terminalMultiple,
        valuationScenarioClamp(input.terminalMultiple + input.multipleStep, 0.1, 200)
    ].map(valuationScenarioRoundSix)
    let cells = growthRates.flatMap { growth in
        terminalMultiples.map { multiple in
            AnnualValuationSensitivityCell(
                annualGrowthRate: growth,
                terminalMultiple: multiple,
                presentValuePerShare: valuationScenarioRoundSix(
                    input.baseMetricPerShare * pow(1 + growth, Double(input.horizonYears))
                        * multiple / discount + input.netCashPerShare
                )
            )
        }
    }
    guard cells.allSatisfy({ $0.presentValuePerShare.isFinite }) else { return nil }
    return AnnualValuationScenarioGrid(
        projectedMetricPerShare: valuationScenarioRoundSix(projected),
        scenarioPresentValuePerShare: valuationScenarioRoundSix(baseValue),
        growthRates: growthRates,
        terminalMultiples: terminalMultiples,
        cells: cells
    )
}

public func annualValuationImpliedGrowthAtPrice(
    _ quotePrice: Double,
    input: AnnualValuationScenarioInput
) -> Double? {
    guard quotePrice.isFinite, quotePrice > 0,
          calculateAnnualValuationScenarioGrid(input) != nil else { return nil }
    let discount = pow(1 + input.annualDiscountRate, Double(input.horizonYears))
    let base = (quotePrice - input.netCashPerShare) * discount
        / (input.baseMetricPerShare * input.terminalMultiple)
    guard base > 0 else { return nil }
    let implied = pow(base, 1 / Double(input.horizonYears)) - 1
    return implied.isFinite ? valuationScenarioRoundSix(implied) : nil
}

private func valuationScenarioClamp(
    _ value: Double,
    _ min: Double,
    _ max: Double
) -> Double {
    Swift.max(min, Swift.min(max, value))
}

private func valuationScenarioRoundSix(_ value: Double) -> Double {
    floor((value + Double.ulpOfOne) * 1_000_000 + 0.5) / 1_000_000
}
