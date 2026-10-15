import {
  type CreateResearchMaterialRequest,
  type DeepResearchWorkspaceEnvelope,
  type ResearchMaterialData
} from "../../../packages/contracts/src/deepResearch.js";
import type { CreateGeelySalesMonitorRequest } from "../../../packages/contracts/src/geelySalesMonitor.js";
import {
  GCL_PV_CONTEXT_METRICS,
  GCL_PV_STAGES,
  type CreateGclPvPriceMonitorRequest,
  type GclPvSourceEvent
} from "../../../packages/contracts/src/gclPvPriceMonitor.js";
import type { PortfolioDecisionContextEnvelope } from "../../../packages/contracts/src/portfolioDecisionContextBrowser.js";
import type { ResearchAnnouncementEventData, ResearchEventHoldingBinding } from "../../../packages/contracts/src/researchEvent.js";
import { OWNER_VERIFIED_HOLDING_LOGIC_SOURCE_TYPE } from "../../../packages/contracts/src/researchMaterial.js";
import { buildTodayResearchItems, type TodayResearchEnvelope } from "../../../packages/contracts/src/todayResearch.js";

type GeelyObservation = CreateGeelySalesMonitorRequest["observations"][number];
const GEELY_FIELDS = [
  "eventId", "entityId", "entityName", "entityRole", "entityLevel", "issuerId", "periodKind", "period",
  "metric", "propulsion", "geography", "channel", "definitionKey", "value"
] as const;
type GeelyObservationRowValues = Record<(typeof GEELY_FIELDS)[number], string>;
type GclPriceObservation = CreateGclPvPriceMonitorRequest["priceObservations"][number];
type GclContextObservation = CreateGclPvPriceMonitorRequest["contextObservations"][number];
const GCL_PRICE_FIELDS = [
  "eventId", "stage", "period", "productSpecification", "unit", "value", "conversionFactorToCnyPerWatt",
  "normalizationBasisKey", "normalizationRule", "definitionKey"
] as const;
const GCL_CONTEXT_FIELDS = ["eventId", "metric", "period", "productSpecification", "unit", "currency", "value", "definitionKey"] as const;
export type GclPriceRowValues = Record<(typeof GCL_PRICE_FIELDS)[number], string>;
export type GclContextRowValues = Record<(typeof GCL_CONTEXT_FIELDS)[number], string>;

