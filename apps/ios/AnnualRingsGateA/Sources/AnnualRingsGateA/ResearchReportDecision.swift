import Foundation

public struct ManualDecisionSourceBinding: Codable, Equatable, Identifiable, Sendable {
    public let bindingKind: String?
    public let membershipId: String?
    public let membershipVersion: Int?
    public let evidenceId: String?
    public let sourceId: String
    public let title: String
    public let sourceType: String
    public let sourceUrl: String?
    public let contentSha256: String
    public let pageNumber: Int?
    public let documentId: String?
    public let documentPdfSha256: String?
    public let snapshotId: String?
    public let snapshotRawSha256: String?
    public let materialId: String?
    public let materialRevision: Int?
    public let materialFingerprint: String?
    public var id: String { sourceId }

    public init(evidenceId: String?, sourceId: String, title: String, sourceType: String,
                sourceUrl: String?, contentSha256: String, pageNumber: Int?,
                documentId: String? = nil, documentPdfSha256: String? = nil,
                snapshotId: String?, snapshotRawSha256: String?, materialId: String?,
                materialRevision: Int?, materialFingerprint: String?,
                bindingKind: String? = nil, membershipId: String? = nil,
                membershipVersion: Int? = nil) {
        self.bindingKind = bindingKind
        self.membershipId = membershipId
        self.membershipVersion = membershipVersion
        self.evidenceId = evidenceId; self.sourceId = sourceId; self.title = title
        self.sourceType = sourceType; self.sourceUrl = sourceUrl
        self.contentSha256 = contentSha256; self.pageNumber = pageNumber
        self.documentId = documentId; self.documentPdfSha256 = documentPdfSha256
        self.snapshotId = snapshotId; self.snapshotRawSha256 = snapshotRawSha256
        self.materialId = materialId; self.materialRevision = materialRevision
        self.materialFingerprint = materialFingerprint
    }

    private enum CodingKeys: String, CodingKey {
        case bindingKind, membershipId, membershipVersion, evidenceId, sourceId, title,
             sourceType, sourceUrl, contentSha256, pageNumber, documentId,
             documentPdfSha256, snapshotId, snapshotRawSha256, materialId,
             materialRevision, materialFingerprint
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        let saved = bindingKind == "saved_material"
        if saved {
            try values.encode("saved_material", forKey: .bindingKind)
            try values.encode(membershipId, forKey: .membershipId)
            try values.encode(membershipVersion, forKey: .membershipVersion)
            try values.encode(sourceUrl, forKey: .sourceUrl) // The saved-material contract requires explicit null.
        } else {
            try values.encodeIfPresent(bindingKind, forKey: .bindingKind)
            try values.encodeIfPresent(evidenceId, forKey: .evidenceId)
            try values.encodeIfPresent(sourceUrl, forKey: .sourceUrl)
        }
        try values.encode(sourceId, forKey: .sourceId)
        try values.encode(title, forKey: .title)
        try values.encode(sourceType, forKey: .sourceType)
        try values.encode(contentSha256, forKey: .contentSha256)
        try values.encodeIfPresent(pageNumber, forKey: .pageNumber)
        try values.encodeIfPresent(documentId, forKey: .documentId)
        try values.encodeIfPresent(documentPdfSha256, forKey: .documentPdfSha256)
        try values.encodeIfPresent(snapshotId, forKey: .snapshotId)
        try values.encodeIfPresent(snapshotRawSha256, forKey: .snapshotRawSha256)
        try values.encodeIfPresent(materialId, forKey: .materialId)
        try values.encodeIfPresent(materialRevision, forKey: .materialRevision)
        try values.encodeIfPresent(materialFingerprint, forKey: .materialFingerprint)
    }
}

public struct CreateDecisionCheckRequest: Codable, Equatable, Sendable {
    public let decisionContextSchemaVersion: String
    public let contextId: String
    public let contextHash: String
    public let actionIntent: String
    public let humanCheckResult: String
    public let userFinalDecision: String?
    public let reviewedAt: String?
    public let reviewDueOn: String?
    public let manualSourceBindings: [ManualDecisionSourceBinding]?
    public let researchChangeBinding: OrdinaryResearchChangeBinding?
    public let decisionSnapshotBinding: DecisionSnapshotBinding?
    public let conditionalDecision: AnnualConditionalDecisionSubmission?
    public let researchReportBinding: ResearchReportDecisionBinding?
    public let formalDecision: FormalOwnerDecisionInput?
    public let idempotencyKey: String

