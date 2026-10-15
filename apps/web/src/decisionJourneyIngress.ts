import type { DecisionContextEnvelope } from "../../../packages/contracts/src/decisionContextBrowser.js";
import type { DecisionReviewHistoryEnvelope } from "../../../packages/contracts/src/decisionReview.js";
import type { MarketQuoteEnvelope } from "../../../packages/contracts/src/market.js";
import type { ResearchProfileEnvelope } from "../../../packages/contracts/src/research.js";
import { validateDecisionSnapshotStateForBrowser } from "../../../packages/contracts/src/decisionSnapshotBrowser.js";
import { validatePostDecisionPortfolioReviewStateForBrowser } from "../../../packages/contracts/src/postDecisionPortfolioReviewBrowser.js";
import { validateQuantDecisionEvidenceRefinementForBrowser } from "../../../packages/contracts/src/quantDecisionEvidenceBrowser.js";
import type { CanonicalSecuritySymbol } from "./securitySymbol.js";

export type WebFailureState = "unauthorized" | "not_found" | "conflict" | "malformed" | "offline" | "unavailable";

export function memberScopedResponseMatches(requestedId: string, ids: ReadonlyArray<string | null | undefined>): boolean {
  const distinctIds = [...new Set(ids.filter((id): id is string => id != null))];
  return distinctIds.length > 0 && distinctIds.every((id) => id === requestedId);
}

export async function quantDecisionEvidenceValidationFailure(
  context: DecisionContextEnvelope | null
): Promise<string | null> {
  const refinement = context?.quantEvidence.decisionEvidence;
  if (!refinement) return null;
  const validation = await validateQuantDecisionEvidenceRefinementForBrowser(refinement);
  return validation.ok ? null : validation.errors.join("; ");
}

export function validateJourneyIdentity(
  symbol: CanonicalSecuritySymbol,
  quote: MarketQuoteEnvelope,
  research: ResearchProfileEnvelope,
  context: DecisionContextEnvelope,
  reviewHistory: DecisionReviewHistoryEnvelope
): { ok: true } | { ok: false; reason: string } {
  const errors: string[] = [];
  if (quote.requestedSymbol !== symbol.symbol) errors.push("quote requestedSymbol must match current symbol");
  if (quote.data) requireCanonicalIdentity(quote.data, symbol, "quote data", errors);
  if (research.requestedSymbol !== symbol.symbol) errors.push("research requestedSymbol must match current symbol");
  if (research.data?.profile) requireCanonicalIdentity(research.data.profile, symbol, "research profile", errors);
  if (context.requestedSymbol !== symbol.symbol) errors.push("decision context requestedSymbol must match current symbol");
  if (context.quote.data) requireCanonicalIdentity(context.quote.data, symbol, "decision context quote", errors);
  if (context.research.profile) requireCanonicalIdentity(context.research.profile, symbol, "decision context research profile", errors);
  if (reviewHistory.requestedSymbol !== symbol.symbol) errors.push("review history requestedSymbol must match current symbol");
  return errors.length === 0 ? { ok: true } : { ok: false, reason: errors.join("; ") };
}

export function quoteResearchAvailabilityFailure(
  quote: MarketQuoteEnvelope,
  research: ResearchProfileEnvelope
): { ok: false; state: WebFailureState; reason: string } | null {
  if (quote.status === "unavailable") {
    return { ok: false, state: "unavailable", reason: quote.message };
  }
  if (research.data === null) {
    return { ok: false, state: "unavailable", reason: research.message };
  }
  return null;
}

export function decisionContextAvailabilityFailure(
  context: DecisionContextEnvelope
): { ok: false; state: WebFailureState; reason: string } | null {
  if (context.quote.status === "permission_denied") {
    return { ok: false, state: "unauthorized", reason: context.quote.message };
  }
  if (context.research.status === "unauthorized") {
    return { ok: false, state: "unauthorized", reason: context.research.message };
  }
  if (context.quote.status === "unavailable") {
    return { ok: false, state: "unavailable", reason: context.quote.message };
  }
  if (context.research.status === "unavailable") {
    return { ok: false, state: "unavailable", reason: context.research.message };
  }
  return null;
}

export async function validateReviewHistoryDecisionSnapshots(
  history: DecisionReviewHistoryEnvelope
): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (const [index, check] of history.checks.entries()) {
    const validation = await validateDecisionSnapshotStateForBrowser(check.decisionSnapshot);
    if (!validation.ok) {
      return { ok: false, reason: validation.errors.map((error) => `checks[${index}].${error}`).join("; ") };
    }
    for (const [reviewIndex, review] of check.reviews.entries()) {
      const portfolioReview = await validatePostDecisionPortfolioReviewStateForBrowser(
        review.portfolioReview,
        check.decisionSnapshot,
        check.id,
        check.symbol
      );
      if (!portfolioReview.ok) {
        return {
          ok: false,
          reason: portfolioReview.errors.map((error) => `checks[${index}].reviews[${reviewIndex}].${error}`).join("; ")
        };
      }
    }
  }
  return { ok: true };
}

function requireCanonicalIdentity(
  value: { market: string; code: string; symbol: string },
  symbol: CanonicalSecuritySymbol,
  label: string,
  errors: string[]
): void {
  if (value.market !== symbol.market) errors.push(`${label} market must match current symbol`);
  if (value.code !== symbol.code) errors.push(`${label} code must match current symbol`);
  if (value.symbol !== symbol.symbol) errors.push(`${label} symbol must match current symbol`);
}
