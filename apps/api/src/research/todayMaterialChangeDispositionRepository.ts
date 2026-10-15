import type { Pool } from "pg";
import {
  validateTodayMaterialChangeDispositionData,
  type TodayActionInboxItem,
  type TodayMaterialChangeDispositionData,
  type TodayMaterialChangeDispositionRequest,
  type TodayMaterialChangeDispositionWrite
} from "../../../../packages/contracts/src/todayActionInbox.js";
import { requestFingerprint } from "./deepResearchGate.js";
import {
  CandidateMembershipConflictError,
  IdempotencyConflictError,
  type AuthenticatedResearchActor
} from "./domain.js";
import { assertCandidateMembershipWriteBinding, sameBoundResearchWriteReplay } from "./researchWriteBinding.js";
import {
  actorRequest,
  findAuditByIdempotencyKey,
  insertWriteAudit,
  isUniqueViolation,
  readExistingResearchProfileBinding,
  upsertStock,
  writeEnvelope
} from "./writePersistence.js";

const EVENT_TYPE = "today_material_change_dispositioned";

export async function readTodayMaterialChangeDispositions(
  pool: Pick<Pool, "query">,
  actor: AuthenticatedResearchActor
): Promise<Map<string, TodayMaterialChangeDispositionData>> {
  const result = await pool.query<{ after_payload: TodayMaterialChangeDispositionData }>(
    `select distinct on (after_payload->>'itemId') after_payload
       from research_write_audit_events
      where event_type = $1 and actor_type = $2 and actor_id = $3
      order by after_payload->>'itemId', created_at desc, id desc`,
    [EVENT_TYPE, actor.actorType, actor.actorId]
  );
  const dispositions = new Map<string, TodayMaterialChangeDispositionData>();
  for (const row of result.rows) {
    const data = Object.prototype.hasOwnProperty.call(row.after_payload, "snoozedUntil")
      ? row.after_payload
      : { ...row.after_payload, snoozedUntil: null };
    if (!validateTodayMaterialChangeDispositionData(data).ok) {
      throw new Error("stored Today action disposition is malformed");
    }
    dispositions.set(data.itemId, data);
  }
  return dispositions;
}

export async function writeTodayMaterialChangeDisposition(
  pool: Pool,
  request: TodayMaterialChangeDispositionRequest,
  item: TodayActionInboxItem,
  actor: AuthenticatedResearchActor,
  now = new Date()
): Promise<TodayMaterialChangeDispositionWrite> {
  if (actor.actorType !== "user") throw new CandidateMembershipConflictError("an explicit user actor is required");
  const fingerprint = requestFingerprint("today_material_change_disposition", { actor, request });
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const membership = await assertCandidateMembershipWriteBinding(client, actor, {
      membershipId: item.membership.id,
      membershipVersion: request.membershipVersion
    });
    const replay = await findAuditByIdempotencyKey<TodayMaterialChangeDispositionData>(client, request.idempotencyKey, EVENT_TYPE);
    if (replay) {
      if (!sameBoundResearchWriteReplay(replay, actor, {
        membershipId: item.membership.id,
        membershipVersion: request.membershipVersion
      }, fingerprint)) throw idempotencyConflict();
      await client.query("commit");
      return replay.envelope;
    }
    const prior = (await readTodayMaterialChangeDispositions(client, actor)).get(request.itemId) ?? null;
    if (prior?.state === "resolved" && request.state !== "new") {
      throw new CandidateMembershipConflictError("resolved material change must be explicitly reopened before another disposition");
    }
    if (prior?.state === request.state && (request.state !== "later" || prior.snoozedUntil === request.snoozedUntil)) {
      throw new CandidateMembershipConflictError(`material change is already ${request.state}; refresh before writing again`);
    }
    if (prior === null && request.state === "new") {
      throw new CandidateMembershipConflictError("Today action is already new; refresh before writing again");
    }
    if (request.state === "later") {
      const snoozedUntil = Date.parse(request.snoozedUntil ?? "");
      if (!Number.isFinite(snoozedUntil) || snoozedUntil <= now.getTime() || snoozedUntil > now.getTime() + 365 * 86_400_000) {
        throw new CandidateMembershipConflictError("snoozedUntil must be a future instant within 365 days");
      }
    }
    const binding = await readExistingResearchProfileBinding(client, membership.market, membership.code, membership.symbol);
    const stock = binding?.stock ?? await upsertStock(client, membership.market, membership.code, membership.symbol, null);
    const sourceVersion = item.source.version;
    const sourceFingerprint = item.source.sourceFingerprint;
    if (item.kind === "source_failure" || sourceFingerprint === null) {
      throw new CandidateMembershipConflictError("Today action source identity is incomplete");
    }
    const data: TodayMaterialChangeDispositionData = {
      itemId: request.itemId,
      membershipId: item.membership.id,
      membershipVersion: request.membershipVersion,
      symbol: item.symbol,
      sourceId: item.source.id,
      sourceVersion,
      sourceFingerprint,
      state: request.state,
      snoozedUntil: request.snoozedUntil,
      stateChangedAt: now.toISOString(),
      stateReason: request.state === "later"
        ? `Owner explicitly deferred this Today action until ${request.snoozedUntil}.`
        : request.state === "new"
          ? "Owner explicitly returned this Today action to Today."
        : "Owner explicitly marked this Today action as handled."
    };
    const auditAsOf = await insertWriteAudit(client, {
      eventType: EVENT_TYPE,
      request: auditRequest,
      stock,
      targetTable: "today_action_inbox_items",
      targetId: request.itemId,
      beforePayload: prior,
      afterPayload: data,
      requestFingerprint: fingerprint,
      candidateMembershipId: item.membership.id,
      candidateMembershipVersion: request.membershipVersion
    });
    await client.query("commit");
    return writeEnvelope(auditRequest, data, `Today action marked ${request.state}.`, auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findAuditByIdempotencyKey<TodayMaterialChangeDispositionData>(pool, request.idempotencyKey, EVENT_TYPE);
      if (replay && sameBoundResearchWriteReplay(replay, actor, {
        membershipId: item.membership.id,
        membershipVersion: request.membershipVersion
      }, fingerprint)) return replay.envelope;
      throw idempotencyConflict();
    }
    throw error;
  } finally {
    client.release();
  }
}

function idempotencyConflict(): IdempotencyConflictError {
  return new IdempotencyConflictError("idempotency key already exists with different Today action disposition semantics");
}
