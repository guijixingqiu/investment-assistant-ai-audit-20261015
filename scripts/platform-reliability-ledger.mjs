#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const projectState = JSON.parse(read("PROJECT_STATE.yaml"));
const packageJson = JSON.parse(read("package.json"));
const webSource = [
  "apps/web/src/app.ts",
  "apps/web/src/coreAssistCapabilityConsoleRenderer.ts"
].map(read).join("\n");
const mainlineHealthReport = read("scripts/mainline-health-report.mjs");
const stagingReadonlyPreflight = read("scripts/staging-readonly-preflight.mjs");
const stagingReadonlySmoke = read("scripts/staging-readonly-smoke.mjs");

const checks = [];
const localCheckBlockers = [];

check(
  "current project preserves advisory-only production boundary",
  projectState.schema_version === 2 && projectState.local_goal?.advisory_only === true
    && projectState.local_goal?.production_status === "NO_GO",
  "PROJECT_STATE.yaml"
);
check(
  "mainline health report script is registered",
  packageJson.scripts?.["mainline-health-report"] === "node scripts/mainline-health-report.mjs",
  "package.json"
);
check(
  "staging read-only preflight script is registered",
  Boolean(packageJson.scripts?.["staging-readonly-preflight"]),
  "package.json"
);
check(
  "staging read-only smoke script is registered",
  packageJson.scripts?.["staging-readonly-smoke"] === "node scripts/staging-readonly-smoke.mjs",
  "package.json"
);
check(
  "Web capability console exposes platform evidence matrix",
  webSource.includes("core-assist-platform-reliability-readiness-matrix"),
  "apps/web/src/app.ts + apps/web/src/coreAssistCapabilityConsoleRenderer.ts"
);
check(
  "mainline health report emits release blockers",
  mainlineHealthReport.includes("releaseBlockers") && mainlineHealthReport.includes("db_readonly_denial"),
  "scripts/mainline-health-report.mjs"
);
check(
  "staging read-only live smoke is GET-only",
  stagingReadonlySmoke.includes("No POST, PUT, PATCH, or DELETE request is sent by this smoke.")
    && stagingReadonlySmoke.includes("await getJson(\"health\")")
    && stagingReadonlySmoke.includes("method: \"GET\""),
  "scripts/staging-readonly-smoke.mjs"
);
check(
  "staging preflight default sends no HTTP requests",
  stagingReadonlyPreflight.includes("STAGING_READONLY_LIVE is not set; no HTTP requests were sent"),
  "scripts/staging-readonly-preflight.mjs"
);

const lanes = [
  lane({
    id: "read_only_api_mode",
    status: "required_fail_closed",
    source: "apps/api/src/stagingReadOnly.ts plus staging-readonly-preflight",
    environmentLane: "staging_preparation",
    failureState: "missing_or_malformed_blocks_live_validation",
    claimLevel: "repository_local_requirement",
    allowedInterpretation: "A read-only mode requirement and guard exist locally.",
    forbiddenInterpretation: "Do not claim a live staging runtime has been validated."
  }),
  lane({
    id: "staging_identity",
    status: "required_not_claimed",
    source: "staging-readonly-preflight",
    environmentLane: "staging_preparation",
    failureState: "missing_or_placeholder_identity",
    claimLevel: "requirement_only",
    allowedInterpretation: "A non-placeholder staging identity is required before live validation.",
    forbiddenInterpretation: "Do not use a dry-run identity as runtime proof."
  }),
  lane({
    id: "get_only_smoke_scope",
    status: "dry_run_no_http_ssh",
    source: "staging-readonly-smoke",
    environmentLane: "staging_preparation",
    failureState: "unauthorized_or_invalid_target_blocks_before_fetch",
    claimLevel: "repository_local_guard",
    allowedInterpretation: "The future live smoke is constrained to GET-only lanes.",
    forbiddenInterpretation: "Do not claim that live smoke ran in this repository-local task."
  }),
  lane({
    id: "db_readonly_denial",
    status: "required_not_claimed",
    source: "platform reliability evidence requirements",
    environmentLane: "staging_preparation",
    failureState: "missing_evidence",
    claimLevel: "requirement_only",
    allowedInterpretation: "DB read-only denial evidence is listed as a blocker.",
    forbiddenInterpretation: "Do not connect to an external DB or claim denial evidence exists."
  }),
  lane({
    id: "rollback_rehearsal",
    status: "required_not_claimed",
    source: "platform reliability evidence requirements",
    environmentLane: "staging_preparation",
    failureState: "missing_evidence",
    claimLevel: "requirement_only",
    allowedInterpretation: "Rollback rehearsal evidence remains required.",
    forbiddenInterpretation: "Do not perform or claim rollback rehearsal."
  }),
  lane({
    id: "backup_recovery",
    status: "required_not_claimed",
    source: "platform reliability evidence requirements",
    environmentLane: "staging_preparation",
    failureState: "missing_evidence",
    claimLevel: "requirement_only",
    allowedInterpretation: "Backup and recovery proof remains required.",
    forbiddenInterpretation: "Do not inspect, create, restore, or claim backups."
  }),
  lane({
    id: "private_ingress",
    status: "required_not_claimed",
    source: "platform reliability evidence requirements",
    environmentLane: "staging_preparation",
    failureState: "missing_evidence",
    claimLevel: "requirement_only",
    allowedInterpretation: "Private ingress proof remains required.",
    forbiddenInterpretation: "Do not use SSH, tunnels, MCP, Cloudflare, or external ingress checks."
  }),
  lane({
    id: "runtime_handoff",
    status: "required_not_claimed",
    source: "platform reliability evidence requirements",
    environmentLane: "staging_preparation",
    failureState: "missing_evidence",
    claimLevel: "requirement_only",
    allowedInterpretation: "Runtime handoff evidence remains required.",
    forbiddenInterpretation: "Do not claim staging handoff from historical notes."
  }),
  lane({
    id: "mainline_health",
    status: "dry_run_repository_local",
    source: "mainline-health-check",
    environmentLane: "local",
    failureState: "server_error_or_missing_evidence_blocks",
    claimLevel: "repository_local_evidence",
    allowedInterpretation: "Dry-run health validates committed governance and safety evidence.",
    forbiddenInterpretation: "Do not claim live HTTP, SSH, deployment, or iOS physical-device health."
  }),
  lane({
    id: "observability",
    status: "report_ledger_available",
    source: "mainline-health-report",
    environmentLane: "local",
    failureState: "unhealthy_report_blocks",
    claimLevel: "repository_local_evidence",
    allowedInterpretation: "A local JSON report can carry evidence states and release blockers.",
    forbiddenInterpretation: "Do not treat local JSON as production observability."
  }),
  lane({
    id: "release_blockers",
    status: "production_NO_GO",
    source: "PROJECT_STATE.yaml and mainline-health-report",
    environmentLane: "production_NO_GO",
    failureState: "owner_authorization_missing",
    claimLevel: "blocking_boundary",
    allowedInterpretation: "Production, broker write, official portfolio mutation, iOS physical device, and auto-merge remain blocked.",
    forbiddenInterpretation: "Do not merge, release, deploy, trade, write broker state, or change production config."
  })
];

