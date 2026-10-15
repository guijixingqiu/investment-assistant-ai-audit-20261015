import type { FactMetadata } from "./factMetadata.js";
import { validateFactMetadataInto } from "./factMetadata.js";
import { validateDecisionQuantEvidenceInto, type DecisionQuantEvidence } from "./decisionQuantEvidenceContract.js";
import { areInstantsChronologicallyOrdered } from "./chronology.js";
import { calculateAnnualValuationScenarioGrid } from "./annualValuationScenarioGrid.js";
import {
  annualValuationScenarioMarginErrors,
  calculateAnnualValuationScenarioMargin,
  type AnnualValuationScenarioMarginOfSafety
} from "./annualValuationScenarioMargin.js";
export { calculateAnnualValuationScenarioGrid, annualValuationMethodId } from "./annualValuationScenarioGrid.js";
export type { AnnualValuationScenarioMarginOfSafety } from "./annualValuationScenarioMargin.js";
export type { AnnualValuationScenarioGrid } from "./annualValuationScenarioGrid.js";

export const ANNUAL_VALUATION_QUANT_WORKBENCH_SCHEMA_VERSION =
  "2026-07-17.ios-annual-rings-valuation-quant.v1";
export const ANNUAL_VALUATION_CALCULATION_VERSION =
  "2026-07-17.discounted-forward-metric-multiple.v1";
export const ANNUAL_ADJUSTED_NET_ASSET_CALCULATION_VERSION =
  "2026-08-13.adjusted-net-asset-value.v1";
export const ANNUAL_VALUATION_PRESENT_VALUE_FORMULA =
  "baseMetricPerShare * (1 + annualGrowthRate) ^ horizonYears * terminalMultiple / (1 + annualDiscountRate) ^ horizonYears + netCashPerShare";
export const ANNUAL_ADJUSTED_NET_ASSET_VALUE_FORMULA =
  "baseNetAssetPerShare * (1 + annualNetAssetGrowthRate) ^ horizonYears * assetRealizationRate / (1 + requiredReturn) ^ horizonYears + assetLiabilityAdjustmentPerShare";
export const ANNUAL_VALUATION_IMPLIED_EXPECTATION_FORMULA =
  "((currentPrice - netCashPerShare) * (1 + annualDiscountRate) ^ horizonYears / (baseMetricPerShare * terminalMultiple)) ^ (1 / horizonYears) - 1";
export const ANNUAL_VALUATION_QUANT_WORKBENCH_STATUSES = [
  "available",
  "not_found",
  "malformed",
  "unavailable"
] as const;

export type AnnualValuationQuantWorkbenchStatus =
  (typeof ANNUAL_VALUATION_QUANT_WORKBENCH_STATUSES)[number];
export type AnnualValuationFactStatus =
  | "available"
  | "stale"
  | "missing"
  | "conflict"
  | "unavailable";
export type AnnualQuantDiagnosticStatus = "available" | "not_captured" | "unavailable";
export type AnnualValuationMethodId =
  | "discounted_forward_metric_multiple_user_scenario"
  | "adjusted_net_asset_value_user_scenario";
export interface AnnualValuationScenarioInput {
  methodId?: AnnualValuationMethodId;
  metricCurrency?: string;
  shareBasis?: "basic" | "diluted";
  baseMetricPerShare: number;
  annualGrowthRate: number;
  horizonYears: number;
  terminalMultiple: number;
  annualDiscountRate: number;
  netCashPerShare: number;
  growthRateStep: number;
  multipleStep: number;
}

export interface AnnualQuantFilterInput {
  maxDrawdownMagnitude: number;
  maxTurnoverOneWay: number;
  minTradeCount: number;
}

export interface AnnualValuationResult {
  status: AnnualValuationFactStatus;
  quote: {
    snapshotId: string;
    symbol: string;
    currency: string;
    price: number;
    quoteTime: string;
    fetchedAt: string;
    source: string;
  } | null;
  inputs: AnnualValuationScenarioInput;
  method: {
    id: AnnualValuationMethodId;
    calculationVersion: typeof ANNUAL_VALUATION_CALCULATION_VERSION | typeof ANNUAL_ADJUSTED_NET_ASSET_CALCULATION_VERSION;
    presentValueFormula: typeof ANNUAL_VALUATION_PRESENT_VALUE_FORMULA | typeof ANNUAL_ADJUSTED_NET_ASSET_VALUE_FORMULA;
    impliedExpectationFormula: typeof ANNUAL_VALUATION_IMPLIED_EXPECTATION_FORMULA;
    rounding: "decimal_places_6";
    applicability?: {
      ownerConfirmed: true;
      companyDataBasis: "forward_operating_metric_per_share" | "reported_balance_sheet_net_assets_per_share";
      requiredAnchorMetrics: Array<"revenue" | "profit_attributable_to_owners" | "total_assets" | "total_liabilities">;
      limitation: string;
    };
  };
  outputs: {
    projectedMetricPerShare: number;
    scenarioPresentValuePerShare: number;
    impliedAnnualGrowthRateAtCurrentPrice: number | null;
    impliedExpectationStatus: "available" | "not_computable";
    valueRange?: {
      low: number;
      high: number;
      interpretation: "research_scenario_range_not_target_price";
    };
    scenarioMarginOfSafety?: AnnualValuationScenarioMarginOfSafety;
  } | null;
  sensitivity: {
    growthRates: number[];
    terminalMultiples: number[];
    cells: Array<{
      annualGrowthRate: number;
      terminalMultiple: number;
      presentValuePerShare: number;
    }>;
  } | null;
  limitations: string[];
}

