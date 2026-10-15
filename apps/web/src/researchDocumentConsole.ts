import {
  type ImportResearchDocumentMetadata,
  type ResearchDocumentData,
  type ResearchDocumentListEnvelope,
  type ResearchDocumentPageData
} from "../../../packages/contracts/src/researchDocument.js";
import { validResearchMaterial, type ResearchMaterialData } from "../../../packages/contracts/src/researchMaterial.js";
import type { ResearchSourceSnapshotData, ResearchSourceSnapshotListItem } from "../../../packages/contracts/src/researchSourceSnapshot.js";
import { sha256Hex } from "../../../packages/contracts/src/sha256.js";
import type { OfficialAnnouncementDiscoveryItem } from "../../../packages/contracts/src/marketDiscovery.js";
import { OfficialAnnouncementIdentityChangedError } from "./dailyResearchCockpitData.js";
import type { WebApiAuth } from "./apiClient.js";
import type { ExactCockpitMembership } from "./dailyResearchCockpit.js";
import { resetControlsToDefaults } from "./domRender.js";
import { renderResearchDocumentCollections, renderResearchDocumentSearch } from "./researchDocumentConsoleView.js";
import {
  acceptResearchDocumentList,
  acceptResearchDocumentPage,
  acceptResearchDocumentSearch,
  confirmedMaterial,
  importedDocument,
  reportDocumentCitations,
  reportSnapshotCitations,
  reportDocumentCitationsForSelection,
  type ReportDocumentCitation,
  type ReportSnapshotCitation,
  type ResearchDocumentSearchEnvelopeView
} from "./researchDocumentValidation.js";
import {
  documentFailureMessage,
  documentListPath,
  documentMultipart,
  fail,
  fetchResearchDocumentJson,
  fetchResearchDocumentPdf,
  localDateTimeToIso,
  membershipKey,
  occurrences,
  openPdfBytes,
  researchDocumentMultipartFilename,
  researchDocumentSha256,
  assertResearchDocumentOperationCurrent
} from "./researchDocumentTransport.js";
import { captureStoredSource, confirmStoredSourceMaterial, listStoredSources, readStoredSource,
  selectedStoredSourceSpan, verifyStoredSourceOriginal, type SnapshotSpan } from "./researchSourceSnapshotWeb.js";

export { acceptResearchDocumentList, acceptResearchDocumentPage } from "./researchDocumentValidation.js";
export { assertResearchDocumentOperationCurrent, sameResearchDocumentOperationContext } from "./researchDocumentTransport.js";

interface ResearchDocumentConsoleDependencies {
  readAuth: () => WebApiAuth | null;
  writeAuth: () => WebApiAuth | null;
  onMaterialWrite?: (material: ResearchMaterialData) => void;
}

export class ResearchDocumentConsole {
  private documentRef: Document | null = null;
  private membership: ExactCockpitMembership | null = null;
  private documents: ResearchDocumentListEnvelope | null = null;
  private citations: ReportDocumentCitation[] = [];
  private snapshotCitations: ReportSnapshotCitation[] = [];
  private selectedPage: ResearchDocumentPageData | null = null;
  private search: ResearchDocumentSearchEnvelopeView | null = null;
  private storedSources: ResearchSourceSnapshotListItem[] = [];
  private storedSource: ResearchSourceSnapshotData | null = null;
  private selectedStoredSpan: SnapshotSpan | null = null;
  private message = "Open an exact membership in Research before using official PDFs.";
  private generation = 0;
  private busy = false;
  private retryKeys = new Map<string, { fingerprint: string; key: string }>();
  private preparedAnnouncement: {
    item: OfficialAnnouncementDiscoveryItem;
    membershipKey: string;
    publishedAt: string;
    sourceVersion: string;
    revalidate: (item: OfficialAnnouncementDiscoveryItem) => Promise<void>;
  } | null = null;

  constructor(private readonly dependencies: ResearchDocumentConsoleDependencies) {}

  mount(documentRef: Document = document): void {
    this.documentRef = documentRef;
    this.element("research-documents-refresh")?.addEventListener("click", () => void this.run(() => this.refresh(), "Document refresh"));
    this.element("research-document-search")?.addEventListener("click", () => void this.run(() => this.searchDocuments(), "Document search"));
    this.element("research-document-search-query")?.addEventListener("keydown", (event) => {
      if (event instanceof KeyboardEvent && event.key === "Enter") void this.run(() => this.searchDocuments(), "Document search");
    });
    this.element("research-document-upload")?.addEventListener("click", () => void this.run(() => this.upload(), "PDF import"));
    this.element("research-document-confirm-fact")?.addEventListener("click", () => void this.run(() => this.confirmFact(), "Confirmed fact"));
    this.element("research-source-capture")?.addEventListener("click", () => void this.run(() => this.captureSource(), "Official HTML capture"));
    this.element("research-source-select")?.addEventListener("click", () => void this.run(() => this.selectSourceText(), "Stored text selection"));
    this.element("research-source-confirm-material")?.addEventListener("click", () => void this.run(() => this.confirmSourceText(), "Stored material confirmation"));
    this.element("research-source-list")?.addEventListener("click", (event) => void this.routeStoredSourceClick(event));
    this.element("research-document-list")?.addEventListener("click", (event) => void this.routeDocumentClick(event));
    this.element("research-document-search-results")?.addEventListener("click", (event) => void this.routeSearchClick(event));
    this.element("research-document-materials")?.addEventListener("click", (event) => void this.routeMaterialClick(event));
    this.element("research-report-citations")?.addEventListener("click", (event) => void this.routeReportCitationClick(event));
    this.render();
  }

