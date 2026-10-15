import Foundation

func validateAnnualConditionalDecisionPreviewRawShape(_ data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw AnnualConditionalDecisionValidationError.invalid(["conditional decision preview must be a JSON object"])
    }
    try validateAnnualConditionalDecisionPreviewRawObject(root)
}

func validateAnnualConditionalDecisionPreviewRawObject(_ root: [String: Any]) throws {
    var errors: [String] = []
    conditionalExactKeys(
        root,
        allowed: ["schemaVersion", "generatedAt", "status", "previewId", "membershipId", "requestedActorId", "requestedSymbol", "data", "safety", "message"],
        label: "conditional decision preview",
        errors: &errors
    )
    conditionalExactObjectKeys(
        root["safety"],
        allowed: [
            "advisoryOnly", "humanJudgmentOnly", "changesCandidateOrdering", "recommendation", "ranking", "score",
            "targetPrice", "targetPosition", "tradeDirection", "suggestedAmount", "automaticDecision",
            "automaticWorkflowTransition", "createsOrder", "createsTrade", "callsBroker", "mutatesOfficialPortfolio", "productionWrite"
        ],
        label: "conditional decision safety",
        errors: &errors
    )
    conditionalForbiddenKeys(root, label: "conditional decision preview", errors: &errors)
    if root["status"] as? String == "available" {
        validateAvailableConditionalRaw(root, errors: &errors)
    } else if !(root["data"] is NSNull) || !(root["previewId"] is NSNull) || !(root["requestedSymbol"] is NSNull) {
        errors.append("fail-closed conditional decision preview must clear facts and identities")
    }
    if !errors.isEmpty { throw AnnualConditionalDecisionValidationError.invalid(errors) }
}

func validateAnnualConditionalDecisionWriteRaw(
    _ data: Data,
    request: CreateDecisionCheckRequest
) throws {
    guard request.conditionalDecision != nil else { return }
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let payload = root["data"] as? [String: Any],
          let conditional = payload["conditionalDecision"] else {
        throw AnnualConditionalDecisionValidationError.invalid(["conditional decision write response is missing preserved state"])
    }
    try validateAnnualConditionalDecisionStateRawShape(conditional, label: "conditional decision write")
    guard let conditional = conditional as? [String: Any], conditional["availability"] as? String == "preserved" else {
        throw AnnualConditionalDecisionValidationError.invalid(["conditional decision write must preserve the confirmed preview"])
    }
}

