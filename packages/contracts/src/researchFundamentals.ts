import { validAssertionMetadata, type ResearchAssertionMetadata } from "./researchOperatingModel.js";
import { canonicalJson } from "./decisionContextBrowser.js";
import { isRfc3339DateTime } from "./factMetadata.js";
import { buildHonestResearchFinancialCoverage, buildSourcedResearchFinancialCoverage } from "./researchFinancialCoverage.js";
import { validateResearchFinancialRequirementData, type ResearchFinancialRequirementData } from "./researchFinancialRequirement.js";
import type { ResearchSnapshotTextCitation } from "./researchSourceCitation.js";

export const RESEARCH_FUNDAMENTALS_SCHEMA_VERSION = "2026-07-30.research-fundamentals.v1";
export const RESEARCH_FUNDAMENTALS_FORMULA_VERSION = "issuer-fundamentals-v1";
export const RESEARCH_FUNDAMENTALS_EXPORT_VERSION_V1 = "2026-08-05.research-fundamentals-export.v1";
export const RESEARCH_FUNDAMENTALS_EXPORT_VERSION = "2026-10-10.research-fundamentals-export.v2";
export const RESEARCH_FINANCIAL_REQUIRED_ANNUAL_PERIODS = 5;

export const RESEARCH_FINANCIAL_COVERAGE_METRICS = [
  "revenue",
  "profit_attributable_to_owners",
  "operating_cash_flow",
  "total_assets",
  "total_liabilities"
] as const;

export const RESEARCH_FUNDAMENTAL_METRICS = [...RESEARCH_FINANCIAL_COVERAGE_METRICS, "sales_volume", "average_selling_price", "product_mix_volume", "sales_volume_yoy", "shares_outstanding", "issued_shares", "treasury_shares", "gross_profit", "gross_margin", "research_and_development_expense", "selling_and_distribution_expense", "administrative_expense", "operating_profit", "profit_before_tax", "net_finance_income", "associates_profit", "joint_ventures_profit", "capital_expenditure", "core_profit_attributable_to_owners", "property_plant_equipment_purchases", "intangible_asset_purchases", "land_lease_prepayments", "fx_effect", "non_financial_impairment",
  "deemed_disposal_gain", "depreciation_amortization", "cash_and_cash_equivalents",
  "bank_borrowings", "bonds_current", "bonds_noncurrent",
  "lease_liabilities_current", "lease_liabilities_noncurrent",
  "restricted_deposits", "structured_deposits", "fvoci_financial_assets",
  "associate_investments", "joint_venture_investments", "joint_venture_loans",
  "noncontrolling_interests", "derivative_liabilities",
  "nci_dividend_payable", "parent_dividend_payable",
  "trade_receivables", "inventories", "prepayments_and_other_operating_receivables",
  "trade_payables", "contract_liabilities", "accrued_operating_liabilities"] as const;
export type ResearchFundamentalMetric = typeof RESEARCH_FUNDAMENTAL_METRICS[number];
export type ResearchFundamentalPeriodKind = "duration" | "instant";
export type ResearchFundamentalValueStatus = "reported" | "explicit_unknown";
export type ResearchFundamentalComparability = "comparable" | "not_comparable";
export type ResearchFundamentalAmendmentKind = "initial" | "restatement" | "correction";

export interface CreateResearchFundamentalValueRequest {
  membershipVersion: number;
  sourceMaterialId: string;
  assertion?: ResearchAssertionMetadata;
  metric: ResearchFundamentalMetric;
  periodKind: ResearchFundamentalPeriodKind;
  periodStart: string | null;
  periodEnd: string;
  currency: string;
  unitScale: number;
  scope: "consolidated" | "parent_company" | "segment" | "unknown";
  valueStatus: ResearchFundamentalValueStatus;
  value: string | null;
  comparability: ResearchFundamentalComparability;
  comparabilityReason: string | null;
  amendmentKind: ResearchFundamentalAmendmentKind;
  replacesValueId: string | null;
  ownerConfirmed: true;
  idempotencyKey: string;
}

interface ResearchFundamentalSourceBase {
  materialId: string;
  materialRevision: number;
  materialRevisionState: "current" | "superseded";
  validUntil: string;
  freshness: "fresh" | "stale";
  materialSourceVersion: string;
  sourceClassification?: string;
  verificationStatus?: string;
  publishedAt?: string;
}
export type ResearchFundamentalSourceData = ResearchFundamentalSourceBase & (
  { kind?: "document_page"; documentId: string; documentPdfSha256: string; pageNumber: number; pageTextSha256: string; snapshotCitation?: never }
  | { kind: "source_snapshot"; snapshotCitation: ResearchSnapshotTextCitation;
      snapshotOriginal: {rawSha256:string;byteLength:number;mediaType:"text/html";canonicalUrl:string;responseUrl:string};
      snapshotReviewState: "current" | "pending_review";
      originalAvailability: "available" | "unavailable" | "unknown";
      documentId?: never; documentPdfSha256?: never; pageNumber?: never; pageTextSha256?: never }
);

/** A historical assertion remains readable even when its original cannot currently be verified. */
export function researchFundamentalCurrentlyUsable(value: ResearchFundamentalValueData): boolean {
  return value.valueState === "current"
    && (value.source.kind !== "source_snapshot" || (value.source.snapshotReviewState === "current"
      && value.source.originalAvailability === "available"));
}

export interface ResearchFundamentalValueData {
  id: string;
  membershipId: string;
  membershipVersionAtWrite: number;
  symbol: string;
  metric: ResearchFundamentalMetric;
  periodKind: ResearchFundamentalPeriodKind;
  periodStart: string | null;
  periodEnd: string;
  currency: string;
  unitScale: number;
  scope: "consolidated" | "parent_company" | "segment" | "unknown";
  valueStatus: ResearchFundamentalValueStatus;
  value: string | null;
  comparability: ResearchFundamentalComparability;
  comparabilityReason: string | null;
  amendmentKind: ResearchFundamentalAmendmentKind;
  replacesValueId: string | null;
  revision: number;
  valueState: "current" | "replaced" | "historical_source_superseded" | "historical_source_stale" | "retracted" | "invalid";
  assertion?: ResearchAssertionMetadata;
  provenance: {
    factKind: "issuer_reported";
    transcription: "owner_manual";
    verificationStatus: "unverified" | "verified" | "owner_confirmed" | "source_text_verified";
  };
  source: ResearchFundamentalSourceData;
  createdAt: string;
}

