import Foundation

public enum AssistMobileWorkspaceSectionState: String, CaseIterable, Codable, Equatable, Sendable {
    case idle
    case loading
    case available
    case blocked
    case unauthorized
    case notFound = "not_found"
    case unavailable
    case malformed
    case offline
    case superseded
    case empty
}

public enum AssistMobileWorkspaceUnifiedFailureState: String, CaseIterable, Codable, Equatable, Sendable {
    case loading
    case empty
    case stale
    case unavailable
    case unauthorized
    case conflict
    case offline
    case malformed
    case fixtureUnavailable = "fixture-unavailable"
    case sourceMismatch = "source-mismatch"
}

public func assistMobileWorkspaceUnifiedFailureState(for state: String) -> AssistMobileWorkspaceUnifiedFailureState? {
    let normalized = state.replacingOccurrences(of: "_", with: "-")
    if normalized == "loading" {
        return .loading
    }
    if normalized == "empty" || normalized == "not-found" || normalized == "no-evidence" {
        return .empty
    }
    if normalized.contains("stale") {
        return .stale
    }
    if normalized == "unauthorized" || normalized == "research-unauthorized" || normalized == "permission-denied" {
        return .unauthorized
    }
    if normalized == "conflict" || normalized.contains("version-conflict") {
        return .conflict
    }
    if normalized == "offline" {
        return .offline
    }
    if normalized == "malformed" || normalized.contains("malformed") {
        return .malformed
    }
    if normalized == "fixture-unavailable" {
        return .fixtureUnavailable
    }
    if normalized == "source-mismatch"
        || normalized == "membership-missing"
        || normalized.contains("mismatch")
        || normalized.contains("not-omitted") {
        return .sourceMismatch
    }
    if normalized == "unavailable"
        || normalized.contains("unavailable")
        || normalized.hasPrefix("missing-")
        || normalized.contains("-missing")
        || normalized == "context-unloaded"
        || normalized == "membership-unloaded" {
        return .unavailable
    }
    return nil
}

public struct AssistMobileWorkspaceLocalDraftState: Equatable, Sendable {
    public let followUpManualNoteDraft: String
    public let followUpLaterReviewDraft: String
    public let followUpEvidenceGapChecklistDraft: String
    public let decisionNoteDraft: String

    public static let empty = AssistMobileWorkspaceLocalDraftState(
        followUpManualNoteDraft: "",
        followUpLaterReviewDraft: "",
        followUpEvidenceGapChecklistDraft: "",
        decisionNoteDraft: ""
    )

    public var isEmpty: Bool {
        [
            followUpManualNoteDraft,
            followUpLaterReviewDraft,
            followUpEvidenceGapChecklistDraft,
            decisionNoteDraft
        ].allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    public func clearingIfNeeded(previousMembershipId: String?, nextMembershipId: String?, laneState: String, superseded: Bool) -> AssistMobileWorkspaceLocalDraftState {
        if previousMembershipId != nextMembershipId || superseded || assistMobileWorkspaceIsFailClosedState(laneState) {
            return .empty
        }
        return self
    }
}

public struct AssistMobileWorkspaceLocalRecordDrafts: Codable, Equatable, Sendable {
    public var researchThought: String
    public var decisionThought: String
    public var evidenceGapNote: String
    public var laterReviewNote: String

    public static let empty = AssistMobileWorkspaceLocalRecordDrafts(
        researchThought: "",
        decisionThought: "",
        evidenceGapNote: "",
        laterReviewNote: ""
    )

    public var isEmpty: Bool {
        [
            researchThought,
            decisionThought,
            evidenceGapNote,
            laterReviewNote
        ].allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    fileprivate func clampedForLocalRecord() -> AssistMobileWorkspaceLocalRecordDrafts {
        AssistMobileWorkspaceLocalRecordDrafts(
            researchThought: String(researchThought.prefix(4000)),
            decisionThought: String(decisionThought.prefix(4000)),
            evidenceGapNote: String(evidenceGapNote.prefix(4000)),
            laterReviewNote: String(laterReviewNote.prefix(4000))
        )
    }

    fileprivate func validateForLocalRecord(errors: inout [String]) {
        for (label, value) in [
            ("fields.researchThought", researchThought),
            ("fields.decisionThought", decisionThought),
            ("fields.evidenceGapNote", evidenceGapNote),
            ("fields.laterReviewNote", laterReviewNote)
        ] where value.count > 4000 {
            errors.append("\(label) must be at most 4000 characters")
        }
    }
}

public let ASSIST_MOBILE_WORKSPACE_LOCAL_RECORD_SCHEMA_VERSION = "2026-07-06.assist-1.local-record.v1"

public enum AssistMobileWorkspaceLocalRecordValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public enum AssistMobileWorkspaceLocalRecordLoadState: String, Equatable, Sendable {
    case loaded
    case missing
    case mismatch
    case malformed
}

public struct AssistMobileWorkspaceLocalRecordTarget: Codable, Equatable, Sendable {
    public let market: String
    public let code: String
    public let symbol: String
    public let candidateMembershipId: String

    fileprivate func validate(errors: inout [String]) {
        if market != "HK" {
            errors.append("target.market must be HK")
        }
        if code.range(of: #"^\d{5}$"#, options: .regularExpression) == nil {
            errors.append("target.code must be a five digit HK code")
        }
        if symbol != "\(market).\(code)" {
            errors.append("target.symbol must match market.code")
        }
        if candidateMembershipId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("target.candidateMembershipId is required")
        }
    }
}

public struct AssistMobileWorkspaceLocalRecordSourceRef: Codable, Equatable, Sendable {
    public let sourceSignature: String
    public let decisionContextId: String?
    public let decisionContextHash: String?
    public let followUpWorkflowGeneratedAt: String?
    public let decisionNoteWorkflowGeneratedAt: String?

    fileprivate func validate(errors: inout [String]) {
        if sourceSignature.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("sourceRef.sourceSignature is required")
        }
        if let followUpWorkflowGeneratedAt, !assistMobileWorkspaceLocalRecordIsDateTime(followUpWorkflowGeneratedAt) {
            errors.append("sourceRef.followUpWorkflowGeneratedAt must be a valid date-time or null")
        }
        if let decisionNoteWorkflowGeneratedAt, !assistMobileWorkspaceLocalRecordIsDateTime(decisionNoteWorkflowGeneratedAt) {
            errors.append("sourceRef.decisionNoteWorkflowGeneratedAt must be a valid date-time or null")
        }
    }
}

public struct AssistMobileWorkspaceLocalRecordSafety: Codable, Equatable, Sendable {
    public let localOnly: Bool
    public let unofficial: Bool
    public let officialRecord: Bool
    public let serverPersisted: Bool
    public let sent: Bool
    public let brokerSynced: Bool
    public let portfolioFact: Bool
    public let productionFact: Bool
    public let noRecommendation: Bool
    public let noRanking: Bool
    public let noScoring: Bool
    public let noBuySellHold: Bool
    public let noTrading: Bool
    public let noBroker: Bool
    public let noPortfolioMutation: Bool

    public static let iosUserDefaultsLocalOnly = AssistMobileWorkspaceLocalRecordSafety(
        localOnly: true,
        unofficial: true,
        officialRecord: false,
        serverPersisted: false,
        sent: false,
        brokerSynced: false,
        portfolioFact: false,
        productionFact: false,
        noRecommendation: true,
        noRanking: true,
        noScoring: true,
        noBuySellHold: true,
        noTrading: true,
        noBroker: true,
        noPortfolioMutation: true
    )

    fileprivate func validate(errors: inout [String]) {
        for (label, value) in [
            ("safety.localOnly", localOnly),
            ("safety.unofficial", unofficial),
            ("safety.noRecommendation", noRecommendation),
            ("safety.noRanking", noRanking),
            ("safety.noScoring", noScoring),
            ("safety.noBuySellHold", noBuySellHold),
            ("safety.noTrading", noTrading),
            ("safety.noBroker", noBroker),
            ("safety.noPortfolioMutation", noPortfolioMutation)
        ] where value != true {
            errors.append("\(label) must be true")
        }
        for (label, value) in [
            ("safety.officialRecord", officialRecord),
            ("safety.serverPersisted", serverPersisted),
            ("safety.sent", sent),
            ("safety.brokerSynced", brokerSynced),
            ("safety.portfolioFact", portfolioFact),
            ("safety.productionFact", productionFact)
        ] where value != false {
            errors.append("\(label) must be false")
        }
    }
}

public struct AssistMobileWorkspaceLocalRecordEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let recordId: String
    public let createdAt: String
    public let updatedAt: String
    public let storageScope: String
    public let target: AssistMobileWorkspaceLocalRecordTarget
    public let sourceRef: AssistMobileWorkspaceLocalRecordSourceRef
    public let metadata: FactMetadata
    public let fields: AssistMobileWorkspaceLocalRecordDrafts
    public let safety: AssistMobileWorkspaceLocalRecordSafety
    public let message: String

    public func validateForUserDefaults() throws {
        var errors: [String] = []
        if schemaVersion != ASSIST_MOBILE_WORKSPACE_LOCAL_RECORD_SCHEMA_VERSION {
            errors.append("schemaVersion must be \(ASSIST_MOBILE_WORKSPACE_LOCAL_RECORD_SCHEMA_VERSION)")
        }
        if recordId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("recordId is required")
        }
        if !assistMobileWorkspaceLocalRecordIsDateTime(createdAt) {
            errors.append("createdAt must be a valid date-time")
        }
        if !assistMobileWorkspaceLocalRecordIsDateTime(updatedAt) {
            errors.append("updatedAt must be a valid date-time")
        }
        if storageScope != "ios_user_defaults" {
            errors.append("storageScope must be ios_user_defaults")
        }
        target.validate(errors: &errors)
        sourceRef.validate(errors: &errors)
        metadata.validateForDisplay(label: "local record", errors: &errors)
        if metadata.provenance != "local_only" {
            errors.append("local record metadata.provenance must be local_only")
        }
        if metadata.authority != "local_only" {
            errors.append("local record metadata.authority must be local_only")
        }
        if metadata.freshness != "fresh" {
            errors.append("local record metadata.freshness must be fresh")
        }
        fields.validateForLocalRecord(errors: &errors)
        safety.validate(errors: &errors)
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("message is required")
        }
        if errors.isEmpty == false {
            throw AssistMobileWorkspaceLocalRecordValidationError.invalid(errors)
        }
    }
}

public struct AssistMobileWorkspaceLocalRecordLoadResult: Equatable, Sendable {
    public let ok: Bool
    public let state: AssistMobileWorkspaceLocalRecordLoadState
    public let envelope: AssistMobileWorkspaceLocalRecordEnvelope?
    public let fields: AssistMobileWorkspaceLocalRecordDrafts
    public let message: String
}

public func assistMobileWorkspaceBuildLocalRecordEnvelope(
    sourceSignature: String,
    selectedMembership: CandidateMembershipData,
    decisionContext: DecisionContextEnvelope?,
    followUpWorkflow: AssistReviewFollowUpWorkflowRenderModel,
    decisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel,
    fields: AssistMobileWorkspaceLocalRecordDrafts,
    nowIso: String
) throws -> AssistMobileWorkspaceLocalRecordEnvelope {
    let envelope = AssistMobileWorkspaceLocalRecordEnvelope(
        schemaVersion: ASSIST_MOBILE_WORKSPACE_LOCAL_RECORD_SCHEMA_VERSION,
        recordId: "assist-local-record:\(sourceSignature)",
        createdAt: nowIso,
        updatedAt: nowIso,
        storageScope: "ios_user_defaults",
        target: AssistMobileWorkspaceLocalRecordTarget(
            market: selectedMembership.market,
            code: selectedMembership.code,
            symbol: selectedMembership.symbol,
            candidateMembershipId: selectedMembership.id
        ),
        sourceRef: AssistMobileWorkspaceLocalRecordSourceRef(
            sourceSignature: sourceSignature,
            decisionContextId: decisionContext?.contextId,
            decisionContextHash: decisionContext?.contextHash,
            followUpWorkflowGeneratedAt: followUpWorkflow.generatedAt,
            decisionNoteWorkflowGeneratedAt: decisionNoteWorkflow.generatedAt
        ),
        metadata: FactMetadata(
            source: "ios_user_defaults",
            asOf: nowIso,
            fetchedAt: nil,
            freshness: "fresh",
            provenance: "local_only",
            authority: "local_only",
            stale: false,
            missing: false,
            conflict: false,
            fixture: false,
            correctionOf: nil,
            replaces: nil,
            message: "iOS UserDefaults local record metadata is local-only and unofficial; it is not an official review, portfolio, broker, accounting, cash, fee, position, transaction, or production fact."
        ),
        fields: fields.clampedForLocalRecord(),
        safety: .iosUserDefaultsLocalOnly,
        message: "Saved to iOS UserDefaults only; unofficial, not uploaded to any API, not written to any database, not server persisted, not sent, not broker synced, and not an official review, trading, or portfolio fact."
    )
    try envelope.validateForUserDefaults()
    return envelope
}

public func assistMobileWorkspaceLoadLocalRecordEnvelope(
    raw: String?,
    expectedSourceSignature: String
) -> AssistMobileWorkspaceLocalRecordLoadResult {
    guard let raw, raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
        return AssistMobileWorkspaceLocalRecordLoadResult(
            ok: false,
            state: .missing,
            envelope: nil,
            fields: .empty,
            message: "No saved iOS UserDefaults local record exists for the current source signature."
        )
    }

    let data = Data(raw.utf8)
    do {
        let object = try JSONSerialization.jsonObject(with: data)
        var shapeErrors: [String] = []
        validateAssistMobileWorkspaceLocalRecordJSONShape(object, path: "localRecord", errors: &shapeErrors)
        if !shapeErrors.isEmpty {
            let prefix = assistMobileWorkspaceLocalRecordMissingSnapshotAuthority(shapeErrors)
                ? "Saved iOS local record is missing required snapshot/source authority; display cleared, stale content is not reused, and no fabricated backfill is created."
                : "Saved iOS local record failed shape validation; display cleared and stale content is not reused."
            return assistMobileWorkspaceMalformedLocalRecord("\(prefix) \(shapeErrors.joined(separator: "; "))")
        }
        let envelope = try JSONDecoder().decode(AssistMobileWorkspaceLocalRecordEnvelope.self, from: data)
        do {
            try envelope.validateForUserDefaults()
        } catch AssistMobileWorkspaceLocalRecordValidationError.invalid(let errors) {
            let prefix = assistMobileWorkspaceLocalRecordMissingSnapshotAuthority(errors)
                ? "Saved iOS local record is missing required snapshot/source authority; display cleared, stale content is not reused, and no fabricated backfill is created."
                : "Saved iOS local record failed contract validation; display cleared and stale content is not reused."
            return assistMobileWorkspaceMalformedLocalRecord("\(prefix) \(errors.joined(separator: "; "))")
        }
        if envelope.sourceRef.sourceSignature != expectedSourceSignature {
            return AssistMobileWorkspaceLocalRecordLoadResult(
                ok: false,
                state: .mismatch,
                envelope: nil,
                fields: .empty,
                message: "Saved iOS local record source signature does not match current facts; display cleared."
            )
        }
        guard let expectedIdentity = assistMobileWorkspaceLocalRecordIdentity(from: expectedSourceSignature), assistMobileWorkspaceLocalRecordSourceRefMatchesSignature(envelope),
              envelope.recordId == "assist-local-record:\(expectedSourceSignature)",
              envelope.target.symbol == expectedIdentity.symbol,
              envelope.target.code == expectedIdentity.code,
              envelope.target.candidateMembershipId == expectedIdentity.membershipId else {
            return AssistMobileWorkspaceLocalRecordLoadResult(
                ok: false,
                state: .mismatch,
                envelope: nil,
                fields: .empty,
                message: "Saved iOS local record target symbol, membership, or record identity does not match current facts; display cleared."
            )
        }
        return AssistMobileWorkspaceLocalRecordLoadResult(
            ok: true,
            state: .loaded,
            envelope: envelope,
            fields: envelope.fields.clampedForLocalRecord(),
            message: "Loaded a saved iOS UserDefaults unofficial record for the current source signature only."
        )
    } catch {
        return assistMobileWorkspaceMalformedLocalRecord("Saved iOS local record is malformed; display cleared and stale content is not reused.")
    }
}

public struct AssistMobileWorkspaceLocalRecordState: Equatable, Sendable {
    public let status: String
    public let sourceSignature: String
    public let storageScope: String
    public let summary: [String]
    public let safety: [String]
    public let canSave: Bool
}

public struct AssistMobileWorkspaceLocalRecordLifecycleSemantics: Equatable, Sendable {
    public let key: String
    public let webState: String
    public let iosState: String
    public let display: String
}

public func assistMobileWorkspaceLocalRecordLifecycleSemantics() -> [AssistMobileWorkspaceLocalRecordLifecycleSemantics] {
    [
        AssistMobileWorkspaceLocalRecordLifecycleSemantics(
            key: "save-current-source",
            webState: "saved_local",
            iosState: "saved_local",
            display: "Save writes only the current source-signature browser localStorage or iOS UserDefaults envelope; it is local-only, unofficial, not API uploaded, not database written, and not broker synced."
        ),
        AssistMobileWorkspaceLocalRecordLifecycleSemantics(
            key: "save-source-unavailable",
            webState: "fail_closed",
            iosState: "fail_closed",
            display: "Save is blocked when the current source signature is unavailable; displayed drafts are cleared or kept display-only and no stale saved thought is promoted."
        ),
        AssistMobileWorkspaceLocalRecordLifecycleSemantics(
            key: "load-current-source",
            webState: "saved_local",
            iosState: "loaded",
            display: "Load restores only a contract-valid record whose source signature matches the current candidate, membership version, decision context, follow-up workflow, and decision-note workflow."
        ),
        AssistMobileWorkspaceLocalRecordLifecycleSemantics(
            key: "load-missing",
            webState: "available",
            iosState: "missing",
            display: "Missing storage is an explicit empty local-record state for the current source; it is not an unauthorized success, server success, or official review record."
        ),
        AssistMobileWorkspaceLocalRecordLifecycleSemantics(
            key: "load-mismatch",
            webState: "mismatch",
            iosState: "mismatch",
            display: "Source-signature mismatch clears displayed fields, hides saved thoughts, and never reuses cross-candidate or cross-source records."
        ),
        AssistMobileWorkspaceLocalRecordLifecycleSemantics(
            key: "load-malformed",
            webState: "malformed",
            iosState: "malformed",
            display: "Malformed, unsafe, wrong-scope, or missing-snapshot records are rejected fail-closed, removed for the current source when possible, and never receive fabricated backfill."
        ),
        AssistMobileWorkspaceLocalRecordLifecycleSemantics(
            key: "storage-unavailable",
            webState: "storage_unavailable",
            iosState: "storage_unavailable",
            display: "Storage unavailable keeps drafts display-only, prevents saved-record load claims, and sends nothing to API, database, broker, official review, or portfolio facts."
        ),
        AssistMobileWorkspaceLocalRecordLifecycleSemantics(
            key: "clear-confirm",
            webState: "confirm_clear",
            iosState: "confirm_clear",
            display: "Clear requires confirmation before deleting only the current source-signature local envelope; API facts and official review history are untouched."
        ),
        AssistMobileWorkspaceLocalRecordLifecycleSemantics(
            key: "clear-complete",
            webState: "available",
            iosState: "available",
            display: "Clear completion empties displayed drafts and removes only the current local envelope when a current source exists; no other source record is touched."
        ),
        AssistMobileWorkspaceLocalRecordLifecycleSemantics(
            key: "fail-closed-source",
            webState: "fail_closed",
            iosState: "fail_closed",
            display: "No-selected-candidate, stale, unauthorized, conflict, offline, malformed, unavailable, not-found, superseded, and source-change states hide saved records and stale local drafts."
        )
    ]
}

public func assistMobileWorkspaceLocalRecordSnapshotSummary(_ envelope: AssistMobileWorkspaceLocalRecordEnvelope) -> [String] {
    [
        "Saved local record snapshot: storage=\(envelope.storageScope); updatedAt=\(envelope.updatedAt).",
        "Saved target: \(envelope.target.symbol) / membership=\(envelope.target.candidateMembershipId).",
        "Source snapshot: decisionContext=\(envelope.sourceRef.decisionContextId ?? "missing"); contextHash=\(envelope.sourceRef.decisionContextHash ?? "missing").",
        "Workflow snapshot: followUpGeneratedAt=\(envelope.sourceRef.followUpWorkflowGeneratedAt ?? "missing"); decisionNoteGeneratedAt=\(envelope.sourceRef.decisionNoteWorkflowGeneratedAt ?? "missing").",
        "Fact metadata: source=\(envelope.metadata.source); asOf=\(envelope.metadata.asOf ?? "missing"); fetchedAt=\(envelope.metadata.fetchedAt ?? "missing"); freshness=\(envelope.metadata.freshness); provenance=\(envelope.metadata.provenance); authority=\(envelope.metadata.authority).",
        "Snapshot authority: local-only, unofficial, not uploaded to any API, not written to any database, not official review history, not server persisted, not sent, not broker synced, and not a portfolio fact."
    ]
}

public let ASSIST_REVIEW_KNOWLEDGE_SCHEMA_VERSION = "2026-07-10.assist-1.local-review-knowledge.v1"
public let ASSIST_REVIEW_KNOWLEDGE_COLLECTION_SCHEMA_VERSION = "2026-07-19.assist-1.local-review-knowledge-collection.v2"
public let ASSIST_REVIEW_KNOWLEDGE_MAX_RAW_BYTES = 16 * 1024 * 1024

public enum AssistReviewKnowledgeSnapshotAvailability: String, Codable, Equatable, Sendable {
    case preserved
    case partiallyUnavailable = "partially_unavailable"
    case notReferenced = "not_referenced"
}

public enum AssistReviewKnowledgeSourceRelation: String, Codable, Equatable, Sendable {
    case currentSource = "current_source"
    case historicalSource = "historical_source"
    case sourceUnavailable = "source_unavailable"
}

public enum AssistReviewKnowledgeLoadState: String, Equatable, Sendable {
    case loaded
    case missing
    case sourceUnavailable = "source_unavailable"
    case mismatch
    case malformed
    case storageUnavailable = "storage_unavailable"
}

public enum AssistReviewKnowledgeMutationError: Error, Equatable, Sendable {
    case invalid([String])
    case conflict(String)
    case storageUnavailable(String)
}

public struct AssistReviewKnowledgeTarget: Codable, Equatable, Sendable {
    public let market: String
    public let code: String
    public let symbol: String
    public let candidateMembershipId: String
    public let candidateMembershipVersion: Int

    fileprivate func validate(errors: inout [String]) {
        if market != "HK" { errors.append("target.market must be HK") }
        if code.range(of: #"^\d{5}$"#, options: .regularExpression) == nil {
            errors.append("target.code must be a five digit HK code")
        }
        if symbol != "HK.\(code)" { errors.append("target.symbol must match target market and code") }
        if candidateMembershipId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("target.candidateMembershipId is required")
        }
        if candidateMembershipVersion < 1 {
            errors.append("target.candidateMembershipVersion must be a positive integer")
        }
    }
}

public struct AssistReviewKnowledgeSourceRef: Codable, Equatable, Sendable {
    public let sourceSignature: String
    public let decisionContextId: String?
    public let decisionContextHash: String?
    public let localRecordId: String?

    private enum CodingKeys: String, CodingKey {
        case sourceSignature
        case decisionContextId
        case decisionContextHash
        case localRecordId
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sourceSignature, forKey: .sourceSignature)
        try assistReviewKnowledgeEncodeNullable(decisionContextId, container: &container, key: .decisionContextId)
        try assistReviewKnowledgeEncodeNullable(decisionContextHash, container: &container, key: .decisionContextHash)
        try assistReviewKnowledgeEncodeNullable(localRecordId, container: &container, key: .localRecordId)
    }

    fileprivate func validate(errors: inout [String]) {
        if sourceSignature.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("sourceRef.sourceSignature is required")
        }
        for (label, value) in [
            ("sourceRef.decisionContextId", decisionContextId),
            ("sourceRef.decisionContextHash", decisionContextHash),
            ("sourceRef.localRecordId", localRecordId)
        ] {
            if let value, value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                errors.append("\(label) must be non-empty or null")
            }
        }
        if (decisionContextId == nil) != (decisionContextHash == nil) {
            errors.append("sourceRef decisionContextId and decisionContextHash must both be present or both be null")
        }
    }
}

public struct AssistReviewKnowledgeReviewRefs: Codable, Equatable, Sendable {
    public let reviewHistoryAsOf: String?
    public let decisionCheckIds: [String]
    public let postDecisionReviewIds: [String]
    public let snapshotAvailability: AssistReviewKnowledgeSnapshotAvailability

    private enum CodingKeys: String, CodingKey {
        case reviewHistoryAsOf
        case decisionCheckIds
        case postDecisionReviewIds
        case snapshotAvailability
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try assistReviewKnowledgeEncodeNullable(reviewHistoryAsOf, container: &container, key: .reviewHistoryAsOf)
        try container.encode(decisionCheckIds, forKey: .decisionCheckIds)
        try container.encode(postDecisionReviewIds, forKey: .postDecisionReviewIds)
        try container.encode(snapshotAvailability, forKey: .snapshotAvailability)
    }

