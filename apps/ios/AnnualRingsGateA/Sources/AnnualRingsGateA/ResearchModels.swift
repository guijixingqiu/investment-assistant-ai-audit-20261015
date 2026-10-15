import Foundation

func isValidManualReviewDueOn(_ value: String) -> Bool {
    guard value.range(of: #"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"#, options: .regularExpression) != nil,
          let hongKong = TimeZone(identifier: "Asia/Hong_Kong") else { return false }
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = hongKong
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.isLenient = false
    guard let date = formatter.date(from: value) else { return false }
    return formatter.string(from: date) == value
}

public enum EvidenceStance: String, Codable, Equatable, Sendable {
    case support
    case refute
    case neutral
}

public enum FactKind: String, Codable, Equatable, Sendable {
    case fact
    case inference
}

public enum SuggestionStatus: String, Codable, Equatable, Sendable {
    case pending
    case accepted
    case rejected
}

public struct ResearchProfileEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let asOf: String
    public let requestedSymbol: String
    public let data: ResearchProfilePayload?
    public let message: String
    public let metadata: FactMetadata?

    public init(
        schemaVersion: String,
        asOf: String,
        requestedSymbol: String,
        data: ResearchProfilePayload?,
        message: String,
        metadata: FactMetadata? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.asOf = asOf
        self.requestedSymbol = requestedSymbol
        self.data = data
        self.message = message
        self.metadata = metadata
    }

    public func validateForDisplay(market expectedMarket: String, code expectedCode: String) throws {
        var errors: [String] = []
        let canonical = "\(expectedMarket).\(expectedCode)"
        if schemaVersion != "2026-06-17.gate-b.v1" {
            errors.append("research profile schemaVersion is invalid")
        }
        if asOf.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("research profile asOf is required")
        } else if isParseableDateTime(asOf) == false {
            errors.append("research profile asOf must be a valid date-time")
        }
        if requestedSymbol != canonical {
            errors.append("research profile requestedSymbol must equal \(canonical)")
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("research profile message is required")
        }
        if let metadata {
            metadata.validateForDisplay(label: "research profile", errors: &errors)
        } else {
            errors.append("research profile metadata is required")
        }
        if let data {
            validateCanonicalIdentity(data.profile, expectedMarket: expectedMarket, expectedCode: expectedCode, label: "research profile", errors: &errors)
            data.validateForDisplay(errors: &errors)
        }
        if errors.isEmpty == false {
            throw ResearchProfileValidationError.invalid(errors)
        }
    }
}

public struct ResearchProfilePayload: Codable, Equatable, Sendable {
    public let profile: ResearchProfileData
    public let evidence: [EvidenceItemData]
    public let suggestions: [AiUpdateSuggestionData]

    fileprivate func validateForDisplay(errors: inout [String]) {
        profile.validateForDisplay(errors: &errors)
        evidence.forEach { $0.validateForDisplay(errors: &errors) }
        suggestions.forEach { $0.validateForDisplay(errors: &errors) }
    }
}

public struct AiUpdateSuggestionData: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let status: SuggestionStatus
    public let summary: String
    public let supports: [String]
    public let weakens: [String]
    public let counterEvidence: [String]
    public let changedVariables: [String]
    public let missingEvidence: [String]
    public let createdAt: String
    public let decidedAt: String?
    public let decisionNote: String?

    fileprivate func validateForDisplay(errors: inout [String]) {
        if id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("research suggestion id is required")
        }
        if summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("research suggestion summary is required")
        }
        if createdAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isParseableDateTime(createdAt) == false {
            errors.append("research suggestion createdAt must be a valid date-time")
        }
        if let decidedAt, decidedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isParseableDateTime(decidedAt) == false {
            errors.append("research suggestion decidedAt must be a valid date-time when present")
        }
    }
}

public enum ResearchProfileValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct SuggestionDecisionResponse: Codable, Equatable, Sendable {
    public let ok: Bool
    public let suggestion: AiUpdateSuggestionData
    public let message: String
}

public struct ResearchWriteEnvelope<T: Codable & Equatable & Sendable>: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let status: String
    public let asOf: String
    public let source: ResearchWriteSource
    public let data: T
    public let message: String
}

public struct ResearchWriteSource: Codable, Equatable, Sendable {
    public let actorType: String
    public let actorId: String?
    public let correlationId: String?
}

public enum DecisionWriteValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

private let researchWriteSchemaVersionV1 = "2026-06-18.research-write.v1"
private let decisionContextSchemaVersionV1 = "2026-06-23.core-1a.v1"
private let decisionCheckSchemaVersionV1 = "2026-06-23.pre-trade-check.v1"

public extension ResearchWriteEnvelope where T == DecisionCheckData {
    func validateForDisplay(
        market expectedMarket: String,
        code expectedCode: String,
        request: CreateDecisionCheckRequest
    ) throws {
        var errors: [String] = []
        validateResearchWriteEnvelopeBase(self, label: "decision check write", errors: &errors)
        data.validateWriteResponse(
            expectedMarket: expectedMarket,
            expectedCode: expectedCode,
            request: request,
            errors: &errors
        )
        if source.actorType != data.audit.actorType { errors.append("decision check write source.actorType must match audit.actorType") }
        if source.actorId != data.audit.actorId { errors.append("decision check write source.actorId must match audit.actorId") }
        if source.correlationId != data.audit.correlationId { errors.append("decision check write source.correlationId must match audit.correlationId") }
        if errors.isEmpty == false {
            throw DecisionWriteValidationError.invalid(errors)
        }
    }
}

public extension ResearchWriteEnvelope where T == PostDecisionReviewData {
    func validateForDisplay(
        market expectedMarket: String,
        code expectedCode: String,
        checkId: String,
        request: CreatePostDecisionReviewRequest? = nil
    ) throws {
        var errors: [String] = []
        validateResearchWriteEnvelopeBase(self, label: "post-decision review write", errors: &errors)
        data.validateWriteResponse(
            expectedMarket: expectedMarket,
            expectedCode: expectedCode,
            checkId: checkId,
            request: request,
            errors: &errors
        )
        validatePostDecisionReviewSourceAudit(errors: &errors)
        if errors.isEmpty == false {
            throw DecisionWriteValidationError.invalid(errors)
        }
    }
    func validatePortfolioReviewBinding(_ binding: PostDecisionPortfolioReviewBinding?) throws {
        guard data.portfolioReview.matches(binding: binding) else {
            throw DecisionWriteValidationError.invalid([
                "review portfolioReview must match the submitted portfolio review binding"
            ])
        }
    }
}

public extension ResearchWriteEnvelope where T == ResearchProfileData {
    func validateForDisplay(market expectedMarket: String, code expectedCode: String) throws {
        var errors: [String] = []
        validateResearchWriteEnvelopeBase(self, label: "research profile write", errors: &errors)
        validateCanonicalIdentity(data, expectedMarket: expectedMarket, expectedCode: expectedCode, label: "research profile write profile", errors: &errors)
        data.validateForDisplay(errors: &errors)
        if errors.isEmpty == false {
            throw DecisionWriteValidationError.invalid(errors)
        }
    }
}

public extension ResearchWriteEnvelope where T == EvidenceItemData {
    func validateForDisplay() throws {
        var errors: [String] = []
        validateResearchWriteEnvelopeBase(self, label: "research evidence write", errors: &errors)
        data.validateForDisplay(errors: &errors)
        if errors.isEmpty == false {
            throw DecisionWriteValidationError.invalid(errors)
        }
    }
}

public struct DecisionCheckData: Codable, Equatable, Sendable {
    public let id: String
    public let market: String
    public let code: String
    public let symbol: String
    public let decisionContextSchemaVersion: String
    public let decisionCheckSchemaVersion: String
    public let contextId: String
    public let contextHash: String
    public let actionIntent: String
    public let humanCheckResult: String
    public let userFinalDecision: String?
    public var reviewDueOn: String? = nil
    public var manualSourceBindings: [ManualDecisionSourceBinding]? = nil
    public var researchChangeBinding: OrdinaryResearchChangeBinding? = nil
    public let checkedAt: String
    public let decisionSnapshot: DecisionSnapshotState?
    public let conditionalDecision: AnnualConditionalDecisionState?
    public var researchReportDecision: ResearchReportDecisionState = .notCaptured
    public var formalDecision: FormalDecisionState = .notCaptured
    public let audit: DecisionCheckAudit
    public let safety: DecisionCheckSafety
}

public extension DecisionCheckData {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        market = try values.decode(String.self, forKey: .market)
        code = try values.decode(String.self, forKey: .code)
        symbol = try values.decode(String.self, forKey: .symbol)
        decisionContextSchemaVersion = try values.decode(String.self, forKey: .decisionContextSchemaVersion)
        decisionCheckSchemaVersion = try values.decode(String.self, forKey: .decisionCheckSchemaVersion)
        contextId = try values.decode(String.self, forKey: .contextId)
        contextHash = try values.decode(String.self, forKey: .contextHash)
        actionIntent = try values.decode(String.self, forKey: .actionIntent)
        humanCheckResult = try values.decode(String.self, forKey: .humanCheckResult)
        userFinalDecision = try values.decodeIfPresent(String.self, forKey: .userFinalDecision)
        reviewDueOn = values.contains(.reviewDueOn) ? try values.decode(String.self, forKey: .reviewDueOn) : nil
        manualSourceBindings = try values.decodeIfPresent([ManualDecisionSourceBinding].self, forKey: .manualSourceBindings)
        researchChangeBinding = try values.decodeIfPresent(OrdinaryResearchChangeBinding.self, forKey: .researchChangeBinding)
        checkedAt = try values.decode(String.self, forKey: .checkedAt)
        decisionSnapshot = try values.decodeIfPresent(DecisionSnapshotState.self, forKey: .decisionSnapshot)
        conditionalDecision = try values.decodeIfPresent(AnnualConditionalDecisionState.self, forKey: .conditionalDecision)
        researchReportDecision = try values.decodeIfPresent(ResearchReportDecisionState.self, forKey: .researchReportDecision) ?? .notCaptured
        formalDecision = try values.decodeIfPresent(FormalDecisionState.self, forKey: .formalDecision) ?? .notCaptured
        audit = try values.decode(DecisionCheckAudit.self, forKey: .audit)
        safety = try values.decode(DecisionCheckSafety.self, forKey: .safety)
    }
}

