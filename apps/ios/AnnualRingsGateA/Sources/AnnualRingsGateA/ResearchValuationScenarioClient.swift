import Foundation

private struct FcffPreviewEnvelope: Decodable {
    let ok: Bool
    let data: FcffSourcePreview
}
private struct FcffProviderReferenceEnvelope: Decodable {
    let ok: Bool
    let data: FcffProviderReference
}

public struct ResearchValuationScenarioRequestLanes: Equatable, Sendable {
    public private(set) var loadRevision = UUID()
    public private(set) var saveRevision = UUID()
    public private(set) var presentationRevision = UUID()
    public private(set) var isLoading = false
    public private(set) var isSaving = false

    public init() {}

    public var isBusy: Bool { isLoading || isSaving }

    public mutating func beginLoad() -> UUID {
        let revision = UUID()
        loadRevision = revision
        presentationRevision = revision
        isLoading = true
        return revision
    }

    public mutating func beginSave() -> UUID {
        let revision = UUID()
        saveRevision = revision
        presentationRevision = revision
        isSaving = true
        return revision
    }

    public func acceptsLoad(_ revision: UUID) -> Bool {
        loadRevision == revision && presentationRevision == revision
    }

    public func acceptsSave(_ revision: UUID) -> Bool {
        saveRevision == revision && presentationRevision == revision
    }

    public mutating func finishLoad(_ revision: UUID) {
        if loadRevision == revision { isLoading = false }
    }

    public mutating func finishSave(_ revision: UUID) {
        if saveRevision == revision { isSaving = false }
    }

    public mutating func reset() {
        let revision = UUID()
        loadRevision = revision
        saveRevision = revision
        presentationRevision = revision
        isLoading = false
        isSaving = false
    }
}

extension ResearchClient {
    public func fetchFcffProviderReference(membership: CandidateMembershipData,
                                           selection: FcffProviderSelection) async throws -> FcffProviderReference {
        var components = URLComponents(url: researchValuationScenariosURL(membershipId: membership.id)
            .appending(path: "fcff-provider-reference"), resolvingAgainstBaseURL: false)
        let encoded = try JSONEncoder().encode(selection)
        guard let selectionJSON = String(data: encoded, encoding: .utf8) else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        components?.queryItems = [URLQueryItem(name: "selection", value: selectionJSON)]
        guard let url = components?.url else { throw ResearchValuationScenarioClientError.invalidResponse }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateResearchValuationScenarioResponse(response)
        let envelope = try JSONDecoder().decode(FcffProviderReferenceEnvelope.self, from: data)
        guard envelope.ok, envelope.data.validates(membership: membership, selection: selection) else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        return envelope.data
    }

