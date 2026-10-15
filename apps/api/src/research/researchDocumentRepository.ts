import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  ResearchDocumentData,
  ResearchDocumentListEnvelope,
  ResearchDocumentPageData,
  ResearchDocumentSearchEnvelope,
  ResearchDocumentSearchHit
} from "../../../../packages/contracts/src/researchDocument.js";
import type { ResearchMaterialDeletionData } from "../../../../packages/contracts/src/researchMaterial.js";
import { OWNER_OCR_CORRECTION_NOTE_SOURCE_TYPE } from "../../../../packages/contracts/src/researchMaterial.js";
import {
  RESEARCH_DOCUMENT_OCR_ENGINE,
  RESEARCH_DOCUMENT_SCHEMA_VERSION,
  RESEARCH_DOCUMENT_SEARCH_SCHEMA_VERSION
} from "../../../../packages/contracts/src/researchDocument.js";
import {
  CandidateMembershipNotFoundError,
  ResearchDocumentError,
  type AuthenticatedResearchActor
} from "./domain.js";
import { readResearchMaterials } from "./deepResearchPersistence.js";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import { readResearchDocumentBytes } from "./researchDocumentCas.js";
import type { ResearchDocumentPdfLimits } from "./researchDocumentPdf.js";
import type { ResearchDocumentOcrLimits } from "./researchDocumentOcr.js";
import { compactForMatching, researchDocumentSearchQuery, suggestedFinanceSearchQueries } from "./researchDocumentSearchText.js";
import type { ResearchDocumentSearchQuery } from "./researchDocumentSearchText.js";
import { researchMaterialFingerprint } from "./deepResearchGate.js";

export const RESEARCH_DOCUMENT_PARSER_NAME = "pdfjs-dist" as const;
export const RESEARCH_DOCUMENT_PARSER_VERSION = "6.2.108" as const;
export const RESEARCH_DOCUMENT_NORMALIZATION_VERSION = "nfkc-whitespace-v1" as const;
export const RESEARCH_DOCUMENT_SOURCE_CLASSIFICATION = "owner_declared_official" as const;
/** Single external bound for one search answer: full-text and substring hits together. */
const RESEARCH_DOCUMENT_SEARCH_HIT_LIMIT = 20;
export const RESEARCH_DOCUMENT_RIGHTS_DECLARATION_VERSION = "owner-local-processing-rights-v1" as const;

export interface ResearchDocumentRow {
  id: string;
  candidate_membership_id: string;
  captured_membership_version: number | string;
  market: "HK";
  code: string;
  symbol: string;
  title: string;
  original_filename: string;
  published_at: Date | string;
  imported_at: Date | string;
  source_version: string;
  parser_name: typeof RESEARCH_DOCUMENT_PARSER_NAME;
  parser_version: typeof RESEARCH_DOCUMENT_PARSER_VERSION;
  normalization_version: typeof RESEARCH_DOCUMENT_NORMALIZATION_VERSION;
  source_classification: typeof RESEARCH_DOCUMENT_SOURCE_CLASSIFICATION | "authorized_public_issuer_document";
  rights_status: "user_provided" | "authorized_public";
  rights_confirmed_at: Date | string;
  rights_declaration_version: typeof RESEARCH_DOCUMENT_RIGHTS_DECLARATION_VERSION | "official-public-local-research-v1";
  captured_source_url?:string|null; publisher?:string|null; document_kind?:string|null; source_lead_id?:string|null;
  pdf_sha256: string;
  byte_length: number | string;
  page_count: number | string;
  ocr_status: "none" | "applied" | "unavailable";
  ocr_engine: string | null;
  ocr_engine_version: string | null;
  ocr_applied_at: Date | string | null;
  ocr_page_numbers: Array<number | string> | null;
}

export interface ResearchDocumentRepositoryOptions extends ResearchDocumentPdfLimits, ResearchDocumentOcrLimits {
  rawStoreRoot: string | null | undefined;
  repositoryRoot: string;
}

