#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const requireProductionEnv =
  process.env.LEGACY_FREEZE_PREFLIGHT_REQUIRE_PRODUCTION_ENV === "1" ||
  process.env.LEGACY_FREEZE_REQUIRE_PRODUCTION_ENV === "1";
const requireCleanGit = process.env.LEGACY_FREEZE_PREFLIGHT_REQUIRE_CLEAN_GIT === "1";

const paths = {
  rules: "deploy/legacy-freeze/legacy-api-freeze-rules.json",
  map: "deploy/legacy-freeze/generated-legacy-api-freeze-map.conf",
  runbook: "deploy/legacy-freeze/freeze-window-runbook.md",
  postSmokePlan: "deploy/legacy-freeze/post-apply-smoke-plan.json",
  packageJson: "package.json",
  makefile: "Makefile",
  readiness: "scripts/legacy-freeze-readiness.mjs",
  rulesCheck: "scripts/legacy-freeze-rules-check.mjs",
  strictPreflightVerify: "scripts/legacy-freeze-strict-preflight-verify.mjs",
  postSmokeCheck: "scripts/legacy-freeze-post-apply-smoke-check.mjs",
  liveSmoke: "scripts/legacy-freeze-live-smoke.mjs",
  evidenceBundle: "scripts/legacy-freeze-evidence-bundle.mjs",
  boundaryCheck: "scripts/production-takeover-boundary-check.mjs"
};

const checks = [];
const blockers = [];
const warnings = [];

for (const [id, relativePath] of Object.entries(paths)) {
  check(`required file exists: ${id}`, existsSync(join(root, relativePath)), relativePath);
}

const rulesPayload = readJson(paths.rules);
const nginxMap = read(paths.map);
const runbook = read(paths.runbook);
const packageJson = readJson(paths.packageJson);
const makefile = read(paths.makefile);

const rules = rulesPayload.freezeRules ?? [];
const allowedExamples = rulesPayload.allowedExamples ?? [];

check("rules remain draft", rulesPayload.status === "draft", paths.rules);
check("rules have no production impact flag", rulesPayload.scope?.productionImpact === false, paths.rules);
check("rules target legacy api prefix", rulesPayload.scope?.legacyApiPrefix === "/api/", paths.rules);
check("candidate api prefix recorded", rulesPayload.scope?.candidateApiPrefix === "/candidate-api/", paths.rules);
check("rule count is complete enough", rules.length >= 34, { count: rules.length });
check("allowed example count is complete enough", allowedExamples.length >= 6, { count: allowedExamples.length });

validateRuleExamples();
validateNginxMap();
validateRunbook();

check("package exposes legacy-freeze-preflight", Boolean(packageJson.scripts?.["legacy-freeze-preflight"]), paths.packageJson);
check("package exposes legacy-freeze-strict-preflight-verify", Boolean(packageJson.scripts?.["legacy-freeze-strict-preflight-verify"]), paths.packageJson);
check("package exposes legacy-freeze-post-smoke-check", Boolean(packageJson.scripts?.["legacy-freeze-post-smoke-check"]), paths.packageJson);
check("package exposes legacy-freeze-live-smoke", Boolean(packageJson.scripts?.["legacy-freeze-live-smoke"]), paths.packageJson);
check("package exposes legacy-freeze-evidence-bundle", Boolean(packageJson.scripts?.["legacy-freeze-evidence-bundle"]), paths.packageJson);
check("make exposes legacy-freeze-preflight", /legacy-freeze-preflight:/.test(makefile), paths.makefile);
check("make exposes legacy-freeze-strict-preflight-verify", /legacy-freeze-strict-preflight-verify:/.test(makefile), paths.makefile);
check("make exposes legacy-freeze-post-smoke-check", /legacy-freeze-post-smoke-check:/.test(makefile), paths.makefile);
check("make exposes legacy-freeze-live-smoke", /legacy-freeze-live-smoke:/.test(makefile), paths.makefile);
check("make exposes legacy-freeze-evidence-bundle", /legacy-freeze-evidence-bundle:/.test(makefile), paths.makefile);
check("verify includes legacy-freeze-preflight", String(packageJson.scripts?.verify ?? "").includes("legacy-freeze-preflight"), paths.packageJson);
check("verify includes legacy-freeze-post-smoke-check", String(packageJson.scripts?.verify ?? "").includes("legacy-freeze-post-smoke-check"), paths.packageJson);
check("verify includes legacy-freeze-live-smoke", String(packageJson.scripts?.verify ?? "").includes("legacy-freeze-live-smoke"), paths.packageJson);

const ruleRun = await runJsonScript(paths.rulesCheck, { LEGACY_FREEZE_WRITE_OUTPUT: "0" });
check("legacy-freeze-rules-check ok", ruleRun.output?.ok === true, ruleRun.summary);

