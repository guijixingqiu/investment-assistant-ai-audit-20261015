import { deepResearchPackBinding, limitedResearchAdviceIsValid } from "../../../../packages/contracts/src/limitedResearch.js";
import { createHash } from "node:crypto";
import type {
  CreateDeepResearchReportRequest,
  DeepResearchReportPayload,
  EvidenceBoundDeepResearchReportPayload,
  EvidenceBoundResearchFact,
  FrozenResearchEvidenceContext,
  FrozenResearchInvalidationReason,
  ResearchEvidencePackData,
  ResearchMaterialData
} from "../../../../packages/contracts/src/deepResearch.js";
import {
  EVIDENCE_BOUND_REPORT_CONTRACT_VERSION,
  evidenceBoundReportPackBinding
} from "../../../../packages/contracts/src/deepResearch.js";
import {
  DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
  validateSynthesizedDeepResearchReportPayload,
  type CreateSynthesizedDeepResearchReportRequest,
  type DeepResearchSynthesisCitation,
  type DeepResearchSynthesisConflict,
  type DeepResearchSynthesisFact,
  type DeepResearchSynthesisSourceKind,
  type SynthesizedDeepResearchReportPayload
} from "../../../../packages/contracts/src/deepResearchSynthesisReport.js";
import {
  deepResearchProviderAuthorizationFingerprintInput,
  deepResearchSnapshotBinding,
  type DeepResearchSnapshotData
} from "../../../../packages/contracts/src/deepResearchSnapshot.js";
import type { ResearchValuationScenarioSetData } from "../../../../packages/contracts/src/researchValuationScenarios.js";
import { DEEP_RESEARCH_OBJECTIVE_CHECK_IDS } from "../../../../packages/contracts/src/todayResearchQualityValidation.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import type { ResearchPeerCitation, ResearchContextSourceMembership } from "../../../../packages/contracts/src/researchContext.js";
import {
  frozenResearchEventChanged,
  frozenOperatingMonitorBinding,
  frozenResearchContextBinding,
  frozenResearchReportSections,
  frozenResearchSourceGapUnknownStatements,
  type CurrentFrozenResearchEvidence
} from "./deepResearchEventBinding.js";
import { dailyTechnicalResultChanged, dailyTechnicalSnapshotChanged } from "./deepResearchTechnicalIdentity.js";
import { FORMAL_DECISION_DIRECTIONS } from "../../../../packages/contracts/src/formalDecision.js";
import { validateDeepResearchTaskSendManifest } from "../../../../packages/contracts/src/deepResearchTask.js";
import { completedWeekEnd } from "../../../../packages/contracts/src/weinsteinTechnicalAnalysis.js";
import { currentHongKongDate } from "../market/dailyBarsRepository.js";
export interface DeepResearchObjectiveCheck {
  id: (typeof DEEP_RESEARCH_OBJECTIVE_CHECK_IDS)[number];
  passed: boolean;
  failures: string[];
}
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function deepResearchProviderAuthorizationMatches(intent: DeepResearchSnapshotData["intent"]): boolean {
  return intent.providerAuthorization?.ownerConfirmed === true
    && intent.providerAuthorization.confirmedIntentFingerprint
      === deepResearchProviderAuthorizationFingerprint(intent);
}
export function deepResearchProviderAuthorizationFingerprint(
  intent: DeepResearchSnapshotData["intent"]
): string {
  return sha256(canonicalJson(deepResearchProviderAuthorizationFingerprintInput(intent)));
}
export function researchMaterialFingerprint(contentText: string): string {
  return sha256(contentText);
}

export function evidencePackFingerprint(
  membershipId: string,
  membershipVersion: number,
  items: ResearchMaterialData[],
  frozenResearchContext?: FrozenResearchEvidenceContext | null,
  researchMode?: "limited",
  materialSelectionMode?: "explicit"
): string {
  return sha256(canonicalJson({
    membershipId,
    membershipVersion,
    items: items.map(packIdentityItem),
    ...(researchMode ? { researchMode } : {}),
    ...(materialSelectionMode ? { materialSelectionMode } : {}),
    ...(frozenResearchContext === undefined ? {} : { frozenResearchContext })
  }));
}

export function computedEvidencePackFingerprint(pack: ResearchEvidencePackData): string {
  return evidencePackFingerprint(pack.membershipId, pack.membershipVersion, pack.items,
    pack.frozenResearchContext ?? undefined, pack.researchMode, pack.materialSelectionMode);
}

export function frozenEvidencePackInvalidatedBy(
  frozen: FrozenResearchEvidenceContext | null,
  frozenItems: ResearchMaterialData[],
  current: CurrentFrozenResearchEvidence,
  now: Date
): FrozenResearchInvalidationReason[] {
  if (!frozen) return ["frozen_research_context_missing"];
  const reasons: FrozenResearchInvalidationReason[] = [];
  if (canonicalJson(frozen.actor) !== canonicalJson(current.actor)) reasons.push("actor_changed");
  if (frozen.membership.version !== current.membership.version) reasons.push("membership_version_changed");
  if (frozen.membership.state !== current.membership.state) reasons.push("membership_state_changed");
  if (evidencePackFingerprint(
    frozen.membership.id,
    frozen.membership.version,
    frozenItems
  ) !== evidencePackFingerprint(
    frozen.membership.id,
    frozen.membership.version,
    current.materials
  )) reasons.push("material_set_changed");
  if ([...frozenItems, ...current.materials].some((item) =>
    Date.parse(item.validUntil) <= now.getTime()
  )) reasons.push("material_source_stale"); if (frozenResearchEventChanged(frozen, current.events, current.materials, now)) reasons.push("event_source_changed");
  if (canonicalJson(frozen.operatingMonitor ?? null) !== canonicalJson(frozenOperatingMonitorBinding(current.operatingMonitor))) {
    reasons.push("operating_monitor_changed");
  }
  if (!frozen.researchContext) {
    reasons.push("research_context_binding_missing");
  } else if (Date.parse(frozen.researchContext.validUntil) <= now.getTime()) {
    reasons.push("research_context_stale");
  } else if (!current.researchContext
    || canonicalJson(frozen.researchContext) !== canonicalJson(frozenResearchContextBinding(current.researchContext))) {
    reasons.push("research_context_changed");
  }
  if (frozen.weinstein.completedWeekEnd !== completedWeekEnd(currentHongKongDate(now))) {
    reasons.push("weinstein_evidence_stale");
  }
  if (current.weinstein && canonicalJson(frozen.weinstein) !== canonicalJson(current.weinstein)) {
    reasons.push("weinstein_result_changed");
  }
  if (!frozen.quantPortfolio) {
    reasons.push("quant_portfolio_evidence_missing");
  } else if ([frozen.quantPortfolio.decision, frozen.quantPortfolio.portfolio].some((lane) =>
    lane.status === "available" && Date.parse(lane.validUntil) <= now.getTime())) {
    reasons.push("quant_portfolio_evidence_stale");
  }
  const v2Selection = frozen.selectedValuationMethods;
  if (v2Selection) {
    const frozenProvider = v2Selection.find((entry) => entry.basisKind === "provider")?.scenario;
    const frozenFcff = v2Selection.find((entry) => entry.basisKind === "fcff")?.scenario;
    const currentProvider = current.providerScenario;
    const currentFcff = current.fcffScenario;
    if (!currentProvider || !currentFcff || !frozenProvider || !frozenFcff) reasons.push("valuation_scenario_missing");
    else {
      if (frozenProvider.id !== currentProvider.id || frozenProvider.revision !== currentProvider.revision
        || frozenFcff.id !== currentFcff.id || frozenFcff.revision !== currentFcff.revision
        || canonicalJson(frozenProvider.assumptions) !== canonicalJson(currentProvider.assumptions)
        || canonicalJson(frozenProvider.calculation) !== canonicalJson(currentProvider.calculation)
        || canonicalJson(frozenFcff.assumptions) !== canonicalJson(currentFcff.assumptions)
        || canonicalJson(frozenFcff.calculation) !== canonicalJson(currentFcff.calculation)) reasons.push("valuation_scenario_changed");
      if (!currentProvider.recomputable || currentProvider.scenarioState !== "current"
        || !currentFcff.recomputable || currentFcff.scenarioState !== "current") reasons.push("valuation_scenario_not_recomputable");
      if (canonicalJson(frozenProvider.providerBasis) !== canonicalJson(currentProvider.providerBasis)
        || frozenFcff.sourceFingerprint !== currentFcff.sourceFingerprint) reasons.push("valuation_anchor_source_changed");
      if (canonicalJson(frozenFcff.sourceSelection) !== canonicalJson(currentFcff.sourceSelection)) reasons.push("valuation_anchor_changed");
    }
  } else {
  const frozenValuationMethods = frozen.valuationMethods ?? (frozen.valuationScenario ? [frozen.valuationScenario] : []);
  const currentValuationMethods = current.valuationMethods ?? (current.valuationScenario ? [current.valuationScenario] : []);
  if (!current.valuationScenario || currentValuationMethods.length === 0) {
    reasons.push("valuation_scenario_missing");
  } else {
    if (canonicalJson(valuationMethodIdentities(frozenValuationMethods))
      !== canonicalJson(valuationMethodIdentities(currentValuationMethods))) {
      reasons.push("valuation_scenario_changed");
    }
    if (canonicalJson(frozen.fcffScenario?.id ?? null) !== canonicalJson(current.fcffScenario?.id ?? null)
      || canonicalJson(frozen.fcffScenario?.revision ?? null) !== canonicalJson(current.fcffScenario?.revision ?? null)
      || canonicalJson(frozen.fcffScenario?.assumptions ?? null)
        !== canonicalJson(current.fcffScenario?.assumptions ?? null)
      || canonicalJson(frozen.fcffScenario?.calculation ?? null)
        !== canonicalJson(current.fcffScenario?.calculation ?? null))
      reasons.push("valuation_scenario_changed");
    if (current.fcffScenario && !current.fcffScenario.recomputable)
      reasons.push("valuation_scenario_not_recomputable");
    if (canonicalJson(frozen.fcffScenario?.sourceSelection ?? null)
      !== canonicalJson(current.fcffScenario?.sourceSelection ?? null))
      reasons.push("valuation_anchor_changed");
    if (canonicalJson(frozen.fcffScenario?.sourceFingerprint ?? null)
      !== canonicalJson(current.fcffScenario?.sourceFingerprint ?? null))
      reasons.push("valuation_anchor_source_changed");
    if (currentValuationMethods.some((scenario) => !scenario.recomputable)) reasons.push("valuation_scenario_not_recomputable");
    if (canonicalJson(valuationAnchorIds(frozenValuationMethods))
      !== canonicalJson(valuationAnchorIds(currentValuationMethods))) {
      reasons.push("valuation_anchor_changed");
    }
    if (canonicalJson(valuationAnchorSources(frozenValuationMethods))
      !== canonicalJson(valuationAnchorSources(currentValuationMethods))) {
      reasons.push("valuation_anchor_source_changed");
    }
  }
  }
  if (!current.technical) {
    reasons.push("technical_snapshot_missing");
  } else if (current.technical.completeness !== "complete"
    || !current.technical.usableForRequestedCutoff) {
    reasons.push("technical_contract_incomplete");
  } else {
    if (dailyTechnicalSnapshotChanged(frozen.technical, current.technical)) {
      reasons.push("technical_snapshot_changed");
    }
    if (dailyTechnicalResultChanged(frozen.technical, current.technical)) {
      reasons.push("technical_result_changed");
    }
  }
  return reasons;
}

