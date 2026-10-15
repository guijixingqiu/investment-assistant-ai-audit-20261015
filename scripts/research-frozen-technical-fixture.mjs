import {
  DAILY_CONTENT_HASH_METHOD,
  dailySourceContentHash,
  sha256Canonical
} from "../dist/packages/contracts/src/marketDaily.js";
import { hkexCompletedSessionEvidenceVersion } from "../dist/packages/contracts/src/marketDailyCalendarEvidence.js";
import { getDailyTechnicalEnvelope } from "../dist/apps/api/src/market/dailyBarsService.js";
import { persistDailyTechnicalSnapshot } from "../dist/apps/api/src/market/dailyBarsRepository.js";

export async function persistResearchFrozenTechnicalFixture(
  pool,
  { market = "HK", code, cutoff, revision = 1 }
) {
  const lastCompletedSession = cutoff;
  const bars = fixtureBars(lastCompletedSession, revision);
  const completedSessions = bars.map((bar) => bar.session);
  const calendarVersion = hkexCompletedSessionEvidenceVersion(cutoff, completedSessions);
  const pageContentHashes = [sha256Canonical({
    fixtureOnly: true,
    revision,
    bars
  })];
  const fetchedAt = new Date(`${cutoff}T08:30:00.000Z`);
  const providerResult = {
    status: "available",
    provider: "repository",
    endpoint: "fixture_only_research_frozen_technical",
    fetchedAt,
    providerCutoff: cutoff,
    dataCutoffAt: `${lastCompletedSession}T16:10:00+08:00`,
    lastCompletedSession,
    calendar: {
      id: "HKEX",
      version: calendarVersion,
      timezone: "Asia/Hong_Kong"
    },
    expectedSessions: completedSessions,
    rights: "confirmed",
    retention: "confirmed",
    derivedUse: "confirmed",
    hashMethod: DAILY_CONTENT_HASH_METHOD,
    rawBytesCaptured: false,
    pageContentHashes,
    sourceContentHash: dailySourceContentHash(DAILY_CONTENT_HASH_METHOD, pageContentHashes),
    bars,
    gaps: [],
    message: "Fixture-only deterministic technical evidence; not real runtime evidence."
  };
  const evidence = {
    source: "independent_hkex_calendar",
    fixture: false,
    calendar: providerResult.calendar,
    cutoff,
    lastCompletedSession,
    marketCloseAt: `${lastCompletedSession}T16:10:00+08:00`,
    evaluatedAt: `${lastCompletedSession}T16:30:00+08:00`,
    completedThroughCutoff: true,
    completedSessions
  };
  const provider = {
    name: "repository",
    async getDailyBars() {
      return providerResult;
    }
  };
  const envelope = await getDailyTechnicalEnvelope(provider, market, code, cutoff, evidence);
  if (envelope.completeness !== "complete" || !envelope.usableForRequestedCutoff) {
    throw new Error(`fixture technical envelope is incomplete: ${envelope.dailyBars.message}`);
  }

  await persistDailyTechnicalSnapshot(pool, envelope);
  return envelope;
}

function fixtureBars(lastCompletedSession, revision) {
  const end = Date.parse(`${lastCompletedSession}T00:00:00.000Z`);
  const start = end - 119 * 86_400_000;
  return Array.from({ length: 120 }, (_, index) => {
    const session = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    const close = 80 + index * 0.15 + revision * 0.01 + Math.sin(index / 5);
    return {
      session,
      open: close - 0.2,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 10_000 + index * 10 + revision,
      turnover: (10_000 + index * 10 + revision) * close,
      suspension: false
    };
  });
}
