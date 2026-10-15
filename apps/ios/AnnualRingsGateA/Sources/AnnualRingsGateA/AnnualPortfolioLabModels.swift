import Foundation

public enum AnnualPortfolioLabValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct AnnualPortfolioLabEnvelope: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-17.annual-portfolio-lab.v1"
    public static let calculationVersionV1 = "annual-portfolio-lab.v1"

    public let schemaVersion: String
    public let calculationVersion: String
    public let generatedAt: String
    public let status: String
    public let labId: String?
    public let membershipId: String
    public let requestedActorId: String
    public let requestedSymbol: String?
    public let data: AnnualPortfolioLabData?
    public let gaps: [String]
    public let safety: AnnualPortfolioLabSafety
    public let message: String
    public var clientFailureState: String?

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, calculationVersion, generatedAt, status, labId, membershipId
        case requestedActorId, requestedSymbol, data, gaps, safety, message
    }

    public init(
        schemaVersion: String = Self.schemaVersionV1,
        calculationVersion: String = Self.calculationVersionV1,
        generatedAt: String,
        status: String,
        labId: String?,
        membershipId: String,
        requestedActorId: String,
        requestedSymbol: String?,
        data: AnnualPortfolioLabData?,
        gaps: [String],
        safety: AnnualPortfolioLabSafety,
        message: String,
        clientFailureState: String? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.calculationVersion = calculationVersion
        self.generatedAt = generatedAt
        self.status = status
        self.labId = labId
        self.membershipId = membershipId
        self.requestedActorId = requestedActorId
        self.requestedSymbol = requestedSymbol
        self.data = data
        self.gaps = gaps
        self.safety = safety
        self.message = message
        self.clientFailureState = clientFailureState
    }

    public static func unavailable(
        _ message: String,
        membershipId: String = "unselected",
        clientFailureState: String = "unavailable"
    ) -> Self {
        .init(
            generatedAt: "1970-01-01T00:00:00.000Z",
            status: "unavailable",
            labId: nil,
            membershipId: membershipId,
            requestedActorId: "unavailable",
            requestedSymbol: nil,
            data: nil,
            gaps: [message],
            safety: .safe,
            message: message,
            clientFailureState: clientFailureState
        )
    }
}

public struct AnnualPortfolioLabSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let userProvidedAmountsOnly: Bool
    public let preservesScenarioOrder: Bool
    public let changesCandidateOrdering: Bool
    public let recommendation: Bool
    public let ranking: Bool
    public let score: Bool
    public let suggestedAmount: Bool
    public let targetWeight: Bool
    public let targetPrice: Bool
    public let tradeDirection: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let callsBroker: Bool
    public let mutatesOfficialPortfolio: Bool
    public let productionWrite: Bool

    public static let safe = Self(
        advisoryOnly: true,
        userProvidedAmountsOnly: true,
        preservesScenarioOrder: true,
        changesCandidateOrdering: false,
        recommendation: false,
        ranking: false,
        score: false,
        suggestedAmount: false,
        targetWeight: false,
        targetPrice: false,
        tradeDirection: false,
        createsOrder: false,
        createsTrade: false,
        callsBroker: false,
        mutatesOfficialPortfolio: false,
        productionWrite: false
    )
}

public struct AnnualPortfolioLabData: Codable, Equatable, Sendable {
    public let target: AnnualPortfolioLabTarget
    public let sourceIdentity: AnnualPortfolioLabSourceIdentity
    public let portfolio: PortfolioDecisionContextEnvelope
    public let dimensions: AnnualPortfolioLabDimensions
    public let current: AnnualPortfolioLabCurrent
    public let scenarios: [AnnualPortfolioLabScenario]
    public let quant: AnnualPortfolioLabQuantView
}

public struct AnnualPortfolioLabTarget: Codable, Equatable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let membershipState: String
    public let market: String
    public let code: String
    public let symbol: String
}

public struct AnnualPortfolioLabSourceIdentity: Codable, Equatable, Sendable {
    public let accountScopeId: String
    public let portfolioContextId: String
    public let portfolioSnapshotId: String
    public let portfolioAsOf: String
    public let decisionContextId: String
    public let decisionContextHash: String
    public let quote: AnnualPortfolioLabQuoteIdentity
}

