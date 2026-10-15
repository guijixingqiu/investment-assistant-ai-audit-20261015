#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { feePolicySha256, FEE_POLICY_VERSION } from "./lib/hk-fee-policy.mjs";
import {
  DIVIDEND_CASH_POLICY,
  DIVIDEND_CASH_POLICY_SHA256,
  DIVIDEND_PAYMENT_LEDGER_SCHEMA,
  verifyOfficialDividendPaymentFiles
} from "./lib/quant-dividend-payment-sources.mjs";
import {
  REAL_DATA_ACCOUNTING_SNAPSHOT_SCHEMA,
  REAL_DATA_CORPORATE_ACTION_LEDGER_SCHEMA,
  REAL_DATA_FORMAL_ACCOUNTING_SCHEMA,
  canonicalJsonBytes,
  recomputeFormalAccountingRun,
  sha256,
  validateFormalAccountingBinding
} from "./lib/real-data-quant-witness.mjs";
import { loadHkConnectUniverse } from "./hk-connect-universe-binding.mjs";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultConfigPath = "config/quant-hk00175-v0.1.json";

const [command, input] = process.argv.slice(2);
if (command === "capture") await capture(input);
else if (command === "build") await build();
else throw new Error("usage: node scripts/hk00175-quant-v0.1.mjs capture <OpenD capture.json> | build (optional QUANT_HK_STOCK_CONFIG)");

