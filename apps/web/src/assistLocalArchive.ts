import type { AssistLocalRecordEnvelope } from "../../../packages/contracts/src/assistLocalRecordBrowser.js";
import type { AssistReviewKnowledgeCollection } from "../../../packages/contracts/src/assistReviewKnowledgeBrowser.js";
import type { ResearchEvidenceQuestionContextTurn } from "../../../packages/contracts/src/researchEvidenceQuestion.js";
import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import { sha256Hex } from "../../../packages/contracts/src/sha256.js";
import {
  assistLocalRecordDeletionStorageKey,
  assistLocalRecordStorageKey,
  loadAssistLocalRecordFromStorage,
  type AssistLocalRecordStorageLike
} from "./assistLocalRecordState.js";
import {
  loadAssistReviewKnowledgeFromStorage,
  readAssistReviewKnowledgeDeletionState,
  type AssistReviewKnowledgeDeletionState
} from "./assistReviewKnowledgeState.js";
import {
  assistReviewKnowledgeDeletionStorageKey,
  assistReviewKnowledgeStorageKey,
  type AssistReviewKnowledgeCurrentSourceIdentity
} from "./assistReviewKnowledgeIdentity.js";

const ASSIST_LOCAL_ARCHIVE_SCHEMA_VERSION_V1 = "2026-08-19.web-local-research-archive.v1";
const ASSIST_LOCAL_ARCHIVE_SCHEMA_VERSION_V2 = "2026-08-19.web-local-research-archive.v2";
const ASSIST_LOCAL_ARCHIVE_SCHEMA_VERSION_V3 = "2026-08-19.web-local-research-archive.v3";
export const ASSIST_LOCAL_ARCHIVE_SCHEMA_VERSION = "2026-08-19.web-local-research-archive.v4";
export const ASSIST_LOCAL_ARCHIVE_TEMPORARY_CONVERSATION_SCHEMA_VERSION = "2026-08-19.web-report-assistant-conversation.v1";
const MAX_ARCHIVE_CHARACTERS = 2_000_000;

export interface AssistLocalArchiveIdentity {
  symbol: string;
  sourceSignature: string;
  currentSource: AssistReviewKnowledgeCurrentSourceIdentity;
}

export interface AssistLocalArchiveTemporaryConversation {
  schemaVersion: typeof ASSIST_LOCAL_ARCHIVE_TEMPORARY_CONVERSATION_SCHEMA_VERSION;
  sourceKey: string;
  actorId: string;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  reportId: string;
  reportVersion: number;
  reportFingerprint: string;
  evidencePackId: string;
  evidencePackFingerprint: string;
  savedAt: string;
  expiresAt: string;
  questionDraft: string;
  conversation: ResearchEvidenceQuestionContextTurn[];
}

export interface AssistLocalArchive {
  schemaVersion: typeof ASSIST_LOCAL_ARCHIVE_SCHEMA_VERSION;
  exportedAt: string;
  symbol: string;
  sourceSignature: string;
  localRecord: AssistLocalRecordEnvelope | null;
  localRecordDeletion: string | null;
  reviewKnowledge: AssistReviewKnowledgeCollection | null;
  reviewKnowledgeDeletion: AssistReviewKnowledgeDeletionState | null;
  temporaryConversation: AssistLocalArchiveTemporaryConversation | null;
  payloadHash: string;
}

export function buildAssistLocalArchive(
  storage: AssistLocalRecordStorageLike,
  identity: AssistLocalArchiveIdentity,
  exportedAt = new Date().toISOString(),
  temporaryConversation: AssistLocalArchiveTemporaryConversation | null = null
): AssistLocalArchive {
  const local = loadAssistLocalRecordFromStorage(storage, identity.sourceSignature);
  const localRecordDeletion = storage.getItem(assistLocalRecordDeletionStorageKey(identity.sourceSignature));
  if (localRecordDeletion !== null && !Number.isFinite(Date.parse(localRecordDeletion))) throw new Error("Local record deletion tombstone is malformed.");
  if (!local.ok && local.state !== "missing") throw new Error(local.message);
  const knowledge = loadAssistReviewKnowledgeFromStorage(storage, identity.symbol, identity.currentSource);
  const reviewKnowledgeDeletion = readAssistReviewKnowledgeDeletionState(
    storage, identity.currentSource.membershipId, identity.symbol
  );
  if (!knowledge.ok && knowledge.state !== "missing") throw new Error(knowledge.message);
  if (temporaryConversation !== null && !temporaryConversationMatchesArchive(temporaryConversation, identity, exportedAt)) {
    throw new Error("Temporary report conversation is malformed.");
  }
  const payload = {
    schemaVersion: ASSIST_LOCAL_ARCHIVE_SCHEMA_VERSION as typeof ASSIST_LOCAL_ARCHIVE_SCHEMA_VERSION,
    exportedAt,
    symbol: identity.symbol,
    sourceSignature: identity.sourceSignature,
    localRecord: localRecordDeletion === null && local.ok ? local.envelope : null,
    localRecordDeletion,
    reviewKnowledge: knowledge.ok ? knowledge.collection : null,
    reviewKnowledgeDeletion,
    temporaryConversation
  };
  return { ...payload, payloadHash: sha256Hex(canonicalJson(payload)) };
}

