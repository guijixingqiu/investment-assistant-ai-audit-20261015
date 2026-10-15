import type {
  TodayActionInboxItem,
  TodayActionInboxPriority,
  TodayActionInboxSourceRef
} from "../../../../packages/contracts/src/todayActionInbox.js";
import type { TodayResearchItem } from "../../../../packages/contracts/src/todayResearch.js";
import type { DeepResearchTaskData } from "../../../../packages/contracts/src/deepResearchTask.js";
import { DEEP_RESEARCH_TASK_LEASE_MILLISECONDS } from "./deepResearchTaskRepository.js";

export function projectTodayResearchInboxItem(
  membership: { id: string; version: number; symbol: string },
  item: TodayResearchItem,
  generatedAt: string,
  latestTask: DeepResearchTaskData | null
): TodayActionInboxItem {
  const report = item.bindings.reportRef;
  const completedTask = latestTask && taskMatchesItem(latestTask, item) ? latestTask : null;
  const target = researchTarget(item, completedTask);
  const confirmed = item.trackingState === "confirmed";
  const rejected = item.trackingState === "rejected";
  if ((completedTask || confirmed) && report) {
    return {
      id: completedTask
        ? `inbox:event:research_completed:${membership.id}:task:${completedTask.id}`
        : `inbox:event:research_completed:${membership.id}:${item.id}`,
      order: 0,
      kind: "research_completed",
      priority: confirmed ? "medium" : "action",
      state: confirmed ? "resolved" : "new",
      symbol: membership.symbol,
      membership: { id: membership.id, version: membership.version, symbol: membership.symbol },
      source: reportSource(item, generatedAt),
      title: confirmed
        ? `${membership.symbol} 研究报告 v${report.version} 已处理`
        : `${membership.symbol} 研究任务完成，报告 v${report.version} 待确认`,
      summary: item.summary,
      versionChange: item.versionChange,
      researchTarget: target,
      reviewEvent: null
    };
  }
  if (rejected && report) {
    return {
      id: `inbox:event:research:${membership.id}:${item.id}`,
      order: 0,
      kind: "research",
      priority: "action",
      state: "new",
      symbol: membership.symbol,
      membership: { id: membership.id, version: membership.version, symbol: membership.symbol },
      source: reportSource(item, generatedAt, item.id),
      title: `${membership.symbol} 研究报告 v${report.version} 已驳回，需要继续修订研究`,
      summary: item.summary,
      versionChange: item.versionChange,
      researchTarget: target,
      reviewEvent: null
    };
  }
  if (item.trackingState === "needs_review" && item.category !== "user_action" && (item.bindings.eventRefs.length > 0 || item.bindings.factRefs.length > 0)) {
    const id = `inbox:event:material_change:${membership.id}:${materialSourceId(item)}:v${materialSourceVersion(item) ?? "unknown"}`;
    return {
      id,
      order: 0,
      kind: "material_change",
      priority: item.priority as TodayActionInboxPriority,
      state: "new",
      symbol: membership.symbol,
      membership: { id: membership.id, version: membership.version, symbol: membership.symbol },
      source: materialSource(item, generatedAt),
      title: item.title,
      summary: item.summary,
      versionChange: item.versionChange,
      researchTarget: target,
      reviewEvent: null
    };
  }
  return {
    id: `inbox:event:research:${membership.id}:${item.id}`,
    order: 0,
    kind: "research",
    priority: item.priority as TodayActionInboxPriority,
    state: "new",
    symbol: membership.symbol,
    membership: { id: membership.id, version: membership.version, symbol: membership.symbol },
    source: researchSource(item, generatedAt),
    title: item.title,
    summary: item.summary,
    versionChange: item.versionChange,
    researchTarget: target,
    reviewEvent: null
  };
}

