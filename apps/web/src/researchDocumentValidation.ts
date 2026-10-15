import {
  evidenceBoundReportPackBinding,
  validateDeepResearchWorkspaceEnvelope,
  type DeepResearchReportData,
  type DeepResearchWorkspaceEnvelope,
  type ResearchEvidencePackData
} from "../../../packages/contracts/src/deepResearch.js";
import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import {
  validateResearchMaterialData,
  validateResearchMaterialDeletionData,
  type ResearchMaterialData
} from "../../../packages/contracts/src/researchMaterial.js";
import {
  RESEARCH_DOCUMENT_SEARCH_SCHEMA_VERSION,
  RESEARCH_DOCUMENT_SCHEMA_VERSION,
  validateResearchDocumentSearchEnvelope,
  type ResearchDocumentData,
  type ResearchDocumentListEnvelope,
  type ResearchDocumentPageData,
  type ResearchDocumentSearchEnvelope,
  type ResearchDocumentSearchHit
} from "../../../packages/contracts/src/researchDocument.js";
import type { ExactCockpitMembership } from "./dailyResearchCockpit.js";
import type { ResearchSnapshotTextCitation } from "../../../packages/contracts/src/researchSourceCitation.js";

export interface ReportDocumentCitation {
  key: string;
  statement: string;
  sourceId: string;
  documentId: string;
  pageNumber: number;
  pageTextSha256: string;
  reportId: string;
  reportVersion: number;
  reportFingerprint: string;
}

export interface ReportSnapshotCitation {
  key: string;
  title: string;
  reportId: string;
  reportVersion: number;
  reportFingerprint: string;
  materialId: string;
  citation: ResearchSnapshotTextCitation;
  original: NonNullable<ResearchMaterialData["snapshotOriginal"]>;
  excerpt: string;
}

export function reportSnapshotCitations(value: unknown, membership: ExactCockpitMembership): ReportSnapshotCitation[] {
  const workspace = exactReportWorkspace(value, membership);
  const report = workspace.data?.latestReport;
  if (!report || report.currentness.status !== "current" || !sha(report.reportFingerprint)) return [];
  const payload = record(report.payload) ? report.payload : null;
  if (!payload || !("evidencePackBinding" in payload)) return [];
  const packs = workspace.data?.evidencePacks.filter(pack => pack.id === report.evidencePackId) ?? [];
  if (packs.length !== 1 || canonicalJson(payload.evidencePackBinding) !== canonicalJson(evidenceBoundReportPackBinding(packs[0]))) {
    throw new Error("Blocked: current report no longer binds its exact evidence pack.");
  }
  return packs[0].items.flatMap(material => {
    const citation = material.snapshotCitation, original = material.snapshotOriginal;
    if (material.sourceType !== "issuer_public_html" || !citation || !original) return [];
    return [{ key: JSON.stringify([report.id,report.version,report.reportFingerprint,material.id,material.revision,
      citation.snapshotId,citation.textSha256,citation.startUtf16,citation.endUtf16,citation.excerptSha256,original.rawSha256]),
      title: material.title, reportId: report.id, reportVersion: report.version,
      reportFingerprint: report.reportFingerprint, materialId: material.id,
      citation, original, excerpt: material.contentText }];
  });
}

export function acceptResearchDocumentList(value: unknown, membership: ExactCockpitMembership): ResearchDocumentListEnvelope {
  if (!record(value)
    || value.schemaVersion !== RESEARCH_DOCUMENT_SCHEMA_VERSION
    || value.status !== "available"
    || value.membershipId !== membership.id
    || value.membershipVersion !== membership.version
    || value.symbol !== membership.symbol
    || !Array.isArray(value.documents)
    || !Array.isArray(value.materials)
    || value.schemaVersion === RESEARCH_DOCUMENT_SCHEMA_VERSION && !Array.isArray(value.materialDeletions)) {
    throw new Error("Blocked: research-document list does not match the exact current membership.");
  }
  const documents = value.documents as unknown[];
  if (documents.some((item) => !validDocument(item, membership))) {
    throw new Error("Blocked: research-document identity, source state, or hash metadata is malformed.");
  }
  const documentIds = new Set(documents.map((item) => (item as ResearchDocumentData).id));
  if (value.materials.some((item) => {
    if (!validateResearchMaterialData(item).ok) return true;
    const material = item as ResearchMaterialData;
    return material.symbol !== membership.symbol || !material.citation || !documentIds.has(material.citation.documentId);
  })) throw new Error("Blocked: confirmed fact does not bind a document in the exact fresh list.");
  if (Array.isArray(value.materialDeletions)
    && value.materialDeletions.some((item) => !validateResearchMaterialDeletionData(item).ok)) {
    throw new Error("Blocked: material deletion identity is malformed.");
  }
  return value as unknown as ResearchDocumentListEnvelope;
}

