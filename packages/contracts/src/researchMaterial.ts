import { isRfc3339DateTime } from "./factMetadata.js";
import {FUTU_FINANCIAL_STATEMENT_SOURCE,validFutuFinancialMaterialSource,type FutuFinancialMaterialSource} from "./researchFutuFinancialStatement.js";
import type { ResearchSnapshotTextCitation } from "./researchSourceCitation.js";
import {
  validateResearchReportDecisionBinding,
  type ResearchReportDecisionBinding
} from "./researchReportDecision.js";

export const MATERIAL_CLAIM_TYPES = ["verified_fact", "issuer_statement", "third_party_statement", "model_inference"] as const;
export const MATERIAL_VERIFICATION_STATUSES = ["verified", "unverified", "conflict", "rejected"] as const;
export const MATERIAL_RIGHTS_STATUSES = ["user_provided", "authorized_public", "restricted", "unknown"] as const;
export const OWNER_PROVIDED_PDF_SOURCE_TYPE = "owner_provided_pdf";
export const ISSUER_PUBLIC_PDF_SOURCE_TYPE = "issuer_public_pdf";
export const ISSUER_PUBLIC_HTML_SOURCE_TYPE = "issuer_public_html";
/** An Owner's unverified transcription note bound to an unchanged OCR PDF page. */
export const OWNER_OCR_CORRECTION_NOTE_SOURCE_TYPE = "owner_ocr_correction_note";
export const OWNER_REPORT_REVIEW_CORRECTION_SOURCE_TYPE = "owner_report_review_correction";
export const OWNER_ASSISTANT_REPORT_CORRECTION_SOURCE_TYPE = "owner_assistant_report_correction";
export const OWNER_PRIOR_JUDGMENT_NOTE_SOURCE_TYPE = "owner_prior_judgment_note";
export const OWNER_VERIFIED_HOLDING_LOGIC_SOURCE_TYPE = "owner_verified_holding_logic";
export type MaterialClaimType = (typeof MATERIAL_CLAIM_TYPES)[number];
export type MaterialVerificationStatus = (typeof MATERIAL_VERIFICATION_STATUSES)[number];
export type MaterialRightsStatus = (typeof MATERIAL_RIGHTS_STATUSES)[number];

export interface ResearchMaterialCitation {
  documentId: string;
  pageNumber: number;
  pageTextSha256: string;
}

export interface OwnerReportCorrectionBinding {
  decisionCheckId: string;
  reviewId: string;
  reviewOutcome: "thesis_weakened" | "thesis_invalidated";
  reviewedAt: string;
  reportBinding: ResearchReportDecisionBinding;
}

export interface OwnerAssistantReportCorrectionBinding {
  reportId: string;
  reportVersion: number;
  reportFingerprint: string;
  evidencePackId: string;
  evidencePackFingerprint: string;
}

export interface PriorDecisionBinding {
  decisionCheckId: string;
  checkedAt: string;
  excerpt: string;
  ownerConfirmedNonSensitive: true;
}

export function ownerPriorJudgmentNoteFields(
  symbol: string,
  binding: Pick<PriorDecisionBinding, "decisionCheckId" | "checkedAt" | "excerpt">
) {
  const contentText = `历史人工判断摘录（非当前事实或生效决定）\n来源：${symbol} · 普通判断 #${binding.decisionCheckId} · ${binding.checkedAt}\nOwner 明确选择的非敏感片段：\n${binding.excerpt}`;
  return {
    title: `历史人工判断 · ${symbol} · #${binding.decisionCheckId}`,
    contentText,
    summary: contentText,
    sourceVersion: `decision-check:${binding.decisionCheckId}:${binding.checkedAt}`,
    publishedAt: binding.checkedAt
  };
}

export interface CreateResearchMaterialRequest {
  membershipId: string;
  membershipVersion: number;
  title: string;
  contentText: string;
  sourceType: string;
  sourceUrl?: string | null;
  publishedAt: string | null;
  claimType: MaterialClaimType;
  verificationStatus: MaterialVerificationStatus;
  rightsStatus: MaterialRightsStatus;
  sourceVersion: string;
  replacesMaterialId?: string | null;
  validUntil: string;
  summary: string;
  variableName?: string | null;
  stance: "support" | "refute" | "neutral";
  reliability?: number | null;
  materiality?: number | null;
  isRead?: boolean;
  ownerCorrectionBinding?: OwnerReportCorrectionBinding;
  assistantCorrectionBinding?: OwnerAssistantReportCorrectionBinding;
  priorDecisionBinding?: PriorDecisionBinding;
  idempotencyKey: string;
}

