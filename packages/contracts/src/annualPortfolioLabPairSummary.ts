import type {
  AnnualPortfolioHistoricalMetrics,
  AnnualPortfolioLabData,
  AnnualPortfolioLabQuantEvidence
} from "./annualPortfolioLab.js";

export interface AnnualPortfolioLabPairSummary {
  symbols: [string, string];
  portfolioSnapshotId: string;
  quantEvidenceId: string | null;
  current: AnnualPortfolioLabPairState;
  scenarios: AnnualPortfolioLabPairScenario[];
}

export interface AnnualPortfolioLabPairState {
  selectedWeight: number;
  largestPositionWeight: number;
  hhi: number;
  historical: AnnualPortfolioHistoricalMetrics;
}

export interface AnnualPortfolioLabPairScenario extends AnnualPortfolioLabPairState {
  sourceIndex: number;
  amountPerStock: number;
  combinedAddedAmount: number;
  selectedWeightChange: number;
  largestPositionWeightChange: number;
  hhiChange: number;
  annualizedVolatilityChange: number | null;
  historicalStressLossChange: number | null;
  historicalTailLossChange: number | null;
  selectedRiskContributionChange: number | null;
}

export function annualPortfolioLabPairSummary(
  current: AnnualPortfolioLabData,
  compared: AnnualPortfolioLabData
): AnnualPortfolioLabPairSummary | null {
  const symbols: [string, string] = [current.target.symbol, compared.target.symbol];
  if (symbols[0] === symbols[1]
    || current.sourceIdentity.accountScopeId !== compared.sourceIdentity.accountScopeId
    || current.sourceIdentity.portfolioContextId !== compared.sourceIdentity.portfolioContextId
    || current.sourceIdentity.portfolioSnapshotId !== compared.sourceIdentity.portfolioSnapshotId
    || current.sourceIdentity.portfolioAsOf !== compared.sourceIdentity.portfolioAsOf
    || current.scenarios.length !== compared.scenarios.length
    || current.scenarios.some((scenario, index) => (
      scenario.sourceIndex !== compared.scenarios[index]?.sourceIndex
      || scenario.hypotheticalAmount !== compared.scenarios[index]?.hypotheticalAmount
    ))) return null;

  const evidence = exactSharedEvidence(current, compared);
  const baseValues = new Map(current.portfolio.positions.map((position) => [position.symbol, position.marketValue ?? 0]));
  const currentState = state(baseValues, symbols, evidence);
  const scenarios = current.scenarios.map((scenario) => {
    const values = new Map(baseValues);
    symbols.forEach((symbol) => values.set(symbol, (values.get(symbol) ?? 0) + scenario.hypotheticalAmount));
    const next = state(values, symbols, evidence);
    return {
      sourceIndex: scenario.sourceIndex,
      amountPerStock: scenario.hypotheticalAmount,
      combinedAddedAmount: round(scenario.hypotheticalAmount * 2, 8),
      ...next,
      selectedWeightChange: difference(next.selectedWeight, currentState.selectedWeight) ?? 0,
      largestPositionWeightChange: difference(next.largestPositionWeight, currentState.largestPositionWeight) ?? 0,
      hhiChange: difference(next.hhi, currentState.hhi) ?? 0,
      annualizedVolatilityChange: difference(next.historical.annualizedVolatility, currentState.historical.annualizedVolatility),
      historicalStressLossChange: difference(next.historical.historicalStressLossMagnitude, currentState.historical.historicalStressLossMagnitude),
      historicalTailLossChange: difference(next.historical.historicalTailLossMagnitude, currentState.historical.historicalTailLossMagnitude),
      selectedRiskContributionChange: difference(next.historical.candidateRiskContribution, currentState.historical.candidateRiskContribution)
    };
  });
  return {
    symbols,
    portfolioSnapshotId: current.sourceIdentity.portfolioSnapshotId,
    quantEvidenceId: evidence?.evidenceId ?? null,
    current: currentState,
    scenarios
  };
}

