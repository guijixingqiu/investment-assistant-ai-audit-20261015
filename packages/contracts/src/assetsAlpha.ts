import { isRfc3339DateTime } from "./factMetadata.js";

export const ASSETS_ALPHA_SCHEMA_VERSION = "2026-08-07.assets-alpha.v2";

export interface AssetsAlphaCostLot { quantity: number; unitCostHkd: number; }

export interface AssetsAlphaPosition {
  symbol: string;
  quantity: number;
  marketValueHkd: number | null;
  unrealizedPnlHkd: number | null;
  costLots?: AssetsAlphaCostLot[];
}

export interface CreateAssetsAlphaSnapshotRequest {
  source: "manual" | "csv" | "owner_current";
  asOf: string;
  cashHkd: number | null;
  positions: AssetsAlphaPosition[];
  ownerConfirmed: true;
  idempotencyKey: string;
  expectedSnapshotId?: string | null;
}

export interface CreateAssetsAlphaTradeRequest {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  priceHkd: number;
  occurredAt: string;
  note: string | null;
  ownerConfirmed: true;
  idempotencyKey: string;
}

export interface AssetsAlphaSnapshot {
  id: string;
  source: CreateAssetsAlphaSnapshotRequest["source"];
  asOf: string;
  cashHkd: number | null;
  positions: AssetsAlphaPosition[];
  ownerConfirmed: true;
  sourceHash: string;
  createdAt: string;
}

export interface AssetsAlphaTrade {
  id: string;
  symbol: string;
  side: CreateAssetsAlphaTradeRequest["side"];
  quantity: number;
  priceHkd: number;
  occurredAt: string;
  note: string | null;
  ownerConfirmed: true;
  sourceHash: string;
  createdAt: string;
}

export interface AssetsAlphaEnvelope {
  schemaVersion: typeof ASSETS_ALPHA_SCHEMA_VERSION;
  generatedAt: string;
  status: "available";
  requestedActorId: string;
  authority: {
    kind: "owner_entered_unofficial_local_alpha";
    official: false;
    production: false;
    currency: "HKD";
  };
  latestSnapshot: AssetsAlphaSnapshot | null;
  snapshots: AssetsAlphaSnapshot[];
  trades: AssetsAlphaTrade[];
  safety: {
    advisoryOnly: true;
    createsOrder: false;
    callsBroker: false;
    mutatesOfficialPortfolio: false;
  };
}

export interface AssetsAlphaSnapshotWriteResponse {
  createdRecord: AssetsAlphaSnapshot;
  envelope: AssetsAlphaEnvelope;
}

export interface AssetsAlphaTradeWriteResponse {
  createdRecord: AssetsAlphaTrade;
  envelope: AssetsAlphaEnvelope;
}

type Validation = { ok: true } | { ok: false; errors: string[] };

export function validateCreateAssetsAlphaSnapshotRequest(value: unknown): Validation {
  if (!record(value)) return invalid("snapshot request must be an object");
  const errors: string[] = [];
  exact(value, ["source", "asOf", "cashHkd", "positions", "ownerConfirmed", "idempotencyKey", ...(Object.hasOwn(value, "expectedSnapshotId") ? ["expectedSnapshotId"] : [])], "snapshot request", errors);
  if (value.source === "owner_current") {
    if (!Object.hasOwn(value, "expectedSnapshotId") || (value.expectedSnapshotId !== null && !id(value.expectedSnapshotId))) errors.push("expectedSnapshotId is required for current holdings");
    if (Array.isArray(value.positions) && value.positions.some(p => !record(p) || !Array.isArray(p.costLots))) errors.push("current holdings require cost lots");
  }
  if (!source(value.source)) errors.push("source is invalid");
  if (!instant(value.asOf)) errors.push("asOf is invalid");
  if (!nullableNonNegative(value.cashHkd)) errors.push("cashHkd is invalid");
  validatePositions(value.positions, "positions", errors);
  if (value.ownerConfirmed !== true) errors.push("ownerConfirmed must be true");
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return result(errors);
}

export function validateCreateAssetsAlphaTradeRequest(value: unknown): Validation {
  if (!record(value)) return invalid("trade request must be an object");
  const errors: string[] = [];
  exact(value, ["symbol", "side", "quantity", "priceHkd", "occurredAt", "note", "ownerConfirmed", "idempotencyKey"], "trade request", errors);
  validateTradeFields(value, "trade request", errors);
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return result(errors);
}