    fileprivate func validate(errors: inout [String]) {
        if let reviewHistoryAsOf, !assistMobileWorkspaceLocalRecordIsDateTime(reviewHistoryAsOf) {
            errors.append("reviewRefs.reviewHistoryAsOf must be a valid date-time or null")
        }
        assistReviewKnowledgeValidateIds(decisionCheckIds, label: "reviewRefs.decisionCheckIds", errors: &errors)
        assistReviewKnowledgeValidateIds(postDecisionReviewIds, label: "reviewRefs.postDecisionReviewIds", errors: &errors)
        let referenceCount = decisionCheckIds.count + postDecisionReviewIds.count
        if referenceCount > 0 && reviewHistoryAsOf == nil {
            errors.append("reviewRefs.reviewHistoryAsOf is required when review IDs are referenced")
        }
        if referenceCount == 0 && snapshotAvailability != .notReferenced {
            errors.append("reviewRefs.snapshotAvailability must be not_referenced without review IDs")
        }
        if referenceCount > 0 && snapshotAvailability == .notReferenced {
            errors.append("reviewRefs.snapshotAvailability must disclose referenced snapshot availability")
        }
    }
}

public struct AssistReviewKnowledgeLineage: Codable, Equatable, Sendable {
    public let correctionOfKnowledgeId: String?
    public let replacesKnowledgeId: String?

    private enum CodingKeys: String, CodingKey {
        case correctionOfKnowledgeId
        case replacesKnowledgeId
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try assistReviewKnowledgeEncodeNullable(correctionOfKnowledgeId, container: &container, key: .correctionOfKnowledgeId)
        try assistReviewKnowledgeEncodeNullable(replacesKnowledgeId, container: &container, key: .replacesKnowledgeId)
    }

    fileprivate func validate(knowledgeId: String, errors: inout [String]) {
        for (label, value) in [
            ("lineage.correctionOfKnowledgeId", correctionOfKnowledgeId),
            ("lineage.replacesKnowledgeId", replacesKnowledgeId)
        ] {
            if let value, value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                errors.append("\(label) must be non-empty or null")
            }
        }
        if correctionOfKnowledgeId == knowledgeId || replacesKnowledgeId == knowledgeId {
            errors.append("knowledge entry cannot correct or replace itself")
        }
    }
}

public struct AssistReviewKnowledgeFields: Codable, Equatable, Sendable {
    public var evidenceLesson: String
    public var processLesson: String
    public var unresolvedQuestion: String
    public var uncertaintyNote: String

    public static let empty = AssistReviewKnowledgeFields(
        evidenceLesson: "",
        processLesson: "",
        unresolvedQuestion: "",
        uncertaintyNote: ""
    )

    public var isEmpty: Bool {
        [evidenceLesson, processLesson, unresolvedQuestion, uncertaintyNote]
            .allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    fileprivate func clamped() -> AssistReviewKnowledgeFields {
        AssistReviewKnowledgeFields(
            evidenceLesson: String(evidenceLesson.prefix(4000)),
            processLesson: String(processLesson.prefix(4000)),
            unresolvedQuestion: String(unresolvedQuestion.prefix(4000)),
            uncertaintyNote: String(uncertaintyNote.prefix(4000))
        )
    }

    fileprivate func validate(errors: inout [String]) {
        for (label, value) in [
            ("fields.evidenceLesson", evidenceLesson),
            ("fields.processLesson", processLesson),
            ("fields.unresolvedQuestion", unresolvedQuestion),
            ("fields.uncertaintyNote", uncertaintyNote)
        ] where value.count > 4000 {
            errors.append("\(label) must be at most 4000 characters")
        }
        if isEmpty { errors.append("at least one retrospective knowledge field must be populated") }
    }
}

public struct AssistReviewKnowledgeSafety: Codable, Equatable, Sendable {
    public let localOnly: Bool
    public let unofficial: Bool
    public let readOnlyAssistance: Bool
    public let apiUploaded: Bool
    public let serverPersisted: Bool
    public let databaseWritten: Bool
    public let officialReviewFact: Bool
    public let officialPortfolioFact: Bool
    public let brokerSynced: Bool
    public let changesCandidateOrdering: Bool
    public let createsRecommendation: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let mutatesCash: Bool
    public let writesFee: Bool
    public let mutatesPosition: Bool
    public let callsBroker: Bool
    public let productionWrite: Bool

    public static let iosUserDefaultsLocalOnly = AssistReviewKnowledgeSafety(
        localOnly: true,
        unofficial: true,
        readOnlyAssistance: true,
        apiUploaded: false,
        serverPersisted: false,
        databaseWritten: false,
        officialReviewFact: false,
        officialPortfolioFact: false,
        brokerSynced: false,
        changesCandidateOrdering: false,
        createsRecommendation: false,
        createsOrder: false,
        createsTrade: false,
        mutatesCash: false,
        writesFee: false,
        mutatesPosition: false,
        callsBroker: false,
        productionWrite: false
    )

    fileprivate func validate(errors: inout [String]) {
        for (label, value) in [
            ("safety.localOnly", localOnly),
            ("safety.unofficial", unofficial),
            ("safety.readOnlyAssistance", readOnlyAssistance)
        ] where value != true {
            errors.append("\(label) must be true")
        }
        for (label, value) in [
            ("safety.apiUploaded", apiUploaded),
            ("safety.serverPersisted", serverPersisted),
            ("safety.databaseWritten", databaseWritten),
            ("safety.officialReviewFact", officialReviewFact),
            ("safety.officialPortfolioFact", officialPortfolioFact),
            ("safety.brokerSynced", brokerSynced),
            ("safety.changesCandidateOrdering", changesCandidateOrdering),
            ("safety.createsRecommendation", createsRecommendation),
            ("safety.createsOrder", createsOrder),
            ("safety.createsTrade", createsTrade),
            ("safety.mutatesCash", mutatesCash),
            ("safety.writesFee", writesFee),
            ("safety.mutatesPosition", mutatesPosition),
            ("safety.callsBroker", callsBroker),
            ("safety.productionWrite", productionWrite)
        ] where value != false {
            errors.append("\(label) must be false")
        }
    }
}

public struct AssistReviewKnowledgeEnvelope: Codable, Equatable, Identifiable, Sendable {
    public var id: String { knowledgeId }
    public var isDeletionTombstone: Bool { metadata.missing }
    public let schemaVersion: String
    public let knowledgeId: String
    public let createdAt: String
    public let updatedAt: String
    public let storageScope: String
    public let target: AssistReviewKnowledgeTarget
    public let sourceRef: AssistReviewKnowledgeSourceRef
    public let reviewRefs: AssistReviewKnowledgeReviewRefs
    public let lineage: AssistReviewKnowledgeLineage
    public let metadata: FactMetadata
    public let fields: AssistReviewKnowledgeFields
    public let safety: AssistReviewKnowledgeSafety
    public let message: String

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case knowledgeId
        case createdAt
        case updatedAt
        case storageScope
        case target
        case sourceRef
        case reviewRefs
        case lineage
        case metadata
        case fields
        case safety
        case message
    }

    private enum MetadataCodingKeys: String, CodingKey {
        case source
        case asOf
        case fetchedAt
        case freshness
        case provenance
        case authority
        case stale
        case missing
        case conflict
        case fixture
        case correctionOf
        case replaces
        case message
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(knowledgeId, forKey: .knowledgeId)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(storageScope, forKey: .storageScope)
        try container.encode(target, forKey: .target)
        try container.encode(sourceRef, forKey: .sourceRef)
        try container.encode(reviewRefs, forKey: .reviewRefs)
        try container.encode(lineage, forKey: .lineage)
        var metadataContainer = container.nestedContainer(keyedBy: MetadataCodingKeys.self, forKey: .metadata)
        try metadataContainer.encode(metadata.source, forKey: .source)
        try assistReviewKnowledgeEncodeNullable(metadata.asOf, container: &metadataContainer, key: .asOf)
        try assistReviewKnowledgeEncodeNullable(metadata.fetchedAt, container: &metadataContainer, key: .fetchedAt)
        try metadataContainer.encode(metadata.freshness, forKey: .freshness)
        try metadataContainer.encode(metadata.provenance, forKey: .provenance)
        try metadataContainer.encode(metadata.authority, forKey: .authority)
        try metadataContainer.encode(metadata.stale, forKey: .stale)
        try metadataContainer.encode(metadata.missing, forKey: .missing)
        try metadataContainer.encode(metadata.conflict, forKey: .conflict)
        try metadataContainer.encode(metadata.fixture, forKey: .fixture)
        try assistReviewKnowledgeEncodeNullable(metadata.correctionOf, container: &metadataContainer, key: .correctionOf)
        try assistReviewKnowledgeEncodeNullable(metadata.replaces, container: &metadataContainer, key: .replaces)
        try metadataContainer.encode(metadata.message, forKey: .message)
        try container.encode(fields, forKey: .fields)
        try container.encode(safety, forKey: .safety)
        try container.encode(message, forKey: .message)
    }

    public func validateForUserDefaults() throws {
        var errors: [String] = []
        if schemaVersion != ASSIST_REVIEW_KNOWLEDGE_SCHEMA_VERSION {
            errors.append("schemaVersion must be \(ASSIST_REVIEW_KNOWLEDGE_SCHEMA_VERSION)")
        }
        if knowledgeId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("knowledgeId is required")
        }
        if !assistMobileWorkspaceLocalRecordIsDateTime(createdAt) {
            errors.append("createdAt must be a valid date-time")
        }
        if !assistMobileWorkspaceLocalRecordIsDateTime(updatedAt) {
            errors.append("updatedAt must be a valid date-time")
        }
        if let created = assistReviewKnowledgeDate(createdAt),
           let updated = assistReviewKnowledgeDate(updatedAt),
           created > updated {
            errors.append("createdAt must not be later than updatedAt")
        }
        if storageScope != "ios_user_defaults" {
            errors.append("storageScope must be ios_user_defaults")
        }
        target.validate(errors: &errors)
        sourceRef.validate(errors: &errors)
        reviewRefs.validate(errors: &errors)
        lineage.validate(knowledgeId: knowledgeId, errors: &errors)
        metadata.validateForDisplay(label: "retrospective knowledge", errors: &errors)
        if metadata.source != "ios_user_defaults" { errors.append("metadata.source must match storageScope") }
        if metadata.provenance != "local_only" { errors.append("metadata.provenance must be local_only") }
        if metadata.authority != "local_only" { errors.append("metadata.authority must be local_only") }
        if isDeletionTombstone {
            if metadata.freshness != "missing" { errors.append("deletion tombstone freshness must be missing") }
            if metadata.stale || metadata.conflict || metadata.fixture {
                errors.append("deletion tombstone metadata flags must remain false except missing")
            }
            if sourceRef.sourceSignature != "deleted" || sourceRef.decisionContextId != nil || sourceRef.decisionContextHash != nil || sourceRef.localRecordId != nil {
                errors.append("deletion tombstone source references must be contentless")
            }
            if reviewRefs.reviewHistoryAsOf != nil || !reviewRefs.decisionCheckIds.isEmpty || !reviewRefs.postDecisionReviewIds.isEmpty || reviewRefs.snapshotAvailability != .notReferenced {
                errors.append("deletion tombstone review references must be contentless")
            }
            if !fields.isEmpty { errors.append("deletion tombstone fields must be empty") }
        } else {
            if metadata.freshness != "historical" { errors.append("metadata.freshness must be historical") }
            if metadata.stale || metadata.missing || metadata.conflict || metadata.fixture {
                errors.append("metadata flags must remain false for a saved local historical entry")
            }
            fields.validate(errors: &errors)
        }
        if metadata.asOf != updatedAt || metadata.fetchedAt != nil {
            errors.append("metadata asOf must equal updatedAt and fetchedAt must be null")
        }
        if metadata.correctionOf != lineage.correctionOfKnowledgeId {
            errors.append("metadata.correctionOf must match lineage.correctionOfKnowledgeId")
        }
        if metadata.replaces != lineage.replacesKnowledgeId {
            errors.append("metadata.replaces must match lineage.replacesKnowledgeId")
        }
        safety.validate(errors: &errors)
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("message is required")
        }
        if !errors.isEmpty { throw AssistReviewKnowledgeMutationError.invalid(errors) }
    }
}

public func assistReviewKnowledgeExportJSON(_ entry: AssistReviewKnowledgeEnvelope) throws -> String {
    try entry.validateForUserDefaults()
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    guard let result = String(data: try encoder.encode(entry), encoding: .utf8) else {
        throw AssistReviewKnowledgeMutationError.invalid(["knowledge export is not valid UTF-8"])
    }
    return result
}

public struct AssistReviewKnowledgeCollection: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let storageScope: String
    public let targetSymbol: String
    public let targetMembershipId: String
    public let updatedAt: String
    public let entries: [AssistReviewKnowledgeEnvelope]
    public let message: String

    public func validateForUserDefaults() throws {
        var errors: [String] = []
        if schemaVersion != ASSIST_REVIEW_KNOWLEDGE_COLLECTION_SCHEMA_VERSION {
            errors.append("schemaVersion must be \(ASSIST_REVIEW_KNOWLEDGE_COLLECTION_SCHEMA_VERSION)")
        }
        if storageScope != "ios_user_defaults" { errors.append("storageScope must be ios_user_defaults") }
        if !assistReviewKnowledgeIsCanonicalSymbol(targetSymbol) {
            errors.append("targetSymbol must be a canonical HK five-digit symbol")
        }
        if targetMembershipId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("targetMembershipId is required")
        }
        if !assistMobileWorkspaceLocalRecordIsDateTime(updatedAt) {
            errors.append("updatedAt must be a valid date-time")
        }
        if entries.isEmpty { errors.append("entries must contain at least one knowledge entry") }
        if entries.count > 200 { errors.append("entries must contain at most 200 knowledge entries") }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("message is required")
        }
        var ids = Set<String>()
        var replacedTargets = Set<String>()
        for (index, entry) in entries.enumerated() {
            do {
                try entry.validateForUserDefaults()
            } catch AssistReviewKnowledgeMutationError.invalid(let entryErrors) {
                errors.append(contentsOf: entryErrors.map { "entries[\(index)].\($0)" })
            } catch {
                errors.append("entries[\(index)] failed validation")
            }
            if entry.storageScope != storageScope {
                errors.append("entries[\(index)].storageScope must match collection storageScope")
            }
            if entry.target.symbol != targetSymbol {
                errors.append("entries[\(index)].target.symbol must match targetSymbol")
            }
            if entry.target.candidateMembershipId != targetMembershipId {
                errors.append("entries[\(index)].target.candidateMembershipId must match targetMembershipId")
            }
            if !ids.insert(entry.knowledgeId).inserted {
                errors.append("entries[\(index)].knowledgeId must be unique")
            }
            if index > 0 && assistReviewKnowledgePrecedes(entry, entries[index - 1]) {
                errors.append("entries must use canonical newest-first ordering")
            }
            for (label, targetId) in [
                ("correctionOfKnowledgeId", entry.lineage.correctionOfKnowledgeId),
                ("replacesKnowledgeId", entry.lineage.replacesKnowledgeId)
            ] {
                guard let targetId else { continue }
                guard let targetIndex = entries.firstIndex(where: { $0.knowledgeId == targetId }) else {
                    errors.append("entries[\(index)].lineage.\(label) must reference an entry in this collection")
                    continue
                }
                if targetIndex <= index {
                    errors.append("entries[\(index)].lineage.\(label) must reference an older entry")
                }
            }
            if let replacedId = entry.lineage.replacesKnowledgeId,
               !replacedTargets.insert(replacedId).inserted {
                errors.append("replacesKnowledgeId target \(replacedId) must not be replaced more than once")
            }
        }
        if entries.first?.updatedAt != updatedAt {
            errors.append("collection updatedAt must equal the newest entry updatedAt")
        }
        if !errors.isEmpty { throw AssistReviewKnowledgeMutationError.invalid(errors) }
    }
}

public struct AssistReviewKnowledgeBuildInput: Equatable, Sendable {
    public let symbol: String
    public let membershipId: String
    public let membershipVersion: Int
    public let sourceSignature: String
    public let decisionContextId: String?
    public let decisionContextHash: String?
    public let localRecordId: String?
    public let reviewHistoryAsOf: String?
    public let decisionCheckIds: [String]
    public let postDecisionReviewIds: [String]
    public let snapshotAvailability: AssistReviewKnowledgeSnapshotAvailability
    public let correctionOfKnowledgeId: String?
    public let replacesKnowledgeId: String?
    public let fields: AssistReviewKnowledgeFields
    public let nowIso: String
}

public struct AssistReviewKnowledgeCurrentIdentity: Equatable, Sendable {
    public let symbol: String
    public let membershipId: String
    public let membershipVersion: Int
    public let sourceSignature: String
    public let decisionContextId: String
    public let decisionContextHash: String
}

public struct AssistReviewKnowledgeViewEntry: Equatable, Identifiable, Sendable {
    public var id: String { envelope.knowledgeId }
    public let envelope: AssistReviewKnowledgeEnvelope
    public let relation: AssistReviewKnowledgeSourceRelation
    public let usableAsCurrentSource: Bool
    public let superseded: Bool
    public let message: String
}

public struct AssistReviewKnowledgeLoadResult: Equatable, Sendable {
    public let ok: Bool
    public let state: AssistReviewKnowledgeLoadState
    public let collection: AssistReviewKnowledgeCollection?
    public let entries: [AssistReviewKnowledgeViewEntry]
    public let currentEntries: [AssistReviewKnowledgeViewEntry]
    public let historicalEntries: [AssistReviewKnowledgeViewEntry]
    public let message: String
}

public func assistReviewKnowledgeBuildEnvelope(_ input: AssistReviewKnowledgeBuildInput) throws -> AssistReviewKnowledgeEnvelope {
    let symbol = input.symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    guard assistReviewKnowledgeIsCanonicalSymbol(symbol) else {
        throw AssistReviewKnowledgeMutationError.invalid(["knowledge requires a canonical HK five-digit symbol"])
    }
    guard assistMobileWorkspaceLocalRecordIsDateTime(input.nowIso) else {
        throw AssistReviewKnowledgeMutationError.invalid(["nowIso must be a valid date-time"])
    }
    let correctionOf = assistReviewKnowledgeOptionalText(input.correctionOfKnowledgeId, maximumLength: 500)
    let replaces = assistReviewKnowledgeOptionalText(input.replacesKnowledgeId, maximumLength: 500)
    let envelope = AssistReviewKnowledgeEnvelope(
        schemaVersion: ASSIST_REVIEW_KNOWLEDGE_SCHEMA_VERSION,
        knowledgeId: "assist-review-knowledge:\(symbol):\(input.nowIso)",
        createdAt: input.nowIso,
        updatedAt: input.nowIso,
        storageScope: "ios_user_defaults",
        target: AssistReviewKnowledgeTarget(
            market: "HK",
            code: String(symbol.suffix(5)),
            symbol: symbol,
            candidateMembershipId: input.membershipId.trimmingCharacters(in: .whitespacesAndNewlines),
            candidateMembershipVersion: input.membershipVersion
        ),
        sourceRef: AssistReviewKnowledgeSourceRef(
            sourceSignature: String(input.sourceSignature.trimmingCharacters(in: .whitespacesAndNewlines).prefix(4000)),
            decisionContextId: assistReviewKnowledgeOptionalText(input.decisionContextId, maximumLength: 1000),
            decisionContextHash: assistReviewKnowledgeOptionalText(input.decisionContextHash, maximumLength: 1000),
            localRecordId: assistReviewKnowledgeOptionalText(input.localRecordId, maximumLength: 4000)
        ),
        reviewRefs: AssistReviewKnowledgeReviewRefs(
            reviewHistoryAsOf: input.reviewHistoryAsOf,
            decisionCheckIds: input.decisionCheckIds,
            postDecisionReviewIds: input.postDecisionReviewIds,
            snapshotAvailability: input.snapshotAvailability
        ),
        lineage: AssistReviewKnowledgeLineage(
            correctionOfKnowledgeId: correctionOf,
            replacesKnowledgeId: replaces
        ),
        metadata: FactMetadata(
            source: "ios_user_defaults",
            asOf: input.nowIso,
            fetchedAt: nil,
            freshness: "historical",
            provenance: "local_only",
            authority: "local_only",
            stale: false,
            missing: false,
            conflict: false,
            fixture: false,
            correctionOf: correctionOf,
            replaces: replaces,
            message: "iOS UserDefaults retrospective knowledge metadata is historical, source-scoped, unofficial, and local-only."
        ),
        fields: input.fields.clamped(),
        safety: .iosUserDefaultsLocalOnly,
        message: "Saved on this iOS device only as unofficial retrospective knowledge; review IDs are references only and no API, database, official review, portfolio, broker, or trading fact is created."
    )
    try envelope.validateForUserDefaults()
    return envelope
}

public func assistReviewKnowledgeLoad(
    storage: AssistReviewKnowledgeLocalStorage,
    symbol: String,
    currentIdentity: AssistReviewKnowledgeCurrentIdentity?
) -> AssistReviewKnowledgeLoadResult {
    let canonical = symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    guard assistReviewKnowledgeIsCanonicalSymbol(canonical) else {
        return assistReviewKnowledgeFailure(.malformed, "Retrospective knowledge requires a canonical HK symbol; old display is cleared.")
    }
    guard let currentIdentity,
          assistReviewKnowledgeIdentityErrors(currentIdentity, expectedSymbol: canonical).isEmpty else {
        return assistReviewKnowledgeFailure(.sourceUnavailable, "Current membership and source identity are unavailable; iOS UserDefaults was not read and old knowledge display is cleared.")
    }
    let key: String
    do {
        key = try assistReviewKnowledgeStorageKey(membershipId: currentIdentity.membershipId, symbol: canonical)
    } catch {
        return assistReviewKnowledgeFailure(.malformed, "Retrospective knowledge requires a canonical HK symbol; old display is cleared.")
    }
    let raw: String?
    do {
        raw = try storage.readString(forKey: key)
    } catch {
        return assistReviewKnowledgeFailure(.storageUnavailable, "iOS UserDefaults knowledge read failed; old knowledge display is cleared.")
    }
    guard let raw, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        return assistReviewKnowledgeFailure(.missing, "No iOS UserDefaults retrospective knowledge exists for \(symbol.uppercased()).")
    }
    guard raw.lengthOfBytes(using: .utf8) <= ASSIST_REVIEW_KNOWLEDGE_MAX_RAW_BYTES else {
        return assistReviewKnowledgeFailure(
            .malformed,
            "Saved retrospective knowledge exceeds the \(ASSIST_REVIEW_KNOWLEDGE_MAX_RAW_BYTES)-byte local limit; old display is cleared and the stored value is not parsed."
        )
    }
    let data = Data(raw.utf8)
    do {
        let object = try JSONSerialization.jsonObject(with: data)
        var shapeErrors: [String] = []
        assistReviewKnowledgeValidateJSONShape(object, errors: &shapeErrors)
        if !shapeErrors.isEmpty {
            return assistReviewKnowledgeFailure(.malformed, "Saved retrospective knowledge failed shape validation; old display is cleared. \(shapeErrors.joined(separator: "; "))")
        }
        let collection = try JSONDecoder().decode(AssistReviewKnowledgeCollection.self, from: data)
        if collection.targetSymbol != canonical || collection.targetMembershipId != currentIdentity.membershipId {
            return assistReviewKnowledgeFailure(.mismatch, "Saved retrospective knowledge owner does not match the current membership and symbol; old display is cleared.")
        }
        do {
            try collection.validateForUserDefaults()
        } catch AssistReviewKnowledgeMutationError.invalid(let errors) {
            return assistReviewKnowledgeFailure(.malformed, "Saved retrospective knowledge failed contract validation; old display is cleared. \(errors.joined(separator: "; "))")
        }
        let entries = assistReviewKnowledgeClassifyCollection(collection, currentIdentity: currentIdentity)
        let currentEntries = entries.filter { $0.relation == .currentSource }
        let historicalEntries = entries.filter { $0.relation != .currentSource }
        return AssistReviewKnowledgeLoadResult(
            ok: true,
            state: .loaded,
            collection: collection,
            entries: entries,
            currentEntries: currentEntries,
            historicalEntries: historicalEntries,
            message: "Loaded \(entries.count) iOS-local retrospective knowledge entries for \(collection.targetSymbol); \(currentEntries.count) match the current source."
        )
    } catch {
        return assistReviewKnowledgeFailure(.malformed, "Saved retrospective knowledge is malformed; old display is cleared and the stored value is not trusted.")
    }
}

