import { pathToFileURL } from "node:url";
import { access, constants } from "node:fs/promises";
import Fastify from "fastify";
import { createPool } from "./db.js";
import { loadConfig, type AppConfig } from "./config.js";
import { registerHealthRoutes } from "./health.js";
import { FutuHttpMarketDataProvider, FixtureMarketDataProvider, UnavailableMarketDataProvider, type MarketDataProvider } from "./market/providers.js";
import { FutuFinancialStatementsProvider } from "./market/futuFinancialStatementsProvider.js";
import { FutuValuationProvider } from "./market/futuValuationProvider.js";
import {
  FutuHttpMarketEnvironmentProvider,
  UnavailableMarketEnvironmentProvider,
  type MarketEnvironmentProvider
} from "./market/environmentProvider.js";
import {
  FutuHistoryKlineDailyBarsProvider,
  FutuHistoryKlineHttpClient,
  type DailyBarsProvider
} from "./market/dailyBarsProvider.js";
import { FutuHttpWeinsteinWeeklyProvider } from "./market/weinsteinTechnicalAnalysis.js";
import { repositoryLocalQuantEvidenceSource } from "./research/repositoryLocalQuantEvidenceSource.js";
import {
  createRegisteredQuantRunCoordinator,
  REGISTERED_QUANT_RUN_CATALOG_PATH
} from "./research/registeredQuantResearchRun.js";
import { createQuantEvidenceTrustedReference } from "./research/quantEvidenceTrustedReference.js";
import { DeepResearchTaskRunner } from "./research/deepResearchTaskRunner.js";
import type { QuantEvidenceRuntimeOptions } from "./research/quantEvidenceSource.js";
import { registerMobileMarketRoutes } from "./routes/mobileMarket.js";
import { registerMobileMarketDailyRoutes } from "./routes/mobileMarketDaily.js";
import { registerMobileResearchRoutes } from "./routes/mobileResearch.js";
import { registerResearchSecondOpinionRoute } from "./routes/researchSecondOpinionRoute.js";
import { registerResearchSourceSnapshotRoutes } from "./routes/researchSourceSnapshotRoutes.js";
import { registerStagingReadOnlyGuard } from "./stagingReadOnly.js";
import { registerRequestObservability } from "./observability.js";
import {
  FutuHttpMarketDiscoveryProvider,
  FutuHttpNoticeLeadProvider,
  HkexOfficialAnnouncementProvider,
  UnavailableMarketDiscoveryProvider,
  UnavailableNoticeLeadProvider
} from "./market/discovery.js";
import { loadHkConnectUniverse } from "./market/hkConnectUniverse.js";

