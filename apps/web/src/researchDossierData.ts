import {
  validateResearchContextEnvelope,
  type CreateResearchContextRequest,
  type ResearchContextEnvelope
} from "../../../packages/contracts/src/researchContext.js";
import {
  RESEARCH_FUNDAMENTALS_FORMULA_VERSION,
  RESEARCH_FUNDAMENTAL_METRICS,
  validateResearchFundamentalsEnvelope,
  type CreateResearchFundamentalValueRequest,
  type ResearchFundamentalsEnvelope,
  type ResearchFundamentalValueData
} from "../../../packages/contracts/src/researchFundamentals.js";
import {
  validateResearchValuationScenariosEnvelope,
  type CreateResearchValuationScenarioRequest,
  type ResearchValuationScenariosEnvelope
} from "../../../packages/contracts/src/researchValuationScenarios.js";
import type { AnnualValuationMethodId } from "../../../packages/contracts/src/annualValuationQuantWorkbench.js";
import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import {
  validateResearchCompletenessEnvelope,
  type CreateResearchCompletenessRequest,
  type ResearchCompletenessEnvelope
} from "../../../packages/contracts/src/researchCompleteness.js";
import { validateResearchWriteEnvelopeBase } from "../../../packages/contracts/src/research.js";
import {
  validateResearchFinancialRequirementData,
  type ResearchFinancialRequirementData,
  type ResearchFinancialRequirementEnvelope
} from "../../../packages/contracts/src/researchFinancialRequirement.js";
export type {
  CreateResearchFinancialRequirementRequest,
  ResearchFinancialRequirementData,
  ResearchFinancialRequirementEnvelope
} from "../../../packages/contracts/src/researchFinancialRequirement.js";
import type { ResearchDocumentListEnvelope } from "../../../packages/contracts/src/researchDocument.js";
import type { ResearchMaterialData } from "../../../packages/contracts/src/researchMaterial.js";
import { validResearchMaterial } from "../../../packages/contracts/src/researchMaterial.js";
import { researchFundamentalCurrentlyUsable } from "../../../packages/contracts/src/researchFundamentals.js";
import type { ResearchSourceSnapshotListItem } from "../../../packages/contracts/src/researchSourceSnapshot.js";
import { listStoredSources } from "./researchSourceSnapshotWeb.js";
import type { WebApiAuth } from "./apiClient.js";
import { acceptResearchDocumentList } from "./researchDocumentValidation.js";

export interface ResearchDossierMembership {
  id: string;
  version: number;
  state: "tracked" | "paused";
  symbol: string;
}

export interface ResearchDossierSnapshot {
  actorId: string;
  context: ResearchContextEnvelope;
  fundamentals: ResearchFundamentalsEnvelope;
  valuations: ResearchValuationScenariosEnvelope;
  documents: ResearchDocumentListEnvelope;
  sourceMaterials?: ResearchMaterialData[];
  htmlMaterials?: ResearchMaterialData[];
  sourceSnapshots?: ResearchSourceSnapshotListItem[];
  completeness: ResearchCompletenessEnvelope | null;
  financialRequirement: ResearchFinancialRequirementEnvelope | null;
}

