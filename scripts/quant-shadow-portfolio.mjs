#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = process.env.QUANT_SHADOW_PORTFOLIO_CONFIG ?? "config/quant-shadow-portfolio.hk-09926.json";
const config = JSON.parse(await readText(configPath));
const outputDir = resolvePath(config.outputDir ?? "artifacts/quant-shadow-portfolio/latest");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const configQuality = checkConfig(config);
if (!configQuality.ok) {
  await writeJson("config-quality.json", configQuality);
  fail("no_go_fix_quant_shadow_portfolio_config", { configQuality });
}

const baseline = await runJson("npm", ["run", "quant-sample-split-baseline"], {
  QUANT_SAMPLE_SPLIT_BASELINE_CONFIG: config.baselineConfigPath
});
const baselineManifest = JSON.parse(await readText(join(baseline.outputDir, "run_manifest.json")));
const baselineQuality = checkBaseline(baseline, baselineManifest);
if (!baselineQuality.ok) {
  await writeJson("config-quality.json", configQuality);
  await writeJson("baseline-quality.json", baselineQuality);
  fail("no_go_fix_quant_shadow_portfolio_baseline", { baselineQuality });
}

const sourceScan = await scanSources();
const configHash = await hashFile(configPath);
const codeIdentity = {
  commit: gitHead(),
  scriptPath: "scripts/quant-shadow-portfolio.mjs",
  scriptHash: await hashFile("scripts/quant-shadow-portfolio.mjs")
};
const shadowPortfolioIdentity = sha256(stableJson({
  schemaVersion: "2026-07-09.quant-shadow-portfolio-identity.v1",
  shadowPortfolio: config.shadowPortfolio,
  dataIdentity: baselineManifest.dataIdentity,
  experimentIdentity: baselineManifest.experimentIdentity,
  splitRegistry: baselineManifest.splitRegistry,
  configHash,
  codeIdentity
}));

const shadowArtifacts = buildShadowArtifacts(baselineManifest, config, shadowPortfolioIdentity);
const baselinePolicy = buildBaselinePolicy(baselineManifest);
const decisionEvidence = buildDecisionEvidence(baselineManifest, config, shadowPortfolioIdentity);
const isolationAudit = auditIsolation(shadowArtifacts, config, baselineManifest);
const failureReport = buildFailureReport({ configQuality, baselineQuality, sourceScan, isolationAudit });
const result = {
  schemaVersion: "2026-07-09.quant-shadow-portfolio.run.v1",
  ok: failureReport.blockers.length === 0,
  goNoGo: failureReport.blockers.length === 0
    ? "quant_shadow_portfolio_foundation_passed"
    : "no_go_fix_quant_shadow_portfolio",
  generatedAt: config.shadowPortfolio.registeredAt,
  configPath,
  configHash,
  codeIdentity,
  shadowPortfolioIdentity,
  baseline: {
    command: "npm run quant-sample-split-baseline",
    outputDir: baseline.outputDir,
    experimentIdentity: baselineManifest.experimentIdentity,
    snapshotId: baselineManifest.dataIdentity.snapshotId,
    snapshotHash: baselineManifest.dataIdentity.snapshotHash,
    dataHash: baselineManifest.dataIdentity.dataHash
  },
  dataIdentity: baselineManifest.dataIdentity,
  experimentIdentity: baselineManifest.experimentIdentity,
  splitRegistry: baselineManifest.splitRegistry,
  baselinePolicy,
  shadowPortfolio: shadowArtifacts.shadowPortfolio,
  metrics: shadowArtifacts.metrics,
  decisionEvidence,
  isolationAudit,
  failureReport,
  authority: shadowArtifacts.authority,
  safety: shadowArtifacts.safety,
  artifacts: [
    "run_manifest.json",
    "config-quality.json",
    "baseline-quality.json",
    "shadow-portfolio.json",
    "shadow-orders.json",
    "shadow-trades.json",
    "shadow-positions.json",
    "shadow-nav.json",
    "decision-evidence.json",
    "simulation-isolation.json",
    "failure-report.json",
    "research-evidence.json"
  ]
};

