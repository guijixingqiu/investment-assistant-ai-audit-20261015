import type { Pool } from "pg";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import type { CandidateOverviewEnvelope, CandidateOverviewItem } from "../../../../packages/contracts/src/candidateOverview.js";
import { CANDIDATE_OVERVIEW_SCHEMA_VERSION } from "../../../../packages/contracts/src/candidateOverview.js";
import { resolveQuoteFreshness } from "../market/freshness.js";

interface CandidateOverviewRow {
  market: string;
  code: string;
  symbol: string;
  name: string | null;
  next_review_on: Date | string | null;
  updated_at: Date | string;
  evidence_count: number | string;
  latest_evidence_captured_at: Date | string | null;
  pending_suggestion_count: number | string;
  quote_provider: string | null;
  quote_time: Date | string | null;
  quote_fetched_at: Date | string | null;
}

export async function readCandidateOverviewEnvelope(
  pool: Pool,
  liveMaxAgeSeconds: number,
  now = new Date()
): Promise<CandidateOverviewEnvelope> {
  const generatedAt = now.toISOString();
  try {
    const result = await pool.query<CandidateOverviewRow>(
      `with candidate_profiles as (
         select distinct on (upper(rp.market), upper(rp.code))
                rp.id,
                upper(rp.market) as market,
                upper(rp.code) as code,
                upper(rp.market) || '.' || upper(rp.code) as symbol,
                s.name,
                rp.next_review_on,
                rp.updated_at
           from research_profiles rp
           join stocks s on s.id = rp.stock_id
          where upper(rp.market) = 'HK'
            and upper(rp.code) ~ '^[0-9]{5}$'
          order by upper(rp.market), upper(rp.code), rp.updated_at desc, rp.id desc
       ),
       evidence_counts as (
         select research_profile_id, count(*)::int as evidence_count, max(captured_at) as latest_evidence_captured_at
           from evidence_items
          where not exists (
            select 1
              from research_materials private_material
             where private_material.evidence_item_id = evidence_items.id
               and (private_material.candidate_membership_id is not null
                 or private_material.rights_status = 'user_provided')
          )
          group by research_profile_id
       ),
       pending_suggestions as (
         select research_profile_id, count(*)::int as pending_suggestion_count
           from ai_update_suggestions
          where status = 'pending'
          group by research_profile_id
       ),
       latest_quotes as (
         select distinct on (upper(market), upper(code))
                upper(market) as market,
                upper(code) as code,
                provider,
                quote_time,
                fetched_at
           from market_quotes
          where upper(market) = 'HK'
          order by upper(market), upper(code), quote_time desc, fetched_at desc
       )
       select cp.market, cp.code, cp.symbol, cp.name, cp.next_review_on, cp.updated_at,
              coalesce(ec.evidence_count, 0) as evidence_count,
              ec.latest_evidence_captured_at,
              coalesce(ps.pending_suggestion_count, 0) as pending_suggestion_count,
              lq.provider as quote_provider,
              lq.quote_time,
              lq.fetched_at as quote_fetched_at
         from candidate_profiles cp
         left join evidence_counts ec on ec.research_profile_id = cp.id
         left join pending_suggestions ps on ps.research_profile_id = cp.id
         left join latest_quotes lq on lq.market = cp.market and lq.code = cp.code`
    );
    const candidates = result.rows
      .filter(isCanonicalHongKongCandidateRow)
      .map((row) => rowToCandidateOverviewItem(row, liveMaxAgeSeconds, now));
    candidates.sort(compareCandidateOverviewItems);
    return overviewEnvelope(generatedAt, candidates);
  } catch {
    return unavailableOverviewEnvelope(generatedAt);
  }
}

function overviewEnvelope(generatedAt: string, candidates: CandidateOverviewItem[]): CandidateOverviewEnvelope {
  return {
    schemaVersion: CANDIDATE_OVERVIEW_SCHEMA_VERSION,
    generatedAt,
    status: candidates.length > 0 ? "available" : "empty",
    message: candidates.length > 0
      ? "Tracked Hong Kong candidates derived from research profiles and persisted quote facts."
      : "No tracked Hong Kong research candidates are available.",
    provenance: { candidates: "research_profiles", quotes: "persisted_market_quotes", portfolio: "omitted" },
    metadata: makeFactMetadata({
      source: "candidate_overview:research_profiles",
      asOf: generatedAt,
      fetchedAt: generatedAt,
      freshness: candidates.length > 0 ? "fresh" : "missing",
      provenance: "research_only",
      authority: "research_evidence",
      stale: false,
      missing: candidates.length === 0,
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message: candidates.length > 0
        ? "Candidate overview metadata is derived from repository-local research profiles; it is not ranking, recommendation, portfolio, broker, or trading authority."
        : "Candidate overview metadata is missing because no tracked Hong Kong research candidates are available."
    }),
    candidates
  };
}

