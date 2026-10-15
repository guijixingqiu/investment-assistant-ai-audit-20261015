export const ANNUAL_VALUATION_SCENARIO_MARGIN_INTERPRETATION =
  "owner_scenario_distance_not_target_price_or_trade_signal" as const;

export interface AnnualValuationScenarioMarginOfSafety {
  position: "below_range" | "within_range" | "above_range";
  low: number;
  base: number;
  high: number;
  interpretation: typeof ANNUAL_VALUATION_SCENARIO_MARGIN_INTERPRETATION;
}

export function calculateAnnualValuationScenarioMargin(
  currentPrice: number, low: number, base: number, high: number
): AnnualValuationScenarioMarginOfSafety {
  return {
    position: currentPrice < low ? "below_range" : currentPrice > high ? "above_range" : "within_range",
    low: roundSix((low - currentPrice) / low),
    base: roundSix((base - currentPrice) / base),
    high: roundSix((high - currentPrice) / high),
    interpretation: ANNUAL_VALUATION_SCENARIO_MARGIN_INTERPRETATION
  };
}

export function annualValuationScenarioMarginErrors(
  value: unknown,
  expected?: AnnualValuationScenarioMarginOfSafety
): string[] {
  if (!record(value)) return ["must be an object"];
  const keys = ["position", "low", "base", "high", "interpretation"];
  const errors: string[] = [];
  if (Object.keys(value).sort().join("|") !== keys.slice().sort().join("|")) errors.push("has invalid fields");
  if (!["below_range", "within_range", "above_range"].includes(String(value.position))) errors.push("position is invalid");
  if (![value.low, value.base, value.high].every((item) => typeof item === "number" && Number.isFinite(item))) errors.push("margins must be finite");
  if (value.interpretation !== ANNUAL_VALUATION_SCENARIO_MARGIN_INTERPRETATION) errors.push("interpretation is invalid");
  if (expected && Object.entries(expected).some(([key, item]) => value[key] !== item)) errors.push("does not match the exact quote and Owner scenarios");
  return errors;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roundSix(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