public struct AnnualPortfolioLabQuoteIdentity: Codable, Equatable, Sendable {
    public let snapshotId: String
    public let symbol: String
    public let currency: String
    public let price: Double
    public let quoteTime: String
    public let fetchedAt: String
    public let source: String
}

public struct AnnualPortfolioLabDimensions: Codable, Equatable, Sendable {
    public let positions: [AnnualPortfolioLabPositionDimension]
    public let candidate: AnnualPortfolioLabCandidateDimension
    public let currency: AnnualPortfolioLabCurrencyDimension
}

public struct AnnualPortfolioLabPositionDimension: Codable, Equatable, Sendable {
    public let sourceIndex: Int
    public let symbol: String
    public let name: String?
    public let currency: String
    public let marketValue: Double
    public let marketWeight: Double
    public let sector: AnnualPortfolioLabSectorGap
}

public struct AnnualPortfolioLabCandidateDimension: Codable, Equatable, Sendable {
    public let symbol: String
    public let name: String?
    public let currency: String
    public let currentlyHeld: Bool
    public let sector: AnnualPortfolioLabSectorGap
}

public struct AnnualPortfolioLabSectorGap: Codable, Equatable, Sendable {
    public let status: String
    public let value: String?
    public let limitation: String
}

public struct AnnualPortfolioLabCurrencyDimension: Codable, Equatable, Sendable {
    public let status: String
    public let currencies: [String]
    public let marketValueByCurrency: [AnnualPortfolioLabCurrencyValue]
}

public struct AnnualPortfolioLabCurrencyValue: Codable, Equatable, Sendable {
    public let currency: String
    public let marketValue: Double
    public let weight: Double
}

public struct AnnualPortfolioHistoricalMetrics: Codable, Equatable, Sendable {
    public let status: String
    public let annualizedVolatility: Double?
    public let historicalStressLossMagnitude: Double?
    public let historicalStressDate: String?
    public let historicalTailLossMagnitude: Double?
    public let candidateRiskContribution: Double?
    public let limitation: String
}

public struct AnnualPortfolioLabCurrent: Codable, Equatable, Sendable {
    public let totalMarketValue: Double
    public let candidateMarketValue: Double
    public let candidateWeight: Double
    public let largestPositionWeight: Double
    public let hhi: Double
    public let historical: AnnualPortfolioHistoricalMetrics
}

public struct AnnualPortfolioLabScenario: Codable, Equatable, Sendable {
    public let sourceIndex: Int
    public let scenarioId: String
    public let hypotheticalAmount: Double
    public let riskImpact: PortfolioRiskImpactEnvelope
    public let comparison: AnnualPortfolioLabScenarioComparison
    public let historical: AnnualPortfolioLabScenarioHistorical
}

public struct AnnualPortfolioLabScenarioComparison: Codable, Equatable, Sendable {
    public let candidateWeightChange: Double
    public let largestPositionWeightChange: Double
    public let hhiChange: Double
    public let otherPositionWeightChanges: [AnnualPortfolioLabPositionWeightChange]
    public let fundingSourceStatus: String
    public let cashStatus: String
    public let opportunityCostLimitation: String
}

public struct AnnualPortfolioLabPositionWeightChange: Codable, Equatable, Sendable {
    public let symbol: String
    public let currentWeight: Double
    public let scenarioWeight: Double
    public let weightChange: Double
}

public struct AnnualPortfolioLabScenarioHistorical: Codable, Equatable, Sendable {
    public let status: String
    public let annualizedVolatility: Double?
    public let historicalStressLossMagnitude: Double?
    public let historicalStressDate: String?
    public let historicalTailLossMagnitude: Double?
    public let candidateRiskContribution: Double?
    public let limitation: String
    public let annualizedVolatilityChange: Double?
    public let historicalStressLossChange: Double?
    public let historicalTailLossChange: Double?
    public let candidateRiskContributionChange: Double?

