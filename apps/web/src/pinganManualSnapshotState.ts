import type { PinganSnapshotEnvelope } from "../../../packages/contracts/src/portfolioSnapshot.js";
import { validatePinganSnapshotStrict } from "./contractValidation.js";

export const PINGAN_MANUAL_SNAPSHOT_SCHEMA_VERSION = "2026-07-19.web-pingan-manual-snapshot.v2";

export interface PinganManualSnapshotStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PinganManualSnapshotInput {
  accountScopeId: string;
  symbol: string;
  sourceAsOf: string;
  importedAt: string;
  name: string | null;
  quantity: number;
  averageCost: number | null;
  currentWeight: number | null;
  maxWeight: number | null;
  unrealizedPnl: number | null;
  currency: string | null;
  replacesSnapshotId?: string | null;
}

export interface PinganManualSnapshotEnvelope {
  schemaVersion: typeof PINGAN_MANUAL_SNAPSHOT_SCHEMA_VERSION;
  storageScope: "browser_local_storage";
  accountScopeId: string;
  targetSymbol: string;
  sourceSignature: string;
  updatedAt: string;
  replacesSnapshotId: string | null;
  metadata: {
    source: "owner_manual_pingan_snapshot";
    provenance: "browser_local_manual_import";
    authority: "historical_only_not_live_not_authoritative";
    freshness: "historical";
  };
  snapshot: PinganSnapshotEnvelope;
  safety: {
    localOnly: true;
    historicalOnly: true;
    apiUploaded: false;
    databaseWritten: false;
    officialPortfolioFact: false;
    officialReviewFact: false;
    riskImpactAuthority: false;
    brokerSynced: false;
    executionInput: false;
  };
  message: string;
}

export type PinganManualSnapshotLoadResult =
  | { ok: true; state: "loaded"; envelope: PinganManualSnapshotEnvelope; message: string }
  | { ok: false; state: "missing" | "mismatch" | "malformed" | "legacy_unscoped" | "storage_unavailable"; message: string };

export class PinganManualSnapshotStorageError extends Error {
  constructor(operation: "save" | "clear", cause?: unknown) {
    super(`Browser localStorage ${operation} failed.`);
    this.name = "PinganManualSnapshotStorageError";
    if (cause !== undefined) this.cause = cause;
  }
}

const HISTORICAL_LIMITATION = "Owner manual update for last-imported and historical display only; not live, not authoritative, no broker reconciliation, no account truth, no accounting authority, no execution input, and no risk-impact authority.";
const HISTORICAL_WARNING = "Pingan portfolio context is a manually updated last-imported historical snapshot. It is not live, not authoritative, not broker-reconciled, not account truth, not accounting authority, not execution input, and not approved for risk-impact calculations.";

export function pinganManualSnapshotStorageKey(accountScopeId: string, symbol: string): string {
  return `pingan-manual-historical-v2:${encodeURIComponent(requireAccountScopeId(accountScopeId))}:${requireCanonicalSymbol(symbol)}`;
}

export function pinganManualSnapshotLegacyStorageKey(symbol: string): string {
  return `pingan-manual-historical-v1:${requireCanonicalSymbol(symbol)}`;
}

