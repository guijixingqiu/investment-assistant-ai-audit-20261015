import Foundation

public enum CandidateOverviewStatus: String, Codable, Equatable, Sendable {
    case available
    case empty
    case unavailable
}

public enum CandidateOverviewQuoteStatus: String, Codable, Equatable, Sendable {
    case fresh
    case stale
    case unavailable
}

public enum CandidateOverviewValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct CandidateOverviewEnvelope: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-02.core-1d.candidate-overview.v1"

    public let schemaVersion: String
    public let generatedAt: String
    public let status: CandidateOverviewStatus
    public let message: String
    public let provenance: CandidateOverviewProvenance
    public let metadata: FactMetadata
    public let candidates: [CandidateOverviewItem]

    public static func unavailable(_ message: String) -> CandidateOverviewEnvelope {
        CandidateOverviewEnvelope(
            schemaVersion: schemaVersionV1,
            generatedAt: ISO8601DateFormatter().string(from: Date()),
            status: .unavailable,
            message: message,
            provenance: CandidateOverviewProvenance(
                candidates: "research_profiles",
                quotes: "persisted_market_quotes",
                portfolio: "omitted"
            ),
            metadata: FactMetadata(
                source: "candidate_overview:research_profiles",
                asOf: ISO8601DateFormatter().string(from: Date()),
                fetchedAt: nil,
                freshness: "unavailable",
                provenance: "research_only",
                authority: "unavailable",
                stale: false,
                missing: false,
                conflict: false,
                fixture: false,
                correctionOf: nil,
                replaces: nil,
                message: "Candidate overview metadata is unavailable; no partial candidate facts are exposed."
            ),
            candidates: []
        )
    }

    public func validateForDisplay() throws {
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionV1 {
            errors.append("schemaVersion must be \(Self.schemaVersionV1)")
        }
        if generatedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !isCandidateOverviewDateTime(generatedAt) {
            errors.append("generatedAt must be a valid date-time")
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("message is required")
        }
        if provenance.candidates != "research_profiles" ||
            provenance.quotes != "persisted_market_quotes" ||
            provenance.portfolio != "omitted" {
            errors.append("provenance must use research_profiles, persisted_market_quotes, and omitted portfolio")
        }
        metadata.validateForDisplay(label: "candidate overview", errors: &errors)
        if status == .available, metadata.freshness != "fresh" {
            errors.append("candidate overview metadata freshness must be fresh")
        }
        if status == .empty, metadata.freshness != "missing" {
            errors.append("candidate overview metadata freshness must be missing")
        }
        if status == .unavailable, metadata.freshness == "fresh" {
            errors.append("candidate overview metadata must not be fresh when unavailable")
        }
        if metadata.provenance != "research_only" {
            errors.append("candidate overview metadata provenance must be research_only")
        }
        if metadata.authority != "research_evidence" && metadata.authority != "unavailable" {
            errors.append("candidate overview metadata authority must be research_evidence or unavailable")
        }

        switch status {
        case .available:
            if candidates.isEmpty {
                errors.append("available status requires at least one candidate")
            }
        case .empty, .unavailable:
            if candidates.isEmpty == false {
                errors.append("\(status.rawValue) status requires zero candidates")
            }
        }

        var symbols = Set<String>()
        for candidate in candidates {
            candidate.validate(errors: &errors)
            if symbols.contains(candidate.symbol) {
                errors.append("candidate symbols must be unique")
            }
            symbols.insert(candidate.symbol)
        }

        if errors.isEmpty == false {
            throw CandidateOverviewValidationError.invalid(errors)
        }
    }
}

public struct CandidateOverviewProvenance: Codable, Equatable, Sendable {
    public let candidates: String
    public let quotes: String
    public let portfolio: String
}

public struct CandidateOverviewItem: Codable, Equatable, Identifiable, Sendable {
    public let market: String
    public let code: String
    public let symbol: String
    public let name: String?
    public let researchUpdatedAt: String
    public let nextReviewOn: String?
    public let reviewDue: Bool
    public let evidenceCount: Int
    public let latestEvidenceCapturedAt: String?
    public let pendingSuggestionCount: Int
    public let quote: CandidateOverviewQuoteState

    public var id: String { symbol }

