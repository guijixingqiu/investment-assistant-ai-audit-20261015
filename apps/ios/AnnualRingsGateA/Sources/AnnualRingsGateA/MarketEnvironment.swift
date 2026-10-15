import Foundation

public enum MarketEnvironmentStatus: String, Codable, Equatable, Sendable {
    case available
    case unavailable
}

public enum MarketEnvironmentFreshness: String, Equatable, Sendable {
    case fresh
    case closedLastObservation = "closed_last_observation"
    case stale
}

public struct MarketEnvironmentEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let status: MarketEnvironmentStatus
    public let requestedSymbol: String
    public let asOf: String?
    public let source: MarketEnvironmentSource
    public let data: MarketEnvironmentData?
    public let message: String

    public static func unavailable(_ message: String, requestedSymbol: String) -> Self {
        Self(
            schemaVersion: "2026-08-04.hk-market-environment.v1",
            status: .unavailable,
            requestedSymbol: requestedSymbol,
            asOf: nil,
            source: MarketEnvironmentSource(
                provider: "unavailable",
                endpoint: nil,
                fetchedAt: nil,
                quoteDataOnly: true
            ),
            data: nil,
            message: message
        )
    }

    public func validateForDisplay(expectedSymbol: String, now: Date = Date()) throws {
        var errors: [String] = []
        if schemaVersion != "2026-08-04.hk-market-environment.v1" { errors.append("market environment schema is invalid") }
        if requestedSymbol != expectedSymbol { errors.append("market environment symbol identity changed") }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { errors.append("market environment message is required") }
        if source.quoteDataOnly == false { errors.append("market environment must stay quote-data-only") }
        if status == .unavailable {
            if asOf != nil || data != nil || source.provider != "unavailable" || source.endpoint != nil || source.fetchedAt != nil {
                errors.append("unavailable market environment must clear facts and timestamps")
            }
        } else if let data, let asOf, let fetchedAt = source.fetchedAt {
            if source.provider != "futu_opend" || source.endpoint != "market-environment" {
                errors.append("available market environment source is invalid")
            }
            if !marketEnvironmentChronology([asOf, fetchedAt])
                || marketEnvironmentDate(fetchedAt).map({ $0 <= now }) != true {
                errors.append("market environment chronology is invalid")
            }
            data.validate(expectedSymbol: expectedSymbol, envelopeAsOf: asOf, sourceFetchedAt: fetchedAt, errors: &errors)
            if freshness(now: now) == .stale { errors.append("market environment source is stale") }
        } else {
            errors.append("available market environment requires facts and timestamps")
        }
        if errors.isEmpty == false { throw MarketEnvironmentValidationError.invalid(errors) }
    }

    public func freshness(now: Date = Date()) -> MarketEnvironmentFreshness {
        guard status == .available, let data, let asOf, let fetchedAt = source.fetchedAt,
              marketEnvironmentDate(asOf) != nil, let fetchedDate = marketEnvironmentDate(fetchedAt) else { return .stale }
        let fetchedAge = now.timeIntervalSince(fetchedDate)
        guard fetchedAge >= 0, fetchedAge <= 30 * 60 else { return .stale }
        if ["CLOSED", "PRE_OPEN"].contains(data.marketState) { return .closedLastObservation }
        return marketEnvironmentSameHongKongDay(asOf, ISO8601DateFormatter().string(from: now)) ? .fresh : .stale
    }

    public func bindsDailySession(_ lastCompletedSession: String, now: Date = Date()) -> Bool {
        switch freshness(now: now) {
        case .fresh:
            return true
        case .closedLastObservation:
            guard lastCompletedSession.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
                  let data, let envelopeDay = asOf.flatMap(marketEnvironmentHongKongDay) else { return false }
            if data.marketState == "PRE_OPEN" {
                return (data.sectors.leaders + data.sectors.laggards).allSatisfy {
                    marketEnvironmentHongKongDay($0.asOf) == lastCompletedSession
                } && data.indices.allSatisfy {
                    guard let day = marketEnvironmentHongKongDay($0.asOf) else { return false }
                    return day == lastCompletedSession || day == envelopeDay
                }
            }
            return envelopeDay == lastCompletedSession
        case .stale:
            return false
        }
    }
}

public struct MarketEnvironmentSource: Codable, Equatable, Sendable {
    public let provider: String
    public let endpoint: String?
    public let fetchedAt: String?
    public let quoteDataOnly: Bool
}