public struct DecisionCheckAudit: Codable, Equatable, Sendable {
    public let actorType: String
    public let actorId: String?
    public let idempotencyKey: String
    public let correlationId: String?
}

public struct DecisionCheckSafety: Codable, Equatable, Sendable {
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let mutatesCash: Bool
    public let writesFee: Bool
    public let mutatesPosition: Bool
    public let callsBroker: Bool
}

private extension DecisionCheckData {
    func validateWriteResponse(
        expectedMarket: String,
        expectedCode: String,
        request: CreateDecisionCheckRequest,
        errors: inout [String]
    ) {
        let canonical = "\(expectedMarket).\(expectedCode)"
        if market != expectedMarket { errors.append("decision check market must equal \(expectedMarket)") }
        if code != expectedCode { errors.append("decision check code must equal \(expectedCode)") }
        if symbol != canonical { errors.append("decision check symbol must equal \(canonical)") }
        if decisionContextSchemaVersion != request.decisionContextSchemaVersion
            || decisionContextSchemaVersion != decisionContextSchemaVersionV1 {
            errors.append("decision check schema must match request and \(decisionContextSchemaVersionV1)")
        }
        if decisionCheckSchemaVersion != decisionCheckSchemaVersionV1 {
            errors.append("decision check schema version must be \(decisionCheckSchemaVersionV1)")
        }
        if contextId != request.contextId {
            errors.append("decision check contextId must match request")
        }
        if contextHash != request.contextHash {
            errors.append("decision check contextHash must match request")
        }
        if id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision check id is required")
        }
        if DecisionActionIntent.allCases.map(\.rawValue).contains(actionIntent) == false {
            errors.append("decision check actionIntent is invalid")
        }
        if actionIntent != request.actionIntent { errors.append("decision check actionIntent must match request") }
        if ["ready_to_consider", "blocked", "needs_more_evidence"].contains(humanCheckResult) == false {
            errors.append("decision check humanCheckResult is invalid")
        }
        if humanCheckResult != request.humanCheckResult { errors.append("decision check humanCheckResult must match request") }
        if userFinalDecision != request.userFinalDecision { errors.append("decision check userFinalDecision must match request") }
        if reviewDueOn != request.reviewDueOn || reviewDueOn.map({ !isValidManualReviewDueOn($0) }) == true {
            errors.append("decision check reviewDueOn must match the valid request date")
        }
        if manualSourceBindings != request.manualSourceBindings {
            errors.append("decision check manual sources must match the submitted selection")
        }
        if researchChangeBinding != request.researchChangeBinding {
            errors.append("decision check research change must match the submitted selection")
        }
        if checkedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision check checkedAt is required")
        } else if isParseableDateTime(checkedAt) == false {
            errors.append("decision check checkedAt must be a valid date-time")
        }
        if let decisionSnapshot, let context = decisionSnapshot.snapshot?.decisionContext {
            do {
                try decisionSnapshot.validateForDisplay(decisionContext: context, binding: request.decisionSnapshotBinding)
                if decisionSnapshot.availability != .preserved { errors.append("decision check response must preserve the decision snapshot") }
                if context.schemaVersion != request.decisionContextSchemaVersion || context.contextId != request.contextId
                    || context.contextHash != request.contextHash {
                    errors.append("decision snapshot context must match decision check request")
                }
                if request.decisionSnapshotBinding == nil,
                   let snapshot = decisionSnapshot.snapshot,
                   snapshot.portfolioContext.state != .notCaptured || snapshot.portfolioContext.envelope != nil
                    || snapshot.riskImpact.availability != .notCaptured || snapshot.riskImpact.envelope != nil {
                    errors.append("ordinary decision snapshot must not capture portfolio or risk facts")
                }
            } catch {
                errors.append("decision check response decision snapshot is invalid")
            }
        } else { errors.append("decision check response must preserve decision context facts") }
        if let submission = request.conditionalDecision {
            do {
                try submission.judgment.validate()
                try conditionalDecision?.validate()
                if conditionalDecision?.availability != "preserved"
                    || conditionalDecision?.preview != submission.preview
                    || conditionalDecision?.judgment != submission.judgment
                    || actionIntent != "watch"
                    || humanCheckResult != submission.judgment.workflowState.humanCheckResult {
                    errors.append("decision check response must preserve the exact conditional preview and human judgment")
                }
            } catch {
                errors.append("decision check response conditional decision is invalid")
            }
        }
        let reportState = researchReportDecision
        do { try reportState.validate(expectedSymbol: symbol) }
        catch DecisionWriteValidationError.invalid(let reportErrors) { errors.append(contentsOf: reportErrors) }
        catch { errors.append("decision check response research report binding is invalid") }
        if let requested = request.researchReportBinding {
            if reportState.availability != "preserved" || reportState.binding != requested {
                errors.append("decision check response must preserve the exact submitted research report binding")
            }
            if request.conditionalDecision != nil || request.decisionSnapshotBinding == nil {
                errors.append("research report binding requires an exact decision snapshot and cannot coexist with a conditional decision")
            }
        }
        do {
            try formalDecision.validate(
                reportBinding: reportState.binding,
                actionIntent: actionIntent,
                label: "decision check formalDecision"
            )
            if let requested = request.formalDecision {
                if formalDecision.availability != "preserved"
                    || formalDecision.ownerDecision != requested
                    || requested.personalRisk != nil && formalDecision.personalRiskAssessment == nil {
                    errors.append("decision check response must preserve the exact Owner formal decision")
                }
            } else if formalDecision.availability != "not_captured" {
                errors.append("ordinary decision check must not invent a formal decision")
            }
        } catch DecisionWriteValidationError.invalid(let formalErrors) {
            errors.append(contentsOf: formalErrors)
        } catch { errors.append("decision check response formalDecision is invalid") }
        validateDecisionWriteAudit(audit, label: "decision check audit", errors: &errors)
        if audit.idempotencyKey != request.idempotencyKey { errors.append("decision check audit.idempotencyKey must match request") }
        validateNoSideEffects(safety, label: "decision check safety", errors: &errors)
    }
}

public enum DecisionReviewOutcome: String, Codable, CaseIterable, Equatable, Sendable {
    case thesisConfirmed = "thesis_confirmed"
    case thesisWeakened = "thesis_weakened"
    case thesisInvalidated = "thesis_invalidated"
    case insufficientEvidence = "insufficient_evidence"
}

public enum DecisionContextSnapshotAvailability: String, Codable, Equatable, Sendable {
    case preserved
    case contextSnapshotUnavailable = "context_snapshot_unavailable"
}

public enum DecisionReviewValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public enum DecisionContextValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct CreatePostDecisionReviewRequest: Codable, Equatable, Sendable {
    public let outcome: DecisionReviewOutcome
    public let outcomeEvidence: String?
    public let reviewNote: String?
    public let reviewedAt: String?
    public let portfolioReviewBinding: PostDecisionPortfolioReviewBinding?
    public let reviewLearning: AnnualReviewLearningRequest?
    public let dailyTrackingBinding: ResearchReportDecisionBinding?
    public let idempotencyKey: String

    public init(
        outcome: DecisionReviewOutcome,
        outcomeEvidence: String?,
        reviewNote: String?,
        reviewedAt: String?,
        portfolioReviewBinding: PostDecisionPortfolioReviewBinding? = nil,
        reviewLearning: AnnualReviewLearningRequest? = nil,
        dailyTrackingBinding: ResearchReportDecisionBinding? = nil,
        idempotencyKey: String
    ) {
        self.outcome = outcome
        self.outcomeEvidence = outcomeEvidence
        self.reviewNote = reviewNote
        self.reviewedAt = reviewedAt
        self.portfolioReviewBinding = portfolioReviewBinding
        self.reviewLearning = reviewLearning
        self.dailyTrackingBinding = dailyTrackingBinding
        self.idempotencyKey = idempotencyKey
    }
}

public struct DecisionReviewHistoryEnvelope: Codable, Equatable, Sendable {
    private static let schemaVersionV1 = "2026-06-28.core-1c-review.v1"
    private static let contextSchemaVersionV1 = "2026-06-23.core-1a.v1"
    private static let checkSchemaVersionV1 = "2026-06-23.pre-trade-check.v1"
    public let schemaVersion: String
    public let requestedSymbol: String
    public let metadata: FactMetadata
    public let checks: [RecordedDecisionCheckReviewState]
    public let deletions: [DecisionReviewDeletionData]?
    public let learningSummary: AnnualReviewLearningSummary?
    public let advisoryOnly: Bool
    public let safety: DecisionCheckSafety
    public let message: String

