import Foundation

public let annualConditionalDecisionSchemaVersion = "2026-07-17.annual-conditional-decision.v1"

public enum AnnualConditionalDecisionValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public enum AnnualConditionalDecisionConfidence: String, Codable, CaseIterable, Equatable, Sendable {
    case low
    case medium
    case high
}

public enum AnnualConditionalPortfolioMetric: String, Codable, CaseIterable, Equatable, Sendable {
    case scenarioCandidateWeight = "scenario_candidate_weight"
    case scenarioLargestPositionWeight = "scenario_largest_position_weight"
    case scenarioHhi = "scenario_hhi"
}

public enum AnnualConditionalPortfolioComparison: String, Codable, CaseIterable, Equatable, Sendable {
    case atOrAbove = "at_or_above"
    case atOrBelow = "at_or_below"
}

public enum AnnualConditionalWorkflowState: String, Codable, CaseIterable, Equatable, Sendable {
    case continueResearch = "continue_research"
    case awaitCondition = "await_condition"
    case judgmentFormed = "judgment_formed"
    case stopFollowing = "stop_following"

    public var humanCheckResult: String {
        switch self {
        case .judgmentFormed: "ready_to_consider"
        case .stopFollowing: "blocked"
        case .continueResearch, .awaitCondition: "needs_more_evidence"
        }
    }
}

enum AnnualConditionalDecisionResponseDisposition: Equatable {
    case current
    case staleRequest
    case superseded
}

struct AnnualConditionalDecisionRequestGate: Equatable {
    let requestId: UUID
    let membershipId: String
    let membershipVersion: Int
    let symbol: String
    let valuation: AnnualValuationScenarioInput
    let quantFilter: AnnualQuantFilterInput
    let scenarioAmounts: [Double]
    let selectedScenarioIndex: Int

    func disposition(
        currentRequestId: UUID,
        membershipId: String?,
        membershipVersion: Int?,
        symbol: String?,
        valuation: AnnualValuationScenarioInput?,
        quantFilter: AnnualQuantFilterInput?,
        scenarioAmounts: [Double]?,
        selectedScenarioIndex: Int
    ) -> AnnualConditionalDecisionResponseDisposition {
        guard currentRequestId == requestId else { return .staleRequest }
        return membershipId == self.membershipId
            && membershipVersion == self.membershipVersion
            && symbol == self.symbol
            && valuation == self.valuation
            && quantFilter == self.quantFilter
            && scenarioAmounts == self.scenarioAmounts
            && selectedScenarioIndex == self.selectedScenarioIndex
            ? .current
            : .superseded
    }
}

struct AnnualConditionalDecisionDraftSource: Equatable {
    let previewId: String
    let membershipId: String
    let membershipVersion: Int
    let symbol: String

    init?(preview: AnnualConditionalDecisionPreviewEnvelope) {
        guard preview.status == "available",
              let previewId = preview.previewId,
              let target = preview.data?.decisionBrief.data?.target,
              preview.membershipId == target.membershipId,
              preview.requestedSymbol == target.symbol else { return nil }
        self.previewId = previewId
        membershipId = target.membershipId
        membershipVersion = target.membershipVersion
        symbol = target.symbol
    }
}

