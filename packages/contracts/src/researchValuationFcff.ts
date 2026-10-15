import { isRfc3339DateTime } from "./factMetadata.js";
import { canonicalJson } from "./decisionContextBrowser.js";
import { sha256Hex } from "./sha256.js";

/** Cash flows are Owner forecasts in the stated currency, never transcribed historical facts. */
export interface FcffForecastYear {
  periodStart: string;
  periodEnd: string;
  paymentDate: string;
  ebit: number;
  operatingTaxRate: number;
  depreciationAmortization: number;
  grossCapitalReinvestment: number;
  increaseInNoncashWorkingCapital: number;
}

/** The amounts are Owner judgments as of valuationCutoff, reconciled to dated issuer components. */
export interface FcffEquityBridge {
  excessCash: number;
  nonOperatingAssets: number;
  interestBearingDebt: number;
  leaseLiabilitiesNotInDebt: number;
  noncontrollingInterests: number;
  otherNonordinaryClaims: number;
  dilutedOrdinaryShares: number;
}

export interface FcffScenarioInput {
  currency: string;
  historicalAnnualPeriodEnd: string;
  balanceReferenceDate: string;
  valuationCutoff: string;
  forecast: FcffForecastYear[];
  terminalNextYear: FcffForecastYear;
  wacc: number;
  terminalGrowthRate: number;
  waccStep: number;
  terminalGrowthStep: number;
  bridge: FcffEquityBridge;
}

export interface FcffScenarioCalculation {
  methodId: "discounted_fcff_to_common_equity_owner_scenario";
  calculationVersion: "2026-10-12.discounted-fcff-to-common-equity.v2";
  currency: string;
  historicalAnnualPeriodEnd: string;
  balanceReferenceDate: string;
  valuationCutoff: string;
  dayCountConvention: "ACT/365F";
  annual: Array<{ periodStart: string; periodEnd: string; paymentDate: string;
    yearsToPayment: number; fcff: number; presentValue: number }>;
  terminalNextYearFcff: number;
  terminalAnchorDate: string;
  terminalYearsToAnchor: number;
  terminalEnterpriseValue: number;
  operatingEnterpriseValue: number;
  commonEquityValue: number;
  commonEquityValuePerShare: number;
  sensitivity: {
    waccRates: number[];
    terminalGrowthRates: number[];
    cells: Array<{ wacc: number; terminalGrowthRate: number; commonEquityValuePerShare: number }>;
  };
}

export const FCFF_CALCULATION_VERSION = "2026-10-12.discounted-fcff-to-common-equity.v2" as const;
export const FCFF_METHOD_ID = "discounted_fcff_to_common_equity_owner_scenario" as const;
export const FCFF_HISTORICAL_METRICS = {
  profitBeforeTax: "profit_before_tax",
  netFinanceIncome: "net_finance_income",
  associatesProfit: "associates_profit",
  jointVenturesProfit: "joint_ventures_profit",
  deemedDisposalGain: "deemed_disposal_gain",
  depreciationAmortization: "depreciation_amortization",
  propertyPlantEquipmentPurchases: "property_plant_equipment_purchases",
  intangibleAssetPurchases: "intangible_asset_purchases",
  landLeasePrepayments: "land_lease_prepayments"
} as const;
export const FCFF_BRIDGE_METRICS = {
  cashAndEquivalents: "cash_and_cash_equivalents",
  bankBorrowings: "bank_borrowings",
  bondsCurrent: "bonds_current",
  bondsNoncurrent: "bonds_noncurrent",
  leaseCurrent: "lease_liabilities_current",
  leaseNoncurrent: "lease_liabilities_noncurrent",
  nciBookValue: "noncontrolling_interests",
  issuedShares: "issued_shares",
  treasuryShares: "treasury_shares"
} as const;
export const FCFF_NONOPERATING_METRICS = [
  "restricted_deposits", "structured_deposits", "fvoci_financial_assets",
  "associate_investments", "joint_venture_investments", "joint_venture_loans"
] as const;
export const FCFF_OTHER_CLAIM_METRICS = [
  "derivative_liabilities", "nci_dividend_payable", "parent_dividend_payable"
] as const;
export const FCFF_WORKING_CAPITAL_METRICS = {
  asset: ["trade_receivables", "inventories", "prepayments_and_other_operating_receivables"],
  liability: ["trade_payables", "contract_liabilities", "accrued_operating_liabilities"]
} as const;
export type FcffHistoricalRole = keyof typeof FCFF_HISTORICAL_METRICS;
export type FcffBridgeRole = keyof typeof FCFF_BRIDGE_METRICS;
export type FcffWorkingCapitalRole = "currentAsset" | "currentLiability" | "priorAsset" | "priorLiability";
export type FcffSourceFactRole = FcffHistoricalRole | FcffBridgeRole
  | "nonOperatingAsset" | "otherClaim" | FcffWorkingCapitalRole;