public func assistReviewKnowledgeSave(
    storage: AssistReviewKnowledgeLocalStorage,
    input: AssistReviewKnowledgeBuildInput,
    currentIdentity: AssistReviewKnowledgeCurrentIdentity
) throws -> (entry: AssistReviewKnowledgeEnvelope, collection: AssistReviewKnowledgeCollection) {
    let canonicalInputSymbol = input.symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    let saveIdentityErrors = assistReviewKnowledgeIdentityErrors(currentIdentity, expectedSymbol: canonicalInputSymbol) + [
        canonicalInputSymbol == currentIdentity.symbol ? nil : "save symbol must match current identity",
        input.membershipId == currentIdentity.membershipId ? nil : "save membershipId must match current identity",
        input.membershipVersion == currentIdentity.membershipVersion ? nil : "save membershipVersion must match current identity",
        input.sourceSignature == currentIdentity.sourceSignature ? nil : "save sourceSignature must match current identity",
        input.decisionContextId == currentIdentity.decisionContextId ? nil : "save decisionContextId must match current identity",
        input.decisionContextHash == currentIdentity.decisionContextHash ? nil : "save decisionContextHash must match current identity"
    ].compactMap { $0 }
    if !saveIdentityErrors.isEmpty {
        throw AssistReviewKnowledgeMutationError.invalid(saveIdentityErrors)
    }
    let existing = try assistReviewKnowledgeEntriesForMutation(storage: storage, symbol: input.symbol, currentIdentity: currentIdentity)
    let entry = try assistReviewKnowledgeBuildEnvelope(input)
    if existing.contains(where: { $0.knowledgeId == entry.knowledgeId }) {
        throw AssistReviewKnowledgeMutationError.conflict("A knowledge entry with the same local identity already exists; retry with a new timestamp.")
    }
    if let replaces = entry.lineage.replacesKnowledgeId,
       !existing.contains(where: { $0.knowledgeId == replaces }) {
        throw AssistReviewKnowledgeMutationError.conflict("The selected replacement knowledge entry no longer exists in this symbol collection.")
    }
    if let replaces = entry.lineage.replacesKnowledgeId,
       existing.contains(where: { $0.lineage.replacesKnowledgeId == replaces }) {
        throw AssistReviewKnowledgeMutationError.conflict("The selected knowledge entry has already been replaced by a newer local entry.")
    }
    if let correction = entry.lineage.correctionOfKnowledgeId,
       !existing.contains(where: { $0.knowledgeId == correction }) {
        throw AssistReviewKnowledgeMutationError.conflict("The selected correction knowledge entry no longer exists in this symbol collection.")
    }
    if existing.count >= 200 {
        throw AssistReviewKnowledgeMutationError.conflict("The symbol knowledge collection already contains the maximum 200 entries.")
    }
    let entries = ([entry] + existing).sorted(by: assistReviewKnowledgePrecedes)
    let collection = try assistReviewKnowledgeBuildCollection(
        symbol: entry.target.symbol,
        membershipId: entry.target.candidateMembershipId,
        entries: entries
    )
    let data = try JSONEncoder().encode(collection)
    guard data.count <= ASSIST_REVIEW_KNOWLEDGE_MAX_RAW_BYTES else {
        throw AssistReviewKnowledgeMutationError.invalid(["encoded knowledge collection exceeds the local raw-size limit"])
    }
    guard let raw = String(data: data, encoding: .utf8) else {
        throw AssistReviewKnowledgeMutationError.invalid(["encoded knowledge collection must be UTF-8"])
    }
    do {
        try storage.writeString(raw, forKey: assistReviewKnowledgeStorageKey(membershipId: currentIdentity.membershipId, symbol: entry.target.symbol))
    } catch let error as AssistReviewKnowledgeMutationError {
        throw error
    } catch {
        throw AssistReviewKnowledgeMutationError.storageUnavailable("iOS UserDefaults knowledge save failed")
    }
    return (entry, collection)
}

public func assistReviewKnowledgeClearEntry(
    storage: AssistReviewKnowledgeLocalStorage,
    symbol: String,
    knowledgeId: String,
    currentIdentity: AssistReviewKnowledgeCurrentIdentity
) throws -> AssistReviewKnowledgeCollection? {
    let canonical = symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    let identityErrors = assistReviewKnowledgeIdentityErrors(currentIdentity, expectedSymbol: canonical)
    if !identityErrors.isEmpty { throw AssistReviewKnowledgeMutationError.invalid(identityErrors) }
    let existing = try assistReviewKnowledgeEntriesForMutation(storage: storage, symbol: canonical, currentIdentity: currentIdentity)
    if existing.contains(where: {
        $0.knowledgeId != knowledgeId &&
            ($0.lineage.correctionOfKnowledgeId == knowledgeId || $0.lineage.replacesKnowledgeId == knowledgeId)
    }) {
        throw AssistReviewKnowledgeMutationError.conflict("The selected knowledge entry is referenced by newer lineage and cannot be cleared without leaving a dangling reference.")
    }
    guard let selected = existing.first(where: { $0.knowledgeId == knowledgeId }) else {
        throw AssistReviewKnowledgeMutationError.conflict("The selected knowledge entry no longer exists.")
    }
    if selected.isDeletionTombstone {
        throw AssistReviewKnowledgeMutationError.conflict("The selected knowledge entry body is already deleted.")
    }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let deletedAt = formatter.string(from: Date())
    let tombstone = AssistReviewKnowledgeEnvelope(
        schemaVersion: selected.schemaVersion,
        knowledgeId: selected.knowledgeId,
        createdAt: selected.createdAt,
        updatedAt: deletedAt,
        storageScope: selected.storageScope,
        target: selected.target,
        sourceRef: AssistReviewKnowledgeSourceRef(
            sourceSignature: "deleted",
            decisionContextId: nil,
            decisionContextHash: nil,
            localRecordId: nil
        ),
        reviewRefs: AssistReviewKnowledgeReviewRefs(
            reviewHistoryAsOf: nil,
            decisionCheckIds: [],
            postDecisionReviewIds: [],
            snapshotAvailability: .notReferenced
        ),
        lineage: selected.lineage,
        metadata: FactMetadata(
            source: "ios_user_defaults",
            asOf: deletedAt,
            fetchedAt: nil,
            freshness: "missing",
            provenance: "local_only",
            authority: "local_only",
            stale: false,
            missing: true,
            conflict: false,
            fixture: false,
            correctionOf: selected.lineage.correctionOfKnowledgeId,
            replaces: selected.lineage.replacesKnowledgeId,
            message: "Owner-confirmed local deletion removed the knowledge body and retained this contentless tombstone."
        ),
        fields: .empty,
        safety: .iosUserDefaultsLocalOnly,
        message: "Knowledge body deleted on this device; earlier exported or cloud backup copies may still contain the old body."
    )
    try tombstone.validateForUserDefaults()
    let remaining = existing.map { $0.knowledgeId == knowledgeId ? tombstone : $0 }
    let key = try assistReviewKnowledgeStorageKey(membershipId: currentIdentity.membershipId, symbol: canonical)
    do {
        let collection = try assistReviewKnowledgeBuildCollection(
            symbol: canonical,
            membershipId: currentIdentity.membershipId,
            entries: remaining.sorted(by: assistReviewKnowledgePrecedes)
        )
        let data = try JSONEncoder().encode(collection)
        guard data.count <= ASSIST_REVIEW_KNOWLEDGE_MAX_RAW_BYTES else {
            throw AssistReviewKnowledgeMutationError.invalid(["encoded knowledge collection exceeds the local raw-size limit"])
        }
        guard let raw = String(data: data, encoding: .utf8) else {
            throw AssistReviewKnowledgeMutationError.invalid(["encoded knowledge collection must be UTF-8"])
        }
        try storage.writeString(raw, forKey: key)
        return collection
    } catch let error as AssistReviewKnowledgeMutationError {
        throw error
    } catch {
        throw AssistReviewKnowledgeMutationError.storageUnavailable("iOS UserDefaults knowledge clear failed")
    }
}

public func assistReviewKnowledgeClearCollection(
    storage: AssistReviewKnowledgeLocalStorage,
    symbol: String,
    currentIdentity: AssistReviewKnowledgeCurrentIdentity
) throws {
    let canonical = symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    let identityErrors = assistReviewKnowledgeIdentityErrors(currentIdentity, expectedSymbol: canonical)
    if !identityErrors.isEmpty { throw AssistReviewKnowledgeMutationError.invalid(identityErrors) }
    do {
        try storage.removeValue(forKey: assistReviewKnowledgeStorageKey(membershipId: currentIdentity.membershipId, symbol: canonical))
    } catch let error as AssistReviewKnowledgeMutationError {
        throw error
    } catch {
        throw AssistReviewKnowledgeMutationError.storageUnavailable("iOS UserDefaults knowledge collection clear failed")
    }
}

public func assistReviewKnowledgeClassify(
    _ envelope: AssistReviewKnowledgeEnvelope,
    currentIdentity: AssistReviewKnowledgeCurrentIdentity?,
    superseded: Bool = false
) -> AssistReviewKnowledgeViewEntry {
    if envelope.isDeletionTombstone {
        return AssistReviewKnowledgeViewEntry(
            envelope: envelope,
            relation: .historicalSource,
            usableAsCurrentSource: false,
            superseded: superseded,
            message: "The knowledge body was deleted by the Owner; this contentless local tombstone is retained only for deletion history and backup continuity."
        )
    }
    guard let currentIdentity else {
        return AssistReviewKnowledgeViewEntry(
            envelope: envelope,
            relation: .sourceUnavailable,
            usableAsCurrentSource: false,
            superseded: superseded,
            message: "Current source signature is unavailable; this entry is historical local reference only and is not used as a current fact."
        )
    }
    let identityMatches = envelope.target.symbol == currentIdentity.symbol &&
        envelope.target.candidateMembershipId == currentIdentity.membershipId &&
        envelope.target.candidateMembershipVersion == currentIdentity.membershipVersion &&
        envelope.sourceRef.sourceSignature == currentIdentity.sourceSignature &&
        envelope.sourceRef.decisionContextId == currentIdentity.decisionContextId &&
        envelope.sourceRef.decisionContextHash == currentIdentity.decisionContextHash
    if identityMatches && !superseded {
        return AssistReviewKnowledgeViewEntry(
            envelope: envelope,
            relation: .currentSource,
            usableAsCurrentSource: true,
            superseded: false,
            message: "Source signature matches the current local workflow; this remains unofficial local retrospective assistance, not an official fact."
        )
    }
    return AssistReviewKnowledgeViewEntry(
        envelope: envelope,
        relation: .historicalSource,
        usableAsCurrentSource: false,
        superseded: superseded,
        message: superseded
            ? "A newer local entry replaces this entry; it remains visible as superseded history and can never be used as current evidence."
            : "Source target, membership/version, context identity, or signature differs from the current workflow; this entry is visibly historical and is never silently reused as current evidence."
    )
}

public func assistReviewKnowledgeEntrySummary(_ view: AssistReviewKnowledgeViewEntry) -> [String] {
    let entry = view.envelope
    return [
        "\(view.relation.rawValue): \(entry.knowledgeId); updatedAt=\(entry.updatedAt); usableAsCurrentSource=\(view.usableAsCurrentSource); superseded=\(view.superseded).",
        "Target=\(entry.target.symbol); membership=\(entry.target.candidateMembershipId); version=\(entry.target.candidateMembershipVersion).",
        "Source context=\(entry.sourceRef.decisionContextId ?? "missing"); hash=\(entry.sourceRef.decisionContextHash ?? "missing"); localRecord=\(entry.sourceRef.localRecordId ?? "not referenced").",
        "Review ID references only: checks=\(entry.reviewRefs.decisionCheckIds.count); reviews=\(entry.reviewRefs.postDecisionReviewIds.count); historyAsOf=\(entry.reviewRefs.reviewHistoryAsOf ?? "not referenced"); snapshot=\(entry.reviewRefs.snapshotAvailability.rawValue).",
        "Lineage: correctionOf=\(entry.lineage.correctionOfKnowledgeId ?? "none"); replaces=\(entry.lineage.replacesKnowledgeId ?? "none").",
        view.message
    ]
}

func assistReviewKnowledgeBuildCollection(
    symbol: String,
    membershipId: String,
    entries: [AssistReviewKnowledgeEnvelope]
) throws -> AssistReviewKnowledgeCollection {
    guard let newest = entries.first else {
        throw AssistReviewKnowledgeMutationError.invalid(["entries must contain at least one knowledge entry"])
    }
    let collection = AssistReviewKnowledgeCollection(
        schemaVersion: ASSIST_REVIEW_KNOWLEDGE_COLLECTION_SCHEMA_VERSION,
        storageScope: "ios_user_defaults",
        targetSymbol: symbol,
        targetMembershipId: membershipId,
        updatedAt: newest.updatedAt,
        entries: entries,
        message: "iOS UserDefaults membership-and-symbol-scoped retrospective knowledge collection; historical entries never become current facts without an exact source-signature match."
    )
    try collection.validateForUserDefaults()
    return collection
}

private func assistReviewKnowledgeEntriesForMutation(
    storage: AssistReviewKnowledgeLocalStorage,
    symbol: String,
    currentIdentity: AssistReviewKnowledgeCurrentIdentity
) throws -> [AssistReviewKnowledgeEnvelope] {
    let result = assistReviewKnowledgeLoad(storage: storage, symbol: symbol, currentIdentity: currentIdentity)
    if result.ok { return result.collection?.entries ?? [] }
    switch result.state {
    case .missing:
        return []
    case .storageUnavailable:
        throw AssistReviewKnowledgeMutationError.storageUnavailable("iOS UserDefaults knowledge read failed")
    case .sourceUnavailable, .mismatch, .malformed, .loaded:
        throw AssistReviewKnowledgeMutationError.conflict("\(result.message) Clear the invalid membership-and-symbol collection explicitly before saving new knowledge.")
    }
}

private func assistReviewKnowledgeClassifyCollection(
    _ collection: AssistReviewKnowledgeCollection,
    currentIdentity: AssistReviewKnowledgeCurrentIdentity?
) -> [AssistReviewKnowledgeViewEntry] {
    var replacedByNewerEntries = Set<String>()
    return collection.entries.map { entry in
        let view = assistReviewKnowledgeClassify(
            entry,
            currentIdentity: currentIdentity,
            superseded: replacedByNewerEntries.contains(entry.knowledgeId)
        )
        if let replacedId = entry.lineage.replacesKnowledgeId {
            replacedByNewerEntries.insert(replacedId)
        }
        return view
    }
}

public func assistReviewKnowledgeCanClearInvalidCollection(
    state: AssistReviewKnowledgeLoadState
) -> Bool {
    state == .malformed || state == .mismatch
}

private func assistReviewKnowledgeFailure(
    _ state: AssistReviewKnowledgeLoadState,
    _ message: String
) -> AssistReviewKnowledgeLoadResult {
    AssistReviewKnowledgeLoadResult(
        ok: false,
        state: state,
        collection: nil,
        entries: [],
        currentEntries: [],
        historicalEntries: [],
        message: message
    )
}

private func assistReviewKnowledgeValidateIds(_ values: [String], label: String, errors: inout [String]) {
    if values.count > 100 { errors.append("\(label) must contain at most 100 IDs") }
    var ids = Set<String>()
    for (index, value) in values.enumerated() {
        if value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(label)[\(index)] must be a non-empty string")
        }
        if !ids.insert(value).inserted { errors.append("\(label) must not contain duplicate IDs") }
    }
}

private func assistReviewKnowledgeOptionalText(_ value: String?, maximumLength: Int) -> String? {
    guard let value else { return nil }
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { return nil }
    return String(normalized.prefix(maximumLength))
}

private func assistReviewKnowledgeEncodeNullable<Key: CodingKey>(
    _ value: String?,
    container: inout KeyedEncodingContainer<Key>,
    key: Key
) throws {
    if let value {
        try container.encode(value, forKey: key)
    } else {
        try container.encodeNil(forKey: key)
    }
}

private func assistReviewKnowledgeIsCanonicalSymbol(_ symbol: String) -> Bool {
    symbol.range(of: #"^HK\.\d{5}$"#, options: .regularExpression) != nil
}

private func assistReviewKnowledgeDate(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: value) { return date }
    let standard = ISO8601DateFormatter()
    standard.formatOptions = [.withInternetDateTime]
    return standard.date(from: value)
}

func assistReviewKnowledgePrecedes(
    _ left: AssistReviewKnowledgeEnvelope,
    _ right: AssistReviewKnowledgeEnvelope
) -> Bool {
    if left.updatedAt != right.updatedAt { return left.updatedAt > right.updatedAt }
    return left.knowledgeId > right.knowledgeId
}

private let assistReviewKnowledgeForbiddenKeys: Set<String> = [
    "recommendation", "rank", "ranking", "score", "rating", "signal", "buy", "sell", "hold",
    "targetPrice", "stopLoss", "takeProfit", "expectedReturn", "timing", "sizing", "allocation",
    "rebalance", "order", "trade", "fill", "cash", "fee", "position", "broker", "portfolioMutation",
    "officialReview", "officialReviewRecord", "accountAuthority", "productionReady"
]

private let assistReviewKnowledgeRequiredKeys: [String: Set<String>] = [
    "collection": ["schemaVersion", "storageScope", "targetSymbol", "targetMembershipId", "updatedAt", "entries", "message"],
    "entry": ["schemaVersion", "knowledgeId", "createdAt", "updatedAt", "storageScope", "target", "sourceRef", "reviewRefs", "lineage", "metadata", "fields", "safety", "message"],
    "target": ["market", "code", "symbol", "candidateMembershipId", "candidateMembershipVersion"],
    "sourceRef": ["sourceSignature", "decisionContextId", "decisionContextHash", "localRecordId"],
    "reviewRefs": ["reviewHistoryAsOf", "decisionCheckIds", "postDecisionReviewIds", "snapshotAvailability"],
    "lineage": ["correctionOfKnowledgeId", "replacesKnowledgeId"],
    "metadata": ["source", "asOf", "fetchedAt", "freshness", "provenance", "authority", "stale", "missing", "conflict", "fixture", "correctionOf", "replaces", "message"],
    "fields": ["evidenceLesson", "processLesson", "unresolvedQuestion", "uncertaintyNote"],
    "safety": ["localOnly", "unofficial", "readOnlyAssistance", "apiUploaded", "serverPersisted", "databaseWritten", "officialReviewFact", "officialPortfolioFact", "brokerSynced", "changesCandidateOrdering", "createsRecommendation", "createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker", "productionWrite"]
]

private func assistReviewKnowledgeValidateJSONShape(_ value: Any, errors: inout [String]) {
    guard let collection = value as? [String: Any] else {
        errors.append("collection must be an object")
        return
    }
    assistReviewKnowledgeValidateObject(collection, kind: "collection", path: "collection", errors: &errors)
    guard let entries = collection["entries"] as? [Any] else {
        errors.append("collection.entries must be an array")
        return
    }
    guard entries.count <= 200 else {
        errors.append("collection.entries must contain at most 200 knowledge entries")
        return
    }
    for (index, rawEntry) in entries.enumerated() {
        guard let entry = rawEntry as? [String: Any] else {
            errors.append("collection.entries[\(index)] must be an object")
            continue
        }
        let path = "collection.entries[\(index)]"
        assistReviewKnowledgeValidateObject(entry, kind: "entry", path: path, errors: &errors)
        for (key, kind) in [
            ("target", "target"),
            ("sourceRef", "sourceRef"),
            ("reviewRefs", "reviewRefs"),
            ("lineage", "lineage"),
            ("metadata", "metadata"),
            ("fields", "fields"),
            ("safety", "safety")
        ] {
            guard let child = entry[key] as? [String: Any] else {
                errors.append("\(path).\(key) must be an object")
                continue
            }
            assistReviewKnowledgeValidateObject(child, kind: kind, path: "\(path).\(key)", errors: &errors)
        }
    }
    assistReviewKnowledgeCollectForbiddenKeys(value, path: "collection", errors: &errors)
}

private func assistReviewKnowledgeValidateObject(
    _ object: [String: Any],
    kind: String,
    path: String,
    errors: inout [String]
) {
    guard let required = assistReviewKnowledgeRequiredKeys[kind] else { return }
    for key in object.keys where !required.contains(key) {
        errors.append("\(path).\(key) is not allowed")
    }
    for key in required where object[key] == nil {
        errors.append("\(path).\(key) is required")
    }
}

private func assistReviewKnowledgeCollectForbiddenKeys(_ value: Any, path: String, errors: inout [String]) {
    let maximumDepth = 32
    let maximumNodes = 5000
    var stack: [(value: Any, path: String, depth: Int)] = [(value, path, 0)]
    var visitedNodes = 0
    while let node = stack.popLast() {
        visitedNodes += 1
        if visitedNodes > maximumNodes {
            errors.append("collection JSON exceeds the maximum \(maximumNodes) inspected nodes")
            return
        }
        if node.depth > maximumDepth {
            errors.append("\(node.path) exceeds the maximum JSON depth \(maximumDepth)")
            continue
        }
        if let object = node.value as? [String: Any] {
            let remainingNodeBudget = maximumNodes - visitedNodes - stack.count
            guard object.count <= remainingNodeBudget else {
                errors.append("collection JSON exceeds the maximum \(maximumNodes) inspected nodes")
                return
            }
            for (key, child) in object {
                if assistReviewKnowledgeForbiddenKeys.contains(key) {
                    errors.append("\(node.path).\(key) is forbidden in local review knowledge")
                }
                stack.append((child, "\(node.path).\(key)", node.depth + 1))
            }
        } else if let array = node.value as? [Any] {
            let remainingNodeBudget = maximumNodes - visitedNodes - stack.count
            guard array.count <= remainingNodeBudget else {
                errors.append("collection JSON exceeds the maximum \(maximumNodes) inspected nodes")
                return
            }
            for (index, child) in array.enumerated() {
                stack.append((child, "\(node.path)[\(index)]", node.depth + 1))
            }
        }
    }
}

public enum AssistMobileWorkspaceAccessibility {
    public static let candidateList = "assistMobileWorkspaceCandidateList"
    public static let selectedCandidate = "assistMobileWorkspaceSelectedCandidate"
    public static let selectedCandidateDecisionBridge = "assistMobileWorkspaceSelectedCandidateDecisionBridge"
    public static let selectedCandidateDecisionContextBridge = "assistMobileWorkspaceSelectedCandidateDecisionContextBridge"
    public static let selectedCandidateAdvisoryScopeBridge = "assistMobileWorkspaceSelectedCandidateAdvisoryScopeBridge"
    public static let selectedCandidateHumanReviewBridge = "assistMobileWorkspaceSelectedCandidateHumanReviewBridge"
    public static let selectedCandidateFollowUpBridge = "assistMobileWorkspaceSelectedCandidateFollowUpBridge"
    public static let selectedCandidateDecisionNoteBridge = "assistMobileWorkspaceSelectedCandidateDecisionNoteBridge"
    public static let researchProfile = "assistMobileWorkspaceResearchProfile"
    public static let decisionContext = "assistMobileWorkspaceDecisionContext"
    public static let decisionIntake = "assistMobileWorkspaceDecisionIntake"
    public static let advisoryScope = "assistMobileWorkspaceAdvisoryScope"
    public static let humanReviewWorkspace = "assistMobileWorkspaceHumanReviewWorkspace"
    public static let followUpWorkflow = "assistMobileWorkspaceFollowUpWorkflow"
    public static let decisionNoteWorkflow = "assistMobileWorkspaceDecisionNoteWorkflow"
    public static let safetyBoundary = "assistMobileWorkspaceSafetyBoundary"
    public static let failClosedMessage = "assistMobileWorkspaceFailClosedMessage"
    public static let localDraftFields = "assistMobileWorkspaceLocalDraftFields"
    public static let blockedExternalActions = "assistMobileWorkspaceBlockedExternalActions"
    public static let betaRcReadiness = "assistMobileWorkspaceBetaRcReadiness"
    public static let productionNoGo = "assistMobileWorkspaceProductionNoGo"
    public static let deviceTestPending = "assistMobileWorkspaceDeviceTestPending"
    public static let dailyUseRole = "assistMobileWorkspaceDailyUseRole"
    public static let currentFocus = "assistMobileWorkspaceCurrentFocus"
    public static let nextLocalAction = "assistMobileWorkspaceNextLocalAction"
    public static let productSplitBoundary = "assistMobileWorkspaceProductSplitBoundary"
    public static let localBetaAcceptanceStatus = "assistMobileWorkspaceLocalBetaAcceptanceStatus"
    public static let dailyReviewPath = "assistMobileWorkspaceDailyReviewPath"
    public static let researchEvidenceClarity = "assistMobileWorkspaceResearchEvidenceClarity"
    public static let fixtureDemoBoundary = "assistMobileWorkspaceFixtureDemoBoundary"
    public static let decisionNoteFollowUpStatus = "assistMobileWorkspaceDecisionNoteFollowUpStatus"
    public static let portfolioAuthorityBoundary = "assistMobileWorkspacePortfolioAuthorityBoundary"
    public static let portfolioAuthorityStateMatrix = "assistMobileWorkspacePortfolioAuthorityStateMatrix"
    public static let reliabilityStatus = "assistMobileWorkspaceReliabilityStatus"
    public static let dailyUseSnapshot = "assistMobileWorkspaceDailyUseSnapshot"
    public static let dailyUseStatus = "assistMobileWorkspaceDailyUseStatus"
    public static let currentCandidateSummary = "assistMobileWorkspaceCurrentCandidateSummary"
    public static let conciseResearchSummary = "assistMobileWorkspaceConciseResearchSummary"
    public static let conciseDecisionContextSummary = "assistMobileWorkspaceConciseDecisionContextSummary"
    public static let localDraftStatus = "assistMobileWorkspaceLocalDraftStatus"
    public static let evidenceGapStatus = "assistMobileWorkspaceEvidenceGapStatus"
    public static let availabilityStatus = "assistMobileWorkspaceAvailabilityStatus"
    public static let safetyShortCopy = "assistMobileWorkspaceSafetyShortCopy"
    public static let dailyUseAuthorityBadges = "assistMobileWorkspaceDailyUseAuthorityBadges"
    public static let dailyUseFactMetadataLedger = "assistMobileWorkspaceDailyUseFactMetadataLedger"
    public static let dailyUseReadinessChecklist = "assistMobileWorkspaceDailyUseReadinessChecklist"
    public static let dailyUseQuickActions = "assistMobileWorkspaceDailyUseQuickActions"
    public static let dailyUseReviewPathRail = "assistMobileWorkspaceDailyUseReviewPathRail"
    public static let fullGoalAcceptanceMatrix = "assistMobileWorkspaceFullGoalAcceptanceMatrix"
    public static let fullSystemDevelopmentMatrix = "assistMobileWorkspaceFullSystemDevelopmentMatrix"
    public static let releaseBlockerDashboard = "assistMobileWorkspaceReleaseBlockerDashboard"
    public static let coreAssistLoopClosureCheckpoint = "assistMobileWorkspaceCoreAssistLoopClosureCheckpoint"
    public static let failureStateUnificationMatrix = "assistMobileWorkspaceFailureStateUnificationMatrix"
    public static let failureStatePolicy = "assistMobileWorkspaceFailureStatePolicy"
    public static let unifiedFailureStateSummary = "assistMobileWorkspaceUnifiedFailureStateSummary"
    public static let unifiedFailureStateMetadataPolicy = "assistMobileWorkspaceUnifiedFailureStateMetadataPolicy"
    public static let localRecords = "assistMobileWorkspaceLocalRecords"
    public static let localRecordSourceSignature = "assistMobileWorkspaceLocalRecordSourceSignature"
    public static let localRecordFields = "assistMobileWorkspaceLocalRecordFields"
    public static let localRecordActions = "assistMobileWorkspaceLocalRecordActions"
    public static let localRecordStatus = "assistMobileWorkspaceLocalRecordStatus"
    public static let localRecordSafety = "assistMobileWorkspaceLocalRecordSafety"
    public static let reviewKnowledgeSection = "assistReviewKnowledgeSection"
    public static let reviewKnowledgeFields = "assistReviewKnowledgeFields"
    public static let reviewKnowledgeLineage = "assistReviewKnowledgeLineage"
    public static let reviewKnowledgeSave = "assistReviewKnowledgeSave"
    public static let reviewKnowledgeLoad = "assistReviewKnowledgeLoad"
    public static let reviewKnowledgeList = "assistReviewKnowledgeList"
    public static let reviewKnowledgeSelectedEntry = "assistReviewKnowledgeSelectedEntry"
    public static let reviewKnowledgeClearEntry = "assistReviewKnowledgeClearEntry"
    public static let reviewKnowledgeClearInvalidCollection = "assistReviewKnowledgeClearInvalidCollection"
    public static let reviewKnowledgeMessage = "assistReviewKnowledgeMessage"
}