    public init(
        decisionContextSchemaVersion: String,
        contextId: String,
        contextHash: String,
        actionIntent: String,
        humanCheckResult: String,
        userFinalDecision: String?,
        reviewedAt: String?,
        reviewDueOn: String? = nil,
        manualSourceBindings: [ManualDecisionSourceBinding]? = nil,
        researchChangeBinding: OrdinaryResearchChangeBinding? = nil,
        decisionSnapshotBinding: DecisionSnapshotBinding? = nil,
        conditionalDecision: AnnualConditionalDecisionSubmission? = nil,
        researchReportBinding: ResearchReportDecisionBinding? = nil,
        formalDecision: FormalOwnerDecisionInput? = nil,
        idempotencyKey: String
    ) {
        self.decisionContextSchemaVersion = decisionContextSchemaVersion
        self.contextId = contextId
        self.contextHash = contextHash
        self.actionIntent = actionIntent
        self.humanCheckResult = humanCheckResult
        self.userFinalDecision = userFinalDecision
        self.reviewedAt = reviewedAt
        self.reviewDueOn = reviewDueOn
        self.manualSourceBindings = manualSourceBindings
        self.researchChangeBinding = researchChangeBinding
        self.decisionSnapshotBinding = decisionSnapshotBinding
        self.conditionalDecision = conditionalDecision
        self.researchReportBinding = researchReportBinding
        self.formalDecision = formalDecision
        self.idempotencyKey = idempotencyKey
    }
}

public let researchReportDecisionBindingVersion = "2026-07-30.s1f-report-formal-decision-binding.v1"

public struct ResearchReportDecisionBinding: Codable, Equatable, Hashable, Sendable {
    public let bindingVersion: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let evidencePackId: String
    public let evidencePackFingerprint: String
    public let reportId: String
    public let reportVersion: Int
    public let contractVersion: String
    public let reportFingerprint: String
    public let reportDecisionId: String
    public let reportDecision: String
    public let reportDecisionActorType: String
    public let reportDecisionActorId: String
    public let decidedAt: String

    public init(
        bindingVersion: String = researchReportDecisionBindingVersion,
        membershipId: String,
        membershipVersion: Int,
        symbol: String,
        evidencePackId: String,
        evidencePackFingerprint: String,
        reportId: String,
        reportVersion: Int,
        contractVersion: String,
        reportFingerprint: String,
        reportDecisionId: String,
        reportDecision: String,
        reportDecisionActorType: String,
        reportDecisionActorId: String,
        decidedAt: String
    ) {
        self.bindingVersion = bindingVersion
        self.membershipId = membershipId
        self.membershipVersion = membershipVersion
        self.symbol = symbol
        self.evidencePackId = evidencePackId
        self.evidencePackFingerprint = evidencePackFingerprint
        self.reportId = reportId
        self.reportVersion = reportVersion
        self.contractVersion = contractVersion
        self.reportFingerprint = reportFingerprint
        self.reportDecisionId = reportDecisionId
        self.reportDecision = reportDecision
        self.reportDecisionActorType = reportDecisionActorType
        self.reportDecisionActorId = reportDecisionActorId
        self.decidedAt = decidedAt
    }

    public func validate(expectedSymbol: String? = nil) throws {
        var errors: [String] = []
        if bindingVersion != researchReportDecisionBindingVersion { errors.append("report bindingVersion is invalid") }
        for value in [membershipId, symbol, evidencePackId, evidencePackFingerprint, reportId,
                      contractVersion, reportFingerprint, reportDecisionId, reportDecisionActorId]
        where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("report binding contains an empty required identity")
        }
        if membershipVersion <= 0 || reportVersion <= 0 { errors.append("report binding versions must be positive") }
        if symbol.range(of: #"^HK\.[0-9]{5}$"#, options: .regularExpression) == nil {
            errors.append("report binding symbol must be canonical HK")
        }
        if let expectedSymbol, symbol != expectedSymbol { errors.append("report binding symbol must match decision symbol") }
        for hash in [evidencePackFingerprint, reportFingerprint]
        where hash.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) == nil {
            errors.append("report binding fingerprints must be lowercase sha256")
        }
        if reportDecision != "confirmed" || reportDecisionActorType != "user" {
            errors.append("report binding requires a confirmed user decision")
        }
        if !isParseableDateTime(decidedAt) { errors.append("report binding decidedAt must be a date-time") }
        if !errors.isEmpty { throw DecisionWriteValidationError.invalid(errors) }
    }
}

