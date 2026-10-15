import type { FactMetadata } from "./factMetadata.js";
import { validateFactMetadataInto } from "./factMetadata.js";
import { validateDecisionQuantEvidenceChronology } from "./decisionQuantEvidenceChronology.js";
import {
  validateQuantDecisionEvidenceRefinementStructure,
  type QuantDecisionEvidenceRefinement
} from "./quantDecisionEvidenceContract.js";
import {
  candidateDiscoveryUniverseIsValid,
  type CandidateDiscoveryUniverse
} from "./marketDiscovery.js";

export const DECISION_QUANT_EVIDENCE_STATUSES = [
  "available",
  "missing",
  "stale",
  "malformed",
  "conflict",
  "unavailable",
  "unauthorized"
] as const;

export type DecisionQuantEvidenceStatus = (typeof DECISION_QUANT_EVIDENCE_STATUSES)[number];

export interface DecisionQuantEvidenceIdentities {
  frozenSnapshot: {
    snapshotId: string;
    snapshotHash: string;
    dataHash: string;
    sourceClassification: "fixture" | "real" | "historical" | "research_only";
  };
  baselineExperimentIdentity: string;
  splitIds: string[];
  shadowPortfolioIdentity: string;
  shadowPortfolioId: string;
  generatedAt: string;
  hkConnectUniverse?: CandidateDiscoveryUniverse;
}

/** Display-only projection of the accepted manifest. Order and disposition are frozen. */
export interface QuantExperimentComparison {
  snapshotId: string;
  dataHash: string;
  feePolicySha256: string;
  dividendCashPolicySha256: string;
  observationStartDate: string;
  observationEndDate: string;
  registryId: string;
  selectionPolicy: "baseline_fixed_before_diagnostics_no_final_test";
  selectionWindow: { start: string; end: string };
  experiments: Array<{
    id: string;
    disposition: "selected" | "rejected";
    reason: string;
    signal: {
      name: string;
      buyWhenPreviousCloseReturnLte: number;
      sellWhenPreviousCloseReturnGte: number;
    };
    finalTestUsedForSelection: false;
    metrics: {
      totalReturn: number;
      maxDrawdown: number;
      totalFees: number;
      turnoverOneWay: number;
      tradeCount: number;
      closedRoundTripCount: number;
    };
  }>;
  benchmark: {
    evidenceId: string;
    symbol: "HK.800000";
    name: string;
    sourceSha256: string;
    seriesHash: string;
    calculationPolicy: "close_to_close_hsi_comparison_research_only";
    periods: Array<{
      id: "train" | "validation" | "final_test" | "full_period";
      start: string;
      end: string;
      simulatedStrategyTotalReturn: number;
      benchmarkTotalReturn: number;
      difference: number;
      usedForParameterSelection: false;
    }>;
  };
  returnBasis: "strategy_net_fees_includes_cash_dividends_vs_hsi_price_only_non_equivalent";
  preservesSourceOrder: true;
  ranking: false;
  recommendation: false;
}

export interface DecisionQuantEvidence {
  status: DecisionQuantEvidenceStatus;
  metadata: FactMetadata;
  identities: DecisionQuantEvidenceIdentities | null;
  sampleBoundary: {
    universe: string[];
    sourceClassification: "fixture" | "real" | "historical" | "research_only" | "unavailable";
    finalTestPolicy: "locked_report_only_no_tuning" | "unavailable";
    limitation: string;
  };
  limitations: string[];
  authority: {
    researchOnly: true;
    advisoryOnly: true;
    changesCandidateOrdering: false;
    changesMembershipState: false;
    changesHumanReviewResult: false;
    mutatesLocalRecord: false;
    officialReviewFact: false;
    officialPortfolioFact: false;
    brokerWrite: false;
    recommendation: false;
    ranking: false;
    score: false;
    allocation: false;
    sizing: false;
    targetPrice: false;
    buySellHold: false;
    orderTradeFillAuthority: false;
    cashFeePositionMutation: false;
  };
  decisionEvidence?: QuantDecisionEvidenceRefinement;
  comparison?: QuantExperimentComparison;
  message: string;
}