await writeJson("config-quality.json", configQuality);
await writeJson("baseline-quality.json", baselineQuality);
await writeJson("shadow-portfolio.json", shadowArtifacts.shadowPortfolio);
await writeJson("shadow-orders.json", shadowArtifacts.orders);
await writeJson("shadow-trades.json", shadowArtifacts.trades);
await writeJson("shadow-positions.json", shadowArtifacts.positions);
await writeJson("shadow-nav.json", shadowArtifacts.nav);
await writeJson("decision-evidence.json", decisionEvidence);
await writeJson("simulation-isolation.json", isolationAudit);
await writeJson("failure-report.json", failureReport);
await writeJson("research-evidence.json", {
  shadowPortfolioIdentity,
  dataIdentity: baselineManifest.dataIdentity,
  experimentIdentity: baselineManifest.experimentIdentity,
  splitRegistry: baselineManifest.splitRegistry,
  shadowPortfolio: shadowArtifacts.shadowPortfolio,
  metrics: shadowArtifacts.metrics,
  decisionEvidence,
  limitations: config.limitations,
  authority: shadowArtifacts.authority,
  safety: shadowArtifacts.safety
});
await writeJson("run_manifest.json", result);

console.log(JSON.stringify({
  ok: result.ok,
  goNoGo: result.goNoGo,
  outputDir: relative(outputDir),
  shadowPortfolioIdentity,
  snapshotId: baselineManifest.dataIdentity.snapshotId,
  experimentIdentity: baselineManifest.experimentIdentity,
  splitIds: baselineManifest.splitRegistry.splits.map((split) => split.id),
  refinementId: decisionEvidence.refinementId,
  shadowOrderCount: shadowArtifacts.orders.length,
  shadowTradeCount: shadowArtifacts.trades.length,
  shadowPositionRows: shadowArtifacts.positions.length,
  shadowNavRows: shadowArtifacts.nav.length,
  isolationAudit,
  failureReport,
  authority: shadowArtifacts.authority,
  safety: shadowArtifacts.safety
}, null, 2));

if (!result.ok) process.exit(1);

function checkConfig(cfg) {
  const issues = [];
  if (cfg.schemaVersion !== "2026-07-09.quant-shadow-portfolio.v1") {
    issues.push({ level: "error", type: "invalid_schema_version", schemaVersion: cfg.schemaVersion });
  }
  for (const field of ["baselineConfigPath", "outputDir"]) {
    if (typeof cfg[field] !== "string" || cfg[field].trim() === "") issues.push({ level: "error", type: "missing_config_field", field });
  }
  for (const field of ["shadowPortfolioId", "registeredAt", "purpose", "authority", "source"]) {
    if (typeof cfg.shadowPortfolio?.[field] !== "string" || cfg.shadowPortfolio[field].trim() === "") {
      issues.push({ level: "error", type: "missing_shadow_portfolio_field", field });
    }
  }
  if (!isStrictIsoInstant(cfg.shadowPortfolio?.registeredAt)) {
    issues.push({ level: "error", type: "invalid_shadow_registered_at", registeredAt: cfg.shadowPortfolio?.registeredAt });
  }
  if (cfg.shadowPortfolio?.authority !== "research_only_simulation") {
    issues.push({ level: "error", type: "invalid_shadow_authority", authority: cfg.shadowPortfolio?.authority });
  }
  const policy = cfg.isolationPolicy ?? {};
  for (const field of [
    "officialPortfolioFact",
    "officialReviewFact",
    "brokerWrite",
    "productionWrite",
    "accountingAuthority",
    "cashFeePositionMutation",
    "recommendation",
    "ranking",
    "score",
    "allocation",
    "sizing",
    "targetPrice",
    "buySellHold",
    "orderTradeFillAuthority"
  ]) {
    if (policy[field] !== false) issues.push({ level: "error", type: "unsafe_isolation_policy", field, value: policy[field] });
  }
  if (!Array.isArray(cfg.limitations) || cfg.limitations.length === 0) {
    issues.push({ level: "error", type: "missing_limitations" });
  }
  return { ok: issues.every((issue) => issue.level !== "error"), issues };
}

