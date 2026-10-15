// Shared, immutable Hong Kong cash-equity fee policy data and the runtime fee
// calculator. The immutable policy DATA (rates, effective ranges, rounding
// rules) is the single source of truth. Independent witnesses/verifiers must
// reimplement the arithmetic themselves and may import only this DATA, never
// the calculator functions below.
import { createHash } from "node:crypto";

export const FEE_POLICY_VERSION = "hk-cash-equity-fees.2026-09-13.v2";
export const FEE_POLICY_SUPPORTED_FROM = "2020-01-01";
export const FEE_POLICY_PRODUCT_SCOPE = "stamp_liable_ordinary_hk_cash_equity";

export const FEE_POLICY_SOURCES = Object.freeze([
  "https://www.hkex.com.hk/Services/Rules-and-Forms-and-Fees/Fees/Securities-(Hong-Kong)/Trading/Transaction?sc_lang=en",
  "https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/HKSCC/2025/cc_HKSCC_SET_022_2025.pdf",
  "https://www.gov.hk/en/residents/taxes/stamp/stamp_duty_rates.htm"
]);

// Rates are exact integer rationals (num/den) so cent and whole-HKD rounding
// never relies on floating point or EPSILON comparisons.
const R = (num, den) => Object.freeze({ num, den });
const ZERO = R(0, 1);

// Immutable effective-range segments. Boundaries:
//  stamp duty 0.1% -> 0.13% at 2021-08-01 -> 0.1% at 2023-11-17 (both sides)
//  trading fee 0.005% + HK$0.50 tariff -> 0.00565% no tariff at 2023-01-01
//  AFRC 0 -> 0.00015% at 2022-01-01
//  settlement 0.002% (min 2 / max 100) -> 0.0042% (no min/max) at 2025-06-30
export const HK_FEE_POLICY_SEGMENTS = Object.freeze([
  Object.freeze({
    effectiveFrom: "2020-01-01", effectiveTo: "2021-07-31",
    stampDuty: R(1, 1000), tradingFee: R(5, 100000), tradingTariffHkd: 0.5,
    transactionLevy: R(27, 1000000), afrc: ZERO,
    settlement: R(2, 100000), settlementMinHkd: 2, settlementMaxHkd: 100
  }),
  Object.freeze({
    effectiveFrom: "2021-08-01", effectiveTo: "2021-12-31",
    stampDuty: R(13, 10000), tradingFee: R(5, 100000), tradingTariffHkd: 0.5,
    transactionLevy: R(27, 1000000), afrc: ZERO,
    settlement: R(2, 100000), settlementMinHkd: 2, settlementMaxHkd: 100
  }),
  Object.freeze({
    effectiveFrom: "2022-01-01", effectiveTo: "2022-12-31",
    stampDuty: R(13, 10000), tradingFee: R(5, 100000), tradingTariffHkd: 0.5,
    transactionLevy: R(27, 1000000), afrc: R(15, 10000000),
    settlement: R(2, 100000), settlementMinHkd: 2, settlementMaxHkd: 100
  }),
  Object.freeze({
    effectiveFrom: "2023-01-01", effectiveTo: "2023-11-16",
    stampDuty: R(13, 10000), tradingFee: R(565, 10000000), tradingTariffHkd: 0,
    transactionLevy: R(27, 1000000), afrc: R(15, 10000000),
    settlement: R(2, 100000), settlementMinHkd: 2, settlementMaxHkd: 100
  }),
  Object.freeze({
    effectiveFrom: "2023-11-17", effectiveTo: "2025-06-29",
    stampDuty: R(1, 1000), tradingFee: R(565, 10000000), tradingTariffHkd: 0,
    transactionLevy: R(27, 1000000), afrc: R(15, 10000000),
    settlement: R(2, 100000), settlementMinHkd: 2, settlementMaxHkd: 100
  }),
  Object.freeze({
    effectiveFrom: "2025-06-30", effectiveTo: null,
    stampDuty: R(1, 1000), tradingFee: R(565, 10000000), tradingTariffHkd: 0,
    transactionLevy: R(27, 1000000), afrc: R(15, 10000000),
    settlement: R(42, 1000000), settlementMinHkd: null, settlementMaxHkd: null
  })
]);

export const HK_FEE_POLICY = Object.freeze({
  version: FEE_POLICY_VERSION,
  market: "HK",
  currency: "HKD",
  productScope: FEE_POLICY_PRODUCT_SCOPE,
  supportedFrom: FEE_POLICY_SUPPORTED_FROM,
  rounding: Object.freeze({ perFee: "nearest_cent", stampDuty: "ceil_whole_hkd" }),
  stampDutySides: "both",
  assumptions: Object.freeze([
    "Broker passes through the HKSCC settlement charge at 100%; this is an explicit modelling assumption, not a legal rate guarantee.",
    "The HK$0.50 trading tariff is applied per simulated order while legally applicable; policy granularity may differ from actual per-order billing.",
    "Broker commission, minimum commission and platform fee remain configurable scenario inputs, not legal exchange rates.",
    "Scope is ordinary stamp-liable HKD Hong Kong cash equities only (no ETF, derivative or foreign-tax assumption)."
  ]),
  sources: FEE_POLICY_SOURCES,
  segments: HK_FEE_POLICY_SEGMENTS
});