export function validateDecisionQuantEvidenceInto(value: unknown, requestedSymbol: unknown, errors: string[], availableBy?: unknown): void {
  if (!isRecord(value)) {
    errors.push("quantEvidence must be an object");
    return;
  }
  if (!DECISION_QUANT_EVIDENCE_STATUSES.includes(value.status as DecisionQuantEvidenceStatus)) {
    errors.push("quantEvidence.status is invalid");
  }
  validateFactMetadataInto(value.metadata, "quantEvidence.metadata", errors);
  if (isRecord(value.metadata)) {
    if (value.metadata.provenance !== "quant_evidence") errors.push("quantEvidence.metadata.provenance must be quant_evidence");
    if (value.metadata.authority !== "quant_evidence") errors.push("quantEvidence.metadata.authority must be quant_evidence");
    if (value.status === "available" && !["fresh", "historical"].includes(String(value.metadata.freshness))) errors.push("quantEvidence.metadata.freshness must be fresh or historical when available");
    if (value.status === "stale" && value.metadata.freshness !== "stale") errors.push("quantEvidence.metadata.freshness must be stale when quantEvidence.status is stale");
    if (value.status === "missing" && value.metadata.freshness !== "missing") errors.push("quantEvidence.metadata.freshness must be missing when quantEvidence.status is missing");
    if (value.status === "conflict" && value.metadata.freshness !== "conflict") errors.push("quantEvidence.metadata.freshness must be conflict when quantEvidence.status is conflict");
    if ((value.status === "malformed" || value.status === "unavailable" || value.status === "unauthorized") && value.metadata.freshness === "fresh") errors.push("quantEvidence.metadata.freshness must not be fresh when quant evidence is fail-closed");
  }
  if (value.status === "available") {
    validateQuantIdentities(value.identities, errors);
  } else if (value.identities !== null) {
    errors.push("quantEvidence.identities must be null unless status is available");
  }
  validateQuantSampleBoundary(value.sampleBoundary, errors);
  validateAvailableQuantUniverse(value, requestedSymbol, errors);
  if (!Array.isArray(value.limitations) || value.limitations.length === 0 || !value.limitations.every((item) => typeof item === "string" && item.trim().length > 0)) {
    errors.push("quantEvidence.limitations must be non-empty strings");
  }
  validateQuantAuthority(value.authority, errors);
  validateQuantDecisionRefinement(value, requestedSymbol, errors);
  validateQuantExperimentComparisonInto(value.comparison, value, errors);
  validateDecisionQuantEvidenceChronology(value, availableBy, errors);
  if (typeof value.message !== "string" || value.message.trim().length === 0) {
    errors.push("quantEvidence.message must be a non-empty string");
  }
}

export function validateQuantExperimentComparisonInto(
  value: unknown,
  outer: Record<string, unknown>,
  errors: string[]
): void {
  if (value === undefined) return; // Older accepted manifests remain readable without a comparison.
  const refinement = isRecord(outer.decisionEvidence) ? outer.decisionEvidence : null;
  const source = isRecord(refinement?.source) ? refinement.source : null;
  const identities = isRecord(outer.identities) ? outer.identities : null;
  const frozen = isRecord(identities?.frozenSnapshot) ? identities.frozenSnapshot : null;
  if (outer.status !== "available" || refinement?.status !== "available" || !source || !frozen || !isRecord(value)) {
    errors.push("quantEvidence.comparison requires available bound quant evidence");
    return;
  }
  validateComparisonBasis(value, source, frozen, errors);
  const samples = Array.isArray(refinement.samples) ? refinement.samples.filter(isRecord) : [];
  validateComparisonSelection(value, source, samples, errors);
  validateComparisonExperiments(value.experiments, refinement, errors);
  validateComparisonBenchmark(value.benchmark, refinement, source, samples, errors);
}

function validateComparisonBasis(
  value: Record<string, unknown>,
  source: Record<string, unknown>,
  frozen: Record<string, unknown>,
  errors: string[]
): void {
  exactComparisonKeys(value, ["snapshotId", "dataHash", "feePolicySha256", "dividendCashPolicySha256",
    "observationStartDate", "observationEndDate", "registryId", "selectionPolicy", "selectionWindow",
    "experiments", "benchmark", "returnBasis", "preservesSourceOrder", "ranking", "recommendation"], errors);
  if (value.snapshotId !== frozen.snapshotId || value.dataHash !== frozen.dataHash
    || value.observationStartDate !== source.observationStartDate
    || value.observationEndDate !== source.observationEndDate
    || !comparisonSha(value.feePolicySha256) || !comparisonSha(value.dividendCashPolicySha256)) {
    errors.push("quantEvidence.comparison data, fee, dividend, or date basis is unbound");
  }
}

