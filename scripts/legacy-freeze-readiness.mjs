#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const requireProductionEnv = process.env.LEGACY_FREEZE_REQUIRE_PRODUCTION_ENV === "1";

const paths = {
  freezePlan: "docs/audit/legacy-research-write-freeze-plan.md",
  finalCutoverPlan: "docs/audit/final-cutover-plan.md",
  status: "STATUS.md",
  changelog: "CHANGELOG.md",
  packageJson: "package.json",
  makefile: "Makefile",
  freezeRules: "deploy/legacy-freeze/legacy-api-freeze-rules.json",
  freezeMap: "deploy/legacy-freeze/generated-legacy-api-freeze-map.conf",
  freezeRunbook: "deploy/legacy-freeze/freeze-window-runbook.md",
  postSmokePlan: "deploy/legacy-freeze/post-apply-smoke-plan.json",
  freezeRulesCheck: "scripts/legacy-freeze-rules-check.mjs",
  freezePreflight: "scripts/legacy-freeze-preflight.mjs",
  strictPreflightVerify: "scripts/legacy-freeze-strict-preflight-verify.mjs",
  postSmokeCheck: "scripts/legacy-freeze-post-apply-smoke-check.mjs",
  liveSmoke: "scripts/legacy-freeze-live-smoke.mjs",
  evidenceBundle: "scripts/legacy-freeze-evidence-bundle.mjs",
  stagingWrite: "scripts/staging-research-write-rehearsal.mjs",
  candidateSmoke: "scripts/candidate-production-url-smoke.mjs",
  finalReadiness: "scripts/final-cutover-readiness.mjs",
  boundaryCheck: "scripts/production-takeover-boundary-check.mjs"
};

const files = Object.fromEntries(Object.entries(paths).map(([key, relativePath]) => [key, read(relativePath)]));
const checks = [];
const blockers = [];
const warnings = [];

check("freeze plan exists", existsSync(join(root, paths.freezePlan)), paths.freezePlan);
check("final cutover plan references freeze plan", includes(files.finalCutoverPlan, paths.freezePlan), paths.finalCutoverPlan);
check("status records freeze plan ready", includes(files.status, "freeze_plan_ready=true"), paths.status);
check("status records no production write", includes(files.status, "production_database_written=false"), paths.status);
check("changelog records freeze preparation", includes(files.changelog, "Legacy research write freeze preparation"), paths.changelog);

const requiredFreezeEntries = [
  "POST /research-events",
  "PATCH /research-events/:id",
  "POST /research-goals",
  "POST /research-goals/:id/evidence",
  "PUT /investment-cards/by-stock/:stockId",
  "POST /decision-checks",
  "PATCH /decision-checks/:id/decision",
  "POST /messages/:id/research-event",
  "POST /action-items/:id/decision-check",
  "POST /trading-agent/reports/:id/adopt-decision-candidate",
  "POST /stock-command",
  "POST /reviews",
  "POST /trades",
  "POST /positions",
  "POST /broker/imports",
  "/quicktrade",
  "/quickreview",
  "source_snapshot_research_event_ingest.py"
];

for (const entry of requiredFreezeEntries) {
  check(`freeze entry listed: ${entry}`, includes(files.freezePlan, entry), paths.freezePlan);
}

const allowedEntries = [
  "只读查询",
  "行情缓存刷新",
  "生产备份",
  "日志观察",
  "只读通知"
];

for (const entry of allowedEntries) {
  check(`allowed entry listed: ${entry}`, includes(files.freezePlan, entry), paths.freezePlan);
}

const safetyPhrases = [
  "尚未执行冻结",
  "尚未写生产库",
  "尚未切换事实源",
  "避免双重事实源",
  "不得把 token 写入 Git、文档或日志",
  "立即移除候选写入 token",
  "旧系统继续作为唯一事实源",
  "不得把失败 smoke 数据同步回旧系统"
];

