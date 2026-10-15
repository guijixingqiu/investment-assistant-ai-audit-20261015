import Foundation
import CryptoKit

public struct OperatingPeriod: Codable, Equatable, Sendable {
    public var kind: String; public var type: String; public var start: String?; public var end: String
}
public struct OperatingTextBinding: Codable, Equatable, Sendable { public let documentId: String; public let pageNumber: Int; public let pageTextSha256: String; public let sourceExcerpt: String; public let rawValueText: String }
public struct OperatingOwnerStructureConfirmation: Codable, Equatable, Sendable { public let confirmedFields: [String]; public let confirmedBy: String; public let confirmedAt: String }
public struct OperatingVerification: Codable, Equatable, Sendable {
    public let ownerConfirmation: OperatingOwnerStructureConfirmation?
    public let valueVerification: String; public let structureVerification: String; public let checks: [String: Bool]; public let taxonomyConfirmedBy: String?
}
public struct OperatingStructureBinding: Codable, Equatable, Sendable { public let structureExcerpt: String?; public let rowLabelText: String; public let columnHeaderText: String; public let unitHeaderText: String; public let scopeText: String?; public let ownerScopeConfirmed: Bool; public let taxonomyConfirmedBy: String? }
public struct OperatingSource: Codable, Equatable, Sendable {
    public var capturedSourceUrl:String? = nil; public var ownerSuppliedReferenceUrl:String? = nil
    public var verification: OperatingVerification? = nil
    public var structureBinding: OperatingStructureBinding? = nil
    public let textBinding: OperatingTextBinding?; public let provenanceKind: String?
    public let materialId: String; public let revision: Int; public let contentFingerprint: String
    public let sourceClassification: String; public let verificationStatus: String; public let assertionVerificationStatus: String
    public let sourceUrl: String; public let publishedAt: String; public let cutoffAt: String; public let validUntil: String
    public let documentId: String?; public let pageNumber: Int?; public let pageTextSha256: String?; public let documentPdfSha256: String?
    public let snapshotCitation: ResearchSnapshotCitation?; public let snapshotOriginal: ResearchSnapshotOriginal?
    public let snapshotTextBinding: OperatingSnapshotTextBinding?
    public var hasValidCitation: Bool {
        if let snapshotCitation, let snapshotOriginal {
            return documentId == nil && pageNumber == nil && pageTextSha256 == nil && documentPdfSha256 == nil
                && textBinding == nil && snapshotCitation.isValid && snapshotOriginal.isValid
                && snapshotTextBinding?.snapshotId == snapshotCitation.snapshotId
                && snapshotTextBinding?.textSha256 == snapshotCitation.textSha256
                && snapshotTextBinding?.excerptSha256 == snapshotCitation.excerptSha256
        }
        return snapshotCitation == nil && snapshotOriginal == nil && snapshotTextBinding == nil
            && documentId.map(researchDocumentIsPositiveIntegerString) == true
            && (pageNumber ?? 0) > 0
            && pageTextSha256.map(researchDocumentIsSha256) == true
            && documentPdfSha256.map(researchDocumentIsSha256) == true
    }
}
public struct OperatingSnapshotTextBinding: Codable, Equatable, Sendable {
    public let snapshotId: String; public let textSha256: String; public let startUtf16: Int
    public let endUtf16: Int; public let excerptSha256: String; public let sourceExcerpt: String; public let rawValueText: String
}
public struct OperatingFactMix: Codable, Equatable, Sendable { public let dimension: String; public let dimensionValue: String; public let parentScope: String; public let parentNode: String?; public let overlapPolicy: String? }
public struct OperatingFact: Codable, Equatable, Sendable, Identifiable {
    public var identity:OperatingJSON? = nil; public var assertionIdentity:String? = nil; public var evidenceValidity:String? = nil; public var researchRecency:String? = nil
    public var mix: OperatingFactMix? = nil
    public let id: String; public let semanticType: String; public let derivationMethod: String
    public let symbol: String; public let membershipId: String; public let membershipVersion: Int
    public let metric: String; public let value: Double; public let unit: String; public let unitScale: Double; public let currency: String?
    public let period: OperatingPeriod; public let accountingScope: String; public let businessScope: String; public let measurementBasis: String; public let category: String
    public let comparability: String; public let comparabilityReason: String?; public let limitation: String; public let source: OperatingSource; public let revision: Int
    public var materialId: String { source.materialId }
    public var text: String { "\(category == "guidance" ? "GUIDANCE · 管理层指引 · " : "")\(period.start ?? period.end) 至 \(period.end) · \(mix.map { $0.dimensionValue + " 销量" } ?? operatingMetricTitle(metric))：\(operatingValue(value * unitScale, unit: unit, currency: currency))" }
}
public struct OperatingNode: Codable, Equatable, Sendable {
    public let accountingScope: String; public let businessScope: String; public let measurementBasis: String
    public let metric: String; public let semanticType: String; public let value: Double?; public let unit: String; public let currency: String?
    public let period: OperatingPeriod; public let source: [OperatingSource]; public let inputs: [String]; public let calculation: String?; public let derivationMethod: String
    public let comparability: String; public let limitation: String
}
public struct OperatingProposition: Codable, Equatable, Sendable { public var metrics: [String]; public var periodType: String; public var direction: String; public var mixNode: String? = nil
    public init(metrics: [String], periodType: String, direction: String, mixNode: String? = nil) { self.metrics = metrics; self.periodType = periodType; self.direction = direction; self.mixNode = mixNode }
}
public struct OperatingThesisBinding: Codable, Equatable, Sendable {
    public var proposition: OperatingProposition? = nil
    public var thesisDimension: String? = nil
    public var reportId: String; public var reportVersion: Int; public var reportFingerprint: String; public var conditionIndex: Int; public var conditionText: String
}
public struct OperatingAssumptionRationale: Codable, Equatable, Sendable {
    public var reason: String; public var basedOnFactIds: [String]; public var confidence: String
    public var basedOnGuidanceIds: [String]? = nil
    public init(reason: String, basedOnFactIds: [String], confidence: String) { self.reason = reason; self.basedOnFactIds = basedOnFactIds; self.confidence = confidence }
}
public struct OperatingScenarioInput: Codable, Equatable, Sendable {
    public var rationale: OperatingAssumptionRationale? = nil
    public var unit: String
    public var value: Double?; public var origin: String; public var sourceValueId: String?; public var note: String
    enum CodingKeys: String, CodingKey { case unit, value, origin, sourceValueId, note, rationale }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(rationale, forKey: .rationale)
        try c.encode(unit, forKey: .unit); try c.encode(value, forKey: .value); try c.encode(origin, forKey: .origin); try c.encode(sourceValueId, forKey: .sourceValueId); try c.encode(note, forKey: .note)
    }
}
public struct OperatingScenarioBasis: Codable, Equatable, Sendable {
    public var accountingScope: String; public var businessScope: String; public var salesMeasurementBasis: String
}
public struct OperatingScenarioDraft: Codable, Equatable, Sendable {
    public var basis: OperatingScenarioBasis?
    public var scenarioPeriodType: String? = nil
    public var revenueComposition: OperatingRevenueComposition? = nil
    enum CodingKeys: String, CodingKey { case name, period, currency, inputs, basis, scenarioPeriodType, revenueComposition }
    public func encode(to encoder: Encoder) throws { var c = encoder.container(keyedBy: CodingKeys.self); try c.encode(name, forKey: .name); try c.encode(period, forKey: .period); try c.encode(currency, forKey: .currency); try c.encode(inputs, forKey: .inputs); try c.encode(basis, forKey: .basis); try c.encodeIfPresent(scenarioPeriodType, forKey: .scenarioPeriodType); try c.encodeIfPresent(revenueComposition, forKey: .revenueComposition) }
    public var name: String; public var period: OperatingPeriod; public var currency: String; public var inputs: [String: OperatingScenarioInput]
}
public struct OperatingRevenueComposition: Codable, Equatable, Sendable { public var otherRevenue: OperatingScenarioInput }
public struct OperatingFX: Codable, Equatable, Sendable {
    public var from: String; public var to: String; public var rate: Double; public var asOf: String; public var note: String; public var ownerConfirmed: Bool
}
public struct OperatingQuestionDraft: Codable, Equatable, Sendable { public var requirement:OperatingJSON? = nil; public let questionId: String; public let question: String; public let targetMetric: String; public let period: OperatingPeriod; public let businessScope: String; public let measurementBasis: String }
public struct OperatingResearchModel: Codable, Equatable, Sendable {
    public var peSensitivityValues: [Double]? = nil
    public var thesisOwnerAction: OperatingJSON? = nil
    public var researchQuestionDrafts: [OperatingQuestionDraft]? = nil
    public var thesisTests: [OperatingThesisTest]? = nil
    public var thesisEvidencePlan: OperatingThesisEvidencePlan? = nil
    public var thesisRevision: OperatingThesisRevision? = nil
    public var sensitivity: OperatingSensitivityRange? = nil
    public var version: Int; public var thesisBinding: OperatingThesisBinding?; public var scenarios: [OperatingScenarioDraft]
    public var sharesValueId: String?; public var sharesReferenceConfirmed: Bool; public var fx: OperatingFX?
    public var sharesClass: String? = nil
    enum CodingKeys: String, CodingKey { case version, thesisBinding, scenarios, sharesValueId, sharesClass, sharesReferenceConfirmed, fx, thesisRevision, thesisOwnerAction, sensitivity, peSensitivityValues, thesisTests, thesisEvidencePlan, researchQuestionDrafts }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(researchQuestionDrafts, forKey: .researchQuestionDrafts)
        try c.encodeIfPresent(thesisTests, forKey: .thesisTests)
        try c.encodeIfPresent(thesisEvidencePlan, forKey: .thesisEvidencePlan)
        try c.encodeIfPresent(sensitivity, forKey: .sensitivity)
        try c.encodeIfPresent(thesisRevision, forKey: .thesisRevision)
        try c.encodeIfPresent(thesisOwnerAction, forKey: .thesisOwnerAction)
        try c.encodeIfPresent(peSensitivityValues, forKey: .peSensitivityValues)
        try c.encode(version, forKey: .version); try c.encode(thesisBinding, forKey: .thesisBinding); try c.encode(scenarios, forKey: .scenarios)
        try c.encode(sharesValueId, forKey: .sharesValueId); try c.encodeIfPresent(sharesClass, forKey: .sharesClass); try c.encode(sharesReferenceConfirmed, forKey: .sharesReferenceConfirmed); try c.encode(fx, forKey: .fx)
    }
}
public struct OperatingCalculation: Codable, Equatable, Sendable {
    public let metric: String; public let semanticType: String; public let derivationMethod: String; public let formula: String; public let inputs: [String]; public let value: Double
}
public struct OperatingScenarioResult: Codable, Equatable, Sendable {
    public let name: String; public let semanticType: String; public let status: String; public let currency: String; public let period: OperatingPeriod
    public let inputs: [String: OperatingScenarioInput]; public let revenue: Double?; public let normalizedProfit: Double?; public let equityValue: Double?; public let shares: Double?; public let perShareValue: Double?; public let perShareCurrency: String?
    public let calculations: [OperatingCalculation]; public let missing: [String]
}
public struct OperatingMarketObservation: Codable, Equatable, Sendable {
    public let symbol: String; public let price: Double; public let currency: String; public let asOf: String; public let fetchedAt: String; public let source: String; public let fresh: Bool
}
public struct OperatingReverseValuation: Codable, Equatable, Sendable {
    public struct Implied: Codable, Equatable, Sendable { public let semanticType: String; public let derivationMethod: String; public let assumedPE: Double; public let marketCap: Double; public let marketCapCurrency: String?; public let normalizedEarnings: Double; public let currency: String; public let formula: String }
    public struct OwnerView: Codable, Equatable, Sendable { public let normalizedEarnings: Double; public let currency: String }
    public let status: String; public let observed: OperatingMarketObservation?; public let implied: Implied?; public let ownerView: OwnerView?; public let gap: Double?; public let reasons: [String]; public let limitation: String
}
public struct OperatingProfitBridge: Codable, Equatable, Sendable {
    public struct Row: Codable, Equatable, Sendable { public let metric: String; public let current: OperatingNode; public let previous: OperatingNode; public let change: Double?; public let changeRatio: Double?; public let comparison: String; public let reason: String? }
    public struct Quality: Codable, Equatable, Sendable { public let topic: String; public let assessment: String; public let text: String; public let inputs: [String] }
    public let period: OperatingPeriod; public let previousPeriod: OperatingPeriod; public let rows: [Row]; public let quality: [Quality]
}
public struct OperatingAnchorSelection: Codable, Equatable, Sendable { public let status:String; public let selectedFactId:String?; public let preferredMeasurementBasis:String; public let metric:String; public let period:String?; public let reason:String; public let availableSeries:[OperatingAnchorAlternative]; public let conflictingAssertionIds:[String] }
public struct OperatingAnchorAlternative: Codable, Equatable, Sendable { public let measurementBasis:String; public let businessScope:String; public let period:String }
public struct ResearchOperatingReasoning: Codable, Equatable, Sendable {
    public var anchorSelection:OperatingAnchorSelection? = nil
    public var evidenceSeries:[OperatingEvidenceSeries]? = nil
    public var assertionHistory:[OperatingFact]? = nil
    public struct Statement: Codable, Equatable, Sendable { public let semanticType: String; public let text: String }
    public struct Transmission: Codable, Equatable, Sendable { public let semanticType: String; public let text: String; public let stoppedAt: String?; public let profitGrowthConclusionAllowed: Bool; public let steps: [OperatingNode] }
    public struct Impact: Codable, Equatable, Sendable { public let reportId: String; public let reportVersion: Int; public let reportFingerprint: String; public let conditionIndex: Int; public let conditionText: String; public let hypothesis: String; public let assessment: String; public let explanation: String; public let mutation: String }
    public struct Question: Codable, Equatable, Sendable { public let priority: Int; public let question: String; public let reason: String }
    public let kind: String; public let generationMethod: String; public let actorId: String; public let membershipId: String; public let membershipVersion: Int; public let symbol: String
    public let sensitivity: [OperatingSensitivityResult]?
    public let conditionalRequirements: OperatingConditionalRequirements?
    public let calculation: OperatingCalculationProof?
    public var researchQuestions: [OperatingResearchQuestion]? = nil
    public var factCandidates: [OperatingFactCandidate]? = nil
    public let productMix: [OperatingProductMix]?
    public let thesisUpdate: OperatingThesisUpdate?
    public let guidance: [OperatingGuidance]?
    public let gaps: [OperatingGap]?
    public let researchUpdate: OperatingResearchNotice?
    public let growthFactId: String?; public let contextId: String?; public let inputFingerprint: String; public let facts: [OperatingFact]; public let fact: OperatingFact
    public let operatingMeaning: Statement; public let profitTransmission: Transmission; public let thesisImpact: Impact?; public let thesisOptions: [OperatingThesisBinding]
    public let unknown: Statement; public let nextResearchQuestion: String; public let questions: [Question]
    public let sharesReference: OperatingNode?; public let profitBridge: OperatingProfitBridge?; public let model: OperatingResearchModel; public let scenarios: [OperatingScenarioResult]; public let reverseValuation: OperatingReverseValuation

