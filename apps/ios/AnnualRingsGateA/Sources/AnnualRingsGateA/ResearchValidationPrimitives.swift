import Foundation

func isParseableDateTime(_ value: String) -> Bool {
    if (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value)) != nil {
        return true
    }
    return (try? Date.ISO8601FormatStyle().parse(value)) != nil
}

func validateBoundedUniqueStrings(_ value: [String]?, field: String, errors: inout [String]) {
    guard let value else { return }
    let normalized = value.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    if value.count > 20 || value != normalized || normalized.contains(where: { $0.isEmpty || $0.count > 500 }) || Set(normalized).count != normalized.count {
        errors.append("\(field) must contain at most 20 unique non-empty values")
    }
}

func isStrictUtcDateTime(_ value: String) -> Bool {
    let pattern = #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#
    guard value.range(of: pattern, options: .regularExpression) != nil else {
        return false
    }
    return (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value)) != nil
}
