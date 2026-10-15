import Foundation

public struct ResearchCompletenessSourceBinding: Codable, Equatable, Sendable {
    public let sourceType: String
    public let sourceId: String
    public let sourceVersion: String
    public let asOf: String
    public let validUntil: String
}

public struct ResearchCompletenessCoverage: Codable, Equatable, Sendable {
    public let achieved: Int
    public let required: Int
}

public struct ResearchCompletenessSection: Codable, Equatable, Identifiable, Sendable {
    public var id: String { section }
    public let section: String
    public let status: String
    public let coverage: ResearchCompletenessCoverage
    public let sourceBindings: [ResearchCompletenessSourceBinding]
    public let gaps: [String]
}

public struct ResearchCompletenessThreshold: Codable, Equatable, Sendable {
    public let version: String
    public let availableSectionsRequired: Int
    public let totalSections: Int
}

public struct ResearchCompletenessScore: Codable, Equatable, Sendable {
    public let availableSections: Int
    public let totalSections: Int
}

public struct ResearchCompletenessLineage: Codable, Equatable, Sendable {
    public let section: String
    public let sourceType: String
    public let sourceId: String
    public let sourceVersion: String
    public let asOf: String
    public let validUntil: String
}

public struct ResearchCompletenessData: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let actorId: String
    public let threshold: ResearchCompletenessThreshold
    public let score: ResearchCompletenessScore
    public let status: String
    public let confirmationEligible: Bool
    public let formalDecisionEligible: Bool
    public let hardBlockers: [String]
    public let sections: [ResearchCompletenessSection]
    public let sourceLineage: [ResearchCompletenessLineage]
    public let validUntil: String
    public let createdAt: String

    public var canFormalize: Bool {
        status == "complete_pending_confirmation" && confirmationEligible
            && formalDecisionEligible && hardBlockers.isEmpty
    }

    public func validate(expected membership: CandidateMembershipData, now: Date = Date()) throws {
        let ids = ["financials", "kpi", "peers", "valuation", "quant", "weinstein", "risks", "counterevidence", "conflicts"]
        let available = sections.filter { $0.status == "available" }.count
        var errors: [String] = []
        if !researchDocumentIsPositiveIntegerString(id) || membershipId != membership.id
            || membershipVersion != membership.version || symbol != membership.symbol || actorId != membership.actorId
            || threshold.version != "nine-sections-seven-required-v1" || threshold.availableSectionsRequired != 7
            || threshold.totalSections != 9 || score.availableSections != available || score.totalSections != 9
            || sections.count != ids.count || Set(sections.map(\.section)) != Set(ids)
            || !hardBlockers.isEmpty || researchContextDate(validUntil).map({ $0 > now }) != true
            || !isParseableDateTime(createdAt) {
            errors.append("research completeness identity, threshold, or timeline is invalid")
        }
        let required = Set(["financials", "kpi", "peers", "valuation", "weinstein"])
        let availableIds = Set(sections.filter { $0.status == "available" }.map(\.section))
        let eligible = available >= 7 && required.isSubset(of: availableIds)
        if status != (eligible ? "complete_pending_confirmation" : "evidence_insufficient")
            || confirmationEligible != eligible || formalDecisionEligible != eligible {
            errors.append("research completeness formalization gates are inconsistent")
        }
        for section in sections {
            if !["available", "unknown"].contains(section.status)
                || section.coverage.required < 1 || section.coverage.achieved < 0
                || section.coverage.achieved > section.coverage.required
                || (section.status == "available") != (section.coverage.achieved == section.coverage.required && !section.sourceBindings.isEmpty)
                || section.status == "unknown" && section.gaps.isEmpty {
                errors.append("research completeness section is invalid")
            }
            for source in section.sourceBindings where !isParseableDateTime(source.asOf)
                || !isParseableDateTime(source.validUntil) || source.sourceId.isEmpty || source.sourceVersion.isEmpty {
                errors.append("research completeness source binding is invalid")
            }
            for source in section.sourceBindings where source.sourceType == "financial_requirement" {
                if section.section != "financials" || !researchDocumentIsPositiveIntegerString(source.sourceId)
                    || source.sourceVersion != ResearchFinancialRequirementData.schemaVersionV1 {
                    errors.append("financial requirement completeness binding is invalid")
                }
            }
        }
        let lineage = sections.flatMap { section in section.sourceBindings.map {
            ResearchCompletenessLineage(section: section.section, sourceType: $0.sourceType, sourceId: $0.sourceId, sourceVersion: $0.sourceVersion, asOf: $0.asOf, validUntil: $0.validUntil)
        } }
        if sourceLineage != lineage { errors.append("research completeness lineage is not exact") }
        if !errors.isEmpty { throw ResearchCompletenessClientError.invalidResponse }
    }
}

