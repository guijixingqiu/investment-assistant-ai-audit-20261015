import { deepResearchPackBinding } from "../../../../packages/contracts/src/limitedResearch.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  validateDeepResearchTaskSendManifest,
  type DeepResearchTaskData,
  type CreateDeepResearchTaskRequest,
  type DeepResearchTaskEnvelope
} from "../../../../packages/contracts/src/deepResearchTask.js";
import {
  DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
  validateDeepResearchSynthesisProviderPayload,
  validateDeepResearchSynthesisReproducibility
} from "../../../../packages/contracts/src/deepResearchSynthesisReport.js";
import {
  type ResearchEvidencePackData
} from "../../../../packages/contracts/src/deepResearch.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import {
  deepResearchProviderAuthorizationIsConfirmed,
  validateDeepResearchSnapshotData,
  type DeepResearchSnapshotData
} from "../../../../packages/contracts/src/deepResearchSnapshot.js";
import {
  deepResearchProviderAuthorizationMatches,
  computedEvidencePackFingerprint,
  requestFingerprint
} from "./deepResearchGate.js";
import {
  readEvidencePack,
  readEvidencePackInvalidatedBy,
  readLatestEvidencePack
} from "./deepResearchPersistence.js";
import { readDeepResearchWorkspace } from "./deepResearchReadRepository.js";
import {
  deepResearchPriorReportEligibleForModelContext,
  deepResearchPriorReportMatchesLatest
} from "./deepResearchSnapshotAssembler.js";
import { readCurrentResearchMonitorRules } from "./researchProfileReadRepository.js";
import { cloudAiPolicyIsEnabled } from "./cloudAiPolicyRepository.js";
import { DeepResearchGateError, IdempotencyConflictError } from "./domain.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { assertCandidateMembershipWriteBinding, sameBoundResearchWriteReplay } from "./researchWriteBinding.js";
import {
  actorRequest,
  findAuditByIdempotencyKey,
  insertWriteAudit,
  isUniqueViolation,
  ensureResearchProfile,
  upsertStock
} from "./writePersistence.js";
import {
  emptyTaskEnvelope,
  rowToTask,
  storedTaskPayload,
  taskEnvelope,
  taskSelect,
  validateStoredRequest,
  type DeepResearchTaskRow,
  type CancelableDeepResearchTask,
  type RetryableDeepResearchTask,
  type StoredDeepResearchSynthesis,
  type StoredDeepResearchTask
} from "./deepResearchTaskMappers.js";
export { emptyTaskEnvelope, rowToTask, taskSelect } from "./deepResearchTaskMappers.js";
export type {
  CancelableDeepResearchTask,
  RetryableDeepResearchTask,
  StoredDeepResearchSynthesis,
  StoredDeepResearchTask
} from "./deepResearchTaskMappers.js";
// ponytail: covers the current 60s provider ceiling plus 60s snapshot/persistence margin; derive from intent if the ceiling grows.
export const DEEP_RESEARCH_TASK_LEASE_MILLISECONDS = 120_000;
export interface ClaimedDeepResearchTask {
  data: DeepResearchTaskData;
  request: unknown;
  snapshot: DeepResearchSnapshotData | null;
  actor: AuthenticatedResearchActor;
  claimToken: string;
}
// eslint-disable-next-line complexity -- one transactional enqueue boundary; splitting would duplicate locks.
export async function enqueueDeepResearchTask(
  pool: Pool,
  membershipId: string,
  request: CreateDeepResearchTaskRequest,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  expectedRetryTaskId: string | null = null,
  retryConcurrentConflict = true,
  sourceStore?:import("./researchSourceSnapshotRepository.js").SourceSnapshotStoreOptions
): Promise<DeepResearchTaskEnvelope> {
  const { idempotencyKey, ...reportInput } = request;
  const boundRequest = { ...reportInput, membershipId };
  const fingerprint = requestFingerprint("deep_research_task_enqueue", { boundRequest, actor });
  const auditRequest = actorRequest(actor, idempotencyKey);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const replay = await findAuditByIdempotencyKey<DeepResearchTaskData>(
      client,
      idempotencyKey,
      "deep_research_task_enqueued"
    );
    if (replay && !sameBoundResearchWriteReplay(replay, actor, boundRequest, fingerprint)) {
      throw new IdempotencyConflictError("idempotency key already used with a different deep-research task");
    }
    if (!await cloudAiPolicyIsEnabled(client, actor)) {
      throw new DeepResearchGateError("cloud AI provider is disabled or requires current Owner confirmation");
    }
    if (replay) {
      const current = await readTaskRow(client, replay.envelope.data.id, actor);
      if (!current) throw new IdempotencyConflictError("task replay no longer resolves its stored task");
      if (expectedRetryTaskId
        && current.id !== expectedRetryTaskId
        && current.previousTaskId !== expectedRetryTaskId) {
        throw new IdempotencyConflictError("retry idempotency key resolves another deep-research task");
      }
      await client.query("commit");
      return taskEnvelope(current, actor.actorId, now, "Existing deep-research task replayed.");
    }
    const membership = await assertCandidateMembershipWriteBinding(client, actor, boundRequest);
    const stock = await upsertStock(client, membership.market, membership.code, membership.symbol, null);
    const profileId = await ensureResearchProfile(client, stock);
    const pack = await readEvidencePack(client, request.evidencePackId, profileId, now);
    const latestPack = await readLatestEvidencePack(
      client, profileId, membershipId, request.membershipVersion, now
    );
    const invalidatedBy = pack ? await readEvidencePackInvalidatedBy(
      client,
      profileId,
      pack,
      actor,
      {
        id: membershipId,
        version: request.membershipVersion,
        state: membership.state,
        market: membership.market,
        code: membership.code,
        symbol: membership.symbol
      },
      now,
      undefined,
      undefined,
      sourceStore
    ) : [];
    if (!pack || !latestPack || latestPack.id !== pack.id
      || latestPack.packFingerprint !== pack.packFingerprint
      || invalidatedBy.length > 0
      || !deepResearchTaskEvidencePackBindingMatches(request, pack)) {
      throw new DeepResearchGateError("deep-research task evidence pack binding is not exact");
    }
    const monitorRules = await readCurrentResearchMonitorRules(client, membershipId, actor);
    if (!deepResearchTaskIntentMatchesPack(request, pack, monitorRules)) {
      throw new DeepResearchGateError("deep-research task intent is outside the exact evidence pack");
    }
    if (request.intent.priorReport) {
      const workspace = await readDeepResearchWorkspace(client, membershipId, actor, now, {
        accountScopeId: null,
        currentPortfolioEnabled: false,
        currentPortfolioMaxAgeSeconds: 300,
        enforceCurrentHoldingBindings: false,
        sourceStore
      });
      const currentPack = workspace.status === "available" ? workspace.data?.latestPack : null;
      const latestReport = workspace.data?.latestReport ?? null;
      if (!currentPack
        || currentPack.id !== pack.id
        || currentPack.packFingerprint !== pack.packFingerprint
        || !deepResearchPriorReportMatchesLatest(
          latestReport,
          request.intent.priorReport,
          currentPack
        )) {
        throw new DeepResearchGateError("deep-research prior report identity is not exact");
      }
      if (!deepResearchPriorReportEligibleForModelContext(latestReport, workspace.data?.userDecision ?? null)) {
        throw new DeepResearchGateError("selected prior report is incomplete, gate-failed or rejected");
      }
    }
    let task = await readTaskByFingerprint(client, membershipId, request.membershipVersion, request.evidencePackId, fingerprint, actor);
    const active = await client.query<{ id: string }>(
      `select id::text as id from deep_research_tasks
        where candidate_membership_id = $1 and candidate_membership_version = $2
          and evidence_pack_id = $3 and actor_type = $4 and actor_id = $5
          and status in ('pending', 'running', 'ready_to_absorb')
          and request_fingerprint <> $6
        limit 1`,
      [membershipId, request.membershipVersion, request.evidencePackId, actor.actorType, actor.actorId, fingerprint]
    );
    if (active.rows[0]) {
      throw new DeepResearchGateError("finish or cancel the existing active task before starting another intent for this evidence pack");
    }
    const retryableTask = task && deepResearchTaskFailureIsRetryable(task) ? task : null;
    const canceledTask = task?.status === "canceled" ? task : null;
    if (expectedRetryTaskId && (!retryableTask || retryableTask.id !== expectedRetryTaskId)) {
      throw new DeepResearchGateError("the exact failed task is no longer retryable");
    }
    if (retryableTask || canceledTask) {
      const resumedTask = retryableTask ?? canceledTask!;
      const retried = await client.query<DeepResearchTaskRow>(
        `insert into deep_research_tasks
          (candidate_membership_id, candidate_membership_version, evidence_pack_id,
           evidence_pack_fingerprint, request_fingerprint, actor_type, actor_id,
           previous_task_id, request_payload, generation_method, model_usage, created_at, updated_at)
         select candidate_membership_id, candidate_membership_version, evidence_pack_id,
                evidence_pack_fingerprint, request_fingerprint, actor_type, actor_id, id,
                case when status = 'canceled'
                  then jsonb_build_object('request', $2::jsonb, 'snapshot', null, 'synthesis', null)
                  else jsonb_set(request_payload, '{request}', $2::jsonb, true) - 'synthesis' - 'attemptManifest' - 'sendReceipt' end,
                generation_method, 'UNKNOWN', $3, $3
           from deep_research_tasks
          where id = $1 and status = $4
         returning *, null::integer as report_version,
                   null::bigint as report_evidence_pack_id,
                   null::text as report_fingerprint`,
        [resumedTask.id, JSON.stringify(request), now, resumedTask.status]
      );
      task = rowToTask(retried.rows[0]);
    }
    if (!task) {
      const previous = await client.query<{ id: string }>(
        `select id::text as id from deep_research_tasks
          where candidate_membership_id = $1 and candidate_membership_version = $2
            and evidence_pack_id = $3 and actor_type = $4 and actor_id = $5
          order by updated_at desc, id desc
          limit 1`,
        [membershipId, request.membershipVersion, request.evidencePackId, actor.actorType, actor.actorId]
      );
      const inserted = await client.query<DeepResearchTaskRow>(
        `insert into deep_research_tasks
          (candidate_membership_id, candidate_membership_version, evidence_pack_id,
           evidence_pack_fingerprint, request_fingerprint,
           actor_type, actor_id, previous_task_id, request_payload, generation_method, model_usage)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
                 'deepseek_chat_completions_selected_snapshot', 'UNKNOWN')
         returning *, null::integer as report_version,
                   null::bigint as report_evidence_pack_id,
                   null::text as report_fingerprint`,
        [
          membershipId,
          request.membershipVersion,
          request.evidencePackId,
          request.evidencePackBinding.fingerprint,
          fingerprint,
          actor.actorType,
          actor.actorId,
          previous.rows[0]?.id ?? null,
          JSON.stringify({ request, snapshot: null, synthesis: null })
        ]
      );
      task = rowToTask(inserted.rows[0]);
    }
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "deep_research_task_enqueued",
      request: auditRequest,
      stock,
      targetTable: "deep_research_tasks",
      targetId: task.id,
      beforePayload: retryableTask ?? canceledTask,
      afterPayload: task,
      requestFingerprint: fingerprint,
      candidateMembershipId: membershipId,
      candidateMembershipVersion: request.membershipVersion
    });
    await client.query("commit");
    return taskEnvelope(
      task,
      actor.actorId,
      new Date(auditAsOf),
      retryableTask || canceledTask
        ? `${canceledTask ? "Canceled task" : "Failed task"} explicitly restarted.`
        : "Deep-research task is durable and queued."
    );
  } catch (error) {
    await client.query("rollback");
    if (retryConcurrentConflict && isUniqueViolation(error)) {
      const replay = await findAuditByIdempotencyKey<DeepResearchTaskData>(pool, idempotencyKey, "deep_research_task_enqueued");
      if (replay && sameBoundResearchWriteReplay(replay, actor, boundRequest, fingerprint)) {
        return enqueueDeepResearchTask(pool, membershipId, request, actor, now, expectedRetryTaskId, false);
      }
      throw new IdempotencyConflictError("idempotency key already used by another research write");
    }
    throw error;
  } finally {
    client.release();
  }
}

