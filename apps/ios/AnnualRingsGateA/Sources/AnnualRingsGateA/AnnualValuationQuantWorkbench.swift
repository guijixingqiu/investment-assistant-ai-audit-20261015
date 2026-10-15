import Foundation

public let annualValuationQuantWorkbenchSchemaVersion = "2026-07-17.ios-annual-rings-valuation-quant.v1"
public let annualValuationCalculationVersion = "2026-07-17.discounted-forward-metric-multiple.v1"
public let annualAdjustedNetAssetCalculationVersion = "2026-08-13.adjusted-net-asset-value.v1"
public let annualValuationPresentValueFormula =
    "baseMetricPerShare * (1 + annualGrowthRate) ^ horizonYears * terminalMultiple / (1 + annualDiscountRate) ^ horizonYears + netCashPerShare"
public let annualValuationImpliedExpectationFormula =
    "((currentPrice - netCashPerShare) * (1 + annualDiscountRate) ^ horizonYears / (baseMetricPerShare * terminalMultiple)) ^ (1 / horizonYears) - 1"
public let annualAdjustedNetAssetValueFormula =
    "baseNetAssetPerShare * (1 + annualNetAssetGrowthRate) ^ horizonYears * assetRealizationRate / (1 + requiredReturn) ^ horizonYears + assetLiabilityAdjustmentPerShare"
public enum AnnualValuationQuantValidationError: Error, Equatable {
    case invalid([String])
}
public struct AnnualValuationScenarioInput: Codable, Equatable, Sendable {
    public let methodId: String?
    public let metricCurrency: String?
    public let shareBasis: String?
    public let baseMetricPerShare: Double
    public let annualGrowthRate: Double
    public let horizonYears: Int
    public let terminalMultiple: Double
    public let annualDiscountRate: Double
    public let netCashPerShare: Double
    public let growthRateStep: Double
    public let multipleStep: Double

    public init(
        methodId: String? = nil,
        metricCurrency: String? = nil,
        shareBasis: String? = nil,
        baseMetricPerShare: Double,
        annualGrowthRate: Double,
        horizonYears: Int,
        terminalMultiple: Double,
        annualDiscountRate: Double,
        netCashPerShare: Double,
        growthRateStep: Double,
        multipleStep: Double
    ) {
        self.methodId = methodId
        self.metricCurrency = metricCurrency
        self.shareBasis = shareBasis
        self.baseMetricPerShare = baseMetricPerShare
        self.annualGrowthRate = annualGrowthRate
        self.horizonYears = horizonYears
        self.terminalMultiple = terminalMultiple
        self.annualDiscountRate = annualDiscountRate
        self.netCashPerShare = netCashPerShare
        self.growthRateStep = growthRateStep
        self.multipleStep = multipleStep
    }

    func validate(errors: inout [String]) {
        if let methodId, !["discounted_forward_metric_multiple_user_scenario", "adjusted_net_asset_value_user_scenario"].contains(methodId) {
            errors.append("valuation method id is invalid")
        }
        if let metricCurrency, metricCurrency.range(of: #"^[A-Z]{3}$"#, options: .regularExpression) == nil { errors.append("valuation metric currency must be a three-letter uppercase code") }
        if let shareBasis, !["basic", "diluted"].contains(shareBasis) { errors.append("valuation share basis is invalid") }
        annualBound(baseMetricPerShare, 0.000001...1_000_000, "base metric", &errors)
        annualBound(annualGrowthRate, -0.95...3, "growth rate", &errors)
        if !(1...20).contains(horizonYears) { errors.append("valuation horizon must be between 1 and 20 years") }
        annualBound(terminalMultiple, 0.1...200, "terminal multiple", &errors)
        annualBound(annualDiscountRate, 0...1, "discount rate", &errors)
        annualBound(netCashPerShare, -1_000_000...1_000_000, "net cash per share", &errors)
        annualBound(growthRateStep, 0.0001...1, "growth-rate step", &errors)
        annualBound(multipleStep, 0.01...100, "multiple step", &errors)
    }
}
public struct AnnualQuantFilterInput: Codable, Equatable, Sendable {
    public let maxDrawdownMagnitude: Double
    public let maxTurnoverOneWay: Double
    public let minTradeCount: Int

    func validate(errors: inout [String]) {
        annualBound(maxDrawdownMagnitude, 0...1, "maximum drawdown magnitude", &errors)
        annualBound(maxTurnoverOneWay, 0...1_000_000, "maximum turnover", &errors)
        if !(0...1_000_000).contains(minTradeCount) { errors.append("minimum trade count is outside its bounded range") }
    }
}
public struct AnnualValuationQuantWorkbenchEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let generatedAt: String
    public let status: String
    public let membershipId: String
    public let requestedActorId: String
    public let requestedSymbol: String?
    public let metadata: FactMetadata
    public let data: AnnualValuationQuantWorkbenchData?
    public let safety: AnnualValuationQuantSafety
    public let message: String

