import Foundation

public enum CandidateDecisionIntakeStatus: String, Codable, Equatable, Sendable {
    case available
    case notFound = "not_found"
    case unavailable
}

public enum CandidateDecisionIntakeNextActionState: String, Codable, Equatable, Sendable {
    case readyForHumanCheck = "ready_for_human_check"
    case membershipArchived = "membership_archived"
    case researchMissing = "research_missing"
    case quoteMissing = "quote_missing"
    case quoteStale = "quote_stale"
    case reviewRequired = "review_required"
    case unavailable
}

public enum CandidateDecisionIntakeReviewStatus: String, Codable, Equatable, Sendable {
    case none
    case reviewRequired = "review_required"
}

public enum CandidateDecisionIntakeValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct CandidateDecisionIntakeEnvelope: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-04.core-1e.candidate-decision-intake.v1"

    public let schemaVersion: String
    public let generatedAt: String
    public let metadata: FactMetadata
    public let status: CandidateDecisionIntakeStatus
    public let membershipId: String
    public let requestedActorId: String
    public let requestedSymbol: String?
    public let message: String
    public let provenance: CandidateDecisionIntakeProvenance
    public let nextAction: CandidateDecisionIntakeNextAction
    public let membership: CandidateMembershipData?
    public let decisionContext: DecisionContextEnvelope?
    public let review: CandidateDecisionIntakeReviewState
    public let safety: CandidateMembershipSafety
    public let clientFailureState: String?

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case generatedAt
        case metadata
        case status
        case membershipId
        case requestedActorId
        case requestedSymbol
        case message
        case provenance
        case nextAction
        case membership
        case decisionContext
        case review
        case safety
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        generatedAt = try container.decode(String.self, forKey: .generatedAt)
        metadata = try container.decode(FactMetadata.self, forKey: .metadata)
        status = try container.decode(CandidateDecisionIntakeStatus.self, forKey: .status)
        membershipId = try container.decode(String.self, forKey: .membershipId)
        requestedActorId = try container.decode(String.self, forKey: .requestedActorId)
        requestedSymbol = try container.decodeRequiredNullable(String.self, forKey: .requestedSymbol)
        message = try container.decode(String.self, forKey: .message)
        provenance = try container.decode(CandidateDecisionIntakeProvenance.self, forKey: .provenance)
        nextAction = try container.decode(CandidateDecisionIntakeNextAction.self, forKey: .nextAction)
        membership = try container.decodeRequiredNullable(CandidateMembershipData.self, forKey: .membership)
        decisionContext = try container.decodeRequiredNullable(DecisionContextEnvelope.self, forKey: .decisionContext)
        review = try container.decode(CandidateDecisionIntakeReviewState.self, forKey: .review)
        safety = try container.decode(CandidateMembershipSafety.self, forKey: .safety)
        clientFailureState = nil
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(generatedAt, forKey: .generatedAt)
        try container.encode(metadata, forKey: .metadata)
        try container.encode(status, forKey: .status)
        try container.encode(membershipId, forKey: .membershipId)
        try container.encode(requestedActorId, forKey: .requestedActorId)
        try container.encode(requestedSymbol, forKey: .requestedSymbol)
        try container.encode(message, forKey: .message)
        try container.encode(provenance, forKey: .provenance)
        try container.encode(nextAction, forKey: .nextAction)
        try container.encode(membership, forKey: .membership)
        try container.encode(decisionContext, forKey: .decisionContext)
        try container.encode(review, forKey: .review)
        try container.encode(safety, forKey: .safety)
    }

    public static func unavailable(_ message: String, membershipId: String, clientFailureState: String = "unavailable") -> CandidateDecisionIntakeEnvelope {
        let generatedAt = ISO8601DateFormatter().string(from: Date())
        return CandidateDecisionIntakeEnvelope(
            schemaVersion: schemaVersionV1,
            generatedAt: generatedAt,
            metadata: FactMetadata(
                source: "candidate_decision_intake",
                asOf: generatedAt,
                fetchedAt: generatedAt,
                freshness: "unavailable",
                provenance: "unavailable",
                authority: "unavailable",
                stale: false,
                missing: true,
                conflict: false,
                fixture: false,
                correctionOf: nil,
                replaces: nil,
                message: message
            ),
            status: .unavailable,
            membershipId: membershipId,
            requestedActorId: "unavailable",
            requestedSymbol: nil,
            message: message,
            provenance: CandidateDecisionIntakeProvenance(
                membership: "candidate_memberships",
                research: "unavailable",
                quotes: "unavailable",
                decisionContext: "unavailable",
                reviews: "unavailable",
                portfolio: "omitted"
            ),
            nextAction: CandidateDecisionIntakeNextAction(
                state: .unavailable,
                reason: message,
                advisoryOnly: true
            ),
            membership: nil,
            decisionContext: nil,
            review: CandidateDecisionIntakeReviewState(
                status: .none,
                latestDecisionCheckId: nil,
                latestDecisionCheckedAt: nil,
                latestReviewId: nil,
                latestReviewedAt: nil,
                message: message
            ),
            safety: CandidateMembershipSafety(
                createsOrder: false,
                createsTrade: false,
                mutatesCash: false,
                writesFee: false,
                mutatesPosition: false,
                callsBroker: false
            ),
            clientFailureState: clientFailureState
        )
    }

    public func validateForDisplay() throws {
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionV1 {
            errors.append("schemaVersion must be \(Self.schemaVersionV1)")
        }
        if !isCandidateDecisionIntakeDateTime(generatedAt) {
            errors.append("generatedAt must be a valid date-time")
        }
        if membershipId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("membershipId is required")
        }
        if requestedActorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("requestedActorId is required")
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("message is required")
        }
        metadata.validateForDisplay(label: "candidate decision-intake", errors: &errors)
        if metadata.provenance != "real" && metadata.provenance != "unavailable" {
            errors.append("candidate decision-intake metadata.provenance must be real or unavailable")
        }
        if metadata.authority != "decision_context" && metadata.authority != "unavailable" {
            errors.append("candidate decision-intake metadata.authority must be decision_context or unavailable")
        }
        provenance.validate(errors: &errors)
        nextAction.validate(errors: &errors)
        review.validate(errors: &errors)
        validateSafety(errors: &errors)
        validateCandidateDecisionIntakeChronology(self, errors: &errors)
        switch status {
        case .available:
            if metadata.freshness != "fresh" {
                errors.append("available status requires fresh metadata")
            }
            if let membership {
                membership.validate(errors: &errors)
                validateAvailableIdentity(membership: membership, errors: &errors)
            } else {
                errors.append("available status requires membership")
            }
            if decisionContext == nil {
                errors.append("available status requires decisionContext")
            }
        case .notFound, .unavailable:
            if status == .notFound && metadata.freshness != "missing" {
                errors.append("not_found status requires missing metadata")
            }
            if status == .unavailable && metadata.freshness == "fresh" {
                errors.append("unavailable status must not carry fresh metadata")
            }
            if membership != nil {
                errors.append("non-available status must not carry membership")
            }
            if decisionContext != nil {
                errors.append("non-available status must not carry decisionContext")
            }
            if status == .notFound && nextAction.state != .unavailable {
                errors.append("not_found status requires unavailable nextAction")
            }
            if nextAction.state != .unavailable {
                errors.append("non-available status requires unavailable nextAction")
            }
        }

        if let requestedSymbol, SecuritySymbol.parseHongKongAlias(requestedSymbol) == nil {
            errors.append("requestedSymbol must be a valid Hong Kong symbol when present")
        }

        if !errors.isEmpty {
            throw CandidateDecisionIntakeValidationError.invalid(errors)
        }
    }

    private func validateSafety(errors: inout [String]) {
        if safety.createsOrder ||
            safety.createsTrade ||
            safety.mutatesCash ||
            safety.writesFee ||
            safety.mutatesPosition ||
            safety.callsBroker {
            errors.append("candidate decision-intake safety flags must all be false")
        }
    }

    private func validateAvailableIdentity(membership: CandidateMembershipData, errors: inout [String]) {
        if membershipId != membership.id {
            errors.append("membershipId must match membership.id")
        }
        if requestedActorId != membership.actorId {
            errors.append("requestedActorId must match membership.actorId")
        }
        if requestedSymbol != membership.symbol {
            errors.append("requestedSymbol must match membership.symbol")
        }
        guard let decisionContext else { return }
        if decisionContext.requestedSymbol != requestedSymbol {
            errors.append("decisionContext.requestedSymbol must match requestedSymbol")
        }
        do {
            try decisionContext.validateForDisplay(market: membership.market, code: membership.code)
        } catch DecisionContextValidationError.invalid(let nestedErrors) {
            errors.append(contentsOf: nestedErrors)
        } catch {
            errors.append("decisionContext failed display validation")
        }
    }

    private init(
        schemaVersion: String,
        generatedAt: String,
        metadata: FactMetadata,
        status: CandidateDecisionIntakeStatus,
        membershipId: String,
        requestedActorId: String,
        requestedSymbol: String?,
        message: String,
        provenance: CandidateDecisionIntakeProvenance,
        nextAction: CandidateDecisionIntakeNextAction,
        membership: CandidateMembershipData?,
        decisionContext: DecisionContextEnvelope?,
        review: CandidateDecisionIntakeReviewState,
        safety: CandidateMembershipSafety,
        clientFailureState: String?
    ) {
        self.schemaVersion = schemaVersion
        self.generatedAt = generatedAt
        self.metadata = metadata
        self.status = status
        self.membershipId = membershipId
        self.requestedActorId = requestedActorId
        self.requestedSymbol = requestedSymbol
        self.message = message
        self.provenance = provenance
        self.nextAction = nextAction
        self.membership = membership
        self.decisionContext = decisionContext
        self.review = review
        self.safety = safety
        self.clientFailureState = clientFailureState
    }
}

