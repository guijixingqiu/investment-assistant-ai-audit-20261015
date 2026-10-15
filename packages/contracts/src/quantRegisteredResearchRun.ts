/**
 * Explicit registered quantitative research run contract.
 *
 * The client can only ask the API to run one of the fixed, repository-registered
 * operations below. No client supplied script, path, command, or environment is
 * ever accepted, and the registered target decides everything that is executed.
 */

import { sha256Hex } from "./sha256.js";

export const QUANT_FEE_POLICY_VERSION = "hk-cash-equity-fees.2026-09-13.v2";
/**
 * Version-bound digest of the expected fee policy the manifest must declare.
 * This is a constant in the run contract, not a generated policy platform; the
 * economic package must report a mismatch instead of pretending the run passed.
 */
export const QUANT_FEE_POLICY_SHA256 = "9222fe29d372ca938cce8e02108cdd98f6328254b9f28a51eb3ab67de828061d";
export const QUANT_FEE_POLICY_STALE_MESSAGE = "旧费用计算待重算";
export const QUANT_DIVIDEND_CASH_POLICY_VERSION = "hk-dividend-receivable-payment.2026-10-10.v2";
export const QUANT_DIVIDEND_CASH_POLICY_SHA256 = "9b53d70eedb68b41d6fd7976d40354470f230ca5b54d51e317800a46b801e447";
export const QUANT_DIVIDEND_CASH_STALE_MESSAGE = "旧股息现金时点待重算";
export const QUANT_REGISTERED_RUN_SCHEMA_VERSION = "2026-09-13.registered-quant-research-run.v1";

/**
 * Execution timing metadata recorded on refreshed manifests. The research lane
 * only claims the next observed session open; it does not claim verified
 * historical exchange-calendar completeness.
 */
export const QUANT_EXECUTION_CALENDAR_METADATA = {
  timing: "next_observed_session_open",
  calendarCompleteness: "unknown"
} as const;

export interface RegisteredQuantResearchTarget {
  symbol: string;
  operationId: string;
  scriptPath: string;
  configPath: string;
  manifestPath: string;
}

export const REGISTERED_QUANT_RESEARCH_TARGETS: readonly RegisteredQuantResearchTarget[] = [
  {
    symbol: "HK.00175",
    operationId: "quant-hk00175-v0.1",
    scriptPath: "scripts/hk00175-quant-v0.1.mjs",
    configPath: "config/quant-hk00175-dividend-payment-v2.json",
    manifestPath: "artifacts/hk00175-quant-dividend-payment-v2/run_manifest.json"
  },
  {
    symbol: "HK.00700",
    operationId: "quant-hk00700-v0.1",
    scriptPath: "scripts/hk00175-quant-v0.1.mjs",
    configPath: "config/quant-hk00700-dividend-payment-v2.json",
    manifestPath: "artifacts/hk00700-quant-dividend-payment-v2/run_manifest.json"
  }
];

export function registeredQuantResearchTarget(symbol: unknown): RegisteredQuantResearchTarget | null {
  return typeof symbol === "string"
    ? REGISTERED_QUANT_RESEARCH_TARGETS.find((target) => target.symbol === symbol) ?? null
    : null;
}

export interface RegisteredQuantResearchRunRequest {
  membershipVersion: number;
  ownerConfirmed: true;
  idempotencyKey: string;
}

/**
 * Minimal per-run receipt. The actor and membership binding always come from the
 * server-side authorization and membership read, never from client input.
 */
export interface RegisteredQuantRunReceipt {
  symbol: string;
  actorId: string;
  membershipVersion: number;
  idempotencyKey: string;
  runId: string;
  manifestPath: string;
  manifestSha256: string;
  catalogPath: string;
  catalogSha256: string;
  completedAt: string;
}

export function parseRegisteredQuantResearchRunRequest(body: unknown):
  | { ok: true; value: RegisteredQuantResearchRunRequest }
  | { ok: false; errors: string[] } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["registered research run body must be a JSON object"] };
  }
  const record = body as Record<string, unknown>;
  const allowed = new Set(["membershipVersion", "ownerConfirmed", "idempotencyKey"]);
  const errors = Object.keys(record)
    .filter((key) => !allowed.has(key))
    .map((key) => `unsupported registered research run field ${key}`);
  const version = record.membershipVersion;
  if (!Number.isInteger(version) || (version as number) < 1) {
    errors.push("membershipVersion must be a positive integer");
  }
  if (record.ownerConfirmed !== true) {
    errors.push("ownerConfirmed must be true to run registered research");
  }
  const idempotencyKey = record.idempotencyKey;
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) {
    errors.push("idempotencyKey must be 8-200 characters of letters, digits, dot, underscore, colon, or hyphen");
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      membershipVersion: version as number,
      ownerConfirmed: true,
      idempotencyKey: idempotencyKey as string
    }
  };
}

export function registeredQuantResearchRunCoalescingKey(
  target: RegisteredQuantResearchTarget,
  request: RegisteredQuantResearchRunRequest
): string {
  return `${target.operationId}:${request.membershipVersion}:${request.idempotencyKey}`;
}

export type QuantFeePolicyGateResult =
  | { ok: true; feePolicyVersion: string; feePolicySha256: string }
  | { ok: false; reason: string; message: string };

