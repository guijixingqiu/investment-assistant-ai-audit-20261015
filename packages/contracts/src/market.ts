import type { FactMetadata } from "./factMetadata.js";
import { isRfc3339DateTime, makeFactMetadata, validateFactMetadataInto } from "./factMetadata.js";
import { areInstantsChronologicallyOrdered } from "./chronology.js";

export const MARKET_QUOTE_SCHEMA_VERSION = "2026-06-17.gate-a.v1";
export const MARKET_SEARCH_SCHEMA_VERSION = "2026-08-10.hk-stock-search.v2";

export const MARKET_STATUSES = ["live", "stale", "unavailable"] as const;

export type MarketStatus = (typeof MARKET_STATUSES)[number];

export interface MarketQuoteData {
  market: string;
  code: string;
  symbol: string;
  name: string | null;
  currency: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  quoteTime: string;
}

export interface MarketQuoteSource {
  provider: "futu" | "fixture" | "cache" | "unavailable";
  providerStatus: MarketStatus;
  fetchedAt: string | null;
}

export interface MarketQuoteEnvelope {
  schemaVersion: typeof MARKET_QUOTE_SCHEMA_VERSION;
  status: MarketStatus;
  asOf: string | null;
  requestedSymbol: string;
  source: MarketQuoteSource;
  metadata: FactMetadata;
  data: MarketQuoteData | null;
  message: string;
}

export interface KnownHongKongStock {
  market: "HK";
  code: string;
  symbol: string;
  name: string | null;
}

export type MarketSearchScope = "futu_opend_hk_stocks" | "local_known_stocks";

export interface MarketSearchSource {
  provider: "futu_opend" | "local_database" | "unavailable";
  fetchedAt: string | null;
  quoteDataOnly: true;
}

export interface MarketSearchEnvelope {
  schemaVersion: typeof MARKET_SEARCH_SCHEMA_VERSION;
  status: "available" | "unavailable";
  query: string;
  scope: MarketSearchScope;
  source: MarketSearchSource;
  results: KnownHongKongStock[];
  message: string;
}

