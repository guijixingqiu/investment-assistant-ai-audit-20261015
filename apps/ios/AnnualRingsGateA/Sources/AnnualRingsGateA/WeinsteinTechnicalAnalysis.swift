import Foundation

public struct WeinsteinZoneCorrectionDraft: Equatable, Sendable {
    public var action = "add"
    public var zoneKind = "support"
    public var lower = ""
    public var upper = ""
    public var reason = ""

    public init() {}
    public var fingerprint: String { [action, zoneKind, lower, upper, reason].joined(separator: "|") }

    public mutating func bind(_ zone: WeinsteinZone, kind: String) {
        action = "adjust"; zoneKind = kind
        lower = String(zone.lower); upper = String(zone.upper); reason = ""
    }

    public func request(
        membership: CandidateMembershipData,
        analysis: WeinsteinTechnicalAnalysisEnvelope,
        idempotencyKey: String,
        now: Date = Date()
    ) -> CreateResearchMaterialRequest? {
        let reason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard membership.state == .tracked, membership.symbol == analysis.symbol,
              analysis.status == "available", let resultHash = analysis.resultHash, resultHash.isSha256,
              ["add", "adjust", "reject"].contains(action),
              ["support", "resistance", "invalidation"].contains(zoneKind),
              let lower = Double(lower.trimmingCharacters(in: .whitespacesAndNewlines)),
              let upper = Double(upper.trimmingCharacters(in: .whitespacesAndNewlines)),
              lower.isFinite, upper.isFinite, lower > 0, upper >= lower,
              (1...4_000).contains(reason.count) else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let publishedAt = formatter.string(from: now)
        let actionLabel = ["add": "新增", "adjust": "调整", "reject": "否决"][action] ?? action
        let kindLabel = ["support": "支撑区", "resistance": "阻力区", "invalidation": "失效区"][zoneKind] ?? zoneKind
        return CreateResearchMaterialRequest(
            membershipId: membership.id, membershipVersion: membership.version,
            title: "Weinstein 人工修正 · \(actionLabel)\(kindLabel)",
            contentText: "computed result: \(resultHash)\naction: \(action)\nzone: \(zoneKind) \(lower)-\(upper)\nreason: \(reason)",
            sourceType: "owner_weinstein_zone_correction", sourceUrl: nil, publishedAt: publishedAt,
            claimType: "model_inference", verificationStatus: "unverified", rightsStatus: "user_provided",
            sourceVersion: "weinstein-zone-correction.v1:\(resultHash):\(action):\(zoneKind):\(publishedAt)",
            replacesMaterialId: nil, validUntil: formatter.string(from: now.addingTimeInterval(180 * 86_400)),
            summary: reason, variableName: "weinstein_price_zone", stance: action == "reject" ? "refute" : "neutral",
            reliability: nil, materiality: nil, isRead: true,
            ownerCorrectionBinding: nil, assistantCorrectionBinding: nil, idempotencyKey: idempotencyKey
        )
    }
}

struct WeinsteinZoneCorrectionRequestStore {
    private struct Record: Codable {
        let semantic: String
        let request: CreateResearchMaterialRequest
    }

    private static let key = "annual-rings.weinstein-zone-correction.pending-request.v1"
    let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    func load(semantic: String) -> CreateResearchMaterialRequest? {
        guard let data = defaults.data(forKey: Self.key),
              let record = try? JSONDecoder().decode(Record.self, from: data),
              record.semantic == semantic else { return nil }
        return record.request
    }

    @discardableResult
    func save(semantic: String, request: CreateResearchMaterialRequest) -> Bool {
        guard let data = try? JSONEncoder().encode(Record(semantic: semantic, request: request)) else { return false }
        defaults.set(data, forKey: Self.key)
        return true
    }

    func clear() { defaults.removeObject(forKey: Self.key) }
}

public struct WeinsteinTechnicalAnalysisEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let computationVersion: String
    public let status: String
    public let symbol: String
    public let market: String
    public let analysisAsOf: String
    public let completedWeekEnd: String?
    public let sectorIdentityAsOf: String?
    public let sourceFetchedAt: String?
    public let provider: String?
    public let dataset: String?
    public let hashMethod: String?
    public let datasetHash: String?
    public let dataQuality: String
    public let inputHash: String?
    public let resultHash: String?
    public let sources: [WeinsteinSourceBinding]
    public let marketStage: String
    public let marketStageConfidence: String
    public let marketMa30wDirection: String
    public let sectorStage: String
    public let sectorStageConfidence: String
    public let sectorMa30wDirection: String
    public let sectorStrength: String
    public let stockStage: String
    public let stockStageConfidence: String
    public let stockStagePhase: String
    public let ma30w: Double?
    public let ma30wDirection: String
    public let priceVsMa30wPercent: Double?
    public let supportZones: [WeinsteinZone]
    public let resistanceZones: [WeinsteinZone]
    public let overheadSupplyRisk: String
    public let breakoutStatus: String
    public let breakoutWeek: String?
    public let breakoutLevel: Double?
    public let volumeConfirmation: String
    public let volumeRatio: Double?
    public let volumeRatio4Week: Double?
    public let volumePercentile: Double?
    public let relativeStrengthStatus: String
    public let tripleConfirmation: String
    public let entryState: String
    public let entryQuality: String
    public let extensionRisk: String
    public let extensionFromBreakoutPercent: Double?
    public let extensionFromSupportPercent: Double?
    public let invalidationZone: WeinsteinZone?
    public let holdingState: String
    public let exitWarning: String
    public let shortState: String
    public let overallConfidence: String
    public let totalScore: Int?
    public let scoreFactors: [WeinsteinScoreFactor]
    public let weeklyChart: [WeinsteinWeeklyChartPoint]
    public let summary: String
    public let supportingEvidence: [String]
    public let counterevidence: [String]
    public let unknowns: [String]
    public let nextObservations: [String]
    public let safety: WeinsteinAnalysisSafety

    public func validated(symbol expectedSymbol: String, analysisAsOf expectedAsOf: String) throws -> Self {
        var errors: [String] = []
        if schemaVersion != "2026-08-13.weinstein-technical.v6"
            || computationVersion != "weinstein.weekly-stage.6" { errors.append("schema or computation version is invalid") }
        if market != "HK" || symbol != expectedSymbol || analysisAsOf != expectedAsOf || !analysisAsOf.isCalendarDate {
            errors.append("analysis identity drifted")
        }
        if !safety.isAdvisoryOnly { errors.append("safety boundary is invalid") }
        if !Self.stages.contains(marketStage) || !Self.confidences.contains(marketStageConfidence)
            || !Self.directions.contains(marketMa30wDirection)
            || !Self.stages.contains(sectorStage) || !Self.confidences.contains(sectorStageConfidence)
            || !Self.directions.contains(sectorMa30wDirection)
            || !Self.stages.contains(stockStage) || !Self.confidences.contains(stockStageConfidence)
            || !Self.stagePhases.contains(stockStagePhase) || !Self.directions.contains(ma30wDirection)
            || !Self.entryStates.contains(entryState) || !Self.sectorStrengths.contains(sectorStrength)
            || !Self.risks.contains(overheadSupplyRisk) || !Self.breakouts.contains(breakoutStatus)
            || !Self.volumes.contains(volumeConfirmation) || !Self.relativeStrengths.contains(relativeStrengthStatus)
            || !Self.confirmations.contains(tripleConfirmation) || !Self.entryQualities.contains(entryQuality)
            || !Self.risks.contains(extensionRisk) || !Self.holdingStates.contains(holdingState)
            || !Self.exitWarnings.contains(exitWarning) || shortState != "DISABLED"
            || !Self.confidences.contains(overallConfidence) { errors.append("categorical output is invalid") }
        if status == "available" {
            if dataQuality != "COMPLETE" || sources.count != 3 || !inputHash.isSha256 || !resultHash.isSha256
                || provider != "futu_opend" || dataset != "futu.weinstein.completed-weekly-ohlcv.v1"
                || hashMethod != "sha256-canonical-json-v1" || !datasetHash.isSha256
                || sourceFetchedAt.map(factMetadataIsRFC3339DateTime) != true
                || !weinsteinSourceChronologyIsValid(sourceFetchedAt, analysisAsOf: expectedAsOf)
                || completedWeekEnd != expectedAsOf.previousCompletedFriday || sectorIdentityAsOf != expectedAsOf {
                errors.append("available result lacks exact source identity")
            }
            if totalScore.map({ !(0...100).contains($0) }) != false || scoreFactors.count != 7
                || scoreFactors.map(\.id) != ["market", "sector", "stock_stage", "price_structure", "volume", "relative_strength", "risk"]
                || scoreFactors.contains(where: { !$0.isValid }) || scoreFactors.reduce(0, { $0 + $1.score }) != totalScore
                || weeklyChart.count < 42 || weeklyChart.last?.session != completedWeekEnd
                || weeklyChart.contains(where: { !$0.isValid(asOf: completedWeekEnd ?? expectedAsOf) }) {
                errors.append("available score or weekly chart is invalid")
            }
            if Set(sources.map(\.role)) != Set(["stock", "market", "sector"])
                || sources.first(where: { $0.role == "stock" })?.symbol != expectedSymbol
                || sources.first(where: { $0.role == "market" })?.symbol != "HK.800000"
                || sources.first(where: { $0.role == "sector" })?.symbol.isHongKongIndustrySymbol != true
                || sources.contains(where: { !$0.isValid(asOf: expectedAsOf, completedWeekEnd: completedWeekEnd) }) { errors.append("weekly source binding is invalid") }
            if ma30w.map({ !$0.isFinite || $0 <= 0 }) != false || priceVsMa30wPercent?.isFinite != true
                || volumeRatio.map({ !$0.isFinite || $0 < 0 }) != false
                || volumeRatio4Week.map({ !$0.isFinite || $0 < 0 }) != false
                || volumePercentile.map({ !$0.isFinite || $0 < 0 || $0 > 100 }) != false
                || breakoutLevel.map({ !$0.isFinite || $0 <= 0 }) != false
                || extensionFromSupportPercent.map({ !$0.isFinite || $0 < 0 }) != false
                || supportZones.isEmpty || resistanceZones.isEmpty || invalidationZone == nil
                || !supportingEvidence.hasNonblankItems || !counterevidence.hasNonblankItems || !nextObservations.hasNonblankItems {
                errors.append("available result lacks required structural evidence")
            }
            if [marketStage, sectorStage, stockStage].contains("UNKNOWN") { errors.append("available result cannot expose an unknown structural stage") }
            let entryEligible = stockStage == "STAGE_2" && ["BREAKOUT_CONFIRMED", "RETEST_WATCH"].contains(entryState)
            if entryEligible ? !["HIGH", "MEDIUM", "LOW"].contains(entryQuality) : entryQuality != "NOT_APPLICABLE" {
                errors.append("entry quality is not eligible for the current structural state")
            }
            let completed = completedWeekEnd ?? ""
            let breakoutIdentityIsValid = breakoutStatus == "CONFIRMED"
                ? breakoutWeek == completed && extensionFromBreakoutPercent.map({ $0.isFinite && $0 >= 0 }) == true
                : ["HISTORICAL", "FAILED"].contains(breakoutStatus)
                    ? breakoutWeek?.isCalendarDate == true && (breakoutWeek ?? completed) < completed
                        && (breakoutStatus == "FAILED" || extensionFromBreakoutPercent.map({ $0.isFinite && $0 >= 0 }) == true)
                    : breakoutWeek == nil
            if !breakoutIdentityIsValid { errors.append("breakout event identity is invalid") }
            if entryQuality == "HIGH" && (marketStage != "STAGE_2" || sectorStage != "STAGE_2"
                || ["WEAKENING", "LAGGING"].contains(sectorStrength)) {
                errors.append("entry quality ignored market or sector headwind")
            }
        } else if status == "data_insufficient" {
            if dataQuality != "DATA_INSUFFICIENT" || !unknowns.hasNonblankItems
                || summary != Self.dataInsufficientSummary
                || counterevidence != [Self.dataInsufficientCounterevidence]
                || nextObservations != [Self.dataInsufficientNextObservation] || sourceFetchedAt != nil
                || completedWeekEnd != nil || sectorIdentityAsOf != nil || provider != nil || dataset != nil || hashMethod != nil
                || datasetHash != nil || inputHash != nil || resultHash != nil || totalScore != nil || !scoreFactors.isEmpty || !weeklyChart.isEmpty || !sources.isEmpty
                || marketStage != "UNKNOWN" || marketStageConfidence != "UNKNOWN" || marketMa30wDirection != "UNKNOWN"
                || sectorStage != "UNKNOWN" || sectorStageConfidence != "UNKNOWN" || sectorMa30wDirection != "UNKNOWN"
                || sectorStrength != "UNKNOWN" || stockStage != "UNKNOWN" || stockStageConfidence != "UNKNOWN"
                || stockStagePhase != "UNKNOWN" || ma30wDirection != "UNKNOWN"
                || ma30w != nil || priceVsMa30wPercent != nil || !supportZones.isEmpty || !resistanceZones.isEmpty
                || overheadSupplyRisk != "UNKNOWN" || breakoutStatus != "UNKNOWN" || breakoutWeek != nil || breakoutLevel != nil
                || volumeConfirmation != "UNKNOWN" || volumeRatio != nil || volumeRatio4Week != nil || volumePercentile != nil
                || relativeStrengthStatus != "UNKNOWN" || tripleConfirmation != "UNKNOWN"
                || entryState != "NO_ACTION" || entryQuality != "UNKNOWN" || extensionRisk != "UNKNOWN"
                || extensionFromBreakoutPercent != nil || extensionFromSupportPercent != nil
                || invalidationZone != nil || holdingState != "UNKNOWN" || exitWarning != "UNKNOWN"
                || shortState != "DISABLED" || overallConfidence != "UNKNOWN" || !supportingEvidence.isEmpty {
                errors.append("missing evidence did not clear derived facts")
            }
        } else { errors.append("status is invalid") }
        if summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { errors.append("summary is required") }
        if supportZones.contains(where: { !$0.isValid(asOf: completedWeekEnd ?? expectedAsOf) })
            || resistanceZones.contains(where: { !$0.isValid(asOf: completedWeekEnd ?? expectedAsOf) })
            || invalidationZone.map({ !$0.isValid(asOf: completedWeekEnd ?? expectedAsOf) }) == true { errors.append("price zone is invalid") }
        if !errors.isEmpty { throw WeinsteinTechnicalAnalysisError.invalid(errors) }
        return self
    }

    private static let stages: Set<String> = ["STAGE_1", "STAGE_2", "STAGE_3", "STAGE_4", "TRANSITION", "UNKNOWN"]
    private static let stagePhases: Set<String> = ["EARLY", "MID", "LATE", "NOT_APPLICABLE", "UNKNOWN"]
    private static let directions: Set<String> = ["RISING", "FLAT", "FALLING", "UNKNOWN"]
    private static let entryStates: Set<String> = ["NO_ACTION", "WATCH", "BASE_FORMING", "BREAKOUT_WATCH", "BREAKOUT_CONFIRMED", "RETEST_WATCH", "HOLD_STAGE_2", "STAGE_3_WARNING", "REDUCE", "EXIT"]
    private static let sectorStrengths: Set<String> = ["LEADING", "IMPROVING", "NEUTRAL", "WEAKENING", "LAGGING", "UNKNOWN"]
    private static let risks: Set<String> = ["LOW", "MEDIUM", "HIGH", "UNKNOWN"]
    private static let breakouts: Set<String> = ["NONE", "WATCH", "CONFIRMED", "HISTORICAL", "FAILED", "UNKNOWN"]
    private static let volumes: Set<String> = ["WEAK", "NORMAL", "STRONG", "VERY_STRONG", "UNKNOWN"]
    private static let relativeStrengths: Set<String> = ["STRENGTHENING", "NEUTRAL", "WEAKENING", "UNKNOWN"]
    private static let confirmations: Set<String> = ["0/3", "1/3", "2/3", "3/3", "UNKNOWN"]
    private static let entryQualities: Set<String> = ["HIGH", "MEDIUM", "LOW", "NOT_APPLICABLE", "UNKNOWN"]
    private static let holdingStates: Set<String> = ["NO_POSITION_CONTEXT", "HOLD_STAGE_2", "TIGHTEN_RISK", "REDUCE", "EXIT", "UNKNOWN"]
    private static let exitWarnings: Set<String> = ["NONE", "EARLY_WARNING", "STAGE_3_WARNING", "STAGE_4_CONFIRMATION", "UNKNOWN"]
    private static let confidences: Set<String> = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"]
    static let dataInsufficientSummary = "Weinstein 周线证据不足；未生成阶段或切入结论。"
    private static let dataInsufficientCounterevidence = "关键证据缺失属于结构性否决，不能用短期指标抵消。"
    private static let dataInsufficientNextObservation = "待个股、恒生指数和精确所属行业的同一分析日周线历史都可用后再刷新。"
}