    public func matches(_ workspace: FrozenResearchEvidenceWorkspace, now: Date = Date()) -> Bool {
        guard let data = workspace.data, workspace.status == "available", workspace.requestedActorId == actorId,
              workspace.membershipId == membershipId, workspace.requestedSymbol == symbol,
              data.target.membershipId == membershipId, data.target.membershipVersion == membershipVersion,
              data.target.symbol == symbol, data.target.membershipState == "tracked",
              kind == "operating_valuation_draft", generationMethod == "deterministic_evidence_framework",
              researchDocumentIsSha256(inputFingerprint), !facts.isEmpty,
              calculation?.version == "operating-calculation-v1", calculation?.asOf == workspace.generatedAt,
              calculation.map({ researchDocumentIsSha256($0.fingerprint) }) == true,
              facts.allSatisfy({ validFact($0, materials: data.materials, now: now) }),
              (factCandidates ?? []).allSatisfy({ candidate in candidate.status == "CANDIDATE" && candidate.symbol == symbol && candidate.membershipId == membershipId && candidate.membershipVersion == membershipVersion && candidate.pageNumber > 0 && researchDocumentIsSha256(candidate.pageTextSha256) && candidate.documentPdfSha256.map(researchDocumentIsSha256) == true }),
              facts.contains(fact), operatingMeaning.semanticType == "INTERPRETATION",
              profitTransmission.semanticType == "HYPOTHESIS", !profitTransmission.profitGrowthConclusionAllowed,
              profitTransmission.steps.allSatisfy({ node in
                  ["FACT", "INTERPRETATION", "HYPOTHESIS", "UNKNOWN"].contains(node.semanticType)
                  && (node.semanticType == "UNKNOWN" ? node.value == nil : node.value?.isFinite == true)
                  && (node.derivationMethod != "deterministic_calculation" || node.semanticType == "INTERPRETATION")
              }), unknown.semanticType == "UNKNOWN", scenarios.allSatisfy({ $0.semanticType == "HYPOTHESIS" }),
              reverseValuation.observed == nil || reverseValuation.observed?.symbol == symbol else { return false }
        guard let binding = model.thesisBinding else { return thesisImpact == nil }
        guard let impact = thesisImpact, impact.mutation == "none", impact.conditionText == binding.conditionText,
              impact.hypothesis == binding.conditionText, impact.reportId == binding.reportId, impact.reportVersion == binding.reportVersion,
              impact.reportFingerprint == binding.reportFingerprint, impact.conditionIndex == binding.conditionIndex,
              let report = data.reports.first(where: { $0.id == binding.reportId }), report.isImmutableExact,
              report.version == binding.reportVersion, report.reportFingerprint == binding.reportFingerprint,
              let pack = report.payload.evidencePackBinding, pack.symbol == symbol, pack.membershipId == membershipId, pack.membershipVersion == membershipVersion,
              let conditions = report.payload.adviceLayer?.longTerm.conditions, conditions.indices.contains(binding.conditionIndex), conditions[binding.conditionIndex] == binding.conditionText else { return false }
        return true
    }
    private func validFact(_ f: OperatingFact, materials: [ResearchMaterialData], now: Date) -> Bool {
        guard f.semanticType == "FACT", f.derivationMethod == "source_transcription", f.value.isFinite,
              f.symbol == symbol, f.membershipId == membershipId, f.membershipVersion == membershipVersion,
              ["verified", "owner_confirmed", "source_text_verified"].contains(f.source.assertionVerificationStatus), (f.source.sourceUrl.isEmpty || URL(string: f.source.sourceUrl)?.scheme == "https"),
              let publication = operatingReasoningDate(f.source.publishedAt), publication <= now,
              let m = materials.first(where: { $0.id == f.source.materialId }) else { return false }
        return m.symbol == symbol && m.revision == f.source.revision && m.contentFingerprint == f.source.contentFingerprint
            && m.revisionState == "current" && m.claimType == f.source.sourceClassification
            && m.verificationStatus == f.source.verificationStatus && ["unverified", "verified"].contains(m.verificationStatus)
            && ["issuer_statement", "verified_fact"].contains(m.claimType) && ["authorized_public", "user_provided"].contains(m.rightsStatus)
    }
}
private func operatingReasoningDate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date }; formatter.formatOptions = [.withInternetDateTime]; return formatter.date(from: value)
}
func operatingReasoningRawShapeIsValid(_ value: Any) -> Bool {
    let expected: Set<String> = ["kind", "generationMethod", "actorId", "membershipId", "membershipVersion", "symbol", "growthFactId", "contextId", "inputFingerprint", "facts", "fact", "operatingMeaning", "profitTransmission", "thesisImpact", "thesisOptions", "unknown", "nextResearchQuestion", "questions", "sharesReference", "profitBridge", "model", "scenarios", "reverseValuation", "calculation", "productMix", "thesisUpdate", "guidance", "gaps", "researchUpdate", "sensitivity", "conditionalRequirements"]
    guard let object = value as? [String: Any], Set(object.keys).subtracting(["factCandidates", "researchQuestions", "contextCreatedAt", "evidenceSeries", "assertionHistory", "anchorSelection", "thesisReportCreatedAt"]) == expected, JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value),
          let decoded = try? JSONDecoder().decode(ResearchOperatingReasoning.self, from: data) else { return false }
    return operatingCalculationProofMatches(object) && decoded.kind == "operating_valuation_draft" && decoded.model.version == 1 && decoded.scenarios.map(\.name) == ["bear", "base", "bull"]
}
public func operatingMetricTitle(_ metric: String) -> String {
    ["product_mix_volume":"分类销量", "mix_share":"产品结构占比", "average_selling_price":"平均售价 ASP", "sales_volume":"销量", "asp_product_mix":"ASP / 产品结构", "asp":"平均售价 ASP", "revenue":"收入", "gross_margin":"毛利率", "gross_profit":"毛利润", "research_and_development_expense":"研发费用", "selling_and_distribution_expense":"销售费用", "administrative_expense":"管理费用", "operating_profit":"经营利润", "profit_attributable_to_owners":"归母利润", "operating_cash_flow":"经营现金流", "capital_expenditure":"现金资本投入", "free_cash_flow":"现金流代理值（OCF − 所列现金资本投入）", "core_profit_attributable_to_owners":"发行人核心盈利（非 HKFRS）", "fx_effect":"汇兑影响", "non_financial_impairment":"非金融资产减值", "normalized_profit":"正常化盈利", "opex":"经营费用合计", "net_adjustments":"税项 / 少数股东 / 正常化调整净额", "pe":"Owner PE", "shares_outstanding":"流通在外股份（扣库存）", "issued_shares":"已发行股份", "treasury_shares":"库存股份", "sales_volume_yoy":"发行人披露销量同比"][metric] ?? metric
}
public func operatingValue(_ value: Double?, unit: String = "currency", currency: String? = nil) -> String {
    guard let value else { return "UNKNOWN" }
    if unit == "ratio" { return String(format: "%.2f%%", value * 100) }
    if unit == "currency", abs(value) >= 100_000_000 { return String(format: "%.2f 亿 %@", value / 100_000_000, currency ?? "") }
    return value.formatted(.number.precision(.fractionLength(0...2))) + (currency.map { " \($0)" } ?? (unit == "vehicles" ? " 辆" : unit == "shares" ? " 股" : ""))
}

