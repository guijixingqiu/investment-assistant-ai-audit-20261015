import type { FastifyInstance } from "fastify";
import { DECISION_CONTEXT_SCHEMA_VERSION, validateDecisionContextEnvelope } from "../../../../packages/contracts/src/decisionContext.js";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import { readDecisionContextEnvelope } from "../research/decisionContextRepository.js";
import { authenticateReadOnly } from "./researchAuth.js";
import { canonicalHongKongSymbol, isSupportedHongKongSymbol } from "./researchRouteValidation.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";

export async function registerDecisionContextRoutes(
  app: FastifyInstance,
  options: MobileResearchRouteOptions
): Promise<void> {
  app.get("/api/mobile/research/decision-context/:market/:code", async (request, reply) => {
    const params = request.params as { market: string; code: string };
    if (!isSupportedHongKongSymbol(params.market, params.code)) {
      await reply.code(400).send({ ok: false, message: "only Hong Kong symbols such as HK.09926 are supported" });
      return;
    }
    if (!authenticateReadOnly(request.headers, options)) {
      await reply.code(401).send(decisionContextFailClosedEnvelope(
        canonicalHongKongSymbol(params.market, params.code),
        "read authorization required"
      ));
      return;
    }
    try {
      const context = await readDecisionContextEnvelope(
        options.pool,
        params.market,
        params.code,
        options.quoteLiveMaxAgeSeconds,
        options.now?.() ?? new Date(),
        options.quantEvidence?.decision ?? null
      );
      if (!validateDecisionContextEnvelope(context).ok) {
        await reply.code(503).send(decisionContextFailClosedEnvelope(
          canonicalHongKongSymbol(params.market, params.code),
          "Assembled decision context failed contract validation before response."
        ));
        return;
      }
      return context;
    } catch {
      await reply.code(503).send(decisionContextFailClosedEnvelope(
        canonicalHongKongSymbol(params.market, params.code),
        "decision context repository is unavailable"
      ));
    }
  });
}

function decisionContextFailClosedEnvelope(requestedSymbol: string, message: string) {
  const generatedAt = new Date().toISOString();
  return {
    schemaVersion: DECISION_CONTEXT_SCHEMA_VERSION,
    contextId: `decision-context:${requestedSymbol}:unavailable`,
    contextHash: "decision-context-unavailable",
    generatedAt,
    requestedSymbol,
    provenance: {
      quote: "persisted_market_quotes",
      research: "research_profiles_evidence_suggestions",
      quant: "quant_research_evidence",
      portfolio: "omitted"
    },
    quote: {
      status: "unavailable",
      snapshotId: null,
      fetchedAt: null,
      source: null,
      staleReason: "decision_context_unavailable",
      metadata: makeFactMetadata({
        source: "decision_context.quote:persisted_market_quotes",
        asOf: null,
        fetchedAt: null,
        freshness: "unavailable",
        provenance: "unavailable",
        authority: "market_data",
        stale: false,
        missing: false,
        conflict: false,
        fixture: false,
        correctionOf: null,
        replaces: null,
        message: "Decision-context quote is unavailable; no fresh quote metadata is synthesized."
      }),
      data: null,
      message
    },
    research: {
      status: "unavailable",
      profile: null,
      evidence: [],
      suggestions: [],
      evidenceAsOf: null,
      staleReason: "decision_context_unavailable",
      metadata: makeFactMetadata({
        source: "decision_context.research:research_profiles_evidence_suggestions",
        asOf: null,
        fetchedAt: null,
        freshness: "unavailable",
        provenance: "research_only",
        authority: "research_evidence",
        stale: false,
        missing: false,
        conflict: false,
        fixture: false,
        correctionOf: null,
        replaces: null,
        message: "Decision-context research is unavailable; no research evidence metadata is synthesized."
      }),
      message
    },
    suggestionSummary: {
      status: "unavailable",
      kind: "advisory_information",
      summary: "Decision context is unavailable; no advisory summary is available.",
      linkedEvidenceIds: [],
      limitations: ["No stale quote, research, portfolio, order, trade, cash, fee, or position facts are exposed."]
    },
    quantEvidence: {
      status: "unavailable",
      metadata: makeFactMetadata({
        source: "decision_context.quant:decision_context_unavailable",
        asOf: null,
        fetchedAt: null,
        freshness: "unavailable",
        provenance: "quant_evidence",
        authority: "quant_evidence",
        stale: false,
        missing: false,
        conflict: false,
        fixture: false,
        correctionOf: null,
        replaces: null,
        message: "Decision-context quant evidence is unavailable; no quant research evidence metadata is synthesized."
      }),
      identities: null,
      sampleBoundary: {
        universe: [],
        sourceClassification: "unavailable",
        finalTestPolicy: "unavailable",
        limitation: "Quant evidence is fail-closed with the decision context."
      },
      limitations: ["No stale quant, shadow portfolio, order, trade, cash, fee, position, broker, or official portfolio facts are exposed."],
      authority: {
        researchOnly: true,
        advisoryOnly: true,
        changesCandidateOrdering: false,
        changesMembershipState: false,
        changesHumanReviewResult: false,
        mutatesLocalRecord: false,
        officialReviewFact: false,
        officialPortfolioFact: false,
        brokerWrite: false,
        recommendation: false,
        ranking: false,
        score: false,
        allocation: false,
        sizing: false,
        targetPrice: false,
        buySellHold: false,
        orderTradeFillAuthority: false,
        cashFeePositionMutation: false
      },
      message: "Quant evidence is unavailable and cannot affect candidate order, review, portfolio, broker, or trading facts."
    },
    portfolio: {
      status: "omitted",
      reason: "authoritative_portfolio_source_not_approved",
      message: "Portfolio context remains omitted because no approved authoritative live portfolio source is available."
    },
    message
  };
}
