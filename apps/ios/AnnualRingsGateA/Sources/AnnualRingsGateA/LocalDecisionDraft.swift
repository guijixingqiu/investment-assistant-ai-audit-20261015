import Foundation

public struct LocalDecisionDraft: Codable, Equatable, Sendable {
    public let symbol: String
    public let thesis: String
    public let timeHorizon: String
    public let conditions: String
    public let actionPlan: String
    public let risks: String
    public let invalidation: String
    public let createdAt: String
    public let authority: String
    public let executionStatus: String

    public func isBound(to canonicalSymbol: String?) -> Bool {
        canonicalSymbol != nil && symbol == canonicalSymbol
    }

    public init(
        symbol: String,
        thesis: String,
        timeHorizon: String,
        conditions: String,
        actionPlan: String,
        risks: String,
        invalidation: String,
        createdAt: String
    ) throws {
        guard SecuritySymbol.parseHongKongAlias(symbol)?.canonical == symbol,
              !thesis.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              ISO8601DateFormatter().date(from: createdAt) != nil else {
            throw LocalDecisionDraftError.invalid
        }
        self.symbol = symbol
        self.thesis = thesis
        self.timeHorizon = normalized(timeHorizon)
        self.conditions = normalized(conditions)
        self.actionPlan = normalized(actionPlan)
        self.risks = normalized(risks)
        self.invalidation = normalized(invalidation)
        self.createdAt = createdAt
        authority = "unofficial_local_draft"
        executionStatus = "not_executed"
    }
}

private func normalized(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "UNKNOWN" : trimmed
}

public enum LocalDecisionDraftError: Error, Equatable, Sendable {
    case invalid
}