async function capture(inputPath) {
  if (!inputPath) throw new Error("capture input path is required");
  const source = JSON.parse(await readFile(inputPath, "utf8"));
  validateCapture(source);
  const symbol = source.symbol;
  const code = symbol.slice(3);
  const slug = `hk${code}`;
  const endKey = source.dateRange.end.replaceAll("-", "");
  const signalPath = `data/quant-approved/futu-hk-${code}-qfq-${endKey}.json`;
  const accountingPath = `data/quant-approved/futu-hk-${code}-au-none-${endKey}.json`;
  const actionsPath = `data/quant-approved/futu-hk-${code}-corporate-actions-${endKey}.json`;
  const freezeConfigPath = `config/quant-freeze-snapshot.futu-hk-${code}-${endKey}.json`;
  const configPath = process.env.QUANT_HK_STOCK_CONFIG ?? `config/quant-${slug}-v0.1.json`;
  const authorizationId = `owner-authorized-vps-opend-${slug}-${endKey}`;
  const outputDir = `artifacts/${slug}-quant-v0.1`;
  const universe = [{ market: "HK", code, symbol, name: source.name, lotSize: source.lotSize }];
  const universeVersion = `hk-${symbol.toLowerCase()}-${source.dateRange.start}-${source.dateRange.end}`;
  const common = {
    authorizationId,
    universeVersion,
    dataCutoff: source.fetchedAt,
    universe,
    dateRange: source.dateRange
  };
  const signal = {
    schemaVersion: "2026-08-08.futu-real-history.v1",
    sourceClass: "owner_approved_historical_only",
    fixture: false,
    provenance: "owner_authorized_vps_opend_readonly_request_history_kline_qfq",
    ...common,
    corporateActionPolicy: {
      signalPrices: "futu_AuType_QFQ",
      executionPrices: "futu_AuType_NONE",
      cashDividendSource: "futu_get_rehab",
      accountingAuthority: false
    },
    bars: source.qfqBars
  };
  const accounting = {
    schemaVersion: REAL_DATA_ACCOUNTING_SNAPSHOT_SCHEMA,
    sourceKind: "futu_request_history_kline_none",
    sourceClass: "owner_approved_historical_accounting_only",
    authorizationId,
    universeVersion,
    adjustmentMode: "none",
    dataCutoff: source.fetchedAt,
    universe,
    dateRange: source.dateRange,
    bars: source.unadjustedBars,
    authority: "research_only_historical_accounting",
    fixture: false,
    dataHash: null,
    snapshotId: null
  };
  accounting.dataHash = sha256(stableJson({
    schemaVersion: accounting.schemaVersion,
    sourceKind: accounting.sourceKind,
    sourceClass: accounting.sourceClass,
    authorizationId,
    universeVersion,
    adjustmentMode: accounting.adjustmentMode,
    dataCutoff: accounting.dataCutoff,
    universe,
    dateRange: accounting.dateRange,
    bars: accounting.bars
  }));
  accounting.snapshotId = `hk-${symbol.toLowerCase()}-none-${source.dateRange.start}-${source.dateRange.end}-${accounting.dataHash.slice(0, 12)}`;

  const events = corporateActionEvents(source.rehabRows, source.completedTradingDates, source.dateRange, symbol);
  const coverage = {
    complete: true,
    coveredTradingDates: source.completedTradingDates,
    dateRange: source.dateRange,
    eventCount: events.length,
    universe,
    zeroEventCoverageDeclared: events.length === 0
  };
  const actions = {
    schemaVersion: REAL_DATA_CORPORATE_ACTION_LEDGER_SCHEMA,
    sourceKind: "owner_approved_corporate_action_ledger",
    sourceClass: "owner_approved_historical_corporate_actions_only",
    authorizationId,
    universeVersion,
    dataCutoff: source.fetchedAt,
    universe,
    coverage,
    events,
    authority: "research_only_historical_accounting",
    fixture: false,
    ledgerHash: null,
    ledgerId: null
  };
  actions.ledgerHash = sha256(stableJson({
    schemaVersion: actions.schemaVersion,
    sourceKind: actions.sourceKind,
    sourceClass: actions.sourceClass,
    authorizationId,
    universeVersion,
    dataCutoff: actions.dataCutoff,
    universe,
    coverage,
    events,
    authority: actions.authority
  }));
  actions.ledgerId = `hk-${symbol.toLowerCase()}-corporate-actions-${source.dateRange.start}-${source.dateRange.end}-${actions.ledgerHash.slice(0, 12)}`;

  const registeredAt = new Date(Date.parse(source.fetchedAt) + 1_000).toISOString();
  const generatedAt = new Date(Date.parse(source.fetchedAt) + 2_000).toISOString();
  const splits = thirds(source.completedTradingDates);
  const officialUniverse = await loadHkConnectUniverse("config/hk-connect-universe.southbound.json");
  if (!officialUniverse.members.has(symbol)) throw new Error(`${symbol} is not in the current official Hong Kong Connect universe`);
  const freezeConfig = {
    schemaVersion: "2026-06-20.quant-freeze-snapshot.v1",
    sourceKind: "futu_request_history_kline_qfq",
    sourceIdentity: {
      source: "futu_request_history_kline_qfq",
      classification: "approved_real_historical",
      provenance: "owner_authorized_vps_opend_readonly_request_history_kline_qfq",
      authorizationId,
      authority: "research_only",
      asOf: source.asOf,
      fetchedAt: source.fetchedAt,
      externalFetch: true
    },
    sourcePath: signalPath,
    outputDir: `${outputDir}/signal-snapshot`,
    hkConnectUniversePath: "config/hk-connect-universe.southbound.json",
    market: "HK",
    adjustment: "forward",
    dataCutoff: source.fetchedAt,
    dateRange: source.dateRange,
    universe
  };
  const config = {
    schemaVersion: "2026-08-17.hk-stock-quant-v0.1",
    generatedAt,
    registeredAt,
    signalFreezeConfigPath: freezeConfigPath,
    signalSourcePath: signalPath,
    accountingSnapshotPath: accountingPath,
    corporateActionLedgerPath: actionsPath,
    benchmarkSourcePath: `data/quant-approved/futu-hk-800000-au-none-${endKey}.json`,
    outputDir,
    candidateResearchRule: {
      ruleVersion: "2026-08-13.hk-candidate-quant-research-priority.v1",
      universeVersion: `${officialUniverse.binding.effectiveDate}:${officialUniverse.binding.snapshotId}`,
      cutoff: officialUniverse.binding.capturedAt,
      symbols: [symbol],
      eligibilityEvidenceStatus: "available",
      manualResearchOnlyWhenEligibilityUnknown: true,
      preservesSourceOrder: true,
      ranking: false,
      recommendation: false,
      limitations: [
        `${symbol} is present in the exact dated official Hong Kong Connect universe bound to this run; this does not prove historical eligibility on every backtest date.`,
        "The rule preserves source order and cannot rank, score, recommend, add membership, or trigger execution."
      ]
    },
    splitRegistry: { registrationTiming: "retrospective_after_snapshot", splits },
    parameterPolicy: {
      preregistered: false,
      prospectiveHoldoutClaim: false,
      finalTestUsedForParameterSelection: false,
      finalTestUsedForAcceptanceThresholdFitting: false
    },
    parameterSearch: parameterSearchConfig(registeredAt),
    initialCash: 100000,
    targetGrossExposure: 0.5,
    signal: { name: "one_day_close_reversal", buyWhenPreviousCloseReturnLte: -0.015, sellWhenPreviousCloseReturnGte: 0.015 },
    execution: { signalTiming: "after_close_t", earliestExecution: "next_trading_day_open", allowSameBarExecution: false, allowMargin: false },
    fees: { commissionRate: 0.0003, minCommission: 3, platformFee: 15, stampDutyRate: 0.001, tradingFeeRate: 0.0000565, transactionLevyRate: 0.000027 },
    limitations: [
      `${symbol} evidence is a ${source.qfqBars.length}-session historical OpenD snapshot through ${source.dateRange.end}, not live market or account state.`,
      `Signals use QFQ closes; simulated execution, valuation and fees use separate unadjusted evidence; ${events.length} Futu rehab cash-dividend event(s) are preserved.`,
      "The three sample windows were registered retrospectively; final_test is report-only and was not used for tuning or acceptance thresholds.",
      "Futu rehab coverage is provider evidence, not legal or official corporate-action accounting authority.",
      "Research-only historical simulation; no forecast, recommendation, ranking, sizing, order, trade, broker, portfolio, cash, fee or position authority."
    ]
  };
  await Promise.all([
    writeNew(signalPath, signal),
    writeNew(accountingPath, accounting),
    writeNew(actionsPath, actions),
    writeNew(freezeConfigPath, freezeConfig),
    writeNew(configPath, config)
  ]);
  console.log(JSON.stringify({ ok: true, signalPath, accountingPath, actionsPath, freezeConfigPath, configPath, bars: source.qfqBars.length, corporateActions: events.length }, null, 2));
}

