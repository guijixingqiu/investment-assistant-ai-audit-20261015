import { DECISION_CONTEXT_SCHEMA_VERSION, type CreatePreTradeDecisionCheckRequest, type DecisionContextEnvelope, type HumanCheckResult, type PreTradeDecisionCheckData } from "../../../packages/contracts/src/decisionContextBrowser.js";
import { validateAssistAdvisoryScopeEnvelope, type AssistAdvisoryScopeEnvelope } from "../../../packages/contracts/src/assistAdvisoryScopeBrowser.js";
import { validateAssistHumanReviewWorkspaceEnvelope, type AssistHumanReviewWorkspaceEnvelope } from "../../../packages/contracts/src/assistHumanReviewWorkspaceBrowser.js";
import { validateAssistReviewFollowUpWorkflowEnvelope, type AssistReviewFollowUpWorkflowEnvelope } from "../../../packages/contracts/src/assistReviewFollowUpWorkflowBrowser.js";
import { validateAssistDecisionNoteWorkflowEnvelope, type AssistDecisionNoteWorkflowEnvelope } from "../../../packages/contracts/src/assistDecisionNoteWorkflowBrowser.js";
import { validateCandidateDecisionIntakeEnvelope, type CandidateDecisionIntakeEnvelope } from "../../../packages/contracts/src/candidateDecisionIntake.js";
import type { CandidateOverviewEnvelope } from "../../../packages/contracts/src/candidateOverview.js";
import type { CandidateMembershipEnvelope, CandidateMembershipState, CandidateMembershipWriteEnvelope, CreateCandidateMembershipRequest, UpdateCandidateMembershipStateRequest } from "../../../packages/contracts/src/candidateMembership.js";
import type { DecisionActionIntent } from "../../../packages/contracts/src/research.js";
import type { CreatePostDecisionReviewRequest, DecisionReviewOutcome, DecisionReviewHistoryEnvelope, PostDecisionReviewData } from "../../../packages/contracts/src/decisionReview.js";
import type { MarketQuoteEnvelope } from "../../../packages/contracts/src/market.js";
import type { PinganSnapshotEnvelope } from "../../../packages/contracts/src/portfolioSnapshot.js";
import {
  validatePortfolioDecisionContextForBrowser,
  validatePortfolioRiskImpactBindingForBrowser,
  validatePortfolioRiskImpactForBrowser,
  type PortfolioDecisionContextEnvelope,
  type PortfolioRiskImpactEnvelope
} from "../../../packages/contracts/src/portfolioDecisionContextBrowser.js";
import type { ResearchProfileEnvelope } from "../../../packages/contracts/src/research.js";
import { validateDecisionSnapshotStateForBrowser } from "../../../packages/contracts/src/decisionSnapshotBrowser.js";
import type { DecisionSnapshotBinding } from "../../../packages/contracts/src/decisionSnapshotContract.js";
import type { ResearchReportDecisionBinding } from "../../../packages/contracts/src/researchReportDecision.js";
import type { AnnualConditionalDecisionSubmission } from "../../../packages/contracts/src/annualConditionalDecisionContract.js";
import type { AnnualReviewLearningRequest } from "../../../packages/contracts/src/annualReviewLearning.js";
import type { FormalOwnerDecisionInput } from "../../../packages/contracts/src/formalDecision.js";
import {
  validatePostDecisionPortfolioReviewStateForBrowser,
  type PostDecisionPortfolioReviewBinding
} from "../../../packages/contracts/src/postDecisionPortfolioReviewBrowser.js";
import { validateCandidateMemberships, validateCandidateMembershipWrite, validateCandidateOverview, validateDecisionCheckWriteEnvelope, validateDecisionContext, validatePostDecisionReview, validatePostDecisionReviewWriteEnvelope, validateQuote, validateResearch, validateReviewHistory, validatePinganSnapshotStrict } from "./contractValidation.js";
import {
  decisionContextAvailabilityFailure, memberScopedResponseMatches,
  quantDecisionEvidenceValidationFailure,
  quoteResearchAvailabilityFailure,
  validateJourneyIdentity,
  validateReviewHistoryDecisionSnapshots,
  type WebFailureState
} from "./decisionJourneyIngress.js";
import type { CanonicalSecuritySymbol } from "./securitySymbol.js";
import { validateSubmittedDecisionResponse, validateSubmittedReviewLearning } from "./investmentControlConsoleResponseValidation.js";
export type { WebFailureState } from "./decisionJourneyIngress.js";

export type WebJourneyResponse =
  | { ok: true; quote: MarketQuoteEnvelope; research: ResearchProfileEnvelope; decisionContext: DecisionContextEnvelope; pingan: PinganSnapshotEnvelope; reviewHistory: DecisionReviewHistoryEnvelope }
  | { ok: false; state: WebFailureState; reason: string };
export type WebDecisionReviewHistoryResponse =
  | { ok: true; value: DecisionReviewHistoryEnvelope }
  | { ok: false; state: WebFailureState; reason: string };
export type WebCandidateOverviewResponse =
  | { ok: true; value: CandidateOverviewEnvelope }
  | { ok: false; state: WebFailureState; reason: string };

export type WebCandidateMembershipResponse =
  | { ok: true; value: CandidateMembershipEnvelope }
  | { ok: false; state: WebFailureState; reason: string };

export type WebCandidateMembershipWriteResponse =
  | { ok: true; value: CandidateMembershipWriteEnvelope }
  | { ok: false; state: WebFailureState; reason: string };

export type WebCandidateDecisionIntakeResponse =
  | { ok: true; value: CandidateDecisionIntakeEnvelope }
  | { ok: false; state: WebFailureState; reason: string };

