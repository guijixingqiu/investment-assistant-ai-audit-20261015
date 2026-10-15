import { readDocumentFactCandidates } from "../research/researchFactCandidateRepository.js";
import { confirmStructuredFactCandidate } from "../research/researchFactCandidateWrite.js";
import { readDeepResearchWorkspace } from "../research/deepResearchReadRepository.js";
import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { validateResearchMaterialData } from "../../../../packages/contracts/src/deepResearch.js";
import {
  type ConfirmResearchDocumentFactRequest,
  type CreateResearchDocumentOcrCorrectionNoteRequest,
  type ImportResearchDocumentMetadata,
  unavailableResearchDocumentSearch,
  validateConfirmResearchDocumentFactRequest,
  validateCreateResearchDocumentOcrCorrectionNoteRequest,
  validateImportResearchDocumentMetadata,
  validateResearchDocumentSearchEnvelope
} from "../../../../packages/contracts/src/researchDocument.js";
import {
  listResearchDocuments,
  readResearchDocumentContent,
  readResearchDocumentPage,
  searchResearchDocuments
} from "../research/researchDocumentRepository.js";
import { searchSavedSources } from "../research/researchSavedSourceSearch.js";
import {
  confirmResearchDocumentFact,
  createResearchDocumentOcrCorrectionNote,
  importResearchDocument
} from "../research/researchDocumentWriteRepository.js";
import {
  CandidateMembershipConflictError,
  CandidateMembershipNotFoundError,
  CandidateMembershipVersionConflictError,
  DeepResearchGateError,
  IdempotencyConflictError,
  ResearchDocumentError
} from "../research/domain.js";
import { authenticateReadOnly, authenticateWrite, type ResearchAuthOptions } from "./researchAuth.js";
import { isCanonicalMembershipId, rejectClientControlledAuditFields } from "./researchRouteValidation.js";

export interface ResearchDocumentRuntimeOptions {
  repositoryRoot: string;
  rawStoreRoot?: string | null;
  maxBytes?: number;
  maxPages?: number;
  maxPageTextCharacters?: number;
  maxTotalTextCharacters?: number;
  ocrExecutablePath?: string | null;
  maxOcrPages?: number;
  maxOcrPageTextCharacters?: number;
  ocrTimeoutMs?: number;
  ocrMaxBufferBytes?: number;
}

interface ResearchDocumentRouteOptions extends ResearchAuthOptions {
  pool: Pool;
  now?: () => Date;
  researchDocument?: ResearchDocumentRuntimeOptions;
}

export async function registerResearchDocumentRoutes(
  app: FastifyInstance,
  options: ResearchDocumentRouteOptions
): Promise<void> {
  await app.register(async function researchDocumentRouteScope(documentApp) {
    await documentApp.register(multipart, {
      throwFileSizeLimit: true,
      limits: {
        fieldNameSize: 100,
        fieldSize: 16 * 1024,
        fields: 1,
        files: 1,
        parts: 2,
        fileSize: options.researchDocument?.maxBytes ?? 20 * 1024 * 1024
      }
    });
    documentApp.addHook("onSend", async (_request, reply, payload) => {
      reply.header("cache-control", "no-store");
      return payload;
    });
    registerDocumentEndpoints(documentApp, options);
  });
}

