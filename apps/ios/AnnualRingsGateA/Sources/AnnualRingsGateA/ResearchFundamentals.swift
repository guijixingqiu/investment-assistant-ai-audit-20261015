import Foundation

public struct ResearchFundamentalSourceData: Codable, Equatable, Sendable {
    public let materialId: String
    public let materialRevision: Int
    public let materialRevisionState: String
    public let validUntil: String
    public let freshness: String
    public let materialSourceVersion: String
    public let kind: String?
    public let documentId: String?
    public let documentPdfSha256: String?
    public let pageNumber: Int?
    public let pageTextSha256: String?
    public let snapshotCitation: ResearchSnapshotCitation?
    public let snapshotOriginal: ResearchSnapshotOriginal?
    public let snapshotReviewState: String?
    public let originalAvailability: String?

    public var hasValidCitation: Bool {
        if kind == "source_snapshot" {
            return documentId == nil && documentPdfSha256 == nil && pageNumber == nil && pageTextSha256 == nil
                && snapshotCitation?.isValid == true && snapshotOriginal?.isValid == true
                && snapshotReviewState.map { ["current", "pending_review"].contains($0) } != false
                && originalAvailability.map { ["available", "unavailable", "unknown"].contains($0) } != false
        }
        return kind == nil && snapshotCitation == nil && snapshotOriginal == nil
            && documentId.map(researchDocumentIsPositiveIntegerString) == true
            && documentPdfSha256.map(researchDocumentIsSha256) == true
            && pageTextSha256.map(researchDocumentIsSha256) == true
            && (pageNumber ?? 0) > 0
    }

    public var isCurrentlyUsable: Bool {
        kind != "source_snapshot" || snapshotReviewState == "current" && originalAvailability == "available"
    }
}

public struct ResearchFundamentalSnapshotTextBinding: Codable, Equatable, Sendable {
    public let snapshotId: String
    public let textSha256: String
    public let startUtf16: Int
    public let endUtf16: Int
    public let excerptSha256: String
    public let sourceExcerpt: String
    public let rawValueText: String
}

public struct ResearchFundamentalDocumentTextBinding: Codable, Equatable, Sendable {
    public let documentId: String
    public let pageNumber: Int
    public let pageTextSha256: String
    public let sourceExcerpt: String
    public let rawValueText: String
}

public struct ResearchFundamentalMix: Codable, Equatable, Sendable {
    public let dimension: String
    public let dimensionValue: String
    public let parentScope: String
    public let overlapPolicy: String?
}

public struct ResearchFundamentalGuidance: Codable, Equatable, Sendable {
    public let lower: Double?
    public let upper: Double?
    public let definition: String
    public let expectedVerificationDate: String
    public let targetType: String
    public let statement: String

    private enum CodingKeys: String, CodingKey {
        case lower, upper, definition, expectedVerificationDate, targetType, statement
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if let lower { try container.encode(lower, forKey: .lower) }
        else { try container.encodeNil(forKey: .lower) }
        if let upper { try container.encode(upper, forKey: .upper) }
        else { try container.encodeNil(forKey: .upper) }
        try container.encode(definition, forKey: .definition)
        try container.encode(expectedVerificationDate, forKey: .expectedVerificationDate)
        try container.encode(targetType, forKey: .targetType)
        try container.encode(statement, forKey: .statement)
    }
}

public struct ResearchFundamentalStructureConfirmation: Codable, Equatable, Sendable {
    public let confirmedFields: [String]
}

public struct ResearchFundamentalAssertion: Codable, Equatable, Sendable {
    public let unit: String
    public let measurementBasis: String
    public let businessScope: String
    public let category: String
    public let sourceUrl: String
    public let limitation: String
    public let sourceChecked: Bool
    public let structureConfirmation: ResearchFundamentalStructureConfirmation?
    public let snapshotTextBinding: ResearchFundamentalSnapshotTextBinding?
    public var textBinding: ResearchFundamentalDocumentTextBinding? = nil
    public var mix: ResearchFundamentalMix? = nil
    public var guidance: ResearchFundamentalGuidance? = nil
}