export type WebAssistAdvisoryScopeResponse =
  | { ok: true; value: AssistAdvisoryScopeEnvelope }
  | { ok: false; state: WebFailureState; reason: string };

export type WebAssistHumanReviewWorkspaceResponse =
  | { ok: true; value: AssistHumanReviewWorkspaceEnvelope }
  | { ok: false; state: WebFailureState; reason: string };

export type WebAssistReviewFollowUpWorkflowResponse =
  | { ok: true; value: AssistReviewFollowUpWorkflowEnvelope }
  | { ok: false; state: WebFailureState; reason: string };

export type WebAssistDecisionNoteWorkflowResponse =
  | { ok: true; value: AssistDecisionNoteWorkflowEnvelope }
  | { ok: false; state: WebFailureState; reason: string };

export type WebPortfolioDecisionContextResponse =
  | { ok: true; value: PortfolioDecisionContextEnvelope }
  | { ok: false; state: WebFailureState; reason: string };

export type WebPortfolioRiskImpactResponse =
  | { ok: true; value: PortfolioRiskImpactEnvelope }
  | { ok: false; state: WebFailureState; reason: string };

export interface WebApiAuth {
  headerName: string;
  token: string;
}

export function sameWebApiAuth(left: WebApiAuth | null, right: WebApiAuth | null): boolean {
  if (!left || !right) return left === right;
  return left.headerName.trim().toLowerCase() === right.headerName.trim().toLowerCase()
    && left.token === right.token;
}

export class WebApiClient {
  private journeyGeneration = 0;
  private journeyController: AbortController | null = null;
  private candidateOverviewGeneration = 0;
  private candidateOverviewController: AbortController | null = null;
  private candidateMembershipGeneration = 0;
  private candidateMembershipController: AbortController | null = null;
  private candidateDecisionIntakeGeneration = 0;
  private candidateDecisionIntakeController: AbortController | null = null;
  private assistAdvisoryScopeGeneration = 0;
  private assistAdvisoryScopeController: AbortController | null = null;
  private assistHumanReviewWorkspaceGeneration = 0;
  private assistHumanReviewWorkspaceController: AbortController | null = null;
  private assistReviewFollowUpWorkflowGeneration = 0;
  private assistReviewFollowUpWorkflowController: AbortController | null = null;
  private assistDecisionNoteWorkflowGeneration = 0;
  private assistDecisionNoteWorkflowController: AbortController | null = null;
  private checkRetry: RetryRecord | null = null;
  private reviewRetry: RetryRecord | null = null;
  private membershipCreateRetry: RetryRecord | null = null;
  private membershipStateRetry: RetryRecord | null = null;
  private lastReviewedAtMs = 0;
  async loadJourney(symbol: CanonicalSecuritySymbol, auth: WebApiAuth | null): Promise<WebJourneyResponse> {
    const generation = this.nextJourneyGeneration();
    const signal = this.journeyController?.signal ?? null;
    try {
      const [quote, research, decisionContext, pingan, reviewHistory] = await Promise.all([
        this.fetchJsonPreservingValidFailure(`/api/mobile/market/quotes/${symbol.market}/${symbol.code}`, null, signal, (value) => validateQuote(value).ok),
        this.fetchJsonPreservingValidFailure(`/api/mobile/research/profiles/${symbol.market}/${symbol.code}`, auth, signal, (value) => validateResearch(value).ok),
        this.fetchJsonPreservingValidFailure(`/api/mobile/research/decision-context/${symbol.market}/${symbol.code}`, auth, signal, (value) => validateDecisionContext(value).ok),
        this.fetchJsonPreservingValidFailure(`/api/mobile/research/portfolio/pingan-snapshot/${symbol.market}/${symbol.code}`, auth, signal, (value) => validatePinganSnapshotStrict(value, symbol.symbol).ok),
        this.fetchJsonPreservingValidFailure(`/api/mobile/research/profiles/${symbol.market}/${symbol.code}/decision-reviews`, auth, signal, (value) => validateReviewHistory(value).ok)
      ]);
      if (generation !== this.journeyGeneration) return { ok: false, state: "offline", reason: "Superseded by a newer request." };

      const quoteResult = validateQuote(quote);
      const researchResult = validateResearch(research);
      const contextResult = validateDecisionContext(decisionContext);
      const pinganResult = validatePinganSnapshotStrict(pingan, symbol.symbol);
      const reviewResult = validateReviewHistory(reviewHistory);
      if (!quoteResult.ok) return { ok: false, state: "malformed", reason: quoteResult.reason };
      if (!researchResult.ok) return { ok: false, state: "malformed", reason: researchResult.reason };
      if (!contextResult.ok) return { ok: false, state: "malformed", reason: contextResult.reason };
      if (!pinganResult.ok) return { ok: false, state: "malformed", reason: pinganResult.reason };
      if (!reviewResult.ok) return { ok: false, state: "malformed", reason: reviewResult.reason };
      const refinementFailure = await quantDecisionEvidenceValidationFailure(contextResult.value);
      if (refinementFailure) return { ok: false, state: "malformed", reason: refinementFailure };
      const reviewSnapshotValidation = await validateReviewHistoryDecisionSnapshots(reviewResult.value);
      if (!reviewSnapshotValidation.ok) return { ok: false, state: "malformed", reason: reviewSnapshotValidation.reason };
      const quoteResearchAvailability = quoteResearchAvailabilityFailure(quoteResult.value, researchResult.value);
      if (quoteResearchAvailability) return quoteResearchAvailability;
      const contextAvailability = decisionContextAvailabilityFailure(contextResult.value);
      if (contextAvailability) return contextAvailability;
      const identityResult = validateJourneyIdentity(symbol, quoteResult.value, researchResult.value, contextResult.value, reviewResult.value);
      if (!identityResult.ok) return { ok: false, state: "malformed", reason: identityResult.reason };
      return {
        ok: true,
        quote: quoteResult.value,
        research: researchResult.value,
        decisionContext: contextResult.value,
        pingan: pinganResult.value,
        reviewHistory: reviewResult.value
      };
    } catch (error) {
      if (error instanceof HttpError) return { ok: false, state: error.state, reason: error.message };
      if ((error as Error).name === "AbortError") return { ok: false, state: "offline", reason: "Request was superseded." };
      return { ok: false, state: "offline", reason: (error as Error).message };
    }
  }

