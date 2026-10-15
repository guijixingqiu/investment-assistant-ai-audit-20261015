#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { verifyStage13To20Evidence } from "./lib/stage-13-20-evidence.mjs";

const manifestPath = process.env.STAGE_13_20_EVIDENCE_MANIFEST ?? "";
const expectedCommitSha = process.env.STAGE_13_20_EXPECTED_COMMIT_SHA ?? "";
if (!manifestPath || !expectedCommitSha) {
  console.error("STAGE_13_20_EVIDENCE_MANIFEST and STAGE_13_20_EXPECTED_COMMIT_SHA are required.");
  process.exit(2);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const result = verifyStage13To20Evidence(manifest, expectedCommitSha);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
