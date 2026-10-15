import Foundation

public let evidenceBoundReportContractVersion =
    "2026-07-30.s1e-evidence-bound-two-layer-report.v1"
public let legacyReportContractVersion = "2026-07-25.deep-research-legacy.v1"
public let deepResearchSynthesisPromptVersion =
    "deep-research-snapshot-synthesis.v7"
public let supportedDeepResearchSynthesisPromptVersions = ["deep-research-snapshot-synthesis.v1", "deep-research-snapshot-synthesis.v2", "deep-research-snapshot-synthesis.v3", "deep-research-snapshot-synthesis.v4", "deep-research-snapshot-synthesis.v5", "deep-research-snapshot-synthesis.v6", "deep-research-snapshot-synthesis.v7"]

public struct TwoLayerReportCitation: Codable, Equatable, Sendable {
    public let kind: String
    public let evidenceId: String?
    public let documentId: String?
    public let pageNumber: Int?
    public let pageTextSha256: String?
    public var sourceMembership: ResearchContextSourceMembership? = nil
    public var materialId: String? = nil
    public var materialRevision: Int? = nil
    public var contentFingerprint: String? = nil
    public var sourceType: String? = nil
    public var sourceUrl: String? = nil
    public var sourceVersion: String? = nil
    public var snapshotCitation: ResearchSnapshotCitation? = nil
    public var snapshotRawSha256: String? = nil
    public var providerOriginal: ResearchPeerMaterialCitation.ProviderOriginal? = nil
    public var snapshotId: String? = nil
    public var textSha256: String? = nil
    public var startUtf16: Int? = nil
    public var endUtf16: Int? = nil
    public var excerptSha256: String? = nil
    public var rawSha256: String? = nil
    public var byteLength: Int? = nil
    public var mediaType: String? = nil
    public var canonicalUrl: String? = nil
    public var responseUrl: String? = nil

    public var reopenableSnapshotCitation: (ResearchSnapshotCitation, ResearchSnapshotOriginal)? {
        guard kind == "source_snapshot", let snapshotId, let textSha256, let startUtf16,
              let endUtf16, let excerptSha256, let rawSha256, let byteLength,
              let mediaType, let canonicalUrl, let responseUrl else { return nil }
        let citation = ResearchSnapshotCitation(kind: kind, snapshotId: snapshotId,
            textSha256: textSha256, startUtf16: startUtf16, endUtf16: endUtf16,
            excerptSha256: excerptSha256)
        let original = ResearchSnapshotOriginal(rawSha256: rawSha256, byteLength: byteLength,
            mediaType: mediaType, canonicalUrl: canonicalUrl, responseUrl: responseUrl)
        return citation.isValid && original.isValid ? (citation, original) : nil
    }

    public var reopenableDocumentCitation: ResearchContextCitation? {
        guard kind == "document_page",
              let documentId, let pageNumber, let pageTextSha256 else { return nil }
        return ResearchContextCitation(
            documentId: documentId,
            pageNumber: pageNumber,
            pageTextSha256: pageTextSha256,
            sourceType: "synthesis_snapshot_citation",
            sourceUrl: nil,
            sourceVersion: deepResearchSynthesisReportContractVersion,
            sourceMembership: sourceMembership
        )
    }

    public var reopenablePeerOriginalCitation: ResearchPeerMaterialCitation? {
        guard kind == "peer_original", let materialId, let materialRevision,
              let contentFingerprint, let sourceType, let sourceVersion,
              ["issuer_public_html", "futu_opend_financial_statement_provider"].contains(sourceType),
              (sourceType == "issuer_public_html"
                ? snapshotCitation != nil && snapshotRawSha256 != nil && sourceUrl != nil
                : providerOriginal != nil && sourceUrl == nil) else { return nil }
        return ResearchPeerMaterialCitation(kind: "saved_material", materialId: materialId,
            materialRevision: materialRevision, contentFingerprint: contentFingerprint,
            sourceType: sourceType, sourceUrl: sourceUrl, sourceVersion: sourceVersion,
            snapshotCitation: snapshotCitation, snapshotRawSha256: snapshotRawSha256,
            providerOriginal: providerOriginal, sourceMembership: sourceMembership)
    }
}

public struct TwoLayerReportFact: Codable, Equatable, Sendable {
    public let statement: String
    public let evidenceIds: [String]
    public let sourceKind: String?
    public let claimType: String?
    public let stance: String?
    public let sourceId: String?
    public let citation: TwoLayerReportCitation?

    public init(
        statement: String,
        evidenceIds: [String],
        sourceKind: String? = nil,
        claimType: String? = nil,
        stance: String? = nil,
        sourceId: String? = nil,
        citation: TwoLayerReportCitation? = nil
    ) {
        self.statement = statement
        self.evidenceIds = evidenceIds
        self.sourceKind = sourceKind
        self.claimType = claimType
        self.stance = stance
        self.sourceId = sourceId
        self.citation = citation
    }
}

public struct TwoLayerReportConflict: Codable, Equatable, Sendable {
    public let description: String
    public let evidenceIds: [String]
}

public struct TwoLayerReportPackBinding: Codable, Equatable, Sendable {
    public struct Valuation: Codable, Equatable, Sendable {
        public let scenarioId: String
        public let scenarioRevision: Int
        public let assumptions: ResearchValuationAssumptions
        public let calculationVersion: String
    }

    public struct SelectedValuation: Codable, Equatable, Sendable {
        public let basisKind: String
        public let scenarioId: String
        public let scenarioRevision: Int
        public let methodId: String
        public let sourceFingerprint: String
        public let calculationVersion: String
    }

    public struct Technical: Codable, Equatable, Sendable {
        public let snapshotSha: String
        public let resultHash: String
        public let dataCutoffAt: String
        public let adjustment: String
        public let computationVersion: String
    }

