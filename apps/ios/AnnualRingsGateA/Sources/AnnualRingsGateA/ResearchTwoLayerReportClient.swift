import Foundation
public struct TwoLayerReportRequestLanes: Equatable, Sendable {
    public private(set) var loadRevision = UUID()
    public private(set) var saveRevision = UUID()
    public private(set) var decisionRevision = UUID()
    public private(set) var presentationRevision = UUID()
    public private(set) var revisionOperationId = UUID()
    public private(set) var isLoading = false
    public private(set) var isSaving = false
    public private(set) var isDeciding = false
    public init() {}
    public var isBusy: Bool { isLoading || isSaving || isDeciding }
    public mutating func beginLoad(preservingRevisionOperation operationId: UUID? = nil) -> UUID {
        if operationId == nil { revisionOperationId = UUID() }
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
    public mutating func beginDecision() -> UUID {
        let revision = UUID()
        decisionRevision = revision
        presentationRevision = revision
        isDeciding = true
        return revision
    }
    public mutating func beginRevisionOperation() -> UUID {
        let operationId = UUID()
        revisionOperationId = operationId
        return operationId
    }
    public func acceptsLoad(_ revision: UUID) -> Bool {
        loadRevision == revision && presentationRevision == revision
    }
    public func acceptsSave(_ revision: UUID) -> Bool {
        saveRevision == revision && presentationRevision == revision
    }

    public func acceptsDecision(_ revision: UUID) -> Bool {
        decisionRevision == revision && presentationRevision == revision
    }

    public func acceptsRevisionOperation(_ operationId: UUID) -> Bool {
        revisionOperationId == operationId
    }
    public mutating func finishLoad(_ revision: UUID) {
        if loadRevision == revision { isLoading = false }
    }

    public mutating func finishSave(_ revision: UUID) {
        if saveRevision == revision { isSaving = false }
    }

    public mutating func finishDecision(_ revision: UUID) {
        if decisionRevision == revision { isDeciding = false }
    }
    public mutating func reset() {
        loadRevision = UUID()
        saveRevision = UUID()
        decisionRevision = UUID()
        presentationRevision = UUID()
        revisionOperationId = UUID()
        isLoading = false
        isSaving = false
        isDeciding = false
    }
}

extension ResearchClient {
    public func createOwnerCorrectionMaterialAndReadBack(
        membership: CandidateMembershipData,
        requestBody: OwnerReportCorrectionMaterialRequest
    ) async throws -> (
        workspace: FrozenResearchEvidenceWorkspace,
        material: ResearchMaterialData
    ) {
        try await createMaterialAndReadBack(membership: membership, requestBody: requestBody)
    }

    public func createPriorJudgmentMaterialAndReadBack(
        membership: CandidateMembershipData,
        requestBody: CreateResearchMaterialRequest
    ) async throws -> (
        workspace: FrozenResearchEvidenceWorkspace,
        material: ResearchMaterialData
    ) {
        guard requestBody.sourceType == "owner_prior_judgment_note",
              requestBody.priorDecisionBinding?.ownerConfirmedNonSensitive == true,
              requestBody.ownerCorrectionBinding == nil,
              requestBody.assistantCorrectionBinding == nil,
              requestBody.summary == requestBody.contentText else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return try await createMaterialAndReadBack(membership: membership, requestBody: requestBody)
    }

    private func createMaterialAndReadBack(
        membership: CandidateMembershipData,
        requestBody: CreateResearchMaterialRequest
    ) async throws -> (
        workspace: FrozenResearchEvidenceWorkspace,
        material: ResearchMaterialData
    ) {
        let material = try await createResearchMaterial(
            membership: membership,
            requestBody: requestBody
        )
        let fresh = try await fetchFrozenResearchEvidence(membership: membership)
        guard fresh.data?.materials.first(where: { $0.id == material.id }) == material else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return (fresh, material)
    }