function registerDocumentEndpoints(app: FastifyInstance, options: ResearchDocumentRouteOptions): void {
  app.get("/api/mobile/research/candidate-memberships/:id/fact-candidates",async(request,reply)=>{
    const actor=authenticateReadOnly(request.headers,options),id=(request.params as {id:string}).id;
    if(!actor)return reply.code(401).send({ok:false,message:"read authorization required"});
    if(!isCanonicalMembershipId(id))return reply.code(400).send({ok:false,message:"invalid membership"});
    try {const now=options.now?.()??new Date(),w=await readDeepResearchWorkspace(options.pool,id,actor,now);return await readDocumentFactCandidates(options.pool,id,actor,w.data?.operatingReasoning?.facts??[],now);}
    catch(error){return documentFailure(reply,error,app);}
  });
  app.post("/api/mobile/research/candidate-memberships/:id/fact-candidates/confirm",async(request,reply)=>{
    const actor=authenticateWrite(request.headers,options,"research_write"),id=(request.params as {id:string}).id;
    if(!actor||actor.actorType!=="user")return reply.code(401).send({ok:false,message:"explicit user write authorization required"});
    if(!isCanonicalMembershipId(id))return reply.code(400).send({ok:false,message:"invalid membership"});
    try {return await confirmStructuredFactCandidate(options.pool,id,request.body,actor,repositoryOptions(options),options.now?.());}
    catch(error){return documentFailure(reply,error,app);}
  });

  app.post("/api/mobile/research/candidate-memberships/:id/documents", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    if (actor.actorType !== "user") return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required to import a PDF" });
    const id = (request.params as { id: string }).id;
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    if (!request.isMultipart()) return reply.code(415).send({ ok: false, code: "MULTIPART_REQUIRED", message: "application/pdf import requires multipart/form-data" });
    try {
      const upload = await readDocumentMultipart(request);
      const validation = validateImportResearchDocumentMetadata(upload.metadata);
      if (!validation.ok) return reply.code(400).send({ ok: false, errors: validation.errors });
      return await importResearchDocument(
        options.pool,
        id,
        upload.metadata as ImportResearchDocumentMetadata,
        upload.filename,
        upload.bytes,
        actor,
        repositoryOptions(options),
        options.now?.()
      );
    } catch (error) {
      return documentFailure(reply, error, app);
    }
  });

  app.get("/api/mobile/research/candidate-memberships/:id/documents", async (request, reply) => {
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send({ ok: false, message: "read authorization required" });
    const id = (request.params as { id: string }).id;
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    try {
      return await listResearchDocuments(options.pool, id, actor, repositoryOptions(options), options.now?.());
    } catch (error) {
      return documentFailure(reply, error, app);
    }
  });

  app.get("/api/mobile/research/candidate-memberships/:id/documents/search", async (request, reply) => {
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send({ ok: false, message: "read authorization required" });
    const id = (request.params as { id: string }).id;
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    const rawQuery = (request.query as { q?: unknown }).q;
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
    if (!query || query.length > 80) return reply.code(400).send({ ok: false, message: "search query must contain 1 to 80 characters" });
    try {
      const envelope = await searchResearchDocuments(
        options.pool,
        id,
        query,
        actor,
        repositoryOptions(options),
        options.now?.()
      );
      if (!validateResearchDocumentSearchEnvelope(envelope).ok) {
        return reply.code(503).send(unavailableResearchDocumentSearch(
          actor.actorId, id, query, "research document search failed response validation"
        ));
      }
      return envelope;
    } catch (error) {
      const status = error instanceof CandidateMembershipNotFoundError ? 404
        : error instanceof ResearchDocumentError ? error.statusCode : 503;
      return reply.code(status).send(unavailableResearchDocumentSearch(
        actor.actorId,
        id,
        query,
        error instanceof CandidateMembershipNotFoundError
          ? error.message
          : "research document full-text search is unavailable"
      ));
    }
  });

  app.get("/api/mobile/research/candidate-memberships/:id/documents/saved-sources/search", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send({ ok: false, message: "read authorization required" });
    const id = (request.params as { id: string }).id;
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ ok: false, message: "candidate membership id must be a positive integer" });
    const rawQuery = (request.query as { q?: unknown }).q;
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
    if (!query || query.length > 80) return reply.code(400).send({ ok: false, message: "search query must contain 1 to 80 characters" });
    try {
      return await searchSavedSources(options.pool, id, query, actor, repositoryOptions(options));
    } catch (error) {
      return documentFailure(reply, error, app);
    }
  });

  app.get("/api/mobile/research/candidate-memberships/:id/documents/:documentId/pages/:pageNumber", async (request, reply) => {
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send({ ok: false, message: "read authorization required" });
    const params = request.params as { id: string; documentId: string; pageNumber: string };
    if (![params.id, params.documentId, params.pageNumber].every(isCanonicalMembershipId)) {
      return reply.code(400).send({ ok: false, message: "membership, document, and page ids must be positive integers" });
    }
    try {
      return await readResearchDocumentPage(
        options.pool,
        params.id,
        params.documentId,
        Number(params.pageNumber),
        actor,
        repositoryOptions(options)
      );
    } catch (error) {
      return documentFailure(reply, error, app);
    }
  });

  app.get("/api/mobile/research/candidate-memberships/:id/documents/:documentId/content", async (request, reply) => {
    const actor = authenticateReadOnly(request.headers, options);
    if (!actor) return reply.code(401).send({ ok: false, message: "read authorization required" });
    const params = request.params as { id: string; documentId: string };
    if (![params.id, params.documentId].every(isCanonicalMembershipId)) {
      return reply.code(400).send({ ok: false, message: "membership and document ids must be positive integers" });
    }
    try {
      const content = await readResearchDocumentContent(
        options.pool,
        params.id,
        params.documentId,
        actor,
        repositoryOptions(options)
      );
      return reply
        .type("application/pdf")
        .header("content-length", content.bytes.length)
        .header("content-disposition", `inline; filename="research-document-${content.document.id}.pdf"`)
        .send(content.bytes);
    } catch (error) {
      return documentFailure(reply, error, app);
    }
  });

  app.post("/api/mobile/research/candidate-memberships/:id/documents/:documentId/confirmed-facts", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    if (actor.actorType !== "user") return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required to confirm PDF text" });
    const params = request.params as { id: string; documentId: string };
    if (![params.id, params.documentId].every(isCanonicalMembershipId)) {
      return reply.code(400).send({ ok: false, message: "membership and document ids must be positive integers" });
    }
    const body = request.body as unknown;
    const validation = validateConfirmResearchDocumentFactRequest(body);
    const auditErrors = rejectClientControlledAuditFields(body);
    if (!validation.ok || auditErrors.length) {
      return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
    }
    try {
      const envelope = await confirmResearchDocumentFact(
        options.pool,
        params.id,
        params.documentId,
        body as ConfirmResearchDocumentFactRequest,
        actor,
        repositoryOptions(options),
        options.now?.()
      );
      if (!validateResearchMaterialData(envelope.data).ok) {
        return reply.code(503).send({ ok: false, message: "confirmed PDF fact failed material contract validation" });
      }
      return envelope;
    } catch (error) {
      return documentFailure(reply, error, app);
    }
  });

  app.post("/api/mobile/research/candidate-memberships/:id/documents/:documentId/ocr-correction-notes", async (request, reply) => {
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ ok: false, message: "research-write authorization required" });
    if (actor.actorType !== "user") return reply.code(403).send({ ok: false, message: "an explicit user-scoped actor is required for an OCR correction note" });
    const params = request.params as { id: string; documentId: string };
    if (![params.id, params.documentId].every(isCanonicalMembershipId)) {
      return reply.code(400).send({ ok: false, message: "membership and document ids must be positive integers" });
    }
    const body = request.body as unknown;
    const validation = validateCreateResearchDocumentOcrCorrectionNoteRequest(body);
    const auditErrors = rejectClientControlledAuditFields(body);
    if (!validation.ok || auditErrors.length) {
      return reply.code(400).send({ ok: false, errors: [...(validation.ok ? [] : validation.errors), ...auditErrors] });
    }
    try {
      const envelope = await createResearchDocumentOcrCorrectionNote(
        options.pool, params.id, params.documentId,
        body as CreateResearchDocumentOcrCorrectionNoteRequest,
        actor, repositoryOptions(options), options.now?.()
      );
      if (!validateResearchMaterialData(envelope.data).ok) {
        return reply.code(503).send({ ok: false, message: "OCR correction note failed material contract validation" });
      }
      return envelope;
    } catch (error) {
      return documentFailure(reply, error, app);
    }
  });
}

