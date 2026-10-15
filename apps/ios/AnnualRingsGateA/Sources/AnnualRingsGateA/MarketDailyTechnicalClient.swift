import Foundation

public protocol MarketDailyTechnicalFetching: Sendable {
    func fetch(market: String, code: String) async throws -> MarketDailyTechnicalEnvelope
}

public final class MarketDailyTechnicalClient: MarketDailyTechnicalFetching, @unchecked Sendable {
    private let baseURL: URL
    private let session: URLSession
    private let authToken: String?
    private let authHeaderName: String
    private let writeAuthToken: String?
    private let writeAuthHeaderName: String

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        authToken: String? = nil,
        authHeaderName: String = "x-internal-token",
        writeAuthToken: String? = nil,
        writeAuthHeaderName: String = "x-internal-token"
    ) {
        self.baseURL = baseURL
        self.session = session
        self.authToken = authToken
        self.authHeaderName = authHeaderName
        self.writeAuthToken = writeAuthToken
        self.writeAuthHeaderName = writeAuthHeaderName
    }

    public func fetch(market: String, code: String) async throws -> MarketDailyTechnicalEnvelope {
        try await fetch(market: market, code: code, cutoff: nil)
    }

    public func fetch(market: String, code: String, cutoff: String?) async throws -> MarketDailyTechnicalEnvelope {
        guard market == "HK", code.range(of: #"^\d{5}$"#, options: .regularExpression) != nil else {
            throw MarketDailyTechnicalClientError.invalidSymbol
        }
        let path = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "market")
            .appending(path: "daily-bars")
            .appending(path: market)
            .appending(path: code)
        var components = URLComponents(url: path, resolvingAgainstBaseURL: false)
        if let cutoff {
            guard cutoff.isCalendarDate else { throw MarketDailyTechnicalClientError.invalidCutoff }
            components?.queryItems = [URLQueryItem(name: "cutoff", value: cutoff)]
        }
        guard let url = components?.url else { throw MarketDailyTechnicalClientError.invalidResponse }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        if let authToken, !authToken.isEmpty {
            request.setValue(authToken, forHTTPHeaderField: authHeaderName)
        }
        return try await send(request, market: market, code: code)
    }

    public func refresh(market: String, code: String) async throws -> MarketDailyTechnicalEnvelope {
        try await refresh(market: market, code: code, cutoff: nil)
    }

    public func refresh(market: String, code: String, cutoff: String?) async throws -> MarketDailyTechnicalEnvelope {
        guard market == "HK", code.range(of: #"^\d{5}$"#, options: .regularExpression) != nil else {
            throw MarketDailyTechnicalClientError.invalidSymbol
        }
        let path = baseURL
            .appending(path: "api")
            .appending(path: "internal")
            .appending(path: "market")
            .appending(path: "daily-bars")
            .appending(path: "refresh")
            .appending(path: market)
            .appending(path: code)
        var components = URLComponents(url: path, resolvingAgainstBaseURL: false)
        if let cutoff {
            guard cutoff.isCalendarDate else { throw MarketDailyTechnicalClientError.invalidCutoff }
            components?.queryItems = [URLQueryItem(name: "cutoff", value: cutoff)]
        }
        guard let url = components?.url else { throw MarketDailyTechnicalClientError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        if let writeAuthToken, !writeAuthToken.isEmpty {
            request.setValue(writeAuthToken, forHTTPHeaderField: writeAuthHeaderName)
        }
        let refreshed = try await send(request, market: market, code: code)
        let fresh = try await fetch(market: market, code: code, cutoff: cutoff)
        guard refreshed.usableForRequestedCutoff,
              fresh.usableForRequestedCutoff,
              refreshed.dailyBars.snapshot?.snapshotSha == fresh.dailyBars.snapshot?.snapshotSha,
              refreshed.technical.resultHash == fresh.technical.resultHash else {
            throw MarketDailyTechnicalClientError.refreshReadBackMismatch
        }
        return fresh
    }

    private func send(
        _ request: URLRequest,
        market: String,
        code: String
    ) async throws -> MarketDailyTechnicalEnvelope {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw MarketDailyTechnicalClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw MarketDailyTechnicalClientError.httpStatus(http.statusCode)
        }
        let envelope = try JSONDecoder().decode(MarketDailyTechnicalEnvelope.self, from: data)
        try envelope.validateForDisplay(market: market, code: code)
        return envelope
    }
}

