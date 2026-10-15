import { isRfc3339DateTime } from "./factMetadata.js";
import { validateResearchWriteEnvelopeBase, type ResearchWriteEnvelope } from "./research.js";

export type TodayMaterialChangeDispositionState = "new" | "later" | "resolved";

export interface TodayMaterialChangeDispositionRequest {
  itemId: string;
  membershipVersion: number;
  sourceFingerprint: string;
  state: TodayMaterialChangeDispositionState;
  snoozedUntil: string | null;
  idempotencyKey: string;
}

export interface TodayMaterialChangeDispositionData {
  itemId: string;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  sourceId: string;
  sourceVersion: number | null;
  sourceFingerprint: string;
  state: TodayMaterialChangeDispositionState;
  snoozedUntil: string | null;
  stateChangedAt: string;
  stateReason: string;
}

export type TodayMaterialChangeDispositionWrite = ResearchWriteEnvelope<TodayMaterialChangeDispositionData>;

export function validateTodayMaterialChangeDispositionRequest(
  value: unknown,
  now = new Date()
): { ok: true } | { ok: false; errors: string[] } {
  if (!record(value)) return { ok: false, errors: ["request must be an object"] };
  const errors: string[] = [];
  exact(value, ["itemId", "membershipVersion", "sourceFingerprint", "state", "snoozedUntil", "idempotencyKey"], "request", errors);
  bounded(value.itemId, "itemId", 500, errors);
  if (!Number.isSafeInteger(value.membershipVersion) || Number(value.membershipVersion) < 1) errors.push("membershipVersion is invalid");
  if (typeof value.sourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint)) errors.push("sourceFingerprint is invalid");
  if (!["new", "later", "resolved"].includes(String(value.state))) errors.push("state is invalid");
  if (value.state === "later") {
    const timestamp = typeof value.snoozedUntil === "string" ? Date.parse(value.snoozedUntil) : NaN;
    if (typeof value.snoozedUntil !== "string" || !isRfc3339DateTime(value.snoozedUntil)
      || !Number.isFinite(timestamp) || timestamp <= now.getTime() || timestamp > now.getTime() + 365 * 86_400_000) {
      errors.push("snoozedUntil must be a future RFC3339 instant within 365 days");
    }
  } else if (value.snoozedUntil !== null) {
    errors.push("snoozedUntil must be null when state is resolved");
  }
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateTodayMaterialChangeDispositionWrite(
  value: unknown
): { ok: true } | { ok: false; errors: string[] } {
  const errors = validateResearchWriteEnvelopeBase(value, "material disposition write");
  if (record(value)) validateData(value.data, errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateTodayMaterialChangeDispositionData(
  value: unknown
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  validateData(value, errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

function validateData(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("material disposition data must be an object"); return; }
  exact(value, [
    "itemId", "membershipId", "membershipVersion", "symbol", "sourceId", "sourceVersion",
    "sourceFingerprint", "state", "snoozedUntil", "stateChangedAt", "stateReason"
  ], "material disposition data", errors);
  bounded(value.itemId, "material disposition data.itemId", 500, errors);
  bounded(value.membershipId, "material disposition data.membershipId", 50, errors);
  if (!Number.isSafeInteger(value.membershipVersion) || Number(value.membershipVersion) < 1) errors.push("material disposition data.membershipVersion is invalid");
  if (typeof value.symbol !== "string" || !/^HK\.\d{5}$/.test(value.symbol)) errors.push("material disposition data.symbol is invalid");
  bounded(value.sourceId, "material disposition data.sourceId", 500, errors);
  if (value.sourceVersion !== null && (!Number.isSafeInteger(value.sourceVersion) || Number(value.sourceVersion) < 1)) errors.push("material disposition data.sourceVersion is invalid");
  if (typeof value.sourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint)) errors.push("material disposition data.sourceFingerprint is invalid");
  if (!["new", "later", "resolved"].includes(String(value.state))) errors.push("material disposition data.state is invalid");
  if (value.snoozedUntil !== null && (typeof value.snoozedUntil !== "string" || !isRfc3339DateTime(value.snoozedUntil) || !Number.isFinite(Date.parse(value.snoozedUntil)))) errors.push("material disposition data.snoozedUntil is invalid");
  if (value.state === "resolved" && value.snoozedUntil !== null) errors.push("material disposition data.snoozedUntil must be null when resolved");
  if (typeof value.stateChangedAt !== "string" || !isRfc3339DateTime(value.stateChangedAt) || !Number.isFinite(Date.parse(value.stateChangedAt))) errors.push("material disposition data.stateChangedAt is invalid");
  bounded(value.stateReason, "material disposition data.stateReason", 500, errors);
}

function exact(value: Record<string, unknown>, expected: string[], label: string, errors: string[]): void {
  const actual = Object.keys(value).sort();
  const target = [...expected].sort();
  if (actual.length !== target.length || actual.some((key, index) => key !== target[index])) errors.push(`${label} has unexpected or missing keys`);
}

function bounded(value: unknown, label: string, max: number, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) errors.push(`${label} must be a bounded non-empty string`);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
