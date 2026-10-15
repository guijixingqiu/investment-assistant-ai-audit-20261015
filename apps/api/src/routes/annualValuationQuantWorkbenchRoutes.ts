import type { FastifyInstance } from "fastify";
import { validateAnnualValuationQuantWorkbenchEnvelope } from "../../../../packages/contracts/src/annualValuationQuantWorkbench.js";
import {
  candidateDecisionIntakeFailClosedEnvelope,
  readCandidateDecisionIntakeEnvelope
} from "../research/candidateDecisionIntakeRepository.js";
import { validateCandidateDecisionIntakeEnvelope } from "../../../../packages/contracts/src/candidateDecisionIntake.js";
import {
  annualValuationQuantWorkbenchFailClosedEnvelope,
  annualValuationQuantWorkbenchFromIntake,
  parseAnnualValuationQuantWorkbenchQuery
} from "../research/annualValuationQuantWorkbenchService.js";
import { authenticateReadOnly } from "./researchAuth.js";
import { authenticateWrite } from "./researchAuth.js";
import { isCanonicalMembershipId } from "./researchRouteValidation.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";
import {
  parseRegisteredQuantResearchRunRequest,
  registeredQuantResearchTarget
} from "../../../../packages/contracts/src/quantRegisteredResearchRun.js";
import type { RegisteredQuantRunOutcome } from "../research/registeredQuantResearchRun.js";

