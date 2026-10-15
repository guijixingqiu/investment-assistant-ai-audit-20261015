#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const planPath = process.env.LEGACY_FREEZE_POST_SMOKE_PLAN ?? "deploy/legacy-freeze/post-apply-smoke-plan.json";
const rulesPath = process.env.LEGACY_FREEZE_RULES_PATH ?? "deploy/legacy-freeze/legacy-api-freeze-rules.json";
const runbookPath = "deploy/legacy-freeze/freeze-window-runbook.md";
const packageJsonPath = "package.json";
const makefilePath = "Makefile";

const plan = readJson(planPath);
const rules = readJson(rulesPath);
const runbook = read(runbookPath);
const packageJson = readJson(packageJsonPath);
const makefile = read(makefilePath);
const blockers = [];
const checks = [];

check("schema version", plan.schemaVersion === "2026-06-18.legacy-freeze-post-smoke.v1", planPath);
check("plan is draft", plan.status === "draft", planPath);
check("plan has no production impact", plan.productionImpact === false, planPath);
check("freeze status is explicit 423", Array.isArray(plan.expectedFreezeStatuses) && plan.expectedFreezeStatuses.includes(423), planPath);

const freezeRules = rules.freezeRules ?? [];
const frozenExamples = plan.legacyFrozenExamples ?? [];
const allowedExamples = plan.legacyAllowedExamples ?? [];
const candidateExamples = plan.candidateUnaffectedExamples ?? [];

check("has enough frozen smoke examples", frozenExamples.length >= 7, { count: frozenExamples.length });
check("has enough allowed legacy examples", allowedExamples.length >= 4, { count: allowedExamples.length });
check("has enough candidate unaffected examples", candidateExamples.length >= 4, { count: candidateExamples.length });
check("frozen example ids unique", unique(frozenExamples.map((item) => item.id)), planPath);
check("allowed example ids unique", unique(allowedExamples.map((item) => item.id)), planPath);
check("candidate example ids unique", unique(candidateExamples.map((item) => item.id)), planPath);

for (const example of frozenExamples) {
  check(`frozen example targets legacy api: ${example.id}`, String(example.path).startsWith("/api/"), example);
  check(`frozen example has write method: ${example.id}`, ["POST", "PUT", "PATCH", "DELETE"].includes(example.method), example);
  check(`frozen example expected status 423: ${example.id}`, example.expectedStatus === 423, example);
  check(`frozen example expects frozen error: ${example.id}`, example.expectedError === "legacy_write_frozen", example);
  check(`frozen example matches freeze rule: ${example.id}`, matchesFreezeRule(example.method, example.path), example);
}

for (const example of allowedExamples) {
  check(`allowed example targets legacy api: ${example.id}`, String(example.path).startsWith("/api/"), example);
  check(`allowed example has status allowlist: ${example.id}`, Array.isArray(example.allowedStatuses) && example.allowedStatuses.length > 0, example);
  check(`allowed example must not return frozen: ${example.id}`, example.mustNotReturn === "legacy_write_frozen", example);
  check(`allowed example not matched by freeze rules: ${example.id}`, !matchesFreezeRule(example.method, example.path), example);
}

for (const example of candidateExamples) {
  check(`candidate example targets candidate api: ${example.id}`, String(example.path).startsWith("/candidate-api/"), example);
  check(`candidate example must not return frozen: ${example.id}`, example.mustNotReturn === "legacy_write_frozen", example);
  check(`candidate example not matched by freeze rules: ${example.id}`, !matchesFreezeRule(example.method, example.path), example);
}

