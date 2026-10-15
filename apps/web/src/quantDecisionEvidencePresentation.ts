import type { DecisionQuantEvidence } from "../../../packages/contracts/src/decisionContextBrowser.js";

export function quantDecisionEvidenceLines(evidence: DecisionQuantEvidence): string[] {
  const refinement = evidence.decisionEvidence;
  if (!refinement) {
    return ["Quant decision evidence refinement: not_captured; legacy context is not reconstructed from later manifests or metrics."];
  }
  if (refinement.status !== "available" || !refinement.source || !refinement.execution || !refinement.robustness) {
    return [`Quant decision evidence refinement: ${refinement.status}; ${refinement.limitations.join(" ")}`];
  }
  const sampleLines = refinement.samples.map((sample) => (
    `Quant ${sample.id} sample (${sample.start} to ${sample.end}; ${sample.role}): simulated return ${percent(sample.metrics.simulatedTotalReturn)}, annualized ${sample.metrics.simulatedAnnualizedReturn === undefined ? "UNKNOWN" : percent(sample.metrics.simulatedAnnualizedReturn)}, max drawdown ${percent(sample.metrics.simulatedMaxDrawdown)}, Sharpe ${decimal(sample.metrics.simulatedSharpe)}, executions ${sample.metrics.simulatedTradeCount}, closed round trips ${sample.metrics.simulatedClosedRoundTripCount ?? "UNKNOWN"}, win rate ${sample.metrics.simulatedWinRate === undefined ? "UNKNOWN" : percent(sample.metrics.simulatedWinRate)}, fees ${sample.metrics.simulatedTotalFees.toFixed(2)} ${refinement.execution?.feeCurrency}, one-way turnover ${percent(sample.metrics.simulatedTurnoverOneWay)}, average gross exposure ${percent(sample.metrics.simulatedAverageGrossExposure)}; accounting ${sample.metrics.accountingAuditStatus}.`
  ));
  const failed = refinement.robustness.failedExperiments;
  const formalLines = refinement.formalEvidence?.checks.map((check) =>
    `Quant formal ${check.id}: ${check.status}; ${check.identity ?? "no evidence identity"}; ${check.limitation}`
  ) ?? [];
  return [
    `Quant decision evidence refinement: available; id ${refinement.refinementId}; symbol ${refinement.symbol}; frozen snapshot ${refinement.source.snapshotId}; observation ${refinement.source.observationStartDate} to ${refinement.source.observationEndDate}; ${refinement.source.sourceClassification} ${refinement.source.adjustment} research data only.`,
    ...sampleLines,
    ...formalLines,
    `Quant execution boundary: signal ${refinement.execution.signalTiming}; earliest ${refinement.execution.earliestExecution}; same-bar ${refinement.execution.allowsSameBarExecution}; margin ${refinement.execution.allowsMargin}; board lot ${refinement.execution.boardLot}; non-zero costs ${refinement.execution.nonZeroCosts}; suspension, zero-volume, and missing-price rows reject execution.`,
    `Quant robustness boundary: retrospectively registered=${refinement.robustness.registrationTiming}; preregistered=${refinement.robustness.preregistered}; prospective holdout=${refinement.robustness.prospectiveHoldoutClaim}; final-test tuning=${refinement.robustness.finalTestUsedForParameterSelection}; failed experiments=${failed.status} (${failed.experimentIds.join(", ") || "none"}); historical simulation only, no forecast, ranking, recommendation, portfolio mutation, or execution authority.`,
    `Quant limitations: ${refinement.limitations.join(" ")}`
  ];
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function decimal(value: number): string {
  return value.toFixed(4);
}
