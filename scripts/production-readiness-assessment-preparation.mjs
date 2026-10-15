#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const currentState = JSON.parse(read("PROJECT_STATE.yaml"));
// Historical release replay, never current deployment or current acceptance proof.
const historicalStatePath = "docs/governance/history/2026-09-10/PROJECT_STATE.yaml";
const projectState = read(historicalStatePath);
const packageJson = JSON.parse(read("package.json"));
const webSource = [
  "apps/web/src/app.ts",
  "apps/web/src/coreAssistCapabilityConsoleRenderer.ts"
].map(read).join("\n");
const platformLedgerSource = read("scripts/platform-reliability-ledger.mjs");
const releaseRegisterSource = read("scripts/platform-release-evidence-register.mjs");
const mainlineHealthSource = read("scripts/mainline-health-check.mjs");
const mainlineHealthReportSource = read("scripts/mainline-health-report.mjs");
const releaseAuditSource = read("docs/audit/READONLY-RELEASE-1.md");

const checks = [];
const localCheckBlockers = [];
const assessmentActive = currentState.next_task?.goal_id === "PRODUCTION-READINESS-ASSESSMENT-PREPARATION-1";
const assessmentAccepted = projectState.includes("CORE-ASSIST production readiness assessment preparation accepted with production NO_GO");
const quantSnapshotAccepted = projectState.includes("QUANT-1A frozen market-data snapshot foundation accepted with production NO_GO");
const quantBaselineAccepted = projectState.includes("QUANT-1B sample-split baseline backtest foundation accepted with production NO_GO");
const quantShadowAccepted = projectState.includes("QUANT-1C isolated shadow portfolio foundation accepted with production NO_GO");
const activeNextTask = currentState.next_task?.goal_id ?? null;
const readOnlyReleaseBlock = projectState.match(/^  read_only_release:\s*\n([\s\S]*?)(?=^  historical_stage20_capacity_evidence:)/m)?.[1] ?? "";
const releasedHeadSha = stateValue(readOnlyReleaseBlock, "released_head_sha");
const mergedMainSha = stateValue(readOnlyReleaseBlock, "merged_main_sha");
const runtimeIdentity = stateValue(readOnlyReleaseBlock, "runtime_identity");
const getOnlySmokeVerified = releaseAuditSource.includes("Authorized six-route GET smoke: HTTP `200` with correlation IDs.");
const recoveryVerified = releaseAuditSource.includes("Isolated no-network restore and rollback rehearsal: `PASS`.");
const productionNoWriteVerified = /No production write request was sent and no response body or credential was\s+stored in the release evidence\./.test(
  releaseAuditSource
);
const officialFactsUnchanged = releaseAuditSource.includes("- `official_fact_mutation`: `NOT_USED`");
const privatePreflightIngressVerified = projectState.includes(
  "coverage: staging runtime identity GET-only live smoke DB read-only denial private ingress and isolated rollback rehearsal"
);
const publicCandidateIngressVerified = releaseAuditSource.includes("Public candidate ingress: ports `18443` and `8443`.");
const tlsHostnameMismatchRecorded = releaseAuditSource.includes("certificate hostname mismatch remains recorded");
const readOnlyReleaseCompleted = stateValue(readOnlyReleaseBlock, "state") === "completed"
  && isSha(releasedHeadSha)
  && isSha(mergedMainSha)
  && runtimeIdentity === `exact-head-${releasedHeadSha}`
  && stateValue(readOnlyReleaseBlock, "runtime_read_only") === "true"
  && stateValue(readOnlyReleaseBlock, "database_ready") === "true"
  && stateValue(readOnlyReleaseBlock, "database_write_denial") === "SQLSTATE_25006"
  && stateValue(readOnlyReleaseBlock, "production_status") === "NO_GO"
  && releaseAuditSource.includes("Decision: `COMPLETE_READONLY_RELEASE_WITH_PRODUCTION_NO_GO`")
  && releaseAuditSource.includes(`Reviewed and released head: \`${releasedHeadSha}\``)
  && releaseAuditSource.includes(mergedMainSha ?? "missing-merged-main")
  && getOnlySmokeVerified
  && recoveryVerified
  && productionNoWriteVerified
  && officialFactsUnchanged
  && privatePreflightIngressVerified
  && publicCandidateIngressVerified
  && tlsHostnameMismatchRecorded;

