import type { Pool, PoolClient } from "pg";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { RESEARCH_WRITE_SCHEMA_VERSION } from "../../../../packages/contracts/src/research.js";
import type { AuthenticatedResearchActor } from "./domain.js";

export type ResearchWriteAuditEventType =
  | "profile_updated"
  | "evidence_created"
  | "decision_check_created"
  | "decision_check_deleted"
  | "post_decision_review_created"
  | "post_decision_review_deleted"
  | "research_material_created"
  | "research_material_deleted"
  | "research_document_imported"
  | "research_fundamental_value_created"
  | "research_valuation_scenario_created"
  | "evidence_pack_frozen"
  | "deep_research_task_enqueued"
  | "deep_research_task_canceled"
  | "deep_research_report_created"
  | "deep_research_report_decided"
  | "deep_research_report_deleted"
  | "research_event_created"
  | "geely_sales_monitor_created"
  | "gcl_pv_price_monitor_created"
  | "research_evidence_question_attempted"
  | "research_evidence_question_answered"
  | "today_material_change_dispositioned";

export interface ResearchWriteAuditReplay<TData> {
  envelope: ResearchWriteEnvelope<TData>;
  stock: { market: string; code: string; symbol: string };
  requestFingerprint: string | null;
  candidateMembershipId: string | null;
  candidateMembershipVersion: number | null;
}

export interface PersistedStock {
  id: string;
  market: string;
  code: string;
  symbol: string;
  name: string | null;
}

export async function upsertStock(
  client: PoolClient,
  market: string,
  code: string,
  symbol: string,
  name: string | null
): Promise<PersistedStock> {
  const result = await client.query<PersistedStock>(
    `insert into stocks (market, code, symbol, name)
     values ($1, $2, $3, $4)
     on conflict (market, code)
     do update set symbol = excluded.symbol,
                   name = coalesce(excluded.name, stocks.name),
                   updated_at = now()
     returning id, market, code, symbol, name`,
    [market, code, symbol, name]
  );
  return result.rows[0];
}

export async function ensureResearchProfile(client: PoolClient, stock: PersistedStock): Promise<string> {
  const profile = await client.query<{ id: string }>(
    `insert into research_profiles
      (stock_id, market, code, symbol, current_view, current_thesis)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (stock_id)
     do update set updated_at = research_profiles.updated_at
     returning id`,
    [stock.id, stock.market, stock.code, stock.symbol, "待补充当前观点。", "待补充投资假设。"]
  );
  return profile.rows[0].id;
}

export async function readExistingResearchProfileBinding(
  client: Pick<Pool | PoolClient, "query">,
  market: string,
  code: string,
  symbol: string
): Promise<{ stock: PersistedStock; profileId: string } | null> {
  const result = await client.query<PersistedStock & { profile_id: string }>(
    `select stock.id, stock.market, stock.code, stock.symbol, stock.name,
            profile.id as profile_id
       from stocks stock
       join research_profiles profile on profile.stock_id = stock.id
      where stock.market = $1 and stock.code = $2 and stock.symbol = $3
      limit 1`,
    [market, code, symbol]
  );
  const row = result.rows[0];
  return row ? {
    stock: {
      id: String(row.id),
      market: row.market,
      code: row.code,
      symbol: row.symbol,
      name: row.name
    },
    profileId: String(row.profile_id)
  } : null;
}