export interface ResearchMaterialData {
  id: string;
  evidenceId: string;
  market: "HK";
  code: string;
  symbol: string;
  materialKind: "text";
  title: string;
  contentText: string;
  sourceType: string;
  sourceUrl: string | null;
  publishedAt: string | null;
  capturedAt: string;
  contentFingerprint: string;
  claimType: MaterialClaimType;
  verificationStatus: MaterialVerificationStatus;
  rightsStatus: MaterialRightsStatus;
  sourceVersion: string;
  replacesMaterialId: string | null;
  revision: number;
  revisionState: "current" | "replaced";
  validUntil: string;
  freshness: "fresh" | "stale";
  summary: string;
  variableName: string | null;
  stance: "support" | "refute" | "neutral";
  reliability: number | null;
  materiality: number | null;
  isRead: boolean;
  citation?: ResearchMaterialCitation | null;
  snapshotCitation?: ResearchSnapshotTextCitation | null;
  snapshotOriginal?: {rawSha256:string;byteLength:number;mediaType:"text/html";canonicalUrl:string;responseUrl:string} | null;
  futuFinancialSource?:FutuFinancialMaterialSource;
}

export interface DeleteResearchMaterialRequest {
  membershipVersion: number;
  idempotencyKey: string;
}

export interface ResearchMaterialDeletionData {
  materialId: string;
  evidenceId: string;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  contentFingerprint: string;
  deletedAt: string;
  state: "deleted";
}

export function validateCreateResearchMaterialRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["request must be an object"]);
  exact(value, [
    "membershipId", "membershipVersion", "title", "contentText", "sourceType", "sourceUrl", "publishedAt",
    "claimType", "verificationStatus", "rightsStatus", "sourceVersion", "replacesMaterialId", "validUntil", "summary", "variableName",
    "stance", "reliability", "materiality", "isRead", "ownerCorrectionBinding", "assistantCorrectionBinding",
    "priorDecisionBinding", "idempotencyKey"
  ], "request", errors);
  positiveId(value.membershipId, "membershipId", errors);
  positiveInteger(value.membershipVersion, "membershipVersion", errors);
  bounded(value.title, "title", 500, errors);
  bounded(value.contentText, "contentText", 100000, errors);
  bounded(value.sourceType, "sourceType", 200, errors);
  if (value.sourceUrl !== undefined && !optionalHttpUrlOk(value.sourceUrl)) {
    errors.push("sourceUrl must be null or an absolute http(s) URL of at most 2000 characters");
  }
  if(value.publishedAt!==null || value.sourceType!==FUTU_FINANCIAL_STATEMENT_SOURCE)
    instant(value.publishedAt, "publishedAt", errors);
  if (!MATERIAL_CLAIM_TYPES.includes(value.claimType as MaterialClaimType)) errors.push("claimType is invalid");
  if (!MATERIAL_VERIFICATION_STATUSES.includes(value.verificationStatus as MaterialVerificationStatus)) errors.push("verificationStatus is invalid");
  if (!MATERIAL_RIGHTS_STATUSES.includes(value.rightsStatus as MaterialRightsStatus)) errors.push("rightsStatus is invalid");
  bounded(value.sourceVersion, "sourceVersion", 200, errors);
  if (value.replacesMaterialId !== undefined && value.replacesMaterialId !== null) positiveId(value.replacesMaterialId, "replacesMaterialId", errors);
  instant(value.validUntil, "validUntil", errors);
  if (value.publishedAt!==null && date(value.validUntil) <= date(value.publishedAt)) errors.push("validUntil must be later than publishedAt");
  bounded(value.summary, "summary", 4000, errors);
  optionalBounded(value.variableName, "variableName", 500, errors);
  if (!["support", "refute", "neutral"].includes(String(value.stance))) errors.push("stance is invalid");
  score(value.reliability, "reliability", errors);
  score(value.materiality, "materiality", errors);
  if (value.isRead !== undefined && typeof value.isRead !== "boolean") errors.push("isRead must be a boolean");
  validateOwnerCorrectionBinding(value, errors);
  validatePriorDecisionBinding(value, errors);
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  if (value.claimType === "verified_fact" && value.verificationStatus !== "verified") errors.push("verified_fact requires verificationStatus=verified");
  return errors.length ? invalid(errors) : { ok: true };
}