async function build() {
  const configPath = process.env.QUANT_HK_STOCK_CONFIG ?? defaultConfigPath;
  const config = JSON.parse(await readFile(join(root, configPath), "utf8"));
  if (config.schemaVersion !== "2026-10-10.hk-stock-quant-dividend-payment.v2"
    || stableJson(config.dividendCashPolicy) !== stableJson(DIVIDEND_CASH_POLICY)) {
    throw new Error("current stock quant run requires the bound dividend-receivable payment policy");
  }
  await verifyOfficialDividendPaymentFiles(root);
  const freeze = await runJson(process.execPath, ["scripts/quant-freeze-snapshot-verify.mjs"], {
    QUANT_FREEZE_CONFIG: config.signalFreezeConfigPath
  });
  const [signalBytes, accountingBytes, actionBytes, signalSnapshotText, benchmarkBytes] = await Promise.all([
    readFile(join(root, config.signalSourcePath)),
    readFile(join(root, config.accountingSnapshotPath)),
    readFile(join(root, config.corporateActionLedgerPath)),
    readFile(join(root, freeze.snapshotPath), "utf8"),
    config.benchmarkSourcePath ? readFile(join(root, config.benchmarkSourcePath)) : null
  ]);
  const signalSnapshot = JSON.parse(signalSnapshotText);
  const accounting = JSON.parse(accountingBytes);
  const actions = JSON.parse(actionBytes);
  if (actions.schemaVersion !== DIVIDEND_PAYMENT_LEDGER_SCHEMA) {
    throw new Error("current stock quant run requires the sourced dividend-payment ledger v2");
  }
  const binding = {
    schemaVersion: REAL_DATA_FORMAL_ACCOUNTING_SCHEMA,
    status: "verified",
    signalSnapshot: { path: config.signalSourcePath, sha256: sha256(signalBytes), snapshotId: signalSnapshot.snapshotId, dataHash: signalSnapshot.dataHash, adjustmentMode: "forward" },
    accountingSnapshot: { path: config.accountingSnapshotPath, sha256: sha256(accountingBytes), snapshotId: accounting.snapshotId, dataHash: accounting.dataHash, adjustmentMode: "none", authorizationId: accounting.authorizationId, universeVersion: accounting.universeVersion, dataCutoff: accounting.dataCutoff, dateRange: accounting.dateRange },
    corporateActionCoverage: { path: config.corporateActionLedgerPath, sha256: sha256(actionBytes), ledgerId: actions.ledgerId, ledgerHash: actions.ledgerHash, authorizationId: actions.authorizationId, universeVersion: actions.universeVersion, dataCutoff: actions.dataCutoff, coverage: actions.coverage },
    priceBasis: { signal: "adjusted_qfq_close", execution: "unadjusted_open", valuation: "unadjusted_close", feeNotional: "unadjusted_trade_gross" },
    blockers: []
  };
  validateFormalAccountingBinding({
    binding,
    signalSnapshot,
    signalSourcePath: config.signalSourcePath,
    signalSourceSha256: sha256(signalBytes),
    sourceFileBytes: (path) => path === config.accountingSnapshotPath ? accountingBytes : path === config.corporateActionLedgerPath ? actionBytes : null
  });

  const splitRuns = {};
  for (const split of config.splitRegistry.splits) {
    splitRuns[split.id] = formalReplayWindow(signalSnapshot, accounting, actions, config, split.start, split.end);
  }
  const fullReplay = recomputeFormalAccountingRun({ signalBars: signalSnapshot.bars, accountingBars: accounting.bars, corporateActionLedger: actions, config, lotSize: signalSnapshot.universe[0].lotSize, signalSource: "futu_request_history_kline_qfq" });
  const experimentRegistry = buildExperimentRegistry(signalSnapshot, accounting, actions, config);
  const adverseCaseEvidence = buildAdverseCaseEvidence(signalSnapshot, accounting, actions, config, fullReplay);
  const benchmarkEvidence = benchmarkBytes ? buildBenchmarkEvidence(JSON.parse(benchmarkBytes), benchmarkBytes, config, signalSnapshot, splitRuns, fullReplay) : null;
  const generatedAt = benchmarkEvidence
    ? new Date(Math.max(Date.parse(config.generatedAt), Date.parse(benchmarkEvidence.benchmark.fetchedAt) + 1_000)).toISOString()
    : config.generatedAt;
  const evidence = buildManifest({ config, generatedAt, signalSnapshot, accounting, actions, binding, splitRuns, fullReplay, experimentRegistry, adverseCaseEvidence, benchmarkEvidence });
  await mkdir(join(root, config.outputDir), { recursive: true });
  await Promise.all([
    writeFile(join(root, config.outputDir, "run_manifest.json"), canonicalJsonBytes(evidence.manifest)),
    writeFile(join(root, config.outputDir, "formal-replay.json"), canonicalJsonBytes(evidence.replay))
  ]);
  console.log(JSON.stringify({ ok: true, manifestPath: `${config.outputDir}/run_manifest.json`, replayPath: `${config.outputDir}/formal-replay.json`, snapshotId: evidence.manifest.dataIdentity.snapshotId, splitMetrics: evidence.manifest.metrics, fullMetrics: fullReplay.metrics }, null, 2));
}

function parameterSearchConfig(registeredAt) {
  return {
    schemaVersion: "2026-08-17.hk-stock-parameter-search.v1",
    registeredAt,
    selectionPolicy: "baseline_fixed_before_diagnostics_no_final_test",
    candidates: [
      { id: "baseline", disposition: "selected", reason: "Owner baseline remains fixed; diagnostics cannot replace it.", signal: { name: "one_day_close_reversal", buyWhenPreviousCloseReturnLte: -0.015, sellWhenPreviousCloseReturnGte: 0.015 } },
      { id: "sparse_reversal", disposition: "rejected", reason: "Diagnostic only; not selected and never evaluated on final_test for selection.", signal: { name: "one_day_close_reversal", buyWhenPreviousCloseReturnLte: -0.03, sellWhenPreviousCloseReturnGte: 0.03 } },
      { id: "sensitive_reversal", disposition: "rejected", reason: "Diagnostic only; not selected and never evaluated on final_test for selection.", signal: { name: "one_day_close_reversal", buyWhenPreviousCloseReturnLte: -0.005, sellWhenPreviousCloseReturnGte: 0.005 } }
    ]
  };
}

