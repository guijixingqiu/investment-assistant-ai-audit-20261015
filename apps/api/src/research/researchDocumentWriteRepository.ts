import type { Pool, PoolClient } from "pg";
import {randomUUID} from "node:crypto";
import type { ResearchMaterialData } from "../../../../packages/contracts/src/deepResearch.js";
import { OWNER_OCR_CORRECTION_NOTE_SOURCE_TYPE, OWNER_PROVIDED_PDF_SOURCE_TYPE } from "../../../../packages/contracts/src/deepResearch.js";
import type {
  ConfirmResearchDocumentFactRequest,
  CreateResearchDocumentOcrCorrectionNoteRequest,
  ImportResearchDocumentMetadata,
  ResearchDocumentImportData
} from "../../../../packages/contracts/src/researchDocument.js";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { normalizeMarketCode } from "../market/freshness.js";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import {
  CandidateMembershipConflictError,
  CandidateMembershipNotFoundError,
  CandidateMembershipVersionConflictError,
  IdempotencyConflictError,
  ResearchDocumentError,
  type AuthenticatedResearchActor
} from "./domain.js";
import { requestFingerprint, researchMaterialFingerprint } from "./deepResearchGate.js";
import { createResearchMaterial } from "./deepResearchMaterialRepository.js";
import { storeResearchDocumentBytes } from "./researchDocumentCas.js";
import { countNormalizedQuote, normalizePdfText, parseResearchDocumentPdf } from "./researchDocumentPdf.js";
import {
  assertResearchDocumentBinding,
  findDocumentByHash,
  findDocumentById,
  iso,
  RESEARCH_DOCUMENT_NORMALIZATION_VERSION,
  RESEARCH_DOCUMENT_PARSER_NAME,
  RESEARCH_DOCUMENT_PARSER_VERSION,
  RESEARCH_DOCUMENT_RIGHTS_DECLARATION_VERSION,
  RESEARCH_DOCUMENT_SOURCE_CLASSIFICATION,
  readResearchDocumentPage,
  rowToDocument,
  type ResearchDocumentRepositoryOptions,
  type ResearchDocumentRow
} from "./researchDocumentRepository.js";
import { assertCandidateResearchWriteBinding } from "./researchWriteBinding.js";
import {
  actorRequest,
  findAuditByIdempotencyKey,
  insertWriteAudit,
  isUniqueViolation,
  upsertStock,
  writeEnvelope
} from "./writePersistence.js";

