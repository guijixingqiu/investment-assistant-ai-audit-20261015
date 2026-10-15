#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { computeHkCashEquityFees, feePolicySha256, FEE_POLICY_VERSION } from "./lib/hk-fee-policy.mjs";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = process.env.QUANT_PORTFOLIO_SMOKE_CONFIG ?? "config/quant-portfolio-smoke.hk-multi-symbol.json";
const config = JSON.parse(await readText(configPath));
const outputDir = resolvePath(config.outputDir);

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const configQuality = checkConfig(config);
if (!configQuality.ok) {
  await writeJson("config-quality.json", configQuality);
  console.error(JSON.stringify(configQuality, null, 2));
  process.exit(1);
}

const freeze = config.snapshotPath ? await useFrozenSnapshot(config.snapshotPath) : await runFreeze(config.freezeConfigPath);
const snapshot = JSON.parse(await readText(freeze.outputPath));
const bars = normalizeBars(snapshot.bars);
const dataQuality = checkDataQuality(bars, snapshot);
if (!dataQuality.ok) {
  await writeJson("config-quality.json", configQuality);
  await writeJson("data-quality.json", dataQuality);
  console.error(JSON.stringify(dataQuality, null, 2));
  process.exit(1);
}

const configHash = sha256(await readText(configPath));
const snapshotFileHash = sha256(await readText(freeze.outputPath));
const canonicalSnapshot = canonicalizeSnapshot(snapshot);
const dataHash = sha256(stableJson(canonicalSnapshot.payload));
const expectedSnapshotId = buildSnapshotId(snapshot, canonicalSnapshot.payload.dateRange, dataHash);
const snapshotIntegrity = {
  ok: snapshot.dataHash === dataHash && snapshot.snapshotId === expectedSnapshotId,
  snapshotId: snapshot.snapshotId,
  expectedSnapshotId,
  dataHash: snapshot.dataHash,
  canonicalDataHash: dataHash,
  snapshotFileHash,
  checks: {
    canonicalPayload: true,
    dataHash: snapshot.dataHash === dataHash,
    snapshotId: snapshot.snapshotId === expectedSnapshotId,
    snapshotFileHash: true
  },
  issues: [
    ...(snapshot.dataHash === dataHash ? [] : [{ level: "error", type: "snapshot_data_hash_mismatch", expected: dataHash, actual: snapshot.dataHash }]),
    ...(snapshot.snapshotId === expectedSnapshotId ? [] : [{ level: "error", type: "snapshot_id_mismatch", expected: expectedSnapshotId, actual: snapshot.snapshotId }])
  ]
};
if (!snapshotIntegrity.ok) {
  await writeJson("snapshot-integrity.json", snapshotIntegrity);
  console.error(JSON.stringify(snapshotIntegrity, null, 2));
  process.exit(1);
}
const signals = generateSignals(bars, config);
const { orders, trades, ledger, nav, positions } = executePortfolio(bars, signals, snapshot.universe, config);
const metrics = computeMetrics(nav, trades, config.initialCash);
const dateRange = snapshot.dateRange ?? {
  start: bars[0]?.tradeDate ?? null,
  end: bars.at(-1)?.tradeDate ?? null
};
const manifest = {
  schemaVersion: "2026-06-20.quant-portfolio-smoke.run.v1",
  generatedAt: new Date().toISOString(),
  commit: gitHead(),
  feePolicyVersion: FEE_POLICY_VERSION,
  feePolicySha256: feePolicySha256(),
  configPath,
  configHash,
  freezeConfigPath: config.freezeConfigPath ?? null,
  freeze,
  snapshotPath: freeze.outputPath,
  snapshotId: snapshot.snapshotId,
  dataHash,
  snapshotFileHash,
  snapshotIntegrity,
  universe: snapshot.universe,
  dateRange,
  initialCash: config.initialCash,
  targetGrossExposure: config.targetGrossExposure,
  maxPositionWeight: config.maxPositionWeight,
  experiment: config.experiment,
  adjustment: snapshot.adjustment,
  fees: config.fees,
  outputs: [
    "run_manifest.json",
    "config-quality.json",
    "data-quality.json",
    "snapshot-integrity.json",
    "signals.json",
    "orders.json",
    "trades.json",
    "ledger.json",
    "positions.json",
    "nav.json",
    "report.md"
  ],
  safety: {
    readsFrozenSnapshot: true,
    sendsLiveNetworkRequests: false,
    writesProductionDatabase: false,
    enablesTrading: false,
    initializesBrokerGateway: false,
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
await writeJson("snapshot-integrity.json", snapshotIntegrity);
await writeJson("signals.json", signals);
await writeJson("orders.json", orders);
await writeJson("trades.json", trades);
await writeJson("ledger.json", ledger);
await writeJson("positions.json", positions);
await writeJson("nav.json", nav);
await writeJson("run_manifest.json", manifest);
await writeFile(join(outputDir, "report.md"), buildReport({ manifest, dataQuality, trades, metrics }));

console.log(JSON.stringify({
  ok: true,
  goNoGo: "quant_portfolio_smoke_passed",
  outputDir: config.outputDir,
  snapshotId: snapshot.snapshotId,
  dataHash,
  configHash,
  symbols: snapshot.universe.map((item) => item.symbol),
  trades: trades.length,
  finalEquity: metrics.finalEquity,
  totalReturn: metrics.totalReturn,
  maxDrawdown: metrics.maxDrawdown,
  sharpe: metrics.sharpe,
  totalFees: metrics.totalFees,
  safety: manifest.safety
}, null, 2));

async function runFreeze(freezeConfigPath) {
  const result = await execFileAsync(process.execPath, ["scripts/quant-freeze-snapshot.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      QUANT_FREEZE_CONFIG: freezeConfigPath
    },
    maxBuffer: 20 * 1024 * 1024
  });
  return JSON.parse(result.stdout);
}

async function useFrozenSnapshot(snapshotPath) {
  const snapshot = JSON.parse(await readText(snapshotPath));
  return {
    ok: true,
    goNoGo: "quant_snapshot_bound",
    outputPath: snapshotPath,
    manifestPath: null,
    snapshotId: snapshot.snapshotId,
    dataHash: snapshot.dataHash,
    rows: Array.isArray(snapshot.bars) ? snapshot.bars.length : null,
    dateRange: snapshot.dateRange,
    safety: {
      sendsLiveNetworkRequests: false,
      writesProductionDatabase: false,
      enablesTrading: false,
      initializesBrokerGateway: false
    }
  };
}

function normalizeBars(rawBars) {
  return rawBars.map((bar) => ({
    ...bar,
    symbol: `${bar.market}.${bar.code}`,
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volume),
    turnover: Number(bar.turnover)
  })).sort((a, b) => `${a.tradeDate}.${a.market}.${a.code}`.localeCompare(`${b.tradeDate}.${b.market}.${b.code}`));
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
  if (typeof cfg.freezeConfigPath !== "string" || cfg.freezeConfigPath.trim() === "") {
    if (typeof cfg.snapshotPath !== "string" || cfg.snapshotPath.trim() === "") {
      issues.push({ level: "error", type: "missing_freeze_config_path" });
    }
  }
  if (!Number.isFinite(Number(cfg.initialCash)) || Number(cfg.initialCash) <= 0) {
    issues.push({ level: "error", type: "invalid_initial_cash", initialCash: cfg.initialCash });
  }
  if (!Number.isFinite(Number(cfg.targetGrossExposure)) || Number(cfg.targetGrossExposure) <= 0 || Number(cfg.targetGrossExposure) > 1) {
    issues.push({ level: "error", type: "invalid_target_gross_exposure", targetGrossExposure: cfg.targetGrossExposure });
  }
  if (!Number.isFinite(Number(cfg.maxPositionWeight)) || Number(cfg.maxPositionWeight) <= 0 || Number(cfg.maxPositionWeight) > 1) {
    issues.push({ level: "error", type: "invalid_max_position_weight", maxPositionWeight: cfg.maxPositionWeight });
  }
  if (execution.signalTiming !== "after_close_t") issues.push({ level: "error", type: "invalid_signal_timing" });
  if (execution.earliestExecution !== "next_trading_day_open") issues.push({ level: "error", type: "invalid_earliest_execution" });
  if (execution.priceField !== "open") issues.push({ level: "error", type: "invalid_execution_price_field" });
  if (execution.allowSameBarExecution !== false) issues.push({ level: "error", type: "same_bar_execution_not_allowed" });
  if (execution.allowMargin !== false) issues.push({ level: "error", type: "margin_not_allowed" });

  const feeFields = ["commissionRate", "minCommission", "platformFee", "stampDutyRate", "tradingFeeRate", "transactionLevyRate"];
  for (const field of feeFields) {
    if (!Number.isFinite(Number(fees[field])) || Number(fees[field]) < 0) {
      issues.push({ level: "error", type: "invalid_fee_field", field, value: fees[field] });
    }
  }
  const feeTotal = feeFields.reduce((sum, field) => sum + (Number.isFinite(Number(fees[field])) ? Number(fees[field]) : 0), 0);
  if (feeTotal <= 0) issues.push({ level: "error", type: "zero_fee_model_not_allowed" });

  return {
    ok: issues.every((issue) => issue.level !== "error"),
    issues,
    experiment,
    execution,
    fees
  };
}

