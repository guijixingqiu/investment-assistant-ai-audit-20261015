import { canonicalJson } from "./decisionContextBrowser.js";
import { sha256Hex } from "./sha256.js";
import type { FutuFinancialHistoryValue } from "./researchFutuFinancialStatement.js";
import { type FcffProviderReference, fcffProviderReferenceErrors } from "./researchValuationFcff.js";
import type { ResearchOperatingKpi } from "./researchContext.js";

export const PROVIDER_OPERATING_REFERENCE_VERSION = "2026-10-11.provider-operating-reference.v1";
export const PROVIDER_OPERATING_METRICS = [
  "revenue", "profit_attributable_to_owners", "operating_cash_flow", "total_assets", "total_liabilities"
] as const;

export interface ProviderOperatingPeriod {
  financialType: "ANNUAL" | "Q6";
  periodEnd: string;
  captureId: string | null;
  sourceFingerprint: string | null;
  values: FutuFinancialHistoryValue[];
  missingMetrics: Array<typeof PROVIDER_OPERATING_METRICS[number]>;
  materialMatches: Array<{ id: string; revision: number; contentFingerprint: string; sourceVersion: string }>;
  limitations: string[];
  fcffBalanceReference?: FcffProviderReference;
}

export interface ProviderOperatingOwnerContext {
  contextId: string;
  contextFingerprint: string;
  cutoffAt: string;
  kpis: ResearchOperatingKpi[];
  ownerAssumptions: Array<{
    scenario: "bear" | "base" | "bull"; metric: string; value: number;
    unit: string; note: string; periodEnd: string;
  }>;
  counterEvidence: Array<{
    testId: string; conditionText: string; metrics: string[]; status: "DRAFT" | "ACTIVE";
  }>;
  questions: Array<{ questionId: string; question: string; targetMetric: string }>;
  unknowns: string[];
}

/** This is a third-party read-only reference, never an OperatingFact or verified issuer fact. */
export interface ResearchProviderOperatingReference {
  schemaVersion: typeof PROVIDER_OPERATING_REFERENCE_VERSION;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  sourceClassification: "futu_opend_financial_statement_provider";
  status: "available" | "partial" | "unavailable";
  periods: ProviderOperatingPeriod[];
  gaps: string[];
  captureLimitations?: string[];
  ownerContext: ProviderOperatingOwnerContext | null;
  issuerOriginalVerification: "UNKNOWN";
  restatementComparability: "UNKNOWN";
  latestRequiredFiling: "UNKNOWN";
}

export function providerOperatingPeriodFingerprint(values: FutuFinancialHistoryValue[]): string {
  return sha256Hex(canonicalJson([...values].sort((left, right) => left.metric.localeCompare(right.metric))));
}

const id = (value: unknown) => typeof value === "string" && /^[1-9]\d*$/.test(value);
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const date = (value: unknown) => typeof value === "string" && /^20\d{2}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value));
const instant = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const bounded = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