export type FcffSourceSelection = {
  historicalAnnualPeriodEnd: string;
  balanceReferenceDate: string;
  historicalValueIds: Record<FcffHistoricalRole, string | null>;
  workingCapitalValueIds: Record<FcffWorkingCapitalRole, string[]>;
  bridgeValueIds: Record<FcffBridgeRole, string | null>;
  nonOperatingAssetValueIds: string[];
  otherClaimValueIds: string[];
};
export type FcffSourceFact = {
  role: FcffSourceFactRole; id: string; metric: string; value: number;
  periodStart: string | null; periodEnd: string; currency: string; unitScale: number;
  scope: "consolidated" | "parent_company" | "segment" | "unknown";
  materialId: string; materialRevision: number; originalSha256: string; citationSha256: string;
  /** Original source publication timestamp; null means unknown and blocks valuation use. */
  publishedAt: string | null;
};
export type FcffBridgeReference = {
  cashAndEquivalents: number;
  nonOperatingAssets: number;
  interestBearingDebtExcludingLeases: number;
  leaseLiabilities: number;
  nciBookValue: number;
  otherClaims: number;
  issuedShares: number;
  treasuryShares: number;
  ordinaryShares: number;
};
export type FcffSourcePreview = {
  status: "available" | "missing_inputs";
  membershipId: string; membershipVersion: number; symbol: string; currency: string | null;
  historicalAnnualPeriodEnd: string; balanceReferenceDate: string;
  sourceFingerprint: string | null;
  facts: FcffSourceFact[];
  historicalMissingRoles: FcffHistoricalRole[];
  missingBridgeRoles: Array<FcffBridgeRole | "nonOperatingAsset" | "otherClaim">;
  historicalOperatingProfitBasis: { value: number;
    formula: "profit before tax - net finance income - associates profit - joint ventures profit - deemed disposal gain";
    limitation: "reported line combination, not normalized recurring EBIT" } | null;
  historicalCashCapitalExpenditureBasis: { value: number;
    formula: "property plant and equipment purchases + intangible asset purchases + land lease prepayments";
    limitation: "cash outflow components, not complete capital reinvestment" } | null;
  workingCapital: { priorNet: number; currentNet: number; increase: number;
    formula: "(current operating noncash assets - current operating nondebt liabilities) - (prior operating noncash assets - prior operating nondebt liabilities)" } | null;
  workingCapitalMissing: FcffWorkingCapitalRole[];
  bridgeReference: FcffBridgeReference | null;
};
export interface FcffBridgeClassification {
  cashSinceReferenceAdjustment: number;
  minimumOperatingCash: number;
  nonOperatingAssetAdjustment: number;
  debtSinceReferenceAdjustment: number;
  leaseSinceReferenceAdjustment: number;
  nciFairValueAdjustment: number;
  otherClaimsAdjustment: number;
  ordinarySharesSinceReferenceAdjustment: number;
  potentialDilutionShares: number;
  cashReason: string;
  nonOperatingAssetsReason: string;
  debtReason: string;
  leaseTreatmentReason: string;
  noncontrollingInterestReason: string;
  otherClaimsReason: string;
  dilutedSharesReason: string;
  balanceDateGapReason: string;
  historicalBasisReason: string;
}
export interface CreateResearchFcffScenarioRequest {
  membershipVersion: number;
  symbol: string;
  replacesScenarioSetId: string | null;
  sourceSelection: FcffSourceSelection;
  sourceFingerprint: string;
  assumptions: FcffScenarioInput;
  bridgeClassification: FcffBridgeClassification;
  ownerConfirmed: true;
  idempotencyKey: string;
}
export interface ResearchFcffScenarioSetData {
  id: string; membershipId: string; membershipVersionAtWrite: number; symbol: string;
  revision: number; replacesScenarioSetId: string | null; scenarioState: "current" | "replaced";
  recomputable: boolean;
  invalidatedBy: Array<"scenario_replaced" | "membership_version_changed" | "membership_archived"
    | "fcff_source_unavailable" | "fcff_source_changed" | "fcff_calculation_invalid">;
  sourceSelection: FcffSourceSelection;
  sourceFingerprint: string;
  historicalOriginals: FcffSourcePreview;
  assumptions: { authority: "owner"; values: FcffScenarioInput;
    bridgeClassification: FcffBridgeClassification };
  calculation: FcffScenarioCalculation;
  safety: { advisoryOnly: true; forecast: true; recommendation: false; automaticSignal: false;
    createsOrder: false; callsBroker: false; mutatesOfficialPortfolio: false };
  createdAt: string;
}

