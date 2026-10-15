import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import {
  CANDIDATE_MEMBERSHIP_SCHEMA_VERSION,
  type CreateCandidateMembershipRequest,
  type UpdateCandidateMembershipStateRequest,
  validateCandidateMembershipEnvelope,
  validateCandidateMembershipWriteEnvelope,
  validateCreateCandidateMembershipRequest,
  validateUpdateCandidateMembershipStateRequest
} from "../../../../packages/contracts/src/candidateMembership.js";
import { CANDIDATE_OVERVIEW_SCHEMA_VERSION, validateCandidateOverviewEnvelope } from "../../../../packages/contracts/src/candidateOverview.js";
import { createCandidateMembership, updateCandidateMembershipState } from "../research/candidateMembershipWriteRepository.js";
import { readCandidateOverviewEnvelope } from "../research/candidateOverviewRepository.js";
import { readCandidateMembershipEnvelope } from "../research/candidateMembershipReadRepository.js";
import {
  CandidateMembershipConflictError,
  CandidateMembershipNotFoundError,
  CandidateMembershipRepositoryUnavailableError,
  CandidateMembershipVersionConflictError
} from "../research/domain.js";
import { authenticateReadOnly, authenticateWrite, type ResearchAuthOptions } from "./researchAuth.js";
import { isCanonicalMembershipId, parseBooleanQuery, rejectClientControlledAuditFields } from "./researchRouteValidation.js";

export interface CandidateMembershipRouteOptions extends ResearchAuthOptions {
  pool: Pool;
  quoteLiveMaxAgeSeconds: number;
}

export async function registerCandidateMembershipRoutes(app: FastifyInstance, options: CandidateMembershipRouteOptions): Promise<void> {
  app.get("/api/mobile/research/candidates", async (request, reply) => {
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) {
      await reply.code(401).send({ ok: false, message: "read authorization required" });
      return;
    }
    const envelope = await readCandidateOverviewEnvelope(options.pool, options.quoteLiveMaxAgeSeconds);
    const validation = validateCandidateOverviewEnvelope(envelope);
    if (!validation.ok) {
      await reply.code(503).send(candidateOverviewFailClosedEnvelope(new Date().toISOString(), "Assembled candidate overview failed contract validation before response."));
      return;
    }
    return envelope;
  });

  app.get("/api/mobile/research/candidate-memberships", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) {
      await reply.code(401).send({ ok: false, message: "read authorization required" });
      return;
    }
    const query = request.query as { includeArchived?: string | boolean } | null;
    const includeArchived = parseBooleanQuery(query?.includeArchived);
    if (includeArchived === null) {
      await reply.code(400).send({ ok: false, message: "includeArchived must be true or false" });
      return;
    }
    const envelope = await readCandidateMembershipEnvelope(options.pool, actor, includeArchived, options.quoteLiveMaxAgeSeconds);
    const validation = validateCandidateMembershipEnvelope(envelope);
    if (!validation.ok) {
      await reply.code(503).send(candidateMembershipFailClosedEnvelope(new Date().toISOString(), includeArchived, "Assembled candidate membership envelope failed contract validation before response."));
      return;
    }
    if (envelope.status === "unavailable") {
      await reply.code(503).send(envelope);
      return;
    }
    return envelope;
  });

  app.route({
    method: "POST",
    url: "/api/mobile/research/candidate-memberships",
    handler: async (request, reply) => {
      const actor = authenticateWrite(request.headers, options, "candidate_write");
      if (!actor) {
        await reply.code(401).send({ ok: false, message: "write authorization required" });
        return;
      }
      const body = request.body as object | null;
      const protectedFieldErrors = rejectClientControlledAuditFields(body);
      if (protectedFieldErrors.length > 0) {
        await reply.code(400).send({ ok: false, errors: protectedFieldErrors });
        return;
      }
      const validation = validateCreateCandidateMembershipRequest(body);
      if (!validation.ok) {
        await reply.code(400).send({ ok: false, errors: validation.errors });
        return;
      }
      try {
        const envelope = await createCandidateMembership(options.pool, body as CreateCandidateMembershipRequest, actor, options.quoteLiveMaxAgeSeconds);
        const responseValidation = validateCandidateMembershipWriteEnvelope(envelope);
        if (!responseValidation.ok) {
          await reply.code(503).send({ ok: false, message: "Assembled candidate membership write response failed contract validation before success." });
          return;
        }
        const replayedWrite = envelope.message === "Idempotent candidate membership write already recorded.";
        await reply.code(envelope.result === "created" && !replayedWrite ? 201 : 200).send(envelope);
      } catch (error) {
        if (error instanceof CandidateMembershipConflictError) {
          await reply.code(409).send({ ok: false, message: error.message });
          return;
        }
        if (isRepositoryFailure(error)) {
          await reply.code(503).send({ ok: false, message: "candidate membership repository is unavailable" });
          return;
        }
        throw error;
      }
    }
  });

  app.route({
    method: "PATCH",
    url: "/api/mobile/research/candidate-memberships/:id/state",
    handler: async (request, reply) => {
      const actor = authenticateWrite(request.headers, options, "candidate_write");
      if (!actor) {
        await reply.code(401).send({ ok: false, message: "write authorization required" });
        return;
      }
      const body = request.body as object | null;
      const protectedFieldErrors = rejectClientControlledAuditFields(body);
      if (protectedFieldErrors.length > 0) {
        await reply.code(400).send({ ok: false, errors: protectedFieldErrors });
        return;
      }
      const validation = validateUpdateCandidateMembershipStateRequest(body);
      if (!validation.ok) {
        await reply.code(400).send({ ok: false, errors: validation.errors });
        return;
      }
      const params = request.params as { id: string };
      if (!isCanonicalMembershipId(params.id)) {
        await reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
        return;
      }
      try {
        const envelope = await updateCandidateMembershipState(options.pool, params.id, body as UpdateCandidateMembershipStateRequest, actor, options.quoteLiveMaxAgeSeconds);
        const responseValidation = validateCandidateMembershipWriteEnvelope(envelope);
        if (!responseValidation.ok) {
          await reply.code(503).send({ ok: false, message: "Assembled candidate membership write response failed contract validation before success." });
          return;
        }
        return envelope;
      } catch (error) {
        if (error instanceof CandidateMembershipNotFoundError) {
          await reply.code(404).send({ ok: false, message: error.message });
          return;
        }
        if (error instanceof CandidateMembershipConflictError || error instanceof CandidateMembershipVersionConflictError) {
          await reply.code(409).send({ ok: false, message: error.message });
          return;
        }
        if (isRepositoryFailure(error)) {
          await reply.code(503).send({ ok: false, message: "candidate membership repository is unavailable" });
          return;
        }
        throw error;
      }
    }
  });
}