export async function buildServer(config: AppConfig = loadConfig(),intakeOverride?:{announcementProvider?:import("./market/discovery.js").OfficialAnnouncementProvider;sourceIntakeFetchImpl?:typeof fetch}) {
  const app = Fastify({ logger: true, disableRequestLogging: true });
  const pool = createPool(config.databaseUrl);
  const provider = createProvider(config);
  const futuFinancialStatementsProvider = createFutuFinancialStatementsProvider(config);
  const futuValuationProvider = createFutuValuationProvider(config);
  const environmentProvider = createEnvironmentProvider(config);
  const hkConnectUniverse = loadHkConnectUniverse(config.repositoryRoot);
  const discoveryProvider = createDiscoveryProvider(config, hkConnectUniverse);
  const noticeLeadProvider = createNoticeLeadProvider(config);
  const dailyProvider = createDailyProvider(config);
  const weinsteinProvider = config.marketProvider === "futu-http" && config.futuMarketDataUrl
    ? new FutuHttpWeinsteinWeeklyProvider(config.futuMarketDataUrl)
    : null;
  const quantEvidence = buildQuantEvidenceRuntime(config);
  const registeredQuantRun = buildRegisteredQuantRunRuntime(config, quantEvidence);
  const deepResearchTaskRunner = config.nodeEnv === "development" && !config.stagingReadOnlyMode
    ? new DeepResearchTaskRunner(pool, config.researchEvidenceAi, undefined, undefined,
      {repositoryRoot:config.repositoryRoot,rawStoreRoot:config.researchDocumentRawStoreRoot})
    : null;

  registerRequestObservability(app);

  app.addHook("onClose", async () => {
    await deepResearchTaskRunner?.stop();
    await pool.end();
  });

  app.addHook("onReady", async () => {
    deepResearchTaskRunner?.start();
  });

  registerStagingReadOnlyGuard(app, {
    enabled: config.stagingReadOnlyMode,
    identity: config.stagingIdentity
  });

  registerHealthRoutes(app, {
    pool,
    marketProvider: provider.name,
    stagingReadOnly: config.stagingReadOnlyMode,
    stagingIdentity: config.stagingIdentity,
    marketDataProbe: marketDataHealthProbe(config),
    rawStoreProbe: config.researchDocumentRawStoreRoot
      ? async () => {
        await access(config.researchDocumentRawStoreRoot!, constants.R_OK | constants.W_OK);
        return true;
      }
      : undefined,
    researchAiConfigured: config.researchEvidenceAi !== null,
    taskRunnerEnabled: deepResearchTaskRunner !== null
  });

  await registerMobileMarketRoutes(app, {
    pool,
    provider,
    environmentProvider,
    discoveryProvider,
    noticeLeadProvider,
    announcementProvider: new HkexOfficialAnnouncementProvider(),
    hkConnectUniverse,
    quoteLiveMaxAgeSeconds: config.quoteLiveMaxAgeSeconds,
    writeAuthToken: config.writeAuthToken,
    writeAuthHeaderName: config.writeAuthHeaderName,
    stagingReadOnlyAuthToken: config.stagingReadOnlyAuthToken,
    stagingReadOnlyAuthHeaderName: config.stagingReadOnlyAuthHeaderName,
    requireWriteAuth: config.requireWriteAuth,
    authSigningKey: config.authSigningKey,
    authVerificationKeys: config.authVerificationKeys,
    authRevokedTokenIds: config.authRevokedTokenIds,
    allowLegacyWriteTokenForScopedLanes: config.allowLegacyWriteTokenForScopedLanes,
    writeActorId: config.writeActorId
  });
  await registerMobileMarketDailyRoutes(app, {
    pool,
    provider: dailyProvider,
    weinsteinProvider,
    writeAuthToken: config.writeAuthToken,
    writeAuthHeaderName: config.writeAuthHeaderName,
    requireWriteAuth: config.requireWriteAuth,
    authSigningKey: config.authSigningKey,
    authVerificationKeys: config.authVerificationKeys,
    authRevokedTokenIds: config.authRevokedTokenIds,
    allowLegacyWriteTokenForScopedLanes: config.allowLegacyWriteTokenForScopedLanes,
    writeActorId: config.writeActorId
  });
  await registerMobileResearchRoutes(app, {
    pool,
    marketEnvironmentProvider: environmentProvider,
    benchmarkCacheFile: process.env.PERSONAL_MARKET_ANOMALY_BENCHMARK_CACHE_FILE,
    anomalyJournalFile: process.env.PERSONAL_MARKET_ANOMALY_JOURNAL_FILE,
    investigationMarketProvider: provider,
    futuFinancialStatementsProvider,
    futuValuationProvider,
    weinsteinProvider,
    announcementProvider:intakeOverride?.announcementProvider??new HkexOfficialAnnouncementProvider(),noticeLeadProvider,sourceIntakeFetchImpl:intakeOverride?.sourceIntakeFetchImpl,
    writeAuthToken: config.writeAuthToken,
    writeAuthHeaderName: config.writeAuthHeaderName,
    stagingReadOnlyAuthToken: config.stagingReadOnlyAuthToken,
    stagingReadOnlyAuthHeaderName: config.stagingReadOnlyAuthHeaderName,
    authSigningKey: config.authSigningKey,
    authVerificationKeys: config.authVerificationKeys,
    authRevokedTokenIds: config.authRevokedTokenIds,
    allowLegacyWriteTokenForScopedLanes: config.allowLegacyWriteTokenForScopedLanes,
    requireWriteAuth: config.requireWriteAuth,
    writeActorId: config.writeActorId,
    quoteLiveMaxAgeSeconds: config.quoteLiveMaxAgeSeconds,
    pinganCurrentPortfolioEnabled: config.pinganCurrentPortfolioEnabled,
    pinganCurrentMaxAgeSeconds: config.pinganCurrentMaxAgeSeconds,
    pinganSnapshotAccountScopesByActor: config.pinganSnapshotAccountScopesByActor,
    deepResearchTaskKick: deepResearchTaskRunner
      ? () => deepResearchTaskRunner.kick()
      : undefined,
    researchEvidenceAi: config.researchEvidenceAi,
    researchDocument: {
      repositoryRoot: config.repositoryRoot,
      rawStoreRoot: config.researchDocumentRawStoreRoot,
      maxBytes: config.researchDocumentMaxBytes,
      maxPages: config.researchDocumentMaxPages,
      maxPageTextCharacters: config.researchDocumentMaxPageTextCharacters,
      maxTotalTextCharacters: config.researchDocumentMaxTotalTextCharacters,
      ocrExecutablePath: config.researchDocumentOcrExecutablePath,
      maxOcrPages: config.researchDocumentMaxOcrPages,
      maxOcrPageTextCharacters: config.researchDocumentMaxOcrPageTextCharacters,
      ocrTimeoutMs: config.researchDocumentOcrTimeoutMs,
      ocrMaxBufferBytes: config.researchDocumentOcrMaxBufferBytes
    },
    quantEvidence,
    registeredQuantRun
  });

  registerResearchSecondOpinionRoute(app, {
    pool, researchEvidenceAi: config.researchEvidenceAi,
    repositoryRoot: config.repositoryRoot, rawStoreRoot: config.researchDocumentRawStoreRoot,
    writeAuthToken: config.writeAuthToken, writeAuthHeaderName: config.writeAuthHeaderName,
    stagingReadOnlyAuthToken: config.stagingReadOnlyAuthToken,
    stagingReadOnlyAuthHeaderName: config.stagingReadOnlyAuthHeaderName,
    authSigningKey: config.authSigningKey,
    authVerificationKeys: config.authVerificationKeys,
    authRevokedTokenIds: config.authRevokedTokenIds,
    allowLegacyWriteTokenForScopedLanes: config.allowLegacyWriteTokenForScopedLanes,
    requireWriteAuth: config.requireWriteAuth, writeActorId: config.writeActorId
  });

  await registerResearchSourceSnapshotRoutes(app, {
    pool, repositoryRoot: config.repositoryRoot, rawStoreRoot: config.researchDocumentRawStoreRoot,
    fetchImpl: intakeOverride?.sourceIntakeFetchImpl,
    writeAuthToken: config.writeAuthToken, writeAuthHeaderName: config.writeAuthHeaderName,
    stagingReadOnlyAuthToken: config.stagingReadOnlyAuthToken,
    stagingReadOnlyAuthHeaderName: config.stagingReadOnlyAuthHeaderName,
    authSigningKey: config.authSigningKey, authVerificationKeys: config.authVerificationKeys,
    authRevokedTokenIds: config.authRevokedTokenIds,
    allowLegacyWriteTokenForScopedLanes: config.allowLegacyWriteTokenForScopedLanes,
    requireWriteAuth: config.requireWriteAuth, writeActorId: config.writeActorId
  });

  return app;
}

