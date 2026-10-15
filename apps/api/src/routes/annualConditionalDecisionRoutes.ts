import type { FastifyInstance } from "fastify";
import { validateAnnualConditionalDecisionPreviewEnvelope } from "../../../../packages/contracts/src/annualConditionalDecision.js";
import {
  annualConditionalDecisionPreviewFailClosedEnvelope,
  parseAnnualConditionalDecisionPreviewQuery,
  readAnnualConditionalDecisionPreview
} from "../research/annualConditionalDecisionService.js";
import { authenticateReadOnly, derivePinganSnapshotAccountScope } from "./researchAuth.js";
import { isCanonicalMembershipId } from "./researchRouteValidation.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";

export async function registerAnnualConditionalDecisionRoutes(
  app: FastifyInstance,
  options: MobileResearchRouteOptions
): Promise<void> {
  app.get("/api/mobile/research/candidate-memberships/:id/conditional-decision-preview", async (request, reply) => {
    const now = options.now?.() ?? new Date();
    const params = request.params as { id: string };
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) {
      await reply.code(401).send(annualConditionalDecisionPreviewFailClosedEnvelope(
        now.toISOString(), params.id, "unauthorized", "unauthorized", "read authorization required"
      ));
      return;
    }
    if (!isCanonicalMembershipId(params.id)) {
      await reply.code(400).send(annualConditionalDecisionPreviewFailClosedEnvelope(
        now.toISOString(), params.id, actor.actorId, "malformed", "candidate membership id must be a positive integer"
      ));
      return;
    }
    const parsed = parseAnnualConditionalDecisionPreviewQuery(request.query as Record<string, unknown>);
    if (!parsed.ok) {
      await reply.code(400).send(annualConditionalDecisionPreviewFailClosedEnvelope(
        now.toISOString(), params.id, actor.actorId, "malformed", `conditional preview inputs are invalid: ${parsed.errors.join("; ")}`
      ));
      return;
    }
    if (!options.pinganCurrentPortfolioEnabled) {
      await reply.code(503).send(annualConditionalDecisionPreviewFailClosedEnvelope(
        now.toISOString(), params.id, actor.actorId, "unavailable", "Current Pingan portfolio is disabled outside local development."
      ));
      return;
    }
    const response = await readAnnualConditionalDecisionPreview(options.pool, params.id, actor, parsed.value, {
      accountScopeId: derivePinganSnapshotAccountScope(actor, options),
      pinganCurrentMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300,
      quoteLiveMaxAgeSeconds: options.quoteLiveMaxAgeSeconds,
      quantEvidence: options.quantEvidence ?? null,
      now
    });
    const validated = validateAnnualConditionalDecisionPreviewEnvelope(response);
    const envelope = validated.ok ? response : annualConditionalDecisionPreviewFailClosedEnvelope(
      now.toISOString(), params.id, actor.actorId, "unavailable", "Assembled conditional decision preview failed contract validation before response."
    );
    const statusCodes = {
      available: 200,
      blocked: 409,
      not_found: 404,
      malformed: 400,
      unauthorized: 401,
      unavailable: 503
    } as const;
    reply.code(statusCodes[envelope.status]);
    return envelope;
  });
}
