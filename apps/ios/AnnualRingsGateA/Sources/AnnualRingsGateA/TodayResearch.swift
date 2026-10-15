import Foundation

public enum TodayResearchStatus: String, Codable, Equatable, Sendable {
    case available
    case stale
    case conflict
    case notFound = "not_found"
    case unauthorized
    case malformed
    case unavailable
}

public enum TodayResearchCategory: String, Codable, Equatable, Sendable {
    case userAction = "user_action"
    case holdingLogicChange = "holding_logic_change"
    case researchChange = "research_change"
}

public enum TodayResearchTrackingState: String, Codable, Equatable, Sendable {
    case needsMaterial = "needs_material"
    case needsEvidencePack = "needs_evidence_pack"
    case needsResearch = "needs_research"
    case awaitingUserConfirmation = "awaiting_user_confirmation"
    case needsReview = "needs_review"
    case confirmed
    case rejected
}

public struct TodayResearchEnvelope: Codable, Equatable, Sendable {
    public static let schemaVersionCurrent = "2026-07-25.today-research.v2"

    public let schemaVersion: String
    public let generatedAt: String
    public let status: TodayResearchStatus
    public let membershipId: String
    public let membershipVersion: Int?
    public let requestedActorId: String
    public let requestedSymbol: String?
    public let metadata: FactMetadata
    public let quality: TodayResearchQuality?
    public let items: [TodayResearchItem]
    public let omittedItemCount: Int
    public let message: String
    public let safety: TodayResearchSafety

    public static func unavailable(
        _ status: TodayResearchStatus = .unavailable,
        message: String,
        membershipId: String
    ) -> Self {
        let now = ISO8601DateFormatter().string(from: Date())
        let status = status == .available || status == .stale || status == .conflict ? .unavailable : status
        let freshness = status == .notFound ? "missing" : "unavailable"
        return Self(
            schemaVersion: schemaVersionCurrent,
            generatedAt: now,
            status: status,
            membershipId: membershipId,
            membershipVersion: nil,
            requestedActorId: "client",
            requestedSymbol: nil,
            metadata: FactMetadata(
                source: "today",
                asOf: now,
                fetchedAt: now,
                freshness: freshness,
                provenance: "unavailable",
                authority: "unavailable",
                stale: status == .stale,
                missing: status == .notFound,
                conflict: status == .conflict,
                fixture: false,
                correctionOf: nil,
                replaces: nil,
                message: message
            ),
            quality: nil,
            items: [],
            omittedItemCount: 0,
            message: message,
            safety: .readOnly
        )
    }

    public func validateForDisplay(expectedMembershipId: String? = nil, expectedActorId: String? = nil) throws {
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionCurrent { errors.append("Today schemaVersion is invalid") }
        if factMetadataIsRFC3339DateTime(generatedAt) == false { errors.append("Today generatedAt is invalid") }
        if boundedText(membershipId, 50) == false { errors.append("Today membershipId is required") }
        if let expectedMembershipId, membershipId != expectedMembershipId { errors.append("Today membershipId does not match the request") }
        if boundedText(requestedActorId, 200) == false { errors.append("Today requestedActorId is required") }
        if let expectedActorId, requestedActorId != expectedActorId { errors.append("Today requestedActorId does not match the current actor") }
        metadata.validateForDisplay(label: "Today", errors: &errors)
        if status == .available && metadata.freshness != "fresh"
            || status == .stale && metadata.freshness != "stale"
            || status == .conflict && metadata.freshness != "conflict" {
            errors.append("Today metadata does not match status")
        }
        if boundedText(message, 4_000) == false { errors.append("Today message is required") }
        if omittedItemCount < 0 || items.count > 50 { errors.append("Today item bounds are invalid") }

        let exposesIdentity = status == .available || status == .stale || status == .conflict
        if exposesIdentity {
            if membershipVersion ?? 0 < 1 { errors.append("Today membershipVersion is invalid") }
            if requestedSymbol?.range(of: #"^HK\.\d{5}$"#, options: .regularExpression) == nil {
                errors.append("Today requestedSymbol is invalid")
            }
            if let quality {
                quality.validateForDisplay(envelopeStatus: status, errors: &errors)
            } else {
                errors.append("Source-bound Today response requires quality measurements")
            }
        } else if membershipVersion != nil || requestedSymbol != nil {
            errors.append("Fail-closed Today response must clear source identity")
        } else if quality != nil {
            errors.append("Fail-closed Today response must clear quality measurements")
        }
        if status != .available && items.isEmpty == false {
            errors.append("Fail-closed Today response must clear items")
        }
        if status == .available && items.isEmpty {
            errors.append("Available Today response requires an item")
        }

        var itemIds = Set<String>()
        for (index, item) in items.enumerated() {
            item.validateForDisplay(
                order: index + 1,
                membershipId: membershipId,
                membershipVersion: membershipVersion,
                symbol: requestedSymbol,
                errors: &errors
            )
            if let quality, item.bindings.evidencePackRef != quality.sourceHealth.evidencePackRef
                || item.bindings.reportRef != quality.researchStructure.reportRef {
                errors.append("Today item research versions do not match quality identity")
            }
            if itemIds.insert(item.id).inserted == false { errors.append("Today item id is duplicated") }
        }
        safety.validateForDisplay(errors: &errors)
        if errors.isEmpty == false { throw TodayResearchValidationError.invalid(errors) }
    }
}