    public init(
        schemaVersion: String, requestedSymbol: String,
        metadata: FactMetadata, checks: [RecordedDecisionCheckReviewState],
        deletions: [DecisionReviewDeletionData]? = nil,
        learningSummary: AnnualReviewLearningSummary? = nil, advisoryOnly: Bool,
        safety: DecisionCheckSafety, message: String
    ) {
        self.schemaVersion = schemaVersion
        self.requestedSymbol = requestedSymbol
        self.metadata = metadata
        self.checks = checks
        self.deletions = deletions
        self.learningSummary = learningSummary
        self.advisoryOnly = advisoryOnly
        self.safety = safety
        self.message = message
    }

    public func validateForDisplay(market: String, code: String) throws {
        var errors: [String] = []
        let canonical = "\(market).\(code)"
        if schemaVersion != Self.schemaVersionV1 {
            errors.append("schemaVersion must be \(Self.schemaVersionV1)")
        }
        if requestedSymbol != canonical {
            errors.append("requestedSymbol must equal \(canonical)")
        }
        metadata.validateForDisplay(label: "decision review history", errors: &errors)
        if checks.isEmpty == false, metadata.freshness != "fresh" {
            errors.append("decision review history metadata freshness must be fresh when checks are present")
        }
        if metadata.freshness == "unavailable", checks.isEmpty == false {
            errors.append("decision review history unavailable metadata must not expose checks")
        }
        if metadata.provenance != "real" && metadata.provenance != "fixture" && metadata.provenance != "unavailable" {
            errors.append("decision review history metadata provenance must be real, fixture, or unavailable")
        }
        if metadata.authority != "decision_context" && metadata.authority != "unavailable" {
            errors.append("decision review history metadata authority must be decision_context or unavailable")
        }
        if advisoryOnly != true {
            errors.append("advisoryOnly must be true")
        }
        validateNoSideEffects(safety, label: "safety", errors: &errors)
        for check in checks {
            check.validateForDisplay(
                expectedMarket: market,
                expectedCode: code,
                requestedSymbol: canonical,
                contextSchemaVersion: Self.contextSchemaVersionV1,
                checkSchemaVersion: Self.checkSchemaVersionV1,
                errors: &errors
            )
        }
        var deletionIds = Set<String>()
        for deletion in deletions ?? [] {
            deletion.validate(expectedSymbol: canonical, errors: &errors)
            if !deletionIds.insert(deletion.id).inserted {
                errors.append("decision review deletion identities must be unique")
            }
        }
        do { try learningSummary?.validate(checks: checks) }
        catch { errors.append("decision review learning summary is invalid") }
        if errors.isEmpty == false {
            throw DecisionReviewValidationError.invalid(errors)
        }
    }
}

public struct DeleteDecisionCheckRequest: Encodable, Equatable, Sendable {
    public let expectedCheckedAt: String
    public let ownerConfirmed = true
    public let idempotencyKey: String
}

public struct DeletePostDecisionReviewRequest: Encodable, Equatable, Sendable {
    public let expectedCreatedAt: String
    public let ownerConfirmed = true
    public let idempotencyKey: String
}

public struct DecisionReviewDeletionData: Codable, Equatable, Identifiable, Sendable {
    public let kind: String
    public let decisionCheckId: String
    public let reviewId: String?
    public let symbol: String
    public let recordedAt: String
    public let deletedAt: String
    public let state: String

    public var id: String { "\(kind):\(decisionCheckId):\(reviewId ?? "-")" }

    func validate(expectedSymbol: String, errors: inout [String]) {
        if kind != "decision_check" && kind != "post_decision_review" { errors.append("deletion kind is invalid") }
        if decisionCheckId.isEmpty { errors.append("deletion decisionCheckId is required") }
        if kind == "decision_check" && reviewId != nil { errors.append("decision deletion reviewId must be null") }
        if kind == "post_decision_review" && (reviewId?.isEmpty != false) { errors.append("review deletion reviewId is required") }
        if symbol != expectedSymbol { errors.append("deletion symbol must match requested symbol") }
        if !isParseableDateTime(recordedAt) || !isParseableDateTime(deletedAt) { errors.append("deletion timestamps are invalid") }
        else if let recorded = parseInstant(recordedAt), let deleted = parseInstant(deletedAt), deleted < recorded {
            errors.append("deletion timestamp must not precede recorded time")
        }
        if state != "deleted" { errors.append("deletion state must be deleted") }
    }
}

public struct RecordedDecisionCheckReviewState: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let market: String
    public let code: String
    public let symbol: String
    public let decisionContextSchemaVersion: String
    public let decisionCheckSchemaVersion: String
    public let contextId: String
    public let contextHash: String
    public let actionIntent: String
    public let humanCheckResult: String
    public let userFinalDecision: String?
    public var reviewDueOn: String? = nil
    public var manualSourceBindings: [ManualDecisionSourceBinding]? = nil
    public var researchChangeBinding: OrdinaryResearchChangeBinding? = nil
    public let checkedAt: String
    public let contextSnapshot: DecisionContextSnapshotState
    public let decisionSnapshot: DecisionSnapshotState
    public let conditionalDecision: AnnualConditionalDecisionState?
    public var researchReportDecision: ResearchReportDecisionState = .notCaptured
    public var formalDecision: FormalDecisionState = .notCaptured
    public let reviews: [PostDecisionReviewData]
    public let safety: DecisionCheckSafety

    fileprivate func validateForDisplay(
        expectedMarket: String,
        expectedCode: String,
        requestedSymbol: String,
        contextSchemaVersion: String,
        checkSchemaVersion: String,
        errors: inout [String]
    ) {
        if market != expectedMarket {
            errors.append("check.market must equal \(expectedMarket)")
        }
        if code != expectedCode {
            errors.append("check.code must equal \(expectedCode)")
        }
        if symbol != "\(market).\(code)" {
            errors.append("check.symbol must equal canonical market/code identity")
        }
        if symbol != requestedSymbol {
            errors.append("check.symbol must equal requestedSymbol")
        }
        if contextId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("check.contextId is required")
        }
        if contextHash.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("check.contextHash is required")
        }
        if decisionContextSchemaVersion != contextSchemaVersion {
            errors.append("check.decisionContextSchemaVersion must be \(contextSchemaVersion)")
        }
        if decisionCheckSchemaVersion != checkSchemaVersion {
            errors.append("check.decisionCheckSchemaVersion must be \(checkSchemaVersion)")
        }
        if DecisionActionIntent.allCases.map(\.rawValue).contains(actionIntent) == false {
            errors.append("check.actionIntent must be buy, watch, add, hold, reduce, sell, abandon, or wait_for_evidence")
        }
        if ["ready_to_consider", "blocked", "needs_more_evidence"].contains(humanCheckResult) == false {
            errors.append("check.humanCheckResult must be ready_to_consider, blocked, or needs_more_evidence")
        }
        if checkedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("check.checkedAt is required")
        } else if isParseableDateTime(checkedAt) == false {
            errors.append("check.checkedAt must be a valid date-time")
        }
        if reviewDueOn.map({ !isValidManualReviewDueOn($0) }) == true {
            errors.append("check.reviewDueOn must be a valid YYYY-MM-DD date")
        }
        if let manualSourceBindings {
            let direct = manualSourceBindings.allSatisfy { $0.bindingKind == "saved_material" }
            if !(1...20).contains(manualSourceBindings.count)
                || Set(manualSourceBindings.map(\.sourceId)).count != manualSourceBindings.count
                || contextSnapshot.availability != .preserved {
                errors.append("check selected sources need distinct saved identities and preserved context")
            }
            if direct {
                let membershipIds = Set(manualSourceBindings.compactMap(\.membershipId))
                let versions = Set(manualSourceBindings.compactMap(\.membershipVersion))
                if membershipIds.count != 1 || versions.count != 1
                    || Set(manualSourceBindings.compactMap(\.materialId)).count != manualSourceBindings.count
                    || !manualSourceBindings.allSatisfy({ binding in
                        binding.evidenceId == nil && binding.membershipId?.isEmpty == false
                            && (binding.membershipVersion ?? 0) > 0
                            && binding.materialId?.isEmpty == false
                            && (binding.materialRevision ?? 0) > 0
                            && researchDocumentIsSha256(binding.materialFingerprint ?? "")
                            && researchDocumentIsSha256(binding.contentSha256)
                            && !binding.title.isEmpty
                            && (["owner_provided_pdf", "issuer_public_pdf"].contains(binding.sourceType)
                                ? binding.documentId != nil && binding.documentPdfSha256 != nil
                                    && (binding.pageNumber ?? 0) > 0 && binding.snapshotId == nil
                                : binding.sourceType == "issuer_public_html"
                                    ? binding.snapshotId != nil && binding.snapshotRawSha256 != nil
                                        && binding.documentId == nil && binding.pageNumber == nil
                                    : binding.sourceType == "futu_opend_financial_statement_provider"
                                        && binding.sourceUrl == nil && binding.contentSha256 == binding.materialFingerprint
                                        && binding.documentId == nil && binding.snapshotId == nil)
                    }) {
                    errors.append("check saved material sources have invalid identity or original coordinates")
                }
            } else if manualSourceBindings.contains(where: { $0.bindingKind == "saved_material" })
                || Set(manualSourceBindings.map(\.evidenceId)).count != manualSourceBindings.count
                || !manualSourceBindings.allSatisfy({ binding in
                    contextSnapshot.envelope?.research.evidence.contains(where: { evidence in
                        evidence.id == binding.evidenceId && evidence.sourceType == binding.sourceType
                            && evidence.sourceUrl == binding.sourceUrl
                    }) == true
                }) {
                errors.append("check selected sources must match preserved research evidence")
            }
        }
        if let researchChangeBinding {
            if researchChangeBinding.symbol != symbol || researchChangeBinding.membershipVersion < 1
                || researchChangeBinding.sourceMaterialRevision < 1
                || [researchChangeBinding.membershipId, researchChangeBinding.selectedFactId,
                    researchChangeBinding.sourceMaterialId, researchChangeBinding.previousDecisionCheckId]
                    .contains(where: { $0.range(of: "^[1-9][0-9]*$", options: .regularExpression) == nil })
                || !researchDocumentIsSha256(researchChangeBinding.changeId)
                || !researchDocumentIsSha256(researchChangeBinding.reasoningFingerprint)
                || !researchDocumentIsSha256(researchChangeBinding.sourceContentFingerprint)
                || !isParseableDateTime(researchChangeBinding.sourcePublishedAt) {
                errors.append("check research change identity or source time is invalid")
            }
            if userFinalDecision?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
                || formalDecision.availability == "preserved"
                || researchReportDecision.availability == "preserved"
                || conditionalDecision?.availability == "preserved" {
                errors.append("check research change must belong to an explicit ordinary judgment")
            }
        }
        switch contextSnapshot.availability {
        case .preserved:
            guard let envelope = contextSnapshot.envelope else {
                errors.append("preserved context snapshot requires envelope")
                break
            }
            envelope.validateForDisplay(errors: &errors)
            if envelope.schemaVersion != decisionContextSchemaVersion {
                errors.append("preserved context snapshot schemaVersion must match check decisionContextSchemaVersion")
            }
            if envelope.contextId != contextId {
                errors.append("preserved context snapshot contextId must match check contextId")
            }
            if envelope.contextHash != contextHash {
                errors.append("preserved context snapshot contextHash must match check contextHash")
            }
            if envelope.requestedSymbol != symbol {
                errors.append("preserved context snapshot requestedSymbol must match check symbol")
            }
        case .contextSnapshotUnavailable:
            if contextSnapshot.envelope != nil {
                errors.append("unavailable context snapshot must not carry envelope")
            }
            if contextSnapshot.limitation.contains("not reconstructed") == false {
                errors.append("unavailable context snapshot must disclose no reconstruction")
            }
        }
        do {
            let expectedContext = decisionSnapshot.snapshot?.decisionContext ?? contextSnapshot.envelope
            if let expectedContext {
                try decisionSnapshot.validateForDisplay(decisionContext: expectedContext)
                if expectedContext.contextId != contextId || expectedContext.contextHash != contextHash {
                    errors.append("decision snapshot context must match check context identity")
                }
            } else if decisionSnapshot.availability != .notCaptured {
                errors.append("preserved decision snapshot requires a decision context")
            }
        } catch {
            errors.append("check decision snapshot is invalid")
        }
        do {
            let conditional = conditionalDecision ?? .notCaptured
            try conditional.validate()
            if let preview = conditional.preview {
                let source = preview.data?.decisionBrief.data?.sourceIdentity
                if preview.requestedSymbol != symbol || source?.decisionContextId != contextId
                    || source?.decisionContextHash != contextHash {
                    errors.append("check conditional decision must match symbol and context identities")
                }
                if actionIntent != "watch"
                    || humanCheckResult != conditional.judgment?.workflowState.humanCheckResult {
                    errors.append("check conditional decision must preserve neutral watch workflow semantics")
                }
                do {
                    let expected = try conditionalSnapshotBinding(preview.data)
                    let actual = try decisionSnapshot.binding()
                    if expected != actual {
                        errors.append("check conditional decision must match the immutable portfolio and risk snapshot")
                    }
                } catch {
                    errors.append("check conditional decision requires a matching immutable portfolio and risk snapshot")
                }
            }
        } catch {
            errors.append("check conditional decision is invalid")
        }
        do { try researchReportDecision.validate(expectedSymbol: symbol) }
        catch DecisionWriteValidationError.invalid(let reportErrors) { errors.append(contentsOf: reportErrors) }
        catch { errors.append("check research report decision is invalid") }
        do {
            try formalDecision.validate(
                reportBinding: researchReportDecision.binding,
                actionIntent: actionIntent,
                label: "check.formalDecision"
            )
        } catch DecisionWriteValidationError.invalid(let formalErrors) {
            errors.append(contentsOf: formalErrors)
        } catch { errors.append("check formal decision is invalid") }
        validateNoSideEffects(safety, label: "check.safety", errors: &errors)
        for review in reviews {
            review.validateForDisplay(
                checkId: id,
                checkMarket: market,
                checkCode: code,
                requestedSymbol: requestedSymbol,
                decisionSnapshot: decisionSnapshot,
                conditionalDecision: conditionalDecision ?? .notCaptured,
                errors: &errors
            )
        }
    }
}

