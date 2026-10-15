#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";
import {
  sha256,
  validateFormalAccountingBinding
} from "./lib/real-data-quant-evidence.mjs";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactRoot = resolve(root, "artifacts/stage-13-20/real-data-quant");
const primaryDir = resolve(artifactRoot, "pipeline/smoke");
export const pipelineConfigPath = "config/quant-pipeline.pingan-hk-09926.json";
export const formalAccountingReplayEngineStatus = "blocked_missing_raw_replay_engine";
export const experiments = [
  {
    id: "high_turnover_cost_rejection",
    config: "config/quant-smoke.pingan-hk-09926-high-turnover.json",
    rejectedWhen: (metrics) => metrics.totalFees > 50_000,
    criterion: "totalFees > 50000",
    expectedRejected: false
  },
  {
    id: "sparse_observation_rejection",
    config: "config/quant-smoke.pingan-hk-09926-sparse.json",
    rejectedWhen: (metrics) => metrics.tradeCount < 30,
    criterion: "tradeCount < 30",
    expectedRejected: false
  },
  {
    id: "zero_threshold_cost_rejection",
    config: "config/quant-smoke.pingan-hk-09926-zero-threshold.json",
    rejectedWhen: (metrics) => metrics.totalFees > 42_000,
    criterion: "totalFees > 42000",
    expectedRejected: true
  },
  {
    id: "ultra_sparse_observation_rejection",
    config: "config/quant-smoke.pingan-hk-09926-ultra-sparse.json",
    rejectedWhen: (metrics) => metrics.tradeCount < 10,
    criterion: "tradeCount < 10",
    expectedRejected: true
  }
];

export async function runRequiredQuantConfigurations({
  runPipeline = runQuantPipeline,
  runSmoke = runQuantSmoke
} = {}) {
  await runPipeline(pipelineConfigPath);
  for (const experiment of experiments) await runSmoke(experiment.config);
}

