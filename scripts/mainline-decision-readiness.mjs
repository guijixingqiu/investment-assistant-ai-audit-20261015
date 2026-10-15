#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const live = process.env.MAINLINE_DECISION_LIVE === "1";
const authorization = process.env.MAINLINE_DECISION_AUTHORIZATION ?? "";
const expectedAuthorization = "授权执行候选主线决策 readiness";
const candidateBaseUrl = process.env.MAINLINE_DECISION_CANDIDATE_BASE_URL ?? "https://audit-service.example.invalid:18443/candidate-api";
const legacyBaseUrl = process.env.MAINLINE_DECISION_LEGACY_BASE_URL ?? "https://audit-service.example.invalid:18443";
const symbol = process.env.MAINLINE_DECISION_SYMBOL ?? "HK.09926";
const marketClosed = process.env.MAINLINE_DECISION_MARKET_CLOSED ?? process.env.CANDIDATE_MARKET_CLOSED ?? "0";
const tlsInsecure = process.env.MAINLINE_DECISION_TLS_INSECURE ?? process.env.CANDIDATE_PRODUCTION_TLS_INSECURE ?? "0";
const expectedNginxSha = process.env.MAINLINE_DECISION_EXPECTED_NGINX_SHA256
  ?? "0d99c6cf1080e6661f3270a892f4304f088f7790c539dcfc0fc3da64e0b38e58";
const rollbackNginxBackupPath = process.env.MAINLINE_DECISION_ROLLBACK_NGINX_BACKUP_PATH
  ?? "/home/REDACTED_USER/backups/annual-rings/nginx/nginx.conf.20260619_104626.before-limited-mobile-research";
const rollbackNginxBackupSha = process.env.MAINLINE_DECISION_ROLLBACK_NGINX_BACKUP_SHA256
  ?? "bb9d710aece870b6f5a3efe7d845e00c50d87a3142c292f96771f0ffd616733a";

const docs = {
  status: process.env.MAINLINE_DECISION_STATUS_PATH ?? "STATUS.md",
  changelog: process.env.MAINLINE_DECISION_CHANGELOG_PATH ?? "CHANGELOG.md",
  finalCutoverPlan: process.env.MAINLINE_DECISION_FINAL_CUTOVER_PLAN_PATH ?? "docs/audit/final-cutover-plan.md",
  mainlineDecision: process.env.MAINLINE_DECISION_MAINLINE_DECISION_PATH ?? "docs/audit/candidate-mainline-decision.md",
  upgradeRehearsal: process.env.MAINLINE_DECISION_UPGRADE_REHEARSAL_PATH ?? "docs/audit/mainline-upgrade-rehearsal.md"
};

const requiredScripts = [
  "candidate-production-quote-recovery",
  "candidate-production-post-recovery-verify",
  "legacy-freeze-retry-readiness",
  "legacy-freeze-live-smoke",
  "staging-write-token-revoke-verify",
  "client-candidate-api-switch-verify",
  "post-switch-observe",
  "limited-mobile-research-routes-post-install-smoke"
];

const checks = [];
const blockers = [];
const warnings = [];

for (const [id, relativePath] of Object.entries(docs)) {
  check(`required document exists: ${id}`, existsSync(resolvePath(relativePath)), relativePath);
}

const status = read(docs.status);
const changelog = read(docs.changelog);
const finalPlan = read(docs.finalCutoverPlan);
const mainlineDecision = read(docs.mainlineDecision);
const upgradeRehearsal = read(docs.upgradeRehearsal);
const project = read("PROJECT.md");
const packageJson = readJson("package.json");
const makefile = read("Makefile");
const officialMainline = project.includes("正式工程主线");

validateCommandExposure(packageJson, makefile);
validateDocumentEvidence(status, changelog, finalPlan, mainlineDecision, upgradeRehearsal);
validateStaticSafety();

let liveRuns = {};
if (!live) {
  warnings.push({
    id: "dry-run-only",
    reason: "MAINLINE_DECISION_LIVE is not set; no HTTP or SSH probes were sent"
  });
}

