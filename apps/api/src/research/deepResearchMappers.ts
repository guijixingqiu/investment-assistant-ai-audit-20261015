import type {
  DeepResearchDecisionData,
  DeepResearchReportData,
  DeepResearchReportPayload,
  DeepResearchReportCurrentnessReason,
  EvidenceBoundDeepResearchReportPayload,
  FrozenResearchInvalidationReason,
  MaterialClaimType,
  MaterialRightsStatus,
  MaterialVerificationStatus,
  ResearchEvidencePackData,
  FrozenResearchEvidenceContext,
  ResearchMaterialCitation,
  ResearchMaterialData
} from "../../../../packages/contracts/src/deepResearch.js";
import {validFutuFinancialMaterialSource,type FutuFinancialMaterialSource} from "../../../../packages/contracts/src/researchFutuFinancialStatement.js";
import {
  EVIDENCE_BOUND_REPORT_CONTRACT_VERSION,
  LEGACY_REPORT_CONTRACT_VERSION,
  legacyDeepResearchReportPayload
} from "../../../../packages/contracts/src/deepResearch.js";
import {
  DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
  validateSynthesizedDeepResearchReportPayload,
  type SynthesizedDeepResearchReportPayload
} from "../../../../packages/contracts/src/deepResearchSynthesisReport.js";
import { deepResearchReportFingerprint } from "./deepResearchGate.js";

export interface ResearchMaterialRow {
  id: string;
  candidate_membership_id: string | null;
  evidence_id: string;
  replaces_material_id: string | null;
  revision: number | string;
  revision_state: "current" | "replaced";
  market: "HK";
  code: string;
  symbol: string;
  material_kind: "text";
  title: string;
  content_text: string;
  source_type: string;
  source_url: string | null;
  published_at: Date | string | null;
  futu_financial_source?:FutuFinancialMaterialSource|null;
  captured_at: Date | string;
  content_fingerprint: string;
  claim_type: MaterialClaimType;
  verification_status: MaterialVerificationStatus;
  rights_status: MaterialRightsStatus;
  source_version: string;
  valid_until: Date | string;
  summary: string;
  variable_name: string | null;
  stance: "support" | "refute" | "neutral";
  reliability: number | null;
  materiality: number | null;
  is_read: boolean;
  citation_document_id: string | null;
  citation_page_number: number | string | null;
  citation_page_text_sha256: string | null;
  citation_snapshot_id: string | null;
  citation_snapshot_membership_version: number | null;
  citation_snapshot_text_sha256: string | null;
  citation_start_utf16: number | null;
  citation_end_utf16: number | null;
  citation_excerpt_sha256: string | null;
  snapshot_raw_sha256?: string | null;
  snapshot_byte_length?: number | string | null;
  snapshot_media_type?: string | null;
  snapshot_canonical_url?: string | null;
  snapshot_response_url?: string | null;
}

export interface EvidencePackRow {
  research_mode?: "full" | "limited";
  material_selection_mode?: "explicit" | null;
  id: string;
  candidate_membership_id: string;
  candidate_membership_version: number | string;
  market: "HK";
  code: string;
  symbol: string;
  version: number | string;
  pack_fingerprint: string;
  frozen_at: Date | string;
  items: ResearchMaterialData[];
  frozen_research_context: FrozenResearchEvidenceContext | null;
  redaction_checksum_valid: boolean;
}

export interface DeepResearchReportRow {
  id: string;
  evidence_pack_id: string;
  version: number | string;
  report_contract_version: string | null;
  report_fingerprint: string | null;
  status: "evidence_insufficient" | "complete_pending_confirmation";
  report_payload: DeepResearchReportPayload | EvidenceBoundDeepResearchReportPayload | SynthesizedDeepResearchReportPayload;
  gate_failures: string[];
  created_at: Date | string;
}

