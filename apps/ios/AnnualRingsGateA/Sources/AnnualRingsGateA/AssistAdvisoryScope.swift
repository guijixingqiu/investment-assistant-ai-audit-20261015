import Foundation

public enum AssistAdvisoryScopeStatus: String, Codable, Equatable, Sendable {
    case available
    case notFound = "not_found"
    case unauthorized
    case unavailable
    case malformed
}

public enum AssistAdvisoryScopeFactStatus: String, Codable, Equatable, Sendable {
    case readyForHumanReview = "ready_for_human_review"
    case candidateNotSelected = "candidate_not_selected"
    case membershipArchived = "membership_archived"
    case researchMissing = "research_missing"
    case quoteMissing = "quote_missing"
    case quoteStale = "quote_stale"
    case decisionContextLimited = "decision_context_limited"
    case humanCheckPending = "human_check_pending"
    case reviewRequired = "review_required"
    case contextSnapshotUnavailable = "context_snapshot_unavailable"
    case historicalContextLimited = "historical_context_limited"
    case evidenceConflict = "evidence_conflict"
    case evidenceGap = "evidence_gap"
    case reviewComplete = "review_complete"
    case empty
}

public enum AssistAdvisoryScopeFactKind: String, Codable, Equatable, Sendable {
    case candidateMembership = "candidate_membership"
    case candidateDecisionIntake = "candidate_decision_intake"
    case quote
    case research
    case decisionContext = "decision_context"
    case humanCheck = "human_check"
    case postDecisionReview = "post_decision_review"
    case pinganLastImported = "pingan_last_imported"
    case clientState = "client_state"
}

public enum AssistAdvisoryScopeLimitationKind: String, Codable, Equatable, Sendable {
    case missingResearch = "missing_research"
    case missingQuote = "missing_quote"
    case staleQuote = "stale_quote"
    case decisionContextUnavailable = "decision_context_unavailable"
    case humanCheckPending = "human_check_pending"
    case reviewRequired = "review_required"
    case contextSnapshotUnavailable = "context_snapshot_unavailable"
    case historicalPinganOnly = "historical_pingan_only"
    case unauthorized
    case notFound = "not_found"
    case unavailable
    case malformed
    case supersededRequest = "superseded_request"
    case identityMismatch = "identity_mismatch"
    case unsafeProvenance = "unsafe_provenance"
}

public enum AssistAdvisoryScopeAllowedContinuation: String, Codable, Equatable, Sendable {
    case viewCandidate = "view_candidate"
    case viewDecisionContext = "view_decision_context"
    case completeHumanCheck = "complete_human_check"
    case inspectPostDecisionReview = "inspect_post_decision_review"
    case viewPinganHistoricalContext = "view_pingan_historical_context"
    case stopDueToUnavailableFacts = "stop_due_to_unavailable_facts"
}

public enum AssistAdvisoryScopeReviewStatus: String, Codable, Equatable, Sendable {
    case notStarted = "not_started"
    case pendingHumanCheck = "pending_human_check"
    case requiresInspection = "requires_inspection"
    case complete
}

public enum AssistAdvisoryScopeValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct AssistAdvisoryScopeEnvelope: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-04.assist-1.local-advisory-scope.v1"

    public let schemaVersion: String
    public let generatedAt: String
    public let status: AssistAdvisoryScopeStatus
    public let target: AssistAdvisoryScopeTarget
    public let facts: [AssistAdvisoryScopeFact]
    public let limitations: [AssistAdvisoryScopeLimitation]
    public let allowedContinuations: [AssistAdvisoryScopeAllowedContinuation]
    public let safety: AssistAdvisoryScopeSafety
    public let message: String
    public let candidateMembershipId: String?
    public let decisionContextId: String?
    public let contextHash: String?
    public let provenance: AssistAdvisoryScopeProvenance?
    public let review: AssistAdvisoryScopeReview?
    public let failClosedReason: AssistAdvisoryScopeLimitationKind?

    public static func unavailable(_ message: String, membershipId: String) -> AssistAdvisoryScopeEnvelope {
        AssistAdvisoryScopeEnvelope(
            schemaVersion: schemaVersionV1,
            generatedAt: ISO8601DateFormatter().string(from: Date()),
            status: .unavailable,
            target: AssistAdvisoryScopeTarget(market: "HK", code: "00000", symbol: "HK.00000", candidateMembershipId: membershipId),
            facts: [],
            limitations: [
                AssistAdvisoryScopeLimitation(kind: .unavailable, message: message, source: "client_state", observedAt: nil)
            ],
            allowedContinuations: [.stopDueToUnavailableFacts],
            safety: .safe(),
            message: message,
            candidateMembershipId: membershipId,
            decisionContextId: nil,
            contextHash: nil,
            provenance: AssistAdvisoryScopeProvenance(
                coreFacts: "repository_local_accepted_core1",
                pingan: "omitted",
                portfolio: "omitted",
                externalAccounts: "omitted",
                runtime: "repository_local_only"
            ),
            review: AssistAdvisoryScopeReview(status: .notStarted, message: "No review facts are exposed for this fail-closed advisory scope.", latestReviewedAt: nil),
            failClosedReason: .unavailable
        )
    }

    public func validateForDisplay() throws {
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionV1 {
            errors.append("schemaVersion must be \(Self.schemaVersionV1)")
        }
        if !isAssistAdvisoryScopeDateTime(generatedAt) {
            errors.append("generatedAt must be a valid date-time")
        }
        target.validate(errors: &errors)
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("message is required")
        }
        facts.forEach { $0.validate(errors: &errors) }
        limitations.forEach { $0.validate(errors: &errors) }
        safety.validate(errors: &errors)
        provenance?.validate(errors: &errors)
        review?.validate(errors: &errors)
        validateIdentity(errors: &errors)
        validateStatusSemantics(errors: &errors)

        if !errors.isEmpty {
            throw AssistAdvisoryScopeValidationError.invalid(errors)
        }
    }

    private func validateIdentity(errors: inout [String]) {
        if let candidateMembershipId,
           let targetMembershipId = target.candidateMembershipId,
           candidateMembershipId != targetMembershipId {
            errors.append("candidateMembershipId must match target.candidateMembershipId")
        }
        if let decisionContextId, decisionContextId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decisionContextId must be non-empty when present")
        }
        if let contextHash, contextHash.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("contextHash must be non-empty when present")
        }
    }

    private func validateStatusSemantics(errors: inout [String]) {
        switch status {
        case .available:
            if facts.isEmpty {
                errors.append("available status requires at least one factual item")
            }
            if failClosedReason != nil {
                errors.append("available status must not carry failClosedReason")
            }
            if limitations.contains(where: { $0.kind.isFailClosed }) {
                errors.append("available status must not carry fail-closed limitations")
            }
        case .notFound, .unauthorized, .unavailable, .malformed:
            if !facts.isEmpty {
                errors.append("fail-closed status must not return partial facts")
            }
            if allowedContinuations.contains(where: { $0 != .stopDueToUnavailableFacts }) {
                errors.append("fail-closed status can only allow stopDueToUnavailableFacts")
            }
            if let failClosedReason, !failClosedReason.isFailClosed {
                errors.append("failClosedReason must identify a fail-closed limitation")
            }
        }
    }
}

public struct AssistAdvisoryScopeTarget: Codable, Equatable, Sendable {
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

public struct AssistAdvisoryScopeFact: Codable, Equatable, Sendable {
    public let kind: AssistAdvisoryScopeFactKind
    public let status: AssistAdvisoryScopeFactStatus
    public let label: String
    public let message: String
    public let source: String?
    public let observedAt: String?
    public let staleReason: String?

    fileprivate func validate(errors: inout [String]) {
        if label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("fact.label is required")
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("fact.message is required")
        }
        if let source,
           !["accepted_core1_fact", "pingan_historical_last_imported", "client_fail_closed_state"].contains(source) {
            errors.append("fact.source is invalid")
        }
        if kind == .pinganLastImported && source != "pingan_historical_last_imported" {
            errors.append("pingan_last_imported facts must use historical source")
        }
        if let observedAt, !isAssistAdvisoryScopeDateTime(observedAt) {
            errors.append("fact.observedAt must be a valid date-time")
        }
        if let staleReason, staleReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("fact.staleReason must be non-empty when present")
        }
    }
}