for (const phrase of safetyPhrases) {
  check(`safety phrase present: ${phrase}`, includes(files.freezePlan, phrase), paths.freezePlan);
}

const smokePhrases = [
  "无 token 写入返回 401",
  "有 token 写入研究档案更新",
  "有 token 新增证据",
  "有 token 创建决策检查",
  "重复 idempotency key 不重复写事实",
  "research_write_audit_events",
  "不创建 `trades`",
  "不创建真实 `positions`",
  "不创建 `reviews`"
];

for (const phrase of smokePhrases) {
  check(`candidate authorized write smoke criterion: ${phrase}`, includes(files.freezePlan, phrase), paths.freezePlan);
}

check("staging write rehearsal script exists", existsSync(join(root, paths.stagingWrite)), paths.stagingWrite);
check("staging write rehearsal requires token", /STAGING_WRITE_TOKEN[\s\S]*WRITE_API_TOKEN/.test(files.stagingWrite), paths.stagingWrite);
check("staging write rehearsal verifies unauthorized 401", /expectedStatus:\s*401/.test(files.stagingWrite), paths.stagingWrite);
check("staging write rehearsal does not print token", /tokenPrinted:\s*false/.test(files.stagingWrite), paths.stagingWrite);
check("candidate smoke is read-only", includes(files.candidateSmoke, "This smoke is read-only."), paths.candidateSmoke);
check("final readiness uses read-only transaction", includes(files.finalReadiness, "read only"), paths.finalReadiness);

const packageJson = JSON.parse(files.packageJson);
check("package exposes legacy-freeze-readiness", Boolean(packageJson.scripts?.["legacy-freeze-readiness"]), paths.packageJson);
check("package exposes legacy-freeze-rules-check", Boolean(packageJson.scripts?.["legacy-freeze-rules-check"]), paths.packageJson);
check("package exposes legacy-freeze-preflight", Boolean(packageJson.scripts?.["legacy-freeze-preflight"]), paths.packageJson);
check("package exposes legacy-freeze-strict-preflight-verify", Boolean(packageJson.scripts?.["legacy-freeze-strict-preflight-verify"]), paths.packageJson);
check("package exposes legacy-freeze-post-smoke-check", Boolean(packageJson.scripts?.["legacy-freeze-post-smoke-check"]), paths.packageJson);
check("package exposes legacy-freeze-live-smoke", Boolean(packageJson.scripts?.["legacy-freeze-live-smoke"]), paths.packageJson);
check("package exposes legacy-freeze-evidence-bundle", Boolean(packageJson.scripts?.["legacy-freeze-evidence-bundle"]), paths.packageJson);
check("package exposes production-takeover-boundary-check", Boolean(packageJson.scripts?.["production-takeover-boundary-check"]), paths.packageJson);
check("make exposes legacy-freeze-readiness", /legacy-freeze-readiness:/.test(files.makefile), paths.makefile);
check("make exposes legacy-freeze-rules-check", /legacy-freeze-rules-check:/.test(files.makefile), paths.makefile);
check("make exposes legacy-freeze-preflight", /legacy-freeze-preflight:/.test(files.makefile), paths.makefile);
check("make exposes legacy-freeze-strict-preflight-verify", /legacy-freeze-strict-preflight-verify:/.test(files.makefile), paths.makefile);
check("make exposes legacy-freeze-post-smoke-check", /legacy-freeze-post-smoke-check:/.test(files.makefile), paths.makefile);
check("make exposes legacy-freeze-live-smoke", /legacy-freeze-live-smoke:/.test(files.makefile), paths.makefile);
check("make exposes legacy-freeze-evidence-bundle", /legacy-freeze-evidence-bundle:/.test(files.makefile), paths.makefile);
check("freeze rule manifest exists", existsSync(join(root, paths.freezeRules)), paths.freezeRules);
check("freeze rule checker exists", existsSync(join(root, paths.freezeRulesCheck)), paths.freezeRulesCheck);
check("freeze preflight exists", existsSync(join(root, paths.freezePreflight)), paths.freezePreflight);
check("freeze strict preflight verifier exists", existsSync(join(root, paths.strictPreflightVerify)), paths.strictPreflightVerify);
check("freeze post-smoke checker exists", existsSync(join(root, paths.postSmokeCheck)), paths.postSmokeCheck);
check("freeze live-smoke harness exists", existsSync(join(root, paths.liveSmoke)), paths.liveSmoke);
check("freeze evidence bundle exists", existsSync(join(root, paths.evidenceBundle)), paths.evidenceBundle);
check("generated nginx freeze map exists", existsSync(join(root, paths.freezeMap)), paths.freezeMap);
check("freeze window runbook exists", existsSync(join(root, paths.freezeRunbook)), paths.freezeRunbook);
check("freeze post-apply smoke plan exists", existsSync(join(root, paths.postSmokePlan)), paths.postSmokePlan);