public struct CandidateDecisionIntakeProvenance: Codable, Equatable, Sendable {
    public let membership: String
    public let research: String
    public let quotes: String
    public let decisionContext: String
    public let reviews: String
    public let portfolio: String

    fileprivate func validate(errors: inout [String]) {
        if membership != "candidate_memberships" {
            errors.append("provenance.membership must be candidate_memberships")
        }
        if !["research_profiles", "missing", "unavailable"].contains(research) {
            errors.append("provenance.research is invalid")
        }
        if !["persisted_market_quotes", "unavailable"].contains(quotes) {
            errors.append("provenance.quotes is invalid")
        }
        if !["decision_context_join", "unavailable"].contains(decisionContext) {
            errors.append("provenance.decisionContext is invalid")
        }
        if !["pre_trade_decision_checks_post_decision_reviews", "unavailable"].contains(reviews) {
            errors.append("provenance.reviews is invalid")
        }
        if portfolio != "omitted" {
            errors.append("provenance.portfolio must be omitted")
        }
    }
}

public struct CandidateDecisionIntakeNextAction: Codable, Equatable, Sendable {
    public let state: CandidateDecisionIntakeNextActionState
    public let reason: String
    public let advisoryOnly: Bool

    fileprivate func validate(errors: inout [String]) {
        if reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("nextAction.reason is required")
        }
        if advisoryOnly != true {
            errors.append("nextAction.advisoryOnly must be true")
        }
    }
}