function checkBaseline(summary, manifest) {
  const issues = [];
  if (summary.ok !== true || manifest.ok !== true) issues.push({ level: "error", type: "baseline_not_ok" });
  if (manifest.goNoGo !== "quant_sample_split_baseline_foundation_passed") issues.push({ level: "error", type: "baseline_not_accepted", goNoGo: manifest.goNoGo });
  if (manifest.researchAuthority?.type !== "research_evidence_only") issues.push({ level: "error", type: "baseline_not_research_evidence_only" });
  for (const field of ["recommendation", "ranking", "score", "allocation", "sizing", "targetPrice", "buySellHold", "orderTradeFill", "cashFeePositionMutation", "brokerWrite", "productionWrite", "officialPortfolioFact", "officialReviewFact"]) {
    if (manifest.researchAuthority?.[field] !== false) issues.push({ level: "error", type: "baseline_unsafe_authority", field, value: manifest.researchAuthority?.[field] });
  }
  if (manifest.parameterPolicy?.finalTestUsedForParameterSelection !== false) issues.push({ level: "error", type: "baseline_final_test_tuning" });
  if (manifest.parameterPolicy?.finalTestUsedForAcceptanceThresholdFitting !== false) issues.push({ level: "error", type: "baseline_final_test_threshold_fitting" });
  if (manifest.safety?.sendsLiveNetworkRequests !== false || manifest.safety?.writesProductionDatabase !== false || manifest.safety?.enablesTrading !== false) {
    issues.push({ level: "error", type: "baseline_unsafe_safety", safety: manifest.safety });
  }
  return { ok: issues.every((issue) => issue.level !== "error"), issues };
}

