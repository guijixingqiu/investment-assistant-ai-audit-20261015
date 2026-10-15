import Foundation
public let quantDecisionEvidenceRefinementSchemaVersion = "2026-07-16.quant-decision-evidence-refinement.v1"

public enum QuantDecisionEvidenceRefinementValidationError: Error, Equatable {
    case invalid([String])
}

public struct QuantDecisionEvidenceRefinement: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let status: String
    public let refinementId: String?
    public let symbol: String?
    public let source: QuantDecisionEvidenceSource?
    public let samples: [QuantDecisionEvidenceSample]
    public let execution: QuantDecisionEvidenceExecution?
    public let robustness: QuantDecisionEvidenceRobustness?
    public let formalEvidence: QuantFormalEvidence?
    public let interpretation: String
    public let limitations: [String]

    public static func notCaptured(_ limitation: String) -> Self {
        unavailable(status: "not_captured", interpretation: "not_captured_no_reconstruction", limitation: limitation)
    }

    public static func unavailable(_ limitation: String) -> Self {
        unavailable(status: "unavailable", interpretation: "unavailable_no_research_interpretation", limitation: limitation)
    }

    func validateForDisplay(
        expectedSymbol: String,
        outerStatus: String,
        outerIdentities: DecisionQuantEvidenceIdentities?,
        outerUniverse: [String],
        errors: inout [String]
    ) {
        if schemaVersion != quantDecisionEvidenceRefinementSchemaVersion {
            errors.append("decision context quantEvidence decisionEvidence schemaVersion is invalid")
        }
        if ["available", "not_captured", "unavailable"].contains(status) == false {
            errors.append("decision context quantEvidence decisionEvidence status is invalid")
        }
        if limitations.isEmpty || limitations.count > 20 || limitations.contains(where: { quantBoundedNonEmpty($0) == false }) {
            errors.append("decision context quantEvidence decisionEvidence limitations must be bounded non-empty strings")
        }
        guard status == "available" else {
            validateUnavailable(errors: &errors)
            return
        }
        if outerStatus != "available" {
            errors.append("decision context quantEvidence decisionEvidence cannot be available while outer quant evidence is fail-closed")
        }
        guard let refinementId,
              refinementId.range(of: #"^quant-decision-evidence:[a-f0-9]{64}$"#, options: .regularExpression) != nil else {
            errors.append("decision context quantEvidence decisionEvidence refinementId is invalid")
            return
        }
        if symbol != expectedSymbol || outerUniverse.contains(expectedSymbol) == false {
            errors.append("decision context quantEvidence decisionEvidence symbol must match requestedSymbol and outer universe")
        }
        guard let source, let execution, let robustness, let outerIdentities else {
            errors.append("decision context quantEvidence decisionEvidence available facts and outer identities are required")
            return
        }
        source.validateForDisplay(errors: &errors)
        if source.snapshotId != outerIdentities.frozenSnapshot.snapshotId ||
            source.snapshotHash != outerIdentities.frozenSnapshot.snapshotHash ||
            source.dataHash != outerIdentities.frozenSnapshot.dataHash ||
            source.sourceClassification != outerIdentities.frozenSnapshot.sourceClassification ||
            source.baselineExperimentIdentity != outerIdentities.baselineExperimentIdentity ||
            source.shadowPortfolioIdentity != outerIdentities.shadowPortfolioIdentity {
            errors.append("decision context quantEvidence decisionEvidence source identities must match outer quant identities")
        }
        validateSamples(expectedIds: outerIdentities.splitIds, errors: &errors)
        if let first = samples.first, first.start < source.observationStartDate {
            errors.append("decision context quantEvidence decisionEvidence samples cannot start before the source observation range")
        }
        if let last = samples.last, last.end > source.observationEndDate {
            errors.append("decision context quantEvidence decisionEvidence samples cannot end after the source observation range")
        }
        execution.validateForDisplay(errors: &errors)
        robustness.validateForDisplay(errors: &errors)
        formalEvidence?.validateForDisplay(expectedSymbol: expectedSymbol, errors: &errors)
        if interpretation != "historical_simulation_only_no_predictive_or_recommendation_authority" {
            errors.append("decision context quantEvidence decisionEvidence interpretation must remain historical simulation only")
        }
    }

    private func validateUnavailable(errors: inout [String]) {
        if refinementId != nil || symbol != nil || source != nil || execution != nil || robustness != nil || formalEvidence != nil || samples.isEmpty == false {
            errors.append("decision context quantEvidence unavailable decisionEvidence must not expose reconstructed facts")
        }
        let expected = status == "not_captured" ? "not_captured_no_reconstruction" : "unavailable_no_research_interpretation"
        if interpretation != expected {
            errors.append("decision context quantEvidence decisionEvidence unavailable interpretation is invalid")
        }
    }

    private func validateSamples(expectedIds: [String], errors: inout [String]) {
        let expected: [(String, String, Bool, Bool)] = [
            ("train", "retrospective_parameter_registration_and_sanity", true, false),
            ("validation", "retrospective_validation", true, false),
            ("final_test", "locked_report_only", false, true)
        ]
        if samples.count != expected.count || samples.map(\.id) != expectedIds {
            errors.append("decision context quantEvidence decisionEvidence samples must match outer train validation final_test identities")
            return
        }
        var priorEnd: String?
        for (index, sample) in samples.enumerated() {
            let boundary = expected[index]
            if sample.id != boundary.0 || sample.role != boundary.1 ||
                sample.parameterSelectionAllowed != boundary.2 || sample.finalTestLocked != boundary.3 {
                errors.append("decision context quantEvidence decisionEvidence sample \(sample.id) boundary is invalid")
            }
            if quantDateOnly(sample.start) == false || quantDateOnly(sample.end) == false || sample.start > sample.end {
                errors.append("decision context quantEvidence decisionEvidence sample \(sample.id) date range is invalid")
            }
            if let priorEnd, sample.start <= priorEnd {
                errors.append("decision context quantEvidence decisionEvidence sample windows must be ordered and non-overlapping")
            }
            priorEnd = sample.end
            sample.metrics.validateForDisplay(label: sample.id, errors: &errors)
        }
    }

    private static func unavailable(status: String, interpretation: String, limitation: String) -> Self {
        Self(
            schemaVersion: quantDecisionEvidenceRefinementSchemaVersion,
            status: status,
            refinementId: nil,
            symbol: nil,
            source: nil,
            samples: [],
            execution: nil,
            robustness: nil,
            formalEvidence: nil,
            interpretation: interpretation,
            limitations: [limitation]
        )
    }
}