const ruleRun = await runJsonScript(paths.freezeRulesCheck, { LEGACY_FREEZE_WRITE_OUTPUT: "0" });
if (ruleRun.output?.ok === true) {
  checks.push({
    id: "legacy-freeze-rules-check",
    ok: true,
    source: paths.freezeRulesCheck,
    detail: `rule checker passed with ${ruleRun.output.ruleCount ?? "unknown"} rules`
  });
} else {
  blockers.push({
    id: "legacy-freeze-rules-check",
    source: paths.freezeRulesCheck,
    reason: "legacy-freeze-rules-check did not pass",
    evidence: ruleRun.summary
  });
}

const postSmokeRun = await runJsonScript(paths.postSmokeCheck);
if (postSmokeRun.output?.ok === true) {
  checks.push({
    id: "legacy-freeze-post-smoke-check",
    ok: true,
    source: paths.postSmokeCheck,
    detail: `post-apply smoke plan has ${postSmokeRun.output.summary?.frozenExamples ?? "unknown"} frozen examples`
  });
} else {
  blockers.push({
    id: "legacy-freeze-post-smoke-check",
    source: paths.postSmokeCheck,
    reason: "legacy-freeze-post-smoke-check did not pass",
    evidence: postSmokeRun.summary
  });
}

const liveSmokeRun = await runJsonScript(paths.liveSmoke);
if (liveSmokeRun.output?.ok === true && liveSmokeRun.output?.mode?.dryRun === true) {
  checks.push({
    id: "legacy-freeze-live-smoke-dry-run",
    ok: true,
    source: paths.liveSmoke,
    detail: "live smoke harness dry-run passed without sending HTTP"
  });
} else {
  blockers.push({
    id: "legacy-freeze-live-smoke-dry-run",
    source: paths.liveSmoke,
    reason: "legacy-freeze-live-smoke dry-run did not pass",
    evidence: liveSmokeRun.summary
  });
}

const boundaryRun = await runBoundaryCheck();
if (boundaryRun.output?.ok === true) {
  checks.push({
    id: "candidate-write-boundary",
    ok: true,
    source: paths.boundaryCheck,
    detail: "candidate write boundary check passed"
  });
} else {
  blockers.push({
    id: "candidate-write-boundary",
    source: paths.boundaryCheck,
    reason: "production-takeover-boundary-check did not pass",
    evidence: boundaryRun.summary
  });
}