export function input(documentRef: Document, id: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const value = documentRef.getElementById(id);
  if (!(value instanceof HTMLInputElement || value instanceof HTMLSelectElement || value instanceof HTMLTextAreaElement)) throw new Error(`Missing #${id}.`);
  return value;
}
export function required(documentRef: Document, id: string): string {
  const value = input(documentRef, id).value.trim();
  if (!value) throw new Error(`${id} is required.`);
  return value;
}
export function optional(documentRef: Document, id: string): string | null { return input(documentRef, id).value.trim() || null; }
export function instant(documentRef: Document, id: string): string {
  const value = required(documentRef, id);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${id} must be a valid date-time.`);
  return parsed.toISOString();
}
export function score(documentRef: Document, id: string): number | null {
  const value = input(documentRef, id).value;
  return value ? Number(value) : null;
}

export function materialFields(documentRef: Document): Omit<CreateResearchMaterialRequest, "membershipId" | "membershipVersion" | "idempotencyKey"> {
  return {
    title: required(documentRef, "deep-material-title"),
    contentText: required(documentRef, "deep-material-content"),
    sourceType: required(documentRef, "deep-material-source-type"),
    sourceUrl: optional(documentRef, "deep-material-source-url"),
    publishedAt: instant(documentRef, "deep-material-published-at"),
    claimType: input(documentRef, "deep-material-claim-type").value as CreateResearchMaterialRequest["claimType"],
    verificationStatus: input(documentRef, "deep-material-verification").value as CreateResearchMaterialRequest["verificationStatus"],
    rightsStatus: input(documentRef, "deep-material-rights").value as CreateResearchMaterialRequest["rightsStatus"],
    sourceVersion: required(documentRef, "deep-material-source-version"),
    replacesMaterialId: optional(documentRef, "deep-material-replaces-id"),
    validUntil: instant(documentRef, "deep-material-valid-until"),
    summary: required(documentRef, "deep-material-summary"),
    variableName: optional(documentRef, "deep-material-variable"),
    stance: input(documentRef, "deep-material-stance").value as CreateResearchMaterialRequest["stance"],
    reliability: score(documentRef, "deep-material-reliability"),
    materiality: score(documentRef, "deep-material-materiality"),
    isRead: (input(documentRef, "deep-material-read") as HTMLInputElement).checked
  };
}

export function eventMaterialEligible(value: ResearchMaterialData, coverageScope: "research_stock" | "current_holding" = "research_stock"): boolean {
  const holding = coverageScope === "current_holding";
  return holding === (value.sourceType === OWNER_VERIFIED_HOLDING_LOGIC_SOURCE_TYPE)
    && value.revisionState === "current" && value.freshness === "fresh" && value.verificationStatus === "verified"
    && value.claimType !== "model_inference" && ["user_provided", "authorized_public"].includes(value.rightsStatus)
    && Boolean(value.variableName) && (!holding || safeHttps(value.sourceUrl));
}

export type CurrentHoldingEventSource = Omit<ResearchEventHoldingBinding, "sourceBatchId">;
export function currentHoldingEventSource(portfolio: PortfolioDecisionContextEnvelope | null | undefined, symbol: string): CurrentHoldingEventSource | null {
  const position = portfolio?.positions.find((item) => item.symbol === symbol);
  return portfolio?.status === "available" && portfolio.accountScopeId && portfolio.portfolioSnapshotId && portfolio.sourceAsOf && position
    ? { accountScopeId: portfolio.accountScopeId, snapshotId: portfolio.portfolioSnapshotId, sourceAsOf: portfolio.sourceAsOf, positionSourceRowId: position.sourceRowId }
    : null;
}

export function currentHoldingEventMatchesSource(event: ResearchAnnouncementEventData, source: CurrentHoldingEventSource | null): boolean {
  const binding = event.holdingBinding;
  return Boolean(source && binding && event.coverageScope === "current_holding"
    && event.source.sourceType === OWNER_VERIFIED_HOLDING_LOGIC_SOURCE_TYPE
    && event.source.revisionState === "current" && event.source.freshness === "fresh"
    && event.source.verificationStatus === "verified" && ["user_provided", "authorized_public"].includes(event.source.rightsStatus)
    && binding.accountScopeId === source.accountScopeId && binding.snapshotId === source.snapshotId
    && binding.sourceAsOf === source.sourceAsOf && binding.positionSourceRowId === source.positionSourceRowId
    && source.positionSourceRowId.startsWith(`broker_import_batches:${binding.sourceBatchId}/`));
}

export function holdingEventRequiresToday(event: ResearchAnnouncementEventData): boolean {
  return ["high", "medium"].includes(event.importance) && ["supports", "weakens"].includes(event.hypothesisImpact);
}

export function todayHoldingEventMatches(today: TodayResearchEnvelope, event: ResearchAnnouncementEventData): boolean {
  const binding = event.holdingBinding;
  return Boolean(binding && today.status === "available" && today.items.some((item) => {
    const eventRef = item.bindings.eventRefs[0]; const holdingRef = item.bindings.holdingSnapshotRefs[0];
    return item.category === "holding_logic_change" && item.bindings.eventRefs.length === 1 && item.bindings.holdingSnapshotRefs.length === 1
      && eventRef.eventId === event.id && eventRef.eventVersion === event.eventVersion && eventRef.eventFingerprint === event.eventFingerprint
      && eventRef.coverageScope === event.coverageScope && eventRef.keyVariable === event.keyVariable && eventRef.hypothesisImpact === event.hypothesisImpact
      && holdingRef.accountScopeId === binding.accountScopeId && holdingRef.snapshotId === binding.snapshotId
      && holdingRef.sourceBatchId === binding.sourceBatchId && holdingRef.sourceAsOf === binding.sourceAsOf
      && holdingRef.positionSourceRowId === binding.positionSourceRowId;
  }));
}

function sameHoldingBinding(left: ResearchEventHoldingBinding, right: ResearchEventHoldingBinding): boolean {
  return left.accountScopeId === right.accountScopeId && left.snapshotId === right.snapshotId && left.sourceBatchId === right.sourceBatchId
    && left.sourceAsOf === right.sourceAsOf && left.positionSourceRowId === right.positionSourceRowId;
}

function gclSourceMatchesEvent(source: GclPvSourceEvent, event: ResearchAnnouncementEventData): boolean {
  return event.id === source.eventId && event.eventVersion === source.eventVersion && event.eventFingerprint === source.eventFingerprint
    && event.symbol === source.symbol && event.eventKind === source.eventKind && event.coverageScope === source.coverageScope
    && Boolean(event.holdingBinding && sameHoldingBinding(event.holdingBinding, source.holdingBinding))
    && event.keyVariable === source.keyVariable && event.hypothesisImpact === source.hypothesisImpact
    && event.source.materialId === source.materialId && event.source.contentFingerprint === source.materialFingerprint
    && event.source.sourceType === source.sourceType && event.source.sourceUrl === source.sourceUrl
    && event.source.publishedAt === source.publishedAt && event.source.capturedAt === source.capturedAt
    && event.source.validUntil === source.validUntil && event.source.rightsStatus === source.rightsStatus
    && event.source.verificationStatus === source.verificationStatus && event.source.sourceVersion === source.sourceVersion
    && event.source.revision === source.revision;
}

function safeHttps(value: string | null): boolean {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password; } catch { return false; }
}

export function geelySalesObservations(documentRef: Document): CreateGeelySalesMonitorRequest["observations"] {
  const host = documentRef.getElementById("deep-geely-observations");
  const rows = host ? [...host.querySelectorAll<HTMLElement>("[data-geely-observation]")] : [];
  if (rows.length === 0) throw new Error("Add at least one Geely sales observation.");
  return rows.map((row, index) => {
    const values = geelyObservationRowValues(row);
    const numericValue = Number(values.value);
    if (!values.value.trim() || !Number.isFinite(numericValue)) throw new Error(`Observation ${index + 1} requires a numeric value.`);
    return {
      eventId: requiredGeelyValue(values.eventId, index, "source event"),
      entityId: requiredGeelyValue(values.entityId, index, "entity ID"),
      entityName: requiredGeelyValue(values.entityName, index, "entity name"),
      entityRole: values.entityRole as GeelyObservation["entityRole"],
      entityLevel: values.entityLevel as GeelyObservation["entityLevel"],
      issuerId: values.entityRole === "industry" ? null : requiredGeelyValue(values.issuerId, index, "issuer ID"),
      periodKind: values.periodKind as GeelyObservation["periodKind"],
      period: requiredGeelyValue(values.period, index, "period"),
      metric: values.metric as GeelyObservation["metric"],
      propulsion: values.propulsion as GeelyObservation["propulsion"],
      geography: values.geography as GeelyObservation["geography"],
      channel: values.channel as GeelyObservation["channel"],
      unit: values.metric === "average_transaction_price" ? "CNY_per_vehicle" : "vehicles",
      definitionKey: requiredGeelyValue(values.definitionKey, index, "definition key"),
      value: numericValue
    };
  });
}

function requiredGeelyValue(value: string, index: number, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Observation ${index + 1} requires ${label}.`);
  return trimmed;
}