public struct ResearchFundamentalMetricOption: Identifiable, Sendable {
    public let id: String
    public let title: String
    public let unit: String
    public let isInstant: Bool
    public let measurementBasis: String

    public init(_ id: String, _ title: String, _ unit: String,
                instant: Bool = false, basis: String = "financial_statement") {
        self.id = id; self.title = title; self.unit = unit
        self.isInstant = instant; self.measurementBasis = basis
    }
}

public enum ResearchFundamentalMetricCatalog {
    public static let coverage: Set<String> = [
        "revenue", "profit_attributable_to_owners", "operating_cash_flow", "total_assets", "total_liabilities"
    ]
    public static let magnitudeOutflows: Set<String> = [
        "property_plant_equipment_purchases", "intangible_asset_purchases", "land_lease_prepayments",
        "capital_expenditure", "research_and_development_expense", "selling_and_distribution_expense",
        "administrative_expense", "depreciation_amortization"
    ]
    public static let options: [ResearchFundamentalMetricOption] = [
        .init("revenue", "收入", "currency"),
        .init("profit_attributable_to_owners", "归母利润", "currency"),
        .init("operating_cash_flow", "经营现金流", "currency"),
        .init("total_assets", "总资产", "currency", instant: true),
        .init("total_liabilities", "总负债", "currency", instant: true),
        .init("sales_volume", "销量", "vehicles", basis: "issuer_sales"),
        .init("average_selling_price", "平均售价", "currency_per_vehicle", basis: "issuer_sales"),
        .init("product_mix_volume", "产品结构销量", "vehicles", basis: "issuer_sales"),
        .init("sales_volume_yoy", "销量同比", "ratio", basis: "issuer_sales"),
        .init("shares_outstanding", "流通股数", "shares", instant: true, basis: "issued_shares"),
        .init("issued_shares", "已发行股数", "shares", instant: true, basis: "issued_shares"),
        .init("treasury_shares", "库存股数", "shares", instant: true, basis: "issued_shares"),
        .init("gross_profit", "毛利", "currency"),
        .init("gross_margin", "毛利率", "ratio"),
        .init("research_and_development_expense", "研发费用", "currency"),
        .init("selling_and_distribution_expense", "销售及分销费用", "currency"),
        .init("administrative_expense", "行政费用", "currency"),
        .init("operating_profit", "经营利润", "currency"),
        .init("profit_before_tax", "税前利润", "currency"),
        .init("net_finance_income", "财务收入净额", "currency"),
        .init("associates_profit", "联营公司利润", "currency"),
        .init("joint_ventures_profit", "合营公司利润", "currency"),
        .init("capital_expenditure", "资本投入", "currency"),
        .init("core_profit_attributable_to_owners", "核心归母利润", "currency"),
        .init("property_plant_equipment_purchases", "物业厂房设备付款", "currency"),
        .init("intangible_asset_purchases", "无形资产付款", "currency"),
        .init("land_lease_prepayments", "土地租赁预付款", "currency"),
        .init("fx_effect", "汇率影响", "currency"),
        .init("non_financial_impairment", "非金融资产减值", "currency"),
        .init("deemed_disposal_gain", "视同处置收益", "currency"),
        .init("depreciation_amortization", "折旧及摊销", "currency"),
        .init("cash_and_cash_equivalents", "现金及等价物", "currency", instant: true),
        .init("bank_borrowings", "银行借款", "currency", instant: true),
        .init("bonds_current", "一年内到期债券", "currency", instant: true),
        .init("bonds_noncurrent", "非流动债券", "currency", instant: true),
        .init("lease_liabilities_current", "一年内租赁负债", "currency", instant: true),
        .init("lease_liabilities_noncurrent", "非流动租赁负债", "currency", instant: true),
        .init("restricted_deposits", "受限存款", "currency", instant: true),
        .init("structured_deposits", "结构性存款", "currency", instant: true),
        .init("fvoci_financial_assets", "其他综合收益公允价值金融资产", "currency", instant: true),
        .init("associate_investments", "联营公司投资", "currency", instant: true),
        .init("joint_venture_investments", "合营公司投资", "currency", instant: true),
        .init("joint_venture_loans", "合营公司贷款", "currency", instant: true),
        .init("noncontrolling_interests", "少数股东权益账面额", "currency", instant: true),
        .init("derivative_liabilities", "衍生金融负债", "currency", instant: true),
        .init("nci_dividend_payable", "应付少数股东股利", "currency", instant: true),
        .init("parent_dividend_payable", "应付母公司股利", "currency", instant: true),
        .init("trade_receivables", "应收账款", "currency", instant: true),
        .init("inventories", "存货", "currency", instant: true),
        .init("prepayments_and_other_operating_receivables", "经营性预付及其他应收", "currency", instant: true),
        .init("trade_payables", "应付账款", "currency", instant: true),
        .init("contract_liabilities", "合同负债", "currency", instant: true),
        .init("accrued_operating_liabilities", "应计经营负债", "currency", instant: true)
    ]

