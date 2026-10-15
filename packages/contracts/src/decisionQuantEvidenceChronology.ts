import { areInstantsChronologicallyOrdered } from "./chronology.js";

export function validateDecisionQuantEvidenceChronology(
  value: Record<string, unknown>,
  availableBy: unknown,
  errors: string[]
): void {
  const metadata = record(value.metadata);
  if (value.status !== "available") {
    if (metadata && (metadata.asOf !== null || metadata.fetchedAt !== null)) {
      errors.push("fail-closed quantEvidence metadata must clear asOf and fetchedAt");
    }
    return;
  }
  const identities = record(value.identities);
  const decisionEvidence = record(value.decisionEvidence);
  const source = decisionEvidence?.status === "available" ? record(decisionEvidence.source) : null;
  const values = [metadata?.asOf];
  if (source) values.push(source.dataCutoff);
  values.push(metadata?.fetchedAt, identities?.generatedAt);
  if (availableBy !== undefined) values.push(availableBy);
  if (!areInstantsChronologicallyOrdered(values)) {
    errors.push("available quant evidence must satisfy asOf <= dataCutoff <= fetchedAt <= generatedAt <= envelope generatedAt");
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