export function geelyObservationRowValues(row: HTMLElement): GeelyObservationRowValues {
  return Object.fromEntries(GEELY_FIELDS.map((name) => {
    const field = row.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-geely-field="${name}"]`);
    if (!field) throw new Error(`Missing Geely observation field ${name}.`);
    return [name, field.value];
  })) as GeelyObservationRowValues;
}

export function appendGeelyObservationRow(documentRef: Document, values: Partial<GeelyObservationRowValues>): void {
  const host = documentRef.getElementById("deep-geely-observations");
  const template = documentRef.getElementById("deep-geely-observation-template");
  const content = template && "content" in template ? (template as HTMLTemplateElement).content : null;
  const row = content?.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
  if (!host || !row) throw new Error("Geely observation editor is unavailable.");
  for (const [name, value] of Object.entries(values)) {
    const field = row.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-geely-field="${name}"]`);
    if (field && value !== undefined) field.value = value;
  }
  host.append(row);
}

export function resetGeelyObservationRows(documentRef: Document): void {
  documentRef.getElementById("deep-geely-observations")?.replaceChildren();
}

export function syncGeelyEventOptions(documentRef: Document, envelope: DeepResearchWorkspaceEnvelope): void {
  const list = documentRef.getElementById("deep-geely-events");
  if (!list || list.tagName !== "DATALIST") return;
  list.replaceChildren(...(envelope.data?.events ?? [])
    .filter((event) => event.coverageScope === "research_stock" && event.keyVariable === "new_energy_vehicle_sales")
    .map((event) => {
      const option = documentRef.createElement("option");
      option.value = event.id;
      option.label = `${event.symbol} · ${event.eventKind} · v${event.eventVersion}`;
      return option;
    }));
  const first = list.querySelector<HTMLOptionElement>("option")?.value ?? "";
  for (const row of documentRef.querySelectorAll<HTMLElement>("#deep-geely-observations [data-geely-observation]")) {
    const role = row.querySelector<HTMLSelectElement>('[data-geely-field="entityRole"]')?.value;
    const event = row.querySelector<HTMLInputElement>('[data-geely-field="eventId"]');
    if (role === "target" && event && !event.value) event.value = first;
  }
}