/** Saved OpenD rows are third-party references. Every bridge amount is an explicit Owner assumption. */
export interface FcffProviderSelection {
  financialCaptureId: string;
  sourceMaterialId: string;
  annualPeriodEnd: string;
  shareReferenceDate: string | null;
}
export interface FcffProviderRow {
  role: "cash" | "pledgedDeposits" | "bankBorrowingsCurrent" | "bankBorrowingsNoncurrent"
    | "leasesCurrent" | "leasesNoncurrent" | "convertibleNotesAndBonds" | "nciBookValue";
  fieldId: number;
  displayName: string;
  rawValue: string;
  currency: string;
  unitScale: 1;
  periodEnd: string;
  pageId: string;
  rawSha256: string;
  reportSha256: string;
}
export interface FcffProviderReference {
  kind: "provider_fcff";
  sourceClassification: "third_party_statement";
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  materialId: string;
  materialRevision: number;
  materialFingerprint: string;
  financialCaptureId: string;
  balanceReferenceDate: string;
  shareReferenceDate: string | null;
  capturedAt: string;
  currency: string;
  rows: FcffProviderRow[];
  missingRoles: FcffProviderRow["role"][];
  shareReference: { issuedShares: number; treasuryShares: number;
    issuedValueId: string; treasuryValueId: string; issuedMaterialId: string;
    treasuryMaterialId: string; issuedPublishedAt: string | null;
    treasuryPublishedAt: string | null } | null;
  issuerOriginalVerification: "UNKNOWN";
  publicationTime: "UNKNOWN";
  amountUnit: "currency_base_unit";
  sourceFingerprint: string;
}
export type FcffProviderBridgeReasons = Record<
  "cash" | "nonOperatingAssets" | "debt" | "leases" | "nci" | "otherClaims" | "shares" | "dateGap" | "historicalBasis", string>;
export interface CreateResearchProviderFcffScenarioRequest {
  basisKind: "provider_fcff";
  membershipVersion: number;
  symbol: string;
  replacesScenarioSetId: string | null;
  selection: FcffProviderSelection;
  sourceFingerprint: string;
  assumptions: FcffScenarioInput;
  bridgeReasons: FcffProviderBridgeReasons;
  ownerConfirmed: true;
  idempotencyKey: string;
}
export interface ResearchProviderFcffScenarioSetData {
  id: string; membershipId: string; membershipVersionAtWrite: number; symbol: string;
  revision: number; replacesScenarioSetId: string | null; scenarioState: "current" | "replaced";
  recomputable: boolean;
  invalidatedBy: Array<"scenario_replaced" | "membership_version_changed" | "membership_archived"
    | "fcff_source_unavailable" | "fcff_source_changed" | "fcff_calculation_invalid">;
  providerReference: FcffProviderReference;
  assumptions: { authority: "owner"; values: FcffScenarioInput; bridgeReasons: FcffProviderBridgeReasons };
  calculation: FcffScenarioCalculation;
  safety: ResearchFcffScenarioSetData["safety"];
  createdAt: string;
}

export function fcffProviderSelectionErrors(value: unknown): string[] {
  if (!record(value) || !exactKeys(value, ["financialCaptureId", "sourceMaterialId",
    "annualPeriodEnd", "shareReferenceDate"])) return ["FCFF_PROVIDER_SELECTION_INVALID"];
  const annual = isoDay(value.annualPeriodEnd);
  return positiveId(value.financialCaptureId) && positiveId(value.sourceMaterialId)
    && annual !== null && String(value.annualPeriodEnd).endsWith("-12-31")
    && (value.shareReferenceDate === null || isoDay(value.shareReferenceDate) !== null)
    ? [] : ["FCFF_PROVIDER_SELECTION_INVALID"];
}
export function fcffProviderCreateRequestErrors(value: unknown): string[] {
  if (!record(value)) return ["FCFF_PROVIDER_REQUEST_INVALID"];
  const errors = [...fcffProviderSelectionErrors(value.selection), ...fcffScenarioInputErrors(value.assumptions)];
  if (!exactKeys(value, ["basisKind", "membershipVersion", "symbol", "replacesScenarioSetId",
    "selection", "sourceFingerprint", "assumptions", "bridgeReasons", "ownerConfirmed", "idempotencyKey"])
    || value.basisKind !== "provider_fcff" || !Number.isSafeInteger(value.membershipVersion)
    || Number(value.membershipVersion) < 1 || typeof value.symbol !== "string"
    || !/^HK[.]\d{5}$/.test(value.symbol) || value.replacesScenarioSetId !== null
    && !positiveId(value.replacesScenarioSetId) || value.ownerConfirmed !== true
    || typeof value.idempotencyKey !== "string" || value.idempotencyKey.length < 3
    || value.idempotencyKey.length > 200 || typeof value.sourceFingerprint !== "string"
    || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint)) errors.push("FCFF_PROVIDER_REQUEST_INVALID");
  const reasons = ["cash", "nonOperatingAssets", "debt", "leases", "nci", "otherClaims",
    "shares", "dateGap", "historicalBasis"];
  if (!record(value.bridgeReasons) || !exactKeys(value.bridgeReasons, reasons)
    || reasons.some((key) => typeof (value.bridgeReasons as Record<string, unknown>)[key] !== "string"
      || String((value.bridgeReasons as Record<string, unknown>)[key]).trim().length < 8
      || String((value.bridgeReasons as Record<string, unknown>)[key]).length > 500))
    errors.push("FCFF_PROVIDER_BRIDGE_REASONS_REQUIRED");
  if (record(value.selection) && record(value.assumptions)) {
    if (value.assumptions.balanceReferenceDate !== value.selection.annualPeriodEnd
      || value.assumptions.historicalAnnualPeriodEnd !== value.selection.annualPeriodEnd
      || typeof value.selection.shareReferenceDate === "string"
        && (typeof value.assumptions.valuationCutoff !== "string"
          || value.assumptions.valuationCutoff < value.selection.shareReferenceDate))
      errors.push("FCFF_PROVIDER_DATES_INVALID");
  }
  return errors;
}