export function validateAssetsAlphaEnvelope(value: unknown): Validation {
  if (!record(value)) return invalid("envelope must be an object");
  const errors: string[] = [];
  exact(value, ["schemaVersion", "generatedAt", "status", "requestedActorId", "authority", "latestSnapshot", "snapshots", "trades", "safety"], "envelope", errors);
  if (value.schemaVersion !== ASSETS_ALPHA_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  if (!instant(value.generatedAt)) errors.push("generatedAt is invalid");
  if (value.status !== "available") errors.push("status is invalid");
  bounded(value.requestedActorId, "requestedActorId", 200, errors);
  validateAuthority(value.authority, errors);
  if (value.latestSnapshot !== null) validateSnapshot(value.latestSnapshot, "latestSnapshot", errors);
  if (!Array.isArray(value.snapshots) || value.snapshots.length > 100) errors.push("snapshots must be an array of at most 100 items");
  else {
    value.snapshots.forEach((snapshot, index) => validateSnapshot(snapshot, `snapshots[${index}]`, errors));
    if (new Set(value.snapshots.filter(record).map((snapshot) => snapshot.id)).size !== value.snapshots.length) {
      errors.push("snapshot ids must be unique");
    }
    const latestId = record(value.latestSnapshot) ? value.latestSnapshot.id : null;
    const firstId = record(value.snapshots[0]) ? value.snapshots[0].id : null;
    if ((value.latestSnapshot === null) !== (value.snapshots.length === 0)
      || (value.latestSnapshot !== null && latestId !== firstId)) {
      errors.push("latestSnapshot must match snapshots[0]");
    }
  }
  if (!Array.isArray(value.trades) || value.trades.length > 100) errors.push("trades must be an array of at most 100 items");
  else value.trades.forEach((trade, index) => validateTrade(trade, `trades[${index}]`, errors));
  validateSafety(value.safety, errors);
  return result(errors);
}

export function validateAssetsAlphaSnapshotWriteResponse(value: unknown): Validation {
  if (!record(value)) return invalid("snapshot write response must be an object");
  const errors: string[] = [];
  exact(value, ["createdRecord", "envelope"], "snapshot write response", errors);
  validateSnapshot(value.createdRecord, "createdRecord", errors);
  appendValidation(errors, "envelope", validateAssetsAlphaEnvelope(value.envelope));
  return result(errors);
}

export function validateAssetsAlphaTradeWriteResponse(value: unknown): Validation {
  if (!record(value)) return invalid("trade write response must be an object");
  const errors: string[] = [];
  exact(value, ["createdRecord", "envelope"], "trade write response", errors);
  validateTrade(value.createdRecord, "createdRecord", errors);
  appendValidation(errors, "envelope", validateAssetsAlphaEnvelope(value.envelope));
  return result(errors);
}

function validateSnapshot(value: unknown, label: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${label} is invalid`); return; }
  exact(value, ["id", "source", "asOf", "cashHkd", "positions", "ownerConfirmed", "sourceHash", "createdAt"], label, errors);
  if (!id(value.id)) errors.push(`${label}.id is invalid`);
  if (!source(value.source)) errors.push(`${label}.source is invalid`);
  if (!instant(value.asOf)) errors.push(`${label}.asOf is invalid`);
  if (!nullableNonNegative(value.cashHkd)) errors.push(`${label}.cashHkd is invalid`);
  validatePositions(value.positions, `${label}.positions`, errors);
  if (value.source === "owner_current" && Array.isArray(value.positions) && value.positions.some(p => !record(p) || !Array.isArray(p.costLots))) errors.push(`${label} current holdings require cost lots`);
  if (value.ownerConfirmed !== true) errors.push(`${label}.ownerConfirmed must be true`);
  if (!hash(value.sourceHash)) errors.push(`${label}.sourceHash is invalid`);
  if (!instant(value.createdAt)) errors.push(`${label}.createdAt is invalid`);
}

function validateTrade(value: unknown, label: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${label} is invalid`); return; }
  exact(value, ["id", "symbol", "side", "quantity", "priceHkd", "occurredAt", "note", "ownerConfirmed", "sourceHash", "createdAt"], label, errors);
  if (!id(value.id)) errors.push(`${label}.id is invalid`);
  validateTradeFields(value, label, errors);
  if (!hash(value.sourceHash)) errors.push(`${label}.sourceHash is invalid`);
  if (!instant(value.createdAt)) errors.push(`${label}.createdAt is invalid`);
}

function appendValidation(errors: string[], label: string, validation: Validation): void {
  if (!validation.ok) errors.push(...validation.errors.map((error) => `${label}.${error}`));
}