    public static func unavailable(
        _ message: String,
        membershipId: String,
        clientFailureState: String = "unavailable"
    ) -> Self {
        let now = "1970-01-01T00:00:00.000Z"
        return Self(
            schemaVersion: annualValuationQuantWorkbenchSchemaVersion,
            generatedAt: now,
            status: "unavailable",
            membershipId: membershipId,
            requestedActorId: "client:\(clientFailureState)",
            requestedSymbol: nil,
            metadata: FactMetadata(
                source: "annual_valuation_quant_workbench:client:\(clientFailureState)",
                asOf: nil,
                fetchedAt: nil,
                freshness: "unavailable",
                provenance: "unavailable",
                authority: "unavailable",
                stale: false,
                missing: false,
                conflict: false,
                fixture: false,
                correctionOf: nil,
                replaces: nil,
                message: message
            ),
            data: nil,
            safety: .readOnly,
            message: message
        )
    }

    public func validated(expectedMembershipId: String) throws -> Self {
        var errors: [String] = []
        if schemaVersion != annualValuationQuantWorkbenchSchemaVersion {
            errors.append("valuation quant workbench schema version is invalid")
        }
        if annualParseDateTime(generatedAt) == false { errors.append("workbench generatedAt is invalid") }
        if !["available", "not_found", "malformed", "unavailable"].contains(status) {
            errors.append("workbench status is invalid")
        }
        if membershipId != expectedMembershipId || membershipId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("workbench membership identity does not match the request")
        }
        if requestedActorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("workbench actor and message are required")
        }
        metadata.validateForDisplay(label: "valuation quant workbench", errors: &errors)
        safety.validate(errors: &errors)
        if status == "available" {
            guard let data, let requestedSymbol else {
                errors.append("available workbench requires data and requested symbol")
                throw AnnualValuationQuantValidationError.invalid(errors)
            }
            data.validate(
                membershipId: membershipId,
                requestedSymbol: requestedSymbol,
                generatedAt: generatedAt,
                errors: &errors
            )
            if metadata.source != "annual_valuation_quant_workbench:candidate_intake_quote_quant"
                || metadata.authority != "research_evidence" {
                errors.append("available workbench metadata source or authority is invalid")
            }
        } else if data != nil || requestedSymbol != nil || metadata.freshness == "fresh" {
            errors.append("fail-closed workbench must not expose data, symbol, or fresh metadata")
        }
        if errors.isEmpty == false { throw AnnualValuationQuantValidationError.invalid(errors) }
        return self
    }
}

public struct AnnualValuationQuantWorkbenchData: Codable, Equatable, Sendable {
    public let target: AnnualValuationQuantTarget
    public let sourceIdentity: AnnualValuationQuantSourceIdentity
    public let valuation: AnnualValuationResult
    public let quant: AnnualQuantProductView

    func validate(
        membershipId: String,
        requestedSymbol: String,
        generatedAt: String,
        errors: inout [String]
    ) {
        target.validate(membershipId: membershipId, requestedSymbol: requestedSymbol, errors: &errors)
        sourceIdentity.validate(symbol: requestedSymbol, generatedAt: generatedAt, errors: &errors)
        valuation.validate(symbol: requestedSymbol, errors: &errors)
        quant.validate(symbol: requestedSymbol, generatedAt: generatedAt, errors: &errors)
    }
}

public struct AnnualValuationQuantTarget: Codable, Equatable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let membershipState: String
    public let market: String
    public let code: String
    public let symbol: String

    func validate(membershipId expectedId: String, requestedSymbol: String, errors: inout [String]) {
        if membershipId != expectedId || membershipVersion < 1 || !["tracked", "paused", "archived"].contains(membershipState)
            || market != "HK" || code.range(of: #"^\d{5}$"#, options: .regularExpression) == nil
            || symbol != "HK.\(code)" || symbol != requestedSymbol {
            errors.append("valuation quant target identity or lifecycle is invalid")
        }
    }
}

public struct AnnualValuationQuantSourceIdentity: Codable, Equatable, Sendable {
    public let decisionContextId: String
    public let decisionContextHash: String
    public let generatedAt: String

    func validate(symbol: String, generatedAt expectedGeneratedAt: String, errors: inout [String]) {
        if decisionContextHash.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) == nil
            || decisionContextId != "decision-context:\(symbol):\(decisionContextHash.prefix(16))"
            || generatedAt != expectedGeneratedAt || annualParseDateTime(generatedAt) == false {
            errors.append("valuation quant source context identity is invalid")
        }
    }
}