export function deepResearchTaskEvidencePackBindingMatches(
  request: CreateDeepResearchTaskRequest,
  pack: ResearchEvidencePackData
): boolean {
  return request.evidencePackId === pack.id
    && computedEvidencePackFingerprint(pack) === pack.packFingerprint
    && canonicalJson(request.evidencePackBinding)
      === canonicalJson(deepResearchPackBinding(pack));
}
export function deepResearchTaskIntentMatchesPack(
  request: CreateDeepResearchTaskRequest,
  pack: ResearchEvidencePackData,
  monitorRules: NonNullable<CreateDeepResearchTaskRequest["intent"]["monitorRules"]>
): boolean {
  const selected = request.intent.selectedMaterialIds;
  const available = new Set(pack.items.map((item) => item.id));
  const providerMethod = pack.frozenResearchContext?.selectedValuationMethods
    ?.find((entry) => entry.basisKind === "provider");
  const providerSourceId = providerMethod?.basisKind === "provider"
    ? providerMethod.scenario.providerBasis.sourceMaterialId : null;
  const fcffMethod = pack.frozenResearchContext?.selectedValuationMethods
    ?.find((entry) => entry.basisKind === "fcff");
  const fcffMaterialIds = fcffMethod?.basisKind === "fcff"
    ? fcffMethod.scenario.historicalOriginals.facts.map((fact) => fact.materialId) : [];
  return request.intent.cutoffAt === pack.frozenAt
    && (pack.researchMode !== "limited" || selected.length > 0)
    && selected.every((id) => available.has(id))
    && (!providerSourceId || selected.includes(providerSourceId))
    && fcffMaterialIds.every((id) => selected.includes(id))
    && (pack.materialSelectionMode !== "explicit"
      || canonicalJson(selected) === canonicalJson(pack.items.map(item => item.id).sort((a,b) => Number(a)-Number(b))))
    && (!request.intent.includeProviderOwnerContext || pack.researchMode === "limited"
      && selected.some(id => pack.items.some(item => item.id === id && item.futuFinancialSource)))
    && (!request.intent.selectedResearchContext || pack.researchMode === "limited"
      && request.intent.includedStructuredSections.includes("research_context"))
    && ((request.intent.selectedProviderScenarioIds ?? []).length === 0 || pack.researchMode === "limited")
    && ((request.intent.selectedProviderFcffScenarioIds ?? []).length === 0 || pack.researchMode === "limited")
    && canonicalJson(request.intent.monitorRules ?? []) === canonicalJson(monitorRules)
    && deepResearchProviderAuthorizationIsConfirmed(request.intent)
    && deepResearchProviderAuthorizationMatches(request.intent);
}