export function evidencePackBlockers(items: ResearchMaterialData[], now: Date): string[] {
  const failures: string[] = [];
  if (items.length === 0) failures.push("at least one research material is required");
  if (items.length > 100) failures.push("an evidence pack cannot contain more than 100 materials");
  if (new Set(items.map((item) => item.id)).size !== items.length) failures.push("material ids must be unique");
  if (new Set(items.map((item) => item.contentFingerprint)).size !== items.length) failures.push("material content fingerprints must be unique");
  for (const item of items) {
    if (researchMaterialFingerprint(item.contentText) !== item.contentFingerprint) failures.push(`material ${item.id} content fingerprint is invalid`);
    if (item.verificationStatus === "conflict" || item.verificationStatus === "rejected") {
      failures.push(`material ${item.id} verification status cannot be frozen`);
    }
    if (!["user_provided", "authorized_public"].includes(item.rightsStatus)) failures.push(`material ${item.id} rights are not authorized`);
    if (Date.parse(item.validUntil) <= now.getTime()) failures.push(`material ${item.id} is stale`);
    if (item.publishedAt!==null && Date.parse(item.publishedAt) > Date.parse(item.capturedAt)) failures.push(`material ${item.id} was published after it was captured`);
    if (item.publishedAt!==null && Date.parse(item.publishedAt) > now.getTime() || Date.parse(item.capturedAt) > now.getTime()) failures.push(`material ${item.id} has a future source time`);
  }
  return unique(failures);
}
export function deepResearchGateFailures(
  payload: DeepResearchReportPayload | EvidenceBoundDeepResearchReportPayload | SynthesizedDeepResearchReportPayload,
  pack: ResearchEvidencePackData,
  now: Date
): string[] {
  return unique(deepResearchObjectiveChecks(payload, pack, now).flatMap((check) => check.failures));
}

export type FormalizableDeepResearchReportPayload =
  | EvidenceBoundDeepResearchReportPayload
  | SynthesizedDeepResearchReportPayload;

export function isFormalizableDeepResearchReportContractVersion(value: unknown): boolean {
  return value === EVIDENCE_BOUND_REPORT_CONTRACT_VERSION
    || value === DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION;
}

export function deepResearchReportHasFormalRecommendation(
  payload: FormalizableDeepResearchReportPayload
): boolean {
  const advice = payload.adviceLayer;
  return FORMAL_DECISION_DIRECTIONS.includes(advice.direction as never)
    && Array.isArray(advice.priceConditions) && advice.priceConditions.length > 0
    && typeof advice.priceRange === "string" && advice.priceRange.trim().length > 0
    && typeof advice.researchPositionRange === "string" && advice.researchPositionRange.trim().length > 0
    && Array.isArray(advice.assumptions) && advice.assumptions.length > 0
    && Array.isArray(advice.scenarios) && advice.scenarios.length > 0
    && typeof advice.nextQuestion === "string" && advice.nextQuestion.trim().length > 0
    && typeof advice.versionChange === "string" && advice.versionChange.trim().length > 0;
}

export function deepResearchReportIntegrityFailures(
  payload: FormalizableDeepResearchReportPayload,
  pack: ResearchEvidencePackData
): string[] {
  return payload.reportContractVersion === DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION
    ? synthesizedDeepResearchReportIntegrityFailures(payload, pack)
    : payload.reportContractVersion === EVIDENCE_BOUND_REPORT_CONTRACT_VERSION
      ? evidenceBoundReportIntegrityFailures(payload, pack)
      : ["report contract is not formalizable"];
}

