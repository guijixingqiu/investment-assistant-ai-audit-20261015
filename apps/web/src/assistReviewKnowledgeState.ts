import {
  ASSIST_REVIEW_KNOWLEDGE_COLLECTION_SCHEMA_VERSION,
  ASSIST_REVIEW_KNOWLEDGE_SCHEMA_VERSION,
  compareAssistReviewKnowledgeEntries,
  validateAssistReviewKnowledgeCollection,
  validateAssistReviewKnowledgeEnvelope,
  type AssistReviewKnowledgeCollection,
  type AssistReviewKnowledgeEnvelope,
  type AssistReviewKnowledgeFields,
  type AssistReviewKnowledgeSnapshotAvailability
} from "../../../packages/contracts/src/assistReviewKnowledgeBrowser.js";
import {
  AssistReviewKnowledgeConflictError,
  AssistReviewKnowledgeStorageError,
  assistReviewKnowledgeDeletionStorageKey,
  assistReviewKnowledgeStorageKey,
  isUsableAssistReviewKnowledgeIdentity,
  requireAssistReviewKnowledgeIdentityForSymbol,
  requireMatchingAssistReviewKnowledgeIdentity,
  type AssistReviewKnowledgeCurrentSourceIdentity,
  type AssistReviewKnowledgeStorageLike
} from "./assistReviewKnowledgeIdentity.js";

export type { AssistReviewKnowledgeCurrentSourceIdentity } from "./assistReviewKnowledgeIdentity.js";

export const ASSIST_REVIEW_KNOWLEDGE_STORAGE_CHARACTER_LIMIT = 2_000_000;
export const ASSIST_REVIEW_KNOWLEDGE_DELETION_SCHEMA_VERSION = "2026-08-19.assist-review-knowledge-deletion.v1";

export interface AssistReviewKnowledgeDeletionState {
  schemaVersion: typeof ASSIST_REVIEW_KNOWLEDGE_DELETION_SCHEMA_VERSION;
  collectionClearedAt: string | null;
  entries: Array<{ knowledgeId: string; deletedAt: string }>;
}

export interface AssistReviewKnowledgeBuildInput {
  symbol: string;
  membershipId: string;
  membershipVersion: number;
  sourceSignature: string;
  decisionContextId: string | null;
  decisionContextHash: string | null;
  localRecordId: string | null;
  reviewHistoryAsOf: string | null;
  decisionCheckIds: string[];
  postDecisionReviewIds: string[];
  snapshotAvailability: AssistReviewKnowledgeSnapshotAvailability;
  correctionOfKnowledgeId: string | null;
  replacesKnowledgeId: string | null;
  fields: AssistReviewKnowledgeFields;
  nowIso: string;
}

export type AssistReviewKnowledgeRelation = "current_source" | "historical_source" | "source_unavailable";

export interface AssistReviewKnowledgeViewEntry {
  envelope: AssistReviewKnowledgeEnvelope;
  relation: AssistReviewKnowledgeRelation;
  usableAsCurrentSource: boolean;
  message: string;
}

export type AssistReviewKnowledgeLoadResult =
  | {
    ok: true;
    state: "loaded";
    collection: AssistReviewKnowledgeCollection;
    entries: AssistReviewKnowledgeViewEntry[];
    currentEntries: AssistReviewKnowledgeViewEntry[];
    historicalEntries: AssistReviewKnowledgeViewEntry[];
    message: string;
  }
  | {
    ok: false;
    state: "missing" | "source_unavailable" | "mismatch" | "malformed" | "storage_unavailable";
    entries: [];
    currentEntries: [];
    historicalEntries: [];
    message: string;
  };

