import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import {
  DAILY_ADJUSTMENT,
  DAILY_CONTENT_HASH_METHOD,
  DAILY_MINIMUM_BARS,
  DAILY_TARGET_BARS,
  DAILY_TIMEFRAME,
  MARKET_DAILY_SCHEMA_VERSION,
  dailyBarsDataHash,
  dailyBarsSnapshotHash,
  validateDailyBarsEnvelope,
  validateDailyTechnicalEnvelope,
  type DailyBarsEnvelope,
  type DailyBarsRequestIdentity,
  type DailyTechnicalEnvelope,
  type HkexCompletedSessionEvidence
} from "../../../../packages/contracts/src/marketDaily.js";
import { hkexCompletedSessionEvidenceVersion } from "../../../../packages/contracts/src/marketDailyCalendarEvidence.js";
import type { DailyBarsProvider, DailyBarsProviderResult } from "./dailyBarsProvider.js";
import { calculateTechnicalAnalysis } from "./technicalIndicators.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";

export async function getDailyTechnicalEnvelope(
  provider: DailyBarsProvider,
  market: string,
  code: string,
  cutoff: string,
  completedSessionEvidence?: HkexCompletedSessionEvidence
): Promise<DailyTechnicalEnvelope> {
  const request = canonicalDailyRequest(market, code, cutoff);

  let dailyBars: DailyBarsEnvelope;
  let providerResult: DailyBarsProviderResult | undefined;
  try {
    providerResult = await provider.getDailyBars(request);
    dailyBars = buildDailyBarsEnvelope(request, providerResult, completedSessionEvidence);
  } catch (error) {
    dailyBars = unavailableDailyBars(request, `Daily bars provider failed closed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!validateDailyBarsEnvelope(dailyBars).ok) {
    dailyBars = unavailableDailyBars(request, "Daily bars provider output failed canonical contract validation.", providerResult);
  }
  const technical = calculateTechnicalAnalysis(dailyBars);
  const complete = dailyBars.status === "available" && technical.status === "available";
  const response = {
    completeness: complete ? "complete" as const : "incomplete" as const,
    usableForRequestedCutoff: complete,
    dailyBars,
    technical
  };
  if (!validateDailyTechnicalEnvelope(response).ok) {
    return unavailableDailyTechnicalEnvelope(market, code, cutoff, "Daily technical response failed canonical contract validation.");
  }
  return response;
}

export function unavailableDailyTechnicalEnvelope(
  market: string,
  code: string,
  cutoff: string,
  message: string
): DailyTechnicalEnvelope {
  const request = canonicalDailyRequest(market, code, cutoff);
  const dailyBars = unavailableDailyBars(request, message);
  return {
    completeness: "incomplete",
    usableForRequestedCutoff: false,
    dailyBars,
    technical: calculateTechnicalAnalysis(dailyBars)
  };
}

export function canonicalDailyRequest(
  market: string,
  code: string,
  cutoff: string
): DailyBarsRequestIdentity {
  if (market !== "HK" || !/^\d{5}$/.test(code)) {
    throw new TypeError("daily bars identity must be canonical HK.<five digits>");
  }
  if (!validCalendarDate(cutoff)) {
    throw new TypeError("daily bars cutoff must be a real YYYY-MM-DD calendar date");
  }
  return {
    market,
    code,
    symbol: `HK.${code}`,
    timeframe: DAILY_TIMEFRAME,
    completedSessionsOnly: true,
    adjustment: DAILY_ADJUSTMENT,
    minimumBars: DAILY_MINIMUM_BARS,
    targetBars: DAILY_TARGET_BARS,
    cutoff
  };
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function buildDailyBarsEnvelope(
  request: DailyBarsRequestIdentity,
  result: DailyBarsProviderResult,
  completedSessionEvidence?: HkexCompletedSessionEvidence
): DailyBarsEnvelope {
  if (!result.bars || !result.calendar || !result.expectedSessions || !result.lastCompletedSession
    || !result.providerCutoff || !result.dataCutoffAt) {
    return unavailableDailyBars(request, result.message, result);
  }
  const quality = {
    gaps: result.gaps,
    zeroVolumeSessions: result.bars.filter((bar) => bar.volume === 0).map((bar) => bar.session),
    suspensionSessions: result.bars.filter((bar) => bar.suspension).map((bar) => bar.session)
  };
  const verifiedCompletedSessionEvidence = verifiesIndependentCompletedSessions(
    request,
    result,
    completedSessionEvidence
  ) ? completedSessionEvidence : null;
  const source = {
    provider: result.provider,
    endpoint: result.endpoint,
    fetchedAt: result.fetchedAt.toISOString(),
    providerCutoff: result.providerCutoff,
    dataCutoffAt: result.dataCutoffAt,
    rights: result.rights,
    retention: result.retention,
    derivedUse: result.derivedUse,
    hashMethod: result.hashMethod,
    rawBytesCaptured: result.rawBytesCaptured,
    pageCount: result.pageContentHashes.length,
    pageContentHashes: result.pageContentHashes,
    sourceContentHash: result.sourceContentHash
  };
  const withoutSha = {
    dataHash: dailyBarsDataHash(result.bars),
    calendar: result.calendar,
    lastCompletedSession: result.lastCompletedSession,
    firstSession: result.bars[0]?.session ?? "",
    lastSession: result.bars.at(-1)?.session ?? "",
    barCount: result.bars.length,
    expectedSessions: result.expectedSessions,
    completedSessionEvidence: verifiedCompletedSessionEvidence,
    quality,
    bars: result.bars
  };
  const snapshot = { snapshotSha: dailyBarsSnapshotHash(request, source, withoutSha), ...withoutSha };
  const available = result.status === "available" && result.bars.length >= request.minimumBars
    && result.rights === "confirmed" && result.retention === "confirmed" && result.derivedUse === "confirmed"
    && result.gaps.length === 0
    && verifiedCompletedSessionEvidence !== null
    && result.provider !== "unavailable";
  const status = available ? "available" : "incomplete";
  return {
    schemaVersion: MARKET_DAILY_SCHEMA_VERSION,
    status,
    request,
    source,
    metadata: makeFactMetadata({
      source: `market_daily:${result.provider}:${result.endpoint ?? "disabled"}`,
      asOf: result.dataCutoffAt,
      fetchedAt: result.fetchedAt.toISOString(),
      freshness: status === "available" || result.provider === "fixture" ? "unknown" : "conflict",
      provenance: result.provider === "fixture" ? "fixture" : "real",
      authority: status === "available"
        ? result.provider === "fixture" ? "research_evidence" : "market_data"
        : "unavailable",
      stale: false,
      missing: false,
      conflict: status === "incomplete",
      fixture: result.provider === "fixture",
      correctionOf: null,
      replaces: null,
      message: `${result.message} Real-time freshness is UNKNOWN until the HK calendar is re-evaluated.`
    }),
    snapshot,
    message: available
      ? result.message
      : `UNKNOWN: ${result.message}${verifiedCompletedSessionEvidence ? "" : " Independent HKEX completed-session evidence is unavailable or invalid."}`
  };
}

function verifiesIndependentCompletedSessions(
  request: DailyBarsRequestIdentity,
  result: DailyBarsProviderResult,
  evidence: HkexCompletedSessionEvidence | undefined
): evidence is HkexCompletedSessionEvidence {
  if (!evidence || evidence.source !== "independent_hkex_calendar" || evidence.fixture !== false
    || evidence.calendar.id !== "HKEX" || evidence.calendar.timezone !== "Asia/Hong_Kong"
    || evidence.calendar.version !== hkexCompletedSessionEvidenceVersion(evidence.cutoff, evidence.completedSessions)
    || canonicalJson(evidence.calendar) !== canonicalJson(result.calendar)
    || evidence.cutoff !== request.cutoff
    || evidence.completedThroughCutoff !== true
    || evidence.lastCompletedSession > evidence.cutoff
    || evidence.lastCompletedSession !== result.lastCompletedSession
    || result.bars?.at(-1)?.session !== evidence.lastCompletedSession
    || evidence.completedSessions.at(-1) !== evidence.lastCompletedSession
    || canonicalJson(evidence.completedSessions) !== canonicalJson(result.expectedSessions)) {
    return false;
  }
  const closeAt = Date.parse(evidence.marketCloseAt);
  const dataCutoffAt = Date.parse(result.dataCutoffAt ?? "");
  const evaluatedAt = Date.parse(evidence.evaluatedAt);
  return Number.isFinite(closeAt) && Number.isFinite(dataCutoffAt) && Number.isFinite(evaluatedAt)
    && evidence.marketCloseAt === `${evidence.lastCompletedSession}T16:10:00+08:00`
    && closeAt <= dataCutoffAt
    && closeAt <= evaluatedAt
    && dataCutoffAt <= result.fetchedAt.getTime()
    && evaluatedAt <= result.fetchedAt.getTime();
}

export function unavailableDailyBars(
  request: DailyBarsRequestIdentity,
  message: string,
  result?: DailyBarsProviderResult
): DailyBarsEnvelope {
  return {
    schemaVersion: MARKET_DAILY_SCHEMA_VERSION,
    status: "unavailable",
    request,
    source: {
      provider: result?.provider ?? "unavailable",
      endpoint: result?.endpoint ?? null,
      fetchedAt: null,
      providerCutoff: null,
      dataCutoffAt: null,
      rights: result?.rights ?? "unknown",
      retention: result?.retention ?? "unknown",
      derivedUse: result?.derivedUse ?? "unknown",
      hashMethod: result?.hashMethod ?? DAILY_CONTENT_HASH_METHOD,
      rawBytesCaptured: false,
      pageCount: result?.pageContentHashes.length ?? 0,
      pageContentHashes: result?.pageContentHashes ?? [],
      sourceContentHash: result?.sourceContentHash ?? null
    },
    metadata: makeFactMetadata({
      source: `market_daily:${result?.provider ?? "unavailable"}`,
      asOf: null, fetchedAt: null, freshness: "unavailable", provenance: "unavailable", authority: "unavailable",
      stale: false, missing: false, conflict: false, fixture: false, correctionOf: null, replaces: null, message
    }),
    snapshot: null,
    message: `UNKNOWN: ${message}`
  };
}
