#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { feePolicySha256, FEE_POLICY_VERSION } from "./lib/hk-fee-policy.mjs";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = process.env.QUANT_PORTFOLIO_LAB_CONFIG
  ?? "config/quant-portfolio-lab.hk-multi-symbol.json";
const config = JSON.parse(await readText(configPath));
const configErrors = validateConfig(config);
if (configErrors.length > 0) fail("no_go_invalid_quant_portfolio_lab_config", { configErrors });

const snapshotVerification = await runSnapshotVerification(config);
if (snapshotVerification.ok !== true) {
  fail("no_go_unverified_quant_portfolio_lab_snapshot", { snapshotVerification });
}

const snapshot = JSON.parse(await readText(config.snapshotPath));
const executionConfig = JSON.parse(await readText(config.executionConfigPath));
const sourceErrors = validateSources(snapshot, executionConfig, snapshotVerification);
if (sourceErrors.length > 0) fail("no_go_invalid_quant_portfolio_lab_sources", { sourceErrors });

const symbols = snapshot.universe.map((item) => item.symbol);
const barsBySymbol = new Map(symbols.map((symbol) => [symbol, []]));
for (const bar of snapshot.bars) {
  const symbol = `${bar.market}.${bar.code}`;
  barsBySymbol.get(symbol)?.push(bar);
}
for (const bars of barsBySymbol.values()) bars.sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));

const commonDates = symbols
  .map((symbol) => new Set(barsBySymbol.get(symbol).map((bar) => bar.tradeDate)))
  .reduce((common, dates) => new Set([...common].filter((date) => dates.has(date))));
const orderedDates = [...commonDates].sort();
const dailyReturns = [];
for (let index = 1; index < orderedDates.length; index += 1) {
  const previousDate = orderedDates[index - 1];
  const tradeDate = orderedDates[index];
  dailyReturns.push({
    tradeDate,
    values: symbols.map((symbol) => {
      const bars = barsBySymbol.get(symbol);
      const previous = bars.find((bar) => bar.tradeDate === previousDate);
      const current = bars.find((bar) => bar.tradeDate === tradeDate);
      return {
        symbol,
        previousClose: Number(previous.close),
        close: Number(current.close),
        volume: Number(current.volume),
        turnover: Number(current.turnover),
        value: round(current.close / previous.close - 1, 10)
      };
    })
  });
}
if (dailyReturns.length < 2) {
  fail("no_go_insufficient_quant_portfolio_lab_observations", {
    observationCount: dailyReturns.length
  });
}

const series = symbols.map((symbol) => {
  const returns = dailyReturns.map((row) => row.values.find((item) => item.symbol === symbol).value);
  const observations = dailyReturns.map((row) => row.values.find((item) => item.symbol === symbol));
  const universe = snapshot.universe.find((item) => item.symbol === symbol);
  return {
    symbol,
    boardLot: Number(universe.lotSize),
    annualizedVolatility: round(sampleStandardDeviation(returns) * Math.sqrt(config.annualizationDays), 10),
    worstDailyReturn: round(Math.min(...returns), 10),
    historicalTailLossMagnitude: round(historicalTailLossMagnitude(returns, config.tailConfidence), 10),
    liquidity: {
      medianDailyVolume: round(median(observations.map((item) => item.volume)), 4),
      medianDailyTurnover: round(median(observations.map((item) => item.turnover)), 4),
      minimumDailyVolume: round(Math.min(...observations.map((item) => item.volume)), 4),
      minimumDailyTurnover: round(Math.min(...observations.map((item) => item.turnover)), 4),
      zeroVolumeObservationCount: observations.filter((item) => item.volume === 0).length
    }
  };
});

const covariance = [];
for (let leftIndex = 0; leftIndex < symbols.length; leftIndex += 1) {
  for (let rightIndex = leftIndex; rightIndex < symbols.length; rightIndex += 1) {
    const leftSymbol = symbols[leftIndex];
    const rightSymbol = symbols[rightIndex];
    const left = dailyReturns.map((row) => row.values.find((item) => item.symbol === leftSymbol).value);
    const right = dailyReturns.map((row) => row.values.find((item) => item.symbol === rightSymbol).value);
    const dailyCovariance = sampleCovariance(left, right);
    const denominator = sampleStandardDeviation(left) * sampleStandardDeviation(right);
    covariance.push({
      leftSymbol,
      rightSymbol,
      annualizedCovariance: round(dailyCovariance * config.annualizationDays, 12),
      correlation: denominator === 0 ? null : round(dailyCovariance / denominator, 10)
    });
  }
}

