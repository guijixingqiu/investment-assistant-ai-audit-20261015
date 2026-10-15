import { isRfc3339DateTime } from "./factMetadata.js";

export const RESEARCH_COMPLETENESS_SCHEMA_VERSION = "2026-08-13.research-completeness.v1";
export const RESEARCH_COMPLETENESS_THRESHOLD_VERSION = "nine-sections-seven-required-v1";
export const RESEARCH_COMPLETENESS_THRESHOLD = 7;
export const RESEARCH_COMPLETENESS_REQUIRED_SECTIONS = [
  "financials", "kpi", "peers", "valuation", "weinstein"
] as const;
export const RESEARCH_COMPLETENESS_SECTIONS = [
  "financials", "kpi", "peers", "valuation", "quant", "weinstein", "risks", "counterevidence", "conflicts"
] as const;
export const RESEARCH_COMPLETENESS_EXTERNAL_SECTIONS = [
  "valuation", "quant", "weinstein", "risks", "counterevidence", "conflicts"
] as const;

export type ResearchCompletenessSectionId = typeof RESEARCH_COMPLETENESS_SECTIONS[number];
export type ResearchCompletenessExternalSectionId = typeof RESEARCH_COMPLETENESS_EXTERNAL_SECTIONS[number];

export interface ResearchCompletenessSourceBinding {
  sourceType: "fundamentals" | "financial_requirement" | "research_context" | "valuation" | "quant" | "weinstein" | "risk" | "evidence";
  sourceId: string;
  sourceVersion: string;
  asOf: string;
  validUntil: string;
}

export interface ResearchCompletenessSection {
  section: ResearchCompletenessSectionId;
  status: "available" | "unknown";
  coverage: { achieved: number; required: number };
  sourceBindings: ResearchCompletenessSourceBinding[];
  gaps: string[];
}

export interface ResearchCompletenessExternalSectionInput extends Omit<ResearchCompletenessSection, "section"> {
  section: ResearchCompletenessExternalSectionId;
}

export interface CreateResearchCompletenessRequest {
  membershipVersion: number;
  baseSnapshotId: string | null;
  expectedFundamentalsDataCutoffAt: string | null;
  expectedResearchContextId: string | null;
  externalSections: ResearchCompletenessExternalSectionInput[];
  validUntil: string;
  ownerConfirmed: true;
  idempotencyKey: string;
}

export interface ResearchCompletenessSnapshotData {
  id: string;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  actorId: string;
  threshold: {
    version: typeof RESEARCH_COMPLETENESS_THRESHOLD_VERSION;
    availableSectionsRequired: typeof RESEARCH_COMPLETENESS_THRESHOLD;
    totalSections: 9;
  };
  score: { availableSections: number; totalSections: 9 };
  status: "evidence_insufficient" | "complete_pending_confirmation";
  confirmationEligible: boolean;
  formalDecisionEligible: boolean;
  hardBlockers: [];
  sections: ResearchCompletenessSection[];
  sourceLineage: Array<ResearchCompletenessSourceBinding & { section: ResearchCompletenessSectionId }>;
  validUntil: string;
  createdAt: string;
}

export interface ResearchCompletenessEnvelope {
  schemaVersion: typeof RESEARCH_COMPLETENESS_SCHEMA_VERSION;
  generatedAt: string;
  status: "available" | "not_found" | "unavailable";
  membershipId: string;
  requestedActorId: string;
  requestedSymbol: string | null;
  latestSnapshotId: string | null;
  data: ResearchCompletenessSnapshotData | null;
  message: string;
}

export function buildResearchCompletenessSnapshot(
  identity: Pick<ResearchCompletenessSnapshotData, "id" | "membershipId" | "membershipVersion" | "symbol" | "actorId" | "validUntil" | "createdAt">,
  derivedSections: ResearchCompletenessSection[],
  externalSections: ResearchCompletenessExternalSectionInput[]
): ResearchCompletenessSnapshotData {
  const sections = RESEARCH_COMPLETENESS_SECTIONS.map((section) =>
    [...derivedSections, ...externalSections].find((item) => item.section === section)!
  );
  const availableSections = sections.filter((section) => section.status === "available").length;
  const eligible = completenessThresholdMet(sections, availableSections);
  return {
    ...identity,
    threshold: {
      version: RESEARCH_COMPLETENESS_THRESHOLD_VERSION,
      availableSectionsRequired: RESEARCH_COMPLETENESS_THRESHOLD,
      totalSections: 9
    },
    score: { availableSections, totalSections: 9 },
    status: eligible ? "complete_pending_confirmation" : "evidence_insufficient",
    confirmationEligible: eligible,
    formalDecisionEligible: eligible,
    hardBlockers: [],
    sections,
    sourceLineage: sections.flatMap((section) => section.sourceBindings.map((binding) => ({ section: section.section, ...binding })))
  };
}