export async function readDeepResearchTask(
  pool: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  taskId: string,
  actor: AuthenticatedResearchActor,
  now = new Date()
): Promise<DeepResearchTaskEnvelope> {
  const task = await readTaskRow(pool, taskId, actor);
  if (!task || task.membershipId !== membershipId) {
    return emptyTaskEnvelope("not_found", membershipId, actor.actorId, now, "Deep-research task was not found for this actor and membership.");
  }
  return taskEnvelope(task, actor.actorId, now, "Deep-research task read from PostgreSQL.");
}

export async function readCurrentDeepResearchTask(
  pool: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  membershipVersion: number,
  evidencePackId: string,
  evidencePackFingerprint: string,
  actor: AuthenticatedResearchActor,
  now = new Date()
): Promise<DeepResearchTaskEnvelope> {
  const result = await pool.query<DeepResearchTaskRow>(
    `${taskSelect()}
      where task.candidate_membership_id = $1
        and task.candidate_membership_version = $2
        and task.evidence_pack_id = $3
        and task.evidence_pack_fingerprint = $4
        and task.actor_type = $5
        and task.actor_id = $6
      order by task.updated_at desc, task.id desc
      limit 1`,
    [membershipId, membershipVersion, evidencePackId, evidencePackFingerprint, actor.actorType, actor.actorId]
  );
  const task = result.rows[0] ? rowToTask(result.rows[0]) : null;
  if (!task || task.status === "succeeded") {
    return emptyTaskEnvelope("not_found", membershipId, actor.actorId, now, "No unfinished deep-research task exists for this evidence pack.");
  }
  return taskEnvelope(task, actor.actorId, now, "Current deep-research task restored from PostgreSQL.");
}

