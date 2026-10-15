import crypto from "node:crypto";
import { canonicalJson } from "./decisionContext.js";

export const PINGAN_SNAPSHOT_SCHEMA_VERSION = "2026-06-27.core-1b-pingan-snapshot.v1";
export const PINGAN_SNAPSHOT_SOURCE_SYSTEM = "pingan_imported_snapshot";

export const PINGAN_SNAPSHOT_STATUSES = [
  "available",
  "empty",
  "stale",
  "unavailable",
  "unauthorized",
  "source_conflict",
  "not_approved"
] as const;

export type PinganSnapshotStatus = (typeof PINGAN_SNAPSHOT_STATUSES)[number];
export type PinganSnapshotFreshness = "historical" | "stale";

export interface PinganSnapshotPositionData {
  market: string;
  code: string;
  symbol: string;
  sourceRowId: string;
  name: string | null;
  quantity: number;
  averageCost: number | null;
  currentWeight: number | null;
  maxWeight: number | null;
  unrealizedPnl: number | null;
  currency: string | null;
}

export interface PinganSnapshotEnvelope {
  schemaVersion: typeof PINGAN_SNAPSHOT_SCHEMA_VERSION;
  status: PinganSnapshotStatus;
  requestedSymbol: string;
  sourceSystem: typeof PINGAN_SNAPSHOT_SOURCE_SYSTEM | null;
  sourceSnapshotId: string | null;
  sourceAsOf: string | null;
  importedAt: string | null;
  fetchedAt: string | null;
  freshness: PinganSnapshotFreshness | null;
  limitation: string;
  warning: string | null;
  positions: PinganSnapshotPositionData[];
  positionCount: number;
  dataUse: {
    display: "allowed_with_warning" | "blocked";
    riskImpact: "blocked_stale_historical_only" | "blocked";
    brokerReconciliation: "blocked_not_live_authoritative" | "blocked";
    accountTruth: "blocked_not_live_authoritative" | "blocked";
    accounting: "blocked_not_accounting_authority" | "blocked";
    execution: "blocked_not_execution_input" | "blocked";
  };
  safety: {
    readOnly: true;
    createsOrder: false;
    createsTrade: false;
    mutatesCash: false;
    writesFee: false;
    mutatesPosition: false;
    callsBroker: false;
  };
  message: string;
}

export type PinganSnapshotHashInput = Omit<PinganSnapshotEnvelope, "sourceSnapshotId">;

export function pinganSnapshotHashInputFromEnvelope(envelope: PinganSnapshotEnvelope): PinganSnapshotHashInput {
  const { sourceSnapshotId: _sourceSnapshotId, ...input } = envelope;
  return input;
}

export function computePinganSnapshotId(input: PinganSnapshotHashInput): string {
  return `pingan-snapshot:${crypto.createHash("sha256").update(canonicalJson(input)).digest("hex")}`;
}