function checkDataQuality(items, snapshot) {
  const issues = [];
  const symbols = new Set(snapshot.universe.map((item) => item.symbol));
  const seen = new Set();
  if (symbols.size < 2) issues.push({ level: "error", type: "portfolio_requires_at_least_two_symbols" });
  const cutoffMs = Date.parse(snapshot.dataCutoff);
  if (!Number.isFinite(cutoffMs)) issues.push({ level: "error", type: "invalid_data_cutoff", dataCutoff: snapshot.dataCutoff });
  const datesBySymbol = new Map();
  for (const bar of items) {
    const key = `${bar.symbol}.${bar.tradeDate}`;
    if (seen.has(key)) issues.push({ level: "error", type: "duplicate_bar", key });
    seen.add(key);
    if (!symbols.has(bar.symbol)) issues.push({ level: "error", type: "unexpected_symbol", symbol: bar.symbol });
    if (!datesBySymbol.has(bar.symbol)) datesBySymbol.set(bar.symbol, []);
    datesBySymbol.get(bar.symbol).push(bar.tradeDate);
    for (const field of ["open", "high", "low", "close"]) {
      if (!Number.isFinite(bar[field]) || bar[field] <= 0) issues.push({ level: "error", type: "invalid_price", key, field });
    }
    if (bar.high < bar.low || bar.high < bar.open || bar.high < bar.close || bar.low > bar.open || bar.low > bar.close) {
      issues.push({ level: "error", type: "invalid_ohlc", key });
    }
    if (!Number.isFinite(bar.volume) || bar.volume <= 0) issues.push({ level: "warning", type: "not_tradeable_volume", key });
    if (bar.suspended === true || ["suspended", "halted"].includes(String(bar.tradingStatus ?? bar.tradeStatus ?? "").toLowerCase())) {
      issues.push({ level: "warning", type: "not_tradeable_suspended", key });
    }
    const fetchedAtMs = Date.parse(bar.fetchedAt);
    if (!Number.isFinite(fetchedAtMs)) {
      issues.push({ level: "error", type: "invalid_fetched_at", key });
    } else if (Number.isFinite(cutoffMs) && fetchedAtMs > cutoffMs) {
      issues.push({ level: "error", type: "fetched_after_data_cutoff", key });
    }
  }
  for (const symbol of symbols) {
    const count = datesBySymbol.get(symbol)?.length ?? 0;
    if (count === 0) issues.push({ level: "error", type: "missing_symbol_bars", symbol });
  }
  return {
    ok: issues.every((issue) => issue.level !== "error"),
    snapshotId: snapshot.snapshotId,
    dataHash: snapshot.dataHash,
    rows: items.length,
    symbols: [...symbols],
    duplicateCount: issues.filter((issue) => issue.type === "duplicate_bar").length,
    missingSymbolCount: issues.filter((issue) => issue.type === "missing_symbol_bars").length,
    missingCriticalCount: issues.filter((issue) => issue.type === "invalid_price").length,
    notTradeableCount: issues.filter((issue) => issue.type === "not_tradeable_volume").length,
    issues
  };
}