public struct MarketEnvironmentData: Codable, Equatable, Sendable {
    public let market: String
    public let selectedSymbol: String
    public let marketState: String
    public let indices: [MarketEnvironmentIndexFact]
    public let sectors: MarketEnvironmentSectors
    public let breadth: MarketEnvironmentBreadth
    public let selectedStockCapitalFlow: MarketEnvironmentCapitalFlow?
    public let risk: MarketEnvironmentRisk
    public let unknowns: [String]

    fileprivate func validate(
        expectedSymbol: String,
        envelopeAsOf: String,
        sourceFetchedAt: String,
        errors: inout [String]
    ) {
        if market != "HK" || selectedSymbol != expectedSymbol || marketState.isEmpty { errors.append("market environment identity is invalid") }
        let expectedIndices = ["HK.800000", "HK.800100", "HK.800700"]
        if indices.map(\.symbol) != expectedIndices { errors.append("market environment indices are incomplete") }
        let allowEarlierObservation = marketState == "PRE_OPEN"
        indices.forEach { $0.validate(envelopeAsOf: envelopeAsOf, allowEarlierObservation: allowEarlierObservation, errors: &errors) }
        sectors.validate(envelopeAsOf: envelopeAsOf, allowEarlierObservation: allowEarlierObservation, errors: &errors)
        breadth.validate(errors: &errors)
        selectedStockCapitalFlow?.validate(
            expectedSymbol: expectedSymbol,
            envelopeAsOf: envelopeAsOf,
            sourceFetchedAt: sourceFetchedAt,
            errors: &errors
        )
        risk.validate(errors: &errors)
        if unknowns.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            errors.append("market environment unknowns are invalid")
        }
    }
}

public struct MarketEnvironmentIndexFact: Codable, Equatable, Sendable, Identifiable {
    public var id: String { symbol }
    public let symbol: String
    public let name: String
    public let last: Double
    public let previousClose: Double
    public let changePercent: Double
    public let turnover: Double
    public let amplitudePercent: Double
    public let advancers: Int
    public let decliners: Int
    public let unchanged: Int
    public let asOf: String

    fileprivate func validate(envelopeAsOf: String, allowEarlierObservation: Bool, errors: inout [String]) {
        if name.isEmpty || !last.isFinite || last <= 0 || !previousClose.isFinite || previousClose <= 0
            || !changePercent.isFinite || !turnover.isFinite || turnover < 0 || !amplitudePercent.isFinite || amplitudePercent < 0
            || advancers < 0 || decliners < 0 || unchanged < 0 || !marketEnvironmentChronology([asOf, envelopeAsOf])
            || (!allowEarlierObservation && !marketEnvironmentSameHongKongDay(asOf, envelopeAsOf))
            || !marketEnvironmentApproximately(changePercent, (last / previousClose - 1) * 100) {
            errors.append("market environment index fact is invalid")
        }
    }
}

public struct MarketEnvironmentSectors: Codable, Equatable, Sendable {
    public let universeCount: Int
    public let leaders: [MarketEnvironmentSectorFact]
    public let laggards: [MarketEnvironmentSectorFact]

    fileprivate func validate(envelopeAsOf: String, allowEarlierObservation: Bool, errors: inout [String]) {
        if universeCount < 10 || leaders.count != 5 || laggards.count != 5 { errors.append("market sector coverage is invalid") }
        let all = leaders + laggards
        if Set(all.map(\.code)).count != all.count { errors.append("market sector leaders and laggards overlap") }
        all.forEach { $0.validate(envelopeAsOf: envelopeAsOf, allowEarlierObservation: allowEarlierObservation, errors: &errors) }
        if !ordered(leaders.map(\.changePercent), descending: true)
            || !ordered(laggards.map(\.changePercent), descending: false) {
            errors.append("market sector ordering is invalid")
        }
    }
}

public struct MarketEnvironmentSectorFact: Codable, Equatable, Sendable, Identifiable {
    public var id: String { code }
    public let code: String
    public let name: String
    public let last: Double
    public let previousClose: Double
    public let changePercent: Double
    public let turnover: Double
    public let advancers: Int
    public let decliners: Int
    public let unchanged: Int
    public let asOf: String

