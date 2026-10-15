import Foundation

public enum AssistReviewFollowUpWorkflowStatus: String, Codable, Equatable, Sendable {
    case available
    case blockedWorkspace = "blocked_workspace"
    case notFound = "not_found"
    case unauthorized
    case unavailable
    case malformed
}

public enum AssistReviewFollowUpWorkflowStepID: String, Codable, Equatable, Sendable {
    case inspectWorkspaceReadiness = "inspect_workspace_readiness"
    case reviewEvidenceGaps = "review_evidence_gaps"
    case draftLocalReviewNote = "draft_local_review_note"
    case setLaterReviewIntent = "set_later_review_intent"
    case stopDueToBlockedWorkspace = "stop_due_to_blocked_workspace"
}

public enum AssistReviewFollowUpWorkflowIntentID: String, Codable, Equatable, Sendable {
    case manualNoteDraft = "manual_note_draft"
    case laterReviewDraft = "later_review_draft"
    case evidenceGapChecklist = "evidence_gap_checklist"
}

public enum AssistReviewFollowUpWorkflowValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct AssistReviewFollowUpWorkflowEnvelope: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-05.assist-1.local-review-followup-workflow.v1"

    public let schemaVersion: String
    public let generatedAt: String
    public let status: AssistReviewFollowUpWorkflowStatus
    public let target: AssistReviewFollowUpWorkflowTarget
    public let workspaceRef: AssistReviewFollowUpWorkflowWorkspaceRef
    public let sourceWorkspaceRef: AssistReviewFollowUpWorkflowWorkspaceRef
    public let reviewState: String
    public let followUpState: String
    public let manualNoteDraft: AssistReviewFollowUpWorkflowIntent?
    public let laterReviewIntent: AssistReviewFollowUpWorkflowIntent?
    public let evidenceGaps: [String]
    public let unresolvedEvidenceGaps: [String]
    public let suggestedLocalViews: [String]
    public let localNextViews: [String]
    public let blockedExternalActions: [String]
    public let steps: [AssistReviewFollowUpWorkflowStep]
    public let intents: [AssistReviewFollowUpWorkflowIntent]
    public let failClosed: AssistReviewFollowUpWorkflowFailClosed
    public let safety: AssistReviewFollowUpWorkflowSafety
    public let provenance: AssistReviewFollowUpWorkflowProvenance
    public let message: String

    public static func unavailable(_ message: String, membershipId: String) -> AssistReviewFollowUpWorkflowEnvelope {
        let now = ISO8601DateFormatter().string(from: Date())
        let workspaceRef = AssistReviewFollowUpWorkflowWorkspaceRef(
            schemaVersion: AssistHumanReviewWorkspaceEnvelope.schemaVersionV1,
            route: "/api/mobile/research/candidate-memberships/:id/human-review-workspace",
            status: "unavailable",
            readinessId: "blocked_unavailable",
            generatedAt: now
        )
        return AssistReviewFollowUpWorkflowEnvelope(
            schemaVersion: schemaVersionV1,
            generatedAt: now,
            status: .unavailable,
            target: AssistReviewFollowUpWorkflowTarget(market: "HK", code: "00000", symbol: "HK.00000", candidateMembershipId: membershipId),
            workspaceRef: workspaceRef,
            sourceWorkspaceRef: workspaceRef,
            reviewState: "fail_closed",
            followUpState: "fail_closed",
            manualNoteDraft: nil,
            laterReviewIntent: nil,
            evidenceGaps: ["Follow-up workflow is unavailable."],
            unresolvedEvidenceGaps: ["Follow-up workflow is unavailable."],
            suggestedLocalViews: ["Stop due to blocked workspace."],
            localNextViews: ["Stop due to blocked workspace."],
            blockedExternalActions: ["No execution orders", "No account or broker calls", "No live holdings sync", "No portfolio mutation", "No persisted note write in this PR", "No production release"],
            steps: [
                AssistReviewFollowUpWorkflowStep(
                    id: .stopDueToBlockedWorkspace,
                    label: "Stop because workspace is blocked",
                    description: "Do not draft local follow-up until a valid human-review workspace is loaded.",
                    enabled: true,
                    disabledReason: nil,
                    localOnly: true,
                    persists: false,
                    allowedInterpretation: "Use this as a client-local manual review workflow step only.",
                    forbiddenInterpretation: "Do not treat this as investment advice, execution authority, account authority, broker truth, or production readiness."
                )
            ],
            intents: [],
            failClosed: AssistReviewFollowUpWorkflowFailClosed(active: true, reason: message, clearsDraft: true, noStaleWorkspaceFacts: true, noPartialDraftPersistence: true),
            safety: .safe(),
            provenance: .safe(),
            message: message
        )
    }

    public func validateForDisplay() throws {
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionV1 {
            errors.append("schemaVersion must be \(Self.schemaVersionV1)")
        }
        if !isAssistReviewFollowUpWorkflowDateTime(generatedAt) {
            errors.append("generatedAt must be a valid date-time")
        }
        target.validate(errors: &errors)
        workspaceRef.validate(label: "workspaceRef", errors: &errors)
        sourceWorkspaceRef.validate(label: "sourceWorkspaceRef", errors: &errors)
        if reviewState.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("reviewState is required")
        }
        if followUpState.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("followUpState is required")
        }
        manualNoteDraft?.validate(errors: &errors)
        laterReviewIntent?.validate(errors: &errors)
        if let manualNoteDraft, manualNoteDraft.id != .manualNoteDraft {
            errors.append("manualNoteDraft.id must be manual_note_draft")
        }
        if let laterReviewIntent, laterReviewIntent.id != .laterReviewDraft {
            errors.append("laterReviewIntent.id must be later_review_draft")
        }
        validateNonEmptyStrings(evidenceGaps, field: "evidenceGaps", errors: &errors)
        validateNonEmptyStrings(unresolvedEvidenceGaps, field: "unresolvedEvidenceGaps", errors: &errors)
        validateNonEmptyStrings(suggestedLocalViews, field: "suggestedLocalViews", errors: &errors)
        validateNonEmptyStrings(localNextViews, field: "localNextViews", errors: &errors)
        validateNonEmptyStrings(blockedExternalActions, field: "blockedExternalActions", errors: &errors)
        steps.forEach { $0.validate(errors: &errors) }
        intents.forEach { $0.validate(errors: &errors) }
        failClosed.validate(errors: &errors)
        safety.validate(errors: &errors)
        provenance.validate(errors: &errors)
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("message is required")
        }
        validateStatusSemantics(errors: &errors)
        if !errors.isEmpty {
            throw AssistReviewFollowUpWorkflowValidationError.invalid(errors)
        }
    }

    private func validateStatusSemantics(errors: inout [String]) {
        switch status {
        case .available, .blockedWorkspace:
            if failClosed.active {
                errors.append("available and blocked workspace workflows must not mark failClosed.active true")
            }
            if manualNoteDraft == nil || laterReviewIntent == nil {
                errors.append("available and blocked workspace workflows must expose local draft intent metadata")
            }
        case .notFound, .unauthorized, .unavailable, .malformed:
            if steps.contains(where: { $0.id != .stopDueToBlockedWorkspace }) {
                errors.append("fail-closed workflow can only expose the blocked stop step")
            }
            if !intents.isEmpty {
                errors.append("fail-closed workflow must not expose draft intents")
            }
            if manualNoteDraft != nil || laterReviewIntent != nil {
                errors.append("fail-closed workflow must not expose usable draft intent metadata")
            }
            if !failClosed.active {
                errors.append("fail-closed workflow must mark failClosed.active true")
            }
        }
    }
}