public struct QuantFormalEvidence: Codable, Equatable, Sendable {
    public let candidateResearchRule: QuantCandidateResearchRule
    public let checks: [QuantFormalEvidenceCheck]

    fileprivate func validateForDisplay(expectedSymbol: String, errors: inout [String]) {
        candidateResearchRule.validateForDisplay(expectedSymbol: expectedSymbol, errors: &errors)
        let expected = [
            "immutable_dataset", "hong_kong_investable_universe", "benchmark",
            "raw_corporate_actions", "t_plus_one", "board_lot", "non_zero_costs",
            "suspension_zero_volume_missing_price", "cash_position_accounting", "out_of_sample",
            "parameter_search", "failed_experiments", "trade_stock_month_concentration"
        ]
        if checks.map(\.id) != expected {
            errors.append("quant formal evidence checks must preserve the complete governed order")
        }
        for check in checks {
            if !["available", "unknown"].contains(check.status)
                || (check.status == "available" ? quantBoundedNonEmpty(check.identity ?? "") == false : check.identity != nil)
                || quantBoundedNonEmpty(check.limitation) == false {
                errors.append("quant formal evidence \(check.id) availability or identity is invalid")
            }
        }
    }
}

public struct QuantCandidateResearchRule: Codable, Equatable, Sendable {
    public let ruleVersion: String
    public let universeVersion: String
    public let cutoff: String
    public let symbols: [String]
    public let eligibilityEvidenceStatus: String
    public let manualResearchOnlyWhenEligibilityUnknown: Bool
    public let preservesSourceOrder: Bool
    public let ranking: Bool
    public let recommendation: Bool
    public let limitations: [String]