  syncMembership(next: ExactCockpitMembership | null): void {
    if (membershipKey(next) === membershipKey(this.membership)) return;
    this.generation += 1;
    this.membership = next;
    this.clearPresentation();
    this.preparedAnnouncement = null;
    if (this.documentRef) {
      this.setInputValue("research-document-search-query", "");
      resetControlsToDefaults(
        this.documentRef,
        "#research-documents-console input, #research-documents-console select, #research-documents-console textarea"
      );
    }
    this.retryKeys.clear();
    this.message = next
      ? `Exact membership ${next.symbol} / ${next.id} v${next.version} is selected. Stock-bound PDF and fact drafts were cleared; refresh to fresh-read official PDFs.`
      : "Open an exact membership in Research before using official PDFs.";
    this.render();
  }

  invalidateAuthorization(message: string): void {
    this.generation += 1;
    this.clearPresentation();
    this.preparedAnnouncement = null;
    this.clearImportForm();
    this.retryKeys.clear();
    this.message = `${message} Previous document and citation success was cleared.`;
    this.render();
  }

  async openExactReportCitation(expected: ReportDocumentCitation): Promise<void> {
    await this.run(() => this.reopenSelectedReportCitation(expected), "Selected report citation reopen");
  }

  async openExactFinancialRequirementSource(expected: ResearchMaterialData, expectedActorId: string): Promise<void> {
    await this.run(async () => {
      const membership = this.requireMembership();
      const auth = this.requireReadAuth();
      const generation = this.generation;
      const value = await fetchResearchDocumentJson(
        `/api/mobile/research/candidate-memberships/${encodeURIComponent(membership.id)}/deep-research`, auth
      ) as { requestedActorId?: unknown; membershipId?: unknown; requestedSymbol?: unknown;
        data?: { target?: { membershipId?: unknown; membershipVersion?: unknown; symbol?: unknown };
          materials?: unknown } };
      this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
      if (value.requestedActorId !== expectedActorId || value.membershipId !== membership.id
        || value.requestedSymbol !== membership.symbol || value.data?.target?.membershipId !== membership.id
        || value.data.target.membershipVersion !== membership.version || value.data.target.symbol !== membership.symbol
        || !Array.isArray(value.data.materials)) throw new Error("Current source list changed identity.");
      const material = value.data.materials.find((item): item is ResearchMaterialData =>
        validResearchMaterial(item) && item.id === expected.id);
      if (!material || material.revision !== expected.revision
        || material.contentFingerprint !== expected.contentFingerprint
        || material.sourceVersion !== expected.sourceVersion
        || JSON.stringify(material.citation) !== JSON.stringify(expected.citation)
        || JSON.stringify(material.snapshotCitation) !== JSON.stringify(expected.snapshotCitation)
        || JSON.stringify(material.snapshotOriginal) !== JSON.stringify(expected.snapshotOriginal)
        || material.revisionState !== "current" || material.freshness !== "fresh") {
        throw new Error("Selected saved source changed; refresh and choose it again.");
      }
      if (material.snapshotCitation && material.snapshotOriginal) {
        const citation = material.snapshotCitation;
        await this.openStoredSource(citation.snapshotId);
        const source = this.storedSource;
        if (!source || source.reviewState !== "current"
          || source.rawSha256 !== material.snapshotOriginal.rawSha256
          || source.textSha256 !== citation.textSha256
          || source.normalizedText.slice(citation.startUtf16, citation.endUtf16) !== material.contentText) {
          throw new Error("Saved HTML original or selected passage changed.");
        }
        this.element("research-documents-console")?.scrollIntoView({ block: "start" });
      } else if (material.citation) {
        await this.loadPage(material.citation.documentId, material.citation.pageNumber,
          material.citation.pageTextSha256, true);
      } else {
        throw new Error("Selected material has no reopenable saved original.");
      }
    }, "Financial period source reopen");
  }

  private async refresh(): Promise<void> {
    const membership = this.requireMembership();
    const auth = this.requireReadAuth();
    const generation = ++this.generation;
    this.clearPresentation();
    this.message = "Fresh-reading document identities and current report citations…";
    this.render();
    const list = acceptResearchDocumentList(
      await fetchResearchDocumentJson(documentListPath(membership.id), auth),
      membership
    );
    this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
    this.documents = list;
    this.storedSources = await listStoredSources(membership, auth);
    this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
    try {
      const workspace = await fetchResearchDocumentJson(`/api/mobile/research/candidate-memberships/${encodeURIComponent(membership.id)}/deep-research`, auth);
      this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
      this.citations = reportDocumentCitations(workspace, membership);
      this.snapshotCitations = reportSnapshotCitations(workspace, membership);
      this.message = `Fresh list: ${list.documents.length} PDF(s), ${this.storedSources.length} stored HTML original(s), ${list.materials.length} saved PDF material(s), ${list.materialDeletions.length} deletion record(s), ${this.citations.length} reopenable current-report citation(s).`;
    } catch (error) {
      this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
      this.citations = [];
      this.snapshotCitations = [];
      this.message = `Fresh document list loaded; current report citations are blocked: ${documentFailureMessage(error)}`;
    }
    this.render();
  }

