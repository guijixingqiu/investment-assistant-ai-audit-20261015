import {
  canonicalQuantDecisionEvidenceJson,
  computeQuantDecisionEvidenceRefinementId,
  QUANT_DECISION_EVIDENCE_REFINEMENT_SCHEMA_VERSION,
  validateQuantDecisionEvidenceRefinementStructure,
  type QuantDecisionEvidenceRefinement
} from "../../../../packages/contracts/src/quantDecisionEvidence.js";
import { validateQuantExperimentComparisonInto, type QuantExperimentComparison } from "../../../../packages/contracts/src/decisionQuantEvidenceContract.js";
import { isDeepStrictEqual } from "node:util";
import crypto from "node:crypto";

export type QuantDecisionEvidenceRefinementResult =
  | { ok: true; value: QuantDecisionEvidenceRefinement; comparison?: QuantExperimentComparison; presentationLimitations: string[] }
  | { ok: false; status: "malformed" | "conflict"; reason: string; message: string };

export function quantDecisionEvidenceRefinementFromManifest(
  manifest: Record<string, unknown>,
  requestedSymbol: string
): QuantDecisionEvidenceRefinementResult {
  if (manifest.decisionEvidence === undefined) {
    return {
      ok: true,
      value: quantDecisionEvidenceNotCaptured("Legacy quant manifest has no decision-evidence refinement; no metrics are reconstructed from adjacent artifacts."),
      presentationLimitations: []
    };
  }
  const validation = validateQuantDecisionEvidenceRefinementStructure(manifest.decisionEvidence);
  if (!validation.ok) {
    return malformed("decision-evidence-structure", `Quant decision evidence refinement is malformed: ${validation.errors.join("; ")}`);
  }
  const refinement = validation.value;
  if (refinement.status !== "available") {
    return refinement.status === "not_captured"
      ? { ok: true, value: refinement, presentationLimitations: [] }
      : malformed("decision-evidence-unavailable", "An accepted quant manifest cannot label its embedded decision evidence unavailable.");
  }
  if (refinement.refinementId !== computeQuantDecisionEvidenceRefinementId(refinement)) {
    return malformed("decision-evidence-identity", "Quant decision evidence refinement identity does not match its canonical content.");
  }
  const conflicts = manifestBindingConflicts(manifest, refinement, requestedSymbol);
  if (conflicts.length) return conflict("decision-evidence-binding", `Quant decision evidence refinement conflicts with its bound manifest: ${conflicts.join("; ")}`);
  const hasComparisonSources = record(manifest.experimentRegistry) !== null && record(manifest.benchmarkEvidence) !== null;
  const comparison = experimentComparisonFromManifest(manifest, refinement);
  if (hasComparisonSources && !comparison) return malformed("comparison-missing", "Registered experiment and benchmark sources cannot form a complete comparison.");
  if (comparison !== undefined) {
    const comparisonErrors: string[] = [];
    validateQuantExperimentComparisonInto(comparison, {
      status: "available", decisionEvidence: refinement,
      identities: { frozenSnapshot: { snapshotId: refinement.source?.snapshotId, dataHash: refinement.source?.dataHash } }
    }, comparisonErrors);
    if (comparisonErrors.length) return malformed("comparison-binding", `Registered experiment comparison is malformed: ${comparisonErrors.join("; ")}`);
  }
  return { ok: true, value: refinement, ...(comparison ? { comparison } : {}),
    presentationLimitations: quantPresentationLimitations(manifest, refinement) };
}