export async function readResearchDossier(
  membership: ResearchDossierMembership,
  auth: WebApiAuth,
  fetcher: typeof fetch = fetch
): Promise<ResearchDossierSnapshot> {
  const root = `/api/mobile/research/candidate-memberships/${encodeURIComponent(membership.id)}`;
  const [context, fundamentals, valuations, documents, completeness, requirement, workspace, sources] = await Promise.all([
    dossierJson(`${root}/research-context`, auth, { cache: "no-store" }, [200, 404], fetcher),
    dossierJson(`${root}/fundamentals`, auth, { cache: "no-store" }, [200], fetcher),
    dossierJson(`${root}/valuation-scenarios`, auth, { cache: "no-store" }, [200], fetcher),
    dossierJson(`${root}/documents`, auth, { cache: "no-store" }, [200], fetcher),
    dossierJson(`${root}/completeness`, auth, { cache: "no-store" }, [200, 404, 503], fetcher).catch(() => null),
    dossierJson(`${root}/financial-requirement`, auth, { cache: "no-store" }, [200, 404, 503], fetcher).catch(() => null),
    dossierJson(`${root}/deep-research`, auth, { cache: "no-store" }, [200], fetcher),
    listStoredSources(membership, auth, fetcher)
  ]);
  if ((context.status === 200) !== (record(context.value) && context.value.status === "available")) {
    throw new Error("Research context HTTP status does not match its fresh envelope.");
  }
  const snapshot = acceptResearchDossier(membership, context.value, fundamentals.value, valuations.value,
    documents.value, completeness?.value ?? null);
  snapshot.financialRequirement = acceptFinancialRequirement(requirement?.value ?? null, membership, snapshot.actorId);
  const coverage = snapshot.fundamentals.financialCoverage as unknown as {
    coverageVersion?: string; requirement?: ResearchFinancialRequirementData | null
  };
  if (coverage.coverageVersion === "2026-10-10.sourced-coverage.v3") {
    if (snapshot.financialRequirement?.status !== "available" || !snapshot.financialRequirement.data
      || !coverage.requirement
      || !sameFinancialRequirementBinding(coverage.requirement, snapshot.financialRequirement.data)) {
      throw new Error("Financial coverage and period check changed between fresh reads.");
    }
  } else if (snapshot.financialRequirement?.status === "available") {
    throw new Error("Financial period check changed before coverage was refreshed.");
  }
  const financialSection = snapshot.completeness?.data?.sections.find(item => item.section === "financials");
  if (coverage.requirement && financialSection?.status === "available"
    && !financialSection.sourceBindings.some(source => source.sourceType === "financial_requirement"
      && source.sourceId === coverage.requirement?.id
      && source.sourceVersion === coverage.requirement.schemaVersion
      && source.asOf === coverage.requirement.asOf
      && source.validUntil === coverage.requirement.validUntil)) {
    throw new Error("Research completeness lost its exact financial period source binding.");
  }
  const body = workspace.value as {requestedActorId?:unknown;membershipId?:unknown;requestedSymbol?:unknown;data?:{target?:{membershipId?:unknown;membershipVersion?:unknown;symbol?:unknown};materials?:unknown}};
  if (body.requestedActorId !== snapshot.actorId || body.membershipId !== membership.id || body.requestedSymbol !== membership.symbol
    || body.data?.target?.membershipId !== membership.id || body.data.target.membershipVersion !== membership.version
    || body.data.target.symbol !== membership.symbol || !Array.isArray(body.data.materials)
    || !body.data.materials.every(item => validResearchMaterial(item) && item.symbol === membership.symbol)) {
    throw new Error("Deep Research materials no longer bind the exact current membership.");
  }
  snapshot.sourceMaterials = body.data.materials;
  snapshot.htmlMaterials = body.data.materials.filter((item: ResearchMaterialData) => item.sourceType === "issuer_public_html");
  snapshot.sourceSnapshots = sources;
  return snapshot;
}

function sameFinancialRequirementBinding(
  left: ResearchFinancialRequirementData, right: ResearchFinancialRequirementData
): boolean {
  const binding = (value: ResearchFinancialRequirementData) => [
    value.id, value.version, value.membershipId, value.membershipVersion, value.symbol, value.actorId,
    value.fiscalYearEnd, value.latestRequiredAnnualPeriodEnd,
    value.latestRequiredInterimPeriodStart, value.latestRequiredInterimPeriodEnd,
    value.asOf, value.nextReviewAt, value.validUntil,
    value.sources.map(source => [source.materialId, source.materialRevision, source.contentFingerprint])
  ];
  return canonicalJson(binding(left)) === canonicalJson(binding(right));
}

