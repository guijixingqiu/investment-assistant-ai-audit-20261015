import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const DIVIDEND_PAYMENT_LEDGER_SCHEMA = "2026-10-10.real-data-corporate-action-ledger.dividend-payment.v2";
export const DIVIDEND_CASH_POLICY = Object.freeze({
  version: "hk-dividend-receivable-payment.2026-10-10.v2",
  entitlement: "shares_before_ex_date_execution",
  settlement: "first_observed_trading_session_strictly_after_announced_payment_date",
  buyingPower: "cash_only",
  netAssetValue: "cash_plus_unadjusted_market_value_plus_unpaid_dividend_receivable"
});
export const DIVIDEND_CASH_POLICY_SHA256 = createHash("sha256")
  .update(JSON.stringify(DIVIDEND_CASH_POLICY)).digest("hex");

const sourceRoot = "docs/reviews/quant-dividend-payment-20261010/sources";
const document = (name, sha256, byteLength) => ({
  path: `${sourceRoot}/${name}.pdf`, sha256, byteLength
});

const records = Object.freeze({
  "HK.00175": {
    eventId: "futu-rehab-hk-00175-2026-06-12-ordinary-429e8a443ce1",
    sourceRecordHash: "429e8a443ce1d515d4fc55571ac2438871421c6a55ea7cd764b51190faa82de1",
    exDate: "2026-06-12", cashAmount: 0.5, currency: "HKD", paymentDate: "2026-07-30",
    paymentEvidence: {
      announcement: { ...document("geely-dividend-20260318", "cac707a857850ef34bddc77ce3f62402b288662dcf72701b73067c0e65cd8f96", 42291),
        page: 1, locator: "Dividend declared HKD 0.5 per share; Ex-dividend date 12 June 2026; Payment date 30 July 2026" },
      approval: { ...document("geely-agm-20260601", "307c1aad8986823ff65a954ae43824fee9f42da7f194d9ddc99e8760cb88da18", 160632),
        page: 2, locator: "Resolution 2: To declare a final dividend for the year ended 31 December 2025; duly passed" },
      paymentConfirmation: { ...document("geely-agm-20260601", "307c1aad8986823ff65a954ae43824fee9f42da7f194d9ddc99e8760cb88da18", 160632),
        page: 4, locator: "PAYMENT OF FINAL DIVIDEND OF HK$0.50 PER ORDINARY SHARE ON 30 JULY 2026" },
      announcedAt: "2026-03-18", approvedAt: "2026-06-01",
      brokerCashReceipt: "UNKNOWN"
    }
  },
  "HK.00700": {
    eventId: "futu-rehab-hk-00700-2026-05-15-ordinary-52bfbfcbc5d6",
    sourceRecordHash: "52bfbfcbc5d611e83021df06139064bb98939f5ec5dfa961e9ac54feaf7deba0",
    exDate: "2026-05-15", cashAmount: 5.3, currency: "HKD", paymentDate: "2026-06-01",
    paymentEvidence: {
      announcement: { ...document("tencent-dividend-20260318", "7a44eb6a5129dc994198bfc6cb6a403ce8c7eb984322cfda060e33121199414a", 42765),
        page: 1, locator: "Dividend declared HKD 5.3 per share; Ex-dividend date 15 May 2026; Payment date 01 June 2026" },
      approval: { ...document("tencent-agm-20260513", "e0afaf36daeabd6c1b8f86d9c009d98d3c57aec2f0dc3a75bdffcf411c177f8a", 117041),
        page: 2, locator: "Resolution 2: To declare a final dividend; approved by shareholders" },
      paymentConfirmation: null,
      announcedAt: "2026-03-18", approvedAt: "2026-05-13",
      brokerCashReceipt: "UNKNOWN"
    }
  }
});

