import Foundation

public enum TodayReviewDueStatus: String, Codable, Equatable, Sendable {
    case available
    case empty
    case unavailable
}

public enum TodayReviewDueState: String, Codable, Equatable, Sendable {
    case new
    case resolved
}

public struct TodayReviewDueSafety: Codable, Equatable, Sendable {
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let mutatesCash: Bool
    public let writesFee: Bool
    public let mutatesPosition: Bool
    public let callsBroker: Bool

    public static let noSideEffects = TodayReviewDueSafety(
        createsOrder: false,
        createsTrade: false,
        mutatesCash: false,
        writesFee: false,
        mutatesPosition: false,
        callsBroker: false
    )
}

public struct TodayReviewDueEvent: Codable, Equatable, Identifiable, Sendable {
    public struct Priority: Codable, Equatable, Sendable {
        public let severity: String
        public let dueAt: String
    }

    public struct StateActor: Codable, Equatable, Sendable {
        public let actorType: String
        public let actorId: String
    }

    public struct Bindings: Codable, Equatable, Sendable {
        public let decisionCheckId: String
        public let reviewId: String?
    }

    public struct HumanDecision: Codable, Equatable, Sendable {
        public let actionIntent: String
        public let humanCheckResult: String
        public let userFinalDecision: String?
        public let reviewDueOn: String?
        public let formalDecision: FormalDecisionState?
    }

    public struct ResearchReport: Codable, Equatable, Sendable {
        public let availability: String
        public let binding: ResearchReportDecisionBinding?
        public let investmentThesis: String
        public let invalidationConditions: [String]
        public let nextValidationQuestion: String
        public let limitation: String
    }

    public let id: String
    public let type: String
    public let subject: String
    public let sourceEventId: String
    public let effectiveAt: String
    public let priority: Priority
    public let state: TodayReviewDueState
    public let stateChangedAt: String
    public let stateActor: StateActor
    public let stateReason: String
    public let bindings: Bindings?
    public let humanDecision: HumanDecision?
    public let researchReport: ResearchReport?
    public let reportBinding: ResearchReportDecisionBinding?
}

