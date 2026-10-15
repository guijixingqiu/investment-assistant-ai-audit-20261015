import Foundation

public struct GeelySalesInputObservation: Codable, Equatable, Sendable {
    public let eventId: String
    public let entityId: String
    public let entityName: String
    public let entityRole: String
    public let entityLevel: String
    public let issuerId: String?
    public let periodKind: String
    public let period: String
    public let metric: String
    public let propulsion: String
    public let geography: String
    public let channel: String
    public let unit: String
    public let definitionKey: String
    public let value: Double

    fileprivate var logicalIdentity: String {
        [entityId, entityRole, entityLevel, issuerId ?? "null", periodKind, period,
         metric, propulsion, geography, channel, unit, definitionKey].joined(separator: "|")
    }

    fileprivate func validates(runPeriod: String) -> Bool {
        let roles: Set<String> = ["target", "peer", "industry"]
        let levels: Set<String> = ["issuer", "brand", "model", "industry"]
        let allowedPeriods = periodKind == "month"
            ? [runPeriod, shiftedMonth(runPeriod, by: -1), shiftedMonth(runPeriod, by: -12)]
            : [runPeriod, shiftedMonth(runPeriod, by: -12)]
        let identityIsValid = entityRole == "industry"
            ? entityLevel == "industry" && issuerId == nil
            : entityLevel != "industry" && issuerId?.isGeelySalesIdentifier == true
        return researchDocumentIsPositiveIntegerString(eventId)
            && entityId.isGeelySalesIdentifier && !entityName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && entityName.count <= 200 && roles.contains(entityRole) && levels.contains(entityLevel)
            && identityIsValid && (entityLevel != "issuer" || issuerId == entityId)
            && ["month", "year_to_date"].contains(periodKind) && allowedPeriods.compactMap { $0 }.contains(period)
            && ["sales_volume", "average_transaction_price"].contains(metric)
            && ["all", "new_energy"].contains(propulsion) && ["global", "china", "export"].contains(geography)
            && ["wholesale", "retail", "deliveries", "registrations"].contains(channel)
            && !definitionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && definitionKey.count <= 200
            && (metric == "sales_volume"
                ? unit == "vehicles" && value.isFinite && value >= 0
                    && value <= 9_007_199_254_740_991 && value.rounded() == value
                : unit == "CNY_per_vehicle" && value.isFinite && value > 0 && periodKind == "month")
    }
}

public struct CreateGeelySalesMonitorRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let period: String
    public let observations: [GeelySalesInputObservation]
    public let idempotencyKey: String

    func validates() -> Bool {
        let targetIssuers = Set(observations.filter {
            $0.entityRole == "target" && $0.entityLevel == "issuer"
        }.compactMap(\.issuerId))
        return membershipVersion > 0 && period.isGeelySalesMonth
            && period <= GeelySalesMonitorDraft.currentMonth && (1...200).contains(observations.count)
            && observations.allSatisfy { $0.validates(runPeriod: period) }
            && Set(observations.map(\.logicalIdentity)).count == observations.count
            && targetIssuers.count == 1
            && !idempotencyKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && idempotencyKey.count <= 200
    }
}

public struct GeelySalesSourceEvent: Codable, Equatable, Sendable {
    public let eventId: String
    public let eventVersion: Int
    public let eventFingerprint: String
    public let symbol: String
    public let eventKind: String
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

    fileprivate func validates(eventId expectedEventId: String) -> Bool {
        let published = geelySalesDate(publishedAt)
        let captured = geelySalesDate(capturedAt)
        let valid = geelySalesDate(validUntil)
        let validURL = sourceUrl.map {
            $0.count <= 2_000 && URL(string: $0).map { ["http", "https"].contains($0.scheme?.lowercased() ?? "") } == true
        } ?? true
        return eventId == expectedEventId && researchDocumentIsPositiveIntegerString(eventId)
            && eventVersion > 0 && eventFingerprint.isFrozenSHA256
            && SecuritySymbol.parseHongKongAlias(symbol)?.canonical == symbol
            && ResearchEventCaptureDraft.supportedEventKinds.contains(eventKind)
            && researchDocumentIsPositiveIntegerString(materialId) && materialFingerprint.isFrozenSHA256
            && !sourceType.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && sourceType.count <= 200 && validURL
            && published != nil && captured != nil && valid != nil && published! <= captured! && captured! < valid!
            && ["user_provided", "authorized_public"].contains(rightsStatus) && verificationStatus == "verified"
            && !sourceVersion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && sourceVersion.count <= 200
            && revision > 0 && keyVariable == "new_energy_vehicle_sales"
            && ["supports", "weakens", "unknown"].contains(hypothesisImpact)
    }
}