function canonicalizeSnapshot(snapshot) {
  const bars = [...snapshot.bars].map((bar) => ({ ...bar, open: Number(bar.open), high: Number(bar.high), low: Number(bar.low), close: Number(bar.close), volume: Number(bar.volume), turnover: Number(bar.turnover) })).sort((a, b) => `${a.market}.${a.code}.${a.tradeDate}`.localeCompare(`${b.market}.${b.code}.${b.tradeDate}`)).map((bar) => ({
    market: bar.market, code: bar.code, tradeDate: bar.tradeDate, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, turnover: bar.turnover, adjustment: bar.adjustment, source: bar.source, fetchedAt: bar.fetchedAt
  }));
  const dateRange = { start: bars.reduce((m,b)=>m===null||b.tradeDate<m?b.tradeDate:m,null), end: bars.reduce((m,b)=>m===null||b.tradeDate>m?b.tradeDate:m,null) };
  return { payload: { schemaVersion: "2026-06-20.quant-snapshot.v1", sourceKind: snapshot.source, sourcePath: snapshot.sourcePath, sourceHash: snapshot.sourceHash, adjustment: snapshot.adjustment, dataCutoff: snapshot.dataCutoff, ...(snapshot.hkConnectUniverse ? { hkConnectUniverse: snapshot.hkConnectUniverse } : {}), universe: snapshot.universe, dateRange, bars } };
}

