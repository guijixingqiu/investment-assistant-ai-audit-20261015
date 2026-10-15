import type { Pool, PoolClient } from "pg";
import {
  DEEP_RESEARCH_SNAPSHOT_SCHEMA_VERSION,
  computeDeepResearchSnapshotId,
  deepResearchSnapshotSafety,
  operatingMonitorBindsSnapshotEvents,
  validateDeepResearchSnapshotData,
  type DeepResearchSnapshotData,
  type DeepResearchSnapshotHashInput,
  type DeepResearchOperatingMonitorData,
  type DeepResearchTaskIntent
} from "../../../../packages/contracts/src/deepResearchSnapshot.js";
import {
  LEGACY_REPORT_CONTRACT_VERSION,
  type DeepResearchDecisionData,
  type DeepResearchReportData,
  type ResearchEvidencePackData
} from "../../../../packages/contracts/src/deepResearch.js";
import type { ResearchAnnouncementEventData } from "../../../../packages/contracts/src/researchEvent.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { DeepResearchGateError } from "./domain.js";
import { readDeepResearchWorkspace } from "./deepResearchReadRepository.js";
import { assertSelectedResearchContextPages, readResearchContextSnapshot } from "./researchContextRepository.js";
import { researchContextContentHash } from "../../../../packages/contracts/src/researchContext.js";
import { readResearchFundamentalsExport } from "./researchFundamentalRepository.js";
import { frozenOperatingMonitorBinding, frozenResearchContextBinding } from "./deepResearchEventBinding.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import { readCurrentResearchMonitorRules } from "./researchProfileReadRepository.js";
import type { SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";
import { readProviderValuationScenarioById } from "./researchValuationProviderScenarioRepository.js";
import { readProviderFcffScenarioSets } from "./researchValuationFcffScenarioRepository.js";
import { readFutuFinancialMaterialPreview } from "./researchFutuFinancialStatementRepository.js";
import { readFcffProviderReference } from "./researchValuationFcffProviderReference.js";
import {
  projectProviderOwnerContext,
  providerPeriodFromPreview,
  selectedProviderOperatingReference
} from "./researchProviderOperatingReference.js";

export interface ExpectedDeepResearchSnapshotBinding {
  membershipVersion: number;
  evidencePackId: string;
  evidencePackFingerprint: string;
  intent: DeepResearchTaskIntent;
  analysisContentVersion?: DeepResearchSnapshotData["analysisContentVersion"] | null;
}

export async function readCurrentDeepResearchSnapshot(
  pool: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  expected: ExpectedDeepResearchSnapshotBinding,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  sourceStore?:SourceSnapshotStoreOptions
): Promise<DeepResearchSnapshotData> {
  const [workspace, fundamentals, context, monitorRules] = await Promise.all([
    readDeepResearchWorkspace(pool, membershipId, actor, now, {
      accountScopeId: null,
      currentPortfolioEnabled: false,
      currentPortfolioMaxAgeSeconds: 300,
      enforceCurrentHoldingBindings: false,
      sourceStore
    }),
    readResearchFundamentalsExport(pool, membershipId, actor, now, sourceStore),
    readResearchContextSnapshot(pool, membershipId, actor, now, sourceStore),
    readCurrentResearchMonitorRules(pool, membershipId, actor)
  ]);
  if (workspace.status !== "available" || !workspace.data) {
    throw new DeepResearchGateError(`deep research workspace is not available: ${workspace.message}`);
  }
  const pack = workspace.data.latestPack;
  if (!pack || pack.currentness.status !== "current"
    || pack.id !== expected.evidencePackId
    || pack.packFingerprint !== expected.evidencePackFingerprint
    || pack.membershipVersion !== expected.membershipVersion) {
    throw new DeepResearchGateError("deep research task no longer binds the exact current evidence pack");
  }
  if (pack.materialSelectionMode === "explicit"
    && canonicalJson(expected.intent.selectedMaterialIds)
      !== canonicalJson(pack.items.map(item => item.id).sort((a,b) => Number(a)-Number(b))))
    throw new DeepResearchGateError("limited research task must use exactly its frozen selected materials");
  const prior = expected.intent.priorReport;
  const latestReport = workspace.data.latestReport;
  if (!deepResearchPriorReportMatchesLatest(latestReport, prior, pack)) {
    throw new DeepResearchGateError("deep research task no longer binds the exact latest prior report");
  }
  if (prior && !deepResearchPriorReportEligibleForModelContext(latestReport, workspace.data.userDecision)) {
    throw new DeepResearchGateError("selected prior report is incomplete, gate-failed or rejected");
  }
  const limited = pack.researchMode === "limited";
  const operatingMonitor = limited ? null : workspace.data.latestGeelySalesMonitor ?? workspace.data.latestGclPvPriceMonitor;
  if (canonicalJson(pack.frozenResearchContext?.operatingMonitor ?? null)
    !== canonicalJson(frozenOperatingMonitorBinding(operatingMonitor))) {
    throw new DeepResearchGateError("deep research task no longer binds the exact frozen operating monitor");
  }
  if (!limited && (context.status !== "available" || !context.data
    || context.peerSourceIssues?.length)) {
    throw new DeepResearchGateError(`current research context is not available: ${context.message}`);
  }
  if (!limited && (!pack.frozenResearchContext?.researchContext
    || canonicalJson(pack.frozenResearchContext.researchContext)
      !== canonicalJson(frozenResearchContextBinding(context.data!)))) {
    throw new DeepResearchGateError("deep research task no longer binds the exact frozen research context");
  }

  const events = workspace.data.events.filter((event) => event.coverageScope === "research_stock");
  const frozenProvider = pack.frozenResearchContext?.selectedValuationMethods?.find((entry) => entry.basisKind === "provider");
  const selectedProviderIds = limited ? expected.intent.selectedProviderScenarioIds ?? []
    : frozenProvider ? [frozenProvider.scenario.id] : [];
  if (selectedProviderIds.length && !sourceStore) {
    throw new DeepResearchGateError("provider valuation selection requires saved originals");
  }
  const providerValuationScenarios = await Promise.all(selectedProviderIds.map(async (id) => {
    const scenario = await readProviderValuationScenarioById(pool,membershipId,id,actor,now,sourceStore);
    if (!scenario || !scenario.recomputable || scenario.scenarioState !== "current"
      || scenario.createdAt > pack.frozenAt
      || !pack.items.some((item) => item.id === scenario.providerBasis.sourceMaterialId)
      || !expected.intent.selectedMaterialIds.includes(scenario.providerBasis.sourceMaterialId)
      || (!limited && (!frozenProvider
        || canonicalJson(scenario) !== canonicalJson(frozenProvider.scenario)))) {
      throw new DeepResearchGateError("selected provider valuation no longer binds frozen research source");
    }
    return scenario;
  }));
  const selectedProviderFcffIds = limited ? expected.intent.selectedProviderFcffScenarioIds ?? [] : [];
  if (selectedProviderFcffIds.length && !sourceStore)
    throw new DeepResearchGateError("provider FCFF selection requires saved originals");
  const availableProviderFcff = selectedProviderFcffIds.length
    ? await readProviderFcffScenarioSets(pool, membershipId, actor, now, sourceStore) : [];
  const providerFcffScenarios = selectedProviderFcffIds.map((id) => {
    const scenario = availableProviderFcff.find((item) => item.id === id);
    const reference = scenario?.providerReference;
    if (!scenario || !reference || !scenario.recomputable || scenario.scenarioState !== "current"
      || scenario.createdAt > pack.frozenAt
      || !pack.items.some((item) => item.id === reference.materialId
        && item.revision === reference.materialRevision
        && item.contentFingerprint === reference.materialFingerprint)
      || !expected.intent.selectedMaterialIds.includes(reference.materialId)
      || reference.shareReference !== null
        && (![reference.shareReference.issuedMaterialId, reference.shareReference.treasuryMaterialId]
          .every((materialId) => expected.intent.selectedMaterialIds.includes(materialId)
            && pack.items.some((item) => item.id === materialId))))
      throw new DeepResearchGateError("selected provider FCFF no longer binds its chosen originals");
    return scenario;
  });
  const providerOperatingReference = await selectedProviderReference(pool,membershipId,expected,actor,
    pack,context,sourceStore,now);
  const selectedResearchContext = await selectedResearchContextSnapshot(
    pool, membershipId, expected, pack, context, actor, sourceStore, now);
  const input: DeepResearchSnapshotHashInput = {
    schemaVersion: DEEP_RESEARCH_SNAPSHOT_SCHEMA_VERSION,
    cutoffAt: pack.frozenAt,
    target: {
      membershipId,
      membershipVersion: expected.membershipVersion,
      symbol: workspace.data.target.symbol
    },
    intent: expected.intent,
    evidencePack: pack,
    monitorRules,
    events,
    operatingMonitor: snapshotOperatingMonitor(operatingMonitor, events),
    fundamentals,
    researchContext: limited ? null : context.data,
    ...(selectedResearchContext ? { selectedResearchContext } : {}),
    ...(providerOperatingReference ? { providerOperatingReference } : {}),
    ...(selectedProviderIds.length ? { providerValuationScenarios } : {}),
    ...(selectedProviderFcffIds.length ? { providerFcffScenarios } : {}),
    ...(expected.analysisContentVersion === null ? {} : {
      analysisContentVersion: "2026-09-10.v1" as const,
      priorReportSummary: prior && latestReport ? {
        report: prior,
        cutoffAt: latestReport.payload.cutoffAt,
        conclusion: latestReport.payload.investmentThesis.slice(0, 4000),
        keyDrivers: latestReport.payload.keyDrivers.slice(0, 5).map((text) => text.slice(0, 4000)),
        invalidationConditions: latestReport.payload.invalidationConditions.slice(0, 5).map((text) => text.slice(0, 4000)),
        unknownItems: latestReport.payload.unknownItems.slice(0, 5).map((text) => text.slice(0, 4000))
      } : null
    }),
    safety: deepResearchSnapshotSafety()
  };
  const snapshot: DeepResearchSnapshotData = {
    ...input,
    snapshotId: computeDeepResearchSnapshotId(input)
  };
  const validation = validateDeepResearchSnapshotData(snapshot);
  if (!validation.ok) {
    throw new DeepResearchGateError("deep research snapshot failed validation", validation.errors);
  }
  return snapshot;
}

async function selectedResearchContextSnapshot(
  pool: Pick<Pool | PoolClient, "query">, membershipId: string,
  expected: ExpectedDeepResearchSnapshotBinding, pack: ResearchEvidencePackData,
  context: Awaited<ReturnType<typeof readResearchContextSnapshot>>,
  actor: AuthenticatedResearchActor, sourceStore: SourceSnapshotStoreOptions | undefined, now: Date
): Promise<DeepResearchSnapshotData["selectedResearchContext"]> {
  const selection = expected.intent.selectedResearchContext;
  if (!selection) return undefined;
  const current = context.data;
  if (pack.researchMode !== "limited" || context.status !== "available" || !current
    || current.currentness.status !== "current"
    || current.id !== selection.contextId
    || researchContextContentHash(current) !== selection.contentHash
    || current.membershipId !== membershipId
    || current.membershipVersion !== expected.membershipVersion
    || current.selectedSymbol !== pack.symbol
    || Date.parse(current.cutoffAt) > Date.parse(pack.frozenAt)
    || Date.parse(current.validUntil) <= now.getTime())
    throw new DeepResearchGateError("selected research context identity, currentness or cutoff changed");
  const facts = selection.selectedFactIds.map(id => current.selectedFacts.find(item => item.id === id));
  const peerFacts = (selection.peerFactIds ?? []).map(id => current.peerFacts.find(item => item.id === id));
  const peers = selection.peerIds.map(id => current.peers.find(item => item.id === id));
  if (facts.some(item => !item) || peerFacts.some(item => !item) || peers.some(item => !item))
    throw new DeepResearchGateError("selected research context item is missing from current saved version");
  const selectedFacts = facts as typeof current.selectedFacts;
  const selectedPeerFacts = peerFacts as typeof current.peerFacts;
  const selectedPeers = peers as typeof current.peers;
  if (selectedPeerFacts.some(fact => context.peerFactSourceIssues?.some(issue => issue.factId === fact.id)))
    throw new DeepResearchGateError("selected peer fact source is stale or unavailable");
  if (selectedPeerFacts.some(fact => !current.peers.some(peer =>
    peer.symbol === fact.symbol && peer.status === "included"
      && !context.peerSourceIssues?.some(issue => issue.peerId === peer.id))))
    throw new DeepResearchGateError("selected peer fact is no longer in the included peer list");
  const items = [...selectedFacts, ...selectedPeerFacts, ...selectedPeers];
  if (items.some(item => Date.parse(item.asOf) > Date.parse(pack.frozenAt)
    || Date.parse(item.cutoffAt) > Date.parse(pack.frozenAt)
    || Date.parse(item.provenance.capturedAt) > Date.parse(pack.frozenAt)
    || Date.parse(item.validUntil) <= now.getTime()))
    throw new DeepResearchGateError("selected research context item exceeds cutoff or is expired");
  await assertSelectedResearchContextPages(pool, membershipId, expected.membershipVersion, items, actor, sourceStore);
  return {contextId:current.id,contentHash:selection.contentHash,
    membershipId,membershipVersion:expected.membershipVersion,selectedSymbol:pack.symbol,
    cutoffAt:current.cutoffAt,validUntil:current.validUntil,selectedFacts,
    ...(selection.peerFactIds === undefined ? {} : {peerFacts:selectedPeerFacts}),peers:selectedPeers};
}

export async function selectedProviderReference(pool: Pick<Pool | PoolClient, "query">, membershipId: string,
  expected: ExpectedDeepResearchSnapshotBinding, actor: AuthenticatedResearchActor,
  pack: ResearchEvidencePackData, context: Awaited<ReturnType<typeof readResearchContextSnapshot>>,
  sourceStore: SourceSnapshotStoreOptions | undefined, now: Date
): Promise<DeepResearchSnapshotData["providerOperatingReference"] | null> {
  if (pack.researchMode !== "limited") {
    if (expected.intent.includeProviderOwnerContext)
      throw new DeepResearchGateError("provider Owner context is only available in limited research");
    return null;
  }
  const selectedProviderItems = pack.items.filter(item =>
    expected.intent.selectedMaterialIds.includes(item.id) && item.futuFinancialSource);
  if (expected.intent.includeProviderOwnerContext && !selectedProviderItems.length)
    throw new DeepResearchGateError("Owner context selection requires an explicitly selected OpenD material");
  if (selectedProviderItems.length && !sourceStore)
    throw new DeepResearchGateError("OpenD operating reference requires limited research and saved originals");
  const periods = await Promise.all(selectedProviderItems.map(async item => {
    const source = item.futuFinancialSource!;
    const preview = await readFutuFinancialMaterialPreview(pool,membershipId,source.captureId,
      source.financialType,source.periodEnd,actor,sourceStore!,now);
    if (canonicalJson(preview.source) !== canonicalJson(source)
      || preview.contentFingerprint !== item.contentFingerprint
      || preview.contentText !== item.contentText || preview.sourceVersion !== item.sourceVersion
      || !preview.materials.some(material => material.id === item.id
        && material.revision === item.revision
        && material.contentFingerprint === item.contentFingerprint
        && material.sourceVersion === item.sourceVersion))
      throw new DeepResearchGateError("selected OpenD original or material changed before limited research");
    const period = providerPeriodFromPreview(preview, {
      id:item.id,revision:item.revision,contentFingerprint:item.contentFingerprint,sourceVersion:item.sourceVersion
    });
    if (source.financialType === "ANNUAL") {
      try {
        period.fcffBalanceReference = await readFcffProviderReference(pool, membershipId,
          {financialCaptureId:source.captureId,sourceMaterialId:item.id,
            annualPeriodEnd:source.periodEnd,shareReferenceDate:null},actor,sourceStore!,now);
      } catch { period.limitations = [...period.limitations,
        "本期余额原页未能核对，FCFF余额参考不可用。"].slice(0, 10) }
    }
    return period;
  }));
  if (new Set(periods.map(period => `${period.financialType}:${period.periodEnd}`)).size !== periods.length)
    throw new DeepResearchGateError("selected OpenD periods are ambiguous");
  if (expected.intent.includeProviderOwnerContext
    && (context.status !== "available" || !context.data || context.data.currentness.status !== "current"
      || Date.parse(context.data.cutoffAt) > Date.parse(pack.frozenAt)))
    throw new DeepResearchGateError("selected Owner research context is unavailable at limited research cutoff");
  return periods.length
    ? selectedProviderOperatingReference({
      membershipId,membershipVersion:expected.membershipVersion,symbol:pack.symbol
    },periods,expected.intent.includeProviderOwnerContext
      ? projectProviderOwnerContext(context.data!) : null)
    : null;
}

export function deepResearchPriorReportMatchesLatest(
  report: DeepResearchReportData | null,
  prior: DeepResearchTaskIntent["priorReport"],
  pack: ResearchEvidencePackData
): boolean {
  if (!prior) return true;
  return pack.currentness.status === "current"
    && pack.currentness.invalidatedBy.length === 0
    && report !== null
    && report.contractVersion !== LEGACY_REPORT_CONTRACT_VERSION
    && !report.currentness.invalidatedBy.some((reason) =>
      ["report_fingerprint_invalid", "report_fingerprint_missing", "evidence_pack_identity_mismatch",
        "legacy_single_valuation_contract_projection"].includes(reason))
    && /^[a-f0-9]{64}$/.test(report.reportFingerprint)
    && report.id === prior.id
    && report.version === prior.version
    && report.evidencePackId === prior.evidencePackId
    && report.reportFingerprint === prior.reportFingerprint;
}

export function deepResearchPriorReportEligibleForModelContext(
  report: DeepResearchReportData | null,
  userDecision: DeepResearchDecisionData | null
): boolean {
  return report !== null
    && report.status === "complete_pending_confirmation"
    && report.gateFailures.length === 0
    && !(userDecision?.reportId === report.id && userDecision.decision === "rejected");
}

export function snapshotOperatingMonitor(
  monitor: DeepResearchOperatingMonitorData | null,
  events: ResearchAnnouncementEventData[]
): DeepResearchOperatingMonitorData | null {
  if (!monitor) return null;
  if (!operatingMonitorBindsSnapshotEvents(monitor, events)) {
    throw new DeepResearchGateError("operating monitor contains a target source event outside the selected research-stock snapshot");
  }
  return monitor;
}