public struct ResearchCompletenessEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let generatedAt: String
    public let status: ResearchContextStatus
    public let membershipId: String
    public let requestedActorId: String
    public let requestedSymbol: String?
    public let latestSnapshotId: String?
    public let data: ResearchCompletenessData?
    public let message: String

    public func validate(expected membership: CandidateMembershipData) throws {
        if schemaVersion != "2026-08-13.research-completeness.v1" || !isParseableDateTime(generatedAt)
            || membershipId != membership.id || requestedActorId != membership.actorId
            || latestSnapshotId.map(researchDocumentIsPositiveIntegerString) == false {
            throw ResearchCompletenessClientError.invalidResponse
        }
        switch status {
        case .available:
            guard requestedSymbol == membership.symbol, let data, latestSnapshotId == data.id else { throw ResearchCompletenessClientError.invalidResponse }
            try data.validate(expected: membership)
        case .notFound, .unavailable:
            if data != nil { throw ResearchCompletenessClientError.invalidResponse }
        }
    }
}

public struct CreateResearchCompletenessRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let baseSnapshotId: String?
    public let expectedFundamentalsDataCutoffAt: String?
    public let expectedResearchContextId: String?
    public let externalSections: [ResearchCompletenessSection]
    public let validUntil: String
    public let ownerConfirmed: Bool
    public let idempotencyKey: String
}

public enum ResearchCompletenessClientError: Error, Equatable, Sendable {
    case httpStatus(Int)
    case invalidResponse
    case sourceUnavailable
}

public func makeResearchCompletenessRequest(
    membership: CandidateMembershipData,
    fundamentals: ResearchFundamentalsEnvelope,
    context: ResearchContextEnvelope,
    current: ResearchCompletenessEnvelope?,
    idempotencyKey: String,
    now: Date = Date()
) throws -> CreateResearchCompletenessRequest {
    guard fundamentals.membershipId == membership.id, fundamentals.membershipVersion == membership.version,
          fundamentals.symbol == membership.symbol, fundamentals.requestedActorId == membership.actorId,
          context.membershipId == membership.id, context.requestedActorId == membership.actorId else {
        throw ResearchCompletenessClientError.sourceUnavailable
    }
    let externalIds = ["valuation", "quant", "weinstein", "risks", "counterevidence", "conflicts"]
    let external = externalIds.map { id in
        ResearchCompletenessSection(
            section: id, status: "unknown", coverage: ResearchCompletenessCoverage(achieved: 0, required: 1),
            sourceBindings: [], gaps: ["\(id) is derived by the server and is UNKNOWN until exact readback"]
        )
    }
    let expiries = fundamentals.values.filter { $0.valueState == "current" }.compactMap { researchContextDate($0.source.validUntil) }
        + (context.data.flatMap { researchContextDate($0.validUntil) }.map { [$0] } ?? [])
        + (fundamentals.financialCoverage.requirement.flatMap { researchContextDate($0.validUntil) }.map { [$0] } ?? [])
        + external.flatMap { $0.sourceBindings.compactMap { researchContextDate($0.validUntil) } }
    let validUntil = expiries.min() ?? Calendar(identifier: .gregorian).date(byAdding: .day, value: 30, to: now)!
    guard validUntil > now else { throw ResearchCompletenessClientError.sourceUnavailable }
    return CreateResearchCompletenessRequest(
        membershipVersion: membership.version, baseSnapshotId: current?.latestSnapshotId,
        expectedFundamentalsDataCutoffAt: fundamentals.dataCutoffAt,
        expectedResearchContextId: context.status == .available ? context.data?.id : nil,
        externalSections: external, validUntil: ISO8601DateFormatter().string(from: validUntil),
        ownerConfirmed: true, idempotencyKey: idempotencyKey
    )
}

