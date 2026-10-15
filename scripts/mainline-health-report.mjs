#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const live = process.env.MAINLINE_HEALTH_REPORT_LIVE === "1";
const outputDir = process.env.MAINLINE_HEALTH_REPORT_DIR ?? "artifacts/mainline-health";
const runId = process.env.MAINLINE_HEALTH_REPORT_RUN_ID ?? buildRunId();
const failOnUnhealthy = process.env.MAINLINE_HEALTH_REPORT_FAIL_ON_UNHEALTHY !== "0";
const mockHealthOutput = process.env.MAINLINE_HEALTH_REPORT_MOCK_OUTPUT ?? "";

const health = mockHealthOutput
  ? mockHealth(JSON.parse(mockHealthOutput))
  : await runHealthCheck();

const report = buildReport(health);
await mkdir(resolve(outputDir), { recursive: true });
await writeFile(resolve(join(outputDir, `${runId}.json`)), JSON.stringify(report, null, 2) + "\n");
await writeFile(resolve(join(outputDir, "latest.json")), JSON.stringify(report, null, 2) + "\n");

const result = {
  ok: report.ok,
  checkedAt: report.checkedAt,
  runId,
  reportPath: join(outputDir, `${runId}.json`),
  latestPath: join(outputDir, "latest.json"),
  mode: report.mode,
  goNoGo: report.goNoGo,
  summary: report.summary,
  alert: report.alert,
  safety: report.safety
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok && failOnUnhealthy) {
  process.exit(1);
}

function buildReport(healthRun) {
  const output = healthRun.output ?? {};
  const blockers = output.blockers ?? [];
  const warningIds = (output.warnings ?? []).map((item) => item.id);
  const delegated = output.runs ?? {};
  const ok = output.ok === true;
  const liveMode = output.live === true;
  const goNoGo = output.goNoGo ?? (ok ? "mainline_health_unknown_ok" : "mainline_health_unknown_failed");
  const safety = normalizeSafety(output.safety, liveMode);
  const alert = {
    level: ok ? "none" : "critical",
    shouldNotify: !ok,
    reasons: blockers.map((item) => item.id),
    warningIds
  };

  return {
    schemaVersion: "2026-06-19.mainline-health-report.v1",
    ok,
    checkedAt: output.checkedAt ?? new Date().toISOString(),
    runId,
    mode: {
      live: liveMode,
      dryRun: !liveMode
    },
    goNoGo,
    summary: {
      status: ok ? "healthy" : "unhealthy",
      blockers: blockers.length,
      warnings: warningIds.length,
      quoteGoNoGo: delegated.quote?.goNoGo ?? null,
      limitedRouteGoNoGo: delegated.limitedRoute?.goNoGo ?? null,
      postSwitchGoNoGo: delegated.postSwitch?.goNoGo ?? null
    },
    alert,
    evidence: buildEvidenceLedger({ liveMode, ok, goNoGo, safety, warningIds, blockers }),
    releaseBlockers: buildReleaseBlockers({ liveMode, safety }),
    safety,
    health: output,
    command: {
      name: "mainline-health-check",
      liveRequested: live,
      exitCode: healthRun.exitCode,
      stdoutPreview: healthRun.stdoutPreview,
      stderrPreview: healthRun.stderrPreview
    }
  };
}

function normalizeSafety(rawSafety, liveMode) {
  return {
    sendsSuccessfulWrite: false,
    sendsRejectedWriteProbe: liveMode,
    deploysNginx: false,
    reloadsServices: false,
    writesProductionFacts: false,
    enablesCandidateWriteToken: false,
    switchesLegacyApiProxy: false,
    ...(rawSafety ?? {})
  };
}

function buildEvidenceLedger({ liveMode, ok, goNoGo, safety, warningIds, blockers }) {
  return {
    source: "mainline-health-check",
    generatedBy: "mainline-health-report",
    mode: liveMode ? "authorized_live_if_requested" : "repository_local_dry_run",
    observabilityReport: ok ? "report_written" : "report_written_unhealthy",
    goNoGo,
    blockerCount: blockers.length,
    warningIds,
    evidenceStates: {
      readOnlyApiMode: "required_fail_closed",
      stagingHealthIdentity: liveMode ? "checked_by_mainline_health_check" : "required_not_claimed",
      liveGetOnlySmoke: liveMode ? "authorized_probe_no_successful_write" : "dry_run_no_http_ssh",
      dbReadonlyDenial: "required_not_claimed",
      rollbackRecoveryBackup: "required_not_claimed",
      privateIngressRuntimeHandoff: "required_not_claimed",
      stagingRuntimeProof: liveMode ? "health_probe_executed_not_release_proof" : "required_not_claimed",
      productionReadinessAssessment: "NO_GO"
    },
    noWriteBoundary: {
      writesProductionFacts: safety.writesProductionFacts === false,
      sendsSuccessfulWrite: safety.sendsSuccessfulWrite === false,
      deploysNginx: safety.deploysNginx === false,
      reloadsServices: safety.reloadsServices === false,
      enablesCandidateWriteToken: safety.enablesCandidateWriteToken === false,
      switchesLegacyApiProxy: safety.switchesLegacyApiProxy === false
    }
  };
}