function experimentComparisonFromManifest(
  manifest: Record<string, unknown>, refinement: QuantDecisionEvidenceRefinement
): QuantExperimentComparison | undefined {
  const registry = record(manifest.experimentRegistry);
  const benchmark = record(manifest.benchmarkEvidence);
  const data = record(manifest.dataIdentity);
  const dividend = record(manifest.dividendCashPolicy);
  if (!registry || !benchmark || !data || !dividend) return undefined;
  const rawTrials = Array.isArray(registry.experiments) ? registry.experiments : [];
  const trials = rawTrials.filter(isRecord);
  const benchmarkSource = record(benchmark.benchmark);
  const rawPeriods = Array.isArray(benchmark.comparisons) ? benchmark.comparisons : [];
  const periods = rawPeriods.filter(isRecord);
  if (trials.length !== rawTrials.length || periods.length !== rawPeriods.length
    || !benchmarkSource || !trials.every((trial) => record(trial.signal) && record(trial.metrics)
      && Object.keys(trial.signal as Record<string, unknown>).sort().join("|")
        === "buyWhenPreviousCloseReturnLte|name|sellWhenPreviousCloseReturnGte"
      && isDeepStrictEqual(trial.selectionWindow, trials[0]?.selectionWindow))) return undefined;
  const window = record(trials[0]?.selectionWindow);
  if (!window) return undefined;
  return {
    snapshotId: String(data.snapshotId), dataHash: String(data.dataHash),
    feePolicySha256: String(manifest.feePolicySha256), dividendCashPolicySha256: String(dividend.sha256),
    observationStartDate: refinement.source?.observationStartDate ?? "",
    observationEndDate: refinement.source?.observationEndDate ?? "",
    registryId: String(registry.registryId),
    selectionPolicy: registry.selectionPolicy as QuantExperimentComparison["selectionPolicy"],
    selectionWindow: { start: String(window.start), end: String(window.end) },
    experiments: trials.map((trial) => {
      const signal = record(trial.signal)!; const metrics = record(trial.metrics)!;
      return {
        id: String(trial.id), disposition: trial.disposition as "selected" | "rejected",
        reason: String(trial.reason), finalTestUsedForSelection: trial.finalTestUsedForSelection as false,
        signal: { name: String(signal.name),
          buyWhenPreviousCloseReturnLte: Number(signal.buyWhenPreviousCloseReturnLte),
          sellWhenPreviousCloseReturnGte: Number(signal.sellWhenPreviousCloseReturnGte) },
        metrics: { totalReturn: Number(metrics.totalReturn), maxDrawdown: Number(metrics.maxDrawdown),
          totalFees: Number(metrics.totalFees), turnoverOneWay: Number(metrics.turnoverOneWay),
          tradeCount: Number(metrics.tradeCount), closedRoundTripCount: Number(metrics.closedRoundTripCount) }
      };
    }),
    benchmark: {
      evidenceId: String(benchmark.evidenceId), symbol: benchmarkSource.symbol as "HK.800000",
      name: String(benchmarkSource.name), sourceSha256: String(benchmarkSource.sourceSha256),
      seriesHash: String(benchmarkSource.seriesHash),
      calculationPolicy: benchmark.calculationPolicy as QuantExperimentComparison["benchmark"]["calculationPolicy"],
      periods: periods.map((period) => ({
        id: period.id as QuantExperimentComparison["benchmark"]["periods"][number]["id"],
        start: String(period.start), end: String(period.end),
        simulatedStrategyTotalReturn: Number(period.simulatedStrategyTotalReturn),
        benchmarkTotalReturn: Number(period.benchmarkTotalReturn), difference: Number(period.excessReturn),
        usedForParameterSelection: period.usedForParameterSelection as false
      }))
    },
    returnBasis: "strategy_net_fees_includes_cash_dividends_vs_hsi_price_only_non_equivalent",
    preservesSourceOrder: true, ranking: false, recommendation: false
  };
}

export function quantDecisionEvidenceNotCaptured(limitation: string): QuantDecisionEvidenceRefinement {
  return unavailableShape("not_captured", "not_captured_no_reconstruction", limitation);
}

export function quantDecisionEvidenceUnavailable(limitation: string): QuantDecisionEvidenceRefinement {
  return unavailableShape("unavailable", "unavailable_no_research_interpretation", limitation);
}

