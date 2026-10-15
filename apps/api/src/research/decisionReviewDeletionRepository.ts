import type { Pool, PoolClient } from "pg";
import type {
  DecisionReviewDeletionData,
  DeleteDecisionCheckRequest,
  DeletePostDecisionReviewRequest
} from "../../../../packages/contracts/src/decisionReview.js";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { requestFingerprint } from "./deepResearchGate.js";
import {
  DecisionCheckNotFoundError,
  IdempotencyConflictError,
  type AuthenticatedResearchActor
} from "./domain.js";
import { normalizeMarketCode } from "../market/freshness.js";
import {
  actorRequest,
  findAuditByIdempotencyKey,
  insertWriteAudit,
  isUniqueViolation,
  sameResearchWriteActor,
  writeEnvelope,
  type ResearchWriteAuditReplay
} from "./writePersistence.js";

type DeletionRow = {
  decision_check_id: string;
  review_id: string | null;
  stock_id: string;
  symbol: string;
  recorded_at: Date | string;
  deleted_at: Date | string;
};

export async function readDecisionReviewDeletions(
  pool: Pick<Pool | PoolClient, "query">,
  market: string,
  code: string,
  actor: AuthenticatedResearchActor
): Promise<DecisionReviewDeletionData[]> {
  const normalized = normalizeMarketCode(market, code);
  const rows = await pool.query<DeletionRow & { kind: DecisionReviewDeletionData["kind"] }>(
    `select 'decision_check'::text as kind, checks.id::text as decision_check_id,
            null::text as review_id, checks.stock_id::text, checks.symbol,
            checks.checked_at as recorded_at, checks.deleted_at
       from pre_trade_decision_checks checks
      where checks.market = $1 and checks.code = $2 and checks.deleted_at is not null
        and exists (${actorOwnsDecisionCheckSql("checks", "$3", "$4")})
      union all
     select 'post_decision_review'::text as kind, checks.id::text as decision_check_id,
            review.id::text as review_id, checks.stock_id::text, checks.symbol,
            review.created_at as recorded_at, review.deleted_at
       from post_decision_reviews review
       join pre_trade_decision_checks checks on checks.id = review.decision_check_id
      where checks.market = $1 and checks.code = $2 and review.deleted_at is not null
        and exists (${actorOwnsDecisionCheckSql("checks", "$3", "$4")})
      order by deleted_at desc, decision_check_id desc, review_id desc
      limit 100`,
    [normalized.market, normalized.code, actor.actorType, actor.actorId]
  );
  return rows.rows.map(rowToDeletion);
}

export async function readDecisionCheckDeletion(
  pool: Pick<Pool | PoolClient, "query">,
  market: string,
  code: string,
  checkId: string,
  actor: AuthenticatedResearchActor
): Promise<DecisionReviewDeletionData | null> {
  return readExactDeletion(pool, market, code, checkId, null, actor);
}

export async function readPostDecisionReviewDeletion(
  pool: Pick<Pool | PoolClient, "query">,
  market: string,
  code: string,
  checkId: string,
  reviewId: string,
  actor: AuthenticatedResearchActor
): Promise<DecisionReviewDeletionData | null> {
  return readExactDeletion(pool, market, code, checkId, reviewId, actor);
}

