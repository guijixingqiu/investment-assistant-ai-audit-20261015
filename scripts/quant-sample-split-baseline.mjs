#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";
import { computeHkCashEquityFees, feePolicySha256, FEE_POLICY_VERSION } from "./lib/hk-fee-policy.mjs";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);
const configPath = process.env.QUANT_SAMPLE_SPLIT_BASELINE_CONFIG ?? "config/quant-sample-split-baseline.hk-09926.json";
const config = isDirectExecution ? JSON.parse(await readText(configPath)) : null;
const outputDir = isDirectExecution ? resolvePath(config.outputDir ?? "artifacts/quant-sample-split-baseline/latest") : null;

if (isDirectExecution) {
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const configQuality = checkConfig(config);
if (!configQuality.ok) {
  await writeJson("config-quality.json", configQuality);
  fail("no_go_fix_quant_sample_split_config", { configQuality });
}

const freeze = await runJson(process.execPath, ["scripts/quant-freeze-snapshot-verify.mjs"], {
  QUANT_FREEZE_CONFIG: config.freezeConfigPath
});
const snapshot = JSON.parse(await readText(freeze.snapshotPath));
const freezeManifest = JSON.parse(await readText(freeze.manifestPath));
const snapshotText = await readText(freeze.snapshotPath);
const accountingPriceAuthority = checkAccountingPriceAuthority(snapshot, freezeManifest);
if (!accountingPriceAuthority.ok) {
  fail("adjusted_prices_not_accounting_authority", { accountingPriceAuthority });
}
const bars = normalizeBars(snapshot.bars);
const splitRegistry = buildSplitRegistry(config.splitRegistry, bars);
const splitQuality = checkSplitRegistry(splitRegistry, bars, snapshot);
if (!splitQuality.ok) {
  await writeJson("split-quality.json", splitQuality);
  fail("no_go_fix_quant_sample_split_registry", { splitQuality });
}

const sourceScan = await scanSources();
const codeIdentity = {
  commit: gitHead(),
  scriptPath: "scripts/quant-sample-split-baseline.mjs",
  scriptHash: await hashFile("scripts/quant-sample-split-baseline.mjs")
};
const configHash = await hashFile(configPath);
const dataIdentity = {
  snapshotId: snapshot.snapshotId,
  snapshotHash: snapshot.snapshotHash,
  dataHash: snapshot.dataHash,
  snapshotFileHash: sha256(snapshotText),
  sourceIdentity: snapshot.sourceIdentity,
  sourceClassification: snapshot.sourceClassification,
  dataCutoff: snapshot.dataCutoff,
  dateRange: snapshot.dateRange,
  universe: snapshot.universe,
  adjustment: snapshot.adjustment
};
const parameterPolicy = {
  preregistered: config.parameterPolicy.preregistered === true,
  registrationTiming: config.experiment.registrationTiming,
  registeredAt: config.experiment.registeredAt,
  dataCutoff: snapshot.dataCutoff,
  registrationAfterDataCutoff: Date.parse(config.experiment.registeredAt) > Date.parse(snapshot.dataCutoff),
  prospectiveHoldoutClaim: config.parameterPolicy.prospectiveHoldoutClaim === true,
  selectedParameterSetId: config.experiment.parameterSetId,
  allowedSelectionSplits: config.parameterPolicy.allowedSelectionSplits,
  finalTestUsedForParameterSelection: config.parameterPolicy.finalTestUsedForParameterSelection,
  finalTestUsedForAcceptanceThresholdFitting: config.parameterPolicy.finalTestUsedForAcceptanceThresholdFitting,
  finalTestRole: config.parameterPolicy.finalTestRole
};

const splitRuns = {};
for (const split of splitRegistry.splits) {
  const splitBars = bars.filter((bar) => bar.tradeDate >= split.start && bar.tradeDate <= split.end);
  splitRuns[split.id] = runBaselineSplit(split, splitBars, config, snapshot);
}

const failureReport = buildFailureReport({ configQuality, splitQuality, sourceScan, splitRuns, freeze, snapshot, parameterPolicy });
const metrics = Object.fromEntries(Object.entries(splitRuns).map(([id, run]) => [id, run.metrics]));
const experimentIdentity = sha256(stableJson({
  schemaVersion: "2026-07-10.quant-sample-split-experiment-identity.v2",
  experiment: config.experiment,
  splitRegistry,
  parameterPolicy,
  dataIdentity: {
    snapshotId: dataIdentity.snapshotId,
    snapshotHash: dataIdentity.snapshotHash,
    dataHash: dataIdentity.dataHash
  },
  configHash,
  codeIdentity
}));
const researchAuthority = {
  type: "research_evidence_only",
  advisoryOnly: true,
  ranking: false,
  recommendation: false,
  score: false,
  allocation: false,
  sizing: false,
  targetPrice: false,
  buySellHold: false,
  orderTradeFill: false,
  cashFeePositionMutation: false,
  brokerWrite: false,
  productionWrite: false,
  officialPortfolioFact: false,
  officialReviewFact: false
};
const safety = {
  readsFrozenSnapshot: true,
  sendsLiveNetworkRequests: false,
  writesProductionDatabase: false,
  enablesTrading: false,
  initializesBrokerGateway: false,
  mutatesOfficialPortfolio: false,
  mutatesOfficialReview: false,
  touchesRealTradesPositionsReviews: false
};
const result = {
  schemaVersion: "2026-07-10.quant-sample-split-baseline.run.v2",
  ok: failureReport.blockers.length === 0,
  goNoGo: failureReport.blockers.length === 0
    ? "quant_sample_split_baseline_foundation_passed"
    : "no_go_fix_quant_sample_split_baseline",
  generatedAt: new Date().toISOString(),
  configPath,
  configHash,
  feePolicyVersion: FEE_POLICY_VERSION,
  feePolicySha256: feePolicySha256(),
  // Observed snapshot sessions only: this run does not verify HKEX historical
  // session completeness, so the legacy next_trading_day_open enum is reported
  // as a next-observed-session assumption rather than a verified calendar.
  executionCalendar: {
    timing: "next_observed_session_open",
    calendarCompleteness: "unknown",
    legacyConfigTiming: config.execution?.earliestExecution ?? null,
    limitation: "Execution follows the next observed snapshot session; HKEX historical calendar completeness and halt/adjacency are not verified."
  },
  codeIdentity,
  experimentIdentity,
  dataIdentity,
  splitRegistry,
  parameterPolicy,
  strategy: config.strategy,
  execution: config.execution,
  fees: config.fees,
  accountingPriceAuthority,
  splitRuns,
  metrics,
  limitations: config.limitations,
  accountingAudit: Object.fromEntries(Object.entries(splitRuns).map(([id, run]) => [id, run.accountingAudit])),
  failureReport,
  researchAuthority,
  safety,
  artifacts: [
    "run_manifest.json",
    "config-quality.json",
    "split-registry.json",
    "split-quality.json",
    "data-identity.json",
    "metrics.json",
    "failure-report.json",
    "research-evidence.json"
  ]
};

await writeJson("config-quality.json", configQuality);
await writeJson("split-registry.json", splitRegistry);
await writeJson("split-quality.json", splitQuality);
await writeJson("data-identity.json", dataIdentity);
await writeJson("metrics.json", metrics);
await writeJson("failure-report.json", failureReport);
await writeJson("research-evidence.json", {
  experimentIdentity,
  dataIdentity,
  splitRegistry,
  parameterPolicy,
  metrics,
  limitations: config.limitations,
  authority: researchAuthority,
  safety
});
await writeJson("run_manifest.json", result);

console.log(JSON.stringify({
  ok: result.ok,
  goNoGo: result.goNoGo,
  outputDir: relative(outputDir),
  experimentIdentity,
  snapshotId: dataIdentity.snapshotId,
  snapshotHash: dataIdentity.snapshotHash,
  configHash,
  codeIdentity,
  splitIds: splitRegistry.splits.map((split) => split.id),
  metrics,
  accountingPriceAuthority,
  failureReport,
  researchAuthority,
  safety
}, null, 2));

if (!result.ok) process.exit(1);
}

