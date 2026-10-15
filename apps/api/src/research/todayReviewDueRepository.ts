import type { Pool } from "pg";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import {
  TODAY_REVIEW_DUE_SCHEMA_VERSION,
  TODAY_REVIEW_DUE_SOURCE,
  todayDailyTrackingIdentity,
  todayReviewDueIdentity,
  todayReviewDueSafety,
  type TodayReviewDueEnvelope,
  type TodayReviewDueEvent
} from "../../../../packages/contracts/src/todayReviewDue.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import {
  assertTodayDecision,
  type DecisionProjectionRow,
  type TodayAuditProjection
} from "./todayDecisionProjection.js";
import type { TodayDecisionEvidence } from "./todayReviewDueDecisionEvidence.js";
import {
  BoundReportNoLongerCurrentError,
  readBoundTodayResearchReport
} from "./todayReviewDueReportSnapshot.js";
import { readTodayFormalDecisionDue } from "./todayFormalDecisionDueRepository.js";

interface ReviewProjectionRow extends TodayAuditProjection {
  id: string; decision_check_id: string;
  actor_type: "user" | "system";
  actor_id: string;
  outcome: "thesis_confirmed" | "thesis_weakened" | "thesis_invalidated" | "insufficient_evidence";
  reviewed_at: Date | string; created_at: Date | string;
  audit_before_payload: unknown;
  daily_tracking_audit_count: number;
}