    public let id: String
    public let version: Int
    public let fingerprint: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let frozenAt: String
    public let contextVersion: String
    public let valuation: Valuation?
    public var valuationMethods: [SelectedValuation]? = nil
    public let technical: Technical?
    public var quantPortfolio: FrozenQuantPortfolioEvidenceBinding? = nil
}

public struct TwoLayerReportReproducibility: Codable, Equatable, Sendable {
    public let generationMethod: String
    public let model: String
    public let prompt: String
    public let provider: String
    public let tokenUsage: String
    public let cost: String

    public static let deterministicFramework = Self(
        generationMethod: "deterministic_frozen_fact_framework",
        model: "NOT_USED",
        prompt: "NOT_USED",
        provider: "NOT_USED",
        tokenUsage: "NOT_USED",
        cost: "NOT_USED"
    )
}

public struct TwoLayerReportView: Codable, Equatable, Sendable {
    public let view: String
    public let conditions: [String]
    public let invalidationConditions: [String]
    public let risks: [String]
}

public struct TwoLayerAdvice: Codable, Equatable, Sendable {
    public struct Conflict: Codable, Equatable, Sendable {
        public let status: String
        public let description: String
    }

    public let conclusion: String
    public let confidence: String
    public let applicableUntil: String
    public let horizonStatement: String
    public let longTerm: TwoLayerReportView
    public let mediumShortTerm: TwoLayerReportView
    public let conflict: Conflict
    public var direction: String? = nil
    public var priceConditions: [String]? = nil
    public var priceRange: String? = nil
    public var researchPositionRange: String? = nil
    public var assumptions: [String]? = nil
    public var scenarios: [String]? = nil
    public var nextQuestion: String? = nil
    public var versionChange: String? = nil
    public let automaticTradingSignal: Bool

    public var hasFormalRecommendation: Bool {
        DecisionActionIntent(rawValue: direction ?? "") != nil
            && priceConditions != nil
            && !(priceRange ?? "").isEmpty
            && !(researchPositionRange ?? "").isEmpty
            && assumptions != nil
            && scenarios != nil
            && !(nextQuestion ?? "").isEmpty
            && !(versionChange ?? "").isEmpty
            && automaticTradingSignal == false
    }
}

public struct TwoLayerResearch: Codable, Equatable, Sendable {
    public let fundamentals: [TwoLayerReportFact]
    public var context: [TwoLayerReportFact]? = nil
    public let valuation: [TwoLayerReportFact]
    public let technical: [TwoLayerReportFact]
    public var quantPortfolio: [TwoLayerReportFact]? = nil
    public let eventsAndCatalysts: [TwoLayerReportFact]
    public var operatingMonitor: [TwoLayerReportFact]? = nil
    public let risks: [TwoLayerReportFact]
    public let counterevidence: [TwoLayerReportFact]
    public let unknowns: [TwoLayerReportFact]
    public let sourceConflicts: [TwoLayerReportConflict]
    public let nextValidationQuestions: [String]
}

public struct TwoLayerResearchDraft: Codable, Equatable, Sendable {
    public let fundamentals: [TwoLayerReportFact]
    public let eventsAndCatalysts: [TwoLayerReportFact]
    public let risks: [TwoLayerReportFact]
    public let counterevidence: [TwoLayerReportFact]
    public let unknowns: [TwoLayerReportFact]
    public let sourceConflicts: [TwoLayerReportConflict]
    public let nextValidationQuestions: [String]
}

public struct CreateTwoLayerReportRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let evidencePackId: String
    public let idempotencyKey: String
    public let reportContractVersion: String
    public let evidencePackBinding: TwoLayerReportPackBinding
    public let reproducibility: TwoLayerReportReproducibility
    public let adviceLayer: TwoLayerAdvice
    public let researchLayer: TwoLayerResearchDraft
    public let changeFromPrevious: String

    public var canonicalStoredResearchLayer: TwoLayerResearch {
        TwoLayerResearch(
            fundamentals: researchLayer.fundamentals,
            valuation: evidencePackBinding.valuationMethods.map { methods in methods.map { method in
                TwoLayerReportFact(
                    statement: "method=\(method.methodId) basis=\(method.basisKind) scenario=\(method.scenarioId) revision=\(method.scenarioRevision) calculation=\(method.calculationVersion)",
                    evidenceIds: [], sourceKind: "valuation_context", claimType: "pack_context", stance: "neutral"
                )
            } } ?? evidencePackBinding.valuation.map { valuation in [
                TwoLayerReportFact(
                    statement: "scenario=\(valuation.scenarioId) revision=\(valuation.scenarioRevision) currency=\(valuation.assumptions.values.metricCurrency ?? "UNKNOWN") numericAssumptions=8 calculation=\(valuation.calculationVersion)",
                    evidenceIds: [],
                    sourceKind: "valuation_context",
                    claimType: "pack_context",
                    stance: "neutral"
                )
            ] } ?? [],
            technical: evidencePackBinding.technical.map { technical in [
                TwoLayerReportFact(
                    statement: "snapshot=\(technical.snapshotSha) result=\(technical.resultHash) cutoff=\(technical.dataCutoffAt) adjustment=\(technical.adjustment) computation=\(technical.computationVersion)",
                    evidenceIds: [],
                    sourceKind: "technical_context",
                    claimType: "pack_context",
                    stance: "neutral"
                )
            ] } ?? [],
            eventsAndCatalysts: researchLayer.eventsAndCatalysts,
            risks: researchLayer.risks,
            counterevidence: researchLayer.counterevidence,
            unknowns: researchLayer.unknowns,
            sourceConflicts: researchLayer.sourceConflicts,
            nextValidationQuestions: researchLayer.nextValidationQuestions
        )
    }

    public func matchesCanonicalStoredProjection(
        _ payload: TwoLayerStoredPayload
    ) -> Bool {
        payload.reportContractVersion == reportContractVersion
            && payload.evidencePackBinding == evidencePackBinding
            && payload.reproducibility == reproducibility
            && payload.adviceLayer == adviceLayer
            && payload.researchLayer == canonicalStoredResearchLayer
            && payload.changeFromPrevious == changeFromPrevious
    }
}