public struct AssistMobileWorkspaceRenderModel: Equatable, Sendable {
    public let selectedCandidate: String
    public let selectedCandidateDecisionBridge: String
    public let selectedCandidateDecisionContextBridge: String
    public let selectedCandidateAdvisoryScopeBridge: String
    public let selectedCandidateHumanReviewBridge: String
    public let selectedCandidateFollowUpBridge: String
    public let selectedCandidateDecisionNoteBridge: String
    public let dailyUseStatus: String
    public let currentCandidateSummary: String
    public let conciseResearchSummary: String
    public let conciseDecisionContextSummary: String
    public let localDraftStatus: String
    public let evidenceGapStatus: String
    public let availabilityStatus: String
    public let safetyShortCopy: String
    public let dailyUseAuthorityBadges: [String]
    public let dailyUseFactMetadataLedger: [String]
    public let dailyUseReadinessChecklist: [String]
    public let dailyUseQuickActions: [String]
    public let dailyUseReviewPathRail: [String]
    public let dailyUseRole: String
    public let currentFocus: String
    public let nextLocalAction: String
    public let productSplitBoundary: String
    public let localBetaAcceptanceStatus: String
    public let dailyReviewPath: String
    public let researchEvidenceClarity: String
    public let fixtureDemoBoundary: String
    public let decisionNoteFollowUpStatus: String
    public let portfolioAuthorityBoundary: String
    public let portfolioAuthorityStateMatrix: [String]
    public let reliabilityStatus: String
    public let fullGoalAcceptanceMatrix: [String]
    public let fullSystemDevelopmentMatrix: [String]
    public let releaseBlockerDashboard: [String]
    public let coreAssistLoopClosureCheckpoint: [String]
    public let failureStateUnificationMatrix: [String]
    public let failureStatePolicy: [String]
    public let unifiedFailureStateSummary: [String]
    public let unifiedFailureStateMetadataPolicy: [String]
    public let localRecordStatus: String
    public let localRecordSourceSignature: String
    public let localRecordSummary: [String]
    public let localRecordSafety: [String]
    public let localRecordCanSave: Bool
    public let candidateMembershipState: String
    public let researchProfileSummary: String
    public let decisionContextSummary: String
    public let decisionIntakeSummary: String
    public let advisoryScopeSummary: String
    public let humanReviewWorkspaceSummary: String
    public let followUpWorkflowSummary: String
    public let decisionNoteSummary: String
    public let factReferences: [String]
    public let unresolvedEvidenceGaps: [String]
    public let pinganHistoricalOnlyBoundary: String
    public let portfolioOmittedBoundary: String
    public let blockedExternalActions: [String]
    public let localOnlyDraftExplanation: String
    public let safetyBoundary: String
    public let preDeviceBetaReadiness: String
    public let productionNoGo: String
    public let deviceTestPending: String
    public let failClosedExplanation: [String]
    public let loadingState: AssistMobileWorkspaceSectionState
    public let emptyState: AssistMobileWorkspaceSectionState
    public let unauthorizedState: AssistMobileWorkspaceSectionState
    public let notFoundState: AssistMobileWorkspaceSectionState
    public let unavailableState: AssistMobileWorkspaceSectionState
    public let malformedState: AssistMobileWorkspaceSectionState
    public let offlineState: AssistMobileWorkspaceSectionState
    public let supersededState: AssistMobileWorkspaceSectionState
}

public func assistMobileWorkspaceRenderModel(
    selectedMembership: CandidateMembershipData?,
    candidateMembershipMetadata: FactMetadata? = nil,
    researchProfile: ResearchProfileEnvelope?,
    decisionContext: DecisionContextEnvelope?,
    decisionContextMessage: String?,
    decisionReviewHistory: DecisionReviewHistoryEnvelope? = nil,
    decisionIntake: CandidateDecisionIntakeRenderModel,
    advisoryScope: AssistAdvisoryScopeRenderModel,
    humanReviewWorkspace: AssistHumanReviewWorkspaceRenderModel,
    followUpWorkflow: AssistReviewFollowUpWorkflowRenderModel,
    decisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel,
    pinganSnapshot: PinganSnapshotEnvelope?,
    pinganSnapshotMessage: String?,
    drafts: AssistMobileWorkspaceLocalDraftState,
    localRecordDrafts: AssistMobileWorkspaceLocalRecordDrafts = .empty,
    localRecordSnapshotSummary: [String] = [],
    isLoading: Bool
) -> AssistMobileWorkspaceRenderModel {
    let selectedCandidate = selectedMembership.map { "\($0.symbol) / \($0.id)" } ?? "未选择研究自选成员。"
    let selectedCandidateDecisionBridge = assistMobileWorkspaceSelectedCandidateDecisionBridge(
        selectedMembership: selectedMembership,
        decisionIntake: decisionIntake,
        isLoading: isLoading
    )
    let selectedCandidateDecisionContextBridge = assistMobileWorkspaceSelectedCandidateDecisionContextBridge(
        selectedMembership: selectedMembership,
        decisionContext: decisionContext,
        decisionContextMessage: decisionContextMessage,
        isLoading: isLoading
    )
    let selectedCandidateAdvisoryScopeBridge = assistMobileWorkspaceSelectedCandidateAdvisoryScopeBridge(
        selectedMembership: selectedMembership,
        advisoryScope: advisoryScope,
        isLoading: isLoading
    )
    let selectedCandidateHumanReviewBridge = assistMobileWorkspaceSelectedCandidateHumanReviewBridge(
        selectedMembership: selectedMembership,
        humanReviewWorkspace: humanReviewWorkspace,
        isLoading: isLoading
    )
    let selectedCandidateFollowUpBridge = assistMobileWorkspaceSelectedCandidateFollowUpBridge(
        selectedMembership: selectedMembership,
        followUpWorkflow: followUpWorkflow,
        isLoading: isLoading
    )
    let selectedCandidateDecisionNoteBridge = assistMobileWorkspaceSelectedCandidateDecisionNoteBridge(
        selectedMembership: selectedMembership,
        decisionNoteWorkflow: decisionNoteWorkflow,
        isLoading: isLoading
    )
    let membershipState = selectedMembership.map { "\($0.state.rawValue) / version=\($0.version)" } ?? "idle"
    let profileSummary = assistMobileWorkspaceProfileSummary(researchProfile)
    let decisionContextSummary = decisionContext.map {
        "\($0.contextId) / hash=\($0.contextHash) / quote=\($0.quote.status) / portfolio=\($0.portfolio.status)"
    } ?? (decisionContextMessage ?? "idle")
    let pinganBoundary = assistMobileWorkspacePinganBoundary(snapshot: pinganSnapshot, message: pinganSnapshotMessage)
    let combinedBlockedExternalActions = Array(Set(
        followUpWorkflow.blockedExternalActions +
        decisionNoteWorkflow.blockedExternalActions +
        [
            "No broker call",
            "No order, trade, fill, cash, fee, or position mutation",
            "No portfolio mutation",
            "No production release"
        ]
    )).sorted()

    let failClosed = [
        "decisionIntake=\(decisionIntake.state)",
        "advisoryScope=\(advisoryScope.state)",
        "humanReviewWorkspace=\(humanReviewWorkspace.state)",
        "followUpWorkflow=\(followUpWorkflow.state)",
        "decisionNoteWorkflow=\(decisionNoteWorkflow.state)",
        "superseded/offline/fail-closed loads clear local drafts and do not restore stale facts."
    ]
    let unresolvedGaps = Array(Set(followUpWorkflow.evidenceGaps + decisionNoteWorkflow.unresolvedEvidenceGaps)).sorted()
    let failClosedStates = [
        decisionIntake.state,
        advisoryScope.state,
        humanReviewWorkspace.state,
        followUpWorkflow.state,
        decisionNoteWorkflow.state
    ].filter(assistMobileWorkspaceIsFailClosedState)
    let dailyUseStatus = assistMobileWorkspaceDailyUseStatus(
        selectedMembership: selectedMembership,
        isLoading: isLoading,
        failClosedStates: failClosedStates
    )
    let localDraftStatus = assistMobileWorkspaceLocalDraftStatus(drafts)
    let evidenceGapStatus = assistMobileWorkspaceEvidenceGapStatus(unresolvedGaps)
    let availabilityStatus = assistMobileWorkspaceAvailabilityStatus(
        selectedMembership: selectedMembership,
        researchProfile: researchProfile,
        decisionContext: decisionContext,
        drafts: drafts,
        unresolvedGaps: unresolvedGaps,
        isLoading: isLoading,
        failClosedStates: failClosedStates
    )
    let currentFocus = selectedMembership.map {
        "Current focus is \($0.symbol). Open the local workspace to read facts, context, gaps, and local-only draft areas for this candidate."
    } ?? "Choose one tracked candidate membership before using the daily ASSIST-1 path."
    let nextLocalAction = unresolvedGaps.first.map {
        "Next local action: review unresolved evidence gap - \($0)"
    } ?? "Next local action: read the selected candidate summary, decision context, advisory scope, human-review workspace, follow-up workflow, and local decision-note draft."
    let dailyReviewPath = [
        "Open selected candidate",
        "Read research summary",
        "Read decision context",
        "Check decision intake",
        "Review advisory scope",
        "Use human-review workspace",
        "Draft local-only decision note",
        "Inspect follow-up workflow",
        "Resolve evidence gaps"
    ].joined(separator: " -> ")
    let researchEvidenceClarity = "Research and decision context show quote status, evidence count, stale/missing/unavailable states, and refuse inference when facts are unavailable."
    let fixtureDemoBoundary = "Repository-local demo data is fixture/sample/historical-only/unavailable/omitted as applicable; it is not live holdings, broker truth, real account data, or investment advice."
    let decisionNoteFollowUpStatus = "Decision-note and follow-up are usable local display workflows: rationale, unresolved gaps, later-review marker, and drafts remain local-only, not official, not persisted, and not sent."
    let portfolioAuthorityBoundary = "Pingan snapshot is historical-only and portfolio context can be omitted; neither is live broker truth, broker reconciliation, account truth, current holdings authority, risk-impact authority, accounting authority, execution input, or mutation authority."
    let portfolioAuthorityStateMatrix = assistMobileWorkspacePortfolioAuthorityStateMatrix(
        decisionContext: decisionContext,
        pinganSnapshot: pinganSnapshot,
        isLoading: isLoading,
        failClosedStates: failClosedStates
    )
    let fullGoalAcceptanceMatrix = assistMobileWorkspaceFullGoalAcceptanceMatrix()
    let fullSystemDevelopmentMatrix = assistMobileWorkspaceFullSystemDevelopmentMatrix()
    let releaseBlockerDashboard = assistMobileWorkspaceReleaseBlockerDashboard()
    let coreAssistLoopClosureCheckpoint = assistMobileWorkspaceCoreAssistLoopClosureCheckpoint()
    let failureStateUnificationMatrix = assistMobileWorkspaceFailureStateUnificationMatrix()
    let failureStatePolicy = assistMobileWorkspaceFailureStatePolicy()
    let unifiedFailureStateSummary = assistMobileWorkspaceUnifiedFailureStateSummary(
        isLoading: isLoading,
        decisionIntakeState: decisionIntake.state,
        decisionContextState: assistMobileWorkspaceDecisionContextUnifiedState(
            decisionContext: decisionContext,
            decisionContextMessage: decisionContextMessage,
            isLoading: isLoading
        ),
        advisoryScopeState: advisoryScope.state,
        humanReviewWorkspaceState: humanReviewWorkspace.state,
        followUpWorkflowState: followUpWorkflow.state,
        decisionNoteWorkflowState: decisionNoteWorkflow.state
    )
    let unifiedFailureStateMetadataPolicy = assistMobileWorkspaceUnifiedFailureStateMetadataPolicySummary(
        isLoading: isLoading,
        decisionIntakeState: decisionIntake.state,
        decisionContextState: assistMobileWorkspaceDecisionContextUnifiedState(
            decisionContext: decisionContext,
            decisionContextMessage: decisionContextMessage,
            isLoading: isLoading
        ),
        advisoryScopeState: advisoryScope.state,
        humanReviewWorkspaceState: humanReviewWorkspace.state,
        followUpWorkflowState: followUpWorkflow.state,
        decisionNoteWorkflowState: decisionNoteWorkflow.state
    )
    let localRecordState = assistMobileWorkspaceLocalRecordState(
        selectedMembership: selectedMembership,
        decisionContext: decisionContext,
        followUpWorkflow: followUpWorkflow,
        decisionNoteWorkflow: decisionNoteWorkflow,
        drafts: localRecordDrafts,
        snapshotSummary: localRecordSnapshotSummary,
        failClosedStates: failClosedStates
    )
    let dailyUseReadinessChecklist = assistMobileWorkspaceDailyUseReadinessChecklist(
        selectedMembership: selectedMembership,
        researchProfile: researchProfile,
        decisionContext: decisionContext,
        decisionIntake: decisionIntake,
        humanReviewWorkspace: humanReviewWorkspace,
        followUpWorkflow: followUpWorkflow,
        decisionNoteWorkflow: decisionNoteWorkflow,
        pinganSnapshot: pinganSnapshot,
        localRecordState: localRecordState,
        isLoading: isLoading,
        failClosedStates: failClosedStates
    )
    let dailyUseQuickActions = assistMobileWorkspaceDailyUseQuickActions(
        selectedMembership: selectedMembership,
        decisionContext: decisionContext,
        humanReviewWorkspace: humanReviewWorkspace,
        followUpWorkflow: followUpWorkflow,
        decisionNoteWorkflow: decisionNoteWorkflow,
        localRecordState: localRecordState,
        isLoading: isLoading,
        failClosedStates: failClosedStates
    )
    let dailyUseReviewPathRail = assistMobileWorkspaceDailyUseReviewPathRail(
        selectedMembership: selectedMembership,
        decisionContext: decisionContext,
        humanReviewWorkspace: humanReviewWorkspace,
        followUpWorkflow: followUpWorkflow,
        decisionNoteWorkflow: decisionNoteWorkflow,
        localRecordState: localRecordState,
        unresolvedGaps: unresolvedGaps,
        isLoading: isLoading,
        failClosedStates: failClosedStates
    )
    let dailyUseAuthorityBadges = assistMobileWorkspaceDailyUseAuthorityBadges(
        selectedMembership: selectedMembership,
        researchProfile: researchProfile,
        decisionContext: decisionContext,
        pinganSnapshot: pinganSnapshot,
        localRecordState: localRecordState,
        isLoading: isLoading,
        failClosedStates: failClosedStates
    )
    let dailyUseFactMetadataLedger = assistMobileWorkspaceDailyUseFactMetadataLedger(
        selectedMembership: selectedMembership,
        candidateMembershipMetadata: candidateMembershipMetadata,
        researchProfile: researchProfile,
        decisionContext: decisionContext,
        decisionIntake: decisionIntake,
        decisionReviewHistory: decisionReviewHistory,
        pinganSnapshot: pinganSnapshot,
        localRecordState: localRecordState,
        isLoading: isLoading,
        failClosedStates: failClosedStates
    )

    return AssistMobileWorkspaceRenderModel(
        selectedCandidate: selectedCandidate,
        selectedCandidateDecisionBridge: selectedCandidateDecisionBridge,
        selectedCandidateDecisionContextBridge: selectedCandidateDecisionContextBridge,
        selectedCandidateAdvisoryScopeBridge: selectedCandidateAdvisoryScopeBridge,
        selectedCandidateHumanReviewBridge: selectedCandidateHumanReviewBridge,
        selectedCandidateFollowUpBridge: selectedCandidateFollowUpBridge,
        selectedCandidateDecisionNoteBridge: selectedCandidateDecisionNoteBridge,
        dailyUseStatus: dailyUseStatus,
        currentCandidateSummary: assistMobileWorkspaceCandidateSummary(selectedMembership),
        conciseResearchSummary: assistMobileWorkspaceConciseResearchSummary(researchProfile),
        conciseDecisionContextSummary: assistMobileWorkspaceConciseDecisionContextSummary(decisionContext, fallback: decisionContextMessage),
        localDraftStatus: localDraftStatus,
        evidenceGapStatus: evidenceGapStatus,
        availabilityStatus: availabilityStatus,
        safetyShortCopy: "Local-only. Production NO_GO. No broker, order, trade, portfolio mutation, or official decision record.",
        dailyUseAuthorityBadges: dailyUseAuthorityBadges,
        dailyUseFactMetadataLedger: dailyUseFactMetadataLedger,
        dailyUseReadinessChecklist: dailyUseReadinessChecklist,
        dailyUseQuickActions: dailyUseQuickActions,
        dailyUseReviewPathRail: dailyUseReviewPathRail,
        dailyUseRole: "iOS is the ASSIST-1 daily-use mobile frontend: open the selected candidate, read the local factual path, draft local-only notes, and decide what to inspect next.",
        currentFocus: currentFocus,
        nextLocalAction: nextLocalAction,
        productSplitBoundary: "Product split: Web is the capability console for local integration and verification; iOS is the daily-use frontend. The reviewed read-only candidate release is complete and full production remains NO_GO.",
        localBetaAcceptanceStatus: "ASSIST-1 full local beta and the reviewed read-only candidate release are complete; CORE-1B-LIVE-CURRENT-SOURCE remains blocked.",
        dailyReviewPath: dailyReviewPath,
        researchEvidenceClarity: researchEvidenceClarity,
        fixtureDemoBoundary: fixtureDemoBoundary,
        decisionNoteFollowUpStatus: decisionNoteFollowUpStatus,
        portfolioAuthorityBoundary: portfolioAuthorityBoundary,
        portfolioAuthorityStateMatrix: portfolioAuthorityStateMatrix,
        reliabilityStatus: "Local validation uses source tests, contract tests, mainline health dry-run, Gate B DTO smoke, Gate B iOS UI smoke, and targeted iOS Simulator tests. Released head f78ef83fbfc0096444d9996ec06c2b51efda5755 has verified exact-head runtime and recovery evidence; physical-device install/launch passed, but the owner-waived DTX failure left authentication, journey, and screenshots NOT_PROVEN.",
        fullGoalAcceptanceMatrix: fullGoalAcceptanceMatrix,
        fullSystemDevelopmentMatrix: fullSystemDevelopmentMatrix,
        releaseBlockerDashboard: releaseBlockerDashboard,
        coreAssistLoopClosureCheckpoint: coreAssistLoopClosureCheckpoint,
        failureStateUnificationMatrix: failureStateUnificationMatrix,
        failureStatePolicy: failureStatePolicy,
        unifiedFailureStateSummary: unifiedFailureStateSummary,
        unifiedFailureStateMetadataPolicy: unifiedFailureStateMetadataPolicy,
        localRecordStatus: localRecordState.status,
        localRecordSourceSignature: localRecordState.sourceSignature,
        localRecordSummary: localRecordState.summary,
        localRecordSafety: localRecordState.safety,
        localRecordCanSave: localRecordState.canSave,
        candidateMembershipState: membershipState,
        researchProfileSummary: profileSummary,
        decisionContextSummary: decisionContextSummary,
        decisionIntakeSummary: "\(decisionIntake.title)：\(decisionIntake.message)",
        advisoryScopeSummary: "\(advisoryScope.title)：\(advisoryScope.message)",
        humanReviewWorkspaceSummary: "\(humanReviewWorkspace.title)：\(humanReviewWorkspace.message)",
        followUpWorkflowSummary: "\(followUpWorkflow.title)：\(followUpWorkflow.message)",
        decisionNoteSummary: "\(decisionNoteWorkflow.title)：\(decisionNoteWorkflow.message)",
        factReferences: decisionNoteWorkflow.factReferences,
        unresolvedEvidenceGaps: unresolvedGaps,
        pinganHistoricalOnlyBoundary: pinganBoundary,
        portfolioOmittedBoundary: "Portfolio context is omitted from ASSIST-1 mobile workspace; it is not a live holding, broker account, allocation, sizing, order, trade, cash, fee, position, or mutation source.",
        blockedExternalActions: combinedBlockedExternalActions,
        localOnlyDraftExplanation: drafts.isEmpty
            ? "Local drafts are empty. Follow-up and decision-note drafts are SwiftUI state only, separate from saved local records and official review history, not an official review record, not persisted, and not sent."
            : "Local drafts exist only in SwiftUI memory. They are separate from saved local records and official review history, not an official review record, not persisted, and not sent.",
        safetyBoundary: "ASSIST-1 mobile workspace is repository-local factual review assistance only. It does not recommend, rank, score, buy, sell, hold, time, set target price, stop loss, take profit, expected return, size, allocate, create orders, execute trades, call brokers, mutate portfolio, or claim production readiness; production NO_GO remains.",
        preDeviceBetaReadiness: "Historical checkpoint ASSIST-1-PRE-DEVICE-LOCAL-BETA-RC completed before device evidence; current status is the completed reviewed read-only candidate release with full production NO_GO.",
        productionNoGo: "Production remains NO_GO. The completed read-only candidate release does not authorize new staging, broker, real-account, VPS, SSH, external-DB, deployment, or write actions.",
        deviceTestPending: "Physical-device install/launch passed; the owner-waived XCTest DTX bootstrap failure did not prove authentication, the candidate-to-review journey, or screenshots.",
        failClosedExplanation: failClosed,
        loadingState: isLoading ? .loading : .idle,
        emptyState: .empty,
        unauthorizedState: .unauthorized,
        notFoundState: .notFound,
        unavailableState: .unavailable,
        malformedState: .malformed,
        offlineState: .offline,
        supersededState: .superseded
    )
}