export interface DeepResearchDecisionRow {
  id: string;
  report_id: string;
  decision: "confirmed" | "rejected";
  note: string | null;
  actor_type: "user";
  actor_id: string;
  created_at: Date | string;
}

export function rowToResearchMaterial(row: ResearchMaterialRow, now: Date): ResearchMaterialData {
  const validUntil = iso(row.valid_until);
  return {
    id: String(row.id),
    evidenceId: String(row.evidence_id),
    market: row.market,
    code: row.code,
    symbol: row.symbol,
    materialKind: row.material_kind,
    title: row.title,
    contentText: row.content_text,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    publishedAt: row.published_at===null?null:iso(row.published_at),
    capturedAt: iso(row.captured_at),
    contentFingerprint: row.content_fingerprint,
    claimType: row.claim_type,
    verificationStatus: row.verification_status,
    rightsStatus: row.rights_status,
    sourceVersion: row.source_version,
    replacesMaterialId: row.replaces_material_id === null ? null : String(row.replaces_material_id),
    revision: Number(row.revision),
    revisionState: row.revision_state,
    validUntil,
    freshness: Date.parse(validUntil) > now.getTime() ? "fresh" : "stale",
    summary: row.summary,
    variableName: row.variable_name,
    stance: row.stance,
    reliability: row.reliability,
    materiality: row.materiality,
    isRead: row.is_read,
    citation: citationFromRow(row),
    ...(validFutuFinancialMaterialSource(row.futu_financial_source)?{futuFinancialSource:row.futu_financial_source}:{}),
    ...(row.citation_snapshot_id != null ? { snapshotCitation: snapshotCitationFromRow(row),
      snapshotOriginal: {rawSha256:String(row.snapshot_raw_sha256),byteLength:Number(row.snapshot_byte_length),
        mediaType:"text/html" as const,canonicalUrl:String(row.snapshot_canonical_url),
        responseUrl:String(row.snapshot_response_url)}} : {})
  };
}

function citationFromRow(row: ResearchMaterialRow): ResearchMaterialCitation | null {
  if (row.citation_document_id == null || row.citation_page_number == null || row.citation_page_text_sha256 == null) return null;
  return {
    documentId: String(row.citation_document_id),
    pageNumber: Number(row.citation_page_number),
    pageTextSha256: row.citation_page_text_sha256
  };
}
function snapshotCitationFromRow(row: ResearchMaterialRow) {
  if (row.citation_snapshot_id == null || row.citation_snapshot_text_sha256 == null
    || row.citation_start_utf16 == null || row.citation_end_utf16 == null || row.citation_excerpt_sha256 == null) return null;
  return { kind: "source_snapshot" as const, snapshotId: String(row.citation_snapshot_id), textSha256: row.citation_snapshot_text_sha256,
    startUtf16: Number(row.citation_start_utf16), endUtf16: Number(row.citation_end_utf16), excerptSha256: row.citation_excerpt_sha256 };
}

export function rowToEvidencePack(
  row: EvidencePackRow,
  now: Date,
  invalidatedBy: FrozenResearchInvalidationReason[] = row.research_mode === "limited" || row.frozen_research_context
    ? []
    : ["frozen_research_context_missing"]
): ResearchEvidencePackData {
  const frozenResearchContext = row.frozen_research_context
    && "weinstein" in row.frozen_research_context
    ? row.frozen_research_context
    : null;
  const currentnessReasons = row.research_mode === "limited"
    ? [...new Set([...invalidatedBy, ...(row.items.some((item) => item.sourceType === "deleted") ? ["material_set_changed" as const] : [])])]
    : frozenResearchContext
    ? [...new Set([
        ...(!frozenResearchContext.researchContext ? ["research_context_binding_missing" as const] : []),
        ...(row.items.some((item) => item.sourceType === "deleted") ? ["material_set_changed" as const] : []),
        ...invalidatedBy
      ])]
    : [...new Set([
        "frozen_research_context_missing" as const,
        ...(row.items.some((item) => item.sourceType === "deleted") ? ["material_set_changed" as const] : []),
        ...invalidatedBy
      ])];
  return {
    ...(row.research_mode === "limited" ? { researchMode: "limited" as const } : {}),
    ...(row.material_selection_mode === "explicit" ? { materialSelectionMode: "explicit" as const } : {}),
    id: String(row.id),
    membershipId: String(row.candidate_membership_id),
    membershipVersion: Number(row.candidate_membership_version),
    market: row.market,
    code: row.code,
    symbol: row.symbol,
    version: Number(row.version),
    packFingerprint: row.pack_fingerprint,
    frozenAt: iso(row.frozen_at),
    items: row.items.map((item) => ({
      ...item,
      freshness: Date.parse(item.validUntil) > now.getTime() ? "fresh" : "stale"
    })),
    frozenResearchContext,
    currentness: {
      status: currentnessReasons.length === 0 ? "current" : "historical",
      invalidatedBy: currentnessReasons
    }
  };
}

