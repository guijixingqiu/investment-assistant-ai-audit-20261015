#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  validateLegacyDeepResearchReportPayload,
  validateResearchEvidencePackData
} from "../dist/packages/contracts/src/deepResearch.js";
import { canonicalJson } from "../dist/packages/contracts/src/decisionContextBrowser.js";
import {
  deepResearchGateFailures,
  evidencePackFingerprint,
  sha256
} from "../dist/apps/api/src/research/deepResearchGate.js";

const INPUT_SCHEMA = "2026-07-25.deep-research-blind-input.v1";
const BLIND_SCHEMA = "2026-07-25.deep-research-blind-bundle.v1";
const KEY_SCHEMA = "2026-07-25.deep-research-blind-key.v1";
const RATINGS_SCHEMA = "2026-07-25.deep-research-blind-ratings.v1";
const RESULT_SCHEMA = "2026-07-25.deep-research-blind-result.v1";

export function prepareBlindedEvaluation(input, now = new Date()) {
  exactRecord(input, ["schemaVersion", "evaluationId", "samples"], "input");
  if (input.schemaVersion !== INPUT_SCHEMA) fail("input schemaVersion is invalid");
  bounded(input.evaluationId, "evaluationId", 200);
  if (!Array.isArray(input.samples) || input.samples.length < 1 || input.samples.length > 20) {
    fail("samples must contain 1 to 20 rows");
  }
  const sampleIds = new Set();
  const packIdentities = new Set();
  const mappings = [];
  const samples = input.samples.map((sample) => {
    exactRecord(sample, ["sampleId", "classification", "evidencePack", "primaryReport", "optionalReport"], "sample");
    bounded(sample.sampleId, "sampleId", 200);
    if (sampleIds.has(sample.sampleId)) fail(`sampleId ${sample.sampleId} is duplicated`);
    sampleIds.add(sample.sampleId);
    if (sample.classification !== "authorized_real_sample") {
      fail(`sample ${sample.sampleId} is not an explicitly authorized real sample`);
    }
    validatePack(sample.evidencePack);
    const packIdentity = `${sample.evidencePack.membershipId}:${sample.evidencePack.version}:${sample.evidencePack.packFingerprint}`;
    if (packIdentities.has(packIdentity)) fail(`sample ${sample.sampleId} reuses another sample's frozen evidence pack`);
    packIdentities.add(packIdentity);
    const comparedOutputs = [
      output("primary", sample.primaryReport, sample.evidencePack, sample.sampleId, now),
      output("optional_second_opinion", sample.optionalReport, sample.evidencePack, sample.sampleId, now)
    ];
    if (comparedOutputs[0].fingerprint === comparedOutputs[1].fingerprint) {
      fail(`sample ${sample.sampleId} must contain two distinct report outputs`);
    }
    const outputs = comparedOutputs.sort((left, right) =>
      sha256(`${input.evaluationId}:${sample.sampleId}:${left.fingerprint}`)
        .localeCompare(sha256(`${input.evaluationId}:${sample.sampleId}:${right.fingerprint}`))
    ).map((item, index) => ({ ...item, label: index === 0 ? "A" : "B" }));
    mappings.push({
      sampleId: sample.sampleId,
      evidencePack: packRef(sample.evidencePack),
      candidates: outputs.map(({ label, role, fingerprint }) => ({ label, role, fingerprint }))
    });
    return {
      sampleId: sample.sampleId,
      classification: sample.classification,
      evidencePack: sample.evidencePack,
      candidates: outputs.map(({ label, fingerprint, report }) => ({ label, fingerprint, report }))
    };
  });
  const mapping = {
    schemaVersion: KEY_SCHEMA,
    evaluationId: input.evaluationId,
    mappings
  };
  const keyCommitment = sha256(canonicalJson(mapping));
  return {
    blindBundle: {
      schemaVersion: BLIND_SCHEMA,
      evaluationId: input.evaluationId,
      keyCommitment,
      samples
    },
    unblindingKey: { ...mapping, keyCommitment }
  };
}

