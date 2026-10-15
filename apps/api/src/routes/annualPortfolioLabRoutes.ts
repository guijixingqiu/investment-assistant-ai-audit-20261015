import type { FastifyInstance } from "fastify";
import { validateAnnualPortfolioLabEnvelope } from "../../../../packages/contracts/src/annualPortfolioLab.js";
import { annualPortfolioLabFailClosedEnvelope, annualPortfolioLabFromFacts, parseAnnualPortfolioLabQuery } from "../research/annualPortfolioLabService.js";
import {
  annualPortfolioLabQuantEvidenceConfigurationUnavailable,
  loadAnnualPortfolioLabQuantEvidence
} from "../research/annualPortfolioLabQuantEvidence.js";
import { readAuthorizedPortfolioDecisionContext } from "../research/authorizedPortfolioDecisionContext.js";
import { readCandidateDecisionIntakeEnvelope } from "../research/candidateDecisionIntakeRepository.js";
import { authenticateReadOnly, derivePinganSnapshotAccountScope } from "./researchAuth.js";
import { isCanonicalMembershipId } from "./researchRouteValidation.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";

export async function registerAnnualPortfolioLabRoutes(
  app: FastifyInstance,
  options: MobileResearchRouteOptions
): Promise<void> {
  app.get("/api/mobile/research/candidate-memberships/:id/portfolio-lab", async (request, reply) => {
    const now = options.now?.() ?? new Date();
    const params = request.params as { id: string };
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) {
      await reply.code(401).send(annualPortfolioLabFailClosedEnvelope(
        now.toISOString(), params.id, "unauthorized", "unauthorized", "read authorization required"
      ));
      return;
    }
    if (!isCanonicalMembershipId(params.id)) {
      await reply.code(400).send(annualPortfolioLabFailClosedEnvelope(
        now.toISOString(), params.id, actor.actorId, "malformed", "candidate membership id must be a positive integer"
      ));
      return;
    }
    const parsed = parseAnnualPortfolioLabQuery(request.query as Record<string, unknown>);
    if (!parsed.ok) {
      await reply.code(400).send(annualPortfolioLabFailClosedEnvelope(
        now.toISOString(), params.id, actor.actorId, "malformed", `portfolio lab inputs are invalid: ${parsed.errors.join("; ")}`
      ));
      return;
    }
    if (!options.pinganCurrentPortfolioEnabled) {
      await reply.code(503).send(annualPortfolioLabFailClosedEnvelope(
        now.toISOString(), params.id, actor.actorId, "unavailable", "Current Pingan portfolio is disabled outside local development."
      ));
      return;
    }
    const accountScopeId = derivePinganSnapshotAccountScope(actor, options);
    if (!accountScopeId) {
      await reply.code(401).send(annualPortfolioLabFailClosedEnvelope(
        now.toISOString(), params.id, actor.actorId, "unauthorized", "Current Pingan portfolio account scope authorization is required."
      ));
      return;
    }
    let envelope;
    try {
      const [intake, portfolio, quant] = await Promise.all([
        readCandidateDecisionIntakeEnvelope(
          options.pool,
          params.id,
          actor,
          options.quoteLiveMaxAgeSeconds,
          now,
          options.quantEvidence?.decision ?? null
        ),
        readAuthorizedPortfolioDecisionContext(options.pool, {
          accountScopeId, ownerCurrentActor: actor,
          pinganCurrentMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300,
          quoteLiveMaxAgeSeconds: options.quoteLiveMaxAgeSeconds
        }, now, "annual portfolio lab"),
        options.quantEvidence?.annualPortfolioLab
          ? loadAnnualPortfolioLabQuantEvidence(
              options.quantEvidence.annualPortfolioLab,
              now
            )
          : Promise.resolve(annualPortfolioLabQuantEvidenceConfigurationUnavailable())
      ]);
      envelope = annualPortfolioLabFromFacts(intake, portfolio, parsed.value, quant, now);
    } catch {
      envelope = annualPortfolioLabFailClosedEnvelope(
        now.toISOString(), params.id, actor.actorId, "unavailable", "Portfolio lab source facts are unavailable."
      );
    }
    const response = validateAnnualPortfolioLabEnvelope(envelope).ok
      ? envelope
      : annualPortfolioLabFailClosedEnvelope(
          now.toISOString(), params.id, actor.actorId, "unavailable", "Assembled portfolio lab failed contract validation before response."
        );
    const statusCodes = {
      available: 200,
      blocked: 409,
      not_found: 404,
      malformed: 400,
      unauthorized: 401,
      unavailable: 503
    } as const;
    reply.code(statusCodes[response.status]);
    return response;
  });
}