export function buildPinganManualSnapshotEnvelope(input: PinganManualSnapshotInput): PinganManualSnapshotEnvelope {
  const accountScopeId = requireAccountScopeId(input.accountScopeId);
  const encodedAccountScopeId = encodeURIComponent(accountScopeId);
  const symbol = requireCanonicalSymbol(input.symbol);
  const importedAt = requireDateTime(input.importedAt, "importedAt");
  const sourceAsOf = requireDateTime(input.sourceAsOf, "sourceAsOf");
  if (Date.parse(sourceAsOf) > Date.parse(importedAt)) {
    throw new Error("sourceAsOf cannot be later than the manual import time");
  }
  const quantity = requireFiniteNumber(input.quantity, "quantity", 0);
  const averageCost = optionalFiniteNumber(input.averageCost, "averageCost", 0);
  const currentWeight = optionalFiniteNumber(input.currentWeight, "currentWeight", 0, 1);
  const maxWeight = optionalFiniteNumber(input.maxWeight, "maxWeight", 0, 1);
  const unrealizedPnl = optionalFiniteNumber(input.unrealizedPnl, "unrealizedPnl");
  const [market, code] = symbol.split(".");
  const snapshotId = `pingan-manual-browser:${encodedAccountScopeId}:${symbol}:${sourceAsOf}:${importedAt}`;
  const snapshot: PinganSnapshotEnvelope = {
    schemaVersion: "2026-06-27.core-1b-pingan-snapshot.v1",
    status: "stale",
    requestedSymbol: symbol,
    sourceSystem: "pingan_imported_snapshot",
    sourceSnapshotId: snapshotId,
    sourceAsOf,
    importedAt,
    fetchedAt: importedAt,
    freshness: "historical",
    limitation: HISTORICAL_LIMITATION,
    warning: HISTORICAL_WARNING,
    positions: [{
      market,
      code,
      symbol,
      sourceRowId: `browser-local-manual:${encodedAccountScopeId}:${symbol}:${sourceAsOf}`,
      name: normalizeText(input.name, 120),
      quantity,
      averageCost,
      currentWeight,
      maxWeight,
      unrealizedPnl,
      currency: normalizeCurrency(input.currency)
    }],
    positionCount: 1,
    dataUse: {
      display: "allowed_with_warning",
      riskImpact: "blocked_stale_historical_only",
      brokerReconciliation: "blocked_not_live_authoritative",
      accountTruth: "blocked_not_live_authoritative",
      accounting: "blocked_not_accounting_authority",
      execution: "blocked_not_execution_input"
    },
    safety: {
      readOnly: true,
      createsOrder: false,
      createsTrade: false,
      mutatesCash: false,
      writesFee: false,
      mutatesPosition: false,
      callsBroker: false
    },
    message: `Browser-local manual Pingan historical snapshot for ${symbol}; display only with warning.`
  };
  const envelope: PinganManualSnapshotEnvelope = {
    schemaVersion: PINGAN_MANUAL_SNAPSHOT_SCHEMA_VERSION,
    storageScope: "browser_local_storage",
    accountScopeId,
    targetSymbol: symbol,
    sourceSignature: `manual-pingan-historical:${encodedAccountScopeId}:${symbol}:${sourceAsOf}`,
    updatedAt: importedAt,
    replacesSnapshotId: normalizeText(input.replacesSnapshotId ?? null, 500),
    metadata: {
      source: "owner_manual_pingan_snapshot",
      provenance: "browser_local_manual_import",
      authority: "historical_only_not_live_not_authoritative",
      freshness: "historical"
    },
    snapshot,
    safety: {
      localOnly: true,
      historicalOnly: true,
      apiUploaded: false,
      databaseWritten: false,
      officialPortfolioFact: false,
      officialReviewFact: false,
      riskImpactAuthority: false,
      brokerSynced: false,
      executionInput: false
    },
    message: "Saved only in this browser as a manually updated historical Pingan snapshot; not uploaded, not database-backed, not live holdings, and not an official portfolio fact."
  };
  const validation = validatePinganManualSnapshotEnvelope(envelope, accountScopeId, symbol);
  if (!validation.ok) throw new Error(`manual Pingan snapshot failed validation: ${validation.errors.join("; ")}`);
  return envelope;
}

