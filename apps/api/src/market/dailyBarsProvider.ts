import {
  DAILY_ADJUSTMENT,
  DAILY_CONTENT_HASH_METHOD,
  DAILY_TIMEFRAME,
  dailySourceContentHash,
  sha256Canonical,
  type DailyBar,
  type DailyBarsQuality,
  type DailyBarsRequestIdentity,
  type DailyProvider,
  type DailyStatus,
  type UsageAuthority
} from "../../../../packages/contracts/src/marketDaily.js";
import { dailyHistoryStart } from "./hkexCompletedSessions.js";

export interface DailyBarsProviderResult {
  status: DailyStatus;
  provider: DailyProvider;
  endpoint: string | null;
  fetchedAt: Date;
  providerCutoff: string | null;
  dataCutoffAt: string | null;
  lastCompletedSession: string | null;
  calendar: { id: string; version: string; timezone: string } | null;
  expectedSessions: string[] | null;
  rights: UsageAuthority;
  retention: UsageAuthority;
  derivedUse: UsageAuthority;
  hashMethod: typeof DAILY_CONTENT_HASH_METHOD;
  rawBytesCaptured: false;
  pageContentHashes: string[];
  sourceContentHash: string | null;
  bars: DailyBar[] | null;
  gaps: DailyBarsQuality["gaps"];
  message: string;
}

export interface DailyBarsProvider {
  readonly name: DailyProvider;
  getDailyBars(request: DailyBarsRequestIdentity): Promise<DailyBarsProviderResult>;
}

export class UnavailableDailyBarsProvider implements DailyBarsProvider {
  readonly name = "unavailable" as const;
  constructor(private readonly reason: string) {}

  async getDailyBars(_request: DailyBarsRequestIdentity): Promise<DailyBarsProviderResult> {
    return unavailableResult(this.reason);
  }
}

export interface FutuHistoryKlineRequest {
  code: string;
  start: string | null;
  end: string;
  ktype: "K_DAY";
  autype: "QFQ";
  fields: ["KL_FIELD.ALL"];
  maxCount: 1000;
  pageReqKey: string | null;
  extendedTime: false;
}

export interface FutuHistoryKlinePage {
  retCode: number;
  code: string;
  timeframe: typeof DAILY_TIMEFRAME;
  adjustment: typeof DAILY_ADJUSTMENT;
  providerCutoff: string;
  dataCutoffAt: string;
  lastCompletedSession: string;
  calendar: { id: string; version: string; timezone: string };
  rights: UsageAuthority;
  retention: UsageAuthority;
  derivedUse: UsageAuthority;
  expectedSessions: string[];
  gaps: DailyBarsQuality["gaps"];
  rows: Array<{
    code: string;
    timeKey: string;
    open: number;
    close: number;
    high: number;
    low: number;
    volume: number;
    turnover: number;
    suspension: boolean;
  }>;
  nextPageReqKey: string | null;
  partial: boolean;
  message?: string;
}

export interface FutuHistoryKlineQuoteClient {
  requestHistoryKline(request: FutuHistoryKlineRequest, signal?: AbortSignal): Promise<FutuHistoryKlinePage>;
}

export class FutuHistoryKlineHttpClient implements FutuHistoryKlineQuoteClient {
  constructor(
    private readonly endpointUrl: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async requestHistoryKline(request: FutuHistoryKlineRequest, signal?: AbortSignal): Promise<FutuHistoryKlinePage> {
    const response = await this.fetchImpl(this.endpointUrl, {
      method: "POST",
      redirect: "error",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(request),
      signal
    });
    if (!response.ok) throw new Error(`history bridge returned HTTP ${response.status}`);
    return await response.json() as FutuHistoryKlinePage;
  }
}

export interface FutuHistoryProviderOptions {
  maxPages?: number;
  pageTimeoutMs?: number;
  now?: () => Date;
}

// Quote-data-only port for Futu OpenAPI request_history_kline. The production
// composition root deliberately does not construct this adapter until a
// separately configured and verified history bridge exists.
export class FutuHistoryKlineDailyBarsProvider implements DailyBarsProvider {
  readonly name = "futu_history_kline" as const;
  private readonly maxPages: number;
  private readonly pageTimeoutMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly client: FutuHistoryKlineQuoteClient,
    options: FutuHistoryProviderOptions = {}
  ) {
    this.maxPages = options.maxPages ?? 20;
    this.pageTimeoutMs = options.pageTimeoutMs ?? 5_000;
    this.now = options.now ?? (() => new Date());
    if (!Number.isSafeInteger(this.maxPages) || this.maxPages < 1) throw new Error("daily history maxPages must be positive");
    if (!Number.isSafeInteger(this.pageTimeoutMs) || this.pageTimeoutMs < 1) throw new Error("daily history pageTimeoutMs must be positive");
  }

