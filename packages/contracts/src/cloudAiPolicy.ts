import { isRfc3339DateTime } from "./factMetadata.js";

export const CLOUD_AI_POLICY_SCHEMA_VERSION = "2026-08-18.cloud-ai-policy.v2";
export const LEGACY_CLOUD_AI_PROVIDER_POLICY_VERSION = "deepseek-v4-flash.2026-08-17.v1";
export const CLOUD_AI_PROVIDER_POLICY_VERSION = "deepseek-flash.2026-09-10.v1";
export type CloudAiPolicyVersion = typeof CLOUD_AI_PROVIDER_POLICY_VERSION | typeof LEGACY_CLOUD_AI_PROVIDER_POLICY_VERSION;
export const LEGACY_CLOUD_AI_PROVIDER_PRICING_IDENTITY = "deepseek-v4-flash.2026-08-13";
export const CLOUD_AI_PROVIDER_PRICING_IDENTITY = "deepseek-flash.2026-09-10.peak";
export const CLOUD_AI_INPUT_CACHE_MISS_USD_PER_MILLION = 0.3;
export const CLOUD_AI_OUTPUT_USD_PER_MILLION = 1.2;

export function cloudAiEstimatedMaxCostUsd(inputTokenUpperBound: number, maxOutputTokens: number, pricingIdentity: string = CLOUD_AI_PROVIDER_PRICING_IDENTITY): number {
  const legacy = pricingIdentity === LEGACY_CLOUD_AI_PROVIDER_PRICING_IDENTITY;
  return Number(((inputTokenUpperBound * (legacy ? 0.14 : CLOUD_AI_INPUT_CACHE_MISS_USD_PER_MILLION)
    + maxOutputTokens * (legacy ? 0.28 : CLOUD_AI_OUTPUT_USD_PER_MILLION)) / 1_000_000).toFixed(8));
}

export const CLOUD_AI_PROVIDER_POLICY = {
  provider: "deepseek",
  model: "deepseek-flash",
  policyVersion: CLOUD_AI_PROVIDER_POLICY_VERSION,
  purposes: ["deep_research_synthesis", "report_evidence_question"],
  privacyPolicyUrl: "https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html?locale=en_US",
  pricingUrl: "https://api-docs.deepseek.com/quick_start/pricing/",
  retention: "variable_no_fixed_duration",
  training: "may_use_inputs_opt_out_not_verified",
  noTrainingGuaranteed: false,
  processingRegion: "People's Republic of China",
  crossBorderProcessing: true,
  fullPdfSent: false,
  credentialsSent: false,
  officialAssetFactsSent: false,
  automaticFallback: false,
  backupProvider: "none",
  deletionContact: "redacted@example.invalid"
} as const;

export type CloudAiProviderPolicySnapshot = Omit<typeof CLOUD_AI_PROVIDER_POLICY, "model" | "policyVersion"> & {
  model: "deepseek-flash" | "deepseek-v4-flash"; policyVersion: CloudAiPolicyVersion;
};
export function cloudAiModelPolicyMatches(model: unknown, version: unknown): boolean {
  return model === "deepseek-flash" && version === CLOUD_AI_PROVIDER_POLICY_VERSION
    || model === "deepseek-v4-flash" && version === LEGACY_CLOUD_AI_PROVIDER_POLICY_VERSION;
}
export function cloudAiPricingMatches(model: unknown, pricing: unknown): boolean {
  return model === "deepseek-flash" && pricing === CLOUD_AI_PROVIDER_PRICING_IDENTITY
    || model === "deepseek-v4-flash" && pricing === LEGACY_CLOUD_AI_PROVIDER_PRICING_IDENTITY;
}
export function cloudAiProviderPolicySnapshotIsKnown(value: unknown): value is CloudAiProviderPolicySnapshot {
  if (!record(value) || !cloudAiModelPolicyMatches(value.model, value.policyVersion)) return false;
  return cloudAiProviderPolicySnapshotIsCurrent({ ...value, model: CLOUD_AI_PROVIDER_POLICY.model, policyVersion: CLOUD_AI_PROVIDER_POLICY_VERSION });
}
export function cloudAiSendAuthorizationSnapshotIsKnown(value: unknown, policyVersion: unknown): value is CloudAiSendAuthorizationSnapshot {
  return record(value) && value.confirmedPolicyVersion === policyVersion
    && [CLOUD_AI_PROVIDER_POLICY_VERSION, LEGACY_CLOUD_AI_PROVIDER_POLICY_VERSION].includes(policyVersion as CloudAiPolicyVersion)
    && cloudAiSendAuthorizationSnapshotIsValid({ ...value, confirmedPolicyVersion: CLOUD_AI_PROVIDER_POLICY_VERSION });
}

