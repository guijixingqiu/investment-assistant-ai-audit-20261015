import { bindQuestionOpeningTimes } from "./researchQuestionHistory.js";
import { createHash } from "node:crypto";
import { attachResearchChange } from "./researchChangeProjection.js";
import { readDocumentFactCandidates } from "./researchFactCandidateRepository.js";
import { projectResearchQuestions } from "../../../../packages/contracts/src/researchQuestions.js";
import { reasoningFingerprint } from "../../../../packages/contracts/src/researchOperatingReasoning.js";
import { readLatestQuoteEnvelope } from "../market/repository.js";
import {selectOperatingAnchor} from "../../../../packages/contracts/src/researchOperatingAnchor.js";
import {fundamentalOperatingFact} from "./researchOperatingReasoning.js";
import { buildOperatingReasoning } from "./researchOperatingReasoning.js";
import { readReportConfirmationFailures, projectReportConfirmationReadiness } from "./researchReportReadiness.js";
import type { QuantEvidenceRuntimeOptions } from "./quantEvidenceSource.js";
import type { Pool, PoolClient } from "pg";
import { makeFactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import {
  DEEP_RESEARCH_SCHEMA_VERSION,
  EVIDENCE_BOUND_REPORT_CONTRACT_VERSION,
  type DeepResearchReportData,
  type DeepResearchReportDeletionData,
  type DeepResearchReportCurrentnessReason,
  type DeepResearchWorkspaceEnvelope,
  type ResearchEvidencePackData,
  type ResearchMaterialData,
  validateResearchMaterialData
} from "../../../../packages/contracts/src/deepResearch.js";
import {
  DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
  type SynthesizedDeepResearchReportPayload
} from "../../../../packages/contracts/src/deepResearchSynthesisReport.js";
import { deepResearchSnapshotBindsCurrentSources } from "../../../../packages/contracts/src/deepResearchSnapshot.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { DeepResearchGateError } from "./domain.js";
import {
  deepResearchGateFailures,
  evidenceBoundReportHasOnlyLegacySingleValuationMismatch,
  evidenceBoundReportIntegrityFailures,
  evidencePackFingerprint,
  synthesizedReportHasOnlyLegacySingleValuationMismatch,
  synthesizedDeepResearchReportIntegrityFailures
} from "./deepResearchGate.js";
import { readFcffScenarioSets } from "./researchValuationFcffScenarioRepository.js";
import { readProviderValuationScenarioById } from "./researchValuationProviderScenarioRepository.js";
import {
  readDeepResearchDecisionRows,
  readDeepResearchReportRows,
  readEvidencePackInvalidatedBy,
  readEvidencePackRows,
  readResearchMaterials
} from "./deepResearchPersistence.js";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import {
  currentHoldingEventIdsWithDrift,
  type CurrentHoldingReadOptions
} from "./currentHoldingResearchBinding.js";
import { readResearchEvents } from "./researchEventRepository.js";
import { readLatestGeelySalesMonitor } from "./geelySalesMonitorRepository.js";
import { readLatestGclPvPriceMonitor } from "./gclPvPriceMonitorRepository.js";
import {
  latestCompletedHongKongSession,
  readLatestDailyTechnicalSnapshot
} from "../market/dailyBarsRepository.js";
import { readCurrentResearchValuationScenarios } from "./researchValuationScenarioRepository.js";
import { rowToEvidencePack } from "./deepResearchMappers.js";
import { rowToDeepResearchDecision, rowToDeepResearchReport } from "./deepResearchMappers.js";
import { readResearchFundamentalsExport, readResearchFundamentals } from "./researchFundamentalRepository.js";
import { readResearchContextSnapshot } from "./researchContextRepository.js";
import { readProviderOperatingReference } from "./researchProviderOperatingReference.js";
import {
  researchStockMaterials,
  researchWorkspaceMaterials
} from "../../../../packages/contracts/src/researchEvent.js";
import { readCurrentResearchMonitorRules } from "./researchProfileReadRepository.js";
import { deepResearchDeletionFingerprint } from "./deepResearchReportRepository.js";
import { redactResearchMaterialCopies } from "./researchMaterialDeletionRepository.js";
export interface DeepResearchReadOptions extends CurrentHoldingReadOptions {
  quantEvidence?: QuantEvidenceRuntimeOptions | null;
  enforceCurrentHoldingBindings?: boolean;
  sourceStore?: import("./researchSourceSnapshotRepository.js").SourceSnapshotStoreOptions;
}

const DEFAULT_READ_OPTIONS: DeepResearchReadOptions = {
  accountScopeId: null,
  currentPortfolioEnabled: false,
  currentPortfolioMaxAgeSeconds: 300,
  enforceCurrentHoldingBindings: true
};

/** Historical read only: ownership and saved bytes are checked without requiring today's workspace version. */
export async function readHistoricalFutuFinancialMaterial(
  pool: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  materialId: string,
  actor: AuthenticatedResearchActor,
  now = new Date()
): Promise<ResearchMaterialData | null> {
  const membership = await readCandidateMembershipById(pool, actor, membershipId);
  if (!membership) return null;
  const profile = await pool.query<{ id: string }>(
    "select id from research_profiles where market = $1 and code = $2 limit 1",
    [membership.market, membership.code]
  );
  const profileId = profile.rows[0]?.id;
  if (!profileId) return null;
  const materials = await readResearchMaterials(pool, profileId, membershipId, now, undefined, materialId);
  return selectHistoricalFutuFinancialMaterial(
    materials.find(item => item.id === materialId), membership, membershipId, materialId
  );
}

export function selectHistoricalFutuFinancialMaterial(
  material: ResearchMaterialData | undefined,
  membership: { market: string; code: string; symbol: string; version: number | string },
  membershipId: string,
  materialId: string
): ResearchMaterialData | null {
  const source = material?.futuFinancialSource;
  if (!material || material.id !== materialId || !source || !validateResearchMaterialData(material).ok
    || material.sourceType !== "futu_opend_financial_statement_provider"
    || material.symbol !== membership.symbol || material.market !== membership.market
    || material.code !== membership.code || source.membershipId !== membershipId
    || source.symbol !== membership.symbol || source.membershipVersion > Number(membership.version)
    || createHash("sha256").update(material.contentText).digest("hex") !== material.contentFingerprint) return null;
  return material;
}

function deletedMaterialKey(id: string, contentFingerprint: string): string {
  return `${id}:${contentFingerprint}`;
}

async function readDeletedResearchMaterialKeys(
  pool: Pick<Pool | PoolClient, "query">,
  profileId: string,
  membershipId: string
): Promise<Set<string>> {
  const result = await pool.query<{ id: string; content_fingerprint: string }>(
    `select id, content_fingerprint
       from research_materials
      where research_profile_id = $1
        and candidate_membership_id = $2
        and deleted_at is not null`,
    [profileId, membershipId]
  );
  return new Set(result.rows.map((row) => deletedMaterialKey(String(row.id), row.content_fingerprint)));
}

export function projectEvidencePackTombstones(
  pack: ResearchEvidencePackData,
  deletedMaterialKeys: ReadonlySet<string>
): ResearchEvidencePackData {
  let projected: unknown = pack;
  for (const key of deletedMaterialKeys) {
    const separator = key.indexOf(":");
    projected = redactResearchMaterialCopies(projected, key.slice(0, separator), key.slice(separator + 1));
  }
  return projected as ResearchEvidencePackData;
}

export function storedEvidencePackFingerprintIsReadable(
  pack: ResearchEvidencePackData,
  computedFingerprint: string,
  redactionChecksumValid: boolean
): boolean {
  return computedFingerprint === pack.packFingerprint
    || redactionChecksumValid
      && pack.currentness.status === "historical"
      && pack.currentness.invalidatedBy.includes("material_set_changed")
      && pack.items.some((item) => item.sourceType === "deleted");
}

export async function readOptionalWorkspaceMonitor<T>(reader: () => Promise<T>): Promise<{
  value: T | null;
  stale: boolean;
}> {
  try {
    return { value: await reader(), stale: false };
  } catch (error) {
    if (error instanceof DeepResearchGateError && error.message.endsWith(" has stale source evidence")) {
      return { value: null, stale: true };
    }
    throw error;
  }
}

export async function readDeepResearchWorkspace(
  pool: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  options: DeepResearchReadOptions = DEFAULT_READ_OPTIONS
): Promise<DeepResearchWorkspaceEnvelope> {
  const generatedAt = now.toISOString();
  const membership = await readCandidateMembershipById(pool, actor, membershipId);
  if (!membership) return unavailableWorkspace(generatedAt, membershipId, actor.actorId, "not_found", "candidate membership was not found");
  const profile = await pool.query<{ id: string }>(
    `select id from research_profiles where market = $1 and code = $2 limit 1`,
    [membership.market, membership.code]
  );
  const profileId = profile.rows[0]?.id ?? null;
  const membershipVersion = Number(membership.version);
  const materials = profileId ? await readResearchMaterials(pool, profileId, membershipId, now) : [];
  const storedEvents = profileId ? await readResearchEvents(pool, profileId, membershipId, membershipVersion, now) : [];
  const driftedHoldingEventIds = options.enforceCurrentHoldingBindings === false
    ? new Set<string>()
    : await currentHoldingEventIdsWithDrift(
      pool,
      storedEvents.filter((event) => event.source.revisionState === "current"),
      options,
      now
  );
  const events = storedEvents.filter((event) => !driftedHoldingEventIds.has(event.id));
  const workspaceMaterials = researchWorkspaceMaterials(materials, storedEvents, events);
  const geelyMonitor = profileId && membership.symbol === "HK.00175"
    ? await readOptionalWorkspaceMonitor(() => readLatestGeelySalesMonitor(
      pool,
      profileId,
      membershipId,
      membershipVersion,
      options.enforceCurrentHoldingBindings === false ? null : options,
      now
    ))
    : { value: null, stale: false };
  const gclMonitor = profileId && membership.symbol === "HK.03800"
    ? await readOptionalWorkspaceMonitor(() => readLatestGclPvPriceMonitor(
      pool,
      profileId,
      membershipId,
      membershipVersion,
      options.enforceCurrentHoldingBindings === false ? null : options,
      now
    ))
    : { value: null, stale: false };
  const latestGeelySalesMonitor = geelyMonitor.value;
  const latestGclPvPriceMonitor = gclMonitor.value;
  const latestOperatingMonitor = latestGeelySalesMonitor ?? latestGclPvPriceMonitor;
  const staleMonitorName = geelyMonitor.stale ? "Geely sales monitor"
    : gclMonitor.stale ? "GCL photovoltaic monitor" : null;
  const currentMaterials = materials.filter((item) => item.revisionState === "current");
  const currentResearchMaterials = researchStockMaterials(currentMaterials, storedEvents);
  const allCurrentValuationMethods = await readCurrentResearchValuationScenarios(
    pool,
    membershipId,
    actor,
    membershipVersion,
    membership.state,
    now,
    options.sourceStore
  );
  const allFcffScenarios = await readFcffScenarioSets(pool,membershipId,actor,now,options.sourceStore);
  const latestCurrentFcffScenario = allFcffScenarios
    .find((scenario) => scenario.scenarioState === "current" && scenario.recomputable) ?? null;
  const currentTechnical=await readResearchTechnical(pool,membership.market,membership.code,now);
  const currentResearchContext = await readResearchContextSnapshot(pool, membershipId, actor, now, options.sourceStore);
  const packRows = profileId ? await readEvidencePackRows(pool, profileId, membershipId) : [];
  const deletedMaterialKeys = profileId && packRows.length > 0
    ? await readDeletedResearchMaterialKeys(pool, profileId, membershipId)
    : new Set<string>();
  const evidencePacks = await Promise.all(packRows.map(async (row) => {
    const preliminary = rowToEvidencePack(row, now);
    const v2Selection = preliminary.frozenResearchContext?.selectedValuationMethods;
    const frozenMethods = preliminary.frozenResearchContext?.valuationMethods;
    const currentValuationMethods = v2Selection ? [] : frozenMethods
      ? frozenMethods.flatMap((frozen) => allCurrentValuationMethods.filter((current) =>
        current.calculation.method.id === frozen.calculation.method.id).slice(0, 1))
      : allCurrentValuationMethods;
    const currentValuationScenario = currentValuationMethods[0] ?? null;
    const currentFcffScenario = v2Selection
      ? allFcffScenarios.find((scenario) => scenario.id === v2Selection.find((entry) => entry.basisKind === "fcff")?.scenario.id) ?? null
      : preliminary.frozenResearchContext?.fcffScenario ? latestCurrentFcffScenario : null;
    const currentProviderScenario = v2Selection?.find((entry) => entry.basisKind === "provider")?.scenario.id && options.sourceStore
      ? await readProviderValuationScenarioById(pool,membershipId,v2Selection.find((entry) => entry.basisKind === "provider")!.scenario.id,actor,now,options.sourceStore)
      : null;
    const expectedFingerprint = evidencePackFingerprint(
      preliminary.membershipId,
      preliminary.membershipVersion,
      preliminary.items,
      row.frozen_research_context === null ? undefined : row.frozen_research_context,
      preliminary.researchMode,
      preliminary.materialSelectionMode
    );
    if (!storedEvidencePackFingerprintIsReadable(preliminary, expectedFingerprint, row.redaction_checksum_valid)) {
      throw new DeepResearchGateError(`evidence pack ${preliminary.id} failed content-address verification`);
    }
    const pack = rowToEvidencePack(row, now, await readEvidencePackInvalidatedBy(
      pool,
      profileId!,
      preliminary,
      actor,
      {
        id: membershipId,
        version: membershipVersion,
        state: membership.state,
        market: membership.market,
        code: membership.code,
        symbol: membership.symbol
      },
      now,
      {
        actor: { actorType: "user", actorId: actor.actorId },
        membership: {
          id: membershipId,
          version: membershipVersion,
          state: membership.state,
          symbol: membership.symbol
        },
        materials: currentMaterials,
        valuationScenario: currentValuationScenario,
        valuationMethods: currentValuationMethods,
        fcffScenario: currentFcffScenario,
        providerScenario: currentProviderScenario,
        technical: currentTechnical,
        events: storedEvents,
        operatingMonitor: latestOperatingMonitor,
        researchContext: currentResearchContext.peerSourceIssues?.length
          ? null : currentResearchContext.data
      },
      undefined,
      options.sourceStore
    ));
    return projectEvidencePackTombstones(pack, deletedMaterialKeys);
  }));
  const latestPack = evidencePacks.find((pack) => pack.membershipVersion === membershipVersion) ?? null;
  for (const pack of evidencePacks) {
    if (latestPack && pack.id !== latestPack.id && pack.currentness.status === "current") {
      pack.currentness = { status: "historical", invalidatedBy: [...pack.currentness.invalidatedBy, "superseded_by_newer_pack"] };
    }
  }
  const reportRows = profileId
    ? await readDeepResearchReportRows(pool, profileId, membershipId)
    : [];
  const reportDeletions = profileId
    ? await readDeepResearchReportDeletions(pool, profileId, membershipId)
    : [];
  const currentSnapshotSources = reportRows.some((row) =>
    row.report_contract_version === DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION)
    ? await Promise.all([
      readResearchFundamentalsExport(pool, membershipId, actor, now, options.sourceStore),
        Promise.resolve(currentResearchContext),
        readCurrentResearchMonitorRules(pool, membershipId, actor)
      ])
    : null;
  const confirmationFailures = reportRows.some((row) => row.status === "complete_pending_confirmation")
    ? await readReportConfirmationFailures(pool, membershipId, actor, now, options.quantEvidence, options.sourceStore) : [];
  const packById = new Map(evidencePacks.map((pack) => [pack.id, pack]));
  const reports = reportRows.map((row) => {
    const pack = packById.get(String(row.evidence_pack_id));
    const bindsPack = pack ? reportRowBindsPack(row, pack) : false;
    const legacySingleValuation = pack
      ? reportRowHasOnlyLegacySingleValuationMismatch(row, pack)
      : false;
    const reasons: DeepResearchReportCurrentnessReason[] = [];
    if (reportRows[0] && String(row.id) !== String(reportRows[0].id)) reasons.push("superseded_by_newer_report");
    if (!pack) reasons.push("evidence_pack_identity_mismatch" as const);
    if (pack && latestPack?.id !== pack.id) {
      reasons.push("not_latest_current_evidence_pack" as const);
    }
    if (pack && !bindsPack) {
      reasons.push(legacySingleValuation
        ? "legacy_single_valuation_contract_projection" as const
        : "evidence_pack_identity_mismatch" as const);
    }
    if (row.report_contract_version === DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION
      && ((!bindsPack && !legacySingleValuation) || !currentSnapshotSources || (pack?.researchMode !== "limited" && (currentSnapshotSources[1].status !== "available"
        || currentSnapshotSources[1].data === null))
        || !deepResearchSnapshotBindsCurrentSources(
          (row.report_payload as SynthesizedDeepResearchReportPayload).snapshot,
          currentSnapshotSources[0],
          currentSnapshotSources[1].data,
          events.filter((event) => event.coverageScope === "research_stock"),
          latestOperatingMonitor,
          currentSnapshotSources[2]
        ))) {
      reasons.push("selected_snapshot_changed" as const);
    }
    const report = rowToDeepResearchReport(
      row,
      reasons,
      pack?.currentness.invalidatedBy ?? []
    );
    return pack ? projectReportConfirmationReadiness(projectDeepResearchReportCurrentGate(report, pack, now), confirmationFailures) : report;
  });
  const latestReport = reports[0] ?? null;
  const decisions = profileId
    ? (await readDeepResearchDecisionRows(pool, profileId, membershipId))
      .map(rowToDeepResearchDecision)
    : [];
  const userDecision = latestReport
    ? decisions.find((decision) => decision.reportId === latestReport.id) ?? null
    : null;
  const completion = completionState(currentResearchMaterials, latestPack, latestReport, userDecision);
  const stale = staleMonitorName !== null || currentResearchMaterials.some((item) => item.freshness === "stale");
  const conflict = currentResearchMaterials.some((item) => item.verificationStatus === "conflict");
  const missing = currentResearchMaterials.length === 0;
  const workspace: DeepResearchWorkspaceEnvelope = {
    schemaVersion: DEEP_RESEARCH_SCHEMA_VERSION,
    generatedAt,
    status: "available",
    membershipId,
    requestedActorId: actor.actorId,
    requestedSymbol: membership.symbol,
    metadata: makeFactMetadata({
      source: "research_materials:research_events:geely_sales_monitor:gcl_pv_price_monitor:evidence_packs:valuation_scenarios:market_daily_technical:deep_research_reports:user_decisions",
      asOf: generatedAt,
      fetchedAt: generatedAt,
      freshness: conflict ? "conflict" : stale ? "stale" : missing ? "missing" : "fresh",
      provenance: "research_only",
      authority: "research_evidence",
      stale,
      missing,
      conflict,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message: staleMonitorName
        ? `${staleMonitorName} was excluded because its source evidence expired; refresh that evidence before using the monitor again.`
        : "User materials, frozen evidence packs, model analysis, and user decisions remain explicitly separated."
    }),
    data: {
      target: {
        membershipId,
        membershipVersion,
        membershipState: membership.state,
        market: "HK",
        code: membership.code,
        symbol: membership.symbol
      },
      materials: workspaceMaterials,
      events,
      latestGeelySalesMonitor,
      latestGclPvPriceMonitor,
      latestPack,
      evidencePacks,
      latestReport,
      reports,
      reportDeletions,
      userDecision,
      decisions,
      classification: {
        verifiedFactMaterialIds: ids(currentResearchMaterials, "verified_fact"),
        issuerStatementMaterialIds: ids(currentResearchMaterials, "issuer_statement"),
        thirdPartyStatementMaterialIds: ids(currentResearchMaterials, "third_party_statement"),
        modelInferenceMaterialIds: ids(currentResearchMaterials, "model_inference"),
        userDecisionId: userDecision?.id ?? null
      },
      completion
    },
    message: `Deep research workspace for ${membership.symbol}.`
  };
  return readOperatingWorkspace(pool,membershipId,actor,now,workspace,currentResearchContext,options.sourceStore);
}

async function readDeepResearchReportDeletions(
  pool: Pick<Pool | PoolClient, "query">,
  profileId: string,
  membershipId: string
): Promise<DeepResearchReportDeletionData[]> {
  const result = await pool.query<{
    report_id: string; evidence_pack_id: string; report_version: number | string;
    membership_version: number | string; symbol: string; report_fingerprint: string | null;
    report_contract_version: string;
    deleted_at: Date | string;
  }>(
    `select report.id::text as report_id, report.evidence_pack_id::text as evidence_pack_id,
            report.version as report_version, report.deletion_membership_version as membership_version,
            profile.symbol, report.report_fingerprint, report.report_contract_version, report.deleted_at
       from deep_research_reports report
       join research_evidence_packs pack on pack.id = report.evidence_pack_id
       join research_profiles profile on profile.id = report.research_profile_id
      where report.research_profile_id = $1 and pack.candidate_membership_id = $2
        and report.deleted_at is not null
      order by report.deleted_at desc, report.id desc
      limit 50`,
    [profileId, membershipId]
  );
  return result.rows.map((row) => ({
    reportId: row.report_id,
    evidencePackId: row.evidence_pack_id,
    reportVersion: Number(row.report_version),
    membershipId,
    membershipVersion: Number(row.membership_version),
    symbol: row.symbol,
    reportFingerprint: deepResearchDeletionFingerprint(row.report_fingerprint, row.report_contract_version),
    deletedAt: new Date(row.deleted_at).toISOString(),
    state: "deleted"
  }));
}

export function projectDeepResearchReportCurrentGate(
  report: DeepResearchReportData,
  pack: ResearchEvidencePackData,
  now: Date
): DeepResearchReportData {
  if (report.currentness.status !== "current" || report.evidencePackId !== pack.id) return report;
  const gateFailures = [...new Set([...report.gateFailures, ...deepResearchGateFailures(report.payload, pack, now)])];
  return {
    ...report,
    status: gateFailures.length === 0 ? "complete_pending_confirmation" : "evidence_insufficient",
    gateFailures
  };
}

export function unavailableWorkspace(
  generatedAt: string,
  membershipId: string,
  actorId: string,
  status: "not_found" | "unavailable",
  message: string
): DeepResearchWorkspaceEnvelope {
  return {
    schemaVersion: DEEP_RESEARCH_SCHEMA_VERSION,
    generatedAt,
    status,
    membershipId,
    requestedActorId: actorId,
    requestedSymbol: null,
    metadata: makeFactMetadata({
      source: "deep_research_workspace",
      asOf: generatedAt,
      fetchedAt: generatedAt,
      freshness: status === "not_found" ? "missing" : "unavailable",
      provenance: "unavailable",
      authority: "unavailable",
      stale: false,
      missing: status === "not_found",
      conflict: false,
      fixture: false,
      correctionOf: null,
      replaces: null,
      message
    }),
    data: null,
    message
  };
}

function completionState(
  materials: NonNullable<DeepResearchWorkspaceEnvelope["data"]>["materials"],
  pack: NonNullable<DeepResearchWorkspaceEnvelope["data"]>["latestPack"],
  report: NonNullable<DeepResearchWorkspaceEnvelope["data"]>["latestReport"],
  decision: NonNullable<DeepResearchWorkspaceEnvelope["data"]>["userDecision"]
): NonNullable<DeepResearchWorkspaceEnvelope["data"]>["completion"] {
  if (materials.length === 0) return state("materials_required", ["At least one traceable user material is required."]);
  if (!pack) return state("pack_required", ["Verified, authorized, fresh materials must be frozen into an evidence pack."]);
  if (pack.currentness.status !== "current") {
    return state("pack_required", [
      `The latest frozen evidence pack is historical: ${pack.currentness.invalidatedBy.join(", ")}.`
    ]);
  }
  const scopedMaterials = pack.materialSelectionMode === "explicit"
    ? pack.items.map(item => materials.find(current => current.id === item.id)).filter(
      (item): item is typeof materials[number] => !!item) : materials;
  if (pack.materialSelectionMode === "explicit" && scopedMaterials.length !== pack.items.length
    || evidencePackFingerprint(
    pack.membershipId,
    pack.membershipVersion,
    scopedMaterials,
    pack.frozenResearchContext === null ? undefined : pack.frozenResearchContext,
    pack.researchMode,
    pack.materialSelectionMode
  ) !== pack.packFingerprint) {
    return state("pack_required", ["Research materials changed after the latest frozen evidence pack."]);
  }
  if (!report) return state("research_required", ["A deep research report must bind the latest frozen evidence pack."]);
  if (report.currentness.status !== "current") {
    return state("research_required", [
      `The latest report is historical: ${[
        ...report.currentness.invalidatedBy,
        ...report.currentness.evidencePackInvalidatedBy
      ].join(", ")}.`
    ]);
  }
  if (report.status !== "complete_pending_confirmation" || report.gateFailures.length > 0) {
    return state("research_required", report.gateFailures);
  }
  if (!decision) return state("user_confirmation_required", ["The structurally complete report still requires an explicit user decision."]);
  return decision.decision === "confirmed"
    ? { state: "confirmed", deepResearchComplete: true, reasons: [] }
    : state("rejected", ["The user rejected this research version."]);
}

function reportRowBindsPack(
  row: import("./deepResearchMappers.js").DeepResearchReportRow,
  pack: NonNullable<DeepResearchWorkspaceEnvelope["data"]>["latestPack"]
): boolean {
  if (!pack || typeof row.report_payload !== "object" || row.report_payload === null
    || !("reportContractVersion" in row.report_payload) || !("researchLayer" in row.report_payload)
    || typeof row.report_payload.researchLayer !== "object" || row.report_payload.researchLayer === null) return false;
  if (row.report_payload.reportContractVersion === DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION) {
    return synthesizedDeepResearchReportIntegrityFailures(
      row.report_payload as SynthesizedDeepResearchReportPayload,
      pack
    ).length === 0;
  }
  return row.report_payload.reportContractVersion === EVIDENCE_BOUND_REPORT_CONTRACT_VERSION
    && "evidencePackBinding" in row.report_payload
    && evidenceBoundReportIntegrityFailures(
      row.report_payload as import("../../../../packages/contracts/src/deepResearch.js").EvidenceBoundDeepResearchReportPayload,
      pack
    ).length === 0;
}

function reportRowHasOnlyLegacySingleValuationMismatch(
  row: import("./deepResearchMappers.js").DeepResearchReportRow,
  pack: NonNullable<DeepResearchWorkspaceEnvelope["data"]>["latestPack"]
): boolean {
  if (!pack || typeof row.report_payload !== "object" || row.report_payload === null) return false;
  if (row.report_contract_version === DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION) {
    return synthesizedReportHasOnlyLegacySingleValuationMismatch(
      row.report_payload as SynthesizedDeepResearchReportPayload,
      pack
    );
  }
  return row.report_contract_version === EVIDENCE_BOUND_REPORT_CONTRACT_VERSION
    && evidenceBoundReportHasOnlyLegacySingleValuationMismatch(
      row.report_payload as import("../../../../packages/contracts/src/deepResearch.js").EvidenceBoundDeepResearchReportPayload,
      pack
    );
}

function state(
  value: "materials_required" | "pack_required" | "research_required" | "user_confirmation_required" | "rejected",
  reasons: string[]
) {
  return { state: value, deepResearchComplete: false, reasons: [...new Set(reasons)] };
}

function ids(materials: NonNullable<DeepResearchWorkspaceEnvelope["data"]>["materials"], claimType: string): string[] {
  return materials.filter((item) => item.claimType === claimType).map((item) => item.id);
}

async function attachOperatingWorkspace(pool:Pick<Pool|PoolClient,"query">,actor:AuthenticatedResearchActor,workspace:DeepResearchWorkspaceEnvelope,fundamentals:Awaited<ReturnType<typeof readResearchFundamentals>>,currentResearchContext:Awaited<ReturnType<typeof readResearchContextSnapshot>>,observed:import("../../../../packages/contracts/src/researchOperatingModel.js").OperatingMarketObservation|null,sourceStore?:import("./researchSourceSnapshotRepository.js").SourceSnapshotStoreOptions):Promise<DeepResearchWorkspaceEnvelope>{
  const reasoning=buildOperatingReasoning(workspace,fundamentals,currentResearchContext,observed);
  if(reasoning){
    reasoning.factCandidates=(await readDocumentFactCandidates(pool,reasoning.membershipId,actor,reasoning.facts,new Date(workspace.generatedAt))).candidates;
    reasoning.researchQuestions=projectResearchQuestions(reasoning);
    await bindQuestionOpeningTimes(pool,actor,reasoning.researchQuestions,workspace.generatedAt);
    for(const gap of reasoning.gaps??[]){
      const key=gap.metric==="asp_product_mix"?"average_selling_price":gap.metric;
      if(reasoning.factCandidates.some(c=>c.metric===key&&c.periodStart===reasoning.fact.period.start&&c.periodEnd===reasoning.fact.period.end))gap.reason="NOT_EXTRACTED";
    }
    reasoning.guidance=reasoning.guidance?.map(g=>{
      const value=fundamentals.values.find(f=>f.id===g.guidanceId),old=fundamentals.values.find(f=>f.id===value?.replacesValueId);
      return old?{...g,revision:{previousId:old.id,previousStatement:old.assertion?.guidance?.statement??"",updatedStatement:value?.assertion?.guidance?.statement??"",sourceMaterialId:value!.source.materialId,recordedAt:value!.createdAt,reason:value!.assertion?.limitation??""}}:g;
    });
    await attachResearchChange(pool,actor,workspace,fundamentals,currentResearchContext,reasoning,sourceStore);
    reasoning.inputFingerprint=reasoningFingerprint(reasoning);
  }
  const anchorSelection=reasoning?.anchorSelection??selectOperatingAnchor(fundamentals.values.map(value=>fundamentalOperatingFact(value,workspace)).filter((fact):fact is import("../../../../packages/contracts/src/researchOperatingModel.js").OperatingFact=>fact!==null));
  return { ...workspace, data: { ...workspace.data!, operatingReasoning: reasoning, operatingAnchorSelection:anchorSelection } };
}

async function readOperatingWorkspace(pool:Pick<Pool|PoolClient,"query">,membershipId:string,actor:AuthenticatedResearchActor,now:Date,workspace:DeepResearchWorkspaceEnvelope,currentResearchContext:Awaited<ReturnType<typeof readResearchContextSnapshot>>,sourceStore?:import("./researchSourceSnapshotRepository.js").SourceSnapshotStoreOptions):Promise<DeepResearchWorkspaceEnvelope>{
  const target=workspace.data!.target;
  const providerOperatingReference=await readProviderOperatingReference(pool,
    {membershipId,membershipVersion:target.membershipVersion,symbol:target.symbol},actor,sourceStore,
    currentResearchContext.status==="available"?currentResearchContext.data:null,now);
  const fundamentals = await readResearchFundamentals(pool, membershipId, actor, now, undefined, sourceStore);
  const quote = fundamentals.values.some(value => value.assertion) ? await readLatestQuoteEnvelope(pool, target.market, target.code, 300, now) : null;
  const observed = quote?.data ? {symbol: quote.data.symbol, price: quote.data.price, currency: quote.data.currency, asOf:quote.data.quoteTime, fetchedAt:quote.source.fetchedAt!, source:quote.source.provider, fresh:quote.status === "live" && !quote.metadata.fixture} : null;
  const attached=await attachOperatingWorkspace(pool,actor,workspace,fundamentals,currentResearchContext,observed,sourceStore);
  return {...attached,data:{...attached.data!,providerOperatingReference}};
}

/** Unsupported trading-calendar coverage cannot erase durable non-market research facts. */
function researchTechnicalCutoff(now:Date):string|null {
 try{return latestCompletedHongKongSession(now);}catch(error){
  if(error instanceof Error&&/HKEX local Alpha calendar supports only|no completed HKEX securities session|half-day HKEX close evidence is not supported/.test(error.message))return null;
  throw error;
 }
}

async function readResearchTechnical(pool:Pick<Pool|PoolClient,"query">,market:string,code:string,now:Date){const cutoff=researchTechnicalCutoff(now);return cutoff?readLatestDailyTechnicalSnapshot(pool,market,code,cutoff):null;}
