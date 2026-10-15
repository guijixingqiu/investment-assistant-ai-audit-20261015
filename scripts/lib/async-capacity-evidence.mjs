import { createHash } from "node:crypto";

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROBE_SCHEMA_VERSION = "2026-07-12.sync-capacity-probe.v1";
export const CAPACITY_PROBE_METRIC = "synchronous-read-p95-ms";
const REQUIRED_CAPACITY_MEASUREMENTS = Object.freeze([
  Object.freeze({ label: "health", pathname: "/health/ready" }),
  Object.freeze({ label: "quote", pathname: "/api/mobile/market/quotes/HK/09926" }),
  Object.freeze({ label: "research", pathname: "/api/mobile/research/profiles/HK/09926" }),
  Object.freeze({ label: "decision-context", pathname: "/api/mobile/research/decision-context/HK/09926" })
]);
const SOURCE_SECTION_KEYS = [
  "artifacts",
  "commitSha",
  "decision",
  "measurements",
  "redisIntroduced",
  "workerIntroduced"
];
const BREACH_SOURCE_SECTION_KEYS = [...SOURCE_SECTION_KEYS, "separateInfrastructureAuthorization"];
const PROBE_KEYS = [
  "auth",
  "breached",
  "commitSha",
  "credentialsPrinted",
  "environment",
  "failures",
  "measuredAt",
  "metric",
  "observed",
  "request",
  "responseBodiesStored",
  "sampleSize",
  "schemaVersion",
  "statuses",
  "threshold"
];

export function buildCapacitySourceSection(entries, sourceCommitSha) {
  assertSha(sourceCommitSha, "source commit");
  if (!Array.isArray(entries) || entries.length !== REQUIRED_CAPACITY_MEASUREMENTS.length) {
    throw new Error("capacity evidence requires exactly health, quote, research, and decision-context measurements");
  }

  const labels = new Set();
  const paths = new Set();
  const measurements = entries.map((entry) => {
    const label = entry?.label;
    if (!LABEL_PATTERN.test(label ?? "") || labels.has(label)) {
      throw new Error("capacity measurement labels must be unique lowercase identifiers");
    }
    labels.add(label);

    const path = normalizeArtifactPath(entry?.path);
    if (paths.has(path)) throw new Error("capacity probe paths must be unique");
    paths.add(path);

    if (!Buffer.isBuffer(entry?.bytes)) throw new Error(`capacity probe ${label} bytes are required`);
    const probe = parseJson(entry.bytes, `capacity probe ${label}`);
    validateCapacityProbe(probe, sourceCommitSha);
    if (!isRequiredCapacityMeasurement(label, probe.request.pathname)) {
      throw new Error("capacity measurement labels must match the required GET paths");
    }
    const artifact = {
      path,
      sha256: createHash("sha256").update(entry.bytes).digest("hex")
    };
    return {
      metric: `${label} ${probe.metric}`,
      observed: probe.observed,
      threshold: probe.threshold,
      breached: probe.breached,
      environment: probe.environment,
      sampleSize: probe.sampleSize,
      failures: probe.failures,
      measuredAt: probe.measuredAt,
      artifacts: [artifact]
    };
  });
  if (!hasEveryRequiredCapacityLabel(labels)) {
    throw new Error("capacity evidence requires exactly health, quote, research, and decision-context measurements");
  }
  const artifacts = measurements.map((measurement) => measurement.artifacts[0]);
  const breached = measurements.some((measurement) => measurement.breached);
  const section = {
    commitSha: sourceCommitSha,
    decision: breached ? "introduce_worker" : "keep_synchronous",
    redisIntroduced: false,
    workerIntroduced: false,
    artifacts,
    measurements
  };
  if (breached) section.separateInfrastructureAuthorization = false;
  return section;
}

