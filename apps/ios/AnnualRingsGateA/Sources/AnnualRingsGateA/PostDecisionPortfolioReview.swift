import Foundation

public enum PostDecisionPortfolioReviewFactState: String, Codable, CaseIterable, Equatable, Sendable {
    case current, stale, partial, zeroPosition = "zero_position"
    case empty
    case conflict
    case unauthorized
    case unavailable
    case notCaptured = "not_captured"

    init(contextStatus: PortfolioDecisionContextStatus) {
        self = switch contextStatus {
        case .available: .current
        case .stale: .stale
        case .partial: .partial
        case .zeroPosition: .zeroPosition
        case .empty: .empty
        case .conflict: .conflict
        case .unauthorized: .unauthorized
        case .unavailable: .unavailable
        }
    }

    var carriesPositionFacts: Bool {
        self == .current || self == .stale || self == .partial || self == .zeroPosition
    }
}

private extension DecisionSnapshotPortfolioState {
    var carriesPositionFacts: Bool {
        self == .current || self == .stale || self == .partial || self == .zeroPosition
    }
}

public enum PostDecisionPortfolioComparisonStatus: String, Codable, Equatable, Sendable {
    case comparable
    case partial
    case unavailable
}

public enum PostDecisionPortfolioMetricAvailability: String, Codable, Equatable, Sendable {
    case comparable
    case unavailable
}

public enum PostDecisionPortfolioMetricKey: String, CaseIterable, Codable, Equatable, Sendable {
    case candidateQuantity
    case candidateExposure
    case candidateWeight
    case positionCount
    case totalExposure
    case missingQuoteCount
    case nonCurrentQuoteCount
    case largestPositionWeight
    case topThreeWeight
    case hhi
}

public enum PostDecisionPortfolioReviewAvailability: String, Codable, Equatable, Sendable {
    case preserved
    case notCaptured = "portfolio_review_not_captured"
}

public enum PostDecisionPortfolioReviewValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct PostDecisionPortfolioIdentityBinding: Codable, Equatable, Sendable {
    public let state: PostDecisionPortfolioReviewFactState
    public let contextId: String?
    public let portfolioSnapshotId: String?
    public let accountScopeId: String?

    private enum CodingKeys: String, CodingKey {
        case state
        case contextId
        case portfolioSnapshotId
        case accountScopeId
    }

    public init(
        state: PostDecisionPortfolioReviewFactState,
        contextId: String?,
        portfolioSnapshotId: String?,
        accountScopeId: String?
    ) {
        self.state = state
        self.contextId = contextId
        self.portfolioSnapshotId = portfolioSnapshotId
        self.accountScopeId = accountScopeId
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        state = try container.decode(PostDecisionPortfolioReviewFactState.self, forKey: .state)
        contextId = try postDecisionDecodeRequiredNullable(String.self, from: container, forKey: .contextId)
        portfolioSnapshotId = try postDecisionDecodeRequiredNullable(String.self, from: container, forKey: .portfolioSnapshotId)
        accountScopeId = try postDecisionDecodeRequiredNullable(String.self, from: container, forKey: .accountScopeId)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(state, forKey: .state)
        try postDecisionEncodeRequiredNullable(contextId, into: &container, forKey: .contextId)
        try postDecisionEncodeRequiredNullable(portfolioSnapshotId, into: &container, forKey: .portfolioSnapshotId)
        try postDecisionEncodeRequiredNullable(accountScopeId, into: &container, forKey: .accountScopeId)
    }

    init(context: PortfolioDecisionContextEnvelope) {
        self.init(
            state: PostDecisionPortfolioReviewFactState(contextStatus: context.status),
            contextId: context.contextId,
            portfolioSnapshotId: context.portfolioSnapshotId,
            accountScopeId: context.accountScopeId
        )
    }

    fileprivate func validate(label: String, requiresPositionFacts: Bool, errors: inout [String]) {
        if state == .notCaptured {
            errors.append("\(label).state must not be not_captured")
        }
        for (value, field) in [
            (contextId, "contextId"),
            (portfolioSnapshotId, "portfolioSnapshotId"),
            (accountScopeId, "accountScopeId")
        ] where value?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true {
            errors.append("\(label).\(field) must be non-empty when present")
        }
        if accountScopeId == nil {
            errors.append("\(label).accountScopeId is required")
        }
        if state.carriesPositionFacts {
            if contextId == nil || portfolioSnapshotId == nil {
                errors.append("\(label) displayable facts require context and portfolio snapshot identities")
            }
        } else if contextId != nil || portfolioSnapshotId != nil {
            errors.append("\(label) fail-closed state must not expose context or portfolio snapshot identities")
        }
        if requiresPositionFacts && !state.carriesPositionFacts {
            errors.append("\(label) must reference preserved decision-time position facts")
        }
    }
}

public struct PostDecisionPortfolioComparisonBinding: Codable, Equatable, Sendable {
    public let calculationVersion: String
    public let comparisonId: String

    public init(calculationVersion: String, comparisonId: String) {
        self.calculationVersion = calculationVersion
        self.comparisonId = comparisonId
    }
}

