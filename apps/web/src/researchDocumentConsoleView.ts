import type { ResearchDocumentListEnvelope } from "../../../packages/contracts/src/researchDocument.js";
import type { ReportDocumentCitation, ResearchDocumentSearchEnvelopeView } from "./researchDocumentValidation.js";

export function renderResearchDocumentSearch(
  documentRef: Document,
  search: ResearchDocumentSearchEnvelopeView | null
): void {
  const list = documentRef.getElementById("research-document-search-results");
  if (!(list instanceof HTMLUListElement)) return;
  list.replaceChildren(...(search?.hits ?? []).map((hit) => {
    const row = documentRef.createElement("li");
    const title = documentRef.createElement("strong");
    title.textContent = `${hit.title} · ${hit.kind} · ${hit.documentId} page ${hit.pageNumber}`;
    const excerpt = documentRef.createElement("p");
    excerpt.textContent = hit.excerpt;
    const detail = documentRef.createElement("p");
    detail.textContent = `Published ${hit.publishedAt}; source ${hit.sourceVersion}.`;
    const evidence = documentRef.createElement("p");
    evidence.textContent = hit.evidenceStatus === "owner_ocr_correction_note_unverified"
      ? "Owner's OCR correction note; unverified and separate from the original PDF text."
      : hit.evidenceStatus === "ocr_text_pending_manual_verification"
        ? "Local OCR text; pending manual verification. Not a confirmed fact."
        : "Searchable page text only; not a verified fact.";
    const open = documentRef.createElement("button");
    open.type = "button";
    open.dataset.searchHitId = hit.id;
    open.dataset.searchHitDocumentId = hit.documentId;
    open.dataset.searchHitPageNumber = String(hit.pageNumber);
    open.dataset.searchHitPageHash = hit.pageTextSha256;
    open.dataset.searchHitSourceVersion = hit.sourceVersion;
    open.textContent = "Fresh-read this exact hit";
    row.append(title, excerpt, detail, evidence, open);
    return row;
  }));
}

export function renderResearchDocumentCollections(
  documentRef: Document,
  documents: ResearchDocumentListEnvelope | null,
  citations: ReportDocumentCitation[]
): void {
  const availableDocumentIds = new Set(documents?.documents.filter((document) => document.sourceState === "available").map((document) => document.id) ?? []);
  const list = documentRef.getElementById("research-document-list");
  if (list instanceof HTMLUListElement) list.replaceChildren(...(documents?.documents ?? []).map((document) => {
    const row = documentRef.createElement("li");
    const title = documentRef.createElement("strong");
    title.textContent = `${document.title} · document ${document.id} · ${document.sourceState}`;
    const detail = documentRef.createElement("p");
    detail.textContent = `${document.originalFilename}; published ${document.publishedAt}; imported ${document.importedAt}; source ${document.sourceClassification}/${document.sourceVersion}; SHA-256 ${document.pdfSha256}; ${document.pageCount} page(s).`;
    const sourceState = documentRef.createElement("p");
    sourceState.textContent = document.sourceState === "available"
      ? "CAS available. Page, content, and confirmed-fact actions still re-read and re-check exact hashes."
      : `Blocked: CAS content is ${document.sourceState}; identity remains visible but content actions are disabled.`;
    const page = documentRef.createElement("button");
    page.type = "button"; page.dataset.documentPageId = document.id; page.disabled = document.sourceState !== "available"; page.textContent = "View verified page";
    const download = documentRef.createElement("button");
    download.type = "button"; download.dataset.documentDownloadId = document.id; download.disabled = document.sourceState !== "available"; download.textContent = "Download verified PDF";
    row.append(title, detail, sourceState, page, download);
    return row;
  }));

  const materials = documentRef.getElementById("research-document-materials");
  if (materials instanceof HTMLUListElement) {
    const materialRows = (documents?.materials ?? []).map((material) => {
    const row = documentRef.createElement("li");
    const citation = material.citation!;
    const title = documentRef.createElement("strong");
    const ocrNote = material.sourceType === "owner_ocr_correction_note";
    title.textContent = `${material.title} · ${ocrNote ? "Owner OCR correction note" : "fact"} ${material.id} · ${material.verificationStatus}`;
    const detail = documentRef.createElement("p");
    detail.textContent = `${material.summary} ${ocrNote ? "Suggested correction: " + material.contentText + ". " : ""}Citation document ${citation.documentId} page ${citation.pageNumber}; page SHA-256 ${citation.pageTextSha256}. Revision ${material.revision} ${material.revisionState}.`;
    const button = documentRef.createElement("button");
    button.type = "button"; button.dataset.materialDocumentId = citation.documentId; button.dataset.materialPageNumber = String(citation.pageNumber); button.dataset.materialPageHash = citation.pageTextSha256; button.disabled = !availableDocumentIds.has(citation.documentId); button.textContent = ocrNote ? "Reopen original OCR PDF page" : "Reopen confirmed citation";
    row.append(title, detail, button);
    return row;
    });
    const deletionRows = (documents?.materialDeletions ?? []).map((deletion) => {
      const row = documentRef.createElement("li");
      const title = documentRef.createElement("strong");
      title.textContent = `Deleted material ${deletion.materialId} · evidence ${deletion.evidenceId}`;
      const detail = documentRef.createElement("p");
      detail.textContent = `Deleted ${deletion.deletedAt}; membership v${deletion.membershipVersion}; SHA-256 ${deletion.contentFingerprint}. Body is absent from current materials, search, and AI context; prior PDF or external backups may still retain it.`;
      row.append(title, detail);
      return row;
    });
    materials.replaceChildren(...materialRows, ...deletionRows);
  }

  const report = documentRef.getElementById("research-report-citations");
  if (report instanceof HTMLUListElement) report.replaceChildren(...citations.map((citation) => {
    const row = documentRef.createElement("li");
    const detail = documentRef.createElement("p");
    detail.textContent = `${citation.statement} Source ${citation.sourceId}; report ${citation.reportId} v${citation.reportVersion}; document ${citation.documentId} page ${citation.pageNumber}.`;
    const button = documentRef.createElement("button");
    button.type = "button"; button.dataset.reportCitationKey = citation.key; button.textContent = "Fresh-read and reopen exact report citation";
    row.append(detail, button);
    return row;
  }));
}
