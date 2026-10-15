import Foundation

public struct GclPvPriceInputObservation: Codable, Equatable, Sendable {
    public let eventId: String
    public let stage: String
    public let period: String
    public let productSpecification: String
    public let unit: String
    public let currency: String
    public let value: Double
    public let conversionFactorToCnyPerWatt: Double
    public let normalizationBasisKey: String
    public let normalizationRule: String
    public let definitionKey: String

    fileprivate var logicalIdentity: String { "\(stage)|\(period)" }
    fileprivate var expectedVariable: String { "\(stage)_price" }

    fileprivate func validates(periods: Set<String>) -> Bool {
        researchDocumentIsPositiveIntegerString(eventId)
            && ["polysilicon", "wafer", "cell", "module"].contains(stage)
            && periods.contains(period) && period.isGclDay
            && !productSpecification.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && productSpecification.count <= 300
            && ["CNY_per_kg", "CNY_per_piece", "CNY_per_watt"].contains(unit)
            && currency == "CNY" && value.isFinite && value > 0
            && conversionFactorToCnyPerWatt.isFinite && conversionFactorToCnyPerWatt > 0
            && (unit != "CNY_per_watt" || conversionFactorToCnyPerWatt == 1)
            && normalizationBasisKey.isGclIdentifier
            && !normalizationRule.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && normalizationRule.count <= 500
            && !definitionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && definitionKey.count <= 200
    }
}

public struct GclPvContextInputObservation: Codable, Equatable, Sendable {
    public let eventId: String
    public let metric: String
    public let period: String
    public let productSpecification: String
    public let unit: String
    public let currency: String?
    public let value: Double
    public let definitionKey: String

    fileprivate var logicalIdentity: String { "\(metric)|\(period)" }

    fileprivate func validates(periods: Set<String>) -> Bool {
        let dimension = gclContextDimension(metric)
        return researchDocumentIsPositiveIntegerString(eventId)
            && periods.contains(period) && period.isGclDay && dimension != nil
            && !productSpecification.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && productSpecification.count <= 300 && unit == dimension?.unit && currency == dimension?.currency
            && value.isFinite && value >= 0 && (metric != "utilization" || value <= 100)
            && !definitionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && definitionKey.count <= 200
    }
}

public struct CreateGclPvPriceMonitorRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let period: String
    public let referencePeriod: String
    public let priceObservations: [GclPvPriceInputObservation]
    public let contextObservations: [GclPvContextInputObservation]
    public let idempotencyKey: String

    func validates() -> Bool {
        let periods: Set<String> = [period, referencePeriod]
        return membershipVersion > 0 && period.isGclDay && referencePeriod.isGclDay
            && referencePeriod < period && period <= GclPvPriceMonitorDraft.currentDay
            && (1...100).contains(priceObservations.count) && contextObservations.count <= 50
            && priceObservations.allSatisfy { $0.validates(periods: periods) }
            && contextObservations.allSatisfy { $0.validates(periods: periods) }
            && Set(priceObservations.map(\.logicalIdentity)).count == priceObservations.count
            && Set(contextObservations.map(\.logicalIdentity)).count == contextObservations.count
            && !idempotencyKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && idempotencyKey.count <= 200
    }
}

public struct GclPvSourceEvent: Codable, Equatable, Sendable {
    public let eventId: String
    public let eventVersion: Int
    public let eventFingerprint: String
    public let symbol: String
    public let eventKind: String
    public let coverageScope: String
    public let holdingBinding: ResearchEventHoldingBinding
    public let materialId: String
    public let materialFingerprint: String
    public let sourceType: String
    public let sourceUrl: String?
    public let publishedAt: String
    public let capturedAt: String
    public let validUntil: String
    public let rightsStatus: String
    public let verificationStatus: String
    public let sourceVersion: String
    public let revision: Int
    public let keyVariable: String
    public let hypothesisImpact: String

