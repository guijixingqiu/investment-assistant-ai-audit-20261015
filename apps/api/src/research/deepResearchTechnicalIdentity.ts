import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import type { CurrentFrozenResearchEvidence } from "./deepResearchEventBinding.js";

type TechnicalEvidence = NonNullable<CurrentFrozenResearchEvidence["technical"]>;

export function dailyTechnicalSnapshotChanged(frozen: TechnicalEvidence, current: TechnicalEvidence): boolean {
  const frozenIdentity = stableDailyBarsIdentity(frozen);
  const currentIdentity = stableDailyBarsIdentity(current);
  return frozenIdentity !== null && currentIdentity !== null
    ? frozenIdentity !== currentIdentity
    : frozen.dailyBars.snapshot?.snapshotSha !== current.dailyBars.snapshot?.snapshotSha;
}

export function dailyTechnicalResultChanged(frozen: TechnicalEvidence, current: TechnicalEvidence): boolean {
  const frozenIdentity = stableTechnicalResultIdentity(frozen);
  const currentIdentity = stableTechnicalResultIdentity(current);
  return frozenIdentity !== null && currentIdentity !== null
    ? frozenIdentity !== currentIdentity
    : frozen.technical.resultHash !== current.technical.resultHash;
}

function stableDailyBarsIdentity(value: TechnicalEvidence): string | null {
  const snapshot = value.dailyBars.snapshot;
  if (!snapshot || !Array.isArray(snapshot.bars)) return null;
  const { fetchedAt: _sourceFetchedAt, ...source } = value.dailyBars.source;
  const { fetchedAt: _metadataFetchedAt, ...metadata } = value.dailyBars.metadata;
  const { snapshotSha: _snapshotSha, completedSessionEvidence, ...snapshotIdentity } = snapshot;
  return canonicalJson({
    ...value.dailyBars,
    source,
    metadata,
    snapshot: { ...snapshotIdentity, completedSessionEvidence: stableCompletedSessionEvidence(completedSessionEvidence) }
  });
}

function stableCompletedSessionEvidence(
  value: NonNullable<TechnicalEvidence["dailyBars"]["snapshot"]>["completedSessionEvidence"]
): Record<string, unknown> | null {
  if (!value) return null;
  const { evaluatedAt: _evaluatedAt, ...identity } = value;
  return identity;
}

function stableTechnicalResultIdentity(value: TechnicalEvidence): string | null {
  if (!Array.isArray(value.technical.points)) return null;
  const { inputSnapshotSha: _inputSnapshotSha, resultHash: _resultHash, ...identity } = value.technical;
  return canonicalJson(identity);
}
