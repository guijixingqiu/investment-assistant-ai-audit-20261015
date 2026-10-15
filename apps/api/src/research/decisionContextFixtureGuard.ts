import type { DecisionContextEnvelope } from "../../../../packages/contracts/src/decisionContext.js";

export function hasFixtureDecisionContextEvidence(context: DecisionContextEnvelope): boolean {
  const quant = context.quantEvidence;
  return context.quote.source === "fixture" || context.quote.metadata.fixture
    || context.quote.metadata.provenance === "fixture"
    || context.research.metadata.fixture || context.research.metadata.provenance === "fixture"
    || quant.metadata.fixture || quant.sampleBoundary.sourceClassification === "fixture"
    || quant.identities?.frozenSnapshot.sourceClassification === "fixture"
    || quant.decisionEvidence?.source?.sourceClassification === "fixture";
}
