import type { ResearchFundamentalValueData } from "./researchFundamentals.js";

export const RESEARCH_VALUATION_ISSUER_BASIS_VERSION = "2026-10-11.issuer-nav-source-draft.v1";

export interface ResearchValuationIssuerBasisPreview {
  schemaVersion: typeof RESEARCH_VALUATION_ISSUER_BASIS_VERSION;
  status: "available" | "missing_inputs";
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  anchorValueId: string;
  periodEnd: string | null;
  currency: string | null;
  unitScale: number | null;
  scope: "parent_company" | null;
  formula: "(parent_company_total_assets - parent_company_total_liabilities) / confirmed_ordinary_shares";
  asset: ResearchFundamentalValueData | null;
  liability: ResearchFundamentalValueData | null;
  shareFacts: ResearchFundamentalValueData[];
  sharesContextId: string | null;
  sharesCount: string | null;
  netAssets: string | null;
  proposedBaseMetricPerShare: number | null;
  sourceFingerprint: string | null;
  missingInputs: string[];
  limitation: string;
}

export interface ResearchValuationIssuerBasisBinding {
  kind: "issuer_nav_source_draft";
  schemaVersion: typeof RESEARCH_VALUATION_ISSUER_BASIS_VERSION;
  assetValueId: string;
  liabilityValueId: string;
  shareValueIds: string[];
  sharesContextId: string;
  sourceFingerprint: string;
  proposedBaseMetricPerShare: number;
  adoptionMode: "source_value" | "owner_override";
  ownerOverrideReason: string | null;
  ordinaryEquityOwnerConfirmed: true;
}

export function validResearchValuationIssuerBasisBinding(value: unknown): value is ResearchValuationIssuerBasisBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const keys = ["kind", "schemaVersion", "assetValueId", "liabilityValueId", "shareValueIds",
    "sharesContextId", "sourceFingerprint", "proposedBaseMetricPerShare", "adoptionMode",
    "ownerOverrideReason", "ordinaryEquityOwnerConfirmed"];
  const id = (candidate: unknown) => typeof candidate === "string" && /^[1-9]\d*$/.test(candidate);
  return Object.keys(item).sort().join() === keys.sort().join()
    && item.kind === "issuer_nav_source_draft"
    && item.schemaVersion === RESEARCH_VALUATION_ISSUER_BASIS_VERSION
    && id(item.assetValueId) && id(item.liabilityValueId)
    && Array.isArray(item.shareValueIds) && item.shareValueIds.length >= 1
    && item.shareValueIds.length <= 2 && item.shareValueIds.every(id)
    && new Set(item.shareValueIds).size === item.shareValueIds.length
    && id(item.sharesContextId)
    && typeof item.sourceFingerprint === "string" && /^[a-f0-9]{64}$/.test(item.sourceFingerprint)
    && typeof item.proposedBaseMetricPerShare === "number"
    && Number.isFinite(item.proposedBaseMetricPerShare) && item.proposedBaseMetricPerShare > 0
    && ["source_value", "owner_override"].includes(String(item.adoptionMode))
    && (item.adoptionMode === "source_value" ? item.ownerOverrideReason === null
      : typeof item.ownerOverrideReason === "string" && item.ownerOverrideReason.trim().length >= 8
        && item.ownerOverrideReason.length <= 500)
    && item.ordinaryEquityOwnerConfirmed === true;
}
