import Foundation

extension ResearchWriteEnvelope where T == PostDecisionReviewData {
    func validatePostDecisionReviewSourceAudit(errors: inout [String]) {
        if source.actorType != data.audit.actorType {
            errors.append("post-decision review write source.actorType must match audit.actorType")
        }
        if source.actorId != data.audit.actorId {
            errors.append("post-decision review write source.actorId must match audit.actorId")
        }
        if source.correlationId != data.audit.correlationId {
            errors.append("post-decision review write source.correlationId must match audit.correlationId")
        }
    }
}

extension PostDecisionReviewData {
    func validatePostDecisionReviewRequestEcho(
        _ request: CreatePostDecisionReviewRequest?,
        errors: inout [String]
    ) {
        guard let request else { return }
        if outcome != request.outcome {
            errors.append("review outcome must match submitted request")
        }
        if outcomeEvidence != request.outcomeEvidence {
            errors.append("review outcomeEvidence must match submitted request")
        }
        if reviewNote != request.reviewNote {
            errors.append("review reviewNote must match submitted request")
        }
        if let requestedReviewedAt = request.reviewedAt, reviewedAt != requestedReviewedAt {
            errors.append("review reviewedAt must match submitted request when provided")
        }
        if audit.idempotencyKey != request.idempotencyKey {
            errors.append("review audit.idempotencyKey must match submitted request")
        }
    }
}
