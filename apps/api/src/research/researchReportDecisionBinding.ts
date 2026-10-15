import type { PoolClient } from "pg";
import {
  type EvidenceBoundDeepResearchReportPayload
} from "../../../../packages/contracts/src/deepResearch.js";
import {
  evaluateFormalPersonalRisk,
  type FormalOwnerDecisionInput,
  type FormalPersonalRiskAssessment,
  type FormalSystemRecommendationSnapshot
} from "../../../../packages/contracts/src/formalDecision.js";
import type { DecisionSnapshotState } from "../../../../packages/contracts/src/decisionSnapshotContract.js";
import type { SynthesizedDeepResearchReportPayload } from "../../../../packages/contracts/src/deepResearchSynthesisReport.js";
import {
  RESEARCH_REPORT_DECISION_BINDING_VERSION,
  canonicalJson,
  type ResearchReportDecisionBinding,
  type ResearchReportDecisionState
} from "../../../../packages/contracts/src/decisionContext.js";
import { DeepResearchGateError, type AuthenticatedResearchActor } from "./domain.js";
import { findCandidateMembershipByIdForUpdate } from "./candidateMembershipPersistence.js";
import {
  readDeepResearchDecision,
  readDeepResearchReport,
  readEvidencePack,
  readEvidencePackInvalidatedBy,
  readLatestDeepResearchReport,
  readLatestEvidencePack
} from "./deepResearchPersistence.js";
import {
  deepResearchGateFailures,
  deepResearchReportHasFormalRecommendation,
  deepResearchReportIntegrityFailures,
  deepResearchReportFingerprint,
  evidencePackFingerprint,
  isFormalizableDeepResearchReportContractVersion
} from "./deepResearchGate.js";
import { readExistingResearchProfileBinding } from "./writePersistence.js";

type ReportDecisionBindingDependencies = {
  findMembership: typeof findCandidateMembershipByIdForUpdate;
  readProfile: typeof readExistingResearchProfileBinding;
  readPack: typeof readEvidencePack;
  readInvalidatedBy: typeof readEvidencePackInvalidatedBy;
  readLatestPack: typeof readLatestEvidencePack;
  readReport: typeof readDeepResearchReport;
  readLatestReport: typeof readLatestDeepResearchReport;
  readDecision: typeof readDeepResearchDecision;
};

const reportDecisionBindingDependencies: ReportDecisionBindingDependencies = {
  findMembership: findCandidateMembershipByIdForUpdate,
  readProfile: readExistingResearchProfileBinding,
  readPack: readEvidencePack,
  readInvalidatedBy: readEvidencePackInvalidatedBy,
  readLatestPack: readLatestEvidencePack,
  readReport: readDeepResearchReport,
  readLatestReport: readLatestDeepResearchReport,
  readDecision: readDeepResearchDecision
};