public struct OperatingCalculationProof: Codable, Equatable, Sendable { public let version: String; public let asOf: String; public let marketCurrency: String?; public let fingerprint: String; public let canonicalPayload: String? }
public struct OperatingProductMix: Codable, Equatable, Sendable { public var parentNode: String? = nil; public var shareBasis: String? = nil; public var overlapPolicy: String? = nil; public let factId: String; public let totalFactId: String; public let dimension: String; public let dimensionValue: String; public let parentScope: String; public let value: Double?; public let semanticType: String; public let derivationMethod: String; public let formula: String; public let limitation: String }
public struct OperatingThesisUpdate: Codable, Equatable, Sendable { public let tests: [OperatingThesisTestResult]?; public let overallEvidence: OperatingOverallThesisEvidence?; public let dimension: String?; public let newDisclosureEvidence: [String]?; public let newlyExtractedOldEvidence: [String]?; public let corrections: [String]?; public let conflictingEvidence: [String]?; public let observations: [OperatingThesisObservation]?; public let status: String; public let originalThesis: OperatingThesisBinding; public let evidenceSinceThesis: [String]; public let supporting: [String]; public let weakening: [String]; public let counterevidence: [String]; public let unknown: [String]; public let assessment: String; public let explanation: String; public let nextValidationEvent: String }
public struct OperatingThesisRevision: Codable, Equatable, Sendable {
    public var previous: OperatingThesisBinding; public var status: String; public var assessment: String
    public var evidenceFactIds: [String]; public var retainedEvidence: [String]; public var weakenedParts: [String]
    public var newThesis: String; public var reason: String; public var addedHypotheses: [String]; public var abandonedHypotheses: [String]
    public var previousValidationEvent: String; public var nextValidationEvent: String; public var confirmedAt: String?; public var actor: String?
    public init(previous: OperatingThesisBinding, assessment: String, evidenceFactIds: [String], newThesis: String, reason: String, nextValidationEvent: String) {
        self.previous = previous; self.status = "DRAFT"; self.assessment = assessment; self.evidenceFactIds = evidenceFactIds; self.newThesis = newThesis; self.reason = reason; self.nextValidationEvent = nextValidationEvent
        retainedEvidence = []; weakenedParts = []; addedHypotheses = []; abandonedHypotheses = []; previousValidationEvent = ""; confirmedAt = nil; actor = nil
    }
}
public struct OperatingGuidanceRevision: Codable, Equatable, Sendable { public let previousId: String; public let previousStatement: String; public let updatedStatement: String; public let sourceMaterialId: String; public let recordedAt: String; public let reason: String }
public struct OperatingGuidance: Codable, Equatable, Sendable { public let revision: OperatingGuidanceRevision?; public let guidanceId: String; public let actualId: String?; public let identity: String; public let metric: String; public let period: String; public let publishedAt: String; public let expectedVerificationDate: String; public let lower: Double?; public let upper: Double?; public let status: String; public let limitation: String }
public struct OperatingGap: Codable, Equatable, Sendable { public let metric: String; public let reason: String }
public struct OperatingResearchNotice: Codable, Equatable, Sendable { public let effectiveAt: String?; public let change: OperatingResearchChange?; public let id: String; public let symbol: String; public let membershipId: String; public let membershipVersion: Int; public let reasoningFingerprint: String; public let triggerType: String; public let title: String; public let summary: String; public let nextQuestion: String }

