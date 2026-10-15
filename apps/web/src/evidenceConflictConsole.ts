import type { CreateResearchMaterialRequest, DeepResearchWorkspaceEnvelope, ResearchMaterialData } from "../../../packages/contracts/src/deepResearch.js";
import { sameWebApiAuth, type WebApiAuth } from "./apiClient.js";
import {
  acceptEvidenceConflictWorkspace,
  assertReplacementReadback,
  currentEvidenceConflicts,
  exactCurrentConflict,
  EvidenceConflictHttpError,
  type EvidenceConflictMembership,
  readEvidenceConflictWorkspace,
  relatedMaterialRevisions,
  replaceEvidenceConflict,
  safeHttpsSource,
  sameMaterialIdentity
} from "./evidenceConflictData.js";
import {
  acceptResearchDocumentList,
  acceptResearchDocumentPage
} from "./researchDocumentValidation.js";
import {
  documentListPath,
  fetchResearchDocumentJson,
  fetchResearchDocumentPdf,
  localDateTimeToIso,
  openPdfBytes
} from "./researchDocumentTransport.js";

interface EvidenceConflictConsoleDependencies {
  readAuth: () => WebApiAuth | null;
  writeAuth: () => WebApiAuth | null;
  fetcher?: typeof fetch;
  onEvidenceChanged?: (message: string) => void;
}

export class EvidenceConflictConsole {
  private documentRef: Document | null = null;
  private membership: EvidenceConflictMembership | null = null;
  private workspace: DeepResearchWorkspaceEnvelope | null = null;
  private selected: ResearchMaterialData | null = null;
  private pendingPdf: { before: DeepResearchWorkspaceEnvelope; target: ResearchMaterialData; actorId: string } | null = null;
  private retry: { fingerprint: string; key: string } | null = null;
  private generation = 0;
  private busy = false;
  private message = "Open an exact membership in Research, then fresh-read current evidence conflicts.";

  constructor(private readonly dependencies: EvidenceConflictConsoleDependencies) {}

  mount(documentRef: Document = document): void {
    this.documentRef = documentRef;
    this.element("evidence-conflict-refresh")?.addEventListener("click", () => void this.refresh());
    this.element("evidence-conflict-list")?.addEventListener("click", (event) => void this.routeListClick(event));
    this.element("evidence-conflict-save")?.addEventListener("click", () => void this.saveReplacement());
    this.element("evidence-conflict-cancel")?.addEventListener("click", () => { this.selected = null; this.render(); });
    this.render();
  }

  syncMembership(next: EvidenceConflictMembership | null): void {
    if (membershipKey(next) === membershipKey(this.membership)) return;
    this.generation += 1;
    this.busy = false;
    this.membership = next;
    this.clearSuccess();
    this.retry = null;
    this.message = next
      ? `${next.symbol} membership ${next.id} v${next.version} selected. Fresh-read conflicts before acting.`
      : "Open an exact membership in Research, then fresh-read current evidence conflicts.";
    this.render();
  }

  invalidateAuthorization(message: string): void {
    this.generation += 1;
    this.busy = false;
    this.clearSuccess();
    this.retry = null;
    this.message = `${message} Previous conflict success was cleared.`;
    this.render();
  }

  async materialWritten(material: ResearchMaterialData): Promise<void> {
    const pending = this.pendingPdf;
    const membership = this.membership;
    const auth = this.dependencies.readAuth();
    const generation = ++this.generation;
    this.busy = false;
    this.clearSuccess(false);
    this.dependencies.onEvidenceChanged?.("Research material changed; old pack/report actions were cleared. Fresh-refresh Deep Research before continuing.");
    await this.perform(generation, "PDF fact persisted; fresh-reading the exact workspace before showing conflict resolution.", async () => {
      if (!membership || !auth) throw new Error("Exact membership and read authorization are required for PDF readback.");
      const actorId = pending?.actorId;
      const workspace = await readEvidenceConflictWorkspace(membership, auth, actorId, this.dependencies.fetcher);
      this.ensureCurrent(membership, generation, auth);
      if (pending) {
        if (material.replacesMaterialId !== pending.target.id) throw new Error("PDF fact does not replace the selected conflict.");
        assertReplacementReadback(pending.before, workspace, pending.target, material);
      }
      this.workspace = workspace;
      this.pendingPdf = null;
      this.message = pending
        ? resolutionMessage(material, workspace)
        : "Fresh workspace loaded after the PDF material write; no automatic verification or freeze occurred.";
    });
  }