export async function deleteDecisionCheck(
  pool: Pool,
  market: string,
  code: string,
  checkId: string,
  request: DeleteDecisionCheckRequest,
  actor: AuthenticatedResearchActor,
  now = new Date()
): Promise<ResearchWriteEnvelope<DecisionReviewDeletionData>> {
  requireUser(actor);
  const normalized = normalizeMarketCode(market, code);
  const fingerprint = requestFingerprint("decision_check_delete", { ...normalized, checkId, request, actor });
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const replay = await findAuditByIdempotencyKey<DecisionReviewDeletionData>(client, request.idempotencyKey, "decision_check_deleted");
    if (replay) return await commitReplay(client, replay, actor, fingerprint, "decision_check", checkId, null);
    const selected = await client.query<{
      decision_check_id: string; stock_id: string; symbol: string; checked_at: Date | string;
    }>(
      `select checks.id::text as decision_check_id, checks.stock_id::text, checks.symbol, checks.checked_at
         from pre_trade_decision_checks checks
        where checks.id = $1 and checks.market = $2 and checks.code = $3 and checks.deleted_at is null
          and exists (${actorOwnsDecisionCheckSql("checks", "$4", "$5")})
        for update of checks`,
      [checkId, normalized.market, normalized.code, actor.actorType, actor.actorId]
    );
    const row = selected.rows[0];
    if (!row || !sameInstant(row.checked_at, request.expectedCheckedAt)) throw new DecisionCheckNotFoundError("current exact decision check was not found or changed before deletion");
    const reviews = await client.query<{ review_id: string; created_at: Date | string }>(
      `select id::text as review_id, created_at
         from post_decision_reviews
        where decision_check_id = $1 and deleted_at is null
        for update`,
      [checkId]
    );
    const deletedAt = now.toISOString();
    const data = deletionData("decision_check", checkId, null, row.symbol, row.checked_at, deletedAt);
    await client.query(
      `update post_decision_reviews
          set outcome = 'deleted', outcome_evidence = null, review_note = null,
              raw_payload = '{"state":"deleted"}'::jsonb, portfolio_review_snapshot = null,
              deleted_at = $2, deleted_by_actor_id = $3
        where decision_check_id = $1 and deleted_at is null`,
      [checkId, now, actor.actorId]
    );
    for (const review of reviews.rows) {
      await redactCreatedAudit(client, "post_decision_review_created", "post_decision_reviews", review.review_id,
        deletionData("post_decision_review", checkId, review.review_id, row.symbol, review.created_at, deletedAt));
    }
    await redactCreatedAudit(client, "decision_check_created", "pre_trade_decision_checks", checkId, data);
    const tombstone = await client.query(
      `update pre_trade_decision_checks
          set action_intent = 'deleted', verdict = 'deleted', requested_price = null,
              requested_quantity = null, current_price = null, current_quantity = null,
              average_cost = null, market_value = null, current_weight = null,
              user_final_decision = null, decided_at = null, raw_payload = '{"state":"deleted"}'::jsonb,
              decision_context_snapshot = null, decision_snapshot = null,
              deleted_at = $2, deleted_by_actor_id = $3
        where id = $1 and deleted_at is null`,
      [checkId, now, actor.actorId]
    );
    if (tombstone.rowCount !== 1) throw new DecisionCheckNotFoundError("decision check changed before deletion");
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "decision_check_deleted", request: auditRequest,
      stock: { id: row.stock_id, ...normalized }, targetTable: "pre_trade_decision_checks",
      targetId: checkId, beforePayload: { decisionCheckId: checkId, state: "active" },
      afterPayload: data, requestFingerprint: fingerprint
    });
    await client.query("commit");
    return writeEnvelope(auditRequest, data, "Formal decision and attached review bodies deleted; contentless tombstones remain.", auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) return replayAfterConflict(pool, request.idempotencyKey, "decision_check_deleted", actor, fingerprint, "decision_check", checkId, null);
    throw error;
  } finally { client.release(); }
}

