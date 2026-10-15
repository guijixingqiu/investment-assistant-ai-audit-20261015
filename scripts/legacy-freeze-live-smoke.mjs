#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const planPath = process.env.LEGACY_FREEZE_POST_SMOKE_PLAN ?? "deploy/legacy-freeze/post-apply-smoke-plan.json";
const plan = JSON.parse(readFileSync(join(root, planPath), "utf8"));

const live = process.env.LEGACY_FREEZE_LIVE_SMOKE === "1";
const authorization = process.env.LEGACY_FREEZE_LIVE_AUTHORIZATION ?? "";
const legacyBaseUrl = process.env.LEGACY_FREEZE_LEGACY_BASE_URL ?? "";
const candidateBaseUrl = process.env.LEGACY_FREEZE_CANDIDATE_BASE_URL ?? "";
const freezeWindowActive = process.env.LEGACY_FREEZE_WINDOW_ACTIVE === "1";
const nginxReloadVerified = process.env.LEGACY_FREEZE_NGINX_RELOAD_VERIFIED === "1";
const dryRun = !live;
const expectedAuthorization = "授权进入旧系统研究/证据/决策检查写入口冻结窗口";

const checks = [];
const blockers = [];
const warnings = [];

check("post-apply smoke plan is draft", plan.status === "draft", planPath);
check("post-apply smoke plan has no production impact flag", plan.productionImpact === false, planPath);

const dryRunPlan = buildDryRunPlan();
check("dry-run plan has frozen examples", dryRunPlan.legacyFrozen.length >= 7, { count: dryRunPlan.legacyFrozen.length });
check("dry-run plan has legacy allowed examples", dryRunPlan.legacyAllowed.length >= 4, { count: dryRunPlan.legacyAllowed.length });
check("dry-run plan has candidate unaffected examples", dryRunPlan.candidateUnaffected.length >= 4, { count: dryRunPlan.candidateUnaffected.length });
check("dry-run plan uses redacted headers", dryRunPlan.secretValuesPrinted === false, dryRunPlan);
check("dry-run plan does not include request bodies", dryRunPlan.requestBodiesPrinted === false, dryRunPlan);

if (live) {
  validateLiveGuards();
} else {
  warnings.push({
    id: "dry-run-only",
    reason: "LEGACY_FREEZE_LIVE_SMOKE is not set; no HTTP requests were sent"
  });
}

let liveResult = null;
if (live && blockers.length === 0) {
  liveResult = await runLiveSmoke();
}

