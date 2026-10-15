import { validateResearchFinancialRequirementData, type ResearchFinancialRequirementData } from "./researchFinancialRequirement.js";
import type {OperatingAnchorSelection} from "./researchOperatingAnchor.js";
import { operatingReasoningMatches, type ResearchOperatingReasoning } from "./researchOperatingReasoning.js";
import { validateResearchProviderOperatingReference, type ResearchProviderOperatingReference } from "./researchProviderOperatingReference.js";
import { type FactMetadata, isRfc3339DateTime, validateFactMetadataInto } from "./factMetadata.js";
import {
  type ResearchAnnouncementEventData,
  researchEventBindsMaterial,
  researchStockMaterials,
  validateResearchAnnouncementEventData
} from "./researchEvent.js";
import { validFrozenSourceGap, type FrozenResearchSourceGap } from "./deepResearchSourceGap.js";
import { type GeelySalesMonitorData, validateGeelySalesMonitorData } from "./geelySalesMonitor.js";
import { type GclPvPriceMonitorData, validateGclPvPriceMonitorData } from "./gclPvPriceMonitor.js";
import {
  MATERIAL_CLAIM_TYPES,
  type MaterialClaimType,
  type ResearchMaterialData,
  validResearchMaterial
} from "./researchMaterial.js";
import type { DailyTechnicalEnvelope } from "./marketDaily.js";
import {
  RESEARCH_VALUATION_SCENARIOS_SCHEMA_VERSION,
  validateResearchValuationScenariosEnvelope,
  validateFcffScenarioSet,
  validateResearchValuationScenarioSet,
  type ResearchProviderValuationScenarioSetData,
  type ResearchValuationScenarioSetData
} from "./researchValuationScenarios.js";
import { RESEARCH_FUNDAMENTALS_SCHEMA_VERSION } from "./researchFundamentals.js";
import { FCFF_METHOD_ID, fcffPublishedHongKongDay, type ResearchFcffScenarioSetData } from "./researchValuationFcff.js";
import { validateAnnualValuationScenarioInput } from "./annualValuationQuantWorkbench.js";
import {
  frozenWeinsteinEvidenceBinding,
  type FrozenWeinsteinEvidenceBinding,
  type WeinsteinTechnicalAnalysisEnvelope,
  validateWeinsteinTechnicalAnalysisEnvelope,
  validateFrozenWeinsteinEvidenceBinding
} from "./weinsteinTechnicalAnalysis.js";
import {
  candidateDiscoveryUniverseIsValid,
  type CandidateDiscoveryUniverse
} from "./marketDiscovery.js";
import {
  DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
  validateSynthesizedDeepResearchReportPayload,
  type SynthesizedDeepResearchReportPayload
} from "./deepResearchSynthesisReport.js";
import { FORMAL_DECISION_DIRECTIONS, type FormalDecisionDirection } from "./formalDecision.js";
export * from "./deepResearchSynthesisReport.js";
export * from "./researchMaterial.js";
export { INDEPENDENT_WEINSTEIN_TECHNICAL_SOURCE_TYPE } from "./researchEvent.js";
export const DEEP_RESEARCH_SCHEMA_VERSION = "2026-07-30.deep-research-beta.v5";
export const FROZEN_RESEARCH_CONTEXT_VERSION = "2026-07-30.s1d-frozen-technical-evidence.v1";
export const FROZEN_RESEARCH_CONTEXT_VERSION_V2 = "2026-10-12.selected-provider-pe-fcff.v2";
export const INDEPENDENT_WEINSTEIN_TECHNICAL_VERSION = "research.weinstein.independent-confirmation.v1";
export const EVIDENCE_BOUND_REPORT_CONTRACT_VERSION = "2026-07-30.s1e-evidence-bound-two-layer-report.v1";
export const LEGACY_REPORT_CONTRACT_VERSION = "2026-07-25.deep-research-legacy.v1";
export const FROZEN_RESEARCH_SOURCE_GAPS = [
  "macro", "industry", "event", "risk", "counterevidence"
] as const;
export const FROZEN_RESEARCH_INVALIDATION_REASONS = [
  "superseded_by_newer_pack",
  "frozen_research_context_missing",
  "actor_changed",
  "membership_version_changed",
  "membership_state_changed",
  "material_set_changed",
  "material_source_stale",
  "source_version_review_required",
  "source_original_unavailable",
  "source_original_unknown",
  "valuation_scenario_missing",
  "valuation_scenario_changed",
  "valuation_scenario_not_recomputable",
  "valuation_anchor_changed",
  "valuation_anchor_source_changed",
  "technical_snapshot_missing",
  "technical_contract_incomplete",
  "technical_snapshot_changed",
  "technical_result_changed",
  "weinstein_evidence_stale",
  "weinstein_result_changed",
  "quant_portfolio_evidence_missing",
  "quant_portfolio_evidence_stale",
  "event_source_changed",
  "operating_monitor_changed",
  "research_context_binding_missing",
  "research_context_stale",
  "research_context_changed",
  "financial_requirement_changed"
] as const;
export type FrozenResearchInvalidationReason = (typeof FROZEN_RESEARCH_INVALIDATION_REASONS)[number];
const REPORT_PAYLOAD_KEYS = [
  "researchQuestion", "cutoffAt", "investmentThesis", "factTable", "supportEvidenceIds",
  "counterEvidenceIds", "sourceConflictAssessment", "sourceConflicts", "unknownItems",
  "keyDrivers", "causalChain", "valuationScenarios", "impliedExpectations",
  "invalidationConditions", "changeFromPrevious", "portfolioImpact",
  "nextValidationQuestions", "modelInferences"
] as const;
const EVIDENCE_BOUND_REPORT_PAYLOAD_KEYS = [
  ...REPORT_PAYLOAD_KEYS,
  "reportContractVersion", "evidencePackBinding", "reproducibility",
  "adviceLayer", "researchLayer"
] as const;
export const DEEP_RESEARCH_REPORT_CURRENTNESS_REASONS = [
  "superseded_by_newer_report",
  "legacy_contract_not_formalizable",
  "report_fingerprint_missing",
  "report_fingerprint_invalid",
  "evidence_pack_historical",
  "not_latest_current_evidence_pack",
  "legacy_single_valuation_contract_projection",
  "evidence_pack_identity_mismatch", "selected_snapshot_changed"
] as const;
export type DeepResearchReportCurrentnessReason =
  (typeof DEEP_RESEARCH_REPORT_CURRENTNESS_REASONS)[number];
export interface ExpectedFrozenQuantPortfolioIdentity {
  decisionRefinementId: string | null;
  decisionUniverseSnapshotId: string | null;
  portfolioEvidenceId: string | null;
  portfolioUniverseSnapshotId: string | null;
}
export interface FreezeEvidencePackRequest {
  membershipVersion: number;
  selectionVersion?: "provider-pe-fcff-v2";
  expectedScenarioId?: string;
  expectedScenarioRevision?: number;
  expectedValuationMethods: Array<{
    scenarioId: string;
    scenarioRevision: number;
    methodId: ResearchValuationScenarioSetData["calculation"]["method"]["id"] | typeof FCFF_METHOD_ID;
    basisKind?: "provider" | "fcff";
  }>;
  expectedTechnicalSnapshotSha: string;
  expectedTechnicalResultHash: string;
  expectedWeinstein: FrozenWeinsteinEvidenceBinding;
  ownerWeinsteinZones?: OwnerWeinsteinZoneRevision;
  expectedQuantPortfolio?: ExpectedFrozenQuantPortfolioIdentity;
  idempotencyKey: string;
}
export interface OwnerWeinsteinPriceZone {
  lower: number;
  upper: number;
}
export interface OwnerWeinsteinZoneRevision {
  version: number;
  reason: string;
  basedOn: FrozenWeinsteinEvidenceBinding;
  supportZones: OwnerWeinsteinPriceZone[];
  resistanceZones: OwnerWeinsteinPriceZone[];
}
export interface CreateIndependentWeinsteinTechnicalConfirmationRequest {
  kind: typeof INDEPENDENT_WEINSTEIN_TECHNICAL_VERSION;
  membershipId: string;
  membershipVersion: number;
  expectedWeinstein: FrozenWeinsteinEvidenceBinding;
  ownerWeinsteinZones: OwnerWeinsteinZoneRevision;
  ownerConfirmed: true;
  confirmedAt: string;
  idempotencyKey: string;
}
export interface IndependentWeinsteinTechnicalConfirmationContent {
  schemaVersion: typeof INDEPENDENT_WEINSTEIN_TECHNICAL_VERSION;
  actor: { actorType: "user"; actorId: string };
  membership: { id: string; version: number; symbol: string };
  machine: WeinsteinTechnicalAnalysisEnvelope;
  ownerWeinsteinZones: OwnerWeinsteinZoneRevision;
  ownerConfirmed: true;
  confirmedAt: string;
}
export type SelectedFrozenValuationMethod =
  | { basisKind: "provider"; scenario: ResearchProviderValuationScenarioSetData }
  | { basisKind: "fcff"; scenario: ResearchFcffScenarioSetData };
