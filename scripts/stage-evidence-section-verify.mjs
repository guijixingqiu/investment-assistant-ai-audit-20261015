#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  selectStageEvidenceSection,
  verifyAsyncCapacityStage,
  verifyControlledPersistenceStage,
  verifyRealDataQuantStage,
  verifyStage13To20Envelope
} from "./lib/stage-13-20-evidence.mjs";

const stageId = process.env.STAGE_13_20_STAGE ?? "";
const manifestPath = process.env.STAGE_13_20_SECTION_MANIFEST ?? "";
const expectedCommitSha = process.env.STAGE_13_20_EXPECTED_COMMIT_SHA ?? "";
const verifiers = {
  "CONTROLLED-PERSISTENCE-1": verifyControlledPersistenceStage,
  "REAL-DATA-QUANT-1": verifyRealDataQuantStage,
  "ASYNC-CAPACITY-DECISION-1": verifyAsyncCapacityStage
};
const verifier = verifiers[stageId];
if (!verifier || !manifestPath || !expectedCommitSha) {
  console.error("A supported STAGE_13_20_STAGE, STAGE_13_20_SECTION_MANIFEST, and STAGE_13_20_EXPECTED_COMMIT_SHA are required.");
  process.exit(2);
}

const input = JSON.parse(await readFile(manifestPath, "utf8"));
const envelope = input?.schemaVersion === "2026-07-12.stage-13-20-evidence.v1"
  ? verifyStage13To20Envelope(input, expectedCommitSha)
  : { ok: true, failures: [] };
const value = selectStageEvidenceSection(input, stageId);
const result = verifier(value, expectedCommitSha);
const output = {
  stageId,
  expectedCommitSha,
  ...result,
  ok: envelope.ok && result.ok,
  envelopeFailures: envelope.failures
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exit(1);