function checkConfig(cfg) {
  const issues = [];
  if (cfg.schemaVersion !== "2026-07-10.quant-sample-split-baseline.v2") {
    issues.push({ level: "error", type: "invalid_schema_version", schemaVersion: cfg.schemaVersion });
  }
  for (const field of ["freezeConfigPath", "outputDir"]) {
    if (typeof cfg[field] !== "string" || cfg[field].trim() === "") issues.push({ level: "error", type: "missing_config_field", field });
  }
  for (const field of ["experimentId", "strategyVersion", "parameterSetId", "registeredAt", "registrationTiming", "purpose"]) {
    if (typeof cfg.experiment?.[field] !== "string" || cfg.experiment[field].trim() === "") {
      issues.push({ level: "error", type: "missing_experiment_field", field });
    }
  }
  if (!isStrictIsoInstant(cfg.experiment?.registeredAt)) {
    issues.push({ level: "error", type: "invalid_experiment_registered_at", registeredAt: cfg.experiment?.registeredAt });
  }
  if (cfg.experiment?.registrationTiming !== "retrospective_after_snapshot") {
    issues.push({ level: "error", type: "invalid_registration_timing", registrationTiming: cfg.experiment?.registrationTiming });
  }
  if (cfg.parameterPolicy?.preregistered !== false) {
    issues.push({ level: "error", type: "preregistration_claim_forbidden", preregistered: cfg.parameterPolicy?.preregistered });
  }
  if (cfg.parameterPolicy?.prospectiveHoldoutClaim !== false) {
    issues.push({ level: "error", type: "prospective_holdout_claim_forbidden", prospectiveHoldoutClaim: cfg.parameterPolicy?.prospectiveHoldoutClaim });
  }
  if (cfg.parameterPolicy?.finalTestUsedForParameterSelection !== false) {
    issues.push({ level: "error", type: "final_test_parameter_selection_forbidden" });
  }
  if (cfg.parameterPolicy?.finalTestUsedForAcceptanceThresholdFitting !== false) {
    issues.push({ level: "error", type: "final_test_acceptance_threshold_fitting_forbidden" });
  }
  if (cfg.parameterPolicy?.finalTestRole !== "locked_report_only") {
    issues.push({ level: "error", type: "invalid_final_test_role", finalTestRole: cfg.parameterPolicy?.finalTestRole });
  }
  if (!Array.isArray(cfg.parameterPolicy?.allowedSelectionSplits)
    || cfg.parameterPolicy.allowedSelectionSplits.includes("final_test")
    || !cfg.parameterPolicy.allowedSelectionSplits.includes("train")
    || !cfg.parameterPolicy.allowedSelectionSplits.includes("validation")) {
    issues.push({ level: "error", type: "invalid_allowed_selection_splits", allowedSelectionSplits: cfg.parameterPolicy?.allowedSelectionSplits });
  }
  if (!Number.isFinite(Number(cfg.initialCash)) || Number(cfg.initialCash) <= 0) {
    issues.push({ level: "error", type: "invalid_initial_cash", initialCash: cfg.initialCash });
  }
  if (!Number.isFinite(Number(cfg.targetGrossExposure)) || Number(cfg.targetGrossExposure) <= 0 || Number(cfg.targetGrossExposure) > 1) {
    issues.push({ level: "error", type: "invalid_target_gross_exposure", targetGrossExposure: cfg.targetGrossExposure });
  }
  if (cfg.execution?.signalTiming !== "after_close_t") issues.push({ level: "error", type: "invalid_signal_timing" });
  if (cfg.execution?.earliestExecution !== "next_trading_day_open") issues.push({ level: "error", type: "invalid_earliest_execution" });
  if (cfg.execution?.allowSameBarExecution !== false) issues.push({ level: "error", type: "same_bar_execution_forbidden" });
  if (cfg.execution?.allowMargin !== false) issues.push({ level: "error", type: "margin_forbidden" });
  if (!Array.isArray(cfg.splitRegistry?.splits) || cfg.splitRegistry.splits.length !== 3) {
    issues.push({ level: "error", type: "invalid_split_registry" });
  }
  if (!Array.isArray(cfg.limitations) || cfg.limitations.length === 0) {
    issues.push({ level: "error", type: "missing_limitations" });
  }
  const feeFields = ["commissionRate", "minCommission", "platformFee", "stampDutyRate", "tradingFeeRate", "transactionLevyRate"];
  const feeTotal = feeFields.reduce((sum, field) => sum + Number(cfg.fees?.[field] ?? 0), 0);
  if (feeTotal <= 0) issues.push({ level: "error", type: "zero_fee_model_forbidden" });
  return { ok: issues.every((issue) => issue.level !== "error"), issues };
}