public struct OperatingSensitivityRange: Codable, Equatable, Sendable { public var variable: String; public var lower: Double; public var upper: Double
    public init(variable: String, lower: Double, upper: Double) { self.variable = variable; self.lower = lower; self.upper = upper }
}
public struct OperatingSensitivityResult: Codable, Equatable, Sendable { public let variable: String; public let value: Double; public let perShareValue: Double?; public let normalizedProfit: Double?; public let semanticType: String; public let limitation: String }
public struct OperatingConditionalRequirements: Codable, Equatable, Sendable { public let margin: Double?; public let revenue: Double?; public let label: String }

// Verify calculation provenance, never duplicate the server financial formulas.
func operatingCalculationProofObject(_ raw: [String: Any]) -> [String: Any]? {
    guard let proof = raw["calculation"] as? [String: Any], let transmission = raw["profitTransmission"] as? [String: Any], let reverse = raw["reverseValuation"] as? [String: Any] else { return nil }
    var input: [String: Any] = ["facts": raw["facts"] ?? NSNull(), "model": raw["model"] ?? NSNull(), "observed": reverse["observed"] ?? NSNull(), "asOf": proof["asOf"] ?? NSNull(), "marketCurrency": proof["marketCurrency"] ?? NSNull()]
    var result: [String: Any] = ["transmission": transmission["steps"] ?? NSNull(), "profitBridge": raw["profitBridge"] ?? NSNull(), "scenarios": raw["scenarios"] ?? NSNull(), "sharesReference": raw["sharesReference"] ?? NSNull(), "reverseValuation": reverse, "productMix": raw["productMix"] ?? [], "sensitivity": raw["sensitivity"] ?? [], "conditionalRequirements": raw["conditionalRequirements"] ?? NSNull()]
    if let history=raw["assertionHistory"] { input["assertionHistory"]=history }
    if let series=raw["evidenceSeries"] { result["evidenceSeries"]=series }
    return ["calculationVersion": "operating-calculation-v1", "formulaIdentity": "transmission/profitBridge/scenarios/shares/reverse:v1", "inputs": input, "result": result]
}
func operatingCalculationProofFingerprint(_ raw: [String: Any]) -> String? {
    guard let object = operatingCalculationProofObject(raw) else { return nil }
    return try? portfolioDecisionContentId(object: object, prefix: "", excludingTopLevelKeys: [])
}
func operatingCalculationProofMatches(_ raw: [String: Any]) -> Bool {
    guard let proof = raw["calculation"] as? [String: Any], proof["version"] as? String == "operating-calculation-v1", let hash = proof["fingerprint"] as? String,
          let payload = proof["canonicalPayload"] as? String, let data = payload.data(using: .utf8),
          let bound = try? JSONSerialization.jsonObject(with: data) as? NSDictionary, let actual = operatingCalculationProofObject(raw) else { return false }
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    return digest == hash && bound.isEqual(to: actual)
}