export async function listResearchDocuments(
  pool: Pool,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  options: Pick<ResearchDocumentRepositoryOptions, "rawStoreRoot" | "repositoryRoot">,
  now = new Date()
): Promise<ResearchDocumentListEnvelope> {
  const membership = await readCandidateMembershipById(pool, actor, membershipId);
  if (!membership) throw new CandidateMembershipNotFoundError();
  const rows = await pool.query<ResearchDocumentRow>(
    `${documentSelect()}
      where rd.candidate_membership_id = $1 and cm.actor_type = $2 and cm.actor_id = $3
      order by rd.imported_at desc, rd.id desc`,
    [membershipId, actor.actorType, actor.actorId]
  );
  const documents = [] as ResearchDocumentData[];
  for (const row of rows.rows) {
    const document = rowToDocument(row);
    try {
      await readResearchDocumentBytes(
        options.rawStoreRoot,
        options.repositoryRoot,
        document.pdfSha256,
        document.byteLength
      );
      documents.push(document);
    } catch (error) {
      if (!(error instanceof ResearchDocumentError)) throw error;
      if (error.code === "RAW_CONTENT_MISSING") {
        documents.push({ ...document, sourceState: "missing" });
        continue;
      }
      if (error.code === "RAW_CONTENT_HASH_MISMATCH") {
        documents.push({ ...document, sourceState: "corrupt" });
        continue;
      }
      throw error;
    }
  }
  const profile = await pool.query<{ id: string }>(
    "select id from research_profiles where market = $1 and code = $2 limit 1",
    [membership.market, membership.code]
  );
  const materials = profile.rows[0]
    ? (await readResearchMaterials(pool, profile.rows[0].id, membershipId, now))
      .filter((material) => material.citation && documents.some((document) => document.id === material.citation?.documentId))
    : [];
  const deletionRows = await pool.query<{
    material_id: string;
    evidence_id: string;
    membership_id: string;
    membership_version: number | string;
    symbol: string;
    content_fingerprint: string;
    deleted_at: Date | string;
  }>(
    `select rm.id as material_id, rm.evidence_item_id as evidence_id,
            rm.candidate_membership_id as membership_id,
            rm.deletion_membership_version as membership_version,
            cm.symbol, rm.content_fingerprint, rm.deleted_at
       from research_materials rm
       join candidate_memberships cm on cm.id = rm.candidate_membership_id
      where rm.candidate_membership_id = $1
        and cm.actor_type = $2 and cm.actor_id = $3
        and rm.deleted_at is not null
      order by rm.deleted_at desc, rm.id desc`,
    [membershipId, actor.actorType, actor.actorId]
  );
  const materialDeletions: ResearchMaterialDeletionData[] = deletionRows.rows.map((row) => ({
    materialId: String(row.material_id),
    evidenceId: String(row.evidence_id),
    membershipId: String(row.membership_id),
    membershipVersion: Number(row.membership_version),
    symbol: row.symbol,
    contentFingerprint: row.content_fingerprint,
    deletedAt: new Date(row.deleted_at).toISOString(),
    state: "deleted"
  }));
  return {
    schemaVersion: RESEARCH_DOCUMENT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    status: "available",
    requestedActorId: actor.actorId,
    membershipId,
    membershipVersion: Number(membership.version),
    symbol: membership.symbol,
    documents,
    materials,
    materialDeletions
  };
}

interface ResearchDocumentSearchRow {
  kind: "document" | "page" | "material";
  document_id: string;
  page_number: number | string;
  material_id: string | null;
  matched_text: string;
  page_text: string;
  page_text_sha256: string;
  page_ocr_applied: boolean;
  content_fingerprint: string | null;
  membership_version: number | string;
}

