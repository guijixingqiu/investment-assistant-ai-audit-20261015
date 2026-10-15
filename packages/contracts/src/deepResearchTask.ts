import { validateDeepResearchPackBinding, type DeepResearchPackBinding } from "./limitedResearch.js";
import {
  DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
  type ResearchEvidencePackData
} from "./deepResearch.js";
import {
  deepResearchProviderAuthorization,
  validateDeepResearchTaskIntent,
  validateDeepResearchSnapshotBinding,
  type DeepResearchSnapshotBinding,
  type DeepResearchTaskIntent
} from "./deepResearchSnapshot.js";
import {
  cloudAiEstimatedMaxCostUsd,
  cloudAiProviderPolicySnapshotIsKnown,
  cloudAiModelPolicyMatches, cloudAiPricingMatches, type CloudAiPolicyVersion,
  cloudAiSendAuthorizationSnapshotIsKnown,
  type CloudAiProviderPolicySnapshot,
  type CloudAiSendAuthorizationSnapshot
} from "./cloudAiPolicy.js";

export const DEEP_RESEARCH_TASK_SCHEMA_VERSION = "2026-08-17.deep-research-task.v6";
export const DEEP_RESEARCH_TASK_CREATE_REQUEST_FIELDS = [
  "membershipVersion", "evidencePackId", "evidencePackBinding", "intent", "reportContractVersion", "idempotencyKey"
] as const;

export type DeepResearchTaskStatus = "pending" | "running" | "ready_to_absorb" | "succeeded" | "failed" | "canceled";
export interface CreateDeepResearchTaskRequest {
  membershipVersion: number;
  evidencePackId: string;
  evidencePackBinding: DeepResearchPackBinding;
  intent: DeepResearchTaskIntent;
  reportContractVersion: typeof DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION;
  idempotencyKey: string;
}

export interface DeepResearchTaskReportRef {
  id: string;
  version: number;
  evidencePackId: string;
  reportFingerprint: string;
}

export interface DeepResearchTaskSynthesisRef {
  snapshotId: string;
  reportContractVersion: typeof DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION;
  provider: "deepseek";
  model: string;
  promptVersion: string;
  tokenUsage: string;
  cost: string;
  sendManifest: DeepResearchTaskSendManifest | null;
}

export interface DeepResearchTaskSendManifest {
  purpose: "deep_research_synthesis";
  preparedAt?: string;
  policyVersion: CloudAiPolicyVersion;
  policySnapshot?: CloudAiProviderPolicySnapshot;
  sendAuthorization?: CloudAiSendAuthorizationSnapshot;
  provider: "deepseek";
  model: string;
  snapshotId: string;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  evidencePackId: string;
  evidencePackVersion: number;
  evidencePackFingerprint: string;
  selectedMaterialIds: string[];
  includedStructuredSections: DeepResearchTaskIntent["includedStructuredSections"];
  payloadFields: ["selectedSnapshot", "exactSourceBindings"];
  sourceBindingCount: number;
  requestBodySha256: string;
  pricingIdentity?: string;
  inputTokenUpperBound?: number;
  maxOutputTokens?: 1000 | 2000 | 4000 | 8000;
  estimatedMaxCostUsd?: number;
  fullPdfSent: false;
  credentialsSent: false;
  officialAssetFactsSent: false;
}

export interface DeepResearchTaskActionRequest {
  membershipVersion: number;
  taskRequestFingerprint: string;
  snapshotId: string;
  idempotencyKey: string;
}

export interface CancelDeepResearchTaskRequest {
  membershipVersion: number;
  taskRequestFingerprint: string;
  reason: "user_canceled" | "user_rejected";
  idempotencyKey: string;
}

