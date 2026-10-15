import crypto from "node:crypto";
import { canonicalJson } from "./decisionContext.js";
import type { PinganSnapshotPositionData } from "./portfolioSnapshot.js";

export const PINGAN_CURRENT_PORTFOLIO_SCHEMA_VERSION = "2026-07-15.pingan-current-portfolio.v1";
export const PINGAN_CURRENT_PORTFOLIO_SOURCE_SYSTEM = "pingan_imported_snapshot";
export const PINGAN_DEVELOPMENT_AUTHORITY_SCOPE = "local_development_and_local_beta";

export const PINGAN_CURRENT_PORTFOLIO_STATUSES = [
  "current",
  "stale",
  "zero_position",
  "empty",
  "conflict",
  "unauthorized",
  "unavailable"
] as const;

export type PinganCurrentPortfolioStatus = (typeof PINGAN_CURRENT_PORTFOLIO_STATUSES)[number];
export type PinganCurrentnessMode = "trading_session" | "off_session";
const HONG_KONG_UTC_OFFSET_MS = 8 * 60 * 60 * 1_000;

export interface PinganFreshnessPolicy {
  tradingMaxAgeSeconds: number;
}

export type PinganFreshnessReason =
  | "within_policy"
  | "trading_age_exceeded"
  | "before_latest_session_close"
  | "source_timestamp_in_future";

export interface PinganPortfolioFreshness {
  state: "current" | "stale";
  mode: PinganCurrentnessMode;
  reason: PinganFreshnessReason;
  evaluatedAt: string;
  ageSeconds: number;
  tradingMaxAgeSeconds: number;
  latestSessionClose: string;
}

export function evaluatePinganPortfolioFreshness(
  sourceAsOf: Date,
  now: Date,
  policy: PinganFreshnessPolicy
): PinganPortfolioFreshness {
  if (!Number.isFinite(sourceAsOf.getTime()) || !Number.isFinite(now.getTime())) {
    throw new Error("Pingan freshness timestamps must be valid dates");
  }
  if (!Number.isInteger(policy.tradingMaxAgeSeconds) || policy.tradingMaxAgeSeconds <= 0) {
    throw new Error("Pingan trading freshness limit must be a positive integer");
  }

  const mode = isHongKongTradingSession(now) ? "trading_session" : "off_session";
  const latestSessionClose = latestHongKongSessionClose(now);
  const rawAgeSeconds = Math.floor((now.getTime() - sourceAsOf.getTime()) / 1_000);
  const ageSeconds = Math.max(0, rawAgeSeconds);
  let state: PinganPortfolioFreshness["state"] = "current";
  let reason: PinganPortfolioFreshness["reason"] = "within_policy";

  if (rawAgeSeconds < 0) {
    state = "stale";
    reason = "source_timestamp_in_future";
  } else if (isHongKongTradingDayFreshnessWindow(now) && ageSeconds > policy.tradingMaxAgeSeconds) {
    state = "stale";
    reason = "trading_age_exceeded";
  } else if (mode === "off_session" && sourceAsOf.getTime() < latestSessionClose.getTime()) {
    state = "stale";
    reason = "before_latest_session_close";
  }

  return {
    state,
    mode,
    reason,
    evaluatedAt: now.toISOString(),
    ageSeconds,
    tradingMaxAgeSeconds: policy.tradingMaxAgeSeconds,
    latestSessionClose: latestSessionClose.toISOString()
  };
}

export function validatePinganPortfolioFreshness(value: unknown, sourceAsOf: unknown, errors: string[]): void {
  if (value === null) return;
  if (!isRecord(value)) { errors.push("freshness must be an object or null"); return; }
  if (value.state !== "current" && value.state !== "stale") errors.push("freshness.state is invalid");
  if (value.mode !== "trading_session" && value.mode !== "off_session") errors.push("freshness.mode is invalid");
  if (!["within_policy", "trading_age_exceeded", "before_latest_session_close", "source_timestamp_in_future"].includes(String(value.reason))) errors.push("freshness.reason is invalid");
  if (value.state === "current" && value.reason !== "within_policy") errors.push("current freshness must be within policy");
  if (value.state === "stale" && value.reason === "within_policy") errors.push("stale freshness must include a failure reason");
  validateDateTime(value.evaluatedAt, "freshness.evaluatedAt", errors);
  validateDateTime(value.latestSessionClose, "freshness.latestSessionClose", errors);
  if (!isFiniteNonNegative(value.ageSeconds)) errors.push("freshness.ageSeconds must be non-negative");
  const tradingMaxAgeSeconds = typeof value.tradingMaxAgeSeconds === "number" ? value.tradingMaxAgeSeconds : null;
  if (tradingMaxAgeSeconds === null || !Number.isInteger(tradingMaxAgeSeconds) || tradingMaxAgeSeconds <= 0) errors.push("freshness.tradingMaxAgeSeconds must be positive");
  if (isStrictDateTime(sourceAsOf) && isStrictDateTime(value.evaluatedAt) && tradingMaxAgeSeconds !== null && Number.isInteger(tradingMaxAgeSeconds) && tradingMaxAgeSeconds > 0) {
    const expected = evaluatePinganPortfolioFreshness(new Date(sourceAsOf), new Date(value.evaluatedAt), { tradingMaxAgeSeconds });
    for (const field of ["state", "mode", "reason", "evaluatedAt", "ageSeconds", "tradingMaxAgeSeconds", "latestSessionClose"] as const) if (value[field] !== expected[field]) errors.push(`freshness.${field} does not recompute from sourceAsOf and evaluatedAt`);
  }
}