// eslint-disable-next-line complexity -- validates one immutable original/source identity boundary.
export function fcffProviderReferenceErrors(value: unknown): string[] {
  if (!record(value) || !exactKeys(value, ["kind", "sourceClassification", "membershipId",
    "membershipVersion", "symbol", "materialId", "materialRevision", "materialFingerprint",
    "financialCaptureId", "balanceReferenceDate", "shareReferenceDate", "capturedAt",
    "currency", "rows", "missingRoles", "shareReference", "issuerOriginalVerification",
    "publicationTime", "amountUnit", "sourceFingerprint"])) return ["FCFF_PROVIDER_REFERENCE_INVALID"];
  const roles = ["cash", "pledgedDeposits", "bankBorrowingsCurrent", "leasesCurrent",
    "bankBorrowingsNoncurrent", "leasesNoncurrent", "convertibleNotesAndBonds", "nciBookValue"];
  const fieldIds = [5003, 5022, 5070, 5072, 5091, 5093, 5104, 5125];
  const rows = Array.isArray(value.rows) ? value.rows : [];
  const rowRoles = rows.map((row) => record(row) ? row.role : null);
  const share = value.shareReference;
  const binding = { ...value }; delete binding.sourceFingerprint;
  return value.kind === "provider_fcff" && value.sourceClassification === "third_party_statement"
    && positiveId(value.membershipId) && Number.isSafeInteger(value.membershipVersion)
    && Number(value.membershipVersion) > 0 && typeof value.symbol === "string"
    && /^HK[.]\d{5}$/.test(value.symbol) && positiveId(value.materialId)
    && Number.isSafeInteger(value.materialRevision) && Number(value.materialRevision) > 0
    && typeof value.materialFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.materialFingerprint)
    && positiveId(value.financialCaptureId) && isoDay(value.balanceReferenceDate) !== null
    && (value.shareReferenceDate === null || isoDay(value.shareReferenceDate) !== null)
    && typeof value.capturedAt === "string" && isRfc3339DateTime(value.capturedAt)
    && typeof value.currency === "string"
    && ["CNY", "HKD", "USD"].includes(value.currency)
    && value.issuerOriginalVerification === "UNKNOWN" && value.publicationTime === "UNKNOWN"
    && value.amountUnit === "currency_base_unit" && rows.length <= roles.length
    && new Set(rowRoles).size === rows.length
    && rows.every((row) => record(row) && roles.includes(String(row.role))
      && row.fieldId === fieldIds[roles.indexOf(String(row.role))]
      && typeof row.displayName === "string" && row.displayName.length > 0
      && typeof row.rawValue === "string" && /^(0|[1-9]\d*)$/.test(row.rawValue)
      && Number.isSafeInteger(Number(row.rawValue)) && row.currency === value.currency
      && row.unitScale === 1 && row.periodEnd === value.balanceReferenceDate
      && positiveId(row.pageId) && typeof row.rawSha256 === "string"
      && /^[a-f0-9]{64}$/.test(row.rawSha256) && typeof row.reportSha256 === "string"
      && /^[a-f0-9]{64}$/.test(row.reportSha256))
    && Array.isArray(value.missingRoles)
    && canonicalJson(value.missingRoles) === canonicalJson(roles.filter((role) => !rowRoles.includes(role)))
    && (share === null || record(share) && value.shareReferenceDate !== null
      && exactKeys(share, ["issuedShares", "treasuryShares", "issuedValueId", "treasuryValueId",
        "issuedMaterialId", "treasuryMaterialId", "issuedPublishedAt", "treasuryPublishedAt"])
      && Number.isSafeInteger(share.issuedShares) && Number.isSafeInteger(share.treasuryShares)
      && Number(share.issuedShares) > Number(share.treasuryShares)
      && Number(share.treasuryShares) >= 0
      && [share.issuedValueId, share.treasuryValueId, share.issuedMaterialId,
        share.treasuryMaterialId].every(positiveId)
      && [share.issuedPublishedAt, share.treasuryPublishedAt].every((instant) =>
        instant === null || typeof instant === "string" && isRfc3339DateTime(instant)))
    && typeof value.sourceFingerprint === "string"
    && value.sourceFingerprint === sha256Hex(canonicalJson(binding))
    ? [] : ["FCFF_PROVIDER_REFERENCE_INVALID"];
}

