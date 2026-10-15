import Foundation

public let researchValuationScenariosSchemaVersion =
    "2026-07-30.research-valuation-scenarios.v1"

/// A new currency never inherits per-share money amounts from another or unknown currency.
public func rebindResearchValuationMonetaryInputs(
    currentCurrency: String,
    nextCurrency: String,
    baseMetricPerShare: String,
    netCashPerShare: String
) -> (baseMetricPerShare: String, netCashPerShare: String, mustReenter: Bool) {
    guard currentCurrency == nextCurrency else {
        return (baseMetricPerShare: "", netCashPerShare: "", mustReenter: true)
    }
    return (baseMetricPerShare, netCashPerShare, false)
}

public struct CreateResearchValuationScenarioRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let symbol: String
    public let anchorValueId: String
    public let replacesScenarioSetId: String?
    public let assumptions: AnnualValuationScenarioInput
    public let ownerConfirmed: Bool
    public let idempotencyKey: String
    public let issuerBasis: ResearchValuationIssuerBasisBinding?

    public init(
        membershipVersion: Int,
        symbol: String,
        anchorValueId: String,
        replacesScenarioSetId: String?,
        assumptions: AnnualValuationScenarioInput,
        ownerConfirmed: Bool,
        idempotencyKey: String,
        issuerBasis: ResearchValuationIssuerBasisBinding? = nil
    ) {
        self.membershipVersion = membershipVersion
        self.symbol = symbol
        self.anchorValueId = anchorValueId
        self.replacesScenarioSetId = replacesScenarioSetId
        self.assumptions = assumptions
        self.ownerConfirmed = ownerConfirmed
        self.idempotencyKey = idempotencyKey
        self.issuerBasis = issuerBasis
    }
}

public struct ResearchValuationAnchorData: Codable, Equatable, Sendable {
    public let id: String
    public let membershipId: String
    public let membershipVersionAtWrite: Int
    public let symbol: String
    public let metric: String
    public let periodKind: String
    public let periodStart: String?
    public let periodEnd: String
    public let currency: String
    public let unitScale: Int
    public let scope: String
    public let valueStatus: String
    public let value: String?
    public let comparability: String
    public let comparabilityReason: String?
    public let amendmentKind: String
    public let replacesValueId: String?
    public let revision: Int
    public let valueState: String
    public let provenance: ResearchFundamentalProvenance
    public let source: ResearchFundamentalSourceData
    public let createdAt: String
    public let anchorRole: String
}

public struct ResearchValuationAssumptions: Codable, Equatable, Sendable {
    public let authority: String
    public let derivation: String
    public let values: AnnualValuationScenarioInput
}

public struct ResearchValuationMethod: Codable, Equatable, Sendable {
    public let id: String
    public let calculationVersion: String
    public let presentValueFormula: String
    public let rounding: String
    public let applicability: ResearchValuationMethodApplicability?
}

public struct ResearchValuationMethodApplicability: Codable, Equatable, Sendable {
    public let ownerConfirmed: Bool
    public let companyDataBasis: String
    public let requiredAnchorMetrics: [String]
    public let limitation: String
    public let pairedAnchorValueId: String?
}

public struct ResearchValuationValueRange: Codable, Equatable, Sendable {
    public let low: Double
    public let high: Double
    public let interpretation: String
}

public struct ResearchValuationDiagonalScenario: Codable, Equatable, Sendable {
    public let scenario: String
    public let annualGrowthRate: Double
    public let terminalMultiple: Double
    public let presentValuePerShare: Double
}

public struct ResearchValuationMatrix: Codable, Equatable, Sendable {
    public let growthRates: [Double]
    public let terminalMultiples: [Double]
    public let cells: [AnnualValuationSensitivityCell]
}

public struct ResearchValuationCalculation: Codable, Equatable, Sendable {
    public let issuerBasis: ResearchValuationIssuerBasisBinding?
    public let method: ResearchValuationMethod
    public let projectedMetricPerShare: Double
    public let scenarioPresentValuePerShare: Double
    public let diagonal: [ResearchValuationDiagonalScenario]
    public let matrix: ResearchValuationMatrix
    public let valueRange: ResearchValuationValueRange?
}

public struct ResearchValuationSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let forecast: Bool
    public let recommendation: Bool
    public let automaticSignal: Bool
    public let createsOrder: Bool
    public let callsBroker: Bool
    public let mutatesOfficialPortfolio: Bool
}

public struct ResearchValuationScenarioSetData: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let membershipId: String
    public let membershipVersionAtWrite: Int
    public let symbol: String
    public let revision: Int
    public let replacesScenarioSetId: String?
    public let scenarioState: String
    public let recomputable: Bool
    public let invalidatedBy: [String]
    public let anchor: ResearchValuationAnchorData
    public let anchorOriginalAvailability: String?
    public let issuerBasisCurrentness: String?
    public let pairedAnchor: ResearchValuationAnchorData?
    public let assumptions: ResearchValuationAssumptions
    public let calculation: ResearchValuationCalculation
    public let safety: ResearchValuationSafety
    public let createdAt: String
}

