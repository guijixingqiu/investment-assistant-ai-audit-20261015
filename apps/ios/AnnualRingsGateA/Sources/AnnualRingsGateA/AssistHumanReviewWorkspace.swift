import Foundation

public enum AssistHumanReviewWorkspaceStatus: String, Codable, Equatable, Sendable {
    case available
    case notFound = "not_found"
    case unauthorized
    case unavailable
    case malformed
}

public enum AssistHumanReviewWorkspaceReadinessID: String, Codable, Equatable, Sendable {
    case readyForManualReview = "ready_for_manual_review"
    case reviewLimited = "review_limited"
    case blockedMissingFacts = "blocked_missing_facts"
    case blockedStaleFacts = "blocked_stale_facts"
    case blockedHumanCheckPending = "blocked_human_check_pending"
    case blockedReviewRequired = "blocked_review_required"
    case blockedUnauthorized = "blocked_unauthorized"
    case blockedNotFound = "blocked_not_found"
    case blockedUnavailable = "blocked_unavailable"
    case blockedMalformed = "blocked_malformed"
    case emptyLocalScope = "empty_local_scope"
}

public enum AssistHumanReviewWorkspaceEvidenceGroupID: String, Codable, Equatable, Sendable {
    case candidateIdentity = "candidate_identity"
    case quoteEvidence = "quote_evidence"
    case researchEvidence = "research_evidence"
    case decisionContext = "decision_context"
    case humanCheck = "human_check"
    case postDecisionReview = "post_decision_review"
    case pinganHistoricalContext = "pingan_historical_context"
    case portfolioOmittedBoundary = "portfolio_omitted_boundary"
    case clientFailClosedState = "client_fail_closed_state"
    case safetyBoundary = "safety_boundary"
}

public enum AssistHumanReviewWorkspaceEvidenceStatus: String, Codable, Equatable, Sendable {
    case availableForManualReview = "available_for_manual_review"
    case reviewLimited = "review_limited"
    case missing
    case stale
    case historicalContext = "historical_context"
    case omittedBoundary = "omitted_boundary"
    case failClosed = "fail_closed"
    case safetyBoundary = "safety_boundary"
    case empty
}

public enum AssistHumanReviewWorkspaceLimitationSeverity: String, Codable, Equatable, Sendable {
    case blocking
    case reviewLimited = "review_limited"
    case contextOnly = "context_only"
    case safetyBoundary = "safety_boundary"
}

public enum AssistHumanReviewWorkspaceContinuationID: String, Codable, Equatable, Sendable {
    case viewCandidateFacts = "view_candidate_facts"
    case viewDecisionContextFacts = "view_decision_context_facts"
    case completeManualHumanCheck = "complete_manual_human_check"
    case inspectPostDecisionReview = "inspect_post_decision_review"
    case viewPinganHistoricalContext = "view_pingan_historical_context"
    case recordLocalReviewNote = "record_local_review_note"
    case markForLaterManualReview = "mark_for_later_manual_review"
    case stopDueToUnavailableFacts = "stop_due_to_unavailable_facts"
}

public enum AssistHumanReviewWorkspaceValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct AssistHumanReviewWorkspaceEnvelope: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-05.assist-1.local-human-review-workspace.v1"

    public let schemaVersion: String
    public let generatedAt: String
    public let status: AssistHumanReviewWorkspaceStatus
    public let target: AssistHumanReviewWorkspaceTarget
    public let readiness: AssistHumanReviewWorkspaceReadiness
    public let evidenceGroups: [AssistHumanReviewWorkspaceEvidenceGroup]
    public let limitations: [AssistHumanReviewWorkspaceLimitation]
    public let continuations: [AssistHumanReviewWorkspaceContinuation]
    public let followUp: AssistHumanReviewWorkspaceFollowUp
    public let boundaries: AssistHumanReviewWorkspaceBoundaries
    public let failClosed: AssistHumanReviewWorkspaceFailClosed
    public let safety: AssistHumanReviewWorkspaceSafety
    public let provenance: AssistHumanReviewWorkspaceProvenance
    public let review: AssistHumanReviewWorkspaceReview
    public let sourceEnvelopeRef: AssistHumanReviewWorkspaceSourceEnvelopeRef
    public let message: String

    public static func unavailable(_ message: String, membershipId: String) -> AssistHumanReviewWorkspaceEnvelope {
        let readiness = AssistHumanReviewWorkspaceReadiness(
            id: .blockedUnavailable,
            label: "Blocked because repository facts are unavailable",
            explanation: message,
            allowedInterpretation: "Stop and refresh repository-local facts after the failure is resolved.",
            forbiddenInterpretation: "Do not reuse older workspace facts or infer an investment action.",
            blocking: true,
            manualReviewOnly: true,
            tradeReady: false,
            recommendation: false
        )
        return AssistHumanReviewWorkspaceEnvelope(
            schemaVersion: schemaVersionV1,
            generatedAt: ISO8601DateFormatter().string(from: Date()),
            status: .unavailable,
            target: AssistHumanReviewWorkspaceTarget(market: "HK", code: "00000", symbol: "HK.00000", candidateMembershipId: membershipId),
            readiness: readiness,
            evidenceGroups: [],
            limitations: [
                AssistHumanReviewWorkspaceLimitation(
                    kind: "unavailable",
                    severity: .blocking,
                    label: "Workspace unavailable",
                    explanation: message,
                    userImpact: "No local human-review workspace facts are usable for this request.",
                    allowedInterpretation: "Stop local review until a valid workspace is loaded.",
                    forbiddenInterpretation: "Do not reuse older facts or treat this as investment judgment."
                )
            ],
            continuations: [
                AssistHumanReviewWorkspaceContinuation(
                    id: .stopDueToUnavailableFacts,
                    label: "Stop because facts are unavailable",
                    description: "Do not continue local review until a valid workspace can be loaded.",
                    category: "stop",
                    enabled: true,
                    disabledReason: nil,
                    sideEffectLevel: "none",
                    allowedInterpretation: "This is a local stop state only.",
                    forbiddenInterpretation: "This is not investment advice, execution, account, or production authority."
                )
            ],
            followUp: AssistHumanReviewWorkspaceFollowUp(
                currentReviewState: readiness.id.rawValue,
                manualNoteIntent: "Local display intent only; no note is persisted by workspace v1.",
                laterReviewIntent: "Local display intent only; later-review persistence is reserved.",
                unresolvedEvidenceGaps: ["Workspace facts are unavailable."],
                suggestedLocalNextViews: ["Stop due to unavailable facts."],
                blockedExternalActions: ["No execution orders", "No account or broker calls", "No live holdings sync", "No portfolio mutation", "No production release"],
                productionNoGoReason: "Production release remains NO_GO."
            ),
            boundaries: .safe(),
            failClosed: AssistHumanReviewWorkspaceFailClosed(active: true, reason: message, noStaleFacts: true, noPartialFacts: true, notInvestmentJudgment: true),
            safety: .safe(),
            provenance: AssistHumanReviewWorkspaceProvenance(
                coreFacts: "repository_local_accepted_core1",
                sourceEnvelope: "assist_advisory_scope_v1",
                pingan: "omitted",
                portfolio: "omitted",
                externalAccounts: "omitted",
                runtime: "repository_local_only"
            ),
            review: AssistHumanReviewWorkspaceReview(state: "not_started", message: "No review facts are exposed for this fail-closed human-review workspace.", latestReviewedAt: nil),
            sourceEnvelopeRef: AssistHumanReviewWorkspaceSourceEnvelopeRef(
                schemaVersion: AssistAdvisoryScopeEnvelope.schemaVersionV1,
                route: "/api/mobile/research/candidate-memberships/:id/advisory-scope",
                status: "unavailable",
                candidateMembershipId: membershipId
            ),
            message: message
        )
    }

    public func validateForDisplay() throws {
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionV1 {
            errors.append("schemaVersion must be \(Self.schemaVersionV1)")
        }
        if !isAssistHumanReviewWorkspaceDateTime(generatedAt) {
            errors.append("generatedAt must be a valid date-time")
        }
        target.validate(errors: &errors)
        readiness.validate(errors: &errors)
        evidenceGroups.forEach { $0.validate(errors: &errors) }
        limitations.forEach { $0.validate(errors: &errors) }
        continuations.forEach { $0.validate(errors: &errors) }
        followUp.validate(errors: &errors)
        boundaries.validate(errors: &errors, label: "boundaries")
        failClosed.validate(errors: &errors)
        safety.validate(errors: &errors)
        provenance.validate(errors: &errors)
        review.validate(errors: &errors)
        sourceEnvelopeRef.validate(errors: &errors)
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("message is required")
        }
        validateStatusSemantics(errors: &errors)

        if !errors.isEmpty {
            throw AssistHumanReviewWorkspaceValidationError.invalid(errors)
        }
    }

    private func validateStatusSemantics(errors: inout [String]) {
        switch status {
        case .available:
            if failClosed.active {
                errors.append("available workspace must not mark failClosed.active true")
            }
        case .notFound, .unauthorized, .unavailable, .malformed:
            if !evidenceGroups.isEmpty {
                errors.append("fail-closed workspace must not expose evidence groups")
            }
            if continuations.contains(where: { $0.id != .stopDueToUnavailableFacts }) {
                errors.append("fail-closed workspace can only expose stopDueToUnavailableFacts")
            }
            if !failClosed.active {
                errors.append("fail-closed workspace must mark failClosed.active true")
            }
            if !readiness.blocking {
                errors.append("fail-closed readiness must be blocking")
            }
        }
    }
}