function formalReplayWindow(signalSnapshot, accounting, actions, config, start, end) {
  const signalBars = signalSnapshot.bars.filter((bar) => bar.tradeDate >= start && bar.tradeDate <= end);
  const accountingBars = accounting.bars.filter((bar) => bar.tradeDate >= start && bar.tradeDate <= end);
  const events = actions.events.filter((event) => event.exDate >= start && event.exDate <= end);
  const corporateActionLedger = {
    ...actions,
    coverage: { ...actions.coverage, coveredTradingDates: signalBars.map((bar) => bar.tradeDate), dateRange: { start, end }, eventCount: events.length, zeroEventCoverageDeclared: events.length === 0 },
    events
  };
  return recomputeFormalAccountingRun({ signalBars, accountingBars, corporateActionLedger, config, lotSize: signalSnapshot.universe[0].lotSize, signalSource: "futu_request_history_kline_qfq" });
}

function buildExperimentRegistry(signalSnapshot, accounting, actions, config) {
  const search = config.parameterSearch;
  const validation = config.splitRegistry.splits.find((split) => split.id === "validation");
  if (search?.schemaVersion !== "2026-08-17.hk-stock-parameter-search.v1" || !validation
    || search.selectionPolicy !== "baseline_fixed_before_diagnostics_no_final_test"
    || !Array.isArray(search.candidates) || search.candidates.length < 2
    || search.candidates.filter((item) => item.disposition === "selected").length !== 1
    || stableJson(search.candidates.find((item) => item.disposition === "selected")?.signal) !== stableJson(config.signal)) {
    throw new Error("parameter-search registry is invalid or does not preserve the fixed baseline");
  }
  const experiments = search.candidates.map((candidate) => ({
    id: candidate.id,
    signal: candidate.signal,
    disposition: candidate.disposition,
    reason: candidate.reason,
    finalTestUsedForSelection: false,
    selectionWindow: { start: signalSnapshot.dateRange.start, end: validation.end },
    metrics: metricsFor(formalReplayWindow(signalSnapshot, accounting, actions, { ...config, signal: candidate.signal }, signalSnapshot.dateRange.start, validation.end))
  }));
  if (new Set(experiments.map((item) => item.id)).size !== experiments.length) throw new Error("parameter-search experiment ids must be unique");
  const body = { schemaVersion: search.schemaVersion, registeredAt: search.registeredAt, selectionPolicy: search.selectionPolicy, experiments };
  const rejected = experiments.filter((item) => item.disposition === "rejected");
  return {
    ...body,
    registryId: `quant-parameter-search:${sha256(stableJson(body))}`,
    failedExperimentsId: `quant-failed-experiments:${sha256(stableJson(rejected))}`
  };
}

function buildAdverseCaseEvidence(signalSnapshot, accounting, actions, config, fullReplay) {
  const executionDate = fullReplay.trades[0]?.tradeDate;
  if (!executionDate) throw new Error("adverse-case replay requires at least one baseline execution");
  const zeroSignalBars = structuredClone(signalSnapshot.bars);
  const zeroAccountingBars = structuredClone(accounting.bars);
  zeroSignalBars.find((bar) => bar.tradeDate === executionDate).volume = 0;
  zeroAccountingBars.find((bar) => bar.tradeDate === executionDate).volume = 0;
  const zeroRun = recomputeFormalAccountingRun({ signalBars: zeroSignalBars, accountingBars: zeroAccountingBars, corporateActionLedger: actions, config, lotSize: signalSnapshot.universe[0].lotSize, signalSource: "futu_request_history_kline_qfq" });
  if (zeroRun.trades.some((trade) => trade.tradeDate === executionDate)) throw new Error("zero-volume or suspended probe executed a trade");

  const missingPriceBars = structuredClone(accounting.bars);
  missingPriceBars.find((bar) => bar.tradeDate === executionDate).open = null;
  let missingPriceError = null;
  try {
    recomputeFormalAccountingRun({ signalBars: signalSnapshot.bars, accountingBars: missingPriceBars, corporateActionLedger: actions, config, lotSize: signalSnapshot.universe[0].lotSize, signalSource: "futu_request_history_kline_qfq" });
  } catch (error) {
    missingPriceError = error instanceof Error ? error.message : String(error);
  }
  if (!missingPriceError) throw new Error("missing execution-price probe was accepted");
  const body = {
    schemaVersion: "2026-08-17.hk-stock-adverse-execution.v1",
    snapshotId: signalSnapshot.snapshotId,
    cases: [
      { id: "suspension_zero_volume", executionDate, outcome: "execution_blocked", tradesOnDate: 0, inputHash: sha256(stableJson({ signal: zeroSignalBars.find((bar) => bar.tradeDate === executionDate), accounting: zeroAccountingBars.find((bar) => bar.tradeDate === executionDate) })) },
      { id: "missing_execution_price", executionDate, outcome: "input_rejected", error: missingPriceError, inputHash: sha256(stableJson(missingPriceBars.find((bar) => bar.tradeDate === executionDate))) }
    ]
  };
  return { ...body, evidenceId: `quant-adverse-execution:${sha256(stableJson(body))}` };
}