public struct ResearchValuationScenariosEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let generatedAt: String
    public let status: String
    public let requestedActorId: String
    public let membershipId: String
    public let membershipVersion: Int
    public let membershipState: String
    public let symbol: String
    public let fundamentalsSchemaVersion: String
    public let scenarioSets: [ResearchValuationScenarioSetData]
    public let providerScenarioSets: [ResearchProviderValuationScenarioSetData]?
    public let fcffScenarioSets: [ResearchFcffScenarioSetData]?
    public let providerFcffScenarioSets: [ResearchProviderFcffScenarioSetData]?

    public func validated(expected membership: CandidateMembershipData) throws -> Self {
        var errors: [String] = []
        if schemaVersion != researchValuationScenariosSchemaVersion
            || status != "available"
            || !isParseableDateTime(generatedAt) {
            errors.append("valuation scenario envelope metadata is invalid")
        }
        if requestedActorId != membership.actorId
            || membershipId != membership.id
            || membershipVersion != membership.version
            || membershipState != membership.state.rawValue
            || symbol != membership.symbol
            || fundamentalsSchemaVersion != ResearchFundamentalsEnvelope.schemaVersionV1 {
            errors.append("valuation scenario envelope does not match the current membership")
        }
        if Set(scenarioSets.map(\.id)).count != scenarioSets.count {
            errors.append("valuation scenario ids must be unique")
        }
        for scenario in scenarioSets {
            validateScenario(scenario, membership: membership, errors: &errors)
        }
        if Set((providerScenarioSets ?? []).map(\.id)).count != (providerScenarioSets ?? []).count {
            errors.append("provider valuation scenario ids must be unique")
        }
        for scenario in providerScenarioSets ?? [] {
            if !scenario.validates(membership: membership) { errors.append("provider valuation scenario is invalid") }
            validateCalculation(scenario.calculation, assumptions: scenario.assumptions.values, errors: &errors)
        }
        if Set((fcffScenarioSets ?? []).map(\.id)).count != (fcffScenarioSets ?? []).count {
            errors.append("FCFF scenario ids must be unique")
        }
        for scenario in fcffScenarioSets ?? [] {
            if !scenario.validates(membership: membership) { errors.append("FCFF scenario is invalid") }
        }
        if Set((providerFcffScenarioSets ?? []).map(\.id)).count != (providerFcffScenarioSets ?? []).count {
            errors.append("provider FCFF scenario ids must be unique")
        }
        for scenario in providerFcffScenarioSets ?? [] {
            if !scenario.validates(membership: membership) { errors.append("provider FCFF scenario is invalid") }
        }
        if !errors.isEmpty { throw ResearchValuationScenarioClientError.invalidResponse }
        return self
    }

    private func validateScenario(
        _ scenario: ResearchValuationScenarioSetData,
        membership: CandidateMembershipData,
        errors: inout [String]
    ) {
        if !researchDocumentIsPositiveIntegerString(scenario.id)
            || scenario.membershipId != membership.id
            || scenario.symbol != membership.symbol
            || scenario.membershipVersionAtWrite < 1
            || scenario.revision < 1
            || ((scenario.replacesScenarioSetId == nil) != (scenario.revision == 1))
            || !["current", "replaced"].contains(scenario.scenarioState)
            || !isParseableDateTime(scenario.createdAt)
            || (scenario.replacesScenarioSetId.map(researchDocumentIsPositiveIntegerString) == false) {
            errors.append("valuation scenario identity is invalid")
        }
        validateAnchor(
            scenario.anchor,
            membership: membership,
            scenarioMembershipVersion: scenario.membershipVersionAtWrite,
            methodId: scenario.assumptions.values.methodId
                ?? "discounted_forward_metric_multiple_user_scenario",
            sourceInput: scenario.calculation.issuerBasis != nil,
            errors: &errors
        )
        if !["available", "unavailable", "unknown"].contains(scenario.anchorOriginalAvailability ?? "")
            || scenario.anchor.source.kind == "source_snapshot"
                && scenario.anchor.source.originalAvailability != scenario.anchorOriginalAvailability {
            errors.append("valuation anchor original availability is inconsistent")
        }
        if let basis = scenario.calculation.issuerBasis {
            if !basis.isValid
                || scenario.calculation.method.id != "adjusted_net_asset_value_user_scenario"
                || basis.assetValueId != scenario.anchor.id && basis.liabilityValueId != scenario.anchor.id
                || scenario.assumptions.values.shareBasis != "basic"
                || scenario.assumptions.values.netCashPerShare != 0
                || basis.adoptionMode == "source_value"
                    && scenario.assumptions.values.baseMetricPerShare != basis.proposedBaseMetricPerShare
                || !["available", "unavailable"].contains(scenario.issuerBasisCurrentness ?? "") {
                errors.append("valuation issuer basis is inconsistent")
            }
        } else if scenario.issuerBasisCurrentness != nil {
            errors.append("manual valuation must not claim an issuer basis")
        }
        if let pairedAnchor = scenario.pairedAnchor {
            validateAnchor(pairedAnchor, membership: membership,
                scenarioMembershipVersion: pairedAnchor.membershipVersionAtWrite,
                methodId: scenario.assumptions.values.methodId
                    ?? "discounted_forward_metric_multiple_user_scenario",
                sourceInput: scenario.calculation.issuerBasis != nil, errors: &errors)
        }
        if scenario.calculation.method.id != "adjusted_net_asset_value_user_scenario"
            && (scenario.pairedAnchor != nil
                || scenario.calculation.method.applicability?.pairedAnchorValueId != nil) {
            errors.append("non-NAV valuation cannot claim a balance-sheet pair")
        }
        let expectedInvalidations = invalidations(for: scenario)
        if scenario.invalidatedBy != expectedInvalidations
            || scenario.recomputable != expectedInvalidations.isEmpty {
            errors.append("valuation scenario recomputation state is inconsistent")
        }
        var assumptionErrors: [String] = []
        scenario.assumptions.values.validate(errors: &assumptionErrors)
        if scenario.assumptions.authority != "owner"
            || scenario.assumptions.derivation != (scenario.calculation.issuerBasis == nil
                ? "manual_not_derived_from_citation" : "issuer_nav_source_draft_owner_confirmed")
            || !assumptionErrors.isEmpty {
            errors.append("valuation scenario Owner assumptions are invalid")
        }
        validateCalculation(scenario.calculation, assumptions: scenario.assumptions.values, errors: &errors)
        if !scenario.safety.advisoryOnly
            || scenario.safety.forecast
            || scenario.safety.recommendation
            || scenario.safety.automaticSignal
            || scenario.safety.createsOrder
            || scenario.safety.callsBroker
            || scenario.safety.mutatesOfficialPortfolio {
            errors.append("valuation scenario safety boundary is invalid")
        }
    }

    private func validateAnchor(
        _ anchor: ResearchValuationAnchorData,
        membership: CandidateMembershipData,
        scenarioMembershipVersion: Int,
        methodId: String,
        sourceInput: Bool,
        errors: inout [String]
    ) {
        let numericPattern = #"^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$"#
        let durationIsValid = anchor.periodKind == "duration"
            && anchor.periodStart.map(researchValuationIsCalendarDate) == true
            && (anchor.periodStart ?? "") < anchor.periodEnd
        let instantIsValid = anchor.periodKind == "instant" && anchor.periodStart == nil
        let valueIsValid = anchor.valueStatus == "reported"
            ? anchor.value?.range(of: numericPattern, options: .regularExpression) != nil
                && anchor.value != "-0"
            : anchor.valueStatus == "explicit_unknown" && anchor.value == nil
        let comparabilityIsValid = anchor.comparability == "comparable"
            ? anchor.comparabilityReason == nil
            : anchor.comparability == "not_comparable"
                && !(anchor.comparabilityReason ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if anchor.anchorRole != (sourceInput
            ? "issuer_nav_source_draft_input" : "cited_context_only_not_calculation_input")
            || !researchDocumentIsPositiveIntegerString(anchor.id)
            || anchor.membershipId != membership.id
            || anchor.membershipVersionAtWrite != scenarioMembershipVersion
            || anchor.symbol != membership.symbol
            || !["revenue", "profit_attributable_to_owners", "total_assets", "total_liabilities"].contains(anchor.metric)
            || anchor.membershipVersionAtWrite < 1
            || !(durationIsValid || instantIsValid)
            || !researchValuationIsCalendarDate(anchor.periodEnd)
            || anchor.currency.range(of: #"^[A-Z]{3}$"#, options: .regularExpression) == nil
            || ![1, 1_000, 1_000_000, 1_000_000_000].contains(anchor.unitScale)
            || !["consolidated", "parent_company"].contains(anchor.scope)
            || !valueIsValid
            || !comparabilityIsValid
            || !["initial", "restatement", "correction"].contains(anchor.amendmentKind)
            || (anchor.replacesValueId.map(researchDocumentIsPositiveIntegerString) == false)
            || anchor.revision < 1
            || (anchor.amendmentKind == "initial"
                ? anchor.replacesValueId != nil || anchor.revision != 1
                : anchor.replacesValueId == nil || anchor.revision <= 1)
            || !["current", "replaced", "historical_source_superseded", "historical_source_stale"].contains(anchor.valueState)
            || anchor.provenance.factKind != "issuer_reported"
            || anchor.provenance.transcription != "owner_manual"
            || !["unverified", "verified", "owner_confirmed", "source_text_verified"].contains(anchor.provenance.verificationStatus)
            || !isParseableDateTime(anchor.createdAt) {
            errors.append("valuation anchor fact structure or provenance is invalid")
        }
        let source = anchor.source
        if !researchDocumentIsPositiveIntegerString(source.materialId)
            || source.materialRevision < 1
            || !["current", "superseded"].contains(source.materialRevisionState)
            || !isParseableDateTime(source.validUntil)
            || !["fresh", "stale"].contains(source.freshness)
            || source.materialSourceVersion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || source.materialSourceVersion.count > 200
            || !source.hasValidCitation {
            errors.append("valuation anchor source identity is invalid")
        }
        guard let validUntil = researchValuationDate(source.validUntil),
              let serverNow = researchValuationDate(generatedAt) else {
            errors.append("valuation anchor freshness boundary is invalid")
            return
        }
        if (source.freshness == "fresh") != (validUntil > serverNow)
            || (anchor.valueState == "current"
                && (source.materialRevisionState != "current" || source.freshness != "fresh"
                    || source.kind == "source_snapshot" && source.snapshotReviewState != "current"))
            || (anchor.valueState == "historical_source_superseded"
                && source.materialRevisionState != "superseded"
                && !(source.kind == "source_snapshot" && source.snapshotReviewState == "pending_review"))
            || (anchor.valueState == "historical_source_stale"
                && (source.materialRevisionState != "current" || source.freshness != "stale")) {
            errors.append("valuation anchor freshness or revision state is inconsistent")
        }
    }

    private func invalidations(
        for scenario: ResearchValuationScenarioSetData
    ) -> [String] {
        var values: [String] = []
        if scenario.scenarioState == "replaced" { values.append("scenario_replaced") }
        if scenario.membershipVersionAtWrite != membershipVersion {
            values.append("membership_version_changed")
        }
        if membershipState == "archived" { values.append("membership_archived") }
        if scenario.anchor.valueState == "replaced" { values.append("anchor_replaced") }
        if scenario.anchor.source.materialRevisionState == "superseded" {
            values.append("anchor_source_superseded")
        }
        if scenario.anchor.source.kind == "source_snapshot"
            && scenario.anchor.source.snapshotReviewState == "pending_review" {
            values.append("anchor_source_review_required")
        }
        if scenario.anchorOriginalAvailability != "available" {
            values.append("anchor_source_original_unavailable")
        }
        if scenario.anchor.valueState == "historical_source_stale"
            || scenario.anchor.source.freshness == "stale" {
            values.append("anchor_source_stale")
        }
        if scenario.anchor.valueStatus != "reported" || scenario.anchor.value == nil {
            values.append("anchor_not_reported")
        }
        if scenario.anchor.comparability != "comparable"
            || scenario.anchor.comparabilityReason != nil {
            values.append("anchor_not_comparable")
        }
        if !["revenue", "profit_attributable_to_owners", "total_assets", "total_liabilities"].contains(scenario.anchor.metric) {
            values.append("anchor_metric_ineligible")
        }
        let applicableMetrics = (scenario.assumptions.values.methodId
            ?? "discounted_forward_metric_multiple_user_scenario")
            == "adjusted_net_asset_value_user_scenario"
            ? ["total_assets", "total_liabilities"]
            : ["revenue", "profit_attributable_to_owners"]
        if !applicableMetrics.contains(scenario.anchor.metric) {
            values.append("method_anchor_inapplicable")
        }
        if scenario.calculation.method.id == "adjusted_net_asset_value_user_scenario" {
            if let pairedId = scenario.calculation.method.applicability?.pairedAnchorValueId {
                if !validNavPair(scenario, pairedId: pairedId) { values.append("nav_pair_unavailable") }
            } else {
                values.append("nav_pair_unbound")
            }
        }
        if scenario.calculation.issuerBasis != nil && scenario.issuerBasisCurrentness != "available" {
            values.append("issuer_basis_unavailable")
        }
        var seen = Set<String>()
        return values.filter { seen.insert($0).inserted }
    }

    private func validNavPair(_ scenario: ResearchValuationScenarioSetData, pairedId: String) -> Bool {
        guard let pair = scenario.pairedAnchor else { return false }
        let anchor = scenario.anchor
        return pair.id == pairedId && pair.id != anchor.id
            && ((anchor.metric == "total_assets" && pair.metric == "total_liabilities")
                || (anchor.metric == "total_liabilities" && pair.metric == "total_assets"))
            && pair.membershipId == anchor.membershipId
            && pair.membershipVersionAtWrite == scenario.membershipVersionAtWrite
            && pair.symbol == anchor.symbol
            && pair.periodKind == "instant" && pair.periodStart == nil
            && anchor.periodKind == "instant" && anchor.periodStart == nil
            && pair.periodEnd == anchor.periodEnd && pair.currency == anchor.currency
            && pair.unitScale == anchor.unitScale && pair.scope == anchor.scope
            && pair.valueState == "current" && pair.valueStatus == "reported" && pair.value != nil
            && pair.comparability == "comparable" && pair.comparabilityReason == nil
            && pair.source.materialRevisionState == "current" && pair.source.freshness == "fresh"
            && (pair.source.kind != "source_snapshot"
                || pair.source.snapshotReviewState == "current"
                    && pair.source.originalAvailability == "available")
    }

    private func validateCalculation(
        _ calculation: ResearchValuationCalculation,
        assumptions: AnnualValuationScenarioInput,
        errors: inout [String]
    ) {
        let methodId = assumptions.methodId ?? "discounted_forward_metric_multiple_user_scenario"
        let adjusted = methodId == "adjusted_net_asset_value_user_scenario"
        let expectedVersion = adjusted
            ? annualAdjustedNetAssetCalculationVersion
            : annualValuationCalculationVersion
        let expectedFormula = adjusted
            ? annualAdjustedNetAssetValueFormula
            : annualValuationPresentValueFormula
        let expectedBasis = adjusted
            ? "reported_balance_sheet_net_assets_per_share"
            : "forward_operating_metric_per_share"
        let expectedAnchorMetrics = adjusted
            ? ["total_assets", "total_liabilities"]
            : ["revenue", "profit_attributable_to_owners"]
        guard calculation.method.id == methodId,
              calculation.method.calculationVersion == expectedVersion,
              calculation.method.presentValueFormula == expectedFormula,
              calculation.method.rounding == "decimal_places_6",
              let expected = calculateAnnualValuationScenarioGrid(assumptions),
              calculation.projectedMetricPerShare == expected.projectedMetricPerShare,
              calculation.scenarioPresentValuePerShare == expected.scenarioPresentValuePerShare,
              calculation.matrix.growthRates == expected.growthRates,
              calculation.matrix.terminalMultiples == expected.terminalMultiples,
              calculation.matrix.cells == expected.cells else {
            errors.append("valuation calculation does not match the fixed formula and exact Owner assumptions")
            return
        }
        if let applicability = calculation.method.applicability,
           (!applicability.ownerConfirmed
                || applicability.companyDataBasis != expectedBasis
                || applicability.requiredAnchorMetrics != expectedAnchorMetrics
                || applicability.limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
            errors.append("valuation method applicability does not match the Owner-selected company-data basis")
        }
        if let pairedId = calculation.method.applicability?.pairedAnchorValueId,
           (!adjusted || !researchDocumentIsPositiveIntegerString(pairedId)) {
            errors.append("valuation NAV pair identity is invalid")
        }
        let indexes = [0, 4, 8]
        let labels = ["bear", "base", "bull"]
        guard calculation.diagonal.count == 3,
              calculation.matrix.cells.count == 9 else {
            errors.append("valuation calculation must contain a 3 by 3 matrix and diagonal")
            return
        }
        for offset in indexes.indices {
            let diagonal = calculation.diagonal[offset]
            let cell = calculation.matrix.cells[indexes[offset]]
            if diagonal.scenario != labels[offset]
                || diagonal.annualGrowthRate != cell.annualGrowthRate
                || diagonal.terminalMultiple != cell.terminalMultiple
                || diagonal.presentValuePerShare != cell.presentValuePerShare {
                errors.append("valuation Bear Base Bull scenarios must be the 3 by 3 diagonal")
            }
        }
        if let valueRange = calculation.valueRange {
            let values = indexes.map { expected.cells[$0].presentValuePerShare }
            if valueRange.low != values.min()
                || valueRange.high != values.max()
                || valueRange.interpretation != "research_scenario_range_not_target_price" {
                errors.append("valuation range must bind Bear Base Bull and remain research-only")
            }
        }
    }
}

public enum ResearchValuationScenarioClientError: Error, Equatable, Sendable {
    case httpStatus(Int)
    case invalidResponse
}

public func currentResearchValuationAnchors(
    values: [ResearchFundamentalValueData],
    serverAsOf: String,
    methodId: String = "discounted_forward_metric_multiple_user_scenario",
    expectedMembershipVersion: Int? = nil,
    expectedSymbol: String? = nil
) -> [ResearchFundamentalValueData] {
    guard let serverNow = researchValuationDate(serverAsOf) else { return [] }
    let metrics = methodId == "adjusted_net_asset_value_user_scenario"
        ? ["total_assets", "total_liabilities"]
        : ["revenue", "profit_attributable_to_owners"]
    let eligible = values.filter { value in
        guard let validUntil = researchValuationDate(value.source.validUntil) else { return false }
        return metrics.contains(value.metric)
            && (expectedMembershipVersion == nil || value.membershipVersionAtWrite == expectedMembershipVersion)
            && (expectedSymbol == nil || value.symbol == expectedSymbol)
            && value.isCurrentlyUsable
            && value.valueStatus == "reported"
            && value.value != nil
            && value.comparability == "comparable"
            && value.comparabilityReason == nil
            && value.source.materialRevisionState == "current"
            && value.source.freshness == "fresh"
            && validUntil > serverNow
    }
    guard methodId == "adjusted_net_asset_value_user_scenario" else { return eligible }
    return eligible.filter { value in
        value.periodKind == "instant" && value.periodStart == nil
            && eligible.contains { other in
                other.metric != value.metric
                    && other.periodKind == value.periodKind
                    && other.periodStart == value.periodStart
                    && other.periodEnd == value.periodEnd
                    && other.currency == value.currency
                    && other.unitScale == value.unitScale
                    && other.scope == value.scope
            }
    }
}

private func researchValuationDate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let parsed = formatter.date(from: value) { return parsed }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
}

