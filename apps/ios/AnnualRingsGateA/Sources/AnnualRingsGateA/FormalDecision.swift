import Foundation

public enum FormalPersonalRiskWarningCode: String, Codable, CaseIterable, Sendable {
    case candidateWeightAboveLimit = "candidate_weight_above_limit"
    case largestPositionWeightAboveLimit = "largest_position_weight_above_limit"
    case portfolioHhiAboveLimit = "portfolio_hhi_above_limit"
    case unrealizedLossAboveBudget = "unrealized_loss_above_budget"
}

public struct FormalPersonalRiskLimits: Codable, Equatable, Sendable {
    private enum CodingKeys: String, CodingKey {
        case maxCandidateWeight, maxLargestPositionWeight, maxPortfolioHhi, maxUnrealizedLossHkd
    }

    public let maxCandidateWeight: Double?
    public let maxLargestPositionWeight: Double?
    public let maxPortfolioHhi: Double?
    public let maxUnrealizedLossHkd: Double?

    public static let none = FormalPersonalRiskLimits(
        maxCandidateWeight: nil, maxLargestPositionWeight: nil,
        maxPortfolioHhi: nil, maxUnrealizedLossHkd: nil
    )

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encodeNullable(maxCandidateWeight, forKey: .maxCandidateWeight)
        try values.encodeNullable(maxLargestPositionWeight, forKey: .maxLargestPositionWeight)
        try values.encodeNullable(maxPortfolioHhi, forKey: .maxPortfolioHhi)
        try values.encodeNullable(maxUnrealizedLossHkd, forKey: .maxUnrealizedLossHkd)
    }

    func validate(label: String) throws {
        var errors: [String] = []
        for (name, value) in [
            ("maxCandidateWeight", maxCandidateWeight),
            ("maxLargestPositionWeight", maxLargestPositionWeight),
            ("maxPortfolioHhi", maxPortfolioHhi)
        ] where value != nil && (!value!.isFinite || !(0...1).contains(value!)) {
            errors.append("\(label).\(name) must be between 0 and 1")
        }
        if let maxUnrealizedLossHkd,
           !maxUnrealizedLossHkd.isFinite || maxUnrealizedLossHkd < 0 {
            errors.append("\(label).maxUnrealizedLossHkd must be non-negative")
        }
        if !errors.isEmpty { throw DecisionWriteValidationError.invalid(errors) }
    }
}

public struct FormalPersonalRiskConfirmation: Codable, Equatable, Sendable {
    private enum CodingKeys: String, CodingKey { case limits, overrideReason, secondConfirmed }

    public let limits: FormalPersonalRiskLimits
    public let overrideReason: String?
    public let secondConfirmed: Bool

    public static let notRequested = FormalPersonalRiskConfirmation(
        limits: .none, overrideReason: nil, secondConfirmed: false
    )

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(limits, forKey: .limits)
        try values.encodeNullable(overrideReason, forKey: .overrideReason)
        try values.encode(secondConfirmed, forKey: .secondConfirmed)
    }

    func validate(label: String) throws {
        try limits.validate(label: "\(label).limits")
        if let overrideReason,
           overrideReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || overrideReason.count > 4_000 {
            throw DecisionWriteValidationError.invalid(["\(label).overrideReason is invalid"])
        }
    }
}

public struct FormalPersonalRiskWarning: Codable, Equatable, Sendable {
    public let code: FormalPersonalRiskWarningCode
    public let actual: Double
    public let limit: Double
}

public struct FormalPersonalRiskAssessment: Codable, Equatable, Sendable {
    public let status: String
    public let warnings: [FormalPersonalRiskWarning]
    public let unavailableMetrics: [FormalPersonalRiskWarningCode]
    public let requiresOverride: Bool
    public let limitation: String
}

public struct FormalOwnerDecisionInput: Codable, Equatable, Sendable {
    public let reason: String
    public let horizon: String
    public let priceConditions: String
    public let positionRange: String
    public let mainRisks: String
    public let invalidationConditions: String
    public let reviewOn: String
    public let divergenceReason: String?
    public let positionBasis: String
    public let personalRisk: FormalPersonalRiskConfirmation?

