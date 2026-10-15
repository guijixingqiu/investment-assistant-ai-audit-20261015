import type { FactMetadata } from "./factMetadata.js";
import { validateFactMetadataInto } from "./factMetadata.js";

export const ASSIST_LOCAL_RECORD_SCHEMA_VERSION = "2026-07-06.assist-1.local-record.v1";

export const ASSIST_LOCAL_RECORD_STORAGE_SCOPES = [
  "browser_local_storage",
  "ios_user_defaults",
  "client_memory_only"
] as const;

export type AssistLocalRecordStorageScope = (typeof ASSIST_LOCAL_RECORD_STORAGE_SCOPES)[number];

export interface AssistLocalRecordTarget {
  market: "HK";
  code: string;
  symbol: string;
  candidateMembershipId: string;
}

export interface AssistLocalRecordSourceRef {
  sourceSignature: string;
  decisionContextId: string | null;
  decisionContextHash: string | null;
  followUpWorkflowGeneratedAt: string | null;
  decisionNoteWorkflowGeneratedAt: string | null;
}

export interface AssistLocalRecordFields {
  researchThought: string;
  decisionThought: string;
  evidenceGapNote: string;
  laterReviewNote: string;
}

export interface AssistLocalRecordSafety {
  localOnly: true;
  unofficial: true;
  officialRecord: false;
  serverPersisted: false;
  sent: false;
  brokerSynced: false;
  portfolioFact: false;
  productionFact: false;
  noRecommendation: true;
  noRanking: true;
  noScoring: true;
  noBuySellHold: true;
  noTrading: true;
  noBroker: true;
  noPortfolioMutation: true;
}

export interface AssistLocalRecordEnvelope {
  schemaVersion: typeof ASSIST_LOCAL_RECORD_SCHEMA_VERSION;
  recordId: string;
  createdAt: string;
  updatedAt: string;
  storageScope: AssistLocalRecordStorageScope;
  target: AssistLocalRecordTarget;
  sourceRef: AssistLocalRecordSourceRef;
  metadata: FactMetadata;
  fields: AssistLocalRecordFields;
  safety: AssistLocalRecordSafety;
  message: string;
}

const FORBIDDEN_FIELD_NAMES = [
  "recommendation",
  "rank",
  "ranking",
  "score",
  "rating",
  "signal",
  "buy",
  "sell",
  "hold",
  "targetPrice",
  "stopLoss",
  "takeProfit",
  "expectedReturn",
  "timing",
  "sizing",
  "allocation",
  "rebalance",
  "order",
  "trade",
  "fill",
  "cash",
  "fee",
  "position",
  "broker",
  "portfolioMutation",
  "apiUpload",
  "apiSync",
  "databaseWrite",
  "databasePersisted",
  "officialReview",
  "officialReviewRecord",
  "officialPortfolioFact",
  "serverPersistence",
  "productionReady",
  "liveHoldings",
  "brokerTruth",
  "accountAuthority"
] as const;

export function validateAssistLocalRecordEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["local record envelope must be an object"] };
  collectForbiddenFieldNameErrors(value, "localRecord", errors);
  rejectUnknownKeys(value, "localRecord", [
    "schemaVersion",
    "recordId",
    "createdAt",
    "updatedAt",
    "storageScope",
    "target",
    "sourceRef",
    "metadata",
    "fields",
    "safety",
    "message"
  ], errors);
  if (value.schemaVersion !== ASSIST_LOCAL_RECORD_SCHEMA_VERSION) errors.push(`schemaVersion must be ${ASSIST_LOCAL_RECORD_SCHEMA_VERSION}`);
  requireNonEmptyString(value.recordId, "recordId", errors);
  requireIso(value.createdAt, "createdAt", errors);
  requireIso(value.updatedAt, "updatedAt", errors);
  if (!ASSIST_LOCAL_RECORD_STORAGE_SCOPES.includes(value.storageScope as AssistLocalRecordStorageScope)) errors.push("storageScope is invalid");
  validateTarget(value.target, errors);
  validateSourceRef(value.sourceRef, errors);
  validateFactMetadataInto(value.metadata, "metadata", errors);
  if (isRecord(value.metadata)) {
    if (value.metadata.provenance !== "local_only") errors.push("metadata.provenance must be local_only for local records");
    if (value.metadata.authority !== "local_only") errors.push("metadata.authority must be local_only for local records");
    if (value.metadata.freshness !== "fresh") errors.push("metadata.freshness must be fresh for current saved local records");
  }
  validateFields(value.fields, errors);
  validateSafety(value.safety, errors);
  requireNonEmptyString(value.message, "message", errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateTarget(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("target must be an object");
    return;
  }
  rejectUnknownKeys(value, "target", ["market", "code", "symbol", "candidateMembershipId"], errors);
  if (value.market !== "HK") errors.push("target.market must be HK");
  if (typeof value.code !== "string" || !/^\d{5}$/.test(value.code)) errors.push("target.code must be a five digit HK code");
  requireNonEmptyString(value.symbol, "target.symbol", errors);
  requireNonEmptyString(value.candidateMembershipId, "target.candidateMembershipId", errors);
}