function buildSnapshotId(snapshot, dateRange, dataHash) {
  const universeKey = snapshot.universe.map((item) => `${item.market}.${item.code}`).join("-");
  return [String(snapshot.universe[0]?.market ?? "hk").toLowerCase(), universeKey.replace(/[^A-Za-z0-9.-]+/g, "-").toLowerCase(), snapshot.adjustment, dateRange.start, dateRange.end, dataHash.slice(0, 12)].join("-");
}

function stableJson(value) { return JSON.stringify(sortObject(value)); }
function sortObject(value) { if (Array.isArray(value)) return value.map(sortObject); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key)=>[key, sortObject(value[key])])); return value; }

function latestValidClose(items, symbol, tradeDate) {
  return items.filter((bar) => bar.symbol === symbol && bar.tradeDate <= tradeDate && Number.isFinite(bar.close) && bar.close > 0).sort((a,b)=>b.tradeDate.localeCompare(a.tradeDate))[0] ?? null;
}

function marketValueAtOpen(shares, barsByDateSymbol, items, tradeDate) {
  let total = 0;
  for (const [symbol, quantity] of shares.entries()) {
    if (quantity <= 0) continue;
    const bar = barsByDateSymbol.get(`${tradeDate}.${symbol}`);
    if (bar && Number.isFinite(bar.open) && bar.open > 0) {
      total += quantity * bar.open;
      continue;
    }
    const lastBar = latestValidClose(items, symbol, tradeDate);
    if (!lastBar) throw new Error(`no_historical_pretrade_valuation_price:${tradeDate}:${symbol}`);
    total += quantity * lastBar.close;
  }
  return total;
}

