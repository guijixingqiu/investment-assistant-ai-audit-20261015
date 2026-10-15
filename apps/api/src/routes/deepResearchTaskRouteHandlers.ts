import type { FastifyReply, FastifyRequest } from "fastify";
import {
  validateCancelDeepResearchTaskRequest,
  validateCreateDeepResearchTaskRequest,
  validateDeepResearchTaskActionRequest,
  validateDeepResearchTaskEnvelope,
  type CreateDeepResearchTaskRequest,
  type CancelDeepResearchTaskRequest,
  type DeepResearchTaskActionRequest
} from "../../../../packages/contracts/src/deepResearchTask.js";
import {
  emptyTaskEnvelope,
  enqueueDeepResearchTask,
  readCurrentDeepResearchTask,
  readDeepResearchTask
} from "../research/deepResearchTaskRepository.js";
import {
  absorbDeepResearchTask,
  cancelDeepResearchTask,
  retryDeepResearchTask
} from "../research/deepResearchTaskActionService.js";
import { authenticateReadOnly, authenticateWrite } from "./researchAuth.js";
import {
  isCanonicalMembershipId,
  rejectClientControlledAuditFields
} from "./researchRouteValidation.js";
import { researchWriteFailure } from "./researchRouteSupport.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";

function sourceStoreForRequest(options:MobileResearchRouteOptions){return options.researchDocument
  ? {repositoryRoot:options.researchDocument.repositoryRoot,rawStoreRoot:options.researchDocument.rawStoreRoot,
    availabilityCache:new Map()} : undefined;}

export async function handleEnqueueDeepResearchTask(
  options: MobileResearchRouteOptions,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const actor = authenticateWrite(request.headers, options, "research_write");
  if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
  if (actor.actorType !== "user") return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required to start deep research" });
  const id = (request.params as { id: string }).id;
  if (!isCanonicalMembershipId(id)) return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
  const body = request.body as unknown;
  const validation = validateCreateDeepResearchTaskRequest(body);
  const auditErrors = rejectClientControlledAuditFields(body);
  if (!validation.ok || auditErrors.length) return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
  try {
    const envelope = await enqueueDeepResearchTask(options.pool, id, body as CreateDeepResearchTaskRequest, actor, options.now?.(),null,true,sourceStoreForRequest(options));
    if (!validateDeepResearchTaskEnvelope(envelope, options.now?.()).ok) {
      return reply.code(503).send({ ok: false, message: "deep-research task response failed contract validation" });
    }
    options.deepResearchTaskKick?.();
    return reply.code(202).send(envelope);
  } catch (error) {
    return researchWriteFailure(reply, error, "deep-research task repository is unavailable");
  }
}

export async function handleReadDeepResearchTask(
  options: MobileResearchRouteOptions,
  request: FastifyRequest,
  reply: FastifyReply
) {
  reply.header("cache-control", "no-store");
  const now = options.now?.() ?? new Date();
  const params = request.params as { id: string; taskId: string };
  const actor = authenticateReadOnly(request.headers, options);
  if (!actor) return reply.code(401).send(emptyTaskEnvelope("unauthorized", params.id, "unauthorized", now, "read authorization required"));
  if (!isCanonicalMembershipId(params.id) || !isCanonicalMembershipId(params.taskId)) {
    return reply.code(400).send(emptyTaskEnvelope("unavailable", params.id, actor.actorId, now, "membership and task ids must be positive integers"));
  }
  try {
    const envelope = await readDeepResearchTask(options.pool, params.id, params.taskId, actor, now);
    if (!validateDeepResearchTaskEnvelope(envelope, now).ok) {
      return reply.code(503).send(emptyTaskEnvelope("unavailable", params.id, actor.actorId, now, "deep-research task response failed contract validation"));
    }
    return reply.code(envelope.status === "not_found" ? 404 : 200).send(envelope);
  } catch {
    return reply.code(503).send(emptyTaskEnvelope("unavailable", params.id, actor.actorId, now, "deep-research task repository is unavailable"));
  }
}