    fileprivate func validates(eventId expectedEventId: String, variable: String) -> Bool {
        guard let published = gclDate(publishedAt), let captured = gclDate(capturedAt), let valid = gclDate(validUntil),
              let sourceUrl, let url = URL(string: sourceUrl) else { return false }
        return eventId == expectedEventId && researchDocumentIsPositiveIntegerString(eventId)
            && eventVersion > 0 && eventFingerprint.isFrozenSHA256
            && symbol == "HK.03800" && ResearchEventCaptureDraft.supportedEventKinds.contains(eventKind)
            && coverageScope == "current_holding" && holdingBinding.isExactCurrentHoldingIdentity
            && researchDocumentIsPositiveIntegerString(materialId) && materialFingerprint.isFrozenSHA256
            && sourceType == ResearchEventCaptureDraft.holdingLogicSourceType
            && url.scheme?.lowercased() == "https" && url.host?.isEmpty == false && url.user == nil && url.password == nil
            && published <= captured && captured < valid && valid > Date()
            && ["user_provided", "authorized_public"].contains(rightsStatus) && verificationStatus == "verified"
            && !sourceVersion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && sourceVersion.count <= 200
            && revision > 0 && keyVariable == variable
            && ["supports", "weakens", "unknown"].contains(hypothesisImpact)
    }
}

public struct GclPvPriceObservation: Codable, Equatable, Sendable {
    public let eventId: String
    public let stage: String
    public let period: String
    public let productSpecification: String
    public let unit: String
    public let currency: String
    public let value: Double
    public let conversionFactorToCnyPerWatt: Double
    public let normalizationBasisKey: String
    public let normalizationRule: String
    public let definitionKey: String
    public let normalizedCnyPerWatt: Double
    public let sourceEvent: GclPvSourceEvent

    fileprivate var input: GclPvPriceInputObservation {
        .init(eventId: eventId, stage: stage, period: period, productSpecification: productSpecification,
              unit: unit, currency: currency, value: value, conversionFactorToCnyPerWatt: conversionFactorToCnyPerWatt,
              normalizationBasisKey: normalizationBasisKey, normalizationRule: normalizationRule, definitionKey: definitionKey)
    }
}

public struct GclPvContextObservation: Codable, Equatable, Sendable {
    public let eventId: String
    public let metric: String
    public let period: String
    public let productSpecification: String
    public let unit: String
    public let currency: String?
    public let value: Double
    public let definitionKey: String
    public let sourceEvent: GclPvSourceEvent

    fileprivate var input: GclPvContextInputObservation {
        .init(eventId: eventId, metric: metric, period: period, productSpecification: productSpecification,
              unit: unit, currency: currency, value: value, definitionKey: definitionKey)
    }
}

public struct GclPvComparison: Codable, Equatable, Sendable {
    public let id: String
    public let status: String
    public let currentPeriod: String
    public let referencePeriod: String
    public let currentValue: Double?
    public let referenceValue: Double?
    public let percentChange: Double?
    public let changePercentagePoints: Double?
    public let unit: String?
    public let reason: String

    fileprivate var validates: Bool {
        !id.isEmpty && ["comparable", "missing", "incomparable", "zero_baseline"].contains(status)
            && !reason.isEmpty && [currentValue, referenceValue, percentChange, changePercentagePoints].compactMap { $0 }.allSatisfy(\.isFinite)
    }
}

public struct GclPvSpread: Codable, Equatable, Sendable {
    public let id: String
    public let upstreamStage: String
    public let downstreamStage: String
    public let status: String
    public let currentCnyPerWatt: Double?
    public let referenceCnyPerWatt: Double?
    public let changeCnyPerWatt: Double?
    public let reason: String

    fileprivate var validates: Bool {
        !id.isEmpty && ["polysilicon", "wafer", "cell", "module"].contains(upstreamStage)
            && ["polysilicon", "wafer", "cell", "module"].contains(downstreamStage)
            && ["comparable", "missing", "incomparable"].contains(status) && !reason.isEmpty
            && [currentCnyPerWatt, referenceCnyPerWatt, changeCnyPerWatt].compactMap { $0 }.allSatisfy(\.isFinite)
    }
}

public struct GclPvImpact: Codable, Equatable, Sendable {
    public let signal: String
    public let basis: [String]
    public let unknowns: [String]

    fileprivate var validates: Bool {
        ["supports", "weakens", "mixed", "unknown"].contains(signal)
            && basis.allSatisfy { !$0.isEmpty } && unknowns.allSatisfy { !$0.isEmpty }
    }
}
public struct GclPvImpacts: Codable, Equatable, Sendable {
    public let cost: GclPvImpact
    public let profit: GclPvImpact
    public let impairment: GclPvImpact
    public let industryClearing: GclPvImpact
    public let thesis: GclPvImpact