public struct TodayResearchItem: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let order: Int
    public let category: TodayResearchCategory
    public let priority: String
    public let trackingState: TodayResearchTrackingState
    public let symbol: String
    public let title: String
    public let summary: String
    public let thesis: String?
    public let invalidationConditions: [String]
    public let nextCheckpoint: String?
    public let versionChange: String?
    public let reportRevision: TodayResearchReportRevision?
    public let bindings: TodayResearchBindings

    fileprivate func validateForDisplay(
        order expectedOrder: Int,
        membershipId: String,
        membershipVersion: Int?,
        symbol: String?,
        errors: inout [String]
    ) {
        if boundedText(id, 500) == false || order != expectedOrder || self.symbol != symbol { errors.append("Today item identity is invalid") }
        if ["action", "high", "medium", "low"].contains(priority) == false { errors.append("Today item priority is invalid") }
        if boundedText(title, 500) == false || boundedText(summary, 4_000) == false { errors.append("Today item copy is invalid") }
        if thesis.map({ boundedText($0, 10_000) == false }) == true { errors.append("Today thesis is invalid") }
        if invalidationConditions.count > 50 || invalidationConditions.contains(where: { boundedText($0, 4_000) == false }) {
            errors.append("Today invalidation conditions are invalid")
        }
        if nextCheckpoint.map({ boundedText($0, 4_000) == false }) == true
            || versionChange.map({ boundedText($0, 4_000) == false }) == true {
            errors.append("Today checkpoint or version change is invalid")
        }
        reportRevision?.validateForDisplay(bindings: bindings, errors: &errors)
        bindings.validateForDisplay(membershipId: membershipId, membershipVersion: membershipVersion, errors: &errors)
        let expectedIdentity: (String, TodayResearchCategory)?
        if category == .userAction {
            expectedIdentity = ("action:\(membershipId):v\(membershipVersion ?? 0):\(trackingState.rawValue)", .userAction)
        } else if let monitor = bindings.monitorRef {
            expectedIdentity = (
                "\(monitor.kind):\(monitor.id):v\(monitor.runVersion)",
                monitor.kind == "gcl_pv_price" ? .holdingLogicChange : .researchChange
            )
        } else if trackingState == .confirmed || trackingState == .rejected, let report = bindings.reportRef {
            expectedIdentity = ("report:\(report.id):v\(report.version)", .researchChange)
        } else if trackingState == .needsReview, bindings.eventRefs.count == 1 {
            let event = bindings.eventRefs[0]
            expectedIdentity = (
                "event:\(event.eventId):v\(event.eventVersion)",
                event.coverageScope == "current_holding" ? .holdingLogicChange : .researchChange
            )
        } else {
            expectedIdentity = nil
        }
        if expectedIdentity?.0 != id || expectedIdentity?.1 != category {
            errors.append("Today item identity does not match its exact source binding")
        }
        if category == .holdingLogicChange && bindings.holdingSnapshotRefs.isEmpty {
            errors.append("Holding-logic Today item requires an exact snapshot binding")
        }
        let actionStates: Set<TodayResearchTrackingState> = [.needsMaterial, .needsEvidencePack, .needsResearch, .awaitingUserConfirmation]
        if (category == .userAction) != actionStates.contains(trackingState) {
            errors.append("Today user-action tracking state is invalid")
        }
    }
}

