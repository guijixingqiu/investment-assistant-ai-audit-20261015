import { isRfc3339DateTime } from "./factMetadata.js";
import type { ResearchMaterialData, ResearchMaterialDeletionData } from "./researchMaterial.js";

export const RESEARCH_DOCUMENT_SCHEMA_VERSION = "2026-08-19.research-document.v3";
export const RESEARCH_DOCUMENT_SEARCH_SCHEMA_VERSION = "2026-08-13.research-document-search.v1";
export const RESEARCH_DOCUMENT_OCR_ENGINE = "apple_vision_pdfkit";
export const RESEARCH_DOCUMENT_SEARCH_GLOSSARY_VERSION = "finance-glossary-cjk-v1";

export interface ImportResearchDocumentMetadata {
  membershipVersion: number;
  title: string;
  publishedAt: string;
  sourceVersion: string;
  rightsConfirmed: true;
  idempotencyKey: string;
}

export interface ConfirmResearchDocumentFactRequest {
  membershipVersion: number;
  pageNumber: number;
  quote: string;
  statement: string;
  validUntil: string;
  replacesMaterialId?: string | null;
  idempotencyKey: string;
}

/** The OCR excerpt is original machine text; correctedText and note are Owner-authored. */
export interface CreateResearchDocumentOcrCorrectionNoteRequest {
  membershipVersion: number;
  pageNumber: number;
  pageTextSha256: string;
  ocrExcerpt: string;
  correctedText: string;
  note?: string | null;
  validUntil: string;
  replacesMaterialId?: string | null;
  idempotencyKey: string;
}

export interface ResearchDocumentData {
  id: string;
  membershipId: string;
  membershipVersionAtImport: number;
  market: "HK";
  code: string;
  symbol: string;
  title: string;
  originalFilename: string;
  publishedAt: string;
  importedAt: string;
  sourceVersion: string;
  parserName: "pdfjs-dist";
  parserVersion: "6.2.108";
  normalizationVersion: "nfkc-whitespace-v1";
  sourceClassification: "owner_declared_official" | "authorized_public_issuer_document";
  rightsStatus: "user_provided" | "authorized_public";
  rightsConfirmedAt: string;
  rightsDeclarationVersion: "owner-local-processing-rights-v1" | "official-public-local-research-v1";
  capturedSourceUrl?:string|null; publisher?:string|null; documentKind?:string|null; sourceLeadId?:string|null;
  sourceState: "available" | "missing" | "corrupt";
  pdfSha256: string;
  byteLength: number;
  pageCount: number;
  ocr: ResearchDocumentOcrProvenance;
}

/**
 * Explicit local-OCR provenance. `none` means the stored text came only from the
 * PDF text layer (including documents imported before OCR existed); `applied`
 * names the engine, version and page numbers that were recognized locally;
 * `unavailable` records that scanned pages stayed blank because local OCR was
 * not usable on this host.
 */
export interface ResearchDocumentOcrProvenance {
  status: "none" | "applied" | "unavailable";
  engine: typeof RESEARCH_DOCUMENT_OCR_ENGINE | null;
  engineVersion: string | null;
  pageNumbers: number[];
  appliedAt: string | null;
}

export interface ResearchDocumentImportData {
  result: "created" | "deduplicated";
  document: ResearchDocumentData;
}

export interface ResearchDocumentPageData {
  documentId: string;
  pageNumber: number;
  normalizedText: string;
  pageTextSha256: string;
  textSource: ResearchDocumentPageTextSource;
}

/** `ocr` pages are locally recognized and await manual verification. */
export type ResearchDocumentPageTextSource = "text_layer" | "ocr" | "blank";

export interface ResearchDocumentListEnvelope {
  schemaVersion: typeof RESEARCH_DOCUMENT_SCHEMA_VERSION;
  generatedAt: string;
  status: "available";
  requestedActorId: string;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  documents: ResearchDocumentData[];
  materials: ResearchMaterialData[];
  materialDeletions: ResearchMaterialDeletionData[];
}

export type ResearchDocumentSearchHitKind = "document" | "page" | "material";

export interface ResearchDocumentSearchHit {
  id: string;
  kind: ResearchDocumentSearchHitKind;
  documentId: string;
  pageNumber: number;
  materialId: string | null;
  title: string;
  excerpt: string;
  sourceVersion: string;
  publishedAt: string;
  pageTextSha256: string;
  sourceState: "available";
  evidenceStatus: "searchable_text_only" | "ocr_text_pending_manual_verification" | "owner_ocr_correction_note_unverified";
}