public extension RecordedDecisionCheckReviewState {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        market = try values.decode(String.self, forKey: .market)
        code = try values.decode(String.self, forKey: .code)
        symbol = try values.decode(String.self, forKey: .symbol)
        decisionContextSchemaVersion = try values.decode(String.self, forKey: .decisionContextSchemaVersion)
        decisionCheckSchemaVersion = try values.decode(String.self, forKey: .decisionCheckSchemaVersion)
        contextId = try values.decode(String.self, forKey: .contextId)
        contextHash = try values.decode(String.self, forKey: .contextHash)
        actionIntent = try values.decode(String.self, forKey: .actionIntent)
        humanCheckResult = try values.decode(String.self, forKey: .humanCheckResult)
        userFinalDecision = try values.decodeIfPresent(String.self, forKey: .userFinalDecision)
        reviewDueOn = values.contains(.reviewDueOn) ? try values.decode(String.self, forKey: .reviewDueOn) : nil
        manualSourceBindings = try values.decodeIfPresent([ManualDecisionSourceBinding].self, forKey: .manualSourceBindings)
        checkedAt = try values.decode(String.self, forKey: .checkedAt)
        contextSnapshot = try values.decode(DecisionContextSnapshotState.self, forKey: .contextSnapshot)
        decisionSnapshot = try values.decode(DecisionSnapshotState.self, forKey: .decisionSnapshot)
        conditionalDecision = try values.decodeIfPresent(AnnualConditionalDecisionState.self, forKey: .conditionalDecision)
        researchReportDecision = try values.decodeIfPresent(ResearchReportDecisionState.self, forKey: .researchReportDecision) ?? .notCaptured
        formalDecision = try values.decodeIfPresent(FormalDecisionState.self, forKey: .formalDecision) ?? .notCaptured
        reviews = try values.decode([PostDecisionReviewData].self, forKey: .reviews)
        safety = try values.decode(DecisionCheckSafety.self, forKey: .safety)
    }
}

private func conditionalSnapshotBinding(
    _ data: AnnualConditionalDecisionPreviewData?
) throws -> DecisionSnapshotBinding {
    guard let data else {
        throw AnnualConditionalDecisionValidationError.invalid([
            "conditional decision preview data is unavailable"
        ])
    }
    return try data.decisionSnapshotBinding()
}

public struct DecisionContextSnapshotState: Codable, Equatable, Sendable {
    public let availability: DecisionContextSnapshotAvailability
    public let envelope: DecisionContextEnvelope?
    public let limitation: String
}

public struct PostDecisionReviewData: Codable, Equatable, Identifiable, Sendable {
    private enum CodingKeys: String, CodingKey {
        case id
        case decisionCheckId
        case market
        case code
        case symbol
        case outcome
        case outcomeEvidence
        case reviewNote
        case reviewedAt
        case createdAt
        case portfolioReview
        case reviewLearning
        case audit
        case safety
    }

    public let id: String
    public let decisionCheckId: String
    public let market: String
    public let code: String
    public let symbol: String
    public let outcome: DecisionReviewOutcome
    public let outcomeEvidence: String?
    public let reviewNote: String?
    public let reviewedAt: String
    public let createdAt: String
    public let portfolioReview: PostDecisionPortfolioReviewState
    public let reviewLearning: AnnualReviewLearningState
    public let audit: DecisionCheckAudit
    public let safety: DecisionCheckSafety

    public init(
        id: String,
        decisionCheckId: String,
        market: String,
        code: String,
        symbol: String,
        outcome: DecisionReviewOutcome,
        outcomeEvidence: String?,
        reviewNote: String?,
        reviewedAt: String,
        createdAt: String,
        portfolioReview: PostDecisionPortfolioReviewState = .historicalNotCaptured,
        reviewLearning: AnnualReviewLearningState = .notCaptured,
        audit: DecisionCheckAudit,
        safety: DecisionCheckSafety
    ) {
        self.id = id
        self.decisionCheckId = decisionCheckId
        self.market = market
        self.code = code
        self.symbol = symbol
        self.outcome = outcome
        self.outcomeEvidence = outcomeEvidence
        self.reviewNote = reviewNote
        self.reviewedAt = reviewedAt
        self.createdAt = createdAt
        self.portfolioReview = portfolioReview
        self.reviewLearning = reviewLearning
        self.audit = audit
        self.safety = safety
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        decisionCheckId = try container.decode(String.self, forKey: .decisionCheckId)
        market = try container.decode(String.self, forKey: .market)
        code = try container.decode(String.self, forKey: .code)
        symbol = try container.decode(String.self, forKey: .symbol)
        outcome = try container.decode(DecisionReviewOutcome.self, forKey: .outcome)
        outcomeEvidence = try container.decodeIfPresent(String.self, forKey: .outcomeEvidence)
        reviewNote = try container.decodeIfPresent(String.self, forKey: .reviewNote)
        reviewedAt = try container.decode(String.self, forKey: .reviewedAt)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        portfolioReview = try container.decodeIfPresent(PostDecisionPortfolioReviewState.self, forKey: .portfolioReview)
            ?? .historicalNotCaptured
        reviewLearning = try container.decodeIfPresent(AnnualReviewLearningState.self, forKey: .reviewLearning)
            ?? .notCaptured
        audit = try container.decode(DecisionCheckAudit.self, forKey: .audit)
        safety = try container.decode(DecisionCheckSafety.self, forKey: .safety)
    }

