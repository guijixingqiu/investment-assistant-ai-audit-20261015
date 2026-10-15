import crypto from "node:crypto";
import { canonicalJson } from "./decisionContextBrowser.js";
import { validateAnnualDecisionBriefEnvelope } from "./annualDecisionBrief.js";
import { validateAnnualPortfolioLabEnvelope } from "./annualPortfolioLab.js";
import { validateAnnualValuationQuantWorkbenchEnvelope } from "./annualValuationQuantWorkbench.js";
import {
  validateAnnualConditionalDecisionPreviewStructure,
  validateAnnualConditionalDecisionStateStructure,
  validateAnnualConditionalDecisionSubmissionStructure,
  type AnnualConditionalDecisionPreviewEnvelope,
  type AnnualConditionalDecisionState,
  type AnnualConditionalDecisionSubmission
} from "./annualConditionalDecisionContract.js";

export * from "./annualConditionalDecisionContract.js";

export function computeAnnualConditionalDecisionPreviewId(
  preview: AnnualConditionalDecisionPreviewEnvelope
): string {
  const input = annualConditionalDecisionPreviewIdentityInput(preview);
  return `annual-conditional-preview:${crypto.createHash("sha256").update(canonicalJson(input)).digest("hex")}`;
}

export function annualConditionalDecisionPreviewIdentityInput(
  preview: AnnualConditionalDecisionPreviewEnvelope
): Record<string, unknown> {
  const input = JSON.parse(JSON.stringify(preview)) as Record<string, any>;
  delete input.previewId;
  delete input.generatedAt;
  const data = input.data;
  if (data?.decisionBrief) {
    delete data.decisionBrief.generatedAt;
    if (data.decisionBrief.metadata) delete data.decisionBrief.metadata.fetchedAt;
    if (data.decisionBrief.data?.sourceIdentity) delete data.decisionBrief.data.sourceIdentity.generatedAt;
  }
  if (data?.valuationQuant) {
    delete data.valuationQuant.generatedAt;
    if (data.valuationQuant.metadata) delete data.valuationQuant.metadata.fetchedAt;
    if (data.valuationQuant.data?.sourceIdentity) delete data.valuationQuant.data.sourceIdentity.generatedAt;
  }
  if (data?.portfolioLab) {
    delete data.portfolioLab.generatedAt;
    delete data.portfolioLab.labId;
    if (data.portfolioLab.data?.portfolio) delete data.portfolioLab.data.portfolio.assembledAt;
  }
  return input;
}

export function validateAnnualConditionalDecisionPreviewEnvelope(
  value: unknown
): { ok: true; value: AnnualConditionalDecisionPreviewEnvelope } | { ok: false; errors: string[] } {
  const structure = validateAnnualConditionalDecisionPreviewStructure(value);
  if (!structure.ok || structure.value.status !== "available" || !structure.value.data) return structure;
  const errors: string[] = [];
  const brief = validateAnnualDecisionBriefEnvelope(structure.value.data.decisionBrief);
  if (!brief.ok) errors.push(...brief.errors.map((error) => `conditional decision brief.${error}`));
  const valuation = validateAnnualValuationQuantWorkbenchEnvelope(structure.value.data.valuationQuant);
  if (!valuation.ok) errors.push(...valuation.errors.map((error) => `conditional valuation quant.${error}`));
  const lab = validateAnnualPortfolioLabEnvelope(structure.value.data.portfolioLab);
  if (!lab.ok) errors.push(...lab.errors.map((error) => `conditional portfolio lab.${error}`));
  if (structure.value.previewId !== computeAnnualConditionalDecisionPreviewId(structure.value)) {
    errors.push("conditional decision previewId does not match canonical bound content");
  }
  return errors.length === 0 ? structure : { ok: false, errors };
}

export function validateAnnualConditionalDecisionSubmission(
  value: unknown
): { ok: true; value: AnnualConditionalDecisionSubmission } | { ok: false; errors: string[] } {
  const structure = validateAnnualConditionalDecisionSubmissionStructure(value);
  if (!structure.ok) return structure;
  const preview = validateAnnualConditionalDecisionPreviewEnvelope(structure.value.preview);
  return preview.ok ? structure : { ok: false, errors: preview.errors };
}

export function validateAnnualConditionalDecisionState(
  value: unknown
): { ok: true; value: AnnualConditionalDecisionState } | { ok: false; errors: string[] } {
  const structure = validateAnnualConditionalDecisionStateStructure(value);
  if (!structure.ok || structure.value.availability !== "preserved" || !structure.value.preview) return structure;
  const preview = validateAnnualConditionalDecisionPreviewEnvelope(structure.value.preview);
  return preview.ok ? structure : { ok: false, errors: preview.errors };
}