export function deepResearchObjectiveChecks(
  payload: DeepResearchReportPayload | EvidenceBoundDeepResearchReportPayload | SynthesizedDeepResearchReportPayload,
  pack: ResearchEvidencePackData,
  now: Date
): DeepResearchObjectiveCheck[] {
  if ("reportContractVersion" in payload
    && payload.reportContractVersion === DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION) {
    const failures = synthesizedDeepResearchReportFailures(payload, pack, now);
    if (pack.researchMode === "limited") failures.push("有限研究仅供梳理已有依据；补齐正式研究要求后需重新生成完整报告。");
    return DEEP_RESEARCH_OBJECTIVE_CHECK_IDS.map((id, index) => ({
      id,
      passed: failures.length === 0,
      failures: index === 0 ? failures : []
    }));
  }
  const checks: DeepResearchObjectiveCheck[] = [];
  const items = new Map(pack.items.map((item) => [item.evidenceId, item]));
  const add = (id: DeepResearchObjectiveCheck["id"], failures: string[]) => {
    checks.push({ id, passed: failures.length === 0, failures: unique(failures) });
  };

  add("frozen_source_integrity", evidencePackBlockers(pack.items, now));
  if ("reportContractVersion" in payload) {
    const bindingFailures = evidenceBoundReportFailures(payload, pack);
    if (bindingFailures.length > 0) {
      add("research_question_and_cutoff", bindingFailures);
      return checks;
    }
  }

  const questionFailures: string[] = [];
  if (!payload.researchQuestion.trim()) questionFailures.push("research question is required");
  const cutoff = Date.parse(payload.cutoffAt);
  if (!Number.isFinite(cutoff)) questionFailures.push("research cutoff is invalid");
  else {
    if (cutoff > now.getTime()) questionFailures.push("research cutoff cannot be in the future");
    if (cutoff < Date.parse(pack.frozenAt)) questionFailures.push("research cutoff cannot precede the frozen evidence pack");
  }
  add("research_question_and_cutoff", questionFailures);

  add("investment_thesis", payload.investmentThesis.trim() ? [] : ["investment thesis is required"]);

  const factFailures: string[] = [];
  required(payload.factTable, "fact table", factFailures);
  validateReferences(
    payload.factTable.flatMap((item) => item.evidenceIds),
    items,
    "fact table",
    factFailures,
    (item) => "reportContractVersion" in payload
      ? item.claimType !== "model_inference"
      : item.claimType === "verified_fact"
  );
  if (payload.factTable.some((item) => item.evidenceIds.length === 0)) factFailures.push("every fact-table statement must cite frozen verified-fact evidence");
  add("fact_table_and_sources", factFailures);

  const supportFailures: string[] = [];
  if (!("reportContractVersion" in payload)) required(payload.supportEvidenceIds, "support evidence", supportFailures);
  validateReferences(payload.supportEvidenceIds, items, "support evidence", supportFailures, (item) => item.stance === "support" && item.claimType !== "model_inference");
  add("support_evidence", supportFailures);

  const counterFailures: string[] = [];
  if (!("reportContractVersion" in payload)) required(payload.counterEvidenceIds, "counter evidence", counterFailures);
  validateReferences(payload.counterEvidenceIds, items, "counter evidence", counterFailures, (item) => item.stance === "refute" && item.claimType !== "model_inference");
  if ("reportContractVersion" in payload && payload.counterEvidenceIds.length === 0
    && !payload.researchLayer.unknowns.some((item) => item.statement.includes("counterevidence=source_missing/UNKNOWN"))) {
    counterFailures.push("missing counterevidence must remain explicit source_missing/UNKNOWN");
  }
  add("counter_evidence", counterFailures);

  const conflictFailures: string[] = [];
  if (!payload.sourceConflictAssessment.trim()) conflictFailures.push("source conflict assessment is required");
  validateReferences(payload.sourceConflicts.flatMap((item) => item.evidenceIds), items, "source conflicts", conflictFailures);
  if (payload.sourceConflicts.some((item) => item.evidenceIds.length < 2)) conflictFailures.push("every source conflict must cite at least two frozen evidence items");
  add("source_conflicts", conflictFailures);

  const unknownFailures: string[] = [];
  required(payload.unknownItems, "unknown items", unknownFailures);
  add("unknown_items", unknownFailures);

  const driverFailures: string[] = [];
  required(payload.keyDrivers, "key drivers", driverFailures);
  required(payload.causalChain, "causal chain", driverFailures);
  add("key_drivers_and_causal_chain", driverFailures);

  add("valuation_or_implied_expectations",
    payload.valuationScenarios.length || payload.impliedExpectations.length
      ? [] : ["valuation scenarios or implied expectations are required"]);

  const invalidationFailures: string[] = [];
  required(payload.invalidationConditions, "invalidation conditions", invalidationFailures);
  add("invalidation_conditions", invalidationFailures);

  add("change_from_previous", payload.changeFromPrevious.trim() ? [] : ["change from previous version is required"]);

  const portfolioFailures: string[] = [];
  required(payload.portfolioImpact, "portfolio impact", portfolioFailures);
  add("portfolio_impact", portfolioFailures);

  const nextFailures: string[] = [];
  required(payload.nextValidationQuestions, "next validation questions", nextFailures);
  add("next_validation_questions", nextFailures);

  const inferenceFailures: string[] = [];
  if (!("reportContractVersion" in payload)) required(payload.modelInferences, "model inferences", inferenceFailures);
  validateReferences(payload.modelInferences.flatMap((item) => item.evidenceIds), items, "model inferences", inferenceFailures);
  if (payload.modelInferences.some((item) => item.evidenceIds.length === 0)) inferenceFailures.push("every model inference must cite frozen evidence");
  add("model_inferences", inferenceFailures);
  return checks;
}
export function deepResearchReportFingerprint(
  evidencePackId: string,
  payload: EvidenceBoundDeepResearchReportPayload | SynthesizedDeepResearchReportPayload
): string {
  return sha256(canonicalJson({
    contractVersion: payload.reportContractVersion,
    evidencePackId,
    payload
  }));
}
export function synthesizedDeepResearchReportPayload(
  request: CreateSynthesizedDeepResearchReportRequest,
  pack: ResearchEvidencePackData
): SynthesizedDeepResearchReportPayload {
  const context = pack.frozenResearchContext;
  if (!context && pack.researchMode !== "limited") throw new Error("synthesized report payload requires frozen pack context");
  const provider = request.providerPayload;
  const valuation = synthesisValuationFacts(request.snapshot);
  const quantPortfolio = synthesisQuantPortfolioFact(request.snapshot);
  const researchLayer = {
    ...provider.researchLayer,
    valuation,
    technical: request.snapshot.evidencePack.researchMode === "limited" ? [] : [synthesisTechnicalFact(request.snapshot)],
    ...(quantPortfolio ? { quantPortfolio: [quantPortfolio] } : {})
  };
  const cited = (facts: DeepResearchSynthesisFact[]) => unique(facts.flatMap((item) => item.evidenceIds));
  const factual = [
    ...researchLayer.fundamentals,
    ...researchLayer.context,
    ...researchLayer.eventsAndCatalysts,
    ...researchLayer.operatingMonitor,
    ...(researchLayer.quantPortfolio ?? []),
    ...researchLayer.risks
  ];
  return {
    researchQuestion: request.snapshot.intent.researchQuestion,
    cutoffAt: request.snapshot.cutoffAt,
    investmentThesis: provider.adviceLayer.conclusion,
    factTable: factual.map(synthesisLegacyFact),
    supportEvidenceIds: cited(factual.filter((item) => item.stance === "support")),
    counterEvidenceIds: cited(researchLayer.counterevidence),
    sourceConflictAssessment: provider.adviceLayer.conflict.description,
    sourceConflicts: researchLayer.sourceConflicts.map((item) => ({ description: item.description, evidenceIds: item.evidenceIds })),
    unknownItems: researchLayer.unknowns.map((item) => item.statement),
    keyDrivers: ["deep-research-snapshot-synthesis.v4", "deep-research-snapshot-synthesis.v5", "deep-research-snapshot-synthesis.v6", "deep-research-snapshot-synthesis.v7"]
      .includes(request.reproducibility.prompt)
      ? unique([provider.adviceLayer.longTerm.view, provider.adviceLayer.mediumShortTerm.view])
      : unique([...provider.adviceLayer.longTerm.conditions, ...provider.adviceLayer.mediumShortTerm.conditions]),
    causalChain: unique([provider.adviceLayer.longTerm.view, provider.adviceLayer.mediumShortTerm.view]),
    valuationScenarios: valuation.map((item) => item.statement),
    impliedExpectations: [],
    invalidationConditions: unique([
      ...provider.adviceLayer.longTerm.invalidationConditions,
      ...provider.adviceLayer.mediumShortTerm.invalidationConditions
    ]),
    changeFromPrevious: provider.changeFromPrevious,
    portfolioImpact: researchLayer.quantPortfolio?.map((item) => item.statement)
      ?? ["UNKNOWN: official portfolio impact is outside this advisory-only report authority."],
    nextValidationQuestions: researchLayer.nextValidationQuestions,
    modelInferences: [],
    reportContractVersion: DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
    evidencePackBinding: deepResearchPackBinding(request.snapshot.evidencePack),
    snapshotBinding: deepResearchSnapshotBinding(request.snapshot),
    snapshot: request.snapshot,
    reproducibility: request.reproducibility,
    ...(request.sendManifest ? { sendManifest: request.sendManifest } : {}),
    adviceLayer: provider.adviceLayer,
    researchLayer
  };
}
// Read-time currentness and material freshness do not rewrite the original evidence identity.
function immutablePackContent(pack: ResearchEvidencePackData): unknown {
  const { currentness: _currentness, ...content } = pack;
  return { ...content, items: pack.items.map(({ freshness: _freshness, ...item }) => item) };
}

export function synthesizedDeepResearchReportIntegrityFailures(
  payload: SynthesizedDeepResearchReportPayload,
  pack: ResearchEvidencePackData
): string[] {
  const failures: string[] = [];
  const validation = validateSynthesizedDeepResearchReportPayload(payload);
  if (!validation.ok) failures.push(...validation.errors);
  if (failures.length > 0) return unique(failures);
  if (payload.snapshot.evidencePack.id !== pack.id
    || payload.snapshot.evidencePack.packFingerprint !== pack.packFingerprint
    || canonicalJson(immutablePackContent(payload.snapshot.evidencePack)) !== canonicalJson(immutablePackContent(pack))) {
    failures.push("report snapshot does not contain the exact current evidence pack");
  }
  if (canonicalJson(payload.snapshotBinding) !== canonicalJson(deepResearchSnapshotBinding(payload.snapshot))) {
    failures.push("report snapshot binding does not match the selected snapshot");
  }
  if (canonicalJson(payload.evidencePackBinding)
    !== canonicalJson(deepResearchPackBinding(payload.snapshot.evidencePack))) {
    failures.push("report evidence-pack binding does not match the selected snapshot pack");
  }
  if (pack.researchMode === "limited" && !limitedResearchAdviceIsValid(payload.adviceLayer)) {
    failures.push("limited research cannot supply a formal direction, price range or position range");
  }
  if (payload.sendManifest) {
    const validation = validateDeepResearchTaskSendManifest(payload.sendManifest);
    if (!validation.ok) failures.push(...validation.errors);
    else if (payload.sendManifest.provider !== payload.reproducibility.provider || payload.sendManifest.model !== payload.reproducibility.model || payload.sendManifest.snapshotId !== payload.snapshot.snapshotId || payload.sendManifest.membershipId !== payload.snapshot.target.membershipId || payload.sendManifest.membershipVersion !== payload.snapshot.target.membershipVersion || payload.sendManifest.symbol !== payload.snapshot.target.symbol || payload.sendManifest.evidencePackId !== payload.snapshot.evidencePack.id || payload.sendManifest.evidencePackVersion !== payload.snapshot.evidencePack.version || payload.sendManifest.evidencePackFingerprint !== payload.snapshot.evidencePack.packFingerprint || canonicalJson(payload.sendManifest.selectedMaterialIds) !== canonicalJson(payload.snapshot.intent.selectedMaterialIds) || canonicalJson(payload.sendManifest.includedStructuredSections) !== canonicalJson(payload.snapshot.intent.includedStructuredSections)) failures.push("report send manifest does not match the selected snapshot");
  }
  if (canonicalJson(payload.researchLayer.valuation) !== canonicalJson(synthesisValuationFacts(payload.snapshot))) {
    failures.push("valuation must be the exact server-derived snapshot source");
  }
  if (canonicalJson(payload.researchLayer.technical) !== canonicalJson(pack.researchMode === "limited" ? [] : [synthesisTechnicalFact(payload.snapshot)])) {
    failures.push("technical must be the exact server-derived snapshot source");
  }
  const quant = synthesisQuantPortfolioFact(payload.snapshot);
  if (canonicalJson(payload.researchLayer.quantPortfolio)
    !== canonicalJson(quant ? [quant] : undefined)) {
    failures.push("quant portfolio must be the exact server-derived snapshot source");
  }
  return unique(failures);
}

