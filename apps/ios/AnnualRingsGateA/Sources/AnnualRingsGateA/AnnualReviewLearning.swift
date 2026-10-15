import Foundation

public enum AnnualReviewLearningValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct AnnualReviewLearningRequest: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-17.annual-review-learning.v1"

    public let schemaVersion: String
    public let kind: String?
    public let decisionCheckId: String
    public let membershipId: String?
    public let membershipVersion: Int?
    public let decisionSnapshotId: String?
    public let conditionalPreviewId: String?
    public let judgmentCorrection: String
    public let processLesson: String
    public let nextResearchQuestion: String?

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, kind, decisionCheckId, membershipId, membershipVersion
        case decisionSnapshotId, conditionalPreviewId, judgmentCorrection, processLesson, nextResearchQuestion
    }

    public init(
        decisionCheckId: String,
        decisionSnapshotId: String,
        conditionalPreviewId: String,
        judgmentCorrection: String,
        processLesson: String,
        nextResearchQuestion: String?
    ) {
        schemaVersion = Self.schemaVersionV1
        kind = nil
        self.decisionCheckId = decisionCheckId
        membershipId = nil
        membershipVersion = nil
        self.decisionSnapshotId = decisionSnapshotId
        self.conditionalPreviewId = conditionalPreviewId
        self.judgmentCorrection = judgmentCorrection
        self.processLesson = processLesson
        self.nextResearchQuestion = nextResearchQuestion
    }

    public init(
        manualDecisionCheckId: String,
        membershipId: String,
        membershipVersion: Int,
        judgmentCorrection: String,
        processLesson: String,
        nextResearchQuestion: String?
    ) {
        schemaVersion = Self.schemaVersionV1
        kind = "ordinary_manual"
        decisionCheckId = manualDecisionCheckId
        self.membershipId = membershipId
        self.membershipVersion = membershipVersion
        decisionSnapshotId = nil
        conditionalPreviewId = nil
        self.judgmentCorrection = judgmentCorrection
        self.processLesson = processLesson
        self.nextResearchQuestion = nextResearchQuestion
    }

    public func validate() throws {
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionV1 {
            errors.append("review learning schema version is invalid")
        }
        if decisionCheckId.range(of: "^[1-9][0-9]*$", options: .regularExpression) == nil {
            errors.append("review learning decision check id is invalid")
        }
        if kind == "ordinary_manual" {
            if membershipId?.range(of: "^[1-9][0-9]*$", options: .regularExpression) == nil
                || (membershipVersion ?? 0) < 1 || decisionSnapshotId != nil || conditionalPreviewId != nil {
                errors.append("manual review learning membership or branch identity is invalid")
            }
        } else if kind == nil && membershipId == nil && membershipVersion == nil {
            validateAnnualReviewLearningContentId(decisionSnapshotId ?? "", prefix: "decision-snapshot", label: "decision snapshot", errors: &errors)
            validateAnnualReviewLearningContentId(conditionalPreviewId ?? "", prefix: "annual-conditional-preview", label: "conditional preview", errors: &errors)
        } else {
            errors.append("review learning branch identity is invalid")
        }
        validateAnnualReviewLearningText(judgmentCorrection, label: "judgment correction", required: true, errors: &errors)
        validateAnnualReviewLearningText(processLesson, label: "process lesson", required: true, errors: &errors)
        validateAnnualReviewLearningText(nextResearchQuestion, label: "next research question", required: false, errors: &errors)
        if kind == "ordinary_manual" && nextResearchQuestion == "" {
            errors.append("manual review learning must use null when no next research question was saved")
        }
        if !errors.isEmpty { throw AnnualReviewLearningValidationError.invalid(errors) }
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(schemaVersion, forKey: .schemaVersion)
        try values.encode(decisionCheckId, forKey: .decisionCheckId)
        if kind == "ordinary_manual" {
            try values.encode(kind, forKey: .kind)
            try values.encode(membershipId, forKey: .membershipId)
            try values.encode(membershipVersion, forKey: .membershipVersion)
        } else {
            try values.encode(decisionSnapshotId, forKey: .decisionSnapshotId)
            try values.encode(conditionalPreviewId, forKey: .conditionalPreviewId)
        }
        try values.encode(judgmentCorrection, forKey: .judgmentCorrection)
        try values.encode(processLesson, forKey: .processLesson)
        if let nextResearchQuestion {
            try values.encode(nextResearchQuestion, forKey: .nextResearchQuestion)
        } else {
            try values.encodeNil(forKey: .nextResearchQuestion)
        }
    }
}

public struct AnnualReviewLearningSnapshot: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let kind: String?
    public let decisionCheckId: String
    public let membershipId: String?
    public let membershipVersion: Int?
    public let decisionSnapshotId: String?
    public let conditionalPreviewId: String?
    public let judgmentCorrection: String
    public let processLesson: String
    public let nextResearchQuestion: String?
    public let reviewedFactsAt: String?
    public let monitor: AnnualConditionalDecisionMonitor?

    public init(
        schemaVersion: String,
        decisionCheckId: String,
        decisionSnapshotId: String,
        conditionalPreviewId: String,
        judgmentCorrection: String,
        processLesson: String,
        nextResearchQuestion: String?,
        reviewedFactsAt: String,
        monitor: AnnualConditionalDecisionMonitor
    ) {
        self.schemaVersion = schemaVersion
        kind = nil
        self.decisionCheckId = decisionCheckId
        membershipId = nil
        membershipVersion = nil
        self.decisionSnapshotId = decisionSnapshotId
        self.conditionalPreviewId = conditionalPreviewId
        self.judgmentCorrection = judgmentCorrection
        self.processLesson = processLesson
        self.nextResearchQuestion = nextResearchQuestion
        self.reviewedFactsAt = reviewedFactsAt
        self.monitor = monitor
    }

    public func request() -> AnnualReviewLearningRequest {
        if kind == "ordinary_manual" {
            return AnnualReviewLearningRequest(
                manualDecisionCheckId: decisionCheckId,
                membershipId: membershipId ?? "",
                membershipVersion: membershipVersion ?? 0,
                judgmentCorrection: judgmentCorrection,
                processLesson: processLesson,
                nextResearchQuestion: nextResearchQuestion
            )
        }
        return AnnualReviewLearningRequest(
            decisionCheckId: decisionCheckId,
            decisionSnapshotId: decisionSnapshotId ?? "",
            conditionalPreviewId: conditionalPreviewId ?? "",
            judgmentCorrection: judgmentCorrection,
            processLesson: processLesson,
            nextResearchQuestion: nextResearchQuestion
        )
    }
}

