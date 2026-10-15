import Foundation

public struct TodayReviewNavigationTarget: Equatable, Hashable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let canonicalSymbol: String
    public let decisionCheckId: String
    public let reviewId: String?
    public let reportBinding: ResearchReportDecisionBinding?
    public let expectedReviewOutcome: DecisionReviewOutcome?

    public init(
        membershipId: String,
        membershipVersion: Int,
        canonicalSymbol: String,
        decisionCheckId: String,
        reviewId: String?,
        reportBinding: ResearchReportDecisionBinding? = nil,
        expectedReviewOutcome: DecisionReviewOutcome? = nil
    ) {
        self.membershipId = membershipId
        self.membershipVersion = membershipVersion
        self.canonicalSymbol = canonicalSymbol
        self.decisionCheckId = decisionCheckId
        self.reviewId = reviewId
        self.reportBinding = reportBinding
        self.expectedReviewOutcome = expectedReviewOutcome
    }

    public init?(
        event: TodayReviewDueEvent,
        membershipId: String,
        membershipVersion: Int
    ) {
        guard ["REVIEW_DUE", "DAILY_TRACKING"].contains(event.type),
              membershipId.isPositiveTodayIdentifier,
              membershipVersion > 0,
              let bindings = event.bindings,
              (event.state == .new && bindings.reviewId == nil)
                || (event.state == .resolved
                    && bindings.reviewId?.isPositiveTodayIdentifier == true) else {
            return nil
        }
        let reportBinding: ResearchReportDecisionBinding?
        if event.type == "DAILY_TRACKING" {
            guard event.researchReport?.availability == "preserved",
                  let binding = event.researchReport?.binding,
                  binding.membershipId == membershipId,
                  binding.membershipVersion == membershipVersion else { return nil }
            reportBinding = binding
        } else {
            guard event.researchReport?.availability != "preserved" else { return nil }
            reportBinding = nil
        }
        self.init(
            membershipId: membershipId,
            membershipVersion: membershipVersion,
            canonicalSymbol: event.subject,
            decisionCheckId: bindings.decisionCheckId,
            reviewId: bindings.reviewId,
            reportBinding: reportBinding,
            expectedReviewOutcome: event.dailyTrackingReconsiderationOutcome
        )
    }
}

public extension TodayReviewDueEvent {
    var dailyTrackingReconsiderationOutcome: DecisionReviewOutcome? {
        guard type == "DAILY_TRACKING", state == .resolved,
              bindings?.reviewId?.isPositiveTodayIdentifier == true,
              researchReport?.availability == "preserved",
              stateReason.hasPrefix("post_decision_review:"),
              let outcome = DecisionReviewOutcome(
                rawValue: String(stateReason.dropFirst("post_decision_review:".count))
              ),
              outcome == .thesisWeakened || outcome == .thesisInvalidated else {
            return nil
        }
        return outcome
    }
}

public struct TodayFormalDecisionNavigationTarget: Equatable, Hashable, Sendable {
    public let binding: ResearchReportDecisionBinding

    public init?(event: TodayReviewDueEvent) {
        guard event.type == "FORMAL_DECISION_DUE", event.state == .new,
              let binding = event.reportBinding,
              binding.symbol == event.subject,
              binding.reportDecisionId == event.sourceEventId,
              binding.decidedAt == event.effectiveAt else { return nil }
        self.binding = binding
    }
}

public enum TodayReviewNavigationDestination: Equatable, Sendable {
    case check(checkId: String)
    case review(reviewId: String)
}

public extension DecisionReviewHistoryEnvelope {
    func resolveTodayReviewNavigation(
        _ target: TodayReviewNavigationTarget
    ) -> TodayReviewNavigationDestination? {
        guard requestedSymbol == target.canonicalSymbol else { return nil }
        guard target.expectedReviewOutcome == nil || target.reportBinding != nil else { return nil }
        let checkMatches = checks.filter { $0.id == target.decisionCheckId }
        guard checkMatches.count == 1 else { return nil }
        if let reportBinding = target.reportBinding {
            guard checkMatches[0].researchReportDecision.availability == "preserved",
                  checkMatches[0].researchReportDecision.binding == reportBinding else {
                return nil
            }
        }
        guard let reviewId = target.reviewId else {
            guard target.reportBinding != nil || checkMatches[0].reviews.isEmpty else { return nil }
            return .check(checkId: target.decisionCheckId)
        }
        let reviewMatches = checks.flatMap(\.reviews).filter { $0.id == reviewId }
        guard reviewMatches.count == 1,
              reviewMatches[0].decisionCheckId == target.decisionCheckId,
              checkMatches[0].reviews.filter({ $0.id == reviewId }).count == 1,
              target.expectedReviewOutcome == nil
                || reviewMatches[0].outcome == target.expectedReviewOutcome else {
            return nil
        }
        return .review(reviewId: reviewId)
    }
}