  async loadDecisionReviewHistory(symbol: CanonicalSecuritySymbol, auth: WebApiAuth): Promise<WebDecisionReviewHistoryResponse> {
    try {
      const payload = await this.fetchJsonPreservingValidFailure(`/api/mobile/research/profiles/${symbol.market}/${symbol.code}/decision-reviews`, auth, null, (value) => validateReviewHistory(value).ok, "no-store");
      const validation = validateReviewHistory(payload);
      if (!validation.ok) return { ok: false, state: "malformed", reason: validation.reason };
      const snapshotValidation = await validateReviewHistoryDecisionSnapshots(validation.value);
      if (!snapshotValidation.ok) return { ok: false, state: "malformed", reason: snapshotValidation.reason };
      if (validation.value.requestedSymbol !== symbol.symbol) {
        return { ok: false, state: "malformed", reason: "review history requestedSymbol must match current symbol" };
      }
      return { ok: true, value: validation.value };
    } catch (error) {
      if (error instanceof HttpError) return { ok: false, state: error.state, reason: error.message };
      return { ok: false, state: "offline", reason: error instanceof Error ? error.message : "Network request failed." };
    }
  }

  async loadPortfolioDecisionContext(auth: WebApiAuth): Promise<WebPortfolioDecisionContextResponse> {
    try {
      const payload = await this.fetchJsonPreservingValidFailure(
        "/api/mobile/research/portfolio/pingan-current/context",
        auth,
        null,
        async (value) => {
          const validation = await validatePortfolioDecisionContextForBrowser(value);
          return validation.ok && !["available", "stale", "partial", "zero_position"].includes(validation.value.status);
        }
      );
      const validation = await validatePortfolioDecisionContextForBrowser(payload);
      return validation.ok ? { ok: true, value: validation.value } : { ok: false, state: "malformed", reason: validation.errors.join("; ") };
    } catch (error) {
      if (error instanceof HttpError) return { ok: false, state: error.state, reason: error.message };
      return { ok: false, state: "offline", reason: error instanceof Error ? error.message : "Network request failed." };
    }
  }

  async loadPortfolioRiskImpact(auth: WebApiAuth, symbol: CanonicalSecuritySymbol, hypotheticalAmount: number, context: PortfolioDecisionContextEnvelope): Promise<WebPortfolioRiskImpactResponse> {
    try {
      const query = new URLSearchParams({ symbol: symbol.symbol, hypotheticalAmount: String(hypotheticalAmount) });
      const payload = await this.fetchJsonPreservingValidFailure(
        `/api/mobile/research/portfolio/pingan-current/risk-impact?${query.toString()}`,
        auth,
        null,
        async (value) => {
          const validation = await validatePortfolioRiskImpactForBrowser(value);
          return validation.ok && validation.value.status !== "available";
        }
      );
      const validation = await validatePortfolioRiskImpactForBrowser(payload);
      if (!validation.ok) return { ok: false, state: "malformed", reason: validation.errors.join("; ") };
      if (validation.value.candidateSymbol !== symbol.symbol) return { ok: false, state: "conflict", reason: "risk impact candidateSymbol must match the selected candidate" };
      if (validation.value.hypotheticalAmount !== hypotheticalAmount) return { ok: false, state: "conflict", reason: "risk impact amount must match the user-provided amount" };
      if (validation.value.status !== "available") return { ok: true, value: validation.value };
      const binding = validatePortfolioRiskImpactBindingForBrowser(validation.value, context, symbol.symbol, hypotheticalAmount);
      if (!binding.ok) return { ok: false, state: "conflict", reason: binding.errors.join("; ") };
      return { ok: true, value: validation.value };
    } catch (error) {
      if (error instanceof HttpError) return { ok: false, state: error.state, reason: error.message };
      return { ok: false, state: "offline", reason: error instanceof Error ? error.message : "Network request failed." };
    }
  }

  async loadCandidateOverview(auth: WebApiAuth): Promise<WebCandidateOverviewResponse> {
    const generation = this.nextCandidateOverviewGeneration();
    const signal = this.candidateOverviewController?.signal ?? null;
    try {
      const payload = await this.fetchJsonPreservingValidFailure("/api/mobile/research/candidates", auth, signal, (value) => validateCandidateOverview(value).ok);
      if (generation !== this.candidateOverviewGeneration) return { ok: false, state: "offline", reason: "Superseded by a newer request." };
      const validation = validateCandidateOverview(payload);
      if (!validation.ok) return { ok: false, state: "malformed", reason: validation.reason };
      if (validation.value.status === "unavailable") {
        return { ok: false, state: "unavailable", reason: validation.value.message };
      }
      return { ok: true, value: validation.value };
    } catch (error) {
      if (error instanceof HttpError) return { ok: false, state: error.state, reason: error.message };
      if ((error as Error).name === "AbortError") return { ok: false, state: "offline", reason: "Request was superseded." };
      return { ok: false, state: "offline", reason: error instanceof Error ? error.message : "Network request failed." };
    }
  }

