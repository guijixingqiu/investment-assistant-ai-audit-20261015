import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { runBaselineSplit } from "../quant-sample-split-baseline.mjs";
import {
  FEE_POLICY_SUPPORTED_FROM,
  FEE_POLICY_VERSION,
  HK_FEE_POLICY_CANONICAL_JSON,
  HK_FEE_POLICY_SEGMENTS
} from "./hk-fee-policy.mjs";
import {
  DIVIDEND_CASH_POLICY,
  DIVIDEND_CASH_POLICY_SHA256,
  DIVIDEND_PAYMENT_LEDGER_SCHEMA,
  officialDividendPaymentMatches
} from "./quant-dividend-payment-sources.mjs";

export const REAL_DATA_QUANT_WITNESS_SCHEMA = "2026-07-19.real-data-quant-run-witness.v2";
export const REAL_DATA_QUANT_WITNESS_MAX_BYTES = 8 * 1024 * 1024;
export const REAL_DATA_FORMAL_ACCOUNTING_SCHEMA = "2026-07-19.real-data-formal-accounting-binding.v1";
export const REAL_DATA_ACCOUNTING_SNAPSHOT_SCHEMA = "2026-07-19.real-data-accounting-snapshot.v1";
export const REAL_DATA_CORPORATE_ACTION_LEDGER_SCHEMA = "2026-07-19.real-data-corporate-action-ledger.v1";
export const REAL_DATA_FORMAL_RUN_BINDING_SCHEMA = "2026-07-19.real-data-formal-run-binding.v1";
export const REAL_DATA_FORMAL_ACCOUNTING_AUDIT_SCHEMA = "2026-07-19.real-data-formal-accounting-audit.v1";

const SOURCE_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FREEZE_CONFIG_PATH = "config/quant-freeze-snapshot.pingan-hk-09926.json";
const PIPELINE_CONFIG_PATH = "config/quant-pipeline.pingan-hk-09926.json";
const SAMPLE_SPLIT_CONFIG_PATH = "config/quant-sample-split-baseline.pingan-hk-09926.json";
const AUDIT_SCAN_CONFIG_PATH = "config/quant-smoke.hk-09926.json";
const LEGACY_SAMPLE_SPLIT_SCRIPT_HASH = "ea4f55df383f49ad73069c0272f3cdc84de6a32df9696af3312f1dafd5462ab6";
const CURRENT_SAMPLE_SPLIT_SCRIPT_HASH = "24e0abbe69640387b045233a9e4d4a7ea815c92b1c19341f533c604defbfcb70";
const FORMAL_ACCOUNTING_BLOCKERS = Object.freeze([
  "unadjusted_accounting_snapshot_missing",
  "corporate_action_coverage_missing",
  "execution_and_valuation_basis_unbound"
]);
const FORMAL_PRICE_BASIS = Object.freeze({
  signal: "adjusted_qfq_close",
  execution: "unadjusted_open",
  valuation: "unadjusted_close",
  feeNotional: "unadjusted_trade_gross"
});
const EXPERIMENTS = Object.freeze([
  {
    id: "high_turnover_cost_rejection",
    configPath: "config/quant-smoke.pingan-hk-09926-high-turnover.json",
    metric: "totalFees",
    operator: ">",
    threshold: 50_000,
    criterion: "totalFees > 50000",
    expectedRejected: false
  },
  {
    id: "sparse_observation_rejection",
    configPath: "config/quant-smoke.pingan-hk-09926-sparse.json",
    metric: "tradeCount",
    operator: "<",
    threshold: 30,
    criterion: "tradeCount < 30",
    expectedRejected: false
  },
  {
    id: "zero_threshold_cost_rejection",
    configPath: "config/quant-smoke.pingan-hk-09926-zero-threshold.json",
    metric: "totalFees",
    operator: ">",
    threshold: 42_000,
    criterion: "totalFees > 42000",
    expectedRejected: true
  },
  {
    id: "ultra_sparse_observation_rejection",
    configPath: "config/quant-smoke.pingan-hk-09926-ultra-sparse.json",
    metric: "tradeCount",
    operator: "<",
    threshold: 10,
    criterion: "tradeCount < 10",
    expectedRejected: true
  }
]);

export function expectedRealDataQuantBuildInputPaths(
  approvedInputPath,
  primarySmokeConfigPath,
  formalAccounting = null
) {
  const formalAccountingPaths = formalAccounting?.status === "verified"
    ? [
        approvedFormalDataPath(formalAccounting.accountingSnapshot?.path, "accounting snapshot"),
        approvedFormalDataPath(formalAccounting.corporateActionCoverage?.path, "corporate-action ledger")
      ]
    : [];
  return [...new Set([
    ".nvmrc",
    "package.json",
    "package-lock.json",
    approvedInputPath,
    FREEZE_CONFIG_PATH,
    PIPELINE_CONFIG_PATH,
    primarySmokeConfigPath,
    AUDIT_SCAN_CONFIG_PATH,
    SAMPLE_SPLIT_CONFIG_PATH,
    ...EXPERIMENTS.map(({ configPath }) => configPath),
    "scripts/quant-freeze-snapshot.mjs",
    "scripts/quant-freeze-snapshot-verify.mjs",
    "scripts/quant-pipeline.mjs",
    "scripts/quant-smoke.mjs",
    "scripts/quant-audit.mjs",
    "scripts/quant-sample-split-baseline.mjs",
    "scripts/quant-real-data-evidence-summary.mjs",
    "scripts/lib/hk-fee-policy.mjs",
    "scripts/lib/real-data-quant-witness.mjs",
    "scripts/lib/real-data-quant-evidence.mjs",
    "scripts/lib/stage-13-20-evidence.mjs",
    "scripts/real-data-quant-evidence.mjs",
    ...formalAccountingPaths
  ])].sort();
}

export function buildRealDataQuantRunWitness({
  sourceCommitSha,
  nodeVersion,
  buildInputs,
  approvedInputPath,
  approvedInputSha256,
  lotSize,
  frozenManifest,
  frozenSnapshot,
  pipelineManifest,
  quantAudit,
  primary,
  sampleSplitManifest,
  failedExperiments,
  probes,
  summary,
  formalAccounting = null
}) {
  return {
    schemaVersion: REAL_DATA_QUANT_WITNESS_SCHEMA,
    commitSha: sourceCommitSha,
    runtime: { nodeVersion },
    buildInputs: structuredClone(buildInputs),
    approvedInput: { path: approvedInputPath, sha256: approvedInputSha256 },
    formalAccounting: structuredClone(formalAccounting ?? blockedFormalAccountingBinding({
      approvedInputPath,
      approvedInputSha256,
      frozenSnapshot
    })),
    lotSize,
    frozen: {
      manifest: structuredClone(frozenManifest),
      snapshot: structuredClone(frozenSnapshot)
    },
    pipeline: {
      manifest: structuredClone(pipelineManifest),
      audit: structuredClone(quantAudit)
    },
    primary: structuredClone(primary),
    sampleSplit: { manifest: structuredClone(sampleSplitManifest) },
    failedExperiments: structuredClone(failedExperiments),
    probes: structuredClone(probes),
    summary: structuredClone(summary)
  };
}

export function validateRealDataQuantRunWitness({
  witness,
  witnessBytes,
  sourceCommitSha,
  historicalSource,
  snapshot,
  sourceFileBytes
}) {
  requireCondition(SOURCE_COMMIT_PATTERN.test(sourceCommitSha ?? ""), "witness source commit is invalid");
  requireCondition(Buffer.isBuffer(witnessBytes), "witness bytes are required");
  requireCondition(witnessBytes.length <= REAL_DATA_QUANT_WITNESS_MAX_BYTES, "run witness exceeds the 8 MiB limit");
  requireCondition(canonicalJsonBytes(witness).equals(witnessBytes), "run witness must use canonical JSON bytes");
  strictKeys(witness, [
    "approvedInput", "buildInputs", "commitSha", "failedExperiments", "formalAccounting", "frozen", "lotSize",
    "pipeline", "primary", "probes", "runtime", "sampleSplit", "schemaVersion", "summary"
  ], "run witness");
  strictKeys(witness.runtime, ["nodeVersion"], "run witness runtime");
  strictKeys(witness.approvedInput, ["path", "sha256"], "run witness approved input");
  strictKeys(witness.frozen, ["manifest", "snapshot"], "run witness frozen evidence");
  strictKeys(witness.pipeline, ["audit", "manifest"], "run witness pipeline evidence");
  strictKeys(witness.sampleSplit, ["manifest"], "run witness sample split");
  requireCondition(witness.schemaVersion === REAL_DATA_QUANT_WITNESS_SCHEMA
    && witness.commitSha === sourceCommitSha,
  "run witness is not bound to the source commit");
  requireCondition(/^24\.\d+\.\d+$/.test(witness.runtime?.nodeVersion ?? ""), "run witness must record an exact Node 24 runtime");
  requireCondition(Number.isInteger(witness.lotSize) && witness.lotSize === 100, "HK.09926 lot size must be exactly 100");

  const files = makeSourceReader(sourceFileBytes);
  const freezeConfigBytes = files(FREEZE_CONFIG_PATH);
  const pipelineConfigBytes = files(PIPELINE_CONFIG_PATH);
  const sampleSplitConfigBytes = files(SAMPLE_SPLIT_CONFIG_PATH);
  const freezeConfig = parseJson(freezeConfigBytes, FREEZE_CONFIG_PATH);
  const pipelineConfig = parseJson(pipelineConfigBytes, PIPELINE_CONFIG_PATH);
  const sampleSplitConfig = parseJson(sampleSplitConfigBytes, SAMPLE_SPLIT_CONFIG_PATH);
  const primaryConfigPath = pipelineConfig.smokeConfigPath;
  const primaryConfigBytes = files(primaryConfigPath);
  const primaryConfig = parseJson(primaryConfigBytes, primaryConfigPath);
  const approvedInputPath = freezeConfig.sourcePath;
  const approvedInputBytes = files(approvedInputPath);
  const approvedInput = parseJson(approvedInputBytes, approvedInputPath);
  const expectedBuildPaths = expectedRealDataQuantBuildInputPaths(
    approvedInputPath,
    primaryConfigPath,
    witness.formalAccounting
  );
  validateBuildInputs(witness.buildInputs, expectedBuildPaths, files);
  requireCondition(String(files(".nvmrc")).trim() === "24", "source commit does not pin Node 24");
  requireCondition(witness.approvedInput?.path === approvedInputPath
    && witness.approvedInput?.sha256 === sha256(approvedInputBytes),
  "approved input witness identity is invalid");

  validateSourceAuthority(approvedInput, freezeConfig, witness.lotSize);
  requireCondition(pipelineConfig.freezeConfigPath === FREEZE_CONFIG_PATH
    && sampleSplitConfig.freezeConfigPath === FREEZE_CONFIG_PATH,
  "pipeline or sample-split config is not bound to the governed freeze config");
  const expectedSnapshot = deriveExpectedFrozenSnapshot({ approvedInput, approvedInputBytes, freezeConfig });
  validateFrozenEvidence(witness.frozen, expectedSnapshot);
  validateSupportingEvidence({ historicalSource, snapshot, expectedSnapshot, sourceCommitSha, freezeConfig });
  const formalAccounting = validateFormalAccountingBinding({
    binding: witness.formalAccounting,
    signalSnapshot: expectedSnapshot,
    signalSourcePath: approvedInputPath,
    signalSourceSha256: sha256(approvedInputBytes),
    sourceFileBytes: files
  });

  const primaryExpected = recomputeFormalAccountingRun({
    signalBars: expectedSnapshot.bars,
    accountingBars: formalAccounting.accountingSnapshot.bars,
    corporateActionLedger: formalAccounting.corporateActionCoverage,
    config: primaryConfig,
    lotSize: witness.lotSize
  });
  validatePrimaryWitness({
    primary: witness.primary,
    expected: primaryExpected,
    sourceCommitSha,
    expectedSnapshot,
    primaryConfig,
    pipelineConfig,
    frozenManifest: witness.frozen.manifest,
    formalAccountingBinding: witness.formalAccounting,
    formalAccounting
  });
  validatePipelineWitness(witness.pipeline, sourceCommitSha, expectedSnapshot, primaryExpected);
  // Primary raw-accounting replay cannot authorize QFQ-derived split or failed-experiment performance.
  requireCondition(false,
    "formal sample-split and failed-experiment accounting replay is not implemented");
  const sampleSplitRunner = selectSampleSplitRunner(files("scripts/quant-sample-split-baseline.mjs"));
  validateSampleSplitWitness({
    witness: witness.sampleSplit,
    config: sampleSplitConfig,
    configBytes: sampleSplitConfigBytes,
    sourceCommitSha,
    expectedSnapshot,
    files,
    sampleSplitRunner
  });
  const failedExperimentCount = validateFailedExperiments({
    entries: witness.failedExperiments,
    summary: witness.summary,
    sourceCommitSha,
    expectedSnapshot,
    lotSize: witness.lotSize,
    files
  });
  validateProbes(witness.probes, sampleSplitConfig, freezeConfig, sampleSplitRunner);
  const concentration = validateSummary({
    summary: witness.summary,
    primary: primaryExpected,
    approvedInput,
    failedExperimentCount,
    formalAccountingBinding: witness.formalAccounting,
    formalAccounting
  });

  const sampleMetrics = witness.sampleSplit.manifest.metrics;
  const totalCosts = Object.values(sampleMetrics)
    .reduce((sum, metrics) => sum + Math.round(Number(metrics.totalFees) * 100), 0) / 100;
  return {
    buildInputHash: sha256(canonicalJsonBytes(witness.buildInputs)),
    snapshotId: expectedSnapshot.snapshotId,
    dataHash: expectedSnapshot.dataHash,
    snapshotHash: expectedSnapshot.snapshotHash,
    accountingSnapshotId: formalAccounting.accountingSnapshot.snapshotId,
    accountingDataHash: formalAccounting.accountingSnapshot.dataHash,
    corporateActionLedgerId: formalAccounting.corporateActionCoverage.ledgerId,
    corporateActionLedgerHash: formalAccounting.corporateActionCoverage.ledgerHash,
    formalAccounting,
    totalCosts,
    failedExperimentCount,
    concentration
  };
}