public struct PostDecisionPortfolioReviewBinding: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-16.post-decision-portfolio-review.v1"
    public static let comparisonVersionV1 = "post-decision-portfolio-comparison.v1"

    public let schemaVersion: String
    public let decisionCheckId: String
    public let decisionSnapshotId: String
    public let candidateSymbol: String
    public let decisionTimePortfolio: PostDecisionPortfolioIdentityBinding
    public let reviewTimePortfolio: PostDecisionPortfolioIdentityBinding
    public let comparison: PostDecisionPortfolioComparisonBinding

    public init(
        schemaVersion: String = Self.schemaVersionV1,
        decisionCheckId: String,
        decisionSnapshotId: String,
        candidateSymbol: String,
        decisionTimePortfolio: PostDecisionPortfolioIdentityBinding,
        reviewTimePortfolio: PostDecisionPortfolioIdentityBinding,
        comparison: PostDecisionPortfolioComparisonBinding
    ) {
        self.schemaVersion = schemaVersion
        self.decisionCheckId = decisionCheckId
        self.decisionSnapshotId = decisionSnapshotId
        self.candidateSymbol = candidateSymbol
        self.decisionTimePortfolio = decisionTimePortfolio
        self.reviewTimePortfolio = reviewTimePortfolio
        self.comparison = comparison
    }

    public static func capture(
        decisionCheckId: String,
        decisionSnapshot: DecisionSnapshotState,
        reviewTimePortfolio: PortfolioDecisionContextEnvelope
    ) throws -> PostDecisionPortfolioReviewBinding {
        guard decisionSnapshot.availability == .preserved, let snapshot = decisionSnapshot.snapshot else {
            throw PostDecisionPortfolioReviewValidationError.invalid([
                "preserved decision snapshot is required for portfolio review binding"
            ])
        }
        try decisionSnapshot.validateForDisplay(decisionContext: snapshot.decisionContext)
        try reviewTimePortfolio.validateForDisplay()
        guard snapshot.portfolioContext.state.carriesPositionFacts,
              let decisionTimePortfolio = snapshot.portfolioContext.envelope else {
            throw PostDecisionPortfolioReviewValidationError.invalid([
                "preserved decision-time position facts are required for portfolio review binding"
            ])
        }
        let comparison = try PostDecisionPortfolioComparison.build(
            decisionTime: decisionTimePortfolio,
            reviewTime: reviewTimePortfolio,
            candidateSymbol: snapshot.candidateSymbol
        )
        let binding = PostDecisionPortfolioReviewBinding(
            decisionCheckId: decisionCheckId,
            decisionSnapshotId: snapshot.snapshotId,
            candidateSymbol: snapshot.candidateSymbol,
            decisionTimePortfolio: PostDecisionPortfolioIdentityBinding(context: decisionTimePortfolio),
            reviewTimePortfolio: PostDecisionPortfolioIdentityBinding(context: reviewTimePortfolio),
            comparison: PostDecisionPortfolioComparisonBinding(
                calculationVersion: comparison.calculationVersion,
                comparisonId: comparison.comparisonId
            )
        )
        try binding.validate()
        return binding
    }

    public static func captureIfComparable(
        decisionCheckId: String,
        decisionSnapshot: DecisionSnapshotState,
        reviewTimePortfolio: PortfolioDecisionContextEnvelope
    ) throws -> PostDecisionPortfolioReviewBinding? {
        if decisionSnapshot.availability == .notCaptured {
            guard decisionSnapshot.snapshot == nil,
                  decisionSnapshot.limitation.contains("not reconstructed") else {
                throw PostDecisionPortfolioReviewValidationError.invalid([
                    "not-captured decision snapshot must not expose reconstructed facts"
                ])
            }
            return nil
        }
        guard let snapshot = decisionSnapshot.snapshot else {
            throw PostDecisionPortfolioReviewValidationError.invalid([
                "preserved decision snapshot is required for portfolio review binding"
            ])
        }
        try decisionSnapshot.validateForDisplay(decisionContext: snapshot.decisionContext)
        guard snapshot.portfolioContext.state.carriesPositionFacts else {
            return nil
        }
        try reviewTimePortfolio.validateForDisplay()
        guard reviewTimePortfolio.status != .unauthorized,
              reviewTimePortfolio.accountScopeId != nil else {
            return nil
        }
        return try capture(
            decisionCheckId: decisionCheckId,
            decisionSnapshot: decisionSnapshot,
            reviewTimePortfolio: reviewTimePortfolio
        )
    }

    public func validate() throws {
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionV1 {
            errors.append("portfolio review binding schemaVersion is invalid")
        }
        if decisionCheckId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("portfolio review binding decisionCheckId is required")
        }
        if !postDecisionPortfolioMatchesId(decisionSnapshotId, prefix: "decision-snapshot") {
            errors.append("portfolio review binding decisionSnapshotId is invalid")
        }
        if !postDecisionPortfolioIsCanonicalSymbol(candidateSymbol) {
            errors.append("portfolio review binding candidateSymbol is invalid")
        }
        decisionTimePortfolio.validate(label: "portfolio review binding decisionTimePortfolio", requiresPositionFacts: true, errors: &errors)
        reviewTimePortfolio.validate(label: "portfolio review binding reviewTimePortfolio", requiresPositionFacts: false, errors: &errors)
        if decisionTimePortfolio.accountScopeId != reviewTimePortfolio.accountScopeId {
            errors.append("portfolio review binding cannot compare across account scopes")
        }
        if comparison.calculationVersion != Self.comparisonVersionV1 {
            errors.append("portfolio review binding comparison calculationVersion is invalid")
        }
        if !postDecisionPortfolioMatchesId(comparison.comparisonId, prefix: "post-decision-portfolio-comparison") {
            errors.append("portfolio review binding comparisonId is invalid")
        }
        if !errors.isEmpty {
            throw PostDecisionPortfolioReviewValidationError.invalid(errors)
        }
    }
}

public struct PostDecisionPortfolioFactReference: Codable, Equatable, Sendable {
    public let state: PostDecisionPortfolioReviewFactState
    public let contextId: String?
    public let portfolioSnapshotId: String?
    public let accountScopeId: String?
    public let portfolioAsOf: String?
    public let assembledAt: String

    private enum CodingKeys: String, CodingKey {
        case state
        case contextId
        case portfolioSnapshotId
        case accountScopeId
        case portfolioAsOf
        case assembledAt
    }

    public init(
        state: PostDecisionPortfolioReviewFactState,
        contextId: String?,
        portfolioSnapshotId: String?,
        accountScopeId: String?,
        portfolioAsOf: String?,
        assembledAt: String
    ) {
        self.state = state
        self.contextId = contextId
        self.portfolioSnapshotId = portfolioSnapshotId
        self.accountScopeId = accountScopeId
        self.portfolioAsOf = portfolioAsOf
        self.assembledAt = assembledAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        state = try container.decode(PostDecisionPortfolioReviewFactState.self, forKey: .state)
        contextId = try postDecisionDecodeRequiredNullable(String.self, from: container, forKey: .contextId)
        portfolioSnapshotId = try postDecisionDecodeRequiredNullable(String.self, from: container, forKey: .portfolioSnapshotId)
        accountScopeId = try postDecisionDecodeRequiredNullable(String.self, from: container, forKey: .accountScopeId)
        portfolioAsOf = try postDecisionDecodeRequiredNullable(String.self, from: container, forKey: .portfolioAsOf)
        assembledAt = try container.decode(String.self, forKey: .assembledAt)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(state, forKey: .state)
        try postDecisionEncodeRequiredNullable(contextId, into: &container, forKey: .contextId)
        try postDecisionEncodeRequiredNullable(portfolioSnapshotId, into: &container, forKey: .portfolioSnapshotId)
        try postDecisionEncodeRequiredNullable(accountScopeId, into: &container, forKey: .accountScopeId)
        try postDecisionEncodeRequiredNullable(portfolioAsOf, into: &container, forKey: .portfolioAsOf)
        try container.encode(assembledAt, forKey: .assembledAt)
    }

