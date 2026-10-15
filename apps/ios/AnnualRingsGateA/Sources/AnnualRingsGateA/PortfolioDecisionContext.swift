import Foundation

public enum PortfolioDecisionContextStatus: String, Codable, Equatable, Sendable {
    case available
    case stale
    case partial
    case zeroPosition = "zero_position"
    case empty
    case conflict
    case unauthorized
    case unavailable
}

public enum PortfolioDecisionQuoteStatus: String, Codable, Equatable, Sendable {
    case current
    case stale
    case unavailable
}

public enum PortfolioDecisionMarketValueStatus: String, Codable, Equatable, Sendable {
    case completeCurrent = "complete_current"
    case completeStale = "complete_stale"
    case partial
    case unavailable
}

public enum PortfolioDecisionConcentrationStatus: String, Codable, Equatable, Sendable {
    case available
    case unavailable
}

public enum PortfolioDecisionContextValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct PortfolioDecisionContextEnvelope: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-15.portfolio-decision-context.v1"

    public let schemaVersion: String
    public let status: PortfolioDecisionContextStatus
    public let contextId: String?
    public let portfolioSnapshotId: String?
    public let accountScopeId: String?
    public let portfolioSource: String?
    public let sourceAsOf: String?
    public let portfolioAsOf: String?
    public let importedAt: String?
    public let fetchedAt: String?
    public let freshness: PortfolioDecisionFreshness?
    public let assembledAt: String
    public let positions: [PortfolioDecisionPosition]
    public let summary: PortfolioDecisionSummary
    public let dataUse: PortfolioDecisionDataUse
    public let gaps: [String]
    public let message: String
    let provenanceFieldsPresent: Bool

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case status
        case contextId
        case portfolioSnapshotId
        case accountScopeId
        case portfolioSource
        case sourceAsOf
        case portfolioAsOf
        case importedAt
        case fetchedAt
        case freshness
        case assembledAt
        case positions
        case summary
        case dataUse
        case gaps
        case message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        status = try container.decode(PortfolioDecisionContextStatus.self, forKey: .status)
        contextId = try container.decodeRequiredNullable(String.self, forKey: .contextId)
        portfolioSnapshotId = try container.decodeRequiredNullable(String.self, forKey: .portfolioSnapshotId)
        accountScopeId = try container.decodeRequiredNullable(String.self, forKey: .accountScopeId)
        portfolioSource = try container.decodeRequiredNullable(String.self, forKey: .portfolioSource)
        provenanceFieldsPresent = [.sourceAsOf, .importedAt, .fetchedAt, .freshness].contains(where: container.contains)
        if provenanceFieldsPresent {
            sourceAsOf = try container.decodeRequiredNullable(String.self, forKey: .sourceAsOf)
            importedAt = try container.decodeRequiredNullable(String.self, forKey: .importedAt)
            fetchedAt = try container.decodeRequiredNullable(String.self, forKey: .fetchedAt)
            freshness = try container.decodeRequiredNullable(PortfolioDecisionFreshness.self, forKey: .freshness)
        } else {
            sourceAsOf = nil
            importedAt = nil
            fetchedAt = nil
            freshness = nil
        }
        portfolioAsOf = try container.decodeRequiredNullable(String.self, forKey: .portfolioAsOf)
        assembledAt = try container.decode(String.self, forKey: .assembledAt)
        positions = try container.decode([PortfolioDecisionPosition].self, forKey: .positions)
        summary = try container.decode(PortfolioDecisionSummary.self, forKey: .summary)
        dataUse = try container.decode(PortfolioDecisionDataUse.self, forKey: .dataUse)
        gaps = try container.decode([String].self, forKey: .gaps)
        message = try container.decode(String.self, forKey: .message)
    }

    public func validateForDisplay() throws {
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionV1 {
            errors.append("portfolio context schemaVersion is invalid")
        }
        if let contextId, contextId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("contextId must be non-empty when present")
        }
        if let portfolioSnapshotId, portfolioSnapshotId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("portfolioSnapshotId must be non-empty when present")
        }
        if let accountScopeId, accountScopeId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("accountScopeId must be non-empty when present")
        }
        if let portfolioSource, !["pingan_imported_snapshot", "owner_entered_current"].contains(portfolioSource) {
            errors.append("portfolioSource must be pingan_imported_snapshot when present")
        }
        if let sourceAsOf, !isPortfolioDecisionStrictDate(sourceAsOf) {
            errors.append("sourceAsOf must be an ISO UTC date-time when present")
        }
        if let portfolioAsOf, !isPortfolioDecisionStrictDate(portfolioAsOf) {
            errors.append("portfolioAsOf must be an ISO UTC date-time when present")
        }
        if let importedAt, !isPortfolioDecisionStrictDate(importedAt) {
            errors.append("importedAt must be an ISO UTC date-time when present")
        }
        if let fetchedAt, !isPortfolioDecisionStrictDate(fetchedAt) {
            errors.append("fetchedAt must be an ISO UTC date-time when present")
        }
        if portfolioSource == "owner_entered_current" && freshness != nil { errors.append("manual holdings must not claim broker freshness") }
        freshness?.validate(sourceAsOf: sourceAsOf, errors: &errors)
        if !isPortfolioDecisionStrictDate(assembledAt) {
            errors.append("assembledAt must be an ISO UTC date-time")
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("portfolio context message is required")
        }
        if gaps.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            errors.append("portfolio context gaps must be non-empty strings")
        }
        for (index, position) in positions.enumerated() {
            position.validate(index: index, errors: &errors)
        }
        summary.validate(positionCount: positions.count, errors: &errors)
        dataUse.validate(status: status, errors: &errors)

        switch status {
        case .available, .stale, .partial, .zeroPosition:
            if contextId == nil || portfolioSnapshotId == nil || accountScopeId == nil || portfolioAsOf == nil {
                errors.append("displayable portfolio context requires bound identities")
            }
            if provenanceFieldsPresent && (sourceAsOf == nil || importedAt == nil || fetchedAt == nil || (freshness == nil && portfolioSource != "owner_entered_current")) {
                errors.append("displayable portfolio context requires Pingan provenance and freshness")
            }
            if provenanceFieldsPresent && sourceAsOf != portfolioAsOf {
                errors.append("displayable portfolio context sourceAsOf must equal portfolioAsOf")
            }
            if !["pingan_imported_snapshot", "owner_entered_current"].contains(portfolioSource ?? "") {
                errors.append("displayable portfolio context requires Pingan source")
            }
            validateDisplayableChronology(errors: &errors)
            if provenanceFieldsPresent {
                validateDisplayableProvenance(errors: &errors)
                validateUnrealizedPnl(errors: &errors)
            }
            if (status == .available || status == .partial) && positions.isEmpty {
                errors.append("position-bearing displayable portfolio context requires positions")
            }
            if status == .zeroPosition && !positions.isEmpty {
                errors.append("zero-position portfolio context must expose zero positions")
            }
            if status == .available {
                validateAvailableFacts(errors: &errors)
            } else if status == .zeroPosition || (status == .stale && positions.isEmpty) {
                validateZeroPositionFacts(errors: &errors)
            }
            validateDisplayableFacts(errors: &errors)
        case .empty, .conflict, .unauthorized, .unavailable:
            if !positions.isEmpty {
                errors.append("fail-closed portfolio context must not expose positions")
            }
            if contextId != nil || portfolioSnapshotId != nil || portfolioSource != nil || sourceAsOf != nil || portfolioAsOf != nil || importedAt != nil || fetchedAt != nil || freshness != nil {
                errors.append("fail-closed portfolio context must clear portfolio fact identities")
            }
            validateFailClosedSummary(errors: &errors)
        }

        if !errors.isEmpty {
            throw PortfolioDecisionContextValidationError.invalid(errors)
        }
    }

}

