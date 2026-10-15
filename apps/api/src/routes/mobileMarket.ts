import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readLatestQuoteEnvelope, refreshQuote, searchKnownHongKongStocks } from "../market/repository.js";
import type { MarketDataProvider } from "../market/providers.js";
import type { MarketEnvironmentProvider } from "../market/environmentProvider.js";
import {
  exactDiscoveryCandidate,
  generateMarketDiscoveryQualification,
  type MarketDiscoveryProvider,
  type NoticeLeadProvider,
  type OfficialAnnouncementProvider
} from "../market/discovery.js";
import { authenticateReadOnly, authenticateWrite as authenticateResearchWrite } from "./researchAuth.js";
import {
  MARKET_SEARCH_SCHEMA_VERSION,
  makeUnavailableMarketQuoteEnvelope,
  makeUnavailableMarketSearchEnvelope,
  validateMarketQuoteEnvelope,
  validateMarketSearchEnvelope
} from "../../../../packages/contracts/src/market.js";
import {
  makeUnavailableMarketEnvironmentEnvelope,
  validateMarketEnvironmentEnvelope
} from "../../../../packages/contracts/src/marketEnvironment.js";
import {
  MARKET_DISCOVERY_SCHEMA_VERSION,
  unknownMarketDiscoveryEligibility,
  unavailableCandidateDiscovery,
  unavailableMarketDiscoveryQualification,
  unavailableNoticeLeads,
  unavailableOfficialAnnouncements,
  validateMarketDiscoveryEnvelope,
  validateMarketDiscoveryQualificationEnvelope,
  validateQualifyMarketDiscoveryCandidateRequest,
  type QualifyMarketDiscoveryCandidateRequest
} from "../../../../packages/contracts/src/marketDiscovery.js";
import { classifyHkConnectEligibility, type HkConnectUniverse } from "../market/hkConnectUniverse.js";

export interface MobileMarketRouteOptions {
  pool: Pool;
  provider: MarketDataProvider;
  environmentProvider: MarketEnvironmentProvider;
  discoveryProvider?: MarketDiscoveryProvider;
  noticeLeadProvider?: NoticeLeadProvider;
  announcementProvider?: OfficialAnnouncementProvider;
  hkConnectUniverse?: HkConnectUniverse;
  quoteLiveMaxAgeSeconds: number;
  writeAuthToken?: string | null;
  writeAuthHeaderName?: string;
  stagingReadOnlyAuthToken?: string | null;
  stagingReadOnlyAuthHeaderName?: string;
  requireWriteAuth?: boolean;
  authSigningKey?: string | null;
  authVerificationKeys?: string[];
  authRevokedTokenIds?: Set<string>;
  allowLegacyWriteTokenForScopedLanes?: boolean;
  writeActorId?: string;
}