const result = {
  ok: blockers.length === 0 && (!liveResult || liveResult.ok),
  checkedAt: new Date().toISOString(),
  mode: {
    live,
    dryRun,
    freezeWindowActive,
    nginxReloadVerified
  },
  planPath,
  dryRunPlan,
  liveResult,
  checks,
  blockers,
  warnings,
  goNoGo: buildGoNoGo(liveResult),
  notes: [
    "Default mode is dry-run and sends no HTTP requests.",
    "Live mode requires LEGACY_FREEZE_LIVE_SMOKE=1 plus explicit authorization and freeze-window guards.",
    "Token values, database URLs, and request bodies are never printed.",
    "This harness does not deploy nginx, reload services, freeze legacy endpoints, or write production databases."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

function validateLiveGuards() {
  requireGuard("explicit freeze authorization", authorization === expectedAuthorization, {
    expectedAuthorization,
    provided: authorization.length > 0,
    valuePrinted: false
  });
  requireGuard("freeze window active flag", freezeWindowActive, "LEGACY_FREEZE_WINDOW_ACTIVE=1 is required");
  requireGuard("nginx reload verified flag", nginxReloadVerified, "LEGACY_FREEZE_NGINX_RELOAD_VERIFIED=1 is required");
  requireGuard("legacy base url present", legacyBaseUrl.length > 0, "LEGACY_FREEZE_LEGACY_BASE_URL is required");
  requireGuard("legacy base url targets old api root host not candidate prefix", legacyBaseUrl.length > 0 && !legacyBaseUrl.includes("/candidate-api"), {
    present: legacyBaseUrl.length > 0,
    valuePrinted: false
  });
  requireGuard("candidate base url present", candidateBaseUrl.length > 0, "LEGACY_FREEZE_CANDIDATE_BASE_URL is required");
  requireGuard("candidate base url includes candidate prefix", candidateBaseUrl.includes("/candidate-api"), {
    present: candidateBaseUrl.length > 0,
    valuePrinted: false
  });
  requireGuard("candidate write token not passed to this harness", !process.env.STAGING_WRITE_TOKEN && !process.env.WRITE_API_TOKEN, {
    reason: "authorized candidate writes must be executed by staging-research-write-rehearsal after this read/freeze smoke passes"
  });
}

async function runLiveSmoke() {
  const legacyFrozen = [];
  for (const item of plan.legacyFrozenExamples ?? []) {
    const responseProbe = await probe(legacyBaseUrl, item.method, item.path);
    legacyFrozen.push({
      id: item.id,
      method: item.method,
      path: item.path,
      status: responseProbe.status,
      ok: responseProbe.status === item.expectedStatus && responseProbe.bodyPreview.includes(item.expectedError),
      bodyPreview: responseProbe.bodyPreview,
      error: responseProbe.error
    });
  }

  const legacyAllowed = [];
  for (const item of plan.legacyAllowedExamples ?? []) {
    const responseProbe = await probe(legacyBaseUrl, item.method, item.path);
    legacyAllowed.push({
      id: item.id,
      method: item.method,
      path: item.path,
      status: responseProbe.status,
      ok: item.allowedStatuses.includes(responseProbe.status) && !responseProbe.bodyPreview.includes(item.mustNotReturn),
      bodyPreview: responseProbe.bodyPreview,
      error: responseProbe.error
    });
  }

  const candidateUnaffected = [];
  for (const item of plan.candidateUnaffectedExamples ?? []) {
    const responseProbe = await probe(candidateBaseUrl, item.method, stripCandidatePrefix(item.path));
    candidateUnaffected.push({
      id: item.id,
      method: item.method,
      path: item.path,
      status: responseProbe.status,
      ok: responseProbe.status === item.expectedStatus && !responseProbe.bodyPreview.includes(item.mustNotReturn),
      bodyPreview: responseProbe.bodyPreview,
      error: responseProbe.error
    });
  }

  const ok = legacyFrozen.every((item) => item.ok)
    && legacyAllowed.every((item) => item.ok)
    && candidateUnaffected.every((item) => item.ok);

  return {
    ok,
    legacyFrozen,
    legacyAllowed,
    candidateUnaffected,
    rollbackRequired: !ok,
    requestBodiesPrinted: false,
    secretValuesPrinted: false
  };
}

async function probe(baseUrl, method, path) {
  try {
    const response = await fetch(buildUrl(baseUrl, path), {
      method,
      headers: {
        accept: "application/json",
        ...(method === "GET" ? {} : { "content-type": "application/json" })
      },
      body: method === "GET" ? undefined : "{}",
      signal: AbortSignal.timeout(8_000)
    });
    const text = await response.text();
    return {
      status: response.status,
      bodyPreview: sanitizeBody(text),
      error: null
    };
  } catch (error) {
    return {
      status: null,
      bodyPreview: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildDryRunPlan() {
  return {
    legacyFrozen: (plan.legacyFrozenExamples ?? []).map((item) => ({
      id: item.id,
      method: item.method,
      path: item.path,
      expectedStatus: item.expectedStatus,
      expectedError: item.expectedError,
      bodyPolicy: item.bodyPolicy
    })),
    legacyAllowed: (plan.legacyAllowedExamples ?? []).map((item) => ({
      id: item.id,
      method: item.method,
      path: item.path,
      allowedStatuses: item.allowedStatuses,
      mustNotReturn: item.mustNotReturn
    })),
    candidateUnaffected: (plan.candidateUnaffectedExamples ?? []).map((item) => ({
      id: item.id,
      method: item.method,
      path: item.path,
      expectedStatus: item.expectedStatus,
      mustNotReturn: item.mustNotReturn
    })),
    authorizedCandidateWriteSmoke: {
      script: plan.authorizedCandidateWriteSmoke?.script,
      requiredEnv: plan.authorizedCandidateWriteSmoke?.requiredEnv ?? [],
      baseUrlMustInclude: plan.authorizedCandidateWriteSmoke?.baseUrlMustInclude,
      tokenPrinted: false
    },
    rollbackTriggers: plan.rollbackTriggers ?? [],
    rollbackActions: plan.rollbackActions ?? [],
    requestBodiesPrinted: false,
    secretValuesPrinted: false
  };
}

function requireGuard(id, ok, evidence = undefined) {
  checks.push({ id, ok, evidence });
  if (!ok) {
    blockers.push({ id, evidence });
  }
}

function check(id, ok, evidence = undefined) {
  checks.push({ id, ok, evidence });
  if (!ok) {
    blockers.push({ id, evidence });
  }
}

function buildGoNoGo(liveResult) {
  if (blockers.length > 0) return "no_go_live_smoke_guards_failed";
  if (!live) return "dry_run_ready_live_smoke_not_executed";
  if (liveResult?.ok) return "legacy_freeze_live_smoke_passed_go_to_authorized_candidate_write_smoke";
  return "no_go_rollback_required";
}

function buildUrl(base, requestPath) {
  return new URL(requestPath.replace(/^\/+/, ""), base.endsWith("/") ? base : `${base}/`).toString();
}

function stripCandidatePrefix(path) {
  return path.replace(/^\/candidate-api\/?/, "/");
}

function sanitizeBody(text) {
  return String(text ?? "")
    .replace(/"token"\s*:\s*"[^"]+"/gi, '"token":"<redacted>"')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <redacted>")
    .slice(0, 200);
}
