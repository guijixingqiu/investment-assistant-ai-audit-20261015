import type { FastifyInstance } from "fastify";
import {
  validateDailyTechnicalEnvelope,
  type DailyTechnicalEnvelope
} from "../../../../packages/contracts/src/marketDaily.js";
import type { Pool, PoolClient } from "pg";
import type { DailyBarsProvider } from "../market/dailyBarsProvider.js";
import {
  currentHongKongDate,
  latestCompletedHongKongSession,
  persistDailyTechnicalSnapshot,
  readLatestLastValidDailyTechnicalSnapshot,
  readLatestDailyTechnicalSnapshot
} from "../market/dailyBarsRepository.js";
import { getDailyTechnicalEnvelope, unavailableDailyTechnicalEnvelope } from "../market/dailyBarsService.js";
import { dailyHistoryStart, hkexCompletedSessionEvidence } from "../market/hkexCompletedSessions.js";
import { getWeinsteinTechnicalAnalysis, validHistoricalWeeklyPrice, type WeinsteinWeeklyProvider } from "../market/weinsteinTechnicalAnalysis.js";
import { persistWeinsteinTechnicalSnapshot, readExactWeinsteinTechnicalSnapshot } from "../market/weinsteinTechnicalSnapshotRepository.js";
import { validateWeinsteinTechnicalAnalysisEnvelope } from "../../../../packages/contracts/src/weinsteinTechnicalAnalysis.js";
import { authenticateWrite as authenticateResearchWrite } from "./researchAuth.js";
export { currentHongKongDate } from "../market/dailyBarsRepository.js";

export interface MobileMarketDailyRouteOptions {
  pool: Pick<Pool | PoolClient, "query"> & Partial<Pick<Pool, "connect">>;
  provider?: DailyBarsProvider | null;
  weinsteinProvider?: WeinsteinWeeklyProvider | null;
  writeAuthToken?: string | null;
  writeAuthHeaderName?: string;
  requireWriteAuth?: boolean;
  authSigningKey?: string | null;
  authVerificationKeys?: string[];
  authRevokedTokenIds?: Set<string>;
  allowLegacyWriteTokenForScopedLanes?: boolean;
  writeActorId?: string;
  cutoff?: () => string;
  now?: () => Date;
}