export interface ResearchFundamentalDerivationData {
  kind: "revenue_yoy" | "profit_change" | "profit_margin" | "cash_conversion" | "liability_ratio";
  periodEnd: string;
  basePeriodEnd: string | null;
  status: "available" | "not_comparable";
  value: string | null;
  valueKind: "ratio" | "absolute_change";
  reason: string | null;
  formulaVersion: typeof RESEARCH_FUNDAMENTALS_FORMULA_VERSION;
  inputValueIds: string[];
}

export interface ResearchFundamentalsEnvelope {
  schemaVersion: typeof RESEARCH_FUNDAMENTALS_SCHEMA_VERSION;
  generatedAt: string;
  dataCutoffAt: string | null;
  asOf: string | null;
  provenance: "research_only";
  status: "available";
  requestedActorId: string;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  values: ResearchFundamentalValueData[];
  derivations: ResearchFundamentalDerivationData[];
  financialCoverage: ResearchFinancialCoverage;
}

export interface ResearchFinancialPeriodCoverage {
  periodStart?: string;
  periodEnd: string;
  periodType: "annual" | "interim";
  status: "complete" | "unknown";
  metrics: Record<typeof RESEARCH_FINANCIAL_COVERAGE_METRICS[number], "available" | "unknown">;
}

export interface ResearchFinancialCoverage {
  coverageVersion?: "2026-10-10.honest-coverage.v2" | "2026-10-10.sourced-coverage.v3";
  requirement?: ResearchFinancialRequirementData;
  historicalStatus?: "available" | "unknown";
  latestRequiredStatus?: "available" | "unknown";
  latestRequiredPeriodEnd?: string | null;
  status: "available" | "unknown";
  requiredAnnualPeriods: typeof RESEARCH_FINANCIAL_REQUIRED_ANNUAL_PERIODS;
  completeAnnualPeriods: number;
  latestInterimPeriodEnd: string | null;
  latestInterimStatus: "complete" | "unknown";
  periods: ResearchFinancialPeriodCoverage[];
  gaps: string[];
}

export interface ResearchFundamentalSequenceFact {
  assertion?: ResearchAssertionMetadata;
  id: string;
  membershipId: string;
  symbol: string;
  period: {
    kind: ResearchFundamentalPeriodKind;
    start: string | null;
    end: string;
  };
  metric: ResearchFundamentalMetric;
  valueStatus: ResearchFundamentalValueStatus;
  value: string | null;
  currency: string;
  unitScale: number;
  scope: "consolidated" | "parent_company" | "segment" | "unknown";
  amendmentKind: ResearchFundamentalAmendmentKind;
  replacesValueId: string | null;
  revision: number;
  valueState: ResearchFundamentalValueData["valueState"];
  asOf: string;
  dataCutoffAt: string;
  citation: {
    materialId: string;
    materialRevision: number;
    materialSourceVersion: string;
  } & ({ kind?: "document_page";
    documentId: string;
    pageNumber: number;
    documentPdfSha256: string;
    pageTextSha256: string;
  } | (ResearchSnapshotTextCitation & {rawSha256:string;byteLength:number;mediaType:"text/html";canonicalUrl:string;responseUrl:string}));
  source: ResearchFundamentalSourceData;
  provenance: ResearchFundamentalValueData["provenance"];
}

export interface ResearchFundamentalsExport {
  exportVersion: typeof RESEARCH_FUNDAMENTALS_EXPORT_VERSION | typeof RESEARCH_FUNDAMENTALS_EXPORT_VERSION_V1;
  schemaVersion: typeof RESEARCH_FUNDAMENTALS_SCHEMA_VERSION;
  generatedAt: string;
  dataCutoffAt: string | null;
  asOf: string | null;
  provenance: "research_only";
  requestedActorId: string;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  facts: ResearchFundamentalSequenceFact[];
  derivations: ResearchFundamentalDerivationData[];
  financialCoverage: ResearchFinancialCoverage;
}

export function buildResearchFinancialCoverage(
  values: ResearchFundamentalValueData[], requirement?: ResearchFinancialRequirementData
): ResearchFinancialCoverage {
  return requirement ? buildSourcedResearchFinancialCoverage(values, requirement) : buildHonestResearchFinancialCoverage(values);
}

export function toResearchFundamentalsExport(
  envelope: ResearchFundamentalsEnvelope,
  dataCutoffAt: string | null = envelope.dataCutoffAt
): ResearchFundamentalsExport {
  const values = [...envelope.values].sort(compareFundamentalValues);
  return {
    exportVersion: RESEARCH_FUNDAMENTALS_EXPORT_VERSION,
    schemaVersion: envelope.schemaVersion,
    generatedAt: envelope.generatedAt,
    dataCutoffAt,
    asOf: envelope.asOf,
    provenance: envelope.provenance,
    requestedActorId: envelope.requestedActorId,
    membershipId: envelope.membershipId,
    membershipVersion: envelope.membershipVersion,
    symbol: envelope.symbol,
    facts: values.map((value) => ({
      ...(value.assertion ? { assertion: value.assertion } : {}),
      id: value.id,
      membershipId: value.membershipId,
      symbol: value.symbol,
      period: { kind: value.periodKind, start: value.periodStart, end: value.periodEnd },
      metric: value.metric,
      valueStatus: value.valueStatus,
      value: value.value,
      currency: value.currency,
      unitScale: value.unitScale,
      scope: value.scope,
      amendmentKind: value.amendmentKind,
      replacesValueId: value.replacesValueId,
      revision: value.revision,
      valueState: value.valueState,
      asOf: value.periodEnd,
      dataCutoffAt: value.createdAt,
      citation: value.source.kind === "source_snapshot"
        ? { materialId: value.source.materialId, materialRevision: value.source.materialRevision,
          materialSourceVersion: value.source.materialSourceVersion, ...value.source.snapshotCitation,
          ...value.source.snapshotOriginal }
        : { materialId: value.source.materialId, materialRevision: value.source.materialRevision,
          materialSourceVersion: value.source.materialSourceVersion, documentId: value.source.documentId,
          pageNumber: value.source.pageNumber, documentPdfSha256: value.source.documentPdfSha256,
          pageTextSha256: value.source.pageTextSha256 },
      source: value.source,
      provenance: value.provenance
    })),
    derivations: [...envelope.derivations],
    financialCoverage: envelope.financialCoverage
  };
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000);
}