export async function claimDeepResearchTask(pool: Pool, now = new Date()): Promise<ClaimedDeepResearchTask | null> {
  await pool.query(
    `update deep_research_tasks
        set status = 'failed', error_code = 'provider_receipt_unknown',
            claim_token = null, lease_expires_at = null, completed_at = $1, updated_at = $1
      where status = 'running' and lease_expires_at <= $1
        and request_payload->'attemptManifest' is not null`,
    [now]
  );
  await pool.query(
    `update deep_research_tasks
        set status = 'failed', error_code = 'worker_retry_exhausted',
            claim_token = null, lease_expires_at = null, completed_at = $1, updated_at = $1
      where status = 'running' and attempt_count >= 3 and lease_expires_at <= $1
        and request_payload->'attemptManifest' is null`,
    [now]
  );
  const leaseExpiresAt = new Date(now.getTime() + DEEP_RESEARCH_TASK_LEASE_MILLISECONDS);
  const claimToken = randomUUID();
  const result = await pool.query<DeepResearchTaskRow>(
    `with next_task as (
       select id
         from deep_research_tasks
        where attempt_count < 3
          and (status = 'pending' or (status = 'running' and lease_expires_at <= $1
            and request_payload->'attemptManifest' is null))
        order by created_at, id
        for update skip locked
        limit 1
     )
     update deep_research_tasks task
        set status = 'running',
            attempt_count = task.attempt_count + 1,
            claim_token = $3,
            started_at = coalesce(task.started_at, $1),
            lease_expires_at = $2,
            error_code = null,
            updated_at = $1
       from next_task
      where task.id = next_task.id
     returning task.*, null::integer as report_version,
               null::bigint as report_evidence_pack_id,
               null::text as report_fingerprint`,
    [now, leaseExpiresAt, claimToken]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    data: rowToTask(row),
    request: storedTaskPayload(row.request_payload).request,
    snapshot: storedTaskPayload(row.request_payload).snapshot,
    actor: { actorType: row.actor_type, actorId: row.actor_id },
    claimToken
  };
}

