import {
  DEEP_RESEARCH_TASK_SCHEMA_VERSION,
  deepResearchTaskSafety,
  validateCreateDeepResearchTaskRequest,
  validateDeepResearchTaskSendManifest,
  validateDeepResearchTaskSynthesisRef,
  type CreateDeepResearchTaskRequest,
  type DeepResearchTaskData,
  type DeepResearchTaskEnvelope,
  type DeepResearchTaskSendManifest,
  type DeepResearchTaskSynthesisRef
} from "../../../../packages/contracts/src/deepResearchTask.js";
import {
  DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
  validateDeepResearchSynthesisProviderPayload,
  validateDeepResearchSynthesisReproducibility,
  type DeepResearchSynthesisProviderPayload,
  type DeepResearchSynthesisReproducibility
} from "../../../../packages/contracts/src/deepResearchSynthesisReport.js";
import {
  deepResearchSnapshotBinding,
  validateDeepResearchSnapshotData,
  type DeepResearchSnapshotData
} from "../../../../packages/contracts/src/deepResearchSnapshot.js";

export interface DeepResearchTaskRow {
  id: string | number;
  previous_task_id: string | number | null;
  candidate_membership_id: string | number;
  candidate_membership_version: number;
  evidence_pack_id: string | number;
  evidence_pack_fingerprint: string;
  request_fingerprint: string;
  request_payload: unknown;
  actor_type: "user" | "system";
  actor_id: string;
  generation_method: "deterministic_frozen_fact_framework" | "deepseek_chat_completions_selected_snapshot" | "legacy_task_metadata_only";
  model_usage: string;
  status: "pending" | "running" | "ready_to_absorb" | "succeeded" | "failed" | "canceled";
  attempt_count: number;
  claim_token: string | null;
  report_id: string | number | null;
  report_version: number | null;
  report_evidence_pack_id: string | number | null;
  report_fingerprint: string | null;
  error_code: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  updated_at: Date | string;
}

export interface StoredDeepResearchSynthesis {
  reportContractVersion: typeof DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION;
  reproducibility: DeepResearchSynthesisReproducibility;
  providerPayload: DeepResearchSynthesisProviderPayload;
  sendManifest: DeepResearchTaskSendManifest | null;
}

export interface StoredDeepResearchTask {
  data: DeepResearchTaskData;
  request: CreateDeepResearchTaskRequest;
  snapshot: DeepResearchSnapshotData;
  synthesis: StoredDeepResearchSynthesis;
}

export interface RetryableDeepResearchTask {
  data: DeepResearchTaskData;
  request: CreateDeepResearchTaskRequest;
  snapshot: DeepResearchSnapshotData;
}

export interface CancelableDeepResearchTask {
  data: DeepResearchTaskData;
  request: CreateDeepResearchTaskRequest;
}

export function taskSelect(): string {
  return `select task.*,
                 report.version as report_version,
                 report.evidence_pack_id as report_evidence_pack_id,
                 report.report_fingerprint
            from deep_research_tasks task
            left join deep_research_reports report on report.id = task.report_id`;
}

export function rowToTask(row: DeepResearchTaskRow): DeepResearchTaskData {
  const stored = storedTaskPayload(row.request_payload);
  const request = validateStoredRequest(stored.request);
  const snapshot = stored.snapshot;
  return {
    id: String(row.id),
    previousTaskId: row.previous_task_id === null || row.previous_task_id === undefined
      ? null
      : String(row.previous_task_id),
    membershipId: String(row.candidate_membership_id),
    membershipVersion: Number(row.candidate_membership_version),
    evidencePackId: String(row.evidence_pack_id),
    evidencePackFingerprint: row.evidence_pack_fingerprint,
    intent: request?.intent ?? null,
    requestFingerprint: row.request_fingerprint,
    generationMethod: row.generation_method,
    modelUsage: row.model_usage,
    snapshotBinding: snapshot ? deepResearchSnapshotBinding(snapshot) : null,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    synthesis: stored.synthesis ? synthesisRef(stored.synthesis, snapshot)
      : row.status === "canceled" && stored.sendReceipt ? stored.sendReceipt
      : ["failed", "canceled"].includes(row.status) && stored.attemptManifest ? attemptSynthesisRef(stored.attemptManifest, snapshot) : null,
    report: row.report_id === null ? null : {
      id: String(row.report_id),
      version: Number(row.report_version),
      evidencePackId: String(row.report_evidence_pack_id),
      reportFingerprint: String(row.report_fingerprint)
    },
    errorCode: row.error_code,
    createdAt: iso(row.created_at),
    startedAt: row.started_at === null ? null : iso(row.started_at),
    completedAt: row.completed_at === null ? null : iso(row.completed_at),
    updatedAt: iso(row.updated_at)
  };
}