  async loadCandidateMemberships(auth: WebApiAuth, includeArchived: boolean): Promise<WebCandidateMembershipResponse> {
    const generation = this.nextCandidateMembershipGeneration();
    const signal = this.candidateMembershipController?.signal ?? null;
    const query = includeArchived ? "?includeArchived=true" : "";
    try {
      const payload = await this.fetchJsonPreservingValidFailure(`/api/mobile/research/candidate-memberships${query}`, auth, signal, (value) => validateCandidateMemberships(value).ok, "no-store");
      if (generation !== this.candidateMembershipGeneration) return { ok: false, state: "offline", reason: "Superseded by a newer request." };
      const validation = validateCandidateMemberships(payload);
      if (!validation.ok) return { ok: false, state: "malformed", reason: validation.reason };
      if (validation.value.status === "unavailable") {
        return { ok: false, state: "unavailable", reason: validation.value.message };
      }
      return { ok: true, value: validation.value };
    } catch (error) {
      if (error instanceof HttpError) return { ok: false, state: error.state, reason: error.message };
      if ((error as Error).name === "AbortError") return { ok: false, state: "offline", reason: "Request was superseded." };
      return { ok: false, state: "offline", reason: error instanceof Error ? error.message : "Network request failed." };
    }
  }
  async loadCandidateDecisionIntake(auth: WebApiAuth, membershipId: string): Promise<WebCandidateDecisionIntakeResponse> {
    const generation = this.nextCandidateDecisionIntakeGeneration();
    const signal = this.candidateDecisionIntakeController?.signal ?? null;
    try {
      const payload = await this.fetchJsonPreservingValidFailure(`/api/mobile/research/candidate-memberships/${encodeURIComponent(membershipId)}/decision-intake`, auth, signal, (value) => validateCandidateDecisionIntakeEnvelope(value).ok && memberScopedResponseMatches(membershipId, [(value as CandidateDecisionIntakeEnvelope).membershipId, (value as CandidateDecisionIntakeEnvelope).membership?.id]));
      if (generation !== this.candidateDecisionIntakeGeneration) return { ok: false, state: "offline", reason: "Superseded by a newer request." };
      const validation = validateCandidateDecisionIntakeEnvelope(payload);
      if (!validation.ok) return { ok: false, state: "malformed", reason: validation.errors.join("; ") };
      const envelope = payload as CandidateDecisionIntakeEnvelope;
      if (!memberScopedResponseMatches(membershipId, [envelope.membershipId, envelope.membership?.id])) return { ok: false, state: "malformed", reason: "Response membership identity must match requested membership." };
      const refinementFailure = await quantDecisionEvidenceValidationFailure(envelope.decisionContext);
      if (refinementFailure) return { ok: false, state: "malformed", reason: refinementFailure };
      if (envelope.status === "unavailable") return { ok: false, state: "unavailable", reason: envelope.message };
      if (envelope.status === "not_found") return { ok: false, state: "not_found", reason: envelope.message };
      return { ok: true, value: envelope };
    } catch (error) {
      if (error instanceof HttpError) return { ok: false, state: error.state, reason: error.message };
      if ((error as Error).name === "AbortError") return { ok: false, state: "offline", reason: "Request was superseded." };
      return { ok: false, state: "offline", reason: error instanceof Error ? error.message : "Network request failed." };
    }
  }
  async loadAssistAdvisoryScope(auth: WebApiAuth, membershipId: string): Promise<WebAssistAdvisoryScopeResponse> {
    const generation = this.nextAssistAdvisoryScopeGeneration();
    const signal = this.assistAdvisoryScopeController?.signal ?? null;
    try {
      const payload = await this.fetchJsonPreservingValidFailure(`/api/mobile/research/candidate-memberships/${encodeURIComponent(membershipId)}/advisory-scope`, auth, signal, (value) => validateAssistAdvisoryScopeEnvelope(value).ok && memberScopedResponseMatches(membershipId, [(value as AssistAdvisoryScopeEnvelope).candidateMembershipId, (value as AssistAdvisoryScopeEnvelope).target.candidateMembershipId]));
      if (generation !== this.assistAdvisoryScopeGeneration) return { ok: false, state: "offline", reason: "Superseded by a newer request." };
      const validation = validateAssistAdvisoryScopeEnvelope(payload);
      if (!validation.ok) return { ok: false, state: "malformed", reason: validation.errors.join("; ") };
      const envelope = payload as AssistAdvisoryScopeEnvelope;
      if (!memberScopedResponseMatches(membershipId, [envelope.candidateMembershipId, envelope.target.candidateMembershipId])) return { ok: false, state: "malformed", reason: "Response membership identity must match requested membership." };
      if (envelope.status === "unavailable") return { ok: false, state: "unavailable", reason: envelope.message };
      if (envelope.status === "not_found") return { ok: false, state: "not_found", reason: envelope.message };
      if (envelope.status === "unauthorized") return { ok: false, state: "unauthorized", reason: envelope.message };
      if (envelope.status === "malformed") return { ok: false, state: "malformed", reason: envelope.message };
      return { ok: true, value: envelope };
    } catch (error) {
      if (error instanceof HttpError) return { ok: false, state: error.state, reason: error.message };
      if ((error as Error).name === "AbortError") return { ok: false, state: "offline", reason: "Request was superseded." };
      return { ok: false, state: "offline", reason: error instanceof Error ? error.message : "Network request failed." };
    }
  }
  async loadAssistHumanReviewWorkspace(auth: WebApiAuth, membershipId: string): Promise<WebAssistHumanReviewWorkspaceResponse> {
    const generation = this.nextAssistHumanReviewWorkspaceGeneration();
    const signal = this.assistHumanReviewWorkspaceController?.signal ?? null;
    try {
      const payload = await this.fetchJsonPreservingValidFailure(`/api/mobile/research/candidate-memberships/${encodeURIComponent(membershipId)}/human-review-workspace`, auth, signal, (value) => validateAssistHumanReviewWorkspaceEnvelope(value).ok && memberScopedResponseMatches(membershipId, [(value as AssistHumanReviewWorkspaceEnvelope).target.candidateMembershipId, (value as AssistHumanReviewWorkspaceEnvelope).sourceEnvelopeRef.candidateMembershipId]));
      if (generation !== this.assistHumanReviewWorkspaceGeneration) return { ok: false, state: "offline", reason: "Superseded by a newer request." };
      const validation = validateAssistHumanReviewWorkspaceEnvelope(payload);
      if (!validation.ok) return { ok: false, state: "malformed", reason: validation.errors.join("; ") };
      const envelope = payload as AssistHumanReviewWorkspaceEnvelope;
      if (!memberScopedResponseMatches(membershipId, [envelope.target.candidateMembershipId, envelope.sourceEnvelopeRef.candidateMembershipId])) return { ok: false, state: "malformed", reason: "Response membership identity must match requested membership." };
      if (envelope.status === "unavailable") return { ok: false, state: "unavailable", reason: envelope.message };
      if (envelope.status === "not_found") return { ok: false, state: "not_found", reason: envelope.message };
      if (envelope.status === "unauthorized") return { ok: false, state: "unauthorized", reason: envelope.message };
      if (envelope.status === "malformed") return { ok: false, state: "malformed", reason: envelope.message };
      return { ok: true, value: envelope };
    } catch (error) {
      if (error instanceof HttpError) return { ok: false, state: error.state, reason: error.message };
      if ((error as Error).name === "AbortError") return { ok: false, state: "offline", reason: "Request was superseded." };
      return { ok: false, state: "offline", reason: error instanceof Error ? error.message : "Network request failed." };
    }
  }
  async loadAssistReviewFollowUpWorkflow(auth: WebApiAuth, membershipId: string): Promise<WebAssistReviewFollowUpWorkflowResponse> {
    const generation = this.nextAssistReviewFollowUpWorkflowGeneration();
    const signal = this.assistReviewFollowUpWorkflowController?.signal ?? null;
    try {
      const payload = await this.fetchJsonPreservingValidFailure(`/api/mobile/research/candidate-memberships/${encodeURIComponent(membershipId)}/human-review-workspace/follow-up-workflow`, auth, signal, (value) => validateAssistReviewFollowUpWorkflowEnvelope(value).ok && memberScopedResponseMatches(membershipId, [(value as AssistReviewFollowUpWorkflowEnvelope).target.candidateMembershipId]));
      if (generation !== this.assistReviewFollowUpWorkflowGeneration) return { ok: false, state: "offline", reason: "Superseded by a newer request." };
      const validation = validateAssistReviewFollowUpWorkflowEnvelope(payload);
      if (!validation.ok) return { ok: false, state: "malformed", reason: validation.errors.join("; ") };
      const envelope = payload as AssistReviewFollowUpWorkflowEnvelope;
      if (!memberScopedResponseMatches(membershipId, [envelope.target.candidateMembershipId])) return { ok: false, state: "malformed", reason: "Response membership identity must match requested membership." };
      if (envelope.status === "unavailable") return { ok: false, state: "unavailable", reason: envelope.message };
      if (envelope.status === "not_found") return { ok: false, state: "not_found", reason: envelope.message };
      if (envelope.status === "unauthorized") return { ok: false, state: "unauthorized", reason: envelope.message };
      if (envelope.status === "malformed") return { ok: false, state: "malformed", reason: envelope.message };
      return { ok: true, value: envelope };
    } catch (error) {
      if (error instanceof HttpError) return { ok: false, state: error.state, reason: error.message };
      if ((error as Error).name === "AbortError") return { ok: false, state: "offline", reason: "Request was superseded." };
      return { ok: false, state: "offline", reason: error instanceof Error ? error.message : "Network request failed." };
    }
  }
  async loadAssistDecisionNoteWorkflow(auth: WebApiAuth, membershipId: string): Promise<WebAssistDecisionNoteWorkflowResponse> {
    const generation = this.nextAssistDecisionNoteWorkflowGeneration();
    const signal = this.assistDecisionNoteWorkflowController?.signal ?? null;
    try {
      const payload = await this.fetchJsonPreservingValidFailure(`/api/mobile/research/candidate-memberships/${encodeURIComponent(membershipId)}/human-review-workspace/follow-up-workflow/decision-note-workflow`, auth, signal, (value) => validateAssistDecisionNoteWorkflowEnvelope(value).ok && memberScopedResponseMatches(membershipId, [(value as AssistDecisionNoteWorkflowEnvelope).target.candidateMembershipId]));
      if (generation !== this.assistDecisionNoteWorkflowGeneration) return { ok: false, state: "offline", reason: "Superseded by a newer request." };
      const validation = validateAssistDecisionNoteWorkflowEnvelope(payload);
      if (!validation.ok) return { ok: false, state: "malformed", reason: validation.errors.join("; ") };
      const envelope = payload as AssistDecisionNoteWorkflowEnvelope;
      if (!memberScopedResponseMatches(membershipId, [envelope.target.candidateMembershipId])) return { ok: false, state: "malformed", reason: "Response membership identity must match requested membership." };
      if (envelope.status === "unavailable") return { ok: false, state: "unavailable", reason: envelope.message };
      if (envelope.status === "not_found") return { ok: false, state: "not_found", reason: envelope.message };
      if (envelope.status === "unauthorized") return { ok: false, state: "unauthorized", reason: envelope.message };
      if (envelope.status === "malformed") return { ok: false, state: "malformed", reason: envelope.message };
      return { ok: true, value: envelope };
    } catch (error) {
      if (error instanceof HttpError) return { ok: false, state: error.state, reason: error.message };
      if ((error as Error).name === "AbortError") return { ok: false, state: "offline", reason: "Request was superseded." };
      return { ok: false, state: "offline", reason: error instanceof Error ? error.message : "Network request failed." };
    }
  }

