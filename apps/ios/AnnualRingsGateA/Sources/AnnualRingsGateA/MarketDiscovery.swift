import Foundation

public enum MarketDiscoveryStatus: String, Codable, Equatable, Sendable {
    case available
    case partial
    case unavailable
}

public enum DiscoveryLaneStatus: String, Codable, Equatable, Sendable {
    case available
    case unavailable
}

public struct MarketDiscoveryCandidate: Codable, Equatable, Identifiable, Sendable {
    public var id: String { symbol }
    public let market: String
    public let code: String
    public let symbol: String
    public let name: String
    public let industry: String?
    public let price: Double
    public let marketCap: Double
    public let average20DayTurnover: Double
    public let volumeRatio: Double
    public let fiveDayChangePercent: Double
    public let asOf: String
    public let why: String
}
public struct CandidateDiscoveryRule: Codable, Equatable, Sendable {
    public let id: String
    public let summary: String
    public let notRecommendation: Bool
}
public struct CandidateDiscoveryUniverse: Codable, Equatable, Sendable {
    public let source: String
    public let snapshotId: String
    public let effectiveDate: String
    public let capturedAt: String
    public let memberCount: Int
    public let sourceUrls: [String]
}
public struct MarketDiscoveryEligibility: Codable, Equatable, Sendable { public let requestedSymbol: String; public let status: String; public let universe: CandidateDiscoveryUniverse?; public let message: String }
public extension CandidateDiscoveryUniverse {
    var isValidOfficialHongKongConnectBinding: Bool {
        source == "hkex_sse_szse_southbound_official"
            && snapshotId.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
            && marketDiscoveryDate(effectiveDate) != nil
            && isParseableDateTime(capturedAt)
            && memberCount >= 2
            && sourceUrls == [
                "https://www.sse.com.cn/services/hkexsc/disclo/eligible/",
                "https://www.szse.cn/szhk/hkbussiness/underlylist/"
            ]
    }
}
public struct CandidateDiscoveryCoverage: Codable, Equatable, Sendable {
    public let scope: String
    public let complete: Bool
    public let scanned: Int
    public let eligibleMatched: Int
    public var unavailableSymbols: [String]? = nil
}
public struct CandidateDiscoveryLane: Codable, Equatable, Sendable {
    public let status: DiscoveryLaneStatus
    public let source: String
    public let fetchedAt: String?
    public let rule: CandidateDiscoveryRule
    public let totalMatched: Int?
    public var coverage: CandidateDiscoveryCoverage? = nil
    public let universe: CandidateDiscoveryUniverse?
    public let candidates: [MarketDiscoveryCandidate]
    public let message: String
}

public enum OfficialAnnouncementCategory: String, Codable, Equatable, Sendable {
    case financialReport = "financial_report"
    case corporateAction = "corporate_action"
    case businessChange = "business_change"
    case administrative
    case other
}

public struct OfficialAnnouncementDiscoveryItem: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let symbol: String
    public let title: String
    public let publishedDate: String
    public let documentUrl: String
    public let category: OfficialAnnouncementCategory
    public let why: String

    public var url: URL? { URL(string: documentUrl) }
}

public struct OfficialAnnouncementDiscoveryLane: Codable, Equatable, Sendable {
    public let status: DiscoveryLaneStatus
    public let source: String
    public let sourceUrl: String
    public let fetchedAt: String?
    public let items: [OfficialAnnouncementDiscoveryItem]
    public let message: String
}

public struct NoticeLeadDiscoveryItem: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let kind: String
    public let symbol: String
    public let title: String
    public let source: String
    public let publishedAt: String
    public let relatedSecurities: [String]
    public let url: String
    public let evidenceStatus: String

    public var externalURL: URL? { URL(string: url) }
}

public struct NoticeLeadDiscoveryLane: Codable, Equatable, Sendable {
    public let status: DiscoveryLaneStatus
    public let source: String
    public let requestedSymbol: String
    public let fetchedAt: String?
    public let items: [NoticeLeadDiscoveryItem]
    public let message: String
}