    fileprivate func validate(envelopeAsOf: String, allowEarlierObservation: Bool, errors: inout [String]) {
        if code.range(of: #"^HK\.LIST\d+$"#, options: .regularExpression) == nil || name.isEmpty || !last.isFinite || last <= 0
            || !previousClose.isFinite || previousClose <= 0 || !changePercent.isFinite
            || !turnover.isFinite || turnover < 0 || advancers < 0 || decliners < 0 || unchanged < 0
            || !marketEnvironmentChronology([asOf, envelopeAsOf])
            || (!allowEarlierObservation && !marketEnvironmentSameHongKongDay(asOf, envelopeAsOf))
            || !marketEnvironmentApproximately(changePercent, (last / previousClose - 1) * 100) {
            errors.append("market sector fact is invalid")
        }
    }
}

public struct MarketEnvironmentBreadth: Codable, Equatable, Sendable {
    public let advancers: Int
    public let decliners: Int
    public let unchanged: Int
    public let advanceRatio: Double

    fileprivate func validate(errors: inout [String]) {
        let total = advancers + decliners + unchanged
        if advancers < 0 || decliners < 0 || unchanged < 0 || total <= 0 || !advanceRatio.isFinite
            || abs(advanceRatio - Double(advancers) / Double(total)) > 0.000_001 {
            errors.append("market breadth is invalid")
        }
    }
}

public struct MarketEnvironmentCapitalFlow: Codable, Equatable, Sendable {
    public let symbol: String
    public let asOf: String
    public let lastValidAt: String
    public let currency: String
    public let netFlow: Double
    public let superFlow: Double
    public let bigFlow: Double
    public let mediumFlow: Double
    public let smallFlow: Double

    fileprivate func validate(
        expectedSymbol: String,
        envelopeAsOf: String,
        sourceFetchedAt: String,
        errors: inout [String]
    ) {
        if symbol != expectedSymbol || currency != "HKD" || !marketEnvironmentChronology([asOf, envelopeAsOf])
            || !marketEnvironmentChronology([asOf, lastValidAt])
            || !marketEnvironmentSameHongKongDay(asOf, envelopeAsOf)
            || !marketEnvironmentSameHongKongDay(asOf, lastValidAt)
            || !marketEnvironmentNear(lastValidAt, sourceFetchedAt, maxSeconds: 300)
            || ![netFlow, superFlow, bigFlow, mediumFlow, smallFlow].allSatisfy(\.isFinite) {
            errors.append("selected-stock capital flow is invalid")
        }
    }
}

public struct MarketEnvironmentRisk: Codable, Equatable, Sendable {
    public let breadthSignal: String
    public let sectorDispersionPercent: Double
    public let hsiAmplitudePercent: Double

    fileprivate func validate(errors: inout [String]) {
        if !["broad_strength", "mixed", "broad_weakness"].contains(breadthSignal)
            || !sectorDispersionPercent.isFinite || sectorDispersionPercent < 0
            || !hsiAmplitudePercent.isFinite || hsiAmplitudePercent < 0 {
            errors.append("market risk facts are invalid")
        }
    }
}

public enum MarketEnvironmentValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

private func ordered(_ values: [Double], descending: Bool) -> Bool {
    values.indices.dropFirst().allSatisfy { index in
        descending ? values[index] <= values[index - 1] : values[index] >= values[index - 1]
    }
}

private func marketEnvironmentApproximately(_ left: Double, _ right: Double) -> Bool {
    abs(left - right) <= 0.000_001
}

private func marketEnvironmentChronology(_ values: [String]) -> Bool {
    var previous: Date?
    for value in values {
        guard let current = marketEnvironmentDate(value) else { return false }
        if let previous, current < previous { return false }
        previous = current
    }
    return true
}

private func marketEnvironmentDate(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let standard = ISO8601DateFormatter()
    standard.formatOptions = [.withInternetDateTime]
    return fractional.date(from: value) ?? standard.date(from: value)
}

private func marketEnvironmentSameHongKongDay(_ left: String, _ right: String) -> Bool {
    guard let left = marketEnvironmentDate(left), let right = marketEnvironmentDate(right) else { return false }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Hong_Kong")!
    return calendar.isDate(left, inSameDayAs: right)
}

private func marketEnvironmentHongKongDay(_ value: String) -> String? {
    guard let date = marketEnvironmentDate(value) else { return nil }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Hong_Kong")!
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    guard let year = parts.year, let month = parts.month, let day = parts.day else { return nil }
    return String(format: "%04d-%02d-%02d", year, month, day)
}

private func marketEnvironmentNear(_ left: String, _ right: String, maxSeconds: TimeInterval) -> Bool {
    guard let left = marketEnvironmentDate(left), let right = marketEnvironmentDate(right) else { return false }
    return abs(left.timeIntervalSince(right)) <= maxSeconds
}