function state(
  marketValues: Map<string, number>,
  symbols: [string, string],
  evidence: AnnualPortfolioLabQuantEvidence | null
): AnnualPortfolioLabPairState {
  const total = [...marketValues.values()].reduce((sum, value) => sum + value, 0);
  const weights = new Map([...marketValues].map(([symbol, value]) => [symbol, round(value / total, 8)]));
  const values = [...weights.values()];
  return {
    selectedWeight: round(symbols.reduce((sum, symbol) => sum + (weights.get(symbol) ?? 0), 0), 8),
    largestPositionWeight: round(Math.max(...values), 8),
    hhi: round(values.reduce((sum, value) => sum + value ** 2, 0), 8),
    historical: evidence ? historical(evidence, weights, symbols) : unavailableHistorical()
  };
}

function exactSharedEvidence(
  current: AnnualPortfolioLabData,
  compared: AnnualPortfolioLabData
): AnnualPortfolioLabQuantEvidence | null {
  const left = current.quant.evidence;
  const right = compared.quant.evidence;
  return current.quant.coverage.status === "exact"
    && compared.quant.coverage.status === "exact"
    && left?.evidenceId === right?.evidenceId
    ? left
    : null;
}

function historical(
  evidence: AnnualPortfolioLabQuantEvidence,
  weights: Map<string, number>,
  symbols: [string, string]
): AnnualPortfolioHistoricalMetrics {
  const rows = evidence.dailyReturns.map((row) => ({
    date: row.tradeDate,
    value: row.values.reduce((sum, item) => sum + (weights.get(item.symbol) ?? 0) * item.value, 0)
  }));
  const values = rows.map((row) => row.value);
  const worst = [...rows].sort((left, right) => left.value - right.value || left.date.localeCompare(right.date))[0];
  const contributions = symbols.map((symbol) => riskContribution(evidence, weights, symbol));
  return {
    status: "available",
    annualizedVolatility: round(standardDeviation(values) * Math.sqrt(evidence.method.annualizationDays), 10),
    historicalStressLossMagnitude: round(Math.max(0, -worst.value), 10),
    historicalStressDate: worst.date,
    historicalTailLossMagnitude: round(tailLoss(values, evidence.method.tailConfidence), 10),
    candidateRiskContribution: contributions.includes(null)
      ? null
      : round((contributions[0] ?? 0) + (contributions[1] ?? 0), 10),
    limitation: "Joint metrics use the exact shared quant window and add the same Owner-entered amount to both selected research stocks; they do not change portfolio facts."
  };
}

function riskContribution(
  evidence: AnnualPortfolioLabQuantEvidence,
  weights: Map<string, number>,
  candidateSymbol: string
): number | null {
  const symbols = evidence.source.universe.map((item) => item.symbol);
  const candidateIndex = symbols.indexOf(candidateSymbol);
  if (candidateIndex < 0) return null;
  const vector = symbols.map((symbol) => weights.get(symbol) ?? 0);
  const marginal = symbols.map((left) => symbols.reduce((sum, right, index) => (
    sum + covariance(evidence, left, right) * vector[index]
  ), 0));
  const variance = vector.reduce((sum, weight, index) => sum + weight * marginal[index], 0);
  return variance > 0 ? vector[candidateIndex] * marginal[candidateIndex] / variance : null;
}

function covariance(evidence: AnnualPortfolioLabQuantEvidence, left: string, right: string): number {
  return evidence.covariance.find((item) => (
    item.leftSymbol === left && item.rightSymbol === right
    || item.leftSymbol === right && item.rightSymbol === left
  ))?.annualizedCovariance ?? 0;
}

function unavailableHistorical(): AnnualPortfolioHistoricalMetrics {
  return {
    status: "unavailable",
    annualizedVolatility: null,
    historicalStressLossMagnitude: null,
    historicalStressDate: null,
    historicalTailLossMagnitude: null,
    candidateRiskContribution: null,
    limitation: "Joint historical risk is unavailable until both reads share one exact canonical quant evidence window."
  };
}

function difference(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : round(left - right, 10);
}

function tailLoss(values: number[], confidence: number): number {
  const count = Math.max(1, Math.ceil(values.length * (1 - confidence)));
  return Math.max(0, -mean([...values].sort((left, right) => left - right).slice(0, count)));
}

function standardDeviation(values: number[]): number {
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function round(value: number, digits: number): number { const factor = 10 ** digits; return Math.round((value + Number.EPSILON) * factor) / factor; }
