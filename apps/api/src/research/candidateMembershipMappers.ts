import type {
  CandidateMembershipData,
  CandidateMembershipQuoteState,
  CandidateMembershipResearchState,
  CandidateMembershipState
} from "../../../../packages/contracts/src/candidateMembership.js";
import { resolveQuoteFreshness } from "../market/freshness.js";

export interface CandidateMembershipRow {
  id: string;
  actor_type: "user" | "system";
  actor_id: string;
  market: "HK";
  code: string;
  symbol: string;
  state: CandidateMembershipState;
  version: number | string;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
  name: string | null;
  next_review_on: string | null;
  research_updated_at: Date | string | null;
  quote_provider: string | null;
  quote_time: Date | string | null;
  quote_fetched_at: Date | string | null;
}

export function rowToCandidateMembership(row: CandidateMembershipRow, liveMaxAgeSeconds: number, now: Date): CandidateMembershipData {
  const quote = candidateMembershipQuote(row, liveMaxAgeSeconds, now);
  const research = candidateMembershipResearch(row);
  return {
    id: String(row.id),
    actorId: row.actor_id,
    market: "HK",
    code: row.code,
    symbol: row.symbol,
    state: row.state,
    version: Number(row.version),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : null,
    provenance: {
      membership: "candidate_memberships",
      research: research.status === "available" ? "research_profiles" : "missing",
      quotes: quote.status === "unavailable" ? "unavailable" : "persisted_market_quotes",
      portfolio: "omitted"
    },
    research,
    quote,
    safety: {
      createsOrder: false,
      createsTrade: false,
      mutatesCash: false,
      writesFee: false,
      mutatesPosition: false,
      callsBroker: false
    }
  };
}

function candidateMembershipResearch(row: CandidateMembershipRow): CandidateMembershipResearchState {
  if (!row.research_updated_at) {
    return { status: "missing", profileUpdatedAt: null, nextReviewOn: null, name: row.name ?? null };
  }
  return {
    status: "available",
    profileUpdatedAt: new Date(row.research_updated_at).toISOString(),
    nextReviewOn: row.next_review_on,
    name: row.name ?? null
  };
}

function candidateMembershipQuote(row: CandidateMembershipRow, liveMaxAgeSeconds: number, now: Date): CandidateMembershipQuoteState {
  const quoteTime = row.quote_time ? new Date(row.quote_time) : null;
  if (!quoteTime) {
    return { status: "unavailable", source: null, fetchedAt: null, staleReason: "no_persisted_quote" };
  }
  const fetchedAt = row.quote_fetched_at ? new Date(row.quote_fetched_at) : null;
  if (!fetchedAt || !row.quote_provider) {
    return { status: "unavailable", source: null, fetchedAt: null, staleReason: "repository_error" };
  }
  const freshness = resolveQuoteFreshness(quoteTime, fetchedAt, now, liveMaxAgeSeconds);
  if (freshness.status === "unavailable") {
    return { status: "unavailable", source: null, fetchedAt: null, staleReason: "quote_chronology_conflict" };
  }
  return {
    status: freshness.status === "live" ? "fresh" : "stale",
    source: row.quote_provider,
    fetchedAt: fetchedAt.toISOString(),
    staleReason: freshness.reason
  };
}
