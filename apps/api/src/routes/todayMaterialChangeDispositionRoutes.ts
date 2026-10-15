import type { FastifyInstance, FastifyReply } from "fastify";
import {
  validateTodayActionInboxEnvelope,
  validateTodayMaterialChangeDispositionRequest,
  validateTodayMaterialChangeDispositionWrite,
  type TodayMaterialChangeDispositionRequest
} from "../../../../packages/contracts/src/todayActionInbox.js";
import {
  CandidateMembershipConflictError,
  CandidateMembershipNotFoundError,
  CandidateMembershipVersionConflictError,
  IdempotencyConflictError
} from "../research/domain.js";
import { readTodayActionInbox } from "../research/todayActionInboxService.js";
import { writeTodayMaterialChangeDisposition } from "../research/todayMaterialChangeDispositionRepository.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";
import { authenticateWrite, derivePinganSnapshotAccountScope } from "./researchAuth.js";
import { rejectClientControlledAuditFields } from "./researchRouteValidation.js";

export async function registerTodayMaterialChangeDispositionRoute(
  app: FastifyInstance,
  options: MobileResearchRouteOptions
): Promise<void> {
  app.post("/api/mobile/research/today/inbox/material-dispositions", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    if (actor.actorType !== "user") return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required" });
    const body = request.body as unknown;
    const now = options.now?.() ?? new Date();
    const validation = validateTodayMaterialChangeDispositionRequest(body, now);
    const auditErrors = rejectClientControlledAuditFields(body);
    if (!validation.ok || auditErrors.length) {
      return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
    }
    const disposition = body as TodayMaterialChangeDispositionRequest;
    try {
      const inbox = await readTodayActionInbox(options.pool, actor, {
        quoteLiveMaxAgeSeconds: options.quoteLiveMaxAgeSeconds,
        accountScopeId: derivePinganSnapshotAccountScope(actor, options),
        currentPortfolioEnabled: options.pinganCurrentPortfolioEnabled,
        currentPortfolioMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300,
        sourceStore: options.researchDocument ? {repositoryRoot: options.researchDocument.repositoryRoot,
          rawStoreRoot: options.researchDocument.rawStoreRoot, availabilityCache: new Map()} : undefined
      }, now);
      if (!validateTodayActionInboxEnvelope(inbox, now).ok || inbox.status !== "available") {
        return reply.code(503).send({ ok: false, message: "fresh Today action inbox is unavailable" });
      }
      const item = inbox.items.find((candidate) => candidate.id === disposition.itemId);
      if (!item || item.kind === "source_failure" || item.source.sourceFingerprint === null) {
        return reply.code(409).send({ ok: false, message: "Today action is no longer current; refresh before writing" });
      }
      if (item.membership.version !== disposition.membershipVersion
        || item.source.sourceFingerprint !== disposition.sourceFingerprint) {
        return reply.code(409).send({ ok: false, message: "Today action identity changed; refresh before writing" });
      }
      // Source-driven research updates are reminders, not task/report/formal-review completion.
      // Keep that boundary explicit when allowing the same disposition history as material changes.
      const sourceResearchChange = item.kind === "research"
        && item.source.lane === "research"
        && item.source.status === "available"
        && item.source.freshness === "fresh"
        && ["research_decision_update", "research_source_intake", "weekly_research_review"].includes(item.source.sourceType)
        && item.researchTarget !== null
        && item.researchTarget.task === null
        && item.researchTarget.report === null
        && item.reviewEvent === null;
      const sourceCurrent = item.source.validUntil === null || Date.parse(item.source.validUntil) > now.getTime();
      const canHandle = item.kind === "material_change" || (sourceResearchChange && sourceCurrent);
      // A lost response can be retried with its original idempotency key after expiry.
      // The repository rejects a fresh key for an already resolved item.
      const resolvedReplay = sourceResearchChange && item.state === "resolved" && disposition.state === "resolved";
      const transitionAllowed = (disposition.state === "later" && ["new", "later"].includes(item.state))
        || (disposition.state === "new" && (["new", "later"].includes(item.state) || (canHandle && item.state === "resolved")))
        || (disposition.state === "resolved" && (canHandle || resolvedReplay) && ["new", "later", "resolved"].includes(item.state));
      if (!transitionAllowed) {
        return reply.code(409).send({ ok: false, message: "Today action state changed; refresh before writing" });
      }
      const result = await writeTodayMaterialChangeDisposition(options.pool, disposition, item, actor, now);
      if (!validateTodayMaterialChangeDispositionWrite(result).ok) {
        return reply.code(503).send({ ok: false, message: "Today action disposition write-back failed contract validation" });
      }
      return result;
    } catch (error) {
      return dispositionFailure(reply, error);
    }
  });
}

function dispositionFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof CandidateMembershipNotFoundError) return reply.code(404).send({ ok: false, message: error.message });
  if (error instanceof IdempotencyConflictError
    || error instanceof CandidateMembershipConflictError
    || error instanceof CandidateMembershipVersionConflictError) {
    return reply.code(409).send({ ok: false, message: error.message });
  }
  return reply.code(503).send({ ok: false, message: "Today action disposition repository is unavailable" });
}
