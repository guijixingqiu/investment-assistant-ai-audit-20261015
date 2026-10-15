import type { AiUpdateSuggestionData } from "../../../../packages/contracts/src/research.js";

export class IdempotencyConflictError extends Error {
  constructor(message = "idempotency key already used with a different decision-check payload") {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export class ContextMismatchError extends Error {
  constructor(message = "decision context changed; refresh the context before submitting this human check") {
    super(message);
    this.name = "ContextMismatchError";
  }
}

export class FixtureDecisionContextError extends Error {
  constructor(message = "fixture decision context cannot create a formal decision") {
    super(message);
    this.name = "FixtureDecisionContextError";
  }
}

export class DecisionSnapshotMismatchError extends Error {
  constructor(message = "decision snapshot facts changed or do not match the authorized read facts; refresh before submitting this human check") {
    super(message);
    this.name = "DecisionSnapshotMismatchError";
  }
}

export class ConditionalDecisionMismatchError extends Error {
  constructor(message = "conditional decision preview changed or no longer matches authoritative facts; refresh before submitting") {
    super(message);
    this.name = "ConditionalDecisionMismatchError";
  }
}

export class PostDecisionPortfolioReviewMismatchError extends Error {
  constructor(message = "post-decision portfolio review facts changed or do not match the authorized read facts; refresh before submitting this review") {
    super(message);
    this.name = "PostDecisionPortfolioReviewMismatchError";
  }
}

export class AnnualReviewLearningMismatchError extends Error {
  constructor(message = "review-learning identities or authoritative current facts do not match the preserved conditional decision; refresh before submitting this review") {
    super(message);
    this.name = "AnnualReviewLearningMismatchError";
  }
}

export class PostDecisionReviewChronologyError extends Error {
  constructor(message = "reviewedAt must be on or after the decision check and no later than the current time") {
    super(message);
    this.name = "PostDecisionReviewChronologyError";
  }
}

export class DailyTrackingReviewMismatchError extends Error {
  constructor(message = "daily-tracking review binding or authoritative current report facts changed; refresh before submitting this review") {
    super(message);
    this.name = "DailyTrackingReviewMismatchError";
  }
}

export class StockFactUnavailableError extends Error {
  constructor(message = "stock fact is unavailable; decision check cannot create or modify stock facts") {
    super(message);
    this.name = "StockFactUnavailableError";
  }
}

export class DecisionCheckNotFoundError extends Error {
  constructor(message = "decision check was not found for the authenticated actor and symbol") {
    super(message);
    this.name = "DecisionCheckNotFoundError";
  }
}

export class SymbolMismatchError extends Error {
  constructor(message = "decision check does not belong to the requested symbol") {
    super(message);
    this.name = "SymbolMismatchError";
  }
}

export class CandidateMembershipConflictError extends Error {
  constructor(message = "candidate membership conflicts with current state or idempotency history") {
    super(message);
    this.name = "CandidateMembershipConflictError";
  }
}

export class CandidateMembershipNotFoundError extends Error {
  constructor(message = "candidate membership was not found for the authenticated actor") {
    super(message);
    this.name = "CandidateMembershipNotFoundError";
  }
}

export class CandidateMembershipVersionConflictError extends Error {
  constructor(message = "candidate membership version is stale; refresh before updating state") {
    super(message);
    this.name = "CandidateMembershipVersionConflictError";
  }
}

export class CandidateMembershipRepositoryUnavailableError extends Error {
  constructor(message = "candidate membership repository is unavailable") {
    super(message);
    this.name = "CandidateMembershipRepositoryUnavailableError";
  }
}

export class DeepResearchGateError extends Error {
  readonly failures: string[];

  constructor(message: string, failures: string[] = []) {
    super(message);
    this.name = "DeepResearchGateError";
    this.failures = failures;
  }
}

export class ResearchDocumentError extends Error {
  readonly statusCode: 400 | 404 | 409 | 413 | 415 | 422 | 503;
  readonly code: string;

  constructor(statusCode: ResearchDocumentError["statusCode"], code: string, message: string) {
    super(message);
    this.name = "ResearchDocumentError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ResearchFundamentalError extends Error {
  readonly statusCode: 400 | 404 | 409 | 422 | 503;
  readonly code: string;

  constructor(statusCode: ResearchFundamentalError["statusCode"], code: string, message: string) {
    super(message);
    this.name = "ResearchFundamentalError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ResearchValuationScenarioError extends Error {
  readonly statusCode: 400 | 404 | 409 | 422 | 503;
  readonly code: string;

  constructor(statusCode: ResearchValuationScenarioError["statusCode"], code: string, message: string) {
    super(message);
    this.name = "ResearchValuationScenarioError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface AuthenticatedResearchActor {
  actorType: "user" | "system";
  actorId: string;
}

export interface ResearchFixtureSeedResult {
  symbol: string;
  suggestionId: string;
  replayed: boolean;
  source: {
    actorType: "user" | "system";
    actorId: string;
    correlationId: string;
  };
  provenance: {
    fixture: true;
    fixtureKey: string;
    fixtureVersion: string;
    classification: "controlled_test_fixture";
    autoApply: false;
  };
}

export interface AiSuggestionDecisionResult {
  decisionId: string;
  idempotencyKey: string;
  replayed: boolean;
  source: {
    actorType: "user" | "system";
    actorId: string;
    correlationId: string;
  };
  suggestion: AiUpdateSuggestionData;
}
