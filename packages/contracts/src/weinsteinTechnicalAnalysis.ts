import { sha256Canonical } from "./marketDailyHashes.js";
import { areInstantsChronologicallyOrdered } from "./chronology.js";

export const WEINSTEIN_SCHEMA_VERSION = "2026-08-13.weinstein-technical.v6";
export const WEINSTEIN_COMPUTATION_VERSION = "weinstein.weekly-stage.6";
export const WEINSTEIN_PROVIDER = "futu_opend";
export const WEINSTEIN_DATASET = "futu.weinstein.completed-weekly-ohlcv.v1";
export const WEINSTEIN_HASH_METHOD = "sha256-canonical-json-v1";
export const WEINSTEIN_MINIMUM_WEEKS = 42;
export const WEINSTEIN_DATA_INSUFFICIENT_SUMMARY = "Weinstein 周线证据不足；未生成阶段或切入结论。";
export const WEINSTEIN_DATA_INSUFFICIENT_COUNTEREVIDENCE = "关键证据缺失属于结构性否决，不能用短期指标抵消。";
export const WEINSTEIN_DATA_INSUFFICIENT_NEXT_OBSERVATION = "待个股、恒生指数和精确所属行业的同一分析日周线历史都可用后再刷新。";

export const WEINSTEIN_STAGES = ["STAGE_1", "STAGE_2", "STAGE_3", "STAGE_4", "TRANSITION", "UNKNOWN"] as const;
export type WeinsteinStage = (typeof WEINSTEIN_STAGES)[number];
export type WeinsteinStagePhase = "EARLY" | "MID" | "LATE" | "NOT_APPLICABLE" | "UNKNOWN";
export type WeinsteinDirection = "RISING" | "FLAT" | "FALLING" | "UNKNOWN";
export type WeinsteinEntryState = "NO_ACTION" | "WATCH" | "BASE_FORMING" | "BREAKOUT_WATCH"
  | "BREAKOUT_CONFIRMED" | "RETEST_WATCH" | "HOLD_STAGE_2" | "STAGE_3_WARNING" | "REDUCE" | "EXIT";

const STAGE_PHASES = ["EARLY", "MID", "LATE", "NOT_APPLICABLE", "UNKNOWN"] as const;
const DIRECTIONS = ["RISING", "FLAT", "FALLING", "UNKNOWN"] as const;
const ENTRY_STATES: WeinsteinEntryState[] = ["NO_ACTION", "WATCH", "BASE_FORMING", "BREAKOUT_WATCH", "BREAKOUT_CONFIRMED", "RETEST_WATCH", "HOLD_STAGE_2", "STAGE_3_WARNING", "REDUCE", "EXIT"];