public struct TodayResearchBindings: Codable, Equatable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let factRefs: [TodayResearchFactRef]
    public let eventRefs: [TodayResearchEventRef]
    public let monitorRef: TodayResearchMonitorRef?
    public let evidencePackRef: TodayResearchEvidencePackRef?
    public let reportRef: TodayResearchReportRef?
    public let decisionRef: TodayResearchDecisionRef?
    public let holdingSnapshotRefs: [TodayResearchHoldingSnapshotRef]

    fileprivate func validateForDisplay(membershipId: String, membershipVersion: Int?, errors: inout [String]) {
        if self.membershipId != membershipId || self.membershipVersion != membershipVersion { errors.append("Today binding membership version is invalid") }
        if factRefs.count > 250 || eventRefs.count > 250 || holdingSnapshotRefs.count > 250 { errors.append("Today binding collection is too large") }
        factRefs.forEach { $0.validateForDisplay(errors: &errors) }
        eventRefs.forEach { $0.validateForDisplay(errors: &errors) }
        holdingSnapshotRefs.forEach { $0.validateForDisplay(errors: &errors) }
        monitorRef?.validateForDisplay(errors: &errors)
        evidencePackRef?.validateForDisplay(errors: &errors)
        reportRef?.validateForDisplay(errors: &errors)
        decisionRef?.validateForDisplay(errors: &errors)
        if let evidencePackRef, let reportRef, evidencePackRef.id != reportRef.evidencePackId {
            errors.append("Today report does not bind the displayed evidence pack")
        }
        if let reportRef, let decisionRef, reportRef.id != decisionRef.reportId {
            errors.append("Today decision does not bind the displayed report")
        }
    }
}

public struct TodayResearchFactRef: Codable, Equatable, Sendable {
    public let materialId: String
    public let evidenceId: String
    public let sourceType: String
    public let sourceVersion: String
    public let revision: Int
    public let contentFingerprint: String
    public let publishedAt: String
    public let capturedAt: String
    public let validUntil: String
    public let verificationStatus: String
    public let rightsStatus: String

    fileprivate func validateForDisplay(errors: inout [String]) {
        if positiveId(materialId) == false || positiveId(evidenceId) == false
            || boundedText(sourceType, 200) == false || boundedText(sourceVersion, 200) == false
            || revision < 1 || contentFingerprint.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) == nil
            || factMetadataIsRFC3339DateTime(publishedAt) == false || factMetadataIsRFC3339DateTime(capturedAt) == false
            || factMetadataIsRFC3339DateTime(validUntil) == false || verificationStatus != "verified"
            || ["user_provided", "authorized_public"].contains(rightsStatus) == false {
            errors.append("Today fact reference is invalid")
        }
    }
}

public struct TodayResearchEventRef: Codable, Equatable, Sendable {
    public let eventId: String
    public let eventVersion: Int
    public let eventFingerprint: String
    public let coverageScope: String
    public let keyVariable: String
    public let hypothesisImpact: String
    public let monitorRuleBinding: ResearchMonitorRule?

    fileprivate func validateForDisplay(errors: inout [String]) {
        if positiveId(eventId) == false || eventVersion < 1
            || eventFingerprint.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) == nil
            || ["research_stock", "current_holding"].contains(coverageScope) == false || boundedText(keyVariable, 500) == false
            || ["supports", "weakens", "unknown"].contains(hypothesisImpact) == false
            || (monitorRuleBinding?.validates(keyVariables: [keyVariable]) == false)
            || (monitorRuleBinding != nil && (coverageScope != "research_stock"
                || monitorRuleBinding?.enabled != true || monitorRuleBinding?.version == nil
                || monitorRuleBinding?.confirmedAt == nil)) {
            errors.append("Today event reference is invalid")
        }
    }
}

public struct TodayResearchHoldingSnapshotRef: Codable, Equatable, Sendable {
    public let accountScopeId: String
    public let snapshotId: String
    public let sourceBatchId: String
    public let sourceAsOf: String
    public let positionSourceRowId: String

    fileprivate func validateForDisplay(errors: inout [String]) {
        if boundedText(accountScopeId, 500) == false || boundedText(snapshotId, 500) == false
            || boundedText(sourceBatchId, 500) == false || boundedText(positionSourceRowId, 1_000) == false
            || factMetadataIsRFC3339DateTime(sourceAsOf) == false
            || positionSourceRowId.hasPrefix("broker_import_batches:\(sourceBatchId)/") == false {
            errors.append("Today holding snapshot reference is invalid")
        }
    }
}

public struct TodayResearchMonitorRef: Codable, Equatable, Sendable {
    public let kind: String
    public let id: String
    public let runVersion: Int
    public let runFingerprint: String