public final class AnnualConditionalDecisionPreviewEnvelope: Codable, Equatable, @unchecked Sendable {
    public let schemaVersion: String
    public let generatedAt: String
    public let status: String
    public let previewId: String?
    public let membershipId: String
    public let requestedActorId: String
    public let requestedSymbol: String?
    public let data: AnnualConditionalDecisionPreviewData?
    public let safety: AnnualConditionalDecisionSafety
    public let message: String
    public let clientFailureState: String?

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, generatedAt, status, previewId, membershipId, requestedActorId
        case requestedSymbol, data, safety, message
    }

    public required convenience init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            schemaVersion: try container.decode(String.self, forKey: .schemaVersion),
            generatedAt: try container.decode(String.self, forKey: .generatedAt),
            status: try container.decode(String.self, forKey: .status),
            previewId: try container.decodeRequiredConditionalNullable(String.self, forKey: .previewId),
            membershipId: try container.decode(String.self, forKey: .membershipId),
            requestedActorId: try container.decode(String.self, forKey: .requestedActorId),
            requestedSymbol: try container.decodeRequiredConditionalNullable(String.self, forKey: .requestedSymbol),
            data: try container.decodeRequiredConditionalNullable(AnnualConditionalDecisionPreviewData.self, forKey: .data),
            safety: try container.decode(AnnualConditionalDecisionSafety.self, forKey: .safety),
            message: try container.decode(String.self, forKey: .message)
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(generatedAt, forKey: .generatedAt)
        try container.encode(status, forKey: .status)
        try container.encode(previewId, forKey: .previewId)
        try container.encode(membershipId, forKey: .membershipId)
        try container.encode(requestedActorId, forKey: .requestedActorId)
        try container.encode(requestedSymbol, forKey: .requestedSymbol)
        try container.encode(data, forKey: .data)
        try container.encode(safety, forKey: .safety)
        try container.encode(message, forKey: .message)
    }

    public init(
        schemaVersion: String = annualConditionalDecisionSchemaVersion,
        generatedAt: String,
        status: String,
        previewId: String?,
        membershipId: String,
        requestedActorId: String,
        requestedSymbol: String?,
        data: AnnualConditionalDecisionPreviewData?,
        safety: AnnualConditionalDecisionSafety,
        message: String,
        clientFailureState: String? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.generatedAt = generatedAt
        self.status = status
        self.previewId = previewId
        self.membershipId = membershipId
        self.requestedActorId = requestedActorId
        self.requestedSymbol = requestedSymbol
        self.data = data
        self.safety = safety
        self.message = message
        self.clientFailureState = clientFailureState
    }

    public static func unavailable(
        _ message: String,
        membershipId: String = "unselected",
        clientFailureState: String = "unavailable"
    ) -> AnnualConditionalDecisionPreviewEnvelope {
        .init(
            generatedAt: "1970-01-01T00:00:00.000Z",
            status: "unavailable",
            previewId: nil,
            membershipId: membershipId,
            requestedActorId: "client:\(clientFailureState)",
            requestedSymbol: nil,
            data: nil,
            safety: .safe,
            message: message,
            clientFailureState: clientFailureState
        )
    }

    public func validated(
        expectedMembershipId: String,
        expectedMembershipVersion: Int,
        expectedSymbol: String,
        valuation: AnnualValuationScenarioInput,
        quantFilter: AnnualQuantFilterInput,
        scenarioAmounts: [Double],
        selectedScenarioIndex: Int
    ) throws -> AnnualConditionalDecisionPreviewEnvelope {
        var errors: [String] = []
        if schemaVersion != annualConditionalDecisionSchemaVersion || !isStrictUtcDateTime(generatedAt) {
            errors.append("conditional decision preview schema or generatedAt is invalid")
        }
        if !["available", "blocked", "not_found", "malformed", "unauthorized", "unavailable"].contains(status) {
            errors.append("conditional decision preview status is invalid")
        }
        if membershipId != expectedMembershipId || requestedActorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("conditional decision preview request identity is invalid")
        }
        safety.validate(errors: &errors)
        if status == "available" {
            guard let data, let requestedSymbol, let previewId else {
                errors.append("available conditional decision preview requires data and identities")
                throw AnnualConditionalDecisionValidationError.invalid(errors)
            }
            if requestedSymbol != expectedSymbol
                || previewId.range(of: #"^annual-conditional-preview:[a-f0-9]{64}$"#, options: .regularExpression) == nil {
                errors.append("conditional decision preview symbol or previewId is invalid")
            }
            try data.validate(
                membershipId: expectedMembershipId,
                membershipVersion: expectedMembershipVersion,
                symbol: expectedSymbol,
                requestedActorId: requestedActorId,
                valuation: valuation,
                quantFilter: quantFilter,
                scenarioAmounts: scenarioAmounts,
                selectedScenarioIndex: selectedScenarioIndex,
                errors: &errors
            )
        } else if previewId != nil || requestedSymbol != nil || data != nil {
            errors.append("fail-closed conditional decision preview must clear identities and facts")
        }
        if !errors.isEmpty { throw AnnualConditionalDecisionValidationError.invalid(errors) }
        return self
    }

    public func validatedIntrinsic() throws -> AnnualConditionalDecisionPreviewEnvelope {
        guard let target = data?.decisionBrief.data?.target,
              let valuation = data?.valuationQuant.data?.valuation.inputs,
              let quantFilter = data?.valuationQuant.data?.quant.filter.criteria,
              let scenarios = data?.portfolioLab.data?.scenarios else {
            throw AnnualConditionalDecisionValidationError.invalid([
                "conditional decision preview intrinsic inputs are unavailable"
            ])
        }
        return try validated(
            expectedMembershipId: target.membershipId,
            expectedMembershipVersion: target.membershipVersion,
            expectedSymbol: target.symbol,
            valuation: valuation,
            quantFilter: quantFilter,
            scenarioAmounts: scenarios.map(\.hypotheticalAmount),
            selectedScenarioIndex: data?.selectedPortfolioScenarioIndex ?? -1
        )
    }

    public static func == (
        lhs: AnnualConditionalDecisionPreviewEnvelope,
        rhs: AnnualConditionalDecisionPreviewEnvelope
    ) -> Bool {
        lhs.schemaVersion == rhs.schemaVersion
            && lhs.generatedAt == rhs.generatedAt
            && lhs.status == rhs.status
            && lhs.previewId == rhs.previewId
            && lhs.membershipId == rhs.membershipId
            && lhs.requestedActorId == rhs.requestedActorId
            && lhs.requestedSymbol == rhs.requestedSymbol
            && lhs.data == rhs.data
            && lhs.safety == rhs.safety
            && lhs.message == rhs.message
            && lhs.clientFailureState == rhs.clientFailureState
    }
}