export interface WeinsteinWeeklyBar {
  session: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WeinsteinWeeklySeriesInput {
  symbol: string;
  name: string;
  adjustment: "forward_qfq_research_only" | "none_index_or_sector";
  bars: WeinsteinWeeklyBar[];
}

export interface WeinsteinWeeklyInput {
  provider: "futu_opend";
  endpoint: "weinstein-weekly";
  rights: "confirmed" | "unknown" | "denied";
  retention: "confirmed" | "unknown" | "denied";
  derivedUse: "confirmed" | "unknown" | "denied";
  fetchedAt: string;
  analysisAsOf: string;
  sectorIdentityAsOf: string;
  stock: WeinsteinWeeklySeriesInput;
  marketBenchmark: WeinsteinWeeklySeriesInput;
  sectorBenchmark: WeinsteinWeeklySeriesInput;
}

export interface WeinsteinZone {
  lower: number;
  upper: number;
  basis: string;
  touchCount: number;
  firstWeek: string;
  lastWeek: string;
  failedBreakoutCount: number;
}

export interface WeinsteinSourceBinding {
  role: "stock" | "market" | "sector";
  symbol: string;
  name: string;
  adjustment: WeinsteinWeeklySeriesInput["adjustment"];
  barCount: number;
  firstWeek: string;
  lastWeek: string;
  inputHash: string;
}

export interface WeinsteinWeeklyChartPoint extends WeinsteinWeeklyBar {
  ma30w: number | null;
  marketRelativeStrength: number | null;
  sectorRelativeStrength: number | null;
}

export interface WeinsteinScoreFactor {
  id: "market" | "sector" | "stock_stage" | "price_structure" | "volume" | "relative_strength" | "risk";
  label: string;
  score: number;
  maxScore: number;
  assessment: string;
}

export interface WeinsteinTechnicalAnalysisEnvelope {
  schemaVersion: typeof WEINSTEIN_SCHEMA_VERSION;
  computationVersion: typeof WEINSTEIN_COMPUTATION_VERSION;
  status: "available" | "data_insufficient";
  symbol: string;
  market: "HK";
  analysisAsOf: string;
  completedWeekEnd: string | null;
  sectorIdentityAsOf: string | null;
  sourceFetchedAt: string | null;
  provider: typeof WEINSTEIN_PROVIDER | null;
  dataset: typeof WEINSTEIN_DATASET | null;
  hashMethod: typeof WEINSTEIN_HASH_METHOD | null;
  datasetHash: string | null;
  dataQuality: "COMPLETE" | "DATA_INSUFFICIENT";
  inputHash: string | null;
  resultHash: string | null;
  sources: WeinsteinSourceBinding[];
  marketStage: WeinsteinStage;
  marketStageConfidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  marketMa30wDirection: WeinsteinDirection;
  sectorStage: WeinsteinStage;
  sectorStageConfidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  sectorMa30wDirection: WeinsteinDirection;
  sectorStrength: "LEADING" | "IMPROVING" | "NEUTRAL" | "WEAKENING" | "LAGGING" | "UNKNOWN";
  stockStage: WeinsteinStage;
  stockStageConfidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  stockStagePhase: WeinsteinStagePhase;
  ma30w: number | null;
  ma30wDirection: WeinsteinDirection;
  priceVsMa30wPercent: number | null;
  supportZones: WeinsteinZone[];
  resistanceZones: WeinsteinZone[];
  overheadSupplyRisk: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  breakoutStatus: "NONE" | "WATCH" | "CONFIRMED" | "HISTORICAL" | "FAILED" | "UNKNOWN";
  breakoutWeek: string | null;
  breakoutLevel: number | null;
  volumeConfirmation: "WEAK" | "NORMAL" | "STRONG" | "VERY_STRONG" | "UNKNOWN";
  volumeRatio: number | null;
  volumeRatio4Week: number | null;
  volumePercentile: number | null;
  relativeStrengthStatus: "STRENGTHENING" | "NEUTRAL" | "WEAKENING" | "UNKNOWN";
  tripleConfirmation: "0/3" | "1/3" | "2/3" | "3/3" | "UNKNOWN";
  entryState: WeinsteinEntryState;
  entryQuality: "HIGH" | "MEDIUM" | "LOW" | "NOT_APPLICABLE" | "UNKNOWN";
  extensionRisk: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  extensionFromBreakoutPercent: number | null;
  extensionFromSupportPercent: number | null;
  invalidationZone: WeinsteinZone | null;
  holdingState: "NO_POSITION_CONTEXT" | "HOLD_STAGE_2" | "TIGHTEN_RISK" | "REDUCE" | "EXIT" | "UNKNOWN";
  exitWarning: "NONE" | "EARLY_WARNING" | "STAGE_3_WARNING" | "STAGE_4_CONFIRMATION" | "UNKNOWN";
  shortState: "DISABLED";
  overallConfidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  totalScore: number | null;
  scoreFactors: WeinsteinScoreFactor[];
  weeklyChart: WeinsteinWeeklyChartPoint[];
  summary: string;
  supportingEvidence: string[];
  counterevidence: string[];
  unknowns: string[];
  nextObservations: string[];
  safety: {
    advisoryOnly: true;
    createsOrder: false;
    createsTrade: false;
    mutatesCash: false;
    mutatesFee: false;
    mutatesPosition: false;
    callsBroker: false;
    productionWrite: false;
  };
}

export interface FrozenWeinsteinEvidenceBinding {
  bindingVersion: "research.weinstein.freeze.1";
  schemaVersion: typeof WEINSTEIN_SCHEMA_VERSION;
  computationVersion: typeof WEINSTEIN_COMPUTATION_VERSION;
  provider: typeof WEINSTEIN_PROVIDER;
  dataset: typeof WEINSTEIN_DATASET;
  hashMethod: typeof WEINSTEIN_HASH_METHOD;
  datasetHash: string;
  symbol: string;
  analysisAsOf: string;
  completedWeekEnd: string;
  sectorIdentityAsOf: string;
  inputHash: string;
  resultHash: string;
}

export function frozenWeinsteinEvidenceBinding(
  value: WeinsteinTechnicalAnalysisEnvelope
): FrozenWeinsteinEvidenceBinding | null {
  const validation = validateWeinsteinTechnicalAnalysisEnvelope(value, { symbol: value.symbol, analysisAsOf: value.analysisAsOf });
  if (!validation.ok || value.status !== "available" || !value.provider || !value.dataset || !value.hashMethod
    || !value.datasetHash || !value.completedWeekEnd || !value.sectorIdentityAsOf || !value.inputHash || !value.resultHash) return null;
  return {
    bindingVersion: "research.weinstein.freeze.1",
    schemaVersion: value.schemaVersion,
    computationVersion: value.computationVersion,
    provider: value.provider,
    dataset: value.dataset,
    hashMethod: value.hashMethod,
    datasetHash: value.datasetHash,
    symbol: value.symbol,
    analysisAsOf: value.analysisAsOf,
    completedWeekEnd: value.completedWeekEnd,
    sectorIdentityAsOf: value.sectorIdentityAsOf,
    inputHash: value.inputHash,
    resultHash: value.resultHash
  };
}

export function validateFrozenWeinsteinEvidenceBinding(
  value: unknown,
  expected?: { symbol: string; analysisAsOf: string }
): value is FrozenWeinsteinEvidenceBinding {
  if (!record(value)) return false;
  const keys = [
    "bindingVersion", "schemaVersion", "computationVersion", "provider", "dataset", "hashMethod",
    "datasetHash", "symbol", "analysisAsOf", "completedWeekEnd", "sectorIdentityAsOf", "inputHash", "resultHash"
  ];
  return Object.keys(value).sort().join(",") === keys.sort().join(",")
    && value.bindingVersion === "research.weinstein.freeze.1"
    && value.schemaVersion === WEINSTEIN_SCHEMA_VERSION
    && value.computationVersion === WEINSTEIN_COMPUTATION_VERSION
    && value.provider === WEINSTEIN_PROVIDER
    && value.dataset === WEINSTEIN_DATASET
    && value.hashMethod === WEINSTEIN_HASH_METHOD
    && sha(value.datasetHash) && sha(value.inputHash) && sha(value.resultHash)
    && typeof value.symbol === "string" && /^HK\.\d{5}$/.test(value.symbol)
    && date(value.analysisAsOf) && date(value.completedWeekEnd) && date(value.sectorIdentityAsOf)
    && value.completedWeekEnd === completedWeekEnd(value.analysisAsOf)
    && value.sectorIdentityAsOf === value.analysisAsOf
    && (!expected || value.symbol === expected.symbol && value.analysisAsOf === expected.analysisAsOf);
}

export function frozenWeinsteinEvidenceInvalidatedBy(
  frozen: FrozenWeinsteinEvidenceBinding | null,
  current: WeinsteinTechnicalAnalysisEnvelope | null
): string[] {
  if (!frozen) return ["weinstein_frozen_binding_missing"];
  if (!current || current.status !== "available") return ["weinstein_current_result_missing"];
  const next = frozenWeinsteinEvidenceBinding(current);
  if (!next) return ["weinstein_current_result_invalid"];
  return sha256Canonical(frozen) === sha256Canonical(next) ? [] : ["weinstein_result_changed"];
}

export function weinsteinInputHash(input: WeinsteinWeeklyInput): string {
  const { fetchedAt: _ignored, ...stable } = input;
  return sha256Canonical(stable);
}

export function weinsteinResultHash(value: WeinsteinTechnicalAnalysisEnvelope): string {
  const { resultHash: _resultHash, sourceFetchedAt: _sourceFetchedAt, ...stable } = value;
  return sha256Canonical(stable);
}

export function weinsteinDatasetHash(sources: WeinsteinSourceBinding[]): string {
  return sha256Canonical(sources);
}

export function validateWeinsteinWeeklyInput(value: unknown, now = new Date()): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["weekly input must be an object"] };
  if (value.provider !== "futu_opend" || value.endpoint !== "weinstein-weekly") errors.push("weekly input source is invalid");
  if (![value.rights, value.retention, value.derivedUse].every((item) => ["confirmed", "unknown", "denied"].includes(String(item)))) {
    errors.push("weekly input usage authority is invalid");
  }
  if (!instant(value.fetchedAt) || !date(value.analysisAsOf) || !date(value.sectorIdentityAsOf)
    || value.sectorIdentityAsOf > value.analysisAsOf
    || !sourceChronology(value.fetchedAt, value.analysisAsOf, now)) errors.push("weekly input chronology or sector identity is invalid");
  validateSeries(value.stock, "stock", "forward_qfq_research_only", String(value.analysisAsOf), errors);
  validateSeries(value.marketBenchmark, "market", "none_index_or_sector", String(value.analysisAsOf), errors);
  validateSeries(value.sectorBenchmark, "sector", "none_index_or_sector", String(value.analysisAsOf), errors);
  if (record(value.stock) && !/^HK\.\d{5}$/.test(String(value.stock.symbol))) errors.push("stock symbol must be canonical HK.<five digits>");
  if (record(value.marketBenchmark) && value.marketBenchmark.symbol !== "HK.800000") errors.push("market benchmark must be Hang Seng Index HK.800000");
  if (record(value.sectorBenchmark) && !hongKongIndustrySymbol(value.sectorBenchmark.symbol)) errors.push("sector benchmark must be a canonical Hong Kong industry plate");
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateWeinsteinTechnicalAnalysisEnvelope(
  value: unknown,
  expected?: { symbol: string; analysisAsOf: string },
  now = new Date()
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["Weinstein response must be an object"] };
  validateAnalysisIdentity(value, expected, errors);
  validateAnalysisEvidence(value, errors);
  validateAnalysisAvailability(value, now, errors);
  if (value.resultHash !== null && sha(value.resultHash)
    && value.resultHash !== weinsteinResultHash(value as unknown as WeinsteinTechnicalAnalysisEnvelope)) errors.push("Weinstein resultHash is invalid");
  return errors.length ? { ok: false, errors } : { ok: true };
}

