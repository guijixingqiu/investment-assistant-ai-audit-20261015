import type { Pool, PoolClient } from "pg";
import { validResearchSecondOpinionResult, sameBinding,
  type ResearchSecondOpinionRequest, type ResearchSecondOpinionResult } from "../../../../packages/contracts/src/researchSecondOpinion.js";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import { requestFingerprint } from "./deepResearchGate.js";
import { IdempotencyConflictError, type AuthenticatedResearchActor } from "./domain.js";
import { readExistingResearchProfileBinding } from "./writePersistence.js";

// The existing audit check constraint permits these two event types. The
// independent schemaVersion, request fingerprint and route keep this lane
// separate from ordinary report-fact questions without a SQL migration.
const ATTEMPT = "research_evidence_question_attempted";
const COMPLETED = "research_evidence_question_answered";
type EventType = typeof ATTEMPT | typeof COMPLETED;
const failedKey = (key: string) => `${key}:failed`;

export async function runIdempotentResearchSecondOpinion(pool: Pool, request: ResearchSecondOpinionRequest,
  actor: AuthenticatedResearchActor, attempted: ResearchSecondOpinionResult,
  execute: () => Promise<ResearchSecondOpinionResult>): Promise<ResearchSecondOpinionResult> {
  const fingerprint = requestFingerprint("research_second_opinion_v1", { actor, request: {
    ...request, idempotencyKey: undefined
  }, payloadSha256: attempted.sendManifest.payloadSha256 });
  const client = await pool.connect();
  const locks = [`second_opinion_key:${request.idempotencyKey}`, `second_opinion_fingerprint:${fingerprint}`];
  try {
    for (const key of locks) await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [key]);
    const replay = await readReplay(client, request, actor, fingerprint);
    if (replay) return replay;
    const completedForSameInput = await readCompletedByFingerprint(client, request, actor, fingerprint);
    if (completedForSameInput) return completedForSameInput;
    const member = await readCandidateMembershipById(client, actor, request.membershipId);
    if (!member || Number(member.version) !== request.membershipVersion || member.symbol !== request.symbol
      || member.state !== "tracked") throw new Error("研究标的身份已改变；未发送第二意见");
    const profile = await readExistingResearchProfileBinding(client, member.market, member.code, member.symbol);
    if (!profile) throw new Error("当前研究档案不可用；未发送第二意见");
    if (!validResearchSecondOpinionResult(attempted) || attempted.status !== "attempted"
      || !sameBinding(attempted.binding, request)) throw new Error("第二意见发送预留记录无效");
    await insert(client, ATTEMPT, request, actor, profile.stock, fingerprint, attempted);
    let result: ResearchSecondOpinionResult;
    try { result = await execute(); }
    catch (error) {
      result = { ...attempted, generatedAt: new Date().toISOString(),
        tokenUsage: typeof error === "object" && error && "tokenUsage" in error ? String(error.tokenUsage) : "UNKNOWN",
        costUsd: typeof error === "object" && error && "costUsd" in error ? String(error.costUsd) : "UNKNOWN",
        message: error instanceof Error ? `第二意见尝试未完成：${error.message}；提供方是否收到仍为 UNKNOWN。` : "第二意见尝试未完成；提供方是否收到仍为 UNKNOWN。" };
    }
    if (!validResearchSecondOpinionResult(result) || !sameBinding(result.binding, request)) {
      result = { ...attempted, generatedAt: new Date().toISOString(), message: "第二意见结果身份无效；未进入成功历史。" };
    }
    await insert(client, result.status === "available" ? COMPLETED : ATTEMPT,
      request, actor, profile.stock, fingerprint, result,
      result.status === "available" ? request.idempotencyKey : failedKey(request.idempotencyKey));
    return result;
  } finally {
    for (const key of locks.reverse()) await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [key]).catch(() => undefined);
    client.release();
  }
}

async function readCompletedByFingerprint(client: PoolClient, request: ResearchSecondOpinionRequest,
  actor: AuthenticatedResearchActor, fingerprint: string): Promise<ResearchSecondOpinionResult | null> {
  const rows = await client.query<{ after_payload: unknown }>(
    `select after_payload from research_write_audit_events
      where event_type=$1 and request_fingerprint=$2 and target_table='deep_research_reports'
        and actor_type=$3 and actor_id=$4 and candidate_membership_id=$5
        and candidate_membership_version=$6
      order by id desc limit 1`,
    [COMPLETED, fingerprint, actor.actorType, actor.actorId,
      request.membershipId, request.membershipVersion]
  );
  const result = rows.rows[0]?.after_payload;
  if (!result) return null;
  if (!validResearchSecondOpinionResult(result) || result.status !== "available"
    || !sameBinding(result.binding, request)) throw new IdempotencyConflictError("同输入历史结果身份无效");
  return result;
}