public func assistMobileWorkspaceFailClosedModel(message: String) -> AssistMobileWorkspaceRenderModel {
    AssistMobileWorkspaceRenderModel(
        selectedCandidate: "未选择研究自选成员。",
        selectedCandidateDecisionBridge: "Fail-closed: selected-candidate decision bridge is unavailable; no stale membership or decision-intake facts are reused.",
        selectedCandidateDecisionContextBridge: "Fail-closed: selected-candidate decision-context bridge is unavailable; no stale context, quote freshness, research evidence, or portfolio authority is reused.",
        selectedCandidateAdvisoryScopeBridge: "Fail-closed: selected-candidate advisory bridge is unavailable; no stale advisory facts, recommendation semantics, or portfolio authority are reused.",
        selectedCandidateHumanReviewBridge: "Fail-closed: selected-candidate human-review bridge is unavailable; no stale workspace facts, official review, or local follow-up authority is reused.",
        selectedCandidateFollowUpBridge: "Fail-closed: selected-candidate follow-up bridge is unavailable; no stale workflow facts or local drafts are reused.",
        selectedCandidateDecisionNoteBridge: "Fail-closed: selected-candidate decision-note bridge is unavailable; no stale workflow facts, local drafts, or local records are reused.",
        dailyUseStatus: "Fail-closed: daily-use workspace is stopped and exposes no stale facts or stale drafts.",
        currentCandidateSummary: "No selected candidate is shown while fail-closed.",
        conciseResearchSummary: "Research summary unavailable; stale evidence is not reused.",
        conciseDecisionContextSummary: "Decision context unavailable; stale context is not reused.",
        localDraftStatus: "No local draft is usable; local-draft-empty, separate from saved local records and official review history, not official, not persisted, and not sent.",
        evidenceGapStatus: "No unresolved-gap list is exposed while fail-closed.",
        availabilityStatus: "Daily states: fail-closed / no-selected-candidate / unavailable / local-draft-empty / no-unresolved-gap / production-no-go / physical-device-owner-waived-dtx-failure.",
        safetyShortCopy: "Local-only fail-closed state. Production NO_GO. No broker, order, trade, portfolio mutation, or official decision record.",
        dailyUseAuthorityBadges: [
            "blocked:membership-source: no current candidate_memberships authority is displayed.",
            "blocked:quote-source: no quote freshness is displayed; stale quote facts are not reused.",
            "blocked:research-source: no research evidence is displayed; stale evidence is not reused.",
            "blocked:portfolio-authority: portfolio context is omitted and no stale position fact is reused.",
            "blocked:pingan-historical: Pingan historical-only context is unavailable and not reused.",
            "blocked:local-record-authority: UserDefaults records are hidden and cannot become official review or portfolio facts.",
            "blocked:safety-authority: production NO_GO, physical-device OWNER_WAIVED_NONBLOCKING_FAILURE with authentication/journey/screenshots NOT_PROVEN, no broker, no order, no trade, no portfolio mutation."
        ],
        dailyUseFactMetadataLedger: assistMobileWorkspaceDailyUseFactMetadataLedger(
            selectedMembership: nil,
            candidateMembershipMetadata: nil,
            researchProfile: nil,
            decisionContext: nil,
            decisionIntake: candidateDecisionIntakeFailClosedModel(
                state: "unavailable",
                message: "Fail-closed workspace has no current decision-intake metadata.",
                membershipId: nil
            ),
            decisionReviewHistory: nil,
            pinganSnapshot: nil,
            localRecordState: AssistMobileWorkspaceLocalRecordState(
                status: "fail-closed",
                sourceSignature: "unavailable",
                storageScope: "ios_user_defaults",
                summary: [],
                safety: [],
                canSave: false
            ),
            isLoading: false,
            failClosedStates: ["unavailable"]
        ),
        dailyUseReadinessChecklist: [
            "blocked:selected-candidate: no selected candidate; stale candidate facts are hidden.",
            "blocked:factual-context: quote freshness, research evidence, decision context, and portfolio authority are unavailable.",
            "blocked:human-review: human-review workspace is unavailable and no stale official review is shown.",
            "blocked:follow-up-note: follow-up and decision-note workflows are stopped; local drafts are cleared.",
            "blocked:local-record: source-scoped UserDefaults records are hidden and cannot save.",
            "blocked:safety: production NO_GO, physical-device OWNER_WAIVED_NONBLOCKING_FAILURE with authentication/journey/screenshots NOT_PROVEN, no broker, no order, no trade, no portfolio mutation."
        ],
        dailyUseQuickActions: [
            "blocked:open-context: no selected candidate or current decision context is available.",
            "blocked:open-human-review: human-review workspace is unavailable while fail-closed.",
            "blocked:open-follow-up-note: follow-up and decision-note workflows are stopped.",
            "blocked:save-local-record: UserDefaults save is disabled without a current source signature.",
            "blocked:clear-local-record: only current-source display clearing is available after source recovery."
        ],
        dailyUseReviewPathRail: [
            "blocked:1-selected-candidate: no current candidate focus is available.",
            "blocked:2-context: quote freshness, research evidence, and portfolio-omitted context are unavailable.",
            "blocked:3-human-review: human-review workspace is fail-closed and no stale review facts are shown.",
            "blocked:4-follow-up-note: follow-up and decision-note drafts are cleared.",
            "blocked:5-local-record: source-scoped UserDefaults records are hidden.",
            "blocked:6-safety: production NO_GO, physical-device OWNER_WAIVED_NONBLOCKING_FAILURE with authentication/journey/screenshots NOT_PROVEN, no broker, no order, no trade, no portfolio mutation."
        ],
        dailyUseRole: "iOS daily-use frontend is unavailable while the workspace is fail-closed.",
        currentFocus: "No current candidate focus is displayed in fail-closed state.",
        nextLocalAction: "Stop local review until repository-local facts can be read again.",
        productSplitBoundary: "Product split remains Web capability console plus iOS daily-use frontend; fail-closed loads expose no stale facts, while the global read-only release and owner-waived device evidence remain accurately disclosed.",
        localBetaAcceptanceStatus: "Full local beta is blocked while this workspace is fail-closed.",
        dailyReviewPath: "Daily review path is stopped until local facts reload safely.",
        researchEvidenceClarity: "Research evidence is unavailable and no stale evidence is reused.",
        fixtureDemoBoundary: "No fixture, sample, historical-only, or omitted state is converted into live account truth.",
        decisionNoteFollowUpStatus: "Decision-note and follow-up drafts are cleared and unusable while fail-closed.",
        portfolioAuthorityBoundary: "Pingan and portfolio authority remain unavailable or omitted; no stale position facts are reused.",
        portfolioAuthorityStateMatrix: assistMobileWorkspacePortfolioAuthorityStateMatrix(
            decisionContext: nil,
            pinganSnapshot: nil,
            isLoading: false,
            failClosedStates: ["unavailable"]
        ),
        reliabilityStatus: "Fail-closed data state exposes no stale facts or drafts. Global status remains: reviewed read-only candidate release complete, production NO_GO, and physical-device owner-waived DTX failure with authentication/journey/screenshots NOT_PROVEN.",
        fullGoalAcceptanceMatrix: assistMobileWorkspaceFullGoalAcceptanceMatrix(prefix: "Fail-closed preserved"),
        fullSystemDevelopmentMatrix: assistMobileWorkspaceFullSystemDevelopmentMatrix(prefix: "Fail-closed preserved"),
        releaseBlockerDashboard: assistMobileWorkspaceReleaseBlockerDashboard(prefix: "Fail-closed preserved"),
        coreAssistLoopClosureCheckpoint: assistMobileWorkspaceCoreAssistLoopClosureCheckpoint(prefix: "Fail-closed preserved"),
        failureStateUnificationMatrix: assistMobileWorkspaceFailureStateUnificationMatrix(prefix: "Fail-closed preserved"),
        failureStatePolicy: assistMobileWorkspaceFailureStatePolicy(prefix: "Fail-closed preserved"),
        unifiedFailureStateSummary: [
            "Fail-closed preserved: decisionIntake=unavailable -> unavailable",
            "Fail-closed preserved: decisionContext=unavailable -> unavailable",
            "Fail-closed preserved: advisoryScope=unavailable -> unavailable",
            "Fail-closed preserved: humanReviewWorkspace=unavailable -> unavailable",
            "Fail-closed preserved: followUpWorkflow=unavailable -> unavailable",
            "Fail-closed preserved: decisionNoteWorkflow=unavailable -> unavailable"
        ],
        unifiedFailureStateMetadataPolicy: [
            "Fail-closed preserved: decisionIntake=unavailable -> sourceMetadata=absent; staleFactsDraftsRecords=cleared",
            "Fail-closed preserved: decisionContext=unavailable -> sourceMetadata=absent; staleFactsDraftsRecords=cleared",
            "Fail-closed preserved: advisoryScope=unavailable -> sourceMetadata=absent; staleFactsDraftsRecords=cleared",
            "Fail-closed preserved: humanReviewWorkspace=unavailable -> sourceMetadata=absent; staleFactsDraftsRecords=cleared",
            "Fail-closed preserved: followUpWorkflow=unavailable -> sourceMetadata=absent; staleFactsDraftsRecords=cleared",
            "Fail-closed preserved: decisionNoteWorkflow=unavailable -> sourceMetadata=absent; staleFactsDraftsRecords=cleared"
        ],
        localRecordStatus: "Fail-closed: local records are hidden, source-scoped records are not loaded, and stale saved thoughts are not reused.",
        localRecordSourceSignature: "unavailable",
        localRecordSummary: [],
        localRecordSafety: assistMobileWorkspaceLocalRecordSafety(prefix: "Fail-closed preserved"),
        localRecordCanSave: false,
        candidateMembershipState: "idle",
        researchProfileSummary: "fail_closed",
        decisionContextSummary: "fail_closed",
        decisionIntakeSummary: message,
        advisoryScopeSummary: message,
        humanReviewWorkspaceSummary: message,
        followUpWorkflowSummary: message,
        decisionNoteSummary: message,
        factReferences: [],
        unresolvedEvidenceGaps: [],
        pinganHistoricalOnlyBoundary: "Pingan historical-only context is unavailable and not reused.",
        portfolioOmittedBoundary: "Portfolio context is omitted and no stale portfolio fact is reused.",
        blockedExternalActions: [],
        localOnlyDraftExplanation: "Local drafts are cleared; separate from saved local records and official review history, not official, not persisted, and not sent.",
        safetyBoundary: "Fail-closed state exposes no recommendation, trading, broker, portfolio, or production behavior.",
        preDeviceBetaReadiness: "Historical ASSIST-1-PRE-DEVICE-LOCAL-BETA-RC status does not override this fail-closed data state; the reviewed read-only candidate release remains complete and production remains NO_GO.",
        productionNoGo: "Production remains NO_GO.",
        deviceTestPending: "Physical-device install/launch passed; the owner-waived XCTest DTX bootstrap failure did not prove authentication, the candidate-to-review journey, or screenshots.",
        failClosedExplanation: [message, "No stale facts, partial facts, usable references, or local drafts are displayed."],
        loadingState: .idle,
        emptyState: .empty,
        unauthorizedState: .unauthorized,
        notFoundState: .notFound,
        unavailableState: .unavailable,
        malformedState: .malformed,
        offlineState: .offline,
        supersededState: .superseded
    )
}

public func assistMobileWorkspaceIsFailClosedState(_ state: String) -> Bool {
    [
        "unauthorized",
        "not_found",
        "conflict",
        "unavailable",
        "malformed",
        "offline",
        "superseded"
    ].contains(state)
}

private func assistMobileWorkspaceHasOmittedPortfolioAuthority(_ decisionContext: DecisionContextEnvelope?) -> Bool {
    guard let decisionContext else { return false }
    return decisionContext.portfolio.status == "omitted"
        && decisionContext.provenance.portfolio == "omitted"
}

public func assistMobileWorkspaceFullGoalAcceptanceMatrix(prefix: String = "Ready") -> [String] {
    [
        "1. \(prefix): governance and boundary baseline records local validation complete, deferred GitHub submission READY_NOT_STARTED, production NO_GO, physical-device OWNER_WAIVED_NONBLOCKING_FAILURE with journey NOT_PROVEN, no Stage Runner, and no GitHub Issue mutation.",
        "2. \(prefix): candidate membership lifecycle covers tracked, paused, archived, restored, duplicate, stale-version, unauthorized, unavailable, malformed, missing research, and missing quote states.",
        "3. \(prefix): selected candidate workspace shows selected candidate, current focus, next local action, and no-selected-candidate fallback without ranking or priority semantics.",
        "4. \(prefix): research profile and evidence show evidence count, source freshness, missing/stale/unavailable states, and refusal to infer missing facts.",
        "5. \(prefix): decision context and intake show quote status, research status, portfolio omitted or non-authoritative status, and read-only decision preparation.",
        "6. \(prefix): advisory scope states allowed local factual assistance and blocks recommendation, ranking, scoring, trading, broker, and portfolio mutation semantics.",
        "7. \(prefix): human-review workspace exposes local review facts, unresolved gaps, safety boundaries, and fail-closed states.",
        "8. \(prefix): follow-up workflow keeps manual note draft intent, later-review marker, unresolved evidence gaps, local next views, and blocked external actions local-only.",
        "9. \(prefix): decision-note workflow and local-record workflow keep local rationale, source-scoped saved thoughts, and note draft fields local-only and unofficial; drafts are not persisted, records are client-local only, and nothing is sent.",
        "10. \(prefix): Web capability console exposes integration, state, fixture, admin, and verification selectors for the complete local beta path.",
        "11. \(prefix): iOS daily-use frontend exposes concise selected-candidate daily review fields and accessibility identifiers without physical-device requirements.",
        "12. \(prefix): reliability, audit, and final review are complete; one deferred GitHub submission is ready but not started, with source-boundary checks and generated-artifact exclusion preserved."
    ]
}

public func assistMobileWorkspaceFullSystemDevelopmentMatrix(prefix: String = "Repository-local complete") -> [String] {
    [
        "\(prefix): 拓扑 0 已完成: local beta user acceptance is ACCEPT_LOCAL_BETA; Web/iOS 本地 beta 可审查，非本地 release blockers 仍可见。",
        "\(prefix): 拓扑 1 已完成: iOS daily use supports selected candidate, evidence reading, local thoughts, and follow-up review; Web 仍是 capability console。",
        "\(prefix): 拓扑 2 已完成: candidate overview / membership -> research evidence -> decision context -> decision-intake -> advisory scope -> human-review workspace -> local record -> review history -> follow-up。",
        "\(prefix): 拓扑 3 已完成: local records can save, load, and clear source-scoped research/decision thoughts as local unofficial browser/iOS records only，不上传 API，不写数据库，不是 official review。",
        "\(prefix): 拓扑 4 已完成: data-source authority keeps historical snapshots, fixtures, missing data, and stale facts out of current holdings; Pingan 只能 historical / last-imported，portfolio 可 omitted。",
        "\(prefix): 拓扑 5 已完成: research evidence shows facts, gaps, conflicts, and sources without buy or sell guidance; QUANT-1D 只作为 quant_evidence 进入 decision context。",
        "\(prefix): 拓扑 6 受限: portfolio-impact explanation is limited to risk and impact; no management, sizing, allocation, or trading；没有 approved authoritative live portfolio source 前不做 live risk impact。",
        "\(prefix): 拓扑 7 已完成: Web and iOS share candidate, evidence, and state meanings while presenting different product forms; failure states 不伪装成 success。",
        "\(prefix): 拓扑 8 已完成: local reliability uses fixed validation commands to prove mainline and safety boundaries; mainline health 默认 dry-run。",
        "\(prefix): 拓扑 9 已完成: reviewed read-only candidate release 已完成；full production readiness 继续 NO_GO。",
        "\(prefix): 拓扑 10 已完成当前边界: released head f78ef83fbfc0096444d9996ec06c2b51efda5755 的 exact-head runtime、GET-only smoke、SQLSTATE 25006 denial、backup、restore、rollback 和 private ingress 已验证且无 official-fact mutation。",
        "\(prefix): 拓扑 11 owner-waived failure: physical-device install/launch 通过，但 XCTest DTX bootstrap failure 未证明 authentication、candidate-to-review journey 或 screenshots。",
        "\(prefix): 拓扑 12 阻塞: production preparation is evaluability-only and needs separate authorization, review, and PR; production_status=NO_GO。",
        "\(prefix): 拓扑 13 未来授权: broker and real-account preparation can start only as future read-only scope; first phase is read-only only; broker_write=NOT_USED。",
        "\(prefix): 拓扑 14 已完成当前阶段: low-frequency quant can become research evidence only, never trade instruction, ranking, score, allocation, sizing, target price, buy/sell/hold, order, trade, cash, fee, or position authority。",
        "\(prefix): 拓扑 15 已完成: long-term review and knowledge base stores immutable source-scoped Web/iOS local learning with review-ID-only references, historical boundaries, and no official or trading authority; full local validation/final review 已完成，deferred GitHub submission READY_NOT_STARTED，下一外部边界是 CORE-1B-LIVE-CURRENT-SOURCE。",
        "\(prefix): 冻结范围: legacy access, CodexPro watcher, Stage Runner watcher, .ai-bridge, MCP, Cloudflare, automatic Stage discovery, automatic merge, real trading, broker write, and production DB write remain out of scope; no successful physical-device journey is claimed."
    ]
}

public func assistMobileWorkspaceReleaseBlockerDashboard(prefix: String = "Status") -> [String] {
    [
        "\(prefix): read-only candidate release is COMPLETED for reviewed head f78ef83fbfc0096444d9996ec06c2b51efda5755; production remains NO_GO.",
        "\(prefix): GET-only smoke, SQLSTATE 25006 write denial, backup, isolated restore, rollback, private ingress, and correlation IDs are verified without official-fact mutation.",
        "\(prefix): broker and real account access are not authorized; any future first phase must be read-only only.",
        "\(prefix): authoritative live portfolio source is not approved; Pingan remains historical-only and portfolio context can be omitted.",
        "\(prefix): physical-device install/launch passed, but the owner-waived XCTest DTX bootstrap failure did not prove authentication, journey, or screenshots.",
        "\(prefix): certificate hostname validation remains a known mismatch; insecure release smoke is not certificate-validation evidence."
    ]
}

public func assistMobileWorkspaceCoreAssistLoopClosureCheckpoint(prefix: String = "Completed") -> [String] {
    [
        "\(prefix): CORE-ASSIST-LOOP-E2E-CLOSURE-1 path is selected candidate -> research context -> decision context -> decision intake -> advisory scope -> human-review workspace -> local record -> post-decision review -> follow-up.",
        "\(prefix): CORE-ASSIST-LOCAL-RECORDS-DRAFTS-HARDENING-1 closed Web localStorage and iOS UserDefaults local records and drafts hardening after failure-state unification.",
        "\(prefix): reviewed read-only candidate release and full local validation/final review are complete; deferred GitHub submission is READY_NOT_STARTED and CORE-1B-LIVE-CURRENT-SOURCE remains blocked.",
        "\(prefix): quote freshness, research evidence, portfolio omitted, and Pingan historical-only metadata remain visible before local review; missing, stale, conflict, malformed, offline, unauthorized, unavailable, source-mismatch, and no-selected-candidate states stay fail-closed.",
        "\(prefix): local records are source-scoped iOS UserDefaults or browser localStorage only; source-signature mismatch, malformed records, unsafe saved envelopes, or unavailable source facts hide saved thoughts.",
        "\(prefix): human review remains idempotent, review history remains append-only, post-decision review and follow-up stay local factual support, and old records without snapshot authority are disclosed or hidden instead of fabricated.",
        "\(prefix): safety boundary keeps production_status=NO_GO, real_trading=NOT_USED, broker_write=NOT_USED, official_portfolio_mutation=NOT_USED, ios_physical_device=OWNER_WAIVED_NONBLOCKING_FAILURE with authentication/journey/screenshots NOT_PROVEN, frozen automation untouched, and no recommendation, ranking, scoring, buy/sell/hold, target, timing, sizing, allocation, order, trade, fill, cash, fee, or position mutation."
    ]
}

public func assistMobileWorkspaceFailureStateUnificationMatrix(prefix: String = "Unified") -> [String] {
    [
        "\(prefix): loading means current facts are pending; stale success facts, local drafts, local records, and busy/request state stay hidden until the current source settles.",
        "\(prefix): empty means an authenticated source returned no items; it is not unauthorized, not unavailable, and not reused as stale success.",
        "\(prefix): stale means source metadata is visible as stale or historical-only; stale quote, research, Pingan, or portfolio facts are never displayed as fresh.",
        "\(prefix): unavailable means the source cannot provide a valid envelope; source metadata for facts is absent and stale facts, drafts, and records are cleared.",
        "\(prefix): unauthorized means authorization failed and must never be rendered as an empty success list.",
        "\(prefix): conflict means the source reported incompatible identity, version, or state; the reason stays visible and old success facts are not reused.",
        "\(prefix): offline means only local-only capability remains visible; no network success, broker authority, or official record is implied.",
        "\(prefix): malformed means symbol, route, payload, or response shape failed validation; client fallback submission is blocked.",
        "\(prefix): fixture-unavailable means repository-local fixture/demo data is absent or invalid; it is labelled as fixture and never promoted to real facts.",
        "\(prefix): source-mismatch means selected candidate, membership, workflow, quote, research, or source signature differs; source-scoped local records stay hidden."
    ]
}

public func assistMobileWorkspaceFailureStatePolicy(prefix: String = "Policy") -> [String] {
    [
        "\(prefix): loading hides facts, local drafts, local records, and busy/request residue; source metadata waits for the current response.",
        "\(prefix): empty shows only authenticated empty-source metadata; local records stay hidden unless a current source signature is available.",
        "\(prefix): stale shows source/as-of/fetched metadata with stale or historical-only wording; fresh interpretation and current-risk authority stay blocked.",
        "\(prefix): unavailable clears stale facts, drafts, records, and source-scoped actions; metadata is not synthesized.",
        "\(prefix): unauthorized shows authorization failure, clears stale success, and never replaces the failure with an empty list.",
        "\(prefix): conflict shows the conflicting identity, version, or state reason; older success facts are not reused.",
        "\(prefix): offline exposes local-only capability boundaries and hides network success, official records, broker authority, and fresh facts.",
        "\(prefix): malformed blocks client fallback submission, hides stale success, and keeps validation failure visible.",
        "\(prefix): fixture-unavailable discloses fixture/demo absence, keeps it non-real, and does not promote sample facts.",
        "\(prefix): source-mismatch hides facts and source-scoped local records until selected candidate, membership, workflow, quote, research, and source signature match."
    ]
}

public func assistMobileWorkspaceUnifiedFailureStateSummary(
    isLoading: Bool,
    decisionIntakeState: String,
    decisionContextState: String,
    advisoryScopeState: String,
    humanReviewWorkspaceState: String,
    followUpWorkflowState: String,
    decisionNoteWorkflowState: String
) -> [String] {
    let lanes = [
        ("decisionIntake", decisionIntakeState),
        ("decisionContext", decisionContextState),
        ("advisoryScope", advisoryScopeState),
        ("humanReviewWorkspace", humanReviewWorkspaceState),
        ("followUpWorkflow", followUpWorkflowState),
        ("decisionNoteWorkflow", decisionNoteWorkflowState)
    ]
    var summary = isLoading ? ["workspace=loading -> loading"] : []
    summary.append(contentsOf: lanes.compactMap { lane, state in
        guard let unified = assistMobileWorkspaceUnifiedFailureState(for: state) else {
            return nil
        }
        return "\(lane)=\(state) -> \(unified.rawValue)"
    })
    if summary.isEmpty {
        return ["no-active-unified-failure-state: current lane states have no canonical failure promotion."]
    }
    return summary
}

public func assistMobileWorkspaceUnifiedFailureStateMetadataPolicySummary(
    isLoading: Bool,
    decisionIntakeState: String,
    decisionContextState: String,
    advisoryScopeState: String,
    humanReviewWorkspaceState: String,
    followUpWorkflowState: String,
    decisionNoteWorkflowState: String
) -> [String] {
    let lanes = [
        ("decisionIntake", decisionIntakeState),
        ("decisionContext", decisionContextState),
        ("advisoryScope", advisoryScopeState),
        ("humanReviewWorkspace", humanReviewWorkspaceState),
        ("followUpWorkflow", followUpWorkflowState),
        ("decisionNoteWorkflow", decisionNoteWorkflowState)
    ]
    var summary = isLoading
        ? ["workspace=loading -> sourceMetadata=pending; facts/localDrafts/localRecords=hidden"]
        : []
    for (lane, state) in lanes {
        summary.append(assistMobileWorkspaceUnifiedFailureStateMetadataPolicyLine(lane: lane, state: state))
    }
    return summary
}

private func assistMobileWorkspaceUnifiedFailureStateMetadataPolicyLine(lane: String, state: String) -> String {
    let prefix = "\(lane)=\(state)"
    guard let unified = assistMobileWorkspaceUnifiedFailureState(for: state) else {
        return "\(prefix) -> sourceMetadata=current-facts-visible; localRecords=require-current-source-signature"
    }
    switch unified {
    case .loading:
        return "\(prefix) -> sourceMetadata=pending; facts/localDrafts/localRecords=hidden"
    case .empty:
        return "\(prefix) -> sourceMetadata=authenticated-empty-visible; staleSuccess=blocked; localRecords=guarded"
    case .stale:
        return "\(prefix) -> sourceMetadata=stale-or-historical-visible; freshFacts=blocked; localRecords=hidden-unless-current-signature"
    case .unavailable:
        return "\(prefix) -> sourceMetadata=absent; staleFactsDraftsRecords=cleared"
    case .unauthorized:
        return "\(prefix) -> sourceMetadata=absent; emptySuccess=blocked; localRecords=hidden"
    case .conflict:
        return "\(prefix) -> sourceMetadata=conflict-reason-visible; staleSuccess=blocked; localRecords=hidden"
    case .offline:
        return "\(prefix) -> sourceMetadata=absent; local-only-boundary-visible; networkSuccessOfficialBroker=hidden"
    case .malformed:
        return "\(prefix) -> sourceMetadata=absent; validationFailure=visible; clientFallbackSubmission=blocked"
    case .fixtureUnavailable:
        return "\(prefix) -> sourceMetadata=fixture-absence-visible; realFacts=blocked; samplePromotion=blocked"
    case .sourceMismatch:
        return "\(prefix) -> sourceMetadata=source-mismatch-reason-visible; staleSuccess=blocked; localRecords=hidden"
    }
}

