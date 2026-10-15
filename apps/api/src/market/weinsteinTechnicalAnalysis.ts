import {
  WEINSTEIN_COMPUTATION_VERSION,
  WEINSTEIN_DATA_INSUFFICIENT_COUNTEREVIDENCE,
  WEINSTEIN_DATA_INSUFFICIENT_NEXT_OBSERVATION,
  WEINSTEIN_DATA_INSUFFICIENT_SUMMARY,
  WEINSTEIN_DATASET,
  WEINSTEIN_HASH_METHOD,
  WEINSTEIN_MINIMUM_WEEKS,
  WEINSTEIN_PROVIDER,
  WEINSTEIN_SCHEMA_VERSION,
  completedWeekEnd,
  validateWeinsteinTechnicalAnalysisEnvelope,
  validateWeinsteinWeeklyInput,
  weinsteinDatasetHash,
  weinsteinInputHash,
  weinsteinResultHash,
  type WeinsteinDirection,
  type WeinsteinEntryState,
  type WeinsteinStage,
  type WeinsteinTechnicalAnalysisEnvelope,
  type WeinsteinScoreFactor,
  type WeinsteinWeeklyBar,
  type WeinsteinWeeklyInput,
  type WeinsteinWeeklySeriesInput,
  type WeinsteinZone
} from "../../../../packages/contracts/src/weinsteinTechnicalAnalysis.js";
import { sha256Canonical } from "../../../../packages/contracts/src/marketDailyHashes.js";
import { movingAverage } from "./technicalIndicators.js";

export interface WeinsteinWeeklyProvider {
  getWeeklyInput(market: string, code: string, analysisAsOf: string): Promise<WeinsteinWeeklyInput>;
  getHistoricalPrice?(market: string, code: string, analysisAsOf: string): Promise<HistoricalWeeklyPrice>;
}

export interface HistoricalWeeklyPrice {
  symbol: string;
  analysisAsOf: string;
  completedWeekEnd: string;
  fetchedAt: string;
  provider: "futu_opend";
  adjustment: "forward_qfq_research_only";
  sectorIdentityStatus: "unavailable_historical";
  rights: "confirmed" | "unknown" | "denied";
  retention: "confirmed" | "unknown" | "denied";
  derivedUse: "confirmed" | "unknown" | "denied";
  bars: WeinsteinWeeklyBar[];
}

export function validHistoricalWeeklyPrice(
  value: unknown,
  symbol: string,
  analysisAsOf: string,
  now = new Date()
): value is HistoricalWeeklyPrice {
  if (!record(value) || value.symbol !== symbol || value.analysisAsOf !== analysisAsOf
    || value.completedWeekEnd !== completedWeekEnd(analysisAsOf)
    || value.provider !== "futu_opend" || value.adjustment !== "forward_qfq_research_only"
    || value.sectorIdentityStatus !== "unavailable_historical"
    || ![value.rights, value.retention, value.derivedUse].every((item) => item === "confirmed")
    || !Array.isArray(value.bars) || value.bars.length === 0 || value.bars.length > 300
    || typeof value.fetchedAt !== "string" || !Number.isFinite(Date.parse(value.fetchedAt))
    || Date.parse(value.fetchedAt) > now.getTime()) return false;
  let previous = "";
  for (const bar of value.bars) {
    const numbers = record(bar) ? [bar.open, bar.high, bar.low, bar.close, bar.volume] : [];
    const parsed = typeof bar?.session === "string" ? new Date(`${bar.session}T00:00:00.000Z`) : null;
    if (!record(bar) || typeof bar.session !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(bar.session)
      || !parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== bar.session
      || parsed.getUTCDay() !== 5
      || bar.session <= previous || bar.session > value.completedWeekEnd
      || !numbers.every((number, index) => typeof number === "number" && Number.isFinite(number)
        && (index === 4 ? number >= 0 : number > 0))) return false;
    const [open, high, low, close] = numbers as number[];
    if (low > Math.min(open, close) || high < Math.max(open, close)) return false;
    previous = bar.session;
  }
  return true;
}

export class FutuHttpWeinsteinWeeklyProvider implements WeinsteinWeeklyProvider {
  constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async getWeeklyInput(market: string, code: string, analysisAsOf: string): Promise<WeinsteinWeeklyInput> {
    const url = new URL("/weinstein-weekly", this.baseUrl);
    url.searchParams.set("market", market);
    url.searchParams.set("ticker", code);
    url.searchParams.set("analysisAsOf", analysisAsOf);
    const response = await this.fetchImpl(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`Futu Weinstein weekly adapter returned HTTP ${response.status}`);
    const payload = await response.json() as unknown;
    if (!record(payload) || payload.ok !== true || !record(payload.input)) throw new Error("Futu Weinstein weekly adapter returned malformed input");
    const input = payload.input as unknown as WeinsteinWeeklyInput;
    const validation = validateWeinsteinWeeklyInput(input);
    if (!validation.ok || input.stock.symbol !== `${market}.${code}` || input.analysisAsOf !== analysisAsOf) {
      throw new Error(`Futu Weinstein weekly input failed validation: ${validation.ok ? "identity drift" : validation.errors.join("; ")}`);
    }
    return input;
  }

