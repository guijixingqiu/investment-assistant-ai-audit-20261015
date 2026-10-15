import Foundation

public let cloudAiPolicySchemaVersion = "2026-08-18.cloud-ai-policy.v2"
public let cloudAiProviderPolicyVersion = "deepseek-flash.2026-09-10.v1"
let legacyCloudAiProviderPolicyVersion = "deepseek-v4-flash.2026-08-17.v1"
func cloudAiModelPolicyMatches(_ model: String, _ version: String) -> Bool {
    (model == "deepseek-flash" && version == cloudAiProviderPolicyVersion)
        || (model == "deepseek-v4-flash" && version == legacyCloudAiProviderPolicyVersion)
}
func cloudAiCostEstimate(_ input: Int, _ output: Int, model: String, pricing: String?) -> Double? {
    let legacy = model == "deepseek-v4-flash" && pricing == "deepseek-v4-flash.2026-08-13"
    guard legacy || (model == "deepseek-flash" && pricing == "deepseek-flash.2026-09-10.peak") else { return nil }
    return ((Double(input) * (legacy ? 0.14 : 0.3) + Double(output) * (legacy ? 0.28 : 1.2))
        / 1_000_000 * 100_000_000).rounded() / 100_000_000
}

public struct CloudAiProviderPolicy: Codable, Equatable, Sendable {
    public let provider: String
    public let model: String
    public let policyVersion: String
    public let purposes: [String]
    public let privacyPolicyUrl: String
    public let pricingUrl: String
    public let retention: String
    public let training: String
    public let noTrainingGuaranteed: Bool
    public let processingRegion: String
    public let crossBorderProcessing: Bool
    public let fullPdfSent: Bool
    public let credentialsSent: Bool
    public let officialAssetFactsSent: Bool
    public let automaticFallback: Bool
    public let backupProvider: String
    public let deletionContact: String

    public var isExactCurrentPolicy: Bool {
        isKnownPolicy && policyVersion == cloudAiProviderPolicyVersion
    }
    var isKnownPolicy: Bool {
        provider == "deepseek" && cloudAiModelPolicyMatches(model, policyVersion)
            && purposes == ["deep_research_synthesis", "report_evidence_question"]
            && retention == "variable_no_fixed_duration"
            && training == "may_use_inputs_opt_out_not_verified"
            && !noTrainingGuaranteed && processingRegion == "People's Republic of China"
            && crossBorderProcessing && !fullPdfSent && !credentialsSent
            && !officialAssetFactsSent && !automaticFallback
            && backupProvider == "none" && deletionContact == "redacted@example.invalid"
            && URL(string: privacyPolicyUrl)?.scheme == "https"
            && URL(string: pricingUrl)?.scheme == "https"
    }

    public var sendManifestSummary: String {
        "地区 \(processingRegion) · 跨境 \(crossBorderProcessing ? "是" : "否") · 保留 \(retention) · 训练 \(training) · no-training \(noTrainingGuaranteed ? "是" : "否") · 备用 \(backupProvider) · 删除 \(deletionContact)"
    }
}

public struct CloudAiPolicyState: Codable, Equatable, Sendable {
    public struct DeletionRequest: Codable, Equatable, Sendable {
        public let status: String
        public let requestedAt: String?
    }
    public let actorId: String
    public let status: String
    public let confirmedPolicyVersion: String?
    public let confirmedBackupProvider: String?
    public let confirmedAt: String?
    public let revokedAt: String?
    public let deletionRequest: DeletionRequest

    public var isValidSendAuthorizationSnapshot: Bool {
        isKnownSendAuthorizationSnapshot(policyVersion: cloudAiProviderPolicyVersion)
    }
    func isKnownSendAuthorizationSnapshot(policyVersion: String) -> Bool {
        !actorId.isEmpty && status == "enabled"
            && [cloudAiProviderPolicyVersion, legacyCloudAiProviderPolicyVersion].contains(policyVersion)
            && confirmedPolicyVersion == policyVersion
            && confirmedBackupProvider == "none"
            && cloudAiInstant(confirmedAt)
            && revokedAt == nil
            && deletionRequest.status == "not_requested"
            && deletionRequest.requestedAt == nil
    }

    public var sendAuthorizationSummary: String {
        "发送时 Owner 授权 \(status) · policy \(confirmedPolicyVersion ?? "UNKNOWN") · 确认 \(confirmedAt ?? "UNKNOWN") · 备用 \(confirmedBackupProvider ?? "UNKNOWN") · 当时未撤权、未请求删除"
    }
}

public struct CloudAiPolicySafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let sendsCredentials: Bool
    public let sendsOfficialAssetFacts: Bool
    public let sendsFullPdf: Bool
    public let automaticFallback: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let mutatesOfficialPortfolio: Bool
    public let productionWrite: Bool
}

