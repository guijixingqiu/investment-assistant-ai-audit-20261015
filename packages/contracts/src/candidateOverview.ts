import type { FactMetadata } from "./factMetadata.js";
import { validateFactMetadataInto } from "./factMetadata.js";
import { areInstantsChronologicallyOrdered } from "./chronology.js";

export const CANDIDATE_OVERVIEW_SCHEMA_VERSION = "2026-07-02.core-1d.candidate-overview.v1";

export const CANDIDATE_OVERVIEW_STATUSES = ["available", "empty", "unavailable"] as const;
export const CANDIDATE_QUOTE_STATUSES = ["fresh", "stale", "unavailable"] as const;

export type CandidateOverviewStatus = (typeof CANDIDATE_OVERVIEW_STATUSES)[number];
export type CandidateQuoteStatus = (typeof CANDIDATE_QUOTE_STATUSES)[number];

export interface CandidateOverviewQuoteState {
  status: CandidateQuoteStatus;
  source: string | null;
  fetchedAt: string | null;
  staleReason: "quote_time_exceeds_live_max_age" | "quote_chronology_conflict" | "no_persisted_quote" | "repository_error" | null;
  metadata: FactMetadata;
}

export interface CandidateOverviewItem {
  market: "HK";
  code: string;
  symbol: string;
  name: string | null;
  researchUpdatedAt: string;
  nextReviewOn: string | null;
  reviewDue: boolean;
  evidenceCount: number;
  latestEvidenceCapturedAt: string | null;
  pendingSuggestionCount: number;
  quote: CandidateOverviewQuoteState;
}

export interface CandidateOverviewEnvelope {
  schemaVersion: typeof CANDIDATE_OVERVIEW_SCHEMA_VERSION;
  generatedAt: string;
  status: CandidateOverviewStatus;
  message: string;
  provenance: {
    candidates: "research_profiles";
    quotes: "persisted_market_quotes";
    portfolio: "omitted";
  };
  metadata: FactMetadata;
  candidates: CandidateOverviewItem[];
}

