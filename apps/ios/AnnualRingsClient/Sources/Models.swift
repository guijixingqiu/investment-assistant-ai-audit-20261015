import Foundation

// MARK: - Market & Quote Models
public struct StockQuote: Identifiable, Codable {
    public var id: String { symbol }
    public let symbol: String
    public let code: String
    public let market: String
    public let name: String
    public let price: Double
    public let change: Double?
    public let changePercent: Double?
    public let previousClose: Double?
    public let quoteTime: String
    public let freshness: String
    public let provenance: String
    public let message: String?
    
    public var isStale: Bool { freshness == "stale" }
    public var isPositive: Bool { (change ?? changePercent ?? 0) >= 0 }
}

public struct IndexQuote: Identifiable, Codable {
    public var id: String { symbol }
    public let symbol: String
    public let name: String
    public let last: Double
    public let previousClose: Double
    public let changePercent: Double
    public let turnover: Double
    public let advancers: Int
    public let decliners: Int
    
    public var isPositive: Bool { changePercent >= 0 }
}

public struct SectorInfo: Identifiable, Codable {
    public var id: String { code }
    public let code: String
    public let name: String
    public let changePercent: Double
    public let turnover: Double
    public let advancers: Int
    public let decliners: Int
}

public struct TemplateMarketEnvironmentData {
    public let asOf: String
    public let marketState: String
    public let indices: [IndexQuote]
    public let leaders: [SectorInfo]
    public let laggards: [SectorInfo]
    public let advancersCount: Int
    public let declinersCount: Int
    public let advanceRatio: Double
    public let unchangedCount: Int
    public let hsiAmplitudePercent: Double
    public let sectorDispersionPercent: Double
    public var breadthLabel: String {
        switch riskSignal {
        case "broad_strength": "广度偏强"
        case "broad_weakness": "广度偏弱"
        case "mixed": "涨跌分化"
        default: "未返回"
        }
    }
    public let stockNetFlow: Double?
    public let riskSignal: String?
    public let unknowns: [String]
}

public struct DiscoveryCandidate: Identifiable, Codable {
    public var id: String { symbol }
    public let symbol: String
    public let name: String
    public let industry: String
    public let price: Double
    public let changePercent: Double
    public let why: String
}

public struct OfficialAnnouncement: Identifiable, Codable {
    public let id: String
    public let symbol: String
    public let title: String
    public let publishedDate: String
    public let category: String
    public let documentUrl: String
    public let why: String
}

// MARK: - Core 5-Question Decision Dossier
public struct InvestmentDecisionDossier {
    public let symbol: String
    public let name: String
    
    // 1. 当前判断 (Current Stance)
    public let judgmentTitle: String
    public let stance: String             // "重点关注 / 观察区间"
    public let confidence: String         // "高 (78%)"
    public let horizon: String            // "3-6 个月"
    public let thesisSummary: String      // 核心投资假设
    
    // 2. 发生了什么 (What Happened)
    public let priceNarrative: String
    public let latestCatalysts: [String]  // 近期催化事实
    public let operatingHighlights: [String]
    
    // 3. 估值与价格条件 (Valuation & Price Anchors)
    public let currentPrice: Double?
    public let safetyMarginPrice: Double?
    public let targetPriceBase: Double?
    public let targetPriceBull: Double?
    public let peTtm: Double?
    public let pePercentile: Double?
    public let conditionTriggers: [String]
    
    // 4. 最大风险与失效条件 (Key Risks & Invalidation)
    public let invalidationConditions: [String] // 核心证伪条件
    public let maxDrawdownEst: String?
    public let monitoringMetrics: [String]      // 持续跟踪指标
    
    // 5. 下一步行动 (Next Action)
    public let nextActionTitle: String
    public let nextActionDetail: String
    public let actionBadge: String
    
    // 依据与审计记录 (Audit & Provenance)
    public let sourceProvider: String
    public let dataCutoff: String
    public let evidenceHash: String?
    public let deepResearchStatus: String
    public let provenance: DataProvenance
}

// MARK: - Real Technical Analysis Models (From Backend /daily-bars & /weinstein)
public struct TechnicalIndicatorSnapshot: Identifiable {
    public var id: String { session }
    public let session: String
    public let ma20: Double
    public let ma60: Double
    public let rsi14: Double
    public let macdLine: Double
    public let macdSignal: Double
    public let macdHistogram: Double
    public let bollingerMiddle: Double
    public let bollingerUpper: Double
    public let bollingerLower: Double
    public let close: Double
    public let volume: Double
    public let dataCutoffAt: String
}

public struct WeinsteinAnalysisData {
    public let symbol: String
    public let status: String
    public let marketStage: String
    public let stockStage: String
    public let ma30wDirection: String
    public let entryState: String
    public let summary: String
    public let keyObservation: String
    public let supportLevel: String
    public let resistanceLevel: String
}

// MARK: - Candidate Membership & Lifecycle
public struct RadarFactItem: Identifiable {
    public var id: String { title }
    public let title: String
    public let status: String
    public let isReady: Bool
    
    public init(title: String, status: String, isReady: Bool) {
        self.title = title
        self.status = status
        self.isReady = isReady
    }
}