    public var base: AnnualPortfolioHistoricalMetrics {
        .init(
            status: status,
            annualizedVolatility: annualizedVolatility,
            historicalStressLossMagnitude: historicalStressLossMagnitude,
            historicalStressDate: historicalStressDate,
            historicalTailLossMagnitude: historicalTailLossMagnitude,
            candidateRiskContribution: candidateRiskContribution,
            limitation: limitation
        )
    }
}

public struct AnnualPortfolioLabQuantView: Codable, Equatable, Sendable {
    public let evidenceStatus: String
    public let evidence: AnnualPortfolioLabQuantEvidence?
    public let coverage: AnnualPortfolioLabQuantCoverage
    public let correlations: AnnualPortfolioLabCorrelations
    public let candidateLiquidity: AnnualPortfolioLabLiquidity
    public let limitations: [String]
}

public struct AnnualPortfolioLabQuantCoverage: Codable, Equatable, Sendable {
    public let status: String
    public let requiredSymbols: [String]
    public let coveredSymbols: [String]
    public let missingSymbols: [String]
    public let extraEvidenceSymbols: [String]
}

public struct AnnualPortfolioLabCorrelations: Codable, Equatable, Sendable {
    public let status: String
    public let observationStartDate: String?
    public let observationEndDate: String?
    public let observationCount: Int?
    public let stability: String
    public let candidateToPositions: [AnnualPortfolioLabCorrelation]
    public let limitation: String
}

public struct AnnualPortfolioLabCorrelation: Codable, Equatable, Sendable {
    public let symbol: String
    public let correlation: Double?
}

public struct AnnualPortfolioLabLiquidity: Codable, Equatable, Sendable {
    public let status: String
    public let symbol: String
    public let observationCount: Int?
    public let medianDailyVolume: Double?
    public let medianDailyTurnover: Double?
    public let minimumDailyVolume: Double?
    public let minimumDailyTurnover: Double?
    public let zeroVolumeObservationCount: Int?
    public let boardLot: Int?
    public let feeCurrency: String?
    public let nonZeroCosts: Bool?
    public let fees: AnnualPortfolioLabFees?
    public let limitation: String
}

public struct AnnualPortfolioLabQuantEvidence: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-17.quant-portfolio-lab-evidence.v1"
    public static let requiredFeePolicyVersion = "hk-cash-equity-fees.2026-09-13.v2"
    public static let requiredFeePolicySha256 = "9222fe29d372ca938cce8e02108cdd98f6328254b9f28a51eb3ab67de828061d"

    public let schemaVersion: String
    public let generatedAt: String
    public let feePolicyVersion: String
    public let feePolicySha256: String
    public let executionCalendar: AnnualPortfolioLabExecutionCalendar
    public let source: AnnualPortfolioLabQuantSource
    public let method: AnnualPortfolioLabQuantMethod
    public let stability: AnnualPortfolioLabQuantStability
    public let dailyReturns: [AnnualPortfolioLabDailyReturn]
    public let series: [AnnualPortfolioLabQuantSeries]
    public let covariance: [AnnualPortfolioLabCovariance]
    public let executionEvidence: AnnualPortfolioLabExecutionEvidence
    public let codeIdentity: AnnualPortfolioLabCodeIdentity
    public let authority: AnnualPortfolioLabQuantAuthority
    public let limitations: [String]
    public let safety: AnnualPortfolioLabQuantSafety
    public let evidenceId: String
}

public struct AnnualPortfolioLabExecutionCalendar: Codable, Equatable, Sendable {
    public let timing: String
    public let calendarCompleteness: String
}

public struct AnnualPortfolioLabQuantSource: Codable, Equatable, Sendable {
    public let snapshotId: String
    public let snapshotHash: String
    public let dataHash: String
    public let sourceClassification: String
    public let adjustment: String
    public let dataCutoff: String
    public let observationStartDate: String
    public let observationEndDate: String
    public let hkConnectUniverse: CandidateDiscoveryUniverse?
    public let universe: [AnnualPortfolioLabQuantUniverseItem]
    public let sourceIdentity: AnnualPortfolioLabQuantSourceIdentity
}

public struct AnnualPortfolioLabQuantUniverseItem: Codable, Equatable, Sendable {
    public let market: String
    public let code: String
    public let symbol: String
    public let name: String
    public let boardLot: Int
}

