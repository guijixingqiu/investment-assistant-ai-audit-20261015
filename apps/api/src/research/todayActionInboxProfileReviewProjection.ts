import type { CandidateMembershipData } from "../../../../packages/contracts/src/candidateMembership.js";
import type { TodayActionInboxItem } from "../../../../packages/contracts/src/todayActionInbox.js";
import { currentHongKongDate } from "../market/dailyBarsRepository.js";

export function projectTodayResearchProfileReviewDue(
  membership: CandidateMembershipData,
  generatedAt: string
): TodayActionInboxItem | null {
  const nextReviewOn = membership.research?.nextReviewOn;
  if (membership.research?.status !== "available" || !validDate(nextReviewOn)
    || nextReviewOn > currentHongKongDate(new Date(generatedAt))) return null;
  const effectiveAt = `${nextReviewOn}T00:00:00+08:00`;
  return {
    id: `inbox:event:research_profile_review_due:${membership.id}:v${membership.version}:${nextReviewOn}`,
    order: 0,
    kind: "research_profile_review_due",
    priority: "high",
    state: "new",
    symbol: membership.symbol,
    membership: { id: membership.id, version: membership.version, symbol: membership.symbol },
    source: {
      lane: "candidate_membership", id: membership.id, version: membership.version,
      status: "available", sourceType: "research_profiles", effectiveAt, asOf: generatedAt,
      fetchedAt: generatedAt, validUntil: null, freshness: "fresh", sourceFingerprint: null
    },
    title: `${membership.symbol} 研究档案已到复核日`,
    summary: `计划复核日为 ${nextReviewOn}；请重新核对论点、关键变量、风险、反证和下一次复核日期。`,
    versionChange: null,
    researchTarget: null,
    reviewEvent: null
  };
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
