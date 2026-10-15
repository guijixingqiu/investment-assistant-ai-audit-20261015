import type { FactMetadata } from "./factMetadata.js";
import { validateFactMetadataInto } from "./factMetadata.js";
export const ASSIST_REVIEW_KNOWLEDGE_SCHEMA_VERSION = "2026-07-10.assist-1.local-review-knowledge.v1";
export const ASSIST_REVIEW_KNOWLEDGE_COLLECTION_SCHEMA_VERSION = "2026-07-19.assist-1.local-review-knowledge-collection.v2";
export const ASSIST_REVIEW_KNOWLEDGE_STORAGE_SCOPES = [
  "browser_local_storage",
  "ios_user_defaults"
] as const;

export const ASSIST_REVIEW_KNOWLEDGE_SNAPSHOT_AVAILABILITY = [
  "preserved",
  "partially_unavailable",
  "not_referenced"
] as const;
export type AssistReviewKnowledgeStorageScope = (typeof ASSIST_REVIEW_KNOWLEDGE_STORAGE_SCOPES)[number];
export type AssistReviewKnowledgeSnapshotAvailability = (typeof ASSIST_REVIEW_KNOWLEDGE_SNAPSHOT_AVAILABILITY)[number];

export interface AssistReviewKnowledgeTarget {
  market: "HK";
  code: string;
  symbol: string;
  candidateMembershipId: string;
  candidateMembershipVersion: number;
}

export interface AssistReviewKnowledgeSourceRef {
  sourceSignature: string;
  decisionContextId: string | null;
  decisionContextHash: string | null;
  localRecordId: string | null;
}

export interface AssistReviewKnowledgeReviewRefs {
  reviewHistoryAsOf: string | null;
  decisionCheckIds: string[];
  postDecisionReviewIds: string[];
  snapshotAvailability: AssistReviewKnowledgeSnapshotAvailability;
}

export interface AssistReviewKnowledgeLineage {
  correctionOfKnowledgeId: string | null;
  replacesKnowledgeId: string | null;
}

export interface AssistReviewKnowledgeFields {
  evidenceLesson: string;
  processLesson: string;
  unresolvedQuestion: string;
  uncertaintyNote: string;
}

export interface AssistReviewKnowledgeSafety {
  localOnly: true;
  unofficial: true;
  readOnlyAssistance: true;
  apiUploaded: false;
  serverPersisted: false;
  databaseWritten: false;
  officialReviewFact: false;
  officialPortfolioFact: false;
  brokerSynced: false;
  changesCandidateOrdering: false;
  createsRecommendation: false;
  createsOrder: false;
  createsTrade: false;
  mutatesCash: false;
  writesFee: false;
  mutatesPosition: false;
  callsBroker: false;
  productionWrite: false;
}

export interface AssistReviewKnowledgeEnvelope {
  schemaVersion: typeof ASSIST_REVIEW_KNOWLEDGE_SCHEMA_VERSION;
  knowledgeId: string;
  createdAt: string;
  updatedAt: string;
  storageScope: AssistReviewKnowledgeStorageScope;
  target: AssistReviewKnowledgeTarget;
  sourceRef: AssistReviewKnowledgeSourceRef;
  reviewRefs: AssistReviewKnowledgeReviewRefs;
  lineage: AssistReviewKnowledgeLineage;
  metadata: FactMetadata;
  fields: AssistReviewKnowledgeFields;
  safety: AssistReviewKnowledgeSafety;
  message: string;
}

export interface AssistReviewKnowledgeCollection {
  schemaVersion: typeof ASSIST_REVIEW_KNOWLEDGE_COLLECTION_SCHEMA_VERSION;
  storageScope: AssistReviewKnowledgeStorageScope;
  targetSymbol: string;
  targetMembershipId: string;
  updatedAt: string;
  entries: AssistReviewKnowledgeEnvelope[];
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
  "officialReview",
  "officialReviewRecord",
  "accountAuthority",
  "productionReady"
] as const;

const MAX_COLLECTION_ENTRIES = 200;
const MAX_REVIEW_IDS = 100;
const MAX_VALIDATION_DEPTH = 64;
const MAX_VALIDATION_NODES = 100_000;
const MAX_VALIDATION_ERRORS = 256;
const MAX_VALIDATED_OBJECT_KEYS = 128;

class BoundedValidationErrors extends Array<string> {
  private truncated = false;

  override push(...items: string[]): number {
    for (const item of items) {
      if (this.length < MAX_VALIDATION_ERRORS) {
        super.push(item);
        continue;
      }
      if (!this.truncated) {
        this.truncated = true;
        this[MAX_VALIDATION_ERRORS - 1] = `validation stopped after ${MAX_VALIDATION_ERRORS} errors`;
      }
      break;
    }
    return this.length;
  }
}

export function validateAssistReviewKnowledgeEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors = new BoundedValidationErrors();
  if (!isRecord(value)) return { ok: false, errors: ["knowledge envelope must be an object"] };
  const reviewIdLimitError = oversizedReviewIdError(value.reviewRefs);
  if (reviewIdLimitError) return { ok: false, errors: [reviewIdLimitError] };
  collectForbiddenFieldNameErrors(value, "knowledge", errors);
  rejectUnknownKeys(value, "knowledge", [
    "schemaVersion",
    "knowledgeId",
    "createdAt",
    "updatedAt",
    "storageScope",
    "target",
    "sourceRef",
    "reviewRefs",
    "lineage",
    "metadata",
    "fields",
    "safety",
    "message"
  ], errors);
  if (value.schemaVersion !== ASSIST_REVIEW_KNOWLEDGE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${ASSIST_REVIEW_KNOWLEDGE_SCHEMA_VERSION}`);
  }
  requireNonEmptyString(value.knowledgeId, "knowledgeId", errors);
  requireIso(value.createdAt, "createdAt", errors);
  requireIso(value.updatedAt, "updatedAt", errors);
  if (isIso(value.createdAt) && isIso(value.updatedAt) && Date.parse(value.createdAt) > Date.parse(value.updatedAt)) {
    errors.push("createdAt must not be later than updatedAt");
  }
  if (!ASSIST_REVIEW_KNOWLEDGE_STORAGE_SCOPES.includes(value.storageScope as AssistReviewKnowledgeStorageScope)) {
    errors.push("storageScope is invalid");
  }
  validateTarget(value.target, errors);
  validateSourceRef(value.sourceRef, errors);
  validateReviewRefs(value.reviewRefs, errors);
  validateLineage(value.lineage, value.knowledgeId, errors);
  validateFactMetadataInto(value.metadata, "metadata", errors);
  validateKnowledgeMetadata(value, errors);
  validateFields(value.fields, errors);
  validateSafety(value.safety, errors);
  requireNonEmptyString(value.message, "message", errors);
  return validationResult(errors);
}

export function validateAssistReviewKnowledgeCollection(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors = new BoundedValidationErrors();
  if (!isRecord(value)) return { ok: false, errors: ["knowledge collection must be an object"] };
  if (!Array.isArray(value.entries)) {
    return { ok: false, errors: ["entries must be an array"] };
  }
  if (value.entries.length > MAX_COLLECTION_ENTRIES) {
    return { ok: false, errors: [`entries must contain at most ${MAX_COLLECTION_ENTRIES} knowledge entries`] };
  }
  collectForbiddenFieldNameErrors(value, "collection", errors);
  rejectUnknownKeys(value, "collection", ["schemaVersion", "storageScope", "targetSymbol", "targetMembershipId", "updatedAt", "entries", "message"], errors);
  if (value.schemaVersion !== ASSIST_REVIEW_KNOWLEDGE_COLLECTION_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${ASSIST_REVIEW_KNOWLEDGE_COLLECTION_SCHEMA_VERSION}`);
  }
  if (!ASSIST_REVIEW_KNOWLEDGE_STORAGE_SCOPES.includes(value.storageScope as AssistReviewKnowledgeStorageScope)) {
    errors.push("storageScope is invalid");
  }
  requireCanonicalSymbol(value.targetSymbol, "targetSymbol", errors);
  requireNonEmptyString(value.targetMembershipId, "targetMembershipId", errors);
  requireIso(value.updatedAt, "updatedAt", errors);
  requireNonEmptyString(value.message, "message", errors);
  const entries = value.entries;
  if (entries.length === 0) errors.push("entries must contain at least one knowledge entry");
  const ids = new Set<string>();
  const idIndexes = new Map<string, number>();
  entries.forEach((entry, index) => {
    const validation = validateAssistReviewKnowledgeEnvelope(entry);
    if (!validation.ok) validation.errors.forEach((error) => errors.push(`entries[${index}].${error}`));
    if (!isRecord(entry)) return;
    if (entry.storageScope !== value.storageScope) errors.push(`entries[${index}].storageScope must match collection storageScope`);
    if (isRecord(entry.target) && entry.target.symbol !== value.targetSymbol) errors.push(`entries[${index}].target.symbol must match targetSymbol`);
    if (isRecord(entry.target) && entry.target.candidateMembershipId !== value.targetMembershipId) errors.push(`entries[${index}].target.candidateMembershipId must match targetMembershipId`);
    if (typeof entry.knowledgeId === "string") {
      if (ids.has(entry.knowledgeId)) errors.push(`entries[${index}].knowledgeId must be unique`);
      ids.add(entry.knowledgeId);
      idIndexes.set(entry.knowledgeId, index);
    }
    if (index > 0 && compareKnowledgeEntries(entries[index - 1], entry) > 0) {
      errors.push("entries must use canonical newest-first ordering");
    }
  });
  const replacementTargets = new Set<string>();
  entries.forEach((entry, index) => {
    if (!isRecord(entry) || !isRecord(entry.lineage)) return;
    for (const field of ["correctionOfKnowledgeId", "replacesKnowledgeId"] as const) {
      const targetId = entry.lineage[field];
      if (typeof targetId !== "string") continue;
      const targetIndex = idIndexes.get(targetId);
      if (targetIndex === undefined) {
        errors.push(`entries[${index}].lineage.${field} must reference an entry in the same collection`);
      } else if (targetIndex <= index) {
        errors.push(`entries[${index}].lineage.${field} must reference an older entry`);
      }
    }
    const replaces = entry.lineage.replacesKnowledgeId;
    if (typeof replaces === "string") {
      if (replacementTargets.has(replaces)) errors.push(`entries[${index}].lineage.replacesKnowledgeId must not duplicate another replacement target`);
      replacementTargets.add(replaces);
    }
  });
  const first = entries[0];
  if (isRecord(first) && first.updatedAt !== value.updatedAt) {
    errors.push("collection updatedAt must equal the newest entry updatedAt");
  }
  return validationResult(errors);
}

