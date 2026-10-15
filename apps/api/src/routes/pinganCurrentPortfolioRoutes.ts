import { readAuthorizedPortfolioDecisionContext } from "../research/authorizedPortfolioDecisionContext.js";
import type { FastifyInstance } from "fastify";
import {
  PINGAN_CURRENT_PORTFOLIO_SCHEMA_VERSION,
  PINGAN_DEVELOPMENT_AUTHORITY_SCOPE,
  validatePinganCurrentPortfolioEnvelope,
  type PinganCurrentPortfolioEnvelope
} from "../../../../packages/contracts/src/pinganCurrentPortfolio.js";
import {
  validatePortfolioDecisionContextEnvelope,
  validatePortfolioRiskImpactEnvelope
} from "../../../../packages/contracts/src/portfolioDecisionContext.js";
import {
  assemblePortfolioDecisionContext,
  calculatePortfolioRiskImpact
} from "../portfolio/decisionContext.js";
import { readPinganCurrentPortfolioEnvelope } from "../portfolio/pinganCurrentPortfolioRepository.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";
import { authenticateReadOnly, derivePinganSnapshotAccountScope } from "./researchAuth.js";

export async function registerPinganCurrentPortfolioRoutes(
  app: FastifyInstance,
  options: MobileResearchRouteOptions
): Promise<void> {
  // Generic current-holdings resources may use an explicitly Owner-entered snapshot.
  // The Pingan-specific resources below continue to report only genuine Pingan data.
  for (const resource of ["context", "risk-impact"] as const) {
    app.get(`/api/mobile/research/portfolio/current/${resource}`, async (request, reply) => {
      reply.header("cache-control", "no-store");
      const actor = authenticateReadOnly(request.headers, options);
      const accountScopeId = actor ? derivePinganSnapshotAccountScope(actor, options) : null;
      if (!actor || !accountScopeId) return reply.code(401).send({ ok: false, message: "current holdings account authorization required" });
      if (!options.pinganCurrentPortfolioEnabled) return reply.code(503).send({ ok: false, message: "current holdings are enabled for local development only" });
      try {
        const context = await readAuthorizedPortfolioDecisionContext(options.pool, {
          accountScopeId, ownerCurrentActor: actor,
          pinganCurrentMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300,
          quoteLiveMaxAgeSeconds: options.quoteLiveMaxAgeSeconds
        }, routeNow(options));
        if (resource === "context") { setPortfolioStatusCode(reply, context.status); return context; }
        const query = request.query as { symbol?: string; hypotheticalAmount?: string };
        if (!/^HK\.\d{5}$/.test(query.symbol ?? "")) return reply.code(400).send({ ok: false, message: "canonical HK symbol required" });
        const impact = calculatePortfolioRiskImpact(context, query.symbol!, Number(query.hypotheticalAmount ?? "NaN"));
        if (!validatePortfolioRiskImpactEnvelope(impact).ok) return reply.code(503).send({ ok: false, message: "risk impact failed validation" });
        if (impact.status === "invalid") reply.code(400);
        if (impact.status === "blocked") reply.code(409);
        return impact;
      } catch { return reply.code(503).send({ ok: false, message: "current holdings source is unavailable" }); }
    });
  }

  app.get("/api/mobile/research/portfolio/pingan-current", async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (!options.pinganCurrentPortfolioEnabled) {
      await reply.code(503).send(disabledCurrentPortfolio());
      return;
    }
    const accountScopeId = authenticatedAccountScope(request.headers, options);
    if (!accountScopeId) {
      await reply.code(401).send(currentPortfolioFailClosed("unauthorized", null, "Current Pingan portfolio account scope authorization is required."));
      return;
    }
    const portfolio = await readAndValidateCurrentPortfolio(accountScopeId, options, routeNow(options));
    setPortfolioStatusCode(reply, portfolio.status);
    return portfolio;
  });

  app.get("/api/mobile/research/portfolio/pingan-current/context", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const now = routeNow(options);
    if (!options.pinganCurrentPortfolioEnabled) {
      const context = await assemblePortfolioDecisionContext(
        options.pool,
        disabledCurrentPortfolio(),
        options.quoteLiveMaxAgeSeconds,
        now
      );
      await reply.code(503).send(context);
      return;
    }
    const accountScopeId = authenticatedAccountScope(request.headers, options);
    if (!accountScopeId) {
      const context = await assemblePortfolioDecisionContext(options.pool, currentPortfolioFailClosed("unauthorized", null, "Current Pingan portfolio account scope authorization is required."), options.quoteLiveMaxAgeSeconds, now);
      await reply.code(401).send(context);
      return;
    }
    const portfolio = await readAndValidateCurrentPortfolio(accountScopeId, options, now);
    const context = await assemblePortfolioDecisionContext(options.pool, portfolio, options.quoteLiveMaxAgeSeconds, now);
    const validation = validatePortfolioDecisionContextEnvelope(context);
    if (!validation.ok) {
      const fallback = await assemblePortfolioDecisionContext(options.pool, currentPortfolioFailClosed("unavailable", accountScopeId, "Assembled portfolio decision context failed validation."), options.quoteLiveMaxAgeSeconds, now);
      await reply.code(503).send(fallback);
      return;
    }
    setPortfolioStatusCode(reply, context.status);
    return context;
  });

  app.get("/api/mobile/research/portfolio/pingan-current/risk-impact", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const query = request.query as { symbol?: string; hypotheticalAmount?: string };
    const candidateSymbol = query.symbol?.trim().toUpperCase() ?? "";
    const hypotheticalAmount = query.hypotheticalAmount === undefined ? Number.NaN : Number(query.hypotheticalAmount);
    if (!/^HK\.\d{5}$/.test(candidateSymbol)) {
      await reply.code(400).send({ ok: false, message: "symbol must be a Hong Kong symbol such as HK.09926" });
      return;
    }
    const now = routeNow(options);
    if (!options.pinganCurrentPortfolioEnabled) {
      const context = await assemblePortfolioDecisionContext(
        options.pool,
        disabledCurrentPortfolio(),
        options.quoteLiveMaxAgeSeconds,
        now
      );
      const impact = calculatePortfolioRiskImpact(context, candidateSymbol, hypotheticalAmount);
      if (!validatePortfolioRiskImpactEnvelope(impact).ok) {
        await reply.code(503).send({ ok: false, message: "Disabled portfolio risk impact failed contract validation." });
        return;
      }
      await reply.code(impact.status === "invalid" ? 400 : 503).send(impact);
      return;
    }
    const accountScopeId = authenticatedAccountScope(request.headers, options);
    if (!accountScopeId) {
      await reply.code(401).send({ ok: false, message: "Current Pingan portfolio account scope authorization is required." });
      return;
    }
    const portfolio = await readAndValidateCurrentPortfolio(accountScopeId, options, now);
    const context = await assemblePortfolioDecisionContext(options.pool, portfolio, options.quoteLiveMaxAgeSeconds, now);
    if (!validatePortfolioDecisionContextEnvelope(context).ok) {
      await reply.code(503).send({ ok: false, message: "Portfolio decision context failed validation." });
      return;
    }
    const impact = calculatePortfolioRiskImpact(context, candidateSymbol, hypotheticalAmount);
    const validation = validatePortfolioRiskImpactEnvelope(impact);
    if (!validation.ok) {
      await reply.code(503).send({ ok: false, message: "Portfolio risk impact failed validation." });
      return;
    }
    if (impact.status === "invalid") reply.code(400);
    if (impact.status === "blocked") reply.code(409);
    return impact;
  });
}