function buildReleaseBlockers({ liveMode, safety }) {
  return [
    {
      id: "production_status",
      status: "NO_GO",
      source: "PROJECT_STATE.yaml",
      reason: "Production assessment remains preparation-only."
    },
    {
      id: "staging_runtime_proof",
      status: liveMode ? "health_probe_executed_not_release_proof" : "required_not_claimed",
      source: "mainline-health-check",
      reason: "A health probe alone is not deployment, private ingress, rollback, or release evidence."
    },
    {
      id: "db_readonly_denial",
      status: "required_not_claimed",
      source: "platform reliability evidence requirements",
      reason: "No external database access or denial probe is performed by the report."
    },
    {
      id: "rollback_recovery_backup",
      status: "required_not_claimed",
      source: "platform reliability evidence requirements",
      reason: "No backup, recovery, or rollback rehearsal is executed by the report."
    },
    {
      id: "private_ingress_runtime_handoff",
      status: "required_not_claimed",
      source: "platform reliability evidence requirements",
      reason: "No SSH, tunnel, Cloudflare, or runtime handoff proof is executed by the report."
    },
    {
      id: "ios_physical_device",
      status: "NOT_USED",
      source: "safety boundary",
      reason: "The report does not validate a physical iPhone."
    },
    {
      id: "broker_write",
      status: "NOT_USED",
      source: "safety boundary",
      reason: "The report does not call broker write or trading paths."
    },
    {
      id: "official_portfolio_mutation",
      status: "NOT_USED",
      source: "safety boundary",
      reason: "The report does not mutate portfolio, cash, fee, position, order, trade, or fill facts."
    },
    {
      id: "auto_merge",
      status: "FORBIDDEN",
      source: "governance boundary",
      reason: "The report cannot merge, auto-merge, or change PR state."
    },
    {
      id: "no_successful_write_boundary",
      status: safety.sendsSuccessfulWrite === false && safety.writesProductionFacts === false ? "PASS" : "BLOCKED",
      source: "mainline-health-check safety",
      reason: "Successful writes and production fact writes must remain false."
    }
  ];
}

async function runHealthCheck() {
  const env = {
    ...process.env,
    ...(live ? {
      MAINLINE_HEALTH_LIVE: "1",
      MAINLINE_HEALTH_AUTHORIZATION: process.env.MAINLINE_HEALTH_REPORT_AUTHORIZATION ?? "授权执行正式主线健康检查"
    } : {})
  };
  return runJson("node", ["scripts/mainline-health-check.mjs"], env);
}

async function runJson(command, args, env) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: root,
      env,
      maxBuffer: 40 * 1024 * 1024
    });
    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutPreview: sanitize(result.stdout),
      stderrPreview: sanitize(result.stderr),
      output: parseJsonOutput(result.stdout)
    };
  } catch (error) {
    return {
      exitCode: error.code ?? 1,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
      stdoutPreview: sanitize(error.stdout),
      stderrPreview: sanitize(error.stderr),
      output: parseJsonOutput(String(error.stdout ?? ""))
    };
  }
}

function mockHealth(output) {
  return {
    exitCode: output.ok === false ? 1 : 0,
    stdout: JSON.stringify(output),
    stderr: "",
    stdoutPreview: sanitize(JSON.stringify(output)),
    stderrPreview: "",
    output
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

function buildRunId() {
  return new Date().toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function resolve(relativeOrAbsolute) {
  return relativeOrAbsolute.startsWith("/")
    ? relativeOrAbsolute
    : join(root, relativeOrAbsolute);
}

function sanitize(value) {
  return String(value ?? "")
    .replace(/(TOKEN|PASSWORD|DATABASE_URL)=([^\s]+)/gi, "$1=<redacted>")
    .slice(0, 1600);
}