const statusVocabulary = [
  "loading",
  "empty",
  "missing",
  "stale",
  "unauthorized",
  "conflict",
  "offline",
  "malformed",
  "server-error",
  "source-mismatch",
  "unavailable",
  "fixture",
  "local",
  "staging-preparation",
  "production-NO_GO",
  "unknown"
];

const releaseBlockers = lanes
  .filter((item) => item.status === "required_not_claimed" || item.status === "production_NO_GO")
  .map((item) => ({
    id: item.id,
    status: item.status,
    source: item.source,
    claimLevel: item.claimLevel,
    requiredBefore: item.status === "production_NO_GO" ? "production_release" : "release_readiness",
    reason: item.allowedInterpretation
  }));

const result = {
  ok: localCheckBlockers.length === 0,
  okMeaning: "Local ledger integrity checks passed; unresolved release evidence remains in releaseBlockers.",
  checkedAt: new Date().toISOString(),
  mode: {
    repositoryLocal: true,
    sendsHttpRequests: false,
    opensSsh: false,
    connectsDatabase: false,
    runsRollback: false,
    touchesBackups: false,
    deploysServices: false,
    validatesPhysicalDevice: false,
    enablesAutoMerge: false
  },
  checks,
  localCheckBlockers,
  releaseBlockers,
  blockers: releaseBlockers,
  lanes,
  statusVocabulary,
  goNoGo: localCheckBlockers.length === 0
    ? "platform_reliability_ledger_recorded_with_release_blockers"
    : "no_go_clear_platform_reliability_local_check_blockers",
  safety: {
    production_status: "NO_GO",
    real_trading: "NOT_USED",
    broker_write: "NOT_USED",
    official_portfolio_mutation: "NOT_USED",
    ios_physical_device: "NOT_USED",
    codexpro_watcher_tasks: "FROZEN"
  },
  notes: [
    "This ledger is repository-local and reads configured repository-local files from the current worktree.",
    "It does not run staging validation, production validation, external HTTP, SSH, database access, rollback, backup, broker access, physical-device testing, Cloudflare, MCP, watcher, .ai-bridge, or auto-merge.",
    "required_not_claimed and production_NO_GO lanes are explicit releaseBlockers, not empty success states."
  ]
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) {
  process.exit(1);
}

function lane(fields) {
  return {
    ...fields,
    safety: {
      productionWrite: false,
      brokerWrite: false,
      officialPortfolioMutation: false,
      realTrading: false,
      physicalDevice: false,
      externalRuntimeAccess: false,
      autoMerge: false
    }
  };
}

function check(id, ok, evidence) {
  const item = { id, ok, evidence };
  checks.push(item);
  if (!ok) {
    localCheckBlockers.push({ id, evidence });
  }
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}
