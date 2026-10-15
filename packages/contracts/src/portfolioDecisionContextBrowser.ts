export type {
  PortfolioDecisionContextEnvelope,
  PortfolioDecisionContextStatus,
  PortfolioDecisionPosition,
  PortfolioRiskImpactEnvelope
} from "./portfolioDecisionContext.js";
import type {
  PortfolioDecisionContextEnvelope,
  PortfolioDecisionPosition,
  PortfolioRiskImpactEnvelope
} from "./portfolioDecisionContext.js";
import { canonicalJson } from "./decisionContextBrowser.js";
import { validatePortfolioDecisionFreshnessForBrowser } from "./portfolioDecisionFreshnessBrowser.js";
import {
  validatePortfolioContextDataUse,
  validatePortfolioContextStatus,
  validateZeroPositionPortfolioContext,
  validatePortfolioDisplayableProvenance,
  validatePortfolioUnrealizedPnl
} from "./portfolioDecisionContextStatus.js";

export const PORTFOLIO_DECISION_CONTEXT_SCHEMA_VERSION = "2026-07-15.portfolio-decision-context.v1";
export const PORTFOLIO_RISK_IMPACT_SCHEMA_VERSION = "2026-07-15.portfolio-risk-impact.v1";
export const PORTFOLIO_RISK_CALCULATION_VERSION = "portfolio-risk-impact.v1";

export async function validatePortfolioDecisionContextForBrowser(value: unknown): Promise<{ ok: true; value: PortfolioDecisionContextEnvelope } | { ok: false; errors: string[] }> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["portfolio context must be an object"] };
  if (value.schemaVersion !== PORTFOLIO_DECISION_CONTEXT_SCHEMA_VERSION) errors.push("portfolio context schemaVersion is invalid");
  const statuses = ["available", "stale", "partial", "zero_position", "empty", "conflict", "unauthorized", "unavailable"];
  if (!statuses.includes(String(value.status))) errors.push("portfolio context status is invalid");
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
    } else validatePortfolioDecisionFreshnessForBrowser(value.freshness, value.sourceAsOf, errors);
  }
  requireDate(value.assembledAt, "assembledAt", errors);
  const positions = Array.isArray(value.positions) ? value.positions : null;
  if (!positions || !positions.every(isValidPosition)) errors.push("portfolio positions are invalid");
  validateSummary(value.summary, positions?.length ?? -1, errors);
  validatePortfolioContextStatus(value, positions ?? [], errors);
  validatePortfolioContextDataUse(value.status, value.dataUse, errors);
  validateDisplayableContextFacts(value, positions ?? [], errors, hasProvenance);
  if (!Array.isArray(value.gaps) || !value.gaps.every(nonEmptyString)) errors.push("portfolio gaps are invalid");
  requireString(value.message, "message", errors);
  if (typeof value.contextId === "string") {
    const { contextId: _contextId, assembledAt: _assembledAt, freshness: _freshness, ...factSet } = value;
    try {
      const expected = `portfolio-decision-context:${await sha256Hex(canonicalJson(factSet))}`;
      if (value.contextId !== expected) errors.push("contextId does not match canonical content");
    } catch {
      errors.push("contextId canonical SHA-256 validation failed");
    }
  }
  return errors.length === 0 ? { ok: true, value: value as unknown as PortfolioDecisionContextEnvelope } : { ok: false, errors };
}

