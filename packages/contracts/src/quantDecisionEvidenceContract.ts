export const QUANT_DECISION_EVIDENCE_REFINEMENT_SCHEMA_VERSION = "2026-07-16.quant-decision-evidence-refinement.v1";
export const QUANT_DECISION_EVIDENCE_REFINEMENT_STATUSES = ["available", "not_captured", "unavailable"] as const;
export type QuantDecisionEvidenceRefinementStatus = (typeof QUANT_DECISION_EVIDENCE_REFINEMENT_STATUSES)[number];
export const QUANT_FORMAL_EVIDENCE_CHECK_IDS = [
  "immutable_dataset",
  "hong_kong_investable_universe",
  "benchmark",
  "raw_corporate_actions",
  "t_plus_one",
  "board_lot",
  "non_zero_costs",
  "suspension_zero_volume_missing_price",
  "cash_position_accounting",
  "out_of_sample",
  "parameter_search",
  "failed_experiments",
  "trade_stock_month_concentration"
] as const;
export type QuantFormalEvidenceCheckId = (typeof QUANT_FORMAL_EVIDENCE_CHECK_IDS)[number];
export interface QuantFormalEvidence {
  candidateResearchRule: {
    ruleVersion: string;
    universeVersion: string;
    cutoff: string;
    symbols: string[];
    eligibilityEvidenceStatus: "available" | "unknown";
    manualResearchOnlyWhenEligibilityUnknown: true;
    preservesSourceOrder: true;
    ranking: false;
    recommendation: false;
    limitations: string[];
  };
  checks: Array<{
    id: QuantFormalEvidenceCheckId;
    status: "available" | "unknown";
    identity: string | null;
    limitation: string;
  }>;
}
export interface QuantDecisionEvidenceSampleMetrics {
  simulatedTotalReturn: number;
  simulatedAnnualizedReturn?: number;
  simulatedMaxDrawdown: number;
  simulatedSharpe: number;
  simulatedTradeCount: number;
  simulatedClosedRoundTripCount?: number;
  simulatedWinRate?: number;
  simulatedTotalFees: number;
  simulatedTurnoverOneWay: number;
  simulatedAverageGrossExposure: number;
  accountingAuditStatus: "passed";
}
export interface QuantDecisionEvidenceSample {
  id: "train" | "validation" | "final_test";
  role: "retrospective_parameter_registration_and_sanity" | "retrospective_validation" | "locked_report_only";
  start: string;
  end: string;
  parameterSelectionAllowed: boolean;
  finalTestLocked: boolean;
  metrics: QuantDecisionEvidenceSampleMetrics;
}
export interface QuantDecisionEvidenceRefinement {
  schemaVersion: typeof QUANT_DECISION_EVIDENCE_REFINEMENT_SCHEMA_VERSION;
  status: QuantDecisionEvidenceRefinementStatus;
  refinementId: string | null;
  symbol: string | null;
  source: {
    snapshotId: string;
    snapshotHash: string;
    dataHash: string;
    sourceClassification: "fixture" | "real" | "historical" | "research_only";
    adjustment: "none" | "forward" | "backward";
    dataCutoff: string;
    observationStartDate: string;
    observationEndDate: string;
    baselineExperimentIdentity: string;
    shadowPortfolioIdentity: string;
  } | null;
  samples: QuantDecisionEvidenceSample[];
  execution: {
    signalTiming: "after_close_t";
    earliestExecution: "next_trading_day_open";
    allowsSameBarExecution: false;
    allowsMargin: false;
    boardLot: number;
    feeCurrency: "HKD";
    nonZeroCosts: true;
    suspensionHandling: "reject_execution";
    zeroVolumeHandling: "reject_execution";
    missingPriceHandling: "reject_execution";
  } | null;
  robustness: {
    registrationTiming: "retrospective_after_snapshot";
    preregistered: false;
    prospectiveHoldoutClaim: false;
    finalTestUsedForParameterSelection: false;
    finalTestUsedForAcceptanceThresholdFitting: false;
    allSplitAccountingAuditsPassed: true;
    failedExperiments: {
      status: "registered" | "not_captured";
      experimentIds: string[];
      limitation: string;
    };
  } | null;
  formalEvidence?: QuantFormalEvidence;
  interpretation: "historical_simulation_only_no_predictive_or_recommendation_authority" | "not_captured_no_reconstruction" | "unavailable_no_research_interpretation";
  limitations: string[];
}
export type QuantDecisionEvidenceRefinementHashInput = Omit<QuantDecisionEvidenceRefinement, "refinementId">;

