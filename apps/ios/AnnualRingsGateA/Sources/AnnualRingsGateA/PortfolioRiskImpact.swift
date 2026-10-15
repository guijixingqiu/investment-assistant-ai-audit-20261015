import Foundation

public enum PortfolioRiskImpactStatus: String, Codable, Equatable, Sendable {
    case available
    case blocked
    case invalid
}
public enum PortfolioRiskImpactValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public enum PortfolioRiskImpactBindingError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct PortfolioRiskImpactEnvelope: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-15.portfolio-risk-impact.v1"
    public static let calculationVersionV1 = "portfolio-risk-impact.v1"

    public let schemaVersion: String
    public let calculationVersion: String
    public let status: PortfolioRiskImpactStatus
    public let impactId: String?
    public let contextId: String?
    public let portfolioSnapshotId: String?
    public let candidateSymbol: String
    public let hypotheticalAmount: Double?
    public let currency: String
    public let current: PortfolioRiskCurrent
    public let scenario: PortfolioRiskScenario
    public let gaps: [String]
    public let guardrails: PortfolioRiskGuardrails
    public let message: String

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case calculationVersion
        case status
        case impactId
        case contextId
        case portfolioSnapshotId
        case candidateSymbol
        case hypotheticalAmount
        case currency
        case current
        case scenario
        case gaps
        case guardrails
        case message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        calculationVersion = try container.decode(String.self, forKey: .calculationVersion)
        status = try container.decode(PortfolioRiskImpactStatus.self, forKey: .status)
        impactId = try container.decodePortfolioRiskRequiredNullable(String.self, forKey: .impactId)
        contextId = try container.decodePortfolioRiskRequiredNullable(String.self, forKey: .contextId)
        portfolioSnapshotId = try container.decodePortfolioRiskRequiredNullable(String.self, forKey: .portfolioSnapshotId)
        candidateSymbol = try container.decode(String.self, forKey: .candidateSymbol)
        hypotheticalAmount = try container.decodePortfolioRiskRequiredNullable(Double.self, forKey: .hypotheticalAmount)
        currency = try container.decode(String.self, forKey: .currency)
        current = try container.decode(PortfolioRiskCurrent.self, forKey: .current)
        scenario = try container.decode(PortfolioRiskScenario.self, forKey: .scenario)
        gaps = try container.decode([String].self, forKey: .gaps)
        guardrails = try container.decode(PortfolioRiskGuardrails.self, forKey: .guardrails)
        message = try container.decode(String.self, forKey: .message)
    }

    public func validateForDisplay() throws {
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionV1 || calculationVersion != Self.calculationVersionV1 {
            errors.append("portfolio risk contract version is invalid")
        }
        for (value, label) in [(impactId, "impactId"), (contextId, "contextId"), (portfolioSnapshotId, "portfolioSnapshotId")] {
            if let value, value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                errors.append("\(label) must be non-empty when present")
            }
        }
        if !isPortfolioDecisionCanonicalHongKongSymbol(candidateSymbol) {
            errors.append("candidateSymbol must be a canonical Hong Kong symbol")
        }
        if hypotheticalAmount.map({ !$0.isFinite || $0 < 0 }) == true {
            errors.append("hypotheticalAmount must be finite and non-negative when present")
        }
        if currency != "HKD" {
            errors.append("portfolio risk currency must be HKD")
        }
        current.validate(errors: &errors)
        scenario.validate(errors: &errors)
        guardrails.validate(errors: &errors)
        if gaps.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            errors.append("portfolio risk gaps must be non-empty strings")
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("portfolio risk message is required")
        }

        switch status {
        case .available:
            if impactId == nil || contextId == nil || portfolioSnapshotId == nil {
                errors.append("available portfolio risk requires bound identities")
            }
            if !isPortfolioDecisionFiniteNonNegative(hypotheticalAmount) {
                errors.append("available portfolio risk requires a valid hypothetical amount")
            }
            if current.alreadyHeld == nil || !isPortfolioDecisionFiniteNonNegative(current.marketValue) || !isPortfolioDecisionFiniteNonNegative(current.weight) {
                errors.append("available portfolio risk requires complete current calculations")
            }
            if !scenario.hasCompleteAvailableValues {
                errors.append("available portfolio risk requires complete scenario calculations")
            }
        case .blocked, .invalid:
            if impactId != nil {
                errors.append("blocked or invalid portfolio risk must not expose impactId")
            }
            if current.hasAnyValue || scenario.hasAnyValue {
                errors.append("blocked or invalid portfolio risk must not expose stale calculations")
            }
        }

        if !errors.isEmpty {
            throw PortfolioRiskImpactValidationError.invalid(errors)
        }
    }
}