export interface ResearchDocumentSearchEnvelope {
  schemaVersion: typeof RESEARCH_DOCUMENT_SEARCH_SCHEMA_VERSION;
  generatedAt: string;
  status: "available" | "unavailable";
  requestedActorId: string;
  membershipId: string;
  membershipVersion: number | null;
  symbol: string | null;
  query: string;
  search: {
    engine: "postgresql_native_fts";
    configuration: "simple";
    ocrUsed: boolean;
    glossaryVersion: typeof RESEARCH_DOCUMENT_SEARCH_GLOSSARY_VERSION | null;
    suggestedQueries?: string[];
  };
  results: ResearchDocumentSearchHit[];
  message: string;
}

export function unavailableResearchDocumentSearch(
  requestedActorId: string,
  membershipId: string,
  query: string,
  message: string,
  generatedAt = new Date().toISOString()
): ResearchDocumentSearchEnvelope {
  return {
    schemaVersion: RESEARCH_DOCUMENT_SEARCH_SCHEMA_VERSION,
    generatedAt,
    status: "unavailable",
    requestedActorId,
    membershipId,
    membershipVersion: null,
    symbol: null,
    query,
    search: {
      engine: "postgresql_native_fts",
      configuration: "simple",
      ocrUsed: false,
      glossaryVersion: null
    },
    results: [],
    message
  };
}

export function validateResearchDocumentSearchEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["search envelope must be an object"]);
  exact(value, [
    "schemaVersion", "generatedAt", "status", "requestedActorId", "membershipId",
    "membershipVersion", "symbol", "query", "search", "results", "message"
  ], "search envelope", errors);
  if (value.schemaVersion !== RESEARCH_DOCUMENT_SEARCH_SCHEMA_VERSION) errors.push("search schemaVersion is invalid");
  instant(value.generatedAt, "generatedAt", errors);
  if (value.status !== "available" && value.status !== "unavailable") errors.push("search status is invalid");
  bounded(value.requestedActorId, "requestedActorId", 200, errors);
  positiveId(value.membershipId, "membershipId", errors);
  bounded(value.query, "query", 80, errors);
  if (!record(value.search) || value.search.engine !== "postgresql_native_fts"
    || value.search.configuration !== "simple" || typeof value.search.ocrUsed !== "boolean"
    || (value.search.glossaryVersion !== null && value.search.glossaryVersion !== RESEARCH_DOCUMENT_SEARCH_GLOSSARY_VERSION)) {
    errors.push("search provenance is invalid");
  }
  if (record(value.search) && value.search.suggestedQueries !== undefined) {
    const suggestions = value.search.suggestedQueries;
    if (!Array.isArray(suggestions) || suggestions.length > 4
      || suggestions.some((term) => typeof term !== "string" || term.length < 1 || term.length > 80
        || term.trim() !== term || term === value.query)
      || new Set(suggestions).size !== suggestions.length) {
      errors.push("search suggestedQueries are invalid");
    }
  }
  if (typeof value.message !== "string" || value.message.trim().length === 0) errors.push("search message is required");
  if (!Array.isArray(value.results) || value.results.length > 20) errors.push("search results must contain at most 20 items");
  else {
    for (const hit of value.results) validateResearchDocumentSearchHit(hit, value.generatedAt, errors);
    const ids = value.results.flatMap((hit) => record(hit) && typeof hit.id === "string" ? [hit.id] : []);
    if (new Set(ids).size !== ids.length) errors.push("search result identities must be unique");
  }
  if (value.status === "available") {
    positiveInteger(value.membershipVersion, "membershipVersion", errors);
    if (typeof value.symbol !== "string" || !/^HK\.\d{5}$/.test(value.symbol)) errors.push("search symbol is invalid");
  } else if (value.membershipVersion !== null || value.symbol !== null
    || Array.isArray(value.results) && value.results.length > 0) {
    errors.push("unavailable search must clear identity facts and results");
  }
  return errors.length ? invalid(errors) : { ok: true };
}