public struct AnnualPortfolioLabQuantSourceIdentity: Codable, Equatable, Sendable {
    public let source: String
    public let classification: String
    public let provenance: String
    public let authority: String
    public let asOf: String
    public let fetchedAt: String
    public let externalFetch: Bool
    public let sourceKind: String
    public let sourcePath: String
    public let sourceHash: String
    public let authorizationId: String?
}

public struct AnnualPortfolioLabQuantMethod: Codable, Equatable, Sendable {
    public let returnMethod: String
    public let annualizationDays: Int
    public let tailConfidence: Double
    public let covarianceEstimator: String
    public let observationAlignment: String
    public let observationCount: Int
    public let commonTradingDates: [String]
}

public struct AnnualPortfolioLabQuantStability: Codable, Equatable, Sendable {
    public let status: String
    public let minimumStableObservationCount: Int
    public let observationCount: Int
    public let limitation: String
}

public struct AnnualPortfolioLabDailyReturn: Codable, Equatable, Sendable {
    public let tradeDate: String
    public let values: [AnnualPortfolioLabDailyReturnValue]
}

public struct AnnualPortfolioLabDailyReturnValue: Codable, Equatable, Sendable {
    public let symbol: String
    public let previousClose: Double
    public let close: Double
    public let volume: Double
    public let turnover: Double
    public let value: Double
}

public struct AnnualPortfolioLabQuantSeries: Codable, Equatable, Sendable {
    public let symbol: String
    public let boardLot: Int
    public let annualizedVolatility: Double
    public let worstDailyReturn: Double
    public let historicalTailLossMagnitude: Double
    public let liquidity: AnnualPortfolioLabQuantLiquiditySeries
}

public struct AnnualPortfolioLabQuantLiquiditySeries: Codable, Equatable, Sendable {
    public let medianDailyVolume: Double
    public let medianDailyTurnover: Double
    public let minimumDailyVolume: Double
    public let minimumDailyTurnover: Double
    public let zeroVolumeObservationCount: Int
}

public struct AnnualPortfolioLabCovariance: Codable, Equatable, Sendable {
    public let leftSymbol: String
    public let rightSymbol: String
    public let annualizedCovariance: Double
    public let correlation: Double?
}

public struct AnnualPortfolioLabExecutionEvidence: Codable, Equatable, Sendable {
    public let boardLots: [AnnualPortfolioLabBoardLot]
    public let feeCurrency: String
    public let nonZeroCosts: Bool
    public let fees: AnnualPortfolioLabFees
    public let signalTiming: String
    public let earliestExecution: String
    public let allowsSameBarExecution: Bool
    public let allowsMargin: Bool
}

public struct AnnualPortfolioLabBoardLot: Codable, Equatable, Sendable {
    public let symbol: String
    public let boardLot: Int
}

public struct AnnualPortfolioLabFees: Codable, Equatable, Sendable {
    public let commissionRate: Double
    public let minCommission: Double
    public let platformFee: Double
    public let stampDutyRate: Double
    public let tradingFeeRate: Double
    public let transactionLevyRate: Double
}

public struct AnnualPortfolioLabCodeIdentity: Codable, Equatable, Sendable {
    public let scriptPath: String
    public let scriptHash: String
    public let configPath: String
    public let configHash: String
}

public struct AnnualPortfolioLabQuantAuthority: Codable, Equatable, Sendable {
    public let researchOnly: Bool
    public let advisoryOnly: Bool
    public let currentPortfolioFact: Bool
    public let brokerReconciliation: Bool
    public let accountingAuthority: Bool
    public let recommendation: Bool
    public let ranking: Bool
    public let score: Bool
    public let allocation: Bool
    public let sizing: Bool
    public let targetPrice: Bool
    public let tradeDirection: Bool
    public let orderTradeFillAuthority: Bool
    public let cashFeePositionMutation: Bool
    public let brokerWrite: Bool
    public let productionWrite: Bool
}

public struct AnnualPortfolioLabQuantSafety: Codable, Equatable, Sendable {
    public let sendsLiveNetworkRequests: Bool
    public let writesDatabase: Bool
    public let callsBroker: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let mutatesOfficialPortfolio: Bool
}