export async function searchResearchDocuments(
  pool: Pool,
  membershipId: string,
  query: string,
  actor: AuthenticatedResearchActor,
  options: Pick<ResearchDocumentRepositoryOptions, "rawStoreRoot" | "repositoryRoot">,
  now = new Date()
): Promise<ResearchDocumentSearchEnvelope> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery || normalizedQuery.length > 80) {
    throw new ResearchDocumentError(400, "SEARCH_QUERY_INVALID", "research document search query must contain 1 to 80 characters");
  }
  const list = await listResearchDocuments(pool, membershipId, actor, options, now);
  const searchQuery = researchDocumentSearchQuery(normalizedQuery);
  const rows = await pool.query<ResearchDocumentSearchRow>(
    `with search_query as (
       select websearch_to_tsquery('simple'::regconfig, $1) as value
     ), hits as (
       select 'document'::text as kind, rd.id as document_id, 1 as page_number,
              null::bigint as material_id, first_page.normalized_text as matched_text,
              first_page.normalized_text as page_text, first_page.text_sha256 as page_text_sha256,
              first_page.ocr_applied as page_ocr_applied,
              null::text as content_fingerprint, cm.version as membership_version,
              ts_rank_cd(
                to_tsvector('simple'::regconfig, rd.title || ' ' || rd.original_filename || ' ' || rd.source_version),
                search_query.value
              ) as rank, rd.published_at as published_at
         from research_documents rd
         join candidate_memberships cm on cm.id = rd.candidate_membership_id
         join research_document_pages first_page on first_page.document_id = rd.id and first_page.page_number = 1
         cross join search_query
        where rd.candidate_membership_id = $2 and cm.actor_type = $3 and cm.actor_id = $4
          and rd.captured_membership_version <= cm.version
          and rd.published_at <= $5 and rd.imported_at <= $5
          and to_tsvector('simple'::regconfig, rd.title || ' ' || rd.original_filename || ' ' || rd.source_version) @@ search_query.value
       union all
       select 'page'::text, rd.id, rdp.page_number, null::bigint, rdp.normalized_text,
              rdp.normalized_text, rdp.text_sha256, rdp.ocr_applied, null::text, cm.version,
              ts_rank_cd(to_tsvector('simple'::regconfig, rdp.normalized_text), search_query.value),
              rd.published_at
         from research_document_pages rdp
         join research_documents rd on rd.id = rdp.document_id
         join candidate_memberships cm on cm.id = rd.candidate_membership_id
         cross join search_query
        where rd.candidate_membership_id = $2 and cm.actor_type = $3 and cm.actor_id = $4
          and rd.captured_membership_version <= cm.version
          and rd.published_at <= $5 and rd.imported_at <= $5
          and to_tsvector('simple'::regconfig, rdp.normalized_text) @@ search_query.value
       union all
       select 'material'::text, rm.citation_document_id, rm.citation_page_number, rm.id,
              rm.content_text, rdp.normalized_text, rm.citation_page_text_sha256,
              rdp.ocr_applied,
              rm.content_fingerprint, cm.version,
              ts_rank_cd(
                to_tsvector('simple'::regconfig, rm.title || ' ' || rm.content_text || ' ' || rm.source_version),
                search_query.value
              ), ei.published_at
         from research_materials rm
         join research_profiles rp on rp.id = rm.research_profile_id
         join evidence_items ei on ei.id = rm.evidence_item_id
         join candidate_memberships cm on cm.id = rm.candidate_membership_id
         join research_documents rd on rd.id = rm.citation_document_id
                                    and rd.candidate_membership_id = rm.candidate_membership_id
         join research_document_pages rdp on rdp.document_id = rm.citation_document_id
                                         and rdp.page_number = rm.citation_page_number
                                         and rdp.text_sha256 = rm.citation_page_text_sha256
         cross join search_query
        where rm.candidate_membership_id = $2 and cm.actor_type = $3 and cm.actor_id = $4
          and rm.deleted_at is null
          and rp.market = cm.market and rp.code = cm.code and rp.symbol = cm.symbol
          and rd.captured_membership_version <= cm.version
          and ei.published_at <= ei.captured_at and ei.captured_at <= $5
          and to_tsvector('simple'::regconfig, rm.title || ' ' || rm.content_text || ' ' || rm.source_version) @@ search_query.value
     )
     select kind, document_id, page_number, material_id, matched_text, page_text,
            page_text_sha256, page_ocr_applied, content_fingerprint, membership_version
       from hits
      order by rank desc, published_at desc, kind, document_id, page_number, material_id nulls first
      limit ${RESEARCH_DOCUMENT_SEARCH_HIT_LIMIT}`,
    [normalizedQuery, membershipId, actor.actorType, actor.actorId, now]
  );
  const ftsHits = rows.rows;
  const hits = ftsHits.length > 0
      && !shouldExpandSearchHits(normalizedQuery, searchQuery.glossaryVersion)
    ? ftsHits
    : mergeSearchHits(
      ftsHits,
      await searchResearchDocumentPagesBySubstring(pool, membershipId, searchQuery.terms, actor, now)
    );
  const freshMembership = await readCandidateMembershipById(pool, actor, membershipId);
  if (!freshMembership || Number(freshMembership.version) !== list.membershipVersion
    || freshMembership.symbol !== list.symbol) {
    throw new ResearchDocumentError(409, "SEARCH_IDENTITY_DRIFT", "research membership changed during full-text search");
  }
  const documents = new Map(list.documents.map((document) => [document.id, document]));
  const materials = new Map(list.materials.map((material) => [material.id, material]));
  const results = hits.map((row): ResearchDocumentSearchHit => {
    const document = documents.get(String(row.document_id));
    const pageNumber = Number(row.page_number);
    if (!document || document.sourceState !== "available" || Number(row.membership_version) !== list.membershipVersion
      || !Number.isSafeInteger(pageNumber) || pageNumber <= 0 || pageNumber > document.pageCount
      || createHash("sha256").update(row.page_text).digest("hex") !== row.page_text_sha256) {
      throw new ResearchDocumentError(409, "SEARCH_SOURCE_DRIFT", "research document source changed during full-text search");
    }
    const material = row.kind === "material" && row.material_id !== null
      ? materials.get(String(row.material_id))
      : null;
    if (row.kind === "material" && (!material || !row.content_fingerprint
      || researchMaterialFingerprint(row.matched_text) !== row.content_fingerprint
      || material.contentFingerprint !== row.content_fingerprint
      || material.citation?.documentId !== document.id
      || material.citation.pageNumber !== pageNumber
      || material.citation.pageTextSha256 !== row.page_text_sha256)) {
      throw new ResearchDocumentError(409, "SEARCH_SOURCE_DRIFT", "research material source changed during full-text search");
    }
    const revisionLabel = material?.revisionState === "replaced" ? ` · 修订 ${material.revision} 已替代` : "";
    const title = material ? `${material.title.slice(0, 500 - revisionLabel.length)}${revisionLabel}` : document.title;
    const displayText = row.matched_text.trim().replace(/\s+/g, " ");
    const matchedIndex = searchQuery.terms
      .map((term) => displayText.toLocaleLowerCase().indexOf(term.toLocaleLowerCase()))
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0] ?? 0;
    const excerptStart = Math.max(0, matchedIndex - 80);
    const excerpt = (excerptStart > 0 ? "…" : "") + displayText.slice(excerptStart, excerptStart + 499) || title;
    return {
      id: row.kind === "material" ? `material:${String(row.material_id)}`
        : row.kind === "page" ? `page:${document.id}:${pageNumber}` : `document:${document.id}`,
      kind: row.kind,
      documentId: document.id,
      pageNumber,
      materialId: material?.id ?? null,
      title,
      excerpt,
      sourceVersion: material?.sourceVersion ?? document.sourceVersion,
      publishedAt: material?.publishedAt ?? document.publishedAt,
      pageTextSha256: row.page_text_sha256,
      sourceState: "available",
      evidenceStatus: material?.sourceType === OWNER_OCR_CORRECTION_NOTE_SOURCE_TYPE
        ? "owner_ocr_correction_note_unverified"
        : row.page_ocr_applied ? "ocr_text_pending_manual_verification" : "searchable_text_only"
    };
  });
  return {
    schemaVersion: RESEARCH_DOCUMENT_SEARCH_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    status: "available",
    requestedActorId: actor.actorId,
    membershipId,
    membershipVersion: list.membershipVersion,
    symbol: list.symbol,
    query: normalizedQuery,
    search: {
      engine: "postgresql_native_fts",
      configuration: "simple",
      ocrUsed: hits.some((row) => row.page_ocr_applied),
      glossaryVersion: searchQuery.glossaryVersion,
      suggestedQueries: suggestedFinanceSearchQueries(normalizedQuery)
    },
    results,
    message: "Search runs over stored original page text and saved materials. OCR correction notes are Owner-authored unverified drafts, not original PDF text or verified facts; reopen each hit against the original page."
  };
}