public struct ResearchReviewQuestionHandoff: Equatable, Hashable, Sendable {
    /// The existing research-evidence-question bound; server, Web and iOS agree on 1...1000.
    public static let maximumQuestionLength = 1_000

    public let target: TodayReviewNavigationTarget
    public let reviewReviewedAt: String
    public let reviewOutcome: DecisionReviewOutcome
    /// Empty only for an ordinary manual review without a saved next question.
    public let question: String
    /// Preserved review-learning text the Owner may explicitly carry with the saved question.
    public let judgmentCorrection: String?
    public let processLesson: String?
    /// Owner selection for this handoff. Unchecked by default, so the question-only
    /// handoff remains the default and nothing else is ever carried implicitly.
    public var includesJudgmentCorrection = false
    public var includesProcessLesson = false

    public init?(
        membership: CandidateMembershipData,
        history: DecisionReviewHistoryEnvelope,
        reviewId: String
    ) {
        let reviewMatches = history.checks.flatMap(\.reviews).filter { $0.id == reviewId }
        guard membership.state != .archived,
              history.requestedSymbol == membership.symbol,
              reviewMatches.count == 1 else { return nil }
        let review = reviewMatches[0]
        let checkMatches = history.checks.filter { $0.id == review.decisionCheckId }
        guard checkMatches.count == 1 else { return nil }
        let check = checkMatches[0]
        guard check.reviews.filter({ $0.id == review.id }).count == 1,
              review.audit.actorType == "user",
              review.audit.actorId == membership.actorId,
              let snapshot = review.reviewLearning.snapshot,
              snapshot.decisionCheckId == check.id else { return nil }
        let question: String
        let reportBinding: ResearchReportDecisionBinding?
        if review.reviewLearning.availability == "ordinary_manual_preserved" {
            guard snapshot.kind == "ordinary_manual",
                  snapshot.membershipId == membership.id,
                  snapshot.membershipVersion == membership.version,
                  check.researchReportDecision.availability != "preserved",
                  check.conditionalDecision?.availability != "preserved" else { return nil }
            question = snapshot.nextResearchQuestion ?? ""
            reportBinding = nil
        } else {
            guard review.reviewLearning.availability == "preserved",
                  snapshot.kind == nil,
                  let savedQuestion = snapshot.nextResearchQuestion,
                  !savedQuestion.isEmpty,
                  check.researchReportDecision.availability == "preserved",
                  let binding = check.researchReportDecision.binding,
                  binding.reportDecisionActorType == "user",
                  binding.reportDecisionActorId == membership.actorId,
                  binding.membershipId == membership.id,
                  binding.membershipVersion == membership.version,
                  binding.symbol == membership.symbol,
                  snapshot.decisionSnapshotId == check.decisionSnapshot.snapshot?.snapshotId,
                  snapshot.conditionalPreviewId == check.conditionalDecision?.preview?.previewId else { return nil }
            question = savedQuestion
            reportBinding = binding
        }
        let target = TodayReviewNavigationTarget(
            membershipId: membership.id,
            membershipVersion: membership.version,
            canonicalSymbol: membership.symbol,
            decisionCheckId: check.id,
            reviewId: review.id,
            reportBinding: reportBinding,
            expectedReviewOutcome: reportBinding == nil ? nil : review.outcome
        )
        guard history.resolveTodayReviewNavigation(target) == .review(reviewId: review.id) else { return nil }
        // Keep the raw saved text: only the composed draft trims it, so the
        // re-resolve comparison below stays byte-identical to the snapshot.
        let judgmentCorrection = snapshot.judgmentCorrection
        let processLesson = snapshot.processLesson
        self.target = target
        reviewReviewedAt = review.reviewedAt
        reviewOutcome = review.outcome
        self.question = question
        self.judgmentCorrection =
            judgmentCorrection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : judgmentCorrection
        self.processLesson =
            processLesson.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : processLesson
    }

    public var canCarryJudgmentCorrection: Bool { judgmentCorrection != nil }
    public var canCarryProcessLesson: Bool { processLesson != nil }
    public var carriesJudgmentCorrection: Bool { includesJudgmentCorrection && canCarryJudgmentCorrection }
    public var carriesProcessLesson: Bool { includesProcessLesson && canCarryProcessLesson }
    public var carriesSelectedReviewLearning: Bool { carriesJudgmentCorrection || carriesProcessLesson }

    /// The saved question plus explicitly selected preserved review material.
    /// The saved-question path retains the Web client's wording and attribution.
    public var selectedQuestionDraft: String {
        selectedQuestionDraft(startingWith: question)
    }

