import type { Pool, PoolClient } from "pg";
import type { PinganCurrentPortfolioEnvelope } from "../../../../packages/contracts/src/pinganCurrentPortfolio.js";
import {
  computePortfolioDecisionContextId,
  computePortfolioRiskImpactId,
  PORTFOLIO_DECISION_CONTEXT_SCHEMA_VERSION,
  PORTFOLIO_RISK_CALCULATION_VERSION,
  PORTFOLIO_RISK_IMPACT_SCHEMA_VERSION,
  type PortfolioDecisionContextEnvelope,
  type PortfolioDecisionContextHashInput,
  type PortfolioDecisionPosition,
  type PortfolioRiskImpactEnvelope,
  type PortfolioRiskImpactHashInput
} from "../../../../packages/contracts/src/portfolioDecisionContext.js";

export type CurrentHoldingsInput = Omit<Pick<PinganCurrentPortfolioEnvelope,
  "status" | "snapshotId" | "accountScopeId" | "sourceSystem" | "sourceBatchId" | "sourceAsOf" | "importedAt" | "fetchedAt" | "freshness" | "message" | "positions">, "sourceSystem" | "positions"> & {
  sourceSystem: "pingan_imported_snapshot" | "owner_entered_current" | null;
  positions: Array<Pick<PinganCurrentPortfolioEnvelope["positions"][number],
    "code" | "symbol" | "name" | "quantity" | "averageCost" | "unrealizedPnl" | "currentWeight" | "currency" | "sourceRowId">>;
};