function validateComparisonSelection(
  value: Record<string, unknown>,
  source: Record<string, unknown>,
  samples: Record<string, unknown>[],
  errors: string[]
): void {
  if (typeof value.registryId !== "string" || !/^quant-parameter-search:[a-f0-9]{64}$/.test(value.registryId)
    || value.selectionPolicy !== "baseline_fixed_before_diagnostics_no_final_test"
    || value.returnBasis !== "strategy_net_fees_includes_cash_dividends_vs_hsi_price_only_non_equivalent"
    || value.preservesSourceOrder !== true || value.ranking !== false || value.recommendation !== false) {
    errors.push("quantEvidence.comparison selection or interpretation boundary is invalid");
  }
  const validation = samples.find((sample) => sample.id === "validation");
  if (!isRecord(value.selectionWindow) || value.selectionWindow.start !== source.observationStartDate
    || value.selectionWindow.end !== validation?.end) {
    errors.push("quantEvidence.comparison experiments must share the original train-through-validation window");
  }
}

function validateComparisonExperiments(
  raw: unknown,
  refinement: Record<string, unknown>,
  errors: string[]
): void {
  const experiments = Array.isArray(raw) ? raw.filter(isRecord) : [];
  if (!Array.isArray(raw) || experiments.length !== raw.length
    || experiments.length < 2 || experiments.length > 20
    || experiments.filter((item) => item.disposition === "selected").length !== 1
    || new Set(experiments.map((item) => item.id)).size !== experiments.length) {
    errors.push("quantEvidence.comparison must preserve all unique selected and rejected experiments");
  }
  experiments.forEach((item) => validateComparisonExperiment(item, errors));
  const rejectedIds = experiments.filter((item) => item.disposition === "rejected").map((item) => item.id);
  const robustness = isRecord(refinement.robustness) ? refinement.robustness : null;
  const failed = isRecord(robustness?.failedExperiments) ? robustness.failedExperiments : null;
  if (!failed || !Array.isArray(failed.experimentIds)
    || rejectedIds.join("|") !== failed.experimentIds.join("|")) {
    errors.push("quantEvidence.comparison rejected experiments must match the frozen failure registry");
  }
}

function validateComparisonExperiment(item: Record<string, unknown>, errors: string[]): void {
  exactComparisonKeys(item, ["id", "disposition", "reason", "signal", "finalTestUsedForSelection", "metrics"], errors);
  if (typeof item.id !== "string" || !item.id.trim() || !["selected", "rejected"].includes(String(item.disposition))
    || typeof item.reason !== "string" || !item.reason.trim() || item.finalTestUsedForSelection !== false) {
    errors.push("quantEvidence.comparison experiment identity, disposition, or reason is invalid");
  }
  validateComparisonSignal(item.signal, errors);
  validateComparisonMetrics(item.metrics, errors);
}

function validateComparisonSignal(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("quantEvidence.comparison signal is missing");
    return;
  }
  exactComparisonKeys(value, ["name", "buyWhenPreviousCloseReturnLte", "sellWhenPreviousCloseReturnGte"], errors);
  if (typeof value.name !== "string" || !value.name.trim()
    || !comparisonNumber(value.buyWhenPreviousCloseReturnLte, -1, 0)
    || !comparisonNumber(value.sellWhenPreviousCloseReturnGte, 0, 1)) {
    errors.push("quantEvidence.comparison signal parameters are invalid");
  }
}

function validateComparisonMetrics(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("quantEvidence.comparison experiment metrics are missing");
    return;
  }
  exactComparisonKeys(value, ["totalReturn", "maxDrawdown", "totalFees", "turnoverOneWay", "tradeCount", "closedRoundTripCount"], errors);
  if (!comparisonNumber(value.totalReturn, -1, 100)
    || !comparisonNumber(value.maxDrawdown, -1, 0)
    || !comparisonNumber(value.totalFees, 0, 1_000_000_000)
    || !comparisonNumber(value.turnoverOneWay, 0, 1_000_000)
    || !comparisonInteger(value.tradeCount)
    || !comparisonInteger(value.closedRoundTripCount)
    || Number(value.closedRoundTripCount) * 2 > Number(value.tradeCount)
    || Number(value.tradeCount) > 0 && Number(value.totalFees) <= 0) {
    errors.push("quantEvidence.comparison experiment metrics are invalid");
  }
}