export function validatePinganManualSnapshotEnvelope(
  value: unknown,
  expectedAccountScopeId: string,
  expectedSymbol: string
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const accountScopeId = requireAccountScopeId(expectedAccountScopeId);
  const encodedAccountScopeId = encodeURIComponent(accountScopeId);
  if (!isRecord(value)) return { ok: false, errors: ["manual snapshot envelope must be an object"] };
  rejectUnknownKeys(value, ["schemaVersion", "storageScope", "accountScopeId", "targetSymbol", "sourceSignature", "updatedAt", "replacesSnapshotId", "metadata", "snapshot", "safety", "message"], "envelope", errors);
  if (value.schemaVersion !== PINGAN_MANUAL_SNAPSHOT_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  if (value.storageScope !== "browser_local_storage") errors.push("storageScope must be browser_local_storage");
  if (value.accountScopeId !== accountScopeId) errors.push("accountScopeId does not match the current verified portfolio account scope");
  if (value.targetSymbol !== expectedSymbol) errors.push("targetSymbol does not match the current symbol");
  if (typeof value.sourceSignature !== "string" || value.sourceSignature !== `manual-pingan-historical:${encodedAccountScopeId}:${expectedSymbol}:${isRecord(value.snapshot) ? String(value.snapshot.sourceAsOf ?? "") : ""}`) {
    errors.push("sourceSignature does not match the snapshot source identity");
  }
  if (!isDateTime(value.updatedAt)) errors.push("updatedAt must be a valid date-time");
  if (value.replacesSnapshotId !== null && typeof value.replacesSnapshotId !== "string") errors.push("replacesSnapshotId must be a string or null");
  validateMetadata(value.metadata, errors);
  validateLocalSafety(value.safety, errors);
  if (typeof value.message !== "string") errors.push("message must be a string");
  validateSnapshotShape(value.snapshot, errors);
  const snapshotValidation = validatePinganSnapshotStrict(value.snapshot, expectedSymbol);
  if (!snapshotValidation.ok) errors.push(snapshotValidation.reason);
  if (isRecord(value.snapshot)) {
    if (value.snapshot.importedAt !== value.updatedAt || value.snapshot.fetchedAt !== value.updatedAt) {
      errors.push("updatedAt must equal snapshot importedAt and fetchedAt");
    }
    if (isDateTime(value.snapshot.sourceAsOf) && isDateTime(value.updatedAt) && Date.parse(value.snapshot.sourceAsOf) > Date.parse(value.updatedAt)) {
      errors.push("snapshot sourceAsOf cannot be later than updatedAt");
    }
    const expectedSnapshotId = `pingan-manual-browser:${encodedAccountScopeId}:${expectedSymbol}:${String(value.snapshot.sourceAsOf ?? "")}:${String(value.updatedAt ?? "")}`;
    if (value.snapshot.sourceSnapshotId !== expectedSnapshotId) errors.push("snapshot sourceSnapshotId does not match local source identity");
    const positions = Array.isArray(value.snapshot.positions) ? value.snapshot.positions : [];
    if (positions.length !== 1) errors.push("manual snapshot must contain exactly one current-symbol historical position");
    if (isRecord(positions[0]) && positions[0].sourceRowId !== `browser-local-manual:${encodedAccountScopeId}:${expectedSymbol}:${String(value.snapshot.sourceAsOf ?? "")}`) {
      errors.push("snapshot sourceRowId does not match local source identity");
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function savePinganManualSnapshotToStorage(
  storage: PinganManualSnapshotStorageLike,
  input: PinganManualSnapshotInput
): PinganManualSnapshotEnvelope {
  const envelope = buildPinganManualSnapshotEnvelope(input);
  try {
    storage.setItem(pinganManualSnapshotStorageKey(envelope.accountScopeId, envelope.targetSymbol), JSON.stringify(envelope));
  } catch (error) {
    throw new PinganManualSnapshotStorageError("save", error);
  }
  return envelope;
}

export function loadPinganManualSnapshotFromStorage(
  storage: PinganManualSnapshotStorageLike,
  accountScopeId: string,
  symbol: string
): PinganManualSnapshotLoadResult {
  const scope = requireAccountScopeId(accountScopeId);
  const canonical = requireCanonicalSymbol(symbol);
  let raw: string | null;
  try {
    raw = storage.getItem(pinganManualSnapshotStorageKey(scope, canonical));
    if (!raw && storage.getItem(pinganManualSnapshotLegacyStorageKey(canonical))) {
      return { ok: false, state: "legacy_unscoped", message: "Legacy symbol-only manual Pingan snapshot is not account-scoped and is not migrated or displayed." };
    }
  } catch {
    return { ok: false, state: "storage_unavailable", message: "Browser localStorage read failed; no manual Pingan snapshot is displayed." };
  }
  if (!raw) return { ok: false, state: "missing", message: `No browser-local manual Pingan snapshot exists for ${canonical}.` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, state: "malformed", message: "Saved manual Pingan snapshot is malformed and is not displayed." };
  }
  const validation = validatePinganManualSnapshotEnvelope(parsed, scope, canonical);
  if (!validation.ok) {
    const mismatch = isRecord(parsed) && ((typeof parsed.accountScopeId === "string" && parsed.accountScopeId !== scope) || (typeof parsed.targetSymbol === "string" && parsed.targetSymbol !== canonical));
    return {
      ok: false,
      state: mismatch ? "mismatch" : "malformed",
      message: `Saved manual Pingan snapshot failed closed: ${validation.errors.join("; ")}`
    };
  }
  return {
    ok: true,
    state: "loaded",
    envelope: parsed as unknown as PinganManualSnapshotEnvelope,
    message: `Loaded the browser-local manual historical Pingan snapshot for ${canonical} in the current verified account scope.`
  };
}

export function clearPinganManualSnapshotFromStorage(storage: PinganManualSnapshotStorageLike, accountScopeId: string, symbol: string): void {
  try {
    storage.removeItem(pinganManualSnapshotStorageKey(accountScopeId, symbol));
  } catch (error) {
    throw new PinganManualSnapshotStorageError("clear", error);
  }
}

export function describePinganManualSnapshot(envelope: PinganManualSnapshotEnvelope): string[] {
  const position = envelope.snapshot.positions[0];
  return [
    `手工历史快照：账号范围 ${envelope.accountScopeId}，标的 ${envelope.targetSymbol}，数量 ${position.quantity}，截至 ${envelope.snapshot.sourceAsOf ?? "缺失"}。`,
    `本地更新时间：${envelope.updatedAt}；替代快照：${envelope.replacesSnapshotId ?? "无"}。`,
    `来源：${envelope.metadata.source}；provenance=${envelope.metadata.provenance}；authority=${envelope.metadata.authority}；freshness=${envelope.metadata.freshness}。`,
    "仅保存在当前浏览器，不上传 API、不写数据库、不进入官方持仓、官方复核、券商同步、风险影响或交易执行。"
  ];
}

function validateMetadata(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("metadata must be an object");
    return;
  }
  rejectUnknownKeys(value, ["source", "provenance", "authority", "freshness"], "metadata", errors);
  if (value.source !== "owner_manual_pingan_snapshot") errors.push("metadata.source is invalid");
  if (value.provenance !== "browser_local_manual_import") errors.push("metadata.provenance is invalid");
  if (value.authority !== "historical_only_not_live_not_authoritative") errors.push("metadata.authority is invalid");
  if (value.freshness !== "historical") errors.push("metadata.freshness must be historical");
}

function validateLocalSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("safety must be an object");
    return;
  }
  const keys = ["localOnly", "historicalOnly", "apiUploaded", "databaseWritten", "officialPortfolioFact", "officialReviewFact", "riskImpactAuthority", "brokerSynced", "executionInput"];
  rejectUnknownKeys(value, keys, "safety", errors);
  if (value.localOnly !== true || value.historicalOnly !== true) errors.push("safety must remain local-only and historical-only");
  for (const key of keys.slice(2)) {
    if (value[key] !== false) errors.push(`safety.${key} must be false`);
  }
}

