import {
  ASSIST_LOCAL_RECORD_SCHEMA_VERSION,
  validateAssistLocalRecordEnvelope,
  type AssistLocalRecordEnvelope
} from "../../../packages/contracts/src/assistLocalRecordBrowser.js";

export interface AssistLocalRecordDrafts {
  researchThought: string;
  decisionThought: string;
  evidenceGapNote: string;
  laterReviewNote: string;
}

export const emptyAssistLocalRecordDrafts: AssistLocalRecordDrafts = {
  researchThought: "",
  decisionThought: "",
  evidenceGapNote: "",
  laterReviewNote: ""
};

export interface AssistLocalRecordStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AssistLocalRecordLifecycleSemantics {
  key: string;
  webState: string;
  iosState: string;
  display: string;
}

export interface AssistLocalRecordBuildInput {
  sourceSignature: string;
  symbol: string;
  membershipId: string;
  decisionContextId: string | null;
  decisionContextHash: string | null;
  followUpWorkflowGeneratedAt: string | null;
  decisionNoteWorkflowGeneratedAt: string | null;
  fields: AssistLocalRecordDrafts;
  nowIso: string;
}

export type AssistLocalRecordLoadResult =
  | { ok: true; state: "loaded"; envelope: AssistLocalRecordEnvelope; fields: AssistLocalRecordDrafts; message: string }
  | { ok: false; state: "missing" | "mismatch" | "malformed"; fields: AssistLocalRecordDrafts; message: string };

export function assistLocalRecordStorageKey(sourceSignature: string): string {
  return `assist-local-record-v1:${sourceSignature}`;
}

export function assistLocalRecordDeletionStorageKey(sourceSignature: string): string {
  return `assist-local-record-deletion-v1:${sourceSignature}`;
}

export function assistLocalRecordLifecycleSemantics(): AssistLocalRecordLifecycleSemantics[] {
  return [
    {
      key: "save-current-source",
      webState: "saved_local",
      iosState: "saved_local",
      display: "Save writes only the current source-signature browser localStorage or iOS UserDefaults envelope; it is local-only, unofficial, not API uploaded, not database written, and not broker synced."
    },
    {
      key: "save-source-unavailable",
      webState: "fail_closed",
      iosState: "fail_closed",
      display: "Save is blocked when the current source signature is unavailable; displayed drafts are cleared or kept display-only and no stale saved thought is promoted."
    },
    {
      key: "load-current-source",
      webState: "saved_local",
      iosState: "loaded",
      display: "Load restores only a contract-valid record whose source signature matches the current candidate, membership version, decision context, follow-up workflow, and decision-note workflow."
    },
    {
      key: "load-missing",
      webState: "available",
      iosState: "missing",
      display: "Missing storage is an explicit empty local-record state for the current source; it is not an unauthorized success, server success, or official review record."
    },
    {
      key: "load-mismatch",
      webState: "mismatch",
      iosState: "mismatch",
      display: "Source-signature mismatch clears displayed fields, hides saved thoughts, and never reuses cross-candidate or cross-source records."
    },
    {
      key: "load-malformed",
      webState: "malformed",
      iosState: "malformed",
      display: "Malformed, unsafe, wrong-scope, or missing-snapshot records are rejected fail-closed, removed for the current source when possible, and never receive fabricated backfill."
    },
    {
      key: "storage-unavailable",
      webState: "storage_unavailable",
      iosState: "storage_unavailable",
      display: "Storage unavailable keeps drafts display-only, prevents saved-record load claims, and sends nothing to API, database, broker, official review, or portfolio facts."
    },
    {
      key: "clear-confirm",
      webState: "confirm_clear",
      iosState: "confirm_clear",
      display: "Clear requires confirmation before deleting only the current source-signature local envelope; API facts and official review history are untouched."
    },
    {
      key: "clear-complete",
      webState: "available",
      iosState: "available",
      display: "Clear completion empties displayed drafts, removes only the current local envelope, and keeps a source-scoped tombstone so stale archives cannot restore it; no other source record is touched."
    },
    {
      key: "fail-closed-source",
      webState: "fail_closed",
      iosState: "fail_closed",
      display: "No-selected-candidate, stale, unauthorized, conflict, offline, malformed, unavailable, not-found, superseded, and source-change states hide saved records and stale local drafts."
    }
  ];
}