export function buildAssistReviewKnowledgeEnvelope(input: AssistReviewKnowledgeBuildInput): AssistReviewKnowledgeEnvelope {
  const symbol = requireCanonicalSymbol(input.symbol);
  const nowIso = requireIso(input.nowIso, "nowIso");
  const code = symbol.replace(/^HK\./, "");
  const fields = clampKnowledgeFields(input.fields);
  const correctionOf = normalizeOptionalText(input.correctionOfKnowledgeId, 500);
  const replaces = normalizeOptionalText(input.replacesKnowledgeId, 500);
  const envelope: AssistReviewKnowledgeEnvelope = {
    schemaVersion: ASSIST_REVIEW_KNOWLEDGE_SCHEMA_VERSION,
    knowledgeId: `assist-review-knowledge:${symbol}:${nowIso}`,
    createdAt: nowIso,
    updatedAt: nowIso,
    storageScope: "browser_local_storage",
    target: {
      market: "HK",
      code,
      symbol,
      candidateMembershipId: requireText(input.membershipId, "membershipId", 500),
      candidateMembershipVersion: requirePositiveInteger(input.membershipVersion, "membershipVersion")
    },
    sourceRef: {
      sourceSignature: requireText(input.sourceSignature, "sourceSignature", 4000),
      decisionContextId: normalizeOptionalText(input.decisionContextId, 1000),
      decisionContextHash: normalizeOptionalText(input.decisionContextHash, 1000),
      localRecordId: normalizeOptionalText(input.localRecordId, 4000)
    },
    reviewRefs: {
      reviewHistoryAsOf: input.reviewHistoryAsOf === null ? null : requireIso(input.reviewHistoryAsOf, "reviewHistoryAsOf"),
      decisionCheckIds: uniqueBoundedIds(input.decisionCheckIds, "decisionCheckIds"),
      postDecisionReviewIds: uniqueBoundedIds(input.postDecisionReviewIds, "postDecisionReviewIds"),
      snapshotAvailability: input.snapshotAvailability
    },
    lineage: {
      correctionOfKnowledgeId: correctionOf,
      replacesKnowledgeId: replaces
    },
    metadata: {
      source: "browser_local_storage",
      asOf: nowIso,
      fetchedAt: null,
      freshness: "historical",
      provenance: "local_only",
      authority: "local_only",
      stale: false,
      missing: false,
      conflict: false,
      fixture: false,
      correctionOf,
      replaces,
      message: "Browser-local retrospective knowledge metadata is historical, source-scoped, unofficial, and local-only."
    },
    fields,
    safety: {
      localOnly: true,
      unofficial: true,
      readOnlyAssistance: true,
      apiUploaded: false,
      serverPersisted: false,
      databaseWritten: false,
      officialReviewFact: false,
      officialPortfolioFact: false,
      brokerSynced: false,
      changesCandidateOrdering: false,
      createsRecommendation: false,
      createsOrder: false,
      createsTrade: false,
      mutatesCash: false,
      writesFee: false,
      mutatesPosition: false,
      callsBroker: false,
      productionWrite: false
    },
    message: "Saved in this browser only as unofficial retrospective knowledge; review IDs are references only and no API, database, official review, portfolio, broker, or trading fact is created."
  };
  const validation = validateAssistReviewKnowledgeEnvelope(envelope);
  if (!validation.ok) throw new Error(`knowledge payload failed validation: ${validation.errors.join("; ")}`);
  return envelope;
}