function checkAccountingPriceAuthority(snapshot, manifest) {
  const acceptedAdjustments = ["none", "unadjusted"];
  const barAdjustments = [...new Set((snapshot.bars ?? []).map((bar) => bar.adjustment))];
  const ok = acceptedAdjustments.includes(snapshot.adjustment)
    && manifest.adjustment === snapshot.adjustment
    && barAdjustments.length > 0
    && barAdjustments.every((adjustment) => adjustment === snapshot.adjustment);
  return {
    ok,
    error: ok ? null : "adjusted_prices_not_accounting_authority",
    acceptedAdjustments,
    snapshotAdjustment: snapshot.adjustment ?? null,
    manifestAdjustment: manifest.adjustment ?? null,
    barAdjustments
  };
}

function buildSplitRegistry(registry, bars) {
  return {
    schemaVersion: "2026-07-10.quant-sample-split-registry.v2",
    registeredAt: config.experiment.registeredAt,
    registrationTiming: config.experiment.registrationTiming,
    preregistered: config.parameterPolicy.preregistered === true,
    prospectiveHoldoutClaim: config.parameterPolicy.prospectiveHoldoutClaim === true,
    registrationSource: registry.registrationSource,
    barsDateRange: {
      start: bars[0]?.tradeDate ?? null,
      end: bars.at(-1)?.tradeDate ?? null
    },
    splits: registry.splits.map((split) => ({
      id: split.id,
      role: split.role,
      start: split.start,
      end: split.end,
      parameterSelectionAllowed: split.parameterSelectionAllowed === true,
      finalTestLocked: split.finalTestLocked === true,
      purpose: split.purpose
    }))
  };
}

