import { canonicalJson } from "../../../../packages/contracts/src/decisionContext.js";
import {
  evidenceBoundReportPackBinding,
  validateDeepResearchWorkspaceEnvelope,
  type DeepResearchWorkspaceEnvelope
} from "../../../../packages/contracts/src/deepResearch.js";
import {
  PORTFOLIO_REPORT_EXPLANATION_SCHEMA_VERSION,
  validatePortfolioReportExplanationEnvelope,
  type PortfolioReportExplanationEnvelope,
  type PortfolioReportExplanationStatus
} from "../../../../packages/contracts/src/portfolioReportExplanation.js";
import {
  validateAnnualPortfolioLabEnvelope,
  type AnnualPortfolioLabData,
  type AnnualPortfolioLabEnvelope
} from "../../../../packages/contracts/src/annualPortfolioLab.js";
import {
  deepResearchReportFingerprint,
  evidencePackFingerprint
} from "./deepResearchGate.js";

export function portfolioReportExplanationFromFacts(
  workspace: DeepResearchWorkspaceEnvelope,
  lab: AnnualPortfolioLabEnvelope,
  now = new Date()
): PortfolioReportExplanationEnvelope {
  const generatedAt = now.toISOString();
  if (!validateDeepResearchWorkspaceEnvelope(workspace).ok) {
    return failClosed(generatedAt, workspace.membershipId, workspace.requestedActorId, "unavailable", "Deep Research workspace failed contract validation.");
  }
  if (!validateAnnualPortfolioLabEnvelope(lab).ok) {
    return failClosed(generatedAt, lab.membershipId, lab.requestedActorId, "unavailable", "Portfolio scenario facts failed contract validation.");
  }
  if (workspace.status !== "available" || !workspace.data) {
    return failClosed(
      generatedAt,
      workspace.membershipId,
      workspace.requestedActorId,
      workspace.status === "not_found" ? "not_found" : "unavailable",
      workspace.message
    );
  }
  if (lab.status !== "available" || !lab.data) {
    return failClosed(
      generatedAt,
      lab.membershipId,
      lab.requestedActorId,
      lab.status === "available" ? "unavailable" : lab.status,
      lab.message,
      lab.gaps
    );
  }

  const target = workspace.data.target;
  if (target.membershipState === "archived") {
    return failClosed(generatedAt, target.membershipId, workspace.requestedActorId, "blocked", "Archived membership has no current explanation authority.");
  }
  const currentResearch = exactCurrentResearch(workspace);
  if (!currentResearch.ok) {
    return failClosed(generatedAt, target.membershipId, workspace.requestedActorId, "blocked", currentResearch.message);
  }
  const { pack, report, evidencePackActorId } = currentResearch;
  if (workspace.requestedActorId !== lab.requestedActorId
    || lab.membershipId !== target.membershipId || lab.requestedSymbol !== target.symbol
    || lab.data.target.membershipId !== target.membershipId
    || lab.data.target.membershipVersion !== target.membershipVersion
    || lab.data.target.membershipState !== target.membershipState
    || lab.data.target.symbol !== target.symbol) {
    return failClosed(generatedAt, target.membershipId, workspace.requestedActorId, "blocked", "Membership, actor, report, and portfolio scenario identities drifted.");
  }

  const portfolio = lab.data.portfolio;
  const concentration = portfolio.summary.concentration;
  const quote = lab.data.sourceIdentity.quote;
  const quant = lab.data.quant;
  const quantEvidence = quant.evidence;
  if (portfolio.status !== "available" || concentration.status !== "available"
    || concentration.largestPositionWeight === null || concentration.topThreeWeight === null || concentration.hhi === null
    || portfolio.positions.some((position) => position.marketValue === null || position.marketWeight === null)
    || quote.source !== "futu" || quote.symbol !== target.symbol
    || lab.data.scenarios.some((scenario) => Object.values(scenario.riskImpact.scenario).some((value) => value === null))
    || !completeQuantRisk(lab.data)) {
    return failClosed(generatedAt, target.membershipId, workspace.requestedActorId, "blocked", "Current portfolio, quote, scenario, or versioned quant-risk facts are incomplete.");
  }
  const exactQuantEvidence = quantEvidence!;
  const hkConnectUniverse = exactQuantEvidence.source.hkConnectUniverse!;

  const candidate = portfolio.positions.find((position) => position.symbol === target.symbol);
  const data = {
    binding: {
      membershipId: target.membershipId,
      membershipVersion: target.membershipVersion,
      membershipState: target.membershipState,
      symbol: target.symbol,
      evidencePackId: pack.id,
      evidencePackVersion: pack.version,
      evidencePackFingerprint: pack.packFingerprint,
      evidencePackActorId,
      evidencePackMembershipId: pack.membershipId,
      evidencePackMembershipVersion: pack.membershipVersion,
      evidencePackSymbol: pack.symbol,
      reportId: report.id,
      reportVersion: report.version,
      reportFingerprint: report.reportFingerprint,
      reportEvidencePackId: report.evidencePackId,
      accountScopeId: lab.data.sourceIdentity.accountScopeId,
      portfolioContextId: lab.data.sourceIdentity.portfolioContextId,
      portfolioSnapshotId: lab.data.sourceIdentity.portfolioSnapshotId,
      portfolioAsOf: lab.data.sourceIdentity.portfolioAsOf,
      decisionContextId: lab.data.sourceIdentity.decisionContextId,
      decisionContextHash: lab.data.sourceIdentity.decisionContextHash,
      quote: { ...quote, source: "futu" as const }
    },
    holdings: {
      candidate: {
        status: candidate ? "held" as const : "not_held" as const,
        marketValue: candidate?.marketValue ?? 0,
        weight: candidate?.marketWeight ?? 0
      },
      positions: portfolio.positions.map((position) => ({
        symbol: position.symbol,
        name: position.name,
        marketValue: position.marketValue!,
        weight: position.marketWeight!
      })),
      totalMarketValue: portfolio.summary.marketValue.amount!,
      concentration: {
        largestPositionWeight: concentration.largestPositionWeight,
        topThreeWeight: concentration.topThreeWeight,
        hhi: concentration.hhi
      }
    },
    scenarios: lab.data.scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      userInputAmount: scenario.hypotheticalAmount,
      candidateWeight: scenario.riskImpact.scenario.candidateWeight!,
      candidateWeightChange: scenario.comparison.candidateWeightChange,
      largestPositionWeight: scenario.riskImpact.scenario.largestPositionWeight!,
      largestPositionWeightChange: scenario.comparison.largestPositionWeightChange,
      hhi: scenario.riskImpact.scenario.hhi!,
      hhiChange: scenario.comparison.hhiChange
    })),
    quantRisk: {
      evidenceId: exactQuantEvidence.evidenceId,
      hkConnectUniverse,
      source: {
        snapshotId: exactQuantEvidence.source.snapshotId,
        snapshotHash: exactQuantEvidence.source.snapshotHash,
        dataHash: exactQuantEvidence.source.dataHash,
        dataCutoff: exactQuantEvidence.source.dataCutoff,
        observationStartDate: exactQuantEvidence.source.observationStartDate,
        observationEndDate: exactQuantEvidence.source.observationEndDate,
        fetchedAt: exactQuantEvidence.source.sourceIdentity.fetchedAt
      },
      coverage: quant.coverage,
      correlations: quant.correlations,
      candidateLiquidity: quant.candidateLiquidity,
      currentHistorical: lab.data.current.historical,
      scenarios: lab.data.scenarios.map((scenario) => ({
        scenarioId: scenario.scenarioId,
        historical: scenario.historical
      })),
      limitations: quant.limitations
    },
    unknowns: {
      cash: "UNKNOWN" as const,
      fundingSource: "UNKNOWN" as const,
      sector: "UNKNOWN" as const,
      opportunityCost: "UNKNOWN" as const
    }
  };
  const envelope: PortfolioReportExplanationEnvelope = {
    schemaVersion: PORTFOLIO_REPORT_EXPLANATION_SCHEMA_VERSION,
    generatedAt,
    status: "available",
    membershipId: target.membershipId,
    requestedActorId: workspace.requestedActorId,
    requestedSymbol: target.symbol,
    data,
    gaps: [
      "Cash is UNKNOWN.",
      "Scenario funding source is UNKNOWN.",
      "Sector classification is UNKNOWN.",
      "Opportunity cost is UNKNOWN."
    ],
    safety: safetyBoundary(),
    message: `Read-only neutral portfolio explanation for ${target.symbol}.`
  };
  return validatePortfolioReportExplanationEnvelope(envelope).ok
    ? envelope
    : failClosed(generatedAt, target.membershipId, workspace.requestedActorId, "unavailable", "Assembled explanation failed contract validation.");
}

