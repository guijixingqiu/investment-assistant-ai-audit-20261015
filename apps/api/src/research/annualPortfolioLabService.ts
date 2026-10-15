import type { CandidateDecisionIntakeEnvelope } from "../../../../packages/contracts/src/candidateDecisionIntake.js";
import {
  ANNUAL_PORTFOLIO_LAB_CALCULATION_VERSION,
  ANNUAL_PORTFOLIO_LAB_SCHEMA_VERSION,
  annualPortfolioHistoricalMetrics,
  annualPortfolioLabHashInput,
  computeAnnualPortfolioLabId,
  computeAnnualPortfolioScenarioId,
  validateAnnualPortfolioLabEnvelope,
  validateAnnualPortfolioLabRequestInput,
  type AnnualPortfolioHistoricalMetrics,
  type AnnualPortfolioLabData,
  type AnnualPortfolioLabEnvelope,
  type AnnualPortfolioLabQuantEvidence,
  type AnnualPortfolioLabQuantView,
  type AnnualPortfolioLabRequestInput,
  type AnnualPortfolioLabScenario,
  type AnnualPortfolioLabStatus
} from "../../../../packages/contracts/src/annualPortfolioLab.js";
import type { PortfolioDecisionContextEnvelope } from "../../../../packages/contracts/src/portfolioDecisionContext.js";
import { calculatePortfolioRiskImpact } from "../portfolio/decisionContext.js";
import type { AnnualPortfolioLabQuantEvidenceLoadResult } from "./annualPortfolioLabQuantEvidence.js";
export function parseAnnualPortfolioLabQuery(query: Record<string, unknown>):
  | { ok: true; value: AnnualPortfolioLabRequestInput }
  | { ok: false; errors: string[] } {
  const unsupported = Object.keys(query).filter((key) => key !== "scenarioAmount");
  const raw = query.scenarioAmount;
  const strings = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const amounts = strings.map((item) => {
    if (typeof item !== "string" || item.trim() === "" || item.trim() !== item) return Number.NaN;
    return Number(item);
  });
  const validation = validateAnnualPortfolioLabRequestInput({ scenarioAmounts: amounts });
  const errors = [
    ...unsupported.map((key) => `unsupported portfolio lab query field ${key}`),
    ...(validation.ok ? [] : validation.errors)
  ];
  return errors.length === 0 && validation.ok
    ? validation
    : { ok: false, errors };
}