export function quantDecisionEvidenceRefinementHashInput(
  value: QuantDecisionEvidenceRefinement
): QuantDecisionEvidenceRefinementHashInput {
  const { refinementId: _refinementId, ...input } = value;
  return input;
}

export function canonicalQuantDecisionEvidenceJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function validateQuantDecisionEvidenceRefinementStructure(value: unknown): {
  ok: true;
  value: QuantDecisionEvidenceRefinement;
} | {
  ok: false;
  errors: string[];
} {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["quant decision evidence refinement must be an object"] };
  exactKeysWithOptional(value, [
    "schemaVersion", "status", "refinementId", "symbol", "source", "samples",
    "execution", "robustness", "formalEvidence", "interpretation", "limitations"
  ], ["formalEvidence"], "quant decision evidence refinement", errors);
  if (value.schemaVersion !== QUANT_DECISION_EVIDENCE_REFINEMENT_SCHEMA_VERSION) {
    errors.push(`quant decision evidence refinement schemaVersion must be ${QUANT_DECISION_EVIDENCE_REFINEMENT_SCHEMA_VERSION}`);
  }
  if (!QUANT_DECISION_EVIDENCE_REFINEMENT_STATUSES.includes(value.status as QuantDecisionEvidenceRefinementStatus)) {
    errors.push("quant decision evidence refinement status is invalid");
  }
  boundedStrings(value.limitations, "quant decision evidence refinement limitations", 20, errors);
  if (value.status === "available") validateAvailable(value, errors);
  else validateUnavailable(value, errors);
  return errors.length === 0
    ? { ok: true, value: value as unknown as QuantDecisionEvidenceRefinement }
    : { ok: false, errors };
}

function validateAvailable(value: Record<string, unknown>, errors: string[]): void {
  if (typeof value.refinementId !== "string" || !/^quant-decision-evidence:[a-f0-9]{64}$/.test(value.refinementId)) {
    errors.push("available quant decision evidence refinementId must be a canonical SHA-256 identity");
  }
  if (typeof value.symbol !== "string" || !/^HK\.[0-9]{5}$/.test(value.symbol)) {
    errors.push("available quant decision evidence symbol must be canonical Hong Kong identity");
  }
  validateSource(value.source, errors);
  validateSamples(value.samples, errors);
  validateSourceSampleBoundary(value.source, value.samples, errors);
  validateExecution(value.execution, errors);
  validateRobustness(value.robustness, errors);
  if (value.formalEvidence !== undefined) validateFormalEvidence(value.formalEvidence, value.symbol, errors);
  if (value.interpretation !== "historical_simulation_only_no_predictive_or_recommendation_authority") {
    errors.push("available quant decision evidence interpretation must remain historical simulation only");
  }
}

function validateUnavailable(value: Record<string, unknown>, errors: string[]): void {
  if (value.refinementId !== null || value.symbol !== null || value.source !== null || value.execution !== null || value.robustness !== null
    || value.formalEvidence !== undefined) {
    errors.push("unavailable or not-captured quant decision evidence must not expose refinement facts");
  }
  if (!Array.isArray(value.samples) || value.samples.length !== 0) {
    errors.push("unavailable or not-captured quant decision evidence samples must be empty");
  }
  const expected = value.status === "not_captured"
    ? "not_captured_no_reconstruction"
    : "unavailable_no_research_interpretation";
  if (value.interpretation !== expected) {
    errors.push(`quant decision evidence interpretation must be ${expected}`);
  }
}