extension ResearchClient {
    public func fetchResearchCompleteness(membership: CandidateMembershipData) async throws -> ResearchCompletenessEnvelope {
        var request = URLRequest(url: researchCompletenessURL(membership.id), cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, [200, 404, 503].contains(http.statusCode) else {
            throw ResearchCompletenessClientError.invalidResponse
        }
        guard let envelope = try? JSONDecoder().decode(ResearchCompletenessEnvelope.self, from: data) else {
            throw ResearchCompletenessClientError.httpStatus(http.statusCode)
        }
        try envelope.validate(expected: membership)
        guard (http.statusCode == 200 && envelope.status == .available)
            || (http.statusCode == 404 && envelope.status == .notFound)
            || (http.statusCode == 503 && envelope.status == .unavailable) else {
            throw ResearchCompletenessClientError.invalidResponse
        }
        return envelope
    }

    public func createResearchCompletenessAndReadBack(
        membership: CandidateMembershipData,
        requestBody: CreateResearchCompletenessRequest
    ) async throws -> ResearchCompletenessEnvelope {
        var request = URLRequest(url: researchCompletenessURL(membership.id))
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request); request.httpBody = try JSONEncoder().encode(requestBody)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ResearchCompletenessClientError.invalidResponse }
        guard 200..<300 ~= http.statusCode else { throw ResearchCompletenessClientError.httpStatus(http.statusCode) }
        let write = try JSONDecoder().decode(ResearchCompletenessEnvelope.self, from: data)
        try write.validate(expected: membership)
        let fresh = try await fetchResearchCompleteness(membership: membership)
        guard fresh == write else { throw ResearchCompletenessClientError.invalidResponse }
        return fresh
    }

    private func researchCompletenessURL(_ membershipId: String) -> URL {
        candidateMembershipsURL(includeArchived: nil).appending(path: membershipId).appending(path: "completeness")
    }
}

public struct ResearchFinancialRequirementSourceExpectation: Codable, Equatable, Sendable {
    public let materialId: String
    public let materialRevision: Int
    public let contentFingerprint: String

    public init(material: ResearchMaterialData) {
        materialId = material.id
        materialRevision = material.revision
        contentFingerprint = material.contentFingerprint
    }
}

public struct ResearchFinancialRequirementSourceCitation: Codable, Equatable, Sendable {
    public let documentId: String?
    public let pageNumber: Int?
    public let pageTextSha256: String?
    public let kind: String?
    public let snapshotId: String?
    public let textSha256: String?
    public let startUtf16: Int?
    public let endUtf16: Int?
    public let excerptSha256: String?
}

public struct ResearchFinancialRequirementSource: Codable, Equatable, Sendable {
    public let materialId: String
    public let materialRevision: Int
    public let contentFingerprint: String
    public let sourceVersion: String
    public let sourceType: String
    public let citation: ResearchFinancialRequirementSourceCitation
    public let originalSha256: String
    public let originalByteLength: Int

    public func matches(_ expected: ResearchFinancialRequirementSourceExpectation) -> Bool {
        materialId == expected.materialId && materialRevision == expected.materialRevision
            && contentFingerprint == expected.contentFingerprint
    }
}