function compareFundamentalValues(left: ResearchFundamentalValueData, right: ResearchFundamentalValueData): number {
  return right.periodEnd.localeCompare(left.periodEnd)
    || left.metric.localeCompare(right.metric)
    || right.revision - left.revision
    || comparePositiveIds(right.id, left.id);
}

function comparePositiveIds(left: string, right: string): number {
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

export function validateCreateResearchFundamentalValueRequest(
  value: unknown
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["request must be an object"]);
  exact(value, [
    "membershipVersion", "sourceMaterialId", "metric", "periodKind", "periodStart", "periodEnd",
    "currency", "unitScale", "scope", "valueStatus", "value", "comparability",
    "comparabilityReason", "amendmentKind", "replacesValueId", "ownerConfirmed", "idempotencyKey", "assertion"
  ], errors);
  if (!Number.isSafeInteger(value.membershipVersion) || Number(value.membershipVersion) <= 0) errors.push("membershipVersion must be a positive integer");
  positiveId(value.sourceMaterialId, "sourceMaterialId", errors);
  if (!RESEARCH_FUNDAMENTAL_METRICS.includes(value.metric as ResearchFundamentalMetric)) errors.push("metric is invalid");
  if (!["duration", "instant"].includes(String(value.periodKind))) errors.push("periodKind is invalid");
  if (value.periodKind === "duration") {
    date(value.periodStart, "periodStart", errors);
    date(value.periodEnd, "periodEnd", errors);
    if (typeof value.periodStart === "string" && typeof value.periodEnd === "string" && value.periodStart >= value.periodEnd) {
      errors.push("duration periodStart must be earlier than periodEnd");
    }
  } else {
    if (value.periodStart !== null) errors.push("instant periodStart must be null");
    date(value.periodEnd, "periodEnd", errors);
  }
  if (typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency)) errors.push("currency must be a three-letter uppercase code");
  if (!Number.isSafeInteger(value.unitScale) || ![1, 1_000, 1_000_000, 1_000_000_000].includes(Number(value.unitScale))) {
    errors.push("unitScale is invalid");
  }
  if (!["consolidated", "parent_company", "segment", "unknown"].includes(String(value.scope))) errors.push("scope is invalid");
  if (!["reported", "explicit_unknown"].includes(String(value.valueStatus))) errors.push("valueStatus is invalid");
  if (value.valueStatus === "reported") {
    if (typeof value.value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value.value) || value.value === "-0") {
      errors.push("reported value must be a canonical decimal string with at most six fractional digits");
    }
  } else if (value.value !== null) {
    errors.push("explicit_unknown value must be null");
  }
  if (!["comparable", "not_comparable"].includes(String(value.comparability))) errors.push("comparability is invalid");
  if (value.comparability === "not_comparable") bounded(value.comparabilityReason, "comparabilityReason", 500, errors);
  else if (value.comparabilityReason !== null) errors.push("comparable value must not provide comparabilityReason");
  if (!["initial", "restatement", "correction"].includes(String(value.amendmentKind))) errors.push("amendmentKind is invalid");
  if (value.replacesValueId === null) {
    if (value.amendmentKind !== "initial") errors.push("an initial value must use amendmentKind initial");
  } else {
    positiveId(value.replacesValueId, "replacesValueId", errors);
    if (value.amendmentKind === "initial") errors.push("a replacement must be a restatement or correction");
  }
  validateAssertionValue(value, errors);
  if (value.ownerConfirmed !== true) errors.push("ownerConfirmed must be true");
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return errors.length ? invalid(errors) : { ok: true };
}

function validateAssertionValue(value: Record<string,unknown>, errors:string[]): void {
  if (value.assertion !== undefined) {
    if (!validAssertionMetadata(value.assertion)) errors.push("assertion metadata is invalid");
    else {
      const expectedUnit = value.metric === "average_selling_price" ? "currency_per_vehicle" : ["sales_volume","product_mix_volume"].includes(String(value.metric)) ? "vehicles" : ["shares_outstanding","issued_shares","treasury_shares"].includes(String(value.metric)) ? "shares" : ["gross_margin","sales_volume_yoy"].includes(String(value.metric)) ? "ratio" : "currency";
      if (expectedUnit === "shares" && (value.assertion.measurementBasis !== "issued_shares" || value.periodKind !== "instant")) errors.push("share capital assertions require instant issued_shares basis");
      if (value.metric === "product_mix_volume" && !value.assertion.mix) errors.push("product mix requires dimension and parent scope");
      if (value.assertion.unit !== expectedUnit) errors.push("assertion unit does not match metric");
      if (!["currency","currency_per_vehicle"].includes(expectedUnit) && (value.currency !== "XXX" || expectedUnit !== "vehicles" && value.unitScale !== 1)) errors.push("nonmonetary assertions require XXX and unitScale=1");
      if (["currency","currency_per_vehicle"].includes(expectedUnit) && value.currency === "XXX") errors.push("monetary assertions require an actual currency");
      if (value.metric === "gross_margin" && value.value !== null && (Number(value.value)<0 || Number(value.value)>1)) errors.push("gross margin must be a ratio between zero and one");
      if (["vehicles", "shares"].includes(expectedUnit) && value.value !== null && (!Number.isSafeInteger(Number(value.value)*Number(value.unitScale)) || Number(value.value)<0)) errors.push("count assertions require nonnegative integer values");
    }
  } else if (!(RESEARCH_FINANCIAL_COVERAGE_METRICS as readonly unknown[]).includes(value.metric)) errors.push("extended metric requires explicit assertion metadata");
  const outflows = ["property_plant_equipment_purchases", "intangible_asset_purchases", "land_lease_prepayments", "capital_expenditure", "research_and_development_expense", "selling_and_distribution_expense", "administrative_expense"];
  if (value.assertion && outflows.includes(String(value.metric)) && value.value !== null && Number(value.value) < 0) errors.push("expense and cash outflow assertions must use positive magnitudes, with source sign explained in limitation");
  const fcffBalance = ["cash_and_cash_equivalents", "bank_borrowings", "bonds_current",
    "bonds_noncurrent", "lease_liabilities_current", "lease_liabilities_noncurrent",
    "restricted_deposits", "structured_deposits", "fvoci_financial_assets",
    "associate_investments", "joint_venture_investments", "joint_venture_loans",
    "noncontrolling_interests", "derivative_liabilities", "nci_dividend_payable",
    "parent_dividend_payable", "trade_receivables", "inventories",
    "prepayments_and_other_operating_receivables", "trade_payables",
    "contract_liabilities", "accrued_operating_liabilities"];
  if (fcffBalance.includes(String(value.metric)) && (value.periodKind !== "instant" || value.periodStart !== null))
    errors.push("FCFF reported balance rows require an instant period");
  if (["deemed_disposal_gain", "depreciation_amortization"].includes(String(value.metric))
    && (value.periodKind !== "duration" || value.periodStart === null))
    errors.push("FCFF income and depreciation rows require a duration period");
  if ([...fcffBalance, "depreciation_amortization"].includes(String(value.metric))
    && value.value !== null && Number(value.value) < 0)
    errors.push("FCFF balance and depreciation rows require nonnegative reported magnitudes");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[], errors: string[]): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`request.${key} is not allowed`);
}