export function buildAssistLocalRecordEnvelope(input: AssistLocalRecordBuildInput): AssistLocalRecordEnvelope {
  const payload: AssistLocalRecordEnvelope = {
    schemaVersion: ASSIST_LOCAL_RECORD_SCHEMA_VERSION,
    recordId: `assist-local-record:${input.sourceSignature}`,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
    storageScope: "browser_local_storage",
    target: {
      market: "HK",
      code: input.symbol.replace(/^HK\./, ""),
      symbol: input.symbol,
      candidateMembershipId: input.membershipId
    },
    sourceRef: {
      sourceSignature: input.sourceSignature,
      decisionContextId: input.decisionContextId,
      decisionContextHash: input.decisionContextHash,
      followUpWorkflowGeneratedAt: input.followUpWorkflowGeneratedAt,
      decisionNoteWorkflowGeneratedAt: input.decisionNoteWorkflowGeneratedAt
    },
    metadata: {
      source: "browser_local_storage",
      asOf: input.nowIso,
      fetchedAt: null,
      freshness: "fresh",
      provenance: "local_only",
      authority: "local_only",
      stale: false,
      missing: false,
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message: "Browser local record metadata is local-only and unofficial; it is not an official review, portfolio, broker, accounting, cash, fee, position, transaction, or production fact."
    },
    fields: clampAssistLocalRecordDrafts(input.fields),
    safety: {
      localOnly: true,
      unofficial: true,
      officialRecord: false,
      serverPersisted: false,
      sent: false,
      brokerSynced: false,
      portfolioFact: false,
      productionFact: false,
      noRecommendation: true,
      noRanking: true,
      noScoring: true,
      noBuySellHold: true,
      noTrading: true,
      noBroker: true,
      noPortfolioMutation: true
    },
    message: "Saved to browser localStorage only; unofficial, not uploaded to any API, not written to any database, not server persisted, not sent, not broker synced, and not an official review, trading, or portfolio fact."
  };
  const validation = validateAssistLocalRecordEnvelope(payload);
  if (!validation.ok) {
    throw new Error(`local record payload failed validation: ${validation.errors.join("; ")}`);
  }
  return payload;
}

export function saveAssistLocalRecordToStorage(
  storage: AssistLocalRecordStorageLike,
  input: AssistLocalRecordBuildInput
): AssistLocalRecordEnvelope {
  const envelope = buildAssistLocalRecordEnvelope(input);
  storage.setItem(assistLocalRecordStorageKey(input.sourceSignature), JSON.stringify(envelope));
  storage.removeItem(assistLocalRecordDeletionStorageKey(input.sourceSignature));
  return envelope;
}