public struct PortfolioDecisionPosition: Codable, Equatable, Sendable {
    public let market: String
    public let code: String
    public let symbol: String
    public let name: String?
    public let quantity: Double
    public let averageCost: Double?
    public let unrealizedPnl: Double?
    public let sourceWeight: Double?
    public let currency: String?
    public let sourceRowId: String
    public let quote: PortfolioDecisionQuote
    public let latestPrice: Double?
    public let marketValue: Double?
    public let marketWeight: Double?

    private enum CodingKeys: String, CodingKey {
        case market
        case code
        case symbol
        case name
        case quantity
        case averageCost
        case unrealizedPnl
        case sourceWeight
        case currency
        case sourceRowId
        case quote
        case latestPrice
        case marketValue
        case marketWeight
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        market = try container.decode(String.self, forKey: .market)
        code = try container.decode(String.self, forKey: .code)
        symbol = try container.decode(String.self, forKey: .symbol)
        name = try container.decodeRequiredNullable(String.self, forKey: .name)
        quantity = try container.decode(Double.self, forKey: .quantity)
        averageCost = try container.decodeRequiredNullable(Double.self, forKey: .averageCost)
        unrealizedPnl = try container.decodeRequiredNullable(Double.self, forKey: .unrealizedPnl)
        sourceWeight = try container.decodeRequiredNullable(Double.self, forKey: .sourceWeight)
        currency = try container.decodeRequiredNullable(String.self, forKey: .currency)
        sourceRowId = try container.decode(String.self, forKey: .sourceRowId)
        quote = try container.decode(PortfolioDecisionQuote.self, forKey: .quote)
        latestPrice = try container.decodeRequiredNullable(Double.self, forKey: .latestPrice)
        marketValue = try container.decodeRequiredNullable(Double.self, forKey: .marketValue)
        marketWeight = try container.decodeRequiredNullable(Double.self, forKey: .marketWeight)
    }

