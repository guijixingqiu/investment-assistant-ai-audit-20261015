import Foundation

public struct ResearchProfileData: Codable, Equatable, Sendable {
    public let market: String
    public let code: String
    public let symbol: String
    public let name: String?
    public let currentView: String
    public let currentThesis: String
    public let marketDisagreement: String?
    public let invalidationCondition: String?
    public let nextReviewOn: String?
    public let keyVariables: [String]?
    public let catalysts: [String]?
    public let evidenceGaps: [String]?
    public let monitorRules: [ResearchMonitorRule]?

    public init(
        market: String,
        code: String,
        symbol: String,
        name: String?,
        currentView: String,
        currentThesis: String,
        marketDisagreement: String?,
        invalidationCondition: String?,
        nextReviewOn: String?,
        keyVariables: [String]? = nil,
        catalysts: [String]? = nil,
        evidenceGaps: [String]? = nil,
        monitorRules: [ResearchMonitorRule]? = nil
    ) {
        self.market = market
        self.code = code
        self.symbol = symbol
        self.name = name
        self.currentView = currentView
        self.currentThesis = currentThesis
        self.marketDisagreement = marketDisagreement
        self.invalidationCondition = invalidationCondition
        self.nextReviewOn = nextReviewOn
        self.keyVariables = keyVariables
        self.catalysts = catalysts
        self.evidenceGaps = evidenceGaps
        self.monitorRules = monitorRules
    }

    func validateForDisplay(errors: inout [String]) {
        if market.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("research profile market is required")
        }
        if code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("research profile code is required")
        }
        if symbol != "\(market).\(code)" {
            errors.append("research profile symbol must match market/code")
        }
        if currentView.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("research profile currentView is required")
        }
        if currentThesis.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("research profile currentThesis is required")
        }
        if let nextReviewOn, nextReviewOn.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("research profile nextReviewOn must be non-empty when present")
        }
        validateBoundedUniqueStrings(keyVariables, field: "research profile keyVariables", errors: &errors)
        validateBoundedUniqueStrings(catalysts, field: "research profile catalysts", errors: &errors)
        validateBoundedUniqueStrings(evidenceGaps, field: "research profile evidenceGaps", errors: &errors)
        if let monitorRules {
            let variables = keyVariables ?? []
            if monitorRules.count > 20 || Set(monitorRules.map(\.variableName)).count != monitorRules.count
                || !monitorRules.allSatisfy({ $0.validates(keyVariables: variables) }) {
                errors.append("research profile monitorRules are invalid")
            }
        }
    }
}

public struct EvidenceItemData: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let sourceType: String
    public let sourceUrl: String?
    public let publishedAt: String?
    public let capturedAt: String
    public let summary: String
    public let factKind: FactKind
    public let variableName: String?
    public let stance: EvidenceStance
    public let reliability: Int?
    public let materiality: Int?
    public let isRead: Bool

    public init(
        id: String,
        sourceType: String,
        sourceUrl: String?,
        publishedAt: String?,
        capturedAt: String,
        summary: String,
        factKind: FactKind,
        variableName: String?,
        stance: EvidenceStance,
        reliability: Int?,
        materiality: Int? = nil,
        isRead: Bool
    ) {
        self.id = id
        self.sourceType = sourceType
        self.sourceUrl = sourceUrl
        self.publishedAt = publishedAt
        self.capturedAt = capturedAt
        self.summary = summary
        self.factKind = factKind
        self.variableName = variableName
        self.stance = stance
        self.reliability = reliability
        self.materiality = materiality
        self.isRead = isRead
    }

    func validateForDisplay(errors: inout [String]) {
        if id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("research evidence id is required")
        }
        if sourceType.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("research evidence sourceType is required")
        }
        if capturedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isParseableDateTime(capturedAt) == false {
            errors.append("research evidence capturedAt must be a valid date-time")
        }
        if summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("research evidence summary is required")
        }
        if sourceUrl?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true {
            errors.append("research evidence sourceUrl must be non-empty when present")
        }
        if let publishedAt, !isParseableDateTime(publishedAt) {
            errors.append("research evidence publishedAt must be a valid date-time when present")
        }
        if variableName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true {
            errors.append("research evidence variableName must be non-empty when present")
        }
        if let reliability, !(1...5).contains(reliability) {
            errors.append("research evidence reliability must be 1...5 when present")
        }
        if let materiality, !(1...5).contains(materiality) {
            errors.append("research evidence materiality must be 1...5 when present")
        }
    }
}

public struct UpdateResearchProfileRequest: Codable, Equatable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let currentView: String
    public let currentThesis: String
    public let marketDisagreement: String?
    public let invalidationCondition: String?
    public let nextReviewOn: String?
    public let keyVariables: [String]?
    public let catalysts: [String]?
    public let evidenceGaps: [String]?
    public let monitorRules: [ResearchMonitorRule]?
    public let idempotencyKey: String

    public init(
        membershipId: String,
        membershipVersion: Int,
        currentView: String,
        currentThesis: String,
        marketDisagreement: String?,
        invalidationCondition: String?,
        nextReviewOn: String?,
        keyVariables: [String]? = nil,
        catalysts: [String]? = nil,
        evidenceGaps: [String]? = nil,
        monitorRules: [ResearchMonitorRule]? = nil,
        idempotencyKey: String
    ) {
        self.membershipId = membershipId
        self.membershipVersion = membershipVersion
        self.currentView = currentView
        self.currentThesis = currentThesis
        self.marketDisagreement = marketDisagreement
        self.invalidationCondition = invalidationCondition
        self.nextReviewOn = nextReviewOn
        self.keyVariables = keyVariables
        self.catalysts = catalysts
        self.evidenceGaps = evidenceGaps
        self.monitorRules = monitorRules
        self.idempotencyKey = idempotencyKey
    }
}

public struct CreateEvidenceRequest: Codable, Equatable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let sourceType: String
    public let sourceUrl: String?
    public let summary: String
    public let factKind: FactKind
    public let stance: EvidenceStance
    public let variableName: String?
    public let reliability: Int?
    public let materiality: Int?
    public let isRead: Bool
    public let idempotencyKey: String

    public init(
        membershipId: String,
        membershipVersion: Int,
        sourceType: String,
        sourceUrl: String?,
        summary: String,
        factKind: FactKind,
        stance: EvidenceStance,
        variableName: String?,
        reliability: Int?,
        materiality: Int? = nil,
        isRead: Bool,
        idempotencyKey: String
    ) {
        self.membershipId = membershipId
        self.membershipVersion = membershipVersion
        self.sourceType = sourceType
        self.sourceUrl = sourceUrl
        self.summary = summary
        self.factKind = factKind
        self.stance = stance
        self.variableName = variableName
        self.reliability = reliability
        self.materiality = materiality
        self.isRead = isRead
        self.idempotencyKey = idempotencyKey
    }
}
