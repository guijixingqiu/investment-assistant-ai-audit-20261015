import Foundation

public struct FutuValuationCapture: Codable, Identifiable, Sendable {
    public let id: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let valuationType: String
    public let intervalType: String
    public let capturedAt: String
    public let providerUpdatedAt: String
    public let rawSha256: String
    public let byteLength: Int
    public let currentValue: Double
    public let historicalAverage: Double
    public let historicalPercentile: Double
    public let historicalCount: Int
    public let firstHistoricalDate: String
    public let lastHistoricalDate: String
    public let originalAvailability: String

    public func validates(_ member: CandidateMembershipData) -> Bool {
        researchDocumentIsPositiveIntegerString(id) && membershipId == member.id
            && membershipVersion > 0 && membershipVersion <= member.version && symbol == member.symbol
            && ["PE", "PB"].contains(valuationType) && intervalType == "YEAR_5"
            && rawSha256.isFrozenSHA256 && byteLength > 0 && byteLength <= 524_288
            && currentValue.isFinite && currentValue > 0 && historicalAverage.isFinite && historicalAverage > 0
            && historicalPercentile.isFinite && (0...100).contains(historicalPercentile)
            && (2...1600).contains(historicalCount)
            && ["available", "unavailable"].contains(originalAvailability)
    }
}

public struct FutuProviderValuationBasis: Codable, Equatable, Sendable {
    public struct EPS: Codable, Equatable, Sendable {
        public let financialCaptureId: String
        public let pageId: String
        public let rawSha256: String
        public let reportSha256: String
        public let periodEnd: String
        public let fiscalYear: Int
        public let accountingStandards: String
        public let capturedAt: String
        public let currencyCode: String
        public let basis: String
        public let fieldId: Int
        public let rawValue: String
    }
    public struct Valuation: Codable, Equatable, Sendable {
        public let captureId: String
        public let rawSha256: String
        public let valuationType: String
        public let intervalType: String
        public let capturedAt: String
        public let providerUpdatedAt: String
        public let currentValue: Double
        public let historicalAverage: Double
        public let historicalPercentile: Double
        public let historicalCount: Int
        public let firstHistoricalDate: String
        public let lastHistoricalDate: String
    }
    public let kind: String
    public let sourceClassification: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let sourceMaterialId: String
    public let sourceMaterialRevision: Int
    public let sourceMaterialFingerprint: String
    public let eps: EPS
    public let valuation: Valuation
    public let issuerOriginalVerification: String
    public let restatementComparability: String
    public let publicationTime: String
    public let currencyConversion: String
}

public struct FutuProviderValuationPreview: Codable, Equatable, Sendable {
    public struct Proposed: Codable, Equatable, Sendable {
        public struct Growth: Codable, Equatable, Sendable {
            public let fromYear: Int
            public let toYear: Int
            public let rate: Double
        }
        public let metricCurrency: String
        public let baseMetricPerShare: Double
        public let terminalMultipleReference: Double
        public let historicalEpsGrowthReferences: [Growth]
    }
    public let basis: FutuProviderValuationBasis
    public let sourceFingerprint: String
    public let methodId: String
    public let proposed: Proposed
    public let limitations: [String]
}

