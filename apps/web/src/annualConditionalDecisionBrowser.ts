import { validateAnnualDecisionBriefEnvelope } from "../../../packages/contracts/src/annualDecisionBrief.js";
import { validateAnnualPortfolioLabForBrowser } from "../../../packages/contracts/src/annualPortfolioLabBrowser.js";
import {
  validateAnnualConditionalDecisionPreviewStructure,
  validateAnnualConditionalDecisionStateStructure,
  validateAnnualConditionalDecisionSubmissionStructure,
  type AnnualConditionalDecisionPreviewEnvelope,
  type AnnualConditionalDecisionState,
  type AnnualConditionalDecisionSubmission
} from "../../../packages/contracts/src/annualConditionalDecisionContract.js";
import { validateAnnualValuationQuantWorkbenchEnvelope } from "../../../packages/contracts/src/annualValuationQuantWorkbench.js";
import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";

type BrowserValidation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export async function validateAnnualConditionalDecisionPreviewForBrowser(
  value: unknown
): Promise<BrowserValidation<AnnualConditionalDecisionPreviewEnvelope>> {
  const structure = validateAnnualConditionalDecisionPreviewStructure(value);
  if (!structure.ok || structure.value.status !== "available" || !structure.value.data) return structure;
  const errors: string[] = [];
  const brief = validateAnnualDecisionBriefEnvelope(structure.value.data.decisionBrief);
  if (!brief.ok) errors.push(...brief.errors.map((error) => `conditional decision brief.${error}`));
  const valuation = validateAnnualValuationQuantWorkbenchEnvelope(structure.value.data.valuationQuant);
  if (!valuation.ok) errors.push(...valuation.errors.map((error) => `conditional valuation quant.${error}`));
  const lab = await validateAnnualPortfolioLabForBrowser(structure.value.data.portfolioLab);
  if (!lab.ok) errors.push(...lab.errors.map((error) => `conditional portfolio lab.${error}`));
  const expectedId = await annualConditionalDecisionPreviewIdForBrowser(structure.value);
  if (structure.value.previewId !== expectedId) errors.push("conditional decision previewId does not match canonical bound content");
  return errors.length === 0 ? structure : { ok: false, errors };
}

export async function validateAnnualConditionalDecisionSubmissionForBrowser(
  value: unknown
): Promise<BrowserValidation<AnnualConditionalDecisionSubmission>> {
  const structure = validateAnnualConditionalDecisionSubmissionStructure(value);
  if (!structure.ok) return structure;
  const preview = await validateAnnualConditionalDecisionPreviewForBrowser(structure.value.preview);
  return preview.ok ? structure : { ok: false, errors: preview.errors };
}

export async function validateAnnualConditionalDecisionStateForBrowser(
  value: unknown
): Promise<BrowserValidation<AnnualConditionalDecisionState>> {
  const structure = validateAnnualConditionalDecisionStateStructure(value);
  if (!structure.ok || structure.value.availability !== "preserved" || !structure.value.preview) return structure;
  const preview = await validateAnnualConditionalDecisionPreviewForBrowser(structure.value.preview);
  return preview.ok ? structure : { ok: false, errors: preview.errors };
}

export async function annualConditionalDecisionPreviewIdForBrowser(
  preview: AnnualConditionalDecisionPreviewEnvelope
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(annualConditionalDecisionPreviewIdentityInputForBrowser(preview)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `annual-conditional-preview:${hex(new Uint8Array(digest))}`;
}

export function annualConditionalDecisionPreviewIdentityInputForBrowser(
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

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
