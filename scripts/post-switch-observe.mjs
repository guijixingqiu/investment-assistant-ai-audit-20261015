#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const legacyBaseUrl = process.env.POST_SWITCH_LEGACY_BASE_URL ?? "https://audit-service.example.invalid:18443";
const candidateBaseUrl = process.env.POST_SWITCH_CANDIDATE_BASE_URL ?? "https://audit-service.example.invalid:18443/candidate-api";
const symbol = process.env.POST_SWITCH_SYMBOL ?? "HK.09926";
const live = process.env.POST_SWITCH_OBSERVE_LIVE === "1";
const authorization = process.env.POST_SWITCH_OBSERVE_AUTHORIZATION ?? "";
const expectedAuthorization = "授权执行切换后观察只读复核";
const sshTarget = process.env.POST_SWITCH_SSH_TARGET ?? "redacted@example.invalid";
const remoteSystemDir = process.env.POST_SWITCH_REMOTE_SYSTEM_DIR ?? "/home/REDACTED_USER/stock-helper-system";
const nginxConfigPath = process.env.POST_SWITCH_NGINX_CONFIG_PATH ?? "infra/nginx/nginx.conf";
const expectedNginxSha = process.env.POST_SWITCH_EXPECTED_NGINX_SHA256
  ?? "bb9d710aece870b6f5a3efe7d845e00c50d87a3142c292f96771f0ffd616733a";
const rollbackNginxBackupPath = process.env.POST_SWITCH_ROLLBACK_NGINX_BACKUP_PATH
  ?? "/home/REDACTED_USER/backups/annual-rings/nginx/nginx.conf.20260619_055504.before-legacy-freeze-final";
const rollbackNginxBackupSha = process.env.POST_SWITCH_ROLLBACK_NGINX_BACKUP_SHA256
  ?? "3ab5aa34c8262c68240e6334a95705144dc5be6bd652dce7709230614148a6d7";
const marketClosed = process.env.POST_SWITCH_MARKET_CLOSED ?? process.env.CANDIDATE_MARKET_CLOSED ?? "0";
const tlsInsecure = process.env.POST_SWITCH_TLS_INSECURE ?? process.env.CANDIDATE_PRODUCTION_TLS_INSECURE ?? "0";

if (tlsInsecure === "1") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const checks = [];
const blockers = [];
const warnings = [];

check("legacy base URL excludes /candidate-api", isHttpUrl(legacyBaseUrl) && !legacyBaseUrl.includes("/candidate-api"), {
  present: Boolean(legacyBaseUrl),
  valuePrinted: false
});
check("candidate base URL includes /candidate-api", isHttpUrl(candidateBaseUrl) && candidateBaseUrl.includes("/candidate-api"), {
  present: Boolean(candidateBaseUrl),
  valuePrinted: false
});
check("symbol is MARKET.CODE", /^[A-Z]+\.[0-9A-Z]+$/.test(symbol), { symbol });

if (!live) {
  warnings.push({
    id: "dry-run-only",
    reason: "POST_SWITCH_OBSERVE_LIVE is not set; no HTTP or SSH probes were sent"
  });
}

if (live) {
  check("explicit observe authorization", authorization === expectedAuthorization, {
    expectedAuthorization,
    provided: authorization.length > 0,
    valuePrinted: false
  });
}

let probes = null;
let remote = null;
let clientVerify = null;
let tokenRevoke = null;

if (live && blockers.length === 0) {
  probes = await runHttpProbes();
  check("legacy research write remains frozen", probes.legacyResearchEvent.status === 423, probes.legacyResearchEvent);
  check("legacy decision write remains frozen", probes.legacyDecisionCheck.status === 423, probes.legacyDecisionCheck);
  check("candidate health remains reachable", probes.candidateHealth.status === 200, probes.candidateHealth);
  check("candidate research read remains reachable", probes.candidateResearchRead.status === 200, probes.candidateResearchRead);
  check("candidate unauthenticated write remains rejected", probes.candidateWriteWithoutToken.status === 401, probes.candidateWriteWithoutToken);
}

