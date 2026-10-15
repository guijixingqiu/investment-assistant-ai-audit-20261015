import type { Pool, PoolClient } from "pg";
import type { CreatePostDecisionReviewRequest, PostDecisionReviewData } from "../../../../packages/contracts/src/decisionReview.js";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { RESEARCH_WRITE_SCHEMA_VERSION } from "../../../../packages/contracts/src/research.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import {
  normalizePostDecisionPortfolioReviewState,
  type PostDecisionPortfolioReviewBinding
} from "../../../../packages/contracts/src/postDecisionPortfolioReview.js";
import {
  annualReviewLearningMatchesRequest,
  annualReviewLearningNotCapturedState,
  type AnnualReviewLearningRequest
} from "../../../../packages/contracts/src/annualReviewLearning.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import type { ResearchReportDecisionBinding } from "../../../../packages/contracts/src/researchReportDecision.js";
import type { DecisionCheckRow } from "./decisionReviewMappers.js";
import { actorRequest, sameResearchWriteActor } from "./writePersistence.js";

export type ReviewReviewedAtSemantics =
  | { kind: "omitted" }
  | { kind: "null" }
  | { kind: "timestamp"; value: string };

export interface ReviewAuditRecord {
  envelope: ResearchWriteEnvelope<PostDecisionReviewData>;
  requestSemantics: ReviewRequestSemantics | null;
}

export interface ReviewRequestSemantics {
  reviewedAt: ReviewReviewedAtSemantics;
  portfolioReviewBinding?: PostDecisionPortfolioReviewBinding;
  reviewLearning?: AnnualReviewLearningRequest;
  dailyTrackingBinding?: ResearchReportDecisionBinding;
}

export function reviewReviewedAtSemantics(request: CreatePostDecisionReviewRequest): ReviewReviewedAtSemantics {
  if (!Object.hasOwn(request, "reviewedAt") || request.reviewedAt === undefined) return { kind: "omitted" };
  if (request.reviewedAt === null) return { kind: "null" };
  return { kind: "timestamp", value: new Date(request.reviewedAt as string).toISOString() };
}

export function reviewRequestSemantics(request: CreatePostDecisionReviewRequest): ReviewRequestSemantics {
  const reviewedAt = reviewReviewedAtSemantics(request);
  return {
    reviewedAt,
    ...(request.portfolioReviewBinding === undefined ? {} : { portfolioReviewBinding: request.portfolioReviewBinding }),
    ...(request.reviewLearning === undefined ? {} : { reviewLearning: request.reviewLearning }),
    ...(request.dailyTrackingBinding === undefined ? {} : { dailyTrackingBinding: request.dailyTrackingBinding })
  };
}

export function sameReviewPayload(
  existingAudit: ReviewAuditRecord,
  request: CreatePostDecisionReviewRequest,
  requestSemantics: ReviewRequestSemantics,
  symbol: string,
  decisionCheckId: string,
  actor: AuthenticatedResearchActor
): boolean {
  const existing = existingAudit.envelope.data;
  return sameResearchWriteActor(existingAudit.envelope, actorRequest(actor, request.idempotencyKey))
    && existing.symbol === symbol
    && existing.decisionCheckId === decisionCheckId
    && existing.outcome === request.outcome
    && existing.outcomeEvidence === (request.outcomeEvidence ?? null)
    && existing.reviewNote === (request.reviewNote ?? null)
    && (request.reviewLearning
      ? annualReviewLearningMatchesRequest(existing.reviewLearning, request.reviewLearning)
      : existing.reviewLearning.availability === "review_learning_not_captured")
    && sameReviewRequestSemantics(existingAudit.requestSemantics, requestSemantics)
    && existing.audit.idempotencyKey === request.idempotencyKey
    && existing.audit.actorType === actor.actorType
    && existing.audit.actorId === actor.actorId
    && existing.audit.correlationId === null;
}