function buildBenchmarkEvidence(source, sourceBytes, config, signalSnapshot, splitRuns, fullReplay) {
  if (source.schemaVersion !== "2026-08-17.futu-quant-benchmark.v1" || source.symbol !== "HK.800000"
    || !source.rights || Object.values(source.rights).some((status) => status !== "confirmed")
    || !Array.isArray(source.bars) || source.bars.length < signalSnapshot.bars.length
    || !Number.isFinite(Date.parse(source.asOf)) || !Number.isFinite(Date.parse(source.fetchedAt))
    || Date.parse(source.asOf) > Date.parse(source.fetchedAt)) throw new Error("benchmark source is malformed or unauthorized");
  const byDate = new Map(source.bars.map((bar) => [bar.tradeDate, bar]));
  if (!Array.isArray(source.completedTradingDates)
    || source.completedTradingDates.join("|") !== source.bars.map((bar) => bar.tradeDate).join("|")
    || byDate.size !== source.bars.length) throw new Error("benchmark session identities are malformed");
  const bars = signalSnapshot.bars.map((stockBar) => byDate.get(stockBar.tradeDate));
  if (bars.some((bar) => !bar || bar.symbol !== "HK.800000" || bar.adjustment !== "none"
    || ![bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value) && value > 0))) {
    throw new Error("benchmark bars do not exactly cover the stock research sessions");
  }
  const comparison = (id, start, end, run) => {
    const window = bars.filter((bar) => bar.tradeDate >= start && bar.tradeDate <= end);
    if (window.length < 2) throw new Error(`benchmark window ${id} is incomplete`);
    const benchmarkTotalReturn = round(window.at(-1).close / window[0].close - 1, 8);
    const simulatedStrategyTotalReturn = round(run.metrics.totalReturn, 8);
    return { id, start, end, simulatedStrategyTotalReturn, benchmarkTotalReturn, excessReturn: round(simulatedStrategyTotalReturn - benchmarkTotalReturn, 8), usedForParameterSelection: false };
  };
  const comparisons = config.splitRegistry.splits.map((split) => comparison(split.id, split.start, split.end, splitRuns[split.id]));
  comparisons.push(comparison("full_period", signalSnapshot.dateRange.start, signalSnapshot.dateRange.end, fullReplay));
  const body = {
    schemaVersion: "2026-08-17.hk-stock-benchmark-evidence.v1",
    benchmark: { symbol: source.symbol, name: source.name, sourcePath: config.benchmarkSourcePath, sourceSha256: sha256(sourceBytes), seriesHash: sha256(stableJson(bars)), asOf: source.asOf, fetchedAt: source.fetchedAt, observationStartDate: signalSnapshot.dateRange.start, observationEndDate: signalSnapshot.dateRange.end },
    calculationPolicy: "close_to_close_hsi_comparison_research_only",
    finalTestUsedForSelection: false,
    comparisons
  };
  return { ...body, evidenceId: `quant-benchmark:${sha256(stableJson(body))}` };
}

