import type { Pool, PoolClient } from "pg";
import {
  RESEARCH_EVIDENCE_QUESTION_SCHEMA_VERSION,
  type ResearchEvidenceQuestionEnvelope,
  type ResearchEvidenceQuestionRequest,
  validateResearchEvidenceQuestionEnvelope
} from "../../../../packages/contracts/src/researchEvidenceQuestion.js";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import {
  CandidateMembershipConflictError,
  CandidateMembershipNotFoundError,
  CandidateMembershipVersionConflictError,
  IdempotencyConflictError,
  type AuthenticatedResearchActor
} from "./domain.js";
import { requestFingerprint } from "./deepResearchGate.js";
import { readExistingResearchProfileBinding } from "./writePersistence.js";
import {
  actorRequest,
  findAuditByIdempotencyKey,
  insertWriteAudit,
  isUniqueViolation
} from "./writePersistence.js";

const ATTEMPT_EVENT_TYPE = "research_evidence_question_attempted" as const;
const ANSWER_EVENT_TYPE = "research_evidence_question_answered" as const;

export async function runIdempotentResearchEvidenceQuestion(
  pool: Pool,
  membershipId: string,
  request: ResearchEvidenceQuestionRequest,
  actor: AuthenticatedResearchActor,
  attemptReservation: ResearchEvidenceQuestionEnvelope,
  execute: () => Promise<ResearchEvidenceQuestionEnvelope>
): Promise<ResearchEvidenceQuestionEnvelope> {
  const { idempotencyKey, ...input } = request;
  const fingerprint = requestFingerprint("research_evidence_question_answer_v1", {
    schemaVersion: RESEARCH_EVIDENCE_QUESTION_SCHEMA_VERSION,
    provider: "deepseek",
    model: "deepseek-flash",
    membershipId,
    ...input
  });
  const legacyFingerprint = requestFingerprint("research_evidence_question_answer_v1", {
    schemaVersion: RESEARCH_EVIDENCE_QUESTION_SCHEMA_VERSION,
    provider: "deepseek", model: "deepseek-v4-flash", membershipId, ...input
  });
  const client = await pool.connect();
  const lockKeys = [
    `research_evidence_question_idempotency:${idempotencyKey}`,
    `research_evidence_question_fingerprint:${fingerprint}`
  ];
  let lockCount = 0;
  try {
    for (const key of lockKeys) {
      await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [key]);
      lockCount += 1;
    }
    const replay = await replayByKey(client, membershipId, request, actor, fingerprint, ANSWER_EVENT_TYPE, legacyFingerprint)
      ?? await replayByKey(client, membershipId, request, actor, fingerprint, ATTEMPT_EVENT_TYPE, legacyFingerprint)
      ?? await replayByFingerprint(client, membershipId, request, actor, fingerprint);
    if (replay) return replay;

    const membership = await readCandidateMembershipById(client, actor, membershipId);
    if (!membership) throw new CandidateMembershipNotFoundError();
    if (Number(membership.version) !== request.membershipVersion) throw new CandidateMembershipVersionConflictError();
    if (membership.state === "archived") throw new CandidateMembershipConflictError("archived membership cannot ask Cloud AI");
    const profile = await readExistingResearchProfileBinding(client, membership.market, membership.code, membership.symbol);
    if (!profile) throw new CandidateMembershipConflictError("research profile is unavailable for the current membership");
    if (attemptReservation.status !== "unavailable"
      || !attemptReservation.sendManifest
      || attemptReservation.sendManifest.membershipId !== membershipId
      || attemptReservation.sendManifest.membershipVersion !== request.membershipVersion
      || attemptReservation.sendManifest.reportId !== request.reportId
      || attemptReservation.sendManifest.reportFingerprint !== request.reportFingerprint
      || !validateResearchEvidenceQuestionEnvelope(attemptReservation).ok) {
      throw new CandidateMembershipConflictError("evidence-question send reservation is invalid");
    }
    try {
      await insertWriteAudit(client, {
        eventType: ATTEMPT_EVENT_TYPE,
        request: actorRequest(actor, idempotencyKey),
        stock: profile.stock,
        targetTable: "deep_research_reports",
        targetId: request.reportId,
        beforePayload: null,
        afterPayload: attemptReservation,
        requestFingerprint: fingerprint,
        candidateMembershipId: membershipId,
        candidateMembershipVersion: request.membershipVersion
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const concurrent = await replayByKey(
        client, membershipId, request, actor, fingerprint, ATTEMPT_EVENT_TYPE, legacyFingerprint
      );
      if (concurrent) return concurrent;
      throw new IdempotencyConflictError("evidence-question idempotency key belongs to another request");
    }

    const response = await execute();
    if (response.reproducibility.provider !== "deepseek"
      || !validateResearchEvidenceQuestionEnvelope(response).ok) return response;
    if (response.status !== "available") return response;
    try {
      await insertWriteAudit(client, {
        eventType: ANSWER_EVENT_TYPE,
        request: actorRequest(actor, idempotencyKey),
        stock: profile.stock,
        targetTable: "deep_research_reports",
        targetId: response.binding?.reportId ?? request.reportId,
        beforePayload: null,
        afterPayload: response,
        requestFingerprint: fingerprint,
        candidateMembershipId: membershipId,
        candidateMembershipVersion: request.membershipVersion
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const concurrent = await replayByKey(client, membershipId, request, actor, fingerprint, ANSWER_EVENT_TYPE, legacyFingerprint);
      if (concurrent) return concurrent;
      throw new IdempotencyConflictError("evidence-question idempotency key belongs to another request");
    }
    return response;
  } finally {
    for (const key of lockKeys.slice(0, lockCount).reverse()) {
      await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [key]).catch(() => undefined);
    }
    client.release();
  }
}

async function replayByKey(
  client: PoolClient,
  membershipId: string,
  request: ResearchEvidenceQuestionRequest,
  actor: AuthenticatedResearchActor,
  fingerprint: string,
  eventType: typeof ANSWER_EVENT_TYPE | typeof ATTEMPT_EVENT_TYPE,
  legacyFingerprint: string
): Promise<ResearchEvidenceQuestionEnvelope | null> {
  const replay = await findAuditByIdempotencyKey<ResearchEvidenceQuestionEnvelope>(client, request.idempotencyKey, eventType);
  if (!replay) return null;
  if (!sameReplay(replay, membershipId, request, actor, fingerprint)
    && !sameReplay(replay, membershipId, request, actor, legacyFingerprint)) {
    throw new IdempotencyConflictError("evidence-question idempotency key belongs to another request");
  }
  return validReplay(replay.envelope.data);
}

async function replayByFingerprint(
  client: PoolClient,
  membershipId: string,
  request: ResearchEvidenceQuestionRequest,
  actor: AuthenticatedResearchActor,
  fingerprint: string
): Promise<ResearchEvidenceQuestionEnvelope | null> {
  const result = await client.query<{ after_payload: ResearchEvidenceQuestionEnvelope }>(
    `select after_payload
       from research_write_audit_events
      where event_type = $1 and request_fingerprint = $2
        and actor_type = $3 and actor_id = $4
        and candidate_membership_id = $5 and candidate_membership_version = $6
      order by id desc limit 1`,
    [ANSWER_EVENT_TYPE, fingerprint, actor.actorType, actor.actorId, membershipId, request.membershipVersion]
  );
  return result.rows[0] ? validReplay(result.rows[0].after_payload) : null;
}

function sameReplay(
  replay: Awaited<ReturnType<typeof findAuditByIdempotencyKey<ResearchEvidenceQuestionEnvelope>>>,
  membershipId: string,
  request: ResearchEvidenceQuestionRequest,
  actor: AuthenticatedResearchActor,
  fingerprint: string
): boolean {
  return !!replay
    && replay.envelope.source.actorType === actor.actorType
    && replay.envelope.source.actorId === actor.actorId
    && replay.requestFingerprint === fingerprint
    && replay.candidateMembershipId === membershipId
    && replay.candidateMembershipVersion === request.membershipVersion;
}

function validReplay(value: ResearchEvidenceQuestionEnvelope): ResearchEvidenceQuestionEnvelope {
  if (!validateResearchEvidenceQuestionEnvelope(value).ok) {
    throw new CandidateMembershipConflictError("stored evidence-question response failed contract validation");
  }
  return value;
}
