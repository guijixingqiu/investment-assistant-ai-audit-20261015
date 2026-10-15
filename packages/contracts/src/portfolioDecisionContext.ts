import crypto from "node:crypto";
import { canonicalJson } from "./decisionContext.js";
import { validatePortfolioContextDataUse, validatePortfolioContextStatus, validateZeroPositionPortfolioContext, validatePortfolioDisplayableProvenance, validatePortfolioUnrealizedPnl } from "./portfolioDecisionContextStatus.js";
import { validatePinganPortfolioFreshness, type PinganPortfolioFreshness } from "./pinganCurrentPortfolio.js";

export const PORTFOLIO_DECISION_CONTEXT_SCHEMA_VERSION = "2026-07-15.portfolio-decision-context.v1";
export const PORTFOLIO_RISK_IMPACT_SCHEMA_VERSION = "2026-07-15.portfolio-risk-impact.v1";
export const PORTFOLIO_RISK_CALCULATION_VERSION = "portfolio-risk-impact.v1";
export type PortfolioDecisionContextStatus = "available" | "stale" | "partial" | "zero_position" | "empty" | "conflict" | "unauthorized" | "unavailable";
export type PortfolioQuoteStatus = "current" | "stale" | "unavailable";

export interface PortfolioDecisionPosition {
  market: "HK";
  code: string;
  symbol: string;
  name: string | null;
  quantity: number;
  averageCost: number | null;
  unrealizedPnl: number | null;
  sourceWeight: number | null;
  currency: string | null;
  sourceRowId: string;
  quote: {
    status: PortfolioQuoteStatus;
    source: "futu" | null;
    quoteAsOf: string | null;
    fetchedAt: string | null;
  };
  latestPrice: number | null;
  marketValue: number | null;
  marketWeight: number | null;
}

export interface PortfolioDecisionContextEnvelope {
  schemaVersion: typeof PORTFOLIO_DECISION_CONTEXT_SCHEMA_VERSION;
  status: PortfolioDecisionContextStatus;
  contextId: string | null;
  portfolioSnapshotId: string | null;
  accountScopeId: string | null;
  portfolioSource: "pingan_imported_snapshot" | "owner_entered_current" | null;
  sourceAsOf: string | null;
  portfolioAsOf: string | null;
  importedAt: string | null;
  fetchedAt: string | null;
  freshness: PinganPortfolioFreshness | null;
  assembledAt: string;
  positions: PortfolioDecisionPosition[];
  summary: {
    positionCount: number;
    marketValue: {
      status: "complete_current" | "complete_stale" | "partial" | "unavailable";
      amount: number | null;
      currency: "HKD" | null;
      missingPositionCount: number;
    };
    cash: {
      status: "unknown";
      amount: null;
      currency: null;
      reason: "not_provided_by_authoritative_snapshot";
    };
    unrealizedPnl: number | null;
    concentration: {
      status: "available" | "unavailable";
      largestPositionWeight: number | null;
      topThreeWeight: number | null;
      hhi: number | null;
    };
  };
  dataUse: {
    display: "allowed" | "allowed_with_warning" | "blocked";
    advisoryRiskImpact: "allowed_current_development_only" | "blocked_stale" | "blocked_incomplete" | "blocked";
    productionPortfolio: "blocked_not_production_authority";
    brokerReconciliation: "blocked";
    accounting: "blocked";
    execution: "blocked";
  };
  gaps: string[];
  message: string;
}

export type PortfolioDecisionContextHashInput = Omit<PortfolioDecisionContextEnvelope, "contextId">;

export function computePortfolioDecisionContextId(input: PortfolioDecisionContextHashInput): string {
  const { assembledAt: _assembledAt, freshness: _freshness, ...factSet } = input;
  return `portfolio-decision-context:${crypto.createHash("sha256").update(canonicalJson(factSet)).digest("hex")}`;
}

export function portfolioDecisionContextHashInput(envelope: PortfolioDecisionContextEnvelope): PortfolioDecisionContextHashInput {
  const { contextId: _contextId, ...input } = envelope;
  return input;
}