function validateAnalysisIdentity(value: Record<string, unknown>, expected: { symbol: string; analysisAsOf: string } | undefined, errors: string[]): void {
  if (value.schemaVersion !== WEINSTEIN_SCHEMA_VERSION || value.computationVersion !== WEINSTEIN_COMPUTATION_VERSION) errors.push("Weinstein schema or computation version is invalid");
  if (value.market !== "HK" || !/^HK\.\d{5}$/.test(String(value.symbol)) || !date(value.analysisAsOf)) errors.push("Weinstein identity is invalid");
  if (expected && (value.symbol !== expected.symbol || value.analysisAsOf !== expected.analysisAsOf)) errors.push("Weinstein response identity drifted");
  if (!(value.completedWeekEnd === null || date(value.completedWeekEnd))
    || !(value.sectorIdentityAsOf === null || date(value.sectorIdentityAsOf))) errors.push("Weinstein cutoff identity is invalid");
  if (!(value.provider === null || value.provider === WEINSTEIN_PROVIDER)
    || !(value.dataset === null || value.dataset === WEINSTEIN_DATASET)
    || !(value.hashMethod === null || value.hashMethod === WEINSTEIN_HASH_METHOD)
    || !(value.datasetHash === null || sha(value.datasetHash))) errors.push("Weinstein dataset identity is invalid");
  if (!record(value.safety) || value.safety.advisoryOnly !== true || value.safety.createsOrder !== false
    || value.safety.createsTrade !== false || value.safety.mutatesCash !== false || value.safety.mutatesFee !== false
    || value.safety.mutatesPosition !== false || value.safety.callsBroker !== false || value.safety.productionWrite !== false) errors.push("Weinstein safety boundary is invalid");
  if (!validStructuralCategories(value) || !validActionCategories(value)) errors.push("Weinstein categorical output is invalid");
}

