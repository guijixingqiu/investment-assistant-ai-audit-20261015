import { areInstantsChronologicallyOrdered } from "./chronology.js";
import { isRfc3339DateTime } from "./factMetadata.js";

export const MARKET_ENVIRONMENT_SCHEMA_VERSION = "2026-08-04.hk-market-environment.v1";
export const MARKET_ENVIRONMENT_INDEX_SYMBOLS = ["HK.800000", "HK.800100", "HK.800700"] as const;
const SOURCE_CLOCK_SKEW_MS = 60_000;
const SOURCE_FRESH_MAX_AGE_MS = 30 * 60_000;

export type MarketEnvironmentStatus = "available" | "unavailable";
export type MarketEnvironmentFreshness = "fresh" | "closed_last_observation" | "stale";

export interface MarketEnvironmentIndexFact {
  symbol: (typeof MARKET_ENVIRONMENT_INDEX_SYMBOLS)[number];
  name: string;
  last: number;
  previousClose: number;
  changePercent: number;
  turnover: number;
  amplitudePercent: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  asOf: string;
}

export interface MarketEnvironmentSectorFact {
  code: string;
  name: string;
  last: number;
  previousClose: number;
  changePercent: number;
  turnover: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  asOf: string;
}

export interface MarketEnvironmentCapitalFlow {
  symbol: string;
  asOf: string;
  lastValidAt: string;
  currency: "HKD";
  netFlow: number;
  superFlow: number;
  bigFlow: number;
  mediumFlow: number;
  smallFlow: number;
}

export interface MarketEnvironmentData {
  market: "HK";
  selectedSymbol: string;
  marketState: string;
  indices: MarketEnvironmentIndexFact[];
  sectors: {
    universeCount: number;
    leaders: MarketEnvironmentSectorFact[];
    laggards: MarketEnvironmentSectorFact[];
  };
  breadth: {
    advancers: number;
    decliners: number;
    unchanged: number;
    advanceRatio: number;
  };
  selectedStockCapitalFlow: MarketEnvironmentCapitalFlow | null;
  risk: {
    breadthSignal: "broad_strength" | "mixed" | "broad_weakness";
    sectorDispersionPercent: number;
    hsiAmplitudePercent: number;
  };
  unknowns: string[];
}

export interface MarketEnvironmentEnvelope {
  schemaVersion: typeof MARKET_ENVIRONMENT_SCHEMA_VERSION;
  status: MarketEnvironmentStatus;
  requestedSymbol: string;
  asOf: string | null;
  source: {
    provider: "futu_opend" | "unavailable";
    endpoint: "market-environment" | null;
    fetchedAt: string | null;
    quoteDataOnly: true;
  };
  data: MarketEnvironmentData | null;
  message: string;
}

export function makeUnavailableMarketEnvironmentEnvelope(
  requestedSymbol: string,
  message: string
): MarketEnvironmentEnvelope {
  return {
    schemaVersion: MARKET_ENVIRONMENT_SCHEMA_VERSION,
    status: "unavailable",
    requestedSymbol,
    asOf: null,
    source: { provider: "unavailable", endpoint: null, fetchedAt: null, quoteDataOnly: true },
    data: null,
    message
  };
}

export function marketEnvironmentFreshness(
  envelope: MarketEnvironmentEnvelope,
  now = new Date()
): MarketEnvironmentFreshness {
  if (!record(envelope.source) || !record(envelope.data)) return "stale";
  const fetchedAt = Date.parse(envelope.source.fetchedAt ?? "");
  const asOf = Date.parse(envelope.asOf ?? "");
  const fetchedAge = now.getTime() - fetchedAt;
  if (envelope.status !== "available" || !envelope.data
    || !Number.isFinite(fetchedAt) || !Number.isFinite(asOf)
    || fetchedAge < 0 || fetchedAge > SOURCE_FRESH_MAX_AGE_MS) return "stale";
  if (marketEnvironmentUsesLastCompletedObservation(envelope.data.marketState)) return "closed_last_observation";
  return sameHongKongDay(envelope.asOf!, now.toISOString()) ? "fresh" : "stale";
}

export function marketEnvironmentUsesLastCompletedObservation(marketState: string): boolean {
  return marketState === "CLOSED" || marketState === "PRE_OPEN";
}