    init(context: PortfolioDecisionContextEnvelope) {
        self.init(
            state: PostDecisionPortfolioReviewFactState(contextStatus: context.status),
            contextId: context.contextId,
            portfolioSnapshotId: context.portfolioSnapshotId,
            accountScopeId: context.accountScopeId,
            portfolioAsOf: context.portfolioAsOf,
            assembledAt: context.assembledAt
        )
    }

    fileprivate var identityBinding: PostDecisionPortfolioIdentityBinding {
        PostDecisionPortfolioIdentityBinding(
            state: state,
            contextId: contextId,
            portfolioSnapshotId: portfolioSnapshotId,
            accountScopeId: accountScopeId
        )
    }

    fileprivate func validate(label: String, errors: inout [String]) {
        identityBinding.validate(label: label, requiresPositionFacts: false, errors: &errors)
        if let portfolioAsOf, !postDecisionPortfolioIsStrictDate(portfolioAsOf) {
            errors.append("\(label).portfolioAsOf must be an ISO UTC date-time")
        }
        if !postDecisionPortfolioIsStrictDate(assembledAt) {
            errors.append("\(label).assembledAt must be an ISO UTC date-time")
        }
    }
}

public struct PostDecisionPortfolioNeutralDeltaMetric: Codable, Equatable, Sendable {
    public let availability: PostDecisionPortfolioMetricAvailability
    public let decisionTime: Double?
    public let reviewTime: Double?
    public let delta: Double?

    private enum CodingKeys: String, CodingKey {
        case availability
        case decisionTime
        case reviewTime
        case delta
    }

    public init(
        availability: PostDecisionPortfolioMetricAvailability,
        decisionTime: Double?,
        reviewTime: Double?,
        delta: Double?
    ) {
        self.availability = availability
        self.decisionTime = decisionTime
        self.reviewTime = reviewTime
        self.delta = delta
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        availability = try container.decode(PostDecisionPortfolioMetricAvailability.self, forKey: .availability)
        decisionTime = try postDecisionDecodeRequiredNullable(Double.self, from: container, forKey: .decisionTime)
        reviewTime = try postDecisionDecodeRequiredNullable(Double.self, from: container, forKey: .reviewTime)
        delta = try postDecisionDecodeRequiredNullable(Double.self, from: container, forKey: .delta)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(availability, forKey: .availability)
        try postDecisionEncodeRequiredNullable(decisionTime, into: &container, forKey: .decisionTime)
        try postDecisionEncodeRequiredNullable(reviewTime, into: &container, forKey: .reviewTime)
        try postDecisionEncodeRequiredNullable(delta, into: &container, forKey: .delta)
    }

    fileprivate static let unavailable = PostDecisionPortfolioNeutralDeltaMetric(
        availability: .unavailable,
        decisionTime: nil,
        reviewTime: nil,
        delta: nil
    )

    fileprivate static func comparable(_ decisionTime: Double?, _ reviewTime: Double?, precision: Int) -> Self {
        guard let decisionTime, let reviewTime, decisionTime.isFinite, reviewTime.isFinite else {
            return .unavailable
        }
        return PostDecisionPortfolioNeutralDeltaMetric(
            availability: .comparable,
            decisionTime: decisionTime,
            reviewTime: reviewTime,
            delta: postDecisionPortfolioRound(reviewTime - decisionTime, precision: precision)
        )
    }

    fileprivate func validate(label: String, precision: Int, errors: inout [String]) -> Bool {
        switch availability {
        case .unavailable:
            if decisionTime != nil || reviewTime != nil || delta != nil {
                errors.append("\(label) unavailable values must all be null")
            }
            return false
        case .comparable:
            guard let decisionTime, let reviewTime, let delta,
                  decisionTime.isFinite, reviewTime.isFinite, delta.isFinite else {
                errors.append("\(label) comparable values must all be finite")
                return true
            }
            let expected = postDecisionPortfolioRound(reviewTime - decisionTime, precision: precision)
            if delta != expected {
                errors.append("\(label).delta must equal the neutral review-time minus decision-time difference")
            }
            return true
        }
    }
}

public struct PostDecisionPortfolioMetrics: Codable, Equatable, Sendable {
    public let candidateQuantity: PostDecisionPortfolioNeutralDeltaMetric
    public let candidateExposure: PostDecisionPortfolioNeutralDeltaMetric
    public let candidateWeight: PostDecisionPortfolioNeutralDeltaMetric
    public let positionCount: PostDecisionPortfolioNeutralDeltaMetric
    public let totalExposure: PostDecisionPortfolioNeutralDeltaMetric
    public let missingQuoteCount: PostDecisionPortfolioNeutralDeltaMetric
    public let nonCurrentQuoteCount: PostDecisionPortfolioNeutralDeltaMetric
    public let largestPositionWeight: PostDecisionPortfolioNeutralDeltaMetric
    public let topThreeWeight: PostDecisionPortfolioNeutralDeltaMetric
    public let hhi: PostDecisionPortfolioNeutralDeltaMetric