export function validatePinganSnapshotEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["envelope must be an object"] };
  if (value.schemaVersion !== PINGAN_SNAPSHOT_SCHEMA_VERSION) errors.push(`schemaVersion must be ${PINGAN_SNAPSHOT_SCHEMA_VERSION}`);
  if (!PINGAN_SNAPSHOT_STATUSES.includes(value.status as PinganSnapshotStatus)) errors.push("status is invalid");
  requireNonEmptyString(value.requestedSymbol, "requestedSymbol", errors);
  if (value.sourceSystem !== null && value.sourceSystem !== PINGAN_SNAPSHOT_SOURCE_SYSTEM) errors.push("sourceSystem must be pingan_imported_snapshot or null");
  validateOptionalString(value.sourceSnapshotId, "sourceSnapshotId", errors);
  validateOptionalString(value.sourceAsOf, "sourceAsOf", errors);
  validateOptionalString(value.importedAt, "importedAt", errors);
  validateOptionalString(value.fetchedAt, "fetchedAt", errors);
  validateOptionalDateTime(value.sourceAsOf, "sourceAsOf", errors);
  validateOptionalDateTime(value.importedAt, "importedAt", errors);
  validateOptionalDateTime(value.fetchedAt, "fetchedAt", errors);
  if (value.freshness !== null && value.freshness !== "historical" && value.freshness !== "stale") errors.push("freshness must be historical, stale, or null");
  requireString(value.limitation, "limitation", errors);
  validateOptionalString(value.warning, "warning", errors);
  const positions = Array.isArray(value.positions) ? value.positions : null;
  if (!positions || !positions.every(isValidPosition)) errors.push("positions must contain valid Pingan snapshot positions");
  if (typeof value.positionCount !== "number" || value.positionCount !== (positions?.length ?? -1)) errors.push("positionCount must equal positions.length");
  validatePositionIdentity(value.requestedSymbol, positions ?? [], errors);
  validateDataUse(value, errors);
  validateSafety(value.safety, errors);
  requireString(value.message, "message", errors);
  validateStatusSemantics(value, errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateStatusSemantics(value: Record<string, unknown>, errors: string[]): void {
  const positions = Array.isArray(value.positions) ? value.positions : [];
  if (value.status === "available") {
    errors.push("Pingan snapshots with positions must use stale historical-only status, not available");
  }
  if (value.status === "stale") {
    if (value.sourceSystem !== PINGAN_SNAPSHOT_SOURCE_SYSTEM) errors.push("sourceSystem is required for position-bearing responses");
    if (typeof value.sourceSnapshotId !== "string") errors.push("sourceSnapshotId is required for position-bearing responses");
    if (typeof value.sourceAsOf !== "string") errors.push("sourceAsOf is required for position-bearing responses");
    if (typeof value.importedAt !== "string" && typeof value.fetchedAt !== "string") errors.push("importedAt or fetchedAt is required for position-bearing responses");
    if (value.warning === null) errors.push("warning is required for position-bearing responses");
    if (positions.length === 0) errors.push("positions are required for stale historical Pingan snapshots");
    validateHistoricalOnlyDisclosure(value, errors);
    validateHistoricalOnlyDataUse(value.dataUse, errors);
  } else if (positions.length !== 0) {
    errors.push("positions must be empty for fail-closed states");
  } else {
    validateFailClosedDataUse(value.dataUse, errors);
  }
}

function validateDataUse(value: Record<string, unknown>, errors: string[]): void {
  if (!isRecord(value.dataUse)) {
    errors.push("dataUse must be an object");
    return;
  }
  if (value.dataUse.display !== "allowed_with_warning" && value.dataUse.display !== "blocked") errors.push("dataUse.display is invalid");
  if (value.dataUse.riskImpact !== "blocked_stale_historical_only" && value.dataUse.riskImpact !== "blocked") errors.push("dataUse.riskImpact is invalid");
  if (value.dataUse.brokerReconciliation !== "blocked_not_live_authoritative" && value.dataUse.brokerReconciliation !== "blocked") errors.push("dataUse.brokerReconciliation is invalid");
  if (value.dataUse.accountTruth !== "blocked_not_live_authoritative" && value.dataUse.accountTruth !== "blocked") errors.push("dataUse.accountTruth is invalid");
  if (value.dataUse.accounting !== "blocked_not_accounting_authority" && value.dataUse.accounting !== "blocked") errors.push("dataUse.accounting is invalid");
  if (value.dataUse.execution !== "blocked_not_execution_input" && value.dataUse.execution !== "blocked") errors.push("dataUse.execution is invalid");
}

function validateHistoricalOnlyDataUse(value: unknown, errors: string[]): void {
  if (!isRecord(value)) return;
  if (value.display !== "allowed_with_warning") errors.push("stale historical Pingan snapshots must use allowed_with_warning display");
  if (value.riskImpact !== "blocked_stale_historical_only") errors.push("stale historical Pingan snapshots must block stale historical risk impact");
  if (value.brokerReconciliation !== "blocked_not_live_authoritative") errors.push("stale historical Pingan snapshots must block broker reconciliation as not live authoritative");
  if (value.accountTruth !== "blocked_not_live_authoritative") errors.push("stale historical Pingan snapshots must block account truth as not live authoritative");
  if (value.accounting !== "blocked_not_accounting_authority") errors.push("stale historical Pingan snapshots must block accounting authority");
  if (value.execution !== "blocked_not_execution_input") errors.push("stale historical Pingan snapshots must block execution input");
}

function validateHistoricalOnlyDisclosure(value: Record<string, unknown>, errors: string[]): void {
  const disclosure = `${String(value.limitation ?? "")} ${String(value.warning ?? "")}`.toLowerCase();
  const required: Array<[RegExp, string]> = [
    [/last[- ]imported/, "last-imported"],
    [/historical/, "historical"],
    [/not[- ]live|not live|no live/, "not-live"],
    [/not[- ]authoritative|not authoritative/, "not-authoritative"],
    [/broker[- ]reconciliation|broker reconciled|broker-reconciled|broker sync/, "no-broker-reconciliation"],
    [/account truth/, "no-account-truth"],
    [/accounting/, "no-accounting-authority"],
    [/execution/, "no-execution-input"],
    [/risk[- ]impact|risk impact/, "no-risk-impact"]
  ];
  for (const [pattern, label] of required) {
    if (!pattern.test(disclosure)) errors.push(`stale historical Pingan disclosure must include ${label}`);
  }
}

function validateFailClosedDataUse(value: unknown, errors: string[]): void {
  if (!isRecord(value)) return;
  for (const key of ["display", "riskImpact", "brokerReconciliation", "accountTruth", "accounting", "execution"]) {
    if (value[key] !== "blocked") errors.push(`fail-closed Pingan snapshots must block dataUse.${key}`);
  }
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("safety must be an object");
    return;
  }
  for (const key of ["readOnly", "createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker"] as const) {
    const expected = key === "readOnly";
    if (value[key] !== expected) errors.push(`safety.${key} must be ${expected}`);
  }
}