export async function registerAnnualValuationQuantWorkbenchRoutes(
  app: FastifyInstance,
  options: MobileResearchRouteOptions
): Promise<void> {
  app.get("/api/mobile/research/candidate-memberships/:id/valuation-quant-workbench", async (request, reply) => {
    const now = options.now?.() ?? new Date();
    const params = request.params as { id: string };
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) {
      await reply.code(401).send(annualValuationQuantWorkbenchFailClosedEnvelope(
        now.toISOString(),
        params.id,
        "unauthorized",
        "unavailable",
        "read authorization required"
      ));
      return;
    }
    if (!isCanonicalMembershipId(params.id)) {
      await reply.code(400).send(annualValuationQuantWorkbenchFailClosedEnvelope(
        now.toISOString(),
        params.id,
        actor.actorId,
        "malformed",
        "candidate membership id must be a positive integer"
      ));
      return;
    }
    const parsed = parseAnnualValuationQuantWorkbenchQuery(request.query as Record<string, unknown>);
    if (!parsed.ok) {
      await reply.code(400).send(annualValuationQuantWorkbenchFailClosedEnvelope(
        now.toISOString(),
        params.id,
        actor.actorId,
        "malformed",
        `valuation and quant inputs are invalid: ${parsed.errors.join("; ")}`
      ));
      return;
    }
    const intake = await readCandidateDecisionIntakeEnvelope(
      options.pool,
      params.id,
      actor,
      options.quoteLiveMaxAgeSeconds,
      now,
      options.quantEvidence?.decision ?? null
    );
    const envelope = annualValuationQuantWorkbenchFromIntake(intake, parsed.value, now);
    const response = validateAnnualValuationQuantWorkbenchEnvelope(envelope).ok
      ? envelope
      : annualValuationQuantWorkbenchFailClosedEnvelope(
          now.toISOString(),
          params.id,
          actor.actorId,
          "unavailable",
          "Assembled valuation and quant workbench failed contract validation before response."
        );
    if (response.status === "not_found") {
      await reply.code(404).send(response);
      return;
    }
    if (response.status === "unavailable") {
      await reply.code(503).send(response);
      return;
    }
    return response;
  });

  /**
   * Explicit registered quantitative research run. The client chooses only the
   * registered operation through the candidate membership symbol; the script,
   * configuration, environment, and output directory are repository-fixed.
   * A registered run is fixed and preregistered, so it consumes no user
   * valuation or filter input and answers with the existing candidate
   * decision-intake envelope (the same contract as the decision-intake read).
   * Failure never publishes a catalog reference and never reuses another
   * symbol's accepted evidence.
   */
  app.post("/api/mobile/research/candidate-memberships/:id/valuation-quant-workbench/refresh", async (request, reply) => {
    const now = options.now?.() ?? new Date();
    const params = request.params as { id: string };
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) {
      await reply.code(401).send(candidateDecisionIntakeFailClosedEnvelope(
        now.toISOString(), params.id, "unauthorized", "research write authorization required"
      ));
      return;
    }
    if (!isCanonicalMembershipId(params.id)) {
      await reply.code(400).send(candidateDecisionIntakeFailClosedEnvelope(
        now.toISOString(), params.id, actor.actorId, "candidate membership id must be a positive integer"
      ));
      return;
    }
    const body = parseRegisteredQuantResearchRunRequest(request.body);
    if (!body.ok) {
      await reply.code(400).send(candidateDecisionIntakeFailClosedEnvelope(
        now.toISOString(), params.id, actor.actorId,
        `registered research run request is invalid: ${body.errors.join("; ")}`
      ));
      return;
    }
    const before = await readCandidateDecisionIntakeEnvelope(
      options.pool, params.id, actor, options.quoteLiveMaxAgeSeconds, now, options.quantEvidence?.decision ?? null
    );
    const target = before.status === "available" && before.membership && before.requestedSymbol
      ? registeredQuantResearchTarget(before.requestedSymbol)
      : null;
    if (!target || !before.membership) {
      await reply.code(409).send(candidateDecisionIntakeFailClosedEnvelope(
        now.toISOString(), params.id, actor.actorId,
        "registered research runs are available only for a readable candidate membership bound to a registered Hong Kong symbol"
      ));
      return;
    }
    if (before.membership.version !== body.value.membershipVersion) {
      await reply.code(409).send(candidateDecisionIntakeFailClosedEnvelope(
        now.toISOString(), params.id, actor.actorId,
        "candidate membership changed since the run was requested; reload before running registered research"
      ));
      return;
    }
    const runtime = options.registeredQuantRun;
    if (!runtime?.enabled) {
      await reply.code(503).send(candidateDecisionIntakeFailClosedEnvelope(
        now.toISOString(), params.id, actor.actorId,
        "registered quantitative research runs are disabled in this runtime"
      ));
      return;
    }
    // Membership and actor are re-validated immediately before the result is
    // published, using a fresh clock, so a long run cannot publish evidence for
    // a membership that has since changed.
    const authorization = {
      actorId: actor.actorId,
      authorizePublish: async () => {
        const recheck = await readCandidateDecisionIntakeEnvelope(
          options.pool, params.id, actor, options.quoteLiveMaxAgeSeconds, options.now?.() ?? new Date(),
          options.quantEvidence?.decision ?? null
        );
        if (recheck.status !== "available" || !recheck.membership
          || recheck.membership.version !== body.value.membershipVersion
          || recheck.requestedSymbol !== target.symbol) {
          return { ok: false as const, message: "candidate membership changed during the registered research run; the refreshed evidence was not published for this membership" };
        }
        return { ok: true as const };
      }
    };
    let outcome: RegisteredQuantRunOutcome;
    try {
      outcome = await runtime.coordinator.run(target, body.value, authorization);
    } catch {
      await reply.code(503).send(annualValuationQuantWorkbenchFailClosedEnvelope(
        (options.now?.() ?? new Date()).toISOString(), params.id, actor.actorId, "unavailable",
        "registered quantitative research run failed before producing verified evidence"
      ));
      return;
    }
    const settledAt = options.now?.() ?? new Date();
    if (!outcome.ok && outcome.status === "busy") {
      await reply.code(409).send(candidateDecisionIntakeFailClosedEnvelope(
        settledAt.toISOString(), params.id, actor.actorId,
        "another registered quantitative research run is already in progress; retry after it completes"
      ));
      return;
    }
    const after = await readCandidateDecisionIntakeEnvelope(
      options.pool, params.id, actor, options.quoteLiveMaxAgeSeconds, settledAt, options.quantEvidence?.decision ?? null
    );
    if (after.status !== "available" || !after.membership || after.requestedSymbol !== target.symbol
      || after.membership.version !== before.membership.version) {
      await reply.code(409).send(candidateDecisionIntakeFailClosedEnvelope(
        settledAt.toISOString(), params.id, actor.actorId,
        "candidate membership changed during the registered research run; the refreshed evidence was not published for this membership"
      ));
      return;
    }
    if (!outcome.ok) {
      await reply.code(503).send(candidateDecisionIntakeFailClosedEnvelope(
        settledAt.toISOString(), params.id, actor.actorId,
        `registered quantitative research run did not produce verified evidence: ${outcome.message}`
      ));
      return;
    }
    // A run that reported success must have published readable historical
    // quant evidence for this exact membership; missing evidence never becomes
    // a success response.
    if (after.decisionContext?.quantEvidence.status !== "available") {
      await reply.code(503).send(candidateDecisionIntakeFailClosedEnvelope(
        settledAt.toISOString(), params.id, actor.actorId,
        "the registered quantitative research run reported success without publishing readable quant evidence for this membership"
      ));
      return;
    }
    const validation = validateCandidateDecisionIntakeEnvelope(after);
    if (!validation.ok) {
      await reply.code(503).send(candidateDecisionIntakeFailClosedEnvelope(
        settledAt.toISOString(), params.id, actor.actorId,
        "Assembled candidate decision-intake failed contract validation before response."
      ));
      return;
    }
    return after;
  });
}
