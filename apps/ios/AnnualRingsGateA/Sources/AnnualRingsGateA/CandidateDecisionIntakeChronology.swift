func validateCandidateDecisionIntakeChronology(
    _ envelope: CandidateDecisionIntakeEnvelope,
    errors: inout [String]
) {
    guard envelope.status == .available else { return }
    if let asOf = envelope.metadata.asOf, let fetchedAt = envelope.metadata.fetchedAt {
        if !areDateTimeInstantsChronologicallyOrdered([asOf, fetchedAt, envelope.generatedAt]) {
            errors.append("available intake metadata must not be after generatedAt")
        }
    } else {
        errors.append("available intake metadata must not be after generatedAt")
    }
    if let fetchedAt = envelope.membership?.quote.fetchedAt,
       !areDateTimeInstantsChronologicallyOrdered([fetchedAt, envelope.generatedAt]) {
        errors.append("membership quote fetchedAt must not be after intake generatedAt")
    }
    if let generatedAt = envelope.decisionContext?.generatedAt,
       !areDateTimeInstantsChronologicallyOrdered([generatedAt, envelope.generatedAt]) {
        errors.append("decisionContext.generatedAt must not be after intake generatedAt")
    }
}
