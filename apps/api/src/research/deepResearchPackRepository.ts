import type { FreezeLimitedResearchRequest, SelectedLimitedResearchMaterial } from "../../../../packages/contracts/src/limitedResearch.js";
import type { Pool } from "pg";
import type {
  ExpectedFrozenQuantPortfolioIdentity,
  FrozenResearchEvidenceContext,
  FrozenQuantPortfolioEvidenceBinding,
  FreezeEvidencePackRequest,
  ResearchEvidencePackData
} from "../../../../packages/contracts/src/deepResearch.js";
import type { DailyTechnicalEnvelope } from "../../../../packages/contracts/src/marketDaily.js";
import type { ResearchProviderValuationScenarioSetData, ResearchValuationScenarioSetData } from "../../../../packages/contracts/src/researchValuationScenarios.js";
import { FCFF_METHOD_ID, fcffPublishedHongKongDay, type ResearchFcffScenarioSetData } from "../../../../packages/contracts/src/researchValuationFcff.js";
import { FROZEN_RESEARCH_CONTEXT_VERSION, FROZEN_RESEARCH_CONTEXT_VERSION_V2 } from "../../../../packages/contracts/src/deepResearch.js";
import type { FrozenWeinsteinEvidenceBinding } from "../../../../packages/contracts/src/weinsteinTechnicalAnalysis.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { researchEventBindsMaterial, researchStockMaterials } from "../../../../packages/contracts/src/researchEvent.js";
import {
  latestCompletedHongKongSession,
  readLatestDailyTechnicalSnapshot
} from "../market/dailyBarsRepository.js";
import {
  CandidateMembershipConflictError,
  CandidateMembershipNotFoundError,
  DeepResearchGateError,
  IdempotencyConflictError
} from "./domain.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import {
  evidencePackBlockers,
  evidencePackFingerprint,
  requestFingerprint
} from "./deepResearchGate.js";
import {
  frozenOperatingMonitorBinding,
  frozenResearchContextBinding,
  frozenResearchEventBinding
} from "./deepResearchEventBinding.js";
import { readLatestGeelySalesMonitor } from "./geelySalesMonitorRepository.js";
import { readLatestGclPvPriceMonitor } from "./gclPvPriceMonitorRepository.js";
import type { EvidencePackRow } from "./deepResearchMappers.js";
import { rowToEvidencePack } from "./deepResearchMappers.js";
import type { SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";
import {
  readEvidencePackInvalidatedBy,
  readResearchMaterials,
  researchSnapshotBodyChanged
} from "./deepResearchPersistence.js";
import { readCurrentResearchValuationScenarios } from "./researchValuationScenarioRepository.js";
import { readFcffScenarioSets } from "./researchValuationFcffScenarioRepository.js";
import { readProviderValuationScenarioById } from "./researchValuationProviderScenarioRepository.js";
import { readResearchContextSnapshot } from "./researchContextRepository.js";
import { readResearchFinancialRequirement } from "./researchFinancialRequirementRepository.js";
import {assertFrozenMaterialOriginals} from "./deepResearchMaterialOriginals.js";
import { readResearchEvents } from "./researchEventRepository.js";
import { assertCandidateMembershipWriteBinding, sameBoundResearchWriteReplay } from "./researchWriteBinding.js";
import { readDecisionQuantEvidence } from "./decisionQuantEvidenceAdapter.js";
import { loadAnnualPortfolioLabQuantEvidence } from "./annualPortfolioLabQuantEvidence.js";
import type { QuantEvidenceRuntimeOptions } from "./quantEvidenceSource.js";
import {
  actorRequest,
  ensureResearchProfile,
  findAuditByIdempotencyKey,
  insertWriteAudit,
  isUniqueViolation,
  upsertStock,
  writeEnvelope
} from "./writePersistence.js";

// eslint-disable-next-line complexity -- Keep full and limited freeze in one transaction with shared identity and idempotency checks.
export async function freezeResearchEvidencePack(
  pool: Pool,
  membershipId: string,
  request: FreezeEvidencePackRequest | FreezeLimitedResearchRequest,
  actor: AuthenticatedResearchActor,
  authoritativeWeinstein: FrozenWeinsteinEvidenceBinding | null,
  quantEvidence: QuantEvidenceRuntimeOptions | null,
  now = new Date(),
  retryConcurrentConflict = true,
  sourceStore?: SourceSnapshotStoreOptions
): Promise<ResearchWriteEnvelope<ResearchEvidencePackData>> {
  const limited = "researchMode" in request;
  const explicitSelection = limited && "selectedMaterials" in request && request.selectedMaterials !== undefined;
  const fullRequest = limited ? null : request;
  if (actor.actorType !== "user") throw new DeepResearchGateError("an explicit user actor is required to freeze research");
  const boundRequest = { ...request, membershipId };
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const fingerprint = requestFingerprint("evidence_pack_freeze", { boundRequest, actor });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set transaction isolation level repeatable read");
    const replay = await findAuditByIdempotencyKey<ResearchEvidencePackData>(client, request.idempotencyKey, "evidence_pack_frozen");
    if (replay) {
      if (!sameBoundResearchWriteReplay(replay, actor, boundRequest, fingerprint)) throw idempotencyConflict();
    }
    const membership = replay
      ? await readCandidateMembershipById(client, actor, membershipId)
      : await assertCandidateMembershipWriteBinding(client, actor, boundRequest);
    if (!membership) throw new CandidateMembershipNotFoundError();
    const stock = replay
      ? null
      : await upsertStock(client, membership.market, membership.code, membership.symbol, null);
    const profileId = replay
      ? await readExistingResearchProfileId(client, membership.market, membership.code)
      : await ensureResearchProfile(client, stock!);
    if (replay) {
      await assertFrozenMaterialOriginals(client,membershipId,actor,replay.envelope.data.items,sourceStore,
        replay.envelope.data.materialSelectionMode==="explicit");
      const invalidatedBy = await readEvidencePackInvalidatedBy(
        client,
        profileId,
        replay.envelope.data,
        actor,
        {
          id: membershipId,
          version: Number(membership.version),
          state: membership.state,
          market: membership.market,
          code: membership.code,
          symbol: membership.symbol
        },
        now,
        undefined,
        authoritativeWeinstein ?? undefined,
        sourceStore
      );
      await client.query("commit");
      return {
        ...replay.envelope,
        data: {
          ...replay.envelope.data,
          currentness: {
            status: invalidatedBy.length === 0 ? "current" : "historical",
            invalidatedBy
          }
        },
        message: invalidatedBy.length === 0
          ? replay.envelope.message
          : `Evidence pack ${replay.envelope.data.id} is now historical; explicit re-freeze is required.`
      };
    }
    const allItems = (await readResearchMaterials(client, profileId, membershipId, now))
      .filter((item) => item.revisionState === "current");
    const researchEvents = await readResearchEvents(
      client,
      profileId,
      membershipId,
      Number(membership.version),
      now
    );
    const eligibleItems = researchStockMaterials(allItems, researchEvents);
    const items = explicitSelection
      ? selectLimitedResearchMaterials(eligibleItems, (request as FreezeLimitedResearchRequest).selectedMaterials!) : eligibleItems;
    await assertFrozenMaterialOriginals(client,membershipId,actor,items,sourceStore,explicitSelection);
    if (await researchSnapshotBodyChanged(client,items))
      throw new DeepResearchGateError("changed official article body needs Owner source review before a new evidence pack can be frozen");
    const materialById = new Map(items.map((item) => [item.id, item]));
    const currentResearchEvent = researchEvents
      .filter((event) => event.coverageScope === "research_stock"
        && event.source.freshness === "fresh"
        && event.source.revisionState === "current"
        && materialById.has(event.source.materialId)
        && researchEventBindsMaterial(event, materialById.get(event.source.materialId)!))
      .sort((left, right) => right.eventVersion - left.eventVersion || Number(right.id) - Number(left.id))[0];
    const providerFcffSelection = !limited && fullRequest?.selectionVersion === "provider-pe-fcff-v2";
    const legacyValuationMethods = limited || providerFcffSelection ? [] : await readCurrentResearchValuationScenarios(
      client,
      membershipId,
      actor,
      Number(membership.version),
      membership.state,
      now,
      sourceStore
    );
    const wantsFcff = !limited && fullRequest?.expectedValuationMethods.some((method) => method.methodId === FCFF_METHOD_ID);
    const selectedFcffId = providerFcffSelection ? fullRequest?.expectedValuationMethods.find((method) => method.basisKind === "fcff")?.scenarioId : null;
    const fcffScenario = wantsFcff ? (await readFcffScenarioSets(client, membershipId, actor, now, sourceStore))
      .find((scenario) => scenario.scenarioState === "current" && scenario.recomputable
        && (!providerFcffSelection || scenario.id === selectedFcffId)) ?? null : null;
    const selectedProviderId = providerFcffSelection ? fullRequest?.expectedValuationMethods.find((method) => method.basisKind === "provider")?.scenarioId : null;
    const providerScenario = selectedProviderId && sourceStore
      ? await readProviderValuationScenarioById(client,membershipId,selectedProviderId,actor,now,sourceStore)
      : null;
    const expectedLegacyMethod = wantsFcff
      ? fullRequest?.expectedValuationMethods.find((method) => method.methodId !== FCFF_METHOD_ID)?.methodId : null;
    const valuationMethods = providerFcffSelection ? [] : wantsFcff
      ? legacyValuationMethods.filter((scenario) => scenario.calculation.method.id === expectedLegacyMethod).slice(0, 1)
      : legacyValuationMethods;
    const valuationScenario = valuationMethods[0] ?? null;
    const researchContext = limited ? { data: null, status: "unavailable" }
      : await readResearchContextSnapshot(client, membershipId, actor, now, sourceStore);
    if (!limited && (researchContext.status !== "available" || !researchContext.data
      || researchContext.data.currentness.status !== "current"
      || researchContext.peerSourceIssues?.length)) {
      throw new DeepResearchGateError("a current exact research context is required for evidence pack freeze");
    }
    const technical = limited ? null : await readLatestDailyTechnicalSnapshot(
      client,
      membership.market,
      membership.code,
      latestCompletedHongKongSession(now)
    );
    const operatingMonitor = limited ? null : membership.symbol === "HK.00175"
      ? await readLatestGeelySalesMonitor(client, profileId, membershipId, Number(membership.version), null, now)
      : membership.symbol === "HK.03800"
        ? await readLatestGclPvPriceMonitor(client, profileId, membershipId, Number(membership.version), null, now)
        : null;
    const quantPortfolio = fullRequest?.expectedQuantPortfolio
      ? await frozenQuantPortfolioEvidence(membership.symbol, quantEvidence, now)
      : {
          decision: quantMissing("stock-level quant evidence was not Owner-confirmed for this freeze"),
          portfolio: quantMissing("portfolio quant evidence was not Owner-confirmed for this freeze")
        };
    if (!limited && (!authoritativeWeinstein || !freezeBindingsMatch(
      valuationMethods,
      fullRequest!,
      technical,
      authoritativeWeinstein,
      membership.symbol,
      fcffScenario,
      providerScenario
    ) || !frozenQuantPortfolioMatchesExpected(quantPortfolio, fullRequest?.expectedQuantPortfolio))) {
      throw new CandidateMembershipConflictError(
        "the current valuation, technical, Weinstein, quant, or portfolio evidence no longer matches the Owner-confirmed freeze binding"
      );
    }
    const blockers = evidencePackBlockers(items, now);
    if (blockers.length > 0) throw new DeepResearchGateError("research materials cannot be frozen into an evidence pack", blockers);
    const freezeHongKongDay = fcffPublishedHongKongDay(now.toISOString());
    if (!limited && (providerFcffSelection
      ? (!providerScenario || !fcffScenario || !sourceStore || providerScenario.scenarioState !== "current"
        || !providerScenario.recomputable || providerScenario.invalidatedBy.length > 0
        || providerScenario.calculation.method.id !== "discounted_forward_metric_multiple_user_scenario"
        || providerScenario.createdAt > now.toISOString()
        || providerScenario.providerBasis.eps.capturedAt > now.toISOString()
        || providerScenario.providerBasis.valuation.capturedAt > now.toISOString()
        || fcffScenario.createdAt > now.toISOString()
        || freezeHongKongDay === null || fcffScenario.calculation.valuationCutoff > freezeHongKongDay
        || fcffScenario.invalidatedBy.length > 0)
      : (!valuationScenario || valuationMethods.length + (fcffScenario ? 1 : 0) !== 2
      || new Set([...valuationMethods.map((scenario) => scenario.calculation.method.id),
        ...(fcffScenario ? [fcffScenario.calculation.methodId] : [])]).size !== 2
      || !valuationMethods.every((scenario) => scenario.recomputable
        && scenario.scenarioState === "current"
        && scenario.invalidatedBy.length === 0)
      || (fcffScenario && (fcffScenario.invalidatedBy.length > 0 || !fcffScenario.recomputable))
      || valuationScenario.scenarioState !== "current"
      || valuationScenario.invalidatedBy.length > 0))) {
      throw new DeepResearchGateError(
        "both current recomputable cited Owner-assumption valuation methods are required"
      );
    }
    const allValuationAnchorsPresent = (providerFcffSelection ? !!providerScenario && items.some((item) =>
      item.id === providerScenario.providerBasis.sourceMaterialId
      && item.revision === providerScenario.providerBasis.sourceMaterialRevision
      && item.contentFingerprint === providerScenario.providerBasis.sourceMaterialFingerprint)
      && !!fcffScenario && fcffScenario.historicalOriginals.facts.every((fact) => {
        const publishedDay = fcffPublishedHongKongDay(fact.publishedAt);
        return publishedDay !== null && publishedDay <= fcffScenario.calculation.valuationCutoff
          && items.some((item) => item.id === fact.materialId && item.revision === fact.materialRevision);
      })
      : valuationMethods.every((scenario) => items.some((item) =>
      item.id === scenario.anchor.source.materialId
      && item.revision === scenario.anchor.source.materialRevision
      && item.sourceVersion === scenario.anchor.source.materialSourceVersion
      && (scenario.anchor.source.kind === "source_snapshot"
        ? item.snapshotCitation?.snapshotId === scenario.anchor.source.snapshotCitation.snapshotId
          && item.snapshotCitation.textSha256 === scenario.anchor.source.snapshotCitation.textSha256
          && item.snapshotCitation.startUtf16 === scenario.anchor.source.snapshotCitation.startUtf16
          && item.snapshotCitation.endUtf16 === scenario.anchor.source.snapshotCitation.endUtf16
          && item.snapshotCitation.excerptSha256 === scenario.anchor.source.snapshotCitation.excerptSha256
        : item.citation?.documentId === scenario.anchor.source.documentId
          && item.citation?.pageNumber === scenario.anchor.source.pageNumber
          && item.citation?.pageTextSha256 === scenario.anchor.source.pageTextSha256)
    ))) && (!fcffScenario || fcffScenario.historicalOriginals.facts.every((fact) => items.some((item) =>
      item.id === fact.materialId && item.revision === fact.materialRevision
      && (item.citation?.pageTextSha256 === fact.citationSha256
        || item.snapshotCitation?.textSha256 === fact.citationSha256))));
    if (!limited && !allValuationAnchorsPresent) {
      throw new DeepResearchGateError(
        "both current valuation method anchors must be present in the current material set"
      );
    }
    if (!limited && (!technical || technical.completeness !== "complete"
      || !technical.usableForRequestedCutoff
      || technical.dailyBars.request.symbol !== membership.symbol)) {
      throw new DeepResearchGateError(
        "a current contract-complete daily technical snapshot and result are required"
      );
    }
    const financialRequirement=limited?null:await readResearchFinancialRequirement(client,membershipId,actor,now,sourceStore);
    const frozenResearchContext: FrozenResearchEvidenceContext | null = limited ? null : {
      ...(financialRequirement?.status === "available" ? {financialRequirement:financialRequirement.data!} : {}),
      bindingVersion: providerFcffSelection ? FROZEN_RESEARCH_CONTEXT_VERSION_V2 : FROZEN_RESEARCH_CONTEXT_VERSION,
      actor: { actorType: "user", actorId: actor.actorId },
      membership: {
        id: membershipId,
        version: Number(membership.version),
        state: membership.state,
        symbol: membership.symbol
      },
      researchContext: frozenResearchContextBinding(researchContext.data!),
      ...(providerFcffSelection ? {
        selectedValuationMethods: [
          {basisKind:"provider" as const,scenario:providerScenario!},
          {basisKind:"fcff" as const,scenario:fcffScenario!}
        ] as FrozenResearchEvidenceContext["selectedValuationMethods"]
      } : { valuationScenario: valuationScenario!, valuationMethods,
        ...(fcffScenario ? { fcffScenario } : {}) }),
      technical: technical!,
      weinstein: authoritativeWeinstein!,
      ...(fullRequest?.ownerWeinsteinZones ? { ownerWeinsteinZones: fullRequest.ownerWeinsteinZones } : {}),
      quantPortfolio,
      operatingMonitor: frozenOperatingMonitorBinding(operatingMonitor),
      unboundSources: {
        macro: { status: "source_missing", value: "UNKNOWN" },
        industry: { status: "source_missing", value: "UNKNOWN" },
        event: currentResearchEvent
          ? frozenResearchEventBinding(currentResearchEvent)
          : { status: "source_missing", value: "UNKNOWN" },
        risk: { status: "source_missing", value: "UNKNOWN" },
        counterevidence: { status: "source_missing", value: "UNKNOWN" }
      }
    };
    const packFingerprint = evidencePackFingerprint(
      membershipId,
      request.membershipVersion,
      items,
      frozenResearchContext ?? undefined,
      limited ? "limited" : undefined,
      explicitSelection ? "explicit" : undefined
    );
    const existing = await client.query<EvidencePackRow>(
      `select ep.id, ep.candidate_membership_id, ep.candidate_membership_version,
              rp.market, rp.code, rp.symbol, ep.version, ep.pack_fingerprint, ep.frozen_at, ep.items,
              ep.frozen_research_context, ep.research_mode, ep.material_selection_mode,
              coalesce(ep.redaction_checksum = research_evidence_pack_redaction_checksum(ep), false) as redaction_checksum_valid
         from research_evidence_packs ep
         join research_profiles rp on rp.id = ep.research_profile_id
        where ep.research_profile_id = $1 and ep.pack_fingerprint = $2
        limit 1`,
      [profileId, packFingerprint]
    );
    let data = existing.rows[0] ? rowToEvidencePack(existing.rows[0], now) : null;
    if (!data) {
      const inserted = await client.query<EvidencePackRow>(
        `insert into research_evidence_packs
          (research_profile_id, candidate_membership_id, candidate_membership_version, version,
           pack_fingerprint, items, frozen_research_context, frozen_at, research_mode, material_selection_mode)
         values ($1, $2, $3, (select coalesce(max(version), 0) + 1 from research_evidence_packs where research_profile_id = $1),
                 $4, $5::jsonb, $6::jsonb, $7, $11, $12)
         returning id, candidate_membership_id, candidate_membership_version, $8::text as market,
                   $9::text as code, $10::text as symbol, version, pack_fingerprint, frozen_at, items,
                   frozen_research_context, research_mode, material_selection_mode, false as redaction_checksum_valid`,
        [
          profileId,
          membershipId,
          request.membershipVersion,
          packFingerprint,
          JSON.stringify(items),
          frozenResearchContext ? JSON.stringify(frozenResearchContext) : null,
          now,
          membership.market,
          membership.code,
          membership.symbol,
          limited ? "limited" : "full",
          explicitSelection ? "explicit" : null
        ]
      );
      data = rowToEvidencePack(inserted.rows[0], now);
    }
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "evidence_pack_frozen",
      request: auditRequest,
      stock: stock!,
      targetTable: "research_evidence_packs",
      targetId: data.id,
      beforePayload: null,
      afterPayload: data,
      requestFingerprint: fingerprint,
      candidateMembershipId: membershipId,
      candidateMembershipVersion: request.membershipVersion
    });
    await client.query("commit");
    return writeEnvelope(auditRequest, data, `Evidence pack ${data.id} frozen for ${membership.symbol}.`, auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (retryConcurrentConflict && (isUniqueViolation(error) || isSerializationFailure(error))) {
      return freezeResearchEvidencePack(
        pool, membershipId, request, actor, authoritativeWeinstein, quantEvidence, now, false, sourceStore
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

export function selectLimitedResearchMaterials(items: ResearchEvidencePackData["items"],
  selected: SelectedLimitedResearchMaterial[]): ResearchEvidencePackData["items"] {
  const byId = new Map(items.map(item => [item.id, item]));
  return selected.map(expected => {
    const item = byId.get(expected.id);
    if (!item || item.revision !== expected.revision
      || item.contentFingerprint !== expected.contentFingerprint
      || item.sourceVersion !== expected.sourceVersion
      || item.validUntil !== expected.validUntil)
      throw new DeepResearchGateError(`selected material ${expected.id} is missing or changed; re-read and select it again`);
    return item;
  });
}

async function frozenQuantPortfolioEvidence(
  symbol: string,
  options: QuantEvidenceRuntimeOptions | null,
  now: Date
): Promise<FrozenQuantPortfolioEvidenceBinding> {
  const [decision, portfolio] = await Promise.all([
    options?.decision
      ? readDecisionQuantEvidence(symbol, now, options.decision)
      : Promise.resolve(null),
    options?.annualPortfolioLab
      ? loadAnnualPortfolioLabQuantEvidence(options.annualPortfolioLab, now)
      : Promise.resolve(null)
  ]);
  const refinement = decision?.decisionEvidence;
  const identities = decision?.identities;
  const decisionUniverse = identities?.hkConnectUniverse;
  const decisionBinding = decision?.status === "available"
    && refinement?.status === "available" && refinement.refinementId && refinement.source
    && identities && decision.metadata.asOf && decision.metadata.fetchedAt && decisionUniverse
    ? {
        status: "available" as const,
        refinementId: refinement.refinementId,
        snapshotId: identities.frozenSnapshot.snapshotId,
        snapshotHash: identities.frozenSnapshot.snapshotHash,
        dataHash: identities.frozenSnapshot.dataHash,
        dataCutoff: refinement.source.dataCutoff,
        generatedAt: identities.generatedAt,
        source: decision.metadata.source,
        asOf: decision.metadata.asOf,
        fetchedAt: decision.metadata.fetchedAt,
        validUntil: quantValidUntil(decision.metadata.fetchedAt, options!.decision!.maxAgeDays),
        hkConnectUniverse: decisionUniverse
      }
    : quantMissing(decision?.message ?? "stock-level quant evidence is not configured");
  const portfolioEvidence = portfolio?.ok ? portfolio.evidence : null;
  const portfolioUniverse = portfolioEvidence?.source.hkConnectUniverse;
  const portfolioBinding = portfolio?.ok && portfolioEvidence && portfolioUniverse
    ? {
        status: "available" as const,
        evidenceId: portfolioEvidence.evidenceId,
        contentHash: portfolio.contentHash,
        snapshotId: portfolioEvidence.source.snapshotId,
        snapshotHash: portfolioEvidence.source.snapshotHash,
        dataHash: portfolioEvidence.source.dataHash,
        dataCutoff: portfolioEvidence.source.dataCutoff,
        observationStartDate: portfolioEvidence.source.observationStartDate,
        observationEndDate: portfolioEvidence.source.observationEndDate,
        observationCount: portfolioEvidence.method.observationCount,
        stability: portfolioEvidence.stability.status,
        generatedAt: portfolioEvidence.generatedAt,
        validUntil: quantValidUntil(
          portfolioEvidence.source.sourceIdentity.fetchedAt,
          options!.annualPortfolioLab!.maxAgeDays
        ),
        hkConnectUniverse: portfolioUniverse,
        series: portfolioEvidence.series.map((item) => ({
          symbol: item.symbol,
          annualizedVolatility: item.annualizedVolatility,
          worstDailyReturn: item.worstDailyReturn,
          historicalTailLossMagnitude: item.historicalTailLossMagnitude
        })),
        covariance: portfolioEvidence.covariance.map((item) => ({
          leftSymbol: item.leftSymbol,
          rightSymbol: item.rightSymbol,
          annualizedCovariance: item.annualizedCovariance,
          correlation: item.correlation
        }))
      }
    : quantMissing(portfolio?.ok
      ? "portfolio quant evidence is not bound to the official Hong Kong Connect universe"
      : portfolio?.reason ?? "portfolio quant evidence is not configured");
  return { decision: decisionBinding, portfolio: portfolioBinding };
}

function quantMissing(reason: string) {
  return { status: "source_missing" as const, reason };
}

function quantValidUntil(fetchedAt: string, maxAgeDays: number): string {
  return new Date(Date.parse(fetchedAt) + maxAgeDays * 86_400_000).toISOString();
}

async function readExistingResearchProfileId(
  client: Pick<Pool, "query">,
  market: string,
  code: string
): Promise<string> {
  const profile = await client.query<{ id: string }>(
    `select id
       from research_profiles
      where market = $1 and code = $2
      limit 1`,
    [market, code]
  );
  const id = profile.rows[0]?.id;
  if (!id) {
    throw new DeepResearchGateError(
      "the idempotent evidence-pack audit no longer binds an existing research profile"
    );
  }
  return id;
}

function isSerializationFailure(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "40001";
}

function idempotencyConflict(): IdempotencyConflictError {
  return new IdempotencyConflictError("idempotency key already used with a different evidence-pack request");
}

export function freezeBindingsMatch(
  valuationMethods: ResearchValuationScenarioSetData[],
  request: FreezeEvidencePackRequest,
  technical: DailyTechnicalEnvelope | null,
  authoritativeWeinstein: FrozenWeinsteinEvidenceBinding,
  symbol: string,
  fcffScenario: ResearchFcffScenarioSetData | null = null,
  providerScenario: ResearchProviderValuationScenarioSetData | null = null
): boolean {
  if (request.selectionVersion === "provider-pe-fcff-v2") {
    const actual = providerScenario && fcffScenario ? [
      {basisKind:"provider",scenarioId:providerScenario.id,scenarioRevision:providerScenario.revision,methodId:providerScenario.calculation.method.id},
      {basisKind:"fcff",scenarioId:fcffScenario.id,scenarioRevision:fcffScenario.revision,methodId:fcffScenario.calculation.methodId}
    ] : [];
    return canonicalJson(actual.sort((a,b)=>a.basisKind.localeCompare(b.basisKind)))
      === canonicalJson([...request.expectedValuationMethods].sort((a,b)=>String(a.basisKind).localeCompare(String(b.basisKind))))
      && technical?.dailyBars.snapshot?.snapshotSha === request.expectedTechnicalSnapshotSha
      && technical.technical.resultHash === request.expectedTechnicalResultHash
      && authoritativeWeinstein.symbol === symbol
      && technical.dailyBars.request.cutoff <= authoritativeWeinstein.analysisAsOf
      && canonicalJson(authoritativeWeinstein) === canonicalJson(request.expectedWeinstein);
  }
  const currentValuationBindings = [...valuationMethods.map((scenario) => ({
    scenarioId: scenario.id,
    scenarioRevision: scenario.revision,
    methodId: scenario.calculation.method.id
  })), ...(fcffScenario ? [{ scenarioId: fcffScenario.id, scenarioRevision: fcffScenario.revision,
    methodId: fcffScenario.calculation.methodId }] : [])]
    .sort((left, right) => left.methodId.localeCompare(right.methodId));
  const expectedValuationBindings = [...request.expectedValuationMethods]
    .sort((left, right) => left.methodId.localeCompare(right.methodId));
  return valuationMethods[0]?.id === request.expectedScenarioId
    && valuationMethods[0].revision === request.expectedScenarioRevision
    && canonicalJson(currentValuationBindings) === canonicalJson(expectedValuationBindings)
    && technical?.dailyBars.snapshot?.snapshotSha === request.expectedTechnicalSnapshotSha
    && technical.technical.resultHash === request.expectedTechnicalResultHash
    && authoritativeWeinstein.symbol === symbol
    && technical.dailyBars.request.cutoff <= authoritativeWeinstein.analysisAsOf
    && canonicalJson(authoritativeWeinstein) === canonicalJson(request.expectedWeinstein);
}

export function frozenQuantPortfolioMatchesExpected(
  binding: FrozenQuantPortfolioEvidenceBinding,
  expected: ExpectedFrozenQuantPortfolioIdentity | undefined
): boolean {
  if (!expected) {
    return binding.decision.status === "source_missing"
      && binding.portfolio.status === "source_missing";
  }
  return canonicalJson({
    decisionRefinementId: binding.decision.status === "available" ? binding.decision.refinementId : null,
    decisionUniverseSnapshotId: binding.decision.status === "available"
      ? binding.decision.hkConnectUniverse.snapshotId : null,
    portfolioEvidenceId: binding.portfolio.status === "available" ? binding.portfolio.evidenceId : null,
    portfolioUniverseSnapshotId: binding.portfolio.status === "available"
      ? binding.portfolio.hkConnectUniverse.snapshotId : null
  }) === canonicalJson(expected);
}
