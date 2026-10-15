import type { Pool, PoolClient } from "pg";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import type { CandidateMembershipData } from "../../../../packages/contracts/src/candidateMembership.js";
import type { CandidateDecisionIntakeEnvelope, CandidateDecisionIntakeNextAction, CandidateDecisionIntakeReviewState } from "../../../../packages/contracts/src/candidateDecisionIntake.js";
import { CANDIDATE_DECISION_INTAKE_SCHEMA_VERSION, validateCandidateDecisionIntakeEnvelope } from "../../../../packages/contracts/src/candidateDecisionIntake.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { rowToCandidateMembership } from "./candidateMembershipMappers.js";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import { readDecisionContextEnvelope } from "./decisionContextRepository.js";
import type { DecisionQuantEvidenceOptions } from "./quantEvidenceSource.js";

interface CandidateDecisionCheckReviewRow {
  id: string;
  checked_at: Date | string;
  latest_review_id: string | null;
  latest_reviewed_at: Date | string | null;
}

/**
 * Fail-closed candidate decision-intake envelope (the existing intake error
 * helper). Routes that answer with the existing intake contract reuse this
 * instead of introducing a second response contract.
 */
export function candidateDecisionIntakeFailClosedEnvelope(
  generatedAt: string,
  membershipId: string,
  actorId: string,
  message: string,
  status: "not_found" | "unavailable" = "unavailable"
): CandidateDecisionIntakeEnvelope {
  return unavailable(generatedAt, membershipId, actorId, message, status);
}

export async function readCandidateDecisionIntakeEnvelope(
  pool: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  liveMaxAgeSeconds: number,
  now = new Date(),
  quantEvidence: DecisionQuantEvidenceOptions | null = null
): Promise<CandidateDecisionIntakeEnvelope> {
  const generatedAt = now.toISOString();
  if (!/^[1-9]\d*$/.test(membershipId)) return unavailable(generatedAt, membershipId, actor.actorId, "candidate membership id must be a positive integer", "not_found");
  try {
    const row = await readCandidateMembershipById(pool, actor, membershipId);
    if (!row) return unavailable(generatedAt, membershipId, actor.actorId, "Candidate membership was not found for this actor.", "not_found");
    const membership = rowToCandidateMembership(row, liveMaxAgeSeconds, now);
    const decisionContext = await readDecisionContextEnvelope(pool, membership.market, membership.code, liveMaxAgeSeconds, now, quantEvidence);
    const review = await readReviewState(pool, membership, actor);
    const envelope: CandidateDecisionIntakeEnvelope = {
      schemaVersion: CANDIDATE_DECISION_INTAKE_SCHEMA_VERSION,
      generatedAt,
      status: "available",
      membershipId,
      requestedActorId: actor.actorId,
      requestedSymbol: membership.symbol,
      message: "Candidate decision intake joins existing factual records only and does not rank, recommend, create orders, or mutate portfolio facts.",
      provenance: {
        membership: "candidate_memberships",
        research: membership.research.status === "available" ? "research_profiles" : "missing",
        quotes: membership.quote.status === "unavailable" ? "unavailable" : "persisted_market_quotes",
        decisionContext: "decision_context_join",
        reviews: "pre_trade_decision_checks_post_decision_reviews",
        portfolio: "omitted"
      },
      metadata: metadata(generatedAt, "available", "Candidate decision-intake metadata is fresh local decision-context entry context only, not recommendation, portfolio, broker, or trading authority."),
      nextAction: nextAction(membership, review),
      membership,
      decisionContext,
      review,
      safety: noTradingSafety()
    };
    return validateCandidateDecisionIntakeEnvelope(envelope).ok
      ? envelope
      : unavailable(generatedAt, membershipId, actor.actorId, "Assembled candidate decision-intake failed contract validation before response.", "unavailable");
  } catch {
    return unavailable(generatedAt, membershipId, actor.actorId, "Candidate decision intake repository is unavailable.", "unavailable");
  }
}