public struct GeelySalesObservation: Codable, Equatable, Sendable {
    public let eventId: String
    public let entityId: String
    public let entityName: String
    public let entityRole: String
    public let entityLevel: String
    public let issuerId: String?
    public let periodKind: String
    public let period: String
    public let metric: String
    public let propulsion: String
    public let geography: String
    public let channel: String
    public let unit: String
    public let definitionKey: String
    public let value: Double
    public let sourceEvent: GeelySalesSourceEvent

    fileprivate var input: GeelySalesInputObservation {
        .init(eventId: eventId, entityId: entityId, entityName: entityName, entityRole: entityRole,
              entityLevel: entityLevel, issuerId: issuerId, periodKind: periodKind, period: period,
              metric: metric, propulsion: propulsion, geography: geography, channel: channel,
              unit: unit, definitionKey: definitionKey, value: value)
    }
}

public struct GeelySalesAssessment: Codable, Equatable, Sendable {
    public let status: String
    public let trendConclusionAllowed: Bool
    public let blockers: [String]
    public let movement: String
}

public struct GeelySalesMonitorSafety: Codable, Equatable, Sendable {
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

public struct GeelySalesMonitorData: Codable, Equatable, Sendable {
    public let id: String
    public let runVersion: Int
    public let runFingerprint: String
    public let membershipId: String
    public let membershipVersion: Int
    public let market: String
    public let code: String
    public let symbol: String
    public let period: String
    public let observations: [GeelySalesObservation]
    public let assessment: GeelySalesAssessment
    public let createdAt: String
    public let safety: GeelySalesMonitorSafety

    public func validated(expected membership: CandidateMembershipData) throws -> Self {
        let validAssessmentStates: Set<String> = ["comparable", "incomparable", "insufficient"]
        let validMovements: Set<String> = ["industry_common_up", "industry_common_down", "company_specific_outperformance", "company_specific_underperformance", "mixed", "unknown"]
        let targetIssuers = Set(observations.filter {
            $0.entityRole == "target" && $0.entityLevel == "issuer"
        }.compactMap(\.issuerId))
        guard researchDocumentIsPositiveIntegerString(id), runVersion > 0, runFingerprint.isFrozenSHA256,
              membershipId == membership.id, membershipVersion == membership.version,
              market == "HK", code == "00175", symbol == "HK.00175", symbol == membership.symbol,
              period.isGeelySalesMonth, period <= GeelySalesMonitorDraft.currentMonth,
              (1...200).contains(observations.count), targetIssuers.count == 1,
              Set(observations.map { $0.input.logicalIdentity }).count == observations.count,
              observations.allSatisfy({ observation in
                  observation.input.validates(runPeriod: period)
                      && observation.sourceEvent.validates(eventId: observation.eventId)
              }),
              validAssessmentStates.contains(assessment.status),
              assessment.trendConclusionAllowed == (assessment.status == "comparable"),
              validMovements.contains(assessment.movement), isParseableDateTime(createdAt), safety.isAdvisoryOnly else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return self
    }
}

public struct GeelySalesObservationDraft: Identifiable, Equatable, Sendable {
    public let id: UUID
    public var eventId: String
    public var entityId: String
    public var entityName: String
    public var entityRole: String
    public var entityLevel: String
    public var issuerId: String
    public var periodKind: String
    public var period: String
    public var metric: String
    public var propulsion: String
    public var geography: String
    public var channel: String
    public var definitionKey: String
    public var value: String

    public init(eventId: String = "", period: String = GeelySalesMonitorDraft.currentMonth) {
        id = UUID()
        self.eventId = eventId
        entityId = "geely-auto"
        entityName = "吉利汽车"
        entityRole = "target"
        entityLevel = "issuer"
        issuerId = "geely-auto"
        periodKind = "month"
        self.period = period
        metric = "sales_volume"
        propulsion = "all"
        geography = "global"
        channel = "wholesale"
        definitionKey = "manufacturer_wholesale_global_v1"
        value = ""
    }

    fileprivate var semanticFingerprint: String {
        [eventId, entityId, entityName, entityRole, entityLevel, issuerId, periodKind, period,
         metric, propulsion, geography, channel, definitionKey, value].joined(separator: "|")
    }

    func observation(runPeriod: String) -> GeelySalesInputObservation? {
        let entityId = entityId.trimmingCharacters(in: .whitespacesAndNewlines)
        let role = entityRole
        let level = role == "industry" ? "industry" : entityLevel
        let issuer = role == "industry" ? nil
            : level == "issuer" ? entityId : issuerId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parsedValue = Double(value.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        let result = GeelySalesInputObservation(
            eventId: eventId.trimmingCharacters(in: .whitespacesAndNewlines),
            entityId: entityId,
            entityName: entityName.trimmingCharacters(in: .whitespacesAndNewlines),
            entityRole: role,
            entityLevel: level,
            issuerId: issuer,
            periodKind: periodKind,
            period: period,
            metric: metric,
            propulsion: propulsion,
            geography: geography,
            channel: channel,
            unit: metric == "sales_volume" ? "vehicles" : "CNY_per_vehicle",
            definitionKey: definitionKey.trimmingCharacters(in: .whitespacesAndNewlines),
            value: parsedValue
        )
        return result.validates(runPeriod: runPeriod) ? result : nil
    }
}

public struct GeelySalesMonitorDraft: Equatable, Sendable {
    public static var currentMonth: String { String(ISO8601DateFormatter().string(from: Date()).prefix(7)) }
    public var period = currentMonth
    public var observations: [GeelySalesObservationDraft] = []
    public var ownerConfirmed = false
    public init() {}