public struct AnnualConditionalDecisionPreviewData: Codable, Equatable, Sendable {
    public let decisionBrief: AnnualDecisionBriefEnvelope
    public let valuationQuant: AnnualValuationQuantWorkbenchEnvelope
    public let portfolioLab: AnnualPortfolioLabEnvelope
    public let selectedPortfolioScenarioIndex: Int

    public var selectedScenario: AnnualPortfolioLabScenario? {
        guard let scenarios = portfolioLab.data?.scenarios,
              scenarios.indices.contains(selectedPortfolioScenarioIndex) else { return nil }
        return scenarios[selectedPortfolioScenarioIndex]
    }

    public func decisionSnapshotBinding() throws -> DecisionSnapshotBinding {
        guard let portfolio = portfolioLab.data?.portfolio,
              let risk = selectedScenario?.riskImpact else {
            throw AnnualConditionalDecisionValidationError.invalid(["conditional preview portfolio or selected risk is unavailable"])
        }
        return try DecisionSnapshotBinding.capture(portfolioContext: portfolio, riskImpact: risk)
    }

    fileprivate func validate(
        membershipId: String,
        membershipVersion: Int,
        symbol: String,
        requestedActorId: String,
        valuation: AnnualValuationScenarioInput,
        quantFilter: AnnualQuantFilterInput,
        scenarioAmounts: [Double],
        selectedScenarioIndex: Int,
        errors: inout [String]
    ) throws {
        do { try decisionBrief.validateForDisplay() } catch { errors.append("conditional decision brief is invalid") }
        do { _ = try valuationQuant.validated(expectedMembershipId: membershipId) } catch { errors.append("conditional valuation and quant facts are invalid") }
        do {
            _ = try portfolioLab.validated(
                expectedMembershipId: membershipId,
                expectedMembershipVersion: membershipVersion,
                expectedSymbol: symbol,
                expectedAmounts: scenarioAmounts
            )
        } catch { errors.append("conditional portfolio lab facts are invalid") }
        guard let brief = decisionBrief.data,
              let valuationData = valuationQuant.data,
              let portfolioData = portfolioLab.data else {
            errors.append("conditional decision preview source facts are unavailable")
            return
        }
        if decisionBrief.status != .available || valuationQuant.status != "available" || portfolioLab.status != "available"
            || brief.target.membershipId != membershipId || valuationData.target.membershipId != membershipId
            || portfolioData.target.membershipId != membershipId || brief.target.membershipVersion != membershipVersion
            || valuationData.target.membershipVersion != membershipVersion || portfolioData.target.membershipVersion != membershipVersion
            || brief.target.symbol != symbol || valuationData.target.symbol != symbol || portfolioData.target.symbol != symbol
            || decisionBrief.membershipId != membershipId || valuationQuant.membershipId != membershipId
            || portfolioLab.membershipId != membershipId || decisionBrief.requestedSymbol != symbol
            || valuationQuant.requestedSymbol != symbol || portfolioLab.requestedSymbol != symbol {
            errors.append("conditional decision preview does not bind one candidate version and symbol")
        }
        if decisionBrief.requestedActorId != requestedActorId
            || valuationQuant.requestedActorId != requestedActorId
            || portfolioLab.requestedActorId != requestedActorId {
            errors.append("conditional decision preview source actor identities conflict")
        }
        if brief.target.membershipState != .tracked || valuationData.target.membershipState != "tracked"
            || portfolioData.target.membershipState != "tracked" {
            errors.append("conditional decision preview requires one tracked candidate lifecycle")
        }
        if brief.readiness.state != .readyForThreeMinuteReview || brief.evidence.support.isEmpty
            || brief.evidence.counter.isEmpty && brief.evidence.gaps.isEmpty {
            errors.append("conditional decision preview requires a ready brief with support and counter evidence or gaps")
        }
        if valuationData.valuation.status != "available" || valuationData.quant.status != "available"
            || valuationData.valuation.inputs != valuation || valuationData.quant.filter.criteria != quantFilter {
            errors.append("conditional decision preview valuation and quant inputs or facts changed")
        }
        if self.selectedPortfolioScenarioIndex != selectedScenarioIndex || selectedScenario?.riskImpact.status != .available {
            errors.append("conditional decision preview selected risk scenario is invalid")
        }
        if brief.sourceIdentity.decisionContextId != valuationData.sourceIdentity.decisionContextId
            || brief.sourceIdentity.decisionContextHash != valuationData.sourceIdentity.decisionContextHash
            || brief.sourceIdentity.decisionContextId != portfolioData.sourceIdentity.decisionContextId
            || brief.sourceIdentity.decisionContextHash != portfolioData.sourceIdentity.decisionContextHash {
            errors.append("conditional decision preview decision context identities conflict")
        }
        if selectedScenario?.riskImpact.contextId != portfolioData.sourceIdentity.portfolioContextId
            || selectedScenario?.riskImpact.portfolioSnapshotId != portfolioData.sourceIdentity.portfolioSnapshotId {
            errors.append("conditional decision preview portfolio and risk identities conflict")
        }
    }
}

public struct AnnualConditionalDecisionSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let humanJudgmentOnly: Bool
    public let changesCandidateOrdering: Bool
    public let recommendation: Bool
    public let ranking: Bool
    public let score: Bool
    public let targetPrice: Bool
    public let targetPosition: Bool
    public let tradeDirection: Bool
    public let suggestedAmount: Bool
    public let automaticDecision: Bool
    public let automaticWorkflowTransition: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let callsBroker: Bool
    public let mutatesOfficialPortfolio: Bool
    public let productionWrite: Bool

    public static let safe = Self(
        advisoryOnly: true,
        humanJudgmentOnly: true,
        changesCandidateOrdering: false,
        recommendation: false,
        ranking: false,
        score: false,
        targetPrice: false,
        targetPosition: false,
        tradeDirection: false,
        suggestedAmount: false,
        automaticDecision: false,
        automaticWorkflowTransition: false,
        createsOrder: false,
        createsTrade: false,
        callsBroker: false,
        mutatesOfficialPortfolio: false,
        productionWrite: false
    )

    fileprivate func validate(errors: inout [String]) {
        if !advisoryOnly || !humanJudgmentOnly || changesCandidateOrdering || recommendation || ranking || score
            || targetPrice || targetPosition || tradeDirection || suggestedAmount || automaticDecision
            || automaticWorkflowTransition || createsOrder || createsTrade || callsBroker
            || mutatesOfficialPortfolio || productionWrite {
            errors.append("conditional decision safety must remain human-only advisory with no automatic or trading action")
        }
    }
}

public struct AnnualConditionalJudgment: Codable, Equatable, Sendable {
    public let confidence: AnnualConditionalDecisionConfidence
    public let assumptions: [String]
    public let invalidationConditions: [String]
    public let portfolioObservationConditions: [AnnualConditionalPortfolioObservationCondition]
    public let observationWindow: AnnualConditionalObservationWindow
    public let reviewOn: String
    public let workflowState: AnnualConditionalWorkflowState

    public init(
        confidence: AnnualConditionalDecisionConfidence,
        assumptions: [String],
        invalidationConditions: [String],
        portfolioObservationConditions: [AnnualConditionalPortfolioObservationCondition],
        observationWindow: AnnualConditionalObservationWindow,
        reviewOn: String,
        workflowState: AnnualConditionalWorkflowState
    ) {
        self.confidence = confidence
        self.assumptions = assumptions
        self.invalidationConditions = invalidationConditions
        self.portfolioObservationConditions = portfolioObservationConditions
        self.observationWindow = observationWindow
        self.reviewOn = reviewOn
        self.workflowState = workflowState
    }

