import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  CAPACITY_PROBE_METRIC,
  isRequiredCapacityMeasurement,
  requiredCapacityMeasurementLabels,
  validateCapacityProbe
} from "./async-capacity-evidence.mjs";
import {
  canonicalJsonBytes,
  REAL_DATA_QUANT_WITNESS_MAX_BYTES,
  REAL_DATA_QUANT_WITNESS_SCHEMA,
  validateRealDataQuantRunWitness
} from "./real-data-quant-witness.mjs";

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FORMAL_ACCOUNTING_BINDING_SCHEMA = "2026-07-19.real-data-formal-accounting-binding.v1";
const FORMAL_ACCOUNTING_PRICE_BASIS = Object.freeze({
  execution: "unadjusted_open",
  feeNotional: "unadjusted_trade_gross",
  signal: "adjusted_qfq_close",
  valuation: "unadjusted_close"
});
const GIT_EXECUTABLE = "/usr/bin/git";
const GIT_READONLY_ENV = Object.freeze(stageEvidenceGitReadonlyEnvironment());

export function stageEvidenceGitReadonlyEnvironment(repositoryRoot = process.cwd()) {
  return {
    PATH: "/usr/bin:/bin",
    HOME: resolve(repositoryRoot),
    LC_ALL: "C",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0"
  };
}

const CAPACITY_INHERITANCE_SAFE_FILES = new Set([
  "AGENTS.md",
  "CHANGELOG.md",
  "PROJECT_STATE.yaml",
  "QUALITY_GATES.yaml",
  "ROADMAP.yaml"
]);
const CAPACITY_INHERITANCE_SAFE_PREFIXES = [
  "artifacts/stage-13-20/",
  "docs/audit/",
  "docs/governance/",
  "tests/"
];
const STAGE_EVIDENCE_INHERITANCE_SAFE_FILES = new Set([
  "CHANGELOG.md",
  "PROJECT_STATE.yaml",
  "ROADMAP.yaml"
]);
const STAGE_EVIDENCE_INHERITANCE_SAFE_PREFIXES = [
  "docs/audit/",
  "docs/governance/",
  "tests/"
];

export const STAGE_IDS = [
  "PORTFOLIO-AUTHORITY-DECISION-1",
  "STAGING-EXACT-HEAD-1",
  "IOS-PHYSICAL-DEVICE-1",
  "PRODUCTION-GET-SMOKE-1",
  "READONLY-RELEASE-1",
  "CONTROLLED-PERSISTENCE-1",
  "REAL-DATA-QUANT-1",
  "ASYNC-CAPACITY-DECISION-1"
];

const STAGE_SECTION_KEYS = {
  "CONTROLLED-PERSISTENCE-1": "controlledPersistence",
  "REAL-DATA-QUANT-1": "realDataQuant",
  "ASYNC-CAPACITY-DECISION-1": "asyncCapacityDecision"
};

export function selectStageEvidenceSection(value, stageId) {
  if (value?.schemaVersion !== "2026-07-12.stage-13-20-evidence.v1") return value;
  const key = STAGE_SECTION_KEYS[stageId];
  return key ? value[key] : undefined;
}

export function verifyStage13To20Evidence(manifest, expectedCommitSha, options = {}) {
  const repositoryHistory = options.repositoryHistory ?? gitRepositoryHistory;
  const stages = {};
  stages[STAGE_IDS[0]] = portfolioDecision(manifest?.portfolioAuthority);
  stages[STAGE_IDS[1]] = stagingEvidence(manifest?.staging, expectedCommitSha);
  stages[STAGE_IDS[2]] = physicalDeviceEvidence(manifest?.iosPhysicalDevice, expectedCommitSha);
  stages[STAGE_IDS[3]] = productionGetEvidence(manifest?.productionGetSmoke, expectedCommitSha);
  stages[STAGE_IDS[4]] = releaseEvidence(manifest?.readOnlyRelease, expectedCommitSha, stages);
  stages[STAGE_IDS[5]] = persistenceEvidence(
    manifest?.controlledPersistence,
    expectedCommitSha,
    options.persistenceRepositoryHistory ?? repositoryHistory
  );
  stages[STAGE_IDS[6]] = realDataQuantEvidence(
    manifest?.realDataQuant,
    expectedCommitSha,
    options.realDataRepositoryHistory ?? repositoryHistory
  );
  stages[STAGE_IDS[7]] = capacityDecision(
    manifest?.asyncCapacityDecision,
    expectedCommitSha,
    options.capacityRepositoryHistory ?? repositoryHistory
  );

  const manifestFailures = verifyStage13To20Envelope(manifest, expectedCommitSha).failures;
  const complete = manifestFailures.length === 0 && Object.values(stages).every((stage) => stage.ok);
  return {
    ok: complete,
    expectedCommitSha,
    manifestFailures,
    stages,
    completedStages: STAGE_IDS.filter((id) => stages[id].ok),
    pendingStages: STAGE_IDS.filter((id) => stages[id].state === "pending"),
    blockedStages: STAGE_IDS.filter((id) => !stages[id].ok && stages[id].state !== "pending"),
    safety: {
      advisoryOnly: booleanOrNull(manifest?.safety?.advisoryOnly),
      realBrokerOrders: booleanOrNull(manifest?.safety?.realBrokerOrders),
      autoMerge: booleanOrNull(manifest?.safety?.autoMerge)
    }
  };
}

export function verifyStage13To20Envelope(manifest, expectedCommitSha) {
  const failures = [];
  if (manifest?.schemaVersion !== "2026-07-12.stage-13-20-evidence.v1") failures.push("schema version");
  if (!SHA_PATTERN.test(expectedCommitSha) || manifest?.commitSha !== expectedCommitSha) failures.push("manifest exact commit");
  if (manifest?.safety?.advisoryOnly !== true) failures.push("advisory-only safety boundary");
  if (manifest?.safety?.realBrokerOrders !== false) failures.push("real broker orders disabled");
  if (manifest?.safety?.autoMerge !== false) failures.push("auto-merge disabled");
  return { ok: failures.length === 0, expectedCommitSha, failures };
}

function portfolioDecision(value) {
  const failures = [];
  const omitted = value?.decision === "portfolio_omitted";
  check(failures, "explicit authority decision", omitted || value?.decision === "approved_authoritative_source");
  if (omitted) {
    check(failures, "portfolio remains omitted", value?.portfolioPresentation === "omitted");
    check(failures, "Pingan remains historical-only", value?.pinganAuthority === "historical_only");
    check(failures, "risk impact remains blocked", value?.riskImpact === "blocked_without_authoritative_source");
  } else {
    for (const field of ["ownership", "authorization", "reconciliation", "freshness", "conflict", "rollback"]) {
      check(failures, `authoritative source ${field} evidence`, value?.evidence?.[field] === "verified");
    }
  }
  return result(failures, omitted ? "portfolio_omitted_pingan_historical_only" : "authoritative_source_approved");
}

function stagingEvidence(value, commitSha) {
  const failures = [];
  bindCommit(failures, value, commitSha);
  check(failures, "staging evidence artifacts", verifyArtifacts(value?.artifacts));
  check(failures, "staging identity", nonPlaceholder(value?.identity));
  check(failures, "private ingress", value?.privateIngress?.verified === true);
  check(failures, "GET-only smoke", onlySuccessfulGets(value?.requests) && requiredReadKinds(value?.requests));
  check(failures, "database write denial", value?.database?.writeDenied === true && value?.database?.mutated === false);
  check(failures, "backup checksum", SHA256_PATTERN.test(value?.backup?.sha256 ?? "")
    && value?.artifacts?.some((artifact) => artifact.sha256 === value.backup.sha256));
  check(failures, "isolated restore", value?.restore?.status === "passed" && value?.restore?.target === "isolated_non_production");
  check(failures, "isolated rollback", value?.rollback?.status === "passed" && value?.rollback?.target === "isolated_non_production");
  check(failures, "correlation observability", value?.observability?.correlationIdsVerified === true);
  return result(failures, "staging_exact_head_verified");
}

