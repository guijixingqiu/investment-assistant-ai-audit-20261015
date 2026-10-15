import {
  validateCreateResearchContextRequest,
  validateResearchContextSnapshotData,
  type CreateResearchContextRequest
} from "../../../packages/contracts/src/researchContext.js";
import {
  validateCreateResearchFundamentalValueRequest,
  type CreateResearchFundamentalValueRequest
} from "../../../packages/contracts/src/researchFundamentals.js";
import {
  validateCreateResearchValuationScenarioRequest,
  type CreateResearchValuationScenarioRequest
} from "../../../packages/contracts/src/researchValuationScenarios.js";
import {
  validateCreateResearchCompletenessRequest,
  type CreateResearchCompletenessRequest,
  type ResearchCompletenessEnvelope
} from "../../../packages/contracts/src/researchCompleteness.js";
import { sameWebApiAuth, type WebApiAuth } from "./apiClient.js";
import { resetControlsToDefaults } from "./domRender.js";
import { readStoredSource, verifyStoredSourceOriginal } from "./researchSourceSnapshotWeb.js";
import {
  currentFinancialRequirementMaterials,
  contextMatchesRequest,
  fundamentalMatchesRequest,
  readResearchDossier,
  sameDossierFacts,
  valuationMatchesRequest,
  writeResearchCompleteness,
  writeResearchDossier,
  type ResearchDossierMembership,
  type ResearchDossierSnapshot,
  type CreateResearchFinancialRequirementRequest
} from "./researchDossierData.js";
import {
  completenessDossierDraft,
  contextDossierDraft,
  financialRequirementDossierDraft,
  fundamentalDossierDraft,
  renderResearchDossier,
  syncContextEntryFields,
  valuationDossierDraft,
  type ResearchDossierDraft
} from "./researchDossierView.js";

interface ResearchDossierConsoleDependencies {
  readAuth: () => WebApiAuth | null;
  writeAuth: () => WebApiAuth | null;
  onResearchWrite: (message: string) => void;
  openFinancialRequirementSource: (material: import("../../../packages/contracts/src/researchMaterial.js").ResearchMaterialData, actorId: string) => Promise<void>;
}

type DossierRequest = CreateResearchContextRequest | CreateResearchFundamentalValueRequest | CreateResearchValuationScenarioRequest | CreateResearchCompletenessRequest | CreateResearchFinancialRequirementRequest;
type DossierKind = "context" | "fundamental" | "valuation" | "completeness" | "financialRequirement";
interface RetryIntent { key: string; request: DossierRequest; attempted: boolean; }

export class ResearchDossierConsole {
  private documentRef: Document | null = null;
  private membership: ResearchDossierMembership | null = null;
  private snapshot: ResearchDossierSnapshot | null = null;
  private message = "Open an exact membership in Research before using the structured dossier.";
  private generation = 0;
  private busy = 0;
  private readonly retries = new Map<string, RetryIntent>();
  private readonly selectedFinancialSourceIds = new Set<string>();

  constructor(private readonly dependencies: ResearchDossierConsoleDependencies) {}