function repositoryOptions(options: ResearchDocumentRouteOptions) {
  if (!options.researchDocument?.repositoryRoot) {
    throw new ResearchDocumentError(503, "RAW_STORE_INVALID", "trusted repository root is not configured");
  }
  return {
    rawStoreRoot: options.researchDocument?.rawStoreRoot,
    repositoryRoot: options.researchDocument.repositoryRoot,
    maxBytes: options.researchDocument?.maxBytes ?? 20 * 1024 * 1024,
    maxPages: options.researchDocument?.maxPages ?? 400,
    maxPageTextCharacters: options.researchDocument?.maxPageTextCharacters ?? 200_000,
    maxTotalTextCharacters: options.researchDocument?.maxTotalTextCharacters ?? 5_000_000,
    executablePath: options.researchDocument?.ocrExecutablePath ?? null,
    maxOcrPages: options.researchDocument?.maxOcrPages ?? 100,
    maxOcrPageTextCharacters: options.researchDocument?.maxOcrPageTextCharacters ?? 200_000,
    ocrTimeoutMs: options.researchDocument?.ocrTimeoutMs ?? 120_000,
    ocrMaxBufferBytes: options.researchDocument?.ocrMaxBufferBytes ?? 64 * 1024 * 1024
  };
}

async function readDocumentMultipart(
  request: FastifyRequest
): Promise<{ metadata: unknown; filename: string; bytes: Buffer }> {
  const parts: Array<
    { type: "field"; fieldname: string; mimetype: string; value: unknown; truncated: boolean }
    | { type: "file"; fieldname: string; mimetype: string; filename: string; bytes: Buffer; truncated: boolean }
  > = [];
  for await (const part of request.parts()) {
    if (part.type === "field") {
      parts.push({
        type: "field",
        fieldname: part.fieldname,
        mimetype: part.mimetype,
        value: part.value,
        truncated: part.valueTruncated
      });
    } else {
      const bytes = await part.toBuffer();
      parts.push({
        type: "file",
        fieldname: part.fieldname,
        mimetype: part.mimetype,
        filename: part.filename,
        bytes,
        truncated: part.file.truncated
      });
    }
  }
  if (parts.some((part) => part.truncated)) {
    throw new ResearchDocumentError(413, "MULTIPART_LIMIT", "multipart input exceeded a configured limit");
  }
  const metadataPart = parts[0];
  const filePart = parts[1];
  if (parts.length !== 2
    || metadataPart?.type !== "field"
    || metadataPart.fieldname !== "metadata"
    || metadataPart.mimetype !== "application/json"
    || filePart?.type !== "file"
    || filePart.fieldname !== "file") {
    throw new ResearchDocumentError(400, "MULTIPART_SHAPE_INVALID", "multipart must contain metadata JSON first and exactly one PDF file second");
  }
  if (filePart.mimetype !== "application/pdf") {
    throw new ResearchDocumentError(415, "PDF_MIME_INVALID", "uploaded file must use application/pdf");
  }
  if (!filePart.filename.trim() || filePart.filename.length > 500) {
    throw new ResearchDocumentError(400, "PDF_FILENAME_INVALID", "PDF filename must contain 1 to 500 characters");
  }
  let metadata: unknown;
  if (typeof metadataPart.value === "string") {
    try {
      metadata = JSON.parse(metadataPart.value);
    } catch {
      throw new ResearchDocumentError(400, "METADATA_JSON_INVALID", "metadata part must contain valid JSON");
    }
  } else {
    metadata = metadataPart.value;
  }
  return { metadata, filename: filePart.filename, bytes: filePart.bytes };
}