export function loadAssistLocalRecordFromStorage(
  storage: AssistLocalRecordStorageLike,
  sourceSignature: string
): AssistLocalRecordLoadResult {
  const deletedAt = storage.getItem(assistLocalRecordDeletionStorageKey(sourceSignature));
  if (deletedAt !== null) {
    return Number.isFinite(Date.parse(deletedAt))
      ? { ok: false, state: "missing", fields: { ...emptyAssistLocalRecordDrafts }, message: `Owner deleted this local record at ${deletedAt}; the source-scoped tombstone prevents stale restoration.` }
      : malformed("Saved local record deletion tombstone is malformed; display cleared and stale content is not reused.");
  }
  const raw = storage.getItem(assistLocalRecordStorageKey(sourceSignature));
  if (!raw) {
    return {
      ok: false,
      state: "missing",
      fields: { ...emptyAssistLocalRecordDrafts },
      message: "No saved local record exists for the current source signature."
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return malformed("Saved local record is malformed; display cleared and stale content is not reused.");
  }

  const validation = validateAssistLocalRecordEnvelope(parsed);
  if (!validation.ok) {
    const prefix = assistLocalRecordMissingSnapshotAuthority(validation.errors)
      ? "Saved local record is missing required snapshot/source authority; display cleared, stale content is not reused, and no fabricated backfill is created."
      : "Saved local record failed contract validation; display cleared and stale content is not reused.";
    return malformed(`${prefix} ${validation.errors.join("; ")}`);
  }

  const envelope = parsed as AssistLocalRecordEnvelope;
  if (envelope.storageScope !== "browser_local_storage") {
    return malformed("Saved local record storage scope is not browser localStorage; display cleared and stale content is not reused.");
  }
  if (envelope.sourceRef.sourceSignature !== sourceSignature) {
    return {
      ok: false,
      state: "mismatch",
      fields: { ...emptyAssistLocalRecordDrafts },
      message: "Saved local record source signature does not match current facts; display cleared."
    };
  }
  const expectedIdentity = assistLocalRecordIdentityFromSourceSignature(sourceSignature);
  if (!expectedIdentity
    || envelope.recordId !== `assist-local-record:${sourceSignature}`
    || envelope.target.symbol !== expectedIdentity.symbol
    || envelope.target.code !== expectedIdentity.code
    || envelope.target.candidateMembershipId !== expectedIdentity.membershipId) {
    return {
      ok: false,
      state: "mismatch",
      fields: { ...emptyAssistLocalRecordDrafts },
      message: "Saved local record target symbol, membership, or record identity does not match current facts; display cleared."
    };
  }

  return {
    ok: true,
    state: "loaded",
    envelope,
    fields: clampAssistLocalRecordDrafts(envelope.fields),
    message: "Loaded a saved browser-local unofficial record for the current source signature only."
  };
}

export function clearAssistLocalRecordFromStorage(storage: AssistLocalRecordStorageLike, sourceSignature: string): void {
  storage.removeItem(assistLocalRecordStorageKey(sourceSignature));
}

export function deleteAssistLocalRecordFromStorage(
  storage: AssistLocalRecordStorageLike,
  sourceSignature: string,
  deletedAt = new Date().toISOString()
): string {
  if (!Number.isFinite(Date.parse(deletedAt))) throw new Error("Local record deletion time is invalid.");
  const deletionKey = assistLocalRecordDeletionStorageKey(sourceSignature);
  storage.setItem(deletionKey, deletedAt);
  if (storage.getItem(deletionKey) !== deletedAt) throw new Error("Local record deletion tombstone was not persisted.");
  try { storage.removeItem(assistLocalRecordStorageKey(sourceSignature)); } catch { /* tombstone still hides stale content */ }
  return deletedAt;
}

export function removeRejectedAssistLocalRecordFromStorage(
  storage: AssistLocalRecordStorageLike,
  sourceSignature: string
): string {
  clearAssistLocalRecordFromStorage(storage, sourceSignature);
  return "Rejected saved local record was removed from this browser for the current source signature only.";
}

export function describeAssistLocalRecordSnapshot(envelope: AssistLocalRecordEnvelope): string[] {
  return [
    `Saved local record snapshot: storage=${envelope.storageScope}; updatedAt=${envelope.updatedAt}.`,
    `Saved target: ${envelope.target.symbol} / membership=${envelope.target.candidateMembershipId}.`,
    `Source snapshot: decisionContext=${envelope.sourceRef.decisionContextId ?? "missing"}; contextHash=${envelope.sourceRef.decisionContextHash ?? "missing"}.`,
    `Workflow snapshot: followUpGeneratedAt=${envelope.sourceRef.followUpWorkflowGeneratedAt ?? "missing"}; decisionNoteGeneratedAt=${envelope.sourceRef.decisionNoteWorkflowGeneratedAt ?? "missing"}.`,
    `Fact metadata: source=${envelope.metadata.source}; asOf=${envelope.metadata.asOf ?? "missing"}; fetchedAt=${envelope.metadata.fetchedAt ?? "missing"}; freshness=${envelope.metadata.freshness}; provenance=${envelope.metadata.provenance}; authority=${envelope.metadata.authority}.`,
    "Snapshot authority: local-only, unofficial, not uploaded to any API, not written to any database, not official review history, not server persisted, not sent, not broker synced, and not a portfolio fact."
  ];
}

function malformed(message: string): AssistLocalRecordLoadResult {
  return {
    ok: false,
    state: "malformed",
    fields: { ...emptyAssistLocalRecordDrafts },
    message
  };
}

function assistLocalRecordMissingSnapshotAuthority(errors: readonly string[]): boolean {
  return errors.some((error) =>
    error.startsWith("sourceRef")
    || error.startsWith("target")
    || error.includes("sourceRef.")
    || error.includes("target.")
    || error.includes("sourceSignature")
    || error.includes("candidateMembershipId")
  );
}

function clampAssistLocalRecordDrafts(fields: AssistLocalRecordDrafts): AssistLocalRecordDrafts {
  return {
    researchThought: fields.researchThought.slice(0, 4000),
    decisionThought: fields.decisionThought.slice(0, 4000),
    evidenceGapNote: fields.evidenceGapNote.slice(0, 4000),
    laterReviewNote: fields.laterReviewNote.slice(0, 4000)
  };
}

function assistLocalRecordIdentityFromSourceSignature(
  sourceSignature: string
): { membershipId: string; symbol: string; code: string } | null {
  const parts = sourceSignature.split("|");
  if (parts.length !== 9) return null;
  const [membershipId, membershipVersion, symbol] = parts;
  if (!membershipId || !/^membership-version-[1-9]\d*$/.test(membershipVersion ?? "")) return null;
  const match = /^(HK)\.(\d{5})$/.exec(symbol ?? "");
  if (!match) return null;
  return { membershipId, symbol: `${match[1]}.${match[2]}`, code: match[2] ?? "" };
}