public struct CloudAiPolicyEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let generatedAt: String
    public let status: String
    public let requestedActorId: String
    public let policy: CloudAiProviderPolicy
    public let state: CloudAiPolicyState?
    public let message: String
    public let safety: CloudAiPolicySafety

    public var isEnabled: Bool {
        status == "available"
            && state?.status == "enabled"
            && state?.confirmedPolicyVersion == cloudAiProviderPolicyVersion
            && state?.confirmedBackupProvider == "none"
            && state?.deletionRequest.status == "not_requested"
    }

    public func hasSameReadbackIdentity(as other: Self) -> Bool {
        schemaVersion == other.schemaVersion
            && status == other.status
            && requestedActorId == other.requestedActorId
            && policy == other.policy
            && state == other.state
            && safety == other.safety
    }

    public func validateForDisplay(expectedActorId: String) throws {
        var errors: [String] = []
        if schemaVersion != cloudAiPolicySchemaVersion { errors.append("schemaVersion is invalid") }
        if !cloudAiInstant(generatedAt) { errors.append("generatedAt is invalid") }
        if !["available", "unauthorized", "unavailable"].contains(status) { errors.append("status is invalid") }
        if requestedActorId != expectedActorId || requestedActorId.isEmpty { errors.append("requestedActorId is invalid") }
        if !policy.isExactCurrentPolicy {
            errors.append("provider policy is invalid")
        }
        if status == "available" {
            guard let state else { errors.append("available policy requires state"); throw CloudAiPolicyValidationError.invalid(errors) }
            if state.actorId != expectedActorId || !["needs_confirmation", "enabled", "disabled"].contains(state.status) { errors.append("state identity or status is invalid") }
            if let confirmedAt = state.confirmedAt, !cloudAiInstant(confirmedAt) { errors.append("confirmedAt is invalid") }
            if let revokedAt = state.revokedAt, !cloudAiInstant(revokedAt) { errors.append("revokedAt is invalid") }
            if state.confirmedBackupProvider != nil && state.confirmedBackupProvider != "none" { errors.append("confirmed backup provider is invalid") }
            if state.status == "enabled" && (state.confirmedPolicyVersion != cloudAiProviderPolicyVersion || state.confirmedBackupProvider != "none" || state.confirmedAt == nil || state.revokedAt != nil
                || state.deletionRequest.status != "not_requested") { errors.append("enabled state is inconsistent") }
            if state.deletionRequest.status == "not_requested" && state.deletionRequest.requestedAt != nil { errors.append("deletion status is inconsistent") }
            if state.deletionRequest.status == "requested_unconfirmed" && !cloudAiInstant(state.deletionRequest.requestedAt) { errors.append("deletion request time is invalid") }
            if !["not_requested", "requested_unconfirmed"].contains(state.deletionRequest.status) { errors.append("deletion status is invalid") }
        } else if state != nil { errors.append("non-available policy must clear state") }
        if message.isEmpty || !safety.advisoryOnly || safety.sendsCredentials || safety.sendsOfficialAssetFacts
            || safety.sendsFullPdf || safety.automaticFallback || safety.createsOrder || safety.createsTrade
            || safety.mutatesOfficialPortfolio || safety.productionWrite { errors.append("message or safety is invalid") }
        if !errors.isEmpty { throw CloudAiPolicyValidationError.invalid(errors) }
    }
}

public enum CloudAiPolicyAction: String, Codable, Sendable { case enable, disable, requestDeletion = "request_deletion" }

public struct CloudAiPolicyDecisionRequest: Encodable, Sendable {
    public let action: CloudAiPolicyAction
    public let policyVersion = cloudAiProviderPolicyVersion
    public let backupProvider = "none"
    public let ownerConfirmed = true
    public let idempotencyKey: String
}

public enum CloudAiPolicyValidationError: Error, Equatable, Sendable { case invalid([String]) }

extension ResearchClient {
    public func fetchCloudAiPolicy(expectedActorId: String) async throws -> CloudAiPolicyEnvelope {
        var request = URLRequest(url: cloudAiPolicyURL, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        request.setValue(expectedActorId, forHTTPHeaderField: "x-research-expected-actor-id")
        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        let envelope = try JSONDecoder().decode(CloudAiPolicyEnvelope.self, from: data)
        try envelope.validateForDisplay(expectedActorId: expectedActorId)
        return envelope
    }

    public func decideCloudAiPolicyAndReadBack(
        action: CloudAiPolicyAction,
        idempotencyKey: String,
        expectedActorId: String
    ) async throws -> CloudAiPolicyEnvelope {
        var request = URLRequest(url: cloudAiPolicyURL.appending(path: "decisions"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue(expectedActorId, forHTTPHeaderField: "x-research-expected-actor-id")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(CloudAiPolicyDecisionRequest(
            action: action,
            idempotencyKey: idempotencyKey
        ))
        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        let posted = try JSONDecoder().decode(CloudAiPolicyEnvelope.self, from: data)
        try posted.validateForDisplay(expectedActorId: expectedActorId)
        let fresh = try await fetchCloudAiPolicy(expectedActorId: expectedActorId)
        guard posted.hasSameReadbackIdentity(as: fresh) else { throw CloudAiPolicyValidationError.invalid(["fresh policy readback differs from write response"]) }
        return fresh
    }

    private var cloudAiPolicyURL: URL {
        baseURL.appending(path: "api").appending(path: "mobile").appending(path: "research").appending(path: "cloud-ai-policy")
    }
}

private func cloudAiInstant(_ value: String?) -> Bool {
    guard let value else { return false }
    return isParseableDateTime(value)
}
