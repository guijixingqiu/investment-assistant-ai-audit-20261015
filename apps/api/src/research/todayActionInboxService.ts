import { readTodayOperatingUpdate } from "./todayOperatingUpdate.js";
import {readResearchReview} from "./researchReviewRepository.js";
import type { Pool } from "pg";
import {
  TODAY_ACTION_INBOX_SCHEMA_VERSION,
  TODAY_ACTION_INBOX_SOURCE,
  todayActionInboxSafety,
  type TodayActionInboxEnvelope,
  type TodayActionInboxItem,
  type TodayActionInboxItemKind,
  type TodayActionInboxSourceLane,
  type TodayMaterialChangeDispositionData
} from "../../../../packages/contracts/src/todayActionInbox.js";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import {
  validateTodayResearchEnvelope,
  type TodayResearchEnvelope
} from "../../../../packages/contracts/src/todayResearch.js";
import {
  validateTodayReviewDueEnvelope,
  type TodayActionEvent,
  type TodayReviewDueEnvelope
} from "../../../../packages/contracts/src/todayReviewDue.js";
import { readCandidateMembershipEnvelope } from "./candidateMembershipReadRepository.js";
import { readTodayReviewDue } from "./todayReviewDueRepository.js";
import { readTodayResearchEnvelope } from "./todayResearchService.js";
import { rowToTask, taskSelect } from "./deepResearchTaskRepository.js";
import {
  projectTodayResearchInboxItem,
  projectTodayResearchTaskStateInboxItem
} from "./todayActionInboxResearchProjection.js";
import type { DeepResearchTaskData } from "../../../../packages/contracts/src/deepResearchTask.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { readTodayMaterialChangeDispositions } from "./todayMaterialChangeDispositionRepository.js";
import { projectTodayResearchProfileReviewDue } from "./todayActionInboxProfileReviewProjection.js";
import { projectTodayActionDisposition } from "./todayActionDispositionProjection.js";
import { readTodayMarketAnomalyScreening, type MarketAnomalyOptions } from "./personalMarketAnomaly.js";
import type { SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";

const MAX_TRACKED_MEMBERSHIPS = 25;
const MAX_REPORTED_MEMBERSHIPS = 100;
const MAX_ITEMS = 100;
const CANDIDATE_FOUND_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

interface DeepResearchTaskPackBinding {
  membershipId: string;
  membershipVersion: number;
  evidencePackId: string;
  evidencePackFingerprint: string;
}

interface DeepResearchTaskReportBinding extends DeepResearchTaskPackBinding {
  reportId: string;
  reportVersion: number;
  reportFingerprint: string;
}

type ReadMembershipEnvelope = typeof readCandidateMembershipEnvelope;
type ReadResearchEnvelope = typeof readTodayResearchEnvelope;
type ReadReviewEnvelope = typeof readTodayReviewDue;
type ReadSucceededDeepResearchTask = typeof readSucceededDeepResearchTask;
type ReadLatestDeepResearchTaskState = typeof readLatestDeepResearchTaskState;
type ReadMaterialDispositions = typeof readTodayMaterialChangeDispositions;

export interface TodayActionInboxDependencies {
  readOperatingUpdate?: typeof readTodayOperatingUpdate;
  readResearchReview?: typeof readResearchReview;
  readMembership: ReadMembershipEnvelope;
  readResearch: ReadResearchEnvelope;
  readReview: ReadReviewEnvelope;
  readCompletedTask?: ReadSucceededDeepResearchTask;
  readTaskState?: ReadLatestDeepResearchTaskState;
  readDispositions?: ReadMaterialDispositions;
  readAnomaly?: typeof readTodayMarketAnomalyScreening;
}

const defaultDependencies: TodayActionInboxDependencies = {
  readOperatingUpdate: readTodayOperatingUpdate,
  readResearchReview,
  readMembership: readCandidateMembershipEnvelope,
  readResearch: readTodayResearchEnvelope,
  readReview: readTodayReviewDue,
  readCompletedTask: readSucceededDeepResearchTask,
  readTaskState: readLatestDeepResearchTaskState,
  readDispositions: readTodayMaterialChangeDispositions,
  readAnomaly: readTodayMarketAnomalyScreening
};

export interface TodayActionInboxReadOptions {
  quoteLiveMaxAgeSeconds: number;
  accountScopeId: string | null;
  currentPortfolioEnabled: boolean;
  currentPortfolioMaxAgeSeconds: number;
  anomalyOptions?: MarketAnomalyOptions;
  sourceStore?: SourceSnapshotStoreOptions;
}

export async function readTodayActionInbox(
  pool: Pool,
  actor: AuthenticatedResearchActor,
  options: TodayActionInboxReadOptions,
  now = new Date(),
  dependencies: TodayActionInboxDependencies = defaultDependencies
): Promise<TodayActionInboxEnvelope> {
  const membershipEnvelope = await dependencies.readMembership(
    pool,
    actor,
    false,
    options.quoteLiveMaxAgeSeconds,
    now
  );
  if (membershipEnvelope.status === "unavailable") {
    return failClosed(now, actor.actorId, "unavailable", "Today action inbox could not read candidate memberships.");
  }
  const tracked = membershipEnvelope.memberships.filter((membership) => membership.state === "tracked");
  const memberships = tracked.slice(0, MAX_TRACKED_MEMBERSHIPS);
  const omittedMembershipCount = Math.min(MAX_REPORTED_MEMBERSHIPS, Math.max(0, tracked.length - memberships.length));
  const generatedAt = now.toISOString();
  let dispositions = new Map<string, TodayMaterialChangeDispositionData>();
  if (memberships.length && dependencies.readDispositions) {
    try {
      dispositions = await dependencies.readDispositions(pool, actor);
    } catch {
      return failClosed(now, actor.actorId, "unavailable", "Today action inbox could not read material dispositions.");
    }
  }
  const nested = await mapWithConcurrency(memberships, 4, async (membership) => {
    const [anomalyItems, operatingItems, formalReviewItems, research, review] = await Promise.all([
      readAnomalyInboxItems(membership, actor, options, now, generatedAt, dependencies.readAnomaly ?? readTodayMarketAnomalyScreening),
      readOperatingInboxItems(pool, membership, actor, now, generatedAt, options, dependencies),
      readFormalReviewInboxItems(pool, membership, actor, now, generatedAt, options, dependencies),
      readResearchLane(pool, membership, actor, options, now, generatedAt, dependencies.readResearch,
        dependencies.readCompletedTask ?? (async () => null), dependencies.readTaskState ?? (async () => null)),
      readReviewLane(pool, membership, actor, now, generatedAt, dependencies.readReview)
    ]);
    const profileReview = projectTodayResearchProfileReviewDue(membership, generatedAt);
    const items: TodayActionInboxItem[] = [...anomalyItems, ...operatingItems, ...formalReviewItems];
    if (membership.quote?.status === "unavailable") items.push(sourceFailure(
      membership, "market_quote", "unavailable", marketQuoteFailureMessage(membership.quote.staleReason), generatedAt));
    if (profileReview) items.push(profileReview);
    if (candidateFoundEligible(membership, now) && research.items.length === 0 && !review.item && !profileReview)
      items.push(candidateFoundItem(membership, generatedAt));
    items.push(...research.items, ...research.failures);
    if (review.item) items.push(review.item);
    else if (review.failure) items.push(review.failure);
    return items;
  });
  const raw = nested.flat().map((item) => projectTodayActionDisposition(item, dispositions, generatedAt));
  raw.sort(compareItems);
  const selected = raw.slice(0, MAX_ITEMS).map((item, index) => ({ ...item, order: index + 1 }));
  const status = selected.length > 0 ? "available" : "empty";
  return {
    schemaVersion: TODAY_ACTION_INBOX_SCHEMA_VERSION,
    generatedAt,
    status,
    requestedActorId: actor.actorId,
    metadata: makeFactMetadata({
      source: TODAY_ACTION_INBOX_SOURCE,
      asOf: generatedAt,
      fetchedAt: generatedAt,
      freshness: status === "available" ? "fresh" : "missing",
      provenance: "real",
      authority: "research_evidence",
      stale: false,
      missing: status === "empty",
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message: status === "available"
        ? "Actor-scoped Today actions are reconstructed from current tracked memberships and their exact read-only research/review projections."
        : "No tracked membership produced a Today action; no empty success is inferred from an unavailable source."
    }),
    trackedMembershipCount: Math.min(MAX_REPORTED_MEMBERSHIPS, tracked.length),
    omittedMembershipCount,
    items: selected,
    omittedItemCount: Math.min(500, Math.max(0, raw.length - selected.length)),
    message: status === "available"
      ? `${selected.length} bounded Today action item(s) across ${memberships.length} tracked membership(s).`
      : "No tracked membership currently has a visible Today action.",
    safety: todayActionInboxSafety()
  };
}

async function readAnomalyInboxItems(
  membership: { id: string; version: number; symbol: string; research: { name: string | null }; quote?: { status: string } },
  actor: AuthenticatedResearchActor, options: TodayActionInboxReadOptions, now: Date, generatedAt: string,
  readAnomaly: typeof readTodayMarketAnomalyScreening
): Promise<TodayActionInboxItem[]> {
  if (!options.anomalyOptions) return [];
  try {
    // Today uses only persisted quote/journal and an already saved benchmark. Full discovery stays in investigation detail.
    const screening = await readAnomaly({ ...options.anomalyOptions, marketEnvironmentProvider: undefined,
      announcementProvider: undefined, noticeLeadProvider: undefined }, membership.id, actor, now);
    if (!screening.binding) return [];
    if (screening.binding.membershipId !== membership.id || screening.binding.membershipVersion !== membership.version
      || screening.binding.symbol !== membership.symbol) throw new Error("market anomaly membership changed");
    if (screening.quoteProblem) return membership.quote?.status === "unavailable" ? [] : [sourceFailure(membership,
      "market_quote", "unavailable", "当日报价时点、数值或来源核验未通过；请到 Market 刷新后重试。", generatedAt, "quote_validation")];
    if (screening.benchmarkGap) {
      const gap = screening.benchmarkGap;
      const failure = sourceFailure(membership, "market_quote", "unavailable",
        `已读 ${gap.tradingDate} 报价 ${gap.changePercent.toFixed(2)}%；5–8% 相对异常仍缺当时有效的恒指对照，请进入异常详情核对。`,
        generatedAt, "benchmark");
      return [{ ...failure, title: `${membership.symbol} 相对行情待核验`,
        source: { ...failure.source, effectiveAt: gap.quoteTime, asOf: gap.quoteTime } }];
    }
    const anomaly = screening.anomaly;
    if (!anomaly) return [];
    if (anomaly.membershipId !== membership.id || anomaly.membershipVersion !== membership.version || anomaly.symbol !== membership.symbol)
      throw new Error("market anomaly membership changed");
    const id = `inbox:event:market_anomaly:${membership.id}:${anomaly.tradingDate}:${anomaly.direction}:${anomaly.thresholdBand}`;
    const benchmark = anomaly.benchmark
      ? `恒指 ${anomaly.benchmark.changePercent.toFixed(2)}%，相对变化 ${anomaly.relativeChangePoints!.toFixed(2)} 个百分点`
      : "恒指对照未读，相对变化 UNKNOWN";
    return [{ id, order: 0, kind: "market_anomaly", priority: anomaly.thresholdBand === "eight_plus" ? "action" : "high",
      state: "new", symbol: anomaly.symbol,
      membership: { id: membership.id, version: membership.version, symbol: membership.symbol },
      source: { lane: "market_quote", id, version: membership.version, status: "available",
        sourceType: "personal_market_anomaly", effectiveAt: anomaly.quote.quoteTime,
        asOf: anomaly.quote.quoteTime, fetchedAt: generatedAt, validUntil: null,
        freshness: anomaly.freshness === "fresh" ? "fresh" : "stale", sourceFingerprint: anomaly.fingerprint },
      title: `${membership.research.name ?? membership.symbol} 异常${anomaly.direction === "down" ? "下跌" : "上涨"} · 待调查`,
      summary: `股价 ${anomaly.quote.changePercent.toFixed(2)}%；${benchmark}。公告与新闻线索尚未在 Today 读取，请进入调查核对原文；根因未确认，不自动修改 Thesis 或 Review。`,
      versionChange: null, researchTarget: null, reviewEvent: null }];
  } catch {
    return membership.quote?.status === "unavailable" ? [] : [sourceFailure(membership, "market_quote", "unavailable",
      "价格变化核对暂不可用；已有研究与复核事项仍可查看，请稍后重试。", generatedAt)];
  }
}

async function readOperatingInboxItems(pool: Pool, membership: {id:string;version:number;symbol:string},
  actor: AuthenticatedResearchActor, now: Date, generatedAt: string, options: TodayActionInboxReadOptions,
  dependencies: TodayActionInboxDependencies): Promise<TodayActionInboxItem[]> {
  if (!dependencies.readOperatingUpdate) return [];
  try { const item = await dependencies.readOperatingUpdate(pool, membership.id, actor, now, options.sourceStore);
    return item ? [item] : []; }
  catch { return [sourceFailure(membership, "research", "unavailable", "研究变化暂不可读，请进入 Research 刷新。", generatedAt, "operating")]; }
}

async function readFormalReviewInboxItems(pool: Pool, membership: {id:string;version:number;symbol:string},
  actor: AuthenticatedResearchActor, now: Date, generatedAt: string, options: TodayActionInboxReadOptions,
  dependencies: TodayActionInboxDependencies): Promise<TodayActionInboxItem[]> {
  if (!dependencies.readResearchReview) return [];
  try {
    const projection = await dependencies.readResearchReview(pool, membership.id, actor, now, "CURRENT_FY", false, options.sourceStore);
    const action = projection.todayAction;
    if (!action) return [];
    return [{ id: action.id, order: 0, kind: "research", priority: projection.triggerReasons.some(x =>
      ["EVIDENCE_INVALIDATED", "CURRENT_BASE_REVIEW_REQUIRED"].includes(x)) ? "high" : "action", state: "new",
      symbol: membership.symbol, membership: { id: membership.id, version: membership.version, symbol: membership.symbol },
      source: { lane: "research", id: projection.triggerFingerprint!, version: membership.version, status: "available",
        sourceType: "research_review_v1", effectiveAt: projection.activeMilestone!.createdAt,
        asOf: projection.activeMilestone!.createdAt, fetchedAt: generatedAt, validUntil: null,
        freshness: "fresh", sourceFingerprint: projection.triggerFingerprint },
      title: action.title, summary: action.summary, versionChange: null,
      researchTarget: { itemId: projection.triggerFingerprint!, preferredLayer: "evidence", report: null, task: null },
      reviewEvent: null }];
  } catch { return [sourceFailure(membership, "research", "unavailable", "持续复核状态暂不可读，请进入 Research 刷新。", generatedAt, "formal_review")]; }
}

export function failClosed(
  now: Date,
  actorId: string,
  status: "unavailable" | "unauthorized",
  message: string
): TodayActionInboxEnvelope {
  const generatedAt = now.toISOString();
  return {
    schemaVersion: TODAY_ACTION_INBOX_SCHEMA_VERSION,
    generatedAt,
    status,
    requestedActorId: actorId,
    metadata: makeFactMetadata({
      source: `${TODAY_ACTION_INBOX_SOURCE}:unavailable`,
      asOf: null,
      fetchedAt: null,
      freshness: "unavailable",
      provenance: "unavailable",
      authority: "unavailable",
      stale: false,
      missing: false,
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message: "Today action inbox is unavailable; no previous actions are retained."
    }),
    trackedMembershipCount: 0,
    omittedMembershipCount: 0,
    items: [],
    omittedItemCount: 0,
    message,
    safety: todayActionInboxSafety()
  };
}

async function readResearchLane(
  pool: Pool,
  membership: { id: string; version: number; symbol: string; state: string },
  actor: AuthenticatedResearchActor,
  options: TodayActionInboxReadOptions,
  now: Date,
  generatedAt: string,
  readResearch: ReadResearchEnvelope,
  readCompletedTask: ReadSucceededDeepResearchTask,
  readTaskState: ReadLatestDeepResearchTaskState
): Promise<{ items: TodayActionInboxItem[]; failures: TodayActionInboxItem[] }> {
  let envelope: TodayResearchEnvelope;
  try {
    envelope = await readResearch(pool, membership.id, actor, {
      accountScopeId: options.accountScopeId,
      currentPortfolioEnabled: options.currentPortfolioEnabled,
      currentPortfolioMaxAgeSeconds: options.currentPortfolioMaxAgeSeconds,
      sourceStore: options.sourceStore
    }, now);
  } catch (error) {
    return { items: [], failures: [sourceFailure(membership, "research", "unavailable", errorMessage(error, "research Today read failed"), generatedAt)] };
  }
  if (envelope.status !== "available") {
    return { items: [], failures: [sourceFailure(membership, "research", envelope.status, envelope.message, generatedAt)] };
  }
  const validation = validateTodayResearchEnvelope(envelope);
  if (!validation.ok || envelope.membershipId !== membership.id || envelope.membershipVersion !== membership.version || envelope.requestedSymbol !== membership.symbol) {
    return { items: [], failures: [sourceFailure(membership, "research", "malformed", "Research Today identity or contract validation failed; no partial item is exposed.", generatedAt)] };
  }
  const completionItem = envelope.items.find((item) => reportTaskBinding(item) !== null) ?? null;
  const stateItem = envelope.items.find((item) => packTaskBinding(item) !== null) ?? null;
  const completionBinding = completionItem ? reportTaskBinding(completionItem) : null;
  const stateBinding = stateItem ? packTaskBinding(stateItem) : null;
  let completedTask: DeepResearchTaskData | null;
  let taskState: DeepResearchTaskData | null;
  try {
    [completedTask, taskState] = await Promise.all([
      completionBinding ? readCompletedTask(pool, completionBinding, actor) : null,
      stateBinding ? readTaskState(pool, stateBinding, actor) : null
    ]);
  } catch (error) {
    return { items: [], failures: [sourceFailure(membership, "research", "unavailable", errorMessage(error, "deep-research task read failed"), generatedAt)] };
  }
  const projected = envelope.items
    .filter((item) => !["confirmed", "rejected"].includes(item.trackingState) || item.bindings.reportRef !== null)
    .map((item) => projectTodayResearchInboxItem(membership, item, generatedAt, completedTask));
  const projectedTaskState = stateItem
    ? projectTodayResearchTaskStateInboxItem(membership, stateItem, generatedAt, taskState)
    : null;
  if (projectedTaskState) {
    const currentIndex = projected.findIndex((item) => item.id === projectedTaskState.id);
    if (currentIndex === -1) projected.push(projectedTaskState);
    else projected[currentIndex] = projectedTaskState;
  }
  return { items: projected, failures: [] };
}

function packTaskBinding(item: TodayResearchEnvelope["items"][number]): DeepResearchTaskPackBinding | null {
  const pack = item.bindings.evidencePackRef;
  if (item.category !== "user_action" || pack === null) return null;
  return {
    membershipId: item.bindings.membershipId,
    membershipVersion: item.bindings.membershipVersion,
    evidencePackId: pack.id,
    evidencePackFingerprint: pack.packFingerprint
  };
}

function reportTaskBinding(item: TodayResearchEnvelope["items"][number]): DeepResearchTaskReportBinding | null {
  const pack = packTaskBinding(item);
  const report = item.bindings.reportRef;
  const revision = item.reportRevision?.current;
  if (!pack || item.trackingState !== "awaiting_user_confirmation" || !report || !revision
    || revision.reportFingerprint === "UNKNOWN") return null;
  return {
    ...pack,
    reportId: report.id,
    reportVersion: report.version,
    reportFingerprint: revision.reportFingerprint
  };
}

export async function readSucceededDeepResearchTask(
  pool: Pool, binding: DeepResearchTaskReportBinding, actor: AuthenticatedResearchActor
): Promise<DeepResearchTaskData | null> {
  const result = await pool.query(`${taskSelect()}
    where task.candidate_membership_id = $1 and task.candidate_membership_version = $2
      and task.evidence_pack_id = $3 and task.evidence_pack_fingerprint = $4
      and task.status = 'succeeded' and report.id = $5 and report.version = $6
      and report.report_fingerprint = $7 and task.actor_type = $8 and task.actor_id = $9
    order by task.created_at desc, task.id desc limit 1`,
  [binding.membershipId, binding.membershipVersion, binding.evidencePackId, binding.evidencePackFingerprint,
    binding.reportId, binding.reportVersion, binding.reportFingerprint, actor.actorType, actor.actorId]);
  return result.rows[0] ? rowToTask(result.rows[0]) : null;
}

export async function readLatestDeepResearchTaskState(
  pool: Pool, binding: DeepResearchTaskPackBinding, actor: AuthenticatedResearchActor
): Promise<DeepResearchTaskData | null> {
  const result = await pool.query(`${taskSelect()}
    where task.candidate_membership_id = $1 and task.candidate_membership_version = $2
      and task.evidence_pack_id = $3 and task.evidence_pack_fingerprint = $4
      and task.actor_type = $5 and task.actor_id = $6
    order by task.created_at desc, task.id desc limit 1`,
  [binding.membershipId, binding.membershipVersion, binding.evidencePackId,
    binding.evidencePackFingerprint, actor.actorType, actor.actorId]);
  return result.rows[0] ? rowToTask(result.rows[0]) : null;
}

async function readReviewLane(
  pool: Pool,
  membership: { id: string; version: number; symbol: string; state: string },
  actor: AuthenticatedResearchActor,
  now: Date,
  generatedAt: string,
  readReview: ReadReviewEnvelope
): Promise<{ item: TodayActionInboxItem | null; failure: TodayActionInboxItem | null }> {
  let envelope: TodayReviewDueEnvelope;
  try {
    const [, code] = membership.symbol.split(".");
    envelope = await readReview(pool, "HK", code!, actor, now);
  } catch (error) {
    return { item: null, failure: sourceFailure(membership, "review_due", "unavailable", errorMessage(error, "review Today read failed"), generatedAt) };
  }
  const validation = validateTodayReviewDueEnvelope(envelope, { expectedSymbol: membership.symbol, now });
  if (!validation.ok) {
    return { item: null, failure: sourceFailure(membership, "review_due", "malformed", "Review Today identity or contract validation failed; no partial event is exposed.", generatedAt) };
  }
  if (envelope.status === "empty") return { item: null, failure: null };
  if (envelope.status !== "available" || !envelope.event) {
    return { item: null, failure: sourceFailure(membership, "review_due", envelope.status, envelope.message, generatedAt) };
  }
  if (envelope.event.subject !== membership.symbol) {
    return { item: null, failure: sourceFailure(membership, "review_due", "malformed", "Review event symbol does not match the candidate membership.", generatedAt) };
  }
  return { item: reviewItem(membership, envelope.event, generatedAt), failure: null };
}

function reviewItem(
  membership: { id: string; version: number; symbol: string },
  event: TodayActionEvent,
  generatedAt: string
): TodayActionInboxItem {
  const kind: TodayActionInboxItemKind = event.type === "FORMAL_DECISION_DUE"
    ? "formal_decision_due"
    : event.type === "DAILY_TRACKING" ? "daily_tracking" : "review_due";
  const title = event.type === "FORMAL_DECISION_DUE"
    ? `${membership.symbol} 确认报告待正式决定`
    : event.type === "DAILY_TRACKING"
      ? `${membership.symbol} 每日跟踪与下一验证`
      : `${membership.symbol} 正式复盘待跟进`;
  return {
    id: `inbox:event:review_due:${membership.id}:${event.id}`,
    order: 0,
    kind,
    priority: event.type === "FORMAL_DECISION_DUE" ? "action" : "high",
    state: event.state === "new" ? "new" : "resolved",
    symbol: membership.symbol,
    membership: { id: membership.id, version: membership.version, symbol: membership.symbol },
    source: {
      lane: "review_due", id: event.id, version: Number(event.sourceEventId), status: "available",
      sourceType: "today_review_due_projection", effectiveAt: event.effectiveAt, asOf: event.stateChangedAt,
      fetchedAt: generatedAt, validUntil: null, freshness: "fresh", sourceFingerprint: null
    },
    title,
    summary: event.stateReason,
    versionChange: null,
    researchTarget: null,
    reviewEvent: event
  };
}

function sourceFailure(
  membership: { id: string; version: number; symbol: string },
  lane: TodayActionInboxSourceLane,
  status: string,
  message: string,
  generatedAt: string, failureScope = ""
): TodayActionInboxItem {
  const staleResearch = lane === "research" && status === "stale";
  return {
    id: `inbox:failure:${lane}:${membership.id}${failureScope ? `:${failureScope}` : ""}`,
    order: 0,
    kind: "source_failure",
    priority: "action",
    state: "blocked",
    symbol: membership.symbol,
    membership: { id: membership.id, version: membership.version, symbol: membership.symbol },
    source: {
      lane, id: `${lane}:${membership.id}`, version: null, status,
      sourceType: lane === "market_quote" ? "persisted_market_quotes"
        : lane === "review_due" ? "today_review_due_projection" : "today_research_projection",
      effectiveAt: null, asOf: null, fetchedAt: generatedAt, validUntil: null,
      freshness: staleResearch ? "stale" : "unavailable", sourceFingerprint: null
    },
    title: lane === "market_quote" ? `${membership.symbol} 行情来源不可用`
      : staleResearch ? `${membership.symbol} 研究来源已过期` : `${membership.symbol} Today 来源不可用`,
    summary: message,
    versionChange: null,
    researchTarget: null,
    reviewEvent: null
  };
}

function marketQuoteFailureMessage(reason: string | null): string {
  return reason === "no_persisted_quote"
    ? "当前没有可用行情；请去 Market 明确刷新。"
    : reason === "repository_error"
      ? "行情读取失败；请去 Market 重新读取。"
      : "行情来源暂不可用；请去 Market 重新读取。";
}

function candidateFoundEligible(membership: { createdAt?: string }, now: Date): boolean {
  if (typeof membership.createdAt !== "string") return false;
  const createdAt = Date.parse(membership.createdAt);
  return Number.isFinite(createdAt) && createdAt <= now.getTime() && now.getTime() - createdAt <= CANDIDATE_FOUND_LOOKBACK_MS;
}

function candidateFoundItem(
  membership: { id: string; version: number; symbol: string; createdAt?: string; updatedAt?: string },
  generatedAt: string
): TodayActionInboxItem {
  const effectiveAt = membership.createdAt ?? null;
  const asOf = membership.updatedAt ?? effectiveAt;
  return {
    id: `inbox:event:candidate_found:${membership.id}:v${membership.version}`,
    order: 0,
    kind: "candidate_found",
    priority: "high",
    state: "new",
    symbol: membership.symbol,
    membership: { id: membership.id, version: membership.version, symbol: membership.symbol },
    source: {
      lane: "candidate_membership", id: membership.id, version: membership.version, status: "available",
      sourceType: "candidate_memberships", effectiveAt, asOf, fetchedAt: generatedAt,
      validUntil: null, freshness: "fresh", sourceFingerprint: null
    },
    title: `${membership.symbol} 新候选已加入跟踪`,
    summary: "候选成员在最近窗口内建立；进入 Research 后重新读取当前研究资料与来源状态。",
    versionChange: null,
    researchTarget: null,
    reviewEvent: null
  };
}

function compareItems(left: TodayActionInboxItem, right: TodayActionInboxItem): number {
  const priority = { action: 0, high: 1, medium: 2, low: 3 } as const;
  const state = { blocked: 0, new: 1, later: 2, expired: 3, resolved: 4 } as const;
  return priority[left.priority] - priority[right.priority]
    || state[left.state] - state[right.state]
    || left.symbol.localeCompare(right.symbol)
    || left.kind.localeCompare(right.kind)
    || left.source.id.localeCompare(right.source.id);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