    public init(
        candidateQuantity: PostDecisionPortfolioNeutralDeltaMetric,
        candidateExposure: PostDecisionPortfolioNeutralDeltaMetric,
        candidateWeight: PostDecisionPortfolioNeutralDeltaMetric,
        positionCount: PostDecisionPortfolioNeutralDeltaMetric,
        totalExposure: PostDecisionPortfolioNeutralDeltaMetric,
        missingQuoteCount: PostDecisionPortfolioNeutralDeltaMetric,
        nonCurrentQuoteCount: PostDecisionPortfolioNeutralDeltaMetric,
        largestPositionWeight: PostDecisionPortfolioNeutralDeltaMetric,
        topThreeWeight: PostDecisionPortfolioNeutralDeltaMetric,
        hhi: PostDecisionPortfolioNeutralDeltaMetric
    ) {
        self.candidateQuantity = candidateQuantity
        self.candidateExposure = candidateExposure
        self.candidateWeight = candidateWeight
        self.positionCount = positionCount
        self.totalExposure = totalExposure
        self.missingQuoteCount = missingQuoteCount
        self.nonCurrentQuoteCount = nonCurrentQuoteCount
        self.largestPositionWeight = largestPositionWeight
        self.topThreeWeight = topThreeWeight
        self.hhi = hhi
    }

    public subscript(key: PostDecisionPortfolioMetricKey) -> PostDecisionPortfolioNeutralDeltaMetric {
        switch key {
        case .candidateQuantity: candidateQuantity
        case .candidateExposure: candidateExposure
        case .candidateWeight: candidateWeight
        case .positionCount: positionCount
        case .totalExposure: totalExposure
        case .missingQuoteCount: missingQuoteCount
        case .nonCurrentQuoteCount: nonCurrentQuoteCount
        case .largestPositionWeight: largestPositionWeight
        case .topThreeWeight: topThreeWeight
        case .hhi: hhi
        }
    }

    fileprivate func validate(errors: inout [String]) -> Int {
        let precisions: [PostDecisionPortfolioMetricKey: Int] = [
            .candidateQuantity: 8,
            .candidateExposure: 2,
            .candidateWeight: 8,
            .positionCount: 0,
            .totalExposure: 2,
            .missingQuoteCount: 0,
            .nonCurrentQuoteCount: 0,
            .largestPositionWeight: 8,
            .topThreeWeight: 8,
            .hhi: 8
        ]
        return PostDecisionPortfolioMetricKey.allCases.reduce(into: 0) { count, key in
            if self[key].validate(
                label: "portfolio comparison metrics.\(key.rawValue)",
                precision: precisions[key]!,
                errors: &errors
            ) {
                count += 1
            }
        }
    }
}

public struct PostDecisionPortfolioComparisonCash: Codable, Equatable, Sendable {
    public let status: String
    public let decisionTime: Double?
    public let reviewTime: Double?
    public let delta: Double?
    public let reason: String

    private enum CodingKeys: String, CodingKey {
        case status
        case decisionTime
        case reviewTime
        case delta
        case reason
    }

    public init(
        status: String = "unknown",
        decisionTime: Double? = nil,
        reviewTime: Double? = nil,
        delta: Double? = nil,
        reason: String = "not_provided_by_authoritative_snapshot"
    ) {
        self.status = status
        self.decisionTime = decisionTime
        self.reviewTime = reviewTime
        self.delta = delta
        self.reason = reason
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        status = try container.decode(String.self, forKey: .status)
        decisionTime = try postDecisionDecodeRequiredNullable(Double.self, from: container, forKey: .decisionTime)
        reviewTime = try postDecisionDecodeRequiredNullable(Double.self, from: container, forKey: .reviewTime)
        delta = try postDecisionDecodeRequiredNullable(Double.self, from: container, forKey: .delta)
        reason = try container.decode(String.self, forKey: .reason)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(status, forKey: .status)
        try postDecisionEncodeRequiredNullable(decisionTime, into: &container, forKey: .decisionTime)
        try postDecisionEncodeRequiredNullable(reviewTime, into: &container, forKey: .reviewTime)
        try postDecisionEncodeRequiredNullable(delta, into: &container, forKey: .delta)
        try container.encode(reason, forKey: .reason)
    }

    fileprivate func validate(errors: inout [String]) {
        if status != "unknown"
            || decisionTime != nil
            || reviewTime != nil
            || delta != nil
            || reason != "not_provided_by_authoritative_snapshot" {
            errors.append("portfolio comparison cash must remain explicit unknown")
        }
    }
}

public struct PostDecisionPortfolioComparisonSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let neutralFactsOnly: Bool
    public let infersCausality: Bool
    public let performanceAttribution: Bool
    public let infersDecisionQuality: Bool
    public let recommendsDirection: Bool
    public let recommendsAmount: Bool
    public let recommendsWeight: Bool
    public let recommendsTiming: Bool
    public let promisesReturn: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let mutatesCash: Bool
    public let writesFee: Bool
    public let mutatesPosition: Bool
    public let callsBroker: Bool
    public let productionWrite: Bool

    public static let neutral = PostDecisionPortfolioComparisonSafety(
        advisoryOnly: true,
        neutralFactsOnly: true,
        infersCausality: false,
        performanceAttribution: false,
        infersDecisionQuality: false,
        recommendsDirection: false,
        recommendsAmount: false,
        recommendsWeight: false,
        recommendsTiming: false,
        promisesReturn: false,
        createsOrder: false,
        createsTrade: false,
        mutatesCash: false,
        writesFee: false,
        mutatesPosition: false,
        callsBroker: false,
        productionWrite: false
    )

    fileprivate func validate(errors: inout [String]) {
        if !advisoryOnly || !neutralFactsOnly
            || infersCausality || performanceAttribution || infersDecisionQuality
            || recommendsDirection || recommendsAmount || recommendsWeight || recommendsTiming
            || promisesReturn || createsOrder || createsTrade || mutatesCash || writesFee
            || mutatesPosition || callsBroker || productionWrite {
            errors.append("portfolio comparison safety must remain advisory neutral facts with every authority and mutation boundary false")
        }
    }
}

public struct PostDecisionPortfolioComparison: Codable, Equatable, Sendable {
    public let calculationVersion: String
    public let comparisonId: String
    public let status: PostDecisionPortfolioComparisonStatus
    public let candidateSymbol: String
    public let decisionTime: PostDecisionPortfolioFactReference
    public let reviewTime: PostDecisionPortfolioFactReference
    public let metrics: PostDecisionPortfolioMetrics
    public let cash: PostDecisionPortfolioComparisonCash
    public let gaps: [String]
    public let safety: PostDecisionPortfolioComparisonSafety