    public init(
        reason: String, horizon: String, priceConditions: String, positionRange: String,
        mainRisks: String, invalidationConditions: String, reviewOn: String,
        divergenceReason: String?, positionBasis: String,
        personalRisk: FormalPersonalRiskConfirmation? = .notRequested
    ) {
        self.reason = reason
        self.horizon = horizon
        self.priceConditions = priceConditions
        self.positionRange = positionRange
        self.mainRisks = mainRisks
        self.invalidationConditions = invalidationConditions
        self.reviewOn = reviewOn
        self.divergenceReason = divergenceReason
        self.positionBasis = positionBasis
        self.personalRisk = personalRisk
    }

    func validate(label: String = "formalDecision.ownerDecision") throws {
        var errors: [String] = []
        for (name, value) in [
            ("reason", reason), ("horizon", horizon),
            ("priceConditions", priceConditions), ("positionRange", positionRange),
            ("mainRisks", mainRisks), ("invalidationConditions", invalidationConditions)
        ] where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || value.count > 4_000 {
            errors.append("\(label).\(name) is required and must not exceed 4000 characters")
        }
        if reviewOn.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) == nil {
            errors.append("\(label).reviewOn must be YYYY-MM-DD")
        }
        if let divergenceReason,
           divergenceReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(label).divergenceReason must be non-empty when present")
        }
        if positionBasis != "research_only" {
            errors.append("\(label).positionBasis must be research_only")
        }
        do { try personalRisk?.validate(label: "\(label).personalRisk") }
        catch DecisionWriteValidationError.invalid(let riskErrors) { errors.append(contentsOf: riskErrors) }
        catch { errors.append("\(label).personalRisk is invalid") }
        if !errors.isEmpty { throw DecisionWriteValidationError.invalid(errors) }
    }
}

public struct FormalSystemRecommendationSnapshot: Codable, Equatable, Sendable {
    public let source: String
    public let direction: String
    public let conclusion: String
    public let confidence: String
    public let horizon: String
    public let priceConditions: [String]
    public let priceRange: String
    public let researchPositionRange: String
    public let assumptions: [String]
    public let scenarios: [String]
    public let risks: [String]
    public let invalidationConditions: [String]
    public let nextQuestion: String
    public let versionChange: String
    public let reportId: String
    public let reportVersion: Int
    public let reportFingerprint: String
    public let nonExecuting: Bool
}

public struct FormalDecisionState: Codable, Equatable, Sendable {
    public let availability: String
    public let systemRecommendation: FormalSystemRecommendationSnapshot?
    public let ownerDecision: FormalOwnerDecisionInput?
    public let differsFromSystem: Bool?
    public let personalRiskAssessment: FormalPersonalRiskAssessment?
    public let limitation: String

    public init(
        availability: String, systemRecommendation: FormalSystemRecommendationSnapshot?,
        ownerDecision: FormalOwnerDecisionInput?, differsFromSystem: Bool?,
        personalRiskAssessment: FormalPersonalRiskAssessment? = nil, limitation: String
    ) {
        self.availability = availability
        self.systemRecommendation = systemRecommendation
        self.ownerDecision = ownerDecision
        self.differsFromSystem = differsFromSystem
        self.personalRiskAssessment = personalRiskAssessment
        self.limitation = limitation
    }

    public static let notCaptured = FormalDecisionState(
        availability: "not_captured",
        systemRecommendation: nil,
        ownerDecision: nil,
        differsFromSystem: nil,
        limitation: "Historical decision did not capture separate recommendation and Owner decision."
    )