public struct DecideTwoLayerReportRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let decision: String
    public let note: String?
    public let idempotencyKey: String
}

public struct DeleteTwoLayerReportRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let reportFingerprint: String
    public let ownerConfirmed: Bool
    public let idempotencyKey: String

    public init(membershipVersion: Int, reportFingerprint: String, idempotencyKey: String) {
        self.membershipVersion = membershipVersion
        self.reportFingerprint = reportFingerprint
        ownerConfirmed = true
        self.idempotencyKey = idempotencyKey
    }
}

public struct TwoLayerReportDeletion: Codable, Equatable, Identifiable, Sendable {
    public let reportId: String
    public let evidencePackId: String
    public let reportVersion: Int
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let reportFingerprint: String
    public let deletedAt: String
    public let state: String

    public var id: String { reportId }

    public func validates(expected membership: CandidateMembershipData) -> Bool {
        researchDocumentIsPositiveIntegerString(reportId)
            && researchDocumentIsPositiveIntegerString(evidencePackId)
            && reportVersion > 0
            && membershipId == membership.id
            && (1...membership.version).contains(membershipVersion)
            && symbol == membership.symbol
            && (reportFingerprint.isTwoLayerSHA256 || reportFingerprint == "UNKNOWN")
            && isParseableDateTime(deletedAt)
            && state == "deleted"
    }
}

public struct TwoLayerReportCurrentness: Codable, Equatable, Sendable {
    public let status: String
    public let invalidatedBy: [String]
    public let evidencePackInvalidatedBy: [String]
}

/// The stored report already contains the complete immutable snapshot. Decode only the
/// selected context coordinates needed to reopen its original document pages.
public struct TwoLayerFrozenSnapshot: Codable, Equatable, Sendable {
    public struct Target: Codable, Equatable, Sendable {
        public let membershipId: String
        public let membershipVersion: Int
        public let symbol: String
    }
    public struct Intent: Codable, Equatable, Sendable {
        public let selectedResearchContext: DeepResearchTaskIntent.SelectedResearchContext?
    }
    public struct SelectedContext: Codable, Equatable, Sendable {
        public let contextId: String
        public let contentHash: String
        public let membershipId: String
        public let membershipVersion: Int
        public let selectedSymbol: String
        public let cutoffAt: String
        public let validUntil: String
        public let selectedFacts: [ResearchContextNumericFact]
        public let peerFacts: [ResearchContextNumericFact]?
        public let peers: [ResearchContextPeer]
    }
    public let snapshotId: String
    public let target: Target
    public let intent: Intent
    public let selectedResearchContext: SelectedContext?

    public func binds(_ binding: DeepResearchSnapshotBinding) -> Bool {
        guard snapshotId == binding.snapshotId,
              target.membershipId == binding.membershipId,
              target.membershipVersion == binding.membershipVersion,
              target.symbol == binding.symbol else { return false }
        switch (intent.selectedResearchContext, selectedResearchContext) {
        case (nil, nil): return true
        case let (selection?, selected?):
            return selection.contextId == selected.contextId
                && selection.contentHash == selected.contentHash
                && selected.membershipId == target.membershipId
                && selected.membershipVersion == target.membershipVersion
                && selected.selectedSymbol == target.symbol
                && areDateTimeInstantsChronologicallyOrdered([selected.cutoffAt, binding.cutoffAt])
                && areDateTimeInstantsChronologicallyOrdered([selected.cutoffAt, selected.validUntil])
                && selected.selectedFacts.map(\.id) == selection.selectedFactIds
                && (selected.peerFacts ?? []).map(\.id) == (selection.peerFactIds ?? [])
                && selected.peers.map(\.id) == selection.peerIds
        default: return false
        }
    }
}

public struct TwoLayerStoredPayload: Codable, Equatable, Sendable {
    public let researchQuestion: String
    public let cutoffAt: String
    public let investmentThesis: String
    public let factTable: [TwoLayerReportFact]
    public let supportEvidenceIds: [String]
    public let counterEvidenceIds: [String]
    public let sourceConflictAssessment: String
    public let sourceConflicts: [TwoLayerReportConflict]
    public let unknownItems: [String]
    public let keyDrivers: [String]
    public let causalChain: [String]
    public let valuationScenarios: [String]
    public let impliedExpectations: [String]
    public let invalidationConditions: [String]
    public let changeFromPrevious: String
    public let portfolioImpact: [String]
    public let nextValidationQuestions: [String]
    public let modelInferences: [TwoLayerReportFact]
    public let reportContractVersion: String?
    public let evidencePackBinding: TwoLayerReportPackBinding?
    public let reproducibility: TwoLayerReportReproducibility?
    var sendManifest: DeepResearchTaskEnvelope.Task.Synthesis.SendManifest? = nil
    public let adviceLayer: TwoLayerAdvice?
    public let researchLayer: TwoLayerResearch?
    public var snapshotBinding: DeepResearchSnapshotBinding? = nil
    public var snapshot: TwoLayerFrozenSnapshot? = nil
}

public struct TwoLayerReportData: Codable, Equatable, Identifiable, Sendable {
    public enum PresentationState: String, Equatable, Sendable {
        case historical
        case currentIncomplete
        case formalizable
    }
    public let id: String
    public let evidencePackId: String
    public let version: Int
    public let contractVersion: String
    public let reportFingerprint: String
    public let currentness: TwoLayerReportCurrentness
    public let status: String
    public let gateFailures: [String]
    public let payload: TwoLayerStoredPayload
    public let createdAt: String

    public var isFormalizable: Bool {
        isCurrentExact
            && status == "complete_pending_confirmation"
            && gateFailures.isEmpty
    }