export function compareAssistReviewKnowledgeEntries(
  left: Pick<AssistReviewKnowledgeEnvelope, "updatedAt" | "knowledgeId">,
  right: Pick<AssistReviewKnowledgeEnvelope, "updatedAt" | "knowledgeId">
): number {
  const byTime = right.updatedAt.localeCompare(left.updatedAt);
  return byTime !== 0 ? byTime : right.knowledgeId.localeCompare(left.knowledgeId);
}

function compareKnowledgeEntries(left: unknown, right: unknown): number {
  if (!isRecord(left) || !isRecord(right) || typeof left.updatedAt !== "string" || typeof right.updatedAt !== "string") return 0;
  const leftId = typeof left.knowledgeId === "string" ? left.knowledgeId : "";
  const rightId = typeof right.knowledgeId === "string" ? right.knowledgeId : "";
  return compareAssistReviewKnowledgeEntries(
    { updatedAt: left.updatedAt, knowledgeId: leftId },
    { updatedAt: right.updatedAt, knowledgeId: rightId }
  );
}

function validateTarget(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("target must be an object");
    return;
  }
  rejectUnknownKeys(value, "target", ["market", "code", "symbol", "candidateMembershipId", "candidateMembershipVersion"], errors);
  if (value.market !== "HK") errors.push("target.market must be HK");
  if (typeof value.code !== "string" || !/^\d{5}$/.test(value.code)) errors.push("target.code must be a five digit HK code");
  requireCanonicalSymbol(value.symbol, "target.symbol", errors);
  if (typeof value.code === "string" && value.symbol !== `HK.${value.code}`) errors.push("target.symbol must match target market and code");
  requireNonEmptyString(value.candidateMembershipId, "target.candidateMembershipId", errors);
  if (!Number.isInteger(value.candidateMembershipVersion) || Number(value.candidateMembershipVersion) < 1) {
    errors.push("target.candidateMembershipVersion must be a positive integer");
  }
}

function validateSourceRef(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("sourceRef must be an object");
    return;
  }
  rejectUnknownKeys(value, "sourceRef", ["sourceSignature", "decisionContextId", "decisionContextHash", "localRecordId"], errors);
  requireNonEmptyString(value.sourceSignature, "sourceRef.sourceSignature", errors);
  validateOptionalString(value.decisionContextId, "sourceRef.decisionContextId", errors);
  validateOptionalString(value.decisionContextHash, "sourceRef.decisionContextHash", errors);
  validateOptionalString(value.localRecordId, "sourceRef.localRecordId", errors);
  if ((value.decisionContextId === null) !== (value.decisionContextHash === null)) {
    errors.push("sourceRef decisionContextId and decisionContextHash must both be present or both be null");
  }
}