export async function registerMobileMarketRoutes(app: FastifyInstance, options: MobileMarketRouteOptions): Promise<void> {
  app.get<{ Querystring: { symbol?: string } }>("/api/mobile/market/discovery", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const discoverySymbol = request.query.symbol;
    const noticeSymbol = discoverySymbol ?? "HK.00175";
    if (!/^HK\.\d{5}$/.test(noticeSymbol)) {
      return reply.code(400).send({ ok: false, message: "symbol must be canonical HK.#####" });
    }
    const [candidates, notices, announcements] = await Promise.all([
      options.discoveryProvider?.read().catch(() => unavailableCandidateDiscovery("OpenD candidate discovery is unavailable."))
        ?? unavailableCandidateDiscovery("OpenD candidate discovery is not configured."),
      options.noticeLeadProvider?.read(noticeSymbol).catch(() => unavailableNoticeLeads("OpenD information discovery is unavailable.", noticeSymbol))
        ?? unavailableNoticeLeads("OpenD information discovery is not configured.", noticeSymbol),
      options.announcementProvider?.read(noticeSymbol).catch(() => unavailableOfficialAnnouncements("HKEXnews announcement discovery is unavailable."))
        ?? unavailableOfficialAnnouncements("HKEXnews announcement discovery is not configured.")
    ]);
    const availableCount = [candidates.status, notices.status, announcements.status].filter((status) => status === "available").length;
    const eligibility = options.hkConnectUniverse
      ? classifyHkConnectEligibility(options.hkConnectUniverse, noticeSymbol)
      : unknownMarketDiscoveryEligibility(noticeSymbol, "Official Hong Kong Connect eligibility is unavailable.");
    const envelope = {
      schemaVersion: MARKET_DISCOVERY_SCHEMA_VERSION,
      status: availableCount === 3 ? "available" as const : availableCount > 0 ? "partial" as const : "unavailable" as const,
      generatedAt: new Date().toISOString(),
      eligibility,
      candidates,
      notices,
      announcements,
      message: "Daily discovery is evidence-first and advisory-only; OpenD announcement and major-news metadata remain unverified leads, and official facts require explicit Owner verification."
    };
    if (!validateMarketDiscoveryEnvelope(envelope, noticeSymbol).ok) {
      await reply.code(503).send({
        ...envelope,
        status: "unavailable",
        candidates: unavailableCandidateDiscovery("Candidate discovery failed response validation."),
        notices: unavailableNoticeLeads("OpenD information discovery failed response validation.", noticeSymbol),
        announcements: unavailableOfficialAnnouncements("HKEXnews discovery failed response validation."),
        message: "Daily discovery failed response validation."
      });
      return;
    }
    if (envelope.status === "unavailable") reply.code(503);
    return envelope;
  });

  app.post("/api/mobile/market/discovery/qualifications", async (request, reply) => {
    const body = request.body as unknown;
    const symbol = requestedQualificationSymbol(body);
    const fail = (code: number, message: string, status: "conflict" | "unavailable" = "unavailable") => (
      reply.code(code).send(unavailableMarketDiscoveryQualification(symbol, message, status))
    );
    if (!authenticateReadOnly(request.headers, researchAuthOptions(options))) return fail(401, "read authorization required");
    const validation = validateQualifyMarketDiscoveryCandidateRequest(body);
    if (!validation.ok) return fail(400, validation.errors.join("; "));
    const qualificationRequest = body as QualifyMarketDiscoveryCandidateRequest;
    try {
      const initialLane = await options.discoveryProvider?.read(symbol)
        ?? unavailableCandidateDiscovery("OpenD candidate discovery is not configured.");
      if (initialLane.status !== "available") return fail(503, "OpenD 候选当前不可用；未生成核查结果。");
      const candidate = exactDiscoveryCandidate(initialLane, qualificationRequest);
      if (!candidate) return fail(409, "候选快照已变化或不再属于当前筛选结果；请刷新后重试。", "conflict");
      const qualification = generateMarketDiscoveryQualification(initialLane, candidate, qualificationRequest.discoveryFetchedAt);
      if (!validateMarketDiscoveryQualificationEnvelope(qualification).ok) {
        return fail(503, "候选核查响应未通过契约校验；没有展示部分结果。");
      }
      return qualification;
    } catch {
      return fail(503, "候选轻量核查暂不可用；没有展示旧结果或部分结果。");
    }
  });

  app.get("/api/mobile/market/environment/:market/:code", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const params = request.params as { market: string; code: string };
    if (!isSupportedHongKongSymbol(params.market, params.code)) {
      await reply.code(400).send({ ok: false, message: "only Hong Kong symbols such as HK.00175 are supported" });
      return;
    }
    const requestedSymbol = canonicalHongKongSymbol(params.market, params.code);
    try {
      const envelope = await options.environmentProvider.getEnvironment(params.market.trim().toUpperCase(), params.code.trim());
      if (!validateMarketEnvironmentEnvelope(envelope).ok || envelope.requestedSymbol !== requestedSymbol) {
        await reply.code(503).send(makeUnavailableMarketEnvironmentEnvelope(
          requestedSymbol,
          "market environment failed contract validation before response"
        ));
        return;
      }
      if (envelope.status === "unavailable") reply.code(503);
      return envelope;
    } catch (_error) {
      await reply.code(503).send(makeUnavailableMarketEnvironmentEnvelope(
        requestedSymbol,
        "market environment provider is unavailable"
      ));
    }
  });

  app.get("/api/mobile/market/search", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const rawQuery = (request.query as { q?: unknown }).q;
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
    if (query.length === 0 || query.length > 80) {
      await reply.code(400).send({ ok: false, message: "search query must contain 1 to 80 characters" });
      return;
    }
    try {
      const providerSearch = await options.provider.searchHongKongStocks?.(query).catch(() => null) ?? null;
      if (providerSearch?.status === "available" && providerSearch.fetchedAt
        && Number.isFinite(providerSearch.fetchedAt.getTime())) {
        const envelope = {
          schemaVersion: MARKET_SEARCH_SCHEMA_VERSION,
          status: "available" as const,
          query,
          scope: "futu_opend_hk_stocks" as const,
          source: { provider: "futu_opend" as const, fetchedAt: providerSearch.fetchedAt.toISOString(), quoteDataOnly: true as const },
          results: providerSearch.results,
          message: "已读取 Futu/OpenD 港股基础资料；结果只用于标的识别，不是推荐或排名。"
        };
        if (validateMarketSearchEnvelope(envelope).ok) return envelope;
      }
      const envelope = {
        schemaVersion: MARKET_SEARCH_SCHEMA_VERSION,
        status: "available" as const,
        query,
        scope: "local_known_stocks" as const,
        source: { provider: "local_database" as const, fetchedAt: new Date().toISOString(), quoteDataOnly: true as const },
        results: await searchKnownHongKongStocks(options.pool, query),
        message: "Futu/OpenD 暂不可用；当前仅显示本地数据库已收录的港股，不是推荐或排名。"
      };
      if (!validateMarketSearchEnvelope(envelope).ok) {
        await reply.code(503).send(makeUnavailableMarketSearchEnvelope(query, "local known-stock search returned invalid identities"));
        return;
      }
      return envelope;
    } catch (_error) {
      await reply.code(503).send(makeUnavailableMarketSearchEnvelope(query, "local known-stock search is unavailable"));
    }
  });

  app.get("/api/mobile/market/quotes/:market/:code", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const params = request.params as { market: string; code: string };
    if (!isSupportedHongKongSymbol(params.market, params.code)) {
      await reply.code(400).send({ ok: false, message: "only Hong Kong symbols such as HK.09926 are supported" });
      return;
    }
    try {
      const envelope = await readLatestQuoteEnvelope(options.pool, params.market, params.code, options.quoteLiveMaxAgeSeconds);
      const validation = validateMarketQuoteEnvelope(envelope);
      if (!validation.ok) {
        await reply.code(503).send(makeUnavailableMarketQuoteEnvelope(
          "Assembled market quote failed contract validation before response.",
          "unavailable",
          canonicalHongKongSymbol(params.market, params.code)
        ));
        return;
      }
      return envelope;
    } catch (_error) {
      await reply.code(503).send(makeUnavailableMarketQuoteEnvelope(
        "market quote repository is unavailable",
        "unavailable",
        canonicalHongKongSymbol(params.market, params.code)
      ));
    }
  });

  app.post("/api/internal/market/refresh/:market/:code", async (request, reply) => {
    if (!authenticateWrite(request.headers, options)) {
      await reply.code(401).send({ ok: false, message: "write authorization required" });
      return;
    }
    const bodyErrors = validateInternalMarketRefreshBody(request.body);
    if (bodyErrors.length > 0) {
      await reply.code(400).send({ ok: false, errors: bodyErrors });
      return;
    }
    const params = request.params as { market: string; code: string };
    if (!isSupportedHongKongSymbol(params.market, params.code)) {
      await reply.code(400).send({ ok: false, message: "only Hong Kong symbols such as HK.09926 are supported" });
      return;
    }
    try {
      const providerResult = await options.provider.getQuote(params.market, params.code);
      const envelope = await refreshQuote(options.pool, params.market, params.code, providerResult, options.quoteLiveMaxAgeSeconds);
      const validation = validateMarketQuoteEnvelope(envelope);
      if (!validation.ok) {
        await reply.code(503).send(makeUnavailableMarketQuoteEnvelope(
          "Refreshed market quote failed contract validation before response.",
          "unavailable",
          canonicalHongKongSymbol(params.market, params.code)
        ));
        return;
      }
      return envelope;
    } catch (_error) {
      await reply.code(503).send(makeUnavailableMarketQuoteEnvelope(
        "internal market refresh repository is unavailable",
        "unavailable",
        canonicalHongKongSymbol(params.market, params.code)
      ));
    }
  });
}