public struct AssistAdvisoryScopeLimitation: Codable, Equatable, Sendable {
    public let kind: AssistAdvisoryScopeLimitationKind
    public let message: String
    public let source: String?
    public let observedAt: String?

    fileprivate func validate(errors: inout [String]) {
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("limitation.message is required")
        }
        if let source, !["contract", "repository_local_fact", "client_state"].contains(source) {
            errors.append("limitation.source is invalid")
        }
        if let observedAt, !isAssistAdvisoryScopeDateTime(observedAt) {
            errors.append("limitation.observedAt must be a valid date-time")
        }
    }
}

public struct AssistAdvisoryScopeSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let noRecommendation: Bool
    public let noRanking: Bool
    public let noScoring: Bool
    public let noTrading: Bool
    public let noOrders: Bool
    public let noBroker: Bool
    public let noPortfolioMutation: Bool
    public let noCashMutation: Bool
    public let noFeeMutation: Bool
    public let noPositionMutation: Bool
    public let noProductionClaim: Bool
    public let portfolioProvenance: String

    public static func safe() -> AssistAdvisoryScopeSafety {
        AssistAdvisoryScopeSafety(
            advisoryOnly: true,
            noRecommendation: true,
            noRanking: true,
            noScoring: true,
            noTrading: true,
            noOrders: true,
            noBroker: true,
            noPortfolioMutation: true,
            noCashMutation: true,
            noFeeMutation: true,
            noPositionMutation: true,
            noProductionClaim: true,
            portfolioProvenance: "omitted"
        )
    }

    fileprivate func validate(errors: inout [String]) {
        if !advisoryOnly ||
            !noRecommendation ||
            !noRanking ||
            !noScoring ||
            !noTrading ||
            !noOrders ||
            !noBroker ||
            !noPortfolioMutation ||
            !noCashMutation ||
            !noFeeMutation ||
            !noPositionMutation ||
            !noProductionClaim {
            errors.append("ASSIST advisory scope safety flags must all be true")
        }
        if portfolioProvenance != "omitted" {
            errors.append("portfolioProvenance must be omitted")
        }
    }
}

public struct AssistAdvisoryScopeProvenance: Codable, Equatable, Sendable {
    public let coreFacts: String
    public let pingan: String
    public let portfolio: String
    public let externalAccounts: String
    public let runtime: String

    fileprivate func validate(errors: inout [String]) {
        if coreFacts != "repository_local_accepted_core1" {
            errors.append("provenance.coreFacts must be repository_local_accepted_core1")
        }
        if !["historical_last_imported_only", "omitted"].contains(pingan) {
            errors.append("provenance.pingan is invalid")
        }
        if portfolio != "omitted" {
            errors.append("provenance.portfolio must be omitted")
        }
        if externalAccounts != "omitted" {
            errors.append("provenance.externalAccounts must be omitted")
        }
        if runtime != "repository_local_only" {
            errors.append("provenance.runtime must be repository_local_only")
        }
    }
}

public struct AssistAdvisoryScopeReview: Codable, Equatable, Sendable {
    public let status: AssistAdvisoryScopeReviewStatus
    public let message: String
    public let latestReviewedAt: String?

    fileprivate func validate(errors: inout [String]) {
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("review.message is required")
        }
        if let latestReviewedAt, !isAssistAdvisoryScopeDateTime(latestReviewedAt) {
            errors.append("review.latestReviewedAt must be a valid date-time")
        }
    }
}

public struct AssistAdvisoryScopeRenderModel: Equatable, Sendable {
    public let state: String
    public let membershipId: String?
    public let symbol: String?
    public let title: String
    public let message: String
    public let facts: [String]
    public let limitations: [String]
    public let continuations: [String]
    public let safety: [String]
}

