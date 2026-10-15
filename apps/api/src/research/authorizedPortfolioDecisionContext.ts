import { readAssetsAlphaEnvelope } from "../assetsAlphaRepository.js";
import { validateAssetsAlphaEnvelope } from "../../../../packages/contracts/src/assetsAlpha.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import type { Pool, PoolClient } from "pg";
import { validatePinganCurrentPortfolioEnvelope } from "../../../../packages/contracts/src/pinganCurrentPortfolio.js";
import {
  validatePortfolioDecisionContextEnvelope,
  type PortfolioDecisionContextEnvelope
} from "../../../../packages/contracts/src/portfolioDecisionContext.js";
import { assemblePortfolioDecisionContext } from "../portfolio/decisionContext.js";
import { readPinganCurrentPortfolioEnvelope } from "../portfolio/pinganCurrentPortfolioRepository.js";

export interface AuthorizedPortfolioDecisionContextReadOptions {
  accountScopeId: string | null;
  ownerCurrentActor?: AuthenticatedResearchActor;
  pinganCurrentMaxAgeSeconds: number;
  quoteLiveMaxAgeSeconds: number;
}

export async function readAuthorizedPortfolioDecisionContext(
  pool: Pick<Pool | PoolClient, "query">,
  options: AuthorizedPortfolioDecisionContextReadOptions,
  now: Date,
  factLabel = "portfolio"
): Promise<PortfolioDecisionContextEnvelope> {
  if (options.ownerCurrentActor?.actorType === "user" && options.accountScopeId) {
    const assets = await readAssetsAlphaEnvelope(pool, options.ownerCurrentActor, now);
    if (!validateAssetsAlphaEnvelope(assets).ok) throw new Error("owner holdings failed validation");
    const snapshot = assets.snapshots.find(item => item.source === "owner_current");
    if (snapshot) {
      const context = await assemblePortfolioDecisionContext(pool, {
        status: snapshot.positions.length ? "current" : "zero_position",
        snapshotId: `owner-current:${snapshot.id}:${snapshot.sourceHash}`, accountScopeId: options.accountScopeId,
        sourceSystem: "owner_entered_current", sourceBatchId: snapshot.id,
        sourceAsOf: snapshot.asOf, importedAt: snapshot.createdAt, fetchedAt: snapshot.createdAt,
        freshness: null, message: "Owner-entered current holdings",
        positions: snapshot.positions.map(position => {
          if (!position.costLots?.length) throw new Error("owner current position lacks cost lots");
          const cost = position.costLots.reduce((total, lot) => total + lot.quantity * lot.unitCostHkd, 0);
          return { code: position.symbol.slice(3), symbol: position.symbol, name: null,
            quantity: position.quantity, averageCost: cost / position.quantity,
            unrealizedPnl: null, currentWeight: null, currency: "HKD", sourceRowId: `${snapshot.id}:${position.symbol}` };
        })
      }, options.quoteLiveMaxAgeSeconds, now);
      const validation = validatePortfolioDecisionContextEnvelope(context);
      if (!validation.ok) throw new Error(`owner current context invalid: ${validation.errors.join("; ")}`);
      return context;
    }
  }
  const portfolio = await readPinganCurrentPortfolioEnvelope(pool, {
    accountScopeId: options.accountScopeId,
    tradingMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds,
    now
  });
  const portfolioValidation = validatePinganCurrentPortfolioEnvelope(portfolio);
  if (!portfolioValidation.ok) {
    throw new Error(`authorized ${factLabel} read failed validation: ${portfolioValidation.errors.join("; ")}`);
  }

  const context = await assemblePortfolioDecisionContext(pool, portfolio, options.quoteLiveMaxAgeSeconds, now);
  const contextValidation = validatePortfolioDecisionContextEnvelope(context);
  if (!contextValidation.ok) {
    throw new Error(`authorized ${factLabel} context failed validation: ${contextValidation.errors.join("; ")}`);
  }
  return context;
}
