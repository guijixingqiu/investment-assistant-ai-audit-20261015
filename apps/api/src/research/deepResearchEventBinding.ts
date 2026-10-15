import type {
  EvidenceBoundResearchFact,
  FrozenResearchEvidenceContext,
  ResearchEvidencePackData,
  ResearchMaterialData
} from "../../../../packages/contracts/src/deepResearch.js";
import type { DailyTechnicalEnvelope } from "../../../../packages/contracts/src/marketDaily.js";
import type { ResearchProviderValuationScenarioSetData, ResearchValuationScenarioSetData } from "../../../../packages/contracts/src/researchValuationScenarios.js";
import { FROZEN_RESEARCH_SOURCE_GAPS } from "../../../../packages/contracts/src/deepResearch.js";
import { researchEventBindsMaterial, type ResearchAnnouncementEventData } from "../../../../packages/contracts/src/researchEvent.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import type { GeelySalesMonitorData } from "../../../../packages/contracts/src/geelySalesMonitor.js";
import type { GclPvPriceMonitorData } from "../../../../packages/contracts/src/gclPvPriceMonitor.js";
import {
  researchContextContentHash,
  type ResearchContextSnapshotData
} from "../../../../packages/contracts/src/researchContext.js";

export interface CurrentFrozenResearchEvidence {
  actor: FrozenResearchEvidenceContext["actor"];
  membership: FrozenResearchEvidenceContext["membership"];
  materials: ResearchMaterialData[];
  valuationScenario: ResearchValuationScenarioSetData | null;
  valuationMethods?: ResearchValuationScenarioSetData[];
  fcffScenario?: FrozenResearchEvidenceContext["fcffScenario"] | null;
  providerScenario?: ResearchProviderValuationScenarioSetData | null;
  technical: DailyTechnicalEnvelope | null;
  weinstein?: FrozenResearchEvidenceContext["weinstein"];
  events: ResearchAnnouncementEventData[];
  operatingMonitor: GeelySalesMonitorData | GclPvPriceMonitorData | null;
  researchContext?: ResearchContextSnapshotData | null;
}

export function frozenResearchContextBinding(
  context: ResearchContextSnapshotData
): NonNullable<FrozenResearchEvidenceContext["researchContext"]> {
  return {
    id: context.id,
    membershipId: context.membershipId,
    membershipVersion: context.membershipVersion,
    selectedSymbol: context.selectedSymbol,
    cutoffAt: context.cutoffAt,
    validUntil: context.validUntil,
    contentHash: researchContextContentHash(context)
  };
}

export function frozenOperatingMonitorBinding(
  monitor: GeelySalesMonitorData | GclPvPriceMonitorData | null
): FrozenResearchEvidenceContext["operatingMonitor"] {
  return monitor ? {
    kind: monitor.symbol === "HK.03800" ? "gcl_pv_price" : "geely_sales",
    id: monitor.id,
    runVersion: monitor.runVersion,
    runFingerprint: monitor.runFingerprint
  } : null;
}

export function frozenResearchEventBinding(
  event: ResearchAnnouncementEventData
): NonNullable<FrozenResearchEvidenceContext["unboundSources"]["event"]> {
  return {
    status: "bound",
    value: "EVENT",
    eventId: event.id,
    eventVersion: event.eventVersion,
    eventFingerprint: event.eventFingerprint,
    materialId: event.source.materialId,
    evidenceId: event.source.evidenceId,
    keyVariable: event.keyVariable,
    hypothesisImpact: event.hypothesisImpact
  };
}

export function frozenResearchEventBindingFromContext(
  context: FrozenResearchEvidenceContext
): Record<string, unknown> | null {
  const binding = context.unboundSources.event;
  return binding.status === "bound" ? binding : null;
}

export function selectCurrentResearchEventBinding(
  events: ResearchAnnouncementEventData[],
  materials: ResearchMaterialData[],
  now: Date
): Record<string, unknown> | null {
  const materialById = new Map(materials.map((item) => [item.id, item]));
  const event = events
    .filter((candidate) => candidate.coverageScope === "research_stock"
      && candidate.source.freshness === "fresh"
      && candidate.source.revisionState === "current"
      && Date.parse(candidate.source.validUntil) > now.getTime())
    .filter((candidate) => {
      const material = materialById.get(candidate.source.materialId);
      return material !== undefined && researchEventBindsMaterial(candidate, material);
    })
    .sort((left, right) => right.eventVersion - left.eventVersion || Number(right.id) - Number(left.id))[0];
  return event ? frozenResearchEventBinding(event) : null;
}

export function frozenResearchEventChanged(
  context: FrozenResearchEvidenceContext,
  events: ResearchAnnouncementEventData[],
  materials: ResearchMaterialData[],
  now: Date
): boolean {
  return canonicalJson(frozenResearchEventBindingFromContext(context))
    !== canonicalJson(selectCurrentResearchEventBinding(events, materials, now));
}

export function frozenResearchEventFact(pack: ResearchEvidencePackData): EvidenceBoundResearchFact | null {
  const binding = pack.frozenResearchContext?.unboundSources.event;
  if (!binding || binding.status !== "bound") return null;
  const material = pack.items.find((item) => item.id === binding.materialId && item.evidenceId === binding.evidenceId);
  if (!material) throw new Error("frozen event binding does not match an exact frozen material");
  return {
    statement: `${material.title}: ${material.summary || material.contentText.slice(0, 400)}`,
    evidenceIds: [material.evidenceId],
    sourceKind: "material",
    claimType: material.claimType,
    stance: material.stance
  };
}

export function frozenResearchSourceGapUnknowns(
  context: FrozenResearchEvidenceContext,
  requested: EvidenceBoundResearchFact[]
): EvidenceBoundResearchFact[] {
  const preserved = requested.filter((item) => !FROZEN_RESEARCH_SOURCE_GAPS.some((key) =>
    item.statement.includes(`${key}=source_missing/UNKNOWN`)));
  const missing = FROZEN_RESEARCH_SOURCE_GAPS
    .filter((key) => context.unboundSources[key].status === "source_missing")
    .map((key) => ({
      statement: `${key}=source_missing/UNKNOWN`,
      evidenceIds: [],
      sourceKind: "source_missing" as const,
      claimType: "UNKNOWN" as const,
      stance: "UNKNOWN" as const
    }));
  return uniqueFacts([...preserved, ...missing]);
}

export function frozenResearchSourceGapUnknownStatements(context: FrozenResearchEvidenceContext): string[] {
  return FROZEN_RESEARCH_SOURCE_GAPS
    .filter((key) => context.unboundSources[key].status === "source_missing")
    .map((key) => `${key}=source_missing/UNKNOWN`);
}

export function frozenResearchReportSections(
  pack: ResearchEvidencePackData,
  context: FrozenResearchEvidenceContext,
  requestedEvents: EvidenceBoundResearchFact[],
  requestedUnknowns: EvidenceBoundResearchFact[]
): { eventsAndCatalysts: EvidenceBoundResearchFact[]; unknowns: EvidenceBoundResearchFact[] } {
  const eventFact = frozenResearchEventFact(pack);
  return {
    eventsAndCatalysts: uniqueFacts([...requestedEvents, ...(eventFact ? [eventFact] : [])]),
    unknowns: frozenResearchSourceGapUnknowns(context, requestedUnknowns)
  };
}

export function uniqueFacts(facts: EvidenceBoundResearchFact[]): EvidenceBoundResearchFact[] {
  const byIdentity = new Map<string, EvidenceBoundResearchFact>();
  for (const fact of facts) byIdentity.set(canonicalJson(fact), fact);
  return [...byIdentity.values()];
}