    public var isImmutableExact: Bool {
        [evidenceBoundReportContractVersion, deepResearchSynthesisReportContractVersion]
            .contains(contractVersion)
            && reportFingerprint.isTwoLayerSHA256
            && payload.reportContractVersion == contractVersion
            && payload.evidencePackBinding?.id == evidencePackId
            && payload.adviceLayer?.automaticTradingSignal == false
            && currentness.invalidatedBy.allSatisfy({
                !["report_fingerprint_invalid", "evidence_pack_identity_mismatch", "legacy_single_valuation_contract_projection"]
                    .contains($0)
            })
            && (contractVersion != deepResearchSynthesisReportContractVersion
                || payload.synthesisIdentityIsExact)
    }

    public var isCurrentExact: Bool {
        isImmutableExact
            && currentness.status == "current"
            && currentness.invalidatedBy.isEmpty
            && currentness.evidencePackInvalidatedBy.isEmpty
    }

    public var presentationState: PresentationState {
        if !isCurrentExact { return .historical }
        return isFormalizable ? .formalizable : .currentIncomplete
    }

    public func validated(
        expected membership: CandidateMembershipData,
        packs: [FrozenResearchEvidencePack],
        latestPack: FrozenResearchEvidencePack?
    ) throws -> Self {
        let reasons = Set(currentness.invalidatedBy)
        let allowedReasons: Set<String> = [
            "superseded_by_newer_report",
            "legacy_contract_not_formalizable", "report_fingerprint_missing",
            "report_fingerprint_invalid", "evidence_pack_historical",
            "not_latest_current_evidence_pack", "legacy_single_valuation_contract_projection",
            "evidence_pack_identity_mismatch", "selected_snapshot_changed"
        ]
        guard researchDocumentIsPositiveIntegerString(id),
              researchDocumentIsPositiveIntegerString(evidencePackId),
              version > 0,
              Set(currentness.invalidatedBy).count == currentness.invalidatedBy.count,
              Set(currentness.evidencePackInvalidatedBy).count
                == currentness.evidencePackInvalidatedBy.count,
              reasons.isSubset(of: allowedReasons),
              ["current", "historical"].contains(currentness.status),
              (currentness.status == "current")
                == (currentness.invalidatedBy.isEmpty
                    && currentness.evidencePackInvalidatedBy.isEmpty),
              ["evidence_insufficient", "complete_pending_confirmation"].contains(status),
              (status == "complete_pending_confirmation") == gateFailures.isEmpty,
              isParseableDateTime(createdAt),
              let pack = packs.first(where: { $0.id == evidencePackId }) else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        if contractVersion == legacyReportContractVersion {
            guard reportFingerprint == "UNKNOWN",
                  currentness.status == "historical",
                  reasons.contains("legacy_contract_not_formalizable"),
                  payload.reportContractVersion == nil else {
                throw FrozenResearchEvidenceClientError.invalidResponse
            }
            return self
        }
        guard [evidenceBoundReportContractVersion, deepResearchSynthesisReportContractVersion]
                .contains(contractVersion),
              reportFingerprint.isTwoLayerSHA256,
              payload.reportContractVersion == contractVersion,
              let binding = payload.evidencePackBinding,
              binding.id == pack.id,
              binding.version == pack.version,
              binding.fingerprint == pack.packFingerprint,
              binding.membershipId == pack.membershipId,
              binding.membershipVersion == pack.membershipVersion,
              binding.symbol == pack.symbol,
              binding.frozenAt == pack.frozenAt,
              binding.contextVersion == (pack.researchMode == "limited" ? limitedResearchContextVersion
                : pack.frozenResearchContext?.bindingVersion ?? frozenResearchContextVersion),
              payload.adviceLayer?.automaticTradingSignal == false,
              let research = payload.researchLayer else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        if pack.researchMode == "limited" {
            guard contractVersion == deepResearchSynthesisReportContractVersion,
                  binding.valuation == nil, binding.technical == nil, binding.quantPortfolio == nil,
                  pack.frozenResearchContext == nil,
                  status == "evidence_insufficient", !gateFailures.isEmpty,
                  payload.synthesisIdentityIsExact,
                  payload.cutoffAt == binding.frozenAt,
                  payload.adviceLayer?.direction == "wait_for_evidence",
                  payload.adviceLayer?.priceRange == "UNKNOWN",
                  payload.adviceLayer?.researchPositionRange == "UNKNOWN",
                  research.valuation.isEmpty, research.technical.isEmpty, research.quantPortfolio == nil,
                  currentness.status != "current" || (latestPack?.id == pack.id && pack.currentness.status == "current") else {
                throw FrozenResearchEvidenceClientError.invalidResponse
            }
            return self
        }
        guard let context = pack.frozenResearchContext else {
            guard currentness.status == "historical",
                  pack.currentness.status == "historical",
                  pack.currentness.invalidatedBy.contains("frozen_research_context_missing"),
                  currentness.evidencePackInvalidatedBy.contains("frozen_research_context_missing") else {
                throw FrozenResearchEvidenceClientError.invalidResponse
            }
            return self
        }
        let selected = context.selectedValuationMethods ?? []
        let selectedBindings = selected.map { method -> TwoLayerReportPackBinding.SelectedValuation in
            switch method {
            case .provider(let provider): return .init(basisKind: "provider", scenarioId: provider.id,
                scenarioRevision: provider.revision, methodId: provider.calculation.method.id,
                sourceFingerprint: provider.providerBasis.sourceMaterialFingerprint,
                calculationVersion: provider.calculation.method.calculationVersion)
            case .fcff(let fcff): return .init(basisKind: "fcff", scenarioId: fcff.id,
                scenarioRevision: fcff.revision, methodId: fcff.calculation.methodId,
                sourceFingerprint: fcff.sourceFingerprint,
                calculationVersion: fcff.calculation.calculationVersion)
            }
        }
        let legacyValuationMatches = context.valuationScenario.map { scenario in
            binding.valuation?.scenarioId == scenario.id
                && binding.valuation?.scenarioRevision == scenario.revision
                && binding.valuation?.assumptions == scenario.assumptions
                && binding.valuation?.calculationVersion == scenario.calculation.method.calculationVersion
                && binding.valuationMethods == nil
        } ?? false
        guard (context.bindingVersion == frozenResearchContextVersionV2
                ? (binding.valuation == nil && binding.valuationMethods == selectedBindings && selectedBindings.count == 2)
                : legacyValuationMatches),
              let technical = binding.technical,
              technical.snapshotSha
                == context.technical.dailyBars.snapshot?.snapshotSha,
              technical.resultHash == context.technical.technical.resultHash,
              technical.dataCutoffAt
                == context.technical.dailyBars.source.dataCutoffAt,
              technical.adjustment == context.technical.dailyBars.request.adjustment,
              technical.computationVersion
                == context.technical.technical.computationVersion,
              binding.quantPortfolio == context.quantPortfolio else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        let valuationMethods = context.valuationMethods ?? (context.valuationScenario.map { [$0] } ?? [])
        var expectedValuationStatements = try valuationMethods.map { scenario in
            if contractVersion == deepResearchSynthesisReportContractVersion,
               payload.snapshotBinding?.analysisContentVersion == "2026-09-10.v1" {
                let number = { (value: Double) in
                    try portfolioDecisionJavaScriptNumber(floor(value * 1e6 + 0.5) / 1e6)
                }
                let diagonal = try scenario.calculation.diagonal.map { item in
                    "\(item.scenario)=\(try number(item.presentValuePerShare))（增长率=\(try number(item.annualGrowthRate))，倍数=\(try number(item.terminalMultiple))）"
                }.joined(separator: "；")
                return "方法：\(scenario.calculation.method.id)；币种：\(scenario.assumptions.values.metricCurrency ?? "UNKNOWN")；每股研究情景值：\(try number(scenario.calculation.scenarioPresentValuePerShare))；\(diagonal)。数值基于Owner情景假设，不是预测或当前报价。"
            }
            return contractVersion == deepResearchSynthesisReportContractVersion
                ? "method=\(scenario.calculation.method.id) scenario=\(scenario.id) revision=\(scenario.revision) currency=\(scenario.assumptions.values.metricCurrency ?? "UNKNOWN") calculation=\(scenario.calculation.method.calculationVersion)"
                : "scenario=\(scenario.id) revision=\(scenario.revision) currency=\(scenario.assumptions.values.metricCurrency ?? "UNKNOWN") numericAssumptions=8 calculation=\(scenario.calculation.method.calculationVersion)"
        }
        if let fcff = context.fcffScenario {
            let calc = fcff.calculation
            if contractVersion == deepResearchSynthesisReportContractVersion,
               payload.snapshotBinding?.analysisContentVersion == "2026-09-10.v1" {
                let number = { (value: Double) in
                    try portfolioDecisionJavaScriptNumber(floor(value * 1e6 + 0.5) / 1e6)
                }
                let annual = try calc.annual.map { "\($0.periodStart)~\($0.periodEnd)@\($0.paymentDate):\(try number($0.fcff))" }
                    .joined(separator: ",")
                expectedValuationStatements.append("方法：\(calc.methodId)；币种：\(calc.currency)；每股研究情景值：\(try number(calc.commonEquityValuePerShare))；FCFF年度预测=\(annual)；终值下一年FCFF=\(try number(calc.terminalNextYearFcff))；WACC=\(try number(fcff.assumptions.values.wacc))；g=\(try number(fcff.assumptions.values.terminalGrowthRate))。数值基于Owner情景假设，不是预测或当前报价。")
            } else if contractVersion == deepResearchSynthesisReportContractVersion {
                expectedValuationStatements.append("method=\(calc.methodId) scenario=\(fcff.id) revision=\(fcff.revision) currency=\(calc.currency) calculation=\(calc.calculationVersion)")
            } else {
                expectedValuationStatements.append("scenario=\(fcff.id) revision=\(fcff.revision) currency=\(calc.currency) method=\(calc.methodId) calculation=\(calc.calculationVersion) valuePerShare=\(try portfolioDecisionJavaScriptNumber(calc.commonEquityValuePerShare))")
            }
        }
        if !selected.isEmpty {
            let number = { (value: Double) in try portfolioDecisionJavaScriptNumber(floor(value * 1e6 + 0.5) / 1e6) }
            expectedValuationStatements = try selected.map { method in
                switch method {
                case .provider(let provider):
                    let basis = provider.providerBasis
                    return "方法：\(provider.calculation.method.id)；来源：OpenD第三方EPS/PE，非发行人原报；EPS：\(basis.eps.rawValue) \(basis.eps.currencyCode)/股；EPS捕获：\(basis.eps.financialCaptureId)/\(basis.eps.rawSha256)；PE捕获：\(basis.valuation.captureId)/\(basis.valuation.rawSha256)；材料：\(basis.sourceMaterialId) r\(basis.sourceMaterialRevision)；Owner情景每股值：\(try number(provider.calculation.scenarioPresentValuePerShare)) \(provider.assumptions.values.metricCurrency ?? "UNKNOWN")/股；currencyConversion=NONE，不与港币现价直接比较。"
                case .fcff(let fcff):
                    let calc = fcff.calculation
                    let annual = try calc.annual.map { "\($0.periodStart)~\($0.periodEnd)@\($0.paymentDate):\(try number($0.fcff))" }.joined(separator: ",")
                    return "方法：\(calc.methodId)；来源：发行人历史原值与Owner未来假设；币种：\(calc.currency)；估值截止：\(calc.valuationCutoff)；余额参考：\(calc.balanceReferenceDate)；每股研究情景值：\(try number(calc.commonEquityValuePerShare))；FCFF预测=\(annual)；WACC=\(try number(fcff.assumptions.values.wacc))；g=\(try number(fcff.assumptions.values.terminalGrowthRate))。数值基于Owner情景假设，不是预测或当前报价。"
                }
            }
        }
        let valuationStatements = research.valuation.map(\.statement)
        let isReadableLegacySingleValuation = currentness.status == "historical"
            && context.valuationMethods?.count == 2
            && reasons.contains("legacy_single_valuation_contract_projection")
            && valuationStatements == Array(expectedValuationStatements.prefix(1))
        guard (valuationStatements == expectedValuationStatements
                || isReadableLegacySingleValuation),
              research.valuation.allSatisfy({
                  $0.sourceKind == "valuation_context"
                      && $0.claimType == "pack_context"
                      && $0.stance == "neutral"
                      && $0.evidenceIds.isEmpty
              }) else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        if contractVersion == deepResearchSynthesisReportContractVersion {
            guard payload.synthesisIdentityIsExact,
                  let snapshot = payload.snapshotBinding,
                  snapshot.cutoffAt == payload.cutoffAt,
                  snapshot.cutoffAt == binding.frozenAt,
                  snapshot.membershipId == binding.membershipId,
                  snapshot.membershipVersion == binding.membershipVersion,
                  snapshot.symbol == binding.symbol,
                  snapshot.evidencePackId == binding.id,
                  snapshot.evidencePackVersion == binding.version,
                  snapshot.evidencePackFingerprint == binding.fingerprint else {
                throw FrozenResearchEvidenceClientError.invalidResponse
            }
            if let quant = context.quantPortfolio {
                let missing = quant.decision.status == "source_missing"
                    && quant.portfolio.status == "source_missing"
                guard research.quantPortfolio?.count == 1,
                      research.quantPortfolio?[0].sourceKind
                        == (missing ? "source_missing" : "quant_portfolio_context"),
                      research.quantPortfolio?[0].claimType == (missing ? "UNKNOWN" : "pack_context"),
                      research.quantPortfolio?[0].stance == (missing ? "UNKNOWN" : "neutral"),
                      research.quantPortfolio?[0].evidenceIds.isEmpty == true else {
                    throw FrozenResearchEvidenceClientError.invalidResponse
                }
            } else if research.quantPortfolio != nil {
                throw FrozenResearchEvidenceClientError.invalidResponse
            }
            if currentness.status == "current" {
                guard latestPack?.id == pack.id,
                      pack.currentness.status == "current" else {
                    throw FrozenResearchEvidenceClientError.invalidResponse
                }
            }
            return self
        }
        guard payload.reproducibility == .deterministicFramework else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        let materialByEvidenceId = Dictionary(
            uniqueKeysWithValues: pack.items.map { ($0.evidenceId, $0) }
        )
        for fact in research.fundamentals
            + research.eventsAndCatalysts
            + research.risks
            + research.counterevidence
            + research.unknowns {
            switch fact.sourceKind {
            case "source_missing":
                guard fact.evidenceIds.isEmpty,
                      fact.claimType == "UNKNOWN",
                      fact.stance == "UNKNOWN",
                      fact.statement.contains("source_missing/UNKNOWN") else {
                    throw FrozenResearchEvidenceClientError.invalidResponse
                }
            case "material":
                guard !fact.evidenceIds.isEmpty,
                      fact.evidenceIds.allSatisfy({
                        materialByEvidenceId[$0]?.claimType == fact.claimType
                            && materialByEvidenceId[$0]?.stance == fact.stance
                      }) else {
                    throw FrozenResearchEvidenceClientError.invalidResponse
                }
            default:
                throw FrozenResearchEvidenceClientError.invalidResponse
            }
        }
        guard research.technical.count == 1,
              research.technical[0].sourceKind == "technical_context",
              research.technical[0].claimType == "pack_context",
              research.technical[0].stance == "neutral",
              research.technical[0].evidenceIds.isEmpty else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        if currentness.status == "current" {
            guard latestPack?.id == pack.id,
                  pack.currentness.status == "current",
                  payload.evidencePackBinding?.id == latestPack?.id else {
                throw FrozenResearchEvidenceClientError.invalidResponse
            }
        }
        return self
    }
}
private extension TwoLayerStoredPayload {
    var synthesisIdentityIsExact: Bool {
        guard let binding = evidencePackBinding,
              let snapshotBinding,
              let reproducibility,
              snapshotBinding.analysisContentVersion == nil || snapshotBinding.analysisContentVersion == "2026-09-10.v1",
              snapshotBinding.schemaVersion
                == "2026-08-13.deep-research-snapshot.v2",
              snapshotBinding.snapshotId.range(
                of: #"^deep-research-snapshot:[a-f0-9]{64}$"#,
                options: .regularExpression
              ) != nil,
              isParseableDateTime(snapshotBinding.cutoffAt),
              snapshotBinding.membershipId == binding.membershipId,
              snapshotBinding.membershipVersion == binding.membershipVersion,
              snapshotBinding.symbol == binding.symbol,
              snapshotBinding.evidencePackId == binding.id,
              snapshotBinding.evidencePackVersion == binding.version,
              snapshotBinding.evidencePackFingerprint == binding.fingerprint,
              reproducibility.generationMethod
                == "deepseek_chat_completions_selected_snapshot",
              reproducibility.provider == "deepseek",
              supportedDeepResearchSynthesisPromptVersions.contains(reproducibility.prompt) else {
            return false
        }
        return [
            reproducibility.model, reproducibility.prompt,
            reproducibility.provider, reproducibility.tokenUsage,
            reproducibility.cost
        ].allSatisfy {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && $0 != "NOT_USED"
        }
        && (sendManifest?.matches(snapshot: snapshotBinding, provider: reproducibility.provider, model: reproducibility.model) ?? true)
        && (snapshot?.binds(snapshotBinding) ?? true)
    }
}
public struct TwoLayerReportDecision: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let reportId: String
    public let decision: String
    public let note: String?
    public let actorType: String
    public let actorId: String
    public let decidedAt: String
}

