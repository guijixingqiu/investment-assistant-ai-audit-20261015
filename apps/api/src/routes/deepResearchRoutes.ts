import { validateFreezeLimitedResearchRequest, type FreezeLimitedResearchRequest } from "../../../../packages/contracts/src/limitedResearch.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  INDEPENDENT_WEINSTEIN_TECHNICAL_SOURCE_TYPE,
  INDEPENDENT_WEINSTEIN_TECHNICAL_VERSION,
  type CreateIndependentWeinsteinTechnicalConfirmationRequest,
  type IndependentWeinsteinTechnicalConfirmationContent,
  type ResearchMaterialData,
  type CreateDeepResearchReportRequest,
  type CreateResearchMaterialRequest,
  type DeleteDeepResearchReportRequest,
  type DeleteResearchMaterialRequest,
  type DecideDeepResearchReportRequest,
  type FreezeEvidencePackRequest,
  OWNER_PROVIDED_PDF_SOURCE_TYPE,
  validateCreateDeepResearchReportRequest,
  validateCreateIndependentWeinsteinTechnicalConfirmationRequest,
  validateCreateResearchMaterialRequest,
  validateDeleteDeepResearchReportRequest,
  validateDeleteResearchMaterialRequest,
  validateDecideDeepResearchReportRequest,
  validateDeepResearchDecisionData,
  validateDeepResearchReportData,
  validateDeepResearchReportDeletionData,
  validateDeepResearchWorkspaceEnvelope,
  validateFreezeEvidencePackRequest,
  validateResearchEvidencePackData,
  validateResearchMaterialData,
  validateResearchMaterialDeletionData,
  validIndependentWeinsteinTechnicalConfirmationContent
} from "../../../../packages/contracts/src/deepResearch.js";
import {
  type CreateResearchEventRequest,
  validateCreateResearchEventRequest,
  validateResearchAnnouncementEventData
} from "../../../../packages/contracts/src/researchEvent.js";
import {
  type CreateGeelySalesMonitorRequest,
  validateCreateGeelySalesMonitorRequest,
  validateGeelySalesMonitorData
} from "../../../../packages/contracts/src/geelySalesMonitor.js";
import {
  type CreateGclPvPriceMonitorRequest,
  validateCreateGclPvPriceMonitorRequest,
  validateGclPvPriceMonitorData
} from "../../../../packages/contracts/src/gclPvPriceMonitor.js";
import { validateTodayResearchEnvelope } from "../../../../packages/contracts/src/todayResearch.js";
import { frozenWeinsteinEvidenceBinding } from "../../../../packages/contracts/src/weinsteinTechnicalAnalysis.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import { currentHongKongDate } from "../market/dailyBarsRepository.js";
import { getWeinsteinTechnicalAnalysis } from "../market/weinsteinTechnicalAnalysis.js";
import {
  createResearchMaterial,
  deleteResearchMaterial,
  readResearchMaterialDeletion
} from "../research/deepResearchMaterialRepository.js";
import { freezeResearchEvidencePack } from "../research/deepResearchPackRepository.js";
import { readDeepResearchWorkspace, readHistoricalFutuFinancialMaterial, unavailableWorkspace } from "../research/deepResearchReadRepository.js";
import {
  createDeepResearchReport,
  decideDeepResearchReport,
  deleteDeepResearchReport,
  readDeepResearchReportDeletion
} from "../research/deepResearchReportRepository.js";
import { createResearchEvent } from "../research/researchEventRepository.js";
import { createGeelySalesMonitor } from "../research/geelySalesMonitorRepository.js";
import { createGclPvPriceMonitor } from "../research/gclPvPriceMonitorRepository.js";
import {
  readTodayResearchEnvelope,
  todayResearchFailClosedEnvelope
} from "../research/todayResearchService.js";
import { authenticateReadOnly, authenticateWrite, derivePinganSnapshotAccountScope } from "./researchAuth.js";
import {
  isCanonicalMembershipId,
  isSupportedHongKongSymbol,
  rejectClientControlledAuditFields
} from "./researchRouteValidation.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";
import {
  handleAbsorbDeepResearchTask,
  handleCancelDeepResearchTask,
  handleEnqueueDeepResearchTask,
  handleReadCurrentDeepResearchTask,
  handleReadDeepResearchTask,
  handleRetryDeepResearchTask
} from "./deepResearchTaskRouteHandlers.js";
import { researchWriteFailure } from "./researchRouteSupport.js";
import { findAuditByIdempotencyKey } from "../research/writePersistence.js";
import type { AuthenticatedResearchActor } from "../research/domain.js";
import { triggerFormalResearchBackup } from "./formalResearchBackup.js";
import { registerResearchEvidenceQuestionRoute } from "./researchEvidenceQuestionRoute.js";