public struct OperatingFactCandidate: Codable, Equatable, Sendable, Identifiable { public var mix:OperatingFactMix? = nil; public var unit:String? = nil; public var measurementBasis:String? = nil; public var accountingScope:String? = nil; public var businessScope:String? = nil; public var capturedSourceUrl:String? = nil; public let suggestedBusinessScope: String?; public let confirmationState: String?; public let classification: String?; public let structureExcerpt: String?; public let sourceMaterialId: String?; public let materialRevision: Int?; public let documentPdfSha256: String?; public let documentReviewState:String?; public let confirmationAllowed:Bool?;
    public let id: String; public let status: String; public let purpose: String; public let existingFactId: String?
    public let symbol: String; public let membershipId: String; public let membershipVersion: Int; public let metric: String; public let proposedValue: String
    public let rawValueText: String; public let periodStart: String?; public let periodEnd: String; public let currency: String; public let unitScale: Double
    public let documentId: String; public let pageNumber: Int; public let pageTextSha256: String; public let sourceUrl: String
    public let rowLabelText: String; public let columnHeaderText: String; public let unitHeaderText: String; public let sourceExcerpt: String
    public let extractionMethod: String; public let confidence: String; public let limitation: String
}
public struct OperatingThesisObservation: Codable, Equatable, Sendable { public let metric: String; public let current: Double?; public let previous: Double?; public let change: Double?; public let factIds: [String]; public let direction: String; public let limitation: String }
public struct OperatingResearchChange: Codable, Equatable, Sendable { public let id: String; public let triggerType: String; public let beforeFingerprint: String?; public let afterFingerprint: String; public let changedFactIds: [String]; public let changedGapReasons: [String]; public let previousAssessment: String?; public let currentAssessment: String?; public let effectiveAt: String; public let sourceIds: [String]; public let summary: String }