public struct TwoLayerEditableDraft: Equatable, Sendable {
    public let baseRequest: CreateTwoLayerReportRequest
    public var taskIntent: DeepResearchTaskIntent?
    public var conclusion: String
    public var confidence: String
    public var applicableUntil: String
    public var horizonStatement: String
    public var longTermView: String
    public var longTermConditions: [String]
    public var longTermInvalidations: [String]
    public var longTermRisks: [String]
    public var mediumShortTermView: String
    public var mediumShortTermConditions: [String]
    public var mediumShortTermInvalidations: [String]
    public var mediumShortTermRisks: [String]
    public var conflictStatus: String
    public var conflictDescription: String
    public var unknowns: [TwoLayerReportFact]
    public var nextValidationQuestions: [String]
    public var changeFromPrevious: String

    public init(
        baseRequest: CreateTwoLayerReportRequest,
        taskIntent: DeepResearchTaskIntent? = nil
    ) {
        self.baseRequest = baseRequest
        self.taskIntent = taskIntent
        conclusion = baseRequest.adviceLayer.conclusion
        confidence = baseRequest.adviceLayer.confidence
        applicableUntil = baseRequest.adviceLayer.applicableUntil
        horizonStatement = baseRequest.adviceLayer.horizonStatement
        longTermView = baseRequest.adviceLayer.longTerm.view
        longTermConditions = baseRequest.adviceLayer.longTerm.conditions
        longTermInvalidations = baseRequest.adviceLayer.longTerm.invalidationConditions
        longTermRisks = baseRequest.adviceLayer.longTerm.risks
        mediumShortTermView = baseRequest.adviceLayer.mediumShortTerm.view
        mediumShortTermConditions = baseRequest.adviceLayer.mediumShortTerm.conditions
        mediumShortTermInvalidations =
            baseRequest.adviceLayer.mediumShortTerm.invalidationConditions
        mediumShortTermRisks = baseRequest.adviceLayer.mediumShortTerm.risks
        conflictStatus = baseRequest.adviceLayer.conflict.status
        conflictDescription = baseRequest.adviceLayer.conflict.description
        unknowns = baseRequest.researchLayer.unknowns
        nextValidationQuestions = baseRequest.researchLayer.nextValidationQuestions
        changeFromPrevious = baseRequest.changeFromPrevious
    }

