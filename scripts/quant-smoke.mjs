#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeHkCashEquityFees, feePolicySha256, FEE_POLICY_VERSION } from "./lib/hk-fee-policy.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = process.env.QUANT_SMOKE_CONFIG ?? "config/quant-smoke.hk-09926.json";
const config = JSON.parse(await readText(configPath));
const snapshot = JSON.parse(await readText(config.snapshotPath));
const outputDir = resolvePath(config.outputDir);

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const configQuality = checkConfig(config);
if (!configQuality.ok) {
  await writeJson("config-quality.json", configQuality);
  console.error(JSON.stringify(configQuality, null, 2));
  process.exit(1);
}

const configHash = sha256(await readText(configPath));
const snapshotFileHash = sha256(await readText(config.snapshotPath));
const dataHash = snapshot.dataHash ?? snapshotFileHash;
const commit = gitHead();

const bars = normalizeBars(snapshot.bars);
const symbolMeta = snapshot.universe[0];
const lotSize = Number(symbolMeta.lotSize);
const dataQuality = checkDataQuality(bars, snapshot, dataHash);
if (!dataQuality.ok) {
  await writeJson("data-quality.json", dataQuality);
  console.error(JSON.stringify(dataQuality, null, 2));
  process.exit(1);
}

const signals = generateSignals(bars, config);
const { orders, trades, ledger, nav } = executeLoop(bars, signals, config, lotSize);
const metrics = computeMetrics(nav, trades, config.initialCash);
const futureFunctionCheck = await scanOwnSources();
const manifest = {
  schemaVersion: "2026-06-20.quant-smoke.run.v1",
  generatedAt: new Date().toISOString(),
  feePolicyVersion: FEE_POLICY_VERSION,
  feePolicySha256: feePolicySha256(),
  executionCalendar: {
    timing: "next_observed_session_open",
    calendarCompleteness: "unknown",
    legacyConfigTiming: config.execution?.earliestExecution ?? null
  },
  commit,
  configPath,
  configHash,
  snapshotPath: config.snapshotPath,
  snapshotId: snapshot.snapshotId,
  dataHash,
  snapshotFileHash,
  universe: snapshot.universe,
  dateRange: {
    start: bars[0]?.tradeDate ?? null,
    end: bars.at(-1)?.tradeDate ?? null
  },
  initialCash: config.initialCash,
  experiment: config.experiment,
  adjustment: snapshot.adjustment,
  fees: config.fees,
  outputs: [
    "run_manifest.json",
    "config-quality.json",
    "data-quality.json",
    "signals.json",
    "orders.json",
    "trades.json",
    "ledger.json",
    "nav.json",
    "source-scan.json",
    "report.md"
  ],
  safety: {
    readsFrozenSnapshot: true,
    sendsLiveNetworkRequests: false,
    writesProductionDatabase: false,
    enablesTrading: false,
    touchesRealTradesPositionsReviews: false
  },
  reproducibility: {
    configHash,
    dataHash,
    snapshotFileHash
  },
  metrics
};

await writeJson("config-quality.json", configQuality);
await writeJson("data-quality.json", dataQuality);
await writeJson("signals.json", signals);
await writeJson("orders.json", orders);
await writeJson("trades.json", trades);
await writeJson("ledger.json", ledger);
await writeJson("nav.json", nav);
await writeJson("source-scan.json", futureFunctionCheck);
await writeJson("run_manifest.json", manifest);
await writeFile(join(outputDir, "report.md"), buildReport({ manifest, dataQuality, signals, orders, trades, ledger, nav, metrics, futureFunctionCheck }));

if (futureFunctionCheck.status !== "completed" || futureFunctionCheck.errors.length > 0) {
  console.error(JSON.stringify(futureFunctionCheck, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  goNoGo: "quant_smoke_passed",
  outputDir: config.outputDir,
  snapshotId: snapshot.snapshotId,
  dataHash,
  configHash,
  trades: trades.length,
  finalEquity: metrics.finalEquity,
  totalReturn: metrics.totalReturn,
  maxDrawdown: metrics.maxDrawdown,
  sharpe: metrics.sharpe,
  totalFees: metrics.totalFees,
  safety: manifest.safety
}, null, 2));