  private async refresh(): Promise<void> {
    if (this.busy) return;
    let membership: EvidenceConflictMembership;
    let auth: WebApiAuth;
    try { membership = this.requireMembership(); auth = this.requireReadAuth(); }
    catch (error) { this.clearSuccess(); return this.fail(failureMessage(error)); }
    const generation = ++this.generation;
    this.clearSuccess();
    await this.perform(generation, "Fresh-reading current conflict and revision identities…", async () => {
      const workspace = await readEvidenceConflictWorkspace(membership, auth, undefined, this.dependencies.fetcher);
      this.ensureCurrent(membership, generation, auth);
      this.workspace = workspace;
      this.message = workspaceMessage(workspace);
    });
  }

  private async continuePending(expected: ResearchMaterialData): Promise<void> {
    if (this.busy) return;
    const membership = this.requireMembership();
    const auth = this.requireReadAuth();
    const actorId = this.workspace?.requestedActorId;
    const generation = ++this.generation;
    this.clearSuccess();
    await this.perform(generation, "Fresh-reading the selected conflict before keeping it pending…", async () => {
      const workspace = await readEvidenceConflictWorkspace(membership, auth, actorId, this.dependencies.fetcher);
      this.ensureCurrent(membership, generation, auth);
      const target = exactCurrentConflict(workspace, expected);
      this.workspace = workspace;
      this.message = `Explicitly kept material ${target.id} r${target.revision} pending as ${target.verificationStatus}. No write occurred; evidence-pack freeze remains blocked.`;
    });
  }

  private beginReplacement(target: ResearchMaterialData): void {
    if (!this.workspace) return;
    if (target.sourceType === "owner_provided_pdf") {
      const replaces = this.element("research-document-replaces-id");
      if (!(replaces instanceof HTMLInputElement)) return this.fail("Exact PDF replacement control is unavailable.");
      replaces.value = target.id;
      this.pendingPdf = { before: this.workspace, target, actorId: this.workspace.requestedActorId };
      this.selected = null;
      this.message = `Material ${target.id} selected for exact-page PDF replacement. Choose/import the PDF, verify its page, and explicitly confirm the fact; fresh workspace readback will follow.`;
      this.element("research-documents-console")?.scrollIntoView({ block: "start" });
      this.render();
      return;
    }
    if (target.sourceUrl && !safeHttpsSource(target)) return this.fail("Unsafe non-HTTPS source: replacement and reopen are blocked; keep it pending or use a safe exact source.");
    this.selected = target;
    this.pendingPdf = null;
    this.setValue("evidence-conflict-title", "");
    this.setValue("evidence-conflict-content", "");
    this.setValue("evidence-conflict-source-version", "");
    this.setValue("evidence-conflict-published-at", "");
    this.setValue("evidence-conflict-valid-until", "");
    this.setValue("evidence-conflict-summary-input", "");
    this.setValue("evidence-conflict-verification", "");
    this.setValue("evidence-conflict-stance", target.stance);
    this.message = `Material ${target.id} r${target.revision} selected. Enter replacement evidence and explicitly choose verification; nothing is auto-accepted.`;
    this.render();
  }

  private async saveReplacement(): Promise<void> {
    if (this.busy) return;
    let membership: EvidenceConflictMembership;
    let readAuth: WebApiAuth;
    let writeAuth: WebApiAuth;
    try { membership = this.requireMembership(); readAuth = this.requireReadAuth(); writeAuth = this.requireWriteAuth(); }
    catch (error) { this.clearSuccess(); return this.fail(failureMessage(error)); }
    const target = this.selected;
    const actorId = this.workspace?.requestedActorId;
    if (!target || !actorId) return this.fail("Fresh-read and explicitly select one current conflict first.");
    let request: CreateResearchMaterialRequest;
    try { request = this.replacementRequest(membership, target); } catch (error) { return this.fail(failureMessage(error)); }
    const fingerprint = JSON.stringify([membershipKey(membership), target.id, target.revision, target.contentFingerprint, request]);
    const idempotencyKey = this.retry?.fingerprint === fingerprint ? this.retry.key : crypto.randomUUID();
    this.retry = { fingerprint, key: idempotencyKey };
    request.idempotencyKey = idempotencyKey;
    const generation = ++this.generation;
    this.workspace = null;
    this.dependencies.onEvidenceChanged?.("Replacement started; old pack/report actions were cleared. Fresh-refresh Deep Research after resolution or failure.");
    await this.perform(generation, "Fresh-checking the conflict before the explicit replacement write…", async () => {
      const result = await replaceEvidenceConflict({
        membership, actorId, target, request, readAuth, writeAuth,
        ensureCurrent: () => this.ensureCurrent(membership, generation, readAuth, writeAuth),
        fetcher: this.dependencies.fetcher
      });
      this.workspace = result.workspace;
      this.selected = null;
      this.retry = null;
      this.message = resolutionMessage(result.material, result.workspace);
    });
  }