public struct HistoricalWeeklyPriceBar: Codable, Equatable, Sendable {
    public let session: String
    public let open: Double
    public let high: Double
    public let low: Double
    public let close: Double
    public let volume: Double
}

/// Read-only price chart. It carries no historical industry identity or stage conclusion.
public struct HistoricalWeeklyPrice: Codable, Equatable, Sendable {
    public let symbol: String
    public let analysisAsOf: String
    public let completedWeekEnd: String
    public let fetchedAt: String
    public let provider: String
    public let adjustment: String
    public let sectorIdentityStatus: String
    public let rights: String
    public let retention: String
    public let derivedUse: String
    public let bars: [HistoricalWeeklyPriceBar]

    public func validated(symbol expectedSymbol: String, analysisAsOf expectedAsOf: String) throws -> Self {
        guard symbol == expectedSymbol, analysisAsOf == expectedAsOf,
              analysisAsOf.isCalendarDate, completedWeekEnd == analysisAsOf.previousCompletedFriday,
              factMetadataIsRFC3339DateTime(fetchedAt), provider == "futu_opend",
              adjustment == "forward_qfq_research_only",
              sectorIdentityStatus == "unavailable_historical",
              rights == "confirmed", retention == "confirmed", derivedUse == "confirmed",
              !bars.isEmpty, bars.count <= 300 else {
            throw WeinsteinTechnicalAnalysisError.invalid(["historical weekly price identity or authority is invalid"])
        }
        var previous = ""
        for bar in bars {
            guard bar.session.isCalendarDate, bar.session > previous, bar.session <= completedWeekEnd,
                  [bar.open, bar.high, bar.low, bar.close, bar.volume].allSatisfy(\.isFinite),
                  [bar.open, bar.high, bar.low, bar.close].allSatisfy({ $0 > 0 }),
                  bar.volume >= 0,
                  bar.session == bar.session.previousCompletedFriday,
                  bar.low <= min(bar.open, bar.close), bar.high >= max(bar.open, bar.close) else {
                throw WeinsteinTechnicalAnalysisError.invalid(["historical weekly price has future or malformed bars"])
            }
            previous = bar.session
        }
        return self
    }
}

