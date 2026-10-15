import Foundation

public let frozenResearchEvidenceSchemaVersion = "2026-07-30.deep-research-beta.v5"
public let frozenResearchContextVersion = "2026-07-30.s1d-frozen-technical-evidence.v1"
public let frozenResearchContextVersionV2 = "2026-10-12.selected-provider-pe-fcff.v2"
public let independentWeinsteinTechnicalSourceType = "owner_weinstein_technical_confirmation"
public let independentWeinsteinTechnicalVersion = "research.weinstein.independent-confirmation.v1"

public struct CreateIndependentWeinsteinTechnicalConfirmationRequest: Codable, Equatable, Sendable {
    public let kind: String
    public let membershipId: String
    public let membershipVersion: Int
    public let expectedWeinstein: FrozenWeinsteinEvidenceBinding
    public let ownerWeinsteinZones: OwnerWeinsteinZoneRevision
    public let ownerConfirmed: Bool
    public let confirmedAt: String
    public let idempotencyKey: String

    public init(membership: CandidateMembershipData, expectedWeinstein: FrozenWeinsteinEvidenceBinding,
                ownerWeinsteinZones: OwnerWeinsteinZoneRevision, confirmedAt: String, idempotencyKey: String) {
        kind = independentWeinsteinTechnicalVersion
        membershipId = membership.id
        membershipVersion = membership.version
        self.expectedWeinstein = expectedWeinstein
        self.ownerWeinsteinZones = ownerWeinsteinZones
        ownerConfirmed = true
        self.confirmedAt = confirmedAt
        self.idempotencyKey = idempotencyKey
    }
}

public struct IndependentWeinsteinTechnicalConfirmationContent: Decodable {
    public let schemaVersion: String
    public let actor: FrozenResearchActor
    public let membership: FrozenTechnicalConfirmationMembership
    public let machine: WeinsteinTechnicalAnalysisEnvelope
    public let ownerWeinsteinZones: OwnerWeinsteinZoneRevision
    public let ownerConfirmed: Bool
    public let confirmedAt: String

    public func validates(material: ResearchMaterialData, membership expected: CandidateMembershipData) -> Bool {
        guard let binding = FrozenWeinsteinEvidenceBinding(envelope: machine) else { return false }
        return schemaVersion == independentWeinsteinTechnicalVersion
            && actor.actorType == "user" && actor.actorId == expected.actorId
            && membership.id == expected.id && membership.version == expected.version
            && membership.symbol == expected.symbol && machine.symbol == expected.symbol
            && ownerConfirmed && frozenResearchInstantIsValid(confirmedAt)
            && ownerWeinsteinZones.validates(expected: binding)
            && material.symbol == expected.symbol
            && material.sourceType == independentWeinsteinTechnicalSourceType
            && material.sourceVersion == "weinstein:\(binding.resultHash):owner-v\(ownerWeinsteinZones.version)"
            && material.claimType == "model_inference"
            && material.verificationStatus == "unverified"
            && material.rightsStatus == "user_provided"
            && material.contentFingerprint == researchDocumentSha256(Data(material.contentText.utf8))
    }
}

public struct FrozenTechnicalConfirmationMembership: Decodable {
    public let id: String
    public let version: Int
    public let symbol: String
}

public struct ExpectedFrozenQuantPortfolioIdentity: Codable, Equatable, Sendable {
    public let decisionRefinementId: String?
    public let decisionUniverseSnapshotId: String?
    public let portfolioEvidenceId: String?
    public let portfolioUniverseSnapshotId: String?

    public init(
        decisionRefinementId: String?,
        decisionUniverseSnapshotId: String?,
        portfolioEvidenceId: String?,
        portfolioUniverseSnapshotId: String?
    ) {
        self.decisionRefinementId = decisionRefinementId
        self.decisionUniverseSnapshotId = decisionUniverseSnapshotId
        self.portfolioEvidenceId = portfolioEvidenceId
        self.portfolioUniverseSnapshotId = portfolioUniverseSnapshotId
    }

    public static let sourceMissing = Self(
        decisionRefinementId: nil,
        decisionUniverseSnapshotId: nil,
        portfolioEvidenceId: nil,
        portfolioUniverseSnapshotId: nil
    )