export function annualPortfolioLabFromFacts(
  intake: CandidateDecisionIntakeEnvelope,
  portfolio: PortfolioDecisionContextEnvelope,
  input: AnnualPortfolioLabRequestInput,
  quantResult: AnnualPortfolioLabQuantEvidenceLoadResult,
  now = new Date()
): AnnualPortfolioLabEnvelope {
  const generatedAt = now.toISOString();
  if (intake.status !== "available" || !intake.membership || !intake.decisionContext || !intake.requestedSymbol) {
    return annualPortfolioLabFailClosedEnvelope(
      generatedAt,
      intake.membershipId,
      intake.requestedActorId,
      intake.status === "not_found" ? "not_found" : "unavailable",
      intake.message
    );
  }
  const membership = intake.membership;
  const decisionContext = intake.decisionContext;
  if (membership.state === "archived") {
    return annualPortfolioLabFailClosedEnvelope(generatedAt, membership.id, intake.requestedActorId, "blocked", "Archived candidates cannot create a current portfolio lab.");
  }
  if (!["available", "stale"].includes(portfolio.status) || !portfolio.contextId || !portfolio.portfolioSnapshotId
    || !portfolio.accountScopeId || !portfolio.portfolioAsOf || !portfolio.summary.marketValue.amount) {
    return annualPortfolioLabFailClosedEnvelope(
      generatedAt,
      membership.id,
      intake.requestedActorId,
      "blocked",
      "A complete current account-scoped Pingan portfolio with current Futu quotes is required.",
      portfolio.gaps
    );
  }
  const quote = decisionContext.quote;
  if (!["fresh", "stale"].includes(quote.status) || !quote.data || !quote.snapshotId || !quote.fetchedAt || quote.source !== "futu"
    || quote.data.symbol !== membership.symbol || quote.data.currency !== "HKD") {
    return annualPortfolioLabFailClosedEnvelope(
      generatedAt,
      membership.id,
      intake.requestedActorId,
      "blocked",
      "A fresh candidate-bound Futu quote is required before portfolio scenarios are visible."
    );
  }
  const heldCandidate = portfolio.positions.find((position) => position.symbol === membership.symbol);
  if (heldCandidate && (heldCandidate.latestPrice !== quote.data.price
    || heldCandidate.quote.quoteAsOf !== quote.data.quoteTime
    || heldCandidate.quote.fetchedAt !== quote.fetchedAt
    || heldCandidate.quote.source !== "futu")) {
    return annualPortfolioLabFailClosedEnvelope(
      generatedAt,
      membership.id,
      intake.requestedActorId,
      "blocked",
      "Candidate quote identity conflicts with the current portfolio valuation facts."
    );
  }
  const scenarios = input.scenarioAmounts.map((amount, sourceIndex) => {
    const riskImpact = calculatePortfolioRiskImpact(portfolio, membership.symbol, amount, { allowStaleReadOnly: true });
    if (riskImpact.status !== "available") return null;
    return { sourceIndex, amount, riskImpact };
  });
  if (scenarios.some((scenario) => scenario === null)) {
    return annualPortfolioLabFailClosedEnvelope(
      generatedAt,
      membership.id,
      intake.requestedActorId,
      "blocked",
      "At least one user scenario could not bind the exact current portfolio context."
    );
  }

  const evidence = quantResult.ok ? quantResult.evidence : null;
  const requiredSymbols = unique([...portfolio.positions.map((position) => position.symbol), membership.symbol]);
  const quant = buildQuantView(quantResult, requiredSymbols, membership.symbol, portfolio);
  const currentHistorical = historicalForCoverage(quant, evidence, currentWeights(portfolio), membership.symbol);
  const current = {
    totalMarketValue: portfolio.summary.marketValue.amount,
    candidateMarketValue: heldCandidate?.marketValue ?? 0,
    candidateWeight: heldCandidate?.marketWeight ?? 0,
    largestPositionWeight: portfolio.summary.concentration.largestPositionWeight ?? 0,
    hhi: portfolio.summary.concentration.hhi ?? 0,
    historical: currentHistorical
  };
  const completedScenarios = scenarios.map((entry) => {
    if (!entry) throw new Error("unreachable portfolio scenario gap");
    const scenarioHistorical = historicalForCoverage(
      quant,
      evidence,
      scenarioWeights(portfolio, entry.riskImpact, membership.symbol),
      membership.symbol
    );
    const withoutId: Omit<AnnualPortfolioLabScenario, "scenarioId"> = {
      sourceIndex: entry.sourceIndex,
      hypotheticalAmount: entry.amount,
      riskImpact: entry.riskImpact,
      comparison: {
        candidateWeightChange: entry.riskImpact.scenario.weightChange ?? 0,
        largestPositionWeightChange: round((entry.riskImpact.scenario.largestPositionWeight ?? 0) - current.largestPositionWeight, 8),
        hhiChange: round((entry.riskImpact.scenario.hhi ?? 0) - current.hhi, 8),
        otherPositionWeightChanges: portfolio.positions
          .filter((position) => position.symbol !== membership.symbol)
          .map((position) => {
            const scenarioWeight = round((position.marketValue ?? 0) / (entry.riskImpact.scenario.totalMarketValue ?? 1), 8);
            return {
              symbol: position.symbol,
              currentWeight: position.marketWeight ?? 0,
              scenarioWeight,
              weightChange: round(scenarioWeight - (position.marketWeight ?? 0), 8)
            };
          }),
        fundingSourceStatus: "not_captured",
        cashStatus: "unknown",
        opportunityCostLimitation: "The scenario adds a user amount to exposure only. Cash and funding source are unknown, so no sale, funding, foregone-return, or execution assumption is made."
      },
      historical: {
        ...scenarioHistorical,
        annualizedVolatilityChange: difference(scenarioHistorical.annualizedVolatility, currentHistorical.annualizedVolatility),
        historicalStressLossChange: difference(scenarioHistorical.historicalStressLossMagnitude, currentHistorical.historicalStressLossMagnitude),
        historicalTailLossChange: difference(scenarioHistorical.historicalTailLossMagnitude, currentHistorical.historicalTailLossMagnitude),
        candidateRiskContributionChange: difference(scenarioHistorical.candidateRiskContribution, currentHistorical.candidateRiskContribution)
      }
    };
    return { ...withoutId, scenarioId: computeAnnualPortfolioScenarioId(withoutId) };
  });
  const dimensions: AnnualPortfolioLabData["dimensions"] = {
    positions: portfolio.positions.map((position, sourceIndex) => ({
      sourceIndex,
      symbol: position.symbol,
      name: position.name,
      currency: "HKD",
      marketValue: position.marketValue ?? 0,
      marketWeight: position.marketWeight ?? 0,
      sector: sectorGap()
    })),
    candidate: {
      symbol: membership.symbol,
      name: quote.data.name,
      currency: "HKD",
      currentlyHeld: Boolean(heldCandidate),
      sector: sectorGap()
    },
    currency: {
      status: "single_currency",
      currencies: ["HKD"],
      marketValueByCurrency: [{ currency: "HKD", marketValue: portfolio.summary.marketValue.amount, weight: 1 }]
    }
  };
  const data: AnnualPortfolioLabData = {
    target: {
      membershipId: membership.id,
      membershipVersion: membership.version,
      membershipState: membership.state,
      market: "HK",
      code: membership.code,
      symbol: membership.symbol
    },
    sourceIdentity: {
      accountScopeId: portfolio.accountScopeId,
      portfolioContextId: portfolio.contextId,
      portfolioSnapshotId: portfolio.portfolioSnapshotId,
      portfolioAsOf: portfolio.portfolioAsOf,
      decisionContextId: decisionContext.contextId,
      decisionContextHash: decisionContext.contextHash,
      quote: {
        snapshotId: quote.snapshotId,
        symbol: quote.data.symbol,
        currency: "HKD",
        price: quote.data.price,
        quoteTime: quote.data.quoteTime,
        fetchedAt: quote.fetchedAt,
        source: quote.source
      }
    },
    portfolio,
    dimensions,
    current,
    scenarios: completedScenarios,
    quant
  };
  const gaps = unique([
    ...(portfolio.status === "stale" || quote.status === "stale" ? ["This read-only lab uses explicitly stale closed-market facts; timestamps remain visible and formal decisions must fresh-read again."] : []),
    "Sector classifications are not captured by the current authoritative portfolio or canonical research evidence.",
    "Cash and scenario funding source remain unknown; opportunity cost is limited to observable exposure, concentration, and bounded historical research deltas.",
    ...quant.limitations
  ]);
  const withoutId: Omit<AnnualPortfolioLabEnvelope, "labId"> = {
    schemaVersion: ANNUAL_PORTFOLIO_LAB_SCHEMA_VERSION,
    calculationVersion: ANNUAL_PORTFOLIO_LAB_CALCULATION_VERSION,
    generatedAt,
    status: "available",
    membershipId: membership.id,
    requestedActorId: intake.requestedActorId,
    requestedSymbol: membership.symbol,
    data,
    gaps,
    safety: safetyBoundary(),
    message: `Account-bound ${portfolio.status === "stale" ? "stale read-only" : "current"} portfolio and ${completedScenarios.length} user-ordered scenario(s) for ${membership.symbol}.`
  };
  const envelope: AnnualPortfolioLabEnvelope = {
    ...withoutId,
    labId: computeAnnualPortfolioLabId(annualPortfolioLabHashInput({ ...withoutId, labId: null }))
  };
  return validateAnnualPortfolioLabEnvelope(envelope).ok
    ? envelope
    : annualPortfolioLabFailClosedEnvelope(
        generatedAt,
        membership.id,
        intake.requestedActorId,
        "unavailable",
        "Assembled portfolio lab failed contract validation before response."
      );
}