  async createCandidateMembership(auth: WebApiAuth, payload: { code: string; initialState: "tracked" | "paused"; restoreArchived: boolean }): Promise<WebCandidateMembershipWriteResponse> {
    const fingerprint = JSON.stringify(["create-membership", payload.code, payload.initialState, payload.restoreArchived]);
    const retry = this.retryRecord("membershipCreate", fingerprint, auth);
    const body: CreateCandidateMembershipRequest = {
      market: "HK",
      code: payload.code,
      initialState: payload.initialState,
      restoreArchived: payload.restoreArchived,
      idempotencyKey: retry.key
    };
    try {
      const response = await this.writeJson("/api/mobile/research/candidate-memberships", auth, body, "POST");
      const validation = validateCandidateMembershipWrite(response);
      if (!validation.ok) return { ok: false, state: "malformed", reason: validation.reason };
      return { ok: true, value: response as CandidateMembershipWriteEnvelope };
    } catch (error) {
      return normalizeWriteError(error);
    }
  }

  confirmCandidateMembershipCreate(auth: WebApiAuth, payload: { code: string; initialState: "tracked" | "paused"; restoreArchived: boolean }): void {
    const fingerprint = JSON.stringify(["create-membership", payload.code, payload.initialState, payload.restoreArchived]);
    const retry = this.membershipCreateRetry;
    if (retry?.fingerprint === fingerprint && sameWebApiAuth(retry.auth, auth)) this.clearRetry("membershipCreate", retry);
  }