export async function registerDeepResearchRoutes(app: FastifyInstance, options: MobileResearchRouteOptions): Promise<void> {
  app.get("/api/mobile/research/candidate-memberships/:id/materials/:materialId/saved-opend-material", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send({ ok: false, message: "research-read authorization required" });
    const { id, materialId } = request.params as { id: string; materialId: string };
    if (!isCanonicalMembershipId(id) || !isCanonicalMembershipId(materialId))
      return reply.code(400).send({ ok: false, message: "membership and material ids must be positive integers" });
    try {
      const material = await readHistoricalFutuFinancialMaterial(options.pool, id, materialId, actor, options.now?.());
      if (!material) return reply.code(404).send({ ok: false, message: "saved OpenD material is unavailable" });
      return material;
    } catch (error) {
      return researchWriteFailure(reply, error, "saved OpenD material readback is unavailable");
    }
  });

  app.post("/api/mobile/research/profiles/:market/:code/materials", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    const params = request.params as { market: string; code: string };
    if (!isSupportedHongKongSymbol(params.market, params.code)) return reply.code(400).send({ ok: false, message: "only canonical Hong Kong symbols are supported" });
    const body = request.body as unknown;
    if (typeof body === "object" && body !== null && "kind" in body
      && body.kind === INDEPENDENT_WEINSTEIN_TECHNICAL_VERSION) {
      return createIndependentWeinsteinTechnicalMaterial(options, params, body, actor, reply);
    }
    const validation = validateCreateResearchMaterialRequest(body);
    const auditErrors = rejectClientControlledAuditFields(body);
    if (!validation.ok || auditErrors.length) return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
    if ((body as CreateResearchMaterialRequest).sourceType === OWNER_PROVIDED_PDF_SOURCE_TYPE) {
      return reply.code(400).send({ ok: false, message: "owner_provided_pdf is reserved for the dedicated document-confirm path" });
    }
    try {
      const envelope = await createResearchMaterial(options.pool, params.market, params.code, body as CreateResearchMaterialRequest, actor, options.now?.());
      if (!validateResearchMaterialData(envelope.data).ok) return reply.code(503).send({ ok: false, message: "material write response failed contract validation" });
      return envelope;
    } catch (error) {
      return researchWriteFailure(reply, error, "research material repository is unavailable");
    }
  });

  app.get("/api/mobile/research/candidate-memberships/:id/materials/:materialId/deletion", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send({ ok: false, message: "research-read authorization required" });
    const params = request.params as { id: string; materialId: string };
    if (!isCanonicalMembershipId(params.id) || !isCanonicalMembershipId(params.materialId)) {
      return reply.code(400).send({ ok: false, message: "membership and material ids must be positive integers" });
    }
    try {
      const data = await readResearchMaterialDeletion(options.pool, params.id, params.materialId, actor);
      if (!data) return reply.code(404).send({ ok: false, message: "research material deletion record was not found" });
      if (!validateResearchMaterialDeletionData(data).ok) {
        return reply.code(503).send({ ok: false, message: "material deletion readback failed contract validation" });
      }
      return data;
    } catch (error) {
      return researchWriteFailure(reply, error, "research material deletion readback is unavailable");
    }
  });

  app.post("/api/mobile/research/candidate-memberships/:id/materials/:materialId/deletion", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    if (actor.actorType !== "user") {
      return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required to delete research material body" });
    }
    const params = request.params as { id: string; materialId: string };
    if (!isCanonicalMembershipId(params.id) || !isCanonicalMembershipId(params.materialId)) {
      return reply.code(400).send({ ok: false, message: "membership and material ids must be positive integers" });
    }
    const body = request.body as unknown;
    const validation = validateDeleteResearchMaterialRequest(body);
    const auditErrors = rejectClientControlledAuditFields(body);
    if (!validation.ok || auditErrors.length) {
      return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
    }
    try {
      const envelope = await deleteResearchMaterial(
        options.pool,
        params.id,
        params.materialId,
        body as DeleteResearchMaterialRequest,
        actor,
        options.now?.()
      );
      if (!validateResearchMaterialDeletionData(envelope.data).ok) {
        return reply.code(503).send({ ok: false, message: "material deletion response failed contract validation" });
      }
      return envelope;
    } catch (error) {
      return researchWriteFailure(reply, error, "research material deletion repository is unavailable");
    }
  });

  app.post("/api/mobile/research/candidate-memberships/:id/evidence-packs", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    if (actor.actorType !== "user") {
      return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required to freeze research evidence" });
    }
    const id = (request.params as { id: string }).id;
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    const body = request.body as unknown;
    const limited = typeof body === "object" && body !== null && "researchMode" in body;
    const validation = limited ? validateFreezeLimitedResearchRequest(body) : validateFreezeEvidencePackRequest(body);
    const auditErrors = rejectClientControlledAuditFields(body);
    if (!validation.ok || auditErrors.length) return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
    const sourceStore = options.researchDocument ? {repositoryRoot:options.researchDocument.repositoryRoot,
      rawStoreRoot:options.researchDocument.rawStoreRoot,availabilityCache:new Map()} : undefined;
    try {
      if (limited) {
        const envelope = await freezeResearchEvidencePack(options.pool, id, body as FreezeLimitedResearchRequest, actor, null, null, options.now?.(), true, sourceStore);
        if (!validateResearchEvidencePackData(envelope.data).ok) return reply.code(503).send({ ok: false, message: "limited evidence-pack response failed validation" });
        return envelope;
      }
      const freezeRequest = body as FreezeEvidencePackRequest;
      const [market, code] = freezeRequest.expectedWeinstein.symbol.split(".");
      const now = options.now?.() ?? new Date();
      const analysis = await getWeinsteinTechnicalAnalysis(
        options.weinsteinProvider ?? null, market!, code!, freezeRequest.expectedWeinstein.analysisAsOf,
        currentHongKongDate(now)
      );
      const authoritativeWeinstein = frozenWeinsteinEvidenceBinding(analysis);
      if (!authoritativeWeinstein) {
        return reply.code(409).send({ ok: false, message: "current exact Weinstein evidence is unavailable; rerun the Research analysis before freezing" });
      }
      const envelope = await freezeResearchEvidencePack(
        options.pool, id, freezeRequest, actor, authoritativeWeinstein,
        options.quantEvidence ?? null, now, true, sourceStore
      );
      if (!validateResearchEvidencePackData(envelope.data).ok) return reply.code(503).send({ ok: false, message: "evidence-pack response failed contract validation" });
      return envelope;
    } catch (error) {
      return researchWriteFailure(reply, error, "evidence-pack repository is unavailable");
    }
  });

  app.post("/api/mobile/research/candidate-memberships/:id/research-events", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    const id = (request.params as { id: string }).id;
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    const body = request.body as unknown;
    const validation = validateCreateResearchEventRequest(body);
    const auditErrors = rejectClientControlledAuditFields(body);
    if (!validation.ok || auditErrors.length) return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
    if ((body as CreateResearchEventRequest).coverageScope === "current_holding" && actor.actorType !== "user") {
      return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required to record current-holding research" });
    }
    try {
      const eventRequest = body as CreateResearchEventRequest;
      const envelope = await createResearchEvent(options.pool, id, eventRequest, actor, {
        now: options.now?.(),
        pinganCurrentPortfolioEnabled: options.pinganCurrentPortfolioEnabled,
        pinganCurrentMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300,
        accountScopeId: eventRequest.coverageScope === "current_holding"
          ? derivePinganSnapshotAccountScope(actor, options)
          : null
      });
      if (!validateResearchAnnouncementEventData(envelope.data).ok) return reply.code(503).send({ ok: false, message: "research-event response failed contract validation" });
      return envelope;
    } catch (error) {
      return researchWriteFailure(reply, error, "research-event repository is unavailable");
    }
  });

  app.post("/api/mobile/research/candidate-memberships/:id/geely-sales-monitors", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    const id = (request.params as { id: string }).id;
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    const body = request.body as unknown;
    const validation = validateCreateGeelySalesMonitorRequest(body);
    const auditErrors = rejectClientControlledAuditFields(body);
    if (!validation.ok || auditErrors.length) return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
    try {
      const envelope = await createGeelySalesMonitor(
        options.pool,
        id,
        body as CreateGeelySalesMonitorRequest,
        actor,
        {
          accountScopeId: derivePinganSnapshotAccountScope(actor, options),
          currentPortfolioEnabled: options.pinganCurrentPortfolioEnabled,
          currentPortfolioMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300
        },
        options.now?.()
      );
      const responseValidation = validateGeelySalesMonitorData(envelope.data);
      if (!responseValidation.ok) return reply.code(503).send({
        ok: false,
        message: "Geely sales monitor response failed contract validation",
        failures: responseValidation.errors
      });
      return envelope;
    } catch (error) {
      return researchWriteFailure(reply, error, "Geely sales monitor repository is unavailable");
    }
  });

  app.post("/api/mobile/research/candidate-memberships/:id/gcl-pv-price-monitors", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    const id = (request.params as { id: string }).id;
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    const body = request.body as unknown;
    const validation = validateCreateGclPvPriceMonitorRequest(body);
    const auditErrors = rejectClientControlledAuditFields(body);
    if (!validation.ok || auditErrors.length) return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
    try {
      const envelope = await createGclPvPriceMonitor(
        options.pool,
        id,
        body as CreateGclPvPriceMonitorRequest,
        actor,
        {
          accountScopeId: derivePinganSnapshotAccountScope(actor, options),
          currentPortfolioEnabled: options.pinganCurrentPortfolioEnabled,
          currentPortfolioMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300
        },
        options.now?.()
      );
      const responseValidation = validateGclPvPriceMonitorData(envelope.data);
      if (!responseValidation.ok) return reply.code(503).send({
        ok: false,
        message: "GCL photovoltaic price monitor response failed contract validation",
        failures: responseValidation.errors
      });
      return envelope;
    } catch (error) {
      return researchWriteFailure(reply, error, "GCL photovoltaic price monitor repository is unavailable");
    }
  });

  app.post("/api/mobile/research/candidate-memberships/:id/deep-research-reports", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    const id = (request.params as { id: string }).id;
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    const body = request.body as unknown;
    const validation = validateCreateDeepResearchReportRequest(body);
    const auditErrors = rejectClientControlledAuditFields(body);
    if (!validation.ok || auditErrors.length) return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
    try {
      const envelope = await createDeepResearchReport(options.pool, id, body as CreateDeepResearchReportRequest, actor, options.now?.(), options.quantEvidence,
        options.researchDocument ? {repositoryRoot:options.researchDocument.repositoryRoot,rawStoreRoot:options.researchDocument.rawStoreRoot,availabilityCache:new Map()} : undefined);
      if (!validateDeepResearchReportData(envelope.data).ok) return reply.code(503).send({ ok: false, message: "deep-research response failed contract validation" });
      return envelope;
    } catch (error) {
      return researchWriteFailure(reply, error, "deep-research repository is unavailable");
    }
  });

  app.post("/api/mobile/research/candidate-memberships/:id/deep-research-tasks", (request, reply) => handleEnqueueDeepResearchTask(options, request, reply));

  app.get("/api/mobile/research/candidate-memberships/:id/deep-research-tasks/current", (request, reply) => handleReadCurrentDeepResearchTask(options, request, reply));

  app.get("/api/mobile/research/candidate-memberships/:id/deep-research-tasks/:taskId", (request, reply) => handleReadDeepResearchTask(options, request, reply));

  app.post("/api/mobile/research/candidate-memberships/:id/deep-research-tasks/:taskId/retry", (request, reply) => handleRetryDeepResearchTask(options, request, reply));

  app.post("/api/mobile/research/candidate-memberships/:id/deep-research-tasks/:taskId/absorb", (request, reply) => handleAbsorbDeepResearchTask(options, request, reply));

  app.post("/api/mobile/research/candidate-memberships/:id/deep-research-tasks/:taskId/cancel", (request, reply) => handleCancelDeepResearchTask(options, request, reply));

  app.get("/api/mobile/research/candidate-memberships/:id/deep-research-reports/:reportId/deletion", async (request, reply) => {
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send({ ok: false, message: "read authorization required" });
    const params = request.params as { id: string; reportId: string };
    if (!isCanonicalMembershipId(params.id) || !isCanonicalMembershipId(params.reportId)) {
      return reply.code(400).send({ ok: false, message: "membership and report ids must be positive integers" });
    }
    try {
      const data = await readDeepResearchReportDeletion(options.pool, params.id, params.reportId, actor);
      if (!data) return reply.code(404).send({ ok: false, message: "deep research report deletion record was not found" });
      if (!validateDeepResearchReportDeletionData(data).ok) return reply.code(503).send({ ok: false, message: "report deletion readback failed contract validation" });
      return data;
    } catch (error) {
      return researchWriteFailure(reply, error, "deep research report deletion readback is unavailable");
    }
  });

  app.post("/api/mobile/research/candidate-memberships/:id/deep-research-reports/:reportId/deletion", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    const params = request.params as { id: string; reportId: string };
    if (!isCanonicalMembershipId(params.id) || !isCanonicalMembershipId(params.reportId)) {
      return reply.code(400).send({ ok: false, message: "membership and report ids must be positive integers" });
    }
    const body = request.body as unknown;
    const validation = validateDeleteDeepResearchReportRequest(body);
    const auditErrors = rejectClientControlledAuditFields(body);
    if (!validation.ok || auditErrors.length) return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
    try {
      const envelope = await deleteDeepResearchReport(
        options.pool, params.id, params.reportId, body as DeleteDeepResearchReportRequest, actor, options.now?.()
      );
      if (!validateDeepResearchReportDeletionData(envelope.data).ok) return reply.code(503).send({ ok: false, message: "report deletion response failed contract validation" });
      return envelope;
    } catch (error) {
      return researchWriteFailure(reply, error, "deep research report deletion is unavailable");
    }
  });

  app.post("/api/mobile/research/candidate-memberships/:id/deep-research-reports/:reportId/decisions", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    if (actor.actorType !== "user") return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required for the final research decision" });
    const params = request.params as { id: string; reportId: string };
    if (!isCanonicalMembershipId(params.id) || !isCanonicalMembershipId(params.reportId)) return reply.code(400).send({ ok: false, message: "membership and report ids must be positive integers" });
    const body = request.body as unknown;
    const validation = validateDecideDeepResearchReportRequest(body);
    const auditErrors = rejectClientControlledAuditFields(body);
    if (!validation.ok || auditErrors.length) return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
    try {
      const envelope = await decideDeepResearchReport(options.pool, params.id, params.reportId, body as DecideDeepResearchReportRequest, actor, options.now?.(), options.quantEvidence,
        options.researchDocument ? {repositoryRoot:options.researchDocument.repositoryRoot,rawStoreRoot:options.researchDocument.rawStoreRoot,availabilityCache:new Map()} : undefined);
      if (!validateDeepResearchDecisionData(envelope.data).ok) return reply.code(503).send({ ok: false, message: "deep-research decision response failed contract validation" });
      if (envelope.data.decision === "confirmed") await triggerFormalResearchBackup(actor, "report_confirmed", envelope.data.id).catch((error) => { request.log.error(error, "formal backup trigger failed after report confirmation"); return false; });
      return envelope;
    } catch (error) {
      return researchWriteFailure(reply, error, "deep-research decision repository is unavailable");
    }
  });

  registerResearchEvidenceQuestionRoute(app, options);
  app.get("/api/mobile/research/candidate-memberships/:id/deep-research", async (request, reply) => {
    const now = options.now?.() ?? new Date();
    const id = (request.params as { id: string }).id;
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send(unavailableWorkspace(now.toISOString(), id, "unauthorized", "unavailable", "read authorization required"));
    if (!isCanonicalMembershipId(id)) return reply.code(400).send(unavailableWorkspace(now.toISOString(), id, actor.actorId, "unavailable", "candidate membership id must be a positive integer"));
    try {
      const envelope = await readDeepResearchWorkspace(options.pool, id, actor, now, {
        accountScopeId: derivePinganSnapshotAccountScope(actor, options),
        currentPortfolioEnabled: options.pinganCurrentPortfolioEnabled,
        currentPortfolioMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300,
        quantEvidence: options.quantEvidence,
        sourceStore: options.researchDocument ? {repositoryRoot:options.researchDocument.repositoryRoot,
          rawStoreRoot:options.researchDocument.rawStoreRoot,availabilityCache:new Map()} : undefined
      });
      if (!validateDeepResearchWorkspaceEnvelope(envelope).ok) return reply.code(503).send(unavailableWorkspace(now.toISOString(), id, actor.actorId, "unavailable", "deep-research workspace failed contract validation"));
      if (envelope.status === "not_found") return reply.code(404).send(envelope);
      return envelope;
    } catch {
      return reply.code(503).send(unavailableWorkspace(now.toISOString(), id, actor.actorId, "unavailable", "deep-research workspace is unavailable"));
    }
  });

  app.get("/api/mobile/research/candidate-memberships/:id/today", async (request, reply) => {
    const now = options.now?.() ?? new Date();
    const id = (request.params as { id: string }).id;
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send(todayResearchFailClosedEnvelope(now, id, "unauthorized", "unauthorized", "read authorization required"));
    if (!isCanonicalMembershipId(id)) return reply.code(400).send(todayResearchFailClosedEnvelope(now, id, actor.actorId, "malformed", "candidate membership id must be a positive integer"));
    try {
      const envelope = await readTodayResearchEnvelope(options.pool, id, actor, {
        accountScopeId: derivePinganSnapshotAccountScope(actor, options),
        currentPortfolioEnabled: options.pinganCurrentPortfolioEnabled,
        currentPortfolioMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300,
        quantEvidence: options.quantEvidence,
        sourceStore:options.researchDocument?{repositoryRoot:options.researchDocument.repositoryRoot,
          rawStoreRoot:options.researchDocument.rawStoreRoot,availabilityCache:new Map()}:undefined
      }, now);
      if (!validateTodayResearchEnvelope(envelope).ok) {
        return reply.code(503).send(todayResearchFailClosedEnvelope(now, id, actor.actorId, "unavailable", "Today response failed contract validation"));
      }
      const statusCode = envelope.status === "not_found" ? 404
        : envelope.status === "conflict" ? 409
          : envelope.status === "stale" || envelope.status === "unavailable" ? 503 : 200;
      return reply.code(statusCode).send(envelope);
    } catch {
      return reply.code(503).send(todayResearchFailClosedEnvelope(now, id, actor.actorId, "unavailable", "Today research read model is unavailable"));
    }
  });
}