  private async captureSource(): Promise<void> {
    const membership = this.requireMembership(), readAuth = this.requireReadAuth(), writeAuth = this.requireWriteAuth();
    const generation = this.generation;
    const url = this.inputValue("research-source-url");
    if (!/^https:\/\//.test(url)) throw new Error("An official HTTPS URL is required.");
    const key = this.retryKey("source-capture", JSON.stringify([membershipKey(membership), url]));
    const captured = await captureStoredSource(membership, url, key, writeAuth);
    this.ensureCurrent(membership, generation, writeAuth, this.dependencies.writeAuth);
    const reread = await readStoredSource(membership, captured.id, readAuth);
    await verifyStoredSourceOriginal(membership, reread, readAuth);
    this.ensureCurrent(membership, generation, readAuth, this.dependencies.readAuth);
    this.storedSources = await listStoredSources(membership, readAuth);
    this.ensureCurrent(membership, generation, readAuth, this.dependencies.readAuth);
    this.storedSource = reread;
    this.selectedStoredSpan = null;
    this.retryKeys.delete("source-capture");
    this.message = `Saved original ${reread.id} verified: raw ${reread.rawSha256}, text ${reread.textSha256}. Select an exact passage below.`;
  }

  private routeStoredSourceClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const id = target.closest<HTMLElement>("[data-stored-source-id]")?.dataset.storedSourceId;
    if (id) void this.run(() => this.openStoredSource(id), "Stored original reopen");
  }

  private async openStoredSource(id: string): Promise<void> {
    const membership = this.requireMembership(), auth = this.requireReadAuth(), generation = this.generation;
    this.storedSource = null;
    this.selectedStoredSpan = null;
    const reread = await readStoredSource(membership, id, auth);
    await verifyStoredSourceOriginal(membership, reread, auth);
    this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
    this.storedSource = reread;
    this.message = `Reopened and verified saved HTML original ${id}; select text in the stored text block.`;
  }

  private async selectSourceText(): Promise<void> {
    const source = this.storedSource;
    const selection = this.documentRef?.getSelection();
    if (!source || !selection) throw new Error("Open and verify a stored original first.");
    this.selectedStoredSpan = selectedStoredSourceSpan(source, selection);
    this.message = `Selected exact stored span ${this.selectedStoredSpan.startUtf16}–${this.selectedStoredSpan.endUtf16}; check and confirm explicitly.`;
  }

  private async confirmSourceText(): Promise<void> {
    const membership = this.requireMembership(), readAuth = this.requireReadAuth(), writeAuth = this.requireWriteAuth();
    const generation = this.generation, source = this.storedSource, span = this.selectedStoredSpan;
    if (!source || !span || !this.checked("research-source-confirm")) throw new Error("Verify the original, select text, and check the explicit confirmation.");
    const validUntil = localDateTimeToIso(this.inputValue("research-source-valid-until"), "Material valid until");
    const key = this.retryKey("source-confirm", JSON.stringify([membershipKey(membership),source.id,span,validUntil]));
    const reread = await readStoredSource(membership, source.id, readAuth);
    await verifyStoredSourceOriginal(membership, reread, readAuth);
    this.ensureCurrent(membership, generation, readAuth, this.dependencies.readAuth);
    if (reread.rawSha256 !== source.rawSha256 || reread.textSha256 !== source.textSha256) throw new Error("Stored original changed.");
    const material = await confirmStoredSourceMaterial(membership, reread, span, validUntil, key, writeAuth);
    this.ensureCurrent(membership, generation, writeAuth, this.dependencies.writeAuth);
    const workspace = await fetchResearchDocumentJson(`/api/mobile/research/candidate-memberships/${encodeURIComponent(membership.id)}/deep-research`, readAuth);
    this.ensureCurrent(membership, generation, readAuth, this.dependencies.readAuth);
    const body = workspace as {data?: {materials?: ResearchMaterialData[]}};
    const exact = body.data?.materials?.filter(item => item.id === material.id && item.contentFingerprint === material.contentFingerprint
      && item.snapshotCitation?.snapshotId === span.snapshotId && item.snapshotCitation?.excerptSha256 === span.excerptSha256) ?? [];
    if (exact.length !== 1) throw new Error("Confirmed material was absent from fresh workspace readback.");
    this.storedSources = await listStoredSources(membership, readAuth);
    this.ensureCurrent(membership, generation, readAuth, this.dependencies.readAuth);
    this.storedSource = await readStoredSource(membership, source.id, readAuth);
    this.ensureCurrent(membership, generation, readAuth, this.dependencies.readAuth);
    this.selectedStoredSpan = null;
    const check = this.element("research-source-confirm");
    if (check instanceof HTMLInputElement) check.checked = false;
    this.retryKeys.delete("source-confirm");
    this.dependencies.onMaterialWrite?.(exact[0]);
    this.message = `Fresh readback confirmed stored HTML material ${material.id}; no report or decision was created.`;
  }