function manifestBindingConflicts(
  manifest: Record<string, unknown>,
  refinement: QuantDecisionEvidenceRefinement,
  requestedSymbol: string
): string[] {
  const errors: string[] = [];
  const source = refinement.source;
  const data = record(manifest.dataIdentity);
  const shadow = record(manifest.shadowPortfolio);
  const registry = record(manifest.splitRegistry);
  const policy = record(manifest.baselinePolicy);
  const metrics = record(manifest.metrics);
  if (!source || !data || !shadow || !registry || !policy || !metrics) {
    return ["required data, shadow, split, baseline-policy, or metric binding is missing"];
  }
  const universe = Array.isArray(data.universe) ? data.universe.filter(isRecord) : [];
  const requestedUniverse = universe.find((item) => `${String(item.market)}.${String(item.code)}` === requestedSymbol);
  if (!requestedUniverse || refinement.symbol !== requestedSymbol) errors.push("requested symbol is not the bound universe symbol");
  const dateRange = record(data.dateRange);
  const expectedSource: Record<string, unknown> = {
    snapshotId: data.snapshotId,
    snapshotHash: data.snapshotHash,
    dataHash: data.dataHash,
    sourceClassification: data.sourceClassification,
    adjustment: data.adjustment,
    dataCutoff: data.dataCutoff,
    observationStartDate: dateRange?.start,
    observationEndDate: dateRange?.end,
    baselineExperimentIdentity: manifest.experimentIdentity,
    shadowPortfolioIdentity: manifest.shadowPortfolioIdentity
  };
  for (const [key, expected] of Object.entries(expectedSource)) {
    if (source[key as keyof typeof source] !== expected) errors.push(`source.${key} does not match the manifest`);
  }
  if (shadow.shadowPortfolioIdentity !== source.shadowPortfolioIdentity
    || shadow.experimentIdentity !== source.baselineExperimentIdentity) {
    errors.push("shadow portfolio identities do not match the decision evidence source");
  }
  validateSamples(refinement, registry, metrics, errors);
  validateExecution(refinement, policy, requestedUniverse ?? null, errors);
  validateRobustness(refinement, policy, manifest, errors);
  validateBenchmark(refinement, manifest, errors);
  const experimentRegistry = record(manifest.experimentRegistry);
  const benchmarkEvidence = record(manifest.benchmarkEvidence);
  if (experimentRegistry && benchmarkEvidence) {
    if (experimentRegistry.registryId !== contentId("quant-parameter-search:", {
      schemaVersion: experimentRegistry.schemaVersion, registeredAt: experimentRegistry.registeredAt,
      selectionPolicy: experimentRegistry.selectionPolicy, experiments: experimentRegistry.experiments
    }) || experimentRegistry.failedExperimentsId !== contentId("quant-failed-experiments:",
      Array.isArray(experimentRegistry.experiments) ? experimentRegistry.experiments.filter((item) => record(item)?.disposition === "rejected") : [])
      || benchmarkEvidence.evidenceId !== contentId("quant-benchmark:", {
        schemaVersion: benchmarkEvidence.schemaVersion, benchmark: benchmarkEvidence.benchmark,
        calculationPolicy: benchmarkEvidence.calculationPolicy,
        finalTestUsedForSelection: benchmarkEvidence.finalTestUsedForSelection,
        comparisons: benchmarkEvidence.comparisons
      })) errors.push("registered experiment or HSI benchmark content identity has drifted");
  }
  if (refinement.formalEvidence !== undefined
    && !isDeepStrictEqual(refinement.formalEvidence, manifest.formalEvidence)) {
    errors.push("formal evidence completeness does not match the manifest");
  }
  const requiredLimitations = [
    ...strings(policy.limitations),
    ...strings(shadow.limitations)
  ];
  for (const limitation of requiredLimitations) {
    if (!refinement.limitations.includes(limitation)) errors.push("decision evidence omits a bound manifest limitation");
  }
  return errors;
}

function validateBenchmark(
  refinement: QuantDecisionEvidenceRefinement,
  manifest: Record<string, unknown>,
  errors: string[]
): void {
  const check = refinement.formalEvidence?.checks.find((item) => item.id === "benchmark");
  const evidence = record(manifest.benchmarkEvidence);
  if (!check || check.status !== "available") {
    if (evidence) errors.push("benchmark evidence cannot be present while the formal benchmark check is UNKNOWN");
    return;
  }
  const benchmark = record(evidence?.benchmark);
  const dataBenchmark = record(record(manifest.dataIdentity)?.benchmark);
  const comparisons = Array.isArray(evidence?.comparisons) ? evidence.comparisons.filter(isRecord) : [];
  const expectedIds = [...refinement.samples.map((sample) => sample.id), "full_period"];
  if (!evidence || evidence.schemaVersion !== "2026-08-17.hk-stock-benchmark-evidence.v1"
    || evidence.evidenceId !== check.identity || evidence.finalTestUsedForSelection !== false
    || benchmark?.symbol !== "HK.800000" || !sha256(benchmark.sourceSha256) || !sha256(benchmark.seriesHash)
    || !dateTime(benchmark.asOf) || !dateTime(benchmark.fetchedAt) || !dateTime(manifest.generatedAt)
    || Date.parse(String(benchmark.asOf)) > Date.parse(String(benchmark.fetchedAt))
    || Date.parse(String(benchmark.fetchedAt)) > Date.parse(String(manifest.generatedAt))
    || dataBenchmark?.evidenceId !== evidence.evidenceId || dataBenchmark?.sourceSha256 !== benchmark.sourceSha256
    || !isDeepStrictEqual(comparisons.map((item) => item.id), expectedIds)
    || comparisons.some((item) => item.usedForParameterSelection !== false
      || ![item.simulatedStrategyTotalReturn, item.benchmarkTotalReturn, item.excessReturn].every(Number.isFinite)
      || Math.abs(Number(item.simulatedStrategyTotalReturn) - Number(item.benchmarkTotalReturn) - Number(item.excessReturn)) > 1e-7)) {
    errors.push("benchmark evidence does not match the exact HSI series, calculation, and formal check binding");
  }
}

