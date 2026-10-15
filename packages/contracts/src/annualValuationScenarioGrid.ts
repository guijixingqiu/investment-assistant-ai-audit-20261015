import type { AnnualValuationScenarioInput } from "./annualValuationQuantWorkbench.js";

export interface AnnualValuationScenarioGrid {
  projectedMetricPerShare: number;
  scenarioPresentValuePerShare: number;
  discountFactor: number;
  growthRates: number[];
  terminalMultiples: number[];
  cells: Array<{
    annualGrowthRate: number;
    terminalMultiple: number;
    presentValuePerShare: number;
  }>;
}

export function annualValuationMethodId(input: AnnualValuationScenarioInput) {
  return input.methodId ?? "discounted_forward_metric_multiple_user_scenario";
}

export function calculateAnnualValuationScenarioGrid(
  input: AnnualValuationScenarioInput
): AnnualValuationScenarioGrid | null {
  const projectedMetricPerShare = input.baseMetricPerShare
    * Math.pow(1 + input.annualGrowthRate, input.horizonYears);
  const discountFactor = Math.pow(1 + input.annualDiscountRate, input.horizonYears);
  const scenarioPresentValuePerShare = projectedMetricPerShare
    * input.terminalMultiple / discountFactor + input.netCashPerShare;
  if (!Number.isFinite(projectedMetricPerShare)
    || !Number.isFinite(discountFactor)
    || !Number.isFinite(scenarioPresentValuePerShare)
    || projectedMetricPerShare <= 0
    || discountFactor <= 0
    || scenarioPresentValuePerShare <= 0) {
    return null;
  }
  const growthRates = [
    clamp(input.annualGrowthRate - input.growthRateStep, -0.95, 3),
    input.annualGrowthRate,
    clamp(input.annualGrowthRate + input.growthRateStep, -0.95, 3)
  ].map(roundSix);
  const terminalMultiples = [
    clamp(input.terminalMultiple - input.multipleStep, 0.1, 200),
    input.terminalMultiple,
    clamp(input.terminalMultiple + input.multipleStep, 0.1, 200)
  ].map(roundSix);
  const cells = growthRates.flatMap((annualGrowthRate) => terminalMultiples.map((terminalMultiple) => ({
    annualGrowthRate,
    terminalMultiple,
    presentValuePerShare: roundSix(
      input.baseMetricPerShare * Math.pow(1 + annualGrowthRate, input.horizonYears)
      * terminalMultiple / discountFactor + input.netCashPerShare
    )
  })));
  if (cells.some((cell) => !Number.isFinite(cell.presentValuePerShare))) return null;
  return {
    projectedMetricPerShare: roundSix(projectedMetricPerShare),
    scenarioPresentValuePerShare: roundSix(scenarioPresentValuePerShare),
    discountFactor,
    growthRates,
    terminalMultiples,
    cells
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundSix(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