public struct NoticeLeadResearchHandoff: Equatable, Sendable {
    public let item: NoticeLeadDiscoveryItem
    public let fetchedAt: String

    public init?(item: NoticeLeadDiscoveryItem, fetchedAt: String?) {
        guard item.symbol.range(of: "^HK\\.\\d{5}$", options: .regularExpression) != nil,
              (item.relatedSecurities.isEmpty || item.relatedSecurities.contains(item.symbol)),
              item.evidenceStatus == "unverified_source_lead",
              let fetchedAt,
              isParseableDateTime(fetchedAt),
              let url = item.externalURL,
              url.scheme?.lowercased() == "https",
              url.host?.isEmpty == false else { return nil }
        self.item = item
        self.fetchedAt = fetchedAt
    }
}

public struct MarketDiscoveryEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let status: MarketDiscoveryStatus
    public let generatedAt: String
    public let eligibility: MarketDiscoveryEligibility
    public let candidates: CandidateDiscoveryLane
    public let notices: NoticeLeadDiscoveryLane
    public let announcements: OfficialAnnouncementDiscoveryLane
    public let message: String

    public func validateForDisplay(expectedNoticeSymbol: String = "HK.00175", now: Date = Date()) throws {
        var errors: [String] = []
        if schemaVersion != "2026-08-20.hk-connect-daily-discovery.v7" { errors.append("discovery schemaVersion is invalid") }
        if let generated = marketDiscoveryDateTime(generatedAt) {
            let age = now.timeIntervalSince(generated)
            if age < 0 || age > 300 { errors.append("discovery generatedAt is stale or in the future") }
        } else { errors.append("discovery generatedAt is invalid") }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { errors.append("discovery message is required") }
        if eligibility.requestedSymbol != expectedNoticeSymbol || !["eligible", "not_eligible", "unknown"].contains(eligibility.status)
            || eligibility.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || eligibility.status == "unknown" && eligibility.universe != nil
            || eligibility.status != "unknown" && eligibility.universe?.isValidOfficialHongKongConnectBinding != true { errors.append("discovery eligibility is invalid") }
        validateCandidateLane(errors: &errors)
        if candidates.status == .available, eligibility.universe != candidates.universe {
            errors.append("discovery eligibility and candidates must bind the same universe")
        }
        validateNoticeLane(expectedSymbol: expectedNoticeSymbol, errors: &errors)
        validateAnnouncementLane(expectedSymbol: expectedNoticeSymbol, errors: &errors)
        let availableCount = [candidates.status, notices.status, announcements.status].filter { $0 == .available }.count
        let expected: MarketDiscoveryStatus = availableCount == 3 ? .available : availableCount > 0 ? .partial : .unavailable
        if status != expected { errors.append("discovery status does not summarize its lanes") }
        if errors.isEmpty == false { throw MarketDiscoveryValidationError.invalid(errors) }
    }

    private func validateNoticeLane(expectedSymbol: String, errors: inout [String]) {
        if expectedSymbol.range(of: "^HK\\.\\d{5}$", options: .regularExpression) == nil
            || notices.requestedSymbol != expectedSymbol || notices.items.count > 10
            || notices.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("OpenD information discovery identity is invalid")
        }
        if Set(notices.items.map(\.id)).count != notices.items.count {
            errors.append("OpenD information lead identities are duplicated")
        }
        if notices.status == .unavailable {
            if notices.source != "unavailable" || notices.fetchedAt != nil || !notices.items.isEmpty {
                errors.append("unavailable OpenD information discovery exposed facts")
            }
            return
        }
        guard notices.source == "futu_opend_search_news_information",
              let fetchedAt = notices.fetchedAt,
              isParseableDateTime(fetchedAt),
              areDateTimeInstantsChronologicallyOrdered([fetchedAt, generatedAt]) else {
            errors.append("available OpenD information discovery source is invalid")
            return
        }
        for item in notices.items {
            let relatedIsValid = (item.relatedSecurities.isEmpty || item.relatedSecurities.contains(expectedSymbol))
                && Set(item.relatedSecurities).count == item.relatedSecurities.count
                && item.relatedSecurities.allSatisfy {
                    $0.range(of: "^[A-Z]{2,4}\\.[A-Z0-9]{1,20}$", options: .regularExpression) != nil
                }
            guard item.id.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  item.symbol == expectedSymbol,
                  ["notice", "major_news"].contains(item.kind),
                  !item.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  item.title.count <= 500,
                  !item.source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  item.source.count <= 200,
                  isParseableDateTime(item.publishedAt),
                  areDateTimeInstantsChronologicallyOrdered([item.publishedAt, fetchedAt, generatedAt]),
                  relatedIsValid,
                  item.evidenceStatus == "unverified_source_lead",
                  let url = item.externalURL,
                  url.scheme?.lowercased() == "https",
                  url.host?.isEmpty == false,
                  url.user == nil,
                  url.password == nil else {
                errors.append("OpenD information lead is invalid or no longer bound to the requested symbol")
                continue
            }
        }
    }

    private func validateCandidateLane(errors: inout [String]) {
        if candidates.rule.id != "market_attention_v1" || candidates.rule.notRecommendation == false
            || candidates.rule.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("candidate discovery rule is invalid")
        }
        if candidates.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("candidate discovery message is required")
        }
        if candidates.candidates.count > 5000 { errors.append("too many discovered candidates") }
        if Set(candidates.candidates.map(\.symbol)).count != candidates.candidates.count {
            errors.append("discovered candidate identities are duplicated")
        }
        if candidates.status == .unavailable {
            if candidates.source != "unavailable" || candidates.fetchedAt != nil || candidates.totalMatched != nil
                || candidates.universe != nil || candidates.candidates.isEmpty == false { errors.append("unavailable candidate discovery exposed facts") }
        } else if candidates.source != "futu_opend_stock_screen_v2" || candidates.fetchedAt.map(isParseableDateTime) != true
            || candidates.totalMatched == nil || (candidates.totalMatched ?? -1) < 0 || candidateUniverseIsValid(candidates.universe) == false {
            errors.append("available candidate discovery source is invalid")
        }
        if let coverage = candidates.coverage {
            if !coverage.complete || !["market", "selected_symbol"].contains(coverage.scope)
                || coverage.scanned < candidates.candidates.count || coverage.eligibleMatched != candidates.candidates.count
                || (coverage.scope == "market" && coverage.scanned != candidates.totalMatched) {
                errors.append("candidate coverage is inconsistent")
            }
        }
        for candidate in candidates.candidates {
            let digits = candidate.code.unicodeScalars.allSatisfy { (48...57).contains($0.value) }
            if candidate.market != "HK" || candidate.code.count != 5 || digits == false || candidate.symbol != "HK.\(candidate.code)"
                || candidate.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !isParseableDateTime(candidate.asOf)
                || candidate.why.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || candidate.industry?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true
                || candidate.price <= 0 || candidate.marketCap <= 0 || candidate.average20DayTurnover < 0 || candidate.volumeRatio < 0
                || [candidate.price, candidate.marketCap, candidate.average20DayTurnover, candidate.volumeRatio, candidate.fiveDayChangePercent].contains(where: { $0.isFinite == false }) {
                errors.append("discovered candidate facts are invalid")
            }
        }
    }

    private func candidateUniverseIsValid(_ universe: CandidateDiscoveryUniverse?) -> Bool {
        universe?.isValidOfficialHongKongConnectBinding == true
    }

    private func validateAnnouncementLane(expectedSymbol: String, errors: inout [String]) {
        guard let sourceURL = URL(string: announcements.sourceUrl) else {
            errors.append("announcement discovery source is invalid")
            return
        }
        if sourceURL.scheme != "https" || sourceURL.host != "www1.hkexnews.hk"
            || sourceURL.path != "/search/titlesearch.xhtml" || announcements.items.count > 10 {
            errors.append("announcement discovery source is invalid")
        }
        if Set(announcements.items.map(\.id)).count != announcements.items.count {
            errors.append("announcement discovery identities are duplicated")
        }
        if announcements.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("announcement discovery message is required")
        }
        if announcements.status == .unavailable {
            if announcements.source != "unavailable" || announcements.fetchedAt != nil || announcements.items.isEmpty == false {
                errors.append("unavailable announcement discovery exposed facts")
            }
        } else if announcements.source != "hkexnews_official" || announcements.fetchedAt.map(isParseableDateTime) != true
            || sourceURL.query?.contains("stockId=") != true {
            errors.append("available announcement discovery source is invalid")
        }
        for item in announcements.items {
            guard item.id.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  item.symbol == expectedSymbol,
                  item.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
                  marketDiscoveryDate(item.publishedDate) != nil,
                  item.why.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
                  let url = item.url,
                  url.scheme == "https",
                  url.host == "www1.hkexnews.hk",
                  url.path.hasPrefix("/listedco/listconews/sehk/"),
                  url.path.lowercased().hasSuffix(".pdf") else {
                errors.append("official announcement identity is invalid")
                continue
            }
        }
    }
}

