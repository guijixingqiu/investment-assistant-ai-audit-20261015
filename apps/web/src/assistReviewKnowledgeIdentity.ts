export interface AssistReviewKnowledgeCurrentSourceIdentity {
  sourceSignature: string;
  membershipId: string;
  membershipVersion: number;
  decisionContextId: string | null;
  decisionContextHash: string | null;
}

export interface AssistReviewKnowledgeIdentityBoundInput {
  symbol: string;
  membershipId: string;
  membershipVersion: number;
  sourceSignature: string;
  decisionContextId: string | null;
  decisionContextHash: string | null;
}

export interface AssistReviewKnowledgeStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class AssistReviewKnowledgeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistReviewKnowledgeConflictError";
  }
}

export class AssistReviewKnowledgeStorageError extends Error {
  constructor(public readonly operation: "read" | "save" | "clear", cause?: unknown) {
    super(`Browser localStorage knowledge ${operation} failed.`);
    this.name = "AssistReviewKnowledgeStorageError";
    if (cause !== undefined) this.cause = cause;
  }
}

export function assistReviewKnowledgeStorageKey(membershipId: string, symbol: string): string {
  return `assist-local-review-knowledge-v2:${encodeURIComponent(requireText(membershipId, "membershipId", 500))}:${canonicalSymbol(symbol)}`;
}

export function assistReviewKnowledgeDeletionStorageKey(membershipId: string, symbol: string): string {
  return `assist-local-review-knowledge-deletion-v1:${encodeURIComponent(requireText(membershipId, "membershipId", 500))}:${canonicalSymbol(symbol)}`;
}

export function isUsableAssistReviewKnowledgeIdentity(
  value: AssistReviewKnowledgeCurrentSourceIdentity | null
): value is AssistReviewKnowledgeCurrentSourceIdentity {
  if (!value) return false;
  const contextsMatch = (value.decisionContextId === null) === (value.decisionContextHash === null);
  return value.membershipId.trim().length > 0
    && Number.isInteger(value.membershipVersion)
    && value.membershipVersion > 0
    && value.sourceSignature.trim().length > 0
    && contextsMatch
    && (value.decisionContextId === null || value.decisionContextId.trim().length > 0)
    && (value.decisionContextHash === null || value.decisionContextHash.trim().length > 0);
}

export function requireAssistReviewKnowledgeIdentityForSymbol(
  currentSource: AssistReviewKnowledgeCurrentSourceIdentity,
  symbol: string
): void {
  canonicalSymbol(symbol);
  if (!isUsableAssistReviewKnowledgeIdentity(currentSource)) {
    throw new AssistReviewKnowledgeConflictError("Current membership and source identity are unavailable; local knowledge storage was not accessed.");
  }
}

export function requireMatchingAssistReviewKnowledgeIdentity(
  input: AssistReviewKnowledgeIdentityBoundInput,
  currentSource: AssistReviewKnowledgeCurrentSourceIdentity
): void {
  requireAssistReviewKnowledgeIdentityForSymbol(currentSource, input.symbol);
  if (input.membershipId !== currentSource.membershipId
    || input.membershipVersion !== currentSource.membershipVersion
    || input.sourceSignature !== currentSource.sourceSignature
    || input.decisionContextId !== currentSource.decisionContextId
    || input.decisionContextHash !== currentSource.decisionContextHash) {
    throw new AssistReviewKnowledgeConflictError("Knowledge save identity does not match the current verified membership and source identity.");
  }
}

function canonicalSymbol(value: string): string {
  const symbol = value.trim().toUpperCase();
  if (!/^HK\.\d{5}$/.test(symbol)) throw new Error("knowledge requires a canonical HK five-digit symbol");
  return symbol;
}

function requireText(value: string, field: string, maximumLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) throw new Error(`${field} must be non-empty and at most ${maximumLength} characters`);
  return normalized;
}