function validateTradeFields(value: Record<string, unknown>, label: string, errors: string[]): void {
  if (!symbol(value.symbol)) errors.push(`${label}.symbol is invalid`);
  if (value.side !== "buy" && value.side !== "sell") errors.push(`${label}.side is invalid`);
  if (!positive(value.quantity)) errors.push(`${label}.quantity is invalid`);
  if (!positive(value.priceHkd)) errors.push(`${label}.priceHkd is invalid`);
  if (!instant(value.occurredAt)) errors.push(`${label}.occurredAt is invalid`);
  if (value.note !== null && (typeof value.note !== "string" || value.note.length > 2000)) errors.push(`${label}.note is invalid`);
  if (value.ownerConfirmed !== true) errors.push(`${label}.ownerConfirmed must be true`);
}

function validatePositions(value: unknown, label: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length > 100) {
    errors.push(`${label} must contain 0 to 100 items`);
    return;
  }
  const symbols = new Set<string>();
  value.forEach((position, index) => {
    if (!record(position)) { errors.push(`${label}[${index}] is invalid`); return; }
    exact(position, ["symbol", "quantity", "marketValueHkd", "unrealizedPnlHkd", ...(Object.hasOwn(position, "costLots") ? ["costLots"] : [])], `${label}[${index}]`, errors);
    if (!symbol(position.symbol)) errors.push(`${label}[${index}].symbol is invalid`);
    else if (symbols.has(position.symbol)) errors.push(`${label} symbols must be unique`);
    else symbols.add(position.symbol);
    if (!positive(position.quantity)) errors.push(`${label}[${index}].quantity is invalid`);
    if (!nullableNonNegative(position.marketValueHkd)) errors.push(`${label}[${index}].marketValueHkd is invalid`);
    if (!nullableFinite(position.unrealizedPnlHkd)) errors.push(`${label}[${index}].unrealizedPnlHkd is invalid`);
    if (Object.hasOwn(position, "costLots")) {
      const lots = position.costLots;
      if (!Array.isArray(lots) || lots.length < 1 || lots.length > 100) errors.push("costLots must contain 1 to 100 lots");
      else {
        let quantity = 0, cost = 0;
        for (const lot of lots) {
          if (!record(lot)) { errors.push("invalid cost lot"); continue; }
          exact(lot, ["quantity", "unitCostHkd"], "cost lot", errors);
          if (!positive(lot.quantity) || !Number.isSafeInteger(lot.quantity) || !positive(lot.unitCostHkd)) errors.push("invalid lot quantity or cost");
          quantity += Number(lot.quantity); cost += Number(lot.quantity) * Number(lot.unitCostHkd);
        }
        if (!Number.isSafeInteger(quantity) || quantity !== position.quantity || !Number.isFinite(cost)) errors.push("cost lot totals must match position quantity");
      }
    }
  });
}

function validateAuthority(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("authority is invalid"); return; }
  exact(value, ["kind", "official", "production", "currency"], "authority", errors);
  if (value.kind !== "owner_entered_unofficial_local_alpha" || value.official !== false
    || value.production !== false || value.currency !== "HKD") errors.push("authority is invalid");
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("safety is invalid"); return; }
  exact(value, ["advisoryOnly", "createsOrder", "callsBroker", "mutatesOfficialPortfolio"], "safety", errors);
  if (value.advisoryOnly !== true || value.createsOrder !== false || value.callsBroker !== false
    || value.mutatesOfficialPortfolio !== false) errors.push("safety is invalid");
}

function exact(value: Record<string, unknown>, expected: string[], label: string, errors: string[]): void {
  const actual = Object.keys(value).sort();
  const target = [...expected].sort();
  if (actual.length !== target.length || actual.some((key, index) => key !== target[index])) errors.push(`${label} has unexpected or missing keys`);
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function source(value: unknown): value is CreateAssetsAlphaSnapshotRequest["source"] { return value === "manual" || value === "csv" || value === "owner_current"; }
function symbol(value: unknown): value is string { return typeof value === "string" && /^HK\.[0-9]{5}$/.test(value); }
function instant(value: unknown): value is string { return typeof value === "string" && isRfc3339DateTime(value) && Number.isFinite(Date.parse(value)); }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function positive(value: unknown): value is number { return finite(value) && value > 0; }
function nullableFinite(value: unknown): value is number | null { return value === null || finite(value); }
function nullableNonNegative(value: unknown): value is number | null { return value === null || (finite(value) && value >= 0); }
function id(value: unknown): value is string { return typeof value === "string" && /^[1-9][0-9]*$/.test(value); }
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function bounded(value: unknown, label: string, max: number, errors: string[]): void { if (typeof value !== "string" || value.trim().length === 0 || value.length > max) errors.push(`${label} must be a bounded non-empty string`); }
function result(errors: string[]): Validation { return errors.length ? { ok: false, errors } : { ok: true }; }
function invalid(error: string): Validation { return { ok: false, errors: [error] }; }