export function recomputePrimaryRun(rawBars, config, lotSize) {
  const bars = rawBars.map((bar) => ({
    ...bar,
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volume),
    turnover: Number(bar.turnover)
  })).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const signals = [];
  for (let index = 1; index < bars.length; index += 1) {
    const previous = bars[index - 1];
    const current = bars[index];
    const closeReturn = (current.close - previous.close) / previous.close;
    let action = "hold";
    if (closeReturn <= config.signal.buyWhenPreviousCloseReturnLte) action = "buy";
    if (closeReturn >= config.signal.sellWhenPreviousCloseReturnGte) action = "sell";
    signals.push({
      signalDate: current.tradeDate,
      generatedAfter: "close",
      market: current.market,
      code: current.code,
      close: roundPrimary(current.close),
      previousClose: roundPrimary(previous.close),
      closeReturn: roundPrimary(closeReturn, 6),
      action,
      earliestExecutionDate: bars[index + 1]?.tradeDate ?? null,
      rule: config.signal.name
    });
  }

  let cash = Number(config.initialCash);
  let shares = 0;
  let previousEquity = Number(config.initialCash);
  const orders = [];
  const trades = [];
  const ledger = [];
  const nav = [];
  const signalByDate = new Map(signals.map((signal) => [signal.signalDate, signal]));
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const previousBar = bars[index - 1] ?? null;
    const signal = previousBar ? signalByDate.get(previousBar.tradeDate) : null;
    const startingCash = cash;
    const startingShares = shares;
    if (signal && signal.earliestExecutionDate === bar.tradeDate && !executionBlockedReason(bar)) {
      if (signal.action === "buy" && shares === 0) {
        const targetValue = previousEquity * config.targetGrossExposure;
        let quantity = Math.floor(Math.floor(targetValue / bar.open) / lotSize) * lotSize;
        let estimated = estimatePrimaryCost(quantity, bar.open, "buy", bar.tradeDate, config.fees);
        while (quantity > 0 && estimated.totalCashRequired > cash) {
          quantity -= lotSize;
          estimated = estimatePrimaryCost(quantity, bar.open, "buy", bar.tradeDate, config.fees);
        }
        const order = makePrimaryOrder(signal, bar, "buy", quantity, lotSize, estimated.totalFees);
        orders.push(order);
        if (quantity > 0) {
          cash = roundPrimary(cash - estimated.totalCashRequired);
          shares += quantity;
          trades.push(makePrimaryTrade(order, bar, startingCash, cash, shares, estimated));
        }
      }
      if (signal.action === "sell" && shares > 0) {
        const quantity = shares;
        const estimated = estimatePrimaryCost(quantity, bar.open, "sell", bar.tradeDate, config.fees);
        const order = makePrimaryOrder(signal, bar, "sell", quantity, lotSize, estimated.totalFees);
        orders.push(order);
        cash = roundPrimary(cash + estimated.netProceeds);
        shares = 0;
        trades.push(makePrimaryTrade(order, bar, startingCash, cash, shares, estimated));
      }
    }
    const marketValue = roundPrimary(shares * bar.close);
    const equity = roundPrimary(cash + marketValue);
    const tradedValue = trades.filter((trade) => trade.tradeDate === bar.tradeDate)
      .reduce((sum, trade) => sum + trade.grossAmount, 0);
    const turnoverTwoWay = previousEquity > 0 ? tradedValue / previousEquity : 0;
    const row = {
      tradeDate: bar.tradeDate,
      close: roundPrimary(bar.close),
      cash,
      shares,
      marketValue,
      equity,
      dailyReturn: previousEquity > 0 ? roundPrimary((equity - previousEquity) / previousEquity, 8) : 0,
      turnoverOneWay: roundPrimary(turnoverTwoWay / 2, 8),
      turnoverTwoWay: roundPrimary(turnoverTwoWay, 8)
    };
    ledger.push({ ...row, startingCash, startingShares, endingCash: cash, endingShares: shares });
    nav.push(row);
    previousEquity = equity;
  }
  return { signals, orders, trades, ledger, nav, metrics: primaryMetrics(nav, trades, Number(config.initialCash)) };
}

export function recomputeFormalAccountingRun({
  signalBars,
  accountingBars,
  corporateActionLedger,
  config,
  lotSize,
  signalSource = "pingan_imported_history_with_futu_qfq"
}) {
  requireCondition(Array.isArray(signalBars) && Array.isArray(accountingBars)
    && signalBars.length > 0 && signalBars.length === accountingBars.length,
  "formal replay requires complete signal and accounting bars");
  const normalizedSignalBars = normalizePrimaryBars(signalBars);
  const normalizedAccountingBars = normalizePrimaryBars(accountingBars);
  const expectedCode = normalizedSignalBars[0]?.code;
  const signalIdentities = normalizedSignalBars.map(barIdentity);
  const accountingIdentities = normalizedAccountingBars.map(barIdentity);
  requireCondition(isDeepStrictEqual(signalIdentities, accountingIdentities)
    && new Set(signalIdentities).size === signalIdentities.length
    && /^\d{5}$/.test(expectedCode ?? "")
    && normalizedSignalBars.every((bar) => validFullBar(bar, expectedCode, signalSource))
    && normalizedAccountingBars.every((bar) => validUnadjustedBar(bar, expectedCode)),
  "formal replay bars are not exact aligned QFQ and unadjusted inputs");
  requireCondition(corporateActionLedger?.coverage?.complete === true
    && isDeepStrictEqual(
      corporateActionLedger.coverage.coveredTradingDates,
      normalizedAccountingBars.map(({ tradeDate }) => tradeDate)
    )
    && corporateActionLedger.coverage.eventCount === corporateActionLedger.events?.length,
  "formal replay corporate-action coverage is incomplete");

  const signals = generatePrimarySignals(normalizedSignalBars, config);
  // Unsupported corporate actions must fail before any ledger mutation.
  const unsupportedAction = corporateActionLedger.events.find(
    (event) => !/^(?:cash_dividend|stock_split|bonus_issue)$/.test(event.actionType ?? "")
  );
  requireCondition(!unsupportedAction,
    `corporate action needs accounting review before formal replay: ${unsupportedAction?.actionType ?? "missing"}`);
  const eventsByDate = new Map();
  const eventIds = new Set();
  for (const event of corporateActionLedger.events) {
    requireCondition(!eventIds.has(event.eventId), "formal replay contains a duplicate corporate-action event");
    eventIds.add(event.eventId);
    if (event.actionType === "cash_dividend") {
      requireCondition(Number.isFinite(event.cashAmount) && event.cashAmount >= 0
        && event.currency === "HKD" && witnessIsCalendarDate(event.paymentDate)
        && event.paymentDate >= event.exDate && validDividendPaymentEvidence(event.paymentEvidence, event.exDate),
      "cash dividend requires a sourced payment date on or after the ex-date");
    }
    const entries = eventsByDate.get(event.exDate) ?? [];
    entries.push(event);
    eventsByDate.set(event.exDate, entries);
  }

  let cash = Number(config.initialCash);
  let shares = 0;
  let dividendReceivable = 0;
  let pendingDividends = [];
  let previousEquity = Number(config.initialCash);
  const orders = [];
  const trades = [];
  const ledger = [];
  const nav = [];
  const signalByDate = new Map(signals.map((signal) => [signal.signalDate, signal]));
  for (let index = 0; index < normalizedAccountingBars.length; index += 1) {
    const bar = normalizedAccountingBars[index];
    const previousBar = normalizedAccountingBars[index - 1] ?? null;
    const signal = previousBar ? signalByDate.get(previousBar.tradeDate) : null;
    const startingCash = cash;
    const startingShares = shares;
    const startingReceivable = dividendReceivable;
    const dividendSettlements = [];
    const stillPending = [];
    for (const pending of pendingDividends) {
      if (pending.paymentDate < bar.tradeDate) {
        cash = roundPrimary(cash + pending.amount);
        dividendReceivable = roundPrimary(dividendReceivable - pending.amount);
        dividendSettlements.push({ eventId: pending.eventId, paymentDate: pending.paymentDate,
          settledOn: bar.tradeDate, cashChange: pending.amount, receivableChange: -pending.amount });
      } else stillPending.push(pending);
    }
    pendingDividends = stillPending;
    const appliedActions = [];
    for (const event of eventsByDate.get(bar.tradeDate) ?? []) {
      const beforeCash = cash;
      const beforeShares = shares;
      const beforeReceivable = dividendReceivable;
      if (event.actionType === "cash_dividend") {
        const amount = roundPrimary(shares * event.cashAmount);
        dividendReceivable = roundPrimary(dividendReceivable + amount);
        pendingDividends.push({ eventId: event.eventId, paymentDate: event.paymentDate, amount });
      } else {
        const adjustedShares = shares * event.splitNumerator / event.splitDenominator;
        requireCondition(Number.isSafeInteger(adjustedShares) && adjustedShares >= 0,
          "corporate action creates an unsupported fractional position");
        shares = adjustedShares;
      }
      appliedActions.push({
        eventId: event.eventId,
        actionType: event.actionType,
        cashChange: roundPrimary(cash - beforeCash),
        shareChange: shares - beforeShares,
        receivableChange: roundPrimary(dividendReceivable - beforeReceivable),
        entitledShares: event.actionType === "cash_dividend" ? beforeShares : null,
        paymentDate: event.actionType === "cash_dividend" ? event.paymentDate : null
      });
    }
    const postCorporateActionCash = cash;
    const postCorporateActionShares = shares;
    const postCorporateActionReceivable = dividendReceivable;
    if (signal && signal.earliestExecutionDate === bar.tradeDate && !executionBlockedReason(bar)) {
      if (signal.action === "buy" && shares === 0) {
        const targetValue = previousEquity * config.targetGrossExposure;
        let quantity = Math.floor(Math.floor(targetValue / bar.open) / lotSize) * lotSize;
        let estimated = estimatePrimaryCost(quantity, bar.open, "buy", bar.tradeDate, config.fees);
        while (quantity > 0 && estimated.totalCashRequired > cash) {
          quantity -= lotSize;
          estimated = estimatePrimaryCost(quantity, bar.open, "buy", bar.tradeDate, config.fees);
        }
        const order = makePrimaryOrder(signal, bar, "buy", quantity, lotSize, estimated.totalFees);
        orders.push(order);
        if (quantity > 0) {
          const cashBefore = cash;
          cash = roundPrimary(cash - estimated.totalCashRequired);
          shares += quantity;
          trades.push(makePrimaryTrade(order, bar, cashBefore, cash, shares, estimated));
        }
      }
      if (signal.action === "sell" && shares > 0) {
        const quantity = shares;
        const estimated = estimatePrimaryCost(quantity, bar.open, "sell", bar.tradeDate, config.fees);
        const order = makePrimaryOrder(signal, bar, "sell", quantity, lotSize, estimated.totalFees);
        orders.push(order);
        const cashBefore = cash;
        cash = roundPrimary(cash + estimated.netProceeds);
        shares = 0;
        trades.push(makePrimaryTrade(order, bar, cashBefore, cash, shares, estimated));
      }
    }
    const marketValue = roundPrimary(shares * bar.close);
    const equity = roundPrimary(cash + marketValue + dividendReceivable);
    const tradedValue = trades.filter((trade) => trade.tradeDate === bar.tradeDate)
      .reduce((sum, trade) => sum + trade.grossAmount, 0);
    const turnoverTwoWay = previousEquity > 0 ? tradedValue / previousEquity : 0;
    const row = {
      tradeDate: bar.tradeDate,
      close: roundPrimary(bar.close),
      cash,
      shares,
      dividendReceivable,
      marketValue,
      equity,
      dailyReturn: previousEquity > 0 ? roundPrimary((equity - previousEquity) / previousEquity, 8) : 0,
      turnoverOneWay: roundPrimary(turnoverTwoWay / 2, 8),
      turnoverTwoWay: roundPrimary(turnoverTwoWay, 8)
    };
    ledger.push({
      ...row,
      startingCash,
      startingShares,
      startingReceivable,
      corporateActions: appliedActions,
      dividendSettlements,
      postCorporateActionCash,
      postCorporateActionShares,
      postCorporateActionReceivable,
      endingCash: cash,
      endingShares: shares,
      endingReceivable: dividendReceivable
    });
    nav.push(row);
    previousEquity = equity;
  }
  const metrics = primaryMetrics(nav, trades, Number(config.initialCash));
  const accountingAudit = buildFormalAccountingAudit({
    signalBars: normalizedSignalBars,
    accountingBars: normalizedAccountingBars,
    corporateActionLedger,
    config,
    lotSize,
    signals,
    orders,
    trades,
    ledger,
    nav,
    expectedCode,
    signalSource
  });
  requireCondition(accountingAudit.ok, "independently replayed formal accounting audit failed");
  return { signals, orders, trades, ledger, nav, metrics, accountingAudit };
}