private func researchValuationIsCalendarDate(_ value: String) -> Bool {
    guard value.range(
        of: #"^\d{4}-\d{2}-\d{2}$"#,
        options: .regularExpression
    ) != nil else { return false }
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .iso8601)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.isLenient = false
    return formatter.date(from: value).map { formatter.string(from: $0) == value } == true
}

public struct FcffForecastYear: Codable, Equatable, Sendable {
    public let periodStart: String
    public let periodEnd: String
    public let paymentDate: String
    public let ebit: Double
    public let operatingTaxRate: Double
    public let depreciationAmortization: Double
    public let grossCapitalReinvestment: Double
    public let increaseInNoncashWorkingCapital: Double
    public init(periodStart: String, periodEnd: String, paymentDate: String, ebit: Double,
                operatingTaxRate: Double, depreciationAmortization: Double,
                grossCapitalReinvestment: Double, increaseInNoncashWorkingCapital: Double) {
        self.periodStart = periodStart; self.periodEnd = periodEnd; self.paymentDate = paymentDate
        self.ebit = ebit; self.operatingTaxRate = operatingTaxRate
        self.depreciationAmortization = depreciationAmortization
        self.grossCapitalReinvestment = grossCapitalReinvestment
        self.increaseInNoncashWorkingCapital = increaseInNoncashWorkingCapital
    }
    public var fcff: Double { ebit * (1 - operatingTaxRate) + depreciationAmortization
        - grossCapitalReinvestment - increaseInNoncashWorkingCapital }
}

