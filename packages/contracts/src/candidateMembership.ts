import type { FactMetadata } from "./factMetadata.js";
import { validateFactMetadataInto } from "./factMetadata.js";
import { areInstantsChronologicallyOrdered } from "./chronology.js";

export const CANDIDATE_MEMBERSHIP_SCHEMA_VERSION = "2026-07-03.core-1d.candidate-membership.v1";

export const CANDIDATE_MEMBERSHIP_STATES = ["tracked", "paused", "archived"] as const;
export const CANDIDATE_MEMBERSHIP_ENVELOPE_STATUSES = ["available", "empty", "unavailable"] as const;
export const CANDIDATE_MEMBERSHIP_WRITE_RESULTS = [
  "created",
  "already_exists",
  "restored",
  "state_changed",
  "unchanged"
] as const;

export type CandidateMembershipState = (typeof CANDIDATE_MEMBERSHIP_STATES)[number];
export type CandidateMembershipEnvelopeStatus = (typeof CANDIDATE_MEMBERSHIP_ENVELOPE_STATUSES)[number];
export type CandidateMembershipWriteResult = (typeof CANDIDATE_MEMBERSHIP_WRITE_RESULTS)[number];

export interface CandidateMembershipResearchState {
  status: "available" | "missing";
  profileUpdatedAt: string | null;
  nextReviewOn?: string | null;
  name: string | null;
}

export interface CandidateMembershipQuoteState {
  status: "fresh" | "stale" | "unavailable";
  source: string | null;
  fetchedAt: string | null;
  staleReason: "quote_time_exceeds_live_max_age" | "quote_chronology_conflict" | "no_persisted_quote" | "repository_error" | null;
}

export interface CandidateMembershipData {
  id: string;
  actorId: string;
  market: "HK";
  code: string;
  symbol: string;
  state: CandidateMembershipState;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  provenance: {
    membership: "candidate_memberships";
    research: "research_profiles" | "missing";
    quotes: "persisted_market_quotes" | "unavailable";
    portfolio: "omitted";
  };
  research: CandidateMembershipResearchState;
  quote: CandidateMembershipQuoteState;
  safety: CandidateMembershipSafety;
}

export interface CandidateMembershipSafety {
  createsOrder: false;
  createsTrade: false;
  mutatesCash: false;
  writesFee: false;
  mutatesPosition: false;
  callsBroker: false;
}

export interface CandidateMembershipEnvelope {
  schemaVersion: typeof CANDIDATE_MEMBERSHIP_SCHEMA_VERSION;
  generatedAt: string;
  status: CandidateMembershipEnvelopeStatus;
  includeArchived: boolean;
  message: string;
  provenance: {
    memberships: "candidate_memberships";
    research: "research_profiles_optional";
    quotes: "persisted_market_quotes_optional";
    portfolio: "omitted";
  };
  metadata: FactMetadata;
  memberships: CandidateMembershipData[];
}

export interface CreateCandidateMembershipRequest {
  market: "HK";
  code: string;
  initialState?: "tracked" | "paused";
  restoreArchived?: boolean;
  idempotencyKey: string;
}

export interface UpdateCandidateMembershipStateRequest {
  state: CandidateMembershipState;
  version: number;
  idempotencyKey: string;
}

export interface CandidateMembershipWriteEnvelope {
  schemaVersion: typeof CANDIDATE_MEMBERSHIP_SCHEMA_VERSION;
  result: CandidateMembershipWriteResult;
  auditEventId: string;
  asOf: string;
  source: {
    actorType: "user" | "system";
    actorId: string;
    correlationId: string;
  };
  data: CandidateMembershipData;
  message: string;
}

export function validateCreateCandidateMembershipRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["request must be an object"] };
  rejectUnknownKeys(value, "request", ["market", "code", "initialState", "restoreArchived", "idempotencyKey"], errors);
  if (value.market !== "HK") errors.push("market must be HK");
  if (typeof value.code !== "string" || !/^\d{5}$/.test(value.code)) errors.push("code must be a canonical five-digit Hong Kong code");
  if (value.initialState !== undefined && value.initialState !== "tracked" && value.initialState !== "paused") {
    errors.push("initialState must be tracked or paused");
  }
  if (value.restoreArchived !== undefined && typeof value.restoreArchived !== "boolean") {
    errors.push("restoreArchived must be a boolean");
  }
  requireNonEmptyString(value.idempotencyKey, "idempotencyKey", errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateUpdateCandidateMembershipStateRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["request must be an object"] };
  rejectUnknownKeys(value, "request", ["state", "version", "idempotencyKey"], errors);
  if (!CANDIDATE_MEMBERSHIP_STATES.includes(value.state as CandidateMembershipState)) {
    errors.push("state must be tracked, paused, or archived");
  }
  if (!Number.isInteger(value.version) || Number(value.version) < 1) {
    errors.push("version must be a positive integer");
  }
  requireNonEmptyString(value.idempotencyKey, "idempotencyKey", errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateCandidateMembershipEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["envelope must be an object"] };
  if (value.schemaVersion !== CANDIDATE_MEMBERSHIP_SCHEMA_VERSION) errors.push(`schemaVersion must be ${CANDIDATE_MEMBERSHIP_SCHEMA_VERSION}`);
  requireIsoTimestamp(value.generatedAt, "generatedAt", errors);
  if (!CANDIDATE_MEMBERSHIP_ENVELOPE_STATUSES.includes(value.status as CandidateMembershipEnvelopeStatus)) errors.push("status must be available, empty, or unavailable");
  if (typeof value.includeArchived !== "boolean") errors.push("includeArchived must be boolean");
  if (typeof value.message !== "string") errors.push("message must be a string");
  validateEnvelopeProvenance(value.provenance, errors);
  validateFactMetadataInto(value.metadata, "metadata", errors);
  if (isRecord(value.metadata)) {
    if (value.status === "available" && value.metadata.freshness !== "fresh") errors.push("metadata.freshness must be fresh when candidate memberships are available");
    if (value.status === "empty" && value.metadata.freshness !== "missing") errors.push("metadata.freshness must be missing when candidate memberships are empty");
    if (value.status === "unavailable" && value.metadata.freshness === "fresh") errors.push("metadata.freshness must not be fresh when candidate memberships are unavailable");
    if (value.metadata.provenance !== "real" && value.metadata.provenance !== "unavailable") errors.push("metadata.provenance must be real or unavailable for candidate memberships");
    if (value.metadata.authority !== "candidate_membership" && value.metadata.authority !== "unavailable") errors.push("metadata.authority must be candidate_membership or unavailable for candidate memberships");
  }
  if (!Array.isArray(value.memberships)) {
    errors.push("memberships must be an array");
  } else {
    const identities = new Set<string>();
    let previousMembership: CandidateMembershipData | null = null;
    for (const membership of value.memberships) {
      if (!isValidMembership(membership)) {
        errors.push("memberships must contain only valid candidate membership records");
        break;
      }
      validateMembershipQuoteChronology(membership, value.generatedAt, "membership quote", errors);
      const key = `${membership.actorId}:${membership.market}:${membership.code}`;
      if (identities.has(key)) {
        errors.push("memberships must contain one logical membership per actorId plus market plus code");
        break;
      }
      identities.add(key);
      if (previousMembership && compareCandidateMembershipOrder(previousMembership, membership) > 0) {
        errors.push("memberships must be ordered by state tracked, paused, archived, then updatedAt descending, then symbol ascending");
        break;
      }
      previousMembership = membership;
    }
  }
  if (value.status === "unavailable" && Array.isArray(value.memberships) && value.memberships.length !== 0) {
    errors.push("unavailable status must not return partial memberships");
  }
  if (value.status === "empty" && Array.isArray(value.memberships) && value.memberships.length !== 0) {
    errors.push("empty status requires an empty membership list");
  }
  if (value.status === "available" && Array.isArray(value.memberships) && value.memberships.length === 0) {
    errors.push("available status requires at least one membership");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateCandidateMembershipWriteEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["write envelope must be an object"] };
  if (value.schemaVersion !== CANDIDATE_MEMBERSHIP_SCHEMA_VERSION) errors.push(`schemaVersion must be ${CANDIDATE_MEMBERSHIP_SCHEMA_VERSION}`);
  if (!CANDIDATE_MEMBERSHIP_WRITE_RESULTS.includes(value.result as CandidateMembershipWriteResult)) errors.push("result must be a supported write result");
  requireNonEmptyString(value.auditEventId, "auditEventId", errors);
  requireIsoTimestamp(value.asOf, "asOf", errors);
  validateWriteSource(value.source, errors);
  if (!isValidMembership(value.data)) errors.push("data must be a valid candidate membership record");
  else validateMembershipQuoteChronology(value.data, value.asOf, "data quote", errors);
  if (typeof value.message !== "string" || value.message.trim().length === 0) errors.push("message must be a non-empty string");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateEnvelopeProvenance(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("provenance must be an object");
    return;
  }
  if (value.memberships !== "candidate_memberships") errors.push("provenance.memberships must be candidate_memberships");
  if (value.research !== "research_profiles_optional") errors.push("provenance.research must be research_profiles_optional");
  if (value.quotes !== "persisted_market_quotes_optional") errors.push("provenance.quotes must be persisted_market_quotes_optional");
  if (value.portfolio !== "omitted") errors.push("provenance.portfolio must be omitted");
}

