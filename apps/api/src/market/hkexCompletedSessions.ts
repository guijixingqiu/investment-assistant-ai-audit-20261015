import {
  hkexCompletedSessionEvidenceVersion,
  type HkexCompletedSessionEvidence
} from "../../../../packages/contracts/src/marketDailyCalendarEvidence.js";

export const HKEX_2026_SECURITIES_HOLIDAY_SOURCE = {
  url: "https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2025/ce_SEHK_CT_075_2025.pdf",
  sha256: "783afe4db4e8e410bfd016cc2e212287691377b5d0680a8bc83d6e30bc469819"
} as const;
export const HKEX_2024_SECURITIES_HOLIDAY_SOURCE =
  "https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2023/ce_SEHK_CT_079_2023.pdf";
export const HKEX_2024_SEVERE_WEATHER_CLOSURE_SOURCE =
  "https://www.hkex.com.hk/News/Market-Communications/2024/2409062news?sc_lang=en";
export const HKEX_2025_SECURITIES_HOLIDAY_SOURCE =
  "https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2024/ce_SEHK_CT_063_2024.pdf";
export const HKEX_SECURITIES_TRADING_HOURS_SOURCE =
  "https://www.hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours/Securities-Market?sc_lang=en";

const HKEX_2024_SECURITIES_HOLIDAYS = new Set([
  "2024-01-01", "2024-02-12", "2024-02-13", "2024-03-29", "2024-04-01", "2024-04-04",
  "2024-05-01", "2024-05-15", "2024-06-10", "2024-07-01", "2024-09-18", "2024-10-01",
  "2024-10-11", "2024-12-25", "2024-12-26"
]);
// HKEX cancelled every securities session on 2024-09-06 after the annual holiday notice.
const HKEX_2024_EXTRAORDINARY_CLOSURES = new Set(["2024-09-06"]);
const HKEX_2025_SECURITIES_HOLIDAYS = new Set([
  "2025-01-01", "2025-01-29", "2025-01-30", "2025-01-31", "2025-04-04", "2025-04-18",
  "2025-04-21", "2025-05-01", "2025-05-05", "2025-07-01", "2025-10-01", "2025-10-07",
  "2025-10-29", "2025-12-25", "2025-12-26"
]);
const HKEX_2026_SECURITIES_HOLIDAYS = new Set([
  "2026-01-01",
  "2026-02-17", "2026-02-18", "2026-02-19",
  "2026-04-03", "2026-04-06", "2026-04-07",
  "2026-05-01", "2026-05-25",
  "2026-06-19",
  "2026-07-01",
  "2026-10-01", "2026-10-19",
  "2026-12-25"
]);
const HKEX_HALF_DAYS = new Set([
  "2024-02-09", "2024-12-24", "2024-12-31",
  "2025-01-28", "2025-12-24", "2025-12-31",
  "2026-02-16", "2026-12-24", "2026-12-31"
]);
const HOLIDAYS_BY_YEAR: Record<string, Set<string>> = {
  "2024": HKEX_2024_SECURITIES_HOLIDAYS,
  "2025": HKEX_2025_SECURITIES_HOLIDAYS,
  "2026": HKEX_2026_SECURITIES_HOLIDAYS
};

export function dailyHistoryStart(cutoff: string): string {
  if (!realDate(cutoff) || cutoff < "2024-01-01" || cutoff > "2026-12-31") {
    throw new TypeError("HKEX dated daily history supports real 2024-2026 cutoffs");
  }
  // Request at least one rolling calendar year. The provider and completed-session
  // evidence still report the actual available rows and any missing sessions.
  const lookback = new Date(Date.parse(`${cutoff}T00:00:00.000Z`) - 366 * 86_400_000)
    .toISOString().slice(0, 10);
  return lookback < "2024-01-01" ? "2024-01-01" : lookback;
}

// Preserve the original 2026-only entrypoint for existing callers.
export function hkex2026CompletedSessionEvidence(
  cutoff: string,
  evaluatedAt: Date = new Date()
): HkexCompletedSessionEvidence {
  if (!/^2026-\d{2}-\d{2}$/.test(cutoff) || !realDate(cutoff)) {
    throw new TypeError("HKEX local Alpha calendar supports only real 2026 cutoffs");
  }
  return hkexCompletedSessionEvidence(cutoff, evaluatedAt, "2026-01-01");
}

export function hkexCompletedSessionEvidence(
  cutoff: string,
  evaluatedAt: Date = new Date(),
  start: string = `${cutoff.slice(0, 4)}-01-01`
): HkexCompletedSessionEvidence {
  if (!realDate(cutoff) || !realDate(start) || start < "2024-01-01"
    || cutoff > "2026-12-31" || start > cutoff) {
    throw new TypeError("HKEX calendar requires an ordered real 2024-2026 range");
  }
  if (!Number.isFinite(evaluatedAt.getTime())) throw new TypeError("evaluatedAt must be a valid instant");
  const evaluatedHongKongDate = new Date(evaluatedAt.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  if (cutoff > evaluatedHongKongDate) throw new TypeError("HKEX cutoff cannot be in the future");

  const completedSessions: string[] = [];
  for (let instant = Date.parse(`${start}T00:00:00.000Z`);; instant += 86_400_000) {
    const session = new Date(instant).toISOString().slice(0, 10);
    if (session > cutoff) break;
    const weekday = new Date(instant).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !HOLIDAYS_BY_YEAR[session.slice(0, 4)]?.has(session)
      && !HKEX_2024_EXTRAORDINARY_CLOSURES.has(session)
      && Date.parse(`${session}T16:10:00+08:00`) <= evaluatedAt.getTime()) {
      completedSessions.push(session);
    }
  }
  const lastCompletedSession = completedSessions.at(-1);
  if (!lastCompletedSession) throw new Error("no completed HKEX securities session exists for the cutoff");
  if (HKEX_HALF_DAYS.has(lastCompletedSession)) {
    throw new Error("half-day HKEX close evidence is not supported by the current daily contract");
  }

  return {
    source: "independent_hkex_calendar",
    fixture: false,
    calendar: {
      id: "HKEX",
      version: hkexCompletedSessionEvidenceVersion(cutoff, completedSessions),
      timezone: "Asia/Hong_Kong"
    },
    cutoff,
    lastCompletedSession,
    marketCloseAt: `${lastCompletedSession}T16:10:00+08:00`,
    evaluatedAt: evaluatedAt.toISOString(),
    completedThroughCutoff: true,
    completedSessions
  };
}

function realDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
