import { evaluateCandidateQuoteGate } from "./lib/candidate-quote-gate.mjs";

const baseUrl = process.env.CANDIDATE_PRODUCTION_BASE_URL ?? "https://127.0.0.1:18443/candidate-api";
const symbol = process.env.CANDIDATE_PRODUCTION_SYMBOL ?? "HK.09926";
const tlsInsecure = process.env.CANDIDATE_PRODUCTION_TLS_INSECURE === "1";
const apply = process.env.CANDIDATE_QUOTE_RECOVERY_APPLY === "1";
const authorization = process.env.CANDIDATE_QUOTE_RECOVERY_AUTHORIZATION ?? "";
const expectedAuthorization = "授权刷新候选系统 production 行情缓存";
const authHeaderName = process.env.CANDIDATE_PRODUCTION_AUTH_HEADER ?? "x-internal-token";
const authTokenEnv = process.env.CANDIDATE_PRODUCTION_AUTH_TOKEN_ENV ?? "CANDIDATE_PRODUCTION_AUTH_TOKEN";
const authToken = process.env[authTokenEnv] ?? "";
const mockProbes = parseMockProbes(process.env.CANDIDATE_QUOTE_RECOVERY_MOCK_PROBES ?? "");

if (tlsInsecure) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const checks = [];
const blockers = [];
const warnings = [];
const parsedSymbol = parseSymbol(symbol);

check("candidate base url includes /candidate-api", baseUrl.includes("/candidate-api"), {
  present: Boolean(baseUrl),
  valuePrinted: false
});
check("symbol is valid market.code", Boolean(parsedSymbol), { symbol });

const health = await probeJson("GET", "/health");
const before = parsedSymbol ? await probeJson("GET", quotePath(parsedSymbol)) : null;

check("candidate health reachable", health.reachable && health.status === 200 && health.data?.ok === true, summarizeProbe(health));
check("candidate market provider is futu", health.data?.marketProvider === "futu", summarizeProbe(health));
check("candidate quote readable", before?.reachable === true && before.status === 200, summarizeProbe(before));

if (!apply) {
  warnings.push({
    id: "dry-run-only",
    reason: "CANDIDATE_QUOTE_RECOVERY_APPLY is not set; no refresh POST was sent"
  });
}

if (apply) {
  validateApplyGuards();
}

let refresh = null;
let after = null;
if (apply && blockers.length === 0 && parsedSymbol) {
  refresh = await probeJson("POST", refreshPath(parsedSymbol));
  after = await probeJson("GET", quotePath(parsedSymbol));
  check("candidate quote refresh request succeeded", refresh.reachable && refresh.status === 200, summarizeProbe(refresh));
  check("candidate quote acceptable after refresh", isAcceptableQuoteProbe(after), summarizeQuoteGate(after));
}