function validStructuralCategories(value: Record<string, unknown>): boolean {
  const confidence = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"];
  return WEINSTEIN_STAGES.includes(value.marketStage as WeinsteinStage)
    && WEINSTEIN_STAGES.includes(value.sectorStage as WeinsteinStage)
    && WEINSTEIN_STAGES.includes(value.stockStage as WeinsteinStage)
    && STAGE_PHASES.includes(value.stockStagePhase as typeof STAGE_PHASES[number])
    && DIRECTIONS.includes(value.ma30wDirection as typeof DIRECTIONS[number])
    && confidence.includes(String(value.marketStageConfidence))
    && DIRECTIONS.includes(value.marketMa30wDirection as typeof DIRECTIONS[number])
    && confidence.includes(String(value.sectorStageConfidence))
    && DIRECTIONS.includes(value.sectorMa30wDirection as typeof DIRECTIONS[number])
    && confidence.includes(String(value.stockStageConfidence))
    && ["LEADING", "IMPROVING", "NEUTRAL", "WEAKENING", "LAGGING", "UNKNOWN"].includes(String(value.sectorStrength));
}

function validActionCategories(value: Record<string, unknown>): boolean {
  return ENTRY_STATES.includes(value.entryState as WeinsteinEntryState)
    && ["LOW", "MEDIUM", "HIGH", "UNKNOWN"].includes(String(value.overheadSupplyRisk))
    && ["NONE", "WATCH", "CONFIRMED", "HISTORICAL", "FAILED", "UNKNOWN"].includes(String(value.breakoutStatus))
    && ["WEAK", "NORMAL", "STRONG", "VERY_STRONG", "UNKNOWN"].includes(String(value.volumeConfirmation))
    && ["STRENGTHENING", "NEUTRAL", "WEAKENING", "UNKNOWN"].includes(String(value.relativeStrengthStatus))
    && ["0/3", "1/3", "2/3", "3/3", "UNKNOWN"].includes(String(value.tripleConfirmation))
    && ["HIGH", "MEDIUM", "LOW", "NOT_APPLICABLE", "UNKNOWN"].includes(String(value.entryQuality))
    && ["LOW", "MEDIUM", "HIGH", "UNKNOWN"].includes(String(value.extensionRisk))
    && ["NO_POSITION_CONTEXT", "HOLD_STAGE_2", "TIGHTEN_RISK", "REDUCE", "EXIT", "UNKNOWN"].includes(String(value.holdingState))
    && ["NONE", "EARLY_WARNING", "STAGE_3_WARNING", "STAGE_4_CONFIRMATION", "UNKNOWN"].includes(String(value.exitWarning))
    && value.shortState === "DISABLED"
    && ["HIGH", "MEDIUM", "LOW", "UNKNOWN"].includes(String(value.overallConfidence));
}