async function readAndValidateCurrentPortfolio(
  accountScopeId: string,
  options: MobileResearchRouteOptions,
  now: Date
): Promise<PinganCurrentPortfolioEnvelope> {
  const portfolio = await readPinganCurrentPortfolioEnvelope(options.pool, {
    accountScopeId,
    tradingMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300,
    now
  });
  return validatePinganCurrentPortfolioEnvelope(portfolio).ok
    ? portfolio
    : currentPortfolioFailClosed("unavailable", accountScopeId, "Assembled Pingan current portfolio failed contract validation before response.");
}

function routeNow(options: MobileResearchRouteOptions): Date {
  return options.now?.() ?? new Date();
}

function disabledCurrentPortfolio(): PinganCurrentPortfolioEnvelope {
  return currentPortfolioFailClosed(
    "unavailable",
    null,
    "Current Pingan portfolio is disabled outside local development."
  );
}

function authenticatedAccountScope(
  headers: Record<string, string | string[] | undefined>,
  options: MobileResearchRouteOptions
): string | null {
  const actor = authenticateReadOnly(headers, options);
  return actor ? derivePinganSnapshotAccountScope(actor, options) : null;
}

function setPortfolioStatusCode(
  reply: { code(statusCode: number): unknown },
  status: "available" | "current" | "stale" | "partial" | "zero_position" | "empty" | "conflict" | "unauthorized" | "unavailable"
): void {
  if (status === "conflict") reply.code(409);
  if (status === "unavailable") reply.code(503);
  if (status === "unauthorized") reply.code(401);
}

function currentPortfolioFailClosed(
  status: "conflict" | "unauthorized" | "unavailable",
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
    dataUse: {
      display: "blocked",
      advisoryRiskImpact: "blocked",
      marketPriceAuthority: "futu_quote_data_only",
      productionPortfolio: "blocked_not_production_authority",
      brokerReconciliation: "blocked",
      accounting: "blocked",
      execution: "blocked"
    },
    safety: {
      readOnly: true,
      developmentOnly: true,
      createsOrder: false,
      createsTrade: false,
      mutatesCash: false,
      writesFee: false,
      mutatesPosition: false,
      callsBroker: false,
      productionWrite: false
    },
    message
  };
}