function buildManifest({ config, generatedAt, signalSnapshot, accounting, actions, binding, splitRuns, fullReplay, experimentRegistry, adverseCaseEvidence, benchmarkEvidence }) {
  if (!signalSnapshot.hkConnectUniverse) throw new Error("official Hong Kong Connect universe binding is required");
  if (signalSnapshot.universe.length !== 1) throw new Error("stock-level quant evidence requires exactly one canonical symbol");
  const target = signalSnapshot.universe[0];
  const symbol = target.symbol;
  const slug = symbol.toLowerCase().replace(".", "-");
  const combined = { signalSnapshotHash: signalSnapshot.snapshotHash, accountingDataHash: accounting.dataHash, corporateActionLedgerHash: actions.ledgerHash, benchmarkEvidenceId: benchmarkEvidence?.evidenceId ?? null, hkConnectUniverse: signalSnapshot.hkConnectUniverse };
  const dataHash = sha256(stableJson(combined));
  const identitySchema = symbol === "HK.00175" ? "2026-08-08.hk00175-dual-price-identity.v1" : "2026-08-17.hk-stock-dual-price-identity.v1";
  const snapshotHash = sha256(stableJson({ schemaVersion: identitySchema, ...combined, config: { splitRegistry: config.splitRegistry, signal: config.signal, execution: config.execution, fees: config.fees, dividendCashPolicy: config.dividendCashPolicy } }));
  const snapshotId = `hk-${symbol.toLowerCase()}-dual-${signalSnapshot.dateRange.start}-${signalSnapshot.dateRange.end}-${dataHash.slice(0, 12)}`;
  const experimentIdentity = sha256(stableJson({ snapshotHash, splitRegistry: config.splitRegistry, signal: config.signal, registeredAt: config.registeredAt }));
  const shadowPortfolioIdentity = sha256(stableJson({ experimentIdentity, snapshotHash, execution: config.execution, fees: config.fees }));
  const metrics = Object.fromEntries(Object.entries(splitRuns).map(([id, run]) => [id, metricsFor(run)]));
  const accountingAudit = Object.fromEntries(Object.entries(splitRuns).map(([id, run]) => [id, run.accountingAudit]));
  const dataIdentity = {
    snapshotId, snapshotHash, dataHash, dataCutoff: signalSnapshot.dataCutoff,
    dateRange: signalSnapshot.dateRange, universe: signalSnapshot.universe, adjustment: "forward",
    hkConnectUniverse: signalSnapshot.hkConnectUniverse,
    sourceClassification: "historical",
    sourceIdentity: { authority: "research_only", asOf: signalSnapshot.sourceIdentity.asOf, fetchedAt: signalSnapshot.sourceIdentity.fetchedAt, provenance: "owner_authorized_futu_qfq_none_rehab" },
    signalSnapshot: { snapshotId: signalSnapshot.snapshotId, snapshotHash: signalSnapshot.snapshotHash, dataHash: signalSnapshot.dataHash },
    accountingSnapshot: { snapshotId: accounting.snapshotId, dataHash: accounting.dataHash },
    corporateActionLedger: { ledgerId: actions.ledgerId, ledgerHash: actions.ledgerHash },
    benchmark: benchmarkEvidence ? { evidenceId: benchmarkEvidence.evidenceId, ...benchmarkEvidence.benchmark } : null
  };
  const authority = {
    type: "research_only_simulation", advisoryOnly: true, simulationOnly: true, liveHolding: false,
    brokerReconciliation: false, accountTruth: false, accountingAuthority: false, ranking: false,
    recommendation: false, score: false, allocation: false, sizing: false, targetPrice: false,
    buySellHold: false, orderInstruction: false, tradeInstruction: false, orderTradeFillAuthority: false,
    cashFeePositionMutation: false, brokerWrite: false, productionWrite: false,
    officialPortfolioFact: false, officialReviewFact: false
  };
  const shadowPortfolio = {
    shadowPortfolioId: `${slug}-shadow-research-dividend-payment-v2`, shadowPortfolioIdentity,
    experimentIdentity, splitIds: config.splitRegistry.splits.map(({ id }) => id),
    frozenSnapshotIdentity: { snapshotId, snapshotHash, dataHash }, authority,
    limitations: config.limitations
  };
  const baselinePolicy = {
    parameterPolicy: { ...config.parameterPolicy, registrationTiming: config.splitRegistry.registrationTiming },
    execution: config.execution, fees: config.fees, accountingAudit, limitations: config.limitations
  };
  const samples = config.splitRegistry.splits.map((split) => ({
    ...split,
    metrics: {
      simulatedTotalReturn: metrics[split.id].totalReturn,
      simulatedAnnualizedReturn: metrics[split.id].annualizedReturn,
      simulatedMaxDrawdown: metrics[split.id].maxDrawdown,
      simulatedSharpe: metrics[split.id].sharpe,
      simulatedTradeCount: metrics[split.id].tradeCount,
      simulatedClosedRoundTripCount: metrics[split.id].closedRoundTripCount,
      simulatedWinRate: metrics[split.id].winRate,
      simulatedTotalFees: metrics[split.id].totalFees,
      simulatedTurnoverOneWay: metrics[split.id].turnoverOneWay,
      simulatedAverageGrossExposure: metrics[split.id].averageGrossExposure,
      accountingAuditStatus: "passed"
    }
  }));
  const concentration = concentrationEvidence(fullReplay.trades);
  const benchmarkSummary = benchmarkEvidence?.comparisons.find((item) => item.id === "full_period");
  const formalEvidence = {
    candidateResearchRule: {
      ...config.candidateResearchRule,
      universeVersion: `${signalSnapshot.hkConnectUniverse.effectiveDate}:${signalSnapshot.hkConnectUniverse.snapshotId}`,
      cutoff: signalSnapshot.hkConnectUniverse.capturedAt,
      eligibilityEvidenceStatus: "available",
      limitations: [
        `${symbol} is present in the exact dated official Hong Kong Connect universe bound to this run; this does not prove historical eligibility on every backtest date.`,
        "The rule preserves source order and cannot rank, score, recommend, add membership, or trigger execution."
      ]
    },
    checks: [
      check("immutable_dataset", "available", `${snapshotId}:${snapshotHash}:${dataHash}`, "Frozen signal, unadjusted accounting, and corporate-action inputs are content-addressed by the manifest."),
      check("hong_kong_investable_universe", "available", `${signalSnapshot.hkConnectUniverse.effectiveDate}:${signalSnapshot.hkConnectUniverse.snapshotId}`, "The run is bound to the exact current dated official Hong Kong Connect universe; historical eligibility before that effective date remains unproven."),
      benchmarkEvidence
        ? check("benchmark", "available", benchmarkEvidence.evidenceId, `Full period: simulated strategy ${benchmarkSummary.simulatedStrategyTotalReturn}, HSI ${benchmarkSummary.benchmarkTotalReturn}, excess ${benchmarkSummary.excessReturn}; same-session content-addressed comparison only, and final_test remains report-only.`)
        : check("benchmark", "unknown", null, "No immutable benchmark series or benchmark calculation is bound to this run."),
      check("raw_corporate_actions", "available", `${actions.ledgerId}:${actions.ledgerHash}`, "Futu ex-dividend rows remain separate from issuer PDF payment-date and approval evidence in the content-addressed v2 ledger."),
      check("t_plus_one", "available", "after_close_t:next_trading_day_open", "Signals generated after close t can execute no earlier than the next trading-day open."),
      check("board_lot", "available", `${symbol}:${target.lotSize}`, "Every simulated order is rounded to the bound Hong Kong board lot."),
      check("non_zero_costs", "available", `fee-policy:${sha256(stableJson(config.fees))}`, "Commission, platform fee, stamp duty, trading fee, and transaction levy are non-zero where applicable."),
      check("suspension_zero_volume_missing_price", "available", adverseCaseEvidence.evidenceId, "A deterministic same-snapshot replay blocks zero-volume/suspension execution and rejects a missing execution price."),
      check("cash_position_accounting", "available", `accounting-audit:${sha256(stableJson(accountingAudit))}`, "All train, validation, and final-test cash, receivable, position, fee, NAV, and payment-timing audits passed deterministic replay."),
      check("out_of_sample", "available", `split-registry:${sha256(stableJson(config.splitRegistry))}`, "The final-test window is locked report-only and excluded from parameter and acceptance-threshold selection; all windows remain retrospective."),
      check("parameter_search", "available", experimentRegistry.registryId, "The baseline and diagnostic alternatives are registered with train+validation metrics; final_test is excluded from selection."),
      check("failed_experiments", "available", experimentRegistry.failedExperimentsId, "Rejected diagnostic alternatives are preserved and cannot disappear from the run."),
      concentration
        ? check("trade_stock_month_concentration", "available", `concentration:${sha256(stableJson(concentration))}`, `Gross-notional concentration: largest trade ${concentration.largestTradeShare}, single-stock share ${concentration.largestStockShare}, largest month ${concentration.largestMonthShare}.`)
        : check("trade_stock_month_concentration", "unknown", null, "No executed simulated trades exist from which to calculate trade, stock, and month concentration.")
    ]
  };
  const decisionEvidence = {
    schemaVersion: "2026-07-16.quant-decision-evidence-refinement.v1", status: "available", refinementId: null, symbol,
    source: { snapshotId, snapshotHash, dataHash, sourceClassification: "historical", adjustment: "forward", dataCutoff: signalSnapshot.dataCutoff, observationStartDate: signalSnapshot.dateRange.start, observationEndDate: signalSnapshot.dateRange.end, baselineExperimentIdentity: experimentIdentity, shadowPortfolioIdentity },
    samples,
    execution: { signalTiming: "after_close_t", earliestExecution: "next_trading_day_open", allowsSameBarExecution: false, allowsMargin: false, boardLot: target.lotSize, feeCurrency: "HKD", nonZeroCosts: true, suspensionHandling: "reject_execution", zeroVolumeHandling: "reject_execution", missingPriceHandling: "reject_execution" },
    robustness: { registrationTiming: "retrospective_after_snapshot", preregistered: false, prospectiveHoldoutClaim: false, finalTestUsedForParameterSelection: false, finalTestUsedForAcceptanceThresholdFitting: false, allSplitAccountingAuditsPassed: true, failedExperiments: { status: "registered", experimentIds: experimentRegistry.experiments.filter((item) => item.disposition === "rejected").map((item) => item.id), limitation: "Every registered diagnostic alternative and rejection is preserved; final_test remained locked report-only." } },
    formalEvidence,
    interpretation: "historical_simulation_only_no_predictive_or_recommendation_authority",
    limitations: config.limitations
  };
  const refinementIdentity = { ...decisionEvidence };
  delete refinementIdentity.refinementId;
  decisionEvidence.refinementId = `quant-decision-evidence:${sha256(stableJson(refinementIdentity))}`;
  return {
    manifest: { schemaVersion: "2026-10-10.hk-stock-quant-dividend-payment-manifest.v2", ok: true, generatedAt, feePolicyVersion: FEE_POLICY_VERSION, feePolicySha256: feePolicySha256(), dividendCashPolicy: { ...DIVIDEND_CASH_POLICY, sha256: DIVIDEND_CASH_POLICY_SHA256, ledgerHash: actions.ledgerHash, accountingAuditSha256: sha256(stableJson(accountingAudit)) }, executionCalendar: { timing: "next_observed_session_open", calendarCompleteness: "unknown" }, dataIdentity, experimentIdentity, shadowPortfolioIdentity, splitRegistry: config.splitRegistry, baselinePolicy, metrics, experimentRegistry, adverseCaseEvidence, benchmarkEvidence, shadowPortfolio, formalEvidence, decisionEvidence },
    replay: { schemaVersion: "2026-10-10.hk-stock-formal-replay-dividend-payment.v2", generatedAt, binding, splitRuns, fullReplay, authority }
  };
}