export function officialDividendPaymentFor(event) {
  const expected = records[`${event?.market}.${event?.code}`];
  if (!expected || event.actionType !== "cash_dividend"
    || event.eventId !== expected.eventId || event.sourceRecordHash !== expected.sourceRecordHash
    || event.exDate !== expected.exDate || event.cashAmount !== expected.cashAmount
    || event.currency !== expected.currency) return null;
  return structuredClone({ paymentDate: expected.paymentDate, paymentEvidence: expected.paymentEvidence });
}

export function officialDividendPaymentMatches(event) {
  const expected = officialDividendPaymentFor(event);
  return expected !== null && event.paymentDate === expected.paymentDate
    && isDeepStrictEqual(event.paymentEvidence, expected.paymentEvidence);
}

export async function verifyOfficialDividendPaymentFiles(repositoryRoot) {
  const verified = new Map();
  for (const record of Object.values(records)) {
    for (const evidence of [record.paymentEvidence.announcement,
      record.paymentEvidence.approval, record.paymentEvidence.paymentConfirmation].filter(Boolean)) {
      if (verified.has(evidence.path)) continue;
      const bytes = await readFile(join(repositoryRoot, evidence.path));
      if (bytes.length !== evidence.byteLength
        || createHash("sha256").update(bytes).digest("hex") !== evidence.sha256) {
        throw new Error(`official dividend PDF original differs from its bound identity: ${evidence.path}`);
      }
      verified.set(evidence.path, { sha256: evidence.sha256, byteLength: bytes.length });
    }
  }
  return [...verified].map(([path, identity]) => ({ path, ...identity }));
}

export async function createDividendPaymentLedgerFromLegacy(repositoryRoot, legacyPath, outputPath) {
  await verifyOfficialDividendPaymentFiles(repositoryRoot);
  const oldBytes = await readFile(join(repositoryRoot, legacyPath));
  const old = JSON.parse(oldBytes);
  if (old.schemaVersion !== "2026-07-19.real-data-corporate-action-ledger.v1"
    || old.coverage?.eventCount !== 1 || old.events?.length !== 1) {
    throw new Error("exactly one legacy dividend event is required for this bounded correction");
  }
  if (createHash("sha256").update(stableJson(ledgerHashPayload(old))).digest("hex") !== old.ledgerHash) {
    throw new Error("legacy dividend ledger hash differs from its saved content");
  }
  const event = old.events[0];
  const payment = officialDividendPaymentFor(event);
  if (!payment) throw new Error("legacy dividend does not match the official bounded source identity");
  const ledger = structuredClone(old);
  ledger.schemaVersion = DIVIDEND_PAYMENT_LEDGER_SCHEMA;
  ledger.events = [{ ...event, ...payment }];
  ledger.ledgerHash = createHash("sha256").update(stableJson(ledgerHashPayload(ledger))).digest("hex");
  const symbol = `${event.market}.${event.code}`.toLowerCase();
  ledger.ledgerId = `hk-${symbol}-corporate-actions-${ledger.coverage.dateRange.start}-${ledger.coverage.dateRange.end}-${ledger.ledgerHash.slice(0, 12)}`;
  await writeFile(join(repositoryRoot, outputPath), `${JSON.stringify(sortJson(ledger), null, 2)}\n`, { flag: "wx" });
  return { path: outputPath, ledgerHash: ledger.ledgerHash, ledgerId: ledger.ledgerId };
}

function stableJson(value) { return JSON.stringify(sortJson(value)); }
function ledgerHashPayload(ledger) {
  return {
    schemaVersion: ledger.schemaVersion, sourceKind: ledger.sourceKind,
    sourceClass: ledger.sourceClass, authorizationId: ledger.authorizationId,
    universeVersion: ledger.universeVersion, dataCutoff: ledger.dataCutoff,
    universe: ledger.universe, coverage: ledger.coverage, events: ledger.events,
    authority: ledger.authority
  };
}
function sortJson(value) {
  return Array.isArray(value) ? value.map(sortJson)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]))
      : value;
}