export function researchCompletenessAllowsFormalization(value: unknown): value is ResearchCompletenessSnapshotData {
  return validateResearchCompletenessSnapshot(value).ok
    && (value as ResearchCompletenessSnapshotData).status === "complete_pending_confirmation"
    && (value as ResearchCompletenessSnapshotData).confirmationEligible
    && (value as ResearchCompletenessSnapshotData).formalDecisionEligible;
}

export function validateCreateResearchCompletenessRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["request must be an object"]);
  exact(value, ["membershipVersion", "baseSnapshotId", "expectedFundamentalsDataCutoffAt", "expectedResearchContextId", "externalSections", "validUntil", "ownerConfirmed", "idempotencyKey"], "request", errors);
  if (!Number.isSafeInteger(value.membershipVersion) || Number(value.membershipVersion) < 1) errors.push("membershipVersion is invalid");
  nullableId(value.baseSnapshotId, "baseSnapshotId", errors);
  if (value.expectedFundamentalsDataCutoffAt !== null && !instantOk(value.expectedFundamentalsDataCutoffAt)) errors.push("expectedFundamentalsDataCutoffAt is invalid");
  nullableId(value.expectedResearchContextId, "expectedResearchContextId", errors);
  validateExternalSections(value.externalSections, errors);
  if (!instantOk(value.validUntil)) errors.push("validUntil is invalid");
  if (value.ownerConfirmed !== true) errors.push("ownerConfirmed must be true");
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return errors.length ? invalid(errors) : { ok: true };
}

export function validateResearchCompletenessSnapshot(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["completeness snapshot must be an object"]);
  exact(value, ["id", "membershipId", "membershipVersion", "symbol", "actorId", "threshold", "score", "status", "confirmationEligible", "formalDecisionEligible", "hardBlockers", "sections", "sourceLineage", "validUntil", "createdAt"], "snapshot", errors);
  positiveId(value.id, "id", errors); positiveId(value.membershipId, "membershipId", errors);
  if (!Number.isSafeInteger(value.membershipVersion) || Number(value.membershipVersion) < 1) errors.push("membershipVersion is invalid");
  if (typeof value.symbol !== "string" || !/^HK\.\d{5}$/.test(value.symbol)) errors.push("symbol is invalid");
  bounded(value.actorId, "actorId", 200, errors);
  if (!record(value.threshold) || value.threshold.version !== RESEARCH_COMPLETENESS_THRESHOLD_VERSION
    || value.threshold.availableSectionsRequired !== RESEARCH_COMPLETENESS_THRESHOLD || value.threshold.totalSections !== 9) errors.push("threshold is invalid");
  if (!Array.isArray(value.sections) || value.sections.length !== RESEARCH_COMPLETENESS_SECTIONS.length) errors.push("sections are invalid");
  else {
    value.sections.forEach((section, index) => validateSection(section, `sections[${index}]`, errors));
    const ids = value.sections.filter(record).map((section) => section.section);
    if (new Set(ids).size !== RESEARCH_COMPLETENESS_SECTIONS.length || RESEARCH_COMPLETENESS_SECTIONS.some((id) => !ids.includes(id))) errors.push("sections must contain every shared completeness section exactly once");
  }
  const available = Array.isArray(value.sections) ? value.sections.filter((section) => record(section) && section.status === "available").length : -1;
  const eligible = completenessThresholdMet(value.sections as ResearchCompletenessSection[], available);
  if (!record(value.score) || value.score.availableSections !== available || value.score.totalSections !== 9
    || value.status !== (eligible ? "complete_pending_confirmation" : "evidence_insufficient")
    || value.confirmationEligible !== eligible || value.formalDecisionEligible !== eligible
    || !Array.isArray(value.hardBlockers) || value.hardBlockers.length !== 0) errors.push("score or formalization gates are inconsistent");
  if (!Array.isArray(value.sourceLineage) || !sameJson(value.sourceLineage, expectedLineage(value.sections))) errors.push("sourceLineage must exactly preserve section bindings");
  if (!instantOk(value.validUntil) || !instantOk(value.createdAt) || Date.parse(String(value.validUntil)) <= Date.parse(String(value.createdAt))) errors.push("snapshot timeline is invalid");
  return errors.length ? invalid(errors) : { ok: true };
}

export function validateResearchCompletenessEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  if (!record(value) || value.schemaVersion !== RESEARCH_COMPLETENESS_SCHEMA_VERSION || !instantOk(value.generatedAt)
    || !["available", "not_found", "unavailable"].includes(String(value.status)) || !positiveIdOk(value.membershipId)
    || typeof value.requestedActorId !== "string" || !(value.requestedSymbol === null || typeof value.requestedSymbol === "string" && /^HK\.\d{5}$/.test(value.requestedSymbol))
    || !(value.latestSnapshotId === null || positiveIdOk(value.latestSnapshotId))
    || typeof value.message !== "string") return invalid(["completeness envelope is invalid"]);
  if (value.status === "available") {
    if (!record(value.data) || !validateResearchCompletenessSnapshot(value.data).ok
      || value.data.membershipId !== value.membershipId || value.data.actorId !== value.requestedActorId || value.data.symbol !== value.requestedSymbol) return invalid(["available completeness envelope identity is invalid"]);
    if (value.latestSnapshotId !== value.data.id) return invalid(["available completeness latest identity is invalid"]);
  } else if (value.data !== null) return invalid(["non-available completeness envelope must not include data"]);
  return { ok: true };
}