export interface FrozenResearchEvidenceContext {
  bindingVersion: typeof FROZEN_RESEARCH_CONTEXT_VERSION | typeof FROZEN_RESEARCH_CONTEXT_VERSION_V2;
  actor: { actorType: "user"; actorId: string };
  membership: {
    id: string;
    version: number;
    state: "tracked" | "paused" | "archived";
    symbol: string;
  };
  financialRequirement?: ResearchFinancialRequirementData;
  researchContext?: {
    id: string;
    membershipId: string;
    membershipVersion: number;
    selectedSymbol: string;
    cutoffAt: string;
    validUntil: string;
    contentHash: string;
  };
  valuationScenario?: ResearchValuationScenarioSetData;
  valuationMethods?: ResearchValuationScenarioSetData[];
  fcffScenario?: ResearchFcffScenarioSetData;
  selectedValuationMethods?: [SelectedFrozenValuationMethod, SelectedFrozenValuationMethod];
  technical: DailyTechnicalEnvelope;
  weinstein: FrozenWeinsteinEvidenceBinding;
  ownerWeinsteinZones?: OwnerWeinsteinZoneRevision;
  unboundSources: Record<(typeof FROZEN_RESEARCH_SOURCE_GAPS)[number], FrozenResearchSourceGap>;
  quantPortfolio?: FrozenQuantPortfolioEvidenceBinding;
  operatingMonitor?: {
    kind: "geely_sales" | "gcl_pv_price";
    id: string;
    runVersion: number;
    runFingerprint: string;
  } | null;
}
export interface FrozenQuantEvidenceMissing {
  status: "source_missing";
  reason: string;
}
export type FrozenDecisionQuantEvidenceBinding = FrozenQuantEvidenceMissing | {
  status: "available";
  refinementId: string;
  snapshotId: string;
  snapshotHash: string;
  dataHash: string;
  dataCutoff: string;
  generatedAt: string;
  source: string;
  asOf: string;
  fetchedAt: string;
  validUntil: string;
  hkConnectUniverse: CandidateDiscoveryUniverse;
};
export type FrozenPortfolioQuantEvidenceBinding = FrozenQuantEvidenceMissing | {
  status: "available";
  evidenceId: string;
  contentHash: string;
  snapshotId: string;
  snapshotHash: string;
  dataHash: string;
  dataCutoff: string;
  observationStartDate: string;
  observationEndDate: string;
  observationCount: number;
  stability: "sample_threshold_met" | "insufficient_tiny_sample";
  generatedAt: string;
  validUntil: string;
  hkConnectUniverse: CandidateDiscoveryUniverse;
  series: Array<{
    symbol: string;
    annualizedVolatility: number;
    worstDailyReturn: number;
    historicalTailLossMagnitude: number;
  }>;
  covariance: Array<{
    leftSymbol: string;
    rightSymbol: string;
    annualizedCovariance: number;
    correlation: number | null;
  }>;
};
export interface FrozenQuantPortfolioEvidenceBinding {
  decision: FrozenDecisionQuantEvidenceBinding;
  portfolio: FrozenPortfolioQuantEvidenceBinding;
}
export interface ResearchEvidencePackData {
  researchMode?: "limited";
  /** Present only for limited packs frozen from an explicit material choice. */
  materialSelectionMode?: "explicit";
  id: string;
  membershipId: string;
  membershipVersion: number;
  market: "HK";
  code: string;
  symbol: string;
  version: number;
  packFingerprint: string;
  frozenAt: string;
  items: ResearchMaterialData[];
  frozenResearchContext: FrozenResearchEvidenceContext | null;
  currentness: {
    status: "current" | "historical";
    invalidatedBy: FrozenResearchInvalidationReason[];
  };
}
export interface DeepResearchFact { statement: string; evidenceIds: string[]; }
export interface DeepResearchConflict { description: string; evidenceIds: string[]; }
export interface DeepResearchReportPayload {
  researchQuestion: string;
  cutoffAt: string;
  investmentThesis: string;
  factTable: DeepResearchFact[];
  supportEvidenceIds: string[];
  counterEvidenceIds: string[];
  sourceConflictAssessment: string;
  sourceConflicts: DeepResearchConflict[];
  unknownItems: string[];
  keyDrivers: string[];
  causalChain: string[];
  valuationScenarios: string[];
  impliedExpectations: string[];
  invalidationConditions: string[];
  changeFromPrevious: string;
  portfolioImpact: string[];
  nextValidationQuestions: string[];
  modelInferences: DeepResearchFact[];
}
export interface EvidenceBoundReportPackBinding {
  id: string;
  version: number;
  fingerprint: string;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  frozenAt: string;
  contextVersion: FrozenResearchEvidenceContext["bindingVersion"];
  valuation?: {
    scenarioId: string;
    scenarioRevision: number;
    assumptions: ResearchValuationScenarioSetData["assumptions"];
    calculationVersion: string;
  };
  valuationMethods?: Array<{basisKind:"provider"|"fcff";scenarioId:string;scenarioRevision:number;methodId:string;sourceFingerprint:string;calculationVersion:string}>;
  technical: {
    snapshotSha: string;
    resultHash: string;
    dataCutoffAt: string;
    adjustment: "forward_qfq_research_only";
    computationVersion: string;
  };
  quantPortfolio?: FrozenQuantPortfolioEvidenceBinding;
}
export interface EvidenceBoundReportReproducibility {
  generationMethod: "deterministic_frozen_fact_framework";
  model: "NOT_USED";
  prompt: "NOT_USED";
  provider: "NOT_USED";
  tokenUsage: "NOT_USED";
  cost: "NOT_USED";
}
export interface DeepResearchView {
  view: string;
  conditions: string[];
  invalidationConditions: string[];
  risks: string[];
}
export interface EvidenceBoundResearchFact extends DeepResearchFact {
  sourceKind: "material" | "valuation_context" | "technical_context" | "quant_portfolio_context" | "source_missing";
  claimType: MaterialClaimType | "pack_context" | "UNKNOWN";
  stance: "support" | "refute" | "neutral" | "UNKNOWN";
}
export interface EvidenceBoundAdviceLayer {
  conclusion: string;
  confidence: "low" | "medium" | "high" | "UNKNOWN";
  applicableUntil: string;
  horizonStatement: string;
  longTerm: DeepResearchView;
  mediumShortTerm: DeepResearchView;
  conflict: {
    status: "aligned" | "conflict" | "UNKNOWN";
    description: string;
  };
  direction?: FormalDecisionDirection;
  priceConditions?: string[];
  priceRange?: string;
  researchPositionRange?: string;
  assumptions?: string[];
  scenarios?: string[];
  nextQuestion?: string;
  versionChange?: string;
  automaticTradingSignal: false;
}
export interface EvidenceBoundResearchLayer {
  fundamentals: EvidenceBoundResearchFact[];
  valuation: EvidenceBoundResearchFact[];
  technical: EvidenceBoundResearchFact[];
  quantPortfolio?: EvidenceBoundResearchFact[];
  eventsAndCatalysts: EvidenceBoundResearchFact[];
  risks: EvidenceBoundResearchFact[];
  counterevidence: EvidenceBoundResearchFact[];
  unknowns: EvidenceBoundResearchFact[];
  sourceConflicts: DeepResearchConflict[];
  nextValidationQuestions: string[];
}
export type EvidenceBoundResearchDraftLayer = Omit<
  EvidenceBoundResearchLayer,
  "valuation" | "technical" | "quantPortfolio"
>;
export interface EvidenceBoundDeepResearchReportPayload extends DeepResearchReportPayload {
  reportContractVersion: typeof EVIDENCE_BOUND_REPORT_CONTRACT_VERSION;
  evidencePackBinding: EvidenceBoundReportPackBinding;
  reproducibility: EvidenceBoundReportReproducibility;
  adviceLayer: EvidenceBoundAdviceLayer;
  researchLayer: EvidenceBoundResearchLayer;
}
export interface CreateDeepResearchReportRequest {
  membershipVersion: number;
  evidencePackId: string;
  idempotencyKey: string;
  reportContractVersion: typeof EVIDENCE_BOUND_REPORT_CONTRACT_VERSION;
  evidencePackBinding: EvidenceBoundReportPackBinding;
  reproducibility: EvidenceBoundReportReproducibility;
  adviceLayer: EvidenceBoundAdviceLayer;
  researchLayer: EvidenceBoundResearchDraftLayer;
  changeFromPrevious: string;
}

export function evidenceBoundReportPackBinding(
  pack: ResearchEvidencePackData
): EvidenceBoundReportPackBinding {
  const context = pack.frozenResearchContext;
  if (!context) throw new Error("evidence-pack binding requires frozen research context");
  const snapshotSha = context.technical.dailyBars.snapshot?.snapshotSha;
  const resultHash = context.technical.technical.resultHash;
  const dataCutoffAt = context.technical.dailyBars.source.dataCutoffAt;
  if (!snapshotSha || !resultHash || !dataCutoffAt) {
    throw new Error("evidence-pack binding requires a complete technical snapshot");
  }
  return {
    id: pack.id,
    version: pack.version,
    fingerprint: pack.packFingerprint,
    membershipId: pack.membershipId,
    membershipVersion: pack.membershipVersion,
    symbol: pack.symbol,
    frozenAt: pack.frozenAt,
    contextVersion: context.bindingVersion,
    ...(context.bindingVersion === FROZEN_RESEARCH_CONTEXT_VERSION_V2
      ? { valuationMethods: (context.selectedValuationMethods ?? []).map((entry) => ({
          basisKind: entry.basisKind,
          scenarioId: entry.scenario.id,
          scenarioRevision: entry.scenario.revision,
          methodId: entry.basisKind === "provider" ? entry.scenario.calculation.method.id : entry.scenario.calculation.methodId,
          sourceFingerprint: entry.basisKind === "provider" ? entry.scenario.providerBasis.sourceMaterialFingerprint : entry.scenario.sourceFingerprint,
          calculationVersion: entry.basisKind === "provider" ? entry.scenario.calculation.method.calculationVersion : entry.scenario.calculation.calculationVersion
        })) }
      : { valuation: {
          scenarioId: context.valuationScenario!.id,
          scenarioRevision: context.valuationScenario!.revision,
          assumptions: context.valuationScenario!.assumptions,
          calculationVersion: context.valuationScenario!.calculation.method.calculationVersion
        } }),
    technical: {
      snapshotSha,
      resultHash,
      dataCutoffAt,
      adjustment: context.technical.dailyBars.request.adjustment,
      computationVersion: context.technical.technical.computationVersion
    },
    ...(context.quantPortfolio ? { quantPortfolio: context.quantPortfolio } : {})
  };
}
export interface DeepResearchReportData {
  id: string;
  evidencePackId: string;
  version: number;
  contractVersion:
    | typeof EVIDENCE_BOUND_REPORT_CONTRACT_VERSION
    | typeof DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION
    | typeof LEGACY_REPORT_CONTRACT_VERSION;
  reportFingerprint: string | "UNKNOWN";
  currentness: {
    status: "current" | "historical";
    invalidatedBy: DeepResearchReportCurrentnessReason[];
    evidencePackInvalidatedBy: FrozenResearchInvalidationReason[];
  };
  status: "evidence_insufficient" | "complete_pending_confirmation";
  gateFailures: string[];
  payload: DeepResearchReportPayload | EvidenceBoundDeepResearchReportPayload | SynthesizedDeepResearchReportPayload;
  createdAt: string;
}
export interface DecideDeepResearchReportRequest {
  membershipVersion: number;
  decision: "confirmed" | "rejected";
  note?: string | null;
  idempotencyKey: string;
}
export interface DeleteDeepResearchReportRequest {
  membershipVersion: number;
  reportFingerprint: string;
  ownerConfirmed: true;
  idempotencyKey: string;
}
export interface DeepResearchReportDeletionData {
  reportId: string;
  evidencePackId: string;
  reportVersion: number;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  reportFingerprint: string;
  deletedAt: string;
  state: "deleted";
}
export interface DeepResearchDecisionData {
  id: string;
  reportId: string;
  decision: "confirmed" | "rejected";
  note: string | null;
  actorType: "user";
  actorId: string;
  decidedAt: string;
}
export interface DeepResearchWorkspaceEnvelope {
  schemaVersion: typeof DEEP_RESEARCH_SCHEMA_VERSION;
  generatedAt: string;
  status: "available" | "not_found" | "unavailable";
  membershipId: string;
  requestedActorId: string;
  requestedSymbol: string | null;
  metadata: FactMetadata;
  data: {
    target: {
      membershipId: string;
      membershipVersion: number;
      membershipState: "tracked" | "paused" | "archived";
      market: "HK";
      code: string;
      symbol: string;
    };
    materials: ResearchMaterialData[];
    events: ResearchAnnouncementEventData[];
    latestGeelySalesMonitor: GeelySalesMonitorData | null;
    latestGclPvPriceMonitor: GclPvPriceMonitorData | null;
    latestPack: ResearchEvidencePackData | null;
    evidencePacks: ResearchEvidencePackData[];
    latestReport: DeepResearchReportData | null;
    reports: DeepResearchReportData[];
    reportDeletions?: DeepResearchReportDeletionData[];
    operatingReasoning?: ResearchOperatingReasoning | null;
    operatingAnchorSelection?: OperatingAnchorSelection;
    providerOperatingReference?: ResearchProviderOperatingReference;
    userDecision: DeepResearchDecisionData | null;
    decisions: DeepResearchDecisionData[];
    classification: {
      verifiedFactMaterialIds: string[];
      issuerStatementMaterialIds: string[];
      thirdPartyStatementMaterialIds: string[];
      modelInferenceMaterialIds: string[];
      userDecisionId: string | null;
    };
    completion: {
      state: "materials_required" | "pack_required" | "research_required" | "user_confirmation_required" | "confirmed" | "rejected";
      deepResearchComplete: boolean;
      reasons: string[];
    };
  } | null;
  message: string;
}
export function validateFreezeEvidencePackRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["request must be an object"]);
  const v2 = value.selectionVersion === "provider-pe-fcff-v2";
  exact(value, [
    "membershipVersion", ...(v2 ? ["selectionVersion"] : ["expectedScenarioId", "expectedScenarioRevision"]),
    "expectedValuationMethods",
    "expectedTechnicalSnapshotSha", "expectedTechnicalResultHash", "expectedWeinstein", "ownerWeinsteinZones",
    "expectedQuantPortfolio", "idempotencyKey"
  ], "request", errors);
  positiveInteger(value.membershipVersion, "membershipVersion", errors);
  if (!v2) {
    positiveId(value.expectedScenarioId, "expectedScenarioId", errors);
    positiveInteger(value.expectedScenarioRevision, "expectedScenarioRevision", errors);
  }
  if (!validExpectedValuationMethods(value.expectedValuationMethods, v2)) {
    errors.push("expectedValuationMethods must bind both current valuation methods exactly once");
  }
  if (!sha(value.expectedTechnicalSnapshotSha)) errors.push("expectedTechnicalSnapshotSha is invalid");
  if (!sha(value.expectedTechnicalResultHash)) errors.push("expectedTechnicalResultHash is invalid");
  if (!validateFrozenWeinsteinEvidenceBinding(value.expectedWeinstein)) errors.push("expectedWeinstein is invalid");
  if (value.ownerWeinsteinZones !== undefined
    && !validOwnerWeinsteinZoneRevision(value.ownerWeinsteinZones, value.expectedWeinstein)) {
    errors.push("ownerWeinsteinZones must be an exact revision of expectedWeinstein");
  }
  if (value.expectedQuantPortfolio !== undefined
    && !validExpectedFrozenQuantPortfolioIdentity(value.expectedQuantPortfolio)) {
    errors.push("expectedQuantPortfolio is invalid");
  }
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return errors.length ? invalid(errors) : { ok: true };
}

