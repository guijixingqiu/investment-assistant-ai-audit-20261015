#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactDir = resolvePath(process.env.QUANT_PORTFOLIO_AUDIT_ARTIFACT_DIR ?? "artifacts/quant-portfolio-smoke/latest");
const configPath = process.env.QUANT_PORTFOLIO_SMOKE_CONFIG ?? "config/quant-portfolio-smoke.hk-multi-symbol.json";

const manifest = await readJson("run_manifest.json");
const configQuality = await readJson("config-quality.json");
const dataQuality = await readJson("data-quality.json");
const snapshotIntegrity = await readJson("snapshot-integrity.json");
const signals = await readJson("signals.json");
const orders = await readJson("orders.json");
const trades = await readJson("trades.json");
const ledger = await readJson("ledger.json");
const positions = await readJson("positions.json");
const nav = await readJson("nav.json");
const snapshot = JSON.parse(await readFile(resolvePath(manifest.snapshotPath), "utf8"));

const checks = [];
const blockers = [];

check("manifest uses frozen snapshot", manifest.safety?.readsFrozenSnapshot === true, "run_manifest.json");
check("manifest does not send live network requests", manifest.safety?.sendsLiveNetworkRequests === false, "run_manifest.json");
check("manifest does not write production database", manifest.safety?.writesProductionDatabase === false, "run_manifest.json");
check("manifest does not enable trading", manifest.safety?.enablesTrading === false, "run_manifest.json");
check("manifest does not initialize broker gateway", manifest.safety?.initializesBrokerGateway === false, "run_manifest.json");
check("config quality passed", configQuality.ok === true, "config-quality.json");
check("data quality passed", dataQuality.ok === true && dataQuality.duplicateCount === 0 && dataQuality.missingCriticalCount === 0, "data-quality.json");
check("snapshot canonical integrity passed", snapshotIntegrity.ok === true && snapshotIntegrity.checks?.dataHash === true && snapshotIntegrity.checks?.snapshotId === true, "snapshot-integrity.json");
check("signals have next execution dates only after signal dates", signals.every((signal) => !signal.earliestExecutionDate || signal.signalDate < signal.earliestExecutionDate), "signals.json");
check("orders are next-day or later", orders.every((order) => order.signalDate < order.tradeDate), "orders.json");
check("trades are next-day or later", trades.every((trade) => trade.signalDate < trade.tradeDate), "trades.json");
check("no same-bar executions", trades.every((trade) => trade.sameBarExecution === false), "trades.json");
check("fees are nonzero", trades.length > 0 && trades.every((trade) => trade.totalFees > 0), "trades.json");
check("lot rounding is valid", orders.every((order) => Number.isFinite(order.boardLot) && order.boardLot > 0 && order.roundedToBoardLot === true && order.quantity % order.boardLot === 0), "orders.json");
check("cash never negative", ledger.every((row) => row.cash >= 0 && row.endingCash >= 0), "ledger.json");
check("positions include all universe symbols on every NAV date", positionsCoverUniverse(), "positions.json");
check("nav final equity matches manifest", nav.at(-1)?.equity === manifest.metrics?.finalEquity, "nav.json");
check("turnover recorded", nav.every((row) => Number.isFinite(row.turnoverOneWay) && Number.isFinite(row.turnoverTwoWay) && Math.abs(row.turnoverOneWay * 2 - row.turnoverTwoWay) < 1e-8) && Number.isFinite(manifest.metrics?.turnoverOneWay) && Number.isFinite(manifest.metrics?.turnoverTwoWay), "run_manifest.json");
check("at least two symbols traded", Array.isArray(manifest.metrics?.tradedSymbols) && manifest.metrics.tradedSymbols.length >= 2, "run_manifest.json");
check("data hash matches snapshot identity", await dataHashMatchesSnapshot(), manifest.snapshotPath);
check("config hash matches config file", manifest.configHash === await hashFile(configPath), configPath);
const accounting = independentAccountingChecks();
check("independent accounting ledger matches artifacts", accounting.ok, accounting);

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
  goNoGo: blockers.length === 0 ? "quant_portfolio_audit_passed" : "no_go_fix_quant_portfolio_audit_blockers"
};

await writeFile(join(artifactDir, "quant-portfolio-audit.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

async function rerunAndCompare() {
  const before = await coreHashes();
  const run = await execFileAsync("npm", ["run", "quant-portfolio-smoke"], {
    cwd: root,
    env: {
      ...process.env,
      QUANT_PORTFOLIO_SMOKE_CONFIG: configPath
    },
    maxBuffer: 40 * 1024 * 1024
  });
  const after = await coreHashes();
  const mismatches = Object.keys(before).filter((key) => before[key] !== after[key]);
  return {
    ok: mismatches.length === 0,
    command: "npm run quant-portfolio-smoke",
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
    "positions.json",
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
    "scripts/quant-portfolio-smoke.mjs",
    "scripts/quant-portfolio-audit.mjs",
    "config/quant-portfolio-smoke.hk-multi-symbol.json"
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
        if (file === "scripts/quant-portfolio-audit.mjs") {
          warnings.push({ ...hit, reason: "audit script contains forbidden-pattern detector text" });
        } else {
          errors.push(hit);
        }
      }
    });
  }
  return { status: "completed", scannedFileCount: files.length, scannedFiles: files, hitCount: errors.length + warnings.length, ok: errors.length === 0, errors, warnings };
}

