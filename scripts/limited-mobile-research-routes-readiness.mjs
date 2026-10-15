#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const requireInstallWindow = process.env.LIMITED_MOBILE_RESEARCH_REQUIRE_INSTALL_WINDOW === "1";
const authorization = process.env.LIMITED_MOBILE_RESEARCH_INSTALL_AUTHORIZATION ?? "";
const expectedAuthorization = "授权安装受限 mobile research 路由";
const legacyBaseUrl = process.env.LIMITED_MOBILE_RESEARCH_LEGACY_BASE_URL ?? "https://audit-service.example.invalid:18443";
const candidateBaseUrl = process.env.LIMITED_MOBILE_RESEARCH_CANDIDATE_BASE_URL ?? "https://audit-service.example.invalid:18443/candidate-api";
const nginxBackupPath = process.env.LIMITED_MOBILE_RESEARCH_NGINX_BACKUP_PATH ?? "";
const nginxBackupSha = process.env.LIMITED_MOBILE_RESEARCH_NGINX_BACKUP_SHA256 ?? "";
const liveObserveCommand = process.env.LIMITED_MOBILE_RESEARCH_LIVE_OBSERVE_COMMAND ?? "";
const postInstallSmokeCommand = process.env.LIMITED_MOBILE_RESEARCH_POST_INSTALL_SMOKE_COMMAND ?? "";

const paths = {
  routeRules: "deploy/fact-source/limited-mobile-research-routes.json",
  generatedNginx: "deploy/fact-source/generated-limited-mobile-research-routes.conf",
  routeCheck: "scripts/limited-mobile-research-routes-check.mjs",
  packageJson: "package.json",
  makefile: "Makefile"
};

const checks = [];
const blockers = [];
const warnings = [];

for (const [id, relativePath] of Object.entries(paths)) {
  check(`required file exists: ${id}`, existsSync(join(root, relativePath)), relativePath);
}

const routeRules = readJson(paths.routeRules);
const generatedNginx = read(paths.generatedNginx);
const packageJson = readJson(paths.packageJson);
const makefile = read(paths.makefile);

validateRules(routeRules);
validateGeneratedNginx(generatedNginx, routeRules);
validateCommandExposure(packageJson, makefile);

const routeCheck = await runJson(process.execPath, ["scripts/limited-mobile-research-routes-check.mjs"], {
  LIMITED_MOBILE_RESEARCH_WRITE_OUTPUT: "0"
});
check("limited mobile research route check passed", routeCheck.output?.ok === true, summarizeRun(routeCheck));

const boundaryCheck = await runJson(process.execPath, ["scripts/production-takeover-boundary-check.mjs"], {});
check("production takeover boundary passed", boundaryCheck.output?.ok === true, summarizeRun(boundaryCheck));

const factSource = await runJson(process.execPath, ["scripts/fact-source-switch-readiness.mjs"], {
  FACT_SOURCE_SWITCH_MODE: "limited_mobile_research_routes",
  FACT_SOURCE_LEGACY_BASE_URL: legacyBaseUrl,
  FACT_SOURCE_CANDIDATE_BASE_URL: candidateBaseUrl
});
check("fact source readiness accepts limited route mode", factSource.output?.ok === true, summarizeRun(factSource));

if (!requireInstallWindow) {
  warnings.push({
    id: "install-window-not-required",
    reason: "LIMITED_MOBILE_RESEARCH_REQUIRE_INSTALL_WINDOW is not set; install-window evidence was not required"
  });
}