public struct CandidateDecisionIntakeReviewState: Codable, Equatable, Sendable {
    public let status: CandidateDecisionIntakeReviewStatus
    public let latestDecisionCheckId: String?
    public let latestDecisionCheckedAt: String?
    public let latestReviewId: String?
    public let latestReviewedAt: String?
    public let message: String

    private enum CodingKeys: String, CodingKey {
        case status
        case latestDecisionCheckId
        case latestDecisionCheckedAt
        case latestReviewId
        case latestReviewedAt
        case message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        status = try container.decode(CandidateDecisionIntakeReviewStatus.self, forKey: .status)
        latestDecisionCheckId = try container.decodeRequiredNullable(String.self, forKey: .latestDecisionCheckId)
        latestDecisionCheckedAt = try container.decodeRequiredNullable(String.self, forKey: .latestDecisionCheckedAt)
        latestReviewId = try container.decodeRequiredNullable(String.self, forKey: .latestReviewId)
        latestReviewedAt = try container.decodeRequiredNullable(String.self, forKey: .latestReviewedAt)
        message = try container.decode(String.self, forKey: .message)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(status, forKey: .status)
        try container.encode(latestDecisionCheckId, forKey: .latestDecisionCheckId)
        try container.encode(latestDecisionCheckedAt, forKey: .latestDecisionCheckedAt)
        try container.encode(latestReviewId, forKey: .latestReviewId)
        try container.encode(latestReviewedAt, forKey: .latestReviewedAt)
        try container.encode(message, forKey: .message)
    }

    fileprivate init(
        status: CandidateDecisionIntakeReviewStatus,
        latestDecisionCheckId: String?,
        latestDecisionCheckedAt: String?,
        latestReviewId: String?,
        latestReviewedAt: String?,
        message: String
    ) {
        self.status = status
        self.latestDecisionCheckId = latestDecisionCheckId
        self.latestDecisionCheckedAt = latestDecisionCheckedAt
        self.latestReviewId = latestReviewId
        self.latestReviewedAt = latestReviewedAt
        self.message = message
    }

    fileprivate func validate(errors: inout [String]) {
        if let latestDecisionCheckId, latestDecisionCheckId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("review.latestDecisionCheckId must be non-empty when present")
        }
        if let latestDecisionCheckedAt, !isCandidateDecisionIntakeDateTime(latestDecisionCheckedAt) {
            errors.append("review.latestDecisionCheckedAt must be a valid date-time")
        }
        if let latestReviewId, latestReviewId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("review.latestReviewId must be non-empty when present")
        }
        if let latestReviewedAt, !isCandidateDecisionIntakeDateTime(latestReviewedAt) {
            errors.append("review.latestReviewedAt must be a valid date-time")
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("review.message is required")
        }
    }
}

public struct CandidateDecisionIntakeRenderModel: Equatable, Sendable {
    public let state: String
    public let membershipId: String?
    public let symbol: String?
    public let title: String
    public let message: String
    public let metadata: FactMetadata?
    public let facts: [String]
}