export function acceptResearchDossier(
  membership: ResearchDossierMembership,
  contextValue: unknown,
  fundamentalsValue: unknown,
  valuationsValue: unknown,
  documentsValue: unknown,
  completenessValue: unknown
): ResearchDossierSnapshot {
  if (!validMembership(membership)) throw new Error("An exact non-archived membership is required.");
  const contextValidation = validateResearchContextEnvelope(contextValue);
  if (!contextValidation.ok) throw new Error(`Research context is malformed: ${contextValidation.errors.join("; ")}`);
  const context = contextValue as ResearchContextEnvelope;
  if (!['available', 'not_found'].includes(context.status) || context.membershipId !== membership.id
    || context.requestedSymbol !== membership.symbol
    || context.data && (context.data.membershipVersion !== membership.version || context.data.currentness.status !== "current")) {
    throw new Error("Research context no longer binds the exact current membership.");
  }
  const fundamentalsValidation = validateResearchFundamentalsEnvelope(fundamentalsValue);
  if (!fundamentalsValidation.ok) throw new Error(`Fundamentals are malformed: ${fundamentalsValidation.errors.join("; ")}`);
  const fundamentals = fundamentalsValue as ResearchFundamentalsEnvelope;
  if (fundamentals.membershipId !== membership.id || fundamentals.membershipVersion !== membership.version
    || fundamentals.symbol !== membership.symbol || !validFundamentals(fundamentals)) {
    throw new Error("Fundamentals no longer bind the exact current membership or contract.");
  }
  const valuationValidation = validateResearchValuationScenariosEnvelope(valuationsValue);
  if (!valuationValidation.ok) throw new Error(`Valuation scenarios are malformed: ${valuationValidation.errors.join("; ")}`);
  const valuations = valuationsValue as ResearchValuationScenariosEnvelope;
  if (valuations.membershipId !== membership.id || valuations.membershipVersion !== membership.version
    || valuations.membershipState !== membership.state || valuations.symbol !== membership.symbol) {
    throw new Error("Valuation scenarios no longer bind the exact current membership.");
  }
  const documents = acceptResearchDocumentList(documentsValue, membership);
  const actors = [context.requestedActorId, fundamentals.requestedActorId, valuations.requestedActorId, documents.requestedActorId];
  if (!actors[0] || actors.some((actor) => actor !== actors[0])) throw new Error("Dossier sources do not bind one exact actor.");
  const completeness = acceptOptionalCompleteness(completenessValue, membership, actors[0]);
  return { actorId: actors[0], context, fundamentals, valuations, documents, completeness,
    financialRequirement: null };
}

export function acceptFinancialRequirement(
  value: unknown, membership: ResearchDossierMembership, actorId: string
): ResearchFinancialRequirementEnvelope | null {
  if (!record(value) || value.schemaVersion !== "2026-10-10.research-financial-requirement.v1"
    || value.membershipId !== membership.id || value.requestedActorId !== actorId
    || value.requestedSymbol !== membership.symbol
    || !["available", "not_found", "unavailable"].includes(String(value.status))
    || !Array.isArray(value.gaps) || !value.gaps.every(item => typeof item === "string")
    || !(value.latestRequirementId === null || positive(value.latestRequirementId))) return null;
  const envelope = value as unknown as ResearchFinancialRequirementEnvelope;
  if (envelope.status !== "available") return envelope.data === null
    && (envelope.status !== "unavailable" || envelope.gaps.length > 0) ? envelope : null;
  const data = envelope.data;
  if (!validateResearchFinancialRequirementData(data) || data.id !== envelope.latestRequirementId
    || data.membershipId !== membership.id || data.membershipVersion !== membership.version
    || data.symbol !== membership.symbol || data.actorType !== "user" || data.actorId !== actorId
    || Date.parse(data.validUntil) <= Date.now()) return null;
  return envelope;
}

function acceptOptionalCompleteness(
  value: unknown,
  membership: ResearchDossierMembership,
  actorId: string
): ResearchCompletenessEnvelope | null {
  if (!validateResearchCompletenessEnvelope(value).ok) return null;
  const envelope = value as ResearchCompletenessEnvelope;
  if (envelope.membershipId !== membership.id || envelope.requestedActorId !== actorId
    || envelope.requestedSymbol !== membership.symbol
    || envelope.data && envelope.data.membershipVersion !== membership.version) return null;
  return envelope;
}

export async function writeResearchDossier(
  path: string,
  body: object,
  auth: WebApiAuth,
  actorId: string,
  fetcher: typeof fetch = fetch
): Promise<unknown> {
  const { value } = await dossierJson(path, auth, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", "x-research-expected-actor-id": actorId },
    body: JSON.stringify(body)
  }, [200], fetcher);
  const errors = validateResearchWriteEnvelopeBase(value, "dossier write envelope");
  if (!record(value) || !record(value.source) || errors.length
    || value.source.actorType !== "user" || value.source.actorId !== actorId || value.source.correlationId !== null
    || !record(value.data)) {
    throw new Error(`Dossier write response is malformed or actor-mismatched: ${errors.join("; ") || "invalid data"}`);
  }
  return value.data;
}

