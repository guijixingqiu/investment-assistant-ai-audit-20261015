export const RESEARCH_SECOND_OPINION_VERSION = "2026-10-11.second-opinion.v1";

export const RESEARCH_SECOND_OPINION_REASONS = [
  "owner_requested", "high_weight", "pre_position", "material_disagreement"
] as const;
export type ResearchSecondOpinionReason = typeof RESEARCH_SECOND_OPINION_REASONS[number];

export interface ResearchSecondOpinionBinding {
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  reportId: string;
  reportVersion: number;
  reportFingerprint: string;
  evidencePackId: string;
  evidencePackFingerprint: string;
  snapshotId: string;
  sourceSetHash: string;
}

export interface ResearchSecondOpinionSource {
  materialId: string;
  evidenceId: string;
  title: string;
  sourceType: string;
  sourceUrl: string | null;
  contentFingerprint: string;
  excerpt: string;
  excerptTruncated: boolean;
  stance: "support" | "refute" | "neutral";
  claimType: string;
  verificationStatus: string;
}

export interface ResearchSecondOpinionPreview {
  schemaVersion: typeof RESEARCH_SECOND_OPINION_VERSION;
  generatedAt: string;
  binding: ResearchSecondOpinionBinding;
  reportConclusion: string;
  assumptions: string[];
  reportCounterEvidenceIds: string[];
  provider: "deepseek";
  model: string;
  maxOutputTokens: 1600;
  inputTokenUpperBound: number;
  estimatedMaxCostUsd: number;
  sources: ResearchSecondOpinionSource[];
  limitations: string[];
}

export interface ResearchSecondOpinionRequest extends ResearchSecondOpinionBinding {
  reason: ResearchSecondOpinionReason;
  ownerConfirmedSend: true;
  idempotencyKey: string;
}

export type ResearchSecondOpinionFindingKind = "support" | "disagreement" | "new_counterevidence" | "unknown";
export interface ResearchSecondOpinionFinding {
  kind: ResearchSecondOpinionFindingKind;
  explanation: string;
  sourceEvidenceIds: string[];
}

export interface ResearchSecondOpinionSendManifest {
  purpose: "independent_same_evidence_second_opinion";
  policyPurpose: "report_evidence_question";
  provider: "deepseek";
  model: string;
  policyVersion: string;
  binding: ResearchSecondOpinionBinding;
  sourceEvidenceIds: string[];
  payloadSha256: string;
  inputTokenUpperBound: number;
  maxOutputTokens: 1600;
  estimatedMaxCostUsd: number;
  fullPdfSent: false;
  credentialsSent: false;
  officialAssetFactsSent: false;
}

export interface ResearchSecondOpinionResult {
  schemaVersion: typeof RESEARCH_SECOND_OPINION_VERSION;
  status: "available" | "attempted";
  generatedAt: string;
  binding: ResearchSecondOpinionBinding;
  reason: ResearchSecondOpinionReason;
  provider: "deepseek";
  model: string;
  findings: ResearchSecondOpinionFinding[];
  sendManifest: ResearchSecondOpinionSendManifest;
  tokenUsage: string;
  costUsd: string;
  message: string;
}

export function validateResearchSecondOpinionRequest(value: unknown): value is ResearchSecondOpinionRequest {
  const request = value as ResearchSecondOpinionRequest;
  if (!record(value) || !validBinding(value) || request.ownerConfirmedSend !== true
    || !RESEARCH_SECOND_OPINION_REASONS.includes(request.reason)) return false;
  return typeof request.idempotencyKey === "string" && /^[A-Za-z0-9._:-]{12,160}$/.test(request.idempotencyKey);
}

export function validResearchSecondOpinionResult(value: unknown): value is ResearchSecondOpinionResult {
  if (!record(value) || value.schemaVersion !== RESEARCH_SECOND_OPINION_VERSION
    || !["available", "attempted"].includes(String(value.status)) || !validBinding(value.binding)
    || !RESEARCH_SECOND_OPINION_REASONS.includes(value.reason as ResearchSecondOpinionReason)
    || value.provider !== "deepseek" || typeof value.model !== "string"
    || typeof value.generatedAt !== "string" || !Array.isArray(value.findings)
    || value.findings.length > 16 || (value.status === "available" && value.findings.length === 0)
    || (value.status === "attempted" && value.findings.length !== 0)
    || typeof value.tokenUsage !== "string"
    || typeof value.costUsd !== "string" || typeof value.message !== "string"
    || !record(value.sendManifest)) return false;
  const manifest = value.sendManifest;
  return manifest.purpose === "independent_same_evidence_second_opinion"
    && manifest.policyPurpose === "report_evidence_question"
    && manifest.provider === "deepseek" && manifest.model === value.model
    && record(manifest.binding) && sameBinding(manifest.binding as ResearchSecondOpinionBinding, value.binding)
    && /^[a-f0-9]{64}$/.test(String(manifest.payloadSha256))
    && manifest.fullPdfSent === false && manifest.credentialsSent === false
    && manifest.officialAssetFactsSent === false
    && Array.isArray(manifest.sourceEvidenceIds)
    && value.findings.every((finding: unknown) => record(finding)
      && ["support", "disagreement", "new_counterevidence", "unknown"].includes(String(finding.kind))
      && typeof finding.explanation === "string" && finding.explanation.length > 0
      && finding.explanation.length <= 400 && Array.isArray(finding.sourceEvidenceIds)
      && finding.sourceEvidenceIds.every((id: unknown) => typeof id === "string"
        && manifest.sourceEvidenceIds.includes(id)));
}

export function sameBinding(left: ResearchSecondOpinionBinding, right: ResearchSecondOpinionBinding): boolean {
  const keys: Array<keyof ResearchSecondOpinionBinding> = ["membershipId", "membershipVersion", "symbol",
    "reportId", "reportVersion", "reportFingerprint", "evidencePackId", "evidencePackFingerprint",
    "snapshotId", "sourceSetHash"];
  return keys.every(key => left[key] === right[key]);
}

function validBinding(value: unknown): value is ResearchSecondOpinionBinding {
  if (!record(value)) return false;
  return positiveId(value.membershipId) && Number.isInteger(value.membershipVersion)
    && Number(value.membershipVersion) > 0 && /^HK\.\d{5}$/.test(String(value.symbol))
    && positiveId(value.reportId) && Number.isInteger(value.reportVersion)
    && Number(value.reportVersion) > 0 && hash(value.reportFingerprint)
    && positiveId(value.evidencePackId) && hash(value.evidencePackFingerprint)
    && /^deep-research-snapshot:[a-f0-9]{64}$/.test(String(value.snapshotId))
    && hash(value.sourceSetHash);
}

function positiveId(value: unknown): boolean { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function hash(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function record(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