public func assistMobileWorkspaceDecisionContextUnifiedState(
    decisionContext: DecisionContextEnvelope?,
    decisionContextMessage: String?,
    isLoading: Bool
) -> String {
    if isLoading {
        return "loading"
    }
    guard let decisionContext else {
        return assistMobileWorkspaceFailureStateFromMessage(decisionContextMessage) ?? "context_unloaded"
    }
    if decisionContext.portfolio.status != "omitted" || decisionContext.provenance.portfolio != "omitted" {
        return "source_mismatch"
    }
    switch decisionContext.quote.status {
    case "fresh":
        break
    case "stale":
        return "stale_quote"
    case "unavailable":
        return "quote_unavailable"
    case "empty":
        return "empty"
    case "permission_denied":
        return "permission_denied"
    default:
        return "malformed"
    }
    switch decisionContext.research.status {
    case "available":
        return "available"
    case "no_evidence":
        return "no_evidence"
    case "stale_evidence":
        return "stale_evidence"
    case "unavailable":
        return "research_unavailable"
    case "unauthorized":
        return "research_unauthorized"
    default:
        return "malformed"
    }
}

private func assistMobileWorkspaceFailureStateFromMessage(_ message: String?) -> String? {
    guard let message else {
        return nil
    }
    let normalized = message.lowercased().replacingOccurrences(of: "_", with: "-")
    if normalized.contains("permission denied") || normalized.contains("permission-denied") || normalized.contains("unauthorized") {
        return "unauthorized"
    }
    if normalized.contains("conflict") || normalized.contains("version") {
        return "conflict"
    }
    if normalized.contains("offline") || normalized.contains("network") {
        return "offline"
    }
    if normalized.contains("malformed") || normalized.contains("invalid") || normalized.contains("decode") {
        return "malformed"
    }
    if normalized.contains("stale") {
        return "stale_quote"
    }
    if normalized.contains("mismatch") {
        return "source_mismatch"
    }
    if normalized.contains("unavailable") || normalized.contains("missing") {
        return "unavailable"
    }
    return nil
}

public func assistMobileWorkspaceLocalRecordState(
    selectedMembership: CandidateMembershipData?,
    decisionContext: DecisionContextEnvelope?,
    followUpWorkflow: AssistReviewFollowUpWorkflowRenderModel,
    decisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel,
    drafts: AssistMobileWorkspaceLocalRecordDrafts,
    snapshotSummary: [String] = [],
    failClosedStates: [String]
) -> AssistMobileWorkspaceLocalRecordState {
    guard let selectedMembership else {
        return AssistMobileWorkspaceLocalRecordState(
            status: "No selected candidate / no-selected-candidate; local records are hidden and no saved thought is loaded.",
            sourceSignature: "unavailable",
            storageScope: "ios_user_defaults_local_only",
            summary: [],
            safety: assistMobileWorkspaceLocalRecordSafety(),
            canSave: false
        )
    }
    if !failClosedStates.isEmpty || assistMobileWorkspaceIsFailClosedState(decisionNoteWorkflow.state) {
        return AssistMobileWorkspaceLocalRecordState(
            status: "Fail-closed: \(failClosedStates.joined(separator: ", ")) hides local records; stale saved thoughts are not reused.",
            sourceSignature: "unavailable",
            storageScope: "ios_user_defaults_local_only",
            summary: [],
            safety: assistMobileWorkspaceLocalRecordSafety(),
            canSave: false
        )
    }
    let sourceSignature = assistMobileWorkspaceLocalRecordSourceSignature(
        selectedMembership: selectedMembership,
        decisionContext: decisionContext,
        followUpWorkflow: followUpWorkflow,
        decisionNoteWorkflow: decisionNoteWorkflow
    )
    guard sourceSignature != "unavailable" else {
        return AssistMobileWorkspaceLocalRecordState(
            status: "Local record source is unavailable; load current decision-note workflow before saving.",
            sourceSignature: sourceSignature,
            storageScope: "ios_user_defaults_local_only",
            summary: [],
            safety: assistMobileWorkspaceLocalRecordSafety(),
            canSave: false
        )
    }
    let summary = [
        drafts.researchThought.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Research thought is empty." : "Research thought exists in local record draft.",
        drafts.decisionThought.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Decision thought is empty." : "Decision thought exists in local record draft.",
        drafts.evidenceGapNote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Evidence-gap note is empty." : "Evidence-gap note exists in local record draft.",
        drafts.laterReviewNote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Later-review note is empty." : "Later-review note exists in local record draft."
    ] + snapshotSummary + [
        "Save writes a validated iOS UserDefaults envelope under the current source signature, including the selected membership version; not uploaded to any API, not written to any database, not official review, not server persisted, not sent, and not broker synced."
    ]
    return AssistMobileWorkspaceLocalRecordState(
        status: drafts.isEmpty
            ? "Local record is empty; user can save repository-local thoughts to this device only."
            : "Local record draft exists on this screen and can be saved to this device only.",
        sourceSignature: sourceSignature,
        storageScope: "ios_user_defaults_local_only",
        summary: summary,
        safety: assistMobileWorkspaceLocalRecordSafety(),
        canSave: true
    )
}

public func assistMobileWorkspaceLocalRecordSourceSignature(
    selectedMembership: CandidateMembershipData,
    decisionContext: DecisionContextEnvelope?,
    followUpWorkflow: AssistReviewFollowUpWorkflowRenderModel,
    decisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel
) -> String {
    if let decisionContext, decisionContext.requestedSymbol != selectedMembership.symbol {
        return "unavailable"
    }
    guard followUpWorkflow.state == "available" || followUpWorkflow.state == "blocked" else {
        return "unavailable"
    }
    guard decisionNoteWorkflow.state == "available" || decisionNoteWorkflow.state == "blocked" else {
        return "unavailable"
    }
    guard followUpWorkflow.membershipId == selectedMembership.id,
          decisionNoteWorkflow.membershipId == selectedMembership.id,
          followUpWorkflow.symbol == selectedMembership.symbol,
          decisionNoteWorkflow.symbol == selectedMembership.symbol else {
        return "unavailable"
    }
    return [
        selectedMembership.id,
        "membership-version-\(selectedMembership.version)",
        selectedMembership.symbol,
        decisionContext?.contextId ?? "no-decision-context",
        decisionContext?.contextHash ?? "no-context-hash",
        followUpWorkflow.generatedAt ?? "no-follow-up-generated-at",
        decisionNoteWorkflow.generatedAt ?? "no-decision-note-generated-at",
        followUpWorkflow.state,
        decisionNoteWorkflow.state
    ].joined(separator: "|")
}