function validatePriorDecisionBinding(value: Record<string, unknown>, errors: string[]): void {
  if (value.sourceType !== OWNER_PRIOR_JUDGMENT_NOTE_SOURCE_TYPE) {
    if (value.priorDecisionBinding !== undefined)
      errors.push("priorDecisionBinding is reserved for Owner prior judgment notes");
    return;
  }
  const binding = value.priorDecisionBinding;
  if (!record(binding)) {
    errors.push("Owner prior judgment notes require priorDecisionBinding");
    return;
  }
  exact(binding, ["decisionCheckId", "checkedAt", "excerpt", "ownerConfirmedNonSensitive"], "priorDecisionBinding", errors);
  positiveId(binding.decisionCheckId, "priorDecisionBinding.decisionCheckId", errors);
  if (!canonicalInstant(binding.checkedAt)) errors.push("priorDecisionBinding.checkedAt must be an exact UTC instant");
  if (!validPriorDecisionExcerpt(binding.excerpt))
    errors.push("priorDecisionBinding.excerpt must be a trimmed contiguous selection of 1 to 1000 UTF-16 characters");
  if (binding.ownerConfirmedNonSensitive !== true)
    errors.push("priorDecisionBinding.ownerConfirmedNonSensitive must be true");
  if (value.claimType !== "model_inference" || value.verificationStatus !== "unverified"
    || value.rightsStatus !== "user_provided" || value.stance !== "neutral"
    || value.sourceUrl != null || value.replacesMaterialId != null || value.isRead !== true
    || value.variableName != null || value.reliability != null || value.materiality != null)
    errors.push("Owner prior judgment notes must remain isolated unverified neutral Owner materials");
  if (value.publishedAt !== binding.checkedAt
    || value.sourceVersion !== `decision-check:${binding.decisionCheckId}:${binding.checkedAt}`
    || value.contentText !== value.summary)
    errors.push("Owner prior judgment note date, source version, and summary must match the selected excerpt");
}

export function validateDeleteResearchMaterialRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["request must be an object"]);
  exact(value, ["membershipVersion", "idempotencyKey"], "request", errors);
  positiveInteger(value.membershipVersion, "membershipVersion", errors);
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return errors.length ? invalid(errors) : { ok: true };
}

export function validateResearchMaterialDeletionData(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["material deletion must be an object"]);
  exact(value, [
    "materialId", "evidenceId", "membershipId", "membershipVersion", "symbol",
    "contentFingerprint", "deletedAt", "state"
  ], "material deletion", errors);
  positiveId(value.materialId, "materialId", errors);
  positiveId(value.evidenceId, "evidenceId", errors);
  positiveId(value.membershipId, "membershipId", errors);
  positiveInteger(value.membershipVersion, "membershipVersion", errors);
  if (typeof value.symbol !== "string" || !/^HK\.\d{5}$/.test(value.symbol)) errors.push("symbol is invalid");
  if (!sha(value.contentFingerprint)) errors.push("contentFingerprint is invalid");
  instant(value.deletedAt, "deletedAt", errors);
  if (value.state !== "deleted") errors.push("state must be deleted");
  return errors.length ? invalid(errors) : { ok: true };
}

