import type { PinganCurrentPortfolioEnvelope } from "../../../../packages/contracts/src/pinganCurrentPortfolio.js";
import {
  PINGAN_CURRENT_PORTFOLIO_SCHEMA_VERSION,
  PINGAN_DEVELOPMENT_AUTHORITY_SCOPE
} from "../../../../packages/contracts/src/pinganCurrentPortfolio.js";

type CurrentPortfolioStatus = PinganCurrentPortfolioEnvelope["status"];

export function currentPortfolioFailClosed(
  status: "empty" | "conflict" | "unauthorized" | "unavailable",
  accountScopeId: string | null,
  message: string
): PinganCurrentPortfolioEnvelope {
  return {
    schemaVersion: PINGAN_CURRENT_PORTFOLIO_SCHEMA_VERSION,
    status,
    authorityScope: PINGAN_DEVELOPMENT_AUTHORITY_SCOPE,
    accountScopeId,
    sourceSystem: null,
    sourceBatchId: null,
    snapshotId: null,
    sourceAsOf: null,
    importedAt: null,
    fetchedAt: null,
    freshness: null,
    positions: [],
    positionCount: 0,
    dataUse: currentPortfolioDataUse(status),
    safety: currentPortfolioSafety(),
    message
  };
}

export function currentPortfolioDataUse(status: CurrentPortfolioStatus): PinganCurrentPortfolioEnvelope["dataUse"] {
  return {
    display: status === "current" || status === "zero_position" ? "allowed" : status === "stale" ? "allowed_with_warning" : "blocked",
    advisoryRiskImpact: status === "current" ? "allowed_current_development_only" : status === "stale" ? "blocked_stale" : "blocked",
    marketPriceAuthority: "futu_quote_data_only",
    productionPortfolio: "blocked_not_production_authority",
    brokerReconciliation: "blocked",
    accounting: "blocked",
    execution: "blocked"
  };
}

export function currentPortfolioSafety(): PinganCurrentPortfolioEnvelope["safety"] {
  return {
    readOnly: true,
    developmentOnly: true,
    createsOrder: false,
    createsTrade: false,
    mutatesCash: false,
    writesFee: false,
    mutatesPosition: false,
    callsBroker: false,
    productionWrite: false
  };
}