function validateReviewRefs(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("reviewRefs must be an object");
    return;
  }
  rejectUnknownKeys(value, "reviewRefs", ["reviewHistoryAsOf", "decisionCheckIds", "postDecisionReviewIds", "snapshotAvailability"], errors);
  validateOptionalIso(value.reviewHistoryAsOf, "reviewRefs.reviewHistoryAsOf", errors);
  validateUniqueIds(value.decisionCheckIds, "reviewRefs.decisionCheckIds", errors);
  validateUniqueIds(value.postDecisionReviewIds, "reviewRefs.postDecisionReviewIds", errors);
  if (!ASSIST_REVIEW_KNOWLEDGE_SNAPSHOT_AVAILABILITY.includes(value.snapshotAvailability as AssistReviewKnowledgeSnapshotAvailability)) {
    errors.push("reviewRefs.snapshotAvailability is invalid");
  }
  const referenceCount = (Array.isArray(value.decisionCheckIds) ? value.decisionCheckIds.length : 0)
    + (Array.isArray(value.postDecisionReviewIds) ? value.postDecisionReviewIds.length : 0);
  if (referenceCount > 0 && value.reviewHistoryAsOf === null) errors.push("reviewRefs.reviewHistoryAsOf is required when review IDs are referenced");
  if (referenceCount === 0 && value.snapshotAvailability !== "not_referenced") errors.push("reviewRefs.snapshotAvailability must be not_referenced without review IDs");
  if (referenceCount > 0 && value.snapshotAvailability === "not_referenced") errors.push("reviewRefs.snapshotAvailability must disclose referenced snapshot availability");
}

function validateLineage(value: unknown, knowledgeId: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("lineage must be an object");
    return;
  }
  rejectUnknownKeys(value, "lineage", ["correctionOfKnowledgeId", "replacesKnowledgeId"], errors);
  validateOptionalString(value.correctionOfKnowledgeId, "lineage.correctionOfKnowledgeId", errors);
  validateOptionalString(value.replacesKnowledgeId, "lineage.replacesKnowledgeId", errors);
  if (knowledgeId === value.correctionOfKnowledgeId || knowledgeId === value.replacesKnowledgeId) {
    errors.push("knowledge entry cannot correct or replace itself");
  }
}

function validateKnowledgeMetadata(value: Record<string, unknown>, errors: string[]): void {
  if (!isRecord(value.metadata)) return;
  const expectedSource = value.storageScope === "browser_local_storage" ? "browser_local_storage" : "ios_user_defaults";
  if (value.metadata.source !== expectedSource) errors.push("metadata.source must match storageScope");
  if (value.metadata.provenance !== "local_only") errors.push("metadata.provenance must be local_only");
  if (value.metadata.authority !== "local_only") errors.push("metadata.authority must be local_only");
  if (value.metadata.freshness !== "historical") errors.push("metadata.freshness must be historical");
  if (value.metadata.stale !== false || value.metadata.missing !== false || value.metadata.conflict !== false || value.metadata.fixture !== false) {
    errors.push("metadata flags must remain false for a saved local historical entry");
  }
  if (value.metadata.asOf !== value.updatedAt || value.metadata.fetchedAt !== null) {
    errors.push("metadata asOf must equal updatedAt and fetchedAt must be null");
  }
  if (isRecord(value.lineage)) {
    if (value.metadata.correctionOf !== value.lineage.correctionOfKnowledgeId) errors.push("metadata.correctionOf must match lineage.correctionOfKnowledgeId");
    if (value.metadata.replaces !== value.lineage.replacesKnowledgeId) errors.push("metadata.replaces must match lineage.replacesKnowledgeId");
  }
}

function validateFields(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("fields must be an object");
    return;
  }
  const keys = ["evidenceLesson", "processLesson", "unresolvedQuestion", "uncertaintyNote"] as const;
  rejectUnknownKeys(value, "fields", keys, errors);
  let populated = 0;
  for (const key of keys) {
    if (typeof value[key] !== "string") errors.push(`fields.${key} must be a string`);
    if (typeof value[key] === "string" && value[key].length > 4000) errors.push(`fields.${key} must be at most 4000 characters`);
    if (typeof value[key] === "string" && value[key].trim().length > 0) populated += 1;
  }
  if (populated === 0) errors.push("at least one retrospective knowledge field must be populated");
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("safety must be an object");
    return;
  }
  const trueKeys = ["localOnly", "unofficial", "readOnlyAssistance"] as const;
  const falseKeys = [
    "apiUploaded",
    "serverPersisted",
    "databaseWritten",
    "officialReviewFact",
    "officialPortfolioFact",
    "brokerSynced",
    "changesCandidateOrdering",
    "createsRecommendation",
    "createsOrder",
    "createsTrade",
    "mutatesCash",
    "writesFee",
    "mutatesPosition",
    "callsBroker",
    "productionWrite"
  ] as const;
  rejectUnknownKeys(value, "safety", [...trueKeys, ...falseKeys], errors);
  for (const key of trueKeys) if (value[key] !== true) errors.push(`safety.${key} must be true`);
  for (const key of falseKeys) if (value[key] !== false) errors.push(`safety.${key} must be false`);
}