export async function findAuditByIdempotencyKey<TData>(
  client: Pick<Pool | PoolClient, "query">,
  idempotencyKey: string,
  eventType: ResearchWriteAuditEventType
): Promise<ResearchWriteAuditReplay<TData> | null> {
  const result = await client.query<{
    after_payload: TData;
    actor_type: "user" | "system" | "migration" | "test";
    actor_id: string | null;
    correlation_id: string | null;
    created_at: Date | string;
    market: string;
    code: string;
    symbol: string;
    request_fingerprint: string | null;
    candidate_membership_id: string | null;
    candidate_membership_version: number | string | null;
  }>(
    `select after_payload, actor_type, actor_id, correlation_id, created_at, market, code, symbol,
            request_fingerprint, candidate_membership_id, candidate_membership_version
       from research_write_audit_events
      where idempotency_key = $1
        and event_type = $2
      limit 1`,
    [idempotencyKey, eventType]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    envelope: {
      schemaVersion: RESEARCH_WRITE_SCHEMA_VERSION,
      status: "succeeded",
      asOf: new Date(row.created_at).toISOString(),
      source: { actorType: row.actor_type, actorId: row.actor_id, correlationId: row.correlation_id },
      data: row.after_payload,
      message: "Idempotent write already recorded."
    },
    stock: { market: row.market, code: row.code, symbol: row.symbol },
    requestFingerprint: row.request_fingerprint ?? null,
    candidateMembershipId: row.candidate_membership_id == null ? null : String(row.candidate_membership_id),
    candidateMembershipVersion: row.candidate_membership_version == null ? null : Number(row.candidate_membership_version)
  };
}

export async function insertWriteAudit(
  client: PoolClient,
  input: {
    eventType: ResearchWriteAuditEventType;
    request: {
      idempotencyKey: string;
      actorType?: "user" | "system" | "migration" | "test";
      actorId?: string | null;
      correlationId?: string | null;
    };
    stock: { id: string; market: string; code: string; symbol: string };
    targetTable: string;
    targetId: string;
    beforePayload: unknown;
    afterPayload: unknown;
    requestFingerprint?: string | null;
    candidateMembershipId?: string | null;
    candidateMembershipVersion?: number | null;
  }
): Promise<string> {
  const result = await client.query<{ created_at: Date | string }>(
    `insert into research_write_audit_events
      (event_type, actor_type, actor_id, stock_id, market, code, symbol, target_table,
       target_id, idempotency_key, before_payload, after_payload, correlation_id,
       request_fingerprint, candidate_membership_id, candidate_membership_version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16)
     returning created_at`,
    [
      input.eventType,
      input.request.actorType ?? "user",
      input.request.actorId ?? null,
      input.stock.id,
      input.stock.market,
      input.stock.code,
      input.stock.symbol,
      input.targetTable,
      input.targetId,
      input.request.idempotencyKey,
      input.beforePayload === null ? null : JSON.stringify(input.beforePayload),
      JSON.stringify(input.afterPayload),
      input.request.correlationId ?? null,
      input.requestFingerprint ?? null,
      input.candidateMembershipId ?? null,
      input.candidateMembershipVersion ?? null
    ]
  );
  const createdAt = result.rows[0]?.created_at;
  if (!createdAt) throw new Error("research write audit insert did not return created_at");
  return new Date(createdAt).toISOString();
}

export function writeEnvelope<TData>(
  request: { actorType?: "user" | "system" | "migration" | "test"; actorId?: string | null; correlationId?: string | null },
  data: TData,
  message: string,
  asOf: string
): ResearchWriteEnvelope<TData> {
  return {
    schemaVersion: RESEARCH_WRITE_SCHEMA_VERSION,
    status: "succeeded",
    asOf,
    source: {
      actorType: request.actorType ?? "user",
      actorId: request.actorId ?? null,
      correlationId: request.correlationId ?? null
    },
    data,
    message
  };
}

export function actorRequest(actor: AuthenticatedResearchActor, idempotencyKey: string) {
  return { actorType: actor.actorType, actorId: actor.actorId, correlationId: null, idempotencyKey } as const;
}

export function sameResearchWriteActor<TData>(
  envelope: ResearchWriteEnvelope<TData>,
  request: { actorType?: "user" | "system" | "migration" | "test"; actorId?: string | null; correlationId?: string | null }
): boolean {
  return envelope.source.actorType === (request.actorType ?? "user")
    && envelope.source.actorId === (request.actorId ?? null)
    && envelope.source.correlationId === (request.correlationId ?? null);
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "23505";
}