export function annualPortfolioLabFailClosedEnvelope(
  generatedAt: string,
  membershipId: string,
  actorId: string,
  status: Exclude<AnnualPortfolioLabStatus, "available">,
  message: string,
  gaps: string[] = [message]
): AnnualPortfolioLabEnvelope {
  return {
    schemaVersion: ANNUAL_PORTFOLIO_LAB_SCHEMA_VERSION,
    calculationVersion: ANNUAL_PORTFOLIO_LAB_CALCULATION_VERSION,
    generatedAt,
    status,
    labId: null,
    membershipId,
    requestedActorId: actorId,
    requestedSymbol: null,
    data: null,
    gaps: unique(gaps.length > 0 ? gaps : [message]),
    safety: safetyBoundary(),
    message
  };
}

function buildQuantView(
  result: AnnualPortfolioLabQuantEvidenceLoadResult,
  requiredSymbols: string[],
  candidateSymbol: string,
  portfolio: PortfolioDecisionContextEnvelope
): AnnualPortfolioLabQuantView {
  const evidence = result.ok ? result.evidence : null;
  const universe = evidence?.source.universe.map((item) => item.symbol) ?? [];
  const coveredSymbols = requiredSymbols.filter((symbol) => universe.includes(symbol));
  const missingSymbols = requiredSymbols.filter((symbol) => !universe.includes(symbol));
  const coverageStatus = !evidence ? "unavailable" : missingSymbols.length === 0 ? "exact" : "incomplete";
  const correlationsAvailable = coverageStatus === "exact" && evidence;
  const series = evidence?.series.find((item) => item.symbol === candidateSymbol) ?? null;
  const evidenceStatus = result.ok ? "available" : result.status;
  const coverageLimitation = coverageStatus === "exact"
    ? "Historical metrics cover every exact current-position and candidate symbol, but remain bounded research evidence."
    : evidence
      ? `Historical portfolio metrics are not captured because the canonical evidence is missing: ${missingSymbols.join(", ")}.`
      : `Historical portfolio metrics are unavailable because ${result.ok ? "evidence is unavailable" : result.reason}.`;
  return {
    evidenceStatus,
    evidence,
    coverage: {
      status: coverageStatus,
      requiredSymbols,
      coveredSymbols,
      missingSymbols,
      extraEvidenceSymbols: universe.filter((symbol) => !requiredSymbols.includes(symbol))
    },
    correlations: correlationsAvailable ? {
      status: "available",
      observationStartDate: evidence.source.observationStartDate,
      observationEndDate: evidence.source.observationEndDate,
      observationCount: evidence.method.observationCount,
      stability: evidence.stability.status,
      candidateToPositions: portfolio.positions
        .filter((position) => position.symbol !== candidateSymbol)
        .map((position) => ({ symbol: position.symbol, correlation: correlation(evidence, candidateSymbol, position.symbol) })),
      limitation: `${coverageLimitation} ${evidence.stability.limitation}`
    } : {
      status: evidence ? "not_captured" : "unavailable",
      observationStartDate: null,
      observationEndDate: null,
      observationCount: null,
      stability: "unavailable",
      candidateToPositions: [],
      limitation: coverageLimitation
    },
    candidateLiquidity: series && evidence ? {
      status: "available",
      symbol: candidateSymbol,
      observationCount: evidence.method.observationCount,
      medianDailyVolume: series.liquidity.medianDailyVolume,
      medianDailyTurnover: series.liquidity.medianDailyTurnover,
      minimumDailyVolume: series.liquidity.minimumDailyVolume,
      minimumDailyTurnover: series.liquidity.minimumDailyTurnover,
      zeroVolumeObservationCount: series.liquidity.zeroVolumeObservationCount,
      boardLot: series.boardLot,
      feeCurrency: evidence.executionEvidence.feeCurrency,
      nonZeroCosts: evidence.executionEvidence.nonZeroCosts,
      fees: evidence.executionEvidence.fees,
      limitation: "Liquidity, board-lot, and fee-policy fields describe the exact historical research evidence only; no shares, fee estimate, order, or execution instruction is calculated."
    } : {
      status: evidence ? "not_captured" : "unavailable",
      symbol: candidateSymbol,
      observationCount: null,
      medianDailyVolume: null,
      medianDailyTurnover: null,
      minimumDailyVolume: null,
      minimumDailyTurnover: null,
      zeroVolumeObservationCount: null,
      boardLot: null,
      feeCurrency: null,
      nonZeroCosts: null,
      fees: null,
      limitation: evidence
        ? `Candidate liquidity and execution evidence is not captured for ${candidateSymbol}.`
        : "Candidate liquidity and execution evidence is unavailable."
    },
    limitations: unique([
      coverageLimitation,
      ...(evidence?.limitations ?? [result.ok ? "Quant evidence is unavailable." : result.reason]),
      "Canonical quant facts remain a visibly separate historical research layer and never become current Pingan holdings or Futu quotes."
    ])
  };
}