async function createIndependentWeinsteinTechnicalMaterial(
  options: MobileResearchRouteOptions, params: { market: string; code: string }, value: unknown,
  actor: AuthenticatedResearchActor, reply: FastifyReply
) {
  if (actor.actorType !== "user")
    return reply.code(403).send({ ok: false, message: "explicit Owner authorization is required for technical confirmation" });
  const validation = validateCreateIndependentWeinsteinTechnicalConfirmationRequest(value);
  const auditErrors = rejectClientControlledAuditFields(value);
  if (!validation.ok || auditErrors.length)
    return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
  const request = value as CreateIndependentWeinsteinTechnicalConfirmationRequest;
  const symbol = `${params.market}.${params.code}`;
  if (request.expectedWeinstein.symbol !== symbol)
    return reply.code(400).send({ ok: false, message: "technical confirmation symbol must match the research profile" });
  try {
    const replay = await findAuditByIdempotencyKey<ResearchMaterialData>(options.pool,
      request.idempotencyKey, "research_material_created");
    if (replay) return matchingIndependentTechnicalReplay(replay, request, actor, symbol)
      ? reply.send(replay.envelope)
      : reply.code(409).send({ ok: false, message: "idempotency key belongs to a different technical confirmation" });
    const now = options.now?.() ?? new Date();
    if (Date.parse(request.confirmedAt) > now.getTime()
      || currentHongKongDate(new Date(request.confirmedAt)) < request.expectedWeinstein.analysisAsOf)
      return reply.code(400).send({ ok: false, message: "Owner confirmation time must follow the selected current analysis" });
    const analysis = await getWeinsteinTechnicalAnalysis(options.weinsteinProvider ?? null,
      params.market, params.code, request.expectedWeinstein.analysisAsOf, currentHongKongDate(now));
    const binding = frozenWeinsteinEvidenceBinding(analysis);
    if (!binding || canonicalJson(binding) !== canonicalJson(request.expectedWeinstein))
      return reply.code(409).send({ ok: false, message: "current exact Weinstein analysis changed; refresh before confirming" });
    const content: IndependentWeinsteinTechnicalConfirmationContent = {
      schemaVersion: INDEPENDENT_WEINSTEIN_TECHNICAL_VERSION,
      actor: { actorType: "user", actorId: actor.actorId },
      membership: { id: request.membershipId, version: request.membershipVersion, symbol },
      machine: analysis, ownerWeinsteinZones: request.ownerWeinsteinZones,
      ownerConfirmed: true, confirmedAt: request.confirmedAt
    };
    if (!validIndependentWeinsteinTechnicalConfirmationContent(content))
      return reply.code(503).send({ ok: false, message: "technical confirmation content failed validation" });
    const materialRequest: CreateResearchMaterialRequest = {
      membershipId: request.membershipId, membershipVersion: request.membershipVersion,
      title: `Weinstein 技术判断 · ${symbol} · ${analysis.analysisAsOf} · Owner v${request.ownerWeinsteinZones.version}`,
      contentText: JSON.stringify(content), sourceType: INDEPENDENT_WEINSTEIN_TECHNICAL_SOURCE_TYPE,
      sourceUrl: null, publishedAt: request.confirmedAt,
      claimType: "model_inference", verificationStatus: "unverified", rightsStatus: "user_provided",
      sourceVersion: `weinstein:${binding.resultHash}:owner-v${request.ownerWeinsteinZones.version}`,
      validUntil: new Date(Date.parse(request.confirmedAt) + 7 * 86_400_000).toISOString(),
      summary: `Owner 确认的独立技术判断；机器评分与否决保持原样。${analysis.summary}`.slice(0, 4000),
      variableName: null, stance: "neutral", reliability: null, materiality: null, isRead: true,
      idempotencyKey: request.idempotencyKey
    };
    if (!validateCreateResearchMaterialRequest(materialRequest).ok)
      return reply.code(503).send({ ok: false, message: "technical snapshot exceeds the existing material contract" });
    const envelope = await createResearchMaterial(options.pool, params.market, params.code,
      materialRequest, actor, now);
    if (!validateResearchMaterialData(envelope.data).ok)
      return reply.code(503).send({ ok: false, message: "technical material write response failed validation" });
    return reply.send(envelope);
  } catch (error) {
    try {
      const committed = await findAuditByIdempotencyKey<ResearchMaterialData>(options.pool,
        request.idempotencyKey, "research_material_created");
      if (committed && matchingIndependentTechnicalReplay(committed, request, actor, symbol))
        return reply.send(committed.envelope);
    } catch { /* Keep the original failure when replay status cannot be read. */ }
    return researchWriteFailure(reply, error, "independent technical material could not be saved");
  }
}