public struct PortfolioRiskCurrent: Codable, Equatable, Sendable {
    public let alreadyHeld: Bool?
    public let marketValue: Double?
    public let weight: Double?

    private enum CodingKeys: String, CodingKey {
        case alreadyHeld
        case marketValue
        case weight
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        alreadyHeld = try container.decodePortfolioRiskRequiredNullable(Bool.self, forKey: .alreadyHeld)
        marketValue = try container.decodePortfolioRiskRequiredNullable(Double.self, forKey: .marketValue)
        weight = try container.decodePortfolioRiskRequiredNullable(Double.self, forKey: .weight)
    }

    fileprivate var hasAnyValue: Bool {
        alreadyHeld != nil || marketValue != nil || weight != nil
    }

    fileprivate func validate(errors: inout [String]) {
        validatePortfolioDecisionFinite(marketValue, label: "current.marketValue", errors: &errors)
        validatePortfolioDecisionFinite(weight, label: "current.weight", errors: &errors)
    }
}

public struct PortfolioRiskScenario: Codable, Equatable, Sendable {
    public let totalMarketValue: Double?
    public let candidateMarketValue: Double?
    public let candidateWeight: Double?
    public let weightChange: Double?
    public let largestPositionWeight: Double?
    public let hhi: Double?

    private enum CodingKeys: String, CodingKey {
        case totalMarketValue
        case candidateMarketValue
        case candidateWeight
        case weightChange
        case largestPositionWeight
        case hhi
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        totalMarketValue = try container.decodePortfolioRiskRequiredNullable(Double.self, forKey: .totalMarketValue)
        candidateMarketValue = try container.decodePortfolioRiskRequiredNullable(Double.self, forKey: .candidateMarketValue)
        candidateWeight = try container.decodePortfolioRiskRequiredNullable(Double.self, forKey: .candidateWeight)
        weightChange = try container.decodePortfolioRiskRequiredNullable(Double.self, forKey: .weightChange)
        largestPositionWeight = try container.decodePortfolioRiskRequiredNullable(Double.self, forKey: .largestPositionWeight)
        hhi = try container.decodePortfolioRiskRequiredNullable(Double.self, forKey: .hhi)
    }

    fileprivate var hasAnyValue: Bool {
        totalMarketValue != nil || candidateMarketValue != nil || candidateWeight != nil || weightChange != nil || largestPositionWeight != nil || hhi != nil
    }

    fileprivate var hasCompleteAvailableValues: Bool {
        isPortfolioDecisionFiniteNonNegative(totalMarketValue)
            && isPortfolioDecisionFiniteNonNegative(candidateMarketValue)
            && isPortfolioDecisionFiniteNonNegative(candidateWeight)
            && weightChange.map({ $0.isFinite }) == true
            && isPortfolioDecisionFiniteNonNegative(largestPositionWeight)
            && isPortfolioDecisionFiniteNonNegative(hhi)
    }

    fileprivate func validate(errors: inout [String]) {
        validatePortfolioDecisionFinite(totalMarketValue, label: "scenario.totalMarketValue", errors: &errors)
        validatePortfolioDecisionFinite(candidateMarketValue, label: "scenario.candidateMarketValue", errors: &errors)
        validatePortfolioDecisionFinite(candidateWeight, label: "scenario.candidateWeight", errors: &errors)
        validatePortfolioDecisionFinite(weightChange, label: "scenario.weightChange", errors: &errors)
        validatePortfolioDecisionFinite(largestPositionWeight, label: "scenario.largestPositionWeight", errors: &errors)
        validatePortfolioDecisionFinite(hhi, label: "scenario.hhi", errors: &errors)
    }
}

public struct PortfolioRiskGuardrails: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let userProvidedAmountOnly: Bool
    public let generatesDirection: Bool
    public let recommendsAmount: Bool
    public let recommendsTargetWeight: Bool
    public let recommendsTiming: Bool
    public let promisesReturn: Bool
    public let createsOrder: Bool
    public let productionWrite: Bool

    fileprivate func validate(errors: inout [String]) {
        if !advisoryOnly || !userProvidedAmountOnly {
            errors.append("portfolio risk advisory guardrails must remain enabled")
        }
        if generatesDirection || recommendsAmount || recommendsTargetWeight || recommendsTiming || promisesReturn || createsOrder || productionWrite {
            errors.append("portfolio risk recommendation, order, and production-write guardrails must remain false")
        }
    }
}

