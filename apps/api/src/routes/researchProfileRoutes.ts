import type { FastifyInstance } from "fastify";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import {
  RESEARCH_PROFILE_SCHEMA_VERSION,
  type CreateEvidenceRequest,
  type UpdateResearchProfileRequest,
  validateCreateEvidenceRequest,
  validateEvidenceWriteEnvelope,
  validateResearchProfileEnvelope,
  validateResearchProfileWriteEnvelope,
  validateUpdateResearchProfileRequest
} from "../../../../packages/contracts/src/research.js";
import { createEvidence, updateResearchProfile } from "../research/researchProfileWriteRepository.js";
import { readResearchProfileEnvelope } from "../research/researchProfileReadRepository.js";
import {
  CandidateMembershipConflictError,
  CandidateMembershipNotFoundError,
  CandidateMembershipVersionConflictError,
  DeepResearchGateError,
  IdempotencyConflictError
} from "../research/domain.js";
import { authenticateReadOnly, authenticateWrite } from "./researchAuth.js";
import {
  canonicalHongKongSymbol,
  isSupportedHongKongSymbol,
  rejectClientControlledAuditFields
} from "./researchRouteValidation.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";

export async function registerResearchProfileRoutes(app: FastifyInstance, options: MobileResearchRouteOptions): Promise<void> {
  app.get("/api/mobile/research/profiles/:market/:code", async (request, reply) => {
    const params = request.params as { market: string; code: string };
    if (!isSupportedHongKongSymbol(params.market, params.code)) {
      await reply.code(400).send({ ok: false, message: "only Hong Kong symbols such as HK.09926 are supported" });
      return;
    }
    if (!authenticateReadOnly(request.headers, options)) {
      await reply.code(401).send(researchProfileFailClosedEnvelope(
        canonicalHongKongSymbol(params.market, params.code),
        "read authorization required"
      ));
      return;
    }
    try {
      const envelope = await readResearchProfileEnvelope(
        options.pool,
        params.market,
        params.code,
        options.now?.() ?? new Date()
      );
      if (!validateResearchProfileEnvelope(envelope).ok) {
        await reply.code(503).send(researchProfileFailClosedEnvelope(
          canonicalHongKongSymbol(params.market, params.code),
          "Assembled research profile failed contract validation before response."
        ));
        return;
      }
      return envelope;
    } catch {
      await reply.code(503).send(researchProfileFailClosedEnvelope(
        canonicalHongKongSymbol(params.market, params.code),
        "research profile repository is unavailable"
      ));
    }
  });

  app.put("/api/mobile/research/profiles/:market/:code", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) {
      await reply.code(401).send({ ok: false, message: "write authorization required" });
      return;
    }
    const params = request.params as { market: string; code: string };
    if (!isSupportedHongKongSymbol(params.market, params.code)) {
      await reply.code(400).send({ ok: false, message: "only Hong Kong symbols such as HK.09926 are supported" });
      return;
    }
    const body = { ...(request.body as object ?? {}), market: params.market, code: params.code };
    const protectedFieldErrors = rejectClientControlledAuditFields(request.body);
    if (protectedFieldErrors.length > 0) {
      await reply.code(400).send({ ok: false, errors: protectedFieldErrors });
      return;
    }
    const validation = validateUpdateResearchProfileRequest(body);
    if (!validation.ok) {
      await reply.code(400).send({ ok: false, errors: validation.errors });
      return;
    }
    try {
      const envelope = await updateResearchProfile(options.pool, body as UpdateResearchProfileRequest, actor);
      if (!validateResearchProfileWriteEnvelope(envelope, canonicalHongKongSymbol(params.market, params.code)).ok) {
        await reply.code(503).send({ ok: false, message: "Assembled research profile write response failed contract validation before success." });
        return;
      }
      return envelope;
    } catch (error) {
      if (isResearchWriteConflict(error)) {
        await reply.code(409).send({ ok: false, message: error.message });
        return;
      }
      await reply.code(503).send({ ok: false, message: "research profile write repository is unavailable" });
    }
  });

  app.post("/api/mobile/research/profiles/:market/:code/evidence", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) {
      await reply.code(401).send({ ok: false, message: "write authorization required" });
      return;
    }
    const params = request.params as { market: string; code: string };
    if (!isSupportedHongKongSymbol(params.market, params.code)) {
      await reply.code(400).send({ ok: false, message: "only Hong Kong symbols such as HK.09926 are supported" });
      return;
    }
    const body = request.body as object | null;
    const protectedFieldErrors = rejectClientControlledAuditFields(body);
    if (protectedFieldErrors.length > 0) {
      await reply.code(400).send({ ok: false, errors: protectedFieldErrors });
      return;
    }
    const validation = validateCreateEvidenceRequest(body);
    if (!validation.ok) {
      await reply.code(400).send({ ok: false, errors: validation.errors });
      return;
    }
    try {
      const envelope = await createEvidence(options.pool, params.market, params.code, body as CreateEvidenceRequest, actor);
      if (!validateEvidenceWriteEnvelope(envelope).ok) {
        await reply.code(503).send({ ok: false, message: "Assembled research evidence write response failed contract validation before success." });
        return;
      }
      return envelope;
    } catch (error) {
      if (isResearchWriteConflict(error)) {
        await reply.code(409).send({ ok: false, message: error.message });
        return;
      }
      await reply.code(503).send({ ok: false, message: "research evidence write repository is unavailable" });
    }
  });
}

function isResearchWriteConflict(error: unknown): error is Error {
  return error instanceof IdempotencyConflictError
    || error instanceof DeepResearchGateError
    || error instanceof CandidateMembershipConflictError
    || error instanceof CandidateMembershipNotFoundError
    || error instanceof CandidateMembershipVersionConflictError;
}

function researchProfileFailClosedEnvelope(requestedSymbol: string, message: string) {
  const asOf = new Date().toISOString();
  return {
    schemaVersion: RESEARCH_PROFILE_SCHEMA_VERSION,
    asOf,
    requestedSymbol,
    metadata: makeFactMetadata({
      source: "research_profiles_evidence_suggestions",
      asOf,
      fetchedAt: null,
      freshness: "unavailable",
      provenance: "research_only",
      authority: "research_evidence",
      stale: false,
      missing: false,
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message: "Research profile is unavailable; no research evidence metadata is synthesized."
    }),
    data: null,
    message
  };
}