/**
 * A CJK or glossary-expanded query may still need the substring lane when
 * `simple` FTS also returns hits, because whole CJK runs collapse into single
 * tokens. Ordinary English queries with full-text hits keep the fast path.
 */
function shouldExpandSearchHits(
  query: string,
  glossaryVersion: ResearchDocumentSearchQuery["glossaryVersion"]
): boolean {
  return glossaryVersion !== null || CJK_TEXT.test(query);
}

const CJK_TEXT = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff65-\uffdc]/u;

/** Appends the substring lane after the full-text hits, deduplicating by hit identity and keeping the hit bound. */
function mergeSearchHits(
  primary: ResearchDocumentSearchRow[],
  secondary: ResearchDocumentSearchRow[]
): ResearchDocumentSearchRow[] {
  const merged = [...primary];
  const seen = new Set(merged.map(searchHitIdentity));
  for (const row of secondary) {
    if (merged.length >= RESEARCH_DOCUMENT_SEARCH_HIT_LIMIT) break;
    const identity = searchHitIdentity(row);
    if (seen.has(identity)) continue;
    seen.add(identity);
    merged.push(row);
  }
  return merged;
}

function searchHitIdentity(row: ResearchDocumentSearchRow): string {
  return `${row.kind}|${String(row.document_id)}|${Number(row.page_number)}|${
    row.material_id === null ? "" : String(row.material_id)}`;
}