export function restoreAssistLocalArchive(
  storage: AssistLocalRecordStorageLike,
  raw: string,
  identity: AssistLocalArchiveIdentity
): AssistLocalArchive {
  if (raw.length === 0 || raw.length > MAX_ARCHIVE_CHARACTERS) throw new Error("Local archive size is invalid.");
  const parsed: unknown = JSON.parse(raw);
  if (!record(parsed)) throw new Error("Local archive shape is invalid.");
  const legacy = parsed.schemaVersion === ASSIST_LOCAL_ARCHIVE_SCHEMA_VERSION_V1;
  const legacyV2 = parsed.schemaVersion === ASSIST_LOCAL_ARCHIVE_SCHEMA_VERSION_V2;
  const legacyV3 = parsed.schemaVersion === ASSIST_LOCAL_ARCHIVE_SCHEMA_VERSION_V3;
  const expectedKeys = legacy
    ? ["exportedAt", "localRecord", "payloadHash", "reviewKnowledge", "schemaVersion", "sourceSignature", "symbol"]
    : legacyV2
      ? ["exportedAt", "localRecord", "localRecordDeletion", "payloadHash", "reviewKnowledge", "schemaVersion", "sourceSignature", "symbol"]
      : legacyV3
        ? ["exportedAt", "localRecord", "localRecordDeletion", "payloadHash", "reviewKnowledge", "reviewKnowledgeDeletion", "schemaVersion", "sourceSignature", "symbol"]
        : ["exportedAt", "localRecord", "localRecordDeletion", "payloadHash", "reviewKnowledge", "reviewKnowledgeDeletion", "schemaVersion", "sourceSignature", "symbol", "temporaryConversation"];
  if (Object.keys(parsed).sort().join("|") !== expectedKeys.sort().join("|")) throw new Error("Local archive shape is invalid.");
  const stored = parsed as unknown as Omit<AssistLocalArchive, "localRecordDeletion" | "reviewKnowledgeDeletion" | "temporaryConversation"> & {
    localRecordDeletion?: string | null;
    reviewKnowledgeDeletion?: AssistReviewKnowledgeDeletionState | null;
    temporaryConversation?: AssistLocalArchiveTemporaryConversation | null;
  };
  const { payloadHash, ...storedPayload } = stored;
  if (!legacy && !legacyV2 && !legacyV3 && stored.schemaVersion !== ASSIST_LOCAL_ARCHIVE_SCHEMA_VERSION
    || stored.symbol !== identity.symbol || stored.sourceSignature !== identity.sourceSignature
    || stored.localRecordDeletion !== undefined && stored.localRecordDeletion !== null && !Number.isFinite(Date.parse(stored.localRecordDeletion))
    || stored.localRecordDeletion != null && stored.localRecord !== null
    || stored.temporaryConversation !== undefined && stored.temporaryConversation !== null
      && !temporaryConversationMatchesArchive(stored.temporaryConversation, identity, stored.exportedAt)
    || !Number.isFinite(Date.parse(stored.exportedAt))
    || !/^[a-f0-9]{64}$/.test(payloadHash)
    || sha256Hex(canonicalJson(storedPayload)) !== payloadHash) throw new Error("Local archive identity or hash is invalid.");
  const payload = {
    ...storedPayload,
    schemaVersion: ASSIST_LOCAL_ARCHIVE_SCHEMA_VERSION as typeof ASSIST_LOCAL_ARCHIVE_SCHEMA_VERSION,
    localRecordDeletion: stored.localRecordDeletion ?? null,
    reviewKnowledgeDeletion: stored.reviewKnowledgeDeletion ?? null,
    temporaryConversation: stored.temporaryConversation ?? null
  };
  const localKey = assistLocalRecordStorageKey(identity.sourceSignature);
  const deletionKey = assistLocalRecordDeletionStorageKey(identity.sourceSignature);
  const knowledgeKey = assistReviewKnowledgeStorageKey(identity.currentSource.membershipId, identity.symbol);
  const knowledgeDeletionKey = assistReviewKnowledgeDeletionStorageKey(identity.currentSource.membershipId, identity.symbol);
  const effectiveReviewDeletion = mergeReviewKnowledgeDeletions(
    readAssistReviewKnowledgeDeletionState(storage, identity.currentSource.membershipId, identity.symbol),
    payload.reviewKnowledgeDeletion
  );
  const effectivePayload = { ...payload, reviewKnowledgeDeletion: effectiveReviewDeletion };
  const candidateArchive: AssistLocalArchive = { ...effectivePayload, payloadHash: sha256Hex(canonicalJson(effectivePayload)) };
  const currentDeletion = storage.getItem(deletionKey);
  if (currentDeletion !== null && (!Number.isFinite(Date.parse(currentDeletion))
    || candidateArchive.localRecordDeletion === null || Date.parse(currentDeletion) > Date.parse(candidateArchive.localRecordDeletion))) {
    throw new Error("A current local-record deletion tombstone blocks stale archive restoration.");
  }

  const memory = memoryStorage(
    localKey, candidateArchive.localRecord,
    deletionKey, candidateArchive.localRecordDeletion,
    knowledgeKey, candidateArchive.reviewKnowledge,
    knowledgeDeletionKey, candidateArchive.reviewKnowledgeDeletion
  );
  const local = loadAssistLocalRecordFromStorage(memory, identity.sourceSignature);
  const knowledge = loadAssistReviewKnowledgeFromStorage(memory, identity.symbol, identity.currentSource);
  if (candidateArchive.localRecord !== null ? !local.ok : local.ok || local.state !== "missing") throw new Error("Local record archive validation failed.");
  if (!knowledge.ok && knowledge.state !== "missing") throw new Error("Review knowledge archive validation failed.");
  const restoredPayload = { ...effectivePayload, reviewKnowledge: knowledge.ok ? knowledge.collection : null };
  const archive: AssistLocalArchive = { ...restoredPayload, payloadHash: sha256Hex(canonicalJson(restoredPayload)) };

  const before = [storage.getItem(localKey), storage.getItem(deletionKey), storage.getItem(knowledgeKey), storage.getItem(knowledgeDeletionKey)] as const;
  try {
    write(storage, localKey, archive.localRecord);
    writeRaw(storage, deletionKey, archive.localRecordDeletion);
    write(storage, knowledgeKey, knowledge.ok ? knowledge.collection : null);
    write(storage, knowledgeDeletionKey, archive.reviewKnowledgeDeletion);
  } catch (error) {
    writeRaw(storage, localKey, before[0]);
    writeRaw(storage, deletionKey, before[1]);
    writeRaw(storage, knowledgeKey, before[2]);
    writeRaw(storage, knowledgeDeletionKey, before[3]);
    throw error;
  }
  return archive;
}

