#!/usr/bin/env node

const baseUrl = process.env.STAGING_WRITE_BASE_URL ?? "";
const symbol = process.env.STAGING_WRITE_SYMBOL ?? "HK.09926";
const oldToken = process.env.STAGING_WRITE_REVOKED_TOKEN ?? "";
const authHeaderName = process.env.STAGING_WRITE_AUTH_HEADER ?? "x-internal-token";
const runId = process.env.STAGING_WRITE_REVOKE_RUN_ID ?? "";
const live = process.env.STAGING_WRITE_REVOKE_VERIFY_LIVE === "1";
const authorization = process.env.STAGING_WRITE_REVOKE_VERIFY_AUTHORIZATION ?? "";
const expectedAuthorization = "授权验证候选系统临时写入 token 已撤销";
const mockProbes = parseMockProbes(process.env.STAGING_WRITE_REVOKE_VERIFY_MOCK_PROBES ?? "");

const checks = [];
const blockers = [];
const warnings = [];
const parsedSymbol = parseSymbol(symbol);

check("staging write base URL is candidate /candidate-api", isHttpUrl(baseUrl) && baseUrl.includes("/candidate-api"), {
  present: Boolean(baseUrl),
  valuePrinted: false
});
check("staging write base URL is not legacy API root", !baseUrl.endsWith("/api") && !baseUrl.includes("/api/") && baseUrl.includes("/candidate-api"), {
  present: Boolean(baseUrl),
  valuePrinted: false
});
check("revoked token provided for negative check", oldToken.length > 0, {
  present: oldToken.length > 0,
  valuePrinted: false
});
check("revoke run id is explicit", /^prod-candidate-write-revoke-[0-9]{8,}/.test(runId), {
  present: runId.length > 0,
  valuePrinted: false,
  expectedPrefix: "prod-candidate-write-revoke-"
});
check("symbol is valid market.code", Boolean(parsedSymbol), { symbol });

if (!live) {
  warnings.push({
    id: "dry-run-only",
    reason: "STAGING_WRITE_REVOKE_VERIFY_LIVE is not set; no HTTP requests were sent"
  });
}

if (live) {
  check("explicit revoke verify authorization", authorization === expectedAuthorization, {
    expectedAuthorization,
    provided: authorization.length > 0,
    valuePrinted: false
  });
}

let unauthorized = null;
let revokedToken = null;
if (live && blockers.length === 0 && parsedSymbol) {
  const path = `/api/mobile/research/profiles/${parsedSymbol.market}/${parsedSymbol.code}`;
  unauthorized = await requestJson("PUT", path, probeBody(`${runId}-without-token`), { expectedStatus: 401 });
  revokedToken = await requestJson("PUT", path, probeBody(`${runId}-revoked-token`), {
    expectedStatus: 401,
    token: oldToken
  });
  check("candidate write without token is rejected", unauthorized.status === 401, summarizeProbe(unauthorized));
  check("candidate write with revoked token is rejected", revokedToken.status === 401, summarizeProbe(revokedToken));
}

const result = {
  ok: blockers.length === 0 && (!live || (unauthorized?.status === 401 && revokedToken?.status === 401)),
  checkedAt: new Date().toISOString(),
  mode: {
    live,
    dryRun: !live,
    sendsOnlyRejectedWriteProbes: live,
    writesDatabase: false,
    deploysNginx: false,
    freezesLegacyApi: false,
    switchesFactSource: false
  },
  baseUrl,
  symbol,
  runId,
  auth: {
    headerName: authHeaderName,
    revokedTokenProvided: oldToken.length > 0,
    tokenPrinted: false
  },
  probes: {
    withoutToken: summarizeProbe(unauthorized),
    revokedToken: summarizeProbe(revokedToken)
  },
  checks,
  blockers,
  warnings,
  goNoGo: buildGoNoGo(),
  notes: [
    "Default mode is dry-run and sends no HTTP requests.",
    "Live mode sends only negative write probes that must return 401.",
    "The revoked token value is never printed.",
    "This command must never be pointed at the legacy production /api root.",
    "It does not refresh quotes, deploy nginx, reload services, freeze legacy endpoints, write production facts, or switch fact source."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

async function requestJson(method, requestPath, body, options = {}) {
  if (mockProbes) {
    const probe = mockProbes.shift();
    return {
      reachable: true,
      status: probe?.status ?? null,
      expectedStatus: options.expectedStatus,
      data: probe?.data ?? null,
      bodyPreview: null,
      error: probe?.status === options.expectedStatus
        ? null
        : `${method} ${requestPath} returned ${probe?.status ?? "null"}, expected ${options.expectedStatus}`
    };
  }

  try {
    const response = await fetch(buildUrl(requestPath), {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(options.token ? { [authHeaderName]: options.token } : {})
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000)
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return {
      reachable: true,
      status: response.status,
      expectedStatus: options.expectedStatus,
      data,
      bodyPreview: data ? null : text.slice(0, 200),
      error: response.status === options.expectedStatus
        ? null
        : `${method} ${requestPath} returned ${response.status}, expected ${options.expectedStatus}`
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      expectedStatus: options.expectedStatus,
      data: null,
      bodyPreview: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function probeBody(idempotencyKey) {
  return {
    currentView: "revoke verify probe must be rejected",
    currentThesis: "revoke verify probe must be rejected",
    marketDisagreement: "revoke verify probe must be rejected",
    invalidationCondition: "revoke verify probe must be rejected",
    nextReviewOn: "2026-07-18",
    idempotencyKey
  };
}

function summarizeProbe(probe) {
  if (!probe) return null;
  return {
    reachable: probe.reachable,
    status: probe.status,
    expectedStatus: probe.expectedStatus,
    error: probe.error,
    bodyPreview: probe.bodyPreview
  };
}

function check(id, ok, evidence = undefined) {
  checks.push({ id, ok, evidence });
  if (!ok) {
    blockers.push({ id, evidence });
  }
}

function buildGoNoGo() {
  if (blockers.length > 0) return "no_go_clear_staging_write_token_revoke_blockers";
  if (!live) return "dry_run_ready_revoke_verify_not_executed";
  return unauthorized?.status === 401 && revokedToken?.status === 401
    ? "staging_write_token_revoke_verified"
    : "no_go_revoked_token_still_allows_write";
}

function parseSymbol(value) {
  const parts = String(value).trim().toUpperCase().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { market: parts[0], code: parts[1] };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function buildUrl(path) {
  return new URL(path.replace(/^\/+/, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

function parseMockProbes(value) {
  if (!value) return null;
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("STAGING_WRITE_REVOKE_VERIFY_MOCK_PROBES must be a JSON array");
  }
  return parsed.map((item) => ({
    status: Number(item.status),
    data: item.data ?? null
  }));
}