  private async reopenSource(expected: ResearchMaterialData): Promise<void> {
    if (this.busy) return;
    const membership = this.requireMembership();
    const auth = this.requireReadAuth();
    const actorId = this.workspace?.requestedActorId;
    const generation = ++this.generation;
    this.workspace = null;
    await this.perform(generation, "Fresh-checking the exact material before reopening its source…", async () => {
      const workspace = await readEvidenceConflictWorkspace(membership, auth, actorId, this.dependencies.fetcher);
      this.ensureCurrent(membership, generation, auth);
      const matches = (workspace.data?.materials ?? []).filter((material) => sameMaterialIdentity(material, expected));
      if (matches.length !== 1) throw new Error("Material revision changed or became ambiguous; no source was opened.");
      const current = matches[0];
      if (current.citation) await this.reopenPdf(current, membership, auth, generation);
      else this.openHttps(current, membership, auth, generation);
      this.workspace = workspace;
      this.message = `Reopened the exact ${current.revisionState} material ${current.id} r${current.revision} source after fresh identity checks.`;
    });
  }

  private async reopenPdf(material: ResearchMaterialData, membership: EvidenceConflictMembership, auth: WebApiAuth, generation: number): Promise<void> {
    const exact = { id: membership.id, version: membership.version, symbol: membership.symbol };
    const list = acceptResearchDocumentList(await fetchResearchDocumentJson(documentListPath(membership.id), auth), exact);
    this.ensureCurrent(membership, generation, auth);
    const matches = list.materials.filter((candidate) => sameMaterialIdentity(candidate, material));
    if (matches.length !== 1 || !material.citation) throw new Error("Exact PDF material citation is absent or ambiguous in the fresh document list.");
    const document = list.documents.find((candidate) => candidate.id === material.citation!.documentId);
    if (!document || document.sourceState !== "available") throw new Error("Exact PDF CAS content is missing, corrupt, or unavailable.");
    await acceptResearchDocumentPage(await fetchResearchDocumentJson(
      `${documentListPath(membership.id)}/${document.id}/pages/${material.citation.pageNumber}`, auth
    ), document.id, material.citation.pageNumber, material.citation.pageTextSha256);
    this.ensureCurrent(membership, generation, auth);
    const bytes = await fetchResearchDocumentPdf(exact, document, auth);
    this.ensureCurrent(membership, generation, auth);
    openPdfBytes(bytes, document.originalFilename, material.citation.pageNumber, false);
  }

  private openHttps(material: ResearchMaterialData, membership: EvidenceConflictMembership, auth: WebApiAuth, generation: number): void {
    const source = safeHttpsSource(material);
    if (!source) throw new Error("Material has no safe exact HTTPS source; no source was opened.");
    this.ensureCurrent(membership, generation, auth);
    const anchor = this.documentRef!.createElement("a");
    anchor.href = source; anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; anchor.click();
  }

