#!/usr/bin/env node
import Fastify from "fastify";
import { registerStagingReadOnlyGuard } from "../dist/apps/api/src/stagingReadOnly.js";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run") || process.env.STAGING_READONLY_LIVE !== "1";
const baseUrl = process.env.STAGING_READONLY_BASE_URL ?? "";
const symbol = process.env.STAGING_READONLY_SYMBOL ?? "HK.09926";
const identity = process.env.STAGING_READONLY_IDENTITY ?? (dryRun ? "dry-run-readonly-smoke" : "");
const requestHeaderName = process.env.STAGING_READONLY_AUTH_HEADER_NAME ?? "";
const requestToken = process.env.STAGING_READONLY_AUTH_TOKEN ?? "";
const writeTokens = [process.env.WRITE_API_TOKEN ?? "", process.env.INTERNAL_API_TOKEN ?? ""].filter(Boolean);
const authorization = process.env.STAGING_READONLY_AUTHORIZATION ?? "";
const expectedAuthorization = "授权执行 staging read-only validation";
const approvedBaseUrl = process.env.STAGING_READONLY_APPROVED_BASE_URL ?? "";
const productionBaseUrl = process.env.STAGING_READONLY_PRODUCTION_BASE_URL ?? process.env.CANDIDATE_PRODUCTION_BASE_URL ?? "";

const localGuard = await runLocalGuardProbe(identity);
const liveProbe = dryRun ? null : await runLiveProbe(localGuard);
const ok = localGuard.ok && (dryRun || liveProbe?.ok === true);

console.log(JSON.stringify({
  ok,
  checkedAt: new Date().toISOString(),
  dryRun,
  symbol,
  safety: {
    sendsWriteRequests: false,
    writesDatabase: false,
    deploysServices: false,
    switchesTraffic: false,
    enablesWriteToken: false
  },
  localGuard,
  liveProbe,
  goNoGo: ok
    ? dryRun
      ? "staging_readonly_smoke_dry_run_passed"
      : "staging_readonly_smoke_live_passed"
    : "no_go_clear_staging_readonly_smoke_blockers",
  notes: [
    "Dry-run validates the committed Fastify read-only guard with local injection.",
    "Live mode sends GET requests only: health, quote, research profile, decision context, Pingan snapshot, and decision-review history.",
    "No POST, PUT, PATCH, or DELETE request is sent by this smoke."
  ]
}, null, 2));

if (!ok) {
  process.exit(1);
}

async function runLocalGuardProbe(readOnlyIdentity) {
  if (!readOnlyIdentity || isPlaceholder(readOnlyIdentity)) {
    return {
      ok: false,
      blockers: [{
        id: "missing-explicit-readonly-identity",
        present: Boolean(readOnlyIdentity),
        valuePrinted: false
      }]
    };
  }
  const app = Fastify({ logger: false });
  registerStagingReadOnlyGuard(app, {
    enabled: true,
    identity: readOnlyIdentity
  });
  app.get("/health", async () => ({
    ok: true,
    staging: {
      readOnly: true,
      identity: readOnlyIdentity
    }
  }));
  app.post("/api/internal/research/seed-fixture", async () => ({ ok: true }));

  try {
    const health = await app.inject({ method: "GET", url: "/health" });
    const mutating = await app.inject({ method: "POST", url: "/api/internal/research/seed-fixture" });
    const body = mutating.json();
    return {
      ok: health.statusCode === 200
        && health.json().staging?.readOnly === true
        && health.json().staging?.identity === readOnlyIdentity
        && mutating.statusCode === 403
        && body.code === "STAGING_READ_ONLY_MODE",
      checks: {
        healthStatus: health.statusCode,
        mutatingStatus: mutating.statusCode,
        mutatingCode: body.code ?? null
      }
    };
  } finally {
    await app.close();
  }
}