  prepareOfficialAnnouncement(
    item: OfficialAnnouncementDiscoveryItem,
    revalidate: (item: OfficialAnnouncementDiscoveryItem) => Promise<void>
  ): void {
    const membership = this.requireMembership();
    if (item.symbol !== membership.symbol) throw new Error("Official announcement does not match the exact open membership.");
    const draft = officialAnnouncementImportDraft(item);
    this.preparedAnnouncement = { item, membershipKey: membershipKey(membership)!, publishedAt: draft.publishedAt, sourceVersion: draft.sourceVersion, revalidate };
    this.setInputValue("research-document-title", item.title);
    this.setInputValue("research-document-published-at", draft.publishedAtInput);
    this.setInputValue("research-document-source-version", draft.sourceVersion);
    const rights = this.element("research-document-rights");
    if (rights instanceof HTMLInputElement) rights.checked = false;
    const file = this.element("research-document-file");
    if (file instanceof HTMLInputElement) file.value = "";
    this.message = `Fresh official announcement ${item.id} prepared. Open the verified issuer link, choose that PDF, confirm rights, then explicitly upload.`;
    this.render();
  }

  cancelOfficialAnnouncement(message: string): void {
    this.generation += 1;
    this.busy = false;
    this.preparedAnnouncement = null;
    this.clearPresentation();
    this.clearImportForm();
    this.message = message;
    this.render();
  }

  private async upload(): Promise<void> {
    const membership = this.requireMembership();
    const readAuth = this.requireReadAuth();
    const writeAuth = this.requireWriteAuth();
    const generation = this.generation;
    const prepared = this.preparedAnnouncement;
    if (prepared) {
      if (prepared.membershipKey !== membershipKey(membership)) throw new Error("Prepared announcement membership identity changed.");
      try {
        await prepared.revalidate(prepared.item);
      } catch (error) {
        if (error instanceof OfficialAnnouncementIdentityChangedError) {
          this.preparedAnnouncement = null;
          this.clearImportForm();
        }
        throw error;
      }
      this.ensureCurrent(membership, generation, readAuth, this.dependencies.readAuth);
      this.ensureCurrent(membership, generation, writeAuth, this.dependencies.writeAuth);
    }
    const fileInput = this.element("research-document-file");
    const file = fileInput instanceof HTMLInputElement ? fileInput.files?.[0] : null;
    if (!file || file.size === 0) throw new Error("Choose a non-empty PDF file.");
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const prefix = new TextDecoder().decode(fileBytes.slice(0, 5));
    const pdfSha256 = await researchDocumentSha256(fileBytes);
    this.ensureCurrent(membership, generation, writeAuth, this.dependencies.writeAuth);
    this.ensureCurrent(membership, generation, readAuth, this.dependencies.readAuth);
    if (prefix !== "%PDF-") throw new Error("Blocked: selected file does not have a PDF signature.");
    const metadata: ImportResearchDocumentMetadata = {
      membershipVersion: membership.version,
      title: this.inputValue("research-document-title"),
      publishedAt: localDateTimeToIso(this.inputValue("research-document-published-at"), "Published at"),
      sourceVersion: this.inputValue("research-document-source-version"),
      rightsConfirmed: this.checked("research-document-rights") ? true : fail("Explicit local processing rights confirmation is required."),
      idempotencyKey: ""
    };
    if (prepared && (metadata.title !== prepared.item.title || metadata.publishedAt !== prepared.publishedAt
      || metadata.sourceVersion !== prepared.sourceVersion)) {
      throw new Error("Prepared official announcement metadata changed; refresh the announcement before importing.");
    }
    const fingerprint = JSON.stringify([membershipKey(membership), file.name, pdfSha256, metadata.title, metadata.publishedAt, metadata.sourceVersion]);
    metadata.idempotencyKey = this.retryKey("import", fingerprint);
    const multipart = documentMultipart(metadata, file);
    this.message = `Importing ${file.name}; no report freeze or decision action will run.`;
    this.render();
    const response = await fetchResearchDocumentJson(documentListPath(membership.id), writeAuth, {
      method: "POST",
      headers: { "content-type": multipart.contentType },
      body: multipart.body
    });
    this.ensureCurrent(membership, generation, writeAuth, this.dependencies.writeAuth);
    const imported = importedDocument(response, membership);
    const list = await this.freshList(membership, readAuth, generation);
    this.ensureCurrent(membership, generation, writeAuth, this.dependencies.writeAuth);
    const readback = list.documents.find((item) => item.id === imported.id && item.pdfSha256 === imported.pdfSha256 && item.pdfSha256 === pdfSha256);
    if (!readback) throw new Error("Blocked: imported PDF was not present in the fresh list readback.");
    if (readback.title !== metadata.title || readback.publishedAt !== metadata.publishedAt
      || readback.sourceVersion !== metadata.sourceVersion || readback.originalFilename !== researchDocumentMultipartFilename(file.name)
      || readback.membershipVersionAtImport !== membership.version || readback.byteLength !== file.size
      || readback.sourceState !== "available" || readback.sourceClassification !== "owner_declared_official"
      || readback.rightsStatus !== "user_provided") {
      throw new Error("Blocked: imported PDF metadata did not match the explicit upload in fresh readback.");
    }
    this.retryKeys.delete("import");
    this.preparedAnnouncement = null;
    this.clearImportForm();
    this.message = `Fresh readback confirmed PDF ${readback.id} (${readback.sourceState}). No pack freeze, report confirmation, formal decision, or portfolio write occurred.`;
    this.render();
  }

