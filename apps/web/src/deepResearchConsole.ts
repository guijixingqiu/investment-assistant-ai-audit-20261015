import { deepResearchPackBinding } from "../../../packages/contracts/src/limitedResearch.js";
import {
  deepResearchProviderAuthorizationFingerprintInput,
  type DeepResearchTaskIntent
} from "../../../packages/contracts/src/deepResearchSnapshot.js";
import {
  FROZEN_RESEARCH_SOURCE_GAPS, validateCreateDeepResearchReportRequest,
  validateCreateResearchMaterialRequest,
  validateDeepResearchDecisionData,
  validateDeepResearchReportData,
  validateDeepResearchWorkspaceEnvelope,
  validateResearchEvidencePackData,
  validateResearchMaterialData,

  type CreateDeepResearchReportRequest,
  type CreateResearchMaterialRequest,
  type DeepResearchReportDeletionData,
  type DeepResearchWorkspaceEnvelope,
  type ResearchEvidencePackData
} from "../../../packages/contracts/src/deepResearch.js";
import { DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION } from "../../../packages/contracts/src/deepResearchSynthesisReport.js";
import {
  defaultDeepResearchTaskIntent,
  validateCancelDeepResearchTaskRequest,
  validateCreateDeepResearchTaskRequest,
  validateDeepResearchTaskActionRequest,
  validateDeepResearchTaskEnvelope,
  type CreateDeepResearchTaskRequest,
  type CancelDeepResearchTaskRequest,
  type DeepResearchTaskActionRequest,
  type DeepResearchTaskData,
  type DeepResearchTaskEnvelope
} from "../../../packages/contracts/src/deepResearchTask.js";
import {
  CLOUD_AI_OUTPUT_USD_PER_MILLION,
  CLOUD_AI_PROVIDER_PRICING_IDENTITY,
  cloudAiEstimatedMaxCostUsd
} from "../../../packages/contracts/src/cloudAiPolicy.js";
import { cloudAiPolicySnapshotSummary, cloudAiSendAuthorizationSummary } from "./displayFormatting.js";
import {
  EXCHANGE_ANNOUNCEMENT_LEAD_SOURCE_TYPE,
  researchEventBindsMaterial,
  validateCreateResearchEventRequest,
  validateResearchAnnouncementEventData,
  type CreateResearchEventRequest,
  type ResearchAnnouncementEventData
} from "../../../packages/contracts/src/researchEvent.js";
import {
  validateCreateGeelySalesMonitorRequest,
  validateGeelySalesMonitorData,
  type CreateGeelySalesMonitorRequest,
  type GeelySalesMonitorData
} from "../../../packages/contracts/src/geelySalesMonitor.js";
import {
  validateCreateGclPvPriceMonitorRequest,
  validateGclPvPriceMonitorData,
  type CreateGclPvPriceMonitorRequest,
  type GclPvPriceMonitorData
} from "../../../packages/contracts/src/gclPvPriceMonitor.js";
import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import {
  researchCompletenessAllowsFormalization,
  validateResearchCompletenessEnvelope,
  type ResearchCompletenessEnvelope
} from "../../../packages/contracts/src/researchCompleteness.js";
import {
  CLOUD_AI_PROVIDER_POLICY_VERSION, cloudAiPolicyReadbackMatches,
  validateCloudAiPolicyEnvelope,
  type CloudAiPolicyDecisionRequest,
  type CloudAiPolicyEnvelope
} from "../../../packages/contracts/src/cloudAiPolicy.js";
import { validateResearchWriteEnvelopeBase } from "../../../packages/contracts/src/research.js";
import type { PortfolioDecisionContextEnvelope } from "../../../packages/contracts/src/portfolioDecisionContextBrowser.js";
import {
  buildTodayResearchItems,
  type TodayResearchEnvelope,
  validateTodayResearchEnvelope
} from "../../../packages/contracts/src/todayResearch.js";
import type { TodaySourceIssueCode } from "../../../packages/contracts/src/todayResearchQualityValidation.js";
import type { ResearchReportDecisionBinding } from "../../../packages/contracts/src/researchReportDecision.js";
import { sameWebApiAuth, type WebApiAuth } from "./apiClient.js";
import { browserLocalStorage } from "./browserStorage.js";
import { resetControlsToDefaults } from "./domRender.js";
import { renderDeepResearchReportSummary } from "./deepResearchReportSummary.js";
import { readWebFreezeBinding } from "./deepResearchFreezeBinding.js";
import {
  appendGclContextRow, appendGclPriceRow, appendGeelyObservationRow,
  currentHoldingEventMatchesSource, currentHoldingEventSource, eventMaterialEligible,
  gclContextObservations, gclContextRowValues,
  gclPriceObservations, gclPriceRowValues,
  geelyObservationRowValues,
  geelySalesObservations,
  gclMonitorLines,
  input, holdingEventRequiresToday,
  materialFields,
  optional,
  required,
  resetGclRows,
  resetGeelyObservationRows,
  syncGclEventOptions,
  syncGeelyEventOptions,
  todayHoldingEventMatches,
  todayMonitorBindingsMatchWorkspace,
  type CurrentHoldingEventSource
} from "./deepResearchConsoleSupport.js";
export { gclContextObservations, gclPriceObservations, geelySalesObservations };
export interface DeepResearchConsoleSource {
  sourceKey: string;
  membershipId: string;
  membershipVersion: number;
  market: "HK";
  code: string;
  symbol: string;
  actorId: string;
  portfolio?: PortfolioDecisionContextEnvelope | null;
}
interface DeepResearchTaskReference {
  schemaVersion: "2026-08-09.web-deep-research-task-reference.v1";
  actorId: string;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  evidencePackId: string;
  evidencePackFingerprint: string;
  taskId: string;
  requestFingerprint: string;
}
const MAX_UNRESOLVED_WRITE_RETRIES = 64;
const TASK_REFERENCE_KEYS = [
  "actorId", "evidencePackFingerprint", "evidencePackId", "membershipId", "membershipVersion",
  "requestFingerprint", "schemaVersion", "symbol", "taskId"
];
export class DeepResearchConsole {
  private sourceKey = "";
  private sourceIdentity = "";
  private workspace: DeepResearchWorkspaceEnvelope | null = null;
  private today: TodayResearchEnvelope | null = null;
  private task: DeepResearchTaskData | null = null;
  private taskReference: DeepResearchTaskReference | null = null;
  private taskPack: ResearchEvidencePackData | null = null;
  private actorId = "";
  private cloudAiPolicy: CloudAiPolicyEnvelope | null = null; private cloudAiPolicyReadAuth: WebApiAuth | null = null;
  private message = "Load an exact source-bound candidate before using deep research.";
  private workspaceReadState: "empty" | "fresh" | "stale" = "empty";
  private busy = false;
  private generation = 0;
  private taskAutoRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private taskAutoRefreshRemaining = 0;
  private taskAutoRefreshPaused = false;
  private taskLastReadAt: string | null = null;
  private readonly retries = new Map<string, string>();
  constructor(private readonly dependencies: {
    currentSource: () => DeepResearchConsoleSource | null;
    readAuth: () => WebApiAuth | null;
    writeAuth: () => WebApiAuth | null;
    onWorkspaceChanged?: (workspace: DeepResearchWorkspaceEnvelope | null) => void;
    onReportConfirmed?: () => void | Promise<void>;
    readFreezeBinding?: typeof readWebFreezeBinding;
    fetcher?: typeof fetch;
  }) {}
  mount(documentRef: Document = document): void {
    documentRef.getElementById("deep-research-refresh")?.addEventListener("click", () => void this.load(documentRef));
    documentRef.getElementById("deep-material-save")?.addEventListener("click", () => void this.saveMaterial(documentRef));
    documentRef.getElementById("deep-event-save")?.addEventListener("click", () => void this.saveEvent(documentRef));
    documentRef.getElementById("deep-event-scope")?.addEventListener("change", () => this.render(documentRef));
    documentRef.getElementById("deep-geely-add-target")?.addEventListener("click", () => this.addGeelyObservation(documentRef, "target"));
    documentRef.getElementById("deep-geely-add-peer")?.addEventListener("click", () => this.addGeelyObservation(documentRef, "peer"));
    documentRef.getElementById("deep-geely-observations")?.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      const button = typeof target?.closest === "function" ? target.closest<HTMLButtonElement>("button[data-geely-action]") : null;
      const row = button?.closest<HTMLElement>("[data-geely-observation]");
      if (!button || !row) return;
      if (button.dataset.geelyAction === "remove") row.remove();
      if (button.dataset.geelyAction === "duplicate") appendGeelyObservationRow(documentRef, geelyObservationRowValues(row));
    });
    documentRef.getElementById("deep-geely-save")?.addEventListener("click", () => void this.saveGeelySalesMonitor(documentRef));
    documentRef.getElementById("deep-gcl-add-price")?.addEventListener("click", () => this.addGclPriceObservation(documentRef));
    documentRef.getElementById("deep-gcl-add-context")?.addEventListener("click", () => this.addGclContextObservation(documentRef));
    for (const id of ["deep-gcl-prices", "deep-gcl-contexts"]) documentRef.getElementById(id)?.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      const button = typeof target?.closest === "function" ? target.closest<HTMLButtonElement>("button[data-gcl-action]") : null;
      const row = button?.closest<HTMLElement>("[data-gcl-price], [data-gcl-context]");
      if (!button || !row) return;
      if (button.dataset.gclAction === "remove") row.remove();
      if (button.dataset.gclAction === "duplicate") {
        if (row.hasAttribute("data-gcl-price")) appendGclPriceRow(documentRef, gclPriceRowValues(row));
        else appendGclContextRow(documentRef, gclContextRowValues(row));
      }
    });
    documentRef.getElementById("deep-gcl-save")?.addEventListener("click", () => void this.saveGclPvPriceMonitor(documentRef));
    documentRef.getElementById("deep-pack-limited")?.addEventListener("click", () => void this.freezePack(documentRef, true));
    documentRef.getElementById("deep-pack-freeze")?.addEventListener("click", () => void this.freezePack(documentRef));
    documentRef.getElementById("deep-task-start")?.addEventListener("click", () => void this.startTask(documentRef));
    for (const eventName of ["input", "change"]) {
      documentRef.getElementById("deep-task-intent")?.addEventListener(eventName, () => {
        clearProviderConfirmation(documentRef);
        renderDeepResearchBudgetPreview(documentRef);
      });
    }
    documentRef.getElementById("deep-task-refresh")?.addEventListener("click", () => void this.refreshTask(documentRef));
    documentRef.getElementById("deep-task-retry")?.addEventListener("click", () => void this.retryTask(documentRef));
    documentRef.getElementById("deep-task-absorb")?.addEventListener("click", () => void this.absorbTask(documentRef));
    documentRef.getElementById("deep-task-defer")?.addEventListener("click", () => this.deferTask(documentRef));
    documentRef.getElementById("deep-task-cancel")?.addEventListener("click", () => void this.cancelTask("user_canceled", documentRef));
    documentRef.getElementById("deep-task-reject")?.addEventListener("click", () => void this.cancelTask("user_rejected", documentRef));
    documentRef.getElementById("deep-cloud-ai-enable")?.addEventListener("click", () => void this.decideCloudAiPolicy("enable", documentRef));
    documentRef.getElementById("deep-cloud-ai-no-backup")?.addEventListener("change", () => this.render(documentRef));
    documentRef.getElementById("deep-cloud-ai-disable")?.addEventListener("click", () => void this.decideCloudAiPolicy("disable", documentRef));
    documentRef.getElementById("deep-cloud-ai-delete")?.addEventListener("click", () => void this.decideCloudAiPolicy("request_deletion", documentRef));
    documentRef.getElementById("deep-report-save")?.addEventListener("click", () => void this.saveReport(documentRef));
    documentRef.getElementById("deep-report-confirm")?.addEventListener("click", () => void this.decide("confirmed", documentRef));
    documentRef.getElementById("deep-report-reject")?.addEventListener("click", () => void this.decide("rejected", documentRef));
    this.syncSource(documentRef);
    if (!documentRef.getElementById("deep-geely-observations")?.querySelector("[data-geely-observation]")) this.addGeelyObservation(documentRef, "target");
    if (documentRef.getElementById("deep-gcl-prices") && !documentRef.querySelector("#deep-gcl-prices [data-gcl-price]")) this.addGclPriceObservation(documentRef);
  }
  async loadFormalDecisionReport(binding: ResearchReportDecisionBinding, documentRef: Document = document): Promise<void> {
    const source = this.source();
    if (!source || source.membershipId !== binding.membershipId || source.membershipVersion !== binding.membershipVersion
      || source.symbol !== binding.symbol) throw new Error("Formal decision report no longer matches the current membership.");
    await this.load(documentRef);
    if (this.workspaceReadState !== "fresh" || !workspaceMatchesFormalDecisionBinding(this.workspace, binding)) {
      this.hideWorkspaceFacts();
      this.render(documentRef);
      throw new Error("Fresh Deep Research did not preserve the exact confirmed report and evidence pack.");
    }
    this.message = `Confirmed report ${binding.reportId} v${binding.reportVersion} was fresh-read for the formal decision.`;
    this.render(documentRef);
    documentRef.getElementById("deep-research-report-summary")?.scrollIntoView({ block: "start" });
  }
  invalidateAuthorizationRetries(message = "Runtime authorization changed; Deep Research facts are hidden until explicitly reloaded.", documentRef: Document = document): void {
    this.retries.clear(); this.task = null; this.taskReference = null; this.taskPack = null; this.cloudAiPolicy = null; this.cloudAiPolicyReadAuth = null; this.actorId = ""; clearNoBackupProviderConfirmation(documentRef); this.invalidateWorkspace(message, documentRef);
  }
  invalidateWorkspace(message: string, documentRef: Document = document): void {
    this.generation += 1; this.busy = false; this.stopTaskAutoRefresh(); this.taskAutoRefreshPaused = Boolean(this.task && ["pending", "running"].includes(this.task.status)); clearProviderConfirmation(documentRef); this.hideWorkspaceFacts(); this.message = message; this.render(documentRef);
  }
  syncSource(documentRef: Document = document): void {
    const source = this.dependencies.currentSource();
    const nextKey = source?.sourceKey ?? "";
    const nextIdentity = source ? sourceIdentityKey(source) : "";
    if (nextKey !== this.sourceKey || nextIdentity !== this.sourceIdentity) {
      const sameIdentity = Boolean(nextIdentity && nextIdentity === this.sourceIdentity);
      this.generation += 1;
      this.busy = false;
      this.stopTaskAutoRefresh();
      this.sourceKey = nextKey;
      this.sourceIdentity = nextIdentity;
      this.hideWorkspaceFacts(); clearNoBackupProviderConfirmation(documentRef);
      if (!sameIdentity) {
        this.retries.clear(); this.task = null; this.taskReference = null; this.taskPack = null; this.taskLastReadAt = null; this.taskAutoRefreshPaused = false; this.cloudAiPolicy = null; this.cloudAiPolicyReadAuth = null;
        resetControlsToDefaults(
          documentRef,
          "#deep-research-console input, #deep-research-console select, #deep-research-console textarea"
        );
        resetGeelyObservationRows(documentRef);
        resetGclRows(documentRef);
      }
      this.taskReference = source ? this.taskReference ?? loadTaskReference(source) : null;
      this.actorId = source?.actorId ?? "";
      this.message = this.taskReference
        ? `Saved Deep Research task #${this.taskReference.taskId} is available. Load the workspace, then explicitly refresh it.`
        : source ? `${source.symbol} deep research has not been loaded; stock-bound draft input was cleared.` : "Load an exact source-bound candidate before using deep research.";
    }
    this.render(documentRef);
  }
  private async load(documentRef: Document): Promise<void> {
    const source = this.source();
    const auth = this.dependencies.readAuth();
    if (!source || !auth) return this.fail("Current source-bound membership and read authorization are required.", documentRef);
    this.taskReference ??= loadTaskReference(source);
    const generation = this.generation;
    await this.run("Loading deep-research workspace.", documentRef, async () => {
      const [value, todayValue, policyValue] = await Promise.all([
        this.fetchJson(`/api/mobile/research/candidate-memberships/${source.membershipId}/deep-research`, "GET", auth),
        this.fetchJson(`/api/mobile/research/candidate-memberships/${source.membershipId}/today`, "GET", auth, undefined, true),
        this.fetchJson("/api/mobile/research/cloud-ai-policy", "GET", auth).catch(() => null)
      ]);
      if (generation !== this.generation || !sameWebApiAuth(auth, this.dependencies.readAuth()) || source.sourceKey !== this.sourceKey) {
        throw new Error("Source or authorization changed while loading Deep Research; the old response was discarded.");
      }
      const envelope = this.acceptWorkspace(value, source);
      const today = this.acceptToday(todayValue, source, envelope.requestedActorId);
      try {
        this.cloudAiPolicy = policyValue === null ? null : this.acceptCloudAiPolicy(policyValue, envelope.requestedActorId); this.cloudAiPolicyReadAuth = this.cloudAiPolicy ? { ...auth } : null; clearNoBackupProviderConfirmation(documentRef);
      } catch {
        this.cloudAiPolicy = null; this.cloudAiPolicyReadAuth = null; clearNoBackupProviderConfirmation(documentRef);
      }
      this.installWorkspace(envelope, today, documentRef);
    }, true);
  }
  private async saveMaterial(documentRef: Document): Promise<void> {
    const source = this.source();
    const auth = this.dependencies.writeAuth();
    if (!source || !auth) return this.fail("Current source-bound membership and research-write authorization are required.", documentRef);
    if (taskBlocksResearchMutation(this.task, this.taskReference)) {
      return this.fail("Resolve or refresh the saved Deep Research task before changing its evidence.", documentRef);
    }
    let fields: Omit<CreateResearchMaterialRequest, "membershipId" | "membershipVersion" | "idempotencyKey">;
    try {
      fields = materialFields(documentRef);
    } catch (error) {
      return this.fail(message(error), documentRef);
    }
    const draft = { membershipId: source.membershipId, membershipVersion: source.membershipVersion, ...fields };
    const validation = validateCreateResearchMaterialRequest({ ...draft, idempotencyKey: "validation-only" });
    if (!validation.ok) return this.fail(validation.errors.join("; "), documentRef);
    await this.run("Saving traceable text material.", documentRef, async () => {
      this.hideWorkspaceFacts();
      await this.write("material", `/api/mobile/research/profiles/${source.market}/${source.code}/materials`, draft, auth, validateResearchMaterialData, "Material");
      await this.reloadWorkspace(source, documentRef);
    });
  }
  private async saveEvent(documentRef: Document): Promise<void> {
    const source = this.source();
    const auth = this.dependencies.writeAuth();
    let materialId: string;
    let eventKind: CreateResearchEventRequest["eventKind"];
    const coverageScope = selectedEventScope(documentRef);
    try {
      materialId = required(documentRef, "deep-event-material-id");
      eventKind = input(documentRef, "deep-event-kind").value as CreateResearchEventRequest["eventKind"];
    } catch (error) {
      return this.fail(message(error), documentRef);
    }
    const material = this.workspace?.data?.materials.find((item) => item.id === materialId) ?? null;
    const holdingSource = coverageScope === "current_holding" ? currentHoldingEventSource(source?.portfolio, source?.symbol ?? "") : null;
    if (!source || !auth || !material || !eventMaterialEligible(material, coverageScope) || coverageScope === "current_holding" && !holdingSource) {
      return this.fail(coverageScope === "current_holding"
        ? "Fresh-read an available Pingan position and one HTTPS owner_verified_holding_logic material before saving holding logic."
        : "Fresh-read one current, verified, authorized research-stock material with a key variable before binding an event.", documentRef);
    }
    if (taskBlocksResearchMutation(this.task, this.taskReference)) {
      return this.fail("Resolve or refresh the saved Deep Research task before changing its evidence events.", documentRef);
    }
    const path = `/api/mobile/research/candidate-memberships/${source.membershipId}/research-events`;
    const draft = { membershipVersion: source.membershipVersion, materialId, eventKind, coverageScope };
    const validation = validateCreateResearchEventRequest({ ...draft, idempotencyKey: "validation-only" });
    if (!validation.ok) return this.fail(validation.errors.join("; "), documentRef);
    await this.run(coverageScope === "current_holding" ? "Saving current holding logic against the exact Pingan snapshot." : "Binding the verified material as a research-stock event.", documentRef, async () => {
      this.hideWorkspaceFacts();
      const event = await this.write("event", path, draft, auth, (value) => {
        const checked = validateResearchAnnouncementEventData(value);
        if (!checked.ok) return checked;
        const result = value as ResearchAnnouncementEventData;
        return result.membershipId === source.membershipId && result.membershipVersion === source.membershipVersion
          && result.symbol === source.symbol && result.eventKind === eventKind && result.coverageScope === coverageScope
          && researchEventBindsMaterial(result, material)
          && (coverageScope === "research_stock" ? result.holdingBinding === null : currentHoldingEventMatchesSource(result, holdingSource))
          ? { ok: true } : { ok: false, errors: ["research event no longer matches the selected membership, material, kind, or scope"] };
      }, "Research-event", true, holdingSource) as ResearchAnnouncementEventData;
      await this.reloadWorkspace(source, documentRef);
      if (!this.workspace?.data?.events.some((item) => item.id === event.id && canonicalJson(item) === canonicalJson(event))) {
        this.hideWorkspaceFacts();
        throw new Error("Fresh workspace did not contain the exact saved research event.");
      }
      if (coverageScope === "current_holding" && (this.today?.status !== "available"
        || holdingEventRequiresToday(event) && !todayHoldingEventMatches(this.today, event))) {
        this.hideWorkspaceFacts();
        throw new Error("Fresh Today readback did not confirm the same current-holding event and Pingan snapshot.");
      }
      this.retries.delete(canonicalJson(holdingSource ? { kind: "event", path, body: draft, retryScope: holdingSource } : { kind: "event", path, body: draft }));
      this.message = coverageScope === "current_holding"
        ? holdingEventRequiresToday(event)
          ? `Holding-logic event ${event.id} v${event.eventVersion} was fresh-read with the exact Pingan snapshot and Today item. No portfolio fact was changed.`
          : `Holding-logic event ${event.id} v${event.eventVersion} was fresh-read with the exact Pingan snapshot. It did not meet the Today alert threshold; no portfolio fact was changed.`
        : `Research event ${event.id} v${event.eventVersion} was fresh-read. Freeze evidence and start Deep Research only through separate explicit actions.`;
    });
  }
  private async saveGeelySalesMonitor(documentRef: Document): Promise<void> {
    const source = this.source();
    const auth = this.dependencies.writeAuth();
    let period: string;
    let observations: CreateGeelySalesMonitorRequest["observations"];
    try {
      period = required(documentRef, "deep-geely-period");
      observations = geelySalesObservations(documentRef);
    } catch (error) {
      return this.fail(message(error), documentRef);
    }
    if (!source || source.symbol !== "HK.00175" || !auth) {
      return this.fail("Select the tracked HK.00175 research membership before saving a Geely sales monitor.", documentRef);
    }
    if (taskBlocksResearchMutation(this.task, this.taskReference)) {
      return this.fail("Resolve or refresh the saved Deep Research task before changing its operating monitor.", documentRef);
    }
    const path = `/api/mobile/research/candidate-memberships/${source.membershipId}/geely-sales-monitors`;
    const draft = { membershipVersion: source.membershipVersion, period, observations };
    const validation = validateCreateGeelySalesMonitorRequest({ ...draft, idempotencyKey: "validation-only" });
    if (!validation.ok) return this.fail(validation.errors.join("; "), documentRef);
    await this.run("Saving source-bound Geely sales observations.", documentRef, async () => {
      this.hideWorkspaceFacts();
      const monitor = await this.write("geely-sales", path, draft, auth, (value) => {
        const checked = validateGeelySalesMonitorData(value);
        if (!checked.ok) return checked;
        const result = value as GeelySalesMonitorData;
        return result.membershipId === source.membershipId && result.membershipVersion === source.membershipVersion
          && result.symbol === source.symbol && result.period === period
          ? { ok: true } : { ok: false, errors: ["Geely sales monitor no longer matches the selected membership or period"] };
      }, "Geely-sales monitor", true) as GeelySalesMonitorData;
      await this.reloadWorkspace(source, documentRef);
      if (canonicalJson(this.workspace?.data?.latestGeelySalesMonitor) !== canonicalJson(monitor)) {
        this.hideWorkspaceFacts();
        throw new Error("Fresh workspace did not contain the exact saved Geely sales monitor.");
      }
      const geelyRefs = this.today?.items.flatMap((item) => item.bindings.monitorRef?.kind === "geely_sales" ? [item.bindings.monitorRef] : []) ?? [];
      if (this.today?.status !== "available" || geelyRefs.some((ref) => ref.id !== monitor.id
        || ref.runVersion !== monitor.runVersion || ref.runFingerprint !== monitor.runFingerprint)) {
        this.hideWorkspaceFacts();
        throw new Error("Fresh Today readback did not preserve the exact Geely sales monitor identity.");
      }
      this.retries.delete(canonicalJson({ kind: "geely-sales", path, body: draft }));
      this.message = `Geely sales monitor ${monitor.id} v${monitor.runVersion} was fresh-read as ${monitor.assessment.status}. Re-freeze and run Deep Research only through separate explicit actions.`;
    });
  }
  private addGeelyObservation(documentRef: Document, role: "target" | "peer"): void {
    const periodField = input(documentRef, "deep-geely-period");
    const now = new Date();
    if (!periodField.value) periodField.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const eventId = role === "target"
      ? this.workspace?.data?.events.find((event) => event.coverageScope === "research_stock" && event.keyVariable === "new_energy_vehicle_sales")?.id ?? ""
      : "";
    appendGeelyObservationRow(documentRef, role === "target" ? {
      eventId, entityId: "geely-auto", entityName: "吉利汽车", entityRole: "target", entityLevel: "issuer",
      issuerId: "geely-auto", periodKind: "month", period: periodField.value, metric: "sales_volume",
      propulsion: "all", geography: "global", channel: "wholesale",
      definitionKey: "manufacturer_wholesale_global_v1", value: ""
    } : {
      eventId: "", entityId: "", entityName: "", entityRole: "peer", entityLevel: "issuer", issuerId: "",
      periodKind: "month", period: periodField.value, metric: "sales_volume", propulsion: "new_energy",
      geography: "global", channel: "wholesale", definitionKey: "", value: ""
    });
  }
  private async saveGclPvPriceMonitor(documentRef: Document): Promise<void> {
    const source = this.source();
    const auth = this.dependencies.writeAuth();
    const holdingSource = currentHoldingEventSource(source?.portfolio, source?.symbol ?? "");
    let period: string;
    let referencePeriod: string;
    let priceObservations: CreateGclPvPriceMonitorRequest["priceObservations"];
    let contextObservations: CreateGclPvPriceMonitorRequest["contextObservations"];
    try {
      period = required(documentRef, "deep-gcl-period");
      referencePeriod = required(documentRef, "deep-gcl-reference-period");
      priceObservations = gclPriceObservations(documentRef);
      contextObservations = gclContextObservations(documentRef);
    } catch (error) {
      return this.fail(message(error), documentRef);
    }
    if (!source || source.symbol !== "HK.03800" || !auth || !holdingSource
      || !gclInputsBindCurrentHoldingEvents(this.workspace, priceObservations, contextObservations, holdingSource)) {
      return this.fail("Fresh-read the tracked HK.03800 membership, exact Pingan holding, and matching current-holding price events before saving the GCL monitor.", documentRef);
    }
    const path = `/api/mobile/research/candidate-memberships/${source.membershipId}/gcl-pv-price-monitors`;
    const draft = { membershipVersion: source.membershipVersion, period, referencePeriod, priceObservations, contextObservations };
    const validation = validateCreateGclPvPriceMonitorRequest({ ...draft, idempotencyKey: "validation-only" });
    if (!validation.ok) return this.fail(validation.errors.join("; "), documentRef);
    await this.run("Saving source-bound GCL photovoltaic price observations.", documentRef, async () => {
      this.hideWorkspaceFacts();
      const monitor = await this.write("gcl-pv-price", path, draft, auth, (value) => {
        const checked = validateGclPvPriceMonitorData(value);
        if (!checked.ok) return checked;
        const result = value as GclPvPriceMonitorData;
        return result.membershipId === source.membershipId && result.membershipVersion === source.membershipVersion
          && result.symbol === source.symbol && result.period === period && result.referencePeriod === referencePeriod
          && gclMonitorMatchesRequest(result, draft) && gclMonitorMatchesCurrentHolding(result, holdingSource)
          ? { ok: true } : { ok: false, errors: ["GCL monitor no longer matches the selected membership or periods"] };
      }, "GCL photovoltaic monitor", true, holdingSource) as GclPvPriceMonitorData;
      await this.reloadWorkspace(source, documentRef);
      if (canonicalJson(this.workspace?.data?.latestGclPvPriceMonitor) !== canonicalJson(monitor)) {
        this.hideWorkspaceFacts();
        throw new Error("Fresh workspace did not contain the exact saved GCL photovoltaic monitor.");
      }
      const refs = this.today?.items.flatMap((item) => item.bindings.monitorRef?.kind === "gcl_pv_price" ? [item.bindings.monitorRef] : []) ?? [];
      const needsToday = this.workspace?.data && this.today
        ? buildTodayResearchItems(this.workspace.data, new Date(this.today.generatedAt)).items.some((item) => item.bindings.monitorRef?.kind === "gcl_pv_price") : true;
      if (this.today?.status !== "available" || refs.some((ref) => ref.id !== monitor.id
        || ref.runVersion !== monitor.runVersion || ref.runFingerprint !== monitor.runFingerprint)
        || refs.length !== (needsToday ? 1 : 0)) {
        this.hideWorkspaceFacts();
        throw new Error("Fresh Today readback did not preserve the exact GCL monitor and Pingan holding identity.");
      }
      this.retries.delete(canonicalJson({ kind: "gcl-pv-price", path, body: draft, retryScope: holdingSource }));
      this.message = `GCL photovoltaic monitor ${monitor.id} v${monitor.runVersion} was fresh-read as ${monitor.assessment.status}. No portfolio fact, report, decision, or trade was changed.`;
    });
  }
  private addGclPriceObservation(documentRef: Document): void {
    const period = input(documentRef, "deep-gcl-period");
    const reference = input(documentRef, "deep-gcl-reference-period");
    if (!period.value) period.value = new Date().toISOString().slice(0, 10);
    if (!reference.value) reference.value = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const eventId = this.workspace?.data?.events.find((event) => event.coverageScope === "current_holding" && event.keyVariable === "polysilicon_price")?.id ?? "";
    appendGclPriceRow(documentRef, {
      eventId, stage: "polysilicon", period: period.value, productSpecification: "", unit: "CNY_per_watt", value: "",
      conversionFactorToCnyPerWatt: "1", normalizationBasisKey: "", normalizationRule: "", definitionKey: ""
    });
  }
  private addGclContextObservation(documentRef: Document): void {
    const period = input(documentRef, "deep-gcl-period");
    if (!period.value) period.value = new Date().toISOString().slice(0, 10);
    const eventId = this.workspace?.data?.events.find((event) => event.coverageScope === "current_holding" && event.keyVariable === "inventory")?.id ?? "";
    appendGclContextRow(documentRef, {
      eventId, metric: "inventory", period: period.value, productSpecification: "", unit: "metric_tonnes", currency: "", value: "", definitionKey: ""
    });
  }
  private async freezePack(documentRef: Document, limited = false): Promise<void> {
    const source = this.source();
    const readAuth = this.dependencies.readAuth();
    const writeAuth = this.dependencies.writeAuth();
    if (!source || !readAuth || !writeAuth || evidenceConflictBlocksFreeze(this.workspace)) {
      return this.fail("A fresh conflict-free workspace, current source, and research-write authorization are required.", documentRef);
    }
    if (taskBlocksResearchMutation(this.task, this.taskReference)) {
      return this.fail("Resolve or refresh the saved task before freezing another conflict-free evidence pack.", documentRef);
    }
    await this.run("Freezing verified, authorized, fresh material.", documentRef, async () => {
      const binding = limited ? { researchMode: "limited", membershipVersion: source.membershipVersion }
        : await (this.dependencies.readFreezeBinding ?? readWebFreezeBinding)(source, readAuth, this.dependencies.fetcher);
      if (!sameSourceContext(this.source(), source) || !sameWebApiAuth(readAuth, this.dependencies.readAuth())
        || !sameWebApiAuth(writeAuth, this.dependencies.writeAuth())) {
        throw new Error("Source or authorization changed while freeze evidence was being fresh-read.");
      }
      this.hideWorkspaceFacts();
      this.render(documentRef);
      const path = `/api/mobile/research/candidate-memberships/${source.membershipId}/evidence-packs`; const pack = await this.write("pack", path, binding, writeAuth, validateResearchEvidencePackData, "Evidence-pack", true) as ResearchEvidencePackData;
      await this.reloadWorkspace(source, documentRef); if (canonicalJson(this.workspace?.data?.latestPack) !== canonicalJson(pack)) { this.hideWorkspaceFacts(); throw new Error("Fresh workspace did not contain the exact frozen evidence pack."); }
      this.retries.delete(canonicalJson({ kind: "pack", path, body: binding })); this.message = `Evidence pack ${pack.id} v${pack.version} was fresh-read with its exact fingerprint.`;
    });
  }
  private async saveReport(documentRef: Document): Promise<void> {
    const source = this.source();
    const auth = this.dependencies.writeAuth();
    const pack = this.workspace?.data?.latestPack?.currentness.status === "current" ? this.workspace.data.latestPack : null;
    if (!source || !auth || !pack) return this.fail("A current frozen evidence pack and research-write authorization are required.", documentRef);
    if (taskBlocksResearchMutation(this.task, this.taskReference)) {
      return this.fail("Resolve or refresh the saved task before writing another report version.", documentRef);
    }
    let payload: object;
    try {
      payload = JSON.parse(input(documentRef, "deep-report-payload").value) as object;
    } catch {
      return this.fail("Deep research payload must be valid JSON.", documentRef);
    }
    const draft = { ...payload, membershipVersion: source.membershipVersion, evidencePackId: pack.id };
    const validation = validateCreateDeepResearchReportRequest({ ...draft, idempotencyKey: "validation-only" });
    if (!validation.ok) return this.fail(validation.errors.join("; "), documentRef);
    await this.run("Saving an evidence-bound deep-research version.", documentRef, async () => {
      this.hideWorkspaceFacts();
      await this.write("report", `/api/mobile/research/candidate-memberships/${source.membershipId}/deep-research-reports`, draft, auth, validateDeepResearchReportData, "Deep-research");
      await this.reloadWorkspace(source, documentRef);
    });
  }
  private async decide(decision: "confirmed" | "rejected", documentRef: Document): Promise<void> {
    const source = this.source();
    const auth = this.dependencies.writeAuth();
    const readAuth = this.dependencies.readAuth();
    const report = this.workspace?.data?.latestReport?.currentness.status === "current" ? this.workspace.data.latestReport : null;
    if (!source || !auth || decision === "confirmed" && !readAuth || !report || taskBlocksReportDecision(this.workspace, this.task, this.taskReference)) {
      return this.fail("Fresh-read the exact current task and report before recording a report decision.", documentRef);
    }
    const generation = this.generation;
    const actorId = this.actorId;
    await this.run(`Recording user decision: ${decision}.`, documentRef, async () => {
      if (decision === "confirmed") {
        let completeness: unknown;
        try {
          completeness = await this.fetchJson(
            `/api/mobile/research/candidate-memberships/${source.membershipId}/completeness`, "GET", readAuth!
          );
        } catch (error) {
          throw new Error(
            `Fresh research coverage is unavailable; record current coverage before confirming the report. ${message(error)}`,
            { cause: error }
          );
        }
        if (generation !== this.generation || this.actorId !== actorId
          || !sameSourceContext(this.source(), source) || !sameWebApiAuth(readAuth!, this.dependencies.readAuth())
          || !webResearchCompletenessAllowsReportConfirmation(completeness, source, actorId)) {
          throw new Error("Fresh research coverage is missing, stale, below threshold, or source-mismatched; open Research coverage before confirming the report.");
        }
      }
      this.hideWorkspaceFacts();
      await this.write("decision", `/api/mobile/research/candidate-memberships/${source.membershipId}/deep-research-reports/${report.id}/decisions`, {
        membershipVersion: source.membershipVersion,
        decision,
        note: optional(documentRef, "deep-report-decision-note")
      }, auth, validateDeepResearchDecisionData, "User-decision");
      await this.reloadWorkspace(source, documentRef);
      if (decision === "confirmed") await this.dependencies.onReportConfirmed?.();
    });
  }
  private async startTask(documentRef: Document): Promise<void> {
    const source = this.source();
    const auth = this.dependencies.writeAuth();
    const pack = currentPack(this.workspace);
    const actorId = this.actorId;
    const replacesSuperseded = taskCanRestartOnCurrentPack(this.workspace, this.task, this.taskReference, this.taskPack);
    if (!source || !auth || !pack || !actorId || this.cloudAiPolicy?.state?.status !== "enabled"
      || (this.task || this.taskReference) && !replacesSuperseded) {
      return this.fail("Fresh-read one current evidence pack before explicitly starting Deep Research.", documentRef);
    }
    if (!taskRecoveryStorageAvailable(source)) {
      return this.fail("Browser recovery storage is unavailable; Deep Research was not started because the task could not be resumed safely.", documentRef);
    }
    const providerConfirmed = (documentRef.getElementById("deep-provider-confirm") as HTMLInputElement | null)?.checked === true;
    if (!providerConfirmed) return this.fail("Confirm the exact DeepSeek send list before starting Deep Research.", documentRef);
    if (replacesSuperseded) { this.forgetTask(source); this.task = null; this.taskPack = null; }
    const generation = this.generation;
    let body: Omit<CreateDeepResearchTaskRequest, "idempotencyKey">;
    try {
      const intent = deepResearchTaskIntentFromControls(
        documentRef,
        pack,
        currentPriorReport(this.workspace)
      );
      intent.providerAuthorization!.ownerConfirmed = true;
      intent.providerAuthorization!.confirmedIntentFingerprint = await providerAuthorizationFingerprint(intent);
      body = {
        membershipVersion: source.membershipVersion,
        evidencePackId: pack.id,
        evidencePackBinding: deepResearchPackBinding(pack),
        intent,
        reportContractVersion: DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION
      };
    } catch (error) {
      return this.fail(message(error), documentRef);
    }
    const validation = validateCreateDeepResearchTaskRequest({ ...body, idempotencyKey: "validation-only" });
    if (!validation.ok) return this.fail(validation.errors.join("; "), documentRef);
    await this.run("Deep Research is starting from the exact frozen evidence pack.", documentRef, async () => {
      this.task = await this.writeTask("start", `/api/mobile/research/candidate-memberships/${source.membershipId}/deep-research-tasks`, body, auth, source, pack, actorId, generation);
      this.taskPack = pack;
      this.taskLastReadAt = new Date().toISOString();
      const saved = this.rememberTask(source, this.task);
      clearProviderConfirmation(documentRef);
      this.message = taskMessage(this.task, saved);
    });
    this.startTaskAutoRefresh(documentRef);
  }
  private async decideCloudAiPolicy(action: CloudAiPolicyDecisionRequest["action"], documentRef: Document): Promise<void> {
    const source = this.source();
    const writeAuth = this.dependencies.writeAuth();
    const readAuth = this.dependencies.readAuth();
    if (!source || !writeAuth || !readAuth || !this.actorId) return this.fail("Fresh actor-bound read and research-write authorization are required.", documentRef);
    const generation = this.generation;
    const noBackup = documentRef.getElementById("deep-cloud-ai-no-backup") as HTMLInputElement | null;
    if (action === "enable" && (noBackup?.checked !== true || this.cloudAiPolicy?.status !== "available" || this.cloudAiPolicy.requestedActorId !== this.actorId || !sameWebApiAuth(this.cloudAiPolicyReadAuth, readAuth))) return this.fail("Fresh-read the current actor policy, then explicitly choose no backup provider before enabling Cloud AI.", documentRef);
    const body = { action, policyVersion: CLOUD_AI_PROVIDER_POLICY_VERSION, backupProvider: "none" as const, ownerConfirmed: true as const };
    const identity = canonicalJson({ kind: "cloud-ai-policy", body, actorId: this.actorId });
    const key = this.retries.get(identity) ?? `web-cloud-ai-${action}-${crypto.randomUUID()}`;
    this.retries.set(identity, key);
    await this.run(action === "enable" ? "Enabling Cloud AI under the displayed policy." : action === "disable" ? "Disabling new Cloud AI calls." : "Recording provider deletion request status.", documentRef, async () => {
      try {
        const posted = this.acceptCloudAiPolicy(await this.fetchJson(
          "/api/mobile/research/cloud-ai-policy/decisions", "POST", writeAuth,
          { ...body, idempotencyKey: key }, false, this.actorId
        ), this.actorId);
        const fresh = this.acceptCloudAiPolicy(await this.fetchJson(
          "/api/mobile/research/cloud-ai-policy", "GET", readAuth
        ), this.actorId);
        if (generation !== this.generation || source.sourceKey !== this.source()?.sourceKey
          || !sameWebApiAuth(writeAuth, this.dependencies.writeAuth())
          || !sameWebApiAuth(readAuth, this.dependencies.readAuth())) {
          throw new Error("Source, actor, or authorization changed during Cloud AI policy readback.");
        }
        if (!cloudAiPolicyReadbackMatches(posted, fresh)) throw new Error("Fresh Cloud AI policy readback did not match the write response.");
        this.cloudAiPolicy = fresh;
        this.retries.delete(identity);
        if (noBackup) noBackup.checked = false;
        clearProviderConfirmation(documentRef);
        this.message = fresh.message;
      } catch (error) {
        if (error instanceof HttpFailure && error.status >= 400 && error.status < 500) this.retries.delete(identity);
        throw error;
      }
    });
  }
  private async refreshTask(documentRef: Document, automatic = false): Promise<void> {
    if (!automatic) this.stopTaskAutoRefresh();
    const source = this.source();
    const auth = this.dependencies.readAuth();
    const expected = this.task;
    const reference = this.taskReference;
    const pack = this.taskPack ?? taskBoundPack(this.workspace, expected, reference);
    const actorId = this.actorId;
    const taskId = expected?.id ?? reference?.taskId;
    const generation = this.generation;
    if (!source || !auth || !pack || !taskId || !actorId) {
      return this.fail("No exact Deep Research task is available to refresh.", documentRef);
    }
    let succeeded = false;
    await this.run(automatic ? "Checking the saved Deep Research task…" : "Refreshing the saved Deep Research task; no duplicate task is being created.", documentRef, async () => {
      const value = await this.fetchJson(`/api/mobile/research/candidate-memberships/${source.membershipId}/deep-research-tasks/${taskId}`, "GET", auth);
      this.assertTaskContext(source, actorId, auth, this.dependencies.readAuth(), generation);
      const refreshed = acceptTask(value, source, pack, actorId, expected ?? undefined);
      if (reference && !taskMatchesReference(refreshed, reference)) throw new Error("Fresh task no longer matches the saved browser recovery identity.");
      this.task = refreshed;
      this.taskLastReadAt = new Date().toISOString();
      this.taskAutoRefreshPaused = false;
      const saved = this.rememberTask(source, refreshed);
      if (refreshed.status === "succeeded") {
        await this.reconcileSucceededTask(source, refreshed, documentRef);
        this.retries.delete(taskAbsorbIdentity(source, refreshed));
        this.message = "Deep Research task and its current report were fresh-read. Report confirmation remains a separate explicit action.";
      } else {
        await this.reloadWorkspace(source, documentRef);
        this.message = taskMessage(refreshed, saved);
      }
      succeeded = true;
    }, true);
    if (!succeeded) {
      if (automatic) {
        this.stopTaskAutoRefresh();
        this.taskAutoRefreshPaused = true;
        this.render(documentRef);
      }
      return;
    }
    if (this.task && ["pending", "running"].includes(this.task.status)) {
      if (automatic) this.scheduleNextTaskAutoRefresh(documentRef);
      else this.startTaskAutoRefresh(documentRef);
    } else {
      this.stopTaskAutoRefresh();
    }
  }
  private async retryTask(documentRef: Document): Promise<void> {
    const source = this.source();
    const auth = this.dependencies.writeAuth();
    const expected = this.task;
    const pack = this.taskPack ?? taskBoundPack(this.workspace, expected, this.taskReference);
    const actorId = this.actorId;
    const generation = this.generation;
    if (!source || !auth || !pack || !packIsCurrent(this.workspace, pack) || !expected || !actorId || !taskRetryable(expected) || !expected.snapshotBinding) {
      return this.fail("Only a saved transient failed task can be explicitly retried.", documentRef);
    }
    const body = taskActionBody(expected);
    const validation = validateDeepResearchTaskActionRequest({ ...body, idempotencyKey: "validation-only" });
    if (!validation.ok) return this.fail(validation.errors.join("; "), documentRef);
    await this.run("Explicitly retrying the same Deep Research task identity.", documentRef, async () => {
      this.task = await this.writeTask("retry", `/api/mobile/research/candidate-memberships/${source.membershipId}/deep-research-tasks/${expected.id}/retry`, body, auth, source, pack, actorId, generation, expected);
      this.taskLastReadAt = new Date().toISOString();
      const saved = this.rememberTask(source, this.task);
      this.message = taskMessage(this.task, saved);
    });
    this.startTaskAutoRefresh(documentRef);
  }
  private deferTask(documentRef: Document): void {
    if (!this.task || !["pending", "running", "ready_to_absorb"].includes(this.task.status)) {
      return this.fail("Only an active saved task can be handled later.", documentRef);
    }
    this.stopTaskAutoRefresh();
    this.taskAutoRefreshPaused = ["pending", "running"].includes(this.task.status);
    this.message = `Deep Research task #${this.task.id} remains saved; refresh the same task later without creating a duplicate.`;
    this.render(documentRef);
  }
  private async cancelTask(reason: CancelDeepResearchTaskRequest["reason"], documentRef: Document): Promise<void> {
    const source = this.source();
    const auth = this.dependencies.writeAuth();
    const task = this.task;
    const pack = this.taskPack ?? taskBoundPack(this.workspace, task, this.taskReference);
    const actorId = this.actorId;
    const generation = this.generation;
    if (!source || !auth || !task || !pack || !actorId
      || reason === "user_canceled" && !["pending", "running"].includes(task.status)
      || reason === "user_rejected" && task.status !== "ready_to_absorb") {
      return this.fail("Only a queued or running task can be canceled, and only a ready result can be rejected.", documentRef);
    }
    this.stopTaskAutoRefresh();
    const body = {
      membershipVersion: source.membershipVersion,
      taskRequestFingerprint: task.requestFingerprint,
      reason
    };
    const validation = validateCancelDeepResearchTaskRequest({ ...body, idempotencyKey: "validation-only" });
    if (!validation.ok) return this.fail(validation.errors.join("; "), documentRef);
    await this.run(reason === "user_rejected" ? "Rejecting the completed synthesis." : "Canceling the saved Deep Research task.", documentRef, async () => {
      this.task = await this.writeTask(
        "cancel",
        `/api/mobile/research/candidate-memberships/${source.membershipId}/deep-research-tasks/${task.id}/cancel`,
        body, auth, source, pack, actorId, generation, task
      );
      this.rememberTask(source, this.task);
      this.message = taskMessage(this.task, true);
    });
  }
  private async absorbTask(documentRef: Document): Promise<void> {
    const source = this.source();
    const writeAuth = this.dependencies.writeAuth();
    const readAuth = this.dependencies.readAuth();
    const expected = this.task;
    const pack = this.taskPack ?? taskBoundPack(this.workspace, expected, this.taskReference);
    const actorId = this.actorId;
    const generation = this.generation;
    if (!source || !writeAuth || !readAuth || !pack || this.workspace !== null && !packIsCurrent(this.workspace, pack) || !expected || !actorId || expected.status !== "ready_to_absorb" || !expected.snapshotBinding) {
      return this.fail("Only a ready-to-absorb task can be explicitly written into the report workspace.", documentRef);
    }
    this.stopTaskAutoRefresh();
    const body = taskActionBody(expected);
    const validation = validateDeepResearchTaskActionRequest({ ...body, idempotencyKey: "validation-only" });
    if (!validation.ok) return this.fail(validation.errors.join("; "), documentRef);
    const absorbPath = `/api/mobile/research/candidate-memberships/${source.membershipId}/deep-research-tasks/${expected.id}/absorb`;
    const absorbIdentity = taskAbsorbIdentity(source, expected);
    await this.run("Explicitly absorbing the completed synthesis, then fresh-reading its report.", documentRef, async () => {
      if (!this.workspace) await this.reloadWorkspace(source, documentRef);
      if (!packIsCurrent(this.workspace, pack)) throw new Error("The task evidence pack is no longer current after fresh readback.");
      this.hideWorkspaceFacts();
      const absorbed = await this.writeTask("absorb", absorbPath, body, writeAuth, source, pack, actorId, generation, expected);
      if (absorbed.status !== "succeeded" || !absorbed.report) throw new Error("Absorb response did not contain one succeeded report binding.");
      this.task = absorbed;
      this.rememberTask(source, absorbed);
      await this.reconcileSucceededTask(source, absorbed, documentRef);
      this.retries.delete(absorbIdentity);
      this.message = "Deep Research result was explicitly absorbed and fresh-read. Review it before any separate report confirmation or formal decision.";
    });
  }
  private async reconcileSucceededTask(source: DeepResearchConsoleSource, task: DeepResearchTaskData, documentRef: Document): Promise<void> {
    await this.reloadWorkspace(source, documentRef);
    if (!taskReportMatchesWorkspace(task, this.workspace)) {
      this.forgetTask(source);
      this.task = null;
      this.taskPack = null;
      throw new Error("The task report is no longer the current report. The current workspace was fresh-read; review it before any separate action.");
    }
    this.forgetTask(source);
    this.task = null;
    this.taskPack = null;
  }
  private rememberTask(source: DeepResearchConsoleSource, task: DeepResearchTaskData): boolean {
    this.taskReference = taskReference(source, task);
    return saveTaskReference(source, this.taskReference);
  }
  private stopTaskAutoRefresh(): void {
    if (this.taskAutoRefreshTimer !== null) clearTimeout(this.taskAutoRefreshTimer);
    this.taskAutoRefreshTimer = null;
    this.taskAutoRefreshRemaining = 0;
  }
  private startTaskAutoRefresh(documentRef: Document): void {
    this.stopTaskAutoRefresh();
    if (!this.task || !["pending", "running"].includes(this.task.status)) return;
    this.taskAutoRefreshRemaining = 24;
    this.taskAutoRefreshPaused = false;
    this.scheduleNextTaskAutoRefresh(documentRef);
  }
  private scheduleNextTaskAutoRefresh(documentRef: Document): void {
    if (this.taskAutoRefreshTimer !== null || !this.task || !["pending", "running"].includes(this.task.status)) return;
    if (documentRef.visibilityState === "hidden" || this.taskAutoRefreshRemaining <= 0) {
      this.taskAutoRefreshPaused = true;
      this.message = `Foreground auto refresh paused for task #${this.task.id}; the saved task can be refreshed manually.`;
      this.render(documentRef);
      return;
    }
    const taskId = this.task.id;
    const requestFingerprint = this.task.requestFingerprint;
    this.taskAutoRefreshTimer = setTimeout(() => {
      this.taskAutoRefreshTimer = null;
      if (this.task?.id !== taskId || this.task.requestFingerprint !== requestFingerprint) return;
      if (documentRef.visibilityState === "hidden") return this.scheduleNextTaskAutoRefresh(documentRef);
      this.taskAutoRefreshRemaining -= 1;
      void this.refreshTask(documentRef, true);
    }, 5_000);
    (this.taskAutoRefreshTimer as unknown as { unref?: () => void }).unref?.();
  }
  private forgetTask(source: DeepResearchConsoleSource): void {
    clearTaskReference(source);
    this.taskReference = null;
  }
  private async writeTask(
    kind: "start" | "retry" | "absorb" | "cancel",
    path: string,
    body: object,
    auth: WebApiAuth,
    source: DeepResearchConsoleSource,
    pack: ResearchEvidencePackData,
    actorId: string,
    generation: number,
    expected?: DeepResearchTaskData
  ): Promise<DeepResearchTaskData> {
    const identity = canonicalJson({ kind, path, body });
    const existing = this.retries.get(identity);
    if (!existing && this.retries.size >= MAX_UNRESOLVED_WRITE_RETRIES) throw new Error("Deep-research retry ledger is full; resolve an existing write first.");
    const idempotencyKey = existing ?? `web-deep-task-${kind}-${crypto.randomUUID()}`;
    this.retries.set(identity, idempotencyKey);
    try {
      const value = await this.fetchJson(path, "POST", auth, { ...body, idempotencyKey }, false, actorId);
      this.assertTaskContext(source, actorId, auth, this.dependencies.writeAuth(), generation);
      const posted = acceptTask(value, source, pack, actorId, expected, kind === "retry");
      this.rememberTask(source, posted);
      const readAuth = this.dependencies.readAuth();
      if (!readAuth) throw new Error("Read authorization is unavailable for task readback.");
      const freshValue = await this.fetchJson(
        `/api/mobile/research/candidate-memberships/${source.membershipId}/deep-research-tasks/${posted.id}`,
        "GET", readAuth
      );
      this.assertTaskContext(source, actorId, readAuth, this.dependencies.readAuth(), generation);
      const fresh = acceptTask(freshValue, source, pack, actorId, posted);
      if (!sameTaskResult(posted, fresh)) throw new Error("Fresh task readback did not match the task write response.");
      if (kind !== "absorb") this.retries.delete(identity);
      return fresh;
    } catch (error) {
      if (error instanceof HttpFailure && error.status >= 400 && error.status < 500) this.retries.delete(identity);
      throw error;
    }
  }
  private assertTaskContext(source: DeepResearchConsoleSource, actorId: string, usedAuth: WebApiAuth, currentAuth: WebApiAuth | null, generation: number): void {
    if (generation !== this.generation || !sameSourceContext(this.source(), source) || this.actorId !== actorId || !sameWebApiAuth(usedAuth, currentAuth)) {
      throw new Error("Membership, actor, authorization, or frozen evidence changed while the task operation was running.");
    }
  }
  private async reloadWorkspace(source: DeepResearchConsoleSource, documentRef: Document): Promise<void> {
    const auth = this.dependencies.readAuth();
    const generation = this.generation;
    const actorId = this.actorId;
    if (!auth || actorId !== source.actorId || !sameSourceContext(this.source(), source)) throw new Error("Source or authorization changed; reload before using the result.");
    const [value, todayValue] = await Promise.all([
      this.fetchJson(`/api/mobile/research/candidate-memberships/${source.membershipId}/deep-research`, "GET", auth),
      this.fetchJson(`/api/mobile/research/candidate-memberships/${source.membershipId}/today`, "GET", auth, undefined, true)
    ]);
    if (generation !== this.generation || !sameWebApiAuth(auth, this.dependencies.readAuth()) || source.sourceKey !== this.sourceKey) {
      throw new Error("Source or authorization changed during fresh readback; the old response was discarded.");
    }
    const envelope = this.acceptWorkspace(value, source);
    const today = this.acceptToday(todayValue, source, envelope.requestedActorId);
    this.installWorkspace(envelope, today, documentRef);
  }
  private installWorkspace(envelope: DeepResearchWorkspaceEnvelope, today: TodayResearchEnvelope, documentRef: Document): void {
    if (!todayMonitorBindingsMatchWorkspace(today, envelope)) {
      throw new Error("Today monitor identity does not match the fresh Deep Research workspace.");
    }
    this.workspace = envelope;
    this.today = today;
    this.workspaceReadState = "fresh";
    this.actorId = envelope.requestedActorId;
    clearProviderConfirmation(documentRef);
    const taskPack = taskBoundPack(envelope, this.task, this.taskReference);
    this.taskPack = taskPack;
    this.dependencies.onWorkspaceChanged?.(envelope);
    syncGeelyEventOptions(documentRef, envelope);
    syncGclEventOptions(documentRef, envelope);
    this.message = taskCanRestartOnCurrentPack(envelope, this.task, this.taskReference, taskPack)
      ? `A newer evidence pack superseded task #${this.task?.id}. Use Start Deep Research to explicitly create a new task; the old result will not be absorbed.`
      : this.taskReference && !taskPack
      ? `Saved Deep Research task #${this.taskReference.taskId} was retained, but its exact pack is unavailable. Research writes remain locked until it can be fresh-read.`
      : this.task ? taskMessage(this.task, Boolean(this.taskReference))
        : this.taskReference ? `Saved Deep Research task #${this.taskReference.taskId} is recoverable. Explicitly refresh it; no duplicate task will be created.`
          : envelope.message;
    this.writeTemplate(documentRef, envelope);
  }
  private hideWorkspaceFacts(): void {
    this.workspace = null;
    this.today = null;
    this.workspaceReadState = "empty";
    this.dependencies.onWorkspaceChanged?.(null);
  }
  private acceptWorkspace(value: unknown, source: DeepResearchConsoleSource): DeepResearchWorkspaceEnvelope {
    const validation = validateDeepResearchWorkspaceEnvelope(value);
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    const envelope = value as DeepResearchWorkspaceEnvelope;
    if (!sameSourceContext(this.source(), source) || envelope.status !== "available"
      || envelope.membershipId !== source.membershipId || envelope.requestedSymbol !== source.symbol
      || envelope.data?.target.membershipVersion !== source.membershipVersion
      || envelope.requestedActorId !== source.actorId || this.actorId && envelope.requestedActorId !== this.actorId) {
      throw new Error("Deep-research response no longer matches the current source-bound membership.");
    }
    return envelope;
  }
  private acceptToday(value: unknown, source: DeepResearchConsoleSource, expectedActorId: string): TodayResearchEnvelope {
    const validation = validateTodayResearchEnvelope(value);
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    const envelope = value as TodayResearchEnvelope;
    const exposesIdentity = envelope.membershipVersion !== null || envelope.requestedSymbol !== null;
    if (!sameSourceContext(this.source(), source) || envelope.membershipId !== source.membershipId || envelope.requestedActorId !== expectedActorId
      || exposesIdentity && (envelope.membershipVersion !== source.membershipVersion || envelope.requestedSymbol !== source.symbol)) {
      throw new Error("Today response no longer matches the current source-bound membership.");
    }
    return envelope;
  }
  private acceptCloudAiPolicy(value: unknown, expectedActorId: string): CloudAiPolicyEnvelope {
    const validation = validateCloudAiPolicyEnvelope(value);
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    const envelope = value as CloudAiPolicyEnvelope;
    if (envelope.status !== "available" || envelope.requestedActorId !== expectedActorId || envelope.state?.actorId !== expectedActorId) {
      throw new Error("Cloud AI policy no longer matches the current actor.");
    }
    return envelope;
  }
  private async write(
    kind: string,
    path: string,
    body: object,
    auth: WebApiAuth,
    validateData: (value: unknown) => { ok: true } | { ok: false; errors: string[] },
    label: string,
    keepRetryUntilReadback = false,
    retryScope: object | null = null
  ): Promise<unknown> {
    const actorId = this.actorId;
    const source = this.source();
    const generation = this.generation;
    if (!actorId || !source) throw new Error("Fresh-read the actor-bound workspace before writing research facts.");
    const identity = canonicalJson(retryScope ? { kind, path, body, retryScope } : { kind, path, body });
    const existing = this.retries.get(identity);
    if (!existing && this.retries.size >= MAX_UNRESOLVED_WRITE_RETRIES) {
      throw new Error(`Deep-research retry ledger is full (${MAX_UNRESOLVED_WRITE_RETRIES}); resolve an existing write first.`);
    }
    const idempotencyKey = existing ?? `web-deep-${kind}-${Date.now()}-${crypto.randomUUID()}`;
    this.retries.set(identity, idempotencyKey);
    try {
      const envelope = await this.fetchJson(path, "POST", auth, { ...body, idempotencyKey }, false, actorId);
      if (generation !== this.generation || this.actorId !== actorId || !sameSourceContext(this.source(), source)
        || !sameWebApiAuth(auth, this.dependencies.writeAuth())) {
        throw new Error("Source, actor, or authorization changed while the research write was running.");
      }
      const envelopeErrors = validateResearchWriteEnvelopeBase(envelope, "write envelope");
      const writeSource = record(envelope) && record(envelope.source) ? envelope.source : null;
      if (writeSource?.actorType !== "user" || writeSource.actorId !== actorId) {
        envelopeErrors.push("write envelope actor no longer matches the fresh workspace actor");
      }
      const data = record(envelope) ? envelope.data : undefined;
      const dataValidation = validateData(data);
      if (envelopeErrors.length > 0 || !dataValidation.ok) {
        throw new Error(`${label} response failed contract validation: ${[
          ...envelopeErrors,
          ...(dataValidation.ok ? [] : dataValidation.errors)
        ].join("; ")}`);
      }
      if (!keepRetryUntilReadback) this.retries.delete(identity);
      return data;
    } catch (error) {
      if (error instanceof HttpFailure && error.status >= 400 && error.status < 500) this.retries.delete(identity);
      throw error;
    }
  }
  private async fetchJson(
    path: string,
    method: "GET" | "POST",
    auth: WebApiAuth,
    body?: object,
    allowFailClosed = false,
    expectedActorId?: string
  ): Promise<unknown> {
    const response = await (this.dependencies.fetcher ?? fetch)(path, {
      method,
      cache: method === "GET" ? "no-store" : undefined,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(expectedActorId ? { "x-research-expected-actor-id": expectedActorId } : {}),
        [auth.headerName]: auth.token
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const value: unknown = await response.json().catch(() => null);
    if (allowFailClosed && !todayStatusMatchesHttp(response.status, value)) {
      throw new HttpFailure(response.status, "Today HTTP status does not match its fail-closed envelope.");
    }
    if (!response.ok && !allowFailClosed) {
      const record = value && typeof value === "object" ? value as { message?: unknown; failures?: unknown } : {};
      const detail = [record.message, ...(Array.isArray(record.failures) ? record.failures : [])].filter((item) => typeof item === "string").join("; ");
      throw new HttpFailure(response.status, detail || `HTTP ${response.status}`);
    }
    return value;
  }
  private async run(
    progress: string,
    documentRef: Document,
    action: () => Promise<void>,
    retainWorkspaceOnReadFailure = false
  ): Promise<void> {
    if (this.busy) return;
    const token = this.generation;
    this.busy = true;
    this.message = progress;
    this.render(documentRef);
    try {
      const pending = action(); this.render(documentRef); await pending;
    } catch (error) {
      if (token === this.generation) {
        if (retainWorkspaceOnReadFailure && this.workspace) {
          this.workspaceReadState = "stale";
          this.message = `Last valid Deep Research workspace is retained as stale after a read failure: ${message(error)}`;
        } else {
          this.message = message(error);
        }
      }
    } finally {
      if (token === this.generation) {
        this.busy = false;
        this.render(documentRef);
      }
    }
  }
  private fail(value: string, documentRef: Document): void {
    this.message = value;
    this.render(documentRef);
  }
  private source(): DeepResearchConsoleSource | null {
    const source = this.dependencies.currentSource();
    return source && source.sourceKey === this.sourceKey ? source : null;
  }
  // eslint-disable-next-line complexity -- one exhaustive render over the existing Deep Research controls.
  private render(documentRef: Document): void {
    const host = documentRef.getElementById("deep-research-console");
    const status = documentRef.getElementById("deep-research-status");
    const output = documentRef.getElementById("deep-research-output");
    if (!host || !status || !output) return;
    const source = this.source();
    const pack = currentPack(this.workspace);
    const eventScope = selectedEventScope(documentRef);
    const holdingSource = currentHoldingEventSource(source?.portfolio, source?.symbol ?? "");
    const holdingStatus = documentRef.getElementById("deep-holding-context");
    if (holdingStatus) holdingStatus.textContent = eventScope === "research_stock" ? "Research-stock events do not use account holdings."
      : holdingSource ? `Current Pingan holding verified · account ${holdingSource.accountScopeId} · snapshot ${holdingSource.snapshotId} · cutoff ${holdingSource.sourceAsOf} · row ${holdingSource.positionSourceRowId}`
        : "Current Pingan holding is unavailable, stale, or does not contain this stock; holding-logic save is blocked.";
    const policyState = this.renderCloudAiPolicyControls(documentRef, source !== null);
    syncDeepResearchTaskIntentControls(documentRef, pack, currentPriorReport(this.workspace), {
      busy: this.busy,
      hasSource: source !== null,
      actionBlocked: this.workspaceReadState === "stale" || deepResearchActionBlocked(
        "deep-task-start", this.workspace, this.task, this.taskReference, this.taskPack
      )
    });
    host.dataset.state = this.busy ? "loading" : this.workspaceReadState === "stale"
      ? "stale" : this.workspace?.data?.completion.state ?? (source ? "ready" : "unavailable");
    host.dataset.workspaceFreshness = this.workspaceReadState;
    host.dataset.taskState = this.task?.status ?? (this.taskReference ? "saved" : "none");
    status.textContent = this.message;
    renderTodaySourceRecovery(documentRef, this.today?.quality?.sourceHealth.issueCodes ?? []);
    for (const id of [
      "deep-research-refresh", "deep-material-save", "deep-pack-freeze", "deep-pack-limited",
      "deep-event-save", "deep-geely-save", "deep-gcl-save",
      "deep-task-start", "deep-task-refresh", "deep-task-retry", "deep-task-absorb",
      "deep-task-defer", "deep-task-cancel", "deep-task-reject",
      "deep-report-save", "deep-report-confirm", "deep-report-reject"
    ]) {
      const button = documentRef.getElementById(id) as HTMLButtonElement | null;
      if (button) button.disabled = this.busy || !source || id === "deep-geely-save" && source.symbol !== "HK.00175"
        || id === "deep-gcl-save" && (source.symbol !== "HK.03800" || !holdingSource)
        || id === "deep-event-save" && eventScope === "current_holding" && !holdingSource
        || id === "deep-task-start" && policyState?.status !== "enabled"
        || this.workspaceReadState === "stale" && !["deep-research-refresh", "deep-task-refresh", "deep-task-defer", "deep-task-cancel"].includes(id)
        || deepResearchActionBlocked(id, this.workspace, this.task, this.taskReference, this.taskPack);
    }
    output.replaceChildren();
    const data = this.workspace?.data;
    renderDeepResearchReportSummary(documentRef, data ?? null, this.workspaceReadState);
    if (!data) { output.textContent = "No current deep-research workspace is loaded."; return; }
    const leads = data.materials.filter((item) => item.sourceType === EXCHANGE_ANNOUNCEMENT_LEAD_SOURCE_TYPE && item.revisionState === "current");
    if (leads.length) {
      const details = documentRef.createElement("details");
      details.dataset.testid = "deep-announcement-leads";
      const heading = documentRef.createElement("summary");
      heading.textContent = `待核验公告线索 ${leads.length} 项`;
      const note = documentRef.createElement("p");
      note.textContent = "以下只有标题、日期和链接，尚未进入研究证据。请先打开原文核对，再通过材料与事件表单记录事实。";
      details.append(heading, note);
      for (const lead of leads) {
        const row = documentRef.createElement("p");
        row.textContent = `${lead.title} · ${(lead.publishedAt?.slice(0, 10) ?? "披露时间未知")} `;
        if (lead.sourceUrl) {
          const url = new URL(lead.sourceUrl);
          if (url.protocol === "https:" && !url.username && !url.password) {
            const link = documentRef.createElement("a");
            link.href = url.href; link.textContent = "打开原文"; link.target = "_blank"; link.rel = "noopener noreferrer";
            row.append(link);
          }
        }
        details.append(row);
      }
      output.append(details);
    }
    if (this.workspaceReadState === "stale") {
      const warning = documentRef.createElement("p");
      warning.textContent = "Showing the last valid workspace for this exact stock and membership. Refresh before any new write or report action.";
      warning.className = "form-note";
      warning.dataset.testid = "deep-research-stale-warning";
      output.append(warning);
    }
    renderDeepResearchTaskFreshness(documentRef, output, this.task, this.taskLastReadAt, this.taskAutoRefreshPaused);
    const lines = deepResearchOutputLines(data, this.today, this.task, this.taskReference);
    const list = documentRef.createElement("ul");
    list.append(...lines.map((line) => { const item = documentRef.createElement("li"); item.textContent = line; return item; }));
    output.append(list);
  }
  private renderCloudAiPolicyControls(documentRef: Document, hasSource: boolean): CloudAiPolicyEnvelope["state"] {
    const state = this.cloudAiPolicy?.state ?? null;
    const status = documentRef.getElementById("deep-cloud-ai-status");
    const noBackup = documentRef.getElementById("deep-cloud-ai-no-backup") as HTMLInputElement | null;
    if (status) status.textContent = this.cloudAiPolicy
      ? `${this.cloudAiPolicy.message} Provider=${this.cloudAiPolicy.policy.provider}/${this.cloudAiPolicy.policy.model}; backup=${this.cloudAiPolicy.policy.backupProvider}; region=${this.cloudAiPolicy.policy.processingRegion}; retention=${this.cloudAiPolicy.policy.retention}; training=${this.cloudAiPolicy.policy.training}; deletion=${state?.deletionRequest.status ?? "UNKNOWN"}.`
      : "Cloud AI policy has not been fresh-read for the current actor.";
    for (const [id, blocked] of [
      ["deep-cloud-ai-enable", this.cloudAiPolicy?.status !== "available" || state?.status === "enabled" || noBackup?.checked !== true],
      ["deep-cloud-ai-disable", state?.status !== "enabled"],
      ["deep-cloud-ai-delete", state?.deletionRequest.status === "requested_unconfirmed"]
    ] as const) {
      const button = documentRef.getElementById(id) as HTMLButtonElement | null;
      if (button) button.disabled = this.busy || !hasSource || blocked;
    }
    const confirmation = documentRef.getElementById("deep-provider-confirm") as HTMLInputElement | null;
    if (confirmation) confirmation.disabled = this.busy || state?.status !== "enabled";
    if (noBackup) noBackup.disabled = this.busy || this.cloudAiPolicy?.status !== "available" || state?.status === "enabled" || state?.deletionRequest.status === "requested_unconfirmed";
    return state;
  }
  private writeTemplate(documentRef: Document, envelope: DeepResearchWorkspaceEnvelope): void {
    const field = input(documentRef, "deep-report-payload");
    if (field.value.trim() || !envelope.data) return;
    const facts = envelope.data.materials.filter((item) => item.claimType === "verified_fact").map((item) => item.evidenceId);
    const support = envelope.data.materials.filter((item) => item.stance === "support" && item.claimType !== "model_inference").map((item) => item.evidenceId);
    const counter = envelope.data.materials.filter((item) => item.stance === "refute" && item.claimType !== "model_inference").map((item) => item.evidenceId);
    field.value = JSON.stringify({
      researchQuestion: "", cutoffAt: new Date().toISOString(), investmentThesis: "",
      factTable: facts.length ? [{ statement: "", evidenceIds: facts }] : [],
      supportEvidenceIds: support, counterEvidenceIds: counter,
      sourceConflictAssessment: "", sourceConflicts: [],
      unknownItems: [], keyDrivers: [], causalChain: [], valuationScenarios: [], impliedExpectations: [],
      invalidationConditions: [], changeFromPrevious: "", portfolioImpact: [], nextValidationQuestions: [],
      modelInferences: [{ statement: "", evidenceIds: [...new Set([...support, ...counter])] }]
    }, null, 2);
  }
}

export function webResearchCompletenessAllowsReportConfirmation(
  value: unknown,
  source: DeepResearchConsoleSource,
  actorId: string
): value is ResearchCompletenessEnvelope {
  if (!validateResearchCompletenessEnvelope(value).ok) return false;
  const envelope = value as ResearchCompletenessEnvelope;
  return envelope.status === "available"
    && envelope.membershipId === source.membershipId
    && envelope.requestedActorId === actorId
    && envelope.requestedSymbol === source.symbol
    && envelope.data?.membershipVersion === source.membershipVersion
    && researchCompletenessAllowsFormalization(envelope.data);
}
function renderDeepResearchTaskFreshness(
  documentRef: Document,
  output: HTMLElement,
  task: DeepResearchTaskData | null,
  lastReadAt: string | null,
  paused: boolean
): void {
  if (!task) return;
  const freshness = documentRef.createElement("p");
  freshness.className = "form-note";
  freshness.dataset.testid = "deep-research-task-freshness";
  freshness.textContent = `Task updated ${task.updatedAt} · last read ${lastReadAt ?? "not yet refreshed in this page"}${paused ? " · foreground auto refresh paused" : ""}.`;
  output.append(freshness);
}
function todayQualityLine(today: TodayResearchEnvelope | null): string {
  const quality = today?.quality;
  return `Today status=${today?.status ?? "not_loaded"} · sourceHealth=${quality?.sourceHealth.status ?? "unavailable"}:${quality?.sourceHealth.id ?? "none"} · issues=${quality?.sourceHealth.issueCodes.join(",") || "none"} · structure=${quality?.researchStructure.status ?? "unavailable"}:${quality?.researchStructure.id ?? "none"} · checks=${quality?.researchStructure.checks.filter((check) => check.passed).length ?? 0}/${quality?.researchStructure.checks.length ?? 0} · secondOpinion=${quality?.secondOpinion.status ?? "unavailable"}/dependency=${quality?.secondOpinion.dependencyIncluded ?? false}`;
}
export function todaySourceRecovery(issueCodes: TodaySourceIssueCode[]): { summary: string; href: string } | null {
  if (!issueCodes.length) return null;
  const summary = issueCodes.map((code) => ({
    missing_materials: "尚无可追溯材料", stale_materials: "材料已过期", conflicting_materials: "材料存在冲突",
    unverified_materials: "材料尚未核验", unauthorized_rights: "材料使用权未确认", future_source_time: "来源时间晚于当前时间",
    unfrozen_revision: "当前修订尚未冻结", pack_integrity_failure: "证据包完整性失败", report_pack_mismatch: "报告与证据包不一致",
    historical_evidence_pack: "证据包已历史化", holding_snapshot_stale: "持仓快照已过期", holding_snapshot_conflict: "持仓快照存在冲突"
  })[code]).join("、");
  const href = issueCodes.some((code) => ["missing_materials", "stale_materials", "conflicting_materials", "unverified_materials", "unauthorized_rights", "future_source_time"].includes(code))
    ? "#research-documents-console"
    : issueCodes.some((code) => code === "holding_snapshot_stale" || code === "holding_snapshot_conflict")
      ? "#portfolio-decision-workspace"
      : issueCodes.includes("report_pack_mismatch") ? "#deep-research-report-summary" : "#deep-research-console";
  return { summary, href };
}
function renderTodaySourceRecovery(documentRef: Document, issueCodes: TodaySourceIssueCode[]): void {
  const row = documentRef.getElementById("deep-source-health-recovery");
  const recovery = todaySourceRecovery(issueCodes);
  if (!row) return;
  row.hidden = recovery === null;
  if (!recovery) return;
  const summary = row.querySelector("span");
  const link = row.querySelector("a");
  if (summary) summary.textContent = `来源问题：${recovery.summary}。`;
  if (link) link.href = recovery.href;
}
function deepResearchOutputLines(
  data: NonNullable<DeepResearchWorkspaceEnvelope["data"]>,
  today: TodayResearchEnvelope | null,
  task: DeepResearchTaskData | null,
  reference: DeepResearchTaskReference | null
): string[] {
  return [
    todayQualityLine(today),
    ...(today?.items.map((item) =>
      `Today #${item.order} ${item.id} · ${item.category}/${item.priority}/${item.trackingState} · facts=${item.bindings.factRefs.map((ref) => `${ref.materialId}:r${ref.revision}:${ref.sourceVersion}`).join(",") || "none"} · events=${item.bindings.eventRefs.map((ref) => `${ref.eventId}:v${ref.eventVersion}`).join(",") || "none"} · monitor=${item.bindings.monitorRef ? `${item.bindings.monitorRef.kind}:${item.bindings.monitorRef.id}:v${item.bindings.monitorRef.runVersion}` : "none"} · report=${item.bindings.reportRef ? `${item.bindings.reportRef.id}:v${item.bindings.reportRef.version}` : "none"} · holding=${item.bindings.holdingSnapshotRefs.map((ref) => ref.snapshotId).join(",") || "none"} · next=${item.nextCheckpoint ?? "none"}`
    ) ?? ["Today: not loaded"]),
    `Completion: ${data.completion.state}; deepResearchComplete=${data.completion.deepResearchComplete}`,
    `Materials: ${data.materials.length}; pack=${data.latestPack?.id ?? "missing"}; report=${data.latestReport?.id ?? "missing"} v${data.latestReport?.version ?? "missing"}`,
    ...frozenSourceCoverageLines(data.latestPack),
    ...taskLines(task, reference),
    `Events: ${data.events.length}; versions=${data.events.map((event) => event.eventVersion).join(", ") || "none"}`,
    `Geely sales: ${data.latestGeelySalesMonitor ? `run v${data.latestGeelySalesMonitor.runVersion} ${data.latestGeelySalesMonitor.period} · ${data.latestGeelySalesMonitor.assessment.status} · trend=${data.latestGeelySalesMonitor.assessment.trendConclusionAllowed}` : "missing"}`,
    ...gclMonitorLines(data.latestGclPvPriceMonitor),
    `Verified facts: ${data.classification.verifiedFactMaterialIds.join(", ") || "none"}`,
    `Issuer statements: ${data.classification.issuerStatementMaterialIds.join(", ") || "none"}`,
    `Third-party statements: ${data.classification.thirdPartyStatementMaterialIds.join(", ") || "none"}`,
    `Model-source materials: ${data.classification.modelInferenceMaterialIds.join(", ") || "none"}`,
    `User decision: ${data.userDecision?.decision ?? "pending"} (${data.classification.userDecisionId ?? "none"})`,
    ...data.materials.map((item) => `${item.id}/${item.evidenceId} r${item.revision}/${item.revisionState} ${item.claimType} · ${item.verificationStatus}/${item.rightsStatus}/${item.freshness} · sha256:${item.contentFingerprint} · ${item.title}`),
    ...data.events.map((event) => `Event ${event.id} v${event.eventVersion} · ${event.eventKind}/${event.coverageScope} · ${event.keyVariable} · ${event.importance}/${event.hypothesisImpact} · material ${event.source.materialId} ${event.source.sourceVersion} · sha256:${event.eventFingerprint}`),
    ...(data.latestGeelySalesMonitor?.assessment.comparisons ?? []).map((item) => `Sales ${item.id}: ${item.status} · ${item.percentChange ?? "unknown"}% · ${item.reason}`),
    ...(data.latestGeelySalesMonitor?.assessment.ratios ?? []).map((item) => `Sales ${item.id}: ${item.status} · ${item.currentValue ?? "unknown"}% · Δ${item.changePercentagePoints ?? "unknown"}pp · ${item.boundary}`),
    ...(data.latestGeelySalesMonitor?.assessment.blockers ?? []).map((item) => `Sales UNKNOWN: ${item}`),
    ...(data.latestGeelySalesMonitor?.observations ?? []).map((item) => `Sales source ${item.entityRole}/${item.entityName} ${item.periodKind} ${item.period}: ${item.value} ${item.unit} · ${item.metric}/${item.propulsion}/${item.geography}/${item.channel} · event ${item.sourceEvent.eventId} v${item.sourceEvent.eventVersion}`),
    ...deepResearchReportDeletionLines(data.reportDeletions),
    ...(data.latestReport?.gateFailures ?? []).map((item) => `Gate: ${item}`),
    ...data.completion.reasons.map((item) => `Required: ${item}`)
  ];
}
export function deepResearchReportDeletionLines(
  deletions: DeepResearchReportDeletionData[] | undefined
): string[] {
  return (deletions ?? []).map((item) => `报告删除凭证 ${item.reportId} v${item.reportVersion} · pack ${item.evidencePackId} · membership ${item.membershipId} v${item.membershipVersion} · sha256:${item.reportFingerprint} · deleted ${item.deletedAt} · ${item.state}`);
}
export function frozenSourceCoverageLines(pack: ResearchEvidencePackData | null | undefined): string[] {
  if (pack?.researchMode === "limited") return [`有限研究：已准备 ${pack.items.length} 份材料；本次不含冻结估值与技术条件，不能确认正式报告。`];
  const sources = pack?.frozenResearchContext?.unboundSources;
  if (!sources) { const reason = pack ? `pack ${pack.id} v${pack.version}/${pack.currentness.status} has no frozen research context` : "no evidence pack"; return [`Source coverage: UNKNOWN · ${reason}`, ...FROZEN_RESEARCH_SOURCE_GAPS.map((key) => `Source ${key}: UNKNOWN · ${reason}`)]; }
  const bound = FROZEN_RESEARCH_SOURCE_GAPS.filter((key) => sources[key].status === "bound").length;
  const quant = pack.frozenResearchContext?.quantPortfolio;
  const context = pack.frozenResearchContext?.researchContext;
  const requirement = pack.frozenResearchContext?.financialRequirement;
  return [
    `Source coverage: pack ${pack.id} v${pack.version}/${pack.currentness.status} · ${bound}/5 exact-bound · ${5 - bound}/5 source_missing/UNKNOWN`,
    ...(pack.currentness.invalidatedBy.includes("financial_requirement_changed")
      ? ["财务资料期数核对已变化或到期；这个冻结版本只能回看，请重新核对并冻结。"] : []),
    context
      ? `Research context: ${context.id} · cutoff=${context.cutoffAt} · validUntil=${context.validUntil} · sha256:${context.contentHash}`
      : "Research context: historical pack did not capture this binding · UNKNOWN",
    requirement
      ? `财务资料期数核对：#${requirement.id} · 年度至 ${requirement.latestRequiredAnnualPeriodEnd} · 中期至 ${requirement.latestRequiredInterimPeriodEnd} · 有效至 ${requirement.validUntil}`
      : "财务资料期数核对：未绑定 · UNKNOWN",
    ...FROZEN_RESEARCH_SOURCE_GAPS.map((key) => { const source = sources[key]; return source.status === "bound" ? `Source ${key}: bound/${source.value} · event=${source.eventId}:v${source.eventVersion} · sha256:${source.eventFingerprint} · material=${source.materialId} · evidence=${source.evidenceId} · keyVariable=${source.keyVariable} · hypothesisImpact=${source.hypothesisImpact}` : `Source ${key}: ${source.status}/${source.value}`; }),
    quant
      ? `Quant portfolio: decision=${quant.decision.status === "available" ? quant.decision.refinementId : "source_missing"} · portfolio=${quant.portfolio.status === "available" ? quant.portfolio.evidenceId : "source_missing"} · research-only`
      : "Quant portfolio: historical pack did not capture this binding · UNKNOWN"
  ];
}
function todayStatusMatchesHttp(statusCode: number, value: unknown): boolean {
  const status = record(value) ? value.status : null;
  if (statusCode >= 200 && statusCode < 300) return status === "available";
  if (statusCode === 400 || statusCode === 422) return status === "malformed";
  if (statusCode === 401 || statusCode === 403) return status === "unauthorized";
  if (statusCode === 404) return status === "not_found";
  if (statusCode === 409) return status === "conflict";
  return statusCode >= 500 && (status === "stale" || status === "unavailable");
}
class HttpFailure extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function message(error: unknown): string { return error instanceof Error ? error.message : "Deep-research operation failed."; }
function clearProviderConfirmation(documentRef: Document): void { const checkbox = documentRef.getElementById("deep-provider-confirm") as HTMLInputElement | null; if (checkbox) checkbox.checked = false; }
export function currentPriorReport(workspace: DeepResearchWorkspaceEnvelope | null): DeepResearchTaskIntent["priorReport"] {
  const report = workspace?.data?.latestReport;
  const binding = report && "evidencePackBinding" in report.payload ? report.payload.evidencePackBinding : null;
  return report && binding
    && binding.membershipId === workspace?.data?.target.membershipId
    && binding.symbol === workspace?.data?.target.symbol
    && /^[a-f0-9]{64}$/.test(report.reportFingerprint)
    && !report.currentness.invalidatedBy.some((reason) =>
      ["report_fingerprint_invalid", "report_fingerprint_missing", "evidence_pack_identity_mismatch", "legacy_single_valuation_contract_projection"].includes(reason)) ? {
    id: report.id,
    version: report.version,
    evidencePackId: report.evidencePackId,
    reportFingerprint: report.reportFingerprint
  } : null;
}
function deepResearchTaskIntentFromControls(
  documentRef: Document,
  pack: ResearchEvidencePackData,
  priorReport: DeepResearchTaskIntent["priorReport"]
): DeepResearchTaskIntent {
  const value = (id: string): string => {
    const field = documentRef.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
    if (!field || typeof field.value !== "string") throw new Error(`Missing #${id}.`);
    return field.value;
  };
  const sections = ["fundamentals", "research_context", "events", "operating_monitor"] as const;
  const intent = defaultDeepResearchTaskIntent(pack, priorReport);
  intent.researchQuestion = value("deep-task-question").trim();
  intent.investmentHorizon = value("deep-task-horizon") as DeepResearchTaskIntent["investmentHorizon"];
  intent.outputLanguage = value("deep-task-language") as DeepResearchTaskIntent["outputLanguage"];
  intent.maxOutputTokens = Number(value("deep-task-max-tokens")) as DeepResearchTaskIntent["maxOutputTokens"];
  intent.maxDurationSeconds = Number(value("deep-task-max-duration")) as DeepResearchTaskIntent["maxDurationSeconds"];
  intent.selectedMaterialIds = [...documentRef.querySelectorAll<HTMLInputElement>("#deep-task-materials input[data-deep-material-id]:checked")]
    .map((field) => field.dataset.deepMaterialId ?? "")
    .sort((a, b) => Number(a) - Number(b));
  intent.includedStructuredSections = sections.filter((section) =>
    documentRef.querySelector<HTMLInputElement>(`input[data-deep-section="${section}"]`)?.checked === true
  );
  return intent;
}
function syncDeepResearchTaskIntentControls(
  documentRef: Document,
  pack: ResearchEvidencePackData | null,
  priorReport: DeepResearchTaskIntent["priorReport"],
  state: { busy: boolean; hasSource: boolean; actionBlocked: boolean }
): void {
  const fieldset = documentRef.getElementById("deep-task-intent") as HTMLFieldSetElement | null;
  const materials = documentRef.getElementById("deep-task-materials");
  if (!fieldset || !materials) return;
  fieldset.disabled = state.busy || !state.hasSource || !pack || state.actionBlocked;
  const providerConfirmation = documentRef.getElementById("deep-provider-confirm") as HTMLInputElement | null;
  if (providerConfirmation) providerConfirmation.disabled ||= fieldset.disabled;
  if (!pack) {
    fieldset.dataset.packIdentity = "";
    materials.textContent = "Fresh-read 当前 evidence pack 后显示。";
    return;
  }
  const identity = `${pack.id}:${pack.version}:${pack.packFingerprint}:${priorReport?.id ?? "none"}:${priorReport?.version ?? 0}:${priorReport?.reportFingerprint ?? "none"}`;
  if (fieldset.dataset.packIdentity === identity) return;
  fieldset.dataset.packIdentity = identity;
  const defaults = defaultDeepResearchTaskIntent(pack, priorReport);
  const setValue = (id: string, value: string | number): void => {
    const field = documentRef.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
    if (field) field.value = String(value);
  };
  setValue("deep-task-question", defaults.researchQuestion);
  setValue("deep-task-horizon", defaults.investmentHorizon);
  setValue("deep-task-language", defaults.outputLanguage);
  setValue("deep-task-max-tokens", defaults.maxOutputTokens ?? 8000);
  setValue("deep-task-max-duration", defaults.maxDurationSeconds ?? 60);
  renderDeepResearchBudgetPreview(documentRef);
  for (const checkbox of documentRef.querySelectorAll<HTMLInputElement>("input[data-deep-section]")) checkbox.checked = true;
  materials.replaceChildren(...pack.items.map((item) => {
    const label = documentRef.createElement("label");
    const checkbox = documentRef.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.deepMaterialId = item.id;
    label.append(checkbox, documentRef.createTextNode(
      `#${item.id}/${item.evidenceId} · ${item.title} · ${item.summary} · ${item.sourceType} · ${item.sourceVersion}`
    ));
    return label;
  }));
  const prior = documentRef.getElementById("deep-task-prior-report");
  if (prior) prior.textContent = priorReport
    ? `前一报告：#${priorReport.id} v${priorReport.version} · pack #${priorReport.evidencePackId} · ${priorReport.reportFingerprint}`
    : "前一报告：未绑定；本次将作为独立研究运行。";
  clearProviderConfirmation(documentRef);
}
function renderDeepResearchBudgetPreview(documentRef: Document): void {
  const target = documentRef.getElementById("deep-task-budget-preview");
  const field = documentRef.getElementById("deep-task-max-tokens") as HTMLSelectElement | null;
  if (!target || !field) return;
  const tokens = Number(field.value);
  const outputCost = cloudAiEstimatedMaxCostUsd(0, tokens);
  target.textContent = Number.isFinite(outputCost) && [1000, 2000, 4000, 8000].includes(tokens)
    ? `输出 ≤${tokens} tokens，按峰时价 ${CLOUD_AI_OUTPUT_USD_PER_MILLION}/百万 tokens 最多约 US$${outputCost.toFixed(8)}；输入将在实际发送清单中按 UTF-8 字节数保守估算。价格版本 ${CLOUD_AI_PROVIDER_PRICING_IDENTITY}。`
    : "输出预算无效；任务不会开始。";
}
function selectedEventScope(documentRef: Document): CreateResearchEventRequest["coverageScope"] { return (documentRef.getElementById("deep-event-scope") as HTMLSelectElement | null)?.value === "current_holding" ? "current_holding" : "research_stock"; }
function sourceIdentityKey(source: DeepResearchConsoleSource): string { return `${source.actorId}:${source.membershipId}:v${source.membershipVersion}:${source.symbol}`; }
function sameSourceContext(left: DeepResearchConsoleSource | null, right: DeepResearchConsoleSource): boolean { return Boolean(left && left.sourceKey === right.sourceKey && sourceIdentityKey(left) === sourceIdentityKey(right)); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function evidenceConflictBlocksFreeze(workspace: DeepResearchWorkspaceEnvelope | null): boolean { return workspace?.data?.materials.some((item) => item.revisionState === "current" && ["conflict", "rejected"].includes(item.verificationStatus)) ?? true; }
function currentPack(workspace: DeepResearchWorkspaceEnvelope | null): ResearchEvidencePackData | null { return workspace?.data?.latestPack?.currentness.status === "current" ? workspace.data.latestPack : null; }
export function workspaceMatchesFormalDecisionBinding(
  workspace: DeepResearchWorkspaceEnvelope | null,
  binding: ResearchReportDecisionBinding
): boolean {
  const data = workspace?.data;
  const target = data?.target;
  const pack = data?.latestPack;
  const report = data?.latestReport;
  const decision = data?.userDecision;
  return Boolean(target && pack?.currentness.status === "current" && report?.currentness.status === "current" && decision
    && target.membershipId === binding.membershipId && target.membershipVersion === binding.membershipVersion && target.symbol === binding.symbol
    && pack.id === binding.evidencePackId && pack.packFingerprint === binding.evidencePackFingerprint
    && report.id === binding.reportId && report.version === binding.reportVersion && report.contractVersion === binding.contractVersion
    && report.reportFingerprint === binding.reportFingerprint && report.evidencePackId === binding.evidencePackId
    && decision.id === binding.reportDecisionId && decision.reportId === binding.reportId && decision.decision === "confirmed"
    && decision.actorType === binding.reportDecisionActorType && decision.actorId === binding.reportDecisionActorId
    && decision.decidedAt === binding.decidedAt);
}
function packIsCurrent(workspace: DeepResearchWorkspaceEnvelope | null, pack: ResearchEvidencePackData): boolean { const latest = currentPack(workspace); return Boolean(latest && latest.id === pack.id && latest.packFingerprint === pack.packFingerprint); }
function taskReference(source: DeepResearchConsoleSource, task: DeepResearchTaskData): DeepResearchTaskReference {
  return {
    schemaVersion: "2026-08-09.web-deep-research-task-reference.v1",
    actorId: source.actorId,
    membershipId: source.membershipId,
    membershipVersion: source.membershipVersion,
    symbol: source.symbol,
    evidencePackId: task.evidencePackId,
    evidencePackFingerprint: task.evidencePackFingerprint,
    taskId: task.id,
    requestFingerprint: task.requestFingerprint
  };
}
function taskReferenceStorageKey(source: DeepResearchConsoleSource): string {
  return `web-deep-research-task-v1:${encodeURIComponent(source.actorId)}:${source.membershipId}:v${source.membershipVersion}:${source.symbol}`;
}
function taskReferenceMatchesSource(value: unknown, source: DeepResearchConsoleSource): value is DeepResearchTaskReference {
  if (!record(value)) return false;
  return Object.keys(value).sort().join("|") === TASK_REFERENCE_KEYS.join("|")
    && value.schemaVersion === "2026-08-09.web-deep-research-task-reference.v1"
    && value.actorId === source.actorId && value.membershipId === source.membershipId
    && value.membershipVersion === source.membershipVersion && value.symbol === source.symbol
    && typeof value.taskId === "string" && /^[1-9]\d*$/.test(value.taskId)
    && typeof value.evidencePackId === "string" && /^[1-9]\d*$/.test(value.evidencePackId)
    && typeof value.evidencePackFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.evidencePackFingerprint)
    && typeof value.requestFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.requestFingerprint);
}
function loadTaskReference(source: DeepResearchConsoleSource): DeepResearchTaskReference | null {
  const storage = browserLocalStorage();
  if (!storage) return null;
  const key = taskReferenceStorageKey(source);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    if (raw.length > 4_096) { storage.removeItem(key); return null; }
    const value: unknown = JSON.parse(raw);
    if (taskReferenceMatchesSource(value, source)) return value;
    storage.removeItem(key);
  } catch { /* untrusted or unavailable browser storage never restores a task */ }
  return null;
}
function saveTaskReference(source: DeepResearchConsoleSource, value: DeepResearchTaskReference): boolean {
  const storage = browserLocalStorage();
  if (!storage) return false;
  try { storage.setItem(taskReferenceStorageKey(source), JSON.stringify(value)); return true; } catch { return false; }
}
function taskRecoveryStorageAvailable(source: DeepResearchConsoleSource): boolean {
  const storage = browserLocalStorage();
  if (!storage) return false;
  const key = `${taskReferenceStorageKey(source)}:probe`;
  try { storage.setItem(key, "1"); storage.removeItem(key); return true; } catch { return false; }
}
function clearTaskReference(source: DeepResearchConsoleSource): void {
  try { browserLocalStorage()?.removeItem(taskReferenceStorageKey(source)); } catch { /* display stays fail-closed */ }
}
function taskReferenceMatchesPack(value: DeepResearchTaskReference, pack: ResearchEvidencePackData): boolean {
  return value.membershipId === pack.membershipId && value.membershipVersion === pack.membershipVersion
    && value.evidencePackId === pack.id && value.evidencePackFingerprint === pack.packFingerprint;
}
function taskMatchesReference(task: DeepResearchTaskData, value: DeepResearchTaskReference): boolean {
  return task.id === value.taskId && task.requestFingerprint === value.requestFingerprint
    && task.evidencePackId === value.evidencePackId && task.evidencePackFingerprint === value.evidencePackFingerprint;
}
function taskBoundPack(workspace: DeepResearchWorkspaceEnvelope | null, task: DeepResearchTaskData | null, reference: DeepResearchTaskReference | null): ResearchEvidencePackData | null {
  if (!workspace?.data || !task && !reference || task && reference && !taskMatchesReference(task, reference)) return null;
  return workspace.data.evidencePacks.find((pack) => task
    ? task.membershipId === workspace.membershipId && task.membershipVersion === pack.membershipVersion
      && task.evidencePackId === pack.id && task.evidencePackFingerprint === pack.packFingerprint
    : Boolean(reference && taskReferenceMatchesPack(reference, pack))) ?? null;
}
function taskCanRestartOnCurrentPack(workspace: DeepResearchWorkspaceEnvelope | null, task: DeepResearchTaskData | null, reference: DeepResearchTaskReference | null, savedPack: ResearchEvidencePackData | null): boolean {
  const latest = currentPack(workspace);
  if (task?.status === "canceled" && latest) return true;
  const bound = savedPack ?? taskBoundPack(workspace, task, reference);
  return Boolean(task && latest && bound && ["failed", "ready_to_absorb"].includes(task.status)
    && (latest.id !== bound.id || latest.packFingerprint !== bound.packFingerprint));
}
function acceptTask(value: unknown, source: DeepResearchConsoleSource, pack: ResearchEvidencePackData, actorId: string, expected?: DeepResearchTaskData, acceptsSuccessor = false): DeepResearchTaskData {
  const validation = validateDeepResearchTaskEnvelope(value);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  const envelope = value as DeepResearchTaskEnvelope;
  const task = envelope.data;
  if (envelope.status !== "available" || !task || envelope.membershipId !== source.membershipId || envelope.requestedActorId !== actorId
    || task.membershipId !== source.membershipId || task.membershipVersion !== source.membershipVersion
    || task.evidencePackId !== pack.id || task.evidencePackFingerprint !== pack.packFingerprint
    || task.snapshotBinding && (task.snapshotBinding.membershipId !== source.membershipId
      || task.snapshotBinding.membershipVersion !== source.membershipVersion
      || task.snapshotBinding.symbol !== source.symbol || task.snapshotBinding.evidencePackId !== pack.id
      || task.snapshotBinding.evidencePackVersion !== pack.version || task.snapshotBinding.evidencePackFingerprint !== pack.packFingerprint)
    || expected && ((task.id !== expected.id && (!acceptsSuccessor || task.previousTaskId !== expected.id))
      || task.requestFingerprint !== expected.requestFingerprint)) {
    throw new Error("Deep Research task no longer matches the actor, membership, frozen pack, or saved task identity.");
  }
  return task;
}
export function taskRetryable(task: DeepResearchTaskData): boolean {
  return task.status === "failed" && task.snapshotBinding !== null
    && task.intent?.providerAuthorization?.ownerConfirmed === true
    && ["provider_timeout", "provider_unavailable_or_invalid", "provider_http_401", "provider_http_402", "provider_http_403", "provider_http_408", "provider_http_429", "provider_http_500", "provider_http_502", "provider_http_503", "provider_http_504", "provider_output_invalid", "provider_receipt_unknown", "task_execution_failed", "worker_retry_exhausted"].includes(task.errorCode ?? "");
}
function taskActionBody(task: DeepResearchTaskData): Omit<DeepResearchTaskActionRequest, "idempotencyKey"> {
  if (!task.snapshotBinding) throw new Error("Task action requires one exact snapshot binding.");
  return { membershipVersion: task.membershipVersion, taskRequestFingerprint: task.requestFingerprint, snapshotId: task.snapshotBinding.snapshotId };
}
function taskAbsorbIdentity(source: DeepResearchConsoleSource, task: DeepResearchTaskData): string {
  return canonicalJson({ kind: "absorb", path: `/api/mobile/research/candidate-memberships/${source.membershipId}/deep-research-tasks/${task.id}/absorb`, body: taskActionBody(task) });
}
function sameTaskResult(left: DeepResearchTaskData, right: DeepResearchTaskData): boolean {
  return left.id === right.id && left.requestFingerprint === right.requestFingerprint
    && left.status === right.status && left.attemptCount === right.attemptCount
    && left.errorCode === right.errorCode
    && canonicalJson(left.snapshotBinding) === canonicalJson(right.snapshotBinding)
    && canonicalJson(left.synthesis) === canonicalJson(right.synthesis)
    && canonicalJson(left.report) === canonicalJson(right.report);
}
function taskMessage(task: DeepResearchTaskData, recoverable = true): string {
  const recovery = recoverable ? "you can reload or leave this section and explicitly refresh without creating a duplicate" : "browser recovery storage is unavailable, so keep this page open";
  if (task.status === "pending" || task.status === "running") return `Deep Research task #${task.id} is saved and ${task.status}; ${recovery}.`;
  if (task.status === "ready_to_absorb") return `Deep Research task #${task.id} is complete but has not written a report. Explicitly absorb it after reviewing the exact task identity.`;
  if (task.status === "failed") return `Deep Research task #${task.id} failed. ${taskFailureDetail(task)}`;
  if (task.status === "canceled") return `Deep Research task #${task.id} was ${task.errorCode === "material_deleted" ? "invalidated because a bound source material was deleted" : "canceled or not adopted"}; starting again requires a new explicit Owner action.`;
  return `Deep Research task #${task.id} succeeded with report ${task.report?.id ?? "UNKNOWN"} v${task.report?.version ?? "UNKNOWN"}.`;
}
function taskFailureDetail(task: DeepResearchTaskData): string {
  const retryable = taskRetryable(task);
  const [stage, reason] = task.errorCode === "provider_timeout"
    ? ["cloud provider", "the confirmed provider exceeded the Owner-selected time limit"]
    : task.errorCode === "provider_unavailable_or_invalid"
      ? ["cloud provider", "the confirmed provider was unavailable or returned an invalid result"]
      : task.errorCode === "provider_http_402"
        ? ["provider account", "the provider explicitly reported insufficient balance; resolve the account balance before explicitly retrying"]
      : task.errorCode?.startsWith("provider_http_")
        ? ["cloud provider response", "an explicit HTTP failure was received; no usable report was generated"]
      : task.errorCode === "provider_output_invalid"
        ? ["output validation", "a model reply was received but failed validation; it was not saved as a research report"]
      : task.errorCode === "provider_receipt_unknown"
        ? ["cloud provider receipt", "the request may have reached the provider, but no durable receipt exists; the system did not send it again automatically"]
      : task.errorCode === "worker_retry_exhausted"
        ? ["task recovery", "the saved task exhausted its lease recovery attempts"]
        : task.errorCode === "task_execution_failed"
          ? ["task execution", "the saved task stopped before producing a valid synthesis"]
          : ["evidence binding", "the membership, frozen evidence, authorization, or request identity is no longer valid"];
  return `Stage: ${stage}. Reason: ${reason}. Retry: ${retryable ? "yes, with the same snapshot" : "no"}. Next: ${retryable ? "explicitly retry the saved task" : "refresh evidence and prepare a new task"}.`;
}
function taskLines(task: DeepResearchTaskData | null, reference: DeepResearchTaskReference | null): string[] {
  if (!task) return [reference ? `Deep Research task #${reference.taskId}: saved locally; explicitly refresh to resume` : "Deep Research task: not started"];
  const manifest = task.synthesis?.sendManifest;
  return [
    `Deep Research task #${task.id}: ${task.status} · attempts=${task.attemptCount} · error=${task.errorCode ?? "none"}`,
    ...(task.status === "failed" ? [taskFailureDetail(task)] : []),
    `Task history: previous=${task.previousTaskId ?? "none"}`,
    `Task binding: request=${task.requestFingerprint} · pack=${task.evidencePackId}/${task.evidencePackFingerprint} · snapshot=${task.snapshotBinding?.snapshotId ?? "pending"}`,
    `Provider: ${task.synthesis ? `${task.synthesis.provider}/${task.synthesis.model} · ${task.synthesis.tokenUsage} · cost=${task.synthesis.cost}` : task.intent?.providerAuthorization ? `${task.intent.providerAuthorization.provider}/${task.intent.providerAuthorization.model} · authorized=${task.intent.providerAuthorization.ownerConfirmed}` : "authorization missing"}`,
    `All-attempt usage: ${task.previousTaskId !== null || task.attemptCount > 1 ? "tokens/cost=UNKNOWN because an earlier attempt lacks a durable provider receipt" : task.synthesis ? `${task.synthesis.tokenUsage} · cost=${task.synthesis.cost}` : "not yet available"}`,
    `${task.errorCode === "provider_receipt_unknown" ? "Attempted send manifest (provider receipt UNKNOWN)" : "Recorded send manifest"}: ${manifest ? `preparedAt=${manifest.preparedAt ?? "UNKNOWN"} · materials=${manifest.selectedMaterialIds.join(",") || "none"} · sections=${manifest.includedStructuredSections.join(",") || "none"} · sourceBindings=${manifest.sourceBindingCount} · policy=${manifest.policyVersion} · ${cloudAiPolicySnapshotSummary(manifest.policySnapshot)} · ${cloudAiSendAuthorizationSummary(manifest.sendAuthorization)} · requestSha256=${manifest.requestBodySha256} · fullPdf/credentials/officialAssets=false` : "not captured for this historical task"}`,
    `Conservative peak-rate cost ceiling: ${manifest?.inputTokenUpperBound !== undefined && manifest.maxOutputTokens !== undefined && manifest.estimatedMaxCostUsd !== undefined ? `input<=${manifest.inputTokenUpperBound} + output<=${manifest.maxOutputTokens} tokens · estimatedMaxUsd=${manifest.estimatedMaxCostUsd.toFixed(8)} · pricing=${manifest.pricingIdentity}` : "not captured for this historical task"}`,
    `Task result: report=${task.report ? `${task.report.id}:v${task.report.version}:${task.report.reportFingerprint}` : "not absorbed"}`
  ];
}
function taskBlocksResearchMutation(task: DeepResearchTaskData | null, reference: DeepResearchTaskReference | null): boolean {
  if (!task) return reference !== null;
  return ["pending", "running", "ready_to_absorb"].includes(task.status) || task.status === "succeeded" && reference !== null;
}
function taskReportMatchesWorkspace(task: DeepResearchTaskData, workspace: DeepResearchWorkspaceEnvelope | null): boolean {
  const report = workspace?.data?.latestReport;
  return Boolean(task.status === "succeeded" && task.report && report?.currentness.status === "current"
    && report.id === task.report.id && report.version === task.report.version
    && report.evidencePackId === task.report.evidencePackId && report.reportFingerprint === task.report.reportFingerprint);
}
function taskBlocksReportDecision(workspace: DeepResearchWorkspaceEnvelope | null, task: DeepResearchTaskData | null, reference: DeepResearchTaskReference | null): boolean {
  return taskBlocksResearchMutation(task, reference) || Boolean(task?.status === "succeeded" && !taskReportMatchesWorkspace(task, workspace));
}
// eslint-disable-next-line complexity -- one exhaustive UI action gate over the existing lifecycle.
function deepResearchActionBlocked(id: string, workspace: DeepResearchWorkspaceEnvelope | null, task: DeepResearchTaskData | null, reference: DeepResearchTaskReference | null, savedPack: ResearchEvidencePackData | null): boolean {
  const boundPack = savedPack ?? taskBoundPack(workspace, task, reference);
  const latestPack = currentPack(workspace);
  const boundPackIsCurrent = Boolean(boundPack && latestPack && boundPack.id === latestPack.id && boundPack.packFingerprint === latestPack.packFingerprint);
  if (["deep-material-save", "deep-event-save", "deep-geely-save", "deep-pack-freeze", "deep-pack-limited", "deep-report-save"].includes(id) && taskBlocksResearchMutation(task, reference)) return true;
  if (id === "deep-event-save") return !workspace?.data;
  if (id === "deep-geely-save") return Boolean(workspace?.data && (workspace.data.target.symbol !== "HK.00175"
    || !workspace.data.events.some((event) => event.keyVariable === "new_energy_vehicle_sales")));
  if (id === "deep-gcl-save") return !workspace?.data || workspace.data.target.symbol !== "HK.03800"
    || !workspace.data.events.some((event) => event.coverageScope === "current_holding" && event.keyVariable === "polysilicon_price");
  if (id === "deep-pack-freeze" || id === "deep-pack-limited") return evidenceConflictBlocksFreeze(workspace);
  if (id === "deep-task-start") return !latestPack || Boolean((task || reference) && !taskCanRestartOnCurrentPack(workspace, task, reference, savedPack));
  if (id === "deep-task-refresh") return !boundPack;
  if (id === "deep-task-retry") return !boundPackIsCurrent || !task || !taskRetryable(task);
  if (id === "deep-task-absorb") return !boundPackIsCurrent || task?.status !== "ready_to_absorb";
  if (id === "deep-task-defer") return !task || !["pending", "running", "ready_to_absorb"].includes(task.status);
  if (id === "deep-task-cancel") return !task || !["pending", "running"].includes(task.status);
  if (id === "deep-task-reject") return !task || task.status !== "ready_to_absorb";
  if (id === "deep-report-save") return !currentPack(workspace);
  if (id === "deep-report-confirm" && (workspace?.data?.latestReport?.status !== "complete_pending_confirmation"
    || workspace.data.latestReport.gateFailures.length > 0)) return true;
  return ["deep-report-confirm", "deep-report-reject"].includes(id)
    && (workspace?.data?.latestReport?.currentness.status !== "current" || taskBlocksReportDecision(workspace, task, reference));
}
function gclInputsBindCurrentHoldingEvents(
  workspace: DeepResearchWorkspaceEnvelope | null,
  prices: CreateGclPvPriceMonitorRequest["priceObservations"],
  contexts: CreateGclPvPriceMonitorRequest["contextObservations"],
  source: CurrentHoldingEventSource
): boolean {
  const requiredEvents = [
    ...prices.map((item) => ({ eventId: item.eventId, keyVariable: `${item.stage}_price` })),
    ...contexts.map((item) => ({ eventId: item.eventId, keyVariable: item.metric }))
  ];
  return requiredEvents.every((requiredEvent) => {
    const event = workspace?.data?.events.find((candidate) => candidate.id === requiredEvent.eventId);
    return Boolean(event && event.keyVariable === requiredEvent.keyVariable && currentHoldingEventMatchesSource(event, source));
  });
}
function gclMonitorMatchesCurrentHolding(monitor: GclPvPriceMonitorData, source: CurrentHoldingEventSource): boolean {
  const events = [...monitor.priceObservations, ...monitor.contextObservations].map((item) => item.sourceEvent);
  return events.length > 0 && events.every((event) => {
    const binding = event.holdingBinding;
    return binding.accountScopeId === source.accountScopeId && binding.snapshotId === source.snapshotId
      && binding.sourceAsOf === source.sourceAsOf && binding.positionSourceRowId === source.positionSourceRowId
      && source.positionSourceRowId.startsWith(`broker_import_batches:${binding.sourceBatchId}/`);
  });
}
function gclMonitorMatchesRequest(monitor: GclPvPriceMonitorData, request: Omit<CreateGclPvPriceMonitorRequest, "idempotencyKey">): boolean {
  const prices = monitor.priceObservations.map(({ normalizedCnyPerWatt: _, sourceEvent: __, ...item }) => item);
  const contexts = monitor.contextObservations.map(({ sourceEvent: _, ...item }) => item);
  const sorted = <T>(items: T[]): T[] => [...items].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  return canonicalJson(sorted(prices)) === canonicalJson(sorted(request.priceObservations))
    && canonicalJson(sorted(contexts)) === canonicalJson(sorted(request.contextObservations));
}
async function providerAuthorizationFingerprint(intent: DeepResearchTaskIntent): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(deepResearchProviderAuthorizationFingerprintInput(intent)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function clearNoBackupProviderConfirmation(documentRef: Document): void { const field = documentRef.getElementById("deep-cloud-ai-no-backup") as HTMLInputElement | null; if (field) field.checked = false; }
