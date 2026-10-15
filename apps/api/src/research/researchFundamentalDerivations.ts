import {
  RESEARCH_FUNDAMENTALS_FORMULA_VERSION,
  researchFundamentalCurrentlyUsable,
  type ResearchFundamentalDerivationData,
  type ResearchFundamentalMetric,
  type ResearchFundamentalValueData
} from "../../../../packages/contracts/src/researchFundamentals.js";

type CurrentValue = ResearchFundamentalValueData & { valueState: "current" };
type Period = { periodStart: string | null; periodEnd: string };
type SequenceScope = CurrentValue["scope"];
type SequenceIdentity = { scope: SequenceScope; currency: string; unitScale: number };

const DERIVATION_ORDER: ResearchFundamentalDerivationData["kind"][] = [
  "revenue_yoy",
  "profit_change",
  "profit_margin",
  "cash_conversion",
  "liability_ratio"
];

export function deriveResearchFundamentals(
  values: ResearchFundamentalValueData[]
): ResearchFundamentalDerivationData[] {
  const current = values.filter((value): value is CurrentValue => researchFundamentalCurrentlyUsable(value));
  return [
    ...periodChangeSequence("revenue", "revenue_yoy", current),
    ...periodChangeSequence("profit_attributable_to_owners", "profit_change", current),
    ...samePeriodRatioSequence("profit_margin", "profit_attributable_to_owners", "revenue", "duration", current),
    ...samePeriodRatioSequence("cash_conversion", "operating_cash_flow", "profit_attributable_to_owners", "duration", current),
    ...samePeriodRatioSequence("liability_ratio", "total_liabilities", "total_assets", "instant", current)
  ].sort(compareDerivation);
}

function periodChangeSequence(
  metric: "revenue" | "profit_attributable_to_owners",
  kind: "revenue_yoy" | "profit_change",
  values: CurrentValue[]
): ResearchFundamentalDerivationData[] {
  const candidates = values
    .filter((value) => value.metric === metric && value.periodKind === "duration")
    .sort(compareValuePeriod);
  const periods = uniquePeriods(candidates);
  if (periods.length === 0) {
    return [unavailable(kind, "", null, [], "缺少当前期原值", metric === "revenue" ? "ratio" : "absolute_change")];
  }
  const sequenceScope = preferredScope(candidates, periods[0]);
  const latestFacts = factsForPeriod(candidates, periods[0], sequenceScope);
  const identity = latestFacts.length === 0 ? null : identityOf(latestFacts.slice().sort(compareLatestValue)[0]);
  return periods.map((currentPeriod) => {
    const currentFacts = factsForPeriod(candidates, currentPeriod, sequenceScope);
    const current = currentFacts[0];
    const valueKind = metric === "revenue" ? "ratio" : "absolute_change";
    if (!current) {
      return unavailable(kind, currentPeriod.periodEnd, null, [], "缺少当前期原值", valueKind);
    }
    const currentIds = currentFacts.map((value) => value.id);
    if (!identity || currentFacts.some((value) => !sameIdentity(value, identity))) {
      return unavailable(kind, currentPeriod.periodEnd, null, currentIds, "币种、单位或合并口径不一致，拒绝混算", valueKind);
    }
    if (currentFacts.length !== 1) {
      return unavailable(
        kind,
        currentPeriod.periodEnd,
        null,
        currentIds,
        "同一期间存在冲突的当前原值",
        valueKind
      );
    }

    const priorPeriod = previousYearPeriod(currentPeriod);
    const priorFacts = factsForPeriod(candidates, priorPeriod, sequenceScope);
    if (priorFacts.length === 0) {
      return unavailable(kind, current.periodEnd, null, [current.id], "缺少上一年同期间原值", valueKind);
    }
    const priorIds = priorFacts.map((value) => value.id);
    const inputs = [priorFacts[0].id, current.id];
    if (priorFacts.some((value) => !sameIdentity(value, identity))) {
      return unavailable(kind, current.periodEnd, priorPeriod.periodEnd, priorIds.concat(current.id), "币种、单位或合并口径不一致，拒绝混算", valueKind);
    }
    if (priorFacts.length !== 1) {
      return unavailable(kind, current.periodEnd, priorPeriod.periodEnd, priorIds.concat(current.id), "同一期间存在冲突的当前原值", valueKind);
    }

    const prior = priorFacts[0];
    const reason = comparisonBlockReason(prior, current);
    if (reason) return unavailable(kind, current.periodEnd, prior.periodEnd, inputs, reason, valueKind);
    const base = decimal(prior.value);
    const latest = decimal(current.value);
    if (!base || !latest) return unavailable(kind, current.periodEnd, prior.periodEnd, inputs, "unknown 不参与计算且不补零", valueKind);
    if (metric === "revenue") {
      if (sign(base) <= 0) return unavailable(kind, current.periodEnd, prior.periodEnd, inputs, "收入同比要求基期收入大于零", "ratio");
      return available(kind, current.periodEnd, prior.periodEnd, inputs, ratio(subtract(latest, base), base), "ratio");
    }
    if (sign(base) > 0 && sign(latest) > 0) {
      return available(kind, current.periodEnd, prior.periodEnd, inputs, ratio(subtract(latest, base), base), "ratio");
    }
    return {
      ...available(kind, current.periodEnd, prior.periodEnd, inputs, render(subtract(latest, base)), "absolute_change"),
      reason: "利润任一期非正，百分比不可比；仅显示绝对变化"
    };
  });
}