function physicalDeviceEvidence(value, commitSha) {
  const failures = [];
  bindCommit(failures, value, commitSha);
  check(failures, "physical device evidence artifacts", verifyArtifacts(value?.artifacts));
  check(failures, "physical-device authorization", value?.authorized === true);
  check(failures, "physical device identity", nonPlaceholder(value?.device?.model) && nonPlaceholder(value?.device?.osVersion));
  const ownerWaivedFailure = value?.ownerWaiver?.authorized === true
    && value?.ownerWaiver?.decision === "accept_recorded_nonblocking_failure";
  if (ownerWaivedFailure) {
    check(failures, "physical device build/install reached runner", value?.checks?.install === "passed" && value?.checks?.launch === "passed");
    check(failures, "physical device failure not reported as passed",
      value?.checks?.authentication !== "passed" && value?.checks?.candidateToReviewJourney !== "passed"
      && value?.ownerWaiver?.testPassed === false);
    check(failures, "physical device failure recorded",
      nonPlaceholder(value?.failure?.category) && Number.isInteger(value?.failure?.runnerExitCode));
    check(failures, "physical device screenshots not fabricated",
      Array.isArray(value?.screenshots) && value.screenshots.length === 0 && value?.ownerWaiver?.screenshotsClaimed === false);
    check(failures, "no sensitive device logs", value?.sensitiveLogsFound === false);
    return result(failures, "ios_physical_device_owner_waived_nonblocking_failure");
  }
  for (const field of ["install", "launch", "authentication", "candidateToReviewJourney"]) {
    check(failures, `physical device ${field}`, value?.checks?.[field] === "passed");
  }
  check(failures, "physical device screenshots", Array.isArray(value?.screenshots) && value.screenshots.length > 0
    && value.screenshots.every((sha256) => value?.artifacts?.some((artifact) => artifact.sha256 === sha256)));
  check(failures, "no sensitive device logs", value?.sensitiveLogsFound === false);
  return result(failures, "ios_physical_device_verified");
}

function productionGetEvidence(value, commitSha) {
  const failures = [];
  bindCommit(failures, value, commitSha);
  check(failures, "production evidence artifacts", verifyArtifacts(value?.artifacts));
  check(failures, "production GET authorization", value?.authorized === true);
  check(failures, "production runtime identity", nonPlaceholder(value?.identity));
  check(failures, "production GET-only success", onlySuccessfulGets(value?.requests) && requiredReadKinds(value?.requests));
  check(failures, "production no-write boundary", productionWriteBoundaryVerified(value));
  check(failures, "production facts unchanged", value?.officialFactsMutated === false);
  return result(failures, "production_get_only_verified");
}

function releaseEvidence(value, commitSha, stages) {
  const failures = [];
  bindCommit(failures, value, commitSha);
  check(failures, "release evidence artifacts", verifyArtifacts(value?.artifacts));
  check(failures, "rollback ready", value?.rollbackReady === true);
  check(failures, "broker and official writes disabled", value?.brokerWritesEnabled === false && value?.officialFactWritesEnabled === false);
  for (const prerequisite of STAGE_IDS.slice(0, 4)) check(failures, `release prerequisite ${prerequisite}`, stages[prerequisite].ok);

  if (value?.ownerAuthorization === "not_authorized") {
    const prePullRequestEvidence = value?.review?.p1 === null
      && value?.review?.p2 === null
      && value?.ci?.exactHead === "not_run_no_pr"
      && value?.ci?.nodeChecks === "local_passed"
      && value?.ci?.riskScan === "local_passed";
    const postPullRequestEvidence = [null, 0].includes(value?.review?.p1)
      && [null, 0].includes(value?.review?.p2)
      && value?.ci?.exactHead === "passed"
      && value?.ci?.nodeChecks === "passed"
      && value?.ci?.riskScan === "passed";
    check(failures, "release remains unperformed", value?.cutoverPerformed === false);
    check(failures, "pending release CI and review state", prePullRequestEvidence || postPullRequestEvidence);
    if (failures.length === 0) {
      return {
        ok: false,
        state: "pending",
        decision: "pending_owner_release_authorization",
        failures: ["exact owner release authorization"]
      };
    }
    return result(failures, "readonly_release_preparation_invalid");
  }

  check(failures, "exact owner release authorization", value?.ownerAuthorization === "authorized_readonly_release");
  check(failures, "no P1 or P2", value?.review?.p1 === 0 && value?.review?.p2 === 0);
  check(failures, "CI exact head", value?.ci?.exactHead === "passed" && value?.ci?.nodeChecks === "passed" && value?.ci?.riskScan === "passed");
  check(failures, "read-only release cutover", value?.cutoverPerformed === true);
  return result(failures, "readonly_release_authorized");
}

function persistenceEvidence(value, commitSha, repositoryHistory = gitRepositoryHistory) {
  const failures = [];
  bindCommit(failures, value, commitSha);
  check(failures, "persistence evidence artifacts", verifyArtifacts(value?.artifacts));
  const required = ["candidate", "research", "review"];
  check(failures, "exact controlled-persistence lane set", exactPersistenceLanes(value?.lanes, required));
  for (const lane of required) {
    const evidence = value?.lanes?.find((item) => item?.id === lane);
    check(failures, `${lane} separate authorization`, evidence?.authorized === true);
    check(failures, `${lane} evidence artifacts`, verifyArtifacts(evidence?.artifacts));
    for (const field of ["permission", "idempotency", "audit", "backup", "recovery", "revocation", "productionSmoke"]) {
      check(failures, `${lane} ${field}`, evidence?.[field] === "passed");
    }
  }
  check(failures, "controlled-persistence inheritance", persistenceInheritanceVerified(value, commitSha, repositoryHistory));
  check(failures, "persistence lanes opened independently", value?.bulkEnablement === false);
  check(failures, "portfolio and broker writes remain disabled", value?.portfolioWritesEnabled === false && value?.brokerWritesEnabled === false);
  return result(failures, "controlled_persistence_verified");
}

function exactPersistenceLanes(lanes, required) {
  if (!Array.isArray(lanes) || lanes.length !== required.length) return false;
  const ids = lanes.map((lane) => lane?.id);
  return new Set(ids).size === required.length && required.every((id) => ids.includes(id));
}

function persistenceInheritanceVerified(value, expectedCommitSha, repositoryHistory) {
  if (!hasExactKeys(value, [
    "artifacts",
    "brokerWritesEnabled",
    "bulkEnablement",
    "commitSha",
    "lanes",
    "portfolioWritesEnabled"
  ])
    || value.commitSha !== expectedCommitSha
    || !Array.isArray(value.artifacts)
    || value.artifacts.length !== 1
    || !Array.isArray(value.lanes)) return false;
  if (!value.lanes.every((lane) => hasExactKeys(lane, [
    "artifacts",
    "audit",
    "authorized",
    "backup",
    "id",
    "idempotency",
    "permission",
    "productionSmoke",
    "recovery",
    "revocation"
  ]) && isDeepStrictEqual(lane.artifacts, value.artifacts))) return false;

  const currentInheritanceArtifact = value.artifacts[0];
  const currentInheritance = parseVerifiedArtifact(currentInheritanceArtifact);
  if (!hasExactKeys(currentInheritance, [
    "changedPaths",
    "commitSha",
    "evidenceCommitSha",
    "executionRerun",
    "reason",
    "safety",
    "schemaVersion",
    "sourceCommitSha",
    "sourceSectionPath",
    "sourceSectionSha256"
  ])
    || currentInheritance.schemaVersion !== "2026-07-15.controlled-persistence-inheritance.v2"
    || currentInheritance.commitSha !== expectedCommitSha
    || !SHA_PATTERN.test(currentInheritance.sourceCommitSha ?? "")
    || !SHA_PATTERN.test(currentInheritance.evidenceCommitSha ?? "")
    || new Set([
      currentInheritance.sourceCommitSha,
      currentInheritance.evidenceCommitSha,
      expectedCommitSha
    ]).size !== 3
    || !Array.isArray(currentInheritance.changedPaths)
    || currentInheritance.changedPaths.length === 0
    || new Set(currentInheritance.changedPaths).size !== currentInheritance.changedPaths.length
    || !currentInheritance.changedPaths.every(isControlledPersistenceInheritanceSafePath)
    || currentInheritance.executionRerun !== false
    || !nonPlaceholder(currentInheritance.reason)
    || !hasExactKeys(currentInheritance.safety, [
      "brokerWritesEnabled",
      "portfolioWritesEnabled",
      "productionWritesSent",
      "secretsPrinted",
      "writeLanesEnabledForRelease"
    ])
    || Object.values(currentInheritance.safety).some((item) => item !== false)) return false;

  const sourceSectionArtifact = {
    path: currentInheritance.sourceSectionPath,
    sha256: currentInheritance.sourceSectionSha256
  };
  const sourceSection = parseVerifiedArtifact(sourceSectionArtifact);
  if (!hasExactKeys(sourceSection, [
    "artifacts",
    "brokerWritesEnabled",
    "bulkEnablement",
    "commitSha",
    "lanes",
    "portfolioWritesEnabled"
  ])
    || sourceSection.commitSha !== currentInheritance.sourceCommitSha
    || !verifyArtifacts(sourceSection.artifacts)
    || !exactArtifactReferences(sourceSection.artifacts)
    || !exactPersistenceLanes(sourceSection.lanes, ["candidate", "research", "review"])
    || !sourceSection.lanes.every((lane) => hasExactKeys(lane, [
      "artifacts",
      "audit",
      "authorized",
      "backup",
      "id",
      "idempotency",
      "permission",
      "productionSmoke",
      "recovery",
      "revocation"
    ]) && verifyArtifacts(lane.artifacts)
      && exactArtifactReferences(lane.artifacts)
      && isDeepStrictEqual(lane.artifacts, sourceSection.artifacts))
    || !controlledPersistenceProofVerified(sourceSection, currentInheritance.sourceCommitSha)
    || sourceSection.bulkEnablement !== value.bulkEnablement
    || sourceSection.portfolioWritesEnabled !== value.portfolioWritesEnabled
    || sourceSection.brokerWritesEnabled !== value.brokerWritesEnabled) return false;

  if (!isDeepStrictEqual(
    sourceSection.lanes.map(persistenceLaneClaim).sort(compareLaneClaims),
    value.lanes.map(persistenceLaneClaim).sort(compareLaneClaims)
  )) return false;

  return persistenceRepositoryHistoryVerified({
    currentInheritance,
    expectedCommitSha,
    repositoryHistory,
    sourceSection,
    sourceSectionArtifact
  });
}