export function cloudAiProviderPolicySnapshotIsCurrent(
  value: unknown
): value is CloudAiProviderPolicySnapshot {
  if (!record(value)) return false;
  const expectedKeys = Object.keys(CLOUD_AI_PROVIDER_POLICY) as (keyof CloudAiProviderPolicySnapshot)[];
  return Object.keys(value).length === expectedKeys.length
    && expectedKeys.every((key) => JSON.stringify(value[key]) === JSON.stringify(CLOUD_AI_PROVIDER_POLICY[key]));
}

export interface CloudAiPolicyState {
  actorId: string;
  status: "needs_confirmation" | "enabled" | "disabled";
  confirmedPolicyVersion: string | null;
  confirmedBackupProvider: "none" | null;
  confirmedAt: string | null;
  revokedAt: string | null;
  deletionRequest: {
    status: "not_requested" | "requested_unconfirmed";
    requestedAt: string | null;
  };
}

export interface CloudAiSendAuthorizationSnapshot {
  actorId: string;
  status: "enabled";
  confirmedPolicyVersion: CloudAiPolicyVersion;
  confirmedBackupProvider: "none";
  confirmedAt: string;
  revokedAt: null;
  deletionRequest: {
    status: "not_requested";
    requestedAt: null;
  };
}

export function cloudAiSendAuthorizationSnapshot(
  value: CloudAiPolicyState | null
): CloudAiSendAuthorizationSnapshot | null {
  if (!cloudAiSendAuthorizationSnapshotIsValid(value)) return null;
  return {
    actorId: value.actorId,
    status: "enabled",
    confirmedPolicyVersion: CLOUD_AI_PROVIDER_POLICY_VERSION,
    confirmedBackupProvider: "none",
    confirmedAt: value.confirmedAt,
    revokedAt: null,
    deletionRequest: { status: "not_requested", requestedAt: null }
  };
}

export function cloudAiSendAuthorizationSnapshotIsValid(
  value: unknown
): value is CloudAiSendAuthorizationSnapshot {
  if (!record(value)) return false;
  const errors: string[] = [];
  validateState(value, value.actorId, errors);
  return errors.length === 0
    && value.status === "enabled"
    && value.confirmedPolicyVersion === CLOUD_AI_PROVIDER_POLICY_VERSION
    && value.confirmedBackupProvider === "none"
    && instant(value.confirmedAt)
    && value.revokedAt === null
    && record(value.deletionRequest)
    && value.deletionRequest.status === "not_requested"
    && value.deletionRequest.requestedAt === null;
}

export interface CloudAiPolicyEnvelope {
  schemaVersion: typeof CLOUD_AI_POLICY_SCHEMA_VERSION;
  generatedAt: string;
  status: "available" | "unauthorized" | "unavailable";
  requestedActorId: string;
  policy: typeof CLOUD_AI_PROVIDER_POLICY;
  state: CloudAiPolicyState | null;
  message: string;
  safety: ReturnType<typeof cloudAiPolicySafety>;
}

export interface CloudAiPolicyDecisionRequest {
  action: "enable" | "disable" | "request_deletion";
  policyVersion: typeof CLOUD_AI_PROVIDER_POLICY_VERSION;
  backupProvider: "none";
  ownerConfirmed: true;
  idempotencyKey: string;
}

export function cloudAiPolicySafety() {
  return {
    advisoryOnly: true as const,
    sendsCredentials: false as const,
    sendsOfficialAssetFacts: false as const,
    sendsFullPdf: false as const,
    automaticFallback: false as const,
    createsOrder: false as const,
    createsTrade: false as const,
    mutatesOfficialPortfolio: false as const,
    productionWrite: false as const
  };
}

export function cloudAiPolicyReadbackMatches(left: CloudAiPolicyEnvelope, right: CloudAiPolicyEnvelope): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.status === right.status
    && left.requestedActorId === right.requestedActorId
    && JSON.stringify(left.policy) === JSON.stringify(right.policy)
    && JSON.stringify(left.state) === JSON.stringify(right.state)
    && JSON.stringify(left.safety) === JSON.stringify(right.safety);
}