export async function writeResearchCompleteness(
  path: string,
  body: CreateResearchCompletenessRequest,
  auth: WebApiAuth,
  actorId: string,
  fetcher: typeof fetch = fetch
): Promise<ResearchCompletenessEnvelope> {
  const { value } = await dossierJson(path, auth, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", "x-research-expected-actor-id": actorId },
    body: JSON.stringify(body)
  }, [200], fetcher);
  if (!validateResearchCompletenessEnvelope(value).ok) throw new Error("Research completeness write response is malformed.");
  const envelope = value as ResearchCompletenessEnvelope;
  if (envelope.status !== "available" || envelope.requestedActorId !== actorId || !envelope.data) {
    throw new Error("Research completeness write response is unavailable or actor-mismatched.");
  }
  return envelope;
}

export function currentPdfMaterials(snapshot: ResearchDossierSnapshot): ResearchMaterialData[] {
  const documents = new Map(snapshot.documents.documents.map((item) => [item.id, item]));
  return snapshot.documents.materials.filter((material) => {
    const document = material.citation && documents.get(material.citation.documentId);
    return material.sourceType === "owner_provided_pdf" && material.claimType === "issuer_statement"
      && material.verificationStatus === "unverified" && material.rightsStatus === "user_provided"
      && material.revisionState === "current" && material.freshness === "fresh" && material.citation
      && document?.sourceState === "available" && document.membershipVersionAtImport === snapshot.fundamentals.membershipVersion;
  });
}

export function currentFundamentalMaterials(snapshot: ResearchDossierSnapshot): ResearchMaterialData[] {
  const html = (snapshot.htmlMaterials ?? []).filter(material => {
    const citation = material.snapshotCitation, original = material.snapshotOriginal;
    const source = (snapshot.sourceSnapshots ?? []).find(item => item.id === citation?.snapshotId);
    return material.sourceType === "issuer_public_html" && material.claimType === "issuer_statement"
      && material.verificationStatus === "unverified" && material.rightsStatus === "authorized_public"
      && material.revisionState === "current" && material.freshness === "fresh" && citation && original
      && source?.reviewState === "current" && source.rawSha256 === original.rawSha256
      && source.textSha256 === citation.textSha256 && source.membershipVersion === snapshot.fundamentals.membershipVersion;
  });
  return [...currentPdfMaterials(snapshot), ...html];
}

/** Current saved originals that can be individually reopened for a period check. */
export function currentFinancialRequirementMaterials(snapshot: ResearchDossierSnapshot): ResearchMaterialData[] {
  const documents = new Map(snapshot.documents.documents.map(item => [item.id, item]));
  const snapshots = new Map((snapshot.sourceSnapshots ?? []).map(item => [item.id, item]));
  return (snapshot.sourceMaterials ?? []).filter(material => {
    if (!["issuer_statement", "third_party_statement", "verified_fact"].includes(material.claimType)
      || !["unverified", "verified"].includes(material.verificationStatus)
      || material.revisionState !== "current"
      || material.freshness !== "fresh" || Date.parse(material.validUntil) <= Date.now()) return false;
    if (material.sourceType === "owner_provided_pdf" || material.sourceType === "issuer_public_pdf") {
      const document = material.citation && documents.get(material.citation.documentId);
      const listed = snapshot.documents.materials.find(item => item.id === material.id);
      const rights = material.sourceType === "owner_provided_pdf" ? "user_provided" : "authorized_public";
      return material.rightsStatus === rights && !!document && !!listed && listed.revision === material.revision
        && listed.contentFingerprint === material.contentFingerprint
        && document.sourceState === "available"
        && document.membershipVersionAtImport === snapshot.fundamentals.membershipVersion;
    }
    if (material.sourceType === "issuer_public_html") {
      const citation = material.snapshotCitation, original = material.snapshotOriginal;
      const source = citation && snapshots.get(citation.snapshotId);
      return material.rightsStatus === "authorized_public"
        && !!citation && !!original && !!source && source.reviewState === "current"
        && source.membershipVersion === snapshot.fundamentals.membershipVersion
        && source.rawSha256 === original.rawSha256 && source.textSha256 === citation.textSha256;
    }
    return false;
  });
}