function completeQuantRisk(data: AnnualPortfolioLabData): boolean {
  return data.quant.evidenceStatus === "available" && data.quant.coverage.status === "exact"
    && data.quant.correlations.status === "available" && data.quant.candidateLiquidity.status === "available"
    && Boolean(data.quant.evidence?.source.hkConnectUniverse) && data.current.historical.status === "available"
    && data.scenarios.every((scenario) => scenario.historical.status === "available");
}

function exactCurrentResearch(workspace: DeepResearchWorkspaceEnvelope) {
  const data = workspace.data;
  const pack = data?.latestPack;
  const report = data?.latestReport;
  if (!data || !pack || !report) {
    return { ok: false, message: "A current evidence pack and report are required." } as const;
  }
  if (pack.researchMode === "limited") {
    return { ok: false, message: "当前为有限研究，尚未绑定完整估值、技术及组合风险证据。请先在资料与估值工作区补齐输入，再生成完整研究；当前持仓和组合情景仍可单独查看。" } as const;
  }
  const currentPacks = data.evidencePacks.filter((item) => item.currentness.status === "current");
  const currentReports = data.reports.filter((item) => item.currentness.status === "current");
  if (currentPacks.length !== 1 || currentPacks[0]?.id !== pack.id
    || currentReports.length !== 1 || currentReports[0]?.id !== report.id) {
    return { ok: false, message: "Current report or evidence-pack authority is ambiguous." } as const;
  }
  if (!("evidencePackBinding" in report.payload)) {
    return { ok: false, message: "Current report has no exact evidence-pack binding." } as const;
  }
  let expectedPackBinding: ReturnType<typeof evidenceBoundReportPackBinding>;
  try {
    expectedPackBinding = evidenceBoundReportPackBinding(pack);
  } catch {
    return { ok: false, message: "Current evidence-pack binding is incomplete." } as const;
  }
  const packFingerprint = evidencePackFingerprint(
    pack.membershipId,
    pack.membershipVersion,
    data.materials.filter((item) => item.revisionState === "current"),
    pack.frozenResearchContext ?? undefined
  );
  const reportFingerprint = deepResearchReportFingerprint(pack.id, report.payload);
  if (!pack.frozenResearchContext || pack.frozenResearchContext.actor.actorId !== workspace.requestedActorId
    || pack.currentness.status !== "current" || pack.currentness.invalidatedBy.length > 0
    || report.currentness.status !== "current" || report.currentness.invalidatedBy.length > 0
    || report.currentness.evidencePackInvalidatedBy.length > 0
    || report.status !== "complete_pending_confirmation" || report.gateFailures.length > 0
    || pack.packFingerprint !== packFingerprint || report.reportFingerprint !== reportFingerprint
    || report.evidencePackId !== pack.id
    || canonicalJson(report.payload.evidencePackBinding) !== canonicalJson(expectedPackBinding)) {
    return { ok: false, message: "Current report does not bind the exact current evidence pack." } as const;
  }
  return { ok: true, pack, report, evidencePackActorId: pack.frozenResearchContext.actor.actorId } as const;
}

