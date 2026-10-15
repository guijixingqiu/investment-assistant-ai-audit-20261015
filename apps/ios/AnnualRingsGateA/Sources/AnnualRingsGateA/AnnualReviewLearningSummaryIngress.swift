import Foundation

func validateAnnualReviewLearningSummaryRawShape(_ value: Any) throws {
    guard let summary = value as? [String: Any] else {
        throw DecisionSnapshotValidationError.invalid(["learningSummary must be an object"])
    }
    var errors: [String] = []
    summaryExactKeys(summary, [
        "schemaVersion", "availability", "generatedAt", "minimumSampleSize", "counts",
        "confidenceOutcomes", "repeatedProcessLessons", "quantSampleLimitations", "limitation", "safety"
    ], "learningSummary", &errors)
    summaryObjectKeys(summary["counts"], [
        "eligibleReviews", "capturedLearningRecords", "notCapturedLearningRecords"
    ], "learningSummary.counts", &errors)
    summaryArrayObjects(summary["confidenceOutcomes"], label: "learningSummary.confidenceOutcomes", errors: &errors) { row, label, errors in
        summaryExactKeys(row, ["confidence", "total", "outcomes", "reviewIds"], label, &errors)
        summaryObjectKeys(row["outcomes"], [
            "thesis_confirmed", "thesis_weakened", "thesis_invalidated", "insufficient_evidence"
        ], "\(label).outcomes", &errors)
    }
    summaryArrayObjects(summary["repeatedProcessLessons"], label: "learningSummary.repeatedProcessLessons", errors: &errors) { item, label, errors in
        summaryExactKeys(item, ["processLesson", "count", "reviewIds"], label, &errors)
    }
    summaryArrayObjects(summary["quantSampleLimitations"], label: "learningSummary.quantSampleLimitations", errors: &errors) { item, label, errors in
        summaryExactKeys(item, [
            "sourceClassification", "finalTestPolicy", "boundaryLimitation", "diagnosticStatus",
            "diagnosticLimitation", "decisionCheckIds"
        ], label, &errors)
    }
    summaryObjectKeys(summary["safety"], [
        "personalActorOnly", "descriptiveOnly", "infersCorrectness", "usesProfitLoss", "comparesUsers",
        "score", "recommendation", "ranking", "targetPrice", "targetPosition", "tradeDirection",
        "createsOrder", "createsTrade", "callsBroker"
    ], "learningSummary.safety", &errors)
    if !errors.isEmpty { throw DecisionSnapshotValidationError.invalid(errors) }
}

private func summaryObjectKeys(
    _ value: Any?,
    _ allowed: Set<String>,
    _ label: String,
    _ errors: inout [String]
) {
    guard let object = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    summaryExactKeys(object, allowed, label, &errors)
}

private func summaryArrayObjects(
    _ value: Any?,
    label: String,
    errors: inout [String],
    validate: ([String: Any], String, inout [String]) -> Void
) {
    guard let values = value as? [Any] else {
        errors.append("\(label) must be an array")
        return
    }
    for (index, value) in values.enumerated() {
        guard let object = value as? [String: Any] else {
            errors.append("\(label)[\(index)] must be an object")
            continue
        }
        validate(object, "\(label)[\(index)]", &errors)
    }
}

private func summaryExactKeys(
    _ value: [String: Any],
    _ allowed: Set<String>,
    _ label: String,
    _ errors: inout [String]
) {
    for key in value.keys where !allowed.contains(key) {
        errors.append("\(label) contains unsupported field \(key)")
    }
}