export interface DeepResearchTaskData {
  id: string;
  previousTaskId: string | null;
  membershipId: string;
  membershipVersion: number;
  evidencePackId: string;
  evidencePackFingerprint: string;
  intent: DeepResearchTaskIntent | null;
  requestFingerprint: string;
  generationMethod: "deterministic_frozen_fact_framework" | "deepseek_chat_completions_selected_snapshot" | "legacy_task_metadata_only";
  modelUsage: string;
  snapshotBinding: DeepResearchSnapshotBinding | null;
  status: DeepResearchTaskStatus;
  attemptCount: number;
  synthesis: DeepResearchTaskSynthesisRef | null;
  report: DeepResearchTaskReportRef | null;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface DeepResearchTaskEnvelope {
  schemaVersion: typeof DEEP_RESEARCH_TASK_SCHEMA_VERSION;
  generatedAt: string;
  status: "available" | "not_found" | "unavailable" | "unauthorized";
  membershipId: string;
  requestedActorId: string;
  data: DeepResearchTaskData | null;
  message: string;
  safety: {
    advisoryOnly: true;
    createsOrder: false;
    createsTrade: false;
    mutatesCash: false;
    writesFee: false;
    mutatesPosition: false;
    callsBroker: false;
    productionWrite: false;
  };
}

export function defaultDeepResearchTaskIntent(
  pack: ResearchEvidencePackData,
  priorReport: DeepResearchTaskIntent["priorReport"] = null
): DeepResearchTaskIntent {
  return {
    researchQuestion: `当前冻结证据对 ${pack.symbol} 的长期投资逻辑、关键风险与下一步验证支持什么？`,
    investmentHorizon: "long_term",
    cutoffAt: pack.frozenAt,
    selectedMaterialIds: pack.items.map((item) => item.id).sort((a, b) => Number(a) - Number(b)),
    includedStructuredSections: ["fundamentals", "research_context", "events", "operating_monitor"],
    priorReport,
    outputLanguage: "zh-Hans",
    fullTextPdfConsent: false,
    maxOutputTokens: 8000,
    maxDurationSeconds: 60,
    providerAuthorization: deepResearchProviderAuthorization(false)
  };
}

export function deepResearchTaskSafety(): DeepResearchTaskEnvelope["safety"] {
  return {
    advisoryOnly: true,
    createsOrder: false,
    createsTrade: false,
    mutatesCash: false,
    writesFee: false,
    mutatesPosition: false,
    callsBroker: false,
    productionWrite: false
  };
}

export function validateCreateDeepResearchTaskRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["task request must be an object"] };
  exact(value, [...DEEP_RESEARCH_TASK_CREATE_REQUEST_FIELDS], "request", errors);
  positiveInteger(value.membershipVersion, "membershipVersion", errors);
  bounded(value.evidencePackId, "evidencePackId", 100, errors);
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  if (value.reportContractVersion !== DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION) errors.push("reportContractVersion is invalid");
  const binding = validateDeepResearchPackBinding(value.evidencePackBinding);
  if (!binding.ok) errors.push(...binding.errors);
  const intent = validateDeepResearchTaskIntent(value.intent);
  if (!intent.ok) errors.push(...intent.errors);
  if (record(value.evidencePackBinding)
    && (value.evidencePackBinding.id !== value.evidencePackId
      || value.evidencePackBinding.membershipVersion !== value.membershipVersion)) {
    errors.push("task request does not match evidencePackBinding");
  }
  if (record(value.evidencePackBinding) && record(value.intent)
    && value.intent.cutoffAt !== value.evidencePackBinding.frozenAt) {
    errors.push("task intent cutoff does not match evidencePackBinding");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateDeepResearchTaskActionRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["task action request must be an object"] };
  exact(value, ["membershipVersion", "taskRequestFingerprint", "snapshotId", "idempotencyKey"], "request", errors);
  positiveInteger(value.membershipVersion, "membershipVersion", errors);
  if (!sha(value.taskRequestFingerprint)) errors.push("taskRequestFingerprint is invalid");
  if (!snapshotId(value.snapshotId)) errors.push("snapshotId is invalid");
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateCancelDeepResearchTaskRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["task cancel request must be an object"] };
  exact(value, ["membershipVersion", "taskRequestFingerprint", "reason", "idempotencyKey"], "request", errors);
  positiveInteger(value.membershipVersion, "membershipVersion", errors);
  if (!sha(value.taskRequestFingerprint)) errors.push("taskRequestFingerprint is invalid");
  if (!["user_canceled", "user_rejected"].includes(String(value.reason))) errors.push("reason is invalid");
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateDeepResearchTaskEnvelope(
  value: unknown,
  now = new Date()
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["task envelope must be an object"] };
  exact(value, ["schemaVersion", "generatedAt", "status", "membershipId", "requestedActorId", "data", "message", "safety"], "envelope", errors);
  if (value.schemaVersion !== DEEP_RESEARCH_TASK_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  if (!instant(value.generatedAt) || Date.parse(String(value.generatedAt)) > now.getTime() + 60_000) errors.push("generatedAt is invalid");
  if (!["available", "not_found", "unavailable", "unauthorized"].includes(String(value.status))) errors.push("status is invalid");
  bounded(value.membershipId, "membershipId", 50, errors);
  bounded(value.requestedActorId, "requestedActorId", 200, errors);
  bounded(value.message, "message", 4000, errors);
  if (value.status === "available") validateTask(value.data, value, now, errors);
  else if (value.data !== null) errors.push("non-available task envelope must clear data");
  validateSafety(value.safety, errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

// eslint-disable-next-line complexity -- flat validation preserves precise task-state errors.
function validateTask(value: unknown, envelope: Record<string, unknown>, now: Date, errors: string[]): void {
  if (!record(value)) {
    errors.push("available task envelope requires data");
    return;
  }
  exact(value, [
    "id", "previousTaskId", "membershipId", "membershipVersion", "evidencePackId", "evidencePackFingerprint", "intent",
    "requestFingerprint", "generationMethod", "modelUsage", "status", "attemptCount", "synthesis", "report",
    "snapshotBinding", "errorCode", "createdAt", "startedAt", "completedAt", "updatedAt"
  ], "data", errors);
  for (const key of ["id", "membershipId", "evidencePackId"]) bounded(value[key], `data.${key}`, 100, errors);
  if (value.previousTaskId !== null) bounded(value.previousTaskId, "data.previousTaskId", 100, errors);
  if (value.previousTaskId === value.id) errors.push("data.previousTaskId cannot equal data.id");
  if (value.membershipId !== envelope.membershipId) errors.push("task membership does not match envelope");
  positiveInteger(value.membershipVersion, "data.membershipVersion", errors);
  if (!sha(value.evidencePackFingerprint)) errors.push("data.evidencePackFingerprint is invalid");
  if (value.intent === null) errors.push("data.intent is required");
  else {
    const intent = validateDeepResearchTaskIntent(value.intent);
    if (!intent.ok) errors.push(...intent.errors.map((error) => `data.${error}`));
  }
  if (!sha(value.requestFingerprint)) errors.push("data.requestFingerprint is invalid");
  if (!["deterministic_frozen_fact_framework", "deepseek_chat_completions_selected_snapshot", "legacy_task_metadata_only"].includes(String(value.generationMethod))) errors.push("data.generationMethod is invalid");
  bounded(value.modelUsage, "data.modelUsage", 500, errors);
  if (value.generationMethod === "deterministic_frozen_fact_framework" && value.modelUsage !== "NOT_USED") errors.push("deterministic task modelUsage is invalid");
  if (value.generationMethod === "deepseek_chat_completions_selected_snapshot" && value.modelUsage === "NOT_USED") errors.push("provider task modelUsage is invalid");
  if (value.generationMethod === "legacy_task_metadata_only" && value.modelUsage !== "LEGACY_TASK_METADATA_ONLY") errors.push("legacy task modelUsage is invalid");
  const status = String(value.status);
  if (!["pending", "running", "ready_to_absorb", "succeeded", "failed", "canceled"].includes(status)) errors.push("data.status is invalid");
  if (!Number.isSafeInteger(value.attemptCount) || Number(value.attemptCount) < 0 || Number(value.attemptCount) > 3) errors.push("data.attemptCount is invalid");
  for (const key of ["createdAt", "updatedAt"]) if (!instant(value[key]) || Date.parse(String(value[key])) > now.getTime() + 60_000) errors.push(`data.${key} is invalid`);
  for (const key of ["startedAt", "completedAt"]) if (value[key] !== null && (!instant(value[key]) || Date.parse(String(value[key])) > now.getTime() + 60_000)) errors.push(`data.${key} is invalid`);
  if (value.errorCode !== null) bounded(value.errorCode, "data.errorCode", 200, errors);
  if (value.synthesis !== null) validateSynthesis(value.synthesis, value.snapshotBinding, errors);
  if (record(value.synthesis) && value.modelUsage !== value.synthesis.tokenUsage) errors.push("data.modelUsage does not match synthesis token usage");
  if (value.report !== null) validateReport(value.report, value.evidencePackId, errors);
  if (value.snapshotBinding !== null) {
    const binding = validateDeepResearchSnapshotBinding(value.snapshotBinding);
    if (!binding.ok) errors.push(...binding.errors);
    if (record(value.snapshotBinding) && (value.snapshotBinding.membershipId !== value.membershipId
      || value.snapshotBinding.membershipVersion !== value.membershipVersion
      || value.snapshotBinding.evidencePackId !== value.evidencePackId
      || value.snapshotBinding.evidencePackFingerprint !== value.evidencePackFingerprint)) errors.push("task snapshotBinding does not match task");
  }
  if (status === "pending" && (value.synthesis !== null || value.report !== null || value.completedAt !== null || value.errorCode !== null)) errors.push("pending task state is inconsistent");
  if (status === "running" && (Number(value.attemptCount) < 1 || value.startedAt === null || value.synthesis !== null || value.report !== null || value.completedAt !== null || value.errorCode !== null)) errors.push("running task state is inconsistent");
  if (status === "ready_to_absorb" && (value.generationMethod !== "deepseek_chat_completions_selected_snapshot" || value.synthesis === null || value.report !== null || value.completedAt === null || value.errorCode !== null)) errors.push("ready-to-absorb task state is inconsistent");
  if (status === "succeeded" && (value.report === null || value.completedAt === null || value.errorCode !== null
    || (value.generationMethod === "deepseek_chat_completions_selected_snapshot") !== (value.synthesis !== null))) errors.push("succeeded task state is inconsistent");
  if (["ready_to_absorb", "succeeded"].includes(status) && value.generationMethod === "deepseek_chat_completions_selected_snapshot" && value.snapshotBinding === null) errors.push("completed provider task requires snapshotBinding");
  if (status === "failed" && (value.report !== null || value.completedAt === null || value.errorCode === null
    || record(value.synthesis) && (value.synthesis.tokenUsage !== "UNKNOWN" || value.synthesis.cost !== "UNKNOWN"
      || value.synthesis.sendManifest === null))) errors.push("failed task state is inconsistent");
  if (status === "canceled" && (value.report !== null || value.completedAt === null
    || (value.synthesis !== null && (value.snapshotBinding === null || !["user_canceled", "user_rejected"].includes(String(value.errorCode))))
    || !["user_canceled", "user_rejected", "report_deleted", "material_deleted"].includes(String(value.errorCode)))) errors.push("canceled task state is inconsistent");
}

export function validateDeepResearchTaskSynthesisRef(value: unknown, snapshotBinding: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(snapshotBinding)) return { ok: false, errors: ["send receipt requires a snapshot binding"] };
  validateSynthesis(value, snapshotBinding, errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

function validateSynthesis(value: unknown, snapshotBinding: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("data.synthesis is invalid"); return; }
  exact(value, ["snapshotId", "reportContractVersion", "provider", "model", "promptVersion", "tokenUsage", "cost", "sendManifest"], "data.synthesis", errors);
  if (!snapshotId(value.snapshotId)) errors.push("data.synthesis.snapshotId is invalid");
  if (value.reportContractVersion !== DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION) errors.push("data.synthesis.reportContractVersion is invalid");
  if (value.provider !== "deepseek") errors.push("data.synthesis.provider is invalid");
  for (const key of ["model", "promptVersion", "tokenUsage", "cost"]) bounded(value[key], `data.synthesis.${key}`, 500, errors);
  if (record(snapshotBinding) && value.snapshotId !== snapshotBinding.snapshotId) errors.push("data.synthesis does not match snapshotBinding");
  const sendManifest = value.sendManifest;
  if (sendManifest !== null) {
    const manifest = validateDeepResearchTaskSendManifest(sendManifest);
    if (!manifest.ok) errors.push(...manifest.errors.map((error) => `data.synthesis.${error}`));
    if (record(sendManifest)) {
      if (sendManifest.provider !== value.provider || sendManifest.model !== value.model
        || sendManifest.snapshotId !== value.snapshotId) errors.push("data.synthesis.sendManifest does not match synthesis");
      if (record(snapshotBinding) && [
        ["snapshotId", "snapshotId"], ["membershipId", "membershipId"], ["membershipVersion", "membershipVersion"],
        ["symbol", "symbol"], ["evidencePackId", "evidencePackId"], ["evidencePackVersion", "evidencePackVersion"],
        ["evidencePackFingerprint", "evidencePackFingerprint"]
      ].some(([manifestKey, bindingKey]) => sendManifest[manifestKey] !== snapshotBinding[bindingKey])) {
        errors.push("data.synthesis.sendManifest does not match snapshotBinding");
      }
    }
  }
}

export function validateDeepResearchTaskSendManifest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["sendManifest is invalid"] };
  const fields = [
    "purpose", "policyVersion", "provider", "model", "snapshotId", "membershipId", "membershipVersion", "symbol",
    "evidencePackId", "evidencePackVersion", "evidencePackFingerprint", "selectedMaterialIds",
    "includedStructuredSections", "payloadFields", "sourceBindingCount", "requestBodySha256",
    "fullPdfSent", "credentialsSent", "officialAssetFactsSent"
  ];
  if ("preparedAt" in value) fields.push("preparedAt");
  if ("policySnapshot" in value) fields.push("policySnapshot");
  if ("sendAuthorization" in value) fields.push("sendAuthorization");
  const costFields = ["pricingIdentity", "inputTokenUpperBound", "maxOutputTokens", "estimatedMaxCostUsd"];
  const costFieldCount = costFields.filter((field) => field in value).length;
  if (costFieldCount > 0) fields.push(...costFields);
  exact(value, fields, "sendManifest", errors);
  if (value.purpose !== "deep_research_synthesis") errors.push("sendManifest.purpose is invalid");
  if (value.preparedAt !== undefined && !instant(value.preparedAt)) errors.push("sendManifest.preparedAt is invalid");
  if (!cloudAiModelPolicyMatches(value.model, value.policyVersion)) errors.push("sendManifest.policyVersion is invalid");
  if (value.policySnapshot !== undefined && (!cloudAiProviderPolicySnapshotIsKnown(value.policySnapshot)
    || value.policySnapshot.model !== value.model || value.policySnapshot.policyVersion !== value.policyVersion)) {
    errors.push("sendManifest.policySnapshot is invalid");
  }
  if (value.sendAuthorization !== undefined && !cloudAiSendAuthorizationSnapshotIsKnown(value.sendAuthorization, value.policyVersion)) {
    errors.push("sendManifest.sendAuthorization is invalid");
  }
  if (value.provider !== "deepseek") errors.push("sendManifest.provider is invalid");
  bounded(value.model, "sendManifest.model", 200, errors);
  if (!snapshotId(value.snapshotId)) errors.push("sendManifest.snapshotId is invalid");
  bounded(value.membershipId, "sendManifest.membershipId", 100, errors);
  positiveInteger(value.membershipVersion, "sendManifest.membershipVersion", errors);
  if (typeof value.symbol !== "string" || !/^HK\.\d{5}$/.test(value.symbol)) errors.push("sendManifest.symbol is invalid");
  bounded(value.evidencePackId, "sendManifest.evidencePackId", 100, errors);
  positiveInteger(value.evidencePackVersion, "sendManifest.evidencePackVersion", errors);
  if (!sha(value.evidencePackFingerprint)) errors.push("sendManifest.evidencePackFingerprint is invalid");
  stringArray(value.selectedMaterialIds, "sendManifest.selectedMaterialIds", 500, errors);
  const sections = ["fundamentals", "research_context", "events", "operating_monitor"];
  stringArray(value.includedStructuredSections, "sendManifest.includedStructuredSections", 4, errors, sections);
  if (JSON.stringify(value.payloadFields) !== JSON.stringify(["selectedSnapshot", "exactSourceBindings"])) errors.push("sendManifest.payloadFields is invalid");
  if (!Number.isSafeInteger(value.sourceBindingCount) || Number(value.sourceBindingCount) < 0) errors.push("sendManifest.sourceBindingCount is invalid");
  if (!sha(value.requestBodySha256)) errors.push("sendManifest.requestBodySha256 is invalid");
  if (costFieldCount !== 0 && costFieldCount !== costFields.length) errors.push("sendManifest cost estimate is incomplete");
  if (costFieldCount === costFields.length) {
    if (!cloudAiPricingMatches(value.model, value.pricingIdentity)) errors.push("sendManifest.pricingIdentity is invalid");
    if (!Number.isSafeInteger(value.inputTokenUpperBound) || Number(value.inputTokenUpperBound) < 1) errors.push("sendManifest.inputTokenUpperBound is invalid");
    if (![1000, 2000, 4000, 8000].includes(Number(value.maxOutputTokens))) errors.push("sendManifest.maxOutputTokens is invalid");
    const expected = cloudAiEstimatedMaxCostUsd(Number(value.inputTokenUpperBound), Number(value.maxOutputTokens), String(value.pricingIdentity));
    if (value.estimatedMaxCostUsd !== expected) errors.push("sendManifest.estimatedMaxCostUsd is invalid");
  }
  for (const key of ["fullPdfSent", "credentialsSent", "officialAssetFactsSent"]) if (value[key] !== false) errors.push(`sendManifest.${key} is invalid`);
  return errors.length ? { ok: false, errors } : { ok: true };
}