export function scoreBlindedEvaluation(blindBundle, ratings, unblindingKey, now = new Date()) {
  validateBlindBundle(blindBundle, now);
  exactRecord(unblindingKey, ["schemaVersion", "evaluationId", "mappings", "keyCommitment"], "unblinding key");
  if (unblindingKey.schemaVersion !== KEY_SCHEMA || unblindingKey.evaluationId !== blindBundle.evaluationId) {
    fail("unblinding key identity is invalid");
  }
  const { keyCommitment: _commitment, ...mapping } = unblindingKey;
  if (sha256(canonicalJson(mapping)) !== unblindingKey.keyCommitment
    || unblindingKey.keyCommitment !== blindBundle.keyCommitment) {
    fail("unblinding key commitment does not match the blind bundle");
  }
  exactRecord(ratings, ["schemaVersion", "evaluationId", "reviewerId", "samples"], "ratings");
  if (ratings.schemaVersion !== RATINGS_SCHEMA || ratings.evaluationId !== blindBundle.evaluationId) {
    fail("ratings identity is invalid");
  }
  bounded(ratings.reviewerId, "reviewerId", 200);
  if (!Array.isArray(ratings.samples) || ratings.samples.length !== blindBundle.samples.length) {
    fail("ratings must cover every blinded sample exactly once");
  }
  if (!Array.isArray(unblindingKey.mappings) || unblindingKey.mappings.length !== blindBundle.samples.length) {
    fail("unblinding key must cover every blinded sample exactly once");
  }
  const ratingBySample = new Map(ratings.samples.map((sample) => [sample.sampleId, sample]));
  const mappingBySample = new Map(unblindingKey.mappings.map((sample) => [sample.sampleId, sample]));
  if (mappingBySample.size !== blindBundle.samples.length) fail("unblinding key contains a duplicate sample");
  const results = blindBundle.samples.map((sample) => {
    const sampleRatings = ratingBySample.get(sample.sampleId);
    const sampleMapping = mappingBySample.get(sample.sampleId);
    if (!sampleRatings || !sampleMapping) fail(`sample ${sample.sampleId} is missing ratings or an unblinding mapping`);
    exactRecord(sampleMapping, ["sampleId", "evidencePack", "candidates"], `mapping ${sample.sampleId}`);
    if (canonicalJson(sampleMapping.evidencePack) !== canonicalJson(packRef(sample.evidencePack))
      || !Array.isArray(sampleMapping.candidates) || sampleMapping.candidates.length !== 2) {
      fail(`sample ${sample.sampleId} mapping does not bind the frozen evidence pack and two candidates`);
    }
    exactRecord(sampleRatings, ["sampleId", "candidates"], `ratings sample ${sample.sampleId}`);
    if (!Array.isArray(sampleRatings.candidates) || sampleRatings.candidates.length !== 2) {
      fail(`sample ${sample.sampleId} must rate exactly two candidates`);
    }
    const candidates = new Map(sample.candidates.map((candidate) => [candidate.label, candidate]));
    const rated = new Map(sampleRatings.candidates.map((rating) => {
      validateRating(rating, candidates, sample.evidencePack, sample.sampleId);
      return [rating.label, rating];
    }));
    if (rated.size !== 2 || !rated.has("A") || !rated.has("B")) fail(`sample ${sample.sampleId} ratings must cover A and B`);
    const roles = new Map(sampleMapping.candidates.map((candidate) => {
      exactRecord(candidate, ["label", "role", "fingerprint"], `mapping candidate ${sample.sampleId}`);
      const blind = candidates.get(candidate.label);
      if (!blind || blind.fingerprint !== candidate.fingerprint
        || !["primary", "optional_second_opinion"].includes(candidate.role)) {
        fail(`sample ${sample.sampleId} mapping does not match the blind candidates`);
      }
      return [candidate.role, candidate.label];
    }));
    if (new Set(sampleMapping.candidates.map((candidate) => candidate.label)).size !== 2) {
      fail(`sample ${sample.sampleId} mapping must cover both blind labels`);
    }
    const primary = rated.get(roles.get("primary"));
    const optional = rated.get(roles.get("optional_second_opinion"));
    if (!primary || !optional || roles.size !== 2) fail(`sample ${sample.sampleId} mapping must contain both roles`);
    const primaryFindings = new Set([...primary.additionalCounterEvidenceIds, ...primary.detectedErrorEvidenceIds]);
    const optionalNovelFindings = [...new Set([
      ...optional.additionalCounterEvidenceIds,
      ...optional.detectedErrorEvidenceIds
    ])].filter((id) => !primaryFindings.has(id));
    const addedValue = optionalNovelFindings.length > 0
      && optional.qualityScore >= primary.qualityScore
      && optional.unsupportedClaimCount <= primary.unsupportedClaimCount;
    return {
      sampleId: sample.sampleId,
      optionalNovelFindings,
      primaryQualityScore: primary.qualityScore,
      optionalQualityScore: optional.qualityScore,
      primaryUnsupportedClaimCount: primary.unsupportedClaimCount,
      optionalUnsupportedClaimCount: optional.unsupportedClaimCount,
      addedValue
    };
  });
  if (ratingBySample.size !== blindBundle.samples.length) fail("ratings contain an unknown or duplicate sample");
  const stableThreshold = Math.ceil(results.length * 2 / 3);
  const addedValueSamples = results.filter((sample) => sample.addedValue).length;
  const primaryAverage = average(results.map((sample) => sample.primaryQualityScore));
  const optionalAverage = average(results.map((sample) => sample.optionalQualityScore));
  const primaryUnsupportedClaimCount = results.reduce((sum, sample) => sum + sample.primaryUnsupportedClaimCount, 0);
  const optionalUnsupportedClaimCount = results.reduce((sum, sample) => sum + sample.optionalUnsupportedClaimCount, 0);
  const eligible = results.length >= 3 && addedValueSamples >= stableThreshold
    && optionalAverage >= primaryAverage && optionalUnsupportedClaimCount <= primaryUnsupportedClaimCount;
  return {
    schemaVersion: RESULT_SCHEMA,
    evaluationId: blindBundle.evaluationId,
    reviewerId: ratings.reviewerId,
    sampleCount: results.length,
    stableThreshold,
    addedValueSamples,
    primaryAverageQualityScore: primaryAverage,
    optionalAverageQualityScore: optionalAverage,
    primaryUnsupportedClaimCount,
    optionalUnsupportedClaimCount,
    samples: results,
    dependencyDecision: eligible ? "eligible_for_beta_consideration" : "keep_absent",
    dependencyIncluded: false,
    ownerDecisionRequired: true,
    message: eligible
      ? "Blinded real-sample evidence met the bounded consideration threshold; integration still requires an explicit owner decision."
      : "Stable additional counterevidence or error-detection value was not demonstrated; keep the optional dependency absent."
  };
}

