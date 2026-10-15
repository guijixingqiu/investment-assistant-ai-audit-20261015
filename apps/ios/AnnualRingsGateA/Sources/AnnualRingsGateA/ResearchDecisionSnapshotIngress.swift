import Foundation
func validateDecisionCheckSnapshotIdentities(_ data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any], let decision = root["data"] as? [String: Any],
          let state = decision["decisionSnapshot"] as? [String: Any], state["availability"] as? String == DecisionSnapshotAvailability.preserved.rawValue,
          state["snapshot"] is [String: Any] else {
        throw DecisionSnapshotValidationError.invalid(["decision check response must contain a preserved decisionSnapshot"])
    }
    try validateDecisionSnapshotCanonicalIdentities(state, label: "decision check decisionSnapshot")
    try validateRequiredResearchReportDecisionRawShape(decision, label: "decision check researchReportDecision")
    if let formalDecision = decision["formalDecision"] {
        try validateFormalDecisionRawShape(formalDecision, label: "decision check formalDecision")
    }
}
func validateDecisionReviewSnapshotIdentities(_ data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let checks = root["checks"] as? [[String: Any]] else {
        throw DecisionSnapshotValidationError.invalid(["decision review history checks must be an array"])
    }
    try root["learningSummary"].map(validateAnnualReviewLearningSummaryRawShape)
    for (index, check) in checks.enumerated() {
        guard let state = check["decisionSnapshot"] else {
            throw DecisionSnapshotValidationError.invalid(["decision review checks[\(index)] must contain a decisionSnapshot"])
        }
        try validateDecisionSnapshotCanonicalIdentities(state, label: "decision review checks[\(index)].decisionSnapshot")
        if let conditionalDecision = check["conditionalDecision"] {
            do {
                try validateAnnualConditionalDecisionStateRawShape(
                    conditionalDecision,
                    label: "decision review checks[\(index)].conditionalDecision"
                )
            } catch AnnualConditionalDecisionValidationError.invalid(let errors) {
                throw DecisionSnapshotValidationError.invalid(errors)
            }
        }
        try validateRequiredResearchReportDecisionRawShape(check, label: "decision review checks[\(index)].researchReportDecision")
        if let formalDecision = check["formalDecision"] {
            try validateFormalDecisionRawShape(
                formalDecision,
                label: "decision review checks[\(index)].formalDecision"
            )
        }
        if let reviews = check["reviews"] as? [[String: Any]] {
            for (reviewIndex, review) in reviews.enumerated() {
                if let portfolioReview = review["portfolioReview"] {
                    try validatePostDecisionPortfolioReviewCanonicalIdentities(
                        portfolioReview,
                        label: "decision review checks[\(index)].reviews[\(reviewIndex)].portfolioReview"
                    )
                }
                if let reviewLearning = review["reviewLearning"] {
                    try validateAnnualReviewLearningRawShape(
                        reviewLearning,
                        label: "decision review checks[\(index)].reviews[\(reviewIndex)].reviewLearning"
                    )
                }
            }
        }
    }
}
func validatePostDecisionReviewWritePortfolioIdentities(_ data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let review = root["data"] as? [String: Any] else {
        throw DecisionSnapshotValidationError.invalid(["post-decision review response must contain review data"])
    }
    if let portfolioReview = review["portfolioReview"] {
        try validatePostDecisionPortfolioReviewCanonicalIdentities(
            portfolioReview,
            label: "post-decision review portfolioReview"
        )
    }
    if let reviewLearning = review["reviewLearning"] {
        try validateAnnualReviewLearningRawShape(reviewLearning, label: "post-decision review reviewLearning")
    }
}
private func validatePostDecisionPortfolioReviewCanonicalIdentities(_ value: Any, label: String) throws {
    guard let state = value as? [String: Any], let availability = state["availability"] as? String else {
        throw DecisionSnapshotValidationError.invalid(["\(label) must be an object with availability"])
    }
    var errors: [String] = []
    validatePostDecisionPortfolioRawKeys(
        state,
        allowed: ["availability", "snapshot", "limitation"],
        label: label,
        errors: &errors
    )
    if availability == PostDecisionPortfolioReviewAvailability.notCaptured.rawValue {
        if !errors.isEmpty {
            throw DecisionSnapshotValidationError.invalid(errors)
        }
        return
    }
    guard availability == PostDecisionPortfolioReviewAvailability.preserved.rawValue,
          let snapshot = state["snapshot"] as? [String: Any],
          let comparison = snapshot["comparison"] as? [String: Any] else {
        throw DecisionSnapshotValidationError.invalid(["\(label) preserved state must contain a snapshot and comparison"])
    }
    validatePostDecisionPortfolioRawKeys(
        snapshot,
        allowed: [
            "schemaVersion", "snapshotId", "capturedAt", "decisionCheckId", "decisionSnapshotId",
            "candidateSymbol", "reviewTimePortfolio", "comparison", "safety"
        ],
        label: "\(label).snapshot",
        errors: &errors
    )
    if let reviewTimePortfolio = snapshot["reviewTimePortfolio"] as? [String: Any] {
        validatePostDecisionPortfolioRawKeys(
            reviewTimePortfolio,
            allowed: ["state", "envelope", "limitation"],
            label: "\(label).snapshot.reviewTimePortfolio",
            errors: &errors
        )
    }
    if let reviewSafety = snapshot["safety"] as? [String: Any] {
        validatePostDecisionPortfolioRawKeys(
            reviewSafety,
            allowed: postDecisionPortfolioReviewSafetyKeys,
            label: "\(label).snapshot.safety",
            errors: &errors
        )
    }
    validatePostDecisionPortfolioRawKeys(
        comparison,
        allowed: [
            "calculationVersion", "comparisonId", "status", "candidateSymbol", "decisionTime",
            "reviewTime", "metrics", "cash", "gaps", "safety"
        ],
        label: "\(label).snapshot.comparison",
        errors: &errors
    )
    for referenceKey in ["decisionTime", "reviewTime"] {
        if let reference = comparison[referenceKey] as? [String: Any] {
            validatePostDecisionPortfolioRawKeys(
                reference,
                allowed: ["state", "contextId", "portfolioSnapshotId", "accountScopeId", "portfolioAsOf", "assembledAt"],
                label: "\(label).snapshot.comparison.\(referenceKey)",
                errors: &errors
            )
        }
    }
    if let metrics = comparison["metrics"] as? [String: Any] {
        let metricKeys = Set(PostDecisionPortfolioMetricKey.allCases.map(\.rawValue))
        validatePostDecisionPortfolioRawKeys(
            metrics,
            allowed: metricKeys,
            label: "\(label).snapshot.comparison.metrics",
            errors: &errors
        )
        for metricKey in metricKeys {
            if let metric = metrics[metricKey] as? [String: Any] {
                validatePostDecisionPortfolioRawKeys(
                    metric,
                    allowed: ["availability", "decisionTime", "reviewTime", "delta"],
                    label: "\(label).snapshot.comparison.metrics.\(metricKey)",
                    errors: &errors
                )
            }
        }
    }
    if let cash = comparison["cash"] as? [String: Any] {
        validatePostDecisionPortfolioRawKeys(
            cash,
            allowed: ["status", "decisionTime", "reviewTime", "delta", "reason"],
            label: "\(label).snapshot.comparison.cash",
            errors: &errors
        )
    }
    if let safety = comparison["safety"] as? [String: Any] {
        validatePostDecisionPortfolioRawKeys(
            safety,
            allowed: postDecisionPortfolioComparisonSafetyKeys,
            label: "\(label).snapshot.comparison.safety",
            errors: &errors
        )
    }
    do {
        let expected = try postDecisionPortfolioComparisonContentId(object: comparison)
        if comparison["comparisonId"] as? String != expected {
            errors.append("\(label) comparisonId does not match canonical stable fact content")
        }
    } catch {
        errors.append("\(label) canonical comparison identity could not be calculated")
    }
    do {
        let expected = try portfolioDecisionContentId(
            object: snapshot,
            prefix: "post-decision-portfolio-review:",
            excludingTopLevelKeys: ["snapshotId"]
        )
        if snapshot["snapshotId"] as? String != expected {
            errors.append("\(label) snapshotId does not match canonical complete snapshot content")
        }
    } catch {
        errors.append("\(label) canonical snapshot identity could not be calculated")
    }
    if let reviewTime = snapshot["reviewTimePortfolio"] as? [String: Any],
       let envelope = reviewTime["envelope"] as? [String: Any],
       let contextId = envelope["contextId"] as? String {
        do {
            let expected = try portfolioDecisionContextContentId(object: envelope)
            if contextId != expected {
                errors.append("\(label) review-time portfolio contextId does not match canonical content")
            }
        } catch {
            errors.append("\(label) review-time canonical portfolio identity could not be calculated")
        }
    }
    if !errors.isEmpty {
        throw DecisionSnapshotValidationError.invalid(errors)
    }
}

