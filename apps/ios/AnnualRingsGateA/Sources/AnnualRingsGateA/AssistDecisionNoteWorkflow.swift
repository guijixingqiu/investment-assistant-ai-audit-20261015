import Foundation

public enum AssistDecisionNoteWorkflowStatus: String, Codable, Equatable, Sendable {
    case available
    case blockedFollowUp = "blocked_follow_up"
    case notFound = "not_found"
    case unauthorized
    case unavailable
    case malformed
}

public enum AssistDecisionNoteWorkflowStepID: String, Codable, Equatable, Sendable {
    case inspectSourceWorkspace = "inspect_source_workspace"
    case inspectFollowUpWorkflow = "inspect_follow_up_workflow"
    case draftLocalDecisionNote = "draft_local_decision_note"
    case reviewFactReferences = "review_fact_references"
    case reviewEvidenceGaps = "review_evidence_gaps"
    case setLaterReviewEntry = "set_later_review_entry"
    case stopDueToUnavailableSource = "stop_due_to_unavailable_source"
}

public enum AssistDecisionNoteWorkflowValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct AssistDecisionNoteWorkflowEnvelope: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-05.assist-1.local-decision-note-workflow.v1"

    public let schemaVersion: String
    public let generatedAt: String
    public let status: AssistDecisionNoteWorkflowStatus
    public let target: AssistDecisionNoteWorkflowTarget
    public let sourceWorkspaceRef: AssistDecisionNoteWorkflowSourceRef
    public let sourceFollowUpWorkflowRef: AssistDecisionNoteWorkflowSourceRef
    public let noteState: String
    public let decisionNoteDraft: AssistDecisionNoteWorkflowDraft?
    public let factReferences: [AssistDecisionNoteWorkflowFactReference]
    public let unresolvedEvidenceGaps: [String]
    public let laterReviewEntry: String?
    public let blockedExternalActions: [String]
    public let steps: [AssistDecisionNoteWorkflowStep]
    public let failClosed: AssistDecisionNoteWorkflowFailClosed
    public let safety: AssistDecisionNoteWorkflowSafety
    public let provenance: AssistDecisionNoteWorkflowProvenance
    public let message: String

    public static func unavailable(_ message: String, membershipId: String) -> AssistDecisionNoteWorkflowEnvelope {
        let now = ISO8601DateFormatter().string(from: Date())
        return AssistDecisionNoteWorkflowEnvelope(
            schemaVersion: schemaVersionV1,
            generatedAt: now,
            status: .unavailable,
            target: AssistDecisionNoteWorkflowTarget(market: "HK", code: "00000", symbol: "HK.00000", candidateMembershipId: membershipId),
            sourceWorkspaceRef: AssistDecisionNoteWorkflowSourceRef(
                schemaVersion: AssistHumanReviewWorkspaceEnvelope.schemaVersionV1,
                route: "/api/mobile/research/candidate-memberships/:id/human-review-workspace",
                status: "unavailable",
                generatedAt: now
            ),
            sourceFollowUpWorkflowRef: AssistDecisionNoteWorkflowSourceRef(
                schemaVersion: AssistReviewFollowUpWorkflowEnvelope.schemaVersionV1,
                route: "/api/mobile/research/candidate-memberships/:id/human-review-workspace/follow-up-workflow",
                status: "unavailable",
                generatedAt: now
            ),
            noteState: "fail_closed",
            decisionNoteDraft: nil,
            factReferences: [],
            unresolvedEvidenceGaps: [],
            laterReviewEntry: nil,
            blockedExternalActions: [
                "No execution orders",
                "No account or broker calls",
                "No live holdings sync",
                "No portfolio mutation",
                "No persisted note write",
                "No official review record",
                "No production release"
            ],
            steps: [
                AssistDecisionNoteWorkflowStep(
                    id: .stopDueToUnavailableSource,
                    label: "Stop because source workflow is unavailable",
                    description: "Do not draft a local decision note until source facts can be loaded.",
                    enabled: true,
                    disabledReason: nil,
                    localOnly: true,
                    persists: false,
                    allowedInterpretation: "Use this as a client-local decision note workflow step only.",
                    forbiddenInterpretation: "Do not treat this as investment advice, execution authority, account authority, broker truth, portfolio authority, or production readiness."
                )
            ],
            failClosed: AssistDecisionNoteWorkflowFailClosed(active: true, reason: message, clearsDraft: true, noStaleFacts: true, noStaleDraft: true, noPartialFacts: true, noUsableStaleReferences: true),
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
        if !isAssistDecisionNoteWorkflowDateTime(generatedAt) {
            errors.append("generatedAt must be a valid date-time")
        }
        target.validate(errors: &errors)
        sourceWorkspaceRef.validate(label: "sourceWorkspaceRef", errors: &errors)
        sourceFollowUpWorkflowRef.validate(label: "sourceFollowUpWorkflowRef", errors: &errors)
        if noteState.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("noteState is required")
        }
        decisionNoteDraft?.validate(errors: &errors)
        factReferences.forEach { $0.validate(errors: &errors) }
        validateNonEmptyStrings(unresolvedEvidenceGaps, field: "unresolvedEvidenceGaps", errors: &errors)
        if let laterReviewEntry, laterReviewEntry.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("laterReviewEntry must be non-empty when present")
        }
        validateNonEmptyStrings(blockedExternalActions, field: "blockedExternalActions", errors: &errors)
        steps.forEach { $0.validate(errors: &errors) }
        failClosed.validate(errors: &errors)
        safety.validate(errors: &errors)
        provenance.validate(errors: &errors)
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("message is required")
        }
        validateStatusSemantics(errors: &errors)
        if !errors.isEmpty {
            throw AssistDecisionNoteWorkflowValidationError.invalid(errors)
        }
    }

    private func validateStatusSemantics(errors: inout [String]) {
        switch status {
        case .available, .blockedFollowUp:
            if failClosed.active {
                errors.append("available or blocked decision note workflow must not mark failClosed active")
            }
            if decisionNoteDraft == nil {
                errors.append("available or blocked decision note workflow requires local draft metadata")
            }
        case .notFound, .unauthorized, .unavailable, .malformed:
            if decisionNoteDraft != nil {
                errors.append("fail-closed decision note workflow must not expose a draft")
            }
            if !factReferences.isEmpty || laterReviewEntry != nil {
                errors.append("fail-closed decision note workflow must not expose fact references or later-review entry")
            }
            if !failClosed.active {
                errors.append("fail-closed decision note workflow must mark failClosed active")
            }
        }
    }
}