public enum MarketDailyTechnicalClientError: Error, Equatable, Sendable {
    case invalidSymbol
    case invalidCutoff
    case invalidResponse
    case httpStatus(Int)
    case refreshReadBackMismatch
}

extension MarketDailyTechnicalEnvelope {
    public func validateForDisplay(market: String, code: String) throws {
        var errors: [String] = []
        let complete = dailyBars.status == .available && technical.status == .available
        if completeness != (complete ? "complete" : "incomplete") {
            errors.append("daily technical completeness does not match component status")
        }
        if usableForRequestedCutoff != complete {
            errors.append("daily technical usability is not bound to the requested cutoff")
        }
        dailyBars.validateForDisplay(market: market, code: code, errors: &errors)
        technical.validateForDisplay(dailyBars: dailyBars, errors: &errors)
        if !errors.isEmpty {
            throw MarketDailyTechnicalValidationError.invalid(errors)
        }
    }
}
public func marketResearchAdmissionIssue(
    market: String, code: String, quote: MarketQuoteEnvelope,
    daily: MarketDailyTechnicalEnvelope?, environment: MarketEnvironmentEnvelope?, now: Date = Date()
) -> String? {
    guard let daily else {
        return "当前日线技术尚未完整读取；请先刷新价格与日线技术。"
    }
    do {
        try quote.validateForDisplay(market: market, code: code)
        try daily.validateForDisplay(market: market, code: code)
        try environment?.validateForDisplay(expectedSymbol: "\(market).\(code)", now: now)
    } catch {
        return "当前市场事实身份不完整或已漂移；请重新刷新后再进入研究。"
    }
    let symbol = "\(market).\(code)"
    let environmentFreshness = environment?.freshness(now: now)
    let live = quote.status == .live && quote.source.providerStatus == .live
    let livePreOpen = environment?.data?.marketState == "PRE_OPEN"
        && environmentFreshness == .closedLastObservation
        && live
    let recentClosedObservation = ["CLOSED", "PRE_OPEN"].contains(environment?.data?.marketState ?? "")
        && environmentFreshness == .closedLastObservation
        && quote.status == .stale
        && quote.source.provider == .futu
        && marketAdmissionFetchedAtIsRecent(quote.source.fetchedAt, now: now)
    guard (live && environmentFreshness == .fresh) || livePreOpen || recentClosedObservation,
          quote.data?.symbol == symbol else {
        return "当前价格既非实时，也不是本次收市后新鲜读取的最后观测；请先刷新价格与日线技术。"
    }
    guard daily.completeness == "complete",
          daily.usableForRequestedCutoff,
          daily.dailyBars.status == .available,
          daily.technical.status == .available,
          daily.isBound(to: symbol) else {
        return "当前日线技术尚未完整绑定；请先刷新价格与日线技术。"
    }
    guard environment?.status == .available,
          environment?.data != nil,
          environment?.requestedSymbol == symbol,
          environment?.bindsDailySession(daily.dailyBars.snapshot?.lastCompletedSession ?? "", now: now) == true else {
        return "当前港股市场环境尚未完整读取；请先刷新市场环境。"
    }
    return nil
}

private func marketAdmissionFetchedAtIsRecent(_ value: String?, now: Date) -> Bool {
    guard let value else { return false }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let standard = ISO8601DateFormatter()
    standard.formatOptions = [.withInternetDateTime]
    guard let fetchedAt = fractional.date(from: value) ?? standard.date(from: value) else { return false }
    let age = now.timeIntervalSince(fetchedAt)
    return age >= 0 && age <= 30 * 60
}

