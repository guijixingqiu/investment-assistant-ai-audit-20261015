import {
  MARKET_ENVIRONMENT_SCHEMA_VERSION,
  makeUnavailableMarketEnvironmentEnvelope,
  validateMarketEnvironmentEnvelope,
  type MarketEnvironmentData,
  type MarketEnvironmentEnvelope
} from "../../../../packages/contracts/src/marketEnvironment.js";

export interface MarketEnvironmentProvider {
  getEnvironment(market: string, code: string): Promise<MarketEnvironmentEnvelope>;
}

export class UnavailableMarketEnvironmentProvider implements MarketEnvironmentProvider {
  constructor(private readonly reason: string) {}

  async getEnvironment(market: string, code: string): Promise<MarketEnvironmentEnvelope> {
    return makeUnavailableMarketEnvironmentEnvelope(`${market}.${code}`, this.reason);
  }
}

export class FutuHttpMarketEnvironmentProvider implements MarketEnvironmentProvider {
  private cached: { symbol: string; expiresAt: number; marketPhase: string; envelope: MarketEnvironmentEnvelope } | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date()
  ) {}

  async getEnvironment(market: string, code: string): Promise<MarketEnvironmentEnvelope> {
    const requestedSymbol = `${market}.${code}`;
    const requestedAt = this.now();
    const requestPhase = hongKongMarketPhase(requestedAt);
    if (this.cached?.symbol === requestedSymbol
      && this.cached.expiresAt >= requestedAt.getTime()
      && this.cached.marketPhase === requestPhase) {
      return this.cached.envelope;
    }
    const url = new URL("/market-environment", this.baseUrl);
    url.searchParams.set("market", market);
    url.searchParams.set("ticker", code);
    try {
      const response = await this.fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) {
        return makeUnavailableMarketEnvironmentEnvelope(
          requestedSymbol,
          `Futu market-environment adapter returned HTTP ${response.status}.`
        );
      }
      const payload = await response.json() as unknown;
      const fetchedAt = this.now();
      if (requestPhase !== hongKongMarketPhase(fetchedAt)) {
        return makeUnavailableMarketEnvironmentEnvelope(
          requestedSymbol,
          "Futu market-environment request crossed a Hong Kong market phase boundary; refresh required."
        );
      }
      const data = readData(payload);
      if (!data || data.market !== market || data.selectedSymbol !== requestedSymbol) {
        return makeUnavailableMarketEnvironmentEnvelope(
          requestedSymbol,
          "Futu market-environment adapter returned invalid or mismatched facts."
        );
      }
      const envelope: MarketEnvironmentEnvelope = {
        schemaVersion: MARKET_ENVIRONMENT_SCHEMA_VERSION,
        status: "available",
        requestedSymbol,
        asOf: latestAsOf(data),
        source: {
          provider: "futu_opend",
          endpoint: "market-environment",
          fetchedAt: fetchedAt.toISOString(),
          quoteDataOnly: true
        },
        data,
        message: "Futu OpenD quote-data-only market environment fetched without broker or portfolio access."
      };
      if (validateMarketEnvironmentEnvelope(envelope, fetchedAt).ok) {
        this.cached = {
          symbol: requestedSymbol,
          expiresAt: fetchedAt.getTime() + 120_000,
          marketPhase: hongKongMarketPhase(fetchedAt),
          envelope
        };
        return envelope;
      }
      return makeUnavailableMarketEnvironmentEnvelope(
        requestedSymbol,
        "Futu market-environment facts failed contract validation."
      );
    } catch (error) {
      return makeUnavailableMarketEnvironmentEnvelope(
        requestedSymbol,
        `Futu market-environment adapter unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

function hongKongMarketPhase(now: Date): string {
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1_000);
  const day = local.getUTCDay();
  if (day === 0 || day === 6) return "closed";
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (minute >= 9 * 60 + 30 && minute < 12 * 60) return "morning";
  if (minute >= 12 * 60 && minute < 13 * 60) return "rest";
  if (minute >= 13 * 60 && minute < 16 * 60) return "afternoon";
  return "closed";
}

function readData(value: unknown): MarketEnvironmentData | null {
  if (!record(value) || value.ok !== true || !record(value.environment)) return null;
  return value.environment as unknown as MarketEnvironmentData;
}

function latestAsOf(data: MarketEnvironmentData): string {
  return [
    ...data.indices.map((item) => item.asOf),
    ...data.sectors.leaders.map((item) => item.asOf),
    ...data.sectors.laggards.map((item) => item.asOf),
    data.selectedStockCapitalFlow?.asOf
  ].filter((value): value is string => typeof value === "string").sort().at(-1)!;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