function checkSplitRegistry(registry, bars, snapshot) {
  const issues = [];
  const expectedIds = ["train", "validation", "final_test"];
  const byId = new Map(registry.splits.map((split) => [split.id, split]));
  if (registry.registrationTiming !== "retrospective_after_snapshot") issues.push({ level: "error", type: "invalid_split_registration_timing" });
  if (registry.preregistered !== false) issues.push({ level: "error", type: "split_preregistration_claim_forbidden" });
  if (registry.prospectiveHoldoutClaim !== false) issues.push({ level: "error", type: "split_prospective_holdout_claim_forbidden" });
  if (Date.parse(registry.registeredAt) <= Date.parse(snapshot.dataCutoff)) {
    issues.push({ level: "error", type: "retrospective_registration_must_follow_snapshot_cutoff", registeredAt: registry.registeredAt, dataCutoff: snapshot.dataCutoff });
  }
  for (const id of expectedIds) {
    if (!byId.has(id)) issues.push({ level: "error", type: "missing_split", id });
  }
  let previousEnd = null;
  for (const split of registry.splits) {
    if (!isStrictDate(split.start) || !isStrictDate(split.end)) issues.push({ level: "error", type: "invalid_split_date", splitId: split.id });
    if (isStrictDate(split.start) && isStrictDate(split.end) && split.start > split.end) issues.push({ level: "error", type: "invalid_split_order", splitId: split.id });
    if (previousEnd && split.start <= previousEnd) issues.push({ level: "error", type: "overlapping_or_unsorted_split", splitId: split.id });
    previousEnd = split.end;
    const rows = bars.filter((bar) => bar.tradeDate >= split.start && bar.tradeDate <= split.end);
    if (rows.length < 2) issues.push({ level: "error", type: "split_has_insufficient_rows", splitId: split.id, rows: rows.length });
  }
  if (byId.get("final_test")?.parameterSelectionAllowed !== false) issues.push({ level: "error", type: "final_test_selection_not_allowed" });
  if (byId.get("final_test")?.finalTestLocked !== true) issues.push({ level: "error", type: "final_test_not_locked" });
  if (byId.get("train")?.parameterSelectionAllowed !== true || byId.get("validation")?.parameterSelectionAllowed !== true) {
    issues.push({ level: "error", type: "train_validation_selection_boundary_missing" });
  }
  if (snapshot.sourceIdentity?.authority !== "research_only" || snapshot.authority?.officialPortfolioFact !== false) {
    issues.push({ level: "error", type: "snapshot_authority_not_research_only" });
  }
  return { ok: issues.every((issue) => issue.level !== "error"), issues };
}

export function runBaselineSplit(split, splitBars, cfg, snapshot) {
  assertUnadjustedAccountingPrices(snapshot, splitBars);
  const signals = generateBaselineSignals(split, splitBars, cfg);
  const lotSize = Number(snapshot.universe[0]?.lotSize ?? 1);
  const orders = [];
  const trades = [];
  const nav = [];
  let cash = Number(cfg.initialCash);
  let position = 0;
  const signalsByExecutionDate = new Map(signals.map((signal) => [signal.earliestExecutionDate, signal]));
  for (const bar of splitBars) {
    const signal = signalsByExecutionDate.get(bar.tradeDate);
    if (!signal) {
      nav.push(navRow(bar, cash, position));
      continue;
    }
    const executionRejectionReason = nonTradeableExecutionReason(bar);
    const invalidTargetPrice = !Number.isFinite(bar.open) || bar.open <= 0;
    if (signal.target === "long" && invalidTargetPrice) {
      orders.push({
        splitId: split.id,
        signalDate: signal.signalDate,
        tradeDate: bar.tradeDate,
        side: "buy",
        quantity: 0,
        boardLot: lotSize,
        roundedToBoardLot: false,
        sameBarExecution: signal.signalDate === bar.tradeDate,
        price: bar.open,
        rejected: true,
        reason: "invalid_execution_price"
      });
      nav.push(navRow(bar, cash, position));
      continue;
    }
    const sizing = planTargetSizing({ signal, bar, cash, position, cfg, lotSize });
    const delta = sizing.executableTargetQuantity - position;
    if (delta === 0) {
      nav.push(navRow(bar, cash, position));
      continue;
    }
    const side = delta > 0 ? "buy" : "sell";
    const quantity = Math.abs(delta);
    const order = {
      splitId: split.id,
      signalDate: signal.signalDate,
      tradeDate: bar.tradeDate,
      side,
      quantity,
      boardLot: lotSize,
      roundedToBoardLot: quantity % lotSize === 0,
      sameBarExecution: signal.signalDate === bar.tradeDate,
      price: bar.open,
      preTradeNav: sizing.preTradeNav,
      targetGrossExposure: Number(cfg.targetGrossExposure),
      requestedTargetQuantity: sizing.requestedTargetQuantity,
      executableTargetQuantity: sizing.executableTargetQuantity,
      cashLimitedByFees: sizing.cashLimitedByFees
    };
    if (executionRejectionReason) {
      orders.push({
        ...order,
        rejected: true,
        reason: executionRejectionReason
      });
      nav.push(navRow(bar, cash, position));
      continue;
    }
    const gross = quantity * bar.open;
    const fees = computeFees(gross, side, bar.tradeDate, cfg.fees);
    const cashDelta = side === "buy" ? -(gross + fees.totalFees) : gross - fees.totalFees;
    if (cash + cashDelta < -0.000001) {
      orders.push({ ...order, rejected: true, reason: "insufficient_cash" });
      nav.push(navRow(bar, cash, position));
      continue;
    }
    cash = round(cash + cashDelta, 2);
    position += delta;
    orders.push(order);
    trades.push({ ...order, gross: round(gross, 2), ...fees });
    nav.push(navRow(bar, cash, position));
  }
  const accountingAudit = auditBaselineAccounting({ split, splitBars, signals, orders, trades, nav, cfg, lotSize });
  const metrics = {
    ...computeMetrics(nav, trades, Number(cfg.initialCash)),
    accountingAuditStatus: accountingAudit.ok ? "passed" : "failed"
  };
  return { split, bars: splitBars.length, signals, orders, trades, nav, metrics, accountingAudit };
}

