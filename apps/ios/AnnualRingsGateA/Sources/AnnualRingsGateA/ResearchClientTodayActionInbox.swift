import Foundation

public protocol TodayActionInboxFetching: Sendable {
    func fetchTodayActionInbox() async -> TodayActionInboxEnvelope
    func writeTodayMaterialChangeDisposition(item: TodayActionInboxItem, request: TodayMaterialChangeDispositionRequest) async throws -> ResearchWriteEnvelope<TodayMaterialChangeDispositionData>
}

public extension TodayActionInboxFetching {
    func writeTodayMaterialChangeDisposition(
        item: TodayActionInboxItem,
        request: TodayMaterialChangeDispositionRequest
    ) async throws -> ResearchWriteEnvelope<TodayMaterialChangeDispositionData> {
        throw URLError(.unsupportedURL)
    }
}

extension ResearchClient: TodayActionInboxFetching {
    public func writeTodayMaterialChangeDisposition(
        item: TodayActionInboxItem,
        request body: TodayMaterialChangeDispositionRequest
    ) async throws -> ResearchWriteEnvelope<TodayMaterialChangeDispositionData> {
        let url = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "today")
            .appending(path: "inbox")
            .appending(path: "material-dispositions")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        let envelope = try JSONDecoder().decode(ResearchWriteEnvelope<TodayMaterialChangeDispositionData>.self, from: data)
        try envelope.validateForDisplay(item: item, request: body)
        return envelope
    }

    public func fetchTodayActionInbox() async -> TodayActionInboxEnvelope {
        let url = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "today")
            .appending(path: "inbox")
        var request = URLRequest(url: url)
        applyAuth(to: &request)
        do {
            let (data, response) = try await session.data(for: request)
            if failedHTTPResponse(response) != nil {
                let failClosed = try? decode(data)
                if let failClosed, failClosed.status != .available { return failClosed }
            }
            try validate(response: response)
            let envelope = try decode(data)
            guard envelope.status == .available || envelope.status == .empty else {
                throw TodayActionInboxValidationError.invalid(["successful Today inbox response must be available or empty"])
            }
            return envelope
        } catch ResearchClientError.httpStatus(401), ResearchClientError.httpStatus(403) {
            return .unavailable(.unauthorized, message: "未认证：需要读取授权后查看 Today 行动收件箱。")
        } catch is DecodingError {
            return .unavailable(.unavailable, message: "Today 行动收件箱响应格式或语义无效，已停止展示。")
        } catch is TodayActionInboxValidationError {
            return .unavailable(.unavailable, message: "Today 行动收件箱响应格式或语义无效，已停止展示。")
        } catch {
            return .unavailable(.unavailable, message: "Today 行动收件箱不可用：\(error.localizedDescription)")
        }
    }

    private func decode(_ data: Data) throws -> TodayActionInboxEnvelope {
        try validateTodayActionInboxRawShape(data)
        let envelope = try JSONDecoder().decode(TodayActionInboxEnvelope.self, from: data)
        try envelope.validateForDisplay()
        return envelope
    }
}