func validateAnnualConditionalDecisionStateRawShape(_ value: Any, label: String) throws {
    guard let conditional = value as? [String: Any] else {
        throw AnnualConditionalDecisionValidationError.invalid(["\(label) must be an object"])
    }
    var errors: [String] = []
    conditionalExactKeys(
        conditional,
        allowed: ["availability", "preview", "judgment", "monitor", "limitation"],
        label: label,
        errors: &errors
    )
    if conditional["availability"] as? String == "conditional_decision_not_captured" {
        if !(conditional["preview"] is NSNull) || !(conditional["judgment"] is NSNull)
            || !(conditional["monitor"] is NSNull)
            || !((conditional["limitation"] as? String)?.contains("not reconstructed") ?? false) {
            errors.append("\(label) uncaptured state must not reconstruct facts")
        }
        conditionalForbiddenKeys(conditional, label: label, errors: &errors)
        if !errors.isEmpty { throw AnnualConditionalDecisionValidationError.invalid(errors) }
        return
    }
    if conditional["availability"] as? String != "preserved" {
        errors.append("\(label) availability is invalid")
    }
    if let preview = conditional["preview"] as? [String: Any] {
        do {
            try validateAnnualConditionalDecisionPreviewRawObject(preview)
        } catch {
            errors.append("\(label) preview identity is invalid")
        }
    } else {
        errors.append("\(label) preview is missing")
    }
    conditionalExactObjectKeys(
        conditional["judgment"],
        allowed: [
            "confidence", "assumptions", "invalidationConditions", "portfolioObservationConditions",
            "observationWindow", "reviewOn", "workflowState"
        ],
        label: "\(label) judgment",
        errors: &errors
    )
    if let judgment = conditional["judgment"] as? [String: Any] {
        conditionalExactObjectKeys(judgment["observationWindow"], allowed: ["startsOn", "endsOn"], label: "\(label) observation window", errors: &errors)
        if let conditions = judgment["portfolioObservationConditions"] as? [Any] {
            for (index, condition) in conditions.enumerated() {
                conditionalExactObjectKeys(
                    condition,
                    allowed: ["metric", "comparison", "threshold", "rationale", "purpose"],
                    label: "\(label) portfolio observation \(index)",
                    errors: &errors
                )
            }
        } else {
            errors.append("\(label) portfolio observations must be an array")
        }
    }
    conditionalExactObjectKeys(
        conditional["monitor"],
        allowed: [
            "evaluatedAt", "state", "reasons", "changes", "currentFacts", "invalidationReminder", "humanReviewRequested",
            "automaticDecision", "automaticWorkflowTransition", "createsOrder", "createsTrade", "callsBroker"
        ],
        label: "\(label) monitor",
        errors: &errors
    )
    if let monitor = conditional["monitor"] as? [String: Any] {
        conditionalExactObjectKeys(
            monitor["currentFacts"],
            allowed: [
                "membershipId", "membershipVersion", "membershipState", "decisionContextId", "decisionContextHash",
                "valuationQuoteSnapshotId", "valuationQuotePrice", "valuationCalculationVersion", "quantSnapshotId",
                "quantSnapshotHash", "quantModelVersion", "quantCodeIdentity", "portfolioLabQuantEvidenceId",
                "portfolioContextId", "portfolioSnapshotId", "riskImpactId", "scenarioCandidateWeight",
                "scenarioLargestPositionWeight", "scenarioHhi"
            ],
            label: "\(label) monitor current facts",
            errors: &errors
        )
        if let changes = monitor["changes"] as? [Any] {
            for (index, change) in changes.enumerated() {
                conditionalExactObjectKeys(
                    change,
                    allowed: ["reason", "field", "frozenValue", "currentValue", "detail"],
                    label: "\(label) monitor change \(index)",
                    errors: &errors
                )
            }
        } else {
            errors.append("\(label) monitor changes must be an array")
        }
    }
    conditionalForbiddenKeys(conditional, label: label, errors: &errors)
    if !errors.isEmpty { throw AnnualConditionalDecisionValidationError.invalid(errors) }
}

private func validateAvailableConditionalRaw(_ root: [String: Any], errors: inout [String]) {
    guard let payload = root["data"] as? [String: Any] else {
        errors.append("available conditional decision preview requires data")
        return
    }
    conditionalExactKeys(
        payload,
        allowed: ["decisionBrief", "valuationQuant", "portfolioLab", "selectedPortfolioScenarioIndex"],
        label: "conditional decision preview data",
        errors: &errors
    )
    validateNestedRawObject(payload["decisionBrief"], label: "decision brief", validator: validateAnnualDecisionBriefRawObject, errors: &errors)
    validateConditionalDecisionBriefTypedRoundTrip(payload["decisionBrief"], errors: &errors)
    validateNestedRawObject(payload["valuationQuant"], label: "valuation quant", validator: validateAnnualValuationQuantRawObject, errors: &errors)
    validateNestedRawObject(payload["portfolioLab"], label: "portfolio lab", validator: validateAnnualPortfolioLabRawObject, errors: &errors)
    if let brief = payload["decisionBrief"] as? [String: Any],
       let data = brief["data"] as? [String: Any] {
        conditionalExactObjectKeys(
            data["target"],
            allowed: ["membershipId", "membershipVersion", "membershipState", "market", "code", "symbol"],
            label: "conditional decision brief target",
            errors: &errors
        )
    }
    guard let previewId = root["previewId"] as? String else {
        errors.append("available conditional decision preview requires previewId")
        return
    }
    do {
        let expected = try annualConditionalDecisionPreviewContentId(root)
        if previewId != expected { errors.append("conditional decision previewId does not match canonical bound facts") }
    } catch {
        errors.append("conditional decision preview canonical identity cannot be recomputed")
    }
}