export function auditBaselineAccounting({ split, splitBars, signals, orders, trades, nav, cfg, lotSize }) {
  const expectedSignals = generateBaselineSignals(split, splitBars, cfg);
  const barsByDate = new Map(splitBars.map((bar) => [bar.tradeDate, bar]));
  const signalsByDate = new Map(expectedSignals.map((signal) => [signal.signalDate, signal]));
  const signalsByExecutionDate = new Map(expectedSignals.map((signal) => [signal.earliestExecutionDate, signal]));
  const ordersByDate = new Map();
  for (const order of orders) {
    const rows = ordersByDate.get(order.tradeDate) ?? [];
    rows.push(order);
    ordersByDate.set(order.tradeDate, rows);
  }
  const tradesByDate = new Map();
  for (const trade of trades) {
    const rows = tradesByDate.get(trade.tradeDate) ?? [];
    rows.push(trade);
    tradesByDate.set(trade.tradeDate, rows);
  }

  const checks = {
    signalsMatchConfiguredStrategy: isDeepStrictEqual(signals, expectedSignals),
    cashNeverNegative: true,
    allOrdersNextDayOrLater: orders.every((order) => order.signalDate < order.tradeDate),
    allTradesNextDayOrLater: trades.every((trade) => trade.signalDate < trade.tradeDate),
    noSameBarExecutions: orders.every((order) => order.sameBarExecution === false)
      && trades.every((trade) => trade.sameBarExecution === false),
    ordersMatchSignalExecutionDate: orders.every((order) => {
      const signal = signalsByDate.get(order.signalDate);
      return signal?.earliestExecutionDate === order.tradeDate;
    }),
    boardLotRounded: orders.every((order) => order.boardLot === lotSize
      && order.roundedToBoardLot === true
      && Number.isInteger(order.quantity)
      && order.quantity > 0
      && order.quantity % lotSize === 0),
    nonzeroFeesWhenTraded: trades.length === 0 || trades.every((trade) => trade.totalFees > 0),
    noTradesOnNonTradeableBars: trades.every((trade) => nonTradeableExecutionReason(barsByDate.get(trade.tradeDate)) === null),
    noImplicitLeverage: true,
    navDatesMatchBars: nav.length === splitBars.length,
    cashLedgerReconciles: true,
    positionLedgerReconciles: true,
    feeLedgerReconciles: true,
    navReconciles: true,
    orderTradeBindingsReconcile: true,
    configuredTargetGrossExposureReconciles: true,
    maximumExecutableBoardLotsReconcile: true,
    executionPricesAvailableForTargets: !orders.some((order) => order.reason === "invalid_execution_price"),
    valuationPricesAvailable: splitBars.every((bar) => Number.isFinite(bar.close) && bar.close > 0)
  };

  let expectedCash = Number(cfg.initialCash);
  let expectedPosition = 0;
  for (let index = 0; index < splitBars.length; index += 1) {
    const bar = splitBars[index];
    const row = nav[index];
    const signal = signalsByExecutionDate.get(bar.tradeDate);
    const dateOrders = ordersByDate.get(bar.tradeDate) ?? [];
    const dateTrades = tradesByDate.get(bar.tradeDate) ?? [];
    const preTradePosition = expectedPosition;
    let auditedSizing = null;
    let executionRejectionReason = null;
    if (signal && !(signal.target === "long" && (!Number.isFinite(bar.open) || bar.open <= 0))) {
      auditedSizing = deriveAuditedTargetSizing({ signal, bar, cash: expectedCash, position: expectedPosition, cfg, lotSize });
      executionRejectionReason = nonTradeableExecutionReason(bar);
      const expectedDelta = auditedSizing.executableTargetQuantity - expectedPosition;
      const expectedSide = expectedDelta > 0 ? "buy" : "sell";
      const expectedQuantity = Math.abs(expectedDelta);
      const expectedOrderCount = expectedDelta === 0 ? 0 : 1;

      if (!targetQuantityMatchesExposure(signal.target, auditedSizing, bar.open, cfg, lotSize)
        || dateOrders.length !== expectedOrderCount
        || dateOrders.some((order) => order.preTradeNav !== auditedSizing.preTradeNav
          || order.targetGrossExposure !== Number(cfg.targetGrossExposure)
          || order.requestedTargetQuantity !== auditedSizing.requestedTargetQuantity)) {
        checks.configuredTargetGrossExposureReconciles = false;
      }

      if (dateOrders.length !== expectedOrderCount
        || dateOrders.some((order) => order.executableTargetQuantity !== auditedSizing.executableTargetQuantity
          || order.cashLimitedByFees !== auditedSizing.cashLimitedByFees
          || order.side !== expectedSide
          || order.quantity !== expectedQuantity)) {
        checks.maximumExecutableBoardLotsReconcile = false;
      }

      if (expectedOrderCount === 0) {
        if (dateTrades.length !== 0) checks.maximumExecutableBoardLotsReconcile = false;
      } else if (executionRejectionReason) {
        if (dateOrders[0]?.rejected !== true || dateTrades.length !== 0) {
          checks.maximumExecutableBoardLotsReconcile = false;
        }
      } else if (dateOrders[0]?.rejected === true
        || dateTrades.length !== 1
        || dateTrades[0]?.preTradeNav !== auditedSizing.preTradeNav
        || dateTrades[0]?.targetGrossExposure !== Number(cfg.targetGrossExposure)
        || dateTrades[0]?.requestedTargetQuantity !== auditedSizing.requestedTargetQuantity
        || dateTrades[0]?.executableTargetQuantity !== auditedSizing.executableTargetQuantity
        || dateTrades[0]?.cashLimitedByFees !== auditedSizing.cashLimitedByFees) {
        checks.maximumExecutableBoardLotsReconcile = false;
      }
    }
    if (!row || row.tradeDate !== bar.tradeDate) checks.navDatesMatchBars = false;
    for (const trade of dateTrades) {
      const rawGross = trade.quantity * bar.open;
      const gross = round(rawGross, 2);
      const fees = computeFees(rawGross, trade.side, bar.tradeDate, cfg.fees);
      const matchingOrders = orders.filter((order) => order.rejected !== true
        && order.splitId === trade.splitId
        && order.signalDate === trade.signalDate
        && order.tradeDate === trade.tradeDate
        && order.side === trade.side
        && order.quantity === trade.quantity
        && order.price === trade.price);
      if (matchingOrders.length !== 1) checks.orderTradeBindingsReconcile = false;
      if (trade.price !== bar.open
        || trade.gross !== gross
        || [
          "commission", "platformFee", "stampDuty", "tradingFee", "tradingTariff",
          "transactionLevy", "afrc", "settlementFee", "totalFees"
        ]
          .some((field) => trade[field] !== fees[field])) {
        checks.feeLedgerReconciles = false;
      }
      const cashDelta = trade.side === "buy" ? -(rawGross + fees.totalFees) : rawGross - fees.totalFees;
      expectedCash = round(expectedCash + cashDelta, 2);
      expectedPosition += trade.side === "buy" ? trade.quantity : -trade.quantity;
    }
    if (auditedSizing) {
      const expectedPostTradePosition = executionRejectionReason
        ? preTradePosition
        : auditedSizing.executableTargetQuantity;
      if (expectedPosition !== expectedPostTradePosition) checks.maximumExecutableBoardLotsReconcile = false;
    }
    if (!row || row.cash !== expectedCash) checks.cashLedgerReconciles = false;
    if (!row || row.position !== expectedPosition || expectedPosition < 0 || expectedPosition % lotSize !== 0) {
      checks.positionLedgerReconciles = false;
    }
    const expectedNav = navRow(bar, expectedCash, expectedPosition);
    if (!row || ["tradeDate", "cash", "position", "close", "marketValue", "equity", "grossExposure"]
      .some((field) => row[field] !== expectedNav[field])) {
      checks.navReconciles = false;
    }
    if (expectedCash < 0 || !Number.isFinite(expectedCash)) checks.cashNeverNegative = false;
    if (!Number.isFinite(expectedNav.grossExposure) || expectedNav.grossExposure > 1) checks.noImplicitLeverage = false;
  }
  const acceptedOrders = orders.filter((order) => order.rejected !== true);
  if (acceptedOrders.length !== trades.length
    || acceptedOrders.some((order) => trades.filter((trade) => trade.splitId === order.splitId
      && trade.signalDate === order.signalDate
      && trade.tradeDate === order.tradeDate
      && trade.side === order.side
      && trade.quantity === order.quantity
      && trade.price === order.price).length !== 1)
    || orders.filter((order) => order.rejected === true).some((order) => trades.some((trade) => trade.splitId === order.splitId
      && trade.signalDate === order.signalDate
      && trade.tradeDate === order.tradeDate))) {
    checks.orderTradeBindingsReconcile = false;
  }

  return { ok: Object.values(checks).every(Boolean), ...checks };
}