function samePeriodRatioSequence(
  kind: "profit_margin" | "cash_conversion" | "liability_ratio",
  numeratorMetric: ResearchFundamentalMetric,
  denominatorMetric: ResearchFundamentalMetric,
  periodKind: "duration" | "instant",
  values: CurrentValue[]
): ResearchFundamentalDerivationData[] {
  const candidates = values
    .filter((value) => value.periodKind === periodKind && [numeratorMetric, denominatorMetric].includes(value.metric))
    .sort(compareValuePeriod);
  const periods = uniquePeriods(candidates);
  if (periods.length === 0) return [unavailable(kind, "", null, [], "缺少可配对的当前原值", "ratio")];
  const sequenceScope = ratioScope(candidates, periods[0], numeratorMetric, denominatorMetric);
  const latestFacts = factsForPeriod(candidates, periods[0], sequenceScope);
  const identity = latestFacts.length === 0 ? null : identityOf(latestFacts.slice().sort(compareLatestValue)[0]);

  return periods.map((period) => {
    const scoped = candidates.filter((value) => value.scope === sequenceScope);
    const numeratorFacts = factsForPeriod(scoped.filter((value) => value.metric === numeratorMetric), period);
    const denominatorFacts = factsForPeriod(scoped.filter((value) => value.metric === denominatorMetric), period);
    const scopedFacts = factsForPeriod(scoped, period);
    const inputValueIds = [...numeratorFacts, ...denominatorFacts].map((value) => value.id);
    if (numeratorFacts.length === 0 || denominatorFacts.length === 0) {
      return unavailable(kind, period.periodEnd, null, inputValueIds, "缺少同期间、口径、币种与单位的分子或分母原值", "ratio");
    }
    if (!identity || scopedFacts.some((value) => !sameIdentity(value, identity))) {
      return unavailable(kind, period.periodEnd, null, inputValueIds, "币种、单位或合并口径不一致，拒绝混算", "ratio");
    }
    if (numeratorFacts.length !== 1 || denominatorFacts.length !== 1) {
      return unavailable(kind, period.periodEnd, null, inputValueIds, "同一期间存在冲突的当前原值", "ratio");
    }
    const numerator = numeratorFacts[0];
    const denominator = denominatorFacts[0];
    const reason = comparisonBlockReason(numerator, denominator);
    if (reason) return unavailable(kind, period.periodEnd, null, inputValueIds, reason, "ratio");
    const numeratorValue = decimal(numerator.value);
    const denominatorValue = decimal(denominator.value);
    if (!numeratorValue || !denominatorValue) return unavailable(kind, period.periodEnd, null, inputValueIds, "unknown 不参与计算且不补零", "ratio");
    if (sign(denominatorValue) <= 0) {
      const text = kind === "profit_margin"
        ? "利润率要求收入大于零"
        : kind === "cash_conversion"
          ? "现金转换率要求利润和经营现金流均大于零"
          : "负债率要求总资产大于零";
      return unavailable(kind, period.periodEnd, null, inputValueIds, text, "ratio");
    }
    if (kind === "cash_conversion" && sign(numeratorValue) <= 0) {
      return unavailable(kind, period.periodEnd, null, inputValueIds, "现金转换率要求利润和经营现金流均大于零", "ratio");
    }
    return available(kind, period.periodEnd, null, inputValueIds, ratio(numeratorValue, denominatorValue), "ratio");
  });
}

function previousYearPeriod(period: Period): Period {
  const startYear = period.periodStart === null ? null : Number(period.periodStart.slice(0, 4)) - 1;
  const endYear = Number(period.periodEnd.slice(0, 4)) - 1;
  return {
    periodStart: period.periodStart === null ? null : `${startYear}${period.periodStart.slice(4)}`,
    periodEnd: `${endYear}${period.periodEnd.slice(4)}`
  };
}