    public func validate() throws {
        var errors: [String] = []
        validateConditionalStrings(assumptions, label: "assumptions", errors: &errors)
        validateConditionalStrings(invalidationConditions, label: "invalidation conditions", errors: &errors)
        if portfolioObservationConditions.isEmpty || portfolioObservationConditions.count > 10
            || Set(portfolioObservationConditions.map(\.identity)).count != portfolioObservationConditions.count {
            errors.append("conditional portfolio observations must contain 1 to 10 unique human-review triggers")
        }
        portfolioObservationConditions.forEach { $0.validate(errors: &errors) }
        if !isCalendarDate(observationWindow.startsOn) || !isCalendarDate(observationWindow.endsOn)
            || observationWindow.startsOn > observationWindow.endsOn {
            errors.append("conditional observation window is invalid")
        }
        if !isCalendarDate(reviewOn) || reviewOn < observationWindow.startsOn || reviewOn > observationWindow.endsOn {
            errors.append("conditional review date must fall inside the observation window")
        }
        if !errors.isEmpty { throw AnnualConditionalDecisionValidationError.invalid(errors) }
    }
}

public struct AnnualConditionalPortfolioObservationCondition: Codable, Equatable, Sendable {
    public let metric: AnnualConditionalPortfolioMetric
    public let comparison: AnnualConditionalPortfolioComparison
    public let threshold: Double
    public let rationale: String
    public let purpose: String

    public init(
        metric: AnnualConditionalPortfolioMetric,
        comparison: AnnualConditionalPortfolioComparison,
        threshold: Double,
        rationale: String,
        purpose: String = "human_review_trigger_only"
    ) {
        self.metric = metric
        self.comparison = comparison
        self.threshold = threshold
        self.rationale = rationale
        self.purpose = purpose
    }

    fileprivate var identity: String { "\(metric.rawValue)|\(comparison.rawValue)|\(threshold)" }

    fileprivate func validate(errors: inout [String]) {
        if !threshold.isFinite || !(0...1).contains(threshold)
            || rationale.isEmpty || rationale != rationale.trimmingCharacters(in: .whitespacesAndNewlines)
            || rationale.count > 500 || purpose != "human_review_trigger_only" {
            errors.append("conditional portfolio observation must be a bounded user-defined human-review trigger only")
        }
    }
}

public struct AnnualConditionalObservationWindow: Codable, Equatable, Sendable {
    public let startsOn: String
    public let endsOn: String

    public init(startsOn: String, endsOn: String) {
        self.startsOn = startsOn
        self.endsOn = endsOn
    }
}

public struct AnnualConditionalDecisionSubmission: Codable, Equatable, Sendable {
    public let preview: AnnualConditionalDecisionPreviewEnvelope
    public let judgment: AnnualConditionalJudgment

    public init(preview: AnnualConditionalDecisionPreviewEnvelope, judgment: AnnualConditionalJudgment) {
        self.preview = preview
        self.judgment = judgment
    }
}

public struct AnnualConditionalDecisionMonitor: Codable, Equatable, Sendable {
    public let evaluatedAt: String
    public let state: String
    public let reasons: [String]
    public let changes: [AnnualConditionalFactChange]
    public let currentFacts: AnnualConditionalCurrentFacts
    public let invalidationReminder: String
    public let humanReviewRequested: Bool
    public let automaticDecision: Bool
    public let automaticWorkflowTransition: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let callsBroker: Bool

    fileprivate func validate(
        preview: AnnualConditionalDecisionPreviewEnvelope,
        judgment: AnnualConditionalJudgment,
        errors: inout [String]
    ) {
        let allowed = [
            "candidate_facts_changed", "candidate_facts_unavailable",
            "decision_context_changed", "decision_context_unavailable",
            "valuation_facts_changed", "valuation_facts_unavailable",
            "quant_facts_changed", "quant_facts_unavailable",
            "portfolio_lab_quant_changed", "portfolio_lab_quant_unavailable",
            "portfolio_facts_changed", "portfolio_facts_unavailable",
            "risk_facts_changed", "risk_facts_unavailable",
            "portfolio_observation_met", "portfolio_observation_unavailable",
            "review_date_due", "observation_window_ended"
        ]
        if !isStrictUtcDateTime(evaluatedAt) || !["watching", "human_review_required"].contains(state)
            || reasons.contains(where: { !allowed.contains($0) }) || Set(reasons).count != reasons.count
            || changes.count > 50
            || invalidationReminder != "human_observation_required" || automaticDecision
            || automaticWorkflowTransition || createsOrder || createsTrade || callsBroker {
            errors.append("conditional monitor state or safety is invalid")
        }
        if state == "watching" && (!reasons.isEmpty || humanReviewRequested)
            || state == "human_review_required" && (reasons.isEmpty || !humanReviewRequested) {
            errors.append("conditional monitor review request does not match its reasons")
        }
        if (currentFacts.decisionContextId == nil) != (currentFacts.decisionContextHash == nil) {
            errors.append("conditional monitor decision-context identity must be complete or unavailable")
        }
        if (currentFacts.portfolioContextId == nil) != (currentFacts.portfolioSnapshotId == nil) {
            errors.append("conditional monitor portfolio identity must be complete or unavailable")
        }
        changes.forEach { $0.validate(allowedReasons: allowed, errors: &errors) }
        currentFacts.validate(errors: &errors)
        let expected = annualConditionalMonitorEvaluation(
            preview: preview,
            judgment: judgment,
            evaluatedAt: evaluatedAt,
            facts: currentFacts
        )
        let expectedState = expected.reasons.isEmpty ? "watching" : "human_review_required"
        if reasons != expected.reasons || changes != expected.changes || state != expectedState
            || humanReviewRequested != !expected.reasons.isEmpty {
            errors.append("conditional monitor reasons and changes must recompute from frozen and current fact identities")
        }
    }
}