const beforeGate = summarizeQuoteGate(before);
const afterGate = summarizeQuoteGate(after);
const result = {
  ok: blockers.length === 0 && (!apply || Boolean(afterGate?.ok)),
  checkedAt: new Date().toISOString(),
  mode: {
    apply,
    dryRun: !apply,
    tlsInsecure
  },
  baseUrl,
  symbol,
  auth: {
    headerName: authHeaderName,
    tokenProvided: authToken.length > 0,
    tokenEnv: authTokenEnv,
    tokenPrinted: false
  },
  before: summarizeQuote(before),
  refresh: summarizeQuote(refresh),
  after: summarizeQuote(after),
  quoteGate: {
    before: beforeGate,
    after: afterGate
  },
  checks,
  blockers,
  warnings,
  goNoGo: buildGoNoGo(afterGate),
  notes: [
    "Default mode is dry-run and sends no refresh POST.",
    "Apply mode writes only candidate market quote cache through /api/internal/market/refresh/:market/:code.",
    "It accepts stale quotes only when CANDIDATE_MARKET_CLOSED=1, the provider is Futu, and source.fetchedAt is recent; the API response remains stale and is not relabeled as live.",
    "This command does not deploy nginx, reload services, freeze legacy endpoints, write legacy data, write trades, write true positions, write reviews, or switch fact source.",
    "Token values are never printed."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

function validateApplyGuards() {
  check("explicit quote recovery authorization", authorization === expectedAuthorization, {
    expectedAuthorization,
    provided: authorization.length > 0,
    valuePrinted: false
  });
  check("candidate base url includes /candidate-api for apply", baseUrl.includes("/candidate-api"), {
    present: Boolean(baseUrl),
    valuePrinted: false
  });
}

async function probeJson(method, requestPath) {
  if (mockProbes) {
    const probe = mockProbes.shift();
    return {
      reachable: probe?.reachable ?? true,
      status: probe?.status ?? null,
      data: probe?.data ?? null,
      bodyPreview: probe?.bodyPreview ?? null,
      error: probe?.error ?? null
    };
  }

  try {
    const response = await fetch(buildUrl(baseUrl, requestPath), {
      method,
      headers: {
        accept: "application/json",
        ...(method === "GET" ? {} : { "content-type": "application/json" }),
        ...(authToken ? { [authHeaderName]: authToken } : {})
      },
      body: method === "GET" ? undefined : "{}",
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
      data,
      bodyPreview: data ? null : text.slice(0, 200),
      error: response.ok ? null : `${method} ${requestPath} returned ${response.status}`
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      data: null,
      bodyPreview: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function check(id, ok, evidence = undefined) {
  checks.push({ id, ok, evidence });
  if (!ok) {
    blockers.push({ id, evidence });
  }
}

function summarizeProbe(probe) {
  if (!probe) return null;
  return {
    reachable: probe.reachable,
    status: probe.status,
    error: probe.error,
    bodyPreview: probe.bodyPreview
  };
}

function summarizeQuote(probe) {
  if (!probe) return null;
  return {
    reachable: probe.reachable,
    httpStatus: probe.status,
    status: probe.data?.status ?? null,
    asOf: probe.data?.asOf ?? null,
    provider: probe.data?.source?.provider ?? null,
    providerStatus: probe.data?.source?.providerStatus ?? null,
    fetchedAt: probe.data?.source?.fetchedAt ?? null,
    price: probe.data?.data?.price ?? null,
    quoteTime: probe.data?.data?.quoteTime ?? null,
    error: probe.error
  };
}

function summarizeQuoteGate(probe) {
  if (!probe?.data) return null;
  return evaluateCandidateQuoteGate(probe.data);
}

function isAcceptableQuoteProbe(probe) {
  return probe?.reachable === true && probe.status === 200 && evaluateCandidateQuoteGate(probe.data).ok;
}

function buildGoNoGo(afterGate) {
  if (blockers.length > 0) return "no_go_clear_quote_recovery_blockers";
  if (!apply) {
    const beforeEvaluation = evaluateCandidateQuoteGate(before?.data);
    if (beforeEvaluation.ok && beforeEvaluation.mode === "live") {
      return "quote_already_live_no_refresh_needed";
    }
    return beforeEvaluation.ok && beforeEvaluation.mode === "market_closed_stale"
      ? "quote_recent_market_closed_stale_no_refresh_needed"
      : "dry_run_ready_refresh_not_executed";
  }
  return afterGate?.ok
    ? afterGate.mode === "live"
      ? "candidate_quote_recovery_succeeded"
      : "candidate_quote_recovery_succeeded_market_closed_stale"
    : "no_go_candidate_quote_not_acceptable";
}

function parseSymbol(value) {
  const parts = String(value).trim().toUpperCase().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { market: parts[0], code: parts[1], symbol: `${parts[0]}.${parts[1]}` };
}

function quotePath(item) {
  return `/api/mobile/market/quotes/${item.market}/${item.code}`;
}

function refreshPath(item) {
  return `/api/internal/market/refresh/${item.market}/${item.code}`;
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function buildUrl(base, requestPath) {
  return new URL(requestPath.replace(/^\/+/, ""), ensureTrailingSlash(base));
}

function parseMockProbes(value) {
  if (!value) return null;
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("CANDIDATE_QUOTE_RECOVERY_MOCK_PROBES must be a JSON array");
  }
  return parsed;
}