const readinessRun = await runJsonScript(paths.readiness, {
  LEGACY_FREEZE_REQUIRE_PRODUCTION_ENV: "0"
});
check("legacy-freeze-readiness ok", readinessRun.output?.ok === true, readinessRun.summary);

const postSmokeRun = await runJsonScript(paths.postSmokeCheck);
check("legacy-freeze-post-smoke-check ok", postSmokeRun.output?.ok === true, postSmokeRun.summary);

const liveSmokeDryRun = await runJsonScript(paths.liveSmoke);
check("legacy-freeze-live-smoke dry-run ok", liveSmokeDryRun.output?.ok === true && liveSmokeDryRun.output?.mode?.dryRun === true, liveSmokeDryRun.summary);

const boundaryRun = await runJsonScript(paths.boundaryCheck);
check("production takeover boundary ok", boundaryRun.output?.ok === true, boundaryRun.summary);

const git = await readGitState();
if (requireCleanGit) {
  check("git worktree is clean for freeze preflight", git.statusShort.length === 0, {
    branch: git.branch,
    head: git.head,
    statusShort: git.statusShort
  });
}

if (requireProductionEnv) {
  validateProductionEnv();
} else {
  warnings.push({
    id: "production-env-not-required",
    reason: "strict production env preflight is disabled; set LEGACY_FREEZE_PREFLIGHT_REQUIRE_PRODUCTION_ENV=1 before a real freeze window"
  });
}

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  mode: {
    requireProductionEnv,
    requireCleanGit
  },
  summary: {
    ruleCount: rules.length,
    allowedExampleCount: allowedExamples.length,
    nginxMap: paths.map,
    runbook: paths.runbook
  },
  repository: git,
  checks,
  blockers,
  warnings,
  productionEnv: summarizeProductionEnv(),
  goNoGo: blockers.length === 0
    ? "go_to_request_explicit_freeze_window_authorization"
    : "no_go_clear_blockers_before_freeze_window",
  notes: [
    "This command is local and read-only.",
    "It does not deploy nginx, reload services, freeze legacy endpoints, or write production databases.",
    "It does not print token values.",
    "Strict mode is required immediately before an actual freeze window."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

function validateRuleExamples() {
  const mustFreeze = [
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

  for (const [method, path] of mustFreeze) {
    check(`preflight must freeze ${method} ${path}`, matchesAny(method, path), { method, path });
  }

  for (const example of allowedExamples) {
    check(`preflight allowed example stays open ${example.method} ${example.path}`, !matchesAny(example.method, example.path), example);
  }

  for (const rule of rules) {
    const candidatePath = samplePathFor(rule.pathRegex).replace(/^\/api\//, "/candidate-api/api/");
    check(`candidate prefix remains open for ${rule.id}`, !matchesAny(rule.method, candidatePath), {
      method: rule.method,
      path: candidatePath
    });
  }
}

function validateNginxMap() {
  check("nginx map is draft only", nginxMap.includes("DRAFT ONLY"), paths.map);
  check("nginx map has freeze variable", nginxMap.includes("$annual_rings_legacy_freeze_block"), paths.map);
  check("nginx map uses request method and uri", nginxMap.includes('map "$request_method $uri"'), paths.map);
  check("nginx map has default open rule", /^\s*default\s+0;/m.test(nginxMap), paths.map);
  check("nginx map documents 423 response", nginxMap.includes("return 423"), paths.map);
  check("nginx map has candidate safety note", nginxMap.includes("must not match /candidate-api/"), paths.map);
  check("nginx map does not contain proxy_pass", !/^\s*proxy_pass\b/m.test(nginxMap), paths.map);
  check("nginx map does not contain reload command", !/(nginx\s+-s\s+reload|docker compose|systemctl)/.test(stripComments(nginxMap)), paths.map);

  const activeLines = nginxMap
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  check("active nginx lines do not match candidate prefix", activeLines.every((line) => !line.includes("/candidate-api/")), paths.map);

  for (const rule of rules) {
    const idCount = activeLines.filter((line) => line.endsWith(`# ${rule.id}`)).length;
    check(`nginx map contains exactly one rule id: ${rule.id}`, idCount === 1, { idCount });
  }
}

function validateRunbook() {
  const phrases = [
    "Status: draft only.",
    "Do not start the freeze window unless the user explicitly authorizes",
    "production database backup sha256 recorded",
    "nginx config backup sha256 recorded",
    "legacy freeze preflight ok=true",
    "Never write token values into Git, docs, shell history, logs, or screenshots.",
    "docker compose exec -T nginx nginx -t",
    "docker compose exec -T nginx nginx -s reload",
    "restore nginx config backup",
    "remove or revoke temporary candidate write token",
    "do not sync failed smoke data back to legacy",
    "legacy_freeze_preflight_ok=true",
    "production_fact_source_switched=false before final decision"
  ];
  for (const phrase of phrases) {
    check(`runbook phrase present: ${phrase}`, runbook.includes(phrase), paths.runbook);
  }
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
    validate: pathExists,
    reason: "latest sample file must exist before freeze preflight"
  });
  requireEnv("LEGACY_FREEZE_BACKUP_PATH", {
    validate: pathExists,
    reason: "latest production database backup file must exist"
  });
  requireEnv("LEGACY_FREEZE_BACKUP_SHA256", {
    validate: (value) => isSha256(value) && shaMatchesEnvPath(value, "LEGACY_FREEZE_BACKUP_PATH"),
    reason: "latest production database backup sha256 must match LEGACY_FREEZE_BACKUP_PATH"
  });
  requireEnv("LEGACY_FREEZE_NGINX_BACKUP_PATH", {
    validate: pathExists,
    reason: "nginx backup file must exist"
  });
  requireEnv("LEGACY_FREEZE_NGINX_BACKUP_SHA256", {
    validate: (value) => isSha256(value) && shaMatchesEnvPath(value, "LEGACY_FREEZE_NGINX_BACKUP_PATH"),
    reason: "nginx backup sha256 must match LEGACY_FREEZE_NGINX_BACKUP_PATH"
  });
  requireEnv("LEGACY_FREEZE_LIVE_AUTHORIZATION", {
    validate: (value) => value === "授权进入旧系统研究/证据/决策检查写入口冻结窗口",
    reason: "explicit freeze-window authorization phrase is required"
  });
  requireEnv("LEGACY_FREEZE_LEGACY_BASE_URL", {
    validate: (value) => isHttpUrl(value) && !value.includes("/candidate-api"),
    reason: "legacy base URL must be an HTTP(S) URL and must not include /candidate-api"
  });
  requireEnv("LEGACY_FREEZE_CANDIDATE_BASE_URL", {
    validate: (value) => isHttpUrl(value) && value.includes("/candidate-api"),
    reason: "candidate base URL must be an HTTP(S) URL and include /candidate-api"
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
    "LEGACY_FREEZE_BACKUP_PATH",
    "LEGACY_FREEZE_BACKUP_SHA256",
    "LEGACY_FREEZE_NGINX_BACKUP_PATH",
    "LEGACY_FREEZE_NGINX_BACKUP_SHA256",
    "LEGACY_FREEZE_LIVE_AUTHORIZATION",
    "LEGACY_FREEZE_LEGACY_BASE_URL",
    "LEGACY_FREEZE_CANDIDATE_BASE_URL"
  ];
  return Object.fromEntries(names.map((name) => [
    name,
    {
      present: Boolean(process.env[name]),
      valuePrinted: false,
      requiredWhen: "LEGACY_FREEZE_PREFLIGHT_REQUIRE_PRODUCTION_ENV=1"
    }
  ]));
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

async function readGitState() {
  try {
    const [branch, head, status] = await Promise.all([
      execGit(["branch", "--show-current"]),
      execGit(["rev-parse", "--short", "HEAD"]),
      execGit(["status", "--short"])
    ]);
    return {
      branch: branch.trim(),
      head: head.trim(),
      worktreeClean: status.trim().length === 0,
      statusShort: status.split("\n").map((line) => line.trimEnd()).filter(Boolean)
    };
  } catch (error) {
    return {
      branch: null,
      head: null,
      worktreeClean: false,
      statusShort: [`git-state-error: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

async function execGit(args) {
  const result = await execFileAsync("git", args, { cwd: root, maxBuffer: 1024 * 1024 });
  return result.stdout;
}

function matchesAny(method, path) {
  return rules.some((rule) => String(rule.method).toUpperCase() === String(method).toUpperCase() && new RegExp(rule.pathRegex).test(path));
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
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <redacted>")
    .replace(/postgres(?:ql)?:\/\/[^\s"]+/gi, "postgres://<redacted>")
    .replace(/token["'=:\s]+[A-Za-z0-9._-]+/gi, "token=<redacted>")
    .slice(0, 1000);
}

function stripComments(text) {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(value);
}

function pathExists(value) {
  const absolute = value.startsWith("/") ? value : join(root, value);
  try {
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}

function shaMatchesEnvPath(expectedSha, pathEnvName) {
  const value = process.env[pathEnvName] ?? "";
  if (!value || !pathExists(value)) return false;
  const absolute = value.startsWith("/") ? value : join(root, value);
  const actual = createHash("sha256").update(readFileSync(absolute)).digest("hex");
  return actual.toLowerCase() === String(expectedSha).toLowerCase();
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