    fileprivate func validate(index: Int, errors: inout [String]) {
        let prefix = "positions[\(index)]"
        if market != "HK" || code.range(of: #"^\d{5}$"#, options: .regularExpression) == nil || symbol != "HK.\(code)" {
            errors.append("\(prefix) must identify one canonical Hong Kong symbol")
        }
        if !quantity.isFinite || quantity <= 0 {
            errors.append("\(prefix).quantity must be finite and positive")
        }
        validatePortfolioDecisionFiniteNonNegativeIfPresent(averageCost, label: "\(prefix).averageCost", errors: &errors)
        validatePortfolioDecisionFinite(unrealizedPnl, label: "\(prefix).unrealizedPnl", errors: &errors)
        validatePortfolioDecisionUnitIntervalIfPresent(sourceWeight, label: "\(prefix).sourceWeight", errors: &errors)
        if sourceRowId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(prefix).sourceRowId is required")
        }
        quote.validate(prefix: "\(prefix).quote", errors: &errors)

        switch quote.status {
        case .unavailable:
            if latestPrice != nil || marketValue != nil || marketWeight != nil {
                errors.append("\(prefix) must not expose price or value when quote is unavailable")
            }
        case .current, .stale:
            if latestPrice.map({ !$0.isFinite || $0 <= 0 }) != false {
                errors.append("\(prefix).latestPrice must be finite and positive")
            }
            if !isPortfolioDecisionFiniteNonNegative(marketValue) {
                errors.append("\(prefix).marketValue must be finite and non-negative")
            }
            validatePortfolioDecisionFinite(marketWeight, label: "\(prefix).marketWeight", errors: &errors)
        }
    }
}

public struct PortfolioDecisionQuote: Codable, Equatable, Sendable {
    public let status: PortfolioDecisionQuoteStatus
    public let source: String?
    public let quoteAsOf: String?
    public let fetchedAt: String?

    private enum CodingKeys: String, CodingKey {
        case status
        case source
        case quoteAsOf
        case fetchedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        status = try container.decode(PortfolioDecisionQuoteStatus.self, forKey: .status)
        source = try container.decodeRequiredNullable(String.self, forKey: .source)
        quoteAsOf = try container.decodeRequiredNullable(String.self, forKey: .quoteAsOf)
        fetchedAt = try container.decodeRequiredNullable(String.self, forKey: .fetchedAt)
    }