extension ResearchOperatingReasoning: Identifiable { public var id: String { inputFingerprint } }

public enum OperatingTestThreshold: Codable, Equatable, Sendable {
    case number(Double), range(Double, Double)
    enum Keys: String, CodingKey { case lower, upper }
    public init(from decoder: Decoder) throws { if let n = try? decoder.singleValueContainer().decode(Double.self) { self = .number(n) } else { let c = try decoder.container(keyedBy: Keys.self); self = .range(try c.decode(Double.self, forKey: .lower), try c.decode(Double.self, forKey: .upper)) } }
    public func encode(to encoder: Encoder) throws { switch self { case .number(let n): var c = encoder.singleValueContainer(); try c.encode(n); case .range(let l, let u): var c = encoder.container(keyedBy: Keys.self); try c.encode(l, forKey: .lower); try c.encode(u, forKey: .upper) } }
}
public struct OperatingThesisTest: Codable, Equatable, Sendable, Identifiable {
    public var evidenceRequirements: [String:OperatingJSON]? = nil
    public var id: String { testId }; public var testId: String; public var originalThesisIdentity: OperatingThesisBinding; public var dimension: String; public var metrics: [String]; public var periodType: String; public var comparison: String; public var direction: String; public var threshold: OperatingTestThreshold?; public var mixNode: String?; public var referencePeriod: String?; public var status: String
    public init(binding: OperatingThesisBinding, metric: String, dimension: String, periodType: String, comparison: String, direction: String, threshold: OperatingTestThreshold?, mixNode: String?, referencePeriod: String) {
        var original = binding; original.proposition = nil; original.thesisDimension = nil
        testId = "test-\(binding.reportId)-\(binding.reportVersion)-\(binding.conditionIndex)-\(metric)"; originalThesisIdentity = original; self.metrics = [metric]; self.dimension = dimension; self.periodType = periodType; self.comparison = comparison; self.direction = direction; self.threshold = threshold; self.mixNode = mixNode; self.referencePeriod = referencePeriod; status = "DRAFT"
    }
    enum CodingKeys: String, CodingKey { case testId, originalThesisIdentity, dimension, metrics, periodType, comparison, direction, threshold, mixNode, referencePeriod, status, evidenceRequirements }
    public func encode(to encoder: Encoder) throws { var c = encoder.container(keyedBy: CodingKeys.self); try c.encodeIfPresent(evidenceRequirements, forKey: .evidenceRequirements); try c.encode(testId, forKey: .testId); try c.encode(originalThesisIdentity, forKey: .originalThesisIdentity); try c.encode(dimension, forKey: .dimension); try c.encode(metrics, forKey: .metrics); try c.encode(periodType, forKey: .periodType); try c.encode(comparison, forKey: .comparison); try c.encode(direction, forKey: .direction); try c.encode(threshold, forKey: .threshold); try c.encode(mixNode, forKey: .mixNode); try c.encodeIfPresent(referencePeriod, forKey: .referencePeriod); try c.encode(status, forKey: .status) }
}
public struct OperatingThesisEvidencePlan: Codable, Equatable, Sendable {
    public var requiredTestIds: [String]; public var aggregationRule: String
    public init(requiredTestIds: [String], aggregationRule: String) { self.requiredTestIds = requiredTestIds; self.aggregationRule = aggregationRule }
}
public struct OperatingThesisTestObservation: Codable, Equatable, Sendable { public let metric: String; public let observed: Double?; public let previous: Double?; public let change: Double?; public let threshold: OperatingTestThreshold?; public let comparison: String; public let result: String; public let evidenceIds: [String]; public let limitation: String }
public struct OperatingThesisTestResult: Codable, Equatable, Sendable, Identifiable { public var id: String { test.testId }; public let test: OperatingThesisTest; public let legacy: Bool; public let result: String; public let observations: [OperatingThesisTestObservation]; public let missingMetrics: [String]; public let explanation: String }
public struct OperatingOverallThesisEvidence: Codable, Equatable, Sendable { public let status: String; public let aggregationRule: String; public let requiredTestIds: [String]; public let assessment: String?; public let mutation: String; public let explanation: String }
public struct OperatingResearchQuestion: Codable, Equatable, Sendable, Identifiable { public var requirement:OperatingJSON? = nil; public var mismatchReason:String? = nil; public var availableDependencies:[String]? = nil; public var missingDependencies:[String]? = nil; public var id: String { questionId }; public let questionId: String; public let symbol: String; public let membershipId: String; public let membershipVersion: Int; public let origin: String; public let question: String; public let relatedThesisTestId: String?; public let targetMetric: String; public let gapReason: String?; public let status: String; public let evidenceIds: [String]; public let candidateIds: [String]; public let resolution: String?; public let openedAt: String; public let resolvedAt: String? }
public func operatingComparisonTitle(_ value: String) -> String { ["above_zero":"大于零", "below_zero":"小于零", "increase_vs_previous":"高于明确比较期", "decrease_vs_previous":"低于明确比较期", "at_least":"不低于下限", "at_most":"不高于上限", "range":"处于指定区间", "directional_change":"按指定方向变化"][value] ?? value }

