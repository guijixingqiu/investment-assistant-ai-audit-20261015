import type { ResearchAnnouncementEventData } from "./researchEvent.js";

export type FrozenResearchSourceGap =
  | { status: "source_missing"; value: "UNKNOWN" }
  | {
      status: "bound";
      value: "EVENT";
      eventId: string;
      eventVersion: number;
      eventFingerprint: string;
      materialId: string;
      evidenceId: string;
      keyVariable: string;
      hypothesisImpact: ResearchAnnouncementEventData["hypothesisImpact"];
    };

export function validFrozenSourceGap(value: unknown, key: string): value is FrozenResearchSourceGap {
  if (!record(value)) return false;
  if (value.status === "source_missing") {
    return value.value === "UNKNOWN" && Object.keys(value).sort().join(",") === "status,value";
  }
  const keys = "eventFingerprint,eventId,eventVersion,evidenceId,hypothesisImpact,keyVariable,materialId,status,value";
  return key === "event" && value.status === "bound" && value.value === "EVENT"
    && Object.keys(value).sort().join(",") === keys
    && positive(value.eventId) && Number.isSafeInteger(value.eventVersion) && Number(value.eventVersion) > 0
    && sha(value.eventFingerprint) && positive(value.materialId) && positive(value.evidenceId)
    && nonEmpty(value.keyVariable) && ["supports", "weakens", "unknown"].includes(String(value.hypothesisImpact));
}

function positive(value: unknown): boolean { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function nonEmpty(value: unknown): boolean { return typeof value === "string" && value.trim().length > 0; }
function sha(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
