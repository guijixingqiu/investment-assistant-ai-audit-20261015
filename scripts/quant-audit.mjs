#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactDir = resolvePath(process.env.QUANT_AUDIT_ARTIFACT_DIR ?? "artifacts/quant-smoke/latest");
const configPath = process.env.QUANT_SMOKE_CONFIG ?? "config/quant-smoke.hk-09926.json";

const manifest = await readJson("run_manifest.json");
const configQuality = await readJson("config-quality.json");
const dataQuality = await readJson("data-quality.json");
const signals = await readJson("signals.json");
const orders = await readJson("orders.json");
const trades = await readJson("trades.json");
const ledger = await readJson("ledger.json");
const nav = await readJson("nav.json");

const checks = [];
const blockers = [];

check("manifest uses frozen snapshot", manifest.safety?.readsFrozenSnapshot === true, "run_manifest.json");
check("manifest does not send live network requests", manifest.safety?.sendsLiveNetworkRequests === false, "run_manifest.json");
check("manifest does not write production database", manifest.safety?.writesProductionDatabase === false, "run_manifest.json");
check("manifest does not enable trading", manifest.safety?.enablesTrading === false, "run_manifest.json");
check("config quality passed", configQuality.ok === true, "config-quality.json");
check("data quality passed", dataQuality.ok === true && dataQuality.duplicateCount === 0 && dataQuality.missingCriticalCount === 0, "data-quality.json");
check("signals have next execution dates only after signal dates", signals.every((signal) => !signal.earliestExecutionDate || signal.signalDate < signal.earliestExecutionDate), "signals.json");
check("orders are next-day or later", orders.every((order) => order.signalDate < order.tradeDate), "orders.json");
check("trades are next-day or later", trades.every((trade) => trade.signalDate < trade.tradeDate), "trades.json");
check("no same-bar executions", trades.every((trade) => trade.sameBarExecution === false), "trades.json");
check("fees are nonzero", trades.length > 0 && trades.every((trade) => trade.totalFees > 0), "trades.json");
check("lot rounding is valid", orders.every((order) => order.roundedToBoardLot === true && order.quantity % order.boardLot === 0), "orders.json");
check("cash never negative", ledger.every((row) => row.cash >= 0 && row.endingCash >= 0), "ledger.json");
check("nav final equity matches manifest", nav.at(-1)?.equity === manifest.metrics?.finalEquity, "nav.json");
check("turnover recorded", Number.isFinite(manifest.metrics?.turnoverOneWay) && Number.isFinite(manifest.metrics?.turnoverTwoWay), "run_manifest.json");
check("at least five hand-checkable trades", trades.length >= 5, "trades.json");
check("data hash matches snapshot identity", await dataHashMatchesSnapshot(), manifest.snapshotPath);
check("config hash matches config file", manifest.configHash === await hashFile(configPath), configPath);

const sourceScan = await scanSources();
check("no code-level forbidden quant patterns", sourceScan.errors.length === 0, sourceScan);

const reproducibility = await rerunAndCompare();
check("rerun core result hashes match", reproducibility.ok, reproducibility);

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  artifactDir: relative(artifactDir),
  checks,
  blockers,
  sourceScan,
  reproducibility,
  metrics: manifest.metrics,
  safety: manifest.safety,
  goNoGo: blockers.length === 0 ? "quant_audit_passed" : "no_go_fix_quant_audit_blockers"
};

await writeFile(join(artifactDir, "quant-audit.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

async function rerunAndCompare() {
  const before = await coreHashes();
  const run = await execFileAsync(process.execPath, ["scripts/quant-smoke.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      QUANT_SMOKE_CONFIG: configPath
    },
    maxBuffer: 20 * 1024 * 1024
  });
  const after = await coreHashes();
  const mismatches = Object.keys(before).filter((key) => before[key] !== after[key]);
  return {
    ok: mismatches.length === 0,
    command: "node scripts/quant-smoke.mjs",
    stdoutPreview: run.stdout.slice(0, 1200),
    comparedFiles: Object.keys(before),
    mismatches,
    before,
    after
  };
}

async function coreHashes() {
  const names = [
    "config-quality.json",
    "data-quality.json",
    "signals.json",
    "orders.json",
    "trades.json",
    "ledger.json",
    "nav.json"
  ];
  const out = {};
  for (const name of names) {
    out[name] = await hashAbsolute(join(artifactDir, name));
  }
  return out;
}

async function scanSources() {
  const files = [
    "scripts/quant-smoke.mjs",
    "scripts/quant-audit.mjs",
    "config/quant-smoke.hk-09926.json"
  ];
  const rules = [
    ["shift_negative", /shift\s*\(\s*-/],
    ["future_index", /iloc\s*\[\s*i\s*\+/],
    ["centered_rolling", /center\s*=\s*true/i],
    ["backfill", /\bbfill\s*\(/],
    ["place" + "_order", new RegExp("\\bplace_" + "order\\b", "i")],
    ["submit" + "_order", new RegExp("\\bsubmit_" + "order\\b", "i")],
    ["unlock" + "_trade", new RegExp("\\bunlock_" + "trade\\b", "i")]
  ];
  const warnings = [];
  const errors = [];
  for (const file of files) {
    const lines = (await readFile(resolvePath(file), "utf8")).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const [rule, pattern] of rules) {
        if (!pattern.test(line)) continue;
        const hit = { file, line: index + 1, rule };
        if (file === "scripts/quant-audit.mjs") {
          warnings.push({ ...hit, reason: "audit script contains forbidden-pattern detector text" });
        } else {
          errors.push(hit);
        }
      }
    });
  }
  return { ok: errors.length === 0, errors, warnings };
}

async function readJson(name) {
  return JSON.parse(await readFile(join(artifactDir, name), "utf8"));
}

async function dataHashMatchesSnapshot() {
  const snapshot = JSON.parse(await readFile(resolvePath(manifest.snapshotPath), "utf8"));
  const fileHash = await hashFile(manifest.snapshotPath);
  if (snapshot.dataHash) {
    return manifest.dataHash === snapshot.dataHash && manifest.snapshotFileHash === fileHash;
  }
  return manifest.dataHash === fileHash;
}

async function hashFile(path) {
  return hashAbsolute(resolvePath(path));
}

async function hashAbsolute(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function check(id, ok, evidence) {
  const item = { id, ok, evidence };
  checks.push(item);
  if (!ok) blockers.push(item);
}

function resolvePath(path) {
  return String(path).startsWith("/") ? String(path) : join(root, String(path));
}

function relative(path) {
  return path.startsWith(root) ? path.slice(root.length + 1) : path;
}
