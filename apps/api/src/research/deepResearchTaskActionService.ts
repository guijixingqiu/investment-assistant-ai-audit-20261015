import type { Pool } from "pg";
import type {
  CancelDeepResearchTaskRequest,
  DeepResearchTaskActionRequest,
  DeepResearchTaskEnvelope
} from "../../../../packages/contracts/src/deepResearchTask.js";
import {
  DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
  type CreateSynthesizedDeepResearchReportRequest
} from "../../../../packages/contracts/src/deepResearchSynthesisReport.js";
import {
  DeepResearchGateError,
  IdempotencyConflictError,
  type AuthenticatedResearchActor
} from "./domain.js";
import { readCurrentDeepResearchSnapshot } from "./deepResearchSnapshotAssembler.js";
import { createDeepResearchReportInTransaction } from "./deepResearchReportRepository.js";
import {
  attachDeepResearchTaskReport,
  deepResearchTaskFailureIsRetryable,
  enqueueDeepResearchTask,
  markDeepResearchTaskCanceled,
  readCancelableDeepResearchTaskForUpdate,
  readDeepResearchTask,
  readRetryableDeepResearchTask,
  readStoredDeepResearchTaskForUpdate
} from "./deepResearchTaskRepository.js";
import { requestFingerprint } from "./deepResearchGate.js";
import { taskEnvelope } from "./deepResearchTaskMappers.js";
import { assertCandidateMembershipWriteBinding, sameBoundResearchWriteReplay } from "./researchWriteBinding.js";
import {
  actorRequest,
  findAuditByIdempotencyKey,
  insertWriteAudit,
  isUniqueViolation,
  readExistingResearchProfileBinding
} from "./writePersistence.js";

export async function cancelDeepResearchTask(
  pool: Pool,
  membershipId: string,
  taskId: string,
  request: CancelDeepResearchTaskRequest,
  actor: AuthenticatedResearchActor,
  now = new Date()
): Promise<DeepResearchTaskEnvelope> {
  if (actor.actorType !== "user") throw new DeepResearchGateError("an explicit user-scoped actor is required to cancel deep research");
  const { idempotencyKey, ...cancelInput } = request;
  const boundRequest = { ...cancelInput, membershipId, taskId };
  const fingerprint = requestFingerprint("deep_research_task_cancel", { boundRequest, actor });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const membership = await assertCandidateMembershipWriteBinding(client, actor, boundRequest);
    const replay = await findAuditByIdempotencyKey<DeepResearchTaskEnvelope["data"]>(
      client, idempotencyKey, "deep_research_task_canceled"
    );
    if (replay && !sameBoundResearchWriteReplay(replay, actor, boundRequest, fingerprint)) {
      throw new IdempotencyConflictError("idempotency key already used with a different task cancellation");
    }
    const locked = await readCancelableDeepResearchTaskForUpdate(client, membershipId, taskId, actor);
    if (!locked || locked.data.membershipVersion !== request.membershipVersion
      || locked.data.requestFingerprint !== request.taskRequestFingerprint) {
      throw new DeepResearchGateError("task cancellation does not exactly bind membership and request");
    }
    if (replay) {
      if (locked.data.status !== "canceled" || locked.data.errorCode !== request.reason) {
        throw new IdempotencyConflictError("task cancellation was recorded before the task was explicitly restarted");
      }
      await client.query("commit");
      return taskEnvelope(
        locked.data, actor.actorId, now, "Existing task cancellation replayed."
      );
    }
    if (locked.data.status === "canceled") {
      throw new IdempotencyConflictError("task was already canceled by another explicit action");
    }
    if ((request.reason === "user_canceled" && !["pending", "running"].includes(locked.data.status))
      || (request.reason === "user_rejected" && locked.data.status !== "ready_to_absorb")) {
      throw new DeepResearchGateError("queued or running tasks can be canceled; only a ready result can be rejected");
    }
    const binding = await readExistingResearchProfileBinding(client, membership.market, membership.code, membership.symbol);
    if (!binding) throw new DeepResearchGateError("task cancellation stock binding is unavailable");
    const canceled = await markDeepResearchTaskCanceled(client, locked, request.reason, now);
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "deep_research_task_canceled",
      request: actorRequest(actor, idempotencyKey),
      stock: binding.stock,
      targetTable: "deep_research_tasks",
      targetId: taskId,
      beforePayload: locked.data,
      afterPayload: canceled,
      requestFingerprint: fingerprint,
      candidateMembershipId: membershipId,
      candidateMembershipVersion: request.membershipVersion
    });
    await client.query("commit");
    return taskEnvelope(
      canceled, actor.actorId, new Date(auditAsOf),
      request.reason === "user_rejected" ? "Deep-research result was not adopted." : "Deep-research task was canceled."
    );
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      throw new IdempotencyConflictError("task cancellation idempotency key is already used by another research write");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function retryDeepResearchTask(
  pool: Pool,
  membershipId: string,
  taskId: string,
  request: DeepResearchTaskActionRequest,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  sourceStore?:import("./researchSourceSnapshotRepository.js").SourceSnapshotStoreOptions
): Promise<DeepResearchTaskEnvelope> {
  const task = await readRetryableDeepResearchTask(pool, membershipId, taskId, actor);
  if (task?.request.idempotencyKey === request.idempotencyKey) throw new IdempotencyConflictError("retry requires its own action idempotency key, not the original enqueue key");
  if (!task || !deepResearchTaskFailureIsRetryable(task.data)) {
    throw new DeepResearchGateError("only a transient exact failed task can be explicitly retried");
  }
  assertActionBinding(task.data, task.snapshot.snapshotId, request);
  return enqueueDeepResearchTask(
    pool,
    membershipId,
    { ...task.request, idempotencyKey: request.idempotencyKey },
    actor,
    now,
    taskId,
    true,
    sourceStore
  );
}