if (live) {
  check("explicit mainline decision readiness authorization", authorization === expectedAuthorization, {
    expectedAuthorization,
    provided: authorization.length > 0,
    valuePrinted: false
  });
  check("candidate base URL includes /candidate-api", isHttpUrl(candidateBaseUrl) && candidateBaseUrl.includes("/candidate-api"), {
    present: Boolean(candidateBaseUrl),
    valuePrinted: false
  });
  check("legacy base URL excludes /candidate-api", isHttpUrl(legacyBaseUrl) && !legacyBaseUrl.includes("/candidate-api"), {
    present: Boolean(legacyBaseUrl),
    valuePrinted: false
  });

  if (blockers.length === 0) {
    liveRuns = await runLiveEvidence();
    check("live limited mobile research post-install smoke passes", liveRuns.limitedRouteSmoke.output?.ok === true, summarizeRun(liveRuns.limitedRouteSmoke));
    check("live client candidate API switch verify passes", liveRuns.clientCandidate.output?.ok === true, summarizeRun(liveRuns.clientCandidate));
    check("live post-switch observe passes", liveRuns.postSwitchObserve.output?.ok === true, summarizeRun(liveRuns.postSwitchObserve));
  }
}

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  mode: {
    live,
    dryRun: !live,
    sendsHttpRequests: live,
    sendsRejectedWriteProbes: live,
    sendsSuccessfulWrite: false,
    deploysNginx: false,
    reloadsServices: false,
    writesProductionFacts: false,
    enablesCandidateWriteToken: false,
    switchesLegacyApiProxy: false
  },
  symbol,
  urls: {
    legacyBaseUrl,
    candidateBaseUrl
  },
  decision: {
    mayEnterMainlineDecision: blockers.length === 0,
    mayDeclareOnlyOfficialMainRepo: officialMainline && blockers.length === 0,
    reason: blockers.length === 0
      ? officialMainline
        ? "The Go decision has been applied to project governance; production write boundaries remain limited and physical device remains deferred."
        : "All current non-physical-device readiness evidence is present; physical device remains deferred unless explicitly brought online."
      : "Readiness blockers remain.",
    physicalDevice: "deferred_not_passed"
  },
  checks,
  blockers,
  warnings,
  runs: {
    limitedMobileResearchRoutesPostInstallSmoke: summarizeRun(liveRuns.limitedRouteSmoke),
    clientCandidateApiSwitchVerify: summarizeRun(liveRuns.clientCandidate),
    postSwitchObserve: summarizeRun(liveRuns.postSwitchObserve)
  },
  goNoGo: blockers.length === 0
    ? "mainline_decision_readiness_ready"
    : "no_go_clear_mainline_decision_readiness_blockers",
  notes: [
    "This gate decides whether the candidate line can enter the final mainline decision review; it does not itself promote the candidate to the only official main repo.",
    "Passing this gate does not authorize blanket /api proxying, long-lived candidate write tokens, true trades, true positions, reviews, or AI-created production facts.",
    "Default mode is local dry-run over committed evidence and command exposure.",
    "Live mode repeats read/rejected-write production probes and SSH observation through existing safety gates."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

function validateCommandExposure(pkg, mk) {
  for (const script of requiredScripts) {
    check(`package exposes ${script}`, Boolean(pkg.scripts?.[script]), "package.json");
    check(`make exposes ${script}`, new RegExp(`${escapeRegExp(script)}:`).test(mk), "Makefile");
  }
}

function validateDocumentEvidence(st, cl, fp, md, ur) {
  const requiredStatusEvidence = [
    "恢复候选 production quote",
    "candidate_quote_recovery_succeeded_market_closed_stale",
    "候选授权写入 smoke 通过",
    "临时写入 token 已撤销并验证",
    "最终全量样本同步和幂等复跑通过",
    "post-switch observe 均通过",
    "当前仍未切换旧 `/api` 代理",
    "未启用候选写 token",
    "真机仍 deferred"
  ];
  for (const phrase of requiredStatusEvidence) {
    check(`STATUS evidence contains: ${phrase}`, st.includes(phrase), docs.status);
  }

  const requiredPlanEvidence = [
    "candidate_quote_recovery=passed_market_closed_stale",
    "client_candidate_api_switch_verify=passed",
    "post_switch_observe=post_switch_observation_healthy",
    "candidate_container_write_token_present=false",
    "legacy_api_proxy_switched=false",
    "candidate_write_token_enabled=false",
    "go=受限 mobile research 路由已安装并通过生产观察",
    "no_go=不得仅凭该受限路由宣布旧 /api 已整体切换"
  ];
  for (const phrase of requiredPlanEvidence) {
    check(`final cutover evidence contains: ${phrase}`, fp.includes(phrase), docs.finalCutoverPlan);
  }

  const requiredChangelogEvidence = [
    "Limited mobile research route production install",
    "未切换旧 `/api` 整体代理",
    "未启用候选写 token",
    "未发送成功生产写入",
    "未接管真实成交、真实持仓或复盘",
    "goNoGo=post_switch_observation_healthy"
  ];
  for (const phrase of requiredChangelogEvidence) {
    check(`CHANGELOG evidence contains: ${phrase}`, cl.includes(phrase), docs.changelog);
  }

  check(
    "mainline decision document records pre-Go promotion boundary or project is official mainline",
    md.includes("暂不升级为唯一正式主仓") || officialMainline,
    docs.mainlineDecision
  );
  check("upgrade rehearsal document still requires no production write takeover", ur.includes("不接管生产写入"), docs.upgradeRehearsal);
}

function validateStaticSafety() {
  const st = read(docs.status);
  check("legacy API proxy is not marked switched in docs", !st.includes("legacy_api_proxy_switched=true"), docs.status);
  check("candidate write token is not marked enabled in docs", !st.includes("candidate_write_token_enabled=true"), docs.status);
  check("physical device remains explicitly deferred", st.includes("真机仍 deferred") && st.includes("不声明真机已通过"), docs.status);
  check("physical device has no passed state marker", !/(physical_device=passed|ios_physical_production_smoke=passed|ios-physical-production-smoke=passed)/i.test(st), docs.status);
}

async function runLiveEvidence() {
  const commonTls = tlsInsecure === "1" ? { NODE_TLS_REJECT_UNAUTHORIZED: "0" } : {};
  const limitedRouteSmoke = await runJson("node", ["scripts/limited-mobile-research-routes-post-install-smoke.mjs"], {
    ...commonTls,
    LIMITED_MOBILE_RESEARCH_POST_INSTALL_LIVE: "1",
    LIMITED_MOBILE_RESEARCH_POST_INSTALL_AUTHORIZATION: "授权执行受限 mobile research 路由安装后 smoke",
    LIMITED_MOBILE_RESEARCH_LEGACY_BASE_URL: legacyBaseUrl,
    LIMITED_MOBILE_RESEARCH_CANDIDATE_BASE_URL: candidateBaseUrl,
    LIMITED_MOBILE_RESEARCH_SYMBOL: symbol
  });
  const clientCandidate = await runJson("node", ["scripts/client-candidate-api-switch-verify.mjs"], {
    ...commonTls,
    CLIENT_CANDIDATE_API_BASE_URL: candidateBaseUrl,
    CLIENT_CANDIDATE_LEGACY_BASE_URL: legacyBaseUrl,
    CLIENT_CANDIDATE_API_SYMBOL: symbol,
    CLIENT_CANDIDATE_MARKET_CLOSED: marketClosed,
    CLIENT_CANDIDATE_TLS_INSECURE: tlsInsecure
  });
  const postSwitchObserve = await runJson("node", ["scripts/post-switch-observe.mjs"], {
    ...commonTls,
    POST_SWITCH_OBSERVE_LIVE: "1",
    POST_SWITCH_OBSERVE_AUTHORIZATION: "授权执行切换后观察只读复核",
    POST_SWITCH_LEGACY_BASE_URL: legacyBaseUrl,
    POST_SWITCH_CANDIDATE_BASE_URL: candidateBaseUrl,
    POST_SWITCH_SYMBOL: symbol,
    POST_SWITCH_MARKET_CLOSED: marketClosed,
    POST_SWITCH_TLS_INSECURE: tlsInsecure,
    POST_SWITCH_EXPECTED_NGINX_SHA256: expectedNginxSha,
    POST_SWITCH_ROLLBACK_NGINX_BACKUP_PATH: rollbackNginxBackupPath,
    POST_SWITCH_ROLLBACK_NGINX_BACKUP_SHA256: rollbackNginxBackupSha
  });
  return {
    limitedRouteSmoke,
    clientCandidate,
    postSwitchObserve
  };
}

function check(id, ok, evidence = {}) {
  const item = { id, ok, evidence };
  checks.push(item);
  if (!ok) {
    blockers.push({ id, evidence });
  }
}

async function runJson(command, args, envOverrides) {
  const run = await runCommand(command, args, envOverrides);
  return {
    ...run,
    output: parseJsonOutput(run.stdout)
  };
}

async function runCommand(command, args, envOverrides) {
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
  const trimmed = String(text ?? "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function read(relativePath) {
  return readFileSync(resolvePath(relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function sanitize(value) {
  return String(value ?? "")
    .replace(/(TOKEN|PASSWORD|DATABASE_URL)=([^\s]+)/gi, "$1=<redacted>")
    .slice(0, 1600);
}

function isHttpUrl(value) {
  return /^https?:\/\//.test(String(value ?? ""));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolvePath(path) {
  return isAbsolute(path) ? path : join(root, path);
}
