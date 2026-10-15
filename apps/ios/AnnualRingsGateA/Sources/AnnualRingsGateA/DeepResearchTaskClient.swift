import Foundation
public let deepResearchSynthesisReportContractVersion =
    "2026-08-05.deep-research-synthesis-report.v1"
public struct DeepResearchTaskIntent: Codable, Equatable, Sendable {
    private enum CodingKeys: String, CodingKey {
        case researchQuestion, investmentHorizon, cutoffAt, selectedMaterialIds
        case selectedProviderScenarioIds
        case selectedProviderFcffScenarioIds
        case includeProviderOwnerContext
        case selectedResearchContext
        case includedStructuredSections, priorReport, outputLanguage, fullTextPdfConsent
        case monitorRules, maxOutputTokens, maxDurationSeconds, providerAuthorization
    }
    public struct PriorReport: Codable, Equatable, Sendable {
        public let id: String
        public let version: Int
        public let evidencePackId: String
        public let reportFingerprint: String
    }
    public struct ProviderAuthorization: Codable, Equatable, Sendable {
        public let provider: String
        public let model: String
        public let policyVersion: String
        public var ownerConfirmed: Bool
        public var confirmedIntentFingerprint: String
        static func deepSeek(ownerConfirmed: Bool) -> Self {
            Self(
                provider: "deepseek",
                model: "deepseek-flash",
                policyVersion: cloudAiProviderPolicyVersion,
                ownerConfirmed: ownerConfirmed,
                confirmedIntentFingerprint: ""
            )
        }
        var validates: Bool {
            provider == "deepseek"
                && cloudAiModelPolicyMatches(model, policyVersion)
                && (ownerConfirmed
                    ? confirmedIntentFingerprint.isFrozenSHA256
                    : confirmedIntentFingerprint.isEmpty)
        }
    }
    public var researchQuestion: String
    public var investmentHorizon: String
    public let cutoffAt: String
    public var selectedMaterialIds: [String]
    public var selectedProviderScenarioIds: [String]?
    public var selectedProviderFcffScenarioIds: [String]?
    public var includeProviderOwnerContext: Bool?
    public struct SelectedResearchContext: Codable, Equatable, Sendable {
        public let contextId: String
        public let contentHash: String
        public var selectedFactIds: [String]
        public var peerIds: [String]
        public var peerFactIds: [String]?
        public init(contextId: String, contentHash: String, selectedFactIds: [String],
                    peerIds: [String], peerFactIds: [String]? = nil) {
            self.contextId = contextId
            self.contentHash = contentHash
            self.selectedFactIds = selectedFactIds
            self.peerIds = peerIds
            self.peerFactIds = peerFactIds
        }
        public var validates: Bool {
            researchDocumentIsPositiveIntegerString(contextId) && contentHash.isFrozenSHA256
                && (!selectedFactIds.isEmpty || !peerIds.isEmpty || peerFactIds?.isEmpty == false)
        }
        public var hasExactSortedIds: Bool {
            let valid = { (ids: [String]) in
                ids.count <= 100 && ids.allSatisfy(researchDocumentIsPositiveIntegerString)
                    && Set(ids).count == ids.count
                    && ids == ids.sorted { Int($0)! < Int($1)! }
            }
            return valid(selectedFactIds) && valid(peerIds)
                && (peerFactIds.map(valid) ?? true)
        }
    }
    public var selectedResearchContext: SelectedResearchContext?
    public var includedStructuredSections: [String]
    public var priorReport: PriorReport?
    public var outputLanguage: String
    public let fullTextPdfConsent: Bool
    public var monitorRules: [ResearchMonitorRule]?
    public var maxOutputTokens: Int?
    public var maxDurationSeconds: Int?
    public var providerAuthorization: ProviderAuthorization?
    public static func eligiblePriorReport(_ report: TwoLayerReportData?,
                                           for pack: FrozenResearchEvidencePack,
                                           decision: TwoLayerReportDecision? = nil) -> PriorReport? {
        guard let report, report.isImmutableExact,
              report.status == "complete_pending_confirmation", report.gateFailures.isEmpty,
              let binding = report.payload.evidencePackBinding,
              binding.membershipId == pack.membershipId,
              binding.membershipVersion == pack.membershipVersion,
              binding.symbol == pack.symbol,
              decision == nil || decision?.reportId == report.id && decision?.decision != "rejected" else {
            return nil
        }
        return PriorReport(id: report.id, version: report.version,
                           evidencePackId: report.evidencePackId,
                           reportFingerprint: report.reportFingerprint)
    }
    public init(pack: FrozenResearchEvidencePack, priorReport: TwoLayerReportData?,
                priorDecision: TwoLayerReportDecision? = nil,
                monitorRules: [ResearchMonitorRule] = []) {
        researchQuestion = "当前冻结证据对 \(pack.symbol) 的长期投资逻辑、关键风险与下一步验证支持什么？"
        investmentHorizon = "long_term"
        cutoffAt = pack.frozenAt
        selectedMaterialIds = pack.researchMode == "limited" && pack.materialSelectionMode != "explicit" ? []
            : pack.items.filter {
                pack.materialSelectionMode == "explicit"
                    || $0.sourceType != "owner_prior_judgment_note"
            }.map(\.id).sorted { Int($0)! < Int($1)! }
        selectedProviderScenarioIds = nil
        selectedProviderFcffScenarioIds = nil
        includeProviderOwnerContext = nil
        selectedResearchContext = nil
        includedStructuredSections = ["fundamentals", "research_context", "events", "operating_monitor"]
        self.priorReport = Self.eligiblePriorReport(priorReport, for: pack,
                                                    decision: priorDecision)
        outputLanguage = "zh-Hans"
        fullTextPdfConsent = false
        self.monitorRules = monitorRules.filter { $0.enabled && $0.version != nil && $0.confirmedAt != nil }
        maxOutputTokens = 8000
        maxDurationSeconds = 60
        providerAuthorization = .deepSeek(ownerConfirmed: false)
    }
    public init(binding: TwoLayerReportPackBinding) {
        researchQuestion = "当前冻结证据对 \(binding.symbol) 的长期投资逻辑、关键风险与下一步验证支持什么？"
        investmentHorizon = "long_term"
        cutoffAt = binding.frozenAt
        selectedMaterialIds = []
        selectedProviderScenarioIds = nil
        selectedProviderFcffScenarioIds = nil
        includeProviderOwnerContext = nil
        selectedResearchContext = nil
        includedStructuredSections = ["fundamentals", "research_context", "events", "operating_monitor"]
        priorReport = nil
        outputLanguage = "zh-Hans"
        fullTextPdfConsent = false
        monitorRules = []
        maxOutputTokens = 8000
        maxDurationSeconds = 60
        providerAuthorization = .deepSeek(ownerConfirmed: false)
    }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(researchQuestion, forKey: .researchQuestion)
        try container.encode(investmentHorizon, forKey: .investmentHorizon)
        try container.encode(cutoffAt, forKey: .cutoffAt)
        try container.encode(selectedMaterialIds, forKey: .selectedMaterialIds)
        try container.encodeIfPresent(selectedProviderScenarioIds, forKey: .selectedProviderScenarioIds)
        try container.encodeIfPresent(selectedProviderFcffScenarioIds, forKey: .selectedProviderFcffScenarioIds)
        try container.encodeIfPresent(includeProviderOwnerContext, forKey: .includeProviderOwnerContext)
        try container.encodeIfPresent(selectedResearchContext, forKey: .selectedResearchContext)
        try container.encode(includedStructuredSections, forKey: .includedStructuredSections)
        if let priorReport {
            try container.encode(priorReport, forKey: .priorReport)
        } else {
            try container.encodeNil(forKey: .priorReport)
        }
        try container.encode(outputLanguage, forKey: .outputLanguage)
        try container.encode(fullTextPdfConsent, forKey: .fullTextPdfConsent)
        try container.encodeIfPresent(monitorRules, forKey: .monitorRules)
        try container.encodeIfPresent(maxOutputTokens, forKey: .maxOutputTokens)
        try container.encodeIfPresent(maxDurationSeconds, forKey: .maxDurationSeconds)
        try container.encodeIfPresent(providerAuthorization, forKey: .providerAuthorization)
    }
    func validates(binding: TwoLayerReportPackBinding) -> Bool {
        let allowedSections = ["fundamentals", "research_context", "events", "operating_monitor"]
        let rules = monitorRules ?? []
        return !researchQuestion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && researchQuestion.count <= 4000
            && ["long_term", "medium_term", "event_driven"].contains(investmentHorizon)
            && cutoffAt == binding.frozenAt
            && selectedMaterialIds.allSatisfy(researchDocumentIsPositiveIntegerString)
            && Set(selectedMaterialIds).count == selectedMaterialIds.count
            && selectedMaterialIds == selectedMaterialIds.sorted { Int($0)! < Int($1)! }
            && (selectedProviderScenarioIds ?? []).count <= 2
            && (selectedProviderScenarioIds ?? []).allSatisfy(researchDocumentIsPositiveIntegerString)
            && Set(selectedProviderScenarioIds ?? []).count == (selectedProviderScenarioIds ?? []).count
            && (selectedProviderScenarioIds ?? []) == (selectedProviderScenarioIds ?? []).sorted { Int($0)! < Int($1)! }
            && (selectedProviderFcffScenarioIds ?? []).count <= 1
            && (selectedProviderFcffScenarioIds ?? []).allSatisfy(researchDocumentIsPositiveIntegerString)
            && (includeProviderOwnerContext == nil || includeProviderOwnerContext == true)
            && (selectedResearchContext == nil || selectedResearchContext!.validates
                && selectedResearchContext!.hasExactSortedIds
                && includedStructuredSections.contains("research_context"))
            && includedStructuredSections == allowedSections.filter(includedStructuredSections.contains)
            && Set(includedStructuredSections).count == includedStructuredSections.count
            && ["zh-Hans", "en"].contains(outputLanguage)
            && fullTextPdfConsent == false
            && (maxOutputTokens == nil) == (maxDurationSeconds == nil)
            && [1000, 2000, 4000, 8000].contains(maxOutputTokens ?? 8000)
            && [15, 30, 60].contains(maxDurationSeconds ?? 60)
            && Set(rules.map(\.variableName)).count == rules.count
            && rules.allSatisfy { $0.validates(keyVariables: rules.map(\.variableName)) }
            && (providerAuthorization == nil || providerAuthorization!.validates)
            && (priorReport == nil || (
                researchDocumentIsPositiveIntegerString(priorReport!.id)
                    && priorReport!.version > 0
                    && researchDocumentIsPositiveIntegerString(priorReport!.evidencePackId)
                    && priorReport!.reportFingerprint.isFrozenSHA256
            ))
    }

    mutating func confirmProviderAuthorization(_ confirmed: Bool) {
        guard var authorization = providerAuthorization else { return }
        authorization.ownerConfirmed = confirmed
        authorization.confirmedIntentFingerprint = ""
        providerAuthorization = authorization
        if confirmed {
            authorization.confirmedIntentFingerprint = (try? deepResearchProviderAuthorizationFingerprint(self)) ?? ""
            providerAuthorization = authorization
        }
    }

    var hasExactProviderAuthorization: Bool {
        guard providerAuthorization?.policyVersion == cloudAiProviderPolicyVersion,
              providerAuthorization?.ownerConfirmed == true,
              providerAuthorization?.validates == true else { return false }
        return providerAuthorization?.confirmedIntentFingerprint
            == (try? deepResearchProviderAuthorizationFingerprint(self))
    }
}