export function buildCapacityTargetSection({
  sourceSection,
  sourceSectionPath,
  sourceSectionSha256,
  sourceCommitSha,
  evidenceCommitSha,
  targetCommitSha,
  changedPaths,
  isSafePath
}) {
  assertSha(sourceCommitSha, "source commit");
  assertSha(evidenceCommitSha, "evidence commit");
  assertSha(targetCommitSha, "target commit");
  if (new Set([sourceCommitSha, evidenceCommitSha, targetCommitSha]).size !== 3) {
    throw new Error("source, evidence, and target commits must be distinct");
  }
  validateSourceSection(sourceSection, sourceCommitSha);
  const normalizedSourceSectionPath = normalizeArtifactPath(sourceSectionPath);
  if (!SHA256_PATTERN.test(sourceSectionSha256 ?? "")) {
    throw new Error("source section SHA-256 is invalid");
  }
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
    throw new Error("capacity evidence history must change at least one safe path");
  }
  const normalizedPaths = [...new Set(changedPaths)].sort();
  if (normalizedPaths.length !== changedPaths.length
    || typeof isSafePath !== "function"
    || !normalizedPaths.every((path) => isSafePath(path))) {
    throw new Error("capacity evidence history contains duplicate or unsafe paths");
  }

  return {
    ...structuredClone(sourceSection),
    commitSha: targetCommitSha,
    inheritance: {
      sourceCommitSha,
      evidenceCommitSha,
      sourceSectionPath: normalizedSourceSectionPath,
      sourceSectionSha256,
      changedPaths: normalizedPaths,
      capacityProbeAndRuntimeBuildInputDiffEmpty: true,
      measurementsRerun: false
    }
  };
}

export function validateSourceSection(section, sourceCommitSha) {
  const breached = section?.decision === "introduce_worker";
  strictKeys(section, breached ? BREACH_SOURCE_SECTION_KEYS : SOURCE_SECTION_KEYS, "source section");
  if (section.commitSha !== sourceCommitSha
    || !["keep_synchronous", "introduce_worker"].includes(section.decision)
    || section.redisIntroduced !== false
    || section.workerIntroduced !== false
    || !Array.isArray(section.artifacts)
    || section.artifacts.length === 0
    || !Array.isArray(section.measurements)
    || section.measurements.length !== section.artifacts.length
    || !hasEveryRequiredCapacityMeasurement(section.measurements)) {
    throw new Error("capacity source section is inconsistent");
  }
  if (breached && section.separateInfrastructureAuthorization !== false) {
    throw new Error("a measured breach must remain blocked without separate infrastructure authorization");
  }
  if (!breached && section.measurements.some((measurement) => measurement?.breached !== false)) {
    throw new Error("keep_synchronous requires every measurement to remain below the breach boundary");
  }
  if (breached && !section.measurements.some((measurement) => measurement?.breached === true)) {
    throw new Error("introduce_worker requires a measured breach");
  }
  for (const [index, artifact] of section.artifacts.entries()) {
    validateArtifact(artifact);
    const measurementArtifacts = section.measurements[index]?.artifacts;
    if (!Array.isArray(measurementArtifacts)
      || measurementArtifacts.length !== 1
      || JSON.stringify(measurementArtifacts[0]) !== JSON.stringify(artifact)) {
      throw new Error("capacity source section artifact ordering is inconsistent");
    }
  }
  return true;
}

export function requiredCapacityMeasurementLabels() {
  return REQUIRED_CAPACITY_MEASUREMENTS.map(({ label }) => label);
}

export function isRequiredCapacityMeasurement(label, pathname) {
  return REQUIRED_CAPACITY_MEASUREMENTS.some((expected) => (
    expected.label === label && expected.pathname === pathname
  ));
}

function hasEveryRequiredCapacityMeasurement(measurements) {
  if (!Array.isArray(measurements) || measurements.length !== REQUIRED_CAPACITY_MEASUREMENTS.length) return false;
  const labels = new Set();
  for (const measurement of measurements) {
    const label = requiredCapacityMeasurementLabels().find((candidate) => (
      measurement?.metric === `${candidate} ${CAPACITY_PROBE_METRIC}`
    ));
    if (!label || labels.has(label)) return false;
    labels.add(label);
  }
  return hasEveryRequiredCapacityLabel(labels);
}