function positiveId(value: unknown, key: string, errors: string[]): void {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) errors.push(`${key} must be a positive integer string`);
}

function date(value: unknown, key: string, errors: string[]): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push(`${key} must be an ISO calendar date`);
    return;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    errors.push(`${key} must be an ISO calendar date`);
  }
}

function bounded(value: unknown, key: string, max: number, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    errors.push(`${key} must be a non-empty string of at most ${max} characters`);
  }
}

function invalid(errors: string[]): { ok: false; errors: string[] } {
  return { ok: false, errors };
}

export function validateResearchFundamentalsEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  if (!record(value)
    || value.schemaVersion !== RESEARCH_FUNDAMENTALS_SCHEMA_VERSION
    || typeof value.generatedAt !== "string"
    || !isRfc3339DateTime(value.generatedAt)
    || (value.dataCutoffAt !== null && (typeof value.dataCutoffAt !== "string" || !isRfc3339DateTime(value.dataCutoffAt)))
    || (value.asOf !== null && (typeof value.asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.asOf)))
    || value.provenance !== "research_only"
    || value.status !== "available"
    || typeof value.requestedActorId !== "string"
    || typeof value.membershipId !== "string"
    || !Number.isSafeInteger(value.membershipVersion)
    || typeof value.symbol !== "string"
    || !Array.isArray(value.values)
    || !Array.isArray(value.derivations)
    || !validateResearchFinancialCoverage(value.financialCoverage).ok) {
    return invalid(["research fundamentals envelope is invalid"]);
  }
  if (record(value.financialCoverage) && value.financialCoverage.coverageVersion === "2026-10-10.sourced-coverage.v3") {
    const requirement=value.financialCoverage.requirement as ResearchFinancialRequirementData | undefined;
    if(!requirement || requirement.membershipId!==value.membershipId || requirement.membershipVersion!==value.membershipVersion
      || requirement.symbol!==value.symbol || requirement.actorId!==value.requestedActorId
      || Date.parse(requirement.validUntil)<=Date.parse(String(value.generatedAt)))
      return invalid(["financial requirement identity differs from fundamentals"]);
  }
  if (record(value.financialCoverage) && ["2026-10-10.honest-coverage.v2","2026-10-10.sourced-coverage.v3"].includes(String(value.financialCoverage.coverageVersion))) {
    try {
      if (canonicalJson(value.financialCoverage) !== canonicalJson(buildResearchFinancialCoverage(value.values as ResearchFundamentalValueData[],
        value.financialCoverage.coverageVersion === "2026-10-10.sourced-coverage.v3" ? value.financialCoverage.requirement as ResearchFinancialRequirementData : undefined)))
        return invalid(["financial coverage does not match the exact facts and accounting basis"]);
    } catch {
      return invalid(["financial coverage facts cannot be verified"]);
    }
  }
  return { ok: true };
}

