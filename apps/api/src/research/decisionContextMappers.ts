import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import type { DecisionContextEnvelope } from "../../../../packages/contracts/src/decisionContext.js";
import type { ResearchProfileEnvelope } from "../../../../packages/contracts/src/research.js";
import type { readLatestQuoteEnvelope } from "../market/repository.js";
import { researchEvidenceFreshness } from "./researchMappers.js";
export { latestIso } from "./researchMappers.js";

export function quoteEnvelopeToDecisionQuote(
  envelope: Awaited<ReturnType<typeof readLatestQuoteEnvelope>>
): DecisionContextEnvelope["quote"] {
  const isEmpty = envelope.status === "unavailable" && envelope.message.startsWith("No persisted quote");
  const snapshotId = envelope.data ? `${envelope.data.symbol}:${envelope.data.quoteTime}:${envelope.source.fetchedAt ?? "unknown"}` : null;
  const status = envelope.status === "live" ? "fresh" : envelope.status === "stale" ? "stale" : isEmpty ? "empty" : "unavailable";
  const quoteConflict = envelope.metadata.conflict || envelope.metadata.freshness === "conflict";
  return {
    status,
    snapshotId,
    fetchedAt: envelope.source.fetchedAt,
    source: status === "fresh" || status === "stale" || status === "empty" ? envelope.source.provider : null,
    staleReason: envelope.status === "stale" ? "quote_time_exceeds_live_max_age" : isEmpty ? "no_persisted_quote" : quoteConflict ? "quote_chronology_conflict" : envelope.status === "unavailable" ? "quote_unavailable" : null,
    metadata: makeFactMetadata({
      ...envelope.metadata,
      source: "decision_context.quote:persisted_market_quotes",
      freshness: status === "fresh" ? "fresh" : status === "stale" ? "stale" : status === "empty" ? "missing" : quoteConflict ? "conflict" : "unavailable",
      missing: status === "empty" || envelope.metadata.missing,
      stale: status === "stale" || envelope.metadata.stale,
      message: status === "fresh"
        ? "Decision-context quote metadata is fresh within the configured local quote window."
        : status === "stale"
          ? "Decision-context quote metadata is stale and cannot be treated as fresh."
          : status === "empty"
            ? "Decision-context quote metadata is missing because no persisted quote exists."
            : quoteConflict
              ? "Decision-context quote chronology conflicts; quote facts are hidden."
              : "Decision-context quote metadata is unavailable."
    }),
    data: envelope.data,
    message: envelope.message
  };
}

export function researchEnvelopeToDecisionResearch(
  envelope: ResearchProfileEnvelope,
  now: Date
): DecisionContextEnvelope["research"] {
  if (!envelope.data) {
    return {
      status: "no_evidence", profile: null, evidence: [], suggestions: [], evidenceAsOf: null,
      staleReason: "no_research_profile",
      metadata: makeFactMetadata({
        ...envelope.metadata,
        source: "decision_context.research:research_profiles_evidence_suggestions",
        freshness: "missing", missing: true,
        message: "Decision-context research metadata is missing because no profile exists."
      }),
      message: envelope.message
    };
  }
  const freshness = researchEvidenceFreshness(envelope.data.evidence, now);
  const status = freshness.stale ? "stale_evidence" : freshness.missing ? "no_evidence" : "available";
  return {
    status, profile: envelope.data.profile, evidence: envelope.data.evidence, suggestions: envelope.data.suggestions,
    evidenceAsOf: freshness.evidenceAsOf,
    staleReason: freshness.stale ? "latest_evidence_older_than_90_days" : freshness.missing ? "no_evidence_items" : null,
    metadata: makeFactMetadata({
      ...envelope.metadata,
      source: "decision_context.research:research_profiles_evidence_suggestions",
      asOf: freshness.evidenceAsOf ?? envelope.metadata.asOf,
      freshness: freshness.freshness,
      stale: freshness.stale, missing: freshness.missing,
      message: freshness.stale
        ? "Decision-context research evidence is stale and must not be displayed as fresh."
        : freshness.missing
          ? "Decision-context research profile exists but evidence items are missing."
          : "Decision-context research evidence is available as research-only context."
    }),
    message: envelope.message
  };
}

export function buildSuggestionSummary(
  research: DecisionContextEnvelope["research"]
): DecisionContextEnvelope["suggestionSummary"] {
  if (research.status === "unavailable" || research.status === "unauthorized") {
    return { status: "unavailable", kind: "advisory_information", summary: "Suggestion summary is unavailable because research facts are unavailable.", linkedEvidenceIds: [], limitations: ["No automatic trading decision is produced."] };
  }
  if (!research.profile || research.evidence.length === 0) {
    return { status: "uncertain", kind: "advisory_information", summary: "Evidence is insufficient; no actionable advisory summary is available.", linkedEvidenceIds: [], limitations: ["Evidence is empty or stale.", "No automatic trading decision is produced."] };
  }
  const pending = research.suggestions.find((item) => item.status === "pending");
  return {
    status: research.status === "stale_evidence" ? "uncertain" : "available",
    kind: "advisory_information",
    summary: pending?.summary ?? research.profile.currentView,
    linkedEvidenceIds: research.evidence.map((item) => item.id),
    limitations: ["This is advisory information, not an automatic trading decision.", "Expected return or profit is not guaranteed.", ...(research.status === "stale_evidence" ? ["Latest evidence is stale and should be refreshed before relying on it."] : [])]
  };
}