    fileprivate var validates: Bool { [cost, profit, impairment, industryClearing, thesis].allSatisfy(\.validates) }
}
public struct GclPvPriceAssessment: Codable, Equatable, Sendable {
    public let status: String
    public let trendConclusionAllowed: Bool
    public let spreadConclusionAllowed: Bool
    public let blockers: [String]
    public let priceTrends: [GclPvComparison]
    public let spreads: [GclPvSpread]
    public let context: [GclPvComparison]
    public let impacts: GclPvImpacts

    var isMaterialForToday: Bool { (trendConclusionAllowed || spreadConclusionAllowed)
        && [impacts.cost, impacts.profit, impacts.impairment, impacts.industryClearing, impacts.thesis].contains { $0.signal != "unknown" } }

    fileprivate var validates: Bool {
        ["comparable", "incomparable", "insufficient"].contains(status)
            && Set(priceTrends.map(\.id)) == Set(["polysilicon_price_trend", "wafer_price_trend", "cell_price_trend", "module_price_trend"])
            && Set(spreads.map(\.id)) == Set(["wafer_minus_polysilicon", "cell_minus_wafer", "module_minus_cell"])
            && Set(context.map(\.id)) == Set(["inventory", "utilization", "capacity", "company_cost", "impairment"])
            && priceTrends.allSatisfy(\.validates) && spreads.allSatisfy(\.validates)
            && context.allSatisfy(\.validates) && blockers.allSatisfy { !$0.isEmpty } && impacts.validates
    }
}
public struct GclPvPriceMonitorSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let mutatesCash: Bool
    public let writesFee: Bool
    public let mutatesPosition: Bool
    public let callsBroker: Bool
    public let productionWrite: Bool

    fileprivate var isAdvisoryOnly: Bool {
        advisoryOnly && !createsOrder && !createsTrade && !mutatesCash && !writesFee
            && !mutatesPosition && !callsBroker && !productionWrite
    }
}

public struct GclPvPriceMonitorData: Codable, Equatable, Sendable {
    public let id: String
    public let runVersion: Int
    public let runFingerprint: String
    public let membershipId: String
    public let membershipVersion: Int
    public let market: String
    public let code: String
    public let symbol: String
    public let period: String
    public let referencePeriod: String
    public let priceObservations: [GclPvPriceObservation]
    public let contextObservations: [GclPvContextObservation]
    public let assessment: GclPvPriceAssessment
    public let createdAt: String
    public let safety: GclPvPriceMonitorSafety

    public func validated(expected membership: CandidateMembershipData) throws -> Self {
        let periods: Set<String> = [period, referencePeriod]
        let sources = priceObservations.map(\.sourceEvent) + contextObservations.map(\.sourceEvent)
        guard researchDocumentIsPositiveIntegerString(id), runVersion > 0, runFingerprint.isFrozenSHA256,
              membershipId == membership.id, membershipVersion == membership.version,
              market == "HK", code == "03800", symbol == "HK.03800", symbol == membership.symbol,
              period.isGclDay, referencePeriod.isGclDay, referencePeriod < period,
              period <= GclPvPriceMonitorDraft.currentDay, (1...100).contains(priceObservations.count), contextObservations.count <= 50,
              Set(priceObservations.map { $0.input.logicalIdentity }).count == priceObservations.count,
              Set(contextObservations.map { $0.input.logicalIdentity }).count == contextObservations.count,
              priceObservations.allSatisfy({ $0.input.validates(periods: periods)
                  && $0.normalizedCnyPerWatt.isFinite && $0.normalizedCnyPerWatt >= 0
                  && $0.sourceEvent.validates(eventId: $0.eventId, variable: $0.input.expectedVariable) }),
              contextObservations.allSatisfy({ $0.input.validates(periods: periods)
                  && $0.sourceEvent.validates(eventId: $0.eventId, variable: $0.metric) }),
              sources.dropFirst().allSatisfy({ $0.holdingBinding == sources.first?.holdingBinding }),
              assessment.validates, isParseableDateTime(createdAt), safety.isAdvisoryOnly else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return self
    }
}

public struct GclPvPriceObservationDraft: Identifiable, Equatable, Sendable {
    public let id = UUID()
    public var eventId = ""
    public var stage = "polysilicon"
    public var period = GclPvPriceMonitorDraft.currentDay
    public var productSpecification = ""
    public var unit = "CNY_per_watt"
    public var value = ""
    public var conversionFactorToCnyPerWatt = "1"
    public var normalizationBasisKey = ""
    public var normalizationRule = ""
    public var definitionKey = ""

