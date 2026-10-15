import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const LOCAL_VALIDATION_REGISTRY_SCHEMA_VERSION =
  "2026-07-15.stage-13-20-local-validation-registry.v1";
export const HISTORICAL_STAGE_13_20_COMMIT_SHA =
  "f78ef83fbfc0096444d9996ec06c2b51efda5755";
export const HISTORICAL_STAGE_13_20_MANIFEST_PATH =
  "artifacts/stage-13-20/stage-13-20-manifest-f78ef83fbfc0.json";

export const CURRENT_STANDALONE_STAGE_IDS = Object.freeze([
  "CONTROLLED-PERSISTENCE-1",
  "REAL-DATA-QUANT-1"
]);

const STAGE_IDS = Object.freeze([
  "PORTFOLIO-AUTHORITY-DECISION-1",
  "STAGING-EXACT-HEAD-1",
  "IOS-PHYSICAL-DEVICE-1",
  "PRODUCTION-GET-SMOKE-1",
  "READONLY-RELEASE-1",
  ...CURRENT_STANDALONE_STAGE_IDS,
  "ASYNC-CAPACITY-DECISION-1"
]);

const HISTORICAL_COMPLETED_STAGE_IDS = Object.freeze([
  "PORTFOLIO-AUTHORITY-DECISION-1",
  "STAGING-EXACT-HEAD-1",
  "IOS-PHYSICAL-DEVICE-1",
  "PRODUCTION-GET-SMOKE-1",
  "READONLY-RELEASE-1",
  "ASYNC-CAPACITY-DECISION-1"
]);

const HISTORICAL_FAILURES = Object.freeze({
  "CONTROLLED-PERSISTENCE-1": Object.freeze(["controlled-persistence inheritance"]),
  "REAL-DATA-QUANT-1": Object.freeze([
    "real-data quant evidence artifacts",
    "historical-only research authority",
    "independently reproducible run witness",
    "formal accounting dual-source binding"
  ])
});

