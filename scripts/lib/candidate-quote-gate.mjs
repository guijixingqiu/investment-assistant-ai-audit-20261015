const DEFAULT_RECENT_FETCH_MAX_AGE_SECONDS = 30 * 60;

export function evaluateCandidateQuoteGate(quote, options = {}) {
  const now = parseDate(options.now ?? new Date());
  const recentFetchMaxAgeSeconds = Number.parseInt(
    String(options.recentFetchMaxAgeSeconds ?? process.env.CANDIDATE_QUOTE_RECENT_FETCH_MAX_AGE_SECONDS ?? DEFAULT_RECENT_FETCH_MAX_AGE_SECONDS),
    10
  );
  const allowMarketClosedStale = String(options.allowMarketClosedStale ?? process.env.CANDIDATE_ALLOW_MARKET_CLOSED_STALE ?? "1") === "1";
  const marketClosed = String(options.marketClosed ?? process.env.CANDIDATE_MARKET_CLOSED ?? "0") === "1";
  const quoteStatus = quote?.status ?? null;
  const provider = quote?.source?.provider ?? null;
  const fetchedAt = parseDate(quote?.source?.fetchedAt ?? null);
  const fetchedAgeSeconds = fetchedAt && now ? Math.floor((now.getTime() - fetchedAt.getTime()) / 1000) : null;
  const recentFetch = fetchedAgeSeconds !== null
    && fetchedAgeSeconds >= 0
    && fetchedAgeSeconds <= recentFetchMaxAgeSeconds;
  const quoteTime = quote?.data?.quoteTime ?? quote?.asOf ?? null;

  const live = !marketClosed && quoteStatus === "live" && provider === "futu";
  const marketClosedStale = allowMarketClosedStale
    && marketClosed
    && (quoteStatus === "live" || quoteStatus === "stale")
    && provider === "futu"
    && recentFetch
    && Boolean(quoteTime);

  const ok = marketClosedStale || live;
  return {
    ok,
    mode: marketClosedStale ? "market_closed_stale" : live ? "live" : "not_acceptable",
    requirements: {
      allowMarketClosedStale,
      marketClosed,
      recentFetchMaxAgeSeconds
    },
    evidence: {
      status: quoteStatus,
      provider,
      providerStatus: quote?.source?.providerStatus ?? null,
      fetchedAt: quote?.source?.fetchedAt ?? null,
      fetchedAgeSeconds,
      recentFetch,
      quoteTime,
      asOf: quote?.asOf ?? null,
      message: quote?.message ?? null
    }
  };
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
