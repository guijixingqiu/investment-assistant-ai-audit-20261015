import type { FastifyInstance } from "fastify";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import {
  CANDIDATE_DECISION_INTAKE_SCHEMA_VERSION,
  validateCandidateDecisionIntakeEnvelope
} from "../../../../packages/contracts/src/candidateDecisionIntake.js";
import { validateAssistAdvisoryScopeEnvelope } from "../../../../packages/contracts/src/assistAdvisoryScope.js";
import { validateAssistHumanReviewWorkspaceEnvelope } from "../../../../packages/contracts/src/assistHumanReviewWorkspace.js";
import { validateAssistReviewFollowUpWorkflowEnvelope } from "../../../../packages/contracts/src/assistReviewFollowUpWorkflow.js";
import { validateAssistDecisionNoteWorkflowEnvelope } from "../../../../packages/contracts/src/assistDecisionNoteWorkflow.js";
import { validateAnnualDecisionBriefEnvelope } from "../../../../packages/contracts/src/annualDecisionBrief.js";
import {
  assistDecisionNoteWorkflowFailClosedEnvelope,
  assistHumanReviewWorkspaceFailClosedEnvelope,
  assistReviewFollowUpWorkflowFailClosedEnvelope,
  readAssistDecisionNoteWorkflowEnvelope,
  readAssistHumanReviewWorkspaceEnvelope,
  readAssistReviewFollowUpWorkflowEnvelope
} from "../research/repository.js";
import { assistAdvisoryScopeFailClosedEnvelope, readAssistAdvisoryScopeEnvelope } from "../research/assistAdvisoryScopeService.js";
import { readCandidateDecisionIntakeEnvelope } from "../research/candidateDecisionIntakeRepository.js";
import {
  annualDecisionBriefFailClosedEnvelope,
  annualDecisionBriefFromIntake
} from "../research/annualDecisionBriefService.js";
import { registerAnnualConditionalDecisionRoutes } from "./annualConditionalDecisionRoutes.js";
import { registerAnnualPortfolioLabRoutes } from "./annualPortfolioLabRoutes.js";
import { registerAnnualValuationQuantWorkbenchRoutes } from "./annualValuationQuantWorkbenchRoutes.js";
import { authenticateReadOnly } from "./researchAuth.js";
import { isCanonicalMembershipId } from "./researchRouteValidation.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";

