import type { Pool, PoolClient } from "pg";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import {
  RESEARCH_COMPLETENESS_SCHEMA_VERSION,
  buildResearchCompletenessSnapshot,
  validateCreateResearchCompletenessRequest,
  validateResearchCompletenessSnapshot,
  type CreateResearchCompletenessRequest,
  type ResearchCompletenessEnvelope,
  type ResearchCompletenessExternalSectionInput,
  type ResearchCompletenessSection,
  type ResearchCompletenessSnapshotData
} from "../../../../packages/contracts/src/researchCompleteness.js";
import {
  EVIDENCE_BOUND_REPORT_CONTRACT_VERSION,
  type DeepResearchReportData,
  type EvidenceBoundDeepResearchReportPayload
} from "../../../../packages/contracts/src/deepResearch.js";
import {
  DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
  type SynthesizedDeepResearchReportPayload
} from "../../../../packages/contracts/src/deepResearchSynthesisReport.js";
import { RESEARCH_CONTEXT_SCHEMA_VERSION, type ResearchContextSnapshotData, type ResearchPeerSourceIssue } from "../../../../packages/contracts/src/researchContext.js";
import { RESEARCH_FUNDAMENTALS_SCHEMA_VERSION, researchFundamentalCurrentlyUsable, type ResearchFundamentalsEnvelope } from "../../../../packages/contracts/src/researchFundamentals.js";
import type { SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";
import type { DecisionContextEnvelope } from "../../../../packages/contracts/src/decisionContext.js";
import { QUANT_FORMAL_EVIDENCE_CHECK_IDS } from "../../../../packages/contracts/src/quantDecisionEvidence.js";
import { RESEARCH_WRITE_SCHEMA_VERSION, type ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { requestFingerprint } from "./deepResearchGate.js";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import { assertCandidateMembershipWriteBinding } from "./researchWriteBinding.js";
import { readResearchFundamentals } from "./researchFundamentalRepository.js";
import { readResearchContextSnapshot } from "./researchContextRepository.js";
import { IdempotencyConflictError, type AuthenticatedResearchActor } from "./domain.js";
import { readCurrentResearchValuationScenarios } from "./researchValuationScenarioRepository.js";
import { readProviderValuationScenarioSets } from "./researchValuationProviderScenarioRepository.js";
import { readFcffScenarioSets, readProviderFcffScenarioSets } from "./researchValuationFcffScenarioRepository.js";
import { FCFF_METHOD_ID } from "../../../../packages/contracts/src/researchValuationFcff.js";
import type { ResearchMaterialData } from "../../../../packages/contracts/src/researchMaterial.js";
import {
  readEvidencePackInvalidatedBy,
  readLatestDeepResearchReport,
  readLatestEvidencePack,
  readResearchMaterials
} from "./deepResearchPersistence.js";
import { readExistingResearchProfileBinding } from "./writePersistence.js";
import type { FrozenWeinsteinEvidenceBinding } from "../../../../packages/contracts/src/weinsteinTechnicalAnalysis.js";
import {
  loadAnnualPortfolioLabQuantEvidence,
  type AnnualPortfolioLabQuantEvidenceLoadResult
} from "./annualPortfolioLabQuantEvidence.js";
import type { QuantEvidenceRuntimeOptions } from "./quantEvidenceSource.js";
import { readDecisionQuantEvidence } from "./decisionQuantEvidenceAdapter.js";

interface ResearchCompletenessQuantInput {
  decision: DecisionContextEnvelope["quantEvidence"] | null;
  portfolio: AnnualPortfolioLabQuantEvidenceLoadResult | null;
  requestedSymbol: string;
  maxAgeDays: number;
  now: Date;
}

type CurrentValuationSources = {
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  providerPe: Awaited<ReturnType<typeof readProviderValuationScenarioSets>>;
  issuerFcff: Awaited<ReturnType<typeof readFcffScenarioSets>>;
  providerFcff: Awaited<ReturnType<typeof readProviderFcffScenarioSets>>;
  materials: ResearchMaterialData[];
};

interface ResearchCompletenessRow {
  id: string;
  candidate_membership_id: string;
  captured_membership_version: number | string;
  actor_id: string;
  symbol: string;
  source_payload: unknown;
  valid_until: Date | string;
  created_at: Date | string;
  request_fingerprint: string;
}

export class ResearchCompletenessError extends Error {
  readonly statusCode: 400 | 403 | 404 | 409 | 422 | 503;
  readonly code: string;
  constructor(statusCode: ResearchCompletenessError["statusCode"], code: string, message: string) {
    super(message); this.name = "ResearchCompletenessError"; this.statusCode = statusCode; this.code = code;
  }
}

export async function createResearchCompletenessSnapshot(
  pool: Pool,
  membershipId: string,
  request: CreateResearchCompletenessRequest,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  quantEvidence: QuantEvidenceRuntimeOptions | null = null,
  sourceStore?:SourceSnapshotStoreOptions
): Promise<ResearchWriteEnvelope<ResearchCompletenessSnapshotData>> {
  const validation = validateCreateResearchCompletenessRequest(request);
  if (!validation.ok) throw new ResearchCompletenessError(400, "INVALID_COMPLETENESS", validation.errors.join("; "));
  if (actor.actorType !== "user") throw new ResearchCompletenessError(403, "OWNER_REQUIRED", "an explicit user actor is required");
  if (request.externalSections.some((section) => section.status === "available")) {
    throw new ResearchCompletenessError(
      422,
      "UNVERIFIED_EXTERNAL_COMPLETENESS",
      "valuation, quant, Weinstein, risk, counterevidence, and conflict coverage must be derived from current server-bound sources"
    );
  }
  if (Date.parse(request.validUntil) <= now.getTime()) throw new ResearchCompletenessError(409, "STALE_COMPLETENESS", "completeness validUntil must be in the future");
  const fingerprint = requestFingerprint("research_completeness_create", { actor, membershipId, request });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const membership = await assertCandidateMembershipWriteBinding(client, actor, { membershipId, membershipVersion: request.membershipVersion });
    const existing = await findByIdempotency(client, actor.actorId, request.idempotencyKey);
    if (existing) {
      if (existing.request_fingerprint !== fingerprint) throw new IdempotencyConflictError("completeness idempotency key already binds different sources");
      await client.query("commit");
      return writeEnvelope(rowToSnapshot(existing), actor, "Research completeness write replayed.");
    }
    const latest = await findLatest(client, membershipId, actor.actorId);
    if ((latest?.id ?? null) !== request.baseSnapshotId) throw new ResearchCompletenessError(409, "COMPLETENESS_VERSION_CONFLICT", "completeness base snapshot is stale");
    const [fundamentals, context] = await Promise.all([
      readResearchFundamentals(client, membershipId, actor, now, undefined, sourceStore),
      readResearchContextSnapshot(client, membershipId, actor, now, sourceStore)
    ]);
    if (fundamentals.dataCutoffAt !== request.expectedFundamentalsDataCutoffAt
      || (context.status === "available" ? context.data?.id ?? null : null) !== request.expectedResearchContextId) {
      throw new ResearchCompletenessError(409, "COMPLETENESS_SOURCE_DRIFT", "fundamentals or research context changed; fresh-read before writing completeness");
    }
    const derived = buildDerivedCompletenessSections(fundamentals, context.data, now, context.peerSourceIssues);
    const external = await readServerDerivedExternalCompletenessSections(client, membershipId, membership, actor, now, quantEvidence, sourceStore);
    const earliestSourceExpiry = [...derived, ...external]
      .flatMap((section) => section.sourceBindings).map((binding) => Date.parse(binding.validUntil)).sort((a, b) => a - b)[0];
    const validUntil = new Date(Math.min(Date.parse(request.validUntil), earliestSourceExpiry ?? Number.POSITIVE_INFINITY)).toISOString();
    const inserted = await client.query<{ id: string; created_at: Date | string }>(
      `insert into research_completeness_snapshots
        (candidate_membership_id, captured_membership_version, actor_id, symbol, source_payload,
         valid_until, idempotency_key, request_fingerprint, created_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
       returning id, created_at`,
      [membershipId, request.membershipVersion, actor.actorId, membership.symbol, JSON.stringify({ derived, external }), validUntil, request.idempotencyKey, fingerprint, now]
    );
    const identity = {
      id: String(inserted.rows[0]?.id), membershipId, membershipVersion: request.membershipVersion,
      symbol: membership.symbol, actorId: actor.actorId, validUntil,
      createdAt: new Date(inserted.rows[0]?.created_at ?? now).toISOString()
    };
    const data = buildResearchCompletenessSnapshot(identity, derived, external);
    if (!validateResearchCompletenessSnapshot(data).ok) throw new ResearchCompletenessError(503, "COMPLETENESS_READ_BACK_FAILED", "created completeness snapshot failed validation");
    await client.query("commit");
    return writeEnvelope(data, actor, `Research completeness for ${membership.symbol} recorded.`);
  } catch (error) {
    await client.query("rollback"); throw error;
  } finally { client.release(); }
}

export async function readResearchCompletenessSnapshot(
  pool: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  quantEvidence: QuantEvidenceRuntimeOptions | null = null,
  sourceStore?:SourceSnapshotStoreOptions
): Promise<ResearchCompletenessEnvelope> {
  const generatedAt = now.toISOString();
  const membership = await readCandidateMembershipById(pool, actor, membershipId);
  if (!membership) return unavailable(generatedAt, membershipId, actor.actorId, null, "not_found", "candidate membership was not found");
  const row = await findLatest(pool, membershipId, actor.actorId);
  if (!row) return unavailable(generatedAt, membershipId, actor.actorId, membership.symbol, "not_found", "research completeness is missing");
  if (Number(row.captured_membership_version) !== Number(membership.version) || row.symbol !== membership.symbol || new Date(row.valid_until).getTime() <= now.getTime()) {
    return unavailable(generatedAt, membershipId, actor.actorId, membership.symbol, "unavailable", "research completeness identity or runtime horizon drifted", String(row.id));
  }
  let data: ResearchCompletenessSnapshotData;
  try { data = rowToSnapshot(row); } catch { return unavailable(generatedAt, membershipId, actor.actorId, membership.symbol, "unavailable", "stored research completeness is malformed", String(row.id)); }
  if (!validateResearchCompletenessSnapshot(data).ok) return unavailable(generatedAt, membershipId, actor.actorId, membership.symbol, "unavailable", "stored research completeness failed contract validation", String(row.id));
  const [fundamentals, context, external] = await Promise.all([
    readResearchFundamentals(pool, membershipId, actor, now, undefined, sourceStore),
    readResearchContextSnapshot(pool, membershipId, actor, now, sourceStore),
    readServerDerivedExternalCompletenessSections(pool, membershipId, membership, actor, now, quantEvidence, sourceStore)
  ]);
  const expected = [...buildDerivedCompletenessSections(fundamentals, context.data, now, context.peerSourceIssues), ...external];
  if (canonicalJson(data.sections) !== canonicalJson(expected)) {
    return unavailable(generatedAt, membershipId, actor.actorId, membership.symbol, "unavailable", "research completeness sources drifted; write a new exact snapshot", String(row.id));
  }
  return { schemaVersion: RESEARCH_COMPLETENESS_SCHEMA_VERSION, generatedAt, status: "available", membershipId, requestedActorId: actor.actorId, requestedSymbol: membership.symbol, latestSnapshotId: data.id, data, message: "Research coverage and exact UNKNOWN gaps are current." };
}

export function buildDerivedCompletenessSections(
  fundamentals: ResearchFundamentalsEnvelope,
  context: ResearchContextSnapshotData | null,
  now = new Date(),
  peerSourceIssues: ResearchPeerSourceIssue[] = []
): ResearchCompletenessSection[] {
  const currentFundamentals = fundamentals.values.filter(researchFundamentalCurrentlyUsable);
  const fundamentalValidUntil = currentFundamentals.map((value) => value.source.validUntil).sort()[0];
  const requirement=fundamentals.financialCoverage.requirement;
  const financialAvailable = fundamentals.financialCoverage.status === "available"
    && fundamentals.dataCutoffAt !== null && fundamentalValidUntil !== undefined;
  const financial: ResearchCompletenessSection = {
    section: "financials", status: financialAvailable ? "available" : "unknown",
    coverage: { achieved: Math.min(fundamentals.financialCoverage.completeAnnualPeriods + (fundamentals.financialCoverage.latestInterimStatus === "complete" ? 1 : 0), 6), required: 6 },
    sourceBindings: financialAvailable ? [
      { sourceType: "fundamentals", sourceId: fundamentals.dataCutoffAt!, sourceVersion: RESEARCH_FUNDAMENTALS_SCHEMA_VERSION, asOf: fundamentals.dataCutoffAt!, validUntil: fundamentalValidUntil! },
      { sourceType: "financial_requirement", sourceId: requirement!.id, sourceVersion: requirement!.schemaVersion, asOf: requirement!.asOf, validUntil: requirement!.validUntil }
    ] : [],
    gaps: financialAvailable ? [] : fundamentals.financialCoverage.gaps.length ? fundamentals.financialCoverage.gaps : ["financial coverage is UNKNOWN"]
  };
  const currentKpis = context?.operatingKpis.filter((item) => Date.parse(item.validUntil) > now.getTime()) ?? [];
  const comparableYears = (category: "operating" | "price") => {
    const series = new Map<string, Set<string>>();
    for (const item of currentKpis.filter((candidate) => candidate.category === category
      && candidate.valueStatus === "reported" && candidate.comparability === "comparable")) {
      const key = `${item.metric}\u0000${item.unit}`;
      const years = series.get(key) ?? new Set<string>();
      years.add(item.periodEnd.slice(0, 4));
      series.set(key, years);
    }
    return Math.max(0, ...[...series.values()].map((years) => years.size));
  };
  const operatingYears = comparableYears("operating");
  const priceYears = comparableYears("price");
  const kpiAvailable = context !== null && operatingYears >= 3 && priceYears >= 3;
  const kpi: ResearchCompletenessSection = {
    section: "kpi", status: kpiAvailable ? "available" : "unknown",
    coverage: { achieved: Math.min(operatingYears, priceYears, 3), required: 3 },
    sourceBindings: kpiAvailable ? [contextBinding(context!)] : [], gaps: kpiAvailable ? [] : [
      ...operatingYears < 3 ? [`operating KPI requires 3 comparable years; found ${operatingYears}`] : [],
      ...priceYears < 3 ? [`price trend requires 3 comparable years; found ${priceYears}`] : []
    ]
  };
  const unusablePeerIds = new Set(peerSourceIssues.map((issue) => issue.peerId));
  const includedPeers = context?.peers.filter((peer) => peer.status === "included"
    && !unusablePeerIds.has(peer.id)) ?? [];
  const peerCount = includedPeers.length;
  const comparablePeerSymbols = new Set(context?.comparisons
    .filter((comparison) => {
      const selected = context.selectedFacts.find(fact => fact.id === comparison.selectedFactId);
      const peer = context.peerFacts.find(fact => fact.id === comparison.peerFactId);
      return comparison.status === "available" && selected?.periodEnd !== undefined
        && selected.periodEnd === peer?.periodEnd && selected.periodStart === peer?.periodStart;
    })
    .map((comparison) => comparison.peerSymbol) ?? []);
  const peersWithComparison = includedPeers.filter((peer) => comparablePeerSymbols.has(peer.symbol)).length;
  const hasPeerComparisons = peerCount > 0 && peersWithComparison === peerCount;
  const industryDimensions = new Set(context?.industryDrivers.map((item) => item.dimension) ?? []);
  const hasAllIndustry = ["supply", "demand", "pricing", "competition", "policy", "cycle"].every((dimension) => industryDimensions.has(dimension as never));
  const hasMacro = context?.macroDrivers.some((item) => item.thesisRelevance.trim().length > 0) ?? false;
  const peersAvailable = context !== null && peerCount >= 3 && peerCount <= 5 && hasPeerComparisons && hasAllIndustry && hasMacro;
  const peers: ResearchCompletenessSection = {
    section: "peers", status: peersAvailable ? "available" : "unknown",
    coverage: { achieved: Number(peerCount >= 3 && peerCount <= 5) + Number(hasPeerComparisons) + Number(hasAllIndustry) + Number(hasMacro), required: 4 },
    sourceBindings: peersAvailable ? [contextBinding(context!)] : [],
    gaps: peersAvailable ? [] : [
      ...peerSourceIssues.map((issue) => `peer ${issue.symbol} saved source is ${issue.status}; select a new exact source`),
      ...peerCount < 3 || peerCount > 5 ? [`peer set requires 3-5 reasoned companies; found ${peerCount}`] : [],
      ...includedPeers.filter((peer) => !comparablePeerSymbols.has(peer.symbol))
        .map((peer) => `peer ${peer.symbol} requires at least one available same-metric comparison`),
      ...!hasAllIndustry ? ["industry supply, demand, pricing, competition, policy, and cycle coverage is UNKNOWN"] : [],
      ...!hasMacro ? ["thesis-relevant macro coverage is UNKNOWN"] : []
    ]
  };
  return [financial, kpi, peers];
}

export function buildServerDerivedExternalCompletenessSections(
  valuations: Awaited<ReturnType<typeof readCurrentResearchValuationScenarios>>,
  report: DeepResearchReportData | null,
  weinstein: FrozenWeinsteinEvidenceBinding | null = null,
  quant: ResearchCompletenessQuantInput | null = null,
  now = new Date(),
  sources: CurrentValuationSources | null = null
): ResearchCompletenessExternalSectionInput[] {
  const isFuture = (value: string) => Number.isFinite(Date.parse(value)) && Date.parse(value) > now.getTime();
  const currentValuations = valuations.filter((valuation) => valuation.scenarioState === "current"
    && valuation.recomputable && valuation.invalidatedBy.length === 0
    && isFuture(valuation.anchor.source.validUntil));
  const issuerPe = currentValuations.find((value) =>
    value.calculation.method.id === "discounted_forward_metric_multiple_user_scenario");
  const issuerNav = currentValuations.find((value) =>
    value.calculation.method.id === "adjusted_net_asset_value_user_scenario");
  const matchingMaterial = (id: string, revision: number, fingerprint?: string): ResearchMaterialData | undefined =>
    sources?.materials.find((material) => material.id === id && material.revision === revision
      && material.symbol === sources.symbol && material.revisionState === "current"
      && material.freshness === "fresh" && isFuture(material.validUntil)
      && (fingerprint === undefined || material.contentFingerprint === fingerprint));
  const exactIssuerFacts = (facts: CurrentValuationSources["issuerFcff"][number]["historicalOriginals"]["facts"]): ResearchMaterialData[] | null => {
    if (facts.length === 0) return null;
    const matched: ResearchMaterialData[] = [];
    for (const fact of facts) {
      const material = matchingMaterial(fact.materialId, fact.materialRevision);
      if (!material) return null;
      matched.push(material);
    }
    return matched;
  };
  const providerPe = sources?.providerPe.map((scenario) => ({ scenario,
    material: matchingMaterial(scenario.providerBasis.sourceMaterialId,
      scenario.providerBasis.sourceMaterialRevision, scenario.providerBasis.sourceMaterialFingerprint)
  })).find(({ scenario, material }) => scenario.membershipId === sources.membershipId
    && scenario.membershipVersionAtWrite === sources.membershipVersion && scenario.symbol === sources.symbol
    && scenario.basisKind === "provider"
    && scenario.calculation.method.id === "discounted_forward_metric_multiple_user_scenario"
    && scenario.scenarioState === "current" && scenario.recomputable && scenario.invalidatedBy.length === 0
    && material !== undefined && Date.parse(material.validUntil) > Date.parse(scenario.createdAt));
  const issuerFcff = sources?.issuerFcff.map((scenario) => ({ scenario,
    materials: exactIssuerFacts(scenario.historicalOriginals.facts)
  })).find(({ scenario, materials }) => scenario.membershipId === sources.membershipId
    && scenario.membershipVersionAtWrite === sources.membershipVersion && scenario.symbol === sources.symbol
    && scenario.calculation.methodId === FCFF_METHOD_ID
    && scenario.scenarioState === "current" && scenario.recomputable && scenario.invalidatedBy.length === 0
    && materials !== null && materials.every((material) => Date.parse(material.validUntil) > Date.parse(scenario.createdAt)));
  const providerFcff = sources?.providerFcff.map((scenario) => ({ scenario,
    material: matchingMaterial(scenario.providerReference.materialId,
      scenario.providerReference.materialRevision, scenario.providerReference.materialFingerprint)
  })).find(({ scenario, material }) => scenario.membershipId === sources.membershipId
    && scenario.membershipVersionAtWrite === sources.membershipVersion && scenario.symbol === sources.symbol
    && scenario.calculation.methodId === FCFF_METHOD_ID
    && scenario.scenarioState === "current" && scenario.recomputable && scenario.invalidatedBy.length === 0
    && material !== undefined && Date.parse(material.validUntil) > Date.parse(scenario.createdAt));
  const methods = new Set<string>(currentValuations.map((valuation) => valuation.calculation.method.id));
  if (providerPe) methods.add(providerPe.scenario.calculation.method.id);
  if (issuerFcff) methods.add(FCFF_METHOD_ID);
  // Coverage measures full-research methods; separately name current provider references in UNKNOWN gaps.
  const limitedReferences = [
    ...(providerPe ? [`OpenD PE #${providerPe.scenario.id} r${providerPe.scenario.revision}`] : []),
    ...(providerFcff ? [`OpenD provider-reference FCFF #${providerFcff.scenario.id} r${providerFcff.scenario.revision}`] : [])
  ];
  const legacyPair = !!issuerPe && !!issuerNav;
  const providerIssuerPair = !!providerPe && !!issuerFcff;
  const issuerPair = !!issuerPe && !!issuerFcff;
  const valuationAvailable = legacyPair || providerIssuerPair || issuerPair;
  const fcffBinding = issuerFcff?.materials?.length ? {
    sourceType: "valuation" as const,
    sourceId: `issuer-fcff:${issuerFcff.scenario.id}:r${issuerFcff.scenario.revision}`,
    sourceVersion: `${issuerFcff.scenario.calculation.calculationVersion}:${issuerFcff.scenario.sourceFingerprint}`,
    asOf: issuerFcff.scenario.createdAt,
    validUntil: issuerFcff.materials.map((material) => material.validUntil).sort()[0]!
  } : null;
  const providerPeBinding = providerPe?.material ? {
    sourceType: "valuation" as const,
    sourceId: `provider-pe:${providerPe.scenario.id}:r${providerPe.scenario.revision}`,
    sourceVersion: `${providerPe.scenario.calculation.method.calculationVersion}:${providerPe.scenario.providerBasis.sourceMaterialFingerprint}`,
    asOf: providerPe.scenario.createdAt,
    validUntil: providerPe.material.validUntil
  } : null;
  const valuationSection: ResearchCompletenessExternalSectionInput = valuationAvailable ? {
    section: "valuation", status: "available", coverage: { achieved: 2, required: 2 },
    sourceBindings: legacyPair ? currentValuations.map((valuation) => ({
      sourceType: "valuation", sourceId: valuation.id,
      sourceVersion: valuation.calculation.method.calculationVersion,
      asOf: valuation.createdAt, validUntil: valuation.anchor.source.validUntil
    })) : providerIssuerPair ? [providerPeBinding!, fcffBinding!] : [
      { sourceType: "valuation", sourceId: issuerPe!.id,
        sourceVersion: issuerPe!.calculation.method.calculationVersion,
        asOf: issuerPe!.createdAt, validUntil: issuerPe!.anchor.source.validUntil },
      fcffBinding!
    ], gaps: []
  } : {
    section: "valuation", status: "unknown", coverage: { achieved: Math.min(methods.size, 2), required: 2 },
    sourceBindings: [], gaps: [methods.size >= 2
      ? "two distinct current methods exist, but no supported source-complete PE/NAV or PE/issuer-original FCFF pair is available"
      : `full-research valuation coverage requires two applicable current methods; found ${methods.size}`,
      ...(limitedReferences.length ? [`current source-valid references readable in limited research: ${limitedReferences.join("; ")}`] : []),
      ...(providerFcff && !issuerFcff ? ["provider-reference FCFF cannot replace missing issuer-original FCFF in full research"] : [])]
  };
  const currentReport = report?.status === "complete_pending_confirmation" && report.currentness.status === "current"
    && report.reportFingerprint !== "UNKNOWN"
    && [EVIDENCE_BOUND_REPORT_CONTRACT_VERSION, DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION].includes(report.contractVersion)
    ? report : null;
  const payload = currentReport?.payload as EvidenceBoundDeepResearchReportPayload | SynthesizedDeepResearchReportPayload | undefined;
  const validUntil = payload?.adviceLayer.applicableUntil;
  const reportBinding = currentReport && validUntil && isFuture(validUntil) ? {
    sourceType: "evidence" as const,
    sourceId: currentReport.id,
    sourceVersion: currentReport.reportFingerprint,
    asOf: currentReport.createdAt,
    validUntil
  } : null;
  const reportGap = validUntil && !isFuture(validUntil)
    ? `current source-bound report expired at ${validUntil}` : "current source-bound report coverage is UNKNOWN";
  const reportSection = (section: "risks" | "counterevidence", values: Array<{ sourceKind: string }> | undefined) =>
    reportBinding && values?.some((item) => item.sourceKind !== "source_missing")
      ? availableSection(section, reportBinding.sourceType, reportBinding.sourceId, reportBinding.sourceVersion, reportBinding.asOf, reportBinding.validUntil)
      : unknownSection(section, `${reportGap}; ${section} is UNKNOWN`);
  const conflictsAvailable = reportBinding && payload
    && payload.adviceLayer.conflict.status !== "UNKNOWN"
    && payload.adviceLayer.conflict.description.trim().length > 0;
  const weinsteinValidUntil = weinstein ? `${weinstein.analysisAsOf}T23:59:59+08:00` : null;
  return [
    valuationSection,
    quantCompletenessSection(quant),
    weinstein && weinsteinValidUntil && isFuture(weinsteinValidUntil)
      ? availableSection("weinstein", "weinstein", weinstein.datasetHash,
        weinstein.resultHash, `${weinstein.analysisAsOf}T00:00:00+08:00`, weinsteinValidUntil)
      : unknownSection("weinstein", weinsteinValidUntil
        ? `Weinstein evidence expired at ${weinsteinValidUntil}`
        : "Weinstein evidence is not yet persisted in the frozen research pack"),
    reportSection("risks", payload?.researchLayer.risks),
    reportSection("counterevidence", payload?.researchLayer.counterevidence),
    conflictsAvailable ? availableSection("conflicts", reportBinding!.sourceType, reportBinding!.sourceId,
      reportBinding!.sourceVersion, reportBinding!.asOf, reportBinding!.validUntil)
      : unknownSection("conflicts", reportBinding ? "current source-conflict assessment is UNKNOWN" : reportGap)
  ];
}

async function readServerDerivedExternalCompletenessSections(
  client: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  membership: { version: number | string; state: "tracked" | "paused" | "archived"; market: string; code: string; symbol: string },
  actor: AuthenticatedResearchActor,
  now: Date,
  quantEvidence: QuantEvidenceRuntimeOptions | null,
  sourceStore?:SourceSnapshotStoreOptions
): Promise<ResearchCompletenessExternalSectionInput[]> {
  const quantOptions = quantEvidence?.annualPortfolioLab ?? null;
  const decisionOptions = quantEvidence?.decision ?? null;
  const [valuations, providerPe, issuerFcff, providerFcff, decisionQuant, portfolioQuant] = await Promise.all([
    readCurrentResearchValuationScenarios(
      client, membershipId, actor, Number(membership.version), membership.state, now, sourceStore
    ),
    readProviderValuationScenarioSets(client, membershipId, actor, now, sourceStore),
    readFcffScenarioSets(client, membershipId, actor, now, sourceStore),
    readProviderFcffScenarioSets(client, membershipId, actor, now, sourceStore),
    decisionOptions ? readDecisionQuantEvidence(membership.symbol, now, decisionOptions) : Promise.resolve(null),
    quantOptions
      ? loadAnnualPortfolioLabQuantEvidence(quantOptions, now)
      : Promise.resolve(null)
  ]);
  const quant = decisionOptions || quantOptions ? {
    decision: decisionQuant,
    portfolio: portfolioQuant,
    requestedSymbol: membership.symbol,
    maxAgeDays: decisionOptions?.maxAgeDays ?? quantOptions!.maxAgeDays,
    now
  } : null;
  const profile = await readExistingResearchProfileBinding(client, membership.market, membership.code, membership.symbol);
  const sources: CurrentValuationSources = {
    membershipId, membershipVersion: Number(membership.version), symbol: membership.symbol,
    providerPe, issuerFcff, providerFcff,
    materials: profile ? await readResearchMaterials(client, profile.profileId, membershipId, now) : []
  };
  if (!profile) return buildServerDerivedExternalCompletenessSections(valuations, null, null, quant, now, sources);
  const pack = await readLatestEvidencePack(client, profile.profileId, membershipId, Number(membership.version), now);
  if (!pack || (await readEvidencePackInvalidatedBy(client, profile.profileId, pack, actor, {
    id: membershipId, version: Number(membership.version), state: membership.state,
    market: membership.market, code: membership.code, symbol: membership.symbol
  }, now, undefined, undefined, sourceStore)).length > 0) return buildServerDerivedExternalCompletenessSections(valuations, null, null, quant, now, sources);
  const report = await readLatestDeepResearchReport(client, profile.profileId, membershipId, Number(membership.version));
  return buildServerDerivedExternalCompletenessSections(
    valuations, report?.evidencePackId === pack.id ? report : null, pack.frozenResearchContext?.weinstein ?? null, quant, now, sources
  );
}

function quantCompletenessSection(input: ResearchCompletenessQuantInput | null): ResearchCompletenessExternalSectionInput {
  const required = QUANT_FORMAL_EVIDENCE_CHECK_IDS.length + 1;
  if (!input || !validMaxAgeDays(input.maxAgeDays)) {
    return { section: "quant", status: "unknown", coverage: { achieved: 0, required }, sourceBindings: [], gaps: ["stock-level formal quant and portfolio-risk evidence are not configured"] };
  }
  const decision = input.decision;
  const decisionEvidence = decision?.decisionEvidence;
  const refinement = decision?.status === "available" && decisionEvidence?.status === "available"
    && decisionEvidence.symbol === input.requestedSymbol ? decisionEvidence : null;
  const checks = refinement?.formalEvidence?.checks ?? [];
  const availableChecks = checks.filter((check) => check.status === "available");
  const decisionFetchedAt = decision?.metadata.fetchedAt ?? null;
  const decisionValidUntil = decisionFetchedAt ? Date.parse(decisionFetchedAt) + input.maxAgeDays * 86_400_000 : Number.NaN;
  const decisionAvailable = refinement !== null
    && refinement.formalEvidence?.candidateResearchRule.eligibilityEvidenceStatus === "available"
    && checks.length === QUANT_FORMAL_EVIDENCE_CHECK_IDS.length
    && availableChecks.length === checks.length
    && Number.isFinite(decisionValidUntil) && decisionValidUntil > input.now.getTime();

  const portfolio = input.portfolio?.ok ? input.portfolio.evidence : null;
  const portfolioContentHash = input.portfolio?.ok ? input.portfolio.contentHash : null;
  const portfolioFetchedAt = portfolio?.source.sourceIdentity.fetchedAt ?? null;
  const portfolioValidUntil = portfolioFetchedAt ? Date.parse(portfolioFetchedAt) + input.maxAgeDays * 86_400_000 : Number.NaN;
  const portfolioAvailable = portfolio !== null
    && portfolio.source.universe.some((item) => item.symbol === input.requestedSymbol)
    && portfolio.stability.status === "sample_threshold_met"
    && Number.isFinite(portfolioValidUntil) && portfolioValidUntil > input.now.getTime();
  const achieved = availableChecks.length + Number(portfolioAvailable);
  if (!decisionAvailable || !portfolioAvailable) {
    const formalGaps = checks.filter((check) => check.status === "unknown").map((check) => `${check.id}: ${check.limitation}`);
    return { section: "quant", status: "unknown", coverage: { achieved, required }, sourceBindings: [], gaps: [
      ...(refinement ? formalGaps : [decision?.message ?? `stock-level formal quant evidence is unavailable for ${input.requestedSymbol}`]),
      ...(!portfolioAvailable ? [input.portfolio?.ok === false ? input.portfolio.reason : `versioned portfolio-risk evidence is unavailable for ${input.requestedSymbol}`] : [])
    ].map((gap) => gap.slice(0, 1_000)) };
  }
  return {
    section: "quant", status: "available", coverage: { achieved: required, required }, gaps: [],
    sourceBindings: [
      { sourceType: "quant", sourceId: refinement.refinementId!, sourceVersion: decision!.metadata.source,
        asOf: refinement.source!.dataCutoff, validUntil: new Date(decisionValidUntil).toISOString() },
      { sourceType: "quant", sourceId: portfolio.evidenceId, sourceVersion: `sha256:${portfolioContentHash!}`,
        asOf: portfolio.source.dataCutoff, validUntil: new Date(portfolioValidUntil).toISOString() }
    ]
  };
}

function validMaxAgeDays(value: number): boolean { return Number.isFinite(value) && value >= 0; }

function availableSection(
  section: ResearchCompletenessExternalSectionInput["section"],
  sourceType: ResearchCompletenessExternalSectionInput["sourceBindings"][number]["sourceType"],
  sourceId: string,
  sourceVersion: string,
  asOf: string,
  validUntil: string
): ResearchCompletenessExternalSectionInput {
  return { section, status: "available", coverage: { achieved: 1, required: 1 },
    sourceBindings: [{ sourceType, sourceId, sourceVersion, asOf, validUntil }], gaps: [] };
}

function unknownSection(
  section: ResearchCompletenessExternalSectionInput["section"],
  gap: string
): ResearchCompletenessExternalSectionInput {
  return { section, status: "unknown", coverage: { achieved: 0, required: 1 }, sourceBindings: [], gaps: [gap] };
}

function contextBinding(context: ResearchContextSnapshotData) {
  return { sourceType: "research_context" as const, sourceId: context.id, sourceVersion: RESEARCH_CONTEXT_SCHEMA_VERSION, asOf: context.cutoffAt, validUntil: context.validUntil };
}

function rowToSnapshot(row: ResearchCompletenessRow): ResearchCompletenessSnapshotData {
  const payload = row.source_payload as { derived: ResearchCompletenessSection[]; external: Parameters<typeof buildResearchCompletenessSnapshot>[2] };
  return buildResearchCompletenessSnapshot({
    id: String(row.id), membershipId: String(row.candidate_membership_id), membershipVersion: Number(row.captured_membership_version),
    symbol: row.symbol, actorId: row.actor_id, validUntil: new Date(row.valid_until).toISOString(), createdAt: new Date(row.created_at).toISOString()
  }, payload.derived, payload.external);
}

async function findLatest(client: Pick<Pool | PoolClient, "query">, membershipId: string, actorId: string): Promise<ResearchCompletenessRow | null> {
  const result = await client.query<ResearchCompletenessRow>(`${select()} where candidate_membership_id = $1 and actor_id = $2 order by id desc limit 1`, [membershipId, actorId]);
  return result.rows[0] ?? null;
}
async function findByIdempotency(client: Pick<Pool | PoolClient, "query">, actorId: string, key: string): Promise<ResearchCompletenessRow | null> {
  const result = await client.query<ResearchCompletenessRow>(`${select()} where actor_id = $1 and idempotency_key = $2 limit 1`, [actorId, key]);
  return result.rows[0] ?? null;
}
function select(): string { return "select id, candidate_membership_id, captured_membership_version, actor_id, symbol, source_payload, valid_until, created_at, request_fingerprint from research_completeness_snapshots"; }
function unavailable(generatedAt: string, membershipId: string, actorId: string, symbol: string | null, status: "not_found" | "unavailable", message: string, latestSnapshotId: string | null = null): ResearchCompletenessEnvelope {
  return { schemaVersion: RESEARCH_COMPLETENESS_SCHEMA_VERSION, generatedAt, status, membershipId, requestedActorId: actorId, requestedSymbol: symbol, latestSnapshotId, data: null, message };
}
function writeEnvelope(data: ResearchCompletenessSnapshotData, actor: AuthenticatedResearchActor, message: string): ResearchWriteEnvelope<ResearchCompletenessSnapshotData> {
  return { schemaVersion: RESEARCH_WRITE_SCHEMA_VERSION, status: "succeeded", asOf: data.createdAt, source: { actorType: actor.actorType, actorId: actor.actorId, correlationId: null }, data, message };
}
