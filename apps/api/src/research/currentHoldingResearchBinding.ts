import type { Pool, PoolClient } from "pg";
import { validatePinganCurrentPortfolioEnvelope } from "../../../../packages/contracts/src/pinganCurrentPortfolio.js";
import type {
  ResearchAnnouncementEventData,
  ResearchEventHoldingBinding
} from "../../../../packages/contracts/src/researchEvent.js";
import { readPinganCurrentPortfolioEnvelope } from "../portfolio/pinganCurrentPortfolioRepository.js";

export interface CurrentHoldingReadOptions {
  accountScopeId: string | null;
  currentPortfolioEnabled: boolean;
  currentPortfolioMaxAgeSeconds: number;
}

export interface CurrentHoldingBindingFailure {
  status: "stale" | "conflict" | "unavailable";
  message: string;
  identity: unknown;
}

export async function validateCurrentHoldingBindings(
  client: Pick<Pool | PoolClient, "query">,
  symbol: string,
  refs: ResearchEventHoldingBinding[],
  options: CurrentHoldingReadOptions,
  now: Date
): Promise<CurrentHoldingBindingFailure | null> {
  if (refs.length === 0) return null;
  if (!options.currentPortfolioEnabled || !options.accountScopeId) {
    return {
      status: "unavailable",
      message: "Current-holding research facts require the enabled account-scoped Pingan Local Beta source.",
      identity: { enabled: options.currentPortfolioEnabled, accountScopeId: options.accountScopeId }
    };
  }
  const portfolio = await readPinganCurrentPortfolioEnvelope(client, {
    accountScopeId: options.accountScopeId,
    tradingMaxAgeSeconds: options.currentPortfolioMaxAgeSeconds,
    now
  });
  if (!validatePinganCurrentPortfolioEnvelope(portfolio).ok || portfolio.status !== "current"
    || !portfolio.snapshotId || !portfolio.sourceBatchId || !portfolio.sourceAsOf || !portfolio.accountScopeId) {
    return {
      status: portfolio.status === "stale" ? "stale" : portfolio.status === "conflict" ? "conflict" : "unavailable",
      message: `Current-holding research source is not current and valid (${portfolio.status}).`,
      identity: {
        status: portfolio.status,
        accountScopeId: portfolio.accountScopeId,
        snapshotId: portfolio.snapshotId,
        sourceBatchId: portfolio.sourceBatchId,
        sourceAsOf: portfolio.sourceAsOf
      }
    };
  }
  const position = portfolio.positions.find((item) => item.symbol === symbol);
  if (!position) {
    return {
      status: "conflict",
      message: `${symbol} is not present in the current account-scoped holding snapshot.`,
      identity: {
        accountScopeId: portfolio.accountScopeId,
        snapshotId: portfolio.snapshotId,
        sourceBatchId: portfolio.sourceBatchId,
        sourceAsOf: portfolio.sourceAsOf,
        symbol,
        positionSourceRowId: null
      }
    };
  }
  const matches = refs.every((ref) => ref.accountScopeId === portfolio.accountScopeId
    && ref.snapshotId === portfolio.snapshotId && ref.sourceBatchId === portfolio.sourceBatchId
    && ref.sourceAsOf === portfolio.sourceAsOf && ref.positionSourceRowId === position.sourceRowId);
  return matches ? null : {
    status: "conflict",
    message: "Current-holding research facts do not bind the exact current account snapshot and position row.",
    identity: {
      accountScopeId: portfolio.accountScopeId,
      snapshotId: portfolio.snapshotId,
      sourceBatchId: portfolio.sourceBatchId,
      sourceAsOf: portfolio.sourceAsOf,
      symbol,
      positionSourceRowId: position.sourceRowId
    }
  };
}

export async function validateCurrentHoldingEventBindings(
  client: Pick<Pool | PoolClient, "query">,
  events: Array<Pick<ResearchAnnouncementEventData, "symbol" | "holdingBinding">>,
  options: CurrentHoldingReadOptions,
  now: Date
): Promise<CurrentHoldingBindingFailure | null> {
  const refsBySymbol = new Map<string, ResearchEventHoldingBinding[]>();
  for (const event of events) {
    if (!event.holdingBinding) continue;
    const refs = refsBySymbol.get(event.symbol) ?? [];
    refs.push(event.holdingBinding);
    refsBySymbol.set(event.symbol, refs);
  }
  for (const [symbol, refs] of refsBySymbol) {
    const failure = await validateCurrentHoldingBindings(client, symbol, refs, options, now);
    if (failure) return failure;
  }
  return null;
}

export async function currentHoldingEventIdsWithDrift(
  client: Pick<Pool | PoolClient, "query">,
  events: ResearchAnnouncementEventData[],
  options: CurrentHoldingReadOptions,
  now: Date
): Promise<Set<string>> {
  const drifted = new Set<string>();
  // ponytail: validate one low-frequency holding event at a time; batch only if history volume makes this measurable.
  for (const event of events) {
    if (!event.holdingBinding) continue;
    if (await validateCurrentHoldingBindings(client, event.symbol, [event.holdingBinding], options, now)) {
      drifted.add(event.id);
    }
  }
  return drifted;
}