export function cloudAiPolicyAllowsUse(value: CloudAiPolicyEnvelope | null): boolean {
  return value?.status === "available" && cloudAiSendAuthorizationSnapshot(value.state) !== null;
}

export function validateCloudAiPolicyDecisionRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["cloud AI policy decision must be an object"] };
  exact(value, ["action", "policyVersion", "backupProvider", "ownerConfirmed", "idempotencyKey"], "request", errors);
  if (!["enable", "disable", "request_deletion"].includes(String(value.action))) errors.push("action is invalid");
  if (value.policyVersion !== CLOUD_AI_PROVIDER_POLICY_VERSION) errors.push("policyVersion is stale");
  if (value.backupProvider !== "none") errors.push("backupProvider must be explicitly set to none");
  if (value.ownerConfirmed !== true) errors.push("ownerConfirmed must be true");
  if (typeof value.idempotencyKey !== "string" || value.idempotencyKey.trim().length === 0 || value.idempotencyKey.length > 200) {
    errors.push("idempotencyKey is invalid");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateCloudAiPolicyEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["cloud AI policy envelope must be an object"] };
  exact(value, ["schemaVersion", "generatedAt", "status", "requestedActorId", "policy", "state", "message", "safety"], "envelope", errors);
  if (value.schemaVersion !== CLOUD_AI_POLICY_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  if (!instant(value.generatedAt)) errors.push("generatedAt is invalid");
  if (!["available", "unauthorized", "unavailable"].includes(String(value.status))) errors.push("status is invalid");
  if (typeof value.requestedActorId !== "string" || value.requestedActorId.length === 0 || value.requestedActorId.length > 200) errors.push("requestedActorId is invalid");
  if (!cloudAiProviderPolicySnapshotIsCurrent(value.policy)) errors.push("policy is invalid");
  if (value.status === "available") validateState(value.state, value.requestedActorId, errors);
  else if (value.state !== null) errors.push("non-available envelope must clear state");
  if (typeof value.message !== "string" || value.message.length === 0 || value.message.length > 4000) errors.push("message is invalid");
  if (JSON.stringify(value.safety) !== JSON.stringify(cloudAiPolicySafety())) errors.push("safety is invalid");
  return errors.length ? { ok: false, errors } : { ok: true };
}

function validateState(value: unknown, actorId: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("available envelope requires state"); return; }
  exact(value, ["actorId", "status", "confirmedPolicyVersion", "confirmedBackupProvider", "confirmedAt", "revokedAt", "deletionRequest"], "state", errors);
  if (value.actorId !== actorId) errors.push("state.actorId does not match requestedActorId");
  if (!["needs_confirmation", "enabled", "disabled"].includes(String(value.status))) errors.push("state.status is invalid");
  if (value.confirmedPolicyVersion !== null && typeof value.confirmedPolicyVersion !== "string") errors.push("state.confirmedPolicyVersion is invalid");
  if (value.confirmedBackupProvider !== null && value.confirmedBackupProvider !== "none") errors.push("state.confirmedBackupProvider is invalid");
  if (value.confirmedAt !== null && !instant(value.confirmedAt)) errors.push("state.confirmedAt is invalid");
  if (value.revokedAt !== null && !instant(value.revokedAt)) errors.push("state.revokedAt is invalid");
  if (value.status === "enabled" && (value.confirmedPolicyVersion !== CLOUD_AI_PROVIDER_POLICY_VERSION || value.confirmedBackupProvider !== "none" || value.confirmedAt === null || value.revokedAt !== null
    || !record(value.deletionRequest) || value.deletionRequest.status !== "not_requested")) {
    errors.push("enabled state is inconsistent");
  }
  if (!record(value.deletionRequest)) errors.push("state.deletionRequest is invalid");
  else {
    exact(value.deletionRequest, ["status", "requestedAt"], "state.deletionRequest", errors);
    if (!["not_requested", "requested_unconfirmed"].includes(String(value.deletionRequest.status))) errors.push("state.deletionRequest.status is invalid");
    if (value.deletionRequest.status === "not_requested" && value.deletionRequest.requestedAt !== null) errors.push("not-requested deletion must clear requestedAt");
    if (value.deletionRequest.status === "requested_unconfirmed" && !instant(value.deletionRequest.requestedAt)) errors.push("requested deletion requires requestedAt");
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function instant(value: unknown): boolean {
  return typeof value === "string" && isRfc3339DateTime(value);
}

function exact(value: Record<string, unknown>, expected: string[], label: string, errors: string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) errors.push(`${label} keys are invalid`);
}