function validateAnalysisEvidence(value: Record<string, unknown>, errors: string[]): void {
  if (!Array.isArray(value.sources) || !arraysOfStrings(value.supportingEvidence)
    || !arraysOfStrings(value.counterevidence) || !arraysOfStrings(value.unknowns)
    || !arraysOfStrings(value.nextObservations) || typeof value.summary !== "string" || !value.summary.trim()) errors.push("Weinstein evidence output is invalid");
  if (Array.isArray(value.sources)) value.sources.forEach((source) => validateBinding(source, String(value.analysisAsOf), errors));
  if (!Array.isArray(value.scoreFactors) || value.scoreFactors.some((factor) => !validScoreFactor(factor))
    || !Array.isArray(value.weeklyChart) || value.weeklyChart.some((point) => !validChartPoint(point, String(value.completedWeekEnd ?? value.analysisAsOf)))) {
    errors.push("Weinstein score or chart evidence is invalid");
  }
  const zoneCutoff = typeof value.completedWeekEnd === "string" ? value.completedWeekEnd : String(value.analysisAsOf);
  if (!Array.isArray(value.supportZones) || !Array.isArray(value.resistanceZones)
    || value.supportZones.some((zone) => !validZone(zone, zoneCutoff)) || value.resistanceZones.some((zone) => !validZone(zone, zoneCutoff))
    || !(value.invalidationZone === null || validZone(value.invalidationZone, zoneCutoff))) errors.push("Weinstein price zones are invalid");
}

function validateAnalysisAvailability(value: Record<string, unknown>, now: Date, errors: string[]): void {
  if (value.status === "available") { validateAvailableAnalysis(value, now, errors); return; }
  if (value.status === "data_insufficient") { validateInsufficientAnalysis(value, errors); return; }
  errors.push("Weinstein status is invalid");
}