public enum OperatingJSON: Codable, Equatable, Sendable {
    case object([String:OperatingJSON]), array([OperatingJSON]), string(String), number(Double), bool(Bool), null
    public init(from decoder: Decoder) throws { let c = try decoder.singleValueContainer(); if c.decodeNil() { self = .null } else if let v = try? c.decode(Bool.self) { self = .bool(v) } else if let v = try? c.decode(Double.self) { self = .number(v) } else if let v = try? c.decode(String.self) { self = .string(v) } else if let v = try? c.decode([OperatingJSON].self) { self = .array(v) } else { self = .object(try c.decode([String:OperatingJSON].self)) } }
    public func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); switch self { case .null: try c.encodeNil(); case .bool(let v): try c.encode(v); case .number(let v): try c.encode(v); case .string(let v): try c.encode(v); case .array(let v): try c.encode(v); case .object(let v): try c.encode(v) } }
}
public struct OperatingSeriesIdentity: Codable, Equatable, Sendable { public let category:String; public let symbol:String; public let membershipVersion:Int; public let metric:String; public let unit:String; public let currency:String?; public let unitScale:Double; public let businessScope:String; public let accountingScope:String; public let measurementBasis:String; public let periodType:String; public let taxonomy:OperatingFactMix? }
public struct OperatingSeriesObservation: Codable, Equatable, Sendable { public let period:OperatingPeriod; public let value:Double?; public let status:String; public let assertionIds:[String]; public let historicalAssertionIds:[String]; public let inputs:[String]; public let semanticType:String; public let formula:String? }
public struct OperatingEvidenceSeries: Codable, Equatable, Sendable, Identifiable { public let id:String; public let identity:OperatingSeriesIdentity; public let observations:[OperatingSeriesObservation]; public let current:OperatingSeriesObservation?; public let previous:OperatingSeriesObservation?; public let change:Double?; public let changeRatio:Double?; public let breaks:[String]; public let shareBasis:String? }

/// Two issuer facts from comparable periods and different publication days.
/// This is display guidance only; it never revises an Owner decision.
public struct OperatingDisclosureComparison: Equatable, Sendable {
    public let earlier: OperatingFact
    public let later: OperatingFact
    public let change: Double
    public let changeRatio: Double?
    public let isNewDisclosureEvent: Bool
}