function normalizeBars(rawBars) {
  return rawBars.map((bar) => ({
    ...bar,
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volume),
    turnover: Number(bar.turnover)
  })).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

function checkConfig(cfg) {
  const issues = [];
  const fees = cfg.fees ?? {};
  const execution = cfg.execution ?? {};
  const experiment = cfg.experiment ?? {};

  for (const field of ["experimentId", "strategyVersion", "parameterSetId", "purpose"]) {
    if (typeof experiment[field] !== "string" || experiment[field].trim() === "") {
      issues.push({ level: "error", type: "missing_experiment_registry_field", field });
    }
  }

  if (!Number.isFinite(Number(cfg.initialCash)) || Number(cfg.initialCash) <= 0) {
    issues.push({ level: "error", type: "invalid_initial_cash", initialCash: cfg.initialCash });
  }
  if (!Number.isFinite(Number(cfg.targetGrossExposure)) || Number(cfg.targetGrossExposure) <= 0 || Number(cfg.targetGrossExposure) > 1) {
    issues.push({ level: "error", type: "invalid_target_gross_exposure", targetGrossExposure: cfg.targetGrossExposure });
  }
  if (execution.signalTiming !== "after_close_t") {
    issues.push({ level: "error", type: "invalid_signal_timing", signalTiming: execution.signalTiming });
  }
  if (execution.earliestExecution !== "next_trading_day_open") {
    issues.push({ level: "error", type: "invalid_earliest_execution", earliestExecution: execution.earliestExecution });
  }
  if (execution.priceField !== "open") {
    issues.push({ level: "error", type: "invalid_execution_price_field", priceField: execution.priceField });
  }
  if (execution.allowSameBarExecution !== false) {
    issues.push({ level: "error", type: "same_bar_execution_not_allowed", allowSameBarExecution: execution.allowSameBarExecution });
  }
  if (execution.allowMargin !== false) {
    issues.push({ level: "error", type: "margin_not_allowed", allowMargin: execution.allowMargin });
  }

  const feeFields = [
    "commissionRate",
    "minCommission",
    "platformFee",
    "stampDutyRate",
    "tradingFeeRate",
    "transactionLevyRate"
  ];
  for (const field of feeFields) {
    if (!Number.isFinite(Number(fees[field])) || Number(fees[field]) < 0) {
      issues.push({ level: "error", type: "invalid_fee_field", field, value: fees[field] });
    }
  }
  const feeTotal = feeFields.reduce((sum, field) => sum + (Number.isFinite(Number(fees[field])) ? Number(fees[field]) : 0), 0);
  if (feeTotal <= 0) {
    issues.push({ level: "error", type: "zero_fee_model_not_allowed" });
  }

  return {
    ok: issues.every((issue) => issue.level !== "error"),
    issues,
    experiment,
    execution,
    fees
  };
}

