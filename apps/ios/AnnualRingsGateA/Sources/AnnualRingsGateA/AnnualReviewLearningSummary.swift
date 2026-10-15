import Foundation

public struct AnnualReviewLearningSummaryCounts: Codable, Equatable, Sendable {
    public let eligibleReviews: Int
    public let capturedLearningRecords: Int
    public let notCapturedLearningRecords: Int
}

public struct AnnualReviewLearningOutcomeCounts: Codable, Equatable, Sendable {
    public let thesisConfirmed: Int
    public let thesisWeakened: Int
    public let thesisInvalidated: Int
    public let insufficientEvidence: Int

    private enum CodingKeys: String, CodingKey {
        case thesisConfirmed = "thesis_confirmed"
        case thesisWeakened = "thesis_weakened"
        case thesisInvalidated = "thesis_invalidated"
        case insufficientEvidence = "insufficient_evidence"
    }
}

public struct AnnualReviewLearningConfidenceOutcomeRow: Codable, Equatable, Sendable {
    public let confidence: String
    public let total: Int
    public let outcomes: AnnualReviewLearningOutcomeCounts
    public let reviewIds: [String]
}

public struct AnnualReviewLearningRepeatedLesson: Codable, Equatable, Sendable {
    public let processLesson: String
    public let count: Int
    public let reviewIds: [String]
}

public struct AnnualReviewLearningQuantSampleLimitation: Codable, Equatable, Sendable {
    public let sourceClassification: String
    public let finalTestPolicy: String
    public let boundaryLimitation: String
    public let diagnosticStatus: String
    public let diagnosticLimitation: String
    public let decisionCheckIds: [String]
}

public struct AnnualReviewLearningSummarySafety: Codable, Equatable, Sendable {
    public let personalActorOnly: Bool
    public let descriptiveOnly: Bool
    public let infersCorrectness: Bool
    public let usesProfitLoss: Bool
    public let comparesUsers: Bool
    public let score: Bool
    public let recommendation: Bool
    public let ranking: Bool
    public let targetPrice: Bool
    public let targetPosition: Bool
    public let tradeDirection: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let callsBroker: Bool
}