export function formalRunBinding(formalAccountingBinding) {
  const binding = formalAccountingBinding;
  return {
    schemaVersion: REAL_DATA_FORMAL_RUN_BINDING_SCHEMA,
    signalSnapshot: structuredClone(binding.signalSnapshot),
    accountingSnapshot: {
      path: binding.accountingSnapshot.path,
      sha256: binding.accountingSnapshot.sha256,
      snapshotId: binding.accountingSnapshot.snapshotId,
      dataHash: binding.accountingSnapshot.dataHash,
      adjustmentMode: binding.accountingSnapshot.adjustmentMode
    },
    corporateActionCoverage: {
      path: binding.corporateActionCoverage.path,
      sha256: binding.corporateActionCoverage.sha256,
      ledgerId: binding.corporateActionCoverage.ledgerId,
      ledgerHash: binding.corporateActionCoverage.ledgerHash
    },
    priceBasis: structuredClone(binding.priceBasis)
  };
}

function normalizePrimaryBars(rawBars) {
  return rawBars.map((bar) => ({
    ...bar,
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volume),
    turnover: Number(bar.turnover)
  })).sort((a, b) => barIdentity(a).localeCompare(barIdentity(b)));
}

function generatePrimarySignals(bars, config) {
  const signals = [];
  for (let index = 1; index < bars.length; index += 1) {
    const previous = bars[index - 1];
    const current = bars[index];
    const closeReturn = (current.close - previous.close) / previous.close;
    let action = "hold";
    if (closeReturn <= config.signal.buyWhenPreviousCloseReturnLte) action = "buy";
    if (closeReturn >= config.signal.sellWhenPreviousCloseReturnGte) action = "sell";
    signals.push({
      signalDate: current.tradeDate,
      generatedAfter: "close",
      market: current.market,
      code: current.code,
      close: roundPrimary(current.close),
      previousClose: roundPrimary(previous.close),
      closeReturn: roundPrimary(closeReturn, 6),
      action,
      earliestExecutionDate: bars[index + 1]?.tradeDate ?? null,
      rule: config.signal.name
    });
  }
  return signals;
}

function buildFormalAccountingAudit({
  signalBars,
  accountingBars,
  corporateActionLedger,
  config,
  lotSize,
  signals,
  orders,
  trades,
  ledger,
  nav,
  expectedCode,
  signalSource
}) {
  const accountingByDate = new Map(accountingBars.map((bar) => [bar.tradeDate, bar]));
  const signalsByDate = new Map(signals.map((signal) => [signal.signalDate, signal]));
  const expectedActionIds = corporateActionLedger.events.map(({ eventId }) => eventId).sort();
  const appliedActionIds = ledger.flatMap((row) => row.corporateActions.map(({ eventId }) => eventId)).sort();
  const dates = accountingBars.map(({ tradeDate }) => tradeDate);
  const entitlements = new Map(ledger.flatMap((row) => row.corporateActions
    .filter((action) => action.actionType === "cash_dividend")
    .map((action) => [action.eventId, action.receivableChange])));
  const expectedSettlements = corporateActionLedger.events
    .filter((event) => event.actionType === "cash_dividend")
    .map((event) => ({ eventId: event.eventId, paymentDate: event.paymentDate,
      settledOn: dates.find((date) => date > event.paymentDate) ?? null,
      cashChange: entitlements.get(event.eventId) }))
    .filter((settlement) => settlement.settledOn !== null)
    .sort((left, right) => left.eventId.localeCompare(right.eventId));
  const actualSettlements = ledger.flatMap((row) => row.dividendSettlements)
    .map(({ eventId, paymentDate, settledOn, cashChange }) => ({ eventId, paymentDate, settledOn, cashChange }))
    .sort((left, right) => left.eventId.localeCompare(right.eventId));
  const checks = {
    signalBarsAreExactQfq: signalBars.every((bar) => validFullBar(bar, expectedCode, signalSource)),
    executionAndValuationBarsAreExactUnadjusted: accountingBars.every((bar) => validUnadjustedBar(bar, expectedCode)),
    barIdentitiesAligned: isDeepStrictEqual(signalBars.map(barIdentity), accountingBars.map(barIdentity)),
    corporateActionCoverageComplete: corporateActionLedger.coverage.complete === true
      && isDeepStrictEqual(
        corporateActionLedger.coverage.coveredTradingDates,
        accountingBars.map(({ tradeDate }) => tradeDate)
      ),
    corporateActionsAppliedExactlyOnce: isDeepStrictEqual(expectedActionIds, appliedActionIds),
    dividendSettlementsExactlyOnceAfterPayment: isDeepStrictEqual(expectedSettlements, actualSettlements)
      && new Set(actualSettlements.map(({ eventId }) => eventId)).size === actualSettlements.length,
    dividendReceivableRollForward: ledger.every((row, index) => {
      const actionDelta = row.corporateActions.reduce((sum, action) => sum + action.receivableChange, 0);
      const settlementDelta = row.dividendSettlements.reduce((sum, settlement) => sum + settlement.receivableChange, 0);
      return row.startingReceivable === (index === 0 ? 0 : ledger[index - 1].endingReceivable)
        && row.postCorporateActionReceivable === roundPrimary(row.startingReceivable + actionDelta + settlementDelta)
        && row.endingReceivable === row.postCorporateActionReceivable
        && row.dividendReceivable === row.endingReceivable;
    }),
    cashRollForwardUsesOnlySettlementsAndTrades: ledger.every((row) => {
      const actionCash = row.corporateActions.reduce((sum, action) => sum + action.cashChange, 0);
      const settlementCash = row.dividendSettlements.reduce((sum, settlement) => sum + settlement.cashChange, 0);
      const tradeCash = trades.filter((trade) => trade.tradeDate === row.tradeDate)
        .reduce((sum, trade) => sum + trade.netCashChange, 0);
      return row.postCorporateActionCash === roundPrimary(row.startingCash + actionCash + settlementCash)
        && row.endingCash === roundPrimary(row.postCorporateActionCash + tradeCash);
    }),
    signalsUseQfqCloses: signals.every((signal) => {
      const index = signalBars.findIndex((bar) => bar.tradeDate === signal.signalDate);
      const current = signalBars[index];
      const previous = signalBars[index - 1];
      return index > 0
        && signal.close === roundPrimary(current.close)
        && signal.previousClose === roundPrimary(previous.close);
    }),
    allOrdersNextDayOrLater: orders.every((order) => order.signalDate < order.tradeDate),
    allTradesNextDayOrLater: trades.every((trade) => trade.signalDate < trade.tradeDate),
    noSameBarExecutions: trades.every((trade) => trade.sameBarExecution === false),
    ordersMatchSignalExecutionDate: orders.every((order) =>
      signalsByDate.get(order.signalDate)?.earliestExecutionDate === order.tradeDate),
    boardLotRounded: orders.every((order) => order.boardLot === lotSize
      && order.roundedToBoardLot === true
      && Number.isSafeInteger(order.quantity)
      && order.quantity >= 0
      && order.quantity % lotSize === 0),
    orderTradeBindingsReconcile: orders.every((order) => {
      const matches = trades.filter((trade) => trade.orderId === order.orderId);
      return order.quantity > 0 ? matches.length === 1 : matches.length === 0;
    }) && trades.every((trade) => orders.filter((order) => order.orderId === trade.orderId).length === 1),
    feesUseUnadjustedGross: trades.every((trade) => {
      const bar = accountingByDate.get(trade.tradeDate);
      if (!bar || trade.price !== roundPrimary(bar.open)
        || trade.grossAmount !== roundPrimary(trade.quantity * bar.open)) return false;
      const expected = estimatePrimaryCost(trade.quantity, bar.open, trade.side, bar.tradeDate, config.fees);
      return isDeepStrictEqual(trade.fees, expected.fees)
        && trade.totalFees === expected.totalFees;
    }),
    cashNeverNegative: ledger.every((row) => Number.isFinite(row.endingCash) && row.endingCash >= 0),
    dividendReceivableNeverNegative: ledger.every((row) => Number.isFinite(row.endingReceivable)
      && row.endingReceivable >= 0),
    buysSpendCashOnly: trades.filter((trade) => trade.side === "buy")
      .every((trade) => trade.cashBefore >= -trade.netCashChange && trade.cashAfter >= 0),
    positionNeverNegative: ledger.every((row) => Number.isSafeInteger(row.endingShares) && row.endingShares >= 0),
    navDatesMatchAccountingBars: isDeepStrictEqual(
      nav.map(({ tradeDate }) => tradeDate),
      accountingBars.map(({ tradeDate }) => tradeDate)
    ),
    navUsesUnadjustedCloses: nav.every((row) => {
      const bar = accountingByDate.get(row.tradeDate);
      return bar && row.close === roundPrimary(bar.close)
        && row.marketValue === roundPrimary(row.shares * bar.close)
        && row.equity === roundPrimary(row.cash + row.marketValue + row.dividendReceivable);
    }),
    ledgerAndNavReconcile: ledger.length === nav.length && ledger.every((row, index) =>
      isDeepStrictEqual(nav[index], {
        tradeDate: row.tradeDate,
        close: row.close,
        cash: row.cash,
        shares: row.shares,
        dividendReceivable: row.dividendReceivable,
        marketValue: row.marketValue,
        equity: row.equity,
        dailyReturn: row.dailyReturn,
        turnoverOneWay: row.turnoverOneWay,
        turnoverTwoWay: row.turnoverTwoWay
      }) && row.endingCash === row.cash && row.endingShares === row.shares
        && row.endingReceivable === row.dividendReceivable),
    noImplicitLeverage: nav.every((row) => row.equity > 0
      && row.cash >= 0
      && Math.abs(row.marketValue) <= row.equity)
  };
  return {
    schemaVersion: REAL_DATA_FORMAL_ACCOUNTING_AUDIT_SCHEMA,
    ok: Object.values(checks).every(Boolean),
    priceBasis: structuredClone(FORMAL_PRICE_BASIS),
    signalBarCount: signalBars.length,
    accountingBarCount: accountingBars.length,
    corporateActionEventCount: corporateActionLedger.events.length,
    checks
  };
}