function validateSourceRef(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("sourceRef must be an object");
    return;
  }
  rejectUnknownKeys(value, "sourceRef", [
    "sourceSignature",
    "decisionContextId",
    "decisionContextHash",
    "followUpWorkflowGeneratedAt",
    "decisionNoteWorkflowGeneratedAt"
  ], errors);
  requireNonEmptyString(value.sourceSignature, "sourceRef.sourceSignature", errors);
  validateOptionalString(value.decisionContextId, "sourceRef.decisionContextId", errors);
  validateOptionalString(value.decisionContextHash, "sourceRef.decisionContextHash", errors);
  validateOptionalIso(value.followUpWorkflowGeneratedAt, "sourceRef.followUpWorkflowGeneratedAt", errors);
  validateOptionalIso(value.decisionNoteWorkflowGeneratedAt, "sourceRef.decisionNoteWorkflowGeneratedAt", errors);
}

function validateFields(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("fields must be an object");
    return;
  }
  rejectUnknownKeys(value, "fields", ["researchThought", "decisionThought", "evidenceGapNote", "laterReviewNote"], errors);
  for (const field of ["researchThought", "decisionThought", "evidenceGapNote", "laterReviewNote"] as const) {
    if (typeof value[field] !== "string") errors.push(`fields.${field} must be a string`);
    if (typeof value[field] === "string" && value[field].length > 4000) errors.push(`fields.${field} must be at most 4000 characters`);
  }
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("safety must be an object");
    return;
  }
  rejectUnknownKeys(value, "safety", [
    "localOnly",
    "unofficial",
    "officialRecord",
    "serverPersisted",
    "sent",
    "brokerSynced",
    "portfolioFact",
    "productionFact",
    "noRecommendation",
    "noRanking",
    "noScoring",
    "noBuySellHold",
    "noTrading",
    "noBroker",
    "noPortfolioMutation"
  ], errors);
  for (const field of ["localOnly", "unofficial", "noRecommendation", "noRanking", "noScoring", "noBuySellHold", "noTrading", "noBroker", "noPortfolioMutation"] as const) {
    if (value[field] !== true) errors.push(`safety.${field} must be true`);
  }
  for (const field of ["officialRecord", "serverPersisted", "sent", "brokerSynced", "portfolioFact", "productionFact"] as const) {
    if (value[field] !== false) errors.push(`safety.${field} must be false`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(value: Record<string, unknown>, label: string, allowed: readonly string[], errors: string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) errors.push(`${label}.${key} is not allowed`);
  }
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${field} must be a non-empty string`);
}

function requireIso(value: unknown, field: string, errors: string[]): void {
  requireNonEmptyString(value, field, errors);
  if (typeof value === "string" && Number.isNaN(Date.parse(value))) errors.push(`${field} must be an ISO date-time`);
}

function validateOptionalString(value: unknown, field: string, errors: string[]): void {
  if (value !== null && typeof value !== "string") errors.push(`${field} must be a string or null`);
}

function validateOptionalIso(value: unknown, field: string, errors: string[]): void {
  if (value === null) return;
  if (typeof value !== "string" || value.trim().length === 0 || Number.isNaN(Date.parse(value))) errors.push(`${field} must be an ISO date-time or null`);
}

function collectForbiddenFieldNameErrors(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectForbiddenFieldNameErrors(entry, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if ((FORBIDDEN_FIELD_NAMES as readonly string[]).includes(key)) errors.push(`${path}.${key} is forbidden in local records`);
    collectForbiddenFieldNameErrors(value[key], `${path}.${key}`, errors);
  }
}
