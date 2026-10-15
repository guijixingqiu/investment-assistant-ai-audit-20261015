#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = process.env.QUANT_PORTFOLIO_PIPELINE_CONFIG ?? "config/quant-portfolio-pipeline.hk-multi-symbol.json";
const config = JSON.parse(await readText(configPath));
const outputDir = resolvePath(config.outputDir);
const pipelinePortfolioConfigPath = join(outputDir, "quant-portfolio-smoke.config.json");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const freeze = await runJson("npm", ["run", "quant-freeze-snapshot"], {
  QUANT_FREEZE_CONFIG: config.freezeConfigPath
});

const basePortfolioConfig = JSON.parse(await readText(config.portfolioConfigPath));
const pipelinePortfolioConfig = {
  ...basePortfolioConfig,
  freezeConfigPath: config.freezeConfigPath,
  snapshotPath: freeze.outputPath,
  outputDir: join(config.outputDir, "portfolio")
};
await writeFile(pipelinePortfolioConfigPath, JSON.stringify(pipelinePortfolioConfig, null, 2) + "\n");

const portfolio = await runJson("npm", ["run", "quant-portfolio-smoke"], {
  QUANT_PORTFOLIO_SMOKE_CONFIG: pipelinePortfolioConfigPath
});
const audit = await runJson("npm", ["run", "quant-portfolio-audit"], {
  QUANT_PORTFOLIO_SMOKE_CONFIG: pipelinePortfolioConfigPath,
  QUANT_PORTFOLIO_AUDIT_ARTIFACT_DIR: pipelinePortfolioConfig.outputDir
});

const frozenSnapshotPath = freeze.outputPath;
await copyIfExists(freeze.manifestPath, join(outputDir, "frozen-manifest.json"));
await copyFile(resolvePath(frozenSnapshotPath), join(outputDir, "frozen-snapshot.json"));

const portfolioManifest = JSON.parse(await readFile(resolvePath(join(pipelinePortfolioConfig.outputDir, "run_manifest.json")), "utf8"));
const result = {
  schemaVersion: "2026-06-21.quant-portfolio-pipeline.run.v1",
  ok: true,
  goNoGo: "quant_portfolio_pipeline_passed",
  generatedAt: new Date().toISOString(),
  configPath,
  configHash: sha256(await readText(configPath)),
  outputDir: config.outputDir,
  steps: {
    freeze,
    portfolio,
    audit
  },
  linkage: {
    frozenSnapshotPath,
    portfolioSnapshotPath: portfolioManifest.snapshotPath,
    portfolioUsesFrozenSnapshot: portfolioManifest.snapshotPath === frozenSnapshotPath,
    frozenDataHash: freeze.dataHash,
    portfolioDataHash: portfolioManifest.dataHash,
    dataHashesMatch: freeze.dataHash === portfolioManifest.dataHash
  },
  metrics: portfolioManifest.metrics,
  safety: {
    sendsLiveNetworkRequests: false,
    writesProductionDatabase: false,
    enablesTrading: false,
    initializesBrokerGateway: false,
    touchesRealTradesPositionsReviews: false
  },
  artifacts: [
    "run_manifest.json",
    "frozen-manifest.json",
    "frozen-snapshot.json",
    "quant-portfolio-smoke.config.json",
    "portfolio/run_manifest.json",
    "portfolio/config-quality.json",
    "portfolio/data-quality.json",
    "portfolio/signals.json",
    "portfolio/orders.json",
    "portfolio/trades.json",
    "portfolio/ledger.json",
    "portfolio/positions.json",
    "portfolio/nav.json",
    "portfolio/report.md",
    "portfolio/quant-portfolio-audit.json"
  ]
};

if (!result.linkage.portfolioUsesFrozenSnapshot || !result.linkage.dataHashesMatch || audit.ok !== true) {
  result.ok = false;
  result.goNoGo = "no_go_fix_quant_portfolio_pipeline";
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

async function copyIfExists(from, to) {
  if (!from) return;
  await copyFile(resolvePath(from), to);
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