public struct AnnualValuationResult: Codable, Equatable, Sendable {
    public let status: String
    public let quote: AnnualValuationQuote?
    public let inputs: AnnualValuationScenarioInput
    public let method: AnnualValuationMethod
    public let outputs: AnnualValuationOutputs?
    public let sensitivity: AnnualValuationSensitivity?
    public let limitations: [String]

    func validate(symbol: String, errors: inout [String]) {
        if !["available", "stale", "missing", "conflict", "unavailable"].contains(status) {
            errors.append("valuation status is invalid")
        }
        inputs.validate(errors: &errors)
        method.validate(errors: &errors)
        if method.id != (inputs.methodId ?? "discounted_forward_metric_multiple_user_scenario") {
            errors.append("valuation method does not match Owner-selected inputs")
        }
        annualStrings(limitations, label: "valuation limitations", allowEmpty: false, errors: &errors)
        guard status == "available" else {
            if quote != nil || outputs != nil || sensitivity != nil {
                errors.append("fail-closed valuation must clear quote calculations and sensitivity")
            }
            return
        }
        guard let quote, let outputs, let sensitivity else {
            errors.append("available valuation requires quote outputs and sensitivity")
            return
        }
        quote.validate(symbol: symbol, errors: &errors)
        if quote.currency != inputs.metricCurrency { errors.append("available valuation requires the exact metric currency to match the quote currency") }
        outputs.validate(errors: &errors)
        sensitivity.validate(errors: &errors)
        validateRecomputation(quote: quote, outputs: outputs, sensitivity: sensitivity, errors: &errors)
    }

    private func validateRecomputation(
        quote: AnnualValuationQuote,
        outputs: AnnualValuationOutputs,
        sensitivity: AnnualValuationSensitivity,
        errors: inout [String]
    ) {
        guard let grid = calculateAnnualValuationScenarioGrid(inputs) else {
            errors.append("valuation inputs do not produce a deterministic grid")
            return
        }
        if !annualEqual(outputs.projectedMetricPerShare, grid.projectedMetricPerShare)
            || !annualEqual(outputs.scenarioPresentValuePerShare, grid.scenarioPresentValuePerShare) {
            errors.append("valuation outputs do not recompute from exact user inputs")
        }
        let implied = annualValuationImpliedGrowthAtPrice(quote.price, input: inputs)
        if outputs.impliedAnnualGrowthRateAtCurrentPrice != implied
            || outputs.impliedExpectationStatus != (implied == nil ? "not_computable" : "available") {
            errors.append("valuation implied expectation does not recompute from the bound quote")
        }
        if sensitivity.growthRates != grid.growthRates
            || sensitivity.terminalMultiples != grid.terminalMultiples {
            errors.append("valuation sensitivity axes do not bind user steps")
            return
        }
        if sensitivity.cells != grid.cells {
            errors.append("valuation sensitivity cells do not independently recompute")
        }
        if let range = outputs.valueRange {
            let values = [grid.cells[0], grid.cells[4], grid.cells[8]].map(\.presentValuePerShare)
            if !annualEqual(range.low, values.min() ?? .nan) || !annualEqual(range.high, values.max() ?? .nan) {
                errors.append("valuation range does not bind bear base bull scenarios")
            }
        }
        if let margin = outputs.scenarioMarginOfSafety {
            let values = [grid.cells[0], grid.cells[4], grid.cells[8]].map(\.presentValuePerShare)
            let low = values.min() ?? .nan
            let high = values.max() ?? .nan
            let expected = AnnualValuationScenarioMarginOfSafety(
                position: quote.price < low ? "below_range" : quote.price > high ? "above_range" : "within_range",
                low: annualRoundSix((low - quote.price) / low),
                base: annualRoundSix((grid.scenarioPresentValuePerShare - quote.price) / grid.scenarioPresentValuePerShare),
                high: annualRoundSix((high - quote.price) / high),
                interpretation: "owner_scenario_distance_not_target_price_or_trade_signal"
            )
            if margin != expected { errors.append("valuation scenario margin must bind the exact quote and Owner scenarios") }
        }
    }
}

public struct AnnualValuationQuote: Codable, Equatable, Sendable {
    public let snapshotId: String
    public let symbol: String
    public let currency: String
    public let price: Double
    public let quoteTime: String
    public let fetchedAt: String
    public let source: String

    func validate(symbol expectedSymbol: String, errors: inout [String]) {
        if symbol != expectedSymbol || snapshotId.hasPrefix("\(expectedSymbol):") == false
            || currency.isEmpty || source.isEmpty || !price.isFinite || price <= 0
            || annualParseDateTime(quoteTime) == false || annualParseDateTime(fetchedAt) == false {
            errors.append("valuation quote identity or value is invalid")
        }
    }
}

