import {
  validateAnnualValuationQuantWorkbenchEnvelope,
  type AnnualValuationQuantWorkbenchEnvelope
} from "../../../packages/contracts/src/annualValuationQuantWorkbench.js";
import { validateAnnualConditionalDecisionPreviewForBrowser } from "./annualConditionalDecisionBrowser.js";

export function annualValuationReadMatchesMembership(value: unknown, membershipId: string): boolean {
  const validation = validateAnnualValuationQuantWorkbenchEnvelope(value);
  return validation.ok && (value as AnnualValuationQuantWorkbenchEnvelope).membershipId === membershipId;
}

export async function annualConditionalReadMatchesMembership(value: unknown, membershipId: string): Promise<boolean> {
  const validation = await validateAnnualConditionalDecisionPreviewForBrowser(value);
  return validation.ok && validation.value.membershipId === membershipId;
}