export function eligibleValuationAnchors(
  snapshot: ResearchDossierSnapshot,
  methodId: AnnualValuationMethodId = "discounted_forward_metric_multiple_user_scenario"
): ResearchFundamentalValueData[] {
  const eligibleMetrics = methodId === "adjusted_net_asset_value_user_scenario"
    ? ["total_assets", "total_liabilities"] : ["revenue", "profit_attributable_to_owners"];
  return snapshot.fundamentals.values.filter((value) => researchFundamentalCurrentlyUsable(value)
    && value.membershipVersionAtWrite === snapshot.fundamentals.membershipVersion
    && eligibleMetrics.includes(value.metric)
    && value.valueStatus === "reported" && value.value !== null && value.comparability === "comparable"
    && value.source.materialRevisionState === "current" && value.source.freshness === "fresh");
}

export function sameDossierFacts(left: ResearchDossierSnapshot, right: ResearchDossierSnapshot): boolean {
  return left.actorId === right.actorId && sameJson([
    left.context.status, left.context.data, left.context.history, left.context.changeSummary,
    left.fundamentals.values, left.fundamentals.derivations,
    left.valuations.scenarioSets, left.documents.documents, left.documents.materials,
    left.sourceMaterials, left.htmlMaterials, left.sourceSnapshots, left.financialRequirement
  ], [
    right.context.status, right.context.data, right.context.history, right.context.changeSummary,
    right.fundamentals.values, right.fundamentals.derivations,
    right.valuations.scenarioSets, right.documents.documents, right.documents.materials,
    right.sourceMaterials, right.htmlMaterials, right.sourceSnapshots, right.financialRequirement
  ]);
}

export function contextMatchesRequest(value: ResearchContextEnvelope["data"], request: CreateResearchContextRequest): boolean {
  return Boolean(value && sameJson({
    selectedSymbol: value.selectedSymbol, industry: value.industry, selectedFacts: value.selectedFacts,
    peerFacts: value.peerFacts, peers: value.peers, operatingKpis: value.operatingKpis,
    macroDrivers: value.macroDrivers, industryDrivers: value.industryDrivers,
    unknowns: value.unknowns, provenance: value.provenance, asOf: value.asOf,
    cutoffAt: value.cutoffAt, validUntil: value.validUntil
  }, {
    selectedSymbol: request.selectedSymbol, industry: request.industry, selectedFacts: request.selectedFacts,
    peerFacts: request.peerFacts, peers: request.peers, operatingKpis: request.operatingKpis,
    macroDrivers: request.macroDrivers, industryDrivers: request.industryDrivers,
    unknowns: request.unknowns, provenance: request.provenance, asOf: request.asOf,
    cutoffAt: request.cutoffAt, validUntil: request.validUntil
  }));
}

export function fundamentalMatchesRequest(value: ResearchFundamentalValueData, request: CreateResearchFundamentalValueRequest): boolean {
  return value.membershipVersionAtWrite === request.membershipVersion && value.source.materialId === request.sourceMaterialId
    && value.metric === request.metric && value.periodKind === request.periodKind && value.periodStart === request.periodStart
    && value.periodEnd === request.periodEnd && value.currency === request.currency && value.unitScale === request.unitScale
    && value.scope === request.scope && value.valueStatus === request.valueStatus && value.value === request.value
    && value.comparability === request.comparability && value.comparabilityReason === request.comparabilityReason
    && (!request.assertion || !!value.assertion && Object.entries(request.assertion).every(
      ([key, requested]) => canonicalJson((value.assertion as unknown as Record<string, unknown>)[key]) === canonicalJson(requested)))
    && value.amendmentKind === request.amendmentKind && value.replacesValueId === request.replacesValueId
    && value.valueState === "current";
}

export function valuationMatchesRequest(
  value: ResearchValuationScenariosEnvelope["scenarioSets"][number],
  request: CreateResearchValuationScenarioRequest
): boolean {
  return value.membershipVersionAtWrite === request.membershipVersion && value.symbol === request.symbol
    && value.anchor.id === request.anchorValueId && value.replacesScenarioSetId === request.replacesScenarioSetId
    && value.scenarioState === "current" && value.recomputable && sameJson(value.assumptions.values, request.assumptions);
}

