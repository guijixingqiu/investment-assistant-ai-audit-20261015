import { isRfc3339DateTime } from "./factMetadata.js";
import { evidenceBoundReportPackBinding, validateEvidenceBoundReportPackBinding, type EvidenceBoundReportPackBinding, type ResearchEvidencePackData } from "./deepResearch.js";

export const LIMITED_RESEARCH_CONTEXT_VERSION = "2026-09-10.limited-research.v1";
export interface SelectedLimitedResearchMaterial {
  id: string;
  revision: number;
  contentFingerprint: string;
  sourceVersion: string;
  validUntil: string;
}
export interface FreezeLimitedResearchRequest {
  researchMode: "limited";
  membershipVersion: number;
  /** Absent only for pre-selection clients; new limited freezes bind an explicit set. */
  selectedMaterials?: SelectedLimitedResearchMaterial[];
  idempotencyKey: string;
}
export type LimitedResearchPackBinding = Pick<EvidenceBoundReportPackBinding,
  "id" | "version" | "fingerprint" | "membershipId" | "membershipVersion" | "symbol" | "frozenAt"> & {
    contextVersion: typeof LIMITED_RESEARCH_CONTEXT_VERSION;
  };
export type DeepResearchPackBinding = EvidenceBoundReportPackBinding | LimitedResearchPackBinding;

export function deepResearchPackBinding(pack: ResearchEvidencePackData): DeepResearchPackBinding {
  if (pack.researchMode !== "limited") return evidenceBoundReportPackBinding(pack);
  return { id: pack.id, version: pack.version, fingerprint: pack.packFingerprint,
    membershipId: pack.membershipId, membershipVersion: pack.membershipVersion, symbol: pack.symbol,
    frozenAt: pack.frozenAt, contextVersion: LIMITED_RESEARCH_CONTEXT_VERSION };
}
export function validateFreezeLimitedResearchRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  if (!record(value) || Object.keys(value).sort().join() !== (value.selectedMaterials === undefined
    ? "idempotencyKey,membershipVersion,researchMode" : "idempotencyKey,membershipVersion,researchMode,selectedMaterials")
    || value.researchMode !== "limited" || !Number.isSafeInteger(value.membershipVersion) || Number(value.membershipVersion) <= 0
    || typeof value.idempotencyKey !== "string" || !value.idempotencyKey.trim() || value.idempotencyKey.length > 200
    || value.selectedMaterials !== undefined && (!Array.isArray(value.selectedMaterials)
      || value.selectedMaterials.length < 1 || value.selectedMaterials.length > 100
      || !value.selectedMaterials.every(validSelectedMaterial)
      || new Set(value.selectedMaterials.map(item => item.id)).size !== value.selectedMaterials.length
      || value.selectedMaterials.some((item, index, all) => index > 0 && Number(all[index - 1]!.id) >= Number(item.id)))) {
    return { ok: false, errors: ["limited research freeze request is invalid"] };
  }
  return { ok: true };
}
function validSelectedMaterial(value: unknown): value is SelectedLimitedResearchMaterial {
  return record(value) && Object.keys(value).sort().join() === "contentFingerprint,id,revision,sourceVersion,validUntil"
    && typeof value.id === "string" && /^[1-9]\d*$/.test(value.id)
    && Number.isSafeInteger(value.revision) && Number(value.revision) > 0
    && typeof value.contentFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.contentFingerprint)
    && typeof value.sourceVersion === "string" && value.sourceVersion.length > 0 && value.sourceVersion.length <= 200
    && typeof value.validUntil === "string" && isRfc3339DateTime(value.validUntil)
    && Number.isFinite(Date.parse(value.validUntil));
}
export function validateDeepResearchPackBinding(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  if (!record(value) || value.contextVersion !== LIMITED_RESEARCH_CONTEXT_VERSION) return validateEvidenceBoundReportPackBinding(value);
  if (Object.keys(value).sort().join() !== "contextVersion,fingerprint,frozenAt,id,membershipId,membershipVersion,symbol,version"
    || typeof value.id !== "string" || !/^[1-9]\d*$/.test(value.id) || typeof value.membershipId !== "string" || !/^[1-9]\d*$/.test(value.membershipId)
    || !Number.isSafeInteger(value.version) || Number(value.version) < 1
    || !Number.isSafeInteger(value.membershipVersion) || Number(value.membershipVersion) < 1
    || typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint)
    || typeof value.symbol !== "string" || !/^HK\.\d{5}$/.test(value.symbol)
    || typeof value.frozenAt !== "string" || !isRfc3339DateTime(value.frozenAt) || !Number.isFinite(Date.parse(value.frozenAt))) {
    return { ok: false, errors: ["limited research pack binding is invalid"] };
  }
  return { ok: true };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function limitedResearchAdviceIsValid(advice: { direction?: string; priceRange?: string; researchPositionRange?: string }): boolean {
  return advice.direction === "wait_for_evidence" && advice.priceRange === "UNKNOWN" && advice.researchPositionRange === "UNKNOWN";
}