export async function readTodayReviewDue(
  pool: Pool,
  market: string,
  code: string,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  formalDecisionDueReader = readTodayFormalDecisionDue,
  boundReportReader = readBoundTodayResearchReport
): Promise<TodayReviewDueEnvelope> {
  assertCanonicalRequest(market, code);
  const symbol = `${market}.${code}`;
  const fetchedAt = canonicalInstant(now, "now");
  const formalDecisionDue = await formalDecisionDueReader(pool, market, code, actor, now);
  if (formalDecisionDue) {
    return {
      schemaVersion: TODAY_REVIEW_DUE_SCHEMA_VERSION,
      status: "available",
      requestedSymbol: symbol,
      metadata: makeFactMetadata({
        source: TODAY_REVIEW_DUE_SOURCE,
        asOf: formalDecisionDue.stateChangedAt,
        fetchedAt,
        freshness: "fresh",
        provenance: "real",
        authority: "research_evidence",
        stale: false, missing: false, conflict: false, fixture: false,
        correctionOf: null, replaces: null,
        message: "Actor-scoped FORMAL_DECISION_DUE is projected from an exact-current confirmed report and immutable audit."
      }),
      event: formalDecisionDue,
      advisoryOnly: true,
      safety: todayReviewDueSafety(),
      message: `Confirmed report for ${symbol} requires an explicit formal human decision; navigation never adopts it automatically.`
    };
  }
  const decisions = await pool.query<DecisionProjectionRow>(
    `select checks.id, checks.stock_id, checks.market, checks.code, checks.symbol, checks.checked_at,
            checks.action_intent, checks.user_final_decision,
            checks.raw_payload, checks.decision_context_snapshot, checks.decision_snapshot,
            audit.audit_count, audit.actor_audit_count, audit.audit_actor_type,
            audit.audit_actor_id, audit.audit_stock_id, audit.audit_market, audit.audit_code,
            audit.audit_symbol, audit.audit_event_type, audit.audit_target_table,
            audit.audit_target_id, audit.audit_after_payload, audit.audit_created_at
       from pre_trade_decision_checks checks
       join lateral (
         select count(*)::int as audit_count,
                count(*) filter (where candidate.actor_type = $3 and candidate.actor_id is not distinct from $4)::int as actor_audit_count,
                min(candidate.actor_type) filter (where candidate.actor_type = $3 and candidate.actor_id is not distinct from $4) as audit_actor_type,
                min(candidate.actor_id) filter (where candidate.actor_type = $3 and candidate.actor_id is not distinct from $4) as audit_actor_id,
                min(candidate.stock_id)::text as audit_stock_id, min(candidate.market) as audit_market,
                min(candidate.code) as audit_code, min(candidate.symbol) as audit_symbol,
                min(candidate.event_type::text) as audit_event_type, min(candidate.target_table) as audit_target_table,
                min(candidate.target_id) as audit_target_id,
                (jsonb_agg(candidate.after_payload order by candidate.id)->0) as audit_after_payload,
                min(candidate.created_at) filter (where candidate.actor_type = $3 and candidate.actor_id is not distinct from $4) as audit_created_at
           from research_write_audit_events candidate
          where candidate.event_type = 'decision_check_created'
            and candidate.target_table = 'pre_trade_decision_checks'
            and candidate.target_id = checks.id::text
       ) audit on true
      where checks.market = $1
        and checks.code = $2
        and checks.symbol = $5
        and checks.deleted_at is null
        and (audit.actor_audit_count > 0 or audit.audit_count = 0)
      order by checks.checked_at desc, checks.id desc
      limit 2`,
    [market, code, actor.actorType, actor.actorId, symbol]
  );
  if (decisions.rows.length === 0) {
    return emptyTodayReviewDue(symbol, fetchedAt);
  }
  const decision = decisions.rows[0]!;
  const decisionEvidence = assertTodayDecision(decision, market, code, symbol, actor, now);
  if (decisions.rows[1]
    && canonicalInstant(decisions.rows[1].checked_at, "prior checkedAt") === canonicalInstant(decision.checked_at, "checkedAt")) {
    throw new Error("latest actor-scoped decision is ambiguous at the same effective time");
  }

  let researchReport: TodayReviewDueEvent["researchReport"];
  if (decisionEvidence.reportDecision.availability === "preserved") {
    try {
      researchReport = await boundReportReader(
        pool,
        decisionEvidence.reportDecision.binding,
        { market: decision.market, code: decision.code, symbol: decision.symbol, checkedAt: decision.checked_at },
        actor,
        now
      );
    } catch (error) {
      if (error instanceof BoundReportNoLongerCurrentError) {
        return emptyTodayReviewDue(symbol, fetchedAt);
      }
      throw error;
    }
  } else {
    researchReport = notCapturedTodayReport(decisionEvidence.reportDecision.limitation);
  }

  const reviews = await pool.query<ReviewProjectionRow>(
    `select review.id, review.decision_check_id, review.actor_type, review.actor_id,
            review.outcome, review.reviewed_at, review.created_at,
            audit.audit_count, audit.actor_audit_count, audit.audit_actor_type,
            audit.audit_actor_id, audit.audit_stock_id, audit.audit_market, audit.audit_code,
            audit.audit_symbol, audit.audit_event_type, audit.audit_target_table,
            audit.audit_target_id, audit.audit_before_payload, audit.audit_after_payload,
            audit.audit_created_at, audit.daily_tracking_audit_count
       from post_decision_reviews review
       join lateral (
         select count(*)::int as audit_count,
                count(*) filter (where candidate.actor_type = $2 and candidate.actor_id is not distinct from $3)::int as actor_audit_count,
                min(candidate.actor_type) filter (where candidate.actor_type = $2 and candidate.actor_id is not distinct from $3) as audit_actor_type,
                min(candidate.actor_id) filter (where candidate.actor_type = $2 and candidate.actor_id is not distinct from $3) as audit_actor_id,
                min(candidate.stock_id)::text as audit_stock_id, min(candidate.market) as audit_market,
                min(candidate.code) as audit_code, min(candidate.symbol) as audit_symbol,
                min(candidate.event_type::text) as audit_event_type, min(candidate.target_table) as audit_target_table,
                min(candidate.target_id) as audit_target_id,
                (jsonb_agg(candidate.before_payload order by candidate.id)->0) as audit_before_payload,
                (jsonb_agg(candidate.after_payload order by candidate.id)->0) as audit_after_payload,
                count(*) filter (where candidate.before_payload ? 'dailyTrackingBinding')::int as daily_tracking_audit_count,
                min(candidate.created_at) filter (where candidate.actor_type = $2 and candidate.actor_id is not distinct from $3) as audit_created_at
           from research_write_audit_events candidate
          where candidate.event_type = 'post_decision_review_created'
            and candidate.target_table = 'post_decision_reviews'
            and candidate.target_id = review.id::text
       ) audit on true
      where review.decision_check_id = $1
        and review.deleted_at is null
        and review.actor_type = $2
        and review.actor_id is not distinct from $3
        and ($4::boolean = false or audit.daily_tracking_audit_count > 0)
      order by review.reviewed_at desc, review.created_at desc, review.id desc`,
    [String(decision.id), actor.actorType, actor.actorId, researchReport.availability === "preserved"]
  );
  reviews.rows.forEach((review) => assertReview(review, decision, actor, now));
  if (researchReport.availability === "preserved") {
    reviews.rows.forEach((review) => assertDailyTrackingReview(review, researchReport.binding));
  }
  if (reviews.rows[1]
    && canonicalInstant(reviews.rows[1].reviewed_at, "prior reviewedAt") === canonicalInstant(reviews.rows[0]!.reviewed_at, "reviewedAt")) {
    throw new Error("latest actor-scoped review is ambiguous at the same state time");
  }
  if (decisionEvidence.reviewDueOn
    && timestamp(fetchedAt, "fetchedAt") < timestamp(hongKongReviewDayStart(decisionEvidence.reviewDueOn), "review dueAt")) {
    return emptyTodayReviewDue(symbol, fetchedAt);
  }
  return availableTodayReviewDue(
    symbol, decision, decisionEvidence.humanCheckResult, decisionEvidence.reviewDueOn,
    decisionEvidence.formalDecision, researchReport,
    reviews.rows[0] ?? null, reviews.rows[1] ?? null, fetchedAt
  );
}