/**
 * Fee-policy acceptance gate shared by the decision evidence and portfolio lab
 * adapters. A manifest that does not declare the current dated fee policy (or
 * declares an invalid digest) is not usable as accepted report evidence.
 */
export function quantManifestFeePolicyGate(manifest: unknown): QuantFeePolicyGateResult {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return stale("manifest is not a JSON object");
  }
  const record = manifest as Record<string, unknown>;
  const version = record.feePolicyVersion;
  const sha256 = record.feePolicySha256;
  if (typeof version !== "string" || version !== QUANT_FEE_POLICY_VERSION) {
    return stale(`manifest fee policy version is ${typeof version === "string" ? version : "missing"}`);
  }
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
    return stale("manifest fee policy digest is missing or malformed");
  }
  if (sha256.toLowerCase() !== QUANT_FEE_POLICY_SHA256) {
    return stale(`manifest fee policy digest ${sha256} does not match the expected policy identity`);
  }
  return { ok: true, feePolicyVersion: version, feePolicySha256: sha256 };
}

export function quantManifestDividendCashGate(manifest: unknown):
  | { ok: true; policyVersion: string; ledgerHash: string }
  | { ok: false; reason: "dividend-cash-policy"; message: string } {
  const bad = (detail: string) => ({ ok: false as const, reason: "dividend-cash-policy" as const,
    message: `${QUANT_DIVIDEND_CASH_STALE_MESSAGE}：${detail}。历史回测不可作为当前已核准现金证据。` });
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) return bad("manifest is not an object");
  const record = manifest as Record<string, unknown>;
  if (record.schemaVersion !== "2026-10-10.hk-stock-quant-dividend-payment-manifest.v2")
    return bad("manifest uses the prior cash-dividend accounting version");
  const policy = asRecord(record.dividendCashPolicy);
  const expected = {
    version: QUANT_DIVIDEND_CASH_POLICY_VERSION,
    entitlement: "shares_before_ex_date_execution",
    settlement: "first_observed_trading_session_strictly_after_announced_payment_date",
    buyingPower: "cash_only",
    netAssetValue: "cash_plus_unadjusted_market_value_plus_unpaid_dividend_receivable"
  };
  if (!policy || Object.keys(policy).sort().join() !== [...Object.keys(expected), "sha256", "ledgerHash", "accountingAuditSha256"].sort().join()
    || Object.entries(expected).some(([key, value]) => policy[key] !== value)
    || policy.sha256 !== QUANT_DIVIDEND_CASH_POLICY_SHA256
    || sha256Hex(JSON.stringify(expected)) !== QUANT_DIVIDEND_CASH_POLICY_SHA256) return bad("policy identity is missing or mismatched");
  const data = asRecord(record.dataIdentity);
  const ledger = asRecord(data?.corporateActionLedger);
  if (!ledger || typeof ledger.ledgerHash !== "string" || !/^[a-f0-9]{64}$/.test(ledger.ledgerHash)
    || policy.ledgerHash !== ledger.ledgerHash) return bad("policy is not bound to the new corporate-action ledger");
  const baseline = asRecord(record.baselinePolicy);
  const audits = asRecord(baseline?.accountingAudit);
  if (!audits || !["train", "validation", "final_test"].every((split) => {
    const audit = asRecord(audits[split]);
    const checks = asRecord(audit?.checks);
    return audit?.ok === true && checks?.dividendSettlementsExactlyOnceAfterPayment === true
      && checks?.dividendReceivableRollForward === true
      && checks?.cashRollForwardUsesOnlySettlementsAndTrades === true
      && checks?.dividendReceivableNeverNegative === true
      && checks?.buysSpendCashOnly === true && checks?.navUsesUnadjustedCloses === true;
  })) return bad("all split cash, receivable and settlement audits are required");
  const auditHash = sha256Hex(stableJson(audits));
  const formal = asRecord(record.formalEvidence);
  const checks = Array.isArray(formal?.checks) ? formal.checks.filter(asRecord) : [];
  if (policy.accountingAuditSha256 !== auditHash
    || !checks.some((check) => check.id === "cash_position_accounting"
      && check.status === "available" && check.identity === `accounting-audit:${auditHash}`))
    return bad("the declared policy does not match the recalculated accounting audits");
  return { ok: true, policyVersion: expected.version, ledgerHash: ledger.ledgerHash };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function stableJson(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => [key, sort(entry)])) : item;
  return JSON.stringify(sort(value));
}

function stale(detail: string): Extract<QuantFeePolicyGateResult, { ok: false }> {
  return {
    ok: false,
    reason: "fee-policy-version",
    message: `${QUANT_FEE_POLICY_STALE_MESSAGE}：${detail}。配置费率仅供参考，实际执行成本按每笔成交计算。`
  };
}

/**
 * Root execution-calendar metadata must be present and must not overstate
 * completeness before a manifest is accepted.
 */
export function quantManifestExecutionCalendarIsBounded(manifest: unknown): boolean {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) return false;
  const calendar = (manifest as Record<string, unknown>).executionCalendar;
  if (typeof calendar !== "object" || calendar === null || Array.isArray(calendar)) return false;
  const record = calendar as Record<string, unknown>;
  return record.timing === QUANT_EXECUTION_CALENDAR_METADATA.timing
    && record.calendarCompleteness === QUANT_EXECUTION_CALENDAR_METADATA.calendarCompleteness;
}