public struct AssistHumanReviewWorkspaceTarget: Codable, Equatable, Sendable {
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

public struct AssistHumanReviewWorkspaceReadiness: Codable, Equatable, Sendable {
    public let id: AssistHumanReviewWorkspaceReadinessID
    public let label: String
    public let explanation: String
    public let allowedInterpretation: String
    public let forbiddenInterpretation: String
    public let blocking: Bool
    public let manualReviewOnly: Bool
    public let tradeReady: Bool
    public let recommendation: Bool

    fileprivate func validate(errors: inout [String]) {
        for (field, value) in [
            ("readiness.label", label),
            ("readiness.explanation", explanation),
            ("readiness.allowedInterpretation", allowedInterpretation),
            ("readiness.forbiddenInterpretation", forbiddenInterpretation)
        ] where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(field) is required")
        }
        if !manualReviewOnly || tradeReady || recommendation {
            errors.append("readiness must be manual-review-only, not trade-ready, and not recommendation")
        }
    }
}

public struct AssistHumanReviewWorkspaceEvidenceGroup: Codable, Equatable, Sendable {
    public let id: AssistHumanReviewWorkspaceEvidenceGroupID
    public let title: String
    public let status: AssistHumanReviewWorkspaceEvidenceStatus
    public let severity: AssistHumanReviewWorkspaceLimitationSeverity
    public let summary: String
    public let facts: [String]
    public let limitations: [String]
    public let source: String
    public let observedAt: String?
    public let staleReason: String?
    public let allowedInterpretation: String
    public let forbiddenInterpretation: String

    fileprivate func validate(errors: inout [String]) {
        for (field, value) in [
            ("evidenceGroup.title", title),
            ("evidenceGroup.summary", summary),
            ("evidenceGroup.source", source),
            ("evidenceGroup.allowedInterpretation", allowedInterpretation),
            ("evidenceGroup.forbiddenInterpretation", forbiddenInterpretation)
        ] where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(field) is required")
        }
        if let observedAt, !isAssistHumanReviewWorkspaceDateTime(observedAt) {
            errors.append("evidenceGroup.observedAt must be a valid date-time")
        }
        if let staleReason, staleReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("evidenceGroup.staleReason must be non-empty when present")
        }
    }
}

public struct AssistHumanReviewWorkspaceLimitation: Codable, Equatable, Sendable {
    public let kind: String
    public let severity: AssistHumanReviewWorkspaceLimitationSeverity
    public let label: String
    public let explanation: String
    public let userImpact: String
    public let allowedInterpretation: String
    public let forbiddenInterpretation: String