function generateBaselineSignals(split, splitBars, cfg) {
  if (typeof split?.id !== "string" || split.id.trim() === "") {
    throw new Error("baseline split identity is required");
  }
  const signals = [];
  for (let index = 1; index < splitBars.length - 1; index += 1) {
    const previous = splitBars[index - 1];
    const current = splitBars[index];
    const next = splitBars[index + 1];
    const closeReturn = (current.close - previous.close) / previous.close;
    let target = "flat";
    if (closeReturn <= cfg.strategy.buyWhenPreviousCloseReturnLte) target = "long";
    if (closeReturn >= cfg.strategy.sellWhenPreviousCloseReturnGte) target = "flat";
    signals.push({
      splitId: split.id,
      symbol: `${current.market}.${current.code}`,
      signalDate: current.tradeDate,
      earliestExecutionDate: next.tradeDate,
      closeReturn: round(closeReturn, 8),
      target
    });
  }
  return signals;
}

function assertUnadjustedAccountingPrices(snapshot, splitBars) {
  const acceptedAdjustments = new Set(["none", "unadjusted"]);
  const snapshotAdjustment = snapshot?.adjustment;
  const barAdjustments = [...new Set(splitBars.map((bar) => bar.adjustment))];
  if (!acceptedAdjustments.has(snapshotAdjustment)
    || barAdjustments.length === 0
    || barAdjustments.some((adjustment) => adjustment !== snapshotAdjustment)) {
    throw new Error("adjusted_prices_not_accounting_authority");
  }
}

