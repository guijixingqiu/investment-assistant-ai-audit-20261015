import type { KnownHongKongStock, MarketQuoteData, MarketStatus } from "../../../../packages/contracts/src/market.js";
import { isRfc3339DateTime } from "../../../../packages/contracts/src/factMetadata.js";
import { normalizeMarketCode } from "./freshness.js";

export interface ProviderQuoteResult {
  status: MarketStatus;
  provider: "futu" | "fixture" | "unavailable";
  failureKind: "identity_conflict" | "invalid_chronology" | "ordinary_unavailable" | null;
  fetchedAt: Date;
  quote: MarketQuoteData | null;
  message: string;
  rawPayload?: unknown;
}

export interface ProviderSearchResult {
  status: "available" | "unavailable";
  fetchedAt: Date | null;
  results: KnownHongKongStock[];
  message: string;
}

export interface MarketDataProvider {
  readonly name: ProviderQuoteResult["provider"];
  getQuote(market: string, code: string): Promise<ProviderQuoteResult>;
  searchHongKongStocks?(query: string): Promise<ProviderSearchResult>;
  researchFunding?(symbol: string, date: string): Promise<ResearchFunding | null>;
  researchPeers?(symbol: string, remainingSources: number): Promise<ResearchPeers | null>;
}
export type ResearchPeers = { symbol: string; retrievedAt: string; plateCode: string; plateName: string; selection: string;
  availableCount: number; items: Array<{ symbol: string; name: string }> };

export type ResearchFunding = { symbol: string; date: string; retrievedAt: string;
  checks: Array<{ name: string; status: "available" | "unavailable"; text: string }> };

export class FixtureMarketDataProvider implements MarketDataProvider {
  readonly name = "fixture" as const;

  async getQuote(market: string, code: string): Promise<ProviderQuoteResult> {
    const normalized = normalizeMarketCode(market, code);
    const now = new Date();
    const fixture = getFixtureQuote(normalized.market, normalized.code, now);

    return {
      status: "live",
      provider: "fixture",
      failureKind: null,
      fetchedAt: now,
      quote: fixture,
      message: "Fixture quote persisted for Gate A contract verification.",
      rawPayload: fixture
    };
  }
}

export class UnavailableMarketDataProvider implements MarketDataProvider {
  readonly name = "unavailable" as const;

  constructor(private readonly reason: string) {}

  async getQuote(market: string, code: string): Promise<ProviderQuoteResult> {
    return {
      status: "unavailable",
      provider: "unavailable",
      failureKind: "ordinary_unavailable",
      fetchedAt: new Date(),
      quote: null,
      message: `${this.reason}: ${market}.${code}`
    };
  }
}