export function synthesizedReportHasOnlyLegacySingleValuationMismatch(
  payload: SynthesizedDeepResearchReportPayload,
  pack: ResearchEvidencePackData
): boolean {
  if (!validateSynthesizedDeepResearchReportPayload(payload).ok) return false;
  const methods = pack.frozenResearchContext?.valuationMethods;
  const expected = synthesisValuationFacts(payload.snapshot);
  if (methods?.length !== 2 || expected.length !== 2
    || canonicalJson(payload.researchLayer.valuation) !== canonicalJson([expected[0]])
    || canonicalJson(payload.valuationScenarios) !== canonicalJson([expected[0]!.statement])) return false;
  return synthesizedDeepResearchReportIntegrityFailures({
    ...payload,
    valuationScenarios: expected.map((item) => item.statement),
    researchLayer: { ...payload.researchLayer, valuation: expected }
  }, pack).length === 0;
}
// eslint-disable-next-line complexity -- one closed validation boundary; split only when the contract splits.
export function synthesizedDeepResearchReportFailures(
  payload: SynthesizedDeepResearchReportPayload,
  pack: ResearchEvidencePackData,
  now: Date
): string[] {
  const failures = [
    ...evidencePackBlockers(pack.items, now),
    ...synthesizedDeepResearchReportIntegrityFailures(payload, pack)
  ];
  if (failures.length > 0) return unique(failures);
  const rebuilt = synthesizedDeepResearchReportPayload({
    membershipVersion: pack.membershipVersion,
    evidencePackId: pack.id,
    idempotencyKey: "equivalence-check",
    reportContractVersion: DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
    snapshot: payload.snapshot,
    reproducibility: payload.reproducibility,
    sendManifest: payload.sendManifest,
    providerPayload: {
      adviceLayer: payload.adviceLayer,
      researchLayer: {
        fundamentals: payload.researchLayer.fundamentals,
        context: payload.researchLayer.context,
        eventsAndCatalysts: payload.researchLayer.eventsAndCatalysts,
        operatingMonitor: payload.researchLayer.operatingMonitor,
        risks: payload.researchLayer.risks,
        counterevidence: payload.researchLayer.counterevidence,
        unknowns: payload.researchLayer.unknowns,
        sourceConflicts: payload.researchLayer.sourceConflicts,
        nextValidationQuestions: payload.researchLayer.nextValidationQuestions
      },
      changeFromPrevious: payload.changeFromPrevious
    }
  }, pack);
  const compatibilityKeys = [
    "researchQuestion", "cutoffAt", "investmentThesis", "factTable", "supportEvidenceIds",
    "counterEvidenceIds", "sourceConflictAssessment", "sourceConflicts", "unknownItems",
    "keyDrivers", "causalChain", "valuationScenarios", "impliedExpectations",
    "invalidationConditions", "changeFromPrevious", "portfolioImpact",
    "nextValidationQuestions", "modelInferences"
  ] as const;
  if (compatibilityKeys.some((key) => canonicalJson(payload[key]) !== canonicalJson(rebuilt[key]))) {
    failures.push("compatibility projection does not match the snapshot-bound two-layer report");
  }
  const sources = synthesisSources(payload.snapshot);
  for (const item of synthesisClaims(payload)) validateSynthesisSource(item, sources, failures);
  for (const conflict of payload.researchLayer.sourceConflicts) validateSynthesisSource(conflict, sources, failures);
  if (snapshotIntentIncludes(payload.snapshot, "fundamentals") && payload.snapshot.fundamentals.facts.length > 0
    && payload.researchLayer.fundamentals.length === 0) failures.push("selected fundamentals must be represented with stable fundamental source ids");
  if (payload.researchLayer.fundamentals.some((item) => item.sourceKind !== "fundamental"
    && !(pack.researchMode === "limited" && item.sourceKind === "material"))) failures.push("fundamentals must use only stable fundamental source ids");
  const selectedContextCount = payload.snapshot.researchContext ? payload.snapshot.researchContext.selectedFacts.length
    + payload.snapshot.researchContext.peerFacts.length
    + (payload.snapshot.analysisContentVersion ? payload.snapshot.researchContext.operatingKpis.length : 0)
    + payload.snapshot.researchContext.macroDrivers.length
    + payload.snapshot.researchContext.industryDrivers.length : 0;
  const selectedLimitedContextCount = payload.snapshot.selectedResearchContext
    ? payload.snapshot.selectedResearchContext.selectedFacts.length
      + (payload.snapshot.selectedResearchContext.peerFacts?.length ?? 0)
      + payload.snapshot.selectedResearchContext.peers.length : 0;
  if (snapshotIntentIncludes(payload.snapshot, "research_context") && selectedContextCount + selectedLimitedContextCount > 0
    && payload.researchLayer.context.length === 0) failures.push("selected research context must be represented with stable research-context source ids");
  if (payload.researchLayer.context.some((item) => item.sourceKind !== "research_context"
    && !(pack.researchMode === "limited" && item.sourceKind === "material"))) failures.push("context must use only stable research-context source ids");
  if (snapshotIntentIncludes(payload.snapshot, "events") && selectedSnapshotEvents(payload.snapshot).length > 0
    && payload.researchLayer.eventsAndCatalysts.length === 0) failures.push("snapshot events must be represented with event source ids");
  if (payload.researchLayer.eventsAndCatalysts.some((item) => item.sourceKind !== "event"
    && !(pack.researchMode === "limited" && item.sourceKind === "material"))) failures.push("events and catalysts must use only stable event source ids");
  if (snapshotIntentIncludes(payload.snapshot, "operating_monitor") && payload.snapshot.operatingMonitor
    && payload.researchLayer.operatingMonitor.length === 0) failures.push("snapshot operating monitor must be represented with its stable source id");
  if (payload.researchLayer.operatingMonitor.some((item) => item.sourceKind !== "operating_monitor"
    && !(pack.researchMode === "limited" && item.sourceKind === "material"))) failures.push("operating monitor facts must use only its stable monitor source id");
  for (const unknown of payload.researchLayer.unknowns) {
    if (unknown.sourceKind !== "source_missing" || unknown.sourceId !== "UNKNOWN"
      || unknown.citation.kind !== "none" || unknown.evidenceIds.length > 0
      || unknown.claimType !== "UNKNOWN" || unknown.stance !== "UNKNOWN"
      || !unknown.statement.includes("UNKNOWN")) failures.push("unknowns must remain explicit source_missing UNKNOWN claims");
  }
  if (payload.adviceLayer.automaticTradingSignal !== false) failures.push("synthesized report must not be an automatic trading signal");
  if (payload.snapshot.intent.priorReport !== null && !payload.snapshot.priorReportSummary && payload.changeFromPrevious !== "UNKNOWN") {
    failures.push("changeFromPrevious must remain UNKNOWN when only prior-report identity was supplied");
  }
  const selectedIds = selectedSnapshotMaterialIds(payload.snapshot);
  const selectedMaterials = payload.snapshot.evidencePack.items.filter((item) => selectedIds.has(item.id));
  const expiry = Math.min(
    ...selectedMaterials.map((item) => Date.parse(item.validUntil)),
    ...(snapshotIntentIncludes(payload.snapshot, "fundamentals")
      ? payload.snapshot.fundamentals.facts.map((item) => Date.parse(item.source.validUntil)) : []),
    ...(snapshotIntentIncludes(payload.snapshot, "research_context") && payload.snapshot.researchContext ? [
      Date.parse(payload.snapshot.researchContext.validUntil),
      ...[
        ...payload.snapshot.researchContext.selectedFacts,
        ...payload.snapshot.researchContext.peerFacts,
        ...(payload.snapshot.analysisContentVersion ? payload.snapshot.researchContext.operatingKpis : []),
        ...payload.snapshot.researchContext.macroDrivers,
        ...payload.snapshot.researchContext.industryDrivers
      ].map((item) => Date.parse(item.validUntil))
    ] : []),
    ...(snapshotIntentIncludes(payload.snapshot, "research_context") && payload.snapshot.selectedResearchContext ? [
      Date.parse(payload.snapshot.selectedResearchContext.validUntil),
      ...[...payload.snapshot.selectedResearchContext.selectedFacts,
        ...(payload.snapshot.selectedResearchContext.peerFacts ?? []),
        ...payload.snapshot.selectedResearchContext.peers].map(item => Date.parse(item.validUntil))
    ] : []),
    ...(snapshotIntentIncludes(payload.snapshot, "operating_monitor")
      ? operatingMonitorSourceExpiries(payload.snapshot.operatingMonitor)
      : [])
  );
  const applicableUntil = Date.parse(payload.adviceLayer.applicableUntil);
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
    failures.push("the selected snapshot source horizon has expired");
  }
  if (!Number.isFinite(applicableUntil) || applicableUntil <= now.getTime()
    || applicableUntil < Date.parse(payload.snapshot.cutoffAt)
    || !Number.isFinite(expiry) || applicableUntil > expiry) {
    failures.push("advice applicableUntil is expired or exceeds the selected snapshot source horizon");
  }
  return unique(failures);
}