    public static func option(for metric: String) -> ResearchFundamentalMetricOption? {
        options.first { $0.id == metric }
    }

    public static func allowsGuidance(_ metric: String) -> Bool {
        guard let option = option(for: metric) else { return false }
        return !option.isInstant && !coverage.contains(metric)
    }

    public static func measurementBases(for metric: String) -> [String] {
        guard let option = option(for: metric) else { return [] }
        return option.measurementBasis == "issuer_sales"
            ? ["issuer_sales", "monthly_wholesale", "monthly_retail", "weekly_registration"]
            : [option.measurementBasis]
    }
}

public enum ResearchFundamentalTranscription {
    public static func hasExactSourceToken(_ raw: String, in excerpt: String) -> Bool {
        guard !raw.isEmpty else { return false }
        let pattern = #"(?<![0-9.,+%()\-])"# + NSRegularExpression.escapedPattern(for: raw)
            + #"(?![0-9.,%])"#
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return false }
        return expression.firstMatch(in: excerpt,
            range: NSRange(excerpt.startIndex..<excerpt.endIndex, in: excerpt)) != nil
    }

    public static func matches(value: String, raw: String, unit: String, unitScale: Int,
                               metric: String? = nil) -> Bool {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let raw = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let parenthesized = raw.hasPrefix("(") && raw.hasSuffix(")")
        let numericRaw = parenthesized ? String(raw.dropFirst().dropLast()) : raw
        guard value.range(of: #"^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$"#, options: .regularExpression) != nil,
              numericRaw.range(of: parenthesized
                  ? #"^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$"#
                  : #"^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$"#,
                  options: .regularExpression) != nil,
              !numericRaw.hasSuffix("%") || unit == "ratio",
              let entered = Decimal(string: value, locale: Locale(identifier: "en_US_POSIX")),
              let quoted = Decimal(string: numericRaw.replacingOccurrences(of: ",", with: "")
                  .replacingOccurrences(of: "%", with: ""), locale: Locale(identifier: "en_US_POSIX")) else { return false }
        if parenthesized {
            guard let metric,
                  ResearchFundamentalMetricCatalog.magnitudeOutflows.contains(metric) || quoted != 0,
                  entered == (ResearchFundamentalMetricCatalog.magnitudeOutflows.contains(metric)
                    ? quoted : -quoted) else { return false }
        } else if entered != (numericRaw.hasSuffix("%") ? quoted / 100 : quoted) { return false }
        if ["vehicles", "shares"].contains(unit) {
            let count = (value as NSString).doubleValue * Double(unitScale)
            return count >= 0 && count <= Double(9_007_199_254_740_991) && count.rounded() == count
        }
        if unit == "ratio" { return unitScale == 1 && (value as NSString).doubleValue.isFinite }
        return ["currency", "currency_per_vehicle"].contains(unit)
    }
}

public struct ResearchFundamentalValueData: Codable, Equatable, Identifiable, Sendable {
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
    public var assertion: ResearchFundamentalAssertion? = nil
    public let provenance: ResearchFundamentalProvenance
    public let source: ResearchFundamentalSourceData
    public let createdAt: String

    public var isCurrentlyUsable: Bool { valueState == "current" && source.isCurrentlyUsable }
}