public struct AnnualReviewLearningState: Codable, Equatable, Sendable {
    public let availability: String
    public let snapshot: AnnualReviewLearningSnapshot?
    public let limitation: String

    public static let notCaptured = Self(
        availability: "review_learning_not_captured",
        snapshot: nil,
        limitation: "This historical review-learning snapshot was not captured and is not reconstructed from current facts."
    )

    public func validate(
        checkId: String,
        decisionSnapshot: DecisionSnapshotState,
        conditionalDecision: AnnualConditionalDecisionState
    ) throws {
        var errors: [String] = []
        if limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("review learning limitation is required")
        }
        if availability == "review_learning_not_captured" {
            if snapshot != nil || !limitation.contains("not reconstructed") {
                errors.append("not-captured review learning must clear facts and disclose no reconstruction")
            }
        } else if availability == "preserved" || availability == "ordinary_manual_preserved" {
            validatePreserved(
                checkId: checkId,
                decisionSnapshot: decisionSnapshot,
                conditionalDecision: conditionalDecision,
                errors: &errors
            )
        } else {
            errors.append("review learning availability is invalid")
        }
        if !errors.isEmpty { throw AnnualReviewLearningValidationError.invalid(errors) }
    }

    public func matches(request: AnnualReviewLearningRequest?) -> Bool {
        guard let request else { return availability == "review_learning_not_captured" }
        return availability == (request.kind == "ordinary_manual" ? "ordinary_manual_preserved" : "preserved")
            && snapshot?.request() == request
    }

    private func validatePreserved(
        checkId: String,
        decisionSnapshot: DecisionSnapshotState,
        conditionalDecision: AnnualConditionalDecisionState,
        errors: inout [String]
    ) {
        guard let snapshot else {
            errors.append("preserved review learning requires a snapshot")
            return
        }
        do { try snapshot.request().validate() }
        catch { errors.append("review learning request fields are invalid") }
        if availability == "ordinary_manual_preserved" {
            if snapshot.kind != "ordinary_manual" || snapshot.decisionCheckId != checkId
                || snapshot.reviewedFactsAt != nil || snapshot.monitor != nil {
                errors.append("manual review learning must bind only the saved check and member")
            }
            return
        }
        if snapshot.kind != nil { errors.append("conditional review learning branch is invalid") }
        if snapshot.schemaVersion != AnnualReviewLearningRequest.schemaVersionV1
            || snapshot.decisionCheckId != checkId {
            errors.append("review learning must bind the recorded check")
        }
        if !isStrictUtcDateTime(snapshot.reviewedFactsAt ?? "")
            || snapshot.reviewedFactsAt != snapshot.monitor?.evaluatedAt {
            errors.append("review learning factual timestamp is invalid")
        }
        let decisionSnapshotId = decisionSnapshot.availability == .preserved
            ? decisionSnapshot.snapshot?.snapshotId
            : nil
        let conditionalPreviewId = conditionalDecision.availability == "preserved"
            ? conditionalDecision.preview?.previewId
            : nil
        if decisionSnapshotId == nil || snapshot.decisionSnapshotId != decisionSnapshotId {
            errors.append("review learning must bind the immutable decision snapshot")
        }
        if conditionalPreviewId == nil || snapshot.conditionalPreviewId != conditionalPreviewId {
            errors.append("review learning must bind the conditional preview")
        }
        guard let preview = conditionalDecision.preview,
              let judgment = conditionalDecision.judgment else {
            errors.append("review learning requires a preserved conditional decision")
            return
        }
        do {
            try AnnualConditionalDecisionState(
                availability: "preserved",
                preview: preview,
                judgment: judgment,
                monitor: snapshot.monitor,
                limitation: conditionalDecision.limitation
            ).validate()
        } catch {
            errors.append("review learning monitor does not recompute from frozen judgment and recorded facts")
        }
    }
}

private func validateAnnualReviewLearningContentId(
    _ value: String,
    prefix: String,
    label: String,
    errors: inout [String]
) {
    let pattern = "^\(NSRegularExpression.escapedPattern(for: prefix)):[a-f0-9]{64}$"
    if value.range(of: pattern, options: .regularExpression) == nil {
        errors.append("review learning \(label) id is invalid")
    }
}

private func validateAnnualReviewLearningText(
    _ value: String?,
    label: String,
    required: Bool,
    errors: inout [String]
) {
    guard let value else {
        if required { errors.append("review learning \(label) is required") }
        return
    }
    if value != value.trimmingCharacters(in: .whitespacesAndNewlines)
        || value.count > 4_000 || required && value.isEmpty {
        errors.append("review learning \(label) must be trimmed and bounded")
    }
}