public struct ResearchFinancialRequirementData: Codable, Equatable, Identifiable, Sendable {
    public static let schemaVersionV1 = "2026-10-10.research-financial-requirement.v1"

    public let schemaVersion: String
    public let id: String
    public let version: Int
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let actorType: String
    public let actorId: String
    public let fiscalYearEnd: String
    public let latestRequiredAnnualPeriodEnd: String
    public let latestRequiredInterimPeriodStart: String
    public let latestRequiredInterimPeriodEnd: String
    public let asOf: String
    public let nextReviewAt: String
    public let validUntil: String
    public let sources: [ResearchFinancialRequirementSource]
    public let ownerConfirmed: Bool
    public let createdAt: String

    public func validates(expected membership: CandidateMembershipData, now: Date = Date()) -> Bool {
        schemaVersion == Self.schemaVersionV1 && researchDocumentIsPositiveIntegerString(id)
            && version > 0 && membershipId == membership.id && membershipVersion == membership.version
            && symbol == membership.symbol && actorType == "user" && actorId == membership.actorId
            && ownerConfirmed && researchFinancialRequirementPeriodsValid(
                fiscalYearEnd: fiscalYearEnd,
                annualEnd: latestRequiredAnnualPeriodEnd,
                interimStart: latestRequiredInterimPeriodStart,
                interimEnd: latestRequiredInterimPeriodEnd,
                asOf: asOf
            )
            && researchContextDate(asOf).map { $0 <= now } == true
            && researchContextDate(validUntil).map { $0 > now } == true
            && researchContextDate(nextReviewAt).map { $0 > now } == true
            && researchContextDate(validUntil).flatMap { until in
                researchContextDate(nextReviewAt).map { until <= $0 }
            } == true
            && researchContextDate(createdAt).flatMap { created in
                researchContextDate(validUntil).map { created < $0 }
            } == true
            && isParseableDateTime(createdAt)
            && (1...4).contains(sources.count)
            && Set(sources.map(\.materialId)).count == sources.count
            && sources.allSatisfy { source in
                researchDocumentIsPositiveIntegerString(source.materialId)
                    && source.materialRevision > 0
                    && researchDocumentIsSha256(source.contentFingerprint)
                    && researchDocumentIsSha256(source.originalSha256)
                    && source.originalByteLength > 0 && !source.sourceVersion.isEmpty
                    && ["owner_provided_pdf", "issuer_public_pdf", "issuer_public_html"].contains(source.sourceType)
                    && (source.sourceType == "issuer_public_html"
                        ? source.citation.kind == "source_snapshot"
                            && source.citation.snapshotId.map(researchDocumentIsPositiveIntegerString) == true
                            && source.citation.textSha256.map(researchDocumentIsSha256) == true
                            && source.citation.excerptSha256.map(researchDocumentIsSha256) == true
                        : source.citation.documentId.map(researchDocumentIsPositiveIntegerString) == true
                            && (source.citation.pageNumber ?? 0) > 0
                            && source.citation.pageTextSha256.map(researchDocumentIsSha256) == true)
            }
    }
}