    fileprivate func validateWriteResponse(
        expectedMarket: String,
        expectedCode: String,
        checkId: String,
        request: CreatePostDecisionReviewRequest?,
        errors: inout [String]
    ) {
        let canonical = "\(expectedMarket).\(expectedCode)"
        if decisionCheckId != checkId {
            errors.append("review decisionCheckId must match submitted check")
        }
        if market != expectedMarket {
            errors.append("review market must equal \(expectedMarket)")
        }
        if code != expectedCode {
            errors.append("review code must equal \(expectedCode)")
        }
        if symbol != canonical {
            errors.append("review symbol must equal \(canonical)")
        }
        if id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("review id is required")
        }
        if reviewedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("review.reviewedAt is required")
        } else if isParseableDateTime(reviewedAt) == false {
            errors.append("review.reviewedAt must be a valid date-time")
        }
        if createdAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("review.createdAt is required")
        } else if isParseableDateTime(createdAt) == false {
            errors.append("review.createdAt must be a valid date-time")
        }
        validateDecisionWriteAudit(audit, label: "review audit", errors: &errors)
        validateNoSideEffects(safety, label: "review safety", errors: &errors)
        do {
            try portfolioReview.validateForDisplay(expectedCheckId: checkId, expectedSymbol: canonical)
        } catch PostDecisionPortfolioReviewValidationError.invalid(let portfolioErrors) {
            errors.append(contentsOf: portfolioErrors)
        } catch {
            errors.append("review portfolioReview is invalid")
        }
        if let request, !portfolioReview.matches(binding: request.portfolioReviewBinding) {
            errors.append("review portfolioReview must match the submitted portfolio review binding")
        }
        if let request, !reviewLearning.matches(request: request.reviewLearning) {
            errors.append("review learning must match the submitted correction and identity binding")
        }
        validatePostDecisionReviewRequestEcho(request, errors: &errors)
    }
    fileprivate func validateForDisplay(
        checkId: String,
        checkMarket: String,
        checkCode: String,
        requestedSymbol: String,
        decisionSnapshot: DecisionSnapshotState,
        conditionalDecision: AnnualConditionalDecisionState,
        errors: inout [String]
    ) {
        if decisionCheckId != checkId {
            errors.append("review.decisionCheckId must match check id")
        }
        if market != checkMarket {
            errors.append("review.market must match check market")
        }
        if code != checkCode {
            errors.append("review.code must match check code")
        }
        if symbol != "\(market).\(code)" {
            errors.append("review.symbol must equal canonical market/code identity")
        }
        if symbol != requestedSymbol {
            errors.append("review.symbol must equal requestedSymbol")
        }
        do {
            try reviewLearning.validate(
                checkId: checkId,
                decisionSnapshot: decisionSnapshot,
                conditionalDecision: conditionalDecision
            )
        } catch {
            errors.append("review learning is invalid or does not match the frozen decision")
        }
        if reviewedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("review.reviewedAt is required")
        } else if isParseableDateTime(reviewedAt) == false {
            errors.append("review.reviewedAt must be a valid date-time")
        }
        if createdAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("review.createdAt is required")
        } else if isParseableDateTime(createdAt) == false {
            errors.append("review.createdAt must be a valid date-time")
        }
        if ["user", "system", "migration", "test"].contains(audit.actorType) == false {
            errors.append("review.audit.actorType must be user, system, migration, or test")
        }
        if let actorId = audit.actorId, actorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("review.audit.actorId must be non-empty when present")
        }
        if audit.idempotencyKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("review.audit.idempotencyKey is required")
        }
        if let correlationId = audit.correlationId, correlationId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("review.audit.correlationId must be non-empty when present")
        }
        validateNoSideEffects(safety, label: "review.safety", errors: &errors)
        do {
            try portfolioReview.validateForDisplay(
                decisionSnapshot: decisionSnapshot,
                expectedCheckId: checkId,
                expectedSymbol: requestedSymbol
            )
        } catch PostDecisionPortfolioReviewValidationError.invalid(let portfolioErrors) {
            errors.append(contentsOf: portfolioErrors)
        } catch {
            errors.append("review.portfolioReview is invalid")
        }
    }
}

private func validateNoSideEffects(_ safety: DecisionCheckSafety, label: String, errors: inout [String]) {
    if safety.createsOrder { errors.append("\(label).createsOrder must be false") }
    if safety.createsTrade { errors.append("\(label).createsTrade must be false") }
    if safety.mutatesCash { errors.append("\(label).mutatesCash must be false") }
    if safety.writesFee { errors.append("\(label).writesFee must be false") }
    if safety.mutatesPosition { errors.append("\(label).mutatesPosition must be false") }
    if safety.callsBroker { errors.append("\(label).callsBroker must be false") }
}

func validateResearchWriteEnvelopeBase<T: Codable & Equatable & Sendable>(
    _ envelope: ResearchWriteEnvelope<T>,
    label: String,
    errors: inout [String]
) {
    if envelope.schemaVersion != researchWriteSchemaVersionV1 {
        errors.append("\(label).schemaVersion must be \(researchWriteSchemaVersionV1)")
    }
    if envelope.status != "succeeded" {
        errors.append("\(label).status must be succeeded")
    }
    if envelope.asOf.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        errors.append("\(label).asOf is required")
    } else if isParseableDateTime(envelope.asOf) == false {
        errors.append("\(label).asOf must be a valid date-time")
    }
    if envelope.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        errors.append("\(label).message is required")
    }
    validateResearchWriteSource(envelope.source, label: "\(label).source", errors: &errors)
}

private func validateResearchWriteSource(_ source: ResearchWriteSource, label: String, errors: inout [String]) {
    if ["user", "system", "migration", "test"].contains(source.actorType) == false {
        errors.append("\(label).actorType is invalid")
    }
    if let actorId = source.actorId, actorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        errors.append("\(label).actorId must be non-empty when present")
    }
    if let correlationId = source.correlationId, correlationId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        errors.append("\(label).correlationId must be non-empty when present")
    }
}

private func validateDecisionWriteAudit(_ audit: DecisionCheckAudit, label: String, errors: inout [String]) {
    if ["user", "system", "migration", "test"].contains(audit.actorType) == false {
        errors.append("\(label).actorType is invalid")
    }
    if let actorId = audit.actorId, actorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        errors.append("\(label).actorId must be non-empty when present")
    }
    if audit.idempotencyKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        errors.append("\(label).idempotencyKey is required")
    }
    if let correlationId = audit.correlationId, correlationId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        errors.append("\(label).correlationId must be non-empty when present")
    }
}