public struct WeinsteinScoreFactor: Codable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let score: Int
    public let maxScore: Int
    public let assessment: String
    fileprivate var isValid: Bool {
        ["market", "sector", "stock_stage", "price_structure", "volume", "relative_strength", "risk"].contains(id)
            && !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !assessment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && maxScore > 0 && score >= 0 && score <= maxScore
    }
}

public struct WeinsteinWeeklyChartPoint: Codable, Equatable, Sendable {
    public let session: String
    public let open: Double
    public let high: Double
    public let low: Double
    public let close: Double
    public let volume: Double
    public let ma30w: Double?
    public let marketRelativeStrength: Double?
    public let sectorRelativeStrength: Double?
    fileprivate func isValid(asOf: String) -> Bool {
        session.isCalendarDate && session <= asOf && [open, high, low, close, volume].allSatisfy(\.isFinite)
            && open > 0 && high > 0 && low > 0 && close > 0 && volume > 0
            && low <= min(open, close) && high >= max(open, close)
            && ma30w.map({ $0.isFinite && $0 > 0 }) != false
            && marketRelativeStrength.map({ $0.isFinite && $0 > 0 }) != false
            && sectorRelativeStrength.map({ $0.isFinite && $0 > 0 }) != false
    }
}

func weinsteinSourceChronologyIsValid(_ fetchedAt: String?, analysisAsOf: String, now: Date = Date()) -> Bool {
    guard let fetchedAt, analysisAsOf.isCalendarDate else { return false }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return areDateTimeInstantsChronologicallyOrdered([
        "\(analysisAsOf)T00:00:00+08:00", fetchedAt, formatter.string(from: now)
    ])
}