private extension MarketDailyBarsEnvelope {
    func validateForDisplay(market: String, code: String, errors: inout [String]) {
        if schemaVersion != "2026-07-29.f1a-daily.v3" {
            errors.append("daily bars schema version is invalid")
        }
        if market != "HK" || code.range(of: #"^\d{5}$"#, options: .regularExpression) == nil
            || request.market != market || request.code != code || request.symbol != "\(market).\(code)" {
            errors.append("daily bars canonical HK identity is invalid")
        }
        if request.timeframe != "1d" || !request.completedSessionsOnly
            || request.adjustment != "forward_qfq_research_only"
            || request.minimumBars != 80 || request.targetBars != 120 {
            errors.append("daily bars request parameters are invalid")
        }
        if !request.cutoff.isCalendarDate {
            errors.append("daily bars request cutoff is not a real calendar date")
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("daily bars message is required")
        }
        if source.hashMethod != "sha256_canonical_json_v1" || source.rawBytesCaptured {
            errors.append("daily bars source hash semantics are invalid")
        }
        guard let metadata else {
            errors.append("daily bars metadata is required")
            return
        }
        metadata.validateForDisplay(label: "daily bars", errors: &errors)
        if status == .unavailable {
            if snapshot != nil || source.dataCutoffAt != nil || source.fetchedAt != nil
                || source.providerCutoff != nil || source.sourceContentHash != nil
                || source.pageCount != 0 || !source.pageContentHashes.isEmpty {
                errors.append("unavailable daily bars must clear snapshot and cutoff time")
            }
            return
        }
        guard let snapshot else {
            errors.append("non-unavailable daily bars require a snapshot")
            return
        }
        if snapshot.calendar.id != "HKEX" || snapshot.calendar.timezone != "Asia/Hong_Kong" {
            errors.append("daily bars calendar identity is invalid")
        }
        if !snapshot.lastCompletedSession.isCalendarDate || !snapshot.firstSession.isCalendarDate
            || !snapshot.lastSession.isCalendarDate || snapshot.expectedSessions.contains(where: { !$0.isCalendarDate }) {
            errors.append("daily bars sessions must be real calendar dates")
        }
        if snapshot.barCount != snapshot.bars.count || snapshot.bars.isEmpty {
            errors.append("daily bars count is invalid")
        }
        var previous = ""
        for bar in snapshot.bars {
            if !bar.session.isCalendarDate || bar.session <= previous || !bar.validOHLC
                || !bar.volume.isFinite || !bar.turnover.isFinite || bar.volume < 0 || bar.turnover < 0 {
                errors.append("daily bars contain invalid order, OHLC, volume, or turnover")
                break
            }
            previous = bar.session
        }
        if snapshot.bars.first?.session != snapshot.firstSession
            || snapshot.bars.last?.session != snapshot.lastSession
            || snapshot.lastSession > request.cutoff
            || snapshot.lastSession > snapshot.lastCompletedSession {
            errors.append("daily bars range is not bound to the completed-session cutoff")
        }
        if snapshot.expectedSessions != snapshot.expectedSessions.sorted()
            || Set(snapshot.expectedSessions).count != snapshot.expectedSessions.count {
            errors.append("daily bars expected sessions must be strictly ordered and unique")
        }
        let barSessions = Set(snapshot.bars.map(\.session))
        let gapSessions = Set(snapshot.quality.gaps.map(\.session))
        let expectedSessions = Set(snapshot.expectedSessions)
        if !barSessions.isDisjoint(with: gapSessions)
            || barSessions.union(gapSessions) != expectedSessions
            || snapshot.quality.gaps.contains(where: {
                !$0.session.isCalendarDate
                    || !["exchange_holiday", "symbol_suspension", "unexplained"].contains($0.classification)
            }) {
            errors.append("daily bars gap/expected-session coverage is inconsistent")
        }
        let zeroVolume = snapshot.bars.filter { $0.volume == 0 }.map(\.session)
        let suspension = snapshot.bars.filter(\.suspension).map(\.session)
        if snapshot.quality.zeroVolumeSessions != zeroVolume
            || snapshot.quality.suspensionSessions != suspension {
            errors.append("daily bars zero-volume or suspension classifications are inconsistent")
        }
        if status == .available {
            validateAvailable(snapshot: snapshot, metadata: metadata, errors: &errors)
        }
    }

    func validateAvailable(
        snapshot: MarketDailySnapshot,
        metadata: FactMetadata,
        errors: inout [String]
    ) {
        if snapshot.barCount < 80 || !snapshot.quality.gaps.isEmpty {
            errors.append("available daily bars require 80 bars and no missing-session gaps")
        }
        if source.rights != "confirmed" || source.retention != "confirmed"
            || source.derivedUse != "confirmed" || source.dataCutoffAt == nil
            || source.fetchedAt == nil || source.providerCutoff == nil {
            errors.append("available daily bars source authority is incomplete")
        }
        let fixture = source.provider == "fixture"
        if !["futu_history_kline", "repository", "fixture"].contains(source.provider)
            || source.endpoint?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
            || source.pageContentHashes.count != source.pageCount
            || !source.validHashes || !snapshot.validHashes {
            errors.append("available daily bars hash evidence is invalid")
        }
        if metadata.freshness != "unknown" || metadata.asOf != source.dataCutoffAt
            || metadata.fetchedAt != source.fetchedAt
            || (fixture
                ? metadata.provenance != "fixture" || metadata.authority != "research_evidence" || !metadata.fixture
                : metadata.authority != "market_data" || metadata.fixture) {
            errors.append("stored daily bars must keep freshness UNKNOWN, bind asOf, and preserve fixture provenance")
        }
        if source.providerCutoff?.isCalendarDate != true
            || source.providerCutoff! > request.cutoff
            || snapshot.lastCompletedSession > source.providerCutoff!
            || source.dataCutoffAt?.hasPrefix("\(snapshot.lastCompletedSession)T") != true
            || source.dataCutoffAt?.hasSuffix("+08:00") != true
            || !chronological(source.dataCutoffAt, source.fetchedAt) {
            errors.append("available daily bars cutoff and fetchedAt chronology is invalid")
        }
    }
}

private extension MarketTechnicalEnvelope {
    func validateForDisplay(dailyBars: MarketDailyBarsEnvelope, errors: inout [String]) {
        if schemaVersion != "2026-07-29.f1a-technical.v3"
            || computationVersion != "f1a.indicators.3"
            || parameters != .canonical {
            errors.append("technical computation identity is invalid")
        }
        if status == .available {
            guard dailyBars.status == .available, let snapshot = dailyBars.snapshot, let points else {
                errors.append("available technical output requires available daily bars")
                return
            }
            if inputSnapshotSha != snapshot.snapshotSha || dataCutoffAt != dailyBars.source.dataCutoffAt
                || resultHash?.isSHA256 != true || points.count != snapshot.bars.count {
                errors.append("technical output is not bound to the daily snapshot")
            }
            if zip(points, snapshot.bars).contains(where: {
                $0.session != $1.session || $0.volume != $1.volume
                    || $0.candle.open != $1.open || $0.candle.high != $1.high
                    || $0.candle.low != $1.low || $0.candle.close != $1.close
            }) {
                errors.append("technical points do not bind daily candles and volume")
            }
            if points.contains(where: {
                !$0.candle.validOHLC || !$0.volume.isFinite || $0.volume < 0
            }) {
                errors.append("technical points contain invalid candle or volume facts")
            }
            if points.last?.hasCompleteCoreIndicators != true {
                errors.append("latest technical indicators are incomplete")
            }
        } else if points != nil || resultHash != nil {
            errors.append("incomplete technical output must not expose partial points or result hash")
        }
    }
}

private extension MarketDailySource {
    var validHashes: Bool {
        pageCount > 0 && pageContentHashes.allSatisfy(\.isSHA256) && sourceContentHash?.isSHA256 == true
    }
}

private extension MarketDailySnapshot {
    var validHashes: Bool { snapshotSha.isSHA256 && dataHash.isSHA256 }
}

private extension MarketDailyBar {
    var validOHLC: Bool {
        [open, high, low, close].allSatisfy { $0.isFinite && $0 > 0 }
            && low <= min(open, close) && high >= max(open, close) && low <= high
    }
}

private extension MarketTechnicalPoint {
    var hasCompleteCoreIndicators: Bool {
        [ma20, ma60, macd.ema12, macd.ema26, macd.line, macd.signal, macd.histogram, rsi14]
            .allSatisfy { $0?.isFinite == true }
            && bollinger20?.isFinite == true
    }
}

private extension MarketTechnicalCandle {
    var validOHLC: Bool {
        [open, high, low, close].allSatisfy { $0.isFinite && $0 > 0 }
            && low <= min(open, close) && high >= max(open, close) && low <= high
    }
}

private extension MarketBollingerPoint {
    var isFinite: Bool {
        [middle, standardDeviation, upper, lower].allSatisfy(\.isFinite)
    }
}

private extension String {
    var isSHA256: Bool {
        range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
    }

    var isCalendarDate: Bool {
        guard range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else {
            return false
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let parts = split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return false }
        let components = DateComponents(
            calendar: calendar,
            timeZone: calendar.timeZone,
            year: parts[0],
            month: parts[1],
            day: parts[2]
        )
        return components.date.map {
            calendar.component(.year, from: $0) == parts[0]
                && calendar.component(.month, from: $0) == parts[1]
                && calendar.component(.day, from: $0) == parts[2]
        } == true
    }
}

private func chronological(_ earlier: String?, _ later: String?) -> Bool {
    guard let earlier, let later,
          factMetadataIsRFC3339DateTime(earlier),
          factMetadataIsRFC3339DateTime(later) else {
        return false
    }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let first = fractional.date(from: earlier) ?? ISO8601DateFormatter().date(from: earlier),
          let second = fractional.date(from: later) ?? ISO8601DateFormatter().date(from: later) else {
        return false
    }
    return first <= second
}