  async updateCandidateMembershipState(auth: WebApiAuth, membershipId: string, state: CandidateMembershipState, version: number): Promise<WebCandidateMembershipWriteResponse> {
    const fingerprint = JSON.stringify(["update-membership", membershipId, state, version]);
    const retry = this.retryRecord("membershipState", fingerprint, auth);
    const body: UpdateCandidateMembershipStateRequest = { state, version, idempotencyKey: retry.key };
    try {
      const response = await this.writeJson(`/api/mobile/research/candidate-memberships/${encodeURIComponent(membershipId)}/state`, auth, body, "PATCH");
      const validation = validateCandidateMembershipWrite(response);
      if (!validation.ok) return { ok: false, state: "malformed", reason: validation.reason };
      const envelope = response as CandidateMembershipWriteEnvelope;
      const expectedVersion = envelope.result === "state_changed" ? version + 1 : envelope.result === "unchanged" ? version : null;
      if (!memberScopedResponseMatches(membershipId, [validation.value.id]) || validation.value.state !== state || validation.value.version !== expectedVersion) return { ok: false, state: "malformed", reason: "Candidate membership write response must match requested membership id, target state, and resulting version." };
      this.clearRetry("membershipState", retry);
      return { ok: true, value: envelope };
    } catch (error) {
      return normalizeWriteError(error);
    }
  }

