export const RESEARCH_SOURCE_SNAPSHOT_EXTRACTION_VERSION = "parse5-visible-nfc-v1" as const;
export const RESEARCH_SOURCE_SNAPSHOT_OFFSET_UNIT = "utf16_code_unit" as const;

export interface CaptureResearchSourceSnapshotRequest {
  membershipVersion: number;
  url: string;
  idempotencyKey: string;
}

export interface ConfirmResearchSourceSnapshotMaterialRequest {
  membershipVersion: number;
  startUtf16: number;
  endUtf16: number;
  validUntil: string;
  ownerConfirmed: true;
  replacesMaterialId?: string | null;
  idempotencyKey: string;
}

export interface ResearchSourceSnapshotData {
  id: string;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  sourceCategory: "issuer_public_html";
  canonicalUrl: string;
  responseUrl: string;
  publisher: string;
  publishedAt: string | null;
  capturedAt: string;
  mediaType: "text/html";
  rawSha256: string;
  byteLength: number;
  normalizedText: string;
  textSha256: string;
  extractionVersion: typeof RESEARCH_SOURCE_SNAPSHOT_EXTRACTION_VERSION;
  offsetUnit: typeof RESEARCH_SOURCE_SNAPSHOT_OFFSET_UNIT;
  summary: string;
  reviewState: "unconfirmed" | "current" | "pending_review" | "historical";
  rawChangeOnly: boolean;
}

export type ResearchSourceSnapshotListItem = Omit<ResearchSourceSnapshotData, "normalizedText">;

export function validCaptureResearchSourceSnapshotRequest(value: unknown): value is CaptureResearchSourceSnapshotRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return Object.keys(r).sort().join() === ["membershipVersion", "url", "idempotencyKey"].sort().join()
    && Number.isSafeInteger(r.membershipVersion) && Number(r.membershipVersion) > 0
    && typeof r.url === "string" && r.url.length > 0 && r.url.length <= 2000
    && typeof r.idempotencyKey === "string" && r.idempotencyKey.length > 0 && r.idempotencyKey.length <= 200;
}

export function validConfirmResearchSourceSnapshotMaterialRequest(value: unknown): value is ConfirmResearchSourceSnapshotMaterialRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return Object.keys(r).every(key => ["membershipVersion", "startUtf16", "endUtf16", "validUntil", "ownerConfirmed", "replacesMaterialId", "idempotencyKey"].includes(key))
    && Number.isSafeInteger(r.membershipVersion) && Number(r.membershipVersion) > 0
    && Number.isSafeInteger(r.startUtf16) && Number(r.startUtf16) >= 0
    && Number.isSafeInteger(r.endUtf16) && Number(r.endUtf16) > Number(r.startUtf16)
    && typeof r.validUntil === "string" && Number.isFinite(Date.parse(r.validUntil))
    && r.ownerConfirmed === true && (r.replacesMaterialId === undefined || r.replacesMaterialId === null
      || typeof r.replacesMaterialId === "string" && /^[1-9]\d*$/.test(r.replacesMaterialId))
    && typeof r.idempotencyKey === "string" && r.idempotencyKey.length > 0 && r.idempotencyKey.length <= 200;
}