// eslint-disable-next-line complexity -- one closed wire-contract validator; keep checks co-located.
function validateAvailableAnalysis(value: Record<string, unknown>, now: Date, errors: string[]): void {
  const complete = [
    value.dataQuality === "COMPLETE", Array.isArray(value.sources), (value.sources as unknown[])?.length === 3,
    sha(value.inputHash), sha(value.resultHash), instant(value.sourceFetchedAt), value.provider === WEINSTEIN_PROVIDER,
    value.dataset === WEINSTEIN_DATASET, value.hashMethod === WEINSTEIN_HASH_METHOD, sha(value.datasetHash),
    sourceChronology(value.sourceFetchedAt, value.analysisAsOf, now),
    finite(value.ma30w), Number(value.ma30w) > 0, finite(value.priceVsMa30wPercent),
    value.completedWeekEnd === completedWeekEnd(String(value.analysisAsOf)), value.sectorIdentityAsOf === value.analysisAsOf,
    finite(value.volumeRatio), Number(value.volumeRatio) >= 0,
    finite(value.volumeRatio4Week), Number(value.volumeRatio4Week) >= 0,
    finite(value.volumePercentile), Number(value.volumePercentile) >= 0, Number(value.volumePercentile) <= 100,
    finite(value.breakoutLevel), Number(value.breakoutLevel) > 0,
    finite(value.extensionFromSupportPercent), Number(value.extensionFromSupportPercent) >= 0,
    Array.isArray(value.supportZones), (value.supportZones as unknown[])?.length > 0,
    Array.isArray(value.resistanceZones), (value.resistanceZones as unknown[])?.length > 0, value.invalidationZone !== null,
    Array.isArray(value.supportingEvidence), (value.supportingEvidence as unknown[])?.length > 0,
    Array.isArray(value.counterevidence), (value.counterevidence as unknown[])?.length > 0,
    Array.isArray(value.nextObservations), (value.nextObservations as unknown[])?.length > 0,
    ![value.marketStage, value.sectorStage, value.stockStage].includes("UNKNOWN"),
    Number.isSafeInteger(value.totalScore), Number(value.totalScore) >= 0, Number(value.totalScore) <= 100,
    Array.isArray(value.scoreFactors), (value.scoreFactors as unknown[])?.length === 7,
    Array.isArray(value.weeklyChart), (value.weeklyChart as unknown[])?.length >= WEINSTEIN_MINIMUM_WEEKS
  ].every(Boolean);
  if (!complete) errors.push("available Weinstein output is incomplete");
  if (!Array.isArray(value.sources)) return;
  const roles = new Map(value.sources.filter(record).map((source) => [source.role, source]));
  if (roles.size !== 3 || roles.get("stock")?.symbol !== value.symbol || roles.get("market")?.symbol !== "HK.800000"
    || !hongKongIndustrySymbol(roles.get("sector")?.symbol)) {
    errors.push("available Weinstein source roles drifted");
  }
  if ([...roles.values()].some((source) => source.lastWeek !== value.completedWeekEnd)) errors.push("available Weinstein sources are not aligned to the same completed week");
  if (value.datasetHash !== weinsteinDatasetHash(value.sources as WeinsteinSourceBinding[])) errors.push("available Weinstein dataset hash is invalid");
  const factorIds = (value.scoreFactors as WeinsteinScoreFactor[]).map((factor) => factor.id);
  const expectedFactorIds: WeinsteinScoreFactor["id"][] = ["market", "sector", "stock_stage", "price_structure", "volume", "relative_strength", "risk"];
  if (factorIds.join(",") !== expectedFactorIds.join(",")
    || (value.scoreFactors as WeinsteinScoreFactor[]).reduce((sum, factor) => sum + factor.score, 0) !== value.totalScore
    || (value.weeklyChart as WeinsteinWeeklyChartPoint[]).at(-1)?.session !== value.completedWeekEnd) {
    errors.push("available Weinstein score or chart identity is invalid");
  }
  const breakoutWeekValid = value.breakoutStatus === "CONFIRMED"
    ? value.breakoutWeek === value.completedWeekEnd
    : ["HISTORICAL", "FAILED"].includes(String(value.breakoutStatus))
      ? typeof value.breakoutWeek === "string" && typeof value.completedWeekEnd === "string"
        && date(value.breakoutWeek) && value.breakoutWeek < value.completedWeekEnd
      : value.breakoutWeek === null;
  if (!breakoutWeekValid || (["CONFIRMED", "HISTORICAL"].includes(String(value.breakoutStatus))
    ? !finite(value.extensionFromBreakoutPercent) || Number(value.extensionFromBreakoutPercent) < 0
    : !(value.extensionFromBreakoutPercent === null || finite(value.extensionFromBreakoutPercent)))) {
    errors.push("Weinstein breakout event identity is invalid");
  }
  const entryEligible = value.stockStage === "STAGE_2" && ["BREAKOUT_CONFIRMED", "RETEST_WATCH"].includes(String(value.entryState));
  if (entryEligible ? !["HIGH", "MEDIUM", "LOW"].includes(String(value.entryQuality)) : value.entryQuality !== "NOT_APPLICABLE") {
    errors.push("Weinstein entry quality is not eligible for the current structural state");
  }
  const environmentalHeadwind = value.marketStage !== "STAGE_2" || value.sectorStage !== "STAGE_2"
    || ["WEAKENING", "LAGGING"].includes(String(value.sectorStrength));
  if (environmentalHeadwind && value.entryQuality === "HIGH") errors.push("Weinstein entry quality ignored market or sector headwind");
}