function validateResearchDocumentSearchHit(value: unknown, generatedAt: unknown, errors: string[]): void {
  if (!record(value)) {
    errors.push("search result must be an object");
    return;
  }
  exact(value, [
    "id", "kind", "documentId", "pageNumber", "materialId", "title", "excerpt",
    "sourceVersion", "publishedAt", "pageTextSha256", "sourceState", "evidenceStatus"
  ], "search result", errors);
  if (!["document", "page", "material"].includes(String(value.kind))) errors.push("search result kind is invalid");
  positiveId(value.documentId, "search result documentId", errors);
  positiveInteger(value.pageNumber, "search result pageNumber", errors);
  if (value.kind === "material") positiveId(value.materialId, "search result materialId", errors);
  else if (value.materialId !== null) errors.push("non-material search result must clear materialId");
  const expectedId = value.kind === "material"
    ? `material:${String(value.materialId)}`
    : value.kind === "page"
      ? `page:${String(value.documentId)}:${String(value.pageNumber)}`
      : `document:${String(value.documentId)}`;
  if (value.id !== expectedId) errors.push("search result id is invalid");
  bounded(value.title, "search result title", 500, errors);
  bounded(value.excerpt, "search result excerpt", 500, errors);
  bounded(value.sourceVersion, "search result sourceVersion", 200, errors);
  instant(value.publishedAt, "search result publishedAt", errors);
  if (typeof generatedAt === "string" && typeof value.publishedAt === "string"
    && Date.parse(value.publishedAt) > Date.parse(generatedAt)) errors.push("search result chronology is invalid");
  if (typeof value.pageTextSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.pageTextSha256)) errors.push("search result page hash is invalid");
  if (value.sourceState !== "available"
    || (value.evidenceStatus !== "searchable_text_only" && value.evidenceStatus !== "ocr_text_pending_manual_verification"
      && value.evidenceStatus !== "owner_ocr_correction_note_unverified")
    || value.evidenceStatus === "owner_ocr_correction_note_unverified" && value.kind !== "material") {
    errors.push("search result must remain available searchable text only");
  }
}

export function validateImportResearchDocumentMetadata(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["metadata must be an object"]);
  exact(value, ["membershipVersion", "title", "publishedAt", "sourceVersion", "rightsConfirmed", "idempotencyKey"], "metadata", errors);
  positiveInteger(value.membershipVersion, "membershipVersion", errors);
  bounded(value.title, "title", 500, errors);
  instant(value.publishedAt, "publishedAt", errors);
  bounded(value.sourceVersion, "sourceVersion", 200, errors);
  if (value.rightsConfirmed !== true) errors.push("rightsConfirmed must be true");
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return errors.length ? invalid(errors) : { ok: true };
}

export function validateConfirmResearchDocumentFactRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["request must be an object"]);
  exact(value, [
    "membershipVersion", "pageNumber", "quote", "statement", "validUntil",
    "replacesMaterialId", "idempotencyKey"
  ], "request", errors);
  positiveInteger(value.membershipVersion, "membershipVersion", errors);
  positiveInteger(value.pageNumber, "pageNumber", errors);
  bounded(value.quote, "quote", 100000, errors);
  bounded(value.statement, "statement", 4000, errors);
  instant(value.validUntil, "validUntil", errors);
  if (value.replacesMaterialId !== undefined && value.replacesMaterialId !== null) {
    positiveId(value.replacesMaterialId, "replacesMaterialId", errors);
  }
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return errors.length ? invalid(errors) : { ok: true };
}

export function validateCreateResearchDocumentOcrCorrectionNoteRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["request must be an object"]);
  exact(value, ["membershipVersion", "pageNumber", "pageTextSha256", "ocrExcerpt", "correctedText", "note",
    "validUntil", "replacesMaterialId", "idempotencyKey"], "request", errors);
  positiveInteger(value.membershipVersion, "membershipVersion", errors);
  positiveInteger(value.pageNumber, "pageNumber", errors);
  if (typeof value.pageTextSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.pageTextSha256)) errors.push("pageTextSha256 is invalid");
  bounded(value.ocrExcerpt, "ocrExcerpt", 4000, errors);
  bounded(value.correctedText, "correctedText", 4000, errors);
  if (value.note !== undefined && value.note !== null && (typeof value.note !== "string" || value.note.trim().length === 0 || value.note.length > 4000)) {
    errors.push("note must be null or a non-empty string of at most 4000 characters");
  }
  instant(value.validUntil, "validUntil", errors);
  if (value.replacesMaterialId !== undefined && value.replacesMaterialId !== null) positiveId(value.replacesMaterialId, "replacesMaterialId", errors);
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return errors.length ? invalid(errors) : { ok: true };
}

function positiveId(value: unknown, key: string, errors: string[]): void {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) errors.push(`${key} must be a positive integer string`);
}

function positiveInteger(value: unknown, key: string, errors: string[]): void {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) errors.push(`${key} must be a positive integer`);
}

function bounded(value: unknown, key: string, max: number, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    errors.push(`${key} must be a non-empty string of at most ${max} characters`);
  }
}

function instant(value: unknown, key: string, errors: string[]): void {
  if (typeof value !== "string" || !isRfc3339DateTime(value) || !Number.isFinite(Date.parse(value))) {
    errors.push(`${key} must be a valid date-time`);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[], label: string, errors: string[]): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`);
}

function invalid(errors: string[]): { ok: false; errors: string[] } {
  return { ok: false, errors };
}