function validateBlindBundle(bundle, now) {
  exactRecord(bundle, ["schemaVersion", "evaluationId", "keyCommitment", "samples"], "blind bundle");
  if (bundle.schemaVersion !== BLIND_SCHEMA || !fingerprint(bundle.keyCommitment)) fail("blind bundle identity is invalid");
  bounded(bundle.evaluationId, "evaluationId", 200);
  if (!Array.isArray(bundle.samples) || bundle.samples.length < 1 || bundle.samples.length > 20) fail("blind samples are invalid");
  const ids = new Set();
  const packIdentities = new Set();
  for (const sample of bundle.samples) {
    exactRecord(sample, ["sampleId", "classification", "evidencePack", "candidates"], "blind sample");
    bounded(sample.sampleId, "sampleId", 200);
    if (ids.has(sample.sampleId) || sample.classification !== "authorized_real_sample") fail("blind sample identity is invalid");
    ids.add(sample.sampleId);
    validatePack(sample.evidencePack);
    const packIdentity = canonicalJson(packRef(sample.evidencePack));
    if (packIdentities.has(packIdentity)) fail(`sample ${sample.sampleId} reuses another blinded evidence pack`);
    packIdentities.add(packIdentity);
    if (!Array.isArray(sample.candidates) || sample.candidates.length !== 2
      || sample.candidates.map((candidate) => candidate.label).sort().join("") !== "AB") {
      fail(`sample ${sample.sampleId} blind candidates are invalid`);
    }
    for (const candidate of sample.candidates) {
      exactRecord(candidate, ["label", "fingerprint", "report"], "blind candidate");
      if (!fingerprint(candidate.fingerprint)
        || sha256(canonicalJson(candidate.report)) !== candidate.fingerprint) fail("blind candidate fingerprint is invalid");
      output("blinded", candidate.report, sample.evidencePack, sample.sampleId, now);
    }
  }
}