private func deepResearchProviderAuthorizationFingerprint(
    _ intent: DeepResearchTaskIntent
) throws -> String {
    guard let authorization = intent.providerAuthorization,
          var object = try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(intent)
          ) as? [String: Any] else {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    object.removeValue(forKey: "providerAuthorization")
    if intent.priorReport == nil { object["priorReport"] = NSNull() }
    object["provider"] = authorization.provider
    object["model"] = authorization.model
    object["policyVersion"] = authorization.policyVersion
    return try portfolioDecisionContentId(object: object, prefix: "", excludingTopLevelKeys: [])
}

public struct CreateSynthesisTaskRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let evidencePackId: String
    public let evidencePackBinding: TwoLayerReportPackBinding
    public let intent: DeepResearchTaskIntent
    public let reportContractVersion: String
    public let idempotencyKey: String

    public init(
        membershipVersion: Int,
        evidencePackId: String,
        evidencePackBinding: TwoLayerReportPackBinding,
        intent: DeepResearchTaskIntent? = nil,
        reportContractVersion: String = deepResearchSynthesisReportContractVersion,
        idempotencyKey: String
    ) {
        self.membershipVersion = membershipVersion
        self.evidencePackId = evidencePackId
        self.evidencePackBinding = evidencePackBinding
        self.intent = intent ?? DeepResearchTaskIntent(binding: evidencePackBinding)
        self.reportContractVersion = reportContractVersion
        self.idempotencyKey = idempotencyKey
    }
}