/**
 * Parameterized bounded fallback for CJK queries that PostgreSQL `simple` FTS
 * cannot tokenize (whole CJK runs collapse into single tokens). It keeps the
 * same actor, membership, deletion, source and date filters and the same 20-hit
 * bound, matches on whitespace-compacted page and saved-material text, and
 * never returns client supplied text.
 */
async function searchResearchDocumentPagesBySubstring(
  pool: Pool,
  membershipId: string,
  terms: string[],
  actor: AuthenticatedResearchActor,
  now: Date
): Promise<ResearchDocumentSearchRow[]> {
  const compactTerms = terms.map((term) => compactForMatching(term)).filter((term) => term.length > 0);
  if (compactTerms.length === 0) return [];
  const rows = await pool.query<ResearchDocumentSearchRow>(
    `with hits as (
       select 'page'::text as kind, rd.id as document_id, rdp.page_number,
              null::bigint as material_id, rdp.normalized_text as matched_text,
              rdp.normalized_text as page_text, rdp.text_sha256 as page_text_sha256,
              rdp.ocr_applied as page_ocr_applied,
              null::text as content_fingerprint, cm.version as membership_version,
              0 as rank, rd.published_at as published_at
         from research_document_pages rdp
         join research_documents rd on rd.id = rdp.document_id
         join candidate_memberships cm on cm.id = rd.candidate_membership_id
        where rd.candidate_membership_id = $1 and cm.actor_type = $2 and cm.actor_id = $3
          and rd.captured_membership_version <= cm.version
          and rd.published_at <= $4 and rd.imported_at <= $4
          and exists (
            select 1 from unnest($5::text[]) as term
             where position(term in lower(regexp_replace(rdp.normalized_text, '\\s+', '', 'g'))) > 0
          )
       union all
       select 'material'::text, rm.citation_document_id, rm.citation_page_number, rm.id,
              rm.content_text, rdp.normalized_text, rdp.text_sha256, rdp.ocr_applied,
              rm.content_fingerprint, cm.version, 0, ei.published_at
         from research_materials rm
         join evidence_items ei on ei.id=rm.evidence_item_id
         join research_profiles rp on rp.id=rm.research_profile_id
         join candidate_memberships cm on cm.id=rm.candidate_membership_id
         join research_documents rd on rd.id=rm.citation_document_id
                                   and rd.candidate_membership_id=rm.candidate_membership_id
         join research_document_pages rdp on rdp.document_id=rm.citation_document_id
                                         and rdp.page_number=rm.citation_page_number
                                         and rdp.text_sha256=rm.citation_page_text_sha256
        where rm.candidate_membership_id=$1 and cm.actor_type=$2 and cm.actor_id=$3
          and ei.source_type='owner_ocr_correction_note'
          and rm.deleted_at is null and rp.market=cm.market and rp.code=cm.code and rp.symbol=cm.symbol
          and rd.captured_membership_version<=cm.version and ei.published_at<=$4 and ei.captured_at<=$4
          and exists (
            select 1 from unnest($5::text[]) as term
             where position(term in lower(regexp_replace(rm.content_text, '\\s+', '', 'g'))) > 0
          )
     )
     select kind, document_id, page_number, material_id, matched_text, page_text,
            page_text_sha256, page_ocr_applied, content_fingerprint, membership_version
       from hits
      order by published_at desc, document_id, page_number, material_id nulls first
      limit ${RESEARCH_DOCUMENT_SEARCH_HIT_LIMIT}`,
    [membershipId, actor.actorType, actor.actorId, now, compactTerms]
  );
  return rows.rows;
}