async function dossierJson(
  path: string,
  auth: WebApiAuth,
  init: RequestInit,
  acceptedStatuses: number[],
  fetcher: typeof fetch
): Promise<{ status: number; value: unknown }> {
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set(auth.headerName, auth.token);
    response = await fetcher(path, { ...init, headers });
  } catch (error) {
    throw new Error(error instanceof Error ? `Offline: ${error.message}` : "Offline: dossier request failed.", { cause: error });
  }
  const value: unknown = await response.json().catch(() => null);
  if (!acceptedStatuses.includes(response.status) || value === null) {
    const detail = record(value) && typeof value.message === "string" ? value.message : `HTTP ${response.status}`;
    throw new Error(`${response.status}: ${detail}`);
  }
  return { status: response.status, value };
}

function validFundamentals(envelope: ResearchFundamentalsEnvelope): boolean {
  const ids = new Set<string>();
  for (const value of envelope.values) {
    if (!validFundamentalValue(value, envelope) || ids.has(value.id)) return false;
    ids.add(value.id);
  }
  return envelope.derivations.every((item) => ["revenue_yoy", "profit_change", "profit_margin", "cash_conversion", "liability_ratio"].includes(item.kind)
    && ["available", "not_comparable"].includes(item.status) && item.formulaVersion === RESEARCH_FUNDAMENTALS_FORMULA_VERSION
    && Array.isArray(item.inputValueIds) && item.inputValueIds.every((id) => ids.has(id))
    && (item.status === "available" ? typeof item.value === "string" : item.value === null && Boolean(item.reason)));
}

function validFundamentalValue(value: ResearchFundamentalValueData, envelope: ResearchFundamentalsEnvelope): boolean {
  return positive(value.id) && value.membershipId === envelope.membershipId && value.symbol === envelope.symbol
    && Number.isSafeInteger(value.membershipVersionAtWrite) && value.membershipVersionAtWrite > 0
    && RESEARCH_FUNDAMENTAL_METRICS.includes(value.metric) && ["duration", "instant"].includes(value.periodKind)
    && /^\d{4}-\d{2}-\d{2}$/.test(value.periodEnd) && /^[A-Z]{3}$/.test(value.currency)
    && [1, 1_000, 1_000_000, 1_000_000_000].includes(value.unitScale)
    && ["consolidated", "parent_company"].includes(value.scope) && ["reported", "explicit_unknown"].includes(value.valueStatus)
    && (value.valueStatus === "reported" ? typeof value.value === "string" : value.value === null)
    && ["comparable", "not_comparable"].includes(value.comparability) && ["initial", "restatement", "correction"].includes(value.amendmentKind)
    && Number.isSafeInteger(value.revision) && value.revision > 0
    && ["current", "replaced", "historical_source_superseded", "historical_source_stale", "retracted", "invalid"].includes(value.valueState)
    && value.provenance.factKind === "issuer_reported" && value.provenance.transcription === "owner_manual"
    && ["unverified", "verified", "owner_confirmed", "source_text_verified"].includes(value.provenance.verificationStatus)
    && positive(value.source.materialId) && validFundamentalSource(value.source)
    && Number.isFinite(Date.parse(value.createdAt));
}

function validFundamentalSource(source: ResearchFundamentalValueData["source"]): boolean {
  if (source.kind === "source_snapshot") {
    const citation = source.snapshotCitation, original = source.snapshotOriginal;
    return citation.kind === "source_snapshot" && positive(citation.snapshotId)
      && /^[a-f0-9]{64}$/.test(citation.textSha256) && /^[a-f0-9]{64}$/.test(citation.excerptSha256)
      && Number.isSafeInteger(citation.startUtf16) && citation.startUtf16 >= 0
      && Number.isSafeInteger(citation.endUtf16) && citation.endUtf16 > citation.startUtf16
      && /^[a-f0-9]{64}$/.test(original.rawSha256) && Number.isSafeInteger(original.byteLength)
      && original.byteLength > 0 && original.mediaType === "text/html"
      && original.canonicalUrl.startsWith("https://") && original.responseUrl.startsWith("https://");
  }
  return positive(source.documentId) && /^[a-f0-9]{64}$/.test(source.documentPdfSha256)
    && /^[a-f0-9]{64}$/.test(source.pageTextSha256) && Number.isSafeInteger(source.pageNumber)
    && source.pageNumber > 0;
}

function validMembership(value: ResearchDossierMembership): boolean {
  return positive(value.id) && Number.isSafeInteger(value.version) && value.version > 0
    && ["tracked", "paused"].includes(value.state) && /^HK\.\d{5}$/.test(value.symbol);
}
function positive(value: unknown): value is string { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function sameJson(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