export async function bindDeepResearchTaskSnapshot(
  pool: Pool,
  task: ClaimedDeepResearchTask,
  snapshot: DeepResearchSnapshotData,
  now = new Date()
): Promise<ClaimedDeepResearchTask> {
  const validation = validateDeepResearchSnapshotData(snapshot);
  if (!validation.ok) throw new DeepResearchGateError("task snapshot is invalid", validation.errors);
  const result = await pool.query<DeepResearchTaskRow>(
    `update deep_research_tasks
        set request_payload = jsonb_set(request_payload, '{snapshot}', $4::jsonb, true),
            updated_at = $5
      where id = $1 and status = 'running' and attempt_count = $2 and claim_token = $3
        and lease_expires_at > $5
      returning *, null::integer as report_version,
                null::bigint as report_evidence_pack_id,
                null::text as report_fingerprint`,
    [task.data.id, task.data.attemptCount, task.claimToken, JSON.stringify(snapshot), now]
  );
  const row = result.rows[0];
  if (!row) throw new Error("deep-research task snapshot binding failed");
  return { ...task, data: rowToTask(row), snapshot };
}

export async function storeDeepResearchTaskSynthesis(
  pool: Pool,
  task: ClaimedDeepResearchTask,
  synthesis: StoredDeepResearchSynthesis,
  now = new Date()
): Promise<void> {
  const payloadValidation = validateDeepResearchSynthesisProviderPayload(synthesis.providerPayload);
  const reproducibilityValidation = validateDeepResearchSynthesisReproducibility(synthesis.reproducibility);
  const manifest = synthesis.sendManifest;
  const manifestValidation = validateDeepResearchTaskSendManifest(manifest);
  const snapshot = task.snapshot;
  if (synthesis.reportContractVersion !== DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION
    || !payloadValidation.ok || !reproducibilityValidation.ok || !manifestValidation.ok || !snapshot || !manifest
    || manifest.model !== synthesis.reproducibility.model
    || manifest.snapshotId !== snapshot.snapshotId
    || manifest.membershipId !== snapshot.target.membershipId
    || manifest.membershipVersion !== snapshot.target.membershipVersion
    || manifest.symbol !== snapshot.target.symbol
    || manifest.evidencePackId !== snapshot.evidencePack.id
    || manifest.evidencePackVersion !== snapshot.evidencePack.version
    || manifest.evidencePackFingerprint !== snapshot.evidencePack.packFingerprint) {
    throw new DeepResearchGateError("task synthesis is invalid before persistence");
  }
  const result = await pool.query(
    `update deep_research_tasks task
        set status = 'ready_to_absorb', request_payload = jsonb_set(request_payload - 'attemptManifest', '{synthesis}', $4::jsonb, true),
            model_usage = $5, claim_token = null, lease_expires_at = null,
            completed_at = $6, updated_at = $6
      where id = $1 and status = 'running' and attempt_count = $2 and claim_token = $3
        and lease_expires_at > $6 and request_payload->'snapshot' is not null and (select policy.action = 'enable' and policy.policy_version = $7 and policy.backup_provider = 'none' from cloud_ai_provider_policy_events policy where policy.actor_type = task.actor_type and policy.actor_id = task.actor_id order by policy.created_at desc, policy.id desc limit 1) = true and not exists (select 1 from cloud_ai_provider_policy_events deletion where deletion.actor_type = task.actor_type and deletion.actor_id = task.actor_id and deletion.action = 'request_deletion')`,
    [task.data.id, task.data.attemptCount, task.claimToken, JSON.stringify(synthesis), synthesis.reproducibility.tokenUsage, now, manifest.policyVersion]
  );
  if (result.rowCount !== 1) throw new Error("deep-research task synthesis binding failed");
}