  async getHistoricalPrice(market: string, code: string, analysisAsOf: string): Promise<HistoricalWeeklyPrice> {
    const url = new URL("/weinstein-weekly-price", this.baseUrl);
    url.searchParams.set("market", market);
    url.searchParams.set("ticker", code);
    url.searchParams.set("analysisAsOf", analysisAsOf);
    const response = await this.fetchImpl(url, {
      headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`Futu historical weekly price returned HTTP ${response.status}`);
    const payload = await response.json() as unknown;
    if (!record(payload) || payload.ok !== true
      || !validHistoricalWeeklyPrice(payload.price, `${market}.${code}`, analysisAsOf)) {
      throw new Error("Futu historical weekly price identity or rights are invalid");
    }
    return payload.price;
  }
}

export async function getWeinsteinTechnicalAnalysis(
  provider: WeinsteinWeeklyProvider | null,
  market: string,
  code: string,
  analysisAsOf: string,
  currentDate: string
): Promise<WeinsteinTechnicalAnalysisEnvelope> {
  const symbol = `${market}.${code}`;
  if (analysisAsOf !== currentDate) return dataInsufficient(symbol, analysisAsOf, "Historical replay is unavailable because Futu provides only current sector identity.");
  if (!provider) return dataInsufficient(symbol, analysisAsOf, "Futu weekly market-data adapter is not configured.");
  try {
    const input = await provider.getWeeklyInput(market, code, analysisAsOf);
    return calculateWeinsteinTechnicalAnalysis(input);
  } catch (error) {
    return dataInsufficient(symbol, analysisAsOf, `Weekly market evidence is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function calculateWeinsteinTechnicalAnalysis(input: WeinsteinWeeklyInput): WeinsteinTechnicalAnalysisEnvelope {
  const validation = validateWeinsteinWeeklyInput(input);
  if (!validation.ok) return dataInsufficient(input.stock?.symbol ?? "HK.00000", input.analysisAsOf, validation.errors.join("; "));
  if ([input.rights, input.retention, input.derivedUse].some((item) => item !== "confirmed")) {
    return dataInsufficient(input.stock.symbol, input.analysisAsOf,
      `Futu weekly history usage authority is not confirmed: rights=${input.rights}, retention=${input.retention}, derivedUse=${input.derivedUse}.`);
  }
  const series = [input.stock, input.marketBenchmark, input.sectorBenchmark];
  const missing = series.filter((item) => item.bars.length < WEINSTEIN_MINIMUM_WEEKS)
    .map((item) => `${item.symbol} has ${item.bars.length} completed weeks; ${WEINSTEIN_MINIMUM_WEEKS} are required.`);
  if (missing.length) return dataInsufficient(input.stock.symbol, input.analysisAsOf, ...missing);

  const stock = analyzeSeries(input.stock.bars);
  const market = analyzeSeries(input.marketBenchmark.bars);
  const sector = analyzeSeries(input.sectorBenchmark.bars);
  if (!stock || !market || !sector) return dataInsufficient(input.stock.symbol, input.analysisAsOf, "A 30-week moving average or structural window could not be computed.");
  const stockVsMarket = relativeStrength(input.stock.bars, input.marketBenchmark.bars);
  const stockVsSector = relativeStrength(input.stock.bars, input.sectorBenchmark.bars);
  const sectorVsMarket = relativeStrength(input.sectorBenchmark.bars, input.marketBenchmark.bars);
  if (!stockVsMarket || !stockVsSector || !sectorVsMarket) return dataInsufficient(input.stock.symbol, input.analysisAsOf, "Weekly stock, market, and sector periods do not provide 14 aligned observations.");

  const relativeStrengthStatus = combineRelativeStrength(stockVsMarket.changePercent, stockVsSector.changePercent);
  const volumeConfirmation = volumeClass(stock.volumeRatio4Week, stock.volumeRatio, stock.volumePercentile);
  const priceConfirmation = stock.breakoutStatus === "CONFIRMED";
  const volumeConfirmed = volumeConfirmation === "STRONG" || volumeConfirmation === "VERY_STRONG";
  const relativeConfirmed = relativeStrengthStatus === "STRENGTHENING";
  const confirmations = [priceConfirmation, volumeConfirmed, relativeConfirmed].filter(Boolean).length;
  const tripleConfirmation = `${confirmations}/3` as WeinsteinTechnicalAnalysisEnvelope["tripleConfirmation"];
  const sectorStrength = strengthClass(sectorVsMarket.changePercent);
  const structuralVeto = market.stage === "STAGE_4" || sector.stage === "STAGE_4" || stock.stage === "STAGE_4";
  const environmentalHeadwind = hasEnvironmentalHeadwind(market.stage, sector.stage, sectorStrength);
  const { extensionFromBreakoutPercent, extensionFromSupportPercent, extensionRisk } = extensionMetrics(stock);
  const entryState = stock.stage === "STAGE_4" ? "EXIT"
    : structuralVeto ? "NO_ACTION" : entryStateFor(stock.stage, stock.breakoutStatus, tripleConfirmation,
      stock.retestConfirmed, relativeStrengthStatus);
  const entryEligible = stock.stage === "STAGE_2" && (entryState === "BREAKOUT_CONFIRMED" || entryState === "RETEST_WATCH");
  const entryQuality = entryQualityFor(entryEligible, tripleConfirmation, confirmations, extensionRisk, environmentalHeadwind);
  const supportingEvidence = [
    `大盘 ${market.stage}（置信度 ${market.stageConfidence}），30 周均线${directionText(market.direction)}，周收盘距均线 ${format(market.priceVsMa30wPercent)}%；支撑 ${zoneText(market.support)}，跌破该结构将否定当前大盘阶段。`,
    `行业 ${sector.stage}（置信度 ${sector.stageConfidence}），30 周均线${directionText(sector.direction)}，相对大盘 ${format(sectorVsMarket.changePercent)}%；支撑 ${zoneText(sector.support)}，跌破该结构将否定当前行业阶段。`,
    `个股周收盘 ${format(stock.close)}，30 周均线 ${format(stock.ma30w)}，距离均线 ${format(stock.priceVsMa30wPercent)}%。`,
    `30 周均线方向为 ${directionText(stock.direction)}，最近四周斜率 ${format(stock.slopePercent)}%。`,
    `最近一周成交量为此前 4 周均量的 ${format(stock.volumeRatio4Week)} 倍、此前 10 周均量的 ${format(stock.volumeRatio)} 倍，历史分位 ${format(stock.volumePercentile)}%，量能确认 ${volumeText(volumeConfirmation)}。`,
    `最近 13 个对齐周，个股相对大盘强弱变化 ${format(stockVsMarket.changePercent)}%，相对行业变化 ${format(stockVsSector.changePercent)}%。`,
    `阻力区由 ${stock.resistance.touchCount} 次触及、${stock.resistance.firstWeek} 至 ${stock.resistance.lastWeek} 的结构聚类形成，失败突破 ${stock.resistance.failedBreakoutCount} 次。`
  ];
  const counterevidence = [
    ...marketSectorCounterevidence(market.stage, sector.stage, sectorStrength),
    ...(relativeStrengthStatus === "WEAKENING" ? ["个股相对大盘或行业的强弱正在减弱。"] : []),
    ...(extensionRisk === "HIGH" ? ["价格明显远离 30 周均线；强势股票不等于当前就是合适切入点。"] : []),
    ...(volumeConfirmation === "WEAK" ? ["当前价格结构缺少成交量确认。"] : [])
  ];
  if (!counterevidence.length) counterevidence.push("当前没有结构性否决，但仍需后续完成周线确认；这不是价格预测。");
  const sources = [binding("stock", input.stock), binding("market", input.marketBenchmark), binding("sector", input.sectorBenchmark)];
  const scoreFactors = scoreFactorsFor({ market, sector, stock, sectorStrength, volumeConfirmation, relativeStrengthStatus, structuralVeto, extensionRisk });
  const output: WeinsteinTechnicalAnalysisEnvelope = {
    schemaVersion: WEINSTEIN_SCHEMA_VERSION,
    computationVersion: WEINSTEIN_COMPUTATION_VERSION,
    status: "available",
    symbol: input.stock.symbol,
    market: "HK",
    analysisAsOf: input.analysisAsOf,
    completedWeekEnd: completedWeekEnd(input.analysisAsOf),
    sectorIdentityAsOf: input.sectorIdentityAsOf,
    sourceFetchedAt: input.fetchedAt,
    provider: WEINSTEIN_PROVIDER,
    dataset: WEINSTEIN_DATASET,
    hashMethod: WEINSTEIN_HASH_METHOD,
    datasetHash: weinsteinDatasetHash(sources),
    dataQuality: "COMPLETE",
    inputHash: weinsteinInputHash(input),
    resultHash: null,
    sources,
    marketStage: market.stage,
    marketStageConfidence: market.stageConfidence,
    marketMa30wDirection: market.direction,
    sectorStage: sector.stage,
    sectorStageConfidence: sector.stageConfidence,
    sectorMa30wDirection: sector.direction,
    sectorStrength,
    stockStage: stock.stage,
    stockStageConfidence: stock.stageConfidence,
    stockStagePhase: stock.phase,
    ma30w: stock.ma30w,
    ma30wDirection: stock.direction,
    priceVsMa30wPercent: stock.priceVsMa30wPercent,
    supportZones: [stock.support],
    resistanceZones: [stock.resistance],
    overheadSupplyRisk: stock.overheadSupplyRisk,
    breakoutStatus: stock.breakoutStatus,
    breakoutWeek: stock.breakoutWeek,
    breakoutLevel: stock.resistance.upper,
    volumeConfirmation,
    volumeRatio: stock.volumeRatio,
    volumeRatio4Week: stock.volumeRatio4Week,
    volumePercentile: stock.volumePercentile,
    relativeStrengthStatus,
    tripleConfirmation,
    entryState,
    entryQuality,
    extensionRisk,
    extensionFromBreakoutPercent,
    extensionFromSupportPercent,
    invalidationZone: stock.support,
    holdingState: "NO_POSITION_CONTEXT",
    exitWarning: stock.stage === "STAGE_4" ? "STAGE_4_CONFIRMATION" : stock.stage === "STAGE_3" ? "STAGE_3_WARNING"
      : relativeStrengthStatus === "WEAKENING" ? "EARLY_WARNING" : "NONE",
    shortState: "DISABLED",
    overallConfidence: stock.stage === "TRANSITION" || market.stage === "TRANSITION" || sector.stage === "TRANSITION" ? "MEDIUM" : "HIGH",
    totalScore: scoreFactors.reduce((sum, factor) => sum + factor.score, 0),
    scoreFactors,
    weeklyChart: weeklyChart(input.stock.bars, input.marketBenchmark.bars, input.sectorBenchmark.bars),
    summary: summary(input.stock.symbol, stock.stage, stock.phase, entryState, structuralVeto),
    supportingEvidence,
    counterevidence,
    unknowns: ["v2 暂未纳入市场宽度历史和跨市场确认。"],
    nextObservations: [
      `观察价格能否守住支撑区 ${zoneText(stock.support)}。`,
      `观察后续完成周线能否确认或否定阻力区 ${zoneText(stock.resistance)}。`,
      "完成新一周后，若阶段、量能或相对强弱结构变化，再次运行分析。"
    ],
    safety: safety()
  };
  output.resultHash = weinsteinResultHash(output);
  const outputValidation = validateWeinsteinTechnicalAnalysisEnvelope(output, { symbol: input.stock.symbol, analysisAsOf: input.analysisAsOf });
  return outputValidation.ok ? output : dataInsufficient(input.stock.symbol, input.analysisAsOf, outputValidation.errors.join("; "));
}

type SeriesAnalysis = {
  stage: WeinsteinStage; phase: "EARLY" | "MID" | "LATE" | "NOT_APPLICABLE";
  stageConfidence: "HIGH" | "MEDIUM" | "LOW";
  direction: WeinsteinDirection; close: number; ma30w: number; slopePercent: number; priceVsMa30wPercent: number;
  volumeRatio: number; volumeRatio4Week: number; volumePercentile: number; support: WeinsteinZone; resistance: WeinsteinZone;
  retestConfirmed: boolean;
  overheadSupplyRisk: "LOW" | "MEDIUM" | "HIGH";
  breakoutStatus: "NONE" | "WATCH" | "CONFIRMED" | "HISTORICAL" | "FAILED"; breakoutWeek: string | null;
};

function analyzeSeries(bars: WeinsteinWeeklyBar[]): SeriesAnalysis | null {
  const structure = stageStructure(bars);
  if (!structure) return null;
  const latest = bars.at(-1)!;
  const resistance = structuralZone(bars.slice(-40, -4), bars, "high", "最近四周之前的重复高位转折聚类", true);
  const support = structuralZone(bars.slice(-40, -4), bars, "low", "最近四周之前的重复低位转折聚类", false);
  if (!resistance || !support) return null;
  const breakout = classifyBreakout(bars, resistance);
  const averageVolume4 = average(bars.slice(-5, -1).map((bar) => bar.volume));
  const averageVolume10 = average(bars.slice(-11, -1).map((bar) => bar.volume));
  const volumeRatio4Week = averageVolume4 > 0 ? latest.volume / averageVolume4 : 0;
  const volumeRatio = averageVolume10 > 0 ? latest.volume / averageVolume10 : 0;
  const volumeHistory = bars.slice(-53, -1).map((bar) => bar.volume);
  const volumePercentile = volumeHistory.length ? volumeHistory.filter((volume) => volume <= latest.volume).length / volumeHistory.length * 100 : 0;
  const retestConfirmed = detectsRetest(bars, resistance, breakout.index);
  const breakoutAgeWeeks = breakout.index < 0 ? null : bars.length - 1 - breakout.index;
  const phase = stagePhase(structure.stage, breakout.fresh, retestConfirmed, breakoutAgeWeeks);
  const stageConfidence = stageConfidenceFor(structure.stage);
  const distanceToResistance = percent(resistance.lower, latest.close);
  const overheadSupplyRisk = latest.close > resistance.upper ? "LOW" : distanceToResistance <= 5 ? "MEDIUM" : "HIGH";
  return { stage: structure.stage, phase, stageConfidence, direction: structure.direction, close: latest.close,
    ma30w: round(structure.ma30w), slopePercent: round(structure.slopePercent),
    priceVsMa30wPercent: round(structure.priceVsMa30wPercent), volumeRatio: round(volumeRatio),
    volumeRatio4Week: round(volumeRatio4Week), volumePercentile: round(volumePercentile), support, resistance,
    retestConfirmed, overheadSupplyRisk, breakoutStatus: breakout.status, breakoutWeek: breakout.week };
}

function classifyBreakout(bars: WeinsteinWeeklyBar[], resistance: WeinsteinZone): {
  index: number; fresh: boolean; status: SeriesAnalysis["breakoutStatus"]; week: string | null;
} {
  const index = lastStageTwoBreakoutIndex(bars, resistance);
  const fresh = index === bars.length - 1;
  const latest = bars.at(-1)!;
  const status = fresh ? "CONFIRMED"
    : index >= bars.length - 4 && latest.close < resistance.lower ? "FAILED"
      : index >= 0 && latest.close > resistance.upper ? "HISTORICAL"
        : latest.close >= resistance.lower * 0.97 ? "WATCH" : "NONE";
  return { index, fresh, status, week: ["CONFIRMED", "HISTORICAL", "FAILED"].includes(status) && index >= 0 ? bars[index]!.session : null };
}

function stagePhase(stage: WeinsteinStage, freshBreakout: boolean, retestConfirmed: boolean, breakoutAgeWeeks: number | null): SeriesAnalysis["phase"] {
  if (stage !== "STAGE_2") return "NOT_APPLICABLE";
  return freshBreakout ? "EARLY" : retestConfirmed || (breakoutAgeWeeks !== null && breakoutAgeWeeks <= 12) ? "MID" : "LATE";
}

function stageConfidenceFor(stage: WeinsteinStage): SeriesAnalysis["stageConfidence"] {
  return stage === "TRANSITION" ? "LOW" : stage === "STAGE_1" || stage === "STAGE_3" ? "MEDIUM" : "HIGH";
}

function lastStageTwoBreakoutIndex(bars: WeinsteinWeeklyBar[], resistance: WeinsteinZone): number {
  for (let index = bars.length - 1; index > 0; index -= 1) {
    if (bars[index]!.session <= resistance.lastWeek || bars[index]!.close <= resistance.upper || bars[index - 1]!.close > resistance.upper) continue;
    const after = stageStructure(bars.slice(0, index + 1));
    const priorStages = Array.from({ length: 4 }, (_, offset) => stageStructure(bars.slice(0, index - offset))?.stage);
    if (priorStages.every((stage) => stage === "STAGE_1" || stage === "TRANSITION") && after?.stage === "STAGE_2") return index;
  }
  return -1;
}

function stageStructure(bars: WeinsteinWeeklyBar[]): { stage: WeinsteinStage; direction: WeinsteinDirection; ma30w: number; slopePercent: number; priceVsMa30wPercent: number } | null {
  const averages = movingAverage(bars.map((bar) => bar.close), 30);
  const [ma30w, earlierMa, longSlopeMa] = [averages.at(-1), averages.at(-5), averages.at(-13)];
  if (ma30w === null || ma30w === undefined || earlierMa === null || earlierMa === undefined || longSlopeMa === null || longSlopeMa === undefined) return null;
  const latest = bars.at(-1)!;
  const slopePercent = percent(ma30w, earlierMa);
  const direction: WeinsteinDirection = slopePercent > 1 ? "RISING" : slopePercent < -1 ? "FALLING" : "FLAT";
  const recent = bars.slice(-13), previous = bars.slice(-26, -13);
  const recentHigh = Math.max(...recent.map((bar) => bar.high)), recentLow = Math.min(...recent.map((bar) => bar.low));
  const previousHigh = Math.max(...previous.map((bar) => bar.high)), previousLow = Math.min(...previous.map((bar) => bar.low));
  const priceVsMa30wPercent = percent(latest.close, ma30w);
  let stage: WeinsteinStage = "TRANSITION";
  if (latest.close > ma30w && direction === "RISING" && recentHigh >= previousHigh && recentLow > previousLow) stage = "STAGE_2";
  else if (latest.close < ma30w && direction === "FALLING" && recentHigh < previousHigh && recentLow <= previousLow) stage = "STAGE_4";
  else if (direction === "FLAT" && Math.abs(priceVsMa30wPercent) <= 12 && percent(ma30w, longSlopeMa) > 4) stage = "STAGE_3";
  else if (direction === "FLAT" && Math.abs(priceVsMa30wPercent) <= 12) stage = "STAGE_1";
  return { stage, direction, ma30w, slopePercent, priceVsMa30wPercent };
}

function relativeStrength(left: WeinsteinWeeklyBar[], right: WeinsteinWeeklyBar[]): { changePercent: number } | null {
  const rightBySession = new Map(right.map((bar) => [bar.session, bar.close]));
  const ratios = left.flatMap((bar) => {
    const benchmark = rightBySession.get(bar.session);
    return benchmark && benchmark > 0 ? [bar.close / benchmark] : [];
  });
  if (ratios.length < 14 || left.at(-1)?.session !== right.at(-1)?.session || !rightBySession.has(left.at(-1)!.session)) return null;
  return { changePercent: round(percent(ratios.at(-1)!, ratios.at(-14)!)) };
}

function combineRelativeStrength(market: number, sector: number): WeinsteinTechnicalAnalysisEnvelope["relativeStrengthStatus"] {
  if (market > 3 && sector > 3) return "STRENGTHENING";
  if (market < -3 || sector < -3) return "WEAKENING";
  return "NEUTRAL";
}
function strengthClass(value: number): WeinsteinTechnicalAnalysisEnvelope["sectorStrength"] {
  if (value > 8) return "LEADING"; if (value > 3) return "IMPROVING"; if (value < -8) return "LAGGING"; if (value < -3) return "WEAKENING"; return "NEUTRAL";
}
function hasEnvironmentalHeadwind(market: WeinsteinStage, sector: WeinsteinStage,
  strength: WeinsteinTechnicalAnalysisEnvelope["sectorStrength"]): boolean {
  return market !== "STAGE_2" || sector !== "STAGE_2" || strength === "WEAKENING" || strength === "LAGGING";
}
function extensionMetrics(stock: SeriesAnalysis): Pick<WeinsteinTechnicalAnalysisEnvelope,
  "extensionFromBreakoutPercent" | "extensionFromSupportPercent" | "extensionRisk"> {
  const extensionFromBreakoutPercent = stock.breakoutWeek === null ? null
    : round(Math.max(0, percent(stock.close, stock.resistance.upper)));
  const nearestSupport = stock.breakoutWeek !== null && stock.close >= stock.resistance.lower
    ? stock.resistance.upper : stock.support.upper;
  const extensionFromSupportPercent = round(Math.max(0, percent(stock.close, nearestSupport)));
  const extension = Math.max(Math.abs(stock.priceVsMa30wPercent), extensionFromBreakoutPercent ?? 0, extensionFromSupportPercent);
  return { extensionFromBreakoutPercent, extensionFromSupportPercent,
    extensionRisk: extension >= 25 ? "HIGH" : extension >= 12 ? "MEDIUM" : "LOW" };
}
function entryQualityFor(entryEligible: boolean, triple: WeinsteinTechnicalAnalysisEnvelope["tripleConfirmation"],
  confirmations: number, extensionRisk: WeinsteinTechnicalAnalysisEnvelope["extensionRisk"], headwind: boolean): WeinsteinTechnicalAnalysisEnvelope["entryQuality"] {
  if (!entryEligible) return "NOT_APPLICABLE";
  const quality = triple === "3/3" && extensionRisk === "LOW" ? "HIGH"
    : confirmations >= 2 && extensionRisk !== "HIGH" ? "MEDIUM" : "LOW";
  if (!headwind) return quality;
  return quality === "HIGH" ? "MEDIUM" : quality === "MEDIUM" ? "LOW" : quality;
}
function marketSectorCounterevidence(market: WeinsteinStage, sector: WeinsteinStage,
  strength: WeinsteinTechnicalAnalysisEnvelope["sectorStrength"]): string[] {
  const evidence: string[] = [];
  if (market === "STAGE_4") evidence.push("大盘处于 Stage 4，构成长线做多结构否决。");
  else if (market !== "STAGE_2") evidence.push(`大盘尚未确认 Stage 2（当前 ${market}），切入质量已下调。`);
  if (sector === "STAGE_4") evidence.push("所属行业处于 Stage 4，构成长线做多结构否决。");
  else if (sector !== "STAGE_2") evidence.push(`所属行业尚未确认 Stage 2（当前 ${sector}），切入质量已下调。`);
  if (strength === "WEAKENING" || strength === "LAGGING") evidence.push(`行业相对大盘为 ${strength}，切入质量已下调。`);
  return evidence;
}
function volumeClass(ratio4: number, ratio10: number, percentile: number): WeinsteinTechnicalAnalysisEnvelope["volumeConfirmation"] {
  if (ratio4 < 0.8 && ratio10 < 0.8 && percentile < 40) return "WEAK";
  if (ratio4 >= 1.5 && ratio10 >= 1.5 && percentile >= 80) return "VERY_STRONG";
  if (ratio4 >= 1.2 && ratio10 >= 1.2 && percentile >= 70) return "STRONG";
  return "NORMAL";
}
function entryStateFor(stage: WeinsteinStage, breakout: SeriesAnalysis["breakoutStatus"], triple: WeinsteinTechnicalAnalysisEnvelope["tripleConfirmation"], retestConfirmed: boolean, relativeStrengthStatus: WeinsteinTechnicalAnalysisEnvelope["relativeStrengthStatus"]): WeinsteinEntryState {
  if (stage === "STAGE_4") return "EXIT"; if (stage === "STAGE_3") return "STAGE_3_WARNING";
  if (stage === "STAGE_2" && retestConfirmed && relativeStrengthStatus === "STRENGTHENING") return "RETEST_WATCH";
  if (stage === "STAGE_2" && breakout === "CONFIRMED" && triple === "3/3") return "BREAKOUT_CONFIRMED";
  if (stage === "STAGE_2") return "HOLD_STAGE_2"; if (stage === "STAGE_1" && breakout === "WATCH") return "BREAKOUT_WATCH";
  if (stage === "STAGE_1") return "BASE_FORMING"; return "WATCH";
}
function binding(role: WeinsteinSourceBindingRole, series: WeinsteinWeeklySeriesInput) {
  return { role, symbol: series.symbol, name: series.name, adjustment: series.adjustment, barCount: series.bars.length,
    firstWeek: series.bars[0]!.session, lastWeek: series.bars.at(-1)!.session, inputHash: sha256Canonical(series) };
}
function weeklyChart(stock: WeinsteinWeeklyBar[], market: WeinsteinWeeklyBar[], sector: WeinsteinWeeklyBar[]): WeinsteinTechnicalAnalysisEnvelope["weeklyChart"] {
  const averages = movingAverage(stock.map((bar) => bar.close), 30);
  const marketByWeek = new Map(market.map((bar) => [bar.session, bar.close]));
  const sectorByWeek = new Map(sector.map((bar) => [bar.session, bar.close]));
  const first = stock.find((bar) => marketByWeek.has(bar.session) && sectorByWeek.has(bar.session))!;
  const marketBase = first.close / marketByWeek.get(first.session)!;
  const sectorBase = first.close / sectorByWeek.get(first.session)!;
  return stock.map((bar, index) => {
    const marketClose = marketByWeek.get(bar.session);
    const sectorClose = sectorByWeek.get(bar.session);
    return {
      ...bar,
      ma30w: averages[index] === null ? null : round(averages[index]!),
      marketRelativeStrength: marketClose ? round((bar.close / marketClose) / marketBase * 100) : null,
      sectorRelativeStrength: sectorClose ? round((bar.close / sectorClose) / sectorBase * 100) : null
    };
  });
}
function scoreFactorsFor(value: {
  market: SeriesAnalysis; sector: SeriesAnalysis; stock: SeriesAnalysis;
  sectorStrength: WeinsteinTechnicalAnalysisEnvelope["sectorStrength"];
  volumeConfirmation: WeinsteinTechnicalAnalysisEnvelope["volumeConfirmation"];
  relativeStrengthStatus: WeinsteinTechnicalAnalysisEnvelope["relativeStrengthStatus"];
  structuralVeto: boolean; extensionRisk: WeinsteinTechnicalAnalysisEnvelope["extensionRisk"];
}): WeinsteinScoreFactor[] {
  const stageScore = (stage: WeinsteinStage, maximum: number) => stage === "STAGE_2" ? maximum
    : stage === "STAGE_1" || stage === "TRANSITION" ? Math.round(maximum * 0.5) : stage === "STAGE_3" ? Math.round(maximum * 0.25) : 0;
  const factors: WeinsteinScoreFactor[] = [
    { id: "market", label: "大盘阶段", score: stageScore(value.market.stage, 15), maxScore: 15, assessment: `${value.market.stage} / ${value.market.direction}` },
    { id: "sector", label: "行业阶段", score: Math.max(0, stageScore(value.sector.stage, 15) - (["WEAKENING", "LAGGING"].includes(value.sectorStrength) ? 4 : 0)), maxScore: 15, assessment: `${value.sector.stage} / ${value.sectorStrength}` },
    { id: "stock_stage", label: "个股阶段", score: stageScore(value.stock.stage, 20), maxScore: 20, assessment: `${value.stock.stage} / ${value.stock.phase}` },
    { id: "price_structure", label: "价格结构", score: ({ CONFIRMED: 15, HISTORICAL: 12, WATCH: 8, NONE: 5, FAILED: 0 })[value.stock.breakoutStatus], maxScore: 15, assessment: value.stock.breakoutStatus },
    { id: "volume", label: "量能确认", score: ({ VERY_STRONG: 15, STRONG: 12, NORMAL: 7, WEAK: 2, UNKNOWN: 0 })[value.volumeConfirmation], maxScore: 15, assessment: value.volumeConfirmation },
    { id: "relative_strength", label: "相对强度", score: ({ STRENGTHENING: 10, NEUTRAL: 6, WEAKENING: 2, UNKNOWN: 0 })[value.relativeStrengthStatus], maxScore: 10, assessment: value.relativeStrengthStatus },
    { id: "risk", label: "结构风险", score: value.structuralVeto ? 0 : value.extensionRisk === "HIGH" ? 2 : value.extensionRisk === "MEDIUM" ? 6 : 10, maxScore: 10, assessment: value.structuralVeto ? "STAGE_4_VETO" : `EXTENSION_${value.extensionRisk}` }
  ];
  return factors;
}
type WeinsteinSourceBindingRole = "stock" | "market" | "sector";
function structuralZone(window: WeinsteinWeeklyBar[], allBars: WeinsteinWeeklyBar[], field: "high" | "low", basis: string, resistance: boolean): WeinsteinZone | null {
  const pivots = window.flatMap((bar, index) => {
    if (index === 0 || index === window.length - 1) return [];
    const previous = window[index - 1]![field];
    const next = window[index + 1]![field];
    const turning = resistance ? bar[field] >= previous && bar[field] >= next : bar[field] <= previous && bar[field] <= next;
    return turning ? [{ candidate: bar, touchIndex: index }] : [];
  });
  const candidates = pivots.flatMap(({ candidate: bar }) => {
    const touches = pivots.filter(({ candidate }) => Math.abs(candidate[field] / bar[field] - 1) <= 0.04);
    const span = touches.at(-1)!.touchIndex - touches[0]!.touchIndex;
    return touches.length >= 2 && span >= 2 ? [{ touches, span, level: average(touches.map(({ candidate }) => candidate[field])) }] : [];
  });
  candidates.sort((left, right) => right.touches.at(-1)!.touchIndex - left.touches.at(-1)!.touchIndex
    || right.touches.length - left.touches.length || right.span - left.span || right.level - left.level);
  const selected = candidates[0];
  if (!selected) return null;
  const values = selected.touches.map(({ candidate }) => candidate[field]);
  const lower = round(Math.min(...values) * 0.995);
  const upper = round(Math.max(...values) * 1.005);
  const firstWeek = selected.touches[0]!.candidate.session;
  const lastWeek = selected.touches.at(-1)!.candidate.session;
  const later = allBars.filter((bar) => bar.session > firstWeek);
  const failedBreakoutCount = resistance
    ? later.filter((bar) => bar.high > upper * 1.01 && bar.close < lower).length
    : later.filter((bar) => bar.low < lower * 0.99 && bar.close > upper).length;
  return { lower, upper, basis, touchCount: selected.touches.length, firstWeek, lastWeek, failedBreakoutCount };
}
function detectsRetest(bars: WeinsteinWeeklyBar[], resistance: WeinsteinZone, breakoutIndex: number): boolean {
  const start = Math.max(1, bars.length - 12);
  if (breakoutIndex < start || breakoutIndex >= bars.length - 2) return false;
  const retestOffset = bars.slice(breakoutIndex + 1, -1).findIndex((bar) => bar.low <= resistance.upper * 1.02);
  if (retestOffset < 0) return false;
  const retestIndex = breakoutIndex + 1 + retestOffset;
  const retest = bars[retestIndex]!;
  if (!retest || retest.low < resistance.lower || retest.close < resistance.lower) return false;
  if (bars.slice(retestIndex + 1).some((bar) => bar.low < resistance.lower || bar.close < resistance.lower)) return false;
  const breakout = bars[breakoutIndex]!;
  const latest = bars.at(-1)!;
  return retest.volume < breakout.volume && latest.close >= resistance.upper && latest.volume > retest.volume;
}
function percent(value: number, base: number): number { return base === 0 ? 0 : (value / base - 1) * 100; }
function average(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function round(value: number): number { const result = Number(value.toFixed(6)); return Object.is(result, -0) ? 0 : result; }
function format(value: number): string { return value.toFixed(2); }
function zoneText(value: WeinsteinZone): string { return `${format(value.lower)}-${format(value.upper)}`; }
function summary(symbol: string, stage: WeinsteinStage, phase: SeriesAnalysis["phase"], entry: WeinsteinEntryState, veto: boolean): string {
  const state = entry === "EXIT" ? "个股 Stage 4，退出警示"
    : veto ? "存在 Stage 4 结构否决，不采取行动" : entryText(entry);
  return `${symbol} 当前为 ${stage}${phase === "NOT_APPLICABLE" ? "" : ` ${phase}`}，状态为 ${state}；结论仅绑定现有证据，不是价格预测。`;
}
function entryText(value: WeinsteinEntryState): string { return ({
  NO_ACTION: "不采取行动", WATCH: "继续观察", BASE_FORMING: "底部形成中", BREAKOUT_WATCH: "观察突破",
  BREAKOUT_CONFIRMED: "突破已确认", RETEST_WATCH: "观察回踩", HOLD_STAGE_2: "维持 Stage 2 观察",
  STAGE_3_WARNING: "Stage 3 警示", REDUCE: "减仓警示", EXIT: "退出警示"
})[value]; }
function directionText(value: WeinsteinDirection): string { return ({ RISING: "上升", FLAT: "走平", FALLING: "下降", UNKNOWN: "未知" })[value]; }
function volumeText(value: WeinsteinTechnicalAnalysisEnvelope["volumeConfirmation"]): string { return ({ WEAK: "偏弱", NORMAL: "正常", STRONG: "较强", VERY_STRONG: "很强", UNKNOWN: "未知" })[value]; }
function safety(): WeinsteinTechnicalAnalysisEnvelope["safety"] { return { advisoryOnly: true, createsOrder: false, createsTrade: false, mutatesCash: false, mutatesFee: false, mutatesPosition: false, callsBroker: false, productionWrite: false }; }
function dataInsufficient(symbol: string, analysisAsOf: string, ...unknowns: string[]): WeinsteinTechnicalAnalysisEnvelope {
  return {
    schemaVersion: WEINSTEIN_SCHEMA_VERSION, computationVersion: WEINSTEIN_COMPUTATION_VERSION,
    status: "data_insufficient", symbol, market: "HK", analysisAsOf, completedWeekEnd: null, sectorIdentityAsOf: null, sourceFetchedAt: null,
    provider: null, dataset: null, hashMethod: null, datasetHash: null,
    dataQuality: "DATA_INSUFFICIENT", inputHash: null, resultHash: null, sources: [],
    marketStage: "UNKNOWN", marketStageConfidence: "UNKNOWN", marketMa30wDirection: "UNKNOWN",
    sectorStage: "UNKNOWN", sectorStageConfidence: "UNKNOWN", sectorMa30wDirection: "UNKNOWN", sectorStrength: "UNKNOWN",
    stockStage: "UNKNOWN", stockStageConfidence: "UNKNOWN", stockStagePhase: "UNKNOWN",
    ma30w: null, ma30wDirection: "UNKNOWN", priceVsMa30wPercent: null, supportZones: [], resistanceZones: [], overheadSupplyRisk: "UNKNOWN",
    breakoutStatus: "UNKNOWN", breakoutWeek: null, breakoutLevel: null,
    volumeConfirmation: "UNKNOWN", volumeRatio: null, volumeRatio4Week: null,
    volumePercentile: null, relativeStrengthStatus: "UNKNOWN",
    tripleConfirmation: "UNKNOWN", entryState: "NO_ACTION", entryQuality: "UNKNOWN", extensionRisk: "UNKNOWN",
    extensionFromBreakoutPercent: null, extensionFromSupportPercent: null, invalidationZone: null,
    holdingState: "UNKNOWN", exitWarning: "UNKNOWN", shortState: "DISABLED", overallConfidence: "UNKNOWN",
    totalScore: null, scoreFactors: [], weeklyChart: [],
    summary: WEINSTEIN_DATA_INSUFFICIENT_SUMMARY,
    supportingEvidence: [], counterevidence: [WEINSTEIN_DATA_INSUFFICIENT_COUNTEREVIDENCE],
    unknowns: unknowns.length ? unknowns : ["必需的周线证据不可用。"],
    nextObservations: [WEINSTEIN_DATA_INSUFFICIENT_NEXT_OBSERVATION], safety: safety()
  };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