    public init(
        calculationVersion: String,
        comparisonId: String,
        status: PostDecisionPortfolioComparisonStatus,
        candidateSymbol: String,
        decisionTime: PostDecisionPortfolioFactReference,
        reviewTime: PostDecisionPortfolioFactReference,
        metrics: PostDecisionPortfolioMetrics,
        cash: PostDecisionPortfolioComparisonCash,
        gaps: [String],
        safety: PostDecisionPortfolioComparisonSafety
    ) {
        self.calculationVersion = calculationVersion
        self.comparisonId = comparisonId
        self.status = status
        self.candidateSymbol = candidateSymbol
        self.decisionTime = decisionTime
        self.reviewTime = reviewTime
        self.metrics = metrics
        self.cash = cash
        self.gaps = gaps
        self.safety = safety
    }

    public static func build(
        decisionTime: PortfolioDecisionContextEnvelope,
        reviewTime: PortfolioDecisionContextEnvelope,
        candidateSymbol: String
    ) throws -> PostDecisionPortfolioComparison {
        try decisionTime.validateForDisplay()
        try reviewTime.validateForDisplay()
        guard PostDecisionPortfolioReviewFactState(contextStatus: decisionTime.status).carriesPositionFacts else {
            throw PostDecisionPortfolioReviewValidationError.invalid([
                "portfolio comparison requires preserved decision-time position facts"
            ])
        }
        guard postDecisionPortfolioIsCanonicalSymbol(candidateSymbol) else {
            throw PostDecisionPortfolioReviewValidationError.invalid([
                "portfolio comparison candidateSymbol is invalid"
            ])
        }
        guard decisionTime.accountScopeId == reviewTime.accountScopeId else {
            throw PostDecisionPortfolioReviewValidationError.invalid([
                "portfolio comparison cannot cross account scopes"
            ])
        }

        let quantityComparable = postDecisionPortfolioIsDisplayable(decisionTime)
            && postDecisionPortfolioIsDisplayable(reviewTime)
        let currentValuationComparable = decisionTime.status == .available && reviewTime.status == .available
        let currentTotalExposureComparable = postDecisionPortfolioHasCurrentTotal(decisionTime) && postDecisionPortfolioHasCurrentTotal(reviewTime)
        let decisionCandidate = decisionTime.positions.first { $0.symbol == candidateSymbol }
        let reviewCandidate = reviewTime.positions.first { $0.symbol == candidateSymbol }
        let decisionCandidateExposure = postDecisionPortfolioCandidateCurrentExposure(
            decisionTime,
            candidateSymbol: candidateSymbol
        )
        let reviewCandidateExposure = postDecisionPortfolioCandidateCurrentExposure(
            reviewTime,
            candidateSymbol: candidateSymbol
        )
        let metrics = PostDecisionPortfolioMetrics(
            candidateQuantity: quantityComparable
                ? .comparable(decisionCandidate?.quantity ?? 0, reviewCandidate?.quantity ?? 0, precision: 8)
                : .unavailable,
            candidateExposure: .comparable(
                decisionCandidateExposure,
                reviewCandidateExposure,
                precision: 2
            ),
            candidateWeight: currentValuationComparable
                ? .comparable(decisionCandidate?.marketWeight ?? 0, reviewCandidate?.marketWeight ?? 0, precision: 8)
                : .unavailable,
            positionCount: quantityComparable
                ? .comparable(Double(decisionTime.summary.positionCount), Double(reviewTime.summary.positionCount), precision: 0)
                : .unavailable,
            totalExposure: currentTotalExposureComparable
                ? .comparable(decisionTime.summary.marketValue.amount, reviewTime.summary.marketValue.amount, precision: 2)
                : .unavailable,
            missingQuoteCount: quantityComparable
                ? .comparable(
                    Double(decisionTime.summary.marketValue.missingPositionCount),
                    Double(reviewTime.summary.marketValue.missingPositionCount),
                    precision: 0
                )
                : .unavailable,
            nonCurrentQuoteCount: quantityComparable
                ? .comparable(
                    Double(postDecisionPortfolioNonCurrentQuoteCount(decisionTime)),
                    Double(postDecisionPortfolioNonCurrentQuoteCount(reviewTime)),
                    precision: 0
                )
                : .unavailable,
            largestPositionWeight: currentValuationComparable
                ? .comparable(
                    decisionTime.summary.concentration.largestPositionWeight,
                    reviewTime.summary.concentration.largestPositionWeight,
                    precision: 8
                )
                : .unavailable,
            topThreeWeight: currentValuationComparable
                ? .comparable(
                    decisionTime.summary.concentration.topThreeWeight,
                    reviewTime.summary.concentration.topThreeWeight,
                    precision: 8
                )
                : .unavailable,
            hhi: currentValuationComparable
                ? .comparable(
                    decisionTime.summary.concentration.hhi,
                    reviewTime.summary.concentration.hhi,
                    precision: 8
                )
                : .unavailable
        )
        let comparableCount = PostDecisionPortfolioMetricKey.allCases.filter {
            metrics[$0].availability == .comparable
        }.count
        let status: PostDecisionPortfolioComparisonStatus = comparableCount == PostDecisionPortfolioMetricKey.allCases.count
            ? .comparable
            : comparableCount > 0 ? .partial : .unavailable
        let gaps = postDecisionPortfolioComparisonGaps(
            decisionTime: decisionTime,
            reviewTime: reviewTime,
            candidateSymbol: candidateSymbol,
            currentValuationComparable: currentValuationComparable
        )
        let draft = PostDecisionPortfolioComparison(
            calculationVersion: PostDecisionPortfolioReviewBinding.comparisonVersionV1,
            comparisonId: "",
            status: status,
            candidateSymbol: candidateSymbol,
            decisionTime: PostDecisionPortfolioFactReference(context: decisionTime),
            reviewTime: PostDecisionPortfolioFactReference(context: reviewTime),
            metrics: metrics,
            cash: PostDecisionPortfolioComparisonCash(),
            gaps: gaps,
            safety: .neutral
        )
        let comparisonId = try postDecisionPortfolioComparisonContentId(
            object: postDecisionPortfolioJSONObject(draft)
        )
        let comparison = PostDecisionPortfolioComparison(
            calculationVersion: draft.calculationVersion,
            comparisonId: comparisonId,
            status: draft.status,
            candidateSymbol: draft.candidateSymbol,
            decisionTime: draft.decisionTime,
            reviewTime: draft.reviewTime,
            metrics: draft.metrics,
            cash: draft.cash,
            gaps: draft.gaps,
            safety: draft.safety
        )
        try comparison.validate()
        return comparison
    }