export function evidenceBoundReportPayload(
  request: CreateDeepResearchReportRequest,
  pack: ResearchEvidencePackData
): EvidenceBoundDeepResearchReportPayload {
  const context = pack.frozenResearchContext;
  if (!context) throw new Error("evidence-bound report payload requires frozen context");
  const valuation = serverDerivedValuationFacts(context);
  const evidenceById = new Map(pack.items.map((item) => [item.evidenceId, item]));
  const { eventsAndCatalysts, unknowns } = frozenResearchReportSections(
    pack, context, request.researchLayer.eventsAndCatalysts, request.researchLayer.unknowns
  );
  const factualClaims = [
    ...request.researchLayer.fundamentals,
    ...eventsAndCatalysts
  ];
  const cited = (claims: DeepResearchReportPayload["factTable"]) =>
    [...new Set(claims.flatMap((item) => item.evidenceIds))];
  const supportEvidenceIds = cited(factualClaims)
    .filter((id) => evidenceById.get(id)?.stance === "support");
  const counterEvidenceIds = cited(request.researchLayer.counterevidence)
    .filter((id) => evidenceById.get(id)?.stance === "refute");
  return {
    researchQuestion: `What does frozen evidence pack ${pack.id} support for ${pack.symbol}?`,
    cutoffAt: pack.frozenAt,
    investmentThesis: request.adviceLayer.conclusion,
    factTable: request.researchLayer.fundamentals.map(legacyFact),
    supportEvidenceIds,
    counterEvidenceIds,
    sourceConflictAssessment: request.adviceLayer.conflict.description,
    sourceConflicts: request.researchLayer.sourceConflicts,
    unknownItems: unknowns.map((item) => item.statement),
    keyDrivers: unique([
      ...request.adviceLayer.longTerm.conditions,
      ...request.adviceLayer.mediumShortTerm.conditions
    ]),
    causalChain: [
      request.adviceLayer.longTerm.view,
      request.adviceLayer.mediumShortTerm.view
    ],
    valuationScenarios: valuation.map((item) => item.statement),
    impliedExpectations: [],
    invalidationConditions: unique([
      ...request.adviceLayer.longTerm.invalidationConditions,
      ...request.adviceLayer.mediumShortTerm.invalidationConditions
    ]),
    changeFromPrevious: request.changeFromPrevious,
    portfolioImpact: ["UNKNOWN: official portfolio impact is outside this research report authority."],
    nextValidationQuestions: request.researchLayer.nextValidationQuestions,
    modelInferences: [],
    reportContractVersion: request.reportContractVersion,
    evidencePackBinding: request.evidencePackBinding,
    reproducibility: request.reproducibility,
    adviceLayer: request.adviceLayer,
    researchLayer: {
      ...request.researchLayer,
      eventsAndCatalysts,
      unknowns,
      valuation,
      technical: [serverDerivedTechnicalFact(context)]
    }
  };
}

export function evidenceBoundReportIntegrityFailures(
  payload: EvidenceBoundDeepResearchReportPayload,
  pack: ResearchEvidencePackData
): string[] {
  const context = pack.frozenResearchContext;
  if (!context) return ["evidence-bound report requires the current S1D frozen context"];
  const failures: string[] = [];
  if (canonicalJson(payload.evidencePackBinding)
    !== canonicalJson(evidenceBoundReportPackBinding(pack))) {
    failures.push("report evidence-pack binding does not exactly match the frozen current pack");
  }
  if (canonicalJson(payload.researchLayer.valuation)
    !== canonicalJson(serverDerivedValuationFacts(context))) {
    failures.push("valuation section must contain every exact server-derived frozen method binding");
  }
  if (canonicalJson(payload.researchLayer.technical)
    !== canonicalJson([serverDerivedTechnicalFact(context)])) {
    failures.push("technical section must be the exact server-derived frozen snapshot binding");
  }
  return unique(failures);
}

export function evidenceBoundReportHasOnlyLegacySingleValuationMismatch(
  payload: EvidenceBoundDeepResearchReportPayload,
  pack: ResearchEvidencePackData
): boolean {
  const context = pack.frozenResearchContext;
  if (context?.valuationMethods?.length !== 2) return false;
  const expected = serverDerivedValuationFacts(context);
  if (canonicalJson(payload.researchLayer.valuation) !== canonicalJson([expected[0]])
    || canonicalJson(payload.valuationScenarios) !== canonicalJson([expected[0]!.statement])) return false;
  return evidenceBoundReportIntegrityFailures({
    ...payload,
    valuationScenarios: expected.map((item) => item.statement),
    researchLayer: { ...payload.researchLayer, valuation: expected }
  }, pack).length === 0;
}

function evidenceBoundReportFailures(
  payload: EvidenceBoundDeepResearchReportPayload,
  pack: ResearchEvidencePackData
): string[] {
  const context = pack.frozenResearchContext;
  if (!context) return ["evidence-bound report requires the current S1D frozen context"];
  const failures = evidenceBoundReportIntegrityFailures(payload, pack);
  if (failures.length > 0) return failures;
  const compatibility = evidenceBoundReportPayload({
    membershipVersion: pack.membershipVersion,
    evidencePackId: pack.id,
    idempotencyKey: "equivalence-check",
    reportContractVersion: payload.reportContractVersion,
    evidencePackBinding: payload.evidencePackBinding,
    reproducibility: payload.reproducibility,
    adviceLayer: payload.adviceLayer,
    researchLayer: {
      fundamentals: payload.researchLayer.fundamentals,
      eventsAndCatalysts: payload.researchLayer.eventsAndCatalysts,
      risks: payload.researchLayer.risks,
      counterevidence: payload.researchLayer.counterevidence,
      unknowns: payload.researchLayer.unknowns,
      sourceConflicts: payload.researchLayer.sourceConflicts,
      nextValidationQuestions: payload.researchLayer.nextValidationQuestions
    },
    changeFromPrevious: payload.changeFromPrevious
  }, pack);
  const compatibilityKeys = [
    "researchQuestion", "cutoffAt", "investmentThesis", "factTable",
    "supportEvidenceIds", "counterEvidenceIds", "sourceConflictAssessment",
    "sourceConflicts", "unknownItems", "keyDrivers", "causalChain",
    "valuationScenarios", "impliedExpectations", "invalidationConditions",
    "changeFromPrevious", "portfolioImpact", "nextValidationQuestions",
    "modelInferences"
  ] as const;
  if (compatibilityKeys.some((key) =>
    canonicalJson(payload[key]) !== canonicalJson(compatibility[key]))) {
    failures.push("legacy compatibility projection does not equal the canonical two-layer report");
  }
  const cutoff = Date.parse(payload.cutoffAt);
  const applicableUntil = Date.parse(payload.adviceLayer.applicableUntil);
  const earliestSourceExpiry = Math.min(
    ...pack.items.map((item) => Date.parse(item.validUntil))
  );
  if (!Number.isFinite(cutoff) || !Number.isFinite(applicableUntil)
    || !Number.isFinite(earliestSourceExpiry)
    || applicableUntil < cutoff
    || applicableUntil > earliestSourceExpiry) {
    failures.push("advice applicableUntil must stay between the report cutoff and earliest frozen source expiry");
  }
  const evidenceById = new Map(pack.items.map((item) => [item.evidenceId, item]));
  const citedIds = new Set(evidenceById.keys());
  for (const item of [
    ...payload.researchLayer.fundamentals,
    ...payload.researchLayer.eventsAndCatalysts,
    ...payload.researchLayer.risks,
    ...payload.researchLayer.counterevidence,
    ...payload.researchLayer.unknowns
  ]) {
    if (item.sourceKind === "source_missing") {
      if (item.evidenceIds.length > 0 || item.claimType !== "UNKNOWN"
        || item.stance !== "UNKNOWN"
        || !item.statement.includes("source_missing/UNKNOWN")) {
        failures.push("source_missing claims must be uncited and explicitly UNKNOWN");
        break;
      }
      continue;
    }
    if (item.sourceKind !== "material") {
      failures.push("editable report sections may only contain material or source_missing claims");
      break;
    }
    if (item.evidenceIds.length === 0
      || item.evidenceIds.some((id) => !citedIds.has(id))) {
      failures.push("two-layer report references evidence outside its exact frozen pack");
      break;
    }
    if (item.evidenceIds.some((id) => {
      const evidence = evidenceById.get(id);
      return !evidence
        || item.claimType !== evidence.claimType
        || item.stance !== evidence.stance;
    })) {
      failures.push("material claimType and stance must exactly preserve every cited frozen source");
      break;
    }
  }
  for (const conflict of payload.researchLayer.sourceConflicts) {
    if (conflict.evidenceIds.length < 2
      || conflict.evidenceIds.some((id) => !citedIds.has(id))) {
      failures.push("every source conflict must cite at least two items from the exact frozen pack");
      break;
    }
  }
  if (payload.adviceLayer.automaticTradingSignal !== false) {
    failures.push("two-layer report must not be an automatic trading signal");
  }
  const requiredUnknowns = frozenResearchSourceGapUnknownStatements(context);
  for (const unknown of requiredUnknowns) {
    if (!payload.researchLayer.unknowns.some((item) =>
      item.sourceKind === "source_missing"
      && item.claimType === "UNKNOWN"
      && item.stance === "UNKNOWN"
      && item.statement.includes(unknown))) {
      failures.push(`missing S1D source gap must remain explicit: ${unknown}`);
    }
  }
  return unique(failures);
}