export function marketEnvironmentBindsDailySession(
  envelope: MarketEnvironmentEnvelope,
  lastCompletedSession: string,
  now = new Date()
): boolean {
  const freshness = marketEnvironmentFreshness(envelope, now);
  if (freshness === "fresh") return true;
  if (freshness === "closed_last_observation" && envelope.data?.marketState === "PRE_OPEN") {
    const envelopeDay = hongKongDay(envelope.asOf!);
    return [...envelope.data.sectors.leaders, ...envelope.data.sectors.laggards]
      .every((item) => hongKongDay(item.asOf) === lastCompletedSession)
      && envelope.data.indices.every((item) => {
        const day = hongKongDay(item.asOf);
        return day === lastCompletedSession || day === envelopeDay;
      });
  }
  return freshness === "closed_last_observation"
    && /^\d{4}-\d{2}-\d{2}$/.test(lastCompletedSession)
    && hongKongDay(envelope.asOf!) === lastCompletedSession;
}

export function validateMarketEnvironmentEnvelope(
  value: unknown,
  now = new Date()
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["envelope must be an object"] };
  if (value.schemaVersion !== MARKET_ENVIRONMENT_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  if (value.status !== "available" && value.status !== "unavailable") errors.push("status is invalid");
  if (!hkStock(value.requestedSymbol)) errors.push("requestedSymbol must be canonical HK.<five digits>");
  if (!record(value.source) || value.source.quoteDataOnly !== true) errors.push("source must be quote-data-only");
  if (typeof value.message !== "string" || !value.message.trim()) errors.push("message is required");

  if (value.status === "unavailable") {
    if (value.asOf !== null || value.data !== null
      || !record(value.source) || value.source.provider !== "unavailable"
      || value.source.endpoint !== null || value.source.fetchedAt !== null) {
      errors.push("unavailable environment must clear facts and source timestamps");
    }
    return errors.length ? { ok: false, errors } : { ok: true };
  }

  if (!instant(value.asOf) || !record(value.source)
    || value.source.provider !== "futu_opend" || value.source.endpoint !== "market-environment"
    || !instant(value.source.fetchedAt)
    || Date.parse(value.asOf) > Date.parse(value.source.fetchedAt) + SOURCE_CLOCK_SKEW_MS
    || !areInstantsChronologicallyOrdered([value.source.fetchedAt, now.toISOString()])) {
    errors.push("available environment source chronology is invalid");
  }
  if (marketEnvironmentFreshness(value as unknown as MarketEnvironmentEnvelope, now) === "stale") {
    errors.push("available environment source is stale");
  }
  const sourceFetchedAt = record(value.source) ? String(value.source.fetchedAt) : "";
  validateData(value.data, String(value.requestedSymbol), String(value.asOf), sourceFetchedAt, errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

function validateData(
  value: unknown,
  requestedSymbol: string,
  envelopeAsOf: string,
  sourceFetchedAt: string,
  errors: string[]
): void {
  if (!record(value)) { errors.push("data is required"); return; }
  if (value.market !== "HK" || value.selectedSymbol !== requestedSymbol || !nonEmpty(value.marketState)) {
    errors.push("market environment identity is invalid");
  }
  if (!Array.isArray(value.indices) || value.indices.length !== MARKET_ENVIRONMENT_INDEX_SYMBOLS.length) {
    errors.push("indices must contain HSI, HSCEI and HSTECH");
  } else {
    value.indices.forEach((item, index) => validateIndex(
      item, MARKET_ENVIRONMENT_INDEX_SYMBOLS[index]!, envelopeAsOf, value.marketState === "PRE_OPEN", errors
    ));
  }
  if (!record(value.sectors) || !integer(value.sectors.universeCount, 10)
    || !Array.isArray(value.sectors.leaders) || value.sectors.leaders.length !== 5
    || !Array.isArray(value.sectors.laggards) || value.sectors.laggards.length !== 5) {
    errors.push("sector leaders and laggards must each contain five items from a real universe");
  } else {
    const leaders = value.sectors.leaders;
    const laggards = value.sectors.laggards;
    [...leaders, ...laggards].forEach((item) => validateSector(item, envelopeAsOf, value.marketState === "PRE_OPEN", errors));
    const codes = [...leaders, ...laggards].map((item) => record(item) ? item.code : null);
    if (new Set(codes).size !== codes.length) errors.push("sector leaders and laggards must not overlap");
    if (!ordered(leaders, "descending") || !ordered(laggards, "ascending")) errors.push("sector ordering is invalid");
  }
  validateBreadth(value.breadth, errors);
  if (value.selectedStockCapitalFlow !== null) {
    validateCapitalFlow(value.selectedStockCapitalFlow, requestedSymbol, envelopeAsOf, sourceFetchedAt, errors);
  }
  validateRisk(value.risk, errors);
  if (!Array.isArray(value.unknowns) || value.unknowns.some((item) => !nonEmpty(item))) errors.push("unknowns must be strings");
}

function validateIndex(value: unknown, expectedSymbol: string, envelopeAsOf: string, allowEarlierObservation: boolean, errors: string[]): void {
  if (!record(value) || value.symbol !== expectedSymbol || !nonEmpty(value.name)
    || !positive(value.last) || !positive(value.previousClose) || !finite(value.changePercent)
    || !nonNegative(value.turnover) || !nonNegative(value.amplitudePercent)
    || !integer(value.advancers) || !integer(value.decliners) || !integer(value.unchanged)
    || !instant(value.asOf) || value.asOf > envelopeAsOf || (!allowEarlierObservation && !sameHongKongDay(value.asOf, envelopeAsOf))
    || !approximately(Number(value.changePercent), (Number(value.last) / Number(value.previousClose) - 1) * 100)) {
    errors.push(`index ${expectedSymbol} is invalid`);
  }
}

function validateSector(value: unknown, envelopeAsOf: string, allowEarlierObservation: boolean, errors: string[]): void {
  if (!record(value) || typeof value.code !== "string" || !/^HK\.LIST\d+$/.test(value.code)
    || !nonEmpty(value.name) || !positive(value.last) || !positive(value.previousClose)
    || !finite(value.changePercent) || !nonNegative(value.turnover)
    || !integer(value.advancers) || !integer(value.decliners) || !integer(value.unchanged)
    || !instant(value.asOf) || value.asOf > envelopeAsOf || (!allowEarlierObservation && !sameHongKongDay(value.asOf, envelopeAsOf))
    || !approximately(Number(value.changePercent), (Number(value.last) / Number(value.previousClose) - 1) * 100)) {
    errors.push("sector fact is invalid");
  }
}

function validateBreadth(value: unknown, errors: string[]): void {
  if (!record(value) || !integer(value.advancers) || !integer(value.decliners) || !integer(value.unchanged)
    || !finite(value.advanceRatio) || Number(value.advanceRatio) < 0 || Number(value.advanceRatio) > 1) {
    errors.push("breadth is invalid");
    return;
  }
  const total = Number(value.advancers) + Number(value.decliners) + Number(value.unchanged);
  if (total <= 0 || !approximately(Number(value.advanceRatio), Number(value.advancers) / total)) errors.push("breadth ratio is invalid");
}

function validateCapitalFlow(
  value: unknown,
  symbol: string,
  envelopeAsOf: string,
  sourceFetchedAt: string,
  errors: string[]
): void {
  if (!record(value) || value.symbol !== symbol || value.currency !== "HKD" || !instant(value.asOf)
    || !instant(value.lastValidAt) || value.asOf > envelopeAsOf
    || !sameHongKongDay(value.asOf, envelopeAsOf)
    || !sameHongKongDay(value.asOf, value.lastValidAt)
    || !areInstantsChronologicallyOrdered([value.asOf, value.lastValidAt])
    || Math.abs(Date.parse(value.lastValidAt) - Date.parse(sourceFetchedAt)) > 300_000
    || ![value.netFlow, value.superFlow, value.bigFlow, value.mediumFlow, value.smallFlow].every(finite)) {
    errors.push("selected-stock capital flow is invalid");
  }
}

function validateRisk(value: unknown, errors: string[]): void {
  if (!record(value) || !["broad_strength", "mixed", "broad_weakness"].includes(String(value.breadthSignal))
    || !nonNegative(value.sectorDispersionPercent) || !nonNegative(value.hsiAmplitudePercent)) {
    errors.push("market risk facts are invalid");
  }
}

function ordered(values: unknown[], direction: "ascending" | "descending"): boolean {
  const changes = values.map((item) => record(item) ? Number(item.changePercent) : Number.NaN);
  return changes.every((value, index) => Number.isFinite(value) && (index === 0
    || (direction === "ascending" ? value >= changes[index - 1]! : value <= changes[index - 1]!)));
}

function approximately(left: number, right: number): boolean { return Math.abs(left - right) <= 0.000_001; }
function sameHongKongDay(left: string, right: string): boolean {
  return hongKongDay(left) === hongKongDay(right);
}
function hongKongDay(value: string): string { return new Date(Date.parse(value) + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10); }
function hkStock(value: unknown): boolean { return typeof value === "string" && /^HK\.\d{5}$/.test(value); }
function instant(value: unknown): value is string { return typeof value === "string" && isRfc3339DateTime(value) && Number.isFinite(Date.parse(value)); }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function finite(value: unknown): boolean { return typeof value === "number" && Number.isFinite(value); }
function positive(value: unknown): boolean { return finite(value) && Number(value) > 0; }
function nonNegative(value: unknown): boolean { return finite(value) && Number(value) >= 0; }
function integer(value: unknown, minimum = 0): boolean { return Number.isSafeInteger(value) && Number(value) >= minimum; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