    fileprivate func validate(errors: inout [String]) {
        for (field, value) in [
            ("limitation.kind", kind),
            ("limitation.label", label),
            ("limitation.explanation", explanation),
            ("limitation.userImpact", userImpact),
            ("limitation.allowedInterpretation", allowedInterpretation),
            ("limitation.forbiddenInterpretation", forbiddenInterpretation)
        ] where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(field) is required")
        }
    }
}

public struct AssistHumanReviewWorkspaceContinuation: Codable, Equatable, Sendable {
    public let id: AssistHumanReviewWorkspaceContinuationID
    public let label: String
    public let description: String
    public let category: String
    public let enabled: Bool
    public let disabledReason: String?
    public let sideEffectLevel: String
    public let allowedInterpretation: String
    public let forbiddenInterpretation: String

    fileprivate func validate(errors: inout [String]) {
        for (field, value) in [
            ("continuation.label", label),
            ("continuation.description", description),
            ("continuation.category", category),
            ("continuation.sideEffectLevel", sideEffectLevel),
            ("continuation.allowedInterpretation", allowedInterpretation),
            ("continuation.forbiddenInterpretation", forbiddenInterpretation)
        ] where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(field) is required")
        }
        if !["view", "manual_review", "local_intent", "stop"].contains(category) {
            errors.append("continuation.category is invalid")
        }
        if !["none", "local_display_intent"].contains(sideEffectLevel) {
            errors.append("continuation.sideEffectLevel is invalid")
        }
    }
}

public struct AssistHumanReviewWorkspaceFollowUp: Codable, Equatable, Sendable {
    public let currentReviewState: String
    public let manualNoteIntent: String
    public let laterReviewIntent: String
    public let unresolvedEvidenceGaps: [String]
    public let suggestedLocalNextViews: [String]
    public let blockedExternalActions: [String]
    public let productionNoGoReason: String

    fileprivate func validate(errors: inout [String]) {
        for (field, value) in [
            ("followUp.currentReviewState", currentReviewState),
            ("followUp.manualNoteIntent", manualNoteIntent),
            ("followUp.laterReviewIntent", laterReviewIntent),
            ("followUp.productionNoGoReason", productionNoGoReason)
        ] where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(field) is required")
        }
    }
}

public struct AssistHumanReviewWorkspaceBoundaries: Codable, Equatable, Sendable {
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
    public let noCashMutation: Bool
    public let noFeeMutation: Bool
    public let noPositionMutation: Bool
    public let noBroker: Bool
    public let noPortfolioMutation: Bool
    public let noProductionClaim: Bool
    public let pinganHistoricalOnly: Bool
    public let portfolioOmitted: Bool
    public let externalRuntimeNotUsed: Bool

    public static func safe() -> AssistHumanReviewWorkspaceBoundaries {
        AssistHumanReviewWorkspaceBoundaries(
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
            noCashMutation: true,
            noFeeMutation: true,
            noPositionMutation: true,
            noBroker: true,
            noPortfolioMutation: true,
            noProductionClaim: true,
            pinganHistoricalOnly: true,
            portfolioOmitted: true,
            externalRuntimeNotUsed: true
        )
    }

    fileprivate func validate(errors: inout [String], label: String) {
        if !allFlagsTrue {
            errors.append("\(label) safety boundary flags must all be true")
        }
    }

    fileprivate var allFlagsTrue: Bool {
        noRecommendation &&
        noRanking &&
        noScoring &&
        noBuySellHold &&
        noTiming &&
        noTargetPrice &&
        noStopLoss &&
        noTakeProfit &&
        noExpectedReturn &&
        noSizing &&
        noAllocation &&
        noOrder &&
        noTrade &&
        noFill &&
        noCashMutation &&
        noFeeMutation &&
        noPositionMutation &&
        noBroker &&
        noPortfolioMutation &&
        noProductionClaim &&
        pinganHistoricalOnly &&
        portfolioOmitted &&
        externalRuntimeNotUsed
    }
}

public struct AssistHumanReviewWorkspaceFailClosed: Codable, Equatable, Sendable {
    public let active: Bool
    public let reason: String?
    public let noStaleFacts: Bool
    public let noPartialFacts: Bool
    public let notInvestmentJudgment: Bool

