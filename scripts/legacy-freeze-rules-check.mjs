#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rulesPath = process.env.LEGACY_FREEZE_RULES_PATH ?? "deploy/legacy-freeze/legacy-api-freeze-rules.json";
const outputPath = process.env.LEGACY_FREEZE_NGINX_OUTPUT ?? "deploy/legacy-freeze/generated-legacy-api-freeze-map.conf";
const writeOutput = process.env.LEGACY_FREEZE_WRITE_OUTPUT !== "0";

const payload = JSON.parse(readFileSync(join(root, rulesPath), "utf8"));
const blockers = [];
const checks = [];

assertEqual("schema version", payload.schemaVersion, "2026-06-18.legacy-freeze.v1");
assertEqual("status", payload.status, "draft");
assertEqual("production impact", payload.scope?.productionImpact, false);
assertEqual("legacy prefix", payload.scope?.legacyApiPrefix, "/api/");
assertEqual("candidate prefix", payload.scope?.candidateApiPrefix, "/candidate-api/");

const rules = payload.freezeRules ?? [];
const allowedExamples = payload.allowedExamples ?? [];

check("has freeze rules", rules.length >= 25, { count: rules.length });
check("has allowed examples", allowedExamples.length >= 5, { count: allowedExamples.length });
check("rule ids are unique", new Set(rules.map((rule) => rule.id)).size === rules.length);

for (const rule of rules) {
  validateRule(rule);
  const example = samplePathFor(rule.pathRegex);
  check(`rule matches itself: ${rule.id}`, matchesRule(rule, rule.method, example), { method: rule.method, path: example });
  check(`rule does not match GET: ${rule.id}`, !matchesRule(rule, "GET", example), { method: "GET", path: example });
  check(`rule does not match candidate prefix: ${rule.id}`, !matchesAny(rule.method, example.replace(/^\/api\//, "/candidate-api/api/")), {
    method: rule.method,
    path: example.replace(/^\/api\//, "/candidate-api/api/")
  });
}

const mustFreezeExamples = [
  ["POST", "/api/research-events"],
  ["PATCH", "/api/research-events/123"],
  ["POST", "/api/research-goals"],
  ["POST", "/api/research-goals/4/evidence"],
  ["PUT", "/api/investment-cards/by-stock/66"],
  ["POST", "/api/decision-checks"],
  ["PATCH", "/api/decision-checks/3/decision"],
  ["POST", "/api/messages/9/research-event"],
  ["POST", "/api/action-items/8/decision-check"],
  ["POST", "/api/trading-agent/reports/7/adopt-decision-candidate"],
  ["POST", "/api/stock-command"],
  ["POST", "/api/reviews"],
  ["POST", "/api/trades"],
  ["POST", "/api/positions"],
  ["PATCH", "/api/positions/3"],
  ["POST", "/api/broker/imports"],
  ["POST", "/api/broker/sync-positions"],
  ["POST", "/api/sources/2/import"],
  ["POST", "/api/trading-agent/analyze"]
];

for (const [method, path] of mustFreezeExamples) {
  check(`must freeze ${method} ${path}`, matchesAny(method, path), { method, path });
}

for (const example of allowedExamples) {
  check(`allowed example stays open: ${example.method} ${example.path}`, !matchesAny(example.method, example.path), example);
}

const nginx = renderNginxMap(rules);
check("generated nginx protects legacy /api only", nginx.includes("~^POST\\s+/api/research-events/?$ 1;"));
check("generated nginx includes candidate safety note", nginx.includes("must not match /candidate-api/"));
check("generated nginx returns freeze variable only", nginx.includes("$annual_rings_legacy_freeze_block"));

if (writeOutput) {
  mkdirSync(dirname(join(root, outputPath)), { recursive: true });
  writeFileSync(join(root, outputPath), nginx, "utf8");
}

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  rulesPath,
  outputPath: writeOutput ? outputPath : null,
  ruleCount: rules.length,
  allowedExampleCount: allowedExamples.length,
  checks,
  blockers,
  notes: [
    "This command is local and read-only except for regenerating the draft nginx map file.",
    "It does not deploy nginx, reload services, freeze legacy endpoints, or write production databases.",
    "The generated map must not be installed without explicit freeze-window authorization and nginx backup."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

function validateRule(rule) {
  check(`rule id present: ${rule.id ?? "missing"}`, Boolean(rule.id), rule);
  check(`rule method valid: ${rule.id}`, ["POST", "PUT", "PATCH", "DELETE"].includes(rule.method), rule);
  check(`rule path targets legacy api: ${rule.id}`, String(rule.pathRegex ?? "").startsWith("^/api/"), rule);
  check(`rule excludes candidate prefix: ${rule.id}`, !String(rule.pathRegex ?? "").includes("candidate-api"), rule);
  check(`rule source present: ${rule.id}`, Boolean(rule.source), rule);
  check(`rule reason present: ${rule.id}`, Boolean(rule.reason), rule);
  try {
    new RegExp(rule.pathRegex);
    check(`rule regex compiles: ${rule.id}`, true, rule);
  } catch (error) {
    check(`rule regex compiles: ${rule.id}`, false, { error: error instanceof Error ? error.message : String(error), rule });
  }
}

function matchesAny(method, path) {
  return rules.some((rule) => matchesRule(rule, method, path));
}

function matchesRule(rule, method, path) {
  if (String(rule.method).toUpperCase() !== String(method).toUpperCase()) return false;
  return new RegExp(rule.pathRegex).test(path);
}

function samplePathFor(pathRegex) {
  return pathRegex
    .replace(/^\^/, "")
    .replace(/\?\$$/, "")
    .replace(/\$$/, "")
    .replace(/\[\^\/\]\+/g, "123")
    .replace(/\\\//g, "/")
    .replace(/\(\?:[^)]*\)/g, "")
    .replace(/\?$/, "");
}

function renderNginxMap(items) {
  const lines = [
    "# Legacy API freeze map for Annual Rings cutover.",
    "#",
    "# DRAFT ONLY. Do not deploy without explicit freeze-window authorization,",
    "# a fresh production database backup, nginx config backup, nginx -t,",
    "# and a rollback command ready.",
    "#",
    "# This map intentionally targets the old /api/ prefix and must not match /candidate-api/.",
    "# Include inside the http {} block:",
    "#",
    "#   map \"$request_method $uri\" $annual_rings_legacy_freeze_block { ... }",
    "#",
    "# Then inside the legacy /api/ location, before proxy_pass:",
    "#",
    "#   if ($annual_rings_legacy_freeze_block) {",
    "#     return 423 legacy_write_frozen;",
    "#   }",
    "",
    "map \"$request_method $uri\" $annual_rings_legacy_freeze_block {",
    "  default 0;"
  ];
  for (const rule of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`  ~^${rule.method}\\s+${stripAnchors(rule.pathRegex)} ${1}; # ${rule.id}`);
  }
  lines.push("}");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function stripAnchors(pathRegex) {
  return pathRegex.replace(/^\^/, "");
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
