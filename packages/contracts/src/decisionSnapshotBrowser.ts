import {
  canonicalJson,
  decisionContextHashInputFromEnvelope,
  validateDecisionContextEnvelope
} from "./decisionContextBrowser.js";
import {
  validatePortfolioDecisionContextForBrowser,
  validatePortfolioRiskImpactBindingForBrowser,
  validatePortfolioRiskImpactForBrowser
} from "./portfolioDecisionContextBrowser.js";
import {
  validateDecisionSnapshotStateStructure,
  type DecisionSnapshotEnvelope,
  type DecisionSnapshotState
} from "./decisionSnapshotContract.js";
import { validateQuantDecisionEvidenceRefinementForBrowser } from "./quantDecisionEvidenceBrowser.js";

export * from "./decisionSnapshotContract.js";

export async function validateDecisionSnapshotStateForBrowser(value: unknown): Promise<{
  ok: true;
  value: DecisionSnapshotState;
} | {
  ok: false;
  errors: string[];
}> {
  const structure = validateDecisionSnapshotStateStructure(value);
  if (!structure.ok || structure.value.availability !== "preserved") return structure;
  const errors: string[] = [];
  const snapshot = structure.value.snapshot as DecisionSnapshotEnvelope;
  const decisionValidation = validateDecisionContextEnvelope(snapshot.decisionContext);
  if (!decisionValidation.ok) errors.push(...decisionValidation.errors.map((error) => `decisionSnapshot.snapshot.decisionContext.${error}`));
  const quantRefinement = snapshot.decisionContext.quantEvidence.decisionEvidence;
  if (quantRefinement) {
    const refinementValidation = await validateQuantDecisionEvidenceRefinementForBrowser(quantRefinement);
    if (!refinementValidation.ok) errors.push(...refinementValidation.errors.map((error) => `decisionSnapshot.snapshot.decisionContext.quantEvidence.decisionEvidence.${error}`));
  }
  try {
    const expectedContextHash = await sha256Hex(canonicalJson(decisionContextHashInputFromEnvelope(snapshot.decisionContext)));
    if (snapshot.decisionContext.contextHash !== expectedContextHash) errors.push("decision snapshot decisionContext contextHash does not match canonical content");
    if (snapshot.decisionContext.contextId !== `decision-context:${snapshot.candidateSymbol}:${expectedContextHash.slice(0, 16)}`) errors.push("decision snapshot decisionContext contextId does not match canonical content");
  } catch {
    errors.push("decision snapshot decisionContext canonical SHA-256 validation failed");
  }

  const portfolio = snapshot.portfolioContext.envelope;
  if (portfolio) {
    const portfolioValidation = await validatePortfolioDecisionContextForBrowser(portfolio);
    if (!portfolioValidation.ok) errors.push(...portfolioValidation.errors.map((error) => `decisionSnapshot.snapshot.portfolioContext.envelope.${error}`));
  }
  const risk = snapshot.riskImpact.envelope;
  if (risk) {
    const riskValidation = await validatePortfolioRiskImpactForBrowser(risk);
    if (!riskValidation.ok) {
      errors.push(...riskValidation.errors.map((error) => `decisionSnapshot.snapshot.riskImpact.envelope.${error}`));
    } else if (portfolio && risk.hypotheticalAmount !== null) {
      const binding = validatePortfolioRiskImpactBindingForBrowser(risk, portfolio, snapshot.candidateSymbol, risk.hypotheticalAmount);
      if (!binding.ok) errors.push(...binding.errors.map((error) => `decisionSnapshot.snapshot.riskImpact.${error}`));
    }
  }
  try {
    const { snapshotId: _snapshotId, ...hashInput } = snapshot;
    const expectedSnapshotId = `decision-snapshot:${await sha256Hex(canonicalJson(hashInput))}`;
    if (snapshot.snapshotId !== expectedSnapshotId) errors.push("decisionSnapshot.snapshot.snapshotId does not match canonical content");
  } catch {
    errors.push("decision snapshot canonical SHA-256 validation failed");
  }
  return errors.length === 0 ? structure : { ok: false, errors };
}

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