function validateInsufficientAnalysis(value: Record<string, unknown>, errors: string[]): void {
  const cleared = [
    value.dataQuality === "DATA_INSUFFICIENT", arraysOfStrings(value.unknowns), (value.unknowns as unknown[])?.length > 0,
    value.summary === WEINSTEIN_DATA_INSUFFICIENT_SUMMARY,
    Array.isArray(value.counterevidence) && value.counterevidence.length === 1
      && value.counterevidence[0] === WEINSTEIN_DATA_INSUFFICIENT_COUNTEREVIDENCE,
    Array.isArray(value.nextObservations) && value.nextObservations.length === 1
      && value.nextObservations[0] === WEINSTEIN_DATA_INSUFFICIENT_NEXT_OBSERVATION,
    ...[value.sourceFetchedAt, value.completedWeekEnd, value.sectorIdentityAsOf, value.provider, value.dataset,
      value.hashMethod, value.datasetHash, value.inputHash, value.resultHash, value.totalScore,
      value.ma30w, value.priceVsMa30wPercent, value.breakoutWeek, value.breakoutLevel,
      value.extensionFromBreakoutPercent, value.extensionFromSupportPercent, value.volumeRatio, value.volumeRatio4Week,
      value.volumePercentile, value.invalidationZone].map((item) => item === null),
    Array.isArray(value.sources), (value.sources as unknown[])?.length === 0,
    Array.isArray(value.scoreFactors), (value.scoreFactors as unknown[])?.length === 0,
    Array.isArray(value.weeklyChart), (value.weeklyChart as unknown[])?.length === 0,
    Array.isArray(value.supportZones), (value.supportZones as unknown[])?.length === 0,
    Array.isArray(value.resistanceZones), (value.resistanceZones as unknown[])?.length === 0,
    Array.isArray(value.supportingEvidence), (value.supportingEvidence as unknown[])?.length === 0,
    ...[value.marketStage, value.marketStageConfidence, value.marketMa30wDirection,
      value.sectorStage, value.sectorStageConfidence, value.sectorMa30wDirection, value.sectorStrength,
      value.stockStage, value.stockStageConfidence, value.stockStagePhase,
      value.ma30wDirection, value.overheadSupplyRisk, value.breakoutStatus, value.volumeConfirmation,
      value.relativeStrengthStatus, value.tripleConfirmation, value.entryQuality, value.extensionRisk,
      value.holdingState, value.exitWarning, value.overallConfidence].map((item) => item === "UNKNOWN"),
    value.entryState === "NO_ACTION", value.shortState === "DISABLED"
  ].every(Boolean);
  if (!cleared) {
    errors.push("data-insufficient Weinstein output must clear derived facts and explain missing evidence");
  }
}

function validateSeries(value: unknown, role: string, adjustment: WeinsteinWeeklySeriesInput["adjustment"], analysisAsOf: string, errors: string[]): void {
  if (!record(value) || typeof value.symbol !== "string" || !value.symbol.trim() || typeof value.name !== "string" || !value.name.trim()
    || value.adjustment !== adjustment || !Array.isArray(value.bars)) {
    errors.push(`${role} weekly series is invalid`); return;
  }
  let previous = "";
  for (const bar of value.bars) {
    if (!record(bar) || !date(bar.session) || bar.session <= previous || bar.session > analysisAsOf
      || ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(finite)
      || Number(bar.open) <= 0 || Number(bar.high) <= 0 || Number(bar.low) <= 0 || Number(bar.close) <= 0
      || Number(bar.volume) < 0 || (role === "stock" && Number(bar.volume) === 0)
      || Number(bar.low) > Math.min(Number(bar.open), Number(bar.close))
      || Number(bar.high) < Math.max(Number(bar.open), Number(bar.close))) { errors.push(`${role} weekly bars are invalid`); break; }
    previous = String(bar.session);
  }
  if (value.bars.length > 0 && record(value.bars.at(-1))
    && value.bars.at(-1)?.session !== completedWeekEnd(analysisAsOf)) errors.push(`${role} weekly series is not aligned to the latest completed week`);
  const used = value.bars.slice(-53).filter(record);
  if (used.some((bar, index) => index > 0 && daysBetween(String(used[index - 1]!.session), String(bar.session)) !== 7)) {
    errors.push(`${role} weekly series has an unclassified missing period`);
  }
}