public struct FcffEquityBridge: Codable, Equatable, Sendable {
    public let excessCash: Double
    public let nonOperatingAssets: Double
    public let interestBearingDebt: Double
    public let leaseLiabilitiesNotInDebt: Double
    public let noncontrollingInterests: Double
    public let otherNonordinaryClaims: Double
    public let dilutedOrdinaryShares: Double
    public init(excessCash: Double, nonOperatingAssets: Double, interestBearingDebt: Double,
                leaseLiabilitiesNotInDebt: Double, noncontrollingInterests: Double,
                otherNonordinaryClaims: Double, dilutedOrdinaryShares: Double) {
        self.excessCash = excessCash; self.nonOperatingAssets = nonOperatingAssets
        self.interestBearingDebt = interestBearingDebt; self.leaseLiabilitiesNotInDebt = leaseLiabilitiesNotInDebt
        self.noncontrollingInterests = noncontrollingInterests; self.otherNonordinaryClaims = otherNonordinaryClaims
        self.dilutedOrdinaryShares = dilutedOrdinaryShares
    }
}

public struct FcffScenarioInput: Codable, Equatable, Sendable {
    public let currency: String
    public let historicalAnnualPeriodEnd: String
    public let balanceReferenceDate: String
    public let valuationCutoff: String
    public let forecast: [FcffForecastYear]
    public let terminalNextYear: FcffForecastYear
    public let wacc: Double
    public let terminalGrowthRate: Double
    public let waccStep: Double
    public let terminalGrowthStep: Double
    public let bridge: FcffEquityBridge
    public init(currency: String, historicalAnnualPeriodEnd: String, balanceReferenceDate: String,
                valuationCutoff: String, forecast: [FcffForecastYear], terminalNextYear: FcffForecastYear,
                wacc: Double, terminalGrowthRate: Double, waccStep: Double,
                terminalGrowthStep: Double, bridge: FcffEquityBridge) {
        self.currency = currency; self.historicalAnnualPeriodEnd = historicalAnnualPeriodEnd
        self.balanceReferenceDate = balanceReferenceDate; self.valuationCutoff = valuationCutoff
        self.forecast = forecast; self.terminalNextYear = terminalNextYear; self.wacc = wacc
        self.terminalGrowthRate = terminalGrowthRate; self.waccStep = waccStep
        self.terminalGrowthStep = terminalGrowthStep; self.bridge = bridge
    }
}

public struct FcffSourceSelection: Codable, Equatable, Sendable {
    public let historicalAnnualPeriodEnd: String
    public let balanceReferenceDate: String
    public let historicalValueIds: [String: String?]
    public let workingCapitalValueIds: [String: [String]]
    public let bridgeValueIds: [String: String?]
    public let nonOperatingAssetValueIds: [String]
    public let otherClaimValueIds: [String]
    public init(historicalAnnualPeriodEnd: String, balanceReferenceDate: String,
                historicalValueIds: [String: String?], workingCapitalValueIds: [String: [String]],
                bridgeValueIds: [String: String?], nonOperatingAssetValueIds: [String],
                otherClaimValueIds: [String]) {
        self.historicalAnnualPeriodEnd = historicalAnnualPeriodEnd
        self.balanceReferenceDate = balanceReferenceDate
        self.historicalValueIds = historicalValueIds; self.workingCapitalValueIds = workingCapitalValueIds
        self.bridgeValueIds = bridgeValueIds; self.nonOperatingAssetValueIds = nonOperatingAssetValueIds
        self.otherClaimValueIds = otherClaimValueIds
    }
}

public struct FcffSourceFact: Codable, Equatable, Sendable, Identifiable {
    public let role: String
    public let id: String
    public let metric: String
    public let value: Double
    public let periodStart: String?
    public let periodEnd: String
    public let currency: String
    public let unitScale: Double
    public let scope: String
    public let materialId: String
    public let materialRevision: Int
    public let originalSha256: String
    public let citationSha256: String
    /// Original publication time; nil is an explicit unknown, never the accounting period end.
    public let publishedAt: String?
}
public struct FcffWorkingCapitalBasis: Codable, Equatable, Sendable {
    public let priorNet: Double
    public let currentNet: Double
    public let increase: Double
    public let formula: String
}
public struct FcffOperatingProfitBasis: Codable, Equatable, Sendable {
    public let value: Double
    public let formula: String
    public let limitation: String
}
public struct FcffCashCapexBasis: Codable, Equatable, Sendable {
    public let value: Double
    public let formula: String
    public let limitation: String
}
public struct FcffBridgeReference: Codable, Equatable, Sendable {
    public let cashAndEquivalents: Double
    public let nonOperatingAssets: Double
    public let interestBearingDebtExcludingLeases: Double
    public let leaseLiabilities: Double
    public let nciBookValue: Double
    public let otherClaims: Double
    public let issuedShares: Double
    public let treasuryShares: Double
    public let ordinaryShares: Double
}
public struct FcffSourcePreview: Codable, Equatable, Sendable {
    public let status: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let currency: String?
    public let historicalAnnualPeriodEnd: String
    public let balanceReferenceDate: String
    public let sourceFingerprint: String?
    public let facts: [FcffSourceFact]
    public let historicalMissingRoles: [String]
    public let missingBridgeRoles: [String]
    public let historicalOperatingProfitBasis: FcffOperatingProfitBasis?
    public let historicalCashCapitalExpenditureBasis: FcffCashCapexBasis?
    public let workingCapital: FcffWorkingCapitalBasis?
    public let workingCapitalMissing: [String]
    public let bridgeReference: FcffBridgeReference?
}

