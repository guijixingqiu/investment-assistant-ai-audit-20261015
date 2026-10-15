import type { Pool, PoolClient } from "pg";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import type { ResearchProfileEnvelope } from "../../../../packages/contracts/src/research.js";
import { RESEARCH_PROFILE_SCHEMA_VERSION } from "../../../../packages/contracts/src/research.js";
import { normalizeMarketCode } from "../market/freshness.js";
import {
  type EvidenceRow,
  type ResearchProfileRow,
  type SuggestionRow,
  researchEvidenceFreshness,
  rowToEvidence,
  rowToProfile,
  rowToSuggestion
} from "./researchMappers.js";
import {
  researchMonitorRuleErrors,
  type ResearchMonitorRule
} from "../../../../packages/contracts/src/researchMonitorRule.js";
import { DeepResearchGateError, type AuthenticatedResearchActor } from "./domain.js";

export async function readCurrentResearchMonitorRules(
  pool: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  actor: AuthenticatedResearchActor
): Promise<ResearchMonitorRule[]> {
  const result = await pool.query<{ key_variables: string[]; monitor_rules: ResearchMonitorRule[]; updated_at: Date | string }>(
    `select rp.key_variables, rp.monitor_rules, rp.updated_at
       from candidate_memberships cm
       join research_profiles rp on rp.market = cm.market and rp.code = cm.code
      where cm.id = $1 and cm.actor_type = $2 and cm.actor_id = $3
      limit 1`,
    [membershipId, actor.actorType, actor.actorId]
  );
  const row = result.rows[0];
  if (!row) throw new DeepResearchGateError("deep research monitor rules are unavailable for the selected membership");
  const rules = row.monitor_rules ?? [];
  const failures = researchMonitorRuleErrors(rules, row.key_variables ?? []);
  if (failures.length) throw new DeepResearchGateError("deep research monitor rules failed validation", failures);
  return rules.filter((rule) => rule.enabled && rule.version !== undefined && rule.confirmedAt !== undefined);
}

export async function readResearchProfileEnvelope(
  pool: Pick<Pool | PoolClient, "query">,
  market: string,
  code: string,
  now = new Date()
): Promise<ResearchProfileEnvelope> {
  const normalized = normalizeMarketCode(market, code);
  const profileResult = await pool.query<ResearchProfileRow>(
    `select rp.id, rp.market, rp.code, rp.symbol, s.name, rp.current_view, rp.current_thesis,
            rp.market_disagreement, rp.invalidation_condition, rp.next_review_on,
            rp.key_variables, rp.catalysts, rp.evidence_gaps, rp.monitor_rules, rp.updated_at,
            exists (
              select 1
                from research_fixture_seed_events fixture_seed
               where fixture_seed.research_profile_id = rp.id
                 and fixture_seed.completed_at is not null
            ) as fixture
       from research_profiles rp
       left join stocks s on s.id = rp.stock_id
      where rp.market = $1 and rp.code = $2
      limit 1`,
    [normalized.market, normalized.code]
  );
  const profile = profileResult.rows[0];
  if (!profile) {
    const asOf = now.toISOString();
    return {
      schemaVersion: RESEARCH_PROFILE_SCHEMA_VERSION,
      asOf,
      requestedSymbol: normalized.symbol,
      metadata: makeFactMetadata({
        source: "research_profiles",
        asOf,
        fetchedAt: null,
        freshness: "missing",
        provenance: "research_only",
        authority: "research_evidence",
        stale: false,
        missing: true,
        conflict: false,
        fixture: false,
        correctionOf: null,
        replaces: null,
        message: "No research profile exists for this symbol; research evidence is missing."
      }),
      data: null,
      message: `No research profile for ${normalized.symbol}.`
    };
  }

  const evidenceResult = await pool.query<EvidenceRow>(
    `select id, source_type, source_url, published_at, captured_at, summary, fact_kind,
            variable_name, stance, reliability, materiality, is_read
       from evidence_items
      where research_profile_id = $1
        and not exists (
          select 1
            from research_materials private_material
           where private_material.evidence_item_id = evidence_items.id
             and (private_material.candidate_membership_id is not null
               or private_material.rights_status = 'user_provided')
        )
      order by captured_at desc, id desc
      limit 20`,
    [profile.id]
  );
  const suggestionResult = await pool.query<SuggestionRow>(
    `select id, status, summary, supports, weakens, counter_evidence, changed_variables,
            missing_evidence, created_at, decided_at, decision_note
       from ai_update_suggestions
      where research_profile_id = $1
      order by created_at desc, id desc
      limit 10`,
    [profile.id]
  );
  const evidence = evidenceResult.rows.map(rowToEvidence);
  const evidenceFreshness = researchEvidenceFreshness(evidence, now);
  const asOf = evidenceFreshness.evidenceAsOf ?? new Date(profile.updated_at).toISOString();
  const fixture = profile.fixture === true;
  return {
    schemaVersion: RESEARCH_PROFILE_SCHEMA_VERSION,
    asOf,
    requestedSymbol: normalized.symbol,
    metadata: makeFactMetadata({
      source: "research_profiles_evidence_suggestions",
      asOf,
      fetchedAt: null,
      freshness: evidenceFreshness.freshness,
      provenance: fixture ? "fixture" : "research_only",
      authority: "research_evidence",
      stale: evidenceFreshness.stale,
      missing: evidenceFreshness.missing,
      conflict: false,
      fixture,
      correctionOf: null,
      replaces: null,
      message: `${evidenceFreshness.stale
        ? "Research profile exists, but its latest evidence is older than 90 days and must not be displayed as fresh. "
        : evidenceFreshness.missing
          ? "Research profile exists, but evidence items are missing. "
          : ""}${fixture
        ? "Research profile and evidence are controlled fixture context only, not real holdings, trading advice, portfolio truth, or production facts."
        : "Research profile and evidence are research-only context, not trading advice or portfolio truth."}`
    }),
    data: {
      profile: rowToProfile(profile),
      evidence,
      suggestions: suggestionResult.rows.map(rowToSuggestion)
    },
    message: `Research profile for ${normalized.symbol}.`
  };
}