    public func createVerifiedResearchEventAndReadBack(
        membership: CandidateMembershipData,
        materialRequest: CreateResearchMaterialRequest,
        eventKind: String,
        coverageScope: String,
        monitorRuleBinding: ResearchMonitorRule?,
        eventIdempotencyKey: String
    ) async throws -> (
        workspace: FrozenResearchEvidenceWorkspace,
        material: ResearchMaterialData,
        event: ResearchAnnouncementEventData
    ) {
        guard ResearchEventCaptureDraft.supportedEventKinds.contains(eventKind),
              ["research_stock", "current_holding"].contains(coverageScope) else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        let material = try await createResearchMaterial(
            membership: membership,
            requestBody: materialRequest
        )
        let eventRequest = CreateResearchEventRequest(
            membershipVersion: membership.version,
            materialId: material.id,
            eventKind: eventKind,
            coverageScope: coverageScope,
            monitorRuleBinding: monitorRuleBinding,
            idempotencyKey: eventIdempotencyKey
        )
        let url = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "candidate-memberships")
            .appending(path: membership.id)
            .appending(path: "research-events")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(eventRequest)
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        let write = try JSONDecoder().decode(
            ResearchWriteEnvelope<ResearchAnnouncementEventData>.self,
            from: data
        )
        guard write.schemaVersion == "2026-06-18.research-write.v1",
              write.status == "succeeded",
              write.source.actorType == "user",
              write.source.actorId == membership.actorId,
              write.data.membershipId == membership.id,
              write.data.membershipVersion == membership.version,
              write.data.symbol == membership.symbol,
              write.data.source.materialId == material.id,
              write.data.eventKind == eventKind,
              write.data.coverageScope == coverageScope,
              write.data.monitorRuleBinding == monitorRuleBinding,
              write.data.validates(expected: membership, material: material),
              write.data.safety.isAdvisoryOnly else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        let fresh = try await fetchFrozenResearchEvidence(membership: membership)
        guard fresh.data?.materials.first(where: { $0.id == material.id }) == material,
              fresh.data?.events.first(where: { $0.id == write.data.id }) == write.data,
              material.replacesMaterialId == materialRequest.replacesMaterialId,
              researchMaterialReplacementReadBackIsExact(
                fresh.data?.materials ?? [],
                targetId: materialRequest.replacesMaterialId,
                child: material
              ) else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return (fresh, material, write.data)
    }
    private func createResearchMaterial(
        membership: CandidateMembershipData,
        requestBody: CreateResearchMaterialRequest
    ) async throws -> ResearchMaterialData {
        guard requestBody.membershipId == membership.id,
              requestBody.membershipVersion == membership.version else {
            throw FrozenResearchEvidenceClientError.bindingDrift
        }
        let url = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "profiles")
            .appending(path: membership.market)
            .appending(path: membership.code)
            .appending(path: "materials")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(requestBody)
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        let write = try JSONDecoder().decode(
            ResearchWriteEnvelope<ResearchMaterialData>.self,
            from: data
        )
        guard write.schemaVersion == "2026-06-18.research-write.v1",
              write.status == "succeeded",
              write.source.actorType == "user",
              write.source.actorId == membership.actorId,
              write.data.market == membership.market && write.data.code == membership.code && write.data.symbol == membership.symbol,
              write.data.title == requestBody.title,
              write.data.contentText == requestBody.contentText,
              write.data.sourceType == requestBody.sourceType,
              write.data.sourceVersion == requestBody.sourceVersion,
              write.data.replacesMaterialId == requestBody.replacesMaterialId && write.data.revisionState == "current",
              write.data.claimType == requestBody.claimType,
              write.data.verificationStatus == requestBody.verificationStatus,
              write.data.rightsStatus == requestBody.rightsStatus,
              write.data.sourceUrl == requestBody.sourceUrl,
              write.data.publishedAt == requestBody.publishedAt,
              write.data.validUntil == requestBody.validUntil,
              write.data.summary == requestBody.summary,
              write.data.variableName == requestBody.variableName,
              write.data.stance == requestBody.stance,
              write.data.reliability == requestBody.reliability,
              write.data.materiality == requestBody.materiality,
              write.data.isRead == requestBody.isRead && write.data.validates(expected: membership) else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return write.data
    }

    public func createTwoLayerReportAndReadBack(
        membership: CandidateMembershipData,
        requestBody: CreateTwoLayerReportRequest,
        intent: DeepResearchTaskIntent? = nil
    ) async throws -> (
        workspace: FrozenResearchEvidenceWorkspace,
        report: TwoLayerReportData
    ) {
        let task = try await createDeepResearchTaskAndPoll(
            membership: membership,
            requestBody: requestBody,
            intent: intent
        )
        if task.status == "failed" {
            throw FrozenResearchEvidenceClientError.taskFailure(task.errorCode ?? "task_execution_failed")
        }
        guard task.status == "succeeded" else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return try await readTwoLayerReportBack(
            membership: membership,
            requestBody: requestBody,
            task: task
        )
    }

    func readTwoLayerReportBack(
        membership: CandidateMembershipData,
        requestBody: CreateTwoLayerReportRequest,
        task: DeepResearchTaskEnvelope.Task
    ) async throws -> (
        workspace: FrozenResearchEvidenceWorkspace,
        report: TwoLayerReportData
    ) {
        guard task.status == "succeeded", let taskReport = task.report else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        let fresh = try await fetchFrozenResearchEvidence(membership: membership)
        guard let payload = fresh.data else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        guard payload.latestPack?.id == requestBody.evidencePackId,
              payload.latestPack?.packFingerprint
                == requestBody.evidencePackBinding.fingerprint else {
            throw FrozenResearchEvidenceClientError.bindingDrift
        }
        guard let report = payload.reports.first(where: { $0.id == taskReport.id }) else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        guard report.isCurrentExact else {
            throw FrozenResearchEvidenceClientError.bindingDrift
        }
        guard report.version == taskReport.version,
              report.evidencePackId == taskReport.evidencePackId,
              report.reportFingerprint == taskReport.reportFingerprint,
              report.contractVersion == deepResearchSynthesisReportContractVersion,
              report.payload.reportContractVersion
                == deepResearchSynthesisReportContractVersion,
              report.payload.evidencePackBinding == requestBody.evidencePackBinding,
              report.payload.snapshotBinding == task.snapshotBinding,
              report.payload.adviceLayer?.automaticTradingSignal == false,
              let reproducibility = report.payload.reproducibility,
              reproducibility.generationMethod
                == "deepseek_chat_completions_selected_snapshot",
              reproducibility.provider == "deepseek",
              reproducibility.model != "NOT_USED",
              reproducibility.prompt != "NOT_USED",
              reproducibility.tokenUsage != "NOT_USED",
              reproducibility.cost != "NOT_USED" else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        guard let synthesis = task.synthesis,
              synthesis.snapshotId == report.payload.snapshotBinding?.snapshotId,
              synthesis.reportContractVersion == report.contractVersion,
              synthesis.provider == reproducibility.provider,
              synthesis.model == reproducibility.model,
              synthesis.promptVersion == reproducibility.prompt,
              synthesis.tokenUsage == reproducibility.tokenUsage,
              synthesis.cost == reproducibility.cost else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return (fresh, report)
    }

    public func decideTwoLayerReportAndReadBack(
        membership: CandidateMembershipData,
        report: TwoLayerReportData,
        requestBody: DecideTwoLayerReportRequest
    ) async throws -> (
        workspace: FrozenResearchEvidenceWorkspace,
        decision: TwoLayerReportDecision
    ) {
        guard report.isFormalizable else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        var request = URLRequest(
            url: frozenResearchEvidenceURL(membershipId: membership.id)
                .appending(path: "deep-research-reports")
                .appending(path: report.id)
                .appending(path: "decisions")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(requestBody)
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        try validateTwoLayerWriteRawShape(data, dataKind: .decision)
        let write = try JSONDecoder().decode(
            ResearchWriteEnvelope<TwoLayerReportDecision>.self,
            from: data
        )
        guard write.schemaVersion == "2026-06-18.research-write.v1",
              write.status == "succeeded",
              write.source.actorType == "user",
              write.source.actorId == membership.actorId,
              write.data.reportId == report.id,
              write.data.decision == requestBody.decision,
              write.data.note == requestBody.note,
              write.data.actorType == "user",
              write.data.actorId == membership.actorId else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        let fresh = try await fetchFrozenResearchEvidence(membership: membership)
        guard let payload = fresh.data,
              let freshReport = payload.reports.first(where: {
                  $0.id == report.id
              }) else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        guard freshReport.isFormalizable,
              payload.latestPack?.id == report.evidencePackId else {
            throw FrozenResearchEvidenceClientError.bindingDrift
        }
        guard freshReport == report,
              let decision = payload.decisions.first(where: {
                $0.reportId == report.id
              }),
              decision == write.data else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return (fresh, decision)
    }

    public func deleteTwoLayerReportAndReadBack(
        membership: CandidateMembershipData,
        report: TwoLayerReportData,
        idempotencyKey: String
    ) async throws -> (
        workspace: FrozenResearchEvidenceWorkspace,
        deletion: TwoLayerReportDeletion
    ) {
        let url = frozenResearchEvidenceURL(membershipId: membership.id)
            .appending(path: "deep-research-reports")
            .appending(path: report.id)
            .appending(path: "deletion")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(DeleteTwoLayerReportRequest(
            membershipVersion: membership.version,
            reportFingerprint: report.reportFingerprint,
            idempotencyKey: idempotencyKey
        ))
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        let write = try JSONDecoder().decode(
            ResearchWriteEnvelope<TwoLayerReportDeletion>.self,
            from: data
        )
        guard write.schemaVersion == "2026-06-18.research-write.v1",
              write.status == "succeeded",
              write.source.actorType == "user",
              write.source.actorId == membership.actorId,
              write.data.reportId == report.id,
              write.data.reportVersion == report.version,
              write.data.evidencePackId == report.evidencePackId,
              write.data.membershipVersion == membership.version,
              write.data.reportFingerprint == report.reportFingerprint,
              write.data.validates(expected: membership) else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        var read = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &read)
        let (readData, readResponse) = try await session.data(for: read)
        try validateFrozenResearchResponse(readResponse)
        let deletion = try JSONDecoder().decode(TwoLayerReportDeletion.self, from: readData)
        guard deletion == write.data else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        let fresh = try await fetchFrozenResearchEvidence(membership: membership)
        guard let payload = fresh.data,
              !payload.reports.contains(where: { $0.id == report.id }),
              !payload.decisions.contains(where: { $0.reportId == report.id }),
              payload.reportDeletions?.contains(deletion) == true else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return (fresh, deletion)
    }
}
func twoLayerReportFailureRequiresClear(_ error: Error) -> Bool {
    if case FrozenResearchEvidenceClientError.taskFailure = error { return true }
    if let evidenceError = error as? FrozenResearchEvidenceClientError,
       [.bindingDrift, .providerUnavailable, .taskFailed].contains(evidenceError) {
        return true
    }
    guard case FrozenResearchEvidenceClientError.httpStatus(let status) = error else {
        return false
    }
    return [401, 403, 404, 409].contains(status)
}

