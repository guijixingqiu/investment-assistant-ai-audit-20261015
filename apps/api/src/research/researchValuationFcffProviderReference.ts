import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import { FUTU_FINANCIAL_STATEMENT_SOURCE, type FutuFinancialBridgePage,
  type FutuFinancialProviderReport }
  from "../../../../packages/contracts/src/researchFutuFinancialStatement.js";
import { type FcffProviderReference, type FcffProviderRow, type FcffProviderSelection,
  fcffProviderSelectionErrors } from "../../../../packages/contracts/src/researchValuationFcff.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import { readFutuFinancialMaterialPreview, readFutuFinancialOriginal }
  from "./researchFutuFinancialStatementRepository.js";
import { readResearchFundamentals } from "./researchFundamentalRepository.js";
import { issuerFactOriginalAvailable } from "./researchValuationIssuerBasis.js";
import type { SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";

type Reader = Pick<Pool | PoolClient, "query">;
const balanceFields = [
  ["cash", 5003, "现金及等价物"], ["pledgedDeposits", 5022, "已抵押存款"],
  ["bankBorrowingsCurrent", 5070, "银行贷款及透支"],
  ["leasesCurrent", 5072, "短期融资租赁负债"],
  ["bankBorrowingsNoncurrent", 5091, "长期银行贷款"],
  ["leasesNoncurrent", 5093, "长期融资租赁负债"],
  ["convertibleNotesAndBonds", 5104, "可转换票据及债券"],
  ["nciBookValue", 5125, "少数股东权益"]
] as const satisfies ReadonlyArray<readonly [FcffProviderRow["role"], number, string]>;

export function projectFcffProviderBalanceRows(decoded: FutuFinancialBridgePage,
  report: FutuFinancialProviderReport,
  page: { pageId: string; rawSha256: string; reportSha256: string }):
  { rows: FcffProviderRow[]; missingRoles: FcffProviderRow["role"][] } {
  const rows: FcffProviderRow[] = [];
  for (const [role, fieldId, displayName] of balanceFields) {
    const structural = decoded.structure_list.filter((item): item is { field_id: number; display_name: string } =>
      !!item && typeof item === "object" && "field_id" in item && "display_name" in item
        && item.field_id === fieldId);
    const values = report.item_list.filter((item) => item.field_id === fieldId);
    if (structural.length !== 1 || structural[0]!.display_name !== displayName
      || values.length !== 1 || values[0]!.display_name !== displayName
      || typeof values[0]!.data !== "number" || !Number.isSafeInteger(values[0]!.data)
      || values[0]!.data < 0) continue;
    rows.push({ role, fieldId, displayName, rawValue: String(values[0]!.data),
      currency: report.currency_code, unitScale: 1, periodEnd: report.date_time_str,
      pageId: page.pageId, rawSha256: page.rawSha256, reportSha256: page.reportSha256 });
  }
  return { rows, missingRoles: balanceFields.map(([role]) => role).filter((role) =>
    !rows.some((row) => row.role === role)) };
}

/** A bounded OpenD balance-sheet adapter. Its rows never enter issuer fundamentals. */
export async function readFcffProviderReference(reader: Reader, membershipId: string,
  selection: FcffProviderSelection, actor: AuthenticatedResearchActor,
  store: SourceSnapshotStoreOptions, now = new Date()): Promise<FcffProviderReference> {
  if (fcffProviderSelectionErrors(selection).length) throw new Error("FCFF_PROVIDER_SELECTION_INVALID");
  const member = await readCandidateMembershipById(reader, actor, membershipId);
  if (!member || member.state !== "tracked") throw new Error("FCFF_PROVIDER_MEMBERSHIP_UNAVAILABLE");
  const material = await readFutuFinancialMaterialPreview(reader, membershipId,
    selection.financialCaptureId, "ANNUAL", selection.annualPeriodEnd, actor, store, now);
  const bound = material.materials.find((item) => item.id === selection.sourceMaterialId
    && item.sourceVersion === material.sourceVersion
    && item.contentFingerprint === material.contentFingerprint);
  if (!bound || material.source.membershipVersion !== Number(member.version)
    || material.source.symbol !== member.symbol || material.source.amountUnit !== "currency_base_unit"
    || material.source.amountUnitScale !== 1) throw new Error("FCFF_PROVIDER_MATERIAL_CHANGED");
  const page = material.source.pages.find((item) => item.statementType === "balance_sheet");
  if (!page) throw new Error("FCFF_PROVIDER_BALANCE_PAGE_MISSING");
  const original = await readFutuFinancialOriginal(reader, membershipId,
    selection.financialCaptureId, page.pageId, actor, store);
  if (original.page.rawSha256 !== page.rawSha256) throw new Error("FCFF_PROVIDER_ORIGINAL_CHANGED");
  const decoded = JSON.parse(original.bytes.toString("utf8")) as FutuFinancialBridgePage;
  if (decoded.source !== FUTU_FINANCIAL_STATEMENT_SOURCE || decoded.statement_type !== 2)
    throw new Error("FCFF_PROVIDER_BALANCE_PAGE_INVALID");
  const reports = decoded.report_list.filter((item) => item.date_time_str === selection.annualPeriodEnd
    && item.financial_type === "ANNUAL" && item.fiscal_year === Number(selection.annualPeriodEnd.slice(0, 4)));
  const summary = original.page.reports.filter((item) => item.periodEnd === selection.annualPeriodEnd
    && item.financialType === "ANNUAL");
  if (reports.length !== 1 || summary.length !== 1
    || summary[0]!.reportSha256 !== page.reportSha256
    || !["CNY", "HKD", "USD"].includes(reports[0]!.currency_code)
    || !reports[0]!.currency_info.trim() || !reports[0]!.accounting_standards.trim())
    throw new Error("FCFF_PROVIDER_BALANCE_PERIOD_INVALID");
  const report = reports[0]!;
  const { rows, missingRoles } = projectFcffProviderBalanceRows(decoded, report, page);
  let shareReference: FcffProviderReference["shareReference"] = null;
  if (selection.shareReferenceDate) {
    const fundamental = await readResearchFundamentals(reader, membershipId, actor, now, undefined, store);
    const shares = await Promise.all(["issued_shares", "treasury_shares"].map(async (metric) => {
      const candidates = fundamental.values.filter((value) => value.metric === metric
        && value.periodEnd === selection.shareReferenceDate && value.periodKind === "instant"
        && value.periodStart === null && value.valueState === "current" && value.valueStatus === "reported"
        && value.symbol === member.symbol && value.membershipVersionAtWrite === Number(member.version)
        && value.currency === "XXX" && value.scope === "parent_company"
        && value.assertion?.unit === "shares" && value.assertion.measurementBasis === "issued_shares"
        && value.source.sourceClassification === "issuer_statement"
        && value.provenance.factKind === "issuer_reported");
      if (candidates.length !== 1 || !await issuerFactOriginalAvailable(reader, membershipId, candidates[0]!, store))
        return null;
      return candidates[0]!;
    }));
    const issued = shares[0], treasury = shares[1];
    if (issued && treasury) {
      const issuedAmount = Number(issued.value) * issued.unitScale;
      const treasuryAmount = Number(treasury.value) * treasury.unitScale;
      if (Number.isSafeInteger(issuedAmount) && Number.isSafeInteger(treasuryAmount)
        && issuedAmount > treasuryAmount && treasuryAmount >= 0) {
        shareReference = { issuedShares: issuedAmount, treasuryShares: treasuryAmount,
          issuedValueId: issued.id, treasuryValueId: treasury.id,
          issuedMaterialId: issued.source.materialId, treasuryMaterialId: treasury.source.materialId,
          issuedPublishedAt: issued.source.publishedAt ?? null,
          treasuryPublishedAt: treasury.source.publishedAt ?? null };
      }
    }
  }
  const basis = { kind: "provider_fcff" as const, sourceClassification: "third_party_statement" as const,
    membershipId, membershipVersion: Number(member.version), symbol: member.symbol,
    materialId: bound.id, materialRevision: bound.revision, materialFingerprint: bound.contentFingerprint,
    financialCaptureId: selection.financialCaptureId, balanceReferenceDate: selection.annualPeriodEnd,
    shareReferenceDate: selection.shareReferenceDate, capturedAt: original.page.capturedAt,
    currency: report.currency_code, rows, missingRoles, shareReference,
    issuerOriginalVerification: "UNKNOWN" as const, publicationTime: "UNKNOWN" as const,
    amountUnit: "currency_base_unit" as const };
  const sourceFingerprint = createHash("sha256").update(canonicalJson(basis)).digest("hex");
  return { ...basis, sourceFingerprint };
}