  async submitDecisionCheck(symbol: CanonicalSecuritySymbol, context: DecisionContextEnvelope, binding: DecisionSnapshotBinding | ResearchReportDecisionBinding, auth: WebApiAuth, payload: { actionIntent: DecisionActionIntent; humanCheckResult: HumanCheckResult; userFinalDecision: string | null; conditionalDecision?: AnnualConditionalDecisionSubmission; formalDecision?: FormalOwnerDecisionInput; decisionSnapshotBinding?: DecisionSnapshotBinding }): Promise<{ ok: true; value: PreTradeDecisionCheckData } | { ok: false; state: WebFailureState; reason: string }> {
    const researchReportBinding = "bindingVersion" in binding ? binding : null;
    const decisionSnapshotBinding = researchReportBinding ? payload.decisionSnapshotBinding ?? null : binding as DecisionSnapshotBinding;
    if (researchReportBinding && !decisionSnapshotBinding) return { ok: false, state: "malformed", reason: "Confirmed-report decisions require the exact current portfolio/risk snapshot binding." };
    const fingerprint = JSON.stringify([symbol.symbol, context.contextId, context.contextHash, binding, decisionSnapshotBinding, payload.actionIntent, payload.humanCheckResult, payload.userFinalDecision ?? null, payload.conditionalDecision, payload.formalDecision]);
    const retry = this.retryRecord("check", fingerprint, auth);
    const body: CreatePreTradeDecisionCheckRequest = {
      decisionContextSchemaVersion: DECISION_CONTEXT_SCHEMA_VERSION,
      contextId: context.contextId,
      contextHash: context.contextHash,
      actionIntent: payload.actionIntent,
      humanCheckResult: payload.humanCheckResult,
      userFinalDecision: payload.userFinalDecision,
      reviewedAt: retry.reviewedAt,
      ...(researchReportBinding ? { researchReportBinding, decisionSnapshotBinding: decisionSnapshotBinding! } : { decisionSnapshotBinding: decisionSnapshotBinding! }),
      ...(payload.conditionalDecision ? { conditionalDecision: payload.conditionalDecision } : {}),
      ...(payload.formalDecision ? { formalDecision: payload.formalDecision } : {}),
      idempotencyKey: retry.key
    };
    try {
      const response = await this.writeJson(`/api/mobile/research/profiles/${symbol.market}/${symbol.code}/decision-checks`, auth, body);
      const validation = validateDecisionCheckWriteEnvelope(response, context, decisionSnapshotBinding ?? undefined);
      if (!validation.ok) return { ok: false, state: "malformed", reason: validation.reason };
      if (decisionSnapshotBinding) {
        const snapshotValidation = await validateDecisionSnapshotStateForBrowser(validation.value.decisionSnapshot);
        if (!snapshotValidation.ok) return { ok: false, state: "malformed", reason: snapshotValidation.errors.join("; ") };
      }
      const submittedResponseValidation = await validateSubmittedDecisionResponse(validation.value, payload, binding);
      if (!submittedResponseValidation.ok) return submittedResponseValidation;
      this.clearRetry("check", retry);
      return validation;
    } catch (error) {
      return normalizeWriteError(error);
    }
  }
  async submitReview(symbol: CanonicalSecuritySymbol, check: PreTradeDecisionCheckData, auth: WebApiAuth, payload: { outcome: DecisionReviewOutcome; outcomeEvidence: string | null; reviewNote: string | null; portfolioReviewBinding?: PostDecisionPortfolioReviewBinding; reviewLearning?: AnnualReviewLearningRequest; dailyTrackingBinding?: ResearchReportDecisionBinding }): Promise<{ ok: true; value: PostDecisionReviewData } | { ok: false; state: WebFailureState; reason: string }> {
    const fingerprint = JSON.stringify([symbol.symbol, check.id, payload.outcome, payload.outcomeEvidence ?? null, payload.reviewNote ?? null, payload.portfolioReviewBinding, payload.reviewLearning, payload.dailyTrackingBinding]);
    const retry = this.retryRecord("review", fingerprint, auth);
    const body: CreatePostDecisionReviewRequest = {
      outcome: payload.outcome,
      outcomeEvidence: payload.outcomeEvidence,
      reviewNote: payload.reviewNote,
      reviewedAt: retry.reviewedAt,
      ...(payload.portfolioReviewBinding ? { portfolioReviewBinding: payload.portfolioReviewBinding } : {}),
      ...(payload.reviewLearning ? { reviewLearning: payload.reviewLearning } : {}),
      ...(payload.dailyTrackingBinding ? { dailyTrackingBinding: payload.dailyTrackingBinding } : {}),
      idempotencyKey: retry.key
    };
    try {
      const response = await this.writeJson(`/api/mobile/research/profiles/${symbol.market}/${symbol.code}/decision-checks/${encodeURIComponent(check.id)}/reviews`, auth, body);
      const validation = validatePostDecisionReviewWriteEnvelope(response, check.id, symbol.symbol);
      if (!validation.ok) return { ok: false, state: "malformed", reason: validation.reason };
      const exact = validatePostDecisionReview(validation.value, check.id, symbol.symbol, body);
      if (!exact.ok) return { ok: false, state: "conflict", reason: exact.reason };
      const portfolioReviewValidation = await validatePostDecisionPortfolioReviewStateForBrowser(
        validation.value.portfolioReview,
        check.decisionSnapshot,
        check.id,
        symbol.symbol
      );
      if (!portfolioReviewValidation.ok) return { ok: false, state: "malformed", reason: portfolioReviewValidation.errors.join("; ") };
      if (payload.portfolioReviewBinding
        && (portfolioReviewValidation.value.availability !== "preserved"
          || portfolioReviewValidation.value.snapshot?.comparison.comparisonId !== payload.portfolioReviewBinding.comparison.comparisonId)) {
        return { ok: false, state: "conflict", reason: "portfolio review response does not match the submitted review-time comparison binding" };
      }
      if (!payload.portfolioReviewBinding && portfolioReviewValidation.value.availability !== "portfolio_review_not_captured") {
        return { ok: false, state: "conflict", reason: "portfolio review response captured facts that were not submitted for review-time comparison" };
      }
      const learningValidation = validateSubmittedReviewLearning(validation.value, check, payload.reviewLearning);
      if (!learningValidation.ok) return learningValidation;
      if (!payload.dailyTrackingBinding) this.clearRetry("review", retry);
      return validation;
    } catch (error) {
      return normalizeWriteError(error);
    }
  }
  confirmReviewSubmission(review: PostDecisionReviewData, auth: WebApiAuth): void {
    const retry = this.reviewRetry;
    if (retry?.key === review.audit.idempotencyKey && sameWebApiAuth(retry.auth, auth)) this.clearRetry("review", retry);
  }
  invalidateAuthorizationRetries(): void { this.checkRetry = null; this.reviewRetry = null; this.membershipCreateRetry = null; this.membershipStateRetry = null; }
  private nextJourneyGeneration(): number {
    this.journeyController?.abort();
    this.journeyController = new AbortController();
    this.journeyGeneration += 1;
    return this.journeyGeneration;
  }
  private nextCandidateOverviewGeneration(): number {
    this.candidateOverviewController?.abort();
    this.candidateOverviewController = new AbortController();
    this.candidateOverviewGeneration += 1;
    return this.candidateOverviewGeneration;
  }
  private nextCandidateMembershipGeneration(): number {
    this.candidateMembershipController?.abort();
    this.candidateMembershipController = new AbortController();
    this.candidateMembershipGeneration += 1;
    return this.candidateMembershipGeneration;
  }