function generateSignals(items, cfg) {
  const out = [];
  const bySymbol = groupBy(items, (bar) => bar.symbol);
  for (const [symbol, bars] of bySymbol.entries()) {
    for (let index = 1; index < bars.length; index += 1) {
      const previous = bars[index - 1];
      const current = bars[index];
      const closeReturn = (current.close - previous.close) / previous.close;
      let action = "hold";
      if (closeReturn <= cfg.signal.buyWhenPreviousCloseReturnLte) action = "buy";
      if (closeReturn >= cfg.signal.sellWhenPreviousCloseReturnGte) action = "sell";
      out.push({
        signalDate: current.tradeDate,
        generatedAfter: "close",
        market: current.market,
        code: current.code,
        symbol,
        close: round(current.close),
        previousClose: round(previous.close),
        closeReturn: round(closeReturn, 6),
        action,
        earliestExecutionDate: bars[index + 1]?.tradeDate ?? null,
        rule: cfg.signal.name
      });
    }
  }
  return out.sort((a, b) => `${a.signalDate}.${a.symbol}`.localeCompare(`${b.signalDate}.${b.symbol}`));
}

function executePortfolio(items, signalItems, universe, cfg) {
  let cash = Number(cfg.initialCash);
  const shares = new Map(universe.map((item) => [item.symbol, 0]));
  const lotSizes = new Map(universe.map((item) => [item.symbol, Number(item.lotSize)]));
  const orders = [];
  const trades = [];
  const ledger = [];
  const nav = [];
  const positions = [];
  let previousEquity = Number(cfg.initialCash);
  const barsByDateSymbol = new Map(items.map((bar) => [`${bar.tradeDate}.${bar.symbol}`, bar]));
  const tradeDates = [...new Set(items.map((bar) => bar.tradeDate))].sort();
  const signalsByExecutionDate = groupBy(signalItems.filter((signal) => signal.earliestExecutionDate), (signal) => signal.earliestExecutionDate);

  for (const tradeDate of tradeDates) {
    const startingCash = cash;
    const startingShares = Object.fromEntries([...shares.entries()]);
    const todaysSignals = (signalsByExecutionDate.get(tradeDate) ?? [])
      .filter((signal) => barsByDateSymbol.has(`${tradeDate}.${signal.symbol}`))
      .sort((a, b) => {
        const sideOrder = sideFor(a, shares) === sideFor(b, shares) ? 0 : sideFor(a, shares) === "sell" ? -1 : 1;
        return sideOrder || a.symbol.localeCompare(b.symbol);
      });

    for (const signal of todaysSignals) {
      const bar = barsByDateSymbol.get(`${tradeDate}.${signal.symbol}`);
      const boardLot = lotSizes.get(signal.symbol);
      const currentShares = shares.get(signal.symbol) ?? 0;
      if (!isTradeableBar(bar)) {
        if (signal.action === "sell" && currentShares > 0) {
          orders.push(makeOrder(signal, bar, "sell", currentShares, boardLot, 0, "not_tradeable_bar"));
        } else if (signal.action === "buy" && currentShares === 0) {
          orders.push(makeOrder(signal, bar, "buy", 0, boardLot, 0, "not_tradeable_bar"));
        }
        continue;
      }
      if (signal.action === "sell" && currentShares > 0) {
        const quantity = currentShares;
        const estimated = estimateSellProceeds(quantity, bar.open, bar.tradeDate, cfg.fees);
        const order = makeOrder(signal, bar, "sell", quantity, boardLot, estimated.totalFees);
        orders.push(order);
        const cashBefore = cash;
        cash = round(cash + estimated.netProceeds);
        shares.set(signal.symbol, 0);
        trades.push(makeTrade(order, bar, cashBefore, cash, shares.get(signal.symbol), estimated));
      } else if (signal.action === "buy" && currentShares === 0) {
        const currentMarketValue = marketValueAtOpen(shares, barsByDateSymbol, items, tradeDate);
        const symbolCurrentValue = currentShares * bar.open;
        const maxBySymbol = Math.max(0, previousEquity * Number(cfg.maxPositionWeight) - symbolCurrentValue);
        const maxByGross = Math.max(0, previousEquity * Number(cfg.targetGrossExposure) - currentMarketValue);
        const targetValue = Math.min(maxBySymbol, maxByGross, cash);
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
          const cashBefore = cash;
          cash = round(cash - estimated.totalCashRequired);
          shares.set(signal.symbol, currentShares + quantity);
          trades.push(makeTrade(order, bar, cashBefore, cash, shares.get(signal.symbol), estimated));
        }
      }
    }

    const positionRows = universe.map((item) => {
      const bar = barsByDateSymbol.get(`${tradeDate}.${item.symbol}`);
      const quantity = shares.get(item.symbol) ?? 0;
      const lastBar = latestValidClose(items, item.symbol, tradeDate);
      if (quantity > 0 && !lastBar) {
        throw new Error(`no_historical_valuation_price:${tradeDate}:${item.symbol}`);
      }
      const valuationBar = bar?.close > 0 ? bar : lastBar;
      return {
        tradeDate,
        market: item.market,
        code: item.code,
        symbol: item.symbol,
        close: round(valuationBar?.close ?? 0),
        shares: quantity,
        marketValue: round(quantity * (valuationBar?.close ?? 0)),
        valuationStale: quantity > 0 && (!bar || bar.close <= 0),
        valuationPriceDate: quantity > 0 ? valuationBar?.tradeDate ?? null : null
      };
    });
    positions.push(...positionRows);
    const marketValue = round(positionRows.reduce((sum, item) => sum + item.marketValue, 0));
    const equity = round(cash + marketValue);
    const tradedValue = trades.filter((trade) => trade.tradeDate === tradeDate).reduce((sum, trade) => sum + trade.grossAmount, 0);
    const turnoverTwoWay = previousEquity > 0 ? tradedValue / previousEquity : 0;
    const turnoverOneWay = turnoverTwoWay / 2;
    const row = {
      tradeDate,
      cash,
      marketValue,
      equity,
      grossExposure: equity > 0 ? round(marketValue / equity, 8) : 0,
      dailyReturn: previousEquity > 0 ? round((equity - previousEquity) / previousEquity, 8) : 0,
      turnoverOneWay: round(turnoverOneWay, 8),
      turnoverTwoWay: round(turnoverTwoWay, 8)
    };
    ledger.push({
      ...row,
      startingCash,
      startingShares,
      endingCash: cash,
      endingShares: Object.fromEntries([...shares.entries()])
    });
    nav.push(row);
    previousEquity = equity;
  }
  return { orders, trades, ledger, nav, positions };
}