function validateBinding(value: unknown, analysisAsOf: string, errors: string[]): void {
  if (!record(value) || !["stock", "market", "sector"].includes(String(value.role)) || typeof value.symbol !== "string"
    || !value.symbol.trim() || typeof value.name !== "string" || !value.name.trim()
    || value.adjustment !== (value.role === "stock" ? "forward_qfq_research_only" : "none_index_or_sector")
    || (value.role === "sector" && !hongKongIndustrySymbol(value.symbol))
    || !Number.isSafeInteger(value.barCount) || Number(value.barCount) < WEINSTEIN_MINIMUM_WEEKS
    || !date(value.firstWeek) || !date(value.lastWeek) || value.firstWeek > value.lastWeek || value.lastWeek !== completedWeekEnd(analysisAsOf)
    || !sha(value.inputHash)) errors.push("Weinstein source binding is invalid");
}
function validZone(value: unknown, cutoff: string): boolean { return record(value) && finite(value.lower) && finite(value.upper) && Number(value.lower) > 0 && Number(value.lower) <= Number(value.upper) && typeof value.basis === "string" && value.basis.trim().length > 0 && Number.isSafeInteger(value.touchCount) && Number(value.touchCount) >= 2 && date(value.firstWeek) && date(value.lastWeek) && value.firstWeek <= value.lastWeek && value.lastWeek <= cutoff && Number.isSafeInteger(value.failedBreakoutCount) && Number(value.failedBreakoutCount) >= 0; }
function validScoreFactor(value: unknown): boolean {
  return record(value) && ["market", "sector", "stock_stage", "price_structure", "volume", "relative_strength", "risk"].includes(String(value.id))
    && typeof value.label === "string" && value.label.trim().length > 0 && typeof value.assessment === "string" && value.assessment.trim().length > 0
    && Number.isSafeInteger(value.score) && Number.isSafeInteger(value.maxScore) && Number(value.maxScore) > 0
    && Number(value.score) >= 0 && Number(value.score) <= Number(value.maxScore);
}
function validChartPoint(value: unknown, cutoff: string): boolean {
  return record(value) && date(value.session) && value.session <= cutoff
    && [value.open, value.high, value.low, value.close, value.volume].every(finite)
    && Number(value.open) > 0 && Number(value.high) > 0 && Number(value.low) > 0 && Number(value.close) > 0 && Number(value.volume) > 0
    && Number(value.low) <= Math.min(Number(value.open), Number(value.close)) && Number(value.high) >= Math.max(Number(value.open), Number(value.close))
    && (value.ma30w === null || finite(value.ma30w) && Number(value.ma30w) > 0)
    && (value.marketRelativeStrength === null || finite(value.marketRelativeStrength) && Number(value.marketRelativeStrength) > 0)
    && (value.sectorRelativeStrength === null || finite(value.sectorRelativeStrength) && Number(value.sectorRelativeStrength) > 0);
}
export function completedWeekEnd(analysisAsOf: string): string {
  const value = new Date(`${analysisAsOf}T00:00:00.000Z`);
  const daysSinceFriday = (value.getUTCDay() - 5 + 7) % 7;
  value.setUTCDate(value.getUTCDate() - (daysSinceFriday || 7));
  return value.toISOString().slice(0, 10);
}
function arraysOfStrings(value: unknown): boolean { return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0); }
function hongKongIndustrySymbol(value: unknown): boolean { return typeof value === "string" && /^HK\.LIST\d+$/.test(value); }
function sourceChronology(fetchedAt: unknown, analysisAsOf: unknown, now: Date): boolean {
  return typeof analysisAsOf === "string" && date(analysisAsOf)
    && areInstantsChronologicallyOrdered([`${analysisAsOf}T00:00:00+08:00`, fetchedAt, now]);
}
function daysBetween(left: string, right: string): number { return (Date.parse(`${right}T00:00:00.000Z`) - Date.parse(`${left}T00:00:00.000Z`)) / 86_400_000; }
function finite(value: unknown): boolean { return typeof value === "number" && Number.isFinite(value); }
function sha(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function date(value: unknown): value is string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const parsed = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
function instant(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
