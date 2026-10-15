import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { normalizeMarketCode } from "../market/freshness.js";
import { IdempotencyConflictError } from "./domain.js";
import type { AuthenticatedResearchActor, ResearchFixtureSeedResult } from "./domain.js";
import { insertFixtureEvidence } from "./researchFixtureEvidenceRepository.js";

async function findResearchFixtureSeed(
  client: Pick<Pool | PoolClient, "query">,
  fixtureKey: string
): Promise<ResearchFixtureSeedRow | null> {
  const result = await client.query<ResearchFixtureSeedRow>(
    `select fixture_key, fixture_version, provenance, actor_type, actor_id,
            request_fingerprint, result_payload, correlation_id, completed_at
       from research_fixture_seed_events
      where fixture_key = $1
      limit 1`,
    [fixtureKey]
  );
  return result.rows[0] ?? null;
}

function researchFixtureSeedReplay(
  row: ResearchFixtureSeedRow,
  actor: AuthenticatedResearchActor,
  requestFingerprint: string,
  correlationId: string
): ResearchFixtureSeedResult {
  if (row.actor_type !== actor.actorType
    || row.actor_id !== actor.actorId
    || row.request_fingerprint !== requestFingerprint
    || row.correlation_id !== correlationId) {
    throw new IdempotencyConflictError("fixture seed already belongs to a different authenticated actor or fixture version");
  }
  if (row.fixture_version !== GATE_B_FIXTURE_VERSION
    || row.provenance !== "controlled_test_fixture"
    || row.completed_at === null
    || !isResearchFixtureSeedResult(row.result_payload, actor, correlationId)) {
    throw new Error("fixture seed replay audit is incomplete or malformed");
  }
  return { ...row.result_payload, replayed: true };
}

function isResearchFixtureSeedResult(
  value: unknown,
  actor: AuthenticatedResearchActor,
  correlationId: string
): value is ResearchFixtureSeedResult {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.provenance)) return false;
  return value.symbol === "HK.09926"
    && typeof value.suggestionId === "string"
    && value.suggestionId.length > 0
    && typeof value.replayed === "boolean"
    && value.source.actorType === actor.actorType
    && value.source.actorId === actor.actorId
    && value.source.correlationId === correlationId
    && value.provenance.fixture === true
    && value.provenance.fixtureKey === GATE_B_FIXTURE_KEY
    && value.provenance.fixtureVersion === GATE_B_FIXTURE_VERSION
    && value.provenance.classification === "controlled_test_fixture"
    && value.provenance.autoApply === false;
}

const GATE_B_FIXTURE_KEY = "gate-b-research-decision-brief:HK.09926";
const GATE_B_FIXTURE_VERSION = "2026-07-17.v2";
const GATE_B_FIXTURE_SUGGESTION_SUMMARY = "新增证据支持商业化继续跟踪，但竞争风险需要单独复核。";
const GATE_B_FIXTURE_EVIDENCE_SUMMARIES = [
  "公司披露核心产品仍处于商业化放量阶段。",
  "若同类竞争加剧，价格和市场份额可能承压。"
];