function independentAccountingChecks() {
  const issues = [];
  const feeNames = ["commission", "platformFee", "stampDuty", "tradingFee", "tradingTariff", "transactionLevy", "afrc", "settlementFee"];
  const universeSymbols = (manifest.universe ?? []).map((item) => item.symbol);
  const reconstructedShares = new Map(universeSymbols.map((symbol) => [symbol, 0]));
  const snapshotBars = (snapshot.bars ?? []).map((bar) => ({ ...bar, symbol: `${bar.market}.${bar.code}`, close: Number(bar.close) }));
  const ledgerByDate = new Map(ledger.map((row) => [row.tradeDate, row]));
  const posByDate = groupByArray(positions, (row) => row.tradeDate);
  const tradesByDate = groupByArray(trades, (row) => row.tradeDate);
  let reconstructedCash = Number(manifest.initialCash);
  let previousEquity = Number(manifest.initialCash);
  for (const row of nav) {
    const ledgerRow = ledgerByDate.get(row.tradeDate);
    if (!ledgerRow) {
      issues.push({ type: "missing_ledger_row", tradeDate: row.tradeDate });
      continue;
    }
    compareAmount(issues, "ledger_starting_cash_mismatch", row.tradeDate, reconstructedCash, ledgerRow.startingCash);
    compareShares(issues, "ledger_starting_shares_mismatch", row.tradeDate, reconstructedShares, ledgerRow.startingShares);
    for (const trade of tradesByDate.get(row.tradeDate) ?? []) {
      const gross = round(trade.quantity * trade.price);
      if (gross !== trade.grossAmount) issues.push({ type: "gross_amount_mismatch", tradeId: trade.tradeId, expected: gross, actual: trade.grossAmount });
      const feeTotal = round(feeNames.reduce((sum, name) => sum + Number(trade.fees?.[name] ?? 0), 0));
      if (feeTotal !== trade.totalFees) issues.push({ type: "fee_total_mismatch", tradeId: trade.tradeId, expected: feeTotal, actual: trade.totalFees });
      compareAmount(issues, "trade_cash_before_mismatch", trade.tradeId, reconstructedCash, trade.cashBefore);
      if (!(trade.signalDate < trade.tradeDate) || trade.sameBarExecution !== false) issues.push({ type: "next_day_execution_mismatch", tradeId: trade.tradeId });
      const beforeShares = reconstructedShares.get(trade.symbol) ?? 0;
      if (trade.side === "buy") {
        reconstructedCash = round(reconstructedCash - gross - feeTotal);
        reconstructedShares.set(trade.symbol, beforeShares + trade.quantity);
      } else if (trade.side === "sell") {
        if (trade.quantity > beforeShares) issues.push({ type: "oversell", tradeId: trade.tradeId, available: beforeShares, quantity: trade.quantity });
        reconstructedCash = round(reconstructedCash + gross - feeTotal);
        reconstructedShares.set(trade.symbol, beforeShares - trade.quantity);
      } else {
        issues.push({ type: "invalid_trade_side", tradeId: trade.tradeId, side: trade.side });
      }
      compareAmount(issues, "trade_cash_after_mismatch", trade.tradeId, reconstructedCash, trade.cashAfter);
      if ((reconstructedShares.get(trade.symbol) ?? 0) !== trade.sharesAfter) issues.push({ type: "trade_shares_after_mismatch", tradeId: trade.tradeId, expected: reconstructedShares.get(trade.symbol), actual: trade.sharesAfter });
    }
    compareAmount(issues, "ledger_ending_cash_mismatch", row.tradeDate, reconstructedCash, ledgerRow.endingCash);
    compareAmount(issues, "ledger_cash_mismatch", row.tradeDate, reconstructedCash, ledgerRow.cash);
    compareShares(issues, "ledger_ending_shares_mismatch", row.tradeDate, reconstructedShares, ledgerRow.endingShares);
    const dayPositions = posByDate.get(row.tradeDate) ?? [];
    let marketValue = 0;
    for (const symbol of universeSymbols) {
      const pos = dayPositions.find((item) => item.symbol === symbol);
      if (!pos) {
        issues.push({ type: "missing_position", tradeDate: row.tradeDate, symbol });
        continue;
      }
      const expectedShares = reconstructedShares.get(symbol) ?? 0;
      if (pos.shares !== expectedShares) issues.push({ type: "position_shares_mismatch", tradeDate: row.tradeDate, symbol, expected: expectedShares, actual: pos.shares });
      const valuationBar = latestValuationBar(snapshotBars, symbol, row.tradeDate);
      const expectedClose = Number(valuationBar?.close ?? 0);
      compareAmount(issues, "position_close_mismatch", `${row.tradeDate}:${symbol}`, expectedClose, pos.close);
      const expectedMarketValue = round(expectedShares * expectedClose);
      compareAmount(issues, "position_market_value_mismatch", `${row.tradeDate}:${symbol}`, expectedMarketValue, pos.marketValue);
      marketValue = round(marketValue + expectedMarketValue);
    }
    compareAmount(issues, "nav_cash_mismatch", row.tradeDate, reconstructedCash, row.cash);
    compareAmount(issues, "nav_market_value_mismatch", row.tradeDate, marketValue, row.marketValue);
    const equity = round(reconstructedCash + marketValue);
    compareAmount(issues, "nav_equity_mismatch", row.tradeDate, equity, row.equity);
    const grossExposure = equity > 0 ? round(marketValue / equity, 8) : 0;
    if (Math.abs(grossExposure - row.grossExposure) > 1e-8) issues.push({ type: "gross_exposure_mismatch", tradeDate: row.tradeDate, expected: grossExposure, actual: row.grossExposure });
    if (row.grossExposure - Number(manifest.targetGrossExposure) > 1e-6) issues.push({ type: "gross_exposure_limit_exceeded", tradeDate: row.tradeDate, actual: row.grossExposure, limit: manifest.targetGrossExposure });
    const traded = (tradesByDate.get(row.tradeDate) ?? []).reduce((sum, trade) => sum + trade.grossAmount, 0);
    const twoWay = previousEquity > 0 ? round(traded / previousEquity, 8) : 0;
    const oneWay = round(twoWay / 2, 8);
    if (oneWay !== row.turnoverOneWay || twoWay !== row.turnoverTwoWay) issues.push({ type: "turnover_mismatch", tradeDate: row.tradeDate, expectedOneWay: oneWay, actualOneWay: row.turnoverOneWay, expectedTwoWay: twoWay, actualTwoWay: row.turnoverTwoWay });
    if (reconstructedCash < -1e-8) issues.push({ type: "negative_cash", tradeDate: row.tradeDate, actual: reconstructedCash });
    previousEquity = equity;
  }
  return { ok: issues.length === 0, issues };
}

