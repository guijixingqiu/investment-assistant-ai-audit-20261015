import { canonicalJson } from "./decisionContextBrowser.js";
import { validateResearchProviderOperatingReference, type ResearchProviderOperatingReference } from "./researchProviderOperatingReference.js";
import { type ResearchProviderValuationScenarioSetData,
  validateProviderFcffScenarioSet } from "./researchValuationScenarios.js";
import type { ResearchProviderFcffScenarioSetData } from "./researchValuationFcff.js";
import { isRfc3339DateTime } from "./factMetadata.js";
import { sha256Hex } from "./sha256.js";
import {
  validateResearchEvidencePackData,
  type ResearchEvidencePackData
} from "./deepResearch.js";
import type { DeepResearchTaskEnvelope } from "./deepResearchTask.js";
import {
  RESEARCH_FUNDAMENTALS_EXPORT_VERSION,
  RESEARCH_FUNDAMENTALS_SCHEMA_VERSION,
  validateResearchFundamentalsExport,
  type ResearchFundamentalsExport
} from "./researchFundamentals.js";
import {
  researchContextContentHash,
  validateSelectedResearchContextItems,
  validateResearchContextSnapshotData,
  type ResearchContextSnapshotData,
  type ResearchContextNumericFact,
  type ResearchContextPeer
} from "./researchContext.js";
import {
  researchEventBindsMaterial,
  validateResearchAnnouncementEventData,
  type ResearchAnnouncementEventData
} from "./researchEvent.js";
import {
  validateGeelySalesMonitorData,
  type GeelySalesMonitorData,
  type GeelySalesSourceEvent
} from "./geelySalesMonitor.js";
import { validateGclPvPriceMonitorData, type GclPvPriceMonitorData } from "./gclPvPriceMonitor.js";
import { researchMonitorRuleErrors, type ResearchMonitorRule } from "./researchMonitorRule.js";
import { CLOUD_AI_PROVIDER_POLICY_VERSION, cloudAiModelPolicyMatches, type CloudAiPolicyVersion } from "./cloudAiPolicy.js";
export const DEEP_RESEARCH_SNAPSHOT_SCHEMA_VERSION = "2026-08-13.deep-research-snapshot.v2";
export interface DeepResearchProviderAuthorization {
  provider: "deepseek";
  model: "deepseek-flash" | "deepseek-v4-flash";
  policyVersion: CloudAiPolicyVersion;
  ownerConfirmed: boolean;
  confirmedIntentFingerprint: string;
}
export interface DeepResearchTaskIntent {
  researchQuestion: string;
  investmentHorizon: "long_term" | "medium_term" | "event_driven";
  cutoffAt: string;
  selectedMaterialIds: string[];
  selectedProviderScenarioIds?: string[];
  selectedProviderFcffScenarioIds?: string[];
  includeProviderOwnerContext?: true;
  selectedResearchContext?: {
    contextId: string;
    contentHash: string;
    selectedFactIds: string[];
    peerIds: string[];
    peerFactIds?: string[];
  };
  includedStructuredSections: Array<"fundamentals" | "research_context" | "events" | "operating_monitor">;
  priorReport: {
    id: string;
    version: number;
    evidencePackId: string;
    reportFingerprint: string;
  } | null;
  outputLanguage: "zh-Hans" | "en";
  fullTextPdfConsent: false;
  monitorRules?: ResearchMonitorRule[];
  maxOutputTokens?: 1000 | 2000 | 4000 | 8000;
  maxDurationSeconds?: 15 | 30 | 60;
  providerAuthorization?: DeepResearchProviderAuthorization;
}
export function deepResearchProviderAuthorization(
  ownerConfirmed = false
): DeepResearchProviderAuthorization {
  return {
    provider: "deepseek",
    model: "deepseek-flash",
    policyVersion: CLOUD_AI_PROVIDER_POLICY_VERSION,
    ownerConfirmed,
    confirmedIntentFingerprint: ""
  };
}
export function deepResearchProviderAuthorizationFingerprintInput(
  intent: DeepResearchTaskIntent
): unknown {
  const { providerAuthorization, ...sendIntent } = intent;
  return {
    ...sendIntent,
    provider: providerAuthorization?.provider ?? "deepseek",
    model: providerAuthorization?.model ?? "deepseek-v4-flash",
    policyVersion: providerAuthorization?.policyVersion ?? CLOUD_AI_PROVIDER_POLICY_VERSION
  };
}
export function deepResearchProviderAuthorizationIsConfirmed(
  intent: DeepResearchTaskIntent
): boolean {
  return intent.providerAuthorization?.policyVersion === CLOUD_AI_PROVIDER_POLICY_VERSION
    && intent.providerAuthorization?.ownerConfirmed === true
    && /^[a-f0-9]{64}$/.test(intent.providerAuthorization.confirmedIntentFingerprint)
    && validateDeepResearchProviderAuthorization(intent.providerAuthorization).ok;
}
export type DeepResearchSnapshotSafety = DeepResearchTaskEnvelope["safety"] & {
  providerInput: "selected_snapshot_only";
  mutatesOfficialPortfolio: false;
};
export type DeepResearchOperatingMonitorData = GeelySalesMonitorData | GclPvPriceMonitorData;
export interface DeepResearchPriorReportSummary {
  report: NonNullable<DeepResearchTaskIntent["priorReport"]>;
  cutoffAt: string;
  conclusion: string;
  keyDrivers: string[];
  invalidationConditions: string[];
  unknownItems: string[];
}
export interface DeepResearchSnapshotData {
  schemaVersion: typeof DEEP_RESEARCH_SNAPSHOT_SCHEMA_VERSION;
  snapshotId: string;
  cutoffAt: string;
  target: {
    membershipId: string;
    membershipVersion: number;
    symbol: string;
  };
  intent: DeepResearchTaskIntent;
  evidencePack: ResearchEvidencePackData;
  monitorRules?: ResearchMonitorRule[];
  events: ResearchAnnouncementEventData[];
  operatingMonitor: DeepResearchOperatingMonitorData | null;
  fundamentals: ResearchFundamentalsExport;
  researchContext: ResearchContextSnapshotData | null;
  selectedResearchContext?: {
    contextId: string;
    contentHash: string;
    membershipId: string;
    membershipVersion: number;
    selectedSymbol: string;
    cutoffAt: string;
    validUntil: string;
    selectedFacts: ResearchContextNumericFact[];
    peers: ResearchContextPeer[];
    peerFacts?: ResearchContextNumericFact[];
  };
  providerOperatingReference?: ResearchProviderOperatingReference;
  providerValuationScenarios?: ResearchProviderValuationScenarioSetData[];
  providerFcffScenarios?: ResearchProviderFcffScenarioSetData[];
  analysisContentVersion?: "2026-09-10.v1";
  priorReportSummary?: DeepResearchPriorReportSummary | null;
  safety: DeepResearchSnapshotSafety;
}