export function projectTodayResearchTaskStateInboxItem(
  membership: { id: string; version: number; symbol: string },
  item: TodayResearchItem,
  generatedAt: string,
  task: DeepResearchTaskData | null
): TodayActionInboxItem | null {
  if (!task || ["succeeded", "canceled"].includes(task.status)
    || !taskStateMatchesItem(task, item)) return null;
  if (["pending", "running"].includes(task.status)) {
    const stalled = task.status === "running" && taskStateValidity(task, generatedAt).stale;
    return {
      id: `inbox:event:research:${membership.id}:${item.id}`,
      order: 0,
      kind: "research",
      priority: "high",
      state: stalled ? "new" : "later",
      symbol: membership.symbol,
      membership: { id: membership.id, version: membership.version, symbol: membership.symbol },
      source: taskStateSource(item, task, generatedAt, true),
      title: stalled
        ? `${membership.symbol} 深度研究可能停滞`
        : `${membership.symbol} 深度研究${task.status === "pending" ? "已排队" : "正在运行"}`,
      summary: stalled
        ? `任务 #${task.id} 超过任务租约仍未更新；请进入研究页先刷新同一任务，仍停滞时由你明确取消并重新准备，系统不会自动重放或重复发送。`
        : `任务 #${task.id} 仍在处理中；稍后刷新会读取同一任务，不会重复发起。`,
      versionChange: item.versionChange,
      researchTarget: researchTarget(item, task, false),
      reviewEvent: null
    };
  }
  if (task.status === "ready_to_absorb") {
    return {
      id: `inbox:event:research:${membership.id}:${item.id}`,
      order: 0,
      kind: "research",
      priority: "action",
      state: "new",
      symbol: membership.symbol,
      membership: { id: membership.id, version: membership.version, symbol: membership.symbol },
      source: taskStateSource(item, task, generatedAt, true),
      title: `${membership.symbol} 深度研究综合完成，待吸收为报告修订`,
      summary: `任务 #${task.id} 已绑定当前冻结证据；由你明确吸收后才会生成报告修订和确认入口。`,
      versionChange: item.versionChange,
      researchTarget: researchTarget(item, task, false),
      reviewEvent: null
    };
  }
  if (task.status === "failed") {
    return {
      id: `inbox:failure:research:${membership.id}`,
      order: 0,
      kind: "source_failure",
      priority: "high",
      state: "blocked",
      symbol: membership.symbol,
      membership: { id: membership.id, version: membership.version, symbol: membership.symbol },
      source: taskStateSource(item, task, generatedAt, false),
      title: `${membership.symbol} 研究任务失败`,
      summary: `任务 #${task.id} 未完成；请进入研究页重新核对后显式重试，系统不会自动重放。`,
      versionChange: item.versionChange,
      researchTarget: null,
      reviewEvent: null
    };
  }
  return null;
}

function researchTarget(
  item: TodayResearchItem,
  task: DeepResearchTaskData | null,
  includeReport = true
): TodayActionInboxItem["researchTarget"] {
  const report = includeReport ? item.bindings.reportRef : null;
  return {
    itemId: item.id,
    preferredLayer: item.category === "holding_logic_change" ? "portfolio" : "evidence",
    report: report ? { id: report.id, version: report.version, evidencePackId: report.evidencePackId } : null,
    task: task ? {
      id: task.id,
      requestFingerprint: task.requestFingerprint,
      evidencePackId: task.evidencePackId,
      evidencePackFingerprint: task.evidencePackFingerprint,
      completedAt: task.completedAt
    } : null
  };
}

function taskMatchesItem(task: DeepResearchTaskData, item: TodayResearchItem): boolean {
  const report = item.bindings.reportRef;
  const pack = item.bindings.evidencePackRef;
  const revision = item.reportRevision?.current;
  return task.status === "succeeded" && task.completedAt !== null
    && item.category === "user_action"
    && item.trackingState === "awaiting_user_confirmation"
    && item.id === `action:${task.membershipId}:v${task.membershipVersion}:awaiting_user_confirmation`
    && task.membershipId === item.bindings.membershipId
    && task.membershipVersion === item.bindings.membershipVersion
    && task.report !== null && report !== null && pack !== null && revision !== undefined
    && task.evidencePackId === pack.id && task.evidencePackFingerprint === pack.packFingerprint
    && task.report.id === report.id && task.report.version === report.version
    && task.report.evidencePackId === report.evidencePackId
    && task.report.reportFingerprint === revision.reportFingerprint;
}