export interface AnnualQuantDiagnosticGap {
  status: AnnualQuantDiagnosticStatus;
  limitation: string;
}

export interface AnnualQuantProductView {
  status: DecisionQuantEvidence["status"];
  evidence: DecisionQuantEvidence;
  model: {
    modelVersion: string | null;
    universe: string[];
    sourceClassification: string;
    adjustment: string | null;
    dataCutoff: string | null;
    snapshotId: string | null;
    snapshotHash: string | null;
    codeIdentity: string | null;
  };
  diagnostics: {
    benchmark: AnnualQuantDiagnosticGap;
    sampleSize: AnnualQuantDiagnosticGap;
    concentration: AnnualQuantDiagnosticGap;
    parameterNeighborhood: AnnualQuantDiagnosticGap;
    marketEnvironment: AnnualQuantDiagnosticGap;
    failedExperiments: {
      status: AnnualQuantDiagnosticStatus;
      experimentIds: string[];
      limitation: string;
    };
  };
  filter: {
    status: "available" | "not_captured" | "unavailable";
    criteria: AnnualQuantFilterInput;
    samples: Array<{
      sampleId: "train" | "validation" | "final_test";
      sourceIndex: number;
      maxDrawdownMagnitude: number;
      turnoverOneWay: number;
      tradeCount: number;
      matchesMaxDrawdown: boolean;
      matchesMaxTurnover: boolean;
      matchesMinTradeCount: boolean;
      allCriteriaMatched: boolean;
    }>;
    preservesSourceOrder: true;
    ranking: false;
    score: false;
    recommendation: false;
  };
  limitations: string[];
}

export interface AnnualValuationQuantWorkbenchData {
  target: {
    membershipId: string;
    membershipVersion: number;
    membershipState: "tracked" | "paused" | "archived";
    market: "HK";
    code: string;
    symbol: string;
  };
  sourceIdentity: {
    decisionContextId: string;
    decisionContextHash: string;
    generatedAt: string;
  };
  valuation: AnnualValuationResult;
  quant: AnnualQuantProductView;
}

export interface AnnualValuationQuantWorkbenchEnvelope {
  schemaVersion: typeof ANNUAL_VALUATION_QUANT_WORKBENCH_SCHEMA_VERSION;
  generatedAt: string;
  status: AnnualValuationQuantWorkbenchStatus;
  membershipId: string;
  requestedActorId: string;
  requestedSymbol: string | null;
  metadata: FactMetadata;
  data: AnnualValuationQuantWorkbenchData | null;
  safety: {
    advisoryOnly: true;
    userInputsRequired: true;
    changesCandidateOrdering: false;
    recommendation: false;
    ranking: false;
    score: false;
    targetPrice: false;
    targetPosition: false;
    tradeDirection: false;
    createsOrder: false;
    createsTrade: false;
    callsBroker: false;
    mutatesOfficialPortfolio: false;
  };
  message: string;
}

export function validateAnnualValuationScenarioInput(value: unknown): {
  ok: true;
  value: AnnualValuationScenarioInput;
} | {
  ok: false;
  errors: string[];
} {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["valuation scenario input must be an object"] };
  exactKeysWithOptional(value, [
    "methodId", "metricCurrency", "shareBasis", "baseMetricPerShare", "annualGrowthRate", "horizonYears", "terminalMultiple",
    "annualDiscountRate", "netCashPerShare", "growthRateStep", "multipleStep"
  ], ["methodId", "metricCurrency", "shareBasis"], "valuation scenario input", errors);
  if (value.methodId !== undefined && ![
    "discounted_forward_metric_multiple_user_scenario",
    "adjusted_net_asset_value_user_scenario"
  ].includes(String(value.methodId))) errors.push("methodId is invalid");
  if (value.metricCurrency !== undefined
    && (typeof value.metricCurrency !== "string" || !/^[A-Z]{3}$/.test(value.metricCurrency))) {
    errors.push("metricCurrency must be a three-letter uppercase currency code");
  }
  if (value.shareBasis !== undefined && !["basic", "diluted"].includes(String(value.shareBasis))) {
    errors.push("shareBasis must be basic or diluted");
  }
  boundedNumber(value.baseMetricPerShare, "baseMetricPerShare", 0.000001, 1_000_000, errors);
  boundedNumber(value.annualGrowthRate, "annualGrowthRate", -0.95, 3, errors);
  boundedInteger(value.horizonYears, "horizonYears", 1, 20, errors);
  boundedNumber(value.terminalMultiple, "terminalMultiple", 0.1, 200, errors);
  boundedNumber(value.annualDiscountRate, "annualDiscountRate", 0, 1, errors);
  boundedNumber(value.netCashPerShare, "netCashPerShare", -1_000_000, 1_000_000, errors);
  boundedNumber(value.growthRateStep, "growthRateStep", 0.0001, 1, errors);
  boundedNumber(value.multipleStep, "multipleStep", 0.01, 100, errors);
  return errors.length === 0
    ? { ok: true, value: value as unknown as AnnualValuationScenarioInput }
    : { ok: false, errors };
}

/** New inputs use a percentage realization rate; historical v1 calculations keep their exact values. */
export function validateNewAnnualValuationScenarioInput(value: unknown): ReturnType<typeof validateAnnualValuationScenarioInput> {
  const validated = validateAnnualValuationScenarioInput(value);
  if (!validated.ok || validated.value.methodId !== "adjusted_net_asset_value_user_scenario") return validated;
  if (validated.value.terminalMultiple > 1
    || validated.value.terminalMultiple + validated.value.multipleStep > 1) {
    return { ok: false, errors: ["assetRealizationRate and its bull sensitivity must be at most 100%"] };
  }
  return validated;
}

