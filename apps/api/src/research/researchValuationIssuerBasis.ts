import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ResearchFundamentalValueData } from "../../../../packages/contracts/src/researchFundamentals.js";
import { researchFundamentalCurrentlyUsable } from "../../../../packages/contracts/src/researchFundamentals.js";
import {
  RESEARCH_VALUATION_ISSUER_BASIS_VERSION,
  type ResearchValuationIssuerBasisPreview,
  type ResearchValuationIssuerBasisBinding
} from "../../../../packages/contracts/src/researchValuationIssuerBasis.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { ResearchDocumentError } from "./domain.js";
import { readResearchDocumentBytes } from "./researchDocumentCas.js";
import { readResearchFundamentals } from "./researchFundamentalRepository.js";
import { readResearchContextSnapshot } from "./researchContextRepository.js";
import type { SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";

type Reader = Pick<Pool | PoolClient, "query">;
type Preview = ResearchValuationIssuerBasisPreview;
type Fundamentals = Awaited<ReturnType<typeof readResearchFundamentals>>;
type Context = Awaited<ReturnType<typeof readResearchContextSnapshot>>;
type OriginalCheck = (value: ResearchFundamentalValueData) => Promise<boolean>;
const formula = "(parent_company_total_assets - parent_company_total_liabilities) / confirmed_ordinary_shares" as const;
const limitation = "母公司口径净资产仅在 Owner 核对无非普通股权益及股数类别后可作每股草稿；不是发行人报告的每股净资产或目标价。";

/** Exact cited page and CAS original are required for a PDF source. */
export async function issuerFactOriginalAvailable(
  client: Reader, membershipId: string, value: ResearchFundamentalValueData,
  store?: SourceSnapshotStoreOptions
): Promise<boolean> {
  const source = value.source;
  if (source.kind === "source_snapshot") return source.originalAvailability === "available";
  if (!source.documentId || !source.documentPdfSha256 || !source.pageNumber || !source.pageTextSha256 || !store) return false;
  const page = await client.query<{ byte_length: number | string }>(
    `select rd.byte_length from research_document_pages rdp
       join research_documents rd on rd.id = rdp.document_id
      where rd.id = $1 and rd.candidate_membership_id = $2 and rd.pdf_sha256 = $3
        and rdp.page_number = $4 and rdp.text_sha256 = $5 limit 1`,
    [source.documentId, membershipId, source.documentPdfSha256, source.pageNumber, source.pageTextSha256]
  );
  if (!page.rows[0]) return false;
  try {
    await readResearchDocumentBytes(store.rawStoreRoot, store.repositoryRoot,
      source.documentPdfSha256, Number(page.rows[0].byte_length));
    return true;
  } catch (error) {
    if (error instanceof ResearchDocumentError) return false;
    throw error;
  }
}

export async function readIssuerNavBasisPreview(
  client: Reader, membershipId: string, anchorValueId: string,
  actor: AuthenticatedResearchActor, now = new Date(), store?: SourceSnapshotStoreOptions
): Promise<Preview> {
  const fundamentals = await readResearchFundamentals(client, membershipId, actor, now, undefined, store);
  const context = await readResearchContextSnapshot(client, membershipId, actor, now);
  return deriveIssuerNavBasisPreview(fundamentals, context, anchorValueId, now,
    (value) => issuerFactOriginalAvailable(client, membershipId, value, store));
}

export function issuerBasisMatchesPreview(
  saved: ResearchValuationIssuerBasisBinding, preview: Preview
): boolean {
  return preview.status === "available" && preview.sourceFingerprint === saved.sourceFingerprint
    && preview.asset?.id === saved.assetValueId && preview.liability?.id === saved.liabilityValueId
    && [saved.assetValueId, saved.liabilityValueId].includes(preview.anchorValueId)
    && preview.shareFacts.map((fact) => fact.id).join() === saved.shareValueIds.join()
    && preview.sharesContextId === saved.sharesContextId
    && preview.proposedBaseMetricPerShare === saved.proposedBaseMetricPerShare;
}

export async function deriveIssuerNavBasisPreview(
  fundamentals: Fundamentals,
  context: Context,
  anchorValueId: string, now: Date,
  sourceAvailable: OriginalCheck
): Promise<Preview> {
  const membershipId = fundamentals.membershipId;
  const balance = await selectBalance(fundamentals, anchorValueId, now, sourceAvailable);
  const share = await selectOrdinaryShares(fundamentals, context, balance.asset?.periodEnd ?? null,
    now, sourceAvailable);
  const { selected, asset, liability } = balance;
  const { shareFacts, shareCount, currentContext, model } = share;
  const missing = [...balance.missing, ...share.missing];
  const ratio = missing.length === 0 && asset && liability && shareCount
    ? navPerShare(asset.value!, liability.value!, asset.unitScale, shareCount) : null;
  if (!ratio) missing.push("positive_exact_nav_per_share_required");
  const available = missing.length === 0 && ratio !== null;
  const identity = available && asset && liability && currentContext
    ? createHash("sha256").update(JSON.stringify({ membershipId, membershipVersion: fundamentals.membershipVersion,
        symbol: fundamentals.symbol, anchorValueId, contextId: currentContext.id,
        shareClass: model?.sharesClass, shareValueId: model?.sharesValueId,
        facts: [asset, liability, ...shareFacts].map(sourceIdentity), proposed: ratio!.perShare })).digest("hex") : null;
  return {
    schemaVersion: RESEARCH_VALUATION_ISSUER_BASIS_VERSION,
    status: available ? "available" : "missing_inputs",
    membershipId, membershipVersion: fundamentals.membershipVersion, symbol: fundamentals.symbol,
    anchorValueId, periodEnd: asset?.periodEnd ?? selected?.periodEnd ?? null,
    currency: asset?.currency ?? selected?.currency ?? null,
    unitScale: asset?.unitScale ?? selected?.unitScale ?? null,
    scope: asset?.scope === "parent_company" ? "parent_company" : null,
    formula, asset: asset ?? null, liability: liability ?? null, shareFacts,
    sharesContextId: currentContext?.id ?? null, sharesCount: available ? String(shareCount) : null,
    netAssets: available ? ratio!.netAssets : null,
    proposedBaseMetricPerShare: available ? ratio!.perShare : null,
    sourceFingerprint: identity, missingInputs: [...new Set(missing)], limitation
  };
}

async function selectBalance(fundamentals: Fundamentals, anchorValueId: string,
  now: Date, sourceAvailable: OriginalCheck) {
  const values = fundamentals.values;
  const selected = values.find((value) => value.id === anchorValueId) ?? null;
  const missing: string[] = [];
  const eligible = (value: ResearchFundamentalValueData | null): value is ResearchFundamentalValueData =>
    !!value && verifiedCurrent(value, fundamentals.membershipVersion, fundamentals.symbol, now)
      && value.assertion?.unit === "currency" && value.assertion.measurementBasis === "financial_statement"
      && value.periodKind === "instant" && value.periodStart === null && value.scope === "parent_company";
  if (!selected || !["total_assets", "total_liabilities"].includes(selected.metric)) missing.push("current_asset_or_liability_anchor_required");
  else if (!eligible(selected)) missing.push("verified_parent_company_balance_sheet_required");
  const asset = selected?.metric === "total_assets" ? selected : companion(values, selected, "total_assets");
  const liability = selected?.metric === "total_liabilities" ? selected : companion(values, selected, "total_liabilities");
  if (!eligible(asset) || !eligible(liability) || !sameBalanceSheet(asset, liability)) {
    missing.push("matching_verified_parent_company_assets_and_liabilities_required");
  }
  if (asset && !await sourceAvailable(asset)) missing.push("asset_original_unavailable");
  if (liability && !await sourceAvailable(liability)) missing.push("liability_original_unavailable");
  return { selected, asset, liability, missing };
}

async function selectOrdinaryShares(fundamentals: Fundamentals, context: Context,
  periodEnd: string | null, now: Date, sourceAvailable: OriginalCheck) {
  const currentContext = context.status === "available" && context.data?.currentness.status === "current"
    && context.data.membershipVersion === fundamentals.membershipVersion
    && context.data.selectedSymbol === fundamentals.symbol ? context.data : null;
  const model = currentContext?.operatingModel;
  const values = fundamentals.values;
  const eligible = (value: ResearchFundamentalValueData) =>
    verifiedCurrent(value, fundamentals.membershipVersion, fundamentals.symbol, now)
      && value.assertion?.unit === "shares" && value.assertion.measurementBasis === "issued_shares"
      && value.periodKind === "instant" && value.periodStart === null
      && value.scope === "parent_company";
  const shares = model?.sharesClass === "ordinary" && model.sharesReferenceConfirmed
    ? values.find((value) => value.id === model.sharesValueId
        && ["shares_outstanding", "issued_shares"].includes(value.metric) && eligible(value)) ?? null : null;
  const treasuryMatches = shares?.metric === "issued_shares" ? values.filter((value) =>
    value.metric === "treasury_shares" && eligible(value)
    && value.periodEnd === shares.periodEnd && value.scope === shares.scope
    && value.unitScale === shares.unitScale
    && value.assertion?.businessScope === shares.assertion?.businessScope) : [];
  const treasury = treasuryMatches.length === 1 ? treasuryMatches[0]! : null;
  const shareFacts = shares?.metric === "shares_outstanding" ? [shares]
    : shares && treasury ? [shares, treasury] : [];
  const shareCount = shares && shareFacts.length > 0
    ? Number(shares.value) * shares.unitScale - (treasury ? Number(treasury.value) * treasury.unitScale : 0) : null;
  const missing: string[] = [];
  if (!currentContext || !shares || !Number.isSafeInteger(shareCount) || (shareCount ?? 0) <= 0
    || shares.periodEnd !== periodEnd) missing.push("confirmed_same_date_ordinary_share_basis_required");
  for (const fact of shareFacts) {
    if (!await sourceAvailable(fact)) {
      missing.push("share_original_unavailable");
      break;
    }
  }
  return { shareFacts, shareCount, currentContext, model, missing };
}

function companion(values: ResearchFundamentalValueData[], selected: ResearchFundamentalValueData | null,
  metric: "total_assets" | "total_liabilities"): ResearchFundamentalValueData | null {
  if (!selected) return null;
  const matches = values.filter((value) => value.metric === metric && sameBalanceSheet(selected, value));
  return matches.length === 1 ? matches[0]! : null;
}

function sameBalanceSheet(a: ResearchFundamentalValueData | null, b: ResearchFundamentalValueData | null): boolean {
  return !!a && !!b && a.id !== b.id && a.membershipId === b.membershipId
    && a.membershipVersionAtWrite === b.membershipVersionAtWrite && a.symbol === b.symbol
    && a.periodKind === "instant" && b.periodKind === "instant"
    && a.periodStart === null && b.periodStart === null && a.periodEnd === b.periodEnd
    && a.currency === b.currency && a.unitScale === b.unitScale && a.scope === b.scope
    && a.assertion?.businessScope === b.assertion?.businessScope;
}

function verifiedCurrent(value: ResearchFundamentalValueData, version: number, symbol: string, now: Date): boolean {
  const verification = value.assertion?.verification;
  return value.membershipVersionAtWrite === version && value.symbol === symbol
    && researchFundamentalCurrentlyUsable(value) && value.valueStatus === "reported" && value.value !== null
    && value.comparability === "comparable" && value.comparabilityReason === null
    && value.source.materialRevisionState === "current" && value.source.freshness === "fresh"
    && value.source.sourceClassification === "issuer_statement"
    && value.source.verificationStatus === "unverified"
    && Date.parse(value.source.validUntil) > now.getTime() && value.periodEnd <= now.toISOString().slice(0, 10)
    && (value.source.publishedAt === undefined || Date.parse(value.source.publishedAt) <= now.getTime())
    && value.assertion?.sourceChecked === true && value.assertion.category === "actual"
    && ["verified", "owner_confirmed", "source_text_verified"].includes(value.provenance.verificationStatus)
    && (verification === undefined || verification.valueVerification !== "unverified"
      && verification.structureVerification !== "unverified"
      && verification.checks.metric && verification.checks.period
      && verification.checks.currency && verification.checks.unitScale && verification.checks.scope);
}

function sourceIdentity(value: ResearchFundamentalValueData) {
  return { id: value.id, revision: value.revision, value: value.value, unitScale: value.unitScale,
    metric: value.metric, periodEnd: value.periodEnd, currency: value.currency, scope: value.scope,
    materialId: value.source.materialId, materialRevision: value.source.materialRevision,
    originalSha256: value.source.kind === "source_snapshot" ? value.source.snapshotOriginal.rawSha256 : value.source.documentPdfSha256,
    citationSha256: value.source.kind === "source_snapshot" ? value.source.snapshotCitation.textSha256 : value.source.pageTextSha256 };
}

function navPerShare(asset: string, liability: string, unitScale: number, shares: number):
  { netAssets: string; perShare: number } | null {
  const decimal = (value: string) => /^\d+(?:\.\d+)?$/.test(value)
    ? { digits: BigInt(value.replace(".", "")), places: (value.split(".")[1] ?? "").length } : null;
  const a = decimal(asset), l = decimal(liability);
  if (!a || !l || !Number.isSafeInteger(shares) || shares <= 0) return null;
  const places = Math.max(a.places, l.places);
  const denominator = 10n ** BigInt(places);
  const difference = (a.digits * 10n ** BigInt(places - a.places)
    - l.digits * 10n ** BigInt(places - l.places)) * BigInt(unitScale);
  if (difference <= 0n) return null;
  const scaled = (difference * 1_000_000n + BigInt(shares) * denominator / 2n)
    / (BigInt(shares) * denominator);
  const perShare = Number(scaled) / 1_000_000;
  if (!Number.isFinite(perShare) || perShare <= 0) return null;
  const whole = difference / denominator;
  const fraction = (difference % denominator).toString().padStart(places, "0").replace(/0+$/, "");
  return { netAssets: fraction ? `${whole}.${fraction}` : String(whole), perShare };
}