function validateOwnerCorrectionBinding(value: Record<string, unknown>, errors: string[]): void {
  if (value.sourceType === OWNER_ASSISTANT_REPORT_CORRECTION_SOURCE_TYPE) {
    if (value.ownerCorrectionBinding !== undefined) errors.push("ownerCorrectionBinding is reserved for Owner report review corrections");
    if (!record(value.assistantCorrectionBinding)) {
      errors.push("Owner assistant report corrections require assistantCorrectionBinding");
      return;
    }
    const binding = value.assistantCorrectionBinding;
    exact(binding, ["reportId", "reportVersion", "reportFingerprint", "evidencePackId", "evidencePackFingerprint"], "assistantCorrectionBinding", errors);
    positiveId(binding.reportId, "assistantCorrectionBinding.reportId", errors);
    positiveInteger(binding.reportVersion, "assistantCorrectionBinding.reportVersion", errors);
    positiveId(binding.evidencePackId, "assistantCorrectionBinding.evidencePackId", errors);
    if (!sha(binding.reportFingerprint)) errors.push("assistantCorrectionBinding.reportFingerprint is invalid");
    if (!sha(binding.evidencePackFingerprint)) errors.push("assistantCorrectionBinding.evidencePackFingerprint is invalid");
    if (value.claimType !== "model_inference" || value.verificationStatus !== "unverified"
      || value.rightsStatus !== "user_provided") {
      errors.push("Owner assistant report corrections must remain user-provided unverified model inference");
    }
    return;
  }
  if (value.sourceType !== OWNER_REPORT_REVIEW_CORRECTION_SOURCE_TYPE) {
    if (value.ownerCorrectionBinding !== undefined || value.assistantCorrectionBinding !== undefined) {
      errors.push("correction bindings are reserved for Owner report corrections");
    }
    return;
  }
  if (value.assistantCorrectionBinding !== undefined) errors.push("assistantCorrectionBinding is reserved for Owner assistant report corrections");
  if (!record(value.ownerCorrectionBinding)) {
    errors.push("Owner report review corrections require ownerCorrectionBinding");
    return;
  }
  const binding = value.ownerCorrectionBinding;
  exact(binding, ["decisionCheckId", "reviewId", "reviewOutcome", "reviewedAt", "reportBinding"], "ownerCorrectionBinding", errors);
  positiveId(binding.decisionCheckId, "ownerCorrectionBinding.decisionCheckId", errors);
  positiveId(binding.reviewId, "ownerCorrectionBinding.reviewId", errors);
  if (![
    "thesis_weakened", "thesis_invalidated"
  ].includes(String(binding.reviewOutcome))) errors.push("ownerCorrectionBinding.reviewOutcome is invalid");
  instant(binding.reviewedAt, "ownerCorrectionBinding.reviewedAt", errors);
  const reportBinding = validateResearchReportDecisionBinding(binding.reportBinding);
  if (!reportBinding.ok) errors.push(...reportBinding.errors.map((error) => `ownerCorrectionBinding.${error}`));
  if (value.claimType !== "model_inference" || value.verificationStatus !== "unverified"
    || value.rightsStatus !== "user_provided") {
    errors.push("Owner report review corrections must remain user-provided unverified model inference");
  }
}

export function validateResearchMaterialData(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  return validResearchMaterial(value) ? { ok: true } : invalid(["research material data is invalid"]);
}

export function validResearchMaterial(value: unknown): value is ResearchMaterialData {
  if (!record(value)) return false;
  const errors: string[] = [];
  exact(value, ["id", "evidenceId", "market", "code", "symbol", "materialKind", "title", "contentText", "sourceType",
    "sourceUrl", "publishedAt", "capturedAt", "contentFingerprint", "claimType", "verificationStatus", "rightsStatus",
    "sourceVersion", "replacesMaterialId", "revision", "revisionState", "validUntil", "freshness", "summary", "variableName",
    "stance", "reliability", "materiality", "isRead", "citation", "snapshotCitation", "snapshotOriginal", "futuFinancialSource"], "material", errors);
  return errors.length === 0 && positive(value.id) && positive(value.evidenceId) && value.market === "HK"
    && /^\d{5}$/.test(String(value.code)) && value.symbol === `HK.${value.code}` && value.materialKind === "text"
    && nonEmpty(value.title) && String(value.title).length <= 500
    && nonEmpty(value.contentText) && String(value.contentText).length <= 100000
    && validTrace(value) && validClassification(value) && validCitation(value)
    && (value.sourceType !== OWNER_PRIOR_JUDGMENT_NOTE_SOURCE_TYPE || validPriorJudgmentMaterial(value));
}