func weinsteinResultContentHash(rawJSON: Data) throws -> String {
    try portfolioDecisionContentId(
        rawJSON: rawJSON,
        prefix: "",
        excludingTopLevelKeys: ["resultHash", "sourceFetchedAt"]
    )
}

public struct WeinsteinSourceBinding: Codable, Equatable, Sendable {
    public let role: String; public let symbol: String; public let name: String; public let adjustment: String
    public let barCount: Int; public let firstWeek: String; public let lastWeek: String; public let inputHash: String
    fileprivate func isValid(asOf: String, completedWeekEnd: String?) -> Bool {
        ["stock", "market", "sector"].contains(role) && !symbol.isEmpty && !name.isEmpty && barCount >= 42
            && adjustment == (role == "stock" ? "forward_qfq_research_only" : "none_index_or_sector")
            && (role != "sector" || symbol.isHongKongIndustrySymbol)
            && firstWeek.isCalendarDate && lastWeek.isCalendarDate && firstWeek <= lastWeek
            && lastWeek == completedWeekEnd && lastWeek <= asOf && inputHash.isSha256
    }
}

public struct WeinsteinZone: Codable, Equatable, Sendable {
    public let lower: Double; public let upper: Double; public let basis: String; public let touchCount: Int
    public let firstWeek: String; public let lastWeek: String; public let failedBreakoutCount: Int
    fileprivate func isValid(asOf: String) -> Bool {
        lower.isFinite && upper.isFinite && lower > 0 && lower <= upper && !basis.isEmpty && touchCount >= 2
            && firstWeek.isCalendarDate && lastWeek.isCalendarDate && firstWeek <= lastWeek && lastWeek <= asOf && failedBreakoutCount >= 0
    }
}