public struct DecisionContextEnvelope: Codable, Equatable, Sendable {
    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case contextId
        case contextHash
        case generatedAt
        case requestedSymbol
        case provenance
        case quote
        case research
        case suggestionSummary
        case quantEvidence
        case portfolio
        case message
    }

    public let schemaVersion: String
    public let contextId: String
    public let contextHash: String
    public let generatedAt: String
    public let requestedSymbol: String
    public let provenance: DecisionContextProvenance
    public let quote: DecisionContextQuote
    public let research: DecisionContextResearch
    public let suggestionSummary: DecisionSuggestionSummary
    public let quantEvidence: DecisionQuantEvidence
    public let portfolio: DecisionPortfolioContext
    public let message: String

    public init(
        schemaVersion: String,
        contextId: String,
        contextHash: String,
        generatedAt: String,
        requestedSymbol: String,
        provenance: DecisionContextProvenance,
        quote: DecisionContextQuote,
        research: DecisionContextResearch,
        suggestionSummary: DecisionSuggestionSummary,
        quantEvidence: DecisionQuantEvidence = .missing(),
        portfolio: DecisionPortfolioContext,
        message: String
    ) {
        self.schemaVersion = schemaVersion
        self.contextId = contextId
        self.contextHash = contextHash
        self.generatedAt = generatedAt
        self.requestedSymbol = requestedSymbol
        self.provenance = provenance
        self.quote = quote
        self.research = research
        self.suggestionSummary = suggestionSummary
        self.quantEvidence = quantEvidence
        self.portfolio = portfolio
        self.message = message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        self.contextId = try container.decode(String.self, forKey: .contextId)
        self.contextHash = try container.decode(String.self, forKey: .contextHash)
        self.generatedAt = try container.decode(String.self, forKey: .generatedAt)
        self.requestedSymbol = try container.decode(String.self, forKey: .requestedSymbol)
        self.provenance = try container.decode(DecisionContextProvenance.self, forKey: .provenance)
        self.quote = try container.decode(DecisionContextQuote.self, forKey: .quote)
        self.research = try container.decode(DecisionContextResearch.self, forKey: .research)
        self.suggestionSummary = try container.decode(DecisionSuggestionSummary.self, forKey: .suggestionSummary)
        self.quantEvidence = try container.decodeIfPresent(DecisionQuantEvidence.self, forKey: .quantEvidence) ?? .missing()
        self.portfolio = try container.decode(DecisionPortfolioContext.self, forKey: .portfolio)
        self.message = try container.decode(String.self, forKey: .message)
    }

    public func validateForDisplay(market expectedMarket: String, code expectedCode: String) throws {
        var errors: [String] = []
        let canonical = "\(expectedMarket).\(expectedCode)"
        validateForDisplay(errors: &errors)
        if requestedSymbol != canonical {
            errors.append("decision context requestedSymbol must equal \(canonical)")
        }
        validateCanonicalIdentity(quote.data, expectedMarket: expectedMarket, expectedCode: expectedCode, label: "decision context quote", errors: &errors)
        validateCanonicalIdentity(research.profile, expectedMarket: expectedMarket, expectedCode: expectedCode, label: "decision context research profile", errors: &errors)
        if errors.isEmpty == false {
            throw DecisionContextValidationError.invalid(errors)
        }
    }

    fileprivate func validateForDisplay(errors: inout [String]) {
        if schemaVersion != "2026-06-23.core-1a.v1" {
            errors.append("decision context schemaVersion is invalid")
        }
        if contextId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision context contextId is required")
        }
        if contextHash.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision context contextHash is required")
        }
        if generatedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision context generatedAt is required")
        } else if isParseableDateTime(generatedAt) == false {
            errors.append("decision context generatedAt must be a valid date-time")
        }
        if requestedSymbol.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision context requestedSymbol is required")
        }
        if provenance.quote != "persisted_market_quotes" ||
            provenance.research != "research_profiles_evidence_suggestions" ||
            provenance.quant != "quant_research_evidence" ||
            provenance.portfolio != "omitted" {
            errors.append("decision context provenance is invalid")
        }
        let quoteStatuses = ["fresh", "stale", "unavailable", "empty", "permission_denied"]
        if quoteStatuses.contains(quote.status) == false {
            errors.append("decision context quote.status is invalid")
        }
        if quote.status == "fresh" || quote.status == "stale" {
            if quote.data == nil {
                errors.append("decision context quote data is required for fresh or stale quote")
            }
        } else if quote.data != nil {
            errors.append("decision context quote data must be nil unless fresh or stale")
        }
        if quote.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision context quote.message is required")
        }
        if let metadata = quote.metadata {
            metadata.validateForDisplay(label: "decision context quote", errors: &errors)
            if quote.status == "fresh", metadata.freshness != "fresh" {
                errors.append("decision context quote metadata freshness must be fresh")
            }
            if quote.status == "stale", metadata.freshness != "stale" {
                errors.append("decision context quote metadata freshness must be stale")
            }
            if quote.status == "empty", metadata.freshness != "missing" {
                errors.append("decision context quote metadata freshness must be missing")
            }
            if (quote.status == "unavailable" || quote.status == "permission_denied"), metadata.freshness == "fresh" {
                errors.append("decision context quote metadata must not be fresh when unavailable")
            }
        } else {
            errors.append("decision context quote metadata is required")
        }
        if let fetchedAt = quote.fetchedAt, fetchedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision context quote.fetchedAt must be non-empty when present")
        } else if let fetchedAt = quote.fetchedAt, isParseableDateTime(fetchedAt) == false {
            errors.append("decision context quote.fetchedAt must be a valid date-time")
        }
        validateDecisionContextQuoteChronology(quote, generatedAt: generatedAt, errors: &errors)
        let researchStatuses = ["available", "no_evidence", "stale_evidence", "unavailable", "unauthorized"]
        if researchStatuses.contains(research.status) == false {
            errors.append("decision context research.status is invalid")
        }
        if research.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision context research.message is required")
        }
        if let metadata = research.metadata {
            metadata.validateForDisplay(label: "decision context research", errors: &errors)
            if research.status == "available", metadata.freshness != "fresh" {
                errors.append("decision context research metadata freshness must be fresh")
            }
            if research.status == "stale_evidence", metadata.freshness != "stale" {
                errors.append("decision context research metadata freshness must be stale")
            }
            if research.status == "no_evidence", metadata.freshness != "missing" {
                errors.append("decision context research metadata freshness must be missing")
            }
            if (research.status == "unavailable" || research.status == "unauthorized"), metadata.freshness == "fresh" {
                errors.append("decision context research metadata must not be fresh when unavailable")
            }
        } else {
            errors.append("decision context research metadata is required")
        }
        if let evidenceAsOf = research.evidenceAsOf, evidenceAsOf.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision context research.evidenceAsOf must be non-empty when present")
        } else if let evidenceAsOf = research.evidenceAsOf, isParseableDateTime(evidenceAsOf) == false {
            errors.append("decision context research.evidenceAsOf must be a valid date-time")
        }
        let summaryStatuses = ["available", "uncertain", "unavailable"]
        if summaryStatuses.contains(suggestionSummary.status) == false {
            errors.append("decision context suggestionSummary.status is invalid")
        }
        if suggestionSummary.kind != "advisory_information" {
            errors.append("decision context suggestionSummary.kind must be advisory_information")
        }
        if suggestionSummary.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision context suggestionSummary.summary is required")
        }
        if portfolio.status != "omitted" ||
            portfolio.reason != "authoritative_portfolio_source_not_approved" {
            errors.append("decision context portfolio must be omitted")
        }
        quantEvidence.validateForDisplay(expectedSymbol: requestedSymbol, availableBy: generatedAt, errors: &errors)
    }
}
private func validateCanonicalIdentity(
    _ value: MarketQuoteData?,
    expectedMarket: String,
    expectedCode: String,
    label: String,
    errors: inout [String]
) {
    guard let value else { return }
    validateCanonicalIdentity(
        market: value.market,
        code: value.code,
        symbol: value.symbol,
        expectedMarket: expectedMarket,
        expectedCode: expectedCode,
        label: label,
        errors: &errors
    )
}

private func validateCanonicalIdentity(
    _ value: ResearchProfileData?,
    expectedMarket: String,
    expectedCode: String,
    label: String,
    errors: inout [String]
) {
    guard let value else { return }
    validateCanonicalIdentity(
        market: value.market,
        code: value.code,
        symbol: value.symbol,
        expectedMarket: expectedMarket,
        expectedCode: expectedCode,
        label: label,
        errors: &errors
    )
}

private func validateCanonicalIdentity(
    market: String,
    code: String,
    symbol: String,
    expectedMarket: String,
    expectedCode: String,
    label: String,
    errors: inout [String]
) {
    let expectedSymbol = "\(expectedMarket).\(expectedCode)"
    if market != expectedMarket {
        errors.append("\(label) market must equal \(expectedMarket)")
    }
    if code != expectedCode {
        errors.append("\(label) code must equal \(expectedCode)")
    }
    if symbol != expectedSymbol {
        errors.append("\(label) symbol must equal \(expectedSymbol)")
    }
}

public struct DecisionContextProvenance: Codable, Equatable, Sendable {
    private enum CodingKeys: String, CodingKey {
        case quote
        case research
        case quant
        case portfolio
    }

    public let quote: String
    public let research: String
    public let quant: String
    public let portfolio: String

    public init(quote: String, research: String, quant: String = "quant_research_evidence", portfolio: String) {
        self.quote = quote
        self.research = research
        self.quant = quant
        self.portfolio = portfolio
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.quote = try container.decode(String.self, forKey: .quote)
        self.research = try container.decode(String.self, forKey: .research)
        self.quant = try container.decodeIfPresent(String.self, forKey: .quant) ?? "quant_research_evidence"
        self.portfolio = try container.decode(String.self, forKey: .portfolio)
    }
}

public struct DecisionContextQuote: Codable, Equatable, Sendable {
    public let status: String
    public let snapshotId: String?
    public let fetchedAt: String?
    public let source: String?
    public let staleReason: String?
    public let data: MarketQuoteData?
    public let message: String
    public let metadata: FactMetadata?

    public init(
        status: String,
        snapshotId: String?,
        fetchedAt: String?,
        source: String?,
        staleReason: String?,
        data: MarketQuoteData?,
        message: String,
        metadata: FactMetadata? = nil
    ) {
        self.status = status
        self.snapshotId = snapshotId
        self.fetchedAt = fetchedAt
        self.source = source
        self.staleReason = staleReason
        self.data = data
        self.message = message
        self.metadata = metadata
    }
}

public struct DecisionContextResearch: Codable, Equatable, Sendable {
    public let status: String
    public let profile: ResearchProfileData?
    public let evidence: [EvidenceItemData]
    public let suggestions: [AiUpdateSuggestionData]
    public let evidenceAsOf: String?
    public let staleReason: String?
    public let message: String
    public let metadata: FactMetadata?

    public init(
        status: String,
        profile: ResearchProfileData?,
        evidence: [EvidenceItemData],
        suggestions: [AiUpdateSuggestionData],
        evidenceAsOf: String?,
        staleReason: String?,
        message: String,
        metadata: FactMetadata? = nil
    ) {
        self.status = status
        self.profile = profile
        self.evidence = evidence
        self.suggestions = suggestions
        self.evidenceAsOf = evidenceAsOf
        self.staleReason = staleReason
        self.message = message
        self.metadata = metadata
    }
}

public struct DecisionQuantEvidence: Codable, Equatable, Sendable {
    public let status: String
    public let metadata: FactMetadata
    public let identities: DecisionQuantEvidenceIdentities?
    public let sampleBoundary: DecisionQuantEvidenceSampleBoundary
    public let limitations: [String]
    public let authority: DecisionQuantEvidenceAuthority
    public let decisionEvidence: QuantDecisionEvidenceRefinement?
    public let comparison: QuantExperimentComparison?
    public let message: String

    public init(status: String, metadata: FactMetadata, identities: DecisionQuantEvidenceIdentities?,
                sampleBoundary: DecisionQuantEvidenceSampleBoundary, limitations: [String],
                authority: DecisionQuantEvidenceAuthority, decisionEvidence: QuantDecisionEvidenceRefinement?,
                comparison: QuantExperimentComparison? = nil, message: String) {
        self.status = status; self.metadata = metadata; self.identities = identities
        self.sampleBoundary = sampleBoundary; self.limitations = limitations; self.authority = authority
        self.decisionEvidence = decisionEvidence; self.comparison = comparison; self.message = message
    }