check(
  "production assessment preparation is active or accepted with one next task",
  currentState.schema_version === 2 && currentState.local_goal?.production_status === "NO_GO" &&
    (assessmentActive || (assessmentAccepted && quantSnapshotAccepted && quantBaselineAccepted && quantShadowAccepted && activeNextTask !== null)),
  "PROJECT_STATE.yaml"
);
check(
  "production assessment command is registered",
  packageJson.scripts?.["production-readiness-assessment-preparation"] === "node scripts/production-readiness-assessment-preparation.mjs",
  "package.json"
);
check(
  "platform release evidence register remains available",
  packageJson.scripts?.["platform-release-evidence-register"] === "node scripts/platform-release-evidence-register.mjs"
    && releaseRegisterSource.includes("releaseReady: false")
    && releaseRegisterSource.includes("productionReady: false"),
  "scripts/platform-release-evidence-register.mjs"
);
check(
  "platform reliability ledger keeps blockers non-clearing",
  platformLedgerSource.includes("releaseBlockers")
    && platformLedgerSource.includes("required_not_claimed")
    && platformLedgerSource.includes("production_NO_GO"),
  "scripts/platform-reliability-ledger.mjs"
);
check(
  "mainline health commands remain dry-run and no-write by default",
  mainlineHealthSource.includes("Default mode is dry-run")
    && mainlineHealthReportSource.includes("releaseBlockers"),
  "scripts/mainline-health-check.mjs"
);
check(
  "Web capability console exposes production assessment preparation",
  webSource.includes("core-assist-production-assessment-preparation-board")
    && webSource.includes("data-production-assessment\", \"accepted_repository_local_no_go_blockers"),
  "apps/web/src/app.ts + apps/web/src/coreAssistCapabilityConsoleRenderer.ts"
);
check(
  "reviewed read-only candidate release evidence remains internally consistent",
  readOnlyReleaseCompleted,
  "PROJECT_STATE.yaml + docs/audit/READONLY-RELEASE-1.md"
);

const readOnlyReleaseEvidence = {
  classification: "historical_exact_version_only",
  currentRuntimeVerified: false,
  status: readOnlyReleaseCompleted ? "completed" : "invalid_or_missing",
  source: `${historicalStatePath} + docs/audit/READONLY-RELEASE-1.md`,
  releasedHeadSha,
  mergedMainSha,
  runtimeIdentity,
  runtimeReadOnly: stateValue(readOnlyReleaseBlock, "runtime_read_only") === "true",
  databaseReady: stateValue(readOnlyReleaseBlock, "database_ready") === "true",
  getOnlySmoke: readOnlyReleaseCompleted && getOnlySmokeVerified ? "verified_six_route_get_only" : "not_verified",
  databaseWriteDenial: stateValue(readOnlyReleaseBlock, "database_write_denial"),
  backupRestoreRollback: readOnlyReleaseCompleted && recoveryVerified ? "verified_isolated_no_network" : "not_verified",
  privatePreflightIngress: readOnlyReleaseCompleted && privatePreflightIngressVerified ? "verified" : "not_verified",
  publicCandidateIngress: readOnlyReleaseCompleted && publicCandidateIngressVerified ? "verified" : "not_verified",
  tlsHostnameValidation: tlsHostnameMismatchRecorded
    ? "known_mismatch_not_claimed"
    : "missing_evidence",
  productionStatus: "NO_GO",
  officialFactsMutated: readOnlyReleaseCompleted ? false : null,
  productionWriteRequestsSent: readOnlyReleaseCompleted ? false : null
};

const stagingReadinessSummary = [
  summaryRow({
    id: "repository_local_evidence",
    status: "available",
    source: "local validation, platform ledger, release evidence register, Web console",
    evidenceRequirement: "Keep local evidence visible and repeatable without claiming runtime proof.",
    ownerAuthorization: "none_for_repository_local",
    failureState: "server_error_or_missing_local_evidence_blocks"
  }),
  summaryRow({
    id: "historical_pre_release_evidence",
    status: "historical_not_current_release_proof",
    source: "docs/audit/PLATFORM-1-STAGING-READONLY-ENVIRONMENT-1.md",
    evidenceRequirement: "Historical staging notes remain context only; the reviewed release is represented separately by exact-head evidence.",
    ownerAuthorization: "none_for_context_only",
    failureState: "stale_or_source_mismatch_blocks"
  }),
  summaryRow({
    id: "reviewed_readonly_candidate_release",
    status: readOnlyReleaseCompleted ? "verified_exact_head_readonly_release" : "invalid_or_missing",
    source: `${historicalStatePath} and historical READONLY-RELEASE-1 evidence`,
    evidenceRequirement: "Keep the reviewed candidate release distinct from full-production promotion and never reuse it as write authority.",
    ownerAuthorization: "read_only_release_authorization_exercised_2026_07_14",
    failureState: readOnlyReleaseCompleted ? "none" : "release_evidence_inconsistent"
  }),
  summaryRow({
    id: "full_production_promotion",
    status: "blocked_production_NO_GO",
    source: "PROJECT_STATE active blocker and read-only release safety boundary",
    evidenceRequirement: "Authoritative live portfolio authority, hostname validation, official fact-source promotion, current review, and exact owner authorization remain required.",
    ownerAuthorization: "required_before_full_production_promotion",
    failureState: "production_NO_GO"
  }),
  summaryRow({
    id: "sync_capacity_evidence_collection",
    status: "not_run_requires_explicit_safe_configuration",
    source: "npm run sync-capacity-probe",
    evidenceRequirement: "This command collects new GET-only runtime evidence only with explicit SYNC_CAPACITY target, exact commit, and authorization configuration; it is not a local exact-head replay verifier.",
    ownerAuthorization: "required_with_explicit_safe_target_configuration",
    failureState: "missing_configuration_exits_2_before_http"
  })
];