function latestValuationBar(items, symbol, tradeDate) {
  return items.filter((bar) => bar.symbol === symbol && bar.tradeDate <= tradeDate && Number.isFinite(bar.close) && bar.close > 0).sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))[0] ?? null;
}

function compareAmount(issues, type, key, expected, actual) {
  const expectedNumber = Number(expected);
  const actualNumber = Number(actual);
  if (!Number.isFinite(expectedNumber) || !Number.isFinite(actualNumber) || Math.abs(expectedNumber - actualNumber) > 1e-8) {
    issues.push({ type, key, expected, actual });
  }
}

function compareShares(issues, type, tradeDate, expectedMap, actual) {
  for (const [symbol, expected] of expectedMap.entries()) {
    if (Number(actual?.[symbol]) !== expected) issues.push({ type, tradeDate, symbol, expected, actual: actual?.[symbol] });
  }
}

function groupByArray(items, keyFn) { const out = new Map(); for (const item of items) { const key = keyFn(item); if (!out.has(key)) out.set(key, []); out.get(key).push(item); } return out; }

function round(value, digits = 2) { const scale = 10 ** digits; return Math.round((Number(value) + Number.EPSILON) * scale) / scale; }

function positionsCoverUniverse() {
  const universeSymbols = (manifest.universe ?? []).map((item) => item.symbol).sort();
  const navDates = nav.map((row) => row.tradeDate);
  if (universeSymbols.length < 2 || navDates.length === 0) return false;
  for (const tradeDate of navDates) {
    const symbols = positions
      .filter((row) => row.tradeDate === tradeDate)
      .map((row) => row.symbol)
      .sort();
    if (symbols.join("|") !== universeSymbols.join("|")) return false;
  }
  return true;
}

async function readJson(name) {
  return JSON.parse(await readFile(join(artifactDir, name), "utf8"));
}

async function dataHashMatchesSnapshot() {
  const snapshot = JSON.parse(await readFile(resolvePath(manifest.snapshotPath), "utf8"));
  if (snapshot.dataHash) {
    return manifest.snapshotId === snapshot.snapshotId && manifest.dataHash === snapshot.dataHash;
  }
  const fileHash = await hashFile(manifest.snapshotPath);
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