  mount(documentRef: Document = document): void {
    this.documentRef = documentRef;
    this.element("research-dossier-refresh")?.addEventListener("click", () => void this.run("Fresh-reading structured dossier…", (token) => this.refresh(token)));
    this.element("research-dossier-context-save")?.addEventListener("click", () => void this.run("Saving source-bound research context…", (token, displayed) => this.saveContext(token, displayed)));
    this.element("research-dossier-context-kind")?.addEventListener("change", () => syncContextEntryFields(documentRef));
    this.element("research-dossier-fundamental-save")?.addEventListener("click", () => void this.run("Saving Owner-transcribed issuer fundamental…", (token, displayed) => this.saveFundamental(token, displayed)));
    this.element("research-dossier-valuation-method")?.addEventListener("change", () => this.render());
    this.element("research-dossier-valuation-save")?.addEventListener("click", () => void this.run("Saving fundamental-anchored Owner valuation scenario…", (token, displayed) => this.saveValuation(token, displayed)));
    this.element("research-dossier-completeness-save")?.addEventListener("click", () => void this.run("Recording current research coverage and UNKNOWN gaps…", (token, displayed) => this.saveCompleteness(token, displayed)));
    this.element("research-financial-requirement-save")?.addEventListener("click", () => void this.run("正在保存财务资料期数核对…", (token, displayed) => this.saveFinancialRequirement(token, displayed)));
    this.documentRef.querySelectorAll("#research-financial-requirement input:not(#research-financial-requirement-confirm)")
      .forEach(input => input.addEventListener("input", () => this.clearFinancialRequirementConfirmation()));
    this.element("research-dossier-open-deep-research")?.addEventListener("click", () => this.openDeepResearch());
    this.element("research-financial-requirement-sources")?.addEventListener("change", event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !input.dataset.financialRequirementSource) return;
      if (input.checked) this.selectedFinancialSourceIds.add(input.value);
      else this.selectedFinancialSourceIds.delete(input.value);
      this.clearFinancialRequirementConfirmation();
    });
    this.element("research-financial-requirement-sources")?.addEventListener("click", event => {
      const button = event.target;
      if (!(button instanceof HTMLButtonElement) || !button.dataset.financialRequirementOpen) return;
      const snapshot = this.snapshot;
      const material = snapshot && currentFinancialRequirementMaterials(snapshot)
        .find(item => item.id === button.dataset.financialRequirementOpen);
      if (material && snapshot) void this.dependencies.openFinancialRequirementSource(material, snapshot.actorId);
    });
    syncContextEntryFields(documentRef);
    this.render();
  }

  syncMembership(next: ResearchDossierMembership | null): void {
    if (membershipKey(next) === membershipKey(this.membership)) return;
    this.generation += 1;
    this.busy = 0;
    this.membership = next;
    this.snapshot = null;
    this.retries.clear();
    this.selectedFinancialSourceIds.clear();
    if (this.documentRef) resetControlsToDefaults(
      this.documentRef,
      "#research-dossier-console input, #research-dossier-console select, #research-dossier-console textarea"
    );
    this.message = next
      ? `Exact ${next.symbol} membership ${next.id} v${next.version} selected. Stock-bound draft input was cleared; fresh-read before saving dossier facts.`
      : "Open an exact non-archived membership in Research before using the structured dossier.";
    this.render();
  }

  invalidateAuthorization(message: string): void {
    this.generation += 1;
    this.busy = 0;
    this.snapshot = null;
    this.selectedFinancialSourceIds.clear();
    this.message = `${message} Structured dossier facts are UNKNOWN until a fresh read succeeds; form input and retry intent remain local.`;
    this.render();
  }

  private async refresh(token: number): Promise<void> {
    const membership = this.requireMembership();
    const auth = this.requireReadAuth();
    const snapshot = await readResearchDossier(membership, auth);
    this.ensureCurrent(token, membership, auth, this.dependencies.readAuth);
    this.snapshot = snapshot;
    const eligible = new Set(currentFinancialRequirementMaterials(snapshot).map(item => item.id));
    for (const id of this.selectedFinancialSourceIds) if (!eligible.has(id)) {
      this.selectedFinancialSourceIds.delete(id);
      this.clearFinancialRequirementConfirmation();
    }
    this.message = `Fresh dossier loaded for actor ${snapshot.actorId}: context ${snapshot.context.data?.id ?? "UNKNOWN"}, ${snapshot.fundamentals.values.length} fundamental value(s), ${snapshot.valuations.scenarioSets.length} valuation scenario(s), coverage ${snapshot.completeness?.data ? `${snapshot.completeness.data.score.availableSections}/9` : "UNKNOWN"}.`;
  }

  private async saveContext(token: number, displayed: ResearchDossierSnapshot | null): Promise<void> {
    if (!displayed || !this.documentRef) throw new Error("Fresh-read the exact dossier before saving context.");
    const membership = this.requireMembership();
    const draft = contextDossierDraft(this.documentRef, displayed, membership);
    const intent = this.intent("context", draft);
    const validation = validateCreateResearchContextRequest(intent.request);
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    await this.writeAndReadback(token, displayed, membership, "context", draft.logicalFingerprint, intent,
      `/api/mobile/research/candidate-memberships/${encodeURIComponent(membership.id)}/research-context`,
      (after, response, attemptedBefore, before) => {
        const current = after.context.data;
        if (!contextMatchesRequest(current, intent.request as CreateResearchContextRequest)) return false;
        if (response && (!validateResearchContextSnapshotData(response).ok || response.id !== current?.id)) return false;
        return response !== null || attemptedBefore || current?.id !== before.context.data?.id;
      }, "Research context fresh readback confirmed. Deep Research was cleared; refresh it explicitly when ready.");
  }

  private async saveFundamental(token: number, displayed: ResearchDossierSnapshot | null): Promise<void> {
    if (!displayed || !this.documentRef) throw new Error("Fresh-read the exact dossier before saving a fundamental.");
    const membership = this.requireMembership();
    const draft = fundamentalDossierDraft(this.documentRef, displayed, membership);
    const intent = this.intent("fundamental", draft);
    const validation = validateCreateResearchFundamentalValueRequest(intent.request);
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    const request = intent.request as CreateResearchFundamentalValueRequest;
    if (request.assertion?.snapshotTextBinding) {
      const material = displayed.htmlMaterials?.find(item => item.id === request.sourceMaterialId);
      const citation = material?.snapshotCitation, original = material?.snapshotOriginal;
      if (!material || !citation || !original) throw new Error("The HTML material citation is missing.");
      const auth = this.requireReadAuth();
      const source = await readStoredSource(membership, citation.snapshotId, auth);
      await verifyStoredSourceOriginal(membership, source, auth);
      this.ensureCurrent(token, membership, auth, this.dependencies.readAuth);
      if (source.reviewState !== "current" || source.rawSha256 !== original.rawSha256
        || source.textSha256 !== citation.textSha256
        || source.normalizedText.slice(citation.startUtf16, citation.endUtf16) !== material.contentText
        || material.contentText !== request.assertion.snapshotTextBinding.sourceExcerpt) {
        throw new Error("The saved HTML original, selected text, or review state changed.");
      }
    }
    await this.writeAndReadback(token, displayed, membership, "fundamental", draft.logicalFingerprint, intent,
      `/api/mobile/research/candidate-memberships/${encodeURIComponent(membership.id)}/fundamentals`,
      (after, response, attemptedBefore, before) => {
        const request = intent.request as CreateResearchFundamentalValueRequest;
        const matches = after.fundamentals.values.filter((item) => fundamentalMatchesRequest(item, request));
        if (matches.length !== 1 || response && response.id !== matches[0].id) return false;
        const beforeIds = new Set(before.fundamentals.values.filter((item) => fundamentalMatchesRequest(item, request)).map((item) => item.id));
        return response !== null || attemptedBefore || !beforeIds.has(matches[0].id);
      }, "Fundamental fresh readback confirmed. It remains unverified research-only evidence; refresh Deep Research explicitly.");
  }

  private async saveValuation(token: number, displayed: ResearchDossierSnapshot | null): Promise<void> {
    if (!displayed || !this.documentRef) throw new Error("Fresh-read the exact dossier before saving a valuation scenario.");
    const membership = this.requireMembership();
    const draft = valuationDossierDraft(this.documentRef, displayed, membership);
    const intent = this.intent("valuation", draft);
    const validation = validateCreateResearchValuationScenarioRequest(intent.request);
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    await this.writeAndReadback(token, displayed, membership, "valuation", draft.logicalFingerprint, intent,
      `/api/mobile/research/candidate-memberships/${encodeURIComponent(membership.id)}/valuation-scenarios`,
      (after, response, attemptedBefore, before) => {
        const request = intent.request as CreateResearchValuationScenarioRequest;
        const matches = after.valuations.scenarioSets.filter((item) => valuationMatchesRequest(item, request));
        if (matches.length !== 1 || response && response.id !== matches[0].id) return false;
        const beforeIds = new Set(before.valuations.scenarioSets.filter((item) => valuationMatchesRequest(item, request)).map((item) => item.id));
        return response !== null || attemptedBefore || !beforeIds.has(matches[0].id);
      }, "Valuation scenario fresh readback confirmed. It is an Owner assumption, not a forecast, target, recommendation, or trade action.");
  }

  private async saveCompleteness(token: number, displayed: ResearchDossierSnapshot | null): Promise<void> {
    if (!displayed) throw new Error("Fresh-read the exact dossier before recording coverage.");
    const membership = this.requireMembership();
    const draft = completenessDossierDraft(displayed, membership);
    const intent = this.intent("completeness", draft);
    const request = intent.request as CreateResearchCompletenessRequest;
    const validation = validateCreateResearchCompletenessRequest(request);
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    const readAuth = this.requireReadAuth();
    const writeAuth = this.requireWriteAuth();
    const before = await readResearchDossier(membership, readAuth);
    this.ensureWriteCurrent(token, membership, readAuth, writeAuth, "completeness", draft.logicalFingerprint, displayed);
    if (!sameDossierFacts(displayed, before)) throw new Error("Dossier facts drifted before coverage was recorded; refresh and review again.");
    intent.attempted = true;
    let response: ResearchCompletenessEnvelope | null = null;
    let writeError: unknown = null;
    try {
      response = await writeResearchCompleteness(
        `/api/mobile/research/candidate-memberships/${encodeURIComponent(membership.id)}/completeness`, request, writeAuth, before.actorId
      );
    } catch (error) { writeError = error; }
    this.ensureWriteCurrent(token, membership, readAuth, writeAuth, "completeness", draft.logicalFingerprint, displayed);
    const after = await readResearchDossier(membership, readAuth);
    this.ensureWriteCurrent(token, membership, readAuth, writeAuth, "completeness", draft.logicalFingerprint, displayed);
    const fresh = after.completeness;
    const changed = fresh?.latestSnapshotId !== before.completeness?.latestSnapshotId;
    if (!fresh?.data || fresh.status !== "available"
      || response && JSON.stringify(response) !== JSON.stringify(fresh)
      || !response && !changed) {
      throw writeError ?? new Error("Fresh dossier did not return the recorded coverage snapshot.");
    }
    this.retries.delete(draft.logicalFingerprint);
    this.snapshot = after;
    this.message = `Research coverage fresh readback confirmed: ${fresh.data.score.availableSections}/9 domains; UNKNOWN gaps remain visible.`;
  }

  private async saveFinancialRequirement(token: number, displayed: ResearchDossierSnapshot | null): Promise<void> {
    if (!displayed || !this.documentRef) throw new Error("请先读取当前公司的财务资料与来源。 ");
    const membership = this.requireMembership();
    const draft = financialRequirementDossierDraft(this.documentRef, displayed, membership,
      this.selectedFinancialSourceIds);
    const intent = this.intent("financialRequirement", draft);
    const request = intent.request as CreateResearchFinancialRequirementRequest;
    await this.writeAndReadback(token, displayed, membership, "financialRequirement",
      draft.logicalFingerprint, intent,
      `/api/mobile/research/candidate-memberships/${encodeURIComponent(membership.id)}/financial-requirement`,
      (after, response, attemptedBefore, before) => {
        const envelope = after.financialRequirement;
        const value = envelope?.data;
        if (envelope?.status !== "available" || !value || response && response.id !== value.id
          || value.membershipId !== membership.id || value.membershipVersion !== membership.version
          || value.actorId !== after.actorId || value.fiscalYearEnd !== request.fiscalYearEnd
          || value.latestRequiredAnnualPeriodEnd !== request.latestRequiredAnnualPeriodEnd
          || value.latestRequiredInterimPeriodStart !== request.latestRequiredInterimPeriodStart
          || value.latestRequiredInterimPeriodEnd !== request.latestRequiredInterimPeriodEnd
          || value.asOf !== request.asOf || value.nextReviewAt !== request.nextReviewAt
          || value.sources.length !== request.sourceMaterials.length
          || !request.sourceMaterials.every(source => value.sources.some(saved =>
            saved.materialId === source.materialId && saved.materialRevision === source.materialRevision
            && saved.contentFingerprint === source.contentFingerprint))) return false;
        return response !== null || attemptedBefore
          || value.id !== before.financialRequirement?.latestRequirementId;
      }, "财务资料期数已按当前公司与来源保存并回读。请查看实际缺口，再刷新研究覆盖和证据包。 ");
    this.clearFinancialRequirementConfirmation();
  }

  private async writeAndReadback(
    token: number,
    displayed: ResearchDossierSnapshot,
    membership: ResearchDossierMembership,
    kind: DossierKind,
    logicalFingerprint: string,
    intent: RetryIntent,
    path: string,
    readback: (after: ResearchDossierSnapshot, response: Record<string, unknown> | null, attemptedBefore: boolean, before: ResearchDossierSnapshot) => boolean,
    success: string
  ): Promise<void> {
    const readAuth = this.requireReadAuth();
    const writeAuth = this.requireWriteAuth();
    const before = await readResearchDossier(membership, readAuth);
    this.ensureWriteCurrent(token, membership, readAuth, writeAuth, kind, logicalFingerprint, displayed);
    if (!sameDossierFacts(displayed, before)) throw new Error("Dossier facts, source material, or anchor drifted before the write; refresh and review again.");
    const attemptedBefore = intent.attempted;
    intent.attempted = true;
    this.dependencies.onResearchWrite("Structured dossier write attempted; old Deep Research workspace, pack, and report were cleared. Fresh refresh is required.");
    let response: Record<string, unknown> | null = null;
    let writeError: unknown = null;
    try {
      const value = await writeResearchDossier(path, intent.request, writeAuth, before.actorId);
      response = record(value) ? value : null;
      if (!response) throw new Error("Dossier write response data is malformed.");
    } catch (error) {
      writeError = error;
    }
    this.ensureWriteCurrent(token, membership, readAuth, writeAuth, kind, logicalFingerprint, displayed);
    const after = await readResearchDossier(membership, readAuth);
    this.ensureWriteCurrent(token, membership, readAuth, writeAuth, kind, logicalFingerprint, displayed);
    if (!readback(after, response, attemptedBefore, before)) {
      throw writeError ?? new Error("Fresh dossier did not return one exact write result.");
    }
    this.retries.delete(logicalFingerprint);
    this.snapshot = after;
    this.message = success;
  }

  private intent<T extends DossierRequest>(kind: DossierKind, draft: ResearchDossierDraft<T>): RetryIntent {
    const current = this.retries.get(draft.logicalFingerprint);
    if (current?.attempted) return current;
    const request = { ...draft.request, idempotencyKey: current?.key ?? `web-dossier-${kind}-${crypto.randomUUID()}` } as unknown as DossierRequest;
    const intent = { key: request.idempotencyKey, request, attempted: false };
    this.retries.set(draft.logicalFingerprint, intent);
    return intent;
  }

  private async run(
    progress: string,
    action: (token: number, displayed: ResearchDossierSnapshot | null) => Promise<void>
  ): Promise<void> {
    if (this.busy) return;
    const displayed = this.snapshot;
    const token = ++this.generation;
    this.busy = token;
    this.snapshot = null;
    this.message = `${progress} Previous success is hidden.`;
    this.render();
    try {
      await action(token, displayed);
    } catch (error) {
      if (token !== this.generation) return;
      this.snapshot = null;
      this.message = `Dossier UNKNOWN: ${error instanceof Error ? error.message : "operation failed"}`;
    } finally {
      if (this.busy === token) {
        this.busy = 0;
        this.render();
      }
    }
  }

  private ensureWriteCurrent(token: number, membership: ResearchDossierMembership, readAuth: WebApiAuth, writeAuth: WebApiAuth, kind: DossierKind, logical: string, displayed: ResearchDossierSnapshot): void {
    this.ensureCurrent(token, membership, readAuth, this.dependencies.readAuth);
    if (!sameWebApiAuth(writeAuth, this.dependencies.writeAuth()) || !this.documentRef
      || this.currentLogical(kind, displayed, membership) !== logical) {
      throw new Error("Membership, authorization, source material, anchor, or form input changed during the write.");
    }
  }

  private currentLogical(kind: DossierKind, snapshot: ResearchDossierSnapshot, membership: ResearchDossierMembership): string {
    if (!this.documentRef) return "";
    try {
      if (kind === "context") return contextDossierDraft(this.documentRef, snapshot, membership).logicalFingerprint;
      if (kind === "fundamental") return fundamentalDossierDraft(this.documentRef, snapshot, membership).logicalFingerprint;
      if (kind === "completeness") return completenessDossierDraft(snapshot, membership).logicalFingerprint;
      if (kind === "financialRequirement") return financialRequirementDossierDraft(
        this.documentRef, snapshot, membership, this.selectedFinancialSourceIds).logicalFingerprint;
      return valuationDossierDraft(this.documentRef, snapshot, membership).logicalFingerprint;
    } catch { return ""; }
  }

  private ensureCurrent(token: number, membership: ResearchDossierMembership, auth: WebApiAuth, currentAuth: () => WebApiAuth | null): void {
    if (token !== this.generation || membershipKey(membership) !== membershipKey(this.membership) || !sameWebApiAuth(auth, currentAuth())) {
      throw new Error("Membership or authorization changed during the operation.");
    }
  }

  private openDeepResearch(): void {
    this.element("deep-research-console")?.scrollIntoView({ block: "start" });
    const refresh = this.element("deep-research-refresh");
    if (refresh instanceof HTMLButtonElement && !refresh.disabled) refresh.click();
  }
  private clearFinancialRequirementConfirmation(): void {
    const input = this.element("research-financial-requirement-confirm");
    if (input instanceof HTMLInputElement) input.checked = false;
  }
  private requireMembership(): ResearchDossierMembership { if (!this.membership) throw new Error("An exact non-archived membership is required."); return { ...this.membership }; }
  private requireReadAuth(): WebApiAuth { const value = this.dependencies.readAuth(); if (!value) throw new Error("Read authorization is required."); return value; }
  private requireWriteAuth(): WebApiAuth { const value = this.dependencies.writeAuth(); if (!value) throw new Error("Research-write authorization is required."); return value; }
  private render(): void { if (this.documentRef) renderResearchDossier(this.documentRef, {
    membership: this.membership, snapshot: this.snapshot, message: this.message,
    busy: Boolean(this.busy), selectedFinancialSourceIds: this.selectedFinancialSourceIds
  }); }
  private element(id: string): HTMLElement | null { return this.documentRef?.getElementById(id) ?? null; }
}

function membershipKey(value: ResearchDossierMembership | null): string | null { return value ? `${value.id}:v${value.version}:${value.state}:${value.symbol}` : null; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