export function validateMarketSearchEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["envelope must be an object"] };
  if (value.schemaVersion !== MARKET_SEARCH_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  if (value.status !== "available" && value.status !== "unavailable") errors.push("status is invalid");
  if (typeof value.query !== "string" || value.query.trim().length === 0 || value.query.length > 80) {
    errors.push("query must contain 1 to 80 characters");
  }
  if (value.scope !== "futu_opend_hk_stocks" && value.scope !== "local_known_stocks") errors.push("scope is invalid");
  validateMarketSearchSource(value, errors);
  validateMarketSearchResults(value, errors);
  if (typeof value.message !== "string" || value.message.trim().length === 0) errors.push("message is required");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateMarketSearchSource(value: Record<string, unknown>, errors: string[]): void {
  const source = value.source;
  if (!isRecord(source)) {
    errors.push("source must be an object");
    return;
  }
  if (!isMarketSearchProvider(source.provider)) errors.push("source.provider is invalid");
  if (source.quoteDataOnly !== true) errors.push("source.quoteDataOnly must be true");
  if (source.fetchedAt !== null && (typeof source.fetchedAt !== "string"
    || !isRfc3339DateTime(source.fetchedAt) || !Number.isFinite(Date.parse(source.fetchedAt)))) {
    errors.push("source.fetchedAt must be a strict RFC3339 instant or null");
  }
  if (value.status === "available") {
    if (value.scope === "futu_opend_hk_stocks" && source.provider !== "futu_opend"
      || value.scope === "local_known_stocks" && source.provider !== "local_database") {
      errors.push("available search source must match scope");
    }
    if (source.fetchedAt === null) errors.push("available search source requires fetchedAt");
  } else if (source.provider !== "unavailable" || source.fetchedAt !== null) {
    errors.push("unavailable search must clear source identity");
  }
}

function validateMarketSearchResults(value: Record<string, unknown>, errors: string[]): void {
  const results = value.results;
  if (!Array.isArray(results) || results.length > 20) {
    errors.push("results must contain at most 20 items");
  } else {
    for (const result of results) {
      if (!isRecord(result)
        || result.market !== "HK"
        || typeof result.code !== "string" || !/^\d{5}$/.test(result.code)
        || result.symbol !== `HK.${result.code}`
        || !(result.name === null || typeof result.name === "string" && result.name.trim().length > 0)) {
        errors.push("each result must be an exact Hong Kong stock identity");
      }
    }
  }
  if (value.status === "unavailable" && Array.isArray(results) && results.length > 0) {
    errors.push("unavailable search must not expose results");
  }
  if (Array.isArray(results) && new Set(results.map((result) => isRecord(result) ? result.symbol : null)).size !== results.length) {
    errors.push("search results must not contain duplicate identities");
  }
}

export function makeUnavailableMarketSearchEnvelope(query: string, message: string): MarketSearchEnvelope {
  return {
    schemaVersion: MARKET_SEARCH_SCHEMA_VERSION,
    status: "unavailable",
    query,
    scope: "local_known_stocks",
    source: { provider: "unavailable", fetchedAt: null, quoteDataOnly: true },
    results: [],
    message
  };
}

function isMarketSearchProvider(value: unknown): value is MarketSearchSource["provider"] {
  return value === "futu_opend" || value === "local_database" || value === "unavailable";
}

export function isMarketStatus(value: unknown): value is MarketStatus {
  return typeof value === "string" && MARKET_STATUSES.includes(value as MarketStatus);
}

export function validateMarketQuoteEnvelope(
  value: unknown,
  now = new Date()
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["envelope must be an object"] };
  }

  if (value.schemaVersion !== MARKET_QUOTE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${MARKET_QUOTE_SCHEMA_VERSION}`);
  }

  if (!isMarketStatus(value.status)) {
    errors.push("status must be live, stale, or unavailable");
  }

  if (value.asOf !== null && (typeof value.asOf !== "string" || !isStrictInstant(value.asOf))) {
    errors.push("asOf must be a strict RFC3339 instant or null");
  }

  if (typeof value.requestedSymbol !== "string" || value.requestedSymbol.length === 0) {
    errors.push("requestedSymbol must be a non-empty string");
  }

  if (!isRecord(value.source)) {
    errors.push("source must be an object");
  } else {
    if (!["futu", "fixture", "cache", "unavailable"].includes(String(value.source.provider))) {
      errors.push("source.provider must be futu, fixture, cache, or unavailable");
    }
    if (!isMarketStatus(value.source.providerStatus)) {
      errors.push("source.providerStatus must be live, stale, or unavailable");
    }
    if (value.source.fetchedAt !== null && (typeof value.source.fetchedAt !== "string" || !isStrictInstant(value.source.fetchedAt))) {
      errors.push("source.fetchedAt must be a strict RFC3339 instant or null");
    }
  }

  validateFactMetadataInto(value.metadata, "metadata", errors);
  if (isRecord(value.metadata)) {
    if (value.status === "live" && value.metadata.freshness !== "fresh") {
      errors.push("metadata.freshness must be fresh when status is live");
    }
    if (value.status === "stale" && value.metadata.freshness !== "stale") {
      errors.push("metadata.freshness must be stale when status is stale");
    }
    if (value.status === "unavailable" && value.metadata.freshness === "fresh") {
      errors.push("metadata.freshness must not be fresh when status is unavailable");
    }
  }

  if (typeof value.message !== "string") {
    errors.push("message must be a string");
  }

  if (value.status === "unavailable") {
    if (value.data !== null) {
      errors.push("data must be null when status is unavailable");
    }
    if (value.asOf !== null || (isRecord(value.source) && value.source.fetchedAt !== null)
      || (isRecord(value.metadata) && (value.metadata.asOf !== null || value.metadata.fetchedAt !== null))) {
      errors.push("unavailable quote must clear envelope, source, and metadata timestamps");
    }
  } else {
    if (!isValidQuoteData(value.data)) {
      errors.push("data must contain a valid quote when status is live or stale");
    } else {
      validateQuoteIdentity(value.requestedSymbol, value.data, errors);
      validateQuoteChronology(value, value.data, errors, now);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function makeUnavailableMarketQuoteEnvelope(
  message: string,
  provider: MarketQuoteSource["provider"] = "unavailable",
  requestedSymbol = "UNKNOWN"
): MarketQuoteEnvelope {
  return {
    schemaVersion: MARKET_QUOTE_SCHEMA_VERSION,
    status: "unavailable",
    asOf: null,
    requestedSymbol,
    source: {
      provider,
      providerStatus: "unavailable",
      fetchedAt: null
    },
    metadata: makeFactMetadata({
      source: `market_quotes:${provider}`,
      asOf: null,
      fetchedAt: null,
      freshness: "unavailable",
      provenance: provider === "fixture" ? "fixture" : provider === "cache" ? "cache" : "unavailable",
      authority: "unavailable",
      stale: false,
      missing: false,
      conflict: false,
      fixture: provider === "fixture",
      correctionOf: null,
      replaces: null,
      message
    }),
    data: null,
    message
  };
}

function validateQuoteIdentity(requestedSymbol: unknown, data: MarketQuoteData, errors: string[]): void {
  const canonicalSymbol = `${data.market}.${data.code}`;
  if (data.symbol !== canonicalSymbol || data.symbol !== requestedSymbol) {
    errors.push("data identity must match requestedSymbol");
  }
}

function validateQuoteChronology(
  envelope: Record<string, unknown>,
  data: MarketQuoteData,
  errors: string[],
  now: Date
): void {
  const source = isRecord(envelope.source) ? envelope.source : null;
  const metadata = isRecord(envelope.metadata) ? envelope.metadata : null;
  if (!source || !areInstantsChronologicallyOrdered([data.quoteTime, source.fetchedAt, now.toISOString()])) {
    errors.push("market quote must satisfy quoteTime <= source.fetchedAt <= validation time");
  }
  if (envelope.asOf !== data.quoteTime || metadata?.asOf !== data.quoteTime || metadata?.fetchedAt !== source?.fetchedAt) {
    errors.push("market quote envelope and metadata timestamps must bind quote data and source identity");
  }
}

function isValidQuoteData(value: unknown): value is MarketQuoteData {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.market === "string"
    && typeof value.code === "string"
    && typeof value.symbol === "string"
    && (typeof value.name === "string" || value.name === null)
    && typeof value.currency === "string"
    && typeof value.price === "number"
    && Number.isFinite(value.price)
    && value.price > 0
    && (value.previousClose === null
      || typeof value.previousClose === "number" && Number.isFinite(value.previousClose) && value.previousClose > 0)
    && (value.change === null || typeof value.change === "number" && Number.isFinite(value.change))
    && (value.changePercent === null || typeof value.changePercent === "number" && Number.isFinite(value.changePercent))
    && typeof value.quoteTime === "string"
    && isStrictInstant(value.quoteTime);
}

function isStrictInstant(value: string): boolean {
  return isRfc3339DateTime(value) && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
