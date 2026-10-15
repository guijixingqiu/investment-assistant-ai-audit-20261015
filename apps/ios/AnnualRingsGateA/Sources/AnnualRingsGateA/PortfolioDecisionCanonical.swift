import Foundation
import CoreFoundation
import CryptoKit

func portfolioDecisionContentId(
    rawJSON: Data,
    prefix: String,
    excludingTopLevelKeys: Set<String>
) throws -> String {
    guard let object = try JSONSerialization.jsonObject(with: rawJSON) as? [String: Any] else {
        throw portfolioDecisionCanonicalError("Portfolio response must be a JSON object")
    }
    return try portfolioDecisionContentId(
        object: object,
        prefix: prefix,
        excludingTopLevelKeys: excludingTopLevelKeys
    )
}

func portfolioDecisionContentId(
    object: [String: Any],
    prefix: String,
    excludingTopLevelKeys: Set<String>
) throws -> String {
    var content = object
    for key in excludingTopLevelKeys {
        content.removeValue(forKey: key)
    }
    let canonical = try portfolioDecisionCanonicalJSON(content)
    let digest = SHA256.hash(data: Data(canonical.utf8))
    return prefix + digest.map { String(format: "%02x", $0) }.joined()
}

func portfolioDecisionContextContentId(rawJSON: Data) throws -> String {
    guard let object = try JSONSerialization.jsonObject(with: rawJSON) as? [String: Any] else {
        throw portfolioDecisionCanonicalError("Portfolio response must be a JSON object")
    }
    return try portfolioDecisionContextContentId(object: object)
}

func portfolioDecisionContextContentId(object: [String: Any]) throws -> String {
    return try portfolioDecisionContentId(
        object: object,
        prefix: "portfolio-decision-context:",
        excludingTopLevelKeys: ["contextId", "assembledAt", "freshness"]
    )
}

/// Internal so archive writers can persist JSON whose numeric text matches this canonical hash input.
func portfolioDecisionCanonicalJSON(_ value: Any) throws -> String {
    if value is NSNull {
        return "null"
    }
    if let object = value as? [String: Any] {
        let fields = try object.keys.sorted().map { key in
            let encodedKey = try portfolioDecisionJSONString(key)
            let encodedValue = try portfolioDecisionCanonicalJSON(object[key]!)
            return "\(encodedKey):\(encodedValue)"
        }
        return "{\(fields.joined(separator: ","))}"
    }
    if let array = value as? [Any] {
        return "[\(try array.map(portfolioDecisionCanonicalJSON).joined(separator: ","))]"
    }
    if let string = value as? String {
        return try portfolioDecisionJSONString(string)
    }
    if let number = value as? NSNumber {
        if CFGetTypeID(number) == CFBooleanGetTypeID() {
            return number.boolValue ? "true" : "false"
        }
        return try portfolioDecisionJavaScriptNumber(number.doubleValue)
    }
    throw portfolioDecisionCanonicalError("Portfolio response contains an unsupported JSON value")
}

private func portfolioDecisionJSONString(_ value: String) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    return String(decoding: try encoder.encode(value), as: UTF8.self)
}

func portfolioDecisionJavaScriptNumber(_ value: Double) throws -> String {
    guard value.isFinite else {
        throw portfolioDecisionCanonicalError("Portfolio response contains a non-finite JSON number")
    }
    if value == 0 {
        return "0"
    }

    let raw = String(value).lowercased()
    guard raw.contains("e") else {
        return raw.hasSuffix(".0") ? String(raw.dropLast(2)) : raw
    }

    let isNegative = raw.hasPrefix("-")
    let unsigned = isNegative ? String(raw.dropFirst()) : raw
    guard let unsignedExponentIndex = unsigned.firstIndex(of: "e"),
          let exponent = Int(unsigned[unsigned.index(after: unsignedExponentIndex)...]) else {
        throw portfolioDecisionCanonicalError("Portfolio response contains an invalid JSON number")
    }

    var mantissa = String(unsigned[..<unsignedExponentIndex])
    if mantissa.contains(".") {
        while mantissa.last == "0" {
            mantissa.removeLast()
        }
        if mantissa.last == "." {
            mantissa.removeLast()
        }
    }
    let sign = isNegative ? "-" : ""
    let magnitude = abs(value)
    if magnitude < 1e-6 || magnitude >= 1e21 {
        let exponentText = exponent >= 0 ? "+\(exponent)" : String(exponent)
        return "\(sign)\(mantissa)e\(exponentText)"
    }

    let digits = mantissa.replacingOccurrences(of: ".", with: "")
    let decimalPosition = exponent + 1
    if decimalPosition <= 0 {
        return "\(sign)0.\(String(repeating: "0", count: -decimalPosition))\(digits)"
    }
    if decimalPosition >= digits.count {
        return "\(sign)\(digits)\(String(repeating: "0", count: decimalPosition - digits.count))"
    }
    let split = digits.index(digits.startIndex, offsetBy: decimalPosition)
    return "\(sign)\(digits[..<split]).\(digits[split...])"
}

private func portfolioDecisionCanonicalError(_ description: String) -> DecodingError {
    .dataCorrupted(.init(codingPath: [], debugDescription: description))
}
