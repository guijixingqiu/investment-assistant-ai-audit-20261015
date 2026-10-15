import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import { isRfc3339DateTime } from "../../../../packages/contracts/src/factMetadata.js";
import type { KnownHongKongStock, MarketQuoteData, MarketQuoteEnvelope } from "../../../../packages/contracts/src/market.js";
import { MARKET_QUOTE_SCHEMA_VERSION, makeUnavailableMarketQuoteEnvelope } from "../../../../packages/contracts/src/market.js";
import { normalizeMarketCode, resolveQuoteFreshness } from "./freshness.js";
import type { ProviderQuoteResult } from "./providers.js";

export async function searchKnownHongKongStocks(
  pool: Pick<Pool | PoolClient, "query">,
  query: string
): Promise<KnownHongKongStock[]> {
  const result = await pool.query<KnownHongKongStock>(
    `select market, code, symbol, nullif(btrim(name), '') as name
       from stocks
      where market = 'HK'
        and code ~ '^[0-9]{5}$'
        and symbol = 'HK.' || code
        and (position($1 in lower(code)) > 0
          or position($1 in lower(symbol)) > 0
          or position($1 in lower(coalesce(name, ''))) > 0)
      order by code
      limit 20`,
    [query.trim().toLowerCase()]
  );
  return result.rows;
}

export async function readLatestQuoteEnvelope(
  pool: Pick<Pool | PoolClient, "query">,
  market: string,
  code: string,
  liveMaxAgeSeconds: number,
  now = new Date(),
  asOf?: Date
): Promise<MarketQuoteEnvelope> {
  const normalized = normalizeMarketCode(market, code);
  const result = await pool.query<MarketQuoteRow>(
    `select market, code, symbol, name, currency, price, previous_close, change_amount,
            change_percent, quote_time, fetched_at, provider
       from market_quotes
      where market = $1 and code = $2 ${asOf ? "and quote_time < $3::timestamptz + interval '1 millisecond' and fetched_at < $3::timestamptz + interval '1 millisecond'" : ""}
      order by quote_time desc, fetched_at desc
      limit 1`,
    [normalized.market, normalized.code, ...(asOf ? [asOf] : [])]
  );

  const row = result.rows[0];
  if (!row) {
    const missing = makeUnavailableMarketQuoteEnvelope(`No persisted quote for ${normalized.symbol}.`, "cache", normalized.symbol);
    return {
      ...missing,
      metadata: makeFactMetadata({
        ...missing.metadata,
        freshness: "missing",
        missing: true,
        authority: "market_data",
        message: "No persisted market quote exists for this symbol; freshness is missing, not fresh."
      })
    };
  }

  const quoteTime = new Date(row.quote_time);
  const fetchedAt = new Date(row.fetched_at);
  const provider = row.provider === "fixture" ? "fixture" : row.provider === "futu" ? "futu" : "cache";
  const freshness = resolveQuoteFreshness(quoteTime, fetchedAt, now, liveMaxAgeSeconds);
  if (freshness.status === "unavailable") return invalidQuoteChronologyEnvelope(normalized.symbol);
  const status = freshness.status;

  return {
    schemaVersion: MARKET_QUOTE_SCHEMA_VERSION,
    status,
    asOf: quoteTime.toISOString(),
    requestedSymbol: normalized.symbol,
    source: {
      provider,
      providerStatus: status,
      fetchedAt: fetchedAt.toISOString()
    },
    metadata: makeFactMetadata({
      source: `market_quotes:${provider}`,
      asOf: quoteTime.toISOString(),
      fetchedAt: fetchedAt.toISOString(),
      freshness: status === "live" ? "fresh" : "stale",
      provenance: provider === "fixture" ? "fixture" : provider === "cache" ? "cache" : "real",
      authority: "market_data",
      stale: status === "stale",
      missing: false,
      conflict: false,
      fixture: provider === "fixture",
      correctionOf: null,
      replaces: null,
      message: status === "live"
        ? "Persisted market quote is fresh within the configured local live window."
        : "Persisted market quote is stale and must not be displayed as fresh."
    }),
    data: rowToQuote(row),
    message: status === "live"
      ? `Latest quote for ${normalized.symbol} is live.`
      : `Latest quote for ${normalized.symbol} is stale.`
  };
}