  private async searchDocuments(): Promise<void> {
    const membership = this.requireMembership();
    const auth = this.requireReadAuth();
    const generation = ++this.generation;
    const query = this.searchQuery();
    this.search = null;
    this.setInputValue("research-document-search-query", query);
    this.message = `Searching stored page text for “${query}”…`;
    this.render();
    let response: unknown;
    try {
      response = await fetchResearchDocumentJson(
        `${documentListPath(membership.id)}/search?q=${encodeURIComponent(query)}`,
        auth
      );
    } catch (error) {
      this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
      this.message = `Document search is unavailable: ${documentFailureMessage(error)}`;
      this.search = { status: "unavailable", hits: [], message: this.message, ocrUsed: false, glossaryVersion: null, unavailable: true };
      this.render();
      return;
    }
    this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
    const view = acceptResearchDocumentSearch(response, membership, query);
    this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
    this.search = view;
    this.message = view.unavailable
      ? `Document search is unavailable for “${query}”: ${view.message} No stored result is shown.`
      : `Search “${query}”: ${view.hits.length} stored-text hit(s); engine postgresql_native_fts, OCR used ${view.ocrUsed ? "yes" : "no"}, glossary ${view.glossaryVersion ?? "none"}. Each hit must be freshly reopened and is not a confirmed fact.`;
    this.render();
  }

  private async confirmFact(): Promise<void> {
    const membership = this.requireMembership();
    const readAuth = this.requireReadAuth();
    const writeAuth = this.requireWriteAuth();
    const generation = this.generation;
    const page = this.selectedPage;
    if (!page) throw new Error("Load and verify one PDF page before confirming a fact.");
    const quote = this.inputValue("research-document-quote");
    const statement = this.inputValue("research-document-statement");
    const validUntil = localDateTimeToIso(this.inputValue("research-document-valid-until"), "Valid until");
    const replaces = this.inputValue("research-document-replaces-id", false) || null;
    const freshPage = await this.loadPage(page.documentId, page.pageNumber, page.pageTextSha256, false);
    this.ensureCurrent(membership, generation, readAuth, this.dependencies.readAuth);
    this.ensureCurrent(membership, generation, writeAuth, this.dependencies.writeAuth);
    if (occurrences(freshPage.normalizedText, quote) !== 1) {
      throw new Error("Blocked: quote must occur exactly once in the fresh verified page text.");
    }
    const fingerprint = JSON.stringify([membershipKey(membership), page.documentId, page.pageNumber, page.pageTextSha256, quote, statement, validUntil, replaces]);
    const body = {
      membershipVersion: membership.version,
      pageNumber: page.pageNumber,
      quote,
      statement,
      validUntil,
      replacesMaterialId: replaces,
      idempotencyKey: this.retryKey("confirm", fingerprint)
    };
    const response = await fetchResearchDocumentJson(
      `${documentListPath(membership.id)}/${encodeURIComponent(page.documentId)}/confirmed-facts`,
      writeAuth,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    );
    this.ensureCurrent(membership, generation, writeAuth, this.dependencies.writeAuth);
    const material = confirmedMaterial(response, membership, freshPage);
    const list = await this.freshList(membership, readAuth, generation);
    this.ensureCurrent(membership, generation, writeAuth, this.dependencies.writeAuth);
    const readback = list.materials.find((item) => item.id === material.id);
    if (!readback || readback.citation?.pageTextSha256 !== freshPage.pageTextSha256) {
      throw new Error("Blocked: confirmed fact was not present with the exact citation in fresh readback.");
    }
    this.retryKeys.delete("confirm");
    this.message = `Fresh readback confirmed fact ${material.id} on document ${page.documentId} page ${page.pageNumber}. It remains unverified research evidence; no report or decision was changed.`;
    this.render();
    this.dependencies.onMaterialWrite?.(material);
  }

  private async routeDocumentClick(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const pageButton = target.closest("button[data-document-page-id]");
    const downloadButton = target.closest("button[data-document-download-id]");
    if (pageButton instanceof HTMLButtonElement) {
      const pageNumber = this.pageNumber();
      await this.run(() => this.loadPage(pageButton.dataset.documentPageId ?? "", pageNumber, null, false), "Page read");
    } else if (downloadButton instanceof HTMLButtonElement) {
      await this.run(() => this.download(downloadButton.dataset.documentDownloadId ?? ""), "PDF download");
    }
  }