export function gclPriceObservations(documentRef: Document): CreateGclPvPriceMonitorRequest["priceObservations"] {
  const rows = [...(documentRef.getElementById("deep-gcl-prices")?.querySelectorAll<HTMLElement>("[data-gcl-price]") ?? [])];
  if (rows.length === 0) throw new Error("Add at least one GCL price observation.");
  return rows.map((row, index) => {
    const values = gclPriceRowValues(row);
    return {
      eventId: requiredGclValue(values.eventId, index, "source event"),
      stage: values.stage as GclPriceObservation["stage"],
      period: requiredGclValue(values.period, index, "period"),
      productSpecification: requiredGclValue(values.productSpecification, index, "product specification"),
      unit: values.unit as GclPriceObservation["unit"],
      currency: "CNY",
      value: gclNumber(values.value, index, "value", false),
      conversionFactorToCnyPerWatt: gclNumber(values.conversionFactorToCnyPerWatt, index, "conversion factor", false),
      normalizationBasisKey: requiredGclValue(values.normalizationBasisKey, index, "normalization basis"),
      normalizationRule: requiredGclValue(values.normalizationRule, index, "normalization rule"),
      definitionKey: requiredGclValue(values.definitionKey, index, "definition key")
    };
  });
}

export function gclContextObservations(documentRef: Document): CreateGclPvPriceMonitorRequest["contextObservations"] {
  const rows = [...(documentRef.getElementById("deep-gcl-contexts")?.querySelectorAll<HTMLElement>("[data-gcl-context]") ?? [])];
  return rows.map((row, index) => {
    const values = gclContextRowValues(row);
    return {
      eventId: requiredGclValue(values.eventId, index, "source event"),
      metric: values.metric as GclContextObservation["metric"],
      period: requiredGclValue(values.period, index, "period"),
      productSpecification: requiredGclValue(values.productSpecification, index, "product specification"),
      unit: values.unit as GclContextObservation["unit"],
      currency: values.currency === "" ? null : values.currency as GclContextObservation["currency"],
      value: gclNumber(values.value, index, "value", true),
      definitionKey: requiredGclValue(values.definitionKey, index, "definition key")
    };
  });
}

export function gclPriceRowValues(row: HTMLElement): GclPriceRowValues { return gclRowValues(row, GCL_PRICE_FIELDS) as GclPriceRowValues; }
export function gclContextRowValues(row: HTMLElement): GclContextRowValues { return gclRowValues(row, GCL_CONTEXT_FIELDS) as GclContextRowValues; }

export function appendGclPriceRow(documentRef: Document, values: Partial<GclPriceRowValues>): void {
  appendGclRow(documentRef, "deep-gcl-prices", "deep-gcl-price-template", values);
}

export function appendGclContextRow(documentRef: Document, values: Partial<GclContextRowValues>): void {
  appendGclRow(documentRef, "deep-gcl-contexts", "deep-gcl-context-template", values);
}

export function resetGclRows(documentRef: Document): void {
  documentRef.getElementById("deep-gcl-prices")?.replaceChildren();
  documentRef.getElementById("deep-gcl-contexts")?.replaceChildren();
}

