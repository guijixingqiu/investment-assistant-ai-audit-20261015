import { isRfc3339DateTime } from "./factMetadata.js";
import type { ResearchMaterialCitation } from "./researchMaterial.js";
import type { ResearchSnapshotTextCitation } from "./researchSourceCitation.js";

export const RESEARCH_FINANCIAL_REQUIREMENT_SCHEMA_VERSION = "2026-10-10.research-financial-requirement.v1";
export interface CreateResearchFinancialRequirementRequest {
  membershipVersion: number;
  baseRequirementId: string | null;
  sourceMaterials: ResearchFinancialRequirementSourceInput[];
  fiscalYearEnd: string;
  latestRequiredAnnualPeriodEnd: string;
  latestRequiredInterimPeriodStart: string;
  latestRequiredInterimPeriodEnd: string;
  asOf: string;
  nextReviewAt: string;
  ownerConfirmed: true;
  idempotencyKey: string;
}
export interface ResearchFinancialRequirementSourceInput {
  materialId: string;
  materialRevision: number;
  contentFingerprint: string;
}
export interface ResearchFinancialRequirementSource extends ResearchFinancialRequirementSourceInput {
  materialId: string;
  materialRevision: number;
  contentFingerprint: string;
  sourceVersion: string;
  sourceType: "owner_provided_pdf" | "issuer_public_pdf" | "issuer_public_html";
  citation: ResearchMaterialCitation | ResearchSnapshotTextCitation;
  originalSha256: string;
  originalByteLength: number;
}
export interface ResearchFinancialRequirementData {
  schemaVersion: typeof RESEARCH_FINANCIAL_REQUIREMENT_SCHEMA_VERSION;
  id: string;
  version: number;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  actorType: "user";
  actorId: string;
  fiscalYearEnd: string;
  latestRequiredAnnualPeriodEnd: string;
  latestRequiredInterimPeriodStart: string;
  latestRequiredInterimPeriodEnd: string;
  asOf: string;
  nextReviewAt: string;
  validUntil: string;
  sources: ResearchFinancialRequirementSource[];
  ownerConfirmed: true;
  createdAt: string;
}
export interface ResearchFinancialRequirementEnvelope {
  schemaVersion: typeof RESEARCH_FINANCIAL_REQUIREMENT_SCHEMA_VERSION;
  status: "available" | "not_found" | "unavailable";
  membershipId: string;
  requestedActorId: string;
  requestedSymbol: string | null;
  latestRequirementId: string | null;
  data: ResearchFinancialRequirementData | null;
  gaps: string[];
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d*$/.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function nextCalendarDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

function interimFitsRequiredFiscalYear(annualEnd:string,start:string,end:string,fiscalYearEnd:string):boolean {
  const year=Number(annualEnd.slice(0,4));
  const priorEnd=`${year-1}-${fiscalYearEnd}`,nextEnd=`${year+1}-${fiscalYearEnd}`;
  const thisStart=calendarDate(priorEnd)?nextCalendarDay(priorEnd):null;
  return start===thisStart && end<annualEnd
    || start===nextCalendarDay(annualEnd) && calendarDate(nextEnd) && end<nextEnd;
}

// eslint-disable-next-line complexity -- Validate every source, fiscal period, and review bound in one request boundary.
export function validateCreateResearchFinancialRequirementRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["request must be an object"] };
  const keys = ["membershipVersion","baseRequirementId","sourceMaterials",
    "fiscalYearEnd","latestRequiredAnnualPeriodEnd","latestRequiredInterimPeriodStart","latestRequiredInterimPeriodEnd",
    "asOf","nextReviewAt","ownerConfirmed","idempotencyKey"];
  if (Object.keys(value).sort().join() !== keys.sort().join()) errors.push("request keys do not match the financial requirement contract");
  if (!Number.isSafeInteger(value.membershipVersion) || Number(value.membershipVersion) < 1) errors.push("membershipVersion is invalid");
  if (value.baseRequirementId !== null && !id(value.baseRequirementId)) errors.push("baseRequirementId is invalid");
  if (!Array.isArray(value.sourceMaterials) || value.sourceMaterials.length < 1 || value.sourceMaterials.length > 4
    || value.sourceMaterials.some(source => !record(source) || Object.keys(source).sort().join() !== "contentFingerprint,materialId,materialRevision" || !id(source.materialId)
      || !Number.isSafeInteger(source.materialRevision) || Number(source.materialRevision) < 1
      || !hash(source.contentFingerprint))
    || new Set(value.sourceMaterials.map(source => record(source) ? source.materialId : null)).size !== value.sourceMaterials.length)
    errors.push("sourceMaterials must contain 1 to 4 distinct saved source references");
  if (typeof value.fiscalYearEnd !== "string" || !/^\d{2}-\d{2}$/.test(value.fiscalYearEnd)
    || !calendarDate(`2024-${value.fiscalYearEnd}`) || value.fiscalYearEnd === "02-29") errors.push("fiscalYearEnd is invalid");
  for (const name of ["latestRequiredAnnualPeriodEnd","latestRequiredInterimPeriodStart","latestRequiredInterimPeriodEnd"])
    if (!calendarDate(value[name])) errors.push(`${name} is invalid`);
  if (calendarDate(value.latestRequiredAnnualPeriodEnd) && typeof value.fiscalYearEnd === "string"
    && value.latestRequiredAnnualPeriodEnd.slice(5) !== value.fiscalYearEnd) errors.push("annual period does not end on the fiscal year end");
  if (calendarDate(value.latestRequiredAnnualPeriodEnd) && calendarDate(value.latestRequiredInterimPeriodStart)
    && calendarDate(value.latestRequiredInterimPeriodEnd) && typeof value.fiscalYearEnd === "string"
    && /^\d{2}-\d{2}$/.test(value.fiscalYearEnd)
    && !interimFitsRequiredFiscalYear(value.latestRequiredAnnualPeriodEnd,value.latestRequiredInterimPeriodStart,
      value.latestRequiredInterimPeriodEnd,value.fiscalYearEnd))
    errors.push("interim must begin at the fiscal year start within or immediately after the required annual year");
  if (calendarDate(value.latestRequiredInterimPeriodStart) && calendarDate(value.latestRequiredInterimPeriodEnd)) {
    const days = (Date.parse(value.latestRequiredInterimPeriodEnd) - Date.parse(value.latestRequiredInterimPeriodStart)) / 86400000 + 1;
    if (days < 28 || days >= 365) errors.push("interim period must be shorter than an annual period");
  }
  if (typeof value.asOf === "string" && isRfc3339DateTime(value.asOf) && calendarDate(value.latestRequiredAnnualPeriodEnd)
    && value.latestRequiredAnnualPeriodEnd > value.asOf.slice(0,10)) errors.push("required annual is later than asOf");
  if (typeof value.asOf === "string" && isRfc3339DateTime(value.asOf) && calendarDate(value.latestRequiredInterimPeriodEnd)
    && value.latestRequiredInterimPeriodEnd > value.asOf.slice(0,10)) errors.push("required interim is later than asOf");
  if (typeof value.asOf !== "string" || !isRfc3339DateTime(value.asOf)
    || typeof value.nextReviewAt !== "string" || !isRfc3339DateTime(value.nextReviewAt)
    || Date.parse(String(value.nextReviewAt)) <= Date.parse(String(value.asOf))) errors.push("asOf or nextReviewAt is invalid");
  if (value.ownerConfirmed !== true) errors.push("ownerConfirmed must be true");
  if (typeof value.idempotencyKey !== "string" || !value.idempotencyKey.trim() || value.idempotencyKey.length > 200) errors.push("idempotencyKey is invalid");
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateResearchFinancialRequirementData(value: unknown): value is ResearchFinancialRequirementData {
  if (!record(value) || value.schemaVersion !== RESEARCH_FINANCIAL_REQUIREMENT_SCHEMA_VERSION
    || !id(value.id) || !Number.isSafeInteger(value.version) || Number(value.version) < 1
    || !id(value.membershipId) || value.actorType !== "user" || typeof value.actorId !== "string" || !value.actorId
    || typeof value.symbol !== "string" || !/^HK\.\d{5}$/.test(value.symbol)
    || typeof value.validUntil !== "string" || !isRfc3339DateTime(value.validUntil)
    || typeof value.createdAt !== "string" || !isRfc3339DateTime(value.createdAt)
    || typeof value.nextReviewAt !== "string"
    || value.ownerConfirmed !== true || !Array.isArray(value.sources) || value.sources.length < 1) return false;
  const request = { membershipVersion: value.membershipVersion, baseRequirementId: null,
    sourceMaterials: value.sources.map(source => ({ materialId: source.materialId, materialRevision: source.materialRevision,
      contentFingerprint: source.contentFingerprint })), fiscalYearEnd: value.fiscalYearEnd,
    latestRequiredAnnualPeriodEnd: value.latestRequiredAnnualPeriodEnd,
    latestRequiredInterimPeriodStart: value.latestRequiredInterimPeriodStart,
    latestRequiredInterimPeriodEnd: value.latestRequiredInterimPeriodEnd, asOf: value.asOf,
    nextReviewAt: value.nextReviewAt, ownerConfirmed: true, idempotencyKey: "validation" };
  if (!validateCreateResearchFinancialRequirementRequest(request).ok
    || Date.parse(value.validUntil) > Date.parse(value.nextReviewAt)
    || Date.parse(value.validUntil) <= Date.parse(value.createdAt)) return false;
  return value.sources.every(source => hash(source.originalSha256) && Number.isSafeInteger(source.originalByteLength) && Number(source.originalByteLength) > 0
    && ["owner_provided_pdf","issuer_public_pdf","issuer_public_html"].includes(String(source.sourceType))
    && typeof source.sourceVersion === "string" && !!source.sourceVersion.trim() && record(source.citation))
    && value.sources.every(source => source.sourceType === "issuer_public_html"
    ? source.citation.kind === "source_snapshot" && id(source.citation.snapshotId)
      && hash(source.citation.textSha256) && hash(source.citation.excerptSha256)
    : id(source.citation.documentId) && Number.isSafeInteger(source.citation.pageNumber)
      && Number(source.citation.pageNumber) > 0 && hash(source.citation.pageTextSha256));
}
