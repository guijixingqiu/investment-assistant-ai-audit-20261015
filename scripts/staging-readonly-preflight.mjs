#!/usr/bin/env node

const baseUrl = process.env.STAGING_READONLY_BASE_URL ?? "";
const configuredIdentity = process.env.STAGING_READONLY_IDENTITY ?? "";
const identity = configuredIdentity || (process.env.STAGING_READONLY_LIVE === "1" ? "" : "dry-run-readonly-preflight");
const requestHeaderName = process.env.STAGING_READONLY_AUTH_HEADER_NAME ?? "";
const requestToken = process.env.STAGING_READONLY_AUTH_TOKEN ?? "";
const writeTokens = [process.env.WRITE_API_TOKEN ?? "", process.env.INTERNAL_API_TOKEN ?? ""].filter(Boolean);
const authorization = process.env.STAGING_READONLY_AUTHORIZATION ?? "";
const expectedAuthorization = "授权执行 staging read-only validation";
const live = process.env.STAGING_READONLY_LIVE === "1";
const symbol = process.env.STAGING_READONLY_SYMBOL ?? "HK.09926";
const approvedBaseUrl = process.env.STAGING_READONLY_APPROVED_BASE_URL ?? "";
const productionBaseUrl = process.env.STAGING_READONLY_PRODUCTION_BASE_URL ?? process.env.CANDIDATE_PRODUCTION_BASE_URL ?? "";

const checks = [];
const blockers = [];
const warnings = [];

check("read-only mode flag is explicit", !live || process.env.STAGING_READONLY_MODE === "1", {
  present: Boolean(process.env.STAGING_READONLY_MODE),
  expected: live ? "1" : "required for live"
});
check("staging identity is explicit", identity.length > 0 && !isPlaceholder(identity), {
  present: identity.length > 0,
  valuePrinted: false
});
check("read-only request auth header is configured when live", !live || (requestHeaderName.length > 0 && requestToken.length > 0), {
  live,
  headerPresent: requestHeaderName.length > 0,
  tokenPresent: requestToken.length > 0,
  valuePrinted: false
});
check("read-only request auth is least-privilege and distinct", (!live && (requestToken.length === 0 || !writeTokens.includes(requestToken))) || (
  requestHeaderName.length > 0
    && requestToken.length > 0
    && !isPlaceholder(requestHeaderName)
    && !isPlaceholder(requestToken)
    && !writeTokens.includes(requestToken)
), {
  live,
  headerPresent: requestHeaderName.length > 0,
  tokenPresent: requestToken.length > 0,
  writeTokenPresent: writeTokens.length > 0,
  valuePrinted: false
});
check("documented read-only token sentinel is replaced", requestToken.length === 0 || !isForbiddenReadOnlyTokenSentinel(requestToken), {
  tokenPresent: requestToken.length > 0,
  valuePrinted: false
});
check("staging base URL is configured for candidate API when live", !live || isCandidateApiUrl(baseUrl), {
  present: Boolean(baseUrl),
  valuePrinted: false,
  live
});
check("staging base URL is not legacy API root", !baseUrl || isCandidateApiUrl(baseUrl), {
  present: Boolean(baseUrl),
  valuePrinted: false
});
check("live staging target is explicitly approved", !live || urlsExactlyMatch(baseUrl, approvedBaseUrl), {
  live,
  baseUrlPresent: baseUrl.length > 0,
  approvedBaseUrlPresent: approvedBaseUrl.length > 0,
  valuePrinted: false
});
check("live staging target is distinguishable from production", !live || !urlsExactlyMatch(baseUrl, productionBaseUrl), {
  live,
  baseUrlPresent: baseUrl.length > 0,
  productionBaseUrlPresent: productionBaseUrl.length > 0,
  valuePrinted: false
});
check("symbol is MARKET.CODE", /^[A-Z]+\.[0-9A-Z]+$/.test(symbol), { symbol });
check("read-only live authorization is explicit when live", !live || authorization === expectedAuthorization, {
  live,
  expectedAuthorization,
  provided: authorization.length > 0,
  valuePrinted: false
});

if (!live) {
  warnings.push({
    id: "dry-run-only",
    reason: "STAGING_READONLY_LIVE is not set; no HTTP requests were sent"
  });
}

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  live,
  mode: {
    readOnly: true,
    sendsHttpRequests: live,
    sendsWriteRequests: false,
    writesDatabase: false,
    deploysServices: false,
    switchesTraffic: false
  },
  environment: {
    STAGING_READONLY_MODE: presence("STAGING_READONLY_MODE"),
    STAGING_READONLY_IDENTITY: {
      present: configuredIdentity.length > 0,
      valuePrinted: false
    },
    STAGING_READONLY_AUTH_HEADER_NAME: {
      present: requestHeaderName.length > 0,
      valuePrinted: false
    },
    STAGING_READONLY_AUTH_TOKEN: {
      present: requestToken.length > 0,
      valuePrinted: false
    },
    STAGING_READONLY_BASE_URL: {
      present: baseUrl.length > 0,
      valuePrinted: false
    },
    STAGING_READONLY_APPROVED_BASE_URL: {
      present: approvedBaseUrl.length > 0,
      valuePrinted: false
    },
    STAGING_READONLY_PRODUCTION_BASE_URL: {
      present: productionBaseUrl.length > 0,
      valuePrinted: false
    },
    STAGING_READONLY_LIVE: presence("STAGING_READONLY_LIVE"),
    STAGING_READONLY_AUTHORIZATION: {
      present: authorization.length > 0,
      valuePrinted: false
    },
    STAGING_READONLY_SYMBOL: {
      present: Boolean(process.env.STAGING_READONLY_SYMBOL),
      valuePrinted: true,
      value: symbol
    }
  },
  checks,
  blockers,
  warnings,
  goNoGo: blockers.length === 0
    ? "staging_readonly_preflight_ready"
    : "no_go_clear_staging_readonly_preflight_blockers",
  notes: [
    "Default mode is dry-run and sends no HTTP requests.",
    "Dry-run uses a synthetic non-staging identity only when STAGING_READONLY_IDENTITY is unset.",
    "Live mode permits GET-only validation through the smoke command.",
    "This command never prints credentials or database URLs.",
    "This command does not deploy, reload services, switch traffic, or enable write tokens."
  ]
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) {
  process.exit(1);
}

function check(id, ok, evidence = {}) {
  const item = { id, ok, evidence };
  checks.push(item);
  if (!ok) {
    blockers.push({ id, evidence });
  }
}

function presence(name) {
  return {
    present: Boolean(process.env[name]),
    valuePrinted: false
  };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isCandidateApiUrl(value) {
  if (!isHttpUrl(value)) return false;
  const url = new URL(value);
  return url.pathname.includes("/candidate-api")
    && !url.pathname.endsWith("/api")
    && !url.pathname.includes("/api/");
}

function urlsExactlyMatch(left, right) {
  if (!left || !right || !isHttpUrl(left) || !isHttpUrl(right)) return false;
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
  return /^(test|synthetic|placeholder|changeme|redacted|example|dummy)[-_a-z0-9]*$/i.test(value)
    || value.includes("<")
    || value.includes(">");
}

function isForbiddenReadOnlyTokenSentinel(value) {
  return value.trim().toLowerCase() === "replace-in-secret-manager-with-readonly-scoped-token";
}