export async function validatePortfolioRiskImpactForBrowser(value: unknown): Promise<{ ok: true; value: PortfolioRiskImpactEnvelope } | { ok: false; errors: string[] }> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["portfolio risk impact must be an object"] };
  if (value.schemaVersion !== PORTFOLIO_RISK_IMPACT_SCHEMA_VERSION || value.calculationVersion !== PORTFOLIO_RISK_CALCULATION_VERSION) errors.push("portfolio risk contract version is invalid");
  if (!["available", "blocked", "invalid"].includes(String(value.status))) errors.push("portfolio risk status is invalid");
  validateNullableString(value.impactId, "impactId", errors);
  validateNullableString(value.contextId, "contextId", errors);
  validateNullableString(value.portfolioSnapshotId, "portfolioSnapshotId", errors);
  if (typeof value.candidateSymbol !== "string" || !/^HK\.\d{5}$/.test(value.candidateSymbol)) errors.push("candidateSymbol is invalid");
  if (value.currency !== "HKD") errors.push("risk currency must be HKD");
  if (value.hypotheticalAmount !== null && !finiteNonNegative(value.hypotheticalAmount)) errors.push("hypotheticalAmount is invalid");
  if (!isRecord(value.current) || (typeof value.current.alreadyHeld !== "boolean" && value.current.alreadyHeld !== null) || !nullableFinite(value.current.marketValue) || !nullableFinite(value.current.weight)) errors.push("current risk facts are invalid");
  const scenario = value.scenario;
  if (!isRecord(scenario)) errors.push("scenario risk facts are invalid");
  else if (!["totalMarketValue", "candidateMarketValue", "candidateWeight", "weightChange", "largestPositionWeight", "hhi"].every((field) => nullableFinite(scenario[field]))) errors.push("scenario risk facts are invalid");
  if (!Array.isArray(value.gaps) || !value.gaps.every(nonEmptyString)) errors.push("risk gaps are invalid");
  validateGuardrails(value.guardrails, errors);
  if (value.status === "available") {
    for (const field of ["impactId", "contextId", "portfolioSnapshotId"]) requireString(value[field], field, errors);
    if (!finiteNonNegative(value.hypotheticalAmount)) errors.push("available portfolio risk requires a valid hypothetical amount");
    if (!isRecord(value.current)
      || typeof value.current.alreadyHeld !== "boolean"
      || !finiteNonNegative(value.current.marketValue)
      || !finiteNonNegative(value.current.weight)) {
      errors.push("available portfolio risk requires complete current calculations");
    }
    if (!isRecord(scenario)
      || !["totalMarketValue", "candidateMarketValue", "candidateWeight", "largestPositionWeight", "hhi"].every((field) => finiteNonNegative(scenario[field]))
      || typeof scenario.weightChange !== "number"
      || !Number.isFinite(scenario.weightChange)) {
      errors.push("available portfolio risk requires complete scenario calculations");
    }
  } else {
    if (value.impactId !== null) errors.push("blocked risk impact must not expose impactId");
    if (hasAnyRiskCalculation(value.current, value.scenario)) errors.push("blocked risk impact must not expose calculations");
  }
  requireString(value.message, "message", errors);
  if (typeof value.impactId === "string") {
    const { impactId: _impactId, ...factSet } = value;
    try {
      const expected = `portfolio-risk-impact:${await sha256Hex(canonicalJson(factSet))}`;
      if (value.impactId !== expected) errors.push("impactId does not match canonical content");
    } catch {
      errors.push("impactId canonical SHA-256 validation failed");
    }
  }
  return errors.length === 0 ? { ok: true, value: value as unknown as PortfolioRiskImpactEnvelope } : { ok: false, errors };
}