export async function generateRealDataQuantSummary({
  preflight = preflightRealDataFormalAccounting,
  runConfigurations = runRequiredQuantConfigurations
} = {}) {
  const preflightResult = await preflight();
  await runConfigurations();

  const failedExperiments = [];
  for (const experiment of experiments) {
    const config = JSON.parse(await readFile(resolve(root, experiment.config), "utf8"));
    const manifest = JSON.parse(await readFile(resolve(root, config.outputDir, "run_manifest.json"), "utf8"));
    const rejected = experiment.rejectedWhen(manifest.metrics);
    failedExperiments.push({
      id: experiment.id,
      experimentId: config.experiment.experimentId,
      criterion: experiment.criterion,
      rejected,
      expectedRejected: experiment.expectedRejected,
      metrics: manifest.metrics,
      tuningImpact: "none_final_test_remained_locked"
    });
  }

  const primaryManifest = JSON.parse(await readFile(resolve(primaryDir, "run_manifest.json"), "utf8"));
  const frozenSnapshot = JSON.parse(await readFile(resolve(root, primaryManifest.snapshotPath), "utf8"));
  const approvedInput = JSON.parse(await readFile(resolve(root, frozenSnapshot.sourcePath), "utf8"));
  const corporateActionPolicy = requireQfqResearchBoundary(approvedInput);
  const formalAccounting = validateFormalAccountingBinding(approvedInput.formalAccounting, {
    expectedDataCutoff: frozenSnapshot.dataCutoff,
    expectedSignalSnapshot: {
      adjustmentMode: frozenSnapshot.adjustment,
      dataHash: frozenSnapshot.dataHash,
      path: frozenSnapshot.sourcePath,
      sha256: frozenSnapshot.sourceHash,
      snapshotId: frozenSnapshot.snapshotId
    },
    expectedTradingDates: [...new Set(frozenSnapshot.bars.map((bar) => bar.tradeDate))],
    expectedUniverse: frozenSnapshot.universe,
    expectedUniverseVersion: researchUniverseVersion(frozenSnapshot)
  });
  await verifyFormalAccountingFiles(formalAccounting);
  if (!isDeepStrictEqual(formalAccounting, preflightResult.formalAccounting)) {
    throw new Error("formal accounting binding changed after the preflight gate");
  }
  const trades = JSON.parse(await readFile(resolve(primaryDir, "trades.json"), "utf8"));
  const totalGross = trades.reduce((sum, trade) => sum + Math.abs(Number(trade.grossAmount)), 0);
  const largestTradeGross = Math.max(...trades.map((trade) => Math.abs(Number(trade.grossAmount))));
  const monthlyGross = new Map();
  for (const trade of trades) {
    const month = String(trade.tradeDate).slice(0, 7);
    monthlyGross.set(month, (monthlyGross.get(month) ?? 0) + Math.abs(Number(trade.grossAmount)));
  }
  const [largestMonth, largestMonthGross] = [...monthlyGross.entries()].sort((a, b) => b[1] - a[1])[0];
  const summary = {
    schemaVersion: "2026-07-19.real-data-quant-summary.v2",
    snapshotId: primaryManifest.snapshotId,
    source: "owner_approved_pingan_imported_history_plus_futu_qfq",
    fixturePerformanceClaimed: false,
    primaryMetrics: primaryManifest.metrics,
    concentration: {
      trade: { reported: true, largestGrossShare: largestTradeGross / totalGross },
      security: { reported: true, largestSymbol: "HK.09926", largestGrossShare: 1, limitation: "single-security research scope" },
      month: { reported: true, largestMonth, largestGrossShare: largestMonthGross / totalGross }
    },
    researchBoundary: {
      adjustmentMode: frozenSnapshot.adjustment,
      priceBasis: "adjusted_qfq_close",
      role: "signal_generation_only",
      formalPerformanceAuthority: false,
      sourcePolicy: corporateActionPolicy
    },
    corporateActions: {
      status: "formal_accounting_replayed",
      accountingSnapshotId: formalAccounting.accountingSnapshot.snapshotId,
      corporateActionLedgerId: formalAccounting.corporateActionCoverage.ledgerId,
      signalPriceBasis: "adjusted_qfq_close",
      executionPriceBasis: "unadjusted_open",
      valuationPriceBasis: "unadjusted_close",
      feeNotionalBasis: "unadjusted_trade_gross",
      simulatedResearchOnly: true,
      officialFactsMutated: false
    },
    formalAccounting,
    failedExperiments,
    failedExperimentCount: failedExperiments.filter((item) => item.rejected).length,
    finalTestRetuned: false,
    advisoryOnly: true
  };
  if (failedExperiments.some((item) => item.rejected !== item.expectedRejected)) {
    throw new Error("experiment rejection result did not match its predeclared expectation");
  }
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(resolve(artifactRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return { ok: true, outputPath: "artifacts/stage-13-20/real-data-quant/summary.json", ...summary };
}

export function assertFormalAccountingSummaryReady(value, context) {
  return validateFormalAccountingBinding(value, context);
}

export async function preflightRealDataFormalAccounting() {
  const pipelineConfig = JSON.parse(await readFile(resolve(root, pipelineConfigPath), "utf8"));
  const freezeConfig = JSON.parse(await readFile(resolve(root, pipelineConfig.freezeConfigPath), "utf8"));
  const approvedInputBytes = await readFile(resolve(root, freezeConfig.sourcePath));
  const approvedInput = JSON.parse(approvedInputBytes.toString("utf8"));
  requireQfqResearchBoundary(approvedInput);
  const tradingDates = [...new Set(approvedInput.bars?.map((bar) => bar.tradeDate) ?? [])].sort();
  const formalAccounting = validateFormalAccountingBinding(approvedInput.formalAccounting, {
    expectedDataCutoff: freezeConfig.dataCutoff,
    expectedSignalSnapshot: {
      adjustmentMode: freezeConfig.adjustment,
      dataHash: approvedInput.formalAccounting?.signalSnapshot?.dataHash,
      path: freezeConfig.sourcePath,
      sha256: sha256(approvedInputBytes),
      snapshotId: approvedInput.formalAccounting?.signalSnapshot?.snapshotId
    },
    expectedTradingDates: tradingDates,
    expectedUniverse: freezeConfig.universe,
    expectedUniverseVersion: universeVersion(freezeConfig.universe, tradingDates)
  });
  await verifyFormalAccountingFiles(formalAccounting);
  if (!isDeepStrictEqual(pipelineConfig.formalAccounting, formalAccounting)) {
    throw new Error("quant pipeline is not bound to the verified formal accounting sources");
  }
  throw new Error(
    `${formalAccountingReplayEngineStatus}: QFQ-only engines cannot write trades, NAV, returns, Sharpe, or primary metrics`
  );
}

async function verifyFormalAccountingFiles(formalAccounting) {
  for (const identity of [formalAccounting.signalSnapshot, formalAccounting.accountingSnapshot,
    formalAccounting.corporateActionCoverage]) {
    let bytes;
    try {
      bytes = await readFile(resolve(root, identity.path));
    } catch {
      throw new Error(`formal accounting source file is unavailable: ${identity.path}`);
    }
    if (sha256(bytes) !== identity.sha256) {
      throw new Error(`formal accounting source file hash mismatch: ${identity.path}`);
    }
  }
}

function researchUniverseVersion(snapshot) {
  const dates = snapshot.bars.map((bar) => bar.tradeDate);
  return universeVersion(snapshot.universe, dates);
}

function universeVersion(universe, dates) {
  const symbols = universe.map((entry) => entry.symbol.toLowerCase()).join("-");
  return `hk-${symbols}-${dates[0]}-${dates.at(-1)}`;
}

function requireQfqResearchBoundary(approvedInput) {
  const corporateActionPolicy = approvedInput?.corporateActionPolicy;
  if (approvedInput?.adjustment !== "forward"
    || corporateActionPolicy?.researchPrices !== "futu_AuType_QFQ"
    || corporateActionPolicy.accountingAuthority !== false
    || corporateActionPolicy.cashDividendAccounting !== false
    || corporateActionPolicy.positionMutation !== false) {
    throw new Error("approved Pingan input does not preserve the QFQ research-only accounting boundary");
  }
  return corporateActionPolicy;
}

async function runQuantSmoke(configPath) {
  await execFileAsync(process.execPath, ["scripts/quant-smoke.mjs"], {
    cwd: root,
    env: { ...process.env, QUANT_SMOKE_CONFIG: configPath },
    maxBuffer: 40 * 1024 * 1024
  });
}

async function runQuantPipeline(configPath) {
  await execFileAsync(process.execPath, ["scripts/quant-pipeline.mjs"], {
    cwd: root,
    env: { ...process.env, QUANT_PIPELINE_CONFIG: configPath },
    maxBuffer: 40 * 1024 * 1024
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await generateRealDataQuantSummary(), null, 2));
}