    public func validate() throws {
        var errors: [String] = []
        if calculationVersion != PostDecisionPortfolioReviewBinding.comparisonVersionV1 {
            errors.append("portfolio comparison calculationVersion is invalid")
        }
        if !postDecisionPortfolioMatchesId(comparisonId, prefix: "post-decision-portfolio-comparison") {
            errors.append("portfolio comparison comparisonId is invalid")
        }
        if !postDecisionPortfolioIsCanonicalSymbol(candidateSymbol) {
            errors.append("portfolio comparison candidateSymbol is invalid")
        }
        decisionTime.validate(label: "portfolio comparison decisionTime", errors: &errors)
        reviewTime.validate(label: "portfolio comparison reviewTime", errors: &errors)
        if decisionTime.accountScopeId != reviewTime.accountScopeId {
            errors.append("portfolio comparison cannot cross account scopes")
        }
        let comparableCount = metrics.validate(errors: &errors)
        let expectedStatus: PostDecisionPortfolioComparisonStatus = comparableCount == PostDecisionPortfolioMetricKey.allCases.count
            ? .comparable
            : comparableCount > 0 ? .partial : .unavailable
        if status != expectedStatus {
            errors.append("portfolio comparison status must match metric availability")
        }
        cash.validate(errors: &errors)
        if gaps.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            errors.append("portfolio comparison gaps must be non-empty strings")
        }
        safety.validate(errors: &errors)
        if !errors.isEmpty {
            throw PostDecisionPortfolioReviewValidationError.invalid(errors)
        }
    }
}

public struct PostDecisionPortfolioReviewTimeFacts: Codable, Equatable, Sendable {
    public let state: PostDecisionPortfolioReviewFactState
    public let envelope: PortfolioDecisionContextEnvelope
    public let limitation: String
}

public struct PostDecisionPortfolioReviewSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let neutralFactsOnly: Bool
    public let infersCausality: Bool
    public let performanceAttribution: Bool
    public let infersDecisionQuality: Bool
    public let recommendsDirection: Bool
    public let recommendsAmount: Bool
    public let recommendsWeight: Bool
    public let recommendsTiming: Bool
    public let promisesReturn: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let mutatesCash: Bool
    public let writesFee: Bool
    public let mutatesPosition: Bool
    public let callsBroker: Bool
    public let productionWrite: Bool
    public let readOnlyPortfolioFacts: Bool
    public let appendOnlyHumanReview: Bool
    public let mutatesOriginalDecision: Bool

    fileprivate func validate(errors: inout [String]) {
        if !advisoryOnly || !neutralFactsOnly
            || infersCausality || performanceAttribution || infersDecisionQuality
            || recommendsDirection || recommendsAmount || recommendsWeight || recommendsTiming
            || promisesReturn || createsOrder || createsTrade || mutatesCash || writesFee
            || mutatesPosition || callsBroker || productionWrite
            || !readOnlyPortfolioFacts || !appendOnlyHumanReview || mutatesOriginalDecision {
            errors.append("portfolio review safety must remain advisory-only, read-only, append-only, neutral, and non-mutating")
        }
    }
}

public struct PostDecisionPortfolioReviewSnapshot: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let snapshotId: String
    public let capturedAt: String
    public let decisionCheckId: String
    public let decisionSnapshotId: String
    public let candidateSymbol: String
    public let reviewTimePortfolio: PostDecisionPortfolioReviewTimeFacts
    public let comparison: PostDecisionPortfolioComparison
    public let safety: PostDecisionPortfolioReviewSafety

    public var binding: PostDecisionPortfolioReviewBinding {
        PostDecisionPortfolioReviewBinding(
            schemaVersion: schemaVersion,
            decisionCheckId: decisionCheckId,
            decisionSnapshotId: decisionSnapshotId,
            candidateSymbol: candidateSymbol,
            decisionTimePortfolio: comparison.decisionTime.identityBinding,
            reviewTimePortfolio: comparison.reviewTime.identityBinding,
            comparison: PostDecisionPortfolioComparisonBinding(
                calculationVersion: comparison.calculationVersion,
                comparisonId: comparison.comparisonId
            )
        )
    }

    fileprivate func validate(errors: inout [String]) {
        if schemaVersion != PostDecisionPortfolioReviewBinding.schemaVersionV1 {
            errors.append("portfolio review snapshot schemaVersion is invalid")
        }
        if !postDecisionPortfolioMatchesId(snapshotId, prefix: "post-decision-portfolio-review") {
            errors.append("portfolio review snapshotId is invalid")
        }
        if !postDecisionPortfolioIsStrictDate(capturedAt) {
            errors.append("portfolio review capturedAt must be an ISO UTC date-time")
        }
        if decisionCheckId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("portfolio review decisionCheckId is required")
        }
        if !postDecisionPortfolioMatchesId(decisionSnapshotId, prefix: "decision-snapshot") {
            errors.append("portfolio review decisionSnapshotId is invalid")
        }
        if !postDecisionPortfolioIsCanonicalSymbol(candidateSymbol) {
            errors.append("portfolio review candidateSymbol is invalid")
        }
        if reviewTimePortfolio.state == .notCaptured {
            errors.append("portfolio review-time state must not be not_captured")
        }
        if reviewTimePortfolio.limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("portfolio review-time limitation is required")
        }
        do {
            try reviewTimePortfolio.envelope.validateForDisplay()
        } catch {
            errors.append("portfolio review-time portfolio envelope is invalid")
        }
        let expectedReviewState = PostDecisionPortfolioReviewFactState(contextStatus: reviewTimePortfolio.envelope.status)
        if reviewTimePortfolio.state != expectedReviewState {
            errors.append("portfolio review-time state must match its preserved envelope")
        }
        do {
            try comparison.validate()
        } catch PostDecisionPortfolioReviewValidationError.invalid(let comparisonErrors) {
            errors.append(contentsOf: comparisonErrors)
        } catch {
            errors.append("portfolio review comparison is invalid")
        }
        if comparison.candidateSymbol != candidateSymbol {
            errors.append("portfolio comparison candidateSymbol must match review snapshot candidateSymbol")
        }
        let expectedReviewReference = PostDecisionPortfolioFactReference(context: reviewTimePortfolio.envelope)
        if comparison.reviewTime != expectedReviewReference {
            errors.append("portfolio review-time comparison reference must match its preserved envelope")
        }
        safety.validate(errors: &errors)
    }
}