public struct AssistReviewFollowUpWorkflowTarget: Codable, Equatable, Sendable {
    public let market: String
    public let code: String
    public let symbol: String
    public let candidateMembershipId: String?

    fileprivate func validate(errors: inout [String]) {
        if market != "HK" {
            errors.append("target.market must be HK")
        }
        if code.range(of: #"^\d{5}$"#, options: .regularExpression) == nil {
            errors.append("target.code must be a canonical five-digit Hong Kong code")
        }
        if symbol != "HK.\(code)" {
            errors.append("target.symbol must match HK.<code>")
        }
        if let candidateMembershipId, candidateMembershipId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("target.candidateMembershipId must be non-empty when present")
        }
    }
}

public struct AssistReviewFollowUpWorkflowWorkspaceRef: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let route: String
    public let status: String
    public let readinessId: String
    public let generatedAt: String

    fileprivate func validate(label: String, errors: inout [String]) {
        if schemaVersion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(label).schemaVersion is required")
        }
        if route != "/api/mobile/research/candidate-memberships/:id/human-review-workspace" {
            errors.append("\(label).route is invalid")
        }
        for (field, value) in [("\(label).status", status), ("\(label).readinessId", readinessId)] where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(field) is required")
        }
        if !isAssistReviewFollowUpWorkflowDateTime(generatedAt) {
            errors.append("\(label).generatedAt must be a valid date-time")
        }
    }
}