export function validatePortfolioRiskImpactBindingForBrowser(
  impact: PortfolioRiskImpactEnvelope,
  context: PortfolioDecisionContextEnvelope,
  candidateSymbol: string,
  hypotheticalAmount: number,
  options: { allowStaleReadOnly?: boolean } = {}
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const usableContext = context.status === "available" || (options.allowStaleReadOnly === true && context.status === "stale");
  if (!usableContext || context.summary.marketValue.amount === null || context.summary.marketValue.amount <= 0) {
    return { ok: false, errors: ["risk impact requires the currently displayed complete portfolio context"] };
  }
  if (impact.status !== "available") errors.push("risk impact is no longer available for the displayed portfolio");
  if (impact.contextId !== context.contextId) errors.push("risk impact contextId must match the displayed portfolio facts");
  if (impact.portfolioSnapshotId !== context.portfolioSnapshotId) errors.push("risk impact portfolioSnapshotId must match the displayed Pingan snapshot");
  if (impact.candidateSymbol !== candidateSymbol) errors.push("risk impact candidateSymbol must match the selected candidate");
  if (impact.hypotheticalAmount !== hypotheticalAmount) errors.push("risk impact amount must match the user-provided amount");

  const currentPosition = context.positions.find((position) => position.symbol === candidateSymbol);
  const currentMarketValue = currentPosition?.marketValue ?? 0;
  const currentWeight = currentPosition?.marketWeight ?? 0;
  const totalMarketValue = round(context.summary.marketValue.amount + hypotheticalAmount);
  const candidateMarketValue = round(currentMarketValue + hypotheticalAmount);
  const candidateWeight = totalMarketValue === 0 ? 0 : round(candidateMarketValue / totalMarketValue, 8);
  const scenarioValues = context.positions
    .filter((position) => position.symbol !== candidateSymbol)
    .map((position) => position.marketValue ?? 0);
  scenarioValues.push(candidateMarketValue);
  const weights = scenarioValues.map((value) => totalMarketValue === 0 ? 0 : value / totalMarketValue).sort((a, b) => b - a);
  const expected = {
    alreadyHeld: currentPosition !== undefined,
    currentMarketValue,
    currentWeight,
    totalMarketValue,
    candidateMarketValue,
    candidateWeight,
    weightChange: round(candidateWeight - currentWeight, 8),
    largestPositionWeight: round(weights[0] ?? 0, 8),
    hhi: round(weights.reduce((total, weight) => total + weight ** 2, 0), 8)
  };
  if (impact.current.alreadyHeld !== expected.alreadyHeld
    || impact.current.marketValue !== expected.currentMarketValue
    || impact.current.weight !== expected.currentWeight
    || impact.scenario.totalMarketValue !== expected.totalMarketValue
    || impact.scenario.candidateMarketValue !== expected.candidateMarketValue
    || impact.scenario.candidateWeight !== expected.candidateWeight
    || impact.scenario.weightChange !== expected.weightChange
    || impact.scenario.largestPositionWeight !== expected.largestPositionWeight
    || impact.scenario.hhi !== expected.hhi) {
    errors.push("risk impact calculations do not match the currently displayed portfolio facts");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function isValidPosition(value: unknown): value is PortfolioDecisionPosition {
  if (!isRecord(value) || value.market !== "HK" || typeof value.code !== "string" || !/^\d{5}$/.test(value.code) || value.symbol !== `HK.${value.code}`) return false;
  if (!finitePositive(value.quantity) || !nullableFiniteNonNegative(value.averageCost) || !nullableFinite(value.unrealizedPnl) || !nullableUnitInterval(value.sourceWeight)) return false;
  if (value.name !== null && typeof value.name !== "string") return false;
  if (value.currency !== null && typeof value.currency !== "string") return false;
  if (!nonEmptyString(value.sourceRowId) || !isRecord(value.quote) || !["current", "stale", "unavailable"].includes(String(value.quote.status))) return false;
  if (value.quote.status === "unavailable") return value.quote.source === null && value.quote.quoteAsOf === null && value.quote.fetchedAt === null && value.latestPrice === null && value.marketValue === null && value.marketWeight === null;
  return value.quote.source === "futu"
    && validDate(value.quote.quoteAsOf)
    && validDate(value.quote.fetchedAt)
    && Date.parse(value.quote.quoteAsOf) <= Date.parse(value.quote.fetchedAt)
    && finitePositive(value.latestPrice)
    && finiteNonNegative(value.marketValue)
    && nullableFinite(value.marketWeight);
}

function validateSummary(value: unknown, positionCount: number, errors: string[]): void {
  if (!isRecord(value)) { errors.push("portfolio summary is required"); return; }
  if (value.positionCount !== positionCount) errors.push("summary positionCount is invalid");
  if (!isRecord(value.marketValue) || !["complete_current", "complete_stale", "partial", "unavailable"].includes(String(value.marketValue.status))) {
    errors.push("summary marketValue is invalid");
  } else {
    if (!nullableFinite(value.marketValue.amount)) errors.push("summary marketValue amount is invalid");
    if (value.marketValue.currency !== null && value.marketValue.currency !== "HKD") errors.push("summary marketValue currency is invalid");
    if (typeof value.marketValue.missingPositionCount !== "number"
      || !Number.isInteger(value.marketValue.missingPositionCount)
      || value.marketValue.missingPositionCount < 0) errors.push("summary missingPositionCount is invalid");
  }
  if (Object.prototype.hasOwnProperty.call(value, "unrealizedPnl") && !nullableFinite(value.unrealizedPnl)) errors.push("summary unrealizedPnl is invalid");
  if (!isRecord(value.cash) || value.cash.status !== "unknown" || value.cash.amount !== null || value.cash.currency !== null || value.cash.reason !== "not_provided_by_authoritative_snapshot") errors.push("cash must remain explicit unknown");
  const concentration = value.concentration;
  if (!isRecord(concentration)) errors.push("concentration is invalid");
  else if (!["available", "unavailable"].includes(String(concentration.status)) || !["largestPositionWeight", "topThreeWeight", "hhi"].every((field) => nullableFinite(concentration[field]))) errors.push("concentration is invalid");
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
    || !finitePositive(marketValue.amount)
    || marketValue.currency !== "HKD"
    || marketValue.missingPositionCount !== 0)) {
    errors.push("available context requires complete_current positive HKD market value with no missing positions");
  }
  if (status === "available" && !positions.every((position) => isRecord(position)
    && position.currency === "HKD"
    && finiteNonNegative(position.marketValue)
    && unitInterval(position.marketWeight))) {
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
  if (validDate(value.assembledAt) && validDate(value.portfolioAsOf)
    && Date.parse(value.portfolioAsOf) > Date.parse(value.assembledAt)) {
    errors.push("available context portfolioAsOf must not be after assembledAt");
  }
  const assembledAt = validDate(value.assembledAt) ? value.assembledAt : null;
  if (assembledAt && validPositions.some((position) => {
    const fetchedAt = isRecord(position.quote) && validDate(position.quote.fetchedAt)
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
    if (finitePositive(position.latestPrice)) {
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
  if (validPositions.every((position) => finitePositive(position.latestPrice))) {
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
    || !["largestPositionWeight", "topThreeWeight", "hhi"].every((field) => unitInterval(concentration[field]))) {
    errors.push(status === "available"
      ? "available context requires complete valid concentration"
      : "complete displayable context requires valid concentration");
  }
}

function validateGuardrails(value: unknown, errors: string[]): void {
  if (!isRecord(value) || value.advisoryOnly !== true || value.userProvidedAmountOnly !== true) { errors.push("risk guardrails are invalid"); return; }
  for (const field of ["generatesDirection", "recommendsAmount", "recommendsTargetWeight", "recommendsTiming", "promisesReturn", "createsOrder", "productionWrite"]) if (value[field] !== false) errors.push(`${field} must remain false`);
}

function hasAnyRiskCalculation(current: unknown, scenario: unknown): boolean {
  return (isRecord(current) && (current.alreadyHeld !== null || current.marketValue !== null || current.weight !== null))
    || (isRecord(scenario) && ["totalMarketValue", "candidateMarketValue", "candidateWeight", "weightChange", "largestPositionWeight", "hhi"].some((field) => scenario[field] !== null));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function requireString(value: unknown, field: string, errors: string[]): void { if (!nonEmptyString(value)) errors.push(`${field} is required`); }
function requireDate(value: unknown, field: string, errors: string[]): void { if (!validDate(value)) errors.push(`${field} is invalid`); }
function validateNullableString(value: unknown, field: string, errors: string[]): void { if (value !== null && !nonEmptyString(value)) errors.push(`${field} must be a non-empty string or null`); }
function validateNullableDate(value: unknown, field: string, errors: string[]): void { if (value !== null) requireDate(value, field, errors); }
function validDate(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)); }
function finiteNonNegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function finitePositive(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value > 0; }
function unitInterval(value: unknown): value is number { return finiteNonNegative(value) && value <= 1; }
function nullableFinite(value: unknown): boolean { return value === null || (typeof value === "number" && Number.isFinite(value)); }
function nullableFiniteNonNegative(value: unknown): boolean { return value === null || finiteNonNegative(value); }
function nullableUnitInterval(value: unknown): boolean { return value === null || unitInterval(value); }
function nonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