export function validateResearchFundamentalsExport(value: unknown, allowEmpty = false): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["research fundamentals export must be an object"]);
  exactKeys(value, [
    "exportVersion", "schemaVersion", "generatedAt", "dataCutoffAt", "asOf", "provenance",
    "requestedActorId", "membershipId", "membershipVersion", "symbol", "facts", "derivations", "financialCoverage"
  ], "export", errors);
  const empty = allowEmpty && Array.isArray(value.facts) && value.facts.length === 0;
  const cutoffValid = validExportCutoff(value, empty);
  if (!validExportHeader(value, cutoffValid)) errors.push("research fundamentals export header is invalid");
  const facts = Array.isArray(value.facts) ? value.facts : [];
  if (!Array.isArray(value.facts) || (!empty && facts.length === 0) || facts.length > 500) errors.push("research fundamentals export requires 1-500 facts");
  facts.forEach((fact, index) => validateExportFact(fact, value, index, errors));
  const factIds = new Set(facts.filter(record).map((fact) => fact.id).filter((id): id is string => typeof id === "string"));
  if (factIds.size !== facts.length) errors.push("research fundamentals fact ids must be unique");
  const cutoffs = facts.filter(record).map((fact) => fact.dataCutoffAt).filter((cutoff): cutoff is string => typeof cutoff === "string");
  const periods = facts.filter(record).map((fact) => fact.asOf).filter((asOf): asOf is string => typeof asOf === "string");
  if (!empty && (cutoffs.length !== facts.length || cutoffs.sort().at(-1) !== value.dataCutoffAt
    || periods.length !== facts.length || periods.sort().at(-1) !== value.asOf)) {
    errors.push("research fundamentals export header does not bind the exact fact cutoff and as-of");
  }
  if (!Array.isArray(value.derivations) || value.derivations.length === 0 || value.derivations.length > 500) errors.push("research fundamentals derivations are invalid");
  else value.derivations.forEach((derivation, index) => validateExportDerivation(derivation, factIds, index, errors));
  if (empty && record(value.financialCoverage)
    && (value.financialCoverage.completeAnnualPeriods !== 0 || value.financialCoverage.status !== "unknown"
      || !Array.isArray(value.financialCoverage.periods) || value.financialCoverage.periods.length !== 0))
    errors.push("empty fundamentals cannot claim financial coverage");
  const coverage = validateResearchFinancialCoverage(value.financialCoverage);
  if (!coverage.ok) errors.push(...coverage.errors);
  if (record(value.financialCoverage) && value.financialCoverage.coverageVersion === "2026-10-10.sourced-coverage.v3") {
    const requirement=value.financialCoverage.requirement as ResearchFinancialRequirementData | undefined;
    if (!requirement || requirement.membershipId!==value.membershipId || requirement.membershipVersion!==value.membershipVersion
      || requirement.symbol!==value.symbol || requirement.actorId!==value.requestedActorId
      || Date.parse(requirement.validUntil)<=Date.parse(String(value.generatedAt)))
      errors.push("export financial requirement identity or expiry differs from facts");
  }
  if (coverage.ok && record(value.financialCoverage)
    && ["2026-10-10.honest-coverage.v2","2026-10-10.sourced-coverage.v3"].includes(String(value.financialCoverage.coverageVersion))
    && !exportFactsSupportCoverage(facts as ResearchFundamentalSequenceFact[],value.financialCoverage as unknown as ResearchFinancialCoverage,
      Number(value.membershipVersion)))
    errors.push("financial coverage periods are not supported by one accounting basis in exported facts");
  return errors.length ? invalid(errors) : { ok: true };
}

function validExportHeader(value:Record<string,unknown>,cutoffValid:boolean):boolean {
  return [RESEARCH_FUNDAMENTALS_EXPORT_VERSION,RESEARCH_FUNDAMENTALS_EXPORT_VERSION_V1].includes(value.exportVersion as typeof RESEARCH_FUNDAMENTALS_EXPORT_VERSION)
    && value.schemaVersion === RESEARCH_FUNDAMENTALS_SCHEMA_VERSION
    && typeof value.generatedAt === "string" && isRfc3339DateTime(value.generatedAt)
    && cutoffValid && value.provenance === "research_only"
    && typeof value.requestedActorId === "string" && !!value.requestedActorId
    && typeof value.membershipId === "string" && /^[1-9]\d*$/.test(value.membershipId)
    && Number.isSafeInteger(value.membershipVersion) && Number(value.membershipVersion) >= 1
    && typeof value.symbol === "string" && /^HK\.\d{5}$/.test(value.symbol);
}

function exportFactsSupportCoverage(facts:ResearchFundamentalSequenceFact[],coverage:ResearchFinancialCoverage,
  membershipVersion:number):boolean {
  if(coverage.periods.length===0)return coverage.completeAnnualPeriods===0;
  const groups=new Map<string,ResearchFundamentalValueData[]>();
  for(const fact of facts){
    if(!record(fact)||!record(fact.period)||!record(fact.source))return false;
    const key=canonicalJson([fact.membershipId,membershipVersion,fact.symbol,fact.scope,fact.currency,
      fact.assertion?.businessScope??"unknown",fact.assertion?.measurementBasis??"unknown"]);
    const values=groups.get(key)??[];
    values.push({id:fact.id,membershipId:fact.membershipId,membershipVersionAtWrite:membershipVersion,
      symbol:fact.symbol,metric:fact.metric,periodKind:fact.period.kind,periodStart:fact.period.start,
      periodEnd:fact.period.end,currency:fact.currency,unitScale:fact.unitScale,scope:fact.scope,
      valueStatus:fact.valueStatus,value:fact.value,comparability:"comparable",comparabilityReason:null,
      amendmentKind:fact.amendmentKind,replacesValueId:fact.replacesValueId,revision:fact.revision,
      valueState:fact.valueState,createdAt:fact.dataCutoffAt,assertion:fact.assertion,
      provenance:fact.provenance,source:fact.source});
    groups.set(key,values);
  }
  return [...groups.values()].some(values=>{
    let possible:ResearchFinancialCoverage;
    try{possible=buildResearchFinancialCoverage(values,coverage.requirement);}catch{return false;}
    if(possible.completeAnnualPeriods<coverage.completeAnnualPeriods)return false;
    return coverage.periods.every(period=>{
      const match=possible.periods.find(item=>item.periodType===period.periodType
        && item.periodStart===period.periodStart&&item.periodEnd===period.periodEnd);
      return !!match && RESEARCH_FINANCIAL_COVERAGE_METRICS.every(metric=>
        period.metrics[metric]!=="available"||match.metrics[metric]==="available");
    });
  });
}

function validExportCutoff(value: Record<string, unknown>, empty: boolean): boolean {
  return empty ? value.dataCutoffAt === null && value.asOf === null
    : typeof value.dataCutoffAt === "string" && isRfc3339DateTime(value.dataCutoffAt)
      && typeof value.asOf === "string" && calendarDate(value.asOf);
}