    fileprivate var fingerprint: String {
        [eventId, stage, period, productSpecification, unit, value, conversionFactorToCnyPerWatt,
         normalizationBasisKey, normalizationRule, definitionKey].joined(separator: "|")
    }

    fileprivate func observation(periods: Set<String>) -> GclPvPriceInputObservation? {
        guard let value = Double(value.trimmingCharacters(in: .whitespacesAndNewlines)),
              let factor = Double(conversionFactorToCnyPerWatt.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        let result = GclPvPriceInputObservation(
            eventId: eventId.trimmingCharacters(in: .whitespacesAndNewlines), stage: stage, period: period,
            productSpecification: productSpecification.trimmingCharacters(in: .whitespacesAndNewlines), unit: unit,
            currency: "CNY", value: value, conversionFactorToCnyPerWatt: factor,
            normalizationBasisKey: normalizationBasisKey.trimmingCharacters(in: .whitespacesAndNewlines),
            normalizationRule: normalizationRule.trimmingCharacters(in: .whitespacesAndNewlines),
            definitionKey: definitionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        return result.validates(periods: periods) ? result : nil
    }
}

public struct GclPvContextObservationDraft: Identifiable, Equatable, Sendable {
    public let id = UUID()
    public var eventId = ""
    public var metric = "inventory"
    public var period = GclPvPriceMonitorDraft.currentDay
    public var productSpecification = ""
    public var unit = "metric_tonnes"
    public var currency = ""
    public var value = ""
    public var definitionKey = ""

    fileprivate var fingerprint: String { [eventId, metric, period, productSpecification, unit, currency, value, definitionKey].joined(separator: "|") }

    fileprivate func observation(periods: Set<String>) -> GclPvContextInputObservation? {
        guard let value = Double(value.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        let result = GclPvContextInputObservation(
            eventId: eventId.trimmingCharacters(in: .whitespacesAndNewlines), metric: metric, period: period,
            productSpecification: productSpecification.trimmingCharacters(in: .whitespacesAndNewlines), unit: unit,
            currency: currency.isEmpty ? nil : currency, value: value,
            definitionKey: definitionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        return result.validates(periods: periods) ? result : nil
    }
}

public struct GclPvPriceMonitorDraft: Equatable, Sendable {
    public static var currentDay: String { String(ISO8601DateFormatter().string(from: Date()).prefix(10)) }
    public static var referenceDay: String { String(ISO8601DateFormatter().string(from: Date(timeIntervalSinceNow: -30 * 86_400)).prefix(10)) }
    public var period = currentDay
    public var referencePeriod = referenceDay
    public var priceObservations: [GclPvPriceObservationDraft] = []
    public var contextObservations: [GclPvContextObservationDraft] = []
    public var ownerConfirmed = false
    public init() {}

    public var fingerprint: String {
        "\(period)|\(referencePeriod)|\(priceObservations.map(\.fingerprint).joined(separator: "||"))|\(contextObservations.map(\.fingerprint).joined(separator: "||"))"
    }

    public func request(membership: CandidateMembershipData, idempotencyKey: String) -> CreateGclPvPriceMonitorRequest? {
        let period = period.trimmingCharacters(in: .whitespacesAndNewlines)
        let referencePeriod = referencePeriod.trimmingCharacters(in: .whitespacesAndNewlines)
        let periods: Set<String> = [period, referencePeriod]
        let prices = priceObservations.compactMap { $0.observation(periods: periods) }
        let contexts = contextObservations.compactMap { $0.observation(periods: periods) }
        guard ownerConfirmed, membership.state == .tracked, membership.symbol == "HK.03800",
              prices.count == priceObservations.count, contexts.count == contextObservations.count else { return nil }
        let request = CreateGclPvPriceMonitorRequest(
            membershipVersion: membership.version, period: period, referencePeriod: referencePeriod,
            priceObservations: prices, contextObservations: contexts, idempotencyKey: idempotencyKey
        )
        return request.validates() ? request : nil
    }

    public mutating func appendPrice(eventId: String = "", stage: String = "polysilicon") {
        var row = GclPvPriceObservationDraft(); row.eventId = eventId; row.stage = stage; row.period = period
        priceObservations.append(row); ownerConfirmed = false
    }

    public mutating func appendContext(eventId: String = "", metric: String = "inventory") {
        var row = GclPvContextObservationDraft(); row.eventId = eventId; row.metric = metric; row.period = period
        if let dimension = gclContextDimension(metric) { row.unit = dimension.unit; row.currency = dimension.currency ?? "" }
        contextObservations.append(row); ownerConfirmed = false
    }

    public mutating func duplicatePrice(_ id: UUID) {
        guard var row = priceObservations.first(where: { $0.id == id }) else { return }
        let source = row; row = GclPvPriceObservationDraft()
        row.eventId = source.eventId; row.stage = source.stage; row.period = source.period; row.productSpecification = source.productSpecification
        row.unit = source.unit; row.value = source.value; row.conversionFactorToCnyPerWatt = source.conversionFactorToCnyPerWatt
        row.normalizationBasisKey = source.normalizationBasisKey; row.normalizationRule = source.normalizationRule; row.definitionKey = source.definitionKey
        priceObservations.append(row); ownerConfirmed = false
    }

    public mutating func duplicateContext(_ id: UUID) {
        guard var row = contextObservations.first(where: { $0.id == id }) else { return }
        let source = row; row = GclPvContextObservationDraft()
        row.eventId = source.eventId; row.metric = source.metric; row.period = source.period; row.productSpecification = source.productSpecification
        row.unit = source.unit; row.currency = source.currency; row.value = source.value; row.definitionKey = source.definitionKey
        contextObservations.append(row); ownerConfirmed = false
    }

    public mutating func removePrice(_ id: UUID) { priceObservations.removeAll { $0.id == id }; ownerConfirmed = false }
    public mutating func removeContext(_ id: UUID) { contextObservations.removeAll { $0.id == id }; ownerConfirmed = false }
}

extension ResearchClient {
    public func createGclPvPriceMonitorAndReadBack(
        membership: CandidateMembershipData,
        requestBody: CreateGclPvPriceMonitorRequest
    ) async throws -> (workspace: FrozenResearchEvidenceWorkspace, monitor: GclPvPriceMonitorData) {
        guard membership.state == .tracked, membership.symbol == "HK.03800",
              requestBody.membershipVersion == membership.version, requestBody.validates() else {
            throw FrozenResearchEvidenceClientError.bindingDrift
        }
        var request = URLRequest(url: frozenResearchEvidenceURL(membershipId: membership.id).appending(path: "gcl-pv-price-monitors"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(requestBody)
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        let write = try JSONDecoder().decode(ResearchWriteEnvelope<GclPvPriceMonitorData>.self, from: data)
        guard write.schemaVersion == "2026-06-18.research-write.v1", write.status == "succeeded",
              write.source.actorType == "user", write.source.actorId == membership.actorId else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        let monitor = try write.data.validated(expected: membership)
        guard monitor.priceObservations.count == requestBody.priceObservations.count,
              monitor.contextObservations.count == requestBody.contextObservations.count,
              monitor.priceObservations.allSatisfy({ requestBody.priceObservations.contains($0.input) }),
              monitor.contextObservations.allSatisfy({ requestBody.contextObservations.contains($0.input) }) else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        let fresh = try await fetchFrozenResearchEvidence(membership: membership)
        guard let freshMonitor = fresh.data?.latestGclPvPriceMonitor,
              freshMonitor.id == monitor.id, freshMonitor.runVersion == monitor.runVersion,
              freshMonitor.runFingerprint == monitor.runFingerprint, freshMonitor == monitor else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return (fresh, monitor)
    }
}

private func gclContextDimension(_ metric: String) -> (unit: String, currency: String?)? {
    switch metric {
    case "inventory": ("metric_tonnes", nil)
    case "utilization": ("percent", nil)
    case "capacity": ("metric_tonnes_per_year", nil)
    case "company_cost": ("CNY_per_kg", "CNY")
    case "impairment": ("CNY", "CNY")
    default: nil
    }
}

private func gclDate(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter(); fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}

private extension String {
    var isGclDay: Bool { range(of: #"^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$"#, options: .regularExpression) != nil }
    var isGclIdentifier: Bool { range(of: #"^[a-z0-9][a-z0-9._:-]{0,199}$"#, options: .regularExpression) != nil }
}