public struct ResearchProviderValuationScenarioSetData: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let membershipId: String
    public let membershipVersionAtWrite: Int
    public let symbol: String
    public let revision: Int
    public let replacesScenarioSetId: String?
    public let scenarioState: String
    public let recomputable: Bool
    public let invalidatedBy: [String]
    public let basisKind: String
    public let providerBasis: FutuProviderValuationBasis
    public let assumptions: ResearchValuationAssumptions
    public let calculation: ResearchValuationCalculation
    public let safety: ResearchValuationSafety
    public let createdAt: String

    public func validates(membership: CandidateMembershipData) -> Bool {
        var errors: [String] = []
        assumptions.values.validate(errors: &errors)
        guard errors.isEmpty, researchDocumentIsPositiveIntegerString(id), membershipId == membership.id,
            membershipVersionAtWrite > 0, membershipVersionAtWrite <= membership.version,
            symbol == membership.symbol, revision > 0, basisKind == "provider",
            providerBasis.kind == "provider", providerBasis.sourceClassification == "third_party_statement",
            providerBasis.membershipId == membership.id, providerBasis.symbol == membership.symbol,
            providerBasis.membershipVersion == membershipVersionAtWrite,
            researchDocumentIsPositiveIntegerString(providerBasis.sourceMaterialId),
            providerBasis.sourceMaterialFingerprint.isFrozenSHA256,
            providerBasis.eps.rawSha256.isFrozenSHA256, providerBasis.eps.reportSha256.isFrozenSHA256,
            providerBasis.valuation.rawSha256.isFrozenSHA256,
            ["basic", "diluted"].contains(providerBasis.eps.basis),
            providerBasis.valuation.valuationType == "PE", providerBasis.valuation.intervalType == "YEAR_5",
            providerBasis.eps.fieldId == (providerBasis.eps.basis == "basic" ? 5054 : 5055),
            Double(providerBasis.eps.rawValue).map({ $0.isFinite && $0 > 0 }) == true,
            providerBasis.sourceMaterialRevision > 0,
            researchDocumentIsPositiveIntegerString(providerBasis.eps.financialCaptureId),
            researchDocumentIsPositiveIntegerString(providerBasis.eps.pageId),
            researchDocumentIsPositiveIntegerString(providerBasis.valuation.captureId),
            providerBasis.eps.currencyCode == assumptions.values.metricCurrency,
            providerBasis.issuerOriginalVerification == "UNKNOWN",
            providerBasis.restatementComparability == "UNKNOWN",
            providerBasis.publicationTime == "UNKNOWN", providerBasis.currencyConversion == "NONE",
            assumptions.authority == "owner", assumptions.derivation == "provider_reference_owner_confirmed",
            calculation.method.id == "discounted_forward_metric_multiple_user_scenario",
            calculation.method.applicability == nil,
            calculation.scenarioPresentValuePerShare.isFinite,
            safety.advisoryOnly && !safety.forecast && !safety.recommendation && !safety.automaticSignal,
            !safety.createsOrder && !safety.callsBroker && !safety.mutatesOfficialPortfolio,
            ["current", "replaced"].contains(scenarioState),
            recomputable == invalidatedBy.isEmpty else { return false }
        return true
    }
}

/// Resolve the current revision by the complete saved basis, including the EPS period and basic/diluted field.
public func currentFutuProviderValuationScenario(
    basis: FutuProviderValuationBasis,
    scenarios: [ResearchProviderValuationScenarioSetData],
    expectedId: String?
) throws -> ResearchProviderValuationScenarioSetData? {
    let matching = scenarios.filter { $0.providerBasis == basis }
    let current = matching.filter { $0.scenarioState == "current" }
    guard current.count <= 1,
        current.first.map({ $0.recomputable && $0.invalidatedBy.isEmpty }) ?? matching.isEmpty,
        expectedId == nil || current.first?.id == expectedId else {
        throw ResearchValuationScenarioClientError.httpStatus(409)
    }
    return current.first
}

public struct CreateFutuProviderValuationScenarioRequest: Encodable, Equatable, Sendable {
    private enum CodingKeys: String, CodingKey {
        case membershipVersion, symbol, financialCaptureId, annualPeriodEnd, epsBasis
        case valuationCaptureId, sourceMaterialId, proposalFingerprint, replacesScenarioSetId
        case assumptions, ownerConfirmed, idempotencyKey
    }
    public let membershipVersion: Int
    public let symbol: String
    public let financialCaptureId: String
    public let annualPeriodEnd: String
    public let epsBasis: String
    public let valuationCaptureId: String
    public let sourceMaterialId: String
    public let proposalFingerprint: String
    public let replacesScenarioSetId: String?
    public let assumptions: AnnualValuationScenarioInput
    public let ownerConfirmed: Bool
    public let idempotencyKey: String

    public func encode(to encoder: Encoder) throws {
        var body = encoder.container(keyedBy: CodingKeys.self)
        try body.encode(membershipVersion, forKey: .membershipVersion)
        try body.encode(symbol, forKey: .symbol)
        try body.encode(financialCaptureId, forKey: .financialCaptureId)
        try body.encode(annualPeriodEnd, forKey: .annualPeriodEnd)
        try body.encode(epsBasis, forKey: .epsBasis)
        try body.encode(valuationCaptureId, forKey: .valuationCaptureId)
        try body.encode(sourceMaterialId, forKey: .sourceMaterialId)
        try body.encode(proposalFingerprint, forKey: .proposalFingerprint)
        if let replacesScenarioSetId {
            try body.encode(replacesScenarioSetId, forKey: .replacesScenarioSetId)
        } else {
            try body.encodeNil(forKey: .replacesScenarioSetId)
        }
        try body.encode(assumptions, forKey: .assumptions)
        try body.encode(ownerConfirmed, forKey: .ownerConfirmed)
        try body.encode(idempotencyKey, forKey: .idempotencyKey)
    }

