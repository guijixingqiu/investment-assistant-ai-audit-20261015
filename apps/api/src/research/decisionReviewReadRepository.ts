import type { Pool } from "pg";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import type { DecisionReviewDeletionData, DecisionReviewHistoryEnvelope, PostDecisionReviewData } from "../../../../packages/contracts/src/decisionReview.js";
import {
  DECISION_REVIEW_SCHEMA_VERSION,
  decisionCheckToReviewState,
  reviewNoSideEffectSafety
} from "../../../../packages/contracts/src/decisionReview.js";
import { buildAnnualReviewLearningSummary } from "../../../../packages/contracts/src/annualReviewLearningSummary.js";
import { normalizeMarketCode } from "../market/freshness.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import {
  refreshAnnualConditionalDecisionMonitorFromAuthoritativeFacts
} from "./annualConditionalDecisionService.js";
import {
  decisionContextSnapshotState,
  rowToDecisionCheckFromRawPayload,
  rowToPostDecisionReview,
  type DecisionCheckRow,
  type PostDecisionReviewRow
} from "./decisionReviewMappers.js";
import type { QuantEvidenceRuntimeOptions } from "./quantEvidenceSource.js";
import { readDecisionReviewDeletions } from "./decisionReviewDeletionRepository.js";

export async function readDecisionReviewHistory(
  pool: Pool,
  market: string,
  code: string,
  actor: AuthenticatedResearchActor,
  currentFactOptions?: {
    accountScopeId: string | null;
    pinganCurrentMaxAgeSeconds: number;
    quoteLiveMaxAgeSeconds: number;
    now: Date;
    quantEvidence?: QuantEvidenceRuntimeOptions | null;
  }
): Promise<DecisionReviewHistoryEnvelope> {
  const normalized = normalizeMarketCode(market, code);
  const checks = await pool.query<DecisionCheckRow>(
    `select id, market, code, symbol, action_intent, verdict, requested_price,
            requested_quantity, current_price, current_quantity, average_cost, market_value,
            current_weight, user_final_decision, checked_at, raw_payload, decision_context_snapshot, decision_snapshot,
            (select count(*)::int from research_write_audit_events audit
              where audit.event_type = 'decision_check_created'
                and audit.target_table = 'pre_trade_decision_checks'
                and audit.target_id = pre_trade_decision_checks.id::text
                and audit.actor_type = $3 and audit.actor_id is not distinct from $4) as audit_count,
            (select audit.after_payload from research_write_audit_events audit
              where audit.event_type = 'decision_check_created'
                and audit.target_table = 'pre_trade_decision_checks'
                and audit.target_id = pre_trade_decision_checks.id::text
                and audit.actor_type = $3 and audit.actor_id is not distinct from $4
              order by audit.id limit 1) as audit_after_payload
       from pre_trade_decision_checks
      where market = $1
        and code = $2
        and deleted_at is null
        and exists (
          select 1
            from research_write_audit_events audit
           where audit.event_type = 'decision_check_created'
             and audit.target_table = 'pre_trade_decision_checks'
             and audit.target_id = pre_trade_decision_checks.id::text
             and audit.actor_type = $3
             and audit.actor_id is not distinct from $4
        )
      order by checked_at desc, id desc
      limit 50`,
    [normalized.market, normalized.code, actor.actorType, actor.actorId]
  );
  const checkIds = checks.rows.map((row) => String(row.id));
  const reviewRows = checkIds.length
    ? await pool.query<PostDecisionReviewRow>(
        `select review.id, review.decision_check_id, checks.market, checks.code, checks.symbol,
                review.actor_type, review.actor_id, review.outcome, review.outcome_evidence,
                review.review_note, review.reviewed_at, review.idempotency_key,
                review.correlation_id, review.created_at, review.raw_payload, review.portfolio_review_snapshot
          from post_decision_reviews review
          join pre_trade_decision_checks checks on checks.id = review.decision_check_id
         where review.decision_check_id = any($1::bigint[])
           and review.deleted_at is null
           and review.actor_type = $2
           and review.actor_id is not distinct from $3
         order by review.reviewed_at desc, review.created_at desc, review.id desc`,
        [checkIds, actor.actorType, actor.actorId]
      )
    : { rows: [] as PostDecisionReviewRow[] };
  const reviewsByCheck = new Map<string, PostDecisionReviewData[]>();
  const decisionsByCheck = new Map(
    checks.rows.map((row) => {
      const decision = rowToDecisionCheckFromRawPayload(row);
      return [String(row.id), decision] as const;
    })
  );
  for (const review of reviewRows.rows) {
    const key = String(review.decision_check_id);
    reviewsByCheck.set(key, [
      ...(reviewsByCheck.get(key) ?? []),
      rowToPostDecisionReview(review, decisionsByCheck.get(key)!)
    ]);
  }
  const deletions = await readDecisionReviewDeletions(pool, normalized.market, normalized.code, actor);
  const asOf = latestReviewHistoryTimestamp(checks.rows, reviewRows.rows, deletions);
  const mappedChecks = await Promise.all(checks.rows.map(async (row) => {
    const decision = rowToDecisionCheckFromRawPayload(row);
    if (currentFactOptions) {
      decision.conditionalDecision = await refreshAnnualConditionalDecisionMonitorFromAuthoritativeFacts(
        pool,
        decision.conditionalDecision,
        actor,
        currentFactOptions
      );
    }
    return decisionCheckToReviewState(
      decision,
      decisionContextSnapshotState(row, decision),
      decision.decisionSnapshot,
      reviewsByCheck.get(String(row.id)) ?? []
    );
  }));
  const fetchedAt = (currentFactOptions?.now ?? new Date()).toISOString();
  const hasHistory = checks.rows.length > 0 || deletions.length > 0;
  return {
    schemaVersion: DECISION_REVIEW_SCHEMA_VERSION,
    requestedSymbol: normalized.symbol,
    metadata: makeFactMetadata({
      source: "decision_review_history:pre_trade_decision_checks_post_decision_reviews",
      asOf,
      fetchedAt,
      freshness: hasHistory ? "fresh" : "missing",
      provenance: "real",
      authority: "decision_context",
      stale: false,
      missing: !hasHistory,
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message: hasHistory
        ? "Decision review history metadata is append-only advisory review context, not trading or portfolio authority."
        : "Decision review history metadata is missing because no actor-scoped checks are recorded for this symbol."
    }),
    checks: mappedChecks,
    deletions,
    learningSummary: buildAnnualReviewLearningSummary(mappedChecks, fetchedAt),
    advisoryOnly: true,
    safety: reviewNoSideEffectSafety(),
    message: `Post-decision review history for ${normalized.symbol} is advisory review only and cannot create orders, trades, fills, cash movements, fees, position mutations, or broker calls.`
  };
}

function latestReviewHistoryTimestamp(
  checks: DecisionCheckRow[], reviews: PostDecisionReviewRow[], deletions: DecisionReviewDeletionData[]
): string | null {
  const values = [
    ...checks.map((row) => row.checked_at),
    ...reviews.flatMap((row) => [row.reviewed_at, row.created_at]),
    ...deletions.map((deletion) => deletion.deletedAt)
  ]
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  return values.length === 0 ? null : new Date(Math.max(...values)).toISOString();
}