function persistenceRepositoryHistoryVerified({
  currentInheritance,
  expectedCommitSha,
  repositoryHistory,
  sourceSection,
  sourceSectionArtifact
}) {
  const sourceSectionBytes = verifiedArtifactBytes(sourceSectionArtifact);
  const leafArtifacts = uniqueArtifacts([
    ...sourceSection.artifacts,
    ...sourceSection.lanes.flatMap((lane) => lane.artifacts)
  ]);
  const requiredPaths = [sourceSectionArtifact.path, ...leafArtifacts.map((artifact) => artifact.path)];
  if (sourceSectionBytes === null
    || !leafArtifacts.every((artifact) => verifiedArtifactBytes(artifact) !== null)
    || !requiredPaths.every((path) => currentInheritance.changedPaths.includes(path))) return false;

  try {
    if (repositoryHistory.isAncestor(currentInheritance.sourceCommitSha, currentInheritance.evidenceCommitSha) !== true
      || repositoryHistory.isAncestor(currentInheritance.evidenceCommitSha, expectedCommitSha) !== true
      || !bytesEqual(repositoryHistory.fileBytesAtCommit(
        currentInheritance.evidenceCommitSha,
        sourceSectionArtifact.path
      ), sourceSectionBytes)
      || !bytesEqual(repositoryHistory.fileBytesAtCommit(
        expectedCommitSha,
        sourceSectionArtifact.path
      ), sourceSectionBytes)
      || !artifactsMatchRepositoryHistory(
        leafArtifacts,
        currentInheritance.evidenceCommitSha,
        expectedCommitSha,
        repositoryHistory
      )) return false;

    const sourceToEvidencePaths = repositoryHistory.changedPaths(
      currentInheritance.sourceCommitSha,
      currentInheritance.evidenceCommitSha
    );
    const evidenceToTargetPaths = repositoryHistory.changedPaths(
      currentInheritance.evidenceCommitSha,
      expectedCommitSha
    );
    const actualChangedPaths = uniqueStrings([...sourceToEvidencePaths, ...evidenceToTargetPaths]);
    return exactChangedPaths(
      actualChangedPaths,
      currentInheritance.changedPaths,
      isControlledPersistenceInheritanceSafePath
    );
  } catch {
    return false;
  }
}

function persistenceLaneClaim(lane) {
  return {
    id: lane?.id,
    authorized: lane?.authorized,
    permission: lane?.permission,
    idempotency: lane?.idempotency,
    audit: lane?.audit,
    backup: lane?.backup,
    recovery: lane?.recovery,
    revocation: lane?.revocation,
    productionSmoke: lane?.productionSmoke
  };
}

function compareLaneClaims(left, right) {
  return String(left.id).localeCompare(String(right.id));
}

function controlledPersistenceProofVerified(sourceSection, sourceCommitSha) {
  if (!Array.isArray(sourceSection?.artifacts) || sourceSection.artifacts.length !== 1) return false;
  const proof = parseVerifiedArtifact(sourceSection.artifacts[0]);
  if (!hasExactKeys(proof, [
    "commitSha",
    "environment",
    "lanes",
    "safety",
    "schemaVersion"
  ])
    || proof.schemaVersion !== "2026-07-15.controlled-persistence-proof.v1"
    || proof.commitSha !== sourceCommitSha
    || proof.environment !== "isolated_staging_with_get_only_production_smoke"
    || !exactPersistenceProofLanes(proof.lanes)
    || !hasExactKeys(proof.safety, [
      "brokerWritesSent",
      "officialFactsMutated",
      "portfolioWritesSent",
      "productionHttpWriteRequestsSent",
      "secretsPrinted"
    ])
    || Object.values(proof.safety).some((value) => value !== false)) return false;

  const proofClaims = proof.lanes.map((lane) => ({
    id: lane.id,
    authorized: lane.authorized,
    ...Object.fromEntries(Object.keys(lane.checks).map((check) => [check, lane.checks[check].status]))
  })).sort(compareLaneClaims);
  return isDeepStrictEqual(
    proofClaims,
    sourceSection.lanes.map(persistenceLaneClaim).sort(compareLaneClaims)
  );
}

function exactPersistenceProofLanes(lanes) {
  const requiredLanes = ["candidate", "research", "review"];
  const requiredChecks = ["permission", "idempotency", "audit", "backup", "recovery", "revocation", "productionSmoke"];
  if (!Array.isArray(lanes) || lanes.length !== requiredLanes.length) return false;
  if (new Set(lanes.map((lane) => lane?.id)).size !== requiredLanes.length
    || !requiredLanes.every((id) => lanes.some((lane) => lane?.id === id))) return false;
  return lanes.every((lane) => hasExactKeys(lane, ["authorized", "checks", "id"])
    && lane.authorized === true
    && hasExactKeys(lane.checks, requiredChecks)
    && requiredChecks.every((check) => hasExactKeys(lane.checks[check], [
      "assertionCount",
      "exitCode",
      "failures",
      "status"
    ])
      && lane.checks[check].status === "passed"
      && lane.checks[check].exitCode === 0
      && Number.isInteger(lane.checks[check].assertionCount)
      && lane.checks[check].assertionCount > 0
      && lane.checks[check].failures === 0));
}

function realDataQuantEvidence(value, commitSha, repositoryHistory = gitRepositoryHistory) {
  const failures = [];
  bindCommit(failures, value, commitSha);
  check(failures, "real-data quant evidence artifacts", verifyArtifacts(value?.artifacts));
  check(failures, "historical-only research authority", realDataHistoricalAuthorityVerified(value, commitSha, repositoryHistory));
  check(failures, "approved real historical source", value?.source?.approved === true && value?.source?.fixture === false
    && nonPlaceholder(value?.source?.provenance) && nonPlaceholder(value?.source?.authorizationId));
  check(failures, "real-data research identity", nonPlaceholder(value?.source?.universeVersion)
    && validTimestamp(value?.source?.dataCutoff) && ["none", "forward", "backward"].includes(value?.source?.adjustmentMode));
  check(failures, "real historical source artifact", verifyArtifacts(value?.source?.artifacts));
  check(failures, "content-addressed snapshot", SHA256_PATTERN.test(value?.snapshot?.sha256 ?? "") && nonPlaceholder(value?.snapshot?.id));
  check(failures, "snapshot artifact", verifyArtifacts(value?.snapshot?.artifacts)
    && value.snapshot.artifacts.some((artifact) => artifact.sha256 === value.snapshot.sha256));
  check(failures, "independently reproducible run witness", value?.runWitness?.schemaVersion === REAL_DATA_QUANT_WITNESS_SCHEMA
    && SHA256_PATTERN.test(value?.runWitness?.sha256 ?? "")
    && verifyArtifacts(value?.runWitness?.artifacts, REAL_DATA_QUANT_WITNESS_MAX_BYTES)
    && value.runWitness.artifacts.some((artifact) => artifact.sha256 === value.runWitness.sha256));
  check(failures, "sample split frozen", value?.sampleSplit?.frozenBeforeFinalTest === true && value?.sampleSplit?.overlap === false);
  check(failures, "non-zero costs", Number.isFinite(value?.costs?.total) && value.costs.total > 0);
  check(failures, "formal accounting dual-source binding",
    realDataFormalAccountingClaimValid(value?.formalAccounting, value?.source, value?.snapshot));
  check(failures, "concentration reported", ["trade", "security", "month"].every((key) => value?.concentration?.[key] === "reported"));
  check(failures, "failed experiments retained", Number.isInteger(value?.failedExperiments) && value.failedExperiments > 0);
  check(failures, "no fixture performance claim", value?.fixturePerformanceClaimed === false);
  return result(failures, "real_data_quant_verified");
}