function isValidPosition(value: unknown): value is PinganSnapshotPositionData {
  return isRecord(value)
    && typeof value.market === "string"
    && typeof value.code === "string"
    && typeof value.symbol === "string"
    && typeof value.sourceRowId === "string"
    && value.sourceRowId.trim().length > 0
    && (typeof value.name === "string" || value.name === null)
    && typeof value.quantity === "number"
    && Number.isFinite(value.quantity)
    && value.quantity >= 0
    && isFiniteNumberOrNull(value.averageCost)
    && isFiniteNumberOrNull(value.currentWeight)
    && isFiniteNumberOrNull(value.maxWeight)
    && isFiniteNumberOrNull(value.unrealizedPnl)
    && (typeof value.currency === "string" || value.currency === null);
}

function validatePositionIdentity(requestedSymbol: unknown, positions: PinganSnapshotPositionData[], errors: string[]): void {
  if (positions.length === 0) return;
  if (typeof requestedSymbol !== "string") return;
  const [market, code, extra] = requestedSymbol.split(".");
  if (!market || !code || extra !== undefined) {
    errors.push("requestedSymbol must be MARKET.CODE for position-bearing responses");
    return;
  }
  for (const position of positions) {
    if (position.market !== market || position.code !== code || position.symbol !== requestedSymbol) {
      errors.push("positions identity must match requestedSymbol");
      return;
    }
  }
}

function isFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${field} must be a non-empty string`);
}

function requireString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string") errors.push(`${field} must be a string`);
}

function validateOptionalString(value: unknown, field: string, errors: string[]): void {
  if (value !== null && typeof value !== "string") errors.push(`${field} must be a string or null`);
}

function validateOptionalDateTime(value: unknown, field: string, errors: string[]): void {
  if (typeof value === "string" && !isStrictUtcDateTime(value)) {
    errors.push(`${field} must be a valid date-time`);
  }
}

function isStrictUtcDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