function validateFormalEvidence(value: unknown, symbol: unknown, errors: string[]): void {
  if (!isRecord(value) || !isRecord(value.candidateResearchRule) || !Array.isArray(value.checks)) {
    errors.push("quant formal evidence must contain a candidate research rule and checks");
    return;
  }
  exactKeys(value, ["candidateResearchRule", "checks"], "quant formal evidence", errors);
  const rule = value.candidateResearchRule;
  exactKeys(rule, [
    "ruleVersion", "universeVersion", "cutoff", "symbols", "eligibilityEvidenceStatus",
    "manualResearchOnlyWhenEligibilityUnknown", "preservesSourceOrder", "ranking",
    "recommendation", "limitations"
  ], "quant candidate research rule", errors);
  nonEmptyString(rule.ruleVersion, "quant candidate research rule version", errors);
  nonEmptyString(rule.universeVersion, "quant candidate research universe version", errors);
  dateTime(rule.cutoff, "quant candidate research cutoff", errors);
  if (!Array.isArray(rule.symbols) || rule.symbols.length === 0
    || rule.symbols.some((item) => typeof item !== "string" || !/^HK\.[0-9]{5}$/.test(item))
    || new Set(rule.symbols).size !== rule.symbols.length || !rule.symbols.includes(symbol)) {
    errors.push("quant candidate research symbols must be unique canonical Hong Kong identities including the requested symbol");
  }
  if (!new Set(["available", "unknown"]).has(String(rule.eligibilityEvidenceStatus))
    || rule.manualResearchOnlyWhenEligibilityUnknown !== true
    || rule.preservesSourceOrder !== true || rule.ranking !== false || rule.recommendation !== false) {
    errors.push("quant candidate research rule must remain transparent manual research without ranking or recommendation");
  }
  boundedStrings(rule.limitations, "quant candidate research limitations", 20, errors);
  if (value.checks.length !== QUANT_FORMAL_EVIDENCE_CHECK_IDS.length) {
    errors.push("quant formal evidence checks must cover every required completeness item exactly once");
    return;
  }
  value.checks.forEach((check, index) => {
    if (!isRecord(check)) {
      errors.push(`quant formal evidence checks[${index}] must be an object`);
      return;
    }
    exactKeys(check, ["id", "status", "identity", "limitation"], `quant formal evidence checks[${index}]`, errors);
    if (check.id !== QUANT_FORMAL_EVIDENCE_CHECK_IDS[index]) {
      errors.push("quant formal evidence checks must preserve the governed completeness order");
    }
    if (!new Set(["available", "unknown"]).has(String(check.status))) {
      errors.push(`quant formal evidence ${String(check.id)} status is invalid`);
    }
    if (check.status === "available") nonEmptyString(check.identity, `quant formal evidence ${String(check.id)} identity`, errors);
    else if (check.identity !== null) errors.push(`quant formal evidence ${String(check.id)} UNKNOWN must not expose an identity`);
    nonEmptyString(check.limitation, `quant formal evidence ${String(check.id)} limitation`, errors);
  });
}