export function storedTaskPayload(value: unknown): {
  request: unknown;
  snapshot: DeepResearchSnapshotData | null;
  synthesis: StoredDeepResearchSynthesis | null;
  attemptManifest: DeepResearchTaskSendManifest | null;
  sendReceipt: DeepResearchTaskSynthesisRef | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { request: value, snapshot: null, synthesis: null, attemptManifest: null, sendReceipt: null };
  }
  const stored = value as Record<string, unknown>;
  if (!("request" in stored)) return { request: value, snapshot: null, synthesis: null, attemptManifest: null, sendReceipt: null };
  const snapshot = validateDeepResearchSnapshotData(stored.snapshot).ok
    ? stored.snapshot as DeepResearchSnapshotData
    : null;
  const attemptManifest = validateDeepResearchTaskSendManifest(stored.attemptManifest).ok
    ? stored.attemptManifest as DeepResearchTaskSendManifest : null;
  const sendReceipt = snapshot && validateDeepResearchTaskSynthesisRef(stored.sendReceipt, deepResearchSnapshotBinding(snapshot)).ok
    ? stored.sendReceipt as DeepResearchTaskSynthesisRef : null;
  return { request: stored.request, snapshot, synthesis: storedSynthesis(stored.synthesis), attemptManifest, sendReceipt };
}

export function validateStoredRequest(value: unknown): CreateDeepResearchTaskRequest | null {
  return validateCreateDeepResearchTaskRequest(value).ok ? value as CreateDeepResearchTaskRequest : null;
}

export function taskEnvelope(
  data: DeepResearchTaskData,
  actorId: string,
  now: Date,
  message: string
): DeepResearchTaskEnvelope {
  return {
    schemaVersion: DEEP_RESEARCH_TASK_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    status: "available",
    membershipId: data.membershipId,
    requestedActorId: actorId,
    data,
    message,
    safety: deepResearchTaskSafety()
  };
}

export function emptyTaskEnvelope(
  status: "not_found" | "unavailable" | "unauthorized",
  membershipId: string,
  actorId: string,
  now: Date,
  message: string
): DeepResearchTaskEnvelope {
  return {
    schemaVersion: DEEP_RESEARCH_TASK_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    status,
    membershipId,
    requestedActorId: actorId,
    data: null,
    message,
    safety: deepResearchTaskSafety()
  };
}

function storedSynthesis(value: unknown): StoredDeepResearchSynthesis | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stored = value as Record<string, unknown>;
  if (stored.reportContractVersion !== DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION
    || !validateDeepResearchSynthesisProviderPayload(stored.providerPayload).ok
    || !validateDeepResearchSynthesisReproducibility(stored.reproducibility).ok
    || (stored.sendManifest !== undefined && stored.sendManifest !== null
      && !validateDeepResearchTaskSendManifest(stored.sendManifest).ok)) return null;
  return { ...stored, sendManifest: stored.sendManifest ?? null } as unknown as StoredDeepResearchSynthesis;
}

function synthesisRef(
  value: StoredDeepResearchSynthesis,
  snapshot: DeepResearchSnapshotData | null
): DeepResearchTaskSynthesisRef | null {
  if (!snapshot) return null;
  return {
    snapshotId: snapshot.snapshotId,
    reportContractVersion: value.reportContractVersion,
    provider: value.reproducibility.provider,
    model: value.reproducibility.model,
    promptVersion: value.reproducibility.prompt,
    tokenUsage: value.reproducibility.tokenUsage,
    cost: value.reproducibility.cost,
    sendManifest: value.sendManifest
  };
}

function attemptSynthesisRef(
  manifest: DeepResearchTaskSendManifest,
  snapshot: DeepResearchSnapshotData | null
): DeepResearchTaskSynthesisRef | null {
  if (!snapshot) return null;
  return {
    snapshotId: snapshot.snapshotId,
    reportContractVersion: DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
    provider: "deepseek",
    model: manifest.model,
    promptVersion: "UNKNOWN",
    tokenUsage: "UNKNOWN",
    cost: "UNKNOWN",
    sendManifest: manifest
  };
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}