export const LOCAL_VALIDATION_REGISTRY_SAFETY = Object.freeze({
  advisoryOnly: true,
  productionStatus: "NO_GO",
  releaseReady: false,
  productionReady: false,
  portfolioPresentation: "omitted",
  pinganAuthority: "historical_only",
  realTrading: false,
  brokerWrites: false,
  productionDatabaseWrites: false,
  officialFactMutation: false,
  autoMerge: false
});

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function verifyStage13To20LocalValidationRegistry(registry, dependencies = {}) {
  const failures = [];
  const parsedArtifacts = new Map();
  const validationHeadSha = registry?.validationHeadSha ?? null;
  const currentSections = isPlainObject(registry?.currentStandaloneSections)
    ? registry.currentStandaloneSections
    : {};

  if (!hasExactKeys(registry, [
    "currentStandaloneSections",
    "historicalAggregate",
    "safety",
    "schemaVersion",
    "validationHeadSha"
  ])) failures.push("registry schema");
  if (registry?.schemaVersion !== LOCAL_VALIDATION_REGISTRY_SCHEMA_VERSION) {
    failures.push("registry schema version");
  }
  if (!SHA_PATTERN.test(validationHeadSha ?? "")) failures.push("validation head SHA");
  if (!isDeepStrictEqual(registry?.safety, LOCAL_VALIDATION_REGISTRY_SAFETY)) failures.push("registry safety boundary");

  const currentStageIds = Object.keys(currentSections);
  if (!isPlainObject(registry?.currentStandaloneSections)
    || currentStageIds.some((stageId) => !CURRENT_STANDALONE_STAGE_IDS.includes(stageId))) {
    failures.push("current standalone stage set");
  }

  const historicalReference = registry?.historicalAggregate;
  if (!hasExactKeys(historicalReference, ["expectedCommitSha", "path", "sha256"])
    || historicalReference?.expectedCommitSha !== HISTORICAL_STAGE_13_20_COMMIT_SHA
    || historicalReference?.path !== HISTORICAL_STAGE_13_20_MANIFEST_PATH
    || historicalReference?.expectedCommitSha === validationHeadSha) {
    failures.push("historical aggregate reference");
  }
  const historicalManifest = loadJsonArtifact(
    historicalReference,
    dependencies.readArtifact,
    failures,
    "historical aggregate",
    parsedArtifacts
  );

  let historicalResult = null;
  if (historicalManifest !== null) {
    if (historicalManifest?.commitSha !== historicalReference.expectedCommitSha) {
      failures.push("historical aggregate commit");
    }
    if (typeof dependencies.verifyHistoricalAggregate !== "function") {
      failures.push("historical aggregate verifier");
    } else {
      try {
        historicalResult = dependencies.verifyHistoricalAggregate(
          historicalManifest,
          historicalReference.expectedCommitSha
        );
      } catch {
        failures.push("historical aggregate verifier");
      }
    }
  }

  const historicalReplayValid = historicalReplayVerified(
    historicalManifest,
    historicalResult,
    failures
  );

  const presentCurrentStages = CURRENT_STANDALONE_STAGE_IDS.filter((stageId) =>
    Object.hasOwn(currentSections, stageId));
  const verifiedCurrentStages = [];
  const failedCurrentStages = [];
  for (const stageId of presentCurrentStages) {
    const reference = currentSections[stageId];
    if (!hasExactKeys(reference, ["path", "sha256"])) {
      failures.push(`${stageId} standalone reference`);
      failedCurrentStages.push(stageId);
      continue;
    }
    const section = loadJsonArtifact(
      reference,
      dependencies.readArtifact,
      failures,
      `${stageId} standalone`,
      parsedArtifacts
    );
    if (section === null) {
      failedCurrentStages.push(stageId);
      continue;
    }
    if (section?.commitSha !== validationHeadSha) {
      failures.push(`${stageId} standalone current head`);
      failedCurrentStages.push(stageId);
      continue;
    }
    if (typeof dependencies.verifyStandaloneSection !== "function") {
      failures.push("standalone section verifier");
      failedCurrentStages.push(stageId);
      continue;
    }
    let result;
    try {
      result = dependencies.verifyStandaloneSection(stageId, section, validationHeadSha);
    } catch {
      result = null;
    }
    if (result?.ok !== true) {
      failures.push(`${stageId} standalone verification`);
      failedCurrentStages.push(stageId);
      continue;
    }
    verifiedCurrentStages.push(stageId);
  }

  const missingCurrentStages = CURRENT_STANDALONE_STAGE_IDS.filter((stageId) =>
    !verifiedCurrentStages.includes(stageId));
  const registryValid = failures.length === 0;
  const historicalCompletedStages = arrayOrEmpty(historicalResult?.completedStages);
  const historicalFailClosedStages = arrayOrEmpty(historicalResult?.blockedStages);

  return {
    registryValid,
    decision: registryValid
      ? "truthful_local_validation_composition"
      : "invalid_local_validation_composition",
    validationHeadSha,
    failures,
    historicalReplay: {
      valid: historicalReplayValid,
      expectedCommitSha: historicalReference?.expectedCommitSha ?? null,
      aggregateComplete: historicalResult?.ok === true,
      completedStages: historicalCompletedStages,
      completedStageCount: historicalCompletedStages.length,
      failClosedStages: historicalFailClosedStages
    },
    currentStandalone: {
      presentStages: presentCurrentStages,
      verifiedStages: verifiedCurrentStages,
      failedStages: failedCurrentStages,
      missingCurrentStages,
      allRequiredStandaloneStagesVerified: missingCurrentStages.length === 0
    },
    // Six lanes remain exact-commit historical evidence even when both current
    // standalone sections pass, so this composition is never an all-current 8/8.
    allStagesCurrent: false,
    lanes: deriveLaneClassifications(verifiedCurrentStages, historicalReplayValid),
    safety: { ...LOCAL_VALIDATION_REGISTRY_SAFETY },
    physicalDevice: historicalReplayValid
      ? { outcome: "owner_waived_recorded_failure", testSucceeded: false }
      : { outcome: "unverified_historical_evidence", testSucceeded: false }
  };
}

