import type { Pool } from "pg";
import type {
  CandidateMembershipWriteEnvelope,
  CreateCandidateMembershipRequest,
  UpdateCandidateMembershipStateRequest
} from "../../../../packages/contracts/src/candidateMembership.js";
import { normalizeMarketCode } from "../market/freshness.js";
import {
  CandidateMembershipConflictError,
  CandidateMembershipNotFoundError,
  CandidateMembershipVersionConflictError,
  type AuthenticatedResearchActor
} from "./domain.js";
import { type CandidateMembershipRow, rowToCandidateMembership } from "./candidateMembershipMappers.js";
import {
  candidateMembershipCorrelationId,
  candidateMembershipFingerprint,
  candidateMembershipWriteEnvelope,
  findCandidateMembershipAudit,
  findCandidateMembershipByIdForUpdate,
  findCandidateMembershipForUpdate,
  insertCandidateMembershipAudit,
  readCandidateMembershipById,
  sameCandidateMembershipAuditReplay
} from "./candidateMembershipPersistence.js";
import { isUniqueViolation } from "./writePersistence.js";

export async function createCandidateMembership(
  pool: Pool,
  request: CreateCandidateMembershipRequest,
  actor: AuthenticatedResearchActor,
  liveMaxAgeSeconds: number
): Promise<CandidateMembershipWriteEnvelope> {
  return createCandidateMembershipAttempt(pool, request, actor, liveMaxAgeSeconds, true);
}

