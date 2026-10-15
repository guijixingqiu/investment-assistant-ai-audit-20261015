import Foundation

public struct PortfolioDecisionSummary: Codable, Equatable, Sendable {
    public let positionCount: Int
    public let marketValue: PortfolioDecisionMarketValueSummary
    public let cash: PortfolioDecisionCashSummary
    public let unrealizedPnl: Double?
    public let concentration: PortfolioDecisionConcentrationSummary
    let unrealizedPnlFieldPresent: Bool

    private enum CodingKeys: String, CodingKey {
        case positionCount, marketValue, cash, unrealizedPnl, concentration
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        positionCount = try container.decode(Int.self, forKey: .positionCount)
        marketValue = try container.decode(PortfolioDecisionMarketValueSummary.self, forKey: .marketValue)
        cash = try container.decode(PortfolioDecisionCashSummary.self, forKey: .cash)
        unrealizedPnlFieldPresent = container.contains(.unrealizedPnl)
        unrealizedPnl = try container.decodeIfPresent(Double.self, forKey: .unrealizedPnl)
        concentration = try container.decode(PortfolioDecisionConcentrationSummary.self, forKey: .concentration)
    }

    func validate(positionCount expectedPositionCount: Int, errors: inout [String]) {
        if positionCount != expectedPositionCount {
            errors.append("summary.positionCount must equal positions.count")
        }
        marketValue.validate(errors: &errors)
        cash.validate(errors: &errors)
        if unrealizedPnlFieldPresent {
            validatePortfolioDecisionFinite(unrealizedPnl, label: "summary.unrealizedPnl", errors: &errors)
        }
        concentration.validate(errors: &errors)
    }
}

public struct PortfolioDecisionMarketValueSummary: Codable, Equatable, Sendable {
    public let status: PortfolioDecisionMarketValueStatus
    public let amount: Double?
    public let currency: String?
    public let missingPositionCount: Int

    private enum CodingKeys: String, CodingKey { case status, amount, currency, missingPositionCount }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        status = try container.decode(PortfolioDecisionMarketValueStatus.self, forKey: .status)
        amount = try container.decodeRequiredNullable(Double.self, forKey: .amount)
        currency = try container.decodeRequiredNullable(String.self, forKey: .currency)
        missingPositionCount = try container.decode(Int.self, forKey: .missingPositionCount)
    }

    func validate(errors: inout [String]) {
        validatePortfolioDecisionFinite(amount, label: "summary.marketValue.amount", errors: &errors)
        if let currency, currency != "HKD" {
            errors.append("summary.marketValue.currency must be HKD when present")
        }
        if missingPositionCount < 0 {
            errors.append("summary.marketValue.missingPositionCount must be non-negative")
        }
    }
}

public struct PortfolioDecisionCashSummary: Codable, Equatable, Sendable {
    public let status: String
    public let amount: Double?
    public let currency: String?
    public let reason: String

    private enum CodingKeys: String, CodingKey { case status, amount, currency, reason }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        status = try container.decode(String.self, forKey: .status)
        amount = try container.decodeRequiredNullable(Double.self, forKey: .amount)
        currency = try container.decodeRequiredNullable(String.self, forKey: .currency)
        reason = try container.decode(String.self, forKey: .reason)
    }

    func validate(errors: inout [String]) {
        if status != "unknown" || amount != nil || currency != nil || reason != "not_provided_by_authoritative_snapshot" {
            errors.append("summary.cash must remain explicit unknown")
        }
    }
}

public struct PortfolioDecisionConcentrationSummary: Codable, Equatable, Sendable {
    public let status: PortfolioDecisionConcentrationStatus
    public let largestPositionWeight: Double?
    public let topThreeWeight: Double?
    public let hhi: Double?

    private enum CodingKeys: String, CodingKey { case status, largestPositionWeight, topThreeWeight, hhi }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        status = try container.decode(PortfolioDecisionConcentrationStatus.self, forKey: .status)
        largestPositionWeight = try container.decodeRequiredNullable(Double.self, forKey: .largestPositionWeight)
        topThreeWeight = try container.decodeRequiredNullable(Double.self, forKey: .topThreeWeight)
        hhi = try container.decodeRequiredNullable(Double.self, forKey: .hhi)
    }

    func validate(errors: inout [String]) {
        validatePortfolioDecisionFinite(largestPositionWeight, label: "summary.concentration.largestPositionWeight", errors: &errors)
        validatePortfolioDecisionFinite(topThreeWeight, label: "summary.concentration.topThreeWeight", errors: &errors)
        validatePortfolioDecisionFinite(hhi, label: "summary.concentration.hhi", errors: &errors)
    }
}

private extension KeyedDecodingContainer {
    func decodeRequiredNullable<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        guard contains(key) else {
            throw DecodingError.keyNotFound(key, .init(codingPath: codingPath, debugDescription: "Required nullable key '\(key.stringValue)' is missing"))
        }
        return try decodeIfPresent(type, forKey: key)
    }
}