public struct AnnualConditionalFactChange: Codable, Equatable, Sendable {
    public let reason: String
    public let field: String
    public let frozenValue: String?
    public let currentValue: String?
    public let detail: String

    fileprivate func validate(allowedReasons: [String], errors: inout [String]) {
        if !allowedReasons.contains(reason) || field.isEmpty
            || field != field.trimmingCharacters(in: .whitespacesAndNewlines)
            || frozenValue?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true
            || currentValue?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true
            || detail.isEmpty || detail != detail.trimmingCharacters(in: .whitespacesAndNewlines)
            || detail.count > 1_000 {
            errors.append("conditional monitor change is invalid")
        }
    }
}

public struct AnnualConditionalCurrentFacts: Codable, Equatable, Sendable {
    public let membershipId: String?
    public let membershipVersion: Int?
    public let membershipState: CandidateMembershipState?
    public let decisionContextId: String?
    public let decisionContextHash: String?
    public let valuationQuoteSnapshotId: String?
    public let valuationQuotePrice: Double?
    public let valuationCalculationVersion: String?
    public let quantSnapshotId: String?
    public let quantSnapshotHash: String?
    public let quantModelVersion: String?
    public let quantCodeIdentity: String?
    public let portfolioLabQuantEvidenceId: String?
    public let portfolioContextId: String?
    public let portfolioSnapshotId: String?
    public let riskImpactId: String?
    public let scenarioCandidateWeight: Double?
    public let scenarioLargestPositionWeight: Double?
    public let scenarioHhi: Double?

    fileprivate func validate(errors: inout [String]) {
        let strings = [
            membershipId, decisionContextId, decisionContextHash, valuationQuoteSnapshotId,
            valuationCalculationVersion, quantSnapshotId, quantSnapshotHash, quantModelVersion,
            quantCodeIdentity, portfolioLabQuantEvidenceId, portfolioContextId, portfolioSnapshotId,
            riskImpactId
        ]
        if strings.contains(where: { $0?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true }) {
            errors.append("conditional monitor current fact identities must be non-empty when present")
        }
        if membershipVersion != nil && membershipVersion! < 1 {
            errors.append("conditional monitor membership version is invalid")
        }
        if let valuationQuotePrice, !valuationQuotePrice.isFinite || valuationQuotePrice <= 0 {
            errors.append("conditional monitor valuation quote is invalid")
        }
        for value in [scenarioCandidateWeight, scenarioLargestPositionWeight, scenarioHhi].compactMap({ $0 })
        where !value.isFinite || !(0...1).contains(value) {
            errors.append("conditional monitor portfolio observation metric is invalid")
        }
        let identityGroups: [(String, [Bool])] = [
            ("candidate", [membershipId != nil, membershipVersion != nil, membershipState != nil]),
            ("decision context", [decisionContextId != nil, decisionContextHash != nil]),
            ("valuation", [valuationQuoteSnapshotId != nil, valuationQuotePrice != nil, valuationCalculationVersion != nil]),
            ("quant", [quantSnapshotId != nil, quantSnapshotHash != nil, quantModelVersion != nil, quantCodeIdentity != nil]),
            ("portfolio", [portfolioContextId != nil, portfolioSnapshotId != nil]),
            ("risk", [riskImpactId != nil, scenarioCandidateWeight != nil, scenarioLargestPositionWeight != nil, scenarioHhi != nil])
        ]
        for (label, presence) in identityGroups where presence.contains(true) && presence.contains(false) {
            errors.append("conditional monitor current \(label) identity must be complete or unavailable")
        }
    }
}

public struct AnnualConditionalDecisionState: Codable, Equatable, Sendable {
    public let availability: String
    public let preview: AnnualConditionalDecisionPreviewEnvelope?
    public let judgment: AnnualConditionalJudgment?
    public let monitor: AnnualConditionalDecisionMonitor?
    public let limitation: String