export async function refreshQuote(
  pool: Pool,
  market: string,
  code: string,
  providerResult: ProviderQuoteResult,
  liveMaxAgeSeconds: number,
  correlationId = crypto.randomUUID()
): Promise<MarketQuoteEnvelope> {
  const normalized = normalizeMarketCode(market, code);
  const evaluatedAt = new Date();
  if (providerResult.failureKind === "identity_conflict") {
    return invalidQuoteIntegrityEnvelope(normalized.symbol);
  }
  if (providerResult.failureKind === "invalid_chronology") {
    return invalidQuoteChronologyEnvelope(normalized.symbol);
  }
  if (providerResult.quote && (
    providerResult.quote.market !== normalized.market
    || providerResult.quote.code !== normalized.code
    || providerResult.quote.symbol !== normalized.symbol
  )) {
    return makeUnavailableMarketQuoteEnvelope(
      `Provider quote identity does not match ${normalized.symbol}; no quote facts were written.`,
      providerResult.provider,
      normalized.symbol
    );
  }
  if (providerResult.quote && !hasValidQuotePrices(providerResult.quote)) {
    return makeUnavailableMarketQuoteEnvelope(
      `Quote prices are invalid for ${normalized.symbol}; quote facts are unavailable.`,
      providerResult.provider,
      normalized.symbol
    );
  }
  if (providerResult.quote && (
    !isRfc3339DateTime(providerResult.quote.quoteTime)
    || !Number.isFinite(Date.parse(providerResult.quote.quoteTime))
    || Date.parse(providerResult.quote.quoteTime) > providerResult.fetchedAt.getTime()
    || providerResult.fetchedAt.getTime() > evaluatedAt.getTime()
    || resolveQuoteFreshness(
      new Date(providerResult.quote.quoteTime), providerResult.fetchedAt, evaluatedAt, liveMaxAgeSeconds
    ).status === "unavailable"
  )) return invalidQuoteChronologyEnvelope(normalized.symbol);
  const jobId = crypto.randomUUID();
  const idempotencyKey = `market-refresh:${normalized.symbol}:${providerResult.fetchedAt.toISOString().slice(0, 16)}`;
  const client = await pool.connect();

  try {
    await client.query("begin");
    await createRefreshRun(client, jobId, idempotencyKey, correlationId, normalized.symbol);

    if (providerResult.quote) {
      await persistQuote(client, providerResult.quote, providerResult.provider, providerResult.fetchedAt, providerResult.rawPayload ?? providerResult.quote);
    }

    await completeRefreshRun(client, jobId, providerResult.quote ? "succeeded" : "failed", providerResult.quote ? null : providerResult.message, {
      provider: providerResult.provider,
      providerStatus: providerResult.status,
      message: providerResult.message
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  if (!providerResult.quote) {
    const cached = await readLatestQuoteEnvelope(pool, normalized.market, normalized.code, liveMaxAgeSeconds);
    if (cached.status === "unavailable") {
      return makeUnavailableMarketQuoteEnvelope(providerResult.message, providerResult.provider, normalized.symbol);
    }
    return {
      ...cached,
      status: "stale",
      source: {
        ...cached.source,
        providerStatus: "unavailable"
      },
      metadata: makeFactMetadata({
        ...cached.metadata,
        freshness: "stale",
        stale: true,
        message: "Provider refresh failed; cached quote is explicitly stale."
      }),
      message: `${providerResult.message} Returning cached quote as stale.`
    };
  }

  return readLatestQuoteEnvelope(pool, normalized.market, normalized.code, liveMaxAgeSeconds, evaluatedAt);
}

function hasValidQuotePrices(quote: MarketQuoteData): boolean {
  return Number.isFinite(quote.price)
    && quote.price > 0
    && (quote.previousClose === null || Number.isFinite(quote.previousClose) && quote.previousClose > 0)
    && (quote.change === null || Number.isFinite(quote.change))
    && (quote.changePercent === null || Number.isFinite(quote.changePercent));
}

function invalidQuoteChronologyEnvelope(symbol: string): MarketQuoteEnvelope {
  const invalid = makeUnavailableMarketQuoteEnvelope(
    `Quote chronology is invalid for ${symbol}; quote facts are unavailable.`, "unavailable", symbol
  );
  return {
    ...invalid,
    metadata: makeFactMetadata({
      ...invalid.metadata,
      freshness: "conflict",
      conflict: true,
      message: "Quote chronology must satisfy quoteTime <= fetchedAt <= evaluatedAt; conflicting facts are hidden."
    })
  };
}

function invalidQuoteIntegrityEnvelope(symbol: string): MarketQuoteEnvelope {
  const invalid = makeUnavailableMarketQuoteEnvelope(
    `Provider quote identity conflicts with ${symbol}; quote facts are unavailable.`,
    "unavailable",
    symbol
  );
  return {
    ...invalid,
    metadata: makeFactMetadata({
      ...invalid.metadata,
      freshness: "conflict",
      conflict: true,
      message: "Provider identity conflict was rejected before cache access or persistence."
    })
  };
}

async function createRefreshRun(client: PoolClient, jobId: string, idempotencyKey: string, correlationId: string, symbol: string): Promise<void> {
  await client.query(
    `insert into data_refresh_runs
      (job_id, job_type, idempotency_key, status, attempt_count, started_at, correlation_id, metadata)
     values ($1, 'market_quote_refresh', $2, 'running', 1, now(), $3, $4::jsonb)`,
    [jobId, idempotencyKey, correlationId, JSON.stringify({ symbol })]
  );
}

async function completeRefreshRun(
  client: PoolClient,
  jobId: string,
  status: "succeeded" | "failed",
  lastError: string | null,
  metadata: Record<string, unknown>
): Promise<void> {
  await client.query(
    `update data_refresh_runs
        set status = $2,
            finished_at = now(),
            last_error = $3,
            metadata = metadata || $4::jsonb
      where job_id = $1`,
    [jobId, status, lastError, JSON.stringify(metadata)]
  );
}

async function persistQuote(client: PoolClient, quote: MarketQuoteData, provider: string, fetchedAt: Date, rawPayload: unknown): Promise<void> {
  const normalized = normalizeMarketCode(quote.market, quote.code);
  const stock = await client.query<{ id: string }>(
    `insert into stocks (market, code, symbol, name)
     values ($1, $2, $3, $4)
     on conflict (market, code)
     do update set symbol = excluded.symbol, name = coalesce(excluded.name, stocks.name), updated_at = now()
     returning id`,
    [normalized.market, normalized.code, normalized.symbol, quote.name]
  );

  await client.query(
    `insert into market_quotes
      (stock_id, market, code, symbol, provider, provider_status, name, currency, price,
       previous_close, change_amount, change_percent, quote_time, fetched_at, raw_payload)
     values
      ($1, $2, $3, $4, $5, 'live', $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
    [
      stock.rows[0]?.id,
      normalized.market,
      normalized.code,
      normalized.symbol,
      provider,
      quote.name,
      quote.currency,
      quote.price,
      quote.previousClose,
      quote.change,
      quote.changePercent,
      quote.quoteTime,
      fetchedAt.toISOString(),
      JSON.stringify(rawPayload)
    ]
  );
}

function rowToQuote(row: MarketQuoteRow): MarketQuoteData {
  return {
    market: row.market,
    code: row.code,
    symbol: row.symbol,
    name: row.name,
    currency: row.currency,
    price: Number(row.price),
    previousClose: row.previous_close === null ? null : Number(row.previous_close),
    change: row.change_amount === null ? null : Number(row.change_amount),
    changePercent: row.change_percent === null ? null : Number(row.change_percent),
    quoteTime: new Date(row.quote_time).toISOString()
  };
}

interface MarketQuoteRow {
  market: string;
  code: string;
  symbol: string;
  name: string | null;
  currency: string;
  price: string;
  previous_close: string | null;
  change_amount: string | null;
  change_percent: string | null;
  quote_time: string;
  fetched_at: string;
  provider: string;
}