async function createCandidateMembershipAttempt(
  pool: Pool,
  request: CreateCandidateMembershipRequest,
  actor: AuthenticatedResearchActor,
  liveMaxAgeSeconds: number,
  retryOnUniqueViolation: boolean
): Promise<CandidateMembershipWriteEnvelope> {
  const normalized = normalizeMarketCode(request.market, request.code);
  const targetState = request.initialState ?? "tracked";
  const correlationId = candidateMembershipCorrelationId(actor, request.idempotencyKey);
  const fingerprint = candidateMembershipFingerprint({
    operation: "create",
    market: normalized.market,
    code: normalized.code,
    state: targetState,
    restoreArchived: request.restoreArchived === true,
    actor
  });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const replay = await findCandidateMembershipAudit(client, actor, request.idempotencyKey);
    if (replay) {
      if (replay.request_fingerprint !== fingerprint || !sameCandidateMembershipAuditReplay(replay, actor, correlationId)) {
        throw new CandidateMembershipConflictError("idempotency key already used with a different candidate-membership request");
      }
      await client.query("commit");
      return candidateMembershipWriteEnvelope(replay.result, replay.audit_event_id, replay.after_payload, actor, replay.correlation_id, "Idempotent candidate membership write already recorded.");
    }

    const existing = await findCandidateMembershipForUpdate(client, actor, normalized.market, normalized.code);
    if (existing && existing.state === "archived" && request.restoreArchived !== true) {
      throw new CandidateMembershipConflictError("archived membership already exists; set restoreArchived true to restore it");
    }
    if (existing && existing.state !== "archived") {
      const joined = await readCandidateMembershipById(client, actor, existing.id);
      const data = rowToCandidateMembership(joined ?? existing, liveMaxAgeSeconds, new Date());
      const auditId = await insertCandidateMembershipAudit(client, {
        eventType: "membership_already_exists",
        actor,
        membership: existing,
        idempotencyKey: request.idempotencyKey,
        requestFingerprint: fingerprint,
        beforePayload: data,
        afterPayload: data,
        result: "already_exists",
        correlationId
      });
      await client.query("commit");
      return candidateMembershipWriteEnvelope("already_exists", auditId, data, actor, correlationId, `Candidate membership ${normalized.symbol} already exists.`);
    }
    if (existing && existing.state === "archived") {
      const beforeRow = await readCandidateMembershipById(client, actor, existing.id) ?? existing;
      const restored = await client.query<CandidateMembershipRow>(
        `update candidate_memberships
            set state = $1, version = version + 1, updated_at = now(), archived_at = null
          where id = $2
          returning id, actor_type, actor_id, market, code, symbol, state, version, created_at, updated_at, archived_at,
                    null::text as name, null::timestamptz as research_updated_at,
                    null::text as quote_provider, null::timestamptz as quote_time, null::timestamptz as quote_fetched_at`,
        [targetState, existing.id]
      );
      const afterRow = await readCandidateMembershipById(client, actor, restored.rows[0].id) ?? restored.rows[0];
      const after = rowToCandidateMembership(afterRow, liveMaxAgeSeconds, new Date());
      const auditId = await insertCandidateMembershipAudit(client, {
        eventType: "membership_restored",
        actor,
        membership: restored.rows[0],
        idempotencyKey: request.idempotencyKey,
        requestFingerprint: fingerprint,
        beforePayload: rowToCandidateMembership(beforeRow, liveMaxAgeSeconds, new Date()),
        afterPayload: after,
        result: "restored",
        correlationId
      });
      await client.query("commit");
      return candidateMembershipWriteEnvelope("restored", auditId, after, actor, correlationId, `Candidate membership ${normalized.symbol} restored.`);
    }

    const inserted = await client.query<CandidateMembershipRow>(
      `insert into candidate_memberships (actor_type, actor_id, market, code, symbol, state, archived_at)
       values ($1, $2, $3, $4, $5, $6, case when $6 = 'archived' then now() else null end)
       returning id, actor_type, actor_id, market, code, symbol, state, version, created_at, updated_at, archived_at,
                 null::text as name, null::timestamptz as research_updated_at,
                 null::text as quote_provider, null::timestamptz as quote_time, null::timestamptz as quote_fetched_at`,
      [actor.actorType, actor.actorId, normalized.market, normalized.code, normalized.symbol, targetState]
    );
    const afterRow = await readCandidateMembershipById(client, actor, inserted.rows[0].id) ?? inserted.rows[0];
    const after = rowToCandidateMembership(afterRow, liveMaxAgeSeconds, new Date());
    const auditId = await insertCandidateMembershipAudit(client, {
      eventType: "membership_created",
      actor,
      membership: inserted.rows[0],
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: fingerprint,
      beforePayload: null,
      afterPayload: after,
      result: "created",
      correlationId
    });
    await client.query("commit");
    return candidateMembershipWriteEnvelope("created", auditId, after, actor, correlationId, `Candidate membership ${normalized.symbol} created.`);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error) && retryOnUniqueViolation) {
      return createCandidateMembershipAttempt(pool, request, actor, liveMaxAgeSeconds, false);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updateCandidateMembershipState(
  pool: Pool,
  membershipId: string,
  request: UpdateCandidateMembershipStateRequest,
  actor: AuthenticatedResearchActor,
  liveMaxAgeSeconds: number
): Promise<CandidateMembershipWriteEnvelope> {
  return updateCandidateMembershipStateAttempt(pool, membershipId, request, actor, liveMaxAgeSeconds, true);
}

async function updateCandidateMembershipStateAttempt(
  pool: Pool,
  membershipId: string,
  request: UpdateCandidateMembershipStateRequest,
  actor: AuthenticatedResearchActor,
  liveMaxAgeSeconds: number,
  retryOnUniqueViolation: boolean
): Promise<CandidateMembershipWriteEnvelope> {
  if (!/^\d+$/.test(membershipId)) throw new CandidateMembershipNotFoundError("candidate membership id is malformed");
  const correlationId = candidateMembershipCorrelationId(actor, request.idempotencyKey);
  const fingerprint = candidateMembershipFingerprint({ operation: "state", membershipId, state: request.state, version: request.version, actor });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const replay = await findCandidateMembershipAudit(client, actor, request.idempotencyKey);
    if (replay) {
      if (replay.request_fingerprint !== fingerprint || !sameCandidateMembershipAuditReplay(replay, actor, correlationId)) {
        throw new CandidateMembershipConflictError("idempotency key already used with a different candidate-membership state request");
      }
      await client.query("commit");
      return candidateMembershipWriteEnvelope(replay.result, replay.audit_event_id, replay.after_payload, actor, replay.correlation_id, "Idempotent candidate membership write already recorded.");
    }
    const current = await findCandidateMembershipByIdForUpdate(client, actor, membershipId);
    if (!current) throw new CandidateMembershipNotFoundError();
    if (Number(current.version) !== request.version) throw new CandidateMembershipVersionConflictError();
    if (current.state === request.state) {
      const joined = await readCandidateMembershipById(client, actor, current.id);
      const data = rowToCandidateMembership(joined ?? current, liveMaxAgeSeconds, new Date());
      const auditId = await insertCandidateMembershipAudit(client, {
        eventType: "membership_state_unchanged",
        actor,
        membership: current,
        idempotencyKey: request.idempotencyKey,
        requestFingerprint: fingerprint,
        beforePayload: data,
        afterPayload: data,
        result: "unchanged",
        correlationId
      });
      await client.query("commit");
      return candidateMembershipWriteEnvelope("unchanged", auditId, data, actor, correlationId, `Candidate membership ${current.symbol} already has state ${request.state}.`);
    }
    const beforeRow = await readCandidateMembershipById(client, actor, current.id) ?? current;
    const updated = await client.query<CandidateMembershipRow>(
      `update candidate_memberships
          set state = $1, version = version + 1, updated_at = now(),
              archived_at = case when $1 = 'archived' then now() else null end
        where id = $2 and actor_type = $3 and actor_id = $4
        returning id, actor_type, actor_id, market, code, symbol, state, version, created_at, updated_at, archived_at,
                  null::text as name, null::timestamptz as research_updated_at,
                  null::text as quote_provider, null::timestamptz as quote_time, null::timestamptz as quote_fetched_at`,
      [request.state, current.id, actor.actorType, actor.actorId]
    );
    const afterRow = await readCandidateMembershipById(client, actor, updated.rows[0].id) ?? updated.rows[0];
    const after = rowToCandidateMembership(afterRow, liveMaxAgeSeconds, new Date());
    const auditId = await insertCandidateMembershipAudit(client, {
      eventType: "membership_state_changed",
      actor,
      membership: updated.rows[0],
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: fingerprint,
      beforePayload: rowToCandidateMembership(beforeRow, liveMaxAgeSeconds, new Date()),
      afterPayload: after,
      result: "state_changed",
      correlationId
    });
    await client.query("commit");
    return candidateMembershipWriteEnvelope("state_changed", auditId, after, actor, correlationId, `Candidate membership ${current.symbol} moved to ${request.state}.`);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error) && retryOnUniqueViolation) {
      return updateCandidateMembershipStateAttempt(pool, membershipId, request, actor, liveMaxAgeSeconds, false);
    }
    throw error;
  } finally {
    client.release();
  }
}