    public static let notCaptured = Self(
        availability: "conditional_decision_not_captured",
        preview: nil,
        judgment: nil,
        monitor: nil,
        limitation: "This historical conditional decision was not captured and is not reconstructed from current facts."
    )

    public func validate() throws {
        var errors: [String] = []
        if limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("conditional decision limitation is required")
        }
        if availability == "preserved" {
            guard let preview, let judgment, let monitor else {
                errors.append("preserved conditional decision requires preview, judgment, and monitor")
                throw AnnualConditionalDecisionValidationError.invalid(errors)
            }
            try judgment.validate()
            preview.validatePreservedStateIdentity(errors: &errors)
            monitor.validate(preview: preview, judgment: judgment, errors: &errors)
        } else if availability == "conditional_decision_not_captured" {
            if preview != nil || judgment != nil || monitor != nil || !limitation.contains("not reconstructed") {
                errors.append("uncaptured conditional decision must not reconstruct facts")
            }
        } else {
            errors.append("conditional decision availability is invalid")
        }
        if !errors.isEmpty { throw AnnualConditionalDecisionValidationError.invalid(errors) }
    }
}

private extension AnnualConditionalDecisionPreviewEnvelope {
    func validatePreservedStateIdentity(errors: inout [String]) {
        guard schemaVersion == annualConditionalDecisionSchemaVersion,
              isStrictUtcDateTime(generatedAt),
              status == "available",
              let previewId,
              previewId.range(of: #"^annual-conditional-preview:[a-f0-9]{64}$"#, options: .regularExpression) != nil,
              let requestedSymbol,
              let data,
              membershipId == data.decisionBrief.membershipId,
              requestedSymbol == data.decisionBrief.requestedSymbol,
              !requestedActorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errors.append("preserved conditional preview identity is invalid")
            return
        }
        safety.validate(errors: &errors)
    }
}

private struct AnnualConditionalMonitorEvaluation {
    let reasons: [String]
    let changes: [AnnualConditionalFactChange]
}

