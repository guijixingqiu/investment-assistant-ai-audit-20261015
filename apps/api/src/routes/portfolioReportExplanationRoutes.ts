import type { FastifyInstance } from "fastify";
import { validatePortfolioReportExplanationEnvelope } from "../../../../packages/contracts/src/portfolioReportExplanation.js";
import {
  annualPortfolioLabFromFacts,
  parseAnnualPortfolioLabQuery
} from "../research/annualPortfolioLabService.js";
import {
  annualPortfolioLabQuantEvidenceConfigurationUnavailable,
  loadAnnualPortfolioLabQuantEvidence
} from "../research/annualPortfolioLabQuantEvidence.js";
import { readAuthorizedPortfolioDecisionContext } from "../research/authorizedPortfolioDecisionContext.js";
import { readCandidateDecisionIntakeEnvelope } from "../research/candidateDecisionIntakeRepository.js";
import { readDeepResearchWorkspace } from "../research/deepResearchReadRepository.js";
import {
  portfolioReportExplanationFailClosedEnvelope,
  portfolioReportExplanationFromFacts
} from "../research/portfolioReportExplanationService.js";
import { authenticateReadOnly, derivePinganSnapshotAccountScope } from "./researchAuth.js";
import { isCanonicalMembershipId } from "./researchRouteValidation.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";

export async function registerPortfolioReportExplanationRoutes(
  app: FastifyInstance,
  options: MobileResearchRouteOptions
): Promise<void> {
  app.get("/api/mobile/research/candidate-memberships/:id/portfolio-report-explanation", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const now = options.now?.() ?? new Date();
    const id = (request.params as { id: string }).id;
    const actor = authenticateReadOnly(request.headers, options);
    const fail = (statusCode: number, status: "malformed" | "unauthorized" | "unavailable", actorId: string, message: string) =>
      reply.code(statusCode).send(portfolioReportExplanationFailClosedEnvelope(
        now.toISOString(), id, actorId, status, message
      ));
    if (!actor) return fail(401, "unauthorized", "unauthorized", "read authorization required");
    if (!isCanonicalMembershipId(id)) return fail(400, "malformed", actor.actorId, "candidate membership id must be a positive integer");
    const parsed = parseAnnualPortfolioLabQuery(request.query as Record<string, unknown>);
    if (!parsed.ok) return fail(400, "malformed", actor.actorId, `portfolio scenario inputs are invalid: ${parsed.errors.join("; ")}`);
    if (!options.pinganCurrentPortfolioEnabled) return fail(503, "unavailable", actor.actorId, "Current Pingan portfolio is disabled outside local development.");
    const accountScopeId = derivePinganSnapshotAccountScope(actor, options);
    if (!accountScopeId) return fail(401, "unauthorized", actor.actorId, "Current Pingan portfolio account scope authorization is required.");

    let envelope;
    try {
      const [workspace, intake, portfolio, quant] = await Promise.all([
        readDeepResearchWorkspace(options.pool, id, actor, now, {
          accountScopeId,
          currentPortfolioEnabled: true,
          currentPortfolioMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300
        }),
        readCandidateDecisionIntakeEnvelope(
          options.pool,
          id,
          actor,
          options.quoteLiveMaxAgeSeconds,
          now,
          options.quantEvidence?.decision ?? null
        ),
        readAuthorizedPortfolioDecisionContext(options.pool, {
          accountScopeId, ownerCurrentActor: actor,
          pinganCurrentMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300,
          quoteLiveMaxAgeSeconds: options.quoteLiveMaxAgeSeconds
        }, now, "portfolio report explanation"),
        options.quantEvidence?.annualPortfolioLab
          ? loadAnnualPortfolioLabQuantEvidence(options.quantEvidence.annualPortfolioLab, now)
          : Promise.resolve(annualPortfolioLabQuantEvidenceConfigurationUnavailable())
      ]);
      const lab = annualPortfolioLabFromFacts(
        intake,
        portfolio,
        parsed.value,
        quant,
        now
      );
      envelope = portfolioReportExplanationFromFacts(workspace, lab, now);
    } catch {
      envelope = portfolioReportExplanationFailClosedEnvelope(
        now.toISOString(), id, actor.actorId, "unavailable", "Portfolio report explanation source facts are unavailable."
      );
    }
    const response = validatePortfolioReportExplanationEnvelope(envelope).ok
      ? envelope
      : portfolioReportExplanationFailClosedEnvelope(
          now.toISOString(), id, actor.actorId, "unavailable", "Portfolio report explanation failed contract validation before response."
        );
    const statusCodes = {
      available: 200,
      blocked: 409,
      not_found: 404,
      malformed: 400,
      unauthorized: 401,
      unavailable: 503
    } as const;
    return reply.code(statusCodes[response.status]).send(response);
  });
}