public extension ResearchOperatingReasoning {
    var publicResearchChangeFact: OperatingFact? {
        guard let change = researchUpdate?.change,
              ["new_disclosure", "old_evidence_extracted", "verification_upgrade",
               "evidence_correction", "evidence_invalidation"].contains(change.triggerType) else { return nil }
        let changed = Set(change.changedFactIds)
        let materials = Set(change.sourceIds)
        let sourceFacts = change.triggerType == "evidence_invalidation" ? (assertionHistory ?? facts) : facts
        return sourceFacts.filter { fact in
            fact.symbol == symbol && fact.membershipId == membershipId
                && fact.membershipVersion == membershipVersion
                && ["issuer_statement", "verified_fact"].contains(fact.source.sourceClassification)
                && fact.source.hasValidCitation
                && (changed.contains(fact.id) || materials.contains(fact.source.materialId))
        }.sorted {
            if changed.contains($0.id) != changed.contains($1.id) {
                return changed.contains($0.id)
            }
            let leftCurrent = operatingReasoningDate($0.source.validUntil).map { $0 > Date() } == true
            let rightCurrent = operatingReasoningDate($1.source.validUntil).map { $0 > Date() } == true
            if leftCurrent != rightCurrent { return leftCurrent }
            if $0.period.end == $1.period.end {
                if $0.source.revision != $1.source.revision { return $0.source.revision > $1.source.revision }
                if $0.source.materialId != $1.source.materialId {
                    return (Int($0.source.materialId) ?? 0) > (Int($1.source.materialId) ?? 0)
                }
                return (Int($0.id) ?? 0) > (Int($1.id) ?? 0)
            }
            return $0.period.end > $1.period.end
        }.first
    }

    var publicResearchChangeLabel: String? {
        switch researchUpdate?.change?.triggerType {
        case "new_disclosure": "新增公开披露"
        case "old_evidence_extracted": "旧资料补充整理 · 不是新披露"
        case "verification_upgrade": "来源核对升级 · 数值未变"
        case "evidence_correction": "已存证据修订 · 需核对原件"
        case "evidence_invalidation": "原证据失效 · 不能沿用旧比较"
        default: nil
        }
    }

    var publicDisclosureComparison: OperatingDisclosureComparison? {
        let history = assertionHistory ?? facts
        let change = researchUpdate?.change
        let changedIds: Set<String> = change?.triggerType == "new_disclosure"
            ? Set(change?.changedFactIds ?? []) : []
        let candidates: [OperatingDisclosureComparison] = (evidenceSeries ?? []).compactMap { series in
            guard series.identity.category == "actual", series.shareBasis == nil,
                  let current = series.current, let previous = series.previous,
                  current.status == "COMPARABLE", previous.status == "COMPARABLE",
                  current.semanticType == "FACT", previous.semanticType == "FACT",
                  let changeAmount = series.change, changeAmount != 0,
                  current.inputs.count == 1, previous.inputs.count == 1,
                  let later = history.first(where: { $0.id == current.inputs[0] }),
                  let earlier = history.first(where: { $0.id == previous.inputs[0] }),
                  later.id != earlier.id, later.period.end > earlier.period.end,
                  later.symbol == symbol, earlier.symbol == symbol,
                  later.membershipId == membershipId, earlier.membershipId == membershipId,
                  later.membershipVersion == membershipVersion, earlier.membershipVersion == membershipVersion,
                  later.metric == earlier.metric, later.unit == earlier.unit,
                  later.unitScale == earlier.unitScale, later.currency == earlier.currency,
                  later.businessScope == earlier.businessScope,
                  later.accountingScope == earlier.accountingScope,
                  later.measurementBasis == earlier.measurementBasis,
                  later.source.hasValidCitation, earlier.source.hasValidCitation,
                  ["issuer_statement", "verified_fact"].contains(later.source.sourceClassification),
                  ["issuer_statement", "verified_fact"].contains(earlier.source.sourceClassification),
                  ["verified", "owner_confirmed", "source_text_verified"].contains(later.source.assertionVerificationStatus),
                  ["verified", "owner_confirmed", "source_text_verified"].contains(earlier.source.assertionVerificationStatus),
                  later.source.materialId != earlier.source.materialId,
                  later.source.publishedAt.count >= 10, earlier.source.publishedAt.count >= 10,
                  String(later.source.publishedAt.prefix(10)) > String(earlier.source.publishedAt.prefix(10)) else { return nil }
            return OperatingDisclosureComparison(earlier: earlier, later: later,
                change: changeAmount, changeRatio: series.changeRatio,
                isNewDisclosureEvent: changedIds.contains(later.id))
        }
        return candidates.sorted {
            if $0.isNewDisclosureEvent != $1.isNewDisclosureEvent { return $0.isNewDisclosureEvent }
            if ($0.later.id == fact.id) != ($1.later.id == fact.id) { return $0.later.id == fact.id }
            return $0.later.period.end > $1.later.period.end
        }.first
    }
}

public extension OperatingEvidenceSeries {
    func exactRequirement() throws -> OperatingJSON {
        guard let current else { throw NSError(domain: "没有可确认的当前期间", code: 400) }
        let encoded = try JSONEncoder().encode(identity)
        guard case .object(var values) = try JSONDecoder().decode(OperatingJSON.self, from: encoded) else { throw NSError(domain: "无法读取序列口径", code: 400) }
        values.removeValue(forKey: "periodType"); values.removeValue(forKey: "periodKind"); values.removeValue(forKey: "unitScale")
        values["period"] = try JSONDecoder().decode(OperatingJSON.self, from: JSONEncoder().encode(current.period))
        values["currency"] = identity.currency.map(OperatingJSON.string) ?? .null
        values["taxonomy"] = values["taxonomy"] ?? .null
        if case .object(var taxonomy) = values["taxonomy"] { taxonomy["parentNode"] = taxonomy["parentNode"] ?? .null; values["taxonomy"] = .object(taxonomy) }
        values["guidanceDefinition"] = .null
        values["shareBasis"] = shareBasis.map(OperatingJSON.string) ?? .null
        values["comparability"] = .string("comparable")
        return .object(values.mapValues { .object(["mode": .string("exact"), "value": $0]) })
    }
}