function historicalReplayVerified(manifest, result, failures) {
  let valid = true;
  const requireCondition = (condition, failure) => {
    if (condition) return;
    valid = false;
    failures.push(failure);
  };

  requireCondition(result?.ok === false, "historical aggregate must remain incomplete");
  requireCondition(Array.isArray(result?.manifestFailures) && result.manifestFailures.length === 0,
    "historical aggregate envelope");
  requireCondition(sameSet(result?.completedStages, HISTORICAL_COMPLETED_STAGE_IDS),
    "historical aggregate exact six completed stages");
  requireCondition(sameSet(result?.blockedStages, CURRENT_STANDALONE_STAGE_IDS),
    "historical aggregate exact fail-closed stages");
  requireCondition(Array.isArray(result?.pendingStages) && result.pendingStages.length === 0,
    "historical aggregate pending stages");

  for (const stageId of HISTORICAL_COMPLETED_STAGE_IDS) {
    requireCondition(result?.stages?.[stageId]?.ok === true,
      `historical aggregate completed stage ${stageId}`);
  }
  for (const stageId of CURRENT_STANDALONE_STAGE_IDS) {
    requireCondition(result?.stages?.[stageId]?.ok === false
      && isDeepStrictEqual(result.stages[stageId].failures, HISTORICAL_FAILURES[stageId]),
    `historical aggregate expected failure ${stageId}`);
  }

  requireCondition(result?.safety?.advisoryOnly === true
    && result?.safety?.realBrokerOrders === false
    && result?.safety?.autoMerge === false,
  "historical aggregate safety boundary");
  requireCondition(manifest?.portfolioAuthority?.decision === "portfolio_omitted"
    && manifest?.portfolioAuthority?.portfolioPresentation === "omitted"
    && manifest?.portfolioAuthority?.pinganAuthority === "historical_only",
  "historical aggregate portfolio boundary");

  const device = manifest?.iosPhysicalDevice;
  requireCondition(device?.ownerWaiver?.authorized === true
    && device?.ownerWaiver?.decision === "accept_recorded_nonblocking_failure"
    && device?.ownerWaiver?.testPassed === false
    && device?.ownerWaiver?.screenshotsClaimed === false
    && device?.checks?.authentication !== "passed"
    && device?.checks?.candidateToReviewJourney !== "passed"
    && Array.isArray(device?.screenshots)
    && device.screenshots.length === 0
    && result?.stages?.["IOS-PHYSICAL-DEVICE-1"]?.state === "completed"
    && result?.stages?.["IOS-PHYSICAL-DEVICE-1"]?.decision
      === "ios_physical_device_owner_waived_nonblocking_failure",
  "historical physical-device waiver boundary");

  return valid;
}

function loadJsonArtifact(reference, readArtifact, failures, label, parsedArtifacts) {
  if (!validArtifactReference(reference) || typeof readArtifact !== "function") {
    failures.push(`${label} artifact reference`);
    return null;
  }
  let bytes;
  try {
    bytes = readArtifact(reference);
  } catch {
    failures.push(`${label} artifact read`);
    return null;
  }
  if (typeof bytes === "string") bytes = Buffer.from(bytes);
  else if (bytes instanceof Uint8Array && !Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (!Buffer.isBuffer(bytes)
    || createHash("sha256").update(bytes).digest("hex") !== reference.sha256) {
    failures.push(`${label} artifact hash`);
    return null;
  }
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    parsedArtifacts.set(reference.path, value);
    return value;
  } catch {
    failures.push(`${label} artifact JSON`);
    return null;
  }
}

function validArtifactReference(reference) {
  return hasExactKeys(reference, reference?.expectedCommitSha === undefined
    ? ["path", "sha256"]
    : ["expectedCommitSha", "path", "sha256"])
    && typeof reference.path === "string"
    && reference.path.startsWith("artifacts/stage-13-20/")
    && !reference.path.includes("\\")
    && !reference.path.split("/").includes("..")
    && SHA256_PATTERN.test(reference.sha256 ?? "");
}

function deriveLaneClassifications(verifiedCurrentStages, historicalReplayValid) {
  return STAGE_IDS.map((stageId) => {
    if (!CURRENT_STANDALONE_STAGE_IDS.includes(stageId) && !historicalReplayValid) {
      return lane(stageId, "invalid_historical_evidence", "unverified");
    }
    if (stageId === "PORTFOLIO-AUTHORITY-DECISION-1") {
      return lane(stageId, "historical_policy_boundary_reaffirmed", "portfolio_omitted");
    }
    if (stageId === "STAGING-EXACT-HEAD-1") {
      return lane(stageId, "historical_external_exact_commit", "historical_verified");
    }
    if (stageId === "IOS-PHYSICAL-DEVICE-1") {
      return lane(stageId, "historical_owner_waived_recorded_failure", "owner_waived_recorded_failure");
    }
    if (stageId === "PRODUCTION-GET-SMOKE-1") {
      return lane(stageId, "historical_external_get_only", "historical_verified");
    }
    if (stageId === "READONLY-RELEASE-1") {
      return lane(stageId, "historical_readonly_release_exact_commit", "historical_verified");
    }
    if (stageId === "ASYNC-CAPACITY-DECISION-1") {
      return lane(stageId, "historical_capacity_decision_exact_commit", "historical_verified");
    }
    return verifiedCurrentStages.includes(stageId)
      ? lane(stageId, "current_local_standalone", "verified")
      : lane(stageId, "missing_current_standalone", "missing");
  });
}

function lane(stageId, evidenceScope, outcome) {
  return {
    stageId,
    evidenceScope,
    outcome,
    currentRuntimeClaim: false,
    productionReady: false
  };
}

function sameSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && new Set(actual).size === actual.length
    && expected.every((value) => actual.includes(value));
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? [...value] : [];
}

function hasExactKeys(value, keys) {
  return isPlainObject(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