// eslint-disable-next-line complexity -- keep every period, source, amount and Owner-context boundary in one validation pass.
export function validateResearchProviderOperatingReference(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["provider operating reference must be an object"] };
  if (value.schemaVersion !== PROVIDER_OPERATING_REFERENCE_VERSION || !id(value.membershipId)
    || !Number.isSafeInteger(value.membershipVersion) || Number(value.membershipVersion) <= 0
    || typeof value.symbol !== "string" || !/^HK\.\d{5}$/.test(value.symbol)
    || value.sourceClassification !== "futu_opend_financial_statement_provider"
    || !["available", "partial", "unavailable"].includes(String(value.status))
    || value.issuerOriginalVerification !== "UNKNOWN" || value.restatementComparability !== "UNKNOWN"
    || value.latestRequiredFiling !== "UNKNOWN") errors.push("reference identity or source class is invalid");
  if (!Array.isArray(value.gaps) || value.gaps.length > 30 || !value.gaps.every(item => bounded(item, 1000))) errors.push("reference gaps are invalid");
  if (value.captureLimitations !== undefined && (!Array.isArray(value.captureLimitations)
    || value.captureLimitations.length > 30
    || !value.captureLimitations.every(item => bounded(item, 1000)))) errors.push("reference capture limitations are invalid");
  if (!Array.isArray(value.periods) || value.periods.length > 7) errors.push("reference periods are invalid");
  else {
    const identities = new Set<string>();
    for (const period of value.periods) {
      if (!record(period) || !["ANNUAL", "Q6"].includes(String(period.financialType)) || !date(period.periodEnd)) {
        errors.push("reference period identity is invalid"); continue;
      }
      const key = `${period.financialType}:${period.periodEnd}`;
      if (identities.has(key)) errors.push("reference period identities repeat");
      identities.add(key);
      if (!Array.isArray(period.values) || period.values.length > 5) { errors.push("reference values are invalid"); continue; }
      const values = period.values as unknown[];
      const metrics = new Set(values.map(item => record(item) ? item.metric : null));
      const validValues = metrics.size === values.length && values.every(item => record(item)
        && PROVIDER_OPERATING_METRICS.includes(item.metric as typeof PROVIDER_OPERATING_METRICS[number])
        && item.financialType === period.financialType && item.periodEnd === period.periodEnd
        && typeof item.rawValue === "string" && /^-?\d+(?:\.\d+)?$/.test(item.rawValue)
        && typeof item.currencyCode === "string" && /^[A-Z]{3}$/.test(item.currencyCode)
        && record(item.source) && id(item.source.captureId) && id(item.source.pageId)
        && hash(item.source.rawSha256) && hash(item.source.reportSha256)
        && instant(item.source.capturedAt) && item.source.captureId === period.captureId);
      if (!validValues)
        errors.push("reference value provenance is invalid");
      const missing = PROVIDER_OPERATING_METRICS.filter(metric => !metrics.has(metric));
      if (!Array.isArray(period.missingMetrics) || canonicalJson(period.missingMetrics) !== canonicalJson(missing))
        errors.push("reference missing metrics do not match values");
      if (values.length ? !validValues || !id(period.captureId)
        || period.sourceFingerprint !== providerOperatingPeriodFingerprint(values as FutuFinancialHistoryValue[])
        : period.sourceFingerprint !== null) errors.push("reference period fingerprint is invalid");
      if (!Array.isArray(period.materialMatches) || period.materialMatches.length > 20
        || period.materialMatches.some(item => !record(item) || !id(item.id)
          || typeof item.revision !== "number" || !Number.isSafeInteger(item.revision)
          || item.revision < 1 || !hash(item.contentFingerprint) || !bounded(item.sourceVersion, 200))
        || !Array.isArray(period.limitations) || period.limitations.length > 10
        || !period.limitations.every(item => bounded(item, 1000))) errors.push("reference material matches or limitations are invalid");
      const fcffBalance = period.fcffBalanceReference as FcffProviderReference | undefined;
      if (fcffBalance !== undefined
        && (period.financialType !== "ANNUAL"
          || fcffProviderReferenceErrors(fcffBalance).length
          || fcffBalance.balanceReferenceDate !== period.periodEnd
          || fcffBalance.financialCaptureId !== period.captureId
          || fcffBalance.shareReferenceDate !== null
          || !Array.isArray(period.materialMatches)
          || !period.materialMatches.some(item => item.id === fcffBalance.materialId
            && item.revision === fcffBalance.materialRevision
            && item.contentFingerprint === fcffBalance.materialFingerprint)))
        errors.push("provider FCFF balance reference is invalid");
    }
  }
  if (value.ownerContext !== null) {
    const context = value.ownerContext;
    if (!record(context) || !id(context.contextId) || !hash(context.contextFingerprint) || !instant(context.cutoffAt)
      || !Array.isArray(context.kpis) || context.kpis.length > 100
      || context.kpis.some(item => !record(item) || item.selectedSymbol !== value.symbol || !id(item.id)
        || !date(item.periodStart) || !date(item.periodEnd) || !bounded(item.metric, 200)
        || !instant(item.validUntil))
      || !Array.isArray(context.ownerAssumptions) || context.ownerAssumptions.length > 30
      || context.ownerAssumptions.some(item => !record(item) || !["bear", "base", "bull"].includes(String(item.scenario))
        || !bounded(item.metric, 100) || !Number.isFinite(item.value) || !bounded(item.unit, 100)
        || !date(item.periodEnd))
      || !Array.isArray(context.counterEvidence) || context.counterEvidence.length > 20
      || context.counterEvidence.some(item => !record(item) || !bounded(item.testId, 200) || !bounded(item.conditionText, 4000)
        || !Array.isArray(item.metrics) || !["DRAFT", "ACTIVE"].includes(String(item.status)))
      || !Array.isArray(context.questions) || context.questions.length > 30
      || context.questions.some(item => !record(item) || !bounded(item.questionId, 200) || !bounded(item.question, 2000)
        || !bounded(item.targetMetric, 100))
      || !Array.isArray(context.unknowns) || context.unknowns.length > 100
      || !context.unknowns.every(item => bounded(item, 1000))) errors.push("reference Owner context is invalid");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