export async function seedGateBResearchFixture(
  pool: Pool,
  actor: AuthenticatedResearchActor
): Promise<ResearchFixtureSeedResult> {
  const normalized = normalizeMarketCode("HK", "09926");
  const requestFingerprint = stableFingerprint({
    operation: "seed_gate_b_research_fixture",
    fixtureKey: GATE_B_FIXTURE_KEY,
    fixtureVersion: GATE_B_FIXTURE_VERSION,
    actor
  });
  const correlationId = `research-fixture:${actor.actorType}:${actor.actorId}:${GATE_B_FIXTURE_KEY}:${GATE_B_FIXTURE_VERSION}`;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await findResearchFixtureSeed(client, GATE_B_FIXTURE_KEY);
    if (existing) {
      const replay = researchFixtureSeedReplay(existing, actor, requestFingerprint, correlationId);
      await client.query("commit");
      return replay;
    }
    const claim = await client.query<{ id: string }>(
      `insert into research_fixture_seed_events
        (fixture_key, fixture_version, provenance, actor_type, actor_id, request_fingerprint, correlation_id)
       values ($1, $2, 'controlled_test_fixture', $3, $4, $5, $6)
       on conflict (fixture_key) do nothing
       returning id`,
      [GATE_B_FIXTURE_KEY, GATE_B_FIXTURE_VERSION, actor.actorType, actor.actorId, requestFingerprint, correlationId]
    );
    if (!claim.rows[0]) {
      const concurrent = await findResearchFixtureSeed(client, GATE_B_FIXTURE_KEY);
      if (!concurrent) {
        throw new Error("fixture seed claim conflict could not be replayed");
      }
      const replay = researchFixtureSeedReplay(concurrent, actor, requestFingerprint, correlationId);
      await client.query("commit");
      return replay;
    }

    const fixtureProvenance = {
      fixture: true,
      fixtureKey: GATE_B_FIXTURE_KEY,
      fixtureVersion: GATE_B_FIXTURE_VERSION,
      classification: "controlled_test_fixture",
      actor: {
        actorType: actor.actorType,
        actorId: actor.actorId
      },
      autoApply: false
    };
    const existingProfile = await client.query<{ id: string }>(
      `select id
         from research_profiles
        where market = $1 and code = $2
        limit 1
        for update`,
      [normalized.market, normalized.code]
    );
    if (existingProfile.rows[0]) {
      const profileId = existingProfile.rows[0].id;
      const legacySuggestion = await client.query<{ id: string }>(
        `select id
           from ai_update_suggestions
          where research_profile_id = $1
            and raw_payload->>'fixture' = 'true'
            and summary = $2
          order by id desc
          limit 1
          for update`,
        [profileId, GATE_B_FIXTURE_SUGGESTION_SUMMARY]
      );
      const suggestionId = legacySuggestion.rows[0]?.id;
      if (!suggestionId) {
        throw new IdempotencyConflictError("fixture seed refused to overwrite an existing non-fixture research profile");
      }
      await client.query(
        `update research_profiles
            set key_variables = $2,
                catalysts = $3,
                evidence_gaps = $4,
                updated_at = now()
          where id = $1`,
        [
          profileId,
          ["commercialization", "competition"],
          ["核心产品销售披露", "关键临床数据更新"],
          ["最新销售数据", "同类产品最新进展"]
        ]
      );
      await client.query(
        `update evidence_items
            set raw_payload = raw_payload || $2::jsonb,
                materiality = case summary
                  when $4 then 5
                  when $5 then 4
                  else materiality
                end
          where research_profile_id = $1
            and summary = any($3::text[])`,
        [
          profileId,
          JSON.stringify(fixtureProvenance),
          GATE_B_FIXTURE_EVIDENCE_SUMMARIES,
          GATE_B_FIXTURE_EVIDENCE_SUMMARIES[0],
          GATE_B_FIXTURE_EVIDENCE_SUMMARIES[1]
        ]
      );
      await client.query(
        `update ai_update_suggestions
            set raw_payload = raw_payload || $2::jsonb
          where id = $1`,
        [suggestionId, JSON.stringify({ ...fixtureProvenance, fixtureItem: "ai-update-suggestion" })]
      );
      const adopted = gateBFixtureSeedResult(normalized.symbol, suggestionId, actor, correlationId, false);
      await completeResearchFixtureSeed(client, claim.rows[0].id, profileId, suggestionId, adopted);
      await client.query("commit");
      return adopted;
    }
    const stock = await client.query<{ id: string }>(
      `insert into stocks (market, code, symbol, name)
       values ($1, $2, $3, $4)
       on conflict (market, code)
       do update set symbol = excluded.symbol,
                     name = coalesce(stocks.name, excluded.name),
                     updated_at = now()
       returning id`,
      [normalized.market, normalized.code, normalized.symbol, "康方生物"]
    );
    const profile = await client.query<{ id: string }>(
      `insert into research_profiles
        (stock_id, market, code, symbol, current_view, current_thesis,
         market_disagreement, invalidation_condition, next_review_on,
         key_variables, catalysts, evidence_gaps)
       values
        ($1, $2, $3, $4, $5, $6, $7, $8, current_date + interval '30 days', $9, $10, $11)
       on conflict (stock_id)
       do nothing
       returning id`,
      [
        stock.rows[0]?.id,
        normalized.market,
        normalized.code,
        normalized.symbol,
        "等待更多临床和商业化证据，但核心管线仍是主要观察点。",
        "若核心产品商业化兑现并保持研发效率，估值中枢有继续上修空间。",
        "市场分歧集中在商业化速度、同类竞争和研发投入强度。",
        "核心产品销售失速或关键临床数据显著弱于预期。",
        ["commercialization", "competition"],
        ["核心产品销售披露", "关键临床数据更新"],
        ["最新销售数据", "同类产品最新进展"]
      ]
    );
    const profileId = profile.rows[0]?.id;
    if (!profileId) {
      throw new IdempotencyConflictError("fixture seed refused to overwrite a concurrently created research profile");
    }
    await insertFixtureEvidence(client, profileId, {
      sourceType: "company_disclosure",
      summary: "公司披露核心产品仍处于商业化放量阶段。",
      factKind: "fact",
      stance: "support",
      variableName: "commercialization",
      reliability: 4,
      materiality: 5,
      isRead: true,
      rawPayload: { ...fixtureProvenance, fixtureItem: "company-disclosure" }
    });
    await insertFixtureEvidence(client, profileId, {
      sourceType: "ai_inference",
      summary: "若同类竞争加剧，价格和市场份额可能承压。",
      factKind: "inference",
      stance: "refute",
      variableName: "competition",
      reliability: 3,
      materiality: 4,
      isRead: false,
      rawPayload: { ...fixtureProvenance, fixtureItem: "competition-inference" }
    });
    const suggestion = await client.query<{ id: string }>(
      `insert into ai_update_suggestions
        (research_profile_id, summary, supports, weakens, counter_evidence,
         changed_variables, missing_evidence, raw_payload)
       values
        ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       returning id`,
      [
        profileId,
        GATE_B_FIXTURE_SUGGESTION_SUMMARY,
        ["商业化变量仍是主要支持项"],
        ["竞争风险可能削弱估值弹性"],
        ["需要确认同类产品最新进展"],
        ["commercialization", "competition"],
        ["最新销售数据", "竞品进度"],
        JSON.stringify({ ...fixtureProvenance, fixtureItem: "ai-update-suggestion" })
      ]
    );
    const result = gateBFixtureSeedResult(normalized.symbol, suggestion.rows[0]?.id ?? "", actor, correlationId, false);
    await completeResearchFixtureSeed(client, claim.rows[0].id, profileId, result.suggestionId, result);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function gateBFixtureSeedResult(
  symbol: string,
  suggestionId: string,
  actor: AuthenticatedResearchActor,
  correlationId: string,
  replayed: boolean
): ResearchFixtureSeedResult {
  return {
    symbol,
    suggestionId,
    replayed,
    source: {
      actorType: actor.actorType,
      actorId: actor.actorId,
      correlationId
    },
    provenance: {
      fixture: true,
      fixtureKey: GATE_B_FIXTURE_KEY,
      fixtureVersion: GATE_B_FIXTURE_VERSION,
      classification: "controlled_test_fixture",
      autoApply: false
    }
  };
}

async function completeResearchFixtureSeed(
  client: PoolClient,
  claimId: string,
  profileId: string,
  suggestionId: string,
  result: ResearchFixtureSeedResult
): Promise<void> {
  await client.query(
    `update research_fixture_seed_events
        set research_profile_id = $2,
            suggestion_id = $3,
            result_payload = $4::jsonb,
            completed_at = now()
      where id = $1`,
    [claimId, profileId, suggestionId, JSON.stringify(result)]
  );
}

function stableFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


interface ResearchFixtureSeedRow {
  fixture_key: string;
  fixture_version: string;
  provenance: "controlled_test_fixture";
  actor_type: "user" | "system";
  actor_id: string;
  request_fingerprint: string;
  result_payload: ResearchFixtureSeedResult | null;
  correlation_id: string;
  completed_at: Date | string | null;
}