public enum MarketDiscoveryQualificationStatus: String, Codable, Equatable, Sendable {
    case available
    case conflict
    case unavailable
}

public struct MarketDiscoveryQualificationFact: Codable, Equatable, Identifiable, Sendable {
    public var id: String { key }
    public let key: String
    public let label: String
    public let value: String
    public let meaning: String
}

public struct MarketDiscoveryQualificationBinding: Codable, Equatable, Sendable {
    public let source: String
    public let ruleId: String
    public let discoveryFetchedAt: String
    public let candidateAsOf: String
    public let candidateFingerprint: String
}

public struct MarketDiscoveryQualificationReproducibility: Codable, Equatable, Sendable {
    public let generationMethod: String
    public let provider: String
    public let model: String
    public let prompt: String
    public let tokenUsage: String
    public let cost: String
}

public struct MarketDiscoveryQualificationEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let status: MarketDiscoveryQualificationStatus
    public let generatedAt: String
    public let symbol: String
    public let binding: MarketDiscoveryQualificationBinding?
    public let facts: [MarketDiscoveryQualificationFact]
    public let unknowns: [String]
    public let nextChecks: [String]
    public let reproducibility: MarketDiscoveryQualificationReproducibility
    public let message: String

    public func validateForDisplay(expectedSymbol: String) throws {
        var errors: [String] = []
        if schemaVersion != "2026-08-06.market-discovery-qualification.v1" { errors.append("qualification schemaVersion is invalid") }
        if !isParseableDateTime(generatedAt) || symbol != expectedSymbol || message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("qualification identity is invalid")
        }
        if facts.count > 4 || unknowns.count > 3 || nextChecks.count > 3
            || Set(facts.map(\.key)).count != facts.count || Set(unknowns).count != unknowns.count || Set(nextChecks).count != nextChecks.count {
            errors.append("qualification collections are invalid")
        }
        let allowedFactKeys = Set(["screen_match", "price", "market_cap", "turnover", "volume_ratio", "five_day_change", "industry"])
        if facts.contains(where: { allowedFactKeys.contains($0.key) == false }) { errors.append("qualification fact key is invalid") }
        if facts.contains(where: { $0.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || $0.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || $0.meaning.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
            || unknowns.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
            || nextChecks.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            errors.append("qualification content is invalid")
        }
        if status == .available {
            if let binding {
                if binding.source != "futu_opend_stock_screen_v2" || binding.ruleId != "market_attention_v1"
                    || !isParseableDateTime(binding.discoveryFetchedAt)
                    || !areDateTimeInstantsChronologicallyOrdered([binding.candidateAsOf, binding.discoveryFetchedAt, generatedAt])
                    || binding.candidateFingerprint.range(of: "^[a-f0-9]{64}$", options: .regularExpression) == nil {
                    errors.append("available qualification binding is invalid")
                }
            } else {
                errors.append("qualification binding is missing")
            }
            let deterministic = reproducibility.generationMethod == "deterministic_frozen_fact_framework"
                && [reproducibility.provider, reproducibility.model, reproducibility.prompt, reproducibility.tokenUsage, reproducibility.cost].allSatisfy { $0 == "NOT_USED" }
            let deepseek = reproducibility.generationMethod == "deepseek_selected_grounded_discovery_facts"
                && reproducibility.provider == "deepseek" && ["deepseek-v4-flash", "deepseek-flash"].contains(reproducibility.model)
                && reproducibility.prompt == "market-discovery-qualification.v1"
                && reproducibility.tokenUsage.range(of: "^prompt=[0-9]+,completion=[0-9]+,total=[0-9]+$", options: .regularExpression) != nil
                && reproducibility.cost == "UNKNOWN"
            if facts.count < 2 || unknowns.count < 2 || nextChecks.count < 2 || (!deterministic && !deepseek) {
                errors.append("available qualification binding is invalid")
            }
        } else if binding != nil || facts.isEmpty == false || unknowns.isEmpty == false || nextChecks.isEmpty == false
            || reproducibility.generationMethod != "NOT_USED" || reproducibility.provider != "NOT_USED"
            || reproducibility.model != "NOT_USED" || reproducibility.prompt != "NOT_USED"
            || reproducibility.tokenUsage != "NOT_USED" || reproducibility.cost != "NOT_USED" {
            errors.append("unavailable qualification exposed partial facts")
        }
        if errors.isEmpty == false { throw MarketDiscoveryValidationError.invalid(errors) }
    }
}