export async function absorbDeepResearchTask(
  pool: Pool,
  membershipId: string,
  taskId: string,
  request: DeepResearchTaskActionRequest,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  sourceStore?:import("./researchSourceSnapshotRepository.js").SourceSnapshotStoreOptions
): Promise<DeepResearchTaskEnvelope> {
  if (actor.actorType !== "user") throw new DeepResearchGateError("an explicit user-scoped actor is required to absorb research synthesis");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await assertCandidateMembershipWriteBinding(client, actor, {
      membershipId,
      membershipVersion: request.membershipVersion
    });
    const locked = await readStoredDeepResearchTaskForUpdate(client, membershipId, taskId, actor);
    if (!locked || !["ready_to_absorb", "succeeded"].includes(locked.data.status)) {
      throw new DeepResearchGateError("only a completed exact synthesis can be absorbed");
    }
    assertActionBinding(locked.data, locked.snapshot.snapshotId, request);
    if (locked.data.status === "ready_to_absorb") {
      const current = await readCurrentDeepResearchSnapshot(client, membershipId, {
        membershipVersion: locked.request.membershipVersion,
        evidencePackId: locked.request.evidencePackId,
        evidencePackFingerprint: locked.request.evidencePackBinding.fingerprint,
        intent: locked.request.intent,
        analysisContentVersion: locked.snapshot.analysisContentVersion ?? null
      }, actor, now, sourceStore);
      if (locked.snapshot.snapshotId !== current.snapshotId) {
        throw new DeepResearchGateError("the completed synthesis snapshot is no longer exact current");
      }
    }
    const reportRequest: CreateSynthesizedDeepResearchReportRequest = {
      membershipVersion: locked.request.membershipVersion,
      evidencePackId: locked.request.evidencePackId,
      idempotencyKey: request.idempotencyKey,
      reportContractVersion: DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
      snapshot: locked.snapshot,
      reproducibility: locked.synthesis.reproducibility,
      sendManifest: locked.synthesis.sendManifest ?? undefined,
      providerPayload: locked.synthesis.providerPayload
    };
    const report = await createDeepResearchReportInTransaction(client, membershipId, reportRequest, actor, now, sourceStore);
    if (locked.data.status === "ready_to_absorb") {
      await attachDeepResearchTaskReport(client, locked, report.data.id, now);
    } else if (!locked.data.report
      || report.data.id !== locked.data.report.id
      || report.data.version !== locked.data.report.version
      || report.data.evidencePackId !== locked.data.report.evidencePackId
      || report.data.reportFingerprint !== locked.data.report.reportFingerprint) {
      throw new IdempotencyConflictError("absorption idempotency key does not resolve the task's exact report");
    }
    const envelope = await readDeepResearchTask(client, membershipId, taskId, actor, now);
    await client.query("commit");
    return envelope;
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      throw new IdempotencyConflictError("absorption idempotency key is already used by another research write");
    }
    throw error;
  } finally {
    client.release();
  }
}

function assertActionBinding(
  task: { membershipVersion: number; requestFingerprint: string },
  snapshotId: string,
  request: DeepResearchTaskActionRequest
): void {
  if (task.membershipVersion !== request.membershipVersion
    || task.requestFingerprint !== request.taskRequestFingerprint
    || snapshotId !== request.snapshotId) {
    throw new DeepResearchGateError("task action does not exactly bind membership, request, and snapshot");
  }
}
