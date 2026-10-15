import type { FastifyInstance } from "fastify";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import { validateAnnualConditionalDecisionState } from "../../../../packages/contracts/src/annualConditionalDecision.js";
import {
  type CreatePreTradeDecisionCheckRequest,
  validateCreatePreTradeDecisionCheckRequest,
  validatePreTradeDecisionCheckWriteEnvelope
} from "../../../../packages/contracts/src/decisionContext.js";
import {
  DECISION_REVIEW_SCHEMA_VERSION,
  type CreatePostDecisionReviewRequest,
  type DeleteDecisionCheckRequest,
  type DeletePostDecisionReviewRequest,
  validateCreatePostDecisionReviewRequest,
  validateDecisionReviewDeletionData,
  validateDeleteDecisionCheckRequest,
  validateDeletePostDecisionReviewRequest,
  validateDecisionReviewHistoryEnvelope,
  validatePostDecisionReviewWriteEnvelope
} from "../../../../packages/contracts/src/decisionReview.js";
import { createDecisionCheck } from "../research/decisionCheckWriteRepository.js";
import { readDecisionReviewHistory } from "../research/decisionReviewReadRepository.js";
import { createPostDecisionReview } from "../research/decisionReviewWriteRepository.js";
import {
  deleteDecisionCheck,
  deletePostDecisionReview,
  readDecisionCheckDeletion,
  readPostDecisionReviewDeletion
} from "../research/decisionReviewDeletionRepository.js";
import {
  ContextMismatchError,
  AnnualReviewLearningMismatchError,
  ConditionalDecisionMismatchError,
  DailyTrackingReviewMismatchError,
  DecisionSnapshotMismatchError,
  DeepResearchGateError,
  FixtureDecisionContextError,
  DecisionCheckNotFoundError,
  IdempotencyConflictError,
  PostDecisionPortfolioReviewMismatchError,
  PostDecisionReviewChronologyError,
  StockFactUnavailableError,
  SymbolMismatchError
} from "../research/domain.js";
import { authenticateReadOnly, authenticateWrite, derivePinganSnapshotAccountScope } from "./researchAuth.js";
import {
  canonicalHongKongSymbol,
  isCanonicalMembershipId,
  isSupportedHongKongSymbol,
  rejectClientControlledAuditFields
} from "./researchRouteValidation.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";
import { triggerFormalResearchBackup } from "./formalResearchBackup.js";

