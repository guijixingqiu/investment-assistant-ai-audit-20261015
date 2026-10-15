import type { FastifyInstance } from "fastify";
import { validateTodayActionInboxEnvelope } from "../../../../packages/contracts/src/todayActionInbox.js";
import { readTodayActionInbox, failClosed } from "../research/todayActionInboxService.js";
import { derivePinganSnapshotAccountScope, authenticateReadOnly } from "./researchAuth.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";
import { registerTodayMaterialChangeDispositionRoute } from "./todayMaterialChangeDispositionRoutes.js";

export async function registerTodayActionInboxRoutes(
  app: FastifyInstance,
  options: MobileResearchRouteOptions
): Promise<void> {
  app.get("/api/mobile/research/today/inbox", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const now = options.now?.() ?? new Date();
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) {
      await reply.code(401).send(failClosed(now, "UNKNOWN", "unauthorized", "read authorization required"));
      return;
    }
    try {
      const envelope = await readTodayActionInbox(options.pool, actor, {
        quoteLiveMaxAgeSeconds: options.quoteLiveMaxAgeSeconds,
        accountScopeId: derivePinganSnapshotAccountScope(actor, options),
        currentPortfolioEnabled: options.pinganCurrentPortfolioEnabled,
        currentPortfolioMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300
        ,anomalyOptions: options,
        sourceStore: options.researchDocument ? {repositoryRoot: options.researchDocument.repositoryRoot,
          rawStoreRoot: options.researchDocument.rawStoreRoot, availabilityCache: new Map()} : undefined
      }, now);
      const validation = validateTodayActionInboxEnvelope(envelope, now);
      if (!validation.ok) {
        await reply.code(503).send(failClosed(now, actor.actorId, "unavailable", "Today action inbox failed contract validation; no partial actions are exposed."));
        return;
      }
      return envelope;
    } catch {
      await reply.code(503).send(failClosed(now, actor.actorId, "unavailable", "Today action inbox is unavailable; no old actions are retained."));
    }
  });

  await registerTodayMaterialChangeDispositionRoute(app, options);
}