function realDataHistoricalAuthorityVerified(value, expectedCommitSha, repositoryHistory) {
  if (!hasExactKeys(value, [
    "artifacts",
    "commitSha",
    "concentration",
    "costs",
    "failedExperiments",
    "fixturePerformanceClaimed",
    "formalAccounting",
    "inheritance",
    "runWitness",
    "sampleSplit",
    "snapshot",
    "source"
  ])
    || value.commitSha !== expectedCommitSha
    || !Array.isArray(value.artifacts)
    || !hasExactKeys(value.source, [
    "adjustmentMode",
    "approved",
    "artifacts",
    "authorizationId",
    "dataCutoff",
    "fixture",
    "provenance",
    "universeVersion"
  ])) return false;

  const inheritance = value.inheritance;
  if (!hasExactKeys(inheritance, [
    "approvedHistoricalInputChanged",
    "authority",
    "changedPaths",
    "commitSha",
    "contentHashesReverified",
    "currentQuantPipelinesPassed",
    "evidenceCommitSha",
    "fixturePerformanceClaimed",
    "reason",
    "schemaVersion",
    "sourceCommitSha",
    "sourceSectionPath",
    "sourceSectionSha256"
  ])
    || inheritance.schemaVersion !== "2026-07-15.real-data-quant-inheritance.v2"
    || inheritance.commitSha !== expectedCommitSha
    || !SHA_PATTERN.test(inheritance.sourceCommitSha ?? "")
    || !SHA_PATTERN.test(inheritance.evidenceCommitSha ?? "")
    || new Set([
      inheritance.sourceCommitSha,
      inheritance.evidenceCommitSha,
      expectedCommitSha
    ]).size !== 3
    || !Array.isArray(inheritance.changedPaths)
    || inheritance.changedPaths.length === 0
    || new Set(inheritance.changedPaths).size !== inheritance.changedPaths.length
    || !inheritance.changedPaths.every(isRealDataInheritanceSafePath)
    || inheritance.contentHashesReverified !== true
    || inheritance.currentQuantPipelinesPassed !== true
    || inheritance.approvedHistoricalInputChanged !== false
    || inheritance.fixturePerformanceClaimed !== false
    || inheritance.authority !== "research_only_historical_only"
    || !nonPlaceholder(inheritance.reason)) return false;

  const sourceSectionArtifact = {
    path: inheritance.sourceSectionPath,
    sha256: inheritance.sourceSectionSha256
  };
  const sourceSection = parseVerifiedCanonicalArtifact(sourceSectionArtifact);
  const sourceSectionKeys = [
    "artifacts",
    "commitSha",
    "concentration",
    "costs",
    "failedExperiments",
    "fixturePerformanceClaimed",
    "formalAccounting",
    "runWitness",
    "sampleSplit",
    "snapshot",
    "source"
  ];
  if (!hasExactKeys(sourceSection, sourceSectionKeys)
    || sourceSection.commitSha !== inheritance.sourceCommitSha
    || !realDataArtifactPath(sourceSectionArtifact.path)
    || !value.artifacts.every((artifact) => realDataArtifactPath(artifact?.path))
    || !verifyArtifacts(sourceSection.artifacts)
    || !realDataClaimSchemasValid(sourceSection)
    || !realDataQuantProofVerified(sourceSection, inheritance.sourceCommitSha, repositoryHistory)
    || !isDeepStrictEqual(realDataClaims(sourceSection), realDataClaims(value))) return false;

  const inheritedArtifactReference = value.artifacts.find((artifact) =>
    parseVerifiedCanonicalArtifact(artifact)?.schemaVersion === "2026-07-15.real-data-quant-inheritance.v2");
  const inheritedArtifact = parseVerifiedCanonicalArtifact(inheritedArtifactReference);
  if (!isDeepStrictEqual(inheritedArtifact, inheritance)) return false;

  const currentEvidenceArtifacts = value.artifacts.filter((artifact) =>
    !isDeepStrictEqual(artifact, inheritedArtifactReference));
  if (!isDeepStrictEqual(sourceSection.artifacts, currentEvidenceArtifacts)
    || !realDataRepositoryHistoryVerified({
      expectedCommitSha,
      inheritance,
      inheritanceArtifact: inheritedArtifactReference,
      repositoryHistory,
      sourceSection,
      sourceSectionArtifact
    })) return false;

  const sourceIdentity = `${value.source.provenance} ${value.source.authorizationId}`.toLowerCase();
  return sourceIdentity.includes("pingan")
    && /histor(?:y|ical)/.test(sourceIdentity)
    && !/(?:^|[_ -])(?:live|broker|official)(?:[_ -]|$)/.test(sourceIdentity)
    && !/(?:current[_ -]?(?:holdings?|portfolio)|account[_ -]?truth)/.test(sourceIdentity);
}

function realDataQuantProofVerified(sourceSection, sourceCommitSha, repositoryHistory) {
  if (!Array.isArray(sourceSection?.artifacts) || sourceSection.artifacts.length !== 1) return false;
  const proof = parseVerifiedCanonicalArtifact(sourceSection.artifacts[0]);
  if (!hasExactKeys(proof, [
    "authority",
    "commitSha",
    "concentration",
    "costs",
    "failedExperiments",
    "fixturePerformanceClaimed",
    "formalAccounting",
    "pipeline",
    "runWitness",
    "sampleSplit",
    "schemaVersion",
    "snapshot",
    "source"
  ])
    || proof.schemaVersion !== "2026-07-19.real-data-quant-proof.v3"
    || proof.commitSha !== sourceCommitSha
    || proof.authority !== "research_only_historical_only"
    || !hasExactKeys(proof.pipeline, [
      "boardLotRounding",
      "buildInputHash",
      "cashPositionReconciled",
      "deterministicRerun",
      "exitCode",
      "finalTestUsedForTuning",
      "nextTradingDayExecution",
      "nonZeroCosts",
      "sameBarFill",
      "suspensionZeroVolumeHandling"
    ])
    || proof.pipeline.exitCode !== 0
    || proof.pipeline.deterministicRerun !== true
    || proof.pipeline.finalTestUsedForTuning !== false
    || proof.pipeline.nextTradingDayExecution !== true
    || proof.pipeline.sameBarFill !== false
    || proof.pipeline.nonZeroCosts !== true
    || proof.pipeline.boardLotRounding !== true
    || proof.pipeline.suspensionZeroVolumeHandling !== true
    || proof.pipeline.cashPositionReconciled !== true
    || !realDataClaimSchemasValid(proof)
    || !isDeepStrictEqual(realDataClaims(proof), realDataClaims(sourceSection))) return false;

  if (proof.source.artifacts.length !== 1
    || proof.snapshot.artifacts.length !== 1
    || proof.runWitness.artifacts.length !== 1
    || !isDeepStrictEqual(proof.source.artifacts, sourceSection.source.artifacts)
    || !isDeepStrictEqual(proof.snapshot.artifacts, sourceSection.snapshot.artifacts)
    || !isDeepStrictEqual(proof.runWitness.artifacts, sourceSection.runWitness.artifacts)) return false;
  const source = parseVerifiedCanonicalArtifact(proof.source.artifacts[0]);
  const snapshot = parseVerifiedCanonicalArtifact(proof.snapshot.artifacts[0]);
  const witnessArtifact = proof.runWitness.artifacts[0];
  const witnessBytes = verifiedArtifactBytes(witnessArtifact, REAL_DATA_QUANT_WITNESS_MAX_BYTES);
  const witness = parseVerifiedCanonicalArtifact(witnessArtifact, REAL_DATA_QUANT_WITNESS_MAX_BYTES);
  if (!source || !snapshot || !witness || witnessBytes === null
    || !realDataArtifactPath(sourceSection.artifacts[0]?.path)
    || !realDataArtifactPath(proof.source.artifacts[0]?.path)
    || !realDataArtifactPath(proof.snapshot.artifacts[0]?.path)
    || !realDataArtifactPath(witnessArtifact.path)) return false;
  try {
    const derived = validateRealDataQuantRunWitness({
      witness,
      witnessBytes,
      sourceCommitSha,
      historicalSource: source,
      snapshot,
      sourceFileBytes: (path) => repositoryHistory.fileBytesAtCommit(sourceCommitSha, path)
    });
    return isDeepStrictEqual(proof.formalAccounting, witness.formalAccounting)
      && realDataFormalAccountingMatchesSnapshot(proof.formalAccounting, source, snapshot)
      && proof.pipeline.buildInputHash === derived.buildInputHash
      && proof.snapshot.id === derived.snapshotId
      && proof.costs.total === derived.totalCosts
      && proof.failedExperiments === derived.failedExperimentCount
      && proof.formalAccounting.accountingSnapshot.snapshotId === derived.accountingSnapshotId
      && proof.formalAccounting.accountingSnapshot.dataHash === derived.accountingDataHash
      && proof.formalAccounting.corporateActionCoverage.ledgerId === derived.corporateActionLedgerId
      && proof.formalAccounting.corporateActionCoverage.ledgerHash === derived.corporateActionLedgerHash;
  } catch {
    return false;
  }
}