function serverDerivedValuationFacts(
  context: FrozenResearchEvidenceContext
): EvidenceBoundResearchFact[] {
  if (context.selectedValuationMethods) return context.selectedValuationMethods.map((entry) => ({
    statement: entry.basisKind === "provider"
      ? `method=${entry.scenario.calculation.method.id} basis=provider scenario=${entry.scenario.id} revision=${entry.scenario.revision} EPS=${entry.scenario.providerBasis.eps.rawValue} ${entry.scenario.providerBasis.eps.currencyCode}/share EPSOriginal=${entry.scenario.providerBasis.eps.rawSha256} PEOriginal=${entry.scenario.providerBasis.valuation.rawSha256} material=${entry.scenario.providerBasis.sourceMaterialId}:${entry.scenario.providerBasis.sourceMaterialRevision}:${entry.scenario.providerBasis.sourceMaterialFingerprint} ownerValuePerShare=${entry.scenario.calculation.scenarioPresentValuePerShare} currencyConversion=NONE`
      : `method=${entry.scenario.calculation.methodId} basis=fcff scenario=${entry.scenario.id} revision=${entry.scenario.revision} currency=${entry.scenario.calculation.currency} cutoff=${entry.scenario.calculation.valuationCutoff} calculation=${entry.scenario.calculation.calculationVersion} valuePerShare=${entry.scenario.calculation.commonEquityValuePerShare}`,
    evidenceIds: [], sourceKind: "valuation_context", claimType: "pack_context", stance: "neutral"
  }));
  const facts: EvidenceBoundResearchFact[] = (context.valuationMethods ?? (context.valuationScenario ? [context.valuationScenario] : [])).map((scenario) => ({
    statement: `scenario=${scenario.id} revision=${scenario.revision} currency=${scenario.assumptions.values.metricCurrency ?? "UNKNOWN"} numericAssumptions=8 calculation=${scenario.calculation.method.calculationVersion}`,
    evidenceIds: [],
    sourceKind: "valuation_context",
    claimType: "pack_context",
    stance: "neutral"
  }));
  if (context.fcffScenario) facts.push({
    statement: `scenario=${context.fcffScenario.id} revision=${context.fcffScenario.revision} currency=${context.fcffScenario.calculation.currency} method=${context.fcffScenario.calculation.methodId} calculation=${context.fcffScenario.calculation.calculationVersion} valuePerShare=${context.fcffScenario.calculation.commonEquityValuePerShare}`,
    evidenceIds: [], sourceKind: "valuation_context", claimType: "pack_context", stance: "neutral"
  });
  return facts;
}

function serverDerivedTechnicalFact(
  context: FrozenResearchEvidenceContext
): EvidenceBoundResearchFact {
  return {
    statement: `snapshot=${context.technical.dailyBars.snapshot?.snapshotSha} result=${context.technical.technical.resultHash} cutoff=${context.technical.dailyBars.source.dataCutoffAt} adjustment=${context.technical.dailyBars.request.adjustment} computation=${context.technical.technical.computationVersion} weinsteinDataset=${context.weinstein.datasetHash} weinsteinResult=${context.weinstein.resultHash}`,
    evidenceIds: [],
    sourceKind: "technical_context",
    claimType: "pack_context",
    stance: "neutral"
  };
}

function legacyFact(
  value: EvidenceBoundResearchFact
): DeepResearchReportPayload["factTable"][number] {
  return {
    statement: value.statement,
    evidenceIds: value.evidenceIds
  };
}

interface SynthesisSourceBinding {
  evidenceIds: string[];
  citation: DeepResearchSynthesisCitation;
  claimType: DeepResearchSynthesisFact["claimType"];
  stance: DeepResearchSynthesisFact["stance"];
}

export function deepResearchSynthesisSourceCatalog(snapshot: DeepResearchSnapshotData): Array<
  SynthesisSourceBinding & { sourceKind: DeepResearchSynthesisSourceKind; sourceId: string }
> {
  return [...synthesisSources(snapshot)].map(([key, binding]) => {
    const separator = key.indexOf(":");
    return {
      sourceKind: key.slice(0, separator) as DeepResearchSynthesisSourceKind,
      sourceId: key.slice(separator + 1),
      ...binding
    };
  });
}

function synthesisSources(snapshot: DeepResearchSnapshotData): Map<string, SynthesisSourceBinding> {
  const sources = new Map<string, SynthesisSourceBinding>();
  const selected = selectedSnapshotMaterialIds(snapshot);
  for (const material of snapshot.evidencePack.items.filter((item) => selected.has(item.id))) {
    sources.set(sourceKey("material", `material:${material.id}`), {
      evidenceIds: [material.evidenceId],
      citation: sourceCitation(material.evidenceId, material),
      claimType: material.claimType,
      stance: material.stance
    });
  }
  for (const fact of snapshotIntentIncludes(snapshot, "fundamentals") ? snapshot.fundamentals.facts : []) {
    sources.set(sourceKey("fundamental", `fundamental:${fact.id}`), {
      evidenceIds: [],
      citation: fact.citation.kind === "source_snapshot"
        ? sourceSnapshotCitation(null, fact.citation)
        : documentCitation(fact.citation.documentId, fact.citation.pageNumber, fact.citation.pageTextSha256),
      claimType: "pack_context",
      stance: "neutral"
    });
  }
  for (const fact of snapshot.researchContext && snapshotIntentIncludes(snapshot, "research_context")
    ? [...snapshot.researchContext.selectedFacts, ...snapshot.researchContext.peerFacts]
    : []) {
    sources.set(sourceKey("research_context", `research-context:${snapshot.researchContext!.id}:fact:${fact.id}`), {
      evidenceIds: [],
      citation: peerContextCitation(fact.citation),
      claimType: peerContextClaimType(fact.citation),
      stance: "neutral"
    });
  }
  if (snapshotIntentIncludes(snapshot, "research_context") && snapshot.selectedResearchContext) {
    const selected = snapshot.selectedResearchContext;
    for (const fact of selected.selectedFacts) {
      sources.set(sourceKey("research_context", `research-context:${selected.contextId}:fact:${fact.id}`), {
        evidenceIds: [],
        citation: peerContextCitation(fact.citation),
        claimType: "pack_context", stance: "neutral"
      });
    }
    for (const fact of selected.peerFacts ?? []) {
      sources.set(sourceKey("research_context", `research-context:${selected.contextId}:fact:${fact.id}`), {
        evidenceIds: [], citation: peerContextCitation(fact.citation),
        claimType: peerContextClaimType(fact.citation), stance: "neutral"
      });
    }
    for (const peer of selected.peers) {
      sources.set(sourceKey("research_context", `research-context:${selected.contextId}:peer:${peer.id}`), {
        evidenceIds: [],
        citation: peerContextCitation(peer.citation),
        claimType: "pack_context", stance: "neutral"
      });
    }
  }
  for (const driver of snapshot.researchContext && snapshotIntentIncludes(snapshot, "research_context")
    ? [...snapshot.researchContext.macroDrivers, ...snapshot.researchContext.industryDrivers]
    : []) {
    sources.set(sourceKey("research_context", `research-context:${snapshot.researchContext!.id}:driver:${driver.id}`), {
      evidenceIds: [],
      citation: documentCitation(driver.citation.documentId, driver.citation.pageNumber, driver.citation.pageTextSha256),
      claimType: "pack_context",
      stance: "neutral"
    });
  }
  const materialById = new Map(snapshot.evidencePack.items.map((item) => [item.id, item]));
  for (const kpi of snapshot.researchContext && snapshot.analysisContentVersion && snapshotIntentIncludes(snapshot, "research_context") ? snapshot.researchContext.operatingKpis : []) {
    sources.set(sourceKey("research_context", `research-context:${snapshot.researchContext!.id}:kpi:${kpi.id}`), {
      evidenceIds: [],
      citation: documentCitation(kpi.citation.documentId, kpi.citation.pageNumber, kpi.citation.pageTextSha256),
      claimType: "pack_context",
      stance: "neutral"
    });
  }
  for (const event of selectedSnapshotEvents(snapshot)) {
    const material = materialById.get(event.source.materialId);
    sources.set(sourceKey("event", `event:${event.id}`), {
      evidenceIds: [],
      citation: sourceCitation(event.source.evidenceId, material),
      claimType: event.source.claimType,
      stance: event.source.stance
    });
  }
  if (snapshotIntentIncludes(snapshot, "operating_monitor") && snapshot.operatingMonitor) {
    sources.set(sourceKey("operating_monitor", `operating-monitor:${snapshot.operatingMonitor.id}`), {
      evidenceIds: [], citation: snapshotCitation(), claimType: "pack_context", stance: "neutral"
    });
  }
  for (const valuation of synthesisValuationFacts(snapshot)) {
    sources.set(sourceKey(valuation.sourceKind, valuation.sourceId), factBinding(valuation));
  }
  if (snapshot.evidencePack.researchMode !== "limited") {
    const technical = synthesisTechnicalFact(snapshot);
    sources.set(sourceKey(technical.sourceKind, technical.sourceId), factBinding(technical));
  }
  return sources;
}

function snapshotIntentIncludes(
  snapshot: DeepResearchSnapshotData,
  section: DeepResearchSnapshotData["intent"]["includedStructuredSections"][number]
): boolean {
  return snapshot.intent.includedStructuredSections.includes(section);
}

function operatingMonitorSourceExpiries(
  monitor: DeepResearchSnapshotData["operatingMonitor"]
): number[] {
  if (!monitor) return [];
  const rows = "observations" in monitor
    ? monitor.observations
    : [...monitor.priceObservations, ...monitor.contextObservations];
  return rows.map((item) => Date.parse(item.sourceEvent.validUntil));
}

function selectedSnapshotEvents(snapshot: DeepResearchSnapshotData) {
  if (!snapshotIntentIncludes(snapshot, "events")) return [];
  const selected = selectedSnapshotMaterialIds(snapshot);
  return snapshot.events.filter((event) => selected.has(event.source.materialId));
}