    func validate(
        reportBinding: ResearchReportDecisionBinding?,
        actionIntent: String,
        label: String = "formalDecision"
    ) throws {
        var errors: [String] = []
        if limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(label).limitation is required")
        }
        if availability == "not_captured" {
            if systemRecommendation != nil || ownerDecision != nil || differsFromSystem != nil || personalRiskAssessment != nil {
                errors.append("\(label) not_captured values must be empty")
            }
        } else if availability == "preserved",
                  let recommendation = systemRecommendation,
                  let ownerDecision,
                  let differsFromSystem {
            if recommendation.source != "deep_research_report_advice_layer"
                || DecisionActionIntent(rawValue: recommendation.direction) == nil
                || recommendation.conclusion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || recommendation.horizon.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || recommendation.priceRange.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || recommendation.researchPositionRange.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || recommendation.nextQuestion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || recommendation.versionChange.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || recommendation.reportVersion <= 0
                || recommendation.reportFingerprint.range(
                    of: #"^[a-f0-9]{64}$"#, options: .regularExpression
                ) == nil
                || recommendation.nonExecuting != true {
                errors.append("\(label).systemRecommendation is invalid")
            }
            do { try ownerDecision.validate(label: "\(label).ownerDecision") }
            catch DecisionWriteValidationError.invalid(let ownerErrors) {
                errors.append(contentsOf: ownerErrors)
            } catch { errors.append("\(label).ownerDecision is invalid") }
            if let reportBinding,
               (recommendation.reportId != reportBinding.reportId
                || recommendation.reportVersion != reportBinding.reportVersion
                || recommendation.reportFingerprint != reportBinding.reportFingerprint) {
                errors.append("\(label).systemRecommendation must bind the preserved report")
            }
            let expectedDifference = recommendation.direction != actionIntent
            if differsFromSystem != expectedDifference {
                errors.append("\(label).differsFromSystem must match the Owner direction")
            }
            if expectedDifference && ownerDecision.divergenceReason == nil {
                errors.append("\(label).ownerDecision.divergenceReason is required when directions differ")
            }
            if let assessment = personalRiskAssessment {
                let requiresOverride = !assessment.warnings.isEmpty || !assessment.unavailableMetrics.isEmpty
                if assessment.requiresOverride != requiresOverride {
                    errors.append("\(label).personalRiskAssessment requiresOverride is invalid")
                }
                if requiresOverride,
                   ownerDecision.personalRisk?.secondConfirmed != true
                    || ownerDecision.personalRisk?.overrideReason == nil {
                    errors.append("\(label) personal risk warnings require an override reason and second confirmation")
                }
                if !requiresOverride,
                   ownerDecision.personalRisk?.secondConfirmed == true
                    || ownerDecision.personalRisk?.overrideReason != nil {
                    errors.append("\(label) clear personal risk must not claim an override")
                }
            }
        } else {
            errors.append("\(label).availability is invalid")
        }
        if !errors.isEmpty { throw DecisionWriteValidationError.invalid(errors) }
    }
}

public enum FormalDecisionContinuityStatus: Equatable, Sendable {
    case currentPendingReview
    case currentReviewDue
    case currentReviewed(DecisionReviewOutcome)
    case currentRequiresNewDecision(DecisionReviewOutcome)
    case superseded(latestCheckId: String)
}

public func latestPreservedFormalDecision(
    in checks: [RecordedDecisionCheckReviewState]
) -> RecordedDecisionCheckReviewState? {
    checks
        .filter {
            $0.researchReportDecision.availability == "preserved"
                && $0.formalDecision.availability == "preserved"
        }
        .max { lhs, rhs in
            let left = parseInstant(lhs.checkedAt) ?? .distantPast
            let right = parseInstant(rhs.checkedAt) ?? .distantPast
            return left == right ? lhs.id < rhs.id : left < right
        }
}

public func formalDecisionContinuityStatus(
    for check: RecordedDecisionCheckReviewState,
    among checks: [RecordedDecisionCheckReviewState],
    asOf: Date = Date()
) -> FormalDecisionContinuityStatus? {
    guard check.researchReportDecision.availability == "preserved",
          check.formalDecision.availability == "preserved",
          let latest = latestPreservedFormalDecision(in: checks) else { return nil }
    guard latest.id == check.id else { return .superseded(latestCheckId: latest.id) }
    let review = check.reviews.max(by: {
        let left = parseInstant($0.reviewedAt) ?? .distantPast
        let right = parseInstant($1.reviewedAt) ?? .distantPast
        return left == right ? $0.id < $1.id : left < right
    })
    if let review, [.thesisWeakened, .thesisInvalidated].contains(review.outcome) {
        return .currentRequiresNewDecision(review.outcome)
    }
    if let reviewOn = check.formalDecision.ownerDecision.flatMap({ calendarDate($0.reviewOn) }),
       reviewOn <= Calendar.current.startOfDay(for: asOf),
       (review.flatMap({ parseInstant($0.reviewedAt) }) ?? .distantPast) < reviewOn {
        return .currentReviewDue
    }
    return review.map { .currentReviewed($0.outcome) } ?? .currentPendingReview
}

private func calendarDate(_ value: String) -> Date? {
    let parts = value.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
}

public struct FormalOwnerDecisionDraft: Equatable, Sendable {
    public var reason = ""
    public var horizon = ""
    public var priceConditions = ""
    public var positionRange = ""
    public var mainRisks = ""
    public var invalidationConditions = ""
    public var reviewOn = Date().addingTimeInterval(30 * 24 * 60 * 60)
    public var divergenceReason = ""
    public var maxCandidateWeightPercent = ""
    public var maxLargestPositionWeightPercent = ""
    public var maxPortfolioHhi = ""
    public var maxUnrealizedLossHkd = ""
    public var riskOverrideReason = ""

