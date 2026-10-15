import { areInstantsChronologicallyOrdered } from "../../../../packages/contracts/src/chronology.js";

export type QuoteFreshness =
  | { status: "live"; reason: null }
  | { status: "stale"; reason: "quote_time_exceeds_live_max_age" }
  | { status: "unavailable"; reason: "invalid_quote_chronology" };

export function resolveQuoteFreshness(
  quoteTime: Date,
  fetchedAt: Date,
  evaluatedAt: Date,
  liveMaxAgeSeconds: number
): QuoteFreshness {
  if (!Number.isFinite(liveMaxAgeSeconds) || liveMaxAgeSeconds < 0
    || !areInstantsChronologicallyOrdered([quoteTime, fetchedAt, evaluatedAt])) {
    return { status: "unavailable", reason: "invalid_quote_chronology" };
  }
  const ageMs = evaluatedAt.getTime() - quoteTime.getTime();
  return ageMs <= liveMaxAgeSeconds * 1_000
    ? { status: "live", reason: null }
    : { status: "stale", reason: "quote_time_exceeds_live_max_age" };
}

export function resolveQuoteStatus(quoteTime: Date, now: Date, liveMaxAgeSeconds: number): QuoteFreshness["status"] {
  return resolveQuoteFreshness(quoteTime, quoteTime, now, liveMaxAgeSeconds).status;
}

export function normalizeMarketCode(market: string, code: string): { market: string; code: string; symbol: string } {
  const normalizedMarket = market.trim().toUpperCase();
  const normalizedCode = code.trim().toUpperCase();
  return {
    market: normalizedMarket,
    code: normalizedCode,
    symbol: `${normalizedMarket}.${normalizedCode}`
  };
}