function selectedSnapshotMaterialIds(snapshot: DeepResearchSnapshotData): Set<string> {
  return new Set(snapshot.intent.selectedMaterialIds.length > 0
    ? snapshot.intent.selectedMaterialIds
    : snapshot.evidencePack.researchMode === "limited" ? [] : snapshot.evidencePack.items.map((item) => item.id));
}

export function synthesisEvidenceIdsMatchSource(
  item: { sourceKind: string; sourceId: string; evidenceIds: unknown },
  sources: Map<string, SynthesisSourceBinding>
): boolean {
  const primary = sources.get(`${item.sourceKind}:${item.sourceId}`);
  const evidenceIds = item.evidenceIds;
  if (!primary || !Array.isArray(evidenceIds)) return false;
  if (canonicalJson(evidenceIds) === canonicalJson(primary.evidenceIds)) return true;
  if (item.sourceKind !== "material" || primary.citation.kind !== "pack_evidence"
    || new Set(evidenceIds).size !== evidenceIds.length
    || !primary.evidenceIds.every((id) => evidenceIds.includes(id))) return false;
  const allowed = new Set([...sources.entries()]
    .filter(([key, binding]) => key.startsWith("material:") && binding.citation.kind === "pack_evidence")
    .flatMap(([, binding]) => binding.evidenceIds));
  return evidenceIds.every((id) => typeof id === "string" && allowed.has(id));
}

function validateSynthesisSource(
  item: DeepResearchSynthesisFact | DeepResearchSynthesisConflict,
  sources: Map<string, SynthesisSourceBinding>,
  failures: string[]
): void {
  if (item.sourceKind === "source_missing") {
    if (item.sourceId !== "UNKNOWN" || item.evidenceIds.length > 0 || canonicalJson(item.citation) !== canonicalJson(emptyCitation())) {
      failures.push("source_missing references must use only the UNKNOWN identity");
    }
    if ("claimType" in item && (item.claimType !== "UNKNOWN" || item.stance !== "UNKNOWN" || !item.statement.includes("UNKNOWN"))) {
      failures.push("source_missing facts must remain explicitly UNKNOWN");
    }
    return;
  }
  const expected = sources.get(sourceKey(item.sourceKind, item.sourceId));
  if (!expected || !synthesisEvidenceIdsMatchSource(item, sources)
    || canonicalJson(item.citation) !== canonicalJson(expected.citation)) {
    failures.push(`${item.sourceKind} ${item.sourceId} does not exactly bind a selected snapshot source`);
    return;
  }
  if ("claimType" in item && (item.claimType !== expected.claimType || item.stance !== expected.stance)) {
    failures.push(`${item.sourceKind} ${item.sourceId} does not preserve source classification`);
  }
}

function synthesisClaims(payload: SynthesizedDeepResearchReportPayload): DeepResearchSynthesisFact[] {
  return [
    ...payload.researchLayer.fundamentals,
    ...payload.researchLayer.context,
    ...payload.researchLayer.valuation,
    ...payload.researchLayer.technical,
    ...payload.researchLayer.eventsAndCatalysts,
    ...payload.researchLayer.operatingMonitor,
    ...payload.researchLayer.risks,
    ...payload.researchLayer.counterevidence,
    ...payload.researchLayer.unknowns
  ];
}

export function synthesisValuationFacts(snapshot: DeepResearchSnapshotData): DeepResearchSynthesisFact[] {
  const number = (value: number) => String(Math.floor(value * 1e6 + 0.5) / 1e6);
  const context = snapshot.evidencePack.frozenResearchContext;
  if (snapshot.evidencePack.researchMode === "limited") return [
    ...(snapshot.providerValuationScenarios ?? []).map((scenario) => ({
    statement: `Owner确认的提供商来源研究情景；EPS：${scenario.providerBasis.eps.rawValue} ${scenario.providerBasis.eps.currencyCode}/股（${scenario.providerBasis.eps.periodEnd}，${scenario.providerBasis.eps.basis}）；OpenD五年PE历史均值仅作参考：${number(scenario.providerBasis.valuation.historicalAverage)}；Owner设定终值倍数：${number(scenario.assumptions.values.terminalMultiple)}；每股情景现值：${number(scenario.calculation.scenarioPresentValuePerShare)} ${scenario.assumptions.values.metricCurrency}/股。该数值不是预测、目标价或现价；若币种不同，不得与港币报价直接比较。`,
    evidenceIds: [], sourceKind: "valuation_context" as const, sourceId: `valuation:${scenario.id}:${scenario.revision}`,
    citation: snapshotCitation(), claimType: "pack_context" as const, stance: "neutral" as const
    })),
    ...(snapshot.providerFcffScenarios ?? []).map((scenario) => ({
      statement: `Owner确认的第三方参考 FCFF 情景；OpenD 材料 #${scenario.providerReference.materialId} 修订 ${scenario.providerReference.materialRevision}，余额日 ${scenario.providerReference.balanceReferenceDate}，独立股数日 ${scenario.providerReference.shareReferenceDate ?? "UNKNOWN"}，发行人核实与披露时点 UNKNOWN；Owner逐项填写权益桥接及未来预测；估值截止 ${scenario.calculation.valuationCutoff}，每股个人研究情景值 ${number(scenario.calculation.commonEquityValuePerShare)} ${scenario.calculation.currency}。这不是核实事实、预测、目标价或当前报价。`,
      evidenceIds: [], sourceKind: "valuation_context" as const,
      sourceId: `valuation:provider-fcff:${scenario.id}:${scenario.revision}`,
      citation: snapshotCitation(), claimType: "pack_context" as const, stance: "neutral" as const
    }))
  ];
  if (!context) return [];
  if (context.selectedValuationMethods) return context.selectedValuationMethods.map((entry) => ({
    statement: entry.basisKind === "provider"
      ? `方法：${entry.scenario.calculation.method.id}；来源：OpenD第三方EPS/PE，非发行人原报；EPS：${entry.scenario.providerBasis.eps.rawValue} ${entry.scenario.providerBasis.eps.currencyCode}/股；EPS捕获：${entry.scenario.providerBasis.eps.financialCaptureId}/${entry.scenario.providerBasis.eps.rawSha256}；PE捕获：${entry.scenario.providerBasis.valuation.captureId}/${entry.scenario.providerBasis.valuation.rawSha256}；材料：${entry.scenario.providerBasis.sourceMaterialId} r${entry.scenario.providerBasis.sourceMaterialRevision}；Owner情景每股值：${number(entry.scenario.calculation.scenarioPresentValuePerShare)} ${entry.scenario.assumptions.values.metricCurrency}/股；currencyConversion=NONE，不与港币现价直接比较。`
      : `方法：${entry.scenario.calculation.methodId}；来源：发行人历史原值与Owner未来假设；币种：${entry.scenario.calculation.currency}；估值截止：${entry.scenario.calculation.valuationCutoff}；余额参考：${entry.scenario.calculation.balanceReferenceDate}；每股研究情景值：${number(entry.scenario.calculation.commonEquityValuePerShare)}；FCFF预测=${entry.scenario.calculation.annual.map((year) => `${year.periodStart}~${year.periodEnd}@${year.paymentDate}:${number(year.fcff)}`).join(",")}；WACC=${number(entry.scenario.assumptions.values.wacc)}；g=${number(entry.scenario.assumptions.values.terminalGrowthRate)}。数值基于Owner情景假设，不是预测或当前报价。`,
    evidenceIds: [], sourceKind: "valuation_context",
    sourceId: `valuation:${entry.basisKind}:${entry.scenario.id}:${entry.scenario.revision}`,
    citation: snapshotCitation(), claimType: "pack_context", stance: "neutral"
  }));
  const facts: DeepResearchSynthesisFact[] = (context.valuationMethods ?? (context.valuationScenario ? [context.valuationScenario] : [])).map((scenario) => ({
    statement: snapshot.analysisContentVersion
      ? `方法：${scenario.calculation.method.id}；币种：${scenario.assumptions.values.metricCurrency ?? "UNKNOWN"}；每股研究情景值：${number(scenario.calculation.scenarioPresentValuePerShare)}；${scenario.calculation.diagonal.map((item) => `${item.scenario}=${number(item.presentValuePerShare)}（增长率=${number(item.annualGrowthRate)}，倍数=${number(item.terminalMultiple)}）`).join("；")}。数值基于Owner情景假设，不是预测或当前报价。`
      : `method=${scenario.calculation.method.id} scenario=${scenario.id} revision=${scenario.revision} currency=${scenario.assumptions.values.metricCurrency ?? "UNKNOWN"} calculation=${scenario.calculation.method.calculationVersion}`,
    evidenceIds: [],
    sourceKind: "valuation_context",
    sourceId: `valuation:${scenario.id}:${scenario.revision}`,
    citation: snapshotCitation(),
    claimType: "pack_context",
    stance: "neutral"
  }));
  if (context.fcffScenario) {
    const scenario = context.fcffScenario;
    facts.push({
      statement: snapshot.analysisContentVersion
        ? `方法：${scenario.calculation.methodId}；币种：${scenario.calculation.currency}；估值截止：${scenario.calculation.valuationCutoff}；余额参考：${scenario.calculation.balanceReferenceDate}；每股研究情景值：${number(scenario.calculation.commonEquityValuePerShare)}；FCFF预测=${scenario.calculation.annual.map((year) => `${year.periodStart}~${year.periodEnd}@${year.paymentDate}:${number(year.fcff)}`).join(",")}；终值下一年FCFF=${number(scenario.calculation.terminalNextYearFcff)}；WACC=${number(scenario.assumptions.values.wacc)}；g=${number(scenario.assumptions.values.terminalGrowthRate)}。数值基于Owner情景假设，不是预测或当前报价。`
        : `method=${scenario.calculation.methodId} scenario=${scenario.id} revision=${scenario.revision} currency=${scenario.calculation.currency} calculation=${scenario.calculation.calculationVersion}`,
      evidenceIds: [], sourceKind: "valuation_context", sourceId: `valuation:${scenario.id}:${scenario.revision}`,
      citation: snapshotCitation(), claimType: "pack_context", stance: "neutral"
    });
  }
  return facts;
}