const positiveId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]*$/.test(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).sort().join() === [...keys].sort().join();

export function fcffSourceSelectionErrors(value: unknown): string[] {
  if (!record(value)) return ["FCFF_SOURCE_SELECTION_REQUIRED"];
  const errors: string[] = [];
  if (!exactKeys(value, ["historicalAnnualPeriodEnd", "balanceReferenceDate",
    "historicalValueIds", "workingCapitalValueIds", "bridgeValueIds",
    "nonOperatingAssetValueIds", "otherClaimValueIds"]))
    errors.push("FCFF_SOURCE_SELECTION_SHAPE_INVALID");
  const historicalEnd = isoDay(value.historicalAnnualPeriodEnd);
  const balanceDate = isoDay(value.balanceReferenceDate);
  if (historicalEnd === null || !String(value.historicalAnnualPeriodEnd).endsWith("-12-31"))
    errors.push("FCFF_HISTORICAL_PERIOD_INVALID");
  if (balanceDate === null || historicalEnd !== null && balanceDate < historicalEnd)
    errors.push("FCFF_BALANCE_REFERENCE_DATE_INVALID");
  const historical = record(value.historicalValueIds) ? value.historicalValueIds : {};
  const bridge = record(value.bridgeValueIds) ? value.bridgeValueIds : {};
  const wc = record(value.workingCapitalValueIds) ? value.workingCapitalValueIds : {};
  const historicalRoles = Object.keys(FCFF_HISTORICAL_METRICS);
  const bridgeRoles = Object.keys(FCFF_BRIDGE_METRICS);
  const wcRoles: FcffWorkingCapitalRole[] = ["currentAsset", "currentLiability", "priorAsset", "priorLiability"];
  if (!exactKeys(historical, historicalRoles)
    || historicalRoles.some((role) => historical[role] !== null && !positiveId(historical[role])))
    errors.push("FCFF_HISTORICAL_SOURCE_IDS_INVALID");
  if (!exactKeys(bridge, bridgeRoles)
    || bridgeRoles.some((role) => bridge[role] !== null && !positiveId(bridge[role])))
    errors.push("FCFF_BRIDGE_SOURCE_IDS_INVALID");
  if (!exactKeys(wc, wcRoles)
    || wcRoles.some((role) => !Array.isArray(wc[role])
      || wc[role].length > 10 || wc[role].some((id: unknown) => !positiveId(id))))
    errors.push("FCFF_WORKING_CAPITAL_SOURCE_IDS_INVALID");
  for (const role of ["nonOperatingAssetValueIds", "otherClaimValueIds"]) {
    const ids = value[role];
    if (!Array.isArray(ids) || ids.length > 12 || ids.some((id) => !positiveId(id)))
      errors.push("FCFF_" + role + "_INVALID");
  }
  if (errors.length === 0) {
    const ids = [...Object.values(historical), ...Object.values(bridge),
      ...wcRoles.flatMap((role) => wc[role] as string[]),
      ...(value.nonOperatingAssetValueIds as string[]), ...(value.otherClaimValueIds as string[])]
      .filter((id): id is string => typeof id === "string");
    if (new Set(ids).size !== ids.length) errors.push("FCFF_SOURCE_IDS_DUPLICATE");
  }
  return errors;
}

