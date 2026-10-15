#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rulesPath = process.env.LIMITED_MOBILE_RESEARCH_ROUTES_PATH
  ?? "deploy/fact-source/limited-mobile-research-routes.json";
const outputPath = process.env.LIMITED_MOBILE_RESEARCH_NGINX_OUTPUT
  ?? "deploy/fact-source/generated-limited-mobile-research-routes.conf";
const writeOutput = process.env.LIMITED_MOBILE_RESEARCH_WRITE_OUTPUT !== "0";

const rulesFile = isAbsolute(rulesPath) ? rulesPath : join(root, rulesPath);
const outputFile = isAbsolute(outputPath) ? outputPath : join(root, outputPath);

const payload = JSON.parse(readFileSync(rulesFile, "utf8"));
const checks = [];
const blockers = [];

assertEqual("schema version", payload.schemaVersion, "2026-06-19.limited-mobile-research-routes.v1");
assertEqual("status", payload.status, "draft");
assertEqual("mode", payload.scope?.mode, "limited_mobile_research_routes");
assertEqual("production impact", payload.scope?.productionImpact, false);
assertEqual("requires authorization", payload.scope?.requiresAuthorizationBeforeInstall, true);
assertEqual("legacy api prefix", payload.scope?.legacyApiPrefix, "/api/");

const routes = payload.routes ?? [];
const forbiddenPaths = payload.forbiddenPaths ?? [];

check("has exactly bounded route set", routes.length === 5, { count: routes.length });
check("route ids are unique", new Set(routes.map((route) => route.id)).size === routes.length);