public struct AssistReviewFollowUpWorkflowStep: Codable, Equatable, Sendable {
    public let id: AssistReviewFollowUpWorkflowStepID
    public let label: String
    public let description: String
    public let enabled: Bool
    public let disabledReason: String?
    public let localOnly: Bool
    public let persists: Bool
    public let allowedInterpretation: String
    public let forbiddenInterpretation: String

    fileprivate func validate(errors: inout [String]) {
        for (field, value) in [
            ("step.label", label),
            ("step.description", description),
            ("step.allowedInterpretation", allowedInterpretation),
            ("step.forbiddenInterpretation", forbiddenInterpretation)
        ] where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(field) is required")
        }
        if let disabledReason, disabledReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("step.disabledReason must be non-empty when present")
        }
        if !localOnly || persists {
            errors.append("steps must stay local-only and non-persistent")
        }
    }
}

public struct AssistReviewFollowUpWorkflowIntent: Codable, Equatable, Sendable {
    public let id: AssistReviewFollowUpWorkflowIntentID
    public let label: String
    public let placeholder: String
    public let draftValue: String?
    public let localOnly: Bool
    public let persists: Bool
    public let maxLength: Int
    public let allowedInterpretation: String
    public let forbiddenInterpretation: String

    fileprivate func validate(errors: inout [String]) {
        for (field, value) in [
            ("intent.label", label),
            ("intent.placeholder", placeholder),
            ("intent.allowedInterpretation", allowedInterpretation),
            ("intent.forbiddenInterpretation", forbiddenInterpretation)
        ] where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(field) is required")
        }
        if draftValue != nil {
            errors.append("intent.draftValue must be nil in API envelopes")
        }
        if !localOnly || persists {
            errors.append("intents must stay local-only and non-persistent")
        }
        if maxLength < 1 || maxLength > 2000 {
            errors.append("intent.maxLength is invalid")
        }
    }
}

public struct AssistReviewFollowUpWorkflowFailClosed: Codable, Equatable, Sendable {
    public let active: Bool
    public let reason: String?
    public let clearsDraft: Bool
    public let noStaleWorkspaceFacts: Bool
    public let noPartialDraftPersistence: Bool

    fileprivate func validate(errors: inout [String]) {
        if let reason, reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("failClosed.reason must be non-empty when present")
        }
        if !clearsDraft || !noStaleWorkspaceFacts || !noPartialDraftPersistence {
            errors.append("failClosed must clear drafts and block stale or partial draft persistence")
        }
    }
}

public struct AssistReviewFollowUpWorkflowProvenance: Codable, Equatable, Sendable {
    public let sourceWorkspace: String
    public let draftStorage: String
    public let persistence: String
    public let runtime: String
    public let externalAccounts: String
    public let portfolio: String

    public static func safe() -> AssistReviewFollowUpWorkflowProvenance {
        AssistReviewFollowUpWorkflowProvenance(
            sourceWorkspace: "assist_human_review_workspace_v1",
            draftStorage: "client_memory_only",
            persistence: "omitted",
            runtime: "repository_local_only",
            externalAccounts: "omitted",
            portfolio: "omitted"
        )
    }