export async function readResearchSecondOpinionHistory(pool: Pool, membershipId: string,
  actor: AuthenticatedResearchActor): Promise<{ results: ResearchSecondOpinionResult[]; attempts: ResearchSecondOpinionResult[] }> {
  const rows = await pool.query<{ event_type: EventType; idempotency_key: string; after_payload: unknown }>(
    `select event_type, idempotency_key, after_payload from research_write_audit_events
      where event_type in ($1,$2) and candidate_membership_id=$3
        and actor_type=$4 and actor_id=$5 and target_table='deep_research_reports'
        and after_payload->>'schemaVersion'=$6 order by id desc limit 60`,
    [COMPLETED, ATTEMPT, membershipId, actor.actorType, actor.actorId,
      "2026-10-11.second-opinion.v1"]
  );
  const results: ResearchSecondOpinionResult[] = [], attempts: ResearchSecondOpinionResult[] = [];
  const resolved = new Set(rows.rows.filter(row => row.event_type === COMPLETED
    || row.idempotency_key.endsWith(":failed"))
    .map(row => row.idempotency_key.replace(/:failed$/, "")));
  for (const row of rows.rows) {
    if (!validResearchSecondOpinionResult(row.after_payload)) throw new Error("第二意见已存记录校验失败");
    if (row.event_type === COMPLETED) results.push(row.after_payload);
    if (row.idempotency_key.endsWith(":failed")
      || row.event_type === ATTEMPT && !resolved.has(row.idempotency_key))
      attempts.push(row.after_payload);
  }
  return { results: results.slice(0, 20), attempts: attempts.slice(0, 20) };
}

async function readReplay(client: PoolClient, request: ResearchSecondOpinionRequest,
  actor: AuthenticatedResearchActor, fingerprint: string): Promise<ResearchSecondOpinionResult | null> {
  const rows = await client.query<{ event_type: EventType; after_payload: unknown; actor_type: string;
    actor_id: string; request_fingerprint: string; candidate_membership_id: string;
    candidate_membership_version: number }>(
    `select event_type,after_payload,actor_type,actor_id,request_fingerprint,
            candidate_membership_id,candidate_membership_version
       from research_write_audit_events
      where (idempotency_key=$1 or idempotency_key=$2)
        and event_type in ($3,$4) and target_table='deep_research_reports'
      order by case when event_type=$3 then 0 when idempotency_key=$2 then 1 else 2 end,
        id desc limit 1`,
    [request.idempotencyKey, failedKey(request.idempotencyKey), COMPLETED, ATTEMPT]
  );
  const row = rows.rows[0];
  if (!row) return null;
  if (row.actor_type !== actor.actorType || row.actor_id !== actor.actorId
    || row.request_fingerprint !== fingerprint || row.candidate_membership_id !== request.membershipId
    || Number(row.candidate_membership_version) !== request.membershipVersion
    || !validResearchSecondOpinionResult(row.after_payload)
    || !sameBinding(row.after_payload.binding, request)) {
    throw new IdempotencyConflictError("第二意见请求键已用于不同身份或输入");
  }
  return row.after_payload;
}

async function insert(client: PoolClient, eventType: EventType, request: ResearchSecondOpinionRequest,
  actor: AuthenticatedResearchActor, stock: { id: string; market: string; code: string; symbol: string },
  fingerprint: string, result: ResearchSecondOpinionResult,
  idempotencyKey = request.idempotencyKey): Promise<void> {
  await client.query(
    `insert into research_write_audit_events
      (event_type, actor_type, actor_id, stock_id, market, code, symbol, target_table,
       target_id, idempotency_key, before_payload, after_payload, correlation_id,
       request_fingerprint, candidate_membership_id, candidate_membership_version)
     values ($1,$2,$3,$4,$5,$6,$7,'deep_research_reports',$8,$9,null,$10::jsonb,null,$11,$12,$13)`,
    [eventType, actor.actorType, actor.actorId, stock.id, stock.market, stock.code, stock.symbol,
      request.reportId, idempotencyKey, JSON.stringify(result), fingerprint,
      request.membershipId, request.membershipVersion]
  );
}