public struct AnnualValuationMethod: Codable, Equatable, Sendable {
    public let id: String
    public let calculationVersion: String
    public let presentValueFormula: String
    public let impliedExpectationFormula: String
    public let rounding: String
    public let applicability: AnnualValuationMethodApplicability?

    public init(
        id: String,
        calculationVersion: String,
        presentValueFormula: String,
        impliedExpectationFormula: String,
        rounding: String,
        applicability: AnnualValuationMethodApplicability? = nil
    ) {
        self.id = id
        self.calculationVersion = calculationVersion
        self.presentValueFormula = presentValueFormula
        self.impliedExpectationFormula = impliedExpectationFormula
        self.rounding = rounding
        self.applicability = applicability
    }

    func validate(errors: inout [String]) {
        let adjusted = id == "adjusted_net_asset_value_user_scenario"
        if !["discounted_forward_metric_multiple_user_scenario", "adjusted_net_asset_value_user_scenario"].contains(id)
            || calculationVersion != (adjusted ? annualAdjustedNetAssetCalculationVersion : annualValuationCalculationVersion)
            || rounding != "decimal_places_6"
            || presentValueFormula != (adjusted ? annualAdjustedNetAssetValueFormula : annualValuationPresentValueFormula)
            || impliedExpectationFormula != annualValuationImpliedExpectationFormula {
            errors.append("valuation method identity or formula is invalid")
        }
        applicability?.validate(adjusted: adjusted, errors: &errors)
    }
}

public struct AnnualValuationMethodApplicability: Codable, Equatable, Sendable {
    public let ownerConfirmed: Bool
    public let companyDataBasis: String
    public let requiredAnchorMetrics: [String]
    public let limitation: String

    fileprivate func validate(adjusted: Bool, errors: inout [String]) {
        let basis = adjusted ? "reported_balance_sheet_net_assets_per_share" : "forward_operating_metric_per_share"
        let metrics = adjusted ? ["total_assets", "total_liabilities"] : ["revenue", "profit_attributable_to_owners"]
        if !ownerConfirmed || companyDataBasis != basis || requiredAnchorMetrics != metrics || limitation.isEmpty {
            errors.append("valuation method applicability does not match selected company data")
        }
    }
}

public struct AnnualValuationOutputs: Codable, Equatable, Sendable {
    public let projectedMetricPerShare: Double
    public let scenarioPresentValuePerShare: Double
    public let impliedAnnualGrowthRateAtCurrentPrice: Double?
    public let impliedExpectationStatus: String
    public let valueRange: AnnualValuationValueRange?
    public let scenarioMarginOfSafety: AnnualValuationScenarioMarginOfSafety?

    public init(
        projectedMetricPerShare: Double,
        scenarioPresentValuePerShare: Double,
        impliedAnnualGrowthRateAtCurrentPrice: Double?,
        impliedExpectationStatus: String,
        valueRange: AnnualValuationValueRange? = nil,
        scenarioMarginOfSafety: AnnualValuationScenarioMarginOfSafety? = nil
    ) {
        self.projectedMetricPerShare = projectedMetricPerShare
        self.scenarioPresentValuePerShare = scenarioPresentValuePerShare
        self.impliedAnnualGrowthRateAtCurrentPrice = impliedAnnualGrowthRateAtCurrentPrice
        self.impliedExpectationStatus = impliedExpectationStatus
        self.valueRange = valueRange
        self.scenarioMarginOfSafety = scenarioMarginOfSafety
    }

    func validate(errors: inout [String]) {
        if !projectedMetricPerShare.isFinite || projectedMetricPerShare <= 0
            || !scenarioPresentValuePerShare.isFinite || scenarioPresentValuePerShare <= 0
            || !["available", "not_computable"].contains(impliedExpectationStatus)
            || (impliedExpectationStatus == "available") != (impliedAnnualGrowthRateAtCurrentPrice != nil) {
            errors.append("valuation outputs are invalid")
        }
        valueRange?.validate(errors: &errors)
        scenarioMarginOfSafety?.validate(errors: &errors)
    }
}

public struct AnnualValuationValueRange: Codable, Equatable, Sendable {
    public let low: Double
    public let high: Double
    public let interpretation: String

    fileprivate func validate(errors: inout [String]) {
        if !low.isFinite || !high.isFinite || low <= 0 || low > high
            || interpretation != "research_scenario_range_not_target_price" {
            errors.append("valuation research scenario range is invalid")
        }
    }
}

public struct AnnualValuationScenarioMarginOfSafety: Codable, Equatable, Sendable {
    public let position: String
    public let low: Double
    public let base: Double
    public let high: Double
    public let interpretation: String

    public init(position: String, low: Double, base: Double, high: Double, interpretation: String) {
        self.position = position; self.low = low; self.base = base; self.high = high; self.interpretation = interpretation
    }