function validPriorJudgmentMaterial(value: Record<string, unknown>): boolean {
  const sourceVersion = value.sourceVersion;
  if (typeof sourceVersion !== "string") return false;
  const source = /^decision-check:([1-9]\d*):(.+)$/.exec(sourceVersion);
  if (!source || !canonicalInstant(source[2])) return false;
  const binding = { decisionCheckId: source[1]!, checkedAt: source[2]!, excerpt: "" };
  const prefix = ownerPriorJudgmentNoteFields(String(value.symbol), binding).contentText;
  if (typeof value.contentText !== "string" || !value.contentText.startsWith(prefix)) return false;
  binding.excerpt = value.contentText.slice(prefix.length);
  const expected = ownerPriorJudgmentNoteFields(String(value.symbol), binding);
  return validPriorDecisionExcerpt(binding.excerpt)
    && value.title === expected.title && value.summary === expected.summary
    && value.publishedAt === expected.publishedAt && value.claimType === "model_inference"
    && value.verificationStatus === "unverified" && value.rightsStatus === "user_provided"
    && value.sourceUrl === null && value.replacesMaterialId === null
    && value.variableName === null && value.reliability === null && value.materiality === null
    && value.stance === "neutral" && value.isRead === true;
}

function validPriorDecisionExcerpt(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1000
    && value.trim() === value && !value.includes("\u0000");
}

function canonicalInstant(value: unknown): value is string {
  return typeof value === "string" && instantOk(value) && new Date(value).toISOString() === value;
}

function validCitation(value: Record<string, unknown>): boolean {
  if (value.sourceType === ISSUER_PUBLIC_HTML_SOURCE_TYPE) {
    if (value.citation !== null && value.citation !== undefined || !record(value.snapshotCitation)
      || !record(value.snapshotOriginal)) return false;
    const c = value.snapshotCitation, errors: string[] = [];
    exact(c, ["kind", "snapshotId", "textSha256", "startUtf16", "endUtf16", "excerptSha256"], "snapshotCitation", errors);
    const original=value.snapshotOriginal;
    exact(original,["rawSha256","byteLength","mediaType","canonicalUrl","responseUrl"],"snapshotOriginal",errors);
    return errors.length === 0 && c.kind === "source_snapshot" && positive(c.snapshotId) && sha(c.textSha256)
      && Number.isSafeInteger(c.startUtf16) && Number(c.startUtf16) >= 0
      && Number.isSafeInteger(c.endUtf16) && Number(c.endUtf16) > Number(c.startUtf16) && sha(c.excerptSha256)
      && sha(original.rawSha256) && Number.isSafeInteger(original.byteLength) && Number(original.byteLength)>0
      && original.mediaType==="text/html" && typeof original.canonicalUrl==="string"
      && typeof original.responseUrl==="string" && original.canonicalUrl.startsWith("https://")
      && original.responseUrl.startsWith("https://");
  }
  if (value.snapshotCitation !== null && value.snapshotCitation !== undefined
    || value.snapshotOriginal !== null && value.snapshotOriginal !== undefined) return false;
  if (value.citation === undefined || value.citation === null) return ![OWNER_PROVIDED_PDF_SOURCE_TYPE,ISSUER_PUBLIC_PDF_SOURCE_TYPE,OWNER_OCR_CORRECTION_NOTE_SOURCE_TYPE].includes(String(value.sourceType));
  if (!record(value.citation)) return false;
  const errors: string[] = [];
  exact(value.citation, ["documentId", "pageNumber", "pageTextSha256"], "citation", errors);
  return errors.length === 0 && [OWNER_PROVIDED_PDF_SOURCE_TYPE,ISSUER_PUBLIC_PDF_SOURCE_TYPE,OWNER_OCR_CORRECTION_NOTE_SOURCE_TYPE].includes(String(value.sourceType))
    && positive(value.citation.documentId) && positiveIntegerOk(value.citation.pageNumber)
    && typeof value.citation.pageTextSha256 === "string" && /^[a-f0-9]{64}$/.test(value.citation.pageTextSha256);
}

function validTrace(value: Record<string, unknown>): boolean {
  return nonEmpty(value.sourceType) && String(value.sourceType).length <= 200 && optionalHttpUrlOk(value.sourceUrl)
    && (instantOk(value.publishedAt) || value.publishedAt===null && [FUTU_FINANCIAL_STATEMENT_SOURCE,"deleted"].includes(String(value.sourceType)))
    && instantOk(value.capturedAt) && (value.publishedAt===null || date(value.publishedAt) <= date(value.capturedAt))
    && typeof value.contentFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.contentFingerprint)
    && nonEmpty(value.sourceVersion) && String(value.sourceVersion).length <= 200
    && (value.replacesMaterialId === null || positive(value.replacesMaterialId))
    && positiveIntegerOk(value.revision) && ["current", "replaced"].includes(String(value.revisionState))
    && instantOk(value.validUntil) && date(value.validUntil) > date(value.publishedAt??value.capturedAt)
    && ["fresh", "stale"].includes(String(value.freshness));
}