    var isValid: Bool {
        let decisionMissing = decisionRefinementId == nil && decisionUniverseSnapshotId == nil
        let decisionAvailable = decisionRefinementId?
            .range(of: #"^quant-decision-evidence:[a-f0-9]{64}$"#, options: .regularExpression) != nil
            && decisionUniverseSnapshotId?.isFrozenSHA256 == true
        let portfolioMissing = portfolioEvidenceId == nil && portfolioUniverseSnapshotId == nil
        let portfolioAvailable = portfolioEvidenceId?
            .range(of: #"^annual-portfolio-lab-quant:[a-f0-9]{64}$"#, options: .regularExpression) != nil
            && portfolioUniverseSnapshotId?.isFrozenSHA256 == true
        return (decisionMissing || decisionAvailable) && (portfolioMissing || portfolioAvailable)
    }
}

public struct FreezeResearchEvidencePackRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let selectionVersion: String?
    public let expectedScenarioId: String?
    public let expectedScenarioRevision: Int?
    public let expectedValuationMethods: [FrozenResearchValuationMethodBinding]
    public let expectedTechnicalSnapshotSha: String
    public let expectedTechnicalResultHash: String
    public let expectedWeinstein: FrozenWeinsteinEvidenceBinding
    public let ownerWeinsteinZones: OwnerWeinsteinZoneRevision?
    public let expectedQuantPortfolio: ExpectedFrozenQuantPortfolioIdentity
    public let idempotencyKey: String

    public init(
        membershipVersion: Int,
        expectedScenarioId: String? = nil,
        expectedScenarioRevision: Int? = nil,
        selectionVersion: String? = nil,
        expectedValuationMethods: [FrozenResearchValuationMethodBinding],
        expectedTechnicalSnapshotSha: String,
        expectedTechnicalResultHash: String,
        expectedWeinstein: FrozenWeinsteinEvidenceBinding,
        ownerWeinsteinZones: OwnerWeinsteinZoneRevision? = nil,
        expectedQuantPortfolio: ExpectedFrozenQuantPortfolioIdentity = .sourceMissing,
        idempotencyKey: String
    ) {
        self.membershipVersion = membershipVersion
        self.selectionVersion = selectionVersion
        self.expectedScenarioId = expectedScenarioId
        self.expectedScenarioRevision = expectedScenarioRevision
        self.expectedValuationMethods = expectedValuationMethods
        self.expectedTechnicalSnapshotSha = expectedTechnicalSnapshotSha
        self.expectedTechnicalResultHash = expectedTechnicalResultHash
        self.expectedWeinstein = expectedWeinstein
        self.ownerWeinsteinZones = ownerWeinsteinZones
        self.expectedQuantPortfolio = expectedQuantPortfolio
        self.idempotencyKey = idempotencyKey
    }
}

public struct OwnerWeinsteinPriceZone: Codable, Equatable, Sendable {
    public let lower: Double
    public let upper: Double

    public init(lower: Double, upper: Double) {
        self.lower = lower
        self.upper = upper
    }

    var isValid: Bool {
        lower.isFinite && upper.isFinite && lower > 0 && upper >= lower
    }
}

public struct OwnerWeinsteinZoneRevision: Codable, Equatable, Sendable {
    public let version: Int
    public let reason: String
    public let basedOn: FrozenWeinsteinEvidenceBinding
    public let supportZones: [OwnerWeinsteinPriceZone]
    public let resistanceZones: [OwnerWeinsteinPriceZone]

    public init(version: Int, reason: String, basedOn: FrozenWeinsteinEvidenceBinding,
                supportZones: [OwnerWeinsteinPriceZone], resistanceZones: [OwnerWeinsteinPriceZone]) {
        self.version = version
        self.reason = reason
        self.basedOn = basedOn
        self.supportZones = supportZones
        self.resistanceZones = resistanceZones
    }

    func validates(expected: FrozenWeinsteinEvidenceBinding) -> Bool {
        let trimmedReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        return version > 0 && version <= 9_007_199_254_740_991
            && !trimmedReason.isEmpty && reason.utf16.count <= 1000
            && basedOn == expected
            && supportZones.count <= 5 && resistanceZones.count <= 5
            && supportZones.count + resistanceZones.count > 0
            && supportZones.allSatisfy(\.isValid)
            && resistanceZones.allSatisfy(\.isValid)
    }
}

public struct FrozenResearchValuationMethodBinding: Codable, Equatable, Sendable {
    public let basisKind: String?
    public let scenarioId: String
    public let scenarioRevision: Int
    public let methodId: String

    public init(scenarioId: String, scenarioRevision: Int, methodId: String, basisKind: String? = nil) {
        self.basisKind = basisKind
        self.scenarioId = scenarioId
        self.scenarioRevision = scenarioRevision
        self.methodId = methodId
    }

    init(_ scenario: ResearchValuationScenarioSetData) {
        self.init(
            scenarioId: scenario.id,
            scenarioRevision: scenario.revision,
            methodId: scenario.calculation.method.id
        )
    }

    init(_ scenario: ResearchFcffScenarioSetData) {
        self.init(scenarioId: scenario.id, scenarioRevision: scenario.revision,
            methodId: scenario.calculation.methodId)
    }

    init(_ scenario: ResearchProviderValuationScenarioSetData, basisKind: String) {
        self.init(scenarioId: scenario.id, scenarioRevision: scenario.revision,
            methodId: scenario.calculation.method.id, basisKind: basisKind)
    }
}

public struct FrozenResearchActor: Codable, Equatable, Sendable {
    public let actorType: String
    public let actorId: String
}

public struct FrozenResearchMembership: Codable, Equatable, Sendable {
    public let id: String
    public let version: Int
    public let state: String
    public let symbol: String
}

public struct FrozenResearchContextIdentity: Codable, Equatable, Sendable {
    public let id: String
    public let membershipId: String
    public let membershipVersion: Int
    public let selectedSymbol: String
    public let cutoffAt: String
    public let validUntil: String
    public let contentHash: String

    func validates(membership: FrozenResearchMembership) -> Bool {
        researchDocumentIsPositiveIntegerString(id)
            && membershipId == membership.id
            && membershipVersion == membership.version
            && selectedSymbol == membership.symbol
            && frozenResearchInstantIsValid(cutoffAt)
            && frozenResearchInstantIsValid(validUntil)
            && cutoffAt <= validUntil
            && contentHash.isFrozenSHA256
    }
}

public enum FrozenSelectedValuationMethod: Codable, Equatable, Sendable {
    case provider(ResearchProviderValuationScenarioSetData)
    case fcff(ResearchFcffScenarioSetData)