function realDataClaimSchemasValid(value) {
  return hasExactKeys(value?.source, [
    "adjustmentMode",
    "approved",
    "artifacts",
    "authorizationId",
    "dataCutoff",
    "fixture",
    "provenance",
    "universeVersion"
  ])
    && value.source.approved === true
    && value.source.fixture === false
    && exactArtifactReferences(value.source.artifacts)
    && nonPlaceholder(value.source.provenance)
    && nonPlaceholder(value.source.authorizationId)
    && nonPlaceholder(value.source.universeVersion)
    && validTimestamp(value.source.dataCutoff)
    && ["none", "forward", "backward"].includes(value.source.adjustmentMode)
    && hasExactKeys(value?.snapshot, ["artifacts", "id", "sha256"])
    && nonPlaceholder(value.snapshot.id)
    && SHA256_PATTERN.test(value.snapshot.sha256 ?? "")
    && exactArtifactReferences(value.snapshot.artifacts)
    && value.snapshot.artifacts.some((artifact) => artifact.sha256 === value.snapshot.sha256)
    && hasExactKeys(value?.runWitness, ["artifacts", "schemaVersion", "sha256"])
    && value.runWitness.schemaVersion === REAL_DATA_QUANT_WITNESS_SCHEMA
    && SHA256_PATTERN.test(value.runWitness.sha256 ?? "")
    && exactArtifactReferences(value.runWitness.artifacts)
    && value.runWitness.artifacts.some((artifact) => artifact.sha256 === value.runWitness.sha256)
    && hasExactKeys(value?.sampleSplit, ["frozenBeforeFinalTest", "overlap"])
    && value.sampleSplit.frozenBeforeFinalTest === true
    && value.sampleSplit.overlap === false
    && hasExactKeys(value?.costs, ["total"])
    && Number.isFinite(value.costs.total)
    && value.costs.total > 0
    && realDataFormalAccountingClaimValid(value?.formalAccounting, value.source, value.snapshot)
    && hasExactKeys(value?.concentration, ["month", "security", "trade"])
    && ["trade", "security", "month"].every((key) => value.concentration[key] === "reported")
    && Number.isInteger(value?.failedExperiments)
    && value.failedExperiments > 0
    && value?.fixturePerformanceClaimed === false;
}

function exactArtifactReferences(artifacts) {
  return Array.isArray(artifacts)
    && artifacts.length > 0
    && artifacts.every((artifact) => hasExactKeys(artifact, ["path", "sha256"])
      && typeof artifact.path === "string"
      && SHA256_PATTERN.test(artifact.sha256 ?? ""));
}

function realDataClaims(value) {
  return {
    concentration: value?.concentration,
    costs: value?.costs,
    failedExperiments: value?.failedExperiments,
    fixturePerformanceClaimed: value?.fixturePerformanceClaimed,
    formalAccounting: value?.formalAccounting,
    runWitness: value?.runWitness,
    sampleSplit: value?.sampleSplit,
    snapshot: value?.snapshot,
    source: value?.source
  };
}

function realDataFormalAccountingClaimValid(binding, source, snapshot) {
  if (!hasExactKeys(binding, [
    "accountingSnapshot",
    "blockers",
    "corporateActionCoverage",
    "priceBasis",
    "schemaVersion",
    "signalSnapshot",
    "status"
  ])
    || binding.schemaVersion !== FORMAL_ACCOUNTING_BINDING_SCHEMA
    || binding.status !== "verified"
    || !Array.isArray(binding.blockers)
    || binding.blockers.length !== 0
    || source?.adjustmentMode !== "forward") return false;

  const signal = binding.signalSnapshot;
  const accounting = binding.accountingSnapshot;
  const corporateActions = binding.corporateActionCoverage;
  const coverage = corporateActions?.coverage;
  if (!hasExactKeys(signal, ["adjustmentMode", "dataHash", "path", "sha256", "snapshotId"])
    || !hasExactKeys(accounting, [
      "adjustmentMode",
      "authorizationId",
      "dataCutoff",
      "dataHash",
      "dateRange",
      "path",
      "sha256",
      "snapshotId",
      "universeVersion"
    ])
    || !hasExactKeys(corporateActions, [
      "authorizationId",
      "coverage",
      "dataCutoff",
      "ledgerHash",
      "ledgerId",
      "path",
      "sha256",
      "universeVersion"
    ])
    || !hasExactKeys(coverage, [
      "complete",
      "coveredTradingDates",
      "dateRange",
      "eventCount",
      "universe",
      "zeroEventCoverageDeclared"
    ])
    || !hasExactKeys(binding.priceBasis, ["execution", "feeNotional", "signal", "valuation"])) {
    return false;
  }

  return signal.adjustmentMode === "forward"
    && snapshot?.id === signal.snapshotId
    && approvedFormalDataPath(signal.path, /qfq/i)
    && approvedFormalDataPath(accounting.path, /(?:raw|unadjusted|au[-_]?none)/i)
    && approvedFormalDataPath(corporateActions.path, /corporate[-_]?actions?/i)
    && new Set([signal.path, accounting.path, corporateActions.path]).size === 3
    && [signal.sha256, signal.dataHash, accounting.sha256, accounting.dataHash,
      corporateActions.sha256, corporateActions.ledgerHash].every((value) => SHA256_PATTERN.test(value ?? ""))
    && signal.sha256 !== accounting.sha256
    && signal.dataHash !== accounting.dataHash
    && accounting.adjustmentMode === "none"
    && nonPlaceholder(accounting.snapshotId)
    && nonPlaceholder(accounting.authorizationId)
    && nonPlaceholder(corporateActions.authorizationId)
    && nonPlaceholder(corporateActions.ledgerId)
    && nonPlaceholder(accounting.universeVersion)
    && accounting.universeVersion === corporateActions.universeVersion
    && accounting.universeVersion === source?.universeVersion
    && accounting.dataCutoff === corporateActions.dataCutoff
    && accounting.dataCutoff === source?.dataCutoff
    && validHistoricalTimestamp(accounting.dataCutoff)
    && exactDateRange(accounting.dateRange)
    && isDeepStrictEqual(accounting.dateRange, coverage.dateRange)
    && coverage.complete === true
    && exactFormalUniverse(coverage.universe)
    && exactCoveredTradingDates(coverage.coveredTradingDates, coverage.dateRange)
    && Number.isSafeInteger(coverage.eventCount)
    && coverage.eventCount >= 0
    && coverage.zeroEventCoverageDeclared === (coverage.eventCount === 0)
    && isDeepStrictEqual(binding.priceBasis, FORMAL_ACCOUNTING_PRICE_BASIS);
}