    public static func missing() -> DecisionQuantEvidence {
        DecisionQuantEvidence(
            status: "missing",
            metadata: FactMetadata(
                source: "decision_context.quant:missing:not-decoded",
                asOf: nil,
                fetchedAt: nil,
                freshness: "missing",
                provenance: "quant_evidence",
                authority: "quant_evidence",
                stale: false,
                missing: true,
                conflict: false,
                fixture: false,
                correctionOf: nil,
                replaces: nil,
                message: "Quant evidence is missing from this context."
            ),
            identities: nil,
            sampleBoundary: DecisionQuantEvidenceSampleBoundary(
                universe: [],
                sourceClassification: "unavailable",
                finalTestPolicy: "unavailable",
                limitation: "No quant evidence is reused."
            ),
            limitations: ["Quant evidence is missing and no stale quant context is displayed."],
            authority: .safeReadOnly,
            decisionEvidence: .unavailable("Quant evidence is missing and no refined facts are exposed."),
            message: "Quant evidence is missing."
        )
    }

    public func validateForDisplay(expectedSymbol: String, availableBy: String, errors: inout [String]) {
        let statuses = ["available", "missing", "stale", "malformed", "conflict", "unavailable", "unauthorized"]
        if statuses.contains(status) == false {
            errors.append("decision context quantEvidence.status is invalid")
        }
        metadata.validateForDisplay(label: "decision context quantEvidence", errors: &errors)
        if metadata.provenance != "quant_evidence" {
            errors.append("decision context quantEvidence metadata provenance must be quant_evidence")
        }
        if metadata.authority != "quant_evidence" {
            errors.append("decision context quantEvidence metadata authority must be quant_evidence")
        }
        if status == "available" {
            if identities == nil {
                errors.append("decision context quantEvidence identities are required when available")
            }
            if metadata.freshness != "fresh" && metadata.freshness != "historical" {
                errors.append("decision context quantEvidence metadata freshness must be fresh or historical when available")
            }
        } else if identities != nil {
            errors.append("decision context quantEvidence identities must be nil unless available")
        }
        validateDecisionQuantEvidenceChronology(self, availableBy: availableBy, errors: &errors)
        if status == "missing", metadata.freshness != "missing" {
            errors.append("decision context quantEvidence missing status requires missing freshness")
        }
        if status == "stale", metadata.freshness != "stale" {
            errors.append("decision context quantEvidence stale status requires stale freshness")
        }
        if status == "conflict", metadata.freshness != "conflict" {
            errors.append("decision context quantEvidence conflict status requires conflict freshness")
        }
        if ["malformed", "unavailable", "unauthorized"].contains(status), metadata.freshness == "fresh" {
            errors.append("decision context quantEvidence fail-closed status must not be fresh")
        }
        identities?.validateForDisplay(errors: &errors)
        sampleBoundary.validateForDisplay(errors: &errors)
        if status == "available", !sampleBoundary.universe.contains(expectedSymbol) {
            errors.append("decision context quantEvidence universe must include requestedSymbol when available")
        }
        if limitations.isEmpty || limitations.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            errors.append("decision context quantEvidence limitations must be non-empty")
        }
        authority.validateForDisplay(errors: &errors)
        decisionEvidence?.validateForDisplay(
            expectedSymbol: expectedSymbol,
            outerStatus: status,
            outerIdentities: identities,
            outerUniverse: sampleBoundary.universe,
            errors: &errors
        )
        comparison?.validate(evidence: self, errors: &errors)
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision context quantEvidence message is required")
        }
    }
}
public struct DecisionQuantEvidenceIdentities: Codable, Equatable, Sendable {
    public let frozenSnapshot: DecisionQuantFrozenSnapshotIdentity
    public let baselineExperimentIdentity: String
    public let splitIds: [String]
    public let shadowPortfolioIdentity: String
    public let shadowPortfolioId: String
    public let generatedAt: String
    public let hkConnectUniverse: CandidateDiscoveryUniverse?

    public init(
        frozenSnapshot: DecisionQuantFrozenSnapshotIdentity,
        baselineExperimentIdentity: String,
        splitIds: [String],
        shadowPortfolioIdentity: String,
        shadowPortfolioId: String,
        generatedAt: String,
        hkConnectUniverse: CandidateDiscoveryUniverse? = nil
    ) {
        self.frozenSnapshot = frozenSnapshot
        self.baselineExperimentIdentity = baselineExperimentIdentity
        self.splitIds = splitIds
        self.shadowPortfolioIdentity = shadowPortfolioIdentity
        self.shadowPortfolioId = shadowPortfolioId
        self.generatedAt = generatedAt
        self.hkConnectUniverse = hkConnectUniverse
    }

    fileprivate func validateForDisplay(errors: inout [String]) {
        frozenSnapshot.validateForDisplay(errors: &errors)
        for (label, value) in [
            ("baselineExperimentIdentity", baselineExperimentIdentity),
            ("shadowPortfolioIdentity", shadowPortfolioIdentity),
            ("shadowPortfolioId", shadowPortfolioId),
            ("generatedAt", generatedAt)
        ] where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision context quantEvidence identities \(label) is required")
        }
        if isParseableDateTime(generatedAt) == false {
            errors.append("decision context quantEvidence identities generatedAt must be a valid date-time")
        }
        if splitIds.isEmpty || splitIds.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            errors.append("decision context quantEvidence splitIds must be non-empty")
        }
        if let hkConnectUniverse, !hkConnectUniverse.isValidOfficialHongKongConnectBinding {
            errors.append("decision context quantEvidence official Hong Kong Connect universe binding is invalid")
        }
    }
}

public struct DecisionQuantFrozenSnapshotIdentity: Codable, Equatable, Sendable {
    public let snapshotId: String
    public let snapshotHash: String
    public let dataHash: String
    public let sourceClassification: String

    fileprivate func validateForDisplay(errors: inout [String]) {
        for (label, value) in [
            ("snapshotId", snapshotId),
            ("snapshotHash", snapshotHash),
            ("dataHash", dataHash)
        ] where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision context quantEvidence frozenSnapshot \(label) is required")
        }
        if ["fixture", "real", "historical", "research_only"].contains(sourceClassification) == false {
            errors.append("decision context quantEvidence frozenSnapshot sourceClassification is invalid")
        }
    }
}

public struct DecisionQuantEvidenceSampleBoundary: Codable, Equatable, Sendable {
    public let universe: [String]
    public let sourceClassification: String
    public let finalTestPolicy: String
    public let limitation: String

    fileprivate func validateForDisplay(errors: inout [String]) {
        if universe.contains(where: { $0.range(of: #"^HK\.[0-9]{5}$"#, options: .regularExpression) == nil }) {
            errors.append("decision context quantEvidence universe must contain canonical HK symbols")
        }
        if ["fixture", "real", "historical", "research_only", "unavailable"].contains(sourceClassification) == false {
            errors.append("decision context quantEvidence sample sourceClassification is invalid")
        }
        if ["locked_report_only_no_tuning", "unavailable"].contains(finalTestPolicy) == false {
            errors.append("decision context quantEvidence finalTestPolicy is invalid")
        }
        if limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision context quantEvidence sample limitation is required")
        }
    }
}

public struct DecisionQuantEvidenceAuthority: Codable, Equatable, Sendable {
    public let researchOnly: Bool
    public let advisoryOnly: Bool
    public let changesCandidateOrdering: Bool
    public let changesMembershipState: Bool
    public let changesHumanReviewResult: Bool
    public let mutatesLocalRecord: Bool
    public let officialReviewFact: Bool
    public let officialPortfolioFact: Bool
    public let brokerWrite: Bool
    public let recommendation: Bool
    public let ranking: Bool
    public let score: Bool
    public let allocation: Bool
    public let sizing: Bool
    public let targetPrice: Bool
    public let buySellHold: Bool
    public let orderTradeFillAuthority: Bool
    public let cashFeePositionMutation: Bool

    public static let safeReadOnly = DecisionQuantEvidenceAuthority(
        researchOnly: true,
        advisoryOnly: true,
        changesCandidateOrdering: false,
        changesMembershipState: false,
        changesHumanReviewResult: false,
        mutatesLocalRecord: false,
        officialReviewFact: false,
        officialPortfolioFact: false,
        brokerWrite: false,
        recommendation: false,
        ranking: false,
        score: false,
        allocation: false,
        sizing: false,
        targetPrice: false,
        buySellHold: false,
        orderTradeFillAuthority: false,
        cashFeePositionMutation: false
    )

    fileprivate func validateForDisplay(errors: inout [String]) {
        if researchOnly != true || advisoryOnly != true {
            errors.append("decision context quantEvidence authority must be research-only advisory-only")
        }
        if changesCandidateOrdering || changesMembershipState || changesHumanReviewResult || mutatesLocalRecord ||
            officialReviewFact || officialPortfolioFact || brokerWrite || recommendation || ranking || score ||
            allocation || sizing || targetPrice || buySellHold || orderTradeFillAuthority || cashFeePositionMutation {
            errors.append("decision context quantEvidence authority must not change ordering review local records official facts broker writes or trading lanes")
        }
    }
}

public struct DecisionSuggestionSummary: Codable, Equatable, Sendable {
    public let status: String
    public let kind: String
    public let summary: String
    public let linkedEvidenceIds: [String]
    public let limitations: [String]
}

public struct DecisionPortfolioContext: Codable, Equatable, Sendable {
    public let status: String
    public let reason: String
    public let message: String
}

public enum PinganSnapshotStatus: String, Codable, CaseIterable, Equatable, Sendable {
    case available
    case empty
    case stale
    case unavailable
    case unauthorized
    case sourceConflict = "source_conflict"
    case notApproved = "not_approved"
}

public enum PinganSnapshotFreshness: String, Codable, Equatable, Sendable {
    case historical
    case stale
}

public enum PinganSnapshotValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct PinganSnapshotEnvelope: Codable, Equatable, Sendable {
    private static let schemaVersionV1 = "2026-06-27.core-1b-pingan-snapshot.v1"
    private static let approvedSourceSystem = "pingan_imported_snapshot"