async function runLiveProbe(localGuardResult) {
  const blockers = [];
  if (process.env.STAGING_READONLY_MODE !== "1") {
    blockers.push({
      id: "missing-readonly-mode",
      present: Boolean(process.env.STAGING_READONLY_MODE),
      expected: "1",
      valuePrinted: false
    });
  }
  if (!localGuardResult.ok) {
    blockers.push({
      id: "local-readonly-identity-gate-failed",
      valuePrinted: false
    });
  }
  if (authorization !== expectedAuthorization) {
    blockers.push({
      id: "missing-live-authorization",
      expectedAuthorization,
      provided: authorization.length > 0,
      valuePrinted: false
    });
  }
  if (!isCandidateUrl(baseUrl)) {
    blockers.push({
      id: "invalid-staging-base-url",
      present: Boolean(baseUrl),
      valuePrinted: false
    });
  }
  if (!urlsExactlyMatch(baseUrl, approvedBaseUrl)) {
    blockers.push({
      id: "staging-target-not-explicitly-approved",
      baseUrlPresent: Boolean(baseUrl),
      approvedBaseUrlPresent: Boolean(approvedBaseUrl),
      valuePrinted: false
    });
  }
  if (urlsExactlyMatch(baseUrl, productionBaseUrl)) {
    blockers.push({
      id: "staging-target-matches-production-url",
      baseUrlPresent: Boolean(baseUrl),
      productionBaseUrlPresent: Boolean(productionBaseUrl),
      valuePrinted: false
    });
  }
  if (!requestHeaderName || !requestToken) {
    blockers.push({
      id: "missing-readonly-request-auth",
      headerPresent: Boolean(requestHeaderName),
      tokenPresent: Boolean(requestToken),
      valuePrinted: false
    });
  }
  if (requestHeaderName && isPlaceholder(requestHeaderName)) {
    blockers.push({
      id: "placeholder-readonly-request-auth-header",
      headerPresent: true,
      valuePrinted: false
    });
  }
  if (requestToken && (isPlaceholder(requestToken) || isForbiddenReadOnlyTokenSentinel(requestToken))) {
    blockers.push({
      id: "placeholder-readonly-request-auth-token",
      tokenPresent: true,
      valuePrinted: false
    });
  }
  if (requestToken && writeTokens.includes(requestToken)) {
    blockers.push({
      id: "readonly-request-auth-token-not-least-privilege",
      tokenPresent: true,
      writeTokenPresent: true,
      valuePrinted: false
    });
  }
  if (blockers.length > 0) {
    return { ok: false, blockers, requests: [] };
  }

  const [market, code] = parseSymbol(symbol);
  const requests = [
    await getJson("health"),
    await getJson(`api/mobile/market/quotes/${market}/${code}`),
    await getJson(`api/mobile/research/profiles/${market}/${code}`),
    await getJson(`api/mobile/research/decision-context/${market}/${code}`),
    await getJson(`api/mobile/research/portfolio/pingan-snapshot/${market}/${code}`, true),
    await getJson(`api/mobile/research/profiles/${market}/${code}/decision-reviews`, true)
  ];
  const health = requests[0].body;
  const failedRequests = requests.filter((request) => request.status < 200 || request.status >= 300 || request.malformedJson);
  if (health?.staging?.readOnly !== true || health?.staging?.identity !== identity) {
    blockers.push({
      id: "health-readonly-identity-mismatch",
      expectedIdentityPresent: true,
      actualIdentityPresent: Boolean(health?.staging?.identity),
      valuePrinted: false
    });
  }
  for (const request of failedRequests) {
    blockers.push({
      id: "live-readonly-route-unsuccessful",
      path: request.path,
      status: request.status,
      malformedJson: request.malformedJson
    });
  }
  return {
    ok: blockers.length === 0,
    blockers,
    requests,
    healthIdentity: health?.staging ?? null
  };
}

async function getJson(path, includeReadOnlyAuth = false) {
  const headers = { accept: "application/json" };
  if (includeReadOnlyAuth) {
    headers[requestHeaderName] = requestToken;
  }
  const response = await fetch(buildCandidateUrl(path), {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(8_000)
  });
  const text = await response.text();
  let body = null;
  let malformedJson = false;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    malformedJson = true;
  }
  return {
    method: "GET",
    path,
    status: response.status,
    ok: response.ok,
    malformedJson,
    bodySummary: summarizeBody(body),
    body: path === "health" ? body : undefined
  };
}

function summarizeBody(body) {
  if (!body || typeof body !== "object") {
    return null;
  }
  return {
    ok: body.ok ?? undefined,
    schemaVersion: body.schemaVersion ?? undefined,
    status: body.status ?? undefined,
    requestedSymbol: body.requestedSymbol ?? undefined,
    message: typeof body.message === "string" ? body.message.slice(0, 120) : undefined
  };
}

function parseSymbol(value) {
  const match = value.match(/^([A-Z]+)\.([0-9A-Z]+)$/);
  if (!match) {
    throw new Error(`STAGING_READONLY_SYMBOL must be MARKET.CODE: ${value}`);
  }
  return [match[1], match[2]];
}

function isCandidateUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && value.includes("/candidate-api")
      && !value.endsWith("/api")
      && !value.includes("/api/");
  } catch {
    return false;
  }
}

function buildCandidateUrl(path) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\/+/, ""), normalizedBase);
}

function urlsExactlyMatch(left, right) {
  if (!left || !right || !isCandidateUrl(left) || !isCandidateUrl(right)) return false;
  return normalizeUrl(left) === normalizeUrl(right);
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function isPlaceholder(value) {
  return /^(test|synthetic|placeholder|changeme|redacted|example|dummy|local)([-_a-z0-9]*)?$/i.test(value)
    || value.includes("<")
    || value.includes(">");
}

function isForbiddenReadOnlyTokenSentinel(value) {
  return value.trim().toLowerCase() === "replace-in-secret-manager-with-readonly-scoped-token";
}