public struct ResearchFundamentalProvenance: Codable, Equatable, Sendable {
    public let factKind: String
    public let transcription: String
    public let verificationStatus: String
}

public struct ResearchFundamentalDerivationData: Codable, Equatable, Sendable {
    public let kind: String
    public let periodEnd: String
    public let basePeriodEnd: String?
    public let status: String
    public let value: String?
    public let valueKind: String
    public let reason: String?
    public let formulaVersion: String
    public let inputValueIds: [String]
}

public struct ResearchFinancialPeriodCoverage: Codable, Equatable, Sendable {
    public let periodStart: String?
    public let periodEnd: String
    public let periodType: String
    public let status: String
    public let metrics: [String: String]
}

public struct ResearchFinancialCoverage: Codable, Equatable, Sendable {
    public let coverageVersion: String?
    public let requirement: ResearchFinancialRequirementData?
    public let historicalStatus: String?
    public let latestRequiredStatus: String?
    public let latestRequiredPeriodEnd: String?
    public let status: String
    public let requiredAnnualPeriods: Int
    public let completeAnnualPeriods: Int
    public let latestInterimPeriodEnd: String?
    public let latestInterimStatus: String
    public let periods: [ResearchFinancialPeriodCoverage]
    public let gaps: [String]
}

public struct ResearchFundamentalsEnvelope: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-30.research-fundamentals.v1"
    public let schemaVersion: String
    public let generatedAt: String
    public let dataCutoffAt: String?
    public let asOf: String?
    public let provenance: String
    public let status: String
    public let requestedActorId: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let values: [ResearchFundamentalValueData]
    public let derivations: [ResearchFundamentalDerivationData]
    public let financialCoverage: ResearchFinancialCoverage

    public func validate(expected membership: CandidateMembershipData) throws {
        let coverageMetrics = Set(["revenue", "profit_attributable_to_owners", "operating_cash_flow", "total_assets", "total_liabilities"])
        let metrics = coverageMetrics.union(Set(ResearchFundamentalMetricCatalog.options.map(\.id)))
        let ids = Set(values.map(\.id))
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionV1 || status != "available" { errors.append("fundamental envelope version or status is invalid") }
        if provenance != "research_only" || dataCutoffAt.map({ isParseableDateTime($0) }) == false
            || asOf.map({ ResearchFundamentalCalendarDate.date(from: $0, calendar: Calendar(identifier: .gregorian)) != nil }) == false {
            errors.append("fundamental envelope cutoff or provenance is invalid")
        }
        if requestedActorId != membership.actorId || membershipId != membership.id
            || membershipVersion != membership.version || symbol != membership.symbol {
            errors.append("fundamental envelope does not match current membership")
        }
        if ids.count != values.count { errors.append("fundamental ids must be unique") }
        for value in values {
            if value.membershipId != membership.id || value.symbol != membership.symbol
                || !metrics.contains(value.metric)
                || !["duration", "instant"].contains(value.periodKind)
                || !["reported", "explicit_unknown"].contains(value.valueStatus)
                || (value.valueStatus == "explicit_unknown") != (value.value == nil)
                || !["current", "replaced", "historical_source_superseded", "historical_source_stale", "retracted", "invalid"].contains(value.valueState)
                || value.provenance.factKind != "issuer_reported"
                || value.provenance.transcription != "owner_manual"
                || !["unverified", "verified", "owner_confirmed", "source_text_verified"].contains(value.provenance.verificationStatus)
                || !researchDocumentIsPositiveIntegerString(value.source.materialId)
                || !value.source.hasValidCitation
                || !["current", "superseded"].contains(value.source.materialRevisionState)
                || !["fresh", "stale"].contains(value.source.freshness)
                || researchFundamentalRFC3339Date(value.source.validUntil) == nil {
                errors.append("fundamental value identity or provenance is invalid")
            }
            if value.valueState == "current",
               value.source.materialRevisionState != "current" || value.source.freshness != "fresh" {
                errors.append("current fundamental value requires a fresh current source")
            }
            if value.valueState == "historical_source_stale",
               value.source.materialRevisionState != "current" || value.source.freshness != "stale" {
                errors.append("stale-source fundamental history is inconsistent")
            }
        }
        for derivation in derivations {
            if derivation.formulaVersion != "issuer-fundamentals-v1"
                || !["available", "not_comparable"].contains(derivation.status)
                || derivation.inputValueIds.contains(where: { !ids.contains($0) })
                || (derivation.status == "available") != (derivation.value != nil) {
                errors.append("fundamental derivation is not reproducible")
            }
        }
        let completeAnnual = financialCoverage.periods.filter { $0.periodType == "annual" && $0.status == "complete" }.count
        let latestInterim = financialCoverage.periods.first { $0.periodType == "interim" }
        let coverageIsV2 = financialCoverage.coverageVersion == "2026-10-10.honest-coverage.v2"
        let coverageIsV3 = financialCoverage.coverageVersion == "2026-10-10.sourced-coverage.v3"
        if (financialCoverage.coverageVersion != nil && !coverageIsV2 && !coverageIsV3)
            || (coverageIsV2 && (financialCoverage.historicalStatus == nil
                || financialCoverage.latestRequiredStatus == nil
                || financialCoverage.status != "unknown"
                || financialCoverage.latestRequiredStatus != "unknown"
                || financialCoverage.requirement != nil))
            || !["available", "unknown"].contains(financialCoverage.status)
            || financialCoverage.requiredAnnualPeriods != 5
            || (coverageIsV2
                ? financialCoverage.completeAnnualPeriods > completeAnnual
                : !coverageIsV3 && financialCoverage.completeAnnualPeriods != completeAnnual)
            || (!coverageIsV3 && financialCoverage.latestInterimPeriodEnd != latestInterim?.periodEnd)
            || (!coverageIsV3 && financialCoverage.latestInterimStatus != (latestInterim?.status ?? "unknown"))
            || financialCoverage.periods.contains(where: {
                !["annual", "interim"].contains($0.periodType)
                    || !["complete", "unknown"].contains($0.status)
                    || Set($0.metrics.keys) != coverageMetrics
                    || $0.metrics.values.contains(where: { !["available", "unknown"].contains($0) })
            })
            || (!coverageIsV2 && !coverageIsV3 && (financialCoverage.status == "available") != (completeAnnual >= 5 && financialCoverage.latestInterimStatus == "complete" && financialCoverage.gaps.isEmpty))
            || (coverageIsV2 && financialCoverage.historicalStatus != (financialCoverage.completeAnnualPeriods >= 5 ? "available" : "unknown")) {
            errors.append("financial coverage is inconsistent")
        }
        if coverageIsV3 {
            guard let requirement = financialCoverage.requirement,
                  requirement.validates(expected: membership) else {
                errors.append("financial requirement binding is missing or has changed")
                throw ResearchFundamentalClientError.invalidResponse
            }
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(secondsFromGMT: 0)!
            var expectedAnnualCount = 0
            for offset in 0..<5 {
                let year = (Int(requirement.latestRequiredAnnualPeriodEnd.prefix(4)) ?? 0) - offset
                let previousEnd = String(format: "%04d-%@", year - 1, requirement.fiscalYearEnd)
                guard let previousDate = ResearchFundamentalCalendarDate.date(from: previousEnd, calendar: calendar),
                      let nextDate = calendar.date(byAdding: .day, value: 1, to: previousDate),
                      let start = ResearchFundamentalCalendarDate.string(from: nextDate, calendar: calendar) else { break }
                let end = String(format: "%04d-%@", year, requirement.fiscalYearEnd)
                if financialCoverage.periods.contains(where: {
                    $0.periodType == "annual" && $0.periodStart == start
                        && $0.periodEnd == end && $0.status == "complete"
                }) { expectedAnnualCount += 1 } else { break }
            }
            let requiredInterim = financialCoverage.periods.first {
                $0.periodType == "interim"
                    && $0.periodStart == requirement.latestRequiredInterimPeriodStart
                    && $0.periodEnd == requirement.latestRequiredInterimPeriodEnd
            }
            let interimComplete = requiredInterim?.status == "complete"
            let latestIsAnnual = requirement.latestRequiredAnnualPeriodEnd > requirement.latestRequiredInterimPeriodEnd
            let latestAnnual = financialCoverage.periods.first {
                $0.periodType == "annual" && $0.periodEnd == requirement.latestRequiredAnnualPeriodEnd
            }
            let latestComplete = (latestIsAnnual ? latestAnnual : requiredInterim)?.status == "complete"
            if financialCoverage.completeAnnualPeriods != expectedAnnualCount
                || financialCoverage.latestInterimPeriodEnd != requiredInterim?.periodEnd
                || financialCoverage.latestInterimStatus != (requiredInterim?.status ?? "unknown")
                || financialCoverage.latestRequiredPeriodEnd != (latestIsAnnual
                    ? requirement.latestRequiredAnnualPeriodEnd : requirement.latestRequiredInterimPeriodEnd)
                || financialCoverage.latestRequiredStatus != (latestComplete ? "available" : "unknown")
                || financialCoverage.historicalStatus != (expectedAnnualCount >= 5 ? "available" : "unknown")
                || (financialCoverage.status == "available") != (expectedAnnualCount >= 5 && interimComplete && financialCoverage.gaps.isEmpty) {
                errors.append("source-bound financial coverage summary is inconsistent")
            }
        } else if financialCoverage.requirement != nil {
            errors.append("historical financial coverage cannot carry a new requirement")
        }
        if !errors.isEmpty { throw ResearchFundamentalClientError.invalidResponse }
    }
}