export function buildQuantEvidenceRuntime(config: AppConfig): QuantEvidenceRuntimeOptions {
  if (!config.quantEvidence) return { decision: null, annualPortfolioLab: null };
  const source = repositoryLocalQuantEvidenceSource;
  const repositoryRoot = config.quantEvidence.repositoryRoot;
  const hkConnectUniverse = loadHkConnectUniverse(config.repositoryRoot);
  return {
    decision: {
      address: {
        repositoryRoot,
        repositoryPath: config.quantEvidence.decision.repositoryPath,
        expectedSha256: config.quantEvidence.decision.expectedSha256
      },
      source,
      maxAgeDays: config.quantEvidence.decision.maxAgeDays,
      hkConnectUniverse
    },
    annualPortfolioLab: config.quantEvidence.annualPortfolioLab ? {
      address: {
        repositoryRoot,
        repositoryPath: config.quantEvidence.annualPortfolioLab.repositoryPath,
        expectedSha256: config.quantEvidence.annualPortfolioLab.expectedSha256
      },
      source,
      maxAgeDays: config.quantEvidence.decision.maxAgeDays,
      hkConnectUniverse
    } : null
  };
}

/**
 * Local-only registered quantitative research run wiring. Runtime execution is
 * disabled unless explicitly enabled, and the trusted catalog reference is
 * shared with the existing content-addressed read path so a published artifact
 * becomes the accepted evidence pointer without changing process environment.
 */