public struct FcffBridgeClassification: Codable, Equatable, Sendable {
    public let cashSinceReferenceAdjustment: Double
    public let minimumOperatingCash: Double
    public let nonOperatingAssetAdjustment: Double
    public let debtSinceReferenceAdjustment: Double
    public let leaseSinceReferenceAdjustment: Double
    public let nciFairValueAdjustment: Double
    public let otherClaimsAdjustment: Double
    public let ordinarySharesSinceReferenceAdjustment: Double
    public let potentialDilutionShares: Double
    public let cashReason: String
    public let nonOperatingAssetsReason: String
    public let debtReason: String
    public let leaseTreatmentReason: String
    public let noncontrollingInterestReason: String
    public let otherClaimsReason: String
    public let dilutedSharesReason: String
    public let balanceDateGapReason: String
    public let historicalBasisReason: String
}
public struct CreateResearchFcffScenarioRequest: Codable, Equatable, Sendable {
    private enum CodingKeys: String, CodingKey {
        case membershipVersion, symbol, replacesScenarioSetId, sourceSelection
        case sourceFingerprint, assumptions, bridgeClassification, ownerConfirmed, idempotencyKey
    }
    public let membershipVersion: Int
    public let symbol: String
    public let replacesScenarioSetId: String?
    public let sourceSelection: FcffSourceSelection
    public let sourceFingerprint: String
    public let assumptions: FcffScenarioInput
    public let bridgeClassification: FcffBridgeClassification
    public let ownerConfirmed: Bool
    public let idempotencyKey: String
    public init(membershipVersion: Int, symbol: String, replacesScenarioSetId: String?,
                sourceSelection: FcffSourceSelection, sourceFingerprint: String,
                assumptions: FcffScenarioInput, bridgeClassification: FcffBridgeClassification,
                ownerConfirmed: Bool, idempotencyKey: String) {
        self.membershipVersion = membershipVersion; self.symbol = symbol
        self.replacesScenarioSetId = replacesScenarioSetId; self.sourceSelection = sourceSelection
        self.sourceFingerprint = sourceFingerprint; self.assumptions = assumptions
        self.bridgeClassification = bridgeClassification; self.ownerConfirmed = ownerConfirmed
        self.idempotencyKey = idempotencyKey
    }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(membershipVersion, forKey: .membershipVersion)
        try container.encode(symbol, forKey: .symbol)
        if let replacesScenarioSetId {
            try container.encode(replacesScenarioSetId, forKey: .replacesScenarioSetId)
        } else {
            try container.encodeNil(forKey: .replacesScenarioSetId)
        }
        try container.encode(sourceSelection, forKey: .sourceSelection)
        try container.encode(sourceFingerprint, forKey: .sourceFingerprint)
        try container.encode(assumptions, forKey: .assumptions)
        try container.encode(bridgeClassification, forKey: .bridgeClassification)
        try container.encode(ownerConfirmed, forKey: .ownerConfirmed)
        try container.encode(idempotencyKey, forKey: .idempotencyKey)
    }
}
public struct FcffScenarioCalculation: Codable, Equatable, Sendable {
    public struct Annual: Codable, Equatable, Sendable {
        public let periodStart: String
        public let periodEnd: String
        public let paymentDate: String
        public let yearsToPayment: Double
        public let fcff: Double
        public let presentValue: Double
        public var year: Int { Int(periodEnd.prefix(4)) ?? 0 }
    }
    public struct Cell: Codable, Equatable, Sendable {
        public let wacc: Double
        public let terminalGrowthRate: Double
        public let commonEquityValuePerShare: Double
    }
    public struct Sensitivity: Codable, Equatable, Sendable {
        public let waccRates: [Double]
        public let terminalGrowthRates: [Double]
        public let cells: [Cell]
    }
    public let methodId: String
    public let calculationVersion: String
    public let currency: String
    public let historicalAnnualPeriodEnd: String
    public let balanceReferenceDate: String
    public let valuationCutoff: String
    public let dayCountConvention: String
    public let annual: [Annual]
    public let terminalNextYearFcff: Double
    public let terminalAnchorDate: String
    public let terminalYearsToAnchor: Double
    public let terminalEnterpriseValue: Double
    public let operatingEnterpriseValue: Double
    public let commonEquityValue: Double
    public let commonEquityValuePerShare: Double
    public let sensitivity: Sensitivity
}
public struct FcffOwnerAssumptions: Codable, Equatable, Sendable {
    public let authority: String
    public let values: FcffScenarioInput
    public let bridgeClassification: FcffBridgeClassification
}
public struct ResearchFcffScenarioSetData: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let membershipId: String
    public let membershipVersionAtWrite: Int
    public let symbol: String
    public let revision: Int
    public let replacesScenarioSetId: String?
    public let scenarioState: String
    public let recomputable: Bool
    public let invalidatedBy: [String]
    public let sourceSelection: FcffSourceSelection
    public let sourceFingerprint: String
    public let historicalOriginals: FcffSourcePreview
    public let assumptions: FcffOwnerAssumptions
    public let calculation: FcffScenarioCalculation
    public let safety: ResearchValuationSafety
    public let createdAt: String

    public func validates(membership: CandidateMembershipData) -> Bool {
        let source = historicalOriginals
        let input = assumptions.values
        let result = calculation
        let lifecycle = [scenarioState == "replaced" ? "scenario_replaced" : nil,
            membershipVersionAtWrite != membership.version ? "membership_version_changed" : nil,
            membership.state.rawValue == "archived" ? "membership_archived" : nil].compactMap { $0 }
        guard researchDocumentIsPositiveIntegerString(id), membershipId == membership.id,
              symbol == membership.symbol, revision > 0, membershipVersionAtWrite > 0,
              (replacesScenarioSetId == nil) == (revision == 1),
              ["current", "replaced"].contains(scenarioState),
              recomputable == invalidatedBy.isEmpty,
              Array(invalidatedBy.prefix(lifecycle.count)) == lifecycle,
              invalidatedBy.dropFirst(lifecycle.count).allSatisfy({
                  ["fcff_source_unavailable", "fcff_source_changed", "fcff_calculation_invalid"].contains($0)
              }),
              source.status == "available", source.membershipId == membership.id,
              source.membershipVersion == membershipVersionAtWrite, source.symbol == symbol,
              source.sourceFingerprint == sourceFingerprint, source.currency == input.currency,
              source.missingBridgeRoles.isEmpty, source.bridgeReference != nil,
              source.facts.allSatisfy({
                  guard let publishedDay = fcffPublishedHongKongDay($0.publishedAt) else { return false }
                  return publishedDay <= input.valuationCutoff
              }),
              fcffBridgeMatches(source: source, selection: sourceSelection,
                                input: input, classification: assumptions.bridgeClassification),
              source.historicalAnnualPeriodEnd == sourceSelection.historicalAnnualPeriodEnd,
              source.balanceReferenceDate == sourceSelection.balanceReferenceDate,
              input.historicalAnnualPeriodEnd == sourceSelection.historicalAnnualPeriodEnd,
              input.balanceReferenceDate == sourceSelection.balanceReferenceDate,
              assumptions.authority == "owner", safety.advisoryOnly, safety.forecast,
              !safety.recommendation, !safety.automaticSignal, !safety.createsOrder,
              !safety.callsBroker, !safety.mutatesOfficialPortfolio,
              isParseableDateTime(createdAt),
              let preview = calculateFcffScenarioPreview(input),
              fcffNear(preview.commonEquityValuePerShare, result.commonEquityValuePerShare),
              fcffNear(preview.operatingEnterpriseValue, result.operatingEnterpriseValue),
              fcffNear(preview.commonEquityValue, result.commonEquityValue),
              fcffNear(preview.terminalNextYearFcff, result.terminalNextYearFcff),
              fcffNear(preview.terminalEnterpriseValue, result.terminalEnterpriseValue),
              fcffNear(preview.terminalYearsToAnchor, result.terminalYearsToAnchor),
              preview.terminalAnchorDate == result.terminalAnchorDate,
              result.calculationVersion == "2026-10-12.discounted-fcff-to-common-equity.v2",
              result.dayCountConvention == "ACT/365F", result.valuationCutoff == input.valuationCutoff,
              result.historicalAnnualPeriodEnd == input.historicalAnnualPeriodEnd,
              result.balanceReferenceDate == input.balanceReferenceDate,
              result.annual.count == input.forecast.count, result.sensitivity.cells.count == 9,
              preview.sensitivity.waccRates == result.sensitivity.waccRates,
              preview.sensitivity.terminalGrowthRates == result.sensitivity.terminalGrowthRates
        else { return false }
        return zip(preview.annual, result.annual).allSatisfy { expected, actual in
            expected.periodStart == actual.periodStart && expected.periodEnd == actual.periodEnd
                && expected.paymentDate == actual.paymentDate
                && fcffNear(expected.yearsToPayment, actual.yearsToPayment)
                && fcffNear(expected.fcff, actual.fcff)
                && fcffNear(expected.presentValue, actual.presentValue)
        } && zip(preview.sensitivity.cells, result.sensitivity.cells).allSatisfy { expected, actual in
            fcffNear(expected.wacc, actual.wacc) && fcffNear(expected.terminalGrowthRate, actual.terminalGrowthRate)
                && fcffNear(expected.commonEquityValuePerShare, actual.commonEquityValuePerShare)
        }
    }
}
public struct FcffProviderSelection: Codable, Equatable, Sendable {
    public let financialCaptureId: String
    public let sourceMaterialId: String
    public let annualPeriodEnd: String
    public let shareReferenceDate: String?