public struct CreateResearchFundamentalValueRequest: Codable, Equatable, Sendable {
    public let membershipVersion: Int
    public let sourceMaterialId: String
    public var assertion: ResearchFundamentalAssertion? = nil
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
    public let ownerConfirmed: Bool
    public let idempotencyKey: String

    private enum CodingKeys: String, CodingKey {
        case membershipVersion, sourceMaterialId, assertion, metric, periodKind, periodStart,
             periodEnd, currency, unitScale, scope, valueStatus, value, comparability,
             comparabilityReason, amendmentKind, replacesValueId, ownerConfirmed, idempotencyKey
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(membershipVersion, forKey: .membershipVersion)
        try container.encode(sourceMaterialId, forKey: .sourceMaterialId)
        try container.encodeIfPresent(assertion, forKey: .assertion)
        try container.encode(metric, forKey: .metric)
        try container.encode(periodKind, forKey: .periodKind)
        if let periodStart { try container.encode(periodStart, forKey: .periodStart) }
        else { try container.encodeNil(forKey: .periodStart) }
        try container.encode(periodEnd, forKey: .periodEnd)
        try container.encode(currency, forKey: .currency)
        try container.encode(unitScale, forKey: .unitScale)
        try container.encode(scope, forKey: .scope)
        try container.encode(valueStatus, forKey: .valueStatus)
        if let value { try container.encode(value, forKey: .value) }
        else { try container.encodeNil(forKey: .value) }
        try container.encode(comparability, forKey: .comparability)
        if let comparabilityReason { try container.encode(comparabilityReason, forKey: .comparabilityReason) }
        else { try container.encodeNil(forKey: .comparabilityReason) }
        try container.encode(amendmentKind, forKey: .amendmentKind)
        if let replacesValueId { try container.encode(replacesValueId, forKey: .replacesValueId) }
        else { try container.encodeNil(forKey: .replacesValueId) }
        try container.encode(ownerConfirmed, forKey: .ownerConfirmed)
        try container.encode(idempotencyKey, forKey: .idempotencyKey)
    }
}