    public func createProviderFcffScenarioAndReadBack(membership: CandidateMembershipData,
        requestBody: CreateResearchProviderFcffScenarioRequest) async throws
        -> (envelope: ResearchValuationScenariosEnvelope, saved: ResearchProviderFcffScenarioSetData) {
        var request = URLRequest(url: researchValuationScenariosURL(membershipId: membership.id)
            .appending(path: "fcff"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(requestBody)
        let (data, response) = try await session.data(for: request)
        try validateResearchValuationScenarioResponse(response)
        let write = try JSONDecoder().decode(ResearchWriteEnvelope<ResearchProviderFcffScenarioSetData>.self,
            from: data)
        guard write.status == "succeeded", write.source.actorType == "user",
              write.source.actorId == membership.actorId,
              write.data.membershipId == membership.id,
              write.data.membershipVersionAtWrite == membership.version,
              write.data.providerReference.sourceFingerprint == requestBody.sourceFingerprint,
              write.data.assumptions.values == requestBody.assumptions,
              write.data.assumptions.bridgeReasons == requestBody.bridgeReasons,
              write.data.replacesScenarioSetId == requestBody.replacesScenarioSetId,
              write.data.validates(membership: membership) else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        let fresh = try await fetchResearchValuationScenarios(membership: membership)
        guard let saved = fresh.providerFcffScenarioSets?.first(where: {
            $0.id == write.data.id && $0.revision == write.data.revision
                && $0.providerReference == write.data.providerReference
                && $0.assumptions == write.data.assumptions
                && $0.calculation == write.data.calculation
        }) else { throw ResearchValuationScenarioClientError.invalidResponse }
        return (fresh, saved)
    }

    public func fetchResearchValuationScenarios(
        membership: CandidateMembershipData
    ) async throws -> ResearchValuationScenariosEnvelope {
        var request = URLRequest(
            url: researchValuationScenariosURL(membershipId: membership.id),
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateResearchValuationScenarioResponse(response)
        try validateResearchValuationScenariosRawShape(data)
        let envelope = try JSONDecoder().decode(ResearchValuationScenariosEnvelope.self, from: data)
        return try envelope.validated(expected: membership)
    }

    public func fetchResearchValuationIssuerBasis(
        membership: CandidateMembershipData, anchorValueId: String
    ) async throws -> ResearchValuationIssuerBasisPreview {
        var components = URLComponents(url: researchValuationScenariosURL(membershipId: membership.id)
            .appending(path: "issuer-basis"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "anchorValueId", value: anchorValueId)]
        guard let url = components?.url else { throw ResearchValuationScenarioClientError.invalidResponse }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateResearchValuationScenarioResponse(response)
        return try JSONDecoder().decode(ResearchValuationIssuerBasisPreview.self, from: data)
            .validated(membership: membership, anchorValueId: anchorValueId)
    }

    public func fetchFcffSourcePreview(membership: CandidateMembershipData,
                                       selection: FcffSourceSelection) async throws -> FcffSourcePreview {
        var components = URLComponents(url: researchValuationScenariosURL(membershipId: membership.id)
            .appending(path: "fcff-source-preview"), resolvingAgainstBaseURL: false)
        let selectionData = try JSONEncoder().encode(selection)
        guard let selectionJSON = String(data: selectionData, encoding: .utf8) else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        components?.queryItems = [URLQueryItem(name: "selection", value: selectionJSON)]
        guard let url = components?.url else { throw ResearchValuationScenarioClientError.invalidResponse }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateResearchValuationScenarioResponse(response)
        let envelope = try JSONDecoder().decode(FcffPreviewEnvelope.self, from: data)
        guard envelope.ok, envelope.data.membershipId == membership.id,
              envelope.data.membershipVersion == membership.version,
              envelope.data.symbol == membership.symbol,
              envelope.data.historicalAnnualPeriodEnd == selection.historicalAnnualPeriodEnd,
              envelope.data.balanceReferenceDate == selection.balanceReferenceDate else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        return envelope.data
    }

    public func createFcffScenarioAndReadBack(membership: CandidateMembershipData,
                                              requestBody: CreateResearchFcffScenarioRequest) async throws
        -> (envelope: ResearchValuationScenariosEnvelope, saved: ResearchFcffScenarioSetData) {
        var request = URLRequest(url: researchValuationScenariosURL(membershipId: membership.id)
            .appending(path: "fcff"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(requestBody)
        let (data, response) = try await session.data(for: request)
        try validateResearchValuationScenarioResponse(response)
        let write = try JSONDecoder().decode(ResearchWriteEnvelope<ResearchFcffScenarioSetData>.self, from: data)
        guard write.status == "succeeded", write.source.actorType == "user",
              write.source.actorId == membership.actorId,
              write.data.membershipId == membership.id,
              write.data.membershipVersionAtWrite == membership.version,
              write.data.symbol == membership.symbol,
              write.data.replacesScenarioSetId == requestBody.replacesScenarioSetId,
              write.data.sourceSelection == requestBody.sourceSelection,
              write.data.sourceFingerprint == requestBody.sourceFingerprint,
              write.data.assumptions.values == requestBody.assumptions,
              write.data.assumptions.bridgeClassification == requestBody.bridgeClassification,
              write.data.validates(membership: membership) else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        let fresh: ResearchValuationScenariosEnvelope
        do { fresh = try await fetchResearchValuationScenarios(membership: membership) }
        catch { throw ResearchValuationScenarioClientError.invalidResponse }
        guard let saved = fresh.fcffScenarioSets?.first(where: {
            $0.id == write.data.id && $0.revision == write.data.revision
                && $0.membershipId == membership.id
                && $0.membershipVersionAtWrite == requestBody.membershipVersion
                && $0.symbol == requestBody.symbol
                && $0.replacesScenarioSetId == requestBody.replacesScenarioSetId
                && $0.sourceSelection == requestBody.sourceSelection
                && $0.sourceFingerprint == requestBody.sourceFingerprint
                && $0.assumptions.values == requestBody.assumptions
                && $0.assumptions.bridgeClassification == requestBody.bridgeClassification
                && $0.historicalOriginals == write.data.historicalOriginals
                && $0.calculation == write.data.calculation
        }) else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        return (fresh, saved)
    }

    public func createResearchValuationScenarioAndReadBack(
        membership: CandidateMembershipData,
        requestBody: CreateResearchValuationScenarioRequest
    ) async throws -> ResearchValuationScenariosEnvelope {
        var request = URLRequest(url: researchValuationScenariosURL(membershipId: membership.id))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(requestBody)
        let (data, response) = try await session.data(for: request)
        try validateResearchValuationScenarioResponse(response)
        try validateResearchValuationScenarioWriteRawShape(data)
        let write = try JSONDecoder().decode(
            ResearchWriteEnvelope<ResearchValuationScenarioSetData>.self,
            from: data
        )
        guard write.schemaVersion == "2026-06-18.research-write.v1",
              write.status == "succeeded",
              write.source.actorType == "user",
              write.source.actorId == membership.actorId,
              write.data.membershipId == membership.id,
              write.data.membershipVersionAtWrite == requestBody.membershipVersion,
              write.data.symbol == membership.symbol,
              write.data.anchor.id == requestBody.anchorValueId,
              write.data.replacesScenarioSetId == requestBody.replacesScenarioSetId,
              write.data.assumptions.values == requestBody.assumptions,
              write.data.calculation.issuerBasis == requestBody.issuerBasis else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        let historicalReplay = write.data.anchorOriginalAvailability == nil
        if !historicalReplay && (write.data.scenarioState != "current"
            || !write.data.recomputable || !write.data.invalidatedBy.isEmpty
            || write.data.anchorOriginalAvailability != "available") {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        let fresh = try await fetchResearchValuationScenarios(membership: membership)
        guard fresh.scenarioSets.contains(where: {
            $0.id == write.data.id
                && $0.revision == write.data.revision
                && $0.anchor.id == requestBody.anchorValueId
                && $0.replacesScenarioSetId == requestBody.replacesScenarioSetId
                && $0.assumptions.values == requestBody.assumptions
                && $0.calculation.issuerBasis == requestBody.issuerBasis
                && (historicalReplay || $0.scenarioState == "current"
                    && $0.recomputable && $0.invalidatedBy.isEmpty
                    && $0.anchorOriginalAvailability == "available")
        }) else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        return fresh
    }

    private func researchValuationScenariosURL(membershipId: String) -> URL {
        baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "candidate-memberships")
            .appending(path: membershipId)
            .appending(path: "valuation-scenarios")
    }

    private func validateResearchValuationScenarioResponse(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        guard 200..<300 ~= http.statusCode else {
            throw ResearchValuationScenarioClientError.httpStatus(http.statusCode)
        }
    }
}

private func validateResearchValuationScenariosRawShape(_ data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw ResearchValuationScenarioClientError.invalidResponse
    }
    var errors: [String] = []
    valuationExactKeys(
        root,
        [
            "schemaVersion", "generatedAt", "status", "requestedActorId", "membershipId",
            "membershipVersion", "membershipState", "symbol", "fundamentalsSchemaVersion",
            "scenarioSets"
        ],
        "valuation scenarios",
        &errors,
        optionalKeys: ["providerScenarioSets", "fcffScenarioSets", "providerFcffScenarioSets"]
    )
    guard let scenarios = root["scenarioSets"] as? [Any] else {
        throw ResearchValuationScenarioClientError.invalidResponse
    }
    for (index, scenario) in scenarios.enumerated() {
        valuationScenarioRawShape(scenario, label: "scenarioSets[\(index)]", errors: &errors)
    }
    if let provider = root["providerScenarioSets"] {
        guard let providerSets = provider as? [[String: Any]] else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        for item in providerSets {
            valuationExactKeys(item, ["id", "membershipId", "membershipVersionAtWrite", "symbol", "revision",
                "replacesScenarioSetId", "scenarioState", "recomputable", "invalidatedBy", "basisKind",
                "providerBasis", "assumptions", "calculation", "safety", "createdAt"],
                "provider valuation scenario", &errors)
        }
    }
    if let fcff = root["fcffScenarioSets"] {
        guard let sets = fcff as? [[String: Any]] else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        for item in sets {
            valuationExactKeys(item, ["id", "membershipId", "membershipVersionAtWrite", "symbol",
                "revision", "replacesScenarioSetId", "scenarioState", "recomputable", "invalidatedBy",
                "sourceSelection", "sourceFingerprint", "historicalOriginals", "assumptions",
                "calculation", "safety", "createdAt"], "FCFF scenario", &errors)
        }
    }
    if let providerFcff = root["providerFcffScenarioSets"] {
        guard let sets = providerFcff as? [[String: Any]] else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        for item in sets {
            valuationExactKeys(item, ["id", "membershipId", "membershipVersionAtWrite", "symbol",
                "revision", "replacesScenarioSetId", "scenarioState", "recomputable", "invalidatedBy",
                "providerReference", "assumptions", "calculation", "safety", "createdAt"],
                "provider FCFF scenario", &errors)
        }
    }
    if !errors.isEmpty { throw ResearchValuationScenarioClientError.invalidResponse }
}

private func validateResearchValuationScenarioWriteRawShape(_ data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw ResearchValuationScenarioClientError.invalidResponse
    }
    var errors: [String] = []
    valuationExactKeys(
        root,
        ["schemaVersion", "status", "asOf", "source", "data", "message"],
        "valuation scenario write",
        &errors
    )
    valuationExactObject(
        root["source"],
        ["actorType", "actorId", "correlationId"],
        "valuation scenario write source",
        &errors
    )
    valuationScenarioRawShape(root["data"], label: "valuation scenario write data", errors: &errors,
        historicalReplay: true)
    if !errors.isEmpty { throw ResearchValuationScenarioClientError.invalidResponse }
}

private func valuationScenarioRawShape(
    _ value: Any?,
    label: String,
    errors: inout [String],
    historicalReplay: Bool = false
) {
    guard let scenario = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    let required: Set<String> = [
            "id", "membershipId", "membershipVersionAtWrite", "symbol", "revision",
            "replacesScenarioSetId", "scenarioState", "recomputable", "invalidatedBy",
            "anchor", "anchorOriginalAvailability", "assumptions", "calculation", "safety", "createdAt"
        ]
    valuationExactKeys(
        scenario,
        historicalReplay ? required.subtracting(["anchorOriginalAvailability"]) : required,
        label,
        &errors,
        optionalKeys: historicalReplay ? ["pairedAnchor", "anchorOriginalAvailability", "issuerBasisCurrentness"]
            : ["pairedAnchor", "issuerBasisCurrentness"]
    )
    valuationAnchorRawShape(scenario["anchor"], label: "\(label).anchor", errors: &errors)
    if let paired = scenario["pairedAnchor"], !(paired is NSNull) {
        valuationAnchorRawShape(paired, label: "\(label).pairedAnchor", errors: &errors)
    }
    valuationExactObject(
        scenario["assumptions"],
        ["authority", "derivation", "values"],
        "\(label).assumptions",
        &errors
    )
    if let assumptions = scenario["assumptions"] as? [String: Any] {
        valuationExactObject(
            assumptions["values"],
            [
                "baseMetricPerShare", "annualGrowthRate", "horizonYears", "terminalMultiple",
                "annualDiscountRate", "netCashPerShare", "growthRateStep", "multipleStep"
            ],
            "\(label).assumptions.values",
            &errors,
            optionalKeys: ["methodId", "metricCurrency", "shareBasis"]
        )
    }
    valuationCalculationRawShape(scenario["calculation"], label: "\(label).calculation", errors: &errors)
    valuationExactObject(
        scenario["safety"],
        [
            "advisoryOnly", "forecast", "recommendation", "automaticSignal", "createsOrder",
            "callsBroker", "mutatesOfficialPortfolio"
        ],
        "\(label).safety",
        &errors
    )
}

private func valuationAnchorRawShape(_ value: Any?, label: String, errors: inout [String]) {
    valuationExactObject(
        value,
        [
            "id", "membershipId", "membershipVersionAtWrite", "symbol", "metric",
            "periodKind", "periodStart", "periodEnd", "currency", "unitScale", "scope",
            "valueStatus", "value", "comparability", "comparabilityReason", "amendmentKind",
            "replacesValueId", "revision", "valueState", "provenance", "source", "createdAt",
            "anchorRole"
        ],
        label,
        &errors
    )
    if let anchor = value as? [String: Any] {
        valuationExactObject(
            anchor["provenance"],
            ["factKind", "transcription", "verificationStatus"],
            "\(label).provenance",
            &errors
        )
        let common = ["materialId", "materialRevision", "materialRevisionState", "validUntil",
            "freshness", "materialSourceVersion"]
        let sourceOptions = ["sourceClassification", "verificationStatus", "publishedAt"]
        if let source = anchor["source"] as? [String: Any], source["kind"] as? String == "source_snapshot" {
            valuationExactObject(source, Set(common + ["kind", "snapshotCitation", "snapshotOriginal",
                "snapshotReviewState", "originalAvailability"]), "\(label).source", &errors,
                optionalKeys: Set(sourceOptions))
            valuationExactObject(source["snapshotCitation"], ["kind", "snapshotId", "textSha256",
                "startUtf16", "endUtf16", "excerptSha256"], "\(label).source.snapshotCitation", &errors)
            valuationExactObject(source["snapshotOriginal"], ["rawSha256", "byteLength", "mediaType",
                "canonicalUrl", "responseUrl"], "\(label).source.snapshotOriginal", &errors)
        } else {
            valuationExactObject(anchor["source"], Set(common + ["documentId", "documentPdfSha256",
                "pageNumber", "pageTextSha256"]), "\(label).source", &errors,
                optionalKeys: Set(sourceOptions))
        }
    }
}

private func valuationCalculationRawShape(
    _ value: Any?,
    label: String,
    errors: inout [String]
) {
    guard let calculation = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    valuationExactKeys(
        calculation,
        ["method", "projectedMetricPerShare", "scenarioPresentValuePerShare", "diagonal", "matrix"],
        label,
        &errors,
        optionalKeys: ["valueRange", "issuerBasis"]
    )
    if let basis = calculation["issuerBasis"] {
        valuationExactObject(basis, ["kind", "schemaVersion", "assetValueId", "liabilityValueId",
            "shareValueIds", "sharesContextId", "sourceFingerprint", "proposedBaseMetricPerShare",
            "adoptionMode", "ownerOverrideReason", "ordinaryEquityOwnerConfirmed"],
            "\(label).issuerBasis", &errors)
    }
    valuationExactObject(
        calculation["method"],
        ["id", "calculationVersion", "presentValueFormula", "rounding"],
        "\(label).method",
        &errors,
        optionalKeys: ["applicability"]
    )
    if let method = calculation["method"] as? [String: Any],
       let applicability = method["applicability"] {
        valuationExactObject(
            applicability,
            ["ownerConfirmed", "companyDataBasis", "requiredAnchorMetrics", "limitation"],
            "\(label).method.applicability",
            &errors,
            optionalKeys: ["pairedAnchorValueId"]
        )
    }
    if let valueRange = calculation["valueRange"] {
        valuationExactObject(
            valueRange,
            ["low", "high", "interpretation"],
            "\(label).valueRange",
            &errors
        )
    }
    valuationExactObject(
        calculation["matrix"],
        ["growthRates", "terminalMultiples", "cells"],
        "\(label).matrix",
        &errors
    )
    valuationExactArrayObjects(
        calculation["diagonal"],
        ["scenario", "annualGrowthRate", "terminalMultiple", "presentValuePerShare"],
        "\(label).diagonal",
        &errors
    )
    if let matrix = calculation["matrix"] as? [String: Any] {
        valuationExactArrayObjects(
            matrix["cells"],
            ["annualGrowthRate", "terminalMultiple", "presentValuePerShare"],
            "\(label).matrix.cells",
            &errors
        )
    }
}

private func valuationExactObject(
    _ value: Any?,
    _ keys: Set<String>,
    _ label: String,
    _ errors: inout [String],
    optionalKeys: Set<String> = []
) {
    guard let object = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    valuationExactKeys(object, keys, label, &errors, optionalKeys: optionalKeys)
}

private func valuationExactArrayObjects(
    _ value: Any?,
    _ keys: Set<String>,
    _ label: String,
    _ errors: inout [String]
) {
    guard let array = value as? [Any] else {
        errors.append("\(label) must be an array")
        return
    }
    for (index, item) in array.enumerated() {
        valuationExactObject(item, keys, "\(label)[\(index)]", &errors)
    }
}

private func valuationExactKeys(
    _ value: [String: Any],
    _ keys: Set<String>,
    _ label: String,
    _ errors: inout [String],
    optionalKeys: Set<String> = []
) {
    let actual = Set(value.keys)
    if !keys.isSubset(of: actual) || !actual.isSubset(of: keys.union(optionalKeys)) {
        errors.append("\(label) fields are invalid")
    }
}
