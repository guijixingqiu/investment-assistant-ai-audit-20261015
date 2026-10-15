import type { Pool } from "pg";
import type { CandidateMembershipData } from "../../../../packages/contracts/src/candidateMembership.js";
import type { CandidateDecisionIntakeEnvelope, CandidateDecisionIntakeNextAction } from "../../../../packages/contracts/src/candidateDecisionIntake.js";
import type {
  AssistAdvisoryScopeAllowedContinuation,
  AssistAdvisoryScopeEnvelope,
  AssistAdvisoryScopeFact,
  AssistAdvisoryScopeFactStatus,
  AssistAdvisoryScopeLimitation,
  AssistAdvisoryScopeReview,
  AssistAdvisoryScopeStatus
} from "../../../../packages/contracts/src/assistAdvisoryScope.js";
import { ASSIST_ADVISORY_SCOPE_SCHEMA_VERSION } from "../../../../packages/contracts/src/assistAdvisoryScope.js";
import type { DecisionContextEnvelope } from "../../../../packages/contracts/src/decisionContext.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { readCandidateDecisionIntakeEnvelope } from "./candidateDecisionIntakeRepository.js";
import type { DecisionQuantEvidenceOptions } from "./quantEvidenceSource.js";

export async function readAssistAdvisoryScopeEnvelope(
  pool: Pool,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  liveMaxAgeSeconds: number,
  now = new Date(),
  quantEvidence: DecisionQuantEvidenceOptions | null = null
): Promise<AssistAdvisoryScopeEnvelope> {
  const generatedAt = now.toISOString();
  if (!/^[1-9]\d*$/.test(membershipId)) return assistAdvisoryScopeFailClosedEnvelope(generatedAt, membershipId, "malformed", "candidate membership id must be a positive integer");
  const intake = await readCandidateDecisionIntakeEnvelope(pool, membershipId, actor, liveMaxAgeSeconds, now, quantEvidence);
  if (intake.status === "not_found") return assistAdvisoryScopeFailClosedEnvelope(generatedAt, membershipId, "not_found", intake.message);
  if (intake.status === "unavailable") return assistAdvisoryScopeFailClosedEnvelope(generatedAt, membershipId, "unavailable", intake.message);
  if (!intake.membership || !intake.decisionContext || !intake.requestedSymbol) return assistAdvisoryScopeFailClosedEnvelope(generatedAt, membershipId, "malformed", "Decision-intake facts were incomplete; advisory scope failed closed.");
  return {
    schemaVersion: ASSIST_ADVISORY_SCOPE_SCHEMA_VERSION,
    generatedAt,
    status: "available",
    target: { market: intake.membership.market, code: intake.membership.code, symbol: intake.membership.symbol, candidateMembershipId: intake.membershipId },
    candidateMembershipId: intake.membershipId,
    decisionContextId: intake.decisionContext.contextId,
    contextHash: intake.decisionContext.contextHash,
    provenance: { coreFacts: "repository_local_accepted_core1", pingan: "historical_last_imported_only", portfolio: "omitted", externalAccounts: "omitted", runtime: "repository_local_only" },
    review: reviewFromIntake(intake),
    facts: factsFromIntake(intake),
    limitations: limitationsFromIntake(intake),
    allowedContinuations: allowedContinuationsFromIntake(intake),
    safety: safetyProof(),
    message: "Factual local advisory scope is available for human review only."
  };
}

export function assistAdvisoryScopeFailClosedEnvelope(
  generatedAt: string, membershipId: string, status: Exclude<AssistAdvisoryScopeStatus, "available">, message: string
): AssistAdvisoryScopeEnvelope {
  return {
    schemaVersion: ASSIST_ADVISORY_SCOPE_SCHEMA_VERSION,
    generatedAt,
    status,
    target: { market: "HK", code: "00000", symbol: "HK.00000", candidateMembershipId: membershipId },
    candidateMembershipId: membershipId,
    facts: [],
    limitations: [{ kind: status, message, source: "contract" }],
    allowedContinuations: ["stop_due_to_unavailable_facts"],
    safety: safetyProof(),
    message,
    provenance: { coreFacts: "repository_local_accepted_core1", pingan: "omitted", portfolio: "omitted", externalAccounts: "omitted", runtime: "repository_local_only" },
    review: { status: "not_started", message: "No review facts are exposed for this fail-closed advisory scope.", latestReviewedAt: null },
    failClosedReason: status
  };
}

function factsFromIntake(intake: CandidateDecisionIntakeEnvelope): AssistAdvisoryScopeFact[] {
  const membership = intake.membership;
  const context = intake.decisionContext;
  if (!membership || !context) return [];
  return [
    fact("candidate_membership", membership.state === "archived" ? "membership_archived" : "ready_for_human_review", "Candidate membership", `Membership ${membership.id} is ${membership.state}.`, "accepted_core1_fact", membership.updatedAt, null),
    fact("candidate_decision_intake", decisionFactStatus(intake.nextAction.state), "Decision intake", intake.nextAction.reason, "accepted_core1_fact", intake.generatedAt, null),
    fact("quote", quoteFactStatus(membership), "Persisted quote", `Persisted quote status is ${membership.quote.status}.`, "accepted_core1_fact", membership.quote.fetchedAt, membership.quote.staleReason),
    fact("research", membership.research.status === "available" ? "ready_for_human_review" : "research_missing", "Research profile", membership.research.status === "available" ? "Research facts are available for human review." : "Research facts are missing for this candidate.", "accepted_core1_fact", membership.research.profileUpdatedAt, null),
    fact("decision_context", decisionContextFactStatus(context), "Decision context", `Decision context ${context.contextId} is available as factual local context.`, "accepted_core1_fact", context.generatedAt, null),
    fact("human_check", intake.review.status === "review_required" ? "review_required" : "human_check_pending", "Human check", intake.review.status === "review_required" ? "A prior human check requires post-decision review before new preparation." : "Human check remains a manual continuation.", "accepted_core1_fact", intake.review.latestDecisionCheckedAt, null),
    fact("post_decision_review", intake.review.status === "review_required" ? "review_required" : intake.review.latestReviewId ? "review_complete" : "empty", "Post-decision review", intake.review.message, "accepted_core1_fact", intake.review.latestReviewedAt, null),
    fact("pingan_last_imported", "historical_context_limited", "Pingan historical context", "Pingan context remains historical or last-imported only when viewed separately.", "pingan_historical_last_imported", null, "historical_pingan_only")
  ];
}