function planTargetSizing({ signal, bar, cash, position, cfg, lotSize }) {
  const preTradeNav = round(cash + position * bar.open, 2);
  const requestedTargetQuantity = signal.target === "long"
    ? Math.floor((preTradeNav * Number(cfg.targetGrossExposure)) / (bar.open * lotSize)) * lotSize
    : 0;
  let executableTargetQuantity = requestedTargetQuantity;
  if (executableTargetQuantity > position) {
    while (executableTargetQuantity > position) {
      const buyQuantity = executableTargetQuantity - position;
      const gross = buyQuantity * bar.open;
      const fees = computeFees(gross, "buy", bar.tradeDate, cfg.fees);
      if (cash - gross - fees.totalFees >= -0.000001) break;
      executableTargetQuantity -= lotSize;
    }
  }
  return {
    preTradeNav,
    requestedTargetQuantity,
    executableTargetQuantity,
    cashLimitedByFees: executableTargetQuantity < requestedTargetQuantity
  };
}

function deriveAuditedTargetSizing({ signal, bar, cash, position, cfg, lotSize }) {
  const preTradeNav = round(cash + position * bar.open, 2);
  const exposureLimit = preTradeNav * Number(cfg.targetGrossExposure);
  const requestedTargetQuantity = signal.target === "long"
    ? Math.floor(exposureLimit / (bar.open * lotSize)) * lotSize
    : 0;
  let executableTargetQuantity = requestedTargetQuantity;
  if (executableTargetQuantity > position) {
    for (; executableTargetQuantity > position; executableTargetQuantity -= lotSize) {
      const candidateQuantity = executableTargetQuantity - position;
      const candidateGross = candidateQuantity * bar.open;
      const candidateFees = computeFees(candidateGross, "buy", bar.tradeDate, cfg.fees);
      if (candidateGross + candidateFees.totalFees <= cash + 0.000001) break;
    }
  }
  return {
    preTradeNav,
    requestedTargetQuantity,
    executableTargetQuantity,
    cashLimitedByFees: executableTargetQuantity < requestedTargetQuantity
  };
}

function targetQuantityMatchesExposure(target, sizing, price, cfg, lotSize) {
  if (target === "flat") return sizing.requestedTargetQuantity === 0;
  const exposureLimit = sizing.preTradeNav * Number(cfg.targetGrossExposure);
  const requestedGross = sizing.requestedTargetQuantity * price;
  if (requestedGross > exposureLimit + 0.000001) return false;
  return (sizing.requestedTargetQuantity + lotSize) * price > exposureLimit - 0.000001;
}

function nonTradeableExecutionReason(bar) {
  if (!bar) return "missing_execution_bar";
  const tradingStatus = String(bar.tradingStatus ?? bar.tradeStatus ?? "").toLowerCase();
  if (bar.suspended === true || tradingStatus === "suspended" || tradingStatus === "halted") return "suspended_bar";
  if (!Number.isFinite(bar.volume) || bar.volume <= 0) return "zero_or_missing_volume";
  if (!Number.isFinite(bar.open) || bar.open <= 0) return "invalid_execution_price";
  return null;
}

function navRow(bar, cash, position) {
  const marketValue = round(position * bar.close, 2);
  const equity = round(cash + marketValue, 2);
  return {
    tradeDate: bar.tradeDate,
    cash,
    position,
    close: bar.close,
    marketValue,
    equity,
    grossExposure: equity > 0 ? round(Math.abs(marketValue) / equity, 8) : 0
  };
}

function computeFees(gross, side, tradeDate, fees) {
  const computed = computeHkCashEquityFees({
    side,
    tradeDate,
    grossAmount: gross,
    commissionRate: fees?.commissionRate,
    minCommission: fees?.minCommission,
    platformFee: fees?.platformFee
  });
  return { ...computed.fees, totalFees: computed.totalFees };
}

