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
const healthReportSource = read("scripts/mainline-health-report.mjs");
const reliabilityLedgerSource = read("scripts/platform-reliability-ledger.mjs");
const stagingPreflightSource = read("scripts/staging-readonly-preflight.mjs");
const stagingSmokeSource = read("scripts/staging-readonly-smoke.mjs");

const checks = [];
const localCheckBlockers = [];

check(
  "current project preserves advisory-only production boundary",
  projectState.schema_version === 2 && projectState.local_goal?.advisory_only === true
    && projectState.local_goal?.production_status === "NO_GO",
  "PROJECT_STATE.yaml"
);
check(
  "platform release evidence register is registered",
  packageJson.scripts?.["platform-release-evidence-register"] === "node scripts/platform-release-evidence-register.mjs",
  "package.json"
);
check(
  "platform reliability ledger remains registered",
  packageJson.scripts?.["platform-reliability-ledger"] === "node scripts/platform-reliability-ledger.mjs",
  "package.json"
);
check(
  "mainline health report emits releaseBlockers",
  healthReportSource.includes("releaseBlockers") && healthReportSource.includes("buildReleaseBlockers"),
  "scripts/mainline-health-report.mjs"
);
check(
  "platform reliability ledger preserves releaseBlockers",
  reliabilityLedgerSource.includes("releaseBlockers") && reliabilityLedgerSource.includes("required_not_claimed"),
  "scripts/platform-reliability-ledger.mjs"
);
check(
  "staging preflight fails closed on live identity and target requirements",
  stagingPreflightSource.includes("live staging target is explicitly approved")
    && stagingPreflightSource.includes("live staging target is distinguishable from production"),
  "scripts/staging-readonly-preflight.mjs"
);
check(
  "staging smoke is GET-only",
  stagingSmokeSource.includes("No POST, PUT, PATCH, or DELETE request is sent by this smoke.")
    && stagingSmokeSource.includes("method: \"GET\""),
  "scripts/staging-readonly-smoke.mjs"
);
check(
  "Web capability console exposes platform reliability panel",
  webSource.includes("core-assist-platform-reliability-readiness-matrix")
    && webSource.includes("data-platform-release-evidence-register-command"),
  "apps/web/src/app.ts + apps/web/src/coreAssistCapabilityConsoleRenderer.ts"
);

const aliasMap = {
  rollback_recovery_backup: ["rollback_rehearsal", "backup_recovery"],
  private_ingress_runtime_handoff: ["private_ingress", "runtime_handoff"],
  mainline_health: ["observability_mainline_health"],
  observability_report: ["observability_mainline_health"]
};

const historicalEvidence = [
  {
    id: "platform_1_staging_readonly_environment_2026_06_30",
    source: "docs/audit/PLATFORM-1-STAGING-READONLY-ENVIRONMENT-1.md",
    classification: "historical_not_current_release_proof",
    canClearCurrentReleaseEvidence: false,
    appliesTo: [
      "db_readonly_denial",
      "rollback_rehearsal",
      "private_ingress",
      "runtime_handoff",
      "staging_runtime_proof"
    ],
    note: "Historical staging-readonly notes are source context only; this register does not reuse them as current release proof."
  }
];

const writeBoundarySignals = {
  sendsSuccessfulWrite: false,
  writesProductionFacts: false,
  brokerWrite: false,
  officialPortfolioMutation: false,
  realTrading: false
};