export function validateResearchFinancialCoverage(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  if (!validCoverageHeader(value)) return invalid(["financial coverage is invalid"]);
  for (const period of value.periods) {
    const error = coveragePeriodError(period, value.coverageVersion);
    if (error) return invalid([error]);
  }
  if (value.coverageVersion === "2026-10-10.honest-coverage.v2") return validateV2Coverage(value);
  if (value.coverageVersion === "2026-10-10.sourced-coverage.v3") return validateV3Coverage(value);
  const completeAnnual = value.periods.filter((period) => record(period) && period.periodType === "annual" && period.status === "complete").length;
  const latestInterim = value.periods.find((period) => record(period) && period.periodType === "interim") as Record<string, unknown> | undefined;
  if (value.coverageVersion !== undefined || completeAnnual !== value.completeAnnualPeriods
    || (latestInterim?.periodEnd ?? null) !== value.latestInterimPeriodEnd
    || (latestInterim?.status ?? "unknown") !== value.latestInterimStatus
    || (value.status === "available") !== (value.completeAnnualPeriods >= RESEARCH_FINANCIAL_REQUIRED_ANNUAL_PERIODS && value.latestInterimStatus === "complete" && value.gaps.length === 0)) {
    return invalid(["financial coverage summary is inconsistent"]);
  }
  return { ok: true };
}

function validCoverageHeader(value:unknown):value is Record<string,unknown> & {periods:unknown[];gaps:string[]} {
  return record(value) && ["available", "unknown"].includes(String(value.status))
    && value.requiredAnnualPeriods === RESEARCH_FINANCIAL_REQUIRED_ANNUAL_PERIODS
    && Number.isSafeInteger(value.completeAnnualPeriods) && Number(value.completeAnnualPeriods) >= 0
    && (value.latestInterimPeriodEnd === null || typeof value.latestInterimPeriodEnd === "string" && calendarDate(value.latestInterimPeriodEnd))
    && ["complete", "unknown"].includes(String(value.latestInterimStatus))
    && Array.isArray(value.periods) && Array.isArray(value.gaps)
    && !value.gaps.some((gap) => typeof gap !== "string" || !gap.trim());
}

function coveragePeriodError(period:unknown,version:unknown):string|null {
  if (!record(period) || typeof period.periodEnd !== "string" || !calendarDate(period.periodEnd)
    || ((version === "2026-10-10.honest-coverage.v2" || version === "2026-10-10.sourced-coverage.v3") && (typeof period.periodStart !== "string" || !calendarDate(period.periodStart) || period.periodStart >= period.periodEnd))
    || !["annual", "interim"].includes(String(period.periodType)) || !["complete", "unknown"].includes(String(period.status))
    || !record(period.metrics) || Object.keys(period.metrics).sort().join(",") !== [...RESEARCH_FINANCIAL_COVERAGE_METRICS].sort().join(",")
    || Object.values(period.metrics).some((status) => !["available", "unknown"].includes(String(status))))
    return "financial coverage period is invalid";
  if ((period.status === "complete") !== Object.values(period.metrics).every(status => status === "available"))
    return "financial coverage period status is inconsistent";
  return null;
}

function validateV2Coverage(value:Record<string,unknown> & {periods:unknown[]}):{ok:true}|{ok:false;errors:string[]} {
  const periods=value.periods as ResearchFinancialPeriodCoverage[];
  const count=continuousAnnualCoverageCount(periods);
  if (count.error) return invalid([count.error]);
  const latestInterim=periods.find(period=>period.periodType==="interim");
  if (value.status !== "unknown" || !["available", "unknown"].includes(String(value.historicalStatus))
    || value.latestRequiredStatus !== "unknown" || value.latestRequiredPeriodEnd !== null
    || Number(value.completeAnnualPeriods) !== count.count
    || (value.historicalStatus === "available") !== (Number(value.completeAnnualPeriods) >= RESEARCH_FINANCIAL_REQUIRED_ANNUAL_PERIODS)
    || (latestInterim?.periodEnd ?? null) !== value.latestInterimPeriodEnd
    || (latestInterim?.status ?? "unknown") !== value.latestInterimStatus)
    return invalid(["financial coverage v2 summary is inconsistent"]);
  return {ok:true};
}

function continuousAnnualCoverageCount(periods:ResearchFinancialPeriodCoverage[]):{count:number;error:string|null} {
  const seen=new Set<string>();
  for(let index=0;index<periods.length;index++){
    const period=periods[index]!;
    const key=`${period.periodType}:${period.periodStart}:${period.periodEnd}`;
    if(seen.has(key))return {count:0,error:"financial coverage v2 has duplicate periods"};
    seen.add(key);
    if(index>0){
      const previous=periods[index-1]!;
      if(previous.periodEnd<period.periodEnd || previous.periodEnd===period.periodEnd
        && String(previous.periodStart)<String(period.periodStart))
        return {count:0,error:"financial coverage v2 periods are not sorted newest first"};
    }
    if(period.periodType==="annual"){
      const days=(Date.parse(`${period.periodEnd}T00:00:00Z`)-Date.parse(`${period.periodStart}T00:00:00Z`))/86400000+1;
      if(days!==365&&days!==366)return {count:0,error:"financial coverage v2 annual duration is invalid"};
    }
  }
  const annual=periods.filter(period=>period.periodType==="annual");
  let count=0;
  for(const period of annual){
    if(period.status!=="complete")break;
    if(count>0){
      const newer=annual[count-1]!;
      const next=new Date(Date.parse(`${period.periodEnd}T00:00:00Z`)+86400000).toISOString().slice(0,10);
      if(next!==newer.periodStart)break;
    }
    count++;
  }
  return {count,error:null};
}