public struct ResearchFundamentalDraftSemantic: Equatable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let sourceMaterialId: String
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
    public var assertion: ResearchFundamentalAssertion? = nil

    public var fingerprint: String {
        var parts: [String] = [
            membershipId, String(membershipVersion), sourceMaterialId, metric, periodKind,
            periodStart ?? "", periodEnd, currency, String(unitScale), scope, valueStatus,
            value ?? "", comparability, comparabilityReason ?? "", amendmentKind,
            replacesValueId ?? "", assertion?.unit ?? "", assertion?.measurementBasis ?? "",
            assertion?.businessScope ?? "", assertion?.category ?? "", assertion?.sourceUrl ?? "",
            assertion?.limitation ?? "", assertion?.sourceChecked == true ? "yes" : "no",
            assertion?.structureConfirmation?.confirmedFields.joined(separator: ",") ?? "",
            assertion?.snapshotTextBinding?.snapshotId ?? "",
            assertion?.snapshotTextBinding?.textSha256 ?? "",
            String(assertion?.snapshotTextBinding?.startUtf16 ?? -1),
            String(assertion?.snapshotTextBinding?.endUtf16 ?? -1),
            assertion?.snapshotTextBinding?.excerptSha256 ?? "",
            assertion?.snapshotTextBinding?.sourceExcerpt ?? "",
            assertion?.snapshotTextBinding?.rawValueText ?? ""
        ]
        parts.append(contentsOf: [
            assertion?.textBinding?.documentId ?? "",
            String(assertion?.textBinding?.pageNumber ?? -1),
            assertion?.textBinding?.pageTextSha256 ?? "",
            assertion?.textBinding?.sourceExcerpt ?? "",
            assertion?.textBinding?.rawValueText ?? "",
            assertion?.mix?.dimension ?? "",
            assertion?.mix?.dimensionValue ?? "",
            assertion?.mix?.parentScope ?? "",
            assertion?.mix?.overlapPolicy ?? "",
            assertion?.guidance?.targetType ?? "",
            assertion?.guidance?.definition ?? "",
            assertion?.guidance?.expectedVerificationDate ?? "",
            assertion?.guidance?.statement ?? "",
            assertion?.guidance?.lower.map { String($0) } ?? "",
            assertion?.guidance?.upper.map { String($0) } ?? ""
        ])
        return parts.map { "\(Data($0.utf8).count):\($0)" }.joined(separator: "|")
    }

    fileprivate func request(idempotencyKey: String) -> CreateResearchFundamentalValueRequest {
        CreateResearchFundamentalValueRequest(
            membershipVersion: membershipVersion,
            sourceMaterialId: sourceMaterialId,
            assertion: assertion,
            metric: metric,
            periodKind: periodKind,
            periodStart: periodStart,
            periodEnd: periodEnd,
            currency: currency,
            unitScale: unitScale,
            scope: scope,
            valueStatus: valueStatus,
            value: value,
            comparability: comparability,
            comparabilityReason: comparabilityReason,
            amendmentKind: amendmentKind,
            replacesValueId: replacesValueId,
            ownerConfirmed: true,
            idempotencyKey: idempotencyKey
        )
    }
}

