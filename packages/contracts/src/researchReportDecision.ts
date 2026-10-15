export const RESEARCH_REPORT_DECISION_BINDING_VERSION = "2026-07-30.s1f-report-formal-decision-binding.v1";

export interface ResearchReportDecisionBinding {
  bindingVersion: typeof RESEARCH_REPORT_DECISION_BINDING_VERSION;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  evidencePackId: string;
  evidencePackFingerprint: string;
  reportId: string;
  reportVersion: number;
  contractVersion: string;
  reportFingerprint: string;
  reportDecisionId: string;
  reportDecision: "confirmed";
  reportDecisionActorType: "user";
  reportDecisionActorId: string;
  decidedAt: string;
}

export type ResearchReportDecisionState =
  | { availability: "preserved"; binding: ResearchReportDecisionBinding; limitation: string }
  | { availability: "not_captured"; binding: null; limitation: string };

export function researchReportDecisionNotCapturedState(): ResearchReportDecisionState {
  return {
    availability: "not_captured",
    binding: null,
    limitation: "This historical decision did not capture a research-report decision binding and it is not reconstructed from current research facts."
  };
}

export function validateResearchReportDecisionBinding(
  value: unknown
): { ok: true; value: ResearchReportDecisionBinding } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["researchReportBinding must be an object"] };
  rejectUnknownKeys(value, "researchReportBinding", [
    "bindingVersion", "membershipId", "membershipVersion", "symbol", "evidencePackId",
    "evidencePackFingerprint", "reportId", "reportVersion", "contractVersion",
    "reportFingerprint", "reportDecisionId", "reportDecision", "reportDecisionActorType",
    "reportDecisionActorId", "decidedAt"
  ], errors);
  if (value.bindingVersion !== RESEARCH_REPORT_DECISION_BINDING_VERSION) {
    errors.push(`researchReportBinding.bindingVersion must be ${RESEARCH_REPORT_DECISION_BINDING_VERSION}`);
  }
  for (const key of [
    "membershipId", "symbol", "evidencePackId", "evidencePackFingerprint", "reportId",
    "contractVersion", "reportFingerprint", "reportDecisionId", "reportDecisionActorId"
  ]) requireNonEmptyString(value[key], `researchReportBinding.${key}`, errors);
  for (const key of ["membershipVersion", "reportVersion"]) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) <= 0) {
      errors.push(`researchReportBinding.${key} must be a positive integer`);
    }
  }
  if (typeof value.symbol === "string" && !/^HK\.\d{5}$/.test(value.symbol)) {
    errors.push("researchReportBinding.symbol must be a canonical Hong Kong symbol");
  }
  for (const key of ["evidencePackFingerprint", "reportFingerprint"]) {
    if (typeof value[key] === "string" && !/^[a-f0-9]{64}$/.test(value[key] as string)) {
      errors.push(`researchReportBinding.${key} must be a lowercase sha256`);
    }
  }
  if (value.reportDecision !== "confirmed") errors.push("researchReportBinding.reportDecision must be confirmed");
  if (value.reportDecisionActorType !== "user") errors.push("researchReportBinding.reportDecisionActorType must be user");
  if (typeof value.decidedAt !== "string" || !Number.isFinite(Date.parse(value.decidedAt))) {
    errors.push("researchReportBinding.decidedAt must be a valid date-time");
  }
  return errors.length === 0
    ? { ok: true, value: value as unknown as ResearchReportDecisionBinding }
    : { ok: false, errors };
}

export function validateResearchReportDecisionState(
  value: unknown
): { ok: true; value: ResearchReportDecisionState } | { ok: false; errors: string[] } {
  if (!isRecord(value)) return { ok: false, errors: ["researchReportDecision must be an object"] };
  const errors: string[] = [];
  rejectUnknownKeys(value, "researchReportDecision", ["availability", "binding", "limitation"], errors);
  requireNonEmptyString(value.limitation, "researchReportDecision.limitation", errors);
  if (value.availability === "not_captured") {
    if (value.binding !== null) errors.push("researchReportDecision.binding must be null when not_captured");
  } else if (value.availability === "preserved") {
    const binding = validateResearchReportDecisionBinding(value.binding);
    if (!binding.ok) errors.push(...binding.errors);
  } else {
    errors.push("researchReportDecision.availability must be preserved or not_captured");
  }
  return errors.length === 0
    ? { ok: true, value: value as unknown as ResearchReportDecisionState }
    : { ok: false, errors };
}

export function validateResearchReportBindingRequestInto(
  binding: unknown,
  conditionalDecision: unknown,
  decisionSnapshotBinding: unknown,
  errors: string[]
): void {
  if (binding === undefined) return;
  const validation = validateResearchReportDecisionBinding(binding);
  if (!validation.ok) errors.push(...validation.errors);
  if (conditionalDecision !== undefined) errors.push("researchReportBinding cannot be combined with conditionalDecision");
  if (decisionSnapshotBinding === undefined) errors.push("researchReportBinding requires an exact decisionSnapshotBinding");
}

export function validateResearchReportDecisionStateInto(value: unknown, field: string, errors: string[]): void {
  const validation = validateResearchReportDecisionState(value);
  if (!validation.ok) errors.push(...validation.errors.map((error) => `${field}.${error}`));
}

export function validateResearchReportDecisionForRecordedCheck(
  value: unknown,
  symbol: unknown,
  conditionalPreserved: boolean,
  field: string
): string[] {
  const validation = validateResearchReportDecisionState(value);
  if (!validation.ok) return validation.errors.map((error) => `${field}.${error}`);
  if (validation.value.availability !== "preserved") return [];
  const errors: string[] = [];
  if (validation.value.binding.symbol !== symbol) errors.push(`${field}.researchReportDecision symbol must match check symbol`);
  if (conditionalPreserved) errors.push(`${field}.researchReportDecision cannot coexist with a preserved conditionalDecision`);
  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(value: Record<string, unknown>, field: string, allowed: string[], errors: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${field}.${key} is not supported`);
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${field} must be a non-empty string`);
}