if (live && blockers.length === 0) {
  clientVerify = await runJson("node", ["scripts/client-candidate-api-switch-verify.mjs"], {
    CLIENT_CANDIDATE_API_BASE_URL: candidateBaseUrl,
    CLIENT_CANDIDATE_LEGACY_BASE_URL: legacyBaseUrl,
    CLIENT_CANDIDATE_API_SYMBOL: symbol,
    CLIENT_CANDIDATE_MARKET_CLOSED: marketClosed,
    CLIENT_CANDIDATE_TLS_INSECURE: tlsInsecure
  });
  check("client candidate API switch remains verified", clientVerify.output?.ok === true, summarizeRun(clientVerify));
}

if (live && blockers.length === 0) {
  tokenRevoke = await runJson("npm", ["run", "staging-write-token-revoke-verify"], {
    STAGING_WRITE_BASE_URL: candidateBaseUrl,
    STAGING_WRITE_SYMBOL: symbol,
    STAGING_WRITE_REVOKED_TOKEN: process.env.POST_SWITCH_REVOKED_TOKEN_PROBE ?? "redacted-old-token",
    STAGING_WRITE_REVOKE_RUN_ID: process.env.POST_SWITCH_REVOKE_RUN_ID ?? buildRevokeRunId(),
    STAGING_WRITE_REVOKE_VERIFY_LIVE: "1",
    STAGING_WRITE_REVOKE_VERIFY_AUTHORIZATION: "授权验证候选系统临时写入 token 已撤销"
  });
  check("candidate write token remains revoked", tokenRevoke.output?.ok === true, summarizeRun(tokenRevoke));
}

