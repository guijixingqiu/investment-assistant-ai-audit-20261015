import { dirname, isAbsolute, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type MarketProviderKind = "fixture" | "futu-http" | "unavailable";

export interface QuantEvidenceConfig {
  repositoryRoot: string;
  decision: {
    repositoryPath: string;
    expectedSha256: string;
    maxAgeDays: number;
  };
  annualPortfolioLab: {
    repositoryPath: string;
    expectedSha256: string;
  } | null;
}

export interface ResearchEvidenceAiConfig {
  baseUrl: string;
  model: "deepseek-flash";
  apiKey: string;
  timeoutMs: number;
}

export interface AppConfig {
  repositoryRoot: string;
  databaseUrl: string;
  nodeEnv: string;
  host: string;
  port: number;
  stagingReadOnlyMode: boolean;
  stagingIdentity: string;
  marketProvider: MarketProviderKind;
  futuMarketDataUrl: string | null;
  futuHistoryKlineUrl: string | null;
  quoteLiveMaxAgeSeconds: number;
  pinganCurrentPortfolioEnabled: boolean;
  pinganCurrentMaxAgeSeconds: number;
  pinganSnapshotAccountScopesByActor: Record<string, string>;
  quantEvidence: QuantEvidenceConfig | null;
  quantRegisteredRunEnabled: boolean;
  writeAuthToken: string | null;
  writeAuthHeaderName: string;
  stagingReadOnlyAuthToken: string | null;
  stagingReadOnlyAuthHeaderName: string;
  authSigningKey: string | null;
  authVerificationKeys: string[];
  authRevokedTokenIds: Set<string>;
  allowLegacyWriteTokenForScopedLanes: boolean;
  requireWriteAuth: boolean;
  writeActorId: string;
  researchDocumentRawStoreRoot: string | null;
  researchDocumentMaxBytes: number;
  researchDocumentMaxPages: number;
  researchDocumentMaxPageTextCharacters: number;
  researchDocumentMaxTotalTextCharacters: number;
  researchDocumentOcrExecutablePath: string | null;
  researchDocumentMaxOcrPages: number;
  researchDocumentMaxOcrPageTextCharacters: number;
  researchDocumentOcrTimeoutMs: number;
  researchDocumentOcrMaxBufferBytes: number;
  researchEvidenceAi: ResearchEvidenceAiConfig | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const futuMarketDataUrl = emptyToNull(env.FUTU_MARKET_DATA_URL) ?? emptyToNull(env.MARKET_DATA_BASE_URL);
  const futuHistoryKlineUrl = parseLoopbackHttpUrl(env.FUTU_HISTORY_KLINE_URL, "FUTU_HISTORY_KLINE_URL");
  const explicitProvider = emptyToNull(env.MARKET_PROVIDER) as MarketProviderKind | null;
  const marketProvider = explicitProvider ?? (futuMarketDataUrl ? "futu-http" : "unavailable");
  const stagingReadOnlyMode = parseBoolean(env.STAGING_READONLY_MODE, false);
  const stagingIdentity = emptyToNull(env.STAGING_READONLY_IDENTITY);
  const writeAuthToken = emptyToNull(env.WRITE_API_TOKEN) ?? emptyToNull(env.INTERNAL_API_TOKEN);
  const stagingReadOnlyAuthToken = emptyToNull(env.STAGING_READONLY_AUTH_TOKEN);
  const stagingReadOnlyAuthHeaderName = emptyToNull(env.STAGING_READONLY_AUTH_HEADER_NAME) ?? "";
  const authSigningKey = emptyToNull(env.API_AUTH_SIGNING_KEY);
  const authVerificationKeys = parseCsv(env.API_AUTH_VERIFICATION_KEYS);
  const authRevokedTokenIds = new Set(parseCsv(env.API_AUTH_REVOKED_TOKEN_IDS));
  const pinganCurrentPortfolioEnabled = parseBoolean(
    env.PINGAN_CURRENT_PORTFOLIO_ENABLED,
    nodeEnv === "development"
  );
  const pinganSnapshotAccountScopesByActor = parseActorScopeMap(env.PINGAN_SNAPSHOT_ACCOUNT_SCOPES);
  const quantEvidence = parseQuantEvidenceConfig(env);
  const researchEvidenceAi = parseResearchEvidenceAiConfig(env);

  if (!["fixture", "futu-http", "unavailable"].includes(marketProvider)) {
    throw new Error("MARKET_PROVIDER must be fixture, futu-http, or unavailable");
  }
  if (stagingReadOnlyMode && (!stagingIdentity || isPlaceholder(stagingIdentity))) {
    throw new Error("STAGING_READONLY_IDENTITY is required and must be non-placeholder when STAGING_READONLY_MODE=1");
  }
  if (stagingReadOnlyMode && (!stagingReadOnlyAuthHeaderName || isPlaceholder(stagingReadOnlyAuthHeaderName))) {
    throw new Error("STAGING_READONLY_AUTH_HEADER_NAME is required and must be non-placeholder when STAGING_READONLY_MODE=1");
  }
  if (stagingReadOnlyMode && (!stagingReadOnlyAuthToken || isPlaceholder(stagingReadOnlyAuthToken))) {
    throw new Error("STAGING_READONLY_AUTH_TOKEN is required and must be non-placeholder when STAGING_READONLY_MODE=1");
  }
  if (stagingReadOnlyAuthToken && isForbiddenStagingReadOnlyTokenSentinel(stagingReadOnlyAuthToken)) {
    throw new Error("STAGING_READONLY_AUTH_TOKEN must be replaced with a real read-only scoped secret");
  }
  if (writeAuthToken && stagingReadOnlyAuthToken && stagingReadOnlyAuthToken === writeAuthToken) {
    throw new Error("STAGING_READONLY_AUTH_TOKEN must be distinct from WRITE_API_TOKEN and INTERNAL_API_TOKEN");
  }
  if (authSigningKey && authSigningKey.length < 32) {
    throw new Error("API_AUTH_SIGNING_KEY must contain at least 32 characters when configured");
  }
  if (authVerificationKeys.some((key) => key.length < 32)) {
    throw new Error("every API_AUTH_VERIFICATION_KEYS entry must contain at least 32 characters");
  }
  if (pinganCurrentPortfolioEnabled && nodeEnv !== "development") {
    throw new Error("PINGAN_CURRENT_PORTFOLIO_ENABLED may only be enabled when NODE_ENV=development");
  }
  if (Object.keys(pinganSnapshotAccountScopesByActor).length > 0 && nodeEnv !== "development") {
    throw new Error("PINGAN_SNAPSHOT_ACCOUNT_SCOPES may only be configured when NODE_ENV=development");
  }
  if (researchEvidenceAi && nodeEnv !== "development") {
    throw new Error("RESEARCH_AI_API_KEY may only be enabled when NODE_ENV=development");
  }

  return {
    repositoryRoot: defaultRepositoryRoot(),
    databaseUrl: env.DATABASE_URL ?? "postgres://localhost/annual_rings_candidate",
    nodeEnv,
    host: env.HOST ?? "127.0.0.1",
    port: parseInteger(env.PORT, 4010),
    stagingReadOnlyMode,
    stagingIdentity: stagingIdentity ?? "local-candidate",
    marketProvider,
    futuMarketDataUrl,
    futuHistoryKlineUrl,
    quoteLiveMaxAgeSeconds: parseInteger(env.QUOTE_LIVE_MAX_AGE_SECONDS, 300),
    pinganCurrentPortfolioEnabled,
    pinganCurrentMaxAgeSeconds: parsePositiveInteger(env.PINGAN_CURRENT_MAX_AGE_SECONDS, 300),
    pinganSnapshotAccountScopesByActor,
    quantEvidence,
    quantRegisteredRunEnabled: parseBoolean(env.QUANT_REGISTERED_RUN_ENABLED, false),
    writeAuthToken,
    writeAuthHeaderName: emptyToNull(env.WRITE_API_AUTH_HEADER) ?? "x-internal-token",
    stagingReadOnlyAuthToken,
    stagingReadOnlyAuthHeaderName,
    authSigningKey,
    authVerificationKeys,
    authRevokedTokenIds,
    allowLegacyWriteTokenForScopedLanes: parseBoolean(env.ALLOW_LEGACY_WRITE_TOKEN_FOR_SCOPED_LANES, false),
    requireWriteAuth: parseBoolean(env.REQUIRE_WRITE_AUTH, nodeEnv !== "development"),
    writeActorId: emptyToNull(env.RESEARCH_WRITE_ACTOR_ID) ?? "candidate-write-token-principal",
    researchDocumentRawStoreRoot: parseAbsoluteOptionalPath(env.RESEARCH_DOCUMENT_RAW_STORE_ROOT, "RESEARCH_DOCUMENT_RAW_STORE_ROOT"),
    researchDocumentMaxBytes: parsePositiveIntegerNamed(env.RESEARCH_DOCUMENT_MAX_BYTES, 20 * 1024 * 1024, "RESEARCH_DOCUMENT_MAX_BYTES"),
    researchDocumentMaxPages: parsePositiveIntegerNamed(env.RESEARCH_DOCUMENT_MAX_PAGES, 400, "RESEARCH_DOCUMENT_MAX_PAGES"),
    researchDocumentMaxPageTextCharacters: parsePositiveIntegerNamed(
      env.RESEARCH_DOCUMENT_MAX_PAGE_TEXT_CHARACTERS,
      200_000,
      "RESEARCH_DOCUMENT_MAX_PAGE_TEXT_CHARACTERS"
    ),
    researchDocumentMaxTotalTextCharacters: parsePositiveIntegerNamed(
      env.RESEARCH_DOCUMENT_MAX_TOTAL_TEXT_CHARACTERS,
      5_000_000,
      "RESEARCH_DOCUMENT_MAX_TOTAL_TEXT_CHARACTERS"
    ),
    researchDocumentOcrExecutablePath: parseAbsoluteOptionalPath(
      env.RESEARCH_DOCUMENT_OCR_EXECUTABLE,
      "RESEARCH_DOCUMENT_OCR_EXECUTABLE"
    ),
    researchDocumentMaxOcrPages: parsePositiveIntegerNamed(
      env.RESEARCH_DOCUMENT_MAX_OCR_PAGES,
      100,
      "RESEARCH_DOCUMENT_MAX_OCR_PAGES"
    ),
    researchDocumentMaxOcrPageTextCharacters: parsePositiveIntegerNamed(
      env.RESEARCH_DOCUMENT_MAX_OCR_PAGE_TEXT_CHARACTERS,
      200_000,
      "RESEARCH_DOCUMENT_MAX_OCR_PAGE_TEXT_CHARACTERS"
    ),
    researchDocumentOcrTimeoutMs: parsePositiveIntegerNamed(
      env.RESEARCH_DOCUMENT_OCR_TIMEOUT_MS,
      120_000,
      "RESEARCH_DOCUMENT_OCR_TIMEOUT_MS"
    ),
    researchDocumentOcrMaxBufferBytes: parsePositiveIntegerNamed(
      env.RESEARCH_DOCUMENT_OCR_MAX_BUFFER_BYTES,
      64 * 1024 * 1024,
      "RESEARCH_DOCUMENT_OCR_MAX_BUFFER_BYTES"
    ),
    researchEvidenceAi
  };
}

function parseResearchEvidenceAiConfig(env: NodeJS.ProcessEnv): ResearchEvidenceAiConfig | null {
  const apiKey = emptyToNull(env.RESEARCH_AI_API_KEY);
  const explicitBaseUrl = emptyToNull(env.RESEARCH_AI_BASE_URL);
  const explicitModel = emptyToNull(env.RESEARCH_AI_MODEL);
  if (!apiKey && !explicitBaseUrl && !explicitModel) return null;
  if (!apiKey || apiKey.length < 20 || isPlaceholder(apiKey)) {
    throw new Error("RESEARCH_AI_API_KEY must be a non-placeholder secret with at least 20 characters");
  }
  const baseUrl = new URL(explicitBaseUrl ?? "https://api.deepseek.com/");
  if (baseUrl.href !== "https://api.deepseek.com/") {
    throw new Error("RESEARCH_AI_BASE_URL must be https://api.deepseek.com/");
  }
  const model = explicitModel ?? "deepseek-flash";
  if (model !== "deepseek-flash") throw new Error("RESEARCH_AI_MODEL must be deepseek-flash");
  return {
    baseUrl: baseUrl.href.endsWith("/") ? baseUrl.href : `${baseUrl.href}/`,
    model,
    apiKey,
    timeoutMs: parsePositiveInteger(env.RESEARCH_AI_TIMEOUT_MS, 60_000)
  };
}

function defaultRepositoryRoot(): string {
  const modulePath = fileURLToPath(import.meta.url);
  return resolve(dirname(modulePath), modulePath.includes(`${sep}dist${sep}`) ? "../../../.." : "../../..");
}

function parseAbsoluteOptionalPath(value: string | undefined, name: string): string | null {
  const parsed = emptyToNull(value);
  if (parsed === null) return null;
  if (!isAbsolute(parsed) || parsed.includes("\0")) throw new Error(`${name} must be an absolute path`);
  return parsed;
}

function parseLoopbackHttpUrl(value: string | undefined, name: string): string | null {
  const parsed = emptyToNull(value);
  if (parsed === null) return null;
  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    throw new Error(`${name} must be an absolute HTTP URL`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.hash
    || !new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname)) {
    throw new Error(`${name} must be a credential-free loopback HTTP URL`);
  }
  return url.href;
}

