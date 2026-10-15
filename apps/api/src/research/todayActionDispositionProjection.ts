import type {
  TodayActionInboxItem,
  TodayMaterialChangeDispositionData
} from "../../../../packages/contracts/src/todayActionInbox.js";
import { requestFingerprint } from "./deepResearchGate.js";

export function projectTodayActionDisposition(
  item: TodayActionInboxItem,
  dispositions: Map<string, TodayMaterialChangeDispositionData>,
  generatedAt: string
): TodayActionInboxItem {
  const current = item.kind !== "source_failure" && item.source.sourceFingerprint === null
    ? { ...item, source: { ...item.source, sourceFingerprint: stableSourceFingerprint(item) } }
    : item;
  const disposition = dispositions.get(current.id);
  const matches = dispositionMatches(current, disposition);
  const dispositionState = matches
    ? disposition.state === "later" && disposition.snoozedUntil !== null
      && Date.parse(disposition.snoozedUntil) <= Date.parse(generatedAt) ? "new" : disposition.state
    : current.state;
  const expired = ["new", "later"].includes(dispositionState)
    && current.source.validUntil !== null
    && Date.parse(current.source.validUntil) <= Date.parse(generatedAt);
  const state = expired ? "expired" : dispositionState;
  return {
    ...current,
    source: expired ? { ...current.source, freshness: "stale" } : current.source,
    state,
    summary: expired
      ? `来源有效期已于 ${current.source.validUntil} 结束；新版本来源会自动重新进入 Today。原始事项：${current.summary}`.slice(0, 4000)
      : !matches || state === "new" ? current.summary
        : `${disposition.stateReason} 原始事项：${current.summary}`.slice(0, 4000)
  };
}

function stableSourceFingerprint(item: TodayActionInboxItem): string {
  return requestFingerprint("today_action_source", {
    itemId: item.id,
    kind: item.kind,
    underlyingState: item.state,
    membership: item.membership,
    source: {
      lane: item.source.lane,
      id: item.source.id,
      version: item.source.version,
      sourceType: item.source.sourceType,
      effectiveAt: item.source.effectiveAt,
      validUntil: item.source.validUntil
    },
    researchTarget: item.researchTarget,
    reviewEvent: item.reviewEvent === null ? null : {
      id: item.reviewEvent.id,
      type: item.reviewEvent.type,
      state: item.reviewEvent.state,
      sourceEventId: item.reviewEvent.sourceEventId,
      stateChangedAt: item.reviewEvent.stateChangedAt
    }
  });
}

function dispositionMatches(
  item: TodayActionInboxItem,
  disposition: TodayMaterialChangeDispositionData | undefined
): disposition is TodayMaterialChangeDispositionData {
  return disposition !== undefined
    && disposition.membershipId === item.membership.id
    && disposition.membershipVersion === item.membership.version
    && disposition.symbol === item.symbol
    && disposition.sourceId === item.source.id
    && disposition.sourceVersion === item.source.version
    && disposition.sourceFingerprint === item.source.sourceFingerprint;
}