export async function registerDecisionReviewRoutes(app: FastifyInstance, options: MobileResearchRouteOptions): Promise<void> {
  app.post("/api/mobile/research/profiles/:market/:code/decision-checks", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "review_write");
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
    const validation = validateCreatePreTradeDecisionCheckRequest(body);
    if (!validation.ok) {
      await reply.code(400).send({ ok: false, errors: validation.errors });
      return;
    }
    const now = options.now?.() ?? new Date();
    try {
      const envelope = await createDecisionCheck(
        options.pool,
        params.market,
        params.code,
        body as CreatePreTradeDecisionCheckRequest,
        actor,
        options.quoteLiveMaxAgeSeconds,
        {
          accountScopeId: currentPortfolioAccountScope(actor, options),
          pinganCurrentMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300,
          quantEvidence: options.quantEvidence ?? null,
          sourceStore: options.researchDocument ? {
            repositoryRoot: options.researchDocument.repositoryRoot,
            rawStoreRoot: options.researchDocument.rawStoreRoot,
            availabilityCache: new Map()
          } : undefined,
          now
        }
      );
      const conditionalValidation = envelope.data.conditionalDecision === undefined
        ? { ok: true as const }
        : validateAnnualConditionalDecisionState(envelope.data.conditionalDecision);
      if (!validatePreTradeDecisionCheckWriteEnvelope(envelope).ok || !conditionalValidation.ok) {
        await reply.code(503).send({ ok: false, message: "Assembled decision-check write response failed contract validation before success." });
        return;
      }
      await triggerFormalResearchBackup(actor, "decision_check_created", envelope.data.id).catch((error) => { request.log.error(error, "formal backup trigger failed after decision check"); return false; });
      return envelope;
    } catch (error) {
      if (error instanceof IdempotencyConflictError || error instanceof ContextMismatchError || error instanceof DecisionSnapshotMismatchError || error instanceof ConditionalDecisionMismatchError || error instanceof DeepResearchGateError || error instanceof FixtureDecisionContextError || error instanceof StockFactUnavailableError) {
        await reply.code(409).send({ ok: false, message: error.message });
        return;
      }
      await reply.code(503).send({ ok: false, message: "decision-check write repository is unavailable" });
    }
  });

  app.get("/api/mobile/research/profiles/:market/:code/decision-reviews", async (request, reply) => {
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) {
      await reply.code(401).send({ ok: false, message: "read authorization required" });
      return;
    }
    const params = request.params as { market: string; code: string };
    if (!isSupportedHongKongSymbol(params.market, params.code)) {
      await reply.code(400).send({ ok: false, message: "only Hong Kong symbols such as HK.09926 are supported" });
      return;
    }
    try {
      const now = options.now?.() ?? new Date();
      const history = await readDecisionReviewHistory(options.pool, params.market, params.code, actor, {
        accountScopeId: currentPortfolioAccountScope(actor, options),
        pinganCurrentMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300,
        quoteLiveMaxAgeSeconds: options.quoteLiveMaxAgeSeconds,
        quantEvidence: options.quantEvidence ?? null,
        now
      });
      if (!validateDecisionReviewHistoryEnvelope(history).ok) {
        await reply.code(503).send(decisionReviewHistoryFailClosedEnvelope(
          canonicalHongKongSymbol(params.market, params.code),
          "Assembled decision review history failed contract validation before response."
        ));
        return;
      }
      return history;
    } catch {
      await reply.code(503).send(decisionReviewHistoryFailClosedEnvelope(
        canonicalHongKongSymbol(params.market, params.code),
        "decision review history repository is unavailable"
      ));
    }
  });

  app.get("/api/mobile/research/profiles/:market/:code/decision-checks/:checkId/deletion", async (request, reply) => {
    const actor = authenticateReadOnly(request.headers, options);
    const params = request.params as { market: string; code: string; checkId: string };
    if (!actor) return reply.code(401).send({ ok: false, message: "read authorization required" });
    if (!isSupportedHongKongSymbol(params.market, params.code) || !isCanonicalMembershipId(params.checkId)) {
      return reply.code(400).send({ ok: false, message: "canonical Hong Kong symbol and positive decision check id are required" });
    }
    try {
      const data = await readDecisionCheckDeletion(options.pool, params.market, params.code, params.checkId, actor);
      if (!data) return reply.code(404).send({ ok: false, message: "decision check deletion record was not found" });
      if (!validateDecisionReviewDeletionData(data).ok) return reply.code(503).send({ ok: false, message: "decision check deletion readback failed contract validation" });
      return data;
    } catch {
      return reply.code(503).send({ ok: false, message: "decision check deletion readback is unavailable" });
    }
  });

  app.post("/api/mobile/research/profiles/:market/:code/decision-checks/:checkId/deletion", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "review_write");
    const params = request.params as { market: string; code: string; checkId: string };
    if (!actor) return reply.code(401).send({ ok: false, message: "write authorization required" });
    if (actor.actorType !== "user") return reply.code(403).send({ ok: false, message: "an explicit user actor is required" });
    if (!isSupportedHongKongSymbol(params.market, params.code) || !isCanonicalMembershipId(params.checkId)) {
      return reply.code(400).send({ ok: false, message: "canonical Hong Kong symbol and positive decision check id are required" });
    }
    const body = request.body as object | null;
    const protectedFieldErrors = rejectClientControlledAuditFields(body);
    if (protectedFieldErrors.length) return reply.code(400).send({ ok: false, errors: protectedFieldErrors });
    const validation = validateDeleteDecisionCheckRequest(body);
    if (!validation.ok) return reply.code(400).send({ ok: false, errors: validation.errors });
    try {
      const envelope = await deleteDecisionCheck(options.pool, params.market, params.code, params.checkId, body as DeleteDecisionCheckRequest, actor, options.now?.() ?? new Date());
      if (!validateDecisionReviewDeletionData(envelope.data).ok) return reply.code(503).send({ ok: false, message: "decision check deletion failed contract validation" });
      return envelope;
    } catch (error) {
      if (error instanceof DecisionCheckNotFoundError) return reply.code(404).send({ ok: false, message: error.message });
      if (error instanceof IdempotencyConflictError) return reply.code(409).send({ ok: false, message: error.message });
      return reply.code(503).send({ ok: false, message: "decision check deletion is unavailable" });
    }
  });

  app.get("/api/mobile/research/profiles/:market/:code/decision-checks/:checkId/reviews/:reviewId/deletion", async (request, reply) => {
    const actor = authenticateReadOnly(request.headers, options);
    const params = request.params as { market: string; code: string; checkId: string; reviewId: string };
    if (!actor) return reply.code(401).send({ ok: false, message: "read authorization required" });
    if (!isSupportedHongKongSymbol(params.market, params.code) || !isCanonicalMembershipId(params.checkId) || !isCanonicalMembershipId(params.reviewId)) {
      return reply.code(400).send({ ok: false, message: "canonical Hong Kong symbol and positive check/review ids are required" });
    }
    try {
      const data = await readPostDecisionReviewDeletion(options.pool, params.market, params.code, params.checkId, params.reviewId, actor);
      if (!data) return reply.code(404).send({ ok: false, message: "post-decision review deletion record was not found" });
      if (!validateDecisionReviewDeletionData(data).ok) return reply.code(503).send({ ok: false, message: "post-decision review deletion readback failed contract validation" });
      return data;
    } catch {
      return reply.code(503).send({ ok: false, message: "post-decision review deletion readback is unavailable" });
    }
  });

  app.post("/api/mobile/research/profiles/:market/:code/decision-checks/:checkId/reviews/:reviewId/deletion", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "review_write");
    const params = request.params as { market: string; code: string; checkId: string; reviewId: string };
    if (!actor) return reply.code(401).send({ ok: false, message: "write authorization required" });
    if (actor.actorType !== "user") return reply.code(403).send({ ok: false, message: "an explicit user actor is required" });
    if (!isSupportedHongKongSymbol(params.market, params.code) || !isCanonicalMembershipId(params.checkId) || !isCanonicalMembershipId(params.reviewId)) {
      return reply.code(400).send({ ok: false, message: "canonical Hong Kong symbol and positive check/review ids are required" });
    }
    const body = request.body as object | null;
    const protectedFieldErrors = rejectClientControlledAuditFields(body);
    if (protectedFieldErrors.length) return reply.code(400).send({ ok: false, errors: protectedFieldErrors });
    const validation = validateDeletePostDecisionReviewRequest(body);
    if (!validation.ok) return reply.code(400).send({ ok: false, errors: validation.errors });
    try {
      const envelope = await deletePostDecisionReview(options.pool, params.market, params.code, params.checkId, params.reviewId, body as DeletePostDecisionReviewRequest, actor, options.now?.() ?? new Date());
      if (!validateDecisionReviewDeletionData(envelope.data).ok) return reply.code(503).send({ ok: false, message: "post-decision review deletion failed contract validation" });
      return envelope;
    } catch (error) {
      if (error instanceof DecisionCheckNotFoundError) return reply.code(404).send({ ok: false, message: error.message });
      if (error instanceof IdempotencyConflictError) return reply.code(409).send({ ok: false, message: error.message });
      return reply.code(503).send({ ok: false, message: "post-decision review deletion is unavailable" });
    }
  });

  app.route({
    method: "POST",
    url: "/api/mobile/research/profiles/:market/:code/decision-checks/:checkId/reviews",
    handler: async (request, reply) => {
      const actor = authenticateWrite(request.headers, options, "review_write");
      if (!actor) {
        await reply.code(401).send({ ok: false, message: "write authorization required" });
        return;
      }
      if (actor.actorType !== "user" && options.allowLegacyWriteTokenForScopedLanes !== true) {
        await reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required to record a post-decision review" });
        return;
      }
      const params = request.params as { market: string; code: string; checkId: string };
      if (!isSupportedHongKongSymbol(params.market, params.code)) {
        await reply.code(400).send({ ok: false, message: "only Hong Kong symbols such as HK.09926 are supported" });
        return;
      }
      if (!isCanonicalMembershipId(params.checkId)) {
        await reply.code(400).send({ ok: false, message: "decision check id must be a positive integer" });
        return;
      }
      const body = request.body as object | null;
      const protectedFieldErrors = rejectClientControlledAuditFields(body);
      if (protectedFieldErrors.length > 0) {
        await reply.code(400).send({ ok: false, errors: protectedFieldErrors });
        return;
      }
      const validation = validateCreatePostDecisionReviewRequest(body);
      if (!validation.ok) {
        await reply.code(400).send({ ok: false, errors: validation.errors });
        return;
      }
      const now = options.now?.() ?? new Date();
      try {
        const envelope = await createPostDecisionReview(
          options.pool,
          params.market,
          params.code,
          params.checkId,
          body as CreatePostDecisionReviewRequest,
          actor,
          {
            accountScopeId: currentPortfolioAccountScope(actor, options),
            pinganCurrentMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300,
            quoteLiveMaxAgeSeconds: options.quoteLiveMaxAgeSeconds,
            quantEvidence: options.quantEvidence ?? null,
            now
          }
        );
        if (!validatePostDecisionReviewWriteEnvelope(envelope).ok) {
          await reply.code(503).send({ ok: false, message: "Assembled post-decision review write response failed contract validation before success." });
          return;
        }
        await triggerFormalResearchBackup(actor, "post_decision_review_created", envelope.data.id).catch((error) => { request.log.error(error, "formal backup trigger failed after decision review"); return false; });
        return envelope;
      } catch (error) {
        if (error instanceof DecisionCheckNotFoundError) {
          await reply.code(404).send({ ok: false, message: error.message });
          return;
        }
        if (error instanceof IdempotencyConflictError || error instanceof SymbolMismatchError || error instanceof PostDecisionPortfolioReviewMismatchError || error instanceof AnnualReviewLearningMismatchError || error instanceof DailyTrackingReviewMismatchError || error instanceof PostDecisionReviewChronologyError) {
          await reply.code(409).send({ ok: false, message: error.message });
          return;
        }
        await reply.code(503).send({ ok: false, message: "post-decision review write repository is unavailable" });
      }
    }
  });
}

function currentPortfolioAccountScope(
  actor: Parameters<typeof derivePinganSnapshotAccountScope>[0],
  options: MobileResearchRouteOptions
): string | null {
  return options.pinganCurrentPortfolioEnabled
    ? derivePinganSnapshotAccountScope(actor, options)
    : null;
}

function decisionReviewHistoryFailClosedEnvelope(requestedSymbol: string, message: string) {
  return {
    schemaVersion: DECISION_REVIEW_SCHEMA_VERSION,
    requestedSymbol,
    metadata: makeFactMetadata({
      source: "decision_review_history:unavailable",
      asOf: null,
      fetchedAt: null,
      freshness: "unavailable",
      provenance: "unavailable",
      authority: "unavailable",
      stale: false,
      missing: false,
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message: "Decision review history metadata is unavailable; no stale review facts are exposed."
    }),
    checks: [],
    advisoryOnly: true,
    safety: {
      createsOrder: false,
      createsTrade: false,
      mutatesCash: false,
      writesFee: false,
      mutatesPosition: false,
      callsBroker: false
    },
    message
  };
}
