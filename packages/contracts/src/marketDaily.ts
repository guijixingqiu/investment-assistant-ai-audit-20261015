import { canonicalJson } from "./decisionContextBrowser.js";
import type { FactMetadata } from "./factMetadata.js";
import { isRfc3339DateTime, validateFactMetadataInto } from "./factMetadata.js";
import { validateCompletedSessionEvidence, type HkexCompletedSessionEvidence } from "./marketDailyCalendarEvidence.js";
import {
  dailyBarsDataHash,
  dailyBarsSnapshotHash,
  legacyDailyBarsSnapshotHash,
  sha256Canonical,
  technicalResultHash
} from "./marketDailyHashes.js";
export { dailyBarsDataHash, dailyBarsSnapshotHash, sha256Canonical, technicalResultHash } from "./marketDailyHashes.js";
export type { HkexCompletedSessionEvidence } from "./marketDailyCalendarEvidence.js";
export const MARKET_DAILY_SCHEMA_VERSION = "2026-07-29.f1a-daily.v3";
export const MARKET_TECHNICAL_SCHEMA_VERSION = "2026-07-29.f1a-technical.v3";
export const MARKET_TECHNICAL_COMPUTATION_VERSION = "f1a.indicators.3";
export const DAILY_CONTENT_HASH_METHOD = "sha256_canonical_json_v1";
export const DAILY_TIMEFRAME = "1d";
export const DAILY_ADJUSTMENT = "forward_qfq_research_only";
export const DAILY_MINIMUM_BARS = 80;
export const DAILY_TARGET_BARS = 120;
export const DAILY_STATUSES = ["available", "incomplete", "unavailable"] as const;
export type DailyStatus = (typeof DAILY_STATUSES)[number];
export type UsageAuthority = "confirmed" | "unknown" | "denied";
export type DailyProvider = "futu_history_kline" | "repository" | "fixture" | "unavailable";
export interface DailyBar {
  session: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  suspension: boolean;
}
export interface DailyBarsRequestIdentity {
  market: string;
  code: string;
  symbol: string;
  timeframe: typeof DAILY_TIMEFRAME;
  completedSessionsOnly: true;
  adjustment: typeof DAILY_ADJUSTMENT;
  minimumBars: typeof DAILY_MINIMUM_BARS;
  targetBars: typeof DAILY_TARGET_BARS;
  cutoff: string;
}
export interface DailyBarsSource {
  provider: DailyProvider;
  endpoint: string | null;
  fetchedAt: string | null;
  providerCutoff: string | null;
  dataCutoffAt: string | null;
  rights: UsageAuthority;
  retention: UsageAuthority;
  derivedUse: UsageAuthority;
  hashMethod: typeof DAILY_CONTENT_HASH_METHOD;
  rawBytesCaptured: false;
  pageCount: number;
  pageContentHashes: string[];
  sourceContentHash: string | null;
}
export interface DailyBarsQuality {
  gaps: Array<{ session: string; classification: "exchange_holiday" | "symbol_suspension" | "unexplained" }>;
  zeroVolumeSessions: string[];
  suspensionSessions: string[];
}
export interface DailyBarsSnapshot {
  snapshotSha: string;
  dataHash: string;
  calendar: { id: string; version: string; timezone: string };
  lastCompletedSession: string;
  firstSession: string;
  lastSession: string;
  barCount: number;
  expectedSessions: string[];
  completedSessionEvidence: HkexCompletedSessionEvidence | null;
  quality: DailyBarsQuality;
  bars: DailyBar[];
}
export interface DailyBarsEnvelope {
  schemaVersion: typeof MARKET_DAILY_SCHEMA_VERSION;
  status: DailyStatus;
  request: DailyBarsRequestIdentity;
  source: DailyBarsSource;
  metadata: FactMetadata;
  snapshot: DailyBarsSnapshot | null;
  message: string;
}
export interface TechnicalPoint {
  session: string;
  candle: Pick<DailyBar, "open" | "high" | "low" | "close">;
  volume: number;
  ma20: number | null;
  ma60: number | null;
  macd: {
    ema12: number | null;
    ema26: number | null;
    line: number | null;
    signal: number | null;
    histogram: number | null;
  };
  bollinger20: { middle: number; standardDeviation: number; upper: number; lower: number } | null;
  rsi14: number | null;
}
export interface TechnicalAnalysisEnvelope {
  schemaVersion: typeof MARKET_TECHNICAL_SCHEMA_VERSION;
  status: DailyStatus;
  computationVersion: typeof MARKET_TECHNICAL_COMPUTATION_VERSION;
  parameters: {
    ma: [20, 60];
    macd: { fast: 12; slow: 26; signal: 9 };
    bollinger: { window: 20; standardDeviations: 2; variance: "population" };
    rsi: { period: 14; smoothing: "wilder" };
  };
  inputSnapshotSha: string | null;
  dataCutoffAt: string | null;
  resultHash: string | null;
  points: TechnicalPoint[] | null;
  message: string;
}
export interface DailyTechnicalEnvelope {
  completeness: "complete" | "incomplete";
  usableForRequestedCutoff: boolean;
  dailyBars: DailyBarsEnvelope;
  technical: TechnicalAnalysisEnvelope;
}
export function dailySourceContentHash(
  hashMethod: typeof DAILY_CONTENT_HASH_METHOD,
  pageContentHashes: string[]
): string {
  return sha256Canonical({ hashMethod, pageContentHashes });
}
export function validateDailyBarsEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["dailyBars must be an object"] };
  if (value.schemaVersion !== MARKET_DAILY_SCHEMA_VERSION) errors.push("dailyBars.schemaVersion is invalid");
  if (!DAILY_STATUSES.includes(value.status as DailyStatus)) errors.push("dailyBars.status is invalid");
  validateRequest(value.request, errors);
  validateSource(value.source, errors);
  validateFactMetadataInto(value.metadata, "dailyBars.metadata", errors);
  if (typeof value.message !== "string" || !value.message.trim()) errors.push("dailyBars.message must be non-empty");
  if (value.status === "unavailable") {
    if (value.snapshot !== null) errors.push("unavailable dailyBars must clear snapshot");
  } else {
    validateSnapshot(value.snapshot, value.request, value.source, errors);
  }
  if (value.status === "available") validateAvailable(value, errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}