function check(id, status, identity, limitation) {
  return { id, status, identity, limitation };
}

function concentrationEvidence(trades) {
  const total = trades.reduce((sum, trade) => sum + trade.grossAmount, 0);
  if (!(total > 0)) return null;
  const monthTotals = new Map();
  for (const trade of trades) {
    const month = trade.tradeDate.slice(0, 7);
    monthTotals.set(month, (monthTotals.get(month) ?? 0) + trade.grossAmount);
  }
  return {
    largestTradeShare: round(Math.max(...trades.map((trade) => trade.grossAmount)) / total, 8),
    largestStockShare: 1,
    largestMonthShare: round(Math.max(...monthTotals.values()) / total, 8)
  };
}

function metricsFor(run) {
  const closedReturns = closedRoundTripReturns(run.trades);
  const annualizedReturn = run.metrics.totalReturn <= -1
    ? -1
    : (1 + run.metrics.totalReturn) ** (252 / Math.max(run.nav.length, 1)) - 1;
  return {
    ...run.metrics,
    annualizedReturn: round(annualizedReturn, 8),
    closedRoundTripCount: closedReturns.length,
    winRate: closedReturns.length === 0 ? 0 : round(closedReturns.filter((value) => value > 0).length / closedReturns.length, 8),
    averageGrossExposure: round(run.nav.reduce((sum, row) => sum + (row.equity > 0 ? Math.abs(row.marketValue) / row.equity : 0), 0) / Math.max(run.nav.length, 1), 8),
    accountingAuditStatus: "passed"
  };
}