public struct DeepResearchSnapshotBinding: Codable, Equatable, Sendable {
    public var analysisContentVersion: String? = nil
    public let schemaVersion: String
    public let snapshotId: String
    public let cutoffAt: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let evidencePackId: String
    public let evidencePackVersion: Int
    public let evidencePackFingerprint: String
}

struct DeepResearchTaskEnvelope: Decodable {
    struct Safety: Decodable {
        let advisoryOnly: Bool
        let createsOrder: Bool
        let createsTrade: Bool
        let mutatesCash: Bool
        let writesFee: Bool
        let mutatesPosition: Bool
        let callsBroker: Bool
        let productionWrite: Bool
    }
    struct Task: Decodable, Equatable, Sendable {
        struct Report: Decodable, Equatable, Sendable {
            let id: String
            let version: Int
            let evidencePackId: String
            let reportFingerprint: String
        }
        struct Synthesis: Decodable, Equatable, Sendable {
            struct SendManifest: Codable, Equatable, Sendable {
                let purpose: String; var preparedAt: String? = nil
                let policyVersion: String
                var policySnapshot: CloudAiProviderPolicy? = nil
                var sendAuthorization: CloudAiPolicyState? = nil
                let provider: String
                let model: String
                let snapshotId: String
                let membershipId: String
                let membershipVersion: Int
                let symbol: String
                let evidencePackId: String
                let evidencePackVersion: Int
                let evidencePackFingerprint: String
                let selectedMaterialIds: [String]
                let includedStructuredSections: [String]
                let payloadFields: [String]
                let sourceBindingCount: Int
                let requestBodySha256: String
                let pricingIdentity: String?
                let inputTokenUpperBound: Int?
                let maxOutputTokens: Int?
                let estimatedMaxCostUsd: Double?
                let fullPdfSent: Bool
                let credentialsSent: Bool
                let officialAssetFactsSent: Bool
            }
            let snapshotId: String
            let reportContractVersion: String
            let provider: String
            let model: String
            let promptVersion: String
            let tokenUsage: String
            let cost: String
            let sendManifest: SendManifest?
        }
        let id: String
        let previousTaskId: String?
        let membershipId: String
        let membershipVersion: Int
        let evidencePackId: String
        let evidencePackFingerprint: String
        let intent: DeepResearchTaskIntent
        let requestFingerprint: String
        let generationMethod: String
        let modelUsage: String
        let snapshotBinding: DeepResearchSnapshotBinding?
        let status: String
        let attemptCount: Int
        let synthesis: Synthesis?
        let report: Report?
        let errorCode: String?
        let createdAt: String
        let startedAt: String?
        let completedAt: String?
        let updatedAt: String
    }
    let schemaVersion: String
    let generatedAt: String
    let status: String
    let membershipId: String
    let requestedActorId: String
    let data: Task?
    let message: String
    let safety: Safety
}

func deepResearchTaskDurationSeconds(
    startedAt: String?,
    completedAt: String?
) -> Int? {
    guard let startedAt,
          let completedAt,
          let started = parseInstant(startedAt),
          let completed = parseInstant(completedAt),
          completed >= started else { return nil }
    return Int(completed.timeIntervalSince(started).rounded())
}