function checkDataQuality(items, data, hash) {
  const issues = [];
  const seen = new Set();
  const cutoffMs = Date.parse(data.dataCutoff);
  if (!Number.isFinite(cutoffMs)) {
    issues.push({ level: "error", type: "invalid_data_cutoff", dataCutoff: data.dataCutoff });
  }
  const expectedHash = recomputeSnapshotDataHash(data);
  if (data.dataHash && expectedHash !== data.dataHash) {
    issues.push({ level: "error", type: "snapshot_data_hash_mismatch", expectedHash, actualHash: data.dataHash });
  }
  for (let index = 0; index < items.length; index += 1) {
    const bar = items[index];
    const key = `${bar.market}.${bar.code}.${bar.tradeDate}`;
    if (seen.has(key)) issues.push({ level: "error", type: "duplicate_bar", key });
    seen.add(key);
    if (index > 0 && items[index - 1].tradeDate >= bar.tradeDate) {
      issues.push({ level: "error", type: "date_not_increasing", tradeDate: bar.tradeDate });
    }
    for (const field of ["open", "high", "low", "close"]) {
      if (!Number.isFinite(bar[field]) || bar[field] <= 0) {
        issues.push({ level: "error", type: "invalid_price", tradeDate: bar.tradeDate, field });
      }
    }
    if (bar.high < bar.low || bar.high < bar.open || bar.high < bar.close || bar.low > bar.open || bar.low > bar.close) {
      issues.push({ level: "error", type: "invalid_ohlc", tradeDate: bar.tradeDate });
    }
    if (!Number.isFinite(bar.volume) || bar.volume <= 0) {
      issues.push({ level: "warning", type: "not_tradeable_volume", tradeDate: bar.tradeDate });
    }
    if (bar.suspended === true || ["suspended", "halted"].includes(String(bar.tradingStatus ?? bar.tradeStatus ?? "").toLowerCase())) {
      issues.push({ level: "warning", type: "not_tradeable_suspended", tradeDate: bar.tradeDate });
    }
    const fetchedAtMs = Date.parse(bar.fetchedAt);
    if (!Number.isFinite(fetchedAtMs)) {
      issues.push({ level: "error", type: "invalid_fetched_at", key, fetchedAt: bar.fetchedAt });
    } else if (Number.isFinite(cutoffMs) && fetchedAtMs > cutoffMs) {
      issues.push({
        level: "error",
        type: "fetched_after_data_cutoff",
        key,
        fetchedAt: bar.fetchedAt,
        dataCutoff: data.dataCutoff
      });
    }
  }
  return {
    ok: issues.every((issue) => issue.level !== "error"),
    snapshotId: data.snapshotId,
    dataHash: hash,
    rows: items.length,
    dateRange: {
      start: items[0]?.tradeDate ?? null,
      end: items.at(-1)?.tradeDate ?? null
    },
    duplicateCount: issues.filter((issue) => issue.type === "duplicate_bar").length,
    missingCriticalCount: issues.filter((issue) => issue.type === "invalid_price").length,
    notTradeableCount: issues.filter((issue) => issue.type === "not_tradeable_volume").length,
    issues
  };
}

function recomputeSnapshotDataHash(data) {
  if (!data.dataHash) return null;
  const canonicalPayload = {
    schemaVersion: "2026-06-20.quant-snapshot.v1",
    sourceKind: data.source,
    sourcePath: data.sourcePath,
    sourceHash: data.sourceHash,
    adjustment: data.adjustment,
    dataCutoff: data.dataCutoff,
    universe: data.universe,
    dateRange: data.dateRange,
    bars: data.bars
  };
  return sha256(stableJson(canonicalPayload));
}

function generateSignals(items, cfg) {
  const out = [];
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    const closeReturn = (current.close - previous.close) / previous.close;
    let action = "hold";
    if (closeReturn <= cfg.signal.buyWhenPreviousCloseReturnLte) action = "buy";
    if (closeReturn >= cfg.signal.sellWhenPreviousCloseReturnGte) action = "sell";
    out.push({
      signalDate: current.tradeDate,
      generatedAfter: "close",
      market: current.market,
      code: current.code,
      close: round(current.close),
      previousClose: round(previous.close),
      closeReturn: round(closeReturn, 6),
      action,
      earliestExecutionDate: items[index + 1]?.tradeDate ?? null,
      rule: cfg.signal.name
    });
  }
  return out;
}