    private enum CodingKeys: String, CodingKey {
        case financialCaptureId, sourceMaterialId, annualPeriodEnd, shareReferenceDate
    }

    public init(financialCaptureId: String, sourceMaterialId: String,
                annualPeriodEnd: String, shareReferenceDate: String?) {
        self.financialCaptureId = financialCaptureId; self.sourceMaterialId = sourceMaterialId
        self.annualPeriodEnd = annualPeriodEnd; self.shareReferenceDate = shareReferenceDate
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(financialCaptureId, forKey: .financialCaptureId)
        try container.encode(sourceMaterialId, forKey: .sourceMaterialId)
        try container.encode(annualPeriodEnd, forKey: .annualPeriodEnd)
        if let shareReferenceDate {
            try container.encode(shareReferenceDate, forKey: .shareReferenceDate)
        } else {
            try container.encodeNil(forKey: .shareReferenceDate)
        }
    }
}
public struct FcffProviderRow: Codable, Equatable, Sendable, Identifiable {
    public let role: String
    public let fieldId: Int
    public let displayName: String
    public let rawValue: String
    public let currency: String
    public let unitScale: Int
    public let periodEnd: String
    public let pageId: String
    public let rawSha256: String
    public let reportSha256: String
    public var id: String { role }
}
public struct FcffProviderShareReference: Codable, Equatable, Sendable {
    public let issuedShares: Double
    public let treasuryShares: Double
    public let issuedValueId: String
    public let treasuryValueId: String
    public let issuedMaterialId: String
    public let treasuryMaterialId: String
    public let issuedPublishedAt: String?
    public let treasuryPublishedAt: String?
}
public struct FcffProviderReference: Codable, Equatable, Sendable {
    public let kind: String
    public let sourceClassification: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let materialId: String
    public let materialRevision: Int
    public let materialFingerprint: String
    public let financialCaptureId: String
    public let balanceReferenceDate: String
    public let shareReferenceDate: String?
    public let capturedAt: String
    public let currency: String
    public let rows: [FcffProviderRow]
    public let missingRoles: [String]
    public let shareReference: FcffProviderShareReference?
    public let issuerOriginalVerification: String
    public let publicationTime: String
    public let amountUnit: String
    public let sourceFingerprint: String

    public func validates(membership: CandidateMembershipData, selection: FcffProviderSelection,
                          expectedVersion: Int? = nil) -> Bool {
        kind == "provider_fcff" && sourceClassification == "third_party_statement"
            && membershipId == membership.id && membershipVersion == (expectedVersion ?? membership.version)
            && symbol == membership.symbol && materialId == selection.sourceMaterialId
            && financialCaptureId == selection.financialCaptureId
            && balanceReferenceDate == selection.annualPeriodEnd
            && shareReferenceDate == selection.shareReferenceDate
            && researchDocumentIsSha256(materialFingerprint) && researchDocumentIsSha256(sourceFingerprint)
            && issuerOriginalVerification == "UNKNOWN" && publicationTime == "UNKNOWN"
            && amountUnit == "currency_base_unit" && ["CNY", "HKD", "USD"].contains(currency)
            && rows.count <= 8 && Set(rows.map(\.role)).count == rows.count
            && rows.allSatisfy { $0.periodEnd == balanceReferenceDate && $0.currency == currency
                && $0.unitScale == 1 && Double($0.rawValue)?.isFinite == true
                && researchDocumentIsSha256($0.rawSha256)
                && researchDocumentIsSha256($0.reportSha256) }
    }
}
public struct FcffProviderBridgeReasons: Codable, Equatable, Sendable {
    public var cash = ""; public var nonOperatingAssets = ""; public var debt = ""
    public var leases = ""; public var nci = ""; public var otherClaims = ""
    public var shares = ""; public var dateGap = ""; public var historicalBasis = ""
    public var isComplete: Bool {
        [cash, nonOperatingAssets, debt, leases, nci, otherClaims, shares, dateGap, historicalBasis]
            .allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).count >= 8 && $0.count <= 500 }
    }
}
public struct CreateResearchProviderFcffScenarioRequest: Codable, Equatable, Sendable {
    private enum CodingKeys: String, CodingKey {
        case basisKind, membershipVersion, symbol, replacesScenarioSetId, selection
        case sourceFingerprint, assumptions, bridgeReasons, ownerConfirmed, idempotencyKey
    }
    public let basisKind: String
    public let membershipVersion: Int
    public let symbol: String
    public let replacesScenarioSetId: String?
    public let selection: FcffProviderSelection
    public let sourceFingerprint: String
    public let assumptions: FcffScenarioInput
    public let bridgeReasons: FcffProviderBridgeReasons
    public let ownerConfirmed: Bool
    public let idempotencyKey: String
    public init(membershipVersion: Int, symbol: String, replacesScenarioSetId: String?,
                selection: FcffProviderSelection, sourceFingerprint: String,
                assumptions: FcffScenarioInput, bridgeReasons: FcffProviderBridgeReasons,
                idempotencyKey: String) {
        basisKind = "provider_fcff"; self.membershipVersion = membershipVersion; self.symbol = symbol
        self.replacesScenarioSetId = replacesScenarioSetId; self.selection = selection
        self.sourceFingerprint = sourceFingerprint; self.assumptions = assumptions
        self.bridgeReasons = bridgeReasons; ownerConfirmed = true; self.idempotencyKey = idempotencyKey
    }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(basisKind, forKey: .basisKind)
        try container.encode(membershipVersion, forKey: .membershipVersion)
        try container.encode(symbol, forKey: .symbol)
        if let replacesScenarioSetId {
            try container.encode(replacesScenarioSetId, forKey: .replacesScenarioSetId)
        } else {
            try container.encodeNil(forKey: .replacesScenarioSetId)
        }
        try container.encode(selection, forKey: .selection)
        try container.encode(sourceFingerprint, forKey: .sourceFingerprint)
        try container.encode(assumptions, forKey: .assumptions)
        try container.encode(bridgeReasons, forKey: .bridgeReasons)
        try container.encode(ownerConfirmed, forKey: .ownerConfirmed)
        try container.encode(idempotencyKey, forKey: .idempotencyKey)
    }
}
public struct ResearchProviderFcffScenarioSetData: Codable, Equatable, Identifiable, Sendable {
    public struct OwnerAssumptions: Codable, Equatable, Sendable {
        public let authority: String
        public let values: FcffScenarioInput
        public let bridgeReasons: FcffProviderBridgeReasons
    }
    public let id: String
    public let membershipId: String
    public let membershipVersionAtWrite: Int
    public let symbol: String
    public let revision: Int
    public let replacesScenarioSetId: String?
    public let scenarioState: String
    public let recomputable: Bool
    public let invalidatedBy: [String]
    public let providerReference: FcffProviderReference
    public let assumptions: OwnerAssumptions
    public let calculation: FcffScenarioCalculation
    public let safety: ResearchValuationSafety
    public let createdAt: String