    public func encodedBody() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }
}

/// One unresolved Owner confirmation. Retain its exact request until a verified readback or an explicit new intent.
public struct FutuProviderValuationPendingRequest: Equatable, Sendable {
    public let membershipId: String
    public let body: CreateFutuProviderValuationScenarioRequest

    public init(membershipId: String, body: CreateFutuProviderValuationScenarioRequest) {
        self.membershipId = membershipId
        self.body = body
    }

    public func matches(membershipId: String, membershipVersion: Int, symbol: String,
        preview: FutuProviderValuationPreview, assumptions: AnnualValuationScenarioInput) -> Bool {
        self.membershipId == membershipId && body.membershipVersion == membershipVersion
            && body.symbol == symbol && body.financialCaptureId == preview.basis.eps.financialCaptureId
            && body.annualPeriodEnd == preview.basis.eps.periodEnd
            && body.epsBasis == preview.basis.eps.basis
            && body.valuationCaptureId == preview.basis.valuation.captureId
            && body.sourceMaterialId == preview.basis.sourceMaterialId
            && body.proposalFingerprint == preview.sourceFingerprint
            && body.assumptions == assumptions && body.ownerConfirmed
    }
}

/// Only an explicit rejection of the first POST proves this save did not commit.
/// A later readback failure or any replay response leaves the original result unresolved.
public enum FutuProviderValuationSaveError: Error, Equatable, Sendable {
    case postRejected(Int)

    public func confirmsNoWrite(priorAttempt: Bool) -> Bool {
        guard case .postRejected(let status) = self, !priorAttempt else { return false }
        // A timeout/rate-limit or server failure may follow a committed write.
        return (400..<500).contains(status) && status != 408 && status != 429
    }
}

private struct ProviderResult<T: Decodable>: Decodable { let ok: Bool; let data: T }
private struct ProviderCaptureRequest: Encodable { let membershipVersion: Int; let valuationType: String; let idempotencyKey: String }