    fileprivate func validate(errors: inout [String]) {
        if !noStaleFacts || !noPartialFacts || !notInvestmentJudgment {
            errors.append("failClosed must block stale facts, partial facts, and investment judgment")
        }
        if let reason, reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("failClosed.reason must be non-empty when present")
        }
    }
}

public struct AssistHumanReviewWorkspaceSafety: Codable, Equatable, Sendable {
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
    public let noCashMutation: Bool
    public let noFeeMutation: Bool
    public let noPositionMutation: Bool
    public let noBroker: Bool
    public let noPortfolioMutation: Bool
    public let noProductionClaim: Bool
    public let pinganHistoricalOnly: Bool
    public let portfolioOmitted: Bool
    public let externalRuntimeNotUsed: Bool
    public let advisoryOnly: Bool
    public let manualReviewOnly: Bool

    public static func safe() -> AssistHumanReviewWorkspaceSafety {
        let boundary = AssistHumanReviewWorkspaceBoundaries.safe()
        return AssistHumanReviewWorkspaceSafety(boundary: boundary, advisoryOnly: true, manualReviewOnly: true)
    }

    public init(boundary: AssistHumanReviewWorkspaceBoundaries, advisoryOnly: Bool, manualReviewOnly: Bool) {
        self.noRecommendation = boundary.noRecommendation
        self.noRanking = boundary.noRanking
        self.noScoring = boundary.noScoring
        self.noBuySellHold = boundary.noBuySellHold
        self.noTiming = boundary.noTiming
        self.noTargetPrice = boundary.noTargetPrice
        self.noStopLoss = boundary.noStopLoss
        self.noTakeProfit = boundary.noTakeProfit
        self.noExpectedReturn = boundary.noExpectedReturn
        self.noSizing = boundary.noSizing
        self.noAllocation = boundary.noAllocation
        self.noOrder = boundary.noOrder
        self.noTrade = boundary.noTrade
        self.noFill = boundary.noFill
        self.noCashMutation = boundary.noCashMutation
        self.noFeeMutation = boundary.noFeeMutation
        self.noPositionMutation = boundary.noPositionMutation
        self.noBroker = boundary.noBroker
        self.noPortfolioMutation = boundary.noPortfolioMutation
        self.noProductionClaim = boundary.noProductionClaim
        self.pinganHistoricalOnly = boundary.pinganHistoricalOnly
        self.portfolioOmitted = boundary.portfolioOmitted
        self.externalRuntimeNotUsed = boundary.externalRuntimeNotUsed
        self.advisoryOnly = advisoryOnly
        self.manualReviewOnly = manualReviewOnly
    }

    fileprivate func validate(errors: inout [String]) {
        let boundary = AssistHumanReviewWorkspaceBoundaries(
            noRecommendation: noRecommendation,
            noRanking: noRanking,
            noScoring: noScoring,
            noBuySellHold: noBuySellHold,
            noTiming: noTiming,
            noTargetPrice: noTargetPrice,
            noStopLoss: noStopLoss,
            noTakeProfit: noTakeProfit,
            noExpectedReturn: noExpectedReturn,
            noSizing: noSizing,
            noAllocation: noAllocation,
            noOrder: noOrder,
            noTrade: noTrade,
            noFill: noFill,
            noCashMutation: noCashMutation,
            noFeeMutation: noFeeMutation,
            noPositionMutation: noPositionMutation,
            noBroker: noBroker,
            noPortfolioMutation: noPortfolioMutation,
            noProductionClaim: noProductionClaim,
            pinganHistoricalOnly: pinganHistoricalOnly,
            portfolioOmitted: portfolioOmitted,
            externalRuntimeNotUsed: externalRuntimeNotUsed
        )
        boundary.validate(errors: &errors, label: "safety")
        if !advisoryOnly || !manualReviewOnly {
            errors.append("workspace safety must be advisory-only and manual-review-only")
        }
    }
}

public struct AssistHumanReviewWorkspaceProvenance: Codable, Equatable, Sendable {
    public let coreFacts: String
    public let sourceEnvelope: String
    public let pingan: String
    public let portfolio: String
    public let externalAccounts: String
    public let runtime: String