private func validateTodayActionInboxRawShape(_ data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw TodayActionInboxValidationError.invalid(["Today action inbox must be an object"])
    }
    var errors: [String] = []
    rejectInboxUnknown(root, allowed: [
        "schemaVersion", "generatedAt", "status", "requestedActorId", "metadata",
        "trackedMembershipCount", "omittedMembershipCount", "items", "omittedItemCount", "message", "safety"
    ], label: "envelope", errors: &errors)
    requireInboxObject(root["metadata"], allowed: [
        "source", "asOf", "fetchedAt", "freshness", "provenance", "authority",
        "stale", "missing", "conflict", "fixture", "correctionOf", "replaces", "message"
    ], label: "metadata", errors: &errors)
    requireInboxObject(root["safety"], allowed: [
        "advisoryOnly", "createsOrder", "createsTrade", "mutatesCash", "writesFee",
        "mutatesPosition", "callsBroker", "productionWrite"
    ], label: "safety", errors: &errors)
    if let items = root["items"] as? [[String: Any]] {
        for (index, item) in items.enumerated() {
            rejectInboxUnknown(item, allowed: [
                "id", "order", "kind", "priority", "state", "symbol", "membership", "source",
                "title", "summary", "versionChange", "researchTarget", "reviewEvent"
            ], label: "items[\(index)]", errors: &errors)
            requireInboxObject(item["membership"], allowed: ["id", "version", "symbol"], label: "items[\(index)].membership", errors: &errors)
            requireInboxObject(item["source"], allowed: ["lane", "id", "version", "status", "sourceType", "effectiveAt", "asOf", "fetchedAt", "validUntil", "freshness", "sourceFingerprint"], label: "items[\(index)].source", errors: &errors)
            if let target = item["researchTarget"] as? [String: Any] {
                rejectInboxUnknown(target, allowed: ["itemId", "preferredLayer", "report", "task"], label: "items[\(index)].researchTarget", errors: &errors)
                if let report = target["report"] as? [String: Any] {
                    rejectInboxUnknown(report, allowed: ["id", "version", "evidencePackId"], label: "items[\(index)].researchTarget.report", errors: &errors)
                }
                if let task = target["task"] as? [String: Any] {
                    rejectInboxUnknown(task, allowed: ["id", "requestFingerprint", "evidencePackId", "evidencePackFingerprint", "completedAt"], label: "items[\(index)].researchTarget.task", errors: &errors)
                }
            }
            if let event = item["reviewEvent"] as? [String: Any] {
                let formal = event["type"] as? String == "FORMAL_DECISION_DUE"
                rejectInboxUnknown(event, allowed: formal ? [
                    "id", "type", "subject", "sourceEventId", "effectiveAt", "priority", "state",
                    "stateChangedAt", "stateActor", "stateReason", "reportBinding"
                ] : [
                    "id", "type", "subject", "sourceEventId", "effectiveAt", "priority", "state",
                    "stateChangedAt", "stateActor", "stateReason", "bindings", "humanDecision", "researchReport"
                ], label: "items[\(index)].reviewEvent", errors: &errors)
                for (key, allowed) in [
                    ("priority", ["severity", "dueAt"]),
                    ("stateActor", ["actorType", "actorId"]),
                    ("bindings", ["decisionCheckId", "reviewId"]),
                    ("humanDecision", ["actionIntent", "humanCheckResult", "userFinalDecision", "reviewDueOn", "formalDecision"]),
                    ("researchReport", ["availability", "binding", "investmentThesis", "invalidationConditions", "nextValidationQuestion", "limitation"])
                ] {
                    if let nested = event[key] as? [String: Any] {
                        rejectInboxUnknown(nested, allowed: allowed, label: "items[\(index)].reviewEvent.\(key)", errors: &errors)
                    }
                }
                if let humanDecision = event["humanDecision"] as? [String: Any],
                   let formalDecision = humanDecision["formalDecision"] {
                    do { try validateFormalDecisionRawShape(formalDecision, label: "items[\(index)].reviewEvent.humanDecision.formalDecision") }
                    catch { errors.append("items[\(index)].reviewEvent.humanDecision.formalDecision is invalid") }
                }
                let bindingKeys = [
                    "bindingVersion", "membershipId", "membershipVersion", "symbol", "evidencePackId",
                    "evidencePackFingerprint", "reportId", "reportVersion", "contractVersion",
                    "reportFingerprint", "reportDecisionId", "reportDecision", "reportDecisionActorType",
                    "reportDecisionActorId", "decidedAt"
                ]
                if formal {
                    requireInboxObject(event["reportBinding"], allowed: bindingKeys, label: "items[\(index)].reviewEvent.reportBinding", errors: &errors)
                } else if let report = event["researchReport"] as? [String: Any], report["availability"] as? String == "preserved" {
                    requireInboxObject(report["binding"], allowed: bindingKeys, label: "items[\(index)].reviewEvent.researchReport.binding", errors: &errors)
                }
            }
        }
    }
    if !errors.isEmpty { throw TodayActionInboxValidationError.invalid(errors) }
}

private func requireInboxObject(
    _ candidate: Any?,
    allowed: [String],
    label: String,
    errors: inout [String]
) {
    guard let value = candidate as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    rejectInboxUnknown(value, allowed: allowed, label: label, errors: &errors)
}

private func rejectInboxUnknown(
    _ value: [String: Any],
    allowed: [String],
    label: String,
    errors: inout [String]
) {
    let allowedKeys = Set(allowed)
    for key in value.keys where !allowedKeys.contains(key) {
        errors.append("\(label).\(key) is not allowed")
    }
}