if (requireInstallWindow) {
  check("explicit limited route install authorization", authorization === expectedAuthorization, {
    expectedAuthorization,
    provided: authorization.length > 0,
    valuePrinted: false
  });
  check("legacy base URL excludes /candidate-api", isHttpUrl(legacyBaseUrl) && !legacyBaseUrl.includes("/candidate-api"), {
    present: Boolean(legacyBaseUrl),
    valuePrinted: false
  });
  check("candidate base URL includes /candidate-api", isHttpUrl(candidateBaseUrl) && candidateBaseUrl.includes("/candidate-api"), {
    present: Boolean(candidateBaseUrl),
    valuePrinted: false
  });
  check("nginx backup path provided", nginxBackupPath.length > 0, {
    present: nginxBackupPath.length > 0,
    valuePrinted: false
  });
  check("nginx backup file exists", nginxBackupPath.length > 0 && existsSync(nginxBackupPath), {
    present: nginxBackupPath.length > 0,
    valuePrinted: false
  });
  check("nginx backup sha256 is provided", isSha256(nginxBackupSha), {
    present: nginxBackupSha.length > 0,
    valuePrinted: false
  });
  check("nginx backup sha256 matches", nginxBackupPath.length > 0 && existsSync(nginxBackupPath) && sha256File(nginxBackupPath) === nginxBackupSha, {
    present: nginxBackupPath.length > 0,
    valuePrinted: false
  });
  check("live post-switch observe command configured", commandJsonIsValid(liveObserveCommand), {
    present: liveObserveCommand.length > 0,
    valuePrinted: false
  });
  check("live post-switch observe command uses observer", commandJsonUsesScript(liveObserveCommand, "scripts/post-switch-observe.mjs"), {
    present: liveObserveCommand.length > 0,
    expectedScript: "scripts/post-switch-observe.mjs",
    valuePrinted: false
  });
  check("post-install smoke command configured", commandJsonIsValid(postInstallSmokeCommand), {
    present: postInstallSmokeCommand.length > 0,
    valuePrinted: false
  });
  check("post-install smoke command uses limited route smoke", commandJsonUsesScript(postInstallSmokeCommand, "scripts/limited-mobile-research-routes-post-install-smoke.mjs"), {
    present: postInstallSmokeCommand.length > 0,
    expectedScript: "scripts/limited-mobile-research-routes-post-install-smoke.mjs",
    valuePrinted: false
  });
}

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  mode: {
    requireInstallWindow,
    readOnly: true,
    sendsHttpRequests: false,
    deploysNginx: false,
    reloadsServices: false,
    writesProductionFacts: false,
    enablesCandidateWriteToken: false,
    switchesLegacyApiProxy: false
  },
  scope: {
    allowedRoutes: routeRules.routes?.map((route) => route.candidateRoute) ?? [],
    forbiddenPaths: routeRules.forbiddenPaths ?? [],
    forbiddenSwitches: [
      "blanket /api proxy",
      "dual write",
      "true trades",
      "true positions",
      "reviews"
    ]
  },
  urls: {
    legacyBaseUrl,
    candidateBaseUrl
  },
  runs: {
    limitedMobileResearchRoutesCheck: summarizeRun(routeCheck),
    productionTakeoverBoundaryCheck: summarizeRun(boundaryCheck),
    factSourceSwitchReadiness: summarizeRun(factSource)
  },
  checks,
  blockers,
  warnings,
  installWindow: {
    authorization: {
      required: requireInstallWindow,
      valuePrinted: false
    },
    nginxBackup: {
      required: requireInstallWindow,
      pathProvided: nginxBackupPath.length > 0,
      shaProvided: nginxBackupSha.length > 0,
      valuePrinted: false
    },
    liveObserveCommand: {
      required: requireInstallWindow,
      configured: liveObserveCommand.length > 0,
      valuePrinted: false
    },
    postInstallSmokeCommand: {
      required: requireInstallWindow,
      configured: postInstallSmokeCommand.length > 0,
      valuePrinted: false
    }
  },
  goNoGo: blockers.length === 0
    ? "limited_mobile_research_routes_ready_to_request_install_window"
    : "no_go_clear_limited_mobile_research_install_blockers",
  notes: [
    "This command is local and read-only.",
    "It does not install nginx snippets, reload services, enable candidate write tokens, write production facts, or switch the legacy /api proxy.",
    "A passing dry-run means the draft is bounded enough to continue planning; it is not production install approval.",
    "Strict install-window mode must pass immediately before any authorized nginx route installation."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

function validateRules(payload) {
  check("route rules schema version", payload.schemaVersion === "2026-06-19.limited-mobile-research-routes.v1", paths.routeRules);
  check("route rules remain draft", payload.status === "draft", paths.routeRules);
  check("route rules have no production impact flag", payload.scope?.productionImpact === false, paths.routeRules);
  check("route rules require authorization before install", payload.scope?.requiresAuthorizationBeforeInstall === true, paths.routeRules);
  check("route mode is limited mobile research", payload.scope?.mode === "limited_mobile_research_routes", paths.routeRules);

  const routes = payload.routes ?? [];
  check("route count is exactly five", routes.length === 5, { count: routes.length });
  for (const route of routes) {
    check(`route stays under bounded mobile research routes: ${route.id}`, /^\/api\/mobile\/research\/(?:profiles|decision-context)\//.test(String(route.legacyPathRegex ?? "").replace(/^\^/, "")), route);
    check(`route is not wildcard api proxy: ${route.id}`, !String(route.legacyPathRegex ?? "").startsWith("^/api/.*"), route);
    check(`candidate route stays mobile research: ${route.id}`, /^GET \/api\/mobile\/research\/decision-context\/|^(GET|POST|PUT) \/api\/mobile\/research\/profiles\//.test(String(route.candidateRoute ?? "")), route);
  }

  const candidates = new Set(routes.map((route) => route.candidateRoute));
  for (const expected of [
    "GET /api/mobile/research/decision-context/:market/:code",
    "GET /api/mobile/research/profiles/:market/:code",
    "PUT /api/mobile/research/profiles/:market/:code",
    "POST /api/mobile/research/profiles/:market/:code/evidence",
    "POST /api/mobile/research/profiles/:market/:code/decision-checks"
  ]) {
    check(`expected candidate route present: ${expected}`, candidates.has(expected), { expected });
  }

  for (const forbidden of [
    "/api/mobile/trades",
    "/api/mobile/positions",
    "/api/mobile/reviews",
    "/api/trades",
    "/api/positions",
    "/api/reviews",
    "/api/stock-command",
    "/api/trading-agent",
    "/api/broker"
  ]) {
    check(`forbidden path declared: ${forbidden}`, (payload.forbiddenPaths ?? []).includes(forbidden), { forbidden });
  }
}

function validateGeneratedNginx(nginx, payload) {
  check("generated nginx is draft only", nginx.includes("DRAFT ONLY"), paths.generatedNginx);
  check("generated nginx has one location", (nginx.match(/^\s*location\s+/gm) ?? []).length === 1, paths.generatedNginx);
  check("generated nginx does not proxy whole /api", !/location\s+\/api\/?\s*\{/.test(nginx), paths.generatedNginx);
  check("generated nginx excludes trades text", !/trades/i.test(nginx), paths.generatedNginx);
  check("generated nginx excludes positions text", !/positions/i.test(nginx), paths.generatedNginx);
  check("generated nginx excludes reviews text", !/reviews/i.test(nginx), paths.generatedNginx);
  check("generated nginx uses candidate upstream", nginx.includes(`proxy_pass http://${payload.scope?.candidateUpstream}`), paths.generatedNginx);
  check("generated nginx carries limited route header", nginx.includes("X-Annual-Rings-Limited-Research"), paths.generatedNginx);
}

function validateCommandExposure(packageJson, makefile) {
  check("package exposes limited route check", Boolean(packageJson.scripts?.["limited-mobile-research-routes-check"]), paths.packageJson);
  check("package exposes limited route readiness", Boolean(packageJson.scripts?.["limited-mobile-research-routes-readiness"]), paths.packageJson);
  check("make exposes limited route check", /limited-mobile-research-routes-check:/.test(makefile), paths.makefile);
  check("make exposes limited route readiness", /limited-mobile-research-routes-readiness:/.test(makefile), paths.makefile);
}

async function runJson(command, args, envOverrides) {
  try {
    const result = await execFileAsync(command, args, {
      env: {
        ...process.env,
        ...envOverrides
      },
      maxBuffer: 10 * 1024 * 1024
    });
    return {
      ok: true,
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      output: parseJson(result.stdout)
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: error.code ?? 1,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
      message: error instanceof Error ? error.message : String(error),
      output: parseJson(String(error.stdout ?? ""))
    };
  }
}

function read(relativePath) {
  const fullPath = join(root, relativePath);
  if (!existsSync(fullPath)) return "";
  return readFileSync(fullPath, "utf8");
}

function readJson(relativePath) {
  const text = read(relativePath);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function check(id, ok, evidence = undefined) {
  checks.push({ id, ok, evidence });
  if (!ok) {
    blockers.push({ id, evidence });
  }
}

function summarizeRun(run) {
  if (!run) return null;
  return {
    ok: run.output?.ok === true,
    exitCode: run.exitCode,
    goNoGo: run.output?.goNoGo ?? null,
    stdoutPreview: String(run.stdout ?? "").slice(0, 300),
    stderrPreview: String(run.stderr ?? "").slice(0, 300)
  };
}

function parseJson(text) {
  const value = String(text ?? "");
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value ?? ""));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function commandJsonIsValid(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed.command === "string" && parsed.command.length > 0 && Array.isArray(parsed.args);
  } catch {
    return false;
  }
}

function commandJsonUsesScript(value, scriptPath) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed.args) && parsed.args.map(String).some((arg) => arg.includes(scriptPath));
  } catch {
    return false;
  }
}