private func annualConditionalMonitorEvaluation(
    preview: AnnualConditionalDecisionPreviewEnvelope,
    judgment: AnnualConditionalJudgment,
    evaluatedAt: String,
    facts: AnnualConditionalCurrentFacts
) -> AnnualConditionalMonitorEvaluation {
    let target = preview.data?.decisionBrief.data?.target
    let brief = preview.data?.decisionBrief.data?.sourceIdentity
    let valuation = preview.data?.valuationQuant.data?.valuation
    let quant = preview.data?.valuationQuant.data?.quant
    let lab = preview.data?.portfolioLab.data
    let portfolio = lab?.sourceIdentity
    let scenario = preview.data?.selectedScenario
    var reasons: [String] = []
    var changes: [AnnualConditionalFactChange] = []
    func add(_ reason: String, _ field: String, _ frozen: String?, _ current: String?, _ detail: String) {
        if !reasons.contains(reason) { reasons.append(reason) }
        changes.append(.init(reason: reason, field: field, frozenValue: frozen, currentValue: current, detail: detail))
    }
    func compare(_ field: String, _ frozen: String?, _ current: String?, _ unavailable: String, _ changed: String) {
        if current == nil {
            add(
                unavailable, field, frozen, nil,
                "\(field) is unavailable in current facts; only a human review is requested and the saved judgment is unchanged."
            )
        } else if current != frozen {
            add(
                changed, field, frozen, current,
                "\(field) changed from the frozen fact; only a human review is requested and the saved judgment is unchanged."
            )
        }
    }
    compare(
        "candidate",
        joinedConditionalIdentity([target?.membershipId, target.map { String($0.membershipVersion) }, target?.membershipState.rawValue]),
        joinedConditionalIdentity([facts.membershipId, facts.membershipVersion.map { String($0) }, facts.membershipState?.rawValue]),
        "candidate_facts_unavailable", "candidate_facts_changed"
    )
    compare(
        "decision_context",
        joinedConditionalIdentity([brief?.decisionContextId, brief?.decisionContextHash]),
        joinedConditionalIdentity([facts.decisionContextId, facts.decisionContextHash]),
        "decision_context_unavailable", "decision_context_changed"
    )
    compare(
        "valuation",
        joinedConditionalIdentity([
            valuation?.quote?.snapshotId, valuation?.quote.map { String($0.price) }, valuation?.method.calculationVersion
        ]),
        joinedConditionalIdentity([
            facts.valuationQuoteSnapshotId, facts.valuationQuotePrice.map { String($0) }, facts.valuationCalculationVersion
        ]),
        "valuation_facts_unavailable", "valuation_facts_changed"
    )
    compare(
        "quant",
        joinedConditionalIdentity([
            quant?.model.snapshotId, quant?.model.snapshotHash, quant?.model.modelVersion, quant?.model.codeIdentity
        ]),
        joinedConditionalIdentity([
            facts.quantSnapshotId, facts.quantSnapshotHash, facts.quantModelVersion, facts.quantCodeIdentity
        ]),
        "quant_facts_unavailable", "quant_facts_changed"
    )
    compare(
        "portfolio_lab_quant", lab?.quant.evidence?.evidenceId, facts.portfolioLabQuantEvidenceId,
        "portfolio_lab_quant_unavailable", "portfolio_lab_quant_changed"
    )
    compare(
        "portfolio",
        joinedConditionalIdentity([portfolio?.portfolioContextId, portfolio?.portfolioSnapshotId]),
        joinedConditionalIdentity([facts.portfolioContextId, facts.portfolioSnapshotId]),
        "portfolio_facts_unavailable", "portfolio_facts_changed"
    )
    compare(
        "risk_impact", scenario?.riskImpact.impactId, facts.riskImpactId,
        "risk_facts_unavailable", "risk_facts_changed"
    )
    let today = String(evaluatedAt.prefix(10))
    if today >= judgment.observationWindow.startsOn && today <= judgment.observationWindow.endsOn {
        for condition in judgment.portfolioObservationConditions {
            let value: Double? = switch condition.metric {
            case .scenarioCandidateWeight: facts.scenarioCandidateWeight
            case .scenarioLargestPositionWeight: facts.scenarioLargestPositionWeight
            case .scenarioHhi: facts.scenarioHhi
            }
            let threshold = "\(condition.comparison.rawValue):\(condition.threshold)"
            if value == nil {
                add(
                    "portfolio_observation_unavailable", condition.metric.rawValue, threshold, nil,
                    "\(condition.metric.rawValue) is unavailable for the user-defined review threshold; no direction or workflow change is generated."
                )
            } else if condition.comparison == .atOrAbove ? value! >= condition.threshold : value! <= condition.threshold {
                add(
                    "portfolio_observation_met", condition.metric.rawValue, threshold, String(value!),
                    "\(condition.metric.rawValue) met the user-defined human-review threshold; it is not a target position, recommendation, or trade direction."
                )
            }
        }
    }
    if today >= judgment.reviewOn {
        add(
            "review_date_due", "review_on", judgment.reviewOn, today,
            "The user-defined review date is due; the saved judgment remains unchanged until human review."
        )
    }
    if today >= judgment.observationWindow.endsOn {
        add(
            "observation_window_ended", "observation_window_ends_on", judgment.observationWindow.endsOn, today,
            "The user-defined observation window ended; the saved judgment remains unchanged until human review."
        )
    }
    return .init(reasons: reasons, changes: changes)
}

private func joinedConditionalIdentity(_ values: [String?]) -> String? {
    values.contains(where: { $0?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false })
        ? nil
        : values.compactMap { $0 }.joined(separator: "|")
}

private func validateConditionalStrings(_ values: [String], label: String, errors: inout [String]) {
    if values.isEmpty || values.count > 20 || Set(values).count != values.count
        || values.contains(where: { $0.isEmpty || $0 != $0.trimmingCharacters(in: .whitespacesAndNewlines) || $0.count > 1_000 }) {
        errors.append("conditional \(label) must contain bounded unique trimmed text")
    }
}

private func isCalendarDate(_ value: String) -> Bool {
    guard value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return false }
    let parts = value.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return false }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let components = DateComponents(calendar: calendar, timeZone: calendar.timeZone, year: parts[0], month: parts[1], day: parts[2])
    guard let date = calendar.date(from: components) else { return false }
    let roundTrip = calendar.dateComponents([.year, .month, .day], from: date)
    return roundTrip.year == parts[0] && roundTrip.month == parts[1] && roundTrip.day == parts[2]
}

private extension KeyedDecodingContainer {
    func decodeRequiredConditionalNullable<T: Decodable>(
        _ type: T.Type,
        forKey key: Key
    ) throws -> T? {
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

func annualConditionalCalendarDate(
    _ value: Date,
    timeZone: TimeZone = .current
) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let components = calendar.dateComponents([.year, .month, .day], from: value)
    guard let year = components.year, let month = components.month, let day = components.day else {
        return ""
    }
    return String(format: "%04d-%02d-%02d", year, month, day)
}
