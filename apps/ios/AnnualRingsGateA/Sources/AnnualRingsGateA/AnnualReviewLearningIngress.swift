import Foundation

func validateAnnualReviewLearningRawShape(_ value: Any, label: String) throws {
    guard let state = value as? [String: Any], let availability = state["availability"] as? String else {
        throw DecisionSnapshotValidationError.invalid(["\(label) must be an object with availability"])
    }
    var errors: [String] = []
    validateAnnualReviewLearningRawKeys(
        state,
        allowed: ["availability", "snapshot", "limitation"],
        label: label,
        errors: &errors
    )
    if availability == "review_learning_not_captured" {
        if !errors.isEmpty { throw DecisionSnapshotValidationError.invalid(errors) }
        return
    }
    guard ["preserved", "ordinary_manual_preserved"].contains(availability),
          let snapshot = state["snapshot"] as? [String: Any] else {
        throw DecisionSnapshotValidationError.invalid(["\(label) preserved state must contain a snapshot"])
    }
    if availability == "ordinary_manual_preserved" {
        validateAnnualReviewLearningRawKeys(
            snapshot,
            allowed: ["schemaVersion", "kind", "decisionCheckId", "membershipId", "membershipVersion",
                      "judgmentCorrection", "processLesson", "nextResearchQuestion"],
            label: "\(label).snapshot", errors: &errors
        )
        guard snapshot["kind"] as? String == "ordinary_manual" else {
            errors.append("\(label).snapshot manual kind is invalid")
            throw DecisionSnapshotValidationError.invalid(errors)
        }
        if !errors.isEmpty { throw DecisionSnapshotValidationError.invalid(errors) }
        return
    }
    validateAnnualReviewLearningRawKeys(
        snapshot,
        allowed: [
            "schemaVersion", "decisionCheckId", "decisionSnapshotId", "conditionalPreviewId",
            "judgmentCorrection", "processLesson", "nextResearchQuestion", "reviewedFactsAt", "monitor"
        ],
        label: "\(label).snapshot",
        errors: &errors
    )
    do {
        try validateAnnualConditionalMonitorRawShape(snapshot["monitor"] as Any, label: "\(label).snapshot.monitor")
    } catch AnnualConditionalDecisionValidationError.invalid(let monitorErrors) {
        errors.append(contentsOf: monitorErrors)
    }
    if !errors.isEmpty { throw DecisionSnapshotValidationError.invalid(errors) }
}

private func validateAnnualReviewLearningRawKeys(
    _ value: [String: Any],
    allowed: Set<String>,
    label: String,
    errors: inout [String]
) {
    for key in value.keys where !allowed.contains(key) {
        errors.append("\(label) contains unsupported field \(key)")
    }
}