    fileprivate func validate(errors: inout [String]) {
        if coreFacts != "repository_local_accepted_core1" {
            errors.append("provenance.coreFacts is invalid")
        }
        if sourceEnvelope != "assist_advisory_scope_v1" {
            errors.append("provenance.sourceEnvelope is invalid")
        }
        if !["historical_last_imported_only", "omitted"].contains(pingan) {
            errors.append("provenance.pingan is invalid")
        }
        if portfolio != "omitted" || externalAccounts != "omitted" || runtime != "repository_local_only" {
            errors.append("provenance must omit portfolio/external accounts and stay repository-local")
        }
    }
}

public struct AssistHumanReviewWorkspaceReview: Codable, Equatable, Sendable {
    public let state: String
    public let message: String
    public let latestReviewedAt: String?

    fileprivate func validate(errors: inout [String]) {
        if !["not_started", "pending_human_check", "requires_inspection", "complete"].contains(state) {
            errors.append("review.state is invalid")
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("review.message is required")
        }
        if let latestReviewedAt, !isAssistHumanReviewWorkspaceDateTime(latestReviewedAt) {
            errors.append("review.latestReviewedAt must be a valid date-time")
        }
    }
}

public struct AssistHumanReviewWorkspaceSourceEnvelopeRef: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let route: String
    public let status: String
    public let candidateMembershipId: String?

    fileprivate func validate(errors: inout [String]) {
        if schemaVersion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("sourceEnvelopeRef.schemaVersion is required")
        }
        if route != "/api/mobile/research/candidate-memberships/:id/advisory-scope" {
            errors.append("sourceEnvelopeRef.route is invalid")
        }
        if status.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("sourceEnvelopeRef.status is required")
        }
    }
}

public struct AssistHumanReviewWorkspaceRenderModel: Equatable, Sendable {
    public let state: String
    public let membershipId: String?
    public let symbol: String?
    public let title: String
    public let message: String
    public let readiness: [String]
    public let evidenceGroups: [String]
    public let limitationsWithSeverity: [String]
    public let continuations: [String]
    public let followUp: [String]
    public let boundaries: [String]
    public let failClosedExplanation: [String]
    public let safety: [String]
    public let provenance: [String]
    public let generatedAt: String?
}