    fileprivate func validate(errors: inout [String]) {
        if sourceWorkspace != "assist_human_review_workspace_v1" {
            errors.append("provenance.sourceWorkspace is invalid")
        }
        if draftStorage != "client_memory_only" {
            errors.append("provenance.draftStorage must be client_memory_only")
        }
        if persistence != "omitted" || runtime != "repository_local_only" || externalAccounts != "omitted" || portfolio != "omitted" {
            errors.append("follow-up provenance must omit persistence, external accounts, and portfolio while staying repository-local")
        }
    }
}

public struct AssistReviewFollowUpWorkflowSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let manualReviewOnly: Bool
    public let localDraftOnly: Bool
    public let noPersistence: Bool
    public let noRecommendation: Bool
    public let noRanking: Bool
    public let noScoring: Bool
    public let noBuySellHold: Bool
    public let noOrder: Bool
    public let noTrade: Bool
    public let noFill: Bool
    public let noBroker: Bool
    public let noPortfolioMutation: Bool
    public let noCashMutation: Bool
    public let noFeeMutation: Bool
    public let noPositionMutation: Bool
    public let noProductionClaim: Bool

    public static func safe() -> AssistReviewFollowUpWorkflowSafety {
        AssistReviewFollowUpWorkflowSafety(
            advisoryOnly: true,
            manualReviewOnly: true,
            localDraftOnly: true,
            noPersistence: true,
            noRecommendation: true,
            noRanking: true,
            noScoring: true,
            noBuySellHold: true,
            noOrder: true,
            noTrade: true,
            noFill: true,
            noBroker: true,
            noPortfolioMutation: true,
            noCashMutation: true,
            noFeeMutation: true,
            noPositionMutation: true,
            noProductionClaim: true
        )
    }

    fileprivate func validate(errors: inout [String]) {
        if !advisoryOnly || !manualReviewOnly || !localDraftOnly || !noPersistence || !noRecommendation || !noRanking || !noScoring || !noBuySellHold || !noOrder || !noTrade || !noFill || !noBroker || !noPortfolioMutation || !noCashMutation || !noFeeMutation || !noPositionMutation || !noProductionClaim {
            errors.append("follow-up workflow safety flags must all be true")
        }
    }
}

public struct AssistReviewFollowUpDrafts: Equatable, Sendable {
    public var manualNote: String
    public var laterReview: String
    public var evidenceGapChecklist: String

    public static let empty = AssistReviewFollowUpDrafts(manualNote: "", laterReview: "", evidenceGapChecklist: "")
}

public struct AssistReviewFollowUpWorkflowRenderModel: Equatable, Sendable {
    public let state: String
    public let membershipId: String?
    public let symbol: String?
    public let title: String
    public let message: String
    public let reviewState: String?
    public let steps: [String]
    public let intents: [String]
    public let evidenceGaps: [String]
    public let suggestedLocalViews: [String]
    public let blockedExternalActions: [String]
    public let draftSummary: [String]
    public let safety: [String]
    public let failClosedExplanation: [String]
    public let generatedAt: String?
}