func annualConditionalDecisionPreviewContentId(_ root: [String: Any]) throws -> String {
    var normalized = root
    normalized.removeValue(forKey: "previewId")
    normalized.removeValue(forKey: "generatedAt")
    guard var payload = normalized["data"] as? [String: Any] else {
        return try portfolioDecisionContentId(object: normalized, prefix: "annual-conditional-preview:", excludingTopLevelKeys: [])
    }
    if var brief = payload["decisionBrief"] as? [String: Any] {
        brief.removeValue(forKey: "generatedAt")
        if var metadata = brief["metadata"] as? [String: Any] { metadata.removeValue(forKey: "fetchedAt"); brief["metadata"] = metadata }
        if var data = brief["data"] as? [String: Any], var source = data["sourceIdentity"] as? [String: Any] {
            source.removeValue(forKey: "generatedAt"); data["sourceIdentity"] = source; brief["data"] = data
        }
        payload["decisionBrief"] = brief
    }
    if var valuation = payload["valuationQuant"] as? [String: Any] {
        valuation.removeValue(forKey: "generatedAt")
        if var metadata = valuation["metadata"] as? [String: Any] { metadata.removeValue(forKey: "fetchedAt"); valuation["metadata"] = metadata }
        if var data = valuation["data"] as? [String: Any], var source = data["sourceIdentity"] as? [String: Any] {
            source.removeValue(forKey: "generatedAt"); data["sourceIdentity"] = source; valuation["data"] = data
        }
        payload["valuationQuant"] = valuation
    }
    if var lab = payload["portfolioLab"] as? [String: Any] {
        lab.removeValue(forKey: "generatedAt")
        lab.removeValue(forKey: "labId")
        if var data = lab["data"] as? [String: Any], var portfolio = data["portfolio"] as? [String: Any] {
            portfolio.removeValue(forKey: "assembledAt"); data["portfolio"] = portfolio; lab["data"] = data
        }
        payload["portfolioLab"] = lab
    }
    normalized["data"] = payload
    return try portfolioDecisionContentId(object: normalized, prefix: "annual-conditional-preview:", excludingTopLevelKeys: [])
}

func validateAnnualConditionalMonitorRawShape(_ value: Any, label: String) throws {
    var errors: [String] = []
    conditionalExactObjectKeys(
        value,
        allowed: [
            "evaluatedAt", "state", "reasons", "changes", "currentFacts", "invalidationReminder", "humanReviewRequested",
            "automaticDecision", "automaticWorkflowTransition", "createsOrder", "createsTrade", "callsBroker"
        ],
        label: label,
        errors: &errors
    )
    if let monitor = value as? [String: Any] {
        conditionalExactObjectKeys(
            monitor["currentFacts"],
            allowed: [
                "membershipId", "membershipVersion", "membershipState", "decisionContextId", "decisionContextHash",
                "valuationQuoteSnapshotId", "valuationQuotePrice", "valuationCalculationVersion", "quantSnapshotId",
                "quantSnapshotHash", "quantModelVersion", "quantCodeIdentity", "portfolioLabQuantEvidenceId",
                "portfolioContextId", "portfolioSnapshotId", "riskImpactId", "scenarioCandidateWeight",
                "scenarioLargestPositionWeight", "scenarioHhi"
            ],
            label: "\(label) current facts",
            errors: &errors
        )
        if let changes = monitor["changes"] as? [Any] {
            for (index, change) in changes.enumerated() {
                conditionalExactObjectKeys(
                    change,
                    allowed: ["reason", "field", "frozenValue", "currentValue", "detail"],
                    label: "\(label) change \(index)",
                    errors: &errors
                )
            }
        } else {
            errors.append("\(label) changes must be an array")
        }
    }
    conditionalForbiddenKeys(value, label: label, errors: &errors)
    if !errors.isEmpty { throw AnnualConditionalDecisionValidationError.invalid(errors) }
}