function validClassification(value: Record<string, unknown>): boolean {
  if (!MATERIAL_CLAIM_TYPES.includes(value.claimType as MaterialClaimType)
    || !MATERIAL_VERIFICATION_STATUSES.includes(value.verificationStatus as MaterialVerificationStatus)
    || !MATERIAL_RIGHTS_STATUSES.includes(value.rightsStatus as MaterialRightsStatus)) return false;
  if(value.sourceType===FUTU_FINANCIAL_STATEMENT_SOURCE
    && (value.claimType!=="third_party_statement"||value.verificationStatus!=="unverified"
      ||value.rightsStatus!=="user_provided"||value.publishedAt!==null||value.sourceUrl!==null
      ||!validFutuFinancialMaterialSource(value.futuFinancialSource)
      ||value.futuFinancialSource.symbol!==value.symbol))return false;
  if (value.sourceType === OWNER_OCR_CORRECTION_NOTE_SOURCE_TYPE && !validOcrCorrectionClassification(value)) return false;
  if (value.sourceType === "deleted") {
    return value.title === "[deleted]" && value.contentText === "[deleted]"
      && value.sourceUrl === null && value.verificationStatus === "rejected"
      && value.rightsStatus === "unknown" && value.summary === "[deleted]"
      && value.variableName === null && value.stance === "neutral"
      && value.reliability === null && value.materiality === null
      && value.isRead === true && (value.citation === undefined || value.citation === null);
  }
  return (value.claimType !== "verified_fact" || value.verificationStatus === "verified")
    && nonEmpty(value.summary) && String(value.summary).length <= 4000
    && (value.variableName === null || nonEmpty(value.variableName) && String(value.variableName).length <= 500)
    && ["support", "refute", "neutral"].includes(String(value.stance))
    && scoreOk(value.reliability) && scoreOk(value.materiality) && typeof value.isRead === "boolean";
}

function validOcrCorrectionClassification(value: Record<string, unknown>): boolean {
  return value.claimType === "model_inference" && value.verificationStatus === "unverified"
    && value.rightsStatus === "user_provided" && value.sourceUrl === null && value.isRead === true;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[], label: string, errors: string[]): void { const allowed = new Set(keys); for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`); }
function positive(value: unknown): boolean { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function positiveId(value: unknown, key: string, errors: string[]): void { if (!positive(value)) errors.push(`${key} must be a positive integer string`); }
function positiveInteger(value: unknown, key: string, errors: string[]): void { if (!positiveIntegerOk(value)) errors.push(`${key} must be a positive integer`); }
function positiveIntegerOk(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) > 0; }
function bounded(value: unknown, key: string, max: number, errors: string[]): void { if (!nonEmpty(value) || String(value).length > max) errors.push(`${key} must be a non-empty string of at most ${max} characters`); }
function optionalBounded(value: unknown, key: string, max: number, errors: string[]): void { if (value !== undefined && value !== null && (!nonEmpty(value) || String(value).length > max)) errors.push(`${key} must be null or a non-empty string of at most ${max} characters`); }
function optionalHttpUrlOk(value: unknown): boolean { if (value === null) return true; if (typeof value !== "string" || value.length === 0 || value.length > 2000) return false; try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }
function instant(value: unknown, key: string, errors: string[]): void { if (!instantOk(value)) errors.push(`${key} must be a valid date-time`); }
function instantOk(value: unknown): boolean { return typeof value === "string" && isRfc3339DateTime(value) && Number.isFinite(Date.parse(value)); }
function date(value: unknown): number { return typeof value === "string" ? Date.parse(value) : Number.NaN; }
function nonEmpty(value: unknown): boolean { return typeof value === "string" && value.trim().length > 0; }
function score(value: unknown, key: string, errors: string[]): void { if (value !== undefined && value !== null && (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 5)) errors.push(`${key} must be null or an integer from 1 to 5`); }
function scoreOk(value: unknown): boolean { return value === null || Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5; }
function sha(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function invalid(errors: string[]): { ok: false; errors: string[] } { return { ok: false, errors }; }