export function rowToDeepResearchReport(
  row: DeepResearchReportRow,
  invalidatedBy: DeepResearchReportCurrentnessReason[] = [],
  evidencePackInvalidatedBy: FrozenResearchInvalidationReason[] = []
): DeepResearchReportData {
  const currentContract = isCurrentReportPayload(row.report_contract_version, row.report_payload);
  const reasons = [...invalidatedBy];
  if (evidencePackInvalidatedBy.length > 0) reasons.push("evidence_pack_historical");
  if (!currentContract) reasons.push("legacy_contract_not_formalizable");
  if (!row.report_fingerprint) reasons.push("report_fingerprint_missing");
  else if (currentContract && deepResearchReportFingerprint(
    String(row.evidence_pack_id),
    row.report_payload as EvidenceBoundDeepResearchReportPayload
  ) !== row.report_fingerprint) reasons.push("report_fingerprint_invalid");
  const uniqueReasons = [...new Set(reasons)];
  return {
    id: String(row.id),
    evidencePackId: String(row.evidence_pack_id),
    version: Number(row.version),
    contractVersion: currentContract
      ? row.report_contract_version as typeof EVIDENCE_BOUND_REPORT_CONTRACT_VERSION | typeof DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION
      : LEGACY_REPORT_CONTRACT_VERSION,
    reportFingerprint: currentContract && row.report_fingerprint
      ? row.report_fingerprint
      : "UNKNOWN",
    currentness: {
      status: uniqueReasons.length === 0 && evidencePackInvalidatedBy.length === 0
        ? "current" : "historical",
      invalidatedBy: uniqueReasons,
      evidencePackInvalidatedBy: [...new Set(evidencePackInvalidatedBy)]
    },
    status: row.status,
    gateFailures: row.gate_failures ?? [],
    payload: currentContract ? row.report_payload : legacyDeepResearchReportPayload(row.report_payload),
    createdAt: iso(row.created_at)
  };
}

function isCurrentReportPayload(
  contractVersion: string | null,
  value: DeepResearchReportPayload | EvidenceBoundDeepResearchReportPayload | SynthesizedDeepResearchReportPayload
): boolean {
  const matchingVersion = typeof value === "object"
    && value !== null
    && "reportContractVersion" in value
    && value.reportContractVersion === contractVersion
    && [EVIDENCE_BOUND_REPORT_CONTRACT_VERSION, DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION].includes(contractVersion as typeof EVIDENCE_BOUND_REPORT_CONTRACT_VERSION);
  return matchingVersion && (contractVersion !== DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION
    || validateSynthesizedDeepResearchReportPayload(value).ok);
}

export function rowToDeepResearchDecision(row: DeepResearchDecisionRow): DeepResearchDecisionData {
  return {
    id: String(row.id),
    reportId: String(row.report_id),
    decision: row.decision,
    note: row.note,
    actorType: row.actor_type,
    actorId: row.actor_id,
    decidedAt: iso(row.created_at)
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