function validateExportFact(value: unknown, envelope: Record<string, unknown>, index: number, errors: string[]): void {
  const label = `facts[${index}]`;
  if (!record(value)) { errors.push(`${label} is invalid`); return; }
  exactKeys(value, [
    "id", "membershipId", "symbol", "period", "metric", "valueStatus", "value", "currency",
    "unitScale", "scope", "amendmentKind", "replacesValueId", "revision", "valueState", "asOf",
    "dataCutoffAt", "citation", "source", "provenance", ...("assertion" in value ? ["assertion"] : [])
  ], label, errors);
  if (!validExportFactIdentity(value,envelope)) errors.push(`${label} identity, state, or cutoff is invalid`);
  if (value.valueStatus === "reported" && (typeof value.value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value.value))) errors.push(`${label}.value is invalid`);
  if (value.valueStatus === "explicit_unknown" && value.value !== null) errors.push(`${label}.value must be null for explicit_unknown`);
  if (typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency)
    || !Number.isSafeInteger(value.unitScale) || ![1, 1_000, 1_000_000, 1_000_000_000].includes(Number(value.unitScale))
    || !["consolidated", "parent_company", "segment", "unknown"].includes(String(value.scope))
    || !["initial", "restatement", "correction"].includes(String(value.amendmentKind))) errors.push(`${label} accounting fields are invalid`);
  if (value.amendmentKind === "initial" ? value.replacesValueId !== null : typeof value.replacesValueId !== "string" || !/^[1-9]\d*$/.test(value.replacesValueId)) {
    errors.push(`${label} replacement binding is invalid`);
  }
  if (value.assertion !== undefined && !validAssertionMetadata(value.assertion)) errors.push(`${label}.assertion is invalid`);
  if (envelope.exportVersion === RESEARCH_FUNDAMENTALS_EXPORT_VERSION_V1
    && record(value.source) && value.source.kind === "source_snapshot")
    errors.push(`${label}.snapshot source requires export v2`);
  validateExportSourceAndCitation(value.source, value.citation, label, errors);
  if (!record(value.provenance)) errors.push(`${label}.provenance is invalid`);
  else {
    exactKeys(value.provenance, ["factKind", "transcription", "verificationStatus"], `${label}.provenance`, errors);
    if (value.provenance.factKind !== "issuer_reported" || value.provenance.transcription !== "owner_manual"
      || !["unverified", "verified", "owner_confirmed", "source_text_verified"].includes(String(value.provenance.verificationStatus))) errors.push(`${label}.provenance is invalid`);
  }
}

function validExportFactIdentity(value:Record<string,unknown>,envelope:Record<string,unknown>):boolean {
  return typeof value.id === "string" && /^[1-9]\d*$/.test(value.id)
    && value.membershipId === envelope.membershipId && value.symbol === envelope.symbol
    && RESEARCH_FUNDAMENTAL_METRICS.includes(value.metric as ResearchFundamentalMetric)
    && value.valueState === "current" && Number.isSafeInteger(value.revision) && Number(value.revision) >= 1
    && ["reported", "explicit_unknown"].includes(String(value.valueStatus))
    && typeof value.dataCutoffAt === "string" && isRfc3339DateTime(value.dataCutoffAt)
    && Date.parse(value.dataCutoffAt) <= Date.parse(String(envelope.dataCutoffAt))
    && typeof value.asOf === "string" && calendarDate(value.asOf)
    && record(value.period) && validateExportPeriod(value.period, value.asOf);
}

function validateExportSourceAndCitation(source: unknown, citation: unknown, label: string, errors: string[]): void {
  if (!record(source) || !record(citation)) { errors.push(`${label} source or citation is missing`); return; }
  if (source.kind === "source_snapshot") validateSnapshotExportSourceAndCitation(source,citation,label,errors);
  else validateDocumentExportSourceAndCitation(source,citation,label,errors);
}

function validateSnapshotExportSourceAndCitation(source:Record<string,unknown>,citation:Record<string,unknown>,label:string,errors:string[]):void {
    exactKeys(source, ["kind","materialId","materialRevision","materialRevisionState","validUntil","freshness","materialSourceVersion",
      "snapshotCitation","snapshotOriginal","snapshotReviewState","originalAvailability",...["sourceClassification","verificationStatus","publishedAt"].filter(key=>Object.hasOwn(source,key))],`${label}.source`,errors);
    exactKeys(citation,["kind","materialId","materialRevision","materialSourceVersion","snapshotId","textSha256",
      "startUtf16","endUtf16","excerptSha256","rawSha256","byteLength","mediaType","canonicalUrl","responseUrl"],`${label}.citation`,errors);
    const span=source.snapshotCitation,original=source.snapshotOriginal;
    if (source.materialRevisionState!=="current" || source.freshness!=="fresh"
      || source.snapshotReviewState!=="current" || source.originalAvailability!=="available"
      || typeof source.materialId!=="string" || !/^[1-9]\d*$/.test(source.materialId)
      || !Number.isSafeInteger(source.materialRevision) || Number(source.materialRevision)<1
      || typeof source.validUntil!=="string" || !isRfc3339DateTime(source.validUntil)
      || typeof source.materialSourceVersion!=="string" || !source.materialSourceVersion
      || !record(span) || span.kind!=="source_snapshot" || typeof span.snapshotId!=="string" || !/^[1-9]\d*$/.test(span.snapshotId)
      || !sha256(span.textSha256) || !sha256(span.excerptSha256)
      || !Number.isSafeInteger(span.startUtf16) || Number(span.startUtf16)<0
      || !Number.isSafeInteger(span.endUtf16) || Number(span.endUtf16)<=Number(span.startUtf16)
      || !record(original) || !sha256(original.rawSha256)
      || !Number.isSafeInteger(original.byteLength) || Number(original.byteLength)<1
      || original.mediaType!=="text/html" || typeof original.canonicalUrl!=="string"
      || typeof original.responseUrl!=="string" || !original.canonicalUrl.startsWith("https://")
      || !original.responseUrl.startsWith("https://")) errors.push(`${label}.snapshot source is invalid`);
    const expected={kind:"source_snapshot",materialId:source.materialId,materialRevision:source.materialRevision,
      materialSourceVersion:source.materialSourceVersion,...(record(span)?span:{}),...(record(original)?original:{})};
    if (canonicalJson(citation)!==canonicalJson(expected)) errors.push(`${label}.snapshot citation does not match source`);

}

