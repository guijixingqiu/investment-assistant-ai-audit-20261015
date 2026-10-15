#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rulesPath = process.env.LIMITED_MOBILE_RESEARCH_ROUTES_PATH
  ?? "deploy/fact-source/limited-mobile-research-routes.json";
const rules = JSON.parse(readFileSync(join(root, rulesPath), "utf8"));
const live = process.env.LIMITED_MOBILE_RESEARCH_POST_INSTALL_LIVE === "1";
const authorization = process.env.LIMITED_MOBILE_RESEARCH_POST_INSTALL_AUTHORIZATION ?? "";
const expectedAuthorization = "授权执行受限 mobile research 路由安装后 smoke";
const legacyBaseUrl = process.env.LIMITED_MOBILE_RESEARCH_LEGACY_BASE_URL ?? "";
const candidateBaseUrl = process.env.LIMITED_MOBILE_RESEARCH_CANDIDATE_BASE_URL ?? "";
const symbol = process.env.LIMITED_MOBILE_RESEARCH_SYMBOL ?? "HK.09926";
const mockProbes = parseMockProbes(process.env.LIMITED_MOBILE_RESEARCH_POST_INSTALL_MOCK_PROBES ?? "");

const checks = [];
const blockers = [];
const warnings = [];
const parsedSymbol = parseSymbol(symbol);

check("route rules schema version", rules.schemaVersion === "2026-06-19.limited-mobile-research-routes.v1", rulesPath);
check("route rules remain draft", rules.status === "draft", rulesPath);
check("route rules have no production impact flag", rules.scope?.productionImpact === false, rulesPath);
check("route count is exactly five", (rules.routes ?? []).length === 5, { count: (rules.routes ?? []).length });
check("symbol is valid market.code", Boolean(parsedSymbol), { symbol });

const dryRunPlan = buildDryRunPlan(parsedSymbol);
check("dry-run plan has allowed research probes", dryRunPlan.allowedResearch.length >= 2, { count: dryRunPlan.allowedResearch.length });
check("dry-run plan has negative forbidden probes", dryRunPlan.forbiddenLegacy.length >= 5, { count: dryRunPlan.forbiddenLegacy.length });
check("dry-run plan uses no token values", dryRunPlan.tokenPrinted === false, dryRunPlan);
check("dry-run plan redacts request bodies", dryRunPlan.requestBodiesPrinted === false, dryRunPlan);

if (!live) {
  warnings.push({
    id: "dry-run-only",
    reason: "LIMITED_MOBILE_RESEARCH_POST_INSTALL_LIVE is not set; no HTTP requests were sent"
  });
}

if (live) {
  check("explicit post-install smoke authorization", authorization === expectedAuthorization, {
    expectedAuthorization,
    provided: authorization.length > 0,
    valuePrinted: false
  });
  check("legacy base URL present", isHttpUrl(legacyBaseUrl), {
    present: legacyBaseUrl.length > 0,
    valuePrinted: false
  });
  check("legacy base URL excludes /candidate-api", isHttpUrl(legacyBaseUrl) && !legacyBaseUrl.includes("/candidate-api"), {
    present: legacyBaseUrl.length > 0,
    valuePrinted: false
  });
  check("candidate base URL present", isHttpUrl(candidateBaseUrl), {
    present: candidateBaseUrl.length > 0,
    valuePrinted: false
  });
  check("candidate base URL includes /candidate-api", isHttpUrl(candidateBaseUrl) && candidateBaseUrl.includes("/candidate-api"), {
    present: candidateBaseUrl.length > 0,
    valuePrinted: false
  });
}

let liveResult = null;
if (live && blockers.length === 0 && parsedSymbol) {
  liveResult = await runLiveSmoke(parsedSymbol);
  check("allowed decision context read is reachable via legacy path", liveResult.allowedDecisionContextRead?.status === 200, liveResult.allowedDecisionContextRead);
  check("allowed decision context read carries limited route marker", liveResult.allowedDecisionContextRead?.candidateHeader === "true", liveResult.allowedDecisionContextRead);
  check("allowed research read is reachable via legacy path", liveResult.allowedResearchRead?.status === 200, liveResult.allowedResearchRead);
  check("allowed research read carries limited route marker", liveResult.allowedResearchRead?.candidateHeader === "true", liveResult.allowedResearchRead);
  check("allowed research write without token is rejected", liveResult.allowedResearchWriteWithoutToken?.status === 401, liveResult.allowedResearchWriteWithoutToken);
  check("candidate health remains reachable", liveResult.candidateHealth?.status === 200, liveResult.candidateHealth);
  check("legacy forbidden trade route is not proxied to candidate success", !isCandidateSuccess(liveResult.forbiddenTrade), liveResult.forbiddenTrade);
  check("legacy forbidden position route is not proxied to candidate success", !isCandidateSuccess(liveResult.forbiddenPosition), liveResult.forbiddenPosition);
  check("legacy forbidden review route is not proxied to candidate success", !isCandidateSuccess(liveResult.forbiddenReview), liveResult.forbiddenReview);
}

