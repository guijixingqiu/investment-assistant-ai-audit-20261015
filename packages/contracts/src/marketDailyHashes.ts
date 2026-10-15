import { canonicalJson } from "./decisionContextBrowser.js";
import { sha256Hex } from "./sha256.js";
import type {
  DailyBar,
  DailyBarsRequestIdentity,
  DailyBarsSnapshot,
  DailyBarsSource,
  TechnicalAnalysisEnvelope
} from "./marketDaily.js";
import type { HkexCompletedSessionEvidence } from "./marketDailyCalendarEvidence.js";

export function sha256Canonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function dailyBarsDataHash(bars: DailyBar[]): string {
  return sha256Canonical(bars);
}

export function dailyBarsSnapshotHash(
  request: DailyBarsRequestIdentity,
  source: DailyBarsSource,
  snapshot: Omit<DailyBarsSnapshot, "snapshotSha">
): string {
  const { fetchedAt: _fetchedAt, ...sourceIdentity } = source;
  const { completedSessionEvidence, ...snapshotIdentity } = snapshot;
  return sha256Canonical({
    request,
    source: sourceIdentity,
    snapshot: {
      ...snapshotIdentity,
      completedSessionEvidence: stableCompletedSessionEvidence(completedSessionEvidence)
    }
  });
}

export function technicalResultHash(
  value: Pick<TechnicalAnalysisEnvelope, "computationVersion" | "parameters" | "inputSnapshotSha" | "dataCutoffAt" | "points">
): string {
  return sha256Canonical({
    computationVersion: value.computationVersion,
    parameters: value.parameters,
    inputSnapshotSha: value.inputSnapshotSha,
    dataCutoffAt: value.dataCutoffAt,
    points: value.points
  });
}

export function legacyDailyBarsSnapshotHash(
  request: DailyBarsRequestIdentity,
  source: DailyBarsSource,
  snapshot: Omit<DailyBarsSnapshot, "snapshotSha">
): string {
  return sha256Canonical({ request, source, snapshot });
}

function stableCompletedSessionEvidence(
  value: HkexCompletedSessionEvidence | null
): Omit<HkexCompletedSessionEvidence, "evaluatedAt"> | null {
  if (!value) return null;
  const { evaluatedAt: _evaluatedAt, ...identity } = value;
  return identity;
}