export function validateTechnicalAnalysisEnvelope(
  value: unknown,
  dailyBars?: DailyBarsEnvelope
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["technical must be an object"] };
  if (value.schemaVersion !== MARKET_TECHNICAL_SCHEMA_VERSION) errors.push("technical.schemaVersion is invalid");
  if (!DAILY_STATUSES.includes(value.status as DailyStatus)) errors.push("technical.status is invalid");
  if (value.computationVersion !== MARKET_TECHNICAL_COMPUTATION_VERSION) errors.push("technical.computationVersion is invalid");
  if (canonicalJson(value.parameters) !== canonicalJson(technicalParameters())) errors.push("technical.parameters are invalid");
  if (typeof value.message !== "string" || !value.message.trim()) errors.push("technical.message must be non-empty");
  if (value.status === "available") {
    if (!dailyBars || dailyBars.status !== "available" || !dailyBars.snapshot) errors.push("available technical requires available daily bars");
    if (value.inputSnapshotSha !== dailyBars?.snapshot?.snapshotSha) errors.push("technical inputSnapshotSha is not bound");
    if (value.dataCutoffAt !== dailyBars?.source.dataCutoffAt) errors.push("technical dataCutoffAt is not bound");
    if (!Array.isArray(value.points) || value.points.length !== dailyBars?.snapshot?.bars.length) {
      errors.push("technical.points must align with every input bar");
    } else {
      if (!technicalPointsBindBars(value.points, dailyBars?.snapshot?.bars ?? [])) {
        errors.push("technical candle and volume points do not bind input bars");
      }
      if (!latestIndicatorsComplete(value.points)) errors.push("technical latest core indicators must be complete");
    }
    const expected = technicalResultHash(value as unknown as TechnicalAnalysisEnvelope);
    if (value.resultHash !== expected) errors.push("technical.resultHash does not match canonical result");
  } else if (value.points !== null || value.resultHash !== null) {
    errors.push("non-available technical output must not expose partial computed points");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
export function validateDailyTechnicalEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  if (!record(value)) return { ok: false, errors: ["response must be an object"] };
  const daily = validateDailyBarsEnvelope(value.dailyBars);
  const technical = validateTechnicalAnalysisEnvelope(
    value.technical,
    record(value.dailyBars) ? value.dailyBars as unknown as DailyBarsEnvelope : undefined
  );
  const errors = [...(daily.ok ? [] : daily.errors), ...(technical.ok ? [] : technical.errors)];
  const complete = record(value.dailyBars) && value.dailyBars.status === "available"
    && record(value.technical) && value.technical.status === "available";
  if (value.completeness !== (complete ? "complete" : "incomplete")) errors.push("response.completeness does not match component status");
  if (value.usableForRequestedCutoff !== complete) {
    errors.push("response.usableForRequestedCutoff must be true only for complete facts at the bound cutoff");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
export function dailyTechnicalStateStatus(value: DailyTechnicalEnvelope): DailyStatus {
  if (value.completeness === "complete" && value.usableForRequestedCutoff) return "available";
  return value.dailyBars.status === "unavailable" ? "unavailable" : "incomplete";
}
export function technicalParameters(): TechnicalAnalysisEnvelope["parameters"] {
  return {
    ma: [20, 60],
    macd: { fast: 12, slow: 26, signal: 9 },
    bollinger: { window: 20, standardDeviations: 2, variance: "population" },
    rsi: { period: 14, smoothing: "wilder" }
  };
}
function validateRequest(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("dailyBars.request must be an object"); return; }
  if (value.market !== "HK") errors.push("request.market must be canonical HK");
  if (typeof value.code !== "string" || !/^\d{5}$/.test(value.code)) errors.push("request.code must be exactly five digits");
  if (value.symbol !== `HK.${String(value.code)}`) errors.push("request.symbol must be canonical HK.<five digits>");
  if (value.timeframe !== DAILY_TIMEFRAME) errors.push("request timeframe must be 1d");
  if (value.completedSessionsOnly !== true) errors.push("request must require completed sessions only");
  if (value.adjustment !== DAILY_ADJUSTMENT) errors.push("request adjustment must be forward QFQ research-only");
  if (value.minimumBars !== DAILY_MINIMUM_BARS || value.targetBars !== DAILY_TARGET_BARS) errors.push("request bar thresholds are invalid");
  if (!date(value.cutoff)) errors.push("request.cutoff must be YYYY-MM-DD");
}
function validateSource(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("dailyBars.source must be an object"); return; }
  if (!["futu_history_kline", "repository", "fixture", "unavailable"].includes(String(value.provider))) errors.push("source.provider is invalid");
  if (value.endpoint !== null && (typeof value.endpoint !== "string" || !value.endpoint.trim())) errors.push("source.endpoint is invalid");
  if (value.fetchedAt !== null && (typeof value.fetchedAt !== "string" || !isRfc3339DateTime(value.fetchedAt))) errors.push("source.fetchedAt is invalid");
  if (value.providerCutoff !== null && !date(value.providerCutoff)) errors.push("source.providerCutoff is invalid");
  if (value.dataCutoffAt !== null && (typeof value.dataCutoffAt !== "string" || !isRfc3339DateTime(value.dataCutoffAt))) {
    errors.push("source.dataCutoffAt is invalid");
  }
  for (const key of ["rights", "retention", "derivedUse"]) {
    if (!["confirmed", "unknown", "denied"].includes(String(value[key]))) errors.push(`source.${key} is invalid`);
  }
  if (value.hashMethod !== DAILY_CONTENT_HASH_METHOD) errors.push("source.hashMethod is invalid");
  if (value.rawBytesCaptured !== false) errors.push("source.rawBytesCaptured must remain false");
  if (!Number.isSafeInteger(value.pageCount) || Number(value.pageCount) < 0) errors.push("source.pageCount is invalid");
  if (!Array.isArray(value.pageContentHashes) || value.pageContentHashes.some((hash) => !sha(hash))) {
    errors.push("source.pageContentHashes are invalid");
  }
  if (Array.isArray(value.pageContentHashes) && value.pageCount !== value.pageContentHashes.length) {
    errors.push("source page count/content-hash count mismatch");
  }
  if (value.sourceContentHash !== null && !sha(value.sourceContentHash)) errors.push("source.sourceContentHash is invalid");
  if (Array.isArray(value.pageContentHashes) && value.sourceContentHash !== null
    && value.sourceContentHash !== dailySourceContentHash(DAILY_CONTENT_HASH_METHOD, value.pageContentHashes)) {
    errors.push("source.sourceContentHash does not bind hash method and ordered page content hashes");
  }
}
function validateSnapshot(snapshot: unknown, request: unknown, source: unknown, errors: string[]): void {
  if (!record(snapshot) || !record(request) || !record(source)) { errors.push("dailyBars.snapshot is required"); return; }
  if (!sha(snapshot.snapshotSha) || !sha(snapshot.dataHash)) errors.push("snapshot hashes are invalid");
  if (!record(snapshot.calendar) || snapshot.calendar.id !== "HKEX" || !nonEmpty(snapshot.calendar.version)
    || snapshot.calendar.timezone !== "Asia/Hong_Kong") errors.push("snapshot calendar identity must bind HKEX and Asia/Hong_Kong");
  for (const key of ["lastCompletedSession", "firstSession", "lastSession"]) if (!date(snapshot[key])) errors.push(`snapshot.${key} is invalid`);
  if (!Number.isSafeInteger(snapshot.barCount) || Number(snapshot.barCount) < 0) errors.push("snapshot.barCount is invalid");
  if (!Array.isArray(snapshot.bars)) { errors.push("snapshot.bars must be an array"); return; }
  if (snapshot.barCount !== snapshot.bars.length) errors.push("snapshot.barCount does not match bars");
  validateBars(snapshot.bars, String(request.symbol), String(request.cutoff), String(snapshot.lastCompletedSession), errors);
  validateQuality(snapshot.quality, snapshot.bars, snapshot.expectedSessions, errors);
  validateCompletedSessionEvidence(snapshot.completedSessionEvidence, snapshot, request, source, errors);
  if (snapshot.bars.length) {
    if (snapshot.firstSession !== snapshot.bars[0]?.session || snapshot.lastSession !== snapshot.bars.at(-1)?.session) {
      errors.push("snapshot range does not bind ordered bars");
    }
  }
  if (snapshot.dataHash !== dailyBarsDataHash(snapshot.bars as DailyBar[])) errors.push("snapshot.dataHash does not match bars");
  if (date(source.providerCutoff)
    && (String(snapshot.lastCompletedSession) > source.providerCutoff || source.providerCutoff > String(request.cutoff))) {
    errors.push("snapshot completed-session cutoff chronology is invalid");
  }
  if (!hkDataCutoffAt(source.dataCutoffAt, String(snapshot.lastCompletedSession))
    || isRfc3339DateTime(String(source.fetchedAt))
      && new Date(String(source.fetchedAt)).getTime() < new Date(String(source.dataCutoffAt)).getTime()) {
    errors.push("source.dataCutoffAt must be provider-supplied HK time bound to lastCompletedSession and not after fetchedAt");
  }
  const { snapshotSha: _ignored, ...withoutSha } = snapshot;
  const typedRequest = request as unknown as DailyBarsRequestIdentity;
  const typedSource = source as unknown as DailyBarsSource;
  const typedSnapshot = withoutSha as unknown as Omit<DailyBarsSnapshot, "snapshotSha">;
  if (![dailyBarsSnapshotHash(typedRequest, typedSource, typedSnapshot), legacyDailyBarsSnapshotHash(
    typedRequest,
    typedSource,
    typedSnapshot
  )].includes(String(snapshot.snapshotSha))) errors.push("snapshot.snapshotSha does not match canonical identity");
}