public struct CandidateMembership: Identifiable {
    public var id: String { symbol }
    public let symbol: String
    public let name: String
    public let industry: String
    public let state: String // "重点跟踪", "观察池", "已归档"
    public let stage: String // "Stage 2 突破", "Stage 1 筑底", "Stage 2 震荡"
    public let nextReviewOn: String?
    public let reportCount: Int?
    public let completenessScore: Int?
    public let currentDossier: InvestmentDecisionDossier
    public let currentRing: String
    public let report: TwoLayerReport?
    public let valuationScenarios: [ValuationScenario]
    public let impliedExpectation: String?
    public let safetyMarginFloor: String?
    public let benchmarkFairValue: String?
    public let evidenceFacts: [EvidenceFactItem]
    public var reviewLearnings: [ReviewLearningItem]
    public let radarItems: [RadarFactItem]
    
    public init(
        symbol: String,
        name: String,
        industry: String,
        state: String,
        stage: String,
        nextReviewOn: String?,
        reportCount: Int?,
        completenessScore: Int?,
        currentDossier: InvestmentDecisionDossier,
        currentRing: String,
        report: TwoLayerReport?,
        valuationScenarios: [ValuationScenario],
        impliedExpectation: String?,
        safetyMarginFloor: String?,
        benchmarkFairValue: String?,
        evidenceFacts: [EvidenceFactItem],
        reviewLearnings: [ReviewLearningItem],
        radarItems: [RadarFactItem]
    ) {
        self.symbol = symbol
        self.name = name
        self.industry = industry
        self.state = state
        self.stage = stage
        self.nextReviewOn = nextReviewOn
        self.reportCount = reportCount
        self.completenessScore = completenessScore
        self.currentDossier = currentDossier
        self.currentRing = currentRing
        self.report = report
        self.valuationScenarios = valuationScenarios
        self.impliedExpectation = impliedExpectation
        self.safetyMarginFloor = safetyMarginFloor
        self.benchmarkFairValue = benchmarkFairValue
        self.evidenceFacts = evidenceFacts
        self.reviewLearnings = reviewLearnings
        self.radarItems = radarItems
    }
}

// MARK: - Two-Layer Research Report
public struct TwoLayerReport {
    public let version: String
    public let asOf: String
    public let status: String // "当前有效", "已归档"
    
    // Advice Layer (建议层)
    public let conclusion: String
    public let actionIntent: String
    public let targetPriceRange: String
    public let catalysts: [String]
    public let counterevidence: [String]
    
    // Research Layer (研究层)
    public let businessModelSummary: String
    public let moatSummary: String
    public let financialSummary: String
    
    public init(version: String, asOf: String, status: String, conclusion: String, actionIntent: String, targetPriceRange: String, catalysts: [String], counterevidence: [String], businessModelSummary: String, moatSummary: String, financialSummary: String) {
        self.version = version
        self.asOf = asOf
        self.status = status
        self.conclusion = conclusion
        self.actionIntent = actionIntent
        self.targetPriceRange = targetPriceRange
        self.catalysts = catalysts
        self.counterevidence = counterevidence
        self.businessModelSummary = businessModelSummary
        self.moatSummary = moatSummary
        self.financialSummary = financialSummary
    }
}

// MARK: - Valuation Scenario Model
public struct ValuationScenario: Identifiable {
    public var id: String { name }
    public let name: String // "悲观情景 (Bear)", "基准情景 (Base)", "乐观情景 (Bull)"
    public let targetPrice: Double
    public let changePercent: Double?
    public let probability: String
    public let growthAssumption: String
    public let marginAssumption: String
    public let wacc: String
    public let currency: String
    public let rationale: String
    
    public init(name: String, targetPrice: Double, changePercent: Double?, probability: String, growthAssumption: String, marginAssumption: String, wacc: String, rationale: String, currency: String = "HKD") {
        self.currency = currency
        self.name = name
        self.targetPrice = targetPrice
        self.changePercent = changePercent
        self.probability = probability
        self.growthAssumption = growthAssumption
        self.marginAssumption = marginAssumption
        self.wacc = wacc
        self.rationale = rationale
    }
}

// MARK: - CAS Evidence Fact Item
public struct EvidenceFactItem: Identifiable {
    public let id: String
    public let documentId: String
    public let pageTextSha256: String
    public let sourceTitle: String
    public let sourceType: String // "HKEX 披露易", "中期财报", "内部监测"
    public let publishDate: String
    public let pageNumber: Int
    public let quoteSnippet: String
    public let sha256: String
    public let verifiedState: String // "已核验", "待人工复核"
    
    public init(id: String, documentId: String, pageTextSha256: String, sourceTitle: String, sourceType: String, publishDate: String, pageNumber: Int, quoteSnippet: String, sha256: String, verifiedState: String) {
        self.id = id
        self.documentId = documentId
        self.pageTextSha256 = pageTextSha256
        self.sourceTitle = sourceTitle
        self.sourceType = sourceType
        self.publishDate = publishDate
        self.pageNumber = pageNumber
        self.quoteSnippet = quoteSnippet
        self.sha256 = sha256
        self.verifiedState = verifiedState
    }
}

// MARK: - Review Learning Item
public struct ReviewLearningItem: Identifiable {
    public let id: String
    public let version: String
    public let reviewDate: String
    public let decisionType: String
    public let outcome: String
    public let lessonLearned: String
    
    public init(id: String, version: String, reviewDate: String, decisionType: String, outcome: String, lessonLearned: String) {
        self.id = id
        self.version = version
        self.reviewDate = reviewDate
        self.decisionType = decisionType
        self.outcome = outcome
        self.lessonLearned = lessonLearned
    }
}

extension InvestmentDecisionDossier: Identifiable {
    public var id: String { symbol }
}

// MARK: - Signed Decision Record