public struct ResearchFundamentalConfirmationBinding: Equatable, Sendable {
    public private(set) var confirmedSemanticFingerprint: String?

    public init() {}

    public mutating func setConfirmed(
        _ confirmed: Bool,
        semantic: ResearchFundamentalDraftSemantic?
    ) {
        confirmedSemanticFingerprint = confirmed ? semantic?.fingerprint : nil
    }

    public func isConfirmed(for semantic: ResearchFundamentalDraftSemantic?) -> Bool {
        guard let semantic else { return false }
        return confirmedSemanticFingerprint == semantic.fingerprint
    }

    public func makeRequest(
        semantic: ResearchFundamentalDraftSemantic?,
        idempotencyKey: String
    ) -> CreateResearchFundamentalValueRequest? {
        guard let semantic, isConfirmed(for: semantic) else { return nil }
        return semantic.request(idempotencyKey: idempotencyKey)
    }

    public mutating func clear() {
        confirmedSemanticFingerprint = nil
    }
}

public enum ResearchFundamentalClientError: Error, Equatable, Sendable {
    case httpStatus(Int)
    case invalidResponse
}

public struct ResearchFundamentalSourceReconciliation: Equatable, Sendable {
    public let selectedMaterialId: String?
    public let requiresDraftReset: Bool
}

public func canAcquireResearchDocumentRefreshLane(
    isLoading: Bool,
    isImporting: Bool,
    isConfirming: Bool
) -> Bool {
    !isLoading && !isImporting && !isConfirming
}