export async function findReviewAuditByIdempotencyKey(
  client: Pick<Pool | PoolClient, "query">,
  idempotencyKey: string
): Promise<ReviewAuditRecord | null> {
  const result = await client.query<{
    before_payload: { decisionCheckId?: string; reviewedAt?: ReviewReviewedAtSemantics; portfolioReviewBinding?: PostDecisionPortfolioReviewBinding; reviewLearning?: AnnualReviewLearningRequest; dailyTrackingBinding?: ResearchReportDecisionBinding } | null;
    after_payload: PostDecisionReviewData;
    actor_type: "user" | "system" | "migration" | "test";
    actor_id: string | null;
    correlation_id: string | null;
    created_at: Date | string;
  }>(
    `select before_payload, after_payload, actor_type, actor_id, correlation_id, created_at
       from research_write_audit_events
      where idempotency_key = $1
        and event_type = 'post_decision_review_created'
      limit 1`,
    [idempotencyKey]
  );
  const row = result.rows[0];
  if (!row) return null;
  const requestSemantics = reviewRequestSemanticsFromAudit(row.before_payload);
  const normalizedReview: PostDecisionReviewData = {
    ...row.after_payload,
    portfolioReview: normalizePostDecisionPortfolioReviewState(row.after_payload?.portfolioReview),
    reviewLearning: row.after_payload?.reviewLearning ?? annualReviewLearningNotCapturedState()
  };
  const replayableSemantics = requestSemantics
    && (requestSemantics.portfolioReviewBinding !== undefined
      && !portfolioReviewMatchesBinding(normalizedReview, requestSemantics.portfolioReviewBinding)
      || requestSemantics.reviewLearning !== undefined
      && !annualReviewLearningMatchesRequest(normalizedReview.reviewLearning, requestSemantics.reviewLearning))
    ? null
    : requestSemantics;
  return {
    requestSemantics: replayableSemantics,
    envelope: {
      schemaVersion: RESEARCH_WRITE_SCHEMA_VERSION,
      status: "succeeded",
      asOf: new Date(row.created_at).toISOString(),
      source: { actorType: row.actor_type, actorId: row.actor_id, correlationId: row.correlation_id },
      data: normalizedReview,
      message: "Idempotent write already recorded."
    }
  };
}

export async function findDecisionCheckForReview(
  client: Pick<Pool | PoolClient, "query">,
  market: string,
  code: string,
  decisionCheckId: string,
  actor: AuthenticatedResearchActor
): Promise<(DecisionCheckRow & { stock_id: string }) | null> {
  const result = await client.query<DecisionCheckRow & { stock_id: string }>(
    `select id, stock_id, market, code, symbol, action_intent, verdict, requested_price,
            requested_quantity, current_price, current_quantity, average_cost, market_value,
            current_weight, user_final_decision, checked_at, raw_payload, decision_context_snapshot,
            decision_snapshot
       from pre_trade_decision_checks
      where id = $1
        and market = $2
        and code = $3
        and deleted_at is null
        and exists (
          select 1
            from research_write_audit_events audit
           where audit.event_type = 'decision_check_created'
             and audit.target_table = 'pre_trade_decision_checks'
             and audit.target_id = pre_trade_decision_checks.id::text
             and audit.actor_type = $4
             and audit.actor_id is not distinct from $5
        )
      limit 1
      for update`,
    [decisionCheckId, market, code, actor.actorType, actor.actorId]
  );
  return result.rows[0] ?? null;
}