export async function handleReadCurrentDeepResearchTask(
  options: MobileResearchRouteOptions,
  request: FastifyRequest,
  reply: FastifyReply
) {
  reply.header("cache-control", "no-store");
  const now = options.now?.() ?? new Date();
  const id = (request.params as { id: string }).id;
  const query = request.query as {
    membershipVersion?: string;
    evidencePackId?: string;
    evidencePackFingerprint?: string;
  };
  const actor = authenticateReadOnly(request.headers, options);
  if (!actor) return reply.code(401).send(emptyTaskEnvelope("unauthorized", id, "unauthorized", now, "read authorization required"));
  const membershipVersion = Number(query.membershipVersion);
  if (!isCanonicalMembershipId(id)
    || !Number.isSafeInteger(membershipVersion) || membershipVersion < 1
    || !isCanonicalMembershipId(query.evidencePackId ?? "")
    || !/^[a-f0-9]{64}$/.test(query.evidencePackFingerprint ?? "")) {
    return reply.code(400).send(emptyTaskEnvelope("unavailable", id, actor.actorId, now, "current task identity is invalid"));
  }
  try {
    const envelope = await readCurrentDeepResearchTask(
      options.pool,
      id,
      membershipVersion,
      query.evidencePackId!,
      query.evidencePackFingerprint!,
      actor,
      now
    );
    if (!validateDeepResearchTaskEnvelope(envelope, now).ok) {
      return reply.code(503).send(emptyTaskEnvelope("unavailable", id, actor.actorId, now, "deep-research task response failed contract validation"));
    }
    return reply.code(200).send(envelope);
  } catch {
    return reply.code(503).send(emptyTaskEnvelope("unavailable", id, actor.actorId, now, "deep-research task repository is unavailable"));
  }
}

export async function handleRetryDeepResearchTask(
  options: MobileResearchRouteOptions,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const actor = authenticateWrite(request.headers, options, "research_write");
  if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
  if (actor.actorType !== "user") return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required to retry deep research" });
  const params = request.params as { id: string; taskId: string };
  if (!isCanonicalMembershipId(params.id) || !isCanonicalMembershipId(params.taskId)) return reply.code(400).send({ ok: false, message: "membership and task ids must be positive integers" });
  const body = request.body as unknown;
  const validation = validateDeepResearchTaskActionRequest(body);
  const auditErrors = rejectClientControlledAuditFields(body);
  if (!validation.ok || auditErrors.length) return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
  try {
    const now = options.now?.() ?? new Date();
    const envelope = await retryDeepResearchTask(options.pool, params.id, params.taskId, body as DeepResearchTaskActionRequest, actor, now,sourceStoreForRequest(options));
    if (!validateDeepResearchTaskEnvelope(envelope, now).ok) return reply.code(503).send({ ok: false, message: "deep-research retry response failed contract validation" });
    options.deepResearchTaskKick?.();
    return reply.code(202).send(envelope);
  } catch (error) {
    return researchWriteFailure(reply, error, "deep-research retry repository is unavailable");
  }
}

export async function handleAbsorbDeepResearchTask(
  options: MobileResearchRouteOptions,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const actor = authenticateWrite(request.headers, options, "research_write");
  if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
  if (actor.actorType !== "user") return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required to absorb deep research" });
  const params = request.params as { id: string; taskId: string };
  if (!isCanonicalMembershipId(params.id) || !isCanonicalMembershipId(params.taskId)) return reply.code(400).send({ ok: false, message: "membership and task ids must be positive integers" });
  const body = request.body as unknown;
  const validation = validateDeepResearchTaskActionRequest(body);
  const auditErrors = rejectClientControlledAuditFields(body);
  if (!validation.ok || auditErrors.length) return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
  try {
    const now = options.now?.() ?? new Date();
    const envelope = await absorbDeepResearchTask(options.pool, params.id, params.taskId, body as DeepResearchTaskActionRequest, actor, now,sourceStoreForRequest(options));
    if (!validateDeepResearchTaskEnvelope(envelope, now).ok) return reply.code(503).send({ ok: false, message: "deep-research absorption response failed contract validation" });
    return envelope;
  } catch (error) {
    return researchWriteFailure(reply, error, "deep-research absorption repository is unavailable");
  }
}

export async function handleCancelDeepResearchTask(
  options: MobileResearchRouteOptions,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const actor = authenticateWrite(request.headers, options, "research_write");
  if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
  if (actor.actorType !== "user") return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required to cancel deep research" });
  const params = request.params as { id: string; taskId: string };
  if (!isCanonicalMembershipId(params.id) || !isCanonicalMembershipId(params.taskId)) return reply.code(400).send({ ok: false, message: "membership and task ids must be positive integers" });
  const body = request.body as unknown;
  const validation = validateCancelDeepResearchTaskRequest(body);
  const auditErrors = rejectClientControlledAuditFields(body);
  if (!validation.ok || auditErrors.length) return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
  try {
    const now = options.now?.() ?? new Date();
    const envelope = await cancelDeepResearchTask(options.pool, params.id, params.taskId, body as CancelDeepResearchTaskRequest, actor, now);
    if (!validateDeepResearchTaskEnvelope(envelope, now).ok) return reply.code(503).send({ ok: false, message: "deep-research cancellation response failed contract validation" });
    return envelope;
  } catch (error) {
    return researchWriteFailure(reply, error, "deep-research cancellation repository is unavailable");
  }
}