export function portfolioReportExplanationFailClosedEnvelope(
  generatedAt: string,
  membershipId: string,
  actorId: string,
  status: Exclude<PortfolioReportExplanationStatus, "available">,
  message: string,
  gaps: string[] = [message]
): PortfolioReportExplanationEnvelope {
  return failClosed(generatedAt, membershipId, actorId, status, message, gaps);
}

function failClosed(
  generatedAt: string,
  membershipId: string,
  actorId: string,
  status: Exclude<PortfolioReportExplanationStatus, "available">,
  message: string,
  gaps: string[] = [message]
): PortfolioReportExplanationEnvelope {
  return {
    schemaVersion: PORTFOLIO_REPORT_EXPLANATION_SCHEMA_VERSION,
    generatedAt,
    status,
    membershipId,
    requestedActorId: actorId,
    requestedSymbol: null,
    data: null,
    gaps: [...new Set(gaps.length > 0 ? gaps : [message])],
    safety: safetyBoundary(),
    message
  };
}

function safetyBoundary(): PortfolioReportExplanationEnvelope["safety"] {
  return {
    advisoryOnly: true,
    readOnly: true,
    recommendation: false,
    ranking: false,
    score: false,
    suggestedAmount: false,
    targetWeight: false,
    targetPrice: false,
    tradeDirection: false,
    createsOrder: false,
    createsTrade: false,
    callsBroker: false,
    mutatesOfficialPortfolio: false,
    reportWrite: false,
    decisionWrite: false,
    productionWrite: false
  };
}