export async function resolveResearchReportDecisionBinding(
  client: PoolClient,
  normalized: { market: string; code: string; symbol: string },
  requested: ResearchReportDecisionBinding,
  actor: AuthenticatedResearchActor,
  now: Date,
  dependencies = reportDecisionBindingDependencies
): Promise<ResearchReportDecisionState> {
  if (actor.actorType !== "user" || !actor.actorId) {
    throw new DeepResearchGateError("a user-scoped actor is required to adopt a confirmed research report");
  }
  const membership = await dependencies.findMembership(client, actor, requested.membershipId);
  if (!membershipMatchesRequest(membership, normalized, requested)) {
    throw new DeepResearchGateError("research report membership, version, lifecycle, actor, or symbol is no longer current");
  }
  const profile = await dependencies.readProfile(
    client, normalized.market, normalized.code, normalized.symbol
  );
  if (!profile) throw new DeepResearchGateError("research report profile binding is unavailable");

  const pack = await dependencies.readPack(client, requested.evidencePackId, profile.profileId, now);
  if (!evidencePackMatchesRequest(pack, normalized.symbol, requested)) {
    throw new DeepResearchGateError("research report evidence-pack identity or fingerprint is invalid");
  }
  const invalidatedBy = await dependencies.readInvalidatedBy(
    client,
    profile.profileId,
    pack,
    actor,
    {
      id: requested.membershipId,
      version: Number(membership.version),
      state: membership.state,
      market: membership.market,
      code: membership.code,
      symbol: membership.symbol
    },
    now
  );
  const latestPack = await dependencies.readLatestPack(
    client,
    profile.profileId,
    requested.membershipId,
    requested.membershipVersion,
    now
  );
  if (invalidatedBy.length > 0 || !latestPack || latestPack.id !== pack.id
    || latestPack.packFingerprint !== pack.packFingerprint) {
    throw new DeepResearchGateError("only the latest exact-current evidence pack can be adopted", invalidatedBy);
  }

  const report = await dependencies.readReport(client, requested.reportId, profile.profileId);
  const latestReport = await dependencies.readLatestReport(
    client,
    profile.profileId,
    requested.membershipId,
    requested.membershipVersion
  );
  if (!reportMatchesRequest(report, latestReport, pack.id, requested)) {
    throw new DeepResearchGateError("only the latest exact-current formalizable report can be adopted");
  }
  const payload = report.payload as EvidenceBoundDeepResearchReportPayload | SynthesizedDeepResearchReportPayload;
  if (payload.reportContractVersion !== report.contractVersion
    || deepResearchReportFingerprint(report.evidencePackId, payload) !== report.reportFingerprint
    || deepResearchReportIntegrityFailures(payload, pack).length > 0
    || deepResearchGateFailures(payload, pack, now).length > 0) {
    throw new DeepResearchGateError("research report integrity or current hard-gate validation failed");
  }
  if (!deepResearchReportHasFormalRecommendation(payload)) {
    throw new DeepResearchGateError("formal decision requires a complete typed non-executing report recommendation");
  }

  const decision = await dependencies.readDecision(client, report.id);
  if (!decisionMatchesRequest(decision, actor.actorId, requested)) {
    throw new DeepResearchGateError("the report requires an immutable confirmed decision from the same user actor");
  }
  const authoritative: ResearchReportDecisionBinding = {
    bindingVersion: RESEARCH_REPORT_DECISION_BINDING_VERSION,
    membershipId: String(membership.id),
    membershipVersion: Number(membership.version),
    symbol: membership.symbol,
    evidencePackId: pack.id,
    evidencePackFingerprint: pack.packFingerprint,
    reportId: report.id,
    reportVersion: report.version,
    contractVersion: report.contractVersion,
    reportFingerprint: report.reportFingerprint,
    reportDecisionId: decision.id,
    reportDecision: "confirmed",
    reportDecisionActorType: "user",
    reportDecisionActorId: decision.actorId,
    decidedAt: decision.decidedAt
  };
  if (canonicalJson(authoritative) !== canonicalJson(requested)) {
    throw new DeepResearchGateError("submitted research report binding does not match authoritative current facts");
  }
  return {
    availability: "preserved",
    binding: authoritative,
    limitation: "This formal human decision preserves the exact confirmed report and evidence-pack identities; it does not create an order, trade, or automatic signal."
  };
}

