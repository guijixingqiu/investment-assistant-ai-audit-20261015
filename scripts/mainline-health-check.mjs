#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const live = process.env.MAINLINE_HEALTH_LIVE === "1";
const authorization = process.env.MAINLINE_HEALTH_AUTHORIZATION ?? "";
const expectedAuthorization = "授权执行正式主线健康检查";
const legacyBaseUrl = process.env.MAINLINE_HEALTH_LEGACY_BASE_URL ?? "https://audit-service.example.invalid:18443";
const candidateBaseUrl = process.env.MAINLINE_HEALTH_CANDIDATE_BASE_URL ?? "https://audit-service.example.invalid:18443/candidate-api";
const symbol = process.env.MAINLINE_HEALTH_SYMBOL ?? "HK.09926";
const marketClosed = process.env.MAINLINE_HEALTH_MARKET_CLOSED ?? process.env.CANDIDATE_MARKET_CLOSED ?? "0";
const tlsInsecure = process.env.MAINLINE_HEALTH_TLS_INSECURE ?? process.env.CANDIDATE_PRODUCTION_TLS_INSECURE ?? "0";
const expectedNginxSha = process.env.MAINLINE_HEALTH_EXPECTED_NGINX_SHA256
  ?? "0d99c6cf1080e6661f3270a892f4304f088f7790c539dcfc0fc3da64e0b38e58";
const rollbackNginxBackupPath = process.env.MAINLINE_HEALTH_ROLLBACK_NGINX_BACKUP_PATH
  ?? "/home/REDACTED_USER/backups/annual-rings/nginx/nginx.conf.20260619_104626.before-limited-mobile-research";
const rollbackNginxBackupSha = process.env.MAINLINE_HEALTH_ROLLBACK_NGINX_BACKUP_SHA256
  ?? "bb9d710aece870b6f5a3efe7d845e00c50d87a3142c292f96771f0ffd616733a";
const mockRuns = parseMockRuns(process.env.MAINLINE_HEALTH_MOCK_RUNS ?? "");

const checks = [];
const blockers = [];
const warnings = [];

const project = read("PROJECT.md");
const status = read("STATUS.md");
const packageJson = JSON.parse(read("package.json"));
const makefile = read("Makefile");

check("project marks official engineering mainline", project.includes("正式工程主线"), "PROJECT.md");
check("status marks official engineering mainline", status.includes("正式工程主线"), "STATUS.md");
check("status keeps legacy API proxy unswitched", !status.includes("legacy_api_proxy_switched=true"), "STATUS.md");
check("status keeps candidate write token disabled", !status.includes("candidate_write_token_enabled=true"), "STATUS.md");
check("status keeps trades positions reviews protected", status.includes("真实成交、真实持仓和复盘仍由旧系统保护"), "STATUS.md");
check("status keeps physical device deferred", status.includes("真机仍 deferred") && status.includes("不声明真机已通过"), "STATUS.md");
check("package exposes mainline health check", Boolean(packageJson.scripts?.["mainline-health-check"]), "package.json");
check("make exposes mainline health check", /mainline-health-check:/.test(makefile), "Makefile");
check("candidate base URL includes /candidate-api", isHttpUrl(candidateBaseUrl) && candidateBaseUrl.includes("/candidate-api"), {
  present: Boolean(candidateBaseUrl),
  valuePrinted: false
});
check("legacy base URL excludes /candidate-api", isHttpUrl(legacyBaseUrl) && !legacyBaseUrl.includes("/candidate-api"), {
  present: Boolean(legacyBaseUrl),
  valuePrinted: false
});
check("symbol is MARKET.CODE", /^[A-Z]+\.[0-9A-Z]+$/.test(symbol), { symbol });

if (!live) {
  warnings.push({
    id: "dry-run-only",
    reason: "MAINLINE_HEALTH_LIVE is not set; no HTTP or SSH probes were sent"
  });
}

if (live) {
  check("explicit health check authorization", authorization === expectedAuthorization, {
    expectedAuthorization,
    provided: authorization.length > 0,
    valuePrinted: false
  });
}