function buildShadowArtifacts(manifest, cfg, identity) {
  const authority = {
    type: "research_only_simulation",
    advisoryOnly: true,
    simulationOnly: true,
    liveHolding: false,
    brokerReconciliation: false,
    accountTruth: false,
    accountingAuthority: false,
    ranking: false,
    recommendation: false,
    score: false,
    allocation: false,
    sizing: false,
    targetPrice: false,
    buySellHold: false,
    orderInstruction: false,
    tradeInstruction: false,
    orderTradeFillAuthority: false,
    cashFeePositionMutation: false,
    brokerWrite: false,
    productionWrite: false,
    officialPortfolioFact: false,
    officialReviewFact: false
  };
  const safety = {
    readsBaselineResearchEvidence: true,
    sendsLiveNetworkRequests: false,
    writesProductionDatabase: false,
    enablesTrading: false,
    initializesBrokerGateway: false,
    mutatesOfficialPortfolio: false,
    mutatesOfficialReview: false,
    mutatesOfficialCashFeesPositions: false,
    touchesRealTradesPositionsReviews: false
  };
  const orders = [];
  const trades = [];
  const positions = [];
  const nav = [];
  for (const [splitId, run] of Object.entries(manifest.splitRuns)) {
    for (const order of run.orders) {
      orders.push({
        shadowOrderId: `shadow-order-${splitId}-${order.signalDate}-${order.tradeDate}-${order.side}`,
        splitId,
        symbol: `${manifest.dataIdentity.universe[0].market}.${manifest.dataIdentity.universe[0].code}`,
        signalDate: order.signalDate,
        simulationDate: order.tradeDate,
        side: order.side,
        quantity: order.quantity,
        boardLot: order.boardLot,
        roundedToBoardLot: order.roundedToBoardLot,
        sameBarExecution: order.sameBarExecution,
        simulatedPrice: order.price,
        authority
      });
    }
    for (const trade of run.trades) {
      trades.push({
        shadowTradeId: `shadow-trade-${splitId}-${trade.signalDate}-${trade.tradeDate}-${trade.side}`,
        splitId,
        symbol: `${manifest.dataIdentity.universe[0].market}.${manifest.dataIdentity.universe[0].code}`,
        signalDate: trade.signalDate,
        simulationDate: trade.tradeDate,
        side: trade.side,
        quantity: trade.quantity,
        boardLot: trade.boardLot,
        roundedToBoardLot: trade.roundedToBoardLot,
        sameBarExecution: trade.sameBarExecution,
        simulatedPrice: trade.price,
        gross: trade.gross,
        fees: {
          commission: trade.commission,
          platformFee: trade.platformFee,
          stampDuty: trade.stampDuty,
          tradingFee: trade.tradingFee,
          transactionLevy: trade.transactionLevy
        },
        totalFees: trade.totalFees,
        authority
      });
    }
    for (const row of run.nav) {
      positions.push({
        shadowPositionId: `shadow-position-${splitId}-${row.tradeDate}`,
        splitId,
        symbol: `${manifest.dataIdentity.universe[0].market}.${manifest.dataIdentity.universe[0].code}`,
        simulationDate: row.tradeDate,
        simulatedQuantity: row.position,
        simulatedClose: row.close,
        simulatedMarketValue: row.marketValue,
        liveHolding: false,
        officialPortfolioFact: false,
        brokerReconciliation: false,
        authority
      });
      nav.push({
        shadowNavId: `shadow-nav-${splitId}-${row.tradeDate}`,
        splitId,
        simulationDate: row.tradeDate,
        simulatedCash: row.cash,
        simulatedMarketValue: row.marketValue,
        simulatedEquity: row.equity,
        simulatedGrossExposure: row.grossExposure,
        officialCashFact: false,
        officialFeeFact: false,
        officialPositionFact: false,
        accountingAuthority: false,
        authority
      });
    }
  }
  return {
    shadowPortfolio: {
      schemaVersion: "2026-07-09.quant-shadow-portfolio.schema.v1",
      shadowPortfolioIdentity: identity,
      shadowPortfolioId: cfg.shadowPortfolio.shadowPortfolioId,
      registeredAt: cfg.shadowPortfolio.registeredAt,
      purpose: cfg.shadowPortfolio.purpose,
      source: cfg.shadowPortfolio.source,
      sourceClassification: manifest.dataIdentity.sourceClassification,
      frozenSnapshotIdentity: {
        snapshotId: manifest.dataIdentity.snapshotId,
        snapshotHash: manifest.dataIdentity.snapshotHash,
        dataHash: manifest.dataIdentity.dataHash,
        sourceIdentity: manifest.dataIdentity.sourceIdentity
      },
      experimentIdentity: manifest.experimentIdentity,
      splitIds: manifest.splitRegistry.splits.map((split) => split.id),
      authority,
      safety,
      limitations: cfg.limitations
    },
    orders,
    trades,
    positions,
    nav,
    metrics: manifest.metrics,
    authority,
    safety
  };
}

function buildBaselinePolicy(manifest) {
  return {
    parameterPolicy: manifest.parameterPolicy,
    execution: manifest.execution,
    fees: manifest.fees,
    accountingAudit: manifest.accountingAudit,
    limitations: manifest.limitations
  };
}

