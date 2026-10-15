import {
  canonicalQuantDecisionEvidenceJson,
  quantDecisionEvidenceRefinementHashInput,
  validateQuantDecisionEvidenceRefinementStructure,
  type QuantDecisionEvidenceRefinement
} from "./quantDecisionEvidenceContract.js";

export * from "./quantDecisionEvidenceContract.js";

export async function validateQuantDecisionEvidenceRefinementForBrowser(value: unknown): Promise<{
  ok: true;
  value: QuantDecisionEvidenceRefinement;
} | {
  ok: false;
  errors: string[];
}> {
  const structure = validateQuantDecisionEvidenceRefinementStructure(value);
  if (!structure.ok || structure.value.status !== "available") return structure;
  try {
    const content = canonicalQuantDecisionEvidenceJson(quantDecisionEvidenceRefinementHashInput(structure.value));
    const expected = `quant-decision-evidence:${await sha256Hex(content)}`;
    return structure.value.refinementId === expected
      ? structure
      : { ok: false, errors: ["quant decision evidence refinementId does not match canonical content"] };
  } catch {
    return { ok: false, errors: ["quant decision evidence canonical SHA-256 validation failed"] };
  }
}

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