function isTradeableBar(bar) {
  return executionBlockedReason(bar) === null;
}

// Suspended/halted, zero or missing volume, and invalid prices all block
// simulated fills before any cash, share or ledger mutation.
function executionBlockedReason(bar) {
  if (!bar) return "missing_execution_bar";
  const tradingStatus = String(bar.tradingStatus ?? bar.tradeStatus ?? "").toLowerCase();
  if (bar.suspended === true || tradingStatus === "suspended" || tradingStatus === "halted") return "suspended_bar";
  if (!Number.isFinite(bar.open) || bar.open <= 0) return "invalid_execution_price";
  if (!Number.isFinite(bar.volume) || bar.volume <= 0) return "zero_or_missing_volume";
  return null;
}

function sideFor(signal, shares) {
  if (signal.action === "sell" && (shares.get(signal.symbol) ?? 0) > 0) return "sell";
  return "buy";
}

function makeOrder(signal, bar, side, quantity, boardLot, estimatedFees, rejectedReason = null) {
  return {
    orderId: `order-${signal.symbol}-${signal.signalDate}-${bar.tradeDate}-${side}`,
    signalDate: signal.signalDate,
    generatedAfter: signal.generatedAfter,
    tradeDate: bar.tradeDate,
    market: signal.market,
    code: signal.code,
    symbol: signal.symbol,
    side,
    quantity,
    boardLot,
    roundedToBoardLot: quantity % boardLot === 0,
    priceType: "next_open",
    expectedPrice: round(bar.open),
    reason: signal.rule,
    estimatedFees: round(estimatedFees),
    rejectedReason: rejectedReason ?? (quantity <= 0 ? "cash_or_lot_size_insufficient" : null)
  };
}