function validateSamples(
  refinement: QuantDecisionEvidenceRefinement,
  registry: Record<string, unknown>,
  metrics: Record<string, unknown>,
  errors: string[]
): void {
  const splits = Array.isArray(registry.splits) ? registry.splits.filter(isRecord) : [];
  if (splits.length !== refinement.samples.length) {
    errors.push("sample count does not match the split registry");
    return;
  }
  refinement.samples.forEach((sample, index) => {
    const split = splits[index];
    for (const key of ["id", "role", "start", "end", "parameterSelectionAllowed", "finalTestLocked"] as const) {
      if (sample[key] !== split[key]) errors.push(`sample ${sample.id} ${key} does not match the split registry`);
    }
    const rawMetrics = record(metrics[sample.id]);
    if (!rawMetrics) {
      errors.push(`sample ${sample.id} metrics are missing from the manifest`);
      return;
    }
    const expected: Record<string, unknown> = {
      simulatedTotalReturn: rawMetrics.totalReturn,
      simulatedMaxDrawdown: rawMetrics.maxDrawdown,
      simulatedSharpe: rawMetrics.sharpe,
      simulatedTradeCount: rawMetrics.tradeCount,
      simulatedTotalFees: rawMetrics.totalFees,
      simulatedTurnoverOneWay: rawMetrics.turnoverOneWay,
      simulatedAverageGrossExposure: rawMetrics.averageGrossExposure,
      accountingAuditStatus: rawMetrics.accountingAuditStatus
    };
    if ([rawMetrics.annualizedReturn, rawMetrics.closedRoundTripCount, rawMetrics.winRate].some((item) => item !== undefined)) {
      expected.simulatedAnnualizedReturn = rawMetrics.annualizedReturn;
      expected.simulatedClosedRoundTripCount = rawMetrics.closedRoundTripCount;
      expected.simulatedWinRate = rawMetrics.winRate;
    }
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (sample.metrics[key as keyof typeof sample.metrics] !== expectedValue) {
        errors.push(`sample ${sample.id} metric ${key} does not match the manifest`);
      }
    }
  });
}

function validateExecution(
  refinement: QuantDecisionEvidenceRefinement,
  policy: Record<string, unknown>,
  universe: Record<string, unknown> | null,
  errors: string[]
): void {
  const execution = refinement.execution;
  const rawExecution = record(policy.execution);
  const fees = record(policy.fees);
  if (!execution || !rawExecution || !fees || !universe) {
    errors.push("execution policy or universe lot binding is missing");
    return;
  }
  if (execution.signalTiming !== rawExecution.signalTiming
    || execution.earliestExecution !== rawExecution.earliestExecution
    || execution.allowsSameBarExecution !== rawExecution.allowSameBarExecution
    || execution.allowsMargin !== rawExecution.allowMargin
    || execution.boardLot !== universe.lotSize) {
    errors.push("execution timing, margin, or board-lot boundary does not match the baseline policy");
  }
  const totalConfiguredCosts = Object.values(fees).reduce<number>(
    (total, value) => total + (typeof value === "number" ? value : 0),
    0
  );
  if (totalConfiguredCosts <= 0 || execution.nonZeroCosts !== true) errors.push("non-zero cost policy is not supported by the baseline fees");
}