export async function deletePostDecisionReview(
  pool: Pool,
  market: string,
  code: string,
  checkId: string,
  reviewId: string,
  request: DeletePostDecisionReviewRequest,
  actor: AuthenticatedResearchActor,
  now = new Date()
): Promise<ResearchWriteEnvelope<DecisionReviewDeletionData>> {
  requireUser(actor);
  const normalized = normalizeMarketCode(market, code);
  const fingerprint = requestFingerprint("post_decision_review_delete", { ...normalized, checkId, reviewId, request, actor });
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const replay = await findAuditByIdempotencyKey<DecisionReviewDeletionData>(client, request.idempotencyKey, "post_decision_review_deleted");
    if (replay) return await commitReplay(client, replay, actor, fingerprint, "post_decision_review", checkId, reviewId);
    const selected = await client.query<{
      decision_check_id: string; review_id: string; stock_id: string; symbol: string; created_at: Date | string;
    }>(
      `select checks.id::text as decision_check_id, review.id::text as review_id,
              checks.stock_id::text, checks.symbol, review.created_at
         from post_decision_reviews review
         join pre_trade_decision_checks checks on checks.id = review.decision_check_id
        where checks.id = $1 and review.id = $2 and checks.market = $3 and checks.code = $4
          and checks.deleted_at is null and review.deleted_at is null
          and review.actor_type = $5 and review.actor_id is not distinct from $6
          and exists (${actorOwnsDecisionCheckSql("checks", "$5", "$6")})
        for update of review`,
      [checkId, reviewId, normalized.market, normalized.code, actor.actorType, actor.actorId]
    );
    const row = selected.rows[0];
    if (!row || !sameInstant(row.created_at, request.expectedCreatedAt)) throw new DecisionCheckNotFoundError("current exact post-decision review was not found or changed before deletion");
    const deletedAt = now.toISOString();
    const data = deletionData("post_decision_review", checkId, reviewId, row.symbol, row.created_at, deletedAt);
    await redactCreatedAudit(client, "post_decision_review_created", "post_decision_reviews", reviewId, data);
    const tombstone = await client.query(
      `update post_decision_reviews
          set outcome = 'deleted', outcome_evidence = null, review_note = null,
              raw_payload = '{"state":"deleted"}'::jsonb, portfolio_review_snapshot = null,
              deleted_at = $2, deleted_by_actor_id = $3
        where id = $1 and deleted_at is null`,
      [reviewId, now, actor.actorId]
    );
    if (tombstone.rowCount !== 1) throw new DecisionCheckNotFoundError("post-decision review changed before deletion");
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "post_decision_review_deleted", request: auditRequest,
      stock: { id: row.stock_id, ...normalized }, targetTable: "post_decision_reviews",
      targetId: reviewId, beforePayload: { decisionCheckId: checkId, reviewId, state: "active" },
      afterPayload: data, requestFingerprint: fingerprint
    });
    await client.query("commit");
    return writeEnvelope(auditRequest, data, "Post-decision review body deleted; a contentless tombstone remains.", auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) return replayAfterConflict(pool, request.idempotencyKey, "post_decision_review_deleted", actor, fingerprint, "post_decision_review", checkId, reviewId);
    throw error;
  } finally { client.release(); }
}

async function readExactDeletion(
  pool: Pick<Pool | PoolClient, "query">, market: string, code: string, checkId: string,
  reviewId: string | null, actor: AuthenticatedResearchActor
): Promise<DecisionReviewDeletionData | null> {
  const normalized = normalizeMarketCode(market, code);
  const result = reviewId === null
    ? await pool.query<DeletionRow>(
        `select checks.id::text as decision_check_id, null::text as review_id, checks.stock_id::text,
                checks.symbol, checks.checked_at as recorded_at, checks.deleted_at
           from pre_trade_decision_checks checks
          where checks.id = $1 and checks.market = $2 and checks.code = $3 and checks.deleted_at is not null
            and exists (${actorOwnsDecisionCheckSql("checks", "$4", "$5")})`,
        [checkId, normalized.market, normalized.code, actor.actorType, actor.actorId]
      )
    : await pool.query<DeletionRow>(
        `select checks.id::text as decision_check_id, review.id::text as review_id, checks.stock_id::text,
                checks.symbol, review.created_at as recorded_at, review.deleted_at
           from post_decision_reviews review
           join pre_trade_decision_checks checks on checks.id = review.decision_check_id
          where checks.id = $1 and review.id = $2 and checks.market = $3 and checks.code = $4
            and review.deleted_at is not null
            and exists (${actorOwnsDecisionCheckSql("checks", "$5", "$6")})`,
        [checkId, reviewId, normalized.market, normalized.code, actor.actorType, actor.actorId]
      );
  return result.rows[0] ? rowToDeletion({ ...result.rows[0], kind: reviewId === null ? "decision_check" : "post_decision_review" }) : null;
}