export async function assemblePortfolioDecisionContext(
  pool: Pick<Pool | PoolClient, "query">,
  portfolio: CurrentHoldingsInput,
  quoteLiveMaxAgeSeconds: number,
  now = new Date()
): Promise<PortfolioDecisionContextEnvelope> {
  if (!isCapturedPortfolioStatus(portfolio.status)) {
    return failClosedContext(portfolio.status, portfolio.accountScopeId, now, portfolio.message);
  }

  if (!isValidCapturedPortfolio(portfolio)) {
    return failClosedContext(
      "unavailable",
      portfolio.accountScopeId,
      now,
      "Pingan portfolio facts do not carry a valid complete snapshot identity."
    );
  }

  const quotes = await readPortfolioQuotesForPositions(pool, portfolio.positions);
  const positions: PortfolioDecisionPosition[] = portfolio.positions.map((position) => {
    const quote = quotes.get(position.symbol);
    const quoteFact = normalizeQuote(quote, position.symbol, quoteLiveMaxAgeSeconds, now);
    return {
      market: "HK" as const,
      code: position.code,
      symbol: position.symbol,
      name: position.name,
      quantity: position.quantity,
      averageCost: position.averageCost,
      unrealizedPnl: portfolio.sourceSystem === "owner_entered_current" && quoteFact.price !== null && position.averageCost !== null
        ? round(position.quantity * (quoteFact.price - position.averageCost)) : position.unrealizedPnl,
      sourceWeight: position.currentWeight,
      currency: position.currency,
      sourceRowId: position.sourceRowId,
      quote: {
        status: quoteFact.status,
        source: quoteFact.status === "unavailable" ? null : "futu" as const,
        quoteAsOf: quoteFact.status === "unavailable" ? null : quoteFact.quoteAsOf,
        fetchedAt: quoteFact.status === "unavailable" ? null : quoteFact.fetchedAt
      },
      latestPrice: quoteFact.price,
      marketValue: quoteFact.price === null ? null : round(position.quantity * quoteFact.price),
      marketWeight: null
    };
  });

  const missingPositionCount = positions.filter((position) => position.marketValue === null).length;
  const staleQuoteCount = positions.filter((position) => position.quote.status === "stale").length;
  const allValues = missingPositionCount === 0;
  const totalMarketValue = allValues ? round(positions.reduce((total, position) => total + (position.marketValue ?? 0), 0)) : null;
  if (totalMarketValue !== null && totalMarketValue > 0) {
    for (const position of positions) position.marketWeight = round((position.marketValue ?? 0) / totalMarketValue, 8);
  }
  const weights = positions.map((position) => position.marketWeight).filter((value): value is number => value !== null).sort((a, b) => b - a);
  const concentrationAvailable = weights.length === positions.length && weights.length > 0;
  const gaps = portfolioContextGaps(portfolio, missingPositionCount, staleQuoteCount, totalMarketValue);
  const status = assembledPortfolioStatus(portfolio.status, staleQuoteCount, missingPositionCount, totalMarketValue);
  const base: PortfolioDecisionContextHashInput = {
    schemaVersion: PORTFOLIO_DECISION_CONTEXT_SCHEMA_VERSION,
    status,
    portfolioSnapshotId: portfolio.snapshotId,
    accountScopeId: portfolio.accountScopeId,
    portfolioSource: portfolio.sourceSystem,
    sourceAsOf: portfolio.sourceAsOf,
    portfolioAsOf: portfolio.sourceAsOf,
    importedAt: portfolio.importedAt,
    fetchedAt: portfolio.fetchedAt,
    freshness: portfolio.freshness,
    assembledAt: now.toISOString(),
    positions,
    summary: {
      positionCount: positions.length,
      marketValue: {
        status: assembledMarketValueStatus(status, totalMarketValue),
        amount: totalMarketValue,
        currency: totalMarketValue === null ? null : "HKD" as const,
        missingPositionCount
      },
      cash: {
        status: "unknown" as const,
        amount: null,
        currency: null,
        reason: "not_provided_by_authoritative_snapshot" as const
      },
      unrealizedPnl: completeUnrealizedPnl(positions),
      concentration: {
        status: concentrationAvailable ? "available" as const : "unavailable" as const,
        largestPositionWeight: concentrationAvailable ? weights[0] : null,
        topThreeWeight: concentrationAvailable ? round(weights.slice(0, 3).reduce((total, weight) => total + weight, 0), 8) : null,
        hhi: concentrationAvailable ? round(weights.reduce((total, weight) => total + weight ** 2, 0), 8) : null
      }
    },
    dataUse: contextDataUse(status),
    gaps,
    message: portfolio.sourceSystem === "owner_entered_current"
      ? "Owner 手动确认的当前持仓；数量与成本以最近一次手动保存为准，行情独立标注时点。权重和风险仅覆盖已录入股票，现金未提供。"
      : portfolioContextMessage(status)
  };
  return {
    ...base,
    contextId: computePortfolioDecisionContextId(base)
  };
}