export async function registerAssistWorkflowRoutes(
  app: FastifyInstance,
  options: MobileResearchRouteOptions
): Promise<void> {
  app.get("/api/mobile/research/candidate-memberships/:id/decision-brief", async (request, reply) => {
    const now = options.now?.() ?? new Date();
    const params = request.params as { id: string };
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) {
      await reply.code(401).send(annualDecisionBriefFailClosedEnvelope(
        now.toISOString(),
        params.id,
        "unauthorized",
        "unavailable",
        "read authorization required"
      ));
      return;
    }
    if (!isCanonicalMembershipId(params.id)) {
      await reply.code(400).send(annualDecisionBriefFailClosedEnvelope(
        now.toISOString(),
        params.id,
        actor.actorId,
        "unavailable",
        "candidate membership id must be a positive integer"
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
    const envelope = annualDecisionBriefFromIntake(intake, now);
    const response = validateAnnualDecisionBriefEnvelope(envelope).ok
      ? envelope
      : annualDecisionBriefFailClosedEnvelope(
          now.toISOString(),
          params.id,
          actor.actorId,
          "unavailable",
          "Assembled annual decision brief failed contract validation before response."
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

  await registerAnnualValuationQuantWorkbenchRoutes(app, options);
  await registerAnnualPortfolioLabRoutes(app, options);
  await registerAnnualConditionalDecisionRoutes(app, options);

  app.get("/api/mobile/research/candidate-memberships/:id/decision-intake", async (request, reply) => {
    const now = options.now?.() ?? new Date();
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) {
      await reply.code(401).send({ ok: false, message: "read authorization required" });
      return;
    }
    const params = request.params as { id: string };
    if (!isCanonicalMembershipId(params.id)) {
      await reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
      return;
    }
    const envelope = await readCandidateDecisionIntakeEnvelope(
      options.pool, params.id, actor, options.quoteLiveMaxAgeSeconds, now, options.quantEvidence?.decision ?? null
    );
    const validation = validateCandidateDecisionIntakeEnvelope(envelope);
    if (!validation.ok) {
      await reply.code(503).send(candidateDecisionIntakeFailClosedEnvelope(
        now.toISOString(),
        params.id,
        actor.actorId,
        "Assembled candidate decision-intake failed contract validation before response."
      ));
      return;
    }
    if (envelope.status === "not_found") {
      await reply.code(404).send(envelope);
      return;
    }
    if (envelope.status === "unavailable") {
      await reply.code(503).send(envelope);
      return;
    }
    return envelope;
  });

  app.get("/api/mobile/research/candidate-memberships/:id/advisory-scope", async (request, reply) => {
    const now = options.now?.() ?? new Date();
    const params = request.params as { id: string };
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) {
      await reply.code(401).send(assistAdvisoryScopeFailClosedEnvelope(now.toISOString(), params.id, "unauthorized", "read authorization required"));
      return;
    }
    if (!isCanonicalMembershipId(params.id)) {
      await reply.code(400).send(assistAdvisoryScopeFailClosedEnvelope(now.toISOString(), params.id, "malformed", "candidate membership id must be a positive integer"));
      return;
    }
    const envelope = await readAssistAdvisoryScopeEnvelope(
      options.pool, params.id, actor, options.quoteLiveMaxAgeSeconds, now, options.quantEvidence?.decision ?? null
    );
    const response = validateAssistAdvisoryScopeEnvelope(envelope).ok
      ? envelope
      : assistAdvisoryScopeFailClosedEnvelope(now.toISOString(), params.id, "malformed", "Assembled advisory scope failed contract validation before response.");
    if (response.status === "not_found") {
      await reply.code(404).send(response);
      return;
    }
    if (response.status === "unavailable" || response.status === "malformed") {
      await reply.code(503).send(response);
      return;
    }
    return response;
  });

  app.get("/api/mobile/research/candidate-memberships/:id/human-review-workspace", async (request, reply) => {
    const now = options.now?.() ?? new Date();
    const params = request.params as { id: string };
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) {
      await reply.code(401).send(assistHumanReviewWorkspaceFailClosedEnvelope(now.toISOString(), params.id, "unauthorized", "read authorization required"));
      return;
    }
    if (!isCanonicalMembershipId(params.id)) {
      await reply.code(400).send(assistHumanReviewWorkspaceFailClosedEnvelope(now.toISOString(), params.id, "malformed", "candidate membership id must be a positive integer"));
      return;
    }
    const envelope = await readAssistHumanReviewWorkspaceEnvelope(options.pool, params.id, actor, options.quoteLiveMaxAgeSeconds, now);
    const response = validateAssistHumanReviewWorkspaceEnvelope(envelope).ok
      ? envelope
      : assistHumanReviewWorkspaceFailClosedEnvelope(now.toISOString(), params.id, "malformed", "Assembled human-review workspace failed contract validation before response.");
    if (response.status === "not_found") {
      await reply.code(404).send(response);
      return;
    }
    if (response.status === "unavailable" || response.status === "malformed") {
      await reply.code(503).send(response);
      return;
    }
    return response;
  });

  app.get("/api/mobile/research/candidate-memberships/:id/human-review-workspace/follow-up-workflow", async (request, reply) => {
    const now = options.now?.() ?? new Date();
    const params = request.params as { id: string };
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) {
      await reply.code(401).send(assistReviewFollowUpWorkflowFailClosedEnvelope(now.toISOString(), params.id, "unauthorized", "read authorization required"));
      return;
    }
    if (!isCanonicalMembershipId(params.id)) {
      await reply.code(400).send(assistReviewFollowUpWorkflowFailClosedEnvelope(now.toISOString(), params.id, "malformed", "candidate membership id must be a positive integer"));
      return;
    }
    const envelope = await readAssistReviewFollowUpWorkflowEnvelope(options.pool, params.id, actor, options.quoteLiveMaxAgeSeconds, now);
    const response = validateAssistReviewFollowUpWorkflowEnvelope(envelope).ok
      ? envelope
      : assistReviewFollowUpWorkflowFailClosedEnvelope(now.toISOString(), params.id, "malformed", "Assembled review follow-up workflow failed contract validation before response.");
    if (response.status === "not_found") {
      await reply.code(404).send(response);
      return;
    }
    if (response.status === "unavailable" || response.status === "malformed") {
      await reply.code(503).send(response);
      return;
    }
    return response;
  });

  app.get("/api/mobile/research/candidate-memberships/:id/human-review-workspace/follow-up-workflow/decision-note-workflow", async (request, reply) => {
    const now = options.now?.() ?? new Date();
    const params = request.params as { id: string };
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) {
      await reply.code(401).send(assistDecisionNoteWorkflowFailClosedEnvelope(now.toISOString(), params.id, "unauthorized", "read authorization required"));
      return;
    }
    if (!isCanonicalMembershipId(params.id)) {
      await reply.code(400).send(assistDecisionNoteWorkflowFailClosedEnvelope(now.toISOString(), params.id, "malformed", "candidate membership id must be a positive integer"));
      return;
    }
    const envelope = await readAssistDecisionNoteWorkflowEnvelope(options.pool, params.id, actor, options.quoteLiveMaxAgeSeconds, now);
    const response = validateAssistDecisionNoteWorkflowEnvelope(envelope).ok
      ? envelope
      : assistDecisionNoteWorkflowFailClosedEnvelope(now.toISOString(), params.id, "malformed", "Assembled decision note workflow failed contract validation before response.");
    if (response.status === "not_found") {
      await reply.code(404).send(response);
      return;
    }
    if (response.status === "unavailable" || response.status === "malformed") {
      await reply.code(503).send(response);
      return;
    }
    return response;
  });
}

function candidateDecisionIntakeFailClosedEnvelope(generatedAt: string, membershipId: string, actorId: string, message: string) {
  return {
    schemaVersion: CANDIDATE_DECISION_INTAKE_SCHEMA_VERSION,
    generatedAt,
    status: "unavailable",
    membershipId,
    requestedActorId: actorId,
    requestedSymbol: null,
    message,
    provenance: {
      membership: "candidate_memberships",
      research: "unavailable",
      quotes: "unavailable",
      decisionContext: "unavailable",
      reviews: "unavailable",
      portfolio: "omitted"
    },
    metadata: makeFactMetadata({
      source: "candidate_decision_intake",
      asOf: generatedAt,
      fetchedAt: generatedAt,
      freshness: "unavailable",
      provenance: "unavailable",
      authority: "unavailable",
      stale: false,
      missing: false,
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message
    }),
    nextAction: { state: "unavailable", reason: message, advisoryOnly: true },
    membership: null,
    decisionContext: null,
    review: {
      status: "none",
      latestDecisionCheckId: null,
      latestDecisionCheckedAt: null,
      latestReviewId: null,
      latestReviewedAt: null,
      message
    },
    safety: {
      createsOrder: false,
      createsTrade: false,
      mutatesCash: false,
      writesFee: false,
      mutatesPosition: false,
      callsBroker: false
    }
  };
}
