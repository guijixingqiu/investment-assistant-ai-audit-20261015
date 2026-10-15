#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = process.env.QUANT_PIPELINE_CONFIG ?? "config/quant-pipeline.hk-09926.json";
const config = JSON.parse(await readText(configPath));
const outputDir = resolvePath(config.outputDir);
const pipelineSmokeConfigPath = join(outputDir, "quant-smoke.config.json");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const freeze = await runJson(process.execPath, ["scripts/quant-freeze-snapshot.mjs"], {
  QUANT_FREEZE_CONFIG: config.freezeConfigPath
});

const baseSmokeConfig = JSON.parse(await readText(config.smokeConfigPath));
const pipelineSmokeConfig = {
  ...baseSmokeConfig,
  snapshotPath: freeze.outputPath,
  outputDir: join(config.outputDir, "smoke")
};
await writeFile(pipelineSmokeConfigPath, JSON.stringify(pipelineSmokeConfig, null, 2) + "\n");

const smoke = await runJson(process.execPath, ["scripts/quant-smoke.mjs"], {
  QUANT_SMOKE_CONFIG: pipelineSmokeConfigPath
});
const audit = await runJson(process.execPath, ["scripts/quant-audit.mjs"], {
  QUANT_SMOKE_CONFIG: pipelineSmokeConfigPath,
  QUANT_AUDIT_ARTIFACT_DIR: pipelineSmokeConfig.outputDir
});

const frozenManifestPath = freeze.manifestPath;
const frozenSnapshotPath = freeze.outputPath;
await copyFile(resolvePath(frozenManifestPath), join(outputDir, "frozen-manifest.json"));
await copyFile(resolvePath(frozenSnapshotPath), join(outputDir, "frozen-snapshot.json"));

const smokeManifest = JSON.parse(await readFile(resolvePath(join(pipelineSmokeConfig.outputDir, "run_manifest.json")), "utf8"));
const result = {
  schemaVersion: "2026-06-20.quant-pipeline.run.v1",
  ok: true,
  goNoGo: "quant_pipeline_passed",
  generatedAt: new Date().toISOString(),
  configPath,
  configHash: sha256(await readText(configPath)),
  outputDir: config.outputDir,
  steps: {
    freeze,
    smoke,
    audit
  },
  linkage: {
    frozenSnapshotPath,
    smokeSnapshotPath: smokeManifest.snapshotPath,
    smokeUsesFrozenSnapshot: smokeManifest.snapshotPath === frozenSnapshotPath,
    frozenDataHash: freeze.dataHash,
    smokeDataHash: smokeManifest.dataHash,
    dataHashesMatch: freeze.dataHash === smokeManifest.dataHash
  },
  metrics: smokeManifest.metrics,
  safety: {
    sendsLiveNetworkRequests: false,
    writesProductionDatabase: false,
    enablesTrading: false,
    initializesBrokerGateway: false,
    mutatesOfficialPortfolio: false,
    mutatesOfficialReview: false,
    touchesRealTradesPositionsReviews: false
  },
  artifacts: [
    "run_manifest.json",
    "frozen-manifest.json",
    "frozen-snapshot.json",
    "quant-smoke.config.json",
    "smoke/run_manifest.json",
    "smoke/config-quality.json",
    "smoke/data-quality.json",
    "smoke/signals.json",
    "smoke/orders.json",
    "smoke/trades.json",
    "smoke/ledger.json",
    "smoke/nav.json",
    "smoke/report.md",
    "smoke/quant-audit.json"
  ]
};

if (!result.linkage.smokeUsesFrozenSnapshot || !result.linkage.dataHashesMatch || audit.ok !== true) {
  result.ok = false;
  result.goNoGo = "no_go_fix_quant_pipeline";
}

await writeFile(join(outputDir, "run_manifest.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

async function runJson(command, args, env) {
  const result = await execFileAsync(command, args, {
    cwd: root,
    env: {
      ...process.env,
      ...env
    },
    maxBuffer: 40 * 1024 * 1024
  });
  return parseLastJson(result.stdout);
}

function parseLastJson(text) {
  const trimmed = String(text).trim();
  const start = trimmed.lastIndexOf("\n{");
  const jsonText = start >= 0 ? trimmed.slice(start + 1) : trimmed;
  return JSON.parse(jsonText);
}

async function readText(path) {
  return readFile(resolvePath(path), "utf8");
}

function resolvePath(path) {
  return String(path).startsWith("/") ? String(path) : join(root, String(path));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