    fileprivate func validate(errors: inout [String]) {
        if !["below_range", "within_range", "above_range"].contains(position)
            || !low.isFinite || !base.isFinite || !high.isFinite
            || interpretation != "owner_scenario_distance_not_target_price_or_trade_signal" {
            errors.append("valuation scenario margin is invalid")
        }
    }
}

public struct AnnualValuationSensitivity: Codable, Equatable, Sendable {
    public let growthRates: [Double]
    public let terminalMultiples: [Double]
    public let cells: [AnnualValuationSensitivityCell]

    func validate(errors: inout [String]) {
        if growthRates.count != 3 || terminalMultiples.count != 3 || cells.count != 9
            || growthRates.contains(where: { !$0.isFinite })
            || terminalMultiples.contains(where: { !$0.isFinite })
            || cells.contains(where: { !$0.annualGrowthRate.isFinite || !$0.terminalMultiple.isFinite || !$0.presentValuePerShare.isFinite }) {
            errors.append("valuation sensitivity must be a finite 3 by 3 grid")
        }
    }
}

public struct AnnualValuationSensitivityCell: Codable, Equatable, Sendable {
    public let annualGrowthRate: Double
    public let terminalMultiple: Double
    public let presentValuePerShare: Double
}

public struct QuantExperimentComparison: Codable, Equatable, Sendable {
    public let snapshotId: String
    public let dataHash: String
    public let feePolicySha256: String
    public let dividendCashPolicySha256: String
    public let observationStartDate: String
    public let observationEndDate: String
    public let registryId: String
    public let selectionPolicy: String
    public let selectionWindow: QuantComparisonWindow
    public let experiments: [QuantComparedExperiment]
    public let benchmark: QuantComparedBenchmark
    public let returnBasis: String
    public let preservesSourceOrder: Bool
    public let ranking: Bool
    public let recommendation: Bool

    func validate(evidence: DecisionQuantEvidence, errors: inout [String]) {
        guard evidence.status == "available", let identities = evidence.identities,
              let refinement = evidence.decisionEvidence, refinement.status == "available",
              let source = refinement.source, let robustness = refinement.robustness else {
            errors.append("quant experiment comparison requires available canonical evidence")
            return
        }
        if snapshotId != identities.frozenSnapshot.snapshotId || dataHash != identities.frozenSnapshot.dataHash
            || observationStartDate != source.observationStartDate || observationEndDate != source.observationEndDate
            || !Self.sha(feePolicySha256) || !Self.sha(dividendCashPolicySha256)
            || registryId.range(of: #"^quant-parameter-search:[a-f0-9]{64}$"#, options: .regularExpression) == nil {
            errors.append("quant experiment comparison data, fee, dividend, or registry identity is invalid")
        }
        if selectionPolicy != "baseline_fixed_before_diagnostics_no_final_test"
            || selectionWindow.start != observationStartDate
            || selectionWindow.end != refinement.samples.first(where: { $0.id == "validation" })?.end
            || returnBasis != "strategy_net_fees_includes_cash_dividends_vs_hsi_price_only_non_equivalent"
            || !preservesSourceOrder || ranking || recommendation {
            errors.append("quant experiment comparison selection boundary is invalid")
        }
        let rejected = experiments.filter { $0.disposition == "rejected" }.map(\.id)
        if !(2...20).contains(experiments.count) || Set(experiments.map(\.id)).count != experiments.count
            || experiments.filter({ $0.disposition == "selected" }).count != 1
            || rejected != robustness.failedExperiments.experimentIds {
            errors.append("quant experiment comparison dropped or reordered registered failures")
        }
        experiments.forEach { $0.validate(errors: &errors) }
        benchmark.validate(refinement: refinement, source: source, errors: &errors)
    }

    private static func sha(_ value: String) -> Bool {
        value.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
    }
}

public struct QuantComparisonWindow: Codable, Equatable, Sendable {
    public let start: String
    public let end: String
}

public struct QuantComparedExperiment: Codable, Equatable, Sendable {
    public let id: String
    public let disposition: String
    public let reason: String
    public let signal: QuantComparedSignal
    public let finalTestUsedForSelection: Bool
    public let metrics: QuantComparedMetrics

    func validate(errors: inout [String]) {
        if id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !["selected", "rejected"].contains(disposition)
            || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || finalTestUsedForSelection
            || signal.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !signal.buyWhenPreviousCloseReturnLte.isFinite
            || !signal.sellWhenPreviousCloseReturnGte.isFinite
            || !(-1...0).contains(signal.buyWhenPreviousCloseReturnLte)
            || !(0...1).contains(signal.sellWhenPreviousCloseReturnGte) {
            errors.append("quant compared experiment identity, reason, or signal is invalid")
        }
        metrics.validate(errors: &errors)
    }
}