public struct PostDecisionPortfolioReviewState: Codable, Equatable, Sendable {
    public static let historicalNotCaptured = PostDecisionPortfolioReviewState(
        availability: .notCaptured,
        snapshot: nil,
        limitation: "This historical post-decision portfolio review was not captured and is not reconstructed from current or later portfolio, quote, cash, fee, trade, or market facts."
    )

    public let availability: PostDecisionPortfolioReviewAvailability
    public let snapshot: PostDecisionPortfolioReviewSnapshot?
    public let limitation: String

    private enum CodingKeys: String, CodingKey {
        case availability
        case snapshot
        case limitation
    }

    public init(
        availability: PostDecisionPortfolioReviewAvailability,
        snapshot: PostDecisionPortfolioReviewSnapshot?,
        limitation: String
    ) {
        self.availability = availability
        self.snapshot = snapshot
        self.limitation = limitation
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        availability = try container.decode(PostDecisionPortfolioReviewAvailability.self, forKey: .availability)
        snapshot = try postDecisionDecodeRequiredNullable(
            PostDecisionPortfolioReviewSnapshot.self,
            from: container,
            forKey: .snapshot
        )
        limitation = try container.decode(String.self, forKey: .limitation)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(availability, forKey: .availability)
        try postDecisionEncodeRequiredNullable(snapshot, into: &container, forKey: .snapshot)
        try container.encode(limitation, forKey: .limitation)
    }

    public func validateForDisplay(
        decisionSnapshot: DecisionSnapshotState? = nil,
        expectedCheckId: String? = nil,
        expectedSymbol: String? = nil
    ) throws {
        var errors: [String] = []
        if limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("portfolio review limitation is required")
        }
        switch availability {
        case .notCaptured:
            if snapshot != nil {
                errors.append("not-captured portfolio review must not expose a snapshot")
            }
            if !limitation.contains("not reconstructed") {
                errors.append("not-captured portfolio review must disclose no reconstruction")
            }
        case .preserved:
            guard let snapshot else {
                errors.append("preserved portfolio review requires a snapshot")
                break
            }
            snapshot.validate(errors: &errors)
            if let expectedCheckId, snapshot.decisionCheckId != expectedCheckId {
                errors.append("portfolio review decisionCheckId must match its review record")
            }
            if let expectedSymbol, snapshot.candidateSymbol != expectedSymbol {
                errors.append("portfolio review candidateSymbol must match its review record")
            }
            if let decisionSnapshot {
                validate(snapshot: snapshot, against: decisionSnapshot, errors: &errors)
            }
        }
        if !errors.isEmpty {
            throw PostDecisionPortfolioReviewValidationError.invalid(errors)
        }
    }

    public func matches(binding: PostDecisionPortfolioReviewBinding?) -> Bool {
        guard let binding else { return availability == .notCaptured && snapshot == nil }
        return availability == .preserved && snapshot?.binding == binding
    }

    private func validate(
        snapshot review: PostDecisionPortfolioReviewSnapshot,
        against decisionState: DecisionSnapshotState,
        errors: inout [String]
    ) {
        guard decisionState.availability == .preserved, let decision = decisionState.snapshot else {
            errors.append("preserved portfolio review requires a valid preserved decision snapshot")
            return
        }
        do {
            try decisionState.validateForDisplay(decisionContext: decision.decisionContext)
        } catch {
            errors.append("preserved portfolio review decision snapshot is invalid")
            return
        }
        guard decision.portfolioContext.state.carriesPositionFacts,
              let decisionPortfolio = decision.portfolioContext.envelope else {
            errors.append("preserved portfolio review requires decision-time position facts")
            return
        }
        if review.decisionSnapshotId != decision.snapshotId || review.candidateSymbol != decision.candidateSymbol {
            errors.append("portfolio review must bind the exact decision snapshot and candidate")
        }
        if review.reviewTimePortfolio.envelope.accountScopeId != decisionPortfolio.accountScopeId {
            errors.append("portfolio review cannot compare across account scopes")
        }
        if review.comparison.decisionTime != PostDecisionPortfolioFactReference(context: decisionPortfolio) {
            errors.append("portfolio review decision-time comparison reference must match the preserved decision facts")
        }
        do {
            let expected = try PostDecisionPortfolioComparison.build(
                decisionTime: decisionPortfolio,
                reviewTime: review.reviewTimePortfolio.envelope,
                candidateSymbol: decision.candidateSymbol
            )
            if review.comparison != expected {
                errors.append("portfolio review neutral comparison does not match the preserved decision-time and review-time facts")
            }
        } catch {
            errors.append("portfolio review neutral comparison could not be reproduced")
        }
    }
}

func postDecisionPortfolioComparisonContentId(object: [String: Any]) throws -> String {
    var input = object
    input.removeValue(forKey: "comparisonId")
    for key in ["decisionTime", "reviewTime"] {
        if var reference = input[key] as? [String: Any] {
            reference.removeValue(forKey: "assembledAt")
            input[key] = reference
        }
    }
    return try portfolioDecisionContentId(
        object: input,
        prefix: "post-decision-portfolio-comparison:",
        excludingTopLevelKeys: []
    )
}

func postDecisionPortfolioJSONObject<T: Encodable>(_ value: T) throws -> [String: Any] {
    let data = try JSONEncoder().encode(value)
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw PostDecisionPortfolioReviewValidationError.invalid(["post-decision portfolio value must encode as an object"])
    }
    return object
}