export const HK_FEE_POLICY_CANONICAL_JSON = JSON.stringify(HK_FEE_POLICY);

export function feePolicySha256() {
  return createHash("sha256").update(HK_FEE_POLICY_CANONICAL_JSON).digest("hex");
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar round-trip so impossible dates such as 2026-02-31 are rejected. */
export function isCalendarDate(value) {
  const text = String(value ?? "");
  if (!DATE_PATTERN.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function assertSupportedTradeDate(tradeDate, now = new Date()) {
  const value = String(tradeDate ?? "");
  if (!isCalendarDate(value)) {
    throw new Error(`fee_policy_unsupported_trade_date:${value || "missing"}`);
  }
  if (value < FEE_POLICY_SUPPORTED_FROM || value > todayIso(now)) {
    throw new Error(`fee_policy_unsupported_trade_date:${value}`);
  }
  return value;
}

export function assertSupportedProduct(product) {
  if (product !== undefined && product !== null && product !== FEE_POLICY_PRODUCT_SCOPE) {
    throw new Error(`fee_policy_unsupported_product:${product}`);
  }
}

export function hkFeePolicyForDate(tradeDate, now = new Date()) {
  const date = assertSupportedTradeDate(tradeDate, now);
  const segment = HK_FEE_POLICY_SEGMENTS.find((item) =>
    date >= item.effectiveFrom && (item.effectiveTo === null || date <= item.effectiveTo));
  if (!segment) throw new Error(`fee_policy_missing_segment:${date}`);
  return segment;
}

function ratFromDecimal(value) {
  const text = String(Number(value));
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`fee_policy_invalid_rate:${value}`);
  const [whole, fraction = ""] = text.split(".");
  const den = 10 ** fraction.length;
  return { num: Number(whole) * den + Number(fraction || "0"), den };
}

const centsOf = (rational, grossCents) => Math.round((grossCents * rational.num) / rational.den);
const hkdFromCents = (cents) => Math.round(cents) / 100;

// Runtime fee calculator. Uses exact integer-cent arithmetic and ceil-to-whole
// HKD for stamp duty. Stamp duty and settlement apply to BOTH sides.
export function computeHkCashEquityFees({ side, tradeDate, grossAmount, commissionRate = 0, minCommission = 0, platformFee = 0, product = undefined }) {
  assertSupportedProduct(product);
  if (side !== "buy" && side !== "sell") {
    throw new Error(`fee_policy_invalid_side:${side ?? "missing"}`);
  }
  const grossValue = Number(grossAmount);
  if (!Number.isFinite(grossValue) || grossValue < 0) {
    throw new Error(`fee_policy_invalid_gross_amount:${grossAmount ?? "missing"}`);
  }
  const segment = hkFeePolicyForDate(tradeDate);
  const grossCents = Math.round(grossValue * 100);

  const stampCents = segment.stampDuty.num === 0
    ? 0
    : Math.ceil((grossCents * segment.stampDuty.num) / (segment.stampDuty.den * 100)) * 100;
  const settlementRaw = centsOf(segment.settlement, grossCents);
  const settlementCents = Math.min(
    segment.settlementMaxHkd == null ? settlementRaw : segment.settlementMaxHkd * 100,
    Math.max(segment.settlementMinHkd == null ? settlementRaw : segment.settlementMinHkd * 100, settlementRaw)
  );
  const commissionCents = Math.max(
    Math.round(Number(minCommission) * 100),
    centsOf(ratFromDecimal(commissionRate), grossCents)
  );
  const breakdownCents = {
    commission: commissionCents,
    platformFee: Math.round(Number(platformFee) * 100),
    stampDuty: stampCents,
    tradingFee: centsOf(segment.tradingFee, grossCents),
    tradingTariff: Math.round(segment.tradingTariffHkd * 100),
    transactionLevy: centsOf(segment.transactionLevy, grossCents),
    afrc: centsOf(segment.afrc, grossCents),
    settlementFee: settlementCents
  };
  const totalCents = Object.values(breakdownCents).reduce((sum, value) => sum + value, 0);
  return {
    feePolicyVersion: FEE_POLICY_VERSION,
    feePolicySha256: feePolicySha256(),
    fees: Object.fromEntries(Object.entries(breakdownCents).map(([key, value]) => [key, hkdFromCents(value)])),
    totalFees: hkdFromCents(totalCents)
  };
}
