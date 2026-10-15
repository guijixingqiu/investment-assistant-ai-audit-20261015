const HONG_KONG_UTC_OFFSET_MS = 8 * 60 * 60 * 1_000;

export function validatePortfolioDecisionFreshnessForBrowser(value: unknown, sourceAsOf: unknown, errors: string[]): void {
  if (value === null) return;
  if (!isRecord(value)) { errors.push("freshness must be an object or null"); return; }
  if (!["current", "stale"].includes(String(value.state))) errors.push("freshness.state is invalid");
  if (!["trading_session", "off_session"].includes(String(value.mode))) errors.push("freshness.mode is invalid");
  if (!["within_policy", "trading_age_exceeded", "before_latest_session_close", "source_timestamp_in_future"].includes(String(value.reason))) errors.push("freshness.reason is invalid");
  if (value.state === "current" && value.reason !== "within_policy") errors.push("current freshness must be within policy");
  if (value.state === "stale" && value.reason === "within_policy") errors.push("stale freshness must include a failure reason");
  if (!validDate(value.evaluatedAt) || !validDate(value.latestSessionClose) || !finiteNonNegative(value.ageSeconds)) errors.push("freshness timestamps and age are invalid");
  const maxAge = typeof value.tradingMaxAgeSeconds === "number" ? value.tradingMaxAgeSeconds : null;
  if (maxAge === null || !Number.isInteger(maxAge) || maxAge <= 0) errors.push("freshness.tradingMaxAgeSeconds is invalid");
  if (validDate(sourceAsOf) && validDate(value.evaluatedAt) && maxAge !== null && Number.isInteger(maxAge) && maxAge > 0) {
    const expected = evaluate(new Date(sourceAsOf), new Date(value.evaluatedAt), maxAge);
    for (const field of ["state", "mode", "reason", "evaluatedAt", "ageSeconds", "tradingMaxAgeSeconds", "latestSessionClose"] as const) {
      if (value[field] !== expected[field]) errors.push(`freshness.${field} does not recompute from sourceAsOf and evaluatedAt`);
    }
  }
}

function evaluate(sourceAsOf: Date, now: Date, tradingMaxAgeSeconds: number) {
  const local = hongKongParts(now);
  const minute = local.hour * 60 + local.minute;
  const weekday = local.day >= 1 && local.day <= 5;
  const mode = weekday && ((minute >= 570 && minute < 720) || (minute >= 780 && minute < 960)) ? "trading_session" : "off_session";
  const latestSessionClose = latestSessionCloseAt(now);
  const rawAgeSeconds = Math.floor((now.getTime() - sourceAsOf.getTime()) / 1_000);
  const ageSeconds = Math.max(0, rawAgeSeconds);
  let state = "current";
  let reason = "within_policy";
  if (rawAgeSeconds < 0) {
    state = "stale";
    reason = "source_timestamp_in_future";
  } else if (weekday && minute >= 570 && minute < 960 && ageSeconds > tradingMaxAgeSeconds) {
    state = "stale";
    reason = "trading_age_exceeded";
  } else if (mode === "off_session" && sourceAsOf < latestSessionClose) {
    state = "stale";
    reason = "before_latest_session_close";
  }
  return { state, mode, reason, evaluatedAt: now.toISOString(), ageSeconds, tradingMaxAgeSeconds, latestSessionClose: latestSessionClose.toISOString() };
}

function latestSessionCloseAt(now: Date): Date {
  const local = hongKongParts(now);
  const cursor = new Date(Date.UTC(local.year, local.month, local.date, 8));
  if (!(local.day >= 1 && local.day <= 5 && local.hour * 60 + local.minute >= 960)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while ([0, 6].includes(hongKongParts(cursor).day)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  return cursor;
}

function hongKongParts(value: Date) {
  const shifted = new Date(value.getTime() + HONG_KONG_UTC_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), date: shifted.getUTCDate(), day: shifted.getUTCDay(), hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() };
}

function validDate(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)); }
function finiteNonNegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