export async function resolveFormalDecisionSnapshots(
  client: PoolClient,
  normalized: { market: string; code: string; symbol: string },
  requested: ResearchReportDecisionBinding,
  ownerDecision: FormalOwnerDecisionInput,
  actionIntent: FormalSystemRecommendationSnapshot["direction"],
  decisionSnapshot: DecisionSnapshotState,
  actor: AuthenticatedResearchActor,
  now: Date
): Promise<{ systemRecommendation: FormalSystemRecommendationSnapshot; ownerDecision: FormalOwnerDecisionInput; differsFromSystem: boolean; personalRiskAssessment: FormalPersonalRiskAssessment }> {
  const state = await resolveResearchReportDecisionBinding(client, normalized, requested, actor, now);
  const profile = await reportDecisionBindingDependencies.readProfile(client, normalized.market, normalized.code, normalized.symbol);
  if (!profile) throw new DeepResearchGateError("formal decision profile is unavailable");
  const report = await reportDecisionBindingDependencies.readReport(
    client,
    requested.reportId,
    profile.profileId
  );
  if (!report || state.availability !== "preserved") throw new DeepResearchGateError("formal decision report is unavailable");
  const payload = report.payload as EvidenceBoundDeepResearchReportPayload | SynthesizedDeepResearchReportPayload;
  const recommendation = payload.adviceLayer;
  if (!deepResearchReportHasFormalRecommendation(payload)) {
    throw new DeepResearchGateError("current report does not contain a typed non-executing recommendation");
  }
  const systemRecommendation: FormalSystemRecommendationSnapshot = {
    source: "deep_research_report_advice_layer",
    direction: recommendation.direction!,
    conclusion: payload.adviceLayer.conclusion,
    confidence: payload.adviceLayer.confidence,
    horizon: payload.adviceLayer.horizonStatement,
    priceConditions: recommendation.priceConditions!,
    priceRange: recommendation.priceRange!,
    researchPositionRange: recommendation.researchPositionRange!,
    assumptions: recommendation.assumptions!,
    scenarios: recommendation.scenarios!,
    risks: [...new Set([...payload.adviceLayer.longTerm.risks, ...payload.adviceLayer.mediumShortTerm.risks])],
    invalidationConditions: [...new Set([...payload.adviceLayer.longTerm.invalidationConditions, ...payload.adviceLayer.mediumShortTerm.invalidationConditions])],
    nextQuestion: recommendation.nextQuestion!,
    versionChange: recommendation.versionChange!,
    reportId: report.id,
    reportVersion: report.version,
    reportFingerprint: report.reportFingerprint,
    nonExecuting: true
  };
  const differsFromSystem = systemRecommendation.direction !== actionIntent;
  if (differsFromSystem && ownerDecision.divergenceReason === null) {
    throw new DeepResearchGateError("a divergence reason is required when the Owner decision differs from the system recommendation");
  }
  if (!ownerDecision.personalRisk) throw new DeepResearchGateError("formal decision requires explicit personal risk limits and confirmation state");
  const snapshot = decisionSnapshot.snapshot;
  const risk = snapshot?.riskImpact.envelope;
  const unrealizedPnl = snapshot?.portfolioContext.envelope?.summary.unrealizedPnl;
  const personalRiskAssessment = evaluateFormalPersonalRisk(ownerDecision.personalRisk.limits, {
    candidateWeight: risk?.scenario.candidateWeight ?? null,
    largestPositionWeight: risk?.scenario.largestPositionWeight ?? null,
    portfolioHhi: risk?.scenario.hhi ?? null,
    unrealizedLossHkd: typeof unrealizedPnl === "number" ? Math.max(0, -unrealizedPnl) : null
  });
  if (personalRiskAssessment.requiresOverride
    && (ownerDecision.personalRisk.overrideReason === null || ownerDecision.personalRisk.secondConfirmed !== true)) {
    throw new DeepResearchGateError("personal risk warnings require an explicit override reason and second confirmation");
  }
  if (!personalRiskAssessment.requiresOverride
    && (ownerDecision.personalRisk.overrideReason !== null || ownerDecision.personalRisk.secondConfirmed !== false)) {
    throw new DeepResearchGateError("a clear personal risk assessment must not claim an override");
  }
  return { systemRecommendation, ownerDecision, differsFromSystem, personalRiskAssessment };
}

type Membership = Awaited<ReturnType<typeof findCandidateMembershipByIdForUpdate>>;
type EvidencePack = Awaited<ReturnType<typeof readEvidencePack>>;
type Report = Awaited<ReturnType<typeof readDeepResearchReport>>;
type Decision = Awaited<ReturnType<typeof readDeepResearchDecision>>;

function membershipMatchesRequest(
  membership: Membership,
  normalized: { market: string; code: string; symbol: string },
  requested: ResearchReportDecisionBinding
): membership is NonNullable<Membership> {
  return membership !== null
    && Number(membership.version) === requested.membershipVersion
    && membership.state !== "archived"
    && membership.market === normalized.market
    && membership.code === normalized.code
    && membership.symbol === normalized.symbol;
}

function evidencePackMatchesRequest(
  pack: EvidencePack,
  symbol: string,
  requested: ResearchReportDecisionBinding
): pack is NonNullable<EvidencePack> {
  return pack !== null
    && pack.membershipId === requested.membershipId
    && pack.membershipVersion === requested.membershipVersion
    && pack.symbol === symbol
    && pack.packFingerprint === requested.evidencePackFingerprint
    && evidencePackFingerprint(
      pack.membershipId, pack.membershipVersion, pack.items, pack.frozenResearchContext ?? undefined, pack.researchMode
    ) === pack.packFingerprint;
}

function reportMatchesRequest(
  report: Report,
  latestReport: Report,
  evidencePackId: string,
  requested: ResearchReportDecisionBinding
): report is NonNullable<Report> {
  return report !== null && latestReport !== null && latestReport.id === report.id
    && report.evidencePackId === evidencePackId && report.version === requested.reportVersion
    && isFormalizableDeepResearchReportContractVersion(report.contractVersion)
    && report.contractVersion === requested.contractVersion
    && report.reportFingerprint === requested.reportFingerprint
    && report.currentness.status === "current" && report.status === "complete_pending_confirmation"
    && report.gateFailures.length === 0;
}

function decisionMatchesRequest(
  decision: Decision,
  actorId: string,
  requested: ResearchReportDecisionBinding
): decision is NonNullable<Decision> {
  return decision !== null && decision.id === requested.reportDecisionId
    && decision.decision === "confirmed" && decision.actorType === "user"
    && decision.actorId === actorId && decision.actorId === requested.reportDecisionActorId
    && decision.decidedAt === requested.decidedAt;
}