function buildDecisionEvidence(manifest, cfg, identity) {
  const universe = manifest.dataIdentity.universe;
  const symbol = `${universe[0].market}.${universe[0].code}`;
  const feeTotal = Object.values(manifest.fees).reduce((total, value) => total + Number(value ?? 0), 0);
  const allAuditsPassed = Object.values(manifest.accountingAudit).every((audit) => audit.ok === true);
  const nonZeroCosts = feeTotal > 0 && Object.values(manifest.metrics).every((metrics) => (
    metrics.tradeCount === 0 || metrics.totalFees > 0
  ));
  const draft = {
    schemaVersion: "2026-07-16.quant-decision-evidence-refinement.v1",
    status: "available",
    refinementId: null,
    symbol,
    source: {
      snapshotId: manifest.dataIdentity.snapshotId,
      snapshotHash: manifest.dataIdentity.snapshotHash,
      dataHash: manifest.dataIdentity.dataHash,
      sourceClassification: manifest.dataIdentity.sourceClassification,
      adjustment: manifest.dataIdentity.adjustment,
      dataCutoff: manifest.dataIdentity.dataCutoff,
      observationStartDate: manifest.dataIdentity.dateRange.start,
      observationEndDate: manifest.dataIdentity.dateRange.end,
      baselineExperimentIdentity: manifest.experimentIdentity,
      shadowPortfolioIdentity: identity
    },
    samples: manifest.splitRegistry.splits.map((split) => {
      const metrics = manifest.metrics[split.id];
      return {
        id: split.id,
        role: split.role,
        start: split.start,
        end: split.end,
        parameterSelectionAllowed: split.parameterSelectionAllowed,
        finalTestLocked: split.finalTestLocked,
        metrics: {
          simulatedTotalReturn: metrics.totalReturn,
          simulatedMaxDrawdown: metrics.maxDrawdown,
          simulatedSharpe: metrics.sharpe,
          simulatedTradeCount: metrics.tradeCount,
          simulatedTotalFees: metrics.totalFees,
          simulatedTurnoverOneWay: metrics.turnoverOneWay,
          simulatedAverageGrossExposure: metrics.averageGrossExposure,
          accountingAuditStatus: metrics.accountingAuditStatus
        }
      };
    }),
    execution: {
      signalTiming: manifest.execution.signalTiming,
      earliestExecution: manifest.execution.earliestExecution,
      allowsSameBarExecution: manifest.execution.allowSameBarExecution,
      allowsMargin: manifest.execution.allowMargin,
      boardLot: Number(universe[0].lotSize),
      feeCurrency: "HKD",
      nonZeroCosts,
      suspensionHandling: "reject_execution",
      zeroVolumeHandling: "reject_execution",
      missingPriceHandling: "reject_execution"
    },
    robustness: {
      registrationTiming: manifest.parameterPolicy.registrationTiming,
      preregistered: manifest.parameterPolicy.preregistered,
      prospectiveHoldoutClaim: manifest.parameterPolicy.prospectiveHoldoutClaim,
      finalTestUsedForParameterSelection: manifest.parameterPolicy.finalTestUsedForParameterSelection,
      finalTestUsedForAcceptanceThresholdFitting: manifest.parameterPolicy.finalTestUsedForAcceptanceThresholdFitting,
      allSplitAccountingAuditsPassed: allAuditsPassed,
      failedExperiments: {
        status: "not_captured",
        experimentIds: [],
        limitation: "This fixture baseline did not register alternative failed experiments; none are inferred or hidden behind the accepted run."
      }
    },
    interpretation: "historical_simulation_only_no_predictive_or_recommendation_authority",
    limitations: [...new Set([
      ...manifest.limitations,
      ...cfg.limitations,
      "Sample metrics are isolated historical simulation outputs, not current facts, forecasts, attribution, recommendations, rankings, or expected returns."
    ])]
  };
  const { refinementId: _refinementId, ...identityInput } = draft;
  return {
    ...draft,
    refinementId: `quant-decision-evidence:${sha256(stableJson(identityInput))}`
  };
}