public struct AssistDecisionNoteWorkflowTarget: Codable, Equatable, Sendable {
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

public struct AssistDecisionNoteWorkflowSourceRef: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let route: String
    public let status: String
    public let generatedAt: String

    fileprivate func validate(label: String, errors: inout [String]) {
        for (field, value) in [
            ("\(label).schemaVersion", schemaVersion),
            ("\(label).route", route),
            ("\(label).status", status)
        ] where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(field) is required")
        }
        if !isAssistDecisionNoteWorkflowDateTime(generatedAt) {
            errors.append("\(label).generatedAt must be a valid date-time")
        }
    }
}

public struct AssistDecisionNoteWorkflowDraft: Codable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let placeholder: String
    public let draftValue: String?
    public let localOnly: Bool
    public let officialRecord: Bool
    public let persists: Bool
    public let sent: Bool
    public let maxLength: Int
    public let allowedInterpretation: String
    public let forbiddenInterpretation: String

    fileprivate func validate(errors: inout [String]) {
        if id != "decision_note_draft" {
            errors.append("decisionNoteDraft.id must be decision_note_draft")
        }
        for (field, value) in [
            ("decisionNoteDraft.label", label),
            ("decisionNoteDraft.placeholder", placeholder),
            ("decisionNoteDraft.allowedInterpretation", allowedInterpretation),
            ("decisionNoteDraft.forbiddenInterpretation", forbiddenInterpretation)
        ] where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(field) is required")
        }
        if draftValue != nil {
            errors.append("decisionNoteDraft.draftValue must be nil in API envelopes")
        }
        if !localOnly || officialRecord || persists || sent {
            errors.append("decision note draft must be local-only, unofficial, non-persistent, and unsent")
        }
        if maxLength < 1 || maxLength > 4000 {
            errors.append("decisionNoteDraft.maxLength is invalid")
        }
    }
}

public struct AssistDecisionNoteWorkflowFactReference: Codable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let source: String
    public let summary: String
    public let localOnly: Bool
    public let available: Bool

    fileprivate func validate(errors: inout [String]) {
        for (field, value) in [
            ("factReference.id", id),
            ("factReference.label", label),
            ("factReference.summary", summary)
        ] where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(field) is required")
        }
        if !["human_review_workspace", "review_follow_up_workflow", "safety_boundary"].contains(source) {
            errors.append("factReference.source is invalid")
        }
        if !localOnly {
            errors.append("factReference must be local-only")
        }
    }
}

public struct AssistDecisionNoteWorkflowStep: Codable, Equatable, Sendable {
    public let id: AssistDecisionNoteWorkflowStepID
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

public struct AssistDecisionNoteWorkflowFailClosed: Codable, Equatable, Sendable {
    public let active: Bool
    public let reason: String?
    public let clearsDraft: Bool
    public let noStaleFacts: Bool
    public let noStaleDraft: Bool
    public let noPartialFacts: Bool
    public let noUsableStaleReferences: Bool