public func validatePortfolioRiskImpactBinding(
    impact: PortfolioRiskImpactEnvelope,
    context: PortfolioDecisionContextEnvelope,
    candidateSymbol: String,
    hypotheticalAmount: Double,
    allowStaleReadOnly: Bool = false
) throws {
    try context.validateForDisplay()
    try impact.validateForDisplay()

    var errors: [String] = []
    guard context.status == .available || allowStaleReadOnly && context.status == .stale,
          let portfolioMarketValue = context.summary.marketValue.amount,
          portfolioMarketValue > 0 else {
        throw PortfolioRiskImpactBindingError.invalid([
            "risk impact requires the currently displayed complete portfolio context"
        ])
    }
    if !isPortfolioDecisionCanonicalHongKongSymbol(candidateSymbol) {
        errors.append("risk impact requires a canonical Hong Kong candidate")
    }
    if !hypotheticalAmount.isFinite || hypotheticalAmount < 0 {
        errors.append("risk impact requires a finite non-negative user amount")
    }
    if impact.status != .available {
        errors.append("risk impact is no longer available for the displayed portfolio")
    }
    if impact.contextId != context.contextId {
        errors.append("risk impact contextId must match the displayed portfolio facts")
    }
    if impact.portfolioSnapshotId != context.portfolioSnapshotId {
        errors.append("risk impact portfolioSnapshotId must match the displayed Pingan snapshot")
    }
    if impact.candidateSymbol != candidateSymbol {
        errors.append("risk impact candidateSymbol must match the selected candidate")
    }
    if impact.hypotheticalAmount != hypotheticalAmount {
        errors.append("risk impact amount must match the user-provided amount")
    }

    if errors.isEmpty {
        let currentPosition = context.positions.first(where: { $0.symbol == candidateSymbol })
        let currentMarketValue = currentPosition?.marketValue ?? 0
        let currentWeight = currentPosition?.marketWeight ?? 0
        let totalMarketValue = portfolioDecisionJSRound(portfolioMarketValue + hypotheticalAmount)
        let candidateMarketValue = portfolioDecisionJSRound(currentMarketValue + hypotheticalAmount)
        let candidateWeight = totalMarketValue == 0 ? 0 : portfolioDecisionJSRound(candidateMarketValue / totalMarketValue, digits: 8)
        var scenarioValues = context.positions
            .filter { $0.symbol != candidateSymbol }
            .map { $0.marketValue ?? 0 }
        scenarioValues.append(candidateMarketValue)
        let weights = scenarioValues
            .map { totalMarketValue == 0 ? 0 : $0 / totalMarketValue }
            .sorted(by: >)
        let largestPositionWeight = portfolioDecisionJSRound(weights.first ?? 0, digits: 8)
        let hhi = portfolioDecisionJSRound(weights.reduce(0) { $0 + ($1 * $1) }, digits: 8)

        if impact.current.alreadyHeld != (currentPosition != nil)
            || impact.current.marketValue != currentMarketValue
            || impact.current.weight != currentWeight
            || impact.scenario.totalMarketValue != totalMarketValue
            || impact.scenario.candidateMarketValue != candidateMarketValue
            || impact.scenario.candidateWeight != candidateWeight
            || impact.scenario.weightChange != portfolioDecisionJSRound(candidateWeight - currentWeight, digits: 8)
            || impact.scenario.largestPositionWeight != largestPositionWeight
            || impact.scenario.hhi != hhi {
            errors.append("risk impact calculations do not match the currently displayed portfolio facts")
        }
    }

    if !errors.isEmpty {
        throw PortfolioRiskImpactBindingError.invalid(errors)
    }
}

func portfolioDecisionJSRound(_ value: Double, digits: Int = 2) -> Double {
    let factor = pow(10, Double(digits))
    return floor((value * factor) + 0.5) / factor
}

private extension KeyedDecodingContainer {
    func decodePortfolioRiskRequiredNullable<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        guard contains(key) else {
            throw DecodingError.keyNotFound(
                key,
                DecodingError.Context(
                    codingPath: codingPath,
                    debugDescription: "Required nullable key '\(key.stringValue)' is missing"
                )
            )
        }
        return try decodeIfPresent(type, forKey: key)
    }
}