function validateComparisonBenchmark(
  raw: unknown,
  refinement: Record<string, unknown>,
  source: Record<string, unknown>,
  samples: Record<string, unknown>[],
  errors: string[]
): void {
  if (!isRecord(raw)) {
    errors.push("quantEvidence.comparison benchmark is missing");
    return;
  }
  exactComparisonKeys(raw, ["evidenceId", "symbol", "name", "sourceSha256", "seriesHash", "calculationPolicy", "periods"], errors);
  const formal = isRecord(refinement.formalEvidence) ? refinement.formalEvidence : null;
  const checks = Array.isArray(formal?.checks) ? formal.checks.filter(isRecord) : [];
  const benchmarkCheck = checks.find((item) => item.id === "benchmark");
  if (typeof raw.evidenceId !== "string" || !/^quant-benchmark:[a-f0-9]{64}$/.test(raw.evidenceId)
    || raw.evidenceId !== benchmarkCheck?.identity || raw.symbol !== "HK.800000"
    || typeof raw.name !== "string" || !raw.name.trim()
    || !comparisonSha(raw.sourceSha256) || !comparisonSha(raw.seriesHash)
    || raw.calculationPolicy !== "close_to_close_hsi_comparison_research_only") {
    errors.push("quantEvidence.comparison benchmark source is unbound");
  }
  const periods = Array.isArray(raw.periods) ? raw.periods.filter(isRecord) : [];
  if (!Array.isArray(raw.periods) || periods.length !== 4 || periods.length !== raw.periods.length
    || periods.map((item) => item.id).join("|") !== "train|validation|final_test|full_period") {
    errors.push("quantEvidence.comparison benchmark periods must preserve source order");
    return;
  }
  periods.forEach((period, index) => validateComparisonPeriod(period, index, source, samples, errors));
}

function validateComparisonPeriod(
  period: Record<string, unknown>,
  index: number,
  source: Record<string, unknown>,
  samples: Record<string, unknown>[],
  errors: string[]
): void {
  exactComparisonKeys(period, ["id", "start", "end", "simulatedStrategyTotalReturn", "benchmarkTotalReturn", "difference", "usedForParameterSelection"], errors);
  const expected = index === 3 ? { start: source.observationStartDate, end: source.observationEndDate } : samples[index];
  const metrics = index === 3 ? null : isRecord(samples[index]?.metrics) ? samples[index].metrics as Record<string, unknown> : null;
  if (period.start !== expected?.start || period.end !== expected?.end
    || period.usedForParameterSelection !== false
    || !comparisonNumber(period.simulatedStrategyTotalReturn, -1, 100)
    || !comparisonNumber(period.benchmarkTotalReturn, -1, 100)
    || !comparisonNumber(period.difference, -101, 101)
    || Math.abs(Number(period.simulatedStrategyTotalReturn) - Number(period.benchmarkTotalReturn) - Number(period.difference)) > 1e-7
    || metrics && period.simulatedStrategyTotalReturn !== metrics.simulatedTotalReturn) {
    errors.push("quantEvidence.comparison HSI period is not aligned with the same dated strategy sample");
  }
}

function exactComparisonKeys(value: Record<string, unknown>, expected: string[], errors: string[]): void {
  if (Object.keys(value).sort().join("|") !== [...expected].sort().join("|")) {
    errors.push("quantEvidence.comparison contains missing or unexpected fields");
  }
}
function comparisonSha(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function comparisonNumber(value: unknown, lower: number, upper: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= lower && value <= upper;
}
function comparisonInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
}

function validateAvailableQuantUniverse(
  value: Record<string, unknown>,
  requestedSymbol: unknown,
  errors: string[]
): void {
  if (value.status !== "available" || typeof requestedSymbol !== "string") return;
  if (!isRecord(value.sampleBoundary)
    || !Array.isArray(value.sampleBoundary.universe)
    || !value.sampleBoundary.universe.includes(requestedSymbol)) {
    errors.push("quantEvidence.sampleBoundary.universe must include requestedSymbol when available");
  }
}