function validateReport(value: unknown, evidencePackId: unknown, errors: string[]): void {
  if (!record(value)) {
    errors.push("data.report is invalid");
    return;
  }
  exact(value, ["id", "version", "evidencePackId", "reportFingerprint"], "data.report", errors);
  bounded(value.id, "data.report.id", 100, errors);
  positiveInteger(value.version, "data.report.version", errors);
  bounded(value.evidencePackId, "data.report.evidencePackId", 100, errors);
  if (value.evidencePackId !== evidencePackId) errors.push("data.report evidence pack does not match task");
  if (!sha(value.reportFingerprint)) errors.push("data.report.reportFingerprint is invalid");
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!record(value)) {
    errors.push("safety is invalid");
    return;
  }
  exact(value, ["advisoryOnly", "createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker", "productionWrite"], "safety", errors);
  for (const key of Object.keys(value)) if (value[key] !== (key === "advisoryOnly")) errors.push(`safety.${key} is invalid`);
}

function exact(value: Record<string, unknown>, expected: string[], label: string, errors: string[]): void {
  const actual = Object.keys(value).sort();
  const target = [...expected].sort();
  if (actual.length !== target.length || actual.some((key, index) => key !== target[index])) errors.push(`${label} has unexpected or missing keys`);
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function bounded(value: unknown, label: string, max: number, errors: string[]): void { if (typeof value !== "string" || value.trim().length === 0 || value.length > max) errors.push(`${label} must be a bounded non-empty string`); }
function positiveInteger(value: unknown, label: string, errors: string[]): void { if (!Number.isSafeInteger(value) || Number(value) < 1) errors.push(`${label} is invalid`); }
function stringArray(value: unknown, label: string, max: number, errors: string[], allowed?: string[]): void {
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || item.length === 0 || (allowed && !allowed.includes(item)))
    || new Set(value).size !== value.length) errors.push(`${label} is invalid`);
}
function instant(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function sha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function snapshotId(value: unknown): value is string { return typeof value === "string" && /^deep-research-snapshot:[a-f0-9]{64}$/.test(value); }