    fileprivate func validate(errors: inout [String]) {
        if let reason, reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("failClosed.reason must be non-empty when present")
        }
        if !clearsDraft || !noStaleFacts || !noStaleDraft || !noPartialFacts || !noUsableStaleReferences {
            errors.append("failClosed must clear drafts, stale facts, and stale references")
        }
    }
}

public struct AssistDecisionNoteWorkflowSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let manualReviewOnly: Bool
    public let localDraftOnly: Bool
    public let noOfficialRecord: Bool
    public let noPersistence: Bool
    public let notSent: Bool
    public let noRecommendation: Bool
    public let noRanking: Bool
    public let noScoring: Bool
    public let noBuySellHold: Bool
    public let noTiming: Bool
    public let noTargetPrice: Bool
    public let noStopLoss: Bool
    public let noTakeProfit: Bool
    public let noExpectedReturn: Bool
    public let noSizing: Bool
    public let noAllocation: Bool
    public let noOrder: Bool
    public let noTrade: Bool
    public let noFill: Bool
    public let noBroker: Bool
    public let noPortfolioMutation: Bool
    public let noCashMutation: Bool
    public let noFeeMutation: Bool
    public let noPositionMutation: Bool
    public let noProductionClaim: Bool

    public static func safe() -> AssistDecisionNoteWorkflowSafety {
        AssistDecisionNoteWorkflowSafety(
            advisoryOnly: true,
            manualReviewOnly: true,
            localDraftOnly: true,
            noOfficialRecord: true,
            noPersistence: true,
            notSent: true,
            noRecommendation: true,
            noRanking: true,
            noScoring: true,
            noBuySellHold: true,
            noTiming: true,
            noTargetPrice: true,
            noStopLoss: true,
            noTakeProfit: true,
            noExpectedReturn: true,
            noSizing: true,
            noAllocation: true,
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
        let flags = [
            advisoryOnly,
            manualReviewOnly,
            localDraftOnly,
            noOfficialRecord,
            noPersistence,
            notSent,
            noRecommendation,
            noRanking,
            noScoring,
            noBuySellHold,
            noTiming,
            noTargetPrice,
            noStopLoss,
            noTakeProfit,
            noExpectedReturn,
            noSizing,
            noAllocation,
            noOrder,
            noTrade,
            noFill,
            noBroker,
            noPortfolioMutation,
            noCashMutation,
            noFeeMutation,
            noPositionMutation,
            noProductionClaim
        ]
        if flags.contains(false) {
            errors.append("decision note workflow safety flags must all be true")
        }
    }
}

public struct AssistDecisionNoteWorkflowProvenance: Codable, Equatable, Sendable {
    public let sourceWorkspace: String
    public let sourceFollowUpWorkflow: String
    public let draftStorage: String
    public let persistence: String
    public let runtime: String
    public let externalAccounts: String
    public let portfolio: String

    public static func safe() -> AssistDecisionNoteWorkflowProvenance {
        AssistDecisionNoteWorkflowProvenance(
            sourceWorkspace: "assist_human_review_workspace_v1",
            sourceFollowUpWorkflow: "assist_review_followup_workflow_v1",
            draftStorage: "client_memory_only",
            persistence: "omitted",
            runtime: "repository_local_only",
            externalAccounts: "omitted",
            portfolio: "omitted"
        )
    }

    fileprivate func validate(errors: inout [String]) {
        if sourceWorkspace != "assist_human_review_workspace_v1" || sourceFollowUpWorkflow != "assist_review_followup_workflow_v1" {
            errors.append("decision note provenance source is invalid")
        }
        if draftStorage != "client_memory_only" || persistence != "omitted" || runtime != "repository_local_only" || externalAccounts != "omitted" || portfolio != "omitted" {
            errors.append("decision note provenance must be client-memory-only, non-persistent, repository-local, and omit external accounts and portfolio")
        }
    }
}

public struct AssistDecisionNoteDrafts: Equatable, Sendable {
    public var decisionNote: String

    public static let empty = AssistDecisionNoteDrafts(decisionNote: "")
}

public struct AssistDecisionNoteWorkflowRenderModel: Equatable, Sendable {
    public let state: String
    public let membershipId: String?
    public let symbol: String?
    public let title: String
    public let message: String
    public let noteState: String?
    public let factReferences: [String]
    public let unresolvedEvidenceGaps: [String]
    public let laterReviewEntry: [String]
    public let blockedExternalActions: [String]
    public let draftSummary: [String]
    public let safety: [String]
    public let failClosedExplanation: [String]
    public let generatedAt: String?
}