export function calculatePortfolioRiskImpact(
  context: PortfolioDecisionContextEnvelope,
  candidateSymbol: string,
  hypotheticalAmount: number,
  options: { allowStaleReadOnly?: boolean } = {}
): PortfolioRiskImpactEnvelope {
  if (!Number.isFinite(hypotheticalAmount) || hypotheticalAmount < 0) {
    return riskImpactFailClosed("invalid", context, candidateSymbol, null, ["Hypothetical amount must be a non-negative finite number."], "Invalid hypothetical amount.");
  }
  const usableContext = context.status === "available" || (options.allowStaleReadOnly === true && context.status === "stale");
  if (!usableContext || context.summary.marketValue.amount === null || context.summary.marketValue.amount <= 0) {
    return riskImpactFailClosed("blocked", context, candidateSymbol, hypotheticalAmount, context.gaps.length > 0 ? context.gaps : ["Current complete portfolio context is required."], "Risk impact is blocked because current complete portfolio facts are unavailable.");
  }

  const currentPosition = context.positions.find((position) => position.symbol === candidateSymbol);
  const currentMarketValue = currentPosition?.marketValue ?? 0;
  const currentWeight = currentPosition?.marketWeight ?? 0;
  const totalMarketValue = round(context.summary.marketValue.amount + hypotheticalAmount);
  const candidateMarketValue = round(currentMarketValue + hypotheticalAmount);
  const candidateWeight = totalMarketValue === 0 ? 0 : round(candidateMarketValue / totalMarketValue, 8);
  const scenarioValues = context.positions
    .filter((position) => position.symbol !== candidateSymbol)
    .map((position) => position.marketValue ?? 0);
  scenarioValues.push(candidateMarketValue);
  const weights = scenarioValues.map((value) => totalMarketValue === 0 ? 0 : value / totalMarketValue).sort((a, b) => b - a);
  const base: PortfolioRiskImpactHashInput = {
    schemaVersion: PORTFOLIO_RISK_IMPACT_SCHEMA_VERSION,
    calculationVersion: PORTFOLIO_RISK_CALCULATION_VERSION,
    status: "available",
    contextId: context.contextId,
    portfolioSnapshotId: context.portfolioSnapshotId,
    candidateSymbol,
    hypotheticalAmount,
    currency: "HKD",
    current: {
      alreadyHeld: currentPosition !== undefined,
      marketValue: currentMarketValue,
      weight: currentWeight
    },
    scenario: {
      totalMarketValue,
      candidateMarketValue,
      candidateWeight,
      weightChange: round(candidateWeight - currentWeight, 8),
      largestPositionWeight: round(weights[0] ?? 0, 8),
      hhi: round(weights.reduce((total, weight) => total + weight ** 2, 0), 8)
    },
    gaps: context.status === "stale" ? context.gaps : [],
    guardrails: riskGuardrails(),
    message: context.status === "stale"
      ? "Read-only scenario uses the latest explicitly stale portfolio and quote facts; it is not a recommendation or formal decision fact."
      : "Scenario describes portfolio exposure from a user-provided amount; it is not an amount, weight, direction, timing, or return recommendation."
  };
  return {
    ...base,
    impactId: computePortfolioRiskImpactId(base)
  };
}

async function readPortfolioQuotes(pool: Pick<Pool | PoolClient, "query">, symbols: string[]): Promise<Map<string, PortfolioQuoteRow>> {
  try {
    const result = await pool.query<PortfolioQuoteRow>(
      `select distinct on (market, code)
              market, code, symbol, currency, price, quote_time, fetched_at, provider
         from market_quotes
        where symbol = any($1::text[])
        order by market, code, quote_time desc, fetched_at desc`,
      [symbols]
    );
    return new Map(result.rows.map((row) => [row.symbol, row]));
  } catch {
    return new Map();
  }
}

async function readPortfolioQuotesForPositions(
  pool: Pick<Pool | PoolClient, "query">,
  positions: CurrentHoldingsInput["positions"]
): Promise<Map<string, PortfolioQuoteRow>> {
  if (positions.length === 0) return new Map();
  return readPortfolioQuotes(pool, positions.map((position) => position.symbol));
}

function normalizeQuote(
  row: PortfolioQuoteRow | undefined,
  expectedSymbol: string,
  liveMaxAgeSeconds: number,
  now: Date
): { status: "current" | "stale" | "unavailable"; price: number | null; quoteAsOf: string | null; fetchedAt: string | null } {
  if (!row || row.symbol !== expectedSymbol || row.market !== "HK" || row.symbol !== `${row.market}.${row.code}` || row.provider !== "futu" || row.currency !== "HKD") return unavailableQuote();
  const price = Number(row.price);
  const quoteTime = new Date(row.quote_time);
  const fetchedAt = new Date(row.fetched_at);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quoteTime.getTime()) || !Number.isFinite(fetchedAt.getTime())
    || quoteTime.getTime() > fetchedAt.getTime() || fetchedAt.getTime() > now.getTime()) return unavailableQuote();
  const age = now.getTime() - quoteTime.getTime();
  const status = age < 0 || age > liveMaxAgeSeconds * 1_000 ? "stale" : "current";
  return { status, price, quoteAsOf: quoteTime.toISOString(), fetchedAt: fetchedAt.toISOString() };
}