    public var fingerprint: String {
        "\(period)|\(observations.map(\.semanticFingerprint).joined(separator: "||"))"
    }

    public func request(membership: CandidateMembershipData, idempotencyKey: String) -> CreateGeelySalesMonitorRequest? {
        let period = period.trimmingCharacters(in: .whitespacesAndNewlines)
        let input = observations.compactMap { $0.observation(runPeriod: period) }
        guard ownerConfirmed, membership.state == .tracked, membership.symbol == "HK.00175",
              input.count == observations.count else { return nil }
        let request = CreateGeelySalesMonitorRequest(
            membershipVersion: membership.version,
            period: period,
            observations: input,
            idempotencyKey: idempotencyKey
        )
        return request.validates() ? request : nil
    }

    public func allowedPeriods(for kind: String) -> [String] {
        let offsets = kind == "year_to_date" ? [0, -12] : [0, -1, -12]
        return offsets.compactMap { shiftedMonth(period, by: $0) }
    }

    public mutating func appendTarget(eventId: String) {
        observations.append(GeelySalesObservationDraft(eventId: eventId, period: period))
        ownerConfirmed = false
    }

    public mutating func appendBlank() {
        observations.append(GeelySalesObservationDraft(period: period))
        ownerConfirmed = false
    }

    public mutating func duplicate(_ id: UUID) {
        guard let source = observations.first(where: { $0.id == id }) else { return }
        var copy = GeelySalesObservationDraft(eventId: source.eventId, period: source.period)
        copy.entityId = source.entityId
        copy.entityName = source.entityName
        copy.entityRole = source.entityRole
        copy.entityLevel = source.entityLevel
        copy.issuerId = source.issuerId
        copy.periodKind = source.periodKind
        copy.metric = source.metric
        copy.propulsion = source.propulsion
        copy.geography = source.geography
        copy.channel = source.channel
        copy.definitionKey = source.definitionKey
        copy.value = source.value
        observations.append(copy)
        ownerConfirmed = false
    }

    public mutating func remove(_ id: UUID) {
        observations.removeAll { $0.id == id }
        ownerConfirmed = false
    }
}

extension ResearchClient {
    public func createGeelySalesMonitorAndReadBack(
        membership: CandidateMembershipData,
        requestBody: CreateGeelySalesMonitorRequest
    ) async throws -> (workspace: FrozenResearchEvidenceWorkspace, monitor: GeelySalesMonitorData) {
        guard membership.state == .tracked, membership.symbol == "HK.00175",
              requestBody.membershipVersion == membership.version, requestBody.validates() else {
            throw FrozenResearchEvidenceClientError.bindingDrift
        }
        var request = URLRequest(
            url: frozenResearchEvidenceURL(membershipId: membership.id).appending(path: "geely-sales-monitors")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(requestBody)
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        let write = try JSONDecoder().decode(ResearchWriteEnvelope<GeelySalesMonitorData>.self, from: data)
        guard write.schemaVersion == "2026-06-18.research-write.v1", write.status == "succeeded",
              write.source.actorType == "user", write.source.actorId == membership.actorId else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        let monitor = try write.data.validated(expected: membership)
        let fresh = try await fetchFrozenResearchEvidence(membership: membership)
        guard let freshMonitor = fresh.data?.latestGeelySalesMonitor,
              freshMonitor.id == monitor.id, freshMonitor.runVersion == monitor.runVersion,
              freshMonitor.runFingerprint == monitor.runFingerprint,
              freshMonitor == monitor else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return (fresh, monitor)
    }
}

private func shiftedMonth(_ value: String, by offset: Int) -> String? {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM"
    guard let date = formatter.date(from: value),
          let shifted = Calendar(identifier: .gregorian).date(byAdding: .month, value: offset, to: date) else { return nil }
    return formatter.string(from: shifted)
}

private func geelySalesDate(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}

private extension String {
    var isGeelySalesIdentifier: Bool { range(of: #"^[a-z0-9][a-z0-9._:-]{0,99}$"#, options: .regularExpression) != nil }
    var isGeelySalesMonth: Bool { range(of: #"^\d{4}-(0[1-9]|1[0-2])$"#, options: .regularExpression) != nil }
}