    public let schemaVersion: String
    public let status: PinganSnapshotStatus
    public let requestedSymbol: String
    public let sourceSystem: String?
    public let sourceSnapshotId: String?
    public let sourceAsOf: String?
    public let importedAt: String?
    public let fetchedAt: String?
    public let freshness: PinganSnapshotFreshness?
    public let limitation: String
    public let warning: String?
    public let positions: [PinganSnapshotPositionData]
    public let positionCount: Int
    public let dataUse: PinganSnapshotDataUse
    public let safety: PinganSnapshotSafety
    public let message: String

    public var hasDisplayablePositions: Bool {
        switch status {
        case .stale:
            guard let requested = requestedIdentity else { return false }
            return (try? validateForDisplay(market: requested.market, code: requested.code)) != nil
        case .available, .empty, .unavailable, .unauthorized, .sourceConflict, .notApproved:
            return false
        }
    }

    public var stateMessage: String {
        switch status {
        case .available:
            return "平安导入快照不能以 available 展示；必须作为历史 stale 快照并带警示。"
        case .stale:
            return "这是上次导入的历史平安持仓快照，可能不符合当前持仓。"
        case .empty:
            return "平安导入快照当前没有可展示持仓。"
        case .unavailable:
            return "平安导入快照不可用，不能展示持仓。"
        case .unauthorized:
            return "未授权查看平安导入快照，不能展示持仓。"
        case .sourceConflict:
            return "平安导入快照来源存在冲突，已阻止展示持仓。"
        case .notApproved:
            return "Fail closed：当前来源未获批准，不能展示为真实持仓。"
        }
    }

    public func validateForDisplay(market: String, code: String) throws {
        var errors: [String] = []
        let requested = (market: market, code: code, canonical: "\(market).\(code)")

        if schemaVersion != Self.schemaVersionV1 {
            errors.append("schemaVersion must be \(Self.schemaVersionV1)")
        }
        if requestedSymbol != requested.canonical {
            errors.append("requestedSymbol must equal \(requested.canonical)")
        }
        if positionCount != positions.count {
            errors.append("positionCount must equal positions.count")
        }
        validateSafety(errors: &errors)

        switch status {
        case .available:
            errors.append("Pingan snapshots with positions must use stale historical-only status, not available")
        case .stale:
            validateDisplayableEnvelope(requested: requested, errors: &errors)
        case .empty, .unavailable, .unauthorized, .sourceConflict, .notApproved:
            validateBlockedEnvelope(errors: &errors)
        }

        if errors.isEmpty == false {
            throw PinganSnapshotValidationError.invalid(errors)
        }
    }

    private func validateDisplayableEnvelope(requested: (market: String, code: String, canonical: String), errors: inout [String]) {
        if sourceSystem != Self.approvedSourceSystem {
            errors.append("sourceSystem must be \(Self.approvedSourceSystem)")
        }
        if sourceSnapshotId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
            errors.append("sourceSnapshotId is required")
        }
        if sourceAsOf?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
            errors.append("sourceAsOf is required")
        } else if let sourceAsOf, isStrictUtcDateTime(sourceAsOf) == false {
            errors.append("sourceAsOf must be a valid date-time")
        }
        if importedAt?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false,
           fetchedAt?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
            errors.append("importedAt or fetchedAt is required")
        }
        if let importedAt, isStrictUtcDateTime(importedAt) == false {
            errors.append("importedAt must be a valid date-time")
        }
        if let fetchedAt, isStrictUtcDateTime(fetchedAt) == false {
            errors.append("fetchedAt must be a valid date-time")
        }
        if warning?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
            errors.append("warning is required")
        }
        validateHistoricalOnlyDisclosure(errors: &errors)
        if positions.isEmpty {
            errors.append("positions are required")
        }
        if dataUse.display != "allowed_with_warning" {
            errors.append("dataUse.display must be allowed_with_warning")
        }
        if dataUse.riskImpact != "blocked_stale_historical_only" {
            errors.append("dataUse.riskImpact must be blocked_stale_historical_only")
        }
        if dataUse.brokerReconciliation != "blocked_not_live_authoritative" {
            errors.append("dataUse.brokerReconciliation must be blocked_not_live_authoritative")
        }
        if dataUse.accountTruth != "blocked_not_live_authoritative" {
            errors.append("dataUse.accountTruth must be blocked_not_live_authoritative")
        }
        if dataUse.accounting != "blocked_not_accounting_authority" {
            errors.append("dataUse.accounting must be blocked_not_accounting_authority")
        }
        if dataUse.execution != "blocked_not_execution_input" {
            errors.append("dataUse.execution must be blocked_not_execution_input")
        }
        for position in positions {
            validatePosition(position, requested: requested, errors: &errors)
        }
    }

    private func validateHistoricalOnlyDisclosure(errors: inout [String]) {
        let disclosure = "\(limitation) \(warning ?? "")".lowercased()
        let required = [
            ("last-imported", ["last-imported", "last imported"]),
            ("historical", ["historical"]),
            ("not-live", ["not-live", "not live", "no live"]),
            ("not-authoritative", ["not-authoritative", "not authoritative"]),
            ("no-broker-reconciliation", ["broker reconciliation", "broker-reconciled", "broker reconciled", "broker sync"]),
            ("no-account-truth", ["account truth"]),
            ("no-accounting-authority", ["accounting"]),
            ("no-execution-input", ["execution"]),
            ("no-risk-impact", ["risk-impact", "risk impact"])
        ]
        for (label, tokens) in required where tokens.contains(where: { disclosure.contains($0) }) == false {
            errors.append("stale historical Pingan disclosure must include \(label)")
        }
    }

    private func validateBlockedEnvelope(errors: inout [String]) {
        if positions.isEmpty == false {
            errors.append("positions must be empty for blocked states")
        }
        if positionCount != 0 {
            errors.append("positionCount must be 0 for blocked states")
        }
        if dataUse.display != "blocked" {
            errors.append("dataUse.display must be blocked")
        }
        if dataUse.riskImpact != "blocked" {
            errors.append("dataUse.riskImpact must be blocked")
        }
        if dataUse.brokerReconciliation != "blocked" {
            errors.append("dataUse.brokerReconciliation must be blocked")
        }
        if dataUse.accountTruth != "blocked" {
            errors.append("dataUse.accountTruth must be blocked")
        }
        if dataUse.accounting != "blocked" {
            errors.append("dataUse.accounting must be blocked")
        }
        if dataUse.execution != "blocked" {
            errors.append("dataUse.execution must be blocked")
        }
    }

    private func validatePosition(_ position: PinganSnapshotPositionData, requested: (market: String, code: String, canonical: String), errors: inout [String]) {
        if position.market != requested.market {
            errors.append("position.market must equal \(requested.market)")
        }
        if position.code != requested.code {
            errors.append("position.code must equal \(requested.code)")
        }
        if position.symbol != requested.canonical {
            errors.append("position.symbol must equal \(requested.canonical)")
        }
        if position.sourceRowId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("position.sourceRowId is required")
        }
        if position.quantity.isFinite == false || position.quantity < 0 {
            errors.append("position.quantity must be finite and nonnegative")
        }
        for (field, value) in [
            ("averageCost", position.averageCost),
            ("currentWeight", position.currentWeight),
            ("maxWeight", position.maxWeight),
            ("unrealizedPnl", position.unrealizedPnl)
        ] where value?.isFinite == false {
            errors.append("position.\(field) must be finite when present")
        }
    }

    private func validateSafety(errors: inout [String]) {
        if safety.readOnly != true {
            errors.append("safety.readOnly must be true")
        }
        if safety.createsOrder || safety.createsTrade || safety.mutatesCash || safety.writesFee || safety.mutatesPosition || safety.callsBroker {
            errors.append("safety side-effect flags must be false")
        }
    }

    private var requestedIdentity: (market: String, code: String)? {
        let parts = requestedSymbol.split(separator: ".", maxSplits: 1).map(String.init)
        guard parts.count == 2 else { return nil }
        return (market: parts[0], code: parts[1])
    }
}

public struct PinganSnapshotPositionData: Codable, Equatable, Identifiable, Sendable {
    public let market: String
    public let code: String
    public let symbol: String
    public let sourceRowId: String
    public let name: String?
    public let quantity: Double
    public let averageCost: Double?
    public let currentWeight: Double?
    public let maxWeight: Double?
    public let unrealizedPnl: Double?
    public let currency: String?

    public var id: String { sourceRowId }
}

public struct PinganSnapshotDataUse: Codable, Equatable, Sendable {
    public let display: String
    public let riskImpact: String
    public let brokerReconciliation: String
    public let accountTruth: String
    public let accounting: String
    public let execution: String
}

public struct PinganSnapshotSafety: Codable, Equatable, Sendable {
    public let readOnly: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let mutatesCash: Bool
    public let writesFee: Bool
    public let mutatesPosition: Bool
    public let callsBroker: Bool
}