export function isHongKongTradingSession(now: Date): boolean {
  const local = hongKongParts(now);
  if (local.day === 0 || local.day === 6) return false;
  const minute = local.hour * 60 + local.minute;
  return (minute >= 9 * 60 + 30 && minute < 12 * 60)
    || (minute >= 13 * 60 && minute < 16 * 60);
}

export function latestHongKongSessionClose(now: Date): Date {
  const local = hongKongParts(now);
  const minute = local.hour * 60 + local.minute;
  const todayClosed = local.day >= 1 && local.day <= 5 && minute >= 16 * 60;
  const cursor = new Date(Date.UTC(local.year, local.month, local.date, 16 - 8));
  if (!todayClosed) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (hongKongParts(cursor).day === 0 || hongKongParts(cursor).day === 6) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return cursor;
}

export interface PinganCurrentPortfolioEnvelope {
  schemaVersion: typeof PINGAN_CURRENT_PORTFOLIO_SCHEMA_VERSION;
  status: PinganCurrentPortfolioStatus;
  authorityScope: typeof PINGAN_DEVELOPMENT_AUTHORITY_SCOPE;
  accountScopeId: string | null;
  sourceSystem: typeof PINGAN_CURRENT_PORTFOLIO_SOURCE_SYSTEM | null;
  sourceBatchId: string | null;
  snapshotId: string | null;
  sourceAsOf: string | null;
  importedAt: string | null;
  fetchedAt: string | null;
  freshness: PinganPortfolioFreshness | null;
  positions: PinganSnapshotPositionData[];
  positionCount: number;
  dataUse: {
    display: "allowed" | "allowed_with_warning" | "blocked";
    advisoryRiskImpact: "allowed_current_development_only" | "blocked_stale" | "blocked";
    marketPriceAuthority: "futu_quote_data_only";
    productionPortfolio: "blocked_not_production_authority";
    brokerReconciliation: "blocked";
    accounting: "blocked";
    execution: "blocked";
  };
  safety: {
    readOnly: true;
    developmentOnly: true;
    createsOrder: false;
    createsTrade: false;
    mutatesCash: false;
    writesFee: false;
    mutatesPosition: false;
    callsBroker: false;
    productionWrite: false;
  };
  message: string;
}

export type PinganCurrentPortfolioHashInput = Omit<PinganCurrentPortfolioEnvelope, "snapshotId">;

export function pinganCurrentPortfolioHashInput(envelope: PinganCurrentPortfolioEnvelope): PinganCurrentPortfolioHashInput {
  const { snapshotId: _snapshotId, ...input } = envelope;
  return input;
}

export function computePinganCurrentPortfolioSnapshotId(input: PinganCurrentPortfolioHashInput): string {
  const identity = {
    schemaVersion: input.schemaVersion,
    authorityScope: input.authorityScope,
    accountScopeId: input.accountScopeId,
    sourceSystem: input.sourceSystem,
    sourceBatchId: input.sourceBatchId,
    sourceAsOf: input.sourceAsOf,
    importedAt: input.importedAt,
    fetchedAt: input.fetchedAt,
    positions: input.positions,
    positionCount: input.positionCount
  };
  return `pingan-current-portfolio:${crypto.createHash("sha256").update(canonicalJson(identity)).digest("hex")}`;
}

export function validatePinganCurrentPortfolioEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["envelope must be an object"] };
  if (value.schemaVersion !== PINGAN_CURRENT_PORTFOLIO_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  if (!PINGAN_CURRENT_PORTFOLIO_STATUSES.includes(value.status as PinganCurrentPortfolioStatus)) errors.push("status is invalid");
  if (value.authorityScope !== PINGAN_DEVELOPMENT_AUTHORITY_SCOPE) errors.push("authorityScope is invalid");
  validateNullableString(value.accountScopeId, "accountScopeId", errors);
  if (value.sourceSystem !== null && value.sourceSystem !== PINGAN_CURRENT_PORTFOLIO_SOURCE_SYSTEM) errors.push("sourceSystem is invalid");
  for (const field of ["sourceBatchId", "snapshotId", "sourceAsOf", "importedAt", "fetchedAt"] as const) {
    validateNullableString(value[field], field, errors);
  }
  for (const field of ["sourceAsOf", "importedAt", "fetchedAt"] as const) validateNullableDateTime(value[field], field, errors);

  const positions = Array.isArray(value.positions) ? value.positions : null;
  if (!positions || !positions.every(isValidPosition)) errors.push("positions are invalid");
  if (typeof value.positionCount !== "number" || value.positionCount !== (positions?.length ?? -1)) errors.push("positionCount must equal positions.length");
  validateFreshness(value.freshness, value.sourceAsOf, errors);
  validateDataUse(value.dataUse, errors);
  validateSafety(value.safety, errors);
  if (typeof value.message !== "string" || value.message.trim() === "") errors.push("message is required");
  validateStatusSemantics(value, positions ?? [], errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateStatusSemantics(value: Record<string, unknown>, positions: PinganSnapshotPositionData[], errors: string[]): void {
  const status = value.status as PinganCurrentPortfolioStatus;
  if (status === "current" || status === "stale" || status === "zero_position") {
    for (const field of ["accountScopeId", "sourceSystem", "sourceBatchId", "snapshotId", "sourceAsOf", "importedAt", "fetchedAt"] as const) {
      if (typeof value[field] !== "string" || value[field].trim() === "") errors.push(`${field} is required for source-bound portfolios`);
    }
    if (status === "current" && positions.length === 0) errors.push("positions are required for current portfolios");
    if (status === "zero_position" && positions.length !== 0) errors.push("zero-position portfolios must contain zero positions");
    validateProvenanceTimeline(value, errors);
    const symbols = new Set<string>();
    for (const position of positions) {
      if (symbols.has(position.symbol)) errors.push("duplicate portfolio symbol");
      symbols.add(position.symbol);
      if (typeof value.sourceBatchId === "string" && !position.sourceRowId.startsWith(`broker_import_batches:${value.sourceBatchId}/`)) {
        errors.push("position sourceRowId must bind the account snapshot batch");
      }
    }
    const expectedFreshnessState = status === "zero_position" ? "current" : status;
    if (isRecord(value.freshness) && value.freshness.state !== expectedFreshnessState) errors.push("freshness state must match status");
    if (status === "zero_position") validateZeroPositionDataUse(value.dataUse, errors);
    else validatePositionBearingDataUse(value.dataUse, status, errors);
    if (typeof value.snapshotId === "string") {
      const expected = computePinganCurrentPortfolioSnapshotId(pinganCurrentPortfolioHashInput(value as unknown as PinganCurrentPortfolioEnvelope));
      if (value.snapshotId !== expected) errors.push("snapshotId does not match canonical envelope content");
    }
    return;
  }

  if (positions.length !== 0) errors.push("fail-closed portfolios must not expose positions");
  if (value.snapshotId !== null) errors.push("fail-closed portfolios must not expose snapshotId");
  if (value.freshness !== null) errors.push("fail-closed portfolios must not expose freshness");
  validateBlockedDataUse(value.dataUse, errors);
}

function validateFreshness(value: unknown, sourceAsOf: unknown, errors: string[]): void {
  validatePinganPortfolioFreshness(value, sourceAsOf, errors);
}

function validateProvenanceTimeline(value: Record<string, unknown>, errors: string[]): void {
  if (![value.sourceAsOf, value.importedAt, value.fetchedAt].every(isStrictDateTime)) return;
  const sourceAsOf = Date.parse(value.sourceAsOf as string);
  const importedAt = Date.parse(value.importedAt as string);
  const fetchedAt = Date.parse(value.fetchedAt as string);
  if (sourceAsOf > fetchedAt) {
    errors.push("portfolio provenance must satisfy sourceAsOf <= fetchedAt");
  }
  if (isRecord(value.freshness) && isStrictDateTime(value.freshness.evaluatedAt)) {
    const evaluatedAt = Date.parse(value.freshness.evaluatedAt);
    for (const [field, timestamp] of [["sourceAsOf", sourceAsOf], ["importedAt", importedAt], ["fetchedAt", fetchedAt]] as const) {
      if (timestamp > evaluatedAt) errors.push(`portfolio ${field} must not be after freshness.evaluatedAt`);
    }
  }
}

function validateDataUse(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("dataUse must be an object");
    return;
  }
  if (!["allowed", "allowed_with_warning", "blocked"].includes(String(value.display))) errors.push("dataUse.display is invalid");
  if (!["allowed_current_development_only", "blocked_stale", "blocked"].includes(String(value.advisoryRiskImpact))) errors.push("dataUse.advisoryRiskImpact is invalid");
  if (value.marketPriceAuthority !== "futu_quote_data_only") errors.push("dataUse.marketPriceAuthority is invalid");
  if (value.productionPortfolio !== "blocked_not_production_authority") errors.push("dataUse.productionPortfolio must remain blocked");
  for (const field of ["brokerReconciliation", "accounting", "execution"]) if (value[field] !== "blocked") errors.push(`dataUse.${field} must remain blocked`);
}

function validatePositionBearingDataUse(value: unknown, status: "current" | "stale", errors: string[]): void {
  if (!isRecord(value)) return;
  const expectedDisplay = status === "current" ? "allowed" : "allowed_with_warning";
  const expectedRisk = status === "current" ? "allowed_current_development_only" : "blocked_stale";
  if (value.display !== expectedDisplay) errors.push(`dataUse.display must be ${expectedDisplay}`);
  if (value.advisoryRiskImpact !== expectedRisk) errors.push(`dataUse.advisoryRiskImpact must be ${expectedRisk}`);
}

function validateZeroPositionDataUse(value: unknown, errors: string[]): void {
  if (!isRecord(value)) return;
  if (value.display !== "allowed") errors.push("zero-position dataUse.display must be allowed");
  if (value.advisoryRiskImpact !== "blocked") errors.push("zero-position dataUse.advisoryRiskImpact must be blocked");
}

function validateBlockedDataUse(value: unknown, errors: string[]): void {
  if (!isRecord(value)) return;
  if (value.display !== "blocked") errors.push("fail-closed dataUse.display must be blocked");
  if (value.advisoryRiskImpact !== "blocked") errors.push("fail-closed dataUse.advisoryRiskImpact must be blocked");
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("safety must be an object");
    return;
  }
  if (value.readOnly !== true || value.developmentOnly !== true) errors.push("safety must remain read-only and development-only");
  for (const field of ["createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker", "productionWrite"]) {
    if (value[field] !== false) errors.push(`safety.${field} must be false`);
  }
}

