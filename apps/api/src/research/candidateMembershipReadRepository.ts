import type { Pool } from "pg";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import type { CandidateMembershipEnvelope } from "../../../../packages/contracts/src/candidateMembership.js";
import { CANDIDATE_MEMBERSHIP_SCHEMA_VERSION, validateCandidateMembershipEnvelope } from "../../../../packages/contracts/src/candidateMembership.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { type CandidateMembershipRow, rowToCandidateMembership } from "./candidateMembershipMappers.js";

export async function readCandidateMembershipEnvelope(
  pool: Pool,
  actor: AuthenticatedResearchActor,
  includeArchived: boolean,
  liveMaxAgeSeconds: number,
  now = new Date()
): Promise<CandidateMembershipEnvelope> {
  const generatedAt = now.toISOString();
  try {
    const result = await pool.query<CandidateMembershipRow>(
      `with latest_research as (
         select distinct on (upper(rp.market), upper(rp.code))
                upper(rp.market) as market,
                upper(rp.code) as code,
                s.name,
                rp.next_review_on::text as next_review_on,
                rp.updated_at as research_updated_at
           from research_profiles rp
           left join stocks s on s.id = rp.stock_id
          where upper(rp.market) = 'HK'
          order by upper(rp.market), upper(rp.code), rp.updated_at desc, rp.id desc
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
       select cm.id, cm.actor_type, cm.actor_id, cm.market, cm.code, cm.symbol,
              cm.state, cm.version, cm.created_at, cm.updated_at, cm.archived_at,
              lr.name, lr.next_review_on, lr.research_updated_at,
              lq.provider as quote_provider, lq.quote_time, lq.fetched_at as quote_fetched_at
         from candidate_memberships cm
         left join latest_research lr on lr.market = cm.market and lr.code = cm.code
         left join latest_quotes lq on lq.market = cm.market and lq.code = cm.code
        where cm.actor_type = $1
          and cm.actor_id = $2
          and ($3::boolean or cm.state <> 'archived')
        order by case cm.state when 'tracked' then 0 when 'paused' then 1 else 2 end,
                 cm.updated_at desc,
                 cm.symbol asc`,
      [actor.actorType, actor.actorId, includeArchived]
    );
    const memberships = result.rows.map((row) => rowToCandidateMembership(row, liveMaxAgeSeconds, now));
    const status = memberships.length > 0 ? "available" : "empty";
    const envelope: CandidateMembershipEnvelope = {
      schemaVersion: CANDIDATE_MEMBERSHIP_SCHEMA_VERSION,
      generatedAt,
      status,
      includeArchived,
      message: memberships.length > 0
        ? "Candidate memberships are factual shortlist membership records and do not rank or recommend securities."
        : "No candidate memberships are recorded for this actor.",
      provenance: provenance(),
      metadata: metadata(
        generatedAt,
        status,
        memberships.length > 0
          ? "Candidate membership metadata is fresh shortlist membership context only, not ranking, recommendation, portfolio, broker, or trading authority."
          : "Candidate membership metadata is missing because no candidate memberships are recorded for this actor."
      ),
      memberships
    };
    return validateCandidateMembershipEnvelope(envelope).ok
      ? envelope
      : unavailable(generatedAt, includeArchived, "Assembled candidate membership envelope failed contract validation before response.", "Candidate membership metadata is unavailable because assembled facts failed validation; no partial memberships are exposed.");
  } catch {
    return unavailable(generatedAt, includeArchived, "Candidate membership repository is unavailable.", "Candidate membership metadata is unavailable because the repository read failed; no partial memberships are exposed.");
  }
}

function unavailable(generatedAt: string, includeArchived: boolean, message: string, metadataMessage: string): CandidateMembershipEnvelope {
  return {
    schemaVersion: CANDIDATE_MEMBERSHIP_SCHEMA_VERSION,
    generatedAt,
    status: "unavailable",
    includeArchived,
    message,
    provenance: provenance(),
    metadata: metadata(generatedAt, "unavailable", metadataMessage),
    memberships: []
  };
}

function provenance(): CandidateMembershipEnvelope["provenance"] {
  return {
    memberships: "candidate_memberships",
    research: "research_profiles_optional",
    quotes: "persisted_market_quotes_optional",
    portfolio: "omitted"
  };
}

function metadata(generatedAt: string, status: CandidateMembershipEnvelope["status"], message: string) {
  return makeFactMetadata({
    source: "candidate_memberships",
    asOf: generatedAt,
    fetchedAt: generatedAt,
    freshness: status === "available" ? "fresh" : status === "empty" ? "missing" : "unavailable",
    provenance: status === "unavailable" ? "unavailable" : "real",
    authority: status === "unavailable" ? "unavailable" : "candidate_membership",
    stale: false,
    missing: status === "empty",
    conflict: false,
    fixture: false,
    correctionOf: null,
    replaces: null,
    message
  });
}