export async function readStoredDeepResearchTask(
  pool: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  taskId: string,
  actor: AuthenticatedResearchActor
): Promise<StoredDeepResearchTask | null> {
  const result = await pool.query<DeepResearchTaskRow>(
    `${taskSelect()} where task.id = $1 and task.candidate_membership_id = $2
      and task.actor_type = $3 and task.actor_id = $4 limit 1`,
    [taskId, membershipId, actor.actorType, actor.actorId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const stored = storedTaskPayload(row.request_payload);
  const requestValidation = validateStoredRequest(stored.request);
  if (!requestValidation || !stored.snapshot || !stored.synthesis) return null;
  return { data: rowToTask(row), request: requestValidation, snapshot: stored.snapshot, synthesis: stored.synthesis };
}

export async function readStoredDeepResearchTaskForUpdate(
  client: PoolClient,
  membershipId: string,
  taskId: string,
  actor: AuthenticatedResearchActor
): Promise<StoredDeepResearchTask | null> {
  const result = await client.query<DeepResearchTaskRow>(
    `${taskSelect()} where task.id = $1 and task.candidate_membership_id = $2
      and task.actor_type = $3 and task.actor_id = $4 limit 1 for update of task`,
    [taskId, membershipId, actor.actorType, actor.actorId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const stored = storedTaskPayload(row.request_payload);
  const request = validateStoredRequest(stored.request);
  return request && stored.snapshot && stored.synthesis
    ? { data: rowToTask(row), request, snapshot: stored.snapshot, synthesis: stored.synthesis }
    : null;
}

export async function readCancelableDeepResearchTaskForUpdate(
  client: PoolClient,
  membershipId: string,
  taskId: string,
  actor: AuthenticatedResearchActor
): Promise<CancelableDeepResearchTask | null> {
  const result = await client.query<DeepResearchTaskRow>(
    `${taskSelect()} where task.id = $1 and task.candidate_membership_id = $2
      and task.actor_type = $3 and task.actor_id = $4 limit 1 for update of task`,
    [taskId, membershipId, actor.actorType, actor.actorId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const request = validateStoredRequest(storedTaskPayload(row.request_payload).request);
  return request ? { data: rowToTask(row), request } : null;
}

export async function markDeepResearchTaskCanceled(
  client: PoolClient,
  task: CancelableDeepResearchTask,
  reason: "user_canceled" | "user_rejected",
  now: Date
): Promise<DeepResearchTaskData> {
  const result = await client.query<DeepResearchTaskRow>(
    `update deep_research_tasks
        set status = 'canceled', request_payload = jsonb_set(request_payload - 'synthesis', '{sendReceipt}', $4::jsonb),
            error_code = $2, claim_token = null,
            lease_expires_at = null, report_id = null, completed_at = $3, updated_at = $3
      where id = $1
        and (($2 = 'user_canceled' and status in ('pending', 'running'))
          or ($2 = 'user_rejected' and status = 'ready_to_absorb'))
      returning *, null::integer as report_version,
                null::bigint as report_evidence_pack_id,
                null::text as report_fingerprint`,
    [task.data.id, reason, now, JSON.stringify(task.data.synthesis)]
  );
  if (result.rowCount !== 1) throw new DeepResearchGateError("deep-research task is no longer cancelable");
  return rowToTask(result.rows[0]);
}

export async function readRetryableDeepResearchTask(
  pool: Pool,
  membershipId: string,
  taskId: string,
  actor: AuthenticatedResearchActor
): Promise<RetryableDeepResearchTask | null> {
  const result = await pool.query<DeepResearchTaskRow>(
    `${taskSelect()} where task.id = $1 and task.candidate_membership_id = $2
      and task.actor_type = $3 and task.actor_id = $4 limit 1`,
    [taskId, membershipId, actor.actorType, actor.actorId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const stored = storedTaskPayload(row.request_payload);
  const request = validateStoredRequest(stored.request);
  if (!request || !stored.snapshot) return null;
  return { data: rowToTask(row), request, snapshot: stored.snapshot };
}

export async function attachDeepResearchTaskReport(
  pool: Pick<Pool | PoolClient, "query">,
  task: StoredDeepResearchTask,
  reportId: string,
  now = new Date()
): Promise<void> {
  const result = await pool.query(
    `update deep_research_tasks task
        set status = 'succeeded', report_id = report.id, updated_at = $3
       from deep_research_reports report
      where task.id = $1 and task.status = 'ready_to_absorb' and report.id = $2
        and report.deleted_at is null
        and report.evidence_pack_id = task.evidence_pack_id
        and report.report_contract_version = $4
        and report.report_payload->'snapshot' = task.request_payload->'snapshot'
        and report.report_payload->'reproducibility' = task.request_payload->'synthesis'->'reproducibility' and report.report_payload->'sendManifest' = task.request_payload->'synthesis'->'sendManifest'
        and report.report_payload->'adviceLayer' = task.request_payload->'synthesis'->'providerPayload'->'adviceLayer'
        and report.report_payload->>'changeFromPrevious' = task.request_payload->'synthesis'->'providerPayload'->>'changeFromPrevious'
        and (report.report_payload->'researchLayer') - 'valuation' - 'technical' - 'quantPortfolio'
          = task.request_payload->'synthesis'->'providerPayload'->'researchLayer'`,
    [task.data.id, reportId, now, DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION]
  );
  if (result.rowCount !== 1) throw new DeepResearchGateError("absorbed report does not exactly bind the stored synthesis");
}

export async function failDeepResearchTask(
  pool: Pool,
  task: ClaimedDeepResearchTask,
  errorCode: string,
  terminal: boolean,
  now = new Date()
): Promise<void> {
  const failed = terminal || task.data.attemptCount >= 3;
  const result = await pool.query(
    `update deep_research_tasks
        set status = $2,
            error_code = $3,
            claim_token = null,
            lease_expires_at = null,
            completed_at = $4,
            updated_at = $4
      where id = $1 and status = 'running' and attempt_count = $5 and claim_token = $6
        and lease_expires_at > $7`,
    [task.data.id, failed ? "failed" : "pending", failed ? errorCode : null, failed ? now : null,
      task.data.attemptCount, task.claimToken, now]
  );
  if (result.rowCount !== 1) throw new Error("deep-research task failure binding failed");
}

async function readTaskRow(
  queryable: Pick<Pool | PoolClient, "query">,
  taskId: string,
  actor: AuthenticatedResearchActor
): Promise<DeepResearchTaskData | null> {
  const result = await queryable.query<DeepResearchTaskRow>(
    `${taskSelect()} where task.id = $1 and task.actor_type = $2 and task.actor_id = $3 limit 1`,
    [taskId, actor.actorType, actor.actorId]
  );
  return result.rows[0] ? rowToTask(result.rows[0]) : null;
}

async function readTaskByFingerprint(
  client: PoolClient,
  membershipId: string,
  membershipVersion: number,
  evidencePackId: string,
  fingerprint: string,
  actor: AuthenticatedResearchActor
): Promise<DeepResearchTaskData | null> {
  const result = await client.query<DeepResearchTaskRow>(
    `${taskSelect()}
      where task.candidate_membership_id = $1
        and task.candidate_membership_version = $2
        and task.evidence_pack_id = $3
        and task.request_fingerprint = $4
        and task.actor_type = $5
        and task.actor_id = $6
      order by task.updated_at desc, task.id desc
      limit 1
      for update of task`,
    [membershipId, membershipVersion, evidencePackId, fingerprint, actor.actorType, actor.actorId]
  );
  return result.rows[0] ? rowToTask(result.rows[0]) : null;
}

export function deepResearchTaskFailureIsRetryable(
  task: Pick<DeepResearchTaskData, "status" | "errorCode" | "intent">
): boolean {
  return task.status === "failed" && [
    "provider_timeout",
    "provider_unavailable_or_invalid",
    "provider_http_401", "provider_http_402", "provider_http_403", "provider_http_408", "provider_http_429", "provider_http_500", "provider_http_502", "provider_http_503", "provider_http_504",
    "provider_output_invalid",
    "provider_receipt_unknown",
    "task_execution_failed",
    "worker_retry_exhausted"
  ].includes(task.errorCode ?? "")
    && Boolean(task.intent
      && deepResearchProviderAuthorizationIsConfirmed(task.intent)
      && deepResearchProviderAuthorizationMatches(task.intent));
}