public func researchFinancialRequirementPeriodsValid(
    fiscalYearEnd: String, annualEnd: String, interimStart: String,
    interimEnd: String, asOf: String
) -> Bool {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    guard fiscalYearEnd.count == 5, fiscalYearEnd != "02-29",
          ResearchFundamentalCalendarDate.date(from: "2024-\(fiscalYearEnd)", calendar: calendar) != nil,
          annualEnd.hasSuffix(fiscalYearEnd),
          let year = Int(annualEnd.prefix(4)), year > 1, year < 9999,
          let annual = ResearchFundamentalCalendarDate.date(from: annualEnd, calendar: calendar),
          let previous = ResearchFundamentalCalendarDate.date(
            from: String(format: "%04d-%@", year - 1, fiscalYearEnd), calendar: calendar),
          let next = ResearchFundamentalCalendarDate.date(
            from: String(format: "%04d-%@", year + 1, fiscalYearEnd), calendar: calendar),
          let start = ResearchFundamentalCalendarDate.date(from: interimStart, calendar: calendar),
          let end = ResearchFundamentalCalendarDate.date(from: interimEnd, calendar: calendar),
          let thisFiscalStart = calendar.date(byAdding: .day, value: 1, to: previous),
          let nextFiscalStart = calendar.date(byAdding: .day, value: 1, to: annual),
          let checkedAt = researchContextDate(asOf) else { return false }
    let days = calendar.dateComponents([.day], from: start, to: end).day ?? -1
    return ((start == thisFiscalStart && end < annual)
        || (start == nextFiscalStart && end < next))
        && start <= end
        && days >= 27 && days < 364
        && annual <= checkedAt && end <= checkedAt
}

public struct ResearchFinancialRequirementEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let status: String
    public let membershipId: String
    public let requestedActorId: String
    public let requestedSymbol: String?
    public let latestRequirementId: String?
    public let data: ResearchFinancialRequirementData?
    public let gaps: [String]
    public let message: String?

    public func validate(expected membership: CandidateMembershipData) throws {
        guard schemaVersion == ResearchFinancialRequirementData.schemaVersionV1,
              ["available", "not_found", "unavailable"].contains(status),
              membershipId == membership.id,
              requestedActorId == membership.actorId,
              requestedSymbol.map({ $0 == membership.symbol }) != false,
              latestRequirementId.map(researchDocumentIsPositiveIntegerString) != false else {
            throw ResearchFinancialRequirementClientError.invalidResponse
        }
        if status == "available" {
            guard let data, latestRequirementId == data.id,
                  data.validates(expected: membership) else {
                throw ResearchFinancialRequirementClientError.invalidResponse
            }
        } else if data != nil || status == "unavailable" && gaps.isEmpty {
            throw ResearchFinancialRequirementClientError.invalidResponse
        }
    }
}

public struct CreateResearchFinancialRequirementRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let baseRequirementId: String?
    public let sourceMaterials: [ResearchFinancialRequirementSourceExpectation]
    public let fiscalYearEnd: String
    public let latestRequiredAnnualPeriodEnd: String
    public let latestRequiredInterimPeriodStart: String
    public let latestRequiredInterimPeriodEnd: String
    public let asOf: String
    public let nextReviewAt: String
    public let ownerConfirmed: Bool
    public let idempotencyKey: String

    public init(membershipVersion: Int, baseRequirementId: String?,
                sourceMaterials: [ResearchFinancialRequirementSourceExpectation],
                fiscalYearEnd: String, latestRequiredAnnualPeriodEnd: String,
                latestRequiredInterimPeriodStart: String, latestRequiredInterimPeriodEnd: String,
                asOf: String, nextReviewAt: String, idempotencyKey: String) {
        self.membershipVersion = membershipVersion
        self.baseRequirementId = baseRequirementId
        self.sourceMaterials = sourceMaterials
        self.fiscalYearEnd = fiscalYearEnd
        self.latestRequiredAnnualPeriodEnd = latestRequiredAnnualPeriodEnd
        self.latestRequiredInterimPeriodStart = latestRequiredInterimPeriodStart
        self.latestRequiredInterimPeriodEnd = latestRequiredInterimPeriodEnd
        self.asOf = asOf
        self.nextReviewAt = nextReviewAt
        ownerConfirmed = true
        self.idempotencyKey = idempotencyKey
    }

    private enum CodingKeys: String, CodingKey {
        case membershipVersion, baseRequirementId, sourceMaterials, fiscalYearEnd
        case latestRequiredAnnualPeriodEnd, latestRequiredInterimPeriodStart, latestRequiredInterimPeriodEnd
        case asOf, nextReviewAt, ownerConfirmed, idempotencyKey
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(membershipVersion, forKey: .membershipVersion)
        if let baseRequirementId {
            try values.encode(baseRequirementId, forKey: .baseRequirementId)
        } else {
            try values.encodeNil(forKey: .baseRequirementId)
        }
        try values.encode(sourceMaterials, forKey: .sourceMaterials)
        try values.encode(fiscalYearEnd, forKey: .fiscalYearEnd)
        try values.encode(latestRequiredAnnualPeriodEnd, forKey: .latestRequiredAnnualPeriodEnd)
        try values.encode(latestRequiredInterimPeriodStart, forKey: .latestRequiredInterimPeriodStart)
        try values.encode(latestRequiredInterimPeriodEnd, forKey: .latestRequiredInterimPeriodEnd)
        try values.encode(asOf, forKey: .asOf)
        try values.encode(nextReviewAt, forKey: .nextReviewAt)
        try values.encode(ownerConfirmed, forKey: .ownerConfirmed)
        try values.encode(idempotencyKey, forKey: .idempotencyKey)
    }
}