export function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(sortJson(value), null, 2)}\n`);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function blockedFormalAccountingBinding({
  approvedInputPath,
  approvedInputSha256,
  frozenSnapshot
}) {
  return {
    schemaVersion: REAL_DATA_FORMAL_ACCOUNTING_SCHEMA,
    status: "blocked",
    signalSnapshot: {
      path: approvedInputPath,
      sha256: approvedInputSha256,
      snapshotId: frozenSnapshot?.snapshotId ?? null,
      dataHash: frozenSnapshot?.dataHash ?? null,
      adjustmentMode: frozenSnapshot?.adjustment ?? null
    },
    accountingSnapshot: null,
    corporateActionCoverage: null,
    priceBasis: {
      signal: "adjusted_qfq_close",
      execution: "unbound",
      valuation: "unbound",
      feeNotional: "unbound"
    },
    blockers: [...FORMAL_ACCOUNTING_BLOCKERS]
  };
}

export function validateFormalAccountingBinding({
  binding,
  signalSnapshot,
  signalSourcePath,
  signalSourceSha256,
  sourceFileBytes
}) {
  strictKeys(binding, [
    "accountingSnapshot", "blockers", "corporateActionCoverage", "priceBasis",
    "schemaVersion", "signalSnapshot", "status"
  ], "formal accounting binding");
  requireCondition(binding.schemaVersion === REAL_DATA_FORMAL_ACCOUNTING_SCHEMA,
    "formal accounting binding schema is invalid");
  requireCondition(binding.status === "verified",
    `formal accounting evidence is blocked: ${formalAccountingBlockerText(binding)}`);
  strictKeys(binding.signalSnapshot, ["adjustmentMode", "dataHash", "path", "sha256", "snapshotId"],
    "formal accounting signal snapshot");
  strictKeys(binding.accountingSnapshot, [
    "adjustmentMode", "authorizationId", "dataCutoff", "dataHash", "dateRange", "path",
    "sha256", "snapshotId", "universeVersion"
  ], "formal accounting price snapshot");
  strictKeys(binding.corporateActionCoverage, [
    "authorizationId", "coverage", "dataCutoff", "ledgerHash", "ledgerId", "path",
    "sha256", "universeVersion"
  ], "formal accounting corporate-action coverage");
  strictKeys(binding.corporateActionCoverage.coverage, [
    "complete", "coveredTradingDates", "dateRange", "eventCount", "universe",
    "zeroEventCoverageDeclared"
  ], "formal accounting corporate-action coverage window");
  strictKeys(binding.priceBasis, ["execution", "feeNotional", "signal", "valuation"],
    "formal accounting price basis");
  requireCondition(Array.isArray(binding.blockers) && binding.blockers.length === 0,
    "verified formal accounting binding cannot contain blockers");
  requireCondition(isDeepStrictEqual(binding.priceBasis, FORMAL_PRICE_BASIS),
    "formal accounting price basis must separate signal, execution, valuation, and fee notional");
  requireCondition(binding.signalSnapshot.path === signalSourcePath
    && binding.signalSnapshot.sha256 === signalSourceSha256
    && binding.signalSnapshot.snapshotId === signalSnapshot?.snapshotId
    && binding.signalSnapshot.dataHash === signalSnapshot?.dataHash
    && binding.signalSnapshot.adjustmentMode === "forward"
    && signalSnapshot?.adjustment === "forward",
  "formal accounting signal snapshot identity is invalid");

  const accountingPath = approvedFormalDataPath(binding.accountingSnapshot.path, "accounting snapshot");
  const corporateActionPath = approvedFormalDataPath(
    binding.corporateActionCoverage.path,
    "corporate-action ledger"
  );
  requireCondition(accountingPath !== signalSourcePath
    && corporateActionPath !== signalSourcePath
    && corporateActionPath !== accountingPath,
  "formal accounting source paths must be independent");
  requireCondition(/(?:raw|unadjusted|au[-_]?none)/i.test(accountingPath)
    && /corporate[-_]?actions?/i.test(corporateActionPath),
  "formal accounting paths do not identify raw prices and corporate actions");

  const files = makeSourceReader(sourceFileBytes);
  const accountingBytes = files(accountingPath);
  const corporateActionBytes = files(corporateActionPath);
  requireCondition(binding.accountingSnapshot.sha256 === sha256(accountingBytes)
    && binding.corporateActionCoverage.sha256 === sha256(corporateActionBytes)
    && binding.accountingSnapshot.sha256 !== signalSourceSha256
    && binding.corporateActionCoverage.sha256 !== signalSourceSha256
    && binding.corporateActionCoverage.sha256 !== binding.accountingSnapshot.sha256,
  "formal accounting source byte identities are invalid or not independent");
  const accountingSnapshot = parseJson(accountingBytes, accountingPath);
  const corporateActionLedger = parseJson(corporateActionBytes, corporateActionPath);
  requireCondition(canonicalJsonBytes(accountingSnapshot).equals(accountingBytes),
    "formal accounting snapshot must use canonical JSON bytes");
  requireCondition(canonicalJsonBytes(corporateActionLedger).equals(corporateActionBytes),
    "corporate-action ledger must use canonical JSON bytes");

  const signalDates = validateAccountingSnapshot({
    binding: binding.accountingSnapshot,
    accountingSnapshot,
    signalSnapshot
  });
  validateCorporateActionLedger({
    binding: binding.corporateActionCoverage,
    corporateActionLedger,
    accountingSnapshot,
    signalSnapshot,
    signalDates
  });
  return {
    schemaVersion: REAL_DATA_FORMAL_ACCOUNTING_SCHEMA,
    status: "verified",
    signalSnapshot: structuredClone(binding.signalSnapshot),
    accountingSnapshot: structuredClone(accountingSnapshot),
    corporateActionCoverage: structuredClone(corporateActionLedger),
    priceBasis: structuredClone(binding.priceBasis),
    blockers: []
  };
}

function validateAccountingSnapshot({ binding, accountingSnapshot, signalSnapshot }) {
  strictKeys(accountingSnapshot, [
    "adjustmentMode", "authority", "authorizationId", "bars", "dataCutoff", "dataHash",
    "dateRange", "fixture", "schemaVersion", "snapshotId", "sourceClass", "sourceKind",
    "universe", "universeVersion"
  ], "formal accounting snapshot file");
  strictKeys(accountingSnapshot.dateRange, ["end", "start"], "formal accounting snapshot date range");
  const expectedUniverseVersion = formalUniverseVersion(signalSnapshot?.universe, signalSnapshot?.dateRange);
  requireCondition(accountingSnapshot.schemaVersion === REAL_DATA_ACCOUNTING_SNAPSHOT_SCHEMA
    && accountingSnapshot.adjustmentMode === "none"
    && binding.adjustmentMode === "none"
    && accountingSnapshot.fixture === false
    && accountingSnapshot.sourceClass === "owner_approved_historical_accounting_only"
    && accountingSnapshot.sourceKind === "futu_request_history_kline_none"
    && accountingSnapshot.authority === "research_only_historical_accounting"
    && nonemptyIdentity(accountingSnapshot.authorizationId)
    && accountingSnapshot.authorizationId === binding.authorizationId
    && accountingSnapshot.universeVersion === expectedUniverseVersion
    && accountingSnapshot.universeVersion === binding.universeVersion
    && accountingSnapshot.dataCutoff === binding.dataCutoff
    && isDeepStrictEqual(accountingSnapshot.universe, signalSnapshot?.universe)
    && isDeepStrictEqual(accountingSnapshot.dateRange, signalSnapshot?.dateRange)
    && isDeepStrictEqual(accountingSnapshot.dateRange, binding.dateRange),
  "formal accounting snapshot authority, adjustment, universe, cutoff, or date range is invalid");
  requireCondition(Number.isFinite(Date.parse(accountingSnapshot.dataCutoff))
    && Date.parse(accountingSnapshot.dataCutoff) >= Date.parse(signalSnapshot?.dataCutoff)
    && Date.parse(accountingSnapshot.dataCutoff) <= Date.now(),
  "formal accounting snapshot cutoff predates the signal snapshot or is invalid");

  const bars = accountingSnapshot.bars;
  requireCondition(Array.isArray(bars) && bars.length > 0, "formal accounting snapshot bars are required");
  for (const bar of bars) {
    strictKeys(bar, [
      "adjustment", "close", "code", "fetchedAt", "high", "low", "market", "open",
      "source", "tradeDate", "turnover", "volume"
    ], "formal accounting price bar");
  }
  const expectedCode = signalSnapshot.universe[0]?.code;
  requireCondition(bars.every((bar) => validUnadjustedBar(bar, expectedCode))
    && bars.every((bar) => Date.parse(bar.fetchedAt) <= Date.parse(accountingSnapshot.dataCutoff)),
  "formal accounting snapshot contains invalid, adjusted, or future bars");
  const accountingKeys = bars.map(barIdentity);
  const signalKeys = signalSnapshot.bars.map(barIdentity);
  requireCondition(isDeepStrictEqual(accountingKeys, signalKeys)
    && new Set(accountingKeys).size === accountingKeys.length,
  "raw and QFQ snapshots must cover the same market, code, and trading dates");
  const signalDates = signalSnapshot.bars.map(({ tradeDate }) => tradeDate);
  const expectedDataHash = sha256(stableJson({
    schemaVersion: REAL_DATA_ACCOUNTING_SNAPSHOT_SCHEMA,
    sourceKind: accountingSnapshot.sourceKind,
    sourceClass: accountingSnapshot.sourceClass,
    authorizationId: accountingSnapshot.authorizationId,
    universeVersion: accountingSnapshot.universeVersion,
    adjustmentMode: accountingSnapshot.adjustmentMode,
    dataCutoff: accountingSnapshot.dataCutoff,
    universe: accountingSnapshot.universe,
    dateRange: accountingSnapshot.dateRange,
    bars
  }));
  const expectedSnapshotId = formalAccountingSnapshotId(
    accountingSnapshot.universe,
    accountingSnapshot.dateRange,
    expectedDataHash
  );
  requireCondition(accountingSnapshot.dataHash === expectedDataHash
    && binding.dataHash === expectedDataHash
    && accountingSnapshot.snapshotId === expectedSnapshotId
    && binding.snapshotId === expectedSnapshotId
    && accountingSnapshot.dataHash !== signalSnapshot.dataHash
    && accountingSnapshot.snapshotId !== signalSnapshot.snapshotId,
  "formal accounting snapshot data hash or snapshot identity is invalid");
  return signalDates;
}

function validateCorporateActionLedger({
  binding,
  corporateActionLedger,
  accountingSnapshot,
  signalSnapshot,
  signalDates
}) {
  strictKeys(corporateActionLedger, [
    "authority", "authorizationId", "coverage", "dataCutoff", "events", "fixture",
    "ledgerHash", "ledgerId", "schemaVersion", "sourceClass", "sourceKind", "universe",
    "universeVersion"
  ], "corporate-action ledger file");
  strictKeys(corporateActionLedger.coverage, [
    "complete", "coveredTradingDates", "dateRange", "eventCount", "universe",
    "zeroEventCoverageDeclared"
  ], "corporate-action ledger coverage");
  strictKeys(corporateActionLedger.coverage.dateRange, ["end", "start"],
    "corporate-action ledger date range");
  const coverage = corporateActionLedger.coverage;
  const hasCashDividend = Array.isArray(corporateActionLedger.events)
    && corporateActionLedger.events.some((event) => event.actionType === "cash_dividend");
  requireCondition((corporateActionLedger.schemaVersion === DIVIDEND_PAYMENT_LEDGER_SCHEMA
      || !hasCashDividend && corporateActionLedger.schemaVersion === REAL_DATA_CORPORATE_ACTION_LEDGER_SCHEMA)
    && corporateActionLedger.fixture === false
    && corporateActionLedger.sourceClass === "owner_approved_historical_corporate_actions_only"
    && corporateActionLedger.sourceKind === "owner_approved_corporate_action_ledger"
    && corporateActionLedger.authority === "research_only_historical_accounting"
    && nonemptyIdentity(corporateActionLedger.authorizationId)
    && corporateActionLedger.authorizationId === binding.authorizationId
    && corporateActionLedger.universeVersion === accountingSnapshot.universeVersion
    && corporateActionLedger.universeVersion === binding.universeVersion
    && corporateActionLedger.dataCutoff === binding.dataCutoff
    && isDeepStrictEqual(corporateActionLedger.universe, signalSnapshot.universe)
    && coverage.complete === true
    && isDeepStrictEqual(coverage.universe, signalSnapshot.universe)
    && isDeepStrictEqual(coverage.dateRange, signalSnapshot.dateRange)
    && isDeepStrictEqual(coverage, binding.coverage)
    && isDeepStrictEqual(coverage.coveredTradingDates, signalDates),
  "corporate-action ledger authority, universe, cutoff, or complete coverage is invalid");
  requireCondition(Number.isFinite(Date.parse(corporateActionLedger.dataCutoff))
    && Date.parse(corporateActionLedger.dataCutoff) >= Date.parse(signalSnapshot.dataCutoff)
    && Date.parse(corporateActionLedger.dataCutoff) <= Date.now(),
  "corporate-action ledger cutoff predates the signal snapshot or is invalid");
  requireCondition(Array.isArray(corporateActionLedger.events)
    && Number.isSafeInteger(coverage.eventCount)
    && coverage.eventCount >= 0
    && coverage.eventCount === corporateActionLedger.events.length
    && coverage.zeroEventCoverageDeclared === (coverage.eventCount === 0),
  "corporate-action event count or zero-event coverage declaration is invalid");
  validateCorporateActionEvents(corporateActionLedger.events, signalSnapshot, coverage);
  const expectedLedgerHash = sha256(stableJson({
    schemaVersion: corporateActionLedger.schemaVersion,
    sourceKind: corporateActionLedger.sourceKind,
    sourceClass: corporateActionLedger.sourceClass,
    authorizationId: corporateActionLedger.authorizationId,
    universeVersion: corporateActionLedger.universeVersion,
    dataCutoff: corporateActionLedger.dataCutoff,
    universe: corporateActionLedger.universe,
    coverage,
    events: corporateActionLedger.events,
    authority: corporateActionLedger.authority
  }));
  const expectedLedgerId = corporateActionLedgerId(
    corporateActionLedger.universe,
    coverage.dateRange,
    expectedLedgerHash
  );
  requireCondition(corporateActionLedger.ledgerHash === expectedLedgerHash
    && binding.ledgerHash === expectedLedgerHash
    && corporateActionLedger.ledgerId === expectedLedgerId
    && binding.ledgerId === expectedLedgerId,
  "corporate-action ledger hash or identity is invalid");
}

function validateCorporateActionEvents(events, signalSnapshot, coverage) {
  const identities = new Set();
  const allowedSecurities = new Set(signalSnapshot.universe.map(({ market, code }) => `${market}.${code}`));
  const coveredTradingDates = new Set(coverage.coveredTradingDates);
  let previousOrderKey = null;
  for (const event of events) {
    strictKeys(event, [
      "actionType", "cashAmount", "code", "currency", "eventId", "exDate", "market",
      "sourceRecordHash", "splitDenominator", "splitNumerator",
      ...(event.actionType === "cash_dividend" ? ["paymentDate", "paymentEvidence"] : [])
    ], "corporate-action event");
    const security = `${event.market}.${event.code}`;
    const identity = `${security}.${event.eventId}`;
    const orderKey = `${event.exDate}.${security}.${event.eventId}`;
    requireCondition(allowedSecurities.has(security)
      && nonemptyIdentity(event.eventId)
      && /^(?:cash_dividend|stock_split|bonus_issue)$/.test(event.actionType ?? "")
      && /^\d{4}-\d{2}-\d{2}$/.test(event.exDate ?? "")
      && event.exDate >= signalSnapshot.dateRange.start
      && event.exDate <= signalSnapshot.dateRange.end
      && coveredTradingDates.has(event.exDate)
      && SHA256_PATTERN.test(event.sourceRecordHash ?? "")
      && !identities.has(identity)
      && (previousOrderKey === null || previousOrderKey < orderKey),
    "corporate-action ledger contains an invalid, duplicate, unsorted, or uncovered event");
    if (event.actionType === "cash_dividend") {
      requireCondition(Number.isFinite(event.cashAmount) && event.cashAmount >= 0
        && event.currency === "HKD"
        && event.splitNumerator === null
        && event.splitDenominator === null
        && witnessIsCalendarDate(event.paymentDate) && event.paymentDate >= event.exDate
        && validDividendPaymentEvidence(event.paymentEvidence, event.exDate)
        && officialDividendPaymentMatches(event),
      "cash-dividend event accounting fields are invalid");
    } else {
      requireCondition(event.cashAmount === null
        && event.currency === null
        && Number.isFinite(event.splitNumerator) && event.splitNumerator > 0
        && Number.isFinite(event.splitDenominator) && event.splitDenominator > 0,
      "share-ratio corporate-action accounting fields are invalid");
    }
    identities.add(identity);
    previousOrderKey = orderKey;
  }
}

function formalAccountingBlockerText(binding) {
  if (!Array.isArray(binding?.blockers) || binding.blockers.length === 0) return "invalid_status";
  return binding.blockers.join(",");
}

function approvedFormalDataPath(path, label) {
  requireCondition(typeof path === "string"
    && path.startsWith("data/quant-approved/")
    && path.endsWith(".json")
    && !path.startsWith("/")
    && !path.includes("\\")
    && !path.split("/").includes("..")
    && !/(?:^|\/)(?:fixtures?|samples?|shadow)(?:\/|$)/i.test(path),
  `${label} path is outside approved formal data`);
  return path;
}

function formalUniverseVersion(universe, dateRange) {
  requireCondition(Array.isArray(universe) && universe.length > 0
    && hasExactKeys(dateRange, ["end", "start"]),
  "formal accounting universe or date range is invalid");
  const symbols = universe.map(({ market, code }) => `${market}.${code}`).join("-").toLowerCase();
  return `hk-${symbols}-${dateRange.start}-${dateRange.end}`;
}

function formalAccountingSnapshotId(universe, dateRange, dataHash) {
  const symbols = universe.map(({ market, code }) => `${market}.${code}`).join("-").toLowerCase();
  return `hk-${symbols}-none-${dateRange.start}-${dateRange.end}-${dataHash.slice(0, 12)}`;
}

function corporateActionLedgerId(universe, dateRange, ledgerHash) {
  const symbols = universe.map(({ market, code }) => `${market}.${code}`).join("-").toLowerCase();
  return `hk-${symbols}-corporate-actions-${dateRange.start}-${dateRange.end}-${ledgerHash.slice(0, 12)}`;
}

function barIdentity(bar) {
  return `${bar.market}.${bar.code}.${bar.tradeDate}`;
}

function nonemptyIdentity(value) {
  return typeof value === "string" && value.trim().length >= 12;
}

function validateBuildInputs(buildInputs, expectedPaths, files) {
  requireCondition(Array.isArray(buildInputs)
    && isDeepStrictEqual(buildInputs.map(({ path }) => path), expectedPaths)
    && buildInputs.every((entry) => hasExactKeys(entry, ["path", "sha256"])
      && SHA256_PATTERN.test(entry.sha256 ?? "")
      && entry.sha256 === sha256(files(entry.path))),
  "build input manifest is incomplete or does not match source-commit bytes");
}

function validateSourceAuthority(approvedInput, freezeConfig, lotSize) {
  const approvedLot = approvedInput?.universe?.[0]?.lotSize;
  const frozenLot = freezeConfig?.universe?.[0]?.lotSize;
  const sourceIdentity = `${freezeConfig.sourceIdentity?.provenance ?? ""} ${freezeConfig.sourceIdentity?.authorizationId ?? ""}`.toLowerCase();
  requireCondition(approvedInput?.schemaVersion === "2026-07-12.pingan-real-history.v1"
    && approvedInput.sourceClass === "owner_approved_historical_only"
    && approvedInput.fixture === false
    && approvedInput.adjustment === "forward"
    && approvedInput.dataCutoff === freezeConfig.dataCutoff
    && approvedInput.authorizationId === freezeConfig.sourceIdentity?.authorizationId
    && freezeConfig.schemaVersion === "2026-06-20.quant-freeze-snapshot.v1"
    && freezeConfig.market === "HK"
    && typeof freezeConfig.sourcePath === "string"
    && freezeConfig.sourcePath.startsWith("data/quant-approved/")
    && !freezeConfig.sourcePath.includes("\\")
    && !freezeConfig.sourcePath.split("/").includes("..")
    && approvedInput.corporateActionPolicy?.researchPrices === "futu_AuType_QFQ"
    && approvedInput.corporateActionPolicy?.accountingAuthority === false
    && approvedInput.corporateActionPolicy?.cashDividendAccounting === false
    && approvedInput.corporateActionPolicy?.positionMutation === false
    && freezeConfig.sourceIdentity?.classification === "approved_real_historical"
    && freezeConfig.sourceIdentity?.authority === "research_only"
    && sourceIdentity.includes("pingan")
    && /histor(?:y|ical)/.test(sourceIdentity)
    && !/(?:live|broker|official|current[_ -]?(?:holdings?|portfolio)|account[_ -]?truth)/.test(sourceIdentity)
    && freezeConfig.adjustment === "forward"
    && Number.isFinite(Date.parse(freezeConfig.dataCutoff))
    && Date.parse(freezeConfig.dataCutoff) <= Date.now()
    && Array.isArray(approvedInput.universe) && approvedInput.universe.length === 1
    && Array.isArray(freezeConfig.universe) && freezeConfig.universe.length === 1
    && approvedInput.universe[0]?.market === "HK"
    && approvedInput.universe[0]?.code === "09926"
    && approvedInput.universe[0]?.symbol === "HK.09926"
    && freezeConfig.universe[0]?.market === approvedInput.universe[0].market
    && freezeConfig.universe[0]?.code === approvedInput.universe[0].code
    && freezeConfig.universe?.[0]?.symbol === "HK.09926"
    && Array.isArray(approvedInput.bars) && approvedInput.bars.length > 0
    && approvedInput.bars.every((bar) => hasExactKeys(bar, [
      "adjustment", "close", "code", "fetchedAt", "high", "low", "market", "open",
      "source", "tradeDate", "turnover", "volume"
    ])
      && bar.market === "HK"
      && bar.code === "09926"
      && bar.adjustment === "forward"
      && bar.source === "futu_request_history_kline_qfq")
    && Number.isSafeInteger(approvedLot) && approvedLot === lotSize
    && Number.isSafeInteger(frozenLot) && frozenLot === lotSize,
  "approved Pingan source, QFQ boundary, or board-lot authority is invalid");
}

function deriveExpectedFrozenSnapshot({ approvedInput, approvedInputBytes, freezeConfig }) {
  const bars = approvedInput.bars.map((bar) => ({
    market: String(bar.market).toUpperCase(),
    code: String(bar.code).padStart(5, "0"),
    tradeDate: String(bar.tradeDate),
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volume),
    turnover: Number(bar.turnover),
    adjustment: freezeConfig.adjustment,
    source: freezeConfig.sourceKind,
    fetchedAt: bar.fetchedAt
  })).filter((bar) => bar.market === freezeConfig.market
    && freezeConfig.universe.some((item) => item.code === bar.code)
    && bar.tradeDate >= freezeConfig.dateRange.start
    && bar.tradeDate <= freezeConfig.dateRange.end)
    .sort((a, b) => `${a.market}.${a.code}.${a.tradeDate}`.localeCompare(`${b.market}.${b.code}.${b.tradeDate}`));
  requireCondition(bars.length > 0 && bars.every((bar) => validFullBar(bar))
    && bars.every((bar) => Date.parse(bar.fetchedAt) <= Date.parse(freezeConfig.dataCutoff))
    && new Set(bars.map((bar) => `${bar.market}.${bar.code}.${bar.tradeDate}`)).size === bars.length,
  "approved source bars are invalid or duplicated");
  const sourceHash = sha256(approvedInputBytes);
  const dateRange = { start: bars[0].tradeDate, end: bars.at(-1).tradeDate };
  requireCondition(isDeepStrictEqual(dateRange, freezeConfig.dateRange),
    "approved source rows do not cover the governed date range");
  const dataHash = sha256(stableJson({
    schemaVersion: "2026-06-20.quant-snapshot.v1",
    sourceKind: freezeConfig.sourceKind,
    sourcePath: freezeConfig.sourcePath,
    sourceHash,
    adjustment: freezeConfig.adjustment,
    dataCutoff: freezeConfig.dataCutoff,
    universe: freezeConfig.universe,
    dateRange,
    bars
  }));
  const universeKey = freezeConfig.universe.map((item) => `${item.market}.${item.code}`).join("-");
  const snapshotId = [
    freezeConfig.market.toLowerCase(),
    universeKey.replace(/[^A-Za-z0-9.-]+/g, "-").toLowerCase(),
    freezeConfig.adjustment,
    dateRange.start,
    dateRange.end,
    dataHash.slice(0, 12)
  ].join("-");
  return { bars, dataHash, dateRange, snapshotId, sourceHash };
}

function validateFrozenEvidence(frozen, expected) {
  const manifest = frozen?.manifest;
  const snapshot = frozen?.snapshot;
  requireCondition(manifest?.schemaVersion === "2026-07-09.quant-freeze-manifest.v2"
    && manifest.snapshotId === expected.snapshotId
    && manifest.dataHash === expected.dataHash
    && manifest.sourceHash === expected.sourceHash
    && manifest.rows === expected.bars.length
    && isDeepStrictEqual(manifest.dateRange, expected.dateRange)
    && manifest.adjustment === "forward"
    && manifest.sourceClassification === "approved_real_historical"
    && snapshot?.snapshotId === expected.snapshotId
    && snapshot.dataHash === expected.dataHash
    && snapshot.sourceHash === expected.sourceHash
    && isDeepStrictEqual(snapshot.bars, expected.bars),
  "frozen manifest or full OHLCV snapshot does not match the approved source");
  const snapshotHash = sha256(stableJson({
    schemaVersion: "2026-07-09.quant-frozen-snapshot-identity.v1",
    snapshotId: snapshot.snapshotId,
    sourceIdentity: snapshot.sourceIdentity,
    sourceClassification: snapshot.sourceClassification,
    source: snapshot.source,
    sourcePath: snapshot.sourcePath,
    sourceHash: snapshot.sourceHash,
    dataHash: snapshot.dataHash,
    adjustment: snapshot.adjustment,
    dataCutoff: snapshot.dataCutoff,
    universe: snapshot.universe,
    dateRange: snapshot.dateRange,
    authority: snapshot.authority,
    limitations: snapshot.limitations,
    safety: snapshot.safety,
    bars: snapshot.bars
  }));
  requireCondition(snapshot.snapshotHash === snapshotHash && manifest.snapshotHash === snapshotHash,
    "frozen snapshot hash is invalid");
  requireCondition(isResearchOnlyAuthority(snapshot.authority)
    && isNoWriteSafety(snapshot.safety)
    && isNoWriteSafety(manifest.safety)
    && snapshot.sourceIdentity?.authority === "research_only"
    && snapshot.sourceIdentity?.classification === "approved_real_historical"
    && snapshot.sourceClassification === "approved_real_historical",
  "frozen snapshot authority or safety boundary is invalid");
  expected.snapshotHash = snapshotHash;
  expected.sourceIdentity = snapshot.sourceIdentity;
  expected.universe = snapshot.universe;
  expected.adjustment = snapshot.adjustment;
  expected.dataCutoff = snapshot.dataCutoff;
}

function validateSupportingEvidence({ historicalSource, snapshot, expectedSnapshot, sourceCommitSha, freezeConfig }) {
  requireCondition(historicalSource?.schemaVersion === "2026-07-15.real-data-historical-source.v1"
    && historicalSource.commitSha === sourceCommitSha
    && historicalSource.dataHash === expectedSnapshot.dataHash
    && historicalSource.adjustmentMode === "forward"
    && historicalSource.authorizationId === freezeConfig.sourceIdentity.authorizationId
    && historicalSource.provenance === freezeConfig.sourceIdentity.provenance
    && historicalSource.dataCutoff === freezeConfig.dataCutoff
    && historicalSource.authority === "research_only_historical_only",
  "historical source evidence is inconsistent with the approved source");
  requireCondition(snapshot?.schemaVersion === "2026-07-15.real-data-snapshot.v2"
    && snapshot.commitSha === sourceCommitSha
    && snapshot.id === expectedSnapshot.snapshotId
    && snapshot.dataHash === expectedSnapshot.dataHash
    && snapshot.snapshotHash === expectedSnapshot.snapshotHash
    && snapshot.sourceHash === expectedSnapshot.sourceHash
    && snapshot.adjustmentMode === "forward"
    && snapshot.lotSize === 100
    && isDeepStrictEqual(snapshot.universe, expectedSnapshot.universe)
    && isDeepStrictEqual(snapshot.bars, expectedSnapshot.bars)
    && snapshot.authority === "research_only_historical_only",
  "supporting snapshot must bind the complete frozen OHLCV identity");
}

function validatePrimaryWitness({
  primary,
  expected,
  sourceCommitSha,
  expectedSnapshot,
  primaryConfig,
  pipelineConfig,
  frozenManifest,
  formalAccountingBinding,
  formalAccounting
}) {
  strictKeys(primary, [
    "accountingAudit", "ledger", "manifest", "nav", "orders", "signals", "trades"
  ], "primary witness");
  requireCondition(isDeepStrictEqual(primary.signals, expected.signals)
    && isDeepStrictEqual(primary.orders, expected.orders)
    && isDeepStrictEqual(primary.trades, expected.trades)
    && isDeepStrictEqual(primary.ledger, expected.ledger)
    && isDeepStrictEqual(primary.nav, expected.nav)
    && isDeepStrictEqual(primary.accountingAudit, expected.accountingAudit)
    && expected.accountingAudit.ok === true,
  "primary signals, orders, trades, ledger, NAV, or accounting audit cannot be independently reproduced");
  const manifest = primary.manifest;
  const generatedConfig = {
    ...primaryConfig,
    snapshotPath: frozenManifest.outputPath,
    outputDir: `${String(pipelineConfig.outputDir).replace(/\/$/, "")}/smoke`
  };
  requireCondition(manifest?.schemaVersion === "2026-06-20.quant-smoke.run.v1"
    && manifest.commit === sourceCommitSha
    && manifest.snapshotId === expectedSnapshot.snapshotId
    && manifest.dataHash === expectedSnapshot.dataHash
    && manifest.adjustment === "forward"
    && isDeepStrictEqual(manifest.universe, expectedSnapshot.universe)
    && isDeepStrictEqual(manifest.fees, primaryConfig.fees)
    && manifest.initialCash === primaryConfig.initialCash
    && primaryConfig.execution?.signalTiming === "after_close_t"
    && primaryConfig.execution?.earliestExecution === "next_trading_day_open"
    && primaryConfig.execution?.priceField === "open"
    && primaryConfig.execution?.allowSameBarExecution === false
    && primaryConfig.execution?.allowMargin === false
    && manifest.snapshotPath === frozenManifest.outputPath
    && manifest.configHash === sha256(Buffer.from(`${JSON.stringify(generatedConfig, null, 2)}\n`))
    && isDeepStrictEqual(manifest.formalAccounting, formalRunBinding(formalAccountingBinding))
    && manifest.formalAccounting.accountingSnapshot.snapshotId === formalAccounting.accountingSnapshot.snapshotId
    && manifest.formalAccounting.corporateActionCoverage.ledgerId === formalAccounting.corporateActionCoverage.ledgerId
    && isDeepStrictEqual(manifest.metrics, expected.metrics)
    && isQuantRunSafety(manifest.safety)
    && expected.trades.length > 0
    && expected.trades.every((trade) => trade.totalFees > 0 && trade.sameBarExecution === false),
  "primary manifest or independently reproduced accounting metrics are invalid");
  // The primary witness must independently re-derive the same immutable fee
  // policy identity and bounded execution-calendar claim the sample-split
  // witness already requires; the digest comes from the imported policy DATA,
  // never from the runtime calculator.
  requireCondition(manifest.feePolicyVersion === FEE_POLICY_VERSION
    && manifest.feePolicySha256 === sha256(HK_FEE_POLICY_CANONICAL_JSON)
    && manifest.executionCalendar?.timing === "next_observed_session_open"
    && manifest.executionCalendar?.calendarCompleteness === "unknown",
  "primary manifest fee-policy or execution-calendar identity is invalid");
}

function validatePipelineWitness(pipeline, sourceCommitSha, expectedSnapshot, primaryExpected) {
  const manifest = pipeline?.manifest;
  const audit = pipeline?.audit;
  const rerun = audit?.reproducibility ?? manifest?.steps?.audit?.reproducibility;
  requireCondition(manifest?.schemaVersion === "2026-06-20.quant-pipeline.run.v1"
    && manifest.ok === true
    && manifest.linkage?.dataHashesMatch === true
    && manifest.linkage?.frozenDataHash === expectedSnapshot.dataHash
    && manifest.linkage?.smokeDataHash === expectedSnapshot.dataHash
    && manifest.steps?.smoke?.trades === primaryExpected.trades.length
    && audit?.ok === true
    && Array.isArray(audit.blockers) && audit.blockers.length === 0
    && rerun?.ok === true
    && Array.isArray(rerun.mismatches) && rerun.mismatches.length === 0
    && isDeepStrictEqual(rerun.before, rerun.after)
    && manifest.steps?.freeze?.sourceIdentity?.authorizationId === expectedSnapshot.sourceIdentity.authorizationId
    && manifest.steps?.smoke?.safety?.enablesTrading === false
    && manifest.steps?.smoke?.safety?.writesProductionDatabase === false
    && isNoWriteSafety(manifest.safety),
  `pipeline manifest at ${sourceCommitSha} is not consistent with the raw witness`);
}

function validateSampleSplitWitness({ witness, config, configBytes, sourceCommitSha, expectedSnapshot, files, sampleSplitRunner }) {
  const manifest = witness?.manifest;
  requireCondition(manifest?.schemaVersion === "2026-07-10.quant-sample-split-baseline.run.v2"
    && manifest.ok === true
    && manifest.codeIdentity?.commit === sourceCommitSha
    && manifest.codeIdentity?.scriptHash === sha256(files("scripts/quant-sample-split-baseline.mjs")),
  "sample-split manifest schema or source identity is invalid");
  // The witness recomputes the policy digest from the immutable policy DATA it
  // imports; it never calls the runtime fee calculator.
  requireCondition(manifest.feePolicyVersion === FEE_POLICY_VERSION
    && manifest.feePolicySha256 === sha256(HK_FEE_POLICY_CANONICAL_JSON)
    && manifest.executionCalendar?.timing === "next_observed_session_open"
    && manifest.executionCalendar?.calendarCompleteness === "unknown",
  "sample-split manifest fee-policy or execution-calendar identity is invalid");
  // The script hash itself is covered by the source-commit build-input manifest.
  requireCondition(manifest.configHash === sha256(configBytes)
    && manifest.dataIdentity?.snapshotId === expectedSnapshot.snapshotId
    && manifest.dataIdentity?.dataHash === expectedSnapshot.dataHash
    && manifest.dataIdentity?.snapshotHash === expectedSnapshot.snapshotHash
    && manifest.parameterPolicy?.finalTestUsedForParameterSelection === false
    && manifest.parameterPolicy?.finalTestUsedForAcceptanceThresholdFitting === false
    && manifest.parameterPolicy?.finalTestRole === "locked_report_only"
    && !manifest.parameterPolicy?.allowedSelectionSplits?.includes("final_test")
    && isNoWriteSafety(manifest.safety)
    && manifest.researchAuthority?.type === "research_evidence_only"
    && manifest.researchAuthority?.advisoryOnly === true
    && manifest.researchAuthority?.brokerWrite === false
    && manifest.researchAuthority?.productionWrite === false
    && manifest.researchAuthority?.officialPortfolioFact === false,
  "sample-split identity or final-test policy is invalid");
  const expectedSplits = config.splitRegistry.splits.map((split) => ({
    id: split.id,
    role: split.role,
    start: split.start,
    end: split.end,
    parameterSelectionAllowed: split.parameterSelectionAllowed === true,
    finalTestLocked: split.finalTestLocked === true,
    purpose: split.purpose
  }));
  requireCondition(isDeepStrictEqual(manifest.splitRegistry?.splits, expectedSplits)
    && expectedSplits.length === 3
    && expectedSplits.every((split, index) => index === 0 || expectedSplits[index - 1].end < split.start)
    && expectedSplits[2].id === "final_test"
    && expectedSplits[2].parameterSelectionAllowed === false
    && expectedSplits[2].finalTestLocked === true,
  "sample splits are not the fixed non-overlapping source configuration");
  const expectedRuns = {};
  for (const split of expectedSplits) {
    const bars = expectedSnapshot.bars.filter((bar) => bar.tradeDate >= split.start && bar.tradeDate <= split.end);
    expectedRuns[split.id] = sampleSplitRunner(split, bars, config, { universe: expectedSnapshot.universe });
  }
  requireCondition(isDeepStrictEqual(manifest.splitRuns, expectedRuns)
    && isDeepStrictEqual(manifest.metrics, Object.fromEntries(Object.entries(expectedRuns).map(([id, run]) => [id, run.metrics])))
    && isDeepStrictEqual(manifest.accountingAudit, Object.fromEntries(Object.entries(expectedRuns).map(([id, run]) => [id, run.accountingAudit]))),
  "sample-split raw runs cannot be independently reproduced");
}

function validateFailedExperiments({ entries, summary, sourceCommitSha, expectedSnapshot, lotSize, files }) {
  requireCondition(Array.isArray(entries) && entries.length === EXPERIMENTS.length, "all four failed experiments are required");
  requireCondition(Array.isArray(summary?.failedExperiments)
    && summary.failedExperiments.length === EXPERIMENTS.length
    && isDeepStrictEqual(summary.failedExperiments.map((entry) => entry.id), EXPERIMENTS.map(({ id }) => id)),
  "summary must contain exactly the four registered failed experiments");
  const summaryById = new Map(summary.failedExperiments.map((entry) => [entry.id, entry]));
  let rejectedCount = 0;
  for (let index = 0; index < EXPERIMENTS.length; index += 1) {
    const spec = EXPERIMENTS[index];
    const entry = entries[index];
    strictKeys(entry, ["configPath", "id", "manifest", "trades"], `failed experiment witness ${spec.id}`);
    const configBytes = files(spec.configPath);
    const config = parseJson(configBytes, spec.configPath);
    const expected = recomputePrimaryRun(expectedSnapshot.bars, config, lotSize);
    requireCondition(entry?.id === spec.id && entry.configPath === spec.configPath
      && entry.manifest?.commit === sourceCommitSha
      && entry.manifest?.configHash === sha256(configBytes)
      && entry.manifest?.snapshotId === expectedSnapshot.snapshotId
      && entry.manifest?.dataHash === expectedSnapshot.dataHash
      && isDeepStrictEqual(entry.manifest?.universe, expectedSnapshot.universe)
      && isDeepStrictEqual(entry.manifest?.fees, config.fees)
      && isQuantRunSafety(entry.manifest?.safety)
      && isDeepStrictEqual(entry.trades, expected.trades)
      && isDeepStrictEqual(entry.manifest.metrics, expected.metrics),
    `failed experiment raw witness is invalid: ${spec.id}`);
    const rejected = spec.operator === ">"
      ? expected.metrics[spec.metric] > spec.threshold
      : expected.metrics[spec.metric] < spec.threshold;
    if (rejected) rejectedCount += 1;
    const summaryEntry = summaryById.get(spec.id);
    strictKeys(summaryEntry, [
      "criterion", "expectedRejected", "experimentId", "id", "metrics", "rejected", "tuningImpact"
    ], `failed experiment summary ${spec.id}`);
    requireCondition(summaryEntry?.experimentId === config.experiment.experimentId
      && summaryEntry.criterion === spec.criterion
      && summaryEntry.rejected === rejected
      && summaryEntry.expectedRejected === spec.expectedRejected
      && rejected === spec.expectedRejected
      && isDeepStrictEqual(summaryEntry.metrics, expected.metrics)
      && summaryEntry.tuningImpact === "none_final_test_remained_locked",
    `failed experiment criterion was not independently reproduced: ${spec.id}`);
  }
  return rejectedCount;
}

function validateProbes(probes, sampleSplitConfig, freezeConfig, sampleSplitRunner) {
  strictKeys(probes, ["suspended", "zeroVolume"], "non-tradeable probes");
  for (const [key, reason] of [["zeroVolume", "zero_or_missing_volume"], ["suspended", "suspended_bar"]]) {
    const probe = probes[key];
    strictKeys(probe, ["bars", "run"], `${key} non-tradeable probe`);
    const expectedRun = sampleSplitRunner(
      { id: "probe" },
      probe.bars,
      {
        initialCash: sampleSplitConfig.initialCash,
        targetGrossExposure: sampleSplitConfig.targetGrossExposure,
        strategy: sampleSplitConfig.strategy,
        fees: sampleSplitConfig.fees
      },
      { universe: freezeConfig.universe, adjustment: "none" }
    );
    requireCondition(isDeepStrictEqual(probe.run, expectedRun)
      && expectedRun.orders.length === 1
      && expectedRun.orders[0].rejected === true
      && expectedRun.orders[0].reason === reason
      && expectedRun.trades.length === 0
      && expectedRun.accountingAudit.noTradesOnNonTradeableBars === true,
    `non-tradeable probe did not independently reject ${key}`);
  }
}

function selectSampleSplitRunner(scriptBytes) {
  const scriptHash = sha256(scriptBytes);
  assertAcceptedSampleSplitScriptHash(scriptHash);
  return runBaselineSplit;
}

export function assertAcceptedSampleSplitScriptHash(scriptHash) {
  if (scriptHash === LEGACY_SAMPLE_SPLIT_SCRIPT_HASH) {
    throw new Error(`known-invalid legacy sample-split accounting script is non-accepting: ${scriptHash}`);
  }
  if (scriptHash !== CURRENT_SAMPLE_SPLIT_SCRIPT_HASH) {
    throw new Error(`unsupported sample-split script hash: ${scriptHash}`);
  }
}

function validateSummary({
  summary,
  primary,
  approvedInput,
  failedExperimentCount,
  formalAccountingBinding,
  formalAccounting
}) {
  strictKeys(summary, [
    "advisoryOnly", "concentration", "corporateActions", "failedExperimentCount", "failedExperiments",
    "finalTestRetuned", "fixturePerformanceClaimed", "formalAccounting", "primaryMetrics",
    "researchBoundary", "schemaVersion", "snapshotId", "source"
  ], "real-data quant summary");
  strictKeys(summary.researchBoundary, [
    "adjustmentMode", "formalPerformanceAuthority", "priceBasis", "role", "sourcePolicy"
  ], "real-data quant research boundary");
  strictKeys(summary.corporateActions, [
    "accountingSnapshotId", "corporateActionLedgerId", "executionPriceBasis",
    "feeNotionalBasis", "officialFactsMutated", "signalPriceBasis", "simulatedResearchOnly",
    "status", "valuationPriceBasis"
  ], "real-data quant corporate actions");
  const totalGross = primary.trades.reduce((sum, trade) => sum + Math.abs(trade.grossAmount), 0);
  const largestTradeGross = Math.max(...primary.trades.map((trade) => Math.abs(trade.grossAmount)));
  const monthly = new Map();
  for (const trade of primary.trades) {
    const month = trade.tradeDate.slice(0, 7);
    monthly.set(month, (monthly.get(month) ?? 0) + Math.abs(trade.grossAmount));
  }
  const [largestMonth, largestMonthGross] = [...monthly.entries()].sort((a, b) => b[1] - a[1])[0];
  const expected = {
    trade: { reported: true, largestGrossShare: largestTradeGross / totalGross },
    security: { reported: true, largestSymbol: "HK.09926", largestGrossShare: 1, limitation: "single-security research scope" },
    month: { reported: true, largestMonth, largestGrossShare: largestMonthGross / totalGross }
  };
  requireCondition(summary?.schemaVersion === "2026-07-19.real-data-quant-summary.v2"
    && summary.fixturePerformanceClaimed === false
    && summary.finalTestRetuned === false
    && summary.advisoryOnly === true
    && summary.failedExperimentCount === failedExperimentCount
    && isDeepStrictEqual(summary.primaryMetrics, primary.metrics)
    && isDeepStrictEqual(summary.concentration, expected)
    && isDeepStrictEqual(summary.formalAccounting, formalAccountingBinding)
    && isDeepStrictEqual(summary.researchBoundary, {
      adjustmentMode: "forward",
      priceBasis: "adjusted_qfq_close",
      role: "signal_generation_only",
      formalPerformanceAuthority: false,
      sourcePolicy: approvedInput.corporateActionPolicy
    })
    && isDeepStrictEqual(summary.corporateActions, {
      status: "formal_accounting_replayed",
      accountingSnapshotId: formalAccounting.accountingSnapshot.snapshotId,
      corporateActionLedgerId: formalAccounting.corporateActionCoverage.ledgerId,
      signalPriceBasis: "adjusted_qfq_close",
      executionPriceBasis: "unadjusted_open",
      valuationPriceBasis: "unadjusted_close",
      feeNotionalBasis: "unadjusted_trade_gross",
      simulatedResearchOnly: true,
      officialFactsMutated: false
    }),
  "summary concentration or formal raw-accounting boundary is not independently supported");
  return expected;
}

function makePrimaryOrder(signal, bar, side, quantity, lotSize, estimatedFees) {
  return {
    orderId: `order-${signal.signalDate}-${bar.tradeDate}-${side}`,
    signalDate: signal.signalDate,
    generatedAfter: signal.generatedAfter,
    tradeDate: bar.tradeDate,
    side,
    quantity,
    boardLot: lotSize,
    roundedToBoardLot: quantity % lotSize === 0,
    priceType: "next_open",
    expectedPrice: roundPrimary(bar.open),
    reason: signal.rule,
    estimatedFees: roundPrimary(estimatedFees),
    rejectedReason: quantity <= 0 ? "cash_or_lot_size_insufficient" : null
  };
}

function makePrimaryTrade(order, bar, cashBefore, cashAfter, sharesAfter, estimated) {
  return {
    tradeId: order.orderId.replace("order", "trade"),
    orderId: order.orderId,
    signalDate: order.signalDate,
    tradeDate: order.tradeDate,
    side: order.side,
    quantity: order.quantity,
    price: roundPrimary(bar.open),
    grossAmount: roundPrimary(order.quantity * bar.open),
    fees: estimated.fees,
    totalFees: roundPrimary(estimated.totalFees),
    netCashChange: order.side === "buy" ? -roundPrimary(estimated.totalCashRequired) : roundPrimary(estimated.netProceeds),
    cashBefore: roundPrimary(cashBefore),
    cashAfter: roundPrimary(cashAfter),
    sharesAfter,
    sameBarExecution: order.signalDate === order.tradeDate
  };
}

// Independent HK fee arithmetic. This witness intentionally reimplements the
// rate lookup, cent rounding and whole-HKD stamp ceil itself and shares only
// the immutable policy DATA (HK_FEE_POLICY_SEGMENTS), never the calculator.
// Independent execution-gate check: suspended / halted, zero or missing
// volume, and invalid prices all block simulated execution before any ledger
// mutation, matching the runtime sample-split gate.
function executionBlockedReason(bar) {
  if (!bar) return "missing_execution_bar";
  const status = String(bar.tradingStatus ?? bar.tradeStatus ?? "").toLowerCase();
  if (bar.suspended === true || status === "suspended" || status === "halted") return "suspended_bar";
  if (!Number.isFinite(Number(bar.volume)) || Number(bar.volume) <= 0) return "zero_or_missing_volume";
  if (!Number.isFinite(bar.open) || bar.open <= 0) return "invalid_execution_price";
  return null;
}

// Independent calendar round-trip shared by the witness bar and fee-policy date
// checks, so impossible dates such as 2026-02-31 never look like valid dates.
function witnessIsCalendarDate(value) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

function validDividendPaymentEvidence(value, exDate) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !witnessIsCalendarDate(value.announcedAt) || !witnessIsCalendarDate(value.approvedAt)
    || value.announcedAt >= exDate || value.approvedAt >= exDate
    || value.brokerCashReceipt !== "UNKNOWN") return false;
  const documents = [value.announcement, value.approval,
    ...(value.paymentConfirmation === null ? [] : [value.paymentConfirmation])];
  return documents.every((item) => item && typeof item === "object"
    && typeof item.path === "string" && item.path.startsWith("docs/reviews/quant-dividend-payment-20261010/sources/")
    && item.path.endsWith(".pdf") && SHA256_PATTERN.test(item.sha256 ?? "")
    && Number.isSafeInteger(item.byteLength) && item.byteLength > 0
    && Number.isSafeInteger(item.page) && item.page > 0
    && typeof item.locator === "string" && item.locator.length > 10);
}

function primaryPolicyForDate(tradeDate) {
  const value = String(tradeDate ?? "");
  if (!witnessIsCalendarDate(value)
    || value < FEE_POLICY_SUPPORTED_FROM
    || value > new Date().toISOString().slice(0, 10)) {
    throw new Error(`witness_unsupported_trade_date:${value || "missing"}`);
  }
  const segment = HK_FEE_POLICY_SEGMENTS.find((item) =>
    value >= item.effectiveFrom && (item.effectiveTo === null || value <= item.effectiveTo));
  if (!segment) throw new Error(`witness_missing_fee_segment:${value}`);
  return segment;
}

function primaryRatFromDecimal(value) {
  const text = String(Number(value));
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`witness_invalid_rate:${value}`);
  const [whole, fraction = ""] = text.split(".");
  const den = 10 ** fraction.length;
  return { num: Number(whole) * den + Number(fraction || "0"), den };
}

function primaryFeeCents(rational, grossCents) {
  return Math.round((grossCents * rational.num) / rational.den);
}

function estimatePrimaryCost(quantity, price, side, tradeDate, fees) {
  if (side !== "buy" && side !== "sell") throw new Error(`witness_invalid_side:${side ?? "missing"}`);
  const gross = roundPrimary(quantity * price);
  if (!Number.isFinite(gross) || gross < 0) throw new Error(`witness_invalid_gross_amount:${gross}`);
  const grossCents = Math.round(gross * 100);
  const policy = primaryPolicyForDate(tradeDate);
  const settlementRaw = primaryFeeCents(policy.settlement, grossCents);
  const settlementCents = policy.settlementMinHkd == null && policy.settlementMaxHkd == null
    ? settlementRaw
    : Math.min(
      policy.settlementMaxHkd == null ? settlementRaw : policy.settlementMaxHkd * 100,
      Math.max(policy.settlementMinHkd == null ? settlementRaw : policy.settlementMinHkd * 100, settlementRaw)
    );
  const breakdownCents = {
    commission: Math.max(
      Math.round(Number(fees.minCommission) * 100),
      primaryFeeCents(primaryRatFromDecimal(fees.commissionRate), grossCents)
    ),
    platformFee: Math.round(Number(fees.platformFee) * 100),
    stampDuty: policy.stampDuty.num === 0
      ? 0
      : Math.ceil((grossCents * policy.stampDuty.num) / (policy.stampDuty.den * 100)) * 100,
    tradingFee: primaryFeeCents(policy.tradingFee, grossCents),
    tradingTariff: Math.round(policy.tradingTariffHkd * 100),
    transactionLevy: primaryFeeCents(policy.transactionLevy, grossCents),
    afrc: primaryFeeCents(policy.afrc, grossCents),
    settlementFee: settlementCents
  };
  const toHkd = (cents) => Math.round(cents) / 100;
  const breakdown = Object.fromEntries(Object.entries(breakdownCents).map(([key, cents]) => [key, toHkd(cents)]));
  const totalFees = toHkd(Object.values(breakdownCents).reduce((sum, cents) => sum + cents, 0));
  return {
    fees: breakdown,
    totalFees,
    totalCashRequired: roundPrimary(gross + totalFees),
    netProceeds: roundPrimary(gross - totalFees)
  };
}

function primaryMetrics(nav, trades, initialCash) {
  const finalEquity = nav.at(-1)?.equity ?? initialCash;
  let peak = initialCash;
  let maxDrawdown = 0;
  const returns = [];
  for (const row of nav) {
    peak = Math.max(peak, row.equity);
    maxDrawdown = Math.min(maxDrawdown, (row.equity - peak) / peak);
    returns.push(row.dailyReturn);
  }
  const average = returns.reduce((sum, value) => sum + value, 0) / Math.max(returns.length, 1);
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(returns.length - 1, 1);
  const standardDeviation = Math.sqrt(variance);
  return {
    finalEquity: roundPrimary(finalEquity),
    totalReturn: roundPrimary((finalEquity - initialCash) / initialCash, 8),
    maxDrawdown: roundPrimary(maxDrawdown, 8),
    sharpe: standardDeviation > 0 ? roundPrimary((average / standardDeviation) * Math.sqrt(252), 6) : 0,
    tradeCount: trades.length,
    totalFees: roundPrimary(trades.reduce((sum, trade) => sum + trade.totalFees, 0)),
    turnoverOneWay: roundPrimary(nav.reduce((sum, row) => sum + row.turnoverOneWay, 0), 8),
    turnoverTwoWay: roundPrimary(nav.reduce((sum, row) => sum + row.turnoverTwoWay, 0), 8)
  };
}

function validFullBar(bar, expectedCode = "09926", expectedSource = "pingan_imported_history_with_futu_qfq") {
  return bar.market === "HK" && bar.code === expectedCode
    && witnessIsCalendarDate(bar.tradeDate)
    && [bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value) && value > 0)
    && bar.high >= Math.max(bar.open, bar.close, bar.low)
    && bar.low <= Math.min(bar.open, bar.close, bar.high)
    && Number.isFinite(bar.volume) && bar.volume >= 0
    && Number.isFinite(bar.turnover) && bar.turnover >= 0
    && bar.adjustment === "forward"
    && bar.source === expectedSource
    && Number.isFinite(Date.parse(bar.fetchedAt));
}

function validUnadjustedBar(bar, expectedCode = "09926") {
  return bar.market === "HK" && bar.code === expectedCode
    && witnessIsCalendarDate(bar.tradeDate)
    && [bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value) && value > 0)
    && bar.high >= Math.max(bar.open, bar.close, bar.low)
    && bar.low <= Math.min(bar.open, bar.close, bar.high)
    && Number.isFinite(bar.volume) && bar.volume >= 0
    && Number.isFinite(bar.turnover) && bar.turnover >= 0
    && bar.adjustment === "none"
    && bar.source === "futu_request_history_kline_none"
    && Number.isFinite(Date.parse(bar.fetchedAt));
}

function isResearchOnlyAuthority(authority) {
  return hasExactKeys(authority, [
    "advisoryOnly", "allocation", "brokerWrite", "buySellHold", "cashFeePositionMutation",
    "officialPortfolioFact", "officialReviewFact", "orderTradeFill", "productionWrite", "ranking",
    "recommendation", "score", "sizing", "targetPrice", "type"
  ])
    && authority.type === "research_only"
    && authority.advisoryOnly === true
    && authority.officialPortfolioFact === false
    && authority.officialReviewFact === false
    && authority.ranking === false
    && authority.recommendation === false
    && authority.score === false
    && authority.allocation === false
    && authority.sizing === false
    && authority.targetPrice === false
    && authority.buySellHold === false
    && authority.orderTradeFill === false
    && authority.cashFeePositionMutation === false
    && authority.brokerWrite === false
    && authority.productionWrite === false;
}

function isNoWriteSafety(safety) {
  return safety?.sendsLiveNetworkRequests === false
    && safety.writesProductionDatabase === false
    && safety.enablesTrading === false
    && safety.initializesBrokerGateway === false
    && safety.mutatesOfficialPortfolio === false
    && safety.mutatesOfficialReview === false
    && hasNoUnexpectedTrueFlags(safety, new Set(["readsFrozenSnapshot"]));
}

function isQuantRunSafety(safety) {
  return safety?.readsFrozenSnapshot === true
    && safety.sendsLiveNetworkRequests === false
    && safety.writesProductionDatabase === false
    && safety.enablesTrading === false
    && safety.touchesRealTradesPositionsReviews === false
    && hasNoUnexpectedTrueFlags(safety, new Set(["readsFrozenSnapshot"]));
}

function hasNoUnexpectedTrueFlags(value, allowedTrueKeys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.entries(value).every(([key, entry]) => entry !== true || allowedTrueKeys.has(key));
}

function makeSourceReader(sourceFileBytes) {
  requireCondition(typeof sourceFileBytes === "function", "source-commit file reader is required");
  return (path) => {
    const bytes = sourceFileBytes(path);
    requireCondition(Buffer.isBuffer(bytes), `source-commit build input is missing: ${path}`);
    return bytes;
  };
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`source-commit file is not valid JSON: ${label}`);
  }
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    requireCondition(Object.getPrototypeOf(value) === Object.prototype, "canonical JSON requires plain objects");
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error("canonical JSON contains an unsupported value");
}

function strictKeys(value, keys, label) {
  requireCondition(hasExactKeys(value, keys), `${label} contains missing or unsupported fields`);
}

function hasExactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function roundPrimary(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}