function validateQuantDecisionRefinement(
  value: Record<string, unknown>,
  requestedSymbol: unknown,
  errors: string[]
): void {
  if (value.decisionEvidence === undefined) return;
  const validation = validateQuantDecisionEvidenceRefinementStructure(value.decisionEvidence);
  if (!validation.ok) {
    errors.push(...validation.errors.map((error) => `quantEvidence.decisionEvidence.${error}`));
    return;
  }
  const refinement = validation.value;
  if (value.status !== "available" && refinement.status === "available") {
    errors.push("quantEvidence.decisionEvidence cannot be available when quantEvidence is fail-closed");
    return;
  }
  if (refinement.status !== "available") return;
  if (refinement.symbol !== requestedSymbol) errors.push("quantEvidence.decisionEvidence symbol must match requestedSymbol");
  if (!isRecord(value.identities)) {
    errors.push("quantEvidence.decisionEvidence requires available outer identities");
    return;
  }
  const frozen = isRecord(value.identities.frozenSnapshot) ? value.identities.frozenSnapshot : null;
  const source = refinement.source;
  if (!frozen || !source
    || source.snapshotId !== frozen.snapshotId
    || source.snapshotHash !== frozen.snapshotHash
    || source.dataHash !== frozen.dataHash
    || source.sourceClassification !== frozen.sourceClassification
    || source.baselineExperimentIdentity !== value.identities.baselineExperimentIdentity
    || source.shadowPortfolioIdentity !== value.identities.shadowPortfolioIdentity) {
    errors.push("quantEvidence.decisionEvidence source identities must match outer quant identities");
  }
  if (!Array.isArray(value.identities.splitIds)
    || refinement.samples.map((sample) => sample.id).join("|") !== value.identities.splitIds.join("|")) {
    errors.push("quantEvidence.decisionEvidence sample identities must match outer split identities");
  }
  if (!isRecord(value.sampleBoundary)
    || !Array.isArray(value.sampleBoundary.universe)
    || !value.sampleBoundary.universe.includes(refinement.symbol)) {
    errors.push("quantEvidence.decisionEvidence symbol must be present in the outer quant universe");
  }
}

function validateQuantIdentities(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("quantEvidence.identities must be an object when available");
    return;
  }
  if (!isRecord(value.frozenSnapshot)) {
    errors.push("quantEvidence.identities.frozenSnapshot must be an object");
  } else {
    for (const field of ["snapshotId", "snapshotHash", "dataHash"] as const) {
      requireNonEmptyString(value.frozenSnapshot[field], `quantEvidence.identities.frozenSnapshot.${field}`, errors);
    }
    if (!["fixture", "real", "historical", "research_only"].includes(String(value.frozenSnapshot.sourceClassification))) {
      errors.push("quantEvidence.identities.frozenSnapshot.sourceClassification is invalid");
    }
  }
  for (const field of ["baselineExperimentIdentity", "shadowPortfolioIdentity", "shadowPortfolioId", "generatedAt"] as const) {
    requireNonEmptyString(value[field], `quantEvidence.identities.${field}`, errors);
  }
  if (typeof value.generatedAt === "string" && !Number.isFinite(Date.parse(value.generatedAt))) {
    errors.push("quantEvidence.identities.generatedAt must be a valid date-time");
  }
  if (!Array.isArray(value.splitIds) || value.splitIds.length === 0 || !value.splitIds.every((item) => typeof item === "string" && item.trim().length > 0)) {
    errors.push("quantEvidence.identities.splitIds must be non-empty strings");
  }
  if (value.hkConnectUniverse !== undefined && !candidateDiscoveryUniverseIsValid(value.hkConnectUniverse)) {
    errors.push("quantEvidence.identities.hkConnectUniverse is invalid");
  }
}

function validateQuantSampleBoundary(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("quantEvidence.sampleBoundary must be an object");
    return;
  }
  if (!Array.isArray(value.universe) || !value.universe.every((item) => typeof item === "string" && /^HK\.[0-9]{5}$/.test(item))) {
    errors.push("quantEvidence.sampleBoundary.universe must be canonical Hong Kong symbols");
  }
  if (!["fixture", "real", "historical", "research_only", "unavailable"].includes(String(value.sourceClassification))) {
    errors.push("quantEvidence.sampleBoundary.sourceClassification is invalid");
  }
  if (!["locked_report_only_no_tuning", "unavailable"].includes(String(value.finalTestPolicy))) {
    errors.push("quantEvidence.sampleBoundary.finalTestPolicy is invalid");
  }
  if (typeof value.limitation !== "string" || value.limitation.trim().length === 0) {
    errors.push("quantEvidence.sampleBoundary.limitation must be a non-empty string");
  }
}

function validateQuantAuthority(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("quantEvidence.authority must be an object");
    return;
  }
  if (value.researchOnly !== true) errors.push("quantEvidence.authority.researchOnly must be true");
  if (value.advisoryOnly !== true) errors.push("quantEvidence.authority.advisoryOnly must be true");
  for (const field of [
    "changesCandidateOrdering",
    "changesMembershipState",
    "changesHumanReviewResult",
    "mutatesLocalRecord",
    "officialReviewFact",
    "officialPortfolioFact",
    "brokerWrite",
    "recommendation",
    "ranking",
    "score",
    "allocation",
    "sizing",
    "targetPrice",
    "buySellHold",
    "orderTradeFillAuthority",
    "cashFeePositionMutation"
  ] as const) {
    if (value[field] !== false) errors.push(`quantEvidence.authority.${field} must be false`);
  }
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${field} must be a non-empty string`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