function unavailableOverviewEnvelope(generatedAt: string): CandidateOverviewEnvelope {
  return {
    schemaVersion: CANDIDATE_OVERVIEW_SCHEMA_VERSION,
    generatedAt,
    status: "unavailable",
    message: "Candidate overview repository is unavailable.",
    provenance: { candidates: "research_profiles", quotes: "persisted_market_quotes", portfolio: "omitted" },
    metadata: makeFactMetadata({
      source: "candidate_overview:research_profiles",
      asOf: generatedAt,
      fetchedAt: generatedAt,
      freshness: "unavailable",
      provenance: "research_only",
      authority: "unavailable",
      stale: false,
      missing: false,
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message: "Candidate overview metadata is unavailable because the repository read failed; no partial candidates are exposed."
    }),
    candidates: []
  };
}

function rowToCandidateOverviewItem(row: CandidateOverviewRow, liveMaxAgeSeconds: number, now: Date): CandidateOverviewItem {
  const quoteTime = row.quote_time ? new Date(row.quote_time) : null;
  const quoteFetchedAt = row.quote_fetched_at ? new Date(row.quote_fetched_at) : null;
  const hasAnyQuoteFact = row.quote_time !== null || row.quote_fetched_at !== null || row.quote_provider !== null;
  const freshness = quoteTime && quoteFetchedAt && row.quote_provider
    ? resolveQuoteFreshness(quoteTime, quoteFetchedAt, now, liveMaxAgeSeconds)
    : null;
  const quoteConflict = hasAnyQuoteFact && (!freshness || freshness.status === "unavailable");
  const quoteChronologyConflict = freshness?.status === "unavailable";
  const candidateQuoteStatus = freshness?.status === "live" ? "fresh" : freshness?.status === "stale" ? "stale" : "unavailable";
  const quoteAsOf = candidateQuoteStatus === "unavailable" ? null : quoteTime?.toISOString() ?? null;
  const fetchedAt = candidateQuoteStatus === "unavailable" ? null : quoteFetchedAt?.toISOString() ?? null;
  const quoteSource = candidateQuoteStatus === "unavailable" ? null : row.quote_provider;
  const nextReviewOn = dateOnly(row.next_review_on);
  return {
    market: "HK",
    code: row.code,
    symbol: row.symbol,
    name: row.name,
    researchUpdatedAt: new Date(row.updated_at).toISOString(),
    nextReviewOn,
    reviewDue: nextReviewOn !== null && nextReviewOn <= (dateOnly(now) ?? "9999-12-31"),
    evidenceCount: Number(row.evidence_count),
    latestEvidenceCapturedAt: row.latest_evidence_captured_at ? new Date(row.latest_evidence_captured_at).toISOString() : null,
    pendingSuggestionCount: Number(row.pending_suggestion_count),
    quote: {
      status: candidateQuoteStatus,
      source: quoteSource,
      fetchedAt,
      staleReason: candidateQuoteStatus === "stale" ? "quote_time_exceeds_live_max_age" : quoteChronologyConflict ? "quote_chronology_conflict" : quoteConflict ? "repository_error" : candidateQuoteStatus === "unavailable" ? "no_persisted_quote" : null,
      metadata: makeFactMetadata({
        source: quoteSource ? `candidate_overview.quote:${quoteSource}` : "candidate_overview.quote:persisted_market_quotes",
        asOf: quoteAsOf,
        fetchedAt,
        freshness: candidateQuoteStatus === "fresh" ? "fresh" : candidateQuoteStatus === "stale" ? "stale" : quoteConflict ? "conflict" : "missing",
        provenance: quoteSource ? "cache" : "unavailable",
        authority: quoteSource ? "market_data" : "unavailable",
        stale: candidateQuoteStatus === "stale",
        missing: candidateQuoteStatus === "unavailable" && !quoteConflict,
        conflict: quoteConflict,
        fixture: false,
        correctionOf: null,
        replaces: null,
        message: candidateQuoteStatus === "fresh"
          ? "Candidate overview quote metadata is fresh within the configured local quote window."
          : candidateQuoteStatus === "stale"
            ? "Candidate overview quote metadata is stale and cannot be treated as fresh."
            : quoteConflict
              ? "Candidate overview quote chronology conflicts; quote facts are hidden."
              : "Candidate overview quote metadata is missing because no persisted quote exists."
      })
    }
  };
}

function isCanonicalHongKongCandidateRow(row: CandidateOverviewRow): boolean {
  return row.market === "HK" && /^\d{5}$/.test(row.code) && row.symbol === `HK.${row.code}`;
}

function compareCandidateOverviewItems(left: CandidateOverviewItem, right: CandidateOverviewItem): number {
  if (left.reviewDue !== right.reviewDue) return left.reviewDue ? -1 : 1;
  const leftReview = left.nextReviewOn ?? "9999-12-31";
  const rightReview = right.nextReviewOn ?? "9999-12-31";
  if (leftReview !== rightReview) return leftReview.localeCompare(rightReview);
  if (left.researchUpdatedAt !== right.researchUpdatedAt) return right.researchUpdatedAt.localeCompare(left.researchUpdatedAt);
  return left.symbol.localeCompare(right.symbol);
}

function dateOnly(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}