const result = {
  ok: blockers.length === 0 && (!live || liveResult?.ok === true),
  checkedAt: new Date().toISOString(),
  mode: {
    live,
    dryRun: !live,
    sendsHttpRequests: live,
    sendsSuccessfulWrite: false,
    sendsRejectedWriteProbe: live,
    deploysNginx: false,
    reloadsServices: false,
    writesProductionFacts: false,
    enablesCandidateWriteToken: false,
    switchesLegacyApiProxy: false
  },
  urls: {
    legacyBaseUrl,
    candidateBaseUrl
  },
  symbol,
  dryRunPlan,
  liveResult,
  checks,
  blockers,
  warnings,
  goNoGo: buildGoNoGo(liveResult),
  notes: [
    "Default mode is dry-run and sends no HTTP requests.",
    "Live mode must run only after an authorized nginx route install and nginx -t/reload evidence.",
    "Live mode sends one rejected write probe without a token; it must return 401.",
    "This command does not install nginx, reload services, enable write tokens, or write production facts."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

async function runLiveSmoke({ market, code }) {
  const allowedDecisionContextRead = await probe(legacyBaseUrl, "GET", `/api/mobile/research/decision-context/${market}/${code}`);
  const allowedResearchRead = await probe(legacyBaseUrl, "GET", `/api/mobile/research/profiles/${market}/${code}`);
  const allowedResearchWriteWithoutToken = await probe(legacyBaseUrl, "PUT", `/api/mobile/research/profiles/${market}/${code}`, {
    currentView: "post install smoke must be rejected without token",
    currentThesis: "post install smoke must be rejected without token",
    marketDisagreement: "post install smoke must be rejected without token",
    invalidationCondition: "post install smoke must be rejected without token",
    nextReviewOn: "2026-07-18",
    idempotencyKey: `limited-route-post-install-${Date.now()}`
  });
  const candidateHealth = await probe(candidateBaseUrl, "GET", "/health");
  const forbiddenTrade = await probe(legacyBaseUrl, "POST", "/api/mobile/trades", {});
  const forbiddenPosition = await probe(legacyBaseUrl, "POST", "/api/mobile/positions", {});
  const forbiddenReview = await probe(legacyBaseUrl, "POST", "/api/mobile/reviews", {});

  return {
    ok: allowedDecisionContextRead.status === 200
      && allowedResearchRead.status === 200
      && allowedResearchWriteWithoutToken.status === 401
      && candidateHealth.status === 200
      && !isCandidateSuccess(forbiddenTrade)
      && !isCandidateSuccess(forbiddenPosition)
      && !isCandidateSuccess(forbiddenReview),
    allowedDecisionContextRead,
    allowedResearchRead,
    allowedResearchWriteWithoutToken,
    candidateHealth,
    forbiddenTrade,
    forbiddenPosition,
    forbiddenReview,
    requestBodiesPrinted: false,
    tokenPrinted: false
  };
}

async function probe(baseUrl, method, path, body = undefined) {
  if (mockProbes) {
    const probe = mockProbes.shift();
    return {
      reachable: true,
      status: probe?.status ?? null,
      bodyPreview: probe?.bodyPreview ?? "",
      candidateHeader: probe?.candidateHeader ?? null,
      error: null
    };
  }

  try {
    const response = await fetch(joinUrl(baseUrl, path), {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8_000)
    });
    const text = await response.text();
    return {
      reachable: true,
      status: response.status,
      bodyPreview: sanitize(text),
      candidateHeader: response.headers.get("x-annual-rings-limited-research"),
      error: null
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      bodyPreview: "",
      candidateHeader: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildDryRunPlan(parsed) {
  const market = parsed?.market ?? "HK";
  const code = parsed?.code ?? "09926";
  return {
    allowedResearch: [
      {
        method: "GET",
        path: `/api/mobile/research/decision-context/${market}/${code}`,
        expectedStatus: 200
      },
      {
        method: "GET",
        path: `/api/mobile/research/profiles/${market}/${code}`,
        expectedStatus: 200
      },
      {
        method: "PUT",
        path: `/api/mobile/research/profiles/${market}/${code}`,
        expectedStatus: 401,
        bodyPolicy: "synthetic rejected write probe without token"
      }
    ],
    candidateUnaffected: [
      {
        method: "GET",
        path: "/candidate-api/health",
        expectedStatus: 200
      }
    ],
    forbiddenLegacy: [
      { method: "POST", path: "/api/mobile/trades", mustNotReturnCandidateSuccess: true },
      { method: "POST", path: "/api/mobile/positions", mustNotReturnCandidateSuccess: true },
      { method: "POST", path: "/api/mobile/reviews", mustNotReturnCandidateSuccess: true },
      { method: "POST", path: "/api/trades", mustNotReturnCandidateSuccess: true },
      { method: "POST", path: "/api/positions", mustNotReturnCandidateSuccess: true },
      { method: "POST", path: "/api/reviews", mustNotReturnCandidateSuccess: true }
    ],
    requestBodiesPrinted: false,
    tokenPrinted: false
  };
}

function isCandidateSuccess(probe) {
  if (!probe) return false;
  return probe.status !== null
    && probe.status >= 200
    && probe.status < 300
    && probe.candidateHeader === "true";
}

function check(id, ok, evidence = undefined) {
  checks.push({ id, ok, evidence });
  if (!ok) {
    blockers.push({ id, evidence });
  }
}

function buildGoNoGo(liveResult) {
  if (blockers.length > 0) return "no_go_clear_limited_mobile_research_post_install_blockers";
  if (!live) return "dry_run_ready_limited_mobile_research_post_install_smoke_not_executed";
  return liveResult?.ok
    ? "limited_mobile_research_post_install_smoke_passed"
    : "no_go_review_limited_mobile_research_route_install";
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

function joinUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}

function sanitize(text) {
  return String(text ?? "")
    .replace(/"token"\s*:\s*"[^"]+"/gi, '"token":"<redacted>"')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <redacted>")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

function parseMockProbes(value) {
  if (!value) return null;
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("LIMITED_MOBILE_RESEARCH_POST_INSTALL_MOCK_PROBES must be a JSON array");
  }
  return parsed.map((item) => ({
    status: Number(item.status),
    bodyPreview: item.bodyPreview ? String(item.bodyPreview) : "",
    candidateHeader: item.candidateHeader ? String(item.candidateHeader) : null
  }));
}