function validateSource(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("available quant decision evidence source is required");
    return;
  }
  exactKeys(value, [
    "snapshotId", "snapshotHash", "dataHash", "sourceClassification", "adjustment",
    "dataCutoff", "observationStartDate", "observationEndDate",
    "baselineExperimentIdentity", "shadowPortfolioIdentity"
  ], "quant decision evidence source", errors);
  for (const key of ["snapshotId", "baselineExperimentIdentity", "shadowPortfolioIdentity"] as const) {
    nonEmptyString(value[key], `quant decision evidence source ${key}`, errors);
  }
  for (const key of ["snapshotHash", "dataHash"] as const) {
    if (typeof value[key] !== "string" || !/^[a-f0-9]{64}$/.test(value[key])) {
      errors.push(`quant decision evidence source ${key} must be a SHA-256 hash`);
    }
  }
  if (!new Set(["fixture", "real", "historical", "research_only"]).has(String(value.sourceClassification))) {
    errors.push("quant decision evidence source classification is invalid");
  }
  if (!new Set(["none", "forward", "backward"]).has(String(value.adjustment))) {
    errors.push("quant decision evidence source adjustment is invalid");
  }
  dateTime(value.dataCutoff, "quant decision evidence source dataCutoff", errors);
  dateOnly(value.observationStartDate, "quant decision evidence source observationStartDate", errors);
  dateOnly(value.observationEndDate, "quant decision evidence source observationEndDate", errors);
  if (typeof value.observationStartDate === "string" && typeof value.observationEndDate === "string" && value.observationStartDate > value.observationEndDate) {
    errors.push("quant decision evidence source observation date range is reversed");
  }
  if (typeof value.dataCutoff === "string" && typeof value.observationEndDate === "string"
    && value.dataCutoff.slice(0, 10) < value.observationEndDate) {
    errors.push("quant decision evidence source dataCutoff cannot precede the observation end date");
  }
}