function closedRoundTripReturns(trades) {
  const returns = [];
  let openCost = 0;
  let openQuantity = 0;
  for (const trade of trades) {
    if (trade.side === "buy") {
      openCost += -trade.netCashChange;
      openQuantity += trade.quantity;
    } else if (trade.side === "sell" && openQuantity > 0) {
      const quantity = Math.min(openQuantity, trade.quantity);
      const cost = openCost * quantity / openQuantity;
      const proceeds = trade.netCashChange * quantity / trade.quantity;
      returns.push((proceeds - cost) / cost);
      openCost -= cost;
      openQuantity -= quantity;
    }
  }
  return returns;
}

function corporateActionEvents(rows, tradingDates, dateRange, symbol) {
  const code = symbol.slice(3);
  const dates = new Set(tradingDates);
  const events = [];
  for (const row of rows.filter((item) => item.ex_div_date >= dateRange.start && item.ex_div_date <= dateRange.end)) {
    if (!dates.has(row.ex_div_date)) throw new Error(`corporate action ${row.ex_div_date} is outside completed trading dates`);
    const unsupported = ["split_base", "split_ert", "bonus_base", "bonus_ert", "transfer_base", "transfer_ert", "allot_base", "allot_ert", "add_base", "add_ert", "spin_off_base", "spin_off_ert"].some((key) => row[key] !== null);
    if (unsupported) throw new Error(`unsupported non-cash corporate action at ${row.ex_div_date}`);
    for (const [kind, amount] of [["ordinary", row.per_cash_div], ["special", row.special_dividend]]) {
      if (amount === null) continue;
      if (!(Number.isFinite(amount) && amount >= 0)) throw new Error(`invalid ${kind} dividend at ${row.ex_div_date}`);
      const recordHash = sha256(stableJson(row));
      events.push({ eventId: `futu-rehab-hk-${code}-${row.ex_div_date}-${kind}-${recordHash.slice(0, 12)}`, market: "HK", code, exDate: row.ex_div_date, actionType: "cash_dividend", cashAmount: amount, currency: "HKD", splitNumerator: null, splitDenominator: null, sourceRecordHash: recordHash });
    }
  }
  return events.sort((a, b) => `${a.exDate}.${a.eventId}`.localeCompare(`${b.exDate}.${b.eventId}`));
}

function validateCapture(value) {
  if (value.schemaVersion !== "2026-08-08.futu-quant-opend-capture.v1" || !/^HK\.\d{5}$/.test(value.symbol) || !Number.isSafeInteger(value.lotSize) || value.lotSize <= 0) throw new Error("capture identity or lot size is invalid");
  if (!value.rights || Object.values(value.rights).some((status) => status !== "confirmed")) throw new Error("capture rights, retention and derived use must be confirmed");
  if (!Array.isArray(value.qfqBars) || value.qfqBars.length < 120 || value.qfqBars.length !== value.unadjustedBars?.length || value.qfqBars.length !== value.completedTradingDates?.length) throw new Error("capture requires at least 120 aligned QFQ and unadjusted bars");
  const qfq = value.qfqBars.map((bar) => bar.tradeDate);
  const raw = value.unadjustedBars.map((bar) => bar.tradeDate);
  if (qfq.join("|") !== raw.join("|") || qfq.join("|") !== value.completedTradingDates.join("|")) throw new Error("capture bar identities are not exact");
  if ([...value.qfqBars, ...value.unadjustedBars].some((bar) => `${bar.market}.${bar.code}` !== value.symbol)) throw new Error("capture bars do not bind the requested symbol");
  if (!Number.isFinite(Date.parse(value.asOf)) || !Number.isFinite(Date.parse(value.fetchedAt)) || Date.parse(value.asOf) > Date.parse(value.fetchedAt)) throw new Error("capture chronology is invalid");
}

function thirds(dates) {
  const first = Math.floor(dates.length / 3);
  const second = Math.floor((dates.length * 2) / 3);
  return [
    { id: "train", role: "retrospective_parameter_registration_and_sanity", start: dates[0], end: dates[first - 1], parameterSelectionAllowed: true, finalTestLocked: false },
    { id: "validation", role: "retrospective_validation", start: dates[first], end: dates[second - 1], parameterSelectionAllowed: true, finalTestLocked: false },
    { id: "final_test", role: "locked_report_only", start: dates[second], end: dates.at(-1), parameterSelectionAllowed: false, finalTestLocked: true }
  ];
}

async function writeNew(path, value) {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, canonicalJsonBytes(value), { flag: "wx" });
}

async function runJson(command, args, environment) {
  const result = await execFileAsync(command, args, { cwd: root, env: { ...process.env, ...environment }, maxBuffer: 40 * 1024 * 1024 });
  return JSON.parse(result.stdout);
}

function stableJson(value) { return JSON.stringify(sortJson(value)); }
function sortJson(value) { return Array.isArray(value) ? value.map(sortJson) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])])) : value; }
function round(value, digits) { return Number(Number(value).toFixed(digits)); }