function parseQuantEvidenceConfig(env: NodeJS.ProcessEnv): QuantEvidenceConfig | null {
  const values = {
    repositoryRoot: emptyToNull(env.QUANT_EVIDENCE_REPOSITORY_ROOT),
    decisionPath: emptyToNull(env.QUANT_RESEARCH_EVIDENCE_MANIFEST),
    decisionSha256: emptyToNull(env.QUANT_RESEARCH_EVIDENCE_MANIFEST_SHA256),
    decisionMaxAgeDays: emptyToNull(env.QUANT_RESEARCH_EVIDENCE_MAX_AGE_DAYS),
    portfolioPath: emptyToNull(env.ANNUAL_PORTFOLIO_LAB_EVIDENCE_MANIFEST),
    portfolioSha256: emptyToNull(env.ANNUAL_PORTFOLIO_LAB_EVIDENCE_MANIFEST_SHA256)
  };
  if (Object.values(values).every((value) => value === null)) return null;

  const requiredDecision = ["repositoryRoot", "decisionPath", "decisionSha256", "decisionMaxAgeDays"] as const;
  const missingDecision = requiredDecision.filter((name) => values[name] === null);
  if (missingDecision.length > 0) {
    throw new Error(`quant decision evidence configuration must be complete; missing ${missingDecision.join(", ")}`);
  }
  if ((values.portfolioPath === null) !== (values.portfolioSha256 === null)) {
    throw new Error("annual portfolio-lab evidence path and SHA-256 must be configured together");
  }

  const repositoryRoot = values.repositoryRoot as string;
  if (!isAbsolute(repositoryRoot) || repositoryRoot.includes("\0")) {
    throw new Error("QUANT_EVIDENCE_REPOSITORY_ROOT must be an absolute repository path");
  }
  const decisionPath = parseRepositoryPath(values.decisionPath as string, "QUANT_RESEARCH_EVIDENCE_MANIFEST");
  return {
    repositoryRoot,
    decision: {
      repositoryPath: decisionPath,
      expectedSha256: parseSha256(values.decisionSha256 as string, "QUANT_RESEARCH_EVIDENCE_MANIFEST_SHA256"),
      maxAgeDays: parseNonNegativeFinite(
        values.decisionMaxAgeDays as string,
        "QUANT_RESEARCH_EVIDENCE_MAX_AGE_DAYS"
      )
    },
    annualPortfolioLab: values.portfolioPath === null ? null : {
      repositoryPath: parseRepositoryPath(values.portfolioPath, "ANNUAL_PORTFOLIO_LAB_EVIDENCE_MANIFEST"),
      expectedSha256: parseSha256(values.portfolioSha256 as string, "ANNUAL_PORTFOLIO_LAB_EVIDENCE_MANIFEST_SHA256")
    }
  };
}