function sameReviewRequestSemantics(existing: ReviewRequestSemantics | null, requested: ReviewRequestSemantics): boolean {
  if (!existing || existing.reviewedAt.kind !== requested.reviewedAt.kind) return false;
  if (existing.reviewedAt.kind === "timestamp" && requested.reviewedAt.kind === "timestamp"
    && existing.reviewedAt.value !== requested.reviewedAt.value) return false;
  if (existing.portfolioReviewBinding === undefined || requested.portfolioReviewBinding === undefined) {
    if (existing.portfolioReviewBinding !== requested.portfolioReviewBinding) return false;
  } else if (canonicalJson(existing.portfolioReviewBinding) !== canonicalJson(requested.portfolioReviewBinding)) {
    return false;
  }
  if (existing.reviewLearning === undefined || requested.reviewLearning === undefined) {
    if (existing.reviewLearning !== requested.reviewLearning) return false;
  } else if (canonicalJson(existing.reviewLearning) !== canonicalJson(requested.reviewLearning)) {
    return false;
  }
  if (existing.dailyTrackingBinding === undefined || requested.dailyTrackingBinding === undefined) {
    return existing.dailyTrackingBinding === requested.dailyTrackingBinding;
  }
  return canonicalJson(existing.dailyTrackingBinding) === canonicalJson(requested.dailyTrackingBinding);
}

function isReviewReviewedAtSemantics(value: unknown): value is ReviewReviewedAtSemantics {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "omitted" || kind === "null") return true;
  return kind === "timestamp" && typeof (value as { value?: unknown }).value === "string";
}

function reviewRequestSemanticsFromAudit(
  value: { reviewedAt?: ReviewReviewedAtSemantics; portfolioReviewBinding?: PostDecisionPortfolioReviewBinding; reviewLearning?: AnnualReviewLearningRequest; dailyTrackingBinding?: ResearchReportDecisionBinding } | null
): ReviewRequestSemantics | null {
  if (!isReviewReviewedAtSemantics(value?.reviewedAt)) return null;
  if (value.portfolioReviewBinding !== undefined
    && (!value.portfolioReviewBinding || typeof value.portfolioReviewBinding !== "object")) return null;
  if (value.reviewLearning !== undefined
    && (!value.reviewLearning || typeof value.reviewLearning !== "object")) return null;
  if (value.dailyTrackingBinding !== undefined
    && (!value.dailyTrackingBinding || typeof value.dailyTrackingBinding !== "object")) return null;
  return {
    reviewedAt: value.reviewedAt,
    ...(value.portfolioReviewBinding === undefined ? {} : { portfolioReviewBinding: value.portfolioReviewBinding }),
    ...(value.reviewLearning === undefined ? {} : { reviewLearning: value.reviewLearning }),
    ...(value.dailyTrackingBinding === undefined ? {} : { dailyTrackingBinding: value.dailyTrackingBinding })
  };
}

function portfolioReviewMatchesBinding(
  review: PostDecisionReviewData,
  binding: PostDecisionPortfolioReviewBinding
): boolean {
  const state = review.portfolioReview;
  if (state.availability !== "preserved" || !state.snapshot) return false;
  const snapshot = state.snapshot;
  const actual: PostDecisionPortfolioReviewBinding = {
    schemaVersion: snapshot.schemaVersion,
    decisionCheckId: snapshot.decisionCheckId,
    decisionSnapshotId: snapshot.decisionSnapshotId,
    candidateSymbol: snapshot.candidateSymbol,
    decisionTimePortfolio: {
      state: snapshot.comparison.decisionTime.state,
      contextId: snapshot.comparison.decisionTime.contextId,
      portfolioSnapshotId: snapshot.comparison.decisionTime.portfolioSnapshotId,
      accountScopeId: snapshot.comparison.decisionTime.accountScopeId
    },
    reviewTimePortfolio: {
      state: snapshot.comparison.reviewTime.state,
      contextId: snapshot.comparison.reviewTime.contextId,
      portfolioSnapshotId: snapshot.comparison.reviewTime.portfolioSnapshotId,
      accountScopeId: snapshot.comparison.reviewTime.accountScopeId
    },
    comparison: {
      calculationVersion: snapshot.comparison.calculationVersion,
      comparisonId: snapshot.comparison.comparisonId
    }
  };
  return canonicalJson(actual) === canonicalJson(binding);
}