function computeMetrics(nav, trades, initialCash) {
  const finalEquity = nav.at(-1)?.equity ?? initialCash;
  let peak = initialCash;
  let maxDrawdown = 0;
  for (const row of nav) {
    peak = Math.max(peak, row.equity);
    maxDrawdown = Math.min(maxDrawdown, (row.equity - peak) / peak);
  }
  const returns = [];
  for (let index = 1; index < nav.length; index += 1) {
    returns.push((nav[index].equity - nav[index - 1].equity) / nav[index - 1].equity);
  }
  const avg = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance = returns.length ? returns.reduce((sum, value) => sum + (value - avg) ** 2, 0) / returns.length : 0;
  const sharpe = variance > 0 ? (avg / Math.sqrt(variance)) * Math.sqrt(252) : 0;
  const totalGross = trades.reduce((sum, trade) => sum + trade.gross, 0);
  return {
    finalEquity: round(finalEquity, 2),
    totalReturn: round((finalEquity - initialCash) / initialCash, 8),
    maxDrawdown: round(maxDrawdown, 8),
    sharpe: round(sharpe, 6),
    tradeCount: trades.length,
    totalFees: round(trades.reduce((sum, trade) => sum + trade.totalFees, 0), 2),
    turnoverOneWay: round(totalGross / (2 * initialCash), 8),
    turnoverTwoWay: round(totalGross / initialCash, 8),
    turnoverDefinition: {
      denominator: "initial_cash",
      oneWay: "sum_absolute_trade_gross / (2 * initial_cash)",
      twoWay: "sum_absolute_trade_gross / initial_cash"
    },
    averageGrossExposure: round(nav.reduce((sum, row) => sum + row.grossExposure, 0) / Math.max(nav.length, 1), 8),
  };
}

function buildFailureReport({ configQuality, splitQuality, sourceScan, splitRuns, freeze, snapshot, parameterPolicy }) {
  const blockers = [];
  const warnings = [];
  if (!configQuality.ok) blockers.push({ id: "config_quality", source: "config-quality.json" });
  if (!splitQuality.ok) blockers.push({ id: "split_registry", source: "split-quality.json" });
  if (sourceScan.errors.length > 0) blockers.push({ id: "source_scan", source: "scripts/quant-sample-split-baseline.mjs" });
  if (freeze.ok !== true) blockers.push({ id: "frozen_snapshot_verify", source: "node scripts/quant-freeze-snapshot-verify.mjs" });
  if (snapshot.authority?.officialPortfolioFact !== false) blockers.push({ id: "snapshot_authority", source: "frozen snapshot" });
  if (parameterPolicy.finalTestUsedForParameterSelection !== false) blockers.push({ id: "final_test_tuning_forbidden", source: "parameterPolicy" });
  for (const [splitId, run] of Object.entries(splitRuns)) {
    if (!run.accountingAudit.ok) blockers.push({ id: `accounting_audit_${splitId}`, source: "splitRuns" });
  }
  if (parameterPolicy.preregistered === false) {
    warnings.push({
      id: "retrospective_parameter_registration",
      registrationTiming: parameterPolicy.registrationTiming,
      registeredAt: parameterPolicy.registeredAt,
      dataCutoff: parameterPolicy.dataCutoff,
      evidenceBoundary: "no_preregistration_or_prospective_holdout_claim"
    });
  }
  return {
    ok: blockers.length === 0,
    hiddenFailures: false,
    blockedExperimentsRecorded: true,
    finalTestTuning: false,
    blockers,
    warnings
  };
}

async function scanSources() {
  const source = await readText("scripts/quant-sample-split-baseline.mjs");
  const rules = [
    ["shift_negative", /shift\s*\(\s*-/],
    ["future_index", /iloc\s*\[\s*i\s*\+/],
    ["centered_rolling", /center\s*=\s*true/i],
    ["backfill", /\bbfill\s*\(/],
    ["place" + "_order", new RegExp("\\bplace_" + "order\\b", "i")],
    ["submit" + "_order", new RegExp("\\bsubmit_" + "order\\b", "i")],
    ["unlock" + "_trade", new RegExp("\\bunlock_" + "trade\\b", "i")]
  ];
  const errors = [];
  source.split(/\r?\n/).forEach((line, index) => {
    for (const [rule, pattern] of rules) {
      if (pattern.test(line)) errors.push({ file: "scripts/quant-sample-split-baseline.mjs", line: index + 1, rule });
    }
  });
  return { ok: errors.length === 0, errors, warnings: [] };
}

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

async function runJson(command, args, env) {
  const result = await execFileAsync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    maxBuffer: 40 * 1024 * 1024
  });
  return JSON.parse(result.stdout.slice(result.stdout.lastIndexOf("\n{") + 1));
}

function fail(goNoGo, fields) {
  const result = { ok: false, goNoGo, configPath, ...fields };
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

async function writeJson(name, value) {
  await writeFile(join(outputDir, name), JSON.stringify(value, null, 2) + "\n");
}

async function readText(path) {
  return readFile(resolvePath(path), "utf8");
}

async function hashFile(path) {
  return sha256(await readText(path));
}

function gitHead() {
  try {
    return String(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root })).trim();
  } catch {
    return "unknown";
  }
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

function isStrictDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isStrictIsoInstant(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(value))) return false;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}