public struct TodayReviewDueEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let status: TodayReviewDueStatus
    public let requestedSymbol: String
    public let metadata: FactMetadata
    public let event: TodayReviewDueEvent?
    public let advisoryOnly: Bool
    public let safety: TodayReviewDueSafety
    public let message: String

    public static func unavailable(_ symbol: String, message: String) -> Self {
        TodayReviewDueEnvelope(
            schemaVersion: "2026-07-30.s1i-adopted-report-daily-tracking.v1",
            status: .unavailable,
            requestedSymbol: symbol,
            metadata: FactMetadata(
                source: "today_review_due:unavailable",
                asOf: nil,
                fetchedAt: nil,
                freshness: "unavailable",
                provenance: "unavailable",
                authority: "unavailable",
                stale: false,
                missing: false,
                conflict: false,
                fixture: false,
                correctionOf: nil,
                replaces: nil,
                message: "Today REVIEW_DUE facts are unavailable; old facts were cleared."
            ),
            event: nil,
            advisoryOnly: true,
            safety: .noSideEffects,
            message: message
        )
    }

    public func validateForDisplay(expectedSymbol: String, now: Date = Date()) throws {
        var errors: [String] = []
        if schemaVersion != "2026-07-30.s1i-adopted-report-daily-tracking.v1" {
            errors.append("Today REVIEW_DUE schema version is invalid")
        }
        if requestedSymbol != expectedSymbol || !requestedSymbol.isCanonicalHongKongSecurity {
            errors.append("Today REVIEW_DUE symbol is not exact canonical HK identity")
        }
        metadata.validateForDisplay(label: "Today REVIEW_DUE", errors: &errors)
        if advisoryOnly == false || safety != .noSideEffects {
            errors.append("Today REVIEW_DUE safety boundary is invalid")
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("Today REVIEW_DUE message is required")
        }
        switch status {
        case .available:
            validateAvailable(now: now, errors: &errors)
        case .empty:
            if event != nil || metadata.source != Self.source
                || metadata.freshness != "missing"
                || !["real", "fixture"].contains(metadata.provenance)
                || (metadata.provenance == "fixture") != metadata.fixture
                || metadata.authority != "decision_context" || !metadata.missing
                || metadata.stale || metadata.conflict
                || metadata.asOf != nil {
                errors.append("empty Today REVIEW_DUE must expose no event and explicit missing metadata")
            }
        case .unavailable:
            if event != nil || metadata.source != "today_review_due:unavailable"
                || metadata.freshness != "unavailable"
                || metadata.provenance != "unavailable" || metadata.authority != "unavailable"
                || metadata.fixture || metadata.stale || metadata.missing || metadata.conflict
                || metadata.asOf != nil || metadata.fetchedAt != nil {
                errors.append("unavailable Today REVIEW_DUE must be fact-free")
            }
        }
        if !errors.isEmpty {
            throw TodayReviewDueValidationError.invalid(errors)
        }
    }

    private func validateAvailable(now: Date, errors: inout [String]) {
        guard let event else {
            errors.append("available Today REVIEW_DUE requires an event")
            return
        }
        let expectedAuthority = event.type == "FORMAL_DECISION_DUE"
            ? "research_evidence" : "decision_context"
        if metadata.source != Self.source || metadata.freshness != "fresh"
            || !["real", "fixture"].contains(metadata.provenance)
            || metadata.authority != expectedAuthority || metadata.missing
            || metadata.stale || metadata.conflict
            || (metadata.provenance == "fixture") != metadata.fixture {
            errors.append("available Today REVIEW_DUE metadata is invalid")
        }
        if !["REVIEW_DUE", "DAILY_TRACKING", "FORMAL_DECISION_DUE"].contains(event.type)
            || event.subject != requestedSymbol || !event.sourceEventId.isPositiveInteger {
            errors.append("Today REVIEW_DUE event identity is invalid")
        }
        if event.type == "FORMAL_DECISION_DUE" {
            validateFormalDecisionDue(event, errors: &errors)
        } else {
            validateReviewDue(event, errors: &errors)
        }
        let expectedID = "\(event.type)|\(event.subject)|\(event.sourceEventId)|\(event.effectiveAt)"
        if event.id != expectedID {
            errors.append("Today REVIEW_DUE deterministic id is invalid")
        }
        if event.priority.severity != "attention" || event.priority.dueAt != event.effectiveAt {
            errors.append("Today REVIEW_DUE priority must be immediate and explicit")
        }
        if !["user", "system"].contains(event.stateActor.actorType)
            || event.stateActor.actorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("Today REVIEW_DUE state actor is invalid")
        }
        if event.type != "FORMAL_DECISION_DUE", event.state == .new {
            let expectedReason = event.type == "DAILY_TRACKING"
                ? "adopted_report_requires_daily_tracking"
                : event.humanDecision?.reviewDueOn != nil
                    ? "manual_review_calendar_due" : "decision_check_created_without_valid_review"
            if event.bindings?.reviewId != nil || event.stateReason != expectedReason {
                errors.append("new Today action cannot bind a review and must preserve its exact reason")
            }
        } else if event.type != "FORMAL_DECISION_DUE",
                  event.bindings?.reviewId?.isPositiveInteger != true
                    || !Self.resolvedReasons.contains(event.stateReason) {
            errors.append("resolved Today action must bind a valid review outcome")
        }
        guard let effectiveAt = event.effectiveAt.strictInstant,
              let stateChangedAt = event.stateChangedAt.strictInstant,
              let fetchedAtText = metadata.fetchedAt,
              let fetchedAt = fetchedAtText.strictInstant else {
            errors.append("Today REVIEW_DUE chronology is malformed")
            return
        }
        if stateChangedAt < effectiveAt || fetchedAt < stateChangedAt
            || fetchedAt > now || metadata.asOf != event.stateChangedAt {
            errors.append("Today REVIEW_DUE chronology is invalid")
        }
    }

    private func validateReviewDue(_ event: TodayReviewDueEvent, errors: inout [String]) {
        guard let bindings = event.bindings,
              let humanDecision = event.humanDecision,
              let researchReport = event.researchReport,
              event.reportBinding == nil else {
            errors.append("REVIEW_DUE event shape is invalid")
            return
        }
        if bindings.decisionCheckId != event.sourceEventId {
            errors.append("Today REVIEW_DUE decision binding is invalid")
        }
        if DecisionActionIntent(rawValue: humanDecision.actionIntent) == nil
            || !["ready_to_consider", "blocked", "needs_more_evidence"].contains(humanDecision.humanCheckResult)
            || humanDecision.userFinalDecision?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true {
            errors.append("Today REVIEW_DUE human decision is invalid")
        }
        if let reviewDueOn = humanDecision.reviewDueOn {
            if event.type != "REVIEW_DUE" || !isValidManualReviewDueOn(reviewDueOn)
                || ISO8601DateFormatter().date(from: "\(reviewDueOn)T00:00:00+08:00") != event.effectiveAt.strictInstant {
                errors.append("scheduled REVIEW_DUE must bind the exact Hong Kong calendar start")
            }
        }
        if let formalDecision = humanDecision.formalDecision {
            do {
                try formalDecision.validate(
                    reportBinding: researchReport.binding,
                    actionIntent: humanDecision.actionIntent,
                    label: "Today REVIEW_DUE formalDecision"
                )
            } catch {
                errors.append("Today REVIEW_DUE formal decision is invalid")
            }
        }
        validateResearchReport(researchReport, subject: event.subject,
            effectiveAt: event.effectiveAt, stateActor: event.stateActor, errors: &errors)
        if event.type == "DAILY_TRACKING", researchReport.availability != "preserved" {
            errors.append("DAILY_TRACKING requires an exact preserved research report")
        }
        if event.type == "REVIEW_DUE", researchReport.availability == "preserved" {
            errors.append("a preserved adopted report must project as DAILY_TRACKING")
        }
    }

    private func validateFormalDecisionDue(_ event: TodayReviewDueEvent, errors: inout [String]) {
        guard event.bindings == nil, event.humanDecision == nil, event.researchReport == nil,
              let binding = event.reportBinding else {
            errors.append("FORMAL_DECISION_DUE event shape is invalid")
            return
        }
        do { try binding.validate(expectedSymbol: event.subject) }
        catch { errors.append("FORMAL_DECISION_DUE report binding is invalid") }
        if event.state != .new || event.stateReason != "confirmed_report_not_adopted"
            || event.stateActor.actorType != "user"
            || binding.reportDecisionId != event.sourceEventId
            || binding.reportDecisionActorId != event.stateActor.actorId
            || binding.decidedAt != event.effectiveAt
            || event.stateChangedAt != event.effectiveAt {
            errors.append("FORMAL_DECISION_DUE exact identity is invalid")
        }
    }

    private func validateResearchReport(
        _ report: TodayReviewDueEvent.ResearchReport,
        subject: String,
        effectiveAt: String,
        stateActor: TodayReviewDueEvent.StateActor,
        errors: inout [String]
    ) {
        if report.limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("Today REVIEW_DUE report limitation is required")
        }
        if report.availability == "not_captured" {
            if report.binding != nil || report.investmentThesis != "UNKNOWN"
                || !report.invalidationConditions.isEmpty || report.nextValidationQuestion != "UNKNOWN" {
                errors.append("not_captured Today report must stay explicit UNKNOWN")
            }
            return
        }
        guard report.availability == "preserved", let binding = report.binding else {
            errors.append("Today REVIEW_DUE report availability is invalid")
            return
        }
        do { try binding.validate(expectedSymbol: subject) }
        catch { errors.append("Today REVIEW_DUE report binding is invalid") }
        guard let bindingDecidedAt = binding.decidedAt.strictInstant,
              let eventEffectiveAt = effectiveAt.strictInstant else {
            errors.append("Today REVIEW_DUE report binding chronology is malformed")
            return
        }
        if binding.reportDecisionActorType != stateActor.actorType
            || binding.reportDecisionActorId != stateActor.actorId {
            errors.append("Today REVIEW_DUE report binding actor is invalid")
        }
        if bindingDecidedAt > eventEffectiveAt {
            errors.append("Today REVIEW_DUE report binding is later than the formal decision")
        }
        if report.investmentThesis.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || report.investmentThesis == "UNKNOWN"
            || report.invalidationConditions.isEmpty
            || report.invalidationConditions.contains(where: {
                $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            })
            || report.nextValidationQuestion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("Today REVIEW_DUE preserved report facts are invalid")
        }
    }

    private static let source =
        "today_action:confirmed_reports_decision_checks_reviews_audit_events"
    private static let resolvedReasons = [
        "post_decision_review:thesis_confirmed",
        "post_decision_review:thesis_weakened",
        "post_decision_review:thesis_invalidated",
        "post_decision_review:insufficient_evidence"
    ]
}

public enum TodayReviewDueValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

extension String {
    fileprivate var isCanonicalHongKongSecurity: Bool {
        range(of: #"^HK\.\d{5}$"#, options: .regularExpression) != nil
    }

    fileprivate var isPositiveInteger: Bool {
        range(of: #"^[1-9]\d*$"#, options: .regularExpression) != nil
    }

    fileprivate var strictInstant: Date? {
        guard factMetadataIsRFC3339DateTime(self) else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: self) ?? ISO8601DateFormatter().date(from: self)
    }
}
