import {
  validateMarketQuoteEnvelope,
  type KnownHongKongStock,
  type MarketQuoteEnvelope
} from "../../../packages/contracts/src/market.js";
import type { DailyTechnicalEnvelope } from "../../../packages/contracts/src/marketDaily.js";
import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import { sameWebApiAuth, type WebApiAuth } from "./apiClient.js";
import { requestJson } from "./dailyResearchCockpitData.js";
import type { MarketContextFacts } from "./marketContextConsole.js";

export async function refreshMarketContextFromProvider(options: {
  symbol: KnownHongKongStock;
  writeAuth: WebApiAuth;
  currentWriteAuth: () => WebApiAuth | null;
  readAuth: WebApiAuth;
  currentReadAuth: () => WebApiAuth | null;
  isCurrent: () => boolean;
  readFresh: () => Promise<MarketContextFacts>;
}): Promise<MarketContextFacts> {
  const { symbol, writeAuth, currentWriteAuth, readAuth, currentReadAuth, isCurrent, readFresh } = options;
  const quoteValue = await requestJson(
    `/api/internal/market/refresh/${symbol.market}/${symbol.code}`,
    writeAuth,
    { method: "POST" }
  );
  assertCurrent(writeAuth, currentWriteAuth, readAuth, currentReadAuth, isCurrent);
  const quote = acceptRefreshedQuote(quoteValue, symbol);
  const dailyValue = await requestJson(
    `/api/internal/market/daily-bars/refresh/${symbol.market}/${symbol.code}`,
    writeAuth,
    { method: "POST" }
  );
  assertCurrent(writeAuth, currentWriteAuth, readAuth, currentReadAuth, isCurrent);
  const daily = acceptRefreshedDaily(dailyValue, symbol);
  const fresh = await readFresh();
  assertCurrent(writeAuth, currentWriteAuth, readAuth, currentReadAuth, isCurrent);
  if (!sameQuoteProof(quote, fresh.quote) || !sameDailyProof(daily, fresh.daily)) {
    throw new Error("Fresh Market GET did not match the exact quote and daily refresh proof.");
  }
  return fresh;
}

function acceptRefreshedQuote(value: unknown, symbol: KnownHongKongStock): MarketQuoteEnvelope {
  const validation = validateMarketQuoteEnvelope(value);
  if (!validation.ok) throw new Error(`Quote refresh response is malformed: ${validation.errors.join("; ")}`);
  const quote = value as MarketQuoteEnvelope;
  if ((quote.status !== "live" && quote.status !== "stale")
    || quote.source.provider !== "futu" || quote.source.providerStatus !== quote.status
    || !quote.data || quote.requestedSymbol !== symbol.symbol
    || quote.data.market !== symbol.market || quote.data.code !== symbol.code || quote.data.symbol !== symbol.symbol
    || quote.metadata.missing || quote.metadata.conflict) {
    throw new Error("Quote refresh response is unavailable or bound to another symbol.");
  }
  return quote;
}

function acceptRefreshedDaily(value: unknown, symbol: KnownHongKongStock): DailyTechnicalEnvelope {
  if (!record(value) || !record(value.dailyBars) || !record(value.technical)) {
    throw new Error("Daily refresh response is malformed.");
  }
  const daily = value as unknown as DailyTechnicalEnvelope;
  const bars = daily.dailyBars;
  if (daily.completeness !== "complete" || !daily.usableForRequestedCutoff
    || bars.status !== "available" || daily.technical.status !== "available" || !bars.snapshot
    || bars.request.market !== symbol.market || bars.request.code !== symbol.code || bars.request.symbol !== symbol.symbol) {
    throw new Error("Daily refresh response is incomplete, stale, or bound to another symbol.");
  }
  return daily;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameQuoteProof(refreshed: MarketQuoteEnvelope, fresh: MarketQuoteEnvelope): boolean {
  return refreshed.requestedSymbol === fresh.requestedSymbol && refreshed.asOf === fresh.asOf
    && refreshed.source.fetchedAt === fresh.source.fetchedAt
    && canonicalJson(refreshed.source) === canonicalJson(fresh.source)
    && canonicalJson(refreshed.data) === canonicalJson(fresh.data);
}

function sameDailyProof(refreshed: DailyTechnicalEnvelope, fresh: DailyTechnicalEnvelope): boolean {
  const refreshedSnapshot = refreshed.dailyBars.snapshot;
  const freshSnapshot = fresh.dailyBars.snapshot;
  return Boolean(refreshedSnapshot && freshSnapshot
    && canonicalJson(refreshed.dailyBars.request) === canonicalJson(fresh.dailyBars.request)
    && refreshedSnapshot.snapshotSha === freshSnapshot.snapshotSha
    && refreshed.dailyBars.source.sourceContentHash === fresh.dailyBars.source.sourceContentHash
    && refreshed.dailyBars.source.dataCutoffAt === fresh.dailyBars.source.dataCutoffAt
    && refreshed.dailyBars.source.fetchedAt === fresh.dailyBars.source.fetchedAt
    && refreshed.technical.inputSnapshotSha === fresh.technical.inputSnapshotSha
    && refreshed.technical.resultHash === fresh.technical.resultHash
    && refreshed.technical.dataCutoffAt === fresh.technical.dataCutoffAt);
}

function assertCurrent(
  writeAuth: WebApiAuth,
  currentWriteAuth: () => WebApiAuth | null,
  readAuth: WebApiAuth,
  currentReadAuth: () => WebApiAuth | null,
  isCurrent: () => boolean
): void {
  if (!isCurrent() || !sameWebApiAuth(writeAuth, currentWriteAuth()) || !sameWebApiAuth(readAuth, currentReadAuth())) {
    throw new Error("Market symbol, authorization, or request generation changed during explicit refresh.");
  }
}