function executeLoop(items, signalItems, cfg, boardLot) {
  let cash = Number(cfg.initialCash);
  let shares = 0;
  const orders = [];
  const trades = [];
  const ledger = [];
  const nav = [];
  const signalByDate = new Map(signalItems.map((signal) => [signal.signalDate, signal]));
  let previousEquity = cfg.initialCash;

  for (let index = 0; index < items.length; index += 1) {
    const bar = items[index];
    const previousBar = items[index - 1] ?? null;
    const signal = previousBar ? signalByDate.get(previousBar.tradeDate) : null;
    const startingCash = cash;
    const startingShares = shares;

    if (signal && signal.earliestExecutionDate === bar.tradeDate && executionBlockedReason(bar) === null) {
      if (signal.action === "buy" && shares === 0) {
        const targetValue = previousEquity * cfg.targetGrossExposure;
        const rawShares = Math.floor(targetValue / bar.open);
        let quantity = roundLot(rawShares, boardLot);
        let estimated = estimateBuyCost(quantity, bar.open, bar.tradeDate, cfg.fees);
        while (quantity > 0 && estimated.totalCashRequired > cash) {
          quantity -= boardLot;
          estimated = estimateBuyCost(quantity, bar.open, bar.tradeDate, cfg.fees);
        }
        const order = makeOrder(signal, bar, "buy", quantity, boardLot, estimated.totalFees);
        orders.push(order);
        if (quantity > 0) {
          cash = round(cash - estimated.totalCashRequired);
          shares += quantity;
          trades.push(makeTrade(order, bar, startingCash, cash, shares, estimated));
        }
      }
      if (signal.action === "sell" && shares > 0) {
        const quantity = shares;
        const estimated = estimateSellProceeds(quantity, bar.open, bar.tradeDate, cfg.fees);
        const order = makeOrder(signal, bar, "sell", quantity, boardLot, estimated.totalFees);
        orders.push(order);
        cash = round(cash + estimated.netProceeds);
        shares = 0;
        trades.push(makeTrade(order, bar, startingCash, cash, shares, estimated));
      }
    }

    const marketValue = round(shares * bar.close);
    const equity = round(cash + marketValue);
    const tradedValue = trades
      .filter((trade) => trade.tradeDate === bar.tradeDate)
      .reduce((sum, trade) => sum + trade.grossAmount, 0);
    const turnoverTwoWay = previousEquity > 0 ? tradedValue / previousEquity : 0;
    const turnoverOneWay = turnoverTwoWay / 2;
    const row = {
      tradeDate: bar.tradeDate,
      close: round(bar.close),
      cash,
      shares,
      marketValue,
      equity,
      dailyReturn: previousEquity > 0 ? round((equity - previousEquity) / previousEquity, 8) : 0,
      turnoverOneWay: round(turnoverOneWay, 8),
      turnoverTwoWay: round(turnoverTwoWay, 8)
    };
    ledger.push({
      ...row,
      startingCash,
      startingShares,
      endingCash: cash,
      endingShares: shares
    });
    nav.push(row);
    previousEquity = equity;
  }

  return { orders, trades, ledger, nav };
}

function makeOrder(signal, bar, side, quantity, boardLot, estimatedFees) {
  return {
    orderId: `order-${signal.signalDate}-${bar.tradeDate}-${side}`,
    signalDate: signal.signalDate,
    generatedAfter: signal.generatedAfter,
    tradeDate: bar.tradeDate,
    side,
    quantity,
    boardLot,
    roundedToBoardLot: quantity % boardLot === 0,
    priceType: "next_open",
    expectedPrice: round(bar.open),
    reason: signal.rule,
    estimatedFees: round(estimatedFees),
    rejectedReason: quantity <= 0 ? "cash_or_lot_size_insufficient" : null
  };
}

function makeTrade(order, bar, cashBefore, cashAfter, sharesAfter, estimated) {
  return {
    tradeId: order.orderId.replace("order", "trade"),
    orderId: order.orderId,
    signalDate: order.signalDate,
    tradeDate: order.tradeDate,
    side: order.side,
    quantity: order.quantity,
    price: round(bar.open),
    grossAmount: round(order.quantity * bar.open),
    fees: estimated.fees,
    totalFees: round(estimated.totalFees),
    netCashChange: order.side === "buy" ? -round(estimated.totalCashRequired) : round(estimated.netProceeds),
    cashBefore: round(cashBefore),
    cashAfter: round(cashAfter),
    sharesAfter,
    sameBarExecution: order.signalDate === order.tradeDate
  };
}

