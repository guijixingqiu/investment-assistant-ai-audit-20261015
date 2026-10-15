import crypto from "node:crypto";
import {
  canonicalQuantDecisionEvidenceJson,
  quantDecisionEvidenceRefinementHashInput,
  type QuantDecisionEvidenceRefinement
} from "./quantDecisionEvidenceContract.js";

export * from "./quantDecisionEvidenceContract.js";

export function computeQuantDecisionEvidenceRefinementId(value: QuantDecisionEvidenceRefinement): string {
  const content = canonicalQuantDecisionEvidenceJson(quantDecisionEvidenceRefinementHashInput(value));
  return `quant-decision-evidence:${crypto.createHash("sha256").update(content).digest("hex")}`;
}
