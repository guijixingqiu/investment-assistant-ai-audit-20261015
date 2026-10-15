#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { verifyRecoveryEvidence } from "./lib/recovery-evidence.mjs";

const manifestPath = process.env.RECOVERY_EVIDENCE_MANIFEST;
const expectedCommitSha = process.env.RECOVERY_EVIDENCE_EXPECTED_COMMIT
  ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!manifestPath) {
  console.error("RECOVERY_EVIDENCE_MANIFEST is required; no backup, restore, or rollback evidence is claimed.");
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  console.error("RECOVERY_EVIDENCE_MANIFEST must be readable valid JSON.");
  process.exit(1);
}

const result = verifyRecoveryEvidence(manifest, expectedCommitSha);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