export function fcffCreateRequestErrors(value: unknown): string[] {
  if (!record(value)) return ["FCFF_REQUEST_REQUIRED"];
  const errors = [...fcffSourceSelectionErrors(value.sourceSelection),
    ...fcffScenarioInputErrors(value.assumptions)];
  if (!exactKeys(value, ["membershipVersion", "symbol", "replacesScenarioSetId",
    "sourceSelection", "sourceFingerprint", "assumptions", "bridgeClassification",
    "ownerConfirmed", "idempotencyKey"])) errors.push("FCFF_REQUEST_SHAPE_INVALID");
  if (!Number.isSafeInteger(value.membershipVersion) || Number(value.membershipVersion) <= 0)
    errors.push("FCFF_MEMBERSHIP_VERSION_INVALID");
  if (typeof value.symbol !== "string" || !/^HK[.][0-9]{5}$/.test(value.symbol))
    errors.push("FCFF_SYMBOL_INVALID");
  if (value.replacesScenarioSetId !== null && !positiveId(value.replacesScenarioSetId))
    errors.push("FCFF_REPLACEMENT_INVALID");
  if (typeof value.sourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint))
    errors.push("FCFF_SOURCE_FINGERPRINT_INVALID");
  if (record(value.sourceSelection) && record(value.assumptions)
    && (value.sourceSelection.historicalAnnualPeriodEnd !== value.assumptions.historicalAnnualPeriodEnd
      || value.sourceSelection.balanceReferenceDate !== value.assumptions.balanceReferenceDate))
    errors.push("FCFF_SOURCE_DATES_MISMATCH");
  const classification = value.bridgeClassification;
  if (!record(classification)) errors.push("FCFF_BRIDGE_CLASSIFICATION_REQUIRED");
  else {
    const numeric = ["cashSinceReferenceAdjustment", "minimumOperatingCash",
      "nonOperatingAssetAdjustment", "debtSinceReferenceAdjustment", "leaseSinceReferenceAdjustment",
      "nciFairValueAdjustment", "otherClaimsAdjustment", "ordinarySharesSinceReferenceAdjustment",
      "potentialDilutionShares"];
    const reasons = ["cashReason", "nonOperatingAssetsReason", "debtReason",
      "leaseTreatmentReason", "noncontrollingInterestReason", "otherClaimsReason",
      "dilutedSharesReason", "balanceDateGapReason", "historicalBasisReason"];
    if (!exactKeys(classification, [...numeric, ...reasons]))
      errors.push("FCFF_BRIDGE_CLASSIFICATION_SHAPE_INVALID");
    for (const field of numeric) {
      const amount = classification[field];
      if (!finite(amount)
        || ["minimumOperatingCash", "potentialDilutionShares"].includes(field) && amount < 0
        || ["ordinarySharesSinceReferenceAdjustment", "potentialDilutionShares"].includes(field)
          && !Number.isSafeInteger(amount))
        errors.push("FCFF_BRIDGE_" + field + "_INVALID");
    }
    for (const field of reasons) {
      const reason = classification[field];
      if (typeof reason !== "string" || reason.trim().length < 8 || reason.length > 500)
        errors.push("FCFF_BRIDGE_" + field + "_REASON_REQUIRED");
    }
  }
  if (value.ownerConfirmed !== true) errors.push("FCFF_OWNER_CONFIRMATION_REQUIRED");
  if (typeof value.idempotencyKey !== "string" || value.idempotencyKey.trim().length < 3
    || value.idempotencyKey.length > 200) errors.push("FCFF_IDEMPOTENCY_KEY_INVALID");
  return errors;
}
const forecastFields = ["ebit", "operatingTaxRate", "depreciationAmortization",
  "grossCapitalReinvestment", "increaseInNoncashWorkingCapital"] as const;
const bridgeFields = ["excessCash", "nonOperatingAssets", "interestBearingDebt",
  "leaseLiabilitiesNotInDebt", "noncontrollingInterests", "otherNonordinaryClaims",
  "dilutedOrdinaryShares"] as const;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const roundSix = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

function isoDay(value: unknown): number | null {
  if (typeof value !== "string" || !/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(value)) return null;
  const epoch = Date.parse(value + "T00:00:00.000Z");
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === value ? epoch : null;
}