    public func validates(membership: CandidateMembershipData) -> Bool {
        let selection = FcffProviderSelection(financialCaptureId: providerReference.financialCaptureId,
            sourceMaterialId: providerReference.materialId,
            annualPeriodEnd: providerReference.balanceReferenceDate,
            shareReferenceDate: providerReference.shareReferenceDate)
        guard researchDocumentIsPositiveIntegerString(id), membershipId == membership.id,
              symbol == membership.symbol, membershipVersionAtWrite > 0, revision > 0,
              (replacesScenarioSetId == nil) == (revision == 1),
              providerReference.validates(membership: membership, selection: selection,
                expectedVersion: membershipVersionAtWrite),
              assumptions.authority == "owner", assumptions.bridgeReasons.isComplete,
              assumptions.values.currency == providerReference.currency,
              assumptions.values.balanceReferenceDate == providerReference.balanceReferenceDate,
              assumptions.values.historicalAnnualPeriodEnd == providerReference.balanceReferenceDate,
              fcffPublishedHongKongDay(providerReference.capturedAt).map({
                  $0 <= assumptions.values.valuationCutoff
              }) ?? false,
              providerReference.shareReferenceDate.map({ $0 <= assumptions.values.valuationCutoff }) ?? true,
              providerReference.shareReference.map({ share in
                  [share.issuedPublishedAt, share.treasuryPublishedAt].allSatisfy { publishedAt in
                      fcffPublishedHongKongDay(publishedAt).map({
                          $0 <= assumptions.values.valuationCutoff
                      }) ?? false
                  }
              }) ?? true,
              recomputable == invalidatedBy.isEmpty,
              let expected = calculateFcffScenarioPreview(assumptions.values),
              fcffNear(expected.commonEquityValuePerShare, calculation.commonEquityValuePerShare),
              fcffNear(expected.operatingEnterpriseValue, calculation.operatingEnterpriseValue),
              fcffNear(expected.commonEquityValue, calculation.commonEquityValue),
              expected.annual.count == calculation.annual.count,
              expected.sensitivity.cells.count == calculation.sensitivity.cells.count,
              safety.advisoryOnly, safety.forecast,
              !safety.recommendation, !safety.automaticSignal, !safety.createsOrder,
              !safety.callsBroker, !safety.mutatesOfficialPortfolio else { return false }
        return expected.calculationVersion == calculation.calculationVersion
            && expected.valuationCutoff == calculation.valuationCutoff
            && expected.balanceReferenceDate == calculation.balanceReferenceDate
            && expected.historicalAnnualPeriodEnd == calculation.historicalAnnualPeriodEnd
            && expected.terminalAnchorDate == calculation.terminalAnchorDate
            && fcffNear(expected.terminalEnterpriseValue, calculation.terminalEnterpriseValue)
            && fcffNear(expected.terminalNextYearFcff, calculation.terminalNextYearFcff)
            && zip(expected.annual, calculation.annual).allSatisfy { left, right in
                left.periodStart == right.periodStart && left.periodEnd == right.periodEnd
                    && left.paymentDate == right.paymentDate && fcffNear(left.fcff, right.fcff)
                    && fcffNear(left.presentValue, right.presentValue)
            }
            && zip(expected.sensitivity.cells, calculation.sensitivity.cells).allSatisfy { left, right in
                fcffNear(left.wacc, right.wacc) && fcffNear(left.terminalGrowthRate, right.terminalGrowthRate)
                    && fcffNear(left.commonEquityValuePerShare, right.commonEquityValuePerShare)
            }
    }
}

private func fcffBridgeMatches(source: FcffSourcePreview, selection: FcffSourceSelection,
                               input: FcffScenarioInput, classification c: FcffBridgeClassification) -> Bool {
    guard let reference = source.bridgeReference, source.facts.count == Set(source.facts.map(\.id)).count,
          [c.cashSinceReferenceAdjustment, c.minimumOperatingCash, c.nonOperatingAssetAdjustment,
           c.debtSinceReferenceAdjustment, c.leaseSinceReferenceAdjustment, c.nciFairValueAdjustment,
           c.otherClaimsAdjustment, c.ordinarySharesSinceReferenceAdjustment,
           c.potentialDilutionShares].allSatisfy(\.isFinite),
          c.minimumOperatingCash >= 0, c.potentialDilutionShares >= 0,
          c.ordinarySharesSinceReferenceAdjustment.rounded() == c.ordinarySharesSinceReferenceAdjustment,
          c.potentialDilutionShares.rounded() == c.potentialDilutionShares,
          abs(c.ordinarySharesSinceReferenceAdjustment) <= 9_007_199_254_740_991,
          c.potentialDilutionShares <= 9_007_199_254_740_991,
          [c.cashReason, c.nonOperatingAssetsReason, c.debtReason, c.leaseTreatmentReason,
           c.noncontrollingInterestReason, c.otherClaimsReason, c.dilutedSharesReason,
           c.balanceDateGapReason, c.historicalBasisReason].allSatisfy({
                $0.trimmingCharacters(in: .whitespacesAndNewlines).count >= 8 && $0.count <= 500
           }) else { return false }
    let bridgeMetrics: [String: String] = [
        "cashAndEquivalents": "cash_and_cash_equivalents", "bankBorrowings": "bank_borrowings",
        "bondsCurrent": "bonds_current", "bondsNoncurrent": "bonds_noncurrent",
        "leaseCurrent": "lease_liabilities_current", "leaseNoncurrent": "lease_liabilities_noncurrent",
        "nciBookValue": "noncontrolling_interests", "issuedShares": "issued_shares",
        "treasuryShares": "treasury_shares"
    ]
    var amounts: [String: Double] = [:]
    for (role, metric) in bridgeMetrics {
        let facts = source.facts.filter { $0.role == role }
        guard facts.count == 1, let fact = facts.first,
              fact.id == (selection.bridgeValueIds[role] ?? nil), fact.metric == metric,
              fact.periodEnd == selection.balanceReferenceDate, fact.periodStart == nil,
              fact.value.isFinite, fact.value >= 0, fact.unitScale > 0,
              fact.originalSha256.count == 64, fact.citationSha256.count == 64,
              fact.scope == (["issuedShares", "treasuryShares"].contains(role)
                ? "parent_company" : "consolidated"),
              fact.currency == (["issuedShares", "treasuryShares"].contains(role)
                ? "XXX" : input.currency) else { return false }
        amounts[role] = fact.value
    }
    func group(_ role: String, _ ids: [String], _ metrics: Set<String>) -> Double? {
        let facts = source.facts.filter { $0.role == role }
        guard !ids.isEmpty, Set(ids) == Set(facts.map(\.id)),
              Set(facts.map(\.metric)).count == facts.count,
              facts.allSatisfy({ metrics.contains($0.metric)
                && $0.periodEnd == selection.balanceReferenceDate && $0.periodStart == nil
                && $0.scope == "consolidated" && $0.currency == input.currency
                && $0.value.isFinite && $0.value >= 0 }) else { return nil }
        return facts.reduce(0) { $0 + $1.value }
    }
    guard let nonOperating = group("nonOperatingAsset", selection.nonOperatingAssetValueIds,
              ["restricted_deposits", "structured_deposits", "fvoci_financial_assets",
               "associate_investments", "joint_venture_investments", "joint_venture_loans"]),
          let other = group("otherClaim", selection.otherClaimValueIds,
              ["derivative_liabilities", "nci_dividend_payable", "parent_dividend_payable"]),
          let cash = amounts["cashAndEquivalents"], let bank = amounts["bankBorrowings"],
          let bondsCurrent = amounts["bondsCurrent"], let bondsNoncurrent = amounts["bondsNoncurrent"],
          let leaseCurrent = amounts["leaseCurrent"], let leaseNoncurrent = amounts["leaseNoncurrent"],
          let nci = amounts["nciBookValue"], let issued = amounts["issuedShares"],
          let treasury = amounts["treasuryShares"],
          issued.rounded() == issued, treasury.rounded() == treasury, issued > treasury,
          issued <= 9_007_199_254_740_991, treasury <= 9_007_199_254_740_991,
          fcffNear(reference.cashAndEquivalents, cash),
          fcffNear(reference.nonOperatingAssets, nonOperating),
          fcffNear(reference.interestBearingDebtExcludingLeases, bank + bondsCurrent + bondsNoncurrent),
          fcffNear(reference.leaseLiabilities, leaseCurrent + leaseNoncurrent),
          fcffNear(reference.nciBookValue, nci), fcffNear(reference.otherClaims, other),
          fcffNear(reference.issuedShares, issued), fcffNear(reference.treasuryShares, treasury),
          fcffNear(reference.ordinaryShares, issued - treasury) else { return false }
    let bridge = input.bridge
    return fcffNear(bridge.excessCash, cash + c.cashSinceReferenceAdjustment - c.minimumOperatingCash)
        && fcffNear(bridge.nonOperatingAssets, nonOperating + c.nonOperatingAssetAdjustment)
        && fcffNear(bridge.interestBearingDebt, bank + bondsCurrent + bondsNoncurrent
            + c.debtSinceReferenceAdjustment)
        && fcffNear(bridge.leaseLiabilitiesNotInDebt, leaseCurrent + leaseNoncurrent
            + c.leaseSinceReferenceAdjustment)
        && fcffNear(bridge.noncontrollingInterests, nci + c.nciFairValueAdjustment)
        && fcffNear(bridge.otherNonordinaryClaims, other + c.otherClaimsAdjustment)
        && bridge.dilutedOrdinaryShares == issued - treasury
            + c.ordinarySharesSinceReferenceAdjustment + c.potentialDilutionShares
}
private func fcffNear(_ a: Double, _ b: Double) -> Bool {
    a.isFinite && b.isFinite && abs(a - b) <= 0.0000011
}
/// A valuation cutoff is the full Hong Kong calendar day, not an inferred publication hour.
public func fcffPublishedHongKongDay(_ publishedAt: String?) -> String? {
    guard let publishedAt else { return nil }
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    var instant = parser.date(from: publishedAt)
    if instant == nil {
        parser.formatOptions = [.withInternetDateTime]
        instant = parser.date(from: publishedAt)
    }
    guard let instant else { return nil }
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.timeZone = TimeZone(identifier: "Asia/Hong_Kong")
    formatter.locale = Locale(identifier: "en_US_POSIX")
    let day = formatter.string(from: instant)
    return fcffDay(day) == nil ? nil : day
}
private func fcffDay(_ value: String) -> Date? {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.isLenient = false
    guard let date = formatter.date(from: value), formatter.string(from: date) == value else { return nil }
    return date
}
private func fcffNextDay(_ value: String) -> String? {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    guard let date = fcffDay(value), let next = calendar.date(byAdding: .day, value: 1, to: date) else { return nil }
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    return formatter.string(from: next)
}
private func fcffRound(_ value: Double) -> Double { (value * 1_000_000).rounded() / 1_000_000 }