function unavailableQuote() {
  return { status: "unavailable" as const, price: null, quoteAsOf: null, fetchedAt: null };
}

function failClosedContext(
  status: "empty" | "conflict" | "unauthorized" | "unavailable",
  accountScopeId: string | null,
  now: Date,
  message: string
): PortfolioDecisionContextEnvelope {
  return {
    schemaVersion: PORTFOLIO_DECISION_CONTEXT_SCHEMA_VERSION,
    status,
    contextId: null,
    portfolioSnapshotId: null,
    accountScopeId,
    portfolioSource: null,
    sourceAsOf: null,
    portfolioAsOf: null,
    importedAt: null,
    fetchedAt: null,
    freshness: null,
    assembledAt: now.toISOString(),
    positions: [],
    summary: {
      positionCount: 0,
      marketValue: { status: "unavailable", amount: null, currency: null, missingPositionCount: 0 },
      cash: { status: "unknown", amount: null, currency: null, reason: "not_provided_by_authoritative_snapshot" },
      unrealizedPnl: null,
      concentration: { status: "unavailable", largestPositionWeight: null, topThreeWeight: null, hhi: null }
    },
    dataUse: contextDataUse(status),
    gaps: [message],
    message
  };
}

function contextDataUse(status: PortfolioDecisionContextEnvelope["status"]): PortfolioDecisionContextEnvelope["dataUse"] {
  return {
    display: status === "available" || status === "zero_position" ? "allowed" : status === "stale" || status === "partial" ? "allowed_with_warning" : "blocked",
    advisoryRiskImpact: status === "available" ? "allowed_current_development_only" : status === "stale" ? "blocked_stale" : status === "partial" ? "blocked_incomplete" : "blocked",
    productionPortfolio: "blocked_not_production_authority",
    brokerReconciliation: "blocked",
    accounting: "blocked",
    execution: "blocked"
  };
}

function hasCapturedPortfolioIdentity(portfolio: CurrentHoldingsInput): boolean {
  return [
    portfolio.snapshotId,
    portfolio.accountScopeId,
    portfolio.sourceSystem,
    portfolio.sourceBatchId,
    portfolio.sourceAsOf,
    portfolio.importedAt,
    portfolio.fetchedAt
  ].every((value) => typeof value === "string" && value.trim().length > 0)
    && (portfolio.sourceSystem === "owner_entered_current"
      ? portfolio.freshness === null : portfolio.sourceSystem === "pingan_imported_snapshot" && portfolio.freshness !== null);
}

function isCapturedPortfolioStatus(
  status: PinganCurrentPortfolioEnvelope["status"]
): status is "current" | "stale" | "zero_position" {
  return ["current", "stale", "zero_position"].includes(status);
}

function isValidCapturedPortfolio(portfolio: CurrentHoldingsInput): boolean {
  if (!hasCapturedPortfolioIdentity(portfolio)) return false;
  if (portfolio.status === "zero_position") return portfolio.positions.length === 0 && (portfolio.sourceSystem === "owner_entered_current" || portfolio.freshness?.state === "current");
  if (portfolio.status === "current") return portfolio.positions.length > 0;
  return portfolio.status === "stale" && (portfolio.positions.length > 0 || portfolio.freshness?.state === "stale");
}