const scriptPath = "scripts/quant-portfolio-lab-evidence.mjs";
const generatedAt = config.generatedAt === "runtime" ? new Date().toISOString() : config.generatedAt;
const evidenceWithoutId = {
  schemaVersion: "2026-07-17.quant-portfolio-lab-evidence.v1",
  generatedAt,
  feePolicyVersion: FEE_POLICY_VERSION,
  feePolicySha256: feePolicySha256(),
  executionCalendar: { timing: "next_observed_session_open", calendarCompleteness: "unknown" },
  source: {
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.snapshotHash,
    dataHash: snapshot.dataHash,
    sourceClassification: snapshot.sourceClassification,
    adjustment: snapshot.adjustment,
    dataCutoff: snapshot.dataCutoff,
    observationStartDate: snapshot.dateRange.start,
    observationEndDate: snapshot.dateRange.end,
    hkConnectUniverse: snapshot.hkConnectUniverse,
    universe: snapshot.universe.map((item) => ({
      market: item.market,
      code: item.code,
      symbol: item.symbol,
      name: item.name,
      boardLot: Number(item.lotSize)
    })),
    sourceIdentity: snapshot.sourceIdentity
  },
  method: {
    returnMethod: config.returnMethod,
    annualizationDays: config.annualizationDays,
    tailConfidence: config.tailConfidence,
    covarianceEstimator: "sample_n_minus_1",
    observationAlignment: "exact_common_trading_dates",
    observationCount: dailyReturns.length,
    commonTradingDates: dailyReturns.map((row) => row.tradeDate)
  },
  stability: {
    status: dailyReturns.length >= config.minimumStableObservationCount
      ? "sample_threshold_met"
      : "insufficient_tiny_sample",
    minimumStableObservationCount: config.minimumStableObservationCount,
    observationCount: dailyReturns.length,
    limitation: dailyReturns.length >= config.minimumStableObservationCount
      ? "The configured engineering observation threshold is met; this remains historical research evidence."
      : "The observation window is intentionally tiny and unstable; metrics are shown only with this warning and are not predictive evidence."
  },
  dailyReturns,
  series,
  covariance,
  executionEvidence: {
    boardLots: snapshot.universe.map((item) => ({ symbol: item.symbol, boardLot: Number(item.lotSize) })),
    feeCurrency: "HKD",
    nonZeroCosts: Object.values(executionConfig.fees).some((value) => Number(value) > 0),
    fees: executionConfig.fees,
    signalTiming: executionConfig.execution.signalTiming,
    earliestExecution: executionConfig.execution.earliestExecution,
    allowsSameBarExecution: executionConfig.execution.allowSameBarExecution,
    allowsMargin: executionConfig.execution.allowMargin
  },
  codeIdentity: {
    scriptPath,
    scriptHash: await hashFile(scriptPath),
    configPath,
    configHash: await hashFile(configPath)
  },
  authority: {
    researchOnly: true,
    advisoryOnly: true,
    currentPortfolioFact: false,
    brokerReconciliation: false,
    accountingAuthority: false,
    recommendation: false,
    ranking: false,
    score: false,
    allocation: false,
    sizing: false,
    targetPrice: false,
    tradeDirection: false,
    orderTradeFillAuthority: false,
    cashFeePositionMutation: false,
    brokerWrite: false,
    productionWrite: false
  },
  limitations: [
    ...snapshot.limitations,
    `The Hong Kong Connect universe is bound to ${snapshot.hkConnectUniverse.effectiveDate}; it does not establish eligibility throughout the historical observation window. This is a current-selection historical price-risk study, not a historical-constituents strategy backtest.`,
    "Forward-adjusted closes do not replay dividend cash, trading fees, positions, or cash balances.",
    "Historical covariance, stress, tail, volatility, and liquidity evidence is usable only when the exact current-position and candidate symbols are covered.",
    "Current Pingan holdings and Futu prices remain separate current facts; this evidence never becomes current portfolio, broker, accounting, recommendation, sizing, or execution authority."
  ],
  safety: {
    sendsLiveNetworkRequests: false,
    writesDatabase: false,
    callsBroker: false,
    createsOrder: false,
    createsTrade: false,
    mutatesOfficialPortfolio: false
  }
};
const evidence = {
  ...evidenceWithoutId,
  evidenceId: `annual-portfolio-lab-quant:${sha256(stableJson(evidenceWithoutId))}`
};
const outputDir = resolvePath(config.outputDir);
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
const outputPath = join(outputDir, "run_manifest.json");
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);

console.log(JSON.stringify({
  ok: true,
  goNoGo: "quant_portfolio_lab_evidence_generated",
  outputPath: relative(outputPath),
  evidenceId: evidence.evidenceId,
  snapshotId: evidence.source.snapshotId,
  universe: symbols,
  observationCount: dailyReturns.length,
  stability: evidence.stability.status,
  authority: evidence.authority,
  safety: evidence.safety
}, null, 2));