public struct ResearchReportDecisionState: Codable, Equatable, Sendable {
    public let availability: String
    public let binding: ResearchReportDecisionBinding?
    public let limitation: String

    public static let notCaptured = ResearchReportDecisionState(
        availability: "not_captured",
        binding: nil,
        limitation: "This historical decision did not capture a research-report binding and is not reconstructed."
    )

    public func validate(expectedSymbol: String? = nil) throws {
        var errors: [String] = []
        if limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("research report decision limitation is required")
        }
        if availability == "preserved" {
            if let binding {
                do { try binding.validate(expectedSymbol: expectedSymbol) }
                catch DecisionWriteValidationError.invalid(let bindingErrors) { errors.append(contentsOf: bindingErrors) }
                catch { errors.append("research report decision binding is invalid") }
            } else { errors.append("preserved research report decision requires binding") }
        } else if availability == "not_captured" {
            if binding != nil { errors.append("not_captured research report decision must not carry binding") }
        } else { errors.append("research report decision availability is invalid") }
        if !errors.isEmpty { throw DecisionWriteValidationError.invalid(errors) }
    }
}

func validateResearchReportDecisionRawShape(_ value: Any, label: String) throws {
    guard let state = value as? [String: Any],
          Set(state.keys) == Set(["availability", "binding", "limitation"]),
          let availability = state["availability"] as? String,
          let limitation = state["limitation"] as? String,
          !limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw DecisionSnapshotValidationError.invalid(["\(label) must have exact versioned state fields"])
    }
    if availability == "not_captured" {
        guard state["binding"] is NSNull else {
            throw DecisionSnapshotValidationError.invalid(["\(label) not_captured binding must be null"])
        }
        return
    }
    let expectedKeys: Set<String> = [
        "bindingVersion", "membershipId", "membershipVersion", "symbol", "evidencePackId",
        "evidencePackFingerprint", "reportId", "reportVersion", "contractVersion",
        "reportFingerprint", "reportDecisionId", "reportDecision", "reportDecisionActorType",
        "reportDecisionActorId", "decidedAt"
    ]
    guard availability == "preserved",
          let binding = state["binding"] as? [String: Any],
          Set(binding.keys) == expectedKeys else {
        throw DecisionSnapshotValidationError.invalid(["\(label) preserved binding fields are invalid"])
    }
}

func validateRequiredResearchReportDecisionRawShape(
    _ container: [String: Any],
    label: String
) throws {
    guard let value = container["researchReportDecision"] else {
        throw DecisionSnapshotValidationError.invalid(["\(label) is required"])
    }
    try validateResearchReportDecisionRawShape(value, label: label)
}

public func researchReportFormalDecisionIsEligible(
    membership: CandidateMembershipData,
    workspace: FrozenResearchEvidenceWorkspace.DataPayload?,
    report: TwoLayerReportData,
    decision: TwoLayerReportDecision,
    pack: FrozenResearchEvidencePack?
) -> Bool {
    guard membership.state != .archived,
          let workspace,
          let pack,
          workspace.latestReport?.id == report.id,
          workspace.reports.first?.id == report.id,
          workspace.userDecision?.id == decision.id,
          workspace.userDecision?.reportId == report.id,
          workspace.latestPack?.id == pack.id,
          workspace.latestPack?.packFingerprint == pack.packFingerprint,
          membership.id == pack.membershipId,
          membership.version == pack.membershipVersion,
          membership.symbol == pack.symbol,
          membership.actorId == decision.actorId,
          pack.currentness.status == "current",
          report.isFormalizable,
          report.payload.adviceLayer?.hasFormalRecommendation == true,
          report.evidencePackId == pack.id,
          decision.reportId == report.id,
          decision.decision == "confirmed",
          decision.actorType == "user" else {
        return false
    }
    return true
}