public enum ResearchFinancialRequirementClientError: Error, Equatable, Sendable {
    case httpStatus(Int)
    case invalidResponse
}

extension ResearchClient {
    public func fetchResearchFinancialRequirement(
        membership: CandidateMembershipData
    ) async throws -> ResearchFinancialRequirementEnvelope {
        var request = URLRequest(url: researchFinancialRequirementURL(membership.id),
                                 cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ResearchFinancialRequirementClientError.invalidResponse
        }
        guard [200, 404, 503].contains(http.statusCode),
              let envelope = try? JSONDecoder().decode(ResearchFinancialRequirementEnvelope.self, from: data) else {
            throw ResearchFinancialRequirementClientError.httpStatus(http.statusCode)
        }
        try envelope.validate(expected: membership)
        guard (http.statusCode == 200 && envelope.status == "available")
            || (http.statusCode == 200 && envelope.status == "not_found")
            || (http.statusCode == 200 && envelope.status == "unavailable")
            || (http.statusCode == 404 && envelope.status == "not_found")
            || (http.statusCode == 503 && envelope.status == "unavailable") else {
            throw ResearchFinancialRequirementClientError.invalidResponse
        }
        return envelope
    }

    public func createResearchFinancialRequirementAndReadBack(
        membership: CandidateMembershipData,
        requestBody: CreateResearchFinancialRequirementRequest
    ) async throws -> ResearchFinancialRequirementEnvelope {
        var request = URLRequest(url: researchFinancialRequirementURL(membership.id))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(requestBody)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ResearchFinancialRequirementClientError.invalidResponse
        }
        guard 200..<300 ~= http.statusCode else {
            throw ResearchFinancialRequirementClientError.httpStatus(http.statusCode)
        }
        let write = try JSONDecoder().decode(ResearchWriteEnvelope<ResearchFinancialRequirementData>.self, from: data)
        guard write.status == "succeeded", write.source.actorType == "user",
              write.source.actorId == membership.actorId,
              write.data.validates(expected: membership),
              write.data.sources.count == requestBody.sourceMaterials.count,
              requestBody.sourceMaterials.allSatisfy({ expected in
                  write.data.sources.contains { $0.matches(expected) }
              }) else {
            throw ResearchFinancialRequirementClientError.invalidResponse
        }
        let fresh = try await fetchResearchFinancialRequirement(membership: membership)
        guard fresh.status == "available", fresh.data == write.data else {
            throw ResearchFinancialRequirementClientError.invalidResponse
        }
        return fresh
    }

    private func researchFinancialRequirementURL(_ membershipId: String) -> URL {
        candidateMembershipsURL(includeArchived: nil)
            .appending(path: membershipId).appending(path: "financial-requirement")
    }
}