private func assistMobileWorkspaceLocalRecordIdentity(
    from sourceSignature: String
) -> (membershipId: String, symbol: String, code: String)? {
    let parts = sourceSignature.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
    guard parts.count == 9,
          parts[0].isEmpty == false,
          parts[1].range(of: #"^membership-version-[1-9]\d*$"#, options: .regularExpression) != nil,
          parts[2].range(of: #"^HK\.\d{5}$"#, options: .regularExpression) != nil else {
        return nil
    }
    return (membershipId: parts[0], symbol: parts[2], code: String(parts[2].dropFirst(3)))
}

public func assistMobileWorkspaceLocalRecordSafety(prefix: String = "Local record safety") -> [String] {
    [
        "\(prefix): validated local-only, unofficial, source-scoped iOS UserDefaults envelope storage only; not API uploaded and not database written.",
        "\(prefix): source signature binds selected membership version, decision context, follow-up workflow, and decision-note workflow before saved thoughts can load.",
    ] + assistMobileWorkspaceLocalRecordLifecycleSemantics().map {
        "\(prefix) lifecycle \($0.key): Web=\($0.webState); iOS=\($0.iosState); \($0.display)"
    } + [
        "\(prefix): not an official review record, not a trading decision, not server persisted, not sent, not broker synced, not a portfolio fact, and not a production fact.",
        "\(prefix): clear requires confirmation and removes only the current source-signature UserDefaults envelope; API facts and official review history are untouched.",
        "\(prefix): fail-closed, no-selected-candidate, source-change, source-mismatch, conflict, stale, unavailable, malformed, offline, unauthorized, not-found, or superseded states hide local records and do not restore stale saved thoughts.",
        "\(prefix): no recommendation, ranking, scoring, buy/sell/hold instruction, price objective, loss-limit, profit-objective, return forecast, timing, sizing, allocation, order, trade, fill, cash, fee, position, broker call, portfolio mutation, production claim, or real-account behavior."
    ]
}

public func assistMobileWorkspaceSelectedCandidateDecisionBridge(
    selectedMembership: CandidateMembershipData?,
    decisionIntake: CandidateDecisionIntakeRenderModel,
    isLoading: Bool
) -> String {
    guard let selectedMembership else {
        return "No selected candidate: decision-intake bridge is hidden until a candidate membership is opened."
    }
    if isLoading || decisionIntake.state == "loading" {
        return "Loading bridge for \(selectedMembership.symbol); stale decision-intake facts stay hidden until current membership facts settle."
    }
    guard let intakeMembershipId = decisionIntake.membershipId,
          let intakeSymbol = decisionIntake.symbol else {
        return "Decision-intake bridge is not loaded for \(selectedMembership.symbol); no previous decision-intake facts are reused."
    }
    guard intakeMembershipId == selectedMembership.id,
          intakeSymbol == selectedMembership.symbol else {
        return "Fail-closed bridge mismatch: selected \(selectedMembership.symbol)/\(selectedMembership.id) differs from decision-intake \(intakeSymbol)/\(intakeMembershipId); stale facts are not reused."
    }
    let quoteTime = selectedMembership.quote.fetchedAt ?? selectedMembership.quote.staleReason ?? "unavailable"
    let researchTime = selectedMembership.research.profileUpdatedAt ?? "missing"
    let sourceFacts = "membership=\(selectedMembership.id) version=\(selectedMembership.version); state=\(selectedMembership.state.rawValue); research=\(selectedMembership.research.status.rawValue) \(researchTime); quote=\(selectedMembership.quote.status.rawValue) \(quoteTime); portfolio=\(selectedMembership.provenance.portfolio)"
    if assistMobileWorkspaceIsFailClosedState(decisionIntake.state) {
        return "Fail-closed bridge for \(selectedMembership.symbol): decisionIntake=\(decisionIntake.state); \(sourceFacts); no stale facts, local records, portfolio mutation, or broker action."
    }
    if decisionIntake.state == "ready" {
        return "Ready bridge for \(selectedMembership.symbol): exact membership and symbol match; \(sourceFacts); read-only decision preparation only."
    }
    return "Limited bridge for \(selectedMembership.symbol): decisionIntake=\(decisionIntake.state); exact membership and symbol match; \(sourceFacts); not treated as fresh ready context."
}

public func assistMobileWorkspaceSelectedCandidateDecisionContextBridge(
    selectedMembership: CandidateMembershipData?,
    decisionContext: DecisionContextEnvelope?,
    decisionContextMessage: String?,
    isLoading: Bool
) -> String {
    guard let selectedMembership else {
        return "No selected candidate: decision-context bridge is hidden until a candidate membership is opened."
    }
    if isLoading {
        return "Loading decision-context bridge for \(selectedMembership.symbol); stale context, quote freshness, research evidence, and portfolio boundary facts stay hidden until current sources settle."
    }
    guard let decisionContext else {
        let fallback = decisionContextMessage ?? "Decision context is not loaded."
        return "Decision-context bridge is not loaded for \(selectedMembership.symbol): \(fallback); no previous context facts are reused."
    }
    if decisionContext.requestedSymbol != selectedMembership.symbol {
        return "Fail-closed decision-context bridge mismatch: selected \(selectedMembership.symbol)/\(selectedMembership.id) differs from context \(decisionContext.requestedSymbol); stale context facts are not trusted."
    }
    if let quoteSymbol = decisionContext.quote.data?.symbol,
       quoteSymbol != selectedMembership.symbol {
        return "Fail-closed decision-context bridge mismatch: selected \(selectedMembership.symbol)/\(selectedMembership.id) differs from quote \(quoteSymbol); stale quote facts are not trusted."
    }
    if let researchSymbol = decisionContext.research.profile?.symbol,
       researchSymbol != selectedMembership.symbol {
        return "Fail-closed decision-context bridge mismatch: selected \(selectedMembership.symbol)/\(selectedMembership.id) differs from research \(researchSymbol); stale research facts are not trusted."
    }
    let quoteTime = decisionContext.quote.fetchedAt ?? decisionContext.quote.staleReason ?? "unavailable"
    let researchTime = decisionContext.research.evidenceAsOf ?? decisionContext.research.staleReason ?? "unavailable"
    let sourceFacts = "context=\(decisionContext.contextId) hash=\(decisionContext.contextHash); quote=\(decisionContext.quote.status) \(quoteTime); research=\(decisionContext.research.status) evidence=\(decisionContext.research.evidence.count) \(researchTime); portfolio=\(decisionContext.portfolio.status) provenance=\(decisionContext.provenance.portfolio)"
    if decisionContext.portfolio.status != "omitted" || decisionContext.provenance.portfolio != "omitted" {
        return "Fail-closed decision-context bridge for \(selectedMembership.symbol): exact selected symbol match; \(sourceFacts); portfolio authority is not omitted and cannot be reused."
    }
    if decisionContext.quote.status == "fresh" && decisionContext.research.status == "available" {
        return "Ready decision-context bridge for \(selectedMembership.symbol): exact selected symbol match; \(sourceFacts); factual context only."
    }
    return "Limited decision-context bridge for \(selectedMembership.symbol): exact selected symbol match; \(sourceFacts); not treated as fresh ready context."
}

public func assistMobileWorkspaceSelectedCandidateAdvisoryScopeBridge(
    selectedMembership: CandidateMembershipData?,
    advisoryScope: AssistAdvisoryScopeRenderModel,
    isLoading: Bool
) -> String {
    guard let selectedMembership else {
        return "No selected candidate: advisory-scope bridge is hidden until a candidate membership is opened."
    }
    if isLoading || advisoryScope.state == "loading" {
        return "Loading advisory bridge for \(selectedMembership.symbol); stale advisory facts stay hidden until current membership facts settle."
    }
    if let scopeMembershipId = advisoryScope.membershipId,
       scopeMembershipId != selectedMembership.id {
        return "Fail-closed advisory bridge mismatch: selected \(selectedMembership.symbol)/\(selectedMembership.id) differs from scope \(advisoryScope.symbol ?? "unloaded")/\(scopeMembershipId); stale advisory facts are not trusted."
    }
    if let scopeSymbol = advisoryScope.symbol,
       scopeSymbol != selectedMembership.symbol {
        return "Fail-closed advisory bridge mismatch: selected \(selectedMembership.symbol)/\(selectedMembership.id) differs from scope \(scopeSymbol)/\(advisoryScope.membershipId ?? "unloaded"); stale advisory facts are not trusted."
    }
    let scopeFacts = "scope=\(advisoryScope.state); facts=\(advisoryScope.facts.count); limitations=\(advisoryScope.limitations.count); continuations=\(advisoryScope.continuations.count)"
    let sourceFacts = "membership=\(selectedMembership.id) version=\(selectedMembership.version); state=\(selectedMembership.state.rawValue); portfolio=\(selectedMembership.provenance.portfolio)"
    if assistMobileWorkspaceIsFailClosedState(advisoryScope.state) {
        return "Fail-closed advisory bridge for \(selectedMembership.symbol): \(scopeFacts); \(sourceFacts); no stale advisory facts, recommendations, local records, portfolio mutation, or broker action."
    }
    guard let scopeMembershipId = advisoryScope.membershipId,
          let scopeSymbol = advisoryScope.symbol else {
        return "Advisory-scope bridge is not loaded for \(selectedMembership.symbol); no previous advisory facts are reused."
    }
    guard scopeMembershipId == selectedMembership.id,
          scopeSymbol == selectedMembership.symbol else {
        return "Fail-closed advisory bridge mismatch: selected \(selectedMembership.symbol)/\(selectedMembership.id) differs from scope \(scopeSymbol)/\(scopeMembershipId); stale advisory facts are not trusted."
    }
    if advisoryScope.state == "available" {
        return "Ready advisory bridge for \(selectedMembership.symbol): exact membership and symbol match; \(scopeFacts); \(sourceFacts); advisory-only factual scope."
    }
    return "Limited advisory bridge for \(selectedMembership.symbol): exact membership and symbol match; \(scopeFacts); \(sourceFacts); not treated as fresh ready advice."
}

public func assistMobileWorkspaceSelectedCandidateHumanReviewBridge(
    selectedMembership: CandidateMembershipData?,
    humanReviewWorkspace: AssistHumanReviewWorkspaceRenderModel,
    isLoading: Bool
) -> String {
    guard let selectedMembership else {
        return "No selected candidate: human-review workspace bridge is hidden until a candidate membership is opened."
    }
    if isLoading || humanReviewWorkspace.state == "loading" {
        return "Loading human-review bridge for \(selectedMembership.symbol); stale workspace facts and local follow-up drafts stay hidden until current membership facts settle."
    }
    if let workspaceMembershipId = humanReviewWorkspace.membershipId,
       workspaceMembershipId != selectedMembership.id {
        return "Fail-closed human-review bridge mismatch: selected \(selectedMembership.symbol)/\(selectedMembership.id) differs from workspace \(humanReviewWorkspace.symbol ?? "unloaded")/\(workspaceMembershipId); stale workspace facts are not trusted."
    }
    if let workspaceSymbol = humanReviewWorkspace.symbol,
       workspaceSymbol != selectedMembership.symbol {
        return "Fail-closed human-review bridge mismatch: selected \(selectedMembership.symbol)/\(selectedMembership.id) differs from workspace \(workspaceSymbol)/\(humanReviewWorkspace.membershipId ?? "unloaded"); stale workspace facts are not trusted."
    }
    let workspaceFacts = "workspace=\(humanReviewWorkspace.state); readiness=\(humanReviewWorkspace.readiness.count); evidenceGroups=\(humanReviewWorkspace.evidenceGroups.count); followUp=\(humanReviewWorkspace.followUp.count)"
    let sourceFacts = "membership=\(selectedMembership.id) version=\(selectedMembership.version); state=\(selectedMembership.state.rawValue); portfolio=\(selectedMembership.provenance.portfolio)"
    if assistMobileWorkspaceIsFailClosedState(humanReviewWorkspace.state) {
        return "Fail-closed human-review bridge for \(selectedMembership.symbol): \(workspaceFacts); \(sourceFacts); no stale workspace facts, official review facts, local records, portfolio mutation, or broker action."
    }
    guard let workspaceMembershipId = humanReviewWorkspace.membershipId,
          let workspaceSymbol = humanReviewWorkspace.symbol else {
        return "Human-review workspace bridge is not loaded for \(selectedMembership.symbol); no previous workspace facts or local follow-up drafts are reused."
    }
    guard workspaceMembershipId == selectedMembership.id,
          workspaceSymbol == selectedMembership.symbol else {
        return "Fail-closed human-review bridge mismatch: selected \(selectedMembership.symbol)/\(selectedMembership.id) differs from workspace \(workspaceSymbol)/\(workspaceMembershipId); stale workspace facts are not trusted."
    }
    if humanReviewWorkspace.state == "ready" {
        return "Ready human-review bridge for \(selectedMembership.symbol): exact membership and symbol match; \(workspaceFacts); \(sourceFacts); manual-review-only workspace."
    }
    if humanReviewWorkspace.state == "blocked" {
        return "Blocked human-review bridge for \(selectedMembership.symbol): exact membership and symbol match; \(workspaceFacts); \(sourceFacts); blocked workspace is visible but not treated as completed review."
    }
    return "Limited human-review bridge for \(selectedMembership.symbol): exact membership and symbol match; \(workspaceFacts); \(sourceFacts); not treated as completed review."
}

public func assistMobileWorkspaceSelectedCandidateFollowUpBridge(
    selectedMembership: CandidateMembershipData?,
    followUpWorkflow: AssistReviewFollowUpWorkflowRenderModel,
    isLoading: Bool
) -> String {
    guard let selectedMembership else {
        return "No selected candidate: follow-up workflow bridge is hidden until a candidate membership is opened."
    }
    if isLoading || followUpWorkflow.state == "loading" {
        return "Loading follow-up bridge for \(selectedMembership.symbol); stale workflow facts and local drafts stay hidden until current membership facts settle."
    }
    if let workflowMembershipId = followUpWorkflow.membershipId,
       workflowMembershipId != selectedMembership.id {
        return "Fail-closed follow-up bridge mismatch: selected \(selectedMembership.symbol)/\(selectedMembership.id) differs from workflow \(followUpWorkflow.symbol ?? "unloaded")/\(workflowMembershipId); stale local drafts are not trusted."
    }
    if let workflowSymbol = followUpWorkflow.symbol,
       workflowSymbol != selectedMembership.symbol {
        return "Fail-closed follow-up bridge mismatch: selected \(selectedMembership.symbol)/\(selectedMembership.id) differs from workflow \(workflowSymbol)/\(followUpWorkflow.membershipId ?? "unloaded"); stale local drafts are not trusted."
    }
    let workflowFacts = "workflow=\(followUpWorkflow.state); generated=\(followUpWorkflow.generatedAt ?? "not-generated"); reviewState=\(followUpWorkflow.reviewState ?? "not-loaded"); gaps=\(followUpWorkflow.evidenceGaps.count); localViews=\(followUpWorkflow.suggestedLocalViews.count)"
    let sourceFacts = "membership=\(selectedMembership.id) version=\(selectedMembership.version); state=\(selectedMembership.state.rawValue); portfolio=\(selectedMembership.provenance.portfolio)"
    if assistMobileWorkspaceIsFailClosedState(followUpWorkflow.state) {
        return "Fail-closed follow-up bridge for \(selectedMembership.symbol): \(workflowFacts); \(sourceFacts); no stale facts, local records, portfolio mutation, or broker action."
    }
    guard let workflowMembershipId = followUpWorkflow.membershipId,
          let workflowSymbol = followUpWorkflow.symbol else {
        return "Follow-up workflow bridge is not loaded for \(selectedMembership.symbol); no previous workflow facts or local drafts are reused."
    }
    guard workflowMembershipId == selectedMembership.id,
          workflowSymbol == selectedMembership.symbol else {
        return "Fail-closed follow-up bridge mismatch: selected \(selectedMembership.symbol)/\(selectedMembership.id) differs from workflow \(workflowSymbol)/\(workflowMembershipId); stale local drafts are not trusted."
    }
    if followUpWorkflow.state == "available" {
        return "Ready follow-up bridge for \(selectedMembership.symbol): exact membership and symbol match; \(workflowFacts); \(sourceFacts); local-only follow-up workflow."
    }
    if followUpWorkflow.state == "blocked" {
        return "Blocked follow-up bridge for \(selectedMembership.symbol): exact membership and symbol match; \(workflowFacts); \(sourceFacts); blocked workspace is visible but not treated as completion."
    }
    return "Limited follow-up bridge for \(selectedMembership.symbol): exact membership and symbol match; \(workflowFacts); \(sourceFacts); not treated as fresh ready workflow."
}

public func assistMobileWorkspaceSelectedCandidateDecisionNoteBridge(
    selectedMembership: CandidateMembershipData?,
    decisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel,
    isLoading: Bool
) -> String {
    guard let selectedMembership else {
        return "No selected candidate: decision-note workflow bridge is hidden until a candidate membership is opened."
    }
    if isLoading || decisionNoteWorkflow.state == "loading" {
        return "Loading decision-note bridge for \(selectedMembership.symbol); stale workflow facts, local decision-note drafts, and local records stay hidden until current membership facts settle."
    }
    if let workflowMembershipId = decisionNoteWorkflow.membershipId,
       workflowMembershipId != selectedMembership.id {
        return "Fail-closed decision-note bridge mismatch: selected \(selectedMembership.symbol)/\(selectedMembership.id) differs from workflow \(decisionNoteWorkflow.symbol ?? "unloaded")/\(workflowMembershipId); stale local drafts and local records are not trusted."
    }
    if let workflowSymbol = decisionNoteWorkflow.symbol,
       workflowSymbol != selectedMembership.symbol {
        return "Fail-closed decision-note bridge mismatch: selected \(selectedMembership.symbol)/\(selectedMembership.id) differs from workflow \(workflowSymbol)/\(decisionNoteWorkflow.membershipId ?? "unloaded"); stale local drafts and local records are not trusted."
    }
    let workflowFacts = "workflow=\(decisionNoteWorkflow.state); generated=\(decisionNoteWorkflow.generatedAt ?? "not-generated"); noteState=\(decisionNoteWorkflow.noteState ?? "not-loaded"); references=\(decisionNoteWorkflow.factReferences.count); gaps=\(decisionNoteWorkflow.unresolvedEvidenceGaps.count); laterReview=\(decisionNoteWorkflow.laterReviewEntry.count)"
    let sourceFacts = "membership=\(selectedMembership.id) version=\(selectedMembership.version); state=\(selectedMembership.state.rawValue); portfolio=\(selectedMembership.provenance.portfolio)"
    if assistMobileWorkspaceIsFailClosedState(decisionNoteWorkflow.state) {
        return "Fail-closed decision-note bridge for \(selectedMembership.symbol): \(workflowFacts); \(sourceFacts); no stale facts, local decision-note drafts, local records, portfolio mutation, or broker action."
    }
    guard let workflowMembershipId = decisionNoteWorkflow.membershipId,
          let workflowSymbol = decisionNoteWorkflow.symbol else {
        return "Decision-note workflow bridge is not loaded for \(selectedMembership.symbol); no previous workflow facts, local drafts, or local records are reused."
    }
    guard workflowMembershipId == selectedMembership.id,
          workflowSymbol == selectedMembership.symbol else {
        return "Fail-closed decision-note bridge mismatch: selected \(selectedMembership.symbol)/\(selectedMembership.id) differs from workflow \(workflowSymbol)/\(workflowMembershipId); stale local drafts and local records are not trusted."
    }
    if decisionNoteWorkflow.state == "available" {
        return "Ready decision-note bridge for \(selectedMembership.symbol): exact membership and symbol match; \(workflowFacts); \(sourceFacts); local-only decision-note workflow."
    }
    if decisionNoteWorkflow.state == "blocked" {
        return "Blocked decision-note bridge for \(selectedMembership.symbol): exact membership and symbol match; \(workflowFacts); \(sourceFacts); blocked follow-up is visible but not treated as completion."
    }
    return "Limited decision-note bridge for \(selectedMembership.symbol): exact membership and symbol match; \(workflowFacts); \(sourceFacts); not treated as fresh ready workflow."
}

private func assistMobileWorkspaceDailyUseStatus(
    selectedMembership: CandidateMembershipData?,
    isLoading: Bool,
    failClosedStates: [String]
) -> String {
    guard let selectedMembership else {
        return "No selected candidate: choose a tracked membership to start the daily local review path."
    }
    if isLoading {
        return "Loading local facts for \(selectedMembership.symbol); stale facts and stale drafts stay hidden until current reads settle."
    }
    if !failClosedStates.isEmpty {
        return "Fail-closed: \(failClosedStates.joined(separator: ", ")) blocks daily review; no stale facts or stale drafts are usable."
    }
    if selectedMembership.state != .tracked {
        return "Selected candidate is \(selectedMembership.state.rawValue); read-only local review remains available, but this is not an active tracked focus."
    }
    return "Ready for daily local review: selected candidate facts are available through repository-local lanes."
}

private func assistMobileWorkspaceCandidateSummary(_ membership: CandidateMembershipData?) -> String {
    guard let membership else {
        return "No selected candidate. Open a tracked candidate membership to build the mobile workspace."
    }
    let quoteTime = membership.quote.fetchedAt ?? membership.quote.staleReason ?? "unavailable"
    let researchTime = membership.research.profileUpdatedAt ?? "missing"
    return "\(membership.symbol) / state=\(membership.state.rawValue) / research=\(membership.research.status.rawValue) \(researchTime) / quote=\(membership.quote.status.rawValue) \(quoteTime)"
}

private func assistMobileWorkspaceConciseResearchSummary(_ envelope: ResearchProfileEnvelope?) -> String {
    guard let envelope else {
        return "Research summary idle; select a candidate to read repository-local evidence."
    }
    guard let payload = envelope.data else {
        return "Research summary unavailable: \(envelope.message)"
    }
    let pendingEvidenceUpdates = payload.suggestions.filter { $0.status == .pending }.count
    let nextReview = payload.profile.nextReviewOn ?? "unavailable"
    return "\(payload.profile.symbol): \(payload.profile.currentView). Evidence \(payload.evidence.count), pending evidence updates \(pendingEvidenceUpdates), next review \(nextReview)."
}

private func assistMobileWorkspaceConciseDecisionContextSummary(_ context: DecisionContextEnvelope?, fallback: String?) -> String {
    guard let context else {
        return fallback ?? "Decision context idle; no stale context is displayed."
    }
    return "Context \(context.contextId) / quote=\(context.quote.status) / research=\(context.research.status) / evidence=\(context.research.evidence.count) / quant=\(context.quantEvidence.status) / portfolio=\(context.portfolio.status)."
}

private func assistMobileWorkspaceLocalDraftStatus(_ drafts: AssistMobileWorkspaceLocalDraftState) -> String {
    if drafts.isEmpty {
        return "No local draft exists; follow-up and decision-note fields are SwiftUI-memory-only when used, separate from saved local records and official review history, not official, not persisted, and not sent."
    }
    let draftCount = [
        drafts.followUpManualNoteDraft,
        drafts.followUpLaterReviewDraft,
        drafts.followUpEvidenceGapChecklistDraft,
        drafts.decisionNoteDraft
    ].filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.count
    return "Local draft exists in \(draftCount) field(s), SwiftUI-memory-only and separate from saved local records and official review history; not official, not persisted, and not sent."
}

private func assistMobileWorkspaceMalformedLocalRecord(_ message: String) -> AssistMobileWorkspaceLocalRecordLoadResult {
    AssistMobileWorkspaceLocalRecordLoadResult(
        ok: false,
        state: .malformed,
        envelope: nil,
        fields: .empty,
        message: message
    )
}

private func assistMobileWorkspaceLocalRecordMissingSnapshotAuthority(_ errors: [String]) -> Bool {
    errors.contains { error in
        error.hasPrefix("sourceRef")
            || error.hasPrefix("target")
            || error.contains("sourceRef")
            || error.contains("target")
            || error.contains("sourceSignature")
            || error.contains("candidateMembershipId")
    }
}

private func assistMobileWorkspaceLocalRecordIsDateTime(_ value: String) -> Bool {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if fractional.date(from: value) != nil { return true }
    let standard = ISO8601DateFormatter()
    standard.formatOptions = [.withInternetDateTime]
    return standard.date(from: value) != nil
}

private let assistMobileWorkspaceLocalRecordForbiddenKeys: Set<String> = [
    "recommendation",
    "rank",
    "ranking",
    "score",
    "rating",
    "signal",
    "buy",
    "sell",
    "hold",
    "targetPrice",
    "stopLoss",
    "takeProfit",
    "expectedReturn",
    "timing",
    "sizing",
    "allocation",
    "rebalance",
    "order",
    "trade",
    "fill",
    "cash",
    "fee",
    "position",
    "broker",
    "portfolioMutation",
    "apiUpload",
    "apiSync",
    "databaseWrite",
    "databasePersisted",
    "officialReview",
    "officialReviewRecord",
    "officialPortfolioFact",
    "serverPersistence",
    "productionReady",
    "liveHoldings",
    "brokerTruth",
    "accountAuthority"
]

private let assistMobileWorkspaceLocalRecordAllowedKeys: [String: Set<String>] = [
    "localRecord": [
        "schemaVersion",
        "recordId",
        "createdAt",
        "updatedAt",
        "storageScope",
        "target",
        "sourceRef",
        "metadata",
        "fields",
        "safety",
        "message"
    ],
    "localRecord.target": [
        "market",
        "code",
        "symbol",
        "candidateMembershipId"
    ],
    "localRecord.sourceRef": [
        "sourceSignature",
        "decisionContextId",
        "decisionContextHash",
        "followUpWorkflowGeneratedAt",
        "decisionNoteWorkflowGeneratedAt"
    ],
    "localRecord.metadata": [
        "source",
        "asOf",
        "fetchedAt",
        "freshness",
        "provenance",
        "authority",
        "stale",
        "missing",
        "conflict",
        "fixture",
        "correctionOf",
        "replaces",
        "message"
    ],
    "localRecord.fields": [
        "researchThought",
        "decisionThought",
        "evidenceGapNote",
        "laterReviewNote"
    ],
    "localRecord.safety": [
        "localOnly",
        "unofficial",
        "officialRecord",
        "serverPersisted",
        "sent",
        "brokerSynced",
        "portfolioFact",
        "productionFact",
        "noRecommendation",
        "noRanking",
        "noScoring",
        "noBuySellHold",
        "noTrading",
        "noBroker",
        "noPortfolioMutation"
    ]
]

private let assistMobileWorkspaceLocalRecordRequiredKeys: [String: Set<String>] = [
    "localRecord": [
        "schemaVersion", "recordId", "createdAt", "updatedAt", "storageScope",
        "target", "sourceRef", "metadata", "fields", "safety", "message"
    ],
    "localRecord.target": ["market", "code", "symbol", "candidateMembershipId"],
    "localRecord.sourceRef": ["sourceSignature"],
    "localRecord.metadata": [
        "source", "asOf", "freshness", "provenance", "authority",
        "stale", "missing", "conflict", "fixture", "message"
    ],
    "localRecord.fields": ["researchThought", "decisionThought", "evidenceGapNote", "laterReviewNote"],
    "localRecord.safety": [
        "localOnly", "unofficial", "officialRecord", "serverPersisted", "sent",
        "brokerSynced", "portfolioFact", "productionFact", "noRecommendation",
        "noRanking", "noScoring", "noBuySellHold", "noTrading", "noBroker",
        "noPortfolioMutation"
    ]
]

private func validateAssistMobileWorkspaceLocalRecordJSONShape(_ value: Any, path: String, errors: inout [String]) {
    if let object = value as? [String: Any] {
        if let allowed = assistMobileWorkspaceLocalRecordAllowedKeys[path] {
            for key in object.keys where !allowed.contains(key) {
                errors.append("\(path).\(key) is not allowed")
            }
            for key in assistMobileWorkspaceLocalRecordRequiredKeys[path] ?? [] where object[key] == nil {
                errors.append("\(path).\(key) is required")
            }
        }
        for (key, child) in object {
            if assistMobileWorkspaceLocalRecordForbiddenKeys.contains(key) {
                errors.append("\(path).\(key) is forbidden in local records")
            }
            validateAssistMobileWorkspaceLocalRecordJSONShape(child, path: "\(path).\(key)", errors: &errors)
        }
        return
    }
    if let items = value as? [Any] {
        for (index, child) in items.enumerated() {
            validateAssistMobileWorkspaceLocalRecordJSONShape(child, path: "\(path)[\(index)]", errors: &errors)
        }
    }
}

private func assistMobileWorkspaceEvidenceGapStatus(_ gaps: [String]) -> String {
    guard let firstGap = gaps.first else {
        return "No unresolved-gap item is exposed by follow-up or decision-note workflow."
    }
    return "Unresolved-gap count \(gaps.count): next local review starts with \(firstGap)"
}

private func assistMobileWorkspaceDailyUseAuthorityBadges(
    selectedMembership: CandidateMembershipData?,
    researchProfile: ResearchProfileEnvelope?,
    decisionContext: DecisionContextEnvelope?,
    pinganSnapshot: PinganSnapshotEnvelope?,
    localRecordState: AssistMobileWorkspaceLocalRecordState,
    isLoading: Bool,
    failClosedStates: [String]
) -> [String] {
    if isLoading {
        return [
            "loading:membership-source: candidate membership authority is pending; stale candidate facts are hidden.",
            "loading:quote-source: quote freshness is pending; old quote facts are not shown as fresh.",
            "loading:research-source: research evidence source is pending; old evidence is not shown as current.",
            "loading:portfolio-authority: portfolio authority remains omitted until current context is validated.",
            "loading:pingan-historical: Pingan historical-only metadata is pending and cannot imply live holdings.",
            "loading:local-record-authority: UserDefaults records stay hidden until current source signature is stable.",
            "blocked:safety-authority: production NO_GO, physical-device OWNER_WAIVED_NONBLOCKING_FAILURE with authentication/journey/screenshots NOT_PROVEN, no broker, no order, no trade, no portfolio mutation."
        ]
    }

    guard let selectedMembership else {
        return [
            "blocked:membership-source: no selected candidate membership authority.",
            "blocked:quote-source: no selected candidate means no trusted quote freshness.",
            "blocked:research-source: no selected candidate means no trusted research evidence.",
            "blocked:portfolio-authority: portfolio context is omitted and cannot imply live holdings.",
            "blocked:pingan-historical: Pingan snapshot is not attached to a selected candidate and remains historical-only.",
            "blocked:local-record-authority: UserDefaults records stay hidden without current source signature.",
            "blocked:safety-authority: production NO_GO, physical-device OWNER_WAIVED_NONBLOCKING_FAILURE with authentication/journey/screenshots NOT_PROVEN, no broker, no order, no trade, no portfolio mutation."
        ]
    }

    let failClosedSummary = failClosedStates.isEmpty ? "none" : failClosedStates.joined(separator: ",")
    let membershipBadge = failClosedStates.isEmpty
        ? "ready:membership-source: candidate_memberships \(selectedMembership.symbol) state=\(selectedMembership.state.rawValue) version=\(selectedMembership.version); source is current local read model."
        : "blocked:membership-source: \(selectedMembership.symbol) has fail-closed downstream states \(failClosedSummary); stale membership-linked facts are hidden."

    let quoteStatus = decisionContext?.quote.status ?? selectedMembership.quote.status.rawValue
    let quoteSource = decisionContext?.quote.source ?? selectedMembership.quote.source ?? "unavailable"
    let quoteFetchedAt = decisionContext?.quote.fetchedAt ?? selectedMembership.quote.fetchedAt ?? "unavailable"
    let quoteBadge = quoteStatus == "fresh" && failClosedStates.isEmpty
        ? "ready:quote-source: status=\(quoteStatus) source=\(quoteSource) fetchedAt=\(quoteFetchedAt); freshness is displayed as quote metadata only."
        : "blocked:quote-source: status=\(quoteStatus) source=\(quoteSource) fetchedAt=\(quoteFetchedAt); stale or unavailable quote is not treated as fresh."

    let researchStatus = decisionContext?.research.status ?? selectedMembership.research.status.rawValue
    let researchAsOf = decisionContext?.research.evidenceAsOf ?? researchProfile?.asOf ?? selectedMembership.research.profileUpdatedAt ?? "unavailable"
    let evidenceCount = decisionContext?.research.evidence.count ?? researchProfile?.data?.evidence.count ?? 0
    let researchBadge = researchStatus == "available" && failClosedStates.isEmpty
        ? "ready:research-source: status=\(researchStatus) asOf=\(researchAsOf) evidence=\(evidenceCount); research evidence is context only, not advice."
        : "blocked:research-source: status=\(researchStatus) asOf=\(researchAsOf) evidence=\(evidenceCount); missing or stale evidence is not fabricated."

    let portfolioStatus = decisionContext?.portfolio.status ?? "omitted"
    let portfolioReason = decisionContext?.portfolio.reason ?? "authoritative_portfolio_source_not_approved"
    let portfolioProvenance = decisionContext?.provenance.portfolio ?? selectedMembership.provenance.portfolio
    let portfolioBadge = portfolioStatus == "omitted" && portfolioProvenance == "omitted"
        ? "blocked:portfolio-authority: status=omitted reason=\(portfolioReason) provenance=omitted; no live holdings, risk-impact authority, broker reconciliation, account truth, accounting authority, execution input, allocation, sizing, or mutation authority."
        : "blocked:portfolio-authority: status=\(portfolioStatus) provenance=\(portfolioProvenance); non-omitted portfolio authority is fail-closed."

    let pinganBadge: String
    if let pinganSnapshot {
        pinganBadge = "blocked:pingan-historical: status=\(pinganSnapshot.status.rawValue) source=\(pinganSnapshot.sourceSystem ?? "unavailable") asOf=\(pinganSnapshot.sourceAsOf ?? "unavailable") importedAt=\(pinganSnapshot.importedAt ?? "unavailable") fetchedAt=\(pinganSnapshot.fetchedAt ?? "unavailable") freshness=\(pinganSnapshot.freshness?.rawValue ?? "unavailable"); historical-only, not live broker truth, not risk-impact authority, brokerReconciliation=\(pinganSnapshot.dataUse.brokerReconciliation), accountTruth=\(pinganSnapshot.dataUse.accountTruth), accounting=\(pinganSnapshot.dataUse.accounting), execution=\(pinganSnapshot.dataUse.execution)."
    } else {
        pinganBadge = "blocked:pingan-historical: omitted; no Pingan snapshot is displayed as live holdings or current broker truth."
    }

    let localRecordBadge = localRecordState.canSave
        ? "ready:local-record-authority: current-source UserDefaults signature is present; local record is unofficial, no API upload, no database write, not official review, not portfolio fact."
        : "blocked:local-record-authority: \(localRecordState.status); saved thoughts stay hidden and cannot become official review or portfolio facts."

    return [
        membershipBadge,
        quoteBadge,
        researchBadge,
        portfolioBadge,
        pinganBadge,
        localRecordBadge,
        "blocked:safety-authority: production NO_GO, physical-device OWNER_WAIVED_NONBLOCKING_FAILURE with authentication/journey/screenshots NOT_PROVEN, no recommendation, no order, no trade, no fill, no cash, no fee, no position, no portfolio mutation."
    ]
}

private func assistMobileWorkspaceDailyUseFactMetadataLedger(
    selectedMembership: CandidateMembershipData?,
    candidateMembershipMetadata: FactMetadata?,
    researchProfile: ResearchProfileEnvelope?,
    decisionContext: DecisionContextEnvelope?,
    decisionIntake: CandidateDecisionIntakeRenderModel,
    decisionReviewHistory: DecisionReviewHistoryEnvelope?,
    pinganSnapshot: PinganSnapshotEnvelope?,
    localRecordState: AssistMobileWorkspaceLocalRecordState,
    isLoading: Bool,
    failClosedStates: [String]
) -> [String] {
    assistMobileWorkspaceCandidateAndIntakeMetadata(
        selectedMembership: selectedMembership,
        metadata: candidateMembershipMetadata,
        decisionIntake: decisionIntake,
        isLoading: isLoading,
        failClosedStates: failClosedStates
    ) + assistMobileWorkspaceQuoteResearchContextMetadata(
        selectedMembership: selectedMembership,
        researchProfile: researchProfile,
        decisionContext: decisionContext,
        isLoading: isLoading,
        failClosedStates: failClosedStates
    ) + assistMobileWorkspacePortfolioReviewMetadata(
        selectedMembership: selectedMembership,
        decisionContext: decisionContext,
        decisionReviewHistory: decisionReviewHistory,
        pinganSnapshot: pinganSnapshot,
        isLoading: isLoading
    ) + assistMobileWorkspaceLocalQuantReleaseMetadata(
        decisionContext: decisionContext,
        localRecordState: localRecordState,
        isLoading: isLoading
    )
}

@inline(never)
private func assistMobileWorkspaceCandidateAndIntakeMetadata(
    selectedMembership: CandidateMembershipData?,
    metadata: FactMetadata?,
    decisionIntake: CandidateDecisionIntakeRenderModel,
    isLoading: Bool,
    failClosedStates: [String]
) -> [String] {
    let symbol = selectedMembership?.symbol ?? "missing:not-selected"
    let failClosed = failClosedStates.isEmpty ? "none" : failClosedStates.joined(separator: ",")
    let candidateState = isLoading ? "loading:current-candidate-membership" : selectedMembership == nil ? "missing:no-selected-candidate" : failClosedStates.isEmpty ? "available" : "blocked:downstream-fail-closed"
    let candidateMissing = selectedMembership == nil || metadata?.missing == true
    let candidate = "candidate: source=\(metadata?.source ?? "candidate_memberships"); asOf=\(metadata?.asOf ?? selectedMembership?.updatedAt ?? "missing:not-selected"); fetchedAt=\(metadata?.fetchedAt ?? "missing:not-provided-by-contract"); freshness=\(metadata?.freshness ?? (selectedMembership == nil ? "missing:not-selected" : "missing:not-provided-by-contract")); provenance=\(metadata?.provenance ?? selectedMembership?.provenance.membership ?? "candidate_memberships"); authority=\(metadata?.authority ?? "candidate_membership"); lane=local; state=\(candidateState); flags=stale:\(metadata?.stale ?? false),missing:\(candidateMissing),conflict:\(metadata?.conflict == true),fixture:\(metadata?.fixture == true),loading:\(isLoading),failClosed=\(failClosed),symbol=\(symbol)."

    let intakeMetadata = decisionIntake.metadata
    let matches = decisionIntake.symbol != nil && selectedMembership != nil && decisionIntake.symbol == selectedMembership?.symbol && decisionIntake.membershipId == selectedMembership?.id
    let intakeState: String
    if isLoading || decisionIntake.state == "loading" { intakeState = "loading:current-decision-intake" }
    else if intakeMetadata == nil { intakeState = "missing:not-loaded" }
    else if selectedMembership == nil { intakeState = "blocked:no-selected-candidate" }
    else if !matches { intakeState = "blocked:source-mismatch" }
    else if assistMobileWorkspaceIsFailClosedState(decisionIntake.state) { intakeState = "blocked:\(decisionIntake.state)" }
    else { intakeState = decisionIntake.state }
    let intake = "decision-intake: source=\(intakeMetadata?.source ?? "missing:not-loaded"); asOf=\(intakeMetadata?.asOf ?? "missing:not-loaded"); fetchedAt=\(intakeMetadata?.fetchedAt ?? "missing:not-loaded"); freshness=\(intakeMetadata?.freshness ?? "missing:not-loaded"); provenance=\(intakeMetadata?.provenance ?? "missing:not-loaded"); authority=\(intakeMetadata?.authority ?? "decision_context"); lane=decision-preparation; state=\(intakeState); flags=stale:\(intakeMetadata?.stale ?? false),missing:\(intakeMetadata?.missing == true || intakeMetadata == nil),conflict:\(intakeMetadata?.conflict == true || (intakeMetadata != nil && !matches)),fixture:\(intakeMetadata?.fixture ?? false),loading:\(isLoading),symbol=\(decisionIntake.symbol ?? "missing:not-loaded")."
    return [candidate, intake]
}

@inline(never)
private func assistMobileWorkspaceQuoteResearchContextMetadata(
    selectedMembership: CandidateMembershipData?,
    researchProfile: ResearchProfileEnvelope?,
    decisionContext: DecisionContextEnvelope?,
    isLoading: Bool,
    failClosedStates: [String]
) -> [String] {
    let quoteFreshness = decisionContext?.quote.status ?? selectedMembership?.quote.status.rawValue ?? "missing:not-loaded"
    let quote = "quote: source=\(decisionContext?.quote.source ?? selectedMembership?.quote.source ?? "missing:not-provided-by-contract"); asOf=\(decisionContext?.quote.data?.quoteTime ?? selectedMembership?.quote.fetchedAt ?? "missing:not-provided-by-contract"); fetchedAt=\(decisionContext?.quote.fetchedAt ?? selectedMembership?.quote.fetchedAt ?? "missing:not-provided-by-contract"); freshness=\(quoteFreshness); provenance=\(decisionContext?.provenance.quote ?? selectedMembership?.provenance.quotes ?? "persisted_market_quotes_optional"); authority=market_quote_context_only; lane=local-fact; state=\((quoteFreshness == "fresh" && failClosedStates.isEmpty && selectedMembership != nil) ? "available" : "blocked:not-fresh-or-not-loaded"); flags=stale:\(quoteFreshness != "fresh"),missing:\(selectedMembership == nil),conflict:false,loading:\(isLoading)."

    let researchSource = decisionContext?.provenance.research ?? selectedMembership?.provenance.research ?? "research_profiles_optional"
    let researchAsOf = decisionContext?.research.evidenceAsOf ?? researchProfile?.asOf ?? selectedMembership?.research.profileUpdatedAt ?? "missing:not-provided-by-contract"
    let researchFreshness = decisionContext?.research.status ?? selectedMembership?.research.status.rawValue ?? "missing:not-loaded"
    let research = "research: source=\(researchSource); asOf=\(researchAsOf); fetchedAt=\(researchProfile?.asOf ?? decisionContext?.research.evidenceAsOf ?? "missing:not-provided-by-contract"); freshness=\(researchFreshness); provenance=\(researchSource); authority=research_evidence_only; lane=research-only; state=\((researchFreshness == "available" && failClosedStates.isEmpty && selectedMembership != nil) ? "available" : "blocked:missing-or-stale-evidence"); flags=stale:\(researchFreshness != "available"),missing:\(researchAsOf.hasPrefix("missing")),conflict:false,loading:\(isLoading)."

    let contextFreshness = decisionContext == nil ? "missing:not-loaded" : (failClosedStates.isEmpty ? "source-scoped-current" : "blocked:downstream-fail-closed")
    let contextProvenance = decisionContext.map { "quote=\($0.provenance.quote),research=\($0.provenance.research),portfolio=\($0.provenance.portfolio)" } ?? "missing:not-loaded"
    let context = "decision-context: source=decision_context; asOf=\(decisionContext?.generatedAt ?? "missing:not-loaded"); fetchedAt=\(decisionContext?.generatedAt ?? "missing:not-provided-by-contract"); freshness=\(contextFreshness); provenance=\(contextProvenance); authority=decision_context_facts_only; lane=local; state=\(decisionContext == nil ? "missing:not-loaded" : failClosedStates.isEmpty ? "available" : "blocked:fail-closed"); flags=stale:\(!failClosedStates.isEmpty),missing:\(decisionContext == nil),conflict:false,loading:\(isLoading ? "loading" : "not-loading")."
    return [quote, research, context]
}

@inline(never)
private func assistMobileWorkspacePortfolioReviewMetadata(
    selectedMembership: CandidateMembershipData?,
    decisionContext: DecisionContextEnvelope?,
    decisionReviewHistory: DecisionReviewHistoryEnvelope?,
    pinganSnapshot: PinganSnapshotEnvelope?,
    isLoading: Bool
) -> [String] {
    let portfolioSource = decisionContext?.provenance.portfolio ?? "omitted"
    let portfolioFreshness = decisionContext?.portfolio.status ?? "omitted"
    let portfolio = "portfolio: source=\(portfolioSource); asOf=\(decisionContext?.generatedAt ?? "missing:not-loaded"); fetchedAt=\(decisionContext?.generatedAt ?? "missing:not-provided-by-contract"); freshness=\(portfolioFreshness); provenance=\(portfolioSource); authority=omitted-no-approved-live-portfolio-source; lane=portfolio-authority-separate; state=\(portfolioFreshness == "omitted" ? "blocked:omitted-no-approved-live-authority" : "blocked:non-omitted-fail-closed"); flags=stale:false,missing:false,conflict:false,loading:\(isLoading)."
    let pingan = "pingan-historical: source=\(pinganSnapshot?.sourceSystem ?? "missing:not-loaded"); asOf=\(pinganSnapshot?.sourceAsOf ?? "missing:not-loaded"); fetchedAt=\(pinganSnapshot?.fetchedAt ?? "missing:not-loaded"); freshness=\(pinganSnapshot?.freshness?.rawValue ?? "missing:not-loaded"); provenance=pingan_imported_snapshot; authority=historical_only_not_live_not_authoritative; lane=historical; state=\(pinganSnapshot == nil ? "missing:not-loaded" : "blocked:historical-only-not-authoritative"); flags=stale:true,missing:\(pinganSnapshot == nil),conflict:false,loading:\(isLoading)."

    let metadata = decisionReviewHistory?.metadata
    let matches = decisionReviewHistory != nil && selectedMembership != nil && decisionReviewHistory?.requestedSymbol == selectedMembership?.symbol
    let state: String
    if isLoading { state = "loading:current-review-history" }
    else if decisionReviewHistory == nil { state = "missing:not-loaded" }
    else if selectedMembership == nil { state = "blocked:no-selected-candidate" }
    else if !matches { state = "blocked:source-mismatch" }
    else if metadata?.freshness == "fresh" { state = "available:append-only-review-history" }
    else if metadata?.freshness == "missing" { state = "missing:no-recorded-checks" }
    else { state = "blocked:\(metadata?.freshness ?? "unavailable")" }
    let review = "review-history: source=\(metadata?.source ?? "missing:not-loaded"); asOf=\(metadata?.asOf ?? "missing:not-loaded"); fetchedAt=\(metadata?.fetchedAt ?? "missing:not-loaded"); freshness=\(metadata?.freshness ?? "missing:not-loaded"); provenance=\(metadata?.provenance ?? "missing:not-loaded"); authority=\(metadata?.authority ?? "decision-context-review-read-only"); lane=review; state=\(state); flags=stale:\(metadata?.stale ?? false),missing:\(decisionReviewHistory == nil || metadata?.missing == true),conflict:\(metadata?.conflict == true || (decisionReviewHistory != nil && !matches)),loading:\(isLoading),symbol=\(decisionReviewHistory?.requestedSymbol ?? "missing:not-loaded")."
    return [portfolio, pingan, review]
}

@inline(never)
private func assistMobileWorkspaceLocalQuantReleaseMetadata(
    decisionContext: DecisionContextEnvelope?,
    localRecordState: AssistMobileWorkspaceLocalRecordState,
    isLoading: Bool
) -> [String] {
    let local = "local-record: source=ios_user_defaults; asOf=\(localRecordState.canSave ? "current-source-signature-present" : "missing:not-available"); fetchedAt=local-device-only; freshness=\(localRecordState.canSave ? "source-scoped-current" : "missing-or-mismatch"); provenance=source_scoped_local_record; authority=unofficial_local_only_not_review_not_portfolio; lane=local-only; state=\(localRecordState.canSave ? "available:source-scoped-local-only" : "blocked:source-signature-unavailable-or-mismatch"); flags=stale:\(!localRecordState.canSave),missing:\(!localRecordState.canSave),conflict:false,loading:\(isLoading)."
    let quant = decisionContext?.quantEvidence
    let metadata = quant?.metadata
    let universe = quant?.sampleBoundary.universe.joined(separator: ",") ?? "missing:not-loaded"
    let noOfficialFacts = quant?.authority.officialPortfolioFact == false && quant?.authority.officialReviewFact == false
    let quantLine = "quant-evidence: source=\(metadata?.source ?? "missing:not-loaded"); asOf=\(metadata?.asOf ?? "missing:not-loaded"); fetchedAt=\(metadata?.fetchedAt ?? "missing:not-loaded"); freshness=\(metadata?.freshness ?? "missing:not-loaded"); provenance=\(metadata?.provenance ?? "quant_evidence"); authority=\(metadata?.authority ?? "quant_evidence"); lane=quant-evidence; state=\(quant == nil ? "missing:not-loaded" : quant?.status ?? "missing"); flags=stale:\(metadata?.stale ?? false),missing:\(metadata?.missing ?? true),conflict:\(metadata?.conflict ?? false),fixture:\(metadata?.fixture ?? false),loading:false; universe=\(universe); shadow=\(quant?.identities?.shadowPortfolioIdentity ?? "missing:not-available"); noOrdering=\(quant?.authority.changesCandidateOrdering == false); noReviewMutation=\(quant?.authority.changesHumanReviewResult == false); noOfficialFacts=\(noOfficialFacts); noBrokerWrite=\(quant?.authority.brokerWrite == false)."
    return [
        local,
        quantLine,
        "read-only-release: source=docs/audit/READONLY-RELEASE-1.md; asOf=reviewed-head:f78ef83fbfc0096444d9996ec06c2b51efda5755; fetchedAt=2026-07-14T01:05:40Z; freshness=verified:exact-head-read-only-candidate-release; provenance=content_addressed_release_evidence; authority=release_status_only_no_production_promotion; lane=read-only-release-production-boundary; state=completed:read-only-candidate-release:production-NO_GO; recovery=verified:backup-isolated-restore-rollback; dbDenial=verified:SQLSTATE-25006; flags=stale:false,missing:false,conflict:false,loading:false."
    ]
}

private func assistMobileWorkspaceDailyUseReadinessChecklist(
    selectedMembership: CandidateMembershipData?,
    researchProfile: ResearchProfileEnvelope?,
    decisionContext: DecisionContextEnvelope?,
    decisionIntake: CandidateDecisionIntakeRenderModel,
    humanReviewWorkspace: AssistHumanReviewWorkspaceRenderModel,
    followUpWorkflow: AssistReviewFollowUpWorkflowRenderModel,
    decisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel,
    pinganSnapshot: PinganSnapshotEnvelope?,
    localRecordState: AssistMobileWorkspaceLocalRecordState,
    isLoading: Bool,
    failClosedStates: [String]
) -> [String] {
    if isLoading {
        return [
            "loading:selected-candidate: current source facts are loading; stale candidate facts stay hidden.",
            "loading:factual-context: quote freshness, research evidence, decision context, and portfolio authority wait for current envelopes.",
            "loading:human-review: human-review workspace is pending and old review facts are not reused.",
            "loading:follow-up-note: follow-up and decision-note workflows wait for the current source.",
            "loading:local-record: source-scoped UserDefaults records stay hidden until current source signature is available.",
            "blocked:safety: production NO_GO, physical-device OWNER_WAIVED_NONBLOCKING_FAILURE with authentication/journey/screenshots NOT_PROVEN, no broker, no order, no trade, no portfolio mutation."
        ]
    }

    guard let selectedMembership else {
        return [
            "blocked:selected-candidate: no selected candidate; choose one tracked membership before the daily path.",
            "blocked:factual-context: quote freshness, research evidence, decision context, and portfolio omitted authority are absent.",
            "blocked:human-review: human-review workspace is unavailable without a selected candidate.",
            "blocked:follow-up-note: follow-up workflow and local decision note are stopped.",
            "blocked:local-record: UserDefaults local records are hidden because no current source signature exists.",
            "blocked:safety: production NO_GO, physical-device OWNER_WAIVED_NONBLOCKING_FAILURE with authentication/journey/screenshots NOT_PROVEN, no broker, no order, no trade, no portfolio mutation."
        ]
    }

    let blocking = failClosedStates.isEmpty ? "none" : failClosedStates.joined(separator: ",")
    let selectedState = failClosedStates.isEmpty
        ? "ready:selected-candidate: \(selectedMembership.symbol) membership=\(selectedMembership.state.rawValue) version=\(selectedMembership.version) is the current daily focus."
        : "blocked:selected-candidate: \(selectedMembership.symbol) has fail-closed downstream states \(blocking); stale candidate facts are not reused."

    let profileState = researchProfile?.data == nil ? "research-profile-unavailable" : "research-profile-loaded"
    let quoteStatus = decisionContext?.quote.status ?? selectedMembership.quote.status.rawValue
    let quoteFetchedAt = decisionContext?.quote.fetchedAt ?? selectedMembership.quote.fetchedAt ?? "unavailable"
    let researchStatus = decisionContext?.research.status ?? selectedMembership.research.status.rawValue
    let evidenceCount = decisionContext?.research.evidence.count ?? 0
    let portfolioStatus = decisionContext?.portfolio.status ?? "omitted"
    let portfolioProvenance = decisionContext?.provenance.portfolio ?? "omitted"
    let portfolioOmitted = assistMobileWorkspaceHasOmittedPortfolioAuthority(decisionContext)
    let pinganSource = pinganSnapshot.map {
        "Pingan=\($0.status.rawValue) asOf=\($0.sourceAsOf ?? "unavailable") importedAt=\($0.importedAt ?? "unavailable") fetchedAt=\($0.fetchedAt ?? "unavailable") freshness=\($0.freshness?.rawValue ?? "unavailable") historical-only"
    } ?? "Pingan=omitted historical-only"
    let contextBlocked = decisionContext == nil
        || assistMobileWorkspaceIsFailClosedState(decisionIntake.state)
        || !portfolioOmitted
    let contextState = contextBlocked
        ? "blocked:factual-context: quote=\(quoteStatus) fetchedAt=\(quoteFetchedAt); research=\(researchStatus) evidence=\(evidenceCount) \(profileState); portfolio=\(portfolioStatus) provenance=\(portfolioProvenance); \(pinganSource); non-omitted portfolio authority is fail-closed and no fresh/live holdings authority is used."
        : "ready:factual-context: quote=\(quoteStatus) fetchedAt=\(quoteFetchedAt); research=\(researchStatus) evidence=\(evidenceCount) \(profileState); portfolio=\(portfolioStatus) provenance=\(portfolioProvenance); \(pinganSource); no fresh/live holdings authority."

    let humanReviewState = assistMobileWorkspaceIsFailClosedState(humanReviewWorkspace.state)
        ? "blocked:human-review: workspace=\(humanReviewWorkspace.state); no stale official review or recommendation is shown."
        : "ready:human-review: workspace=\(humanReviewWorkspace.state); manual review remains advisory-only and idempotent."

    let followUpNoteBlocked = assistMobileWorkspaceIsFailClosedState(followUpWorkflow.state)
        || assistMobileWorkspaceIsFailClosedState(decisionNoteWorkflow.state)
    let followUpNoteState = followUpNoteBlocked
        ? "blocked:follow-up-note: followUp=\(followUpWorkflow.state), decisionNote=\(decisionNoteWorkflow.state); local drafts are cleared or hidden."
        : "ready:follow-up-note: followUp=\(followUpWorkflow.state), decisionNote=\(decisionNoteWorkflow.state); local decision note remains SwiftUI-memory-only unless saved as local record."

    let localRecordStateText = localRecordState.canSave
        ? "ready:local-record: UserDefaults source signature is current; save/load/clear are source-scoped, local-only, unofficial, no API upload, no database write."
        : "blocked:local-record: \(localRecordState.status); saved thoughts are hidden and stale records are not reused."

    return [
        selectedState,
        contextState,
        humanReviewState,
        followUpNoteState,
        localRecordStateText,
        "blocked:safety: production NO_GO, physical-device OWNER_WAIVED_NONBLOCKING_FAILURE with authentication/journey/screenshots NOT_PROVEN, no broker, no order, no trade, no fill, no cash, no fee, no position, no portfolio mutation."
    ]
}

private func assistMobileWorkspaceDailyUseQuickActions(
    selectedMembership: CandidateMembershipData?,
    decisionContext: DecisionContextEnvelope?,
    humanReviewWorkspace: AssistHumanReviewWorkspaceRenderModel,
    followUpWorkflow: AssistReviewFollowUpWorkflowRenderModel,
    decisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel,
    localRecordState: AssistMobileWorkspaceLocalRecordState,
    isLoading: Bool,
    failClosedStates: [String]
) -> [String] {
    if isLoading {
        return [
            "loading:open-context: wait for current quote, research, and portfolio-omitted context before reading.",
            "loading:open-human-review: wait for current human-review workspace facts.",
            "loading:open-follow-up-note: wait for current follow-up and decision-note workflow facts.",
            "loading:save-local-record: disabled until the current source signature is stable.",
            "blocked:safety: quick actions never create recommendation, order, trade, broker call, or portfolio mutation."
        ]
    }

    guard let selectedMembership else {
        return [
            "blocked:open-context: choose one selected candidate first.",
            "blocked:open-human-review: choose one selected candidate first.",
            "blocked:open-follow-up-note: choose one selected candidate first.",
            "blocked:save-local-record: no current source signature exists.",
            "blocked:safety: quick actions never create recommendation, order, trade, broker call, or portfolio mutation."
        ]
    }

    let contextAction = decisionContext == nil || !failClosedStates.isEmpty || !assistMobileWorkspaceHasOmittedPortfolioAuthority(decisionContext)
        ? "blocked:open-context: \(selectedMembership.symbol) context is unavailable, fail-closed, or has non-omitted portfolio authority; stale context and portfolio facts are hidden."
        : "ready:open-context: read \(selectedMembership.symbol) quote freshness, research evidence, and portfolio omitted boundary."
    let reviewAction = assistMobileWorkspaceIsFailClosedState(humanReviewWorkspace.state)
        ? "blocked:open-human-review: workspace=\(humanReviewWorkspace.state); stale review facts are hidden."
        : "ready:open-human-review: inspect human-review workspace=\(humanReviewWorkspace.state) as advisory-only local facts."
    let followUpBlocked = assistMobileWorkspaceIsFailClosedState(followUpWorkflow.state)
        || assistMobileWorkspaceIsFailClosedState(decisionNoteWorkflow.state)
    let followUpAction = followUpBlocked
        ? "blocked:open-follow-up-note: followUp=\(followUpWorkflow.state), decisionNote=\(decisionNoteWorkflow.state); local drafts stay hidden or cleared."
        : "ready:open-follow-up-note: edit SwiftUI-memory follow-up and decision-note drafts; they are not official and not sent."
    let saveRecordAction = localRecordState.canSave
        ? "ready:save-local-record: save current-source thoughts to iOS UserDefaults only; no API upload, database write, broker sync, or official review."
        : "blocked:save-local-record: \(localRecordState.status); stale saved thoughts are hidden."
    let clearRecordAction = localRecordState.sourceSignature == "unavailable"
        ? "blocked:clear-local-record: no current source signature; clear only resets on-screen local draft display."
        : "ready:clear-local-record: clear only the current source-signature UserDefaults envelope after confirmation; API facts and official review history stay untouched."

    return [
        contextAction,
        reviewAction,
        followUpAction,
        saveRecordAction,
        clearRecordAction,
        "blocked:safety: quick actions never create recommendation, order, trade, broker call, cash, fee, position, or portfolio mutation."
    ]
}

private func assistMobileWorkspaceDailyUseReviewPathRail(
    selectedMembership: CandidateMembershipData?,
    decisionContext: DecisionContextEnvelope?,
    humanReviewWorkspace: AssistHumanReviewWorkspaceRenderModel,
    followUpWorkflow: AssistReviewFollowUpWorkflowRenderModel,
    decisionNoteWorkflow: AssistDecisionNoteWorkflowRenderModel,
    localRecordState: AssistMobileWorkspaceLocalRecordState,
    unresolvedGaps: [String],
    isLoading: Bool,
    failClosedStates: [String]
) -> [String] {
    if isLoading {
        return [
            "loading:1-selected-candidate: wait for current membership facts before using the rail.",
            "loading:2-context: wait for current quote freshness, research evidence, and portfolio omitted boundary.",
            "loading:3-human-review: wait for current human-review workspace facts.",
            "loading:4-follow-up-note: wait for current follow-up and decision-note workflows.",
            "loading:5-local-record: wait for a stable current source signature before save/load/clear.",
            "blocked:6-safety: review rail is advisory-only and never creates recommendation, order, trade, broker call, or portfolio mutation."
        ]
    }

    guard let selectedMembership else {
        return [
            "blocked:1-selected-candidate: choose one tracked candidate before the daily review rail.",
            "blocked:2-context: no selected candidate means no trusted context, quote freshness, or research evidence is shown.",
            "blocked:3-human-review: human-review workspace is unavailable without a selected candidate.",
            "blocked:4-follow-up-note: follow-up and decision-note drafts stay hidden without a current source.",
            "blocked:5-local-record: UserDefaults records stay hidden without a current source signature.",
            "blocked:6-safety: review rail is advisory-only and never creates recommendation, order, trade, broker call, or portfolio mutation."
        ]
    }

    let failClosedSummary = failClosedStates.isEmpty ? "none" : failClosedStates.joined(separator: ",")
    let selectedLane = failClosedStates.isEmpty
        ? "ready:1-selected-candidate: \(selectedMembership.symbol) membership=\(selectedMembership.state.rawValue) version=\(selectedMembership.version) is the mobile focus."
        : "blocked:1-selected-candidate: \(selectedMembership.symbol) has fail-closed downstream states \(failClosedSummary); stale facts are hidden."

    let contextLane: String
    if let decisionContext, failClosedStates.isEmpty, assistMobileWorkspaceHasOmittedPortfolioAuthority(decisionContext) {
        contextLane = "ready:2-context: quote=\(decisionContext.quote.status) fetchedAt=\(decisionContext.quote.fetchedAt ?? "unavailable"); research=\(decisionContext.research.status) evidence=\(decisionContext.research.evidence.count); portfolio=\(decisionContext.portfolio.status) provenance=\(decisionContext.provenance.portfolio); no live holdings authority."
    } else {
        let quoteStatus = decisionContext?.quote.status ?? selectedMembership.quote.status.rawValue
        let researchStatus = decisionContext?.research.status ?? selectedMembership.research.status.rawValue
        let portfolioStatus = decisionContext?.portfolio.status ?? "omitted"
        let portfolioProvenance = decisionContext?.provenance.portfolio ?? "omitted"
        contextLane = "blocked:2-context: quote=\(quoteStatus), research=\(researchStatus), portfolio=\(portfolioStatus) provenance=\(portfolioProvenance); stale, missing, or non-omitted portfolio authority is not used as fresh."
    }

    let humanReviewLane = assistMobileWorkspaceIsFailClosedState(humanReviewWorkspace.state)
        ? "blocked:3-human-review: workspace=\(humanReviewWorkspace.state); no stale workspace facts or local draft is promoted."
        : "ready:3-human-review: workspace=\(humanReviewWorkspace.state); manual check display is advisory-only and local drafts are not official review history."

    let followUpNoteBlocked = assistMobileWorkspaceIsFailClosedState(followUpWorkflow.state)
        || assistMobileWorkspaceIsFailClosedState(decisionNoteWorkflow.state)
    let firstGap = unresolvedGaps.first ?? "none"
    let followUpNoteLane = followUpNoteBlocked
        ? "blocked:4-follow-up-note: followUp=\(followUpWorkflow.state), decisionNote=\(decisionNoteWorkflow.state); drafts stay cleared or hidden."
        : "ready:4-follow-up-note: followUp=\(followUpWorkflow.state), decisionNote=\(decisionNoteWorkflow.state); nextGap=\(firstGap); drafts remain SwiftUI-memory-only unless saved locally."

    let localRecordLane = localRecordState.canSave
        ? "ready:5-local-record: current-source UserDefaults save/load/clear is available; no API upload, no database write, no broker sync, and no official review conversion."
        : "blocked:5-local-record: \(localRecordState.status); saved thoughts remain hidden until the source signature is current."

    return [
        selectedLane,
        contextLane,
        humanReviewLane,
        followUpNoteLane,
        localRecordLane,
        "blocked:6-safety: production NO_GO, physical-device OWNER_WAIVED_NONBLOCKING_FAILURE with authentication/journey/screenshots NOT_PROVEN, no recommendation, no order, no trade, no fill, no cash, no fee, no position, no portfolio mutation."
    ]
}

private func assistMobileWorkspaceAvailabilityStatus(
    selectedMembership: CandidateMembershipData?,
    researchProfile: ResearchProfileEnvelope?,
    decisionContext: DecisionContextEnvelope?,
    drafts: AssistMobileWorkspaceLocalDraftState,
    unresolvedGaps: [String],
    isLoading: Bool,
    failClosedStates: [String]
) -> String {
    var states: [String] = []
    if isLoading {
        states.append("loading")
    }
    guard let selectedMembership else {
        states.append("no-selected-candidate")
        states.append(drafts.isEmpty ? "local-draft-empty" : "local-draft-exists")
        states.append(unresolvedGaps.isEmpty ? "no-unresolved-gap" : "unresolved-gap")
        states.append("production-no-go")
        states.append("physical-device-owner-waived-dtx-failure")
        return "Daily states: \(states.joined(separator: " / "))."
    }

    states.append("selected-candidate")
    states.append("membership-\(selectedMembership.state.rawValue)")
    switch selectedMembership.research.status {
    case .available:
        states.append("research-available")
    case .missing:
        states.append("missing-research")
    }
    switch selectedMembership.quote.status {
    case .fresh:
        states.append("quote-fresh")
    case .stale:
        states.append("stale-quote")
    case .unavailable:
        states.append("missing-quote")
    }
    if let researchProfile {
        states.append(researchProfile.data == nil ? "research-unavailable" : "research-profile-loaded")
    } else {
        states.append("research-profile-empty")
    }
    if let decisionContext {
        states.append("decision-context-\(decisionContext.quote.status)")
        states.append("portfolio-\(decisionContext.portfolio.status)")
    } else {
        states.append("decision-context-empty")
    }
    if !failClosedStates.isEmpty {
        states.append("fail-closed")
    }
    states.append(drafts.isEmpty ? "local-draft-empty" : "local-draft-exists")
    states.append(unresolvedGaps.isEmpty ? "no-unresolved-gap" : "unresolved-gap")
    states.append("production-no-go")
    states.append("physical-device-owner-waived-dtx-failure")
    return "Daily states: \(states.joined(separator: " / "))."
}

private func assistMobileWorkspaceProfileSummary(_ envelope: ResearchProfileEnvelope?) -> String {
    guard let envelope else { return "idle" }
    guard let payload = envelope.data else { return envelope.message }
    return "\(payload.profile.symbol) / \(payload.profile.currentView) / evidence=\(payload.evidence.count)"
}

private func assistMobileWorkspacePinganBoundary(snapshot: PinganSnapshotEnvelope?, message: String?) -> String {
    guard let snapshot else {
        let reason = message ?? "Pingan historical-only snapshot is idle"
        return "\(reason); historical-only, not live holdings, not broker reconciliation, not account truth, not risk-impact authority, not accounting authority, and not execution input."
    }
    return "\(snapshot.status.rawValue)：\(snapshot.stateMessage) Historical-only, last-imported context; not live holdings, not broker reconciliation, not account truth, not risk-impact authority, not accounting authority, and not execution input."
}

private func assistMobileWorkspacePortfolioAuthorityStateMatrix(
    decisionContext: DecisionContextEnvelope?,
    pinganSnapshot: PinganSnapshotEnvelope?,
    isLoading: Bool,
    failClosedStates: [String]
) -> [String] {
    let portfolioStatus = decisionContext?.portfolio.status ?? "omitted"
    let portfolioProvenance = decisionContext?.provenance.portfolio ?? "omitted"
    let pinganStatus = pinganSnapshot?.status.rawValue ?? "missing"
    let pinganSource = pinganSnapshot?.sourceSystem ?? "unavailable"
    let pinganAsOf = pinganSnapshot?.sourceAsOf ?? "unavailable"
    let pinganImportedAt = pinganSnapshot?.importedAt ?? "unavailable"
    let pinganFetchedAt = pinganSnapshot?.fetchedAt ?? "unavailable"
    let pinganFreshness = pinganSnapshot?.freshness?.rawValue ?? "unavailable"
    let activeFailures = failClosedStates.isEmpty ? "none" : failClosedStates.joined(separator: ",")
    let loadingState = isLoading ? "loading" : "not-loading"

    return [
        "portfolio-omitted: status=\(portfolioStatus) provenance=\(portfolioProvenance); no approved live authoritative source, no live holdings, no broker truth.",
        "pingan-historical-only: status=\(pinganStatus) source=\(pinganSource) asOf=\(pinganAsOf) importedAt=\(pinganImportedAt) fetchedAt=\(pinganFetchedAt) freshness=\(pinganFreshness); last-imported only and not authoritative.",
        "blocked-authority-lanes: riskImpact=blocked, brokerReconciliation=blocked, accountTruth=blocked, accounting=blocked, execution=blocked for fail-closed states; historical rows use blocked_not_live_authoritative lanes.",
        "failure-states: loading=\(loadingState), empty, stale, unauthorized, conflict, unavailable, offline, malformed, fixture-unavailable, source-mismatch, and missing states are explicit and fail closed; active=\(activeFailures).",
        "source-class-boundary: sample, fixture, migration, shadow, research, quant, unknown-stale, and local-only records are not real holdings, broker truth, account truth, accounting authority, or execution input.",
        "non-mutation-boundary: local records, decision notes, review history, research evidence, and quant evidence do not mutate official portfolio, cash, fee, position, transaction, or review facts."
    ]
}