function validateUniqueIds(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return;
  }
  if (value.length > MAX_REVIEW_IDS) {
    errors.push(`${field} must contain at most ${MAX_REVIEW_IDS} IDs`);
    return;
  }
  const ids = new Set<string>();
  value.forEach((entry, index) => {
    requireNonEmptyString(entry, `${field}[${index}]`, errors);
    if (typeof entry === "string") {
      if (ids.has(entry)) errors.push(`${field} must not contain duplicate IDs`);
      ids.add(entry);
    }
  });
}

function collectForbiddenFieldNameErrors(value: unknown, path: string, errors: string[]): void {
  const seen = new WeakSet<object>();
  const pending: Array<{ value: unknown; path: string; depth: number }> = [{ value, path, depth: 0 }];
  let scheduled = 1;
  while (pending.length > 0) {
    const current = pending.pop() as { value: unknown; path: string; depth: number };
    if (!Array.isArray(current.value) && !isRecord(current.value)) continue;
    if (current.depth > MAX_VALIDATION_DEPTH) {
      errors.push(`${current.path} exceeds maximum validation depth ${MAX_VALIDATION_DEPTH}`);
      continue;
    }
    if (seen.has(current.value)) {
      errors.push(`${current.path} contains a cyclic object reference`);
      continue;
    }
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      const remainingNodeBudget = MAX_VALIDATION_NODES - scheduled;
      if (current.value.length > remainingNodeBudget) {
        errors.push(`${path} exceeds maximum validation node count ${MAX_VALIDATION_NODES}`);
        return;
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        const child = current.value[index];
        if (Array.isArray(child) || isRecord(child)) {
          pending.push({ value: child, path: `${current.path}[${index}]`, depth: current.depth + 1 });
        }
      }
      scheduled += current.value.length;
      continue;
    }
    for (const key in current.value) {
      if (!Object.hasOwn(current.value, key)) continue;
      if ((FORBIDDEN_FIELD_NAMES as readonly string[]).includes(key)) errors.push(`${current.path}.${key} is forbidden in local review knowledge`);
      if (scheduled >= MAX_VALIDATION_NODES) {
        errors.push(`${path} exceeds maximum validation node count ${MAX_VALIDATION_NODES}`);
        return;
      }
      const child = current.value[key];
      if (Array.isArray(child) || isRecord(child)) {
        pending.push({ value: child, path: `${current.path}.${key}`, depth: current.depth + 1 });
      }
      scheduled += 1;
    }
  }
}

function rejectUnknownKeys(value: Record<string, unknown>, field: string, allowed: readonly string[], errors: string[]): void {
  const allowedSet = new Set(allowed);
  let inspected = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    inspected += 1;
    if (inspected > MAX_VALIDATED_OBJECT_KEYS) {
      errors.push(`${field} exceeds maximum key count ${MAX_VALIDATED_OBJECT_KEYS}`);
      return;
    }
    if (!allowedSet.has(key)) errors.push(`${field}.${key} is not allowed`);
  }
}

function oversizedReviewIdError(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const field of ["decisionCheckIds", "postDecisionReviewIds"] as const) {
    const ids = value[field];
    if (Array.isArray(ids) && ids.length > MAX_REVIEW_IDS) {
      return `reviewRefs.${field} must contain at most ${MAX_REVIEW_IDS} IDs`;
    }
  }
  return null;
}

function validationResult(errors: BoundedValidationErrors): { ok: true } | { ok: false; errors: string[] } {
  return errors.length === 0 ? { ok: true } : { ok: false, errors: [...errors] };
}

function requireCanonicalSymbol(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || !/^HK\.\d{5}$/.test(value)) errors.push(`${field} must be a canonical HK five-digit symbol`);
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${field} must be a non-empty string`);
}

function requireIso(value: unknown, field: string, errors: string[]): void {
  requireNonEmptyString(value, field, errors);
  if (!isIso(value)) errors.push(`${field} must be a valid date-time`);
}

function validateOptionalIso(value: unknown, field: string, errors: string[]): void {
  validateOptionalString(value, field, errors);
  if (typeof value === "string" && !isIso(value)) errors.push(`${field} must be a valid date-time or null`);
}

function validateOptionalString(value: unknown, field: string, errors: string[]): void {
  if (value !== null && (typeof value !== "string" || value.trim().length === 0)) errors.push(`${field} must be a non-empty string or null`);
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
