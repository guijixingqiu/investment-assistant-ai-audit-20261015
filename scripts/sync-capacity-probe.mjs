#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { collectSyncCapacityMetrics } from "./lib/sync-capacity-probe.mjs";

const environment = process.env.SYNC_CAPACITY_ENVIRONMENT ?? "";
const expectedAuthorization = "授权采集 staging/production read-only capacity metrics";
if (process.env.SYNC_CAPACITY_AUTHORIZATION !== expectedAuthorization) {
  console.error(`SYNC_CAPACITY_AUTHORIZATION must equal: ${expectedAuthorization}`);
  process.exit(2);
}
const url = process.env.SYNC_CAPACITY_URL ?? "";
const headerName = process.env.SYNC_CAPACITY_AUTH_HEADER ?? "";
const token = process.env.SYNC_CAPACITY_AUTH_TOKEN ?? "";
const commitSha = process.env.SYNC_CAPACITY_COMMIT_SHA ?? "";
const outputPath = resolve(process.env.SYNC_CAPACITY_OUTPUT ?? "artifacts/stage-13-20/capacity-probe.json");
if (!/^[a-f0-9]{40}$/.test(commitSha)) {
  console.error("SYNC_CAPACITY_COMMIT_SHA must be an exact 40-character commit SHA.");
  process.exit(2);
}

const metrics = await collectSyncCapacityMetrics({
  url,
  environment,
  sampleSize: Number(process.env.SYNC_CAPACITY_SAMPLE_SIZE ?? "30"),
  thresholdMs: Number(process.env.SYNC_CAPACITY_THRESHOLD_MS ?? "500"),
  headers: headerName && token ? { [headerName]: token } : {}
});
const artifact = {
  ...metrics,
  commitSha,
  measuredAt: new Date().toISOString(),
  auth: { headerConfigured: Boolean(headerName), tokenProvided: Boolean(token), tokenPrinted: false }
};
const bytes = `${JSON.stringify(artifact, null, 2)}\n`;
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, bytes, { mode: 0o600 });
console.log(JSON.stringify({
  ok: true,
  outputPath,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  metric: artifact.metric,
  observed: artifact.observed,
  threshold: artifact.threshold,
  breached: artifact.breached,
  sampleSize: artifact.sampleSize,
  failures: artifact.failures,
  credentialsPrinted: false
}, null, 2));