func decodeDeepResearchTask(
    _ data: Data,
    expected membership: CandidateMembershipData,
    requestBody: CreateSynthesisTaskRequest,
    expectedTaskId: String? = nil,
    expectedRequestFingerprint: String? = nil
) throws -> DeepResearchTaskEnvelope.Task {
    try validateDeepResearchTaskRawShape(data)
    let envelope = try JSONDecoder().decode(DeepResearchTaskEnvelope.self, from: data)
    guard envelope.schemaVersion == "2026-08-17.deep-research-task.v6",
          envelope.status == "available",
          envelope.membershipId == membership.id,
          envelope.requestedActorId == membership.actorId,
          isParseableDateTime(envelope.generatedAt),
          envelope.safety.advisoryOnly,
          !envelope.safety.createsOrder,
          !envelope.safety.createsTrade,
          !envelope.safety.mutatesCash,
          !envelope.safety.writesFee,
          !envelope.safety.mutatesPosition,
          !envelope.safety.callsBroker,
          !envelope.safety.productionWrite,
          let task = envelope.data,
          researchDocumentIsPositiveIntegerString(task.id),
          (task.previousTaskId.map {
              researchDocumentIsPositiveIntegerString($0) && $0 != task.id
          } ?? true),
          task.membershipId == membership.id,
          task.membershipVersion == membership.version,
          task.evidencePackId == requestBody.evidencePackId,
          task.evidencePackFingerprint == requestBody.evidencePackBinding.fingerprint,
          task.intent == requestBody.intent,
          task.intent.validates(binding: requestBody.evidencePackBinding),
          task.requestFingerprint.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
          ["deepseek_chat_completions_selected_snapshot", "legacy_task_metadata_only"].contains(task.generationMethod),
          !task.modelUsage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          task.modelUsage != "NOT_USED",
          task.generationMethod != "legacy_task_metadata_only"
            || task.modelUsage == "LEGACY_TASK_METADATA_ONLY",
          ["pending", "running", "ready_to_absorb", "succeeded", "failed", "canceled"].contains(task.status),
          (0...3).contains(task.attemptCount),
          isParseableDateTime(task.createdAt),
          isParseableDateTime(task.updatedAt),
          task.startedAt == nil || isParseableDateTime(task.startedAt!),
          task.completedAt == nil || isParseableDateTime(task.completedAt!),
          expectedTaskId == nil || task.id == expectedTaskId,
          expectedRequestFingerprint == nil
            || task.requestFingerprint == expectedRequestFingerprint else {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    if let snapshot = task.snapshotBinding,
       !deepResearchSnapshotBindingMatches(
        snapshot,
        membership: membership,
        request: requestBody
       ) {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    if ["ready_to_absorb", "succeeded"].contains(task.status)
        && task.generationMethod != "legacy_task_metadata_only" {
        guard let snapshot = task.snapshotBinding,
              let synthesis = task.synthesis,
              task.completedAt != nil,
              task.errorCode == nil,
              synthesis.snapshotId == snapshot.snapshotId,
              synthesis.reportContractVersion == deepResearchSynthesisReportContractVersion,
              synthesis.provider == "deepseek",
              synthesis.model != "NOT_USED",
              synthesis.promptVersion != "NOT_USED",
              synthesis.tokenUsage != "NOT_USED",
              synthesis.cost != "NOT_USED",
              task.modelUsage == synthesis.tokenUsage else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        if let manifest = synthesis.sendManifest {
            guard manifest.matches(snapshot: snapshot, provider: synthesis.provider, model: synthesis.model) else {
                throw FrozenResearchEvidenceClientError.invalidResponse
            }
        }
    }
    if task.status == "succeeded" {
        guard let report = task.report,
              researchDocumentIsPositiveIntegerString(report.id),
              report.version > 0,
              report.evidencePackId == requestBody.evidencePackId,
              report.reportFingerprint.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        if task.generationMethod == "legacy_task_metadata_only",
           task.snapshotBinding != nil || task.synthesis != nil {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
    } else {
        guard task.report == nil else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        if task.status == "failed" {
            guard task.errorCode != nil, task.completedAt != nil else {
                throw FrozenResearchEvidenceClientError.invalidResponse
            }
            if let synthesis = task.synthesis {
                guard let snapshot = task.snapshotBinding,
                      let manifest = synthesis.sendManifest,
                      synthesis.snapshotId == snapshot.snapshotId,
                      synthesis.reportContractVersion == deepResearchSynthesisReportContractVersion,
                      synthesis.provider == "deepseek",
                      synthesis.tokenUsage == "UNKNOWN", synthesis.cost == "UNKNOWN",
                      manifest.matches(snapshot: snapshot, provider: synthesis.provider, model: synthesis.model) else {
                    throw FrozenResearchEvidenceClientError.invalidResponse
                }
            }
        } else if task.status == "canceled" {
            guard ["user_canceled", "user_rejected", "report_deleted", "material_deleted"].contains(task.errorCode ?? ""),
                  task.completedAt != nil else {
                throw FrozenResearchEvidenceClientError.invalidResponse
            }
            if let receipt = task.synthesis {
                guard ["user_canceled", "user_rejected"].contains(task.errorCode ?? ""),
                      let snapshot = task.snapshotBinding,
                      receipt.snapshotId == snapshot.snapshotId,
                      receipt.reportContractVersion == deepResearchSynthesisReportContractVersion,
                      receipt.provider == "deepseek", task.modelUsage == receipt.tokenUsage,
                      let manifest = receipt.sendManifest,
                      manifest.matches(snapshot: snapshot, provider: receipt.provider, model: receipt.model) else {
                    throw FrozenResearchEvidenceClientError.invalidResponse
                }
            }
        } else if task.status != "ready_to_absorb" {
            guard task.synthesis == nil, task.errorCode == nil, task.completedAt == nil,
                  task.status != "running" || task.startedAt != nil else {
                throw FrozenResearchEvidenceClientError.invalidResponse
            }
        }
    }
    return task
}

private func deepResearchSnapshotBindingMatches(
    _ snapshot: DeepResearchSnapshotBinding,
    membership: CandidateMembershipData,
    request: CreateSynthesisTaskRequest
) -> Bool {
    snapshot.schemaVersion == "2026-08-13.deep-research-snapshot.v2"
        && (snapshot.analysisContentVersion == nil || snapshot.analysisContentVersion == "2026-09-10.v1")
        && snapshot.snapshotId.range(
            of: #"^deep-research-snapshot:[a-f0-9]{64}$"#,
            options: .regularExpression
        ) != nil
        && isParseableDateTime(snapshot.cutoffAt)
        && snapshot.membershipId == membership.id
        && snapshot.membershipVersion == membership.version
        && snapshot.symbol == membership.symbol
        && snapshot.evidencePackId == request.evidencePackId
        && snapshot.evidencePackVersion == request.evidencePackBinding.version
        && snapshot.evidencePackFingerprint == request.evidencePackBinding.fingerprint
}

private func validateDeepResearchTaskRawShape(_ data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(root.keys) == Set([
            "schemaVersion", "generatedAt", "status", "membershipId",
            "requestedActorId", "data", "message", "safety"
          ]),
          let safety = root["safety"] as? [String: Any],
          Set(safety.keys) == Set([
            "advisoryOnly", "createsOrder", "createsTrade", "mutatesCash",
            "writesFee", "mutatesPosition", "callsBroker", "productionWrite"
          ]) else {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    guard let task = root["data"] as? [String: Any] else {
        guard root["data"] is NSNull else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return
    }
    guard Set(task.keys) == Set([
        "id", "previousTaskId", "membershipId", "membershipVersion", "evidencePackId",
        "evidencePackFingerprint", "intent", "requestFingerprint", "generationMethod",
        "modelUsage", "status", "attemptCount", "synthesis", "report", "snapshotBinding",
        "errorCode", "createdAt", "startedAt", "completedAt", "updatedAt"
    ]) else {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    if let report = task["report"] as? [String: Any],
       Set(report.keys) != Set(["id", "version", "evidencePackId", "reportFingerprint"]) {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    if let intent = task["intent"] as? [String: Any] {
        let required = Set([
            "researchQuestion", "investmentHorizon", "cutoffAt", "selectedMaterialIds",
            "includedStructuredSections", "priorReport", "outputLanguage", "fullTextPdfConsent"
        ])
        let actual = Set(intent.keys)
        let allowed = required.union(["monitorRules", "maxOutputTokens", "maxDurationSeconds", "providerAuthorization", "selectedProviderScenarioIds", "selectedProviderFcffScenarioIds", "includeProviderOwnerContext", "selectedResearchContext"])
        guard required.isSubset(of: actual), actual.isSubset(of: allowed),
              actual.contains("maxOutputTokens") == actual.contains("maxDurationSeconds") else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
    }
    if let intent = task["intent"] as? [String: Any],
       let authorization = intent["providerAuthorization"] as? [String: Any],
       Set(authorization.keys) != Set([
        "provider", "model", "policyVersion", "ownerConfirmed", "confirmedIntentFingerprint"
       ]) {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    if let synthesis = task["synthesis"] as? [String: Any],
       Set(synthesis.keys) != Set([
        "snapshotId", "reportContractVersion", "provider", "model",
        "promptVersion", "tokenUsage", "cost", "sendManifest"
       ]) {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    if let manifest = (task["synthesis"] as? [String: Any])?["sendManifest"],
       !deepResearchSendManifestHasExactRawShape(manifest) {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    if let binding = task["snapshotBinding"] as? [String: Any],
       Set(binding.keys).subtracting(["analysisContentVersion"]) != Set([
        "schemaVersion", "snapshotId", "cutoffAt", "membershipId",
        "membershipVersion", "symbol", "evidencePackId", "evidencePackVersion",
        "evidencePackFingerprint"
       ]) {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
}
extension DeepResearchTaskEnvelope.Task.Synthesis.SendManifest {
    func matches(snapshot: DeepResearchSnapshotBinding, provider: String, model: String) -> Bool {
        let allowedSections = Set(["fundamentals", "research_context", "events", "operating_monitor"])
        let hasCostEstimate = pricingIdentity != nil || inputTokenUpperBound != nil
            || maxOutputTokens != nil || estimatedMaxCostUsd != nil
        let expectedCost = inputTokenUpperBound.flatMap { input in
            maxOutputTokens.flatMap { output in
                cloudAiCostEstimate(input, output, model: model, pricing: pricingIdentity)
            }
        }
        return purpose == "deep_research_synthesis" && cloudAiModelPolicyMatches(model, policyVersion)
            && (policySnapshot == nil || policySnapshot?.isKnownPolicy == true && policySnapshot?.policyVersion == policyVersion)
            && (sendAuthorization == nil || sendAuthorization?.isKnownSendAuthorizationSnapshot(policyVersion: policyVersion) == true)
            && (preparedAt == nil || areDateTimeInstantsChronologicallyOrdered([preparedAt!]))
            && self.provider == provider && self.model == model && snapshotId == snapshot.snapshotId
            && membershipId == snapshot.membershipId && membershipVersion == snapshot.membershipVersion
            && symbol == snapshot.symbol && evidencePackId == snapshot.evidencePackId
            && evidencePackVersion == snapshot.evidencePackVersion
            && evidencePackFingerprint == snapshot.evidencePackFingerprint
            && Set(selectedMaterialIds).count == selectedMaterialIds.count
            && Set(includedStructuredSections).count == includedStructuredSections.count
            && Set(includedStructuredSections).isSubset(of: allowedSections)
            && payloadFields == ["selectedSnapshot", "exactSourceBindings"] && sourceBindingCount >= 0
            && requestBodySha256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
            && (!hasCostEstimate || (
                expectedCost != nil
                    && (inputTokenUpperBound ?? 0) > 0
                    && [1000, 2000, 4000, 8000].contains(maxOutputTokens ?? 0)
                    && expectedCost == estimatedMaxCostUsd
            ))
            && !fullPdfSent && !credentialsSent && !officialAssetFactsSent
    }
}
func deepResearchSendManifestHasExactRawShape(_ value: Any) -> Bool {
    guard let manifest = value as? [String: Any] else { return false }
    let base = Set([
        "purpose", "policyVersion", "provider", "model", "snapshotId", "membershipId",
        "membershipVersion", "symbol", "evidencePackId", "evidencePackVersion",
        "evidencePackFingerprint", "selectedMaterialIds", "includedStructuredSections",
        "payloadFields", "sourceBindingCount", "requestBodySha256", "fullPdfSent",
        "credentialsSent", "officialAssetFactsSent"
    ])
    let priced = base.union(["pricingIdentity", "inputTokenUpperBound", "maxOutputTokens", "estimatedMaxCostUsd"])
    return [base, priced].contains(Set(manifest.keys).subtracting(["preparedAt", "policySnapshot", "sendAuthorization"]))
}
extension ResearchClient {
    func createDeepResearchTaskAndPoll(
        membership: CandidateMembershipData,
        requestBody: CreateTwoLayerReportRequest,
        intent: DeepResearchTaskIntent? = nil,
        onPostedTask: (@MainActor @Sendable (DeepResearchTaskEnvelope.Task) -> Void)? = nil
    ) async throws -> DeepResearchTaskEnvelope.Task {
        let taskRequest = CreateSynthesisTaskRequest(
            membershipVersion: requestBody.membershipVersion,
            evidencePackId: requestBody.evidencePackId,
            evidencePackBinding: requestBody.evidencePackBinding,
            intent: intent,
            idempotencyKey: requestBody.idempotencyKey
        )
        guard taskRequest.membershipVersion == membership.version,
              taskRequest.evidencePackId == taskRequest.evidencePackBinding.id,
              taskRequest.evidencePackBinding.membershipId == membership.id,
              taskRequest.evidencePackBinding.membershipVersion == membership.version,
              taskRequest.evidencePackBinding.symbol == membership.symbol,
              taskRequest.intent.validates(binding: taskRequest.evidencePackBinding),
              taskRequest.reportContractVersion == deepResearchSynthesisReportContractVersion else {
            throw FrozenResearchEvidenceClientError.bindingDrift
        }
        let taskURL = frozenResearchEvidenceURL(membershipId: membership.id)
            .appending(path: "deep-research-tasks")
        var request = URLRequest(url: taskURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(taskRequest)
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        let posted = try decodeDeepResearchTask(data, expected: membership, requestBody: taskRequest)
        await onPostedTask?(posted)
        var task = try await fetchDeepResearchTask(
            membership: membership,
            taskId: posted.id,
            requestBody: requestBody,
            expectedIntent: taskRequest.intent,
            expectedRequestFingerprint: posted.requestFingerprint
        )
        for _ in 0..<12 where task.status == "pending" || task.status == "running" {
            try await Task.sleep(nanoseconds: 250_000_000)
            task = try await fetchDeepResearchTask(
                membership: membership,
                taskId: task.id,
                requestBody: requestBody,
                expectedIntent: taskRequest.intent,
                expectedRequestFingerprint: posted.requestFingerprint
            )
        }
        return task
    }

    func retryDeepResearchTaskAndPoll(
        membership: CandidateMembershipData,
        requestBody: CreateTwoLayerReportRequest,
        task: DeepResearchTaskEnvelope.Task,
        idempotencyKey: String
    ) async throws -> DeepResearchTaskEnvelope.Task {
        guard deepResearchTaskCanExplicitlyRetry(task),
              let snapshot = task.snapshotBinding else {
            throw FrozenResearchEvidenceClientError.bindingDrift
        }
        let taskRequest = CreateSynthesisTaskRequest(
            membershipVersion: requestBody.membershipVersion,
            evidencePackId: requestBody.evidencePackId,
            evidencePackBinding: requestBody.evidencePackBinding,
            intent: task.intent,
            idempotencyKey: requestBody.idempotencyKey
        )
        let taskURL = frozenResearchEvidenceURL(membershipId: membership.id)
            .appending(path: "deep-research-tasks")
            .appending(path: task.id)
        var request = URLRequest(url: taskURL.appending(path: "retry"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "membershipVersion": membership.version,
            "taskRequestFingerprint": task.requestFingerprint,
            "snapshotId": snapshot.snapshotId,
            "idempotencyKey": idempotencyKey
        ])
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        let posted = try decodeDeepResearchTask(
            data,
            expected: membership,
            requestBody: taskRequest,
            expectedRequestFingerprint: task.requestFingerprint
        )
        guard posted.previousTaskId == task.id else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        var retried = try await fetchDeepResearchTask(
            membership: membership,
            taskId: posted.id,
            requestBody: requestBody,
            expectedIntent: task.intent,
            expectedRequestFingerprint: posted.requestFingerprint
        )
        for _ in 0..<12 where retried.status == "pending" || retried.status == "running" {
            try await Task.sleep(nanoseconds: 250_000_000)
            retried = try await fetchDeepResearchTask(
                membership: membership,
                taskId: posted.id,
                requestBody: requestBody,
                expectedIntent: task.intent,
                expectedRequestFingerprint: posted.requestFingerprint
            )
        }
        return retried
    }

    func fetchDeepResearchTask(
        membership: CandidateMembershipData,
        taskId: String,
        requestBody: CreateTwoLayerReportRequest,
        expectedIntent: DeepResearchTaskIntent? = nil,
        expectedRequestFingerprint: String
    ) async throws -> DeepResearchTaskEnvelope.Task {
        var request = URLRequest(
            url: frozenResearchEvidenceURL(membershipId: membership.id)
                .appending(path: "deep-research-tasks")
                .appending(path: taskId)
        )
        request.cachePolicy = .reloadIgnoringLocalCacheData
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        let envelope = try JSONDecoder().decode(DeepResearchTaskEnvelope.self, from: data)
        guard let responseIntent = envelope.data?.intent,
              expectedIntent == nil || responseIntent == expectedIntent else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        let responseRequest = CreateSynthesisTaskRequest(
            membershipVersion: requestBody.membershipVersion,
            evidencePackId: requestBody.evidencePackId,
            evidencePackBinding: requestBody.evidencePackBinding,
            intent: responseIntent,
            idempotencyKey: requestBody.idempotencyKey
        )
        return try decodeDeepResearchTask(
            data,
            expected: membership,
            requestBody: responseRequest,
            expectedTaskId: taskId,
            expectedRequestFingerprint: expectedRequestFingerprint
        )
    }

    func fetchCurrentDeepResearchTask(
        membership: CandidateMembershipData,
        requestBody: CreateTwoLayerReportRequest
    ) async throws -> DeepResearchTaskEnvelope.Task? {
        var components = URLComponents(
            url: frozenResearchEvidenceURL(membershipId: membership.id)
                .appending(path: "deep-research-tasks")
                .appending(path: "current"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "membershipVersion", value: String(membership.version)),
            URLQueryItem(name: "evidencePackId", value: requestBody.evidencePackId),
            URLQueryItem(
                name: "evidencePackFingerprint",
                value: requestBody.evidencePackBinding.fingerprint
            )
        ]
        var request = URLRequest(url: components.url!)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        try validateDeepResearchTaskRawShape(data)
        let envelope = try JSONDecoder().decode(DeepResearchTaskEnvelope.self, from: data)
        if envelope.status == "not_found" {
            guard envelope.schemaVersion == "2026-08-17.deep-research-task.v6",
                  envelope.membershipId == membership.id,
                  envelope.requestedActorId == membership.actorId,
                  envelope.data == nil,
                  isParseableDateTime(envelope.generatedAt),
                  envelope.safety.advisoryOnly,
                  !envelope.safety.createsOrder,
                  !envelope.safety.createsTrade,
                  !envelope.safety.mutatesCash,
                  !envelope.safety.writesFee,
                  !envelope.safety.mutatesPosition,
                  !envelope.safety.callsBroker,
                  !envelope.safety.productionWrite else {
                throw FrozenResearchEvidenceClientError.invalidResponse
            }
            return nil
        }
        guard let intent = envelope.data?.intent else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        let taskRequest = CreateSynthesisTaskRequest(
            membershipVersion: requestBody.membershipVersion,
            evidencePackId: requestBody.evidencePackId,
            evidencePackBinding: requestBody.evidencePackBinding,
            intent: intent,
            idempotencyKey: requestBody.idempotencyKey
        )
        return try decodeDeepResearchTask(
            data,
            expected: membership,
            requestBody: taskRequest
        )
    }

    func absorbDeepResearchTaskAndReadBack(
        membership: CandidateMembershipData,
        requestBody: CreateTwoLayerReportRequest,
        task: DeepResearchTaskEnvelope.Task,
        idempotencyKey: String
    ) async throws -> (workspace: FrozenResearchEvidenceWorkspace, report: TwoLayerReportData) {
        guard task.status == "ready_to_absorb",
              let snapshot = task.snapshotBinding,
              task.synthesis?.snapshotId == snapshot.snapshotId else {
            throw FrozenResearchEvidenceClientError.bindingDrift
        }
        var request = URLRequest(
            url: frozenResearchEvidenceURL(membershipId: membership.id)
                .appending(path: "deep-research-tasks")
                .appending(path: task.id)
                .appending(path: "absorb")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "membershipVersion": membership.version,
            "taskRequestFingerprint": task.requestFingerprint,
            "snapshotId": snapshot.snapshotId,
            "idempotencyKey": idempotencyKey
        ])
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        let taskRequest = CreateSynthesisTaskRequest(
            membershipVersion: requestBody.membershipVersion,
            evidencePackId: requestBody.evidencePackId,
            evidencePackBinding: requestBody.evidencePackBinding,
            intent: task.intent,
            idempotencyKey: requestBody.idempotencyKey
        )
        let absorbed = try decodeDeepResearchTask(
            data,
            expected: membership,
            requestBody: taskRequest,
            expectedTaskId: task.id,
            expectedRequestFingerprint: task.requestFingerprint
        )
        let fresh = try await fetchDeepResearchTask(
            membership: membership,
            taskId: task.id,
            requestBody: requestBody,
            expectedIntent: task.intent,
            expectedRequestFingerprint: task.requestFingerprint
        )
        guard absorbed.status == "succeeded",
              fresh.status == "succeeded",
              fresh.snapshotBinding == task.snapshotBinding,
              fresh.synthesis == task.synthesis,
              fresh.report == absorbed.report else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return try await readTwoLayerReportBack(
            membership: membership,
            requestBody: requestBody,
            task: fresh
        )
    }

    func cancelDeepResearchTaskAndReadBack(
        membership: CandidateMembershipData,
        requestBody: CreateTwoLayerReportRequest,
        task: DeepResearchTaskEnvelope.Task,
        reason: String,
        idempotencyKey: String
    ) async throws -> DeepResearchTaskEnvelope.Task {
        guard (reason == "user_canceled" && ["pending", "running"].contains(task.status)
                || reason == "user_rejected" && task.status == "ready_to_absorb") else {
            throw FrozenResearchEvidenceClientError.bindingDrift
        }
        var request = URLRequest(
            url: frozenResearchEvidenceURL(membershipId: membership.id)
                .appending(path: "deep-research-tasks")
                .appending(path: task.id)
                .appending(path: "cancel")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "membershipVersion": membership.version,
            "taskRequestFingerprint": task.requestFingerprint,
            "reason": reason,
            "idempotencyKey": idempotencyKey
        ])
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        let taskRequest = CreateSynthesisTaskRequest(
            membershipVersion: requestBody.membershipVersion,
            evidencePackId: requestBody.evidencePackId,
            evidencePackBinding: requestBody.evidencePackBinding,
            intent: task.intent,
            idempotencyKey: requestBody.idempotencyKey
        )
        let canceled = try decodeDeepResearchTask(
            data,
            expected: membership,
            requestBody: taskRequest,
            expectedTaskId: task.id,
            expectedRequestFingerprint: task.requestFingerprint
        )
        let fresh = try await fetchDeepResearchTask(
            membership: membership,
            taskId: task.id,
            requestBody: requestBody,
            expectedIntent: task.intent,
            expectedRequestFingerprint: task.requestFingerprint
        )
        guard canceled.status == "canceled", fresh == canceled,
              fresh.errorCode == reason else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return fresh
    }
}

func deepResearchTaskCanExplicitlyRetry(_ task: DeepResearchTaskEnvelope.Task) -> Bool {
    task.status == "failed"
        && task.snapshotBinding != nil
        && task.intent.hasExactProviderAuthorization
        && [
            "provider_timeout",
            "provider_unavailable_or_invalid",
    "provider_http_401", "provider_http_402", "provider_http_403", "provider_http_408", "provider_http_429", "provider_http_500", "provider_http_502", "provider_http_503", "provider_http_504",
    "provider_output_invalid",
            "provider_receipt_unknown",
            "task_execution_failed",
            "worker_retry_exhausted"
        ].contains(task.errorCode ?? "")
}

func deepResearchTaskFailureMessage(_ task: DeepResearchTaskEnvelope.Task) -> String {
    let retryable = deepResearchTaskCanExplicitlyRetry(task)
    let (stage, reason) = deepResearchTaskFailureDescription(task.errorCode)
    return "阶段：\(stage)。原因：\(reason)。可否重试：\(retryable ? "可以，沿用同一证据快照" : "不可以")。下一步：\(retryable ? "明确重试已保存任务" : "刷新证据并重新准备任务")。"
}

func deepResearchTaskFailureDescription(_ code: String?) -> (String, String) {
    let stage: String
    let reason: String
    switch code {
    case "provider_timeout":
        stage = "云端模型"
        reason = "已确认的模型超过你选择的时间上限"
    case "provider_unavailable_or_invalid":
        stage = "云端模型"
        reason = "已确认的模型不可用或返回内容未通过校验"
    case "provider_http_402":
        stage = "模型账户"
        reason = "提供方已明确返回余额不足；请先处理账户余额，再明确重试原任务"
    case "provider_http_401", "provider_http_403":
        stage = "模型权限"
        reason = "提供方已明确拒绝认证或访问；请先核对原提供方配置，再明确重试"
    case let code? where code.hasPrefix("provider_http_"):
        stage = "云端模型响应"
        reason = "已收到明确的 HTTP 失败响应；本次没有生成可用报告"
    case "provider_output_invalid":
        stage = "模型输出校验"
        reason = "已收到模型回复，但内容未通过校验；不会作为研究报告保存"
    case "research_gate_failed":
        stage = "证据与授权核验"
        reason = "资料版本或授权已变化，请刷新后重新准备研究"
    case "provider_receipt_unknown":
        stage = "云端模型回执"
        reason = "请求可能已送达，但没有可核验回执；系统没有自动再次发送"
    case "worker_retry_exhausted":
        stage = "任务恢复"
        reason = "已保存任务的租约恢复次数已用尽"
    case "task_execution_failed":
        stage = "任务执行"
        reason = "任务在生成有效综合结果前中断"
    default:
        stage = "证据绑定"
        reason = "membership、冻结证据、授权或请求身份已不再有效"
    }
    return (stage, reason)
}