/** Compare availability by Hong Kong calendar day; valuationCutoff represents that whole day. */
export function fcffPublishedHongKongDay(publishedAt: unknown): string | null {
  if (typeof publishedAt !== "string" || !isRfc3339DateTime(publishedAt)) return null;
  const instant = Date.parse(publishedAt);
  if (!Number.isFinite(instant)) return null;
  const day = new Date(instant + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  return isoDay(day) === null ? null : day;
}

function nextDay(value: string): string {
  return new Date(isoDay(value)! + 86_400_000).toISOString().slice(0, 10);
}

function yearsToPayment(cutoff: string, paymentDate: string): number {
  return (isoDay(paymentDate)! - isoDay(cutoff)!) / 86_400_000 / 365;
}

export function fcffScenarioInputErrors(value: unknown): string[] {
  if (!record(value)) return ["FCFF_INPUT_REQUIRED"];
  const errors: string[] = [];
  if (Object.keys(value).sort().join() !== ["currency", "historicalAnnualPeriodEnd",
    "balanceReferenceDate", "valuationCutoff", "forecast", "terminalNextYear", "wacc",
    "terminalGrowthRate", "waccStep", "terminalGrowthStep", "bridge"].sort().join())
    errors.push("FCFF_INPUT_SHAPE_INVALID");
  if (typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency))
    errors.push("FCFF_CURRENCY_INVALID");
  const historicalDay = isoDay(value.historicalAnnualPeriodEnd);
  const balanceDay = isoDay(value.balanceReferenceDate);
  const cutoffDay = isoDay(value.valuationCutoff);
  if (historicalDay === null || !String(value.historicalAnnualPeriodEnd).endsWith("-12-31"))
    errors.push("FCFF_HISTORICAL_PERIOD_INVALID");
  if (balanceDay === null || historicalDay !== null && balanceDay < historicalDay)
    errors.push("FCFF_BALANCE_REFERENCE_DATE_INVALID");
  if (cutoffDay === null || balanceDay !== null && cutoffDay < balanceDay)
    errors.push("FCFF_VALUATION_CUTOFF_INVALID");
  if (!Array.isArray(value.forecast) || value.forecast.length < 1 || value.forecast.length > 10)
    errors.push("FCFF_FORECAST_PERIODS_INVALID");
  else if (cutoffDay !== null) {
    let expectedStart = nextDay(value.valuationCutoff as string);
    const firstIsStub = !expectedStart.endsWith("-01-01");
    if (firstIsStub && value.forecast.length < 2)
      errors.push("FCFF_STUB_REQUIRES_FOLLOWING_FULL_YEAR");
    value.forecast.forEach((period, index) => {
      validateForecastPeriod(period, expectedStart, "forecast." + index, errors);
      if (record(period) && typeof period.periodEnd === "string" && isoDay(period.periodEnd) !== null)
        expectedStart = nextDay(period.periodEnd);
    });
    validateForecastPeriod(value.terminalNextYear, expectedStart, "terminalNextYear", errors);
    if (record(value.terminalNextYear) && value.terminalNextYear.periodStart !== expectedStart)
      errors.push("FCFF_TERMINAL_NEXT_YEAR_INVALID");
  }
  if (!finite(value.wacc) || value.wacc <= 0 || value.wacc > 1) errors.push("FCFF_WACC_INVALID");
  if (!finite(value.terminalGrowthRate) || value.terminalGrowthRate < -0.5
    || value.terminalGrowthRate > 0.5) errors.push("FCFF_TERMINAL_GROWTH_INVALID");
  if (!finite(value.waccStep) || value.waccStep <= 0 || value.waccStep > 0.1)
    errors.push("FCFF_WACC_STEP_INVALID");
  if (!finite(value.terminalGrowthStep) || value.terminalGrowthStep <= 0
    || value.terminalGrowthStep > 0.1) errors.push("FCFF_TERMINAL_GROWTH_STEP_INVALID");
  if (finite(value.wacc) && finite(value.terminalGrowthRate) && finite(value.waccStep)
    && finite(value.terminalGrowthStep)
    && value.wacc - value.waccStep <= value.terminalGrowthRate + value.terminalGrowthStep)
    errors.push("FCFF_SENSITIVITY_WACC_MUST_EXCEED_GROWTH");
  if (!record(value.bridge)) errors.push("FCFF_BRIDGE_REQUIRED");
  else {
    if (Object.keys(value.bridge).sort().join() !== [...bridgeFields].sort().join())
      errors.push("FCFF_BRIDGE_SHAPE_INVALID");
    for (const field of bridgeFields) {
      const amount = value.bridge[field];
      if (!finite(amount) || amount < 0
        || field === "dilutedOrdinaryShares" && (!Number.isSafeInteger(amount) || amount === 0))
        errors.push("FCFF_BRIDGE_" + field + "_INVALID");
    }
  }
  return errors;
}

function validateForecastPeriod(value: unknown, expectedStart: string,
  path: string, errors: string[]): void {
  if (!record(value)) { errors.push("FCFF_" + path + "_REQUIRED"); return; }
  if (Object.keys(value).sort().join() !== ["periodStart", "periodEnd", "paymentDate",
    ...forecastFields].sort().join()) errors.push("FCFF_" + path + "_SHAPE_INVALID");
  const start = isoDay(value.periodStart);
  const end = isoDay(value.periodEnd);
  const payment = isoDay(value.paymentDate);
  if (start === null || end === null || payment === null
    || value.periodStart !== expectedStart || start > end
    || !String(value.periodEnd).endsWith("-12-31")
    || String(value.periodEnd).slice(0, 4) !== String(value.periodStart).slice(0, 4)
    || value.paymentDate !== value.periodEnd)
    errors.push("FCFF_" + path + "_DATES_INVALID");
  for (const field of forecastFields) {
    const amount = value[field];
    if (!finite(amount) || field === "operatingTaxRate" && (amount < 0 || amount > 1)
      || ["depreciationAmortization", "grossCapitalReinvestment"].includes(field) && amount < 0)
      errors.push("FCFF_" + path + "_" + field + "_INVALID");
  }
}