const blockerMap = [
  blocker({
    id: "authoritative_live_portfolio_source",
    title: "Authoritative continuously current portfolio source",
    status: "blocked_no_approved_live_authority",
    source: "PROJECT_STATE blocker CORE-1B-LIVE-CURRENT-SOURCE",
    evidenceRequirement: "Approve source ownership, reconciliation, freshness, conflict handling, and rollback or keep portfolio omitted and Pingan historical-only.",
    ownerAuthorization: "separate_owner_authority_source_decision",
    failureState: "portfolio_omitted_pingan_historical_only"
  }),
  blocker({
    id: "tls_hostname_validation",
    title: "Certificate hostname validation",
    status: "known_mismatch_not_claimed",
    source: "READONLY-RELEASE-1",
    evidenceRequirement: "Resolve and validate the certificate hostname before any full-production promotion claim.",
    ownerAuthorization: "required_before_full_production_promotion",
    failureState: "hostname_mismatch"
  }),
  blocker({
    id: "ios_physical_device_journey",
    title: "iOS physical-device authentication and candidate journey",
    status: "owner_waived_nonblocking_failure",
    source: "Stage 15 reviewed evidence",
    evidenceRequirement: "Do not claim authentication, candidate-to-review journey, or screenshots passed; any retry requires a separate owner decision.",
    ownerAuthorization: "owner_waiver_recorded_retry_requires_separate_decision",
    failureState: "xctest_dtx_bootstrap_refused"
  }),
  blocker({
    id: "official_fact_source_promotion",
    title: "Official fact-source promotion",
    status: "not_authorized",
    source: "READONLY-RELEASE-1 safety boundary",
    evidenceRequirement: "The candidate release must not replace official portfolio, cash, fee, position, transaction, order, trade, fill, or review authority.",
    ownerAuthorization: "separate_owner_authorization_required",
    failureState: "candidate_readonly_only"
  }),
  blocker({
    id: "full_production_promotion",
    title: "Full-production promotion",
    status: "production_NO_GO",
    source: "PROJECT_STATE, READONLY-RELEASE-1, and Web console",
    evidenceRequirement: "Production cannot advance without resolving the remaining blockers, independent current review, and a separate exact owner authorization.",
    ownerAuthorization: "required_before_full_production_promotion",
    failureState: "full_production_not_authorized"
  })
];

const releaseChecklist = [
  checklistItem({
    id: "readonly_candidate_release_reviewed",
    status: readOnlyReleaseCompleted ? "completed_readonly_candidate_release" : "invalid_or_missing",
    evidence: "exact-head runtime, six-route GET-only smoke, SQLSTATE 25006 denial, backup, isolated restore, rollback, private ingress, review, and squash content equality",
    ownerAuthorization: "read_only_release_authorization_exercised_2026_07_14"
  }),
  checklistItem({
    id: "authoritative_live_portfolio_source",
    status: "blocked_no_approved_live_authority",
    evidence: "portfolio remains omitted and Pingan remains historical-only",
    ownerAuthorization: "separate_owner_authority_source_decision"
  }),
  checklistItem({
    id: "certificate_hostname_validation",
    status: "known_mismatch_not_claimed",
    evidence: "read-only release used explicit insecure TLS mode and did not claim hostname validation",
    ownerAuthorization: "required_before_full_production_promotion"
  }),
  checklistItem({
    id: "ios_physical_device_reviewed",
    status: "owner_waived_nonblocking_failure",
    evidence: "install and launch passed; authentication, candidate journey, and screenshots were not proven after the XCTest DTX bootstrap failure",
    ownerAuthorization: "owner_waiver_recorded_retry_requires_separate_decision"
  }),
  checklistItem({
    id: "full_production_promotion_authorization",
    status: "blocked_production_NO_GO",
    evidence: "the completed candidate read-only release does not authorize official fact-source promotion, broker access, or write enablement",
    ownerAuthorization: "required_before_full_production_promotion"
  })
];