const DAILY_TRACKING_INTERVAL_MS = 24 * 60 * 60 * 1000;

function availableTodayReviewDue(
  symbol: string,
  decision: DecisionProjectionRow,
  humanCheckResult: "ready_to_consider" | "blocked" | "needs_more_evidence",
  reviewDueOn: string | undefined,
  formalDecision: TodayDecisionEvidence["formalDecision"],
  researchReport: TodayReviewDueEvent["researchReport"],
  review: ReviewProjectionRow | null,
  priorReview: ReviewProjectionRow | null,
  fetchedAt: string
): TodayReviewDueEnvelope {
  const decisionEffectiveAt = canonicalInstant(decision.checked_at, "checkedAt");
  const sourceEventId = String(decision.id);
  const dailyTracking = researchReport.availability === "preserved";
  if (dailyTracking && reviewDueOn) throw new Error("formal daily tracking cannot use ordinary reviewDueOn");
  const scheduledAt = reviewDueOn ? hongKongReviewDayStart(reviewDueOn) : null;
  const nextDailyTrackingAt = dailyTracking && review
    ? new Date(timestamp(review.reviewed_at, "reviewedAt") + DAILY_TRACKING_INTERVAL_MS).toISOString()
    : null;
  const nextDailyTrackingIsDue = nextDailyTrackingAt !== null
    && timestamp(fetchedAt, "fetchedAt") >= timestamp(nextDailyTrackingAt, "next daily tracking at");
  const resolvedOccurrenceAt = dailyTracking && review && priorReview
    ? new Date(timestamp(priorReview.reviewed_at, "prior reviewedAt") + DAILY_TRACKING_INTERVAL_MS).toISOString()
    : decisionEffectiveAt;
  if (dailyTracking && review
    && timestamp(review.reviewed_at, "reviewedAt") < timestamp(resolvedOccurrenceAt, "resolved occurrence at")) {
    throw new Error("daily-tracking review precedes its projected occurrence");
  }
  const effectiveAt = nextDailyTrackingIsDue ? nextDailyTrackingAt! : scheduledAt ?? resolvedOccurrenceAt;
  const resolvedByReview = review !== null && !nextDailyTrackingIsDue;
  const stateChangedAt = nextDailyTrackingIsDue
    ? effectiveAt
    : resolvedByReview
      ? scheduledAt
        ? new Date(Math.max(timestamp(review.audit_created_at, "review audit createdAt"), timestamp(scheduledAt, "review dueAt"))).toISOString()
        : canonicalInstant(review.audit_created_at, "review audit createdAt")
      : scheduledAt
        ? new Date(Math.max(timestamp(decision.audit_created_at, "decision audit createdAt"), timestamp(scheduledAt, "review dueAt"))).toISOString()
        : canonicalInstant(decision.audit_created_at, "decision audit createdAt");
  const event: TodayReviewDueEvent = {
    id: dailyTracking
      ? todayDailyTrackingIdentity(symbol, sourceEventId, effectiveAt)
      : todayReviewDueIdentity(symbol, sourceEventId, effectiveAt),
    type: dailyTracking ? "DAILY_TRACKING" : "REVIEW_DUE",
    subject: symbol,
    sourceEventId,
    effectiveAt,
    priority: {
      severity: "attention",
      dueAt: effectiveAt
    },
    state: resolvedByReview ? "resolved" : "new",
    stateChangedAt,
    stateActor: {
      actorType: review?.audit_actor_type ?? decision.audit_actor_type,
      actorId: review?.audit_actor_id ?? decision.audit_actor_id
    },
    stateReason: resolvedByReview
      ? `post_decision_review:${review.outcome}`
      : dailyTracking
        ? "adopted_report_requires_daily_tracking"
        : scheduledAt ? "manual_review_calendar_due" : "decision_check_created_without_valid_review",
    bindings: {
      decisionCheckId: sourceEventId,
      reviewId: resolvedByReview ? String(review.id) : null
    },
    humanDecision: {
      actionIntent: decision.action_intent,
      humanCheckResult,
      userFinalDecision: decision.user_final_decision,
      ...(reviewDueOn === undefined ? {} : { reviewDueOn }),
      formalDecision
    },
    researchReport
  };
  return {
    schemaVersion: TODAY_REVIEW_DUE_SCHEMA_VERSION,
    status: "available",
    requestedSymbol: symbol,
    metadata: makeFactMetadata({
      source: TODAY_REVIEW_DUE_SOURCE,
      asOf: stateChangedAt,
      fetchedAt,
      freshness: "fresh",
      provenance: "real",
      authority: "decision_context",
      stale: false,
      missing: false,
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message: dailyTracking
        ? "Actor-scoped DAILY_TRACKING is projected from an audited formal decision and its exact-current adopted report."
        : scheduledAt
          ? "Actor-scoped REVIEW_DUE is projected at the Hong Kong calendar boundary from an audited ordinary check and review."
          : "Actor-scoped REVIEW_DUE is projected from audited decision and review facts."
    }),
    event,
    advisoryOnly: true,
    safety: todayReviewDueSafety(),
    message: resolvedByReview
      ? `${dailyTracking ? "Daily tracking" : "Formal review"} follow-up for ${symbol} is resolved by the latest audited review.`
      : dailyTracking
        ? `The adopted exact-current report for ${symbol} is ready for daily tracking and its next validation.`
        : scheduledAt
          ? `The ordinary decision for ${symbol} reached its chosen Hong Kong review date; dueAt is a projection, not a new user action.`
          : `Ordinary decision for ${symbol} requires immediate review follow-up; dueAt equals checkedAt and is not a calendar plan.`
  };
}