const requirements = [
  requirement({
    id: "read_only_api_mode",
    title: "Read-only API mode guard",
    source: "apps/api/src/stagingReadOnly.ts; scripts/staging-readonly-smoke.mjs",
    currentStatus: "repository_local_available",
    environmentLane: "staging_preparation",
    evidenceType: "local_guard",
    requiredProof: "Local guard must block mutating methods and expose read-only health identity before any live validation.",
    currentEvidence: "staging-readonly-smoke dry-run injects Fastify GET health and blocked POST seed-fixture.",
    missingEvidence: "Live staging runtime proof is not claimed by this register.",
    failureState: "malformed_or_missing_guard_blocks_live_validation",
    authorizationRequired: "owner_authorized_live_staging_validation_before_external_probe"
  }),
  requirement({
    id: "staging_identity",
    title: "Non-placeholder staging identity",
    source: "scripts/staging-readonly-preflight.mjs",
    currentStatus: "required_not_claimed",
    environmentLane: "staging_preparation",
    evidenceType: "identity_requirement",
    requiredProof: "A non-placeholder staging identity and explicitly approved candidate API base URL are required.",
    currentEvidence: "Dry-run requirements exist; no live staging identity is proven by this task.",
    missingEvidence: "Live identity value, approved target match, and production-target separation proof.",
    failureState: "missing_or_placeholder_identity",
    authorizationRequired: "owner_authorized_staging_identity_and_target"
  }),
  requirement({
    id: "get_only_smoke_scope",
    title: "GET-only live smoke scope",
    source: "scripts/staging-readonly-smoke.mjs",
    currentStatus: "repository_local_guard",
    environmentLane: "staging_preparation",
    evidenceType: "smoke_scope",
    requiredProof: "Future live smoke may only read health, quote, research profile, decision context, Pingan snapshot, and review history.",
    currentEvidence: "Committed smoke script constructs GET-only request list and sends no mutating HTTP methods.",
    missingEvidence: "No live HTTP proof is claimed.",
    failureState: "unauthorized_or_invalid_target_blocks_before_fetch",
    authorizationRequired: "owner_authorized_get_only_staging_smoke"
  }),
  requirement({
    id: "db_readonly_denial",
    title: "Database read-only denial proof",
    source: "platform reliability evidence requirements",
    currentStatus: "required_not_claimed",
    environmentLane: "staging_preparation",
    evidenceType: "external_db_denial_proof",
    requiredProof: "An authorized staging DB proof must show writes are denied without mutating external data.",
    currentEvidence: "Requirement is visible in Web, mainline-health-report, and platform-reliability-ledger.",
    missingEvidence: "No external database connection, denial probe, or DB audit evidence was executed.",
    failureState: "missing_evidence",
    authorizationRequired: "owner_authorized_db_readonly_denial_window"
  }),
  requirement({
    id: "rollback_rehearsal",
    title: "Rollback rehearsal evidence",
    source: "platform reliability evidence requirements",
    currentStatus: "required_not_claimed",
    environmentLane: "staging_preparation",
    evidenceType: "rollback_proof",
    requiredProof: "A bounded rollback rehearsal must prove recovery steps without touching production.",
    currentEvidence: "Requirement is visible in platform ledgers and Web capability console.",
    missingEvidence: "No rollback command, service reload, deployment switch, or rehearsal evidence was executed.",
    failureState: "missing_evidence",
    authorizationRequired: "owner_authorized_rollback_rehearsal"
  }),
  requirement({
    id: "backup_recovery",
    title: "Backup and recovery proof",
    source: "platform reliability evidence requirements",
    currentStatus: "required_not_claimed",
    environmentLane: "staging_preparation",
    evidenceType: "backup_recovery_proof",
    requiredProof: "Backup identity, checksum, restore path, and recovery evidence must be proven before release readiness.",
    currentEvidence: "Requirement is listed as a release blocker only.",
    missingEvidence: "No backup inspection, creation, restore, checksum validation, or recovery test was executed.",
    failureState: "missing_evidence",
    authorizationRequired: "owner_authorized_backup_recovery_rehearsal"
  }),
  requirement({
    id: "private_ingress",
    title: "Private ingress proof",
    source: "platform reliability evidence requirements",
    currentStatus: "required_not_claimed",
    environmentLane: "staging_preparation",
    evidenceType: "private_ingress_proof",
    requiredProof: "Future staging/prod access path must prove private ingress without exposing secrets or public unsafe endpoints.",
    currentEvidence: "Requirement is visible; this register performs no network or tunnel action.",
    missingEvidence: "No SSH, tunnel, Cloudflare, MCP, or ingress check was executed.",
    failureState: "missing_evidence",
    authorizationRequired: "owner_authorized_private_ingress_validation"
  }),
  requirement({
    id: "runtime_handoff",
    title: "Runtime handoff proof",
    source: "platform reliability evidence requirements",
    currentStatus: "required_not_claimed",
    environmentLane: "staging_preparation",
    evidenceType: "runtime_handoff_proof",
    requiredProof: "Runtime identity, deployed commit, config boundary, and handoff notes must be verified from the authorized environment.",
    currentEvidence: "Requirement is visible; historical notes are not treated as current proof.",
    missingEvidence: "No remote runtime, deployed commit, service status, or handoff proof was inspected.",
    failureState: "missing_evidence",
    authorizationRequired: "owner_authorized_runtime_handoff_validation"
  }),
  requirement({
    id: "staging_runtime_proof",
    title: "Current staging runtime proof",
    source: "mainline-health-report release blockers; platform reliability evidence requirements",
    currentStatus: "required_not_claimed",
    environmentLane: "staging_preparation",
    evidenceType: "runtime_identity_and_probe_proof",
    requiredProof: "Authorized staging runtime proof must bind environment identity, target, commit, and GET-only probe outcome without production writes.",
    currentEvidence: "Only local dry-run requirements are visible; historical staging notes are not current proof.",
    missingEvidence: "No live staging runtime, deployed commit, target identity, or current probe evidence was executed.",
    failureState: "missing_evidence",
    authorizationRequired: "owner_authorized_staging_runtime_validation"
  }),
  requirement({
    id: "observability_mainline_health",
    title: "Mainline health and observability ledger",
    source: "scripts/mainline-health-check.mjs; scripts/mainline-health-report.mjs",
    currentStatus: "dry_run_repository_local",
    environmentLane: "local",
    evidenceType: "local_observability",
    requiredProof: "Repository-local health and report commands must keep no-write safety and emit release blockers.",
    currentEvidence: "mainline-health-check dry-run and mainline-health-report releaseBlockers exist.",
    missingEvidence: "Live health is not production readiness and is not claimed here.",
    failureState: "server_error_or_missing_evidence_blocks",
    authorizationRequired: "none_for_dry_run"
  }),
  requirement({
    id: "production_no_go",
    title: "Production NO_GO boundary",
    source: "PROJECT_STATE.yaml; mainline-health-report; platform-reliability-ledger",
    currentStatus: "production_NO_GO",
    environmentLane: "production_NO_GO",
    evidenceType: "release_blocker",
    requiredProof: "Production can move only after owner-authorized readiness, review, and exact merge/release authorization.",
    currentEvidence: "Production status remains NO_GO; release blockers remain visible.",
    missingEvidence: "No production readiness assessment, cutover, or owner release authorization exists.",
    failureState: "owner_authorization_missing",
    authorizationRequired: "owner_exact_release_authorization_after_review"
  }),
  requirement({
    id: "ios_physical_device",
    title: "iOS physical device smoke",
    source: "PROJECT_STATE.yaml safety boundary",
    currentStatus: "NOT_USED",
    environmentLane: "future_authorization",
    evidenceType: "future_device_evidence",
    requiredProof: "Future physical-device validation needs explicit owner authorization and correct commit/UI state proof.",
    currentEvidence: "iOS simulator/local smoke may exist, but physical device remains NOT_USED.",
    missingEvidence: "No devicectl, device deployment, physical screenshot, or device trust validation was executed.",
    failureState: "not_authorized",
    authorizationRequired: "owner_authorized_ios_physical_device_smoke"
  }),
  requirement({
    id: "broker_write",
    title: "Broker write boundary",
    source: "PROJECT_STATE.yaml safety boundary",
    currentStatus: "NOT_USED",
    environmentLane: "forbidden",
    evidenceType: "safety_boundary",
    requiredProof: "Broker writes remain disabled unless a future explicit high-risk authorization exists.",
    currentEvidence: "Current product is advisory-only and does not call broker execution paths.",
    missingEvidence: "No broker write proof is required because broker writes are forbidden in this scope.",
    failureState: "forbidden_scope",
    authorizationRequired: "not_authorized_in_product_mainline"
  }),
  requirement({
    id: "official_portfolio_mutation",
    title: "Official portfolio mutation boundary",
    source: "PROJECT_STATE.yaml safety boundary",
    currentStatus: "NOT_USED",
    environmentLane: "forbidden",
    evidenceType: "safety_boundary",
    requiredProof: "Official portfolio, cash, fee, position, order, trade, or fill mutation must remain absent.",
    currentEvidence: "Platform and product ledgers keep official portfolio mutation NOT_USED.",
    missingEvidence: "No mutation proof is required because mutations are forbidden in this scope.",
    failureState: "forbidden_scope",
    authorizationRequired: "not_authorized_in_product_mainline"
  }),
  requirement({
    id: "auto_merge",
    title: "Auto-merge boundary",
    source: "governance boundary",
    currentStatus: "FORBIDDEN",
    environmentLane: "governance",
    evidenceType: "merge_safety",
    requiredProof: "PR merge remains manual and requires exact owner authorization.",
    currentEvidence: "The register cannot merge, enable auto-merge, or change PR state.",
    missingEvidence: "No merge authorization is present or needed for this local evidence step.",
    failureState: "owner_authorization_missing",
    authorizationRequired: "owner_exact_merge_authorization"
  }),
  requirement({
    id: "no_successful_write_boundary",
    title: "No successful write boundary",
    source: "mainline-health-report safety evidence",
    currentStatus: noSuccessfulWriteBoundaryStatus(writeBoundarySignals),
    environmentLane: "local",
    evidenceType: "negative_safety_evidence",
    requiredProof: "Repository-local evidence must remain free of production writes, broker writes, official portfolio mutation, and real trading.",
    currentEvidence: "This register performs stdout-only local file reads and reports every write signal as false.",
    missingEvidence: "If any write signal becomes true, release readiness must remain false and this item becomes BLOCKED.",
    failureState: "write_boundary_violation",
    authorizationRequired: "not_authorized_in_product_mainline",
    signals: writeBoundarySignals
  })
];