function actorOwnsDecisionCheckSql(alias: string, actorType: string, actorId: string): string {
  return `select 1 from research_write_audit_events audit
           where audit.event_type = 'decision_check_created'
             and audit.target_table = 'pre_trade_decision_checks'
             and audit.target_id = ${alias}.id::text
             and audit.actor_type = ${actorType}
             and audit.actor_id is not distinct from ${actorId}`;
}

function deletionData(
  kind: DecisionReviewDeletionData["kind"], decisionCheckId: string, reviewId: string | null,
  symbol: string, recordedAt: Date | string, deletedAt: string
): DecisionReviewDeletionData {
  return { kind, decisionCheckId, reviewId, symbol, recordedAt: new Date(recordedAt).toISOString(), deletedAt, state: "deleted" };
}

function rowToDeletion(row: DeletionRow & { kind: DecisionReviewDeletionData["kind"] }): DecisionReviewDeletionData {
  return deletionData(row.kind, String(row.decision_check_id), row.review_id == null ? null : String(row.review_id), row.symbol, row.recorded_at, new Date(row.deleted_at).toISOString());
}

function sameInstant(left: Date | string, right: string): boolean {
  return new Date(left).toISOString() === new Date(right).toISOString();
}

function requireUser(actor: AuthenticatedResearchActor): void {
  if (actor.actorType !== "user" || !actor.actorId) throw new DecisionCheckNotFoundError("deletion requires an explicit user actor");
}

async function redactCreatedAudit(
  client: PoolClient, eventType: "decision_check_created" | "post_decision_review_created",
  targetTable: "pre_trade_decision_checks" | "post_decision_reviews", targetId: string,
  data: DecisionReviewDeletionData
): Promise<void> {
  await client.query(
    `update research_write_audit_events set before_payload = null, after_payload = $4::jsonb
      where event_type = $1 and target_table = $2 and target_id = $3`,
    [eventType, targetTable, targetId, JSON.stringify(data)]
  );
}

function replayMatches(
  replay: ResearchWriteAuditReplay<DecisionReviewDeletionData>, actor: AuthenticatedResearchActor,
  fingerprint: string, kind: DecisionReviewDeletionData["kind"], checkId: string, reviewId: string | null
): boolean {
  const data = replay.envelope.data;
  return sameResearchWriteActor(replay.envelope, actorRequest(actor, ""))
    && replay.requestFingerprint === fingerprint && data.kind === kind
    && data.decisionCheckId === checkId && data.reviewId === reviewId && data.state === "deleted";
}

async function commitReplay(
  client: PoolClient, replay: ResearchWriteAuditReplay<DecisionReviewDeletionData>, actor: AuthenticatedResearchActor,
  fingerprint: string, kind: DecisionReviewDeletionData["kind"], checkId: string, reviewId: string | null
): Promise<ResearchWriteEnvelope<DecisionReviewDeletionData>> {
  if (!replayMatches(replay, actor, fingerprint, kind, checkId, reviewId)) throw new IdempotencyConflictError();
  await client.query("commit");
  return replay.envelope;
}

async function replayAfterConflict(
  pool: Pool, idempotencyKey: string, eventType: "decision_check_deleted" | "post_decision_review_deleted",
  actor: AuthenticatedResearchActor, fingerprint: string, kind: DecisionReviewDeletionData["kind"],
  checkId: string, reviewId: string | null
): Promise<ResearchWriteEnvelope<DecisionReviewDeletionData>> {
  const replay = await findAuditByIdempotencyKey<DecisionReviewDeletionData>(pool, idempotencyKey, eventType);
  if (replay && replayMatches(replay, actor, fingerprint, kind, checkId, reviewId)) return replay.envelope;
  throw new IdempotencyConflictError();
}