public func assistHumanReviewWorkspaceRenderModel(from envelope: AssistHumanReviewWorkspaceEnvelope) -> AssistHumanReviewWorkspaceRenderModel {
    let state = assistHumanReviewWorkspaceDisplayState(envelope)
    let membershipId = envelope.target.candidateMembershipId ?? envelope.sourceEnvelopeRef.candidateMembershipId
    guard envelope.status == .available else {
        return assistHumanReviewWorkspaceFailClosedModel(
            state: state,
            message: envelope.message,
            membershipId: membershipId
        )
    }
    return AssistHumanReviewWorkspaceRenderModel(
        state: state,
        membershipId: membershipId,
        symbol: envelope.target.symbol,
        title: assistHumanReviewWorkspaceTitle(state: state),
        message: envelope.message,
        readiness: [
            "\(envelope.readiness.label)：\(envelope.readiness.explanation)",
            "允许理解：\(envelope.readiness.allowedInterpretation)",
            "禁止理解：\(envelope.readiness.forbiddenInterpretation)",
            "仅人工复核：\(envelope.readiness.manualReviewOnly)；可交易：\(envelope.readiness.tradeReady)；投资建议：\(envelope.readiness.recommendation)"
        ],
        evidenceGroups: envelope.evidenceGroups.map { "\($0.title) [\($0.status.rawValue)/\($0.severity.rawValue)]：\($0.summary)" },
        limitationsWithSeverity: envelope.limitations.map { "\($0.label) [\($0.severity.rawValue)]：\($0.explanation)" },
        continuations: envelope.continuations.map { "\($0.label) [\($0.category)/\($0.sideEffectLevel)/enabled=\($0.enabled)]：\($0.description)" },
        followUp: [
            "当前复核状态：\(envelope.followUp.currentReviewState)",
            "本地备注意图：\(envelope.followUp.manualNoteIntent)",
            "稍后复核意图：\(envelope.followUp.laterReviewIntent)",
            "未解决证据缺口：\(envelope.followUp.unresolvedEvidenceGaps.joined(separator: "；"))",
            "本地下一视图：\(envelope.followUp.suggestedLocalNextViews.joined(separator: "；"))",
            "外部动作已阻止：\(envelope.followUp.blockedExternalActions.joined(separator: "；"))",
            "Production NO_GO：\(envelope.followUp.productionNoGoReason)"
        ],
        boundaries: [
            "无推荐、排序、评分、买卖持有、择时、目标价、止损、止盈、预期收益、仓位、分配、订单、成交、现金、费用、持仓、券商、组合变更或生产发布声明。",
            "平安仅历史上下文：\(envelope.boundaries.pinganHistoricalOnly)；组合省略：\(envelope.boundaries.portfolioOmitted)；未使用外部运行时：\(envelope.boundaries.externalRuntimeNotUsed)"
        ],
        failClosedExplanation: [
            "failClosed=\(envelope.failClosed.active)；noStaleFacts=\(envelope.failClosed.noStaleFacts)；noPartialFacts=\(envelope.failClosed.noPartialFacts)",
            "新请求失败时旧工作台事实会清空。"
        ],
        safety: [
            "仅辅助、仅人工复核。",
            "安全边界阻止执行、账户、券商、组合和生产权限。"
        ],
        provenance: [
            "coreFacts=\(envelope.provenance.coreFacts)",
            "sourceEnvelope=\(envelope.provenance.sourceEnvelope) \(envelope.sourceEnvelopeRef.schemaVersion)",
            "pingan=\(envelope.provenance.pingan)；portfolio=\(envelope.provenance.portfolio)；runtime=\(envelope.provenance.runtime)"
        ],
        generatedAt: envelope.generatedAt
    )
}

public func assistHumanReviewWorkspaceFailClosedModel(state: String, message: String, membershipId: String? = nil) -> AssistHumanReviewWorkspaceRenderModel {
    AssistHumanReviewWorkspaceRenderModel(
        state: state,
        membershipId: membershipId,
        symbol: nil,
        title: assistHumanReviewWorkspaceTitle(state: state),
        message: message,
        readiness: [],
        evidenceGroups: [],
        limitationsWithSeverity: [],
        continuations: [],
        followUp: [],
        boundaries: [],
        failClosedExplanation: [
            "\(state)：\(message)",
            "未展示旧工作台事实、部分事实、投资建议或交易语义。"
        ],
        safety: [],
        provenance: [],
        generatedAt: nil
    )
}

private func assistHumanReviewWorkspaceDisplayState(_ envelope: AssistHumanReviewWorkspaceEnvelope) -> String {
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
        switch envelope.readiness.id {
        case .readyForManualReview:
            return "ready"
        case .reviewLimited:
            return "review_limited"
        case .emptyLocalScope:
            return "empty"
        case .blockedMissingFacts, .blockedStaleFacts, .blockedHumanCheckPending, .blockedReviewRequired, .blockedUnauthorized, .blockedNotFound, .blockedUnavailable, .blockedMalformed:
            return "blocked"
        }
    }
}

private func assistHumanReviewWorkspaceTitle(state: String) -> String {
    switch state {
    case "ready":
        return "人工复核工作台可读"
    case "review_limited":
        return "人工复核工作台受限"
    case "blocked":
        return "人工复核工作台阻止继续"
    case "empty":
        return "人工复核工作台为空"
    case "unauthorized":
        return "读取未授权"
    case "not_found":
        return "成员不存在"
    case "malformed":
        return "工作台响应无效"
    default:
        return "人工复核工作台不可用"
    }
}

private func isAssistHumanReviewWorkspaceDateTime(_ value: String) -> Bool {
    Date.parseAssistHumanReviewWorkspaceIso8601(value) != nil
}

private extension Date {
    static func parseAssistHumanReviewWorkspaceIso8601(_ value: String) -> Date? {
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