export function validateCandidateOverviewEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["envelope must be an object"] };
  }

  if (value.schemaVersion !== CANDIDATE_OVERVIEW_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${CANDIDATE_OVERVIEW_SCHEMA_VERSION}`);
  }
  if (typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))) {
    errors.push("generatedAt must be an ISO string");
  }
  if (!CANDIDATE_OVERVIEW_STATUSES.includes(value.status as CandidateOverviewStatus)) {
    errors.push("status must be available, empty, or unavailable");
  }
  if (typeof value.message !== "string") {
    errors.push("message must be a string");
  }
  validateProvenance(value.provenance, errors);
  validateFactMetadataInto(value.metadata, "metadata", errors);
  if (isRecord(value.metadata)) {
    if (value.status === "available" && value.metadata.freshness !== "fresh") errors.push("metadata.freshness must be fresh when candidate overview is available");
    if (value.status === "empty" && value.metadata.freshness !== "missing") errors.push("metadata.freshness must be missing when candidate overview is empty");
    if (value.status === "unavailable" && value.metadata.freshness === "fresh") errors.push("metadata.freshness must not be fresh when candidate overview is unavailable");
    if (value.metadata.provenance !== "research_only") errors.push("metadata.provenance must be research_only for candidate overview");
    if (value.metadata.authority !== "research_evidence" && value.metadata.authority !== "unavailable") errors.push("metadata.authority must be research_evidence or unavailable for candidate overview");
  }
  if (!Array.isArray(value.candidates)) {
    errors.push("candidates must be an array");
  } else {
    const symbols = new Set<string>();
    for (const candidate of value.candidates) {
      if (!isValidCandidate(candidate, value.generatedAt)) {
        errors.push("candidates must contain only valid Hong Kong candidate items");
        break;
      }
      if (symbols.has(candidate.symbol)) {
        errors.push("candidate symbols must be unique");
        break;
      }
      symbols.add(candidate.symbol);
    }
  }
  if (value.status === "empty" && Array.isArray(value.candidates) && value.candidates.length !== 0) {
    errors.push("empty status requires an empty candidate list");
  }
  if (value.status === "unavailable" && Array.isArray(value.candidates) && value.candidates.length !== 0) {
    errors.push("unavailable status must not return partial candidates");
  }
  if ((value.status === "available") && Array.isArray(value.candidates) && value.candidates.length === 0) {
    errors.push("available status requires at least one candidate");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateProvenance(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("provenance must be an object");
    return;
  }
  if (value.candidates !== "research_profiles") {
    errors.push("provenance.candidates must be research_profiles");
  }
  if (value.quotes !== "persisted_market_quotes") {
    errors.push("provenance.quotes must be persisted_market_quotes");
  }
  if (value.portfolio !== "omitted") {
    errors.push("provenance.portfolio must be omitted");
  }
}

function isValidCandidate(value: unknown, generatedAt: unknown): value is CandidateOverviewItem {
  if (!isRecord(value)) return false;
  const evidenceCount = value.evidenceCount;
  const pendingSuggestionCount = value.pendingSuggestionCount;
  return value.market === "HK"
    && typeof value.code === "string"
    && /^\d{5}$/.test(value.code)
    && value.symbol === `HK.${value.code}`
    && (typeof value.name === "string" || value.name === null)
    && typeof value.researchUpdatedAt === "string"
    && (typeof value.nextReviewOn === "string" || value.nextReviewOn === null)
    && typeof value.reviewDue === "boolean"
    && typeof evidenceCount === "number"
    && Number.isInteger(evidenceCount)
    && evidenceCount >= 0
    && (typeof value.latestEvidenceCapturedAt === "string" || value.latestEvidenceCapturedAt === null)
    && typeof pendingSuggestionCount === "number"
    && Number.isInteger(pendingSuggestionCount)
    && pendingSuggestionCount >= 0
    && isValidQuote(value.quote, generatedAt);
}

function isValidQuote(value: unknown, generatedAt: unknown): value is CandidateOverviewQuoteState {
  if (!isRecord(value)) return false;
  const errors: string[] = [];
  validateFactMetadataInto(value.metadata, "quote.metadata", errors);
  if (isRecord(value.metadata)) {
    if (value.status === "fresh" && value.metadata.freshness !== "fresh") errors.push("quote.metadata.freshness must be fresh when quote is fresh");
    if (value.status === "stale" && value.metadata.freshness !== "stale") errors.push("quote.metadata.freshness must be stale when quote is stale");
    if (value.status === "unavailable" && value.metadata.freshness === "fresh") errors.push("quote.metadata.freshness must not be fresh when quote is unavailable");
    if (value.metadata.authority !== "market_data" && value.metadata.authority !== "unavailable") errors.push("quote.metadata.authority must be market_data or unavailable");
  }
  const available = value.status === "fresh" || value.status === "stale";
  const availableChronology = available
    && typeof value.source === "string"
    && typeof value.fetchedAt === "string"
    && isRecord(value.metadata)
    && value.metadata.fetchedAt === value.fetchedAt
    && areInstantsChronologicallyOrdered([value.metadata.asOf, value.fetchedAt, generatedAt]);
  const unavailableShape = value.status === "unavailable"
    && value.source === null
    && value.fetchedAt === null
    && value.staleReason !== null
    && isRecord(value.metadata)
    && value.metadata.asOf === null
    && value.metadata.fetchedAt === null;
  return errors.length === 0
    && CANDIDATE_QUOTE_STATUSES.includes(value.status as CandidateQuoteStatus)
    && (typeof value.source === "string" || value.source === null)
    && (typeof value.fetchedAt === "string" || value.fetchedAt === null)
    && (
      value.staleReason === null
      || value.staleReason === "quote_time_exceeds_live_max_age"
      || value.staleReason === "quote_chronology_conflict"
      || value.staleReason === "no_persisted_quote"
      || value.staleReason === "repository_error"
    )
    && (available ? availableChronology : unavailableShape)
    && (value.status === "fresh" ? value.staleReason === null : true)
    && (value.status === "stale" ? value.staleReason === "quote_time_exceeds_live_max_age" : true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