    fileprivate func validateForDisplay(errors: inout [String]) {
        if ["geely_sales", "gcl_pv_price", "weinstein_structure"].contains(kind) == false || positiveId(id) == false
            || runVersion < 1 || validFingerprint(runFingerprint) == false {
            errors.append("Today monitor reference is invalid")
        }
    }
}
public struct TodayResearchEvidencePackRef: Codable, Equatable, Sendable {
    public let id: String
    public let version: Int
    public let packFingerprint: String

    func validateForDisplay(errors: inout [String]) {
        if positiveId(id) == false || version < 1 || validFingerprint(packFingerprint) == false {
            errors.append("Today evidence-pack reference is invalid")
        }
    }
}
public struct TodayResearchReportRef: Codable, Equatable, Sendable {
    public let id: String
    public let version: Int
    public let evidencePackId: String
    public let status: String

    func validateForDisplay(errors: inout [String]) {
        if positiveId(id) == false || version < 1 || positiveId(evidencePackId) == false
            || ["evidence_insufficient", "complete_pending_confirmation"].contains(status) == false {
            errors.append("Today report reference is invalid")
        }
    }
}
public struct TodayResearchReportRevisionRef: Codable, Equatable, Sendable {
    public let id: String
    public let version: Int
    public let evidencePackId: String
    public let reportFingerprint: String

    fileprivate func validateForDisplay(errors: inout [String]) {
        if positiveId(id) == false || version < 1 || positiveId(evidencePackId) == false
            || (reportFingerprint != "UNKNOWN" && validFingerprint(reportFingerprint) == false) {
            errors.append("Today report revision reference is invalid")
        }
    }
}
public struct TodayResearchReportRevision: Codable, Equatable, Sendable {
    public let current: TodayResearchReportRevisionRef
    public let previous: TodayResearchReportRevisionRef?
    public let declaredChange: String
    public let changedSections: [String]
    public let unchangedSections: [String]
    public let bindingChanged: Bool?

    fileprivate func validateForDisplay(bindings: TodayResearchBindings, errors: inout [String]) {
        current.validateForDisplay(errors: &errors)
        previous?.validateForDisplay(errors: &errors)
        if boundedText(declaredChange, 4_000) == false
            || changedSections.count > 50 || changedSections.contains(where: { boundedText($0, 4_000) == false })
            || unchangedSections.count > 50 || unchangedSections.contains(where: { boundedText($0, 4_000) == false }) {
            errors.append("Today report revision summary is invalid")
        }
        if let previous, previous.version >= current.version {
            errors.append("Today report revision previous version must precede current")
        }
        guard let report = bindings.reportRef else {
            errors.append("Today report revision requires a report binding")
            return
        }
        if current.id != report.id || current.version != report.version || current.evidencePackId != report.evidencePackId {
            errors.append("Today report revision current reference does not match report binding")
        }
    }
}
public struct TodayResearchDecisionRef: Codable, Equatable, Sendable {
    public let id: String
    public let reportId: String
    public let decision: String
    public let decidedAt: String

    fileprivate func validateForDisplay(errors: inout [String]) {
        if positiveId(id) == false || positiveId(reportId) == false
            || ["confirmed", "rejected"].contains(decision) == false
            || factMetadataIsRFC3339DateTime(decidedAt) == false {
            errors.append("Today decision reference is invalid")
        }
    }
}

public struct TodayResearchSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let mutatesCash: Bool
    public let writesFee: Bool
    public let mutatesPosition: Bool
    public let callsBroker: Bool
    public let productionWrite: Bool

    public static let readOnly = Self(
        advisoryOnly: true,
        createsOrder: false,
        createsTrade: false,
        mutatesCash: false,
        writesFee: false,
        mutatesPosition: false,
        callsBroker: false,
        productionWrite: false
    )

    fileprivate func validateForDisplay(errors: inout [String]) {
        if advisoryOnly == false || createsOrder || createsTrade || mutatesCash || writesFee || mutatesPosition || callsBroker || productionWrite {
            errors.append("Today safety boundary is invalid")
        }
    }
}

public enum TodayResearchValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

func positiveId(_ value: String) -> Bool {
    value.range(of: #"^[1-9]\d*$"#, options: .regularExpression) != nil
}

func validFingerprint(_ value: String) -> Bool {
    value.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
}

func boundedText(_ value: String, _ max: Int) -> Bool {
    value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false && value.count <= max
}