function estimateBuyCost(quantity, price, tradeDate, fees) {
  const gross = round(quantity * price);
  const { fees: feeBreakdown, totalFees } = feeBreakdownFor(gross, "buy", tradeDate, fees);
  return {
    gross,
    fees: feeBreakdown,
    totalFees,
    totalCashRequired: round(gross + totalFees)
  };
}

function estimateSellProceeds(quantity, price, tradeDate, fees) {
  const gross = round(quantity * price);
  const { fees: feeBreakdown, totalFees } = feeBreakdownFor(gross, "sell", tradeDate, fees);
  return {
    gross,
    fees: feeBreakdown,
    totalFees,
    netProceeds: round(gross - totalFees)
  };
}

// Suspended/halted, zero or missing volume, and invalid prices all block
// simulated execution before any cash, share or ledger mutation.
function executionBlockedReason(bar) {
  if (!bar) return "missing_execution_bar";
  const tradingStatus = String(bar.tradingStatus ?? bar.tradeStatus ?? "").toLowerCase();
  if (bar.suspended === true || tradingStatus === "suspended" || tradingStatus === "halted") return "suspended_bar";
  if (!Number.isFinite(bar.volume) || bar.volume <= 0) return "zero_or_missing_volume";
  if (!Number.isFinite(bar.open) || bar.open <= 0) return "invalid_execution_price";
  return null;
}

function feeBreakdownFor(gross, side, tradeDate, fees) {
  const computed = computeHkCashEquityFees({
    side,
    tradeDate,
    grossAmount: gross,
    commissionRate: fees?.commissionRate,
    minCommission: fees?.minCommission,
    platformFee: fees?.platformFee
  });
  return { fees: computed.fees, totalFees: computed.totalFees, feePolicyVersion: computed.feePolicyVersion };
}

function computeMetrics(navRows, tradeRows, initialCash) {
  const finalEquity = navRows.at(-1)?.equity ?? initialCash;
  let peak = initialCash;
  let maxDrawdown = 0;
  const returns = [];
  for (const row of navRows) {
    peak = Math.max(peak, row.equity);
    maxDrawdown = Math.min(maxDrawdown, (row.equity - peak) / peak);
    returns.push(row.dailyReturn);
  }
  const avg = returns.reduce((sum, value) => sum + value, 0) / Math.max(returns.length, 1);
  const variance = returns.reduce((sum, value) => sum + (value - avg) ** 2, 0) / Math.max(returns.length - 1, 1);
  const std = Math.sqrt(variance);
  return {
    finalEquity: round(finalEquity),
    totalReturn: round((finalEquity - initialCash) / initialCash, 8),
    maxDrawdown: round(maxDrawdown, 8),
    sharpe: std > 0 ? round((avg / std) * Math.sqrt(252), 6) : 0,
    tradeCount: tradeRows.length,
    totalFees: round(tradeRows.reduce((sum, trade) => sum + trade.totalFees, 0)),
    turnoverOneWay: round(navRows.reduce((sum, row) => sum + row.turnoverOneWay, 0), 8),
    turnoverTwoWay: round(navRows.reduce((sum, row) => sum + row.turnoverTwoWay, 0), 8)
  };
}