public struct WeinsteinAnalysisSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool; public let createsOrder: Bool; public let createsTrade: Bool
    public let mutatesCash: Bool; public let mutatesFee: Bool; public let mutatesPosition: Bool
    public let callsBroker: Bool; public let productionWrite: Bool
    fileprivate var isAdvisoryOnly: Bool {
        advisoryOnly && !createsOrder && !createsTrade && !mutatesCash && !mutatesFee
            && !mutatesPosition && !callsBroker && !productionWrite
    }
}

public final class WeinsteinTechnicalAnalysisClient: @unchecked Sendable {
    private let baseURL: URL; private let session: URLSession; private let authToken: String?; private let authHeaderName: String
    public init(baseURL: URL, session: URLSession = .shared, authToken: String? = nil, authHeaderName: String = "x-internal-token") {
        self.baseURL = baseURL; self.session = session; self.authToken = authToken; self.authHeaderName = authHeaderName
    }
    public func fetch(market: String, code: String, analysisAsOf: String) async throws -> WeinsteinTechnicalAnalysisEnvelope {
        guard market == "HK", code.range(of: #"^\d{5}$"#, options: .regularExpression) != nil, analysisAsOf.isCalendarDate else {
            throw WeinsteinTechnicalAnalysisError.invalidRequest
        }
        var components = URLComponents(url: baseURL.appending(path: "api/mobile/market/weinstein/\(market)/\(code)"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "analysisAsOf", value: analysisAsOf)]
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("no-cache", forHTTPHeaderField: "cache-control")
        if let authToken, !authToken.isEmpty { request.setValue(authToken, forHTTPHeaderField: authHeaderName) }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw WeinsteinTechnicalAnalysisError.httpStatus((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        let envelope = try JSONDecoder().decode(WeinsteinTechnicalAnalysisEnvelope.self, from: data)
            .validated(symbol: "\(market).\(code)", analysisAsOf: analysisAsOf)
        if let resultHash = envelope.resultHash {
            let expected = try weinsteinResultContentHash(rawJSON: data)
            if resultHash != expected {
                throw WeinsteinTechnicalAnalysisError.invalid(["resultHash does not match canonical content"])
            }
        }
        return envelope
    }

    public func fetchHistoricalPrice(market: String, code: String, analysisAsOf: String) async throws -> HistoricalWeeklyPrice {
        guard market == "HK", code.range(of: #"^\d{5}$"#, options: .regularExpression) != nil,
              analysisAsOf.isCalendarDate else { throw WeinsteinTechnicalAnalysisError.invalidRequest }
        var parts = URLComponents(url: baseURL.appending(path: "api/mobile/market/weinstein-price/\(market)/\(code)"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "analysisAsOf", value: analysisAsOf)]
        var request = URLRequest(url: parts.url!, cachePolicy: .reloadIgnoringLocalCacheData)
        if let authToken, !authToken.isEmpty { request.setValue(authToken, forHTTPHeaderField: authHeaderName) }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw WeinsteinTechnicalAnalysisError.httpStatus((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return try JSONDecoder().decode(HistoricalWeeklyPrice.self, from: data)
            .validated(symbol: "\(market).\(code)", analysisAsOf: analysisAsOf)
    }
}

private extension Optional where Wrapped == String {
    var isSha256: Bool { self?.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil }
}
private extension String {
    var isHongKongIndustrySymbol: Bool { range(of: #"^HK\.LIST\d+$"#, options: .regularExpression) != nil }
    var isSha256: Bool { range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil }
    var isCalendarDate: Bool {
        guard range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return false }
        let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
        return formatter.date(from: self) != nil
    }
    var previousCompletedFriday: String? {
        let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
        guard let value = formatter.date(from: self) else { return nil }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let daysSinceFriday = (calendar.component(.weekday, from: value) - 6 + 7) % 7
        return calendar.date(byAdding: .day, value: -(daysSinceFriday == 0 ? 7 : daysSinceFriday), to: value).map(formatter.string)
    }
}
private extension Array where Element == String {
    var hasNonblankItems: Bool { !isEmpty && allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }
}