function uniquePeriods(values: CurrentValue[]): Period[] {
  const seen = new Set<string>();
  return values
    .map((value) => ({ periodStart: value.periodStart, periodEnd: value.periodEnd }))
    .filter((period) => {
      const key = periodKey(period);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function factsForPeriod(values: CurrentValue[], period: Period, scope?: SequenceScope): CurrentValue[] {
  return values.filter((value) => value.periodStart === period.periodStart
    && value.periodEnd === period.periodEnd
    && (scope === undefined || value.scope === scope));
}

function preferredScope(values: CurrentValue[], latestPeriod: Period): SequenceScope {
  return factsForPeriod(values, latestPeriod, "consolidated").length > 0 ? "consolidated" : "parent_company";
}

function ratioScope(
  values: CurrentValue[],
  latestPeriod: Period,
  numeratorMetric: ResearchFundamentalMetric,
  denominatorMetric: ResearchFundamentalMetric
): SequenceScope {
  for (const scope of ["consolidated", "parent_company"] as const) {
    const scoped = factsForPeriod(values, latestPeriod, scope);
    if (scoped.some((value) => value.metric === numeratorMetric)
      && scoped.some((value) => value.metric === denominatorMetric)) {
      return scope;
    }
  }
  return preferredScope(values, latestPeriod);
}

function identityOf(value: CurrentValue): SequenceIdentity {
  return { scope: value.scope, currency: value.currency, unitScale: value.unitScale };
}

function sameIdentity(value: CurrentValue, identity: SequenceIdentity): boolean {
  return value.scope === identity.scope
    && value.currency === identity.currency
    && value.unitScale === identity.unitScale;
}

function compareLatestValue(left: CurrentValue, right: CurrentValue): number {
  return right.createdAt.localeCompare(left.createdAt) || compareId(right.id, left.id);
}

function periodKey(period: Period): string {
  return `${period.periodStart ?? "instant"}/${period.periodEnd}`;
}

function compareValuePeriod(left: CurrentValue, right: CurrentValue): number {
  return right.periodEnd.localeCompare(left.periodEnd)
    || String(right.periodStart ?? "").localeCompare(String(left.periodStart ?? ""))
    || compareId(right.id, left.id);
}

function compareDerivation(left: ResearchFundamentalDerivationData, right: ResearchFundamentalDerivationData): number {
  return right.periodEnd.localeCompare(left.periodEnd)
    || (left.basePeriodEnd ?? "").localeCompare(right.basePeriodEnd ?? "")
    || DERIVATION_ORDER.indexOf(left.kind) - DERIVATION_ORDER.indexOf(right.kind);
}

function comparisonBlockReason(left: CurrentValue, right: CurrentValue): string | null {
  if (left.comparability !== "comparable") return left.comparabilityReason ?? "原值标记为不可比";
  if (right.comparability !== "comparable") return right.comparabilityReason ?? "原值标记为不可比";
  if (left.valueStatus === "explicit_unknown" || right.valueStatus === "explicit_unknown") return "unknown 不参与计算且不补零";
  return null;
}

function available(
  kind: ResearchFundamentalDerivationData["kind"],
  periodEnd: string,
  basePeriodEnd: string | null,
  inputValueIds: string[],
  value: string,
  valueKind: ResearchFundamentalDerivationData["valueKind"]
): ResearchFundamentalDerivationData {
  return { kind, periodEnd, basePeriodEnd, status: "available", value, valueKind, reason: null, formulaVersion: RESEARCH_FUNDAMENTALS_FORMULA_VERSION, inputValueIds };
}

function unavailable(
  kind: ResearchFundamentalDerivationData["kind"],
  periodEnd: string,
  basePeriodEnd: string | null,
  inputValueIds: string[],
  reason: string,
  valueKind: ResearchFundamentalDerivationData["valueKind"]
): ResearchFundamentalDerivationData {
  return { kind, periodEnd, basePeriodEnd, status: "not_comparable", value: null, valueKind, reason, formulaVersion: RESEARCH_FUNDAMENTALS_FORMULA_VERSION, inputValueIds };
}

interface Decimal { integer: bigint; scale: bigint }

function decimal(value: string | null): Decimal | null {
  if (value === null || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  try {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
    const scale = 10n ** BigInt(fraction.length);
    const integer = BigInt(`${whole}${fraction}`) * (negative ? -1n : 1n);
    return { integer, scale };
  } catch {
    return null;
  }
}

function subtract(left: Decimal, right: Decimal): Decimal {
  const scale = left.scale > right.scale ? left.scale : right.scale;
  return {
    integer: left.integer * (scale / left.scale) - right.integer * (scale / right.scale),
    scale
  };
}

function sign(value: Decimal): number {
  return value.integer < 0n ? -1 : value.integer > 0n ? 1 : 0;
}

function ratio(numerator: Decimal, denominator: Decimal): string {
  const precision = 1_000_000n;
  const dividend = numerator.integer * denominator.scale * precision;
  const divisor = numerator.scale * denominator.integer;
  const absoluteDivisor = divisor < 0n ? -divisor : divisor;
  const absoluteDividend = dividend < 0n ? -dividend : dividend;
  const rounded = (absoluteDividend + absoluteDivisor / 2n) / absoluteDivisor;
  const signed = (dividend < 0n) !== (divisor < 0n) ? -rounded : rounded;
  return render({ integer: signed, scale: precision });
}

function render(value: Decimal): string {
  const negative = value.integer < 0n;
  const absolute = negative ? -value.integer : value.integer;
  const digits = absolute.toString().padStart(value.scale.toString().length, "0");
  const fractionalDigits = value.scale.toString().length - 1;
  const whole = fractionalDigits ? digits.slice(0, -fractionalDigits) || "0" : digits;
  const fraction = fractionalDigits ? digits.slice(-fractionalDigits).replace(/0+$/, "") : "";
  const rendered = fraction ? `${whole}.${fraction}` : whole;
  return negative && rendered !== "0" ? `-${rendered}` : rendered;
}

function compareId(left: string, right: string): number {
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}