const unresolvedStatuses = [
  "required_not_claimed",
  "production_NO_GO",
  "NOT_USED",
  "FORBIDDEN",
  "BLOCKED"
];
const unresolvedEvidence = requirements.filter((item) => unresolvedStatuses.includes(item.currentStatus));
const canonicalRequirementIds = requirements.map((item) => item.id);

const result = {
  ok: localCheckBlockers.length === 0,
  okMeaning: "Local register integrity checks passed; release readiness remains blocked by unresolvedEvidence.",
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
    enablesAutoMerge: false,
    writesProductionConfig: false
  },
  releaseReady: false,
  productionReady: false,
  canonicalRequirementIds,
  aliasMap,
  historicalEvidence,
  checks,
  localCheckBlockers,
  requirements,
  unresolvedEvidence,
  blockers: unresolvedEvidence,
  safety: {
    production_status: "NO_GO",
    real_trading: "NOT_USED",
    broker_write: "NOT_USED",
    official_portfolio_mutation: "NOT_USED",
    ios_physical_device: "NOT_USED",
    codexpro_watcher_tasks: "FROZEN"
  },
  goNoGo: localCheckBlockers.length === 0
    ? "release_evidence_register_recorded_with_blockers"
    : "no_go_clear_release_evidence_register_local_check_blockers",
  notes: [
    "This register is a repository-local requirements map, not staging or production proof.",
    "It performs no HTTP, SSH, database, rollback, backup, deployment, broker, physical-device, Cloudflare, MCP, watcher, .ai-bridge, or auto-merge action.",
    "Dry-run local evidence cannot clear required_not_claimed external proof lanes.",
    "Historical staging-readonly evidence is context only and cannot clear current release proof requirements."
  ]
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) {
  process.exit(1);
}

function requirement(fields) {
  return {
    ...fields,
    forbiddenActions: [
      "production_write",
      "broker_write",
      "official_portfolio_mutation",
      "real_trading",
      "physical_device",
      "external_runtime_access",
      "ssh",
      "http_probe",
      "database_connection",
      "rollback_execution",
      "backup_execution",
      "deployment",
      "cloudflare",
      "mcp",
      "watcher",
      "auto_merge"
    ],
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

function noSuccessfulWriteBoundaryStatus(signals) {
  return Object.values(signals).some(Boolean) ? "BLOCKED" : "PASS_LOCAL_NEGATIVE_EVIDENCE";
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