function documentFailure(reply: FastifyReply, error: unknown, app: FastifyInstance) {
  if (error instanceof ResearchDocumentError) {
    return reply.code(error.statusCode).send({ ok: false, code: error.code, message: error.message });
  }
  if (error instanceof app.multipartErrors.RequestFileTooLargeError) {
    return reply.code(413).send({ ok: false, code: "MULTIPART_LIMIT", message: "multipart input exceeded a configured limit" });
  }
  if (error instanceof app.multipartErrors.PartsLimitError
    || error instanceof app.multipartErrors.FilesLimitError
    || error instanceof app.multipartErrors.FieldsLimitError) {
    return reply.code(400).send({ ok: false, code: "MULTIPART_SHAPE_INVALID", message: "multipart must contain metadata JSON first and exactly one PDF file second" });
  }
  if (error instanceof CandidateMembershipNotFoundError) {
    return reply.code(404).send({ ok: false, message: error.message });
  }
  if (error instanceof IdempotencyConflictError || error instanceof CandidateMembershipConflictError
    || error instanceof CandidateMembershipVersionConflictError) {
    return reply.code(409).send({ ok: false, message: error.message });
  }
  if (error instanceof DeepResearchGateError) {
    return reply.code(422).send({ ok: false, message: error.message, failures: error.failures });
  }
  return reply.code(503).send({ ok: false, message: "research document repository is unavailable" });
}