public func assistDecisionNoteWorkflowRenderModel(from envelope: AssistDecisionNoteWorkflowEnvelope, drafts: AssistDecisionNoteDrafts = .empty) -> AssistDecisionNoteWorkflowRenderModel {
    let state = assistDecisionNoteWorkflowDisplayState(envelope)
    guard envelope.status == .available || envelope.status == .blockedFollowUp else {
        return assistDecisionNoteWorkflowFailClosedModel(
            state: state,
            message: envelope.message,
            membershipId: envelope.target.candidateMembershipId
        )
    }
    return AssistDecisionNoteWorkflowRenderModel(
        state: state,
        membershipId: envelope.target.candidateMembershipId,
        symbol: envelope.target.symbol,
        title: assistDecisionNoteWorkflowTitle(state: state),
        message: envelope.message,
        noteState: envelope.noteState,
        factReferences: envelope.factReferences.map { "\($0.label) [source=\($0.source); available=\($0.available)]：\($0.summary)" },
        unresolvedEvidenceGaps: envelope.unresolvedEvidenceGaps,
        laterReviewEntry: [envelope.laterReviewEntry ?? "稍后复核入口仅为本地显示意图，不持久化。"],
        blockedExternalActions: envelope.blockedExternalActions,
        draftSummary: assistDecisionNoteDraftSummary(drafts),
        safety: [
            "仅辅助、仅人工复核、仅本地草稿、不是官方记录、不持久化、不发送；草稿存储：\(envelope.provenance.draftStorage)。",
            "安全证明阻止推荐、排序、评分、买卖持有、择时、目标价、止损、止盈、预期收益、仓位、配置、订单、成交、券商、组合、现金、费用、持仓和生产权限。"
        ],
        failClosedExplanation: [
            "failClosed=\(envelope.failClosed.active)；clearsDraft=\(envelope.failClosed.clearsDraft)；noStaleFacts=\(envelope.failClosed.noStaleFacts)；noStaleDraft=\(envelope.failClosed.noStaleDraft)",
            "新请求失败或被 superseded 时旧事实引用和本地 decision note 草稿会清空。"
        ],
        generatedAt: envelope.generatedAt
    )
}

public func assistDecisionNoteWorkflowFailClosedModel(state: String, message: String, membershipId: String? = nil) -> AssistDecisionNoteWorkflowRenderModel {
    AssistDecisionNoteWorkflowRenderModel(
        state: state,
        membershipId: membershipId,
        symbol: nil,
        title: assistDecisionNoteWorkflowTitle(state: state),
        message: message,
        noteState: nil,
        factReferences: [],
        unresolvedEvidenceGaps: [],
        laterReviewEntry: [],
        blockedExternalActions: [],
        draftSummary: [],
        safety: [],
        failClosedExplanation: [
            "\(state)：\(message)",
            "未展示旧事实引用、本地 decision note 草稿、投资建议或交易语义。"
        ],
        generatedAt: nil
    )
}

public func assistDecisionNoteDraftSummary(_ drafts: AssistDecisionNoteDrafts) -> [String] {
    [
        drafts.decisionNote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "本地 decision note 草稿为空。" : "本地 decision note 草稿：\(drafts.decisionNote)",
        "Decision note 草稿仅保存在当前 iOS 界面状态，不是官方复核记录，不持久化，不发送；source 变化、fail-closed 或 superseded 时清空。"
    ]
}

private func assistDecisionNoteWorkflowDisplayState(_ envelope: AssistDecisionNoteWorkflowEnvelope) -> String {
    switch envelope.status {
    case .available:
        return "available"
    case .blockedFollowUp:
        return "blocked"
    case .unauthorized:
        return "unauthorized"
    case .notFound:
        return "not_found"
    case .unavailable:
        return "unavailable"
    case .malformed:
        return "malformed"
    }
}

private func assistDecisionNoteWorkflowTitle(state: String) -> String {
    switch state {
    case "available":
        return "本地 decision note workflow 可用"
    case "blocked":
        return "本地 decision note workflow 阻止继续"
    case "unauthorized":
        return "读取未授权"
    case "not_found":
        return "成员不存在"
    case "malformed":
        return "decision note workflow 响应无效"
    default:
        return "本地 decision note workflow 不可用"
    }
}

private func validateNonEmptyStrings(_ values: [String], field: String, errors: inout [String]) {
    if values.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
        errors.append("\(field) must contain only non-empty strings")
    }
}

private func isAssistDecisionNoteWorkflowDateTime(_ value: String) -> Bool {
    Date.parseAssistDecisionNoteWorkflowIso8601(value) != nil
}

private extension Date {
    static func parseAssistDecisionNoteWorkflowIso8601(_ value: String) -> Date? {
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