function validateDocumentExportSourceAndCitation(source:Record<string,unknown>,citation:Record<string,unknown>,label:string,errors:string[]):void {
  exactKeys(source, ["materialId", "materialRevision", "materialRevisionState", "validUntil", "freshness", "materialSourceVersion", "documentId", "documentPdfSha256", "pageNumber", "pageTextSha256", ...["sourceClassification", "verificationStatus", "publishedAt"].filter(key => Object.hasOwn(source, key))], `${label}.source`, errors);
  exactKeys(citation, ["materialId", "materialRevision", "materialSourceVersion", "documentId", "pageNumber", "documentPdfSha256", "pageTextSha256"], `${label}.citation`, errors);
  if (typeof source.materialId !== "string" || !/^[1-9]\d*$/.test(source.materialId)
    || !Number.isSafeInteger(source.materialRevision) || Number(source.materialRevision) < 1
    || source.materialRevisionState !== "current" || source.freshness !== "fresh"
    || typeof source.validUntil !== "string" || !isRfc3339DateTime(source.validUntil)
    || typeof source.materialSourceVersion !== "string" || !source.materialSourceVersion
    || typeof source.documentId !== "string" || !/^[1-9]\d*$/.test(source.documentId)
    || !Number.isSafeInteger(source.pageNumber) || Number(source.pageNumber) < 1
    || !sha256(source.documentPdfSha256) || !sha256(source.pageTextSha256)) errors.push(`${label}.source is invalid`);
  for (const key of ["materialId", "materialRevision", "materialSourceVersion", "documentId", "pageNumber", "documentPdfSha256", "pageTextSha256"]) {
    if (citation[key] !== source[key]) errors.push(`${label}.citation does not match source`);
  }
}

function validateExportDerivation(value: unknown, factIds: Set<string>, index: number, errors: string[]): void {
  const label = `derivations[${index}]`;
  if (!record(value)) { errors.push(`${label} is invalid`); return; }
  exactKeys(value, ["kind", "periodEnd", "basePeriodEnd", "status", "value", "valueKind", "reason", "formulaVersion", "inputValueIds"], label, errors);
  if (!["revenue_yoy", "profit_change", "profit_margin", "cash_conversion", "liability_ratio"].includes(String(value.kind))
    || typeof value.periodEnd !== "string" || value.periodEnd !== "" && !calendarDate(value.periodEnd)
    || value.basePeriodEnd !== null && (typeof value.basePeriodEnd !== "string" || !calendarDate(value.basePeriodEnd))
    || !["available", "not_comparable"].includes(String(value.status))
    || !["ratio", "absolute_change"].includes(String(value.valueKind))
    || value.kind !== "profit_change" && value.valueKind !== "ratio"
    || value.formulaVersion !== RESEARCH_FUNDAMENTALS_FORMULA_VERSION
    || !Array.isArray(value.inputValueIds)
    || value.status === "available" && (value.periodEnd === "" || value.inputValueIds.length === 0)
    || value.periodEnd === "" && value.inputValueIds.length > 0
    || value.inputValueIds.some((id) => typeof id !== "string" || !factIds.has(id))
    || new Set(value.inputValueIds).size !== value.inputValueIds.length) errors.push(`${label} formula or input ids are invalid`);
  if (value.status === "available"
    ? typeof value.value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(value.value)
      || value.reason !== null && (typeof value.reason !== "string" || !value.reason.trim())
    : value.value !== null || typeof value.reason !== "string" || !value.reason.trim()) {
    errors.push(`${label} value and reason do not match status`);
  }
}

function validateExportPeriod(value: Record<string, unknown>, asOf: unknown): boolean {
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "end,kind,start" || value.end !== asOf || !["duration", "instant"].includes(String(value.kind))) return false;
  if (typeof value.end !== "string" || !calendarDate(value.end)) return false;
  return value.kind === "instant"
    ? value.start === null
    : typeof value.start === "string" && calendarDate(value.start) && value.start < value.end;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string, errors: string[]): void {
  const actual = Object.keys(value).sort(); const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) errors.push(`${label} has unexpected or missing keys`);
}
function calendarDate(value: string): boolean { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const parsed = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
function sha256(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }

function validateV3Coverage(value:Record<string,unknown> & {periods:unknown[]}):{ok:true}|{ok:false;errors:string[]} {
  if(!validateResearchFinancialRequirementData(value.requirement))return invalid(["financial requirement binding is invalid"]);
  const requirement=value.requirement;
  const periods=value.periods as ResearchFinancialPeriodCoverage[];
  const annual=periods.filter(period=>period.periodType==="annual");
  let count=0;
  for(let i=0;i<RESEARCH_FINANCIAL_REQUIRED_ANNUAL_PERIODS;i++){
    const year=Number(requirement.latestRequiredAnnualPeriodEnd.slice(0,4))-i;
    const end=`${year}-${requirement.fiscalYearEnd}`,previous=`${year-1}-${requirement.fiscalYearEnd}`;
    const start=new Date(Date.parse(`${previous}T00:00:00Z`)+86400000).toISOString().slice(0,10);
    if(!annual.some(period=>period.periodStart===start&&period.periodEnd===end&&period.status==="complete"))break;count++;
  }
  const interim=periods.find(period=>period.periodType==="interim"
    && period.periodStart===requirement.latestRequiredInterimPeriodStart
    && period.periodEnd===requirement.latestRequiredInterimPeriodEnd);
  const latestIsAnnual=requirement.latestRequiredAnnualPeriodEnd>requirement.latestRequiredInterimPeriodEnd;
  const latestAnnual=annual.find(period=>period.periodEnd===requirement.latestRequiredAnnualPeriodEnd);
  const latestStatus=(latestIsAnnual?latestAnnual:interim)?.status==="complete"?"available":"unknown";
  if(count!==value.completeAnnualPeriods
    || value.latestInterimPeriodEnd!==(interim?.periodEnd??null)
    || value.latestInterimStatus!==(interim?.status??"unknown")
    || value.latestRequiredPeriodEnd!==(latestIsAnnual?requirement.latestRequiredAnnualPeriodEnd:requirement.latestRequiredInterimPeriodEnd)
    || value.latestRequiredStatus!==latestStatus
    || value.historicalStatus!==(count>=RESEARCH_FINANCIAL_REQUIRED_ANNUAL_PERIODS?"available":"unknown")
    || value.status!==(count>=RESEARCH_FINANCIAL_REQUIRED_ANNUAL_PERIODS&&interim?.status==="complete"&&Array.isArray(value.gaps)&&value.gaps.length===0?"available":"unknown"))
    return invalid(["financial coverage v3 summary is inconsistent"]);
  return {ok:true};
}