function validateBars(bars: unknown[], _symbol: string, cutoff: string, lastCompleted: string, errors: string[]): void {
  let previous = "";
  for (const [index, value] of bars.entries()) {
    if (!record(value) || !date(value.session)) { errors.push(`bars[${index}] is invalid`); continue; }
    if (value.session <= previous) errors.push("bars must be strictly ordered and unique");
    previous = String(value.session);
    for (const key of ["open", "high", "low", "close", "volume", "turnover"]) {
      if (!finite(value[key])) errors.push(`bars[${index}].${key} is invalid`);
    }
    if (["open", "high", "low", "close"].some((key) => finite(value[key]) && value[key] <= 0)) {
      errors.push(`bars[${index}] prices must be strictly positive`);
    }
    if (finite(value.open) && finite(value.high) && finite(value.low) && finite(value.close)
      && (value.low > Math.min(value.open, value.close) || value.high < Math.max(value.open, value.close) || value.low > value.high)) {
      errors.push(`bars[${index}] OHLC is invalid`);
    }
    if (finite(value.volume) && value.volume < 0 || finite(value.turnover) && value.turnover < 0) errors.push(`bars[${index}] volume/turnover is negative`);
    if (typeof value.suspension !== "boolean") errors.push(`bars[${index}].suspension is invalid`);
    if (String(value.session) > cutoff || String(value.session) > lastCompleted) errors.push("future or incomplete daily bar is forbidden");
  }
}
function validateQuality(value: unknown, bars: unknown[], expectedSessions: unknown, errors: string[]): void {
  if (!record(value) || !Array.isArray(value.gaps) || !Array.isArray(value.zeroVolumeSessions)
    || !Array.isArray(value.suspensionSessions)) { errors.push("snapshot quality is invalid"); return; }
  if (!Array.isArray(expectedSessions) || expectedSessions.some((session) => !date(session))
    || new Set(expectedSessions).size !== expectedSessions.length
    || expectedSessions.some((session, index) => index > 0 && session <= expectedSessions[index - 1])) {
    errors.push("snapshot expected completed sessions are invalid");
    return;
  }
  const zero = bars.filter((bar) => record(bar) && bar.volume === 0).map((bar) => String((bar as Record<string, unknown>).session));
  const suspended = bars.filter((bar) => record(bar) && bar.suspension === true).map((bar) => String((bar as Record<string, unknown>).session));
  if (canonicalJson(value.zeroVolumeSessions) !== canonicalJson(zero)) errors.push("zero-volume classification does not match bars");
  if (canonicalJson(value.suspensionSessions) !== canonicalJson(suspended)) errors.push("suspension classification does not match bars");
  const barSessions = new Set(bars.filter(record).map((bar) => String(bar.session)));
  const gapSessions = new Set<string>();
  for (const gap of value.gaps) {
    if (!record(gap) || !date(gap.session)
      || !["exchange_holiday", "symbol_suspension", "unexplained"].includes(String(gap.classification))) errors.push("gap classification is invalid");
    else if (gapSessions.has(gap.session) || barSessions.has(gap.session)) errors.push("gap sessions must be unique and absent from bars");
    else gapSessions.add(gap.session);
  }
  if (expectedSessions.some((session) => !barSessions.has(session) && !gapSessions.has(session))
    || [...barSessions].some((session) => !expectedSessions.includes(session))
    || [...gapSessions].some((session) => !expectedSessions.includes(session))) {
    errors.push("expected-session coverage does not bind bars and classified gaps");
  }
}
function validateAvailable(value: Record<string, unknown>, errors: string[]): void {
  const source = record(value.source) ? value.source : {};
  const snapshot = record(value.snapshot) ? value.snapshot : {};
  const metadata = record(value.metadata) ? value.metadata : {};
  const fixture = source.provider === "fixture";
  if (!["futu_history_kline", "repository", "fixture"].includes(String(source.provider))) errors.push("available daily bars provider is invalid");
  if (source.rights !== "confirmed" || source.retention !== "confirmed" || source.derivedUse !== "confirmed") errors.push("available daily bars require confirmed rights, retention, and derived use");
  if (!nonEmpty(source.endpoint) || !isRfc3339DateTime(String(source.fetchedAt)) || !date(source.providerCutoff)
    || !isRfc3339DateTime(String(source.dataCutoffAt))) errors.push("available source identity is incomplete");
  if (Number(source.pageCount) < 1 || !sha(source.sourceContentHash)) errors.push("available source requires canonical page and source content hashes");
  if (Number(snapshot.barCount) < DAILY_MINIMUM_BARS) errors.push(`available daily bars require at least ${DAILY_MINIMUM_BARS} bars`);
  if (!record(snapshot.completedSessionEvidence)) errors.push("available daily bars require independent HKEX completed-session evidence");
  if (record(snapshot.quality) && Array.isArray(snapshot.quality.gaps) && snapshot.quality.gaps.length > 0) errors.push("any missing-session gap makes daily bars incomplete without independent corroboration");
  if (fixture
    ? metadata.provenance !== "fixture" || metadata.fixture !== true || metadata.authority !== "research_evidence"
    : metadata.fixture === true || metadata.provenance === "fixture" || metadata.authority !== "market_data") {
    errors.push(fixture
      ? "fixture daily bars must remain explicitly marked as fixture research evidence"
      : "available daily bars require real market_data authority");
  }
  if (metadata.asOf !== source.dataCutoffAt) errors.push("available metadata.asOf must equal provider dataCutoffAt");
  if (metadata.freshness !== "unknown") errors.push("stored daily bars freshness must remain unknown until the HK calendar is re-evaluated");
}
function latestIndicatorsComplete(points: unknown[]): boolean {
  const latest = points.at(-1);
  return record(latest) && finite(latest.ma20) && finite(latest.ma60) && finite(latest.rsi14)
    && record(latest.macd) && finite(latest.macd.ema12) && finite(latest.macd.ema26)
    && finite(latest.macd.line) && finite(latest.macd.signal) && finite(latest.macd.histogram)
    && record(latest.bollinger20) && finite(latest.bollinger20.middle)
    && finite(latest.bollinger20.standardDeviation)
    && finite(latest.bollinger20.upper) && finite(latest.bollinger20.lower);
}
function technicalPointsBindBars(points: unknown[], bars: DailyBar[]): boolean {
  return points.every((point, index) => {
    const bar = bars[index];
    return record(point) && bar !== undefined && point.session === bar.session && point.volume === bar.volume
      && record(point.candle) && point.candle.open === bar.open && point.candle.high === bar.high
      && point.candle.low === bar.low && point.candle.close === bar.close;
  });
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function hkDataCutoffAt(value: unknown, lastCompletedSession: string): value is string {
  return typeof value === "string" && isRfc3339DateTime(value)
    && value.startsWith(`${lastCompletedSession}T`) && value.endsWith("+08:00") && Date.parse(value) >= Date.parse(`${lastCompletedSession}T16:10:00+08:00`);
}
function sha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