function realDataFormalAccountingMatchesSnapshot(binding, source, snapshot) {
  if (!realDataFormalAccountingClaimValid(binding, source, { id: snapshot?.id })
    || snapshot?.adjustmentMode !== "forward"
    || !Array.isArray(snapshot.universe)
    || !Array.isArray(snapshot.bars)
    || snapshot.bars.length === 0) return false;

  const dates = [...new Set(snapshot.bars.map((bar) => bar?.tradeDate))].sort();
  const dateRange = { start: dates[0], end: dates.at(-1) };
  return binding.signalSnapshot.sha256 === snapshot.sourceHash
    && binding.signalSnapshot.dataHash === snapshot.dataHash
    && binding.signalSnapshot.snapshotId === snapshot.id
    && binding.accountingSnapshot.dataCutoff === source.dataCutoff
    && binding.accountingSnapshot.universeVersion === source.universeVersion
    && isDeepStrictEqual(binding.accountingSnapshot.dateRange, dateRange)
    && isDeepStrictEqual(binding.corporateActionCoverage.coverage.dateRange, dateRange)
    && isDeepStrictEqual(binding.corporateActionCoverage.coverage.universe, snapshot.universe)
    && isDeepStrictEqual(binding.corporateActionCoverage.coverage.coveredTradingDates, dates);
}

function approvedFormalDataPath(path, identityPattern) {
  return typeof path === "string"
    && path.startsWith("data/quant-approved/")
    && path.endsWith(".json")
    && !path.startsWith("/")
    && !path.includes("\\")
    && !path.split("/").includes("..")
    && !/(?:^|\/)(?:fixtures?|samples?|shadow)(?:\/|$)/i.test(path)
    && identityPattern.test(path);
}

function exactDateRange(value) {
  return hasExactKeys(value, ["end", "start"])
    && validDateOnly(value.start)
    && validDateOnly(value.end)
    && value.start <= value.end;
}

