import type { CandidateMembershipData } from "./candidateMembership.js";
import type { FactMetadata } from "./factMetadata.js";
import {
  CANDIDATE_MEMBERSHIP_SCHEMA_VERSION,
  validateCandidateMembershipEnvelope
} from "./candidateMembership.js";
import {
  validateDecisionContextEnvelope,
  type DecisionContextEnvelope
} from "./decisionContextBrowser.js";
import { validateFactMetadataInto } from "./factMetadata.js";
import { areInstantsChronologicallyOrdered } from "./chronology.js";

export const CANDIDATE_DECISION_INTAKE_SCHEMA_VERSION = "2026-07-04.core-1e.candidate-decision-intake.v1";

export const CANDIDATE_DECISION_INTAKE_STATUSES = ["available", "not_found", "unavailable"] as const;
export const CANDIDATE_DECISION_INTAKE_NEXT_ACTIONS = [
  "ready_for_human_check",
  "membership_archived",
  "research_missing",
  "quote_missing",
  "quote_stale",
  "review_required",
  "unavailable"
] as const;

export type CandidateDecisionIntakeStatus = (typeof CANDIDATE_DECISION_INTAKE_STATUSES)[number];
export type CandidateDecisionIntakeNextAction = (typeof CANDIDATE_DECISION_INTAKE_NEXT_ACTIONS)[number];

export interface CandidateDecisionIntakeReviewState {
  status: "none" | "review_required";
  latestDecisionCheckId: string | null;
  latestDecisionCheckedAt: string | null;
  latestReviewId: string | null;
  latestReviewedAt: string | null;
  message: string;
}

export interface CandidateDecisionIntakeEnvelope {
  schemaVersion: typeof CANDIDATE_DECISION_INTAKE_SCHEMA_VERSION;
  generatedAt: string;
  status: CandidateDecisionIntakeStatus;
  membershipId: string;
  requestedActorId: string;
  requestedSymbol: string | null;
  message: string;
  provenance: {
    membership: "candidate_memberships";
    research: "research_profiles" | "missing" | "unavailable";
    quotes: "persisted_market_quotes" | "unavailable";
    decisionContext: "decision_context_join" | "unavailable";
    reviews: "pre_trade_decision_checks_post_decision_reviews" | "unavailable";
    portfolio: "omitted";
  };
  metadata: FactMetadata;
  nextAction: {
    state: CandidateDecisionIntakeNextAction;
    reason: string;
    advisoryOnly: true;
  };
  membership: CandidateMembershipData | null;
  decisionContext: DecisionContextEnvelope | null;
  review: CandidateDecisionIntakeReviewState;
  safety: {
    createsOrder: false;
    createsTrade: false;
    mutatesCash: false;
    writesFee: false;
    mutatesPosition: false;
    callsBroker: false;
  };
}

export function validateCandidateDecisionIntakeEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["envelope must be an object"] };
  if (value.schemaVersion !== CANDIDATE_DECISION_INTAKE_SCHEMA_VERSION) errors.push(`schemaVersion must be ${CANDIDATE_DECISION_INTAKE_SCHEMA_VERSION}`);
  requireIsoTimestamp(value.generatedAt, "generatedAt", errors);
  if (!CANDIDATE_DECISION_INTAKE_STATUSES.includes(value.status as CandidateDecisionIntakeStatus)) errors.push("status must be available, not_found, or unavailable");
  requireNonEmptyString(value.membershipId, "membershipId", errors);
  requireNonEmptyString(value.requestedActorId, "requestedActorId", errors);
  if (!(typeof value.requestedSymbol === "string" || value.requestedSymbol === null)) errors.push("requestedSymbol must be a string or null");
  if (typeof value.message !== "string") errors.push("message must be a string");
  validateProvenance(value.provenance, errors);
  validateFactMetadataInto(value.metadata, "metadata", errors);
  if (isRecord(value.metadata)) {
    if (value.status === "available" && value.metadata.freshness !== "fresh") errors.push("metadata.freshness must be fresh when candidate decision-intake is available");
    if (value.status === "not_found" && value.metadata.freshness !== "missing") errors.push("metadata.freshness must be missing when candidate decision-intake is not_found");
    if (value.status === "unavailable" && value.metadata.freshness === "fresh") errors.push("metadata.freshness must not be fresh when candidate decision-intake is unavailable");
    if (value.metadata.provenance !== "real" && value.metadata.provenance !== "unavailable") errors.push("metadata.provenance must be real or unavailable for candidate decision-intake");
    if (value.metadata.authority !== "decision_context" && value.metadata.authority !== "unavailable") errors.push("metadata.authority must be decision_context or unavailable for candidate decision-intake");
    if (value.status === "available" && !areInstantsChronologicallyOrdered([value.metadata.asOf, value.metadata.fetchedAt, value.generatedAt])) errors.push("available intake metadata must not be after generatedAt");
  }
  validateNextAction(value.nextAction, errors);
  validateReview(value.review, errors);
  validateSafety(value.safety, errors);
  if (value.status === "available") {
    if (!isRecord(value.membership)) errors.push("available status requires membership");
    if (!isRecord(value.decisionContext)) errors.push("available status requires decisionContext");
    validateAvailableMembership(value.membership, value.generatedAt, errors);
    validateAvailableDecisionContext(value.decisionContext, errors);
    validateAvailableIdentity(value, errors);
  }
  if (value.status !== "available") {
    if (value.membership !== null) errors.push("non-available status must not return membership");
    if (value.decisionContext !== null) errors.push("non-available status must not return decisionContext");
    if (isRecord(value.nextAction) && value.nextAction.state !== "unavailable") {
      errors.push("non-available status requires unavailable nextAction");
    }
  }
  if (value.status === "not_found" && (!isRecord(value.nextAction) || value.nextAction.state !== "unavailable")) {
    errors.push("not_found status requires unavailable nextAction");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateProvenance(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("provenance must be an object");
    return;
  }
  if (value.membership !== "candidate_memberships") errors.push("provenance.membership must be candidate_memberships");
  if (!["research_profiles", "missing", "unavailable"].includes(String(value.research))) errors.push("provenance.research is invalid");
  if (!["persisted_market_quotes", "unavailable"].includes(String(value.quotes))) errors.push("provenance.quotes is invalid");
  if (!["decision_context_join", "unavailable"].includes(String(value.decisionContext))) errors.push("provenance.decisionContext is invalid");
  if (!["pre_trade_decision_checks_post_decision_reviews", "unavailable"].includes(String(value.reviews))) errors.push("provenance.reviews is invalid");
  if (value.portfolio !== "omitted") errors.push("provenance.portfolio must be omitted");
}

function validateNextAction(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("nextAction must be an object");
    return;
  }
  if (!CANDIDATE_DECISION_INTAKE_NEXT_ACTIONS.includes(value.state as CandidateDecisionIntakeNextAction)) errors.push("nextAction.state is invalid");
  requireNonEmptyString(value.reason, "nextAction.reason", errors);
  if (value.advisoryOnly !== true) errors.push("nextAction.advisoryOnly must be true");
}

function validateReview(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("review must be an object");
    return;
  }
  if (value.status !== "none" && value.status !== "review_required") errors.push("review.status must be none or review_required");
  validateOptionalString(value.latestDecisionCheckId, "review.latestDecisionCheckId", errors);
  validateOptionalIso(value.latestDecisionCheckedAt, "review.latestDecisionCheckedAt", errors);
  validateOptionalString(value.latestReviewId, "review.latestReviewId", errors);
  validateOptionalIso(value.latestReviewedAt, "review.latestReviewedAt", errors);
  if (typeof value.message !== "string") errors.push("review.message must be a string");
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("safety must be an object");
    return;
  }
  for (const key of ["createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker"]) {
    if (value[key] !== false) errors.push(`safety.${key} must be false`);
  }
}