function output(role, report, pack, sampleId, now) {
  const validation = validateLegacyDeepResearchReportPayload(report);
  if (!validation.ok) fail(`sample ${sampleId} ${role} report is malformed: ${validation.errors.join("; ")}`);
  const failures = deepResearchGateFailures(report, pack, now);
  if (failures.length) fail(`sample ${sampleId} ${role} report fails the objective gate: ${failures.join("; ")}`);
  return { role, fingerprint: sha256(canonicalJson(report)), report };
}

function validatePack(pack) {
  const validation = validateResearchEvidencePackData(pack);
  if (!validation.ok) fail(validation.errors.join("; "));
  if (evidencePackFingerprint(
    pack.membershipId,
    pack.membershipVersion,
    pack.items,
    pack.frozenResearchContext === null ? undefined : pack.frozenResearchContext
  ) !== pack.packFingerprint) {
    fail("evidence pack fingerprint is invalid");
  }
}

function packRef(pack) {
  return {
    id: pack.id,
    membershipId: pack.membershipId,
    membershipVersion: pack.membershipVersion,
    version: pack.version,
    packFingerprint: pack.packFingerprint
  };
}

function validateRating(rating, candidates, pack, sampleId) {
  exactRecord(rating, [
    "label", "qualityScore", "additionalCounterEvidenceIds",
    "detectedErrorEvidenceIds", "unsupportedClaimCount"
  ], `rating ${sampleId}`);
  const candidate = candidates.get(rating.label);
  if (!candidate || !Number.isInteger(rating.qualityScore) || rating.qualityScore < 1 || rating.qualityScore > 5
    || !Number.isInteger(rating.unsupportedClaimCount) || rating.unsupportedClaimCount < 0) {
    fail(`sample ${sampleId} rating score is invalid`);
  }
  const packIds = new Set(pack.items.map((item) => item.evidenceId));
  idList(rating.additionalCounterEvidenceIds, `sample ${sampleId} additional counterevidence`);
  idList(rating.detectedErrorEvidenceIds, `sample ${sampleId} detected errors`);
  if (rating.additionalCounterEvidenceIds.some((id) => !candidate.report.counterEvidenceIds.includes(id))
    || [...rating.additionalCounterEvidenceIds, ...rating.detectedErrorEvidenceIds].some((id) => !packIds.has(id))) {
    fail(`sample ${sampleId} rating cites evidence outside the candidate report or frozen pack`);
  }
}

function idList(value, label) {
  if (!Array.isArray(value) || value.length > 100 || new Set(value).size !== value.length
    || value.some((item) => typeof item !== "string" || !item.trim() || item.length > 200)) fail(`${label} is invalid`);
}

function average(values) {
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

function exactRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    fail(`${label} fields are invalid`);
  }
}
function bounded(value, label, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${label} is invalid`);
}
function fingerprint(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function fail(message) {
  throw new Error(message);
}

async function main(args = process.argv.slice(2)) {
  if (args[0] === "prepare" && args.length === 3) {
    const input = JSON.parse(await readFile(resolve(args[1]), "utf8"));
    const prepared = prepareBlindedEvaluation(input);
    const outputDirectory = resolve(args[2]);
    await mkdir(outputDirectory);
    await Promise.all([
      writeFile(resolve(outputDirectory, "blind-bundle.json"), `${JSON.stringify(prepared.blindBundle, null, 2)}\n`, { flag: "wx" }),
      writeFile(resolve(outputDirectory, "unblinding-key.json"), `${JSON.stringify(prepared.unblindingKey, null, 2)}\n`, { flag: "wx" })
    ]);
    process.stdout.write(`${JSON.stringify({ ok: true, outputDirectory, keyCommitment: prepared.blindBundle.keyCommitment })}\n`);
    return;
  }
  if (args[0] === "score" && args.length === 4) {
    const [blindBundle, ratings, key] = await Promise.all(args.slice(1).map(async (path) =>
      JSON.parse(await readFile(resolve(path), "utf8"))
    ));
    process.stdout.write(`${JSON.stringify(scoreBlindedEvaluation(blindBundle, ratings, key), null, 2)}\n`);
    return;
  }
  fail("usage: deep-research-blind-evaluation prepare <input.json> <new-output-dir> | score <blind.json> <ratings.json> <key.json>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