function exactFormalUniverse(universe) {
  if (!Array.isArray(universe) || universe.length === 0) return false;
  const identities = new Set();
  return universe.every((entry) => {
    const identity = `${entry?.market}.${entry?.code}`;
    if (!hasExactKeys(entry, ["code", "lotSize", "market", "name", "symbol"])
      || entry.market !== "HK"
      || entry.symbol !== identity
      || !nonPlaceholder(entry.code)
      || !nonPlaceholder(entry.name)
      || !Number.isSafeInteger(entry.lotSize)
      || entry.lotSize <= 0
      || identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
}

function exactCoveredTradingDates(dates, dateRange) {
  if (!Array.isArray(dates) || dates.length === 0 || new Set(dates).size !== dates.length
    || !dates.every(validDateOnly)) return false;
  return isDeepStrictEqual(dates, [...dates].sort())
    && dates[0] === dateRange.start
    && dates.at(-1) === dateRange.end;
}

function validDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function validHistoricalTimestamp(value) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function realDataRepositoryHistoryVerified({
  expectedCommitSha,
  inheritance,
  inheritanceArtifact,
  repositoryHistory,
  sourceSection,
  sourceSectionArtifact
}) {
  const sourceSectionBytes = verifiedArtifactBytes(sourceSectionArtifact);
  const leafArtifacts = uniqueArtifacts([
    ...sourceSection.artifacts,
    ...sourceSection.source.artifacts,
    ...sourceSection.snapshot.artifacts,
    ...sourceSection.runWitness.artifacts
  ]);
  const witnessPaths = new Set(sourceSection.runWitness.artifacts.map((artifact) => artifact.path));
  const requiredPaths = [sourceSectionArtifact.path, ...leafArtifacts.map((artifact) => artifact.path)];
  if (sourceSectionBytes === null
    || verifiedArtifactBytes(inheritanceArtifact) === null
    || !realDataArtifactPath(inheritanceArtifact?.path)
    || !requiredPaths.every(realDataArtifactPath)
    || !leafArtifacts.every((artifact) => verifiedArtifactBytes(
      artifact,
      witnessPaths.has(artifact.path) ? REAL_DATA_QUANT_WITNESS_MAX_BYTES : Number.POSITIVE_INFINITY
    ) !== null)
    || !requiredPaths.every((path) => inheritance.changedPaths.includes(path))) return false;

  try {
    if (repositoryHistory.isAncestor(inheritance.sourceCommitSha, inheritance.evidenceCommitSha) !== true
      || repositoryHistory.isAncestor(inheritance.evidenceCommitSha, expectedCommitSha) !== true
      || !bytesEqual(repositoryHistory.fileBytesAtCommit(
        inheritance.evidenceCommitSha,
        sourceSectionArtifact.path
      ), sourceSectionBytes)
      || !bytesEqual(repositoryHistory.fileBytesAtCommit(
        expectedCommitSha,
        sourceSectionArtifact.path
      ), sourceSectionBytes)
      || !artifactsMatchRepositoryHistory(
        leafArtifacts,
        inheritance.evidenceCommitSha,
        expectedCommitSha,
        repositoryHistory
      )) return false;

    const sourceToEvidencePaths = repositoryHistory.changedPaths(
      inheritance.sourceCommitSha,
      inheritance.evidenceCommitSha
    );
    const evidenceToTargetPaths = repositoryHistory.changedPaths(
      inheritance.evidenceCommitSha,
      expectedCommitSha
    );
    const actualChangedPaths = uniqueStrings([...sourceToEvidencePaths, ...evidenceToTargetPaths]);
    return exactChangedPaths(actualChangedPaths, inheritance.changedPaths, isRealDataInheritanceSafePath);
  } catch {
    return false;
  }
}

function capacityDecision(value, commitSha, repositoryHistory = gitRepositoryHistory) {
  const failures = [];
  bindCommit(failures, value, commitSha);
  check(failures, "capacity measurement artifacts", verifyArtifacts(value?.artifacts));
  const decision = value?.decision;
  check(failures, "capacity decision", decision === "keep_synchronous" || decision === "introduce_worker");
  check(failures, "required capacity measurements", requiredCapacityMeasurementsRecorded(value));
  check(failures, "measured metrics recorded", Array.isArray(value?.measurements) && value.measurements.length > 0
    && value.measurements.every((measurement) => validMeasurement(measurement, value, commitSha, repositoryHistory)));
  check(failures, "measurement artifacts", value?.measurements?.every((item) => verifyArtifacts(item?.artifacts)) === true);
  if (decision === "keep_synchronous") {
    check(failures, "Redis and worker remain absent", value?.redisIntroduced === false && value?.workerIntroduced === false);
    check(failures, "no measured capacity breach", value?.measurements?.every((item) => item.breached === false));
  } else {
    check(failures, "measured capacity breach", value?.measurements?.some((item) => item.breached === true));
    check(failures, "worker change separately approved", value?.separateInfrastructureAuthorization === true);
  }
  return result(failures, decision ?? "capacity_decision_missing");
}

function requiredCapacityMeasurementsRecorded(section) {
  const requiredLabels = requiredCapacityMeasurementLabels();
  if (!Array.isArray(section?.measurements) || section.measurements.length !== requiredLabels.length) return false;
  const labels = new Set();
  for (const measurement of section.measurements) {
    if (!Array.isArray(measurement?.artifacts) || measurement.artifacts.length !== 1) return false;
    const bytes = verifiedArtifactBytes(measurement.artifacts[0]);
    if (bytes === null) return false;
    try {
      const probe = JSON.parse(bytes.toString("utf8"));
      if (probe?.metric !== CAPACITY_PROBE_METRIC) return false;
      const label = requiredLabels.find((candidate) => measurement.metric === `${candidate} ${CAPACITY_PROBE_METRIC}`);
      if (!label || labels.has(label) || !isRequiredCapacityMeasurement(label, probe?.request?.pathname)) return false;
      labels.add(label);
    } catch {
      return false;
    }
  }
  return labels.size === requiredLabels.length;
}

function bindCommit(failures, value, commitSha) {
  check(failures, "exact commit", SHA_PATTERN.test(commitSha) && value?.commitSha === commitSha);
}

function onlySuccessfulGets(requests) {
  return Array.isArray(requests) && requests.length > 0
    && requests.every((item) => item?.method === "GET" && Number.isInteger(item?.status) && item.status >= 200 && item.status < 300);
}

function requiredReadKinds(requests) {
  const kinds = new Set((requests ?? []).map((item) => item?.kind));
  return ["health", "quote", "research", "decision_context", "historical_portfolio"].every((kind) => kinds.has(kind));
}

function productionWriteBoundaryVerified(value) {
  if (!hasExactKeys(value, [
    "artifacts",
    "authorized",
    "commitSha",
    "identity",
    "officialFactsMutated",
    "requests",
    "writeBoundaryEvidence"
  ])) return false;
  const boundary = value?.writeBoundaryEvidence;
  return hasExactKeys(boundary, [
    "databaseMutated",
    "databaseWriteDenialCode",
    "productionWriteRequestsSent",
    "runtimeReadOnlyGuard"
  ])
    && boundary.productionWriteRequestsSent === false
    && boundary.runtimeReadOnlyGuard === "verified"
    && boundary.databaseWriteDenialCode === "25006"
    && boundary.databaseMutated === false;
}

function validMeasurement(measurement, section, expectedCommitSha, repositoryHistory) {
  const failures = measurementFailureCount(measurement, section, expectedCommitSha, repositoryHistory);
  return nonPlaceholder(measurement?.metric)
    && Number.isFinite(measurement?.observed) && measurement.observed >= 0
    && Number.isFinite(measurement?.threshold) && measurement.threshold > 0
    && Number.isInteger(failures) && failures >= 0 && failures <= measurement.sampleSize
    && measurement?.breached === (measurement.observed > measurement.threshold || failures > 0)
    && ["staging", "production"].includes(measurement?.environment)
    && Number.isInteger(measurement?.sampleSize) && measurement.sampleSize >= 30 && measurement.sampleSize <= 500
    && validTimestamp(measurement?.measuredAt);
}

function measurementFailureCount(measurement, section, expectedCommitSha, repositoryHistory) {
  if (!Array.isArray(measurement?.artifacts) || measurement.artifacts.length !== 1) return null;
  if (!section?.artifacts?.some((artifact) => isDeepStrictEqual(artifact, measurement.artifacts[0]))) return null;

  try {
    const artifactBytes = verifiedArtifactBytes(measurement.artifacts[0]);
    if (artifactBytes === null) return null;
    const probe = JSON.parse(artifactBytes.toString("utf8"));
    validateCapacityProbe(probe, section?.inheritance?.sourceCommitSha);
    if (probe.metric !== CAPACITY_PROBE_METRIC
      || !(measurement.metric === probe.metric || measurement.metric.endsWith(` ${probe.metric}`))
      || probe.observed !== measurement.observed
      || probe.threshold !== measurement.threshold
      || probe.breached !== measurement.breached
      || probe.environment !== measurement.environment
      || probe.sampleSize !== measurement.sampleSize
      || probe.measuredAt !== measurement.measuredAt
      || (Object.hasOwn(measurement, "failures") && measurement.failures !== probe.failures)
      || !capacityProbeCommitIsBound(
        section,
        measurement,
        probe.commitSha,
        probe.failures,
        artifactBytes,
        expectedCommitSha,
        repositoryHistory
      )) {
      return null;
    }
    return probe.failures;
  } catch {
    return null;
  }
}

function capacityProbeCommitIsBound(
  section,
  measurement,
  probeCommitSha,
  probeFailureCount,
  probeBytes,
  expectedCommitSha,
  repositoryHistory
) {
  const inheritance = section?.inheritance;
  if (!SHA_PATTERN.test(expectedCommitSha)
    || section?.commitSha !== expectedCommitSha
    || inheritance?.sourceCommitSha !== probeCommitSha
    || !SHA_PATTERN.test(inheritance?.evidenceCommitSha ?? "")
    || inheritance.evidenceCommitSha === probeCommitSha
    || inheritance.evidenceCommitSha === expectedCommitSha
    || inheritance?.measurementsRerun !== false
    || inheritance?.capacityProbeAndRuntimeBuildInputDiffEmpty !== true
    || !Array.isArray(inheritance?.changedPaths)
    || inheritance.changedPaths.length === 0
    || new Set(inheritance.changedPaths).size !== inheritance.changedPaths.length
    || !inheritance.changedPaths.every(isCapacityInheritanceSafePath)) {
    return false;
  }

  const sourceSectionBytes = verifiedArtifactBytes({
    path: inheritance.sourceSectionPath,
    sha256: inheritance.sourceSectionSha256
  });
  if (sourceSectionBytes === null) return false;

  try {
    if (repositoryHistory.isAncestor(probeCommitSha, inheritance.evidenceCommitSha) !== true
      || repositoryHistory.isAncestor(inheritance.evidenceCommitSha, expectedCommitSha) !== true) {
      return false;
    }
    const committedSourceSectionBytes = repositoryHistory.fileBytesAtCommit(
      inheritance.evidenceCommitSha,
      inheritance.sourceSectionPath
    );
    const committedProbeBytes = repositoryHistory.fileBytesAtCommit(
      inheritance.evidenceCommitSha,
      measurement.artifacts[0].path
    );
    const targetSourceSectionBytes = repositoryHistory.fileBytesAtCommit(
      expectedCommitSha,
      inheritance.sourceSectionPath
    );
    const targetProbeBytes = repositoryHistory.fileBytesAtCommit(
      expectedCommitSha,
      measurement.artifacts[0].path
    );
    if (!Buffer.isBuffer(committedSourceSectionBytes)
      || !Buffer.isBuffer(committedProbeBytes)
      || !Buffer.isBuffer(targetSourceSectionBytes)
      || !Buffer.isBuffer(targetProbeBytes)
      || !sourceSectionBytes.equals(committedSourceSectionBytes)
      || !sourceSectionBytes.equals(targetSourceSectionBytes)
      || !probeBytes.equals(committedProbeBytes)
      || !probeBytes.equals(targetProbeBytes)) {
      return false;
    }
    const sourceSection = JSON.parse(sourceSectionBytes.toString("utf8"));
    const measurementIndex = section.measurements.indexOf(measurement);
    const sourceMeasurement = sourceSection?.measurements?.[measurementIndex];
    if (sourceSection?.commitSha !== probeCommitSha
      || sourceSection?.inheritance !== undefined
      || sourceSection?.decision !== section.decision
      || sourceSection?.redisIntroduced !== section.redisIntroduced
      || sourceSection?.workerIntroduced !== section.workerIntroduced
      || sourceSection?.separateInfrastructureAuthorization !== section.separateInfrastructureAuthorization
      || !isDeepStrictEqual(sourceSection?.artifacts, section.artifacts)
      || !measurementsEquivalent(sourceSection?.measurements, section.measurements)
      || measurementIndex < 0
      || (Object.hasOwn(sourceMeasurement ?? {}, "failures") && sourceMeasurement.failures !== probeFailureCount)
      || !verifyArtifacts(sourceSection.artifacts)) {
      return false;
    }
    const sourceToEvidencePaths = repositoryHistory.changedPaths(
      probeCommitSha,
      inheritance.evidenceCommitSha
    );
    const evidenceToTargetPaths = repositoryHistory.changedPaths(
      inheritance.evidenceCommitSha,
      expectedCommitSha
    );
    if (!Array.isArray(sourceToEvidencePaths) || !Array.isArray(evidenceToTargetPaths)) return false;
    const actualChangedPaths = [...new Set([...sourceToEvidencePaths, ...evidenceToTargetPaths])];
    return isDeepStrictEqual([...actualChangedPaths].sort(), [...inheritance.changedPaths].sort());
  } catch {
    return false;
  }
}

function measurementsEquivalent(source, target) {
  if (!Array.isArray(source) || !Array.isArray(target) || source.length !== target.length) return false;
  return source.every((sourceMeasurement, index) => {
    const targetMeasurement = target[index];
    if (!sourceMeasurement || !targetMeasurement) return false;
    if (Object.hasOwn(sourceMeasurement, "failures")
      && Object.hasOwn(targetMeasurement, "failures")
      && sourceMeasurement.failures !== targetMeasurement.failures) {
      return false;
    }
    const sourceWithoutFailures = { ...sourceMeasurement };
    const targetWithoutFailures = { ...targetMeasurement };
    delete sourceWithoutFailures.failures;
    delete targetWithoutFailures.failures;
    return isDeepStrictEqual(sourceWithoutFailures, targetWithoutFailures);
  });
}

function bytesEqual(actual, expected) {
  return Buffer.isBuffer(actual) && Buffer.isBuffer(expected) && actual.equals(expected);
}

function artifactsMatchRepositoryHistory(artifacts, evidenceCommitSha, targetCommitSha, repositoryHistory) {
  return artifacts.every((artifact) => {
    const bytes = verifiedArtifactBytes(artifact);
    return bytes !== null
      && bytesEqual(repositoryHistory.fileBytesAtCommit(evidenceCommitSha, artifact.path), bytes)
      && bytesEqual(repositoryHistory.fileBytesAtCommit(targetCommitSha, artifact.path), bytes);
  });
}

function uniqueArtifacts(artifacts) {
  const byIdentity = new Map();
  for (const artifact of artifacts) {
    if (typeof artifact?.path !== "string" || typeof artifact?.sha256 !== "string") return [];
    byIdentity.set(`${artifact.path}\0${artifact.sha256}`, artifact);
  }
  return [...byIdentity.values()];
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function exactChangedPaths(actual, expected, isSafePath = isCapacityInheritanceSafePath) {
  return Array.isArray(actual)
    && Array.isArray(expected)
    && new Set(actual).size === actual.length
    && actual.every(isSafePath)
    && isDeepStrictEqual([...actual].sort(), [...expected].sort());
}

export function isControlledPersistenceInheritanceSafePath(path) {
  return isStageEvidenceInheritanceSafePath(
    path,
    [
      "artifacts/stage-13-20/controlled-persistence/",
      "artifacts/stage-13-20/real-data-quant/"
    ]
  );
}

export function isRealDataInheritanceSafePath(path) {
  return isStageEvidenceInheritanceSafePath(
    path,
    [
      "artifacts/stage-13-20/controlled-persistence/",
      "artifacts/stage-13-20/real-data-quant/"
    ]
  );
}

function isStageEvidenceInheritanceSafePath(path, artifactPrefixes) {
  return typeof path === "string"
    && path.length > 0
    && !path.startsWith("/")
    && !path.includes("\\")
    && !path.split("/").includes("..")
    && (STAGE_EVIDENCE_INHERITANCE_SAFE_FILES.has(path)
      || STAGE_EVIDENCE_INHERITANCE_SAFE_PREFIXES.some((prefix) => path.startsWith(prefix))
      || artifactPrefixes.some((prefix) => path.startsWith(prefix)));
}

export function isCapacityInheritanceSafePath(path) {
  return typeof path === "string"
    && path.length > 0
    && !path.startsWith("/")
    && !path.includes("\\")
    && !path.split("/").includes("..")
    && (CAPACITY_INHERITANCE_SAFE_FILES.has(path)
      || CAPACITY_INHERITANCE_SAFE_PREFIXES.some((prefix) => path.startsWith(prefix)));
}

const gitRepositoryHistory = {
  isAncestor(sourceCommitSha, targetCommitSha) {
    if (!commitExistsLocally(sourceCommitSha) || !commitExistsLocally(targetCommitSha)) return false;
    try {
      execFileSync(GIT_EXECUTABLE, ["merge-base", "--is-ancestor", sourceCommitSha, targetCommitSha], {
        env: GIT_READONLY_ENV,
        stdio: "ignore"
      });
      return true;
    } catch {
      return false;
    }
  },
  fileBytesAtCommit(commitSha, path) {
    if (!commitExistsLocally(commitSha)) return null;
    return execFileSync(
      GIT_EXECUTABLE,
      ["show", `${commitSha}:${path}`],
      { env: GIT_READONLY_ENV, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
    );
  },
  changedPaths(sourceCommitSha, targetCommitSha) {
    if (!commitExistsLocally(sourceCommitSha) || !commitExistsLocally(targetCommitSha)) return null;
    const output = execFileSync(
      GIT_EXECUTABLE,
      ["log", "--format=", "--name-only", "--no-renames", "-m", "--ancestry-path", `${sourceCommitSha}..${targetCommitSha}`, "--"],
      { encoding: "utf8", env: GIT_READONLY_ENV, stdio: ["ignore", "pipe", "ignore"] }
    );
    return [...new Set(output.split("\n").filter(Boolean))];
  }
};

function commitExistsLocally(commitSha) {
  if (!SHA_PATTERN.test(commitSha)) return false;
  try {
    execFileSync(GIT_EXECUTABLE, ["cat-file", "-e", `${commitSha}^{commit}`], {
      env: GIT_READONLY_ENV,
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function verifyArtifacts(artifacts, maxBytes = Number.POSITIVE_INFINITY) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return false;
  return artifacts.every((artifact) => verifiedArtifactBytes(artifact, maxBytes) !== null);
}

function parseVerifiedArtifact(artifact) {
  const bytes = verifiedArtifactBytes(artifact);
  if (bytes === null) return null;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
}

function parseVerifiedCanonicalArtifact(artifact, maxBytes = Number.POSITIVE_INFINITY) {
  const bytes = verifiedArtifactBytes(artifact, maxBytes);
  if (bytes === null) return null;
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    return canonicalJsonBytes(value).equals(bytes) ? value : null;
  } catch {
    return null;
  }
}

function realDataArtifactPath(path) {
  return typeof path === "string" && path.startsWith("artifacts/stage-13-20/real-data-quant/");
}

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return isDeepStrictEqual(Object.keys(value).sort(), [...expectedKeys].sort());
}

function verifiedArtifactBytes(artifact, maxBytes = Number.POSITIVE_INFINITY) {
  let governedRoot;
  try {
    governedRoot = governedArtifactRoot();
  } catch {
    return null;
  }
  if (typeof artifact?.path !== "string" || !SHA256_PATTERN.test(artifact?.sha256 ?? "")) return null;
  try {
    const candidate = resolve(artifact.path);
    if (!regularArtifactPath(governedRoot.path, candidate)) return null;
    const metadata = lstatSync(candidate);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > maxBytes) return null;
    const resolved = realpathSync(candidate);
    const pathFromRoot = relative(governedRoot.real, resolved);
    if (pathFromRoot.startsWith("..") || pathFromRoot === "") return null;
    const bytes = readFileSync(resolved);
    return createHash("sha256").update(bytes).digest("hex") === artifact.sha256 ? bytes : null;
  } catch {
    return null;
  }
}

function governedArtifactRoot() {
  const repositoryPath = resolve(".");
  const repositoryMetadata = lstatSync(repositoryPath);
  if (repositoryMetadata.isSymbolicLink() || !repositoryMetadata.isDirectory()) {
    throw new Error("repository root must be a regular directory");
  }
  const repositoryRealPath = realpathSync(repositoryPath);
  let current = repositoryPath;
  for (const segment of ["artifacts", "stage-13-20"]) {
    current = resolve(current, segment);
    const metadata = lstatSync(current);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("governed artifact root must contain only regular directories");
    }
  }
  const real = realpathSync(current);
  const fromRepository = relative(repositoryRealPath, real);
  if (fromRepository === "" || fromRepository === ".." || fromRepository.startsWith(`..${sep}`)) {
    throw new Error("governed artifact root must stay inside the repository");
  }
  return { path: current, real };
}

function regularArtifactPath(root, candidate) {
  const fromRoot = relative(root, candidate);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) return false;
  let current = root;
  for (const segment of fromRoot.split(sep)) {
    current = resolve(current, segment);
    const metadata = lstatSync(current);
    if (metadata.isSymbolicLink()) return false;
  }
  return true;
}

function nonPlaceholder(value) {
  return typeof value === "string" && value.trim().length > 0
    && !/^(unknown|missing|none|n\/?a|not[_ -]?available|unavailable|placeholder|example|fixture|synthetic)$/i.test(value.trim());
}

function check(failures, id, ok) {
  if (!ok) failures.push(id);
}

function result(failures, decision) {
  return { ok: failures.length === 0, state: failures.length === 0 ? "completed" : "failed", decision, failures };
}

export function verifyControlledPersistenceStage(value, expectedCommitSha, options = {}) {
  return persistenceEvidence(value, expectedCommitSha, options.repositoryHistory ?? gitRepositoryHistory);
}

export function verifyRealDataQuantStage(value, expectedCommitSha, options = {}) {
  return realDataQuantEvidence(value, expectedCommitSha, options.repositoryHistory ?? gitRepositoryHistory);
}

export function validateRealDataFormalAccountingClaim(binding, source, snapshot) {
  return realDataFormalAccountingClaimValid(binding, source, snapshot);
}

export function verifyAsyncCapacityStage(value, expectedCommitSha, options = {}) {
  return capacityDecision(value, expectedCommitSha, options.repositoryHistory ?? gitRepositoryHistory);
}