function isRepositoryFailure(error: unknown): boolean {
  if (error instanceof CandidateMembershipRepositoryUnavailableError) return true;
  return error instanceof Error
    && !(error instanceof CandidateMembershipConflictError)
    && !(error instanceof CandidateMembershipNotFoundError)
    && !(error instanceof CandidateMembershipVersionConflictError);
}

function candidateOverviewFailClosedEnvelope(generatedAt: string, message: string) {
  return {
    schemaVersion: CANDIDATE_OVERVIEW_SCHEMA_VERSION,
    generatedAt,
    status: "unavailable",
    message,
    provenance: { candidates: "research_profiles", quotes: "persisted_market_quotes", portfolio: "omitted" },
    metadata: makeFactMetadata({
      source: "candidate_overview:research_profiles", asOf: generatedAt, fetchedAt: generatedAt,
      freshness: "unavailable", provenance: "research_only", authority: "unavailable",
      stale: false, missing: false, conflict: false, fixture: false, correctionOf: null, replaces: null,
      message: "Candidate overview metadata is unavailable; no partial candidate facts are exposed."
    }),
    candidates: []
  };
}

function candidateMembershipFailClosedEnvelope(generatedAt: string, includeArchived: boolean, message: string) {
  return {
    schemaVersion: CANDIDATE_MEMBERSHIP_SCHEMA_VERSION,
    generatedAt,
    status: "unavailable",
    includeArchived,
    message,
    provenance: { memberships: "candidate_memberships", research: "research_profiles_optional", quotes: "persisted_market_quotes_optional", portfolio: "omitted" },
    metadata: makeFactMetadata({
      source: "candidate_memberships", asOf: generatedAt, fetchedAt: generatedAt,
      freshness: "unavailable", provenance: "unavailable", authority: "unavailable",
      stale: false, missing: false, conflict: false, fixture: false, correctionOf: null, replaces: null, message
    }),
    memberships: []
  };
}