export function validateCreateIndependentWeinsteinTechnicalConfirmationRequest(
  value: unknown
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["request must be an object"]);
  exact(value, ["kind", "membershipId", "membershipVersion", "expectedWeinstein",
    "ownerWeinsteinZones", "ownerConfirmed", "confirmedAt", "idempotencyKey"], "request", errors);
  if (value.kind !== INDEPENDENT_WEINSTEIN_TECHNICAL_VERSION) errors.push("kind is invalid");
  positiveId(value.membershipId, "membershipId", errors);
  positiveInteger(value.membershipVersion, "membershipVersion", errors);
  if (!validateFrozenWeinsteinEvidenceBinding(value.expectedWeinstein)) errors.push("expectedWeinstein is invalid");
  if (!validOwnerWeinsteinZoneRevision(value.ownerWeinsteinZones, value.expectedWeinstein))
    errors.push("ownerWeinsteinZones must bind the exact expected machine result");
  if (value.ownerConfirmed !== true) errors.push("explicit Owner confirmation is required");
  instant(value.confirmedAt, "confirmedAt", errors);
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return errors.length ? invalid(errors) : { ok: true };
}

export function validIndependentWeinsteinTechnicalConfirmationContent(
  value: unknown
): value is IndependentWeinsteinTechnicalConfirmationContent {
  if (!record(value) || value.schemaVersion !== INDEPENDENT_WEINSTEIN_TECHNICAL_VERSION
    || !record(value.actor) || !record(value.membership) || !record(value.machine)) return false;
  const errors: string[] = [];
  exact(value, ["schemaVersion", "actor", "membership", "machine", "ownerWeinsteinZones",
    "ownerConfirmed", "confirmedAt"], "technicalConfirmation", errors);
  exact(value.actor, ["actorType", "actorId"], "technicalConfirmation.actor", errors);
  exact(value.membership, ["id", "version", "symbol"], "technicalConfirmation.membership", errors);
  const analysis = value.machine;
  const validation = validateWeinsteinTechnicalAnalysisEnvelope(analysis);
  const binding = validation.ok ? frozenWeinsteinEvidenceBinding(analysis as unknown as WeinsteinTechnicalAnalysisEnvelope) : null;
  return errors.length === 0 && value.actor.actorType === "user" && nonEmpty(value.actor.actorId)
    && positive(value.membership.id) && positiveIntegerOk(value.membership.version)
    && value.membership.symbol === analysis.symbol && value.ownerConfirmed === true
    && instantOk(value.confirmedAt) && !!binding
    && validOwnerWeinsteinZoneRevision(value.ownerWeinsteinZones, binding);
}

export function validateCreateDeepResearchReportRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["request must be an object"]);
  exact(value, [
    "membershipVersion", "evidencePackId", "idempotencyKey",
    "reportContractVersion", "evidencePackBinding", "reproducibility",
    "adviceLayer", "researchLayer", "changeFromPrevious"
  ], "request", errors);
  positiveInteger(value.membershipVersion, "membershipVersion", errors);
  positiveId(value.evidencePackId, "evidencePackId", errors);
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  if (value.reportContractVersion !== EVIDENCE_BOUND_REPORT_CONTRACT_VERSION) {
    errors.push("reportContractVersion is invalid");
  }
  bounded(value.changeFromPrevious, "changeFromPrevious", 4000, errors);
  validateEvidencePackBinding(value.evidencePackBinding, errors);
  validateReportReproducibility(value.reproducibility, errors);
  validateAdviceLayer(value.adviceLayer, errors);
  validateResearchDraftLayer(value.researchLayer, errors);
  return errors.length ? invalid(errors) : { ok: true };
}

export function validateDecideDeepResearchReportRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["request must be an object"]);
  exact(value, ["membershipVersion", "decision", "note", "idempotencyKey"], "request", errors);
  positiveInteger(value.membershipVersion, "membershipVersion", errors);
  if (!["confirmed", "rejected"].includes(String(value.decision))) errors.push("decision is invalid");
  optionalBounded(value.note, "note", 4000, errors);
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return errors.length ? invalid(errors) : { ok: true };
}
export function validateDeleteDeepResearchReportRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["request must be an object"]);
  exact(value, ["membershipVersion", "reportFingerprint", "ownerConfirmed", "idempotencyKey"], "request", errors);
  positiveInteger(value.membershipVersion, "membershipVersion", errors);
  if (!sha(value.reportFingerprint) && value.reportFingerprint !== "UNKNOWN") errors.push("reportFingerprint is invalid");
  if (value.ownerConfirmed !== true) errors.push("ownerConfirmed must be true");
  bounded(value.idempotencyKey, "idempotencyKey", 200, errors);
  return errors.length ? invalid(errors) : { ok: true };
}