    private enum CodingKeys: String, CodingKey {
        case market
        case code
        case symbol
        case name
        case researchUpdatedAt
        case nextReviewOn
        case reviewDue
        case evidenceCount
        case latestEvidenceCapturedAt
        case pendingSuggestionCount
        case quote
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        market = try container.decode(String.self, forKey: .market)
        code = try container.decode(String.self, forKey: .code)
        symbol = try container.decode(String.self, forKey: .symbol)
        name = try container.decodeRequiredNullable(String.self, forKey: .name)
        researchUpdatedAt = try container.decode(String.self, forKey: .researchUpdatedAt)
        nextReviewOn = try container.decodeRequiredNullable(String.self, forKey: .nextReviewOn)
        reviewDue = try container.decode(Bool.self, forKey: .reviewDue)
        evidenceCount = try container.decode(Int.self, forKey: .evidenceCount)
        latestEvidenceCapturedAt = try container.decodeRequiredNullable(String.self, forKey: .latestEvidenceCapturedAt)
        pendingSuggestionCount = try container.decode(Int.self, forKey: .pendingSuggestionCount)
        quote = try container.decode(CandidateOverviewQuoteState.self, forKey: .quote)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(market, forKey: .market)
        try container.encode(code, forKey: .code)
        try container.encode(symbol, forKey: .symbol)
        try container.encode(name, forKey: .name)
        try container.encode(researchUpdatedAt, forKey: .researchUpdatedAt)
        try container.encode(nextReviewOn, forKey: .nextReviewOn)
        try container.encode(reviewDue, forKey: .reviewDue)
        try container.encode(evidenceCount, forKey: .evidenceCount)
        try container.encode(latestEvidenceCapturedAt, forKey: .latestEvidenceCapturedAt)
        try container.encode(pendingSuggestionCount, forKey: .pendingSuggestionCount)
        try container.encode(quote, forKey: .quote)
    }

    fileprivate func validate(errors: inout [String]) {
        if market != "HK" {
            errors.append("candidate.market must be HK")
        }
        if code.range(of: #"^\d{5}$"#, options: .regularExpression) == nil {
            errors.append("candidate.code must be a five digit Hong Kong code")
        }
        if symbol != "\(market).\(code)" {
            errors.append("candidate.symbol must equal market.code")
        }
        if researchUpdatedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !isCandidateOverviewDateTime(researchUpdatedAt) {
            errors.append("candidate.researchUpdatedAt must be a valid date-time")
        }
        if let nextReviewOn,
           nextReviewOn.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("candidate.nextReviewOn must be non-empty when present")
        }
        if evidenceCount < 0 {
            errors.append("candidate.evidenceCount must be non-negative")
        }
        if let latestEvidenceCapturedAt,
           (latestEvidenceCapturedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !isCandidateOverviewDateTime(latestEvidenceCapturedAt)) {
            errors.append("candidate.latestEvidenceCapturedAt must be a valid date-time when present")
        }
        if pendingSuggestionCount < 0 {
            errors.append("candidate.pendingSuggestionCount must be non-negative")
        }
        quote.validate(errors: &errors)
    }
}

public struct CandidateOverviewQuoteState: Codable, Equatable, Sendable {
    public let status: CandidateOverviewQuoteStatus
    public let source: String?
    public let fetchedAt: String?
    public let staleReason: String?
    public let metadata: FactMetadata

    private enum CodingKeys: String, CodingKey {
        case status
        case source
        case fetchedAt
        case staleReason
        case metadata
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        status = try container.decode(CandidateOverviewQuoteStatus.self, forKey: .status)
        source = try container.decodeRequiredNullable(String.self, forKey: .source)
        fetchedAt = try container.decodeRequiredNullable(String.self, forKey: .fetchedAt)
        staleReason = try container.decodeRequiredNullable(String.self, forKey: .staleReason)
        metadata = try container.decode(FactMetadata.self, forKey: .metadata)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(status, forKey: .status)
        try container.encode(source, forKey: .source)
        try container.encode(fetchedAt, forKey: .fetchedAt)
        try container.encode(staleReason, forKey: .staleReason)
        try container.encode(metadata, forKey: .metadata)
    }

    fileprivate func validate(errors: inout [String]) {
        metadata.validateForDisplay(label: "candidate quote", errors: &errors)
        if status == .fresh, metadata.freshness != "fresh" {
            errors.append("candidate quote metadata freshness must be fresh")
        }
        if status == .stale, metadata.freshness != "stale" {
            errors.append("candidate quote metadata freshness must be stale")
        }
        if status == .unavailable, metadata.freshness == "fresh" {
            errors.append("candidate quote metadata must not be fresh when unavailable")
        }
        if metadata.authority != "market_data" && metadata.authority != "unavailable" {
            errors.append("candidate quote metadata authority must be market_data or unavailable")
        }
        if let source, source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("candidate.quote.source must be non-empty when present")
        }
        if let fetchedAt,
           (fetchedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !isCandidateOverviewDateTime(fetchedAt)) {
            errors.append("candidate.quote.fetchedAt must be a valid date-time when present")
        }
        let staleReasons = ["quote_time_exceeds_live_max_age", "no_persisted_quote", "repository_error"]
        if let staleReason, staleReasons.contains(staleReason) == false {
            errors.append("candidate.quote.staleReason is invalid")
        }
        switch status {
        case .fresh:
            if staleReason != nil {
                errors.append("fresh quote must not carry staleReason")
            }
        case .stale:
            if staleReason == nil {
                errors.append("stale quote requires staleReason")
            }
        case .unavailable:
            break
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

private func isCandidateOverviewDateTime(_ value: String) -> Bool {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if fractional.date(from: value) != nil {
        return true
    }
    let standard = ISO8601DateFormatter()
    standard.formatOptions = [.withInternetDateTime]
    return standard.date(from: value) != nil
}