private func validateNestedRawObject(
    _ value: Any?,
    label: String,
    validator: ([String: Any]) throws -> Void,
    errors: inout [String]
) {
    guard let object = value as? [String: Any] else {
        errors.append("conditional decision \(label) must be an object")
        return
    }
    do { try validator(object) }
    catch { errors.append("conditional decision \(label) raw shape is invalid") }
}

private func validateConditionalDecisionBriefTypedRoundTrip(_ value: Any?, errors: inout [String]) {
    guard let object = value as? [String: Any],
          let wire = try? JSONSerialization.data(withJSONObject: object),
          let decoded = try? JSONDecoder().decode(AnnualDecisionBriefEnvelope.self, from: wire),
          let encoded = try? JSONEncoder().encode(decoded),
          let typed = try? JSONSerialization.jsonObject(with: encoded) else {
        errors.append("conditional decision brief cannot complete a typed raw round-trip")
        return
    }
    let normalizedRaw = normalizeConditionalKnownNullableFields(object)
    let normalizedTyped = normalizeConditionalKnownNullableFields(typed)
    if !conditionalJSONEqual(normalizedRaw, normalizedTyped) {
        errors.append("conditional decision brief raw facts contain fields lost by typed decoding")
    }
}

private func normalizeConditionalKnownNullableFields(_ value: Any) -> Any {
    if let array = value as? [Any] {
        return array.map(normalizeConditionalKnownNullableFields)
    }
    guard let object = value as? [String: Any] else { return value }
    let nullable = Set(["correctionOf", "replaces", "sourceUrl"])
    return object.reduce(into: [String: Any]()) { result, entry in
        if entry.value is NSNull, nullable.contains(entry.key) { return }
        result[entry.key] = normalizeConditionalKnownNullableFields(entry.value)
    }
}

private func conditionalJSONEqual(_ lhs: Any, _ rhs: Any) -> Bool {
    if let left = lhs as? [String: Any], let right = rhs as? [String: Any] {
        return Set(left.keys) == Set(right.keys)
            && left.allSatisfy { key, value in right[key].map { conditionalJSONEqual(value, $0) } == true }
    }
    if let left = lhs as? [Any], let right = rhs as? [Any] {
        return left.count == right.count && zip(left, right).allSatisfy { conditionalJSONEqual($0.0, $0.1) }
    }
    return (lhs as AnyObject).isEqual(rhs)
}

private func conditionalExactObjectKeys(_ value: Any?, allowed: Set<String>, label: String, errors: inout [String]) {
    guard let object = value as? [String: Any] else { errors.append("\(label) must be an object"); return }
    conditionalExactKeys(object, allowed: allowed, label: label, errors: &errors)
}

private func conditionalExactKeys(_ value: [String: Any], allowed: Set<String>, label: String, errors: inout [String]) {
    for key in value.keys where !allowed.contains(key) { errors.append("\(label) contains unsupported field \(key)") }
    for key in allowed where value[key] == nil { errors.append("\(label) is missing field \(key)") }
}

private func conditionalForbiddenKeys(_ value: Any, label: String, errors: inout [String]) {
    if let array = value as? [Any] {
        for child in array { conditionalForbiddenKeys(child, label: label, errors: &errors) }
        return
    }
    guard let object = value as? [String: Any] else { return }
    let forbidden = ["recommendedAction", "rankingScore", "suggestedPosition", "orderRequest", "brokerAccount", "automaticTransition"]
    for (key, child) in object {
        if forbidden.contains(key) { errors.append("\(label) contains forbidden field \(key)") }
        conditionalForbiddenKeys(child, label: label, errors: &errors)
    }
}