export async function readResearchDocumentPage(
  pool: Pool,
  membershipId: string,
  documentId: string,
  pageNumber: number,
  actor: AuthenticatedResearchActor,
  options: Pick<ResearchDocumentRepositoryOptions, "rawStoreRoot" | "repositoryRoot">
): Promise<ResearchDocumentPageData> {
  const document = rowToDocument(await requireDocument(pool, membershipId, documentId, actor));
  await readResearchDocumentBytes(
    options.rawStoreRoot,
    options.repositoryRoot,
    document.pdfSha256,
    document.byteLength
  );
  const result = await pool.query<{
    document_id: string;
    page_number: number | string;
    normalized_text: string;
    text_sha256: string;
    ocr_applied: boolean;
  }>(
    `select document_id, page_number, normalized_text, text_sha256, ocr_applied
       from research_document_pages
      where document_id = $1 and page_number = $2
      limit 1`,
    [documentId, pageNumber]
  );
  const page = result.rows[0];
  if (!page) throw new ResearchDocumentError(404, "PAGE_NOT_FOUND", "research document page was not found");
  return {
    documentId: String(page.document_id),
    pageNumber: Number(page.page_number),
    normalizedText: page.normalized_text,
    pageTextSha256: page.text_sha256,
    textSource: page.ocr_applied
      ? "ocr"
      : page.normalized_text.length > 0 ? "text_layer" : "blank"
  };
}

export async function readResearchDocumentContent(
  pool: Pool,
  membershipId: string,
  documentId: string,
  actor: AuthenticatedResearchActor,
  options: Pick<ResearchDocumentRepositoryOptions, "rawStoreRoot" | "repositoryRoot">
): Promise<{ document: ResearchDocumentData; bytes: Buffer }> {
  const row = await requireDocument(pool, membershipId, documentId, actor);
  const document = rowToDocument(row);
  const bytes = await readResearchDocumentBytes(
    options.rawStoreRoot,
    options.repositoryRoot,
    document.pdfSha256,
    document.byteLength
  );
  return { document, bytes };
}