async function runSnapshotVerification(cfg) {
  const result = await execFileAsync(process.execPath, ["scripts/quant-freeze-snapshot-verify.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      QUANT_FREEZE_CONFIG: cfg.snapshotFreezeConfigPath ?? "config/quant-freeze-snapshot.hk-multi-symbol.json",
      QUANT_SNAPSHOT_VERIFY_NO_FREEZE: "1",
      QUANT_SNAPSHOT_PATH: cfg.snapshotPath,
      QUANT_SNAPSHOT_MANIFEST_PATH: cfg.snapshotManifestPath
    },
    maxBuffer: 40 * 1024 * 1024
  });
  return JSON.parse(result.stdout);
}

function validateConfig(value) {
  const errors = [];
  if (value.schemaVersion !== "2026-07-17.quant-portfolio-lab-config.v1") errors.push("schemaVersion is invalid");
  for (const field of ["snapshotPath", "snapshotManifestPath", "snapshotFreezeConfigPath", "executionConfigPath", "outputDir", "generatedAt", "returnMethod"]) {
    if (typeof value[field] !== "string" || value[field].trim() === "") errors.push(`${field} is required`);
  }
  if (value.returnMethod !== "close_to_close_simple") errors.push("returnMethod is unsupported");
  if (value.generatedAt !== "runtime" && !isStrictInstant(value.generatedAt)) {
    errors.push("generatedAt must be an ISO UTC instant or runtime");
  }
  if (!Number.isSafeInteger(value.annualizationDays) || value.annualizationDays < 1 || value.annualizationDays > 366) errors.push("annualizationDays is invalid");
  if (typeof value.tailConfidence !== "number" || value.tailConfidence < 0.5 || value.tailConfidence >= 1) errors.push("tailConfidence is invalid");
  if (!Number.isSafeInteger(value.minimumStableObservationCount) || value.minimumStableObservationCount < 2) errors.push("minimumStableObservationCount is invalid");
  return errors;
}

function validateSources(snapshot, executionConfig, verification) {
  const errors = [];
  if (snapshot.snapshotId !== verification.snapshotId
    || snapshot.snapshotHash !== verification.snapshotHash
    || snapshot.dataHash !== verification.dataHash) errors.push("snapshot identities do not match verification");
  if (!Array.isArray(snapshot.universe) || snapshot.universe.length < 2) errors.push("portfolio evidence requires at least two symbols");
  if (!snapshot.hkConnectUniverse || snapshot.universe.some((item) => !/^HK\.\d{5}$/.test(item.symbol))) {
    errors.push("official Hong Kong Connect universe binding is missing");
  }
  if (!Array.isArray(snapshot.bars) || snapshot.bars.length < 4) errors.push("snapshot bars are missing");
  if (snapshot.authority?.type !== "research_only" || snapshot.authority?.advisoryOnly !== true) errors.push("snapshot authority is unsafe");
  for (const field of ["ranking", "recommendation", "score", "allocation", "sizing", "targetPrice", "buySellHold", "orderTradeFill", "cashFeePositionMutation", "brokerWrite", "productionWrite", "officialPortfolioFact", "officialReviewFact"]) {
    if (snapshot.authority?.[field] !== false) errors.push(`snapshot authority ${field} must be false`);
  }
  if (!executionConfig?.fees || !executionConfig?.execution) errors.push("execution evidence is missing");
  if (executionConfig?.execution?.allowSameBarExecution !== false || executionConfig?.execution?.allowMargin !== false) errors.push("execution evidence is unsafe");
  return errors;
}

function sampleCovariance(left, right) {
  const leftMean = mean(left);
  const rightMean = mean(right);
  return left.reduce((total, value, index) => total + (value - leftMean) * (right[index] - rightMean), 0) / (left.length - 1);
}

function sampleStandardDeviation(values) {
  return Math.sqrt(sampleCovariance(values, values));
}

function historicalTailLossMagnitude(values, confidence) {
  const tailCount = Math.max(1, Math.ceil(values.length * (1 - confidence)));
  return Math.max(0, -mean([...values].sort((left, right) => left - right).slice(0, tailCount)));
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function fail(goNoGo, details) {
  console.error(JSON.stringify({ ok: false, goNoGo, ...details }, null, 2));
  process.exit(1);
}

function isStrictInstant(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && new Date(value).toISOString() === value;
}

async function readText(path) {
  return readFile(resolvePath(path), "utf8");
}

async function hashFile(path) {
  return sha256(await readText(path));
}

function resolvePath(path) {
  return String(path).startsWith("/") ? String(path) : join(root, String(path));
}

function relative(path) {
  return path.startsWith(root) ? path.slice(root.length + 1) : path;
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