export function validateResearchEvidencePackData(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  return validPack(value) ? { ok: true } : invalid(["research evidence pack data is invalid"]);
}
export function validateDeepResearchReportData(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  return validReport(value) ? { ok: true } : invalid(["deep research report data is invalid"]);
}
export function validateEvidenceBoundReportPackBinding(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  validateEvidencePackBinding(value, errors);
  return errors.length ? invalid(errors) : { ok: true };
}
export function validateLegacyDeepResearchReportPayload(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  return record(value) && legacyReportPayloadValid(value)
    ? { ok: true }
    : invalid(["legacy deep research report payload is invalid"]);
}
export function legacyDeepResearchReportPayload(value: DeepResearchReportPayload): DeepResearchReportPayload { return Object.fromEntries(REPORT_PAYLOAD_KEYS.map((key) => [key, value[key]])) as unknown as DeepResearchReportPayload; }
export function validateDeepResearchDecisionData(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  return validDecision(value) ? { ok: true } : invalid(["deep research decision data is invalid"]);
}
export function validateDeepResearchReportDeletionData(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  return validReportDeletion(value) ? { ok: true } : invalid(["deep research report deletion data is invalid"]);
}
export function validateDeepResearchWorkspaceEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return invalid(["workspace envelope must be an object"]);
  exact(value, ["schemaVersion", "generatedAt", "status", "membershipId", "requestedActorId", "requestedSymbol", "metadata", "data", "message"], "envelope", errors);
  if (value.schemaVersion !== DEEP_RESEARCH_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  instant(value.generatedAt, "generatedAt", errors);
  if (!["available", "not_found", "unavailable"].includes(String(value.status))) errors.push("status is invalid");
  bounded(value.membershipId, "membershipId", 50, errors);
  bounded(value.requestedActorId, "requestedActorId", 200, errors);
  validateFactMetadataInto(value.metadata, "metadata", errors);
  bounded(value.message, "message", 4000, errors);
  if (value.status === "available") validateWorkspaceData(value.data, value, errors);
  else if (value.data !== null || value.requestedSymbol !== null) errors.push("non-available workspace must clear data and symbol");
  return errors.length ? invalid(errors) : { ok: true };
}
function validateWorkspaceData(value: unknown, envelope: Record<string, unknown>, errors: string[]): void {
  if (!record(value) || !record(value.target) || !record(value.classification) || !record(value.completion)) {
    errors.push("available workspace data is incomplete");
    return;
  }
  exact(value, ["target", "materials", "events", "latestGeelySalesMonitor", "latestGclPvPriceMonitor", "latestPack", "evidencePacks", "latestReport", "reports", "userDecision", "decisions", "classification", "completion", ...(Object.hasOwn(value, "reportDeletions") ? ["reportDeletions"] : []), ...(Object.hasOwn(value, "operatingReasoning") ? ["operatingReasoning"] : []), ...(Object.hasOwn(value, "operatingAnchorSelection") ? ["operatingAnchorSelection"] : []), ...(Object.hasOwn(value, "providerOperatingReference") ? ["providerOperatingReference"] : [])], "data", errors);
  const target = value.target;
  validateWorkspaceTarget(target, envelope, errors);
  const materials = validateWorkspaceMaterialsAndEvents(value, target, errors);
  if (!validGeelyMonitorForTarget(value.latestGeelySalesMonitor, target)) errors.push("latestGeelySalesMonitor does not match the workspace target");
  if (!validGclMonitorForTarget(value.latestGclPvPriceMonitor, target)) errors.push("latestGclPvPriceMonitor does not match the workspace target");
  validateWorkspacePackHistory(value, target, errors);
  const decision = validateWorkspaceReportHistory(value, errors);
  const reportDeletions = Array.isArray(value.reportDeletions)
    ? value.reportDeletions.filter(validReportDeletion)
    : [];
  const activeReportIds = new Set(Array.isArray(value.reports)
    ? value.reports.filter(validReport).map((report) => report.id)
    : []);
  if (Object.hasOwn(value, "reportDeletions") && (!Array.isArray(value.reportDeletions)
    || reportDeletions.length !== value.reportDeletions.length
    || new Set(reportDeletions.map((item) => item.reportId)).size !== reportDeletions.length
    || reportDeletions.some((item) => !record(target)
      || item.membershipId !== target.membershipId
      || item.membershipVersion > Number(target.membershipVersion)
      || item.symbol !== target.symbol
      || activeReportIds.has(item.reportId)))) {
    errors.push("reportDeletions are invalid");
  }
  validateClassification(
    value.classification,
    researchStockMaterials(
      materials,
      Array.isArray(value.events) ? value.events.filter((item): item is ResearchAnnouncementEventData =>
        validateResearchAnnouncementEventData(item).ok) : []
    ).filter((item) => item.revisionState === "current"),
    decision,
    errors
  );
  validateCompletion(value.completion, decision, errors);
  if (value.operatingAnchorSelection != null && (!record(value.operatingAnchorSelection) || !["AVAILABLE","AMBIGUOUS","UNAVAILABLE"].includes(String(value.operatingAnchorSelection.status)) || value.operatingAnchorSelection.preferredMeasurementBasis !== "issuer_sales" || !["sales_volume","revenue"].includes(String(value.operatingAnchorSelection.metric)) || !(value.operatingAnchorSelection.selectedFactId === null || positive(value.operatingAnchorSelection.selectedFactId)))) errors.push("operatingAnchorSelection is invalid");
  if (errors.length === 0 && value.operatingReasoning != null && !operatingReasoningMatches(value.operatingReasoning, envelope as unknown as DeepResearchWorkspaceEnvelope)) errors.push("operatingReasoning source, semantics or identity mismatch");
  if (Object.hasOwn(value, "providerOperatingReference")) {
    const reference = validateResearchProviderOperatingReference(value.providerOperatingReference);
    if (!reference.ok) errors.push(...reference.errors.map(error => `providerOperatingReference.${error}`));
    if (record(value.providerOperatingReference)
      && (value.providerOperatingReference.membershipId !== target.membershipId
        || value.providerOperatingReference.membershipVersion !== target.membershipVersion
        || value.providerOperatingReference.symbol !== target.symbol))
      errors.push("providerOperatingReference does not match target identity");
  }
}
function validateWorkspaceTarget(
  target: Record<string, unknown>,
  envelope: Record<string, unknown>,
  errors: string[]
): void {
  exact(target, ["membershipId", "membershipVersion", "membershipState", "market", "code", "symbol"], "target", errors);
  if (target.membershipId !== envelope.membershipId || target.symbol !== envelope.requestedSymbol
    || !positive(target.membershipId) || !positiveIntegerOk(target.membershipVersion)
    || !["tracked", "paused", "archived"].includes(String(target.membershipState))
    || target.market !== "HK" || !/^\d{5}$/.test(String(target.code))
    || target.symbol !== `HK.${target.code}`) errors.push("workspace target identity is invalid");
}
function validateWorkspaceMaterialsAndEvents(
  value: Record<string, unknown>,
  target: Record<string, unknown>,
  errors: string[]
): ResearchMaterialData[] {
  if (!Array.isArray(value.materials) || value.materials.some((item) => !validResearchMaterial(item))) errors.push("materials are invalid");
  const events = Array.isArray(value.events) ? value.events : [];
  const validEvents = events.filter((item): item is ResearchAnnouncementEventData =>
    validateResearchAnnouncementEventData(item).ok);
  if (!Array.isArray(value.events) || validEvents.length !== events.length) errors.push("events are invalid");
  const materials = Array.isArray(value.materials) ? value.materials.filter(validResearchMaterial) : [];
  if (validEvents.some((event) => event.membershipId !== target.membershipId
    || event.membershipVersion !== target.membershipVersion || event.symbol !== target.symbol
    || !materials.some((item) => researchEventBindsMaterial(event, item)))) errors.push("events do not bind workspace materials");
  return materials;
}
function validateWorkspaceReportHistory(
  value: Record<string, unknown>,
  errors: string[]
): DeepResearchDecisionData | null {
  if (value.latestReport !== null && !validReport(value.latestReport)) errors.push("latestReport is invalid");
  if (!Array.isArray(value.reports) || value.reports.some((report) => !validReport(report))) {
    errors.push("reports are invalid");
  }
  if (Array.isArray(value.reports) && new Set(value.reports.filter(validReport).map((report) => report.id)).size !== value.reports.length) {
    errors.push("report ids must be unique");
  }
  if (value.userDecision !== null && !validDecision(value.userDecision)) errors.push("userDecision is invalid");
  const report = validReport(value.latestReport) ? value.latestReport : null;
  const reports = Array.isArray(value.reports) ? value.reports.filter(validReport) : [];
  if ((report?.id ?? null) !== (reports[0]?.id ?? null)) errors.push("latestReport must match the first report history entry");
  if (!Array.isArray(value.decisions) || value.decisions.some((decision) => !validDecision(decision))) {
    errors.push("decisions are invalid");
  }
  const decisions = Array.isArray(value.decisions) ? value.decisions.filter(validDecision) : [];
  if (new Set(decisions.map((decision) => decision.id)).size !== decisions.length
    || new Set(decisions.map((decision) => decision.reportId)).size !== decisions.length) {
    errors.push("decision ids and report bindings must be unique");
  }
  if (decisions.some((decision) => !reports.some((candidate) => candidate.id === decision.reportId))) {
    errors.push("decisions must bind a report in the bounded report history");
  }
  const decision = validDecision(value.userDecision) ? value.userDecision : null;
  if (decision && (!report || decision.reportId !== report.id)) errors.push("userDecision does not match latestReport");
  if ((decision?.id ?? null) !== (decisions.find((candidate) => candidate.reportId === report?.id)?.id ?? null)) {
    errors.push("userDecision must match the latest report decision projection");
  }
  return decision;
}
function validateWorkspacePackHistory(
  value: Record<string, unknown>,
  target: Record<string, unknown>,
  errors: string[]
): void {
  const pack = validPack(value.latestPack) ? value.latestPack : null;
  if (value.latestPack !== null && !pack) errors.push("latestPack is invalid");
  if (!Array.isArray(value.evidencePacks) || value.evidencePacks.some((candidate) => !validPack(candidate))) {
    errors.push("evidencePacks are invalid");
  }
  if (pack && (pack.membershipId !== target.membershipId || pack.membershipVersion !== target.membershipVersion
    || pack.symbol !== target.symbol)) errors.push("latestPack does not match the workspace target");
  if (Array.isArray(value.evidencePacks) && value.evidencePacks.some((candidate) =>
    validPack(candidate) && (candidate.membershipId !== target.membershipId || candidate.symbol !== target.symbol))) {
    errors.push("evidencePacks do not match the workspace target");
  }
}
function validGeelyMonitorForTarget(value: unknown, target: Record<string, unknown>): boolean { return value === null || record(value) && validateGeelySalesMonitorData(value).ok && value.membershipId === target.membershipId && value.membershipVersion === target.membershipVersion && value.symbol === target.symbol; }
function validGclMonitorForTarget(value: unknown, target: Record<string, unknown>): boolean { return value === null || record(value) && validateGclPvPriceMonitorData(value).ok && value.membershipId === target.membershipId && value.membershipVersion === target.membershipVersion && value.symbol === target.symbol; }
function validPack(value: unknown): value is ResearchEvidencePackData {
  if (!record(value)) return false;
  const errors: string[] = [];
  exact(value, [
    "id", "membershipId", "membershipVersion", "market", "code", "symbol",
    "version", "packFingerprint", "frozenAt", "items", "frozenResearchContext", "currentness", "researchMode", "materialSelectionMode"
  ], "pack", errors);
  return errors.length === 0 && positive(value.id) && positive(value.membershipId) && positiveIntegerOk(value.membershipVersion)
    && value.market === "HK" && /^\d{5}$/.test(String(value.code)) && value.symbol === `HK.${value.code}`
    && positiveIntegerOk(value.version) && typeof value.packFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.packFingerprint)
    && instantOk(value.frozenAt) && Array.isArray(value.items) && value.items.length > 0 && value.items.length <= 100 && value.items.every((item) =>
      validResearchMaterial(item) && item.symbol === value.symbol) && uniqueIds(value.items.map((item) => item.id))
    && (value.researchMode === undefined || value.researchMode === "limited")
    && (value.materialSelectionMode === undefined || value.materialSelectionMode === "explicit" && value.researchMode === "limited")
    && (value.researchMode !== "limited" || value.frozenResearchContext === null)
    && validFrozenResearchContext(value.frozenResearchContext, value)
    && validPackCurrentness(value.currentness, value.frozenResearchContext, value.researchMode === "limited");
}
// eslint-disable-next-line complexity -- Frozen evidence is a single versioned validation boundary.
function validFrozenResearchContext(value: unknown, pack: Record<string, unknown>): boolean {
  if (value === null) return true;
  if (!record(value)) return false;
  const errors: string[] = [];
  const v2 = value.bindingVersion === FROZEN_RESEARCH_CONTEXT_VERSION_V2;
  exact(value, ["bindingVersion", "actor", "membership", ...(v2 ? ["selectedValuationMethods"] : ["valuationScenario"]),
    ...("researchContext" in value ? ["researchContext"] : []),
    ...("financialRequirement" in value ? ["financialRequirement"] : []),
    ...("valuationMethods" in value ? ["valuationMethods"] : []),
    ...("fcffScenario" in value ? ["fcffScenario"] : []), "technical", "weinstein", "unboundSources",
    ...("quantPortfolio" in value ? ["quantPortfolio"] : []),
    ...("operatingMonitor" in value ? ["operatingMonitor"] : []),
    ...("ownerWeinsteinZones" in value ? ["ownerWeinsteinZones"] : [])], "pack.frozenResearchContext", errors);
  if (![FROZEN_RESEARCH_CONTEXT_VERSION, FROZEN_RESEARCH_CONTEXT_VERSION_V2].includes(value.bindingVersion as typeof FROZEN_RESEARCH_CONTEXT_VERSION) || !record(value.actor)
    || !record(value.membership) || !record(value.unboundSources)) return false;
  exact(value.actor, ["actorType", "actorId"], "pack.frozenResearchContext.actor", errors);
  exact(value.membership, ["id", "version", "state", "symbol"], "pack.frozenResearchContext.membership", errors);
  if (value.actor.actorType !== "user" || !nonEmpty(value.actor.actorId)
    || value.membership.id !== pack.membershipId
    || value.membership.version !== pack.membershipVersion
    || !["tracked", "paused", "archived"].includes(String(value.membership.state))
    || value.membership.symbol !== pack.symbol) return false;
  if ("financialRequirement" in value && (!validateResearchFinancialRequirementData(value.financialRequirement)
    || value.financialRequirement.membershipId !== pack.membershipId
    || value.financialRequirement.membershipVersion !== pack.membershipVersion)) return false;
  if ("researchContext" in value && !validFrozenResearchContextBinding(value.researchContext, value.membership)) return false;
  if (v2) {
    if ("valuationScenario" in value || "valuationMethods" in value || "fcffScenario" in value
      || !validSelectedFrozenValuationMethods(value.selectedValuationMethods, value, pack)) return false;
  } else {
  const scenarioErrors: string[] = [];
  validateResearchValuationScenarioSet(value.valuationScenario, {
    membershipId: String(value.membership.id),
    membershipVersion: Number(value.membership.version),
    membershipState: value.membership.state as "tracked" | "paused" | "archived",
    symbol: String(value.membership.symbol),
    generatedAt: String(pack.frozenAt)
  }, 0, scenarioErrors, true);
  if (scenarioErrors.length > 0 || !record(value.valuationScenario)
    || value.valuationScenario.membershipId !== pack.membershipId
    || value.valuationScenario.membershipVersionAtWrite !== pack.membershipVersion
    || value.valuationScenario.symbol !== pack.symbol
    || value.valuationScenario.scenarioState !== "current"
    || value.valuationScenario.recomputable !== true) return false;
  if ("fcffScenario" in value) {
    const fcffErrors: string[] = [];
    validateFcffScenarioSet(value.fcffScenario, {
      membershipId: pack.membershipId, membershipVersion: pack.membershipVersion,
      symbol: pack.symbol
    }, 0, fcffErrors);
    if (fcffErrors.length || !record(value.fcffScenario)
      || value.fcffScenario.membershipVersionAtWrite !== pack.membershipVersion
      || value.fcffScenario.scenarioState !== "current" || value.fcffScenario.recomputable !== true) return false;
  }
  if ("valuationMethods" in value && !validFrozenValuationMethods(
    value.valuationMethods, value.membership, pack, "fcffScenario" in value ? value.fcffScenario : undefined)) return false;
  }
  if (!validCompleteTechnicalBinding(value.technical, pack.symbol)) return false;
  if (!validOptionalFrozenQuantPortfolioEvidence(value)) return false;
  const technical = value.technical as Record<string, unknown>;
  const dailyBars = technical.dailyBars as Record<string, unknown>;
  const request = dailyBars.request as Record<string, unknown>;
  if (!validateFrozenWeinsteinEvidenceBinding(value.weinstein) || !record(value.weinstein)
    || value.weinstein.symbol !== pack.symbol
    || String(request.cutoff) > String(value.weinstein.analysisAsOf)) return false;
  if ("ownerWeinsteinZones" in value
    && !validOwnerWeinsteinZoneRevision(value.ownerWeinsteinZones, value.weinstein)) return false;
  if ("operatingMonitor" in value && !validFrozenOperatingMonitor(value.operatingMonitor, pack.symbol)) return false;
  const unboundSources = value.unboundSources;
  exact(unboundSources, [...FROZEN_RESEARCH_SOURCE_GAPS], "pack.frozenResearchContext.unboundSources", errors);
  if (FROZEN_RESEARCH_SOURCE_GAPS.some((key) => !validFrozenSourceGap(unboundSources[key], key))) return false;
  return errors.length === 0;
}
function validSelectedFrozenValuationMethods(value: unknown, context: Record<string, unknown>, pack: Record<string, unknown>): boolean {
  if (!Array.isArray(value) || value.length !== 2 || !record(context.membership) || !record(context.actor)) return false;
  const entries = value as unknown[];
  if (entries.some((entry) => !record(entry) || Object.keys(entry).sort().join(",") !== "basisKind,scenario")) return false;
  if (!record(entries[0]) || entries[0].basisKind !== "provider"
    || !record(entries[1]) || entries[1].basisKind !== "fcff") return false;
  const provider = entries.find((entry) => record(entry) && entry.basisKind === "provider") as Record<string, unknown> | undefined;
  const fcff = entries.find((entry) => record(entry) && entry.basisKind === "fcff") as Record<string, unknown> | undefined;
  if (!provider || !fcff || !record(provider.scenario) || !record(fcff.scenario)) return false;
  const source = provider.scenario;
  const envelope = validateResearchValuationScenariosEnvelope({
    schemaVersion: RESEARCH_VALUATION_SCENARIOS_SCHEMA_VERSION,
    generatedAt: pack.frozenAt, status: "available", requestedActorId: context.actor.actorId,
    membershipId: pack.membershipId, membershipVersion: pack.membershipVersion,
    membershipState: context.membership.state, symbol: pack.symbol,
    fundamentalsSchemaVersion: RESEARCH_FUNDAMENTALS_SCHEMA_VERSION,
    scenarioSets: [], providerScenarioSets: [source]
  });
  const fcffErrors: string[] = [];
  validateFcffScenarioSet(fcff.scenario, {membershipId:pack.membershipId,
    membershipVersion:pack.membershipVersion,symbol:pack.symbol}, 0, fcffErrors);
  const material = Array.isArray(pack.items) ? pack.items.find((item) => record(item)
    && item.id === (source.providerBasis as Record<string, unknown>)?.sourceMaterialId) as Record<string, unknown> | undefined : undefined;
  const basis = source.providerBasis as Record<string, unknown>;
  const fcffCalculation = fcff.scenario.calculation as Record<string, unknown>;
  const frozenHongKongDay = fcffPublishedHongKongDay(pack.frozenAt);
  return envelope.ok && fcffErrors.length === 0
    && source.scenarioState === "current" && source.recomputable === true
    && fcff.scenario.scenarioState === "current" && fcff.scenario.recomputable === true
    && String(source.createdAt) <= String(pack.frozenAt) && String(fcff.scenario.createdAt) <= String(pack.frozenAt)
    && record(basis.eps) && String(basis.eps.capturedAt) <= String(pack.frozenAt)
    && record(basis.valuation) && String(basis.valuation.capturedAt) <= String(pack.frozenAt)
    && record(fcffCalculation)
    && frozenHongKongDay !== null
    && String(fcffCalculation.valuationCutoff) <= frozenHongKongDay
    && (material?.publishedAt === null || material?.publishedAt === undefined
      || Date.parse(String(material.publishedAt)) <= Date.parse(String(pack.frozenAt)))
    && record(fcff.scenario.historicalOriginals)
    && Array.isArray(fcff.scenario.historicalOriginals.facts)
    && fcff.scenario.historicalOriginals.facts.every((fact) => {
      if (!record(fact)) return false;
      const issuerMaterial = (pack.items as unknown[]).find((item) => record(item)
        && item.id === fact.materialId && item.revision === fact.materialRevision);
      const publishedDay = fcffPublishedHongKongDay(fact.publishedAt);
      return record(issuerMaterial) && publishedDay !== null
        && publishedDay <= String(fcffCalculation.valuationCutoff);
    })
    && !!material && material.revision === basis.sourceMaterialRevision
    && material.contentFingerprint === basis.sourceMaterialFingerprint
    && source.calculation !== undefined;
}
function validFrozenResearchContextBinding(value: unknown, membership: Record<string, unknown>): boolean {
  if (!record(value)) return false;
  const keys = Object.keys(value).sort().join(",");
  return keys === "contentHash,cutoffAt,id,membershipId,membershipVersion,selectedSymbol,validUntil"
    && positive(value.id) && value.membershipId === membership.id
    && value.membershipVersion === membership.version && value.selectedSymbol === membership.symbol
    && instantOk(value.cutoffAt) && instantOk(value.validUntil)
    && String(value.cutoffAt) <= String(value.validUntil) && sha(value.contentHash);
}
function validFrozenOperatingMonitor(value: unknown, symbol: unknown): boolean {
  if (value === null) return true;
  const kind = symbol === "HK.00175" ? "geely_sales" : symbol === "HK.03800" ? "gcl_pv_price" : null;
  return record(value) && value.kind === kind && positive(value.id)
    && positiveIntegerOk(value.runVersion) && sha(value.runFingerprint);
}
function validFrozenValuationMethods(
  value: unknown,
  membership: Record<string, unknown>,
  pack: Record<string, unknown>,
  fcff?: unknown
): boolean {
  if (!Array.isArray(value) || value.length !== (fcff === undefined ? 2 : 1)) return false;
  const methods = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const candidateErrors: string[] = [];
    validateResearchValuationScenarioSet(candidate, {
      membershipId: String(membership.id), membershipVersion: Number(membership.version),
      membershipState: membership.state as "tracked" | "paused" | "archived",
      symbol: String(membership.symbol), generatedAt: String(pack.frozenAt)
    }, index, candidateErrors, true);
    if (candidateErrors.length > 0 || !record(candidate) || candidate.scenarioState !== "current" || candidate.recomputable !== true
      || !record(candidate.calculation) || !record(candidate.calculation.method) || typeof candidate.calculation.method.id !== "string") return false;
    methods.add(candidate.calculation.method.id);
  }
  return fcff === undefined
    ? methods.size === 2 && methods.has("discounted_forward_metric_multiple_user_scenario")
      && methods.has("adjusted_net_asset_value_user_scenario")
    : methods.size === 1 && (methods.has("discounted_forward_metric_multiple_user_scenario")
      || methods.has("adjusted_net_asset_value_user_scenario"));
}
function validCompleteTechnicalBinding(value: unknown, symbol: unknown): boolean {
  if (!record(value) || value.completeness !== "complete" || value.usableForRequestedCutoff !== true
    || !record(value.dailyBars) || value.dailyBars.status !== "available"
    || !record(value.dailyBars.request) || value.dailyBars.request.symbol !== symbol
    || value.dailyBars.request.adjustment !== "forward_qfq_research_only"
    || !record(value.dailyBars.source) || !instantOk(value.dailyBars.source.dataCutoffAt)
    || !record(value.dailyBars.snapshot) || !sha(value.dailyBars.snapshot.snapshotSha)
    || !record(value.technical) || value.technical.status !== "available"
    || !nonEmpty(value.technical.computationVersion)
    || value.technical.inputSnapshotSha !== value.dailyBars.snapshot.snapshotSha
    || value.technical.dataCutoffAt !== value.dailyBars.source.dataCutoffAt
    || !sha(value.technical.resultHash) || !Array.isArray(value.technical.points)
    || value.technical.points.length !== value.dailyBars.snapshot.barCount
    || !record(value.technical.parameters)) return false;
  const parameters = value.technical.parameters;
  return Array.isArray(parameters.ma) && parameters.ma.join(",") === "20,60"
    && record(parameters.macd) && parameters.macd.fast === 12 && parameters.macd.slow === 26 && parameters.macd.signal === 9
    && record(parameters.bollinger) && parameters.bollinger.window === 20
    && parameters.bollinger.standardDeviations === 2 && parameters.bollinger.variance === "population"
    && record(parameters.rsi) && parameters.rsi.period === 14 && parameters.rsi.smoothing === "wilder";
}
function validFrozenQuantPortfolioEvidence(value: unknown): value is FrozenQuantPortfolioEvidenceBinding {
  if (!record(value)) return false;
  const errors: string[] = [];
  exact(value, ["decision", "portfolio"], "quantPortfolio", errors);
  return errors.length === 0
    && validFrozenDecisionQuant(value.decision)
    && validFrozenPortfolioQuant(value.portfolio);
}
function validOptionalFrozenQuantPortfolioEvidence(value: Record<string, unknown>): boolean {
  return !("quantPortfolio" in value) || validFrozenQuantPortfolioEvidence(value.quantPortfolio);
}
function validFrozenDecisionQuant(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.status === "source_missing") return exactMissingQuant(value);
  const errors: string[] = [];
  exact(value, [
    "status", "refinementId", "snapshotId", "snapshotHash", "dataHash", "dataCutoff",
    "generatedAt", "source", "asOf", "fetchedAt", "validUntil", "hkConnectUniverse"
  ], "quantPortfolio.decision", errors);
  return errors.length === 0 && value.status === "available"
    && typeof value.refinementId === "string" && /^quant-decision-evidence:[a-f0-9]{64}$/.test(value.refinementId)
    && nonEmpty(value.snapshotId) && sha(value.snapshotHash) && sha(value.dataHash)
    && nonEmpty(value.source) && String(value.source).length <= 1000
    && orderedInstants(value.asOf, value.dataCutoff, value.fetchedAt, value.generatedAt, value.validUntil)
    && candidateDiscoveryUniverseIsValid(value.hkConnectUniverse);
}
function validFrozenPortfolioQuant(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.status === "source_missing") return exactMissingQuant(value);
  const errors: string[] = [];
  exact(value, [
    "status", "evidenceId", "contentHash", "snapshotId", "snapshotHash", "dataHash",
    "dataCutoff", "observationStartDate", "observationEndDate", "observationCount", "stability",
    "generatedAt", "validUntil", "hkConnectUniverse", "series", "covariance"
  ], "quantPortfolio.portfolio", errors);
  const series = Array.isArray(value.series) ? value.series : [];
  const covariance = Array.isArray(value.covariance) ? value.covariance : [];
  return errors.length === 0 && value.status === "available"
    && typeof value.evidenceId === "string" && /^annual-portfolio-lab-quant:[a-f0-9]{64}$/.test(value.evidenceId)
    && sha(value.contentHash) && nonEmpty(value.snapshotId) && sha(value.snapshotHash) && sha(value.dataHash)
    && instantOk(value.dataCutoff) && isoDateOk(value.observationStartDate) && isoDateOk(value.observationEndDate)
    && String(value.observationStartDate) <= String(value.observationEndDate)
    && positiveIntegerOk(value.observationCount)
    && ["sample_threshold_met", "insufficient_tiny_sample"].includes(String(value.stability))
    && orderedInstants(value.dataCutoff, value.generatedAt, value.validUntil)
    && candidateDiscoveryUniverseIsValid(value.hkConnectUniverse)
    && series.length > 0 && series.length <= 1000
    && new Set(series.filter(record).map((item) => item.symbol)).size === series.length
    && series.every((item) => record(item) && exactQuantSeries(item))
    && covariance.length <= 10000 && covariance.every((item) => record(item) && exactQuantCovariance(item));
}
function exactMissingQuant(value: Record<string, unknown>): boolean {
  const errors: string[] = [];
  exact(value, ["status", "reason"], "quant source gap", errors);
  return errors.length === 0 && value.status === "source_missing"
    && nonEmpty(value.reason) && String(value.reason).length <= 4000;
}
function exactQuantSeries(value: Record<string, unknown>): boolean {
  const errors: string[] = [];
  exact(value, ["symbol", "annualizedVolatility", "worstDailyReturn", "historicalTailLossMagnitude"], "quant series", errors);
  return errors.length === 0 && /^HK\.\d{5}$/.test(String(value.symbol))
    && [value.annualizedVolatility, value.worstDailyReturn, value.historicalTailLossMagnitude]
      .every((item) => typeof item === "number" && Number.isFinite(item));
}
function exactQuantCovariance(value: Record<string, unknown>): boolean {
  const errors: string[] = [];
  exact(value, ["leftSymbol", "rightSymbol", "annualizedCovariance", "correlation"], "quant covariance", errors);
  return errors.length === 0 && /^HK\.\d{5}$/.test(String(value.leftSymbol))
    && /^HK\.\d{5}$/.test(String(value.rightSymbol))
    && typeof value.annualizedCovariance === "number" && Number.isFinite(value.annualizedCovariance)
    && (value.correlation === null || typeof value.correlation === "number"
      && Number.isFinite(value.correlation) && value.correlation >= -1 && value.correlation <= 1);
}
function orderedInstants(...values: unknown[]): boolean {
  return values.every(instantOk)
    && values.every((value, index) => index === 0 || date(values[index - 1]) <= date(value));
}
function isoDateOk(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validExpectedFrozenQuantPortfolioIdentity(value: unknown): boolean {
  if (!record(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "decisionRefinementId,decisionUniverseSnapshotId,portfolioEvidenceId,portfolioUniverseSnapshotId") {
    return false;
  }
  const decisionMissing = value.decisionRefinementId === null
    && value.decisionUniverseSnapshotId === null;
  const decisionAvailable = typeof value.decisionRefinementId === "string"
    && /^quant-decision-evidence:[a-f0-9]{64}$/.test(value.decisionRefinementId)
    && sha(value.decisionUniverseSnapshotId);
  const portfolioMissing = value.portfolioEvidenceId === null
    && value.portfolioUniverseSnapshotId === null;
  const portfolioAvailable = typeof value.portfolioEvidenceId === "string"
    && /^annual-portfolio-lab-quant:[a-f0-9]{64}$/.test(value.portfolioEvidenceId)
    && sha(value.portfolioUniverseSnapshotId);
  return (decisionMissing || decisionAvailable) && (portfolioMissing || portfolioAvailable);
}
function validExpectedValuationMethods(value: unknown, v2 = false): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const methods = new Set<string>();
  const bases = new Set<string>();
  for (const candidate of value) {
    if (!record(candidate)) return false;
    const keys = Object.keys(candidate).sort();
    if (keys.join(",") !== (v2 ? "basisKind,methodId,scenarioId,scenarioRevision" : "methodId,scenarioId,scenarioRevision")) return false;
    if (!positive(candidate.scenarioId) || !positiveIntegerOk(candidate.scenarioRevision)
      || !["discounted_forward_metric_multiple_user_scenario", "adjusted_net_asset_value_user_scenario",
        FCFF_METHOD_ID].includes(String(candidate.methodId))) return false;
    if (v2 && !((candidate.basisKind === "provider" && candidate.methodId === "discounted_forward_metric_multiple_user_scenario")
      || (candidate.basisKind === "fcff" && candidate.methodId === FCFF_METHOD_ID))) return false;
    methods.add(String(candidate.methodId));
    if (v2) bases.add(String(candidate.basisKind));
  }
  return methods.size === 2 && (!v2 || bases.size === 2);
}
function validPackCurrentness(value: unknown, context: unknown, limited = false): boolean {
  if (!record(value)) return false;
  const errors: string[] = [];
  exact(value, ["status", "invalidatedBy"], "pack.currentness", errors);
  const reasons = Array.isArray(value.invalidatedBy) ? value.invalidatedBy : [];
  return errors.length === 0
    && ["current", "historical"].includes(String(value.status))
    && reasons.every((reason) => FROZEN_RESEARCH_INVALIDATION_REASONS.includes(reason as FrozenResearchInvalidationReason))
    && uniqueIds(reasons)
    && (value.status === "current") === (reasons.length === 0)
    && (limited || context !== null || reasons.includes("frozen_research_context_missing"))
    && (limited || (!record(context) || !("researchContext" in context)
      ? reasons.includes("research_context_binding_missing") || context === null
      : !reasons.includes("research_context_binding_missing")));
}
function validReport(value: unknown): value is DeepResearchReportData {
  if (!record(value)) return false;
  const errors: string[] = [];
  exact(value, [
    "id", "evidencePackId", "version", "contractVersion", "reportFingerprint",
    "currentness", "status", "gateFailures", "payload", "createdAt"
  ], "report", errors);
  const isEvidenceBoundContract = value.contractVersion === EVIDENCE_BOUND_REPORT_CONTRACT_VERSION;
  const isSynthesisContract = value.contractVersion === DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION;
  const isCurrentContract = isEvidenceBoundContract || isSynthesisContract;
  const isLegacyContract = value.contractVersion === LEGACY_REPORT_CONTRACT_VERSION;
  if (record(value.payload)) {
    exact(
      value.payload,
      isEvidenceBoundContract
        ? [...EVIDENCE_BOUND_REPORT_PAYLOAD_KEYS]
        : isSynthesisContract
          ? [
              ...REPORT_PAYLOAD_KEYS, "reportContractVersion", "evidencePackBinding", "snapshotBinding", "snapshot",
              "reproducibility", "adviceLayer", "researchLayer", ...(Object.hasOwn(value.payload, "sendManifest") ? ["sendManifest"] : [])
            ]
          : [...REPORT_PAYLOAD_KEYS],
      "report.payload",
      errors
    );
  }
  const gateFailureItems = Array.isArray(value.gateFailures) ? value.gateFailures : [];
  const gateFailures = Array.isArray(value.gateFailures) && gateFailureItems.length <= 100
    && gateFailureItems.every((item) => nonEmpty(item) && String(item).length <= 4000) && new Set(gateFailureItems).size === gateFailureItems.length;
  const payload = record(value.payload) && (isEvidenceBoundContract
    ? evidenceBoundStoredPayloadValid(value.payload)
    : isSynthesisContract
      ? validateSynthesizedDeepResearchReportPayload(value.payload).ok
      : legacyReportPayloadValid(value.payload));
  const currentness = validReportCurrentness(value.currentness, isLegacyContract);
  return errors.length === 0 && positive(value.id) && positive(value.evidencePackId) && positiveIntegerOk(value.version)
    && (isCurrentContract || isLegacyContract)
    && (isCurrentContract ? sha(value.reportFingerprint) : value.reportFingerprint === "UNKNOWN")
    && currentness
    && ["evidence_insufficient", "complete_pending_confirmation"].includes(String(value.status)) && gateFailures && payload
    && (value.status === "complete_pending_confirmation") === (gateFailureItems.length === 0) && instantOk(value.createdAt);
}
function validDecision(value: unknown): value is DeepResearchDecisionData {
  if (!record(value)) return false;
  const errors: string[] = [];
  exact(value, ["id", "reportId", "decision", "note", "actorType", "actorId", "decidedAt"], "decision", errors);
  return errors.length === 0 && positive(value.id) && positive(value.reportId) && ["confirmed", "rejected"].includes(String(value.decision))
    && (value.note === null || nonEmpty(value.note) && String(value.note).length <= 4000)
    && value.actorType === "user" && nonEmpty(value.actorId) && String(value.actorId).length <= 200 && instantOk(value.decidedAt);
}
function validReportDeletion(value: unknown): value is DeepResearchReportDeletionData {
  if (!record(value)) return false;
  const errors: string[] = [];
  exact(value, ["reportId", "evidencePackId", "reportVersion", "membershipId", "membershipVersion", "symbol", "reportFingerprint", "deletedAt", "state"], "reportDeletion", errors);
  return errors.length === 0 && positive(value.reportId) && positive(value.evidencePackId)
    && positiveIntegerOk(value.reportVersion) && positive(value.membershipId)
    && positiveIntegerOk(value.membershipVersion) && /^HK\.\d{5}$/.test(String(value.symbol))
    && (sha(value.reportFingerprint) || value.reportFingerprint === "UNKNOWN")
    && instantOk(value.deletedAt) && value.state === "deleted";
}
function validateEvidencePackBinding(value: unknown, errors: string[]): void {
  if (!record(value)) {
    errors.push("evidencePackBinding must be an object");
    return;
  }
  const v2 = value.contextVersion === FROZEN_RESEARCH_CONTEXT_VERSION_V2;
  exact(value, [
    "id", "version", "fingerprint", "membershipId", "membershipVersion",
    "symbol", "frozenAt", "contextVersion", ...(v2 ? ["valuationMethods"] : ["valuation"]), "technical",
    ...("quantPortfolio" in value ? ["quantPortfolio"] : [])
  ], "evidencePackBinding", errors);
  positiveId(value.id, "evidencePackBinding.id", errors);
  positiveInteger(value.version, "evidencePackBinding.version", errors);
  if (!sha(value.fingerprint)) errors.push("evidencePackBinding.fingerprint is invalid");
  positiveId(value.membershipId, "evidencePackBinding.membershipId", errors);
  positiveInteger(value.membershipVersion, "evidencePackBinding.membershipVersion", errors);
  if (!/^HK\.\d{5}$/.test(String(value.symbol))) errors.push("evidencePackBinding.symbol is invalid");
  instant(value.frozenAt, "evidencePackBinding.frozenAt", errors);
  if (![FROZEN_RESEARCH_CONTEXT_VERSION, FROZEN_RESEARCH_CONTEXT_VERSION_V2].includes(value.contextVersion as typeof FROZEN_RESEARCH_CONTEXT_VERSION)) errors.push("evidencePackBinding.contextVersion is invalid");
  if (v2) {
    if (!Array.isArray(value.valuationMethods) || value.valuationMethods.length !== 2
      || !record(value.valuationMethods[0]) || value.valuationMethods[0].basisKind !== "provider"
      || !record(value.valuationMethods[1]) || value.valuationMethods[1].basisKind !== "fcff") {
      errors.push("evidencePackBinding.valuationMethods must bind provider PE and FCFF");
    } else for (const item of value.valuationMethods) {
      if (!record(item)) { errors.push("evidencePackBinding valuation method is invalid"); continue; }
      exact(item, ["basisKind", "scenarioId", "scenarioRevision", "methodId", "sourceFingerprint", "calculationVersion"], "evidencePackBinding.valuationMethods", errors);
      if (!((item.basisKind === "provider" && item.methodId === "discounted_forward_metric_multiple_user_scenario")
        || (item.basisKind === "fcff" && item.methodId === FCFF_METHOD_ID))
        || !positive(item.scenarioId) || !positiveIntegerOk(item.scenarioRevision)
        || !sha(item.sourceFingerprint) || !nonEmpty(item.calculationVersion)) errors.push("evidencePackBinding valuation method identity is invalid");
    }
  } else if (!record(value.valuation)) {
    errors.push("evidencePackBinding.valuation must be an object");
  } else {
    exact(value.valuation, [
      "scenarioId", "scenarioRevision", "assumptions", "calculationVersion"
    ], "evidencePackBinding.valuation", errors);
    positiveId(value.valuation.scenarioId, "evidencePackBinding.valuation.scenarioId", errors);
    positiveInteger(value.valuation.scenarioRevision, "evidencePackBinding.valuation.scenarioRevision", errors);
    bounded(value.valuation.calculationVersion, "evidencePackBinding.valuation.calculationVersion", 200, errors);
    validateOwnerAssumptions(
      value.valuation.assumptions,
      "evidencePackBinding.valuation.assumptions",
      errors
    );
  }
  if (!record(value.technical)) {
    errors.push("evidencePackBinding.technical must be an object");
  } else {
    exact(value.technical, [
      "snapshotSha", "resultHash", "dataCutoffAt", "adjustment", "computationVersion"
    ], "evidencePackBinding.technical", errors);
    if (!sha(value.technical.snapshotSha)) errors.push("evidencePackBinding.technical.snapshotSha is invalid");
    if (!sha(value.technical.resultHash)) errors.push("evidencePackBinding.technical.resultHash is invalid");
    instant(value.technical.dataCutoffAt, "evidencePackBinding.technical.dataCutoffAt", errors);
    if (value.technical.adjustment !== "forward_qfq_research_only") errors.push("evidencePackBinding.technical.adjustment is invalid");
    bounded(value.technical.computationVersion, "evidencePackBinding.technical.computationVersion", 200, errors);
  }
  if ("quantPortfolio" in value && !validFrozenQuantPortfolioEvidence(value.quantPortfolio)) {
    errors.push("evidencePackBinding.quantPortfolio is invalid");
  }
}
function validateOwnerAssumptions(value: unknown, label: string, errors: string[]): void {
  if (!record(value)) {
    errors.push(`${label} is invalid`);
    return;
  }
  exact(value, ["authority", "derivation", "values"], label, errors);
  if (value.authority !== "owner") errors.push(`${label}.authority must be owner`);
  if (value.derivation !== "manual_not_derived_from_citation") {
    errors.push(`${label}.derivation is invalid`);
  }
  if (!record(value.values)) {
    errors.push(`${label}.values is invalid`);
    return;
  }
  const validation = validateAnnualValuationScenarioInput(value.values);
  if (!validation.ok) errors.push(...validation.errors.map((error) => `${label}.values.${error}`));
}
function validateReportReproducibility(value: unknown, errors: string[]): void {
  if (!record(value)) {
    errors.push("reproducibility must be an object");
    return;
  }
  exact(value, ["generationMethod", "model", "prompt", "provider", "tokenUsage", "cost"], "reproducibility", errors);
  if (value.generationMethod !== "deterministic_frozen_fact_framework") errors.push("reproducibility.generationMethod is invalid");
  for (const key of ["model", "prompt", "provider", "tokenUsage", "cost"]) {
    if (value[key] !== "NOT_USED") errors.push(`reproducibility.${key} must be NOT_USED`);
  }
}
function validateAdviceLayer(value: unknown, errors: string[]): void {
  if (!record(value)) {
    errors.push("adviceLayer must be an object");
    return;
  }
  const baseKeys = [
    "conclusion", "confidence", "applicableUntil", "horizonStatement",
    "longTerm", "mediumShortTerm", "conflict", "automaticTradingSignal"
  ];
  const recommendationKeys = [
    "direction", "priceConditions", "priceRange", "researchPositionRange",
    "assumptions", "scenarios", "nextQuestion", "versionChange"
  ];
  const hasRecommendation = recommendationKeys.some((key) => Object.hasOwn(value, key));
  exact(value, hasRecommendation ? [...baseKeys, ...recommendationKeys] : baseKeys, "adviceLayer", errors);
  bounded(value.conclusion, "adviceLayer.conclusion", 4000, errors);
  if (!["low", "medium", "high", "UNKNOWN"].includes(String(value.confidence))) errors.push("adviceLayer.confidence is invalid");
  instant(value.applicableUntil, "adviceLayer.applicableUntil", errors);
  bounded(value.horizonStatement, "adviceLayer.horizonStatement", 4000, errors);
  validateResearchView(value.longTerm, "adviceLayer.longTerm", errors);
  validateResearchView(value.mediumShortTerm, "adviceLayer.mediumShortTerm", errors);
  if (!record(value.conflict)) errors.push("adviceLayer.conflict must be an object");
  else {
    exact(value.conflict, ["status", "description"], "adviceLayer.conflict", errors);
    if (!["aligned", "conflict", "UNKNOWN"].includes(String(value.conflict.status))) errors.push("adviceLayer.conflict.status is invalid");
    bounded(value.conflict.description, "adviceLayer.conflict.description", 4000, errors);
  }
  if (value.automaticTradingSignal !== false) errors.push("adviceLayer.automaticTradingSignal must be false");
  if (hasRecommendation) {
    if (!FORMAL_DECISION_DIRECTIONS.includes(value.direction as FormalDecisionDirection)) {
      errors.push("adviceLayer.direction is invalid");
    }
    for (const key of ["priceConditions", "assumptions", "scenarios"]) {
      strings(value[key], `adviceLayer.${key}`, 50, errors);
    }
    for (const key of ["priceRange", "researchPositionRange", "nextQuestion", "versionChange"]) {
      bounded(value[key], `adviceLayer.${key}`, 4000, errors);
    }
  }
}
function validateResearchView(value: unknown, label: string, errors: string[]): void {
  if (!record(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  exact(value, ["view", "conditions", "invalidationConditions", "risks"], label, errors);
  bounded(value.view, `${label}.view`, 4000, errors);
  for (const key of ["conditions", "invalidationConditions", "risks"]) strings(value[key], `${label}.${key}`, 50, errors);
}
function validateResearchLayer(value: unknown, errors: string[]): void {
  if (!record(value)) {
    errors.push("researchLayer must be an object");
    return;
  }
  exact(value, [
    "fundamentals", "valuation", "technical", "eventsAndCatalysts", "risks",
    "counterevidence", "unknowns", "sourceConflicts", "nextValidationQuestions",
    ...("quantPortfolio" in value ? ["quantPortfolio"] : [])
  ], "researchLayer", errors);
  for (const key of [
    "fundamentals", "valuation", "technical", "eventsAndCatalysts",
    "risks", "counterevidence", "unknowns", ...("quantPortfolio" in value ? ["quantPortfolio"] : [])
  ]) evidenceBoundFacts(value[key], `researchLayer.${key}`, errors);
  facts(value.sourceConflicts, "researchLayer.sourceConflicts", errors, "description");
  strings(value.nextValidationQuestions, "researchLayer.nextValidationQuestions", 50, errors);
}
function validateResearchDraftLayer(value: unknown, errors: string[]): void {
  if (!record(value)) {
    errors.push("researchLayer must be an object");
    return;
  }
  exact(value, [
    "fundamentals", "eventsAndCatalysts", "risks", "counterevidence",
    "unknowns", "sourceConflicts", "nextValidationQuestions"
  ], "researchLayer", errors);
  for (const key of [
    "fundamentals", "eventsAndCatalysts", "risks", "counterevidence", "unknowns"
  ]) evidenceBoundFacts(value[key], `researchLayer.${key}`, errors);
  facts(value.sourceConflicts, "researchLayer.sourceConflicts", errors, "description");
  strings(value.nextValidationQuestions, "researchLayer.nextValidationQuestions", 50, errors);
}
function legacyReportPayloadValid(value: Record<string, unknown>): boolean {
  const errors: string[] = [];
  exact(value, [...REPORT_PAYLOAD_KEYS], "legacyReport.payload", errors);
  bounded(value.researchQuestion, "researchQuestion", 4000, errors);
  instant(value.cutoffAt, "cutoffAt", errors);
  bounded(value.investmentThesis, "investmentThesis", 10000, errors);
  facts(value.factTable, "factTable", errors);
  strings(value.supportEvidenceIds, "supportEvidenceIds", 100, errors);
  strings(value.counterEvidenceIds, "counterEvidenceIds", 100, errors);
  bounded(value.sourceConflictAssessment, "sourceConflictAssessment", 4000, errors);
  facts(value.sourceConflicts, "sourceConflicts", errors, "description");
  for (const key of [
    "unknownItems", "keyDrivers", "causalChain", "valuationScenarios",
    "impliedExpectations", "invalidationConditions", "portfolioImpact",
    "nextValidationQuestions"
  ]) strings(value[key], key, 50, errors);
  bounded(value.changeFromPrevious, "changeFromPrevious", 4000, errors);
  facts(value.modelInferences, "modelInferences", errors);
  return errors.length === 0;
}
function evidenceBoundStoredPayloadValid(value: Record<string, unknown>): boolean {
  const errors: string[] = [];
  exact(value, [...EVIDENCE_BOUND_REPORT_PAYLOAD_KEYS], "report.payload", errors);
  if (!legacyReportPayloadValid(Object.fromEntries(
    REPORT_PAYLOAD_KEYS.map((key) => [key, value[key]])
  ))) errors.push("compatibility projection is invalid");
  if (value.reportContractVersion !== EVIDENCE_BOUND_REPORT_CONTRACT_VERSION) errors.push("reportContractVersion is invalid");
  validateEvidencePackBinding(value.evidencePackBinding, errors);
  validateReportReproducibility(value.reproducibility, errors);
  validateAdviceLayer(value.adviceLayer, errors);
  validateResearchLayer(value.researchLayer, errors);
  return errors.length === 0;
}
function validReportCurrentness(value: unknown, legacy: boolean): boolean {
  if (!record(value)) return false;
  const errors: string[] = [];
  exact(value, ["status", "invalidatedBy", "evidencePackInvalidatedBy"], "report.currentness", errors);
  const reasons = Array.isArray(value.invalidatedBy) ? value.invalidatedBy : [];
  const packReasons = Array.isArray(value.evidencePackInvalidatedBy)
    ? value.evidencePackInvalidatedBy : [];
  return errors.length === 0
    && ["current", "historical"].includes(String(value.status))
    && reasons.every((reason) =>
      DEEP_RESEARCH_REPORT_CURRENTNESS_REASONS.includes(reason as DeepResearchReportCurrentnessReason))
    && uniqueIds(reasons)
    && packReasons.every((reason) =>
      FROZEN_RESEARCH_INVALIDATION_REASONS.includes(reason as FrozenResearchInvalidationReason))
    && uniqueIds(packReasons)
    && (reasons.includes("evidence_pack_historical") === (packReasons.length > 0))
    && (value.status === "current") === (reasons.length === 0 && packReasons.length === 0)
    && (!legacy || reasons.includes("legacy_contract_not_formalizable"));
}
function validateClassification(value: Record<string, unknown>, materials: ResearchMaterialData[], decision: DeepResearchDecisionData | null, errors: string[]): void {
  exact(value, ["verifiedFactMaterialIds", "issuerStatementMaterialIds", "thirdPartyStatementMaterialIds", "modelInferenceMaterialIds", "userDecisionId"], "classification", errors);
  const pairs = [["verifiedFactMaterialIds", "verified_fact"], ["issuerStatementMaterialIds", "issuer_statement"],
    ["thirdPartyStatementMaterialIds", "third_party_statement"], ["modelInferenceMaterialIds", "model_inference"]] as const;
  for (const [key, claimType] of pairs) {
    const expected = materials.filter((item) => item.claimType === claimType).map((item) => item.id);
    if (!sameIds(value[key], expected)) errors.push(`classification.${key} does not match materials`);
  }
  if (value.userDecisionId !== (decision?.id ?? null)) errors.push("classification.userDecisionId does not match userDecision");
}
function validateCompletion(value: Record<string, unknown>, decision: DeepResearchDecisionData | null, errors: string[]): void {
  exact(value, ["state", "deepResearchComplete", "reasons"], "completion", errors);
  const states = ["materials_required", "pack_required", "research_required", "user_confirmation_required", "confirmed", "rejected"];
  if (!states.includes(String(value.state)) || typeof value.deepResearchComplete !== "boolean"
    || value.deepResearchComplete !== (value.state === "confirmed") || !stringListOk(value.reasons, 100)) errors.push("completion is invalid");
  if (value.state === "confirmed" && decision?.decision !== "confirmed") errors.push("confirmed completion requires a confirmed user decision");
  if (value.state === "rejected" && decision?.decision !== "rejected") errors.push("rejected completion requires a rejected user decision");
}
function facts(value: unknown, key: string, errors: string[], textKey = "statement"): void { if (!Array.isArray(value) || value.length > 100) { errors.push(`${key} must be an array of at most 100 items`); return; } value.forEach((item, index) => { if (!record(item)) errors.push(`${key}[${index}] must be an object`); else { exact(item, [textKey, "evidenceIds"], `${key}[${index}]`, errors); bounded(item[textKey], `${key}[${index}].${textKey}`, 4000, errors); strings(item.evidenceIds, `${key}[${index}].evidenceIds`, 100, errors); } }); }
function evidenceBoundFacts(value: unknown, key: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length > 100) {
    errors.push(`${key} must be an array of at most 100 items`);
    return;
  }
  value.forEach((item, index) => {
    if (!record(item)) {
      errors.push(`${key}[${index}] must be an object`);
      return;
    }
    exact(item, ["statement", "evidenceIds", "sourceKind", "claimType", "stance"], `${key}[${index}]`, errors);
    bounded(item.statement, `${key}[${index}].statement`, 4000, errors);
    strings(item.evidenceIds, `${key}[${index}].evidenceIds`, 100, errors);
    if (!["material", "valuation_context", "technical_context", "quant_portfolio_context", "source_missing"].includes(String(item.sourceKind))) {
      errors.push(`${key}[${index}].sourceKind is invalid`);
    }
    if (![...MATERIAL_CLAIM_TYPES, "pack_context", "UNKNOWN"].includes(String(item.claimType))) {
      errors.push(`${key}[${index}].claimType is invalid`);
    }
    if (!["support", "refute", "neutral", "UNKNOWN"].includes(String(item.stance))) {
      errors.push(`${key}[${index}].stance is invalid`);
    }
  });
}
function strings(value: unknown, key: string, max: number, errors: string[]): void { if (!Array.isArray(value) || value.length > max || value.some((item) => !nonEmpty(item) || String(item).length > 4000) || new Set(value).size !== value.length) errors.push(`${key} must contain at most ${max} unique non-empty strings`); }
function validOwnerWeinsteinZoneRevision(value: unknown, expected: unknown): value is OwnerWeinsteinZoneRevision {
  if (!record(value) || !validateFrozenWeinsteinEvidenceBinding(expected)
    || !validateFrozenWeinsteinEvidenceBinding(value.basedOn)) return false;
  const errors: string[] = [];
  exact(value, ["version", "reason", "basedOn", "supportZones", "resistanceZones"], "ownerWeinsteinZones", errors);
  if (errors.length || !positiveIntegerOk(value.version) || !nonEmpty(value.reason)
    || String(value.reason).length > 1000 || !record(value.basedOn)
    || Object.entries(expected).some(([key, item]) => (value.basedOn as Record<string, unknown>)[key] !== item)) return false;
  const validZones = (zones: unknown): zones is OwnerWeinsteinPriceZone[] => Array.isArray(zones)
    && zones.length <= 5 && zones.every((zone) => record(zone)
      && Object.keys(zone).sort().join(",") === "lower,upper"
      && typeof zone.lower === "number" && Number.isFinite(zone.lower) && zone.lower > 0
      && typeof zone.upper === "number" && Number.isFinite(zone.upper) && zone.upper >= zone.lower);
  return validZones(value.supportZones) && validZones(value.resistanceZones)
    && value.supportZones.length + value.resistanceZones.length > 0;
}
function positiveId(value: unknown, key: string, errors: string[]): void { if (!positive(value)) errors.push(`${key} must be a positive integer string`); }
function positive(value: unknown): boolean { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function positiveInteger(value: unknown, key: string, errors: string[]): void { if (!positiveIntegerOk(value)) errors.push(`${key} must be a positive integer`); }
function positiveIntegerOk(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) > 0; }
function bounded(value: unknown, key: string, max: number, errors: string[]): void { if (!nonEmpty(value) || String(value).length > max) errors.push(`${key} must be a non-empty string of at most ${max} characters`); }
function optionalBounded(value: unknown, key: string, max: number, errors: string[]): void { if (value !== undefined && value !== null && (!nonEmpty(value) || String(value).length > max)) errors.push(`${key} must be null or a non-empty string of at most ${max} characters`); }
function instant(value: unknown, key: string, errors: string[]): void { if (!instantOk(value)) errors.push(`${key} must be a valid date-time`); }
function instantOk(value: unknown): boolean { return typeof value === "string" && isRfc3339DateTime(value) && Number.isFinite(Date.parse(value)); }
function date(value: unknown): number { return typeof value === "string" ? Date.parse(value) : Number.NaN; }
function nonEmpty(value: unknown): boolean { return typeof value === "string" && value.trim().length > 0; }
function stringListOk(value: unknown, max: number): value is string[] { return Array.isArray(value) && value.length <= max && value.every((item) => nonEmpty(item) && item.length <= 4000) && new Set(value).size === value.length; }
function uniqueIds(values: string[]): boolean { return new Set(values).size === values.length; }
function sameIds(value: unknown, expected: string[]): boolean { return Array.isArray(value) && value.every(positive) && uniqueIds(value) && [...value].sort().join(",") === [...expected].sort().join(","); }
function sha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[], label: string, errors: string[]): void { const allowed = new Set(keys); for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`); }
function invalid(errors: string[]): { ok: false; errors: string[] } { return { ok: false, errors }; }