function validateAvailableMembership(value: unknown, generatedAt: unknown, errors: string[]): void {
  if (!isRecord(value)) return;
  const validation = validateCandidateMembershipEnvelope({
    schemaVersion: CANDIDATE_MEMBERSHIP_SCHEMA_VERSION,
    generatedAt,
    status: "available",
    includeArchived: true,
    message: "Validate candidate decision-intake membership identity.",
    provenance: {
      memberships: "candidate_memberships",
      research: "research_profiles_optional",
      quotes: "persisted_market_quotes_optional",
      portfolio: "omitted"
    },
    metadata: {
      source: "candidate_memberships",
      asOf: generatedAt,
      fetchedAt: generatedAt,
      freshness: "fresh",
      provenance: "real",
      authority: "candidate_membership",
      stale: false,
      missing: false,
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message: "Internal candidate membership validation metadata."
    },
    memberships: [value]
  });
  if (!validation.ok) {
    errors.push(...validation.errors.map((error) => `membership.${error}`));
  }
}

function validateAvailableDecisionContext(value: unknown, errors: string[]): void {
  if (!isRecord(value)) return;
  const validation = validateDecisionContextEnvelope(value);
  if (!validation.ok) {
    errors.push(...validation.errors.map((error) => `decisionContext.${error}`));
  }
}

function validateAvailableIdentity(value: Record<string, unknown>, errors: string[]): void {
  const membership = value.membership;
  const decisionContext = value.decisionContext;
  if (!isRecord(membership) || !isRecord(decisionContext)) return;
  const requestedSymbol = typeof value.requestedSymbol === "string" ? value.requestedSymbol : null;
  if (value.membershipId !== membership.id) errors.push("membershipId must match membership.id");
  if (value.requestedActorId !== membership.actorId) errors.push("requestedActorId must match membership.actorId");
  if (requestedSymbol !== membership.symbol) errors.push("requestedSymbol must match membership.symbol");
  if (decisionContext.requestedSymbol !== requestedSymbol) errors.push("decisionContext.requestedSymbol must match requestedSymbol");
  const membershipQuote = isRecord(membership.quote) ? membership.quote : null;
  if (membershipQuote && membershipQuote.fetchedAt !== null && !areInstantsChronologicallyOrdered([membershipQuote.fetchedAt, value.generatedAt])) errors.push("membership quote fetchedAt must not be after intake generatedAt");
  if (!areInstantsChronologicallyOrdered([decisionContext.generatedAt, value.generatedAt])) errors.push("decisionContext.generatedAt must not be after intake generatedAt");
  validateNestedDecisionContextIdentity(decisionContext, membership, errors);
}

function validateNestedDecisionContextIdentity(
  decisionContext: Record<string, unknown>,
  membership: Record<string, unknown>,
  errors: string[]
): void {
  const quote = isRecord(decisionContext.quote) ? decisionContext.quote : null;
  const research = isRecord(decisionContext.research) ? decisionContext.research : null;
  validateMarketCodeSymbol(quote?.data, membership, "decisionContext.quote.data", errors);
  validateMarketCodeSymbol(research?.profile, membership, "decisionContext.research.profile", errors);
}

function validateMarketCodeSymbol(value: unknown, membership: Record<string, unknown>, label: string, errors: string[]): void {
  if (value === null || value === undefined) return;
  if (!isRecord(value)) return;
  if (value.market !== membership.market || value.code !== membership.code || value.symbol !== membership.symbol) {
    errors.push(`${label} identity must match membership market, code, and symbol`);
  }
}

function validateOptionalString(value: unknown, field: string, errors: string[]): void {
  if (!(typeof value === "string" || value === null)) errors.push(`${field} must be a string or null`);
}

function validateOptionalIso(value: unknown, field: string, errors: string[]): void {
  if (value === null) return;
  requireIsoTimestamp(value, field, errors);
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${field} must be a non-empty string`);
}

function requireIsoTimestamp(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) errors.push(`${field} must be a valid date-time`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