    fileprivate func validate(prefix: String, errors: inout [String]) {
        switch status {
        case .unavailable:
            if source != nil || quoteAsOf != nil || fetchedAt != nil {
                errors.append("\(prefix) unavailable state must not expose source times")
            }
        case .current, .stale:
            if source != "futu" {
                errors.append("\(prefix).source must be futu")
            }
            if quoteAsOf.map(isPortfolioDecisionStrictDate) != true {
                errors.append("\(prefix).quoteAsOf must be an ISO UTC date-time")
            }
            if fetchedAt.map(isPortfolioDecisionStrictDate) != true {
                errors.append("\(prefix).fetchedAt must be an ISO UTC date-time")
            }
            if let quoteDate = quoteAsOf.flatMap(portfolioDecisionStrictDate),
               let fetchedDate = fetchedAt.flatMap(portfolioDecisionStrictDate),
               quoteDate > fetchedDate {
                errors.append("\(prefix).quoteAsOf must not be after fetchedAt")
            }
        }
    }
}

public struct PortfolioDecisionDataUse: Codable, Equatable, Sendable {
    public let display: String
    public let advisoryRiskImpact: String
    public let productionPortfolio: String
    public let brokerReconciliation: String
    public let accounting: String
    public let execution: String

    fileprivate func validate(status: PortfolioDecisionContextStatus, errors: inout [String]) {
        let expectedDisplay: String
        let expectedRisk: String
        switch status {
        case .available:
            expectedDisplay = "allowed"
            expectedRisk = "allowed_current_development_only"
        case .stale:
            expectedDisplay = "allowed_with_warning"
            expectedRisk = "blocked_stale"
        case .partial:
            expectedDisplay = "allowed_with_warning"
            expectedRisk = "blocked_incomplete"
        case .zeroPosition:
            expectedDisplay = "allowed"
            expectedRisk = "blocked"
        case .empty, .conflict, .unauthorized, .unavailable:
            expectedDisplay = "blocked"
            expectedRisk = "blocked"
        }
        if display != expectedDisplay || advisoryRiskImpact != expectedRisk {
            errors.append("portfolio dataUse must match status")
        }
        if productionPortfolio != "blocked_not_production_authority" {
            errors.append("production portfolio authority must remain blocked")
        }
        if brokerReconciliation != "blocked" || accounting != "blocked" || execution != "blocked" {
            errors.append("broker reconciliation, accounting, and execution must remain blocked")
        }
    }
}


private extension KeyedDecodingContainer {
    func decodeRequiredNullable<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
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

func portfolioDecisionStrictDate(_ value: String) -> Date? {
    guard value.range(
        of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#,
        options: .regularExpression
    ) != nil else {
        return nil
    }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value)
}

private func isPortfolioDecisionStrictDate(_ value: String) -> Bool {
    portfolioDecisionStrictDate(value) != nil
}

func isPortfolioDecisionCanonicalHongKongSymbol(_ value: String) -> Bool {
    value.range(of: #"^HK\.\d{5}$"#, options: .regularExpression) != nil
}

func isPortfolioDecisionFiniteNonNegative(_ value: Double?) -> Bool {
    guard let value else { return false }
    return value.isFinite && value >= 0
}

func isPortfolioDecisionUnitInterval(_ value: Double?) -> Bool {
    guard let value else { return false }
    return value.isFinite && value >= 0 && value <= 1
}

func validatePortfolioDecisionFinite(_ value: Double?, label: String, errors: inout [String]) {
    if let value, !value.isFinite {
        errors.append("\(label) must be finite when present")
    }
}

func validatePortfolioDecisionFiniteNonNegativeIfPresent(_ value: Double?, label: String, errors: inout [String]) {
    if let value, (!value.isFinite || value < 0) {
        errors.append("\(label) must be finite and non-negative when present")
    }
}

func validatePortfolioDecisionUnitIntervalIfPresent(_ value: Double?, label: String, errors: inout [String]) {
    if let value, (!value.isFinite || value < 0 || value > 1) {
        errors.append("\(label) must be between 0 and 1 when present")
    }
}