export interface DeepResearchSnapshotBinding {
  analysisContentVersion?: DeepResearchSnapshotData["analysisContentVersion"];
  schemaVersion: typeof DEEP_RESEARCH_SNAPSHOT_SCHEMA_VERSION;
  snapshotId: string;
  cutoffAt: string;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  evidencePackId: string;
  evidencePackVersion: number;
  evidencePackFingerprint: string;
}
export type DeepResearchSnapshotHashInput = Omit<DeepResearchSnapshotData, "snapshotId">;

export function deepResearchSnapshotSafety(): DeepResearchSnapshotSafety {
  return {
    advisoryOnly: true,
    providerInput: "selected_snapshot_only",
    createsOrder: false,
    createsTrade: false,
    mutatesCash: false,
    writesFee: false,
    mutatesPosition: false,
    callsBroker: false,
    mutatesOfficialPortfolio: false,
    productionWrite: false
  };
}

export function computeDeepResearchSnapshotId(input: DeepResearchSnapshotHashInput): string {
  return `deep-research-snapshot:${sha256Hex(canonicalJson(stableHashInput(input)))}`;
}

export function deepResearchSnapshotHashInput(snapshot: DeepResearchSnapshotData): DeepResearchSnapshotHashInput {
  const { snapshotId: _snapshotId, ...input } = snapshot;
  return input;
}
export function deepResearchSnapshotBindsCurrentSources(
  snapshot: DeepResearchSnapshotData,
  fundamentals: ResearchFundamentalsExport,
  researchContext: ResearchContextSnapshotData | null,
  events: ResearchAnnouncementEventData[],
  operatingMonitor: DeepResearchOperatingMonitorData | null, monitorRules: ResearchMonitorRule[]
): boolean {
  if (snapshot.monitorRules === undefined && monitorRules.length > 0) return false;
  const selectedOwnerContext = snapshot.providerOperatingReference?.ownerContext;
  if (selectedOwnerContext && (!researchContext || researchContext.currentness.status !== "current"
    || researchContext.id !== selectedOwnerContext.contextId
    || researchContextContentHash(researchContext) !== selectedOwnerContext.contextFingerprint)) return false;
  const selected = snapshot.selectedResearchContext;
  const selection = snapshot.intent.selectedResearchContext;
  if (selected && (!researchContext || researchContext.currentness.status !== "current"
    || !selection
    || selected.contextId !== researchContext.id
    || selected.contentHash !== researchContextContentHash(researchContext)
    || canonicalJson(selected.selectedFacts) !== canonicalJson(selection.selectedFactIds.map(id => researchContext.selectedFacts.find(item => item.id === id)))
    || canonicalJson(selected.peerFacts ?? []) !== canonicalJson((selection.peerFactIds ?? []).map(id => researchContext.peerFacts.find(item => item.id === id)))
    || canonicalJson(selected.peers) !== canonicalJson(selection.peerIds.map(id => researchContext.peers.find(item => item.id === id))))) return false;
  return snapshot.snapshotId === computeDeepResearchSnapshotId({
    ...deepResearchSnapshotHashInput(snapshot),
    fundamentals,
    researchContext: snapshot.evidencePack.researchMode === "limited" ? null : researchContext,
    events,
    operatingMonitor: snapshot.evidencePack.researchMode === "limited" ? null : operatingMonitor,
    ...(snapshot.monitorRules === undefined ? {} : { monitorRules })
  });
}

export function deepResearchSnapshotBinding(snapshot: DeepResearchSnapshotData): DeepResearchSnapshotBinding {
  return {
    ...(snapshot.analysisContentVersion ? { analysisContentVersion: snapshot.analysisContentVersion } : {}),
    schemaVersion: snapshot.schemaVersion,
    snapshotId: snapshot.snapshotId,
    cutoffAt: snapshot.cutoffAt,
    membershipId: snapshot.target.membershipId,
    membershipVersion: snapshot.target.membershipVersion,
    symbol: snapshot.target.symbol,
    evidencePackId: snapshot.evidencePack.id,
    evidencePackVersion: snapshot.evidencePack.version,
    evidencePackFingerprint: snapshot.evidencePack.packFingerprint
  };
}
export function validateDeepResearchSnapshotBinding(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["snapshot binding must be an object"] };
  exact(value, [
    "schemaVersion", "snapshotId", "cutoffAt", "membershipId", "membershipVersion",
    "symbol", "evidencePackId", "evidencePackVersion", "evidencePackFingerprint",
    ...(value.analysisContentVersion === undefined ? [] : ["analysisContentVersion"])
  ], "snapshotBinding", errors);
  if (value.analysisContentVersion !== undefined && value.analysisContentVersion !== "2026-09-10.v1") errors.push("snapshotBinding.analysisContentVersion is invalid");
  if (value.schemaVersion !== DEEP_RESEARCH_SNAPSHOT_SCHEMA_VERSION) errors.push("snapshotBinding.schemaVersion is invalid");
  if (!snapshotId(value.snapshotId)) errors.push("snapshotBinding.snapshotId is invalid");
  if (!instant(value.cutoffAt)) errors.push("snapshotBinding.cutoffAt is invalid");
  positiveId(value.membershipId, "snapshotBinding.membershipId", errors);
  positiveInteger(value.membershipVersion, "snapshotBinding.membershipVersion", errors);
  symbol(value.symbol, "snapshotBinding.symbol", errors);
  positiveId(value.evidencePackId, "snapshotBinding.evidencePackId", errors);
  positiveInteger(value.evidencePackVersion, "snapshotBinding.evidencePackVersion", errors);
  if (typeof value.evidencePackFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.evidencePackFingerprint)) errors.push("snapshotBinding.evidencePackFingerprint is invalid");
  return errors.length ? { ok: false, errors } : { ok: true };
}