export function buildRegisteredQuantRunRuntime(
  config: AppConfig,
  quantEvidence: QuantEvidenceRuntimeOptions
): import("./research/registeredQuantResearchRun.js").RegisteredQuantRunRuntimeOptions | null {
  const decision = quantEvidence.decision;
  if (!decision) return null;
  const catalogReference = createQuantEvidenceTrustedReference(decision.address);
  return {
    enabled: config.quantRegisteredRunEnabled && config.nodeEnv === "development" && !config.stagingReadOnlyMode,
    catalogPath: REGISTERED_QUANT_RUN_CATALOG_PATH,
    coordinator: createRegisteredQuantRunCoordinator({
      repositoryRoot: decision.address.repositoryRoot,
      nodeExecutable: process.execPath,
      catalogPath: REGISTERED_QUANT_RUN_CATALOG_PATH,
      catalogReference,
      source: decision.source,
      decisionEvidence: {
        maxAgeDays: decision.maxAgeDays,
        ...(decision.hkConnectUniverse ? { hkConnectUniverse: decision.hkConnectUniverse } : {})
      }
    })
  };
}

function createProvider(config: AppConfig): MarketDataProvider {
  if (config.marketProvider === "fixture") {
    return new FixtureMarketDataProvider();
  }
  if (config.marketProvider === "futu-http" && config.futuMarketDataUrl) {
    return new FutuHttpMarketDataProvider(config.futuMarketDataUrl);
  }
  return new UnavailableMarketDataProvider("Futu market-data adapter is not configured");
}

function createFutuFinancialStatementsProvider(config:AppConfig):FutuFinancialStatementsProvider|null{
  if(config.marketProvider!=="futu-http"||!config.futuMarketDataUrl)return null;
  try{return new FutuFinancialStatementsProvider(config.futuMarketDataUrl);}
  catch{return null;}
}

function createFutuValuationProvider(config:AppConfig):FutuValuationProvider|null{
  if(config.marketProvider!=="futu-http"||!config.futuMarketDataUrl)return null;
  try{return new FutuValuationProvider(config.futuMarketDataUrl);}
  catch{return null;}
}

function createEnvironmentProvider(config: AppConfig): MarketEnvironmentProvider {
  return config.marketProvider === "futu-http" && config.futuMarketDataUrl
    ? new FutuHttpMarketEnvironmentProvider(config.futuMarketDataUrl)
    : new UnavailableMarketEnvironmentProvider("Futu market-environment adapter is not configured");
}

function createDiscoveryProvider(config: AppConfig, hkConnectUniverse: ReturnType<typeof loadHkConnectUniverse>) {
  return config.marketProvider === "futu-http" && config.futuMarketDataUrl
    ? new FutuHttpMarketDiscoveryProvider(config.futuMarketDataUrl, hkConnectUniverse)
    : new UnavailableMarketDiscoveryProvider("Futu OpenD candidate discovery is not configured");
}

function createNoticeLeadProvider(config: AppConfig) {
  return config.marketProvider === "futu-http" && config.futuMarketDataUrl
    ? new FutuHttpNoticeLeadProvider(config.futuMarketDataUrl)
    : new UnavailableNoticeLeadProvider("Futu OpenD information discovery is not configured");
}

function createDailyProvider(config: AppConfig): DailyBarsProvider | null {
  return config.futuHistoryKlineUrl
    ? new FutuHistoryKlineDailyBarsProvider(new FutuHistoryKlineHttpClient(config.futuHistoryKlineUrl))
    : null;
}

function marketDataHealthProbe(config: AppConfig): (() => Promise<boolean>) | undefined {
  if (config.marketProvider === "fixture") return async () => true;
  if (config.marketProvider !== "futu-http" || !config.futuMarketDataUrl) return undefined;
  const baseUrl = config.futuMarketDataUrl;
  return async () => {
    const response = await fetch(new URL("/health", baseUrl), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(3_000)
    });
    if (!response.ok) return false;
    const body = await response.json() as unknown;
    return typeof body === "object" && body !== null && "ok" in body && body.ok === true;
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const app = await buildServer(config);
  await app.listen({ host: config.host, port: config.port });
}
