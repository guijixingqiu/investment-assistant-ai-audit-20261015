import Foundation

public enum PortfolioDecisionFreshnessState: String, Codable, Equatable, Sendable {
    case current
    case stale
}

public enum PortfolioDecisionFreshnessMode: String, Codable, Equatable, Sendable {
    case tradingSession = "trading_session"
    case offSession = "off_session"
}

public enum PortfolioDecisionFreshnessReason: String, Codable, Equatable, Sendable {
    case withinPolicy = "within_policy"
    case tradingAgeExceeded = "trading_age_exceeded"
    case beforeLatestSessionClose = "before_latest_session_close"
    case sourceTimestampInFuture = "source_timestamp_in_future"
}

public struct PortfolioDecisionFreshness: Codable, Equatable, Sendable {
    public let state: PortfolioDecisionFreshnessState
    public let mode: PortfolioDecisionFreshnessMode
    public let reason: PortfolioDecisionFreshnessReason
    public let evaluatedAt: String
    public let ageSeconds: Double
    public let tradingMaxAgeSeconds: Int
    public let latestSessionClose: String

    func validate(sourceAsOf: String?, errors: inout [String]) {
        guard let evaluatedDate = portfolioDecisionStrictDate(evaluatedAt),
              let latestCloseDate = portfolioDecisionStrictDate(latestSessionClose) else {
            errors.append("freshness timestamps must be ISO UTC date-times")
            return
        }
        if !ageSeconds.isFinite || ageSeconds < 0 {
            errors.append("freshness.ageSeconds must be finite and non-negative")
        }
        if tradingMaxAgeSeconds <= 0 {
            errors.append("freshness.tradingMaxAgeSeconds must be positive")
        }
        guard let sourceAsOf,
              let sourceDate = portfolioDecisionStrictDate(sourceAsOf),
              tradingMaxAgeSeconds > 0 else { return }

        let expected = evaluatePortfolioDecisionFreshness(
            sourceAsOf: sourceDate,
            now: evaluatedDate,
            tradingMaxAgeSeconds: tradingMaxAgeSeconds
        )
        if state != expected.state || mode != expected.mode || reason != expected.reason
            || ageSeconds != expected.ageSeconds || latestCloseDate != expected.latestSessionClose {
            errors.append("freshness must recompute from sourceAsOf and evaluatedAt")
        }
    }
}

private func evaluatePortfolioDecisionFreshness(
    sourceAsOf: Date,
    now: Date,
    tradingMaxAgeSeconds: Int
) -> (state: PortfolioDecisionFreshnessState, mode: PortfolioDecisionFreshnessMode, reason: PortfolioDecisionFreshnessReason, ageSeconds: Double, latestSessionClose: Date) {
    let components = hongKongFreshnessComponents(now)
    let minute = components.hour * 60 + components.minute
    let weekday = (2...6).contains(components.weekday)
    let mode: PortfolioDecisionFreshnessMode = weekday
        && ((570..<720).contains(minute) || (780..<960).contains(minute)) ? .tradingSession : .offSession
    let latestClose = latestHongKongFreshnessClose(now)
    let rawAge = floor(now.timeIntervalSince(sourceAsOf))
    let age = max(0, rawAge)

    if rawAge < 0 {
        return (.stale, mode, .sourceTimestampInFuture, age, latestClose)
    }
    if weekday && (570..<960).contains(minute) && age > Double(tradingMaxAgeSeconds) {
        return (.stale, mode, .tradingAgeExceeded, age, latestClose)
    }
    if mode == .offSession && sourceAsOf < latestClose {
        return (.stale, mode, .beforeLatestSessionClose, age, latestClose)
    }
    return (.current, mode, .withinPolicy, age, latestClose)
}

private func latestHongKongFreshnessClose(_ now: Date) -> Date {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 8 * 60 * 60)!
    let parts = hongKongFreshnessComponents(now)
    var close = calendar.date(from: DateComponents(
        timeZone: calendar.timeZone,
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: 16
    ))!
    if !(2...6).contains(parts.weekday) || parts.hour * 60 + parts.minute < 960 {
        close = calendar.date(byAdding: .day, value: -1, to: close)!
    }
    while [1, 7].contains(calendar.component(.weekday, from: close)) {
        close = calendar.date(byAdding: .day, value: -1, to: close)!
    }
    return close
}

private func hongKongFreshnessComponents(_ date: Date) -> (year: Int, month: Int, day: Int, weekday: Int, hour: Int, minute: Int) {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 8 * 60 * 60)!
    let parts = calendar.dateComponents([.year, .month, .day, .weekday, .hour, .minute], from: date)
    return (parts.year!, parts.month!, parts.day!, parts.weekday!, parts.hour!, parts.minute!)
}
