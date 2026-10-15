import type { Pool, PoolClient } from "pg";
import type { CandidateMembershipData, CandidateMembershipWriteEnvelope, CandidateMembershipWriteResult } from "../../../../packages/contracts/src/candidateMembership.js";
import { CANDIDATE_MEMBERSHIP_SCHEMA_VERSION } from "../../../../packages/contracts/src/candidateMembership.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import type { CandidateMembershipRow } from "./candidateMembershipMappers.js";

export interface CandidateMembershipAuditReplay {
  audit_event_id: string;
  request_fingerprint: string;
  result: CandidateMembershipWriteResult;
  after_payload: CandidateMembershipData;
  correlation_id: string;
}

export async function readCandidateMembershipById(
  client: Pick<Pool | PoolClient, "query">,
  actor: AuthenticatedResearchActor,
  membershipId: string
): Promise<CandidateMembershipRow | null> {
  const result = await client.query<CandidateMembershipRow>(
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
      where cm.id = $1
        and cm.actor_type = $2
        and cm.actor_id = $3
      limit 1`,
    [membershipId, actor.actorType, actor.actorId]
  );
  return result.rows[0] ?? null;
}

export async function findCandidateMembershipForUpdate(
  client: PoolClient,
  actor: AuthenticatedResearchActor,
  market: string,
  code: string
): Promise<CandidateMembershipRow | null> {
  const result = await client.query<CandidateMembershipRow>(
    `select id, actor_type, actor_id, market, code, symbol, state, version, created_at, updated_at, archived_at,
            null::text as name, null::timestamptz as research_updated_at,
            null::text as quote_provider, null::timestamptz as quote_time, null::timestamptz as quote_fetched_at
       from candidate_memberships
      where actor_type = $1 and actor_id = $2 and market = $3 and code = $4
      for update`,
    [actor.actorType, actor.actorId, market, code]
  );
  return result.rows[0] ?? null;
}

export async function findCandidateMembershipByIdForUpdate(
  client: PoolClient,
  actor: AuthenticatedResearchActor,
  membershipId: string
): Promise<CandidateMembershipRow | null> {
  const result = await client.query<CandidateMembershipRow>(
    `select id, actor_type, actor_id, market, code, symbol, state, version, created_at, updated_at, archived_at,
            null::text as name, null::timestamptz as research_updated_at,
            null::text as quote_provider, null::timestamptz as quote_time, null::timestamptz as quote_fetched_at
       from candidate_memberships
      where id = $1 and actor_type = $2 and actor_id = $3
      for update`,
    [membershipId, actor.actorType, actor.actorId]
  );
  return result.rows[0] ?? null;
}

export async function findCandidateMembershipByIdForUpdateNowait(
  client: PoolClient,
  actor: AuthenticatedResearchActor,
  membershipId: string
): Promise<CandidateMembershipRow | null> {
  const result = await client.query<CandidateMembershipRow>(
    `select id, actor_type, actor_id, market, code, symbol, state, version, created_at, updated_at, archived_at,
            null::text as name, null::timestamptz as research_updated_at,
            null::text as quote_provider, null::timestamptz as quote_time, null::timestamptz as quote_fetched_at
       from candidate_memberships
      where id = $1 and actor_type = $2 and actor_id = $3
      for update nowait`,
    [membershipId, actor.actorType, actor.actorId]
  );
  return result.rows[0] ?? null;
}

export async function findCandidateMembershipAudit(
  client: PoolClient,
  actor: AuthenticatedResearchActor,
  idempotencyKey: string
): Promise<CandidateMembershipAuditReplay | null> {
  const result = await client.query<CandidateMembershipAuditReplay>(
    `select id as audit_event_id, request_fingerprint, after_payload,
            after_payload->>'result' as result, correlation_id
       from candidate_membership_audit_events
      where actor_type = $1 and actor_id = $2 and idempotency_key = $3
      limit 1`,
    [actor.actorType, actor.actorId, idempotencyKey]
  );
  const row = result.rows[0];
  if (!row) return null;
  const afterPayload = row.after_payload as CandidateMembershipData & { result?: CandidateMembershipWriteResult };
  return {
    audit_event_id: String(row.audit_event_id),
    request_fingerprint: row.request_fingerprint,
    result: afterPayload.result ?? row.result,
    after_payload: withoutAuditResult(afterPayload),
    correlation_id: row.correlation_id
  };
}

export async function insertCandidateMembershipAudit(
  client: PoolClient,
  input: {
    eventType: "membership_created" | "membership_already_exists" | "membership_restored" | "membership_state_changed" | "membership_state_unchanged";
    actor: AuthenticatedResearchActor;
    membership: CandidateMembershipRow;
    idempotencyKey: string;
    requestFingerprint: string;
    beforePayload: CandidateMembershipData | null;
    afterPayload: CandidateMembershipData;
    result: CandidateMembershipWriteResult;
    correlationId: string;
  }
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into candidate_membership_audit_events
      (event_type, actor_type, actor_id, membership_id, market, code, symbol, idempotency_key,
       request_fingerprint, before_payload, after_payload, correlation_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12)
     returning id`,
    [
      input.eventType,
      input.actor.actorType,
      input.actor.actorId,
      input.membership.id,
      input.membership.market,
      input.membership.code,
      input.membership.symbol,
      input.idempotencyKey,
      input.requestFingerprint,
      input.beforePayload === null ? null : JSON.stringify(input.beforePayload),
      JSON.stringify({ ...input.afterPayload, result: input.result }),
      input.correlationId
    ]
  );
  return String(result.rows[0]?.id ?? "");
}

export function candidateMembershipWriteEnvelope(
  result: CandidateMembershipWriteResult,
  auditEventId: string,
  data: CandidateMembershipData,
  actor: AuthenticatedResearchActor,
  correlationId: string,
  message: string
): CandidateMembershipWriteEnvelope {
  return {
    schemaVersion: CANDIDATE_MEMBERSHIP_SCHEMA_VERSION,
    result,
    auditEventId,
    asOf: new Date().toISOString(),
    source: { actorType: actor.actorType, actorId: actor.actorId, correlationId },
    data,
    message
  };
}

export function candidateMembershipFingerprint(value: unknown): string {
  return JSON.stringify(value);
}

export function candidateMembershipCorrelationId(actor: AuthenticatedResearchActor, idempotencyKey: string): string {
  return `candidate-membership:${actor.actorType}:${actor.actorId}:${idempotencyKey}`;
}

export function sameCandidateMembershipAuditReplay(
  replay: CandidateMembershipAuditReplay,
  actor: AuthenticatedResearchActor,
  correlationId: string
): boolean {
  const data = replay.after_payload;
  const safety = data.safety;
  return replay.correlation_id === correlationId
    && data.actorId === actor.actorId
    && data.market === "HK"
    && /^[0-9]{5}$/.test(data.code)
    && data.symbol === `HK.${data.code}`
    && safety?.createsOrder === false
    && safety.createsTrade === false
    && safety.mutatesCash === false
    && safety.writesFee === false
    && safety.mutatesPosition === false
    && safety.callsBroker === false;
}

function withoutAuditResult(value: CandidateMembershipData & { result?: CandidateMembershipWriteResult }): CandidateMembershipData {
  const { result: _result, ...data } = value;
  return data;
}