if (requireProductionEnv) {
  validateProductionEnv();
} else {
  warnings.push({
    id: "production-env-not-required",
    reason: "LEGACY_FREEZE_REQUIRE_PRODUCTION_ENV is not set; production token/database/sample preflight was not enforced"
  });
}

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  mode: {
    requireProductionEnv
  },
  checks,
  blockers,
  warnings,
  productionEnv: summarizeProductionEnv(),
  nextAuthorization: blockers.length === 0
    ? "可以请求用户授权进入旧系统研究/证据/决策检查写入口冻结窗口；授权后仍必须先重新备份、重新导出最新样本并执行 readiness。"
    : "不可进入冻结窗口；先清零 blockers。",
  notes: [
    "This command is read-only.",
    "It does not freeze legacy endpoints.",
    "It does not write production databases.",
    "It does not print token values.",
    "Use LEGACY_FREEZE_REQUIRE_PRODUCTION_ENV=1 immediately before a real freeze window."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function includes(source, needle) {
  return source.includes(needle);
}

function check(id, ok, source) {
  checks.push({ id, ok, source });
  if (!ok) {
    blockers.push({ id, source, reason: "required freeze readiness evidence is missing" });
  }
}

async function runBoundaryCheck() {
  return runJsonScript(paths.boundaryCheck);
}

async function runJsonScript(scriptPath, extraEnv = {}) {
  try {
    const result = await execFileAsync(process.execPath, [scriptPath], {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      maxBuffer: 10 * 1024 * 1024
    });
    return {
      output: parseJson(result.stdout),
      summary: {
        exitCode: 0,
        stderrPreview: sanitize(result.stderr)
      }
    };
  } catch (error) {
    return {
      output: parseJson(String(error.stdout ?? "")),
      summary: {
        exitCode: error.code ?? null,
        stdoutPreview: sanitize(error.stdout),
        stderrPreview: sanitize(error.stderr),
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function parseJson(text) {
  const value = String(text ?? "").trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    return null;
  }
}

function sanitize(value) {
  return String(value ?? "").slice(0, 1000);
}

function validateProductionEnv() {
  requireEnv("CANDIDATE_PRODUCTION_BASE_URL", {
    validate: (value) => value.includes("/candidate-api"),
    reason: "must point at /candidate-api/ and not the legacy /api root"
  });
  requireEnv("STAGING_WRITE_BASE_URL", {
    validate: (value) => value.includes("/candidate-api"),
    reason: "authorized write smoke must target candidate /candidate-api/"
  });
  requireEnv("STAGING_WRITE_TOKEN", {
    secret: true
  });
  requireEnv("STAGING_DATABASE_URL", {
    secret: true
  });
  requireEnv("DATA_GATE_SAMPLE_PATH", {
    validate: (value) => existsSync(join(root, value)) || existsSync(value),
    reason: "sample file must exist before freeze readiness"
  });
  requireEnv("LEGACY_FREEZE_BACKUP_SHA256", {
    validate: (value) => /^[a-f0-9]{64}$/i.test(value),
    reason: "must record a sha256 for the latest production backup"
  });
}

function requireEnv(name, options = {}) {
  const value = process.env[name] ?? "";
  const present = value.length > 0;
  const valid = present && (options.validate ? options.validate(value) : true);
  checks.push({
    id: `production env ${name}`,
    ok: valid,
    source: "process.env",
    secret: Boolean(options.secret),
    present,
    valuePrinted: false
  });
  if (!valid) {
    blockers.push({
      id: `production-env-${name}`,
      source: "process.env",
      reason: present ? options.reason || "env value failed validation" : "required env var is missing",
      secret: Boolean(options.secret)
    });
  }
}

function summarizeProductionEnv() {
  const names = [
    "CANDIDATE_PRODUCTION_BASE_URL",
    "STAGING_WRITE_BASE_URL",
    "STAGING_WRITE_TOKEN",
    "STAGING_DATABASE_URL",
    "DATA_GATE_SAMPLE_PATH",
    "LEGACY_FREEZE_BACKUP_SHA256"
  ];
  return Object.fromEntries(names.map((name) => [
    name,
    {
      present: Boolean(process.env[name]),
      valuePrinted: false,
      requiredWhen: "LEGACY_FREEZE_REQUIRE_PRODUCTION_ENV=1"
    }
  ]));
}