validateAuthorizedCandidateWriteSmoke();
validateRollback();
validateRunbookReferences();
validateHarnessExposure();

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  planPath,
  summary: {
    frozenExamples: frozenExamples.length,
    allowedExamples: allowedExamples.length,
    candidateUnaffectedExamples: candidateExamples.length,
    rollbackTriggers: plan.rollbackTriggers?.length ?? 0,
    rollbackActions: plan.rollbackActions?.length ?? 0
  },
  checks,
  blockers,
  goNoGo: blockers.length === 0
    ? "post_apply_smoke_plan_ready"
    : "no_go_fix_post_apply_smoke_plan",
  notes: [
    "This command validates the smoke plan only.",
    "It does not send HTTP requests.",
    "It does not deploy nginx, reload services, freeze legacy endpoints, or write production databases.",
    "Live smoke execution still requires explicit freeze-window authorization and fresh backups."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

function validateAuthorizedCandidateWriteSmoke() {
  const smoke = plan.authorizedCandidateWriteSmoke ?? {};
  check("authorized smoke script is staging rehearsal", smoke.script === "scripts/staging-research-write-rehearsal.mjs", smoke);
  check("authorized smoke base url requires candidate prefix", smoke.baseUrlMustInclude === "/candidate-api", smoke);
  for (const name of ["STAGING_WRITE_BASE_URL", "STAGING_WRITE_TOKEN", "STAGING_WRITE_RUN_ID", "STAGING_DATABASE_URL"]) {
    check(`authorized smoke requires env ${name}`, Array.isArray(smoke.requiredEnv) && smoke.requiredEnv.includes(name), smoke);
  }
  for (const phrase of [
    "legacy frozen examples return 423 legacy_write_frozen",
    "candidate health/read smoke succeeds",
    "temporary write token has been injected for one smoke run"
  ]) {
    check(`authorized smoke runAfter phrase: ${phrase}`, Array.isArray(smoke.runAfter) && smoke.runAfter.includes(phrase), smoke);
  }
  for (const phrase of [
    "unauthorized write returns 401",
    "authorized profile write returns 200",
    "authorized evidence write returns 200",
    "authorized decision check write returns 200",
    "duplicate idempotency key does not duplicate facts",
    "research_write_audit_events can be reconciled by run id",
    "trades remain 0",
    "true positions are not created",
    "reviews remain 0"
  ]) {
    check(`authorized smoke must verify: ${phrase}`, Array.isArray(smoke.mustVerify) && smoke.mustVerify.includes(phrase), smoke);
  }
  for (const phrase of [
    "remove or revoke temporary candidate write token",
    "restart candidate API without temporary token if needed",
    "verify unauthorized write returns 401 again"
  ]) {
    check(`authorized smoke afterRun phrase: ${phrase}`, Array.isArray(smoke.afterRun) && smoke.afterRun.includes(phrase), smoke);
  }
}

function validateRollback() {
  for (const phrase of [
    "any legacy frozen example does not return 423 legacy_write_frozen",
    "any candidate unaffected example returns legacy_write_frozen",
    "authorized candidate write smoke fails",
    "token cannot be removed or unauthorized write does not return 401 after smoke",
    "trades, true positions, or reviews are created by candidate smoke"
  ]) {
    check(`rollback trigger present: ${phrase}`, Array.isArray(plan.rollbackTriggers) && plan.rollbackTriggers.includes(phrase), planPath);
  }

  for (const phrase of [
    "restore nginx config backup",
    "run nginx -t",
    "reload nginx only after nginx -t passes",
    "remove or revoke temporary candidate write token",
    "keep legacy system as the only production fact source",
    "quarantine candidate smoke data by correlation id",
    "do not sync failed smoke data back to legacy"
  ]) {
    check(`rollback action present: ${phrase}`, Array.isArray(plan.rollbackActions) && plan.rollbackActions.includes(phrase), planPath);
  }
}

function validateRunbookReferences() {
  for (const text of [
    "POST /api/research-events -> 423 legacy_write_frozen",
    "GET /candidate-api/health -> 200",
    "POST /candidate-api/api/mobile/research/profiles/HK/09926/evidence -> governed by candidate write auth",
    "authorized profile write returns 200",
    "remove or revoke temporary candidate write token",
    "do not sync failed smoke data back to legacy"
  ]) {
    check(`runbook references smoke requirement: ${text}`, runbook.includes(text), runbookPath);
  }
}

function validateHarnessExposure() {
  check("package exposes legacy-freeze-live-smoke", Boolean(packageJson.scripts?.["legacy-freeze-live-smoke"]), packageJsonPath);
  check("make exposes legacy-freeze-live-smoke", /legacy-freeze-live-smoke:/.test(makefile), makefilePath);
  check("verify includes legacy-freeze-live-smoke", String(packageJson.scripts?.verify ?? "").includes("legacy-freeze-live-smoke"), packageJsonPath);
}

function matchesFreezeRule(method, path) {
  return freezeRules.some((rule) => rule.method === method && new RegExp(rule.pathRegex).test(path));
}

function unique(values) {
  return new Set(values).size === values.length;
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function check(id, ok, evidence = undefined) {
  checks.push({ id, ok, evidence });
  if (!ok) {
    blockers.push({ id, evidence });
  }
}