function validateSamples(value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length !== 3) {
    errors.push("available quant decision evidence must contain train validation and final_test samples");
    return;
  }
  const expected = [
    ["train", "retrospective_parameter_registration_and_sanity", true, false],
    ["validation", "retrospective_validation", true, false],
    ["final_test", "locked_report_only", false, true]
  ] as const;
  let priorEnd: string | null = null;
  value.forEach((sample, index) => {
    if (!isRecord(sample)) {
      errors.push(`quant decision evidence samples[${index}] must be an object`);
      return;
    }
    exactKeys(sample, ["id", "role", "start", "end", "parameterSelectionAllowed", "finalTestLocked", "metrics"], `quant decision evidence samples[${index}]`, errors);
    const [id, role, selectionAllowed, locked] = expected[index];
    if (sample.id !== id || sample.role !== role || sample.parameterSelectionAllowed !== selectionAllowed || sample.finalTestLocked !== locked) {
      errors.push(`quant decision evidence samples[${index}] does not match the governed ${id} boundary`);
    }
    dateOnly(sample.start, `quant decision evidence samples[${index}].start`, errors);
    dateOnly(sample.end, `quant decision evidence samples[${index}].end`, errors);
    if (typeof sample.start === "string" && typeof sample.end === "string") {
      if (sample.start > sample.end) errors.push(`quant decision evidence samples[${index}] date range is reversed`);
      if (priorEnd !== null && sample.start <= priorEnd) errors.push("quant decision evidence sample windows must be ordered and non-overlapping");
      priorEnd = sample.end;
    }
    validateMetrics(sample.metrics, index, errors);
  });
}
function validateMetrics(value: unknown, index: number, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`quant decision evidence samples[${index}].metrics must be an object`);
    return;
  }
  exactKeysWithOptional(value, [
    "simulatedTotalReturn", "simulatedMaxDrawdown", "simulatedSharpe", "simulatedTradeCount",
    "simulatedTotalFees", "simulatedTurnoverOneWay", "simulatedAverageGrossExposure", "accountingAuditStatus",
    "simulatedAnnualizedReturn", "simulatedClosedRoundTripCount", "simulatedWinRate"
  ], ["simulatedAnnualizedReturn", "simulatedClosedRoundTripCount", "simulatedWinRate"], `quant decision evidence samples[${index}].metrics`, errors);
  boundedNumber(value.simulatedTotalReturn, -1, 100, `samples[${index}].metrics.simulatedTotalReturn`, errors);
  const performanceFields = [value.simulatedAnnualizedReturn, value.simulatedClosedRoundTripCount, value.simulatedWinRate];
  const performanceCount = performanceFields.filter((item) => item !== undefined).length;
  if (performanceCount !== 0 && performanceCount !== 3) errors.push(`samples[${index}].metrics annualized return, closed round trips, and win rate must be captured together`);
  else if (performanceCount === 3 && (typeof value.simulatedAnnualizedReturn !== "number" || !Number.isFinite(value.simulatedAnnualizedReturn) || value.simulatedAnnualizedReturn < -1 || value.simulatedAnnualizedReturn > 100 || !Number.isInteger(value.simulatedClosedRoundTripCount) || Number(value.simulatedClosedRoundTripCount) < 0 || Number(value.simulatedClosedRoundTripCount) * 2 > Number(value.simulatedTradeCount) || typeof value.simulatedWinRate !== "number" || !Number.isFinite(value.simulatedWinRate) || value.simulatedWinRate < 0 || value.simulatedWinRate > 1 || value.simulatedClosedRoundTripCount === 0 && value.simulatedWinRate !== 0)) errors.push(`samples[${index}].metrics annualized return, closed round trips, or win rate is invalid`);
  boundedNumber(value.simulatedMaxDrawdown, -1, 0, `samples[${index}].metrics.simulatedMaxDrawdown`, errors);
  boundedNumber(value.simulatedSharpe, -100, 100, `samples[${index}].metrics.simulatedSharpe`, errors);
  integer(value.simulatedTradeCount, 0, 1_000_000, `samples[${index}].metrics.simulatedTradeCount`, errors);
  boundedNumber(value.simulatedTotalFees, 0, 1_000_000_000, `samples[${index}].metrics.simulatedTotalFees`, errors);
  boundedNumber(value.simulatedTurnoverOneWay, 0, 1_000_000, `samples[${index}].metrics.simulatedTurnoverOneWay`, errors);
  boundedNumber(value.simulatedAverageGrossExposure, 0, 1, `samples[${index}].metrics.simulatedAverageGrossExposure`, errors);
  if (value.accountingAuditStatus !== "passed") errors.push(`samples[${index}].metrics.accountingAuditStatus must be passed`);
  if (typeof value.simulatedTradeCount === "number" && value.simulatedTradeCount > 0
    && (typeof value.simulatedTotalFees !== "number" || value.simulatedTotalFees <= 0)) {
    errors.push(`samples[${index}] with simulated trades must record non-zero fees`);
  }
}
function validateSourceSampleBoundary(source: unknown, samples: unknown, errors: string[]): void {
  if (!isRecord(source) || !Array.isArray(samples) || samples.length === 0) return;
  const firstSample = samples[0];
  const lastSample = samples[samples.length - 1];
  const first = isRecord(firstSample) ? firstSample.start : null;
  const last = isRecord(lastSample) ? lastSample.end : null;
  if (typeof source.observationStartDate === "string" && typeof first === "string"
    && first < source.observationStartDate) {
    errors.push("quant decision evidence samples cannot start before the source observation range");
  }
  if (typeof source.observationEndDate === "string" && typeof last === "string"
    && last > source.observationEndDate) {
    errors.push("quant decision evidence samples cannot end after the source observation range");
  }
}
function validateExecution(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("available quant decision evidence execution boundary is required");
    return;
  }
  exactKeys(value, [
    "signalTiming", "earliestExecution", "allowsSameBarExecution", "allowsMargin", "boardLot",
    "feeCurrency", "nonZeroCosts", "suspensionHandling", "zeroVolumeHandling", "missingPriceHandling"
  ], "quant decision evidence execution", errors);
  const expected: Record<string, unknown> = {
    signalTiming: "after_close_t",
    earliestExecution: "next_trading_day_open",
    allowsSameBarExecution: false,
    allowsMargin: false,
    feeCurrency: "HKD",
    nonZeroCosts: true,
    suspensionHandling: "reject_execution",
    zeroVolumeHandling: "reject_execution",
    missingPriceHandling: "reject_execution"
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) errors.push(`quant decision evidence execution ${key} must be ${String(expectedValue)}`);
  }
  integer(value.boardLot, 1, 1_000_000, "quant decision evidence execution boardLot", errors);
}

