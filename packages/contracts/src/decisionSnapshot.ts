import crypto from "node:crypto";
import {
  computeDecisionContextHash,
  decisionContextHashInputFromEnvelope,
  validateDecisionContextEnvelope
} from "./decisionContext.js";
import { canonicalJson } from "./decisionContextBrowser.js";
import {
  validatePortfolioDecisionContextEnvelope,
  validatePortfolioRiskImpactEnvelope
} from "./portfolioDecisionContext.js";
import { validatePortfolioRiskImpactBindingForBrowser } from "./portfolioDecisionContextBrowser.js";
import {
  validateDecisionSnapshotStateStructure,
  type DecisionSnapshotEnvelope,
  type DecisionSnapshotState
} from "./decisionSnapshotContract.js";
import { computeQuantDecisionEvidenceRefinementId } from "./quantDecisionEvidence.js";

export * from "./decisionSnapshotContract.js";

export type DecisionSnapshotHashInput = Omit<DecisionSnapshotEnvelope, "snapshotId">;

export function computeDecisionSnapshotId(input: DecisionSnapshotHashInput): string {
  return `decision-snapshot:${crypto.createHash("sha256").update(canonicalJson(input)).digest("hex")}`;
}

export function decisionSnapshotHashInput(snapshot: DecisionSnapshotEnvelope): DecisionSnapshotHashInput {
  const { snapshotId: _snapshotId, ...input } = snapshot;
  return input;
}

export function validateDecisionSnapshotState(value: unknown): { ok: true; value: DecisionSnapshotState } | { ok: false; errors: string[] } {
  const structure = validateDecisionSnapshotStateStructure(value);
  if (!structure.ok || structure.value.availability !== "preserved") return structure;
  const errors: string[] = [];
  const snapshot = structure.value.snapshot as DecisionSnapshotEnvelope;
  const decisionValidation = validateDecisionContextEnvelope(snapshot.decisionContext);
  if (!decisionValidation.ok) errors.push(...decisionValidation.errors.map((error) => `decisionSnapshot.snapshot.decisionContext.${error}`));
  const quantRefinement = snapshot.decisionContext.quantEvidence.decisionEvidence;
  if (quantRefinement?.status === "available"
    && quantRefinement.refinementId !== computeQuantDecisionEvidenceRefinementId(quantRefinement)) {
    errors.push("decision snapshot quant decision evidence refinementId does not match canonical content");
  }
  const expectedContextHash = computeDecisionContextHash(decisionContextHashInputFromEnvelope(snapshot.decisionContext));
  if (snapshot.decisionContext.contextHash !== expectedContextHash) errors.push("decision snapshot decisionContext contextHash does not match canonical content");
  if (snapshot.decisionContext.contextId !== `decision-context:${snapshot.candidateSymbol}:${expectedContextHash.slice(0, 16)}`) errors.push("decision snapshot decisionContext contextId does not match canonical content");

  const portfolio = snapshot.portfolioContext.envelope;
  if (portfolio) {
    const portfolioValidation = validatePortfolioDecisionContextEnvelope(portfolio);
    if (!portfolioValidation.ok) errors.push(...portfolioValidation.errors.map((error) => `decisionSnapshot.snapshot.portfolioContext.envelope.${error}`));
  }
  const risk = snapshot.riskImpact.envelope;
  if (risk) {
    const riskValidation = validatePortfolioRiskImpactEnvelope(risk);
    if (!riskValidation.ok) errors.push(...riskValidation.errors.map((error) => `decisionSnapshot.snapshot.riskImpact.envelope.${error}`));
    else if (portfolio && risk.hypotheticalAmount !== null) {
      const bindingValidation = validatePortfolioRiskImpactBindingForBrowser(
        risk,
        portfolio,
        snapshot.candidateSymbol,
        risk.hypotheticalAmount
      );
      if (!bindingValidation.ok) {
        errors.push(...bindingValidation.errors.map((error) => `decisionSnapshot.snapshot.riskImpact.${error}`));
      }
    }
  }
  if (snapshot.snapshotId !== computeDecisionSnapshotId(decisionSnapshotHashInput(snapshot))) {
    errors.push("decisionSnapshot.snapshot.snapshotId does not match canonical content");
  }
  return errors.length === 0 ? structure : { ok: false, errors };
}