  async getDailyBars(request: DailyBarsRequestIdentity): Promise<DailyBarsProviderResult> {
    if (request.market !== "HK" || !/^\d{5}$/.test(request.code)
      || request.symbol !== `HK.${request.code}`) {
      return failed("Futu history request identity must be canonical HK.<five digits>.", []);
    }
    const pages: FutuHistoryKlinePage[] = [];
    const pageContentHashes: string[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    try {
      for (let pageIndex = 0; pageIndex < this.maxPages; pageIndex += 1) {
        if (cursor !== null && seenCursors.has(cursor)) return failed("Futu history pagination repeated a page cursor.", pageContentHashes);
        if (cursor !== null) seenCursors.add(cursor);
        const abortController = new AbortController();
        const page: FutuHistoryKlinePage = await withTimeout(this.client.requestHistoryKline({
          code: request.symbol,
          start: dailyHistoryStart(request.cutoff),
          end: request.cutoff,
          ktype: "K_DAY",
          autype: "QFQ",
          fields: ["KL_FIELD.ALL"],
          maxCount: 1000,
          pageReqKey: cursor,
          extendedTime: false
        }, abortController.signal), this.pageTimeoutMs, abortController);
        pageContentHashes.push(sha256Canonical(page));
        if (!validPage(page, request)) return failed("Futu history page identity, format, rights, or completion state is invalid.", pageContentHashes);
        if (pages.length && !samePageIdentity(pages[0]!, page)) return failed("Futu history pages mixed identity or authority.", pageContentHashes);
        pages.push(page);
        if (page.nextPageReqKey === null) {
          const result = complete(request, pages, pageContentHashes, this.now());
          return validCoverage(result.bars ?? [], page.expectedSessions, page.gaps, page.lastCompletedSession)
            ? result
            : failed("Futu history completed-session coverage is inconsistent or contains unexplained omissions.", pageContentHashes);
        }
        cursor = page.nextPageReqKey;
      }
      return failed("Futu history pagination exceeded the maximum page count.", pageContentHashes);
    } catch (error) {
      return failed(`Futu history quote-data adapter unavailable: ${error instanceof Error ? error.message : String(error)}`, pageContentHashes);
    }
  }
}

function complete(
  request: DailyBarsRequestIdentity,
  pages: FutuHistoryKlinePage[],
  pageContentHashes: string[],
  fetchedAt: Date
): DailyBarsProviderResult {
  const first = pages[0]!;
  const bars = pages.flatMap((page) => page.rows.map((row): DailyBar => ({
    session: row.timeKey.slice(0, 10),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    turnover: row.turnover,
    suspension: row.suspension
  })));
  return {
    status: bars.length >= request.minimumBars && first.gaps.length === 0 ? "available" : "incomplete",
    provider: "futu_history_kline",
    endpoint: "request_history_kline",
    fetchedAt,
    providerCutoff: first.providerCutoff,
    dataCutoffAt: first.dataCutoffAt,
    lastCompletedSession: first.lastCompletedSession,
    calendar: first.calendar,
    expectedSessions: first.expectedSessions,
    rights: first.rights,
    retention: first.retention,
    derivedUse: first.derivedUse,
    hashMethod: DAILY_CONTENT_HASH_METHOD,
    rawBytesCaptured: false,
    pageContentHashes,
    sourceContentHash: dailySourceContentHash(DAILY_CONTENT_HASH_METHOD, pageContentHashes),
    bars,
    gaps: first.gaps,
    message: `Futu quote-data history returned ${bars.length} completed daily bars across ${pages.length} page(s).`
  };
}

function validPage(page: FutuHistoryKlinePage, request: DailyBarsRequestIdentity): boolean {
  return page.retCode === 0 && page.partial === false && page.code === request.symbol
    && page.timeframe === request.timeframe && page.adjustment === request.adjustment
    && /^\d{4}-\d{2}-\d{2}$/.test(page.providerCutoff)
    && /^\d{4}-\d{2}-\d{2}$/.test(page.lastCompletedSession)
    && typeof page.dataCutoffAt === "string" && page.dataCutoffAt.startsWith(`${page.lastCompletedSession}T`)
    && page.dataCutoffAt.endsWith("+08:00") && Number.isFinite(new Date(page.dataCutoffAt).getTime())
    && page.providerCutoff <= request.cutoff && page.lastCompletedSession <= page.providerCutoff
    && page.calendar?.id === "HKEX" && typeof page.calendar.version === "string"
    && page.calendar.version.length > 0 && page.calendar.timezone === "Asia/Hong_Kong"
    && ["confirmed", "unknown", "denied"].includes(page.rights)
    && ["confirmed", "unknown", "denied"].includes(page.retention)
    && ["confirmed", "unknown", "denied"].includes(page.derivedUse)
    && Array.isArray(page.expectedSessions) && page.expectedSessions.every((session) => date(session) && session <= page.lastCompletedSession)
    && Array.isArray(page.gaps) && page.gaps.every((gap) => date(gap.session)
      && gap.session <= page.lastCompletedSession
      && ["exchange_holiday", "symbol_suspension", "unexplained"].includes(gap.classification))
    && Array.isArray(page.rows) && page.rows.every((row) => validRow(row, request.symbol, page.lastCompletedSession))
    && !(page.rows.length === 0 && page.nextPageReqKey !== null)
    && (page.nextPageReqKey === null || typeof page.nextPageReqKey === "string" && page.nextPageReqKey.length > 0);
}

function samePageIdentity(left: FutuHistoryKlinePage, right: FutuHistoryKlinePage): boolean {
  return left.code === right.code && left.timeframe === right.timeframe && left.adjustment === right.adjustment
    && left.providerCutoff === right.providerCutoff && left.lastCompletedSession === right.lastCompletedSession
    && left.dataCutoffAt === right.dataCutoffAt
    && sha256Canonical(left.calendar) === sha256Canonical(right.calendar)
    && sha256Canonical(left.expectedSessions) === sha256Canonical(right.expectedSessions)
    && sha256Canonical(left.gaps) === sha256Canonical(right.gaps)
    && left.rights === right.rights && left.retention === right.retention && left.derivedUse === right.derivedUse;
}

function validCoverage(
  bars: DailyBar[],
  expectedSessions: string[],
  gaps: DailyBarsQuality["gaps"],
  lastCompletedSession: string
): boolean {
  if (new Set(expectedSessions).size !== expectedSessions.length || new Set(bars.map((bar) => bar.session)).size !== bars.length) return false;
  if (expectedSessions.some((session, index) => index > 0 && session <= expectedSessions[index - 1]!)) return false;
  if (bars.some((bar, index) => bar.session > lastCompletedSession || index > 0 && bar.session <= bars[index - 1]!.session)) return false;
  const expected = new Set(expectedSessions);
  const barSessions = new Set(bars.map((bar) => bar.session));
  const gapSessions = new Set(gaps.map((gap) => gap.session));
  if (gapSessions.size !== gaps.length || gaps.some((gap) => !expected.has(gap.session) || barSessions.has(gap.session))) return false;
  return expectedSessions.every((session) => barSessions.has(session) || gapSessions.has(session))
    && bars.every((bar) => expected.has(bar.session));
}

function validRow(
  row: FutuHistoryKlinePage["rows"][number],
  symbol: string,
  lastCompletedSession: string
): boolean {
  const session = typeof row.timeKey === "string" ? row.timeKey.slice(0, 10) : "";
  return row.code === symbol && date(session) && session <= lastCompletedSession
    && [row.open, row.high, row.low, row.close, row.volume, row.turnover].every(Number.isFinite)
    && [row.open, row.high, row.low, row.close].every((value) => value > 0)
    && row.low <= Math.min(row.open, row.close) && row.high >= Math.max(row.open, row.close)
    && row.low <= row.high && row.volume >= 0 && row.turnover >= 0
    && typeof row.suspension === "boolean";
}

function failed(message: string, pageContentHashes: string[]): DailyBarsProviderResult {
  return {
    ...unavailableResult(message),
    provider: "futu_history_kline",
    endpoint: "request_history_kline",
    pageContentHashes,
    sourceContentHash: dailySourceContentHash(DAILY_CONTENT_HASH_METHOD, pageContentHashes)
  };
}

function unavailableResult(message: string): DailyBarsProviderResult {
  return {
    status: "unavailable", provider: "unavailable", endpoint: null, fetchedAt: new Date(),
    providerCutoff: null, dataCutoffAt: null, lastCompletedSession: null, calendar: null, expectedSessions: null,
    rights: "unknown", retention: "unknown", derivedUse: "unknown",
    hashMethod: DAILY_CONTENT_HASH_METHOD, rawBytesCaptured: false,
    pageContentHashes: [], sourceContentHash: null, bars: null, gaps: [], message
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, abortController: AbortController): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          abortController.abort();
          reject(new Error("page timeout"));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