public func assistAdvisoryScopeRenderModel(from envelope: AssistAdvisoryScopeEnvelope) -> AssistAdvisoryScopeRenderModel {
    let state = assistAdvisoryScopeDisplayState(envelope)
    guard envelope.status == .available else {
        return assistAdvisoryScopeFailClosedModel(
            state: state,
            message: envelope.message,
            membershipId: envelope.candidateMembershipId ?? envelope.target.candidateMembershipId
        )
    }
    return AssistAdvisoryScopeRenderModel(
        state: state,
        membershipId: envelope.candidateMembershipId ?? envelope.target.candidateMembershipId,
        symbol: envelope.target.symbol,
        title: assistAdvisoryScopeTitle(state: state),
        message: envelope.message,
        facts: envelope.facts.map { "\($0.label): \($0.status.rawValue); \($0.message)" },
        limitations: envelope.limitations.map { "\($0.kind.rawValue): \($0.message)" },
        continuations: envelope.allowedContinuations.map(assistAdvisoryScopeContinuationLabel),
        safety: [
            "仅限辅助范围说明。",
            "安全证明阻止执行权限和账户变更权限。"
        ]
    )
}

public func assistAdvisoryScopeFailClosedModel(state: String, message: String, membershipId: String? = nil) -> AssistAdvisoryScopeRenderModel {
    AssistAdvisoryScopeRenderModel(
        state: state,
        membershipId: membershipId,
        symbol: nil,
        title: assistAdvisoryScopeTitle(state: state),
        message: message,
        facts: [],
        limitations: [],
        continuations: [],
        safety: []
    )
}

private func assistAdvisoryScopeDisplayState(_ envelope: AssistAdvisoryScopeEnvelope) -> String {
    switch envelope.status {
    case .notFound:
        return "not_found"
    case .unauthorized:
        return "unauthorized"
    case .unavailable:
        return "unavailable"
    case .malformed:
        return "malformed"
    case .available:
        if envelope.facts.contains(where: { $0.status == .researchMissing }) { return "missing_research" }
        if envelope.facts.contains(where: { $0.status == .quoteMissing }) { return "missing_quote" }
        if envelope.facts.contains(where: { $0.status == .quoteStale }) { return "stale_quote" }
        if envelope.facts.contains(where: { $0.status == .reviewRequired }) { return "review_required" }
        if envelope.facts.allSatisfy({ $0.status == .empty }) { return "empty" }
        if envelope.facts.contains(where: { [.decisionContextLimited, .historicalContextLimited, .evidenceGap].contains($0.status) }) { return "limited" }
        return "available"
    }
}

private func assistAdvisoryScopeTitle(state: String) -> String {
    switch state {
    case "available":
        return "ASSIST 范围可读"
    case "empty":
        return "ASSIST 范围为空"
    case "missing_research":
        return "缺少研究事实"
    case "missing_quote":
        return "缺少报价事实"
    case "stale_quote":
        return "报价事实已过期"
    case "review_required":
        return "需要复盘检查"
    case "limited":
        return "ASSIST 范围受限"
    case "unauthorized":
        return "读取未授权"
    case "not_found":
        return "成员不存在"
    case "malformed":
        return "响应格式无效"
    default:
        return "ASSIST 范围不可用"
    }
}

private func assistAdvisoryScopeContinuationLabel(_ continuation: AssistAdvisoryScopeAllowedContinuation) -> String {
    switch continuation {
    case .viewCandidate:
        return "查看候选事实"
    case .viewDecisionContext:
        return "查看决策上下文事实"
    case .completeHumanCheck:
        return "完成人工检查"
    case .inspectPostDecisionReview:
        return "检查决策后复盘"
    case .viewPinganHistoricalContext:
        return "查看平安历史上下文"
    case .stopDueToUnavailableFacts:
        return "事实不可用时停止"
    }
}

private extension AssistAdvisoryScopeLimitationKind {
    var isFailClosed: Bool {
        switch self {
        case .unauthorized, .notFound, .unavailable, .malformed, .supersededRequest, .identityMismatch, .unsafeProvenance:
            return true
        default:
            return false
        }
    }
}

private func isAssistAdvisoryScopeDateTime(_ value: String) -> Bool {
    Date.parseAssistAdvisoryScopeIso8601(value) != nil
}

private extension Date {
    static func parseAssistAdvisoryScopeIso8601(_ value: String) -> Date? {
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