  private async routeSearchClick(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-search-hit-document-id]");
    if (!(button instanceof HTMLButtonElement)) return;
    await this.run(() => this.loadPage(
      button.dataset.searchHitDocumentId ?? "",
      Number(button.dataset.searchHitPageNumber),
      button.dataset.searchHitPageHash ?? null,
      true
    ), "Search hit fresh reopen");
  }

  private async routeMaterialClick(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-material-document-id]");
    if (!(button instanceof HTMLButtonElement)) return;
    await this.run(() => this.loadPage(
      button.dataset.materialDocumentId ?? "",
      Number(button.dataset.materialPageNumber),
      button.dataset.materialPageHash ?? null,
      true
    ), "Confirmed citation reopen");
  }

  private async routeReportCitationClick(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-report-citation-key]");
    const snapshotButton = target.closest("button[data-report-snapshot-key]");
    if (snapshotButton instanceof HTMLButtonElement) {
      const expected = this.snapshotCitations.find(item => item.key === snapshotButton.dataset.reportSnapshotKey);
      if (expected) await this.run(() => this.reopenReportSnapshot(expected), "Report stored source reopen");
      return;
    }
    if (!(button instanceof HTMLButtonElement)) return;
    const citation = this.citations.find((item) => item.key === button.dataset.reportCitationKey);
    if (!citation) return;
    await this.run(() => this.reopenReportCitation(citation), "Report citation reopen");
  }

  private async reopenReportSnapshot(expected: ReportSnapshotCitation): Promise<void> {
    const membership = this.requireMembership(), auth = this.requireReadAuth(), generation = this.generation;
    const workspace = await fetchResearchDocumentJson(`/api/mobile/research/candidate-memberships/${encodeURIComponent(membership.id)}/deep-research`, auth);
    this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
    const citations = reportSnapshotCitations(workspace, membership);
    const exact = citations.filter(item => item.key === expected.key && item.reportId === expected.reportId
      && item.reportVersion === expected.reportVersion && item.reportFingerprint === expected.reportFingerprint);
    if (exact.length !== 1) throw new Error("Report or stored source citation changed; no alternate source was opened.");
    const item = exact[0];
    const source = await readStoredSource(membership, item.citation.snapshotId, auth);
    await verifyStoredSourceOriginal(membership, source, auth);
    this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
    const citation = item.citation, original = item.original;
    if (source.textSha256 !== citation.textSha256 || source.rawSha256 !== original.rawSha256
      || source.byteLength !== original.byteLength || source.canonicalUrl !== original.canonicalUrl
      || source.responseUrl !== original.responseUrl
      || source.normalizedText.slice(citation.startUtf16, citation.endUtf16) !== item.excerpt
      || sha256Hex(item.excerpt) !== citation.excerptSha256) {
      throw new Error("Saved original or selected report passage changed.");
    }
    this.storedSource = source;
    this.selectedStoredSpan = { snapshotId: source.id, textSha256: source.textSha256,
      startUtf16: citation.startUtf16, endUtf16: citation.endUtf16,
      excerptSha256: citation.excerptSha256, excerpt: item.excerpt };
    this.snapshotCitations = citations;
    this.message = `Reopened exact report ${item.reportId} v${item.reportVersion} saved source ${source.id} and selected passage.`;
  }

  private async reopenReportCitation(expected: ReportDocumentCitation): Promise<void> {
    const membership = this.requireMembership();
    const auth = this.requireReadAuth();
    const generation = this.generation;
    const workspace = await fetchResearchDocumentJson(`/api/mobile/research/candidate-memberships/${encodeURIComponent(membership.id)}/deep-research`, auth);
    this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
    const citations = reportDocumentCitations(workspace, membership);
    const current = citations.find((item) => item.key === expected.key);
    if (!current || current.reportId !== expected.reportId || current.reportVersion !== expected.reportVersion
      || current.reportFingerprint !== expected.reportFingerprint) {
      throw new Error("Blocked: report or citation identity changed; no alternate source was opened.");
    }
    await this.loadPage(current.documentId, current.pageNumber, current.pageTextSha256, true);
    this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
    this.citations = citations;
    this.message = `Reopened exact current report ${current.reportId} v${current.reportVersion} citation on document ${current.documentId} page ${current.pageNumber}.`;
    this.render();
  }

  private async reopenSelectedReportCitation(expected: ReportDocumentCitation): Promise<void> {
    const membership = this.requireMembership();
    const auth = this.requireReadAuth();
    const generation = this.generation;
    const workspace = await fetchResearchDocumentJson(`/api/mobile/research/candidate-memberships/${encodeURIComponent(membership.id)}/deep-research`, auth);
    this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
    const citations = reportDocumentCitationsForSelection(workspace, membership, {
      id: expected.reportId,
      version: expected.reportVersion,
      reportFingerprint: expected.reportFingerprint
    });
    const current = citations.find((item) => item.key === expected.key);
    if (!current) throw new Error("Blocked: selected report or citation identity changed; no alternate source was opened.");
    await this.loadPage(current.documentId, current.pageNumber, current.pageTextSha256, true);
    this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
    this.message = `Reopened exact report ${current.reportId} v${current.reportVersion} citation on document ${current.documentId} page ${current.pageNumber}.`;
    this.render();
  }

  private async loadPage(documentId: string, pageNumber: number, expectedHash: string | null, openPdf: boolean): Promise<ResearchDocumentPageData> {
    const membership = this.requireMembership();
    const auth = this.requireReadAuth();
    const generation = this.generation;
    const document = await this.freshDocument(documentId, membership, auth, generation);
    const value = await fetchResearchDocumentJson(
      `${documentListPath(membership.id)}/${encodeURIComponent(documentId)}/pages/${pageNumber}`,
      auth
    );
    this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
    const page = await acceptResearchDocumentPage(value, documentId, pageNumber, expectedHash);
    this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
    const bytes = await fetchResearchDocumentPdf(membership, document, auth);
    this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
    this.selectedPage = page;
    this.message = `Verified document ${documentId} page ${pageNumber} against page hash ${page.pageTextSha256}.`;
    this.render();
    if (openPdf) openPdfBytes(bytes, document.originalFilename, pageNumber, false);
    return page;
  }

  private async download(documentId: string): Promise<void> {
    const membership = this.requireMembership();
    const auth = this.requireReadAuth();
    const generation = this.generation;
    const document = await this.freshDocument(documentId, membership, auth, generation);
    const bytes = await fetchResearchDocumentPdf(membership, document, auth);
    this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
    openPdfBytes(bytes, document.originalFilename, null, true);
    this.message = `Downloaded exact PDF ${document.id} after fresh identity, length, signature, and SHA-256 checks.`;
    this.render();
  }

  private async freshDocument(
    documentId: string,
    membership: ExactCockpitMembership,
    auth: WebApiAuth,
    generation: number
  ): Promise<ResearchDocumentData> {
    const list = await this.freshList(membership, auth, generation);
    const document = list.documents.find((item) => item.id === documentId);
    if (!document) throw new Error("Blocked: document is not present in the fresh exact-membership list.");
    if (document.sourceState !== "available") {
      throw new Error(`Blocked: document CAS source state is ${document.sourceState}; page, content, and confirmation are disabled.`);
    }
    return document;
  }

  private async freshList(membership: ExactCockpitMembership, auth: WebApiAuth, generation: number): Promise<ResearchDocumentListEnvelope> {
    this.clearPresentation();
    this.render();
    const list = acceptResearchDocumentList(await fetchResearchDocumentJson(documentListPath(membership.id), auth), membership);
    this.ensureCurrent(membership, generation, auth, this.dependencies.readAuth);
    this.documents = list;
    return list;
  }

  private async run(action: () => Promise<unknown>, label: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await action();
    } catch (error) {
      this.clearPresentation();
      this.message = `${label} blocked: ${documentFailureMessage(error)}`;
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private render(): void {
    if (!this.documentRef) return;
    this.setText("research-documents-membership", this.membership
      ? `${this.membership.symbol} · membership ${this.membership.id} v${this.membership.version}`
      : "No exact current membership selected");
    this.setText("research-documents-status", this.message);
    this.setText("research-document-search-status", searchStatus(this.message, this.search, this.membership !== null));
    const host = this.element("research-documents-console");
    if (host) {
      const availableDocumentIds = new Set(this.documents?.documents.filter((item) => item.sourceState === "available").map((item) => item.id) ?? []);
      const currentMaterials = this.documents?.materials.filter((item) => item.revisionState === "current"
        && item.citation && availableDocumentIds.has(item.citation.documentId)) ?? [];
      host.dataset.state = this.membership ? (this.documents ? "available" : "idle") : "blocked";
      host.dataset.documentCount = String(availableDocumentIds.size);
      host.dataset.materialCount = String(currentMaterials.length);
      host.dataset.pageState = this.selectedPage ? "available" : "missing";
      host.dataset.searchState = this.search ? (this.search.unavailable ? "unavailable" : "available") : "empty";
      host.dataset.searchHitCount = String(this.search?.hits.length ?? 0);
    }
    renderResearchDocumentCollections(this.documentRef, this.documents, this.citations);
    const reportList = this.element("research-report-citations");
    if (reportList) reportList.append(...this.snapshotCitations.map(item => {
      const row = this.documentRef!.createElement("li"), detail = this.documentRef!.createElement("p"), button = this.documentRef!.createElement("button");
      detail.textContent = `${item.title} · report ${item.reportId} v${item.reportVersion} · saved source ${item.citation.snapshotId} · span ${item.citation.startUtf16}–${item.citation.endUtf16}`;
      button.type = "button"; button.dataset.reportSnapshotKey = item.key;
      button.textContent = "Fresh-read and reopen exact saved source passage";
      row.append(detail, button); return row;
    }));
    renderResearchDocumentSearch(this.documentRef, this.search?.unavailable ? null : this.search);
    const sourceList = this.element("research-source-list");
    if (sourceList) {
      sourceList.replaceChildren(...this.storedSources.map(source => {
        const row = this.documentRef!.createElement("li"), button = this.documentRef!.createElement("button");
        button.type = "button";
        button.dataset.storedSourceId = source.id;
        button.textContent = `${source.id} · ${source.reviewState} · ${source.publisher} · ${source.textSha256.slice(0, 12)}`;
        row.append(button);
        return row;
      }));
    }
    this.setText("research-source-identity", this.storedSource
      ? `Saved original ${this.storedSource.id} · ${this.storedSource.responseUrl} · raw ${this.storedSource.rawSha256} · text ${this.storedSource.textSha256}`
      : "Open a saved original to inspect its verified text.");
    const sourceText = this.element("research-source-text");
    const normalized = this.storedSource?.normalizedText ?? "";
    if (sourceText && sourceText.textContent !== normalized) sourceText.textContent = normalized;
    this.setText("research-source-selected", this.selectedStoredSpan
      ? `Selected ${this.selectedStoredSpan.startUtf16}–${this.selectedStoredSpan.endUtf16} · SHA-256 ${this.selectedStoredSpan.excerptSha256}\n${this.selectedStoredSpan.excerpt}`
      : "No passage selected.");
    this.setText("research-document-page-output", this.selectedPage
      ? `Document ${this.selectedPage.documentId}, page ${this.selectedPage.pageNumber}, SHA-256 ${this.selectedPage.pageTextSha256}\n\n${this.selectedPage.normalizedText}`
      : "No fresh verified PDF page is loaded.");
    const announcement = this.preparedAnnouncement;
    const announcementRow = this.element("research-document-announcement");
    const announcementLink = this.element("research-document-announcement-link");
    if (announcementRow) announcementRow.hidden = !announcement;
    if (announcementLink instanceof HTMLAnchorElement) {
      announcementLink.href = announcement?.item.documentUrl ?? "";
      announcementLink.textContent = announcement ? `${announcement.item.title} · ${announcement.item.publishedDate}` : "";
    }
    for (const id of ["research-documents-refresh", "research-document-search", "research-document-upload", "research-document-confirm-fact", "research-source-capture", "research-source-select", "research-source-confirm-material"]) {
      const button = this.element(id);
      if (button instanceof HTMLButtonElement) button.disabled = this.busy || !this.membership;
    }
    const queryInput = this.element("research-document-search-query");
    if (queryInput instanceof HTMLInputElement) queryInput.disabled = this.busy || !this.membership;
  }

  private requireMembership(): ExactCockpitMembership {
    if (!this.membership) throw new Error("An exact non-archived membership must be open in Research.");
    return { ...this.membership };
  }
  private requireReadAuth(): WebApiAuth { const auth = this.dependencies.readAuth(); if (!auth) throw new Error("Read authorization is required."); return auth; }
  private requireWriteAuth(): WebApiAuth { const auth = this.dependencies.writeAuth(); if (!auth) throw new Error("Research-write authorization is required."); return auth; }
  private ensureCurrent(expected: ExactCockpitMembership, generation: number, expectedAuth: WebApiAuth, currentAuth: () => WebApiAuth | null): void {
    try {
      if (generation !== this.generation) throw new Error();
      assertResearchDocumentOperationCurrent(expected, this.membership, expectedAuth, currentAuth());
    } catch {
      this.clearPresentation();
      this.render();
      throw new Error("Blocked: current membership or authorization changed during the operation.");
    }
  }
  private clearPresentation(): void {
    this.documents = null;
    this.citations = [];
    this.snapshotCitations = [];
    this.selectedPage = null;
    this.search = null;
    this.storedSources = [];
    this.storedSource = null;
    this.selectedStoredSpan = null;
  }
  private retryKey(scope: string, fingerprint: string): string {
    const current = this.retryKeys.get(scope);
    if (current?.fingerprint === fingerprint) return current.key;
    const key = crypto.randomUUID();
    this.retryKeys.set(scope, { fingerprint, key });
    return key;
  }
  private pageNumber(): number { const value = Number(this.inputValue("research-document-page-number")); if (!Number.isSafeInteger(value) || value < 1) throw new Error("Page number must be a positive integer."); return value; }
  private searchQuery(): string {
    const query = this.inputValue("research-document-search-query");
    if (query.length > 80) throw new Error("Search query must contain 1 to 80 characters.");
    return query;
  }
  private checked(id: string): boolean { const element = this.element(id); return element instanceof HTMLInputElement && element.checked; }
  private inputValue(id: string, required = true): string { const element = this.element(id); const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value.trim() : ""; if (required && !value) throw new Error(`${id} is required.`); return value; }
  private setInputValue(id: string, value: string): void { const element = this.element(id); if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.value = value; }
  private clearImportForm(): void {
    if (!this.documentRef) return;
    for (const id of ["research-document-file", "research-document-title", "research-document-published-at"]) this.setInputValue(id, "");
    this.setInputValue("research-document-source-version", "owner-upload-v1");
    const rights = this.element("research-document-rights");
    if (rights instanceof HTMLInputElement) rights.checked = false;
  }
  private element(id: string): HTMLElement | null { return this.documentRef?.getElementById(id) ?? null; }
  private setText(id: string, value: string): void { const element = this.element(id); if (element) element.textContent = value; }
}

export function officialAnnouncementImportDraft(item: OfficialAnnouncementDiscoveryItem): {
  publishedAtInput: string;
  publishedAt: string;
  sourceVersion: string;
} {
  const publishedAtInput = `${item.publishedDate}T00:00`;
  return {
    publishedAtInput,
    publishedAt: localDateTimeToIso(publishedAtInput, "Announcement publication date"),
    sourceVersion: `hkexnews-official:publication-date-only:${item.publishedDate}:${item.id}`
  };
}

function searchStatus(message: string, search: ResearchDocumentSearchEnvelopeView | null, membershipOpen: boolean): string {
  return !search && !membershipOpen
    ? "No search result yet. Search is independent of valuation, reports and holdings; it reads only stored document text for the exact current membership."
    : message;
}