  private nextCandidateDecisionIntakeGeneration(): number {
    this.candidateDecisionIntakeController?.abort();
    this.candidateDecisionIntakeController = new AbortController();
    this.candidateDecisionIntakeGeneration += 1;
    return this.candidateDecisionIntakeGeneration;
  }

  private nextAssistAdvisoryScopeGeneration(): number {
    this.assistAdvisoryScopeController?.abort();
    this.assistAdvisoryScopeController = new AbortController();
    this.assistAdvisoryScopeGeneration += 1;
    return this.assistAdvisoryScopeGeneration;
  }

  private nextAssistHumanReviewWorkspaceGeneration(): number {
    this.assistHumanReviewWorkspaceController?.abort();
    this.assistHumanReviewWorkspaceController = new AbortController();
    this.assistHumanReviewWorkspaceGeneration += 1;
    return this.assistHumanReviewWorkspaceGeneration;
  }

  private nextAssistReviewFollowUpWorkflowGeneration(): number {
    this.assistReviewFollowUpWorkflowController?.abort();
    this.assistReviewFollowUpWorkflowController = new AbortController();
    this.assistReviewFollowUpWorkflowGeneration += 1;
    return this.assistReviewFollowUpWorkflowGeneration;
  }

  private nextAssistDecisionNoteWorkflowGeneration(): number {
    this.assistDecisionNoteWorkflowController?.abort();
    this.assistDecisionNoteWorkflowController = new AbortController();
    this.assistDecisionNoteWorkflowGeneration += 1;
    return this.assistDecisionNoteWorkflowGeneration;
  }

  private retryRecord(kind: "check" | "review" | "membershipCreate" | "membershipState", fingerprint: string, auth: WebApiAuth): RetryRecord {
    const current = kind === "check"
      ? this.checkRetry
      : kind === "review"
        ? this.reviewRetry
        : kind === "membershipCreate"
          ? this.membershipCreateRetry
          : this.membershipStateRetry;
    if (current?.fingerprint === fingerprint && sameWebApiAuth(current.auth, auth)) return current;
    const now = this.nextReviewedAt();
    const next = { fingerprint, key: `web-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`, reviewedAt: now, auth: { ...auth } };
    if (kind === "check") this.checkRetry = next;
    else if (kind === "review") this.reviewRetry = next;
    else if (kind === "membershipCreate") this.membershipCreateRetry = next;
    else this.membershipStateRetry = next;
    return next;
  }
  private clearRetry(kind: "check" | "review" | "membershipCreate" | "membershipState", retry: RetryRecord): void { const current = kind === "check" ? this.checkRetry : kind === "review" ? this.reviewRetry : kind === "membershipCreate" ? this.membershipCreateRetry : this.membershipStateRetry; if (!current || current.key !== retry.key || current.fingerprint !== retry.fingerprint || !sameWebApiAuth(current.auth, retry.auth)) return; if (kind === "check") this.checkRetry = null; else if (kind === "review") this.reviewRetry = null; else if (kind === "membershipCreate") this.membershipCreateRetry = null; else this.membershipStateRetry = null; }

  private nextReviewedAt(): string {
    const next = Math.max(Date.now(), this.lastReviewedAtMs + 1);
    this.lastReviewedAtMs = next;
    return new Date(next).toISOString();
  }

  private async fetchJson(path: string, auth: WebApiAuth | null, signal: AbortSignal | null): Promise<unknown> {
    const response = await fetch(path, {
      method: "GET",
      headers: authHeaders(auth),
      signal
    });
    return decodeJsonResponse(response);
  }

  private async fetchJsonPreservingValidFailure(path: string, auth: WebApiAuth | null, signal: AbortSignal | null, acceptsFailureEnvelope: (value: unknown) => boolean | Promise<boolean>, cache?: RequestCache): Promise<unknown> {
    const response = await fetch(path, {
      method: "GET",
      headers: authHeaders(auth),
      signal,
      cache
    });
    return decodeJsonResponse(response, acceptsFailureEnvelope);
  }
  private async writeJson(path: string, auth: WebApiAuth, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<unknown> {
    const response = await fetch(path, {
      method,
      headers: { "content-type": "application/json", ...authHeaders(auth) },
      body: JSON.stringify(body)
    });
    return decodeJsonResponse(response);
  }
}

interface RetryRecord { fingerprint: string; key: string; reviewedAt: string; auth: WebApiAuth }

class HttpError extends Error {
  readonly state: WebFailureState;

  constructor(status: number, message: string) {
    super(message);
    this.state = status === 401
      ? "unauthorized"
      : status === 404
        ? "not_found"
        : status === 409
          ? "conflict"
          : status >= 500
            ? "unavailable"
            : status >= 400
              ? "malformed"
              : "offline";
  }
}

function normalizeWriteError(error: unknown): { ok: false; state: WebFailureState; reason: string } {
  if (error instanceof HttpError) return { ok: false, state: error.state, reason: error.message };
  return { ok: false, state: "offline", reason: error instanceof Error ? error.message : "Network request failed." };
}

function authHeaders(auth: WebApiAuth | null): Record<string, string> {
  if (!auth || auth.headerName.trim().length === 0 || auth.token.trim().length === 0) return {};
  return { [auth.headerName.trim()]: auth.token };
}

async function decodeJsonResponse(response: Response, acceptsFailureEnvelope?: (value: unknown) => boolean | Promise<boolean>): Promise<unknown> {
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const accepted = acceptsFailureEnvelope ? await acceptsFailureEnvelope(value) : false;
    if (!accepted) throw new HttpError(response.status, acceptsFailureEnvelope ? `HTTP ${response.status}` : isRecord(value) && typeof value.message === "string" ? value.message : `HTTP ${response.status}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
