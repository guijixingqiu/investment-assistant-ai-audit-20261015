import {
  MARKET_TECHNICAL_COMPUTATION_VERSION,
  MARKET_TECHNICAL_SCHEMA_VERSION,
  technicalParameters,
  technicalResultHash,
  type DailyBarsEnvelope,
  type TechnicalAnalysisEnvelope,
  type TechnicalPoint
} from "../../../../packages/contracts/src/marketDaily.js";

export function calculateTechnicalAnalysis(dailyBars: DailyBarsEnvelope): TechnicalAnalysisEnvelope {
  if (dailyBars.status !== "available" || !dailyBars.snapshot) {
    return unavailableTechnical(
      dailyBars.status === "available" ? "incomplete" : dailyBars.status,
      `Technical analysis is ${dailyBars.status}; a validated available daily snapshot is required.`
    );
  }

  const bars = dailyBars.snapshot.bars;
  const closes = bars.map((bar) => bar.close);
  const ma20 = movingAverage(closes, 20);
  const ma60 = movingAverage(closes, 60);
  const macd = calculateMacd(closes, 12, 26, 9);
  const bollinger = calculateBollinger(closes, 20, 2);
  const rsi = calculateWilderRsi(closes, 14);
  const points: TechnicalPoint[] = bars.map((bar, index) => ({
    session: bar.session,
    candle: { open: bar.open, high: bar.high, low: bar.low, close: bar.close },
    volume: bar.volume,
    ma20: formatOutput(ma20[index]),
    ma60: formatOutput(ma60[index]),
    macd: {
      ema12: formatOutput(macd.ema12[index]),
      ema26: formatOutput(macd.ema26[index]),
      line: formatOutput(macd.line[index]),
      signal: formatOutput(macd.signal[index]),
      histogram: formatOutput(macd.histogram[index])
    },
    bollinger20: bollinger[index] === null ? null : {
      middle: formatOutput(bollinger[index]!.middle)!,
      standardDeviation: formatOutput(bollinger[index]!.standardDeviation)!,
      upper: formatOutput(bollinger[index]!.upper)!,
      lower: formatOutput(bollinger[index]!.lower)!
    },
    rsi14: formatOutput(rsi[index])
  }));
  const latest = points.at(-1);
  if (!latest || latest.ma20 === null || latest.ma60 === null || latest.bollinger20 === null || latest.rsi14 === null) {
    return unavailableTechnical("incomplete", "Technical analysis is incomplete because one or more core indicators cannot be computed.");
  }

  const output: TechnicalAnalysisEnvelope = {
    schemaVersion: MARKET_TECHNICAL_SCHEMA_VERSION,
    status: "available",
    computationVersion: MARKET_TECHNICAL_COMPUTATION_VERSION,
    parameters: technicalParameters(),
    inputSnapshotSha: dailyBars.snapshot.snapshotSha,
    dataCutoffAt: dailyBars.source.dataCutoffAt,
    resultHash: null,
    points,
    message: "Backend-computed daily candles, volume, MA20, MA60, MACD 12/26/9, Bollinger 20±2 population SD, and Wilder RSI14."
  };
  output.resultHash = technicalResultHash(output);
  return output;
}

export function movingAverage(values: number[], period: number): Array<number | null> {
  let sum = 0;
  return values.map((value, index) => {
    sum += value;
    if (index >= period) sum -= values[index - period]!;
    return index + 1 < period ? null : sum / period;
  });
}

export function calculateMacd(
  values: number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number
): {
  ema12: Array<number | null>;
  ema26: Array<number | null>;
  line: Array<number | null>;
  signal: Array<number | null>;
  histogram: Array<number | null>;
} {
  const fast = exponentialMovingAverage(values, fastPeriod);
  const slow = exponentialMovingAverage(values, slowPeriod);
  const line = values.map((_, index) => fast[index] === null || slow[index] === null ? null : fast[index]! - slow[index]!);
  const compactLine = line.filter((value): value is number => value !== null);
  const compactSignal = exponentialMovingAverage(compactLine, signalPeriod);
  const firstLineIndex = line.findIndex((value) => value !== null);
  const signal = line.map((value, index) => value === null ? null : compactSignal[index - firstLineIndex] ?? null);
  const histogram = line.map((value, index) => value === null || signal[index] === null ? null : value - signal[index]!);
  return { ema12: fast, ema26: slow, line, signal, histogram };
}

export function calculateBollinger(
  values: number[],
  period: number,
  deviations: number
): Array<TechnicalPoint["bollinger20"]> {
  return values.map((_, index) => {
    if (index + 1 < period) return null;
    const window = values.slice(index + 1 - period, index + 1);
    const middle = window.reduce((sum, value) => sum + value, 0) / period;
    const variance = window.reduce((sum, value) => sum + (value - middle) ** 2, 0) / period;
    const standardDeviation = Math.sqrt(variance);
    const spread = standardDeviation * deviations;
    return { middle, standardDeviation, upper: middle + spread, lower: middle - spread };
  });
}

export function calculateWilderRsi(values: number[], period: number): Array<number | null> {
  const output: Array<number | null> = values.map(() => null);
  if (values.length <= period) return output;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index]! - values[index - 1]!;
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  output[period] = rsiValue(averageGain, averageLoss);
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index]! - values[index - 1]!;
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    output[index] = rsiValue(averageGain, averageLoss);
  }
  return output;
}

export function exponentialMovingAverage(values: number[], period: number): Array<number | null> {
  const output: Array<number | null> = values.map(() => null);
  if (values.length < period) return output;
  const multiplier = 2 / (period + 1);
  let previous = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  output[period - 1] = previous;
  for (let index = period; index < values.length; index += 1) {
    previous = (values[index]! - previous) * multiplier + previous;
    output[index] = previous;
  }
  return output;
}

function rsiValue(averageGain: number, averageLoss: number): number | null {
  if (averageGain === 0 && averageLoss === 0) return null;
  if (averageLoss === 0) return 100;
  return 100 - 100 / (1 + averageGain / averageLoss);
}

function formatOutput(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const rounded = Number(value.toFixed(8));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function unavailableTechnical(status: "incomplete" | "unavailable", message: string): TechnicalAnalysisEnvelope {
  return {
    schemaVersion: MARKET_TECHNICAL_SCHEMA_VERSION,
    status,
    computationVersion: MARKET_TECHNICAL_COMPUTATION_VERSION,
    parameters: technicalParameters(),
    inputSnapshotSha: null,
    dataCutoffAt: null,
    resultHash: null,
    points: null,
    message
  };
}