export async function acceptResearchDocumentPage(
  value: unknown,
  documentId: string,
  pageNumber: number,
  expectedHash: string | null = null
): Promise<ResearchDocumentPageData> {
  if (!record(value) || value.documentId !== documentId || value.pageNumber !== pageNumber
    || typeof value.normalizedText !== "string" || !sha(value.pageTextSha256)) {
    throw new Error("Blocked: PDF page identity or text hash is malformed.");
  }
  const computed = await sha256(new TextEncoder().encode(value.normalizedText));
  if (computed !== value.pageTextSha256 || expectedHash !== null && expectedHash !== value.pageTextSha256) {
    throw new Error("Blocked: PDF page hash drift or citation mismatch was detected.");
  }
  return value as unknown as ResearchDocumentPageData;
}

export interface ResearchDocumentSearchEnvelopeView {
  status: "available" | "unavailable";
  hits: ResearchDocumentSearchHit[];
  message: string;
  ocrUsed: boolean;
  glossaryVersion: string | null;
  unavailable: boolean;
}

/**
 * Exact-identity acceptance for `GET .../documents/search`. It reuses the shared
 * contract validator and then binds the envelope to the exact current
 * membership and the exact submitted query, so a membership-scoped or
 * query-drifted response can never be shown as the current search; late
 * responses are rejected by the request generation guard in the console.
 * The envelope's `requestedActorId` is read-only text here: Web membership
 * identity carries id/version/symbol only, and actor scoping is enforced by the
 * read authorization token on the request itself.
 */
export function acceptResearchDocumentSearch(
  value: unknown,
  membership: ExactCockpitMembership,
  expectedQuery: string
): ResearchDocumentSearchEnvelopeView {
  const validation = validateResearchDocumentSearchEnvelope(value);
  if (!validation.ok) throw new Error(`Blocked: research-document search response is malformed: ${validation.errors.join("; ")}`);
  const envelope = value as ResearchDocumentSearchEnvelope;
  if (typeof envelope.requestedActorId !== "string" || envelope.requestedActorId.trim().length === 0
    || envelope.membershipId !== membership.id || envelope.query !== expectedQuery
    || envelope.query.length < 1 || envelope.query.length > 80) {
    throw new Error("Blocked: research-document search does not match the exact submitted query and membership.");
  }
  if (envelope.status === "unavailable") {
    return { status: "unavailable", hits: [], message: envelope.message, ocrUsed: false, glossaryVersion: null, unavailable: true };
  }
  if (envelope.membershipVersion !== membership.version || envelope.symbol !== membership.symbol) {
    throw new Error("Blocked: research-document search does not match the exact current membership.");
  }
  return {
    status: "available",
    hits: envelope.results,
    message: envelope.message,
    ocrUsed: envelope.search.ocrUsed,
    glossaryVersion: envelope.search.glossaryVersion,
    unavailable: false
  };
}

export function reportDocumentCitations(value: unknown, membership: ExactCockpitMembership): ReportDocumentCitation[] {
  const workspace = exactReportWorkspace(value, membership);
  const report = workspace.data?.latestReport;
  if (!report || report.currentness.status !== "current" || !sha(report.reportFingerprint)) return [];
  const packs = workspace.data?.evidencePacks.filter((pack) => pack.id === report.evidencePackId) ?? [];
  return packs.length === 1 ? citationsForReport(report, packs[0]) : [];
}