async function readReviewState(pool: Pick<Pool | PoolClient, "query">, membership: CandidateMembershipData, actor: AuthenticatedResearchActor): Promise<CandidateDecisionIntakeReviewState> {
  const checks = await pool.query<CandidateDecisionCheckReviewRow>(
    `select checks.id, checks.checked_at, latest_review.id as latest_review_id, latest_review.reviewed_at as latest_reviewed_at
       from pre_trade_decision_checks checks
       left join lateral (
         select review.id, review.reviewed_at from post_decision_reviews review
          where review.decision_check_id = checks.id
            and review.deleted_at is null
            and review.actor_type = $3
            and review.actor_id is not distinct from $4
          order by review.reviewed_at desc, review.created_at desc, review.id desc limit 1
       ) latest_review on true
      where checks.market = $1 and checks.code = $2
        and checks.deleted_at is null
        and exists (
          select 1 from research_write_audit_events audit
           where audit.event_type = 'decision_check_created'
             and audit.target_table = 'pre_trade_decision_checks'
             and audit.target_id = checks.id::text
             and audit.actor_type = $3
             and audit.actor_id is not distinct from $4
        )
      order by checks.checked_at desc, checks.id desc limit 1`,
    [membership.market, membership.code, actor.actorType, actor.actorId]
  );
  const latest = checks.rows[0];
  if (!latest) return { status: "none", latestDecisionCheckId: null, latestDecisionCheckedAt: null, latestReviewId: null, latestReviewedAt: null, message: "No prior actor-scoped decision check requires post-decision review." };
  const reviewedAt = latest.latest_reviewed_at ? new Date(latest.latest_reviewed_at).toISOString() : null;
  return {
    status: reviewedAt ? "none" : "review_required",
    latestDecisionCheckId: String(latest.id),
    latestDecisionCheckedAt: new Date(latest.checked_at).toISOString(),
    latestReviewId: latest.latest_review_id ? String(latest.latest_review_id) : null,
    latestReviewedAt: reviewedAt,
    message: reviewedAt ? "Latest actor-scoped decision check has a post-decision review." : "Latest actor-scoped decision check requires post-decision review before a new intake is ready."
  };
}

function nextAction(membership: CandidateMembershipData, review: CandidateDecisionIntakeReviewState): CandidateDecisionIntakeEnvelope["nextAction"] {
  let state: CandidateDecisionIntakeNextAction = "ready_for_human_check";
  let reason = "Membership, research, quote, decision context, and review facts are available for human pre-trade checking.";
  if (membership.state === "archived") { state = "membership_archived"; reason = "Archived candidate memberships are not ready for a new human check."; }
  else if (membership.research.status !== "available") { state = "research_missing"; reason = "Research profile facts are missing for this candidate membership."; }
  else if (membership.quote.status === "unavailable") { state = "quote_missing"; reason = "Persisted quote facts are missing for this candidate membership."; }
  else if (membership.quote.status === "stale") { state = "quote_stale"; reason = "Persisted quote facts are stale for this candidate membership."; }
  else if (review.status === "review_required") { state = "review_required"; reason = "A prior actor-scoped decision check exists without a post-decision review."; }
  return { state, reason, advisoryOnly: true };
}

function unavailable(generatedAt: string, membershipId: string, actorId: string, message: string, status: "not_found" | "unavailable"): CandidateDecisionIntakeEnvelope {
  return {
    schemaVersion: CANDIDATE_DECISION_INTAKE_SCHEMA_VERSION, generatedAt, status, membershipId, requestedActorId: actorId, requestedSymbol: null, message,
    provenance: { membership: "candidate_memberships", research: "unavailable", quotes: "unavailable", decisionContext: "unavailable", reviews: "unavailable", portfolio: "omitted" },
    metadata: metadata(generatedAt, status, message),
    nextAction: { state: "unavailable", reason: message, advisoryOnly: true }, membership: null, decisionContext: null,
    review: { status: "none", latestDecisionCheckId: null, latestDecisionCheckedAt: null, latestReviewId: null, latestReviewedAt: null, message },
    safety: noTradingSafety()
  };
}

function noTradingSafety(): CandidateMembershipData["safety"] { return { createsOrder: false, createsTrade: false, mutatesCash: false, writesFee: false, mutatesPosition: false, callsBroker: false }; }
function metadata(generatedAt: string, status: CandidateDecisionIntakeEnvelope["status"], message: string) {
  return makeFactMetadata({ source: "candidate_decision_intake", asOf: generatedAt, fetchedAt: generatedAt, freshness: status === "available" ? "fresh" : status === "not_found" ? "missing" : "unavailable", provenance: status === "unavailable" ? "unavailable" : "real", authority: status === "unavailable" ? "unavailable" : "decision_context", stale: false, missing: status === "not_found", conflict: false, fixture: false, correctionOf: null, replaces: null, message });
}
