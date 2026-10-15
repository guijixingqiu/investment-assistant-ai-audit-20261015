import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { DecideAiSuggestionRequest } from "../../../../packages/contracts/src/research.js";
import { IdempotencyConflictError } from "./domain.js";
import type { AiSuggestionDecisionResult, AuthenticatedResearchActor } from "./domain.js";
import { type SuggestionRow, rowToSuggestion } from "./researchMappers.js";
import { isUniqueViolation } from "./writePersistence.js";

export async function decideAiSuggestion(
  pool: Pool,
  suggestionId: string,
  request: DecideAiSuggestionRequest,
  actor: AuthenticatedResearchActor
): Promise<AiSuggestionDecisionResult | null> {
  const note = request.note ?? null;
  const requestFingerprint = stableFingerprint({
    operation: "ai_suggestion_decision",
    suggestionId,
    action: request.action,
    note,
    actor
  });
  const idempotencyKey = request.idempotencyKey ?? `ai-suggestion-decision:${requestFingerprint}`;
  const correlationId = `ai-suggestion-decision:${actor.actorType}:${actor.actorId}:${idempotencyKey}`;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const replay = await findAiSuggestionDecisionByIdempotencyKey(client, idempotencyKey);
    if (replay) {
      if (!sameAiSuggestionDecisionReplay(replay, suggestionId, request.action, note, actor, requestFingerprint, correlationId)) {
        throw new IdempotencyConflictError("idempotency key already used with a different suggestion decision payload or actor");
      }
      await client.query("commit");
      return aiSuggestionDecisionResult(replay, true);
    }

    const current = await client.query<SuggestionRow>(
      `select id, status, summary, supports, weakens, counter_evidence, changed_variables,
              missing_evidence, created_at, decided_at, decision_note
         from ai_update_suggestions
        where id = $1
        for update`,
      [suggestionId]
    );
    const currentSuggestion = current.rows[0];
    if (!currentSuggestion) {
      await client.query("rollback");
      return null;
    }
    if (currentSuggestion.status !== "pending") {
      const existingDecision = await findAiSuggestionDecisionBySuggestionId(client, suggestionId);
      if (!existingDecision || !sameAiSuggestionDecisionPayload(existingDecision, suggestionId, request.action, note, actor, requestFingerprint)) {
        throw new IdempotencyConflictError("suggestion already decided with a different action, note, or actor");
      }
      await client.query("commit");
      return aiSuggestionDecisionResult(existingDecision, true);
    }

    const updated = await client.query<SuggestionRow>(
      `update ai_update_suggestions
          set status = $2,
              decided_at = now(),
              decision_note = $3
        where id = $1
          and status = 'pending'
      returning id, status, summary, supports, weakens, counter_evidence, changed_variables,
                missing_evidence, created_at, decided_at, decision_note`,
      [suggestionId, request.action, note]
    );
    const suggestion = updated.rows[0];
    if (!suggestion) {
      throw new IdempotencyConflictError("suggestion decision lost its pending write lock");
    }
    const inserted = await client.query<{ id: string; created_at: Date | string }>(
      `insert into ai_suggestion_decisions
        (suggestion_id, action, note, actor_type, actor_id, idempotency_key,
         request_fingerprint, correlation_id, raw_payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       returning id, created_at`,
      [
        suggestionId,
        request.action,
        note,
        actor.actorType,
        actor.actorId,
        idempotencyKey,
        requestFingerprint,
        correlationId,
        JSON.stringify({ autoApply: false, mutatesResearchProfile: false })
      ]
    );
    await client.query("commit");
    return {
      decisionId: String(inserted.rows[0]?.id ?? ""),
      idempotencyKey,
      replayed: false,
      source: {
        actorType: actor.actorType,
        actorId: actor.actorId,
        correlationId
      },
      suggestion: rowToSuggestion(suggestion)
    };
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findAiSuggestionDecisionByIdempotencyKey(pool, idempotencyKey);
      if (replay && sameAiSuggestionDecisionReplay(replay, suggestionId, request.action, note, actor, requestFingerprint, correlationId)) {
        return aiSuggestionDecisionResult(replay, true);
      }
      throw new IdempotencyConflictError("suggestion decision conflicts with existing idempotency history");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function findAiSuggestionDecisionByIdempotencyKey(
  client: Pick<Pool | PoolClient, "query">,
  idempotencyKey: string
): Promise<AiSuggestionDecisionReplayRow | null> {
  return findAiSuggestionDecision(client, "decision.idempotency_key = $1", idempotencyKey);
}

async function findAiSuggestionDecisionBySuggestionId(
  client: Pick<Pool | PoolClient, "query">,
  suggestionId: string
): Promise<AiSuggestionDecisionReplayRow | null> {
  return findAiSuggestionDecision(client, "decision.suggestion_id = $1", suggestionId);
}

async function findAiSuggestionDecision(
  client: Pick<Pool | PoolClient, "query">,
  predicate: "decision.idempotency_key = $1" | "decision.suggestion_id = $1",
  value: string
): Promise<AiSuggestionDecisionReplayRow | null> {
  const result = await client.query<AiSuggestionDecisionReplayRow>(
    `select decision.id as decision_id, decision.suggestion_id, decision.action, decision.note,
            decision.actor_type, decision.actor_id, decision.idempotency_key,
            decision.request_fingerprint, decision.correlation_id,
            suggestion.id, suggestion.status, suggestion.summary, suggestion.supports,
            suggestion.weakens, suggestion.counter_evidence, suggestion.changed_variables,
            suggestion.missing_evidence, suggestion.created_at, suggestion.decided_at,
            suggestion.decision_note
       from ai_suggestion_decisions decision
       join ai_update_suggestions suggestion on suggestion.id = decision.suggestion_id
      where ${predicate}
      limit 1`,
    [value]
  );
  return result.rows[0] ?? null;
}

function sameAiSuggestionDecisionReplay(
  replay: AiSuggestionDecisionReplayRow,
  suggestionId: string,
  action: "accepted" | "rejected",
  note: string | null,
  actor: AuthenticatedResearchActor,
  requestFingerprint: string,
  correlationId: string
): boolean {
  return sameAiSuggestionDecisionPayload(replay, suggestionId, action, note, actor, requestFingerprint)
    && replay.correlation_id === correlationId;
}

function sameAiSuggestionDecisionPayload(
  replay: AiSuggestionDecisionReplayRow,
  suggestionId: string,
  action: "accepted" | "rejected",
  note: string | null,
  actor: AuthenticatedResearchActor,
  requestFingerprint: string
): boolean {
  return String(replay.suggestion_id) === suggestionId
    && replay.action === action
    && replay.note === note
    && replay.actor_type === actor.actorType
    && replay.actor_id === actor.actorId
    && replay.request_fingerprint === requestFingerprint
    && replay.status === action
    && replay.decision_note === note;
}

function aiSuggestionDecisionResult(
  replay: AiSuggestionDecisionReplayRow,
  replayed: boolean
): AiSuggestionDecisionResult {
  return {
    decisionId: String(replay.decision_id),
    idempotencyKey: replay.idempotency_key,
    replayed,
    source: {
      actorType: replay.actor_type,
      actorId: replay.actor_id,
      correlationId: replay.correlation_id
    },
    suggestion: rowToSuggestion(replay)
  };
}

function stableFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

interface AiSuggestionDecisionReplayRow extends SuggestionRow {
  decision_id: string;
  suggestion_id: string;
  action: "accepted" | "rejected";
  note: string | null;
  actor_type: AuthenticatedResearchActor["actorType"];
  actor_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  correlation_id: string;
}