public func candidateDecisionIntakeRenderModel(from envelope: CandidateDecisionIntakeEnvelope) -> CandidateDecisionIntakeRenderModel {
    let state = candidateDecisionIntakeDisplayState(envelope)
    let symbol = envelope.requestedSymbol ?? envelope.membership?.symbol
    guard envelope.status == .available else {
        return CandidateDecisionIntakeRenderModel(
            state: state,
            membershipId: envelope.membershipId,
            symbol: symbol,
            title: candidateDecisionIntakeTitle(state: state),
            message: envelope.message,
            metadata: envelope.metadata,
            facts: []
        )
    }
    var facts: [String] = [
        "metadata source=\(envelope.metadata.source), asOf=\(envelope.metadata.asOf ?? "missing"), fetchedAt=\(envelope.metadata.fetchedAt ?? "missing"), freshness=\(envelope.metadata.freshness), provenance=\(envelope.metadata.provenance), authority=\(envelope.metadata.authority)",
        "nextAction=\(envelope.nextAction.state.rawValue): \(envelope.nextAction.reason)",
        "membership=\(envelope.provenance.membership), research=\(envelope.provenance.research), quotes=\(envelope.provenance.quotes)",
        "decisionContext=\(envelope.provenance.decisionContext), reviews=\(envelope.provenance.reviews), portfolio=\(envelope.provenance.portfolio)",
        "safety: no orders, trades, fills, cash, fees, positions, or broker calls"
    ]
    if let membership = envelope.membership {
        facts.append("membershipState=\(membership.state.rawValue), version=\(membership.version)")
    }
    if let decisionContext = envelope.decisionContext {
        facts.append("decisionContext=\(decisionContext.contextId), quoteStatus=\(decisionContext.quote.status)")
    }
    facts.append("review=\(envelope.review.status.rawValue): \(envelope.review.message)")

    return CandidateDecisionIntakeRenderModel(
        state: state,
        membershipId: envelope.membershipId,
        symbol: symbol,
        title: candidateDecisionIntakeTitle(state: state),
        message: envelope.message,
        metadata: envelope.metadata,
        facts: facts
    )
}

public func candidateDecisionIntakeFailClosedModel(state: String, message: String, membershipId: String? = nil) -> CandidateDecisionIntakeRenderModel {
    CandidateDecisionIntakeRenderModel(
        state: state,
        membershipId: membershipId,
        symbol: nil,
        title: candidateDecisionIntakeTitle(state: state),
        message: message,
        metadata: nil,
        facts: []
    )
}

private func candidateDecisionIntakeDisplayState(_ envelope: CandidateDecisionIntakeEnvelope) -> String {
    if envelope.status == .notFound {
        return "not_found"
    }
    if envelope.status == .unavailable {
        return candidateDecisionIntakeClientFailureState(envelope.clientFailureState)
    }
    switch envelope.nextAction.state {
    case .readyForHumanCheck:
        return "ready"
    case .membershipArchived:
        return "archived"
    case .researchMissing:
        return "missing_research"
    case .quoteMissing:
        return "missing_quote"
    case .quoteStale:
        return "stale_quote"
    case .reviewRequired:
        return "review_required"
    case .unavailable:
        return "unavailable"
    }
}

private func candidateDecisionIntakeClientFailureState(_ state: String?) -> String {
    switch state {
    case "unauthorized":
        return "unauthorized"
    case "not_found":
        return "not_found"
    case "malformed":
        return "malformed"
    case "offline":
        return "offline"
    default:
        return "unavailable"
    }
}

private func candidateDecisionIntakeTitle(state: String) -> String {
    switch state {
    case "ready":
        return "可进入人工检查"
    case "archived":
        return "成员已归档"
    case "missing_research":
        return "缺少研究资料"
    case "missing_quote":
        return "缺少报价"
    case "stale_quote":
        return "报价已过期"
    case "review_required":
        return "需要先复盘"
    case "unauthorized":
        return "读取未授权"
    case "not_found":
        return "成员不存在"
    case "malformed":
        return "响应格式无效"
    default:
        return "决策准备不可用"
    }
}

private extension KeyedDecodingContainer {
    func decodeRequiredNullable<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        guard contains(key) else {
            throw DecodingError.keyNotFound(
                key,
                DecodingError.Context(
                    codingPath: codingPath,
                    debugDescription: "Required nullable key '\(key.stringValue)' is missing"
                )
            )
        }
        return try decodeIfPresent(type, forKey: key)
    }
}

private func isCandidateDecisionIntakeDateTime(_ value: String) -> Bool {
    Date.parseCandidateDecisionIntakeIso8601(value) != nil
}

private extension Date {
    static func parseCandidateDecisionIntakeIso8601(_ value: String) -> Date? {
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