private func postDecisionPortfolioComparisonGaps(
    decisionTime: PortfolioDecisionContextEnvelope,
    reviewTime: PortfolioDecisionContextEnvelope,
    candidateSymbol: String,
    currentValuationComparable: Bool
) -> [String] {
    var gaps = ["Cash is unknown at decision and review time because the authoritative snapshot does not provide cash facts."]
    if decisionTime.status != .available {
        gaps.append("Decision-time portfolio state is \(PostDecisionPortfolioReviewFactState(contextStatus: decisionTime.status).rawValue); \(postDecisionPortfolioUnavailableValuationDimensions(decisionTime)) deltas are unavailable.")
    }
    if reviewTime.status != .available {
        gaps.append("Review-time portfolio state is \(PostDecisionPortfolioReviewFactState(contextStatus: reviewTime.status).rawValue); \(postDecisionPortfolioUnavailableValuationDimensions(reviewTime)) deltas are unavailable.")
    }
    if decisionTime.summary.marketValue.missingPositionCount > 0 {
        gaps.append("Decision-time facts have \(decisionTime.summary.marketValue.missingPositionCount) position quote gap(s).")
    }
    if reviewTime.summary.marketValue.missingPositionCount > 0 {
        gaps.append("Review-time facts have \(reviewTime.summary.marketValue.missingPositionCount) position quote gap(s).")
    }
    let decisionNonCurrent = postDecisionPortfolioNonCurrentQuoteCount(decisionTime)
    let reviewNonCurrent = postDecisionPortfolioNonCurrentQuoteCount(reviewTime)
    if decisionNonCurrent > 0 {
        gaps.append("Decision-time facts have \(decisionNonCurrent) non-current Futu quote(s).")
    }
    if reviewNonCurrent > 0 {
        gaps.append("Review-time facts have \(reviewNonCurrent) non-current Futu quote(s).")
    }
    let decisionSymbols = Set(decisionTime.positions.map(\.symbol))
    let reviewSymbols = Set(reviewTime.positions.map(\.symbol))
    let absentAtReview = decisionSymbols.subtracting(reviewSymbols).sorted()
    let absentAtDecision = reviewSymbols.subtracting(decisionSymbols).sorted()
    if !absentAtReview.isEmpty {
        gaps.append("Position symbol(s) present only at decision time: \(absentAtReview.joined(separator: ", ")).")
    }
    if !absentAtDecision.isEmpty {
        gaps.append("Position symbol(s) present only at review time: \(absentAtDecision.joined(separator: ", ")).")
    }
    if postDecisionPortfolioIsDisplayable(decisionTime)
        && !decisionTime.positions.contains(where: { $0.symbol == candidateSymbol }) {
        gaps.append("The candidate is absent from the complete decision-time position set and is represented as zero quantity only for neutral comparison.")
    }
    if postDecisionPortfolioIsDisplayable(reviewTime)
        && !reviewTime.positions.contains(where: { $0.symbol == candidateSymbol }) {
        gaps.append("The candidate is absent from the complete review-time position set and is represented as zero quantity only for neutral comparison.")
    }
    if decisionTime.portfolioSnapshotId != nil
        && decisionTime.portfolioSnapshotId == reviewTime.portfolioSnapshotId {
        gaps.append("The review-time Pingan portfolio snapshot identity is unchanged from decision time; zero deltas do not prove decision impact or quality.")
    }
    if !currentValuationComparable && gaps.count == 1 {
        gaps.append("Current complete valuation facts are unavailable for one or both fact sets.")
    }
    return gaps
}

private func postDecisionPortfolioIsDisplayable(_ context: PortfolioDecisionContextEnvelope) -> Bool {
    context.status == .available || context.status == .stale || context.status == .partial || context.status == .zeroPosition
}

private func postDecisionPortfolioHasCurrentTotal(_ context: PortfolioDecisionContextEnvelope) -> Bool { context.status == .available || context.status == .zeroPosition }
private func postDecisionPortfolioUnavailableValuationDimensions(_ context: PortfolioDecisionContextEnvelope) -> String { context.status == .zeroPosition ? "weight and concentration" : "complete portfolio valuation, weight, and concentration" }

private func postDecisionPortfolioNonCurrentQuoteCount(_ context: PortfolioDecisionContextEnvelope) -> Int {
    context.positions.filter { $0.quote.status != .current }.count
}

private func postDecisionPortfolioCandidateCurrentExposure(
    _ context: PortfolioDecisionContextEnvelope,
    candidateSymbol: String
) -> Double? {
    guard context.status == .available || context.status == .partial || context.status == .zeroPosition else { return nil }
    guard let candidate = context.positions.first(where: { $0.symbol == candidateSymbol }) else { return 0 }
    guard candidate.quote.status == .current, candidate.marketValue?.isFinite == true else { return nil }
    return candidate.marketValue
}

private func postDecisionPortfolioRound(_ value: Double, precision: Int) -> Double {
    let factor = pow(10, Double(precision))
    let rounded = floor(value * factor + 0.5) / factor
    return rounded == 0 ? 0 : rounded
}

private func postDecisionPortfolioMatchesId(_ value: String, prefix: String) -> Bool {
    value.range(of: "^\(NSRegularExpression.escapedPattern(for: prefix)):[a-f0-9]{64}$", options: .regularExpression) != nil
}

private func postDecisionPortfolioIsCanonicalSymbol(_ value: String) -> Bool {
    value.range(of: #"^HK\.[0-9]{5}$"#, options: .regularExpression) != nil
}

private func postDecisionPortfolioIsStrictDate(_ value: String) -> Bool {
    guard value.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#, options: .regularExpression) != nil else {
        return false
    }
    return ISO8601DateFormatter().date(from: value) != nil || PostDecisionPortfolioDateFormatter.fractional.date(from: value) != nil
}

private enum PostDecisionPortfolioDateFormatter {
    static let fractional: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        return formatter
    }()
}

private func postDecisionDecodeRequiredNullable<T: Decodable, Key: CodingKey>(
    _ type: T.Type,
    from container: KeyedDecodingContainer<Key>,
    forKey key: Key
) throws -> T? {
    guard container.contains(key) else {
        throw DecodingError.keyNotFound(
            key,
            DecodingError.Context(codingPath: container.codingPath, debugDescription: "Required nullable key is missing")
        )
    }
    return try container.decodeIfPresent(type, forKey: key)
}

private func postDecisionEncodeRequiredNullable<T: Encodable, Key: CodingKey>(
    _ value: T?,
    into container: inout KeyedEncodingContainer<Key>,
    forKey key: Key
) throws {
    if let value { try container.encode(value, forKey: key) }
    else { try container.encodeNil(forKey: key) }
}
