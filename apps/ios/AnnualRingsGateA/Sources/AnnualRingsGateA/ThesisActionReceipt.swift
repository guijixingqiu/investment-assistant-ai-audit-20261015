import Foundation

/// A successful HTTP response is not a confirmed judgment write until its identity and payload match.
public func validatedThesisActionReceipt(
    _ bytes: Data, membership: CandidateMembershipData,
    initialModel: OperatingResearchModel, request: [String: Any]
) throws -> ResearchContextData {
    let invalid = NSError(domain: "保存回执尚未核对，请保留当前内容并重新读取", code: 409)
    let write = try JSONDecoder().decode(ResearchWriteEnvelope<ResearchContextData>.self, from: bytes)
    guard write.schemaVersion == "2026-06-18.research-write.v1", write.status == "succeeded",
          write.source.actorType == "user", write.source.actorId == membership.actorId,
          write.data.membershipId == membership.id, write.data.membershipVersion == membership.version,
          write.data.selectedSymbol == membership.symbol, researchDocumentIsPositiveIntegerString(write.data.id),
          write.data.id != request["baseContextId"] as? String,
          write.data.currentness.status == "current", write.data.currentness.invalidatedBy.isEmpty,
          write.data.safety.isAdvisoryOnly, isParseableDateTime(write.asOf), write.asOf == write.data.createdAt,
          let model = write.data.operatingModel, let binding = initialModel.thesisBinding,
          case .object(let event) = model.thesisOwnerAction,
          case .object(let submitted) = try JSONDecoder().decode(OperatingJSON.self, from: JSONSerialization.data(withJSONObject: request)),
          event["actor"] == .string(membership.actorId), event["confirmedAt"] == .string(write.asOf),
          case .string(let actionID) = event["actionId"], researchDocumentIsSha256(actionID),
          case .string(let lineageID) = event["lineageId"], researchDocumentIsSha256(lineageID),
          let action = request["action"] as? String,
          ["KEEP_CURRENT_THESIS", "REVISE_THESIS", "INSUFFICIENT_EVIDENCE_CONTINUE", "INVALIDATE_OR_END_THESIS"].contains(action)
    else { throw invalid }
    for key in ["action", "originalThesisIdentity", "newThesis", "ownerReason", "triggeringFactIds", "nextValidationEvent", "baselineId", "baseContextId"] {
        guard submitted[key] != nil, event[key] == submitted[key] else { throw invalid }
    }
    guard event["endedAt"] == (action == "INVALIDATE_OR_END_THESIS" ? .string(write.asOf) : .null) else { throw invalid }
    let original = try JSONDecoder().decode(OperatingJSON.self, from: JSONEncoder().encode(binding))
    guard event["originalThesisIdentity"] == original,
          request["membershipVersion"] as? Int == membership.version else { throw invalid }
    var expected = initialModel
    expected.thesisOwnerAction = model.thesisOwnerAction
    if action == "REVISE_THESIS" {
        guard let text = request["newThesis"] as? String,
              let reason = request["ownerReason"] as? String,
              let facts = request["triggeringFactIds"] as? [String],
              let next = request["nextValidationEvent"] as? [String: Any], let description = next["description"] as? String else { throw invalid }
        var revision = OperatingThesisRevision(previous: binding,
            assessment: initialModel.thesisRevision?.assessment ?? "insufficient_evidence",
            evidenceFactIds: facts, newThesis: text, reason: reason, nextValidationEvent: description)
        revision.status = "OWNER_CONFIRMED"
        revision.previousValidationEvent = initialModel.thesisRevision?.nextValidationEvent ?? ""
        revision.confirmedAt = write.asOf; revision.actor = membership.actorId
        expected.thesisRevision = revision
    }
    guard model == expected else { throw invalid }
    return write.data
}
