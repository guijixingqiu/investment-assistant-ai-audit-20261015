import Foundation

func areDateTimeInstantsChronologicallyOrdered(_ values: [String]) -> Bool {
    var previous: Date?
    for value in values {
        guard let current = parseDateTimeInstant(value) else {
            return false
        }
        if let previous, current < previous {
            return false
        }
        previous = current
    }
    return true
}

private func parseDateTimeInstant(_ value: String) -> Date? {
    // History validation runs several levels below an asynchronous readback on
    // a small worker stack. Constructing ICU date formatters there can exhaust
    // that stack. Parse the already validated RFC 3339 fields arithmetically.
    guard factMetadataIsRFC3339DateTime(value) else { return nil }
    let bytes = Array(value.utf8)
    func decimal(_ start: Int, _ length: Int) -> Int {
        bytes[start..<(start + length)].reduce(0) { $0 * 10 + Int($1 - 48) }
    }
    let year = decimal(0, 4)
    let month = decimal(5, 2)
    let day = decimal(8, 2)
    let hour = decimal(11, 2)
    let minute = decimal(14, 2)
    let second = decimal(17, 2)
    // ISO8601DateFormatter does not represent leap seconds as a distinct Date.
    guard year >= 1, second <= 59 else { return nil }

    var index = 19
    var fraction = 0.0
    if bytes[index] == 46 {
        index += 1
        var place = 0.1
        while index < bytes.count, (48...57).contains(bytes[index]) {
            fraction += Double(bytes[index] - 48) * place
            place *= 0.1
            index += 1
        }
    }
    var offsetSeconds = 0
    if bytes[index] != 90 && bytes[index] != 122 {
        let direction = bytes[index] == 43 ? 1 : -1
        offsetSeconds = direction * (decimal(index + 1, 2) * 3_600 + decimal(index + 4, 2) * 60)
    }

    // Gregorian civil date to days since 1970-01-01. Month/day and offset
    // bounds were checked by factMetadataIsRFC3339DateTime above.
    let adjustedYear = year - (month <= 2 ? 1 : 0)
    let era = adjustedYear / 400
    let yearOfEra = adjustedYear - era * 400
    let adjustedMonth = month + (month > 2 ? -3 : 9)
    let dayOfYear = (153 * adjustedMonth + 2) / 5 + day - 1
    let yearDays = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
    let daysSinceEpoch = era * 146_097 + yearDays - 719_468
    let wholeSeconds = daysSinceEpoch * 86_400 + hour * 3_600 + minute * 60 + second - offsetSeconds
    return Date(timeIntervalSince1970: Double(wholeSeconds) + fraction)
}

func validateDecisionContextQuoteChronology(
    _ quote: DecisionContextQuote,
    generatedAt: String,
    errors: inout [String]
) {
    let available = quote.status == "fresh" || quote.status == "stale"
    if available, let data = quote.data {
        if let fetchedAt = quote.fetchedAt {
            if !areDateTimeInstantsChronologicallyOrdered([data.quoteTime, fetchedAt, generatedAt]) {
                errors.append("decision context quote must satisfy quoteTime <= fetchedAt <= generatedAt")
            }
        } else {
            errors.append("decision context quote must satisfy quoteTime <= fetchedAt <= generatedAt")
        }
        if quote.metadata?.asOf != data.quoteTime || quote.metadata?.fetchedAt != quote.fetchedAt {
            errors.append("decision context quote metadata timestamps must bind quote data and fetchedAt")
        }
    } else if !available,
              quote.snapshotId != nil || quote.fetchedAt != nil || quote.data != nil ||
              quote.metadata?.asOf != nil || quote.metadata?.fetchedAt != nil {
        errors.append("decision context unavailable quote must clear snapshotId, timestamps, and data")
    }
    if (quote.status == "unavailable" || quote.status == "permission_denied"), quote.source != nil {
        errors.append("decision context unavailable quote must clear source")
    }
}

func validateDecisionQuantEvidenceChronology(
    _ evidence: DecisionQuantEvidence,
    availableBy: String,
    errors: inout [String]
) {
    guard evidence.status == "available" else {
        if evidence.metadata.asOf != nil || evidence.metadata.fetchedAt != nil {
            errors.append("decision context fail-closed quantEvidence metadata must clear asOf and fetchedAt")
        }
        return
    }
    var chronology: [String?] = [evidence.metadata.asOf]
    if evidence.decisionEvidence?.status == "available", let source = evidence.decisionEvidence?.source {
        chronology.append(source.dataCutoff)
    }
    chronology.append(evidence.metadata.fetchedAt)
    chronology.append(evidence.identities?.generatedAt)
    chronology.append(availableBy)
    let instants = chronology.compactMap { $0 }
    if instants.count != chronology.count || !areDateTimeInstantsChronologicallyOrdered(instants) {
        errors.append("decision context available quant evidence must satisfy asOf <= dataCutoff <= fetchedAt <= generatedAt <= envelope generatedAt")
    }
}