// eslint-disable-next-line complexity -- the frozen task intent has one closed validation boundary.
export function validateDeepResearchTaskIntent(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["task intent must be an object"] };
  const fields = [
    "researchQuestion", "investmentHorizon", "cutoffAt", "selectedMaterialIds", "includedStructuredSections",
    "priorReport", "outputLanguage", "fullTextPdfConsent"
  ];
  if (value.maxOutputTokens !== undefined) fields.push("maxOutputTokens");
  if (value.maxDurationSeconds !== undefined) fields.push("maxDurationSeconds");
  if (value.providerAuthorization !== undefined) fields.push("providerAuthorization");
  if (value.monitorRules !== undefined) fields.push("monitorRules");
  if (value.selectedProviderScenarioIds !== undefined) fields.push("selectedProviderScenarioIds");
  if (value.selectedProviderFcffScenarioIds !== undefined) fields.push("selectedProviderFcffScenarioIds");
  if (value.includeProviderOwnerContext !== undefined) fields.push("includeProviderOwnerContext");
  if (value.selectedResearchContext !== undefined) fields.push("selectedResearchContext");
  exact(value, fields, "intent", errors);
  if (typeof value.researchQuestion !== "string" || value.researchQuestion.trim().length === 0
    || value.researchQuestion.length > 4000) errors.push("intent.researchQuestion must be a bounded non-empty string");
  if (!["long_term", "medium_term", "event_driven"].includes(String(value.investmentHorizon))) {
    errors.push("intent.investmentHorizon is invalid");
  }
  if (!instant(value.cutoffAt)) errors.push("intent.cutoffAt is invalid");
  const selectedMaterialIds = Array.isArray(value.selectedMaterialIds) ? value.selectedMaterialIds : null;
  if (!selectedMaterialIds || selectedMaterialIds.length > 1000
    || selectedMaterialIds.some((id) => typeof id !== "string" || !/^[1-9]\d*$/.test(id))
    || new Set(selectedMaterialIds).size !== selectedMaterialIds.length
    || [...selectedMaterialIds].sort((a, b) => Number(a) - Number(b)).some((id, index) => id !== selectedMaterialIds[index])) {
    errors.push("intent.selectedMaterialIds must be at most 1000 sorted unique positive ids");
  }
  const selectedProviderScenarioIds = value.selectedProviderScenarioIds;
  if (selectedProviderScenarioIds !== undefined && (!Array.isArray(selectedProviderScenarioIds)
    || selectedProviderScenarioIds.length > 2
    || selectedProviderScenarioIds.some((id: unknown) => typeof id !== "string" || !/^[1-9]\d*$/.test(id))
    || new Set(selectedProviderScenarioIds).size !== selectedProviderScenarioIds.length
    || [...selectedProviderScenarioIds].sort((a: string,b: string) => Number(a)-Number(b))
      .some((id: string,index: number) => id !== selectedProviderScenarioIds[index]))) {
    errors.push("intent.selectedProviderScenarioIds must be at most two sorted unique positive ids");
  }
  const fcffIds = value.selectedProviderFcffScenarioIds;
  if (fcffIds !== undefined && (!Array.isArray(fcffIds) || fcffIds.length > 1
    || fcffIds.some((id: unknown) => !positive(id))
    || new Set(fcffIds).size !== fcffIds.length))
    errors.push("intent.selectedProviderFcffScenarioIds must be at most one valid id");
  if (value.includeProviderOwnerContext !== undefined && value.includeProviderOwnerContext !== true)
    errors.push("intent.includeProviderOwnerContext must be an explicit true selection");
  if (value.selectedResearchContext !== undefined) {
    const selection = value.selectedResearchContext;
    if (!record(selection)) errors.push("intent.selectedResearchContext must be an object");
    else {
      exact(selection, ["contextId", "contentHash", "selectedFactIds", "peerIds",
        ...(selection.peerFactIds === undefined ? [] : ["peerFactIds"])], "intent.selectedResearchContext", errors);
      positiveId(selection.contextId, "intent.selectedResearchContext.contextId", errors);
      if (typeof selection.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(selection.contentHash)) errors.push("intent.selectedResearchContext.contentHash is invalid");
      for (const key of ["selectedFactIds", "peerIds", ...(selection.peerFactIds === undefined ? [] : ["peerFactIds" as const])] as const) {
        const ids = selection[key];
        if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => !positive(id))
          || new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && Number(ids[index - 1]) >= Number(id)))
          errors.push(`intent.selectedResearchContext.${key} must be sorted unique positive ids`);
      }
      if (Array.isArray(selection.selectedFactIds) && Array.isArray(selection.peerIds)
        && selection.selectedFactIds.length + selection.peerIds.length +
          (Array.isArray(selection.peerFactIds) ? selection.peerFactIds.length : 0) === 0)
        errors.push("intent.selectedResearchContext requires at least one selected item");
    }
  }
  const sections = ["fundamentals", "research_context", "events", "operating_monitor"];
  const includedStructuredSections = Array.isArray(value.includedStructuredSections) ? value.includedStructuredSections : null;
  if (!includedStructuredSections
    || includedStructuredSections.some((section) => !sections.includes(String(section)))
    || new Set(includedStructuredSections).size !== includedStructuredSections.length
    || sections.filter((section) => includedStructuredSections.includes(section)).some(
      (section, index) => section !== includedStructuredSections[index]
    )) {
    errors.push("intent.includedStructuredSections must be sorted and unique");
  }
  if (value.priorReport !== null) {
    if (!record(value.priorReport)) errors.push("intent.priorReport is invalid");
    else {
      exact(value.priorReport, ["id", "version", "evidencePackId", "reportFingerprint"], "intent.priorReport", errors);
      positiveId(value.priorReport.id, "intent.priorReport.id", errors);
      positiveInteger(value.priorReport.version, "intent.priorReport.version", errors);
      positiveId(value.priorReport.evidencePackId, "intent.priorReport.evidencePackId", errors);
      if (typeof value.priorReport.reportFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.priorReport.reportFingerprint)) {
        errors.push("intent.priorReport.reportFingerprint is invalid");
      }
    }
  }
  if (!["zh-Hans", "en"].includes(String(value.outputLanguage))) errors.push("intent.outputLanguage is invalid");
  if (value.fullTextPdfConsent !== false) errors.push("intent.fullTextPdfConsent must remain false");
  if ((value.maxOutputTokens === undefined) !== (value.maxDurationSeconds === undefined)) {
    errors.push("intent generation budget must be complete");
  }
  if (value.maxOutputTokens !== undefined && !(<unknown[]>[1000, 2000, 4000, 8000]).includes(value.maxOutputTokens)) {
    errors.push("intent.maxOutputTokens is invalid");
  }
  if (value.maxDurationSeconds !== undefined && !(<unknown[]>[15, 30, 60]).includes(value.maxDurationSeconds)) {
    errors.push("intent.maxDurationSeconds is invalid");
  }
  if (value.providerAuthorization !== undefined) {
    const authorization = validateDeepResearchProviderAuthorization(value.providerAuthorization);
    if (!authorization.ok) errors.push(...authorization.errors);
  }
  if (value.monitorRules !== undefined) errors.push(...researchMonitorRuleErrors(value.monitorRules, monitorRuleVariableNames(value.monitorRules)));
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateDeepResearchProviderAuthorization(
  value: unknown
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["intent.providerAuthorization must be an object"] };
  exact(value, [
    "provider", "model", "policyVersion", "ownerConfirmed", "confirmedIntentFingerprint"
  ], "intent.providerAuthorization", errors);
  if (value.provider !== "deepseek") errors.push("intent.providerAuthorization.provider is invalid");
  if (!cloudAiModelPolicyMatches(value.model, value.policyVersion)) errors.push("intent.providerAuthorization model/policy is invalid");
  if (typeof value.ownerConfirmed !== "boolean") errors.push("intent.providerAuthorization.ownerConfirmed is invalid");
  if (typeof value.confirmedIntentFingerprint !== "string"
    || (value.ownerConfirmed
      ? !/^[a-f0-9]{64}$/.test(value.confirmedIntentFingerprint)
      : value.confirmedIntentFingerprint !== "")) {
    errors.push("intent.providerAuthorization.confirmedIntentFingerprint is invalid");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// eslint-disable-next-line complexity -- flat validation preserves precise path-specific errors.
export function validateDeepResearchSnapshotData(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["snapshot must be an object"] };
  const materialRedacted = snapshotHasMaterialRedaction(value);
  exact(value, [
    "schemaVersion", "snapshotId", "cutoffAt", "target", "intent", "evidencePack", "events",
    "operatingMonitor", "fundamentals", "researchContext", "safety",
    ...(value.analysisContentVersion === undefined ? [] : ["analysisContentVersion"]),
    ...(value.priorReportSummary === undefined ? [] : ["priorReportSummary"]),
    ...(value.monitorRules === undefined ? [] : ["monitorRules"]),
    ...(value.providerValuationScenarios === undefined ? [] : ["providerValuationScenarios"]),
    ...(value.providerFcffScenarios === undefined ? [] : ["providerFcffScenarios"]),
    ...(value.providerOperatingReference === undefined ? [] : ["providerOperatingReference"]),
    ...(value.selectedResearchContext === undefined ? [] : ["selectedResearchContext"])
  ], "snapshot", errors);
  if (value.schemaVersion !== DEEP_RESEARCH_SNAPSHOT_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  if (!snapshotId(value.snapshotId)) errors.push("snapshotId is invalid");
  if (!instant(value.cutoffAt)) errors.push("cutoffAt is invalid");
  if (!record(value.target)) errors.push("target is invalid");
  else {
    exact(value.target, ["membershipId", "membershipVersion", "symbol"], "target", errors);
    positiveId(value.target.membershipId, "target.membershipId", errors);
    positiveInteger(value.target.membershipVersion, "target.membershipVersion", errors);
    symbol(value.target.symbol, "target.symbol", errors);
  }
  const intent = validateDeepResearchTaskIntent(value.intent);
  if (!intent.ok) errors.push(...intent.errors);
  validatePriorReportSummary(value, errors);
  const pack = validateResearchEvidencePackData(value.evidencePack);
  if (!pack.ok) errors.push(...pack.errors.map((error) => `evidencePack.${error}`));
  if (value.monitorRules !== undefined) errors.push(...researchMonitorRuleErrors(value.monitorRules, monitorRuleVariableNames(value.monitorRules)));
  if (record(value.intent) && canonicalJson(value.intent.monitorRules ?? []) !== canonicalJson(value.monitorRules ?? [])) errors.push("intent monitorRules must exactly match snapshot monitorRules");
  if (!Array.isArray(value.events)) errors.push("events must be an array");
  else value.events.forEach((event, index) => {
    const validation = validateResearchAnnouncementEventData(event);
    if (!validation.ok) errors.push(...validation.errors.map((error) => `events[${index}].${error}`));
  });
  if (value.operatingMonitor !== null) {
    const validation = record(value.operatingMonitor) && value.operatingMonitor.symbol === "HK.03800"
      ? validateGclPvPriceMonitorData(value.operatingMonitor)
      : validateGeelySalesMonitorData(value.operatingMonitor);
    if (!validation.ok) errors.push(...validation.errors.map((error) => `operatingMonitor.${error}`));
  }
  const limited = record(value.evidencePack) && value.evidencePack.researchMode === "limited";
  validateSelectedResearchContext(value, limited, materialRedacted, errors);
  if (!materialRedacted && record(value.intent) && value.intent.includeProviderOwnerContext === true
    && value.providerOperatingReference === undefined)
    errors.push("selected provider Owner context is missing from snapshot");
  if (value.providerOperatingReference !== undefined) {
    if (!limited) errors.push("provider operating reference requires limited research");
    const reference = validateResearchProviderOperatingReference(value.providerOperatingReference);
    if (!reference.ok) errors.push(...reference.errors.map(error => `providerOperatingReference.${error}`));
  }
  const frozenContext = record(value.evidencePack) && record(value.evidencePack.frozenResearchContext)
    ? value.evidencePack.frozenResearchContext : null;
  const fullProvider = frozenContext && Array.isArray(frozenContext.selectedValuationMethods)
    ? frozenContext.selectedValuationMethods.find((entry) => record(entry) && entry.basisKind === "provider") : null;
  if (value.providerValuationScenarios !== undefined) {
    if (!Array.isArray(value.providerValuationScenarios)
      || !record(value.intent) || (limited
        ? !Array.isArray(value.intent.selectedProviderScenarioIds)
          || canonicalJson(value.providerValuationScenarios.map((item: ResearchProviderValuationScenarioSetData) => item.id))
            !== canonicalJson(value.intent.selectedProviderScenarioIds)
        : !record(fullProvider) || value.providerValuationScenarios.length !== 1
          || canonicalJson(value.providerValuationScenarios[0]) !== canonicalJson(fullProvider.scenario)))
      errors.push("provider scenarios must exactly match selected frozen research source");
    else for (const scenario of value.providerValuationScenarios as ResearchProviderValuationScenarioSetData[]) {
      if (scenario.basisKind !== "provider" || !scenario.recomputable || scenario.scenarioState !== "current"
        || !record(value.target) || !record(value.intent) || !Array.isArray(value.intent.selectedMaterialIds)
        || scenario.membershipId !== value.target.membershipId || scenario.membershipVersionAtWrite !== value.target.membershipVersion
        || scenario.symbol !== value.target.symbol
        || !value.intent.selectedMaterialIds.includes(scenario.providerBasis.sourceMaterialId)
        || Date.parse(scenario.createdAt) > Date.parse(String(value.cutoffAt))) errors.push("provider scenario is not current and bound to selected source before cutoff");
    }
  } else if (fullProvider || record(value.intent) && Array.isArray(value.intent.selectedProviderScenarioIds)
    && value.intent.selectedProviderScenarioIds.length > 0) errors.push("selected provider scenarios are missing from snapshot");
  if (value.providerFcffScenarios !== undefined) {
    if (!limited || !Array.isArray(value.providerFcffScenarios)
      || !record(value.intent) || !Array.isArray(value.intent.selectedProviderFcffScenarioIds)
      || canonicalJson(value.providerFcffScenarios.map((item: ResearchProviderFcffScenarioSetData) => item.id))
        !== canonicalJson(value.intent.selectedProviderFcffScenarioIds))
      errors.push("selected provider FCFF scenarios do not match intent");
    else for (const scenario of value.providerFcffScenarios as ResearchProviderFcffScenarioSetData[]) {
      const scenarioErrors: string[] = [];
      validateProviderFcffScenarioSet(scenario, {
        membershipId: record(value.target) ? value.target.membershipId : null,
        symbol: record(value.target) ? value.target.symbol : null
      }, 0, scenarioErrors);
      if (scenarioErrors.length || !record(scenario) || !record(scenario.providerReference)) {
        errors.push("provider FCFF scenario is invalid"); continue;
      }
      const reference = scenario.providerReference;
      const ids = new Set(value.intent.selectedMaterialIds as string[]);
      if (!scenario.recomputable || scenario.scenarioState !== "current"
        || !record(value.target) || scenario.membershipId !== value.target.membershipId
        || scenario.membershipVersionAtWrite !== value.target.membershipVersion
        || scenario.symbol !== value.target.symbol || !ids.has(reference.materialId)
        || reference.shareReference !== null
          && (!ids.has(reference.shareReference.issuedMaterialId)
            || !ids.has(reference.shareReference.treasuryMaterialId))
        || !record(value.evidencePack) || !Array.isArray(value.evidencePack.items)
        || !value.evidencePack.items.some((item: ResearchEvidencePackData["items"][number]) =>
          item.id === reference.materialId && item.revision === reference.materialRevision
            && item.contentFingerprint === reference.materialFingerprint)
        || Date.parse(scenario.createdAt) > Date.parse(String(value.cutoffAt)))
        errors.push("provider FCFF scenario is not current or bound to selected originals");
    }
  } else if (record(value.intent) && Array.isArray(value.intent.selectedProviderFcffScenarioIds)
    && value.intent.selectedProviderFcffScenarioIds.length > 0)
    errors.push("selected provider FCFF scenario is missing from snapshot");
  const fundamentals = validateResearchFundamentalsExport(value.fundamentals, limited);
  if (!fundamentals.ok) errors.push(...fundamentals.errors.map((error) => `fundamentals.${error}`));
  if (limited) {
    if (value.researchContext !== null || value.operatingMonitor !== null) errors.push("limited research must not imply frozen structured context");
    if (record(value.intent) && Array.isArray(value.intent.selectedMaterialIds)
      && value.intent.selectedMaterialIds.length === 0) errors.push("limited research requires explicit material selection");
    if (record(value.evidencePack) && value.evidencePack.materialSelectionMode === "explicit"
      && record(value.intent) && Array.isArray(value.intent.selectedMaterialIds)
      && Array.isArray(value.evidencePack.items)
      && canonicalJson(value.intent.selectedMaterialIds) !== canonicalJson(
        value.evidencePack.items.map((item: ResearchEvidencePackData["items"][number]) => item.id)
          .sort((a: string,b: string) => Number(a)-Number(b))))
      errors.push("explicit limited snapshot must select exactly its frozen materials");
  } else {
    const context = validateResearchContextSnapshotData(value.researchContext);
    if (!context.ok) errors.push(...context.errors.map((error) => `researchContext.${error}`));
  }
  validateSafety(value.safety, errors);
  if (record(value.target) && record(value.evidencePack) && record(value.fundamentals)) {
    const target = value.target;
    const packItems = Array.isArray(value.evidencePack.items)
      ? value.evidencePack.items as unknown as ResearchEvidencePackData["items"]
      : null;
    for (const [label, membershipId, membershipVersion, selectedSymbol] of [
      ["evidencePack", value.evidencePack.membershipId, value.evidencePack.membershipVersion, value.evidencePack.symbol],
      ["fundamentals", value.fundamentals.membershipId, value.fundamentals.membershipVersion, value.fundamentals.symbol],
      ...(record(value.researchContext) ? [["researchContext", value.researchContext.membershipId, value.researchContext.membershipVersion, value.researchContext.selectedSymbol]] : [])
    ] as const) {
      if (membershipId !== target.membershipId || membershipVersion !== target.membershipVersion || selectedSymbol !== target.symbol) {
        errors.push(`${label} does not match target identity`);
      }
    }
    if (value.evidencePack.currentness && record(value.evidencePack.currentness)
      && value.evidencePack.currentness.status !== "current" && !materialRedacted) errors.push("evidencePack must be current");
    if (!limited && value.evidencePack.frozenResearchContext === null) errors.push("evidencePack requires frozen valuation and technical context");
    if (value.evidencePack.frozenAt !== value.cutoffAt) errors.push("cutoffAt must equal evidencePack.frozenAt");
    if (record(value.intent) && packItems) {
      if (value.intent.cutoffAt !== value.cutoffAt) errors.push("intent cutoff must equal snapshot cutoff");
      const materialIds = new Set(packItems.map((item) => item.id));
      if (Array.isArray(value.intent.selectedMaterialIds)
        && value.intent.selectedMaterialIds.some((id) => !materialIds.has(String(id)))) {
        errors.push("intent selects a material outside the evidence pack");
      }
      if (!materialRedacted && value.providerOperatingReference !== undefined)
        validateSelectedProviderOperatingReference(value.providerOperatingReference, value.intent, packItems,
          target, value.cutoffAt, errors);
    }
    if (Array.isArray(value.events)) value.events.forEach((event, index) => {
      if (!record(event) || event.membershipId !== target.membershipId || event.membershipVersion !== target.membershipVersion
        || event.symbol !== target.symbol || event.coverageScope !== "research_stock") {
        errors.push(`events[${index}] does not match the research-stock target`);
      } else if (!packItems || !packItems.some((material) =>
        researchEventBindsMaterial(event as unknown as ResearchAnnouncementEventData, material))) {
        errors.push(`events[${index}] does not bind an evidence-pack material`);
      }
      if (record(event) && !beforeOrEqual(event.createdAt, value.cutoffAt)) errors.push(`events[${index}] exceeds snapshot cutoff`);
    });
    if (record(value.operatingMonitor) && (value.operatingMonitor.membershipId !== target.membershipId
      || value.operatingMonitor.membershipVersion !== target.membershipVersion || value.operatingMonitor.symbol !== target.symbol)) {
      errors.push("operatingMonitor does not match target identity");
    }
    if (record(value.operatingMonitor) && Array.isArray(value.events)
      && !operatingMonitorBindsSnapshotEvents(
        value.operatingMonitor as unknown as DeepResearchOperatingMonitorData,
        value.events as ResearchAnnouncementEventData[]
      )) {
      errors.push("operatingMonitor contains a source event outside the selected research-stock events");
    }
    if (record(value.operatingMonitor) && !beforeOrEqual(value.operatingMonitor.createdAt, value.cutoffAt)) {
      errors.push("operatingMonitor exceeds snapshot cutoff");
    }
    if (record(value.researchContext) && value.researchContext.currentness && record(value.researchContext.currentness)
      && value.researchContext.currentness.status !== "current") errors.push("researchContext must be current");
    if (!(limited && value.fundamentals.dataCutoffAt === null && Array.isArray(value.fundamentals.facts) && value.fundamentals.facts.length === 0) && !beforeOrEqual(value.fundamentals.dataCutoffAt, value.cutoffAt)) errors.push("fundamentals data cutoff exceeds snapshot cutoff");
    if (Array.isArray(value.fundamentals.facts) && value.fundamentals.facts.some((fact) =>
      !record(fact) || !beforeOrEqual(fact.dataCutoffAt, value.cutoffAt)
        || !record(fact.source) || !instant(fact.source.validUntil)
        || Date.parse(fact.source.validUntil) <= Date.parse(String(value.cutoffAt)))) {
      errors.push("fundamental fact is later than or not current at snapshot cutoff");
    }
    if (record(value.researchContext)) {
      if (!beforeOrEqual(value.researchContext.cutoffAt, value.cutoffAt)) errors.push("research context cutoff exceeds snapshot cutoff");
      const contextSources = [
        value.researchContext,
        ...(Array.isArray(value.researchContext.selectedFacts) ? value.researchContext.selectedFacts : []),
        ...(Array.isArray(value.researchContext.peerFacts) ? value.researchContext.peerFacts : []),
        ...(value.analysisContentVersion && Array.isArray(value.researchContext.operatingKpis) ? value.researchContext.operatingKpis : []),
        ...(Array.isArray(value.researchContext.macroDrivers) ? value.researchContext.macroDrivers : []),
        ...(Array.isArray(value.researchContext.industryDrivers) ? value.researchContext.industryDrivers : [])
      ];
      if (contextSources.some((source) => !record(source)
        || !beforeOrEqual(source.asOf, value.cutoffAt)
        || !beforeOrEqual(source.cutoffAt, value.cutoffAt)
        || !record(source.provenance)
        || !beforeOrEqual(source.provenance.capturedAt, value.cutoffAt))) {
        errors.push("research context contains a source later than the snapshot cutoff");
      }
    }
  }
  if (errors.length === 0) {
    const snapshot = value as unknown as DeepResearchSnapshotData;
    if (!materialRedacted && snapshot.snapshotId !== computeDeepResearchSnapshotId(deepResearchSnapshotHashInput(snapshot))) {
      errors.push("snapshotId does not match canonical content");
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function validateSelectedResearchContext(value: Record<string, unknown>, limited: boolean,
  materialRedacted: boolean, errors: string[]): void {
  const taskIntent = record(value.intent) ? value.intent : null;
  const intent = taskIntent?.selectedResearchContext;
  const selected = value.selectedResearchContext;
  if (selected === undefined) {
    if (intent !== undefined && !materialRedacted) errors.push("selected research context is missing from snapshot");
    return;
  }
  if (!limited || !record(selected) || !record(intent) || !record(value.target)
    || !Array.isArray(selected.selectedFacts) || !Array.isArray(selected.peers)
    || selected.peerFacts !== undefined && !Array.isArray(selected.peerFacts)) {
    errors.push("selected research context requires limited research and explicit item selection"); return;
  }
  exact(selected, ["contextId", "contentHash", "membershipId", "membershipVersion", "selectedSymbol",
    "cutoffAt", "validUntil", "selectedFacts", "peers",
    ...(selected.peerFacts === undefined ? [] : ["peerFacts"])], "selectedResearchContext", errors);
  if (selected.contextId !== intent.contextId || selected.contentHash !== intent.contentHash
    || selected.membershipId !== value.target.membershipId
    || selected.membershipVersion !== value.target.membershipVersion
    || selected.selectedSymbol !== value.target.symbol
    || !beforeOrEqual(selected.cutoffAt, value.cutoffAt)
    || !instant(selected.validUntil) || Date.parse(selected.validUntil) <= Date.parse(String(value.cutoffAt)))
    errors.push("selected research context identity or cutoff differs");
  if (!Array.isArray(taskIntent?.includedStructuredSections)
    || !taskIntent.includedStructuredSections.includes("research_context"))
    errors.push("selected research context requires research_context send section");
  if (canonicalJson(selected.selectedFacts.map((item: unknown) => record(item) ? item.id : null))
    !== canonicalJson(intent.selectedFactIds)
    || canonicalJson(selected.peers.map((item: unknown) => record(item) ? item.id : null)) !== canonicalJson(intent.peerIds))
    errors.push("selected research context item ids differ from explicit selection");
  if (canonicalJson(Array.isArray(selected.peerFacts) ? selected.peerFacts.map((item: unknown) => record(item) ? item.id : null) : [])
    !== canonicalJson(intent.peerFactIds ?? [])) errors.push("selected peer fact ids differ from explicit selection");
  const items = validateSelectedResearchContextItems(selected.selectedFacts, selected.peers,
    selected.selectedSymbol, selected.cutoffAt, selected.peerFacts);
  if (!items.ok) errors.push(...items.errors.map(error => `selectedResearchContext.${error}`));
  for (const item of [...selected.selectedFacts, ...(Array.isArray(selected.peerFacts) ? selected.peerFacts : []), ...selected.peers]) {
    if (!record(item) || !beforeOrEqual(item.asOf, value.cutoffAt)
      || !beforeOrEqual(item.cutoffAt, value.cutoffAt)
      || !record(item.provenance) || !beforeOrEqual(item.provenance.capturedAt, value.cutoffAt)
      || !instant(item.validUntil) || Date.parse(item.validUntil) <= Date.parse(String(value.cutoffAt)))
      errors.push("selected research context item is outside cutoff or expiry");
  }
}

function validateSelectedProviderOperatingReference(value: unknown, intent: Record<string, unknown>,
  items: ResearchEvidencePackData["items"], target: Record<string, unknown>, cutoffAt: unknown,
  errors: string[]): void {
  if (!record(value) || !Array.isArray(value.periods) || !Array.isArray(intent.selectedMaterialIds)) return;
  if (value.membershipId !== target.membershipId || value.membershipVersion !== target.membershipVersion
    || value.symbol !== target.symbol) errors.push("provider operating reference target identity differs");
  const selected = new Set(intent.selectedMaterialIds);
  const selectedProvider = items.filter(item => selected.has(item.id) && item.futuFinancialSource);
  const matched = new Set<string>();
  for (const period of value.periods) {
    if (!record(period) || !Array.isArray(period.materialMatches) || period.materialMatches.length !== 1) {
      errors.push("provider operating period requires one explicitly selected material"); continue;
    }
    const match = period.materialMatches[0] as { id?: string; revision?: number; contentFingerprint?: string; sourceVersion?: string };
    const material = selectedProvider.find(item => item.id === match.id);
    const source = material?.futuFinancialSource;
    if (!material || !source || matched.has(material.id)
      || match.revision !== material.revision || match.contentFingerprint !== material.contentFingerprint
      || match.sourceVersion !== material.sourceVersion || period.captureId !== source.captureId
      || period.financialType !== source.financialType || period.periodEnd !== source.periodEnd
      || period.sourceFingerprint !== source.sourceFingerprint || !Array.isArray(period.values)
      || period.values.length !== source.rows.length
      || period.values.some((value: unknown) => {
        if (!record(value) || !record(value.source)) return true;
        const original = value.source;
        return !source.pages.some(page => page.pageId === original.pageId
          && page.rawSha256 === original.rawSha256
          && page.reportSha256 === original.reportSha256);
      })) {
      errors.push("provider operating period does not bind selected saved material and original");
    } else matched.add(material.id);
  }
  if (matched.size !== selectedProvider.length) errors.push("selected OpenD materials do not match provider operating periods");
  if (intent.includeProviderOwnerContext === true) {
    if (!record(value.ownerContext) || !instant(value.ownerContext.cutoffAt)
      || !beforeOrEqual(value.ownerContext.cutoffAt, cutoffAt))
      errors.push("selected Owner context is unavailable or exceeds snapshot cutoff");
  } else if (value.ownerContext !== null) {
    errors.push("Owner context was included without explicit selection");
  }
}

function snapshotHasMaterialRedaction(value: Record<string, unknown>): boolean {
  if (!record(value.evidencePack) || !Array.isArray(value.evidencePack.items)
    || !record(value.evidencePack.currentness)) return false;
  const reasons = value.evidencePack.currentness.invalidatedBy;
  return value.evidencePack.items.some((item) => record(item) && item.sourceType === "deleted")
    && value.evidencePack.currentness.status === "historical"
    && Array.isArray(reasons) && reasons.includes("material_set_changed");
}

function validatePriorReportSummary(snapshot: Record<string, unknown>, errors: string[]): void {
  if (snapshot.analysisContentVersion === undefined && snapshot.priorReportSummary === undefined) return;
  if (snapshot.analysisContentVersion !== "2026-09-10.v1") errors.push("analysisContentVersion is invalid");
  const summary = snapshot.priorReportSummary;
  const prior = record(snapshot.intent) ? snapshot.intent.priorReport : null;
  if (summary === null && prior === null) return;
  if (!record(summary) || !record(prior)) {
    errors.push("priorReportSummary must match the selected prior report");
    return;
  }
  exact(summary, ["report", "cutoffAt", "conclusion", "keyDrivers", "invalidationConditions", "unknownItems"], "priorReportSummary", errors);
  if (canonicalJson(summary.report) !== canonicalJson(prior)) errors.push("priorReportSummary identity does not match intent");
  if (!beforeOrEqual(summary.cutoffAt, snapshot.cutoffAt)) errors.push("priorReportSummary exceeds snapshot cutoff");
  const boundedText = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= 4000;
  if (!boundedText(summary.conclusion)) errors.push("priorReportSummary conclusion is invalid");
  for (const key of ["keyDrivers", "invalidationConditions", "unknownItems"]) {
    const values = summary[key];
    if (!Array.isArray(values) || values.length > 5 || !values.every(boundedText)) errors.push(`priorReportSummary.${key} is invalid`);
  }
}

export function geelySalesMonitorBindsResearchEvents(
  monitor: GeelySalesMonitorData,
  events: ResearchAnnouncementEventData[]
): boolean {
  const byId = new Map(events.map((event) => [event.id, event]));
  return monitor.observations.every((observation) => {
    // ponytail: peer and industry sources stay inside the content-addressed monitor;
    // only target events belong to this membership's evidence pack and event layer.
    if (observation.entityRole !== "target") return true;
    const event = byId.get(observation.eventId);
    return event !== undefined
      && event.coverageScope === "research_stock"
      && canonicalJson(observation.sourceEvent) === canonicalJson(monitorSourceEvent(event));
  });
}

export function operatingMonitorBindsSnapshotEvents(
  monitor: DeepResearchOperatingMonitorData,
  events: ResearchAnnouncementEventData[]
): boolean {
  // GCL current-holding source events remain content-addressed inside the monitor;
  // the snapshot event lane intentionally contains research-stock events only.
  return monitor.symbol === "HK.03800" || geelySalesMonitorBindsResearchEvents(monitor, events);
}

function monitorSourceEvent(event: ResearchAnnouncementEventData): GeelySalesSourceEvent {
  return {
    eventId: event.id,
    eventVersion: event.eventVersion,
    eventFingerprint: event.eventFingerprint,
    symbol: event.symbol,
    eventKind: event.eventKind,
    materialId: event.source.materialId,
    materialFingerprint: event.source.contentFingerprint,
    sourceType: event.source.sourceType,
    sourceUrl: event.source.sourceUrl,
    publishedAt: event.source.publishedAt,
    capturedAt: event.source.capturedAt,
    validUntil: event.source.validUntil,
    rightsStatus: event.source.rightsStatus as GeelySalesSourceEvent["rightsStatus"],
    verificationStatus: "verified",
    sourceVersion: event.source.sourceVersion,
    revision: event.source.revision,
    keyVariable: event.keyVariable,
    hypothesisImpact: event.hypothesisImpact
  };
}

function stableHashInput(input: DeepResearchSnapshotHashInput): unknown {
  const { generatedAt: _generatedAt, ...fundamentals } = input.fundamentals;
  return { ...input, fundamentals };
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("safety is invalid"); return; }
  const expected = deepResearchSnapshotSafety();
  exact(value, Object.keys(expected), "safety", errors);
  for (const [key, expectedValue] of Object.entries(expected)) if (value[key] !== expectedValue) errors.push(`safety.${key} is invalid`);
}

function exact(value: Record<string, unknown>, expected: string[], label: string, errors: string[]): void {
  const actual = Object.keys(value).sort(); const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) errors.push(`${label} has unexpected or missing keys`);
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function monitorRuleVariableNames(value: unknown): unknown[] { return Array.isArray(value) ? value.filter(record).map((rule) => rule.variableName) : []; }
function instant(value: unknown): value is string { return typeof value === "string" && isRfc3339DateTime(value) && Number.isFinite(Date.parse(value)); }
function isoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function positive(value: unknown): value is string { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function positiveId(value: unknown, label: string, errors: string[]): void { if (!positive(value)) errors.push(`${label} is invalid`); }
function positiveIntegerOk(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }
function positiveInteger(value: unknown, label: string, errors: string[]): void { if (!positiveIntegerOk(value)) errors.push(`${label} is invalid`); }
function symbolOk(value: unknown): value is string { return typeof value === "string" && /^HK\.\d{5}$/.test(value); }
function symbol(value: unknown, label: string, errors: string[]): void { if (!symbolOk(value)) errors.push(`${label} is invalid`); }
function snapshotId(value: unknown): value is string { return typeof value === "string" && /^deep-research-snapshot:[a-f0-9]{64}$/.test(value); }
function beforeOrEqual(value: unknown, cutoff: unknown): boolean { return instant(value) && instant(cutoff) && Date.parse(value) <= Date.parse(cutoff); }
