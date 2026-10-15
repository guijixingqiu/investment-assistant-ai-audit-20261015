import Foundation

public enum TodayResearchActionDestination: String, Equatable, Sendable {
    case materials
    case freezeEvidence
    case createReport
    case reportDecision
    case item

    public init(trackingState: TodayResearchTrackingState, hasReport: Bool) {
        if hasReport {
            self = .reportDecision
            return
        }
        switch trackingState {
        case .needsMaterial:
            self = .materials
        case .needsEvidencePack:
            self = .freezeEvidence
        case .needsResearch:
            self = .createReport
        default:
            self = .item
        }
    }
}

func validateTodayResearchRawShape(_ data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw TodayResearchValidationError.invalid(["Today response must be an object"])
    }
    var errors: [String] = []
    todayExact(root, [
        "schemaVersion", "generatedAt", "status", "membershipId", "membershipVersion",
        "requestedActorId", "requestedSymbol", "metadata", "items", "omittedItemCount",
        "quality", "message", "safety"
    ], "Today", &errors)
    todayObject(root["metadata"], [
        "source", "asOf", "fetchedAt", "freshness", "provenance", "authority", "stale",
        "missing", "conflict", "fixture", "correctionOf", "replaces", "message"
    ], "Today.metadata", &errors)
    todayObject(root["safety"], [
        "advisoryOnly", "createsOrder", "createsTrade", "mutatesCash", "writesFee",
        "mutatesPosition", "callsBroker", "productionWrite"
    ], "Today.safety", &errors)
    if let quality = todayOptionalObject(root["quality"], [
        "sourceHealth", "researchStructure", "secondOpinion"
    ], "Today.quality", &errors) {
        if let sourceHealth = todayObject(quality["sourceHealth"], [
            "id", "status", "issueCodes", "totalMaterialCount", "currentMaterialCount", "evidencePackRef"
        ], "Today.quality.sourceHealth", &errors) {
            todayOptionalObject(
                sourceHealth["evidencePackRef"],
                ["id", "version", "packFingerprint"],
                "Today.quality.sourceHealth.evidencePackRef",
                &errors
            )
        }
        if let structure = todayObject(quality["researchStructure"], [
            "id", "status", "checks", "gateFailures", "reportRef"
        ], "Today.quality.researchStructure", &errors) {
            todayObjects(
                structure["checks"],
                ["id", "passed"],
                "Today.quality.researchStructure.checks",
                &errors
            )
            todayOptionalObject(
                structure["reportRef"],
                ["id", "version", "evidencePackId", "status"],
                "Today.quality.researchStructure.reportRef",
                &errors
            )
        }
        todayObject(
            quality["secondOpinion"],
            ["status", "dependencyIncluded", "reason"],
            "Today.quality.secondOpinion",
            &errors
        )
    }

    if let items = root["items"] as? [Any] {
        for (index, value) in items.enumerated() {
            guard let item = todayObjectAllowingOptional(value, [
                "id", "order", "category", "priority", "trackingState", "symbol", "title",
                "summary", "thesis", "invalidationConditions", "nextCheckpoint", "versionChange", "bindings"
            ], ["reportRevision"], "Today.items[\(index)]", &errors) else { continue }
            if item["reportRevision"] != nil {
                todayOptionalObject(
                    item["reportRevision"],
                    ["current", "previous", "declaredChange", "changedSections", "unchangedSections", "bindingChanged"],
                    "Today.items[\(index)].reportRevision",
                    &errors
                )
            }
            if let revision = item["reportRevision"] as? [String: Any] {
                todayObject(revision["current"], ["id", "version", "evidencePackId", "reportFingerprint"], "Today.items[\(index)].reportRevision.current", &errors)
                todayOptionalObject(revision["previous"], ["id", "version", "evidencePackId", "reportFingerprint"], "Today.items[\(index)].reportRevision.previous", &errors)
            }
            guard let bindings = todayObject(item["bindings"], [
                "membershipId", "membershipVersion", "factRefs", "eventRefs", "monitorRef",
                "evidencePackRef", "reportRef", "decisionRef", "holdingSnapshotRefs"
            ], "Today.items[\(index)].bindings", &errors) else { continue }
            todayObjects(bindings["factRefs"], [
                "materialId", "evidenceId", "sourceType", "sourceVersion", "revision",
                "contentFingerprint", "publishedAt", "capturedAt", "validUntil",
                "verificationStatus", "rightsStatus"
            ], "Today.items[\(index)].bindings.factRefs", &errors)
            if let eventRefs = bindings["eventRefs"] as? [Any] {
                for (eventIndex, value) in eventRefs.enumerated() {
                    let label = "Today.items[\(index)].bindings.eventRefs[\(eventIndex)]"
                    guard let event = todayObjectAllowingOptional(value, [
                        "eventId", "eventVersion", "eventFingerprint", "coverageScope",
                        "keyVariable", "hypothesisImpact"
                    ], ["monitorRuleBinding"], label, &errors) else { continue }
                    if event["monitorRuleBinding"] != nil {
                        todayOptionalObject(event["monitorRuleBinding"], [
                            "variableName", "category", "source", "cadence", "threshold",
                            "reason", "enabled", "version", "confirmedAt"
                        ], "\(label).monitorRuleBinding", &errors)
                    }
                }
            } else {
                errors.append("Today.items[\(index)].bindings.eventRefs must be an array")
            }
            todayObjects(bindings["holdingSnapshotRefs"], [
                "accountScopeId", "snapshotId", "sourceBatchId", "sourceAsOf", "positionSourceRowId"
            ], "Today.items[\(index)].bindings.holdingSnapshotRefs", &errors)
            todayOptionalObject(bindings["monitorRef"], ["kind", "id", "runVersion", "runFingerprint"], "Today monitorRef", &errors)
            todayOptionalObject(bindings["evidencePackRef"], ["id", "version", "packFingerprint"], "Today evidencePackRef", &errors)
            todayOptionalObject(bindings["reportRef"], ["id", "version", "evidencePackId", "status"], "Today reportRef", &errors)
            todayOptionalObject(bindings["decisionRef"], ["id", "reportId", "decision", "decidedAt"], "Today decisionRef", &errors)
        }
    } else {
        errors.append("Today.items must be an array")
    }
    if errors.isEmpty == false { throw TodayResearchValidationError.invalid(errors) }
}