export function reportDocumentCitationsForSelection(
  value: unknown,
  membership: ExactCockpitMembership,
  selection: { id: string; version: number; reportFingerprint: string }
): ReportDocumentCitation[] {
  const workspace = exactReportWorkspace(value, membership);
  const reports = workspace.data?.reports.filter((report) => report.id === selection.id && report.version === selection.version
    && report.reportFingerprint === selection.reportFingerprint) ?? [];
  const report = reports.length === 1 ? reports[0] : null;
  const packs = report ? workspace.data?.evidencePacks.filter((pack) => pack.id === report.evidencePackId) ?? [] : [];
  const pack = packs.length === 1 ? packs[0] : null;
  const payload = report && record(report.payload) ? report.payload : null;
  if (!report || !pack || !payload || !sha(report.reportFingerprint)) throw new Error("Blocked: selected report or evidence-pack identity changed.");
  try {
    if (canonicalJson(payload.evidencePackBinding) !== canonicalJson(evidenceBoundReportPackBinding(pack))) {
      throw new Error("Blocked: selected report no longer binds its exact evidence pack.");
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error("Blocked: selected report evidence-pack binding is invalid.");
  }
  return citationsForReport(report, pack);
}

function exactReportWorkspace(value: unknown, membership: ExactCockpitMembership): DeepResearchWorkspaceEnvelope {
  const validation = validateDeepResearchWorkspaceEnvelope(value);
  if (!validation.ok) throw new Error(`Blocked: deep-research workspace is malformed: ${validation.errors.join("; ")}`);
  const workspace = value as DeepResearchWorkspaceEnvelope;
  const target = workspace.data?.target;
  if (workspace.status !== "available" || !target
    || workspace.membershipId !== membership.id || target.membershipId !== membership.id
    || target.membershipVersion !== membership.version || target.symbol !== membership.symbol) {
    throw new Error("Blocked: report workspace does not match the exact current membership.");
  }
  return workspace;
}

function citationsForReport(report: DeepResearchReportData, pack: ResearchEvidencePackData): ReportDocumentCitation[] {
  const payload = record(report.payload) ? report.payload : null;
  const layer = payload && record(payload.researchLayer) ? payload.researchLayer : null;
  if (!layer) return [];
  const citations: ReportDocumentCitation[] = [];
  for (const entries of Object.values(layer)) {
    if (!Array.isArray(entries)) continue;
    for (const item of entries) {
      if (!record(item)) continue;
      const statement = typeof item.statement === "string"
        ? item.statement : typeof item.description === "string" ? item.description : "Document-backed report citation";
      if (record(item.citation) && item.citation.kind === "document_page" && typeof item.sourceId === "string"
        && positive(item.citation.documentId) && Number.isSafeInteger(item.citation.pageNumber)
        && Number(item.citation.pageNumber) >= 1 && sha(item.citation.pageTextSha256)) {
        citations.push(reportCitation(report, statement, item.sourceId, {
          documentId: item.citation.documentId,
          pageNumber: Number(item.citation.pageNumber),
          pageTextSha256: item.citation.pageTextSha256
        }));
        continue;
      }
      for (const evidenceId of Array.isArray(item.evidenceIds) ? item.evidenceIds : []) {
        const materials = pack.items.filter((material) => material.evidenceId === evidenceId && material.citation);
        if (materials.length === 1 && materials[0].citation) {
          citations.push(reportCitation(report, statement, String(evidenceId), materials[0].citation));
        }
      }
    }
  }
  for (const material of pack.items) {
    if (material.citation) {
      citations.push(reportCitation(report, `证据包来源：${material.title}`, material.evidenceId, material.citation));
    }
  }
  return [...new Map(citations.map((citation) => [citation.key, citation])).values()];
}

function reportCitation(
  report: DeepResearchReportData,
  statement: string,
  sourceId: string,
  citation: { documentId: string; pageNumber: number; pageTextSha256: string }
): ReportDocumentCitation {
  const { documentId, pageNumber, pageTextSha256 } = citation;
  return {
    key: JSON.stringify([report.id, report.version, report.reportFingerprint, sourceId, documentId, pageNumber, pageTextSha256, statement]),
    statement, sourceId, documentId, pageNumber, pageTextSha256,
    reportId: report.id, reportVersion: report.version, reportFingerprint: report.reportFingerprint
  };
}

export function importedDocument(value: unknown, membership: ExactCockpitMembership): ResearchDocumentData {
  if (!record(value) || !record(value.data) || !["created", "deduplicated"].includes(String(value.data.result))
    || !validDocument(value.data.document, membership)) {
    throw new Error("Blocked: PDF import response does not match the exact membership contract.");
  }
  return value.data.document;
}

export function confirmedMaterial(value: unknown, membership: ExactCockpitMembership, page: ResearchDocumentPageData): ResearchMaterialData {
  if (!record(value) || !validateResearchMaterialData(value.data).ok) throw new Error("Blocked: confirmed-fact response is malformed.");
  const material = value.data as ResearchMaterialData;
  if (material.symbol !== membership.symbol || material.sourceType !== "owner_provided_pdf"
    || material.verificationStatus !== "unverified" || material.citation?.documentId !== page.documentId
    || material.citation.pageNumber !== page.pageNumber || material.citation.pageTextSha256 !== page.pageTextSha256) {
    throw new Error("Blocked: confirmed fact does not bind the exact PDF page and unverified evidence boundary.");
  }
  return material;
}

function validDocument(value: unknown, membership: ExactCockpitMembership): value is ResearchDocumentData {
  return record(value) && positive(value.id) && value.membershipId === membership.id
    && Number.isSafeInteger(value.membershipVersionAtImport) && Number(value.membershipVersionAtImport) >= 1
    && Number(value.membershipVersionAtImport) <= membership.version && value.symbol === membership.symbol
    && ["available", "missing", "corrupt"].includes(String(value.sourceState)) && sha(value.pdfSha256)
    && Number.isSafeInteger(value.byteLength) && Number(value.byteLength) > 0
    && Number.isSafeInteger(value.pageCount) && Number(value.pageCount) > 0
    && typeof value.originalFilename === "string" && value.originalFilename.length > 0;
}

function positive(value: unknown): value is string { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function sha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
async function sha256(bytes: Uint8Array): Promise<string> { const copy = new Uint8Array(bytes.length); copy.set(bytes); return [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