public struct AnnualReviewLearningSummary: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-17.annual-review-learning-summary.v1"
    public static let minimumRequired = 5

    public let schemaVersion: String
    public let availability: String
    public let generatedAt: String
    public let minimumSampleSize: Int
    public let counts: AnnualReviewLearningSummaryCounts
    public let confidenceOutcomes: [AnnualReviewLearningConfidenceOutcomeRow]
    public let repeatedProcessLessons: [AnnualReviewLearningRepeatedLesson]
    public let quantSampleLimitations: [AnnualReviewLearningQuantSampleLimitation]
    public let limitation: String
    public let safety: AnnualReviewLearningSummarySafety

    public func validate(checks: [RecordedDecisionCheckReviewState]) throws {
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionV1 || !isStrictUtcDateTime(generatedAt)
            || minimumSampleSize != Self.minimumRequired {
            errors.append("review learning summary schema, time, or minimum sample is invalid")
        }
        if limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("review learning summary limitation is required")
        }
        if safety != Self.safeBoundary {
            errors.append("review learning summary safety must remain personal, descriptive, non-scoring, and non-trading")
        }
        let expected = Self.derive(checks: checks, generatedAt: generatedAt)
        if self != expected {
            errors.append("review learning summary must derive exactly from actor-scoped immutable review history")
        }
        if !errors.isEmpty { throw AnnualReviewLearningValidationError.invalid(errors) }
    }

    static func derive(
        checks: [RecordedDecisionCheckReviewState],
        generatedAt: String
    ) -> AnnualReviewLearningSummary {
        let eligible = checks.flatMap { check -> [LearningRecord] in
            guard let conditional = check.conditionalDecision,
                  conditional.availability == "preserved",
                  let confidence = conditional.judgment?.confidence else { return [] }
            return check.reviews.map { review in
                LearningRecord(check: check, review: review, confidence: confidence.rawValue)
            }
        }
        let captured = eligible.filter { $0.review.reviewLearning.availability == "preserved" && $0.review.reviewLearning.snapshot != nil }
        let ready = captured.count >= Self.minimumRequired
        let availability = captured.isEmpty ? "learning_not_captured" : ready ? "ready" : "insufficient_sample"
        return Self(
            schemaVersion: Self.schemaVersionV1,
            availability: availability,
            generatedAt: generatedAt,
            minimumSampleSize: Self.minimumRequired,
            counts: .init(
                eligibleReviews: eligible.count,
                capturedLearningRecords: captured.count,
                notCapturedLearningRecords: eligible.count - captured.count
            ),
            confidenceOutcomes: ready ? confidenceRows(captured) : [],
            repeatedProcessLessons: ready ? repeatedLessons(captured) : [],
            quantSampleLimitations: ready ? quantLimitations(captured) : [],
            limitation: ready
                ? "This personal descriptive summary separates frozen confidence, later human review outcomes, exact repeated process lessons, and frozen quant sample limits. It does not infer correctness, attribute profit or loss, score, compare users, recommend, rank, size, direct, or execute an investment decision."
                : captured.isEmpty
                    ? "No captured actor-scoped review-learning records are available; historical gaps are not reconstructed from current facts."
                    : "Only \(captured.count) captured actor-scoped learning records are available; at least \(Self.minimumRequired) are required before descriptive aggregates are shown.",
            safety: safeBoundary
        )
    }

    private static let safeBoundary = AnnualReviewLearningSummarySafety(
        personalActorOnly: true,
        descriptiveOnly: true,
        infersCorrectness: false,
        usesProfitLoss: false,
        comparesUsers: false,
        score: false,
        recommendation: false,
        ranking: false,
        targetPrice: false,
        targetPosition: false,
        tradeDirection: false,
        createsOrder: false,
        createsTrade: false,
        callsBroker: false
    )

    private struct LearningRecord {
        let check: RecordedDecisionCheckReviewState
        let review: PostDecisionReviewData
        let confidence: String
    }

    private static func confidenceRows(_ records: [LearningRecord]) -> [AnnualReviewLearningConfidenceOutcomeRow] {
        ["low", "medium", "high"].map { confidence in
            let matches = records.filter { $0.confidence == confidence }
            return .init(
                confidence: confidence,
                total: matches.count,
                outcomes: .init(
                    thesisConfirmed: matches.filter { $0.review.outcome == .thesisConfirmed }.count,
                    thesisWeakened: matches.filter { $0.review.outcome == .thesisWeakened }.count,
                    thesisInvalidated: matches.filter { $0.review.outcome == .thesisInvalidated }.count,
                    insufficientEvidence: matches.filter { $0.review.outcome == .insufficientEvidence }.count
                ),
                reviewIds: matches.map { $0.review.id }
            )
        }
    }

    private static func repeatedLessons(_ records: [LearningRecord]) -> [AnnualReviewLearningRepeatedLesson] {
        let grouped = Dictionary(grouping: records) { $0.review.reviewLearning.snapshot!.processLesson }
        return grouped.compactMap { lesson, matches in
            matches.count >= 2
                ? .init(processLesson: lesson, count: matches.count, reviewIds: matches.map { $0.review.id })
                : nil
        }.sorted { left, right in
            left.count != right.count ? left.count > right.count : left.processLesson < right.processLesson
        }
    }

    private static func quantLimitations(_ records: [LearningRecord]) -> [AnnualReviewLearningQuantSampleLimitation] {
        var results: [AnnualReviewLearningQuantSampleLimitation] = []
        for record in records {
            let quant = record.check.conditionalDecision?.preview?.data?.valuationQuant.data?.quant
            let boundary = quant?.evidence.sampleBoundary
            let diagnostic = quant?.diagnostics.sampleSize
            let values = (
                boundary?.sourceClassification ?? "unavailable",
                boundary?.finalTestPolicy ?? "unavailable",
                boundary?.limitation ?? "Frozen quant sample boundary was not captured and is not reconstructed.",
                diagnostic?.status ?? "not_captured",
                diagnostic?.limitation ?? "Frozen quant sample-size diagnostic was not captured and is not reconstructed."
            )
            if let index = results.firstIndex(where: {
                $0.sourceClassification == values.0 && $0.finalTestPolicy == values.1
                    && $0.boundaryLimitation == values.2 && $0.diagnosticStatus == values.3
                    && $0.diagnosticLimitation == values.4
            }) {
                if !results[index].decisionCheckIds.contains(record.check.id) {
                    let prior = results[index]
                    results[index] = .init(
                        sourceClassification: prior.sourceClassification,
                        finalTestPolicy: prior.finalTestPolicy,
                        boundaryLimitation: prior.boundaryLimitation,
                        diagnosticStatus: prior.diagnosticStatus,
                        diagnosticLimitation: prior.diagnosticLimitation,
                        decisionCheckIds: prior.decisionCheckIds + [record.check.id]
                    )
                }
            } else {
                results.append(.init(
                    sourceClassification: values.0,
                    finalTestPolicy: values.1,
                    boundaryLimitation: values.2,
                    diagnosticStatus: values.3,
                    diagnosticLimitation: values.4,
                    decisionCheckIds: [record.check.id]
                ))
            }
        }
        return results
    }
}
