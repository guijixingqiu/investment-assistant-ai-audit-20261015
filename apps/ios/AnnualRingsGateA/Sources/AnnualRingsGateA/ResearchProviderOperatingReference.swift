import Foundation

public struct ProviderOperatingPeriod: Codable, Equatable, Identifiable, Sendable {
    public struct MaterialMatch: Codable, Equatable, Identifiable, Sendable {
        public let id: String
        public let revision: Int
        public let contentFingerprint: String
        public let sourceVersion: String
    }
    public let financialType: String
    public let periodEnd: String
    public let captureId: String?
    public let sourceFingerprint: String?
    public let values: [FutuFinancialHistoryValue]
    public let missingMetrics: [String]
    public let materialMatches: [MaterialMatch]
    public let limitations: [String]
    public var id: String { "\(financialType):\(periodEnd)" }

    public func validates(symbol: String) -> Bool {
        guard ["ANNUAL", "Q6"].contains(financialType),
              periodEnd.range(of: #"^20\d{2}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
              values.count <= 5, Set(values.map(\.metric)).count == values.count,
              materialMatches.count <= 20, limitations.count <= 10,
              materialMatches.allSatisfy({ researchDocumentIsPositiveIntegerString($0.id)
                  && $0.revision > 0 && researchDocumentIsSha256($0.contentFingerprint)
                  && !$0.sourceVersion.isEmpty }) else { return false }
        let metrics = ["revenue", "profit_attributable_to_owners", "operating_cash_flow", "total_assets", "total_liabilities"]
        guard missingMetrics == metrics.filter({ metric in !values.contains(where: { $0.metric == metric }) }),
              values.isEmpty ? sourceFingerprint == nil : researchDocumentIsSha256(sourceFingerprint ?? ""),
              values.allSatisfy({ value in
                  value.financialType == financialType && value.periodEnd == periodEnd
                      && value.source.captureId == captureId
                      && researchDocumentIsPositiveIntegerString(value.source.pageId)
                      && researchDocumentIsSha256(value.source.rawSha256)
                      && researchDocumentIsSha256(value.source.reportSha256)
                      && value.rawValue.range(of: #"^-?\d+(?:\.\d+)?$"#, options: .regularExpression) != nil
                      && value.currencyCode.range(of: #"^[A-Z]{3}$"#, options: .regularExpression) != nil
              }) else { return false }
        return symbol.range(of: #"^HK\.\d{5}$"#, options: .regularExpression) != nil
    }
}

public struct ProviderOperatingOwnerContext: Codable, Equatable, Sendable {
    public struct Assumption: Codable, Equatable, Sendable {
        public let scenario: String
        public let metric: String
        public let value: Double
        public let unit: String
        public let note: String
        public let periodEnd: String
    }
    public struct CounterEvidence: Codable, Equatable, Identifiable, Sendable {
        public let testId: String
        public let conditionText: String
        public let metrics: [String]
        public let status: String
        public var id: String { testId }
    }
    public struct Question: Codable, Equatable, Identifiable, Sendable {
        public let questionId: String
        public let question: String
        public let targetMetric: String
        public var id: String { questionId }
    }
    public let contextId: String
    public let contextFingerprint: String
    public let cutoffAt: String
    public let kpis: [ResearchOperatingKpi]
    public let ownerAssumptions: [Assumption]
    public let counterEvidence: [CounterEvidence]
    public let questions: [Question]
    public let unknowns: [String]
}

public struct ResearchProviderOperatingReference: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let sourceClassification: String
    public let status: String
    public let periods: [ProviderOperatingPeriod]
    public let gaps: [String]
    public let captureLimitations: [String]?
    public let ownerContext: ProviderOperatingOwnerContext?
    public let issuerOriginalVerification: String
    public let restatementComparability: String
    public let latestRequiredFiling: String

    public func validates(_ membership: CandidateMembershipData) -> Bool {
        schemaVersion == "2026-10-11.provider-operating-reference.v1"
            && membershipId == membership.id && membershipVersion == membership.version && symbol == membership.symbol
            && sourceClassification == "futu_opend_financial_statement_provider"
            && ["available", "partial", "unavailable"].contains(status)
            && periods.count <= 7 && Set(periods.map(\.id)).count == periods.count
            && periods.allSatisfy { $0.validates(symbol: symbol) }
            && gaps.count <= 30
            && captureLimitations.map({ $0.count <= 30 && $0.allSatisfy { !$0.isEmpty } }) != false
            && ownerContext.map { context in
                researchDocumentIsPositiveIntegerString(context.contextId)
                    && researchDocumentIsSha256(context.contextFingerprint)
                    && context.kpis.allSatisfy { $0.selectedSymbol == symbol }
                    && context.ownerAssumptions.count <= 30
                    && context.counterEvidence.count <= 20
                    && context.questions.count <= 30
                    && context.unknowns.count <= 100
            } != false
            && issuerOriginalVerification == "UNKNOWN"
            && restatementComparability == "UNKNOWN"
            && latestRequiredFiling == "UNKNOWN"
    }
}