export function synthesisTechnicalFact(snapshot: DeepResearchSnapshotData): DeepResearchSynthesisFact {
  const context = snapshot.evidencePack.frozenResearchContext!;
  const technical = context.technical;
  const point = technical.technical.points?.at(-1);
  return {
    statement: snapshot.analysisContentVersion
      ? `技术数据截止：${technical.dailyBars.source.dataCutoffAt}；复权：${technical.dailyBars.request.adjustment}；交易日：${point?.session ?? "UNKNOWN"}；研究序列收盘：${point?.candle.close ?? "UNKNOWN"}；MA20=${point?.ma20 ?? "UNKNOWN"}；MA60=${point?.ma60 ?? "UNKNOWN"}；RSI14=${point?.rsi14 ?? "UNKNOWN"}。这是历史研究序列，不是当前原始报价或独立买卖建议。`
      : `snapshot=${technical.dailyBars.snapshot?.snapshotSha} result=${technical.technical.resultHash} cutoff=${technical.dailyBars.source.dataCutoffAt} adjustment=${technical.dailyBars.request.adjustment} computation=${technical.technical.computationVersion} weinsteinDataset=${context.weinstein.datasetHash} weinsteinResult=${context.weinstein.resultHash}`,
    evidenceIds: [],
    sourceKind: "technical_context",
    sourceId: `technical:${technical.dailyBars.snapshot?.snapshotSha}:${technical.technical.resultHash}`,
    citation: snapshotCitation(),
    claimType: "pack_context",
    stance: "neutral"
  };
}

function synthesisQuantPortfolioFact(snapshot: DeepResearchSnapshotData): DeepResearchSynthesisFact | null {
  const context = snapshot.evidencePack.frozenResearchContext!;
  if (!context?.quantPortfolio) return null;
  const missing = context.quantPortfolio.decision.status === "source_missing"
    && context.quantPortfolio.portfolio.status === "source_missing";
  return {
    statement: quantPortfolioStatement(context),
    evidenceIds: [],
    sourceKind: missing ? "source_missing" : "quant_portfolio_context",
    sourceId: missing ? "UNKNOWN" : `quant-portfolio:${sha256(canonicalJson(context.quantPortfolio))}`,
    citation: missing ? emptyCitation() : snapshotCitation(),
    claimType: missing ? "UNKNOWN" : "pack_context",
    stance: missing ? "UNKNOWN" : "neutral"
  };
}

function quantPortfolioStatement(context: FrozenResearchEvidenceContext): string {
  const binding = context.quantPortfolio!;
  const decision = binding.decision.status === "available"
    ? `decision=${binding.decision.refinementId} snapshot=${binding.decision.snapshotId} cutoff=${binding.decision.dataCutoff}`
    : `decision=source_missing/UNKNOWN (${binding.decision.reason})`;
  if (binding.portfolio.status === "source_missing") {
    return `quant research-only · ${decision} · portfolio=source_missing/UNKNOWN (${binding.portfolio.reason})`;
  }
  const target = binding.portfolio.series.find((item) => item.symbol === context.membership.symbol);
  const pair = binding.portfolio.covariance.find((item) =>
    item.leftSymbol === context.membership.symbol || item.rightSymbol === context.membership.symbol);
  return [
    "quant research-only; not official portfolio or trading authority",
    decision,
    `portfolio=${binding.portfolio.evidenceId} content=${binding.portfolio.contentHash}`,
    `window=${binding.portfolio.observationStartDate}..${binding.portfolio.observationEndDate} observations=${binding.portfolio.observationCount} stability=${binding.portfolio.stability}`,
    target
      ? `target=${target.symbol} volatility=${target.annualizedVolatility} worst=${target.worstDailyReturn} tail=${target.historicalTailLossMagnitude}`
      : `target=${context.membership.symbol} source_missing/UNKNOWN`,
    pair ? `correlation=${pair.leftSymbol}/${pair.rightSymbol}:${pair.correlation ?? "UNKNOWN"}` : "correlation=UNKNOWN"
  ].join(" · ");
}

function synthesisLegacyFact(value: DeepResearchSynthesisFact): DeepResearchReportPayload["factTable"][number] {
  return { statement: value.statement, evidenceIds: value.evidenceIds };
}

function factBinding(value: DeepResearchSynthesisFact): SynthesisSourceBinding {
  return { evidenceIds: value.evidenceIds, citation: value.citation, claimType: value.claimType, stance: value.stance };
}

function sourceCitation(evidenceId: string, material: ResearchMaterialData | undefined): DeepResearchSynthesisCitation {
  if (material?.snapshotCitation && material.snapshotOriginal)
    return sourceSnapshotCitation(evidenceId,{...material.snapshotCitation,...material.snapshotOriginal});
  const citation=material?.citation;
  return citation
    ? { kind: "document_page", evidenceId, documentId: citation.documentId, pageNumber: citation.pageNumber, pageTextSha256: citation.pageTextSha256 }
    : { kind: "pack_evidence", evidenceId, documentId: null, pageNumber: null, pageTextSha256: null };
}

function sourceSnapshotCitation(evidenceId:string|null, source:Omit<Extract<DeepResearchSynthesisCitation,{kind:"source_snapshot"}>,"evidenceId">):DeepResearchSynthesisCitation {
  return {kind:"source_snapshot",evidenceId,snapshotId:source.snapshotId,textSha256:source.textSha256,
    startUtf16:source.startUtf16,endUtf16:source.endUtf16,excerptSha256:source.excerptSha256,
    rawSha256:source.rawSha256,byteLength:source.byteLength,mediaType:source.mediaType,
    canonicalUrl:source.canonicalUrl,responseUrl:source.responseUrl};
}

function documentCitation(documentId: string, pageNumber: number, pageTextSha256: string,
  sourceMembership?: ResearchContextSourceMembership): DeepResearchSynthesisCitation {
  return { kind: "document_page", evidenceId: null, documentId, pageNumber, pageTextSha256,
    ...(sourceMembership ? {sourceMembership} : {}) };
}

function peerContextCitation(citation: ResearchPeerCitation): DeepResearchSynthesisCitation {
  if ("kind" in citation && citation.kind === "saved_material") {
    const {kind: _kind,...source} = citation;
    return {kind:"peer_original",evidenceId:null,...source};
  }
  if ("documentId" in citation)
    return documentCitation(citation.documentId,citation.pageNumber,citation.pageTextSha256,citation.sourceMembership);
  throw new Error("unsupported peer context citation");
}

function peerContextClaimType(citation: ResearchPeerCitation): SynthesisSourceBinding["claimType"] {
  return "kind" in citation && citation.kind === "saved_material"
    ? citation.sourceType === "issuer_public_html" ? "pack_context" : "third_party_statement"
    : "pack_context";
}

function snapshotCitation(): DeepResearchSynthesisCitation {
  return { kind: "snapshot_object", evidenceId: null, documentId: null, pageNumber: null, pageTextSha256: null };
}

function emptyCitation(): DeepResearchSynthesisCitation {
  return { kind: "none", evidenceId: null, documentId: null, pageNumber: null, pageTextSha256: null };
}

function sourceKey(kind: DeepResearchSynthesisSourceKind, id: string): string { return `${kind}:${id}`; }

export function requestFingerprint(operation: string, value: unknown): string {
  return sha256(canonicalJson({ operation, value }));
}

function packIdentityItem(item: ResearchMaterialData): Omit<ResearchMaterialData, "freshness"> {
  const { freshness: _freshness, ...identity } = item;
  return identity;
}

function scenarioIdentity(value: ResearchValuationScenarioSetData): unknown {
  return {
    id: value.id,
    revision: value.revision,
    assumptions: value.assumptions,
    calculation: value.calculation
  };
}

function valuationMethodIdentities(values: ResearchValuationScenarioSetData[]): unknown[] {
  return [...values]
    .sort((left, right) => left.calculation.method.id.localeCompare(right.calculation.method.id))
    .map(scenarioIdentity);
}

function valuationAnchorIds(values: ResearchValuationScenarioSetData[]): string[] {
  return [...values]
    .sort((left, right) => left.calculation.method.id.localeCompare(right.calculation.method.id))
    .map((value) => value.anchor.id);
}

function valuationAnchorSources(values: ResearchValuationScenarioSetData[]): unknown[] {
  return [...values]
    .sort((left, right) => left.calculation.method.id.localeCompare(right.calculation.method.id))
    .map((value) => value.anchor.source);
}

function validateReferences(
  ids: string[],
  items: Map<string, ResearchMaterialData>,
  label: string,
  failures: string[],
  predicate: (item: ResearchMaterialData) => boolean = () => true
): void {
  for (const id of ids) {
    const item = items.get(id);
    if (!item) failures.push(`${label} references evidence ${id} outside the frozen pack`);
    else if (!predicate(item)) failures.push(`${label} references evidence ${id} with an incompatible classification or stance`);
  }
}

function required(value: unknown[], label: string, failures: string[]): void {
  if (value.length === 0) failures.push(`${label} is required`);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