for (const route of routes) {
  validateRoute(route);
  const sample = samplePathFor(route.legacyPathRegex);
  check(`route matches itself: ${route.id}`, matchesRoute(route, route.method, sample), { method: route.method, sample });
  check(`route does not match candidate prefix: ${route.id}`, !matchesRoute(route, route.method, sample.replace(/^\/api\//, "/candidate-api/api/")), {
    method: route.method,
    sample: sample.replace(/^\/api\//, "/candidate-api/api/")
  });
}

const expectedRoutes = new Set([
  "GET /api/mobile/research/decision-context/:market/:code",
  "GET /api/mobile/research/profiles/:market/:code",
  "PUT /api/mobile/research/profiles/:market/:code",
  "POST /api/mobile/research/profiles/:market/:code/evidence",
  "POST /api/mobile/research/profiles/:market/:code/decision-checks"
]);
check("candidate route set is exact", setEquals(new Set(routes.map((route) => route.candidateRoute)), expectedRoutes), {
  actual: routes.map((route) => route.candidateRoute).sort(),
  expected: [...expectedRoutes].sort()
});

const mustMatch = [
  ["GET", "/api/mobile/research/decision-context/HK/09926"],
  ["GET", "/api/mobile/research/profiles/HK/09926"],
  ["PUT", "/api/mobile/research/profiles/HK/09926"],
  ["POST", "/api/mobile/research/profiles/HK/09926/evidence"],
  ["POST", "/api/mobile/research/profiles/HK/09926/decision-checks"]
];
for (const [method, path] of mustMatch) {
  check(`must proxy ${method} ${path}`, routes.some((route) => matchesRoute(route, method, path)), { method, path });
}

const mustNotMatch = [
  ["GET", "/api/mobile/market/quotes/HK/09926"],
  ["POST", "/api/mobile/trades"],
  ["POST", "/api/mobile/positions"],
  ["POST", "/api/mobile/reviews"],
  ["POST", "/api/trades"],
  ["POST", "/api/positions"],
  ["POST", "/api/reviews"],
  ["POST", "/api/stock-command"],
  ["POST", "/api/trading-agent/analyze"],
  ["POST", "/candidate-api/api/mobile/research/profiles/HK/09926/evidence"]
];
for (const [method, path] of mustNotMatch) {
  check(`must not proxy ${method} ${path}`, !routes.some((route) => matchesRoute(route, method, path)), { method, path });
}

for (const forbidden of forbiddenPaths) {
  check(`forbidden path stays outside route regex: ${forbidden}`, !routes.some((route) => route.legacyPathRegex.includes(forbidden.replace(/^\//, ""))), {
    forbidden
  });
}

const nginx = renderNginxDraft(payload);
check("nginx draft has explicit draft warning", nginx.includes("DRAFT ONLY"));
check("nginx draft does not proxy whole /api", !/location\s+\/api\/\s*\{/.test(nginx));
check("nginx draft does not mention trades", !/trades/i.test(nginx));
check("nginx draft does not mention positions", !/positions/i.test(nginx));
check("nginx draft does not mention reviews", !/reviews/i.test(nginx));
check("nginx draft uses candidate upstream", nginx.includes(`proxy_pass http://${payload.scope?.candidateUpstream}`));

if (writeOutput) {
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, nginx, "utf8");
}

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  rulesPath,
  outputPath: writeOutput ? outputPath : null,
  routeCount: routes.length,
  checks,
  blockers,
  safety: {
    productionImpact: false,
    installsNginx: false,
    reloadsNginx: false,
    writesProductionFacts: false,
    enablesCandidateWriteToken: false,
    proxiesWholeApi: false
  },
  goNoGo: blockers.length === 0
    ? "limited_mobile_research_routes_draft_ready"
    : "no_go_clear_limited_mobile_research_route_blockers",
  notes: [
    "This command only validates and regenerates a draft nginx snippet.",
    "It does not deploy nginx, reload services, enable write tokens, write production facts, or switch the legacy /api proxy.",
    "Installing this draft still requires a separate authorization, fresh backup, nginx -t, post-install smoke, and rollback plan."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

function validateRoute(route) {
  check(`route id present: ${route.id ?? "missing"}`, Boolean(route.id), route);
  check(`route method valid: ${route.id}`, ["GET", "POST", "PUT"].includes(route.method), route);
  check(`route path starts with bounded mobile research route: ${route.id}`, /^\/api\/mobile\/research\/(?:profiles|decision-context)\//.test(String(route.legacyPathRegex ?? "").replace(/^\^/, "")), route);
  check(`route excludes wildcard api root: ${route.id}`, !String(route.legacyPathRegex ?? "").startsWith("^/api/.*"), route);
  check(`route excludes candidate prefix: ${route.id}`, !String(route.legacyPathRegex ?? "").includes("candidate-api"), route);
  check(`candidate route is mobile research only: ${route.id}`, /^GET \/api\/mobile\/research\/decision-context\/|^(GET|POST|PUT) \/api\/mobile\/research\/profiles\//.test(String(route.candidateRoute ?? "")), route);
  check(`reason present: ${route.id}`, Boolean(route.reason), route);
  try {
    new RegExp(route.legacyPathRegex);
    check(`route regex compiles: ${route.id}`, true, route);
  } catch (error) {
    check(`route regex compiles: ${route.id}`, false, { error: error instanceof Error ? error.message : String(error), route });
  }
}

function matchesRoute(route, method, path) {
  return String(route.method).toUpperCase() === String(method).toUpperCase()
    && new RegExp(route.legacyPathRegex).test(path);
}

function samplePathFor(pathRegex) {
  return pathRegex
    .replace(/^\^/, "")
    .replace(/\?\$$/, "")
    .replace(/\$$/, "")
    .replace(/\[\^\/\]\+/g, "HK")
    .replace("/HK/HK", "/HK/09926")
    .replace(/\\\//g, "/")
    .replace(/\?$/, "");
}

function renderNginxDraft(config) {
  const upstream = config.scope?.candidateUpstream;
  return `# Limited mobile research route takeover draft.
#
# DRAFT ONLY. Do not deploy without explicit authorization, fresh backups,
# nginx -t, post-install smoke, and rollback commands.
#
# This snippet intentionally handles only /api/mobile/research/decision-context/*
# and /api/mobile/research/profiles/*
# and must never be replaced by a blanket /api proxy.
#
# Candidate write token must remain revoked except during an explicitly
# authorized write smoke window.

location ~ ^/api/mobile/research/(?:decision-context/[^/]+/[^/]+|profiles/[^/]+/[^/]+(?:/(?:evidence|decision-checks))?)/?$ {
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Annual-Rings-Limited-Research true;
  proxy_pass http://${upstream};
}
`;
}

function setEquals(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function assertEqual(id, actual, expected) {
  check(id, actual === expected, { actual, expected });
}

function check(id, ok, evidence = undefined) {
  checks.push({ id, ok, evidence });
  if (!ok) {
    blockers.push({ id, evidence });
  }
}