function auditIsolation(artifacts, cfg, manifest) {
  const issues = [];
  const allAuthorityItems = [
    artifacts.shadowPortfolio,
    ...artifacts.orders,
    ...artifacts.trades,
    ...artifacts.positions,
    ...artifacts.nav
  ];
  for (const item of allAuthorityItems) {
    const authority = item.authority ?? {};
    for (const field of ["officialPortfolioFact", "officialReviewFact", "brokerWrite", "productionWrite", "cashFeePositionMutation"]) {
      if (authority[field] !== false) issues.push({ type: "unsafe_authority", field, item: item.shadowPortfolioId ?? item.shadowOrderId ?? item.shadowTradeId ?? item.shadowPositionId ?? item.shadowNavId });
    }
    if (authority.type !== "research_only_simulation" && item !== artifacts.shadowPortfolio) {
      issues.push({ type: "invalid_item_authority_type", item: item.shadowOrderId ?? item.shadowTradeId ?? item.shadowPositionId ?? item.shadowNavId });
    }
  }
  if (artifacts.shadowPortfolio.frozenSnapshotIdentity.snapshotId !== manifest.dataIdentity.snapshotId) issues.push({ type: "snapshot_identity_mismatch" });
  if (artifacts.shadowPortfolio.experimentIdentity !== manifest.experimentIdentity) issues.push({ type: "experiment_identity_mismatch" });
  if (artifacts.orders.some((order) => order.sameBarExecution !== false || order.roundedToBoardLot !== true)) issues.push({ type: "order_execution_or_lot_boundary" });
  if (artifacts.trades.some((trade) => trade.sameBarExecution !== false || trade.totalFees <= 0)) issues.push({ type: "trade_fee_or_execution_boundary" });
  if (artifacts.positions.some((position) => position.liveHolding !== false || position.officialPortfolioFact !== false || position.brokerReconciliation !== false)) issues.push({ type: "position_display_boundary" });
  if (artifacts.nav.some((row) => row.officialCashFact !== false || row.officialFeeFact !== false || row.officialPositionFact !== false || row.accountingAuthority !== false)) issues.push({ type: "nav_official_fact_boundary" });
  if (Object.values(cfg.isolationPolicy).some((value) => value !== false)) issues.push({ type: "config_isolation_policy_not_false" });
  return {
    ok: issues.length === 0,
    hiddenFailures: false,
    blockedSimulationsRecorded: true,
    officialPortfolioIsolation: true,
    officialReviewIsolation: true,
    brokerIsolation: true,
    accountingIsolation: true,
    productionIsolation: true,
    issues
  };
}

function buildFailureReport({ configQuality, baselineQuality, sourceScan, isolationAudit }) {
  const blockers = [];
  if (!configQuality.ok) blockers.push({ id: "config_quality", source: "config-quality.json" });
  if (!baselineQuality.ok) blockers.push({ id: "baseline_quality", source: "baseline-quality.json" });
  if (sourceScan.errors.length > 0) blockers.push({ id: "source_scan", source: "scripts/quant-shadow-portfolio.mjs" });
  if (!isolationAudit.ok) blockers.push({ id: "simulation_isolation", source: "simulation-isolation.json" });
  return {
    ok: blockers.length === 0,
    hiddenFailures: false,
    blockedSimulationsRecorded: true,
    blockers,
    warnings: sourceScan.warnings
  };
}

async function scanSources() {
  const files = [
    "scripts/quant-shadow-portfolio.mjs",
    "config/quant-shadow-portfolio.hk-09926.json"
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
  const errors = [];
  const warnings = [];
  for (const file of files) {
    const lines = (await readText(file)).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const [rule, pattern] of rules) {
        if (pattern.test(line)) warnings.push({ file, line: index + 1, rule, reason: "detector text or protected boundary wording" });
      }
    });
  }
  return { ok: errors.length === 0, errors, warnings };
}

async function runJson(command, args, env) {
  const result = await execFileAsync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    maxBuffer: 80 * 1024 * 1024
  });
  const trimmed = result.stdout.trim();
  const start = trimmed.lastIndexOf("\n{");
  return JSON.parse(start >= 0 ? trimmed.slice(start + 1) : trimmed);
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

function isStrictIsoInstant(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(value))) return false;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