function isSupportedHongKongSymbol(market: string, code: string): boolean {
  return market.trim().toUpperCase() === "HK" && /^\d{5}$/.test(code.trim());
}

function canonicalHongKongSymbol(market: string, code: string): string {
  return `${market.trim().toUpperCase()}.${code.trim()}`;
}

function validateInternalMarketRefreshBody(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== "object" || Array.isArray(value)) {
    return ["request body must be an object when present"];
  }
  const errors: string[] = [];
  const record = value as Record<string, unknown>;
  for (const key of ["actorType", "actorId", "correlationId"]) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      errors.push(`${key} is not allowed`);
    }
  }
  for (const key of ["source", "audit", "metadata", "rawPayload"]) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      errors.push(`request.${key} is not allowed`);
    }
  }
  for (const key of Object.keys(record)) {
    errors.push(`market refresh request body must be empty; unexpected field ${key}`);
  }
  return errors;
}

function authenticateWrite(
  headers: Record<string, string | string[] | undefined>,
  options: MobileMarketRouteOptions
): boolean {
  return authenticateResearchWrite(headers, {
    writeAuthToken: options.writeAuthToken ?? null,
    writeAuthHeaderName: options.writeAuthHeaderName ?? "x-internal-token",
    authSigningKey: options.authSigningKey,
    authVerificationKeys: options.authVerificationKeys,
    authRevokedTokenIds: options.authRevokedTokenIds,
    allowLegacyWriteTokenForScopedLanes: options.allowLegacyWriteTokenForScopedLanes,
    requireWriteAuth: options.requireWriteAuth ?? false,
    writeActorId: options.writeActorId ?? "market-refresh"
  }, "research_write") !== null;
}

function researchAuthOptions(options: MobileMarketRouteOptions) {
  return {
    writeAuthToken: options.writeAuthToken ?? null,
    writeAuthHeaderName: options.writeAuthHeaderName ?? "x-internal-token",
    stagingReadOnlyAuthToken: options.stagingReadOnlyAuthToken ?? null,
    stagingReadOnlyAuthHeaderName: options.stagingReadOnlyAuthHeaderName,
    authSigningKey: options.authSigningKey,
    authVerificationKeys: options.authVerificationKeys,
    authRevokedTokenIds: options.authRevokedTokenIds,
    requireWriteAuth: options.requireWriteAuth ?? false,
    writeActorId: options.writeActorId ?? "market-refresh"
  };
}

function requestedQualificationSymbol(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "HK.00000";
  const record = value as Record<string, unknown>;
  const candidate = record.candidate;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return "HK.00000";
  const symbol = (candidate as Record<string, unknown>).symbol;
  return typeof symbol === "string" && /^HK\.\d{5}$/.test(symbol) ? symbol : "HK.00000";
}
