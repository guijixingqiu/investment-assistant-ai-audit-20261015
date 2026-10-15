import type { Pool, PoolClient } from "pg";
import {
  CLOUD_AI_POLICY_SCHEMA_VERSION,
  CLOUD_AI_PROVIDER_POLICY,
  CLOUD_AI_PROVIDER_POLICY_VERSION,
  cloudAiSendAuthorizationSnapshot,
  cloudAiPolicySafety,
  type CloudAiPolicyDecisionRequest,
  type CloudAiPolicyEnvelope,
  type CloudAiPolicyState,
  type CloudAiSendAuthorizationSnapshot
} from "../../../../packages/contracts/src/cloudAiPolicy.js";
import { requestFingerprint } from "./deepResearchGate.js";
import { IdempotencyConflictError, type AuthenticatedResearchActor } from "./domain.js";
import { isUniqueViolation } from "./writePersistence.js";

interface PolicyEventRow {
  action: "enable" | "disable" | "request_deletion";
  policy_version: string;
  backup_provider: "none" | null;
  request_fingerprint: string;
  created_at: Date | string;
}

export async function readCloudAiPolicyEnvelope(
  pool: Pick<Pool | PoolClient, "query">,
  actor: AuthenticatedResearchActor,
  now = new Date()
): Promise<CloudAiPolicyEnvelope> {
  const rows = await pool.query<PolicyEventRow>(
    `select action, policy_version, backup_provider, request_fingerprint, created_at
       from cloud_ai_provider_policy_events
      where actor_type = $1 and actor_id = $2
      order by created_at desc, id desc`,
    [actor.actorType, actor.actorId]
  );
  const events = rows.rows;
  const latest = events[0] ?? null;
  const confirmation = events.find((event) => event.action === "enable") ?? null;
  const deletion = events.find((event) => event.action === "request_deletion") ?? null;
  const state: CloudAiPolicyState = {
    actorId: actor.actorId,
    status: deletion ? "disabled"
      : latest?.action === "enable" && latest.policy_version === CLOUD_AI_PROVIDER_POLICY_VERSION && latest.backup_provider === "none"
      ? "enabled"
      : latest ? "disabled" : "needs_confirmation",
    confirmedPolicyVersion: confirmation?.policy_version ?? null,
    confirmedBackupProvider: confirmation?.backup_provider ?? null,
    confirmedAt: confirmation ? new Date(confirmation.created_at).toISOString() : null,
    revokedAt: deletion
      ? new Date(deletion.created_at).toISOString()
      : latest && latest.action !== "enable" ? new Date(latest.created_at).toISOString() : null,
    deletionRequest: deletion ? {
      status: "requested_unconfirmed",
      requestedAt: new Date(deletion.created_at).toISOString()
    } : { status: "not_requested", requestedAt: null }
  };
  if (latest?.action === "enable" && (latest.policy_version !== CLOUD_AI_PROVIDER_POLICY_VERSION || latest.backup_provider !== "none")) {
    state.status = "needs_confirmation";
  }
  return envelope(actor.actorId, state, now, deletion
    ? "Cloud AI deletion was requested; no new provider request or re-enable is allowed."
    : state.status === "enabled"
      ? "Cloud AI is enabled under the current Owner-confirmed policy."
    : state.status === "disabled"
      ? "Cloud AI is disabled; no new provider request is allowed."
      : "Cloud AI requires explicit Owner confirmation of the current provider policy.");
}

export async function cloudAiPolicyIsEnabled(
  pool: Pick<Pool | PoolClient, "query">,
  actor: AuthenticatedResearchActor
): Promise<boolean> {
  return cloudAiSendAuthorizationSnapshot((await readCloudAiPolicyEnvelope(pool, actor)).state) !== null;
}

export async function withCloudAiPolicySendAuthorization<T>(
  pool: Pool,
  actor: AuthenticatedResearchActor,
  send: (authorization?: CloudAiSendAuthorizationSnapshot) => Promise<T>
): Promise<T | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await lockCloudAiPolicy(client, actor);
    const authorization = cloudAiSendAuthorizationSnapshot(
      (await readCloudAiPolicyEnvelope(client, actor)).state
    );
    if (!authorization) {
      await client.query("rollback");
      return null;
    }
    const result = await send(authorization);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordCloudAiPolicyDecision(
  pool: Pool,
  request: CloudAiPolicyDecisionRequest,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  retryConcurrentConflict = true
): Promise<CloudAiPolicyEnvelope> {
  if (actor.actorType !== "user") throw new IdempotencyConflictError("cloud AI policy decisions require an explicit user actor");
  const { idempotencyKey, ...decision } = request;
  const fingerprint = requestFingerprint("cloud_ai_policy_decision", { actor, decision });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await lockCloudAiPolicy(client, actor);
    const replay = await client.query<PolicyEventRow>(
      `select action, policy_version, backup_provider, request_fingerprint, created_at
         from cloud_ai_provider_policy_events
        where actor_type = $1 and actor_id = $2 and idempotency_key = $3
        limit 1`,
      [actor.actorType, actor.actorId, idempotencyKey]
    );
    if (replay.rows[0]?.request_fingerprint !== undefined
      && replay.rows[0].request_fingerprint !== fingerprint) {
      throw new IdempotencyConflictError("idempotency key already used for another cloud AI policy decision");
    }
    if (!replay.rows[0]) {
      const current = await readCloudAiPolicyEnvelope(client, actor, now);
      if (request.action === "enable" && current.state?.deletionRequest.status === "requested_unconfirmed") {
        throw new IdempotencyConflictError("Cloud AI cannot be re-enabled after deletion was requested");
      }
      await client.query(
        `insert into cloud_ai_provider_policy_events
          (actor_type, actor_id, provider, model, policy_version, backup_provider, action,
           request_fingerprint, idempotency_key, created_at)
         values ($1, $2, 'deepseek', 'deepseek-flash', $3, $4, $5, $6, $7, $8)`,
        [actor.actorType, actor.actorId, request.policyVersion, request.backupProvider, request.action, fingerprint, idempotencyKey, now]
      );
    }
    const result = await readCloudAiPolicyEnvelope(client, actor, now);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    if (retryConcurrentConflict && isUniqueViolation(error)) {
      return recordCloudAiPolicyDecision(pool, request, actor, now, false);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function lockCloudAiPolicy(
  client: Pick<PoolClient, "query">,
  actor: AuthenticatedResearchActor
): Promise<void> {
  // ponytail: one per-Owner DB lock is enough for this low-frequency send lane; split only after measured contention.
  await client.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
    `cloud-ai-policy:${actor.actorType}`,
    actor.actorId
  ]);
}

export function unavailableCloudAiPolicyEnvelope(
  status: "unauthorized" | "unavailable",
  actorId: string,
  message: string,
  now = new Date()
): CloudAiPolicyEnvelope {
  return {
    schemaVersion: CLOUD_AI_POLICY_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    status,
    requestedActorId: actorId,
    policy: CLOUD_AI_PROVIDER_POLICY,
    state: null,
    message,
    safety: cloudAiPolicySafety()
  };
}

function envelope(actorId: string, state: CloudAiPolicyState, now: Date, message: string): CloudAiPolicyEnvelope {
  return {
    schemaVersion: CLOUD_AI_POLICY_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    status: "available",
    requestedActorId: actorId,
    policy: CLOUD_AI_PROVIDER_POLICY,
    state,
    message,
    safety: cloudAiPolicySafety()
  };
}