function hasEveryRequiredCapacityLabel(labels) {
  return labels.size === REQUIRED_CAPACITY_MEASUREMENTS.length
    && REQUIRED_CAPACITY_MEASUREMENTS.every(({ label }) => labels.has(label));
}

export function validateCapacityProbe(probe, sourceCommitSha) {
  assertSha(sourceCommitSha, "capacity probe source commit");
  strictKeys(probe, PROBE_KEYS, "capacity probe");
  strictKeys(probe.request, ["method", "origin", "pathname", "queryStored"], "capacity probe request");
  strictKeys(probe.auth, ["headerConfigured", "tokenPrinted", "tokenProvided"], "capacity probe auth summary");
  const parsedOrigin = new URL(probe.request.origin);
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsedOrigin.hostname);
  const secureOrigin = parsedOrigin.protocol === "https:" || (parsedOrigin.protocol === "http:" && loopback);
  const expectedBreach = probe.observed > probe.threshold || probe.failures > 0;
  if (probe.schemaVersion !== PROBE_SCHEMA_VERSION
    || probe.commitSha !== sourceCommitSha
    || !["staging", "production"].includes(probe.environment)
    || probe.request.method !== "GET"
    || probe.request.queryStored !== false
    || parsedOrigin.origin !== probe.request.origin
    || parsedOrigin.username !== ""
    || parsedOrigin.password !== ""
    || !secureOrigin
    || typeof probe.request.pathname !== "string"
    || !probe.request.pathname.startsWith("/")
    || probe.metric !== CAPACITY_PROBE_METRIC
    || !Number.isFinite(probe.observed)
    || probe.observed < 0
    || !Number.isFinite(probe.threshold)
    || probe.threshold <= 0
    || !Number.isInteger(probe.sampleSize)
    || probe.sampleSize < 30
    || probe.sampleSize > 500
    || !Number.isInteger(probe.failures)
    || probe.failures < 0
    || probe.failures > probe.sampleSize
    || probe.breached !== expectedBreach
    || probe.responseBodiesStored !== false
    || probe.credentialsPrinted !== false
    || probe.auth.headerConfigured !== Boolean(probe.auth.headerConfigured)
    || probe.auth.tokenProvided !== Boolean(probe.auth.tokenProvided)
    || probe.auth.tokenPrinted !== false
    || !Number.isFinite(Date.parse(probe.measuredAt))
    || !statusesMatch(probe.statuses, probe.sampleSize, probe.failures)) {
    throw new Error("capacity probe does not satisfy the measured GET-only evidence contract");
  }
}

function statusesMatch(statuses, sampleSize, failures) {
  if (!statuses || typeof statuses !== "object" || Array.isArray(statuses)) return false;
  let total = 0;
  let failed = 0;
  for (const [status, count] of Object.entries(statuses)) {
    if (!Number.isInteger(count) || count < 0) return false;
    total += count;
    if (status === "network_error") failed += count;
    else if (!/^\d{3}$/.test(status)) return false;
    else if (Number(status) < 200 || Number(status) >= 300) failed += count;
  }
  return total === sampleSize && failed === failures;
}

function validateArtifact(artifact) {
  normalizeArtifactPath(artifact?.path);
  if (!SHA256_PATTERN.test(artifact?.sha256 ?? "")) throw new Error("capacity artifact SHA-256 is invalid");
}

function normalizeArtifactPath(path) {
  if (typeof path !== "string"
    || !path.startsWith("artifacts/stage-13-20/")
    || path.startsWith("/")
    || path.includes("\\")
    || path.split("/").includes("..")
    || path.endsWith("/")) {
    throw new Error("capacity artifacts must stay under artifacts/stage-13-20");
  }
  return path;
}

function strictKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} contains missing or unsupported fields`);
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

function assertSha(value, label) {
  if (!SHA_PATTERN.test(value ?? "")) throw new Error(`${label} must be an exact 40-character SHA`);
}