function fact(
  kind: AssistAdvisoryScopeFact["kind"], status: AssistAdvisoryScopeFactStatus, label: string, message: string,
  source: AssistAdvisoryScopeFact["source"], observedAt: string | null, staleReason: string | null
): AssistAdvisoryScopeFact { return { kind, status, label, message, source, observedAt, staleReason }; }

function limitationsFromIntake(intake: CandidateDecisionIntakeEnvelope): AssistAdvisoryScopeLimitation[] {
  const limitations: AssistAdvisoryScopeLimitation[] = [{ kind: "historical_pingan_only", message: "Pingan imported context is historical or last-imported only and cannot be treated as live holdings.", source: "repository_local_fact" }];
  const membership = intake.membership;
  const context = intake.decisionContext;
  if (!membership || !context) return [...limitations, { kind: "decision_context_unavailable", message: "Decision context is unavailable for the selected membership.", source: "contract" }];
  if (membership.research.status !== "available") limitations.push({ kind: "missing_research", message: "Research facts are missing for this selected candidate membership.", source: "repository_local_fact" });
  if (membership.quote.status === "unavailable") limitations.push({ kind: "missing_quote", message: "Persisted quote facts are missing for this selected candidate membership.", source: "repository_local_fact" });
  if (membership.quote.status === "stale") limitations.push({ kind: "stale_quote", message: "Persisted quote facts are stale and must be reviewed as a limitation.", source: "repository_local_fact", observedAt: membership.quote.fetchedAt });
  if (context.quote.status === "unavailable" || context.research.status === "unavailable") limitations.push({ kind: "decision_context_unavailable", message: "Decision context has unavailable quote or research facts.", source: "repository_local_fact", observedAt: context.generatedAt });
  if (intake.review.status === "review_required") limitations.push({ kind: "review_required", message: intake.review.message, source: "repository_local_fact", observedAt: intake.review.latestDecisionCheckedAt });
  else limitations.push({ kind: "human_check_pending", message: "A human check remains required before any local decision record can be created.", source: "contract" });
  return limitations;
}

function allowedContinuationsFromIntake(intake: CandidateDecisionIntakeEnvelope): AssistAdvisoryScopeAllowedContinuation[] {
  const result: AssistAdvisoryScopeAllowedContinuation[] = ["view_candidate", "stop_due_to_unavailable_facts"];
  if (intake.decisionContext) result.splice(1, 0, "view_decision_context");
  if (intake.nextAction.state === "ready_for_human_check") result.splice(2, 0, "complete_human_check");
  if (intake.review.status === "review_required") result.splice(2, 0, "inspect_post_decision_review");
  result.splice(result.length - 1, 0, "view_pingan_historical_context");
  return [...new Set(result)];
}

function reviewFromIntake(intake: CandidateDecisionIntakeEnvelope): AssistAdvisoryScopeReview {
  if (intake.review.status === "review_required") return { status: "requires_inspection", message: intake.review.message, latestReviewedAt: intake.review.latestReviewedAt };
  if (intake.review.latestReviewId) return { status: "complete", message: intake.review.message, latestReviewedAt: intake.review.latestReviewedAt };
  return { status: intake.nextAction.state === "ready_for_human_check" ? "pending_human_check" : "not_started", message: intake.review.message, latestReviewedAt: null };
}

function decisionFactStatus(nextAction: CandidateDecisionIntakeNextAction): AssistAdvisoryScopeFactStatus { return nextAction === "ready_for_human_check" ? "ready_for_human_review" : nextAction === "unavailable" ? "decision_context_limited" : nextAction; }
function quoteFactStatus(membership: CandidateMembershipData): AssistAdvisoryScopeFactStatus { return membership.quote.status === "fresh" ? "ready_for_human_review" : membership.quote.status === "stale" ? "quote_stale" : "quote_missing"; }
function decisionContextFactStatus(context: DecisionContextEnvelope): AssistAdvisoryScopeFactStatus { return context.quote.status === "unavailable" || context.research.status === "unavailable" ? "decision_context_limited" : "ready_for_human_review"; }
function safetyProof(): AssistAdvisoryScopeEnvelope["safety"] { return { advisoryOnly: true, noRecommendation: true, noRanking: true, noScoring: true, noTrading: true, noOrders: true, noBroker: true, noPortfolioMutation: true, noCashMutation: true, noFeeMutation: true, noPositionMutation: true, noProductionClaim: true, portfolioProvenance: "omitted" }; }