function validateRobustness(
  refinement: QuantDecisionEvidenceRefinement,
  policy: Record<string, unknown>,
  manifest: Record<string, unknown>,
  errors: string[]
): void {
  const robustness = refinement.robustness;
  const parameters = record(policy.parameterPolicy);
  const accounting = record(policy.accountingAudit);
  if (!robustness || !parameters || !accounting) {
    errors.push("parameter or accounting robustness binding is missing");
    return;
  }
  for (const key of [
    "registrationTiming", "preregistered", "prospectiveHoldoutClaim",
    "finalTestUsedForParameterSelection", "finalTestUsedForAcceptanceThresholdFitting"
  ] as const) {
    if (robustness[key] !== parameters[key]) errors.push(`robustness ${key} does not match the parameter policy`);
  }
  const allAuditsPassed = Object.values(accounting).every((audit) => isRecord(audit) && audit.ok === true);
  if (!allAuditsPassed || robustness.allSplitAccountingAuditsPassed !== true) {
    errors.push("split accounting audits do not support the refinement");
  }
  const registry = record(manifest.experimentRegistry);
  const experiments = Array.isArray(registry?.experiments) ? registry.experiments.filter(isRecord) : [];
  const ids = experiments.map((item) => item.id).filter((id): id is string => typeof id === "string" && id.length > 0);
  const failedIds = experiments.filter((item) => item.disposition === "rejected").map((item) => item.id).filter((id): id is string => typeof id === "string" && id.length > 0);
  if (registry) {
    const splitRegistry = record(manifest.splitRegistry);
    const splits = Array.isArray(splitRegistry?.splits) ? splitRegistry.splits : [];
    const validation = splits.filter(isRecord).find((item) => item.id === "validation");
    if (experiments.length < 2 || ids.length !== experiments.length || new Set(ids).size !== ids.length
      || experiments.filter((item) => item.disposition === "selected").length !== 1
      || experiments.some((item) => !new Set(["selected", "rejected"]).has(String(item.disposition))
        || item.finalTestUsedForSelection !== false || record(item.selectionWindow)?.end !== validation?.end
        || item.disposition === "rejected" && !validRejectedExperiment(item))
      || robustness.failedExperiments.status !== "registered"
      || !isDeepStrictEqual(robustness.failedExperiments.experimentIds, failedIds)
      || failedIds.length === 0) errors.push("registered failed experiments do not match the exact experiment registry");
  } else if (robustness.failedExperiments.status !== "not_captured"
    || robustness.failedExperiments.experimentIds.length !== 0) {
    errors.push("a manifest without an experiment registry must keep failed experiments not_captured");
  }
}

function contentId(prefix: string, value: unknown): string {
  try {
    const canonical = canonicalQuantDecisionEvidenceJson(value);
    return `${prefix}${crypto.createHash("sha256").update(canonical).digest("hex")}`;
  } catch {
    return "invalid-content-identity";
  }
}

function validRejectedExperiment(experiment: Record<string, unknown>): boolean {
  const metrics = record(experiment.metrics);
  const performance = [metrics?.annualizedReturn, metrics?.closedRoundTripCount, metrics?.winRate];
  return typeof experiment.reason === "string" && experiment.reason.trim().length > 0
    && metrics?.accountingAuditStatus === "passed"
    && [metrics.totalReturn, metrics.maxDrawdown, metrics.sharpe, metrics.tradeCount,
      metrics.totalFees, metrics.turnoverOneWay, metrics.averageGrossExposure].every(Number.isFinite)
    && (performance.every((item) => item === undefined) || performance.every(Number.isFinite))
    && Number.isInteger(metrics.tradeCount) && Number(metrics.tradeCount) >= 0
    && Number(metrics.totalFees) >= 0 && Number(metrics.turnoverOneWay) >= 0
    && Number(metrics.averageGrossExposure) >= 0;
}