private func validatePostDecisionPortfolioRawKeys(
    _ value: [String: Any],
    allowed: Set<String>,
    label: String,
    errors: inout [String]
) {
    for key in value.keys where !allowed.contains(key) {
        errors.append("\(label) contains unsupported field \(key)")
    }
}

private let postDecisionPortfolioComparisonSafetyKeys: Set<String> = [
    "advisoryOnly", "neutralFactsOnly", "infersCausality", "performanceAttribution",
    "infersDecisionQuality", "recommendsDirection", "recommendsAmount", "recommendsWeight",
    "recommendsTiming", "promisesReturn", "createsOrder", "createsTrade", "mutatesCash",
    "writesFee", "mutatesPosition", "callsBroker", "productionWrite"
]

private let postDecisionPortfolioReviewSafetyKeys = postDecisionPortfolioComparisonSafetyKeys.union([
    "readOnlyPortfolioFacts", "appendOnlyHumanReview", "mutatesOriginalDecision"
])

private func validateDecisionSnapshotCanonicalIdentities(_ value: Any, label: String) throws {
    guard let state = value as? [String: Any], let availability = state["availability"] as? String else {
        throw DecisionSnapshotValidationError.invalid(["\(label) must be an object with availability"])
    }
    if availability == DecisionSnapshotAvailability.notCaptured.rawValue {
        return
    }
    guard availability == DecisionSnapshotAvailability.preserved.rawValue,
          let snapshot = state["snapshot"] as? [String: Any] else {
        throw DecisionSnapshotValidationError.invalid(["\(label) preserved state must contain a snapshot"])
    }

    var errors: [String] = []
    if let safety = snapshot["safety"] as? [String: Any] {
        let allowedSafetyKeys: Set<String> = [
            "advisoryOnly", "officialPortfolioMutation", "officialReviewMutation", "createsOrder",
            "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker", "productionWrite"
        ]
        for key in safety.keys where !allowedSafetyKeys.contains(key) {
            errors.append("\(label) contains unsupported safety field \(key)")
        }
    }
    do {
        let expected = try portfolioDecisionContentId(
            object: snapshot,
            prefix: "decision-snapshot:",
            excludingTopLevelKeys: ["snapshotId"]
        )
        if snapshot["snapshotId"] as? String != expected {
            errors.append("\(label) snapshotId does not match canonical content")
        }
    } catch {
        errors.append("\(label) canonical snapshot identity could not be calculated")
    }

    if let context = snapshot["decisionContext"] as? [String: Any] {
        errors.append(contentsOf: quantDecisionEvidenceRawErrors(context: context, label: "\(label) decision context"))
        do {
            let expectedHash = try portfolioDecisionContentId(
                object: context,
                prefix: "",
                excludingTopLevelKeys: ["contextId", "contextHash", "generatedAt"]
            )
            let candidateSymbol = snapshot["candidateSymbol"] as? String
            if context["contextHash"] as? String != expectedHash {
                errors.append("\(label) decision context hash does not match canonical content")
            }
            if let candidateSymbol,
               context["contextId"] as? String != "decision-context:\(candidateSymbol):\(expectedHash.prefix(16))" {
                errors.append("\(label) decision context ID does not match canonical content")
            }
        } catch {
            errors.append("\(label) canonical decision context identity could not be calculated")
        }
    } else {
        errors.append("\(label) decision context is missing")
    }

    if let portfolioState = snapshot["portfolioContext"] as? [String: Any],
       let portfolio = portfolioState["envelope"] as? [String: Any],
       let contextId = portfolio["contextId"] as? String {
        do {
            let expected = try portfolioDecisionContextContentId(object: portfolio)
            if contextId != expected {
                errors.append("\(label) portfolio contextId does not match canonical content")
            }
        } catch {
            errors.append("\(label) canonical portfolio identity could not be calculated")
        }
    }

    if let riskState = snapshot["riskImpact"] as? [String: Any],
       let risk = riskState["envelope"] as? [String: Any],
       let impactId = risk["impactId"] as? String {
        do {
            let expected = try portfolioDecisionContentId(
                object: risk,
                prefix: "portfolio-risk-impact:",
                excludingTopLevelKeys: ["impactId"]
            )
            if impactId != expected {
                errors.append("\(label) risk impactId does not match canonical content")
            }
        } catch {
            errors.append("\(label) canonical risk identity could not be calculated")
        }
    }

    if !errors.isEmpty {
        throw DecisionSnapshotValidationError.invalid(errors)
    }
}