    private enum CodingKeys: String, CodingKey { case basisKind, scenario }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        switch try values.decode(String.self, forKey: .basisKind) {
        case "provider": self = .provider(try values.decode(ResearchProviderValuationScenarioSetData.self, forKey: .scenario))
        case "fcff": self = .fcff(try values.decode(ResearchFcffScenarioSetData.self, forKey: .scenario))
        default: throw DecodingError.dataCorruptedError(forKey: .basisKind, in: values, debugDescription: "unknown frozen valuation basis")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .provider(let scenario):
            try values.encode("provider", forKey: .basisKind)
            try values.encode(scenario, forKey: .scenario)
        case .fcff(let scenario):
            try values.encode("fcff", forKey: .basisKind)
            try values.encode(scenario, forKey: .scenario)
        }
    }

    public var binding: FrozenResearchValuationMethodBinding {
        switch self {
        case .provider(let scenario): return .init(scenario, basisKind: "provider")
        case .fcff(let scenario): return .init(scenarioId: scenario.id, scenarioRevision: scenario.revision,
            methodId: scenario.calculation.methodId, basisKind: "fcff")
        }
    }
}

public struct FrozenResearchEvidenceContext: Codable, Equatable, Sendable {
    public let bindingVersion: String
    public let actor: FrozenResearchActor
    public let membership: FrozenResearchMembership
    public var researchContext: FrozenResearchContextIdentity? = nil
    public var financialRequirement: ResearchFinancialRequirementData? = nil
    public let valuationScenario: ResearchValuationScenarioSetData?
    public let valuationMethods: [ResearchValuationScenarioSetData]?
    public let fcffScenario: ResearchFcffScenarioSetData?
    public let selectedValuationMethods: [FrozenSelectedValuationMethod]?
    public let technical: MarketDailyTechnicalEnvelope
    public let weinstein: FrozenWeinsteinEvidenceBinding
    public var ownerWeinsteinZones: OwnerWeinsteinZoneRevision? = nil
    public let unboundSources: FrozenResearchSourceGaps
    public var quantPortfolio: FrozenQuantPortfolioEvidenceBinding? = nil
    public let operatingMonitor: FrozenOperatingMonitorBinding?
}

public struct FrozenQuantPortfolioEvidenceBinding: Codable, Equatable, Sendable {
    public let decision: FrozenDecisionQuantEvidenceBinding
    public let portfolio: FrozenPortfolioQuantEvidenceBinding

    var isValid: Bool { decision.isValid && portfolio.isValid }

    func matches(_ expected: ExpectedFrozenQuantPortfolioIdentity) -> Bool {
        expected.isValid
            && expected.decisionRefinementId
                == (decision.status == "available" ? decision.refinementId : nil)
            && expected.decisionUniverseSnapshotId
                == (decision.status == "available" ? decision.hkConnectUniverse?.snapshotId : nil)
            && expected.portfolioEvidenceId
                == (portfolio.status == "available" ? portfolio.evidenceId : nil)
            && expected.portfolioUniverseSnapshotId
                == (portfolio.status == "available" ? portfolio.hkConnectUniverse?.snapshotId : nil)
    }
}

public struct FrozenDecisionQuantEvidenceBinding: Codable, Equatable, Sendable {
    public let status: String
    public let reason: String?
    public let refinementId: String?
    public let snapshotId: String?
    public let snapshotHash: String?
    public let dataHash: String?
    public let dataCutoff: String?
    public let generatedAt: String?
    public let source: String?
    public let asOf: String?
    public let fetchedAt: String?
    public let validUntil: String?
    public let hkConnectUniverse: CandidateDiscoveryUniverse?

    var isValid: Bool {
        if status == "source_missing" {
            return reason?.isEmpty == false && [
                refinementId, snapshotId, snapshotHash, dataHash, dataCutoff,
                generatedAt, source, asOf, fetchedAt, validUntil
            ].allSatisfy { $0 == nil } && hkConnectUniverse == nil
        }
        return status == "available" && reason == nil
            && refinementId?.range(of: #"^quant-decision-evidence:[a-f0-9]{64}$"#, options: .regularExpression) != nil
            && snapshotId?.isEmpty == false && snapshotHash?.isFrozenSHA256 == true
            && dataHash?.isFrozenSHA256 == true && source?.isEmpty == false
            && [asOf, dataCutoff, fetchedAt, generatedAt, validUntil]
                .allSatisfy(frozenResearchInstantIsValid)
            && hkConnectUniverse?.isValidOfficialHongKongConnectBinding == true
    }
}

public struct FrozenPortfolioQuantEvidenceBinding: Codable, Equatable, Sendable {
    public struct Series: Codable, Equatable, Sendable {
        public let symbol: String
        public let annualizedVolatility: Double
        public let worstDailyReturn: Double
        public let historicalTailLossMagnitude: Double
    }
    public struct Covariance: Codable, Equatable, Sendable {
        public let leftSymbol: String
        public let rightSymbol: String
        public let annualizedCovariance: Double
        public let correlation: Double?
    }
    public let status: String
    public let reason: String?
    public let evidenceId: String?
    public let contentHash: String?
    public let snapshotId: String?
    public let snapshotHash: String?
    public let dataHash: String?
    public let dataCutoff: String?
    public let observationStartDate: String?
    public let observationEndDate: String?
    public let observationCount: Int?
    public let stability: String?
    public let generatedAt: String?
    public let validUntil: String?
    public let hkConnectUniverse: CandidateDiscoveryUniverse?
    public let series: [Series]?
    public let covariance: [Covariance]?