function quantPresentationLimitations(
  manifest: Record<string, unknown>,
  refinement: QuantDecisionEvidenceRefinement
): string[] {
  const benchmark = record(manifest.benchmarkEvidence);
  const comparisons = Array.isArray(benchmark?.comparisons) ? benchmark.comparisons.filter(isRecord) : [];
  const benchmarkLines = comparisons.map((comparison) => (
    `HSI benchmark ${String(comparison.id)}: strategy ${percent(comparison.simulatedStrategyTotalReturn)}, HSI ${percent(comparison.benchmarkTotalReturn)}, excess ${percent(comparison.excessReturn)}; ${comparison.id === "final_test" ? "locked report-only; " : ""}not used for parameter selection.`
  ));
  const failedIds = new Set(refinement.robustness?.failedExperiments.experimentIds ?? []);
  const concentration = refinement.formalEvidence?.checks.find((check) =>
    check.id === "trade_stock_month_concentration" && check.status === "available"
  );
  const registry = record(manifest.experimentRegistry);
  const experiments = Array.isArray(registry?.experiments) ? registry.experiments.filter(isRecord) : [];
  const experimentLines = experiments.map((experiment) => quantExperimentPresentationLine(experiment, failedIds));
  return [
    "Quant performance definition: annualized return uses 252 simulated sessions; win rate counts fee-adjusted closed buy/sell round trips, excludes open positions, and leaves cash dividends in total return rather than allocating them to one round trip.",
    ...benchmarkLines,
    ...(concentration ? [`Quant concentration: ${concentration.limitation}`] : []),
    ...experimentLines
  ];
}

/// Renders one fixed experiment-registry entry (selected baseline or rejected
/// alternative) from frozen registry values only. Signal parameters and the
/// selection window are echoed verbatim; nothing is recomputed, ranked, or
/// re-selected at presentation time.
function quantExperimentPresentationLine(
  experiment: Record<string, unknown>,
  failedIds: Set<string>
): string {
  const id = String(experiment.id);
  const rejected = experiment.disposition === "rejected" || failedIds.has(id);
  const metrics = record(experiment.metrics);
  const measurements = metrics
    ? `return ${percent(metrics.totalReturn)}, max drawdown ${percent(metrics.maxDrawdown)}, Sharpe ${Number(metrics.sharpe).toFixed(4)}, trades ${String(metrics.tradeCount)}, fees ${Number(metrics.totalFees).toFixed(2)} HKD, one-way turnover ${percent(metrics.turnoverOneWay)}`
    : "train+validation metrics not captured in this manifest";
  const details = [
    ...(typeof experiment.reason === "string" && experiment.reason.trim().length > 0 ? [experiment.reason.trim()] : []),
    `固定信号参数 ${quantSignalParameters(experiment.signal)}`,
    `选择窗口 ${quantSelectionWindow(experiment.selectionWindow)}`,
    `处置 ${String(experiment.disposition)}`
  ];
  return `${rejected ? "Rejected quant experiment" : "Selected quant baseline"} ${id}: ${measurements}; ${details.join("；")}`;
}

function quantSignalParameters(value: unknown): string {
  const signal = record(value);
  if (!signal) return "not_captured";
  const name = typeof signal.name === "string" && signal.name.trim().length > 0 ? signal.name.trim() : null;
  const parameters = Object.entries(signal)
    .filter(([key, item]) => key !== "name" && isScalar(item))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${key}=${String(item)}`);
  const parts = [name, ...parameters].filter((item): item is string => item !== null);
  return parts.length > 0 ? parts.join(", ") : "not_captured";
}

function quantSelectionWindow(value: unknown): string {
  const selectionWindow = record(value);
  const start = typeof selectionWindow?.start === "string" && selectionWindow.start.trim().length > 0 ? selectionWindow.start.trim() : null;
  const end = typeof selectionWindow?.end === "string" && selectionWindow.end.trim().length > 0 ? selectionWindow.end.trim() : null;
  if (start && end) return `${start} 至 ${end}`;
  if (end) return `截止 ${end}`;
  if (start) return `自 ${start}`;
  return "not_captured";
}

function percent(value: unknown): string {
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function unavailableShape(
  status: "not_captured" | "unavailable",
  interpretation: "not_captured_no_reconstruction" | "unavailable_no_research_interpretation",
  limitation: string
): QuantDecisionEvidenceRefinement {
  return {
    schemaVersion: QUANT_DECISION_EVIDENCE_REFINEMENT_SCHEMA_VERSION,
    status,
    refinementId: null,
    symbol: null,
    source: null,
    samples: [],
    execution: null,
    robustness: null,
    interpretation,
    limitations: [limitation]
  };
}

function malformed(reason: string, message: string): QuantDecisionEvidenceRefinementResult {
  return { ok: false, status: "malformed", reason, message };
}

function conflict(reason: string, message: string): QuantDecisionEvidenceRefinementResult {
  return { ok: false, status: "conflict", reason, message };
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function dateTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
