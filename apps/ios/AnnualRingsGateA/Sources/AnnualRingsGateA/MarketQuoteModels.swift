import Foundation

public enum MarketStatus: String, Codable, Equatable, Sendable {
    case live
    case stale
    case unavailable
}

public enum MarketProvider: String, Codable, Equatable, Sendable {
    case futu
    case fixture
    case cache
    case unavailable
}

public enum MarketSearchStatus: String, Codable, Equatable, Sendable {
    case available
    case unavailable
}

public struct KnownHongKongStock: Codable, Equatable, Sendable {
    public let market: String
    public let code: String
    public let symbol: String
    public let name: String?
}

public struct MarketSearchSource: Codable, Equatable, Sendable {
    public let provider: String
    public let fetchedAt: String?
    public let quoteDataOnly: Bool
}

public struct MarketSearchEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let status: MarketSearchStatus
    public let query: String
    public let scope: String
    public let source: MarketSearchSource
    public let results: [KnownHongKongStock]
    public let message: String

    public func validateForDisplay(expectedQuery: String) throws {
        var errors: [String] = []
        if schemaVersion != "2026-08-10.hk-stock-search.v2" { errors.append("market search schemaVersion is invalid") }
        if query != expectedQuery { errors.append("market search query identity changed") }
        if scope != "futu_opend_hk_stocks" && scope != "local_known_stocks" { errors.append("market search scope is invalid") }
        if source.quoteDataOnly == false { errors.append("market search source must remain quote-data-only") }
        if status == .available {
            if (scope == "futu_opend_hk_stocks" && source.provider != "futu_opend")
                || (scope == "local_known_stocks" && source.provider != "local_database") {
                errors.append("market search source does not match scope")
            }
            if source.fetchedAt.map({ marketQuoteInstantsChronologicallyOrdered([$0]) }) != true {
                errors.append("available market search source requires a valid fetchedAt")
            }
        } else if source.provider != "unavailable" || source.fetchedAt != nil {
            errors.append("unavailable market search must clear source identity")
        }
        if results.count > 20 { errors.append("market search returned too many results") }
        if status == .unavailable, results.isEmpty == false { errors.append("unavailable market search must not expose results") }
        if Set(results.map(\.symbol)).count != results.count { errors.append("market search result identities must be unique") }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { errors.append("market search message is required") }
        for result in results {
            let digits = result.code.unicodeScalars.allSatisfy { (48...57).contains($0.value) }
            if result.market != "HK" || result.code.count != 5 || digits == false || result.symbol != "HK.\(result.code)" {
                errors.append("market search result identity is invalid")
            }
            if let name = result.name, name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                errors.append("market search result name must be non-empty when present")
            }
        }
        if errors.isEmpty == false { throw MarketSearchValidationError.invalid(errors) }
    }
}