export interface PortfolioRiskImpactEnvelope {
  schemaVersion: typeof PORTFOLIO_RISK_IMPACT_SCHEMA_VERSION;
  calculationVersion: typeof PORTFOLIO_RISK_CALCULATION_VERSION;
  status: "available" | "blocked" | "invalid";
  impactId: string | null;
  contextId: string | null;
  portfolioSnapshotId: string | null;
  candidateSymbol: string;
  hypotheticalAmount: number | null;
  currency: "HKD";
  current: {
    alreadyHeld: boolean | null;
    marketValue: number | null;
    weight: number | null;
  };
  scenario: {
    totalMarketValue: number | null;
    candidateMarketValue: number | null;
    candidateWeight: number | null;
    weightChange: number | null;
    largestPositionWeight: number | null;
    hhi: number | null;
  };
  gaps: string[];
  guardrails: {
    advisoryOnly: true;
    userProvidedAmountOnly: true;
    generatesDirection: false;
    recommendsAmount: false;
    recommendsTargetWeight: false;
    recommendsTiming: false;
    promisesReturn: false;
    createsOrder: false;
    productionWrite: false;
  };
  message: string;
}

export type PortfolioRiskImpactHashInput = Omit<PortfolioRiskImpactEnvelope, "impactId">;

export function computePortfolioRiskImpactId(input: PortfolioRiskImpactHashInput): string {
  return `portfolio-risk-impact:${crypto.createHash("sha256").update(canonicalJson(input)).digest("hex")}`;
}

export function portfolioRiskImpactHashInput(envelope: PortfolioRiskImpactEnvelope): PortfolioRiskImpactHashInput {
  const { impactId: _impactId, ...input } = envelope;
  return input;
}

export function validatePortfolioDecisionContextEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["context must be an object"] };
  if (value.schemaVersion !== PORTFOLIO_DECISION_CONTEXT_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  if (!["available", "stale", "partial", "zero_position", "empty", "conflict", "unauthorized", "unavailable"].includes(String(value.status))) errors.push("status is invalid");
  validateNullableString(value.contextId, "contextId", errors);
  validateNullableString(value.portfolioSnapshotId, "portfolioSnapshotId", errors);
  validateNullableString(value.accountScopeId, "accountScopeId", errors);
  if (value.portfolioSource !== null && !["pingan_imported_snapshot", "owner_entered_current"].includes(String(value.portfolioSource))) errors.push("portfolioSource is invalid");
  const hasProvenance = ["sourceAsOf", "importedAt", "fetchedAt", "freshness"].some((field) => Object.prototype.hasOwnProperty.call(value, field));
  if (hasProvenance) validateNullableDate(value.sourceAsOf, "sourceAsOf", errors);
  validateNullableDate(value.portfolioAsOf, "portfolioAsOf", errors);
  if (hasProvenance) {
    validateNullableDate(value.importedAt, "importedAt", errors);
    validateNullableDate(value.fetchedAt, "fetchedAt", errors);
    if (value.portfolioSource === "owner_entered_current") {
      if (value.freshness !== null) errors.push("owner-entered holdings must not claim broker polling freshness");
    } else validatePinganPortfolioFreshness(value.freshness, value.sourceAsOf, errors);
  }
  validateDate(value.assembledAt, "assembledAt", errors);
  const positions = Array.isArray(value.positions) ? value.positions : null;
  if (!positions || !positions.every(isValidDecisionPosition)) errors.push("positions are invalid");
  validateContextSummary(value.summary, positions ?? [], errors);
  validatePortfolioContextDataUse(value.status, value.dataUse, errors);
  if (!Array.isArray(value.gaps) || !value.gaps.every(isNonEmptyString)) errors.push("gaps are invalid");
  if (!isNonEmptyString(value.message)) errors.push("message is required");
  validatePortfolioContextStatus(value, positions ?? [], errors);
  validateDisplayableContextFacts(value, positions ?? [], errors, hasProvenance);
  if (typeof value.contextId === "string") {
    const expected = computePortfolioDecisionContextId(portfolioDecisionContextHashInput(value as unknown as PortfolioDecisionContextEnvelope));
    if (value.contextId !== expected) errors.push("contextId does not match canonical content");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validatePortfolioRiskImpactEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["risk impact must be an object"] };
  if (value.schemaVersion !== PORTFOLIO_RISK_IMPACT_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  if (value.calculationVersion !== PORTFOLIO_RISK_CALCULATION_VERSION) errors.push("calculationVersion is invalid");
  if (!["available", "blocked", "invalid"].includes(String(value.status))) errors.push("status is invalid");
  validateNullableString(value.impactId, "impactId", errors);
  validateNullableString(value.contextId, "contextId", errors);
  validateNullableString(value.portfolioSnapshotId, "portfolioSnapshotId", errors);
  if (typeof value.candidateSymbol !== "string" || !/^HK\.\d{5}$/.test(value.candidateSymbol)) errors.push("candidateSymbol is invalid");
  if (value.hypotheticalAmount !== null && !isFiniteNonNegative(value.hypotheticalAmount)) errors.push("hypotheticalAmount is invalid");
  if (value.currency !== "HKD") errors.push("currency must be HKD");
  validateRiskNumbers(value.current, ["marketValue", "weight"], errors);
  if (isRecord(value.current) && typeof value.current.alreadyHeld !== "boolean" && value.current.alreadyHeld !== null) errors.push("current.alreadyHeld is invalid");
  validateRiskNumbers(value.scenario, ["totalMarketValue", "candidateMarketValue", "candidateWeight", "weightChange", "largestPositionWeight", "hhi"], errors);
  if (!Array.isArray(value.gaps) || !value.gaps.every(isNonEmptyString)) errors.push("gaps are invalid");
  validateGuardrails(value.guardrails, errors);
  if (!isNonEmptyString(value.message)) errors.push("message is required");
  if (value.status === "available") {
    if (value.impactId === null || value.contextId === null || value.portfolioSnapshotId === null) errors.push("available risk impact requires bound identities");
    if (!isFiniteNonNegative(value.hypotheticalAmount)) errors.push("available risk impact requires hypotheticalAmount");
    if (!allRiskNumbersPresent(value.current, value.scenario)) errors.push("available risk impact requires complete calculations");
  } else {
    if (value.impactId !== null) errors.push("blocked or invalid risk impact must not expose impactId");
    if (hasAnyRiskCalculation(value.current, value.scenario)) errors.push("blocked or invalid risk impact must not expose calculations");
  }
  if (typeof value.impactId === "string") {
    const expected = computePortfolioRiskImpactId(portfolioRiskImpactHashInput(value as unknown as PortfolioRiskImpactEnvelope));
    if (value.impactId !== expected) errors.push("impactId does not match canonical content");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function isValidDecisionPosition(value: unknown): value is PortfolioDecisionPosition {
  if (!isRecord(value) || value.market !== "HK" || typeof value.code !== "string" || !/^\d{5}$/.test(value.code) || value.symbol !== `HK.${value.code}`) return false;
  if (!isFinitePositive(value.quantity) || !isFiniteNonNegativeOrNull(value.averageCost) || !isFiniteOrNull(value.unrealizedPnl) || !isUnitIntervalOrNull(value.sourceWeight)) return false;
  if (value.name !== null && typeof value.name !== "string") return false;
  if (value.currency !== null && typeof value.currency !== "string") return false;
  if (!isNonEmptyString(value.sourceRowId) || !isRecord(value.quote)) return false;
  if (!["current", "stale", "unavailable"].includes(String(value.quote.status))) return false;
  if (value.quote.source !== null && value.quote.source !== "futu") return false;
  if (value.quote.status === "unavailable") {
    if (value.quote.source !== null || value.quote.quoteAsOf !== null || value.quote.fetchedAt !== null) return false;
    if (value.latestPrice !== null || value.marketValue !== null || value.marketWeight !== null) return false;
  } else {
    if (value.quote.source !== "futu" || !isStrictDate(value.quote.quoteAsOf) || !isStrictDate(value.quote.fetchedAt)) return false;
    if (!isFinitePositive(value.latestPrice) || !isFiniteNonNegative(value.marketValue)) return false;
    if (Date.parse(value.quote.quoteAsOf) > Date.parse(value.quote.fetchedAt)) return false;
    if (!isFiniteOrNull(value.marketWeight)) return false;
  }
  return true;
}

function validateContextSummary(value: unknown, positions: unknown[], errors: string[]): void {
  if (!isRecord(value)) { errors.push("summary is required"); return; }
  if (value.positionCount !== positions.length) errors.push("summary.positionCount must equal positions.length");
  if (!isRecord(value.marketValue) || !["complete_current", "complete_stale", "partial", "unavailable"].includes(String(value.marketValue.status))) errors.push("summary.marketValue is invalid");
  else {
    if (!isFiniteOrNull(value.marketValue.amount)) errors.push("summary.marketValue.amount is invalid");
    if (value.marketValue.currency !== null && value.marketValue.currency !== "HKD") errors.push("summary.marketValue.currency is invalid");
    if (!Number.isInteger(value.marketValue.missingPositionCount) || (value.marketValue.missingPositionCount as number) < 0) errors.push("summary.marketValue.missingPositionCount is invalid");
  }
  if (!isRecord(value.cash) || value.cash.status !== "unknown" || value.cash.amount !== null || value.cash.currency !== null || value.cash.reason !== "not_provided_by_authoritative_snapshot") errors.push("summary.cash must remain explicit unknown");
  if (Object.prototype.hasOwnProperty.call(value, "unrealizedPnl") && !isFiniteOrNull(value.unrealizedPnl)) errors.push("summary.unrealizedPnl is invalid");
  if (!isRecord(value.concentration) || !["available", "unavailable"].includes(String(value.concentration.status))) errors.push("summary.concentration is invalid");
  else for (const field of ["largestPositionWeight", "topThreeWeight", "hhi"]) if (!isFiniteOrNull(value.concentration[field])) errors.push(`summary.concentration.${field} is invalid`);
}

function validateDisplayableContextFacts(value: Record<string, unknown>, positions: unknown[], errors: string[], hasProvenance: boolean): void {
  if (!["available", "stale", "partial", "zero_position"].includes(String(value.status))) return;
  const summary = isRecord(value.summary) ? value.summary : null;
  const marketValue = summary && isRecord(summary.marketValue) ? summary.marketValue : null;
  const concentration = summary && isRecord(summary.concentration) ? summary.concentration : null;
  validateAvailableContextFacts(value.status, positions, marketValue, errors);
  const validPositions = positions.filter(isRecord);
  validateDisplayableIdentityAndChronology(value, validPositions, errors);
  if (hasProvenance) validatePortfolioDisplayableProvenance(value, errors);
  const missingPositionCount = validatePositionMarketValues(validPositions, marketValue, errors);
  if (hasProvenance) validatePortfolioUnrealizedPnl(value, validPositions, errors);
  if (missingPositionCount > 0) {
    validateIncompleteDisplayableFacts(validPositions, marketValue, concentration, errors);
    return;
  }
  validateCompleteDisplayableFacts(value.status, validPositions, marketValue, concentration, errors);
}

function validateAvailableContextFacts(
  status: unknown,
  positions: unknown[],
  marketValue: Record<string, unknown> | null,
  errors: string[]
): void {
  if (status === "available" && !positions.every((position) => isRecord(position) && isRecord(position.quote) && position.quote.status === "current")) {
    errors.push("available context requires current quotes for every position");
  }
  if (status === "available" && (!marketValue
    || marketValue.status !== "complete_current"
    || !isFinitePositive(marketValue.amount)
    || marketValue.currency !== "HKD"
    || marketValue.missingPositionCount !== 0)) {
    errors.push("available context requires complete_current positive HKD market value with no missing positions");
  }
  if (status === "available" && !positions.every((position) => isRecord(position)
    && position.currency === "HKD"
    && isFiniteNonNegative(position.marketValue)
    && isUnitInterval(position.marketWeight))) {
    errors.push("available context requires complete HKD position market values and weights");
  }
}

function validateDisplayableIdentityAndChronology(
  value: Record<string, unknown>,
  validPositions: Record<string, unknown>[],
  errors: string[]
): void {
  const symbols = validPositions.map((position) => position.symbol);
  const sourceRows = validPositions.map((position) => position.sourceRowId);
  if (new Set(symbols).size !== symbols.length || new Set(sourceRows).size !== sourceRows.length) {
    errors.push("available context requires unique position symbols and source rows");
  }
  if (isStrictDate(value.assembledAt) && isStrictDate(value.portfolioAsOf)
    && Date.parse(value.portfolioAsOf) > Date.parse(value.assembledAt)) {
    errors.push("available context portfolioAsOf must not be after assembledAt");
  }
  const assembledAt = isStrictDate(value.assembledAt) ? value.assembledAt : null;
  if (assembledAt && validPositions.some((position) => {
    const fetchedAt = isRecord(position.quote) && isStrictDate(position.quote.fetchedAt)
      ? position.quote.fetchedAt
      : null;
    return fetchedAt !== null && Date.parse(fetchedAt) > Date.parse(assembledAt);
  })) {
    errors.push("displayable context quote fetchedAt must not be after assembledAt");
  }
}

function validatePositionMarketValues(
  validPositions: Record<string, unknown>[],
  marketValue: Record<string, unknown> | null,
  errors: string[]
): number {
  const missingPositionCount = validPositions.filter((position) => position.marketValue === null).length;
  if (marketValue && marketValue.missingPositionCount !== missingPositionCount) {
    errors.push("summary marketValue missingPositionCount must recompute from position facts");
  }
  for (const position of validPositions) {
    if (isFinitePositive(position.latestPrice)) {
      const expectedValue = round(Number(position.quantity) * position.latestPrice);
      if (position.marketValue !== expectedValue) errors.push("displayable context market values and weights must recompute from exact position quantities and Futu prices");
    }
  }
  return missingPositionCount;
}

function validateIncompleteDisplayableFacts(
  validPositions: Record<string, unknown>[],
  marketValue: Record<string, unknown> | null,
  concentration: Record<string, unknown> | null,
  errors: string[]
): void {
  if (!marketValue || marketValue.status !== "partial" || marketValue.amount !== null || marketValue.currency !== null) {
    errors.push("incomplete displayable context must expose partial market value with no synthesized total");
  }
  if (validPositions.some((position) => position.marketWeight !== null)) {
    errors.push("incomplete displayable context must not expose position weights");
  }
  if (!concentration || concentration.status !== "unavailable"
    || [concentration.largestPositionWeight, concentration.topThreeWeight, concentration.hhi].some((field) => field !== null)) {
    errors.push("incomplete displayable context must keep concentration unavailable");
  }
}

function validateCompleteDisplayableFacts(
  status: unknown,
  validPositions: Record<string, unknown>[],
  marketValue: Record<string, unknown> | null,
  concentration: Record<string, unknown> | null,
  errors: string[]
): void {
  if (status === "partial") errors.push("partial context requires at least one missing position value");
  if (validPositions.length === 0) {
    validateZeroPositionPortfolioContext(status, marketValue, concentration, errors);
    return;
  }
  if (validPositions.every((position) => isFinitePositive(position.latestPrice))) {
    const expectedValues = validPositions.map((position) => round(Number(position.quantity) * Number(position.latestPrice)));
    const expectedTotal = round(expectedValues.reduce((total, amount) => total + amount, 0));
    const expectedWeights = expectedValues.map((amount) => round(amount / expectedTotal, 8));
    const expectedSummaryStatus = status === "available" ? "complete_current" : "complete_stale";
    if (!marketValue || marketValue.status !== expectedSummaryStatus || marketValue.amount !== expectedTotal
      || marketValue.currency !== "HKD" || marketValue.missingPositionCount !== 0
      || validPositions.some((position, index) => position.marketValue !== expectedValues[index] || position.marketWeight !== expectedWeights[index])) {
      errors.push("displayable context market values and weights must recompute from exact position quantities and Futu prices");
    }
    const sortedWeights = [...expectedWeights].sort((left, right) => right - left);
    const expectedConcentration = {
      largestPositionWeight: round(sortedWeights[0] ?? 0, 8),
      topThreeWeight: round(sortedWeights.slice(0, 3).reduce((total, weight) => total + weight, 0), 8),
      hhi: round(sortedWeights.reduce((total, weight) => total + weight ** 2, 0), 8)
    };
    if (concentration
      && (concentration.largestPositionWeight !== expectedConcentration.largestPositionWeight
        || concentration.topThreeWeight !== expectedConcentration.topThreeWeight
        || concentration.hhi !== expectedConcentration.hhi)) {
      errors.push("available context concentration must recompute from exact position weights");
    }
  }

  if (!concentration
    || concentration.status !== "available"
    || !["largestPositionWeight", "topThreeWeight", "hhi"].every((field) => isUnitInterval(concentration[field]))) {
    errors.push(status === "available"
      ? "available context requires complete valid concentration"
      : "complete displayable context requires valid concentration");
  }
}

function round(value: number, precision = 2): number {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function validateRiskNumbers(value: unknown, fields: string[], errors: string[]): void {
  if (!isRecord(value)) { errors.push("risk calculation block is required"); return; }
  for (const field of fields) if (!isFiniteOrNull(value[field])) errors.push(`${field} is invalid`);
}

function allRiskNumbersPresent(current: unknown, scenario: unknown): boolean {
  return isRecord(current) && typeof current.alreadyHeld === "boolean" && isFiniteNonNegative(current.marketValue) && isFiniteNonNegative(current.weight)
    && isRecord(scenario) && ["totalMarketValue", "candidateMarketValue", "candidateWeight", "largestPositionWeight", "hhi"].every((field) => isFiniteNonNegative(scenario[field]))
    && typeof scenario.weightChange === "number" && Number.isFinite(scenario.weightChange);
}

function hasAnyRiskCalculation(current: unknown, scenario: unknown): boolean {
  return (isRecord(current) && (current.alreadyHeld !== null || current.marketValue !== null || current.weight !== null))
    || (isRecord(scenario) && ["totalMarketValue", "candidateMarketValue", "candidateWeight", "weightChange", "largestPositionWeight", "hhi"].some((field) => scenario[field] !== null));
}

function validateGuardrails(value: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push("guardrails are required"); return; }
  if (value.advisoryOnly !== true || value.userProvidedAmountOnly !== true) errors.push("advisory guardrails must remain enabled");
  for (const field of ["generatesDirection", "recommendsAmount", "recommendsTargetWeight", "recommendsTiming", "promisesReturn", "createsOrder", "productionWrite"]) if (value[field] !== false) errors.push(`guardrails.${field} must be false`);
}

function validateNullableString(value: unknown, field: string, errors: string[]): void { if (value !== null && !isNonEmptyString(value)) errors.push(`${field} must be a non-empty string or null`); }
function validateNullableDate(value: unknown, field: string, errors: string[]): void { if (value !== null) validateDate(value, field, errors); }
function validateDate(value: unknown, field: string, errors: string[]): void { if (!isStrictDate(value)) errors.push(`${field} must be an ISO UTC date-time`); }
function isStrictDate(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)); }
function isFiniteNonNegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function isFinitePositive(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value > 0; }
function isUnitInterval(value: unknown): value is number { return isFiniteNonNegative(value) && value <= 1; }
function isFiniteOrNull(value: unknown): boolean { return value === null || (typeof value === "number" && Number.isFinite(value)); }
function isFiniteNonNegativeOrNull(value: unknown): boolean { return value === null || isFiniteNonNegative(value); }
function isUnitIntervalOrNull(value: unknown): boolean { return value === null || isUnitInterval(value); }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