export function calculateFcffScenario(input: FcffScenarioInput): FcffScenarioCalculation | null {
  if (fcffScenarioInputErrors(input).length) return null;
  const cashFlow = (period: FcffForecastYear) => period.ebit * (1 - period.operatingTaxRate)
    + period.depreciationAmortization - period.grossCapitalReinvestment
    - period.increaseInNoncashWorkingCapital;
  const fcffs = input.forecast.map(cashFlow);
  const terminalFcff = cashFlow(input.terminalNextYear);
  const exponents = input.forecast.map((period) => yearsToPayment(input.valuationCutoff, period.paymentDate));
  const terminalYearsToAnchor = exponents[exponents.length - 1]!;
  const bridge = input.bridge;
  const bridgeAdjustment = bridge.excessCash + bridge.nonOperatingAssets - bridge.interestBearingDebt
    - bridge.leaseLiabilitiesNotInDebt - bridge.noncontrollingInterests - bridge.otherNonordinaryClaims;
  const scenario = (wacc: number, growth: number) => {
    const forecastPresentValue = fcffs.reduce((total, cash, index) =>
      total + cash / (1 + wacc) ** exponents[index]!, 0);
    const terminalEnterpriseValue = terminalFcff / (wacc - growth);
    const operatingEnterpriseValue = forecastPresentValue
      + terminalEnterpriseValue / (1 + wacc) ** terminalYearsToAnchor;
    const commonEquityValue = operatingEnterpriseValue + bridgeAdjustment;
    return { terminalEnterpriseValue, operatingEnterpriseValue, commonEquityValue,
      perShare: commonEquityValue / bridge.dilutedOrdinaryShares };
  };
  const base = scenario(input.wacc, input.terminalGrowthRate);
  const waccRates = [input.wacc - input.waccStep, input.wacc, input.wacc + input.waccStep];
  const terminalGrowthRates = [input.terminalGrowthRate - input.terminalGrowthStep,
    input.terminalGrowthRate, input.terminalGrowthRate + input.terminalGrowthStep];
  const cells = waccRates.flatMap((wacc) => terminalGrowthRates.map((terminalGrowthRate) => ({
    wacc: roundSix(wacc), terminalGrowthRate: roundSix(terminalGrowthRate),
    commonEquityValuePerShare: roundSix(scenario(wacc, terminalGrowthRate).perShare)
  })));
  if (terminalFcff <= 0 || base.commonEquityValue <= 0
    || [base.terminalEnterpriseValue, base.operatingEnterpriseValue, base.commonEquityValue,
      base.perShare, ...fcffs, ...exponents, ...cells.map((cell) => cell.commonEquityValuePerShare)]
      .some((value) => !Number.isFinite(value))) return null;
  return {
    methodId: FCFF_METHOD_ID, calculationVersion: FCFF_CALCULATION_VERSION,
    currency: input.currency, historicalAnnualPeriodEnd: input.historicalAnnualPeriodEnd,
    balanceReferenceDate: input.balanceReferenceDate, valuationCutoff: input.valuationCutoff,
    dayCountConvention: "ACT/365F",
    annual: fcffs.map((fcff, index) => ({
      periodStart: input.forecast[index]!.periodStart,
      periodEnd: input.forecast[index]!.periodEnd,
      paymentDate: input.forecast[index]!.paymentDate,
      yearsToPayment: roundSix(exponents[index]!),
      fcff: roundSix(fcff),
      presentValue: roundSix(fcff / (1 + input.wacc) ** exponents[index]!)
    })),
    terminalNextYearFcff: roundSix(terminalFcff),
    terminalAnchorDate: input.forecast[input.forecast.length - 1]!.paymentDate,
    terminalYearsToAnchor: roundSix(terminalYearsToAnchor),
    terminalEnterpriseValue: roundSix(base.terminalEnterpriseValue),
    operatingEnterpriseValue: roundSix(base.operatingEnterpriseValue),
    commonEquityValue: roundSix(base.commonEquityValue),
    commonEquityValuePerShare: roundSix(base.perShare),
    sensitivity: { waccRates: waccRates.map(roundSix),
      terminalGrowthRates: terminalGrowthRates.map(roundSix), cells }
  };
}