public struct QuantComparedSignal: Codable, Equatable, Sendable {
    public let name: String
    public let buyWhenPreviousCloseReturnLte: Double
    public let sellWhenPreviousCloseReturnGte: Double
}

public struct QuantComparedMetrics: Codable, Equatable, Sendable {
    public let totalReturn: Double
    public let maxDrawdown: Double
    public let totalFees: Double
    public let turnoverOneWay: Double
    public let tradeCount: Int
    public let closedRoundTripCount: Int

    func validate(errors: inout [String]) {
        if !totalReturn.isFinite || !(-1...100).contains(totalReturn)
            || !maxDrawdown.isFinite || !(-1...0).contains(maxDrawdown)
            || !totalFees.isFinite || !(0...1_000_000_000).contains(totalFees)
            || !turnoverOneWay.isFinite || !(0...1_000_000).contains(turnoverOneWay)
            || !(0...1_000_000).contains(tradeCount) || !(0...1_000_000).contains(closedRoundTripCount)
            || closedRoundTripCount * 2 > tradeCount || tradeCount > 0 && totalFees <= 0 {
            errors.append("quant compared experiment metrics are invalid")
        }
    }
}

public struct QuantComparedBenchmark: Codable, Equatable, Sendable {
    public let evidenceId: String
    public let symbol: String
    public let name: String
    public let sourceSha256: String
    public let seriesHash: String
    public let calculationPolicy: String
    public let periods: [QuantComparedBenchmarkPeriod]

    func validate(refinement: QuantDecisionEvidenceRefinement, source: QuantDecisionEvidenceSource, errors: inout [String]) {
        let check = refinement.formalEvidence?.checks.first(where: { $0.id == "benchmark" })
        guard refinement.samples.count == 3 else {
            errors.append("quant benchmark requires three canonical samples")
            return
        }
        if evidenceId.range(of: #"^quant-benchmark:[a-f0-9]{64}$"#, options: .regularExpression) == nil
            || evidenceId != check?.identity || symbol != "HK.800000" || name.isEmpty
            || sourceSha256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) == nil
            || seriesHash.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) == nil
            || calculationPolicy != "close_to_close_hsi_comparison_research_only"
            || periods.map(\.id) != ["train", "validation", "final_test", "full_period"] {
            errors.append("quant benchmark identity, source, or period order is invalid")
            return
        }
        for (index, period) in periods.enumerated() {
            let sample = index < 3 ? refinement.samples[index] : nil
            if period.start != (sample?.start ?? source.observationStartDate)
                || period.end != (sample?.end ?? source.observationEndDate)
                || period.usedForParameterSelection
                || !period.simulatedStrategyTotalReturn.isFinite || !period.benchmarkTotalReturn.isFinite
                || !period.difference.isFinite
                || abs(period.simulatedStrategyTotalReturn - period.benchmarkTotalReturn - period.difference) > 0.0000001
                || sample.map({ period.simulatedStrategyTotalReturn != $0.metrics.simulatedTotalReturn }) == true {
                errors.append("quant benchmark strategy and HSI price dates or returns are unbound")
            }
        }
    }
}

public struct QuantComparedBenchmarkPeriod: Codable, Equatable, Sendable {
    public let id: String
    public let start: String
    public let end: String
    public let simulatedStrategyTotalReturn: Double
    public let benchmarkTotalReturn: Double
    public let difference: Double
    public let usedForParameterSelection: Bool
}

public struct AnnualQuantProductView: Codable, Equatable, Sendable {
    public let status: String
    public let evidence: DecisionQuantEvidence
    public let model: AnnualQuantProductModel
    public let diagnostics: AnnualQuantDiagnostics
    public let filter: AnnualQuantFilterResult
    public let limitations: [String]

    func validate(symbol: String, generatedAt: String, errors: inout [String]) {
        evidence.validateForDisplay(expectedSymbol: symbol, availableBy: generatedAt, errors: &errors)
        if status != evidence.status { errors.append("quant product status must match canonical evidence") }
        model.validate(evidence: evidence, errors: &errors)
        diagnostics.validate(evidence: evidence, errors: &errors)
        filter.validate(evidence: evidence, errors: &errors)
        annualStrings(limitations, label: "quant product limitations", allowEmpty: false, errors: &errors)
    }
}

public struct AnnualQuantProductModel: Codable, Equatable, Sendable {
    public let modelVersion: String?
    public let universe: [String]
    public let sourceClassification: String
    public let adjustment: String?
    public let dataCutoff: String?
    public let snapshotId: String?
    public let snapshotHash: String?
    public let codeIdentity: String?