export class FutuHttpMarketDataProvider implements MarketDataProvider {
  readonly name = "futu" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date()
  ) {}

  async researchPeers(symbol: string, remainingSources: number): Promise<ResearchPeers | null> {
    if (!/^HK\.\d{5}$/.test(symbol)) return null;
    const limit = Math.max(1, Math.min(48, Math.floor(remainingSources)));
    try {
      const url = new URL("/research-peers", this.baseUrl); url.searchParams.set("symbol", symbol); url.searchParams.set("limit", String(limit));
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) return null;
      const data = await response.json() as ResearchPeers;
      if (data.symbol !== symbol || !isRfc3339DateTime(data.retrievedAt) || Date.parse(data.retrievedAt) > this.now().getTime() + 1000
        || !/^HK\.(LIST|BK)\d+$/.test(data.plateCode) || typeof data.plateName !== "string" || data.plateName.length > 100
        || !Array.isArray(data.items) || data.items.length > limit || !Number.isInteger(data.availableCount) || data.availableCount < data.items.length
        || typeof data.selection !== "string" || data.selection.length > 300
        || data.items.some(s => !/^HK\.\d{5}$/.test(s.symbol) || s.symbol === symbol || typeof s.name !== "string" || s.name.length > 100)
        || new Set(data.items.map(s => s.symbol)).size !== data.items.length) return null;
      return data;
    } catch { return null; }
  }

  async researchFunding(symbol: string, date: string): Promise<ResearchFunding | null> {
    if (!/^HK\.\d{5}$/.test(symbol) || !/^20\d\d-\d\d-\d\d$/.test(date)) return null;
    try {
      const url = new URL("/research-funding", this.baseUrl);
      url.searchParams.set("symbol", symbol); url.searchParams.set("date", date);
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) return null;
      const data = await response.json() as ResearchFunding;
      if (data.symbol !== symbol || data.date !== date || !isRfc3339DateTime(data.retrievedAt)
        || Date.parse(data.retrievedAt) > this.now().getTime() + 1000 || !Array.isArray(data.checks)
        || data.checks.length > 5 || data.checks.some(c => !["available", "unavailable"].includes(c.status)
          || typeof c.name !== "string" || typeof c.text !== "string" || c.text.length > 12000)) return null;
      return data;
    } catch { return null; }
  }

  async getQuote(market: string, code: string): Promise<ProviderQuoteResult> {
    const normalized = normalizeMarketCode(market, code);
    const url = new URL("/quote", this.baseUrl);
    url.searchParams.set("market", normalized.market);
    url.searchParams.set("ticker", normalized.code);
    try {
      const response = await this.fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000)
      });
      if (!response.ok) {
        const failedAt = this.now();
        return {
          status: "unavailable",
          provider: "futu",
          failureKind: "ordinary_unavailable",
          fetchedAt: failedAt,
          quote: null,
          message: `Futu market-data adapter returned HTTP ${response.status}.`
        };
      }

      const payload = await response.json() as unknown;
      const receivedAt = this.now();
      const parsed = parseFutuHttpPayload(payload, normalized.market, normalized.code, receivedAt);
      if (!parsed.quote) {
        return {
          status: "unavailable",
          provider: "futu",
          failureKind: parsed.failureKind,
          fetchedAt: receivedAt,
          quote: null,
          message: "Futu market-data adapter response did not match the Gate A quote contract.",
          rawPayload: payload
        };
      }

      return {
        status: "live",
        provider: "futu",
        failureKind: null,
        fetchedAt: receivedAt,
        quote: parsed.quote,
        message: "Futu quote fetched through the market-data adapter.",
        rawPayload: payload
      };
    } catch (error) {
      const failedAt = this.now();
      return {
        status: "unavailable",
        provider: "futu",
        failureKind: "ordinary_unavailable",
        fetchedAt: failedAt,
        quote: null,
        message: `Futu market-data adapter unavailable: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async searchHongKongStocks(query: string): Promise<ProviderSearchResult> {
    const url = new URL("/stock-search", this.baseUrl);
    url.searchParams.set("q", query);
    try {
      const response = await this.fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(12_000)
      });
      if (!response.ok) return unavailableSearch(`Futu stock search returned HTTP ${response.status}.`);
      const payload = await response.json() as unknown;
      const parsed = parseFutuSearchPayload(payload, query, this.now());
      return parsed ?? unavailableSearch("Futu stock search response failed identity validation.");
    } catch (error) {
      return unavailableSearch(`Futu stock search unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function getFixtureQuote(market: string, code: string, now: Date): MarketQuoteData {
  const normalized = normalizeMarketCode(market, code);
  const fixtureBySymbol: Record<string, { name: string; currency: string; price: number; previousClose: number }> = {
    "HK.09926": { name: "康方生物", currency: "HKD", price: 74.25, previousClose: 72.8 },
    "HK.00175": { name: "吉利汽车", currency: "HKD", price: 15.34, previousClose: 15.02 }
  };
  const fixture = fixtureBySymbol[normalized.symbol] ?? {
    name: normalized.symbol,
    currency: normalized.market === "HK" ? "HKD" : "USD",
    price: 10,
    previousClose: 10
  };
  const change = round(fixture.price - fixture.previousClose, 4);
  const changePercent = fixture.previousClose === 0 ? null : round(change / fixture.previousClose * 100, 4);

  return {
    ...normalized,
    name: fixture.name,
    currency: fixture.currency,
    price: fixture.price,
    previousClose: fixture.previousClose,
    change,
    changePercent,
    quoteTime: now.toISOString()
  };
}

function parseFutuHttpPayload(
  payload: unknown,
  market: string,
  code: string,
  fetchedAt: Date
): { quote: MarketQuoteData | null; failureKind: ProviderQuoteResult["failureKind"] } {
  if (!isRecord(payload)) {
    return { quote: null, failureKind: "ordinary_unavailable" };
  }

  const data = isRecord(payload.quote)
    ? payload.quote
    : isRecord(payload.data)
      ? payload.data
      : payload;
  const normalized = normalizeMarketCode(market, code);
  const price = toNumber(data.price);
  const previousClose = toNumber(data.previousClose ?? data.previous_close ?? data.prev_close);
  const quoteTimeInput = typeof data.quoteTime === "string"
    ? data.quoteTime
    : typeof data.quote_time === "string"
      ? data.quote_time
      : typeof data.update_time === "string"
        ? data.update_time
        : null;
  const quoteTime = quoteTimeInput === null ? null : normalizeFutuQuoteTime(quoteTimeInput);
  const reportedMarket = typeof data.market === "string" ? data.market : null;
  const reportedCode = typeof data.code === "string"
    ? data.code
    : typeof data.ticker === "string"
      ? data.ticker
      : null;
  const reportedSymbol = typeof data.symbol === "string" ? data.symbol : null;
  const hasCompleteIdentity = reportedSymbol !== null
    || reportedMarket !== null && reportedCode !== null;

  if (!hasCompleteIdentity
    || reportedMarket !== null && reportedMarket !== normalized.market
    || reportedCode !== null && reportedCode !== normalized.code
    || reportedSymbol !== null && reportedSymbol !== normalized.symbol) {
    return { quote: null, failureKind: "identity_conflict" };
  }
  if (quoteTime === null || Date.parse(quoteTime) > fetchedAt.getTime()) {
    return { quote: null, failureKind: "invalid_chronology" };
  }
  if (price === null || price <= 0 || previousClose !== null && previousClose <= 0) {
    return { quote: null, failureKind: "ordinary_unavailable" };
  }

  return { quote: {
    market: normalized.market,
    code: normalized.code,
    symbol: normalized.symbol,
    name: typeof data.name === "string" ? data.name : null,
    currency: typeof data.currency === "string" ? data.currency : "HKD",
    price,
    previousClose,
    change: toNumber(data.change ?? data.change_amount),
    changePercent: toNumber(data.changePercent ?? data.change_percent),
    quoteTime
  }, failureKind: null };
}

function parseFutuSearchPayload(payload: unknown, query: string, receivedAt: Date): ProviderSearchResult | null {
  if (!isRecord(payload) || payload.source !== "futu_opend_hk_stock_basicinfo" || payload.query !== query
    || typeof payload.fetchedAt !== "string" || !isRfc3339DateTime(payload.fetchedAt)
    || !Array.isArray(payload.results) || payload.results.length > 20) return null;
  const fetchedAt = new Date(payload.fetchedAt);
  if (!Number.isFinite(fetchedAt.getTime()) || fetchedAt.getTime() > receivedAt.getTime()) return null;
  const results: KnownHongKongStock[] = [];
  for (const value of payload.results) {
    if (!isRecord(value) || value.market !== "HK" || typeof value.code !== "string" || !/^\d{5}$/.test(value.code)
      || value.symbol !== `HK.${value.code}` || typeof value.name !== "string" || !value.name.trim()) return null;
    results.push({ market: "HK", code: value.code, symbol: value.symbol, name: value.name });
  }
  if (new Set(results.map((result) => result.symbol)).size !== results.length) return null;
  return {
    status: "available",
    fetchedAt,
    results,
    message: "Futu/OpenD returned read-only Hong Kong stock identities."
  };
}

function unavailableSearch(message: string): ProviderSearchResult {
  return { status: "unavailable", fetchedAt: null, results: [], message };
}

function normalizeFutuQuoteTime(value: string): string | null {
  if (isRfc3339DateTime(value) && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  const match = /^(\d{4})-(\d{2})-(\d{2}) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const local = `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
  if (!isRfc3339DateTime(local) || !Number.isFinite(Date.parse(local))) return null;
  const roundTrip = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(local));
  const part = (type: Intl.DateTimeFormatPartTypes) => roundTrip.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}` === value
    ? local
    : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function round(value: number, precision: number): number {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