    /// Manual preparation may supply a new question when the review saved none.
    public func selectedQuestionDraft(startingWith currentQuestion: String) -> String {
        var parts = [currentQuestion.trimmingCharacters(in: .whitespacesAndNewlines)].filter { !$0.isEmpty }
        if carriesJudgmentCorrection, let judgmentCorrection {
            parts.append(
                Self.carriedReviewLearningText(
                    label: "随问携带：判断修正（含遗漏反证）",
                    lesson: judgmentCorrection,
                    target: target
                )
            )
        }
        if carriesProcessLesson, let processLesson {
            parts.append(
                Self.carriedReviewLearningText(
                    label: "随问携带：流程教训",
                    lesson: processLesson,
                    target: target
                )
            )
        }
        return parts.joined(separator: "\n\n")
    }

    public var selectedQuestionDraftIsWithinQuestionLimit: Bool {
        selectedQuestionDraft.utf16.count <= Self.maximumQuestionLength
    }

    private static func carriedReviewLearningText(
        label: String,
        lesson: String,
        target: TodayReviewNavigationTarget
    ) -> String {
        let attribution = "复盘 \(target.reviewId ?? "UNKNOWN") · 检查 \(target.decisionCheckId)"
        return "[\(label) · \(attribution)]\n\(lesson.trimmingCharacters(in: .whitespacesAndNewlines))"
    }

    public func resolveQuestion(
        history: DecisionReviewHistoryEnvelope?,
        membership: CandidateMembershipData,
        workspace: FrozenResearchEvidenceWorkspace.DataPayload?
    ) -> String? {
        guard membership.state != .archived,
              membership.id == target.membershipId,
              membership.version == target.membershipVersion,
              membership.symbol == target.canonicalSymbol,
              let history,
              let reviewId = target.reviewId,
              history.resolveTodayReviewNavigation(target) == .review(reviewId: reviewId) else { return nil }
        let checkMatches = history.checks.filter { $0.id == target.decisionCheckId }
        let reviewMatches = history.checks.flatMap(\.reviews).filter { $0.id == reviewId }
        guard checkMatches.count == 1, reviewMatches.count == 1 else { return nil }
        let check = checkMatches[0]
        let review = reviewMatches[0]
        guard check.reviews.filter({ $0.id == reviewId }).count == 1,
              review.audit.actorType == "user",
              review.audit.actorId == membership.actorId,
              review.decisionCheckId == check.id,
              review.reviewedAt == reviewReviewedAt,
              review.outcome == reviewOutcome,
              let snapshot = review.reviewLearning.snapshot,
              snapshot.decisionCheckId == check.id else { return nil }
        if target.reportBinding == nil {
            guard review.reviewLearning.availability == "ordinary_manual_preserved",
                  snapshot.kind == "ordinary_manual",
                  snapshot.membershipId == membership.id,
                  snapshot.membershipVersion == membership.version,
                  check.researchReportDecision.availability != "preserved",
                  check.conditionalDecision?.availability != "preserved",
                  (snapshot.nextResearchQuestion ?? "") == question else { return nil }
            if carriesJudgmentCorrection && snapshot.judgmentCorrection != judgmentCorrection { return nil }
            if carriesProcessLesson && snapshot.processLesson != processLesson { return nil }
            return question.isEmpty ? "" : selectedQuestionDraft
        }
        guard target.reportBinding?.reportDecisionActorType == "user",
              target.reportBinding?.reportDecisionActorId == membership.actorId,
              let workspace,
              let report = workspace.latestReport,
              let pack = workspace.latestPack,
              workspace.reports.first?.id == report.id,
              workspace.target.membershipId == membership.id,
              workspace.target.membershipVersion == membership.version,
              workspace.target.membershipState == membership.state.rawValue,
              workspace.target.symbol == membership.symbol,
              report.isCurrentExact,
              report.evidencePackId == pack.id,
              report.payload.evidencePackBinding?.fingerprint == pack.packFingerprint,
              pack.membershipId == membership.id,
              pack.membershipVersion == membership.version,
              pack.symbol == membership.symbol,
              pack.currentness.status == "current" else { return nil }
        guard check.researchReportDecision.binding == target.reportBinding,
              review.outcome == target.expectedReviewOutcome,
              review.reviewLearning.availability == "preserved",
              snapshot.kind == nil,
              snapshot.decisionCheckId == check.id,
              snapshot.decisionSnapshotId == check.decisionSnapshot.snapshot?.snapshotId,
              snapshot.conditionalPreviewId == check.conditionalDecision?.preview?.previewId,
              snapshot.nextResearchQuestion == question else { return nil }
        // The bare saved question still has to match exactly; selected optional
        // material is only added afterwards, never compared against the draft text.
        if carriesJudgmentCorrection, snapshot.judgmentCorrection != judgmentCorrection { return nil }
        if carriesProcessLesson, snapshot.processLesson != processLesson { return nil }
        return selectedQuestionDraft
    }
}

private extension String {
    var isPositiveTodayIdentifier: Bool {
        range(of: #"^[1-9]\d*$"#, options: .regularExpression) != nil
    }
}