function buildReport({ manifest, dataQuality, trades, metrics, futureFunctionCheck }) {
  const handCheck = trades.slice(0, 5).map((trade) => (
    `| ${trade.tradeId} | ${trade.signalDate} | ${trade.tradeDate} | ${trade.side} | ${trade.quantity} | ${trade.price} | ${trade.grossAmount} | ${trade.totalFees} | ${trade.cashBefore} | ${trade.cashAfter} |`
  )).join("\n");
  return `# Quant Smoke Report

## Run

- Commit: \`${manifest.commit}\`
- Snapshot: \`${manifest.snapshotId}\`
- Data hash: \`${manifest.dataHash}\`
- Config hash: \`${manifest.configHash}\`
- Date range: ${manifest.dateRange.start} to ${manifest.dateRange.end}
- Initial cash: ${manifest.initialCash}
- Adjustment: ${manifest.adjustment}

## Metrics

- Final equity: ${metrics.finalEquity}
- Total return: ${metrics.totalReturn}
- Max drawdown: ${metrics.maxDrawdown}
- Sharpe: ${metrics.sharpe}
- Trade count: ${metrics.tradeCount}
- Total fees: ${metrics.totalFees}
- One-way turnover: ${metrics.turnoverOneWay}
- Two-way turnover: ${metrics.turnoverTwoWay}

## Data Quality

- Rows: ${dataQuality.rows}
- Duplicate count: ${dataQuality.duplicateCount}
- Missing critical count: ${dataQuality.missingCriticalCount}
- Not tradeable count: ${dataQuality.notTradeableCount}

## Hand Check Trades

| Trade | Signal Date | Trade Date | Side | Qty | Price | Gross | Fees | Cash Before | Cash After |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
${handCheck || "| n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 | 0 | 0 |"}

## Future Function Check

- scan status: ${futureFunctionCheck.status}
- scanned files: ${futureFunctionCheck.scannedFiles.join(", ") || "none"}
- total hits: ${formatScanCount(futureFunctionCheck.hitCount)}
- shift negative matches: ${formatScanCount(futureFunctionCheck.shiftNegative)}
- future index matches: ${formatScanCount(futureFunctionCheck.futureIndex)}
- same-bar executions: ${trades.filter((trade) => trade.sameBarExecution).length}

## Safety

- Sends live network requests: false
- Writes production database: false
- Enables trading: false
- Touches real trades/positions/reviews: false
`;
}

async function scanOwnSources() {
  if (process.env.QUANT_SMOKE_DISABLE_SOURCE_SCAN_FOR_TEST === "1") {
    return { status: "not_executed", scannedFiles: [], hitCount: null, shiftNegative: null, futureIndex: null, errors: [{ rule: "source_scan_not_executed" }] };
  }
  const files = ["scripts/quant-smoke.mjs", configPath];
  const rules = [
    ["shift_negative", new RegExp("shift\\s*\\(\\s*-", "i")],
    ["future_index", new RegExp("iloc\\s*\\[\\s*i\\s*\\+", "i")],
    ["centered_rolling", new RegExp("center\\s*=\\s*true", "i")],
    ["backfill", new RegExp("\\bbfill\\s*\\(", "i")]
  ];
  const hits = [];
  for (const file of files) {
    const lines = (await readFile(resolvePath(file), "utf8")).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const [rule, pattern] of rules) {
        if (pattern.test(line)) hits.push({ file, line: index + 1, rule });
      }
    });
  }
  return {
    status: "completed",
    scannedFiles: files,
    hitCount: hits.length,
    shiftNegative: hits.filter((hit) => hit.rule === "shift_negative").length,
    futureIndex: hits.filter((hit) => hit.rule === "future_index").length,
    errors: hits
  };
}

function formatScanCount(value) {
  return Number.isInteger(value) ? value : "not_scanned";
}

async function writeJson(name, value) {
  await writeFile(join(outputDir, name), JSON.stringify(value, null, 2) + "\n");
}

async function readText(relativePath) {
  return readFile(resolvePath(relativePath), "utf8");
}

function resolvePath(path) {
  return String(path).startsWith("/") ? String(path) : join(root, String(path));
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function roundLot(quantity, boardLot) {
  return Math.floor(quantity / boardLot) * boardLot;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}