function makeTrade(order, bar, cashBefore, cashAfter, sharesAfter, estimated) {
  return {
    tradeId: order.orderId.replace("order", "trade"),
    orderId: order.orderId,
    signalDate: order.signalDate,
    tradeDate: order.tradeDate,
    market: order.market,
    code: order.code,
    symbol: order.symbol,
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
  return { gross, fees: feeBreakdown, totalFees, totalCashRequired: round(gross + totalFees) };
}

function estimateSellProceeds(quantity, price, tradeDate, fees) {
  const gross = round(quantity * price);
  const { fees: feeBreakdown, totalFees } = feeBreakdownFor(gross, "sell", tradeDate, fees);
  return { gross, fees: feeBreakdown, totalFees, netProceeds: round(gross - totalFees) };
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
    tradedSymbols: [...new Set(tradeRows.map((trade) => trade.symbol))].sort(),
    totalFees: round(tradeRows.reduce((sum, trade) => sum + trade.totalFees, 0)),
    turnoverOneWay: round(navRows.reduce((sum, row) => sum + row.turnoverOneWay, 0), 8),
    turnoverTwoWay: round(navRows.reduce((sum, row) => sum + row.turnoverTwoWay, 0), 8)
  };
}

function buildReport({ manifest, dataQuality, trades, metrics }) {
  const handCheck = trades.slice(0, 5).map((trade) => (
    `| ${trade.tradeId} | ${trade.symbol} | ${trade.signalDate} | ${trade.tradeDate} | ${trade.side} | ${trade.quantity} | ${trade.price} | ${trade.grossAmount} | ${trade.totalFees} | ${trade.cashBefore} | ${trade.cashAfter} |`
  )).join("\n");
  return `# Quant Portfolio Smoke Report

## Run

- Commit: \`${manifest.commit}\`
- Snapshot: \`${manifest.snapshotId}\`
- Data hash: \`${manifest.dataHash}\`
- Config hash: \`${manifest.configHash}\`
- Date range: ${manifest.dateRange.start} to ${manifest.dateRange.end}
- Universe: ${manifest.universe.map((item) => item.symbol).join(", ")}
- Initial cash: ${manifest.initialCash}
- Target gross exposure: ${manifest.targetGrossExposure}
- Max position weight: ${manifest.maxPositionWeight}
- Adjustment: ${manifest.adjustment}

## Metrics

- Final equity: ${metrics.finalEquity}
- Total return: ${metrics.totalReturn}
- Max drawdown: ${metrics.maxDrawdown}
- Sharpe: ${metrics.sharpe}
- Trade count: ${metrics.tradeCount}
- Traded symbols: ${metrics.tradedSymbols.join(", ")}
- Total fees: ${metrics.totalFees}
- One-way turnover: ${metrics.turnoverOneWay}
- Two-way turnover: ${metrics.turnoverTwoWay}

## Data Quality

- Rows: ${dataQuality.rows}
- Symbols: ${dataQuality.symbols.join(", ")}
- Duplicate count: ${dataQuality.duplicateCount}
- Missing symbol count: ${dataQuality.missingSymbolCount}
- Missing critical count: ${dataQuality.missingCriticalCount}
- Not tradeable count: ${dataQuality.notTradeableCount}

## Hand Check Trades

| Trade | Symbol | Signal Date | Trade Date | Side | Qty | Price | Gross | Fees | Cash Before | Cash After |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
${handCheck || "| n/a | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 | 0 | 0 |"}

## Safety

- Sends live network requests: false
- Writes production database: false
- Enables trading: false
- Initializes broker gateway: false
- Touches real trades/positions/reviews: false
`;
}

function groupBy(items, keyFn) {
  const out = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return out;
}

function sumFees(fees) {
  return round(Object.values(fees).reduce((sum, value) => sum + value, 0));
}

function roundLot(quantity, boardLot) {
  return Math.floor(quantity / boardLot) * boardLot;
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

async function writeJson(name, value) {
  await writeFile(join(outputDir, name), JSON.stringify(value, null, 2) + "\n");
}

async function readText(path) {
  return readFile(resolvePath(path), "utf8");
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