extension ResearchClient {
    private func valuationCapturesURL(_ member: CandidateMembershipData) -> URL {
        baseURL.appending(path: "api").appending(path: "mobile").appending(path: "research")
            .appending(path: "candidate-memberships").appending(path: member.id)
            .appending(path: "futu-valuation-captures")
    }
    private func valuationScenariosURL(_ member: CandidateMembershipData) -> URL {
        baseURL.appending(path: "api").appending(path: "mobile").appending(path: "research")
            .appending(path: "candidate-memberships").appending(path: member.id)
            .appending(path: "valuation-scenarios")
    }
    private func checkProviderResponse(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw ResearchValuationScenarioClientError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw ResearchValuationScenarioClientError.httpStatus(http.statusCode) }
    }
    public func listFutuValuationCaptures(membership: CandidateMembershipData) async throws -> [FutuValuationCapture] {
        var request = URLRequest(url: valuationCapturesURL(membership), cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (bytes,response) = try await session.data(for: request)
        try checkProviderResponse(response)
        let result = try JSONDecoder().decode(ProviderResult<[FutuValuationCapture]>.self, from: bytes)
        guard result.ok && result.data.allSatisfy({ $0.validates(membership) }) else { throw ResearchValuationScenarioClientError.invalidResponse }
        return result.data
    }
    public func captureFutuValuation(membership: CandidateMembershipData, type: String, key: String) async throws -> FutuValuationCapture {
        var request = URLRequest(url: valuationCapturesURL(membership))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(ProviderCaptureRequest(membershipVersion: membership.version,
            valuationType: type, idempotencyKey: key))
        let (bytes,response) = try await session.data(for: request)
        try checkProviderResponse(response)
        let result = try JSONDecoder().decode(ProviderResult<FutuValuationCapture>.self, from: bytes)
        guard result.ok, result.data.validates(membership), result.data.membershipVersion == membership.version,
            result.data.valuationType == type else { throw ResearchValuationScenarioClientError.invalidResponse }
        return result.data
    }
    public func previewFutuProviderValuation(membership: CandidateMembershipData, financialCaptureId: String,
        annualPeriodEnd: String, epsBasis: String, valuationCaptureId: String,
        sourceMaterialId: String) async throws -> FutuProviderValuationPreview {
        let url = valuationScenariosURL(membership).appending(path: "provider-preview").appending(queryItems: [
            URLQueryItem(name: "financialCaptureId", value: financialCaptureId),
            URLQueryItem(name: "annualPeriodEnd", value: annualPeriodEnd),
            URLQueryItem(name: "epsBasis", value: epsBasis),
            URLQueryItem(name: "valuationCaptureId", value: valuationCaptureId),
            URLQueryItem(name: "sourceMaterialId", value: sourceMaterialId)])
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (bytes,response) = try await session.data(for: request)
        try checkProviderResponse(response)
        let result = try JSONDecoder().decode(ProviderResult<FutuProviderValuationPreview>.self, from: bytes)
        guard result.ok, result.data.sourceFingerprint.isFrozenSHA256,
            result.data.basis.membershipId == membership.id,
            result.data.basis.symbol == membership.symbol,
            result.data.basis.eps.financialCaptureId == financialCaptureId,
            result.data.basis.eps.periodEnd == annualPeriodEnd,
            result.data.basis.eps.basis == epsBasis,
            result.data.basis.valuation.captureId == valuationCaptureId,
            result.data.basis.sourceMaterialId == sourceMaterialId,
            result.data.proposed.metricCurrency == result.data.basis.eps.currencyCode else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        return result.data
    }
    public func saveFutuProviderValuationAndReadBack(membership: CandidateMembershipData,
        body: CreateFutuProviderValuationScenarioRequest,
        readbackMembership: CandidateMembershipData? = nil) async throws -> ResearchValuationScenariosEnvelope {
        let readbackMember = readbackMembership ?? membership
        guard readbackMember.id == membership.id, readbackMember.actorId == membership.actorId,
            readbackMember.symbol == membership.symbol,
            readbackMember.version >= membership.version else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        var request = URLRequest(url: valuationScenariosURL(membership).appending(path: "provider"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try body.encodedBody()
        let (bytes,response) = try await session.data(for: request)
        do {
            try checkProviderResponse(response)
        } catch ResearchValuationScenarioClientError.httpStatus(let status) {
            throw FutuProviderValuationSaveError.postRejected(status)
        }
        let write = try JSONDecoder().decode(ResearchWriteEnvelope<ResearchProviderValuationScenarioSetData>.self, from: bytes)
        guard write.status == "succeeded", write.data.validates(membership: membership),
            write.data.recomputable, write.data.providerBasis.eps.financialCaptureId == body.financialCaptureId,
            write.data.providerBasis.valuation.captureId == body.valuationCaptureId,
            write.data.providerBasis.eps.periodEnd == body.annualPeriodEnd,
            write.data.providerBasis.eps.basis == body.epsBasis,
            write.data.providerBasis.sourceMaterialId == body.sourceMaterialId,
            write.data.replacesScenarioSetId == body.replacesScenarioSetId,
            (body.replacesScenarioSetId == nil ? write.data.revision == 1 : write.data.revision > 1),
            write.data.assumptions.values == body.assumptions else { throw ResearchValuationScenarioClientError.invalidResponse }
        let fresh = try await fetchResearchValuationScenarios(membership: readbackMember)
        guard fresh.providerScenarioSets?.contains(where: { saved in
            saved.id == write.data.id && saved.membershipId == write.data.membershipId
                && saved.membershipVersionAtWrite == write.data.membershipVersionAtWrite
                && saved.symbol == write.data.symbol && saved.revision == write.data.revision
                && saved.replacesScenarioSetId == write.data.replacesScenarioSetId
                && saved.basisKind == write.data.basisKind
                && saved.providerBasis == write.data.providerBasis
                && saved.assumptions == write.data.assumptions
                && saved.calculation == write.data.calculation
                && saved.safety == write.data.safety && saved.createdAt == write.data.createdAt
        }) == true else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        if let priorId = body.replacesScenarioSetId {
            guard let prior = fresh.providerScenarioSets?.first(where: { $0.id == priorId }),
                prior.scenarioState == "replaced", prior.revision + 1 == write.data.revision,
                prior.providerBasis == write.data.providerBasis else {
                throw ResearchValuationScenarioClientError.invalidResponse
            }
        }
        return fresh
    }
}