    fileprivate func validateForDisplay(expectedSymbol: String, errors: inout [String]) {
        if quantBoundedNonEmpty(ruleVersion) == false || quantBoundedNonEmpty(universeVersion) == false
            || quantDateTime(cutoff) == false || symbols.isEmpty || Set(symbols).count != symbols.count
            || symbols.contains(expectedSymbol) == false
            || symbols.contains(where: { $0.range(of: #"^HK\.\d{5}$"#, options: .regularExpression) == nil })
            || !["available", "unknown"].contains(eligibilityEvidenceStatus)
            || manualResearchOnlyWhenEligibilityUnknown == false || preservesSourceOrder == false
            || ranking || recommendation || limitations.isEmpty
            || limitations.contains(where: { quantBoundedNonEmpty($0) == false }) {
            errors.append("quant candidate research rule is invalid or exceeds research-only authority")
        }
    }
}

public struct QuantFormalEvidenceCheck: Codable, Equatable, Sendable {
    public let id: String
    public let status: String
    public let identity: String?
    public let limitation: String
}

public struct QuantDecisionEvidenceSource: Codable, Equatable, Sendable {
    public let snapshotId: String
    public let snapshotHash: String
    public let dataHash: String
    public let sourceClassification: String
    public let adjustment: String
    public let dataCutoff: String
    public let observationStartDate: String
    public let observationEndDate: String
    public let baselineExperimentIdentity: String
    public let shadowPortfolioIdentity: String

    fileprivate func validateForDisplay(errors: inout [String]) {
        for (label, value) in [
            ("snapshotId", snapshotId),
            ("baselineExperimentIdentity", baselineExperimentIdentity),
            ("shadowPortfolioIdentity", shadowPortfolioIdentity)
        ] where quantBoundedNonEmpty(value) == false {
            errors.append("decision context quantEvidence decisionEvidence source \(label) is required")
        }
        for (label, value) in [("snapshotHash", snapshotHash), ("dataHash", dataHash)]
        where value.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) == nil {
            errors.append("decision context quantEvidence decisionEvidence source \(label) must be SHA-256")
        }
        if ["fixture", "real", "historical", "research_only"].contains(sourceClassification) == false {
            errors.append("decision context quantEvidence decisionEvidence source classification is invalid")
        }
        if ["none", "forward", "backward"].contains(adjustment) == false {
            errors.append("decision context quantEvidence decisionEvidence source adjustment is invalid")
        }
        if quantDateTime(dataCutoff) == false || quantDateOnly(observationStartDate) == false ||
            quantDateOnly(observationEndDate) == false || observationStartDate > observationEndDate {
            errors.append("decision context quantEvidence decisionEvidence source dates are invalid")
        }
        if String(dataCutoff.prefix(10)) < observationEndDate {
            errors.append("decision context quantEvidence decisionEvidence source data cutoff precedes observation end")
        }
    }
}
public struct QuantDecisionEvidenceSample: Codable, Equatable, Sendable {
    public let id: String
    public let role: String
    public let start: String
    public let end: String
    public let parameterSelectionAllowed: Bool
    public let finalTestLocked: Bool
    public let metrics: QuantDecisionEvidenceSampleMetrics
}
public struct QuantDecisionEvidenceSampleMetrics: Codable, Equatable, Sendable {
    public let simulatedTotalReturn: Double
    public let simulatedAnnualizedReturn: Double?
    public let simulatedMaxDrawdown: Double
    public let simulatedSharpe: Double
    public let simulatedTradeCount: Int
    public let simulatedClosedRoundTripCount: Int?
    public let simulatedWinRate: Double?
    public let simulatedTotalFees: Double
    public let simulatedTurnoverOneWay: Double
    public let simulatedAverageGrossExposure: Double
    public let accountingAuditStatus: String
    fileprivate func validateForDisplay(label: String, errors: inout [String]) {
        let ranges: [(String, Double, ClosedRange<Double>)] = [
            ("simulatedTotalReturn", simulatedTotalReturn, -1...100),
            ("simulatedMaxDrawdown", simulatedMaxDrawdown, -1...0),
            ("simulatedSharpe", simulatedSharpe, -100...100),
            ("simulatedTotalFees", simulatedTotalFees, 0...1_000_000_000),
            ("simulatedTurnoverOneWay", simulatedTurnoverOneWay, 0...1_000_000),
            ("simulatedAverageGrossExposure", simulatedAverageGrossExposure, 0...1)
        ]
        for (field, value, range) in ranges where value.isFinite == false || range.contains(value) == false {
            errors.append("decision context quantEvidence decisionEvidence \(label) \(field) is outside its bounded range")
        }
        if simulatedTradeCount < 0 || simulatedTradeCount > 1_000_000 ||
            (simulatedTradeCount > 0 && simulatedTotalFees <= 0) {
            errors.append("decision context quantEvidence decisionEvidence \(label) trades require non-zero fees")
        }
        let capturedPerformance = [simulatedAnnualizedReturn != nil, simulatedClosedRoundTripCount != nil, simulatedWinRate != nil]
        if capturedPerformance.contains(true) && capturedPerformance.contains(false) {
            errors.append("decision context quantEvidence decisionEvidence \(label) annualized return, round trips, and win rate must be captured together")
        } else if let annualized = simulatedAnnualizedReturn, let roundTrips = simulatedClosedRoundTripCount, let winRate = simulatedWinRate,
                  annualized.isFinite == false || (-1...100).contains(annualized) == false || roundTrips < 0 || roundTrips * 2 > simulatedTradeCount || winRate.isFinite == false || (0...1).contains(winRate) == false || (roundTrips == 0 && winRate != 0) {
            errors.append("decision context quantEvidence decisionEvidence \(label) annualized return, round trips, or win rate is invalid")
        }
        if accountingAuditStatus != "passed" {
            errors.append("decision context quantEvidence decisionEvidence \(label) accounting audit must pass")
        }
    }
}
public struct QuantDecisionEvidenceExecution: Codable, Equatable, Sendable {
    public let signalTiming: String
    public let earliestExecution: String
    public let allowsSameBarExecution: Bool
    public let allowsMargin: Bool
    public let boardLot: Int
    public let feeCurrency: String
    public let nonZeroCosts: Bool
    public let suspensionHandling: String
    public let zeroVolumeHandling: String
    public let missingPriceHandling: String
    fileprivate func validateForDisplay(errors: inout [String]) {
        if signalTiming != "after_close_t" || earliestExecution != "next_trading_day_open" ||
            allowsSameBarExecution || allowsMargin || boardLot <= 0 || boardLot > 1_000_000 || feeCurrency != "HKD" ||
            nonZeroCosts == false || suspensionHandling != "reject_execution" ||
            zeroVolumeHandling != "reject_execution" || missingPriceHandling != "reject_execution" {
            errors.append("decision context quantEvidence decisionEvidence execution boundary is unsafe or incomplete")
        }
    }
}
public struct QuantDecisionEvidenceRobustness: Codable, Equatable, Sendable {
    public let registrationTiming: String
    public let preregistered: Bool
    public let prospectiveHoldoutClaim: Bool
    public let finalTestUsedForParameterSelection: Bool
    public let finalTestUsedForAcceptanceThresholdFitting: Bool
    public let allSplitAccountingAuditsPassed: Bool
    public let failedExperiments: QuantDecisionEvidenceFailedExperiments

    fileprivate func validateForDisplay(errors: inout [String]) {
        if registrationTiming != "retrospective_after_snapshot" || preregistered || prospectiveHoldoutClaim ||
            finalTestUsedForParameterSelection || finalTestUsedForAcceptanceThresholdFitting ||
            allSplitAccountingAuditsPassed == false {
            errors.append("decision context quantEvidence decisionEvidence robustness boundary is unsafe or overstated")
        }
        failedExperiments.validateForDisplay(errors: &errors)
    }
}
public struct QuantDecisionEvidenceFailedExperiments: Codable, Equatable, Sendable {
    public let status: String
    public let experimentIds: [String]
    public let limitation: String

    fileprivate func validateForDisplay(errors: inout [String]) {
        if ["registered", "not_captured"].contains(status) == false || experimentIds.count > 100 ||
            Set(experimentIds).count != experimentIds.count ||
            experimentIds.contains(where: { quantBoundedNonEmpty($0) == false }) ||
            quantBoundedNonEmpty(limitation) == false {
            errors.append("decision context quantEvidence decisionEvidence failed-experiment boundary is invalid")
        }
        if (status == "registered" && experimentIds.isEmpty) || (status == "not_captured" && experimentIds.isEmpty == false) {
            errors.append("decision context quantEvidence decisionEvidence failed-experiment identities conflict with status")
        }
    }
}
func validateQuantDecisionEvidenceCanonicalIdentity(_ data: Data, nestedContextKey: String? = nil) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw QuantDecisionEvidenceRefinementValidationError.invalid(["decision context response must be a JSON object"])
    }
    let context: [String: Any]
    if let nestedContextKey {
        guard let nested = root[nestedContextKey] else { return }
        if nested is NSNull { return }
        guard let nested = nested as? [String: Any] else {
            throw QuantDecisionEvidenceRefinementValidationError.invalid(["nested decision context must be a JSON object or null"])
        }
        context = nested
    } else {
        context = root
    }
    let errors = quantDecisionEvidenceRawErrors(context: context, label: "decision context")
    if errors.isEmpty == false {
        throw QuantDecisionEvidenceRefinementValidationError.invalid(errors)
    }
}
func quantDecisionEvidenceRawErrors(context: [String: Any], label: String) -> [String] {
    guard let quant = context["quantEvidence"] as? [String: Any],
          let refinement = quant["decisionEvidence"] as? [String: Any] else {
        return []
    }
    var errors: [String] = []
    quantRejectKeys(refinement, allowed: [
        "schemaVersion", "status", "refinementId", "symbol", "source", "samples",
        "execution", "robustness", "formalEvidence", "interpretation", "limitations"
    ], label: "\(label) quant decision evidence", errors: &errors)
    if let source = refinement["source"] as? [String: Any] {
        quantRejectKeys(source, allowed: [
            "snapshotId", "snapshotHash", "dataHash", "sourceClassification", "adjustment",
            "dataCutoff", "observationStartDate", "observationEndDate",
            "baselineExperimentIdentity", "shadowPortfolioIdentity"
        ], label: "\(label) quant decision evidence source", errors: &errors)
    }
    for (index, sample) in (refinement["samples"] as? [[String: Any]] ?? []).enumerated() {
        quantRejectKeys(sample, allowed: ["id", "role", "start", "end", "parameterSelectionAllowed", "finalTestLocked", "metrics"], label: "\(label) quant decision evidence samples[\(index)]", errors: &errors)
        if let metrics = sample["metrics"] as? [String: Any] {
            quantRejectKeys(metrics, allowed: [
                "simulatedTotalReturn", "simulatedMaxDrawdown", "simulatedSharpe", "simulatedTradeCount",
                "simulatedTotalFees", "simulatedTurnoverOneWay", "simulatedAverageGrossExposure", "accountingAuditStatus",
                "simulatedAnnualizedReturn", "simulatedClosedRoundTripCount", "simulatedWinRate"
            ], label: "\(label) quant decision evidence samples[\(index)].metrics", errors: &errors)
        }
    }
    if let execution = refinement["execution"] as? [String: Any] {
        quantRejectKeys(execution, allowed: [
            "signalTiming", "earliestExecution", "allowsSameBarExecution", "allowsMargin", "boardLot",
            "feeCurrency", "nonZeroCosts", "suspensionHandling", "zeroVolumeHandling", "missingPriceHandling"
        ], label: "\(label) quant decision evidence execution", errors: &errors)
    }
    if let robustness = refinement["robustness"] as? [String: Any] {
        quantRejectKeys(robustness, allowed: [
            "registrationTiming", "preregistered", "prospectiveHoldoutClaim", "finalTestUsedForParameterSelection",
            "finalTestUsedForAcceptanceThresholdFitting", "allSplitAccountingAuditsPassed", "failedExperiments"
        ], label: "\(label) quant decision evidence robustness", errors: &errors)
        if let failed = robustness["failedExperiments"] as? [String: Any] {
            quantRejectKeys(failed, allowed: ["status", "experimentIds", "limitation"], label: "\(label) quant decision evidence failedExperiments", errors: &errors)
        }
    }
    if let formal = refinement["formalEvidence"] as? [String: Any] {
        quantRejectKeys(formal, allowed: ["candidateResearchRule", "checks"], label: "\(label) quant formal evidence", errors: &errors)
        if let rule = formal["candidateResearchRule"] as? [String: Any] {
            quantRejectKeys(rule, allowed: [
                "ruleVersion", "universeVersion", "cutoff", "symbols", "eligibilityEvidenceStatus",
                "manualResearchOnlyWhenEligibilityUnknown", "preservesSourceOrder", "ranking",
                "recommendation", "limitations"
            ], label: "\(label) quant candidate research rule", errors: &errors)
        }
        for (index, check) in (formal["checks"] as? [[String: Any]] ?? []).enumerated() {
            quantRejectKeys(check, allowed: ["id", "status", "identity", "limitation"], label: "\(label) quant formal evidence checks[\(index)]", errors: &errors)
        }
    }
    if refinement["status"] as? String == "available" {
        do {
            let expected = try portfolioDecisionContentId(
                object: refinement,
                prefix: "quant-decision-evidence:",
                excludingTopLevelKeys: ["refinementId"]
            )
            if refinement["refinementId"] as? String != expected {
                errors.append("\(label) quant decision evidence refinementId does not match canonical content")
            }
        } catch {
            errors.append("\(label) quant decision evidence canonical SHA-256 validation failed")
        }
    }
    return errors
}
private func quantRejectKeys(_ value: [String: Any], allowed: Set<String>, label: String, errors: inout [String]) {
    for key in value.keys where allowed.contains(key) == false {
        errors.append("\(label) contains unsupported field \(key)")
    }
}

private func quantDateOnly(_ value: String) -> Bool {
    guard value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return false }
    return quantCalendarComponentsAreValid(value, includesTime: false)
}

private func quantDateTime(_ value: String) -> Bool {
    guard value.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#, options: .regularExpression) != nil else {
        return false
    }
    return quantCalendarComponentsAreValid(value, includesTime: true)
}

private func quantCalendarComponentsAreValid(_ value: String, includesTime: Bool) -> Bool {
    let values = value.split(whereSeparator: { "-T:.Z".contains($0) }).compactMap { Int($0) }
    guard values.count == (includesTime ? 7 : 3) else { return false }
    let year = values[0], month = values[1], day = values[2]
    guard (1...9_999).contains(year), (1...12).contains(month) else { return false }
    let leap = year.isMultiple(of: 400) || year.isMultiple(of: 4) && !year.isMultiple(of: 100)
    let days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    guard (1...days[month - 1]).contains(day) else { return false }
    return !includesTime || (0...23).contains(values[3])
        && (0...59).contains(values[4])
        && (0...59).contains(values[5])
        && (0...999).contains(values[6])
}

private func quantBoundedNonEmpty(_ value: String) -> Bool {
    value.count <= 1_000 && value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
}