    func validate(evidence: DecisionQuantEvidence, errors: inout [String]) {
        if universe != evidence.sampleBoundary.universe || sourceClassification != evidence.sampleBoundary.sourceClassification {
            errors.append("quant product model universe or source classification is unbound")
        }
        if let identities = evidence.identities {
            if modelVersion != identities.baselineExperimentIdentity || codeIdentity != identities.baselineExperimentIdentity
                || snapshotId != identities.frozenSnapshot.snapshotId || snapshotHash != identities.frozenSnapshot.snapshotHash {
                errors.append("quant product model identity does not match canonical evidence")
            }
        } else if modelVersion != nil || codeIdentity != nil || snapshotId != nil || snapshotHash != nil {
            errors.append("fail-closed quant product model exposes identities")
        }
        let source = evidence.decisionEvidence?.status == "available" ? evidence.decisionEvidence?.source : nil
        if adjustment != source?.adjustment || dataCutoff != source?.dataCutoff {
            errors.append("quant product adjustment or cutoff does not match refinement source")
        }
    }
}

public struct AnnualQuantDiagnostics: Codable, Equatable, Sendable {
    public let benchmark: AnnualQuantDiagnosticGap
    public let sampleSize: AnnualQuantDiagnosticGap
    public let concentration: AnnualQuantDiagnosticGap
    public let parameterNeighborhood: AnnualQuantDiagnosticGap
    public let marketEnvironment: AnnualQuantDiagnosticGap
    public let failedExperiments: AnnualQuantFailedExperiments

    func validate(evidence: DecisionQuantEvidence, errors: inout [String]) {
        let expectedGapStatus = evidence.status == "available" ? "not_captured" : "unavailable"
        let checks = evidence.decisionEvidence?.status == "available"
            ? evidence.decisionEvidence?.formalEvidence?.checks ?? []
            : []
        benchmark.validate(sourceCheck: checks.first(where: { $0.id == "benchmark" }), expectedGapStatus: expectedGapStatus, errors: &errors)
        sampleSize.validate(sourceCheck: nil, expectedGapStatus: expectedGapStatus, derivedAvailable: evidence.decisionEvidence?.status == "available" && evidence.decisionEvidence?.samples.isEmpty == false && evidence.decisionEvidence?.samples.allSatisfy { $0.metrics.simulatedClosedRoundTripCount != nil } == true, errors: &errors)
        concentration.validate(sourceCheck: checks.first(where: { $0.id == "trade_stock_month_concentration" }), expectedGapStatus: expectedGapStatus, errors: &errors)
        parameterNeighborhood.validate(sourceCheck: checks.first(where: { $0.id == "parameter_search" }), expectedGapStatus: expectedGapStatus, errors: &errors)
        marketEnvironment.validate(sourceCheck: nil, expectedGapStatus: expectedGapStatus, errors: &errors)
        failedExperiments.validate(evidence: evidence, expectedGapStatus: expectedGapStatus, errors: &errors)
    }
}

public struct AnnualQuantDiagnosticGap: Codable, Equatable, Sendable {
    public let status: String
    public let limitation: String

    func validate(sourceCheck: QuantFormalEvidenceCheck?, expectedGapStatus: String, derivedAvailable: Bool = false, errors: inout [String]) {
        let expectedStatus = derivedAvailable || sourceCheck?.status == "available" ? "available" : expectedGapStatus
        if status != expectedStatus || limitation.isEmpty
            || (sourceCheck != nil && expectedStatus == "available" && limitation != sourceCheck?.limitation) {
            errors.append("quant diagnostic gap cannot claim uncaptured facts as available")
        }
    }
}

public struct AnnualQuantFailedExperiments: Codable, Equatable, Sendable {
    public let status: String
    public let experimentIds: [String]
    public let limitation: String

    func validate(evidence: DecisionQuantEvidence, expectedGapStatus: String, errors: inout [String]) {
        if !["available", "not_captured", "unavailable"].contains(status) || limitation.isEmpty {
            errors.append("quant failed-experiment diagnostic is invalid")
        }
        if evidence.decisionEvidence?.status == "available",
           let source = evidence.decisionEvidence?.robustness?.failedExperiments {
            let expected = source.status == "registered" ? "available" : "not_captured"
            if status != expected || experimentIds != source.experimentIds || limitation != source.limitation {
                errors.append("quant failed experiments do not bind canonical refinement")
            }
        } else if status != expectedGapStatus || experimentIds.isEmpty == false {
            errors.append("quant failed experiments must remain an empty explicit gap without canonical refinement facts")
        }
    }
}

public struct AnnualQuantFilterResult: Codable, Equatable, Sendable {
    public let status: String
    public let criteria: AnnualQuantFilterInput
    public let samples: [AnnualQuantFilterSample]
    public let preservesSourceOrder: Bool
    public let ranking: Bool
    public let score: Bool
    public let recommendation: Bool