    public static func from(_ advice: TwoLayerAdvice) -> Self {
        var draft = Self()
        draft.horizon = advice.horizonStatement
        draft.priceConditions = advice.priceConditions?.joined(separator: "\n") ?? "UNKNOWN"
        draft.positionRange = advice.researchPositionRange ?? "研究级假设仓位；不代表真实组合仓位。"
        draft.mainRisks = unique(advice.longTerm.risks + advice.mediumShortTerm.risks).joined(separator: "\n")
        draft.invalidationConditions = unique(
            advice.longTerm.invalidationConditions + advice.mediumShortTerm.invalidationConditions
        ).joined(separator: "\n")
        if let date = ISO8601DateFormatter().date(from: advice.applicableUntil) {
            draft.reviewOn = date
        }
        return draft
    }

    public func request(
        direction: DecisionActionIntent,
        systemDirection: String,
        secondRiskConfirmation: Bool = false
    ) -> FormalOwnerDecisionInput? {
        guard let limits = personalRiskLimits else { return nil }
        let input = FormalOwnerDecisionInput(
            reason: reason.trimmingCharacters(in: .whitespacesAndNewlines),
            horizon: horizon.trimmingCharacters(in: .whitespacesAndNewlines),
            priceConditions: priceConditions.trimmingCharacters(in: .whitespacesAndNewlines),
            positionRange: positionRange.trimmingCharacters(in: .whitespacesAndNewlines),
            mainRisks: mainRisks.trimmingCharacters(in: .whitespacesAndNewlines),
            invalidationConditions: invalidationConditions.trimmingCharacters(in: .whitespacesAndNewlines),
            reviewOn: Self.calendarDate(reviewOn),
            divergenceReason: direction.rawValue == systemDirection
                ? nil
                : divergenceReason.trimmingCharacters(in: .whitespacesAndNewlines),
            positionBasis: "research_only",
            personalRisk: FormalPersonalRiskConfirmation(
                limits: limits,
                overrideReason: riskOverrideReason.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                secondConfirmed: secondRiskConfirmation
            )
        )
        guard (try? input.validate()) != nil else { return nil }
        return input
    }

    public var personalRiskLimits: FormalPersonalRiskLimits? {
        guard let candidate = Self.optionalPercent(maxCandidateWeightPercent),
              let largest = Self.optionalPercent(maxLargestPositionWeightPercent),
              let hhi = Self.optionalUnit(maxPortfolioHhi),
              let loss = Self.optionalNonNegative(maxUnrealizedLossHkd) else { return nil }
        return FormalPersonalRiskLimits(
            maxCandidateWeight: candidate,
            maxLargestPositionWeight: largest,
            maxPortfolioHhi: hhi,
            maxUnrealizedLossHkd: loss
        )
    }

    private static func calendarDate(_ date: Date) -> String {
        let parts = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    private static func optionalPercent(_ value: String) -> Double?? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .some(nil) }
        guard let parsed = Double(trimmed), parsed.isFinite, (0...100).contains(parsed) else { return nil }
        return .some(parsed / 100)
    }

    private static func optionalUnit(_ value: String) -> Double?? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .some(nil) }
        guard let parsed = Double(trimmed), parsed.isFinite, (0...1).contains(parsed) else { return nil }
        return .some(parsed)
    }

    private static func optionalNonNegative(_ value: String) -> Double?? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .some(nil) }
        guard let parsed = Double(trimmed), parsed.isFinite, parsed >= 0 else { return nil }
        return .some(parsed)
    }

    private static func unique(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.filter { !$0.isEmpty && seen.insert($0).inserted }
    }
}