function portfolioContextGaps(
  portfolio: CurrentHoldingsInput,
  missingPositionCount: number,
  staleQuoteCount: number,
  totalMarketValue: number | null
): string[] {
  const gaps: string[] = [];
  if (portfolio.sourceSystem === "owner_entered_current") gaps.push("仅按Owner已录入股票计算；不是券商同步，现金、其他未录入资产与交易费用未推定。");
  if (portfolio.status === "stale") gaps.push(`Pingan portfolio is stale: ${portfolio.freshness?.reason ?? "unknown"}.`);
  if (missingPositionCount > 0) gaps.push(`${missingPositionCount} position(s) have no approved Futu quote.`);
  if (staleQuoteCount > 0) gaps.push(`${staleQuoteCount} Futu quote(s) are stale.`);
  if (portfolio.positions.length === 0) gaps.push("The complete Pingan snapshot contains zero positions, so concentration and risk-impact calculation are unavailable.");
  else if (totalMarketValue === 0) gaps.push("Portfolio market value is zero, so weights and concentration are unavailable.");
  return gaps;
}

function assembledPortfolioStatus(
  portfolioStatus: "current" | "stale" | "zero_position",
  staleQuoteCount: number,
  missingPositionCount: number,
  totalMarketValue: number | null
): PortfolioDecisionContextEnvelope["status"] {
  if (portfolioStatus === "zero_position") return "zero_position";
  if (portfolioStatus === "stale" || staleQuoteCount > 0) return "stale";
  return missingPositionCount > 0 || totalMarketValue === 0 ? "partial" : "available";
}

function assembledMarketValueStatus(
  status: PortfolioDecisionContextEnvelope["status"],
  totalMarketValue: number | null
): PortfolioDecisionContextEnvelope["summary"]["marketValue"]["status"] {
  if (totalMarketValue === null) return "partial";
  return status === "available" || status === "zero_position" ? "complete_current" : "complete_stale";
}

function portfolioContextMessage(status: PortfolioDecisionContextEnvelope["status"]): string {
  if (status === "available") return "Current Pingan positions and current Futu quotes assembled for local decision assistance.";
  if (status === "zero_position") return "The complete current Pingan snapshot contains zero positions; it is displayable while risk-impact calculation remains blocked.";
  return "Portfolio context is displayable with warning; risk-impact calculation is blocked until all current facts are available.";
}

function completeUnrealizedPnl(positions: PortfolioDecisionPosition[]): number | null {
  if (positions.length === 0 || !positions.every((position) => Number.isFinite(position.unrealizedPnl))) return null;
  const total = positions.reduce((sum, position) => sum + (position.unrealizedPnl as number), 0);
  return Number.isFinite(total) ? round(total) : null;
}

function riskImpactFailClosed(
  status: "blocked" | "invalid",
  context: PortfolioDecisionContextEnvelope,
  candidateSymbol: string,
  hypotheticalAmount: number | null,
  gaps: string[],
  message: string
): PortfolioRiskImpactEnvelope {
  return {
    schemaVersion: PORTFOLIO_RISK_IMPACT_SCHEMA_VERSION,
    calculationVersion: PORTFOLIO_RISK_CALCULATION_VERSION,
    status,
    impactId: null,
    contextId: context.contextId,
    portfolioSnapshotId: context.portfolioSnapshotId,
    candidateSymbol,
    hypotheticalAmount,
    currency: "HKD",
    current: { alreadyHeld: null, marketValue: null, weight: null },
    scenario: { totalMarketValue: null, candidateMarketValue: null, candidateWeight: null, weightChange: null, largestPositionWeight: null, hhi: null },
    gaps,
    guardrails: riskGuardrails(),
    message
  };
}

function riskGuardrails(): PortfolioRiskImpactEnvelope["guardrails"] {
  return {
    advisoryOnly: true,
    userProvidedAmountOnly: true,
    generatesDirection: false,
    recommendsAmount: false,
    recommendsTargetWeight: false,
    recommendsTiming: false,
    promisesReturn: false,
    createsOrder: false,
    productionWrite: false
  };
}

function round(value: number, precision = 2): number {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

interface PortfolioQuoteRow {
  market: string;
  code: string;
  symbol: string;
  currency: string;
  price: string;
  quote_time: string;
  fetched_at: string;
  provider: string;
}