  private async routeListClick(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !this.workspace || this.busy) return;
    const button = target.closest("button[data-conflict-action]");
    if (!(button instanceof HTMLButtonElement)) return;
    const material = this.workspace.data?.materials.find((item) => item.id === button.dataset.materialId);
    if (!material) return;
    try {
      if (button.dataset.conflictAction === "reopen") await this.reopenSource(material);
      else if (button.dataset.conflictAction === "replace") this.beginReplacement(exactCurrentConflict(this.workspace, material));
      else if (button.dataset.conflictAction === "pending") await this.continuePending(exactCurrentConflict(this.workspace, material));
    } catch (error) { this.clearSuccess(); this.fail(`${failureMessage(error)} Previous conflict success was cleared.`); }
  }

  private replacementRequest(membership: EvidenceConflictMembership, target: ResearchMaterialData): CreateResearchMaterialRequest {
    return {
      membershipId: membership.id, membershipVersion: membership.version,
      title: this.value("evidence-conflict-title"), contentText: this.value("evidence-conflict-content"),
      sourceType: target.sourceType, sourceUrl: target.sourceUrl,
      publishedAt: localDateTimeToIso(this.value("evidence-conflict-published-at"), "Published at"),
      claimType: target.claimType, verificationStatus: this.value("evidence-conflict-verification") as CreateResearchMaterialRequest["verificationStatus"],
      rightsStatus: target.rightsStatus, sourceVersion: this.value("evidence-conflict-source-version"), replacesMaterialId: target.id,
      validUntil: localDateTimeToIso(this.value("evidence-conflict-valid-until"), "Valid until"),
      summary: this.value("evidence-conflict-summary-input"), variableName: target.variableName,
      stance: this.value("evidence-conflict-stance") as CreateResearchMaterialRequest["stance"],
      reliability: target.reliability, materiality: target.materiality, isRead: target.isRead, idempotencyKey: ""
    };
  }

  private render(): void {
    if (!this.documentRef) return;
    const host = this.element("evidence-conflict-console");
    const list = this.element("evidence-conflict-list");
    const editor = this.element("evidence-conflict-editor");
    this.setText("evidence-conflict-status", this.message);
    if (host) host.dataset.state = !this.membership ? "blocked" : this.busy ? "loading" : this.workspace ? "available" : "idle";
    if (list instanceof HTMLUListElement) list.replaceChildren(...this.conflictRows());
    if (editor) editor.hidden = this.selected === null;
    this.setText("evidence-conflict-selected", this.selected
      ? `Replacing material ${this.selected.id} r${this.selected.revision}; source ${this.selected.sourceType}/${this.selected.sourceVersion}; rights ${this.selected.rightsStatus}; claim ${this.selected.claimType}.`
      : "No replacement target selected.");
    for (const id of ["evidence-conflict-refresh", "evidence-conflict-save", "evidence-conflict-cancel"]) {
      const button = this.element(id);
      if (button instanceof HTMLButtonElement) button.disabled = this.busy || id !== "evidence-conflict-refresh" && !this.selected;
    }
  }

  private conflictRows(): HTMLLIElement[] {
    const workspace = this.workspace;
    if (!workspace || !this.documentRef) return [];
    return currentEvidenceConflicts(workspace).map((conflict) => {
      const row = this.documentRef!.createElement("li");
      row.append(this.materialSummary(conflict, "Current unresolved evidence"), this.actionButton(conflict, "reopen", sourceLabel(conflict)),
        this.actionButton(conflict, "replace", "Add replacement evidence"), this.actionButton(conflict, "pending", "Continue pending"));
      const related = relatedMaterialRevisions(workspace, conflict);
      const heading = this.documentRef!.createElement("p");
      heading.textContent = related.length ? "Related replacement history (never presented as current):" : "No related replacement revision is recorded; the conflict remains pending.";
      row.append(heading);
      if (related.length) {
        const list = this.documentRef!.createElement("ul");
        list.append(...related.map((material) => { const item = this.documentRef!.createElement("li"); item.append(this.materialSummary(material, "Related historical evidence"), this.actionButton(material, "reopen", sourceLabel(material))); return item; }));
        row.append(list);
      }
      return row;
    });
  }

  private materialSummary(material: ResearchMaterialData, label: string): HTMLElement {
    const block = this.documentRef!.createElement("div");
    const title = this.documentRef!.createElement("strong");
    title.textContent = `${label}: ${material.title}`;
    const detail = this.documentRef!.createElement("p");
    const source = material.citation
      ? `document ${material.citation.documentId} page ${material.citation.pageNumber} hash ${material.citation.pageTextSha256}`
      : `URL ${material.sourceUrl ?? "UNKNOWN"}`;
    detail.textContent = `Material ${material.id} / evidence ${material.evidenceId} · r${material.revision}/${material.revisionState} · ${material.verificationStatus}/${material.stance} · ${material.sourceType}/${material.sourceVersion} · ${source} · ${material.summary}`;
    block.append(title, detail);
    return block;
  }

  private actionButton(material: ResearchMaterialData, action: string, label: string): HTMLButtonElement {
    const button = this.documentRef!.createElement("button");
    button.type = "button"; button.dataset.conflictAction = action; button.dataset.materialId = material.id; button.textContent = label;
    if (action === "reopen" && !material.citation && !safeHttpsSource(material)) button.disabled = true;
    return button;
  }

  private async perform(generation: number, progress: string, action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.message = progress; this.render();
    try { await action(); } catch (error) {
      if (generation !== this.generation || error instanceof StaleEvidenceConflictOperation) return;
      this.clearSuccess(); this.message = `${failureMessage(error)} Previous conflict success was cleared.`;
    } finally { if (generation === this.generation) { this.busy = false; this.render(); } }
  }

  private ensureCurrent(expected: EvidenceConflictMembership, generation: number, readAuth: WebApiAuth, writeAuth?: WebApiAuth): void {
    if (generation !== this.generation || membershipKey(expected) !== membershipKey(this.membership)
      || !sameWebApiAuth(readAuth, this.dependencies.readAuth())
      || writeAuth !== undefined && !sameWebApiAuth(writeAuth, this.dependencies.writeAuth())) {
      throw new StaleEvidenceConflictOperation();
    }
  }

  private clearSuccess(clearPending = true): void { this.workspace = null; this.selected = null; if (clearPending) this.pendingPdf = null; }
  private fail(message: string): void { this.message = message; this.render(); }
  private requireMembership(): EvidenceConflictMembership { if (!this.membership) throw new Error("Open one exact active membership in Research."); return { ...this.membership }; }
  private requireReadAuth(): WebApiAuth { const auth = this.dependencies.readAuth(); if (!auth) throw new Error("Read authorization is required."); return auth; }
  private requireWriteAuth(): WebApiAuth { const auth = this.dependencies.writeAuth(); if (!auth) throw new Error("Research-write authorization is required."); return auth; }
  private element(id: string): HTMLElement | null { return this.documentRef?.getElementById(id) ?? null; }
  private value(id: string): string { const input = this.element(id); const value = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement ? input.value.trim() : ""; if (!value) throw new Error(`${id} is required.`); return value; }
  private setValue(id: string, value: string): void { const input = this.element(id); if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement) input.value = value; }
  private setText(id: string, value: string): void { const element = this.element(id); if (element) element.textContent = value; }
}

