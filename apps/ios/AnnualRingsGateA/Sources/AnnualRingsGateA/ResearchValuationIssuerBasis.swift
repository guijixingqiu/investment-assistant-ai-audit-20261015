import Foundation

public let researchValuationIssuerBasisVersion = "2026-10-11.issuer-nav-source-draft.v1"

public func researchValuationIssuerBasisMissingText(_ code: String) -> String {
    switch code {
    case "current_asset_or_liability_anchor_required": "请选择当前总资产或总负债原值"
    case "verified_parent_company_balance_sheet_required": "锚点需为已核对的母公司资产负债表原值"
    case "matching_verified_parent_company_assets_and_liabilities_required": "缺少同日报日、币种、单位和母公司范围的资产负债配对"
    case "asset_original_unavailable": "总资产引用原件不可读"
    case "liability_original_unavailable": "总负债引用原件不可读"
    case "confirmed_same_date_ordinary_share_basis_required": "需确认同日普通股股数；已发行股数还须配对库存股"
    case "share_original_unavailable": "股数引用原件不可读"
    case "positive_exact_nav_per_share_required": "净资产/股无法得到正且可核对的数值"
    default: "来源条件未满足：\(code)"
    }
}

public struct ResearchValuationIssuerBasisBinding: Codable, Equatable, Sendable {
    public let kind: String
    public let schemaVersion: String
    public let assetValueId: String
    public let liabilityValueId: String
    public let shareValueIds: [String]
    public let sharesContextId: String
    public let sourceFingerprint: String
    public let proposedBaseMetricPerShare: Double
    public let adoptionMode: String
    public let ownerOverrideReason: String?
    public let ordinaryEquityOwnerConfirmed: Bool

    public var isValid: Bool {
        kind == "issuer_nav_source_draft" && schemaVersion == researchValuationIssuerBasisVersion
            && researchDocumentIsPositiveIntegerString(assetValueId)
            && researchDocumentIsPositiveIntegerString(liabilityValueId)
            && (1...2).contains(shareValueIds.count)
            && Set(shareValueIds).count == shareValueIds.count
            && shareValueIds.allSatisfy(researchDocumentIsPositiveIntegerString)
            && researchDocumentIsPositiveIntegerString(sharesContextId)
            && researchDocumentIsSha256(sourceFingerprint)
            && proposedBaseMetricPerShare.isFinite && proposedBaseMetricPerShare > 0
            && ordinaryEquityOwnerConfirmed
            && (adoptionMode == "source_value" && ownerOverrideReason == nil
                || adoptionMode == "owner_override"
                    && (ownerOverrideReason?.trimmingCharacters(in: .whitespacesAndNewlines).count ?? 0) >= 8)
    }

    public init?(preview: ResearchValuationIssuerBasisPreview,
        adoptedValue: Double, overrideReason: String?, ordinaryEquityOwnerConfirmed: Bool) {
        guard ordinaryEquityOwnerConfirmed,
              preview.status == "available", let asset = preview.asset,
              let liability = preview.liability, !preview.shareFacts.isEmpty,
              preview.shareFacts.count <= 2, let context = preview.sharesContextId,
              let fingerprint = preview.sourceFingerprint,
              let proposed = preview.proposedBaseMetricPerShare,
              adoptedValue.isFinite, adoptedValue > 0 else { return nil }
        let overridden = adoptedValue != proposed
        if overridden && (overrideReason?.trimmingCharacters(in: .whitespacesAndNewlines).count ?? 0) < 8 {
            return nil
        }
        kind = "issuer_nav_source_draft"
        schemaVersion = researchValuationIssuerBasisVersion
        assetValueId = asset.id
        liabilityValueId = liability.id
        shareValueIds = preview.shareFacts.map(\.id)
        sharesContextId = context
        sourceFingerprint = fingerprint
        proposedBaseMetricPerShare = proposed
        adoptionMode = overridden ? "owner_override" : "source_value"
        ownerOverrideReason = overridden ? overrideReason : nil
        self.ordinaryEquityOwnerConfirmed = true
    }
}

public struct ResearchValuationIssuerBasisPreview: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let status: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let anchorValueId: String
    public let periodEnd: String?
    public let currency: String?
    public let unitScale: Int?
    public let scope: String?
    public let formula: String
    public let asset: ResearchFundamentalValueData?
    public let liability: ResearchFundamentalValueData?
    public let shareFacts: [ResearchFundamentalValueData]
    public let sharesContextId: String?
    public let sharesCount: String?
    public let netAssets: String?
    public let proposedBaseMetricPerShare: Double?
    public let sourceFingerprint: String?
    public let missingInputs: [String]
    public let limitation: String

    public func validated(membership: CandidateMembershipData, anchorValueId: String) throws -> Self {
        guard schemaVersion == researchValuationIssuerBasisVersion,
              ["available", "missing_inputs"].contains(status),
              membershipId == membership.id, membershipVersion == membership.version,
              symbol == membership.symbol, self.anchorValueId == anchorValueId,
              formula == "(parent_company_total_assets - parent_company_total_liabilities) / confirmed_ordinary_shares",
              !limitation.isEmpty, missingInputs.count == Set(missingInputs).count else {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        if status == "available" {
            guard missingInputs.isEmpty, scope == "parent_company", let asset, let liability,
                  asset.metric == "total_assets", liability.metric == "total_liabilities",
                  [asset.id, liability.id].contains(anchorValueId),
                  asset.periodEnd == periodEnd, liability.periodEnd == periodEnd,
                  asset.currency == currency, liability.currency == currency,
                  asset.unitScale == unitScale, liability.unitScale == unitScale,
                  asset.scope == scope, liability.scope == scope,
                  (1...2).contains(shareFacts.count),
                  (shareFacts.count == 1 && shareFacts[0].metric == "shares_outstanding"
                    || shareFacts.count == 2 && shareFacts[0].metric == "issued_shares"
                        && shareFacts[1].metric == "treasury_shares"),
                  shareFacts.allSatisfy({ $0.periodEnd == periodEnd }),
                  sharesContextId.map(researchDocumentIsPositiveIntegerString) == true,
                  let sharesCount, Int(sharesCount).map({ $0 > 0 }) == true,
                  let value = proposedBaseMetricPerShare, value.isFinite, value > 0,
                  sourceFingerprint.map(researchDocumentIsSha256) == true,
                  netAssets != nil else { throw ResearchValuationScenarioClientError.invalidResponse }
        } else if proposedBaseMetricPerShare != nil || sourceFingerprint != nil || missingInputs.isEmpty {
            throw ResearchValuationScenarioClientError.invalidResponse
        }
        return self
    }
}