function historicalForCoverage(
  quant: AnnualPortfolioLabQuantView,
  evidence: AnnualPortfolioLabQuantEvidence | null,
  weights: Map<string, number>,
  candidateSymbol: string
): AnnualPortfolioHistoricalMetrics {
  if (quant.coverage.status === "exact" && evidence) {
    return annualPortfolioHistoricalMetrics(evidence, weights, candidateSymbol);
  }
  return annualPortfolioHistoricalMetrics(
    evidence ?? emptyEvidenceForUnavailable(),
    weights,
    candidateSymbol,
    evidence ? "not_captured" : "unavailable",
    quant.correlations.limitation
  );
}

function emptyEvidenceForUnavailable(): AnnualPortfolioLabQuantEvidence {
  return {} as AnnualPortfolioLabQuantEvidence;
}

function currentWeights(portfolio: PortfolioDecisionContextEnvelope): Map<string, number> {
  return new Map(portfolio.positions.map((position) => [position.symbol, position.marketWeight ?? 0]));
}

function scenarioWeights(
  portfolio: PortfolioDecisionContextEnvelope,
  risk: AnnualPortfolioLabScenario["riskImpact"],
  candidateSymbol: string
): Map<string, number> {
  const total = risk.scenario.totalMarketValue ?? 1;
  const weights = new Map<string, number>();
  portfolio.positions.filter((position) => position.symbol !== candidateSymbol)
    .forEach((position) => weights.set(position.symbol, round((position.marketValue ?? 0) / total, 8)));
  weights.set(candidateSymbol, risk.scenario.candidateWeight ?? 0);
  return weights;
}

function correlation(evidence: AnnualPortfolioLabQuantEvidence, left: string, right: string): number | null {
  return evidence.covariance.find((item) => (
    (item.leftSymbol === left && item.rightSymbol === right)
    || (item.leftSymbol === right && item.rightSymbol === left)
  ))?.correlation ?? null;
}

function difference(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : round(left - right, 10);
}

function sectorGap() {
  return {
    status: "not_captured" as const,
    value: null,
    limitation: "Sector classification is not captured by the authoritative current portfolio or canonical research contract and is not inferred from the company name."
  };
}

function safetyBoundary(): AnnualPortfolioLabEnvelope["safety"] {
  return {
    advisoryOnly: true,
    userProvidedAmountsOnly: true,
    preservesScenarioOrder: true,
    changesCandidateOrdering: false,
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
    productionWrite: false
  };
}

function unique(values: string[]): string[] { return [...new Set(values.filter((value) => value.trim().length > 0))]; }
function round(value: number, digits: number): number { const factor = 10 ** digits; return Math.round((value + Number.EPSILON) * factor) / factor; }