function isValidPosition(value: unknown): value is PinganSnapshotPositionData {
  return isRecord(value)
    && value.market === "HK"
    && typeof value.code === "string"
    && /^\d{5}$/.test(value.code)
    && typeof value.symbol === "string"
    && value.symbol === `${value.market}.${value.code}`
    && typeof value.sourceRowId === "string"
    && /^broker_import_batches:[^/]+\/broker_trades:\d+\/position_snapshots:[^/]+$/.test(value.sourceRowId)
    && (typeof value.name === "string" || value.name === null)
    && isFinitePositive(value.quantity)
    && isFiniteNonNegativeOrNull(value.averageCost)
    && isUnitIntervalOrNull(value.currentWeight)
    && isUnitIntervalOrNull(value.maxWeight)
    && isFiniteOrNull(value.unrealizedPnl)
    && value.currency === "HKD";
}

function validateNullableString(value: unknown, field: string, errors: string[]): void {
  if (value !== null && typeof value !== "string") errors.push(`${field} must be a string or null`);
}

function validateNullableDateTime(value: unknown, field: string, errors: string[]): void {
  if (value !== null) validateDateTime(value, field, errors);
}

function validateDateTime(value: unknown, field: string, errors: string[]): void {
  if (!isStrictDateTime(value)) errors.push(`${field} must be an ISO UTC date-time`);
}

function isStrictDateTime(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function isHongKongTradingDayFreshnessWindow(now: Date): boolean {
  const local = hongKongParts(now);
  if (local.day === 0 || local.day === 6) return false;
  const minute = local.hour * 60 + local.minute;
  return minute >= 9 * 60 + 30 && minute < 16 * 60;
}

function hongKongParts(value: Date): { year: number; month: number; date: number; day: number; hour: number; minute: number } {
  const shifted = new Date(value.getTime() + HONG_KONG_UTC_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    day: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes()
  };
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteOrNull(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isFiniteNonNegativeOrNull(value: unknown): boolean {
  return value === null || isFiniteNonNegative(value);
}

function isUnitIntervalOrNull(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