function validateRobustness(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("available quant decision evidence robustness boundary is required");
    return;
  }
  exactKeys(value, [
    "registrationTiming", "preregistered", "prospectiveHoldoutClaim",
    "finalTestUsedForParameterSelection", "finalTestUsedForAcceptanceThresholdFitting",
    "allSplitAccountingAuditsPassed", "failedExperiments"
  ], "quant decision evidence robustness", errors);
  const expected: Record<string, unknown> = {
    registrationTiming: "retrospective_after_snapshot",
    preregistered: false,
    prospectiveHoldoutClaim: false,
    finalTestUsedForParameterSelection: false,
    finalTestUsedForAcceptanceThresholdFitting: false,
    allSplitAccountingAuditsPassed: true
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) errors.push(`quant decision evidence robustness ${key} must be ${String(expectedValue)}`);
  }
  if (!isRecord(value.failedExperiments)) {
    errors.push("quant decision evidence robustness failedExperiments is required");
    return;
  }
  exactKeys(value.failedExperiments, ["status", "experimentIds", "limitation"], "quant decision evidence failedExperiments", errors);
  if (!new Set(["registered", "not_captured"]).has(String(value.failedExperiments.status))) {
    errors.push("quant decision evidence failedExperiments status is invalid");
  }
  boundedStrings(value.failedExperiments.experimentIds, "quant decision evidence failedExperiments experimentIds", 100, errors, true);
  nonEmptyString(value.failedExperiments.limitation, "quant decision evidence failedExperiments limitation", errors);
  if (Array.isArray(value.failedExperiments.experimentIds)) {
    if (new Set(value.failedExperiments.experimentIds).size !== value.failedExperiments.experimentIds.length) {
      errors.push("quant decision evidence failedExperiments experimentIds must be unique");
    }
    if (value.failedExperiments.status === "registered" && value.failedExperiments.experimentIds.length === 0) {
      errors.push("registered failed experiments require at least one experiment identity");
    }
    if (value.failedExperiments.status === "not_captured" && value.failedExperiments.experimentIds.length !== 0) {
      errors.push("not-captured failed experiments must not expose experiment identities");
    }
  }
}

function exactKeys(value: Record<string, unknown>, allowed: string[], label: string, errors: string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) errors.push(`${label} contains unsupported field ${key}`);
  for (const key of allowed) if (!(key in value)) errors.push(`${label} is missing field ${key}`);
}

function exactKeysWithOptional(value: Record<string, unknown>, allowed: string[], optional: string[], label: string, errors: string[]): void {
  const allowedSet = new Set(allowed);
  const optionalSet = new Set(optional);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) errors.push(`${label} contains unsupported field ${key}`);
  for (const key of allowed) if (!optionalSet.has(key) && !(key in value)) errors.push(`${label} is missing field ${key}`);
}

function boundedStrings(value: unknown, label: string, max: number, errors: string[], allowEmpty = false): void {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > max
    || !value.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 1_000)) {
    errors.push(`${label} must contain ${allowEmpty ? "zero or more" : "one or more"} bounded non-empty strings`);
  }
}

function nonEmptyString(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 1_000) errors.push(`${label} must be a bounded non-empty string`);
}

function dateTime(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    errors.push(`${label} must be a valid canonical UTC date-time`);
  }
}

function dateOnly(value: unknown, label: string, errors: string[]): void {
  const instant = typeof value === "string" ? `${value}T00:00:00.000Z` : "";
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(instant)) || new Date(instant).toISOString() !== instant) {
    errors.push(`${label} must be a valid YYYY-MM-DD date`);
  }
}

function boundedNumber(value: unknown, min: number, max: number, label: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) errors.push(`${label} is outside its bounded numeric range`);
}

function integer(value: unknown, min: number, max: number, label: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) errors.push(`${label} must be a bounded integer`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().flatMap((key) => {
    const child = (value as Record<string, unknown>)[key];
    return child === undefined ? [] : [[key, canonicalize(child)]];
  }));
}