export function syncGclEventOptions(documentRef: Document, envelope: DeepResearchWorkspaceEnvelope): void {
  const events = (envelope.data?.events ?? []).filter((event) => event.coverageScope === "current_holding"
    && ([...GCL_PV_STAGES.map((stage) => `${stage}_price`), ...GCL_PV_CONTEXT_METRICS] as string[]).includes(event.keyVariable));
  const list = documentRef.getElementById("deep-gcl-events");
  if (list?.tagName === "DATALIST") list.replaceChildren(...events.map((event) => {
    const option = documentRef.createElement("option");
    option.value = event.id;
    option.label = `${event.keyVariable} · v${event.eventVersion}`;
    return option;
  }));
  const byVariable = new Map(events.map((event) => [event.keyVariable, event.id]));
  for (const row of documentRef.querySelectorAll<HTMLElement>("#deep-gcl-prices [data-gcl-price]")) {
    const event = row.querySelector<HTMLInputElement>('[data-gcl-field="eventId"]');
    const stage = row.querySelector<HTMLSelectElement>('[data-gcl-field="stage"]')?.value;
    if (event && !event.value && stage) event.value = byVariable.get(`${stage}_price`) ?? "";
  }
  for (const row of documentRef.querySelectorAll<HTMLElement>("#deep-gcl-contexts [data-gcl-context]")) {
    const event = row.querySelector<HTMLInputElement>('[data-gcl-field="eventId"]');
    const metric = row.querySelector<HTMLSelectElement>('[data-gcl-field="metric"]')?.value;
    if (event && !event.value && metric) event.value = byVariable.get(metric) ?? "";
  }
}

function gclRowValues(row: HTMLElement, fields: readonly string[]): Record<string, string> {
  return Object.fromEntries(fields.map((name) => {
    const field = row.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-gcl-field="${name}"]`);
    if (!field) throw new Error(`Missing GCL observation field ${name}.`);
    return [name, field.value];
  }));
}

function appendGclRow(
  documentRef: Document,
  hostId: string,
  templateId: string,
  values: Partial<GclPriceRowValues> | Partial<GclContextRowValues>
): void {
  const host = documentRef.getElementById(hostId);
  const template = documentRef.getElementById(templateId);
  const content = template && "content" in template ? (template as HTMLTemplateElement).content : null;
  const row = content?.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
  if (!host || !row) throw new Error("GCL observation editor is unavailable.");
  for (const [name, value] of Object.entries(values)) {
    const field = row.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-gcl-field="${name}"]`);
    if (field && value !== undefined) field.value = value;
  }
  host.append(row);
}

function requiredGclValue(value: string, index: number, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`GCL row ${index + 1} requires ${label}.`);
  return trimmed;
}

function gclNumber(value: string, index: number, label: string, allowZero: boolean): number {
  const numeric = Number(value);
  if (!value.trim() || !Number.isFinite(numeric) || (allowZero ? numeric < 0 : numeric <= 0)) {
    throw new Error(`GCL row ${index + 1} requires a ${allowZero ? "non-negative" : "positive"} ${label}.`);
  }
  return numeric;
}

export function gclMonitorLines(value: NonNullable<DeepResearchWorkspaceEnvelope["data"]>["latestGclPvPriceMonitor"]): string[] {
  if (!value) return ["GCL PV prices: missing"];
  return [
    `GCL PV prices: run v${value.runVersion} ${value.period} · ${value.assessment.status} · trends=${value.assessment.trendConclusionAllowed} · spreads=${value.assessment.spreadConclusionAllowed}`,
    ...value.priceObservations.map((item) => `PV source ${item.stage} ${item.period}: ${item.value} ${item.unit} ${item.currency} · ${item.productSpecification} · normalized=${item.normalizedCnyPerWatt} CNY/W (${item.normalizationBasisKey}) · event ${item.sourceEvent.eventId} r${item.sourceEvent.revision} ${item.sourceEvent.rightsStatus} until ${item.sourceEvent.validUntil}`),
    ...value.contextObservations.map((item) => `PV context source ${item.metric} ${item.period}: ${item.value} ${item.unit}${item.currency ? ` ${item.currency}` : ""} · ${item.productSpecification} · event ${item.sourceEvent.eventId} r${item.sourceEvent.revision} ${item.sourceEvent.rightsStatus}`),
    ...value.assessment.priceTrends.map((item) => `PV ${item.id}: ${item.status} · ${item.percentChange ?? "unknown"}% · ${item.reason}`),
    ...value.assessment.spreads.map((item) => `PV ${item.id}: ${item.status} · ${item.currentCnyPerWatt ?? "unknown"} CNY/W · Δ${item.changeCnyPerWatt ?? "unknown"} · ${item.reason}`),
    ...value.assessment.context.map((item) => `PV context ${item.id}: ${item.status} · ${item.currentValue ?? "unknown"} ${item.unit ?? ""} · ${item.reason}`),
    ...Object.entries(value.assessment.impacts).map(([key, item]) => `PV impact ${key}: ${item.signal} · ${item.basis.join("; ") || "no deterministic basis"} · unknown=${item.unknowns.join("; ") || "none"}`)
  ];
}