function matchingIndependentTechnicalReplay(
  replay: Awaited<ReturnType<typeof findAuditByIdempotencyKey<ResearchMaterialData>>>,
  request: CreateIndependentWeinsteinTechnicalConfirmationRequest,
  actor: AuthenticatedResearchActor, symbol: string
): boolean {
  if (!replay || replay.envelope.source.actorType !== "user"
    || replay.envelope.source.actorId !== actor.actorId
    || replay.candidateMembershipId !== request.membershipId
    || replay.candidateMembershipVersion !== request.membershipVersion
    || replay.stock.symbol !== symbol
    || replay.envelope.data.sourceType !== INDEPENDENT_WEINSTEIN_TECHNICAL_SOURCE_TYPE
    || !validateResearchMaterialData(replay.envelope.data).ok) return false;
  try {
    const content: unknown = JSON.parse(replay.envelope.data.contentText);
    if (!validIndependentWeinsteinTechnicalConfirmationContent(content)) return false;
    const binding = frozenWeinsteinEvidenceBinding(content.machine);
    return content.actor.actorId === actor.actorId
      && content.membership.id === request.membershipId
      && content.membership.version === request.membershipVersion
      && content.membership.symbol === symbol
      && content.confirmedAt === request.confirmedAt
      && canonicalJson(content.ownerWeinsteinZones) === canonicalJson(request.ownerWeinsteinZones)
      && canonicalJson(binding) === canonicalJson(request.expectedWeinstein);
  } catch {
    return false;
  }
}