/// Local, read-only confirmation preview. The server recomputes and checks the same request before saving.
public func calculateFcffScenarioPreview(_ input: FcffScenarioInput) -> FcffScenarioCalculation? {
    guard input.currency.range(of: #"^[A-Z]{3}$"#, options: .regularExpression) != nil,
          input.historicalAnnualPeriodEnd.hasSuffix("-12-31"), fcffDay(input.historicalAnnualPeriodEnd) != nil,
          let balance = fcffDay(input.balanceReferenceDate),
          let historical = fcffDay(input.historicalAnnualPeriodEnd), balance >= historical,
          let cutoff = fcffDay(input.valuationCutoff), cutoff >= balance,
          !input.forecast.isEmpty, input.forecast.count <= 10,
          input.wacc > 0, input.wacc <= 1, input.waccStep > 0, input.waccStep <= 0.1,
          input.terminalGrowthStep > 0, input.terminalGrowthStep <= 0.1,
          (-0.5...0.5).contains(input.terminalGrowthRate),
          input.wacc - input.waccStep > input.terminalGrowthRate + input.terminalGrowthStep,
          input.bridge.dilutedOrdinaryShares > 0,
          input.bridge.dilutedOrdinaryShares.rounded() == input.bridge.dilutedOrdinaryShares,
          input.bridge.dilutedOrdinaryShares <= 9_007_199_254_740_991,
          [input.bridge.excessCash, input.bridge.nonOperatingAssets, input.bridge.interestBearingDebt,
           input.bridge.leaseLiabilitiesNotInDebt, input.bridge.noncontrollingInterests,
           input.bridge.otherNonordinaryClaims].allSatisfy({ $0.isFinite && $0 >= 0 }),
          var expectedStart = fcffNextDay(input.valuationCutoff) else { return nil }
    if !expectedStart.hasSuffix("-01-01") && input.forecast.count < 2 { return nil }
    for period in input.forecast + [input.terminalNextYear] {
        guard period.periodStart == expectedStart, period.paymentDate == period.periodEnd,
              period.periodEnd.hasSuffix("-12-31"),
              String(period.periodStart.prefix(4)) == String(period.periodEnd.prefix(4)),
              let start = fcffDay(period.periodStart), let end = fcffDay(period.periodEnd), start <= end,
              [period.ebit, period.operatingTaxRate, period.depreciationAmortization,
               period.grossCapitalReinvestment, period.increaseInNoncashWorkingCapital].allSatisfy(\.isFinite),
              (0...1).contains(period.operatingTaxRate),
              period.depreciationAmortization >= 0, period.grossCapitalReinvestment >= 0,
              let next = fcffNextDay(period.periodEnd) else { return nil }
        expectedStart = next
    }
    let terminalFcff = input.terminalNextYear.fcff
    let years = input.forecast.map { (fcffDay($0.paymentDate)!.timeIntervalSince(cutoff) / 86_400) / 365 }
    let last = years.last!
    let bridge = input.bridge
    let adjustment = bridge.excessCash + bridge.nonOperatingAssets - bridge.interestBearingDebt
        - bridge.leaseLiabilitiesNotInDebt - bridge.noncontrollingInterests - bridge.otherNonordinaryClaims
    func scenario(_ rate: Double, _ growth: Double) -> (Double, Double, Double, Double) {
        let flowPV = zip(input.forecast, years).reduce(0.0) { $0 + $1.0.fcff / pow(1 + rate, $1.1) }
        let terminalEV = terminalFcff / (rate - growth)
        let operatingEV = flowPV + terminalEV / pow(1 + rate, last)
        let equity = operatingEV + adjustment
        return (terminalEV, operatingEV, equity, equity / bridge.dilutedOrdinaryShares)
    }
    let base = scenario(input.wacc, input.terminalGrowthRate)
    let rates = [input.wacc - input.waccStep, input.wacc, input.wacc + input.waccStep]
    let growth = [input.terminalGrowthRate - input.terminalGrowthStep, input.terminalGrowthRate,
                  input.terminalGrowthRate + input.terminalGrowthStep]
    let cells = rates.flatMap { rate in growth.map { g in
        FcffScenarioCalculation.Cell(wacc: fcffRound(rate), terminalGrowthRate: fcffRound(g),
                                     commonEquityValuePerShare: fcffRound(scenario(rate, g).3))
    } }
    guard terminalFcff > 0, base.2 > 0,
          [base.0, base.1, base.2, base.3, terminalFcff].allSatisfy(\.isFinite),
          cells.allSatisfy({ $0.commonEquityValuePerShare.isFinite }) else { return nil }
    let annual = zip(input.forecast, years).map { period, yearsToPayment in
        FcffScenarioCalculation.Annual(periodStart: period.periodStart, periodEnd: period.periodEnd,
            paymentDate: period.paymentDate, yearsToPayment: fcffRound(yearsToPayment),
            fcff: fcffRound(period.fcff), presentValue: fcffRound(period.fcff / pow(1 + input.wacc, yearsToPayment)))
    }
    return FcffScenarioCalculation(methodId: "discounted_fcff_to_common_equity_owner_scenario",
        calculationVersion: "2026-10-12.discounted-fcff-to-common-equity.v2", currency: input.currency,
        historicalAnnualPeriodEnd: input.historicalAnnualPeriodEnd, balanceReferenceDate: input.balanceReferenceDate,
        valuationCutoff: input.valuationCutoff, dayCountConvention: "ACT/365F", annual: annual,
        terminalNextYearFcff: fcffRound(terminalFcff), terminalAnchorDate: input.forecast.last!.paymentDate,
        terminalYearsToAnchor: fcffRound(last), terminalEnterpriseValue: fcffRound(base.0),
        operatingEnterpriseValue: fcffRound(base.1), commonEquityValue: fcffRound(base.2),
        commonEquityValuePerShare: fcffRound(base.3),
        sensitivity: FcffScenarioCalculation.Sensitivity(waccRates: rates.map(fcffRound),
            terminalGrowthRates: growth.map(fcffRound), cells: cells))
}