    func validate(evidence: DecisionQuantEvidence, errors: inout [String]) {
        criteria.validate(errors: &errors)
        if !["available", "not_captured", "unavailable"].contains(status)
            || !preservesSourceOrder || ranking || score || recommendation {
            errors.append("quant filter must preserve order without ranking score or recommendation")
        }
        let source = evidence.decisionEvidence?.status == "available" ? evidence.decisionEvidence : nil
        let expectedStatus = source != nil ? "available" : (evidence.status == "available" ? "not_captured" : "unavailable")
        if status != expectedStatus {
            errors.append("quant filter status does not match canonical refinement availability")
        }
        guard expectedStatus == "available", let source else {
            if samples.isEmpty == false { errors.append("non-available quant filter must clear sample results") }
            return
        }
        if samples.count != source.samples.count { errors.append("quant filter must cover canonical samples") }
        for (index, sample) in samples.enumerated() where index < source.samples.count {
            sample.validate(source: source.samples[index], sourceIndex: index, criteria: criteria, errors: &errors)
        }
    }
}

public struct AnnualQuantFilterSample: Codable, Equatable, Sendable {
    public let sampleId: String
    public let sourceIndex: Int
    public let maxDrawdownMagnitude: Double
    public let turnoverOneWay: Double
    public let tradeCount: Int
    public let matchesMaxDrawdown: Bool
    public let matchesMaxTurnover: Bool
    public let matchesMinTradeCount: Bool
    public let allCriteriaMatched: Bool

    func validate(
        source: QuantDecisionEvidenceSample,
        sourceIndex expectedIndex: Int,
        criteria: AnnualQuantFilterInput,
        errors: inout [String]
    ) {
        let drawdown = annualRoundSix(abs(source.metrics.simulatedMaxDrawdown))
        let turnover = annualRoundSix(source.metrics.simulatedTurnoverOneWay)
        let drawdownMatch = drawdown <= criteria.maxDrawdownMagnitude
        let turnoverMatch = turnover <= criteria.maxTurnoverOneWay
        let tradesMatch = source.metrics.simulatedTradeCount >= criteria.minTradeCount
        if sampleId != source.id || sourceIndex != expectedIndex || !annualEqual(maxDrawdownMagnitude, drawdown)
            || !annualEqual(turnoverOneWay, turnover) || tradeCount != source.metrics.simulatedTradeCount
            || matchesMaxDrawdown != drawdownMatch || matchesMaxTurnover != turnoverMatch
            || matchesMinTradeCount != tradesMatch
            || allCriteriaMatched != (drawdownMatch && turnoverMatch && tradesMatch) {
            errors.append("quant filter sample does not recompute from canonical metrics in source order")
        }
    }
}

public struct AnnualValuationQuantSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let userInputsRequired: Bool
    public let changesCandidateOrdering: Bool
    public let recommendation: Bool
    public let ranking: Bool
    public let score: Bool
    public let targetPrice: Bool
    public let targetPosition: Bool
    public let tradeDirection: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let callsBroker: Bool
    public let mutatesOfficialPortfolio: Bool

    public static let readOnly = Self(
        advisoryOnly: true,
        userInputsRequired: true,
        changesCandidateOrdering: false,
        recommendation: false,
        ranking: false,
        score: false,
        targetPrice: false,
        targetPosition: false,
        tradeDirection: false,
        createsOrder: false,
        createsTrade: false,
        callsBroker: false,
        mutatesOfficialPortfolio: false
    )

    func validate(errors: inout [String]) {
        if !advisoryOnly || !userInputsRequired || changesCandidateOrdering || recommendation || ranking || score
            || targetPrice || targetPosition || tradeDirection || createsOrder || createsTrade || callsBroker
            || mutatesOfficialPortfolio {
            errors.append("valuation quant safety boundary is invalid")
        }
    }
}

private func annualBound(_ value: Double, _ range: ClosedRange<Double>, _ label: String, _ errors: inout [String]) {
    if !value.isFinite || !range.contains(value) { errors.append("\(label) is outside its bounded range") }
}

private func annualStrings(_ values: [String], label: String, allowEmpty: Bool, errors: inout [String]) {
    if (!allowEmpty && values.isEmpty) || values.count > 100
        || values.contains(where: { $0.isEmpty || $0.count > 2_000 }) {
        errors.append("\(label) must contain bounded strings")
    }
}

private func annualParseDateTime(_ value: String) -> Bool {
    isParseableDateTime(value)
}

private func annualRoundSix(_ value: Double) -> Double {
    floor((value + Double.ulpOfOne) * 1_000_000 + 0.5) / 1_000_000
}

private func annualEqual(_ left: Double, _ right: Double) -> Bool {
    abs(left - right) < 0.0000005
}