function parseRepositoryPath(value: string, name: string): string {
  const normalized = posix.normalize(value);
  if (isAbsolute(value) || value.includes("\0") || normalized !== value
    || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${name} must be a normalized repository-relative path`);
  }
  return value;
}

function parseSha256(value: string, name: string): string {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${name} must be an exact SHA-256 hex digest`);
  return value.toLowerCase();
}

function parseNonNegativeFinite(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return parsed;
}

function parseCsv(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean))];
}

function parseActorScopeMap(value: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of parseCsv(value)) {
    const parts = entry.split("=");
    if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9._:/-]{1,200}$/.test(part))) {
      throw new Error("PINGAN_SNAPSHOT_ACCOUNT_SCOPES must be comma-separated actor=account-scope pairs");
    }
    if (result[parts[0]] && result[parts[0]] !== parts[1]) {
      throw new Error(`PINGAN_SNAPSHOT_ACCOUNT_SCOPES contains conflicting mappings for ${parts[0]}`);
    }
    result[parts[0]] = parts[1];
  }
  return result;
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = parseInteger(value, fallback);
  if (parsed <= 0) throw new Error("PINGAN_CURRENT_MAX_AGE_SECONDS must be a positive integer");
  return parsed;
}

function parsePositiveIntegerNamed(value: string | undefined, fallback: number, name: string): number {
  const parsed = parseInteger(value, fallback);
  if (parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isPlaceholder(value: string): boolean {
  return /^(test|synthetic|placeholder|changeme|redacted|example|dummy|local)([-_a-z0-9]*)?$/i.test(value)
    || value.includes("<")
    || value.includes(">");
}

function isForbiddenStagingReadOnlyTokenSentinel(value: string): boolean {
  return value.trim().toLowerCase() === "replace-in-secret-manager-with-readonly-scoped-token";
}