export function todayMonitorBindingsMatchWorkspace(today: TodayResearchEnvelope, workspace: DeepResearchWorkspaceEnvelope): boolean {
  if (today.status !== "available" || !workspace.data) return false;
  const monitorKeys = (items: TodayResearchEnvelope["items"]): string[] => items.flatMap((item) => {
    const ref = item.bindings.monitorRef;
    return ref ? [`${ref.kind}:${ref.id}:${ref.runVersion}:${ref.runFingerprint}`] : [];
  }).sort();
  const expectedMonitorKeys = monitorKeys(buildTodayResearchItems(workspace.data, new Date(today.generatedAt)).items);
  const actualMonitorKeys = monitorKeys(today.items);
  if (expectedMonitorKeys.length !== actualMonitorKeys.length
    || expectedMonitorKeys.some((key, index) => key !== actualMonitorKeys[index])) return false;
  return today.items.every((item) => {
    const ref = item.bindings.monitorRef;
    const monitor = !ref ? null : ref.kind === "geely_sales" ? workspace.data?.latestGeelySalesMonitor : workspace.data?.latestGclPvPriceMonitor;
    const monitorMatches = !ref || Boolean(monitor && monitor.id === ref.id && monitor.runVersion === ref.runVersion && monitor.runFingerprint === ref.runFingerprint);
    const gclSources = ref?.kind === "gcl_pv_price" && workspace.data?.latestGclPvPriceMonitor
      ? [...workspace.data.latestGclPvPriceMonitor.priceObservations, ...workspace.data.latestGclPvPriceMonitor.contextObservations].map((row) => row.sourceEvent)
      : [];
    const uniqueGclSources = new Map<string, (typeof gclSources)[number]>();
    const conflictingGclSources = gclSources.some((source) => {
      const existing = uniqueGclSources.get(source.eventId);
      if (existing && JSON.stringify(existing) !== JSON.stringify(source)) return true;
      uniqueGclSources.set(source.eventId, source);
      return false;
    });
    const gclSourcesMatch = ref?.kind !== "gcl_pv_price" || !conflictingGclSources
      && item.bindings.eventRefs.length === uniqueGclSources.size && item.bindings.holdingSnapshotRefs.length === 1
      && [...uniqueGclSources.values()].every((source) => {
        const refs = item.bindings.eventRefs.filter((eventRef) => eventRef.eventId === source.eventId
          && eventRef.eventVersion === source.eventVersion && eventRef.eventFingerprint === source.eventFingerprint
          && eventRef.coverageScope === source.coverageScope && eventRef.keyVariable === source.keyVariable
          && eventRef.hypothesisImpact === source.hypothesisImpact);
        const sameIdEvents = workspace.data?.events.filter((event) => event.id === source.eventId) ?? [];
        const events = sameIdEvents.filter((event) => gclSourceMatchesEvent(source, event));
        return refs.length === 1 && sameIdEvents.length === 1 && events.length === 1
          && item.bindings.holdingSnapshotRefs.some((holding) => sameHoldingBinding(holding, source.holdingBinding));
      });
    const holdingEvents = item.bindings.eventRefs.filter((eventRef) => eventRef.coverageScope === "current_holding");
    const eventBindings = holdingEvents.map((eventRef) => {
      const event = workspace.data?.events.find((candidate) => candidate.id === eventRef.eventId);
      return event?.coverageScope === "current_holding" && event.eventVersion === eventRef.eventVersion && event.eventFingerprint === eventRef.eventFingerprint
        && event.keyVariable === eventRef.keyVariable && event.hypothesisImpact === eventRef.hypothesisImpact && event.holdingBinding
        ? event.holdingBinding : null;
    });
    return monitorMatches && gclSourcesMatch
      && eventBindings.every((binding) => binding && item.bindings.holdingSnapshotRefs.some((holding) => sameHoldingBinding(holding, binding)))
      && item.bindings.holdingSnapshotRefs.every((holding) => eventBindings.some((binding) => binding && sameHoldingBinding(holding, binding)));
  });
}