function taskStateMatchesItem(task: DeepResearchTaskData, item: TodayResearchItem): boolean {
  const pack = item.bindings.evidencePackRef;
  return item.category === "user_action" && pack !== null
    && task.membershipId === item.bindings.membershipId
    && task.membershipVersion === item.bindings.membershipVersion
    && task.evidencePackId === pack.id
    && task.evidencePackFingerprint === pack.packFingerprint;
}

function taskStateSource(
  item: TodayResearchItem,
  task: DeepResearchTaskData,
  generatedAt: string,
  available: boolean
): TodayActionInboxSourceRef {
  const validity = taskStateValidity(task, generatedAt);
  return {
    lane: "research",
    id: available ? item.id : task.id,
    version: null,
    status: available ? "available" : "failed",
    sourceType: "deep_research_tasks",
    effectiveAt: task.startedAt ?? task.createdAt,
    asOf: task.updatedAt,
    fetchedAt: generatedAt,
    validUntil: available && !validity.stale ? validity.validUntil : null,
    freshness: available ? validity.stale ? "stale" : "fresh" : "unavailable",
    sourceFingerprint: task.requestFingerprint
  };
}

function taskStateValidity(task: DeepResearchTaskData, generatedAt: string): { stale: boolean; validUntil: string | null } {
  if (task.status !== "running") return { stale: false, validUntil: null };
  const requestedWindow = ((task.intent?.maxDurationSeconds ?? 60) + 60) * 1_000;
  const validUntil = new Date(Date.parse(task.updatedAt) + Math.max(requestedWindow, DEEP_RESEARCH_TASK_LEASE_MILLISECONDS)).toISOString();
  return { stale: Date.parse(generatedAt) > Date.parse(validUntil), validUntil };
}

function researchSource(item: TodayResearchItem, generatedAt: string): TodayActionInboxSourceRef {
  const fact = item.bindings.factRefs[0];
  const technical = item.bindings.monitorRef?.kind === "weinstein_structure" ? item.bindings.monitorRef : null;
  return {
    lane: "research", id: item.id, version: technical?.runVersion ?? item.bindings.reportRef?.version ?? item.bindings.evidencePackRef?.version ?? null,
    status: "available", sourceType: technical ? "weinstein_technical_snapshot" : fact?.sourceType ?? "today_research_projection",
    effectiveAt: fact?.publishedAt ?? null, asOf: fact?.capturedAt ?? null, fetchedAt: generatedAt,
    validUntil: fact?.validUntil ?? null, freshness: technical || fact ? "fresh" : "missing",
    sourceFingerprint: technical?.runFingerprint ?? fact?.contentFingerprint ?? null
  };
}

function reportSource(item: TodayResearchItem, generatedAt: string, sourceId?: string): TodayActionInboxSourceRef {
  const report = item.bindings.reportRef;
  const fingerprint = item.reportRevision?.current.reportFingerprint;
  return {
    lane: "research", id: sourceId ?? report?.id ?? item.id, version: report?.version ?? null, status: "available",
    sourceType: "deep_research_reports", effectiveAt: null, asOf: null, fetchedAt: generatedAt,
    validUntil: null, freshness: "fresh", sourceFingerprint: fingerprint && fingerprint !== "UNKNOWN" ? fingerprint : null
  };
}

function materialSourceId(item: TodayResearchItem): string {
  return item.bindings.eventRefs[0]?.eventId ?? item.bindings.factRefs[0]?.materialId ?? item.id;
}

function materialSourceVersion(item: TodayResearchItem): number | null {
  return item.bindings.eventRefs[0]?.eventVersion ?? item.bindings.factRefs[0]?.revision ?? null;
}

function materialSource(item: TodayResearchItem, generatedAt: string): TodayActionInboxSourceRef {
  const fact = item.bindings.factRefs[0];
  return {
    lane: "research_material", id: materialSourceId(item), version: materialSourceVersion(item), status: "available",
    sourceType: fact?.sourceType ?? "research_events", effectiveAt: fact?.publishedAt ?? null,
    asOf: fact?.capturedAt ?? null, fetchedAt: generatedAt, validUntil: fact?.validUntil ?? null,
    freshness: fact ? "fresh" : "missing", sourceFingerprint: fact?.contentFingerprint ?? null
  };
}