public enum MarketDiscoveryValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public extension MarketQuoteClient {
    func fetchDailyDiscovery(noticeSymbol: String = "HK.00175") async throws -> MarketDiscoveryEnvelope {
        guard noticeSymbol.range(of: "^HK\\.\\d{5}$", options: .regularExpression) != nil else {
            throw MarketQuoteClientError.invalidResponse
        }
        let endpoint = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "market")
            .appending(path: "discovery")
        guard var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false) else {
            throw MarketQuoteClientError.invalidResponse
        }
        components.queryItems = [URLQueryItem(name: "symbol", value: noticeSymbol)]
        guard let url = components.url else { throw MarketQuoteClientError.invalidResponse }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw MarketQuoteClientError.invalidResponse }
        let envelope = try JSONDecoder().decode(MarketDiscoveryEnvelope.self, from: data)
        try envelope.validateForDisplay(expectedNoticeSymbol: noticeSymbol)
        if !(200..<300).contains(http.statusCode), envelope.status != .unavailable {
            throw MarketQuoteClientError.httpStatus(http.statusCode)
        }
        return envelope
    }

    func qualifyDiscoveryCandidate(_ candidate: MarketDiscoveryCandidate, discoveryFetchedAt: String) async throws -> MarketDiscoveryQualificationEnvelope {
        let url = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "market")
            .appending(path: "discovery")
            .appending(path: "qualifications")
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(QualifyMarketDiscoveryCandidateRequest(candidate: candidate, discoveryFetchedAt: discoveryFetchedAt))
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw MarketQuoteClientError.invalidResponse }
        let envelope = try JSONDecoder().decode(MarketDiscoveryQualificationEnvelope.self, from: data)
        try envelope.validateForDisplay(expectedSymbol: candidate.symbol)
        if (200..<300).contains(http.statusCode) != (envelope.status == .available) {
            throw MarketQuoteClientError.invalidResponse
        }
        return envelope
    }
}

private struct QualifyMarketDiscoveryCandidateRequest: Encodable {
    let candidate: MarketDiscoveryCandidate
    let discoveryFetchedAt: String
}

private func marketDiscoveryDate(_ value: String) -> Date? {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.isLenient = false
    guard let date = formatter.date(from: value), formatter.string(from: date) == value else { return nil }
    return date
}

private func marketDiscoveryDateTime(_ value: String) -> Date? {
    (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value))
        ?? (try? Date.ISO8601FormatStyle().parse(value))
}