    var isValid: Bool {
        if status == "source_missing" {
            return reason?.isEmpty == false && [
                evidenceId, contentHash, snapshotId, snapshotHash, dataHash, dataCutoff,
                observationStartDate, observationEndDate, stability, generatedAt, validUntil
            ].allSatisfy { $0 == nil } && observationCount == nil && hkConnectUniverse == nil
                && series == nil && covariance == nil
        }
        guard status == "available", reason == nil,
              evidenceId?.range(of: #"^annual-portfolio-lab-quant:[a-f0-9]{64}$"#, options: .regularExpression) != nil,
              contentHash?.isFrozenSHA256 == true, snapshotId?.isEmpty == false,
              snapshotHash?.isFrozenSHA256 == true, dataHash?.isFrozenSHA256 == true,
              frozenResearchInstantIsValid(dataCutoff), frozenResearchInstantIsValid(generatedAt),
              frozenResearchInstantIsValid(validUntil),
              let observationStartDate, let observationEndDate,
              frozenResearchDateIsValid(observationStartDate), frozenResearchDateIsValid(observationEndDate),
              observationStartDate <= observationEndDate, (observationCount ?? 0) > 0,
              ["sample_threshold_met", "insufficient_tiny_sample"].contains(stability ?? ""),
              hkConnectUniverse?.isValidOfficialHongKongConnectBinding == true,
              let series, !series.isEmpty, Set(series.map(\.symbol)).count == series.count,
              series.allSatisfy({ $0.symbol.range(of: #"^HK\.\d{5}$"#, options: .regularExpression) != nil
                && $0.annualizedVolatility.isFinite && $0.worstDailyReturn.isFinite
                && $0.historicalTailLossMagnitude.isFinite }),
              let covariance, covariance.allSatisfy({
                $0.leftSymbol.range(of: #"^HK\.\d{5}$"#, options: .regularExpression) != nil
                    && $0.rightSymbol.range(of: #"^HK\.\d{5}$"#, options: .regularExpression) != nil
                    && $0.annualizedCovariance.isFinite
                    && ($0.correlation == nil || (-1 ... 1).contains($0.correlation!))
              }) else { return false }
        return true
    }
}

public struct FrozenOperatingMonitorBinding: Codable, Equatable, Sendable {
    public let kind: String
    public let id: String
    public let runVersion: Int
    public let runFingerprint: String

    public func validates(symbol: String) -> Bool {
        let expectedKind = symbol == "HK.00175" ? "geely_sales"
            : symbol == "HK.03800" ? "gcl_pv_price" : nil
        return kind == expectedKind
            && researchDocumentIsPositiveIntegerString(id)
            && runVersion > 0
            && runFingerprint.isFrozenSHA256
    }
}

public struct FrozenResearchEvidenceCurrentness: Codable, Equatable, Sendable {
    public let status: String
    public let invalidatedBy: [String]
}

public let limitedResearchContextVersion = "2026-09-10.limited-research.v1"

public struct SelectedLimitedResearchMaterial: Codable, Equatable, Sendable {
    public let id: String
    public let revision: Int
    public let contentFingerprint: String
    public let sourceVersion: String
    public let validUntil: String

    public init(material: ResearchMaterialData) {
        id = material.id
        revision = material.revision
        contentFingerprint = material.contentFingerprint
        sourceVersion = material.sourceVersion
        validUntil = material.validUntil
    }

    public func matches(_ material: ResearchMaterialData) -> Bool {
        id == material.id && revision == material.revision
            && contentFingerprint == material.contentFingerprint
            && sourceVersion == material.sourceVersion && validUntil == material.validUntil
    }
}

public struct FreezeLimitedResearchRequest: Encodable, Equatable, Sendable {
    public let researchMode = "limited"
    public let membershipVersion: Int
    public let selectedMaterials: [SelectedLimitedResearchMaterial]
    public let idempotencyKey: String
    public init(membershipVersion: Int, selectedMaterials: [SelectedLimitedResearchMaterial], idempotencyKey: String) {
        self.membershipVersion = membershipVersion
        self.selectedMaterials = selectedMaterials
        self.idempotencyKey = idempotencyKey
    }
}

public struct FrozenResearchEvidencePack: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let membershipId: String
    public let membershipVersion: Int
    public let market: String
    public let code: String
    public let symbol: String
    public let version: Int
    public let packFingerprint: String
    public let frozenAt: String
    public let items: [ResearchMaterialData]
    public var researchMode: String? = nil
    public var materialSelectionMode: String? = nil
    public let frozenResearchContext: FrozenResearchEvidenceContext?
    public let currentness: FrozenResearchEvidenceCurrentness

    private enum CodingKeys: String, CodingKey {
        case id
        case membershipId
        case membershipVersion
        case market
        case code
        case symbol
        case version
        case packFingerprint
        case frozenAt
        case items
        case researchMode
        case materialSelectionMode
        case frozenResearchContext
        case currentness
    }

    public func validated(expected membership: CandidateMembershipData) throws -> Self {
        let allowedInvalidations: Set<String> = [
            "superseded_by_newer_pack",
            "frozen_research_context_missing",
            "actor_changed",
            "membership_version_changed",
            "membership_state_changed",
            "material_set_changed",
            "material_source_stale",
            "source_version_review_required",
            "source_original_unavailable",
            "source_original_unknown",
            "valuation_scenario_missing",
            "valuation_scenario_changed",
            "valuation_scenario_not_recomputable",
            "valuation_anchor_changed",
            "valuation_anchor_source_changed",
            "technical_snapshot_missing",
            "technical_contract_incomplete",
            "technical_snapshot_changed",
            "technical_result_changed",
            "weinstein_evidence_stale",
            "weinstein_result_changed",
            "quant_portfolio_evidence_missing",
            "quant_portfolio_evidence_stale",
            "event_source_changed",
            "operating_monitor_changed",
            "research_context_binding_missing",
            "research_context_stale",
            "research_context_changed",
            "financial_requirement_changed"
        ]
        guard researchDocumentIsPositiveIntegerString(id),
              membershipId == membership.id,
              membershipVersion > 0,
              market == "HK",
              code.range(of: #"^\d{5}$"#, options: .regularExpression) != nil,
              symbol == "HK.\(code)",
              symbol == membership.symbol,
              version > 0,
              packFingerprint.isFrozenSHA256,
              isParseableDateTime(frozenAt),
              !items.isEmpty,
              Set(items.map(\.id)).count == items.count,
              items.allSatisfy({ $0.symbol == symbol }),
              ["current", "historical"].contains(currentness.status),
              (currentness.status == "current") == currentness.invalidatedBy.isEmpty,
              Set(currentness.invalidatedBy).count == currentness.invalidatedBy.count,
              Set(currentness.invalidatedBy).isSubset(of: allowedInvalidations) else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        guard researchMode == nil || researchMode == "limited" else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        guard materialSelectionMode == nil || materialSelectionMode == "explicit" && researchMode == "limited" else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        if researchMode == "limited" {
            guard frozenResearchContext == nil else { throw FrozenResearchEvidenceClientError.invalidResponse }
            return self
        }
        guard let context = frozenResearchContext else {
            guard currentness.status == "historical",
                  currentness.invalidatedBy.contains("frozen_research_context_missing") else {
                throw FrozenResearchEvidenceClientError.invalidResponse
            }
            return self
        }
        let valuationContractValid = context.bindingVersion == frozenResearchContextVersionV2
            ? frozenSelectedProviderFcffValid(context, pack: self, membership: membership)
            : frozenLegacyValuationValid(context, membership: membership)
        guard [frozenResearchContextVersion, frozenResearchContextVersionV2].contains(context.bindingVersion),
              context.actor.actorType == "user",
              context.actor.actorId == membership.actorId,
              context.membership.id == membershipId,
              context.membership.version == membershipVersion,
              context.membership.symbol == symbol,
              context.researchContext?.validates(membership: context.membership) ?? (
                currentness.status == "historical"
                    && currentness.invalidatedBy.contains("research_context_binding_missing")
              ),
              context.financialRequirement.map({ requirement in
                  guard let frozen = researchContextDate(frozenAt),
                        let asOf = researchContextDate(requirement.asOf),
                        let until = researchContextDate(requirement.validUntil),
                        let review = researchContextDate(requirement.nextReviewAt) else { return false }
                  return requirement.schemaVersion == ResearchFinancialRequirementData.schemaVersionV1
                      && researchDocumentIsPositiveIntegerString(requirement.id)
                      && requirement.version > 0
                      && requirement.membershipId == context.membership.id
                      && requirement.membershipVersion == context.membership.version
                      && requirement.symbol == context.membership.symbol
                      && requirement.actorType == "user"
                      && requirement.actorId == context.actor.actorId
                      && requirement.ownerConfirmed && asOf <= frozen && until > frozen && until <= review
                      && researchFinancialRequirementPeriodsValid(
                          fiscalYearEnd: requirement.fiscalYearEnd,
                          annualEnd: requirement.latestRequiredAnnualPeriodEnd,
                          interimStart: requirement.latestRequiredInterimPeriodStart,
                          interimEnd: requirement.latestRequiredInterimPeriodEnd,
                          asOf: requirement.asOf)
                      && (1...4).contains(requirement.sources.count)
                      && Set(requirement.sources.map(\.materialId)).count == requirement.sources.count
              }) ?? true,
              context.quantPortfolio?.isValid ?? true,
              context.operatingMonitor?.validates(symbol: symbol) != false,
              ["tracked", "paused", "archived"].contains(context.membership.state),
              valuationContractValid,
              context.unboundSources.isValid else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        try context.technical.validateForDisplay(market: market, code: code)
        _ = try context.weinstein.validated(
            expectedSymbol: symbol,
            analysisAsOf: context.weinstein.analysisAsOf
        )
        guard context.ownerWeinsteinZones?.validates(expected: context.weinstein) ?? true else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        guard context.technical.completeness == "complete",
              context.technical.usableForRequestedCutoff,
              context.technical.dailyBars.request.cutoff <= context.weinstein.analysisAsOf,
              context.technical.dailyBars.request.adjustment == "forward_qfq_research_only",
              context.technical.dailyBars.snapshot?.snapshotSha.isFrozenSHA256 == true,
              context.technical.technical.resultHash?.isFrozenSHA256 == true else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return self
    }
}

private func frozenLegacyValuationValid(_ context: FrozenResearchEvidenceContext,
                                        membership: CandidateMembershipData) -> Bool {
    guard let scenario = context.valuationScenario, context.selectedValuationMethods == nil else { return false }
    let methods = context.valuationMethods ?? [scenario]
    let methodIds = Set(methods.map(\.calculation.method.id)
        + (context.fcffScenario.map { [$0.calculation.methodId] } ?? []))
    return scenario.membershipId == membership.id
        && scenario.membershipVersionAtWrite == membership.version
        && scenario.symbol == membership.symbol
        && scenario.scenarioState == "current" && scenario.recomputable && scenario.invalidatedBy.isEmpty
        && calculateAnnualValuationScenarioGrid(scenario.assumptions.values) != nil
        && scenario.assumptions.authority == "owner"
        && scenario.assumptions.derivation == "manual_not_derived_from_citation"
        && [annualValuationCalculationVersion, annualAdjustedNetAssetCalculationVersion]
            .contains(scenario.calculation.method.calculationVersion)
        && researchDocumentIsPositiveIntegerString(scenario.anchor.source.materialId)
        && scenario.anchor.source.hasValidCitation
        && (context.valuationMethods == nil || (
            methods.count + (context.fcffScenario == nil ? 0 : 1) == 2
            && methodIds.count == 2
            && methodIds.isSubset(of: ["discounted_forward_metric_multiple_user_scenario",
                "adjusted_net_asset_value_user_scenario", "discounted_fcff_to_common_equity_owner_scenario"])
            && (context.fcffScenario?.validates(membership: membership) ?? true)
            && methods.allSatisfy { method in
                method.membershipId == membership.id && method.membershipVersionAtWrite == membership.version
                    && method.symbol == membership.symbol && method.scenarioState == "current"
                    && method.recomputable && method.invalidatedBy.isEmpty
                    && method.assumptions.authority == "owner"
                    && method.assumptions.derivation == "manual_not_derived_from_citation"
                    && calculateAnnualValuationScenarioGrid(method.assumptions.values) != nil
            }))
}

private func frozenSelectedProviderFcffValid(_ context: FrozenResearchEvidenceContext,
                                             pack: FrozenResearchEvidencePack,
                                             membership: CandidateMembershipData) -> Bool {
    guard context.valuationScenario == nil, context.valuationMethods == nil, context.fcffScenario == nil,
          let methods = context.selectedValuationMethods, methods.count == 2,
          case .provider(let provider) = methods[0], case .fcff(let fcff) = methods[1],
          provider.validates(membership: membership), fcff.validates(membership: membership),
          provider.membershipVersionAtWrite == pack.membershipVersion,
          fcff.membershipVersionAtWrite == pack.membershipVersion,
          provider.scenarioState == "current", provider.recomputable, provider.invalidatedBy.isEmpty,
          fcff.scenarioState == "current", fcff.recomputable, fcff.invalidatedBy.isEmpty,
          provider.createdAt <= pack.frozenAt, fcff.createdAt <= pack.frozenAt,
          provider.providerBasis.eps.capturedAt <= pack.frozenAt,
          provider.providerBasis.valuation.capturedAt <= pack.frozenAt,
          let frozenHongKongDay = fcffPublishedHongKongDay(pack.frozenAt),
          fcff.calculation.valuationCutoff <= frozenHongKongDay,
          pack.items.contains(where: { $0.id == provider.providerBasis.sourceMaterialId
              && $0.revision == provider.providerBasis.sourceMaterialRevision
              && $0.contentFingerprint == provider.providerBasis.sourceMaterialFingerprint }),
          fcff.historicalOriginals.facts.allSatisfy({ fact in
              guard let publishedDay = fcffPublishedHongKongDay(fact.publishedAt),
                    publishedDay <= fcff.calculation.valuationCutoff else { return false }
              return pack.items.contains(where: { item in
                  item.id == fact.materialId && item.revision == fact.materialRevision
              })
          }) else { return false }
    return true
}

private func frozenResearchDateIsValid(_ value: String) -> Bool {
    guard value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return false }
    let parts = value.split(separator: "-").compactMap { Int($0) }
    return parts.count == 3 && Calendar(identifier: .iso8601).date(
        from: DateComponents(year: parts[0], month: parts[1], day: parts[2])
    ) != nil
}

private func frozenResearchInstantIsValid(_ value: String?) -> Bool {
    value.map(isParseableDateTime) ?? false
}

public struct FrozenResearchEvidenceWorkspace: Codable, Equatable, Sendable {
    public struct Target: Codable, Equatable, Sendable {
        public let membershipId: String
        public let membershipVersion: Int
        public let membershipState: String
        public let market: String
        public let code: String
        public let symbol: String
    }

    public struct DataPayload: Codable, Equatable, Sendable {
        public let target: Target
        public let materials: [ResearchMaterialData]
        public let events: [ResearchAnnouncementEventData]
        public let latestGeelySalesMonitor: GeelySalesMonitorData?
        public let latestGclPvPriceMonitor: GclPvPriceMonitorData?
        public let latestPack: FrozenResearchEvidencePack?
        public let evidencePacks: [FrozenResearchEvidencePack]
        public let latestReport: TwoLayerReportData?
        public let reports: [TwoLayerReportData]
        public let reportDeletions: [TwoLayerReportDeletion]?
        public let userDecision: TwoLayerReportDecision?
        public let decisions: [TwoLayerReportDecision]
        public let completion: Completion
        public var operatingReasoning: ResearchOperatingReasoning? = nil
        public var operatingAnchorSelection: OperatingAnchorSelection? = nil
        public var providerOperatingReference: ResearchProviderOperatingReference? = nil
    }

    public struct Completion: Codable, Equatable, Sendable {
        public let state: String
        public let deepResearchComplete: Bool
        public let reasons: [String]
    }

    public let schemaVersion: String
    public let generatedAt: String
    public let status: String
    public let membershipId: String
    public let requestedActorId: String
    public let requestedSymbol: String?
    public let metadata: FactMetadata
    public let data: DataPayload?
    public let message: String

    public var isFreshForCurrentResearch: Bool {
        metadata.freshness == "fresh"
            && !metadata.stale
            && !metadata.missing
            && !metadata.conflict
    }

    public func validated(expected membership: CandidateMembershipData) throws -> Self {
        // Run the large validators in separate frames on Simulator worker threads.
        try validateWorkspaceAndEvents(expected: membership)
        try validatePacks(expected: membership)
        try validateReports(expected: membership)
        try validateAdditionalBindings(expected: membership)
        return self
    }

    @inline(never)
    private func validatePacks(expected membership: CandidateMembershipData) throws {
        guard let data else { throw FrozenResearchEvidenceClientError.invalidResponse }
        for pack in data.evidencePacks {
            _ = try pack.validated(expected: membership)
        }
    }

    @inline(never)
    private func validateReports(expected membership: CandidateMembershipData) throws {
        guard let data else { throw FrozenResearchEvidenceClientError.invalidResponse }
        for report in data.reports {
            _ = try report.validated(
                expected: membership,
                packs: data.evidencePacks,
                latestPack: data.latestPack
            )
        }
    }

    @inline(never)
    private func validateAdditionalBindings(expected membership: CandidateMembershipData) throws {
        guard let data else { throw FrozenResearchEvidenceClientError.invalidResponse }
        if let reasoning = data.operatingReasoning, !reasoning.matches(self) {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        if let reference = data.providerOperatingReference, !reference.validates(membership) {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
    }

    private func validateWorkspaceAndEvents(expected membership: CandidateMembershipData) throws {
        var metadataErrors: [String] = []
        metadata.validateForDisplay(label: "frozen research workspace", errors: &metadataErrors)
        let metadataStateMatches = switch metadata.freshness {
        case "fresh": !metadata.stale && !metadata.missing && !metadata.conflict
        case "stale": metadata.stale
        case "missing": metadata.missing
        case "conflict": metadata.conflict
        default: false
        }
        guard metadataErrors.isEmpty,
              metadataStateMatches,
              metadata.provenance == "research_only",
              metadata.authority == "research_evidence",
              schemaVersion == frozenResearchEvidenceSchemaVersion,
              status == "available",
              isParseableDateTime(generatedAt),
              membershipId == membership.id,
              requestedActorId == membership.actorId,
              requestedSymbol == membership.symbol,
              let data,
              data.target.membershipId == membership.id,
              data.target.membershipVersion == membership.version,
              data.target.membershipState == membership.state.rawValue,
              data.target.market == membership.market,
              data.target.code == membership.code,
              data.target.symbol == membership.symbol,
              Set(data.materials.map(\.id)).count == data.materials.count,
              data.materials.allSatisfy({ $0.validates(expected: membership) }),
              Set(data.events.map(\.id)).count == data.events.count,
              Set(data.evidencePacks.map(\.id)).count == data.evidencePacks.count,
              Set(data.reports.map(\.id)).count == data.reports.count,
              Set((data.reportDeletions ?? []).map(\.reportId)).count == (data.reportDeletions ?? []).count,
              (data.reportDeletions ?? []).allSatisfy({ $0.validates(expected: membership) }),
              Set(data.reports.map(\.id)).isDisjoint(with: Set((data.reportDeletions ?? []).map(\.reportId))),
              data.latestReport?.id == data.reports.first?.id,
              Set(data.decisions.map(\.id)).count == data.decisions.count,
              Set(data.decisions.map(\.reportId)).count == data.decisions.count,
              data.decisions.allSatisfy({ decision in
                data.reports.contains(where: { $0.id == decision.reportId })
                    && decision.actorType == "user"
                    && ["confirmed", "rejected"].contains(decision.decision)
                    && researchDocumentIsPositiveIntegerString(decision.id)
                    && isParseableDateTime(decision.decidedAt)
              }),
              data.userDecision == nil
                || data.userDecision?.reportId == data.latestReport?.id,
              data.userDecision?.id
                == data.decisions.first(where: {
                    $0.reportId == data.latestReport?.id
                })?.id else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        if let monitor = data.latestGeelySalesMonitor {
            _ = try monitor.validated(expected: membership)
        }
        if let monitor = data.latestGclPvPriceMonitor {
            _ = try monitor.validated(expected: membership)
        }
        for event in data.events {
            guard let material = data.materials.first(where: { $0.id == event.source.materialId }),
                  event.validates(expected: membership, material: material) else {
                throw FrozenResearchEvidenceClientError.invalidResponse
            }
        }
    }
}

public struct ResearchAnnouncementEventSource: Codable, Equatable, Sendable {
    public let materialId: String
    public let evidenceId: String
    public let sourceType: String
    public let sourceUrl: String?
    public let publishedAt: String
    public let capturedAt: String
    public let claimType: String
    public let verificationStatus: String
    public let rightsStatus: String
    public let sourceVersion: String
    public let contentFingerprint: String
    public let validUntil: String
    public let freshness: String
    public let revision: Int
    public let revisionState: String
    public let variableName: String
    public let stance: String
    public let reliability: Int?
    public let materiality: Int?
}

public struct ResearchAnnouncementEventSafety: Codable, Equatable, Sendable {
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let mutatesCash: Bool
    public let writesFee: Bool
    public let mutatesPosition: Bool
    public let callsBroker: Bool
    public let productionWrite: Bool

    var isAdvisoryOnly: Bool {
        !createsOrder && !createsTrade && !mutatesCash && !writesFee
            && !mutatesPosition && !callsBroker && !productionWrite
    }
}

public struct ResearchAnnouncementEventData: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let eventVersion: Int
    public let eventFingerprint: String
    public let membershipId: String
    public let membershipVersion: Int
    public let market: String
    public let code: String
    public let symbol: String
    public let eventKind: String
    public let coverageScope: String
    public let keyVariable: String
    public let importance: String
    public let importanceReasons: [String]
    public let hypothesisImpact: String
    public let source: ResearchAnnouncementEventSource
    public let monitorRuleBinding: ResearchMonitorRule?
    public let holdingBinding: ResearchEventHoldingBinding?
    public let createdAt: String
    public let safety: ResearchAnnouncementEventSafety

    func validates(expected membership: CandidateMembershipData, material: ResearchMaterialData) -> Bool {
        researchDocumentIsPositiveIntegerString(id)
            && eventVersion > 0
            && eventFingerprint.isFrozenSHA256
            && membershipId == membership.id
            && membershipVersion == membership.version
            && market == membership.market
            && code == membership.code
            && symbol == membership.symbol
            && ResearchEventCaptureDraft.supportedEventKinds.contains(eventKind)
            && ["current_holding", "research_stock"].contains(coverageScope)
            && (coverageScope == "research_stock"
                ? holdingBinding == nil
                : holdingBinding?.isExactCurrentHoldingIdentity == true)
            && (monitorRuleBinding == nil || coverageScope == "research_stock")
            && material.variableName == Optional(keyVariable)
            && ["high", "medium", "low", "unknown"].contains(importance)
            && importanceReasons.isEmpty == false
            && ["supports", "weakens", "unknown"].contains(hypothesisImpact)
            && (monitorRuleBinding?.binds(eventKind: eventKind, variableName: keyVariable) ?? true)
            && source.materialId == material.id
            && source.evidenceId == material.evidenceId
            && source.sourceType == material.sourceType
            && source.sourceUrl == material.sourceUrl
            && source.publishedAt == material.publishedAt
            && source.capturedAt == material.capturedAt
            && source.claimType == material.claimType
            && source.verificationStatus == material.verificationStatus
            && source.rightsStatus == material.rightsStatus
            && source.sourceVersion == material.sourceVersion
            && source.contentFingerprint == material.contentFingerprint
            && source.validUntil == material.validUntil
            && source.freshness == material.freshness
            && source.revision == material.revision
            && source.revisionState == material.revisionState
            && source.variableName == keyVariable
            && source.stance == material.stance
            && source.reliability == material.reliability
            && source.materiality == material.materiality
            && isParseableDateTime(createdAt)
            && safety.isAdvisoryOnly
    }
}

extension GclPvSourceEvent {
    func matches(workspaceEvent event: ResearchAnnouncementEventData) -> Bool {
        event.id == eventId && event.eventVersion == eventVersion && event.eventFingerprint == eventFingerprint
            && event.symbol == symbol && event.eventKind == eventKind && event.coverageScope == coverageScope
            && event.holdingBinding == holdingBinding && event.keyVariable == keyVariable && event.hypothesisImpact == hypothesisImpact
            && event.source.materialId == materialId && event.source.contentFingerprint == materialFingerprint
            && event.source.sourceType == sourceType && event.source.sourceUrl == sourceUrl && event.source.publishedAt == publishedAt
            && event.source.capturedAt == capturedAt && event.source.validUntil == validUntil && event.source.rightsStatus == rightsStatus
            && event.source.verificationStatus == verificationStatus && event.source.sourceVersion == sourceVersion && event.source.revision == revision
    }
}

public struct CreateResearchEventRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let materialId: String
    public let eventKind: String
    public let coverageScope: String
    public let monitorRuleBinding: ResearchMonitorRule?
    public let idempotencyKey: String
}

public enum FrozenResearchEvidenceClientError: Error, Equatable, Sendable {
    case invalidResponse
    case bindingDrift
    case providerUnavailable
    case taskFailed
    case taskFailure(String)
    case httpStatus(Int)
}

extension String {
    var isFrozenSHA256: Bool {
        range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
    }
}