export function assistLocalArchiveOperationFingerprint(
  storage: AssistLocalRecordStorageLike,
  identity: AssistLocalArchiveIdentity,
  temporaryConversationState: string | null = null
): string {
  return sha256Hex(canonicalJson({
    identity,
    localRecord: storage.getItem(assistLocalRecordStorageKey(identity.sourceSignature)),
    localRecordDeletion: storage.getItem(assistLocalRecordDeletionStorageKey(identity.sourceSignature)),
    reviewKnowledge: storage.getItem(assistReviewKnowledgeStorageKey(identity.currentSource.membershipId, identity.symbol)),
    reviewKnowledgeDeletion: storage.getItem(assistReviewKnowledgeDeletionStorageKey(identity.currentSource.membershipId, identity.symbol)),
    temporaryConversationState
  }));
}

export function validateAssistLocalArchiveTemporaryConversation(
  value: unknown
): value is AssistLocalArchiveTemporaryConversation {
  if (!record(value) || Object.keys(value).sort().join("|") !== [
    "actorId", "conversation", "evidencePackFingerprint", "evidencePackId", "expiresAt",
    "membershipId", "membershipVersion", "questionDraft", "reportFingerprint", "reportId",
    "reportVersion", "savedAt", "schemaVersion", "sourceKey", "symbol"
  ].sort().join("|")) return false;
  const savedAt = Date.parse(String(value.savedAt));
  const expiresAt = Date.parse(String(value.expiresAt));
  if (value.schemaVersion !== ASSIST_LOCAL_ARCHIVE_TEMPORARY_CONVERSATION_SCHEMA_VERSION
    || !boundedText(value.sourceKey, 2_000) || !boundedText(value.actorId, 500)
    || !positiveId(value.membershipId) || !Number.isInteger(value.membershipVersion) || Number(value.membershipVersion) < 1
    || typeof value.symbol !== "string" || !/^HK\.\d{5}$/.test(value.symbol)
    || !positiveId(value.reportId) || !Number.isInteger(value.reportVersion) || Number(value.reportVersion) < 1
    || !sha256(value.reportFingerprint) || !positiveId(value.evidencePackId) || !sha256(value.evidencePackFingerprint)
    || !Number.isFinite(savedAt) || !Number.isFinite(expiresAt) || expiresAt <= savedAt || expiresAt > savedAt + 30 * 86_400_000
    || typeof value.questionDraft !== "string" || value.questionDraft !== value.questionDraft.trim() || value.questionDraft.length > 1_000
    || !Array.isArray(value.conversation) || value.conversation.length > 8
    || value.conversation.length === 0 && value.questionDraft.length === 0) return false;
  let characters = 0;
  for (const turn of value.conversation) {
    if (!record(turn) || Object.keys(turn).sort().join("|") !== ["answer", "question", "reportFingerprint"].join("|")
      || turn.reportFingerprint !== value.reportFingerprint || !boundedText(turn.question, 1_000)
      || !boundedText(turn.answer, 12_000)) return false;
    characters += turn.question.length + turn.answer.length;
  }
  return characters <= 24_000;
}

