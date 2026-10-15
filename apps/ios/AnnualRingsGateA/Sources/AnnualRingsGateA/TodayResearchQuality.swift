import Foundation

public enum TodayResearchSourceHealthStatus: String, Codable, Equatable, Sendable {
    case healthy
    case missing
    case stale
    case conflict
    case verificationBlocked = "verification_blocked"
    case rightsBlocked = "rights_blocked"
    case revisionMismatch = "revision_mismatch"
}

public enum TodayResearchSourceRecoveryDestination: Equatable, Sendable {
    case documents
    case frozenEvidence
    case report
    case portfolio
}

public struct TodayResearchQuality: Codable, Equatable, Sendable {
    public let sourceHealth: TodayResearchSourceHealth
    public let researchStructure: TodayResearchStructure
    public let secondOpinion: TodayResearchSecondOpinion

    func validateForDisplay(envelopeStatus: TodayResearchStatus, errors: inout [String]) {
        sourceHealth.validateForDisplay(envelopeStatus: envelopeStatus, errors: &errors)
        researchStructure.validateForDisplay(errors: &errors)
        secondOpinion.validateForDisplay(errors: &errors)
        if let pack = sourceHealth.evidencePackRef, let report = researchStructure.reportRef,
           pack.id != report.evidencePackId {
            errors.append("Today quality report does not bind its measured evidence pack")
        }
    }
}

public struct TodayResearchSourceHealth: Codable, Equatable, Sendable {
    public let id: String
    public let status: TodayResearchSourceHealthStatus
    public let issueCodes: [String]
    public let totalMaterialCount: Int
    public let currentMaterialCount: Int
    public let evidencePackRef: TodayResearchEvidencePackRef?

    private static let allowedIssues = Set([
        "missing_materials", "stale_materials", "conflicting_materials", "unverified_materials",
        "unauthorized_rights", "future_source_time", "unfrozen_revision",
        "pack_integrity_failure", "report_pack_mismatch", "historical_evidence_pack",
        "holding_snapshot_stale", "holding_snapshot_conflict"
    ])

    public var userIssueSummary: String {
        issueCodes.map { code in
            switch code {
            case "missing_materials": "尚无可追溯材料"
            case "stale_materials": "材料已过期"
            case "conflicting_materials": "材料存在冲突"
            case "unverified_materials": "材料尚未核验"
            case "unauthorized_rights": "材料使用权未确认"
            case "future_source_time": "来源时间晚于当前时间"
            case "unfrozen_revision": "当前修订尚未冻结"
            case "pack_integrity_failure": "证据包完整性失败"
            case "report_pack_mismatch": "报告与证据包不一致"
            case "historical_evidence_pack": "证据包已历史化"
            case "holding_snapshot_stale": "持仓快照已过期"
            case "holding_snapshot_conflict": "持仓快照存在冲突"
            default: code
            }
        }.joined(separator: "、")
    }

    public var recoveryDestination: TodayResearchSourceRecoveryDestination {
        if issueCodes.contains(where: {
            ["missing_materials", "stale_materials", "conflicting_materials", "unverified_materials",
             "unauthorized_rights", "future_source_time"].contains($0)
        }) { return .documents }
        if issueCodes.contains(where: { ["holding_snapshot_stale", "holding_snapshot_conflict"].contains($0) }) {
            return .portfolio
        }
        if issueCodes.contains("report_pack_mismatch") { return .report }
        return .frozenEvidence
    }

    fileprivate func validateForDisplay(envelopeStatus: TodayResearchStatus, errors: inout [String]) {
        if validFingerprint(id) == false || issueCodes.count > Self.allowedIssues.count
            || Set(issueCodes).count != issueCodes.count
            || issueCodes.contains(where: { Self.allowedIssues.contains($0) == false }) {
            errors.append("Today source-health identity or issues are invalid")
        }
        if totalMaterialCount < 0 || currentMaterialCount < 0 || currentMaterialCount > totalMaterialCount {
            errors.append("Today source-health material counts are invalid")
        }
        let derivedStatus: TodayResearchSourceHealthStatus =
            issueCodes.contains("conflicting_materials") || issueCodes.contains("holding_snapshot_conflict") ? .conflict
            : issueCodes.contains("stale_materials") || issueCodes.contains("holding_snapshot_stale") ? .stale
            : issueCodes.contains("unauthorized_rights") ? .rightsBlocked
            : issueCodes.contains("unverified_materials") || issueCodes.contains("future_source_time") ? .verificationBlocked
            : issueCodes.contains(where: { ["unfrozen_revision", "pack_integrity_failure", "report_pack_mismatch", "historical_evidence_pack"].contains($0) }) ? .revisionMismatch
            : issueCodes.contains("missing_materials") ? .missing : .healthy
        if status != derivedStatus {
            errors.append("Today source-health status does not match issue precedence")
        }
        let expectedEnvelope: TodayResearchStatus = status == .stale ? .stale : status == .conflict ? .conflict : .available
        if envelopeStatus != expectedEnvelope {
            errors.append("Today source-health status does not match envelope status")
        }
        evidencePackRef?.validateForDisplay(errors: &errors)
    }
}

public struct TodayResearchStructure: Codable, Equatable, Sendable {
    public let id: String
    public let status: String
    public let checks: [TodayResearchStructureCheck]
    public let gateFailures: [String]
    public let reportRef: TodayResearchReportRef?

    private static let expectedCheckIds = [
        "frozen_source_integrity", "research_question_and_cutoff", "investment_thesis",
        "fact_table_and_sources", "support_evidence", "counter_evidence", "source_conflicts",
        "unknown_items", "key_drivers_and_causal_chain", "valuation_or_implied_expectations",
        "invalidation_conditions", "change_from_previous", "portfolio_impact",
        "next_validation_questions", "model_inferences"
    ]

    fileprivate func validateForDisplay(errors: inout [String]) {
        if validFingerprint(id) == false || ["not_started", "blocked", "passed"].contains(status) == false
            || checks.map(\.id) != Self.expectedCheckIds || gateFailures.count > 250
            || gateFailures.contains(where: { boundedText($0, 4_000) == false }) {
            errors.append("Today research-structure measurement is invalid")
        }
        reportRef?.validateForDisplay(errors: &errors)
        let passedCount = checks.filter(\.passed).count
        if status == "not_started" && (reportRef != nil || passedCount != 0 || gateFailures.isEmpty == false)
            || status == "passed" && (reportRef?.status != "complete_pending_confirmation"
                || passedCount != Self.expectedCheckIds.count || gateFailures.isEmpty == false)
            || status == "blocked" && (reportRef == nil || passedCount == Self.expectedCheckIds.count || gateFailures.isEmpty) {
            errors.append("Today research-structure status does not match its report")
        }
    }
}

public struct TodayResearchStructureCheck: Codable, Equatable, Sendable {
    public let id: String
    public let passed: Bool
}

public struct TodayResearchSecondOpinion: Codable, Equatable, Sendable {
    public let status: String
    public let dependencyIncluded: Bool
    public let reason: String

    fileprivate func validateForDisplay(errors: inout [String]) {
        if status != "not_evaluated" || dependencyIncluded || boundedText(reason, 1_000) == false {
            errors.append("Today optional second-opinion state is invalid")
        }
    }
}