function validateSnapshotShape(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("snapshot must be an object");
    return;
  }
  rejectUnknownKeys(value, ["schemaVersion", "status", "requestedSymbol", "sourceSystem", "sourceSnapshotId", "sourceAsOf", "importedAt", "fetchedAt", "freshness", "limitation", "warning", "positions", "positionCount", "dataUse", "safety", "message"], "snapshot", errors);
  if (Array.isArray(value.positions)) {
    for (const [index, position] of value.positions.entries()) {
      if (isRecord(position)) rejectUnknownKeys(position, ["market", "code", "symbol", "sourceRowId", "name", "quantity", "averageCost", "currentWeight", "maxWeight", "unrealizedPnl", "currency"], `snapshot.positions[${index}]`, errors);
    }
  }
  if (isRecord(value.dataUse)) rejectUnknownKeys(value.dataUse, ["display", "riskImpact", "brokerReconciliation", "accountTruth", "accounting", "execution"], "snapshot.dataUse", errors);
  if (isRecord(value.safety)) rejectUnknownKeys(value.safety, ["readOnly", "createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker"], "snapshot.safety", errors);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], field: string, errors: string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) errors.push(`${field}.${key} is not allowed`);
  }
}

function requireCanonicalSymbol(value: string): string {
  const symbol = value.trim().toUpperCase();
  if (!/^HK\.[0-9]{5}$/.test(symbol)) throw new Error("manual Pingan snapshot requires a canonical HK five-digit symbol");
  return symbol;
}

function requireAccountScopeId(value: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error("manual Pingan snapshot requires a verified accountScopeId");
  return value;
}

function requireDateTime(value: string, field: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${field} must be a valid date-time`);
  return new Date(timestamp).toISOString();
}

function isDateTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function requireFiniteNumber(value: number, field: string, minimum?: number, maximum?: number): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
  if (minimum !== undefined && value < minimum) throw new Error(`${field} must be at least ${minimum}`);
  if (maximum !== undefined && value > maximum) throw new Error(`${field} must be at most ${maximum}`);
  return value;
}

function optionalFiniteNumber(value: number | null, field: string, minimum?: number, maximum?: number): number | null {
  return value === null ? null : requireFiniteNumber(value, field, minimum, maximum);
}

function normalizeText(value: string | null, maximumLength: number): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maximumLength);
}

function normalizeCurrency(value: string | null): string | null {
  const normalized = normalizeText(value, 12);
  return normalized?.toUpperCase() ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