type CapturedSource={capturedSourceUrl:string;publisher:string;documentKind:string;sourceLeadId:string;reviewState?:"TRUSTED"|"NEEDS_REVIEW"};
function captureColumns(capture?:CapturedSource){return capture?{sourceClassification:"authorized_public_issuer_document",rightsStatus:"authorized_public",rightsDeclarationVersion:"official-public-local-research-v1",url:capture.capturedSourceUrl,publisher:capture.publisher,kind:capture.documentKind,leadId:capture.sourceLeadId,reviewState:capture.reviewState??"TRUSTED"}:{sourceClassification:RESEARCH_DOCUMENT_SOURCE_CLASSIFICATION,rightsStatus:"user_provided",rightsDeclarationVersion:RESEARCH_DOCUMENT_RIGHTS_DECLARATION_VERSION,url:null,publisher:null,kind:null,leadId:null,reviewState:"TRUSTED"};}
async function appendInitialDocumentReview(client:PoolClient,capture:CapturedSource|undefined,documentId:string,now:Date,actor:AuthenticatedResearchActor){if(capture)await client.query(`insert into research_document_review_events(event_id,document_id,source_lead_id,review_state,reason,observed_at,actor_type,actor_id) values($1,$2,$3,$4,$5,$6,$7,$8)`,[randomUUID(),documentId,capture.sourceLeadId,capture.reviewState??"TRUSTED",capture.reviewState==="NEEDS_REVIEW"?"DOCUMENT_CONTENT_CHANGED":"INITIAL_OFFICIAL_CAPTURE",now,actor.actorType,actor.actorId]);}
export async function importResearchDocument(
  pool: Pool,
  membershipId: string,
  metadata: ImportResearchDocumentMetadata,
  suppliedFilename: string,
  bytes: Buffer,
  actor: AuthenticatedResearchActor,
  options: ResearchDocumentRepositoryOptions,
  now = new Date(),
  capture?:CapturedSource
): Promise<ResearchWriteEnvelope<ResearchDocumentImportData>> {
  if (Date.parse(metadata.publishedAt) > now.getTime()) {
    throw new ResearchDocumentError(422, "PUBLICATION_TIME_INVALID", "research document cannot be imported before publication");
  }
  const originalFilename = sanitizeResearchDocumentFilename(suppliedFilename);
  const captured=captureColumns(capture);
  const membership = await readCandidateMembershipById(pool, actor, membershipId);
  assertReadableMembership(membership, metadata.membershipVersion);
  const parsed = await parseResearchDocumentPdf(bytes, options, options);
  await storeResearchDocumentBytes(options.rawStoreRoot, options.repositoryRoot, parsed.pdfSha256, bytes);

  const boundRequest = { membershipId, ...metadata };
  const fingerprint = requestFingerprint("research_document_import", {
    actor,
    membershipId,
    metadata,
    originalFilename,
    pdfSha256: parsed.pdfSha256,
    capture:capture??null,
    byteLength: parsed.byteLength
  });
  const auditRequest = actorRequest(actor, metadata.idempotencyKey);
  const normalized = normalizeMarketCode(membership.market, membership.code);
  const client = await pool.connect();
  try {
    await client.query("begin");
    let replay = await findAuditByIdempotencyKey<ResearchDocumentImportData>(
      client,
      metadata.idempotencyKey,
      "research_document_imported"
    );
    if (replay) {
      if (!sameDocumentReplay(replay, actor, boundRequest, fingerprint, parsed.pdfSha256)) throw idempotencyConflict();
      await client.query("commit");
      return replay.envelope;
    }
    await assertCandidateResearchWriteBinding(client, actor, boundRequest, normalized);
    replay = await findAuditByIdempotencyKey<ResearchDocumentImportData>(
      client,
      metadata.idempotencyKey,
      "research_document_imported"
    );
    if (replay) {
      if (!sameDocumentReplay(replay, actor, boundRequest, fingerprint, parsed.pdfSha256)) throw idempotencyConflict();
      await client.query("commit");
      return replay.envelope;
    }

    const existing = await findDocumentByHash(client, membershipId, parsed.pdfSha256, actor,capture?.sourceLeadId??null);
    if (existing) {
      assertDocumentMetadataMatches(existing, metadata, originalFilename);
      const envelope = await recordDeduplicatedImport(
        client,
        existing,
        normalized,
        metadata,
        auditRequest,
        fingerprint
      );
      await client.query("commit");
      return envelope;
    }

    const stock = await upsertStock(client, normalized.market, normalized.code, normalized.symbol, null);
    const inserted = await client.query<{ id: string }>(
      `insert into research_documents
        (candidate_membership_id, captured_membership_version, title, original_filename, published_at,
         source_version, parser_name, parser_version, normalization_version, source_classification,
         rights_status, rights_confirmed_at, rights_declaration_version, pdf_sha256, byte_length,
         page_count, imported_at, ocr_status, ocr_engine, ocr_engine_version, ocr_applied_at,
         ocr_page_numbers,captured_source_url,publisher,document_kind,source_lead_id,review_state)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $26, $11, $12, $13, $14, $15, $16,
               $17, $18, $19, $20, $21,$22,$23,$24,$25,$27)
       returning id`,
      [
        membershipId, metadata.membershipVersion, metadata.title, originalFilename,
        metadata.publishedAt, metadata.sourceVersion, RESEARCH_DOCUMENT_PARSER_NAME,
        RESEARCH_DOCUMENT_PARSER_VERSION, RESEARCH_DOCUMENT_NORMALIZATION_VERSION,
        captured.sourceClassification, now,
        captured.rightsDeclarationVersion, parsed.pdfSha256,
        parsed.byteLength, parsed.pageCount, now,
        parsed.ocr.status,
        parsed.ocr.status === "applied" ? parsed.ocr.engine : null,
        parsed.ocr.status === "applied" ? parsed.ocr.engineVersion : null,
        parsed.ocr.status === "applied" && parsed.ocr.appliedAt ? new Date(parsed.ocr.appliedAt) : null,
        parsed.ocr.status === "applied" ? parsed.ocr.pageNumbers : [],captured.url,captured.publisher,captured.kind,captured.leadId,captured.rightsStatus,captured.reviewState
      ]
    );
    const insertedRow = await findDocumentById(client, membershipId, inserted.rows[0].id, actor);
    if (!insertedRow) {
      throw new ResearchDocumentError(503, "DOCUMENT_PERSISTENCE_UNAVAILABLE", "imported research document could not be read back");
    }
    const document = rowToDocument(insertedRow);
    for (const page of parsed.pages) {
      await client.query(
        `insert into research_document_pages (document_id, page_number, normalized_text, text_sha256, ocr_applied)
         values ($1, $2, $3, $4, $5)`,
        [document.id, page.pageNumber, page.normalizedText, page.pageTextSha256, page.textSource === "ocr"]
      );
    }
    await appendInitialDocumentReview(client,capture,document.id,now,actor);
    const data: ResearchDocumentImportData = { result: "created", document };
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "research_document_imported",
      request: auditRequest,
      stock,
      targetTable: "research_documents",
      targetId: document.id,
      beforePayload: null,
      afterPayload: data,
      requestFingerprint: fingerprint,
      candidateMembershipId: membershipId,
      candidateMembershipVersion: metadata.membershipVersion
    });
    await client.query("commit");
    return writeEnvelope(auditRequest, data, `Research PDF for ${normalized.symbol} imported.`, auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      try {
        await client.query("begin");
        const replay = await findAuditByIdempotencyKey<ResearchDocumentImportData>(
          client,
          metadata.idempotencyKey,
          "research_document_imported"
        );
        if (replay) {
          if (!sameDocumentReplay(replay, actor, boundRequest, fingerprint, parsed.pdfSha256)) throw idempotencyConflict();
          await client.query("commit");
          return replay.envelope;
        }
        await assertCandidateResearchWriteBinding(client, actor, boundRequest, normalized);
        const existing = await findDocumentByHash(client, membershipId, parsed.pdfSha256, actor,capture?.sourceLeadId??null);
        if (!existing) throw idempotencyConflict();
        assertDocumentMetadataMatches(existing, metadata, originalFilename);
        const envelope = await recordDeduplicatedImport(
          client,
          existing,
          normalized,
          metadata,
          auditRequest,
          fingerprint
        );
        await client.query("commit");
        return envelope;
      } catch (fallbackError) {
        await client.query("rollback");
        if (isUniqueViolation(fallbackError)) {
          const replay = await findAuditByIdempotencyKey<ResearchDocumentImportData>(
            pool,
            metadata.idempotencyKey,
            "research_document_imported"
          );
          if (replay && sameDocumentReplay(replay, actor, boundRequest, fingerprint, parsed.pdfSha256)) {
            return replay.envelope;
          }
        }
        throw fallbackError;
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

async function recordDeduplicatedImport(
  client: PoolClient,
  existing: ResearchDocumentRow,
  normalized: ReturnType<typeof normalizeMarketCode>,
  metadata: ImportResearchDocumentMetadata,
  auditRequest: ReturnType<typeof actorRequest>,
  fingerprint: string
): Promise<ResearchWriteEnvelope<ResearchDocumentImportData>> {
  const document = rowToDocument(existing);
  const data: ResearchDocumentImportData = { result: "deduplicated", document };
  const stock = await upsertStock(client, normalized.market, normalized.code, normalized.symbol, null);
  const auditAsOf = await insertWriteAudit(client, {
    eventType: "research_document_imported",
    request: auditRequest,
    stock,
    targetTable: "research_documents",
    targetId: document.id,
    beforePayload: null,
    afterPayload: data,
    requestFingerprint: fingerprint,
    candidateMembershipId: document.membershipId,
    candidateMembershipVersion: metadata.membershipVersion
  });
  return writeEnvelope(
    auditRequest,
    data,
    `Existing content-addressed PDF for ${normalized.symbol} returned without duplicate document rows.`,
    auditAsOf
  );
}

export async function confirmResearchDocumentFact(
  pool: Pool,
  membershipId: string,
  documentId: string,
  request: ConfirmResearchDocumentFactRequest,
  actor: AuthenticatedResearchActor,
  options: ResearchDocumentRepositoryOptions,
  now = new Date()
): Promise<ResearchWriteEnvelope<ResearchMaterialData>> {
  const document = await assertResearchDocumentBinding(pool, membershipId, documentId, actor);
  if (Date.parse(request.validUntil) <= Date.parse(document.publishedAt)) {
    throw new ResearchDocumentError(422, "VALID_UNTIL_INVALID", "validUntil must be later than the PDF publication time");
  }
  const page = await readResearchDocumentPage(pool, membershipId, documentId, request.pageNumber, actor, options);
  if (!page.normalizedText) {
    throw new ResearchDocumentError(422, "PAGE_TEXT_UNAVAILABLE", "the cited PDF page has no usable text");
  }
  if (countNormalizedQuote(page.normalizedText, request.quote) !== 1) {
    throw new ResearchDocumentError(422, "QUOTE_NOT_UNIQUE", "normalized quote must occur exactly once on the cited page");
  }

  const normalized = normalizeMarketCode(document.market, document.code);
  const bindingClient = await pool.connect();
  try {
    await bindingClient.query("begin");
    await assertCandidateResearchWriteBinding(bindingClient, actor, {
      membershipId,
      membershipVersion: request.membershipVersion
    }, normalized);
    const boundDocument = await assertResearchDocumentBinding(bindingClient, membershipId, documentId, actor);
    if (boundDocument.symbol !== document.symbol) {
      throw new CandidateMembershipConflictError("PDF document does not match the current actor, membership, and symbol");
    }
    if(boundDocument.sourceLeadId){
      const review=(await bindingClient.query<{status:string;document_id:string|null;review_state:string}>(`select l.status,l.document_id,coalesce((select review_state from research_document_review_events where document_id=$2 order by event_sequence desc limit 1),d.review_state) review_state from research_source_leads l join research_documents d on d.id=$2 and d.source_lead_id=l.lead_id where l.lead_id=$1 for update of l`,[boundDocument.sourceLeadId,documentId])).rows[0];
      if(!review||!(["IMPORTED","DUPLICATE"].includes(review.status))||String(review.document_id)!==documentId||review.review_state!=="TRUSTED")throw new ResearchDocumentError(409,"DOCUMENT_REVIEW_REQUIRED","captured document version must be accepted before a source-bound material can be confirmed");
    }
    await bindingClient.query("commit");
  } catch (error) {
    await bindingClient.query("rollback");
    throw error;
  } finally {
    bindingClient.release();
  }

  return createResearchMaterial(pool, document.market, document.code, {
    membershipId,
    membershipVersion: request.membershipVersion,
    title: `${document.title} · 第 ${page.pageNumber} 页`,
    contentText: normalizePdfText(request.quote),
    sourceType: document.sourceClassification==="authorized_public_issuer_document"?"issuer_public_pdf":OWNER_PROVIDED_PDF_SOURCE_TYPE,
    sourceUrl: document.capturedSourceUrl??null,
    publishedAt: document.publishedAt,
    claimType: "issuer_statement",
    verificationStatus: "unverified",
    rightsStatus: document.sourceClassification==="authorized_public_issuer_document"?"authorized_public":"user_provided",
    sourceVersion: `pdf:${document.pdfSha256}:p${page.pageNumber}:${page.pageTextSha256.slice(0, 16)}`,
    replacesMaterialId: request.replacesMaterialId ?? null,
    validUntil: request.validUntil,
    summary: request.statement,
    variableName: null,
    stance: "neutral",
    reliability: null,
    materiality: null,
    isRead: true,
    idempotencyKey: request.idempotencyKey
  }, actor, now, {
    documentId,
    pageNumber: page.pageNumber,
    pageTextSha256: page.pageTextSha256
  });
}

/** Keep the machine OCR and original PDF unchanged; the Owner's words are a separate cited draft. */
export async function createResearchDocumentOcrCorrectionNote(
  pool: Pool,
  membershipId: string,
  documentId: string,
  request: CreateResearchDocumentOcrCorrectionNoteRequest,
  actor: AuthenticatedResearchActor,
  options: ResearchDocumentRepositoryOptions,
  now = new Date()
): Promise<ResearchWriteEnvelope<ResearchMaterialData>> {
  const document = await assertResearchDocumentBinding(pool, membershipId, documentId, actor);
  const page = await readResearchDocumentPage(pool, membershipId, documentId, request.pageNumber, actor, options);
  if (page.textSource !== "ocr" || !page.normalizedText) {
    throw new ResearchDocumentError(422, "OCR_PAGE_REQUIRED", "a correction note requires a nonempty OCR page");
  }
  if (page.pageTextSha256 !== request.pageTextSha256) {
    throw new ResearchDocumentError(409, "OCR_PAGE_CHANGED", "the OCR page text changed; reopen the original page");
  }
  const excerpt = normalizePdfText(request.ocrExcerpt);
  if (countNormalizedQuote(page.normalizedText, excerpt) < 1) {
    throw new ResearchDocumentError(422, "OCR_EXCERPT_NOT_FOUND", "the stated OCR excerpt is absent from the cited page");
  }
  if (Date.parse(request.validUntil) <= Date.parse(document.publishedAt)) {
    throw new ResearchDocumentError(422, "VALID_UNTIL_INVALID", "validUntil must be later than the PDF publication time");
  }
  const corrected = normalizePdfText(request.correctedText);
  const explanation = request.note ? normalizePdfText(request.note) : "";
  const contentText = `OCR 识别片段：${excerpt}\n人工校对建议：${corrected}${explanation ? `\n校对说明：${explanation}` : ""}`;
  const sourceVersion = `ocr-note:pdf:${document.pdfSha256}:p${page.pageNumber}:${page.pageTextSha256.slice(0, 16)}:${researchMaterialFingerprint(contentText).slice(0, 16)}`;
  const titleSuffix = ` · 第 ${page.pageNumber} 页 · 人工 OCR 校对备注`;
  return createResearchMaterial(pool, document.market, document.code, {
    membershipId,
    membershipVersion: request.membershipVersion,
    title: `${document.title.slice(0, 500 - titleSuffix.length)}${titleSuffix}`,
    contentText,
    sourceType: OWNER_OCR_CORRECTION_NOTE_SOURCE_TYPE,
    sourceUrl: null,
    publishedAt: document.publishedAt,
    claimType: "model_inference",
    verificationStatus: "unverified",
    rightsStatus: "user_provided",
    sourceVersion,
    replacesMaterialId: request.replacesMaterialId ?? null,
    validUntil: request.validUntil,
    summary: "人工 OCR 校对备注，尚未核验原文或事实",
    variableName: null,
    stance: "neutral",
    reliability: null,
    materiality: null,
    isRead: true,
    idempotencyKey: request.idempotencyKey
  }, actor, now, {
    documentId,
    pageNumber: page.pageNumber,
    pageTextSha256: page.pageTextSha256
  });
}

export function sanitizeResearchDocumentFilename(value: string): string {
  const leaf = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const sanitized = [...leaf]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .trim();
  if (!sanitized || sanitized.length > 500) {
    throw new ResearchDocumentError(400, "PDF_FILENAME_INVALID", "PDF filename must contain 1 to 500 safe display characters");
  }
  return sanitized;
}

export function documentMetadataMatches(
  row: Pick<ResearchDocumentRow,
    "title" | "original_filename" | "published_at" | "source_version" | "parser_name"
    | "parser_version" | "normalization_version" | "source_classification" | "rights_status"
    | "rights_declaration_version">,
  metadata: ImportResearchDocumentMetadata,
  originalFilename: string
): boolean {
  return row.title === metadata.title
    && row.original_filename === originalFilename
    && iso(row.published_at) === new Date(metadata.publishedAt).toISOString()
    && row.source_version === metadata.sourceVersion
    && row.parser_name === RESEARCH_DOCUMENT_PARSER_NAME
    && row.parser_version === RESEARCH_DOCUMENT_PARSER_VERSION
    && row.normalization_version === RESEARCH_DOCUMENT_NORMALIZATION_VERSION
    && row.source_classification === RESEARCH_DOCUMENT_SOURCE_CLASSIFICATION
    && row.rights_status === "user_provided"
    && row.rights_declaration_version === RESEARCH_DOCUMENT_RIGHTS_DECLARATION_VERSION
    && metadata.rightsConfirmed === true;
}

function assertDocumentMetadataMatches(
  row: ResearchDocumentRow,
  metadata: ImportResearchDocumentMetadata,
  originalFilename: string
): void {
  if (!documentMetadataMatches(row, metadata, originalFilename)) {
    throw new ResearchDocumentError(
      409,
      "DOCUMENT_METADATA_CONFLICT",
      "the same membership and PDF hash already exist with different import metadata"
    );
  }
}

function assertReadableMembership(
  membership: Awaited<ReturnType<typeof readCandidateMembershipById>>,
  requestedVersion: number
): asserts membership is NonNullable<typeof membership> {
  if (!membership) throw new CandidateMembershipNotFoundError();
  if (Number(membership.version) !== requestedVersion) {
    throw new CandidateMembershipVersionConflictError("candidate membership version is stale; refresh before importing a PDF");
  }
  if (membership.state === "archived") {
    throw new CandidateMembershipConflictError("archived candidate membership cannot accept research PDFs");
  }
}

function sameDocumentReplay(
  replay: Awaited<ReturnType<typeof findAuditByIdempotencyKey<ResearchDocumentImportData>>>,
  actor: AuthenticatedResearchActor,
  request: { membershipId: string; membershipVersion: number },
  fingerprint: string,
  pdfSha256: string
): boolean {
  return replay !== null
    && replay.envelope.source.actorType === actor.actorType
    && replay.envelope.source.actorId === actor.actorId
    && replay.envelope.source.correlationId === null
    && replay.requestFingerprint === fingerprint
    && replay.candidateMembershipId === request.membershipId
    && replay.candidateMembershipVersion === request.membershipVersion
    && replay.envelope.data.document.pdfSha256 === pdfSha256;
}

function idempotencyConflict(): IdempotencyConflictError {
  return new IdempotencyConflictError("idempotency key already exists with different PDF import semantics");
}