function documentSelect(): string {
  return `select rd.id, rd.candidate_membership_id, rd.captured_membership_version,
                 cm.market, cm.code, cm.symbol, rd.title, rd.original_filename, rd.published_at,
                 rd.imported_at, rd.source_version, rd.parser_name, rd.parser_version,
                 rd.normalization_version, rd.source_classification, rd.rights_status,
                 rd.rights_confirmed_at, rd.rights_declaration_version, rd.pdf_sha256,
                 rd.byte_length, rd.page_count, rd.ocr_status, rd.ocr_engine,
                 rd.ocr_engine_version, rd.ocr_applied_at, rd.ocr_page_numbers,
                 rd.captured_source_url, rd.publisher, rd.document_kind, rd.source_lead_id
            from research_documents rd
            join candidate_memberships cm on cm.id = rd.candidate_membership_id`;
}

async function requireDocument(
  client: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  documentId: string,
  actor: AuthenticatedResearchActor
): Promise<ResearchDocumentRow> {
  const document = await findDocumentById(client, membershipId, documentId, actor);
  if (!document) throw new ResearchDocumentError(404, "DOCUMENT_NOT_FOUND", "research document was not found for the authenticated actor and membership");
  return document;
}

export async function assertResearchDocumentBinding(
  client: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  documentId: string,
  actor: AuthenticatedResearchActor
): Promise<ResearchDocumentData> {
  return rowToDocument(await requireDocument(client, membershipId, documentId, actor));
}

export async function findDocumentById(
  client: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  documentId: string,
  actor: AuthenticatedResearchActor
): Promise<ResearchDocumentRow | null> {
  const result = await client.query<ResearchDocumentRow>(
    `${documentSelect()}
      where rd.id = $1 and rd.candidate_membership_id = $2 and cm.actor_type = $3 and cm.actor_id = $4
      limit 1`,
    [documentId, membershipId, actor.actorType, actor.actorId]
  );
  return result.rows[0] ?? null;
}

export async function findDocumentByHash(
  client: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  pdfSha256: string,
  actor: AuthenticatedResearchActor,
  sourceLeadId?:string|null
): Promise<ResearchDocumentRow | null> {
  const result = await client.query<ResearchDocumentRow>(
    `${documentSelect()}
      where rd.candidate_membership_id = $1 and rd.pdf_sha256 = $2
        and cm.actor_type = $3 and cm.actor_id = $4
        ${sourceLeadId===undefined?"":"and rd.source_lead_id is not distinct from $5"}
      limit 1`,
    sourceLeadId===undefined?[membershipId, pdfSha256, actor.actorType, actor.actorId]:[membershipId, pdfSha256, actor.actorType, actor.actorId,sourceLeadId]
  );
  return result.rows[0] ?? null;
}

export function rowToDocument(row: ResearchDocumentRow): ResearchDocumentData {
  return {
    id: String(row.id),
    membershipId: String(row.candidate_membership_id),
    membershipVersionAtImport: Number(row.captured_membership_version),
    market: row.market,
    code: row.code,
    symbol: row.symbol,
    title: row.title,
    originalFilename: row.original_filename,
    publishedAt: iso(row.published_at),
    importedAt: iso(row.imported_at),
    sourceVersion: row.source_version,
    parserName: row.parser_name,
    parserVersion: row.parser_version,
    normalizationVersion: row.normalization_version,
    sourceClassification: row.source_classification,
    rightsStatus: row.rights_status,
    rightsConfirmedAt: iso(row.rights_confirmed_at),
    rightsDeclarationVersion: row.rights_declaration_version,
    capturedSourceUrl:row.captured_source_url??null,publisher:row.publisher??null,documentKind:row.document_kind??null,sourceLeadId:row.source_lead_id??null,
    sourceState: "available",
    pdfSha256: row.pdf_sha256,
    byteLength: Number(row.byte_length),
    pageCount: Number(row.page_count)
    ,
    ocr: {
      status: row.ocr_status,
      engine: row.ocr_status === "applied" ? RESEARCH_DOCUMENT_OCR_ENGINE : null,
      engineVersion: row.ocr_status === "applied" ? row.ocr_engine_version : null,
      pageNumbers: (row.ocr_page_numbers ?? []).map(Number).sort((left, right) => left - right),
      appliedAt: row.ocr_status === "applied" && row.ocr_applied_at !== null ? iso(row.ocr_applied_at) : null
    }
  };
}

export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