export function validateAnnualQuantFilterInput(value: unknown): {
  ok: true;
  value: AnnualQuantFilterInput;
} | {
  ok: false;
  errors: string[];
} {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["quant filter input must be an object"] };
  exactKeys(value, ["maxDrawdownMagnitude", "maxTurnoverOneWay", "minTradeCount"], "quant filter input", errors);
  boundedNumber(value.maxDrawdownMagnitude, "maxDrawdownMagnitude", 0, 1, errors);
  boundedNumber(value.maxTurnoverOneWay, "maxTurnoverOneWay", 0, 1_000_000, errors);
  boundedInteger(value.minTradeCount, "minTradeCount", 0, 1_000_000, errors);
  return errors.length === 0
    ? { ok: true, value: value as unknown as AnnualQuantFilterInput }
    : { ok: false, errors };
}

export function validateAnnualValuationQuantWorkbenchEnvelope(value: unknown): {
  ok: true;
} | {
  ok: false;
  errors: string[];
} {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["valuation quant workbench envelope must be an object"] };
  exactKeys(value, [
    "schemaVersion", "generatedAt", "status", "membershipId", "requestedActorId",
    "requestedSymbol", "metadata", "data", "safety", "message"
  ], "valuation quant workbench envelope", errors);
  if (value.schemaVersion !== ANNUAL_VALUATION_QUANT_WORKBENCH_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${ANNUAL_VALUATION_QUANT_WORKBENCH_SCHEMA_VERSION}`);
  }
  isoDateTime(value.generatedAt, "generatedAt", errors);
  if (!ANNUAL_VALUATION_QUANT_WORKBENCH_STATUSES.includes(value.status as AnnualValuationQuantWorkbenchStatus)) {
    errors.push("status is invalid");
  }
  nonEmptyString(value.membershipId, "membershipId", errors);
  nonEmptyString(value.requestedActorId, "requestedActorId", errors);
  if (!(typeof value.requestedSymbol === "string" || value.requestedSymbol === null)) {
    errors.push("requestedSymbol must be a string or null");
  }
  validateFactMetadataInto(value.metadata, "metadata", errors);
  if (value.status === "available" && isRecord(value.metadata) && !areInstantsChronologicallyOrdered([value.metadata.asOf, value.metadata.fetchedAt, value.generatedAt])) errors.push("available workbench metadata must not be after generatedAt");
  validateSafety(value.safety, errors);
  nonEmptyString(value.message, "message", errors);
  if (value.status === "available") {
    if (!isRecord(value.data)) errors.push("available workbench requires data");
    else validateAvailableData(value, value.data, errors);
  } else {
    if (value.data !== null) errors.push("non-available workbench must not expose data");
    if (value.requestedSymbol !== null) errors.push("non-available workbench must not expose requestedSymbol");
    if (isRecord(value.metadata) && value.metadata.freshness === "fresh") {
      errors.push("non-available workbench metadata must not be fresh");
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateAvailableData(
  envelope: Record<string, unknown>,
  data: Record<string, unknown>,
  errors: string[]
): void {
  exactKeys(data, ["target", "sourceIdentity", "valuation", "quant"], "valuation quant workbench data", errors);
  validateTarget(envelope, data.target, errors);
  validateSourceIdentity(envelope, data.target, data.sourceIdentity, errors);
  const symbol = isRecord(data.target) ? data.target.symbol : null;
  validateValuation(symbol, data.valuation, envelope.generatedAt, errors);
  validateQuant(symbol, data.quant, envelope.generatedAt, errors);
  if (isRecord(envelope.metadata)) {
    if (envelope.metadata.source !== "annual_valuation_quant_workbench:candidate_intake_quote_quant") {
      errors.push("available workbench metadata source is invalid");
    }
    if (envelope.metadata.authority !== "research_evidence") {
      errors.push("available workbench authority must remain research_evidence");
    }
  }
}

function validateTarget(envelope: Record<string, unknown>, value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("target must be an object");
    return;
  }
  exactKeys(value, ["membershipId", "membershipVersion", "membershipState", "market", "code", "symbol"], "target", errors);
  if (value.membershipId !== envelope.membershipId) errors.push("target membershipId must match envelope");
  boundedInteger(value.membershipVersion, "target.membershipVersion", 1, Number.MAX_SAFE_INTEGER, errors);
  if (!["tracked", "paused", "archived"].includes(String(value.membershipState))) errors.push("target membershipState is invalid");
  if (value.market !== "HK" || typeof value.code !== "string" || !/^\d{5}$/.test(value.code)
    || value.symbol !== `HK.${value.code}` || value.symbol !== envelope.requestedSymbol) {
    errors.push("target must bind one canonical Hong Kong symbol");
  }
}

function validateSourceIdentity(
  envelope: Record<string, unknown>,
  target: unknown,
  value: unknown,
  errors: string[]
): void {
  if (!isRecord(value)) {
    errors.push("sourceIdentity must be an object");
    return;
  }
  exactKeys(value, ["decisionContextId", "decisionContextHash", "generatedAt"], "sourceIdentity", errors);
  isoDateTime(value.generatedAt, "sourceIdentity.generatedAt", errors);
  if (value.generatedAt !== envelope.generatedAt) errors.push("sourceIdentity generatedAt must match envelope");
  if (typeof value.decisionContextHash !== "string" || !/^[a-f0-9]{64}$/.test(value.decisionContextHash)) {
    errors.push("sourceIdentity decisionContextHash must be SHA-256");
  }
  if (isRecord(target) && typeof target.symbol === "string" && typeof value.decisionContextHash === "string"
    && value.decisionContextId !== `decision-context:${target.symbol}:${value.decisionContextHash.slice(0, 16)}`) {
    errors.push("sourceIdentity decisionContextId must bind target and hash");
  }
}

function validateValuation(symbol: unknown, value: unknown, generatedAt: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("valuation must be an object");
    return;
  }
  exactKeys(value, ["status", "quote", "inputs", "method", "outputs", "sensitivity", "limitations"], "valuation", errors);
  if (!["available", "stale", "missing", "conflict", "unavailable"].includes(String(value.status))) {
    errors.push("valuation status is invalid");
  }
  const inputValidation = validateAnnualValuationScenarioInput(value.inputs);
  if (!inputValidation.ok) errors.push(...inputValidation.errors.map((error) => `valuation.inputs.${error}`));
  validateMethod(value.method, errors);
  boundedStrings(value.limitations, "valuation.limitations", 20, errors);
  if (value.status !== "available") {
    if (value.quote !== null || value.outputs !== null || value.sensitivity !== null) {
      errors.push("fail-closed valuation must not expose quote calculations or sensitivity");
    }
    return;
  }
  validateValuationQuote(symbol, value.quote, generatedAt, errors);
  if (isRecord(value.quote)
    && value.quote.currency !== (inputValidation.ok ? inputValidation.value.metricCurrency : undefined)) {
    errors.push("available valuation requires the exact user metric currency to match the quote currency");
  }
  validateValuationOutputs(value.outputs, errors);
  validateSensitivity(value.sensitivity, errors);
  validateValuationRecomputation(value.quote, value.inputs, value.outputs, value.sensitivity, errors);
}

function validateMethod(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("valuation method must be an object");
    return;
  }
  exactKeysWithOptional(value, ["id", "calculationVersion", "presentValueFormula", "impliedExpectationFormula", "rounding", "applicability"], ["applicability"], "valuation method", errors);
  const adjusted = value.id === "adjusted_net_asset_value_user_scenario";
  if (!["discounted_forward_metric_multiple_user_scenario", "adjusted_net_asset_value_user_scenario"].includes(String(value.id))
    || value.calculationVersion !== (adjusted ? ANNUAL_ADJUSTED_NET_ASSET_CALCULATION_VERSION : ANNUAL_VALUATION_CALCULATION_VERSION)
    || value.presentValueFormula !== (adjusted ? ANNUAL_ADJUSTED_NET_ASSET_VALUE_FORMULA : ANNUAL_VALUATION_PRESENT_VALUE_FORMULA)
    || value.impliedExpectationFormula !== ANNUAL_VALUATION_IMPLIED_EXPECTATION_FORMULA
    || value.rounding !== "decimal_places_6") {
    errors.push("valuation method identity is invalid");
  }
  if (value.applicability !== undefined) validateMethodApplicability(value.applicability, adjusted, errors);
}

function validateMethodApplicability(value: unknown, adjusted: boolean, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("valuation method applicability must be an object");
    return;
  }
  exactKeys(value, ["ownerConfirmed", "companyDataBasis", "requiredAnchorMetrics", "limitation"], "valuation method applicability", errors);
  const expectedBasis = adjusted ? "reported_balance_sheet_net_assets_per_share" : "forward_operating_metric_per_share";
  const expectedMetrics = adjusted ? ["total_assets", "total_liabilities"] : ["revenue", "profit_attributable_to_owners"];
  if (value.ownerConfirmed !== true || value.companyDataBasis !== expectedBasis
    || !sameStrings(value.requiredAnchorMetrics, expectedMetrics)) {
    errors.push("valuation method applicability does not match the selected company-data basis");
  }
  nonEmptyString(value.limitation, "valuation method applicability limitation", errors);
}

function validateValuationQuote(symbol: unknown, value: unknown, generatedAt: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("available valuation requires quote");
    return;
  }
  exactKeys(value, ["snapshotId", "symbol", "currency", "price", "quoteTime", "fetchedAt", "source"], "valuation quote", errors);
  if (value.symbol !== symbol || typeof value.snapshotId !== "string" || !value.snapshotId.startsWith(`${String(symbol)}:`)) {
    errors.push("valuation quote identity must bind the target symbol");
  }
  nonEmptyString(value.currency, "valuation quote currency", errors);
  boundedNumber(value.price, "valuation quote price", Number.MIN_VALUE, 1_000_000_000, errors);
  isoDateTime(value.quoteTime, "valuation quote quoteTime", errors);
  isoDateTime(value.fetchedAt, "valuation quote fetchedAt", errors);
  if (!areInstantsChronologicallyOrdered([value.quoteTime, value.fetchedAt, generatedAt])) errors.push("valuation quote must satisfy quoteTime <= fetchedAt <= generatedAt");
  nonEmptyString(value.source, "valuation quote source", errors);
}

function validateValuationOutputs(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("available valuation requires outputs");
    return;
  }
  exactKeysWithOptional(value, [
    "projectedMetricPerShare", "scenarioPresentValuePerShare",
    "impliedAnnualGrowthRateAtCurrentPrice", "impliedExpectationStatus", "valueRange", "scenarioMarginOfSafety"
  ], ["valueRange", "scenarioMarginOfSafety"], "valuation outputs", errors);
  boundedNumber(value.projectedMetricPerShare, "valuation projectedMetricPerShare", Number.MIN_VALUE, 1_000_000_000_000, errors);
  boundedNumber(value.scenarioPresentValuePerShare, "valuation scenarioPresentValuePerShare", Number.MIN_VALUE, 1_000_000_000_000, errors);
  if (!["available", "not_computable"].includes(String(value.impliedExpectationStatus))) {
    errors.push("valuation impliedExpectationStatus is invalid");
  }
  if (value.impliedExpectationStatus === "available") {
    boundedNumber(value.impliedAnnualGrowthRateAtCurrentPrice, "valuation impliedAnnualGrowthRateAtCurrentPrice", -0.999999, 1000, errors);
  } else if (value.impliedAnnualGrowthRateAtCurrentPrice !== null) {
    errors.push("not-computable implied expectation must be null");
  }
  if (value.valueRange !== undefined) {
    if (!isRecord(value.valueRange)) errors.push("valuation valueRange must be an object");
    else {
      exactKeys(value.valueRange, ["low", "high", "interpretation"], "valuation valueRange", errors);
      if (!finiteNumber(value.valueRange.low) || !finiteNumber(value.valueRange.high)
        || value.valueRange.low <= 0 || value.valueRange.low > value.valueRange.high
        || value.valueRange.interpretation !== "research_scenario_range_not_target_price") {
        errors.push("valuation valueRange must be a positive research scenario range");
      }
    }
  }
  if (value.scenarioMarginOfSafety !== undefined) {
    errors.push(...annualValuationScenarioMarginErrors(value.scenarioMarginOfSafety)
      .map((error) => `valuation scenarioMarginOfSafety ${error}`));
  }
}

function validateSensitivity(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("available valuation requires sensitivity");
    return;
  }
  exactKeys(value, ["growthRates", "terminalMultiples", "cells"], "valuation sensitivity", errors);
  if (!Array.isArray(value.growthRates) || value.growthRates.length !== 3
    || !value.growthRates.every((item) => finiteNumber(item))) errors.push("sensitivity growthRates must contain three finite values");
  if (!Array.isArray(value.terminalMultiples) || value.terminalMultiples.length !== 3
    || !value.terminalMultiples.every((item) => finiteNumber(item))) errors.push("sensitivity terminalMultiples must contain three finite values");
  if (!Array.isArray(value.cells) || value.cells.length !== 9) {
    errors.push("sensitivity must contain nine cells");
  } else {
    value.cells.forEach((cell, index) => {
      if (!isRecord(cell)) {
        errors.push(`sensitivity cell ${index} must be an object`);
        return;
      }
      exactKeys(cell, ["annualGrowthRate", "terminalMultiple", "presentValuePerShare"], `sensitivity cell ${index}`, errors);
      for (const field of ["annualGrowthRate", "terminalMultiple", "presentValuePerShare"] as const) {
        if (!finiteNumber(cell[field])) errors.push(`sensitivity cell ${index} ${field} must be finite`);
      }
    });
  }
}

function validateValuationRecomputation(
  quote: unknown,
  inputs: unknown,
  outputs: unknown,
  sensitivity: unknown,
  errors: string[]
): void {
  if (!isRecord(quote) || !isRecord(inputs) || !isRecord(outputs) || !isRecord(sensitivity)) return;
  const inputValidation = validateAnnualValuationScenarioInput(inputs);
  if (!inputValidation.ok || !finiteNumber(quote.price)) return;
  const input = inputValidation.value;
  const calculation = calculateAnnualValuationScenarioGrid(input);
  if (!calculation) {
    errors.push("valuation inputs do not produce a finite positive base scenario");
    return;
  }
  if (outputs.projectedMetricPerShare !== calculation.projectedMetricPerShare
    || outputs.scenarioPresentValuePerShare !== calculation.scenarioPresentValuePerShare) {
    errors.push("valuation outputs must recompute from the exact user inputs");
  }
  const scenarioValues = [calculation.cells[0], calculation.cells[4], calculation.cells[8]]
    .map((cell) => cell?.presentValuePerShare)
    .filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  if (outputs.valueRange !== undefined && (!isRecord(outputs.valueRange)
    || outputs.valueRange.low !== Math.min(...scenarioValues)
    || outputs.valueRange.high !== Math.max(...scenarioValues))) {
    errors.push("valuation valueRange must recompute from the bear base bull scenarios");
  }
  if (outputs.scenarioMarginOfSafety !== undefined) {
    const low = Math.min(...scenarioValues);
    const high = Math.max(...scenarioValues);
    const expected = calculateAnnualValuationScenarioMargin(quote.price, low, calculation.scenarioPresentValuePerShare, high);
    errors.push(...annualValuationScenarioMarginErrors(outputs.scenarioMarginOfSafety, expected)
      .map((error) => `valuation scenarioMarginOfSafety ${error}`));
  }
  const impliedBase = (quote.price - input.netCashPerShare) * calculation.discountFactor
    / (input.baseMetricPerShare * input.terminalMultiple);
  const implied = impliedBase > 0 ? Math.pow(impliedBase, 1 / input.horizonYears) - 1 : null;
  const expectedImplied = implied === null || !Number.isFinite(implied) ? null : roundSix(implied);
  if (outputs.impliedAnnualGrowthRateAtCurrentPrice !== expectedImplied
    || outputs.impliedExpectationStatus !== (expectedImplied === null ? "not_computable" : "available")) {
    errors.push("valuation implied expectation must recompute from the exact current quote and user inputs");
  }
  if (!sameNumbers(sensitivity.growthRates, calculation.growthRates)
    || !sameNumbers(sensitivity.terminalMultiples, calculation.terminalMultiples)) {
    errors.push("valuation sensitivity axes must derive from the exact user steps");
    return;
  }
  if (!Array.isArray(sensitivity.cells) || sensitivity.cells.some((cell, index) => {
    const expected = calculation.cells[index];
    return !isRecord(cell) || !expected
      || cell.annualGrowthRate !== expected.annualGrowthRate
      || cell.terminalMultiple !== expected.terminalMultiple
      || cell.presentValuePerShare !== expected.presentValuePerShare;
  })) {
    errors.push("valuation sensitivity cells must recompute in growth-major source order");
  }
}

function validateQuant(symbol: unknown, value: unknown, generatedAt: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("quant must be an object");
    return;
  }
  exactKeys(value, ["status", "evidence", "model", "diagnostics", "filter", "limitations"], "quant", errors);
  if (!isRecord(value.evidence)) {
    errors.push("quant evidence must be an object");
    return;
  }
  validateCanonicalQuantEvidenceShape(value.evidence, errors);
  validateDecisionQuantEvidenceInto(value.evidence, symbol, errors, generatedAt);
  if (value.status !== value.evidence.status) errors.push("quant status must match canonical evidence status");
  validateQuantModel(value.evidence, value.model, errors);
  validateQuantDiagnostics(value.evidence, value.diagnostics, errors);
  validateQuantFilter(value.evidence, value.filter, errors);
  boundedStrings(value.limitations, "quant.limitations", 50, errors);
}

function validateCanonicalQuantEvidenceShape(evidence: Record<string, unknown>, errors: string[]): void {
  exactKeysWithOptional(evidence, [
    "status", "metadata", "identities", "sampleBoundary", "limitations", "authority",
    "decisionEvidence", "comparison", "message"
  ], ["decisionEvidence", "comparison"], "quant evidence", errors);
  if (isRecord(evidence.metadata)) {
    exactKeys(evidence.metadata, [
      "source", "asOf", "fetchedAt", "freshness", "provenance", "authority",
      "stale", "missing", "conflict", "fixture", "correctionOf", "replaces", "message"
    ], "quant evidence metadata", errors);
  }
  if (isRecord(evidence.identities)) {
    exactKeysWithOptional(evidence.identities, [
      "frozenSnapshot", "baselineExperimentIdentity", "splitIds", "shadowPortfolioIdentity",
      "shadowPortfolioId", "generatedAt", "hkConnectUniverse"
    ], ["hkConnectUniverse"], "quant evidence identities", errors);
    if (isRecord(evidence.identities.frozenSnapshot)) {
      exactKeys(evidence.identities.frozenSnapshot, [
        "snapshotId", "snapshotHash", "dataHash", "sourceClassification"
      ], "quant evidence frozen snapshot", errors);
    }
  }
  if (isRecord(evidence.sampleBoundary)) {
    exactKeys(evidence.sampleBoundary, [
      "universe", "sourceClassification", "finalTestPolicy", "limitation"
    ], "quant evidence sample boundary", errors);
  }
  if (isRecord(evidence.authority)) {
    exactKeys(evidence.authority, [
      "researchOnly", "advisoryOnly", "changesCandidateOrdering", "changesMembershipState",
      "changesHumanReviewResult", "mutatesLocalRecord", "officialReviewFact",
      "officialPortfolioFact", "brokerWrite", "recommendation", "ranking", "score",
      "allocation", "sizing", "targetPrice", "buySellHold", "orderTradeFillAuthority",
      "cashFeePositionMutation"
    ], "quant evidence authority", errors);
  }
}

function validateQuantModel(evidence: Record<string, unknown>, value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("quant model must be an object");
    return;
  }
  exactKeys(value, [
    "modelVersion", "universe", "sourceClassification", "adjustment", "dataCutoff",
    "snapshotId", "snapshotHash", "codeIdentity"
  ], "quant model", errors);
  boundedStrings(value.universe, "quant model universe", 500, errors, true);
  nonEmptyString(value.sourceClassification, "quant model sourceClassification", errors);
  for (const field of ["modelVersion", "adjustment", "dataCutoff", "snapshotId", "snapshotHash", "codeIdentity"] as const) {
    optionalString(value[field], `quant model ${field}`, errors);
  }
  if (isRecord(evidence.identities)) {
    const frozen = isRecord(evidence.identities.frozenSnapshot) ? evidence.identities.frozenSnapshot : null;
    const boundary = isRecord(evidence.sampleBoundary) ? evidence.sampleBoundary : null;
    if (value.modelVersion !== evidence.identities.baselineExperimentIdentity
      || value.snapshotId !== frozen?.snapshotId || value.snapshotHash !== frozen?.snapshotHash
      || value.sourceClassification !== boundary?.sourceClassification
      || value.codeIdentity !== evidence.identities.baselineExperimentIdentity
      || !sameStrings(value.universe, boundary?.universe)) {
      errors.push("quant model must bind canonical outer evidence identities");
    }
    const refinement = isRecord(evidence.decisionEvidence) ? evidence.decisionEvidence : null;
    const source = refinement?.status === "available" && isRecord(refinement.source) ? refinement.source : null;
    if (value.adjustment !== (source?.adjustment ?? null) || value.dataCutoff !== (source?.dataCutoff ?? null)) {
      errors.push("quant model adjustment and dataCutoff must bind canonical refinement source facts");
    }
  } else if ([value.modelVersion, value.snapshotId, value.snapshotHash, value.codeIdentity].some((item) => item !== null)) {
    errors.push("fail-closed quant model must not expose unavailable identities");
  }
}
function validateQuantDiagnostics(evidence: Record<string, unknown>, value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("quant diagnostics must be an object");
    return;
  }
  exactKeys(value, ["benchmark", "sampleSize", "concentration", "parameterNeighborhood", "marketEnvironment", "failedExperiments"], "quant diagnostics", errors);
  const expectedGapStatus = evidence.status === "available" ? "not_captured" : "unavailable";
  validateFormalDiagnostic(evidence, value.benchmark, "quant diagnostics benchmark", "benchmark", expectedGapStatus, errors);
  const hasSamples = isRecord(evidence.decisionEvidence) && evidence.decisionEvidence.status === "available" && Array.isArray(evidence.decisionEvidence.samples) && evidence.decisionEvidence.samples.length > 0 && evidence.decisionEvidence.samples.every((sample) => isRecord(sample) && isRecord(sample.metrics) && sample.metrics.simulatedClosedRoundTripCount !== undefined);
  validateDiagnosticGap(value.sampleSize, "quant diagnostics sampleSize", hasSamples ? "available" : expectedGapStatus, errors);
  validateFormalDiagnostic(evidence, value.concentration, "quant diagnostics concentration", "trade_stock_month_concentration", expectedGapStatus, errors);
  validateFormalDiagnostic(evidence, value.parameterNeighborhood, "quant diagnostics parameterNeighborhood", "parameter_search", expectedGapStatus, errors);
  validateDiagnosticGap(value.marketEnvironment, "quant diagnostics marketEnvironment", expectedGapStatus, errors);
  const failed = value.failedExperiments;
  if (!isRecord(failed)) {
    errors.push("quant failedExperiments must be an object");
  } else {
    exactKeys(failed, ["status", "experimentIds", "limitation"], "quant failedExperiments", errors);
    if (!["available", "not_captured", "unavailable"].includes(String(failed.status))) errors.push("quant failedExperiments status is invalid");
    boundedStrings(failed.experimentIds, "quant failedExperiments experimentIds", 100, errors, true);
    nonEmptyString(failed.limitation, "quant failedExperiments limitation", errors);
    const decisionEvidence = isRecord(evidence.decisionEvidence) && evidence.decisionEvidence.status === "available"
      ? evidence.decisionEvidence
      : null;
    const robustness = isRecord(decisionEvidence?.robustness) ? decisionEvidence?.robustness : null;
    const sourceFailed = isRecord(robustness?.failedExperiments) ? robustness?.failedExperiments : null;
    if (sourceFailed && (failed.status !== (sourceFailed.status === "registered" ? "available" : "not_captured")
      || !sameStrings(failed.experimentIds, sourceFailed.experimentIds)
      || failed.limitation !== sourceFailed.limitation)) {
      errors.push("quant failedExperiments must bind canonical refinement facts");
    } else if (!sourceFailed && (failed.status !== expectedGapStatus
      || !Array.isArray(failed.experimentIds) || failed.experimentIds.length !== 0)) {
      errors.push("quant failedExperiments must remain an empty explicit gap without canonical refinement facts");
    }
  }
}

function validateDiagnosticGap(
  value: unknown,
  label: string,
  expectedStatus: AnnualQuantDiagnosticStatus,
  errors: string[]
): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  exactKeys(value, ["status", "limitation"], label, errors);
  if (value.status !== expectedStatus) errors.push(`${label} status must match canonical quant evidence availability`);
  nonEmptyString(value.limitation, `${label} limitation`, errors);
}

function validateFormalDiagnostic(
  evidence: Record<string, unknown>,
  value: unknown,
  label: string,
  checkId: string,
  expectedGapStatus: "not_captured" | "unavailable",
  errors: string[]
): void {
  const refinement = isRecord(evidence.decisionEvidence) && evidence.decisionEvidence.status === "available"
    ? evidence.decisionEvidence
    : null;
  const formalEvidence = isRecord(refinement?.formalEvidence) ? refinement.formalEvidence : null;
  const checks = Array.isArray(formalEvidence?.checks) ? formalEvidence.checks.filter(isRecord) : [];
  const source = checks.find((check) => check.id === checkId);
  const expectedStatus = source?.status === "available" ? "available" : expectedGapStatus;
  validateDiagnosticGap(value, label, expectedStatus, errors);
  if (expectedStatus === "available" && isRecord(value) && value.limitation !== source?.limitation) {
    errors.push(`${label} must bind the canonical formal evidence limitation`);
  }
}

function validateQuantFilter(evidence: Record<string, unknown>, value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("quant filter must be an object");
    return;
  }
  exactKeys(value, ["status", "criteria", "samples", "preservesSourceOrder", "ranking", "score", "recommendation"], "quant filter", errors);
  if (!["available", "not_captured", "unavailable"].includes(String(value.status))) errors.push("quant filter status is invalid");
  const criteria = validateAnnualQuantFilterInput(value.criteria);
  if (!criteria.ok) errors.push(...criteria.errors.map((error) => `quant.filter.criteria.${error}`));
  if (value.preservesSourceOrder !== true || value.ranking !== false || value.score !== false || value.recommendation !== false) {
    errors.push("quant filter must preserve source order without ranking score or recommendation");
  }
  if (!Array.isArray(value.samples)) {
    errors.push("quant filter samples must be an array");
    return;
  }
  const decisionEvidence = isRecord(evidence.decisionEvidence) && evidence.decisionEvidence.status === "available"
    ? evidence.decisionEvidence
    : null;
  const expectedStatus = decisionEvidence
    ? "available"
    : evidence.status === "available" ? "not_captured" : "unavailable";
  if (value.status !== expectedStatus) {
    errors.push("quant filter status must match canonical refinement availability");
  }
  if (expectedStatus !== "available") {
    if (value.samples.length !== 0) errors.push("non-available quant filter must not expose sample results");
    return;
  }
  const sourceSamples = Array.isArray(decisionEvidence?.samples) ? decisionEvidence.samples.filter(isRecord) : [];
  if (sourceSamples.length !== value.samples.length) errors.push("quant filter samples must cover canonical refinement samples");
  value.samples.forEach((sample, index) => {
    if (!isRecord(sample)) {
      errors.push(`quant filter sample ${index} must be an object`);
      return;
    }
    exactKeys(sample, [
      "sampleId", "sourceIndex", "maxDrawdownMagnitude", "turnoverOneWay", "tradeCount",
      "matchesMaxDrawdown", "matchesMaxTurnover", "matchesMinTradeCount", "allCriteriaMatched"
    ], `quant filter sample ${index}`, errors);
    if (sample.sourceIndex !== index || sample.sampleId !== sourceSamples[index]?.id) {
      errors.push("quant filter samples must preserve canonical source order");
    }
    const matches = [sample.matchesMaxDrawdown, sample.matchesMaxTurnover, sample.matchesMinTradeCount];
    if (!matches.every((item) => typeof item === "boolean") || sample.allCriteriaMatched !== matches.every(Boolean)) {
      errors.push(`quant filter sample ${index} criteria result is inconsistent`);
    }
    const sourceMetrics = isRecord(sourceSamples[index]?.metrics) ? sourceSamples[index]?.metrics : null;
    if (!criteria.ok || !sourceMetrics) return;
    const expectedDrawdown = finiteNumber(sourceMetrics.simulatedMaxDrawdown)
      ? roundSix(Math.abs(sourceMetrics.simulatedMaxDrawdown))
      : null;
    const expectedTurnover = finiteNumber(sourceMetrics.simulatedTurnoverOneWay)
      ? roundSix(sourceMetrics.simulatedTurnoverOneWay)
      : null;
    const expectedTrades = typeof sourceMetrics.simulatedTradeCount === "number"
      && Number.isSafeInteger(sourceMetrics.simulatedTradeCount)
      ? sourceMetrics.simulatedTradeCount
      : null;
    if (sample.maxDrawdownMagnitude !== expectedDrawdown
      || sample.turnoverOneWay !== expectedTurnover
      || sample.tradeCount !== expectedTrades
      || sample.matchesMaxDrawdown !== (expectedDrawdown !== null && expectedDrawdown <= criteria.value.maxDrawdownMagnitude)
      || sample.matchesMaxTurnover !== (expectedTurnover !== null && expectedTurnover <= criteria.value.maxTurnoverOneWay)
      || sample.matchesMinTradeCount !== (expectedTrades !== null && expectedTrades >= criteria.value.minTradeCount)) {
      errors.push(`quant filter sample ${index} must recompute from canonical sample metrics and user criteria`);
    }
  });
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("safety must be an object");
    return;
  }
  exactKeys(value, [
    "advisoryOnly", "userInputsRequired", "changesCandidateOrdering", "recommendation",
    "ranking", "score", "targetPrice", "targetPosition", "tradeDirection", "createsOrder",
    "createsTrade", "callsBroker", "mutatesOfficialPortfolio"
  ], "safety", errors);
  if (value.advisoryOnly !== true || value.userInputsRequired !== true) errors.push("safety must remain user-input advisory only");
  for (const field of [
    "changesCandidateOrdering", "recommendation", "ranking", "score", "targetPrice",
    "targetPosition", "tradeDirection", "createsOrder", "createsTrade", "callsBroker",
    "mutatesOfficialPortfolio"
  ] as const) {
    if (value[field] !== false) errors.push(`safety.${field} must be false`);
  }
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string, errors: string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) errors.push(`${label} contains unsupported field ${key}`);
  for (const key of allowed) if (!(key in value)) errors.push(`${label} is missing field ${key}`);
}

function exactKeysWithOptional(
  value: Record<string, unknown>,
  allowed: readonly string[],
  optional: readonly string[],
  label: string,
  errors: string[]
): void {
  const allowedSet = new Set(allowed);
  const optionalSet = new Set(optional);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) errors.push(`${label} contains unsupported field ${key}`);
  for (const key of allowed) if (!optionalSet.has(key) && !(key in value)) errors.push(`${label} is missing field ${key}`);
}

function nonEmptyString(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2_000) errors.push(`${label} must be a bounded non-empty string`);
}

function optionalString(value: unknown, label: string, errors: string[]): void {
  if (!(value === null || (typeof value === "string" && value.trim().length > 0 && value.length <= 2_000))) {
    errors.push(`${label} must be a bounded string or null`);
  }
}

function isoDateTime(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) errors.push(`${label} must be a valid date-time`);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function boundedNumber(value: unknown, label: string, min: number, max: number, errors: string[]): void {
  if (!finiteNumber(value) || value < min || value > max) errors.push(`${label} must be between ${min} and ${max}`);
}

function boundedInteger(value: unknown, label: string, min: number, max: number, errors: string[]): void {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) errors.push(`${label} must be an integer between ${min} and ${max}`);
}

function boundedStrings(value: unknown, label: string, max: number, errors: string[], allowEmpty = false): void {
  if (!Array.isArray(value) || value.length > max || (!allowEmpty && value.length === 0)
    || value.some((item) => typeof item !== "string" || item.trim().length === 0 || item.length > 2_000)) {
    errors.push(`${label} must be ${allowEmpty ? "bounded" : "non-empty bounded"} strings`);
  }
}

function sameStrings(left: unknown, right: unknown): boolean {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((item, index) => item === right[index]);
}

function sameNumbers(left: unknown, right: number[]): boolean {
  return Array.isArray(left) && left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function roundSix(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