    public func request(idempotencyKey: String) -> CreateTwoLayerReportRequest {
        CreateTwoLayerReportRequest(
            membershipVersion: baseRequest.membershipVersion,
            evidencePackId: baseRequest.evidencePackId,
            idempotencyKey: idempotencyKey,
            reportContractVersion: baseRequest.reportContractVersion,
            evidencePackBinding: baseRequest.evidencePackBinding,
            reproducibility: baseRequest.reproducibility,
            adviceLayer: TwoLayerAdvice(
                conclusion: conclusion,
                confidence: confidence,
                applicableUntil: applicableUntil,
                horizonStatement: horizonStatement,
                longTerm: TwoLayerReportView(
                    view: longTermView,
                    conditions: longTermConditions,
                    invalidationConditions: longTermInvalidations,
                    risks: longTermRisks
                ),
                mediumShortTerm: TwoLayerReportView(
                    view: mediumShortTermView,
                    conditions: mediumShortTermConditions,
                    invalidationConditions: mediumShortTermInvalidations,
                    risks: mediumShortTermRisks
                ),
                conflict: .init(
                    status: conflictStatus,
                    description: conflictDescription
                ),
                direction: baseRequest.adviceLayer.direction,
                priceConditions: baseRequest.adviceLayer.priceConditions,
                priceRange: baseRequest.adviceLayer.priceRange,
                researchPositionRange: baseRequest.adviceLayer.researchPositionRange,
                assumptions: baseRequest.adviceLayer.assumptions,
                scenarios: baseRequest.adviceLayer.scenarios,
                nextQuestion: baseRequest.adviceLayer.nextQuestion,
                versionChange: baseRequest.adviceLayer.versionChange,
                automaticTradingSignal: false
            ),
            researchLayer: TwoLayerResearchDraft(
                fundamentals: baseRequest.researchLayer.fundamentals,
                eventsAndCatalysts: baseRequest.researchLayer.eventsAndCatalysts,
                risks: baseRequest.researchLayer.risks,
                counterevidence: baseRequest.researchLayer.counterevidence,
                unknowns: unknowns,
                sourceConflicts: baseRequest.researchLayer.sourceConflicts,
                nextValidationQuestions: nextValidationQuestions
            ),
            changeFromPrevious: changeFromPrevious
        )
    }