public func assistReviewFollowUpWorkflowRenderModel(from envelope: AssistReviewFollowUpWorkflowEnvelope, drafts: AssistReviewFollowUpDrafts = .empty) -> AssistReviewFollowUpWorkflowRenderModel {
    let state = assistReviewFollowUpWorkflowDisplayState(envelope)
    guard envelope.status == .available || envelope.status == .blockedWorkspace else {
        return assistReviewFollowUpWorkflowFailClosedModel(
            state: state,
            message: envelope.message,
            membershipId: envelope.target.candidateMembershipId
        )
    }
    return AssistReviewFollowUpWorkflowRenderModel(
        state: state,
        membershipId: envelope.target.candidateMembershipId,
        symbol: envelope.target.symbol,
        title: assistReviewFollowUpWorkflowTitle(state: state),
        message: envelope.message,
        reviewState: envelope.followUpState,
        steps: envelope.steps.map { "\($0.label) [enabled=\($0.enabled); localOnly=\($0.localOnly); persists=\($0.persists)]：\($0.description)" },
        intents: envelope.intents.map { "\($0.label) [localOnly=\($0.localOnly); persists=\($0.persists); max=\($0.maxLength)]：\($0.placeholder)" },
        evidenceGaps: envelope.unresolvedEvidenceGaps,
        suggestedLocalViews: envelope.localNextViews,
        blockedExternalActions: envelope.blockedExternalActions,
        draftSummary: assistReviewFollowUpDraftSummary(drafts),
        safety: [
            "仅辅助、仅人工复核、仅本地草稿、不持久化；草稿存储：\(envelope.provenance.draftStorage)。",
            "安全证明阻止推荐、排序、评分、执行、账户、券商、组合、现金、费用、持仓和生产权限。"
        ],
        failClosedExplanation: [
            "failClosed=\(envelope.failClosed.active)；clearsDraft=\(envelope.failClosed.clearsDraft)；noStaleWorkspaceFacts=\(envelope.failClosed.noStaleWorkspaceFacts)",
            "新请求失败时旧 workflow 事实和本地草稿会清空。"
        ],
        generatedAt: envelope.generatedAt
    )
}

public func assistReviewFollowUpWorkflowFailClosedModel(state: String, message: String, membershipId: String? = nil) -> AssistReviewFollowUpWorkflowRenderModel {
    AssistReviewFollowUpWorkflowRenderModel(
        state: state,
        membershipId: membershipId,
        symbol: nil,
        title: assistReviewFollowUpWorkflowTitle(state: state),
        message: message,
        reviewState: nil,
        steps: [],
        intents: [],
        evidenceGaps: [],
        suggestedLocalViews: [],
        blockedExternalActions: [],
        draftSummary: [],
        safety: [],
        failClosedExplanation: [
            "\(state)：\(message)",
            "未展示旧 workflow 事实、本地草稿、投资建议或交易语义。"
        ],
        generatedAt: nil
    )
}

public func assistReviewFollowUpDraftSummary(_ drafts: AssistReviewFollowUpDrafts) -> [String] {
    [
        drafts.manualNote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "本地备忘草稿为空。" : "本地备忘草稿：\(drafts.manualNote)",
        drafts.laterReview.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "稍后复核草稿为空。" : "稍后复核草稿：\(drafts.laterReview)",
        drafts.evidenceGapChecklist.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "证据缺口清单草稿为空。" : "证据缺口清单草稿：\(drafts.evidenceGapChecklist)",
        "草稿仅保存在当前客户端状态，不是官方复核记录，不持久化，不发送；失败关闭时清空。"
    ]
}

private func assistReviewFollowUpWorkflowDisplayState(_ envelope: AssistReviewFollowUpWorkflowEnvelope) -> String {
    switch envelope.status {
    case .notFound:
        return "not_found"
    case .unauthorized:
        return "unauthorized"
    case .unavailable:
        return "unavailable"
    case .malformed:
        return "malformed"
    case .blockedWorkspace:
        return "blocked"
    case .available:
        return envelope.steps.contains(where: { $0.id == .stopDueToBlockedWorkspace && $0.enabled }) ? "blocked" : "available"
    }
}

private func validateNonEmptyStrings(_ values: [String], field: String, errors: inout [String]) {
    if values.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
        errors.append("\(field) must contain only non-empty strings")
    }
}

private func assistReviewFollowUpWorkflowTitle(state: String) -> String {
    switch state {
    case "available":
        return "复核后续 workflow 可用"
    case "blocked":
        return "复核后续 workflow 阻止继续"
    case "unauthorized":
        return "读取未授权"
    case "not_found":
        return "成员不存在"
    case "malformed":
        return "workflow 响应无效"
    default:
        return "复核后续 workflow 不可用"
    }
}

private func isAssistReviewFollowUpWorkflowDateTime(_ value: String) -> Bool {
    Date.parseAssistReviewFollowUpWorkflowIso8601(value) != nil
}

private extension Date {
    static func parseAssistReviewFollowUpWorkflowIso8601(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) {
            return date
        }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }
}