public enum MarketSearchValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct MarketQuoteEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let status: MarketStatus
    public let asOf: String?
    public let requestedSymbol: String
    public let source: MarketQuoteSource
    public let metadata: FactMetadata?
    public let data: MarketQuoteData?
    public let message: String

    public init(
        schemaVersion: String,
        status: MarketStatus,
        asOf: String?,
        requestedSymbol: String,
        source: MarketQuoteSource,
        data: MarketQuoteData?,
        message: String,
        metadata: FactMetadata? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.status = status
        self.asOf = asOf
        self.requestedSymbol = requestedSymbol
        self.source = source
        self.metadata = metadata
        self.data = data
        self.message = message
    }

    public var isUsableQuote: Bool {
        status != .unavailable && data != nil
    }

    public func validateForDisplay(market expectedMarket: String, code expectedCode: String) throws {
        var errors: [String] = []
        let canonical = "\(expectedMarket).\(expectedCode)"
        if schemaVersion != "2026-06-17.gate-a.v1" {
            errors.append("market quote schemaVersion is invalid")
        }
        if let asOf, asOf.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("market quote asOf must be non-empty when present")
        }
        if requestedSymbol != canonical {
            errors.append("market quote requestedSymbol must equal \(canonical)")
        }
        source.validateForDisplay(status: status, errors: &errors)
        if let metadata {
            metadata.validateForDisplay(label: "market quote", errors: &errors)
            if status == .live, metadata.freshness != "fresh" {
                errors.append("market quote metadata freshness must be fresh")
            }
            if status == .stale, metadata.freshness != "stale" {
                errors.append("market quote metadata freshness must be stale")
            }
            if status == .unavailable, metadata.freshness == "fresh" {
                errors.append("market quote metadata must not be fresh when unavailable")
            }
        } else {
            errors.append("market quote metadata is required")
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("market quote message is required")
        }
        if status == .unavailable {
            if data != nil {
                errors.append("market quote data must be nil when unavailable")
            }
            if asOf != nil || source.fetchedAt != nil || metadata?.asOf != nil || metadata?.fetchedAt != nil {
                errors.append("market quote unavailable status must clear envelope, source, and metadata timestamps")
            }
        } else if let data {
            data.validateForDisplay(expectedMarket: expectedMarket, expectedCode: expectedCode, errors: &errors)
            if let fetchedAt = source.fetchedAt {
                if !marketQuoteInstantsChronologicallyOrdered([data.quoteTime, fetchedAt]) {
                    errors.append("market quote must satisfy quoteTime <= source.fetchedAt")
                }
            } else {
                errors.append("market quote must satisfy quoteTime <= source.fetchedAt")
            }
            if asOf != data.quoteTime || metadata?.asOf != data.quoteTime || metadata?.fetchedAt != source.fetchedAt {
                errors.append("market quote envelope and metadata timestamps must bind quote data and source identity")
            }
        } else {
            errors.append("market quote data is required when live or stale")
        }
        if errors.isEmpty == false {
            throw MarketQuoteValidationError.invalid(errors)
        }
    }
}

public struct MarketQuoteSource: Codable, Equatable, Sendable {
    public let provider: MarketProvider
    public let providerStatus: MarketStatus
    public let fetchedAt: String?

    fileprivate func validateForDisplay(status: MarketStatus, errors: inout [String]) {
        if status == .unavailable {
            if providerStatus != .unavailable {
                errors.append("market quote unavailable status requires unavailable providerStatus")
            }
            if fetchedAt != nil {
                errors.append("market quote unavailable status requires nil fetchedAt")
            }
        } else {
            if provider == .unavailable {
                errors.append("market quote live or stale status requires available provider metadata")
            }
            if fetchedAt?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
                errors.append("market quote live or stale status requires fetchedAt")
            }
        }
    }
}

public struct MarketQuoteData: Codable, Equatable, Sendable {
    public let market: String
    public let code: String
    public let symbol: String
    public let name: String?
    public let currency: String
    public let price: Double
    public let previousClose: Double?
    public let change: Double?
    public let changePercent: Double?
    public let quoteTime: String

    fileprivate func validateForDisplay(expectedMarket: String, expectedCode: String, errors: inout [String]) {
        if market != expectedMarket {
            errors.append("market quote data market must equal \(expectedMarket)")
        }
        if code != expectedCode {
            errors.append("market quote data code must equal \(expectedCode)")
        }
        if symbol != "\(expectedMarket).\(expectedCode)" {
            errors.append("market quote data symbol must equal \(expectedMarket).\(expectedCode)")
        }
        if currency.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("market quote currency is required")
        }
        if price.isFinite == false || price <= 0 {
            errors.append("market quote price must be finite and positive")
        }
        if let previousClose, previousClose.isFinite == false || previousClose <= 0 {
            errors.append("market quote previousClose must be finite and positive when present")
        }
        if change?.isFinite == false {
            errors.append("market quote change must be finite when present")
        }
        if changePercent?.isFinite == false {
            errors.append("market quote changePercent must be finite when present")
        }
        if quoteTime.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("market quote quoteTime is required")
        }
    }
}

public enum MarketQuoteValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

private func marketQuoteInstantsChronologicallyOrdered(_ values: [String]) -> Bool {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let standard = ISO8601DateFormatter()
    standard.formatOptions = [.withInternetDateTime]
    var previous: Date?
    for value in values {
        guard let current = fractional.date(from: value) ?? standard.date(from: value) else { return false }
        if let previous, current < previous { return false }
        previous = current
    }
    return true
}