public func evaluateFormalPersonalRisk(
    limits: FormalPersonalRiskLimits,
    portfolioContext: PortfolioDecisionContextEnvelope?,
    riskImpact: PortfolioRiskImpactEnvelope?
) -> FormalPersonalRiskAssessment {
    let unrealizedPnl = portfolioContext?.summary.unrealizedPnl
    let metrics: [(FormalPersonalRiskWarningCode, Double?, Double?)] = [
        (.candidateWeightAboveLimit, riskImpact?.scenario.candidateWeight, limits.maxCandidateWeight),
        (.largestPositionWeightAboveLimit, riskImpact?.scenario.largestPositionWeight, limits.maxLargestPositionWeight),
        (.portfolioHhiAboveLimit, riskImpact?.scenario.hhi, limits.maxPortfolioHhi),
        (.unrealizedLossAboveBudget, unrealizedPnl.map { max(0, -$0) }, limits.maxUnrealizedLossHkd)
    ]
    let configured = metrics.filter { $0.2 != nil }
    guard !configured.isEmpty else {
        return FormalPersonalRiskAssessment(
            status: "not_requested", warnings: [], unavailableMetrics: [], requiresOverride: false,
            limitation: "No personal risk limit was supplied for this formal decision."
        )
    }
    let unavailable = configured.compactMap { metric in metric.1 == nil ? metric.0 : nil }
    let warnings = configured.compactMap { code, actual, limit -> FormalPersonalRiskWarning? in
        guard let actual, let limit, actual > limit else { return nil }
        return FormalPersonalRiskWarning(code: code, actual: actual, limit: limit)
    }
    let status = unavailable.isEmpty ? "available" : unavailable.count == configured.count ? "unavailable" : "partial"
    return FormalPersonalRiskAssessment(
        status: status,
        warnings: warnings,
        unavailableMetrics: unavailable,
        requiresOverride: !warnings.isEmpty || !unavailable.isEmpty,
        limitation: "Personal limits are checked against the exact decision snapshot; warnings are advisory and never create an order, trade, or asset mutation."
    )
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

private extension KeyedEncodingContainer {
    mutating func encodeNullable<T: Encodable>(_ value: T?, forKey key: Key) throws {
        if let value { try encode(value, forKey: key) }
        else { try encodeNil(forKey: key) }
    }
}

func validateFormalDecisionRawShape(_ value: Any, label: String) throws {
    let baseStateKeys = Set(["availability", "systemRecommendation", "ownerDecision", "differsFromSystem", "limitation"])
    guard let state = value as? [String: Any],
          Set(state.keys).subtracting(["personalRiskAssessment"]) == baseStateKeys,
          let availability = state["availability"] as? String else {
        throw DecisionSnapshotValidationError.invalid(["\(label) must have exact formal-decision fields"])
    }
    if availability == "not_captured" {
        guard state["systemRecommendation"] is NSNull,
              state["ownerDecision"] is NSNull,
              state["differsFromSystem"] is NSNull,
              state["personalRiskAssessment"] == nil || state["personalRiskAssessment"] is NSNull else {
            throw DecisionSnapshotValidationError.invalid(["\(label) not_captured values must be null"])
        }
        return
    }
    guard availability == "preserved",
          let recommendation = state["systemRecommendation"] as? [String: Any],
          let owner = state["ownerDecision"] as? [String: Any],
          state["differsFromSystem"] is Bool,
          Set(recommendation.keys) == Set([
            "source", "direction", "conclusion", "confidence", "horizon", "priceConditions",
            "priceRange", "researchPositionRange", "assumptions", "scenarios", "risks",
            "invalidationConditions", "nextQuestion", "versionChange", "reportId", "reportVersion",
            "reportFingerprint", "nonExecuting"
          ]),
          Set(owner.keys).subtracting(["personalRisk"]) == Set([
            "reason", "horizon", "priceConditions", "positionRange", "mainRisks",
            "invalidationConditions", "reviewOn", "divergenceReason", "positionBasis"
          ]) else {
        throw DecisionSnapshotValidationError.invalid(["\(label) preserved fields are invalid"])
    }
    if let personalRisk = owner["personalRisk"] as? [String: Any] {
        guard Set(personalRisk.keys) == Set(["limits", "overrideReason", "secondConfirmed"]),
              let limits = personalRisk["limits"] as? [String: Any],
              Set(limits.keys) == Set([
                "maxCandidateWeight", "maxLargestPositionWeight", "maxPortfolioHhi", "maxUnrealizedLossHkd"
              ]), personalRisk["secondConfirmed"] is Bool else {
            throw DecisionSnapshotValidationError.invalid(["\(label) personal-risk confirmation is invalid"])
        }
    }
    if let assessment = state["personalRiskAssessment"] as? [String: Any] {
        guard Set(assessment.keys) == Set([
            "status", "warnings", "unavailableMetrics", "requiresOverride", "limitation"
        ]), assessment["warnings"] is [Any], assessment["unavailableMetrics"] is [Any],
              assessment["requiresOverride"] is Bool else {
            throw DecisionSnapshotValidationError.invalid(["\(label) personal-risk assessment is invalid"])
        }
    }
}