public func reconcileResearchFundamentalSource(
    selectedMaterialId: String?,
    materials: [ResearchMaterialData],
    serverAsOf: String? = nil,
    fundamentalValues: [ResearchFundamentalValueData] = [],
    verifiedSnapshot: ResearchSourceSnapshotData? = nil,
    verifiedSnapshots: [String: ResearchSourceSnapshotData] = [:]
) -> ResearchFundamentalSourceReconciliation {
    guard let selectedMaterialId else {
        return ResearchFundamentalSourceReconciliation(
            selectedMaterialId: nil,
            requiresDraftReset: false
        )
    }
    let currentMaterialIds = currentResearchFundamentalMaterials(
        materials: materials,
        serverAsOf: serverAsOf,
        fundamentalValues: fundamentalValues,
        verifiedSnapshot: verifiedSnapshot,
        verifiedSnapshots: verifiedSnapshots
    ).map(\.id)
    guard currentMaterialIds.contains(selectedMaterialId) else {
        return ResearchFundamentalSourceReconciliation(
            selectedMaterialId: nil,
            requiresDraftReset: true
        )
    }
    return ResearchFundamentalSourceReconciliation(
        selectedMaterialId: selectedMaterialId,
        requiresDraftReset: false
    )
}

public func currentResearchFundamentalMaterials(
    materials: [ResearchMaterialData],
    serverAsOf: String? = nil,
    fundamentalValues: [ResearchFundamentalValueData] = [],
    verifiedSnapshot: ResearchSourceSnapshotData? = nil,
    verifiedSnapshots: [String: ResearchSourceSnapshotData] = [:]
) -> [ResearchMaterialData] {
    let serverDate: Date?
    if let serverAsOf {
        guard let parsed = researchFundamentalRFC3339Date(serverAsOf) else { return [] }
        serverDate = parsed
    } else {
        serverDate = nil
    }
    return materials
        .filter { material in
            let exactSnapshot = material.snapshotCitation.flatMap { verifiedSnapshots[$0.snapshotId] }
                ?? verifiedSnapshot
            return material.revisionState == "current"
                && (material.sourceType == "owner_provided_pdf" && material.citation != nil
                    || material.sourceType == "issuer_public_html"
                        && exactSnapshot?.reviewState == "current"
                        && material.snapshotCitation?.snapshotId == exactSnapshot?.id
                        && material.snapshotCitation?.textSha256 == exactSnapshot?.textSha256
                        && material.snapshotOriginal?.rawSha256 == exactSnapshot?.rawSha256
                        && material.snapshotCitation.flatMap { citation in
                            guard citation.isValid,
                                  let text = exactSnapshot?.normalizedText,
                                  citation.endUtf16 <= text.utf16.count else { return false }
                            return exactSnapshot?.selectedCitation(range: NSRange(location: citation.startUtf16,
                                length: citation.endUtf16 - citation.startUtf16))?.0 == citation
                        } == true)
                && material.freshness == "fresh"
                && (serverDate.map { cutoff in
                    researchFundamentalRFC3339Date(material.validUntil).map { $0 > cutoff } == true
                } ?? true)
                && !fundamentalValues.contains(where: { value in
                    value.source.materialId == material.id
                        && (value.valueState == "historical_source_stale"
                            || value.valueState == "historical_source_superseded"
                            || value.source.materialRevisionState != "current"
                            || value.source.freshness != "fresh"
                            || !value.source.isCurrentlyUsable)
                })
        }
}

public enum ResearchFundamentalCalendarDate {
    public static func string(from date: Date, calendar: Calendar) -> String? {
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        guard let year = components.year,
              let month = components.month,
              let day = components.day else { return nil }
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    public static func date(from value: String, calendar: Calendar) -> Date? {
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3,
              let year = Int(parts[0]),
              let month = Int(parts[1]),
              let day = Int(parts[2]),
              let date = calendar.date(from: DateComponents(year: year, month: month, day: day)),
              string(from: date, calendar: calendar) == value else { return nil }
        return date
    }
}

private func researchFundamentalRFC3339Date(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}