function membershipKey(value: EvidenceConflictMembership | null): string | null { return value ? `${value.sourceKey}:${value.id}:v${value.version}:${value.state}:${value.symbol}` : null; }
function sourceLabel(material: ResearchMaterialData): string { return material.citation ? "Fresh-read and reopen exact PDF page" : safeHttpsSource(material) ? "Fresh-read and reopen exact HTTPS source" : "Source missing or unsafe"; }
function workspaceMessage(workspace: DeepResearchWorkspaceEnvelope): string {
  const conflicts = currentEvidenceConflicts(workspace);
  const pack = workspace.data?.latestPack;
  const report = workspace.data?.latestReport;
  return conflicts.length
    ? `${conflicts.length} current conflict/rejected material(s). Pack ${pack ? `${pack.id}/${pack.currentness.status}` : "missing"}; report ${report ? `${report.id} v${report.version}/${report.currentness.status}` : "missing"}. Choose replacement or continue pending explicitly.`
    : `No current conflict/rejected material. ${pack?.currentness.status === "historical" ? "The old pack remains historical; refresh Deep Research and explicitly re-freeze before a new report." : "No automatic freeze or report action occurred."}`;
}
function resolutionMessage(material: ResearchMaterialData, workspace: DeepResearchWorkspaceEnvelope): string {
  return ["conflict", "rejected"].includes(material.verificationStatus)
    ? `Fresh readback confirmed replacement material ${material.id} r${material.revision} remains ${material.verificationStatus}; re-freeze stays blocked.`
    : `Fresh readback confirmed replacement material ${material.id} r${material.revision}; the old conflict is historical. Pack ${workspace.data?.latestPack ? `${workspace.data.latestPack.id}/${workspace.data.latestPack.currentness.status}` : "missing"}; report ${workspace.data?.latestReport ? `${workspace.data.latestReport.id} v${workspace.data.latestReport.version}/${workspace.data.latestReport.currentness.status}` : "missing"}. Refresh Deep Research, then explicitly re-freeze.`;
}
function failureMessage(error: unknown): string {
  if (error instanceof EvidenceConflictHttpError) return `${error.status === 401 || error.status === 403 ? "Unauthorized" : error.status === 409 ? "Conflict" : error.status >= 500 ? "Unavailable" : "Request blocked"}: ${error.message}`;
  return error instanceof Error ? error.message : "Evidence conflict operation failed.";
}
class StaleEvidenceConflictOperation extends Error {}