export function loadAssistReviewKnowledgeFromStorage(
  storage: AssistReviewKnowledgeStorageLike,
  symbol: string,
  currentSource: AssistReviewKnowledgeCurrentSourceIdentity | null
): AssistReviewKnowledgeLoadResult {
  const canonical = requireCanonicalSymbol(symbol);
  if (!isUsableAssistReviewKnowledgeIdentity(currentSource)) {
    return emptyFailure(
      "source_unavailable",
      "Current membership and source identity are unavailable; browser localStorage was not read and old knowledge display is cleared."
    );
  }
  let deletions: AssistReviewKnowledgeDeletionState | null;
  let raw: string | null;
  try {
    deletions = readAssistReviewKnowledgeDeletionState(storage, currentSource.membershipId, canonical);
    raw = storage.getItem(assistReviewKnowledgeStorageKey(currentSource.membershipId, canonical));
  } catch (error) {
    if (error instanceof AssistReviewKnowledgeConflictError) {
      return emptyFailure("malformed", error.message);
    }
    return emptyFailure("storage_unavailable", "Browser localStorage knowledge read failed; old knowledge display is cleared.");
  }
  if (!raw) return emptyFailure("missing", `No browser-local retrospective knowledge exists for ${canonical}.`);
  if (raw.length > ASSIST_REVIEW_KNOWLEDGE_STORAGE_CHARACTER_LIMIT) {
    return emptyFailure("malformed", "Saved retrospective knowledge exceeds the local validation size limit; old knowledge display is cleared.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyFailure("malformed", "Saved retrospective knowledge is malformed; old knowledge display is cleared and the stored value is not trusted.");
  }
  let validation: ReturnType<typeof validateAssistReviewKnowledgeCollection>;
  try {
    validation = validateAssistReviewKnowledgeCollection(parsed);
  } catch {
    return emptyFailure("malformed", "Saved retrospective knowledge could not be validated safely; old knowledge display is cleared.");
  }
  if (!validation.ok) {
    const mismatch = isRecord(parsed) && (
      (typeof parsed.targetSymbol === "string" && parsed.targetSymbol !== canonical)
      || (typeof parsed.targetMembershipId === "string" && parsed.targetMembershipId !== currentSource.membershipId)
    );
    return emptyFailure(
      mismatch ? "mismatch" : "malformed",
      `Saved retrospective knowledge failed closed: ${validation.errors.join("; ")}`
    );
  }
  const collection = parsed as AssistReviewKnowledgeCollection;
  if (collection.storageScope !== "browser_local_storage") {
    return emptyFailure("malformed", "Saved retrospective knowledge is not a browser localStorage collection; old knowledge display is cleared.");
  }
  if (collection.targetSymbol !== canonical || collection.targetMembershipId !== currentSource.membershipId) {
    return emptyFailure("mismatch", "Saved retrospective knowledge does not belong to the current membership and symbol; old knowledge display is cleared.");
  }
  const deletedIds = new Set(deletions?.entries.map((entry) => entry.knowledgeId) ?? []);
  const retained = collection.entries.filter((entry) => !deletedIds.has(entry.knowledgeId)
    && (deletions?.collectionClearedAt === null || deletions?.collectionClearedAt === undefined
      || Date.parse(entry.updatedAt) > Date.parse(deletions.collectionClearedAt)));
  if (retained.length === 0) return emptyFailure("missing", `Owner deletion tombstones hide all browser-local retrospective knowledge for ${canonical}.`);
  const visibleCollection = retained.length === collection.entries.length
    ? collection
    : buildCollection(canonical, currentSource.membershipId, retained.sort(compareAssistReviewKnowledgeEntries));
  const supersededIds = new Set(visibleCollection.entries.flatMap((entry) => entry.lineage.replacesKnowledgeId ? [entry.lineage.replacesKnowledgeId] : []));
  const entries = visibleCollection.entries.map((envelope) => classifyKnowledgeEntry(envelope, currentSource, supersededIds));
  const currentEntries = entries.filter((entry) => entry.relation === "current_source");
  const historicalEntries = entries.filter((entry) => entry.relation !== "current_source");
  return {
    ok: true,
    state: "loaded",
    collection: visibleCollection,
    entries,
    currentEntries,
    historicalEntries,
    message: `Loaded ${entries.length} browser-local retrospective knowledge entr${entries.length === 1 ? "y" : "ies"} for ${canonical}; ${currentEntries.length} match the current source.`
  };
}

export function saveAssistReviewKnowledgeToStorage(
  storage: AssistReviewKnowledgeStorageLike,
  input: AssistReviewKnowledgeBuildInput,
  currentSource: AssistReviewKnowledgeCurrentSourceIdentity
): { entry: AssistReviewKnowledgeEnvelope; collection: AssistReviewKnowledgeCollection } {
  requireMatchingAssistReviewKnowledgeIdentity(input, currentSource);
  const existing = loadAssistReviewKnowledgeForMutation(storage, input.symbol, currentSource);
  const entry = buildAssistReviewKnowledgeEnvelope(input);
  const deletions = readAssistReviewKnowledgeDeletionState(storage, currentSource.membershipId, entry.target.symbol);
  if (deletions?.entries.some((item) => item.knowledgeId === entry.knowledgeId)
    || deletions?.collectionClearedAt !== null && deletions?.collectionClearedAt !== undefined
      && Date.parse(entry.updatedAt) <= Date.parse(deletions.collectionClearedAt)) {
    throw new AssistReviewKnowledgeConflictError("Owner deletion history blocks reuse of this local knowledge identity or timestamp.");
  }
  if (existing.some((candidate) => candidate.knowledgeId === entry.knowledgeId)) {
    throw new AssistReviewKnowledgeConflictError("A knowledge entry with the same local identity already exists; retry with a new timestamp.");
  }
  if (input.replacesKnowledgeId !== null && !existing.some((candidate) => candidate.knowledgeId === input.replacesKnowledgeId)) {
    throw new AssistReviewKnowledgeConflictError("The selected replacement knowledge entry no longer exists in this symbol collection.");
  }
  if (input.correctionOfKnowledgeId !== null && !existing.some((candidate) => candidate.knowledgeId === input.correctionOfKnowledgeId)) {
    throw new AssistReviewKnowledgeConflictError("The selected correction knowledge entry no longer exists in this symbol collection.");
  }
  if (input.replacesKnowledgeId !== null && existing.some((candidate) => candidate.lineage.replacesKnowledgeId === input.replacesKnowledgeId)) {
    throw new AssistReviewKnowledgeConflictError("The selected knowledge entry was already replaced; select the latest active entry before saving another replacement.");
  }
  if (existing.length >= 200) throw new AssistReviewKnowledgeConflictError("The symbol knowledge collection already contains the maximum 200 entries.");
  const entries = [entry, ...existing].sort(compareAssistReviewKnowledgeEntries);
  const collection = buildCollection(entry.target.symbol, entry.target.candidateMembershipId, entries);
  const serialized = JSON.stringify(collection);
  if (serialized.length > ASSIST_REVIEW_KNOWLEDGE_STORAGE_CHARACTER_LIMIT) {
    throw new AssistReviewKnowledgeConflictError(
      `The symbol knowledge collection exceeds the ${ASSIST_REVIEW_KNOWLEDGE_STORAGE_CHARACTER_LIMIT.toLocaleString("en-US")} character local validation size limit and was not saved.`
    );
  }
  try {
    storage.setItem(assistReviewKnowledgeStorageKey(entry.target.candidateMembershipId, entry.target.symbol), serialized);
  } catch (error) {
    throw new AssistReviewKnowledgeStorageError("save", error);
  }
  return { entry, collection };
}

export function clearAssistReviewKnowledgeEntryFromStorage(
  storage: AssistReviewKnowledgeStorageLike,
  symbol: string,
  knowledgeId: string,
  currentSource: AssistReviewKnowledgeCurrentSourceIdentity,
  deletedAt = new Date().toISOString()
): AssistReviewKnowledgeCollection | null {
  const canonical = requireCanonicalSymbol(symbol);
  requireAssistReviewKnowledgeIdentityForSymbol(currentSource, canonical);
  const entries = loadAssistReviewKnowledgeForMutation(storage, canonical, currentSource);
  const dependent = entries.find((entry) =>
    entry.knowledgeId !== knowledgeId
    && (entry.lineage.correctionOfKnowledgeId === knowledgeId || entry.lineage.replacesKnowledgeId === knowledgeId)
  );
  if (dependent) {
    throw new AssistReviewKnowledgeConflictError("The selected knowledge entry is referenced by newer correction/replacement lineage and cannot be cleared independently.");
  }
  const remaining = entries.filter((entry) => entry.knowledgeId !== knowledgeId);
  if (remaining.length === entries.length) throw new AssistReviewKnowledgeConflictError("The selected knowledge entry no longer exists.");
  const deletion = readAssistReviewKnowledgeDeletionState(storage, currentSource.membershipId, canonical);
  writeAssistReviewKnowledgeDeletionState(storage, currentSource.membershipId, canonical, {
    schemaVersion: ASSIST_REVIEW_KNOWLEDGE_DELETION_SCHEMA_VERSION,
    collectionClearedAt: deletion?.collectionClearedAt ?? null,
    entries: [...(deletion?.entries ?? []), { knowledgeId, deletedAt: requireDeletionInstant(deletedAt) }]
  });
  try {
    if (remaining.length === 0) {
      storage.removeItem(assistReviewKnowledgeStorageKey(currentSource.membershipId, canonical));
      return null;
    }
    const collection = buildCollection(canonical, currentSource.membershipId, remaining.sort(compareAssistReviewKnowledgeEntries));
    storage.setItem(assistReviewKnowledgeStorageKey(currentSource.membershipId, canonical), JSON.stringify(collection));
    return collection;
  } catch (error) {
    throw new AssistReviewKnowledgeStorageError("clear", error);
  }
}

export function clearAssistReviewKnowledgeCollectionFromStorage(
  storage: AssistReviewKnowledgeStorageLike,
  symbol: string,
  currentSource: AssistReviewKnowledgeCurrentSourceIdentity,
  deletedAt = new Date().toISOString()
): void {
  const canonical = requireCanonicalSymbol(symbol);
  requireAssistReviewKnowledgeIdentityForSymbol(currentSource, canonical);
  const deletion = readAssistReviewKnowledgeDeletionState(storage, currentSource.membershipId, canonical);
  const requestedClear = requireDeletionInstant(deletedAt);
  writeAssistReviewKnowledgeDeletionState(storage, currentSource.membershipId, canonical, {
    schemaVersion: ASSIST_REVIEW_KNOWLEDGE_DELETION_SCHEMA_VERSION,
    collectionClearedAt: deletion?.collectionClearedAt !== null && deletion?.collectionClearedAt !== undefined
      && Date.parse(deletion.collectionClearedAt) > Date.parse(requestedClear)
      ? deletion.collectionClearedAt : requestedClear,
    entries: deletion?.entries ?? []
  });
  try {
    storage.removeItem(assistReviewKnowledgeStorageKey(currentSource.membershipId, canonical));
  } catch (error) {
    throw new AssistReviewKnowledgeStorageError("clear", error);
  }
}

export function readAssistReviewKnowledgeDeletionState(
  storage: AssistReviewKnowledgeStorageLike,
  membershipId: string,
  symbol: string
): AssistReviewKnowledgeDeletionState | null {
  let raw: string | null;
  try {
    raw = storage.getItem(assistReviewKnowledgeDeletionStorageKey(membershipId, symbol));
  } catch (error) {
    throw new AssistReviewKnowledgeStorageError("read", error);
  }
  if (raw === null) return null;
  if (raw.length > ASSIST_REVIEW_KNOWLEDGE_STORAGE_CHARACTER_LIMIT) {
    throw new AssistReviewKnowledgeConflictError("Saved review-knowledge deletion history exceeds the local validation size limit.");
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new AssistReviewKnowledgeConflictError("Saved review-knowledge deletion history is malformed."); }
  if (!isRecord(value) || value.schemaVersion !== ASSIST_REVIEW_KNOWLEDGE_DELETION_SCHEMA_VERSION
    || Object.keys(value).sort().join("|") !== ["collectionClearedAt", "entries", "schemaVersion"].sort().join("|")
    || value.collectionClearedAt !== null && typeof value.collectionClearedAt !== "string"
    || !Array.isArray(value.entries) || value.entries.length > 1_000) {
    throw new AssistReviewKnowledgeConflictError("Saved review-knowledge deletion history is malformed.");
  }
  const collectionClearedAt = value.collectionClearedAt === null ? null : requireDeletionInstant(value.collectionClearedAt);
  const entries = value.entries.map((item) => {
    if (!isRecord(item) || Object.keys(item).sort().join("|") !== ["deletedAt", "knowledgeId"].sort().join("|")) {
      throw new AssistReviewKnowledgeConflictError("Saved review-knowledge entry deletion is malformed.");
    }
    return {
      knowledgeId: requireText(String(item.knowledgeId ?? ""), "knowledgeId", 500),
      deletedAt: requireDeletionInstant(String(item.deletedAt ?? ""))
    };
  });
  if (new Set(entries.map((item) => item.knowledgeId)).size !== entries.length) {
    throw new AssistReviewKnowledgeConflictError("Saved review-knowledge deletion IDs must be unique.");
  }
  return { schemaVersion: ASSIST_REVIEW_KNOWLEDGE_DELETION_SCHEMA_VERSION, collectionClearedAt, entries };
}

export function writeAssistReviewKnowledgeDeletionState(
  storage: AssistReviewKnowledgeStorageLike,
  membershipId: string,
  symbol: string,
  value: AssistReviewKnowledgeDeletionState
): void {
  const normalized: AssistReviewKnowledgeDeletionState = {
    schemaVersion: ASSIST_REVIEW_KNOWLEDGE_DELETION_SCHEMA_VERSION,
    collectionClearedAt: value.collectionClearedAt === null ? null : requireDeletionInstant(value.collectionClearedAt),
    entries: value.entries.map((item) => ({
      knowledgeId: requireText(item.knowledgeId, "knowledgeId", 500),
      deletedAt: requireDeletionInstant(item.deletedAt)
    })).sort((left, right) => right.deletedAt.localeCompare(left.deletedAt) || right.knowledgeId.localeCompare(left.knowledgeId))
  };
  if (normalized.entries.length > 1_000 || new Set(normalized.entries.map((item) => item.knowledgeId)).size !== normalized.entries.length) {
    throw new AssistReviewKnowledgeConflictError("Review-knowledge deletion history is invalid or full.");
  }
  const serialized = JSON.stringify(normalized);
  if (serialized.length > ASSIST_REVIEW_KNOWLEDGE_STORAGE_CHARACTER_LIMIT) {
    throw new AssistReviewKnowledgeConflictError("Review-knowledge deletion history exceeds the local validation size limit.");
  }
  try {
    storage.setItem(assistReviewKnowledgeDeletionStorageKey(membershipId, symbol), serialized);
  } catch (error) {
    throw new AssistReviewKnowledgeStorageError("clear", error);
  }
}

export function describeAssistReviewKnowledgeEntry(view: AssistReviewKnowledgeViewEntry): string[] {
  const entry = view.envelope;
  return [
    `${view.relation}: ${entry.knowledgeId}; updatedAt=${entry.updatedAt}; usableAsCurrentSource=${view.usableAsCurrentSource}.`,
    `Target=${entry.target.symbol}; membership=${entry.target.candidateMembershipId}; version=${entry.target.candidateMembershipVersion}.`,
    `Source context=${entry.sourceRef.decisionContextId ?? "missing"}; hash=${entry.sourceRef.decisionContextHash ?? "missing"}; localRecord=${entry.sourceRef.localRecordId ?? "not referenced"}.`,
    `Review references: checks=${entry.reviewRefs.decisionCheckIds.length}; reviews=${entry.reviewRefs.postDecisionReviewIds.length}; historyAsOf=${entry.reviewRefs.reviewHistoryAsOf ?? "not referenced"}; snapshot=${entry.reviewRefs.snapshotAvailability}.`,
    `Lineage: correctionOf=${entry.lineage.correctionOfKnowledgeId ?? "none"}; replaces=${entry.lineage.replacesKnowledgeId ?? "none"}.`,
    view.message
  ];
}

function buildCollection(symbol: string, membershipId: string, entries: AssistReviewKnowledgeEnvelope[]): AssistReviewKnowledgeCollection {
  const collection: AssistReviewKnowledgeCollection = {
    schemaVersion: ASSIST_REVIEW_KNOWLEDGE_COLLECTION_SCHEMA_VERSION,
    storageScope: "browser_local_storage",
    targetSymbol: symbol,
    targetMembershipId: membershipId,
    updatedAt: entries[0].updatedAt,
    entries,
    message: "Browser-local membership-and-symbol-scoped retrospective knowledge collection; historical entries never become current facts without an exact source-signature match."
  };
  const validation = validateAssistReviewKnowledgeCollection(collection);
  if (!validation.ok) throw new Error(`knowledge collection failed validation: ${validation.errors.join("; ")}`);
  return collection;
}

function loadAssistReviewKnowledgeForMutation(
  storage: AssistReviewKnowledgeStorageLike,
  symbol: string,
  currentSource: AssistReviewKnowledgeCurrentSourceIdentity
): AssistReviewKnowledgeEnvelope[] {
  const result = loadAssistReviewKnowledgeFromStorage(storage, symbol, currentSource);
  if (result.ok) return result.collection.entries;
  if (result.state === "missing") return [];
  if (result.state === "storage_unavailable") throw new AssistReviewKnowledgeStorageError("read");
  throw new AssistReviewKnowledgeConflictError(`${result.message} Clear the invalid membership-and-symbol collection explicitly before saving new knowledge.`);
}

function classifyKnowledgeEntry(
  envelope: AssistReviewKnowledgeEnvelope,
  currentSource: AssistReviewKnowledgeCurrentSourceIdentity | null,
  supersededIds: ReadonlySet<string>
): AssistReviewKnowledgeViewEntry {
  if (currentSource === null) {
    return {
      envelope,
      relation: "source_unavailable",
      usableAsCurrentSource: false,
      message: "Current source signature is unavailable; this entry is historical local reference only and is not used as a current fact."
    };
  }
  if (supersededIds.has(envelope.knowledgeId)) {
    return {
      envelope,
      relation: "historical_source",
      usableAsCurrentSource: false,
      message: "A newer immutable entry replaces this entry; it remains historical local lineage and cannot be used as current-source knowledge."
    };
  }
  const exactIdentityMatch = envelope.sourceRef.sourceSignature === currentSource.sourceSignature
    && envelope.target.candidateMembershipId === currentSource.membershipId
    && envelope.target.candidateMembershipVersion === currentSource.membershipVersion
    && envelope.sourceRef.decisionContextId === currentSource.decisionContextId
    && envelope.sourceRef.decisionContextHash === currentSource.decisionContextHash;
  if (exactIdentityMatch) {
    return {
      envelope,
      relation: "current_source",
      usableAsCurrentSource: true,
      message: "Source signature matches the current local workflow; this remains unofficial local retrospective assistance, not an official fact."
    };
  }
  return {
    envelope,
    relation: "historical_source",
    usableAsCurrentSource: false,
    message: "Source signature, membership identity, membership version, or decision-context identity differs from the current workflow; this entry is visibly historical and is never silently reused as current evidence."
  };
}

function emptyFailure(
  state: "missing" | "source_unavailable" | "mismatch" | "malformed" | "storage_unavailable",
  message: string
): AssistReviewKnowledgeLoadResult {
  return { ok: false, state, entries: [], currentEntries: [], historicalEntries: [], message };
}

function clampKnowledgeFields(fields: AssistReviewKnowledgeFields): AssistReviewKnowledgeFields {
  return {
    evidenceLesson: String(fields.evidenceLesson ?? "").slice(0, 4000),
    processLesson: String(fields.processLesson ?? "").slice(0, 4000),
    unresolvedQuestion: String(fields.unresolvedQuestion ?? "").slice(0, 4000),
    uncertaintyNote: String(fields.uncertaintyNote ?? "").slice(0, 4000)
  };
}

function uniqueBoundedIds(values: string[], field: string): string[] {
  if (!Array.isArray(values)) throw new Error(`${field} must be an array`);
  const normalized = values.map((value) => requireText(value, field, 500));
  if (normalized.length > 100) throw new Error(`${field} must contain at most 100 IDs`);
  if (new Set(normalized).size !== normalized.length) throw new Error(`${field} must not contain duplicate IDs`);
  return normalized;
}

function requireCanonicalSymbol(value: string): string {
  const symbol = value.trim().toUpperCase();
  if (!/^HK\.\d{5}$/.test(symbol)) throw new Error("knowledge requires a canonical HK five-digit symbol");
  return symbol;
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
  return value;
}

function requireIso(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a valid date-time`);
  return new Date(parsed).toISOString();
}

function requireDeletionInstant(value: string): string { return requireIso(value, "deletedAt"); }

function requireText(value: string, field: string, maximumLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must be a non-empty string`);
  if (normalized.length > maximumLength) throw new Error(`${field} must be at most ${maximumLength} characters`);
  return normalized;
}

function normalizeOptionalText(value: string | null, maximumLength: number): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maximumLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