function isValidMembership(value: unknown): value is CandidateMembershipData {
  if (!isRecord(value)) return false;
  if (!(typeof value.id === "string"
    && typeof value.actorId === "string"
    && value.market === "HK"
    && typeof value.code === "string"
    && /^\d{5}$/.test(value.code)
    && value.symbol === `HK.${value.code}`
    && CANDIDATE_MEMBERSHIP_STATES.includes(value.state as CandidateMembershipState)
    && Number.isInteger(value.version)
    && Number(value.version) >= 1
    && isIsoTimestamp(value.createdAt)
    && isIsoTimestamp(value.updatedAt)
    && (typeof value.archivedAt === "string" || value.archivedAt === null)
    && isValidMembershipProvenance(value.provenance)
    && isValidResearch(value.research)
    && isValidQuote(value.quote)
    && isValidSafety(value.safety))) {
    return false;
  }
  if (value.state === "archived" && value.archivedAt === null) return false;
  if (value.state !== "archived" && value.archivedAt !== null) return false;
  if (value.archivedAt !== null && !isIsoTimestamp(value.archivedAt)) return false;
  const provenance = value.provenance as CandidateMembershipData["provenance"];
  if (provenance.research === "research_profiles" && value.research.status !== "available") return false;
  if (provenance.research === "missing" && value.research.status !== "missing") return false;
  if (provenance.quotes === "persisted_market_quotes" && value.quote.status === "unavailable") return false;
  if (provenance.quotes === "unavailable" && value.quote.status !== "unavailable") return false;
  return true;
}

function compareCandidateMembershipOrder(left: CandidateMembershipData, right: CandidateMembershipData): number {
  const stateOrder: Record<CandidateMembershipState, number> = {
    tracked: 0,
    paused: 1,
    archived: 2
  };
  const stateComparison = stateOrder[left.state] - stateOrder[right.state];
  if (stateComparison !== 0) return stateComparison;
  const updatedComparison = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedComparison !== 0) return updatedComparison;
  return left.symbol.localeCompare(right.symbol);
}

function validateMembershipQuoteChronology(
  membership: CandidateMembershipData,
  generatedAt: unknown,
  field: string,
  errors: string[]
): void {
  if (membership.quote.fetchedAt !== null
    && !areInstantsChronologicallyOrdered([membership.quote.fetchedAt, generatedAt])) {
    errors.push(`${field} fetchedAt must not be after its envelope timestamp`);
  }
}

function isValidMembershipProvenance(value: unknown): boolean {
  return isRecord(value)
    && value.membership === "candidate_memberships"
    && (value.research === "research_profiles" || value.research === "missing")
    && (value.quotes === "persisted_market_quotes" || value.quotes === "unavailable")
    && value.portfolio === "omitted";
}

function isValidResearch(value: unknown): value is CandidateMembershipResearchState {
  return isRecord(value)
    && (value.status === "available" || value.status === "missing")
    && (isIsoTimestamp(value.profileUpdatedAt) || value.profileUpdatedAt === null)
    && (value.nextReviewOn === undefined || value.nextReviewOn === null || isDateOnly(value.nextReviewOn))
    && (typeof value.name === "string" || value.name === null)
    && (value.status === "available" ? value.profileUpdatedAt !== null : value.profileUpdatedAt === null && value.nextReviewOn == null);
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function isValidQuote(value: unknown): value is CandidateMembershipQuoteState {
  return isRecord(value)
    && (value.status === "fresh" || value.status === "stale" || value.status === "unavailable")
    && (typeof value.source === "string" || value.source === null)
    && (isIsoTimestamp(value.fetchedAt) || value.fetchedAt === null)
    && (
      value.staleReason === null
      || value.staleReason === "quote_time_exceeds_live_max_age"
      || value.staleReason === "quote_chronology_conflict"
      || value.staleReason === "no_persisted_quote"
      || value.staleReason === "repository_error"
    )
    && (value.status === "fresh" ? value.source !== null && value.fetchedAt !== null && value.staleReason === null : true)
    && (value.status === "stale" ? value.source !== null && value.fetchedAt !== null && value.staleReason === "quote_time_exceeds_live_max_age" : true)
    && (value.status === "unavailable" ? value.source === null && value.fetchedAt === null && value.staleReason !== null : true);
}

function validateWriteSource(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("source must be an object");
    return;
  }
  if (value.actorType !== "user" && value.actorType !== "system") errors.push("source.actorType must be user or system");
  requireNonEmptyString(value.actorId, "source.actorId", errors);
  requireNonEmptyString(value.correlationId, "source.correlationId", errors);
}

function isValidSafety(value: unknown): value is CandidateMembershipSafety {
  if (!isRecord(value)) return false;
  for (const key of ["createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker"]) {
    if (value[key] !== false) return false;
  }
  return true;
}

function rejectUnknownKeys(value: Record<string, unknown>, label: string, allowed: string[], errors: string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) errors.push(`${label}.${key} is not allowed`);
  }
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${field} must be a non-empty string`);
}

function requireIsoTimestamp(value: unknown, field: string, errors: string[]): void {
  if (!isIsoTimestamp(value)) errors.push(`${field} must be a valid ISO timestamp`);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