@discardableResult
private func todayObject(
    _ value: Any?,
    _ keys: Set<String>,
    _ label: String,
    _ errors: inout [String]
) -> [String: Any]? {
    guard let object = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return nil
    }
    todayExact(object, keys, label, &errors)
    return object
}

@discardableResult
private func todayObjectAllowingOptional(
    _ value: Any?,
    _ requiredKeys: Set<String>,
    _ optionalKeys: Set<String>,
    _ label: String,
    _ errors: inout [String]
) -> [String: Any]? {
    guard let object = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return nil
    }
    let keys = Set(object.keys)
    if requiredKeys.isSubset(of: keys) == false || keys.subtracting(requiredKeys.union(optionalKeys)).isEmpty == false {
        errors.append("\(label) fields are invalid")
    }
    return object
}

private func todayObjects(
    _ value: Any?,
    _ keys: Set<String>,
    _ label: String,
    _ errors: inout [String]
) {
    guard let values = value as? [Any] else {
        errors.append("\(label) must be an array")
        return
    }
    for (index, value) in values.enumerated() {
        todayObject(value, keys, "\(label)[\(index)]", &errors)
    }
}

@discardableResult
private func todayOptionalObject(
    _ value: Any?,
    _ keys: Set<String>,
    _ label: String,
    _ errors: inout [String]
) -> [String: Any]? {
    if value is NSNull { return nil }
    return todayObject(value, keys, label, &errors)
}

private func todayExact(
    _ value: [String: Any],
    _ keys: Set<String>,
    _ label: String,
    _ errors: inout [String]
) {
    if Set(value.keys) != keys { errors.append("\(label) fields are invalid") }
}