let runs = {};
if (live && blockers.length === 0) {
  runs = await runLiveHealth();
  check("candidate production post-recovery verify passes", runs.quote.output?.ok === true, summarizeRun(runs.quote));
  check("limited mobile research route smoke passes", runs.limitedRoute.output?.ok === true, summarizeRun(runs.limitedRoute));
  check("post-switch observation passes", runs.postSwitch.output?.ok === true, summarizeRun(runs.postSwitch));
}

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  live,
  symbol,
  urls: {
    legacyBaseUrl,
    candidateBaseUrl
  },
  safety: {
    sendsSuccessfulWrite: false,
    sendsRejectedWriteProbe: live,
    deploysNginx: false,
    reloadsServices: false,
    writesProductionFacts: false,
    enablesCandidateWriteToken: false,
    switchesLegacyApiProxy: false
  },
  checks,
  blockers,
  warnings,
  runs: {
    quote: summarizeRun(runs.quote),
    limitedRoute: summarizeRun(runs.limitedRoute),
    postSwitch: summarizeRun(runs.postSwitch)
  },
  goNoGo: blockers.length === 0
    ? live
      ? "mainline_health_healthy"
      : "mainline_health_dry_run_ready"
    : "no_go_clear_mainline_health_blockers",
  notes: [
    "Default mode is dry-run and validates committed governance/safety evidence only.",
    "Live mode runs read-only and rejected-write health probes through existing gates.",
    "This command does not deploy nginx, reload services, enable write tokens, write production facts, switch the legacy API proxy, or validate physical iPhone."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

async function runLiveHealth() {
  return {
    quote: await runJson("node", ["scripts/candidate-production-post-recovery-verify.mjs"], {
      NODE_TLS_REJECT_UNAUTHORIZED: tlsInsecure === "1" ? "0" : process.env.NODE_TLS_REJECT_UNAUTHORIZED,
      CANDIDATE_PRODUCTION_TLS_INSECURE: tlsInsecure,
      CANDIDATE_MARKET_CLOSED: marketClosed,
      CANDIDATE_PRODUCTION_BASE_URL: candidateBaseUrl,
      CANDIDATE_PRODUCTION_SYMBOL: symbol
    }),
    limitedRoute: await runJson("node", ["scripts/limited-mobile-research-routes-post-install-smoke.mjs"], {
      NODE_TLS_REJECT_UNAUTHORIZED: tlsInsecure === "1" ? "0" : process.env.NODE_TLS_REJECT_UNAUTHORIZED,
      LIMITED_MOBILE_RESEARCH_POST_INSTALL_LIVE: "1",
      LIMITED_MOBILE_RESEARCH_POST_INSTALL_AUTHORIZATION: "授权执行受限 mobile research 路由安装后 smoke",
      LIMITED_MOBILE_RESEARCH_LEGACY_BASE_URL: legacyBaseUrl,
      LIMITED_MOBILE_RESEARCH_CANDIDATE_BASE_URL: candidateBaseUrl,
      LIMITED_MOBILE_RESEARCH_SYMBOL: symbol
    }),
    postSwitch: await runJson("node", ["scripts/post-switch-observe.mjs"], {
      NODE_TLS_REJECT_UNAUTHORIZED: tlsInsecure === "1" ? "0" : process.env.NODE_TLS_REJECT_UNAUTHORIZED,
      POST_SWITCH_OBSERVE_LIVE: "1",
      POST_SWITCH_OBSERVE_AUTHORIZATION: "授权执行切换后观察只读复核",
      POST_SWITCH_TLS_INSECURE: tlsInsecure,
      POST_SWITCH_MARKET_CLOSED: marketClosed,
      POST_SWITCH_LEGACY_BASE_URL: legacyBaseUrl,
      POST_SWITCH_CANDIDATE_BASE_URL: candidateBaseUrl,
      POST_SWITCH_SYMBOL: symbol,
      POST_SWITCH_EXPECTED_NGINX_SHA256: expectedNginxSha,
      POST_SWITCH_ROLLBACK_NGINX_BACKUP_PATH: rollbackNginxBackupPath,
      POST_SWITCH_ROLLBACK_NGINX_BACKUP_SHA256: rollbackNginxBackupSha
    })
  };
}

async function runJson(command, args, envOverrides) {
  if (mockRuns) {
    const run = mockRuns.shift() ?? {};
    return {
      ok: run.ok ?? true,
      exitCode: run.exitCode ?? 0,
      stdout: run.stdout ?? JSON.stringify(run.output ?? { ok: true }),
      stderr: run.stderr ?? "",
      stdoutPreview: sanitize(run.stdout ?? JSON.stringify(run.output ?? { ok: true })),
      stderrPreview: sanitize(run.stderr ?? ""),
      output: run.output ?? { ok: true }
    };
  }
  const run = await runCommand(command, args, envOverrides);
  return {
    ...run,
    output: parseJsonOutput(run.stdout)
  };
}

async function runCommand(command, args, envOverrides = {}) {
  try {
    const result = await execFileAsync(command, args, {
      env: {
        ...process.env,
        ...envOverrides
      },
      maxBuffer: 30 * 1024 * 1024
    });
    return {
      ok: true,
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutPreview: sanitize(result.stdout),
      stderrPreview: sanitize(result.stderr)
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: error.code ?? null,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
      stdoutPreview: sanitize(error.stdout),
      stderrPreview: sanitize(error.stderr),
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function check(id, ok, evidence = {}) {
  const item = { id, ok, evidence };
  checks.push(item);
  if (!ok) {
    blockers.push({ id, evidence });
  }
}

function summarizeRun(run) {
  if (!run) return null;
  return {
    ok: run.output?.ok === true || run.exitCode === 0,
    exitCode: run.exitCode,
    goNoGo: run.output?.goNoGo ?? null,
    stdoutPreview: run.stdoutPreview || undefined,
    stderrPreview: run.stderrPreview || undefined
  };
}

function parseJsonOutput(text) {
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

function parseMockRuns(value) {
  if (!value) return null;
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("MAINLINE_HEALTH_MOCK_RUNS must be a JSON array");
  }
  return parsed;
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function isHttpUrl(value) {
  return /^https?:\/\/[^/]+/i.test(value);
}

function sanitize(value) {
  return String(value ?? "")
    .replace(/(TOKEN|PASSWORD|DATABASE_URL)=([^\s]+)/gi, "$1=<redacted>")
    .slice(0, 1600);
}