    public var hasOwnerEdits: Bool {
        request(idempotencyKey: baseRequest.idempotencyKey) != baseRequest
    }
}

extension FrozenResearchEvidencePack {
    public func reopenableMaterials(
        for fact: TwoLayerReportFact
    ) -> [ResearchMaterialData] {
        guard fact.sourceKind == "material" else { return [] }
        let byEvidenceId = Dictionary(
            uniqueKeysWithValues: items.map { ($0.evidenceId, $0) }
        )
        return fact.evidenceIds.compactMap { evidenceId in
            guard let item = byEvidenceId[evidenceId],
                  item.citation != nil || item.snapshotCitation != nil else { return nil }
            return item
        }
    }

    public func deterministicTwoLayerRequest(
        idempotencyKey: String
    ) -> CreateTwoLayerReportRequest? {
        guard currentness.status == "current" else { return nil }
        let context = frozenResearchContext
        var binding: TwoLayerReportPackBinding
        if researchMode == "limited" {
            guard context == nil else { return nil }
            binding = TwoLayerReportPackBinding(id: id, version: version, fingerprint: packFingerprint,
                membershipId: membershipId, membershipVersion: membershipVersion, symbol: symbol,
                frozenAt: frozenAt, contextVersion: limitedResearchContextVersion, valuation: nil, technical: nil)
        } else {
            guard let context,
                  let snapshotSha = context.technical.dailyBars.snapshot?.snapshotSha,
                  let resultHash = context.technical.technical.resultHash,
                  let dataCutoffAt = context.technical.dailyBars.source.dataCutoffAt else { return nil }
            binding = TwoLayerReportPackBinding(id: id, version: version, fingerprint: packFingerprint,
                membershipId: membershipId, membershipVersion: membershipVersion, symbol: symbol,
                frozenAt: frozenAt, contextVersion: context.bindingVersion,
                valuation: context.valuationScenario.map { .init(scenarioId: $0.id,
                    scenarioRevision: $0.revision, assumptions: $0.assumptions,
                    calculationVersion: $0.calculation.method.calculationVersion) },
                technical: .init(snapshotSha: snapshotSha, resultHash: resultHash, dataCutoffAt: dataCutoffAt,
                    adjustment: context.technical.dailyBars.request.adjustment,
                    computationVersion: context.technical.technical.computationVersion), quantPortfolio: context.quantPortfolio)
            if let methods = context.selectedValuationMethods {
                binding.valuationMethods = methods.map { method in
                    switch method {
                    case .provider(let provider): return .init(basisKind: "provider", scenarioId: provider.id,
                        scenarioRevision: provider.revision, methodId: provider.calculation.method.id,
                        sourceFingerprint: provider.providerBasis.sourceMaterialFingerprint,
                        calculationVersion: provider.calculation.method.calculationVersion)
                    case .fcff(let fcff): return .init(basisKind: "fcff", scenarioId: fcff.id,
                        scenarioRevision: fcff.revision, methodId: fcff.calculation.methodId,
                        sourceFingerprint: fcff.sourceFingerprint,
                        calculationVersion: fcff.calculation.calculationVersion)
                    }
                }
            }
        }
        let fundamentals = items.map {
            TwoLayerReportFact(
                statement: $0.summary,
                evidenceIds: [$0.evidenceId],
                sourceKind: "material",
                claimType: $0.claimType,
                stance: $0.stance
            )
        }
        guard !fundamentals.isEmpty else { return nil }
        let counter = items
            .filter { $0.stance == "refute" }
            .map {
                TwoLayerReportFact(
                    statement: $0.summary,
                    evidenceIds: [$0.evidenceId],
                    sourceKind: "material",
                    claimType: $0.claimType,
                    stance: $0.stance
                )
            }
        let eventFact = deterministicEventFact
        let unknownKeys = deterministicUnknownKeys
        let unknowns = unknownKeys.map {
            TwoLayerReportFact(
                statement: "\($0)=source_missing/UNKNOWN",
                evidenceIds: [],
                sourceKind: "source_missing",
                claimType: "UNKNOWN",
                stance: "UNKNOWN"
            )
        }
        let invalidation = "Evidence pack、membership、材料、估值、技术或量化绑定漂移即失效。"
        let riskText = counter.isEmpty
            ? ["risk=source_missing/UNKNOWN；不得推导交易方向。"]
            : counter.map(\.statement)
        let applicableUntil = items.min {
            $0.validUntil.twoLayerDate < $1.validUntil.twoLayerDate
        }?.validUntil ?? frozenAt
        let advice = TwoLayerAdvice(
            conclusion: "当前冻结事实支持继续研究与核验，不构成自动交易信号。",
            confidence: "UNKNOWN",
            applicableUntil: applicableUntil,
            horizonStatement: "长期与中短期分别表达；有效期不超过冻结来源最早失效时间。",
            longTerm: .init(
                view: researchMode == "limited" ? "先梳理已有资料支持的长期逻辑及缺口。" : "长期：只在基本面与估值假设持续成立时保持中立观察。",
                conditions: [researchMode == "limited" ? "已有材料必须保持有效，结论等待进一步核实。" : "当前证据版本、估值币种与 8 项个人假设保持不变。"],
                invalidationConditions: [invalidation],
                risks: riskText
            ),
            mediumShortTerm: .init(
                view: researchMode == "limited" ? "短期价格与技术条件尚未纳入本次研究。" : "中短期：技术结果仅为研究证据，不是买卖信号。",
                conditions: [researchMode == "limited" ? "补充当前报价与技术证据后再判断价格条件。" : "技术 snapshot/result 与 data cutoff 保持 exact-current。"],
                invalidationConditions: [invalidation],
                risks: riskText
            ),
            conflict: .init(
                status: counter.isEmpty ? "UNKNOWN" : "conflict",
                description: counter.isEmpty
                    ? "counterevidence=source_missing/UNKNOWN"
                    : "支持与反证材料同时保留，结论不得隐藏冲突。"
            ),
            direction: "wait_for_evidence",
            priceConditions: ["等待证据门槛满足后再重新研究。"],
            priceRange: "UNKNOWN",
            researchPositionRange: researchMode == "limited" ? "UNKNOWN" : "研究级假设：0%；不代表真实组合仓位。",
            assumptions: ["当前冻结证据、估值和技术身份保持有效。"],
            scenarios: ["证据不足：保持等待，不自动形成行动。"],
            nextQuestion: unknownKeys.first.map { "下一步核验 \($0)" }
                ?? "下一步核验关键 UNKNOWN 与反证。",
            versionChange: "首次确定性建议；无上一正式建议可比较。",
            automaticTradingSignal: false
        )
        let research = TwoLayerResearchDraft(
            fundamentals: fundamentals,
            eventsAndCatalysts: eventFact.map { [$0] } ?? [],
            risks: [],
            counterevidence: counter,
            unknowns: unknowns,
            sourceConflicts: [],
            nextValidationQuestions: unknownKeys.map {
                "\($0) source_missing/UNKNOWN：下一步应核验什么？"
            }
        )
        return CreateTwoLayerReportRequest(
            membershipVersion: membershipVersion,
            evidencePackId: id,
            idempotencyKey: idempotencyKey,
            reportContractVersion: evidenceBoundReportContractVersion,
            evidencePackBinding: binding,
            reproducibility: .deterministicFramework,
            adviceLayer: advice,
            researchLayer: research,
            changeFromPrevious: "Deterministic framework from exact frozen pack \(id); no AI model used."
        )
    }
}

private extension String {
    var twoLayerDate: Date {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: self) ?? ISO8601DateFormatter().date(from: self)!
    }

    var isTwoLayerSHA256: Bool {
        range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
    }
}