export function downloadAssistLocalArchive(archive: AssistLocalArchive): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `research-memory-${archive.symbol}-${archive.exportedAt.slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function bindAssistLocalArchiveEvents(
  documentRef: Document,
  exportArchive: () => void,
  importArchive: (file: File) => void
): void {
  documentRef.querySelector("button[data-local-archive-action='export']")?.addEventListener("click", exportArchive);
  documentRef.getElementById("assist-local-archive-import")?.addEventListener("change", (event) => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
    importArchive(input.files[0]);
    input.value = "";
  });
}

function memoryStorage(
  localKey: string, local: unknown,
  deletionKey: string, deletion: string | null,
  knowledgeKey: string, knowledge: unknown,
  knowledgeDeletionKey: string, knowledgeDeletion: unknown
): AssistLocalRecordStorageLike {
  const values = new Map<string, string>();
  if (local !== null) values.set(localKey, JSON.stringify(local));
  if (deletion !== null) values.set(deletionKey, deletion);
  if (knowledge !== null) values.set(knowledgeKey, JSON.stringify(knowledge));
  if (knowledgeDeletion !== null) values.set(knowledgeDeletionKey, JSON.stringify(knowledgeDeletion));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
}

function mergeReviewKnowledgeDeletions(
  current: AssistReviewKnowledgeDeletionState | null,
  incoming: AssistReviewKnowledgeDeletionState | null
): AssistReviewKnowledgeDeletionState | null {
  if (!current) return incoming;
  if (!incoming) return current;
  const entries = new Map(current.entries.map((item) => [item.knowledgeId, item]));
  for (const item of incoming.entries) {
    const existing = entries.get(item.knowledgeId);
    if (!existing || Date.parse(item.deletedAt) > Date.parse(existing.deletedAt)) entries.set(item.knowledgeId, item);
  }
  const collectionClearedAt = [current.collectionClearedAt, incoming.collectionClearedAt]
    .filter((value): value is string => value !== null).sort().at(-1) ?? null;
  return { ...current, collectionClearedAt, entries: [...entries.values()].sort((left, right) =>
    right.deletedAt.localeCompare(left.deletedAt) || right.knowledgeId.localeCompare(left.knowledgeId)) };
}

function write(storage: AssistLocalRecordStorageLike, key: string, value: unknown): void {
  writeRaw(storage, key, value === null ? null : JSON.stringify(value));
}
function writeRaw(storage: AssistLocalRecordStorageLike, key: string, value: string | null): void {
  if (value === null) storage.removeItem(key); else storage.setItem(key, value);
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function positiveId(value: unknown): boolean { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function sha256(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function boundedText(value: unknown, maximum: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum; }
function temporaryConversationMatchesIdentity(value: AssistLocalArchiveTemporaryConversation, identity: AssistLocalArchiveIdentity): boolean {
  return value.symbol === identity.symbol && value.membershipId === identity.currentSource.membershipId
    && value.membershipVersion === identity.currentSource.membershipVersion;
}
function temporaryConversationMatchesArchive(value: unknown, identity: AssistLocalArchiveIdentity, exportedAt: unknown): value is AssistLocalArchiveTemporaryConversation {
  return validateAssistLocalArchiveTemporaryConversation(value)
    && temporaryConversationMatchesIdentity(value, identity)
    && typeof exportedAt === "string" && Date.parse(value.savedAt) <= Date.parse(exportedAt);
}