export async function registerMobileMarketDailyRoutes(
  app: FastifyInstance,
  options: MobileMarketDailyRouteOptions
): Promise<void> {
  // ponytail: one API process today; replace with a PostgreSQL advisory lock if refresh workers become multi-process.
  const inFlightRefreshes = new Map<string, Promise<DailyTechnicalEnvelope>>();

  app.get("/api/mobile/market/weinstein/:market/:code", async (request, reply) => {
    const params = request.params as { market: string; code: string };
    const query = request.query as { analysisAsOf?: string };
    const requestStartedAt = options.now?.() ?? new Date();
    if (params.market !== "HK" || !/^\d{5}$/.test(params.code)
      || typeof query.analysisAsOf !== "string" || !validCalendarDate(query.analysisAsOf)
      || query.analysisAsOf > currentHongKongDate(requestStartedAt)) {
      await reply.code(400).send({ ok: false, message: "canonical HK symbol and real analysisAsOf=YYYY-MM-DD are required" });
      return;
    }
    reply.header("cache-control", "no-store");
    const today = currentHongKongDate(requestStartedAt);
    let saved = null;
    if (query.analysisAsOf < today) {
      try {
        saved = await readExactWeinsteinTechnicalSnapshot(options.pool, `HK.${params.code}`, query.analysisAsOf);
      } catch {
        // A failed historical read cannot authorize a reconstructed stage.
      }
    }
    const response = saved ?? await getWeinsteinTechnicalAnalysis(
      options.weinsteinProvider ?? null, params.market, params.code, query.analysisAsOf, today
    );
    const validation = validateWeinsteinTechnicalAnalysisEnvelope(response, {
      symbol: `${params.market}.${params.code}`, analysisAsOf: query.analysisAsOf
    }, options.now?.() ?? new Date());
    if (!validation.ok) throw new Error("Weinstein analysis service returned an invalid fail-closed envelope");
    return response;
  });

  app.get("/api/mobile/market/weinstein-price/:market/:code", async (request, reply) => {
    const params = request.params as { market: string; code: string };
    const query = request.query as { analysisAsOf?: unknown };
    const now = options.now?.() ?? new Date();
    if (params.market !== "HK" || !/^\d{5}$/.test(params.code)
      || typeof query.analysisAsOf !== "string" || !validCalendarDate(query.analysisAsOf)
      || query.analysisAsOf > currentHongKongDate(now)) {
      await reply.code(400).send({ ok: false, message: "canonical HK symbol and non-future analysisAsOf required" });
      return;
    }
    if (!options.weinsteinProvider?.getHistoricalPrice) {
      await reply.code(503).send({ ok: false, message: "Historical weekly price provider is unavailable" });
      return;
    }
    try {
      const price = await options.weinsteinProvider.getHistoricalPrice(params.market, params.code, query.analysisAsOf);
      if (!validHistoricalWeeklyPrice(price, `HK.${params.code}`, query.analysisAsOf, options.now?.() ?? new Date())) {
        throw new Error("Historical weekly price failed cutoff, identity or usage validation");
      }
      reply.header("cache-control", "no-store");
      return price;
    } catch {
      await reply.code(503).send({ ok: false, message: "Historical completed weekly price is unavailable" });
    }
  });

  app.get("/api/mobile/market/daily-bars/:market/:code", async (request, reply) => {
    const params = request.params as { market: string; code: string };
    const query = request.query as { cutoff?: unknown };
    if (params.market !== "HK" || !/^\d{5}$/.test(params.code)) {
      await reply.code(400).send({ ok: false, message: "only canonical Hong Kong symbols such as HK.09926 are supported" });
      return;
    }
    const now = options.now?.() ?? new Date();
    if (query.cutoff !== undefined && (typeof query.cutoff !== "string"
      || !validCalendarDate(query.cutoff) || query.cutoff > currentHongKongDate(now))) {
      await reply.code(400).send({ ok: false, message: "real non-future cutoff=YYYY-MM-DD is required" });
      return;
    }
    const dated = typeof query.cutoff === "string";
    const explicitCutoff = dated ? undefined : options.cutoff?.();
    let cutoff = dated ? query.cutoff as string : explicitCutoff ?? currentHongKongDate(now);
    let response;
    try {
      if (!dated && !explicitCutoff) cutoff = latestCompletedHongKongSession(now);
      response = await readLatestDailyTechnicalSnapshot(options.pool, params.market, params.code, cutoff)
        ?? (dated ? null : await readLatestLastValidDailyTechnicalSnapshot(options.pool, params.market, params.code, cutoff))
        ?? unavailableDailyTechnicalEnvelope(
          params.market,
          params.code,
          cutoff,
          "No contract-valid stored daily snapshot exists for the requested cutoff; refresh/write is DEFERRED."
        );
    } catch {
      response = unavailableDailyTechnicalEnvelope(
        params.market,
        params.code,
        cutoff,
        "Stored daily snapshot read failed closed; refresh/write is DEFERRED."
      );
    }
    const validation = validateDailyTechnicalEnvelope(response);
    if (!validation.ok) {
      throw new Error("daily technical service returned an invalid fail-closed envelope");
    }
    return response;
  });

  app.post("/api/internal/market/daily-bars/refresh/:market/:code", async (request, reply) => {
    if (!authenticateWrite(request.headers, options)) {
      await reply.code(401).send({ ok: false, message: "write authorization required" });
      return;
    }
    if (!emptyObject(request.body)) {
      await reply.code(400).send({ ok: false, message: "daily refresh request body must be empty" });
      return;
    }
    const params = request.params as { market: string; code: string };
    const query = request.query as { cutoff?: unknown };
    if (params.market !== "HK" || !/^\d{5}$/.test(params.code)) {
      await reply.code(400).send({ ok: false, message: "only canonical Hong Kong symbols such as HK.09926 are supported" });
      return;
    }
    const now = options.now?.() ?? new Date();
    if (query.cutoff !== undefined && (typeof query.cutoff !== "string"
      || !validCalendarDate(query.cutoff) || query.cutoff > currentHongKongDate(now))) {
      await reply.code(400).send({ ok: false, message: "real non-future cutoff=YYYY-MM-DD is required" });
      return;
    }
    const dated = typeof query.cutoff === "string";
    const explicitCutoff = dated ? undefined : options.cutoff?.();
    let cutoff = dated ? query.cutoff as string : explicitCutoff ?? currentHongKongDate(now);
    try {
      if (!dated && !explicitCutoff) cutoff = latestCompletedHongKongSession(now);
    } catch {
      await reply.code(503).send(unavailableDailyTechnicalEnvelope(
        params.market, params.code, cutoff,
        "No supported completed HKEX session is available for the current date."
      ));
      return;
    }
    if (!options.provider || typeof options.pool.connect !== "function") {
      await reply.code(503).send(unavailableDailyTechnicalEnvelope(
        params.market, params.code, cutoff, "Futu history bridge or PostgreSQL writer is not configured."
      ));
      return;
    }

    const refreshKey = `${params.market}.${params.code}:${cutoff}`;
    let refresh = inFlightRefreshes.get(refreshKey);
    if (!refresh) {
      refresh = (async () => {
        const evidence = hkexCompletedSessionEvidence(cutoff, now, dailyHistoryStart(cutoff));
        const envelope = await getDailyTechnicalEnvelope(
          options.provider!, params.market, params.code, cutoff, evidence
        );
        if (!envelope.usableForRequestedCutoff) return envelope;
        await persistDailyTechnicalSnapshot(options.pool as Pick<Pool, "connect">, envelope);
        const stored = await readLatestDailyTechnicalSnapshot(options.pool, params.market, params.code, cutoff);
        if (!stored || stored.dailyBars.snapshot?.snapshotSha !== envelope.dailyBars.snapshot?.snapshotSha
          || stored.technical.resultHash !== envelope.technical.resultHash) {
          throw new Error("fresh stored snapshot proof did not match the refreshed envelope");
        }
        if (!dated && options.weinsteinProvider) {
          try {
            const analysisAsOf = currentHongKongDate(now);
            const weinstein = await getWeinsteinTechnicalAnalysis(
              options.weinsteinProvider, params.market, params.code, analysisAsOf, analysisAsOf
            );
            if (weinstein.status === "available") {
              await persistWeinsteinTechnicalSnapshot(options.pool, weinstein);
            }
          } catch {
            // Daily facts remain usable when the optional weekly candidate cannot be refreshed.
          }
        }
        return stored;
      })();
      inFlightRefreshes.set(refreshKey, refresh);
    }

    try {
      const stored = await refresh;
      if (!stored.usableForRequestedCutoff) {
        await reply.code(503).send(stored);
        return;
      }
      return stored;
    } catch {
      await reply.code(503).send(unavailableDailyTechnicalEnvelope(
        params.market, params.code, cutoff, "Daily history refresh failed closed before a fresh stored proof was available."
      ));
    } finally {
      if (inFlightRefreshes.get(refreshKey) === refresh) inFlightRefreshes.delete(refreshKey);
    }
  });
}

function authenticateWrite(
  headers: Record<string, string | string[] | undefined>,
  options: MobileMarketDailyRouteOptions
): boolean {
  return authenticateResearchWrite(headers, {
    writeAuthToken: options.writeAuthToken ?? null,
    writeAuthHeaderName: options.writeAuthHeaderName ?? "x-internal-token",
    authSigningKey: options.authSigningKey,
    authVerificationKeys: options.authVerificationKeys,
    authRevokedTokenIds: options.authRevokedTokenIds,
    allowLegacyWriteTokenForScopedLanes: options.allowLegacyWriteTokenForScopedLanes,
    requireWriteAuth: options.requireWriteAuth ?? false,
    writeActorId: options.writeActorId ?? "candidate-write-token-principal"
  }, "research_write") !== null;
}

function emptyObject(value: unknown): boolean {
  return value === undefined || value === null
    || typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