private enum TwoLayerWriteDataKind: Equatable {
    case report
    case decision
}

private func validateTwoLayerWriteRawShape(
    _ data: Data,
    dataKind: TwoLayerWriteDataKind
) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(root.keys) == Set([
            "schemaVersion", "status", "asOf", "source", "data", "message"
          ]),
          let source = root["source"] as? [String: Any],
          Set(source.keys) == Set(["actorType", "actorId", "correlationId"]),
          let payload = root["data"] as? [String: Any] else {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    let expected: Set<String>
    switch dataKind {
    case .report:
        expected = Set([
            "id", "evidencePackId", "version", "contractVersion",
            "reportFingerprint", "currentness", "status", "gateFailures",
            "payload", "createdAt"
        ])
    case .decision:
        expected = Set([
            "id", "reportId", "decision", "note", "actorType", "actorId",
            "decidedAt"
        ])
    }
    guard Set(payload.keys) == expected else {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    if dataKind == .report {
        var errors: [String] = []
        twoLayerReportRawShape(
            payload,
            label: "two-layer report write.data",
            errors: &errors
        )
        if !errors.isEmpty {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
    }
}

func twoLayerReportRawShape(
    _ value: Any?,
    label: String,
    errors: inout [String]
) {
    guard let report = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    twoLayerExact(
        report,
        [
            "id", "evidencePackId", "version", "contractVersion",
            "reportFingerprint", "currentness", "status", "gateFailures",
            "payload", "createdAt"
        ],
        label,
        &errors
    )
    twoLayerObject(
        report["currentness"],
        ["status", "invalidatedBy", "evidencePackInvalidatedBy"],
        "\(label).currentness",
        &errors
    )
    guard let payload = report["payload"] as? [String: Any] else {
        errors.append("\(label).payload must be an object")
        return
    }
    let legacyKeys: Set<String> = [
        "researchQuestion", "cutoffAt", "investmentThesis", "factTable",
        "supportEvidenceIds", "counterEvidenceIds", "sourceConflictAssessment",
        "sourceConflicts", "unknownItems", "keyDrivers", "causalChain",
        "valuationScenarios", "impliedExpectations", "invalidationConditions",
        "changeFromPrevious", "portfolioImpact", "nextValidationQuestions",
        "modelInferences"
    ]
    let contract = report["contractVersion"] as? String
    let evidenceBound = contract == evidenceBoundReportContractVersion
    let synthesis = contract == deepResearchSynthesisReportContractVersion
    twoLayerExact(
        payload,
        evidenceBound
            ? legacyKeys.union([
                "reportContractVersion", "evidencePackBinding",
                "reproducibility", "adviceLayer", "researchLayer"
            ])
            : synthesis
                ? legacyKeys.union([
                    "reportContractVersion", "evidencePackBinding",
                    "snapshotBinding", "snapshot", "reproducibility",
                    "adviceLayer", "researchLayer"
                ]).union(payload["sendManifest"] == nil ? [] : ["sendManifest"])
            : legacyKeys,
        "\(label).payload",
        &errors
    )
    twoLayerFacts(
        payload["factTable"],
        keys: ["statement", "evidenceIds"],
        label: "\(label).payload.factTable",
        errors: &errors
    )
    twoLayerFacts(
        payload["modelInferences"],
        keys: ["statement", "evidenceIds"],
        label: "\(label).payload.modelInferences",
        errors: &errors
    )
    twoLayerFacts(
        payload["sourceConflicts"],
        keys: ["description", "evidenceIds"],
        label: "\(label).payload.sourceConflicts",
        errors: &errors
    )
    guard evidenceBound || synthesis else { return }
    twoLayerPackBinding(
        payload["evidencePackBinding"],
        label: "\(label).payload.evidencePackBinding",
        errors: &errors
    )
    twoLayerObject(
        payload["reproducibility"],
        ["generationMethod", "model", "prompt", "provider", "tokenUsage", "cost"],
        "\(label).payload.reproducibility",
        &errors
    )
    twoLayerAdvice(
        payload["adviceLayer"],
        label: "\(label).payload.adviceLayer",
        errors: &errors
    )
    twoLayerResearch(
        payload["researchLayer"],
        label: "\(label).payload.researchLayer",
        synthesis: synthesis,
        errors: &errors
    )
    if synthesis {
        if let manifest = payload["sendManifest"], !deepResearchSendManifestHasExactRawShape(manifest) {
            errors.append("\(label).payload.sendManifest keys are invalid")
        }
        twoLayerSnapshot(
            payload["snapshot"],
            binding: payload["snapshotBinding"],
            label: "\(label).payload.snapshot",
            errors: &errors
        )
    }
}

private func twoLayerPackBinding(
    _ value: Any?,
    label: String,
    errors: inout [String]
) {
    guard let binding = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    if binding["contextVersion"] as? String == limitedResearchContextVersion {
        twoLayerExact(binding, ["id", "version", "fingerprint", "membershipId", "membershipVersion", "symbol", "frozenAt", "contextVersion"], label, &errors)
        return
    }
    let v2 = binding["contextVersion"] as? String == frozenResearchContextVersionV2
    twoLayerExact(
        binding,
        [
            "id", "version", "fingerprint", "membershipId",
            "membershipVersion", "symbol", "frozenAt", "contextVersion",
            v2 ? "valuationMethods" : "valuation", "technical"
        ],
        label,
        &errors,
        optionalKeys: ["quantPortfolio"]
    )
    if v2 {
        if let methods = binding["valuationMethods"] as? [[String: Any]], methods.count == 2,
           Set(methods.compactMap { $0["basisKind"] as? String }) == Set(["provider", "fcff"]) {
            for (index, method) in methods.enumerated() {
                twoLayerExact(method, ["basisKind", "scenarioId", "scenarioRevision", "methodId",
                    "sourceFingerprint", "calculationVersion"], "\(label).valuationMethods[\(index)]", &errors)
            }
        } else { errors.append("\(label).valuationMethods must bind provider and FCFF") }
    } else {
        guard let valuation = binding["valuation"] as? [String: Any] else {
            errors.append("\(label).valuation must be an object")
            return
        }
        twoLayerExact(valuation, ["scenarioId", "scenarioRevision", "assumptions", "calculationVersion"],
            "\(label).valuation", &errors)
        guard let assumptions = valuation["assumptions"] as? [String: Any] else {
            errors.append("\(label).valuation.assumptions must be an object")
            return
        }
        twoLayerExact(assumptions, ["authority", "derivation", "values"],
            "\(label).valuation.assumptions", &errors)
        twoLayerObject(assumptions["values"], ["baseMetricPerShare", "annualGrowthRate", "horizonYears",
            "terminalMultiple", "annualDiscountRate", "netCashPerShare", "growthRateStep", "multipleStep"],
            "\(label).valuation.assumptions.values", &errors, optionalKeys: ["methodId", "metricCurrency"])
    }
    twoLayerObject(
        binding["technical"],
        [
            "snapshotSha", "resultHash", "dataCutoffAt", "adjustment",
            "computationVersion"
        ],
        "\(label).technical",
        &errors
    )
    if let quant = binding["quantPortfolio"] {
        twoLayerQuantPortfolio(quant, label: "\(label).quantPortfolio", errors: &errors)
    }
}

private func twoLayerQuantPortfolio(
    _ value: Any?,
    label: String,
    errors: inout [String]
) {
    guard let quant = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    twoLayerExact(quant, ["decision", "portfolio"], label, &errors)
    let lanes: [(String, Set<String>)] = [
        ("decision", [
            "status", "refinementId", "snapshotId", "snapshotHash", "dataHash", "dataCutoff",
            "generatedAt", "source", "asOf", "fetchedAt", "validUntil", "hkConnectUniverse"
        ]),
        ("portfolio", [
            "status", "evidenceId", "contentHash", "snapshotId", "snapshotHash", "dataHash",
            "dataCutoff", "observationStartDate", "observationEndDate", "observationCount",
            "stability", "generatedAt", "validUntil", "hkConnectUniverse", "series", "covariance"
        ])
    ]
    for (key, availableKeys) in lanes {
        guard let lane = quant[key] as? [String: Any] else {
            errors.append("\(label).\(key) must be an object")
            continue
        }
        twoLayerExact(
            lane,
            lane["status"] as? String == "available" ? availableKeys : ["status", "reason"],
            "\(label).\(key)",
            &errors
        )
        if lane["status"] as? String == "available" {
            twoLayerObject(
                lane["hkConnectUniverse"],
                ["source", "snapshotId", "effectiveDate", "capturedAt", "memberCount", "sourceUrls"],
                "\(label).\(key).hkConnectUniverse",
                &errors
            )
        }
    }
}

private func twoLayerAdvice(
    _ value: Any?,
    label: String,
    errors: inout [String]
) {
    guard let advice = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    twoLayerExact(
        advice,
        [
            "conclusion", "confidence", "applicableUntil", "horizonStatement",
            "longTerm", "mediumShortTerm", "conflict",
            "automaticTradingSignal"
        ],
        label,
        &errors,
        optionalKeys: [
            "direction", "priceConditions", "priceRange", "researchPositionRange",
            "assumptions", "scenarios", "nextQuestion", "versionChange"
        ]
    )
    for key in ["longTerm", "mediumShortTerm"] {
        twoLayerObject(
            advice[key],
            ["view", "conditions", "invalidationConditions", "risks"],
            "\(label).\(key)",
            &errors
        )
    }
    twoLayerObject(
        advice["conflict"],
        ["status", "description"],
        "\(label).conflict",
        &errors
    )
}

private func twoLayerResearch(
    _ value: Any?,
    label: String,
    synthesis: Bool = false,
    errors: inout [String]
) {
    guard let research = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    var factKeys = [
        "fundamentals", "valuation", "technical", "eventsAndCatalysts",
        "risks", "counterevidence", "unknowns"
    ]
    if synthesis { factKeys += ["context", "operatingMonitor"] }
    if research["quantPortfolio"] != nil { factKeys.append("quantPortfolio") }
    twoLayerExact(
        research,
        Set(factKeys + ["sourceConflicts", "nextValidationQuestions"]),
        label,
        &errors
    )
    for key in factKeys {
        twoLayerFacts(
            research[key],
            keys: synthesis
                ? [
                    "statement", "evidenceIds", "sourceKind", "sourceId",
                    "citation", "claimType", "stance"
                ]
                : [
                    "statement", "evidenceIds", "sourceKind", "claimType", "stance"
                ],
            label: "\(label).\(key)",
            errors: &errors
        )
        if synthesis {
            twoLayerCitations(
                research[key],
                label: "\(label).\(key)",
                errors: &errors
            )
        }
    }
    twoLayerFacts(
        research["sourceConflicts"],
        keys: synthesis
            ? ["description", "evidenceIds", "sourceKind", "sourceId", "citation"]
            : ["description", "evidenceIds"],
        label: "\(label).sourceConflicts",
        errors: &errors
    )
    if synthesis {
        twoLayerCitations(
            research["sourceConflicts"],
            label: "\(label).sourceConflicts",
            errors: &errors
        )
    }
}

private func twoLayerCitations(
    _ value: Any?,
    label: String,
    errors: inout [String]
) {
    guard let facts = value as? [[String: Any]] else { return }
    for (index, fact) in facts.enumerated() {
        twoLayerObject(
            fact["citation"],
            ["kind", "evidenceId", "documentId", "pageNumber", "pageTextSha256"],
            "\(label)[\(index)].citation",
            &errors
        )
    }
}

private func twoLayerSnapshot(
    _ value: Any?,
    binding bindingValue: Any?,
    label: String,
    errors: inout [String]
) {
    guard let snapshot = value as? [String: Any],
          let binding = bindingValue as? [String: Any] else {
        errors.append("\(label) and snapshotBinding must be objects")
        return
    }
    twoLayerExact(
        snapshot,
        [
            "schemaVersion", "snapshotId", "cutoffAt", "target", "evidencePack",
            "intent", "events", "operatingMonitor", "fundamentals", "researchContext", "safety"
        ],
        label,
        &errors, optionalKeys: ["monitorRules", "analysisContentVersion", "priorReportSummary",
                                "providerValuationScenarios", "providerFcffScenarios", "providerOperatingReference", "selectedResearchContext"]
    )
    if let intent = snapshot["intent"] as? [String: Any] {
        twoLayerExact(
            intent,
            [
                "researchQuestion", "investmentHorizon", "cutoffAt", "selectedMaterialIds",
                "includedStructuredSections", "priorReport", "outputLanguage", "fullTextPdfConsent",
                "maxOutputTokens", "maxDurationSeconds", "providerAuthorization"
            ],
            "\(label).intent",
            &errors,
            optionalKeys: ["monitorRules", "maxOutputTokens", "maxDurationSeconds", "providerAuthorization",
                           "selectedProviderScenarioIds", "selectedProviderFcffScenarioIds", "includeProviderOwnerContext", "selectedResearchContext"]
        )
        if let authorization = intent["providerAuthorization"] {
            twoLayerObject(
                authorization,
                ["provider", "model", "policyVersion", "ownerConfirmed", "confirmedIntentFingerprint"],
                "\(label).intent.providerAuthorization",
                &errors
            )
        }
        let hasTokens = intent["maxOutputTokens"] != nil
        let hasDuration = intent["maxDurationSeconds"] != nil
        if hasTokens != hasDuration
            || (hasTokens && ![1000, 2000, 4000, 8000].contains(intent["maxOutputTokens"] as? Int ?? -1))
            || (hasDuration && ![15, 30, 60].contains(intent["maxDurationSeconds"] as? Int ?? -1)) {
            errors.append("\(label).intent generation budget is invalid")
        }
    } else {
        errors.append("\(label).intent must be an object")
    }
    twoLayerObject(
        binding,
        [
            "schemaVersion", "snapshotId", "cutoffAt", "membershipId",
            "membershipVersion", "symbol", "evidencePackId", "evidencePackVersion",
            "evidencePackFingerprint"
        ],
        "\(label)Binding",
        &errors, optionalKeys: ["analysisContentVersion"]
    )
    if snapshot["analysisContentVersion"] != nil || binding["analysisContentVersion"] != nil || snapshot["priorReportSummary"] != nil {
        guard snapshot["analysisContentVersion"] as? String == "2026-09-10.v1",
              binding["analysisContentVersion"] as? String == "2026-09-10.v1",
              let intent = snapshot["intent"] as? [String: Any] else {
            errors.append("\(label) analysis version is invalid")
            return
        }
        if !(snapshot["priorReportSummary"] is NSNull && intent["priorReport"] is NSNull) {
            guard let summary = snapshot["priorReportSummary"] as? [String: Any],
                  let prior = summary["report"] as? NSDictionary,
                  let selected = intent["priorReport"] as? NSDictionary, prior == selected,
                  let cutoff = summary["cutoffAt"] as? String,
                  let currentCutoff = snapshot["cutoffAt"] as? String,
                  areDateTimeInstantsChronologicallyOrdered([cutoff, currentCutoff]),
                  let conclusion = summary["conclusion"] as? String,
                  !conclusion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, conclusion.count <= 4000 else {
                errors.append("\(label) previous judgment does not match its identity")
                return
            }
            twoLayerExact(summary, ["report", "cutoffAt", "conclusion", "keyDrivers", "invalidationConditions", "unknownItems"], "\(label).priorReportSummary", &errors)
            for field in ["keyDrivers", "invalidationConditions", "unknownItems"] {
                guard let values = summary[field] as? [String], values.count <= 5,
                      values.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.count <= 4000 }) else {
                    errors.append("\(label).priorReportSummary.\(field) is invalid")
                    continue
                }
            }
        }
    }
    guard let target = snapshot["target"] as? [String: Any],
          let pack = snapshot["evidencePack"] as? [String: Any],
          let currentness = pack["currentness"] as? [String: Any],
          let safety = snapshot["safety"] as? [String: Any] else {
        errors.append("\(label) identity or safety is invalid")
        return
    }
    twoLayerExact(
        target,
        ["membershipId", "membershipVersion", "symbol"],
        "\(label).target",
        &errors
    )
    twoLayerExact(
        currentness,
        ["status", "invalidatedBy"],
        "\(label).evidencePack.currentness",
        &errors
    )
    twoLayerExact(
        safety,
        [
            "advisoryOnly", "providerInput", "createsOrder", "createsTrade",
            "mutatesCash", "writesFee", "mutatesPosition", "callsBroker",
            "mutatesOfficialPortfolio", "productionWrite"
        ],
        "\(label).safety",
        &errors
    )
    guard snapshot["schemaVersion"] as? String == binding["schemaVersion"] as? String,
          snapshot["snapshotId"] as? String == binding["snapshotId"] as? String,
          snapshot["cutoffAt"] as? String == binding["cutoffAt"] as? String,
          target["membershipId"] as? String == binding["membershipId"] as? String,
          target["membershipVersion"] as? Int == binding["membershipVersion"] as? Int,
          target["symbol"] as? String == binding["symbol"] as? String,
          pack["id"] as? String == binding["evidencePackId"] as? String,
          pack["version"] as? Int == binding["evidencePackVersion"] as? Int,
          pack["packFingerprint"] as? String
            == binding["evidencePackFingerprint"] as? String,
          pack["membershipId"] as? String == binding["membershipId"] as? String,
          pack["membershipVersion"] as? Int
            == binding["membershipVersion"] as? Int,
          pack["symbol"] as? String == binding["symbol"] as? String,
          pack["frozenAt"] as? String == binding["cutoffAt"] as? String,
          currentness["status"] as? String == "current",
          (currentness["invalidatedBy"] as? [String])?.isEmpty == true,
          safety["advisoryOnly"] as? Bool == true,
          safety["providerInput"] as? String == "selected_snapshot_only",
          safety["createsOrder"] as? Bool == false,
          safety["createsTrade"] as? Bool == false,
          safety["mutatesCash"] as? Bool == false,
          safety["writesFee"] as? Bool == false,
          safety["mutatesPosition"] as? Bool == false,
          safety["callsBroker"] as? Bool == false,
          safety["mutatesOfficialPortfolio"] as? Bool == false,
          safety["productionWrite"] as? Bool == false else {
        errors.append("\(label) does not match binding or advisory safety")
        return
    }
    let selectedIntent = (snapshot["intent"] as? [String: Any])?["selectedResearchContext"]
    if selectedIntent != nil || snapshot["selectedResearchContext"] != nil {
        guard pack["researchMode"] as? String == "limited",
              let intent = selectedIntent as? [String: Any],
              let selected = snapshot["selectedResearchContext"] as? [String: Any],
              let facts = selected["selectedFacts"] as? [[String: Any]],
              let peerFacts = selected["peerFacts"] as? [[String: Any]] ?? (selected["peerFacts"] == nil ? [] : nil),
              let peers = selected["peers"] as? [[String: Any]],
              selected["contextId"] as? String == intent["contextId"] as? String,
              selected["contentHash"] as? String == intent["contentHash"] as? String,
              selected["membershipId"] as? String == target["membershipId"] as? String,
              selected["membershipVersion"] as? Int == target["membershipVersion"] as? Int,
              selected["selectedSymbol"] as? String == target["symbol"] as? String,
              facts.compactMap({ $0["id"] as? String }) == (intent["selectedFactIds"] as? [String]),
              peerFacts.compactMap({ $0["id"] as? String }) == (intent["peerFactIds"] as? [String] ?? []),
              peers.compactMap({ $0["id"] as? String }) == (intent["peerIds"] as? [String]) else {
            errors.append("\(label) selected context does not match exact limited intent")
            return
        }
        twoLayerExact(intent, Set(["contextId", "contentHash", "selectedFactIds", "peerIds"])
            .union(intent["peerFactIds"] == nil ? [] : ["peerFactIds"]),
            "\(label).intent.selectedResearchContext", &errors)
        twoLayerExact(selected, Set(["contextId", "contentHash", "membershipId", "membershipVersion",
            "selectedSymbol", "cutoffAt", "validUntil", "selectedFacts", "peers"])
            .union(selected["peerFacts"] == nil ? [] : ["peerFacts"]),
            "\(label).selectedResearchContext", &errors)
    }
}
private func twoLayerFacts(
    _ value: Any?,
    keys: Set<String>,
    label: String,
    errors: inout [String]
) {
    guard let facts = value as? [Any] else {
        errors.append("\(label) must be an array")
        return
    }
    for (index, fact) in facts.enumerated() {
        twoLayerObject(
            fact,
            keys,
            "\(label)[\(index)]",
            &errors
        )
    }
}

private func twoLayerObject(_ value: Any?, _ keys: Set<String>, _ label: String, _ errors: inout [String], optionalKeys: Set<String> = []) {
    guard let object = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    twoLayerExact(object, keys, label, &errors, optionalKeys: optionalKeys)
}

private func twoLayerExact(_ value: [String: Any], _ keys: Set<String>, _ label: String, _ errors: inout [String], optionalKeys: Set<String> = []) {
    let actual = Set(value.keys)
    if !keys.isSubset(of: actual) || !actual.isSubset(of: keys.union(optionalKeys)) {
        errors.append("\(label) keys are invalid")
    }
}