if (live && blockers.length === 0) {
  remote = await runRemoteObservation();
  check("remote nginx config sha matches frozen config", remote.nginxConfigSha?.sha === expectedNginxSha, remote.nginxConfigSha);
  check("remote nginx freeze variable remains installed", Number(remote.freezeVariableCount?.stdout ?? 0) >= 1, remote.freezeVariableCount);
  check("remote nginx syntax is valid", remote.nginxTest?.exitCode === 0, remote.nginxTest);
  check("rollback nginx backup exists", remote.rollbackBackup?.exitCode === 0, remote.rollbackBackup);
  check("rollback nginx backup sha matches", remote.rollbackBackupSha?.sha === rollbackNginxBackupSha, remote.rollbackBackupSha);
  check("candidate container write token remains empty", remote.writeToken?.present === false, remote.writeToken);
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
    enablesCandidateWriteToken: false
  },
  probes,
  remote,
  runs: {
    clientCandidateApiSwitchVerify: summarizeRun(clientVerify),
    tokenRevokeVerify: summarizeRun(tokenRevoke)
  },
  checks,
  blockers,
  warnings,
  rollback: {
    required: blockers.length > 0,
    nginxBackupPath: rollbackNginxBackupPath,
    nginxBackupSha256: rollbackNginxBackupSha,
    restoreCommandTemplate: `cp ${rollbackNginxBackupPath} ${remoteSystemDir}/${nginxConfigPath} && docker exec stock_nginx nginx -t && docker exec stock_nginx nginx -s reload`,
    notes: [
      "Do not rollback merely because observation ended; rollback only when a blocker indicates unsafe state or the user explicitly requests解除冻结.",
      "Before unfreezing legacy research writes, confirm it will not create double-write with candidate clients."
    ]
  },
  goNoGo: blockers.length === 0
    ? "post_switch_observation_healthy"
    : "no_go_observation_blockers_review_rollback",
  notes: [
    "Default mode is dry-run and sends no HTTP or SSH probes.",
    "Live mode sends only read probes and rejected write probes.",
    "This command does not deploy nginx, reload services, enable write tokens, or write production facts.",
    "Physical iPhone remains a separate deferred check unless explicitly brought online."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

async function runHttpProbes() {
  const [market, code] = parseSymbol(symbol);
  return {
    legacyResearchEvent: await probe(legacyBaseUrl, "POST", "/api/research-events", {}),
    legacyDecisionCheck: await probe(legacyBaseUrl, "POST", "/api/decision-checks", {}),
    candidateHealth: await probe(candidateBaseUrl, "GET", "/health"),
    candidateResearchRead: await probe(candidateBaseUrl, "GET", `/api/mobile/research/profiles/${market}/${code}`),
    candidateWriteWithoutToken: await probe(candidateBaseUrl, "POST", `/api/mobile/research/profiles/${market}/${code}/evidence`, {})
  };
}

async function runRemoteObservation() {
  const [
    nginxConfigSha,
    freezeVariableCount,
    nginxTest,
    rollbackBackup,
    rollbackBackupSha,
    writeToken
  ] = await Promise.all([
    remoteSha(`${remoteSystemDir}/${nginxConfigPath}`),
    remoteCommand(`grep -c annual_rings_legacy_freeze_block ${quoteShell(`${remoteSystemDir}/${nginxConfigPath}`)}`),
    remoteCommand("docker exec stock_nginx nginx -t"),
    remoteCommand(`test -f ${quoteShell(rollbackNginxBackupPath)}`),
    remoteSha(rollbackNginxBackupPath),
    remoteWriteTokenState()
  ]);
  return {
    nginxConfigSha,
    freezeVariableCount,
    nginxTest,
    rollbackBackup,
    rollbackBackupSha,
    writeToken
  };
}

async function remoteWriteTokenState() {
  const command = "docker exec annual_rings_staging_api node -e 'const v=process.env.WRITE_API_TOKEN||\"\"; console.log(JSON.stringify({present:v.length>0,length:v.length,requireWriteAuth:process.env.REQUIRE_WRITE_AUTH||null}))'";
  const run = await remoteCommand(command);
  let parsed = null;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    parsed = null;
  }
  return {
    ...run,
    present: parsed?.present ?? null,
    length: parsed?.length ?? null,
    requireWriteAuth: parsed?.requireWriteAuth ?? null
  };
}

async function remoteSha(path) {
  const run = await remoteCommand(`sha256sum ${quoteShell(path)}`);
  return {
    ...run,
    sha: run.stdout.split(/\s+/)[0] || null
  };
}

async function remoteCommand(command) {
  try {
    const result = await execFileAsync("ssh", [sshTarget, command], {
      maxBuffer: 10 * 1024 * 1024
    });
    return {
      ok: true,
      exitCode: 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      stdoutPreview: sanitize(result.stdout),
      stderrPreview: sanitize(result.stderr)
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: error.code ?? null,
      stdout: String(error.stdout ?? "").trim(),
      stderr: String(error.stderr ?? "").trim(),
      stdoutPreview: sanitize(error.stdout),
      stderrPreview: sanitize(error.stderr),
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function probe(baseUrl, method, path, body) {
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
      bodyPreview: text.slice(0, 160).replace(/\s+/g, " "),
      error: null
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      bodyPreview: "",
      error: error instanceof Error ? error.message : String(error)
    };
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
      maxBuffer: 20 * 1024 * 1024
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

function parseSymbol(value) {
  const [market, code] = String(value).split(".");
  return [market || "HK", code || "09926"];
}

function joinUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}

function isHttpUrl(value) {
  return /^https?:\/\//.test(String(value ?? ""));
}

function sanitize(value) {
  return String(value ?? "")
    .replace(/(TOKEN|PASSWORD|DATABASE_URL)=([^\s]+)/gi, "$1=<redacted>")
    .slice(0, 1200);
}

function quoteShell(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function buildRevokeRunId() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `prod-candidate-write-revoke-${stamp}`;
}