function hongKongReviewDayStart(reviewDueOn: string): string {
  const instant = new Date(`${reviewDueOn}T00:00:00+08:00`);
  if (!Number.isFinite(instant.getTime())) throw new Error("reviewDueOn has no Hong Kong day boundary");
  return instant.toISOString();
}

function emptyTodayReviewDue(symbol: string, fetchedAt: string): TodayReviewDueEnvelope {
  return {
    schemaVersion: TODAY_REVIEW_DUE_SCHEMA_VERSION,
    status: "empty",
    requestedSymbol: symbol,
    metadata: makeFactMetadata({
      source: TODAY_REVIEW_DUE_SOURCE,
      asOf: null,
      fetchedAt,
      freshness: "missing",
      provenance: "real",
      authority: "decision_context",
      stale: false,
      missing: true,
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message: "No exact-current actor-scoped formal decision requires a Today review action for this symbol."
    }),
    event: null,
    advisoryOnly: true,
    safety: todayReviewDueSafety(),
    message: `No exact-current REVIEW_DUE event exists for ${symbol}; historical report bindings are not promoted.`
  };
}

function notCapturedTodayReport(limitation: string): TodayReviewDueEvent["researchReport"] {
  return {
    availability: "not_captured",
    binding: null,
    investmentThesis: "UNKNOWN",
    invalidationConditions: [],
    nextValidationQuestion: "UNKNOWN",
    limitation
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function assertReview(row: ReviewProjectionRow, decision: DecisionProjectionRow, actor: AuthenticatedResearchActor, now: Date): void {
  if (!isPositiveId(row.id) || String(row.decision_check_id) !== String(decision.id)
    || row.actor_type !== actor.actorType || row.actor_id !== actor.actorId) {
    throw new Error("review identity does not match the actor-scoped decision");
  }
  if (Number(row.audit_count) !== 1 || Number(row.actor_audit_count) !== 1
    || row.audit_actor_type !== actor.actorType || row.audit_actor_id !== actor.actorId) {
    throw new Error("review audit identity is missing, duplicated, or mismatched");
  }
  if (!["thesis_confirmed", "thesis_weakened", "thesis_invalidated", "insufficient_evidence"].includes(row.outcome)) {
    throw new Error("review outcome is invalid");
  }
  const checkedAt = timestamp(decision.checked_at, "checkedAt");
  const reviewedAt = timestamp(row.reviewed_at, "reviewedAt");
  const createdAt = timestamp(row.created_at, "review createdAt");
  const auditAt = timestamp(row.audit_created_at, "review audit createdAt");
  if (reviewedAt < checkedAt || createdAt < reviewedAt || auditAt < createdAt || auditAt > now.getTime()) {
    throw new Error("review or audit chronology is invalid");
  }
  const audit = record(row.audit_after_payload, "review audit afterPayload");
  if (String(row.audit_stock_id) !== String(decision.stock_id)
    || row.audit_market !== decision.market || row.audit_code !== decision.code
    || row.audit_symbol !== decision.symbol
    || row.audit_event_type !== "post_decision_review_created"
    || row.audit_target_table !== "post_decision_reviews"
    || String(row.audit_target_id) !== String(row.id)
    || String(audit.id) !== String(row.id)
    || String(audit.decisionCheckId) !== String(row.decision_check_id)
    || audit.market !== decision.market || audit.code !== decision.code
    || audit.symbol !== decision.symbol || audit.outcome !== row.outcome
    || canonicalInstantValue(audit.reviewedAt, "review audit reviewedAt")
      !== canonicalInstant(row.reviewed_at, "reviewedAt")) {
    throw new Error("review audit does not exactly bind the persisted review");
  }
}

function assertDailyTrackingReview(
  row: ReviewProjectionRow,
  binding: NonNullable<TodayReviewDueEvent["researchReport"]>["binding"]
): void {
  if (Number(row.daily_tracking_audit_count) !== 1 || !binding) {
    throw new Error("daily-tracking review audit binding is missing or duplicated");
  }
  const before = record(row.audit_before_payload, "review audit beforePayload");
  if (String(before.decisionCheckId) !== String(row.decision_check_id)
    || canonicalJson(before.dailyTrackingBinding) !== canonicalJson(binding)) {
    throw new Error("daily-tracking review audit does not exactly bind the adopted report");
  }
}

function assertCanonicalRequest(market: string, code: string): void {
  if (market !== "HK" || !/^\d{5}$/.test(code))
    throw new Error("Today REVIEW_DUE supports exact canonical HK symbols only");
}

function canonicalInstant(value: Date | string, field: string): string {
  return new Date(timestamp(value, field)).toISOString();
}

function canonicalInstantValue(value: unknown, field: string): string {
  if (!(typeof value === "string" || value instanceof Date)) throw new Error(`${field} is invalid`);
  return canonicalInstant(value, field);
}
function timestamp(value: Date | string, field: string): number {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`${field} is invalid`);
  return milliseconds;
}
function isPositiveId(value: unknown): boolean { return /^[1-9]\d*$/.test(String(value)); }
