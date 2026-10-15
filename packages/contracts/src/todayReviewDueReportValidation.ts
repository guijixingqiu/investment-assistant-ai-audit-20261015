import { validateResearchReportDecisionState } from "./researchReportDecision.js";
import { isRfc3339DateTime } from "./factMetadata.js";

export function validateTodayReviewDueResearchReport(
  value: unknown,
  eventSubject: unknown,
  eventEffectiveAt: unknown,
  eventStateActor: unknown,
  errors: string[]
): void {
  if (!isRecord(value)) {
    errors.push("event.researchReport must be an object");
    return;
  }
  rejectUnknownKeys(value, [
    "availability", "binding", "investmentThesis", "invalidationConditions",
    "nextValidationQuestion", "limitation"
  ], errors);
  if (typeof value.limitation !== "string" || value.limitation.trim().length === 0) {
    errors.push("event.researchReport.limitation must be non-empty");
  }
  if (value.availability === "not_captured") {
    if (value.binding !== null || value.investmentThesis !== "UNKNOWN"
      || !Array.isArray(value.invalidationConditions) || value.invalidationConditions.length !== 0
      || value.nextValidationQuestion !== "UNKNOWN") {
      errors.push("not_captured researchReport must expose only explicit UNKNOWN report facts");
    }
    return;
  }
  if (value.availability !== "preserved") {
    errors.push("event.researchReport.availability is invalid");
    return;
  }
  const state = validateResearchReportDecisionState({
    availability: "preserved", binding: value.binding, limitation: value.limitation
  });
  if (!state.ok) errors.push(...state.errors.map((error) => `event.researchReport.${error}`));
  else if (state.value.availability === "preserved") {
    const binding = state.value.binding;
    if (binding.symbol !== eventSubject) {
      errors.push("event.researchReport binding symbol must match event subject");
    }
    if (!isRecord(eventStateActor)
      || binding.reportDecisionActorType !== eventStateActor.actorType
      || binding.reportDecisionActorId !== eventStateActor.actorId) {
      errors.push("event.researchReport binding actor must match event stateActor");
    }
    if (typeof eventEffectiveAt !== "string" || !isRfc3339DateTime(eventEffectiveAt)
      || !isRfc3339DateTime(binding.decidedAt)
      || Date.parse(binding.decidedAt) > Date.parse(eventEffectiveAt)) {
      errors.push("event.researchReport binding decidedAt must be valid and no later than event effectiveAt");
    }
  } else {
    errors.push("event.researchReport preserved binding is required");
  }
  if (typeof value.investmentThesis !== "string" || value.investmentThesis.trim().length === 0
    || value.investmentThesis === "UNKNOWN") {
    errors.push("preserved researchReport investmentThesis must be captured");
  }
  if (!Array.isArray(value.invalidationConditions) || value.invalidationConditions.length === 0
    || value.invalidationConditions.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    errors.push("preserved researchReport invalidationConditions must be captured");
  }
  if (typeof value.nextValidationQuestion !== "string" || value.nextValidationQuestion.trim().length === 0) {
    errors.push("preserved researchReport nextValidationQuestion must be captured or UNKNOWN");
  }
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: string[], errors: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`event.researchReport.${key} is not allowed`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