const safety = {
  production_status: "NO_GO",
  real_trading: "NOT_USED",
  broker_write: "NOT_USED",
  official_portfolio_mutation: "NOT_USED",
  ios_physical_device: "OWNER_WAIVED_NONBLOCKING_FAILURE",
  ios_physical_device_success: "NOT_CLAIMED",
  codexpro_watcher_tasks: "FROZEN"
};

const releaseClassification = classifyReadOnlyReleaseStatus({
  assessmentAccepted,
  readOnlyReleaseCompleted
});

const result = {
  ok: localCheckBlockers.length === 0,
  okMeaning: localCheckBlockers.length === 0
    ? "Repository-local production assessment preparation is recorded; production remains NO_GO."
    : "Repository-local production assessment preparation checks failed.",
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
    writesProductionConfig: false,
    touchesBroker: false,
    mutatesOfficialPortfolio: false
  },
  evidenceScope: "historical_release_replay_not_current_runtime",
  currentRuntimeVerified: false,
  assessmentPrepared: true,
  assessmentAccepted,
  activeNextTask: assessmentActive
    ? "PRODUCTION-READINESS-ASSESSMENT-PREPARATION-1"
    : activeNextTask,
  assessmentReady: false,
  releaseReady: false,
  productionReady: false,
  productionStatus: "NO_GO",
  candidateReadOnlyReleaseCompleted: readOnlyReleaseCompleted,
  readOnlyReleaseEvidence,
  releaseChecklistStatus: releaseClassification.releaseChecklistStatus,
  productionPromotionStatus: "blocked_production_NO_GO",
  checks,
  localCheckBlockers,
  stagingReadinessSummary,
  blockerMap,
  blockers: blockerMap.filter((item) => item.status !== "available"),
  releaseChecklist,
  unresolvedBlockers: blockerMap.filter((item) => item.status !== "available"),
  unresolvedEvidence: blockerMap.filter((item) => item.status !== "available"),
  noWriteBoundary: {
    productionDbWrite: false,
    brokerWrite: false,
    officialPortfolioMutation: false,
    cashFeePositionMutation: false,
    orderTradeFillMutation: false,
    deployment: false,
    productionConfig: false,
    rollback: false,
    backup: false,
    ssh: false,
    http: false,
    externalDb: false,
    cloudflare: false,
    mcp: false,
    stageRunnerWatcher: false,
    aiBridge: false,
    autoMerge: false
  },
  safety,
  goNoGo: releaseClassification.goNoGo,
  notes: [
    releaseClassification.releaseSummaryNote,
    assessmentAccepted
      ? `The historical preparation task is accepted; current repository routing remains dynamic and currently resolves to ${activeNextTask ?? "missing"}.`
      : "The preparation task is still active and remains blocked/evaluability-only.",
    "It does not execute HTTP, SSH, database, rollback, backup, deployment, broker, physical-device, Cloudflare, MCP, watcher, .ai-bridge, or auto-merge work.",
    "releaseReady and productionReady describe full-production promotion and remain false; they do not erase the separately recorded completed candidate read-only release.",
    "npm run sync-capacity-probe is configuration-gated evidence collection that may run only with an explicit safe target, exact-commit, and authorization configuration; it is not a local replay verifier and missing configuration exits before HTTP without a pass claim."
  ]
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(result, null, 2));
}

export function classifyReadOnlyReleaseStatus({ assessmentAccepted, readOnlyReleaseCompleted }) {
  if (readOnlyReleaseCompleted === true) {
    return {
      releaseChecklistStatus: "readonly_candidate_completed_full_production_blocked",
      goNoGo: "readonly_candidate_release_completed_full_production_no_go",
      releaseSummaryNote: "This assessment distinguishes the completed reviewed read-only candidate release from full-production readiness, which remains NO_GO."
    };
  }
  return {
    releaseChecklistStatus: "readonly_candidate_release_evidence_invalid_full_production_blocked",
    goNoGo: assessmentAccepted === true
      ? "readonly_candidate_release_evidence_invalid_full_production_no_go"
      : "production_assessment_preparation_recorded_full_production_no_go",
    releaseSummaryNote: "Read-only candidate release evidence is invalid or missing; no completed release is claimed and full-production readiness remains NO_GO."
  };
}

function check(id, ok, evidence) {
  checks.push({ id, ok, evidence });
  if (!ok) {
    localCheckBlockers.push({ id, evidence });
  }
}

function summaryRow(row) {
  return row;
}

function blocker(row) {
  return {
    ...row,
    productionWrite: false,
    brokerWrite: false,
    officialPortfolioMutation: false,
    externalRuntimeAction: false
  };
}

function checklistItem(row) {
  return {
    ...row,
    canMarkGo: false,
    canMarkReady: false,
    canMerge: false
  };
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function stateValue(block, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return block.match(new RegExp(`^    ${escaped}:\\s*(\\S.*)$`, "m"))?.[1] ?? null;
}

function isSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}