function validateExternalSections(value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length !== RESEARCH_COMPLETENESS_EXTERNAL_SECTIONS.length) { errors.push("externalSections must contain six sections"); return; }
  value.forEach((section, index) => validateSection(section, `externalSections[${index}]`, errors, true));
  const ids = value.filter(record).map((section) => section.section);
  if (new Set(ids).size !== RESEARCH_COMPLETENESS_EXTERNAL_SECTIONS.length || RESEARCH_COMPLETENESS_EXTERNAL_SECTIONS.some((id) => !ids.includes(id))) errors.push("externalSections must contain each external section exactly once");
}

function validateSection(value: unknown, field: string, errors: string[], external = false): void {
  if (!record(value)) { errors.push(`${field} is invalid`); return; }
  exact(value, ["section", "status", "coverage", "sourceBindings", "gaps"], field, errors);
  const ids = external ? RESEARCH_COMPLETENESS_EXTERNAL_SECTIONS : RESEARCH_COMPLETENESS_SECTIONS;
  if (!ids.includes(value.section as never) || !["available", "unknown"].includes(String(value.status))) errors.push(`${field} identity or status is invalid`);
  if (!record(value.coverage) || !Number.isSafeInteger(value.coverage.achieved) || !Number.isSafeInteger(value.coverage.required)
    || Number(value.coverage.achieved) < 0 || Number(value.coverage.required) < 1 || Number(value.coverage.achieved) > Number(value.coverage.required)) errors.push(`${field}.coverage is invalid`);
  if (!Array.isArray(value.sourceBindings) || value.sourceBindings.length > 100) errors.push(`${field}.sourceBindings is invalid`);
  else value.sourceBindings.forEach((binding, index) => validateBinding(binding, `${field}.sourceBindings[${index}]`, errors));
  if (!Array.isArray(value.gaps) || value.gaps.length > 100 || value.gaps.some((gap) => typeof gap !== "string" || !gap.trim() || gap.length > 1000)) errors.push(`${field}.gaps is invalid`);
  const coverage = record(value.coverage) ? value.coverage : null;
  const sourceBindings = Array.isArray(value.sourceBindings) ? value.sourceBindings : [];
  const gaps = Array.isArray(value.gaps) ? value.gaps : [];
  if (value.status === "available" ? coverage?.achieved !== coverage?.required || sourceBindings.length === 0 : gaps.length === 0) errors.push(`${field} status does not match coverage, sources, or UNKNOWN gaps`);
}

function validateBinding(value: unknown, field: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${field} is invalid`); return; }
  exact(value, ["sourceType", "sourceId", "sourceVersion", "asOf", "validUntil"], field, errors);
  if (!["fundamentals", "financial_requirement", "research_context", "valuation", "quant", "weinstein", "risk", "evidence"].includes(String(value.sourceType))) errors.push(`${field}.sourceType is invalid`);
  bounded(value.sourceId, `${field}.sourceId`, 300, errors); bounded(value.sourceVersion, `${field}.sourceVersion`, 300, errors);
  if (!instantOk(value.asOf) || !instantOk(value.validUntil) || Date.parse(String(value.validUntil)) <= Date.parse(String(value.asOf))) errors.push(`${field} timeline is invalid`);
}

function expectedLineage(sections: unknown): unknown[] {
  return Array.isArray(sections) ? sections.flatMap((section) => record(section) && Array.isArray(section.sourceBindings)
    ? section.sourceBindings.map((binding) => ({ section: section.section, ...(record(binding) ? binding : {}) })) : []) : [];
}
function completenessThresholdMet(sections: ResearchCompletenessSection[], available: number): boolean {
  return available >= RESEARCH_COMPLETENESS_THRESHOLD
    && RESEARCH_COMPLETENESS_REQUIRED_SECTIONS.every((id) => sections.some((section) => section.section === id && section.status === "available"));
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[], field: string, errors: string[]): void { const expected = [...keys].sort(); const actual = Object.keys(value).sort(); if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) errors.push(`${field} has unexpected or missing keys`); }
function instantOk(value: unknown): value is string { return typeof value === "string" && isRfc3339DateTime(value) && Number.isFinite(Date.parse(value)); }
function positiveId(value: unknown, field: string, errors: string[]): void { if (!positiveIdOk(value)) errors.push(`${field} must be a positive integer string`); }
function positiveIdOk(value: unknown): value is string { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function nullableId(value: unknown, field: string, errors: string[]): void { if (value !== null && !positiveIdOk(value)) errors.push(`${field} must be null or a positive integer string`); }
function bounded(value: unknown, field: string, max: number, errors: string[]): void { if (typeof value !== "string" || !value.trim() || value.length > max) errors.push(`${field} is invalid`); }
function sameJson(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function invalid(errors: string[]): { ok: false; errors: string[] } { return { ok: false, errors }; }
