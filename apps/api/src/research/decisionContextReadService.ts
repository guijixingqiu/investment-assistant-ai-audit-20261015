import type { Pool, PoolClient } from "pg";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import type { DecisionContextEnvelope, DecisionContextHashInput } from "../../../../packages/contracts/src/decisionContext.js";
import { computeDecisionContextHash, DECISION_CONTEXT_SCHEMA_VERSION } from "../../../../packages/contracts/src/decisionContext.js";
import { normalizeMarketCode } from "../market/freshness.js";
import { readLatestQuoteEnvelope } from "../market/repository.js";
import { buildSuggestionSummary, quoteEnvelopeToDecisionQuote, researchEnvelopeToDecisionResearch } from "./decisionContextMappers.js";
import { readResearchProfileEnvelope } from "./researchProfileReadRepository.js";

export type QuantEvidenceReader = (requestedSymbol: string, now: Date) => Promise<DecisionContextEnvelope["quantEvidence"]>;

export async function assembleDecisionContextEnvelope(
  pool: Pick<Pool | PoolClient, "query">,
  market: string,
  code: string,
  liveMaxAgeSeconds: number,
  readQuantEvidence: QuantEvidenceReader,
  now = new Date()
): Promise<DecisionContextEnvelope> {
  const normalized = normalizeMarketCode(market, code);
  const quoteResult = await readSafely(() => readLatestQuoteEnvelope(pool, normalized.market, normalized.code, liveMaxAgeSeconds, now));
  const researchResult = await readSafely(() => readResearchProfileEnvelope(pool, normalized.market, normalized.code, now));
  const quote = quoteResult.ok ? quoteEnvelopeToDecisionQuote(quoteResult.value) : unavailableQuote();
  const research = researchResult.ok ? researchEnvelopeToDecisionResearch(researchResult.value, now) : unavailableResearch();
  const suggestionSummary = buildSuggestionSummary(research);
  const quantEvidence = await readQuantEvidence(normalized.symbol, now);
  const hashInput: DecisionContextHashInput = {
    schemaVersion: DECISION_CONTEXT_SCHEMA_VERSION,
    requestedSymbol: normalized.symbol,
    provenance: { quote: "persisted_market_quotes", research: "research_profiles_evidence_suggestions", quant: "quant_research_evidence", portfolio: "omitted" },
    quote,
    research,
    suggestionSummary,
    quantEvidence,
    portfolio: {
      status: "omitted",
      reason: "authoritative_portfolio_source_not_approved",
      message: "Position context is omitted because no authoritative live portfolio source has been approved."
    },
    message: `Decision context for ${normalized.symbol} is advisory information only and cannot create orders.`
  };
  const contextHash = computeDecisionContextHash(hashInput);
  return {
    schemaVersion: DECISION_CONTEXT_SCHEMA_VERSION,
    contextId: `decision-context:${normalized.symbol}:${contextHash.slice(0, 16)}`,
    contextHash,
    generatedAt: now.toISOString(),
    requestedSymbol: normalized.symbol,
    provenance: hashInput.provenance,
    quote: hashInput.quote,
    research: hashInput.research,
    suggestionSummary: hashInput.suggestionSummary,
    quantEvidence: hashInput.quantEvidence,
    portfolio: hashInput.portfolio,
    message: hashInput.message
  };
}

function unavailableQuote(): DecisionContextEnvelope["quote"] {
  return {
    status: "unavailable", snapshotId: null, fetchedAt: null, source: null, staleReason: "repository_error",
    metadata: makeFactMetadata({ source: "persisted_market_quotes", asOf: null, fetchedAt: null, freshness: "unavailable", provenance: "unavailable", authority: "market_data", stale: false, missing: false, conflict: false, fixture: false, correctionOf: null, replaces: null, message: "Persisted quote repository is unavailable; no fresh quote metadata is synthesized." }),
    data: null,
    message: "Persisted quote repository is unavailable."
  };
}

function unavailableResearch(): DecisionContextEnvelope["research"] {
  return {
    status: "unavailable", profile: null, evidence: [], suggestions: [], evidenceAsOf: null, staleReason: "repository_error",
    metadata: makeFactMetadata({ source: "research_profiles_evidence_suggestions", asOf: null, fetchedAt: null, freshness: "unavailable", provenance: "research_only", authority: "research_evidence", stale: false, missing: false, conflict: false, fixture: false, correctionOf: null, replaces: null, message: "Research repository is unavailable; no research evidence metadata is synthesized." }),
    message: "Research repository is unavailable."
  };
}

async function readSafely<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try { return { ok: true, value: await fn() }; } catch (error) { return { ok: false, error }; }
}
